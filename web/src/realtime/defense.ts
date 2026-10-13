import { rpc, subscribe } from "@/lib/api/socket";
import type { Loadout, QuestDef, RunReward } from "@/lib/defense/progress";
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
  /** 오염 단계 (시즌 판) */
  glitch: number;
  at: number;
}

export type RankBoard = "season" | "weekly";
export type RunStart = { run: string; seed: number; ver: string; mode: RankBoard; loadout: Loadout };
export const startRun = (mode: RankBoard = "season") => rpc<RunStart>("defense.start", { mode });
export type FinishOut = {
  result: Result;
  score: number;
  best: boolean;
  rank: number;
  tops: string[];
  mode: RankBoard;
  reward:
    | (RunReward & {
        opened: number | null;
        passTier: number;
        /** 오늘 첫 판 (조각 ×2) */
        first?: boolean;
        /** 처음 얻은 유닛 (도감 수집 보상) */
        fresh?: string[];
        firstClear?: { glitch: number; cores: number; chest: number } | null;
      })
    | null;
};
export const finishRun = (run: string, log: LogEntry[]) => rpc<FinishOut>("defense.finish", { run, log });
export const getDefenseRank = (limit = 20, board: RankBoard = "season") =>
  rpc<{ ver: string; board: RankBoard; key: string; rows: DefenseRankRow[] }>("defense.rank", { limit, board });
export const getMyDefense = (board: RankBoard = "season") =>
  rpc<(DefenseRankRow & { rank: number }) | null>("defense.me", { board });

// ── 판 밖 성장 (server/src/games/defenseMeta.ts) ──

export type QuestRow = QuestDef & { value: number; claimed: boolean };
export interface DefenseProfile {
  pieces: number;
  cores: number;
  chests: number;
  cards: Record<string, number>;
  lv: Record<string, number>;
  res: string[];
  relics: string[];
  load: { res: string[]; relics: string[]; glitch: number };
  glitchOpen: number;
  glitchWin: number;
  theme: string;
  day: { key: string };
  season: { id: number; xp: number; free: number[]; prem: number[]; premium: boolean };
  coreBuys: { w: number; n: number };
  seen?: string[];
  gpBuys?: { w: number; chest: number; cards: number };
  firstDay?: string;
  runs: number;
  quests: { daily: QuestRow[]; weekly: QuestRow[] };
  passTier: number;
  themes: string[];
  gp: number;
  week: { n: number; ends: number; relics: string[] };
  seasonEnds: number;
  dayEnds: number;
  /** 지난주 주간 도전 순위 GP (이번에 받음) */
  paid?: { week: number; rank: number; gp: number } | null;
  /** 상자를 열어 나온 것 */
  got?: { relic?: string; dup?: number; cards?: Record<string, number> };
}
const P = (name: string, arg?: unknown) => rpc<DefenseProfile>(name, arg);
export const meta = {
  profile: () => P("defense.profile"),
  unitUp: (id: string) => P("defense.unit.up", { id }),
  unitDown: (id: string) => P("defense.unit.down", { id }),
  resBuy: (id: string) => P("defense.res.buy", { id }),
  relicBuy: (id: string) => P("defense.relic.buy", { id }),
  chestBuy: () => P("defense.chest.buy"),
  chestOpen: () => P("defense.chest.open"),
  setLoad: (load: { res: string[]; relics: string[]; glitch: number }) => P("defense.load", load),
  setTheme: (id: string) => P("defense.theme", { id }),
  questClaim: (id: string) => P("defense.quest.claim", { id }),
  passClaim: () => P("defense.pass.claim"),
  passBuy: () => P("defense.pass.buy"),
  coresBuy: () => P("defense.cores.buy"),
  gpChest: () => P("defense.gp.chest"),
  gpCards: (id: string) => P("defense.gp.cards", { id }),
};

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
  loadouts?: Loadout[];
}

export function watchLobby(cb: (rooms: MpLobbyRoom[]) => void) {
  return subscribe<MpLobbyRoom[]>("defense.lobby", null, {
    onSnapshot: cb,
    onEvent: (t, d) => t === "list" && cb(d as MpLobbyRoom[]),
  });
}

export interface RoomHandlers {
  onRoom(room: MpRoom | null, game: MpGameSnap | null): void;
  onStart(d: { seed: number; players: string[]; loadouts?: Loadout[] }): void;
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
        else if (t === "start") h.onStart(d as { seed: number; players: string[]; loadouts?: Loadout[] });
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
