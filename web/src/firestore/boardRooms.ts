import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
  type Transaction,
} from "firebase/firestore";
import { db } from "../firebase";
import { hashPassword, randomKey, WrongPasswordError } from "@/lib/roomLock";

/*
 * 2인 대국 게임 공통 방 시스템 (체스·장기가 같이 씀)
 *
 * - 정적 호스팅이라 소켓 서버 대신 Firestore onSnapshot 으로 실시간 동기화.
 * - 익명 Auth uid 로 좌석을 식별 → 같은 브라우저면 창을 닫았다 와도 자리 그대로 복귀.
 * - 방 문서({collection}/{id}) : 대국 상태 전체. 수 두기/무르기 등은 전부 트랜잭션.
 * - 접속 상태({collection}/{id}/presence/{uid}) : 하트비트. 방 문서와 분리해서
 *   하트비트마다 로비 리스너까지 깨우지 않도록 함.
 * - 게임 규칙(수 검증·종료 판정)만 BoardRoomConfig로 받아서 끼움.
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
// 클라이언트 시계가 틀어져 있으면 시간제 대국에서 남은 시간이 엉망이 되므로,
// 내 presence 문서의 serverTimestamp 와 로컬 시각 차이로 오프셋을 잡아둠.
let serverOffset = 0;
export const serverNow = () => Date.now() + serverOffset;
export function syncServerOffset(serverMs: number) {
  serverOffset = serverMs - Date.now();
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
  /** Firestore 컬렉션 ("chess_rooms") */
  collection: string;
  /** 페이지 경로 (초대 링크용, "/games/chess/") */
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
  const ROOMS = cfg.collection;
  const roomRef = (id: string) => doc(db, ROOMS, id);
  const presenceRef = (roomId: string, uid: string) => doc(db, ROOMS, roomId, "presence", uid);

  function normalize(id: string, data: Record<string, unknown>): Room {
    const d = data as Partial<Room>;
    return {
      id,
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
      turnStartedAt: d.turnStartedAt ?? null,
      result: d.result ?? "",
      reason: d.reason ?? "",
      undoReq: d.undoReq ?? null,
      drawOffer: d.drawOffer ?? "",
      rematch: d.rematch ?? "",
      pausedAt: d.pausedAt ?? null,
      spectators: d.spectators ?? {},
      locked: d.locked === true,
      createdAt: d.createdAt ?? null,
      updatedAt: d.updatedAt ?? null,
    };
  }

  async function readRoom(tx: Transaction, id: string): Promise<Room> {
    const snap = await tx.get(roomRef(id));
    if (!snap.exists()) throw new Error("방이 존재하지 않습니다.");
    return normalize(snap.id, snap.data());
  }

  // ───────────────────── 구독 ─────────────────────

  function subscribeRooms(cb: (rooms: Room[]) => void, onError?: (e: Error) => void) {
    const q = query(collection(db, ROOMS), orderBy("updatedAt", "desc"), limit(40));
    return onSnapshot(
      q,
      { includeMetadataChanges: false },
      (snap) => cb(snap.docs.map((d) => normalize(d.id, d.data({ serverTimestamps: "estimate" })))),
      onError
    );
  }

  function subscribeRoom(
    id: string,
    cb: (room: Room | null) => void,
    onError?: (e: Error) => void
  ) {
    return onSnapshot(
      roomRef(id),
      (snap) =>
        cb(snap.exists() ? normalize(snap.id, snap.data({ serverTimestamps: "estimate" })) : null),
      onError
    );
  }

  function subscribePresence(
    roomId: string,
    myUid: string | null,
    cb: (p: Record<string, Presence>) => void
  ) {
    return onSnapshot(collection(db, ROOMS, roomId, "presence"), (snap) => {
      // 오프셋은 "방금 서버가 확정해준 내 하트비트"로만 계산해야 함.
      // (다른 사람 하트비트로 스냅샷이 올 때 예전 내 lastSeen 으로 맞추면 시계가 뒤로 밀림)
      snap.docChanges().forEach((c) => {
        if (c.doc.id !== myUid || c.type === "removed" || c.doc.metadata.hasPendingWrites) return;
        const ts = c.doc.data().lastSeen as Timestamp | null;
        if (ts) syncServerOffset(ts.toMillis());
      });
      const out: Record<string, Presence> = {};
      snap.docs.forEach((d) => {
        const data = d.data({ serverTimestamps: "estimate" });
        const ts = data.lastSeen as Timestamp | null;
        out[d.id] = { name: data.name ?? "", lastSeen: ts ? ts.toMillis() : serverNow() };
      });
      cb(out);
    });
  }

  async function beat(roomId: string, uid: string, name: string, bumpRoom = false) {
    await setDoc(presenceRef(roomId, uid), { name, lastSeen: serverTimestamp() });
    // 대기방은 로비에서 "살아있는 방"인지 판단하려고 updatedAt 도 갱신
    if (bumpRoom) await updateDoc(roomRef(roomId), { updatedAt: serverTimestamp() });
  }

  // ───────────────────── 방 생성/참여/퇴장 ─────────────────────

  /** 내가 대국자로 앉아있는 대기/진행중 방 (방 중복 생성·참여 방지용) */
  async function findMyActiveRoom(uid: string): Promise<Room | null> {
    const snaps = await Promise.all(
      (["whiteUid", "blackUid"] as const).map((f) =>
        getDocs(query(collection(db, ROOMS), where(f, "==", uid)))
      )
    );
    const rooms = snaps
      .flatMap((s) => s.docs.map((d) => normalize(d.id, d.data())))
      .filter((r) => {
        if (isPauseExpired(r)) {
          expirePausedGame(r.id).catch(() => {});
          return false;
        }
        return r.status === "waiting" || r.status === "playing";
      })
      .sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0));
    return rooms[0] ?? null;
  }

  async function createRoom({
    name,
    uid,
    nick,
    color,
    timeMin,
    incSec,
    password = "",
    variant = "",
  }: CreateRoomInput): Promise<string> {
    const active = await findMyActiveRoom(uid);
    if (active) throw new ActiveRoomError(active);
    const myColor: Color = color === "r" ? (Math.random() < 0.5 ? "w" : "b") : color;
    const ms = timeMin * 60_000;
    const ref = doc(collection(db, ROOMS));
    const locked = password.trim() !== "";
    const batch = writeBatch(db);
    batch.set(ref, {
      name: name.trim().slice(0, 20),
      hostUid: uid,
      whiteUid: myColor === "w" ? uid : "",
      whiteName: myColor === "w" ? nick : "",
      blackUid: myColor === "b" ? uid : "",
      blackName: myColor === "b" ? nick : "",
      timeMin,
      incSec,
      status: "waiting",
      moves: [],
      variant,
      fen: cfg.initialFen(variant),
      whiteMs: ms,
      blackMs: ms,
      turnStartedAt: null,
      pausedAt: null,
      result: "",
      reason: "",
      undoReq: null,
      drawOffer: "",
      spectators: {},
      locked,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    // 초대키는 참가자만 읽을 수 있고(초대 링크용), 비밀번호 해시는 아무도 못 읽음(규칙에서만 비교)
    const invite = randomKey();
    batch.set(doc(db, ROOMS, ref.id, "private", "invite"), { key: invite });
    if (locked) {
      const pw = await hashPassword(ref.id, password.trim());
      batch.set(doc(db, ROOMS, ref.id, "private", "lock"), { pw, invite });
      batch.set(doc(db, ROOMS, ref.id, "access", uid), { key: pw });
    }
    await batch.commit();
    return ref.id;
  }

  // ───────────────────── 비밀번호 방 ─────────────────────

  /** 이 방에 들어갈 권한이 있는지 (공개방이거나, 비번/초대키를 이미 맞혔거나) */
  async function hasRoomAccess(room: Room, uid: string): Promise<boolean> {
    if (!room.locked || colorOf(room, uid) || room.spectators[uid] !== undefined) return true;
    try {
      return (await getDoc(doc(db, ROOMS, room.id, "access", uid))).exists();
    } catch {
      return false;
    }
  }

  /** 비밀번호나 초대키로 권한 얻기 — 틀리면 규칙에서 거부됨 */
  async function unlockRoom(
    roomId: string,
    uid: string,
    cred: { password?: string; invite?: string }
  ) {
    const key = cred.invite ?? (await hashPassword(roomId, cred.password ?? ""));
    try {
      await setDoc(doc(db, ROOMS, roomId, "access", uid), { key });
    } catch {
      throw new WrongPasswordError();
    }
  }

  /** 초대 링크 (참가자만 초대키를 읽을 수 있음, 예전 방은 키 없이) */
  async function inviteLink(roomId: string): Promise<string> {
    let key = "";
    try {
      key =
        ((await getDoc(doc(db, ROOMS, roomId, "private", "invite"))).data()?.key as string) ?? "";
    } catch {
      key = "";
    }
    return `${location.origin}${cfg.path}?room=${roomId}${key ? `&k=${key}` : ""}`;
  }

  async function joinAsPlayer(roomId: string, uid: string, nick: string) {
    const active = await findMyActiveRoom(uid);
    if (active && active.id !== roomId) throw new ActiveRoomError(active);
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      if (colorOf(room, uid)) return;
      if (room.status !== "waiting") throw new Error("이미 대국이 시작된 방입니다.");
      const seat: Color | null = !room.whiteUid ? "w" : !room.blackUid ? "b" : null;
      if (!seat) throw new Error("빈 자리가 없습니다.");
      const spectators = { ...room.spectators };
      delete spectators[uid];
      tx.update(roomRef(roomId), {
        ...(seat === "w" ? { whiteUid: uid, whiteName: nick } : { blackUid: uid, blackName: nick }),
        spectators,
        updatedAt: serverTimestamp(),
      });
    });
  }

  /** 방장만 시작 가능. 두 자리가 다 찼을 때 백 시계부터 돌아감 */
  async function startGame(roomId: string, uid: string) {
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      if (room.hostUid !== uid) throw new Error("방장만 시작할 수 있습니다.");
      if (room.status !== "waiting") return;
      if (!room.whiteUid || !room.blackUid) throw new Error("상대가 아직 입장하지 않았습니다.");
      tx.update(roomRef(roomId), {
        status: "playing",
        turnStartedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function joinAsSpectator(roomId: string, uid: string, nick: string) {
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      if (colorOf(room, uid) || room.spectators[uid] !== undefined) return;
      const spectators = { ...room.spectators };
      // 창만 닫고 사라진 관전자는 자리 비워줌
      const others = Object.keys(spectators);
      const snaps = await Promise.all(others.map((u) => tx.get(presenceRef(roomId, u))));
      snaps.forEach((s, i) => {
        const ts = s.exists() ? (s.data().lastSeen as Timestamp | null) : null;
        if (!ts || serverNow() - ts.toMillis() > OFFLINE_AFTER_MS * 1.5)
          delete spectators[others[i]];
      });
      if (Object.keys(spectators).length >= MAX_SPECTATORS)
        throw new Error("관전 인원이 가득 찼습니다. (최대 2명)");
      spectators[uid] = nick;
      tx.update(roomRef(roomId), { spectators });
    });
  }

  /** 대국 중인 플레이어는 나가도 자리가 유지됨 (다시 들어오면 이어서 진행) */
  async function leaveRoom(room: Room, uid: string) {
    const color = colorOf(room, uid);
    if (!color) {
      if (room.spectators[uid] !== undefined) {
        await updateDoc(roomRef(room.id), { [`spectators.${uid}`]: deleteField() });
      }
      await deleteDoc(presenceRef(room.id, uid)).catch(() => {});
      return;
    }
    if (room.status === "waiting") {
      // 방장이 나가면 방 닫힘, 참가자가 나가면 자리만 비움
      await updateDoc(
        roomRef(room.id),
        room.hostUid === uid
          ? { status: "closed", updatedAt: serverTimestamp() }
          : {
              ...(color === "w"
                ? { whiteUid: "", whiteName: "" }
                : { blackUid: "", blackName: "" }),
              updatedAt: serverTimestamp(),
            }
      );
      await deleteDoc(presenceRef(room.id, uid)).catch(() => {});
    }
  }

  // ───────────────────── 대국 ─────────────────────

  async function makeMove(roomId: string, uid: string, uci: string) {
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      const me = colorOf(room, uid);
      if (room.status !== "playing" || !me) throw new Error("대국 중이 아닙니다.");
      if (room.pausedAt) throw new Error("일시정지 중입니다.");
      if (turnOf(room) !== me) throw new Error("내 차례가 아닙니다.");

      const game = cfg.replay(room.moves, room.variant);
      const timed = room.timeMin > 0;
      const clock = liveClock(room);

      if (timed && clock[me] <= 0) {
        tx.update(roomRef(roomId), {
          status: "ended",
          result: cfg.timeoutResult(game, me),
          reason: "timeout",
          whiteMs: clock.w,
          blackMs: clock.b,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      cfg.play(game, uci); // 불법수면 throw
      if (timed) clock[me] += room.incSec * 1000;
      const end = cfg.endState(game);

      tx.update(roomRef(roomId), {
        moves: [...room.moves, uci],
        fen: cfg.fenOf(game),
        whiteMs: clock.w,
        blackMs: clock.b,
        turnStartedAt: serverTimestamp(),
        undoReq: null,
        drawOffer: "",
        updatedAt: serverTimestamp(),
        ...(end ? { status: "ended", ...end } : {}),
      });
    });
  }

  /** 수를 두는 쪽의 시간이 0이 된 걸 본 쪽(누구든)이 호출 */
  async function claimTimeout(roomId: string) {
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      if (room.status !== "playing" || room.timeMin <= 0 || room.pausedAt) return;
      const clock = liveClock(room);
      const t = turnOf(room);
      if (clock[t] > 0) return;
      tx.update(roomRef(roomId), {
        status: "ended",
        result: cfg.timeoutResult(cfg.replay(room.moves, room.variant), t),
        reason: "timeout",
        whiteMs: clock.w,
        blackMs: clock.b,
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function claimAbandon(roomId: string, uid: string) {
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      const me = colorOf(room, uid);
      if (room.status !== "playing" || !me) return;
      if (room.pausedAt) throw new Error("일시정지 중에는 승리 선언을 할 수 없습니다.");
      const oppUid = me === "w" ? room.blackUid : room.whiteUid;
      const p = await tx.get(presenceRef(roomId, oppUid));
      const ts = p.exists() ? (p.data().lastSeen as Timestamp | null) : null;
      if (ts && serverNow() - ts.toMillis() < ABANDON_AFTER_MS)
        throw new Error("상대가 아직 접속 중입니다.");
      const clock = liveClock(room);
      tx.update(roomRef(roomId), {
        status: "ended",
        result: winFor(me),
        reason: "abandon",
        whiteMs: clock.w,
        blackMs: clock.b,
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function resign(roomId: string, uid: string) {
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      const me = colorOf(room, uid);
      if (room.status !== "playing" || !me) return;
      const clock = liveClock(room);
      tx.update(roomRef(roomId), {
        status: "ended",
        result: winFor(other(me)),
        reason: "resign",
        whiteMs: clock.w,
        blackMs: clock.b,
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function offerDraw(roomId: string, uid: string) {
    await updateDoc(roomRef(roomId), { drawOffer: uid });
  }

  async function respondDraw(roomId: string, uid: string, accept: boolean) {
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      if (room.status !== "playing" || !room.drawOffer || room.drawOffer === uid) return;
      if (!accept) {
        tx.update(roomRef(roomId), { drawOffer: "" });
        return;
      }
      const clock = liveClock(room);
      tx.update(roomRef(roomId), {
        status: "ended",
        result: "1/2-1/2",
        reason: "agreement",
        drawOffer: "",
        whiteMs: clock.w,
        blackMs: clock.b,
        updatedAt: serverTimestamp(),
      });
    });
  }

  // ───────────────────── 다시 하기 ─────────────────────

  /**
   * 끝난 방에서 같은 상대와 바로 한 판 더 (방 새로 만들 필요 없음).
   * 한쪽이 누르면 신청, 다른 쪽도 누르면 흑백(선후)을 바꿔 바로 새 대국 시작.
   */
  async function requestRematch(roomId: string, uid: string) {
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      const me = colorOf(room, uid);
      if (room.status !== "ended" || !me) return;
      if (!room.whiteUid || !room.blackUid) throw new Error("상대가 나갔습니다.");
      if (!room.rematch || room.rematch === uid) {
        tx.update(roomRef(roomId), { rematch: uid, updatedAt: serverTimestamp() });
        return;
      }
      const ms = room.timeMin * 60_000;
      tx.update(roomRef(roomId), {
        whiteUid: room.blackUid,
        whiteName: room.blackName,
        blackUid: room.whiteUid,
        blackName: room.whiteName,
        status: "playing",
        moves: [],
        fen: cfg.initialFen(room.variant),
        whiteMs: ms,
        blackMs: ms,
        turnStartedAt: serverTimestamp(),
        pausedAt: null,
        result: "",
        reason: "",
        undoReq: null,
        drawOffer: "",
        rematch: "",
        updatedAt: serverTimestamp(),
      });
    });
  }

  /** 다시 하기 신청 취소 / 거절 */
  async function cancelRematch(roomId: string) {
    await updateDoc(roomRef(roomId), { rematch: "" });
  }

  // ───────────────────── 무르기 ─────────────────────

  async function requestUndo(room: Room, uid: string) {
    const me = colorOf(room, uid);
    if (!me || room.status !== "playing" || undoPlies(room, me) === 0) return;
    await updateDoc(roomRef(room.id), { undoReq: { uid, ply: room.moves.length } });
  }

  async function cancelUndo(roomId: string) {
    await updateDoc(roomRef(roomId), { undoReq: null });
  }

  async function respondUndo(roomId: string, uid: string, accept: boolean) {
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      const req = room.undoReq;
      if (room.status !== "playing" || !req || req.uid === uid) return;
      if (room.pausedAt) throw new Error("일시정지 중입니다.");
      const reqColor = colorOf(room, req.uid);
      if (!accept || !reqColor || req.ply !== room.moves.length) {
        tx.update(roomRef(roomId), { undoReq: null });
        return;
      }
      const plies = undoPlies(room, reqColor);
      if (plies === 0) {
        tx.update(roomRef(roomId), { undoReq: null });
        return;
      }
      // 지금까지 흐른 시간은 현재 차례인 쪽에서 정산하고 되돌림
      const clock = liveClock(room);
      const moves = room.moves.slice(0, room.moves.length - plies);
      tx.update(roomRef(roomId), {
        moves,
        fen: cfg.fenOf(cfg.replay(moves, room.variant)),
        whiteMs: clock.w,
        blackMs: clock.b,
        turnStartedAt: serverTimestamp(),
        undoReq: null,
        drawOffer: "",
        updatedAt: serverTimestamp(),
      });
    });
  }

  // ───────────────────── 방장 전용: 일시정지 / 시간 추가 ─────────────────────

  async function hostTx(roomId: string, uid: string, fn: (room: Room, tx: Transaction) => void) {
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      if (room.hostUid !== uid) throw new Error("방장만 할 수 있습니다.");
      if (room.status !== "playing") throw new Error("대국 중이 아닙니다.");
      fn(room, tx);
    });
  }

  async function pauseGame(roomId: string, uid: string) {
    await hostTx(roomId, uid, (room, tx) => {
      if (room.pausedAt) return;
      const clock = liveClock(room); // 지금까지 흐른 시간 정산 후 멈춤
      tx.update(roomRef(roomId), {
        whiteMs: clock.w,
        blackMs: clock.b,
        pausedAt: serverTimestamp(),
        undoReq: null,
        drawOffer: "",
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function resumeGame(roomId: string, uid: string) {
    await hostTx(roomId, uid, (room, tx) => {
      if (!room.pausedAt) return;
      if (isPauseExpired(room)) throw new Error("일시정지가 2시간을 넘어 대국이 종료되었습니다.");
      tx.update(roomRef(roomId), {
        pausedAt: null,
        turnStartedAt: serverTimestamp(), // 재개 시점부터 다시 계산
        updatedAt: serverTimestamp(),
      });
    });
  }

  /** 방장이 자신 또는 상대 시계에 시간 추가 */
  async function addTime(roomId: string, uid: string, color: Color, ms = ADD_TIME_MS) {
    await hostTx(roomId, uid, (room, tx) => {
      if (room.timeMin <= 0) throw new Error("무제한 대국입니다.");
      const clock = liveClock(room);
      clock[color] += ms;
      tx.update(roomRef(roomId), {
        whiteMs: clock.w,
        blackMs: clock.b,
        // 진행중이면 정산한 시점부터 다시 흐르게
        ...(room.pausedAt ? {} : { turnStartedAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      });
    });
  }

  /** 2시간 넘게 멈춘 대국 종료 (대국자 누구든 호출, 조건은 트랜잭션에서 재확인) */
  async function expirePausedGame(roomId: string) {
    await runTransaction(db, async (tx) => {
      const room = await readRoom(tx, roomId);
      if (!isPauseExpired(room)) return;
      tx.update(roomRef(roomId), {
        status: "ended",
        result: "1/2-1/2",
        reason: "paused",
        updatedAt: serverTimestamp(),
      });
    });
  }

  // ───────────────────── 채팅 ─────────────────────
  // {collection}/{id}/chat/{autoId} : 대국자·관전자만 쓰기 (firestore.rules), 읽기는 누구나

  function subscribeChat(roomId: string, cb: (list: ChatMessage[]) => void) {
    const q = query(
      collection(db, ROOMS, roomId, "chat"),
      orderBy("createdAt", "desc"),
      limit(CHAT_LIMIT)
    );
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data({ serverTimestamps: "estimate" });
        const ts = data.createdAt as Timestamp | null;
        return {
          id: d.id,
          uid: String(data.uid ?? ""),
          name: String(data.name ?? ""),
          text: String(data.text ?? ""),
          at: ts ? ts.toMillis() : serverNow(),
          pending: d.metadata.hasPendingWrites,
        };
      });
      cb(list.reverse());
    });
  }

  async function sendChat(roomId: string, uid: string, name: string, text: string) {
    const t = text.trim().slice(0, CHAT_MAX);
    if (!t) return;
    await addDoc(collection(db, ROOMS, roomId, "chat"), {
      uid,
      name: name.slice(0, 20),
      text: t,
      createdAt: serverTimestamp(),
    });
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
