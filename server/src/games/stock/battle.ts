import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "../../db";
import { AppError, bad, forbidden } from "../../errors";
import type { LiveRoom } from "../../http/admin";
import { RESTORED, RESTORE_GRACE_MS, type LiveGame } from "../../live";
import type { Ctx, Gateway } from "../../realtime/gateway";
import type { UserDoc } from "../../users";
import { newId } from "../../ids";
import { BATTLE, BattleGame, N_STOCKS } from "../../../../web/src/lib/stock/battle";
import { BOT_STYLE_IDS, LEVEL_WEIGHT, botThink, newMind, type BotLevel, type BotMind, type BotStyle } from "../../../../web/src/lib/stock/bots";
import { newSeed, rngFrom } from "../../../../web/src/lib/stock/rng";
import type { BGameWire, BLobbyRow, BRecordRow, BRecords, BResult, BResultRow, BRoomWire, BSeatWire, BattleStats } from "../../../../web/src/lib/stock/types";
import { member } from "./common";

/*
 * 트레이딩 홀 (대전) — 방은 서버 메모리, 판 기록 · 전적은 DB(stk_battles · users.stats.stk.battle).
 * 대전 돈은 판마다 1억 고정 (지갑과 섞지 않음). 회원만.
 *
 * 구독
 *   stock.lobby          방 목록
 *   stock.room { id }    방 상태 (room) · 판 진행 (game, 250ms 마다 바뀐 게 있을 때) · 결과 (result)
 * 요청
 *   stock.room.create · join · quick · leave · kick · addBot · setBot · settings · start · order · sellAll · chat
 *   stock.battle.records · stock.battle.game
 */

const BOT_NICKS: Record<BotStyle, string[]> = {
  chaser: ["불나방", "따라쟁이", "급등헌터", "단타왕"],
  whale: ["큰손", "작전세력", "고래", "회장님"],
  contra: ["역발상", "줍줍", "바닥킬러", "존버"],
  ant: ["개미", "주린이", "동학개미", "소액러"],
};

interface BSeat {
  uid: string | null;
  nick: string;
  bot: { style: BotStyle; level: BotLevel } | null;
}
interface ChatMsg {
  seat: number;
  nick: string;
  text: string;
  ts: number;
  sys?: boolean;
}
interface Room {
  id: string;
  title: string;
  hostUid: string;
  max: number;
  pub: boolean;
  pw: string | null;
  seats: (BSeat | null)[];
  kicked: Record<string, string>;
  access: string[];
  phase: "wait" | "play";
  chat: ChatMsg[];
  createdAt: number;
  emptySince: number;
  lastGame: string | null;
  // ── 저장하지 않는 것 (판 진행) ──
  owners: Map<string, string>;
  game: BattleGame | null;
  minds: (BotMind | null)[];
  /** 판 자리(0..n-1) → 방 자리 번호 */
  map: number[];
  startAt: number;
  dirty: boolean;
  lastShock: { k: number; mult: number[]; ev: number[] } | null;
  feedFrom: number;
  /** 판 시작 때 자리 모습 (판 중에 나가도 결과에 남게) */
  roster: BSeat[];
}

const MAX_ROOMS = 200;
const EMPTY_TTL = 60_000;
const roomKey = (id: string) => `stock:room:${id}`;
const LOBBY = "stock:lobby";
const hashPw = (id: string, pw: string) => createHash("sha256").update(`stock:${id}:${pw}`).digest("hex");
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const idOnly = z.object({ id: z.string().regex(/^\d{4}$/) });
const unref = <T,>(t: T): T => ((t as { unref?: () => void }).unref?.(), t);

export interface BattleOptions {
  /** 테스트: 시간 배율 (0.01 이면 7분이 4.2초) */
  timeScale?: number;
  tickMs?: number;
  now?: () => number;
}

interface BattleDoc {
  _id: string;
  at: Date;
  room: string;
  uids: string[];
  result: BResult;
}

export function createBattle(db: Database, gateway: Gateway, opts: BattleOptions = {}) {
  const now = opts.now ?? Date.now;
  const scale = opts.timeScale ?? 1;
  const tickMs = opts.tickMs ?? 250;
  const rooms = new Map<string, Room>();
  const games = db.col<Omit<BattleDoc, "_id">>("stk_battles");
  const users = db.col<UserDoc>("users");
  void games.createIndex({ uids: 1, at: -1 }).catch(() => {});
  let draining = false;

  /** 판 경과 ms (테스트 배율 반영) */
  const elapsed = (r: Room) => (now() - r.startAt) / scale;

  const humans = (r: Room) => r.seats.filter((s): s is BSeat => !!s?.uid);
  const seatOf = (r: Room, uid: string) => r.seats.findIndex((s) => s?.uid === uid);

  // ───────────── 화면으로 ─────────────

  const seatWire = (r: Room, s: BSeat): BSeatWire => ({ uid: s.uid, nick: s.nick, bot: s.bot, away: !!s.uid && !r.owners.get(s.uid) });
  const roomWire = (r: Room): BRoomWire => ({
    id: r.id,
    title: r.title,
    hostUid: r.hostUid,
    max: r.max,
    pub: r.pub,
    locked: !!r.pw,
    phase: r.phase,
    seats: r.seats.map((s) => (s ? seatWire(r, s) : null)),
    chat: r.chat.slice(-20),
    lastGame: r.lastGame,
  });
  const lobbyWire = (): BLobbyRow[] =>
    [...rooms.values()]
      .filter((r) => r.pub && humans(r).length > 0)
      .map((r) => {
        const h = r.seats.find((s) => s?.uid === r.hostUid);
        return {
          id: r.id,
          title: r.title,
          host: h ? { nick: h.nick } : null,
          count: r.seats.filter(Boolean).length,
          humans: humans(r).length,
          max: r.max,
          locked: !!r.pw,
          phase: r.phase,
          createdAt: r.createdAt,
        };
      })
      .sort((a, b) => (a.phase === b.phase ? b.createdAt - a.createdAt : a.phase === "wait" ? -1 : 1))
      .slice(0, 60);

  let lobbyDirty = false;
  function changed(r: Room) {
    gateway.emit(roomKey(r.id), "room", roomWire(r));
    if (lobbyDirty) return;
    lobbyDirty = true;
    queueMicrotask(() => {
      lobbyDirty = false;
      gateway.emit(LOBBY, "list", lobbyWire());
    });
  }

  function gameWire(r: Room): BGameWire | null {
    const g = r.game;
    if (!g) return null;
    const t = Math.min(BATTLE.durationMs, elapsed(r));
    const feed = g.fills.slice(-14).map((f) => ({ seat: r.map[f.seat], stock: f.stock, side: f.side, qty: f.qty, amount: f.amount, at: f.at }));
    return {
      startAt: r.startAt,
      t,
      prices: g.prices,
      base: g.base,
      last: g.last,
      lastEv: g.lastEv,
      shocks: g.shocks,
      flows: g.flows(t),
      players: g.players.map((p, i) => ({ cash: p.cash, hold: p.hold, cost: p.cost.map(Math.round), assets: g.assets(i), trades: p.trades })),
      map: r.map,
      feed,
      shock: r.lastShock,
      // 아직 안 뜬 속보는 안 보냄 (주문 처리 중 미리 만들어졌어도 뜬 시각 전이면 숨김)
      news: g.news.filter((n) => n.at <= t).slice(-4),
      over: g.over,
    };
  }

  function pushChat(r: Room, seat: number, nick: string, text: string, sys = false) {
    const m: ChatMsg = { seat, nick, text, ts: now(), ...(sys && { sys: true }) };
    r.chat.push(m);
    if (r.chat.length > 40) r.chat.splice(0, r.chat.length - 40);
    gateway.emit(roomKey(r.id), "chat", m);
  }
  const sys = (r: Room, text: string) => pushChat(r, -1, "", text, true);

  // ───────────── 방 ─────────────

  function newRoomNo(): string {
    for (let k = 0; k < 50; k++) {
      const id = String(randomInt(1000, 10000));
      if (!rooms.has(id)) return id;
    }
    throw bad("방이 너무 많아요. 잠시 후 다시 시도해 주세요.");
  }

  function botSeat(r: Room, style: BotStyle, level: BotLevel): BSeat {
    const taken = new Set(r.seats.filter(Boolean).map((s) => s!.nick));
    const names = BOT_NICKS[style].filter((n) => !taken.has(n));
    const nick = names.length ? names[randomInt(names.length)] : `${BOT_NICKS[style][0]}${randomInt(2, 10)}`;
    return { uid: null, nick, bot: { style, level } };
  }

  function removeRoom(r: Room) {
    rooms.delete(r.id);
    gateway.emit(roomKey(r.id), "room", null);
    gateway.emit(LOBBY, "list", lobbyWire());
  }

  function fixHost(r: Room) {
    if (r.seats.some((s) => s?.uid === r.hostUid)) return;
    const h = humans(r)[0];
    if (h?.uid) {
      r.hostUid = h.uid;
      sys(r, `${h.nick}님이 방장이 됐어요.`);
    }
  }

  function vacate(r: Room, uid: string) {
    const i = seatOf(r, uid);
    if (i < 0) return changed(r);
    r.owners.delete(uid);
    // 판 중이면 자리(돈 · 주식)는 판이 끝날 때까지 남김
    if (r.phase !== "play") r.seats[i] = null;
    fixHost(r);
    if (!humans(r).some((s) => r.owners.has(s.uid!))) r.emptySince = now();
    changed(r);
  }

  async function sit(ctx: Ctx, r: Room): Promise<number> {
    const { uid } = member(ctx);
    let i = seatOf(r, uid);
    const me: BSeat = { uid, nick: ctx.nick!, bot: null };
    if (i < 0) {
      if (r.phase === "play") throw new AppError("PLAYING", "지금 대전 중인 방이에요. 끝나면 들어갈 수 있어요.", 409);
      i = r.seats.findIndex((s) => !s);
      if (i < 0) i = r.seats.findIndex((s) => !!s?.bot); // 봇 자리를 사람에게
      if (i < 0) throw new AppError("ROOM_FULL", "방이 가득 찼어요.", 409);
      r.seats[i] = me;
      sys(r, `${me.nick}님이 들어왔어요.`);
    } else if (r.phase !== "play") r.seats[i] = me;
    r.owners.set(uid, ctx.socket.id);
    // 다른 방에 앉아 있었으면 거기서 나옴
    for (const o of rooms.values()) if (o !== r && seatOf(o, uid) >= 0) vacate(o, uid);
    return i;
  }

  const createSchema = z.object({
    title: z.string().max(40).default(""),
    max: z.number().int().min(BATTLE.minPlayers).max(BATTLE.maxPlayers).default(6),
    pub: z.boolean().default(true),
    password: z.string().max(8).default(""),
    /** 처음에 앉힐 봇 수 (성격 · 난이도는 랜덤) */
    bots: z.number().int().min(0).max(7).default(3),
  });
  /** 난이도 뽑기 (초급 · 중급 · 고급 비율) */
  const randLevel = (): BotLevel => {
    const t = LEVEL_WEIGHT[0] + LEVEL_WEIGHT[1] + LEVEL_WEIGHT[2];
    const x = randomInt(t);
    return x < LEVEL_WEIGHT[0] ? 0 : x < LEVEL_WEIGHT[0] + LEVEL_WEIGHT[1] ? 1 : 2;
  };
  const randStyle = (r: Room): BotStyle => {
    // 같은 성격이 몰리지 않게: 아직 없는 성격 우선
    const have = new Set(r.seats.filter((s) => s?.bot).map((s) => s!.bot!.style));
    const pool = BOT_STYLE_IDS.filter((x) => !have.has(x));
    const from = pool.length ? pool : BOT_STYLE_IDS;
    return from[randomInt(from.length)];
  };

  async function createRoom(ctx: Ctx, o: z.infer<typeof createSchema>) {
    const { uid, nick } = member(ctx);
    if (draining) throw new AppError("RESTARTING", "서버를 곧 다시 시작해요. 잠시 후 방을 만들어 주세요.", 503);
    if (rooms.size >= MAX_ROOMS) throw bad("방이 너무 많아요. 잠시 후 다시 시도해 주세요.");
    const pw = o.password.trim();
    if (pw && !/^\d{4}$/.test(pw)) throw bad("비밀번호는 숫자 4자리예요.");
    const id = newRoomNo();
    const t = now();
    const r: Room = {
      id,
      title: o.title.replace(/\s+/g, " ").trim().slice(0, 20) || `${nick}의 방`,
      hostUid: uid,
      max: o.max,
      pub: o.pub,
      pw: pw ? hashPw(id, pw) : null,
      seats: Array(o.max).fill(null),
      kicked: {},
      access: [],
      phase: "wait",
      chat: [],
      createdAt: t,
      emptySince: t,
      lastGame: null,
      owners: new Map(),
      game: null,
      minds: [],
      map: [],
      startAt: 0,
      dirty: false,
      lastShock: null,
      feedFrom: 0,
      roster: [],
    };
    rooms.set(id, r);
    await sit(ctx, r);
    for (let k = 0; k < Math.min(o.bots, o.max - 1); k++) {
      const i = r.seats.findIndex((s) => !s);
      r.seats[i] = botSeat(r, randStyle(r), randLevel());
    }
    changed(r);
    return r;
  }

  gateway.rpc("stock.room.create", async (ctx, raw) => {
    const r = await createRoom(ctx, createSchema.parse(raw ?? {}));
    return { id: r.id, seat: seatOf(r, ctx.uid) };
  });

  const tries = new Map<string, { at: number; n: number }>();
  gateway.rpc("stock.room.join", async (ctx, raw) => {
    const o = idOnly.extend({ password: z.string().max(8).optional() }).parse(raw);
    const { uid } = member(ctx);
    const r = rooms.get(o.id);
    if (!r) throw new AppError("NO_ROOM", "없어진 방이에요.", 404);
    if (r.kicked[uid] !== undefined) throw forbidden("방장이 이 방에서 내보냈어요.");
    if (seatOf(r, uid) < 0 && r.pw && r.hostUid !== uid && !r.access.includes(uid)) {
      const k = `${o.id}/${uid}`,
        t = now(),
        x = tries.get(k);
      if (!x || t - x.at > 60_000) tries.set(k, { at: t, n: 1 });
      else if (++x.n > 8) throw new AppError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.", 429);
      if (tries.size > 5000) tries.clear();
      if (!o.password) throw new AppError("NEED_PASSWORD", "비밀번호가 필요한 방이에요.", 403);
      if (!safeEqual(hashPw(r.id, o.password), r.pw)) throw new AppError("WRONG_PASSWORD", "비밀번호가 맞지 않아요.", 403);
      r.access.push(uid);
    }
    const seat = await sit(ctx, r);
    changed(r);
    return { id: r.id, seat };
  });

  /** 빠른 입장: 자리 있는 공개 방 → 없으면 봇 3명과 새 방 */
  gateway.rpc("stock.room.quick", async (ctx) => {
    const { uid } = member(ctx);
    const cand = [...rooms.values()]
      .filter((r) => r.pub && !r.pw && r.phase === "wait" && r.kicked[uid] === undefined && humans(r).length > 0 && seatOf(r, uid) < 0)
      .filter((r) => r.seats.some((s) => !s || !!s.bot))
      .sort((a, b) => humans(b).length - humans(a).length);
    const r = cand[0];
    if (r) {
      const seat = await sit(ctx, r);
      changed(r);
      return { id: r.id, seat, made: false };
    }
    const nr = await createRoom(ctx, createSchema.parse({}));
    return { id: nr.id, seat: seatOf(nr, uid), made: true };
  });

  gateway.rpc("stock.room.leave", (ctx, raw) => {
    const r = rooms.get(idOnly.parse(raw).id);
    if (!r) return null;
    const i = seatOf(r, ctx.uid);
    if (i >= 0) sys(r, `${r.seats[i]!.nick}님이 나갔어요.`);
    vacate(r, ctx.uid);
    if (!humans(r).length) removeRoom(r);
    return null;
  });

  gateway.onDisconnect((ctx) => {
    const uid = ctx.user?.uid;
    if (!uid) return;
    for (const r of [...rooms.values()]) {
      if (r.owners.get(uid) !== ctx.socket.id) continue;
      if (r.phase === "play") {
        r.owners.delete(uid);
        changed(r);
      } else vacate(r, uid);
    }
  });

  function asHost(ctx: Ctx, id: string) {
    const r = rooms.get(id);
    if (!r) throw new AppError("NO_ROOM", "없어진 방이에요.", 404);
    if (r.hostUid !== ctx.uid) throw forbidden("방장만 할 수 있어요.");
    if (r.phase === "play") throw bad("대전이 끝난 뒤에 할 수 있어요.");
    return r;
  }

  gateway.rpc("stock.room.addBot", (ctx, raw) => {
    const o = idOnly.parse(raw);
    const r = asHost(ctx, o.id);
    const i = r.seats.findIndex((s) => !s);
    if (i < 0) throw bad("자리가 다 찼어요.");
    r.seats[i] = botSeat(r, randStyle(r), randLevel());
    changed(r);
    return null;
  });

  /** 내보내기 (사람) · 봇 빼기 */
  gateway.rpc("stock.room.kick", (ctx, raw) => {
    const o = idOnly.extend({ seat: z.number().int().min(0).max(7) }).parse(raw);
    const r = asHost(ctx, o.id);
    const s = r.seats[o.seat];
    if (!s || s.uid === r.hostUid) return null;
    if (s.uid) {
      r.kicked[s.uid] = s.nick;
      gateway.emit(roomKey(r.id), "kicked", { uid: s.uid });
      sys(r, `${s.nick}님을 내보냈어요.`);
      vacate(r, s.uid);
    } else {
      r.seats[o.seat] = null;
      changed(r);
    }
    return null;
  });

  gateway.rpc("stock.room.settings", (ctx, raw) => {
    const o = idOnly
      .extend({ title: z.string().max(40).optional(), max: z.number().int().min(BATTLE.minPlayers).max(BATTLE.maxPlayers).optional(), pub: z.boolean().optional(), password: z.string().max(8).optional() })
      .parse(raw);
    const r = asHost(ctx, o.id);
    if (o.title !== undefined) r.title = o.title.replace(/\s+/g, " ").trim().slice(0, 20) || r.title;
    if (o.pub !== undefined) r.pub = o.pub;
    if (o.password !== undefined) {
      const pw = o.password.trim();
      if (pw && !/^\d{4}$/.test(pw)) throw bad("비밀번호는 숫자 4자리예요.");
      r.pw = pw ? hashPw(r.id, pw) : null;
      r.access = [];
    }
    if (o.max !== undefined && o.max !== r.max) {
      const seats = [...r.seats];
      while (seats.length > o.max) {
        const k = seats.map((s, i) => (!s || s.bot ? i : -1)).filter((i) => i >= 0).pop();
        if (k === undefined) throw bad("사람이 앉은 자리는 없앨 수 없어요.");
        seats.splice(k, 1);
      }
      while (seats.length < o.max) seats.push(null);
      r.seats = seats;
      r.max = o.max;
    }
    changed(r);
    return null;
  });

  // ───────────── 진행 ─────────────

  gateway.rpc("stock.room.start", (ctx, raw) => {
    const r = asHost(ctx, idOnly.parse(raw).id);
    if (draining) throw new AppError("RESTARTING", "서버를 곧 다시 시작해요. 잠시 후 시작해 주세요.", 503);
    const map = r.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    if (map.length < BATTLE.minPlayers) throw bad("2명 이상이어야 시작할 수 있어요. 봇을 앉혀 보세요.");
    const seed = newSeed();
    r.map = map;
    r.roster = map.map((i) => ({ ...r.seats[i]! }));
    r.game = new BattleGame(map.length, seed);
    r.minds = map.map((i, k) => {
      const b = r.seats[i]!.bot;
      return b ? newMind(b.style, b.level, rngFrom(`${seed}:bot${k}`)) : null;
    });
    r.phase = "play";
    r.startAt = now();
    r.lastShock = null;
    r.dirty = true;
    sys(r, "대전 시작! 30초 동안 사 두세요. 그 뒤로 10초마다 시세가 바뀌어요.");
    changed(r);
    return null;
  });

  function asPlayer(ctx: Ctx, id: string) {
    const r = rooms.get(id);
    if (!r?.game || r.phase !== "play") throw new AppError("NOT_PLAYING", "진행 중인 대전이 없어요.", 409);
    const seat = seatOf(r, ctx.uid);
    const pi = r.map.indexOf(seat);
    if (pi < 0) throw forbidden();
    if (r.owners.get(ctx.uid) !== ctx.socket.id) r.owners.set(ctx.uid, ctx.socket.id);
    return { r, g: r.game, pi };
  }

  gateway.rpc("stock.room.order", (ctx, raw) => {
    const o = idOnly.extend({ stock: z.number().int().min(0).max(N_STOCKS - 1), side: z.enum(["buy", "sell"]), qty: z.number().int().min(1).max(BATTLE.maxQty) }).parse(raw);
    const { r, g, pi } = asPlayer(ctx, o.id);
    const at = elapsed(r);
    g.advance(at); // 변동 시각을 지났으면 변동부터 (도착 순서대로)
    const f = g.order(pi, o.stock, o.side, o.qty, at);
    if (!f) return { ok: false };
    r.dirty = true;
    return { ok: true, qty: f.qty, amount: f.amount, price: f.price, cash: g.players[pi].cash, hold: g.players[pi].hold[o.stock] };
  });

  gateway.rpc("stock.room.sellAll", (ctx, raw) => {
    const { r, g, pi } = asPlayer(ctx, idOnly.parse(raw).id);
    const at = elapsed(r);
    g.advance(at);
    const fs = g.sellAll(pi, at);
    if (fs.length) r.dirty = true;
    return { ok: fs.length > 0, amount: fs.reduce((a, f) => a + f.amount, 0), cash: g.players[pi].cash };
  });

  const chatRate = new Map<string, number>();
  gateway.rpc("stock.room.chat", (ctx, raw) => {
    const { id, text } = idOnly.extend({ text: z.string().min(1).max(60) }).parse(raw);
    const r = rooms.get(id);
    if (!r) return null;
    const i = seatOf(r, ctx.uid);
    if (i < 0) throw forbidden();
    const t = now();
    if (t - (chatRate.get(ctx.uid) ?? 0) < 600) throw new AppError("RATE_LIMITED", "조금 천천히 보내 주세요.", 429);
    chatRate.set(ctx.uid, t);
    if (chatRate.size > 5000) chatRate.clear();
    const clean = text.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
    if (clean) pushChat(r, i, r.seats[i]!.nick, clean);
    return null;
  });

  // ───────────── 틱 · 끝 ─────────────

  /** 방마다 내보낸 속보 수 (주문 처리 중에 뜬 속보도 다음 틱에 내보내게) */
  const newsSent = new WeakMap<Room, number>();
  function tick() {
    for (const r of rooms.values()) {
      const g = r.game;
      if (!g || r.phase !== "play") continue;
      const at = Math.min(BATTLE.durationMs, elapsed(r));
      const sh = g.advance(at);
      if (sh.length) {
        const e = sh[sh.length - 1];
        r.lastShock = { k: e.k, mult: e.mult, ev: e.ev };
        r.dirty = true;
      }
      if (g.news.length !== (newsSent.get(r) ?? 0)) {
        newsSent.set(r, g.news.length);
        r.dirty = true;
      }
      if (!g.over)
        r.minds.forEach((m, pi) => {
          if (m && botThink(g, pi, m, at).length) r.dirty = true;
        });
      if (r.dirty || g.over) {
        r.dirty = false;
        gateway.emit(roomKey(r.id), "game", gameWire(r));
        r.lastShock = null;
      }
      if (g.over) void finishGame(r).catch((e) => console.error("[stock] 대전 정산 실패", e));
    }
  }
  const timer = unref(setInterval(tick, tickMs * Math.min(1, Math.max(scale, 0.02))));

  async function finishGame(r: Room) {
    const g = r.game!;
    r.game = null;
    r.phase = "wait";
    const n = r.map.length;
    const rank = g.ranking();
    const rows: BResultRow[] = r.map.map((seatIdx, pi) => {
      const s = r.roster[pi];
      // 가장 많이 산 종목
      const bought = Array(N_STOCKS).fill(0);
      for (const f of g.fills) if (f.seat === pi && f.side === "buy") bought[f.stock] += f.amount;
      const top = bought.indexOf(Math.max(...bought));
      return {
        seat: seatIdx,
        uid: s.uid,
        nick: s.nick,
        bot: s.bot,
        final: g.players[pi].cash,
        mult: g.players[pi].cash / BATTLE.startCash,
        trades: g.players[pi].trades,
        rank: rank.indexOf(pi) + 1,
        main: bought[top] > 0 ? top : null,
      };
    });
    const hl = g.highlights();
    const id = newId(16);
    const result: BResult = {
      id,
      at: now(),
      rows: [...rows].sort((a, b) => a.rank - b.rank),
      curve: g.curve,
      priceCurve: g.priceCurve,
      highlights: {
        ...hl,
        bigGain: { ...hl.bigGain, seat: hl.bigGain.seat >= 0 ? r.map[hl.bigGain.seat] : -1 },
        bigDump: { ...hl.bigDump, seat: hl.bigDump.seat >= 0 ? r.map[hl.bigDump.seat] : -1 },
      },
      humans: rows.filter((x) => x.uid).length,
      bots: rows.filter((x) => x.bot).length,
    };
    r.lastGame = id;
    // 판 중에 나간 사람 자리 정리
    for (const [i, s] of r.seats.entries()) if (s?.uid && !r.owners.get(s.uid)) r.seats[i] = null;
    fixHost(r);
    r.map = [];
    r.minds = [];
    gateway.emit(roomKey(r.id), "result", result);
    sys(r, `대전 끝! 1등 ${result.rows[0].nick} (${result.rows[0].mult.toFixed(1)}배)`);
    changed(r);
    if (!humans(r).length) removeRoom(r);
    const uids = rows.filter((x) => x.uid).map((x) => x.uid!);
    await games.insertOne({ _id: id, at: new Date(result.at), room: r.id, uids, result } as never);
    await users.bulkWrite(
      rows
        .filter((x) => x.uid)
        .map((x) => ({
          updateOne: {
            filter: { _id: x.uid! },
            update: {
              $inc: { "stats.stk.battle.games": 1, "stats.stk.battle.rankSum": x.rank, ...(x.rank === 1 && { "stats.stk.battle.wins": 1 }), ...(x.rank <= 3 && n >= 4 && { "stats.stk.battle.top3": 1 }) },
              $max: { "stats.stk.battle.best": x.mult },
            },
          },
        })),
      { ordered: false }
    );
  }

  // ───────────── 전적 ─────────────

  const statsOf = (d: { stats?: { stk?: { battle?: Partial<BattleStats> } } } | null): BattleStats => {
    const b = d?.stats?.stk?.battle ?? {};
    return { games: b.games ?? 0, wins: b.wins ?? 0, rankSum: b.rankSum ?? 0, best: b.best ?? null, top3: b.top3 ?? 0 };
  };

  gateway.rpc("stock.battle.records", async (ctx): Promise<BRecords> => {
    const { uid } = member(ctx);
    const [u, docs] = await Promise.all([
      users.findOne({ _id: uid }, { projection: { "stats.stk.battle": 1 } }),
      games.find({ uids: uid }, { projection: { "result.rows": 1, "result.humans": 1, "result.bots": 1, at: 1 } }).sort({ at: -1 }).limit(30).toArray(),
    ]);
    const list: BRecordRow[] = (docs as unknown as BattleDoc[]).map((d) => {
      const me = d.result.rows.find((x) => x.uid === uid)!;
      return { id: d._id, at: d.at.getTime(), rank: me?.rank ?? 0, n: d.result.rows.length, mult: me?.mult ?? 0, main: me?.main ?? null, humans: d.result.humans, bots: d.result.bots };
    });
    return { stats: statsOf(u as never), list };
  });

  gateway.rpc("stock.battle.game", async (ctx, raw) => {
    member(ctx);
    const { id } = z.object({ id: z.string().max(40) }).parse(raw);
    const d = (await games.findOne({ _id: id })) as unknown as BattleDoc | null;
    if (!d) throw new AppError("NOT_FOUND", "기록이 없어요.", 404);
    return d.result;
  });

  // ───────────── 구독 ─────────────

  gateway.channel("stock.lobby", { key: () => LOBBY, snapshot: () => lobbyWire() });
  gateway.channel("stock.room", {
    key: (_ctx, p) => roomKey(idOnly.parse(p).id),
    snapshot(ctx, _k, p) {
      const r = rooms.get(idOnly.parse(p).id);
      if (!r) return null;
      const uid = ctx.user?.uid;
      if (uid && seatOf(r, uid) >= 0 && (r.owners.get(uid) === RESTORED || !r.owners.get(uid))) {
        r.owners.set(uid, ctx.socket.id);
        queueMicrotask(() => changed(r));
      }
      return { room: roomWire(r), game: gameWire(r) };
    },
  });

  // 빈 방 정리
  const sweep = unref(
    setInterval(() => {
      const t = now();
      for (const r of [...rooms.values()]) {
        const live = humans(r).some((s) => r.owners.get(s.uid!));
        if (!live && r.phase !== "play" && t - r.emptySince > EMPTY_TTL) removeRoom(r);
      }
    }, 20_000)
  );

  // ───────────── 배포 때 ─────────────
  // 대전 중인 방은 끝나길 기다리고(drainMs 안), 대기 중인 방만 저장해서 이어받음 (판 도중 상태는 저장하지 않음)
  type Saved = Pick<Room, "id" | "title" | "hostUid" | "max" | "pub" | "pw" | "seats" | "kicked" | "access" | "chat" | "createdAt" | "lastGame">;
  const live: LiveGame = {
    busy: () => [...rooms.values()].some((r) => r.phase === "play" && humans(r).some((s) => r.owners.get(s.uid!))),
    drain() {
      draining = true;
    },
    snapshot: () =>
      [...rooms.values()].map(
        (r): Saved => ({ id: r.id, title: r.title, hostUid: r.hostUid, max: r.max, pub: r.pub, pw: r.pw, seats: r.seats, kicked: r.kicked, access: r.access, chat: r.chat, createdAt: r.createdAt, lastGame: r.lastGame })
      ),
    restore(data) {
      for (const d of data as Saved[]) {
        const t = now();
        const r: Room = { ...d, phase: "wait", emptySince: t, owners: new Map(), game: null, minds: [], map: [], startAt: 0, dirty: false, lastShock: null, feedFrom: 0, roster: [] };
        for (const s of humans(r)) r.owners.set(s.uid!, RESTORED);
        rooms.set(r.id, r);
      }
      unref(
        setTimeout(() => {
          for (const r of [...rooms.values()]) for (const [uid, o] of [...r.owners]) if (o === RESTORED) vacate(r, uid);
          for (const r of [...rooms.values()]) if (!humans(r).length) removeRoom(r);
        }, RESTORE_GRACE_MS)
      );
    },
  };

  return {
    live,
    close() {
      clearInterval(timer);
      clearInterval(sweep);
    },
    hub: () => ({ rooms: [...rooms.values()].filter((r) => r.pub && humans(r).length).length, playing: [...rooms.values()].filter((r) => r.phase === "play").length }),
    adminList(): LiveRoom[] {
      return [...rooms.values()].map((r) => ({
        id: r.id,
        name: r.title,
        status: r.phase === "play" ? "play" : "waiting",
        players: r.seats.filter(Boolean).map((s) => (s!.bot ? `${s!.nick}(봇)` : s!.nick)),
        createdAt: r.createdAt,
      }));
    },
    adminClose(id: string): boolean {
      const r = rooms.get(id);
      if (r) removeRoom(r);
      return !!r;
    },
    _rooms: rooms,
  };
}
