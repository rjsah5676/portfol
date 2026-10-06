/*
 * 2인 대국 게임 공통 방 (체스·장기·오목) — 타입과 순수 계산.
 * 좌석 이름은 체스 기준 white/black (장기: white = 초, 오목: white = 흑(선수)).
 * 프론트(web/src/firestore/boardRooms.ts)와 같은 상수·계산식을 씀.
 */

export type Color = "w" | "b";
export type RoomStatus = "waiting" | "playing" | "ended" | "closed";
export type GameResult = "" | "1-0" | "0-1" | "1/2-1/2";

export interface RoomDoc {
  _id: string;
  /** 바뀔 때마다 +1 — 클라이언트가 늦게 온 옛 상태를 버리는 기준 */
  v: number;
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
  moves: string[];
  variant: string;
  fen: string;
  /** turnStartedAt 시점의 남은 시간 */
  whiteMs: number;
  blackMs: number;
  turnStartedAt: Date | null;
  /** 방장이 일시정지한 시각 (null이면 진행중) */
  pausedAt: Date | null;
  result: GameResult;
  reason: string;
  undoReq: { uid: string; ply: number } | null;
  drawOffer: string;
  rematch: string;
  spectators: Record<string, string>;
  locked: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export const MAX_SPECTATORS = 2;
/** 이 시간 동안 하트비트 없으면 "연결 끊김" */
export const OFFLINE_AFTER_MS = 60_000;
/** 상대가 이 시간 이상 끊겨 있으면 승리 선언 가능 */
export const ABANDON_AFTER_MS = 180_000;
/** 일시정지가 이 시간 넘게 이어지면 대국 종료(무승부) */
export const PAUSE_LIMIT_MS = 2 * 60 * 60_000;
/** 방장 시간 추가 단위 */
export const ADD_TIME_MS = 30_000;
export const CHAT_MAX = 200;
export const CHAT_LIMIT = 100;

export function colorOf(room: RoomDoc, uid: string | null | undefined): Color | null {
  if (!uid) return null;
  if (room.whiteUid === uid) return "w";
  if (room.blackUid === uid) return "b";
  return null;
}

export const turnOf = (room: Pick<RoomDoc, "moves">): Color => (room.moves.length % 2 === 0 ? "w" : "b");

/** 지금 기준 양쪽 남은 시간 (진행중인 쪽은 경과시간 차감) */
export function liveClock(room: RoomDoc, now: number): { w: number; b: number } {
  const clock = { w: room.whiteMs, b: room.blackMs };
  if (room.timeMin > 0 && room.status === "playing" && room.turnStartedAt && !room.pausedAt) {
    const t = turnOf(room);
    clock[t] = Math.max(0, clock[t] - Math.max(0, now - room.turnStartedAt.getTime()));
  }
  return clock;
}

export const winFor = (c: Color): GameResult => (c === "w" ? "1-0" : "0-1");
export const other = (c: Color): Color => (c === "w" ? "b" : "w");

/**
 * 요청자 기준으로 몇 수(ply)를 되돌릴지.
 * 내가 방금 둔 상태 → 1수, 상대가 이미 받아둔 상태 → 2수, 0이면 무를 수 없음.
 */
export function undoPlies(room: RoomDoc, color: Color): number {
  const n = room.moves.length;
  if (n === 0) return 0;
  const lastMover: Color = n % 2 === 1 ? "w" : "b";
  const plies = lastMover === color ? 1 : 2;
  return n >= plies ? plies : 0;
}

export function isPauseExpired(room: RoomDoc, now: number): boolean {
  return room.status === "playing" && !!room.pausedAt && now - room.pausedAt.getTime() > PAUSE_LIMIT_MS;
}

/** 게임별 규칙 (수 검증·종료 판정만 끼움) */
export interface GameRules<G = unknown> {
  /** Mongo 컬렉션 ("chess_rooms") */
  collection: string;
  initialFen(variant: string): string;
  replay(moves: string[], variant: string): G;
  fenOf(game: G): string;
  /** 수 두기, 불법수면 throw */
  play(game: G, move: string): void;
  /** 수를 둔 뒤 게임이 끝났으면 결과 */
  endState(game: G): { result: GameResult; reason: string } | null;
  /** loser의 시간이 다 됐을 때 결과 */
  timeoutResult(game: G, loser: Color): GameResult;
}

/** 클라이언트로 보내는 방 (날짜는 ms) */
export function toWire(room: RoomDoc) {
  const { _id, turnStartedAt, pausedAt, createdAt, updatedAt, ...rest } = room;
  return {
    id: _id,
    ...rest,
    turnStartedAt: turnStartedAt?.getTime() ?? null,
    pausedAt: pausedAt?.getTime() ?? null,
    createdAt: createdAt?.getTime() ?? null,
    updatedAt: updatedAt?.getTime() ?? null,
  };
}
export type WireRoom = ReturnType<typeof toWire>;
