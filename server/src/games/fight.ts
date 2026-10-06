import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad, forbidden } from "../errors";
import { newId, orderedId } from "../ids";
import type { Ctx } from "../realtime/gateway";

/*
 * 픽셀 격투 온라인 대전
 *
 * 경기 자체는 브라우저끼리 한다 (WebRTC 데이터 채널로 입력을 주고받고 롤백 넷코드로 맞춤).
 * 서버는 그 주변만 맡음 (기존에 Firebase Realtime Database가 하던 역할):
 *  - 대기실: 방 목록, 자리(최대 2명), 캐릭터·준비, 채팅, 경기 시작/끝 상태
 *  - WebRTC 연결 정보(offer/answer) 전달
 *  - P2P 연결이 안 될 때 입력 중계 (느리지만 됨)
 *  - 관전용 입력 기록 (선수가 확정 입력을 0.5초치씩 올리면 관전자가 그대로 다시 돌림)
 * 방은 휘발성 데이터라 메모리에만 둠 (서버를 다시 띄우면 진행 중인 방은 사라짐).
 *
 * 구독 채널
 *   fight.lobby                        방 목록 (로그인 없이도 가능)
 *   fight.room   { id }                방 상태 (없으면 null)
 *   fight.chat   { id }                대기실 채팅
 *   fight.sig    { id, pair }          WebRTC 연결 정보 — 선수만
 *   fight.relay  { id, seat }          그 자리 선수의 마지막 입력 꾸러미 — 선수만
 *   fight.watch  { id, match, seat }   관전용 입력 기록
 */

interface Player {
  nick: string;
  seat: 0 | 1;
  /** 고른 캐릭터 (-1 = 랜덤) */
  ch: number;
  ready: boolean;
  joinedAt: number;
}
interface RoomState {
  phase: "wait" | "play";
  /** 매치마다 새 id — 다른 판의 입력이 섞이지 않게 */
  match: string;
  chars: [number, number];
  map: number;
  /** 방장이 고른 맵 (-1 = 랜덤) */
  pick: number;
  delay: number;
  maxRb: number;
}
interface ChatMsg {
  id: string;
  uid: string;
  nick: string;
  text: string;
  ts: number;
}
interface SigPart {
  n: string;
  sdp: string;
}
interface Chunk {
  n: number;
  f: number;
  i: string;
}

interface Room {
  id: string;
  name: string;
  hostUid: string;
  /** 방을 만든 사람 닉네임 (로비 표시용) */
  hostNick: string;
  createdAt: number;
  seats: [string, string];
  players: Record<string, Player>;
  state: RoomState;
  /** 관전 중인 사람 */
  watchers: Record<string, { nick: string; at: number }>;
  chat: ChatMsg[];
  /** pair("0번자리uid_1번자리uid") → 연결 정보 */
  sig: Map<string, { offer?: SigPart; answer?: SigPart }>;
  relay: [string | null, string | null];
  /** 이번 경기의 자리별 입력 기록 */
  watch: [Chunk[], Chunk[]];
  watchMatch: string;
  /** 자리 주인 소켓 — 끊기면 자리에서 뺌 */
  owners: Map<string, string>;
  watcherOwners: Map<string, string>;
  emptySince: number;
}

const emptyState = (): RoomState => ({ phase: "wait", match: "", chars: [0, 1], map: 0, pick: -1, delay: 2, maxRb: 10 });

const CHAT_KEEP = 100;
const CHAT_SNAPSHOT = 40;
const MAX_ROOMS = 500;
/** 한 경기에서 자리별로 보관하는 입력 기록 조각 수 (0.5초 × 14,400 = 2시간) */
const MAX_CHUNKS = 14_400;

const roomId = z.string().min(1).max(40);
const idOnly = z.object({ id: roomId });
const nick = z.string().min(1).max(10);
const seatSchema = z.union([z.literal(0), z.literal(1)]);
const ch = z.number().int().min(-1).max(999);
const sigPart = z.object({ n: z.string().max(40), sdp: z.string().max(30_000) });
const pairSchema = z.string().min(3).max(300);

export interface FightOptions {
  /** 이만큼 비어 있던 방은 정리 */
  emptyRoomTtlMs?: number;
  /** 정리 주기 */
  sweepIntervalMs?: number;
}

export function registerFight({ gateway, users }: Deps, opts: FightOptions = {}) {
  const rooms = new Map<string, Room>();
  const emptyRoomTtl = opts.emptyRoomTtlMs ?? 30 * 60_000;

  const LOBBY = "fight:lobby";
  const roomKey = (id: string) => `fight:room:${id}`;
  const chatKey = (id: string) => `fight:chat:${id}`;
  const sigKey = (id: string, pair: string) => `fight:sig:${id}:${pair}`;
  const relayKey = (id: string, seat: number) => `fight:relay:${id}:${seat}`;
  const watchKey = (id: string, match: string, seat: number) => `fight:watch:${id}:${match}:${seat}`;

  // ───────────── 내보내기 ─────────────

  /** 클라이언트가 예전과 같은 방식으로 풀어 쓸 수 있는 모양 */
  const roomWire = (r: Room) => ({
    meta: { name: r.name, hostUid: r.hostUid, createdAt: r.createdAt },
    seats: { ...(r.seats[0] ? { 0: r.seats[0] } : {}), ...(r.seats[1] ? { 1: r.seats[1] } : {}) },
    players: r.players,
    state: r.state,
    watchers: r.watchers,
  });
  const lobbyWire = () =>
    [...rooms.values()].map((r) => ({
      id: r.id,
      name: r.name,
      host: r.hostNick,
      count: Object.keys(r.players).length,
      playing: r.state.phase === "play",
      createdAt: r.createdAt,
    }));

  let lobbyDirty = false;
  function changed(room: Room) {
    gateway.emit(roomKey(room.id), "room", roomWire(room));
    if (lobbyDirty) return;
    lobbyDirty = true;
    queueMicrotask(() => {
      lobbyDirty = false;
      gateway.emit(LOBBY, "list", lobbyWire());
    });
  }

  function removeRoom(room: Room) {
    rooms.delete(room.id);
    gateway.emit(roomKey(room.id), "room", null);
    gateway.emit(LOBBY, "list", lobbyWire());
    gateway.revoke(chatKey(room.id));
    for (const pair of room.sig.keys()) gateway.revoke(sigKey(room.id, pair));
    for (const seat of [0, 1]) {
      gateway.revoke(relayKey(room.id, seat));
      gateway.revoke(watchKey(room.id, room.watchMatch, seat));
    }
  }

  /** 자리·선수 항목을 지움. 방장이었으면 남은 사람이 이어받음 */
  function removePlayer(room: Room, uid: string) {
    const p = room.players[uid];
    if (!p) return;
    delete room.players[uid];
    room.owners.delete(uid);
    for (const seat of [0, 1] as const) if (room.seats[seat] === uid) room.seats[seat] = "";
    const rest = Object.entries(room.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    if (!room.players[room.hostUid] && rest.length) room.hostUid = rest[0][0];
    if (!rest.length) room.emptySince = Date.now();
    // 선수가 아니게 됐으니 선수 전용 구독은 끊음
    const isGone = (c: Ctx) => c.user?.uid === uid;
    for (const pair of room.sig.keys()) gateway.revoke(sigKey(room.id, pair), isGone);
    for (const seat of [0, 1]) gateway.revoke(relayKey(room.id, seat), isGone);
    changed(room);
  }

  function removeWatcher(room: Room, uid: string) {
    if (!room.watchers[uid]) return;
    delete room.watchers[uid];
    room.watcherOwners.delete(uid);
    changed(room);
  }

  // ───────────── 권한 ─────────────

  const noRoom = () => new AppError("NO_ROOM", "no room", 404);
  const getRoom = (id: string): Room => {
    const room = rooms.get(id);
    if (!room) throw noRoom();
    return room;
  };
  function asPlayer(ctx: Ctx, id: string) {
    const room = getRoom(id);
    const uid = ctx.uid;
    const me = room.players[uid];
    if (!me) throw forbidden();
    return { room, uid, me };
  }

  // ───────────── 구독 채널 ─────────────

  gateway.channel("fight.lobby", { key: () => LOBBY, snapshot: () => lobbyWire() });

  gateway.channel("fight.room", {
    key(ctx, p) {
      void ctx.uid; // 로그인한 사람만 (관전자 포함)
      return roomKey(idOnly.parse(p).id);
    },
    snapshot(_ctx, _key, p) {
      const room = rooms.get(idOnly.parse(p).id);
      return room ? roomWire(room) : null;
    },
  });

  gateway.channel("fight.chat", {
    key(ctx, p) {
      void ctx.uid;
      return chatKey(idOnly.parse(p).id);
    },
    snapshot: (_ctx, _key, p) => (rooms.get(idOnly.parse(p).id)?.chat ?? []).slice(-CHAT_SNAPSHOT),
  });

  const sigParams = z.object({ id: roomId, pair: pairSchema });
  gateway.channel("fight.sig", {
    key(ctx, p) {
      const { id, pair } = sigParams.parse(p);
      asPlayer(ctx, id);
      return sigKey(id, pair);
    },
    snapshot(_ctx, _key, p) {
      const { id, pair } = sigParams.parse(p);
      return rooms.get(id)?.sig.get(pair) ?? null;
    },
  });

  const relayParams = z.object({ id: roomId, seat: seatSchema });
  gateway.channel("fight.relay", {
    key(ctx, p) {
      const { id, seat } = relayParams.parse(p);
      asPlayer(ctx, id);
      return relayKey(id, seat);
    },
    snapshot(_ctx, _key, p) {
      const { id, seat } = relayParams.parse(p);
      return rooms.get(id)?.relay[seat] ?? null;
    },
  });

  const watchParams = z.object({ id: roomId, match: z.string().min(1).max(40), seat: seatSchema });
  gateway.channel("fight.watch", {
    key(ctx, p) {
      void ctx.uid;
      const { id, match, seat } = watchParams.parse(p);
      return watchKey(id, match, seat);
    },
    snapshot(_ctx, _key, p) {
      const { id, match, seat } = watchParams.parse(p);
      const room = rooms.get(id);
      return room && room.watchMatch === match ? room.watch[seat] : [];
    },
  });

  // ───────────── 방 만들기 · 입장 · 퇴장 ─────────────

  gateway.rpc("fight.createRoom", (ctx, raw) => {
    const o = z.object({ nick, name: z.string().max(60) }).parse(raw);
    const uid = ctx.uid;
    if (rooms.size >= MAX_ROOMS) throw bad("방이 너무 많아요. 잠시 후 다시 시도해주세요.");
    const now = Date.now();
    const room: Room = {
      id: newId(),
      name: o.name.trim().slice(0, 20) || `${ctx.nick ?? o.nick}의 방`,
      hostUid: uid,
      // 이름은 서버가 정함: 회원이면 별명, 아니면 적은 이름에 비회원 표시
      hostNick: ctx.name(o.nick),
      createdAt: now,
      seats: ["", ""],
      players: {},
      state: emptyState(),
      watchers: {},
      chat: [],
      sig: new Map(),
      relay: [null, null],
      watch: [[], []],
      watchMatch: "",
      owners: new Map(),
      watcherOwners: new Map(),
      emptySince: now,
    };
    rooms.set(room.id, room);
    changed(room);
    return room.id;
  });

  /** 그 자리에 앉을 수 있나: 비었거나, 내 자리거나, 주인이 방에 없는(버려진) 자리 */
  const canTake = (room: Room, seat: 0 | 1, uid: string) => {
    const owner = room.seats[seat];
    return !owner || owner === uid || !room.players[owner];
  };

  function sit(ctx: Ctx, room: Room, seat: 0 | 1, o: { nick: string; ch: number; joinedAt?: number }) {
    const uid = ctx.uid;
    // 다른 자리에 내 이름이 남아 있으면 비움 (한 사람이 두 자리를 차지하지 않게)
    const otherSeat = (1 - seat) as 0 | 1;
    if (room.seats[otherSeat] === uid) room.seats[otherSeat] = "";
    room.seats[seat] = uid;
    const now = Date.now();
    room.players[uid] = {
      nick: ctx.name(o.nick),
      seat,
      ch: o.ch,
      ready: false,
      joinedAt: Math.max(room.createdAt, Math.min(now, o.joinedAt ?? now)),
    };
    room.owners.set(uid, ctx.socket.id);
    // 방장이 방에 없으면(만든 직후 등) 지금 들어온 사람이 방장
    if (!room.players[room.hostUid]) room.hostUid = uid;
    changed(room);
  }

  const joinSchema = z.object({ id: roomId, nick, ch, joinedAt: z.number().finite().optional() });
  /** 빈자리를 차지하고 입장 (꽉 찼으면 ROOM_FULL) */
  gateway.rpc("fight.join", (ctx, raw) => {
    const o = joinSchema.parse(raw);
    const uid = ctx.uid;
    const room = getRoom(o.id);
    // 끊겼다 다시 온 경우 원래 자리부터
    const order: (0 | 1)[] =
      room.seats[1] === uid ? [1, 0] : room.seats[0] === uid ? [0, 1] : room.seats[0] ? [1, 0] : [0, 1];
    const seat = order.find((s) => canTake(room, s, uid));
    if (seat === undefined) throw new AppError("ROOM_FULL", "room full", 409);
    sit(ctx, room, seat, o);
    return { seat };
  });

  /** 정해진 자리에 다시 앉기 (잠깐 끊겼다 다시 연결됐을 때 자리 복구) */
  gateway.rpc("fight.takeSeat", (ctx, raw) => {
    const o = joinSchema.extend({ seat: seatSchema }).parse(raw);
    const room = getRoom(o.id);
    // 복구는 비어 있거나 내 자리일 때만 (그 사이 다른 사람이 앉았으면 실패)
    const owner = room.seats[o.seat];
    if (owner && owner !== ctx.uid) throw new AppError("ROOM_FULL", "room full", 409);
    sit(ctx, room, o.seat, o);
    return { seat: o.seat };
  });

  gateway.rpc("fight.leave", (ctx, raw) => {
    const room = rooms.get(idOnly.parse(raw).id);
    const uid = ctx.uid;
    if (!room) return null;
    removePlayer(room, uid);
    // 나간 뒤 아무도 없으면 방 정리
    if (!Object.keys(room.players).length) removeRoom(room);
    return null;
  });

  /** 아무도 없는 방 정리 (로비 화면이 요청) */
  gateway.rpc("fight.cleanupEmptyRoom", (ctx, raw) => {
    void ctx.uid;
    const room = rooms.get(idOnly.parse(raw).id);
    if (room && !Object.keys(room.players).length) removeRoom(room);
    return null;
  });

  // 소켓이 끊기면 그 소켓으로 차지한 자리·관전 표시를 지움
  gateway.onDisconnect((ctx) => {
    const uid = ctx.user?.uid;
    if (!uid) return;
    for (const room of rooms.values()) {
      if (room.owners.get(uid) === ctx.socket.id) removePlayer(room, uid);
      if (room.watcherOwners.get(uid) === ctx.socket.id) removeWatcher(room, uid);
    }
  });

  // ───────────── 대기실 ─────────────

  gateway.rpc("fight.setChar", (ctx, raw) => {
    const o = z.object({ id: roomId, ch }).parse(raw);
    const { room, me } = asPlayer(ctx, o.id);
    me.ch = o.ch;
    changed(room);
    return null;
  });

  gateway.rpc("fight.setReady", (ctx, raw) => {
    const o = z.object({ id: roomId, ready: z.boolean() }).parse(raw);
    const { room, me } = asPlayer(ctx, o.id);
    me.ready = o.ready;
    changed(room);
    return null;
  });

  /** 방장: 맵 고르기 (-1 = 랜덤) */
  gateway.rpc("fight.setPick", (ctx, raw) => {
    const o = z.object({ id: roomId, pick: z.number().int().min(-1).max(999) }).parse(raw);
    const { room, uid } = asPlayer(ctx, o.id);
    if (room.hostUid !== uid) throw forbidden();
    room.state = { ...room.state, pick: o.pick };
    changed(room);
    return null;
  });

  gateway.rpc("fight.sendChat", (ctx, raw) => {
    const o = z.object({ id: roomId, nick: z.string().max(10), text: z.string().min(1).max(100) }).parse(raw);
    const { room, uid } = asPlayer(ctx, o.id);
    const msg: ChatMsg = { id: orderedId(), uid, nick: room.players[uid]?.nick ?? ctx.name(o.nick), text: o.text, ts: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    gateway.emit(chatKey(room.id), "add", msg);
    return null;
  });

  /**
   * 방장: 경기 시작. 랜덤 캐릭터·맵과 입력 지연은 방장 쪽에서 정해서 보냄
   * (P2P 여부·왕복 시간은 브라우저만 알 수 있음). 서버는 권한과 값 범위만 확인.
   */
  const startSchema = z.object({
    id: roomId,
    chars: z.tuple([z.number().int().min(0).max(999), z.number().int().min(0).max(999)]),
    map: z.number().int().min(0).max(999),
    delay: z.number().int().min(0).max(30),
    maxRb: z.number().int().min(0).max(120),
  });
  gateway.rpc("fight.startMatch", (ctx, raw) => {
    const o = startSchema.parse(raw);
    const { room, uid } = asPlayer(ctx, o.id);
    if (room.hostUid !== uid) throw forbidden();
    if (!room.players[room.seats[0]] || !room.players[room.seats[1]]) throw bad("상대가 없습니다.");
    // 지난 경기 관전 기록 정리
    for (const seat of [0, 1]) gateway.revoke(watchKey(room.id, room.watchMatch, seat));
    const match = orderedId();
    room.watch = [[], []];
    room.watchMatch = match;
    room.state = { ...room.state, phase: "play", match, chars: o.chars, map: o.map, delay: o.delay, maxRb: o.maxRb };
    changed(room);
    // 회원이면 온라인 경기 수를 세어 둠 (승패는 서버가 알 수 없어서 경기 수만)
    for (const seat of room.seats) if (seat) users.bump(seat, { "stats.fight.matches": 1 });
    return match;
  });

  /** 경기가 끝나면 대기실 상태로 */
  gateway.rpc("fight.endMatch", (ctx, raw) => {
    const o = z.object({ id: roomId, match: z.string().max(40) }).parse(raw);
    const { room } = asPlayer(ctx, o.id);
    if (room.state.match !== o.match || room.state.phase !== "play") return null;
    room.state = { ...room.state, phase: "wait" };
    changed(room);
    return null;
  });

  // ───────────── WebRTC 연결 정보 · 입력 중계 ─────────────

  /** 0번 자리가 연결을 제안 — 그 쌍의 이전 정보(answer 포함)는 지워짐 */
  gateway.rpc("fight.sigOffer", (ctx, raw) => {
    const o = z.object({ id: roomId, pair: pairSchema, offer: sigPart }).parse(raw);
    const { room } = asPlayer(ctx, o.id);
    const value = { offer: o.offer };
    room.sig.set(o.pair, value);
    if (room.sig.size > 20) room.sig.delete(room.sig.keys().next().value!);
    gateway.emit(sigKey(room.id, o.pair), "value", value);
    return null;
  });

  gateway.rpc("fight.sigAnswer", (ctx, raw) => {
    const o = z.object({ id: roomId, pair: pairSchema, answer: sigPart }).parse(raw);
    const { room } = asPlayer(ctx, o.id);
    const value = { ...(room.sig.get(o.pair) ?? {}), answer: o.answer };
    room.sig.set(o.pair, value);
    gateway.emit(sigKey(room.id, o.pair), "value", value);
    return null;
  });

  /** P2P가 안 될 때 입력 중계: 내 자리의 마지막 꾸러미를 상대에게 */
  gateway.rpc("fight.relay", (ctx, raw) => {
    const o = z.object({ id: roomId, v: z.string().max(2000) }).parse(raw);
    const { room, uid, me } = asPlayer(ctx, o.id);
    if (room.seats[me.seat] !== uid) throw forbidden();
    room.relay[me.seat] = o.v;
    gateway.emit(relayKey(room.id, me.seat), "value", o.v);
    return null;
  });

  // ───────────── 관전 ─────────────

  /** 선수: 내 확정 입력 0.25초치 */
  gateway.rpc("fight.watchChunk", (ctx, raw) => {
    const o = z
      .object({ id: roomId, match: z.string().max(40), n: z.number().int().min(0), f: z.number(), i: z.string().max(400) })
      .parse(raw);
    const { room, me } = asPlayer(ctx, o.id);
    if (room.watchMatch !== o.match) return null;
    const list = room.watch[me.seat];
    if (list.length >= MAX_CHUNKS) return null;
    const chunk: Chunk = { n: o.n, f: o.f, i: o.i };
    list.push(chunk);
    gateway.emit(watchKey(room.id, o.match, me.seat), "add", chunk);
    return null;
  });

  gateway.rpc("fight.watchJoin", (ctx, raw) => {
    const o = z.object({ id: roomId, nick: z.string().max(10) }).parse(raw);
    const uid = ctx.uid;
    const room = rooms.get(o.id);
    if (!room) return null;
    room.watchers[uid] = { nick: ctx.name(o.nick), at: Date.now() };
    room.watcherOwners.set(uid, ctx.socket.id);
    changed(room);
    return null;
  });

  gateway.rpc("fight.watchLeave", (ctx, raw) => {
    const room = rooms.get(idOnly.parse(raw).id);
    if (room) removeWatcher(room, ctx.uid);
    return null;
  });

  // ───────────── 오래 비어 있는 방 정리 ─────────────

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()])
      if (!Object.keys(room.players).length && now - room.emptySince >= emptyRoomTtl) removeRoom(room);
  }, opts.sweepIntervalMs ?? 5 * 60_000);
  sweep.unref();

  return {
    close() {
      clearInterval(sweep);
    },
  };
}
