/*
 * DICE TOWN 서버 ↔ 화면 주고받는 모양 (server/src/games/marble · web/src/realtime/marble.ts 가 같이 씀)
 */
import type { Loadout } from "./data";
import type { Ev, Game } from "./engine";
import type { MapId } from "./maps";

export interface SeatWire {
  uid: string;
  name: string;
  bot: boolean;
  ready: boolean;
  /** 사람 자리인데 AI 가 대신 하는 중 */
  auto: boolean;
  away: boolean;
  avatar: string | null;
  lo: Loadout;
}

export type GameWire = Omit<Game, "rng">;

export interface ResultRow {
  seat: number;
  name: string;
  place: number;
  stars?: number;
  /** 오늘 첫 승 보너스 */
  first?: boolean;
  bot: boolean;
}

export interface ChatRow {
  name: string;
  text: string;
  at: number;
  bot?: boolean;
}

export interface RoomWire {
  id: string;
  name: string;
  /** 방장 uid ("" = AI 가 연 방) */
  owner: string;
  map: MapId;
  max: number;
  quick: boolean;
  bots: boolean;
  locked: boolean;
  phase: "wait" | "play" | "end";
  seats: (SeatWire | null)[];
  /** 판 플레이어 번호 → 자리 번호 */
  order: number[];
  game: GameWire | null;
  /** 이번 상태로 오기까지 생긴 일 (연출) */
  ev: Ev[];
  /** 서버 시각 기준: 연출 끝 · 사람 마감 · 시작 카운트다운 */
  busyUntil: number;
  deadline: number;
  startAt: number;
  seq: number;
  result: ResultRow[] | null;
  chat: ChatRow[];
  /** 강퇴된 uid */
  kicked?: string[];
  /** 보낸 시각 (서버) */
  now: number;
}

export interface LobbyRoom {
  id: string;
  name: string;
  map: MapId;
  max: number;
  players: number;
  humans: number;
  phase: RoomWire["phase"];
  locked: boolean;
  quick: boolean;
  bots: boolean;
  createdAt: number;
}

export interface ProfileWire {
  stars: number;
  parts: number;
  gp: number;
  chars: Record<string, { lv: number; dup: number }>;
  items: Record<string, { lv: number }>;
  load: { char: string | null; dice: string | null; buddy: string | null };
  pity: { char: number; item: number };
  tickets: { char: number; item: number };
  shop: Record<string, number>;
  packs: Record<string, number>;
  winToday: boolean;
  /** 일일 패스 (없거나 끝났으면 null) · today 오늘 받음 */
  pass: { until: string; today: boolean; left: number } | null;
  /** 방금 일일 패스로 받은 것 (프로필 불러올 때 한 번) */
  passGot?: { stars: number; parts: number };
  games: number;
  wins: number;
}

export interface RankRow {
  nick: string;
  avatar: string | null;
  wins: number;
  games: number;
}
