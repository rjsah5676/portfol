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

/*
 * 방 단계: 리그 3개(일반 · 도박꾼 · 타짜) × 방 3개 = 9단계. 판돈은 단계마다 계속 올라감
 * (일반 VIP룸 < 도박꾼 첫 방 < … < 타짜 마지막 방). 방 그림은 리그 안의 순서(step 1~3)로 같이 쓰고 리그마다 색조만 다르게.
 */
export type TierId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type LeagueId = 1 | 2 | 3;
export interface League {
  id: LeagueId;
  name: string;
  blurb: string;
  /** 리그 색 (탭 · 방 목록 표시) */
  color: string;
}
export const LEAGUES: League[] = [
  { id: 1, name: "일반", blurb: "처음이라면 여기서", color: "#8fd35f" },
  { id: 2, name: "도박꾼", blurb: "억 단위가 오가는 판", color: "#4fc9e0" },
  { id: 3, name: "타짜", blurb: "수십억이 걸린 전설의 판", color: "#ff6f91" },
];
export interface Tier {
  id: TierId;
  league: LeagueId;
  /** 리그 안의 순서 (방 그림 · 카드 뒷면) */
  step: 1 | 2 | 3;
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

const tier = (
  id: TierId,
  name: string,
  blurb: string,
  ante: number,
  min: number,
  botMoney: number
): Tier => ({
  id,
  league: Math.ceil(id / 3) as LeagueId,
  step: (((id - 1) % 3) + 1) as 1 | 2 | 3,
  name,
  blurb,
  sb: ante,
  bb: ante * 2,
  ante,
  min,
  botMoney,
});
export const TIERS: Tier[] = [
  tier(1, "동네판", "잃어도 덜 아픈 판", 10 * MAN, 500 * MAN, 1 * EOK),
  tier(2, "하우스", "가입 자금 1억이 딱 100BB", 50 * MAN, 5000 * MAN, 5 * EOK),
  tier(3, "VIP룸", "3억부터 열리는 큰판", 250 * MAN, 3 * EOK, 25 * EOK),
  tier(4, "뒷골목", "도박꾼들의 첫 무대", 500 * MAN, 5 * EOK, 40 * EOK),
  tier(5, "지하 카지노", "판돈 천만, 숨소리도 조심", 1000 * MAN, 10 * EOK, 80 * EOK),
  tier(6, "하이롤러", "한 판에 억이 우습게 오감", 2500 * MAN, 25 * EOK, 200 * EOK),
  tier(7, "밀실", "아는 사람만 들어오는 방", 5000 * MAN, 50 * EOK, 400 * EOK),
  tier(8, "펜트하우스", "판돈 1억, 야경은 덤", 1 * EOK, 100 * EOK, 800 * EOK),
  tier(9, "황금판", "타짜 중의 타짜만", 2.5 * EOK, 250 * EOK, 2000 * EOK),
];
export const tierOf = (id: number): Tier => TIERS.find((t) => t.id === id) ?? TIERS[0];
export const leagueOf = (id: number): League => LEAGUES[tierOf(id).league - 1];
/** "도박꾼 · 뒷골목" */
export const tierLabel = (id: number) => `${leagueOf(id).name} · ${tierOf(id).name}`;

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

/*
 * 스킨: 상점에서 칩으로 사서 옷장에서 입음. 입으면 그 캐릭터의 그림이 전부 스킨 그림으로 바뀌고(남들 화면에도),
 * 효과음은 그대로 · 음성은 스킨 전용 파일이 있으면 그걸로. 그림은 web/public/poker/char/{스킨 id}/ (캐릭터와 같은 파일 구성)
 * + 로비 동작 lobby-1~6.webp · 터치 반응 touch-1~3.webp.
 * ready = 그림이 들어왔는지. false 면 원래 캐릭터 그림으로 보임 (사고 입는 것은 됨).
 */
export type SkinId = "amy-summer";
export interface Skin {
  id: SkinId;
  char: CharId;
  name: string;
  price: number;
  blurb: string;
  /** 입었을 때 로비에서 한마디 */
  line: string;
  ready: boolean;
}
export const SKINS: Skin[] = [
  {
    id: "amy-summer",
    char: "amy",
    name: "한여름의 에이미",
    price: 10 * EOK,
    blurb: "바다 가자고? …따, 딱히 너랑 가고 싶어서 입은 건 아니거든!",
    line: "뭘 그렇게 봐! …어울리긴 해?",
    ready: false,
  },
];
export const SKIN_IDS = SKINS.map((s) => s.id);
export const skinOf = (id: unknown): Skin | undefined => SKINS.find((s) => s.id === id);
/** 그림을 고르는 열쇠: 캐릭터 id 또는 스킨 id */
export type Look = CharId | SkinId;
/** 캐릭터별로 입은 스킨 */
export type Wear = Partial<Record<CharId, SkinId>>;
/** 지금 캐릭터 + 입은 스킨 → 그림 열쇠 (그 캐릭터의 스킨이 아니면 무시) */
export const lookOf = (char: CharId, wear?: Wear | null): Look => {
  const s = skinOf(wear?.[char]);
  return s && s.char === char ? s.id : char;
};
/** 그림 열쇠 → 캐릭터 */
export const lookChar = (l: Look | string): CharId => skinOf(l)?.char ?? charOf(l);

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

/** 억 단위를 소수점 없이: 2억 5,120만 · 3,450만 (2.512억이 2512억으로 읽히지 않게, 만 아래는 버림) */
export function fmtEok(won: number): string {
  const neg = won < 0 ? "-" : "";
  const n = Math.abs(Math.round(won));
  const eok = Math.floor(n / EOK);
  const man = Math.floor((n - eok * EOK) / MAN);
  if (!eok) return man ? `${neg}${comma(man)}만` : neg + comma(n);
  return `${neg}${comma(eok)}억${man ? ` ${comma(man)}만` : ""}`;
}

/** 한국 시간 기준 날짜 (회생 횟수가 초기화되는 기준) */
export const kstDay = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
