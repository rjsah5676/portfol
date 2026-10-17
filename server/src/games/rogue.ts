/*
 * PIXEL RESET STORY — 픽셀 리셋 스토리 (PIXEL FIGHT 외전 로그라이크) — 판은 브라우저(public/rogue, iframe)가 돌리고, 서버는 시작/끝 · 랭킹 · 업적 통계만.
 *  rogue.start  → 판 번호 (시작 시각 기록, 회원만)
 *  rogue.finish → 기록 확인(plausible) → 랭킹(최고 점수만) · 업적 통계(stats.rogue) → 이번 판으로 새로 채운 업적 이름
 *  rogue.rank
 *  rogue.play   → 플레이 기록 (밸런스 분석용 · 회원/손님 모두 · 90일) → rogue_plays, 관리자 화면 「게임 플레이 기록」에서 봄
 * 월드 해금 · 도감 · 이어하기 저장은 아직 브라우저(localStorage)에만.
 */
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad } from "../errors";
import { newId } from "../ids";
import { KeyedMutex } from "../mutex";
import type { Ctx } from "../realtime/gateway";
import { pictureOf } from "../users";
import { metricsOf } from "../achievements";
import { achievementsOf } from "../../../web/src/lib/points";
import { ROGUE_CHARS, ROGUE_FLOORS, SPEED_SEC, plausible, rogueScore, type RogueReport } from "../../../web/src/lib/rogue/rules";

interface RankDoc {
  _id: string;
  uid: string;
  nick: string;
  score: number;
  floor: number;
  endFloor: number;
  win: boolean;
  sec: number;
  kills: number;
  build: string[];
  seed: number;
  char?: string;
  at: Date;
}
interface RunDoc {
  _id: string;
  uid: string;
  startAt: number;
  done: boolean;
  at: Date;
}

const int = (max: number) => z.number().int().min(0).max(max);
const repArg = z.object({
  floor: z.number().int().min(1).max(ROGUE_FLOORS),
  endFloor: z.number().int().min(2).max(ROGUE_FLOORS),
  win: z.boolean(),
  sec: int(360_000),
  kills: int(2_000_000),
  bosses: int(ROGUE_FLOORS),
  items: int(200),
  build: z.array(z.string().min(1).max(24)).max(60),
  secret: z.boolean(),
  noHit: int(ROGUE_FLOORS),
  cheats: int(100),
  codex: int(500),
  ch: int(4),
  seed: z.number().int().min(0).max(2 ** 32),
  // 예전 화면이 보내는 기록엔 없음 → 기본값
  char: z.enum(ROGUE_CHARS).default("kai"),
  elites: int(100_000).default(0),
  specials: int(100).default(0),
  arcade: int(100_000).default(0),
  unlocks: int(200).default(0),
});
const finishArg = z.object({ run: z.string().min(1).max(64), rep: repArg });

/** 플레이 기록 보관 기간 (Mongo TTL) */
export const ROGUE_PLAYS_TTL_DAYS = 90;
const str = (n: number) => z.string().max(n);
const num = z.number().finite();
/** 게임(pdBuild)이 보내는 한 판 기록 — 길이 · 개수에 상한을 둬서 이상한 값은 통째로 버림 */
export const playRec = z.object({
  id: str(40),
  ver: str(24),
  at: str(40),
  char: str(12),
  seed: z.number().int().min(0).max(2 ** 32),
  result: str(12),
  floor: z.number().int().min(1).max(ROGUE_FLOORS),
  sec: int(360_000),
  kills: int(2_000_000),
  elites: int(100_000).default(0),
  dev: z.boolean().default(false),
  resumed: int(1000).default(0),
  touch: z.boolean().default(false),
  items: z.array(z.object({ id: str(32), f: int(20), t: int(400_000), src: str(16).nullish() })).max(150).default([]),
  active: str(32).nullish(),
  stats: z.record(str(16), num).default({}),
  rooms: z.array(z.object({ f: int(20), type: str(16), in: int(400_000), clear: num.nullable(), dmg: num })).max(300).default([]),
  hits: z.array(z.object({ f: int(20), room: str(16), t: num, dmg: num, hp: num, by: str(48) })).max(400).default([]),
  econ: z.record(str(3), z.record(str(10), num)).default({}),
  res: z.record(str(10), num).default({}),
  bossKills: z.array(z.object({ floor: int(20), ms: num })).max(20).default([]),
  bought: z.array(str(32)).max(200).default([]),
  patches: z.array(str(32)).max(200).default([]),
  cards: z.array(str(32)).max(200).default([]),
  actives: z.array(str(40)).max(500).default([]),
  cheatDeals: int(100).default(0),
  secretFound: z.boolean().default(false),
  special: int(1000).default(0),
  arcade: int(100_000).default(0),
  unlockChar: str(12).nullish(),
  secrets: int(500).default(0),
});
export type RoguePlayRec = z.infer<typeof playRec>;
export interface RoguePlayDoc extends RoguePlayRec {
  _id: string;
  /** 서버가 받은 시각 */
  recvAt: Date;
  uid: string | null;
  nick: string | null;
  guest: boolean;
}

export function registerRogue({ gateway, db }: Deps) {
  const ranks = db.col<RankDoc>("rogue_rank");
  const runs = db.col<RunDoc>("rogue_runs");
  const users = db.col("users");
  const lock = new KeyedMutex();
  const plays = db.col<RoguePlayDoc>("rogue_plays");
  void plays.createIndex({ recvAt: 1 }, { expireAfterSeconds: ROGUE_PLAYS_TTL_DAYS * 86400 }).catch(() => {});
  const lastPlay = new Map<string, number>();

  const member = (ctx: Ctx) => {
    if (!ctx.nick) throw new AppError("MEMBER_ONLY", "회원만 기록돼요 (별명을 정해 주세요).", 403);
    return ctx.nick;
  };

  gateway.rpc("rogue.start", async (ctx) => {
    member(ctx);
    const id = newId();
    await runs.insertOne({ _id: id, uid: ctx.uid, startAt: Date.now(), done: false, at: new Date() } as never);
    return { run: id };
  });

  gateway.rpc("rogue.finish", async (ctx, raw) => {
    const nick = member(ctx);
    const { run: runId, rep: a } = finishArg.parse(raw);
    const rep = a as RogueReport;
    return lock.run(`rg:${ctx.uid}`, async () => {
      const run = (await runs.findOne({ _id: runId } as never)) as RunDoc | null;
      if (!run || run.uid !== ctx.uid) throw bad("없는 판이에요.");
      if (run.done) throw bad("이미 끝낸 판이에요.");
      await runs.updateOne({ _id: runId } as never, { $set: { done: true } } as never);
      const wall = (Date.now() - run.startAt) / 1000;
      if (!plausible(rep, wall)) {
        console.warn("[rogue] 이상한 기록", ctx.uid, rep, wall);
        throw bad("기록을 확인할 수 없어요.");
      }

      // 업적 통계 (이번 판으로 새로 채운 업적을 알려 주려고 앞뒤 숫자를 잼)
      const before = await metricsOf(db, ctx.uid, "rogue");
      await users.updateOne(
        { _id: ctx.uid } as never,
        {
          $inc: {
            "stats.rogue.runs": 1,
            "stats.rogue.kills": rep.kills,
            "stats.rogue.bosses": rep.bosses,
            "stats.rogue.noHit": rep.noHit,
            "stats.rogue.cheats": rep.cheats,
            "stats.rogue.elites": rep.elites,
            "stats.rogue.specials": rep.specials,
            "stats.rogue.arcade": rep.arcade,
            ...(rep.char === "igna" && { "stats.rogue.ignaRuns": 1 }),
            ...(rep.char === "igna" && rep.win && { "stats.rogue.ignaWins": 1 }),
            ...(rep.char === "ivan" && { "stats.rogue.ivanRuns": 1 }),
            ...(rep.char === "lily" && { "stats.rogue.lilyRuns": 1 }),
            ...(rep.char === "dice" && { "stats.rogue.diceRuns": 1 }),
            ...(rep.win && rep.floor === ROGUE_FLOORS && { [`stats.rogue.full_${rep.char}`]: 1 }),
            ...(rep.secret && { "stats.rogue.secrets": 1 }),
            ...(rep.win && { "stats.rogue.wins": 1 }),
            ...(rep.win && rep.floor === ROGUE_FLOORS && { "stats.rogue.full": 1 }),
            ...(rep.win && rep.floor >= 4 && rep.sec <= SPEED_SEC && { "stats.rogue.speed": 1 }),
          },
          $max: { "stats.rogue.floor": rep.floor, "stats.rogue.ch": rep.ch, "stats.rogue.items": rep.items, "stats.rogue.codex": rep.codex, "stats.rogue.unlocks": rep.unlocks },
        } as never
      );
      const after = await metricsOf(db, ctx.uid, "rogue");
      const ach = achievementsOf("rogue")
        .filter((x) => !x.repeat && (before[x.metric] ?? 0) < x.goal && (after[x.metric] ?? 0) >= x.goal)
        .map((x) => x.title);

      // 랭킹 (최고 점수만)
      const score = rogueScore(rep);
      const old = (await ranks.findOne({ _id: ctx.uid } as never)) as RankDoc | null;
      let best = false;
      if (!old || score > old.score) {
        best = true;
        await ranks.replaceOne(
          { _id: ctx.uid } as never,
          { _id: ctx.uid, uid: ctx.uid, nick, score, floor: rep.floor, endFloor: rep.endFloor, win: rep.win, sec: rep.sec, kills: rep.kills, build: rep.build, seed: rep.seed, char: rep.char, at: new Date() } as never,
          { upsert: true }
        );
      }
      const rank = (await ranks.countDocuments({ score: { $gt: Math.max(score, old?.score ?? 0) } } as never)) + 1;
      return { best, rank, ach };
    });
  });

  // 플레이 기록: 회원 · 손님(익명 로그인) 모두 받음. 저장 실패해도 게임엔 영향 없음
  gateway.rpc("rogue.play", async (ctx, raw) => {
    const p = z.object({ rec: playRec }).safeParse(raw);
    if (!p.success) return { ok: false };
    const uid = ctx.user?.uid ?? null;
    const key = uid ?? ctx.socket.id;
    const now = Date.now();
    if (now - (lastPlay.get(key) ?? 0) < 4000) return { ok: false }; // 연타 · 도배 막기
    if (lastPlay.size > 20_000) lastPlay.clear();
    lastPlay.set(key, now);
    const doc: RoguePlayDoc = { ...p.data.rec, _id: newId(), recvAt: new Date(), uid, nick: uid ? ctx.nick : null, guest: !uid || !!ctx.user?.anonymous || !ctx.nick };
    void plays.insertOne(doc as never).catch((e) => console.warn("[rogue] 플레이 기록 저장 실패", e));
    return { ok: true };
  });

  gateway.rpc("rogue.rank", async (_ctx, raw) => {
    const { limit } = z.object({ limit: z.number().int().min(1).max(100).default(50) }).parse(raw ?? {});
    const docs = (await ranks.find({} as never).sort({ score: -1, at: 1 }).limit(limit).toArray()) as unknown as RankDoc[];
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
    return docs.map((d) => ({ nick: d.nick, avatar: av.get(d.uid) ?? null, floor: d.floor, endFloor: d.endFloor, win: d.win, sec: d.sec, kills: d.kills, build: d.build ?? [], char: d.char ?? "kai", at: d.at.getTime() }));
  });

  return {};
}
