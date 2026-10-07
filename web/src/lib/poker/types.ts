import type { Card } from "./cards";
import type { BotId, GameKind, TierId } from "./rules";

/*
 * 서버 ↔ 화면이 주고받는 포커 테이블 데이터 (server/src/games/poker 가 만들고 components/Poker 가 그림)
 *
 * 구독
 *   poker.lobby            열려 있는 테이블 목록
 *   poker.table { id }     테이블 공개 상태 — 바뀔 때마다 TableWire 전체 + 그사이 일어난 일(ev)
 *   poker.me    { id }     나만 보는 것 — 내 패
 *   poker.wallet           내 돈 · 회생 횟수
 * 남의 패는 쇼다운에서 깐 것만 공개 상태에 실림.
 */

export interface LobbyTable {
  id: string;
  name: string;
  game: GameKind;
  tier: TierId;
  locked: boolean;
  /** 앉아 있는 사람 수 · 봇 수 · 전체 자리 */
  humans: number;
  bots: number;
  max: number;
  createdAt: number;
}

export interface Wallet {
  money: number;
  /** 오늘 받은 회생 횟수 */
  reviveUsed: number;
  /** 지금 앉아 있는 테이블 (없으면 null) */
  table: string | null;
}

export interface SeatWire {
  seat: number;
  /** 사람이면 uid, 봇이면 "" */
  uid: string;
  bot: BotId | null;
  name: string;
  /** 직접 올린 프로필 사진 주소 (없으면 null) */
  avatar: string | null;
  /** 손에 든 칩 (판 중에는 이미 건 돈을 뺀 나머지) */
  stack: number;
  /** in 이번 판 참가 · wait 다음 판부터 · out 자리 비움 */
  status: "in" | "wait" | "out";
  /** 접속이 끊김 */
  away: boolean;
}

/** 테이블에서 일어난 일 (효과음 · 움직임 · 기록에 씀). 상태(TableWire)만 봐도 화면은 그릴 수 있음 */
export type PokerEvent =
  | { t: "hand"; no: number }
  | { t: "post"; seat: number; kind: "sb" | "bb" | "ante"; amt: number }
  /** a = 행동 이름(fold·check·call·bet·raise·allin / die·bbing·ddadang·quarter·half·full), amt = 이번에 낸 돈 */
  | { t: "act"; seat: number; a: string; amt: number; allIn: boolean }
  | { t: "board"; street: number; cards: Card[] }
  /** 7포커: 카드 한 장씩 돌림 (card = null 이면 엎은 카드) */
  | { t: "deal"; round: number; cards: { seat: number; card: Card | null }[] }
  | { t: "open"; seat: number; card: Card }
  | { t: "show"; seat: number; cards: Card[]; name: string }
  | { t: "muck"; seat: number }
  | { t: "refund"; seat: number; amt: number }
  | { t: "win"; seat: number; amt: number; name: string | null }
  | { t: "say"; seat: number; text: string }
  | { t: "sit"; seat: number; name: string }
  | { t: "leave"; seat: number; name: string; why: "leave" | "bust" | "cut" | "idle" | "cashout" };

export interface PotWire {
  amount: number;
  seats: number[];
}

export interface ResultWire {
  showdown: boolean;
  pots: (PotWire & { winners: number[] })[];
  /** 자리 → 받은 돈 */
  won: Record<number, number>;
  /** 자리 → 족보 이름 (깐 사람만) */
  names: Record<number, string>;
  /** 이긴 5장 (강조용) */
  best: Record<number, Card[]>;
}

interface PlayerBase {
  /** 이번 베팅 라운드에 낸 돈 */
  bet: number;
  /** 이 판에 낸 돈 전부 */
  invested: number;
  folded: boolean;
  allIn: boolean;
  /** 이번 라운드의 마지막 행동 (말풍선). a 는 PokerEvent 의 act 와 같은 이름 */
  last: { a: string; amt: number } | null;
}

// ───────────── 홀덤 ─────────────

export interface HoldemLegal {
  toCall: number;
  canCheck: boolean;
  canRaise: boolean;
  minTo: number;
  maxTo: number;
}

export interface HoldemPlayer extends PlayerBase {
  /** 쇼다운에서 깐 패 (안 깠으면 null) */
  cards: [Card, Card] | null;
}

export interface HoldemView {
  game: "holdem";
  button: number;
  sbSeat: number;
  bbSeat: number;
  bb: number;
  /** 0 프리플랍 · 1 플랍 · 2 턴 · 3 리버 */
  street: number;
  board: Card[];
  /** 팟 전체 (이번 라운드에 건 돈 포함) */
  pot: number;
  pots: PotWire[];
  currentBet: number;
  players: Record<number, HoldemPlayer>;
  /** 행동할 자리 (-1 = 없음) */
  toAct: number;
  /** 그 자리의 제한 시각 (ms, 서버 시계) */
  deadline: number;
  legal: HoldemLegal | null;
  result: ResultWire | null;
}

export type HoldemAction = { a: "fold" | "check" | "call" } | { a: "raise"; amt: number };

// ───────────── 7포커 ─────────────

export type SevenBet = "bbing" | "ddadang" | "quarter" | "half" | "full";

export interface SevenLegal {
  canCheck: boolean;
  /** 콜하려면 낼 돈 (0 이면 콜 없음) */
  toCall: number;
  /** 걸 수 있는 베팅 → 그때 낼 돈 (올인이면 가진 돈 전부) */
  bets: Partial<Record<SevenBet, number>>;
}

export interface SevenPlayer extends PlayerBase {
  /** 펴 놓은 카드 */
  up: Card[];
  /** 엎어 놓은 카드 수 */
  down: number;
  /** 카드 고르기를 끝냈는지 (고르는 단계에서만 의미) */
  chosen: boolean;
  /** 쇼다운에서 깐 7장 (안 깠으면 null) */
  cards: Card[] | null;
}

export interface SevenView {
  game: "seven";
  ante: number;
  /** choice = 버릴 카드·펼 카드 고르는 중, bet = 베팅 중, deal = 카드 돌리는 중, done = 끝 */
  phase: "choice" | "bet" | "deal" | "done";
  /** 지금 몇 구인지 (3 = 고르기 전후, 4~7) */
  round: number;
  /** 이번 구에 먼저 거는 사람 */
  boss: number;
  pot: number;
  pots: PotWire[];
  currentBet: number;
  players: Record<number, SevenPlayer>;
  toAct: number;
  deadline: number;
  legal: SevenLegal | null;
  result: ResultWire | null;
}

export type SevenAction =
  | { a: "die" | "check" | "call" | SevenBet }
  /** 받은 4장 중 버릴 카드와 펼 카드의 위치 (0~3, 서로 달라야 함) */
  | { a: "choose"; discard: number; open: number };

// ───────────── 테이블 ─────────────

export interface TableWire {
  id: string;
  name: string;
  game: GameKind;
  tier: TierId;
  locked: boolean;
  seats: (SeatWire | null)[];
  handNo: number;
  /** 판이 진행 중이면 그 판의 공개 상태 (끝난 직후에는 result 가 채워진 채로 잠깐 남음) */
  hand: HoldemView | SevenView | null;
  /** 다음 판이 시작될 시각 (정해졌을 때만) */
  nextAt: number | null;
  /** 직전 상태 이후에 일어난 일 */
  ev: PokerEvent[];
  seq: number;
}

/** 나만 보는 것 */
export interface MyHand {
  handNo: number;
  seat: number;
  /** 홀덤: 내 패 2장. 7포커: 내 카드 전부(받은 순서). 고르는 단계에서는 받은 4장 */
  cards: Card[];
  /** 7포커: 그중 엎어 둔 카드의 위치들 */
  down?: number[];
}

export interface ChatMsg {
  id: string;
  uid: string;
  name: string;
  text: string;
  ts: number;
}

export interface RankRow {
  nick: string;
  money: number;
  hands: number;
  avatar: string | null;
}
