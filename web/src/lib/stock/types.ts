/*
 * 주식 마을 — 서버 ↔ 화면 데이터 모양 (서버도 이 파일을 그대로 import).
 */

import type { CharId, Look } from "../poker/rules";
import type { BotLevel, BotStyle } from "./bots";
import type { Candle, Preset, SoloTrade } from "./solo";

// ───────────── 지갑 · 허브 ─────────────

export interface StockMe {
  nick: string;
  char: CharId;
  look: Look;
  /** 현금 (포커와 같은 돈) */
  money: number;
  /** 포커 금고 */
  vault: number;
  /** 솔로 판에서 들고 있는 주식 (지금 시세) */
  held: number;
  /** 집 (되팔 때 받을 값) */
  estate: number;
  /** 총자산 = 위 넷의 합 */
  total: number;
  reviveUsed: number;
  /** 포커 테이블에 앉아 있으면 (그동안은 사기 · 입찰 불가) */
  seated: boolean;
  solo: SoloStats;
  battle: BattleStats;
}

export interface SoloStats {
  games: number;
  wins: number;
  /** 판 수익률 합 (평균 = sumRet / games) */
  sumRet: number;
  best: number | null;
  worst: number | null;
  /** 차트 유형별 판 수 · 이긴 판 수 */
  byPreset: Partial<Record<Preset, { games: number; wins: number }>>;
}

export interface BattleStats {
  games: number;
  wins: number;
  /** 등수 합 (평균 = rankSum / games) */
  rankSum: number;
  best: number | null;
  top3: number;
}

/** 마을 건물마다 지금 상태 한 줄 (지도 · 바로가기에 표시) */
export interface HubStatus {
  /** 솔로: 하던 판이 있으면 그 턴 */
  soloTurn: number | null;
  /** 솔로: 마지막 판 수익률 */
  soloLast: number | null;
  /** 대전: 열린 방 수 · 지금 대전 중인 방 수 */
  rooms: number;
  playing: number;
  /** 부동산: 이번 시즌 입찰이 들어온 명당 수 */
  bids: number;
  /** 아파트 입주 세대 수 */
  residents: number;
}

// ───────────── 솔로 ─────────────

export interface SoloView {
  id: string;
  /** 판이 끝나기 전엔 "???" */
  name: string;
  /** 끝난 뒤에만 */
  preset: Preset | null;
  turn: number;
  turns: number;
  /** 이 판의 봉 (요청 때 준 have 이후 것만 — from 은 첫 봉의 번호) */
  from: number;
  candles: Candle[];
  shares: number;
  /** 들고 있는 주식의 원가 합 (평단 = cost / shares) */
  cost: number;
  /** 지금 현금 (포커와 같은 돈) */
  cash: number;
  /** 판을 시작할 때 현금 (수익률 기준) */
  startCash: number;
  trades: SoloTrade[];
  done: boolean;
  result: SoloResult | null;
}

export interface SoloResult {
  name: string;
  preset: Preset;
  /** 판 시작 현금 → 판 손익 반영 */
  start: number;
  final: number;
  pnl: number;
  ret: number;
  trips: number;
  wins: number;
  turns: number;
  /** 판이 끝나서 자동 회생을 받았으면 */
  revived?: { amount: number; left: number };
}

export interface SoloHistoryRow {
  id: string;
  at: number;
  name: string;
  preset: Preset;
  ret: number;
  pnl: number;
  trips: number;
  turns: number;
}

export interface SoloReview {
  id: string;
  name: string;
  preset: Preset;
  candles: Candle[];
  trades: SoloTrade[];
  result: SoloResult;
}

// ───────────── 대전 ─────────────

export interface BSeatWire {
  uid: string | null;
  nick: string;
  char: CharId;
  look: Look;
  bot: { style: BotStyle; level: BotLevel } | null;
  away: boolean;
}

export interface BRoomWire {
  id: string;
  title: string;
  hostUid: string;
  max: number;
  pub: boolean;
  locked: boolean;
  phase: "wait" | "play";
  seats: (BSeatWire | null)[];
  chat: { seat: number; nick: string; text: string; ts: number; sys?: boolean }[];
  /** 마지막 판 결과 id (결과 화면) */
  lastGame: string | null;
}

export interface BLobbyRow {
  id: string;
  title: string;
  host: { nick: string; char: CharId; look: Look } | null;
  count: number;
  humans: number;
  max: number;
  locked: boolean;
  phase: "wait" | "play";
  createdAt: number;
}

export interface BFillWire {
  seat: number;
  stock: number;
  side: "buy" | "sell";
  qty: number;
  amount: number;
  at: number;
}

/** 판 진행 상태 (250ms 마다 · 바뀐 게 있을 때만) */
export interface BGameWire {
  /** 판 시작 서버 시각 */
  startAt: number;
  /** 이 상태의 판 경과 ms */
  t: number;
  prices: number[];
  base: number[];
  last: number[];
  lastEv: number[];
  shocks: number;
  /** 최근 5초 순매수 (몰림) */
  flows: number[];
  /** 자리 순서대로 (판에 앉은 자리만 · map 참고) */
  players: { cash: number; hold: number[]; cost: number[]; assets: number; trades: number }[];
  /** 판 자리 → 방 자리 번호 */
  map: number[];
  /** 최근 체결 (피드) */
  feed: BFillWire[];
  /** 방금 일어난 변동 (그 상태에만 실림) */
  shock: { k: number; mult: number[]; ev: number[] } | null;
  over: boolean;
}

export interface BResultRow {
  seat: number;
  uid: string | null;
  nick: string;
  char: CharId;
  look: Look;
  bot: { style: BotStyle; level: BotLevel } | null;
  final: number;
  mult: number;
  trades: number;
  rank: number;
  /** 가장 많이 산 종목 */
  main: number | null;
}

export interface BResult {
  id: string;
  at: number;
  rows: BResultRow[];
  /** 자산 곡선: [시점][판 자리] — 시작 · 변동 39번 · 끝 */
  curve: number[][];
  priceCurve: number[][];
  highlights: {
    bestStock: { stock: number; mult: number };
    bigGain: { seat: number; amount: number; k: number };
    bigDump: { seat: number; amount: number; stock: number };
    booms: number;
  };
  humans: number;
  bots: number;
}

export interface BRecordRow {
  id: string;
  at: number;
  rank: number;
  n: number;
  mult: number;
  main: number | null;
  humans: number;
  bots: number;
}

export interface BRecords {
  stats: BattleStats;
  list: BRecordRow[];
}

// ───────────── 순위 ─────────────

export interface StockRankRow {
  nick: string;
  char: CharId;
  look: Look;
  avatar: string | null;
  /** 총자산 순위면 총자산, 주간 순위면 주간 손익 */
  value: number;
  games: number;
  /** 총자산 순위: 솔로 승률 · 주간: 판 수 */
  sub: number;
}

// ───────────── 부동산 ─────────────

export interface EstateUnitWire {
  id: string;
  type: string;
  /** 호수 (예: 1203) */
  no: number;
  at: number;
}

export interface EstateLotWire {
  id: string;
  name: string;
  /** 지금 시즌 주인 */
  owner: { nick: string; char: CharId; look: Look } | null;
  ownerSeason: string | null;
  /** 다음 시즌 최고 입찰 */
  bid: { nick: string; amount: number; mine: boolean } | null;
  /** 다음 입찰 최소 금액 */
  minNext: number;
}

export interface EstateView {
  season: string;
  next: string;
  /** 이번 시즌 경매 마감 (서버 시각 ms) */
  endsAt: number;
  units: EstateUnitWire[];
  lots: EstateLotWire[];
  /** 아파트 입구 명패 TOP 5 */
  plate: { nick: string; char: CharId; look: Look; value: number; top: string }[];
  residents: number;
}
