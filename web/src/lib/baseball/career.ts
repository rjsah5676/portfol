/**
 * 육성 모드 (타자편) — 나만의 선수 한 명을 최대 10년 키우고 은퇴시키기 (게임빌 프로야구 「나만의 리그」 방식).
 *
 * 한 해: 스프링캠프(턴 3) → 시즌 30경기 (2경기마다 관리 턴 1, 15주) → 시즌 결산(수상 · 연봉 · 특수능력 고르기) → 비시즌(턴 2)
 *   7년차 결산부터 은퇴를 고를 수 있고 10년차엔 은퇴. 19세 입단 → 28세, 8년차부터 노쇠.
 * 관리 턴은 시내 지도에서 장소 하나: 운동장(훈련 4종 + 필살타법 훈련) · 숙소(휴식 · 개인정비) · 병원 · 쇼핑몰(상점, 턴 안 씀) ·
 *   외출 장소(번화가 · 공원 · 강변 · 도서관 · 방송국) — 이번 주에 나타난 픽셀파이트 캐릭터(❗)나 장소 이벤트만 만날 수 있음.
 * 로그라이크 양념: 특수능력은 3장 중 1장 고르기(시즌 끝 · S 평가 · 도서관 퀴즈) · 같은 태그 3장이면 세트 효과 · 양날 카드.
 *
 * 결과 분포(종합 0 ~ 999, 코치 C 기준): 중앙값 ~485 · 하위 10% ~390 · 상위 10% ~585 · 최고 ~730 (촘촘하게)
 *   코치 S 풀강: 중앙값 ~590 · 운까지 다 터지면 ~870~900. 999 는 사실상 불가 (scripts/baseball-career-sim.ts)
 *   결과 몫(SHARE=1): 실력 ~40 · 운 ~60 (코치 C = 효과 없음) · 코치 S 풀강 ~20% < 인연 ~29% (COACH=1)
 *   흔들림 세 갈래 — 운(숨은 재능 · 대성공 · 부상 · 각성 · 고르기 패) · 선택(훈련 몰빵 · 체력 관리 · 인연 · 상점 · 은퇴 시점) · 실력(직접 친 타석)
 * GP 부스트(판마다 고르는 것)는 같은 플레이 대비 종합 +30% 를 넘지 않게 (시뮬로 확인).
 *
 * 화면 · 시간 · 저장은 없음 — 상태(Career)는 그냥 JSON (localStorage 에 통째로).
 * 난수는 (시드, 턴 번호)로 정해서 새로고침해도 결과가 같음.
 */
import type { Diff } from "./ai";
import { PITCH_LV } from "./careerGame";
import { TEAM_DEFS, charById, type Batter, type Boost, type CharId } from "./data";
import type { BatLine, Clutch } from "./game";
import { clamp, makeRng, type Rng } from "./rng";
import { DEFAULT_LOOK, type Look } from "./look";
import { BOND_IDS, BOONS, DUOS, EPILOGUE, ROLE, SPECIAL_DAY, STORY, isBond, type BondId, type Choice, type Role } from "./bonds";

export type StatKey = "hit" | "power" | "run";
export type Stats = Record<StatKey, number>;
export const STAT_KEYS: StatKey[] = ["hit", "power", "run"];
/** 수비 능력치는 뺌 (예전 저장의 stats.def 는 남아 있어도 안 씀) */
export const STAT_NAME: Record<StatKey, string> = { hit: "타격", power: "파워", run: "주루" };

/* ─────────────── 선수 타입 · 재능 ─────────────── */

/**
 * 새 선수: 수비 위치 (포수 · 내야수 · 외야수 — 능력치 영향 없음) + 타입 셋 중 하나
 *   교타자 (타격 ↑ 파워 ↓) · 거포 (타격 ↓ 파워 ↑) · 만능 (고르게) — 교타자 · 거포는 같은 크기로 맞바꿈
 * 준족 · 수비형은 예전 저장 · 명예의 전당 표시용으로만 남김
 */
export type BatType = "contact" | "power" | "speed" | "defense" | "all";
export const PICK_TYPES: BatType[] = ["contact", "power", "all"];
export type FieldPos = "C" | "SS" | "CF";
export const PICK_POS: { pos: FieldPos; name: string }[] = [
  { pos: "C", name: "포수" },
  { pos: "SS", name: "내야수" },
  { pos: "CF", name: "외야수" },
];
const EVEN = { apt: { hit: 1.0, power: 1.0, run: 1.0 }, start: { hit: 125, power: 115, run: 125 } };
/** 육성 경기 난이도는 중급 하나 */
export const CAREER_DIFF = 1;
export const TYPES: Record<BatType, { name: string; desc: string; pos: string; apt: Stats; start: Stats }> = {
  // 교타자 · 거포 성장 비율은 육성 시뮬로 맞춤 (타입별 종합 평균이 비슷하게 — 홈런이 경기 평가를 많이 올려서 거포 쪽 성장은 작게)
  contact: { name: "교타자", desc: "타격 ↑ · 파워 ↓", pos: "2B", apt: { hit: 1.35, power: 0.82, run: 1.0 }, start: { hit: 150, power: 90, run: 125 } },
  power: { name: "거포", desc: "파워 ↑ · 타격 ↓", pos: "1B", apt: { hit: 0.78, power: 1.08, run: 1.0 }, start: { hit: 100, power: 130, run: 125 } },
  speed: { name: "준족", desc: "주루가 잘 자람", pos: "CF", apt: { hit: 1.12, power: 0.88, run: 1.5 }, start: { hit: 125, power: 75, run: 180 } },
  defense: { name: "수비형", desc: "(예전 타입)", pos: "SS", apt: { hit: 1.02, power: 0.88, run: 1.08 }, start: { hit: 115, power: 85, run: 125 } },
  all: { name: "만능", desc: "고르게 자람", pos: "3B", ...EVEN },
};

/** 숨은 재능 — 1시즌 끝 스카우트 평가에서 공개. 성장 속도(mul) + 한계(limit, 가까울수록 덜 오름). SS 는 각성으로만 */
export const TALENTS: { g: string; w: number; mul: number; limit: number }[] = [
  { g: "F", w: 0.08, mul: 0.72, limit: 320 },
  { g: "D", w: 0.17, mul: 0.8, limit: 380 },
  { g: "C", w: 0.3, mul: 0.88, limit: 440 },
  { g: "B", w: 0.27, mul: 0.97, limit: 520 },
  { g: "A", w: 0.13, mul: 1.12, limit: 680 },
  { g: "S", w: 0.05, mul: 1.25, limit: 780 },
  { g: "SS", w: 0, mul: 1.35, limit: 820 },
];

/* ─────────────── 일정 ─────────────── */

export const MAX_SEASONS = 10;
/** 이 연차 결산부터 은퇴를 고를 수 있음 */
export const RETIRE_FROM = 7;
export const GAMES = 30;
export const GAMES_PER_WEEK = 2;
export const WEEKS = GAMES / GAMES_PER_WEEK;
/** 스프링캠프 · 비시즌 날 수 (하루 = 경기 없는 관리 한 번) */
export const CAMP_TURNS = 3;
export const OFF_TURNS = 2;

/** 행동력 (원작 ACTIVE): 최대 10칸 · 경기마다 +3 · 캠프 · 비시즌 하루 +6 · 시즌 시작 가득 */
export const ACTIVE_MAX = 10;
export const ACTIVE_PER_GAME = 3;
export const ACTIVE_PER_DAY = 6;
const START_AGE = 19;
/** 연차별 성장 배율 (전성기 3~5년차 · 8년차부터 둔해짐) */
const AGE_GROW = [1.0, 1.05, 1.12, 1.12, 1.12, 1.06, 1.0, 0.88, 0.76, 0.64];

/* ─────────────── 훈련 ─────────────── */

export type TrainKey = "hit" | "power" | "run" | "special";
export const TRAINS: Record<TrainKey, { name: string; desc: string; cost: number; gain: Partial<Stats> }> = {
  hit: { name: "타격 훈련", desc: "타격 ↑ (파워 조금)", cost: 18, gain: { hit: 1, power: 0.18 } },
  power: { name: "근력 훈련", desc: "파워 ↑ (타격 조금)", cost: 22, gain: { power: 1, hit: 0.15 } },
  run: { name: "주루 훈련", desc: "주루 ↑", cost: 19, gain: { run: 1 } },
  special: { name: "필살타법 훈련", desc: "필살 레벨 ↑ (종합 · Lv5 마스터면 경기당 2번) — 배운 뒤에만", cost: 26, gain: { hit: 0.25, power: 0.25 } },
};
export const TRAIN_KEYS: TrainKey[] = ["hit", "power", "run", "special"];
/** 훈련 한 번 기본 성장 (재능 · 타입 · 컨디션 · 높을수록 덜 오름 반영 전) */
export const BASE_GAIN = 1.38;
/** 훈련 배율 — 경기로는 능력치가 안 오르니(행동력 · 체력 · 컨디션만) 훈련이 성장의 몸통 */
export const TRAIN_GAIN = 3.8;
/** 밸런스 손잡이 (시뮬에서 바꿔 보기) */
/** 시뮬용 손잡이 (coach = 코치 등급 · noBond = 인연 끔) */
export const TUNE = { train: 1, coach: "C" as CoachGrade, noBond: false };
/**
 * 신인 보정: 경기용 타격 · 파워 +bonus 로 시작해 seasons 시즌에 걸쳐 0 으로 (1년차가 2년차보다 잘 치는 일이 없게 천천히)
 * · 1년차 훈련 효율 ×train (초반을 빨리 벗어나게 — 최종 성장 분포는 재능 한계가 막음)
 */
export const ROOKIE = { bonus: 140, seasons: 4, train: 1.3 };
export function rookieBonus(c: Pick<Career, "season" | "phase" | "week" | "gameInWeek">) {
  const done = c.season - 1 + (c.phase === "season" || c.phase === "camp" ? (c.week * GAMES_PER_WEEK + c.gameInWeek) / GAMES : 1);
  return Math.max(0, ROOKIE.bonus * (1 - done / ROOKIE.seasons));
}
/** 훈련 레벨: 같은 훈련 TRAIN_LV_EVERY 번마다 +1 (최대 5) · 레벨당 효율 +10% */
export const TRAIN_LV_EVERY = 8;
/** 필살타법 레벨: 필살 훈련 SP_EVERY 번마다 +1 (최대 5 = 마스터 → 경기당 2번) */
export const SP_EVERY = 3;

export const COND_NAME = ["최악", "나쁨", "보통", "좋음", "최고"] as const;
const COND_TRAIN = [0.72, 0.86, 1, 1.12, 1.25];
/** 경기 컨디션: 타격 · 파워 배율 */
export const COND_GAME = [0.88, 0.94, 1, 1.04, 1.08];

/* ─────────────── 특수능력 (태그 · 세트 · 양날) ─────────────── */

export type Tag = "clutch" | "contact" | "power" | "speed" | "grit" | "luck";
export const TAG_NAME: Record<Tag, string> = { clutch: "찬스", contact: "컨택", power: "파워", speed: "스피드", grit: "근성", luck: "행운" };
export const TAG_COLOR: Record<Tag, string> = { clutch: "#ff7a5c", contact: "#7dff9a", power: "#ff5a5a", speed: "#7ad7ff", grit: "#c9a2ff", luck: "#ff7ae0" };

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
  /** 경기마다 행동력 + */
  gameAct?: number;
  /** 경기마다 체력 + */
  gameSta?: number;
  /** 홈런 하나마다 컨디션 ▲ 확률 */
  hrCond?: number;
  money?: number;
  fame?: number;
  awaken?: number;
  slump?: number;
  trust?: number;
  /** 컨디션이 최악까지 안 떨어짐 */
  condFloor?: boolean;
  /** 떨어지는 컨디션 폭 -1 */
  calm?: boolean;
  /** 호감 얻는 양 +% */
  aff?: number;
  /** 휴식 · 개인정비 체력 회복 +% */
  rest?: number;
  /** 훈련 실패 확률 - (0.05 = 5%p) */
  fail?: number;
  /** 훈련 체력 소모 -% */
  stam?: number;
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
  /** 인연 축복 (그 사람 · 듀오면 두 사람) — 겹치면 레벨 업 (최대 3) */
  boon?: CharId | [CharId, CharId];
  fx: Fx;
}

export const SKILLS = {
  // 찬스
  clutch: { name: "찬스 강함", desc: "득점권에서 타격 +70", val: 2, tag: "clutch", fx: { sit: { rispHit: 70 } } },
  solver: { name: "해결사", desc: "득점권에서 파워 +70", val: 2, tag: "clutch", fx: { sit: { rispPow: 70 } } },
  gamer: { name: "승부사", desc: "7회부터 타격 · 파워 +45", val: 2, tag: "clutch", fx: { sit: { late: 45 } } },
  // 컨택
  precise: { name: "정교함", desc: "경기 타격 +40", val: 2, tag: "contact", fx: { add: { hit: 40 } } },
  study: { name: "타격 연구", desc: "타격 훈련 효율 +18%", val: 2, tag: "contact", fx: { train: { hit: 0.18 } } },
  // 파워
  fullswing: { name: "풀스윙", desc: "경기 파워 +45", val: 2, tag: "power", fx: { add: { power: 45 } } },
  muscle: { name: "근력 체질", desc: "근력 훈련 효율 +18%", val: 2, tag: "power", fx: { train: { power: 0.18 } } },
  slugger: { name: "장타 본능", desc: "홈런 치면 60% 확률로 컨디션 ▲", val: 2, tag: "power", fx: { hrCond: 0.6 } },
  // 스피드
  track: { name: "육상부 출신", desc: "주루 훈련 효율 +18%", val: 2, tag: "speed", fx: { train: { run: 0.18 } } },
  dash: { name: "스타트 대시", desc: "경기 주루 +45", val: 2, tag: "speed", fx: { add: { run: 45 } } },
  // (예전 수비 능력 2장 — id 그대로 두고 주루 · 파워 쪽으로 바꿈)
  glovework: { name: "주루 센스", desc: "경기 주루 +25 · 주루 훈련 효율 +8%", val: 2, tag: "speed", fx: { add: { run: 25 }, train: { run: 0.08 } } },
  arm: { name: "강한 손목", desc: "경기 파워 +25 · 타격 +20", val: 2, tag: "power", fx: { add: { power: 25, hit: 20 } } },
  // 근성
  grit: { name: "끈질김", desc: "2스트라이크에서 타격 +70", val: 2, tag: "grit", fx: { sit: { twoK: 70 } } },
  iron: { name: "강철 몸", desc: "부상 확률 -40%", val: 2, tag: "grit", fx: { injury: -0.4 } },
  bounce: { name: "오뚝이", desc: "부상 기간 -40%", val: 2, tag: "grit", fx: { injuryDur: -0.4 } },
  // 행운
  lucky: { name: "행운아", desc: "훈련 대성공 +6%", val: 2, tag: "luck", fx: { great: 0.06 } },
  star: { name: "스타성", desc: "인기도 +40%", val: 2, tag: "luck", fx: { fame: 0.4 } },
  biz: { name: "사업 수완", desc: "수당 · 연봉 자금 +30%", val: 2, tag: "luck", fx: { money: 0.3 } },
  // ── 인연 축복 (만남 2 · 6번째 · 대결 승리 · 특별한 날에 그 사람 축복 3장 중 1장, 겹치면 레벨 업) ──
  b_kai_wind: { name: "질풍의 발", desc: "경기 주루 +40", val: 3, tag: "speed", boon: "kai", noPick: true, fx: { add: { run: 40 } } },
  b_kai_dash: { name: "선제 돌격", desc: "7회부터 타격 · 파워 +35", val: 3, tag: "clutch", boon: "kai", noPick: true, fx: { sit: { late: 35 } } },
  b_kai_read: { name: "바람 읽기", desc: "경기 타격 +30", val: 3, tag: "contact", boon: "kai", noPick: true, fx: { add: { hit: 30 } } },
  b_kai_rest: { name: "새벽 강변 러닝", desc: "휴식 회복 +25% · 훈련 체력 소모 -10%", val: 3, tag: "grit", boon: "kai", noPick: true, fx: { rest: 0.25, stam: 0.1 } },
  b_igna_swing: { name: "업화의 힘", desc: "경기 파워 +45", val: 3, tag: "power", boon: "igna", noPick: true, fx: { add: { power: 45 } } },
  b_igna_forge: { name: "단련의 불꽃", desc: "근력 훈련 효율 +15%", val: 3, tag: "power", boon: "igna", noPick: true, fx: { train: { power: 0.15 } } },
  b_igna_spark: { name: "불꽃 승부", desc: "득점권에서 파워 +90", val: 3, tag: "clutch", boon: "igna", noPick: true, fx: { sit: { rispPow: 90 } } },
  b_igna_heat: { name: "뜨거운 심장", desc: "훈련 실패 확률 -10%p", val: 3, tag: "grit", boon: "igna", noPick: true, fx: { fail: 0.1 } },
  b_soy_fix: { name: "자세 교정", desc: "타격 훈련 효율 +15%", val: 3, tag: "contact", boon: "soyoung", noPick: true, fx: { train: { hit: 0.15 } } },
  b_soy_class: { name: "특별 수업", desc: "모든 훈련 효율 +5%", val: 3, tag: "luck", boon: "soyoung", noPick: true, fx: { train: { all: 0.05 } } },
  b_soy_watch: { name: "끝까지 보기", desc: "2스트라이크에서 타격 +100", val: 3, tag: "grit", boon: "soyoung", noPick: true, fx: { sit: { twoK: 100 } } },
  b_soy_sticker: { name: "칭찬 스티커", desc: "훈련 대성공 +5%", val: 3, tag: "luck", boon: "soyoung", noPick: true, fx: { great: 0.05 } },
  b_lily_shade: { name: "우산 그늘", desc: "부상 확률 -30%", val: 3, tag: "grit", boon: "lily", noPick: true, fx: { injury: -0.3 } },
  b_lily_drop: { name: "물방울 마사지", desc: "휴식 회복 +45%", val: 3, tag: "grit", boon: "lily", noPick: true, fx: { rest: 0.45 } },
  b_lily_float: { name: "둥실 타구", desc: "경기 파워 +30", val: 3, tag: "power", boon: "lily", noPick: true, fx: { add: { power: 30 } } },
  b_lily_candy: { name: "사탕 응원", desc: "컨디션이 덜 떨어짐", val: 3, tag: "luck", boon: "lily", noPick: true, fx: { calm: true } },
  b_zena_reflex: { name: "번개 반사", desc: "경기 타격 +40", val: 3, tag: "contact", boon: "zena", noPick: true, fx: { add: { hit: 40 } } },
  b_zena_step: { name: "번개 스텝", desc: "주루 훈련 효율 +20%", val: 3, tag: "speed", boon: "zena", noPick: true, fx: { train: { run: 0.2 } } },
  b_zena_zap: { name: "찌릿한 한 방", desc: "득점권에서 타격 +80", val: 3, tag: "clutch", boon: "zena", noPick: true, fx: { sit: { rispHit: 80 } } },
  b_zena_prank: { name: "장난 기운", desc: "인기도 +40% · 호감 +15%", val: 3, tag: "luck", boon: "zena", noPick: true, fx: { fame: 0.4, aff: 0.15 } },
  b_mei_steam: { name: "찜기 단련", desc: "타격 훈련 효율 +15%", val: 3, tag: "contact", boon: "mei", noPick: true, fx: { train: { hit: 0.15 } } },
  b_mei_palm: { name: "태극 타법", desc: "경기 타격 +25 · 파워 +20", val: 3, tag: "contact", boon: "mei", noPick: true, fx: { add: { hit: 25, power: 20 } } },
  b_mei_bun: { name: "왕만두 도시락", desc: "휴식 회복 +20% · 경기마다 체력 +2", val: 3, tag: "luck", boon: "mei", noPick: true, fx: { rest: 0.2, gameSta: 2 } },
  b_mei_gap: { name: "빈틈 읽기", desc: "경기 타격 +35", val: 3, tag: "contact", boon: "mei", noPick: true, fx: { add: { hit: 35 } } },
  b_ivan_fist: { name: "철곰 정권", desc: "득점권에서 파워 +110", val: 3, tag: "clutch", boon: "ivan", noPick: true, fx: { sit: { rispPow: 110 } } },
  b_ivan_body: { name: "강철 육체", desc: "부상 확률 -35%", val: 3, tag: "grit", boon: "ivan", noPick: true, fx: { injury: -0.35 } },
  b_ivan_drill: { name: "지옥 훈련", desc: "근력 · 주루 훈련 효율 +12%", val: 3, tag: "power", boon: "ivan", noPick: true, fx: { train: { power: 0.12, run: 0.12 } } },
  b_ivan_log: { name: "통나무 스쿼트", desc: "경기 파워 +30 · 훈련 체력 소모 -10%", val: 3, tag: "power", boon: "ivan", noPick: true, fx: { add: { power: 30 }, stam: 0.1 } },
  b_violet_stretch: { name: "체조 스트레칭", desc: "부상 확률 -30% · 주루 훈련 효율 +10%", val: 3, tag: "grit", boon: "violet", noPick: true, fx: { injury: -0.3, train: { run: 0.1 } } },
  b_violet_spin: { name: "피루엣 밸런스", desc: "경기 주루 +40", val: 3, tag: "speed", boon: "violet", noPick: true, fx: { add: { run: 40 } } },
  b_violet_blind: { name: "안 보고 받기", desc: "2스트라이크 타격 +70", val: 3, tag: "contact", boon: "violet", noPick: true, fx: { sit: { twoK: 70 } } },
  b_violet_stage: { name: "무대 체질", desc: "7회부터 타격 · 파워 +40 · 인기도 +20%", val: 3, tag: "clutch", boon: "violet", noPick: true, fx: { sit: { late: 40 }, fame: 0.2 } },
  // ── 듀오 축복 (두 사람 축복을 하나씩 가지면 둘 중 누구를 만나도 3장에 섞여 나옴) ──
  d_kai_zena: { name: "질풍번개", desc: "경기 주루 +60 · 타격 +30", val: 7, tag: "speed", boon: ["kai", "zena"], noPick: true, fx: { add: { run: 60, hit: 30 } } },
  d_igna_ivan: { name: "용광로", desc: "경기 파워 +50 · 득점권 파워 +40", val: 7, tag: "power", boon: ["igna", "ivan"], noPick: true, fx: { add: { power: 50 }, sit: { rispPow: 40 } } },
  d_soy_violet: { name: "채찍과 후프", desc: "경기 타격 +45 · 2스트라이크 타격 +40", val: 7, tag: "contact", boon: ["soyoung", "violet"], noPick: true, fx: { add: { hit: 45 }, sit: { twoK: 40 } } },
  d_lily_mei: { name: "비 오는 날 만두", desc: "부상 확률 -40% · 모든 훈련 +5%", val: 7, tag: "grit", boon: ["lily", "mei"], noPick: true, fx: { injury: -0.4, train: { all: 0.05 } } },
  d_kai_igna: { name: "불바람", desc: "7회부터 타격 · 파워 +50 · 경기 파워 +20", val: 7, tag: "clutch", boon: ["kai", "igna"], noPick: true, fx: { sit: { late: 50 }, add: { power: 20 } } },
  d_zena_soy: { name: "번개 채찍", desc: "경기 타격 +30 · 득점권 타격 +45", val: 7, tag: "contact", boon: ["zena", "soyoung"], noPick: true, fx: { add: { hit: 30 }, sit: { rispHit: 45 } } },
  d_ivan_mei: { name: "강유상제", desc: "경기 파워 +40 · 타격 +40", val: 7, tag: "power", boon: ["ivan", "mei"], noPick: true, fx: { add: { power: 40, hit: 40 } } },
  d_violet_lily: { name: "무지개 후프", desc: "휴식 회복 +30% · 호감 +25% · 슬럼프 무시", val: 7, tag: "luck", boon: ["violet", "lily"], noPick: true, fx: { rest: 0.3, aff: 0.25, slump: -1 } },
  // 양날
  glass: { name: "유리 몸 천재", desc: "모든 훈련 +18% / 부상 확률 +60%", val: 2, risk: true, fx: { train: { all: 0.18 }, injury: 0.6 } },
  gambler: { name: "도박꾼", desc: "자금 +60% / 슬럼프 2배", val: 2, risk: true, fx: { money: 0.6, slump: 1 } },
  allin: { name: "한방주의", desc: "경기 파워 +80 / 경기 타격 -50", val: 2, risk: true, fx: { add: { power: 80, hit: -50 } } },
  cram: { name: "실전파", desc: "경기마다 행동력 +1 / 훈련 -15%", val: 2, risk: true, fx: { gameAct: 1, train: { all: -0.15 } } },
  showoff: { name: "관종", desc: "인기도 +80% / 감독 신뢰 깎임 2배", val: 2, risk: true, fx: { fame: 0.8, trust: 1 } },
  // 나쁜 것 (이벤트)
  clutchBad: { name: "찬스 약함", desc: "득점권에서 타격 -60", val: -6, bad: true, noPick: true, fx: { sit: { rispHit: -60 } } },
  fragile: { name: "부상 체질", desc: "부상 확률 +50%", val: -6, bad: true, noPick: true, fx: { injury: 0.5 } },
  // 세트 (같은 태그 3장)
  set_clutch: { name: "클러치 히터", desc: "찬스 세트: 득점권 타격 · 파워 +60", val: 6, set: "clutch", noPick: true, fx: { sit: { rispHit: 60, rispPow: 60 } } },
  set_contact: { name: "타격 기계", desc: "컨택 세트: 경기 타격 +60", val: 6, set: "contact", noPick: true, fx: { add: { hit: 60 } } },
  set_power: { name: "거포 각성", desc: "파워 세트: 경기 파워 +60 · 홈런 치면 40% 확률로 컨디션 ▲", val: 6, set: "power", noPick: true, fx: { add: { power: 60 }, hrCond: 0.4 } },
  set_speed: { name: "바람의 아들", desc: "스피드 세트: 경기 주루 +80", val: 6, set: "speed", noPick: true, fx: { add: { run: 80 } } },
  set_grit: { name: "불굴", desc: "근성 세트: 컨디션 최악 없음 · 부상 기간 절반", val: 6, set: "grit", noPick: true, fx: { condFloor: true, injuryDur: -0.5 } },
  set_luck: { name: "럭키 가이", desc: "행운 세트: 각성 확률 3배 · 대성공 +5%", val: 6, set: "luck", noPick: true, fx: { awaken: 2, great: 0.05 } },
} satisfies Record<string, Skill>;
export type SkillId = keyof typeof SKILLS;
export const skill = (id: SkillId): Skill => SKILLS[id];
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

/** 필살타법을 배우면 종합 + (레벨당 더) */
export const LEARNED_VAL = 6;
export const SP_LV_VAL = 2;

/** 태그 장수 (세트 · 나쁜 것 · 양날 빼고) */
export function tagCount(c: Pick<Career, "skills">) {
  const n: Partial<Record<Tag, number>> = {};
  for (const id of c.skills) {
    const s = skill(id);
    if (s.tag && !s.set) n[s.tag] = (n[s.tag] ?? 0) + 1;
  }
  return n;
}

/** 축복 레벨 배율 (Lv1 · 2 · 3) */
export const BOON_MUL = [1, 1.5, 2];
export const boonLv = (c: { blv?: Partial<Record<SkillId, number>> }, id: SkillId) => c.blv?.[id] ?? 1;
const lvMul = (c: { blv?: Partial<Record<SkillId, number>> }, id: SkillId) => (skill(id).boon ? BOON_MUL[boonLv(c, id) - 1] : 1);

/** 특수능력 효과 합 (축복은 레벨 배율) */
export function fxOf(c: Pick<Career, "skills"> & { blv?: Partial<Record<SkillId, number>> }) {
  const f = {
    add: { hit: 0, power: 0, run: 0 } as Stats,
    sit: {} as NonNullable<Batter["sit"]>,
    train: { hit: 0, power: 0, run: 0, special: 0, all: 0 } as Record<TrainKey | "all", number>,
    injury: 0, injuryDur: 0, great: 0, gameAct: 0, gameSta: 0, hrCond: 0, money: 0, fame: 0, awaken: 0, slump: 0, trust: 0, condFloor: false, calm: false,
    aff: 0, rest: 0, fail: 0, stam: 0,
  };
  for (const id of c.skills) {
    const x = skill(id).fx;
    const m = lvMul(c, id);
    for (const k of STAT_KEYS) f.add[k] += (x.add?.[k] ?? 0) * m;
    if (x.sit) for (const [k, v] of Object.entries(x.sit) as [keyof typeof f.sit, number][]) f.sit[k] = (f.sit[k] ?? 0) + v * m;
    if (x.train) for (const [k, v] of Object.entries(x.train) as [TrainKey | "all", number][]) f.train[k] += v * m;
    f.injury += (x.injury ?? 0) * m;
    f.injuryDur += (x.injuryDur ?? 0) * m;
    f.great += (x.great ?? 0) * m;
    f.gameAct += (x.gameAct ?? 0) * m;
    f.gameSta += (x.gameSta ?? 0) * m;
    f.hrCond += (x.hrCond ?? 0) * m;
    f.money += (x.money ?? 0) * m;
    f.fame += (x.fame ?? 0) * m;
    f.awaken += (x.awaken ?? 0) * m;
    f.slump += x.slump ?? 0;
    f.trust += x.trust ?? 0;
    f.condFloor ||= !!x.condFloor;
    f.calm ||= !!x.calm;
    f.aff += (x.aff ?? 0) * m;
    f.rest += (x.rest ?? 0) * m;
    f.fail += (x.fail ?? 0) * m;
    f.stam += (x.stam ?? 0) * m;
  }
  f.injury = Math.max(-0.85, f.injury);
  f.injuryDur = Math.max(-0.8, f.injuryDur);
  f.stam = Math.min(0.5, f.stam);
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
/** 인연이 지도에 뜰 때 먼저 고르는 장소 (첫 만남 장면과 맞게) */
const BOND_PLACE: Partial<Record<CharId, PlaceId>> = { kai: "river", lily: "park", zena: "tv", mei: "downtown", igna: "downtown", ivan: "downtown", soyoung: "park", violet: "library" };
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
    stat: "power", place: "비 오는 산책로", pick: ["우산 들고 스윙 연습", "같이 비 구경"],
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
  mei: {
    stat: "hit", place: "딤섬 가게 뒷마당", pick: ["태극권 수련", "만두 빚기"],
    lines: ["찜기를 든 메이.", "\"힘을 빼. 공도 그래.\"", "\"빈틈은 늘 있어.\"", "\"태극 스윙. 수비 사이로 쏙.\""],
  },
  violet: {
    stat: "run", place: "밤의 실내 연습장", pick: ["후프 피하며 스텝 훈련", "매트에서 스트레칭"],
    lines: ["천장까지 올라간 후프가 빙글빙글 떨어진다… 바이올렛이다.", "\"발끝까지 쓰는 거야. 달릴 때도.\"", "\"한 바퀴 돌아도 중심은 그대로. 이 감각 기억해.\"", "\"피루엣 스윙. 박자가 어긋나도 돌면서 다시 맞춰.\""],
  },
};

/** 한 사람과의 만남 줄기 (8번) — 몇 번째 만남이 무슨 장면인지 */
export type BeatKind = "talk" | "boon" | "mini" | "final";
export const BEATS: BeatKind[] = ["talk", "boon", "talk", "mini", "talk", "boon", "talk", "final"];
export const BEAT_NAME: Record<BeatKind, string> = { talk: "이야기", boon: "인연 축복", mini: "가벼운 대결", final: "필살 전수 대결" };
export const BOND_MAX = BEATS.length;
/** 그 만남이 열리는 최소 연차 */
export const VISIT_SEASON = [1, 1, 2, 2, 3, 3, 4, 4];
/** 한 시즌에 한 사람과 나아갈 수 있는 이야기 수 (나머지 만남은 어울리기) */
export const BEATS_PER_SEASON = 2;
/** 그 만남이 열리는 최소 호감 (모자라면 그냥 어울리기 — 호감만 오름) */
export const VISIT_AFF = [0, 0, 10, 18, 28, 36, 44, 52];
/** 인연 덱 (육성에 데려가는 사람 수) */
export const DECK_SIZE = 3;
/** 대결: 공 수 · 필요 점수 (안타 1 · 홈런 2) · 몇 번째 공이 마구인지 */
export const BATTLES = {
  mini: { pitches: 3, need: 1, magic: [2] },
  final: { pitches: 5, need: 3, magic: [1, 3, 4] },
} as const;
export const roleOf = (id: BondId): Role => ROLE[id];

/* ─────────────── 상점 (경기 수당 · 연봉으로 번 자금, 단위 만원) ─────────────── */

export type ConsumableId = "drink" | "food" | "charm" | "rehab";
export const CONSUMABLES: Record<ConsumableId, { name: string; desc: string; price: number }> = {
  drink: { name: "스포츠 드링크", desc: "체력 +30", price: 150 },
  food: { name: "보양식", desc: "컨디션 +1 · 체력 +10", price: 300 },
  charm: { name: "행운의 부적", desc: "다음 훈련 대성공 확률 +25%", price: 400 },
  rehab: { name: "재활 치료", desc: "부상 남은 기간 절반", price: 600 },
};
export const CONSUMABLE_IDS = Object.keys(CONSUMABLES) as ConsumableId[];

/** 장비 3종 × 3단계 — 그 훈련 효율 + 경기 능력치. 단계마다 인기도 조건 (글러브는 수비 능력치와 함께 뺌) */
export type GearId = "bat" | "dumbbell" | "spike";
export const GEAR: Record<GearId, { name: string; stat: StatKey; train: TrainKey; tiers: [string, string, string] }> = {
  bat: { name: "배트", stat: "hit", train: "hit", tiers: ["알루미늄 배트", "카본 배트", "명장의 배트"] },
  dumbbell: { name: "웨이트 장비", stat: "power", train: "power", tiers: ["아령 세트", "파워 랙", "개인 웨이트룸"] },
  spike: { name: "스파이크", stat: "run", train: "run", tiers: ["러닝 스파이크", "경량 스파이크", "맞춤 스파이크"] },
};
export const GEAR_IDS = Object.keys(GEAR) as GearId[];
export const GEAR_TIER = [
  { price: 1200, fame: 0, train: 0.1, game: 15 },
  { price: 3500, fame: 800, train: 0.2, game: 35 },
  { price: 8000, fame: 2500, train: 0.3, game: 60 },
] as const;

/* ─────────────── 코치 (BM — 나중에 뽑기 · 등급 · 지금은 판 시작 때 고름) ───────────────
 * 결과 몫 GP ~10%, 그리고 「코치 전부 < 인연」 이어야 함 (훈련 보너스가 인연을 못 이기게) — 시뮬로 확인.
 */

export type GpId = "hitCoach" | "powCoach" | "runCoach" | "cheer";
/** 코치 등급 (지금은 전부 C · 뽑기가 붙으면 등급별로 뽑힘) */
export type CoachGrade = "C" | "B" | "A" | "S";
/** train = 그 훈련 효율 · limit = 그 능력치 한계 끌어올림 · rest = 치어리더 회복. C = 기본(효과 없음) */
export const COACH_GRADE: Record<CoachGrade, { train: number; limit: number; rest: number }> = {
  C: { train: 0, limit: 0, rest: 0 },
  B: { train: 0.15, limit: 0.17, rest: 0.13 },
  A: { train: 0.3, limit: 0.34, rest: 0.25 },
  S: { train: 0.4, limit: 0.47, rest: 0.38 },
};
const coachDesc = (g: CoachGrade, train: string, stat: string) =>
  COACH_GRADE[g].train ? `${train} +${Math.round(COACH_GRADE[g].train * 100)}% · ${stat} 한계 +${Math.round(COACH_GRADE[g].limit * 100)}%` : `기본 — 등급이 오르면 ${train} · ${stat} 한계 ↑`;
export const GP_BOOSTS: Record<GpId, { name: string; desc: (g: CoachGrade) => string; price: number; train?: TrainKey }> = {
  hitCoach: { name: "타격 코치", desc: (g) => coachDesc(g, "타격 훈련", "타격"), price: 250, train: "hit" },
  powCoach: { name: "근력 코치", desc: (g) => coachDesc(g, "근력 훈련", "파워"), price: 250, train: "power" },
  runCoach: { name: "주루 코치", desc: (g) => coachDesc(g, "주루 훈련", "주루"), price: 250, train: "run" },
  cheer: { name: "치어리더", desc: (g) => (COACH_GRADE[g].rest ? `휴식 · 개인정비 회복 +${Math.round(COACH_GRADE[g].rest * 100)}%` : "기본 — 등급이 오르면 휴식 회복 ↑"), price: 200 },
};
/** 이 판 코치 등급 (육성 모드엔 코치를 안 씀 — gp 가 비어 있음. 시뮬은 TUNE.coach 로 바꿔 봄) */
export const coachGrade = (_c: Career, _id: GpId): CoachGrade => TUNE.coach;
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
  /** 팀 정규시즌 순위 (1 ~ 4) */
  rank?: number;
  /** 가을야구 결과 — 우승 · 준우승 · 준PO 탈락 · 진출 실패 */
  post?: PostRes;
}

export type Phase = "camp" | "season" | "post" | "seasonEnd" | "off" | "retired";
export type PostRes = "우승" | "준우승" | "준PO 탈락" | "진출 실패";
/** 가을야구 진행 — 2 · 3위 준플레이오프 단판 → 1위와 한국시리즈 3판 2선승 */
export interface Post {
  stage: "semi" | "final";
  /** 상대 팀 (TEAM_DEFS 번호) */
  opp: number;
  w: number;
  l: number;
  /** 가을야구에서 치른 경기 수 (상대 · 시드용) */
  n: number;
  rank: number;
}

export interface Pending {
  kind: "scene" | "coach" | "night" | "press";
  char?: CharId;
  title: string;
  text: string;
  choices: string[];
  /** 미연시 장면: 대사 · 고르기 (반응 · 호감 · 이해) */
  scene?: { lines: string[]; opts: Choice[]; beat: number; place?: PlaceId };
}
export interface PickState {
  /** 어디서 생긴 고르기 (화면 제목) */
  from: string;
  options: SkillId[];
  /** 인연 축복 고르기 (누구의) */
  boon?: BondId;
}
/** 인연 대결 대기 중 (화면에서 직접 치거나 자동) */
export interface BattleReq {
  char: BondId;
  kind: "mini" | "final";
  pitches: number;
  need: number;
  magic: readonly number[];
  /** 진 횟수 (다시 도전) */
  tries: number;
}

export interface Career {
  v: 3;
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
  /** 이번 관리 기간에 소모품을 썼나 (관리 기간마다 하나) */
  usedItem: boolean;
  /** 행동력 (0 ~ ACTIVE_MAX) */
  active: number;
  /** 이번 관리 기간에 이미 한 지도 ❗ (char:id · ev:event) */
  done: string[];
  charmNext: boolean;
  /** 만남 횟수 (줄기 진행 0 ~ 8) */
  bonds: Partial<Record<BondId, number>>;
  /** 인연 덱 — 이 판에 데려온 사람들 (지도 · 함께 훈련에 나옴) */
  deck: BondId[];
  /** 호감 0 ~ 100 */
  aff: Partial<Record<BondId, number>>;
  /** 이해 (그 사람다운 답을 고른 수) */
  know: Partial<Record<BondId, number>>;
  /** 축복 레벨 (1 ~ 3) */
  blv: Partial<Record<SkillId, number>>;
  /** 인연 대결 대기 */
  battle: BattleReq | null;
  /** 특별한 날을 보낸 연차 */
  specials: number[];
  /** 이번 시즌 그 사람과 나아간 이야기 수 */
  bcount: Partial<Record<BondId, number>>;
  /** 이번 시즌 팀 순위표 [승, 패] — TEAM_DEFS 번호 순 (0 = 우리 팀) */
  table?: [number, number][];
  /** 팀 분위기 (MOOD.min ~ MOOD.max) — 내 경기 평가로 오르내리고, 동료 타격 · 투구에 더해짐 (careerGame TEAM_TUNE) */
  mood?: number;
  /** 가을야구 진행 중 */
  post?: Post | null;
  /** 이번 시즌 가을야구 결과 (결산에 남김) */
  postRes?: PostRes;
  /** 이어받은 선배 (계승) */
  legacy?: { name: string; skill?: SkillId };
  /** 외형 (능력치 영향 없음) */
  look: Look;
  injury: Injury | null;
  awakened: boolean;
  gp: GpId[];
  /** 수비 위치 (예전 저장엔 없음 → 타입 기본 위치) */
  pos?: FieldPos;
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
  /** 수비 위치 (없으면 타입 기본) */
  pos?: FieldPos;
  seed?: number;
  /** 인연 덱 (없으면 시드로 3명) */
  deck?: CharId[];
  /** 판을 넘어 쌓인 인연 레벨 → 시작 호감 */
  affStart?: Partial<Record<CharId, number>>;
  /** 선배의 유산 (은퇴 선수 하나에게서 특수능력 하나 · 능력치 조금) */
  legacy?: { name: string; skill?: SkillId; stats: Stats };
  look?: Look;
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
  for (const k of STAT_KEYS) stats[k] = Math.round(t.start[k] * (0.85 + rng() * 0.3) + (o.legacy ? legacyBonus(o.legacy.stats[k]) : 0));
  let deck: BondId[] = (o.deck ?? []).filter((id, i, a): id is BondId => isBond(id) && a.indexOf(id) === i).slice(0, DECK_SIZE);
  if (deck.length < DECK_SIZE) {
    const rest = BOND_IDS.filter((id) => !deck.includes(id));
    while (deck.length < DECK_SIZE) deck = [...deck, rest.splice(Math.floor(rng() * rest.length), 1)[0]];
  }
  const aff: Partial<Record<BondId, number>> = {};
  for (const id of deck) aff[id] = clamp(Math.round(o.affStart?.[id] ?? 0), 0, 30);
  const skills: SkillId[] = o.legacy?.skill && !skill(o.legacy.skill).set && !skill(o.legacy.skill).bad ? [o.legacy.skill] : [];
  return {
    v: 3,
    id: seed.toString(36),
    seed,
    name: o.name,
    num: o.num,
    bats: o.bats,
    type: o.type,
    diff: CAREER_DIFF,
    stats,
    talent,
    talentKnown: false,
    limit: TALENTS[talent].limit,
    skills,
    spXp: 0,
    stamina: 100,
    cond: 2,
    trust: 20,
    fame: 0,
    money: 1000,
    salary: 3000,
    tCount: { hit: 0, power: 0, run: 0, special: 0 },
    gear: {},
    bag: {},
    usedItem: false,
    active: ACTIVE_MAX,
    done: [],
    charmNext: false,
    bonds: {},
    deck,
    aff,
    know: {},
    blv: {},
    battle: null,
    specials: [],
    bcount: {},
    look: o.look ?? { ...DEFAULT_LOOK },
    legacy: o.legacy ? { name: o.legacy.name, skill: skills[0] } : undefined,
    injury: null,
    awakened: false,
    // 육성 모드 코치는 뺌 (밸런싱 단순하게)
    gp: o.gp ?? [],
    pos: o.pos,
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

/** 선배의 유산 — 선배 능력치에서 시작 능력치에 더해 주는 양 (최대 +40) */
export const legacyBonus = (v: number) => Math.round(clamp((v - 300) * 0.06, 0, 40));

/* ─────────────── 계산 ─────────────── */

export const age = (c: Career) => START_AGE + c.season - 1;
export const talentName = (c: Career) => (c.talentKnown ? TALENTS[c.talent].g : "?");
export const trainLv = (c: Career, k: TrainKey) => Math.min(5, 1 + Math.floor(c.tCount[k] / TRAIN_LV_EVERY));
export const spLv = (c: Career) => (c.learned ? Math.min(5, 1 + Math.floor(c.spXp / SP_EVERY)) : 0);
/** 필살타법 경기당 횟수 — 맞혀서 앞으로 보낸 기준 1번 · 마스터(Lv5)면 2번 */
export const spUses = (c: Career) => (c.learned ? (spLv(c) >= 5 ? 2 : 1) : 0);

export function ovrOf(c: Pick<Career, "stats" | "skills" | "learned" | "spXp"> & { blv?: Partial<Record<SkillId, number>> }) {
  const s = c.stats;
  let v = (s.hit + s.power + s.run) / 3;
  for (const id of c.skills) v += skill(id).val * lvMul(c, id);
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
  [950, 0.00002], [900, 0.0001], [850, 0.0005], [800, 0.002], [750, 0.005], [700, 0.01], [650, 0.03], [600, 0.07], [550, 0.19],
  [500, 0.47], [450, 0.74], [400, 0.95], [350, 0.995], [300, 0.999], [0, 1],
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
function dim(c: Career, v: number, k: StatKey) {
  return Math.max(0.02, 1 - v / limitOf(c, k));
}
/** 그 능력치 한계 (재능 한계 × 코치가 끌어올린 만큼) */
export function limitOf(c: Career, k: StatKey) {
  const coach = c.gp.find((g) => GP_BOOSTS[g]?.train === k);
  return c.limit * (1 + (coach ? COACH_GRADE[coachGrade(c, coach)].limit : 0));
}
const hasGp = (c: Career, id: GpId) => c.gp.includes(id);
/** 치어리더 회복 보너스 */
const cheerRest = (c: Career) => (hasGp(c, "cheer") ? COACH_GRADE[coachGrade(c, "cheer")].rest : 0);
const ageGrow = (c: Career) => AGE_GROW[Math.min(AGE_GROW.length - 1, c.season - 1)];

/** 능력치 올리기 (재능 · 타입 · 나이 · 높을수록 덜) — 실제 오른 값 */
function grow(c: Career, k: StatKey, base: number): number {
  const before = c.stats[k];
  const g = base * TALENTS[c.talent].mul * TYPES[c.type].apt[k] * ageGrow(c) * dim(c, before, k);
  c.stats[k] = clamp(before + g, 1, 999);
  return c.stats[k] - before;
}

/** 내 수비 위치 */
export const posOf = (c: Pick<Career, "pos" | "type">) => c.pos ?? TYPES[c.type].pos;

/** 경기에 나갈 내 선수 (컨디션 · 특수능력 · 장비 · 체력 반영) */
/**
 * 상황 보너스(득점권 · 2스트라이크 · 7회~)는 늘 붙는 게 아니라서, 경기용 한계를 셀 땐 이만큼만 셈
 * (득점권 타격 +100 → 한계 50 만큼 차지). 그 상황이 오면 보너스는 한계를 넘어 다 붙음.
 */
export const SIT_W = 0.5;
/**
 * 경기용 능력치 — 기본 + 특수능력 · 축복 + 장비 (+ 상황 보너스 몫) 을 합쳐서 재능 한계(코치 보너스 포함)까지만,
 * 그다음 컨디션 배율. 특수능력 · 축복은 한계를 넘기는 게 아니라 한계까지 빨리 채워 주는 쪽.
 * (예전엔 한계가 기본 능력치에만 걸려서 경기에선 한계 + 200 넘게 나왔음)
 */
export function careerGameStats(c: Career): { stats: Stats; raw: Stats; cap: Stats; f: number; fx: ReturnType<typeof fxOf> } {
  const f = COND_GAME[c.cond] * (c.stamina < 20 ? 0.9 : 1);
  const fx = fxOf(c);
  const gear = { hit: 0, power: 0, run: 0 } as Stats;
  for (const id of GEAR_IDS) {
    const t = c.gear[id];
    if (t) gear[GEAR[id].stat] += GEAR_TIER[t - 1].game;
  }
  const sit = fx.sit;
  const sitEq: Stats = { hit: SIT_W * ((sit.rispHit ?? 0) + (sit.twoK ?? 0) + (sit.late ?? 0)), power: SIT_W * ((sit.rispPow ?? 0) + (sit.late ?? 0)), run: 0 };
  const stats = {} as Stats, raw = {} as Stats, cap = {} as Stats;
  const rb = rookieBonus(c);
  for (const k of STAT_KEYS) {
    raw[k] = c.stats[k] + fx.add[k] + gear[k];
    // 기본 능력치가 이미 한계를 넘었으면(성장 끝자락) 그건 깎지 않음
    cap[k] = Math.max(c.stats[k], limitOf(c, k) - sitEq[k]);
    stats[k] = Math.round(clamp((Math.min(raw[k], cap[k]) + (k === "run" ? 0 : rb)) * (k === "run" ? 1 : f), 1, 999));
  }
  return { stats, raw, cap, f, fx };
}

export function careerBatter(c: Career): Batter {
  const g = careerGameStats(c);
  // 타석 연출의 「+N」도 한계에 막힌 만큼 줄여서 (실제로 붙은 만큼만)
  const used = {} as Stats;
  for (const k of STAT_KEYS) {
    const extra = g.raw[k] - c.stats[k];
    used[k] = extra > 0 ? clamp((Math.min(g.raw[k], g.cap[k]) - c.stats[k]) / extra, 0, 1) : 1;
  }
  const boosts = gameBoosts(c)
    .map((b) => {
      if (!b.add) return b;
      const add: NonNullable<Boost["add"]> = {};
      for (const k of STAT_KEYS) if (b.add[k]) add[k] = Math.round(b.add[k]! * used[k]);
      const has = Object.values(add).some((v) => v);
      return has ? { ...b, add } : b.sit ? { name: b.name, sit: b.sit } : null;
    })
    .filter((b): b is Boost => !!b);
  return {
    name: c.name,
    num: c.num,
    pos: posOf(c),
    bats: c.bats,
    hit: g.stats.hit,
    power: g.stats.power,
    run: g.stats.run,
    season: { avg: c.line.ab ? c.line.h / c.line.ab : 0, hr: c.line.hr, rbi: c.line.rbi, ab: c.line.ab, h: c.line.h },
    learned: c.learned,
    sit: g.fx.sit,
    boosts,
    look: c.look,
    grow: true,
  };
}

/** 경기 능력치를 올려 주는 특수능력만 (축복 레벨 배율 적용) — 타석 연출용 */
export function gameBoosts(c: Pick<Career, "skills"> & { blv?: Partial<Record<SkillId, number>> }): Boost[] {
  const out: Boost[] = [];
  for (const id of c.skills) {
    const x = skill(id).fx as Fx;
    const m = lvMul(c, id);
    const add: NonNullable<Boost["add"]> = {};
    for (const k of STAT_KEYS) if (x.add?.[k]) add[k] = Math.round(x.add[k]! * m);
    const sit: NonNullable<Boost["sit"]> = {};
    if (x.sit) for (const [k, v] of Object.entries(x.sit) as [keyof NonNullable<Boost["sit"]>, number][]) if (v) sit[k] = Math.round(v * m);
    const hasAdd = Object.keys(add).length > 0, hasSit = Object.keys(sit).length > 0;
    if (hasAdd || hasSit) out.push({ name: skill(id).name, ...(hasAdd ? { add } : {}), ...(hasSit ? { sit } : {}) });
  }
  return out;
}

/* ─────────────── 진행 ─────────────── */

export type Step = "turn" | "game" | "seasonEnd" | "retired" | "pending" | "pick" | "battle" | "retireAsk";
export function stepOf(c: Career): Step {
  if (c.phase === "retired") return "retired";
  if (c.pending) return "pending";
  if (c.pick) return "pick";
  if (c.battle) return "battle";
  if (c.askRetire) return "retireAsk";
  if (c.phase === "seasonEnd") return "seasonEnd";
  if (c.phase === "season" && c.slot >= 1) return "game";
  if (c.phase === "post") return "game";
  return "turn";
}

const campTurns = (_c: Career) => CAMP_TURNS;
/** 지금 구간 설명 */
export function whenText(c: Career) {
  if (c.phase === "camp") return `${c.season}년차 캠프 ${c.slot + 1}/${campTurns(c)}일`;
  if (c.phase === "off") return `${c.season}년차 비시즌 ${c.slot + 1}/${OFF_TURNS}일`;
  if (c.phase === "season") {
    const g = c.week * GAMES_PER_WEEK + c.gameInWeek + 1;
    return c.slot >= 1 ? `${c.season}년차 ${g}/${GAMES}경기` : `${c.season}년차 ${c.week + 1}주차 관리`;
  }
  if (c.phase === "post" && c.post) return `${c.season}년차 ${postName(c.post)}`;
  if (c.phase === "seasonEnd") return `${c.season}년차 시즌 결산`;
  return "은퇴";
}
/** 이번 시즌 몇 경기째 (0 부터) */
export const gameNo = (c: Career) => c.week * GAMES_PER_WEEK + c.gameInWeek;
export const postName = (p: Post) => (p.stage === "semi" ? "준플레이오프" : `한국시리즈 ${p.w + p.l + 1}차전`);
/**
 * 이번 경기 열쇠 → careerSetup 의 week 자리 (상대 = TEAM_DEFS[1 + key % 3] · 상대 선수 시드).
 * 정규시즌은 경기 번호, 가을야구는 300 + 3n + (상대 − 1) 이라 상대가 정해진 팀으로 나옴.
 */
export const gameKey = (c: Career) => (c.phase === "post" && c.post ? 300 + c.post.n * 3 + (c.post.opp - 1) : gameNo(c));

/* ─────────────── 팀 순위 · 가을야구 ─────────────── */

const newTable = (): [number, number][] => TEAM_DEFS.map(() => [0, 0]);
/** 다른 팀 시즌 전력 (시드 고정 · 서로 붙을 때 승률 ±) */
function teamPow(c: Pick<Career, "seed" | "season">) {
  const r = makeRng((c.seed * 131 + c.season * 7177 + 3) >>> 0);
  return TEAM_DEFS.map((_, i) => (i === 0 ? 0 : (r() - 0.5) * 0.24));
}
/** 순위표 — 승률 순 (같으면 시드로) */
export function standings(c: Pick<Career, "seed" | "season" | "table">) {
  const t = c.table ?? newTable();
  const pow = teamPow(c);
  return TEAM_DEFS.map((d, i) => ({ i, name: d.name, short: d.short, color: d.color, w: t[i][0], l: t[i][1], pct: t[i][0] / Math.max(1, t[i][0] + t[i][1]) }))
    .sort((a, b) => b.pct - a.pct || b.w - a.w || pow[b.i] - pow[a.i])
    .map((r, k) => ({ ...r, rank: k + 1 }));
}
export const myRank = (c: Pick<Career, "seed" | "season" | "table">) => standings(c).find((r) => r.i === 0)!.rank;
/** 다른 두 팀끼리 한 경기 */
function simOthers(c: Career, opp: number, rng: Rng) {
  const [x, y] = [1, 2, 3].filter((i) => i !== opp);
  const pow = teamPow(c);
  const xw = rng() < 0.5 + pow[x] - pow[y];
  c.table![xw ? x : y][0]++;
  c.table![xw ? y : x][1]++;
}
/**
 * 팀 분위기: 경기마다 조금 식고(keep) 내 평가만큼 더해짐 (S A B C D) · 결승타 · 끝내기 덤.
 * 평범하게 치면 0 근처, 꾸준히 S · A 면 3 ~ 5 까지 — 동료가 그만큼 잘 쳐서 순위 · 가을야구가 내 활약을 따라감
 */
export const MOOD = { d: [2, 1, 0, -0.5, -1], gw: 0.5, walkoff: 1, keep: 0.85, min: -3, max: 6, hot: 3 };
function moodAfter(c: Career, d: number, lines: string[]) {
  const before = c.mood ?? 0;
  c.mood = Math.round(clamp(before * MOOD.keep + d, MOOD.min, MOOD.max) * 100) / 100;
  if (before < MOOD.hot && c.mood >= MOOD.hot) lines.push("🔥 네 활약에 팀 분위기가 달아올랐다! (동료들 타격 · 투구 ↑)");
  else if (before >= 0 && c.mood < -1) lines.push("팀 분위기가 가라앉았다… 한 방이 필요하다.");
}
export const moodName = (m: number) => (m >= 4.5 ? "최고조" : m >= MOOD.hot ? "뜨거움" : m >= 1 ? "좋음" : m > -1 ? "보통" : "가라앉음");
/** 가을야구 보상 (자금 · 인기도 · 신뢰) — 수상 하나 = 자금 400 · 인기 100 · 신뢰 6 기준 */
const POST_PRIZE = {
  in: { money: 100, fame: 30, trust: 2 },
  semi: { money: 150, fame: 50, trust: 3 },
  second: { money: 250, fame: 80, trust: 3 },
  champ: { money: 500, fame: 200, trust: 6 },
};
function prize(c: Career, k: keyof typeof POST_PRIZE) {
  const p = POST_PRIZE[k];
  addMoney(c, p.money);
  addFame(c, p.fame);
  addTrust(c, p.trust);
  return `자금 +${p.money}만 · 인기도 +${p.fame} · 감독 신뢰 +${p.trust}`;
}
/** 정규시즌 끝 → 순위대로 가을야구 or 결산 */
function startPost(c: Career, rng: Rng, lines: string[]) {
  const st = standings(c);
  const me = st.find((r) => r.i === 0)!;
  lines.push(`정규시즌 끝 — 우리 팀 ${me.rank}위 (${me.w}승 ${me.l}패)`);
  if (me.rank > 3) {
    c.postRes = "진출 실패";
    c.phase = "seasonEnd";
    lines.push("가을야구 진출 실패…");
    return;
  }
  lines.push(`가을야구 진출! ${prize(c, "in")}`);
  if (me.rank === 1) {
    // 2 · 3위 준PO 는 결과만
    const pow = teamPow(c);
    const [a, b] = [st[1].i, st[2].i];
    const aw = rng() < 0.55 + pow[a] - pow[b];
    const opp = aw ? a : b;
    c.post = { stage: "final", opp, w: 0, l: 0, n: 0, rank: 1 };
    lines.push(`1위로 한국시리즈 직행! 준플레이오프에서 올라온 ${TEAM_DEFS[opp].name}와 3판 2선승`);
  } else {
    const opp = st[me.rank === 2 ? 2 : 1].i;
    c.post = { stage: "semi", opp, w: 0, l: 0, n: 0, rank: me.rank };
    lines.push(`준플레이오프 단판 — ${TEAM_DEFS[opp].name}! 이기면 한국시리즈`);
  }
  c.phase = "post";
}
/** 가을야구 한 경기 결과 */
function postGame(c: Career, win: boolean | null, rng: Rng, lines: string[]) {
  const p = c.post!;
  p.n++;
  if (win === null) {
    lines.push("무승부 — 다시 붙는다");
    return;
  }
  if (p.stage === "semi") {
    if (!win) {
      c.postRes = "준PO 탈락";
      lines.push("준플레이오프 패배… 올해 가을은 여기까지.");
      return endPost(c);
    }
    const top = standings(c)[0].i;
    lines.push(`준플레이오프 승리! ${prize(c, "semi")}`, `한국시리즈 — ${TEAM_DEFS[top].name}와 3판 2선승`);
    c.post = { stage: "final", opp: top, w: 0, l: 0, n: p.n, rank: p.rank };
    return;
  }
  if (win) p.w++;
  else p.l++;
  lines.push(`한국시리즈 ${p.w}승 ${p.l}패`);
  if (p.w >= 2) {
    c.postRes = "우승";
    lines.push(`🏆 우승!! ${prize(c, "champ")}`, "우승 보상으로 특수능력 하나를 고를 수 있다.");
    makePick(c, rng, `${c.season}년차 우승 보상`);
    return endPost(c);
  }
  if (p.l >= 2) {
    c.postRes = "준우승";
    lines.push(`준우승. ${prize(c, "second")}`);
    return endPost(c);
  }
}
function endPost(c: Career) {
  c.post = null;
  c.phase = "seasonEnd";
}

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

const addActive = (c: Career, d: number) => (c.active = clamp(c.active + d, 0, ACTIVE_MAX));
/** 이 행동에 드는 행동력 */
export function costOf(a: Action): number {
  switch (a.kind) {
    case "train":
      return a.key === "special" ? 5 : 4;
    case "meet":
      return 5;
    case "event":
      return a.event === "secret" ? 6 : 5;
    default:
      return 3;
  }
}
export const MIN_COST = 3;

/** 관리 끝 → 경기로 (시즌) / 다음 날로 (캠프 · 비시즌) */
export function advance(c: Career) {
  if (stepOf(c) !== "turn") throw new Error("관리 차례 아님");
  c.turn++;
  c.usedItem = false;
  c.done = [];
  if (c.phase === "season") {
    c.slot = 1;
    return;
  }
  c.slot++;
  tickInjury(c);
  addActive(c, ACTIVE_PER_DAY);
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
    c.active = ACTIVE_MAX;
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
  /** 미연시 장면 (전신 그림 + 대사) */
  vn?: { char: CharId; lines: string[]; skin?: string; place?: PlaceId; key?: string };
  /** 호감 변화 */
  aff?: number;
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
  return p;
}

function hurt(c: Career, rng: Rng, worse: boolean): string[] {
  let r = rng();
  if (worse) r *= 0.6;
  const kind: Injury["kind"] = r < 0.12 ? 2 : r < 0.42 ? 1 : 0;
  let left = [2, 5, 11][kind];
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
    fail: clamp(0.05 + (Math.max(0, 50 - c.stamina) / 50) * 0.3 - fx.fail, 0, 0.5),
    great: 0.09 + c.cond * 0.025 + (c.charmNext ? 0.25 : 0) + fx.great,
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
    (1 + c.gp.filter((g) => GP_BOOSTS[g]?.train === k).reduce((a, g) => a + COACH_GRADE[coachGrade(c, g)].train, 0))
  );
}

/** 훈련 */
function train(c: Career, k: TrainKey, rng: Rng): TurnOut {
  const t = TRAINS[k];
  const a = snap(c);
  const lines: string[] = [];
  const cost = t.cost * (1 - fxOf(c).stam);
  if (rng() < injuryP(c)) {
    addStamina(c, -cost);
    const l = hurt(c, rng, c.stamina < 15);
    c.charmNext = false;
    return { title: `${t.name} 중 부상!`, tone: "injury", lines: l, delta: diffOf(c, a) };
  }
  const { fail: failP, great: greatP } = trainRisk(c);
  c.charmNext = false;
  const r = rng();
  const tone: TurnOut["tone"] = r < failP ? "fail" : r < failP + greatP ? "great" : "ok";
  // 함께 훈련 (인연 덱 캐릭터가 이 훈련에 와 있으면)
  const mate = k !== "special" ? trainersOf(c)[k] : undefined;
  let mateMul = 1;
  if (mate) {
    mateMul = 1.3 + Math.min(0.3, (c.aff[mate] ?? 0) / 330);
    c.done.push(`tr:${mate}`);
    const d = addAff(c, mate, 3);
    lines.push(`${charById(mate).name}와 함께 훈련! 효율 ×${mateMul.toFixed(2)} · 호감 +${d}`);
  }
  const mul = (tone === "fail" ? 0.3 : tone === "great" ? 2 : 1) * COND_TRAIN[c.cond] * trainMul(c, k) * mateMul * (0.85 + rng() * 0.3);
  const rookie = c.season === 1 ? ROOKIE.train : 1;
  for (const [sk, w] of Object.entries(t.gain) as [StatKey, number][]) grow(c, sk, BASE_GAIN * TRAIN_GAIN * w * mul * TUNE.train * rookie);
  addStamina(c, -cost);
  c.tCount[k]++;
  if (k === "special") {
    const before = spLv(c);
    c.spXp += tone === "great" ? 2 : tone === "fail" ? 0 : 1;
    if (spLv(c) > before) lines.push(spLv(c) >= 5 ? "필살타법 마스터! 이제 경기당 2번" : `필살타법 레벨 ${spLv(c)}!`);
  } else if (c.tCount[k] % TRAIN_LV_EVERY === 0 && c.tCount[k] / TRAIN_LV_EVERY < 5) lines.push(`${t.name} 레벨 ${trainLv(c, k)}!`);
  addTrust(c, 0.4);
  if (tone === "great") addCond(c, rng() < 0.3 ? 1 : 0);
  const title = tone === "great" ? `${t.name} 대성공!` : tone === "fail" ? `${t.name} 실패…` : t.name;
  if (tone === "fail") lines.unshift("몸이 무거워서 집중이 안 됐다.");
  return { title, tone, lines, delta: diffOf(c, a), char: mate };
}

/* ─────────────── 이번 주 지도 (등장 캐릭터 · 장소 이벤트) ─────────────── */

export interface Spot {
  place: PlaceId;
  char?: BondId;
  event?: SpotEvent;
  /** 특별한 날 */
  special?: boolean;
}

/** 호감 올리기 (축복 보너스 반영) — 실제 오른 값 */
function addAff(c: Career, id: BondId, d: number) {
  const before = c.aff[id] ?? 0;
  const v = d > 0 ? d * (1 + fxOf(c).aff) : d;
  c.aff[id] = clamp(Math.round(before + v), 0, 100);
  return c.aff[id]! - before;
}

/** 다음 만남이 연차에 막혔나 — 이유 (막히면 지도에 안 뜸) */
export function bondLock(c: Career, id: BondId): string | null {
  const v = c.bonds[id] ?? 0;
  if (v >= BOND_MAX) return null;
  if (c.season < VISIT_SEASON[v]) return `${VISIT_SEASON[v]}년차부터`;
  return null;
}
/** 다음 만남 미리보기 (지도 · 인연 화면) */
export function nextBeat(c: Career, id: BondId): { kind: BeatKind | "hang"; why?: string } {
  const v = c.bonds[id] ?? 0;
  if (v >= BOND_MAX) return { kind: "hang" };
  if (c.battle?.char === id) return { kind: BEATS[v] };
  if (c.season < VISIT_SEASON[v]) return { kind: "hang", why: `${VISIT_SEASON[v]}년차부터` };
  if ((c.aff[id] ?? 0) < VISIT_AFF[v]) return { kind: "hang", why: `호감 ${VISIT_AFF[v]} 필요` };
  if ((c.bcount[id] ?? 0) >= BEATS_PER_SEASON) return { kind: "hang", why: "다음 시즌에" };
  return { kind: BEATS[v] };
}

/** 이번 관리 기간에 지도에 뜨는 것 (시드 · 연차 · 주 · 인연으로 정해짐 — 새로고침해도 같음) */
function layout(c: Career) {
  const rng = makeRng((c.seed * 7919 + c.season * 104729 + (c.phase === "season" ? c.week : 100 + c.slot + (c.phase === "off" ? 50 : 0)) * 1009) >>> 0);
  const free = [...SPOT_IDS];
  const take = () => free.splice(Math.floor(rng() * free.length), 1)[0];
  const out: Spot[] = [];
  const trainers: Partial<Record<TrainKey, BondId>> = {};
  // 비시즌 첫날: 특별한 날 (덱에서 호감 제일 높은 사람, 40 이상)
  const top = TUNE.noBond ? undefined : topAff(c);
  if (c.phase === "off" && c.slot === 0 && top && (c.aff[top] ?? 0) >= 40 && !c.specials.includes(c.season)) {
    free.splice(free.indexOf("downtown"), 1);
    out.push({ place: "downtown", char: top, special: true });
  }
  // 덱 사람마다: 외출 장소에 나오거나(❗) · 자기 훈련에 함께 오거나 · 안 나옴
  // 지도엔 한 주에 한 사람까지 · 이야기가 준비된 사람 20% (아니면 8%) — 예전(45% · 사람 수 제한 없음)엔 매주 누군가 떠 있어서
  // 만나러만 다니면 훈련할 틈이 없었음 (만남 = 행동력 5, 한 주 수입 6). 나머지는 함께 훈련으로 (행동력 추가 없음)
  const order = TUNE.noBond ? [] : [...c.deck].sort(() => rng() - 0.5);
  for (const id of order) {
    if (out.some((x) => x.char === id)) continue;
    const r = rng();
    const quiet = nextBeat(c, id).kind === "hang";
    const onMap = !out.some((x) => x.char);
    if (onMap && r < (quiet ? 0.08 : 0.2)) {
      // 그 사람 이야기에 맞는 장소가 비어 있으면 거기로 (번화가에서 만났는데 장면은 「새벽 강변」이던 것)
      const pref = BOND_PLACE[id];
      const place = pref && free.includes(pref) ? free.splice(free.indexOf(pref), 1)[0] : take();
      out.push({ place, char: id });
    }
    else if (r < 0.55) {
      const k = BONDS[id].stat as TrainKey;
      if (!trainers[k]) trainers[k] = id;
    }
  }
  // 장소 이벤트 (40% · 퀴즈쇼는 드물게)
  if (rng() < 0.4) {
    const evs = (Object.keys(SPOT_EVENTS) as SpotEvent[]).filter((e) => free.includes(SPOT_EVENTS[e].place) && (e !== "cf" || c.fame >= 300) && (e !== "signing" || c.fame >= 150));
    const ew = (e: SpotEvent) => (e === "quiz" ? 0.35 : 1);
    if (evs.length) {
      let r = rng() * evs.reduce((s, e) => s + ew(e), 0);
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
  return { spots: out, trainers };
}
export function spotsOf(c: Career): Spot[] {
  return layout(c).spots.filter((sp) => !c.done.includes(sp.char ? `char:${sp.char}` : `ev:${sp.event}`));
}
/** 이번 관리 기간 「함께 훈련」 — 훈련 종류 → 와 있는 사람 (한 번 같이 하면 돌아감) */
export function trainersOf(c: Career): Partial<Record<TrainKey, BondId>> {
  const t = layout(c).trainers;
  for (const k of Object.keys(t) as TrainKey[]) if (c.done.includes(`tr:${t[k]}`)) delete t[k];
  return t;
}
/** 덱에서 호감 제일 높은 사람 */
export function topAff(c: Career): BondId | undefined {
  return [...c.deck].sort((a, b) => (c.aff[b] ?? 0) - (c.aff[a] ?? 0))[0];
}

/** 캐릭터 만나기 — 줄기 진행 (이야기 · 축복 · 대결), 호감 모자라면 어울리기 */
function meet(c: Career, id: BondId, place: PlaceId, rng: Rng): TurnOut {
  const a = snap(c);
  const ch = charById(id);
  const b = BONDS[id];
  const v = c.bonds[id] ?? 0;
  const where = PLACES[place].name;
  addStamina(c, 8);
  addCond(c, 1);
  const nb = nextBeat(c, id);
  if (nb.kind === "hang") {
    grow(c, b.stat, 8);
    const d = addAff(c, id, v >= BOND_MAX ? 4 : 7);
    const lines = v >= BOND_MAX ? [`${where}에서 ${ch.name}와 즐거운 시간.`] : [`${where}에서 ${ch.name}와 어울렸다.`, `(다음 이야기는 ${nb.why})`];
    return { title: `${ch.name}와 한때`, tone: "ok", lines, delta: diffOf(c, a), char: id, aff: d };
  }
  const beat = STORY[id][v];
  const title = `${ch.name} · ${BEAT_NAME[nb.kind]}`;
  if (nb.kind !== "mini" && nb.kind !== "final") c.bcount[id] = (c.bcount[id] ?? 0) + 1;
  if (nb.kind === "talk") {
    const opts: Choice[] = [...(beat.choices ?? [])];
    if (beat.special && (c.know[id] ?? 0) >= beat.special.need) opts.push(beat.special.choice);
    c.bonds[id] = v + 1;
    c.pending = { kind: "scene", char: id, title, text: beat.lines[beat.lines.length - 1], choices: opts.map((o) => o.text), scene: { lines: beat.lines, opts, beat: v, place } };
    return { title, tone: "event", lines: [], delta: diffOf(c, a), char: id, stub: true };
  }
  if (nb.kind === "boon") {
    c.bonds[id] = v + 1;
    grow(c, b.stat, 14);
    const d = addAff(c, id, 5);
    makeBoonPick(c, id, rng, `${ch.name}의 축복`);
    return { title, tone: "event", lines: [`${ch.name}의 축복 — 하나를 고를 수 있다.`], delta: diffOf(c, a), char: id, aff: d, vn: { char: id, lines: beat.lines, place, key: `${id}:${v}` } };
  }
  // 대결 (이기면 다음 줄기)
  const B = BATTLES[nb.kind];
  c.battle = { char: id, kind: nb.kind, pitches: B.pitches, need: B.need, magic: B.magic, tries: c.battle?.char === id ? c.battle.tries : 0 };
  return { title, tone: "event", lines: [`${ch.name}의 공 ${B.pitches}개 · ${B.need}점 이상이면 승리 (안타 1 · 홈런 2)`], delta: diffOf(c, a), char: id, vn: { char: id, lines: beat.lines, place, key: `${id}:${v}` } };
}

/** 특별한 날 (비시즌 첫날, 호감 1위) */
function specialDay(c: Career, id: BondId, rng: Rng): TurnOut {
  const a = snap(c);
  const ch = charById(id);
  const sd = SPECIAL_DAY[ROLE[id]];
  c.specials.push(c.season);
  addCond(c, 2);
  addStamina(c, 30);
  const d = addAff(c, id, 10);
  makeBoonPick(c, id, rng, `${sd.title} — ${ch.name}의 선물`);
  return { title: `${sd.title} · ${ch.name}`, tone: "event", lines: [`호감 +${d} · 컨디션 ↑ · 축복 하나를 고를 수 있다.`], delta: diffOf(c, a), char: id, aff: d, vn: { char: id, lines: sd.lines(ch.name), skin: sd.skin[id] } };
}

/** 인연 축복 3장 — 그 사람 축복(겹치면 레벨 업) + 조건 맞는 듀오 */
function makeBoonPick(c: Career, id: BondId, rng: Rng, from: string) {
  const own = (x: SkillId) => c.skills.includes(x);
  const lv = (x: SkillId) => (own(x) ? boonLv(c, x) : 0);
  const mine = (BOONS[id] as SkillId[]).filter((x) => lv(x) < 3);
  const hasFrom = (who: BondId) => (BOONS[who] as SkillId[]).some(own);
  const duos = DUOS.filter((d) => (d.a === id || d.b === id) && hasFrom(d.a) && hasFrom(d.b) && lv(d.id as SkillId) < 3).map((d) => d.id as SkillId);
  const opts: SkillId[] = [];
  if (duos.length && rng() < 0.6) opts.push(rng.pick(duos));
  const pool = [...mine];
  while (opts.length < 3 && pool.length) opts.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  if (!opts.length) {
    makePick(c, rng, from);
    return;
  }
  c.pick = { from, options: opts, boon: id };
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
    if (makePick(c, rng, "야구 퀴즈쇼 우승")) lines.push("퀴즈쇼 우승! 상품으로 특수능력 하나를 고를 수 있다.");
    else {
      // 고를 특수능력이 다 떨어졌으면 상금으로
      addMoney(c, 300);
      lines.push("퀴즈쇼 우승! 이미 다 아는 문제라 상금만 두둑이 받았다.");
    }
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
  if (rng() >= p * (1 + fxOf(c).awaken)) return;
  const a = snap(c);
  c.awakened = true;
  c.talent = Math.min(TALENTS.length - 1, c.talent + 1);
  c.limit = TALENTS[c.talent].limit + 40;
  for (const k of STAT_KEYS) grow(c, k, 30);
  addCond(c, 4);
  c.talentKnown = true;
  return { title: "각성!", tone: "awaken", lines: ["몸 안에서 뭔가가 깨어났다…!", `숨은 재능이 ${TALENTS[c.talent].g}급으로 올랐다 · 한계 돌파!`], delta: diffOf(c, a) };
}

/* ─────────────── 특수능력 고르기 (3장 중 1장) ─────────────── */

/** 고를 카드 3장 — 가진 태그 쪽 1장은 웬만하면 넣어서 세트를 노릴 수 있게, 양날 카드 가끔 */
/** 특수능력 고르기 만들기 — 고를 카드가 하나도 없으면 false */
function makePick(c: Career, rng: Rng, from: string) {
  const owned = new Set(c.skills);
  const pool = SKILL_IDS.filter((id) => !owned.has(id) && !skill(id).noPick && !skill(id).set && !skill(id).bad);
  if (!pool.length) return false;
  const opts: SkillId[] = [];
  const tags = Object.entries(tagCount(c)).filter(([, n]) => (n ?? 0) > 0 && (n ?? 0) < 3).map(([t]) => t as Tag);
  const want = tags.length ? pool.filter((id) => !skill(id).risk && tags.includes(skill(id).tag as Tag)) : [];
  if (want.length && rng() < 0.75) opts.push(rng.pick(want));
  const risky = pool.filter((id) => skill(id).risk && !opts.includes(id));
  if (risky.length && rng() < 0.35) opts.push(rng.pick(risky));
  const rest = pool.filter((id) => !opts.includes(id) && !skill(id).risk);
  while (opts.length < 3 && rest.length) opts.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]);
  // 일반 카드를 다 모았으면 남은 양날 카드로 채움 (예전엔 양날만 남으면 0장짜리 고르기 창이 떴음)
  const left = risky.filter((id) => !opts.includes(id));
  while (opts.length < 3 && left.length) opts.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
  if (!opts.length) return false;
  // 섞기
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  c.pick = { from, options: opts };
  return true;
}

/** 고르기 답 (-1 = 건너뛰기) */
export function choosePick(c: Career, i: number): TurnOut {
  const p = c.pick;
  if (!p) throw new Error("고르기 없음");
  const a = snap(c);
  c.pick = null;
  if (i < 0 || !p.options[i]) return { title: "넘겼다", tone: "ok", lines: ["이번엔 아무것도 안 골랐다."], delta: diffOf(c, a) };
  const id = p.options[i];
  let lines: string[];
  if (skill(id).boon && c.skills.includes(id)) {
    c.blv[id] = Math.min(3, boonLv(c, id) + 1);
    lines = [`축복 「${skill(id).name}」 Lv${c.blv[id]}! (효과 ×${BOON_MUL[c.blv[id]! - 1]})`];
  } else {
    lines = gainSkill(c, id);
    // 이해가 깊으면 새 축복이 Lv2 로 시작
    if (p.boon && skill(id).boon && (c.know[p.boon] ?? 0) >= 3) {
      c.blv[id] = 2;
      lines.push(`이해 보너스 — 처음부터 Lv2!`);
    }
  }
  if (p.boon) addAff(c, p.boon, 2);
  pushLog(c, `${p.from}: 「${skill(id).name}」`);
  return { title: skill(id).name, tone: lines.length > 1 ? "great" : "event", lines, delta: diffOf(c, a), char: p.boon };
}

/* ─────────────── 인연 대결 ─────────────── */

/**
 * 대결 결과 반영 — pts = 점수 (안타 1 · 홈런 2).
 * 이기면 줄기 진행: 가벼운 대결 → 축복 고르기 · 필살 전수 대결 → 필살타법 (이미 있으면 축복 레벨 업 고르기). 지면 다음 만남에 다시.
 */
export function finishBattle(c: Career, pts: number, auto = false): TurnOut {
  const bt = c.battle;
  if (!bt) throw new Error("대결 없음");
  const rng = turnRng(c, 23 + bt.tries);
  const a = snap(c);
  const id = bt.char;
  const ch = charById(id);
  const b = BONDS[id];
  c.battle = null;
  const lines: string[] = [`${pts}점 / ${bt.need}점${auto ? " (자동)" : ""}`];
  let aff: number;
  if (pts < bt.need) {
    bt.tries++;
    grow(c, b.stat, 5);
    aff = addAff(c, id, 3);
    lines.push(`${ch.name}: "아직이야. 다음에 또 와."`, "(다음에 만나면 다시 도전)");
    pushLog(c, `${ch.name}와 대결 패배 (${pts}점)`);
    return { title: `${ch.name}와 대결 — 패배`, tone: "fail", lines, delta: diffOf(c, a), char: id, aff };
  }
  c.bonds[id] = (c.bonds[id] ?? 0) + 1;
  c.bcount[id] = (c.bcount[id] ?? 0) + 1;
  aff = addAff(c, id, bt.kind === "final" ? 10 : 7);
  let extra: TurnOut | undefined;
  if (bt.kind === "mini") {
    grow(c, b.stat, 18);
    makeBoonPick(c, id, rng, `${ch.name}에게 이겼다! 축복`);
    lines.push(`${ch.name}: "…좋아, 인정."`, "축복 하나를 고를 수 있다.");
  } else {
    grow(c, b.stat, 34);
    for (const k of STAT_KEYS) if (k !== b.stat) grow(c, k, 8);
    if (!c.learned) {
      c.learned = id;
      lines.push(`필살타법 「${ch.swing.name}」 전수! 경기당 ${spUses(c)}번 · 운동장에서 「필살타법 훈련」이 열렸다.`);
    } else {
      lines.push(`이미 「${charById(c.learned).swing.name}」을 익혀서 — 대신 ${ch.name}의 축복을 하나 더.`);
      makeBoonPick(c, id, rng, `${ch.name}의 마지막 가르침`);
    }
    extra = tryAwaken(c, rng, 0.02);
  }
  pushLog(c, `${ch.name}와 대결 승리 (${pts}점)`);
  return { title: `${ch.name}와 대결 — 승리!`, tone: "great", lines, delta: diffOf(c, a), char: id, aff, extra };
}

/** 대결 자동 (봇 · 「자동으로」) — 타격 · 파워 · 실력(σ)으로 공마다 안타/홈런 확률 */
export function autoBattle(c: Career, rng: Rng, sigma = 0.075): number {
  const bt = c.battle;
  if (!bt) return 0;
  const bb = careerBatter(c);
  const skillF = clamp(1.35 - sigma * 6, 0.6, 1.25);
  let pts = 0;
  for (let i = 0; i < bt.pitches; i++) {
    const magic = bt.magic.includes(i);
    const pHit = clamp((0.2 + bb.hit / 2200) * skillF * (magic ? 0.6 : 1), 0.05, 0.75);
    if (rng() < pHit) pts += rng() < clamp(0.06 + bb.power / 2600, 0.05, 0.45) ? 2 : 1;
  }
  return pts;
}

/* ─────────────── 무작위 이벤트 ─────────────── */

function randomEvent(c: Career, rng: Rng): TurnOut | undefined {
  if (c.pending || c.pick || c.battle || c.injury) return;
  const done = Math.min(2, Object.values(c.bonds).filter((v) => (v ?? 0) >= BOND_MAX).length);
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
  | { kind: "meet"; char: BondId }
  | { kind: "event"; event: SpotEvent }
  | { kind: "stroll"; place: PlaceId };

export const CLINIC_PRICE = 250;

/** 할 수 없으면 이유 (화면에 그대로) */
export function whyNot(c: Career, a: Action): string | null {
  if (stepOf(c) !== "turn") return "지금은 관리 차례가 아니에요";
  if (c.injury && !(a.kind === "rest" || a.kind === "clinic" || a.kind === "care")) return "부상 중엔 숙소 · 병원만";
  if (c.active < costOf(a)) return `행동력이 모자라요 (⚡${costOf(a)} 필요)`;
  if (a.kind === "train" && a.key === "special" && !c.learned) return "필살타법을 배워야 열려요 (인연 「필살 전수 대결」)";
  if (a.kind === "train" && a.key === "special" && spLv(c) >= 5) return "필살타법 마스터 (Lv5) — 더 오를 게 없어요";
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
  addActive(c, -costOf(a));
  const s0 = snap(c);
  switch (a.kind) {
    case "train":
      out = train(c, a.key, rng);
      break;
    case "rest":
      addStamina(c, (c.injury ? 30 : 45) * (1 + fxOf(c).rest + cheerRest(c)));
      if (rng() < 0.35) addCond(c, 1);
      out = { title: c.injury ? "숙소에서 요양" : "휴식", tone: "ok", lines: [c.injury ? "몸을 추슬렀다." : "푹 쉬었다."], delta: diffOf(c, s0) };
      break;
    case "care":
      addStamina(c, 20 * (1 + fxOf(c).rest + cheerRest(c)));
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
      c.done.push(`char:${a.char}`);
      out = sp.special ? specialDay(c, a.char, rng) : meet(c, a.char, sp.place, rng);
      break;
    }
    case "event":
      c.done.push(`ev:${a.event}`);
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
  c.turn++;
  return out;
}

/** 고르기 이벤트 답 */
export function choose(c: Career, pick: number): TurnOut {
  const p = c.pending;
  if (!p) throw new Error("고를 이벤트 없음");
  const rng = turnRng(c, 7);
  const a = snap(c);
  c.pending = null;
  const lines: string[] = [];
  let tone: TurnOut["tone"] = "event";
  let aff: number | undefined;
  if (p.kind === "scene" && p.scene) {
    const id = p.char as BondId;
    const o = p.scene.opts[pick] ?? p.scene.opts[0];
    aff = addAff(c, id, o.aff);
    if (o.know) c.know[id] = (c.know[id] ?? 0) + 1;
    grow(c, BONDS[id].stat, 8 + o.aff * 0.8);
    lines.push(`호감 ${aff >= 0 ? "+" : ""}${aff}${o.know ? " · 마음이 통했다 (이해 +1)" : ""}`);
    pushLog(c, `${p.title}: ${o.text}`);
    return { title: p.title, tone: o.know ? "great" : "event", lines, delta: diffOf(c, a), char: id, aff, vn: { char: id, lines: [`▶ ${o.text}`, o.reply] } };
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
  if (c.usedItem) return "이번 관리 때 이미 하나 썼어요";
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
  /** 미션 결과 하나씩 (실패 패널티 · 인연 미션 호감) — 없으면 성공 수만 */
  results?: { ok: boolean; partial?: boolean; char?: CharId }[];
  /** 직접 쳤나 (자동이면 false) */
  direct: boolean;
  /** 영양가 — 결승타 · 역전타 · 끝내기 · 병살 */
  clutch?: Clutch;
}
/** 영양가 점수: 결승타 +1 · 역전타 +1 · 끝내기 +1.5 · 병살 −0.5 (경기 4.8% · 0.8% · 0.6% · 18% 에 나옴) */
export const CLUTCH_W = { gw: 1, comeback: 1, walkoff: 1.5, gidp: -0.5 };
/**
 * 경기 평가 S ~ D (성장 배율). 분포 목표 S 6 · A 20 · B 32 · C 25 · D 17% (scratchpad grade.ts 로 맞춤 — 사람 σ50ms · 능력 150~600 · 타입 4개 1920경기).
 * 예전엔 S 20%라 4타수 2안타 0타점에도 S 가 떴음 → 단타 몫 낮추고 아웃 수 · 타점 · 홈런 비중 올림, 미션 성공은 +0.5 만.
 * 경기는 능력치를 직접 올리지 않음 — 능력치는 훈련 · 활동 · 이벤트로만. 경기 평가는 다음 활동 밑천(행동력 · 체력 · 컨디션)으로:
 *   act = 행동력 (ACTIVE_PER_GAME 에 더함) · sta = 체력 · up / down = 컨디션 ▲ / ▼ 확률
 */
export const GAME_GRADES = [
  { g: "S", act: 2, sta: 3, up: 0.7, down: 0, color: "#ff7ae0" },
  { g: "A", act: 1, sta: -2, up: 0.35, down: 0, color: "#ffcf4a" },
  { g: "B", act: 0, sta: -5, up: 0, down: 0, color: "#7dff9a" },
  { g: "C", act: 0, sta: -7, up: 0, down: 0, color: "#7ad7ff" },
  { g: "D", act: -1, sta: -8, up: 0, down: 0.35, color: "#9a9a9a" },
] as const;
/** 경기 평가 가중치 — 타입마다 「제 몫」을 다르게 봄 (준족은 출루 · 득점, 거포는 장타) */
const GRADE_W: Record<BatType, { s: number; xb: number; hr: number; bb: number; r: number }> = {
  contact: { s: 1.3, xb: 1.9, hr: 3.0, bb: 0.8, r: 0.5 },
  power: { s: 0.8, xb: 1.8, hr: 3.2, bb: 0.6, r: 0.4 },
  speed: { s: 1.15, xb: 1.9, hr: 3.0, bb: 0.8, r: 0.8 },
  defense: { s: 1.0, xb: 1.8, hr: 3.0, bb: 0.7, r: 0.55 },
  all: { s: 1.0, xb: 1.8, hr: 3.0, bb: 0.65, r: 0.5 },
};
/** S · A · B · C 문턱 (그 아래는 D) */
const GRADE_CUT = [6.4, 3.1, 0.95, -0.4];
export function gameGrade(l: BatLine, missions: number, type: BatType = "all", cl?: Clutch) {
  const w = GRADE_W[type];
  const singles = l.h - l.d2 - l.d3 - l.hr;
  const sc =
    singles * w.s + (l.d2 + l.d3 * 1.3) * w.xb + l.hr * w.hr + l.bb * w.bb + l.rbi * 0.8 + l.r * w.r + missions * 0.5 - l.k * 0.25 - (l.ab - l.h) * 0.3 +
    (cl ? (cl.gw ? CLUTCH_W.gw : 0) + cl.comeback * CLUTCH_W.comeback + (cl.walkoff ? CLUTCH_W.walkoff : 0) + cl.gidp * CLUTCH_W.gidp : 0);
  const i = GRADE_CUT.findIndex((c) => sc >= c);
  return i < 0 ? 4 : i;
}

export interface GameSummary {
  title: string;
  lines: string[];
  delta: Delta;
  dnp: boolean;
  grade?: number;
  win?: boolean | null;
  /** 이번 경기로 받은 행동력 */
  act?: number;
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
  let act = ACTIVE_PER_GAME;
  const win = g ? g.win : rng() < 0.5;
  if (win === true) c.wins++;
  else if (win === false) c.losses++;
  const fx = fxOf(c);
  if (!g) {
    title = `결장 (${INJURY_NAME[c.injury?.kind ?? 0]}) · 팀 ${win ? "승리" : win === false ? "패배" : "무승부"}`;
    lines.push("벤치에서 동료들을 응원했다.");
    moodAfter(c, 0, lines);
    addTrust(c, -0.6);
    addStamina(c, 8);
  } else {
    const l = g.line;
    // 가을야구 기록은 정규시즌 기록(수상 · 연봉)과 따로 — 통산에만 더함
    const L = c.phase === "post" ? c.total : c.line;
    L.g++;
    for (const k of ["pa", "ab", "h", "d2", "d3", "hr", "rbi", "bb", "k", "r"] as const) L[k] += l[k];
    // 경기 평가 — 능력치 대신 행동력 · 체력 · 컨디션 (잘 칠수록 다음 훈련 · 활동을 더 할 수 있게)
    grade = gameGrade(l, g.missions, c.type, g.clutch);
    const G = GAME_GRADES[grade];
    act = ACTIVE_PER_GAME + G.act + fx.gameAct;
    moodAfter(c, MOOD.d[grade] + (g.clutch?.walkoff ? MOOD.walkoff : g.clutch?.gw ? MOOD.gw : 0), lines);
    const tr = l.h * 2.5 + l.hr * 4 + l.rbi * 1 + l.bb * 1 - l.k * 1.5 - Math.max(0, l.ab - l.h - l.k) * 1.2 + g.missions * 4 - 0.5;
    addTrust(c, tr * 0.45);
    addStamina(c, G.sta + fx.gameSta);
    // 컨디션: S · A 가끔 ▲ · D 가끔 ▼ · 홈런 치면 장타 특능 확률로 ▲
    let up = rng() < G.up;
    for (let i = 0; i < l.hr && !up; i++) up = rng() < fx.hrCond;
    if (up) addCond(c, 1);
    else if (rng() < G.down) addCond(c, -1);
    addFame(c, l.h * 0.5 + l.hr * 3 + g.missions * 2 + (grade === 0 ? 5 : 0));
    addMoney(c, 15 + l.h * 6 + l.hr * 15 + l.rbi * 3 + Math.round(g.missionPt / 3) + (win ? 10 : 0));
    title = `[${GAME_GRADES[grade].g}] ${l.ab}타수 ${l.h}안타${l.hr ? ` ${l.hr}홈런` : ""}${l.rbi ? ` ${l.rbi}타점` : ""}${l.bb ? ` ${l.bb}볼넷` : ""} · 팀 ${win ? "승리" : win === false ? "패배" : "무승부"}`;
    if (l.hr >= 2) lines.push("멀티 홈런! 오늘의 주인공.");
    else if (l.h >= 3) lines.push("맹타! 감독이 엄지를 들었다.");
    else if (l.h === 0) lines.push("오늘은 안 풀렸다…");
    if (g.missions) lines.push(`돌발미션 ${g.missions}개 성공!`);
    // 영양가: 끝내기 · 결승타 · 역전타는 감독 신뢰 · 인기 조금, 병살은 신뢰 ↓
    const cl = g.clutch;
    if (cl) {
      if (cl.walkoff) lines.push("🎉 끝내기! 동료들이 물을 뿌리며 달려왔다.");
      else if (cl.gw) lines.push("결승타! 오늘 승리는 내 방망이로.");
      if (cl.comeback && !cl.walkoff) lines.push(cl.comeback > 1 ? `역전타 ${cl.comeback}번!` : "역전타!");
      if (cl.gidp) lines.push(cl.gidp > 1 ? `병살 ${cl.gidp}번… 흐름을 끊었다.` : "병살타… 흐름을 끊었다.");
      addTrust(c, (cl.gw ? 1 : 0) + (cl.walkoff ? 1.5 : 0) + cl.comeback * 0.8 - cl.gidp * 1);
      addFame(c, (cl.gw ? 3 : 0) + (cl.walkoff ? 10 : 0) + cl.comeback * 3);
    }
    // 미션 실패 패널티: 감독 신뢰 ↓ (안타라도 친 빡센 미션은 봐줌) · 인연 미션은 그 사람 호감 ↑↓
    const fails = (g.results ?? []).filter((r) => !r.ok && !r.partial).length;
    if (fails) {
      addTrust(c, -0.8 * fails);
      lines.push(`미션 실패 ${fails}개… 감독 신뢰가 조금 떨어졌다.`);
    }
    for (const r of g.results ?? []) {
      if (!r.char || !isBond(r.char)) continue;
      const d = addAff(c, r.char, r.ok ? 6 : r.partial ? 2 : -3);
      lines.push(`${charById(r.char).name}의 미션 ${r.ok ? "성공" : r.partial ? "아쉬움" : "실패"} — 호감 ${d >= 0 ? `+${d}` : d}`);
    }
    // S 평가면 가끔 특수능력 고르기
    if (grade === 0 && rng() < 0.04 && c.mvpPicks < 3) {
      c.mvpPicks++;
      makePick(c, rng, "오늘의 MVP");
      lines.push("오늘의 MVP! 특수능력 하나를 고를 수 있다.");
    }
    if (rng() < (c.stamina < 20 ? 0.04 : 0.005) * Math.max(0.2, 1 + fx.injury)) lines.push(...hurt(c, rng, false));
  }
  pushLog(c, `${c.phase === "post" && c.post ? postName(c.post) : `${gameNo(c) + 1}경기`}: ${title}`);
  c.turn++;
  c.usedItem = false;
  tickInjury(c);
  act = Math.max(1, act);
  addActive(c, act);
  if (c.phase === "post") {
    postGame(c, win, rng, lines);
    return { title, lines, delta: diffOf(c, a), dnp: !g, grade, win, act };
  }
  // 순위표: 우리 경기 + 다른 두 팀끼리 한 경기
  c.table ??= newTable();
  const opp = 1 + (gameNo(c) % 3);
  if (win !== null) {
    c.table[0][win ? 0 : 1]++;
    c.table[opp][win ? 1 : 0]++;
  }
  simOthers(c, opp, rng);
  c.gameInWeek++;
  if (c.gameInWeek >= GAMES_PER_WEEK) {
    c.gameInWeek = 0;
    c.week++;
    c.slot = 0;
    c.done = [];
    if (c.week >= WEEKS) startPost(c, rng, lines);
  }
  return { title, lines, delta: diffOf(c, a), dnp: !g, grade, win, act };
}

/* ─────────────── 시즌 결산 · 은퇴 ─────────────── */

export const avg = (l: { h: number; ab: number }) => (l.ab ? l.h / l.ab : 0);
export const fmtAvg = (v: number) => v.toFixed(3).replace(/^0/, "");
/** 시즌 성적 평가 (OPS) — 시즌 결산 화면. 숨은 재능 공개와 같은 화면이라 따로 보여 줌 */
export function seasonGrade(l: BatLine) {
  const v = ops(l);
  const L = [
    [0.95, "S", "#ff7ae0"], [0.82, "A", "#ffcf4a"], [0.7, "B", "#7dff9a"], [0.6, "C", "#7ad7ff"], [0, "D", "#9a9a9a"],
  ] as const;
  const r = L.find((x) => v >= x[0])!;
  return { g: r[1], color: r[2] };
}
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
  /** 팀 최종 순위표 (리셋 전) · 가을야구 결과 */
  standings?: ReturnType<typeof standings>;
  post?: PostRes;
  /** 10년차 끝이라 무조건 은퇴 */
  retire: boolean;
  /** 은퇴를 고를 수 있음 */
  canRetire: boolean;
}

/** 이번 시즌 리그 1위 기록 (시드 · 연차로 정해짐) — 타이틀 기준 */
export function leagueBest(c: Pick<Career, "seed" | "season">) {
  const r = makeRng((c.seed * 31 + c.season * 977 + 5) >>> 0);
  // 초반 연차는 상대 투수가 약해서(PITCH_LV) 기록이 잘 나오니 1위 기준도 그만큼 높게 — 1년차 +.04 · 홈런 +3 · 타점 +8
  const e = (560 - PITCH_LV[Math.min(PITCH_LV.length - 1, Math.max(0, c.season - 1))]) / 260;
  return { avg: 0.35 + r() * 0.05 + 0.04 * e, hr: 11 + Math.floor(r() * 6) + Math.round(3 * e), rbi: 34 + Math.floor(r() * 10) + Math.round(8 * e) };
}
/** 수상 레이스 — 지금까지 경기 수 기준 1위 페이스와 내 기록 */
export function awardRace(c: Career) {
  const best = leagueBest(c);
  const k = Math.max(1, c.line.g) / GAMES;
  const L = c.line;
  const rows = [
    { title: "홈런왕", mine: L.hr, pace: Math.round(best.hr * k), unit: "개", fmt: (v: number) => String(v) },
    { title: "타점왕", mine: L.rbi, pace: Math.round(best.rbi * k), unit: "타점", fmt: (v: number) => String(v) },
    { title: "타격왕", mine: avg(L), pace: best.avg, unit: "", fmt: (v: number) => fmtAvg(v) },
  ];
  return rows
    .map((r) => ({ ...r, lead: r.mine >= r.pace, gap: r.pace - r.mine }))
    .sort((a, b) => (a.lead === b.lead ? a.gap / Math.max(0.001, a.pace) - b.gap / Math.max(0.001, b.pace) : a.lead ? -1 : 1));
}

export function endSeason(c: Career): SeasonSummary {
  if (c.phase !== "seasonEnd") throw new Error("시즌 결산 차례 아님");
  const rng = turnRng(c, 11);
  const L = c.line;
  const awards: string[] = [];
  const lines: string[] = [];
  const pa = L.pa;
  // 리그 1위 기록은 해마다 조금씩 다름 (30경기 시즌 · 시즌 중 「수상 레이스」와 같은 값)
  const best = leagueBest(c);
  if (pa >= 80 && avg(L) >= best.avg) awards.push("타격왕");
  if (L.hr >= best.hr) awards.push("홈런왕");
  if (L.rbi >= best.rbi) awards.push("타점왕");
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
  // 노쇠 (8년차부터): 발이 먼저
  let decline: Partial<Stats> | undefined;
  if (c.season >= 8) {
    decline = {};
    const y = c.season - 7;
    for (const k of STAT_KEYS) {
      const rate = (k === "run" ? 0.025 : 0.01) * y;
      const before = c.stats[k];
      c.stats[k] *= 1 - rate;
      decline[k] = Math.round(c.stats[k]) - Math.round(before);
    }
    lines.push("나이가 느껴진다… 발이 조금 무거워졌다.");
  }
  const rank = myRank(c);
  const finalTable = standings(c);
  const postRes = c.postRes;
  const rec: SeasonRec = { season: c.season, line: { ...L }, awards, ovr: ovrOf(c), salary: c.salary, rank, post: c.postRes };
  lines.unshift(`팀 정규시즌 ${rank}위${c.postRes && c.postRes !== "진출 실패" ? ` · 가을야구 ${c.postRes}` : ""}`);
  c.table = newTable();
  c.post = null;
  c.postRes = undefined;
  c.mood = 0;
  c.seasons.push(rec);
  for (const k of ["g", "pa", "ab", "h", "d2", "d3", "hr", "rbi", "bb", "k", "r"] as const) c.total[k] += L[k];
  c.line = emptyLine();
  c.bcount = {};
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
  return { season: c.season, line: rec.line, awards, lines, salary: c.salary, prevSalary: prev, talentReveal, decline, retire, canRetire, standings: finalTable, post: postRes };
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
  const rings = c.seasons.filter((s) => s.post === "우승").length;
  if (rings >= 3) nick.push("우승 청부사");
  else if (rings >= 1 && !nick.length) nick.push(`우승 반지 ${rings}개`);
  if (cnt("MVP") >= 3) nick.push("리그의 지배자");
  if (cnt("홈런왕") >= 2 || t.hr >= 150) nick.push("홈런 공장");
  if (cnt("타격왕") >= 2 || (t.ab >= 600 && avg(t) >= 0.33)) nick.push("안타 제조기");
  if (t.rbi >= 400) nick.push("해결사");
  if (t.h >= 1000) nick.push("천 안타의 사나이");
  if (c.stats.run >= 800) nick.push("바람의 아들");
  for (const id of c.skills) if (skill(id).set) nick.push(skill(id).name);
  if (c.awakened) nick.push("각성자");
  if (c.learned) nick.push(`${charById(c.learned).name}의 제자`);
  if (!nick.length) nick.push(ovr >= 500 ? "성실한 프로" : "만년 유망주");
  const top = topAff(c);
  const partner = top && (c.aff[top] ?? 0) >= 50 ? top : undefined;
  return { ovr, grade: gradeOf(ovr), top: topPct(ovr), nick, awards, total: t, partner, epilogue: partner ? EPILOGUE[partner] : undefined };
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
  /** 물려줄 수 있는 특수능력 (세트 · 나쁜 것 · 축복 빼고) */
  skills?: SkillId[];
  /** 파트너 (은퇴 에필로그) */
  partner?: CharId;
  look?: Look;
  /** 구단 카드로 넘길 때 (예전 저장엔 없음) */
  bats?: "R" | "L";
  num?: number;
  /** 수비 위치 (예전 저장엔 없음) */
  pos?: string;
}
/** 계승할 수 있는 특수능력인가 */
export const inheritable = (id: SkillId) => !skill(id).set && !skill(id).bad && !skill(id).boon;
export function hofEntry(c: Career): HofEntry {
  const r = retireCard(c);
  const st = {} as Stats;
  for (const k of STAT_KEYS) st[k] = Math.round(c.stats[k]);
  return { id: c.id, name: c.name, type: c.type, ovr: r.ovr, grade: r.grade.g, nick: r.nick[0], stats: st, hr: c.total.hr, avg: avg(c.total), seasons: c.seasons.length, at: Date.now(), gp: c.gp.length, skills: c.skills.filter(inheritable), partner: r.partner, look: c.look, bats: c.bats, num: c.num, pos: posOf(c) };
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
    const going = spots.filter((s) => s.char && ((c.bonds[s.char] ?? 0) < BOND_MAX || s.special));
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
/** 봇 관리: 할 행동 (null = 경기 진행 · 다음 날). 행동력이 넘칠 것 같으면 싼 행동이라도 씀 */
export function botTurn(c: Career, pol: Policy, rng: Rng): Action | null {
  if (c.active < MIN_COST) return null;
  const a = botAction(c, pol, rng);
  if (!whyNot(c, a)) return a;
  const income = c.phase === "season" ? ACTIVE_PER_GAME * GAMES_PER_WEEK : ACTIVE_PER_DAY;
  if (c.active + income > ACTIVE_MAX) {
    const r: Action = c.stamina < 75 ? { kind: "rest" } : { kind: "care" };
    if (!whyNot(c, r)) return r;
  }
  return null;
}

/** 봇 상점: 주력 장비 먼저 올리고, 체력 모자라면 드링크 */
export function botShop(c: Career) {
  const best = [...STAT_KEYS].sort((a, b) => TYPES[c.type].apt[b] - TYPES[c.type].apt[a]);
  const gearFor: Record<StatKey, GearId> = { hit: "bat", power: "dumbbell", run: "spike" };
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
/** 봇 미연시 답: insight 확률로 그 사람다운 답(이해), 아니면 아무거나 */
export function botChoose(c: Career, rng: Rng, insight: number): number {
  const p = c.pending;
  if (!p) return 0;
  if (p.scene) {
    const k = p.scene.opts.findIndex((o, i) => o.know && i === p.scene!.opts.length - 1 && p.scene!.opts.length > 2 && !!STORY[p.char as BondId][p.scene!.beat].special);
    if (k >= 0 && rng() < insight + 0.2) return k;
    const kn = p.scene.opts.findIndex((o) => o.know);
    if (kn >= 0 && rng() < insight) return kn;
    return Math.floor(rng() * p.scene.opts.length);
  }
  return rng() < 0.5 ? 0 : 1;
}
/** 봇 덱: 타입 주력 능력치를 키워 주는 사람 위주 */
export function botDeck(type: BatType, rng: Rng): BondId[] {
  const apt = TYPES[type].apt;
  const ids = [...BOND_IDS];
  const sc = new Map(ids.map((id) => [id, apt[BONDS[id].stat] + rng() * 0.6] as const));
  return ids.sort((a, b) => sc.get(b)! - sc.get(a)!).slice(0, DECK_SIZE);
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
