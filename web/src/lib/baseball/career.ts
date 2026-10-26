/**
 * 육성 모드 (타자편) — 나만의 선수 한 명을 최대 10년 키우고 은퇴시키기 (게임빌 프로야구 「나만의 리그」 방식).
 *
 * 한 해: 스프링캠프(턴 3) → 시즌 30경기 (2경기마다 관리 턴 1, 15주) → 시즌 결산(수상 · 연봉 · 특수능력 고르기) → 비시즌(턴 2)
 *   7년차 결산부터 은퇴를 고를 수 있고 10년차엔 은퇴. 19세 입단 → 28세, 8년차부터 노쇠.
 * 관리 턴은 시내 지도에서 장소 하나: 운동장(훈련 4종 + 필살타법 훈련) · 숙소(휴식 · 개인정비) · 병원 · 쇼핑몰(상점, 턴 안 씀) ·
 *   외출 장소(번화가 · 공원 · 강변 · 도서관 · 방송국) — 이번 주에 나타난 픽셀파이트 캐릭터(❗)나 장소 이벤트만 만날 수 있음.
 * 로그라이크 양념: 특수능력은 3장 중 1장 고르기(시즌 끝 · S 평가 · 도서관 퀴즈) · 같은 태그 3장이면 세트 효과 · 양날 카드.
 *
 * 결과 분포(종합 0 ~ 999)는 넓게: 중앙값 ~500 · 하위 10% ~250 · 상위 3% 800+ (scripts/baseball-career-sim.ts 로 확인)
 *   흔들림 세 갈래 — 운(숨은 재능 · 대성공 · 부상 · 각성 · 고르기 패) · 선택(훈련 몰빵 · 체력 관리 · 인연 · 상점 · 은퇴 시점) · 실력(직접 친 타석)
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

/** 숨은 재능 — 1시즌 끝 스카우트 평가에서 공개. 성장 속도(mul) + 한계(limit, 가까울수록 덜 오름). SS 는 각성으로만 */
export const TALENTS = [
  { g: "F", w: 0.08, mul: 0.6, limit: 230 },
  { g: "D", w: 0.17, mul: 0.75, limit: 380 },
  { g: "C", w: 0.3, mul: 0.88, limit: 720 },
  { g: "B", w: 0.27, mul: 1.0, limit: 880 },
  { g: "A", w: 0.13, mul: 1.3, limit: 1060 },
  { g: "S", w: 0.05, mul: 1.4, limit: 1090 },
  { g: "SS", w: 0, mul: 1.65, limit: 1300 },
] as const;

/* ─────────────── 일정 ─────────────── */

export const MAX_SEASONS = 10;
/** 이 연차 결산부터 은퇴를 고를 수 있음 */
export const RETIRE_FROM = 7;
export const GAMES = 30;
export const GAMES_PER_WEEK = 2;
export const WEEKS = GAMES / GAMES_PER_WEEK;
export const CAMP_TURNS = 3;
export const OFF_TURNS = 2;
const START_AGE = 19;
/** 연차별 성장 배율 (전성기 3~5년차 · 8년차부터 둔해짐) */
const AGE_GROW = [1.0, 1.05, 1.12, 1.12, 1.12, 1.06, 1.0, 0.88, 0.76, 0.64];

/* ─────────────── 훈련 ─────────────── */

export type TrainKey = "hit" | "power" | "run" | "def" | "special";
export const TRAINS: Record<TrainKey, { name: string; desc: string; cost: number; gain: Partial<Stats> }> = {
  hit: { name: "타격 훈련", desc: "맞히기 ↑ (파워 조금)", cost: 18, gain: { hit: 1, power: 0.18 } },
  power: { name: "근력 훈련", desc: "파워 ↑ (맞히기 조금)", cost: 22, gain: { power: 1, hit: 0.15 } },
  run: { name: "주루 훈련", desc: "주루 ↑ (수비 조금)", cost: 19, gain: { run: 1, def: 0.22 } },
  def: { name: "수비 훈련", desc: "수비 ↑ (주루 조금)", cost: 16, gain: { def: 1, run: 0.2 } },
  special: { name: "필살타법 훈련", desc: "필살 레벨 ↑ (경기당 횟수 · 종합) — 배운 뒤에만", cost: 26, gain: { hit: 0.25, power: 0.25 } },
};
export const TRAIN_KEYS: TrainKey[] = ["hit", "power", "run", "def", "special"];
/** 훈련 한 번 기본 성장 (재능 · 타입 · 컨디션 · 높을수록 덜 오름 반영 전) */
export const BASE_GAIN = 3.3;
/** 밸런스 손잡이 (시뮬에서 바꿔 보기) */
export const TUNE = { gameXp: 0.21, train: 1 };
/** 훈련 레벨: 같은 훈련 TRAIN_LV_EVERY 번마다 +1 (최대 5) · 레벨당 효율 +10% */
export const TRAIN_LV_EVERY = 8;
/** 필살타법 레벨: 필살 훈련 SP_EVERY 번마다 +1 (최대 5) — 경기당 횟수 2 + 레벨 */
export const SP_EVERY = 3;

export const COND_NAME = ["최악", "나쁨", "보통", "좋음", "최고"] as const;
const COND_TRAIN = [0.72, 0.86, 1, 1.12, 1.25];
/** 경기 컨디션: 맞히기 · 파워 배율 */
export const COND_GAME = [0.88, 0.94, 1, 1.04, 1.08];

/* ─────────────── 특수능력 (태그 · 세트 · 양날) ─────────────── */

export type Tag = "clutch" | "contact" | "power" | "speed" | "def" | "grit" | "luck";
export const TAG_NAME: Record<Tag, string> = { clutch: "찬스", contact: "컨택", power: "파워", speed: "스피드", def: "수비", grit: "근성", luck: "행운" };
export const TAG_COLOR: Record<Tag, string> = { clutch: "#ff7a5c", contact: "#7dff9a", power: "#ff5a5a", speed: "#7ad7ff", def: "#ffd23f", grit: "#c9a2ff", luck: "#ff7ae0" };

/** 특수능력이 주는 효과 (합쳐서 씀) */
export interface Fx {
  /** 경기에서 늘 붙는 능력치 */
  add?: Partial<Stats>;
  sit?: Batter["sit"];
  /** 그 훈련 효율 배율 (+0.15 = 15%) */
  train?: Partial<Record<TrainKey | "all", number>>;
  injury?: number;
  injuryDur?: number;
  great?: number;
  gameXp?: number;
  hrXp?: number;
  money?: number;
  fame?: number;
  awaken?: number;
  slump?: number;
  trust?: number;
  /** 컨디션이 최악까지 안 떨어짐 */
  condFloor?: boolean;
  /** 떨어지는 컨디션 폭 -1 */
  calm?: boolean;
}

export interface Skill {
  name: string;
  desc: string;
  /** 종합 점수에 더하는 값 */
  val: number;
  tag?: Tag;
  /** 양날 (좋은 점 + 나쁜 점) */
  risk?: boolean;
  /** 나쁜 것만 (이벤트로만 붙음) */
  bad?: boolean;
  /** 세트 효과 (같은 태그 3장이면 자동) */
  set?: Tag;
  /** 고르기에 안 나옴 (인연 · 이벤트 전용) */
  noPick?: boolean;
  fx: Fx;
}

export const SKILLS = {
  // 찬스
  clutch: { name: "찬스 강함", desc: "득점권에서 맞히기 +70", val: 3, tag: "clutch", fx: { sit: { rispHit: 70 } } },
  solver: { name: "해결사", desc: "득점권에서 파워 +70", val: 3, tag: "clutch", fx: { sit: { rispPow: 70 } } },
  gamer: { name: "승부사", desc: "7회부터 맞히기 · 파워 +45", val: 3, tag: "clutch", fx: { sit: { late: 45 } } },
  sk_ivan: { name: "철곰 근력", desc: "득점권에서 파워 +90", val: 4, tag: "clutch", noPick: true, fx: { sit: { rispPow: 90 } } },
  // 컨택
  precise: { name: "정교함", desc: "경기 맞히기 +40", val: 3, tag: "contact", fx: { add: { hit: 40 } } },
  study: { name: "타격 연구", desc: "타격 훈련 효율 +18%", val: 3, tag: "contact", fx: { train: { hit: 0.18 } } },
  sk_soyoung: { name: "채찍 손목", desc: "2스트라이크에서 맞히기 +90", val: 4, tag: "contact", noPick: true, fx: { sit: { twoK: 90 } } },
  sk_forte: { name: "시간 감각", desc: "경기 맞히기 +40 · 부상 기간 -30%", val: 4, tag: "contact", noPick: true, fx: { add: { hit: 40 }, injuryDur: -0.3 } },
  // 파워
  fullswing: { name: "풀스윙", desc: "경기 파워 +45", val: 3, tag: "power", fx: { add: { power: 45 } } },
  muscle: { name: "근력 체질", desc: "근력 훈련 효율 +18%", val: 3, tag: "power", fx: { train: { power: 0.18 } } },
  slugger: { name: "장타 본능", desc: "홈런 경험치 +60%", val: 3, tag: "power", fx: { hrXp: 0.6 } },
  sk_igna: { name: "업화의 힘", desc: "경기 파워 +45", val: 4, tag: "power", noPick: true, fx: { add: { power: 45 } } },
  // 스피드
  track: { name: "육상부 출신", desc: "주루 훈련 효율 +18%", val: 3, tag: "speed", fx: { train: { run: 0.18 } } },
  dash: { name: "스타트 대시", desc: "경기 주루 +45", val: 3, tag: "speed", fx: { add: { run: 45 } } },
  sk_kai: { name: "질풍 주루", desc: "경기 주루 +50", val: 4, tag: "speed", noPick: true, fx: { add: { run: 50 } } },
  // 수비
  glovework: { name: "수비 달인", desc: "수비 훈련 효율 +18%", val: 3, tag: "def", fx: { train: { def: 0.18 } } },
  arm: { name: "강견", desc: "경기 수비 +45", val: 3, tag: "def", fx: { add: { def: 45 } } },
  sk_zena: { name: "번개 반사", desc: "경기 수비 +50", val: 4, tag: "def", noPick: true, fx: { add: { def: 50 } } },
  // 근성
  grit: { name: "끈질김", desc: "2스트라이크에서 맞히기 +70", val: 3, tag: "grit", fx: { sit: { twoK: 70 } } },
  iron: { name: "강철 몸", desc: "부상 확률 -40%", val: 3, tag: "grit", fx: { injury: -0.4 } },
  bounce: { name: "오뚝이", desc: "부상 기간 -40%", val: 3, tag: "grit", fx: { injuryDur: -0.4 } },
  // 행운
  lucky: { name: "행운아", desc: "훈련 대성공 +6%", val: 3, tag: "luck", fx: { great: 0.06 } },
  star: { name: "스타성", desc: "인기도 +40%", val: 2, tag: "luck", fx: { fame: 0.4 } },
  biz: { name: "사업 수완", desc: "수당 · 연봉 자금 +30%", val: 2, tag: "luck", fx: { money: 0.3 } },
  sk_lily: { name: "평정심", desc: "컨디션이 덜 떨어짐 · 슬럼프 무시", val: 4, tag: "luck", noPick: true, fx: { calm: true, slump: -1 } },
  sk_gunmo: { name: "데이터 야구", desc: "모든 훈련 효율 +8%", val: 4, tag: "luck", noPick: true, fx: { train: { all: 0.08 } } },
  // 양날
  glass: { name: "유리 몸 천재", desc: "모든 훈련 +18% / 부상 확률 +60%", val: 2, risk: true, fx: { train: { all: 0.18 }, injury: 0.6 } },
  gambler: { name: "도박꾼", desc: "자금 +60% / 슬럼프 2배", val: 2, risk: true, fx: { money: 0.6, slump: 1 } },
  allin: { name: "한방주의", desc: "경기 파워 +80 / 경기 맞히기 -50", val: 2, risk: true, fx: { add: { power: 80, hit: -50 } } },
  cram: { name: "실전파", desc: "경기 경험치 +30% / 훈련 -15%", val: 2, risk: true, fx: { gameXp: 0.3, train: { all: -0.15 } } },
  showoff: { name: "관종", desc: "인기도 +80% / 감독 신뢰 깎임 2배", val: 2, risk: true, fx: { fame: 0.8, trust: 1 } },
  // 나쁜 것 (이벤트)
  clutchBad: { name: "찬스 약함", desc: "득점권에서 맞히기 -60", val: -6, bad: true, noPick: true, fx: { sit: { rispHit: -60 } } },
  fragile: { name: "부상 체질", desc: "부상 확률 +50%", val: -6, bad: true, noPick: true, fx: { injury: 0.5 } },
  // 세트 (같은 태그 3장)
  set_clutch: { name: "클러치 히터", desc: "찬스 세트: 득점권 맞히기 · 파워 +60", val: 8, set: "clutch", noPick: true, fx: { sit: { rispHit: 60, rispPow: 60 } } },
  set_contact: { name: "타격 기계", desc: "컨택 세트: 경기 맞히기 +60", val: 8, set: "contact", noPick: true, fx: { add: { hit: 60 } } },
  set_power: { name: "거포 각성", desc: "파워 세트: 경기 파워 +60 · 홈런 경험치 +40%", val: 8, set: "power", noPick: true, fx: { add: { power: 60 }, hrXp: 0.4 } },
  set_speed: { name: "바람의 아들", desc: "스피드 세트: 경기 주루 +80", val: 8, set: "speed", noPick: true, fx: { add: { run: 80 } } },
  set_def: { name: "골든 글러브", desc: "수비 세트: 경기 수비 +80 · 감독 신뢰 깎임 절반", val: 8, set: "def", noPick: true, fx: { add: { def: 80 }, trust: -0.5 } },
  set_grit: { name: "불굴", desc: "근성 세트: 컨디션 최악 없음 · 부상 기간 절반", val: 8, set: "grit", noPick: true, fx: { condFloor: true, injuryDur: -0.5 } },
  set_luck: { name: "럭키 가이", desc: "행운 세트: 각성 확률 3배 · 대성공 +5%", val: 8, set: "luck", noPick: true, fx: { awaken: 2, great: 0.05 } },
} satisfies Record<string, Skill>;
export type SkillId = keyof typeof SKILLS;
export const skill = (id: SkillId): Skill => SKILLS[id];
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

/** 필살타법을 배우면 종합 + (레벨당 더) */
export const LEARNED_VAL = 8;
export const SP_LV_VAL = 3;

/** 태그 장수 (세트 · 나쁜 것 · 양날 빼고) */
export function tagCount(c: Pick<Career, "skills">) {
  const n: Partial<Record<Tag, number>> = {};
  for (const id of c.skills) {
    const s = skill(id);
    if (s.tag && !s.set) n[s.tag] = (n[s.tag] ?? 0) + 1;
  }
  return n;
}

/** 특수능력 효과 합 */
export function fxOf(c: Pick<Career, "skills">) {
  const f = {
    add: { hit: 0, power: 0, run: 0, def: 0 } as Stats,
    sit: {} as NonNullable<Batter["sit"]>,
    train: { hit: 0, power: 0, run: 0, def: 0, special: 0, all: 0 } as Record<TrainKey | "all", number>,
    injury: 0, injuryDur: 0, great: 0, gameXp: 0, hrXp: 0, money: 0, fame: 0, awaken: 0, slump: 0, trust: 0, condFloor: false, calm: false,
  };
  for (const id of c.skills) {
    const x = skill(id).fx;
    for (const k of STAT_KEYS) f.add[k] += x.add?.[k] ?? 0;
    if (x.sit) for (const [k, v] of Object.entries(x.sit) as [keyof typeof f.sit, number][]) f.sit[k] = (f.sit[k] ?? 0) + v;
    if (x.train) for (const [k, v] of Object.entries(x.train) as [TrainKey | "all", number][]) f.train[k] += v;
    f.injury += x.injury ?? 0;
    f.injuryDur += x.injuryDur ?? 0;
    f.great += x.great ?? 0;
    f.gameXp += x.gameXp ?? 0;
    f.hrXp += x.hrXp ?? 0;
    f.money += x.money ?? 0;
    f.fame += x.fame ?? 0;
    f.awaken += x.awaken ?? 0;
    f.slump += x.slump ?? 0;
    f.trust += x.trust ?? 0;
    f.condFloor ||= !!x.condFloor;
    f.calm ||= !!x.calm;
  }
  return f;
}

/** 특수능력 얻기 (세트 완성 확인) — 새로 생긴 줄 */
function gainSkill(c: Career, id: SkillId): string[] {
  if (c.skills.includes(id)) return [];
  const out = [`특수능력 「${skill(id).name}」 획득! (${skill(id).desc})`];
  // 반대되는 것 지우기
  if (id === "clutch") c.skills = c.skills.filter((s) => s !== "clutchBad");
  if (id === "iron") c.skills = c.skills.filter((s) => s !== "fragile");
  c.skills.push(id);
  const tag = skill(id).tag;
  if (tag && (tagCount(c)[tag] ?? 0) >= 3) {
    const set = `set_${tag}` as SkillId;
    if (!c.skills.includes(set)) {
      c.skills.push(set);
      out.push(`★ 세트 완성 — 「${skill(set).name}」 (${skill(set).desc})`);
    }
  }
  return out;
}

/* ─────────────── 시내 지도 ─────────────── */

export type PlaceId = "ground" | "dorm" | "hospital" | "mall" | "downtown" | "park" | "river" | "library" | "tv";
export const PLACES: Record<PlaceId, { name: string; icon: string; desc: string; x: number; y: number; spot?: boolean }> = {
  ground: { name: "운동장", icon: "🏟️", desc: "훈련 · 필살타법 훈련", x: 50, y: 30 },
  dorm: { name: "숙소", icon: "🏠", desc: "휴식 · 개인정비", x: 20, y: 30 },
  hospital: { name: "병원", icon: "🏥", desc: "치료 (부상 기간 줄이기)", x: 80, y: 30 },
  mall: { name: "쇼핑몰", icon: "🛍️", desc: "상점 (턴 안 씀)", x: 82, y: 72 },
  downtown: { name: "번화가", icon: "🌃", desc: "외식 · 만남", x: 18, y: 72, spot: true },
  park: { name: "공원", icon: "🌳", desc: "산책 · 만남", x: 36, y: 56, spot: true },
  river: { name: "강변", icon: "🌊", desc: "산책 · 만남", x: 64, y: 56, spot: true },
  library: { name: "도서관", icon: "📚", desc: "공부 · 만남", x: 36, y: 86, spot: true },
  tv: { name: "방송국", icon: "📺", desc: "방송 · 만남", x: 64, y: 86, spot: true },
};
export const PLACE_IDS = Object.keys(PLACES) as PlaceId[];
export const SPOT_IDS = PLACE_IDS.filter((p) => PLACES[p].spot);

/** 장소 이벤트 (주마다 하나쯤, 지도에 ❗) */
export type SpotEvent = "cf" | "quiz" | "volunteer" | "signing" | "secret";
export const SPOT_EVENTS: Record<SpotEvent, { name: string; place: PlaceId; desc: string }> = {
  cf: { name: "CF 촬영", place: "tv", desc: "자금 · 인기도 ↑ · 체력 -10" },
  quiz: { name: "야구 퀴즈쇼", place: "library", desc: "특수능력 3장 중 1장 고르기" },
  volunteer: { name: "야구교실 봉사", place: "park", desc: "인기도 · 감독 신뢰 · 컨디션 ↑" },
  signing: { name: "팬 사인회", place: "downtown", desc: "인기도 ↑ · 자금 조금" },
  secret: { name: "비밀 특훈", place: "river", desc: "약한 능력치 크게 ↑ · 많이 지침" },
};

/* ─────────────── 픽셀파이트 인연 ─────────────── */

export interface Bond {
  /** 잘 키워 주는 능력치 */
  stat: StatKey;
  /** 만나는 곳 분위기 (지도 장소와 별개, 대사용) */
  place: string;
  /** 단계별 대사 (1 만남 · 2 고르기 · 3 특수능력 · 4 필살 전수) */
  lines: [string, string, string, string];
  /** 2단계 고르기 */
  pick: [string, string];
}
export const BONDS: Record<CharId, Bond> = {
  kai: {
    stat: "run", place: "러닝 코스", pick: ["같이 전력 질주", "벤치에서 바람 쐬기"],
    lines: ["바람처럼 달리는 사람이 있다… 카이다.", "\"따라올 수 있으면 따라와 봐.\"", "\"발은 거짓말 안 해. 이거 하나 알려 줄게.\"", "\"이제 네 바람이야. 질풍 스윙, 써 봐.\""],
  },
  igna: {
    stat: "power", place: "뜨거운 체육관", pick: ["불꽃 웨이트 같이 하기", "땀 식히며 이야기"],
    lines: ["뜨거운 열기 — 이그나가 쇳덩이를 들고 있다.", "\"힘은 태워야 커진다.\"", "\"불꽃은 안에서부터. 이 감각 기억해.\"", "\"업화 스윙. 공까지 태워 버려.\""],
  },
  soyoung: {
    stat: "hit", place: "실내 연습장", pick: ["채찍 맞히기 특훈", "간식 먹으며 수다"],
    lines: ["채찍 소리가 난다. 소영이 공을 하나씩 쳐낸다.", "\"공은 끝까지 봐야지~\"", "\"손목이 채찍처럼! 2스트라이크 무서울 거 없어.\"", "\"채찍 스윙! 어디로 오든 닿을걸?\""],
  },
  lily: {
    stat: "def", place: "비 오는 산책로", pick: ["우산 들고 수비 연습", "같이 비 구경"],
    lines: ["우산을 쓴 릴리가 빗속에 서 있다.", "\"서두르지 않아도 돼. 둥실둥실~\"", "\"마음이 고요하면 공도 천천히 보여.\"", "\"우산 스윙… 타구가 오래오래 날 거야.\""],
  },
  zena: {
    stat: "run", place: "번개 치는 옥상", pick: ["반사 신경 훈련", "번개 구경"],
    lines: ["번쩍! 제나가 번개 사이를 뛰어다닌다.", "\"번개보다 빨리 반응해 봐!\"", "\"몸이 먼저 움직이게. 수비는 반사야.\"", "\"번개 스윙! 수비 전부 찌릿하게 해 줘.\""],
  },
  gunmo: {
    stat: "hit", place: "PC방 구석자리", pick: ["데이터 분석 같이 보기", "게임 한 판"],
    lines: ["모니터 앞의 건모. 화면에 투수 데이터가 가득하다.", "\"투수는 패턴이 있어. 다 기록돼.\"", "\"훈련도 디버깅하듯이. 효율이 다르지.\"", "\"Ctrl+A 스윙. 수비 전원 일시정지.\""],
  },
  ivan: {
    stat: "power", place: "시베리아식 사우나", pick: ["철곰 근력 훈련", "사우나에서 버티기"],
    lines: ["거대한 그림자. 이반이 통나무를 들고 있다.", "\"힘. 힘이 전부다.\"", "\"찬스에서 곰처럼. 한 방이면 된다.\"", "\"철곰 스윙. 맞으면 끝이다.\""],
  },
  forte: {
    stat: "hit", place: "시계탑 아래", pick: ["타이밍 연습", "시계 소리 듣기"],
    lines: ["째깍째깍. 포르테가 시계탑 위에 앉아 있다.", "\"타이밍이란 시간을 아는 거야.\"", "\"0.01초가 보이기 시작하면 다 맞혀.\"", "\"되감기 스윙. 한 번은 다시 칠 수 있어.\""],
  },
};

/** 인연 단계가 열리는 만남 횟수 (1 만남 · 2 고르기 · 3 특수능력 · 4 필살 전수) */
export const BOND_AT = [1, 3, 5, 8];
/** 그 단계가 열리는 최소 연차 (원작처럼 몇 년차에 열리는 이벤트) */
export const BOND_SEASON = [1, 1, 2, 3];
export const bondStage = (visits: number) => BOND_AT.filter((v) => visits >= v).length;

/* ─────────────── 상점 (경기 수당 · 연봉으로 번 자금, 단위 만원) ─────────────── */

export type ConsumableId = "drink" | "food" | "charm" | "rehab";
export const CONSUMABLES: Record<ConsumableId, { name: string; desc: string; price: number }> = {
  drink: { name: "스포츠 드링크", desc: "체력 +30", price: 150 },
  food: { name: "보양식", desc: "컨디션 +1 · 체력 +10", price: 300 },
  charm: { name: "행운의 부적", desc: "다음 훈련 대성공 확률 +25%", price: 400 },
  rehab: { name: "재활 치료", desc: "부상 남은 기간 절반", price: 600 },
};
export const CONSUMABLE_IDS = Object.keys(CONSUMABLES) as ConsumableId[];

/** 장비 4종 × 3단계 — 그 훈련 효율 + 경기 능력치. 단계마다 인기도 조건 */
export type GearId = "bat" | "dumbbell" | "spike" | "glove";
export const GEAR: Record<GearId, { name: string; stat: StatKey; train: TrainKey; tiers: [string, string, string] }> = {
  bat: { name: "배트", stat: "hit", train: "hit", tiers: ["알루미늄 배트", "카본 배트", "명장의 배트"] },
  dumbbell: { name: "웨이트 장비", stat: "power", train: "power", tiers: ["아령 세트", "파워 랙", "개인 웨이트룸"] },
  spike: { name: "스파이크", stat: "run", train: "run", tiers: ["러닝 스파이크", "경량 스파이크", "맞춤 스파이크"] },
  glove: { name: "글러브", stat: "def", train: "def", tiers: ["연습 글러브", "프로 글러브", "명품 글러브"] },
};
export const GEAR_IDS = Object.keys(GEAR) as GearId[];
export const GEAR_TIER = [
  { price: 1200, fame: 0, train: 0.1, game: 15 },
  { price: 3500, fame: 800, train: 0.2, game: 35 },
  { price: 8000, fame: 2500, train: 0.3, game: 60 },
] as const;

/* ─────────────── GP 부스트 (판마다 시작할 때 고름 · GP 몫 ≤ 30%) ─────────────── */

export type GpId = "trainer" | "charmGp" | "medic" | "camp";
export const GP_BOOSTS: Record<GpId, { name: string; desc: string; price: number }> = {
  trainer: { name: "개인 트레이너", desc: "모든 훈련 효율 +8%", price: 300 },
  charmGp: { name: "황금 부적", desc: "대성공 확률 +5% · 각성 확률 1.5배", price: 300 },
  medic: { name: "메디컬 팀", desc: "부상 확률 -35% · 부상 기간 -40%", price: 200 },
  camp: { name: "해외 전지훈련", desc: "매년 스프링캠프 턴 +1", price: 200 },
};
export const GP_IDS = Object.keys(GP_BOOSTS) as GpId[];

/* ─────────────── 상태 ─────────────── */

export interface Injury {
  kind: 0 | 1 | 2;
  /** 남은 턴 (경기도 1로 셈) */
  left: number;
}
export const INJURY_NAME = ["가벼운 부상", "부상", "큰 부상"] as const;

export type Line = BatLine & { g: number };
export interface SeasonRec {
  season: number;
  line: Line;
  awards: string[];
  ovr: number;
  salary: number;
}

export type Phase = "camp" | "season" | "seasonEnd" | "off" | "retired";

export interface Pending {
  kind: "bond" | "coach" | "night" | "press";
  char?: CharId;
  title: string;
  text: string;
  choices: [string, string];
}
export interface PickState {
  /** 어디서 생긴 고르기 (화면 제목) */
  from: string;
  options: SkillId[];
}

export interface Career {
  v: 2;
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
  /** 필살타법 훈련 횟수 (레벨 = 1 + 횟수 / SP_EVERY) */
  spXp: number;
  stamina: number;
  cond: number;
  trust: number;
  fame: number;
  money: number;
  salary: number;
  tCount: Record<TrainKey, number>;
  gear: Partial<Record<GearId, number>>;
  bag: Partial<Record<ConsumableId, number>>;
  /** 이번 턴에 소모품을 썼나 (턴마다 하나) */
  usedItem: boolean;
  charmNext: boolean;
  bonds: Partial<Record<CharId, number>>;
  injury: Injury | null;
  awakened: boolean;
  gp: GpId[];
  phase: Phase;
  season: number;
  week: number;
  /** 이번 구간(캠프 · 비시즌)에서 쓴 턴 / 시즌 주에선 0 = 관리 턴 차례 · 1 = 경기 차례 */
  slot: number;
  /** 이번 주 몇 번째 경기 (0 · 1) */
  gameInWeek: number;
  turn: number;
  line: Line;
  total: Line;
  seasons: SeasonRec[];
  wins: number;
  losses: number;
  /** 고르기가 남은 이벤트 */
  pending: Pending | null;
  /** 특수능력 3장 중 1장 고르기 */
  pick: PickState | null;
  /** 은퇴할지 물어보는 중 (7년차 결산부터) */
  askRetire: boolean;
  /** 「오늘의 MVP」 고르기 받은 수 (커리어 3번까지) */
  mvpPicks: number;
  log: string[];
  /** 직접 출전 중 (나가거나 새로고침하면 자동 결과로 반영 — 다시 하기 방지) */
  inGame?: boolean;
}

const emptyLine = (): Line => ({ g: 0, pa: 0, ab: 0, h: 0, d2: 0, d3: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0 });

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
    v: 2,
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
    spXp: 0,
    stamina: 100,
    cond: 2,
    trust: 20,
    fame: 0,
    money: 1000,
    salary: 3000,
    tCount: { hit: 0, power: 0, run: 0, def: 0, special: 0 },
    gear: {},
    bag: {},
    usedItem: false,
    charmNext: false,
    bonds: {},
    injury: null,
    awakened: false,
    gp: o.gp ?? [],
    phase: "camp",
    season: 1,
    week: 0,
    slot: 0,
    gameInWeek: 0,
    turn: 0,
    line: emptyLine(),
    total: emptyLine(),
    seasons: [],
    wins: 0,
    losses: 0,
    pending: null,
    pick: null,
    askRetire: false,
    mvpPicks: 0,
    log: ["프로 입단! 스프링캠프가 시작됐다."],
  };
}

/* ─────────────── 계산 ─────────────── */

export const age = (c: Career) => START_AGE + c.season - 1;
export const talentName = (c: Career) => (c.talentKnown ? TALENTS[c.talent].g : "?");
export const trainLv = (c: Career, k: TrainKey) => Math.min(5, 1 + Math.floor(c.tCount[k] / TRAIN_LV_EVERY));
export const spLv = (c: Career) => (c.learned ? Math.min(5, 1 + Math.floor(c.spXp / SP_EVERY)) : 0);
/** 경기당 필살타법 횟수 */
export const spUses = (c: Career) => (c.learned ? 2 + spLv(c) : 0);

export function ovrOf(c: Pick<Career, "stats" | "skills" | "learned" | "spXp">) {
  const s = c.stats;
  let v = ((s.hit + s.power) * 1.05 + (s.run + s.def) * 0.95) / 4;
  for (const id of c.skills) v += skill(id).val;
  if (c.learned) v += LEARNED_VAL + (Math.min(5, 1 + Math.floor((c.spXp ?? 0) / SP_EVERY)) - 1) * SP_LV_VAL;
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
/** 능력치 하나 → 등급 글자 (게임빌식 S ~ G) */
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
  [950, 0.005], [900, 0.01], [850, 0.045], [800, 0.075], [750, 0.115], [700, 0.16], [650, 0.255], [600, 0.365], [550, 0.48],
  [500, 0.585], [450, 0.66], [400, 0.73], [350, 0.86], [300, 0.91], [250, 0.995], [0, 1],
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
const hasGp = (c: Career, id: GpId) => c.gp.includes(id);
const ageGrow = (c: Career) => AGE_GROW[Math.min(AGE_GROW.length - 1, c.season - 1)];

/** 능력치 올리기 (재능 · 타입 · 나이 · 높을수록 덜) — 실제 오른 값 */
function grow(c: Career, k: StatKey, base: number): number {
  const before = c.stats[k];
  const g = base * TALENTS[c.talent].mul * TYPES[c.type].apt[k] * ageGrow(c) * dim(c, before);
  c.stats[k] = clamp(before + g, 1, 999);
  return c.stats[k] - before;
}

/** 경기에 나갈 내 선수 (컨디션 · 특수능력 · 장비 · 체력 반영) */
export function careerBatter(c: Career): Batter {
  const f = COND_GAME[c.cond] * (c.stamina < 20 ? 0.9 : 1);
  const fx = fxOf(c);
  const gear = { hit: 0, power: 0, run: 0, def: 0 } as Stats;
  for (const id of GEAR_IDS) {
    const t = c.gear[id];
    if (t) gear[GEAR[id].stat] += GEAR_TIER[t - 1].game;
  }
  const v = (k: StatKey, scale: number) => Math.round(clamp(c.stats[k] * scale + fx.add[k] + gear[k], 1, 999));
  return {
    name: c.name,
    num: c.num,
    pos: TYPES[c.type].pos,
    bats: c.bats,
    hit: v("hit", f),
    power: v("power", f),
    run: v("run", 1),
    def: v("def", 1),
    learned: c.learned,
    sit: fx.sit,
  };
}

/* ─────────────── 진행 ─────────────── */

export type Step = "turn" | "game" | "seasonEnd" | "retired" | "pending" | "pick" | "retireAsk";
export function stepOf(c: Career): Step {
  if (c.phase === "retired") return "retired";
  if (c.pending) return "pending";
  if (c.pick) return "pick";
  if (c.askRetire) return "retireAsk";
  if (c.phase === "seasonEnd") return "seasonEnd";
  if (c.phase === "season" && c.slot >= 1) return "game";
  return "turn";
}

const campTurns = (c: Career) => CAMP_TURNS + (hasGp(c, "camp") ? 1 : 0);
/** 지금 구간 설명 */
export function whenText(c: Career) {
  if (c.phase === "camp") return `${c.season}년차 스프링캠프 ${c.slot + 1}/${campTurns(c)}`;
  if (c.phase === "off") return `${c.season}년차 비시즌 ${c.slot + 1}/${OFF_TURNS}`;
  if (c.phase === "season") {
    const g = c.week * GAMES_PER_WEEK + c.gameInWeek + 1;
    return c.slot >= 1 ? `${c.season}년차 ${g}/${GAMES}경기` : `${c.season}년차 ${c.week + 1}주차 관리`;
  }
  if (c.phase === "seasonEnd") return `${c.season}년차 시즌 결산`;
  return "은퇴";
}
/** 이번 시즌 몇 경기째 (0 부터) */
export const gameNo = (c: Career) => c.week * GAMES_PER_WEEK + c.gameInWeek;

function turnRng(c: Career, salt = 0) {
  return makeRng((c.seed * 2654435761 + c.turn * 40503 + salt * 977 + 12345) >>> 0);
}

function pushLog(c: Career, ...lines: string[]) {
  c.log = [...lines, ...c.log].slice(0, 40);
}

function tickInjury(c: Career) {
  if (!c.injury) return;
  c.injury.left--;
  if (c.injury.left <= 0) {
    c.injury = null;
    pushLog(c, "부상에서 돌아왔다!");
  }
}

/** 턴 끝 → 다음 구간으로 */
function endTurn(c: Career) {
  c.turn++;
  c.slot++;
  c.usedItem = false;
  tickInjury(c);
  if (c.phase === "camp" && c.slot >= campTurns(c)) {
    c.phase = "season";
    c.slot = 0;
    c.week = 0;
    c.gameInWeek = 0;
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
  fame: number;
}
export interface TurnOut {
  title: string;
  tone: "great" | "ok" | "fail" | "injury" | "event" | "awaken";
  lines: string[];
  delta: Delta;
  /** 이어서 일어난 이벤트 */
  extra?: TurnOut;
  /** 고르기 이벤트를 알리기만 함 (화면은 바로 고르기 창) */
  stub?: boolean;
  /** 이 결과에 나온 캐릭터 (얼굴) */
  char?: CharId;
}

function snap(c: Career) {
  return { stats: { ...c.stats }, stamina: c.stamina, cond: c.cond, trust: c.trust, money: c.money, fame: c.fame };
}
function diffOf(c: Career, a: ReturnType<typeof snap>): Delta {
  const stats: Partial<Stats> = {};
  for (const k of STAT_KEYS) {
    const d = Math.round(c.stats[k]) - Math.round(a.stats[k]);
    if (d) stats[k] = d;
  }
  return { stats, stamina: Math.round(c.stamina - a.stamina), cond: c.cond - a.cond, trust: Math.round(c.trust - a.trust), money: c.money - a.money, fame: Math.round(c.fame - a.fame) };
}

function addCond(c: Career, d: number) {
  const fx = fxOf(c);
  if (d < 0 && fx.calm) d += 1;
  c.cond = clamp(c.cond + d, fx.condFloor ? 1 : 0, 4);
}
const addStamina = (c: Career, d: number) => (c.stamina = clamp(c.stamina + d, 0, 100));
function addTrust(c: Career, d: number) {
  if (d < 0) d *= 1 + fxOf(c).trust;
  c.trust = clamp(c.trust + d, 0, 100);
}
function addFame(c: Career, d: number) {
  c.fame = Math.max(0, c.fame + d * (d > 0 ? 1 + fxOf(c).fame : 1));
}
function addMoney(c: Career, d: number) {
  c.money += Math.round(d * (d > 0 ? 1 + fxOf(c).money : 1));
}

function injuryP(c: Career) {
  let p = c.stamina < 40 ? 0.012 + ((40 - c.stamina) / 40) * 0.24 : 0.008;
  p *= Math.max(0.2, 1 + fxOf(c).injury);
  if (hasGp(c, "medic")) p *= 0.65;
  return p;
}

function hurt(c: Career, rng: Rng, worse: boolean): string[] {
  let r = rng();
  if (worse) r *= 0.6;
  const kind: Injury["kind"] = r < 0.12 ? 2 : r < 0.42 ? 1 : 0;
  let left = [2, 5, 11][kind];
  if (hasGp(c, "medic")) left *= 0.6;
  left *= Math.max(0.3, 1 + fxOf(c).injuryDur);
  left = Math.max(1, Math.round(left));
  c.injury = { kind, left };
  const out = [`${INJURY_NAME[kind]}! ${left}턴 동안 쉬어야 한다. (경기도 1턴으로 셈)`];
  if (kind >= 1) {
    const loss = kind === 2 ? 0.06 : 0.02;
    for (const k of STAT_KEYS) c.stats[k] *= 1 - loss;
    out.push(`능력치가 ${Math.round(loss * 100)}% 떨어졌다…`);
  }
  if (kind === 2) {
    addTrust(c, -10);
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
  const fx = fxOf(c);
  return {
    injury: injuryP(c),
    fail: clamp(0.05 + (Math.max(0, 50 - c.stamina) / 50) * 0.3, 0, 0.5),
    great: 0.09 + c.cond * 0.025 + (c.charmNext ? 0.25 : 0) + (hasGp(c, "charmGp") ? 0.05 : 0) + fx.great,
  };
}

/** 그 훈련 효율 배율 (레벨 · 장비 · 특수능력 · GP) */
export function trainMul(c: Career, k: TrainKey) {
  const fx = fxOf(c);
  const gear = GEAR_IDS.find((g) => GEAR[g].train === k);
  const tier = gear ? c.gear[gear] ?? 0 : 0;
  return (
    (1 + (trainLv(c, k) - 1) * 0.1) *
    (1 + (tier ? GEAR_TIER[tier - 1].train : 0)) *
    Math.max(0.3, 1 + fx.train[k] + fx.train.all) *
    (hasGp(c, "trainer") ? 1.08 : 1)
  );
}

/** 훈련 */
function train(c: Career, k: TrainKey, rng: Rng): TurnOut {
  const t = TRAINS[k];
  const a = snap(c);
  const lines: string[] = [];
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
  const mul = (tone === "fail" ? 0.3 : tone === "great" ? 2 : 1) * COND_TRAIN[c.cond] * trainMul(c, k) * (0.85 + rng() * 0.3);
  for (const [sk, w] of Object.entries(t.gain) as [StatKey, number][]) grow(c, sk, BASE_GAIN * w * mul * TUNE.train);
  addStamina(c, -t.cost);
  c.tCount[k]++;
  if (k === "special") {
    const before = spLv(c);
    c.spXp += tone === "great" ? 2 : tone === "fail" ? 0 : 1;
    if (spLv(c) > before) lines.push(`필살타법 레벨 ${spLv(c)}! 경기당 ${spUses(c)}번`);
  } else if (c.tCount[k] % TRAIN_LV_EVERY === 0 && c.tCount[k] / TRAIN_LV_EVERY < 5) lines.push(`${t.name} 레벨 ${trainLv(c, k)}!`);
  addTrust(c, 0.4);
  if (tone === "great") addCond(c, rng() < 0.3 ? 1 : 0);
  const title = tone === "great" ? `${t.name} 대성공!` : tone === "fail" ? `${t.name} 실패…` : t.name;
  if (tone === "fail") lines.unshift("몸이 무거워서 집중이 안 됐다.");
  return { title, tone, lines, delta: diffOf(c, a) };
}

/* ─────────────── 이번 주 지도 (등장 캐릭터 · 장소 이벤트) ─────────────── */

export interface Spot {
  place: PlaceId;
  char?: CharId;
  event?: SpotEvent;
}

/** 깊은 인연(3단계 이상)은 이 수만큼만 — 누구와 깊어질지가 선택 */
export const DEEP_MAX = 3;
export const deepCount = (c: Career) => CHARS.filter((x) => (c.bonds[x.id] ?? 0) >= BOND_AT[2]).length;

/** 다음 만남이 열 단계가 연차 조건 · 깊은 인연 수에 막혔나 (막히면 지도에 안 뜸) — 이유 */
export function bondLock(c: Career, id: CharId): string | null {
  const v = c.bonds[id] ?? 0;
  const next = BOND_AT.findIndex((at) => at > v);
  if (next < 0) return null;
  if (v + 1 !== BOND_AT[next]) return null;
  if (c.season < BOND_SEASON[next]) return `${BOND_SEASON[next]}년차부터`;
  if (next === 2 && deepCount(c) >= DEEP_MAX) return `깊은 인연은 ${DEEP_MAX}명까지`;
  return null;
}
const bondLocked = (c: Career, id: CharId) => !!bondLock(c, id);

/** 이번 관리 턴에 지도에 뜨는 것 (시드 · 연차 · 주 · 인연으로 정해짐 — 새로고침해도 같음) */
export function spotsOf(c: Career): Spot[] {
  const rng = makeRng((c.seed * 7919 + c.season * 104729 + (c.phase === "season" ? c.week : 100 + c.slot + (c.phase === "off" ? 50 : 0)) * 1009) >>> 0);
  const free = [...SPOT_IDS];
  const take = () => free.splice(Math.floor(rng() * free.length), 1)[0];
  const out: Spot[] = [];
  // 캐릭터 1 ~ 2명: 진행 중인 인연이 더 잘 뜸, 연차에 막힌 사람은 안 뜸, 다 끝난 사람은 가끔
  const pool = CHARS.map((x) => x.id).filter((id) => !bondLocked(c, id));
  const w = (id: CharId) => {
    const v = c.bonds[id] ?? 0;
    return v >= BOND_AT[3] ? 0.25 : v > 0 ? 2.5 : 1;
  };
  const n = rng() < 0.45 ? 2 : 1;
  for (let i = 0; i < n && pool.length; i++) {
    let r = rng() * pool.reduce((s, id) => s + w(id), 0);
    let pick = pool[0];
    for (const id of pool) {
      r -= w(id);
      if (r <= 0) {
        pick = id;
        break;
      }
    }
    pool.splice(pool.indexOf(pick), 1);
    out.push({ place: take(), char: pick });
  }
  // 장소 이벤트 (40% · 퀴즈쇼는 드물게)
  if (rng() < 0.4) {
    const evs = (Object.keys(SPOT_EVENTS) as SpotEvent[]).filter((e) => free.includes(SPOT_EVENTS[e].place) && (e !== "cf" || c.fame >= 300) && (e !== "signing" || c.fame >= 150));
    const ew = (e: SpotEvent) => (e === "quiz" ? 0.35 : 1);
    if (evs.length) {
      let r = rng() * evs.reduce((a, e) => a + ew(e), 0);
      let e = evs[0];
      for (const x of evs) {
        r -= ew(x);
        if (r <= 0) {
          e = x;
          break;
        }
      }
      free.splice(free.indexOf(SPOT_EVENTS[e].place), 1);
      out.push({ place: SPOT_EVENTS[e].place, event: e });
    }
  }
  return out;
}

/** 캐릭터 만나기 (인연 단계 진행, 2단계는 고르기) */
function meet(c: Career, id: CharId, place: PlaceId, rng: Rng): TurnOut {
  const a = snap(c);
  const ch = charById(id);
  const b = BONDS[id];
  const visits = c.bonds[id] ?? 0;
  addStamina(c, 10);
  addCond(c, 1);
  const where = PLACES[place].name;
  if (visits >= BOND_AT[3]) {
    grow(c, b.stat, 6);
    return { title: `${ch.name}와 한때`, tone: "ok", lines: [`${where}에서 ${ch.name}와 즐거운 시간.`], delta: diffOf(c, a), char: id };
  }
  c.bonds[id] = visits + 1;
  const stage = BOND_AT.indexOf(visits + 1) + 1;
  if (stage === 0) {
    grow(c, b.stat, 7);
    return { title: `${ch.name} · ${where}`, tone: "ok", lines: [`${ch.name}와 같이 시간을 보냈다. (인연 ${visits + 1}/${BOND_AT[3]})`], delta: diffOf(c, a), char: id };
  }
  const lines = [b.lines[stage - 1]];
  if (stage === 1) {
    grow(c, b.stat, 10);
  } else if (stage === 2) {
    c.pending = { kind: "bond", char: id, title: `${ch.name} · ${where}`, text: b.lines[1], choices: b.pick };
    return { title: `${ch.name} · ${where}`, tone: "event", lines, delta: diffOf(c, a), char: id };
  } else if (stage === 3) {
    grow(c, b.stat, 14);
    lines.push(...gainSkill(c, `sk_${id}` as SkillId));
  } else {
    grow(c, b.stat, 26);
    for (const k of STAT_KEYS) if (k !== b.stat) grow(c, k, 6);
    if (!c.learned) {
      c.learned = id;
      lines.push(`필살타법 「${ch.swing.name}」 전수! 경기당 ${spUses(c)}번 · 운동장에서 「필살타법 훈련」이 열렸다.`);
    } else lines.push(`이미 「${charById(c.learned).swing.name}」을 익혀서 이번엔 능력치만 올랐다.`);
    const aw = tryAwaken(c, rng, 0.02);
    if (aw) return { title: `${ch.name}의 마지막 가르침`, tone: "event", lines, delta: diffOf(c, a), extra: aw, char: id };
  }
  return { title: `${ch.name} · ${where}`, tone: "event", lines, delta: diffOf(c, a), char: id };
}

/** 장소 이벤트 */
function spotEvent(c: Career, e: SpotEvent, rng: Rng): TurnOut {
  const a = snap(c);
  const ev = SPOT_EVENTS[e];
  const lines: string[] = [];
  if (e === "cf") {
    addMoney(c, 200 + Math.round(c.fame / 20));
    addFame(c, 40);
    addStamina(c, -10);
    lines.push("광고 촬영! 얼굴이 알려지기 시작했다.");
  } else if (e === "quiz") {
    addCond(c, 1);
    makePick(c, rng, "야구 퀴즈쇼 우승");
    lines.push("퀴즈쇼 우승! 상품으로 특수능력 하나를 고를 수 있다.");
  } else if (e === "volunteer") {
    addFame(c, 25);
    addTrust(c, 3);
    addCond(c, 1);
    lines.push("아이들과 캐치볼. 마음이 따뜻해졌다.");
  } else if (e === "signing") {
    addFame(c, 35);
    addMoney(c, 120);
    addStamina(c, 5);
    lines.push("줄이 길었다! 팬이 늘었다.");
  } else {
    const k = lowestFocus(c);
    grow(c, k, BASE_GAIN * 3);
    addStamina(c, -28);
    lines.push(`강변에서 혼자 ${STAT_NAME[k]} 특훈. 몸이 부서질 것 같다.`);
  }
  return { title: ev.name, tone: "event", lines, delta: diffOf(c, a) };
}

/** 각성 — 재능 한 단계 ↑ · 한계 돌파 · 능력치 폭발 (커리어에 한 번) */
function tryAwaken(c: Career, rng: Rng, p: number): TurnOut | undefined {
  if (c.awakened) return;
  if (rng() >= p * (hasGp(c, "charmGp") ? 1.5 : 1) * (1 + fxOf(c).awaken)) return;
  const a = snap(c);
  c.awakened = true;
  c.talent = Math.min(TALENTS.length - 1, c.talent + 1);
  c.limit = TALENTS[c.talent].limit + 80;
  for (const k of STAT_KEYS) grow(c, k, 40);
  addCond(c, 4);
  c.talentKnown = true;
  return { title: "각성!", tone: "awaken", lines: ["몸 안에서 뭔가가 깨어났다…!", `숨은 재능이 ${TALENTS[c.talent].g}급으로 올랐다 · 한계 돌파!`], delta: diffOf(c, a) };
}

/* ─────────────── 특수능력 고르기 (3장 중 1장) ─────────────── */

/** 고를 카드 3장 — 가진 태그 쪽 1장은 웬만하면 넣어서 세트를 노릴 수 있게, 양날 카드 가끔 */
function makePick(c: Career, rng: Rng, from: string) {
  const owned = new Set(c.skills);
  const pool = SKILL_IDS.filter((id) => !owned.has(id) && !skill(id).noPick && !skill(id).set && !skill(id).bad);
  if (!pool.length) return;
  const opts: SkillId[] = [];
  const tags = Object.entries(tagCount(c)).filter(([, n]) => (n ?? 0) > 0 && (n ?? 0) < 3).map(([t]) => t as Tag);
  const want = tags.length ? pool.filter((id) => !skill(id).risk && tags.includes(skill(id).tag as Tag)) : [];
  if (want.length && rng() < 0.75) opts.push(rng.pick(want));
  const risky = pool.filter((id) => skill(id).risk && !opts.includes(id));
  if (risky.length && rng() < 0.35) opts.push(rng.pick(risky));
  const rest = pool.filter((id) => !opts.includes(id) && !skill(id).risk);
  while (opts.length < 3 && rest.length) opts.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]);
  // 섞기
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  c.pick = { from, options: opts };
}

/** 고르기 답 (-1 = 건너뛰기) */
export function choosePick(c: Career, i: number): TurnOut {
  const p = c.pick;
  if (!p) throw new Error("고르기 없음");
  const a = snap(c);
  c.pick = null;
  if (i < 0 || !p.options[i]) return { title: "넘겼다", tone: "ok", lines: ["이번엔 아무것도 안 골랐다."], delta: diffOf(c, a) };
  const id = p.options[i];
  const lines = gainSkill(c, id);
  pushLog(c, `${p.from}: 「${skill(id).name}」`);
  return { title: skill(id).name, tone: lines.length > 1 ? "great" : "event", lines, delta: diffOf(c, a) };
}

/* ─────────────── 무작위 이벤트 ─────────────── */

function randomEvent(c: Career, rng: Rng): TurnOut | undefined {
  if (c.pending || c.pick || c.injury) return;
  const done = Math.min(2, Object.values(c.bonds).filter((v) => (v ?? 0) >= BOND_AT[3]).length);
  const aw = tryAwaken(c, rng, 0.00005 * (c.cond === 4 ? 2.5 : 1) * (1 + done * 0.6));
  if (aw) return aw;
  if (rng() > 0.22) return;
  const a = snap(c);
  const r = rng();
  const fx = fxOf(c);
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
    return { title: "선배의 조언", tone: "event", lines: [`선배가 ${STAT_NAME[k]} 요령을 알려 줬다.`], delta: diffOf(c, a) };
  }
  if (r < 0.68) {
    addCond(c, 1);
    addFame(c, 15);
    return { title: "팬레터", tone: "event", lines: ["응원 편지가 왔다! 힘이 난다."], delta: diffOf(c, a) };
  }
  if (r < 0.8 * (1 + fx.slump * 0.25)) {
    if (fx.slump <= -1) return { title: "슬럼프?", tone: "event", lines: ["불안했지만 평정심으로 넘겼다."], delta: diffOf(c, a) };
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
  c.bag.charm = (c.bag.charm ?? 0) + 1;
  return { title: "길에서 주운 것", tone: "event", lines: ["반짝이는 부적을 주웠다. (행운의 부적 +1)"], delta: diffOf(c, a) };
}

/* ─────────────── 턴 행동 ─────────────── */

export type Action =
  | { kind: "train"; key: TrainKey }
  | { kind: "rest" }
  | { kind: "care" }
  | { kind: "clinic" }
  | { kind: "meet"; char: CharId }
  | { kind: "event"; event: SpotEvent }
  | { kind: "stroll"; place: PlaceId };

export const CLINIC_PRICE = 250;

/** 할 수 없으면 이유 (화면에 그대로) */
export function whyNot(c: Career, a: Action): string | null {
  if (stepOf(c) !== "turn") return "지금은 턴이 아니에요";
  if (c.injury && !(a.kind === "rest" || a.kind === "clinic" || a.kind === "care")) return "부상 중엔 숙소 · 병원만";
  if (a.kind === "train" && a.key === "special" && !c.learned) return "필살타법을 배워야 열려요 (캐릭터 인연 4단계)";
  if (a.kind === "clinic" && c.money < CLINIC_PRICE) return "자금이 모자라요";
  if (a.kind === "clinic" && !c.injury && c.stamina >= 70) return "아픈 데가 없어요";
  const spots = spotsOf(c);
  if (a.kind === "meet" && !spots.some((s) => s.char === a.char)) return "이번 주엔 안 보여요";
  if (a.kind === "event" && !spots.some((s) => s.event === a.event)) return "이번 주 이벤트가 아니에요";
  if (a.kind === "stroll" && (!PLACES[a.place].spot || spots.some((s) => s.place === a.place))) return "여기선 못 해요";
  return null;
}

/** 턴 행동 하나 */
export function act(c: Career, a: Action): TurnOut {
  const why = whyNot(c, a);
  if (why) throw new Error(why);
  const rng = turnRng(c);
  let out: TurnOut;
  const s0 = snap(c);
  switch (a.kind) {
    case "train":
      out = train(c, a.key, rng);
      break;
    case "rest":
      addStamina(c, c.injury ? 30 : 45);
      if (rng() < 0.35) addCond(c, 1);
      out = { title: c.injury ? "숙소에서 요양" : "휴식", tone: "ok", lines: [c.injury ? "몸을 추슬렀다." : "푹 쉬었다."], delta: diffOf(c, s0) };
      break;
    case "care":
      addStamina(c, 20);
      addCond(c, 1);
      out = { title: "개인정비", tone: "ok", lines: ["장비 손질 · 스트레칭 · 영상 복기."], delta: diffOf(c, s0) };
      break;
    case "clinic": {
      addMoney(c, -CLINIC_PRICE);
      addStamina(c, 30);
      const lines = ["전문 치료를 받았다."];
      if (c.injury) {
        c.injury.left = Math.max(0, c.injury.left - 2);
        lines.push(c.injury.left ? `복귀까지 ${c.injury.left}턴` : "다 나았다!");
        if (!c.injury.left) c.injury = null;
      }
      out = { title: "병원 치료", tone: "ok", lines, delta: diffOf(c, s0) };
      break;
    }
    case "meet": {
      const sp = spotsOf(c).find((s) => s.char === a.char)!;
      out = meet(c, a.char, sp.place, rng);
      break;
    }
    case "event":
      out = spotEvent(c, a.event, rng);
      break;
    case "stroll":
      addStamina(c, a.place === "downtown" ? 15 : 10);
      addCond(c, 1);
      if (a.place === "downtown") addMoney(c, -60);
      out = { title: `${PLACES[a.place].name} 산책`, tone: "ok", lines: [a.place === "downtown" ? "맛있는 걸 먹었다." : "바람을 쐬고 왔다."], delta: diffOf(c, s0) };
      break;
  }
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
      addFame(c, 10);
      lines.push("겸손한 인터뷰 — 감독 평가가 조금 올랐다.");
    } else if (rng() < 0.5) {
      addCond(c, 1);
      addTrust(c, 6);
      addFame(c, 40);
      lines.push("자신감 넘치는 인터뷰가 화제! 컨디션 ↑");
    } else {
      addTrust(c, -4);
      addFame(c, 20);
      lines.push("건방지다는 기사가 났다… 감독 평가 ↓");
    }
  }
  pushLog(c, `${p.title}: ${p.choices[pick]}`);
  return { title: p.title, tone, lines, delta: diffOf(c, a), char: p.char };
}

/** 타입에서 가장 중요한 능력치 중 낮은 것 */
function lowestFocus(c: Career): StatKey {
  const apt = TYPES[c.type].apt;
  return [...STAT_KEYS].sort((a, b) => c.stats[a] / apt[a] - c.stats[b] / apt[b])[0];
}

/* ─────────────── 상점 ─────────────── */

/** 다음에 살 장비 단계 (없으면 null) + 못 사는 이유 */
export function gearNext(c: Career, id: GearId) {
  const cur = c.gear[id] ?? 0;
  if (cur >= 3) return null;
  const t = GEAR_TIER[cur];
  const why = c.fame < t.fame ? `인기도 ${t.fame} 필요` : c.money < t.price ? "자금이 모자라요" : null;
  return { tier: cur + 1, name: GEAR[id].tiers[cur], ...t, why };
}
export function buyGear(c: Career, id: GearId): string {
  const n = gearNext(c, id);
  if (!n) return "최고 단계예요";
  if (n.why) return n.why;
  c.money -= n.price;
  c.gear[id] = n.tier;
  return `${n.name} 구입`;
}
export function buy(c: Career, id: ConsumableId): string {
  const it = CONSUMABLES[id];
  if (c.money < it.price) return "자금이 모자라요";
  c.money -= it.price;
  c.bag[id] = (c.bag[id] ?? 0) + 1;
  return `${it.name} 구입`;
}
/** 소모품 쓰기 — 턴마다 하나만 */
export function consumeItem(c: Career, id: ConsumableId): string {
  if (!(c.bag[id] ?? 0)) return "없어요";
  if (c.usedItem) return "이번 턴엔 이미 하나 썼어요";
  if (id === "rehab" && !c.injury) return "부상일 때만 써요";
  if (id === "charm" && c.charmNext) return "이미 썼어요";
  c.bag[id]! -= 1;
  c.usedItem = true;
  if (id === "drink") addStamina(c, 30);
  if (id === "food") {
    addCond(c, 1);
    addStamina(c, 10);
  }
  if (id === "charm") c.charmNext = true;
  if (id === "rehab" && c.injury) c.injury.left = Math.max(1, Math.ceil(c.injury.left / 2));
  return `${CONSUMABLES[id].name} 사용`;
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
  grade?: number;
}

/** 이번 경기에 나가나 (부상이면 못 나감) */
export const canPlay = (c: Career) => !c.injury;

/** 경기 결과 반영 (출전 못 했으면 line 없이) */
export function applyGame(c: Career, g: GameIn | null): GameSummary {
  if (stepOf(c) !== "game") throw new Error("경기 차례 아님");
  const a = snap(c);
  const rng = turnRng(c, 3 + c.gameInWeek);
  const lines: string[] = [];
  let title: string;
  let grade: number | undefined;
  const win = g ? g.win : rng() < 0.5;
  if (win === true) c.wins++;
  else if (win === false) c.losses++;
  const fx = fxOf(c);
  if (!g) {
    title = `결장 (${INJURY_NAME[c.injury?.kind ?? 0]}) · 팀 ${win ? "승리" : win === false ? "패배" : "무승부"}`;
    lines.push("벤치에서 동료들을 응원했다.");
    addTrust(c, -0.6);
    addStamina(c, 8);
  } else {
    const l = g.line;
    const L = c.line;
    L.g++;
    for (const k of ["pa", "ab", "h", "d2", "d3", "hr", "rbi", "bb", "k", "r"] as const) L[k] += l[k];
    const singles = l.h - l.d2 - l.d3 - l.hr;
    const xp: Stats = {
      hit: singles * 8 + l.d2 * 6 + l.d3 * 5 + l.hr * 4 + l.bb * 3 + (l.ab - l.h) * 0.4 + 1,
      power: l.d2 * 6 + l.hr * 16 * (1 + fx.hrXp) + 1,
      run: l.d3 * 8 + l.d2 * 3 + l.r * 3 + 1.5,
      def: 3,
    };
    // 경기 평가 — 잘 칠수록 성장 배율이 커짐 (직접 친 실력이 크게 남게)
    grade = gameGrade(l, g.missions);
    for (const k of STAT_KEYS) grow(c, k, xp[k] * TUNE.gameXp * GAME_GRADES[grade].xp * (1 + fx.gameXp));
    const tr = l.h * 2.5 + l.hr * 4 + l.rbi * 1 + l.bb * 1 - l.k * 1.5 - Math.max(0, l.ab - l.h - l.k) * 1.2 + g.missions * 4 - 0.5;
    addTrust(c, tr * 0.45);
    addStamina(c, -7);
    if (grade <= 1) addCond(c, rng() < 0.6 ? 1 : 0);
    else if (grade === 4 && rng() < 0.35) addCond(c, -1);
    addFame(c, l.h * 0.5 + l.hr * 3 + g.missions * 2 + (grade === 0 ? 5 : 0));
    addMoney(c, 15 + l.h * 6 + l.hr * 15 + l.rbi * 3 + Math.round(g.missionPt / 3) + (win ? 10 : 0));
    title = `[${GAME_GRADES[grade].g}] ${l.ab}타수 ${l.h}안타${l.hr ? ` ${l.hr}홈런` : ""}${l.rbi ? ` ${l.rbi}타점` : ""}${l.bb ? ` ${l.bb}볼넷` : ""} · 팀 ${win ? "승리" : win === false ? "패배" : "무승부"}`;
    if (l.hr >= 2) lines.push("멀티 홈런! 오늘의 주인공.");
    else if (l.h >= 3) lines.push("맹타! 감독이 엄지를 들었다.");
    else if (l.h === 0) lines.push("오늘은 안 풀렸다…");
    if (g.missions) lines.push(`돌발미션 ${g.missions}개 성공!`);
    // S 평가면 가끔 특수능력 고르기
    if (grade === 0 && rng() < 0.04 && c.mvpPicks < 3) {
      c.mvpPicks++;
      makePick(c, rng, "오늘의 MVP");
      lines.push("오늘의 MVP! 특수능력 하나를 고를 수 있다.");
    }
    if (rng() < (c.stamina < 20 ? 0.04 : 0.005) * (hasGp(c, "medic") ? 0.65 : 1) * Math.max(0.2, 1 + fx.injury)) lines.push(...hurt(c, rng, false));
  }
  pushLog(c, `${gameNo(c) + 1}경기: ${title}`);
  c.turn++;
  c.usedItem = false;
  tickInjury(c);
  c.gameInWeek++;
  if (c.gameInWeek >= GAMES_PER_WEEK) {
    c.gameInWeek = 0;
    c.week++;
    c.slot = 0;
    if (c.week >= WEEKS) c.phase = "seasonEnd";
  }
  return { title, lines, delta: diffOf(c, a), dnp: !g, grade };
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
  line: Line;
  awards: string[];
  lines: string[];
  salary: number;
  prevSalary: number;
  talentReveal?: string;
  /** 노쇠로 떨어진 능력치 */
  decline?: Partial<Stats>;
  /** 10년차 끝이라 무조건 은퇴 */
  retire: boolean;
  /** 은퇴를 고를 수 있음 */
  canRetire: boolean;
}

export function endSeason(c: Career): SeasonSummary {
  if (c.phase !== "seasonEnd") throw new Error("시즌 결산 차례 아님");
  const rng = turnRng(c, 11);
  const L = c.line;
  const awards: string[] = [];
  const lines: string[] = [];
  const pa = L.pa;
  // 리그 1위 기록은 해마다 조금씩 다름 (30경기 시즌)
  if (pa >= 80 && avg(L) >= 0.35 + rng() * 0.05) awards.push("타격왕");
  if (L.hr >= 11 + Math.floor(rng() * 6)) awards.push("홈런왕");
  if (L.rbi >= 34 + Math.floor(rng() * 10)) awards.push("타점왕");
  if (c.season === 1 && pa >= 50 && ops(L) >= 0.78) awards.push("신인왕");
  if (awards.length >= 2 || (pa >= 80 && ops(L) >= 1.0)) awards.push("MVP");
  if (awards.length) {
    addTrust(c, 6 * awards.length);
    addFame(c, 100 * awards.length);
    addMoney(c, 400 * awards.length);
    lines.push(`수상: ${awards.join(" · ")}`);
  }
  const ovr = ovrOf(c);
  const prev = c.salary;
  const perf = pa ? clamp(ops(L) - 0.6, -0.3, 0.7) : -0.2;
  c.salary = Math.max(2700, Math.round((3000 + ovr * 18 + perf * 8000 + awards.length * 3000 + c.fame * 0.15) / 100) * 100);
  const pay = Math.round(c.salary / 10);
  addMoney(c, pay);
  lines.push(`연봉 ${prev.toLocaleString()} → ${c.salary.toLocaleString()}만원 (생활비 빼고 자금 +${pay.toLocaleString()}만원)`);
  let talentReveal: string | undefined;
  if (!c.talentKnown) {
    c.talentKnown = true;
    talentReveal = TALENTS[c.talent].g;
    lines.push(`스카우트 평가: 숨은 재능 ${talentReveal}급`);
  }
  // 노쇠 (8년차부터): 발 · 수비가 먼저
  let decline: Partial<Stats> | undefined;
  if (c.season >= 8) {
    decline = {};
    const y = c.season - 7;
    for (const k of STAT_KEYS) {
      const rate = (k === "run" || k === "def" ? 0.025 : 0.01) * y;
      const before = c.stats[k];
      c.stats[k] *= 1 - rate;
      decline[k] = Math.round(c.stats[k]) - Math.round(before);
    }
    lines.push("나이가 느껴진다… 발이 조금 무거워졌다.");
  }
  const rec: SeasonRec = { season: c.season, line: { ...L }, awards, ovr: ovrOf(c), salary: c.salary };
  c.seasons.push(rec);
  for (const k of ["g", "pa", "ab", "h", "d2", "d3", "hr", "rbi", "bb", "k", "r"] as const) c.total[k] += L[k];
  c.line = emptyLine();
  c.turn++;
  const retire = c.season >= MAX_SEASONS;
  const canRetire = !retire && c.season >= RETIRE_FROM;
  if (retire) c.phase = "retired";
  else {
    c.phase = "off";
    c.slot = 0;
    c.week = 0;
    c.gameInWeek = 0;
    c.stamina = Math.max(c.stamina, 70);
    // 시즌 끝 특수능력 고르기 (은퇴하는 해엔 없음)
    makePick(c, rng, `${c.season}년차 시즌 보상`);
    c.askRetire = canRetire;
  }
  pushLog(c, `${c.season}년차 결산 — 종합 ${rec.ovr}${awards.length ? ` · ${awards.join(" · ")}` : ""}`);
  return { season: c.season, line: rec.line, awards, lines, salary: c.salary, prevSalary: prev, talentReveal, decline, retire, canRetire };
}

/** 은퇴할지 답 (7년차 결산부터) */
export function decideRetire(c: Career, retire: boolean) {
  c.askRetire = false;
  if (retire) {
    c.phase = "retired";
    c.pick = null;
    pushLog(c, `${c.season}년차를 끝으로 은퇴.`);
  } else pushLog(c, "한 시즌 더!");
}

/** 은퇴 요약 (별명 · 등급 · 상위 %) */
export function retireCard(c: Career) {
  const ovr = ovrOf(c);
  const t = c.total;
  const nick: string[] = [];
  const awards = c.seasons.flatMap((s) => s.awards);
  const cnt = (a: string) => awards.filter((x) => x === a).length;
  if (cnt("MVP") >= 3) nick.push("리그의 지배자");
  if (cnt("홈런왕") >= 2 || t.hr >= 150) nick.push("홈런 공장");
  if (cnt("타격왕") >= 2 || (t.ab >= 600 && avg(t) >= 0.33)) nick.push("안타 제조기");
  if (t.rbi >= 400) nick.push("해결사");
  if (t.h >= 1000) nick.push("천 안타의 사나이");
  if (c.stats.run >= 800) nick.push("바람의 아들");
  if (c.stats.def >= 800) nick.push("수비의 신");
  for (const id of c.skills) if (skill(id).set) nick.push(skill(id).name);
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
  seasons: number;
  at: number;
  gp: number;
}
export function hofEntry(c: Career): HofEntry {
  const r = retireCard(c);
  const st = {} as Stats;
  for (const k of STAT_KEYS) st[k] = Math.round(c.stats[k]);
  return { id: c.id, name: c.name, type: c.type, ovr: r.ovr, grade: r.grade.g, nick: r.nick[0], stats: st, hr: c.total.hr, avg: avg(c.total), seasons: c.seasons.length, at: Date.now(), gp: c.gp.length };
}

/* ─────────────── 봇 육성 (자동 진행 · 밸런스 시뮬) ─────────────── */

export interface Policy {
  /** 이 체력 아래면 쉼 (낮을수록 무리) */
  restBelow: number;
  /** 캐릭터 · 이벤트가 뜨면 갈 확률 */
  outing: number;
  /** 주력 능력치 몰빵 정도 0 ~ 1 */
  focus: number;
  /** 상점 · 아이템을 쓰나 */
  shop: boolean;
  /** 이벤트에서 무리하는 쪽 고를 확률 */
  bold: number;
  /** 은퇴 연차 (7 ~ 10) */
  retireAt: number;
}
export const POLICY_AVG: Policy = { restBelow: 40, outing: 0.5, focus: 0.6, shop: true, bold: 0.5, retireAt: 10 };

/** 봇이 이번 턴에 할 일 */
export function botAction(c: Career, pol: Policy, rng: Rng): Action {
  if (c.injury) return c.money > CLINIC_PRICE * 3 && rng() < 0.5 ? { kind: "clinic" } : { kind: "rest" };
  if (c.stamina < pol.restBelow) return rng() < 0.8 ? { kind: "rest" } : { kind: "care" };
  const spots = spotsOf(c);
  if (rng() < pol.outing) {
    const going = spots.filter((s) => s.char && (c.bonds[s.char] ?? 0) < BOND_AT[3]);
    if (going.length) return { kind: "meet", char: rng.pick(going).char! };
    const ev = spots.find((s) => s.event && (s.event !== "secret" || c.stamina > 50));
    if (ev && rng() < 0.6) return { kind: "event", event: ev.event! };
  }
  if (c.cond <= 1 && rng() < 0.5) return { kind: "care" };
  if (c.learned && spLv(c) < 5 && rng() < 0.12) return { kind: "train", key: "special" };
  const apt = TYPES[c.type].apt;
  let key: TrainKey;
  if (rng() < pol.focus) {
    key = [...STAT_KEYS].sort((a, b) => apt[b] - apt[a])[0];
    if (c.type === "all") key = rng.pick(STAT_KEYS);
  } else key = rng.pick(STAT_KEYS);
  return { kind: "train", key };
}
/** 봇 상점: 주력 장비 먼저 올리고, 체력 모자라면 드링크 */
export function botShop(c: Career) {
  const best = [...STAT_KEYS].sort((a, b) => TYPES[c.type].apt[b] - TYPES[c.type].apt[a]);
  const gearFor: Record<StatKey, GearId> = { hit: "bat", power: "dumbbell", run: "spike", def: "glove" };
  for (const k of best.slice(0, 2)) {
    const n = gearNext(c, gearFor[k]);
    if (n && !n.why && c.money - n.price > 400) buyGear(c, gearFor[k]);
  }
  if (c.injury && c.injury.left >= 4 && c.money >= CONSUMABLES.rehab.price + 400 && !c.usedItem) {
    buy(c, "rehab");
    consumeItem(c, "rehab");
  } else if (c.stamina < 45 && c.money >= CONSUMABLES.drink.price + 600 && !c.usedItem) {
    buy(c, "drink");
    consumeItem(c, "drink");
  } else if (c.bag.charm && !c.charmNext && !c.usedItem) consumeItem(c, "charm");
}
/** 봇 고르기: 세트에 가까운 태그 > 양날 아닌 것 */
export function botPick(c: Career, rng: Rng): number {
  const p = c.pick;
  if (!p) return -1;
  const tc = tagCount(c);
  let best = 0;
  let bs = -1;
  p.options.forEach((id, i) => {
    const s = skill(id);
    const sc = (s.tag ? (tc[s.tag] ?? 0) * 2 : 0) + (s.risk ? -1 : 1) + rng();
    if (sc > bs) {
      bs = sc;
      best = i;
    }
  });
  return best;
}
