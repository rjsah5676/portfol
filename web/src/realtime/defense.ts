import { rpc, subscribe } from "@/lib/api/socket";
import type { LogEntry } from "@/lib/defense/replay";
import type { Cmd, Result } from "@/lib/defense/sim";

/*
 * 픽셀 글리치 디펜스 — 백엔드(server/src/games/defense.ts)와 통신
 *  랭킹: startRun(시드 받기) → 판 → finishRun(명령 기록 제출, 서버가 다시 돌려 검증)
 *  멀티: 방 목록 · 방 구독, 만들기 · 들어가기 · 준비 · 시작, 판 중 명령 보내기(턴 단위로 모두에게 뿌려짐)
 */

export interface DefenseRankRow {
  nick: string;
  avatar: string | null;
  score: number;
  win: boolean;
  wave: number;
  sec: number;
  kills: number;
  tops: string[];
  at: number;
}

export const startRun = () => rpc<{ run: string; seed: number; ver: string }>("defense.start");
export const finishRun = (run: string, log: LogEntry[]) =>
  rpc<{ result: Result; score: number; best: boolean; rank: number; tops: string[] }>(
    "defense.finish",
    { run, log }
  );
export const getDefenseRank = (limit = 20) =>
  rpc<{ ver: string; rows: DefenseRankRow[] }>("defense.rank", { limit });
export const getMyDefense = () => rpc<(DefenseRankRow & { rank: number }) | null>("defense.me");

// ── 멀티 ──

export interface MpPlayer {
  uid: string;
  nick: string;
  ready: boolean;
  over: { win: boolean; wave: number } | null;
  left: boolean;
}
export interface MpStanding {
  nick: string;
  win: boolean;
  wave: number;
  sec: number;
  kills: number;
  tops: string[];
}
export interface MpRoom {
  id: string;
  name: string;
  host: string;
  hostUid: string;
  phase: "lobby" | "playing" | "result";
  max: number;
  players: MpPlayer[];
  standings: MpStanding[] | null;
}
export interface MpLobbyRoom {
  id: string;
  name: string;
  count: number;
  max: number;
  createdAt: number;
}
export interface MpGameSnap {
  seed: number;
  turn: number;
  log: LogEntry[];
}

export function watchLobby(cb: (rooms: MpLobbyRoom[]) => void) {
  return subscribe<MpLobbyRoom[]>("defense.lobby", null, {
    onSnapshot: cb,
    onEvent: (t, d) => t === "list" && cb(d as MpLobbyRoom[]),
  });
}

export interface RoomHandlers {
  onRoom(room: MpRoom | null, game: MpGameSnap | null): void;
  onStart(d: { seed: number; players: string[] }): void;
  onTurn(d: { n: number; c: [number, Cmd][] }): void;
  onResult(rows: MpStanding[]): void;
  /** 서버가 보드끼리 해시가 다른 tick 을 찾음 (어긋남 감시) */
  onDesync?(d: { tick: number }): void;
  onError?(msg: string): void;
}
export function watchRoom(id: string, h: RoomHandlers) {
  return subscribe<{ room: MpRoom; game: MpGameSnap | null }>(
    "defense.room",
    { id },
    {
      onSnapshot: (d) => h.onRoom(d.room, d.game),
      onEvent: (t, d) => {
        if (t === "room") h.onRoom(d as MpRoom | null, null);
        else if (t === "start") h.onStart(d as { seed: number; players: string[] });
        else if (t === "turn") h.onTurn(d as { n: number; c: [number, Cmd][] });
        else if (t === "result") h.onResult(d as MpStanding[]);
        else if (t === "desync") h.onDesync?.(d as { tick: number });
      },
      onError: (e) => h.onError?.(e.message),
    }
  );
}

export const createRoom = (name?: string) => rpc<{ id: string }>("defense.create", { name });
export const joinRoom = (id: string) => rpc<{ id: string }>("defense.join", { id });
export const leaveRoom = (id: string) => rpc("defense.leave", { id });
/** 내가 자리를 가진 진행 중인 방 (새로고침 뒤 돌아가기) */
export const myRoom = () => rpc<{ id: string; name: string } | null>("defense.mine");
export const setReady = (id: string, ready: boolean) => rpc("defense.ready", { id, ready });
export const beginRoom = (id: string) => rpc("defense.begin", { id });
export const sendCmds = (id: string, c: Cmd[]) => rpc<{ turn: number }>("defense.cmd", { id, c });
/** 어긋남 감시: 이 tick 의 내 hashGame 값 */
export const sendHash = (id: string, tick: number, h: number) =>
  rpc<{ ok: boolean } | null>("defense.hash", { id, tick, h });
export const reportOver = (id: string, win: boolean, wave: number) =>
  rpc("defense.over", { id, win, wave });
