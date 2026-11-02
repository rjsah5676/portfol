/*
 * 주식게임 — 서버 ↔ 화면 데이터 모양 (서버도 이 파일을 그대로 import).
 */

import type { BotLevel, BotStyle } from "./bots";
import type { CoinPos, CoinPreset, CoinTrade } from "./coin";
import type { Candle, Preset, SoloOrder, SoloTrade } from "./solo";

// ───────────── 지갑 · 허브 ─────────────

export interface StockMe {
  nick: string;
  /** 현금 (주식게임 전용 지갑) */
  money: number;
  /** 솔로 판 · 코인 포지션에 들고 있는 것 (지금 시세) */
  held: number;
  /** 총자산 = 현금 + 들고 있는 것 */
  total: number;
  /** 회생 받은 횟수 */
  revives: number;
  solo: SoloStats;
  coin: CoinStats;
  battle: BattleStats;
}

export interface CoinStats {
  games: number;
  wins: number;
  sumRet: number;
  best: number | null;
  worst: number | null;
  /** 청산당한 판 수 */
  liq: number;
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

/** 환전소 (주식게임 돈 ↔ 포커 칩 1:1) */
export interface ExchangeView {
  /** 주식게임 현금 · 총자산 */
  cash: number;
  stkTotal: number;
  /** 포커 칩 · 금고 */
  chips: number;
  vault: number;
  /** 포커 테이블에 앉아 있음 (그동안 못 바꿈) */
  busy: boolean;
  /** 환전소를 쓸 수 있음 */
  open: boolean;
  /** 지금 바꿀 수 있는 최대 금액 (바꾼 뒤 보내는 쪽이 500만은 남게) */
  maxToPoker: number;
  maxToStock: number;
}

/** 모드마다 지금 상태 한 줄 (첫 화면 카드에 표시) */
export interface HubStatus {
  /** 솔로: 하던 판이 있으면 그 턴 */
  soloTurn: number | null;
  /** 솔로: 마지막 판 수익률 */
  soloLast: number | null;
  coinTurn: number | null;
  coinLast: number | null;
  /** 대전: 열린 방 수 · 지금 대전 중인 방 수 */
  rooms: number;
  playing: number;
}

// ───────────── 솔로 ─────────────

export interface SoloView {
  id: string;
  name: string;
  /** 첫 봉(과거 봉 0번)의 가상 날짜 */
  date0: number;
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
  /** 지금 현금 */
  cash: number;
  /** 판을 시작할 때 현금 (수익률 기준) */
  startCash: number;
  trades: SoloTrade[];
  /** 걸어 둔 예약 주문 */
  orders: SoloOrder[];
  /** 방금 요청으로 체결된 예약 (알림용) */
  filled?: { kind: SoloOrder["kind"]; qty: number; price: number; turn: number }[];
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
  /** 판 구간 (가상 날짜) */
  period?: [number, number];
  /** 판이 끝나서 자동 회생을 받았으면 */
  revived?: { amount: number };
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
  memo?: string;
}

export interface SoloReview {
  id: string;
  name: string;
  preset: Preset;
  candles: Candle[];
  trades: SoloTrade[];
  result: SoloResult;
  date0: number;
  memo: string;
}

// ───────────── 코인 ─────────────

export interface CoinView {
  id: string;
  name: string;
  sym: string;
  date0: number;
  preset: CoinPreset | null;
  turn: number;
  turns: number;
  from: number;
  candles: Candle[];
  pos: CoinPos | null;
  cash: number;
  startCash: number;
  trades: CoinTrade[];
  /** 방금 요청으로 청산됐으면 */
  liq?: { turn: number; price: number; margin: number };
  done: boolean;
  result: CoinResult | null;
}

export interface CoinResult {
  name: string;
  sym: string;
  preset: CoinPreset;
  start: number;
  final: number;
  pnl: number;
  ret: number;
  /** 진입 횟수 · 이익으로 끝난 진입 · 청산당한 횟수 */
  opens: number;
  wins: number;
  liqs: number;
  /** 제일 크게 쓴 배수 */
  maxLev: number;
  turns: number;
  period?: [number, number];
  revived?: { amount: number };
}

export interface CoinHistoryRow {
  id: string;
  at: number;
  name: string;
  sym: string;
  ret: number;
  pnl: number;
  liqs: number;
  maxLev: number;
  turns: number;
}

export interface CoinReview {
  id: string;
  name: string;
  sym: string;
  candles: Candle[];
  trades: CoinTrade[];
  result: CoinResult;
  date0: number;
}

// ───────────── 대전 ─────────────

export interface BSeatWire {
  uid: string | null;
  nick: string;
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
  host: { nick: string } | null;
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
  uid: string;
  nick: string;
  avatar: string | null;
  /** 총자산 순위면 총자산, 주간 순위면 주간 손익 */
  value: number;
  games: number;
  /** 총자산 순위: 솔로 승률 · 주간: 판 수 */
  sub: number;
}
