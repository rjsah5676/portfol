import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad, forbidden } from "../errors";
import { newId, orderedId } from "../ids";
import type { Ctx } from "../realtime/gateway";
import type { LiveRoom } from "../http/admin";
import { RESTORED, RESTORE_GRACE_MS, type LiveGame } from "../live";
import { forfeit, newResult, onEnd, settle, type FightResult, type Outcome } from "./fightResult";
import { BOT_MAX, createFightRating, type Margin } from "./fightRating";
import { uniqueNickname } from "./poker/nicknames";
import { botBuild, replayBot } from "./fightBot";
import { CHARS } from "../../../web/src/lib/fight/chars";
import { skinOf } from "../../../web/src/lib/fight/skins";

/*
 * 픽셀 격투 온라인 대전
 *
 * 경기 자체는 브라우저끼리 한다 (WebRTC 데이터 채널로 입력을 주고받고 롤백 넷코드로 맞춤).
 * 서버는 그 주변만 맡음 (기존에 Firebase Realtime Database가 하던 역할):
 *  - 대기실: 방 목록, 자리(최대 2명), 캐릭터·준비, 채팅, 경기 시작/끝 상태
 *  - WebRTC 연결 정보(offer/answer) 전달
 *  - P2P 연결이 안 될 때 입력 중계 (느리지만 됨)
 *  - 관전용 입력 기록 (선수가 확정 입력을 0.5초치씩 올리면 관전자가 그대로 다시 돌림)
 *  - 승패 기록 (두 선수가 본 결과를 맞춰 보고 회원 전적에 — fightResult.ts)
 *  - 랭크전: 회원끼리 자동 매칭(큐, 레이팅 비슷한 사람부터 — 기다릴수록 범위가 넓어짐) → 둘 다 수락하면 로비에 안 보이는
 *    전용 방(맵은 서버가 랜덤, 캐릭터는 고름, 한 판만) → 결과가 정해지면 레이팅·캐릭터 통계 (fightRating.ts). 일반 방 대전은 레이팅 없음
 *  - 12초 안에 사람을 못 찾으면 비슷한 레이팅의 봇(AI)과 매칭 — 경기는 브라우저에서 돌리고(봇 = web lib/fight/ai.ts),
 *    끝나면 내 입력 기록을 보내서 서버가 같은 경기를 다시 돌려 결과를 확인 (fightBot.ts) → 레이팅
 * 방은 휘발성 데이터라 메모리에만 둠. 배포로 서버를 다시 띄울 때만 저장했다가 이어받음 (live.ts) —
 * 경기는 브라우저끼리 하므로 서버가 잠깐 내려가도 이어지고, 결과는 다시 켜진 서버에 알리면 됨.
 *
 * 구독 채널
 *   fight.lobby                        방 목록 (로그인 없이도 가능)
 *   fight.room   { id }                방 상태 (없으면 null)
 *   fight.chat   { id }                대기실 채팅
 *   fight.sig    { id, pair }          WebRTC 연결 정보 — 선수만
 *   fight.relay  { id, seat }          그 자리 선수의 마지막 입력 꾸러미 — 선수만
 *   fight.watch  { id, match, seat }   관전용 입력 기록
 *   fight.rank                         내 랭크전 매칭 상태 (idle / queue / found / room)
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
  /** 경기 시작 때 두 선수가 그 캐릭터에 착용한 스킨 ("" = 기본) — 서버가 회원 문서에서 확인 */
  skins: [string, string];
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
  /** 이번 경기 승패 (회원 전적용) */
  result: FightResult | null;
  /** 랭크전 방 (매칭으로 만든 방: 로비에 안 보임, 두 사람만, 한 판만) */
  rank: RankRoom | null;
}
interface RankRoom {
  uids: [string, string];
  /** 서버가 정한 맵 */
  map: number;
  /** 경기를 시작했나 (한 판만) */
  used: boolean;
  /** 결과를 기록했나 (한 번만) */
  recorded: boolean;
  /** 두 선수가 알려 온 경기 내용 (배치 보정용) */
  margins: [Margin | null, Margin | null];
  /** 레이팅 반영 결과 (rated=false: 같은 상대와 하루 판 수를 넘음) — 계산이 끝나면 채워짐 */
  result: { out: 0 | 1 | 2; rated: boolean; delta?: [number, number]; r?: [number, number] } | null;
  /** 이때까지 시작 안 하면 방을 닫음 */
  deadline: number;
}

/** 랭크전 매칭 상태 (fight.rank 채널) */
type RankStatus =
  | { s: "idle"; note?: string }
  | { s: "queue"; since: number; note?: string }
  | { s: "found"; id: string; deadline: number; accepted: boolean; opp: { nick: string; r: number; n: number }; me: { r: number; n: number } }
  | { s: "room"; room: string }
  /** 봇과 매칭: 캐릭터 고르기 (맵은 공개) */
  | { s: "bot"; id: string; deadline: number; opp: { nick: string; r: number; n: number }; me: { r: number; n: number }; map: number }
  /** 봇전 경기 중 */
  | { s: "botplay"; id: string; opp: { nick: string; r: number } }
  /** 봇전 끝 (out: 0 = 나 승, 1 = 상대 승, 2 = 무승부) */
  | { s: "botEnd"; out: 0 | 1 | 2; opp: { nick: string; r: number }; delta?: number; r?: number; note?: string };
interface QEntry {
  uid: string;
  nick: string;
  build: string;
  /** 봇전용 빌드 지문 (게임 데이터 + AI) — 서버와 같아야 봇과 붙음 */
  bot: string;
  maps: number;
  socket: string;
  since: number;
  r: number;
  n: number;
}
/** 봇전 표 (한 번만 씀) */
interface BotTicket {
  id: string;
  uid: string;
  nick: string;
  opp: { nick: string; r: number; n: number };
  /** 봇 캐릭터 (경기를 시작할 때 공개) · 맵 · 봇 난수 씨앗 */
  botCh: number;
  map: number;
  seed: number;
  /** check = 결과 기록을 받아 다시 돌려 보는 중 */
  stage: "found" | "room" | "play" | "check" | "done";
  /** 내 캐릭터 · 시작 시각 */
  ch: number;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}
interface Pending {
  id: string;
  a: QEntry;
  b: QEntry;
  acc: Set<string>;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
}
/** 매칭되고 수락을 기다리는 시간 */
const RANK_ACCEPT_MS = 15_000;
/** 랭크전 방에서 경기를 시작해야 하는 시간 (캐릭터 고르고 준비) */
const RANK_START_MS = 90_000;
/** 이만큼 사람을 못 찾으면 봇과 매칭 */
export const RANK_BOT_MS = 12_000;
/** 레이팅 매칭 범위: 처음 ±150, 1초 기다릴 때마다 +100 */
const rankWindow = (waitMs: number) => 150 + (100 * waitMs) / 1000;
/** 봇전: 시작하고 이 시간 안에 결과를 안 보내면 패배 */
const BOT_PLAY_MS = 12 * 60_000;
/** 봇전 결과로 받는 입력 기록 최대 프레임 (3라운드 × 99초 + 연출, 넉넉히) */
const BOT_MAX_FRAMES = 40_000;

const emptyState = (): RoomState => ({ phase: "wait", match: "", chars: [0, 1], map: 0, pick: -1, delay: 2, maxRb: 10, skins: ["", ""] });

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

export function registerFight({ gateway, users, db }: Deps, opts: FightOptions = {}) {
  const rating = createFightRating(db, users);
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
    rank: r.rank ? { used: r.rank.used, result: r.rank.result, deadline: r.rank.deadline } : null,
  });
  const lobbyWire = () =>
    [...rooms.values()].filter((r) => !r.rank).map((r) => ({
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
    // 경기에 나섰던 선수가 나감 → 남은 쪽이 결과를 알려 오거나 경기를 끝내면 그걸로 정함
    // (경기가 끝난 직후 결과를 알리기 전에 나간 경우도 — 남은 쪽 신고로 정해지게)
    const r = room.result;
    if (r && !r.done) {
      const seat = r.uids.indexOf(uid);
      if (seat >= 0) {
        r.gone[seat] = true;
        record(room, settle(r));
      }
    }
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

  /** 승패가 정해졌으면 회원 전적에 (비회원 uid 는 bump 가 알아서 무시) */
  function record(room: Room, out: Outcome | "void" | null) {
    const r = room.result;
    if (!r || out === null || out === "void") return;
    for (const seat of [0, 1] as const) {
      const uid = r.uids[seat];
      if (!uid) continue;
      const k = out === 2 ? "d" : out === seat ? "w" : "l";
      users.bump(uid, { [`stats.online.fight.${k}`]: 1 });
    }
    // 랭크전이면 레이팅·캐릭터 통계 (fightRating.ts) — 결과는 방에 실어 보냄 (결과 화면에 점수 변화)
    const rk = room.rank;
    if (rk && !rk.recorded) {
      rk.recorded = true;
      const uids: [string, string] = [r.uids[0], r.uids[1]];
      rating.logGame(uids, [room.state.chars[0], room.state.chars[1]], room.state.map, out).catch((e) => console.warn("[fight] 랭크전 기록 실패", e));
      const done = (res: Awaited<ReturnType<typeof rating.rate>>) => {
        rk.result = res ? { out, rated: true, delta: res.delta, r: res.r } : { out, rated: false };
        if (rooms.has(room.id)) changed(room);
      };
      // 경기 내용은 두 선수가 알려 온 것 중 덜 압도적인 쪽 (한쪽이 부풀려도 소용없게)
      const ms = rk.margins.filter((m): m is Margin => !!m);
      const m = ms.length ? ms.reduce((a, b) => (a.rounds + a.hp <= b.rounds + b.hp ? a : b)) : null;
      rating.rate(uids, out, out === 2 ? null : m).then(done, (e) => {
        console.warn("[fight] 레이팅 저장 실패", e);
        done(null);
      });
    }
  }
  /** 경기에 나선 자리 (그 경기 선수가 아니면 -1) */
  const resultSeat = (room: Room, uid: string, match: string) =>
    room.result && room.result.match === match ? room.result.uids.indexOf(uid) : -1;

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
  /** 배포로 곧 다시 시작함 → 새 경기·매칭은 받지 않음 */
  let draining = false;
  const notWhileDraining = () => {
    if (draining) throw new AppError("RESTARTING", "서버 업데이트 중이에요. 잠시 후 다시 시작해주세요.", 503);
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
    snapshot(ctx, _key, p) {
      const room = rooms.get(idOnly.parse(p).id);
      if (!room) return null;
      // 서버가 다시 켜진 뒤 처음 들어온 연결 → 그 사람 자리의 주인으로 (이 연결이 끊기면 자리를 비움)
      const uid = ctx.user?.uid;
      if (uid && room.owners.get(uid) === RESTORED) room.owners.set(uid, ctx.socket.id);
      return roomWire(room);
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
      result: null,
      rank: null,
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
    // 경기 중에 잠깐 끊겼다 돌아옴 → 나간 걸로 치지 않음
    const r = room.result;
    if (r && !r.done) {
      const rs = r.uids.indexOf(uid);
      if (rs >= 0) r.gone[rs] = false;
    }
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
    // 랭크전 방은 매칭된 두 사람만, 정해진 자리에
    if (room.rank) {
      const seat = room.rank.uids.indexOf(uid);
      if (seat < 0) throw new AppError("ROOM_FULL", "room full", 409);
      sit(ctx, room, seat as 0 | 1, o);
      return { seat };
    }
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
    if (room.rank && room.rank.uids[o.seat] !== ctx.uid) throw new AppError("ROOM_FULL", "room full", 409);
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
    // 나간 뒤 아무도 없으면 방 정리. 랭크전 방은 시작 전에 한 명이라도 나가면 취소
    if (!Object.keys(room.players).length || (room.rank && !room.rank.used)) removeRoom(room);
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
    // 랭크전 큐·매칭에서 빼기 (그 소켓으로 들어온 경우만)
    const qi = queue.findIndex((q) => q.uid === uid && q.socket === ctx.socket.id);
    if (qi >= 0) {
      queue.splice(qi, 1);
      rankStatus.delete(uid);
    }
    const pd = pendingOf(uid);
    if (pd && (pd.a.uid === uid ? pd.a : pd.b).socket === ctx.socket.id) dropPending(pd, new Set([uid]), "상대 연결이 끊겨서 다시 찾는 중");
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
    if (room.hostUid !== uid || room.rank) throw forbidden();
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
  /** 그 회원이 그 캐릭터에 착용한 스킨 (가진 것만, 비회원 · 없으면 "") */
  async function wornSkin(uid: string, ch: number): Promise<string> {
    const id = CHARS[ch]?.id;
    if (!uid || !id) return "";
    const d = (await db.col("users").findOne({ _id: uid } as never, { projection: { fightWear: 1, "inv.fight": 1 } }).catch(() => null)) as {
      fightWear?: Record<string, string>;
      inv?: { fight?: string[] };
    } | null;
    const s = d?.fightWear?.[id];
    return s && skinOf(s)?.ch === id && (d?.inv?.fight ?? []).includes(s) ? s : "";
  }

  gateway.rpc("fight.startMatch", async (ctx, raw) => {
    const o = startSchema.parse(raw);
    const { room, uid } = asPlayer(ctx, o.id);
    if (room.hostUid !== uid) throw forbidden();
    notWhileDraining();
    if (!room.players[room.seats[0]] || !room.players[room.seats[1]]) throw bad("상대가 없습니다.");
    // (경기 중에 다시 시작하는 것은 원래대로 허용 — 새 경기로 바뀜)
    const before = room.state.match;
    const seats = [room.seats[0], room.seats[1]];
    const skins = (await Promise.all([0, 1].map((k) => wornSkin(seats[k], o.chars[k])))) as [string, string];
    // 스킨을 읽는 사이에 다른 시작 요청이 먼저 처리됐거나 자리가 바뀌었으면 이번 건 버림
    if (room.state.match !== before || room.seats[0] !== seats[0] || room.seats[1] !== seats[1])
      throw bad("이미 경기가 시작됐어요.");
    if (!room.players[room.seats[0]] || !room.players[room.seats[1]]) throw bad("상대가 없습니다.");
    // 랭크전: 한 판만, 맵은 서버가 정한 것
    if (room.rank) {
      if (room.rank.used) throw bad("랭크전은 한 판만 해요.");
      room.rank.used = true;
      o.map = room.rank.map;
    }
    // 지난 경기 관전 기록 정리
    for (const seat of [0, 1]) gateway.revoke(watchKey(room.id, room.watchMatch, seat));
    const match = orderedId();
    room.watch = [[], []];
    room.watchMatch = match;
    room.state = { ...room.state, phase: "play", match, chars: o.chars, map: o.map, delay: o.delay, maxRb: o.maxRb, skins };
    room.result = newResult(match, [room.seats[0], room.seats[1]]);
    changed(room);
    // 회원이면 온라인 경기 수를 세어 둠 (승패는 끝난 뒤 fight.result 로)
    for (const seat of room.seats) if (seat) users.bump(seat, { "stats.fight.matches": 1 });
    return match;
  });

  /** 선수: 내가 본 경기 결과 (0 = 1P 승, 1 = 2P 승, 2 = 무승부) */
  gateway.rpc("fight.result", (ctx, raw) => {
    const o = z
      .object({
        id: roomId,
        match: z.string().max(40),
        winner: z.union([z.literal(0), z.literal(1), z.literal(2)]),
        /** 이긴 쪽 기준 라운드 차 · 마지막 라운드 남은 체력 (랭크전 배치 보정) */
        margin: z.object({ rounds: z.number().int().min(0).max(3), hp: z.number().min(0).max(1) }).optional(),
      })
      .parse(raw);
    const room = getRoom(o.id);
    const seat = resultSeat(room, ctx.uid, o.match);
    const r = room.result;
    if (!r || seat < 0 || r.done || r.reports[seat] !== null) return null;
    r.reports[seat] = o.winner;
    if (room.rank && o.margin) room.rank.margins[seat] = o.margin;
    record(room, settle(r));
    return null;
  });

  /** 선수: 경기 중에 스스로 나감 (기권 — 내 패배) */
  gateway.rpc("fight.forfeit", (ctx, raw) => {
    const o = z.object({ id: roomId, match: z.string().max(40) }).parse(raw);
    const room = getRoom(o.id);
    const seat = resultSeat(room, ctx.uid, o.match);
    if (!room.result || seat < 0) return null;
    record(room, forfeit(room.result, seat as 0 | 1));
    return null;
  });

  /** 경기가 끝나면 대기실 상태로 */
  gateway.rpc("fight.endMatch", (ctx, raw) => {
    const o = z.object({ id: roomId, match: z.string().max(40) }).parse(raw);
    const { room } = asPlayer(ctx, o.id);
    if (room.state.match !== o.match || room.state.phase !== "play") return null;
    room.state = { ...room.state, phase: "wait" };
    if (room.result?.match === o.match) record(room, onEnd(room.result));
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
    if (!room || room.rank) return null;
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

  // ───────────── 랭크전 매칭 ─────────────
  // 회원만. 같은 빌드(게임 데이터 지문)끼리, 레이팅이 비슷한 사람부터 짝지음 (처음 ±150, 기다릴수록 넓어짐)
  // → 둘 다 수락하면 전용 방. 한쪽이 거절하거나 시간 안에 안 누르면, 수락한 쪽은 다시 큐 맨 앞으로
  // 12초 안에 못 찾으면 비슷한 레이팅의 봇(별명은 사람처럼)과 매칭 → 브라우저에서 경기 → 입력 기록으로 서버가 확인

  const rankKey = (uid: string) => `fight:rank:${uid}`;
  const rankStatus = new Map<string, RankStatus>();
  const queue: QEntry[] = [];
  const pending = new Map<string, Pending>();
  const pendingOf = (uid: string) => [...pending.values()].find((p) => p.a.uid === uid || p.b.uid === uid);
  const tickets = new Map<string, BotTicket>();
  const ticketOf = (uid: string) => [...tickets.values()].find((t) => t.uid === uid && t.stage !== "done");
  const SERVER_BOT = botBuild();

  function setRank(uid: string, st: RankStatus) {
    if (st.s === "idle" && !st.note) rankStatus.delete(uid);
    else rankStatus.set(uid, st);
    gateway.emit(rankKey(uid), "value", st);
  }

  gateway.channel("fight.rank", {
    key: (ctx) => rankKey(ctx.uid),
    snapshot: (ctx) => rankStatus.get(ctx.uid) ?? { s: "idle" },
  });

  function enqueue(e: QEntry, front = false, note?: string) {
    const i = queue.findIndex((q) => q.uid === e.uid);
    if (i >= 0) queue.splice(i, 1);
    if (front) queue.unshift(e);
    else queue.push(e);
    setRank(e.uid, { s: "queue", since: e.since, note });
    tryMatch();
  }

  /** 짝짓기: 오래 기다린 사람부터, 범위 안에서 레이팅이 가장 가까운 사람과. 12초 넘게 못 찾으면 봇 */
  function tryMatch() {
    const now = Date.now();
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i];
      let best = -1;
      let bestGap = Infinity;
      for (let k = 0; k < queue.length; k++) {
        const b = queue[k];
        if (k === i || b.uid === a.uid || b.build !== a.build) continue;
        const gap = Math.abs(a.r - b.r);
        if (gap > Math.max(rankWindow(now - a.since), rankWindow(now - b.since)) || gap >= bestGap) continue;
        best = k;
        bestGap = gap;
      }
      if (best < 0) continue;
      const b = queue[best];
      queue.splice(Math.max(i, best), 1);
      queue.splice(Math.min(i, best), 1);
      void propose(a, b);
      i = -1;
    }
    for (const e of [...queue]) if (now - e.since >= RANK_BOT_MS) botMatch(e);
    if (queue.length && !matchTimer) matchTimer = setInterval(tryMatch, 1000);
    if (!queue.length && matchTimer) (clearInterval(matchTimer), (matchTimer = null));
  }
  let matchTimer: ReturnType<typeof setInterval> | null = null;

  async function propose(a: QEntry, b: QEntry) {
    const id = newId();
    const deadline = Date.now() + RANK_ACCEPT_MS;
    const p: Pending = { id, a, b, acc: new Set(), deadline, timer: setTimeout(() => expire(id), RANK_ACCEPT_MS + 500) };
    pending.set(id, p);
    setRank(a.uid, { s: "found", id, deadline, accepted: false, opp: { nick: b.nick, r: b.r, n: b.n }, me: { r: a.r, n: a.n } });
    setRank(b.uid, { s: "found", id, deadline, accepted: false, opp: { nick: a.nick, r: a.r, n: a.n }, me: { r: b.r, n: b.n } });
  }

  /** 매칭 취소: 거절·시간 초과·끊김. 수락했던 쪽(과 아직 안 정한 피해자)은 큐 맨 앞으로 */
  function dropPending(p: Pending, losers: Set<string>, note: string) {
    clearTimeout(p.timer);
    pending.delete(p.id);
    for (const e of [p.a, p.b]) {
      if (losers.has(e.uid)) setRank(e.uid, { s: "idle" });
      else enqueue(e, true, note);
    }
  }

  function expire(id: string) {
    const p = pending.get(id);
    if (!p) return;
    // 수락 안 누른 사람은 빠지고, 수락한 사람은 다시 찾기
    const losers = new Set([p.a.uid, p.b.uid].filter((u) => !p.acc.has(u)));
    dropPending(p, losers, "상대가 수락하지 않아 다시 찾는 중");
  }

  // ── 봇전 ──

  /** 사람을 못 찾음 → 비슷한 레이팅의 봇. 빌드가 서버와 다르면(새로고침 필요) 봇 없이 계속 사람을 찾음 */
  function botMatch(e: QEntry) {
    if (e.bot !== SERVER_BOT) {
      const st = rankStatus.get(e.uid);
      const note = "게임이 업데이트됐어요 — 새로고침하면 AI 매칭도 돼요";
      if (st?.s === "queue" && st.note !== note) setRank(e.uid, { ...st, note });
      return;
    }
    const i = queue.indexOf(e);
    if (i >= 0) queue.splice(i, 1);
    // 봇 레이팅: 내 점수 ±60 (0 ~ BOT_MAX), 판 수는 사람처럼 아무렇게나
    const r = Math.max(0, Math.min(BOT_MAX, Math.round(e.r + (Math.random() * 2 - 1) * 60)));
    const taken = [...tickets.values()].map((t) => t.opp.nick);
    const id = newId();
    const t: BotTicket = {
      id,
      uid: e.uid,
      nick: e.nick,
      opp: { nick: uniqueNickname(taken), r, n: 12 + Math.floor(Math.random() * 300) },
      botCh: -1,
      map: Math.floor(Math.random() * e.maps),
      seed: 1 + Math.floor(Math.random() * 0x7fffffff),
      stage: "found",
      ch: -1,
      startedAt: 0,
      timer: null,
    };
    tickets.set(id, t);
    const deadline = Date.now() + RANK_ACCEPT_MS;
    setRank(e.uid, { s: "found", id, deadline, accepted: false, opp: t.opp, me: { r: e.r, n: e.n } });
    t.timer = setTimeout(() => {
      // 수락 안 함 → 취소 (레이팅 변화 없음)
      if (tickets.get(id) !== t || t.stage !== "found") return;
      tickets.delete(id);
      setRank(e.uid, { s: "idle" });
    }, RANK_ACCEPT_MS + 500);
  }

  function clearTicket(t: BotTicket) {
    if (t.timer) clearTimeout(t.timer);
    t.timer = null;
    tickets.delete(t.id);
  }

  /** 봇전 결과 반영 → 상태(botEnd)로 알려 줌. out: 0 = 나 승, 1 = 봇 승, 2 = 무승부 */
  async function finishBot(t: BotTicket, out: 0 | 1 | 2, m: Margin | null, note?: string) {
    if (t.stage === "done") return null;
    t.stage = "done";
    clearTicket(t);
    rating
      .logGame([t.uid, `bot:${t.opp.nick}`], [t.ch, t.botCh], t.map, out, true)
      .catch((e) => console.warn("[fight] 봇전 기록 실패", e));
    const res = await rating.rateBot(t.uid, t.opp.r, out, out === 0 ? m : null).catch((e) => {
      console.warn("[fight] 봇전 레이팅 저장 실패", e);
      return null;
    });
    const st: RankStatus = { s: "botEnd", out, opp: { nick: t.opp.nick, r: t.opp.r }, delta: res?.delta, r: res?.r, note };
    setRank(t.uid, st);
    return st;
  }

  gateway.rpc("fight.rankQueue", async (ctx, raw) => {
    const o = z
      .object({ build: z.string().min(1).max(40), bot: z.string().max(80).optional(), maps: z.number().int().min(1).max(99) })
      .parse(raw);
    const uid = ctx.uid;
    if (!ctx.nick) throw new AppError("MEMBERS_ONLY", "랭크전은 회원만 할 수 있어요.", 403);
    notWhileDraining();
    if (pendingOf(uid)) return null;
    // 하던 봇전이 있으면 (경기 중에 나갔다 다시 찾음) 그 판은 패배
    const old = ticketOf(uid);
    if (old) {
      if (old.stage === "check") return null;
      if (old.stage === "play") await finishBot(old, 1, null);
      else clearTicket(old);
    }
    const { r, n } = await rating.ratingOf(uid).catch(() => ({ r: 1000, n: 0 }));
    if (pendingOf(uid)) return null;
    enqueue({ uid, nick: ctx.nick, build: o.build, bot: o.bot ?? "", maps: o.maps, socket: ctx.socket.id, since: Date.now(), r, n });
    return null;
  });

  gateway.rpc("fight.rankCancel", (ctx) => {
    const uid = ctx.uid;
    const i = queue.findIndex((q) => q.uid === uid);
    if (i >= 0) queue.splice(i, 1);
    const p = pendingOf(uid);
    const t = ticketOf(uid);
    if (p) dropPending(p, new Set([uid]), "상대가 매칭을 취소해서 다시 찾는 중");
    else if (t && t.stage === "play") void finishBot(t, 1, null);
    else if (t && t.stage === "check") return null;
    else {
      if (t) clearTicket(t);
      setRank(uid, { s: "idle" });
    }
    return null;
  });

  gateway.rpc("fight.rankRespond", (ctx, raw) => {
    const o = z.object({ id: z.string().max(40), accept: z.boolean() }).parse(raw);
    const uid = ctx.uid;
    const t = tickets.get(o.id);
    if (t) {
      // 봇과 매칭: 수락하면 바로 캐릭터 고르기 (봇은 늘 수락)
      if (t.uid !== uid || t.stage !== "found") return null;
      if (t.timer) clearTimeout(t.timer);
      if (!o.accept) {
        clearTicket(t);
        setRank(uid, { s: "idle" });
        return null;
      }
      t.stage = "room";
      const st = rankStatus.get(uid);
      const deadline = Date.now() + RANK_START_MS;
      setRank(uid, { s: "bot", id: t.id, deadline, opp: t.opp, me: st?.s === "found" ? st.me : { r: 1000, n: 0 }, map: t.map });
      // 시간 안에 시작 안 하면 취소 (레이팅 변화 없음)
      t.timer = setTimeout(() => {
        if (tickets.get(t.id) !== t || t.stage !== "room") return;
        clearTicket(t);
        setRank(uid, { s: "idle", note: "시간 안에 시작하지 않아 랭크전이 취소됐어요" });
      }, RANK_START_MS);
      return null;
    }
    const p = pending.get(o.id);
    if (!p || (p.a.uid !== uid && p.b.uid !== uid)) return null;
    if (!o.accept) {
      dropPending(p, new Set([uid]), "상대가 거절해서 다시 찾는 중");
      return null;
    }
    p.acc.add(uid);
    const st = rankStatus.get(uid);
    if (st?.s === "found") setRank(uid, { ...st, accepted: true });
    if (p.acc.size < 2) return null;
    clearTimeout(p.timer);
    pending.delete(p.id);
    const id = openRankRoom(p.a, p.b);
    for (const e of [p.a, p.b]) {
      gateway.emit(rankKey(e.uid), "value", { s: "room", room: id } satisfies RankStatus);
      rankStatus.delete(e.uid);
    }
    return null;
  });

  /** 봇전 시작: 내 캐릭터를 정하면 봇 캐릭터·난수 씨앗을 알려 줌 (여기부터는 나가면 패배) */
  gateway.rpc("fight.rankBotStart", (ctx, raw) => {
    const o = z.object({ id: z.string().max(40), ch: z.number().int().min(0).max(99) }).parse(raw);
    const t = tickets.get(o.id);
    if (!t || t.uid !== ctx.uid || t.stage !== "room") throw bad("랭크전이 취소됐어요.");
    notWhileDraining();
    const nCh = replayBot.charCount();
    if (o.ch >= nCh) throw bad("없는 캐릭터예요.");
    if (t.timer) clearTimeout(t.timer);
    t.ch = o.ch;
    t.botCh = Math.floor(Math.random() * nCh);
    t.stage = "play";
    t.startedAt = Date.now();
    setRank(t.uid, { s: "botplay", id: t.id, opp: { nick: t.opp.nick, r: t.opp.r } });
    // 결과를 안 보내고 사라지면 패배
    t.timer = setTimeout(() => void finishBot(t, 1, null), BOT_PLAY_MS);
    return { botCh: t.botCh, seed: t.seed, map: t.map, botR: t.opp.r };
  });

  /** 봇전 끝: 내 입력 기록 [값, 연속 프레임 수]... → 서버가 같은 경기를 다시 돌려 승패 확인 → 레이팅 */
  gateway.rpc("fight.rankBotReport", async (ctx, raw) => {
    const o = z
      .object({
        id: z.string().max(40),
        inputs: z.array(z.tuple([z.number().int().min(0).max(0xffff), z.number().int().min(1).max(BOT_MAX_FRAMES)])).max(BOT_MAX_FRAMES),
      })
      .parse(raw);
    const t = tickets.get(o.id);
    if (!t || t.uid !== ctx.uid || t.stage !== "play") return rankStatus.get(ctx.uid) ?? null;
    const frames: number[] = [];
    for (const [v, n] of o.inputs) {
      if (frames.length + n > BOT_MAX_FRAMES) break;
      for (let k = 0; k < n; k++) frames.push(v);
    }
    // 다시 돌리는 동안 기권·다른 신고가 끼지 않게 (한 번만)
    if (t.timer) clearTimeout(t.timer);
    t.timer = null;
    t.stage = "check";
    const res = await replayBot({ chars: [t.ch, t.botCh], map: t.map, seed: t.seed, botR: t.opp.r, inputs: frames }).catch((e) => {
      console.warn("[fight] 봇전 확인 실패", e);
      return null;
    });
    if (!res) return finishBot(t, 2, null, "경기를 확인하지 못해 무승부로 처리됐어요");
    // 끝까지 안 간 기록(중간에 끊김) = 패배
    if (!res.done) return finishBot(t, 1, null, "경기 기록이 끝까지 오지 않아 패배로 처리됐어요");
    return finishBot(t, res.winner === 0 ? 0 : res.winner === 1 ? 1 : 2, res.margin);
  });

  /** 봇전 기권 (경기 중에 나감) */
  gateway.rpc("fight.rankBotForfeit", (ctx, raw) => {
    const o = z.object({ id: z.string().max(40) }).parse(raw);
    const t = tickets.get(o.id);
    if (!t || t.uid !== ctx.uid) return null;
    if (t.stage === "play") void finishBot(t, 1, null);
    else if (t.stage === "found" || t.stage === "room") (clearTicket(t), setRank(t.uid, { s: "idle" }));
    return null;
  });

  // ── 스킨: 산 것(inv.fight, 상점은 points.buy) · 캐릭터마다 착용(fightWear.<캐릭터 id>) ──
  const skinsWire = async (uid: string) => {
    const d = (await db.col("users").findOne({ _id: uid } as never, { projection: { fightWear: 1, "inv.fight": 1 } })) as {
      fightWear?: Record<string, string>;
      inv?: { fight?: string[] };
    } | null;
    const owned = (d?.inv?.fight ?? []).filter((x) => skinOf(x));
    const wear = Object.fromEntries(Object.entries(d?.fightWear ?? {}).filter(([, s]) => owned.includes(s)));
    return { owned, wear };
  };
  gateway.rpc("fight.skins", async (ctx) => (ctx.nick ? skinsWire(ctx.uid) : null));
  gateway.rpc("fight.wearSkin", async (ctx, raw) => {
    const o = z.object({ ch: z.string().max(20), skin: z.string().max(40).nullable() }).parse(raw);
    if (!ctx.nick) throw new AppError("MEMBERS_ONLY", "회원만 쓸 수 있어요.", 403);
    if (!CHARS.some((c) => c.id === o.ch)) throw bad("없는 캐릭터예요.");
    if (o.skin === null) await db.col("users").updateOne({ _id: ctx.uid } as never, { $unset: { [`fightWear.${o.ch}`]: "" } } as never);
    else {
      if (skinOf(o.skin)?.ch !== o.ch) throw bad("그 캐릭터의 스킨이 아니에요.");
      const r = await db.col("users").updateOne({ _id: ctx.uid, "inv.fight": o.skin } as never, { $set: { [`fightWear.${o.ch}`]: o.skin } } as never);
      if (!r.matchedCount) throw new AppError("NOT_OWNED", "아직 갖고 있지 않은 스킨이에요.", 409);
    }
    return skinsWire(ctx.uid);
  });

  // ── 업적용 기록: 튜토리얼 · AI 대전 단계 (web lib/points.ts fight.tut · fight.ai) ──
  /** 튜토리얼을 끝까지 함 (회원만) */
  gateway.rpc("fight.tutorialDone", async (ctx) => {
    if (!ctx.nick) return null;
    await db.col("users").updateOne({ _id: ctx.uid } as never, { $max: { "stats.fight.tut": 1 } } as never);
    return null;
  });
  /** AI 대전 승리: 랭크전 봇전처럼 내 입력 기록을 서버가 같은 씨앗으로 다시 돌려 이겼는지 확인 → 이긴 가장 높은 단계 */
  const aiChecking = new Set<string>();
  gateway.rpc("fight.aiClear", async (ctx, raw) => {
    const o = z
      .object({
        build: z.string().max(80),
        level: z.number().int().min(0).max(replayBot.levelCount() - 1),
        chars: z.tuple([z.number().int().min(0).max(99), z.number().int().min(0).max(99)]),
        map: z.number().int().min(0).max(99),
        seed: z.number().int().min(0).max(0xffffffff),
        inputs: z.array(z.tuple([z.number().int().min(0).max(0xffff), z.number().int().min(1).max(BOT_MAX_FRAMES)])).max(BOT_MAX_FRAMES),
      })
      .parse(raw);
    const uid = ctx.uid;
    // 비회원 · 다른 빌드(같은 입력이어도 결과가 다름) · 이미 확인 중이면 그냥 넘어감
    if (!ctx.nick || o.build !== SERVER_BOT || aiChecking.has(uid)) return { ai: null };
    const nCh = replayBot.charCount();
    if (o.chars[0] >= nCh || o.chars[1] >= nCh) throw bad("없는 캐릭터예요.");
    const users = db.col<{ _id: string; stats?: { fight?: { ai?: number } } }>("users");
    const cur = (await users.findOne({ _id: uid }, { projection: { "stats.fight.ai": 1 } }))?.stats?.fight?.ai ?? 0;
    if (cur > o.level) return { ai: cur };
    const frames: number[] = [];
    for (const [v, n] of o.inputs) {
      if (frames.length + n > BOT_MAX_FRAMES) break;
      for (let k = 0; k < n; k++) frames.push(v);
    }
    aiChecking.add(uid);
    try {
      const res = await replayBot({ chars: o.chars, map: o.map, seed: o.seed, botR: replayBot.levelRating(o.level), inputs: frames }).catch((e) => {
        console.warn("[fight] AI 대전 확인 실패", e);
        return null;
      });
      if (!res?.done || res.winner !== 0) return { ai: cur };
      await users.updateOne({ _id: uid }, { $max: { "stats.fight.ai": o.level + 1 } } as never);
      return { ai: Math.max(cur, o.level + 1) };
    } finally {
      aiChecking.delete(uid);
    }
  });

  /** 매칭된 두 사람의 전용 방 (맵은 여기서 랜덤, 두 사람 화면에 다 있는 맵 중에서) */
  function openRankRoom(a: QEntry, b: QEntry) {
    const now = Date.now();
    const map = Math.floor(Math.random() * Math.min(a.maps, b.maps));
    const room: Room = {
      id: newId(),
      name: "⚔ 랭크전",
      hostUid: a.uid,
      hostNick: a.nick,
      createdAt: now,
      seats: ["", ""],
      players: {},
      state: { ...emptyState(), pick: map },
      watchers: {},
      chat: [],
      sig: new Map(),
      relay: [null, null],
      watch: [[], []],
      watchMatch: "",
      owners: new Map(),
      watcherOwners: new Map(),
      emptySince: now,
      result: null,
      rank: { uids: [a.uid, b.uid], map, used: false, recorded: false, margins: [null, null], result: null, deadline: now + RANK_START_MS },
    };
    rooms.set(room.id, room);
    armRankDeadline(room, RANK_START_MS);
    return room.id;
  }

  /** 랭크전 방: 시간 안에 시작 못 하면 (한쪽이 안 들어오거나 준비를 안 함) 취소 */
  function armRankDeadline(room: Room, after: number) {
    setTimeout(() => {
      if (rooms.get(room.id) === room && !room.rank!.used) removeRoom(room);
    }, Math.max(0, after)).unref?.();
  }

  // ───────────── 오래 비어 있는 방 정리 ─────────────

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()])
      if (!Object.keys(room.players).length && now - room.emptySince >= emptyRoomTtl) removeRoom(room);
      // 랭크전 방: 다 끝났거나 시작 시간이 지났는데 아무도 없으면 정리
      else if (room.rank && !Object.keys(room.players).length && now - room.emptySince >= 60_000) removeRoom(room);
  }, opts.sweepIntervalMs ?? 5 * 60_000);
  sweep.unref();

  // ───────────── 배포 때 이어받기 (live.ts) ─────────────

  const RESTART_NOTE = "서버 업데이트로 매칭이 취소됐어요. 잠시 후 다시 찾아주세요";
  const live: LiveGame = {
    // 진행 중인 경기가 끝나길 (최대 DRAIN_MS) 기다림 — 경기는 P2P 라 넘어가도 이어지지만, 중계로 하는 판은 잠깐 멈춤
    busy: () => [...rooms.values()].some((r) => r.state.phase === "play"),
    drain() {
      draining = true;
      // 매칭 대기·수락 대기는 취소 (다시 켜진 뒤 다시 찾으면 됨)
      for (const e of queue.splice(0)) setRank(e.uid, { s: "idle", note: RESTART_NOTE });
      for (const p of [...pending.values()]) {
        clearTimeout(p.timer);
        pending.delete(p.id);
        for (const e of [p.a, p.b]) setRank(e.uid, { s: "idle", note: RESTART_NOTE });
      }
      for (const t of [...tickets.values()])
        if (t.stage === "found") {
          clearTicket(t);
          setRank(t.uid, { s: "idle", note: RESTART_NOTE });
        }
      if (matchTimer) (clearInterval(matchTimer), (matchTimer = null));
    },
    snapshot: () => ({
      rooms: [...rooms.values()].map((r) => ({
        id: r.id,
        name: r.name,
        hostUid: r.hostUid,
        hostNick: r.hostNick,
        createdAt: r.createdAt,
        seats: r.seats,
        players: r.players,
        state: r.state,
        chat: r.chat,
        sig: [...r.sig.entries()],
        relay: r.relay,
        watch: r.watch,
        watchMatch: r.watchMatch,
        emptySince: r.emptySince,
        result: r.result,
        rank: r.rank,
      })),
      // 봇전: 캐릭터를 고르는 중(room)이거나 경기 중(play)인 표만 — 경기는 브라우저에서 이어지고 결과는 다시 켜진 서버로
      tickets: [...tickets.values()].filter((t) => t.stage === "room" || t.stage === "play").map((t) => ({ ...t, timer: null })),
      status: [...rankStatus.entries()].filter(([, st]) => st.s !== "queue" && st.s !== "found"),
    }),
    restore(data, downMs) {
      const d = data as {
        rooms: (Omit<Room, "sig" | "owners" | "watchers" | "watcherOwners"> & { sig: [string, { offer?: SigPart; answer?: SigPart }][] })[];
        tickets: BotTicket[];
        status: [string, RankStatus][];
      };
      const now = Date.now();
      for (const r of d.rooms) {
        const room: Room = {
          ...r,
          sig: new Map(r.sig),
          watchers: {},
          owners: new Map(Object.keys(r.players).map((uid) => [uid, RESTORED])),
          watcherOwners: new Map(),
        };
        rooms.set(room.id, room);
        if (room.rank && !room.rank.used) {
          room.rank.deadline += downMs;
          armRankDeadline(room, room.rank.deadline - now);
        }
      }
      for (const [uid, st] of d.status) rankStatus.set(uid, st.s === "bot" ? { ...st, deadline: st.deadline + downMs } : st);
      for (const saved of d.tickets) {
        const t: BotTicket = { ...saved, timer: null };
        tickets.set(t.id, t);
        if (t.stage === "play") {
          t.startedAt += downMs;
          t.timer = setTimeout(() => void finishBot(t, 1, null), Math.max(0, t.startedAt + BOT_PLAY_MS - now));
        } else {
          const st = rankStatus.get(t.uid);
          const left = st?.s === "bot" ? st.deadline - now : RANK_START_MS;
          t.timer = setTimeout(() => {
            if (tickets.get(t.id) !== t || t.stage !== "room") return;
            clearTicket(t);
            setRank(t.uid, { s: "idle", note: "시간 안에 시작하지 않아 랭크전이 취소됐어요" });
          }, Math.max(0, left));
        }
      }
      // 시간 안에 안 돌아온 선수는 나간 것으로 (경기 중이었으면 남은 쪽 신고로 결과가 정해짐)
      setTimeout(() => {
        for (const room of [...rooms.values()])
          for (const [uid, owner] of [...room.owners]) if (owner === RESTORED) removePlayer(room, uid);
      }, RESTORE_GRACE_MS).unref();
    },
  };

  return {
    live,
    close() {
      clearInterval(sweep);
      if (matchTimer) clearInterval(matchTimer);
      for (const t of tickets.values()) if (t.timer) clearTimeout(t.timer);
    },
    /** (관리자) 지금 열려 있는 방 */
    adminList(): LiveRoom[] {
      return [...rooms.values()].map((r) => ({
        id: r.id,
        name: r.name,
        status: r.state.phase,
        players: Object.values(r.players).map((p) => p.nick),
        createdAt: r.createdAt,
      }));
    },
    /** (관리자) 방 닫기 — 안에 있던 사람들은 로비로 나가짐 */
    adminClose(id: string): boolean {
      const room = rooms.get(id);
      if (room) removeRoom(room);
      return !!room;
    },
  };
}
