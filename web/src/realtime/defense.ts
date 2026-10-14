import { rpc, subscribe } from "@/lib/api/socket";
import type { Goods, Loadout, QuestDef, RunReward } from "@/lib/defense/progress";
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

export type RankBoard = "season";
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
        firstClear?: { glitch: number; cores: number; relicBox: number } | null;
        /** 이 오염 단계 최고 웨이브 (이번 판 전 · 뒤, 클리어 = LAST_WAVE + 1) */
        gbest?: { glitch: number; prev: number; now: number };
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
  /** 안 연 상자 */
  /** trans = 초월 상자 (패키지에서 받은 초월 소환) */
  boxes: { card: number; relic: number; trans?: number };
  /** 유물 조각 (유물 강화 재료) */
  shards: Record<string, number>;
  /** 해금한 초월 */
  trans: string[];
  /** 열린 보관함 칸 · 세력 연구칸 */
  bench: number;
  fslots: number;
  cards: Record<string, number>;
  lv: Record<string, number>;
  res: string[];
  relics: string[];
  /** 연구 · 유물 레벨 (없으면 1) */
  resLv?: Record<string, number>;
  relicLv?: Record<string, number>;
  load: { res: string[]; relics: string[]; glitch: number; cheat?: string };
  /** 산 치트 연구 */
  cheatRes?: string[];
  glitchOpen: number;
  glitchWin: number;
  theme: string;
  day: { key: string };
  season: { id: number; xp: number; free: number[]; prem: number[]; premium: boolean };
  seen?: string[];
  /** 이번 주 상점(재화샵 · 판매 · 주간 패키지) 산 횟수 */
  shop: { w: number; n: Record<string, number> };
  /** 오늘 산 일일 패키지 */
  shopDay?: { d: string; n: Record<string, number> };
  /** 한 번만 사는 패키지 산 것 */
  packs: Record<string, number>;
  /** 끈기 (가장 높은 오염 단계에서 연달아 진 판) */
  grit?: { g: number; n: number };
  /** 초월 소환 천장 — 마지막 초월 뒤로 돌린 수 */
  pity: number;
  firstDay?: string;
  runs: number;
  quests: { daily: QuestRow[]; weekly: QuestRow[] };
  passTier: number;
  themes: string[];
  gp: number;
  week: { n: number; ends: number };
  seasonEnds: number;
  dayEnds: number;
  /** 상자 · 소환 · 패키지에서 나온 것 */
  got?: {
    relic?: string;
    shard?: number;
    /** 최고 레벨 유물이 겹쳐서 받은 코어 */
    cores?: number;
    cards?: Record<string, number>;
    /** 초월 소환 한 번 (trans 가 없으면 miss 의 재화) */
    trans?: string | TransGot[];
    dup?: number;
    miss?: Goods;
    pity?: number;
    pack?: string;
  };
}
export interface TransGot {
  trans?: string;
  dup?: number;
  miss?: Goods;
  pity: number;
}
const P = (name: string, arg?: unknown) => rpc<DefenseProfile>(name, arg);
export const meta = {
  profile: () => P("defense.profile"),
  unitUp: (id: string) => P("defense.unit.up", { id }),
  unitDown: (id: string) => P("defense.unit.down", { id }),
  /** id 없으면 모든 유닛 고르게 · 있으면 그 유닛만 최대한 */
  unitUpAll: (id?: string) => P("defense.unit.upAll", id ? { id } : {}),
  resBuy: (id: string) => P("defense.res.buy", { id }),
  /** dir 1 올리기 · -1 내리기 (전부 돌려받기) */
  resLevel: (id: string, dir: 1 | -1) => P("defense.res.level", { id, dir }),
  relicLevel: (id: string, dir: 1 | -1) => P("defense.relic.level", { id, dir }),
  boxBuy: (kind: "card" | "relic") => P("defense.box.buy", { kind }),
  boxOpen: (kind: "card" | "relic" | "trans") => P("defense.box.open", { kind }),
  benchBuy: () => P("defense.bench.buy"),
  fslotBuy: () => P("defense.fslot.buy"),
  transSummon: () => P("defense.trans"),
  storeBuy: (id: string) => P("defense.store.buy", { id }),
  storeSell: (id: string) => P("defense.store.sell", { id }),
  packBuy: (id: string) => P("defense.pack.buy", { id }),
  setLoad: (load: { res: string[]; relics: string[]; glitch: number; cheat?: string }) => P("defense.load", load),
  cheatResBuy: (id: string) => P("defense.cheatres.buy", { id }),
  setTheme: (id: string) => P("defense.theme", { id }),
  questClaim: (id: string) => P("defense.quest.claim", { id }),
  passClaim: () => P("defense.pass.claim"),
  passBuy: () => P("defense.pass.buy"),
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
