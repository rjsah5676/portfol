import { ApiError } from "@/lib/api/errors";
import { rpc, serverNow as socketServerNow, setServerTime, subscribe } from "@/lib/api/socket";
import { toTimestamp, type Timestamp } from "@/lib/api/timestamp";
import { WrongPasswordError } from "@/lib/roomLock";

/*
 * 2인 대국 게임 공통 방 시스템 (체스·장기가 같이 씀)
 *
 * - 방 상태는 백엔드 서버가 들고 있고(MongoDB), 소켓 구독으로 실시간 동기화.
 * - 익명 Auth uid 로 좌석을 식별 → 같은 브라우저면 창을 닫았다 와도 자리 그대로 복귀.
 * - 수 두기/무르기/시계 등은 전부 서버가 검증하고 처리 (server/src/games/board).
 *   여기서는 요청을 보내고, 서버가 알려주는 방 상태를 화면에 넘겨줌.
 * - 접속 상태는 하트비트(beat)로 따로 관리.
 * - 게임 규칙(BoardRoomConfig)은 화면에서 기보를 다시 둬 보는 데만 쓰임.
 *   좌석 이름은 체스 기준 white/black (장기는 white = 초(선), black = 한).
 */

export type Color = "w" | "b";
export type RoomStatus = "waiting" | "playing" | "ended" | "closed";
export type GameResult = "" | "1-0" | "0-1" | "1/2-1/2";

export interface BoardRoom<R extends string = string> {
  id: string;
  name: string;
  hostUid: string;
  whiteUid: string;
  whiteName: string;
  blackUid: string;
  blackName: string;
  /** 0 = 무제한 */
  timeMin: number;
  incSec: number;
  status: RoomStatus;
  /** 기보 (게임별 표기: 체스 UCI "e2e4", 장기 "e8e7"·"pass") */
  moves: string[];
  /** 게임별 시작 설정 (장기 상차림 등, 체스는 "") */
  variant: string;
  fen: string;
  /** turnStartedAt 시점의 남은 시간 */
  whiteMs: number;
  blackMs: number;
  turnStartedAt: Timestamp | null;
  /** 방장이 일시정지한 시각 (null이면 진행중). 멈춘 동안은 시계가 흐르지 않음 */
  pausedAt: Timestamp | null;
  result: GameResult;
  reason: R | "";
  /** ply = 요청 당시 moves.length (그 사이 수가 진행되면 무효) */
  undoReq: { uid: string; ply: number } | null;
  drawOffer: string;
  /** 다시 하기를 먼저 누른 대국자 uid ("" = 없음) */
  rematch: string;
  spectators: Record<string, string>;
  /** 비밀번호 방 (링크의 초대키로 들어오면 비번 없이 입장) */
  locked: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Presence {
  name: string;
  lastSeen: number; // 서버 기준 ms
}

export const MAX_SPECTATORS = 2;
export const HEARTBEAT_MS = 25_000;
/** 이 시간 동안 하트비트 없으면 "연결 끊김" 표시 */
export const OFFLINE_AFTER_MS = 60_000;
/** 상대가 이 시간 이상 끊겨 있으면 승리 선언 가능 */
export const ABANDON_AFTER_MS = 180_000;
/** 대기방 방장이 이 시간 이상 안 보이면 로비에서 숨김 */
export const WAITING_STALE_MS = 3 * 60_000;
/** 일시정지가 이 시간 넘게 이어지면 대국 종료(무승부) 처리 */
export const PAUSE_LIMIT_MS = 2 * 60 * 60_000;
/** 방장 시간 추가 단위 */
export const ADD_TIME_MS = 30_000;

// ───────────────────── 서버 시각 보정 ─────────────────────
// 클라이언트 시계가 틀어져 있으면 시간제 대국에서 남은 시간이 엉망이 되므로 서버 시계 기준으로 계산.
// (보정값은 소켓 연결이 서버와 시각을 주고받아 잡음 → lib/api/socket)
export const serverNow = () => socketServerNow();
export function syncServerOffset(serverMs: number) {
  setServerTime(serverMs);
}

// ───────────────────── 순수 헬퍼 ─────────────────────

export function colorOf(room: BoardRoom, uid: string | null | undefined): Color | null {
  if (!uid) return null;
  if (room.whiteUid === uid) return "w";
  if (room.blackUid === uid) return "b";
  return null;
}

export const turnOf = (room: Pick<BoardRoom, "moves">): Color =>
  room.moves.length % 2 === 0 ? "w" : "b";

/** 지금 이 순간 기준 양쪽 남은 시간 (진행중인 쪽은 경과시간 차감) */
export function liveClock(room: BoardRoom, now = serverNow()): { w: number; b: number } {
  const clock = { w: room.whiteMs, b: room.blackMs };
  // 일시정지 중에는 멈춘 시점에 이미 정산해뒀으므로 차감하지 않음
  if (room.timeMin > 0 && room.status === "playing" && room.turnStartedAt && !room.pausedAt) {
    const t = turnOf(room);
    clock[t] = Math.max(0, clock[t] - Math.max(0, now - room.turnStartedAt.toMillis()));
  }
  return clock;
}

export const winFor = (c: Color): GameResult => (c === "w" ? "1-0" : "0-1");
export const other = (c: Color): Color => (c === "w" ? "b" : "w");

/**
 * 요청자 기준으로 몇 수(ply)를 되돌릴지.
 * - 내가 방금 둔 상태(상대 차례) → 1수
 * - 상대가 이미 받아둔 상태(내 차례) → 2수 (상대 수 + 내 수)
 * 0이면 무를 수 있는 내 수가 없음.
 */
export function undoPlies(room: BoardRoom, color: Color): number {
  const n = room.moves.length;
  if (n === 0) return 0;
  const lastMover: Color = n % 2 === 1 ? "w" : "b";
  const plies = lastMover === color ? 1 : 2;
  return n >= plies ? plies : 0;
}

export function isPauseExpired(room: BoardRoom, now = serverNow()): boolean {
  return (
    room.status === "playing" && !!room.pausedAt && now - room.pausedAt.toMillis() > PAUSE_LIMIT_MS
  );
}

export interface CreateRoomInput {
  name: string;
  uid: string;
  nick: string;
  color: Color | "r";
  timeMin: number;
  incSec: number;
  /** 비우면 공개방 */
  password?: string;
  /** 게임별 시작 설정 (장기 상차림 등) */
  variant?: string;
}

export class ActiveRoomError extends Error {
  constructor(public room: BoardRoom) {
    super("이미 진행중인 게임이 있습니다.");
  }
}

export const CHAT_MAX = 200;

/** 화면에 유지하는 최근 메시지 수 */
const CHAT_LIMIT = 100;

export interface ChatMessage {
  id: string;
  uid: string;
  name: string;
  text: string;
  at: number;
  pending: boolean;
}

export interface BoardRoomConfig<G, R extends string> {
  /** 방 컬렉션 이름 ("chess_rooms") — 서버에서 게임을 구분하는 데 씀 */
  collection: string;
  /** 페이지 경로 (초대 링크용, "/games/board/?g=chess") */
  path: string;
  initialFen(variant: string): string;
  replay(moves: string[], variant: string): G;
  fenOf(game: G): string;
  /** 수 두기, 불법수면 throw */
  play(game: G, move: string): void;
  /** 수를 둔 뒤 게임이 끝났으면 결과 */
  endState(game: G): { result: GameResult; reason: R } | null;
  /** loser의 시간이 다 됐을 때 결과 */
  timeoutResult(game: G, loser: Color): GameResult;
}

export function createBoardRooms<G, R extends string>(cfg: BoardRoomConfig<G, R>) {
  type Room = BoardRoom<R>;
  /** 서버에서 쓰는 게임 이름 ("chess_rooms" → "chess") */
  const g = cfg.collection.replace(/_rooms$/, "");

  /** 서버가 보낸 방(시각 = ms 숫자)을 화면용으로 */
  function normalize(data: Record<string, unknown>): Room {
    const d = data as Partial<
      Omit<Room, "turnStartedAt" | "pausedAt" | "createdAt" | "updatedAt">
    > & {
      turnStartedAt?: number | null;
      pausedAt?: number | null;
      createdAt?: number | null;
      updatedAt?: number | null;
    };
    return {
      id: d.id ?? "",
      name: d.name ?? "",
      hostUid: d.hostUid ?? "",
      whiteUid: d.whiteUid ?? "",
      whiteName: d.whiteName ?? "",
      blackUid: d.blackUid ?? "",
      blackName: d.blackName ?? "",
      timeMin: d.timeMin ?? 0,
      incSec: d.incSec ?? 0,
      status: d.status ?? "waiting",
      moves: d.moves ?? [],
      variant: d.variant ?? "",
      fen: d.fen ?? cfg.initialFen(d.variant ?? ""),
      whiteMs: d.whiteMs ?? 0,
      blackMs: d.blackMs ?? 0,
      turnStartedAt: toTimestamp(d.turnStartedAt),
      result: d.result ?? "",
      reason: d.reason ?? "",
      undoReq: d.undoReq ?? null,
      drawOffer: d.drawOffer ?? "",
      rematch: d.rematch ?? "",
      pausedAt: toTimestamp(d.pausedAt),
      spectators: d.spectators ?? {},
      locked: d.locked === true,
      createdAt: toTimestamp(d.createdAt),
      updatedAt: toTimestamp(d.updatedAt),
    };
  }

  /** 방 하나에 대한 요청 */
  const call = <T = null>(name: string, roomId: string, extra?: Record<string, unknown>) =>
    rpc<T>(`board.${name}`, { g, id: roomId, ...extra }).catch(rethrow);

  /** 서버 오류 → 화면이 기대하는 오류 */
  function rethrow(e: unknown): never {
    if (e instanceof ApiError && e.code === "ACTIVE_ROOM" && e.data)
      throw new ActiveRoomError(normalize(e.data as Record<string, unknown>));
    throw e;
  }

  // ───────────────────── 구독 ─────────────────────

  /** 최근 갱신된 방 40개 */
  function subscribeRooms(cb: (rooms: Room[]) => void, onError?: (e: Error) => void) {
    type Snap = { s: number; list: Record<string, unknown>[] };
    let last = 0;
    const apply = (snap: Snap) => {
      // 늦게 도착한 옛 목록은 버림 (s = 서버 조회 순번)
      if (snap.s < last) return;
      last = snap.s;
      cb(snap.list.map(normalize));
    };
    return subscribe<Snap>(
      "board.lobby",
      { g },
      {
        onSnapshot: apply,
        onEvent: (type, data) => {
          if (type === "list") apply(data as Snap);
        },
        onError,
      }
    );
  }

  function subscribeRoom(
    id: string,
    cb: (room: Room | null) => void,
    onError?: (e: Error) => void
  ) {
    type Wire = (Record<string, unknown> & { v?: number }) | null;
    let lastV = -1;
    const apply = (data: Wire, fresh: boolean) => {
      if (!data) {
        lastV = -1;
        cb(null);
        return;
      }
      // v = 방이 바뀔 때마다 +1 → 늦게 도착한 옛 상태는 버림
      const v = data.v ?? 0;
      if (!fresh && v < lastV) return;
      lastV = v;
      cb(normalize(data));
    };
    return subscribe<Wire>(
      "board.room",
      { g, id },
      {
        onSnapshot: (data) => apply(data, true),
        onEvent: (type, data) => {
          if (type === "room") apply(data as Wire, false);
        },
        onError,
      }
    );
  }

  function subscribePresence(
    roomId: string,
    // 예전에는 내 하트비트로 서버 시각을 맞추느라 필요했음 (지금은 소켓 계층이 맞춤)
    _myUid: string | null,
    cb: (p: Record<string, Presence>) => void
  ) {
    type Wire = Record<string, { name?: string; lastSeen?: number }>;
    const apply = (data: Wire) => {
      const out: Record<string, Presence> = {};
      for (const [uid, p] of Object.entries(data ?? {}))
        out[uid] = { name: p.name ?? "", lastSeen: p.lastSeen ?? serverNow() };
      cb(out);
    };
    return subscribe<Wire>(
      "board.presence",
      { g, id: roomId },
      {
        onSnapshot: apply,
        onEvent: (type, data) => {
          if (type === "presence") apply(data as Wire);
        },
      }
    );
  }

  async function beat(roomId: string, _uid: string, name: string, bumpRoom = false) {
    // 대기방은 로비에서 "살아있는 방"인지 판단하려고 방의 updatedAt 도 갱신 (bumpRoom)
    await call("beat", roomId, { name, bumpRoom });
  }

  // ───────────────────── 방 생성/참여/퇴장 ─────────────────────

  /** 내가 대국자로 앉아있는 대기/진행중 방 (방 중복 생성·참여 방지용) */
  async function findMyActiveRoom(_uid: string): Promise<Room | null> {
    const room = await rpc<Record<string, unknown> | null>("board.findMyActiveRoom", { g });
    return room ? normalize(room) : null;
  }

  async function createRoom({
    name,
    nick,
    color,
    timeMin,
    incSec,
    password = "",
    variant = "",
  }: CreateRoomInput): Promise<string> {
    // 비밀번호는 서버가 방 id와 섞어 해시로만 저장 (평문은 저장하지 않음)
    return rpc<string>("board.createRoom", {
      g,
      name,
      nick,
      color,
      timeMin,
      incSec,
      password,
      variant,
    }).catch(rethrow);
  }

  // ───────────────────── 비밀번호 방 ─────────────────────

  /** 이 방에 들어갈 권한이 있는지 (공개방이거나, 비번/초대키를 이미 맞혔거나) */
  async function hasRoomAccess(room: Room, uid: string): Promise<boolean> {
    if (!room.locked || colorOf(room, uid) || room.spectators[uid] !== undefined) return true;
    try {
      return await rpc<boolean>("board.hasRoomAccess", { g, id: room.id });
    } catch {
      return false;
    }
  }

  /** 비밀번호나 초대키로 권한 얻기 — 틀리면 서버에서 거부됨 */
  async function unlockRoom(
    roomId: string,
    _uid: string,
    cred: { password?: string; invite?: string }
  ) {
    try {
      await rpc("board.unlockRoom", {
        g,
        id: roomId,
        ...(cred.invite !== undefined
          ? { invite: cred.invite }
          : { password: cred.password ?? "" }),
      });
    } catch {
      throw new WrongPasswordError();
    }
  }

  /** 초대 링크 (참가자만 초대키를 받을 수 있음, 못 받으면 키 없이) */
  async function inviteLink(roomId: string): Promise<string> {
    let key = "";
    try {
      key = (await rpc<string>("board.inviteKey", { g, id: roomId })) ?? "";
    } catch {
      key = "";
    }
    return `${location.origin}${cfg.path}${cfg.path.includes("?") ? "&" : "?"}room=${roomId}${key ? `&k=${key}` : ""}`;
  }

  async function joinAsPlayer(roomId: string, _uid: string, nick: string) {
    await call("joinAsPlayer", roomId, { nick });
  }

  /** 방장만 시작 가능. 두 자리가 다 찼을 때 백 시계부터 돌아감 */
  async function startGame(roomId: string, _uid: string) {
    await call("startGame", roomId);
  }

  async function joinAsSpectator(roomId: string, _uid: string, nick: string) {
    await call("joinAsSpectator", roomId, { nick });
  }

  /** 대국 중인 플레이어는 나가도 자리가 유지됨 (다시 들어오면 이어서 진행) */
  async function leaveRoom(room: Room, _uid: string) {
    await call("leaveRoom", room.id);
  }

  // ───────────────────── 대국 ─────────────────────

  async function makeMove(roomId: string, _uid: string, uci: string) {
    await call("makeMove", roomId, { move: uci });
  }

  /** 수를 두는 쪽의 시간이 0이 된 걸 본 대국자가 호출 */
  async function claimTimeout(roomId: string) {
    await call("claimTimeout", roomId);
  }

  async function claimAbandon(roomId: string, _uid: string) {
    await call("claimAbandon", roomId);
  }

  async function resign(roomId: string, _uid: string) {
    await call("resign", roomId);
  }

  async function offerDraw(roomId: string, _uid: string) {
    await call("offerDraw", roomId);
  }

  async function respondDraw(roomId: string, _uid: string, accept: boolean) {
    await call("respondDraw", roomId, { accept });
  }

  // ───────────────────── 다시 하기 ─────────────────────

  /**
   * 끝난 방에서 같은 상대와 바로 한 판 더 (방 새로 만들 필요 없음).
   * 한쪽이 누르면 신청, 다른 쪽도 누르면 흑백(선후)을 바꿔 바로 새 대국 시작.
   */
  async function requestRematch(roomId: string, _uid: string) {
    await call("requestRematch", roomId);
  }

  /** 다시 하기 신청 취소 / 거절 */
  async function cancelRematch(roomId: string) {
    await call("cancelRematch", roomId);
  }

  // ───────────────────── 무르기 ─────────────────────

  async function requestUndo(room: Room, uid: string) {
    const me = colorOf(room, uid);
    if (!me || room.status !== "playing" || undoPlies(room, me) === 0) return;
    await call("requestUndo", room.id);
  }

  async function cancelUndo(roomId: string) {
    await call("cancelUndo", roomId);
  }

  async function respondUndo(roomId: string, _uid: string, accept: boolean) {
    await call("respondUndo", roomId, { accept });
  }

  // ───────────────────── 방장 전용: 일시정지 / 시간 추가 ─────────────────────

  async function pauseGame(roomId: string, _uid: string) {
    await call("pauseGame", roomId);
  }

  async function resumeGame(roomId: string, _uid: string) {
    await call("resumeGame", roomId);
  }

  /** 방장이 자신 또는 상대 시계에 시간 추가 (한 번에 ADD_TIME_MS) */
  async function addTime(roomId: string, _uid: string, color: Color) {
    await call("addTime", roomId, { color });
  }

  /** 2시간 넘게 멈춘 대국 종료 (대국자 누구든 호출, 조건은 서버에서 재확인) */
  async function expirePausedGame(roomId: string) {
    await call("expirePausedGame", roomId);
  }

  // ───────────────────── 채팅 ─────────────────────
  // 대국자·관전자만 쓰기, 읽기는 누구나 (서버에서 검사)

  type ChatWire = Omit<ChatMessage, "pending">;
  /** 지금 이 페이지에서 열려 있는 채팅 구독 (방별) — 내가 보낸 메시지를 보내는 즉시 띄우려고 */
  const chatViews = new Map<string, Set<ChatView>>();
  interface ChatView {
    /** 서버가 확정해 준 메시지 (오래된 것부터) */
    confirmed: ChatWire[];
    /** 보냈지만 아직 확정 안 된 내 메시지 */
    pending: ChatWire[];
    emit(): void;
  }

  function subscribeChat(roomId: string, cb: (list: ChatMessage[]) => void) {
    const view: ChatView = {
      confirmed: [],
      pending: [],
      emit() {
        const list: ChatMessage[] = [
          ...view.confirmed.map((m) => ({ ...m, pending: false })),
          ...view.pending.map((m) => ({ ...m, pending: true })),
        ];
        cb(list.slice(-CHAT_LIMIT));
      },
    };
    let set = chatViews.get(roomId);
    if (!set) chatViews.set(roomId, (set = new Set()));
    set.add(view);

    const confirm = (m: ChatWire) => {
      view.pending = view.pending.filter((p) => p.id !== m.id);
      if (view.confirmed.some((c) => c.id === m.id)) return;
      view.confirmed = [...view.confirmed, m].slice(-CHAT_LIMIT);
    };
    const unsub = subscribe<ChatWire[]>(
      "board.chat",
      { g, id: roomId },
      {
        onSnapshot: (list) => {
          view.confirmed = [];
          (list ?? []).forEach(confirm);
          view.emit();
        },
        onEvent: (type, data) => {
          if (type !== "add") return;
          confirm(data as ChatWire);
          view.emit();
        },
      }
    );
    return () => {
      unsub();
      set.delete(view);
      if (!set.size) chatViews.delete(roomId);
    };
  }

  async function sendChat(roomId: string, uid: string, name: string, text: string) {
    const t = text.trim().slice(0, CHAT_MAX);
    if (!t) return;
    // 보내는 즉시 흐리게(pending) 띄우고, 서버가 같은 id로 확정해 주면 진하게 바뀜
    const msg: ChatWire = {
      id: newChatId(),
      uid,
      name: name.slice(0, 20),
      text: t,
      at: serverNow(),
    };
    const views = [...(chatViews.get(roomId) ?? [])];
    for (const v of views) {
      v.pending = [...v.pending, msg];
      v.emit();
    }
    try {
      await call("sendChat", roomId, { name: msg.name, text: t, cid: msg.id });
    } catch (e) {
      for (const v of views) {
        v.pending = v.pending.filter((p) => p.id !== msg.id);
        v.emit();
      }
      throw e;
    }
  }

  return {
    subscribeRooms,
    subscribeRoom,
    subscribePresence,
    beat,
    findMyActiveRoom,
    createRoom,
    hasRoomAccess,
    unlockRoom,
    inviteLink,
    joinAsPlayer,
    startGame,
    joinAsSpectator,
    leaveRoom,
    makeMove,
    claimTimeout,
    claimAbandon,
    resign,
    offerDraw,
    respondDraw,
    requestUndo,
    cancelUndo,
    respondUndo,
    requestRematch,
    cancelRematch,
    pauseGame,
    resumeGame,
    addTime,
    expirePausedGame,
    subscribeChat,
    sendChat,
  };
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** 채팅 메시지 id (영숫자 20자) — 보낸 쪽에서 정해야 서버 확정본과 짝을 맞출 수 있음 */
function newChatId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let s = "";
  for (const b of bytes) s += ID_CHARS[b % ID_CHARS.length];
  return s;
}
