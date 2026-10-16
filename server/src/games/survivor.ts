/*
 * 픽셀 타운 서바이버 — 판은 브라우저가 돌리고, 서버는 시작/끝 시각 · 보상 · 영구 강화 · 랭킹만.
 *  survivor.start   → 판 번호 (시작 시각 기록)
 *  survivor.finish  → 기록 확인(plausible) → 코인 · 별사탕(다이스 타운 뽑기) 지급 · 랭킹 · 업적 통계
 *  survivor.profile / survivor.upgrade / survivor.rank
 * 다이스 타운 캐릭터 보유 · 강화는 marble_profile 을 그대로 씀.
 */
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad, forbidden } from "../errors";
import { newId } from "../ids";
import { KeyedMutex } from "../mutex";
import type { Ctx } from "../realtime/gateway";
import { pictureOf } from "../users";
import { FREE_HEROES, HERO_IDS, type HeroId } from "../../../web/src/lib/survivor/data";
import { STAR_FIRST_WIN, UPGRADES, UP, plausible, runScore, runStars, upCost, type RunReport, type UpId, type Ups } from "../../../web/src/lib/survivor/progress";
import type { MarbleMeta } from "./marble/meta";

interface SurvivorProfile {
  _id: string;
  gold: number;
  ups: Ups;
  games: number;
  wins: number;
  kills: number;
  /** 오늘 첫 클리어 보너스 받은 날 (KST) */
  winDay: string;
  at: Date;
}
interface RankDoc {
  _id: string;
  uid: string;
  nick: string;
  score: number;
  hero: HeroId;
  sec: number;
  kills: number;
  lv: number;
  win: boolean;
  at: Date;
}
interface RunDoc {
  _id: string;
  uid: string;
  hero: HeroId;
  startAt: number;
  done: boolean;
  at: Date;
}

const kstDay = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
const heroArg = z.enum(HERO_IDS as [HeroId, ...HeroId[]]);
const startArg = z.object({ hero: heroArg, sup: z.array(heroArg).max(2).default([]) });
const finishArg = z.object({
  run: z.string().min(1).max(64),
  sec: z.number().int().min(0).max(36_000),
  kills: z.number().int().min(0).max(2_000_000),
  lv: z.number().int().min(1).max(500),
  win: z.boolean(),
  coins: z.number().int().min(0).max(1_000_000),
});

export function registerSurvivor({ gateway, db }: Deps, marble: MarbleMeta) {
  const profiles = db.col<SurvivorProfile>("survivor_profile");
  const ranks = db.col<RankDoc>("survivor_rank");
  const runs = db.col<RunDoc>("survivor_runs");
  const users = db.col("users");
  const lock = new KeyedMutex();

  const member = (ctx: Ctx) => {
    if (!ctx.nick) throw new AppError("MEMBER_ONLY", "회원만 할 수 있어요 (별명을 정해 주세요).", 403);
    return ctx.nick;
  };
  const fresh = (uid: string): SurvivorProfile => ({ _id: uid, gold: 0, ups: {}, games: 0, wins: 0, kills: 0, winDay: "", at: new Date() });
  const read = async (uid: string) => ((await profiles.findOne({ _id: uid } as never)) as SurvivorProfile | null) ?? fresh(uid);
  const save = (p: SurvivorProfile) => profiles.replaceOne({ _id: p._id } as never, { ...p, at: new Date() } as never, { upsert: true });
  const wire = (p: SurvivorProfile) => ({ gold: p.gold, ups: p.ups, games: p.games, wins: p.wins, kills: p.kills, firstWinToday: p.winDay !== kstDay(Date.now()) });

  /** 이 캐릭터를 쓸 수 있나 (기본 4명 + 다이스 타운에서 뽑은 캐릭터) */
  async function owns(uid: string, ids: HeroId[]) {
    const lock = ids.filter((h) => !FREE_HEROES.includes(h));
    if (!lock.length) return true;
    const mp = await marble.profile(uid);
    return lock.every((h) => !!mp.chars[h]);
  }

  gateway.rpc("survivor.profile", async (ctx) => {
    member(ctx);
    const [p, mp] = await Promise.all([read(ctx.uid), marble.profile(ctx.uid)]);
    return { ...wire(p), chars: mp.chars, stars: mp.stars };
  });

  gateway.rpc("survivor.upgrade", async (ctx, raw) => {
    member(ctx);
    const { id } = z.object({ id: z.enum(UPGRADES.map((u) => u.id) as [UpId, ...UpId[]]) }).parse(raw);
    return lock.run(`sv:${ctx.uid}`, async () => {
      const p = await read(ctx.uid);
      const lv = p.ups[id] ?? 0;
      if (lv >= UP[id].max) throw bad("이미 최고 단계예요.");
      const cost = upCost(id, lv);
      if (p.gold < cost) throw bad("코인이 모자라요.");
      p.gold -= cost;
      p.ups[id] = lv + 1;
      await save(p);
      return wire(p);
    });
  });

  gateway.rpc("survivor.start", async (ctx, raw) => {
    member(ctx);
    const { hero, sup } = startArg.parse(raw);
    if (new Set([hero, ...sup]).size !== 1 + sup.length) throw bad("같은 캐릭터를 두 번 데려갈 수 없어요.");
    if (!(await owns(ctx.uid, [hero, ...sup]))) throw forbidden("아직 없는 캐릭터예요. 다이스 타운 뽑기에서 얻을 수 있어요.");
    const id = newId();
    await runs.insertOne({ _id: id, uid: ctx.uid, hero, startAt: Date.now(), done: false, at: new Date() } as never);
    return { run: id };
  });

  gateway.rpc("survivor.finish", async (ctx, raw) => {
    const nick = member(ctx);
    const a = finishArg.parse(raw);
    return lock.run(`sv:${ctx.uid}`, async () => {
      const run = (await runs.findOne({ _id: a.run } as never)) as RunDoc | null;
      if (!run || run.uid !== ctx.uid) throw bad("없는 판이에요.");
      if (run.done) throw bad("이미 끝낸 판이에요.");
      await runs.updateOne({ _id: a.run } as never, { $set: { done: true } } as never);
      const rep: RunReport = { hero: run.hero, sec: a.sec, kills: a.kills, lv: a.lv, win: a.win, coins: a.coins };
      const wall = (Date.now() - run.startAt) / 1000;
      if (!plausible(rep, wall)) {
        console.warn("[survivor] 이상한 기록", ctx.uid, rep, wall);
        throw bad("기록을 확인할 수 없어요.");
      }
      const p = await read(ctx.uid);
      const today = kstDay(Date.now());
      let stars = runStars(rep);
      let first = false;
      if (rep.win && p.winDay !== today) {
        p.winDay = today;
        stars += STAR_FIRST_WIN;
        first = true;
      }
      p.gold += rep.coins;
      p.games++;
      if (rep.win) p.wins++;
      p.kills += rep.kills;
      await save(p);
      if (stars > 0) await marble.addStars(ctx.uid, stars);
      // 랭킹 (최고 점수만)
      const score = runScore(rep);
      const old = (await ranks.findOne({ _id: ctx.uid } as never)) as RankDoc | null;
      let best = false;
      if (!old || score > old.score) {
        best = true;
        await ranks.replaceOne({ _id: ctx.uid } as never, { _id: ctx.uid, uid: ctx.uid, nick, score, hero: rep.hero, sec: rep.sec, kills: rep.kills, lv: rep.lv, win: rep.win, at: new Date() } as never, { upsert: true });
      }
      // 업적 · 일일 미션 통계
      await users
        .updateOne(
          { _id: ctx.uid } as never,
          {
            $inc: { "stats.survivor.games": 1, "stats.survivor.kills": rep.kills, ...(rep.win && { "stats.survivor.wins": 1, [`stats.survivor.heroWins.${rep.hero}`]: 1 }) },
            $max: { "stats.survivor.bestSec": rep.sec, "stats.survivor.bestLv": rep.lv },
          } as never
        )
        .catch((e) => console.warn("[survivor] 기록 저장 실패", e));
      const rank = (await ranks.countDocuments({ score: { $gt: Math.max(score, old?.score ?? 0) } } as never)) + 1;
      return { stars, first, gold: rep.coins, profile: wire(p), best, rank };
    });
  });

  gateway.rpc("survivor.rank", async (_ctx, raw) => {
    const { limit } = z.object({ limit: z.number().int().min(1).max(100).default(50) }).parse(raw ?? {});
    const docs = (await ranks.find({}).sort({ score: -1, at: 1 }).limit(limit).toArray()) as unknown as RankDoc[];
    const av = new Map<string, string>();
    if (docs.length) {
      const us = await users
        .find({ _id: { $in: docs.map((d) => d.uid) } } as never)
        .project({ "avatar.at": 1, photo: 1 })
        .toArray();
      for (const u of us) {
        const url = pictureOf(String(u._id), u as { avatar?: { at?: number }; photo?: string | null });
        if (url) av.set(String(u._id), url);
      }
    }
    return docs.map((d) => ({ nick: d.nick, avatar: av.get(d.uid) ?? null, hero: d.hero, sec: d.sec, kills: d.kills, lv: d.lv, win: d.win, at: d.at.getTime() }));
  });

  return {};
}
