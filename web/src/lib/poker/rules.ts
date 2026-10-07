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
  /** 기본 판돈(앤티): 판을 시작할 때 전원이 냄. 7포커에서는 삥 한 번의 크기이기도 함 */
  ante: number;
  /** 입장컷: 보유금액이 이만큼은 있어야 앉을 수 있음. 판이 끝났을 때 이 밑이면 자리에서 내려옴 */
  min: number;
  /** 봇이 들고 앉는 돈의 기준 (실제로는 이 근처에서 제각각) */
  botMoney: number;
}

export const TIERS: Tier[] = [
  { id: 1, name: "동네판", blurb: "잃어도 덜 아픈 판", sb: 10 * MAN, bb: 20 * MAN, ante: 10 * MAN, min: 500 * MAN, botMoney: 1 * EOK },
  { id: 2, name: "하우스", blurb: "가입 자금 1억이 딱 100BB", sb: 50 * MAN, bb: 100 * MAN, ante: 50 * MAN, min: 5000 * MAN, botMoney: 5 * EOK },
  { id: 3, name: "VIP룸", blurb: "3억부터 열리는 큰판", sb: 250 * MAN, bb: 500 * MAN, ante: 250 * MAN, min: 3 * EOK, botMoney: 25 * EOK },
];
export const tierOf = (id: number): Tier => TIERS.find((t) => t.id === id) ?? TIERS[0];

/** 한 번 행동하는 데 주는 시간 */
export const ACT_MS = 12_000;
/** 접속이 끊긴 사람에게 주는 시간 */
export const ACT_AWAY_MS = 3_000;
/** 7포커에서 버릴 카드·보여 줄 카드를 고르는 시간 */
export const CHOICE_MS = 6_000;
/** 시간 초과가 이만큼 이어지면 자리 비움으로 바뀜 */
export const TIMEOUTS_TO_SITOUT = 2;
/** 자리 비움이 이만큼 이어지면 자리에서 내려옴 */
export const SITOUT_KICK_MS = 3 * 60_000;

/*
 * 캐릭터 5명. 회원은 하나를 골라 쓰고(겹쳐도 됨), 봇도 같은 캐릭터 중 하나로 앉음.
 * 그림은 web/public/poker/char/{id}/ 에 (동작 8 · 표정 8 · 이모티콘 8 · 프로필 · 전신 · 컷인).
 */
export type CharId = "jinwoo" | "yeonseo" | "taeyang" | "jeongmin" | "amy";
export const CHAR_IDS: CharId[] = ["jinwoo", "yeonseo", "taeyang", "jeongmin", "amy"];
export const CHARS: Record<CharId, { name: string; color: string; blurb: string }> = {
  jinwoo: { name: "진우", color: "#e5322d", blurb: "직진. 큰 베팅을 좋아하는 승부사" },
  yeonseo: { name: "연서", color: "#4a6fd6", blurb: "표정이 없다. 침착하게 한 방을 노림" },
  taeyang: { name: "태양", color: "#f28c28", blurb: "껄렁한 뻥카의 달인. 믿으면 안 됨" },
  jeongmin: { name: "정민", color: "#8b5cf6", blurb: "확률대로 친다. 근거 없는 콜은 안 함" },
  amy: { name: "에이미", color: "#38bdf8", blurb: "딱히 이기고 싶은 건 아니거든. 딱봐도 츤데레" },
};
export const charOf = (id: unknown): CharId => (CHAR_IDS.includes(id as CharId) ? (id as CharId) : "jinwoo");

/** 동작(2.5D 포즈) · 표정 · 이모티콘 이름 — 파일 이름과 같음 */
export const POSES = ["idle", "think", "check", "bet", "allin", "die", "win", "lose"] as const;
export const FACES = ["idle", "smile", "think", "shock", "sad", "taunt", "angry", "joy"] as const;
export const EMOTES = ["hi", "good", "lol", "cry", "angry", "huh", "tease", "wow"] as const;
export type Pose = (typeof POSES)[number];
export type Face = (typeof FACES)[number];
export type Emote = (typeof EMOTES)[number];

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
