/*
 * 포인트 — 사이트 공용 재화 (서버와 화면이 같이 씀). 이름 · 숫자 · 상품 · 업적은 전부 여기서 고침.
 *
 *  - 얻는 길: 매일 첫 접속 출석(ATTEND_POINTS) · 게임 업적 · (포커) 칩 환전
 *  - 쓰는 길: 게임 안 상품(캐릭터 · 스킨 등) · (포커) 칩으로 환전
 *  - 현금성 재화가 아님: 돈으로 살 수 없고, 현금 · 상품권 등으로 바꾸거나 다른 사람에게 줄 수 없음 (POINT_NOTICE)
 *
 * 회원 문서(users)에 points 로 저장. 바꾸는 건 server/src/points.ts 만 (원장 point_log 에 한 줄씩 남음).
 */

/** 포인트 이름 · 단위 (이름을 정하면 여기만 바꾸면 됨) */
export const POINT = { name: "GP", unit: "GP" } as const;

export const fmtPoint = (n: number) =>
  `${Math.trunc(n).toLocaleString("ko-KR")}${POINT.unit}`;

/** 매일 첫 접속(한국 시간 날짜 기준) 출석 포인트 */
export const ATTEND_POINTS = 200;

/** 짧은 설명 (툴팁 · 상점 · 업적 창 아래) */
export const POINT_SHORT = `${POINT.name}는 출석 · 게임 업적으로 모으고, 게임 안 캐릭터 · 스킨을 사는 데 쓰는 사이트 전용 재화예요. 현금으로 사거나 바꿀 수 없어요.`;

/** 현금성 재화가 아니라는 안내 (자주 묻는 질문 · 마이페이지 · 상점) */
export const POINT_NOTICE = [
  `${POINT.name}는 이 사이트 안에서만 쓰는 무료 재화예요. 돈을 내고 살 수 없어요.`,
  "현금 · 상품권 · 다른 서비스의 재화 등으로 바꾸거나 환불받을 수 없어요.",
  "다른 회원에게 주거나 팔 수 없어요.",
  `운영상 필요하면 얻는 양 · 상품 가격이 바뀔 수 있고, 부정한 방법으로 얻은 ${POINT.name}는 회수될 수 있어요.`,
] as const;

/* ─────────────── 환전 (포커 칩 ↔ 포인트) ─────────────── */

/** 칩 CHIPS 당 POINTS. 단위(1칸) 단위로만 바꿈 */
export const POKER_EXCHANGE = {
  chips: 10_000_000, // 1,000만 칩
  points: 100,
  /** 칩 → 포인트로 바꾼 뒤에도 남아 있어야 하는 칩 (기본 칩 지급 기준 — 지급 → 환전을 되풀이하지 못하게) */
  keepChips: 5_000_000,
  /** 한 번에 바꿀 수 있는 최대 칸 수 */
  maxUnits: 1000,
} as const;

/* ─────────────── 상점 ─────────────── */

/** 포인트를 쓰는 게임 (상점이 들어갈 곳). 지금 화면까지 붙은 건 포커 */
export type PointGame = "poker" | "fight" | "defense" | "rhythm" | "sketch";
export const POINT_GAMES: Record<PointGame, string> = {
  poker: "ANIME POKER",
  fight: "PIXEL FIGHT",
  defense: "PIXEL LUCKY DEFENSE",
  rhythm: "BEAT DASH",
  sketch: "스케치 퀴즈",
};

/**
 * 상품 한 개. kind 에 따라 산 것이 어디에 남는지가 정해짐 (server/src/points.ts 의 grantOf)
 *   char · skin (포커): 기존 포커 문서(poker.chars · poker.skins)에 — 칩으로 산 사람도 그대로
 *   item (그 밖): inv.<게임> 목록에 ref 로 (새 게임 상점은 여기에 줄만 넣으면 사고 · 가진 것 확인이 됨)
 */
export interface ShopItem {
  id: string;
  game: PointGame;
  kind: "char" | "skin" | "item";
  /** 게임 안 id (포커 캐릭터 id · 스킨 id 등) */
  ref: string;
  name: string;
  price: number;
}

export const SHOP: ShopItem[] = [
  {
    id: "poker.char.mio",
    game: "poker",
    kind: "char",
    ref: "mio",
    name: "미오",
    price: 10_000,
  },
  {
    id: "poker.skin.amy-summer",
    game: "poker",
    kind: "skin",
    ref: "amy-summer",
    name: "한여름의 에이미",
    price: 30_000,
  },
  {
    id: "poker.skin.yeonseo-summer",
    game: "poker",
    kind: "skin",
    ref: "yeonseo-summer",
    name: "한여름의 연서",
    price: 30_000,
  },
  // PIXEL LUCKY DEFENSE 블록 테마 (lib/defense/progress.ts 의 THEMES — 얼음 · 네온 · 황금은 시즌 패스 프리미엄에서도)
  { id: "defense.theme.forest", game: "defense", kind: "item", ref: "theme.forest", name: "블록 테마 · 픽셀 숲", price: 3_000 },
  { id: "defense.theme.ice", game: "defense", kind: "item", ref: "theme.ice", name: "블록 테마 · 얼음 성채", price: 8_000 },
];
export const shopItem = (id: unknown) => SHOP.find((s) => s.id === id);
export const shopOf = (game: PointGame) => SHOP.filter((s) => s.game === game);
export const shopFor = (game: PointGame, kind: ShopItem["kind"], ref: string) =>
  SHOP.find((s) => s.game === game && s.kind === kind && s.ref === ref);

/* ─────────────── 업적 ─────────────── */

/** 업적이 있는 게임 (게임 머리말의 [업적] 버튼) */
export type AchGame = "poker" | "fight" | "defense" | "rhythm";

/**
 * 업적이 보는 숫자 (서버가 기록에서 계산 — server/src/achievements.ts)
 *  poker.chips   지금 칩 − 포인트로 바꿔 받은 칩 (환전으로 얻은 칩은 빼고)
 *  fight.char.N  랭크전에서 그 캐릭터(lib/fight/chars 의 CHARS 순서)로 한 판 수
 *  fight.tut     튜토리얼을 끝까지 했으면 1
 *  fight.ai      AI 대전에서 이긴 가장 높은 단계 (입문 1 ~ 지존 7 — 서버가 입력 기록을 다시 돌려 확인)
 */
export type AchMetric =
  | "poker.chips"
  | "poker.hands"
  | "poker.wins"
  | "poker.best"
  | "fight.games"
  | "fight.wins"
  | "fight.streak"
  | "fight.peak"
  | "fight.tut"
  | "fight.ai"
  | `fight.char.${number}`
  | "defense.runs"
  | "defense.wave"
  | "defense.wins"
  | "defense.kills"
  | "defense.glitch"
  | "defense.maxlv"
  | "defense.relics"
  | "rhythm.plays"
  | "rhythm.songs"
  | "rhythm.fc"
  | "rhythm.ap"
  | "rhythm.nightmare";

export interface Achievement {
  id: string;
  game: AchGame;
  title: string;
  desc: string;
  metric: AchMetric;
  goal: number;
  reward: number;
  /** 숫자 보여 주는 방법 (칩은 억 · 만) */
  fmt?: "chips";
  /**
   * 반복형: goal 만큼 쌓일 때마다 또 받음 (100판 → 200판 → …). 한 번에 여러 번 쌓였으면 한꺼번에.
   * 받은 횟수는 회원 문서 achRep.<id 의 . 을 __ 로> 에
   */
  repeat?: boolean;
}

/** 격투 캐릭터 이름 (lib/fight/chars 의 CHARS 순서 — 그쪽 순서가 바뀌면 같이) */
export const FIGHT_CHAR_NAMES = [
  "카이",
  "이그나",
  "소영",
  "릴리",
  "제나",
  "건모",
  "이반",
] as const;

const EOK = 100_000_000;
const a = (
  game: AchGame,
  id: string,
  title: string,
  desc: string,
  metric: AchMetric,
  goal: number,
  reward: number,
  fmt?: "chips",
): Achievement => ({
  id: `${game}.${id}`,
  game,
  title,
  desc,
  metric,
  goal,
  reward,
  ...(fmt && { fmt }),
});

/** 반복형 업적 */
const r = (game: AchGame, id: string, title: string, desc: string, metric: AchMetric, goal: number, reward: number): Achievement => ({
  id: `${game}.rep-${id}`,
  game,
  title,
  desc,
  metric,
  goal,
  reward,
  repeat: true,
});

export const ACHIEVEMENTS: Achievement[] = [
  // ── 반복형 (쌓일 때마다 또 받음) ──
  r("poker", "hands", "꾸준한 손님", "100판 칠 때마다", "poker.hands", 100, 50),
  r("poker", "wins", "승리 수당", "50판 이길 때마다", "poker.wins", 50, 80),
  r("fight", "games", "링 위의 일상", "랭크전 10판 할 때마다", "fight.games", 10, 50),
  r("fight", "wins", "승리 수당", "랭크전 10승 할 때마다", "fight.wins", 10, 80),
  r("defense", "runs", "출근 도장", "랭킹 판 5번 끝낼 때마다", "defense.runs", 5, 50),
  r("defense", "kills", "글리치 청소부", "적 5,000마리 처치할 때마다 (랭킹 판 누적)", "defense.kills", 5_000, 50),
  r("rhythm", "plays", "매일 리듬", "20판 할 때마다", "rhythm.plays", 20, 50),
  r("rhythm", "fc", "풀콤보 수당", "서로 다른 채보 5개 풀콤보 할 때마다", "rhythm.fc", 5, 100),

  // ANIME POKER
  a(
    "poker",
    "chips-3",
    "판돈의 맛",
    "칩 3억 모으기 (환전으로 받은 칩은 빼고)",
    "poker.chips",
    3 * EOK,
    300,
    "chips",
  ),
  a(
    "poker",
    "chips-10",
    "큰손",
    "칩 10억 모으기 (환전으로 받은 칩은 빼고)",
    "poker.chips",
    10 * EOK,
    1000,
    "chips",
  ),
  a(
    "poker",
    "chips-50",
    "카지노의 전설",
    "칩 50억 모으기 (환전으로 받은 칩은 빼고)",
    "poker.chips",
    50 * EOK,
    3000,
    "chips",
  ),
  a("poker", "hands-100", "단골손님", "100판 치기", "poker.hands", 100, 200),
  a(
    "poker",
    "hands-1000",
    "테이블의 주인",
    "1,000판 치기",
    "poker.hands",
    1000,
    1000,
  ),
  a("poker", "wins-50", "이기는 습관", "50판 이기기", "poker.wins", 50, 300),
  a("poker", "wins-500", "승부사", "500판 이기기", "poker.wins", 500, 1500),
  a(
    "poker",
    "best-1",
    "한 방",
    "한 판에 1억 넘게 가져가기",
    "poker.best",
    1 * EOK,
    500,
    "chips",
  ),

  // PIXEL FIGHT
  a("fight", "tutorial", "첫걸음", "튜토리얼 끝까지 하기", "fight.tut", 1, 100),
  // AI 대전 단계별 (lib/fight/ai 의 AI_LEVELS 순서). 높은 단계를 이기면 아래 단계도 같이 달성
  ...(
    [
      ["입문", 50],
      ["초급", 80],
      ["중급", 120],
      ["상급", 200],
      ["고수", 350],
      ["달인", 600],
      ["지존", 1000],
    ] as const
  ).map(([n, gp], i) => a("fight", `ai-${i}`, `CPU ${n} 격파`, `AI 대전에서 CPU ${n} 이기기`, "fight.ai", i + 1, gp)),
  // (아래는 랭크전 기준)
  a(
    "fight",
    "games-10",
    "첫 랭크전",
    "랭크전 10판 하기",
    "fight.games",
    10,
    200,
  ),
  a(
    "fight",
    "games-100",
    "단련된 주먹",
    "랭크전 100판 하기",
    "fight.games",
    100,
    1000,
  ),
  a("fight", "wins-30", "이기는 맛", "랭크전 30승", "fight.wins", 30, 500),
  a("fight", "streak-3", "3연승", "랭크전 3연승", "fight.streak", 3, 300),
  a("fight", "streak-5", "5연승", "랭크전 5연승", "fight.streak", 5, 700),
  a("fight", "streak-10", "10연승", "랭크전 10연승", "fight.streak", 10, 2000),
  a(
    "fight",
    "peak-1200",
    "실력자",
    "랭크전 레이팅 1,200 찍기",
    "fight.peak",
    1200,
    500,
  ),
  a(
    "fight",
    "peak-1500",
    "고수",
    "랭크전 레이팅 1,500 찍기",
    "fight.peak",
    1500,
    1500,
  ),
  // 등급 달성 (lib/fight/tiers 의 TIERS 하한 — 등급 기준이 바뀌면 같이). 최고 레이팅 기준
  ...(
    [
      ["gold", "골드", 1100, 300],
      ["platinum", "플래티넘", 1300, 600],
      ["diamond", "다이아몬드", 1550, 1200],
      ["master", "마스터", 1800, 2500],
      ["grandmaster", "그랜드마스터", 2100, 5000],
      ["legend", "레전드", 2400, 10000],
    ] as const
  ).map(([id, n, min, gp]) => a("fight", `tier-${id}`, `${n} 달성`, `랭크전 ${n} 등급 찍기 (레이팅 ${min.toLocaleString()})`, "fight.peak", min, gp)),
  ...FIGHT_CHAR_NAMES.map((n, i) =>
    a(
      "fight",
      `char-${i}`,
      `${n} 장인`,
      `랭크전에서 ${n}(으)로 20판 하기`,
      `fight.char.${i}`,
      20,
      200,
    ),
  ),

  // PIXEL LUCKY DEFENSE (랭킹 판 기준)
  a(
    "defense",
    "runs-10",
    "수호자 입문",
    "랭킹 판 10번 끝내기",
    "defense.runs",
    10,
    200,
  ),
  a(
    "defense",
    "runs-50",
    "베테랑 수호자",
    "랭킹 판 50번 끝내기",
    "defense.runs",
    50,
    800,
  ),
  a(
    "defense",
    "wave-20",
    "버티기",
    "20웨이브까지 버티기",
    "defense.wave",
    20,
    200,
  ),
  a(
    "defense",
    "wave-40",
    "끈질긴 방어",
    "40웨이브까지 버티기",
    "defense.wave",
    40,
    600,
  ),
  a(
    "defense",
    "win-1",
    "세계를 지키다",
    "60웨이브 클리어",
    "defense.wins",
    1,
    1500,
  ),
  a(
    "defense",
    "win-10",
    "운빨도 실력",
    "60웨이브 10번 클리어",
    "defense.wins",
    10,
    3000,
  ),
  a(
    "defense",
    "kills-10000",
    "글리치 사냥꾼",
    "적 10,000마리 처치 (랭킹 판 누적)",
    "defense.kills",
    10_000,
    500,
  ),
  a("defense", "glitch-3", "오염 적응", "오염 3단계 클리어", "defense.glitch", 4, 1500),
  a("defense", "glitch-10", "글리치 정복자", "오염 10단계 클리어", "defense.glitch", 11, 5000),
  a("defense", "maxlv-1", "만렙 유닛", "유닛 하나를 최고 레벨(10)까지", "defense.maxlv", 10, 1000),
  a("defense", "relics-6", "유물 수집가", "유물 6개 모으기", "defense.relics", 6, 500),
  a("defense", "relics-12", "유물 박물관", "유물 12개 모두 모으기", "defense.relics", 12, 2000),

  // BEAT DASH
  a("rhythm", "plays-30", "리듬 입문", "30판 하기", "rhythm.plays", 30, 200),
  a(
    "rhythm",
    "plays-300",
    "리듬 중독",
    "300판 하기",
    "rhythm.plays",
    300,
    1000,
  ),
  a(
    "rhythm",
    "songs-5",
    "플레이리스트",
    "서로 다른 곡 5개 끝까지 치기 (랭킹 기록)",
    "rhythm.songs",
    5,
    300,
  ),
  a("rhythm", "fc-1", "첫 풀콤보", "풀콤보 1번", "rhythm.fc", 1, 300),
  a(
    "rhythm",
    "fc-10",
    "풀콤보 수집가",
    "서로 다른 채보 10개 풀콤보",
    "rhythm.fc",
    10,
    1000,
  ),
  a("rhythm", "ap-1", "올 퍼펙트", "올 퍼펙트 1번", "rhythm.ap", 1, 1000),
  a(
    "rhythm",
    "nightmare-1",
    "악몽을 넘어",
    "NIGHTMARE 채보 끝까지 치기",
    "rhythm.nightmare",
    1,
    700,
  ),
];
export const achievementOf = (id: unknown) =>
  ACHIEVEMENTS.find((x) => x.id === id);
export const achievementsOf = (game: AchGame) =>
  ACHIEVEMENTS.filter((x) => x.game === game);

/** 업적 창에 내려가는 한 줄 */
export interface AchState {
  id: string;
  /** 지금 숫자 */
  value: number;
  /** 받은 시각 (안 받았으면 null). 반복형은 늘 null */
  claimedAt: number | null;
  /** 반복형: 지금까지 받은 횟수 */
  times?: number;
}

/** 반복형 업적의 받은 횟수를 두는 필드 이름 (id 의 . 은 필드 경로가 되므로 __ 로) */
export const repKey = (id: string) => `achRep.${id.replaceAll(".", "__")}`;
/** 지금 받을 수 있는 횟수 (일회형은 0 또는 1) */
export function claimableTimes(a: Achievement, s: Pick<AchState, "value" | "claimedAt" | "times">): number {
  if (a.repeat) return Math.max(0, Math.floor(s.value / a.goal) - (s.times ?? 0));
  return !s.claimedAt && s.value >= a.goal ? 1 : 0;
}

/** 업적 랭킹 한 줄 */
export interface AchRankRow {
  nick: string;
  avatar: string | null;
  /** 그 게임 업적으로 받은 포인트 합 */
  points: number;
  /** 받은 업적 수 */
  count: number;
  /** 마지막으로 받은 때 (같은 점수면 먼저 모은 사람이 위) */
  at: number;
}

/** 원장 한 줄 (마이페이지 · 관리자) */
export interface PointLogRow {
  at: number;
  delta: number;
  /** attend · ach · buy · exchange · admin */
  reason: string;
  /** 업적 id · 상품 id 등 */
  ref?: string;
  /** 바뀐 뒤 잔액 */
  bal?: number;
}

/** 원장 사유 → 보이는 말 */
export function pointReason(r: Pick<PointLogRow, "reason" | "ref">): string {
  switch (r.reason) {
    case "attend":
      return "출석";
    case "ach":
      return `업적 · ${achievementOf(r.ref)?.title ?? r.ref ?? ""}`;
    case "buy":
      return `구매 · ${shopItem(r.ref)?.name ?? r.ref ?? ""}`;
    case "exchange":
      return r.ref === "toChips" ? "환전 · 포커 칩으로" : "환전 · 포커 칩에서";
    case "admin":
      return "운영자 조정";
    case "defense":
      return r.ref === "cores"
        ? "디펜스 · 글리치 코어 교환"
        : r.ref === "gpchest"
          ? "디펜스 · GP 유물 상자"
          : r.ref?.startsWith("gpcards:")
            ? "디펜스 · 카드 묶음"
        : r.ref?.startsWith("weekly:")
          ? `디펜스 · 주간 도전 ${r.ref.split(":")[2]}위`
          : r.ref?.startsWith("pass")
            ? "디펜스 · 시즌 패스"
            : r.ref?.startsWith("quest:")
              ? "디펜스 · 미션"
              : "디펜스";
    default:
      return r.reason;
  }
}
