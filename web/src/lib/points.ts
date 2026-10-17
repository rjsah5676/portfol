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
export const POINT_SHORT = `${POINT.name}는 출석 · 일일 미션 · 게임 업적으로 모으고, 게임 안 캐릭터 · 스킨을 사는 데 쓰는 사이트 전용 재화예요. 현금으로 사거나 바꿀 수 없어요.`;

/** 베타 안내 — 재화 · GP 가 한꺼번에 초기화될 수 있음 (마이페이지 · 자주 묻는 질문) */
export const POINT_BETA = `지금 이 사이트의 모든 게임은 베타 버전이라, 게임 재화와 ${POINT.name}가 한꺼번에 초기화될 수 있어요.`;

/** 현금성 재화가 아니라는 안내 (자주 묻는 질문 · 마이페이지 · 상점) */
export const POINT_NOTICE = [
  `${POINT.name}는 이 사이트 안에서만 쓰는 무료 재화예요. 돈을 내고 살 수 없어요.`,
  "현금 · 상품권 · 다른 서비스의 재화 등으로 바꾸거나 환불받을 수 없어요.",
  "다른 회원에게 주거나 팔 수 없어요.",
  `운영상 필요하면 얻는 양 · 상품 가격이 바뀔 수 있고, 부정한 방법으로 얻은 ${POINT.name}는 회수될 수 있어요.`,
  POINT_BETA,
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
export type PointGame = "poker" | "fight" | "defense" | "rhythm" | "sketch" | "marble" | "survivor" | "rogue";
export const POINT_GAMES: Record<PointGame, string> = {
  poker: "ANIME POKER",
  fight: "PIXEL FIGHT",
  defense: "PIXEL LUCKY DEFENSE",
  rhythm: "BEAT DASH",
  sketch: "DOODLE PARTY",
  marble: "DICE TOWN",
  survivor: "PIXEL TOWN SURVIVOR",
  rogue: "PIXEL RESET STORY",
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
  /** 할인 전 가격 — 있으면 상점에서 줄 긋고 할인율 표시 */
  was?: number;
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
    price: 20_000,
    was: 30_000,
  },
  {
    id: "poker.skin.yeonseo-summer",
    game: "poker",
    kind: "skin",
    ref: "yeonseo-summer",
    name: "한여름의 연서",
    price: 20_000,
    was: 30_000,
  },
  {
    id: "poker.skin.taeyang-ts",
    game: "poker",
    kind: "skin",
    ref: "taeyang-ts",
    name: "TS 금태양",
    price: 20_000,
    was: 30_000,
  },
  {
    id: "poker.skin.mio-dracula",
    game: "poker",
    kind: "skin",
    ref: "mio-dracula",
    name: "드라큘라 미오",
    price: 20_000,
    was: 30_000,
  },
  {
    id: "poker.skin.jinwoo-ramen",
    game: "poker",
    kind: "skin",
    ref: "jinwoo-ramen",
    name: "라멘집 사장 진우",
    price: 2_000,
  },
  {
    id: "poker.skin.jeongmin-detective",
    game: "poker",
    kind: "skin",
    ref: "jeongmin-detective",
    name: "탐정 정민",
    price: 2_000,
  },
  // PIXEL FIGHT 스킨 (lib/fight/skins.ts) — 산 것은 inv.fight, 착용은 게임 안 보관함
  {
    id: "fight.skin.igna-fw",
    game: "fight",
    kind: "skin",
    ref: "igna-fw",
    name: "불꽃놀이 이그나",
    price: 15_000,
  },
  {
    id: "fight.skin.soyoung-bunny",
    game: "fight",
    kind: "skin",
    ref: "soyoung-bunny",
    name: "바니걸 소영",
    price: 15_000,
  },
  {
    id: "fight.skin.kai-tkd",
    game: "fight",
    kind: "skin",
    ref: "kai-tkd",
    name: "국가대표 카이",
    price: 15_000,
  },
  {
    id: "fight.skin.lily-frog",
    game: "fight",
    kind: "skin",
    ref: "lily-frog",
    name: "개굴개굴 릴리",
    price: 15_000,
  },
  {
    id: "fight.skin.gunmo-school",
    game: "fight",
    kind: "skin",
    ref: "gunmo-school",
    name: "학창시절 건모",
    price: 15_000,
  },
  {
    id: "fight.skin.zena-idol",
    game: "fight",
    kind: "skin",
    ref: "zena-idol",
    name: "아이돌 제나",
    price: 15_000,
  },
  {
    id: "fight.skin.ivan-winter",
    game: "fight",
    kind: "skin",
    ref: "ivan-winter",
    name: "시베리아 이반",
    price: 15_000,
  },
  // BEAT DASH 테마 스킨 (lib/rhythm/fx.ts SKINS · SKIN_THEME) — 산 것은 inv.rhythm, 착용은 설정의 노트 스킨
  {
    id: "rhythm.skin.zena",
    game: "rhythm",
    kind: "skin",
    ref: "zena",
    name: "아이돌 제나 — SONIC STAGE",
    price: 15_000,
  },
];
export const shopItem = (id: unknown) => SHOP.find((s) => s.id === id);
export const shopOf = (game: PointGame) => SHOP.filter((s) => s.game === game);
export const shopFor = (game: PointGame, kind: ShopItem["kind"], ref: string) =>
  SHOP.find((s) => s.game === game && s.kind === kind && s.ref === ref);

/* ─────────────── 업적 ─────────────── */

/** 업적이 있는 게임 (게임 머리말의 [업적] 버튼) */
export type AchGame = "poker" | "fight" | "defense" | "rhythm" | "sketch" | "marble" | "survivor" | "rogue";

/**
 * 업적이 보는 숫자 (서버가 기록에서 계산 — server/src/achievements.ts)
 *  poker.chips   지금 칩 − 포인트로 바꿔 받은 칩 (환전으로 얻은 칩은 빼고)
 *  fight.char.N  랭크전에서 그 캐릭터(lib/fight/chars 의 CHARS 순서)로 한 판 수
 *  fight.tut     튜토리얼을 끝까지 했으면 1
 *  fight.ai      AI 대전에서 이긴 가장 높은 단계 (입문 1 ~ 지존 7 — 서버가 입력 기록을 다시 돌려 확인)
 *  sketch.games  끝까지 한 판 수 (정답이 한 번이라도 나온 판만) · sketch.drew 내 그림을 누가 맞힌 차례 수
 *  sketch.wins   1등 한 판 수 (3명 이상 판만)
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
  | "rhythm.nightmare"
  | "rhythm.nmCharts"
  | "rhythm.expert"
  | "rhythm.ultima"
  | "rhythm.nmFc"
  | "rhythm.sRank"
  | "rhythm.splus"
  | "rhythm.combo"
  | "sketch.games"
  | "sketch.correct"
  | "sketch.first"
  | "sketch.drew"
  | "sketch.wins"
  | "sketch.points"
  | "sketch.likes"
  | "sketch.fakeWin"
  | "sketch.fakeFound"
  | "sketch.fooled"
  | "sketch.relay"
  | "marble.games"
  | "marble.wins"
  | "marble.lm"
  | "marble.mono"
  | "marble.chars"
  | "marble.ssr"
  | "marble.maxlv"
  | "marble.pulls"
  | "survivor.games"
  | "survivor.wins"
  | "survivor.kills"
  | "survivor.bestSec"
  | "survivor.bestLv"
  | "survivor.heroWins"
  | "rogue.runs"
  | "rogue.wins"
  | "rogue.full"
  | "rogue.kills"
  | "rogue.bosses"
  | "rogue.ch"
  | "rogue.floor"
  | "rogue.items"
  | "rogue.codex"
  | "rogue.secrets"
  | "rogue.noHit"
  | "rogue.cheats"
  | "rogue.speed"
  | "rogue.elites"
  | "rogue.specials"
  | "rogue.arcade"
  | "rogue.ignaRuns"
  | "rogue.ignaWins";

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
  /** 반복형: 이 숫자를 넘은 뒤부터 셈 (일회형 마지막 단계에 이어서 — 소영 20판 → 40 · 60 · …) */
  from?: number;
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
  "포르테",
] as const;

const EOK = 100_000_000;
/**
 * 업적 보상 배수 — 업적 전체(일회형 · 반복형)를 한 번에 올리고 내릴 때만 바꿈. 아래 숫자는 지금 실제로 주는 GP 그대로 (10.15 정리: 그 전 3배는 숫자에 넣음).
 * 일일 미션은 여기 안 걸림 (DAILY_MISSIONS 숫자 그대로).
 */
export const ACH_X = 1;
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
  reward: Math.round(reward * ACH_X),
  ...(fmt && { fmt }),
});

export const ACHIEVEMENTS: Achievement[] = [
  // ANIME POKER
  a(
    "poker",
    "chips-3",
    "판돈의 맛",
    "칩 3억 모으기 (환전으로 받은 칩은 빼고)",
    "poker.chips",
    3 * EOK,
    900,
    "chips",
  ),
  a(
    "poker",
    "chips-10",
    "큰손",
    "칩 10억 모으기 (환전으로 받은 칩은 빼고)",
    "poker.chips",
    10 * EOK,
    3000,
    "chips",
  ),
  a(
    "poker",
    "chips-50",
    "카지노의 전설",
    "칩 50억 모으기 (환전으로 받은 칩은 빼고)",
    "poker.chips",
    50 * EOK,
    9000,
    "chips",
  ),
  a("poker", "hands-100", "단골손님", "100판 치기", "poker.hands", 100, 600),
  a(
    "poker",
    "hands-1000",
    "테이블의 주인",
    "1,000판 치기",
    "poker.hands",
    1000,
    3000,
  ),
  a("poker", "wins-50", "이기는 습관", "50판 이기기", "poker.wins", 50, 900),
  a("poker", "wins-500", "승부사", "500판 이기기", "poker.wins", 500, 4500),
  a(
    "poker",
    "best-1",
    "한 방",
    "한 판에 1억 넘게 가져가기",
    "poker.best",
    1 * EOK,
    1500,
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
  a("defense", "glitch-15", "심연의 문턱", "오염 15단계 클리어", "defense.glitch", 16, 2000),
  a("defense", "glitch-20", "심연 탐험가", "오염 20단계 클리어", "defense.glitch", 21, 3000),
  a("defense", "glitch-25", "심연 사냥꾼", "오염 25단계 클리어", "defense.glitch", 26, 4000),
  a("defense", "glitch-30", "끝없는 오염의 끝", "오염 30단계 클리어", "defense.glitch", 31, 6000),
  a("defense", "glitch-40", "심연 2막", "오염 40단계 클리어", "defense.glitch", 41, 8000),
  a("defense", "glitch-50", "글리치의 심장", "오염 50단계 클리어", "defense.glitch", 51, 12000),
  a("defense", "runs-150", "단골 수호자", "랭킹 판 150번 끝내기", "defense.runs", 150, 1000),
  a("defense", "runs-400", "평생 수호자", "랭킹 판 400번 끝내기", "defense.runs", 400, 2500),
  a("defense", "win-30", "든든한 방벽", "60웨이브 30번 클리어", "defense.wins", 30, 2000),
  a("defense", "win-100", "백전백승", "60웨이브 100번 클리어", "defense.wins", 100, 4000),
  a("defense", "kills-50000", "글리치 소탕", "적 50,000마리 처치 (랭킹 판 누적)", "defense.kills", 50_000, 1000),
  a("defense", "kills-200000", "글리치 멸절자", "적 200,000마리 처치 (랭킹 판 누적)", "defense.kills", 200_000, 2000),
  a("defense", "maxlv-1", "만렙 유닛", "유닛 하나를 최고 레벨(10)까지", "defense.maxlv", 10, 1000),
  a("defense", "relics-6", "유물 수집가", "유물 6개 모으기", "defense.relics", 6, 500),
  a("defense", "relics-12", "유물 박물관", "유물 12개 모두 모으기", "defense.relics", 12, 2000),

  // BEAT DASH
  a("rhythm", "plays-30", "리듬 입문", "30판 하기", "rhythm.plays", 30, 600),
  a(
    "rhythm",
    "plays-300",
    "리듬 중독",
    "300판 하기",
    "rhythm.plays",
    300,
    3000,
  ),
  a(
    "rhythm",
    "songs-5",
    "플레이리스트",
    "서로 다른 곡 5개 끝까지 치기 (랭킹 기록)",
    "rhythm.songs",
    5,
    900,
  ),
  a("rhythm", "fc-1", "첫 풀콤보", "풀콤보 1번", "rhythm.fc", 1, 900),
  a(
    "rhythm",
    "fc-10",
    "풀콤보 수집가",
    "서로 다른 채보 10개 풀콤보",
    "rhythm.fc",
    10,
    3000,
  ),
  a("rhythm", "ap-1", "올 퍼펙트", "올 퍼펙트 1번", "rhythm.ap", 1, 3000),
  a(
    "rhythm",
    "nightmare-1",
    "악몽을 넘어",
    "NIGHTMARE 채보 끝까지 치기",
    "rhythm.nightmare",
    1,
    2100,
  ),
  a("rhythm", "plays-100", "리듬 단골", "100판 하기", "rhythm.plays", 100, 1500),
  a("rhythm", "songs-10", "곡 탐험가", "서로 다른 곡 10개 끝까지 치기 (랭킹 기록)", "rhythm.songs", 10, 1800),
  a("rhythm", "expert-5", "EX 정복", "서로 다른 EX 채보 5개 끝까지 치기", "rhythm.expert", 5, 1500),
  a("rhythm", "nightmare-5", "악몽 단골", "서로 다른 NIGHTMARE 채보 5개 끝까지 치기", "rhythm.nmCharts", 5, 3000),
  a("rhythm", "ultima-1", "ULTIMATE", "ULTIMA 채보 끝까지 치기", "rhythm.ultima", 1, 3000),
  a("rhythm", "ultima-5", "한계 돌파", "서로 다른 ULTIMA 채보 5개 끝까지 치기", "rhythm.ultima", 5, 6000),
  a("rhythm", "s-1", "S 랭크", "정확도 94% 이상으로 끝내기", "rhythm.sRank", 1, 900),
  a("rhythm", "s-20", "S 랭크 컬렉션", "서로 다른 채보 20개를 S 랭크 이상으로", "rhythm.sRank", 20, 3000),
  a("rhythm", "splus-5", "S+ 마스터", "서로 다른 채보 5개를 S+ (정확도 97% 이상)로", "rhythm.splus", 5, 3000),
  a("rhythm", "combo-500", "500 콤보", "한 판 최대 콤보 500", "rhythm.combo", 500, 1200),
  a("rhythm", "combo-1000", "천 콤보", "한 판 최대 콤보 1,000", "rhythm.combo", 1000, 2500),
  a("rhythm", "fc-30", "풀콤보 장인", "서로 다른 채보 30개 풀콤보", "rhythm.fc", 30, 5000),
  a("rhythm", "nmfc-1", "악몽 지배자", "NIGHTMARE · ULTIMA 채보 풀콤보", "rhythm.nmFc", 1, 5000),
  a("rhythm", "ap-5", "완벽주의자", "서로 다른 채보 5개 올 퍼펙트", "rhythm.ap", 5, 6000),

  // 스케치 퀴즈 (반복형 대신 일일 미션)
  // DOODLE PARTY (다른 게임 업적의 절반)
  a("sketch", "games-1", "첫 두들", "한 판 끝까지 하기", "sketch.games", 1, 150),
  a("sketch", "games-10", "두들 단골", "10판 끝까지 하기", "sketch.games", 10, 450),
  a("sketch", "games-50", "스케치북 한 권", "50판 끝까지 하기", "sketch.games", 50, 1500),
  a("sketch", "games-200", "붓을 든 장인", "200판 끝까지 하기", "sketch.games", 200, 4500),
  a("sketch", "correct-1", "첫 정답", "그림 맞히기에서 정답 1번", "sketch.correct", 1, 150),
  a("sketch", "correct-50", "눈치 백단", "그림 맞히기에서 정답 50번", "sketch.correct", 50, 750),
  a("sketch", "correct-300", "독심술사", "그림 맞히기에서 정답 300번", "sketch.correct", 300, 3000),
  a("sketch", "first-10", "번개 손", "제일 먼저 맞히기 10번", "sketch.first", 10, 450),
  a("sketch", "first-100", "광속 정답", "제일 먼저 맞히기 100번", "sketch.first", 100, 2250),
  a("sketch", "drew-10", "그림 실력 인증", "내 그림이 맞혀진 차례 10번", "sketch.drew", 10, 450),
  a("sketch", "drew-100", "인기 화가", "내 그림이 맞혀진 차례 100번", "sketch.drew", 100, 2250),
  a("sketch", "wins-1", "오늘의 화백", "1등 하기 (3명 이상 판)", "sketch.wins", 1, 450),
  a("sketch", "wins-10", "두들 챔피언", "1등 10번 (3명 이상 판)", "sketch.wins", 10, 2250),
  a("sketch", "points-20000", "점수 부자", "게임 점수 누적 20,000점", "sketch.points", 20_000, 1200),
  a("sketch", "likes-1", "첫 따봉", "내 그림에 따봉 1개 받기", "sketch.likes", 1, 150),
  a("sketch", "likes-50", "따봉 맛집", "내 그림에 따봉 50개 받기", "sketch.likes", 50, 750),
  a("sketch", "likes-300", "국민 화가", "내 그림에 따봉 300개 받기", "sketch.likes", 300, 3000),
  a("sketch", "fake-win-1", "완벽한 위장", "가짜 화가로 이기기", "sketch.fakeWin", 1, 450),
  a("sketch", "fake-win-10", "변장의 달인", "가짜 화가로 10번 이기기", "sketch.fakeWin", 10, 2250),
  a("sketch", "fake-found-10", "가짜 사냥꾼", "가짜 화가를 맞게 지목 10번", "sketch.fakeFound", 10, 750),
  a("sketch", "fooled-10", "타고난 거짓말쟁이", "그림 속 거짓말에서 내 가짜 제목으로 10번 속이기", "sketch.fooled", 10, 750),
  a("sketch", "relay-5", "릴레이 완주", "그림 릴레이 5판 끝까지", "sketch.relay", 5, 450),

  // DICE TOWN
  a("marble", "games-1", "첫 여행", "한 판 끝까지 하기", "marble.games", 1, 150),
  a("marble", "games-10", "동네 한 바퀴", "10판 끝까지 하기", "marble.games", 10, 450),
  a("marble", "games-50", "여행 중독", "50판 끝까지 하기", "marble.games", 50, 1500),
  a("marble", "games-200", "세계 일주", "200판 끝까지 하기", "marble.games", 200, 4500),
  a("marble", "wins-1", "첫 승리", "1등 하기", "marble.wins", 1, 300),
  a("marble", "wins-20", "주사위 고수", "1등 20번", "marble.wins", 20, 1500),
  a("marble", "wins-100", "다이스 타운 스타", "1등 100번", "marble.wins", 100, 4500),
  a("marble", "lm-10", "야추!", "야추 10번 내기", "marble.lm", 10, 600),
  a("marble", "lm-50", "주사위의 신", "야추 50번 내기", "marble.lm", 50, 2000),
  a("marble", "mono-1", "막판 뒤집기", "막판 3바퀴 시작 때 1등이 아니었는데 이기기", "marble.mono", 1, 450),
  a("marble", "mono-20", "역전의 명수", "막판 뒤집기로 20번 이기기", "marble.mono", 20, 2500),
  a("marble", "chars-5", "친구 모으기", "캐릭터 5종 모으기", "marble.chars", 5, 450),
  a("marble", "chars-10", "캐릭터 도감", "캐릭터 10종 모으기", "marble.chars", 10, 1500),
  a("marble", "ssr-1", "반짝이는 카드", "SSR 이상 캐릭터 얻기", "marble.ssr", 1, 600),
  a("marble", "ssr-5", "빛나는 파티", "SSR 이상 캐릭터 5종", "marble.ssr", 5, 3000),
  a("marble", "maxlv-1", "풀강의 맛", "캐릭터 하나 5강까지", "marble.maxlv", 1, 1500),
  a("marble", "pulls-100", "뽑기 장인", "뽑기 100번 (캐릭터 · 아이템)", "marble.pulls", 100, 900),

  // PIXEL TOWN SURVIVOR
  a("survivor", "games-1", "첫 밤", "한 판 끝내기", "survivor.games", 1, 150),
  a("survivor", "games-30", "밤 산책 단골", "30판 끝내기", "survivor.games", 30, 900),
  a("survivor", "games-150", "불면의 마을", "150판 끝내기", "survivor.games", 150, 3000),
  a("survivor", "sec-180", "3분 버티기", "한 판에 3분 버티기", "survivor.bestSec", 180, 150),
  a("survivor", "sec-300", "킹 젤리 앞까지", "한 판에 5분 버티기", "survivor.bestSec", 300, 300),
  a("survivor", "win-1", "새벽이 왔다", "10분 버티고 자정의 시계지기 쓰러뜨리기", "survivor.wins", 1, 900),
  a("survivor", "win-10", "새벽의 단골", "10번 클리어", "survivor.wins", 10, 2000),
  a("survivor", "win-50", "밤을 지배하는 자", "50번 클리어", "survivor.wins", 50, 5000),
  a("survivor", "lv-40", "성장 중독", "한 판에 레벨 40 찍기", "survivor.bestLv", 40, 450),
  a("survivor", "lv-70", "끝없는 성장", "한 판에 레벨 70 찍기", "survivor.bestLv", 70, 1500),
  a("survivor", "kills-10000", "몬스터 소탕", "몬스터 10,000마리 처치 (누적)", "survivor.kills", 10_000, 450),
  a("survivor", "kills-100000", "밤의 청소부", "몬스터 100,000마리 처치 (누적)", "survivor.kills", 100_000, 1500),
  a("survivor", "kills-500000", "백만 대군 앞에서", "몬스터 500,000마리 처치 (누적)", "survivor.kills", 500_000, 4000),
  a("survivor", "heroes-4", "돌아가며 출근", "서로 다른 캐릭터 4명으로 클리어", "survivor.heroWins", 4, 1200),
  a("survivor", "heroes-10", "마을 전원 생존", "서로 다른 캐릭터 10명으로 클리어", "survivor.heroWins", 10, 4000),

  // PIXEL RESET (games/rogue.ts 의 rogue.finish 가 stats.rogue 에 쌓음) — 월드 보스 업적 이름 = 그 월드 이야기(LOG) 제목
  a("rogue", "runs-1", "부팅 완료", "한 판 끝내기", "rogue.runs", 1, 150),
  a("rogue", "runs-30", "재접속 중독", "30판 끝내기", "rogue.runs", 30, 900),
  a("rogue", "runs-150", "로그아웃 불가", "150판 끝내기", "rogue.runs", 150, 3000),
  a("rogue", "ch-1", "아래에서", "월드 1 보스 렉 덩어리 쓰러뜨리기 (LOG 01)", "rogue.ch", 1, 300),
  a("rogue", "ch-2", "지워진 빌드", "월드 2 보스 무한 로딩 쓰러뜨리기 (LOG 02)", "rogue.ch", 2, 900),
  a("rogue", "ch-3", "멈춘 사람들", "월드 3 보스 프리징 쓰러뜨리기 (LOG 03)", "rogue.ch", 3, 2000),
  a("rogue", "ch-4", "또 하나의 카이", "월드 4 보스 블루스크린 쓰러뜨리기 — 진짜 결말 (LOG 04)", "rogue.ch", 4, 4000),
  a("rogue", "wins-10", "디버거", "판 목표 층까지 10번 클리어", "rogue.wins", 10, 1500),
  a("rogue", "full-5", "초기화 취소", "8층까지 5번 클리어", "rogue.full", 5, 5000),
  a("rogue", "speed-1", "스피드런", "4층 이상 목표를 15분 안에 클리어", "rogue.speed", 1, 1500),
  a("rogue", "nohit-1", "무결점 패치", "보스를 한 대도 안 맞고 쓰러뜨리기", "rogue.noHit", 1, 600),
  a("rogue", "nohit-10", "핫픽스 장인", "노히트 보스 10번 (누적)", "rogue.noHit", 10, 2000),
  a("rogue", "items-10", "조합의 맛", "한 판에 패시브 아이템 10개", "rogue.items", 10, 450),
  a("rogue", "items-20", "만렙 빌드", "한 판에 패시브 아이템 20개", "rogue.items", 20, 2000),
  a("rogue", "codex-18", "수집가", "도감에 아이템 18종 열기", "rogue.codex", 18, 600),
  a("rogue", "codex-37", "도감 마니아", "도감에 아이템 37종 열기", "rogue.codex", 37, 2000),
  a("rogue", "codex-49", "완전한 도감", "도감에 아이템 49종 전부 열기", "rogue.codex", 49, 3500),
  a("rogue", "secret-1", "수상한 벽", "숨겨진 방 찾기", "rogue.secrets", 1, 150),
  a("rogue", "secret-10", "벽 두드리기", "숨겨진 방 10번 찾기 (판 수)", "rogue.secrets", 10, 900),
  a("rogue", "cheat-5", "치트키 입력", "치트 콘솔 거래 5번 (누적)", "rogue.cheats", 5, 450),
  a("rogue", "bosses-30", "보스 러시", "보스 30마리 쓰러뜨리기 (누적)", "rogue.bosses", 30, 900),
  a("rogue", "igna-1", "얼음을 녹인 불꽃", "이그나로 한 판 끝내기 (월드 3 보스를 쓰러뜨리면 해금)", "rogue.ignaRuns", 1, 300),
  a("rogue", "igna-win", "불꽃 디버거", "이그나로 판 목표 층까지 클리어", "rogue.ignaWins", 1, 1500),
  a("rogue", "elites-50", "엘리트 사냥꾼", "엘리트 몬스터 50마리 처치 (누적)", "rogue.elites", 50, 600),
  a("rogue", "specials-10", "특수방 단골", "결투방 · 업데이트 설치 · 엘리트 소대 · 미러 서버 10번 깨기 (누적)", "rogue.specials", 10, 900),
  a("rogue", "arcade-100", "오락실 죽돌이", "오락실 기계 100번 돌리기 (누적)", "rogue.arcade", 100, 450),
  a("rogue", "kills-1000", "버그 잡이", "적 1,000마리 처치 (누적)", "rogue.kills", 1000, 300),
  a("rogue", "kills-10000", "패치 담당", "적 10,000마리 처치 (누적)", "rogue.kills", 10_000, 1200),
  a("rogue", "kills-50000", "글리치 멸균", "적 50,000마리 처치 (누적)", "rogue.kills", 50_000, 3500),
];
/** 반복형 업적: 일회형 마지막 단계(from)를 넘은 뒤로 step 만큼 쌓일 때마다 reward */
const r = (game: AchGame, id: string, title: string, unit: string, metric: AchMetric, from: number, step: number, reward: number): Achievement => ({
  id: `${game}.rep-${id}`,
  game,
  title,
  desc: `${from.toLocaleString("ko-KR")}${unit} 다음부터 ${step.toLocaleString("ko-KR")}${unit}마다`,
  metric,
  goal: step,
  reward: Math.round(reward * ACH_X),
  repeat: true,
  from,
});
ACHIEVEMENTS.push(
  r("poker", "hands", "단골손님 · 계속", "판", "poker.hands", 1000, 500, 400),
  r("poker", "wins", "승부사 · 계속", "승", "poker.wins", 500, 250, 600),
  r("fight", "games", "단련된 주먹 · 계속", "판", "fight.games", 100, 50, 400),
  r("fight", "wins", "이기는 맛 · 계속", "승", "fight.wins", 30, 30, 400),
  ...FIGHT_CHAR_NAMES.map((n, i) => r("fight", `char-${i}`, `${n} 장인 · 계속`, "판", `fight.char.${i}` as AchMetric, 20, 20, 200)),
  r("defense", "runs", "평생 수호자 · 계속", "판", "defense.runs", 400, 100, 600),
  r("defense", "wins", "백전백승 · 계속", "번 클리어", "defense.wins", 100, 50, 1500),
  r("defense", "kills", "글리치 멸절자 · 계속", "마리", "defense.kills", 200_000, 100_000, 1000),
  r("rhythm", "plays", "리듬 중독 · 계속", "판", "rhythm.plays", 300, 150, 500),
  r("sketch", "games", "붓을 든 장인 · 계속", "판", "sketch.games", 200, 100, 750),
  r("sketch", "correct", "독심술사 · 계속", "번", "sketch.correct", 300, 150, 500),
  r("sketch", "first", "광속 정답 · 계속", "번", "sketch.first", 100, 50, 350),
  r("sketch", "drew", "인기 화가 · 계속", "번", "sketch.drew", 100, 50, 350),
  r("sketch", "wins", "두들 챔피언 · 계속", "번", "sketch.wins", 10, 10, 750),
  r("sketch", "points", "점수 부자 · 계속", "점", "sketch.points", 20_000, 20_000, 400),
  r("marble", "games", "세계 일주 · 계속", "판", "marble.games", 200, 100, 750),
  r("marble", "wins", "마블 재벌 · 계속", "승", "marble.wins", 100, 50, 1500),
  r("survivor", "games", "불면의 마을 · 계속", "판", "survivor.games", 150, 50, 600),
  r("survivor", "wins", "밤을 지배하는 자 · 계속", "번 클리어", "survivor.wins", 50, 25, 1500),
  r("rogue", "runs", "로그아웃 불가 · 계속", "판", "rogue.runs", 150, 50, 600),
  r("rogue", "kills", "글리치 멸균 · 계속", "마리", "rogue.kills", 50_000, 50_000, 1000),
);
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
/** 반복형: 지금 숫자로 채운 칸 수 (from 넘은 뒤로) */
export const repDone = (a: Achievement, value: number) => Math.floor(Math.max(0, value - (a.from ?? 0)) / a.goal);
/** 반복형: 다음에 받을 칸의 목표 숫자 (소영 40판 · 60판 …) */
export const repTarget = (a: Achievement, times: number) => (a.from ?? 0) + (times + 1) * a.goal;
/** 지금 받을 수 있는 횟수 (일회형은 0 또는 1) */
export function claimableTimes(a: Achievement, s: Pick<AchState, "value" | "claimedAt" | "times">): number {
  if (a.repeat) return Math.max(0, repDone(a, s.value) - (s.times ?? 0));
  return !s.claimedAt && s.value >= a.goal ? 1 : 0;
}

/* ─────────────── 일일 미션 ─────────────── */

/**
 * 일일 미션: 오늘(한국 시간) 한 만큼 — 서버가 그날 처음 볼 때(출석 · 미션 창) 업적 숫자를 기준으로 적어 두고 그 뒤로 늘어난 만큼 셈.
 * 받은 미션은 회원 문서 daily.got 에 (날이 바뀌면 새로). 업적 숫자 중 쌓이기만 하는 것만 씀
 */
export interface DailyMission {
  id: string;
  game: AchGame;
  title: string;
  metric: AchMetric;
  goal: number;
  reward: number;
}
const dm = (game: AchGame, id: string, title: string, metric: AchMetric, goal: number, reward: number): DailyMission => ({
  id: `${game}.d-${id}`,
  game,
  title,
  metric,
  goal,
  reward,
});
/** 일일 미션 보상: 처음 정한 숫자의 3배를 그대로 적어 둠 (DOODLE PARTY 는 그 2/3) — 배수 상수 없음, 업적 배수 ACH_X 와도 따로 */
export const DAILY_MISSIONS: DailyMission[] = [
  dm("poker", "hands", "포커 10판 치기", "poker.hands", 10, 90),
  dm("poker", "hands30", "포커 30판 치기", "poker.hands", 30, 150),
  dm("poker", "wins", "포커 3판 이기기", "poker.wins", 3, 120),
  dm("fight", "games", "랭크전 3판 하기", "fight.games", 3, 120),
  dm("fight", "win", "랭크전 1승", "fight.wins", 1, 90),
  dm("fight", "wins", "랭크전 3승", "fight.wins", 3, 180),
  dm("defense", "run", "랭킹 판 1번 끝내기", "defense.runs", 1, 90),
  dm("defense", "runs", "랭킹 판 3번 끝내기", "defense.runs", 3, 180),
  dm("defense", "kills", "적 1,000마리 처치 (랭킹 판)", "defense.kills", 1000, 120),
  dm("rhythm", "plays", "3판 하기", "rhythm.plays", 3, 90),
  dm("rhythm", "plays10", "10판 하기", "rhythm.plays", 10, 180),
  dm("sketch", "game", "한 판 끝까지 하기", "sketch.games", 1, 60),
  dm("sketch", "games", "세 판 끝까지 하기", "sketch.games", 3, 120),
  dm("sketch", "correct", "정답 5번 맞히기", "sketch.correct", 5, 60),
  dm("sketch", "first", "제일 먼저 맞히기 2번", "sketch.first", 2, 80),
  dm("sketch", "drew", "내 그림이 맞혀지기 2번", "sketch.drew", 2, 80),
  dm("sketch", "win", "1등 하기 (3명 이상 판)", "sketch.wins", 1, 100),
  dm("sketch", "likes", "내 그림에 따봉 2개 받기", "sketch.likes", 2, 80),
  dm("marble", "game", "한 판 끝까지 하기", "marble.games", 1, 90),
  dm("marble", "games", "세 판 끝까지 하기", "marble.games", 3, 180),
  dm("marble", "win", "1등 하기", "marble.wins", 1, 120),
  dm("survivor", "game", "한 판 끝내기", "survivor.games", 1, 90),
  dm("survivor", "games", "세 판 끝내기", "survivor.games", 3, 180),
  dm("survivor", "kills", "몬스터 3,000마리 처치", "survivor.kills", 3000, 120),
  dm("rogue", "run", "한 판 끝내기", "rogue.runs", 1, 90),
  dm("rogue", "runs", "세 판 끝내기", "rogue.runs", 3, 180),
  dm("rogue", "bosses", "보스 3마리 쓰러뜨리기", "rogue.bosses", 3, 120),
];
/** 일일 미션이 보는 숫자 (기준값을 적어 둘 것) */
export const DAILY_METRICS = [...new Set(DAILY_MISSIONS.map((x) => x.metric))];
export const dailyMission = (id: unknown) => DAILY_MISSIONS.find((x) => x.id === id);
export const dailyOf = (game: AchGame) => DAILY_MISSIONS.filter((x) => x.game === game);

/** 미션 창에 내려가는 한 줄: 오늘 한 만큼 · 받았는지 */
export interface DailyState {
  id: string;
  value: number;
  got: boolean;
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
    case "daily": {
      const ids = (r.ref ?? "").split(",").filter(Boolean);
      return ids.length > 1
        ? `일일 미션 · ${POINT_GAMES[dailyMission(ids[0])?.game ?? "poker"]} ${ids.length}개`
        : `일일 미션 · ${dailyMission(ids[0])?.title ?? ""}`;
    }
    case "buy":
      return `구매 · ${shopItem(r.ref)?.name ?? r.ref ?? ""}`;
    case "exchange":
      return r.ref === "toChips" ? "환전 · 포커 칩으로" : "환전 · 포커 칩에서";
    case "admin":
      return "운영자 조정";
    case "defense":
      return r.ref?.startsWith("store:")
        ? "디펜스 · 재화샵"
        : r.ref?.startsWith("sell:")
          ? "디펜스 · 재화 → GP"
          : r.ref?.startsWith("pack:")
            ? "디펜스 · 패키지"
            : r.ref?.startsWith("pass")
              ? "디펜스 · 시즌 패스"
              : r.ref?.startsWith("quest:")
                ? "디펜스 · 미션"
                : r.ref === "cores" || r.ref === "gpchest" || r.ref === "gprelic" || r.ref === "gptrans" || r.ref?.startsWith("gpcards:")
                  ? "디펜스 · 옛 GP 상점"
                  : r.ref?.startsWith("weekly:")
                    ? "디펜스 · 주간 도전 (종료)"
                    : "디펜스";
    case "marble":
      return r.ref?.startsWith("store:") ? "마블 · 상점" : "DICE TOWN";
    case "survivor":
      return "PIXEL TOWN SURVIVOR";
    case "mail":
      return `우편 · ${r.ref ?? ""}`;
    default:
      return r.reason;
  }
}
