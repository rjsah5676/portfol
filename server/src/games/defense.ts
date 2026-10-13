import { randomInt } from "node:crypto";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import type { Database } from "../db";
import type { Deps } from "../deps";
import { AppError, bad, forbidden, notFound } from "../errors";
import { newId } from "../ids";
import { pictureOf } from "../users";
import type { Ctx } from "../realtime/gateway";
import { BALANCE_VER, TPS } from "../../../web/src/lib/defense/balance";
import { HASH_TICKS, MAX_LOG, MAX_SPEED, MAX_TICKS, TICKS_PER_TURN, TURN_MS, scoreOf, validLog, type LogEntry } from "../../../web/src/lib/defense/replay";
import { isCmd, type Cmd, type Result } from "../../../web/src/lib/defense/sim";
import { seasonOf, seasonScore, weekOf, type Loadout, type RunMode } from "../../../web/src/lib/defense/progress";
import type { VerifyJob, VerifyOut } from "./defenseVerify.worker";
import { createDefenseMeta, weeklyLoadout, weeklySeed } from "./defenseMeta";

/*
 * 픽셀 글리치 디펜스 (PIXEL FIGHT 외전 랜덤 디펜스) — 랭킹 · 멀티
 *
 * 게임 엔진은 web/src/lib/defense (결정론 시뮬) 를 그대로 씀. 서버는 시뮬을 직접 돌리지 않고:
 *
 *  랭킹 (회원만)
 *   defense.start { mode }   → { run, seed, ver, mode, loadout }  판을 시작할 때. 시드 · 로드아웃은 서버가 정함
 *       mode "season": 무작위 시드 + 내 영구 성장(유닛 레벨 · 연구 · 유물 · 오염 단계) — 시즌 랭킹 (오염 단계 가중 점수)
 *       mode "weekly": 이번 주 모두 같은 시드 + 같은 유물 3개, 강화 · 연구 없음 — 주간 도전 랭킹 (주가 끝나면 순위 GP)
 *   defense.finish { run, log } → 명령 기록을 작업 스레드에서 처음부터 다시 돌려(defenseVerify.worker) 결과를 직접 계산
 *                              → 점수를 꾸며 보낼 수 없음. 걸린 시간도 봄 (최대 배속 MAX_SPEED 로도 그만큼은 걸려야)
 *                              → 검증된 판만 보상 · 미션 · 패스 경험치 (defenseMeta.onRun)
 *   defense.rank { board, limit } → 시즌(이번 밸런스 버전 · 이번 시즌) 또는 이번 주 도전 순위
 *   defense.me { board }      → 내 최고 기록 · 순위
 *
 *  성장 (defenseMeta.ts): defense.profile · unit.up/upAll/down · res.buy/level · relic.buy/level · box.buy/open (card · relic)
 *                          · bench.buy · fslot.buy · trans (초월 소환) · gp.relic · gp.cards · load · theme
 *                        · quest.claim · pass.claim · pass.buy(GP) · cores.buy(GP)
 *
 *  멀티 (락스텝 — 서버는 명령만 모아 뿌림)
 *   방: lobby → playing → result. 최대 4명, 각자 자기 보드(라인)를 막음 — 지금은 서로 영향 없음(생존 경쟁)
 *   playing: TURN_MS 마다 "turn" { n, c: [[보드, 명령]…] } 을 뿌림. 한 턴 = TICKS_PER_TURN tick.
 *            클라이언트는 턴 n 을 받아야 tick n×3 ~ n×3+2 를 돌릴 수 있음 → 모두 같은 시뮬
 *   다시 들어오면(새로고침) 방 구독 첫 데이터에 지금까지의 기록이 있어 처음부터 빨리 돌려 따라잡음
 *   끝: 모든 보드가 끝났다고 알리면 서버가 기록을 다시 돌려 순위를 정해 "result" 로 뿌림
 *   (나중에 "남 돕기"는 명령 종류만 추가 — 같은 기록 · 같은 시뮬이라 서버 구조는 그대로)
 *
 *   어긋남 감시: 각자 HASH_TICKS 마다 hashGame 을 defense.hash 로 보냄 → 같은 tick 의 값이 보드마다 다르면
 *            로그를 남기고(console.warn) 방에 "desync" 를 뿌림 (관리자 방 목록에도 횟수)
 *
 *  채널: defense.lobby (방 목록) · defense.room { id } (방 상태 "room" · "start" · "turn" · "result" · "desync")
 *  rpc : defense.create · join · mine(새로고침 뒤 내 판 찾기) · leave · ready · begin · cmd · over · hash
 */

const RUN_TTL_MS = 4 * 3600_000;
const RUNS_PER_HOUR = 40;
const MAX_PLAYERS = 4;
const MAX_ROOMS = 100;
/** 판 중 연결이 끊긴 사람을 기다리는 시간 — 다른 사람이 다 끝났는데 이만큼 안 돌아오면 순위를 냄 */
const GONE_MS = 60_000;

interface RunDoc {
  uid: string;
  seed: number;
  ver: string;
  at: Date;
  used: boolean;
  mode?: "season" | "weekly";
  /** 이 판에 들고 간 로드아웃 (시작 때 고정) */
  lo?: Loadout;
  /** 순위표 키 (시즌 · 주) */
  board?: string;
}
export interface DefenseRankDoc {
  /** 순위표 키: 시즌 `${BALANCE_VER}:s${시즌}` · 주간 `w${주}` (옛 기록은 BALANCE_VER) */
  ver: string;
  glitch?: number;
  uid: string;
  nick: string;
  score: number;
  win: boolean;
  wave: number;
  tick: number;
  kills: number;
  tops: string[];
  at: Date;
}

/* ───────────── 검증 작업 스레드 ───────────── */

function createVerifier() {
  const dev = import.meta.url.endsWith(".ts");
  const waiting = new Map<number, { res: (v: VerifyOut) => void; rej: (e: Error) => void; timer: NodeJS.Timeout }>();
  let worker: Worker | null = null;
  let seq = 0;
  const settle = (m: VerifyOut | { id: number; error: string }) => {
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    clearTimeout(w.timer);
    if ("error" in m) w.rej(new Error(m.error));
    else w.res(m);
  };
  const spawn = () => {
    const w = new Worker(new URL("./defenseVerify.worker.js", import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 128 } });
    w.unref();
    w.on("message", settle);
    const dead = (why: unknown) => {
      if (worker !== w) return;
      worker = null;
      for (const [id] of waiting) settle({ id, error: `작업 스레드 종료: ${String(why)}` });
    };
    w.on("error", dead);
    w.on("exit", (c) => dead(`exit ${c}`));
    worker = w;
  };
  return {
    run(job: Omit<VerifyJob, "id">): Promise<VerifyOut> {
      const id = ++seq;
      if (dev) return import("./defenseVerify.worker").then((m) => m.verifyRun({ ...job, id }));
      if (!worker) spawn();
      return new Promise((res, rej) => {
        const timer = setTimeout(() => settle({ id, error: "검증 시간 초과" }), 60_000);
        waiting.set(id, { res, rej, timer });
        worker!.postMessage({ ...job, id });
      });
    },
    close() {
      void worker?.terminate();
      worker = null;
    },
  };
}

/* ───────────── 랭킹 ───────────── */

async function avatarsOf(db: Database, uids: string[]) {
  const out = new Map<string, string>();
  if (!uids.length) return out;
  const docs = await db
    .col("users")
    .find({ _id: { $in: [...new Set(uids)] } })
    .project({ "avatar.at": 1, photo: 1 })
    .toArray();
  for (const d of docs) {
    const url = pictureOf(String(d._id), d as { avatar?: { at?: number }; photo?: string | null });
    if (url) out.set(String(d._id), url);
  }
  return out;
}

const rankRow = (d: DefenseRankDoc & { _id: string }, avatar: string | null) => ({
  nick: d.nick,
  avatar,
  score: d.score,
  win: d.win,
  wave: d.wave,
  sec: Math.round(d.tick / TPS),
  kills: d.kills,
  tops: d.tops,
  glitch: d.glitch ?? 0,
  at: d.at.getTime(),
});
export type DefenseRankRow = ReturnType<typeof rankRow>;

const member = (ctx: Ctx) => {
  void ctx.uid;
  if (!ctx.nick) throw new AppError("MEMBER_ONLY", "회원만 할 수 있어요 (별명을 정해 주세요).", 403);
  return ctx.nick;
};

/* ───────────── 멀티 방 ───────────── */

interface MPlayer {
  uid: string;
  nick: string;
  ready: boolean;
  /** 끝났다고 알린 결과 (표시용 — 순위는 서버가 다시 돌려서) */
  over: { win: boolean; wave: number } | null;
  left: boolean;
  /** 판 중 연결이 끊긴 시각 (다시 들어오면 0) — 오래 안 돌아오면 그 보드는 끝난 셈 치고 순위를 냄 */
  gone?: number;
}
interface Room {
  id: string;
  name: string;
  hostUid: string;
  phase: "lobby" | "playing" | "result";
  players: MPlayer[];
  seed: number;
  turn: number;
  log: LogEntry[];
  pending: [number, Cmd][];
  timer: NodeJS.Timeout | null;
  createdAt: number;
  standings: { nick: string; win: boolean; wave: number; sec: number; kills: number; tops: string[] }[] | null;
  /** 어긋남 감시: tick → (보드 → 해시) */
  hashes: Map<number, Map<number, number>>;
  /** 어긋난 tick 기록 (최근 20개) */
  desync: { tick: number; seats: Record<number, number> }[];
  /** 자리마다 들고 간 로드아웃 (시작 때 고정) */
  loadouts: Loadout[];
}

const LOBBY = "defense:lobby";
const roomKey = (id: string) => `defense:room:${id}`;

export function registerDefense({ gateway, db, points }: Deps) {
  const runs = db.col<RunDoc>("defense_runs");
  const ranks = db.col<DefenseRankDoc>("defense_rank");
  void ranks.createIndex({ ver: 1, score: -1 }).catch(() => {});
  void runs.createIndex({ at: 1 }, { expireAfterSeconds: 24 * 3600 }).catch(() => {});
  const verifier = createVerifier();
  const meta = createDefenseMeta(db, points);
  const seasonKey = () => `${BALANCE_VER}:s${seasonOf(Date.now())}`;
  const boardKey = (b: unknown) => (b === "weekly" ? meta.weeklyKey(weekOf(Date.now())) : seasonKey());
  const rooms = new Map<string, Room>();

  /* ── 랭킹 ── */

  gateway.rpc("defense.start", async (ctx, raw) => {
    member(ctx);
    const uid = ctx.uid;
    const { mode } = z.object({ mode: z.enum(["season", "weekly"]).default("season") }).parse(raw ?? {});
    const recent = await runs.countDocuments({ uid, at: { $gt: new Date(Date.now() - 3600_000) } });
    if (recent >= RUNS_PER_HOUR) throw new AppError("RATE_LIMITED", "잠시 후에 다시 시작해 주세요.", 429);
    const _id = newId();
    const week = weekOf(Date.now());
    const seed = mode === "weekly" ? weeklySeed(week) : randomInt(1, 2 ** 31 - 1);
    const lo = mode === "weekly" ? weeklyLoadout(week) : await meta.loadoutOf(uid);
    const board = mode === "weekly" ? meta.weeklyKey(week) : seasonKey();
    await runs.insertOne({ _id, uid, seed, ver: BALANCE_VER, at: new Date(), used: false, mode, lo, board });
    return { run: _id, seed, ver: BALANCE_VER, mode, loadout: lo };
  });

  gateway.rpc("defense.finish", async (ctx, raw) => {
    const nick = member(ctx);
    const uid = ctx.uid;
    const { run, log } = z.object({ run: z.string().max(64), log: z.unknown() }).parse(raw);
    if (!validLog(log, 1)) throw bad("기록 모양이 잘못됐어요.");
    const doc = await runs.findOneAndUpdate({ _id: run, uid, used: false }, { $set: { used: true } });
    if (!doc) throw new AppError("RANK_REJECTED", "이미 끝났거나 없는 판이에요.", 400);
    if (doc.ver !== BALANCE_VER) throw new AppError("RANK_REJECTED", "밸런스가 바뀌어서 이 판은 기록할 수 없어요.", 400);
    if (Date.now() - doc.at.getTime() > RUN_TTL_MS) throw new AppError("RANK_REJECTED", "너무 오래된 판이에요.", 400);
    const mode = doc.mode ?? "season";
    const lo = doc.lo ?? null;
    const out = await verifier.run({ seed: doc.seed, players: 1, log, loadouts: [lo] });
    const res = out.results[0];
    if (!res) throw new AppError("RANK_REJECTED", "끝나지 않은 판은 기록할 수 없어요.", 400);
    const elapsed = (Date.now() - doc.at.getTime()) / 1000;
    if (elapsed + 5 < res.tick / TPS / MAX_SPEED) throw new AppError("RANK_REJECTED", "기록을 확인할 수 없어요.", 400);
    const glitch = mode === "weekly" ? 0 : (lo?.glitch ?? 0);
    const score = mode === "weekly" ? scoreOf(res) : seasonScore(res, glitch);
    const reward = await meta.onRun(uid, mode, res, out.stats[0], glitch).catch((e) => {
      console.warn("[defense] 보상 저장 실패", e);
      return null;
    });
    // 업적용 누적 (끝까지 검증된 판만)
    void db
      .col("users")
      .updateOne(
        { _id: uid },
        { $inc: { "stats.defense.runs": 1, "stats.defense.kills": res.kills ?? 0, ...(res.win && { "stats.defense.wins": 1 }) }, $max: { "stats.defense.wave": res.wave } } as never
      )
      .catch((e) => console.warn("[defense] 기록 저장 실패", e));
    const key = doc.board ?? seasonKey();
    const id = `${key}:${uid}`;
    const prev = await ranks.findOne({ _id: id });
    const best = !prev || prev.score < score;
    if (best)
      await ranks.replaceOne(
        { _id: id },
        { ver: key, uid, nick, score, glitch, win: res.win, wave: res.wave, tick: res.tick, kills: res.kills, tops: out.tops[0], at: new Date() },
        { upsert: true }
      );
    const myScore = best ? score : prev!.score;
    const rank = (await ranks.countDocuments({ ver: key, score: { $gt: myScore } })) + 1;
    return { result: res, score, best, rank, tops: out.tops[0], mode, reward };
  });

  const boardArg = z.object({ board: z.enum(["season", "weekly"]).default("season"), limit: z.number().int().min(1).max(100).default(20) });

  gateway.rpc("defense.rank", async (_ctx, raw) => {
    const { board, limit } = boardArg.parse(raw ?? {});
    const key = boardKey(board);
    const docs = await ranks.find({ ver: key }).sort({ score: -1, at: 1 }).limit(limit).toArray();
    const av = await avatarsOf(db, docs.map((d) => d.uid));
    return { ver: BALANCE_VER, board, key, rows: docs.map((d) => rankRow(d, av.get(d.uid) ?? null)) };
  });

  gateway.rpc("defense.me", async (ctx, raw) => {
    const uid = ctx.uid;
    const key = boardKey(boardArg.parse(raw ?? {}).board);
    const d = await ranks.findOne({ _id: `${key}:${uid}` });
    if (!d) return null;
    const rank = (await ranks.countDocuments({ ver: key, score: { $gt: d.score } })) + 1;
    return { ...rankRow(d, null), rank };
  });

  /* ── 성장 (판 밖) ── */

  const id = z.object({ id: z.string().max(40) });
  gateway.rpc("defense.profile", (ctx) => (member(ctx), meta.profile(ctx.uid)));
  gateway.rpc("defense.unit.up", (ctx, raw) => (member(ctx), meta.unitUp(ctx.uid, id.parse(raw).id)));
  gateway.rpc("defense.unit.upAll", (ctx, raw) => (member(ctx), meta.unitUpAll(ctx.uid, z.object({ id: z.string().max(40).optional() }).parse(raw ?? {}).id)));
  gateway.rpc("defense.unit.down", (ctx, raw) => (member(ctx), meta.unitDown(ctx.uid, id.parse(raw).id)));
  gateway.rpc("defense.res.buy", (ctx, raw) => (member(ctx), meta.resBuy(ctx.uid, id.parse(raw).id)));
  const lvArg = z.object({ id: z.string().max(40), dir: z.union([z.literal(1), z.literal(-1)]) });
  gateway.rpc("defense.res.level", (ctx, raw) => (member(ctx), ((a) => meta.resLevel(ctx.uid, a.id, a.dir))(lvArg.parse(raw))));
  gateway.rpc("defense.relic.level", (ctx, raw) => (member(ctx), ((a) => meta.relicLevel(ctx.uid, a.id, a.dir))(lvArg.parse(raw))));
  gateway.rpc("defense.relic.buy", (ctx, raw) => (member(ctx), meta.relicBuy(ctx.uid, id.parse(raw).id)));
  const boxKind = z.object({ kind: z.enum(["card", "relic"]) });
  gateway.rpc("defense.box.buy", (ctx, raw) => (member(ctx), meta.boxBuy(ctx.uid, boxKind.parse(raw).kind)));
  gateway.rpc("defense.box.open", (ctx, raw) => (member(ctx), meta.boxOpen(ctx.uid, boxKind.parse(raw).kind)));
  gateway.rpc("defense.bench.buy", (ctx) => (member(ctx), meta.benchBuy(ctx.uid)));
  gateway.rpc("defense.fslot.buy", (ctx) => (member(ctx), meta.fslotBuy(ctx.uid)));
  gateway.rpc("defense.trans", (ctx, raw) => (member(ctx), meta.transSummon(ctx.uid, z.object({ pay: z.enum(["cores", "gp"]) }).parse(raw).pay)));
  gateway.rpc("defense.load", (ctx, raw) => (member(ctx), meta.setLoad(ctx.uid, raw)));
  gateway.rpc("defense.theme", (ctx, raw) => (member(ctx), meta.setTheme(ctx.uid, id.parse(raw).id)));
  gateway.rpc("defense.quest.claim", (ctx, raw) => (member(ctx), meta.questClaim(ctx.uid, id.parse(raw).id)));
  gateway.rpc("defense.pass.claim", (ctx) => (member(ctx), meta.passClaim(ctx.uid)));
  gateway.rpc("defense.pass.buy", (ctx) => (member(ctx), meta.passBuy(ctx.uid)));
  gateway.rpc("defense.cores.buy", (ctx) => (member(ctx), meta.coresBuy(ctx.uid)));
  gateway.rpc("defense.gp.relic", (ctx) => (member(ctx), meta.gpRelic(ctx.uid)));
  gateway.rpc("defense.gp.cards", (ctx, raw) => (member(ctx), meta.gpCards(ctx.uid, id.parse(raw).id)));

  /* ── 멀티 ── */

  const lobbyWire = () =>
    [...rooms.values()]
      .filter((r) => r.phase === "lobby")
      .map((r) => ({ id: r.id, name: r.name, count: r.players.length, max: MAX_PLAYERS, createdAt: r.createdAt }));
  const roomWire = (r: Room) => ({
    id: r.id,
    name: r.name,
    host: r.players.find((p) => p.uid === r.hostUid)?.nick ?? "",
    hostUid: r.hostUid,
    phase: r.phase,
    max: MAX_PLAYERS,
    players: r.players.map((p) => ({ uid: p.uid, nick: p.nick, ready: p.ready, over: p.over, left: p.left })),
    standings: r.standings,
  });
  const pushRoom = (r: Room) => {
    gateway.emit(roomKey(r.id), "room", roomWire(r));
    gateway.emit(LOBBY, "list", lobbyWire());
  };
  const closeRoom = (r: Room) => {
    if (r.timer) clearInterval(r.timer);
    rooms.delete(r.id);
    gateway.emit(roomKey(r.id), "room", null);
    gateway.emit(LOBBY, "list", lobbyWire());
  };
  const roomOf = (id: unknown) => {
    const r = rooms.get(String(id));
    if (!r) throw notFound("방이 없어요.");
    return r;
  };
  const seatOf = (r: Room, uid: string) => r.players.findIndex((p) => p.uid === uid);

  async function finalize(r: Room) {
    if (r.timer) clearInterval(r.timer);
    r.timer = null;
    r.phase = "result";
    try {
      const out = await verifier.run({ seed: r.seed, players: r.players.length, log: r.log, loadouts: r.loadouts });
      // 끝까지 한 사람에게 판 보상 (2명 이상이면 멀티 보너스)
      const n = r.players.length;
      r.players.forEach((p, i) => {
        const res = out.results[i];
        if (!res || p.left) return;
        void meta.onRun(p.uid, "multi", res, out.stats[i], r.loadouts[i]?.glitch ?? 0, n).catch((e) => console.warn("[defense] 멀티 보상 저장 실패", e));
      });
      r.standings = r.players
        .map((p, i) => {
          const res: Result | null = out.results[i];
          return {
            nick: p.nick,
            win: !!res?.win,
            wave: res?.wave ?? 0,
            sec: Math.round((res?.tick ?? out.ticks) / TPS),
            kills: res?.kills ?? 0,
            tops: out.tops[i],
            score: res ? scoreOf(res) : 0,
          };
        })
        .sort((a, b) => b.score - a.score)
        .map(({ score: _s, ...x }) => x);
    } catch (e) {
      console.warn("[defense] 멀티 결과 계산 실패", e);
      r.standings = [];
    }
    for (const p of r.players) p.ready = false;
    pushRoom(r);
    gateway.emit(roomKey(r.id), "result", r.standings);
  }

  function tickRoom(r: Room) {
    const t = r.turn * TICKS_PER_TURN;
    const c = r.pending;
    r.pending = [];
    for (const [p, cmd] of c) r.log.push([t, p, cmd]);
    gateway.emit(roomKey(r.id), "turn", { n: r.turn, c });
    r.turn++;
    const now = Date.now();
    const allDone = r.players.every((p) => p.over || p.left || (p.gone && now - p.gone > GONE_MS));
    if (allDone || t > MAX_TICKS) void finalize(r);
  }

  gateway.channel("defense.lobby", { key: () => LOBBY, snapshot: () => lobbyWire() });
  gateway.channel("defense.room", {
    key: (ctx, params) => {
      void ctx.uid;
      const r = roomOf((params as { id?: unknown })?.id);
      return roomKey(r.id);
    },
    snapshot: (_ctx, _key, params) => {
      const r = roomOf((params as { id?: unknown }).id);
      return {
        room: roomWire(r),
        // 진행 중이면 지금까지의 기록 (다시 들어온 사람이 따라잡게)
        game: r.phase === "playing" ? { seed: r.seed, turn: r.turn, log: r.log, loadouts: r.loadouts } : null,
      };
    },
  });

  gateway.rpc("defense.create", (ctx, raw) => {
    const nick = member(ctx);
    const { name } = z.object({ name: z.string().max(20).optional() }).parse(raw ?? {});
    if (rooms.size >= MAX_ROOMS) throw new AppError("FULL", "방이 너무 많아요. 잠시 후에 만들어 주세요.", 429);
    for (const r of rooms.values()) if (r.phase !== "playing" && seatOf(r, ctx.uid) >= 0) leave(r, ctx.uid);
    const r: Room = {
      id: newId(),
      name: name?.trim() || `${nick}의 방`,
      hostUid: ctx.uid,
      phase: "lobby",
      players: [{ uid: ctx.uid, nick, ready: false, over: null, left: false }],
      seed: 0,
      turn: 0,
      log: [],
      pending: [],
      timer: null,
      createdAt: Date.now(),
      standings: null,
      hashes: new Map(),
      desync: [],
      loadouts: [],
    };
    rooms.set(r.id, r);
    pushRoom(r);
    return { id: r.id };
  });

  gateway.rpc("defense.join", (ctx, raw) => {
    const nick = member(ctx);
    const r = roomOf((raw as { id?: unknown })?.id);
    const seat = seatOf(r, ctx.uid);
    if (seat >= 0) {
      // 판 중에 나갔다(새로고침 · 나가기) 다시 들어옴 → 자리 그대로 이어서
      const pl = r.players[seat];
      if (pl.left || pl.gone) {
        pl.left = false;
        pl.gone = 0;
        pushRoom(r);
      }
      return { id: r.id };
    }
    if (r.phase === "playing") throw forbidden("이미 시작한 방이에요.");
    if (r.players.length >= MAX_PLAYERS) throw forbidden("방이 꽉 찼어요.");
    if (r.phase === "result") r.phase = "lobby";
    r.players.push({ uid: ctx.uid, nick, ready: false, over: null, left: false });
    pushRoom(r);
    return { id: r.id };
  });

  function leave(r: Room, uid: string) {
    const i = seatOf(r, uid);
    if (i < 0) return;
    if (r.phase === "playing") {
      // 판 중엔 자리를 그대로 둠 (보드 번호가 바뀌면 안 됨) — 그 보드는 명령 없이 계속 돌다 끝남
      r.players[i].left = true;
      if (r.players.every((p) => p.left)) return closeRoom(r);
    } else {
      r.players.splice(i, 1);
      if (!r.players.length) return closeRoom(r);
    }
    if (r.hostUid === uid) r.hostUid = (r.players.find((p) => !p.left) ?? r.players[0]).uid;
    pushRoom(r);
  }

  // 내가 자리를 가진 진행 중인 방 (새로고침 뒤 돌아가기)
  gateway.rpc("defense.mine", (ctx) => {
    member(ctx);
    for (const r of rooms.values()) if (r.phase === "playing" && seatOf(r, ctx.uid) >= 0) return { id: r.id, name: r.name };
    return null;
  });

  gateway.rpc("defense.leave", (ctx, raw) => {
    const r = rooms.get(String((raw as { id?: unknown })?.id));
    if (r) leave(r, ctx.uid);
    return null;
  });
  gateway.onDisconnect((ctx) => {
    const uid = ctx.user?.uid;
    if (!uid) return;
    // 판 중이 아니면 바로 나감 (판 중엔 다시 들어올 수 있게 자리 유지 — 끊긴 시각만 적어 둠)
    for (const r of [...rooms.values()]) {
      if (r.phase !== "playing") leave(r, uid);
      else {
        const i = seatOf(r, uid);
        if (i >= 0 && !r.players[i].over) r.players[i].gone = Date.now();
      }
    }
  });

  gateway.rpc("defense.ready", (ctx, raw) => {
    const { id, ready } = z.object({ id: z.string(), ready: z.boolean() }).parse(raw);
    const r = roomOf(id);
    const i = seatOf(r, ctx.uid);
    if (i < 0 || r.phase === "playing") throw bad();
    r.players[i].ready = ready;
    pushRoom(r);
    return null;
  });

  gateway.rpc("defense.begin", async (ctx, raw) => {
    const r = roomOf((raw as { id?: unknown })?.id);
    if (r.hostUid !== ctx.uid) throw forbidden("방장만 시작할 수 있어요.");
    if (r.phase === "playing") throw bad("이미 시작했어요.");
    if (r.players.some((p) => p.uid !== r.hostUid && !p.ready)) throw bad("모두 준비해야 시작할 수 있어요.");
    // 각자 시즌 로드아웃을 들고 감 (시작 때 고정 — 모두에게 같이 보내서 같은 시뮬)
    const loadouts = await Promise.all(r.players.map((p) => meta.loadoutOf(p.uid)));
    if ((r.phase as Room["phase"]) === "playing" || !rooms.has(r.id)) throw bad("이미 시작했어요.");
    r.loadouts = loadouts;
    r.phase = "playing";
    r.seed = randomInt(1, 2 ** 31 - 1);
    r.turn = 0;
    r.log = [];
    r.pending = [];
    r.standings = null;
    r.hashes.clear();
    r.desync = [];
    for (const p of r.players) {
      p.over = null;
      p.left = false;
      p.gone = 0;
    }
    pushRoom(r);
    gateway.emit(roomKey(r.id), "start", { seed: r.seed, players: r.players.map((p) => p.nick), loadouts: r.loadouts });
    r.timer = setInterval(() => tickRoom(r), TURN_MS);
    r.timer.unref?.();
    return null;
  });

  gateway.rpc("defense.cmd", (ctx, raw) => {
    const { id, c } = z.object({ id: z.string(), c: z.array(z.unknown()).max(8) }).parse(raw);
    const r = roomOf(id);
    const p = seatOf(r, ctx.uid);
    if (p < 0 || r.phase !== "playing") throw bad("진행 중인 판이 아니에요.");
    if (r.log.length + r.pending.length + c.length > MAX_LOG * r.players.length) throw bad("명령이 너무 많아요.");
    for (const cmd of c) if (!isCmd(cmd)) throw bad("잘못된 명령이에요.");
    for (const cmd of c) r.pending.push([p, cmd as Cmd]);
    r.players[p].gone = 0;
    return { turn: r.turn };
  });

  gateway.rpc("defense.over", (ctx, raw) => {
    const { id, win, wave } = z.object({ id: z.string(), win: z.boolean(), wave: z.number().int().min(0).max(999) }).parse(raw);
    const r = roomOf(id);
    const p = seatOf(r, ctx.uid);
    if (p < 0 || r.phase !== "playing") return null;
    r.players[p].over = { win, wave };
    pushRoom(r);
    return null;
  });

  gateway.rpc("defense.hash", (ctx, raw) => {
    const { id, tick, h } = z
      .object({ id: z.string(), tick: z.number().int().min(0), h: z.number().int().min(0).max(0xffffffff) })
      .parse(raw);
    const r = roomOf(id);
    const p = seatOf(r, ctx.uid);
    if (p < 0 || r.phase !== "playing") return null;
    // 아직 안 뿌린 턴의 tick · 간격에 안 맞는 tick 은 무시
    if (tick % HASH_TICKS !== 0 || tick > r.turn * TICKS_PER_TURN) throw bad();
    r.players[p].gone = 0; // 해시를 보낸다 = 아직 보고 있음
    let m = r.hashes.get(tick);
    if (!m) {
      m = new Map();
      r.hashes.set(tick, m);
      // 오래된 tick 은 버림 (늦게 들어온 사람이 따라잡으며 보내는 것까지 비교하려고 넉넉히)
      for (const t of r.hashes.keys()) if (t < tick - HASH_TICKS * 400) r.hashes.delete(t);
    }
    m.set(p, h);
    const vals = new Set(m.values());
    if (vals.size > 1 && !r.desync.some((d) => d.tick === tick)) {
      const seats = Object.fromEntries(m);
      r.desync.push({ tick, seats });
      if (r.desync.length > 20) r.desync.shift();
      console.warn(`[defense] 멀티 어긋남 방 ${r.id} tick ${tick}`, JSON.stringify(seats), `플레이어 ${r.players.map((x) => x.nick).join(",")}`);
      gateway.emit(roomKey(r.id), "desync", { tick });
    }
    return { ok: vals.size === 1 };
  });

  return {
    adminList: () =>
      [...rooms.values()].map((r) => ({
        id: r.id,
        name: r.name,
        phase: r.phase,
        players: r.players.map((p) => p.nick),
        turn: r.turn,
        desync: r.desync.length,
      })),
    close() {
      for (const r of rooms.values()) if (r.timer) clearInterval(r.timer);
      rooms.clear();
      verifier.close();
    },
  };
}
