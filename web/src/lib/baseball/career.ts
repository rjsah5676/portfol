/**
 * 육성 모드 (타자편) — 나만의 선수 한 명을 5시즌 키우고 은퇴시키기.
 *
 * 흐름: 스프링캠프(턴 4) → 시즌(주마다 턴 2 + 경기 1, 10주) → 시즌 결산 → 비시즌(턴 3) → … 5시즌 → 은퇴
 * 턴 행동: 훈련 5종 · 휴식 · 외출(픽셀파이트 캐릭터 인연 → 특수능력 · 필살타법 전수) · (상점은 턴 안 씀)
 *
 * 결과 분포(종합 0 ~ 999)는 넓게: 중앙값 ~500 · 하위 10% ~200 · 상위 3% 800+ (scripts/baseball-career-sim.ts 로 확인)
 *   흔들림 세 갈래 — 운(숨은 재능 등급 · 대성공 · 부상 · 각성) · 선택(훈련 몰빵 · 체력 관리 · 인연) · 실력(직접 친 타석)
 * GP 부스트(판마다 고르는 것)는 같은 플레이 대비 종합 +30% 를 넘지 않게 (시뮬로 확인).
 *
 * 화면 · 시간 · 저장은 없음 — 상태(Career)는 그냥 JSON (localStorage 에 통째로).
 * 난수는 (시드, 턴 번호)로 정해서 새로고침해도 결과가 같음.
 */
import type { Diff } from "./ai";
import { CHARS, charById, type Batter, type CharId } from "./data";
import type { BatLine } from "./game";
import { clamp, makeRng, type Rng } from "./rng";

export type StatKey = "hit" | "power" | "run" | "def";
export type Stats = Record<StatKey, number>;
export const STAT_KEYS: StatKey[] = ["hit", "power", "run", "def"];
export const STAT_NAME: Record<StatKey, string> = { hit: "맞히기", power: "파워", run: "주루", def: "수비" };

/* ─────────────── 선수 타입 · 재능 ─────────────── */

export type BatType = "contact" | "power" | "speed" | "defense" | "all";
export const TYPES: Record<BatType, { name: string; desc: string; pos: string; apt: Stats; start: Stats }> = {
  contact: { name: "교타자", desc: "맞히기가 잘 자람", pos: "2B", apt: { hit: 1.22, power: 0.84, run: 1.0, def: 0.96 }, start: { hit: 160, power: 85, run: 125, def: 115 } },
  power: { name: "거포", desc: "파워가 잘 자람 · 발은 느림", pos: "1B", apt: { hit: 0.9, power: 1.28, run: 0.9, def: 1.0 }, start: { hit: 105, power: 170, run: 85, def: 105 } },
  speed: { name: "준족", desc: "주루 · 수비가 잘 자람", pos: "CF", apt: { hit: 1.0, power: 0.8, run: 1.3, def: 1.06 }, start: { hit: 125, power: 75, run: 180, def: 125 } },
  defense: { name: "수비형", desc: "수비가 잘 자람", pos: "SS", apt: { hit: 0.96, power: 0.84, run: 1.04, def: 1.3 }, start: { hit: 115, power: 85, run: 125, def: 180 } },
  all: { name: "만능형", desc: "고르게 자람", pos: "3B", apt: { hit: 1.0, power: 1.0, run: 1.0, def: 1.0 }, start: { hit: 125, power: 115, run: 125, def: 125 } },
};

/** 숨은 재능 — 1시즌 끝 스카우트 평가에서 공개. SS 는 각성으로만 */
export const TALENTS = [
  { g: "F", w: 0.08, mul: 0.6, limit: 230 },
  { g: "D", w: 0.17, mul: 0.75, limit: 400 },
  { g: "C", w: 0.3, mul: 0.88, limit: 800 },
  { g: "B", w: 0.27, mul: 1.0, limit: 1000 },
  { g: "A", w: 0.13, mul: 1.35, limit: 1200 },
  { g: "S", w: 0.05, mul: 1.55, limit: 1230 },
  { g: "SS", w: 0, mul: 1.7, limit: 1350 },
] as const;

/* ─────────────── 훈련 ─────────────── */

export type TrainKey = "hit" | "power" | "run" | "def" | "combo";
export const TRAINS: Record<TrainKey, { name: string; desc: string; cost: number; gain: Partial<Stats> }> = {
  hit: { name: "타격 훈련", desc: "맞히기 ↑ (파워 조금)", cost: 18, gain: { hit: 1, power: 0.18 } },
  power: { name: "근력 훈련", desc: "파워 ↑ (맞히기 조금)", cost: 22, gain: { power: 1, hit: 0.15 } },
  run: { name: "주루 훈련", desc: "주루 ↑ (수비 조금)", cost: 19, gain: { run: 1, def: 0.22 } },
  def: { name: "수비 훈련", desc: "수비 ↑ (주루 조금)", cost: 16, gain: { def: 1, run: 0.2 } },
  combo: { name: "특타", desc: "맞히기 · 파워 같이 ↑ · 많이 지침", cost: 30, gain: { hit: 0.7, power: 0.7 } },
};
export const TRAIN_KEYS: TrainKey[] = ["hit", "power", "run", "def", "combo"];
/** 훈련 한 번 기본 성장 (재능 · 타입 · 컨디션 · 높을수록 덜 오름 반영 전) */
export const BASE_GAIN = 7.5;
/** 밸런스 손잡이 (시뮬에서 바꿔 보기) */
export const TUNE = { gameXp: 0.95, train: 1 };
/** 훈련 레벨: 같은 훈련 TRAIN_LV_EVERY 번마다 +1 (최대 5) · 레벨당 효율 +10% */
export const TRAIN_LV_EVERY = 5;

export const COND_NAME = ["최악", "나쁨", "보통", "좋음", "최고"] as const;
const COND_TRAIN = [0.72, 0.86, 1, 1.12, 1.25];
/** 경기 컨디션: 맞히기 · 파워 배율 */
export const COND_GAME = [0.88, 0.94, 1, 1.04, 1.08];

/* ─────────────── 특수능력 ─────────────── */

export type SkillId =
  | "clutch" | "clutchBad" | "grit" | "fragile" | "iron"
  | "sk_kai" | "sk_igna" | "sk_soyoung" | "sk_lily" | "sk_zena" | "sk_gunmo" | "sk_ivan" | "sk_forte";
export interface Skill {
  name: string;
  desc: string;
  /** 종합 점수에 더하는 값 */
  val: number;
  bad?: boolean;
  /** 경기에서 늘 붙는 능력치 */
  add?: Partial<Stats>;
  sit?: Batter["sit"];
}
export const SKILLS: Record<SkillId, Skill> = {
  clutch: { name: "찬스 강함", desc: "득점권에서 맞히기 +70", val: 7, sit: { rispHit: 70 } },
  clutchBad: { name: "찬스 약함", desc: "득점권에서 맞히기 -60", val: -8, bad: true, sit: { rispHit: -60 } },
  grit: { name: "끈질김", desc: "2스트라이크에서 맞히기 +70", val: 6, sit: { twoK: 70 } },
  fragile: { name: "부상 체질", desc: "부상 확률 +50%", val: -6, bad: true },
  iron: { name: "강철 몸", desc: "부상 확률 -40%", val: 10 },
  sk_kai: { name: "질풍 주루", desc: "주루 +50 (경기)", val: 7, add: { run: 50 } },
  sk_igna: { name: "업화의 힘", desc: "파워 +45 (경기)", val: 8, add: { power: 45 } },
  sk_soyoung: { name: "채찍 손목", desc: "2스트라이크에서 맞히기 +90", val: 7, sit: { twoK: 90 } },
  sk_lily: { name: "평정심", desc: "컨디션이 잘 안 떨어짐 · 슬럼프 무시", val: 8 },
  sk_zena: { name: "번개 반사", desc: "수비 +50 (경기)", val: 7, add: { def: 50 } },
  sk_gunmo: { name: "데이터 야구", desc: "훈련 효율 +8%", val: 10 },
  sk_ivan: { name: "철곰 근력", desc: "득점권에서 파워 +90", val: 7, sit: { rispPow: 90 } },
  sk_forte: { name: "시간 감각", desc: "맞히기 +40 (경기) · 부상 회복 빠름", val: 7, add: { hit: 40 } },
};
/** 필살타법을 배우면 종합 + */
export const LEARNED_VAL = 12;

/* ─────────────── 픽셀파이트 인연 (외출) ─────────────── */

export interface Bond {
  /** 잘 키워 주는 능력치 */
  stat: StatKey;
  place: string;
  /** 단계별 대사 (1 만남 · 2 고르기 · 3 특수능력 · 4 필살 전수) */
  lines: [string, string, string, string];
  /** 2단계 고르기 */
  pick: [string, string];
}
export const BONDS: Record<CharId, Bond> = {
  kai: {
    stat: "run", place: "강변 러닝 코스", pick: ["같이 전력 질주", "벤치에서 바람 쐬기"],
    lines: ["바람처럼 달리는 사람이 있다… 카이다.", "\"따라올 수 있으면 따라와 봐.\"", "\"발은 거짓말 안 해. 이거 하나 알려 줄게.\"", "\"이제 네 바람이야. 질풍 스윙, 써 봐.\""],
  },
  igna: {
    stat: "power", place: "용광로 체육관", pick: ["불꽃 웨이트 같이 하기", "땀 식히며 이야기"],
    lines: ["뜨거운 열기 — 이그나가 쇳덩이를 들고 있다.", "\"힘은 태워야 커진다.\"", "\"불꽃은 안에서부터. 이 감각 기억해.\"", "\"업화 스윙. 공까지 태워 버려.\""],
  },
  soyoung: {
    stat: "hit", place: "실내 연습장", pick: ["채찍 맞히기 특훈", "간식 먹으며 수다"],
    lines: ["채찍 소리가 난다. 소영이 공을 하나씩 쳐낸다.", "\"공은 끝까지 봐야지~\"", "\"손목이 채찍처럼! 2스트라이크 무서울 거 없어.\"", "\"채찍 스윙! 어디로 오든 닿을걸?\""],
  },
  lily: {
    stat: "def", place: "비 오는 공원", pick: ["우산 들고 수비 연습", "같이 비 구경"],
    lines: ["우산을 쓴 릴리가 빗속에 서 있다.", "\"서두르지 않아도 돼. 둥실둥실~\"", "\"마음이 고요하면 공도 천천히 보여.\"", "\"우산 스윙… 타구가 오래오래 날 거야.\""],
  },
  zena: {
    stat: "run", place: "번개 치는 옥상", pick: ["반사 신경 훈련", "번개 구경"],
    lines: ["번쩍! 제나가 번개 사이를 뛰어다닌다.", "\"번개보다 빨리 반응해 봐!\"", "\"몸이 먼저 움직이게. 수비는 반사야.\"", "\"번개 스윙! 수비 전부 찌릿하게 해 줘.\""],
  },
  gunmo: {
    stat: "hit", place: "PC방", pick: ["데이터 분석 같이 보기", "게임 한 판"],
    lines: ["모니터 앞의 건모. 화면에 투수 데이터가 가득하다.", "\"투수는 패턴이 있어. 다 기록돼.\"", "\"훈련도 디버깅하듯이. 효율이 다르지.\"", "\"Ctrl+A 스윙. 수비 전원 일시정지.\""],
  },
  ivan: {
    stat: "power", place: "시베리아식 사우나", pick: ["철곰 근력 훈련", "사우나에서 버티기"],
    lines: ["거대한 그림자. 이반이 통나무를 들고 있다.", "\"힘. 힘이 전부다.\"", "\"찬스에서 곰처럼. 한 방이면 된다.\"", "\"철곰 스윙. 맞으면 끝이다.\""],
  },
  forte: {
    stat: "hit", place: "시계탑", pick: ["타이밍 연습", "시계 소리 듣기"],
    lines: ["째깍째깍. 포르테가 시계탑 위에 앉아 있다.", "\"타이밍이란 시간을 아는 거야.\"", "\"0.01초가 보이기 시작하면 다 맞혀.\"", "\"되감기 스윙. 한 번은 다시 칠 수 있어.\""],
  },
};

/** 인연 단계가 열리는 만남 횟수 (1 만남 · 2 고르기 · 3 특수능력 · 4 필살 전수) */
export const BOND_AT = [1, 3, 5, 8];
export const bondStage = (visits: number) => BOND_AT.filter((v) => visits >= v).length;

/* ─────────────── 상점 (경기 · 연봉으로 번 자금, 단위 만원) ─────────────── */

export type ItemId = "drink" | "food" | "charm" | "rehab" | "bat" | "dumbbell" | "spike" | "glove";
export const ITEMS: Record<ItemId, { name: string; desc: string; price: number; gear?: TrainKey }> = {
  drink: { name: "스포츠 드링크", desc: "체력 +30", price: 60 },
  food: { name: "보양식", desc: "컨디션 +1 · 체력 +10", price: 110 },
  charm: { name: "행운의 부적", desc: "다음 훈련 대성공 확률 +25%", price: 140 },
  rehab: { name: "재활 치료", desc: "부상 남은 기간 절반", price: 220 },
  bat: { name: "고급 배트", desc: "타격 · 특타 훈련 +12% (계속)", price: 420, gear: "hit" },
  dumbbell: { name: "아령 세트", desc: "근력 · 특타 훈련 +12% (계속)", price: 420, gear: "power" },
  spike: { name: "스파이크", desc: "주루 훈련 +12% (계속)", price: 380, gear: "run" },
  glove: { name: "명품 글러브", desc: "수비 훈련 +12% (계속)", price: 380, gear: "def" },
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

/* ─────────────── GP 부스트 (판마다 시작할 때 고름 · GP 몫 ≤ 30%) ─────────────── */

export type GpId = "trainer" | "charmGp" | "medic" | "camp";
export const GP_BOOSTS: Record<GpId, { name: string; desc: string; price: number }> = {
  trainer: { name: "개인 트레이너", desc: "모든 훈련 효율 +8%", price: 300 },
  charmGp: { name: "황금 부적", desc: "대성공 확률 +5% · 각성 확률 1.5배", price: 300 },
  medic: { name: "메디컬 팀", desc: "부상 확률 -35% · 부상 기간 -40%", price: 200 },
  camp: { name: "해외 전지훈련", desc: "스프링캠프 턴 +2", price: 200 },
};
export const GP_IDS = Object.keys(GP_BOOSTS) as GpId[];

/* ─────────────── 상태 ─────────────── */

export const SEASONS = 5;
export const WEEKS = 10;
export const TURNS_PER_WEEK = 2;
export const CAMP_TURNS = 4;
export const OFF_TURNS = 3;
const START_AGE = 19;

export interface Injury {
  kind: 0 | 1 | 2;
  /** 남은 턴 (경기도 1로 셈) */
  left: number;
}
export const INJURY_NAME = ["가벼운 부상", "부상", "큰 부상"] as const;

export interface SeasonRec {
  season: number;
  line: BatLine & { g: number };
  awards: string[];
  ovr: number;
  salary: number;
}

export type Phase = "camp" | "season" | "seasonEnd" | "off" | "retired";

export interface Career {
  v: 1;
  id: string;
  seed: number;
  name: string;
  num: number;
  bats: "R" | "L";
  type: BatType;
  diff: Diff;
  stats: Stats;
  talent: number;
  talentKnown: boolean;
  /** 이 근처부터 거의 안 오름 (한계 돌파하면 늘어남) */
  limit: number;
  skills: SkillId[];
  learned?: CharId;
  stamina: number;
  cond: number;
  trust: number;
  money: number;
  salary: number;
  tCount: Record<TrainKey, number>;
  gear: ItemId[];
  bag: Partial<Record<ItemId, number>>;
  charmNext: boolean;
  bonds: Partial<Record<CharId, number>>;
  injury: Injury | null;
  awakened: boolean;
  gp: GpId[];
  phase: Phase;
  season: number;
  week: number;
  /** 이번 구간(캠프 · 주 · 비시즌)에서 쓴 턴 */
  slot: number;
  turn: number;
  line: BatLine & { g: number };
  total: BatLine & { g: number };
  seasons: SeasonRec[];
  wins: number;
  losses: number;
  /** 고르기가 남은 이벤트 */
  pending: Pending | null;
  log: string[];
  /** 최근 경기 결과 (화면) */
  lastGame?: string;
  /** 직접 출전 중 (나가거나 새로고침하면 자동 결과로 반영 — 다시 하기 방지) */
  inGame?: boolean;
}

export interface Pending {
  kind: "bond" | "coach" | "night" | "press";
  char?: CharId;
  title: string;
  text: string;
  choices: [string, string];
}

const emptyLine = () => ({ g: 0, pa: 0, ab: 0, h: 0, d2: 0, d3: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0 });

export interface NewCareerOpts {
  name: string;
  num: number;
  bats: "R" | "L";
  type: BatType;
  diff: Diff;
  gp?: GpId[];
  seed?: number;
}

export function newCareer(o: NewCareerOpts): Career {
  const seed = (o.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const rng = makeRng(seed ^ 0x51ed);
  // 재능 (숨김)
  let r = rng();
  let talent = 0;
  for (let i = 0; i < TALENTS.length; i++) {
    r -= TALENTS[i].w;
    if (r < 0) {
      talent = i;
      break;
    }
  }
  const t = TYPES[o.type];
  const stats = {} as Stats;
  for (const k of STAT_KEYS) stats[k] = Math.round(t.start[k] * (0.85 + rng() * 0.3));
  return {
    v: 1,
    id: seed.toString(36),
    seed,
    name: o.name,
    num: o.num,
    bats: o.bats,
    type: o.type,
    diff: o.diff,
    stats,
    talent,
    talentKnown: false,
    limit: TALENTS[talent].limit,
    skills: [],
    stamina: 100,
    cond: 2,
    trust: 20,
    money: 150,
    salary: 3000,
    tCount: { hit: 0, power: 0, run: 0, def: 0, combo: 0 },
    gear: [],
    bag: {},
    charmNext: false,
    bonds: {},
    injury: null,
    awakened: false,
    gp: o.gp ?? [],
    phase: "camp",
    season: 1,
    week: 0,
    slot: 0,
    turn: 0,
    line: emptyLine(),
    total: emptyLine(),
    seasons: [],
    wins: 0,
    losses: 0,
    pending: null,
    log: ["프로 입단! 스프링캠프가 시작됐다."],
  };
}

/* ─────────────── 계산 ─────────────── */

export const age = (c: Career) => START_AGE + c.season - 1;
export const talentName = (c: Career) => (c.talentKnown ? TALENTS[c.talent].g : "?");
export const trainLv = (c: Career, k: TrainKey) => Math.min(5, 1 + Math.floor(c.tCount[k] / TRAIN_LV_EVERY));

export function ovrOf(c: Pick<Career, "stats" | "skills" | "learned">) {
  const s = c.stats;
  let v = ((s.hit + s.power) * 1.05 + (s.run + s.def) * 0.95) / 4;
  for (const id of c.skills) v += SKILLS[id].val;
  if (c.learned) v += LEARNED_VAL;
  return Math.round(clamp(v, 0, 999));
}

/** 종합 → 등급 */
export const GRADES = [
  { min: 900, g: "SSS", color: "#ff5fd1" },
  { min: 820, g: "SS", color: "#ff7ae0" },
  { min: 740, g: "S", color: "#ffcf4a" },
  { min: 640, g: "A", color: "#ff9a3d" },
  { min: 540, g: "B", color: "#7dff9a" },
  { min: 440, g: "C", color: "#7ad7ff" },
  { min: 340, g: "D", color: "#b6c2ff" },
  { min: 240, g: "E", color: "#c9c9c9" },
  { min: 0, g: "F", color: "#8a8a8a" },
] as const;
export const gradeOf = (ovr: number) => GRADES.find((g) => ovr >= g.min)!;
/** 능력치 하나 → 등급 글자 (게임빌식 A ~ G) */
export function statGrade(v: number) {
  const L = [
    [900, "S", "#ff7ae0"], [800, "A", "#ff5a5a"], [700, "B", "#ff9a3d"], [600, "C", "#ffd23f"],
    [500, "D", "#7dff9a"], [400, "E", "#7ad7ff"], [300, "F", "#b6c2ff"], [0, "G", "#9a9a9a"],
  ] as const;
  const r = L.find((x) => v >= x[0])!;
  return { g: r[1], color: r[2] };
}

/**
 * 은퇴 종합 → 상위 몇 % (육성 시뮬 백분위표 — scripts/baseball-career-sim.ts 결과를 옮겨 적음).
 * [종합, 그 이상인 비율]
 */
export const PCT_TABLE: [number, number][] = [
  [950, 0.002], [900, 0.012], [850, 0.036], [800, 0.056], [750, 0.092], [700, 0.174], [650, 0.224], [600, 0.312], [550, 0.448],
  [500, 0.568], [450, 0.68], [400, 0.728], [350, 0.786], [300, 0.892], [250, 0.92], [200, 0.998], [0, 1],
];
export function topPct(ovr: number) {
  for (let i = 0; i < PCT_TABLE.length - 1; i++) {
    const [a, pa] = PCT_TABLE[i];
    const [b, pb] = PCT_TABLE[i + 1];
    if (ovr >= a) return pa * 100;
    if (ovr >= b) return (pb + ((ovr - b) / (a - b)) * (pa - pb)) * 100;
  }
  return 100;
}

/** 높을수록 덜 오름 */
function dim(c: Career, v: number) {
  return Math.max(0.02, 1 - v / c.limit);
}

function hasGp(c: Career, id: GpId) {
  return c.gp.includes(id);
}

/** 능력치 올리기 (재능 · 타입 · 높을수록 덜) — 실제 오른 값 */
function grow(c: Career, k: StatKey, base: number): number {
  const before = c.stats[k];
  const g = base * TALENTS[c.talent].mul * TYPES[c.type].apt[k] * dim(c, before);
  c.stats[k] = clamp(before + g, 1, 999);
  return c.stats[k] - before;
}

/** 경기에 나갈 내 선수 (컨디션 · 특수능력 · 체력 반영) */
export function careerBatter(c: Career): Batter {
  const f = COND_GAME[c.cond] * (c.stamina < 20 ? 0.9 : 1);
  const add: Stats = { hit: 0, power: 0, run: 0, def: 0 };
  const sit: NonNullable<Batter["sit"]> = {};
  for (const id of c.skills) {
    const s = SKILLS[id];
    for (const k of STAT_KEYS) add[k] += s.add?.[k] ?? 0;
    if (s.sit) for (const [k, v] of Object.entries(s.sit) as [keyof typeof sit, number][]) sit[k] = (sit[k] ?? 0) + v;
  }
  return {
    name: c.name,
    num: c.num,
    pos: TYPES[c.type].pos,
    bats: c.bats,
    hit: Math.round(clamp(c.stats.hit * f + add.hit, 1, 999)),
    power: Math.round(clamp(c.stats.power * f + add.power, 1, 999)),
    run: Math.round(clamp(c.stats.run + add.run, 1, 999)),
    def: Math.round(clamp(c.stats.def + add.def, 1, 999)),
    learned: c.learned,
    sit,
  };
}

/* ─────────────── 진행 ─────────────── */

export type Step = "turn" | "game" | "seasonEnd" | "retired" | "pending";
export function stepOf(c: Career): Step {
  if (c.phase === "retired") return "retired";
  if (c.pending) return "pending";
  if (c.phase === "seasonEnd") return "seasonEnd";
  if (c.phase === "season" && c.slot >= TURNS_PER_WEEK) return "game";
  return "turn";
}

/** 지금 구간 설명 */
export function whenText(c: Career) {
  if (c.phase === "camp") return `${c.season}년차 스프링캠프 ${c.slot + 1}/${campTurns(c)}`;
  if (c.phase === "off") return `${c.season}년차 비시즌 ${c.slot + 1}/${OFF_TURNS}`;
  if (c.phase === "season") return `${c.season}년차 ${c.week + 1}주차 ${c.slot >= TURNS_PER_WEEK ? "경기" : `${c.slot + 1}/${TURNS_PER_WEEK}`}`;
  if (c.phase === "seasonEnd") return `${c.season}년차 시즌 결산`;
  return "은퇴";
}
const campTurns = (c: Career) => CAMP_TURNS + (hasGp(c, "camp") && c.season === 1 ? 2 : 0);

function turnRng(c: Career, salt = 0) {
  return makeRng((c.seed * 2654435761 + c.turn * 40503 + salt * 977 + 12345) >>> 0);
}

function pushLog(c: Career, ...lines: string[]) {
  c.log = [...lines, ...c.log].slice(0, 40);
}

/** 턴 끝 → 다음 구간으로 */
function endTurn(c: Career) {
  c.turn++;
  c.slot++;
  if (c.injury) {
    c.injury.left--;
    if (c.injury.left <= 0) {
      c.injury = null;
      pushLog(c, "부상에서 돌아왔다!");
    }
  }
  if (c.phase === "camp" && c.slot >= campTurns(c)) {
    c.phase = "season";
    c.slot = 0;
    c.week = 0;
    pushLog(c, `${c.season}년차 시즌 개막!`);
  } else if (c.phase === "off" && c.slot >= OFF_TURNS) {
    c.season++;
    c.phase = "camp";
    c.slot = 0;
    pushLog(c, `${c.season}년차 스프링캠프 시작.`);
  }
}

export interface Delta {
  stats: Partial<Stats>;
  stamina: number;
  cond: number;
  trust: number;
  money: number;
}
export interface TurnOut {
  title: string;
  /** "great" 대성공 · "fail" 실패 · "injury" 부상 · "ok" */
  tone: "great" | "ok" | "fail" | "injury" | "event" | "awaken";
  lines: string[];
  delta: Delta;
  /** 이어서 일어난 이벤트 */
  extra?: TurnOut;
  /** 고르기 이벤트를 알리기만 함 (화면은 바로 고르기 창) */
  stub?: boolean;
}

function snap(c: Career) {
  return { stats: { ...c.stats }, stamina: c.stamina, cond: c.cond, trust: c.trust, money: c.money };
}
function diffOf(c: Career, a: ReturnType<typeof snap>): Delta {
  const stats: Partial<Stats> = {};
  for (const k of STAT_KEYS) {
    const d = Math.round(c.stats[k]) - Math.round(a.stats[k]);
    if (d) stats[k] = d;
  }
  return { stats, stamina: Math.round(c.stamina - a.stamina), cond: c.cond - a.cond, trust: Math.round(c.trust - a.trust), money: c.money - a.money };
}

const addCond = (c: Career, d: number) => {
  // 평정심: 떨어지는 폭 1 줄임
  if (d < 0 && c.skills.includes("sk_lily")) d += 1;
  c.cond = clamp(c.cond + d, 0, 4);
};
const addStamina = (c: Career, d: number) => (c.stamina = clamp(c.stamina + d, 0, 100));
const addTrust = (c: Career, d: number) => (c.trust = clamp(c.trust + d, 0, 100));

function injuryP(c: Career) {
  let p = c.stamina < 40 ? 0.012 + ((40 - c.stamina) / 40) * 0.24 : 0.008;
  if (c.skills.includes("fragile")) p *= 1.5;
  if (c.skills.includes("iron")) p *= 0.6;
  if (hasGp(c, "medic")) p *= 0.65;
  return p;
}

function hurt(c: Career, rng: Rng, worse: boolean): string[] {
  let r = rng();
  if (worse) r *= 0.6;
  const kind: Injury["kind"] = r < 0.12 ? 2 : r < 0.42 ? 1 : 0;
  let left = [2, 6, 13][kind];
  if (hasGp(c, "medic")) left = Math.max(1, Math.round(left * 0.6));
  if (c.skills.includes("sk_forte")) left = Math.max(1, left - 1 - kind);
  c.injury = { kind, left };
  const out = [`${INJURY_NAME[kind]}! ${left}턴 동안 쉬어야 한다.`];
  if (kind >= 1) {
    const loss = kind === 2 ? 0.07 : 0.025;
    for (const k of STAT_KEYS) c.stats[k] *= 1 - loss;
    out.push(`능력치가 ${Math.round(loss * 100)}% 떨어졌다…`);
  }
  if (kind === 2) {
    addTrust(c, -12);
    if (!c.skills.includes("fragile") && !c.skills.includes("iron") && rng() < 0.5) {
      c.skills.push("fragile");
      out.push("특수능력 「부상 체질」이 생겼다…");
    }
  }
  addCond(c, -1);
  return out;
}

/** 훈련 확률 (화면에도 보여 줌) */
export function trainRisk(c: Career) {
  return {
    injury: injuryP(c),
    fail: clamp(0.05 + (Math.max(0, 50 - c.stamina) / 50) * 0.3, 0, 0.5),
    great: 0.09 + c.cond * 0.025 + (c.charmNext ? 0.25 : 0) + (hasGp(c, "charmGp") ? 0.05 : 0),
  };
}

/** 훈련 */
function train(c: Career, k: TrainKey, rng: Rng): TurnOut {
  const t = TRAINS[k];
  const a = snap(c);
  const lines: string[] = [];
  // 결과 굴리기: 부상 → 실패 → 대성공
  if (rng() < injuryP(c)) {
    addStamina(c, -t.cost);
    const l = hurt(c, rng, c.stamina < 15);
    c.charmNext = false;
    return { title: `${t.name} 중 부상!`, tone: "injury", lines: l, delta: diffOf(c, a) };
  }
  const { fail: failP, great: greatP } = trainRisk(c);
  c.charmNext = false;
  const r = rng();
  const tone: TurnOut["tone"] = r < failP ? "fail" : r < failP + greatP ? "great" : "ok";
  const mul =
    (tone === "fail" ? 0.3 : tone === "great" ? 2 : 1) *
    COND_TRAIN[c.cond] *
    (1 + (trainLv(c, k) - 1) * 0.1) *
    (c.gear.some((g) => ITEMS[g].gear === k || (k === "combo" && (ITEMS[g].gear === "hit" || ITEMS[g].gear === "power")) ) ? 1.12 : 1) *
    (c.skills.includes("sk_gunmo") ? 1.08 : 1) *
    (hasGp(c, "trainer") ? 1.08 : 1) *
    (0.85 + rng() * 0.3);
  for (const [sk, w] of Object.entries(t.gain) as [StatKey, number][]) grow(c, sk, BASE_GAIN * w * mul * TUNE.train);
  addStamina(c, -t.cost);
  c.tCount[k]++;
  if (c.tCount[k] % TRAIN_LV_EVERY === 0 && c.tCount[k] / TRAIN_LV_EVERY < 5) lines.push(`${t.name} 레벨 ${trainLv(c, k)}!`);
  addTrust(c, 0.25);
  if (tone === "great") addCond(c, rng() < 0.3 ? 1 : 0);
  const title = tone === "great" ? `${t.name} 대성공!` : tone === "fail" ? `${t.name} 실패…` : t.name;
  if (tone === "fail") lines.unshift("몸이 무거워서 집중이 안 됐다.");
  return { title, tone, lines, delta: diffOf(c, a) };
}

function rest(c: Career, rng: Rng): TurnOut {
  const a = snap(c);
  addStamina(c, c.injury ? 30 : 45);
  if (rng() < 0.35) addCond(c, 1);
  return { title: c.injury ? "재활" : "휴식", tone: "ok", lines: [c.injury ? "치료에 집중했다." : "푹 쉬었다."], delta: diffOf(c, a) };
}

/** 외출: 캐릭터를 만나 인연 단계 진행 (2단계는 고르기) */
function outing(c: Career, id: CharId, rng: Rng): TurnOut {
  const a = snap(c);
  const ch = charById(id);
  const b = BONDS[id];
  const visits = c.bonds[id] ?? 0;
  addStamina(c, 12);
  addCond(c, 1);
  if (visits >= BOND_AT[3]) {
    // 다 끝난 인연: 가볍게 놀기
    grow(c, b.stat, 6);
    return { title: `${ch.name}와 한때`, tone: "ok", lines: [`${b.place}에서 ${ch.name}와 즐거운 시간.`], delta: diffOf(c, a) };
  }
  if (rng() < 0.15) {
    return { title: `${b.place}`, tone: "ok", lines: [`${ch.name}는 오늘 안 보인다… 바람만 쐬고 왔다.`], delta: diffOf(c, a) };
  }
  c.bonds[id] = visits + 1;
  const stage = BOND_AT.indexOf(visits + 1) + 1;
  if (stage === 0) {
    grow(c, b.stat, 6);
    return { title: `${ch.name} · ${b.place}`, tone: "ok", lines: [`${ch.name}와 같이 시간을 보냈다. (인연 ${visits + 1}/${BOND_AT[3]})`], delta: diffOf(c, a) };
  }
  const lines = [b.lines[stage - 1]];
  if (stage === 1) {
    grow(c, b.stat, 10);
  } else if (stage === 2) {
    c.pending = { kind: "bond", char: id, title: `${ch.name} · ${b.place}`, text: b.lines[1], choices: b.pick };
    return { title: `${ch.name} · ${b.place}`, tone: "event", lines, delta: diffOf(c, a) };
  } else if (stage === 3) {
    const sk = `sk_${id}` as SkillId;
    if (!c.skills.includes(sk)) c.skills.push(sk);
    grow(c, b.stat, 14);
    lines.push(`특수능력 「${SKILLS[sk].name}」 획득! (${SKILLS[sk].desc})`);
  } else {
    grow(c, b.stat, 26);
    for (const k of STAT_KEYS) if (k !== b.stat) grow(c, k, 6);
    if (!c.learned) {
      c.learned = id;
      lines.push(`필살타법 「${ch.swing.name}」 전수! 경기에서 3번까지 쓸 수 있다.`);
    } else {
      lines.push(`이미 「${charById(c.learned).swing.name}」을 익혀서 이번엔 능력치만 올랐다.`);
    }
    const aw = tryAwaken(c, rng, 0.025);
    if (aw) return { title: `${ch.name}의 마지막 가르침`, tone: "event", lines, delta: diffOf(c, a), extra: aw };
  }
  return { title: `${ch.name} · ${b.place}`, tone: "event", lines, delta: diffOf(c, a) };
}

/** 각성 — 재능 한 단계 ↑ · 한계 돌파 · 능력치 폭발 (커리어에 한 번) */
function tryAwaken(c: Career, rng: Rng, p: number): TurnOut | undefined {
  if (c.awakened) return;
  if (rng() >= p * (hasGp(c, "charmGp") ? 1.5 : 1)) return;
  const a = snap(c);
  c.awakened = true;
  c.talent = Math.min(TALENTS.length - 1, c.talent + 1);
  c.limit = TALENTS[c.talent].limit + 80;
  for (const k of STAT_KEYS) grow(c, k, 40);
  addCond(c, 4);
  const lines = ["몸 안에서 뭔가가 깨어났다…!", `숨은 재능이 ${TALENTS[c.talent].g}급으로 올랐다 · 한계 돌파!`];
  if (!c.talentKnown) c.talentKnown = true;
  return { title: "각성!", tone: "awaken", lines, delta: diffOf(c, a) };
}

/** 턴 뒤 무작위 이벤트 */
function randomEvent(c: Career, rng: Rng): TurnOut | undefined {
  if (c.pending || c.injury) return;
  // 컨디션 최고 · 인연을 끝까지 본 선수에게 각성이 더 잘 옴
  const done = Math.min(2, Object.values(c.bonds).filter((v) => (v ?? 0) >= BOND_AT[3]).length);
  const aw = tryAwaken(c, rng, 0.0001 * (c.cond === 4 ? 2.5 : 1) * (1 + done * 0.6));
  if (aw) return aw;
  if (rng() > 0.2) return;
  const a = snap(c);
  const r = rng();
  if (r < 0.16) {
    c.pending = { kind: "coach", title: "감독의 호출", text: "\"오늘 밤 특별 훈련 할 텐가? 힘들 거다.\"", choices: ["한다!", "사양한다"] };
    return { title: "감독의 호출", tone: "event", lines: ["감독이 불렀다."], stub: true, delta: diffOf(c, a) };
  }
  if (r < 0.3) {
    c.pending = { kind: "night", title: "야간 자율 훈련", text: "동료들이 밤에 자율 훈련을 한다고 한다.", choices: ["같이 나간다", "일찍 잔다"] };
    return { title: "야간 자율 훈련", tone: "event", lines: ["동료가 말을 걸어왔다."], stub: true, delta: diffOf(c, a) };
  }
  if (r < 0.42 && c.phase === "season") {
    c.pending = { kind: "press", title: "기자 인터뷰", text: "\"요즘 컨디션 어떻습니까? 각오 한마디!\"", choices: ["겸손하게", "자신만만하게"] };
    return { title: "기자 인터뷰", tone: "event", lines: ["기자가 찾아왔다."], stub: true, delta: diffOf(c, a) };
  }
  if (r < 0.56) {
    const k = rng.pick(STAT_KEYS);
    grow(c, k, 12);
    const lines = [`선배가 ${STAT_NAME[k]} 요령을 알려 줬다.`];
    if (rng() < 0.12 && !c.skills.includes("clutch")) {
      c.skills = c.skills.filter((s) => s !== "clutchBad");
      c.skills.push("clutch");
      lines.push("특수능력 「찬스 강함」 획득!");
    } else if (rng() < 0.12 && !c.skills.includes("grit")) {
      c.skills.push("grit");
      lines.push("특수능력 「끈질김」 획득!");
    }
    return { title: "선배의 조언", tone: "event", lines, delta: diffOf(c, a) };
  }
  if (r < 0.68) {
    addCond(c, 1);
    return { title: "팬레터", tone: "event", lines: ["응원 편지가 왔다! 힘이 난다."], delta: diffOf(c, a) };
  }
  if (r < 0.8) {
    if (c.skills.includes("sk_lily")) return { title: "슬럼프?", tone: "event", lines: ["불안했지만 평정심으로 넘겼다."], delta: diffOf(c, a) };
    addCond(c, -2);
    const lines = ["뭘 해도 안 풀린다… 슬럼프다."];
    if (rng() < 0.15 && !c.skills.includes("clutch") && !c.skills.includes("clutchBad")) {
      c.skills.push("clutchBad");
      lines.push("특수능력 「찬스 약함」이 생겼다…");
    }
    return { title: "슬럼프", tone: "fail", lines, delta: diffOf(c, a) };
  }
  if (r < 0.9) {
    addStamina(c, 20);
    addCond(c, 1);
    return { title: "부모님 택배", tone: "event", lines: ["집에서 보양식이 왔다."], delta: diffOf(c, a) };
  }
  if (r < 0.96) {
    c.bag.charm = (c.bag.charm ?? 0) + 1;
    return { title: "길에서 주운 것", tone: "event", lines: ["반짝이는 부적을 주웠다. (행운의 부적 +1)"], delta: diffOf(c, a) };
  }
  if (!c.skills.includes("iron") && !c.skills.includes("fragile")) {
    c.skills.push("iron");
    return { title: "체질 개선", tone: "event", lines: ["꾸준한 관리로 몸이 단단해졌다. 「강철 몸」 획득!"], delta: diffOf(c, a) };
  }
  return;
}

export type Action = { kind: "train"; key: TrainKey } | { kind: "rest" } | { kind: "outing"; char: CharId };

export function canAct(c: Career, a: Action) {
  if (stepOf(c) !== "turn") return false;
  if (c.injury) return a.kind === "rest";
  return true;
}

/** 턴 행동 하나 */
export function act(c: Career, a: Action): TurnOut {
  if (!canAct(c, a)) throw new Error("지금은 그 행동을 할 수 없음");
  const rng = turnRng(c);
  const out = a.kind === "train" ? train(c, a.key, rng) : a.kind === "rest" ? rest(c, rng) : outing(c, a.char, rng);
  const ev = out.extra ?? (out.tone === "injury" ? undefined : randomEvent(c, rng));
  if (ev) out.extra = ev;
  pushLog(c, out.title, ...(out.extra ? [out.extra.title] : []));
  endTurn(c);
  return out;
}

/** 고르기 이벤트 답 */
export function choose(c: Career, pick: 0 | 1): TurnOut {
  const p = c.pending;
  if (!p) throw new Error("고를 이벤트 없음");
  const rng = turnRng(c, 7);
  const a = snap(c);
  c.pending = null;
  const lines: string[] = [];
  let tone: TurnOut["tone"] = "event";
  if (p.kind === "bond") {
    const b = BONDS[p.char!];
    if (pick === 0) {
      grow(c, b.stat, 22);
      addStamina(c, -15);
      lines.push("같이 땀을 흘렸다. 확 늘었다!");
    } else {
      addStamina(c, 15);
      addCond(c, 1);
      lines.push("편하게 이야기를 나눴다. 마음이 가벼워졌다.");
    }
  } else if (p.kind === "coach") {
    if (pick === 0) {
      if (rng() < injuryP(c) * 1.5) {
        lines.push(...hurt(c, rng, c.stamina < 25));
        tone = "injury";
      } else {
        const k = lowestFocus(c);
        grow(c, k, BASE_GAIN * 2.2);
        addStamina(c, -25);
        addTrust(c, 6);
        lines.push(`밤새 ${STAT_NAME[k]} 특훈! 감독이 흐뭇해한다.`);
      }
    } else {
      addTrust(c, -2);
      addStamina(c, 5);
      lines.push("감독이 조금 아쉬워한다.");
    }
  } else if (p.kind === "night") {
    if (pick === 0) {
      const k = rng.pick(STAT_KEYS);
      grow(c, k, BASE_GAIN * 0.9);
      addStamina(c, -14);
      addTrust(c, 2);
      lines.push(`${STAT_NAME[k]} 자율 훈련 완료.`);
    } else {
      addStamina(c, 15);
      lines.push("푹 잤다.");
    }
  } else if (p.kind === "press") {
    if (pick === 0) {
      addTrust(c, 3);
      lines.push("겸손한 인터뷰 — 감독 평가가 조금 올랐다.");
    } else if (rng() < 0.5) {
      addCond(c, 1);
      addTrust(c, 6);
      lines.push("자신감 넘치는 인터뷰가 화제! 컨디션 ↑");
    } else {
      addTrust(c, -4);
      lines.push("건방지다는 기사가 났다… 감독 평가 ↓");
    }
  }
  pushLog(c, `${p.title}: ${p.choices[pick]}`);
  return { title: p.title, tone, lines, delta: diffOf(c, a) };
}

/** 타입에서 가장 중요한 능력치 중 낮은 것 */
function lowestFocus(c: Career): StatKey {
  const apt = TYPES[c.type].apt;
  return [...STAT_KEYS].sort((a, b) => c.stats[a] / apt[a] - c.stats[b] / apt[b])[0];
}

/** 상점 */
export function buy(c: Career, id: ItemId): string {
  const it = ITEMS[id];
  if (c.money < it.price) return "자금이 모자라요";
  if (it.gear && c.gear.includes(id)) return "이미 있어요";
  c.money -= it.price;
  if (it.gear) c.gear.push(id);
  else c.bag[id] = (c.bag[id] ?? 0) + 1;
  return `${it.name} 구입`;
}
export function consumeItem(c: Career, id: ItemId): string {
  if (!(c.bag[id] ?? 0)) return "없어요";
  if (id === "rehab" && !c.injury) return "부상일 때만 써요";
  if (id === "charm" && c.charmNext) return "이미 썼어요";
  c.bag[id]! -= 1;
  if (id === "drink") addStamina(c, 30);
  if (id === "food") {
    addCond(c, 1);
    addStamina(c, 10);
  }
  if (id === "charm") c.charmNext = true;
  if (id === "rehab" && c.injury) c.injury.left = Math.max(1, Math.ceil(c.injury.left / 2));
  return `${ITEMS[id].name} 사용`;
}

/* ─────────────── 경기 ─────────────── */

export interface GameIn {
  line: BatLine;
  win: boolean | null;
  missionPt: number;
  /** 돌발미션 성공 수 */
  missions: number;
  /** 직접 쳤나 (자동이면 false) */
  direct: boolean;
}
/** 경기 평가 S ~ D (성장 배율) */
export const GAME_GRADES = [
  { g: "S", xp: 1.7, color: "#ff7ae0" },
  { g: "A", xp: 1.3, color: "#ffcf4a" },
  { g: "B", xp: 1.0, color: "#7dff9a" },
  { g: "C", xp: 0.65, color: "#7ad7ff" },
  { g: "D", xp: 0.35, color: "#9a9a9a" },
] as const;
export function gameGrade(l: BatLine, missions: number) {
  const singles = l.h - l.d2 - l.d3 - l.hr;
  const sc = singles + l.d2 * 1.6 + l.d3 * 2 + l.hr * 3 + l.bb * 0.5 + l.rbi * 0.5 + missions - l.k * 0.3;
  return sc >= 4.5 ? 0 : sc >= 3 ? 1 : sc >= 1.8 ? 2 : sc >= 0.9 ? 3 : 4;
}

export interface GameSummary {
  title: string;
  lines: string[];
  delta: Delta;
  dnp: boolean;
}

/** 이번 주 경기에 나가나 (부상이면 못 나감) */
export const canPlay = (c: Career) => !c.injury;

/** 경기 결과 반영 (출전 못 했으면 line 없이) */
export function applyGame(c: Career, g: GameIn | null): GameSummary {
  if (stepOf(c) !== "game") throw new Error("경기 차례 아님");
  const a = snap(c);
  const rng = turnRng(c, 3);
  const lines: string[] = [];
  let title: string;
  const win = g ? g.win : rng() < 0.5;
  if (win === true) c.wins++;
  else if (win === false) c.losses++;
  if (!g) {
    title = `결장 (${INJURY_NAME[c.injury?.kind ?? 0]}) · 팀 ${win ? "승리" : win === false ? "패배" : "무승부"}`;
    lines.push("벤치에서 동료들을 응원했다.");
    addTrust(c, -1);
    addStamina(c, 10);
  } else {
    const l = g.line;
    const L = c.line;
    L.g++;
    for (const k of ["pa", "ab", "h", "d2", "d3", "hr", "rbi", "bb", "k", "r"] as const) L[k] += l[k];
    const singles = l.h - l.d2 - l.d3 - l.hr;
    // 경험치 → 능력치
    const xp: Stats = {
      hit: singles * 8 + l.d2 * 6 + l.d3 * 5 + l.hr * 4 + l.bb * 3 + (l.ab - l.h) * 0.4 + 1,
      power: l.d2 * 6 + l.hr * 16 + 1,
      run: l.d3 * 8 + l.d2 * 3 + l.r * 3 + 1.5,
      def: 3,
    };
    // 경기 평가 — 잘 칠수록 성장 배율이 커짐 (직접 친 실력이 크게 남게)
    const grade = gameGrade(l, g.missions);
    for (const k of STAT_KEYS) grow(c, k, xp[k] * TUNE.gameXp * GAME_GRADES[grade].xp);
    // 감독 신뢰
    const tr = l.h * 2.5 + l.hr * 4 + l.rbi * 1 + l.bb * 1 - l.k * 1.5 - Math.max(0, l.ab - l.h - l.k) * 1.2 + g.missions * 4 - 0.5;
    addTrust(c, tr);
    addStamina(c, -10);
    // 컨디션: 잘 치면 ↑ 못 치면 ↓
    if (grade <= 1) addCond(c, 1);
    else if (grade === 4 && rng() < 0.5) addCond(c, -1);
    // 수당 (만원)
    c.money += 20 + l.h * 10 + l.hr * 25 + l.rbi * 5 + Math.round(g.missionPt / 2) + (win ? 15 : 0);
    title = `[${GAME_GRADES[grade].g}] ${l.ab}타수 ${l.h}안타${l.hr ? ` ${l.hr}홈런` : ""}${l.rbi ? ` ${l.rbi}타점` : ""}${l.bb ? ` ${l.bb}볼넷` : ""} · 팀 ${win ? "승리" : win === false ? "패배" : "무승부"}`;
    if (l.hr >= 2) lines.push("멀티 홈런! 오늘의 주인공.");
    else if (l.h >= 3) lines.push("맹타! 감독이 엄지를 들었다.");
    else if (l.h === 0) lines.push("오늘은 안 풀렸다…");
    if (g.missions) lines.push(`돌발미션 ${g.missions}개 성공!`);
    // 경기 중 부상 (드묾 · 지쳐 있으면 ↑)
    if (rng() < (c.stamina < 20 ? 0.05 : 0.008) * (hasGp(c, "medic") ? 0.65 : 1)) lines.push(...hurt(c, rng, false));
  }
  c.lastGame = title;
  pushLog(c, `${c.week + 1}주차 경기: ${title}`);
  c.turn++;
  c.week++;
  c.slot = 0;
  if (c.injury) {
    c.injury.left--;
    if (c.injury.left <= 0) c.injury = null;
  }
  if (c.week >= WEEKS) c.phase = "seasonEnd";
  return { title, lines, delta: diffOf(c, a), dnp: !g };
}

/* ─────────────── 시즌 결산 · 은퇴 ─────────────── */

export const avg = (l: { h: number; ab: number }) => (l.ab ? l.h / l.ab : 0);
export const fmtAvg = (v: number) => v.toFixed(3).replace(/^0/, "");
export const ops = (l: BatLine) => {
  const obp = l.pa ? (l.h + l.bb) / l.pa : 0;
  const tb = l.h + l.d2 + l.d3 * 2 + l.hr * 3;
  return obp + (l.ab ? tb / l.ab : 0);
};

export interface SeasonSummary {
  season: number;
  line: SeasonRec["line"];
  awards: string[];
  lines: string[];
  salary: number;
  prevSalary: number;
  talentReveal?: string;
  retire: boolean;
}

export function endSeason(c: Career): SeasonSummary {
  if (c.phase !== "seasonEnd") throw new Error("시즌 결산 차례 아님");
  const rng = turnRng(c, 11);
  const L = c.line;
  const awards: string[] = [];
  const lines: string[] = [];
  const pa = L.pa;
  // 리그 1위 기록은 해마다 조금씩 다름 (10경기 시즌 기준)
  if (pa >= 25 && avg(L) >= 0.37 + rng() * 0.06) awards.push("타격왕");
  if (L.hr >= 6 + Math.floor(rng() * 4)) awards.push("홈런왕");
  if (L.rbi >= 16 + Math.floor(rng() * 6)) awards.push("타점왕");
  if (c.season === 1 && pa >= 15 && ops(L) >= 0.78) awards.push("신인왕");
  if (awards.length >= 2 || (pa >= 22 && ops(L) >= 1.05)) awards.push("MVP");
  if (awards.length) {
    addTrust(c, 6 * awards.length);
    c.money += 120 * awards.length;
    lines.push(`수상: ${awards.join(" · ")}`);
  }
  const ovr = ovrOf(c);
  const prev = c.salary;
  const perf = pa ? clamp(ops(L) - 0.6, -0.3, 0.7) : -0.2;
  c.salary = Math.max(2700, Math.round((3000 + ovr * 14 + perf * 6000 + awards.length * 2500) / 100) * 100);
  c.money += Math.round(c.salary / 10);
  lines.push(`연봉 ${prev.toLocaleString()} → ${c.salary.toLocaleString()}만원 (자금 +${Math.round(c.salary / 10)}만원)`);
  let talentReveal: string | undefined;
  if (!c.talentKnown) {
    c.talentKnown = true;
    talentReveal = TALENTS[c.talent].g;
    lines.push(`스카우트 평가: 숨은 재능 ${talentReveal}급`);
  }
  const rec: SeasonRec = { season: c.season, line: { ...L }, awards, ovr, salary: c.salary };
  c.seasons.push(rec);
  for (const k of ["g", "pa", "ab", "h", "d2", "d3", "hr", "rbi", "bb", "k", "r"] as const) c.total[k] += L[k];
  c.line = emptyLine();
  c.turn++;
  const retire = c.season >= SEASONS;
  if (retire) c.phase = "retired";
  else {
    c.phase = "off";
    c.slot = 0;
    c.week = 0;
    // 비시즌엔 체력 회복
    c.stamina = Math.max(c.stamina, 70);
  }
  pushLog(c, `${c.season}년차 결산 — 종합 ${ovr}${awards.length ? ` · ${awards.join(" · ")}` : ""}`);
  return { season: c.season, line: rec.line, awards, lines, salary: c.salary, prevSalary: prev, talentReveal, retire };
}

/** 은퇴 요약 (별명 · 등급 · 상위 %) */
export function retireCard(c: Career) {
  const ovr = ovrOf(c);
  const t = c.total;
  const nick: string[] = [];
  const awards = c.seasons.flatMap((s) => s.awards);
  const cnt = (a: string) => awards.filter((x) => x === a).length;
  if (cnt("MVP") >= 2) nick.push("리그의 지배자");
  if (cnt("홈런왕") >= 2 || t.hr >= 30) nick.push("홈런 공장");
  if (cnt("타격왕") >= 2 || (t.ab >= 100 && avg(t) >= 0.33)) nick.push("안타 제조기");
  if (t.rbi >= 70) nick.push("해결사");
  if (c.stats.run >= 800) nick.push("바람의 아들");
  if (c.stats.def >= 800) nick.push("수비의 신");
  if (c.awakened) nick.push("각성자");
  if (c.learned) nick.push(`${charById(c.learned).name}의 제자`);
  if (!nick.length) nick.push(ovr >= 500 ? "성실한 프로" : "만년 유망주");
  return { ovr, grade: gradeOf(ovr), top: topPct(ovr), nick, awards, total: t };
}

/* ─────────────── 명예의 전당 (프로토: 이 브라우저) ─────────────── */

export interface HofEntry {
  id: string;
  name: string;
  type: BatType;
  ovr: number;
  grade: string;
  nick: string;
  stats: Stats;
  hr: number;
  avg: number;
  at: number;
  gp: number;
}
export function hofEntry(c: Career): HofEntry {
  const r = retireCard(c);
  const st = {} as Stats;
  for (const k of STAT_KEYS) st[k] = Math.round(c.stats[k]);
  return { id: c.id, name: c.name, type: c.type, ovr: r.ovr, grade: r.grade.g, nick: r.nick[0], stats: st, hr: c.total.hr, avg: avg(c.total), at: Date.now(), gp: c.gp.length };
}

/* ─────────────── 봇 육성 (자동 진행 · 밸런스 시뮬) ─────────────── */

export interface Policy {
  /** 이 체력 아래면 쉼 (낮을수록 무리) */
  restBelow: number;
  /** 외출 비율 */
  outing: number;
  /** 주력 능력치 몰빵 정도 0 ~ 1 */
  focus: number;
  /** 상점 · 아이템을 쓰나 */
  shop: boolean;
  /** 이벤트에서 무리하는 쪽 고를 확률 */
  bold: number;
}
export const POLICY_AVG: Policy = { restBelow: 40, outing: 0.15, focus: 0.6, shop: true, bold: 0.5 };

/** 봇이 이번 턴에 할 일 */
export function botAction(c: Career, pol: Policy, rng: Rng): Action {
  if (c.injury) return { kind: "rest" };
  if (c.stamina < pol.restBelow) return rng() < 0.75 ? { kind: "rest" } : { kind: "outing", char: botChar(c, rng) };
  if (rng() < pol.outing || (c.cond <= 1 && rng() < 0.5)) return { kind: "outing", char: botChar(c, rng) };
  const apt = TYPES[c.type].apt;
  let key: TrainKey;
  if (rng() < pol.focus) {
    const best = [...STAT_KEYS].sort((a, b) => apt[b] - apt[a])[0];
    key = best === "hit" || best === "power" ? (rng() < 0.3 ? "combo" : best) : best;
    if (c.type === "all") key = rng.pick(TRAIN_KEYS);
  } else key = rng.pick(TRAIN_KEYS);
  return { kind: "train", key };
}
function botChar(c: Career, rng: Rng): CharId {
  // 진행 중인 인연을 이어 가는 편
  const going = CHARS.map((x) => x.id).filter((id) => (c.bonds[id] ?? 0) > 0 && (c.bonds[id] ?? 0) < BOND_AT[3]);
  if (going.length && rng() < 0.8) return rng.pick(going);
  const fit = CHARS.map((x) => x.id).filter((id) => TYPES[c.type].apt[BONDS[id].stat] >= 1);
  return rng.pick(fit.length ? fit : CHARS.map((x) => x.id));
}
export function botShop(c: Career) {
  const want: ItemId[] = [];
  const best = [...STAT_KEYS].sort((a, b) => TYPES[c.type].apt[b] - TYPES[c.type].apt[a])[0];
  const gearFor: Record<StatKey, ItemId> = { hit: "bat", power: "dumbbell", run: "spike", def: "glove" };
  if (!c.gear.includes(gearFor[best])) want.push(gearFor[best]);
  for (const id of want) buy(c, id);
  if (c.injury && c.injury.left >= 4 && c.money >= ITEMS.rehab.price) {
    buy(c, "rehab");
    consumeItem(c, "rehab");
  }
  while (c.stamina < 45 && c.money >= ITEMS.drink.price + 200) {
    buy(c, "drink");
    consumeItem(c, "drink");
  }
  if (c.bag.charm && !c.charmNext) consumeItem(c, "charm");
}
