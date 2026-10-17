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
import { FREE_HEROES, HERO_IDS, MAX_DEPTH, STAGES, STAGE_IDS, type HeroId, type StageId } from "../../../web/src/lib/survivor/data";
import { STAR_FIRST_WIN, UPGRADES, UP, plausible, runCoins, runScore, runStars, upCost, type RunReport, type UpId, type Ups } from "../../../web/src/lib/survivor/progress";
import { QUEST, Q_KEYS, newlyDone, type QuestTotals, type RunQ } from "../../../web/src/lib/survivor/quests";
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
  /** 깬 퀘스트 */
  quests: string[];
  /** 클리어한 가장 깊은 밤 (-1 = 아직) — 잠든 골목 */
  depth: number;
  /** 다른 맵의 가장 깊은 밤 */
  depths: Partial<Record<StageId, number>>;
  /** 누적 (퀘스트) */
  tot: { trials: number; shrines: number; chests: number };
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
  depth: number;
  ot: number;
  /** 맵 (예전 문서는 없음 = 잠든 골목) */
  stage?: StageId;
  at: Date;
}
interface RunDoc {
  _id: string;
  uid: string;
  hero: HeroId;
  depth: number;
  stage?: StageId;
  startAt: number;
  done: boolean;
  at: Date;
}

const kstDay = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
const heroArg = z.enum(HERO_IDS as [HeroId, ...HeroId[]]);
const stageArg = z.enum(STAGE_IDS as [StageId, ...StageId[]]).default("town");
const startArg = z.object({ hero: heroArg, sup: z.array(heroArg).max(2).default([]), depth: z.number().int().min(0).max(MAX_DEPTH).default(0), stage: stageArg });
/** 맵마다 랭킹 문서 (잠든 골목은 예전처럼 uid 그대로) */
const rankId = (uid: string, st: StageId) => (st === "town" ? uid : `${uid}:${st}`);
const rankQuery = (st: StageId) => (st === "town" ? { stage: { $nin: STAGE_IDS.filter((x) => x !== "town") } } : { stage: st });
const qArg = z.object(Object.fromEntries(Q_KEYS.map((k) => [k, z.number().int().min(0).max(1_000_000).default(0)])) as Record<keyof RunQ, z.ZodDefault<z.ZodNumber>>);
const finishArg = z.object({
  run: z.string().min(1).max(64),
  sec: z.number().int().min(0).max(36_000),
  kills: z.number().int().min(0).max(2_000_000),
  lv: z.number().int().min(1).max(500),
  win: z.boolean(),
  ot: z.number().int().min(0).max(36_000).default(0),
  q: qArg,
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
  const fresh = (uid: string): SurvivorProfile => ({ _id: uid, gold: 0, ups: {}, games: 0, wins: 0, kills: 0, winDay: "", quests: [], depth: -1, depths: {}, tot: { trials: 0, shrines: 0, chests: 0 }, at: new Date() });
  const read = async (uid: string) => {
    const d = (await profiles.findOne({ _id: uid } as never)) as SurvivorProfile | null;
    // 예전 문서에 없는 칸 채움
    return d ? { ...fresh(uid), ...d, depths: { ...d.depths }, tot: { ...fresh(uid).tot, ...d.tot } } : fresh(uid);
  };
  const save = (p: SurvivorProfile) => profiles.replaceOne({ _id: p._id } as never, { ...p, at: new Date() } as never, { upsert: true });
  const depthOf = (p: SurvivorProfile, st: StageId) => (st === "town" ? p.depth : (p.depths[st] ?? -1));
  const depthsOf = (p: SurvivorProfile) => Object.fromEntries(STAGE_IDS.map((st) => [st, depthOf(p, st)])) as Record<StageId, number>;
  const totals = (p: SurvivorProfile): QuestTotals => ({ games: p.games, wins: p.wins, kills: p.kills, trials: p.tot.trials, shrines: p.tot.shrines, chests: p.tot.chests, depth: p.depth });
  const wire = (p: SurvivorProfile) => ({ gold: p.gold, ups: p.ups, games: p.games, wins: p.wins, kills: p.kills, firstWinToday: p.winDay !== kstDay(Date.now()), quests: p.quests, depth: p.depth, depths: depthsOf(p), tot: totals(p) });

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
    return { ...wire(p), chars: mp.chars, stars: mp.stars, tickets: mp.tickets.char, pity: mp.pity };
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
    const { hero, sup, depth, stage } = startArg.parse(raw);
    if (new Set([hero, ...sup]).size !== 1 + sup.length) throw bad("같은 캐릭터를 두 번 데려갈 수 없어요.");
    if (!(await owns(ctx.uid, [hero, ...sup]))) throw forbidden("아직 없는 캐릭터예요. 다이스 타운 뽑기에서 얻을 수 있어요.");
    const p = await read(ctx.uid);
    const need = STAGES[stage].need;
    if (need && depthOf(p, need) < 0) throw bad(`${STAGES[need].name}을(를) 먼저 클리어해야 열려요.`);
    if (depth > depthOf(p, stage) + 1) throw bad("아직 열리지 않은 깊이예요.");
    const id = newId();
    await runs.insertOne({ _id: id, uid: ctx.uid, hero, depth, stage, startAt: Date.now(), done: false, at: new Date() } as never);
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
      const q = a.q as RunQ;
      const stage: StageId = run.stage ?? "town";
      const rep: RunReport = { hero: run.hero, sec: a.sec, kills: a.kills, lv: a.lv, win: a.win, depth: run.depth ?? 0, ot: a.ot, q, stage };
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
      const gold = runCoins(rep);
      p.gold += gold;
      p.games++;
      if (rep.win) p.wins++;
      p.kills += rep.kills;
      p.tot.trials += q.trials;
      p.tot.shrines += q.shrines;
      p.tot.chests += q.chests;
      if (rep.win && rep.depth > depthOf(p, stage)) {
        if (stage === "town") p.depth = rep.depth;
        else p.depths[stage] = rep.depth;
      }
      // 퀘스트
      const quests = newlyDone(p.quests, { hero: rep.hero, sec: rep.sec, kills: rep.kills, lv: rep.lv, win: rep.win, depth: rep.depth, q, stage }, totals(p));
      p.quests.push(...quests);
      const qStars = quests.reduce((s, id) => s + (QUEST[id].reward.k === "stars" ? (QUEST[id].reward as { n: number }).n : 0), 0);
      await save(p);
      if (stars + qStars > 0) await marble.addStars(ctx.uid, stars + qStars);
      // 랭킹 (최고 점수만)
      const score = runScore(rep);
      const rid = rankId(ctx.uid, stage);
      const old = (await ranks.findOne({ _id: rid } as never)) as RankDoc | null;
      let best = false;
      if (!old || score > old.score) {
        best = true;
        await ranks.replaceOne({ _id: rid } as never, { _id: rid, uid: ctx.uid, nick, score, hero: rep.hero, sec: rep.sec, kills: rep.kills, lv: rep.lv, win: rep.win, depth: rep.depth, ot: rep.ot, stage, at: new Date() } as never, { upsert: true });
      }
      // 업적 · 일일 미션 통계
      await users
        .updateOne(
          { _id: ctx.uid } as never,
          {
            $inc: { "stats.survivor.games": 1, "stats.survivor.kills": rep.kills, ...(rep.win && { "stats.survivor.wins": 1, [`stats.survivor.heroWins.${rep.hero}`]: 1, [`stats.survivor.stageWins.${stage}`]: 1 }) },
            $max: { "stats.survivor.bestSec": rep.sec, "stats.survivor.bestLv": rep.lv },
          } as never
        )
        .catch((e) => console.warn("[survivor] 기록 저장 실패", e));
      const rank = (await ranks.countDocuments({ ...rankQuery(stage), score: { $gt: Math.max(score, old?.score ?? 0) } } as never)) + 1;
      return { stars, first, gold, profile: wire(p), best, rank, quests, qStars };
    });
  });

  gateway.rpc("survivor.rank", async (_ctx, raw) => {
    const { limit, stage } = z.object({ limit: z.number().int().min(1).max(100).default(50), stage: stageArg }).parse(raw ?? {});
    const docs = (await ranks.find(rankQuery(stage) as never).sort({ score: -1, at: 1 }).limit(limit).toArray()) as unknown as RankDoc[];
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
    return docs.map((d) => ({ stage: d.stage ?? "town", nick: d.nick, avatar: av.get(d.uid) ?? null, hero: d.hero, sec: d.sec, kills: d.kills, lv: d.lv, win: d.win, depth: d.depth ?? 0, ot: d.ot ?? 0, at: d.at.getTime() }));
  });

  return {};
}
