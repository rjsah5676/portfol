import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad, forbidden } from "../errors";
import { newId } from "../ids";
import type { Ctx } from "../realtime/gateway";

/*
 * 픽셀 머지 친구 대전 — 같은 순서로 나오는 공을 여럿이 동시에, 마지막까지 살아남는 사람이 1등
 *
 * 친구끼리 하는 용: 방 목록 없이 초대 링크(?room=id)로만 들어옴. 방장이 모드를 고르고 시작.
 *  lobby ─start→ playing (startAt 에 모두 같이, 같은 시드) ─한 명만 남거나 다 죽으면→ result ─back→ lobby
 *
 * 모드
 *   normal  일반: 각자 자기 병만. 먼저 넘친 순서대로 꼴등부터
 *   junk    방해: 높은 단계로 합치거나 연쇄를 터뜨리면 살아 있는 상대 하나에게 방해 공(도트)이 떨어짐
 *
 * 물리는 각자 브라우저에서 돌림 (matter-js 는 기기마다 결과가 달라서 서버가 같이 돌릴 수 없음).
 * 서버는 방 상태 · 순위 정리 · 공 위치 모아 뿌리기 · 방해 공 배달만.
 *  - 플레이 중 내 병(점수 · 공 위치)을 각자 0.12초마다 보내고, 서버는 모아서 0.12초마다 한 번 뿌림 (남의 병 미니 화면 · 관전)
 *
 * 구독: pmb.room { id } → "room"(방 상태) · "live"(공 위치) · "junk"(방해 공 { to, from, n })
 */

export type Mode = "normal" | "junk";
type Phase = "lobby" | "playing" | "result";

interface Player {
  nick: string;
  joinedAt: number;
}
interface Place {
  nick: string;
  /** 1 = 1등 */
  place: number;
  score: number;
  maxTier: number;
  /** 보낸 방해 공 수 */
  sent: number;
}
interface Round {
  no: number;
  seed: number;
  startAt: number;
  roster: string[];
  /** 죽은(또는 나간) 사람 · 끝나면 1등까지 */
  places: Record<string, Place>;
}
interface Room {
  id: string;
  hostUid: string;
  mode: Mode;
  createdAt: number;
  players: Record<string, Player>;
  phase: Phase;
  round: Round | null;
  // ── 방 상태로 안 나감 ──
  snaps: Record<string, number[]>;
  dirty: boolean;
  sent: Record<string, number>;
  lastAttack: Map<string, number>;
  owners: Map<string, string>;
  emptySince: number;
  timer: NodeJS.Timeout | null;
}

const MAX_ROOMS = 300;
const MAX_PLAYERS = 6;
/** 시작 버튼 → 다 같이 시작까지 (카운트다운 3초 + 여유) */
const START_DELAY_MS = 3_500;
/** 한 판 최대 (안 끝나면 점수 순으로 정리) */
const ROUND_MAX_MS = 20 * 60_000;
const LIVE_EVERY_MS = 120;
/** 스냅샷: [점수, 들고 있는 공, 겨눈 x, 위험 0/1, (단계, x, y, 각도×10) × 공 수] */
const MAX_BALLS = 140;
const ATTACK_GAP_MS = 200;

const roomId = z.string().min(1).max(40);
const idOnly = z.object({ id: roomId });
const nickSchema = z.string().min(1).max(10);
const modeSchema = z.enum(["normal", "junk"]);

const ordered = (room: Room) =>
  Object.entries(room.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt || a[0].localeCompare(b[0]));
const leaderOf = (room: Room) => (room.players[room.hostUid] ? room.hostUid : (ordered(room)[0]?.[0] ?? ""));

export function registerPixelmergeBattle({ gateway }: Deps) {
  const rooms = new Map<string, Room>();
  const roomKey = (id: string) => `pmb:room:${id}`;

  const wire = (r: Room) => ({
    id: r.id,
    hostUid: r.hostUid,
    mode: r.mode,
    max: MAX_PLAYERS,
    players: r.players,
    phase: r.phase,
    round: r.round,
  });
  const changed = (room: Room) => gateway.emit(roomKey(room.id), "room", wire(room));

  const tick = setInterval(() => {
    for (const room of rooms.values()) {
      if (room.phase !== "playing" || !room.dirty || !room.round) continue;
      room.dirty = false;
      gateway.emit(roomKey(room.id), "live", { round: room.round.no, snaps: room.snaps });
    }
  }, LIVE_EVERY_MS);
  tick.unref();

  function clearTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
  }
  function removeRoom(room: Room) {
    clearTimer(room);
    rooms.delete(room.id);
    gateway.emit(roomKey(room.id), "room", null);
  }

  const alive = (room: Room) => {
    const r = room.round;
    return r ? r.roster.filter((u) => !r.places[u]) : [];
  };
  const scoreOf = (room: Room, uid: string) => room.snaps[uid]?.[0] ?? 0;

  /** 한 사람 탈락 (넘침 · 나감) — 순위 = 그때 살아 있던 사람 수 */
  function knockOut(room: Room, uid: string, res?: { score: number; maxTier: number }) {
    const r = room.round;
    if (!r || room.phase !== "playing" || !r.roster.includes(uid) || r.places[uid]) return;
    r.places[uid] = {
      nick: room.players[uid]?.nick ?? "?",
      place: alive(room).length,
      score: res?.score ?? scoreOf(room, uid),
      maxTier: res?.maxTier ?? 0,
      sent: room.sent[uid] ?? 0,
    };
    checkEnd(room);
  }
  function checkEnd(room: Room) {
    const r = room.round;
    if (!r || room.phase !== "playing") return;
    const left = alive(room);
    if (left.length > 1 || (left.length === 1 && r.roster.length === 1)) return changed(room);
    finish(room);
  }
  /** 끝: 살아 있는 사람은 점수 높은 순으로 1등부터 */
  function finish(room: Room) {
    const r = room.round;
    if (!r) return;
    clearTimer(room);
    const left = alive(room).sort((a, b) => scoreOf(room, b) - scoreOf(room, a));
    left.forEach((uid, i) => {
      r.places[uid] = {
        nick: room.players[uid]?.nick ?? "?",
        place: i + 1,
        score: scoreOf(room, uid),
        maxTier: maxTierOf(room.snaps[uid]),
        sent: room.sent[uid] ?? 0,
      };
    });
    room.phase = "result";
    gateway.emit(roomKey(room.id), "live", { round: r.no, snaps: room.snaps });
    room.dirty = false;
    changed(room);
  }
  const maxTierOf = (s?: number[]) => {
    let m = 0;
    for (let i = 4; s && i + 3 < s.length; i += 4) m = Math.max(m, s[i]);
    return m;
  };

  function removePlayer(room: Room, uid: string) {
    if (!room.players[uid]) return;
    if (room.phase === "playing") knockOut(room, uid);
    delete room.players[uid];
    room.owners.delete(uid);
    const leader = leaderOf(room);
    if (leader && leader !== room.hostUid) room.hostUid = leader;
    if (!Object.keys(room.players).length) room.emptySince = Date.now();
    changed(room);
  }

  const getRoom = (id: string): Room => {
    const room = rooms.get(id);
    if (!room) throw new AppError("NO_ROOM", "방이 없어요. 링크가 지났거나 다들 나갔어요.", 404);
    return room;
  };
  function asPlayer(ctx: Ctx, id: string) {
    const room = getRoom(id);
    const uid = ctx.uid;
    if (!room.players[uid]) throw forbidden();
    return { room, uid };
  }
  function asHost(ctx: Ctx, id: string) {
    const { room, uid } = asPlayer(ctx, id);
    if (leaderOf(room) !== uid) throw forbidden("방장만 할 수 있어요.");
    return { room, uid };
  }

  gateway.channel("pmb.room", {
    key(ctx, p) {
      void ctx.uid; // 로그인(익명 포함)한 사람만
      return roomKey(idOnly.parse(p).id);
    },
    snapshot(_ctx, _key, p) {
      const room = rooms.get(idOnly.parse(p).id);
      if (!room) return null;
      return { ...wire(room), snaps: room.phase === "playing" ? room.snaps : null };
    },
  });

  gateway.rpc("pmb.create", (ctx, raw) => {
    const uid = ctx.uid;
    const o = z.object({ mode: modeSchema }).parse(raw);
    if (rooms.size >= MAX_ROOMS) throw bad("방이 너무 많아요. 잠시 후 다시 해주세요.");
    const id = newId(10);
    const now = Date.now();
    rooms.set(id, {
      id,
      hostUid: uid,
      mode: o.mode,
      createdAt: now,
      players: {},
      phase: "lobby",
      round: null,
      snaps: {},
      dirty: false,
      sent: {},
      lastAttack: new Map(),
      owners: new Map(),
      emptySince: now,
      timer: null,
    });
    return id;
  });

  gateway.rpc("pmb.join", (ctx, raw) => {
    const { id, nick: typed, rejoin } = z
      .object({ id: roomId, nick: nickSchema, rejoin: z.boolean().default(false) })
      .parse(raw);
    const uid = ctx.uid;
    const room = getRoom(id);
    const prev = room.players[uid];
    if (!prev && !rejoin && Object.keys(room.players).length >= MAX_PLAYERS)
      throw new AppError("ROOM_FULL", `방이 가득 찼어요 (${MAX_PLAYERS}명).`, 409);
    room.players[uid] = { nick: ctx.name(typed), joinedAt: prev?.joinedAt ?? Date.now() };
    room.owners.set(uid, ctx.socket.id);
    const leader = leaderOf(room);
    if (leader && leader !== room.hostUid) room.hostUid = leader;
    changed(room);
    return null;
  });

  gateway.rpc("pmb.leave", (ctx, raw) => {
    const { id } = idOnly.parse(raw);
    const uid = ctx.uid;
    const room = rooms.get(id);
    if (!room || !room.players[uid]) return null;
    removePlayer(room, uid);
    if (!Object.keys(room.players).length) removeRoom(room);
    return null;
  });

  gateway.onDisconnect((ctx) => {
    const uid = ctx.user?.uid;
    if (!uid) return;
    for (const room of rooms.values()) if (room.owners.get(uid) === ctx.socket.id) removePlayer(room, uid);
  });

  gateway.rpc("pmb.mode", (ctx, raw) => {
    const { id, mode } = z.object({ id: roomId, mode: modeSchema }).parse(raw);
    const { room } = asHost(ctx, id);
    if (room.phase === "playing") throw new AppError("BUSY", "게임 중에는 바꿀 수 없어요.", 409);
    room.mode = mode;
    changed(room);
    return null;
  });

  gateway.rpc("pmb.start", (ctx, raw) => {
    const { room } = asHost(ctx, idOnly.parse(raw).id);
    if (room.phase === "playing") return null;
    const roster = ordered(room).map(([u]) => u);
    if (roster.length < 2) throw bad("친구가 들어와야 시작할 수 있어요 (2명부터).");
    room.phase = "playing";
    room.round = {
      no: (room.round?.no ?? 0) + 1,
      seed: Math.floor(Math.random() * 2 ** 31),
      startAt: Date.now() + START_DELAY_MS,
      roster,
      places: {},
    };
    room.snaps = {};
    room.sent = {};
    room.dirty = false;
    clearTimer(room);
    room.timer = setTimeout(() => {
      room.timer = null;
      if (rooms.get(room.id) === room && room.phase === "playing") finish(room);
    }, START_DELAY_MS + ROUND_MAX_MS);
    room.timer.unref();
    changed(room);
    return null;
  });

  /** 내 병 (0.12초마다) — 응답 없이 빨리 */
  const snapSchema = z.object({ id: roomId, round: z.number().int(), s: z.array(z.number()).min(4).max(4 + MAX_BALLS * 4) });
  gateway.rpc("pmb.snap", (ctx, raw) => {
    const { id, round, s } = snapSchema.parse(raw);
    const room = rooms.get(id);
    const uid = ctx.uid;
    const r = room?.round;
    if (!room || !r || room.phase !== "playing" || r.no !== round || !r.roster.includes(uid) || r.places[uid]) return null;
    const lim = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? Math.round(v) : lo));
    const out = [lim(s[0], 0, 10_000_000), lim(s[1], 0, 10), lim(s[2], 0, 400), s[3] ? 1 : 0];
    for (let i = 4; i + 3 < s.length; i += 4) out.push(lim(s[i], 0, 10), lim(s[i + 1], -50, 450), lim(s[i + 2], -200, 700), lim(s[i + 3], -999, 999));
    room.snaps[uid] = out;
    room.dirty = true;
    return null;
  });

  /** 방해 공 보내기 (방해 모드) — 살아 있는 상대 중 하나에게 */
  gateway.rpc("pmb.attack", (ctx, raw) => {
    const { id, round, n } = z.object({ id: roomId, round: z.number().int(), n: z.number().int().min(1).max(12) }).parse(raw);
    const room = rooms.get(id);
    const uid = ctx.uid;
    const r = room?.round;
    if (!room || !r || room.mode !== "junk" || room.phase !== "playing" || r.no !== round || !r.roster.includes(uid) || r.places[uid])
      return null;
    const now = Date.now();
    if (now < r.startAt || now - (room.lastAttack.get(uid) ?? 0) < ATTACK_GAP_MS) return null;
    room.lastAttack.set(uid, now);
    const targets = alive(room).filter((u) => u !== uid);
    if (!targets.length) return null;
    const to = targets[Math.floor(Math.random() * targets.length)];
    room.sent[uid] = (room.sent[uid] ?? 0) + n;
    gateway.emit(roomKey(room.id), "junk", { round: r.no, to, from: uid, n });
    return { to };
  });

  /** 내 병이 넘침 */
  gateway.rpc("pmb.dead", (ctx, raw) => {
    const o = z
      .object({ id: roomId, round: z.number().int(), score: z.number().int().min(0).max(10_000_000), maxTier: z.number().int().min(0).max(10) })
      .parse(raw);
    const room = rooms.get(o.id);
    const uid = ctx.uid;
    if (!room || room.round?.no !== o.round) return null;
    if (room.snaps[uid]) room.snaps[uid][0] = o.score;
    knockOut(room, uid, { score: o.score, maxTier: o.maxTier });
    return null;
  });

  /** 결과 → 대기실 (방장) */
  gateway.rpc("pmb.back", (ctx, raw) => {
    const { room } = asHost(ctx, idOnly.parse(raw).id);
    if (room.phase !== "result") return null;
    room.phase = "lobby";
    changed(room);
    return null;
  });

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()]) {
      const empty = !Object.keys(room.players).length;
      // 만들고 아무도 안 들어온 방 · 다 나간 방은 1분 뒤 정리, 대기실에 6시간 넘게 있는 방도 정리
      if ((empty && now - room.emptySince >= 60_000) || (room.phase !== "playing" && now - room.createdAt > 6 * 3600_000))
        removeRoom(room);
    }
  }, 30_000);
  sweep.unref();

  return {
    close() {
      clearInterval(tick);
      clearInterval(sweep);
      for (const room of rooms.values()) clearTimer(room);
    },
  };
}
