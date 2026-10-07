/*
 * 포커(홀덤 · 7포커)의 숫자들 (서버와 화면이 같이 씀). 밸런스를 바꿀 때는 여기만 고치면 됨.
 * 금액은 전부 원 단위 정수. 베팅은 UNIT(1만원) 단위.
 * 돈은 두 게임이 같이 씀: 가진 돈을 전부 들고 앉고, 판이 끝날 때마다 딴 만큼·잃은 만큼이 반영됨.
 */

export type GameKind = "holdem" | "seven";
export const GAMES: Record<GameKind, { name: string; seats: number; blurb: string }> = {
  holdem: { name: "홀덤", seats: 6, blurb: "내 패 2장 + 바닥 5장, 노리밋" },
  seven: { name: "7포커", seats: 5, blurb: "7장 중 5장, 삥·따당·하프" },
};

/** 베팅 최소 단위 */
export const UNIT = 10_000;
const MAN = 10_000;
const EOK = 100_000_000;

/** 가입하면 받는 돈 */
export const START_MONEY = 1 * EOK;

/** 회생: 보유금액이 under 미만이면 amount 를 받음, 하루 perDay 번 (한국 시간 자정에 초기화) */
export const REVIVE = { amount: 1000 * MAN, under: 500 * MAN, perDay: 10 } as const;

export type TierId = 1 | 2 | 3;
export interface Tier {
  id: TierId;
  name: string;
  /** 한 줄 소개 */
  blurb: string;
  /** 홀덤 블라인드 */
  sb: number;
  bb: number;
  /** 7포커 기본 판돈(앤티) = 삥 한 번 */
  ante: number;
  /** 입장컷: 보유금액이 이만큼은 있어야 앉을 수 있음. 판이 끝났을 때 이 밑이면 자리에서 내려옴 */
  min: number;
  /** 봇이 들고 앉는 돈 */
  botMoney: number;
}

export const TIERS: Tier[] = [
  { id: 1, name: "동네판", blurb: "잃어도 덜 아픈 판", sb: 10 * MAN, bb: 20 * MAN, ante: 10 * MAN, min: 500 * MAN, botMoney: 1 * EOK },
  { id: 2, name: "하우스", blurb: "가입 자금 1억이 딱 100BB", sb: 50 * MAN, bb: 100 * MAN, ante: 50 * MAN, min: 5000 * MAN, botMoney: 5 * EOK },
  { id: 3, name: "VIP룸", blurb: "3억부터 열리는 큰판", sb: 250 * MAN, bb: 500 * MAN, ante: 250 * MAN, min: 3 * EOK, botMoney: 25 * EOK },
];
export const tierOf = (id: number): Tier => TIERS.find((t) => t.id === id) ?? TIERS[0];

/** 테이블에 같이 앉는 봇 수의 기본값 (사람이 늘면 자리를 비켜 줌) */
export const DEFAULT_BOTS = 3;
/** 한 번 행동하는 데 주는 시간 */
export const ACT_MS = 20_000;
/** 접속이 끊긴 사람에게 주는 시간 */
export const ACT_AWAY_MS = 6_000;
/** 7포커에서 버릴 카드·보여 줄 카드를 고르는 시간 */
export const CHOICE_MS = 15_000;
/** 시간 초과가 이만큼 이어지면 자리 비움으로 바뀜 */
export const TIMEOUTS_TO_SITOUT = 2;
/** 자리 비움이 이만큼 이어지면 자리에서 내려옴 */
export const SITOUT_KICK_MS = 3 * 60_000;

export type BotId = "gunmo" | "chunhee" | "deokpal" | "yeonseo";
export const BOT_IDS: BotId[] = ["gunmo", "chunhee", "deokpal", "yeonseo"];
export const BOT_INFO: Record<BotId, { name: string; age: number; style: string; line: string }> = {
  gunmo: { name: "건모", age: 30, style: "계산형", line: "확률대로 치는 정석파. 근거 없는 콜은 안 한다." },
  chunhee: { name: "춘희", age: 55, style: "끈질긴 콜러", line: "웬만해선 안 죽는다. 블러프는 여기서 잘 안 통한다." },
  deokpal: { name: "덕팔", age: 69, style: "노련한 타이트", line: "잘 안 들어오지만, 들어오면 진짜다. 가끔 덫을 놓는다." },
  yeonseo: { name: "연서", age: 26, style: "공격형", line: "레이즈가 기본. 압박으로 팟을 가져간다." },
};

// ───────────── 금액 표기 ─────────────

const comma = (n: number) => n.toLocaleString("en-US");

/** 12억 3,450만 · 500만 · 0  (만원 미만은 숫자 그대로) */
export function fmtWon(won: number): string {
  const neg = won < 0;
  let n = Math.abs(Math.round(won));
  if (n === 0) return "0";
  const eok = Math.floor(n / EOK);
  n -= eok * EOK;
  const man = Math.floor(n / MAN);
  const rest = n - man * MAN;
  const parts: string[] = [];
  if (eok) parts.push(`${comma(eok)}억`);
  if (man) parts.push(`${comma(man)}만`);
  if (rest || !parts.length) parts.push(comma(rest));
  return (neg ? "-" : "") + parts.join(" ");
}

/** 좁은 자리용: 억 단위는 소수 셋째 자리(10만 원)까지, 100억부터는 첫째 자리까지. 1.008억 · 12.35억 · 3,450만 */
export function fmtShort(won: number): string {
  const neg = won < 0 ? "-" : "";
  const n = Math.abs(Math.round(won));
  if (n >= EOK) {
    const digits = n >= 100 * EOK ? 10 : 1000;
    const v = Math.floor(n / (EOK / digits)) / digits;
    return `${neg}${v.toLocaleString("en-US", { maximumFractionDigits: 3 })}억`;
  }
  if (n >= MAN) return `${neg}${comma(Math.floor(n / MAN))}만`;
  return neg + comma(n);
}

/** 한국 시간 기준 날짜 (회생 횟수가 초기화되는 기준) */
export const kstDay = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
