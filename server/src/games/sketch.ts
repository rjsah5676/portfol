import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad, forbidden } from "../errors";
import { isClientId, newId, orderedId } from "../ids";
import type { Ctx } from "../realtime/gateway";
import { GUEST_MARK } from "../users";
import type { LiveRoom } from "../http/admin";

/*
 * 스케치 퀴즈 (실시간 그림 퀴즈)
 *
 * 기존에는 Firebase Realtime Database에 방 상태를 두고 브라우저끼리 진행을 나눠 맡았음.
 * 지금은 서버가 방 상태를 메모리에 들고 권한 검사와 상태 변경을 맡음.
 * 진행 방식 자체는 그대로:
 *  - 그리는 사람: 제시어 후보·선택, 정답 판정, 힌트, 시간 종료
 *  - 리더(방장. 방장이 나가면 가장 먼저 들어와 있는 사람이 이어받음): 게임 시작, 다음 차례, 강퇴
 * 방은 접속자가 없으면 정리되는 휘발성 데이터라 DB에 저장하지 않음 (서버를 다시 띄우면 진행 중인 방은 사라짐).
 *
 * 구독 채널
 *   sketch.lobby                 로비 목록 (로그인 없이도 가능)
 *   sketch.room    { id }        방 전체 상태 (없으면 null)
 *   sketch.strokes { id, turn }  이번 차례 그림 조각 — 참가자만
 *   sketch.chat    { id }        채팅 — 참가자만
 *   sketch.guesses { id }        정답 시도 — 그리는 사람만 (답이 채팅에 노출되지 않게)
 *   sketch.words   { id }        제시어 후보·정답 — 그리는 사람만
 */

export type TurnMode = "winner" | "order";
export type Phase = "waiting" | "choosing" | "drawing" | "reveal" | "ended";

interface Meta {
  name: string;
  hostUid: string;
  max: number;
  turnMode: TurnMode;
  drawTime: number;
  rounds: number;
  hints: boolean;
  locked: boolean;
  createdAt: number;
}
interface Player {
  nick: string;
  joinedAt: number;
}
interface Score {
  nick: string;
  score: number;
}
interface State {
  phase: Phase;
  turnId: string;
  turnNo: number;
  drawer: string;
  drawerNick: string;
  endsAt: number;
  /** 글자 수·힌트 (예: "○○○", "포○○") */
  hint: string;
  /** reveal 단계에서 공개되는 정답 ("" = 건너뜀) */
  reveal: string;
  /** 이번 차례 정답자 → 얻은 점수 */
  correct: Record<string, number>;
  firstCorrect: string;
  /** 지금까지 그린 횟수 — 각자 rounds번 그리면 게임 끝 */
  drawn: Record<string, number>;
  /** 이번 제시어 난이도 (0 쉬움 · 1 보통 · 2 어려움) */
  level: number;
}
interface ChatMsg {
  id: string;
  uid: string;
  nick: string;
  text: string;
  kind: "msg" | "system" | "correct";
  ts: number;
}
interface Guess {
  id: string;
  uid: string;
  nick: string;
  text: string;
  turnId: string;
  ts: number;
}
interface Words {
  turnId: string;
  choices?: string[];
  levels?: number[];
  word?: string;
}

interface Room {
  id: string;
  meta: Meta;
  players: Record<string, Player>;
  scores: Record<string, Score>;
  state: State;
  kicked: Record<string, string>;
  used: Record<string, true>;
  // ── 여기부터는 방 상태 구독으로 나가지 않는 것 ──
  /** 지금 차례의 그림 조각 (키 순서 = 그린 순서) */
  strokes: Map<string, unknown>;
  strokesTurn: string;
  chat: ChatMsg[];
  guesses: Guess[];
  words: Words | null;
  /** 비밀번호 해시 (잠긴 방만) */
  pw: string | null;
  /** 초대 링크용 키 */
  invite: string;
  /** 비밀번호·초대키를 맞힌 사람 */
  access: Set<string>;
  /** 플레이어 자리의 주인 소켓 — 그 소켓이 끊기면 자리에서 뺌 */
  owners: Map<string, string>;
  /** 아무도 없게 된 시각 (정리용) */
  emptySince: number;
}

export const CHOOSE_MS = 15_000;
export const REVEAL_MS = 5_000;
/** 첫 정답자 추가 점수 */
const FIRST_BONUS = 30;
/** 제시어 난이도별 점수 배율 — web/src/lib/sketch/words.ts 의 LEVEL_BONUS 와 같은 값 */
const LEVEL_BONUS = [1, 1.2, 1.5];
/** 정답 비교용 (공백 제거, 소문자) — web/src/lib/sketch/words.ts 의 normalizeAnswer 와 같은 식 */
const normalizeAnswer = (s: string) => s.replace(/\s+/g, "").toLowerCase();
/** 안내 문장에 넣는 이름: 비회원 표시(◦)는 뺌 — 문장은 화면에서 그대로 글자로 나가므로 */
const plain = (nick: string) => nick.replaceAll(GUEST_MARK, "");

const CHAT_KEEP = 200;
const CHAT_SNAPSHOT = 80;
const MAX_ROOMS = 500;
const MAX_STROKES = 20_000;
const MAX_GUESSES = 300;

const emptyState = (): State => ({
  phase: "waiting",
  turnId: "",
  turnNo: 0,
  drawer: "",
  drawerNick: "",
  endsAt: 0,
  hint: "",
  reveal: "",
  correct: {},
  firstCorrect: "",
  drawn: {},
  level: 0,
});

const hashPassword = (roomId: string, pw: string) => createHash("sha256").update(`${roomId}:${pw}`).digest("hex");
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** 접속 중인 사람을 들어온 순서대로 */
function orderedPlayers(room: Room): (Player & { uid: string })[] {
  return Object.entries(room.players)
    .map(([uid, p]) => ({ uid, ...p }))
    .sort((a, b) => a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid));
}
/** 리더 = 방장. 방장이 나가 있으면 가장 먼저 들어와 있는 사람 */
const leaderOf = (room: Room) =>
  room.players[room.meta.hostUid] ? room.meta.hostUid : (orderedPlayers(room)[0]?.uid ?? "");

/** 다음에 그릴 사람 ("" = 모두 다 그림 → 게임 끝) */
function nextDrawer(room: Room): string {
  const { drawer: current, firstCorrect, drawn } = room.state;
  const all = orderedPlayers(room).map((p) => p.uid);
  const pending = all.filter((u) => (drawn[u] ?? 0) < room.meta.rounds);
  if (pending.length === 0) return "";
  if (room.meta.turnMode === "winner" && firstCorrect && pending.includes(firstCorrect)) return firstCorrect;
  // 입장 순서로 지금 사람 다음부터 돌면서 아직 덜 그린 사람
  const start = all.indexOf(current);
  for (let k = 1; k <= all.length; k++) {
    const u = all[(start + k + all.length) % all.length];
    if (pending.includes(u)) return u;
  }
  return pending[0];
}

const roomId = z.string().min(1).max(40);
const idOnly = z.object({ id: roomId });
const nickSchema = z.string().min(1).max(10);
const strokeSchema = z.strictObject({
  g: z.string().max(24),
  c: z.string().max(24),
  w: z.number().optional(),
  p: z.string().max(20_000).optional(),
  t: z.literal("f").optional(),
  e: z.literal(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

export interface SketchOptions {
  /** 이만큼 비어 있던 방은 정리 */
  emptyRoomTtlMs?: number;
  /** 정리 주기 */
  sweepIntervalMs?: number;
}

export function registerSketch({ gateway, users }: Deps, opts: SketchOptions = {}) {
  const rooms = new Map<string, Room>();
  const emptyRoomTtl = opts.emptyRoomTtlMs ?? 30 * 60_000;

  const LOBBY = "sketch:lobby";
  const roomKey = (id: string) => `sketch:room:${id}`;
  const strokesKey = (id: string, turn: string) => `sketch:strokes:${id}:${turn}`;
  const chatKey = (id: string) => `sketch:chat:${id}`;
  const guessesKey = (id: string) => `sketch:guesses:${id}`;
  const wordsKey = (id: string) => `sketch:words:${id}`;

  // ───────────── 내보내기 ─────────────

  const roomWire = (r: Room) => ({
    id: r.id,
    meta: r.meta,
    players: r.players,
    scores: r.scores,
    state: r.state,
    kicked: r.kicked,
    used: r.used,
  });
  const lobbyWire = () =>
    [...rooms.values()]
      .map((r) => ({
        id: r.id,
        name: r.meta.name,
        locked: r.meta.locked,
        max: r.meta.max,
        count: Object.keys(r.players).length,
        phase: r.state.phase,
        turnMode: r.meta.turnMode,
        createdAt: r.meta.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

  let lobbyDirty = false;
  /** 방 상태가 바뀜 → 방 구독자와 (요약이 달라졌을 수 있으니) 로비에 알림 */
  function changed(room: Room) {
    gateway.emit(roomKey(room.id), "room", roomWire(room));
    // 한 요청 안에서 여러 번 바뀌어도 로비는 한 번만
    if (lobbyDirty) return;
    lobbyDirty = true;
    queueMicrotask(() => {
      lobbyDirty = false;
      gateway.emit(LOBBY, "list", lobbyWire());
    });
  }

  function pushChat(room: Room, msg: Omit<ChatMsg, "id" | "ts"> & { id?: string }) {
    const full: ChatMsg = { ...msg, id: msg.id ?? orderedId(), ts: Date.now() };
    room.chat.push(full);
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    gateway.emit(chatKey(room.id), "add", full);
  }
  /** 방에 등록된 그 사람의 이름 (없으면 fallback) */
  const nameIn = (room: Room, uid: string, fallback: string) =>
    room.players[uid]?.nick ?? room.scores[uid]?.nick ?? fallback;
  const systemChat = (room: Room, text: string) => pushChat(room, { uid: "", nick: "", text, kind: "system" });

  function setWords(room: Room, words: Words | null) {
    room.words = words;
    gateway.emit(wordsKey(room.id), "value", words);
  }
  function clearGuesses(room: Room) {
    room.guesses = [];
  }
  /** 그림 전체 지우기 (보고 있는 사람들 화면에서도 지워짐) */
  function clearStrokes(room: Room) {
    if (room.strokes.size) gateway.emit(strokesKey(room.id, room.strokesTurn), "clear");
    room.strokes = new Map();
  }

  /** 그리는 사람이 바뀌면 이전 사람의 제시어·정답 시도 구독을 끊음 */
  function drawerChanged(room: Room) {
    const still = (ctx: Ctx) => ctx.user?.uid !== room.state.drawer;
    gateway.revoke(wordsKey(room.id), still);
    gateway.revoke(guessesKey(room.id), still);
  }

  function removeRoom(room: Room) {
    rooms.delete(room.id);
    gateway.emit(roomKey(room.id), "room", null);
    gateway.emit(LOBBY, "list", lobbyWire());
    for (const key of [chatKey(room.id), guessesKey(room.id), wordsKey(room.id), strokesKey(room.id, room.strokesTurn)])
      gateway.revoke(key);
  }

  /** 자리에서 빼기 (나가기·끊김·강퇴 공통). 방장이었으면 남은 사람 중 리더가 이어받음 */
  function removePlayer(room: Room, uid: string) {
    if (!room.players[uid]) return;
    delete room.players[uid];
    room.owners.delete(uid);
    const leader = leaderOf(room);
    if (leader && leader !== room.meta.hostUid) room.meta.hostUid = leader;
    if (!Object.keys(room.players).length) room.emptySince = Date.now();
    changed(room);
  }

  // ───────────── 권한 ─────────────

  const getRoom = (id: string): Room => {
    const room = rooms.get(id);
    if (!room) throw new AppError("NO_ROOM", "방이 없습니다.", 404);
    return room;
  };
  /** 방에 들어와 있는 사람만 */
  function asPlayer(ctx: Ctx, id: string) {
    const room = getRoom(id);
    const uid = ctx.uid;
    if (!room.players[uid]) throw forbidden();
    return { room, uid };
  }
  function asDrawer(ctx: Ctx, id: string) {
    const { room, uid } = asPlayer(ctx, id);
    if (room.state.drawer !== uid) throw forbidden();
    return { room, uid };
  }
  function asLeader(ctx: Ctx, id: string) {
    const { room, uid } = asPlayer(ctx, id);
    if (leaderOf(room) !== uid) throw forbidden();
    return { room, uid };
  }
  /**
   * 채팅·그림을 볼 수 있는 사람: 지금 참가자, 또는 잠깐 끊겼다 돌아오는 중인 참가자(점수 자리가 남아 있음).
   * 재연결 때는 구독 복구가 재입장보다 먼저 오기 때문에 점수 자리로도 인정함. 강퇴된 사람은 제외.
   */
  function asViewer(ctx: Ctx, id: string) {
    const room = getRoom(id);
    const uid = ctx.uid;
    if (room.kicked[uid] !== undefined || (!room.players[uid] && !room.scores[uid])) throw forbidden();
    return room;
  }

  // 비밀번호 대입 방지: 한 사람이 한 방에 1분에 10번까지
  const unlockTries = new Map<string, { at: number; n: number }>();
  function countUnlockTry(key: string) {
    const now = Date.now();
    const t = unlockTries.get(key);
    if (!t || now - t.at > 60_000) unlockTries.set(key, { at: now, n: 1 });
    else if (++t.n > 10) throw new AppError("RATE_LIMITED", "잠시 후 다시 시도해주세요.", 429);
    if (unlockTries.size > 5000) unlockTries.clear();
  }

  // ───────────── 구독 채널 ─────────────

  gateway.channel("sketch.lobby", { key: () => LOBBY, snapshot: () => lobbyWire() });

  gateway.channel("sketch.room", {
    key(ctx, p) {
      void ctx.uid; // 로그인한 사람만
      return roomKey(idOnly.parse(p).id);
    },
    snapshot(_ctx, _key, p) {
      const room = rooms.get(idOnly.parse(p).id);
      return room ? roomWire(room) : null;
    },
  });

  const strokesParams = z.object({ id: roomId, turn: z.string().min(1).max(40) });
  gateway.channel("sketch.strokes", {
    key(ctx, p) {
      const { id, turn } = strokesParams.parse(p);
      asViewer(ctx, id);
      return strokesKey(id, turn);
    },
    snapshot(_ctx, _key, p) {
      const { id, turn } = strokesParams.parse(p);
      const room = rooms.get(id);
      return room && room.strokesTurn === turn ? [...room.strokes.entries()] : [];
    },
  });

  gateway.channel("sketch.chat", {
    key(ctx, p) {
      const { id } = idOnly.parse(p);
      asViewer(ctx, id);
      return chatKey(id);
    },
    snapshot: (_ctx, _key, p) => (rooms.get(idOnly.parse(p).id)?.chat ?? []).slice(-CHAT_SNAPSHOT),
  });

  gateway.channel("sketch.guesses", {
    key(ctx, p) {
      const { id } = idOnly.parse(p);
      if (getRoom(id).state.drawer !== ctx.uid) throw forbidden();
      return guessesKey(id);
    },
    snapshot: (_ctx, _key, p) => rooms.get(idOnly.parse(p).id)?.guesses ?? [],
  });

  gateway.channel("sketch.words", {
    key(ctx, p) {
      const { id } = idOnly.parse(p);
      if (getRoom(id).state.drawer !== ctx.uid) throw forbidden();
      return wordsKey(id);
    },
    snapshot: (_ctx, _key, p) => rooms.get(idOnly.parse(p).id)?.words ?? null,
  });

  // ───────────── 방 만들기 · 입장 · 퇴장 ─────────────

  const createSchema = z.object({
    nick: nickSchema,
    name: z.string().max(60),
    max: z.number().int(),
    turnMode: z.enum(["winner", "order"]),
    drawTime: z.number().int().min(30).max(300),
    rounds: z.number().int().min(1).max(10),
    hints: z.boolean(),
    password: z.string().max(100),
  });
  gateway.rpc("sketch.createRoom", (ctx, raw) => {
    const uid = ctx.uid;
    const o = createSchema.parse(raw);
    if (rooms.size >= MAX_ROOMS) throw bad("방이 너무 많아요. 잠시 후 다시 시도해주세요.");
    const id = newId();
    const password = o.password.trim();
    const locked = password !== "";
    const now = Date.now();
    const room: Room = {
      id,
      meta: {
        name: o.name.trim().slice(0, 20) || `${ctx.nick ?? o.nick}의 방`,
        hostUid: uid,
        max: Math.min(8, Math.max(2, o.max)),
        turnMode: o.turnMode,
        drawTime: o.drawTime,
        rounds: o.rounds,
        hints: o.hints,
        locked,
        createdAt: now,
      },
      players: {},
      scores: {},
      state: emptyState(),
      kicked: {},
      used: {},
      strokes: new Map(),
      strokesTurn: "",
      chat: [],
      guesses: [],
      words: null,
      pw: locked ? hashPassword(id, password) : null,
      invite: newId(24),
      access: new Set(locked ? [uid] : []),
      owners: new Map(),
      emptySince: now,
    };
    rooms.set(id, room);
    changed(room);
    return id;
  });

  gateway.rpc("sketch.hasAccess", (ctx, raw) => {
    const room = rooms.get(idOnly.parse(raw).id);
    return !!room?.access.has(ctx.uid);
  });

  /** 비번방이면 비밀번호나 초대키로 접근 권한을 먼저 얻음 */
  const unlockSchema = z.object({ id: roomId, password: z.string().max(100).optional(), invite: z.string().max(100).optional() });
  gateway.rpc("sketch.unlockRoom", (ctx, raw) => {
    const { id, password, invite } = unlockSchema.parse(raw);
    const uid = ctx.uid;
    const room = getRoom(id);
    if (!room.meta.locked) return null;
    countUnlockTry(`${id}/${uid}`);
    const ok =
      invite !== undefined
        ? safeEqual(invite, room.invite)
        : !!room.pw && safeEqual(hashPassword(id, password ?? ""), room.pw);
    if (!ok) throw new AppError("WRONG_PASSWORD", "비밀번호가 맞지 않습니다.", 403);
    room.access.add(uid);
    return null;
  });

  /** 초대 링크에 넣을 키 — 방 참가자만 */
  gateway.rpc("sketch.getInvite", (ctx, raw) => {
    const room = rooms.get(idOnly.parse(raw).id);
    return room && room.players[ctx.uid] ? room.invite : null;
  });

  const joinSchema = z.object({ id: roomId, nick: nickSchema, joinedAt: z.number().finite().optional(), rejoin: z.boolean().default(false) });
  gateway.rpc("sketch.join", (ctx, raw) => {
    const { id, nick: typed, joinedAt, rejoin } = joinSchema.parse(raw);
    const uid = ctx.uid;
    // 이름은 서버가 정함: 회원이면 별명, 아니면 적은 이름에 비회원 표시
    const nick = ctx.name(typed);
    const room = getRoom(id);
    if (room.kicked[uid] !== undefined) throw forbidden("방장이 이 방에서 내보냈어요.");
    if (room.meta.locked && room.meta.hostUid !== uid && !room.access.has(uid)) throw forbidden("비밀번호가 필요한 방입니다.");
    // 정원: 새로 들어오는 사람만 막음 (잠깐 끊겼다 돌아오는 사람은 통과)
    if (!room.players[uid] && !rejoin && Object.keys(room.players).length >= room.meta.max)
      throw new AppError("ROOM_FULL", "방이 가득 찼어요.", 409);
    // 입장 시각은 클라이언트가 보냄(잠깐 끊겼다 재연결이면 원래 값 → 입장 순서 유지). 미래·방 생성 전 값은 바로잡음
    const now = Date.now();
    room.players[uid] = { nick, joinedAt: Math.max(room.meta.createdAt, Math.min(now, joinedAt ?? now)) };
    room.owners.set(uid, ctx.socket.id);
    // 점수 자리 (새로고침으로 다시 들어온 경우 기존 점수 유지)
    const cur = room.scores[uid];
    room.scores[uid] = cur ? { ...cur, nick } : { nick, score: 0 };
    // 방장이 방에 없으면(만든 직후, 혼자 있다 새로고침) 지금 리더가 방장
    const leader = leaderOf(room);
    if (leader && leader !== room.meta.hostUid) room.meta.hostUid = leader;
    changed(room);
    return { joinedAt: room.players[uid].joinedAt };
  });

  const leaveSchema = z.object({ id: roomId, nick: z.string().max(10).optional() });
  gateway.rpc("sketch.leave", (ctx, raw) => {
    const { id, nick } = leaveSchema.parse(raw);
    const uid = ctx.uid;
    const room = rooms.get(id);
    if (!room || !room.players[uid]) return null;
    if (nick) systemChat(room, `${plain(room.players[uid].nick)}님이 나갔어요.`);
    removePlayer(room, uid);
    return null;
  });

  // 소켓이 끊기면 그 소켓으로 들어와 있던 자리를 비움
  gateway.onDisconnect((ctx) => {
    const uid = ctx.user?.uid;
    if (!uid) return;
    for (const room of rooms.values()) if (room.owners.get(uid) === ctx.socket.id) removePlayer(room, uid);
  });

  /** 방장이 나갔으면 리더가 방장 자리를 이어받음 (서버가 자리 변동 때 이미 처리하므로 보통은 할 일이 없음) */
  gateway.rpc("sketch.claimHost", (ctx, raw) => {
    const room = rooms.get(idOnly.parse(raw).id);
    const uid = ctx.uid;
    if (!room || !room.players[uid] || room.players[room.meta.hostUid]) return null;
    if (leaderOf(room) !== uid) return null;
    room.meta.hostUid = uid;
    changed(room);
    return null;
  });

  /** 방장: 강퇴 — 자리·점수를 지우고 다시 못 들어오게 표시 */
  gateway.rpc("sketch.kick", (ctx, raw) => {
    const { id, target } = z.object({ id: roomId, target: z.string().min(1).max(128) }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    if (room.meta.hostUid !== uid || target === uid) throw forbidden();
    const nick = (room.players[target]?.nick ?? room.scores[target]?.nick ?? "?").slice(0, 10);
    room.kicked[target] = nick;
    delete room.scores[target];
    if (room.players[target]) removePlayer(room, target);
    else changed(room);
    const kickedUser = (c: Ctx) => c.user?.uid === target;
    gateway.revoke(chatKey(id), kickedUser);
    gateway.revoke(strokesKey(id, room.strokesTurn), kickedUser);
    systemChat(room, `${plain(nick)}님을 내보냈어요.`);
    return null;
  });

  /** 아무도 없는 방 정리 (로비 화면이 요청) */
  gateway.rpc("sketch.cleanupEmptyRoom", (ctx, raw) => {
    void ctx.uid;
    const room = rooms.get(idOnly.parse(raw).id);
    if (room && !Object.keys(room.players).length) removeRoom(room);
    return null;
  });

  // ───────────── 진행 ─────────────

  function newTurn(room: Room, drawer: string, turnNo: number): Partial<State> {
    return {
      phase: "choosing",
      turnId: orderedId(),
      turnNo,
      drawer,
      drawerNick: room.players[drawer]?.nick ?? "",
      endsAt: Date.now() + CHOOSE_MS,
      hint: "",
      reveal: "",
      correct: {},
      firstCorrect: "",
      level: 0,
    };
  }
  /** 새 차례로 넘어가며 이전 차례의 그림·제시어·정답 시도를 비움 */
  function beginTurn(room: Room, patch: Partial<State>) {
    // 차례가 바뀌면 화면은 새 turnId 로 다시 구독하므로 이전 그림은 알림 없이 버림
    room.strokes = new Map();
    room.state = { ...room.state, ...patch };
    room.strokesTurn = room.state.turnId;
    clearGuesses(room);
    setWords(room, null);
    drawerChanged(room);
  }

  /** 리더: 게임 시작 (점수 초기화) */
  gateway.rpc("sketch.startGame", (ctx, raw) => {
    const { room } = asLeader(ctx, idOnly.parse(raw).id);
    const list = orderedPlayers(room);
    if (list.length < 2) return null;
    room.scores = {};
    for (const p of list) {
      room.scores[p.uid] = { nick: p.nick, score: 0 };
      users.bump(p.uid, { "stats.sketch.games": 1 });
    }
    const first = list[0].uid;
    room.state = emptyState();
    beginTurn(room, { ...newTurn(room, first, 1), drawn: { [first]: 1 } });
    changed(room);
    systemChat(room, `게임 시작! 한 사람당 ${room.meta.rounds}번씩 그려요. 중간에 들어와도 같이 할 수 있어요.`);
    return null;
  });

  /** 그리는 사람: 제시어 후보 저장 (본인만 읽을 수 있음) */
  const choicesSchema = z.object({
    id: roomId,
    turnId: z.string().max(40),
    choices: z.array(z.object({ word: z.string().min(1).max(40), level: z.number().int().min(0).max(2) })).max(6),
  });
  gateway.rpc("sketch.setChoices", (ctx, raw) => {
    const { id, turnId, choices } = choicesSchema.parse(raw);
    const { room } = asDrawer(ctx, id);
    if (room.state.turnId !== turnId) return null;
    setWords(room, { turnId, choices: choices.map((c) => c.word), levels: choices.map((c) => c.level) });
    return null;
  });

  /** 그리는 사람: 제시어 선택 → 그리기 시작 */
  const chooseSchema = z.object({
    id: roomId,
    turnId: z.string().max(40),
    word: z.string().min(1).max(40),
    hint: z.string().max(60),
    level: z.number().int().min(0).max(2),
  });
  gateway.rpc("sketch.chooseWord", (ctx, raw) => {
    const { id, turnId, word, hint, level } = chooseSchema.parse(raw);
    const { room } = asDrawer(ctx, id);
    setWords(room, { ...(room.words ?? { turnId }), word });
    const cur = room.state;
    if (cur.turnId !== turnId || cur.phase !== "choosing") return null;
    room.state = { ...cur, phase: "drawing", endsAt: Date.now() + room.meta.drawTime * 1000, hint, level };
    changed(room);
    return null;
  });

  gateway.rpc("sketch.setHint", (ctx, raw) => {
    const { id, turnId, hint } = z.object({ id: roomId, turnId: z.string().max(40), hint: z.string().max(60) }).parse(raw);
    const { room } = asDrawer(ctx, id);
    const cur = room.state;
    if (cur.turnId !== turnId || cur.phase !== "drawing" || cur.hint === hint) return null;
    room.state = { ...cur, hint };
    changed(room);
    return null;
  });

  /**
   * 그리는 사람: 정답 처리.
   * - 맞힌 사람: 빨리 맞힐수록 20~100점 × 제시어 난이도 배율, 첫 정답자는 +30
   * - 그린 사람: 누가 맞힐 때마다 그 사람 점수(첫 정답 보너스 빼고)의 절반
   */
  const correctSchema = z.object({
    id: roomId,
    guess: z.object({ uid: z.string().min(1).max(128), nick: z.string().max(12), turnId: z.string().max(40) }),
  });
  gateway.rpc("sketch.markCorrect", (ctx, raw) => {
    const { id, guess: sent } = correctSchema.parse(raw);
    const { room, uid: drawer } = asDrawer(ctx, id);
    // 맞힌 사람의 이름은 방에 등록된 것을 씀
    const guess = { ...sent, nick: nameIn(room, sent.uid, sent.nick) };
    const cur = room.state;
    if (cur.turnId !== guess.turnId || cur.phase !== "drawing") return null;
    if (cur.correct[guess.uid] !== undefined || guess.uid === drawer) return null;
    // 이 방 사람이 아니면 무시
    if (!room.players[guess.uid] && !room.scores[guess.uid]) return null;
    const left = Math.max(0, cur.endsAt - Date.now());
    const bonus = LEVEL_BONUS[cur.level] ?? 1;
    const base = Math.round((20 + (80 * left) / (room.meta.drawTime * 1000)) * bonus);
    const drawerPts = Math.round(base / 2);
    const first = !cur.firstCorrect;
    const pts = base + (first ? FIRST_BONUS : 0);
    room.state = { ...cur, correct: { ...cur.correct, [guess.uid]: pts }, firstCorrect: cur.firstCorrect || guess.uid };
    const add = (uid: string, nick: string, n: number) => {
      const s = room.scores[uid];
      room.scores[uid] = { nick: s?.nick ?? nick, score: (Number(s?.score) || 0) + n };
    };
    add(guess.uid, guess.nick, pts);
    add(drawer, cur.drawerNick, drawerPts);
    // 회원이면 전적에 반영 (비회원 uid 는 무시됨)
    users.bump(guess.uid, { "stats.sketch.correct": 1, "stats.sketch.points": pts });
    users.bump(drawer, { "stats.sketch.points": drawerPts });
    changed(room);
    pushChat(room, {
      uid: guess.uid,
      nick: guess.nick,
      text: `${plain(guess.nick)}님이 ${first ? "제일 먼저 " : ""}정답을 맞혔어요! (+${pts}${first ? " 🥇" : ""}) · 그린 사람 +${drawerPts}`,
      kind: "correct",
    });
    return null;
  });

  /** 그리는 사람(정답 공개) 또는 리더(그리는 사람이 없거나 응답이 없을 때): 차례 종료 */
  gateway.rpc("sketch.endTurn", (ctx, raw) => {
    const { id, turnId, reveal } = z.object({ id: roomId, turnId: z.string().max(40), reveal: z.string().max(40) }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    const isDrawer = room.state.drawer === uid;
    if (!isDrawer && leaderOf(room) !== uid) throw forbidden();
    const cur = room.state;
    if (cur.turnId !== turnId || (cur.phase !== "drawing" && cur.phase !== "choosing")) return null;
    // 정답은 그리는 사람이 끝낼 때만 공개 (리더가 대신 끝내면 건너뜀). 서버가 아는 제시어와 다르면 서버 것을 씀
    const chosen = room.words?.turnId === turnId ? room.words.word : undefined;
    const shown = isDrawer && reveal ? (chosen ?? reveal) : "";
    room.state = { ...cur, phase: "reveal", reveal: shown, endsAt: Date.now() + REVEAL_MS };
    // 이 방에서 다시 안 나오게 기록 (공개된 뒤에 기록해야 미리 답이 새지 않음)
    if (shown) room.used[normalizeAnswer(shown).replace(/[.#$[\]/]/g, "_")] = true;
    changed(room);
    systemChat(room, shown ? `정답은 「${shown}」` : "이번 차례는 건너뛰었어요.");
    return null;
  });

  /** 리더: 다음 차례 또는 게임 종료 */
  gateway.rpc("sketch.nextTurn", (ctx, raw) => {
    const { id, turnId } = z.object({ id: roomId, turnId: z.string().max(40) }).parse(raw);
    const { room } = asLeader(ctx, id);
    const cur = room.state;
    if (cur.turnId !== turnId || cur.phase !== "reveal") return null;
    const drawer = orderedPlayers(room).length < 2 ? "" : nextDrawer(room);
    if (!drawer) {
      room.state = { ...cur, phase: "ended", endsAt: 0 };
      clearGuesses(room);
      setWords(room, null);
      changed(room);
      systemChat(room, "게임 끝! 최종 순위를 확인하세요.");
      return null;
    }
    beginTurn(room, {
      ...newTurn(room, drawer, cur.turnNo + 1),
      drawn: { ...cur.drawn, [drawer]: (cur.drawn[drawer] ?? 0) + 1 },
    });
    changed(room);
    return null;
  });

  /** 리더: 대기실로 */
  gateway.rpc("sketch.backToWaiting", (ctx, raw) => {
    const { room } = asLeader(ctx, idOnly.parse(raw).id);
    clearStrokes(room);
    room.strokesTurn = "";
    room.state = emptyState();
    drawerChanged(room);
    changed(room);
    return null;
  });

  // ───────────── 그림 ─────────────

  /** 지금 차례의 그리는 사람만 */
  function asDrawerOfTurn(ctx: Ctx, id: string, turn: string) {
    const { room } = asDrawer(ctx, id);
    if (room.state.turnId !== turn || room.strokesTurn !== turn) throw forbidden();
    return room;
  }

  const addStrokeSchema = z.object({ id: roomId, turn: z.string().max(40), key: z.unknown().optional(), s: strokeSchema });
  gateway.rpc("sketch.addStroke", (ctx, raw) => {
    const { id, turn, key, s } = addStrokeSchema.parse(raw);
    const room = asDrawerOfTurn(ctx, id, turn);
    if (room.strokes.size >= MAX_STROKES) throw bad("그림이 너무 많아요.");
    const k = isClientId(key) && !room.strokes.has(key) ? key : orderedId();
    room.strokes.set(k, s);
    gateway.emit(strokesKey(id, turn), "add", [k, s]);
    return k;
  });

  gateway.rpc("sketch.removeStrokes", (ctx, raw) => {
    const { id, turn, keys } = z.object({ id: roomId, turn: z.string().max(40), keys: z.array(z.string().max(40)).max(5000) }).parse(raw);
    const room = asDrawerOfTurn(ctx, id, turn);
    const removed = keys.filter((k) => room.strokes.delete(k));
    if (removed.length) gateway.emit(strokesKey(id, turn), "remove", removed);
    return null;
  });

  gateway.rpc("sketch.clearStrokes", (ctx, raw) => {
    const { id, turn } = z.object({ id: roomId, turn: z.string().max(40) }).parse(raw);
    clearStrokes(asDrawerOfTurn(ctx, id, turn));
    return null;
  });

  // ───────────── 채팅 · 정답 시도 ─────────────

  const chatSchema = z.object({ id: roomId, nick: z.string().max(10), text: z.string().min(1).max(100), cid: z.unknown().optional() });
  gateway.rpc("sketch.sendChat", (ctx, raw) => {
    const { id, nick, text, cid } = chatSchema.parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    pushChat(room, { id: isClientId(cid) ? cid : undefined, uid, nick: nameIn(room, uid, ctx.name(nick)), text, kind: "msg" });
    return null;
  });

  /** 안내 메시지 (입장 알림 등 화면에서 직접 올리는 것) — 참가자만 */
  gateway.rpc("sketch.systemChat", (ctx, raw) => {
    const { id, text } = z.object({ id: roomId, text: z.string().min(1).max(100) }).parse(raw);
    const { room } = asPlayer(ctx, id);
    systemChat(room, text);
    return null;
  });

  /** 그리는 중 정답 시도 — 그리는 사람만 받아서 판정 */
  const guessSchema = z.object({ id: roomId, nick: z.string().max(10), text: z.string().min(1).max(100), turnId: z.string().max(40) });
  gateway.rpc("sketch.sendGuess", (ctx, raw) => {
    const { id, nick, text, turnId } = guessSchema.parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    if (room.guesses.length >= MAX_GUESSES) room.guesses.shift();
    const g: Guess = { id: orderedId(), uid, nick: nameIn(room, uid, ctx.name(nick)), text, turnId, ts: Date.now() };
    room.guesses.push(g);
    gateway.emit(guessesKey(id), "add", g);
    return null;
  });

  gateway.rpc("sketch.removeGuess", (ctx, raw) => {
    const { id, guessId } = z.object({ id: roomId, guessId: z.string().max(40) }).parse(raw);
    const { room } = asDrawer(ctx, id);
    room.guesses = room.guesses.filter((g) => g.id !== guessId);
    return null;
  });

  /** 오답은 그리는 사람이 대신 채팅에 올려줌 */
  const relaySchema = z.object({ id: roomId, guess: z.object({ uid: z.string().max(128), nick: z.string().max(12), text: z.string().min(1).max(100) }) });
  gateway.rpc("sketch.relayGuess", (ctx, raw) => {
    const { id, guess } = relaySchema.parse(raw);
    const { room } = asDrawer(ctx, id);
    pushChat(room, { uid: guess.uid, nick: nameIn(room, guess.uid, guess.nick), text: guess.text, kind: "msg" });
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
    /** (관리자) 지금 열려 있는 방 */
    adminList(): LiveRoom[] {
      return [...rooms.values()].map((r) => ({
        id: r.id,
        name: r.meta.name,
        status: r.state.phase,
        players: Object.values(r.players).map((p) => p.nick),
        createdAt: r.meta.createdAt,
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
