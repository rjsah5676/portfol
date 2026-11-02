import type { Card } from "./cards";
import type { CharId, Emote, GameKind, Look, SkinId, TierId, Wear } from "./rules";

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
  /** 앉아 있는 수 · 전체 자리 */
  players: number;
  max: number;
  /** 유저봇이 들어올 수 있는 방인지 */
  bots: boolean;
  /** 바로 입장으로 모르는 사람이 들어올 수 있는 방인지 (아니면 친구방) */
  quick: boolean;
  createdAt: number;
}

export interface Wallet {
  money: number;
  /** 금고에 넣어 둔 칩 (테이블에는 못 들고 감 · 랭킹에는 합쳐서) */
  vault: number;
  /** 테이블에서 걸어 둔 금고 꺼내기 예약 (다음 판을 시작할 때 꺼내짐, 0 = 없음) */
  vaultOut?: number;
  /** 오늘 받은 회생 횟수 */
  reviveUsed: number;
  /** 지금 앉아 있는 테이블 (없으면 null) */
  table: string | null;
  /** 내 캐릭터 */
  char: CharId;
  /** 가진 스킨 · 캐릭터별로 입은 스킨 */
  skins: SkinId[];
  wear: Wear;
  /** 산 캐릭터 (사야 쓰는 캐릭터 중 가진 것) */
  chars: CharId[];
  /** 방금 칩이 바닥나서 기본 칩을 자동으로 받았으면 (알림용, 그때 한 번만 옴) */
  revived?: { amount: number; left: number };
  /** 우편함에 안 받은 우편 수 */
  mail: number;
  /** 오늘 첫 접속이라 출석 보상이 우편함에 막 들어왔으면 그 금액 (알림용, 그때 한 번만 옴) */
  attended?: number;
  /** 포인트 (사이트 공용 — 캐릭터 · 스킨을 사고 칩과 환전) */
  points: number;
}

/** 우편 (받기를 눌러야 칩이 들어옴) */
export interface MailItem {
  id: string;
  kind: "attend";
  /** 받을 칩 */
  amount: number;
  /** 보낸 날 (KST "YYYY-MM-DD") */
  day: string;
  at: number;
}

export interface SeatWire {
  seat: number;
  /** 사람이면 uid, 유저봇이면 "" (화면에서는 구분하지 않음) */
  uid: string;
  name: string;
  char: CharId;
  /** 그림 열쇠 (스킨을 입었으면 스킨 id) */
  look: Look;
  /** 손에 든 칩 (판 중에는 이미 건 돈을 뺀 나머지) */
  stack: number;
  /** in 이번 판 참가 · wait 다음 판부터 · out 자리 비움 */
  status: "in" | "wait" | "out";
  /** 접속이 끊김 */
  away: boolean;
  /** 나가기 예약 (이번 판 끝나면 나감) */
  exit?: boolean;
  /** 이 방에서: 친 판 수 · 이긴 판 수 · 딴 돈 (앉은 뒤 증감) */
  hands: number;
  wins: number;
  net: number;
  /** 이 사람에게 쌓인 강퇴 투표 수 (3표면 강퇴) */
  votes: number;
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
  | { t: "emote"; seat: number; emote: Emote }
  | { t: "sit"; seat: number; name: string }
  /** 금고에서 꺼낸 칩이 이번 판부터 들어옴 (모두에게 연출) */
  | { t: "vault"; seat: number; amt: number }
  | { t: "leave"; seat: number; name: string; why: "leave" | "bust" | "cut" | "idle" | "cashout" | "vote" }
  /** 강퇴 투표: seat 에게 by 가 한 표 (votes / need) */
  | { t: "kick"; seat: number; by: number; votes: number; need: number };

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

/** 7포커에는 체크가 없음: 받을 돈이 없어도 삥(또는 그 이상)을 걸거나 죽어야 함 */
export interface SevenLegal {
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
  | { a: "die" | "call" | SevenBet }
  /** 받은 4장 중 버릴 카드와 펼 카드의 위치 (0~3, 서로 달라야 함) */
  | { a: "choose"; discard: number; open: number };

// ───────────── 테이블 ─────────────

export interface TableWire {
  id: string;
  name: string;
  game: GameKind;
  tier: TierId;
  locked: boolean;
  bots: boolean;
  seats: (SeatWire | null)[];
  handNo: number;
  /** 판이 진행 중이면 그 판의 공개 상태 (끝난 직후에는 result 가 채워진 채로 잠깐 남음) */
  hand: HoldemView | SevenView | null;
  /** 다음 판이 시작될 시각 (정해졌을 때만) */
  nextAt: number | null;
  /** 직전 상태 이후에 일어난 일 */
  ev: PokerEvent[];
  seq: number;
  /** 관리자 테스트 방 설정 (테스트 방일 때만) */
  dev?: DevOpts;
}

/** 관리자 테스트 방: speed = 진행 기다림 배수, sd = 쇼다운 연출 배수, mode = 봇 행동, stack = 내 칩, limit = 내 제한 시간(ms) */
export interface DevOpts {
  speed: number;
  sd: number;
  mode: "normal" | "call" | "allin";
  stack: number;
  limit: number;
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
  /** 사람이면 uid, 유저봇이면 "" */
  uid: string;
  name: string;
  char: CharId;
  look?: Look;
  /** 글 또는 이모티콘 (둘 중 하나) */
  text: string;
  emote?: Emote;
  ts: number;
}

export interface RankRow {
  nick: string;
  /** 프로필 사진 주소 (회원이 올린 것만) */
  avatar?: string | null;
  money: number;
  hands: number;
  char: CharId;
  look?: Look;
}

/** 구매 순위 한 줄: 스킨 · 캐릭터에 쓴 칩 합계 */
export interface BuyRankRow {
  nick: string;
  avatar?: string | null;
  char: CharId;
  look?: Look;
  /** 산 스킨 · 캐릭터 값의 합 — 포인트, 지금 가격 기준 (예전에 칩으로 산 것도 지금 포인트 가격으로) */
  spent: number;
  skins: number;
  chars: number;
}

/** 마이페이지 (poker.me) */
export interface MyPage {
  nick: string;
  char: CharId;
  look: Look;
  avatar: string | null;
  /** 가입 시각 */
  since: number;
  money: number;
  /** 자금 순위 (아직 한 판도 안 쳤으면 null) */
  rank: number | null;
  /** 테이블에 앉은 횟수 */
  games: number;
  /** 친 판 수 (전체) */
  hands: number;
  /** 한 판에 가장 크게 먹은 돈 */
  best: number;
  holdem: { hands: number; wins: number };
  seven: { hands: number; wins: number };
  /** 최근 판 (최신순) */
  recent: { at: number; game: GameKind; tier: TierId; delta: number; rivals: number }[];
  /** 베팅 성향: 최근 30일 핸드 기록(최대 500판)에서 계산 */
  stats: { holdem: PlayStats; seven: PlayStats };
}

/**
 * 한 게임의 베팅 성향.
 * acts 열쇠 — 홀덤: fold · check · call · bet · raise · allin / 7포커: die · bbing · ddadang · call · quarter · half · allin
 */
export interface PlayStats {
  hands: number;
  wins: number;
  acts: Record<string, number>;
  /** 다이(폴드)로 끝낸 판 */
  folds: number;
  /** 끝까지 가서 패를 깐 판 · 그중 이긴 판 */
  showdowns: number;
  sdWins: number;
  /** 홀덤 프리플랍: 스스로 돈을 넣은 판 · 레이즈한 판 · 3벳 한 판 / 3벳 할 수 있던 판 (7포커는 0) */
  vpip: number;
  pfr: number;
  threeBet: number;
  threeBetChance: number;
  /** 판마다 누적 증감 (오래된 것 → 최신, 최대 60점) */
  trend: number[];
  best: number;
  worst: number;
}
