/**
 * 육성 모드 v4 「라이징 시즌」 (타자편) — 한 판 = 한 시즌. 슈퍼스타즈(겜프야)식 턴제 + 우리 인연 · 축복 · 대결.
 *
 * 한 시즌: 캠프(행동권 4) → 시즌 미션 3개 고르기 → 정규 1~6주 (주마다 행동권 4 + 주말 리그 경기 1) →
 *   리그 1위면 챔피언전 주(보너스 행동권 2 + 결승 1) → 시즌 결산(수상 · 우승 · 종합 등급 · 칭호) → 명예의 전당.
 * 행동 하나 = 행동권 1장: 훈련 5종(타격 · 근력 · 주루 · 수비 · 필살) · 숙소(휴식 · 게임 · 치료). 상점 · 스킬 습득은 공짜.
 * 훈련엔 덱 캐릭터가 턴마다 흩어져 있고 같이 하면 크게 + 호감 ↑ (「함께 훈련」 · 호감 60+ 「우정 훈련」).
 * 훈련 뒤 가끔 「누구와 만나게 될까?」 — 이벤트 3장 중 하나 고르기 (인연 이야기 · 장소 이벤트 · 돌발).
 * 재화 둘: 자금(상점) · 스킬P(스킬 습득). 경기는 평가로 스킬P · 자금 · 실전 경험(능력치 조금) · 컨디션.
 *
 * 결과 분포(종합 0 ~ 999): 목표 중앙값 ~450 · 상위 10% ~600 · 최고 ~750 (scripts/baseball-career-sim.ts)
 * 화면 · 저장은 없음 — 상태(Career)는 그냥 JSON. 난수는 (시드, 턴 번호)로 정해서 새로고침해도 결과가 같음.
 */
import type { Diff } from "./ai";
import { TEAM_DEFS, charById, type Batter, type Boost, type CharId } from "./data";
import type { BatLine, Clutch } from "./game";
import { clamp, makeRng, type Rng } from "./rng";
import { DEFAULT_LOOK, type Look } from "./look";
import { BOND_IDS, BOONS, DUOS, EPILOGUE, ROLE, STORY, isBond, type BondId, type Choice, type Role } from "./bonds";

export type StatKey = "hit" | "power" | "run" | "def";
export type Stats = Record<StatKey, number>;
export const STAT_KEYS: StatKey[] = ["hit", "power", "run", "def"];
export const STAT_NAME: Record<StatKey, string> = { hit: "타격", power: "파워", run: "주루", def: "수비" };
/** 능력 색 (슈퍼스타즈처럼 늘 같은 색) */
export const STAT_COLOR: Record<StatKey, string> = { hit: "#4fe07a", power: "#ff5a5a", run: "#ffcf3a", def: "#4aa8ff" };

/* ─────────────── 선수 타입 ─────────────── */

/** 성장 적성 · 시작 능력치 · 기본 수비 위치 · 타순 (0 = 1번) */
export type BatType = "contact" | "power" | "speed" | "defense" | "all";
export const PICK_TYPES: BatType[] = ["contact", "power", "speed", "defense", "all"];
export type FieldPos = "C" | "1B" | "2B" | "3B" | "SS" | "LF" | "CF" | "RF";
export const PICK_POS: { pos: FieldPos; name: string }[] = [
  { pos: "C", name: "포수" },
  { pos: "1B", name: "1루수" },
  { pos: "2B", name: "2루수" },
  { pos: "SS", name: "유격수" },
  { pos: "3B", name: "3루수" },
  { pos: "LF", name: "좌익수" },
  { pos: "CF", name: "중견수" },
  { pos: "RF", name: "우익수" },
];
/** 육성 경기 난이도는 중급 하나 */
export const CAREER_DIFF = 1;
export const TYPES: Record<BatType, { name: string; desc: string; pos: FieldPos; slot: number; apt: Stats; start: Stats }> = {
  contact: { name: "교타자", desc: "타격 ↑ · 테이블세터 1번", pos: "2B", slot: 0, apt: { hit: 1.3, power: 0.82, run: 1.0, def: 0.95 }, start: { hit: 150, power: 90, run: 120, def: 110 } },
  speed: { name: "준족", desc: "주루 ↑ · 테이블세터 2번", pos: "CF", slot: 1, apt: { hit: 1.05, power: 0.8, run: 1.35, def: 1.0 }, start: { hit: 125, power: 80, run: 160, def: 115 } },
  all: { name: "만능", desc: "고르게 · 3번", pos: "3B", slot: 2, apt: { hit: 1.0, power: 1.0, run: 1.0, def: 1.0 }, start: { hit: 125, power: 115, run: 120, def: 120 } },
  power: { name: "거포", desc: "파워 ↑ · 클린업 4번", pos: "1B", slot: 3, apt: { hit: 0.95, power: 1.3, run: 0.88, def: 0.92 }, start: { hit: 100, power: 140, run: 100, def: 105 } },
  defense: { name: "수비형", desc: "수비 ↑ · 6번", pos: "SS", slot: 5, apt: { hit: 1.0, power: 0.9, run: 1.02, def: 1.35 }, start: { hit: 115, power: 95, run: 125, def: 155 } },
};

/* ─────────────── 일정 ─────────────── */

/** 정규 시즌 주 (주마다 리그 경기 하나) · 주마다 행동권 · 챔피언전 보너스 행동권 */
export const WEEKS = 6;
export const TICKETS = 4;
export const CAMP_TICKETS = 4;
export const FINAL_TICKETS = 2;
/** 주차별 상대 투수 수준 (원래 팀 기본 560) — 내 선수가 시즌 동안 크는 만큼 같이 세짐. [캠프, 1주 ~ 6주, 결승] */
export const PITCH_LV = [200, 210, 230, 250, 270, 290, 310, 330];

/* ─────────────── 훈련 ─────────────── */

export type TrainKey = "hit" | "power" | "run" | "def" | "special";
export const TRAINS: Record<TrainKey, { name: string; short: string; desc: string; cost: number; gain: Partial<Stats>; sp: number }> = {
  hit: { name: "타격 훈련", short: "타격", desc: "타격 ↑ · 파워 · 수비 조금", cost: 20, gain: { hit: 1, power: 0.25, def: 0.12 }, sp: 5 },
  power: { name: "근력 훈련", short: "근력", desc: "파워 ↑ · 타격 · 주루 조금", cost: 24, gain: { power: 1, hit: 0.2, run: 0.12 }, sp: 5 },
  run: { name: "주루 훈련", short: "주루", desc: "주루 ↑ · 수비 · 타격 조금", cost: 20, gain: { run: 1, def: 0.25, hit: 0.1 }, sp: 5 },
  def: { name: "수비 훈련", short: "수비", desc: "수비 ↑ · 주루 · 파워 조금", cost: 18, gain: { def: 1, run: 0.2, power: 0.1 }, sp: 6 },
  special: { name: "필살 훈련", short: "필살", desc: "필살 레벨 ↑ · 타격 · 파워 — 배운 뒤에만", cost: 26, gain: { hit: 0.4, power: 0.4 }, sp: 8 },
};
export const TRAIN_KEYS: TrainKey[] = ["hit", "power", "run", "def", "special"];
/** 훈련 한 번 주 능력 기본 성장 (적성 · 컨디션 · 레벨 · 함께 · 높을수록 덜 오름 반영 전) */
export const TRAIN_BASE = 18;
/** 밸런스 손잡이 (시뮬) */
export const TUNE = { train: 1, noBond: false, dimAt: 800, dimPow: 1.8 };
/** 훈련 레벨: 같은 훈련 TRAIN_LV_EVERY 번마다 +1 (최대 5) · 레벨당 효율 +12% */
export const TRAIN_LV_EVERY = 3;
export const TRAIN_LV_MUL = 0.12;
/** 필살 레벨: 필살 훈련 SP_EVERY 번마다 +1 (최대 5 = 마스터 → 경기당 2번) */
export const SP_EVERY = 2;

export const COND_NAME = ["최악", "나쁨", "보통", "좋음", "최고"] as const;
export const COND_FACE = ["😫", "😟", "🙂", "😄", "🤩"] as const;
export const COND_COLOR = ["#ff5a5a", "#ff9a3d", "#ffd23f", "#7dff9a", "#ff7ae0"] as const;
const COND_TRAIN = [0.72, 0.86, 1, 1.12, 1.25];
/** 경기 컨디션: 타격 · 파워 배율 */
export const COND_GAME = [0.88, 0.94, 1, 1.04, 1.08];

/* ─────────────── 특수능력 (태그 · 세트 · 양날) ─────────────── */

export type Tag = "clutch" | "contact" | "power" | "speed" | "glove" | "grit" | "luck";
export const TAG_NAME: Record<Tag, string> = { clutch: "찬스", contact: "컨택", power: "파워", speed: "스피드", glove: "수비", grit: "근성", luck: "행운" };
export const TAG_COLOR: Record<Tag, string> = { clutch: "#ff7a5c", contact: "#7dff9a", power: "#ff5a5a", speed: "#ffd23f", glove: "#4aa8ff", grit: "#c9a2ff", luck: "#ff7ae0" };

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
  /** 경기마다 체력 + */
  gameSta?: number;
  /** 홈런 하나마다 컨디션 ▲ 확률 */
  hrCond?: number;
  money?: number;
  /** 스킬P 얻는 양 +% */
  sp?: number;
  /** 경기 실전 경험 +% */
  exp?: number;
  /** 호수비 찬스 성공 +%p */
  dive?: number;
  awaken?: number;
  slump?: number;
  /** 컨디션이 최악까지 안 떨어짐 */
  condFloor?: boolean;
  /** 떨어지는 컨디션 폭 -1 */
  calm?: boolean;
  /** 호감 얻는 양 +% */
  aff?: number;
  /** 휴식 체력 회복 +% */
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
  /** 세트 효과 (같은 태그 SET_NEED 장이면 자동) */
  set?: Tag;
  /** 고르기 · 스킬 습득에 안 나옴 (인연 · 이벤트 전용) */
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
  runsense: { name: "주루 센스", desc: "경기 주루 +25 · 주루 훈련 효율 +8%", val: 2, tag: "speed", fx: { add: { run: 25 }, train: { run: 0.08 } } },
  wrist: { name: "강한 손목", desc: "경기 파워 +25 · 타격 +20", val: 2, tag: "power", fx: { add: { power: 25, hit: 20 } } },
  // 수비
  glovework: { name: "글러브 센스", desc: "경기 수비 +45", val: 2, tag: "glove", fx: { add: { def: 45 } } },
  arm: { name: "강한 어깨", desc: "경기 수비 +25 · 파워 +20", val: 2, tag: "glove", fx: { add: { def: 25, power: 20 } } },
  wall: { name: "철벽", desc: "호수비 찬스 성공 +15%", val: 2, tag: "glove", fx: { dive: 0.15 } },
  gstudy: { name: "수비 연구", desc: "수비 훈련 효율 +18%", val: 2, tag: "glove", fx: { train: { def: 0.18 } } },
  // 근성
  grit: { name: "끈질김", desc: "2스트라이크에서 타격 +70", val: 2, tag: "grit", fx: { sit: { twoK: 70 } } },
  iron: { name: "강철 몸", desc: "부상 확률 -40%", val: 2, tag: "grit", fx: { injury: -0.4 } },
  bounce: { name: "오뚝이", desc: "부상 기간 -40%", val: 2, tag: "grit", fx: { injuryDur: -0.4 } },
  // 행운
  lucky: { name: "행운아", desc: "훈련 대성공 +6%", val: 2, tag: "luck", fx: { great: 0.06 } },
  star: { name: "스타성", desc: "경기 자금 +40% · 스킬P +10%", val: 2, tag: "luck", fx: { money: 0.4, sp: 0.1 } },
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
  b_zena_step: { name: "번개 반응", desc: "수비 훈련 효율 +20% · 호수비 찬스 +10%", val: 3, tag: "glove", boon: "zena", noPick: true, fx: { train: { def: 0.2 }, dive: 0.1 } },
  b_zena_zap: { name: "찌릿한 한 방", desc: "득점권에서 타격 +80", val: 3, tag: "clutch", boon: "zena", noPick: true, fx: { sit: { rispHit: 80 } } },
  b_zena_prank: { name: "장난 기운", desc: "호감 +25%", val: 3, tag: "luck", boon: "zena", noPick: true, fx: { aff: 0.25 } },
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
  b_violet_stage: { name: "무대 체질", desc: "7회부터 타격 · 파워 +40 · 경기 스킬P +10%", val: 3, tag: "clutch", boon: "violet", noPick: true, fx: { sit: { late: 40 }, sp: 0.1 } },
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
  cram: { name: "실전파", desc: "실전 경험 +60% / 훈련 -15%", val: 2, risk: true, fx: { exp: 0.6, train: { all: -0.15 } } },
  showoff: { name: "관종", desc: "스킬P +40% / 슬럼프 2배", val: 2, risk: true, fx: { sp: 0.4, slump: 1 } },
  // 나쁜 것 (이벤트)
  clutchBad: { name: "찬스 약함", desc: "득점권에서 타격 -60", val: -6, bad: true, noPick: true, fx: { sit: { rispHit: -60 } } },
  fragile: { name: "부상 체질", desc: "부상 확률 +50%", val: -6, bad: true, noPick: true, fx: { injury: 0.5 } },
  // 세트 (같은 태그 SET_NEED 장)
  set_clutch: { name: "클러치 히터", desc: "찬스 세트: 득점권 타격 · 파워 +60", val: 6, set: "clutch", noPick: true, fx: { sit: { rispHit: 60, rispPow: 60 } } },
  set_contact: { name: "타격 기계", desc: "컨택 세트: 경기 타격 +60", val: 6, set: "contact", noPick: true, fx: { add: { hit: 60 } } },
  set_power: { name: "거포 각성", desc: "파워 세트: 경기 파워 +60 · 홈런 치면 40% 확률로 컨디션 ▲", val: 6, set: "power", noPick: true, fx: { add: { power: 60 }, hrCond: 0.4 } },
  set_speed: { name: "바람의 아들", desc: "스피드 세트: 경기 주루 +80", val: 6, set: "speed", noPick: true, fx: { add: { run: 80 } } },
  set_glove: { name: "골든 글러브", desc: "수비 세트: 경기 수비 +80 · 호수비 찬스 +10%", val: 6, set: "glove", noPick: true, fx: { add: { def: 80 }, dive: 0.1 } },
  set_grit: { name: "불굴", desc: "근성 세트: 컨디션 최악 없음 · 부상 기간 절반", val: 6, set: "grit", noPick: true, fx: { condFloor: true, injuryDur: -0.5 } },
  set_luck: { name: "럭키 가이", desc: "행운 세트: 각성 확률 3배 · 대성공 +5%", val: 6, set: "luck", noPick: true, fx: { awaken: 2, great: 0.05 } },
} satisfies Record<string, Skill>;

export type SkillId = keyof typeof SKILLS;
export const skill = (id: SkillId): Skill => SKILLS[id];
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

/** 필살타법을 배우면 종합 + (레벨당 더) */
export const LEARNED_VAL = 6;
export const SP_LV_VAL = 2;

/** 세트 효과에 필요한 같은 태그 장수 */
export const SET_NEED = 4;
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

const zeroStats = (): Stats => ({ hit: 0, power: 0, run: 0, def: 0 });

/** 특수능력 효과 합 (축복은 레벨 배율) */
export function fxOf(c: Pick<Career, "skills"> & { blv?: Partial<Record<SkillId, number>> }) {
  const f = {
    add: zeroStats(),
    sit: {} as NonNullable<Batter["sit"]>,
    train: { hit: 0, power: 0, run: 0, def: 0, special: 0, all: 0 } as Record<TrainKey | "all", number>,
    injury: 0, injuryDur: 0, great: 0, gameSta: 0, hrCond: 0, money: 0, sp: 0, exp: 0, dive: 0, awaken: 0, slump: 0, condFloor: false, calm: false,
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
    f.gameSta += (x.gameSta ?? 0) * m;
    f.hrCond += (x.hrCond ?? 0) * m;
    f.money += (x.money ?? 0) * m;
    f.sp += (x.sp ?? 0) * m;
    f.exp += (x.exp ?? 0) * m;
    f.dive += (x.dive ?? 0) * m;
    f.awaken += (x.awaken ?? 0) * m;
    f.slump += x.slump ?? 0;
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
  const out = [`특수능력 「${skill(id).name}」 획득! ${skill(id).desc}`];
  if (id === "clutch") c.skills = c.skills.filter((s) => s !== "clutchBad");
  if (id === "iron") c.skills = c.skills.filter((s) => s !== "fragile");
  c.skills.push(id);
  const tag = skill(id).tag;
  if (tag && (tagCount(c)[tag] ?? 0) >= SET_NEED) {
    const set = `set_${tag}` as SkillId;
    if (set in SKILLS && !c.skills.includes(set)) {
      c.skills.push(set);
      out.push(`★ 세트 완성 — 「${skill(set).name}」 · ${skill(set).desc}`);
    }
  }
  return out;
}

/* ─────────────── 픽셀파이트 인연 ─────────────── */

export interface Bond {
  /** 잘 키워 주는 능력치 (함께 훈련 · 인연 미션) */
  stat: StatKey;
  place: string;
  lines: [string, string, string, string];
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
    stat: "def", place: "번개 치는 옥상", pick: ["반사 신경 훈련", "번개 구경"],
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
/** 그 만남이 열리는 최소 호감 (모자라면 어울리기 — 호감만 오름). 한 시즌 안에 8칸 다 볼 수 있게 */
export const VISIT_AFF = [0, 0, 12, 20, 30, 40, 50, 60];
/** 인연 덱 (육성에 데려가는 사람 수) */
export const DECK_SIZE = 3;
export const roleOf = (id: BondId): Role => ROLE[id];
/** 대결: 공 수 · 필요 점수 (안타 1 · 홈런 2) · 몇 번째 공이 마구인지 */
export const BATTLES = {
  mini: { pitches: 3, need: 1, magic: [2] },
  final: { pitches: 5, need: 3, magic: [1, 3, 4] },
} as const;
/** 호감 이만큼부터 「우정 훈련」 */
export const FRIEND_AFF = 60;

/* ─────────────── 상점 (자금, 단위 만원) ─────────────── */

export type ConsumableId = "drink" | "food" | "charm" | "rehab";
export const CONSUMABLES: Record<ConsumableId, { name: string; icon: string; desc: string; price: number }> = {
  drink: { name: "스포츠 드링크", icon: "🥤", desc: "체력 +30", price: 120 },
  food: { name: "보양식", icon: "🍲", desc: "컨디션 +1 · 체력 +10", price: 200 },
  charm: { name: "행운의 부적", icon: "🧿", desc: "다음 훈련 대성공 +25%", price: 250 },
  rehab: { name: "재활 치료", icon: "🩹", desc: "부상 남은 기간 절반", price: 300 },
};
export const CONSUMABLE_IDS = Object.keys(CONSUMABLES) as ConsumableId[];

/** 장비 4종 × 3단계 — 그 훈련 효율 + 경기 능력치 */
export type GearId = "bat" | "dumbbell" | "spike" | "glove";
export const GEAR: Record<GearId, { name: string; icon: string; stat: StatKey; train: TrainKey; tiers: [string, string, string] }> = {
  bat: { name: "배트", icon: "🏏", stat: "hit", train: "hit", tiers: ["알루미늄 배트", "카본 배트", "명장의 배트"] },
  dumbbell: { name: "웨이트", icon: "🏋️", stat: "power", train: "power", tiers: ["아령 세트", "파워 랙", "개인 웨이트룸"] },
  spike: { name: "스파이크", icon: "👟", stat: "run", train: "run", tiers: ["러닝 스파이크", "경량 스파이크", "맞춤 스파이크"] },
  glove: { name: "글러브", icon: "🧤", stat: "def", train: "def", tiers: ["연습 글러브", "가죽 글러브", "명장의 글러브"] },
};
export const GEAR_IDS = Object.keys(GEAR) as GearId[];
export const GEAR_TIER = [
  { price: 350, train: 0.1, game: 15 },
  { price: 900, train: 0.2, game: 35 },
  { price: 1800, train: 0.3, game: 60 },
] as const;

/* ─────────────── 시즌 미션 (캠프 끝에 3개 고르기 — 이루면 바로 스킬P) ─────────────── */

export type MissionKey = "h" | "xbh" | "hr" | "rbi" | "sb" | "df";
export const MISSION_CATS: { key: MissionKey; name: string; unit: string; tiers: [number, number, number] }[] = [
  { key: "h", name: "안타", unit: "개", tiers: [5, 7, 10] },
  { key: "xbh", name: "장타", unit: "개", tiers: [1, 2, 4] },
  { key: "hr", name: "홈런", unit: "개", tiers: [1, 2, 3] },
  { key: "rbi", name: "타점", unit: "점", tiers: [2, 4, 6] },
  { key: "sb", name: "도루", unit: "개", tiers: [1, 3, 5] },
  { key: "df", name: "호수비", unit: "번", tiers: [1, 2, 4] },
];
export const MISSION_TIER = [
  { name: "쉬움", sp: 60, color: "#4fe07a" },
  { name: "보통", sp: 110, color: "#3ad1d1" },
  { name: "어려움", sp: 210, color: "#ff5a6a" },
] as const;
export interface SeasonMission {
  key: MissionKey;
  tier: number;
  done?: boolean;
}
export const missionNeed = (m: SeasonMission) => MISSION_CATS.find((x) => x.key === m.key)!.tiers[m.tier];
export const missionName = (m: SeasonMission) => {
  const cat = MISSION_CATS.find((x) => x.key === m.key)!;
  return `${cat.name} ${cat.tiers[m.tier]}${cat.unit}`;
};
export function missionNow(c: Pick<Career, "line">, key: MissionKey) {
  const L = c.line;
  return key === "h" ? L.h : key === "xbh" ? L.d2 + L.d3 + L.hr : key === "hr" ? L.hr : key === "rbi" ? L.rbi : key === "sb" ? L.sb : L.df;
}

/* ─────────────── 상태 ─────────────── */

export interface Injury {
  kind: 0 | 1 | 2;
  /** 남은 턴 (경기도 1로 셈) */
  left: number;
}
export const INJURY_NAME = ["가벼운 부상", "부상", "큰 부상"] as const;

/** 시즌 기록: 타격 + 도루 · 호수비 */
export type Line = BatLine & { g: number; sb: number; df: number };
export const emptyLine = (): Line => ({ g: 0, pa: 0, ab: 0, h: 0, d2: 0, d3: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0, sb: 0, df: 0 });

export type Phase = "camp" | "season" | "final" | "end" | "done";
export type PostRes = "우승" | "준우승" | "2위" | "3위" | "4위";

export interface Pending {
  kind: "scene" | "coach" | "night" | "press";
  char?: CharId;
  title: string;
  text: string;
  choices: string[];
  /** 미연시 장면: 대사 · 고르기 (반응 · 호감 · 이해) */
  scene?: { lines: string[]; opts: Choice[]; beat: number };
}
export interface PickState {
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

/** 「누구와 만나게 될까?」 카드 */
export type SpotEvent = "quiz" | "signing" | "secret" | "advice" | "fan" | "coach" | "night" | "press" | "slump";
export const SPOT_EVENTS: Record<SpotEvent, { name: string; icon: string; desc: string; tone: "good" | "risk" | "bad" }> = {
  quiz: { name: "야구 퀴즈쇼", icon: "📚", desc: "이기면 특수능력 3장 중 1장", tone: "good" },
  signing: { name: "팬 사인회", icon: "✍️", desc: "자금 ↑ · 컨디션 ↑", tone: "good" },
  secret: { name: "비밀 특훈", icon: "🌙", desc: "약한 능력치 크게 ↑ · 체력 -25", tone: "risk" },
  advice: { name: "선배의 조언", icon: "🧢", desc: "능력치 ↑ · 스킬P ↑", tone: "good" },
  fan: { name: "팬레터", icon: "💌", desc: "컨디션 ↑ · 체력 ↑", tone: "good" },
  coach: { name: "감독의 호출", icon: "📣", desc: "밤샘 특훈 할까?", tone: "risk" },
  night: { name: "야간 자율 훈련", icon: "🌃", desc: "동료들과 자율 훈련", tone: "risk" },
  press: { name: "기자 인터뷰", icon: "🎤", desc: "각오 한마디", tone: "risk" },
  slump: { name: "불길한 예감", icon: "🌧️", desc: "슬럼프가 올지도…", tone: "bad" },
};
export interface OfferCard {
  /** 인연 이야기 · 어울리기 */
  char?: BondId;
  event?: SpotEvent;
  title: string;
  desc: string;
}
export interface Offer {
  cards: OfferCard[];
}

export interface Career {
  v: 4;
  id: string;
  seed: number;
  name: string;
  num: number;
  bats: "R" | "L";
  type: BatType;
  pos?: FieldPos;
  diff: Diff;
  stats: Stats;
  skills: SkillId[];
  /** 축복 레벨 (1 ~ 3) */
  blv: Partial<Record<SkillId, number>>;
  learned?: CharId;
  /** 필살 훈련 횟수 (레벨 = 1 + 횟수 / SP_EVERY) */
  spXp: number;
  stamina: number;
  cond: number;
  money: number;
  /** 스킬 포인트 */
  sp: number;
  tCount: Record<TrainKey, number>;
  gear: Partial<Record<GearId, number>>;
  bag: Partial<Record<ConsumableId, number>>;
  /** 이번 턴에 소모품을 썼나 (턴마다 하나) */
  usedItem: boolean;
  charmNext: boolean;
  /** 이번 주 남은 행동권 */
  tickets: number;
  phase: Phase;
  /** 0 = 캠프 · 1 ~ 6 정규 · 7 챔피언전 */
  week: number;
  turn: number;
  /** 주 시작 능력치 (주차 결산) */
  weekStart: Stats;
  deck: BondId[];
  /** 만남 줄기 진행 0 ~ 8 */
  bonds: Partial<Record<BondId, number>>;
  aff: Partial<Record<BondId, number>>;
  know: Partial<Record<BondId, number>>;
  /** 인연 대결 진 횟수 */
  tries: Partial<Record<BondId, number>>;
  battle: BattleReq | null;
  offer: Offer | null;
  pending: Pending | null;
  pick: PickState | null;
  missions: SeasonMission[] | null;
  /** 이번 시즌 팀 순위표 [승, 패] — TEAM_DEFS 번호 순 (0 = 우리 팀) */
  table: [number, number][];
  /** 챔피언전 상대 (TEAM_DEFS 번호) */
  finalOpp?: number;
  result?: PostRes;
  line: Line;
  wins: number;
  losses: number;
  /** 경기마다 W · L · D (진행 원) */
  hist: string[];
  injury: Injury | null;
  awakened: boolean;
  /** 「오늘의 MVP」 고르기 받은 수 */
  mvpPicks: number;
  legacy?: { name: string; skill?: SkillId };
  look: Look;
  log: string[];
  /** 직접 출전 중 (나가거나 새로고침하면 자동 결과로 반영) */
  inGame?: boolean;
  /** 시즌 결산 (끝나면) */
  summary?: SeasonSummary;
  /** 메인 스토리 (없으면 예전 저장 — 프롤로그 없이 이어감) */
  story?: StoryState;
}

/* ─────────────── 메인 스토리: 주차 챕터 · 감독 지시 (대사는 story.ts) ─────────────── */

/** 이번 주 감독 지시: 이 훈련을 need 번 하면 보상 */
export interface Order {
  key: TrainKey;
  need: number;
  done: number;
  ok: boolean;
}
export interface StoryState {
  /** 프롤로그 봤나 */
  pro: boolean;
  /** 본 챕터 (0 프롤로그 · 1 ~ 6 주차 · 7 챔피언전 · 8 엔딩) */
  ch: number;
  order?: Order;
}
/** 주차마다 감독 지시 (상대 팀 색깔에 맞춰: 타격전엔 근력 · 투수전엔 타격 …) — 0 = 캠프(없음) */
export const ORDER_PLAN: (TrainKey | null)[] = [null, "power", "hit", "def", "run", "hit", "power", "hit"];
export const ORDER_NEED = 2;
export const ORDER_REWARD = { sp: 20, money: 100 };
/** 지금 챕터 번호 */
export const chapterOf = (c: Pick<Career, "phase" | "week">) => (c.phase === "camp" ? 0 : c.phase === "season" ? c.week : c.phase === "final" ? 7 : 8);
function setOrder(c: Career) {
  if (!c.story) return;
  const ch = chapterOf(c);
  let key = ORDER_PLAN[ch] ?? null;
  // 챔피언전: 필살타법을 배웠으면 필살 훈련
  if (ch === 7 && c.learned) key = "special";
  c.story.order = key ? { key, need: ch === 7 ? 1 : ORDER_NEED, done: 0, ok: false } : undefined;
}
/** 스토리 고르기 덤 (프롤로그 각오 등) */
export function storyFx(c: Career, fx: { cond?: number; sp?: number; money?: number }) {
  if (fx.cond) addCond(c, fx.cond);
  if (fx.sp) addSp(c, fx.sp);
  if (fx.money) addMoney(c, fx.money);
}

export interface NewCareerOpts {
  name: string;
  num: number;
  bats: "R" | "L";
  type: BatType;
  pos?: FieldPos;
  seed?: number;
  /** 인연 덱 (없으면 시드로 3명) */
  deck?: CharId[];
  /** 판을 넘어 쌓인 인연 레벨 → 시작 호감 */
  affStart?: Partial<Record<CharId, number>>;
  /** 선배의 유산 (은퇴 선수 하나에게서 특수능력 하나 · 능력치 조금) */
  legacy?: { name: string; skill?: SkillId; stats: Partial<Stats> };
  look?: Look;
}

export function newCareer(o: NewCareerOpts): Career {
  const seed = (o.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const rng = makeRng(seed ^ 0x51ed);
  const t = TYPES[o.type];
  const stats = zeroStats();
  for (const k of STAT_KEYS) stats[k] = Math.round(t.start[k] * (0.9 + rng() * 0.2) + (o.legacy ? legacyBonus(o.legacy.stats[k] ?? 0) : 0));
  let deck: BondId[] = (o.deck ?? []).filter((id, i, a): id is BondId => isBond(id) && a.indexOf(id) === i).slice(0, DECK_SIZE);
  if (deck.length < DECK_SIZE) {
    const rest = BOND_IDS.filter((id) => !deck.includes(id));
    while (deck.length < DECK_SIZE) deck = [...deck, rest.splice(Math.floor(rng() * rest.length), 1)[0]];
  }
  const aff: Partial<Record<BondId, number>> = {};
  for (const id of deck) aff[id] = clamp(Math.round(o.affStart?.[id] ?? 0), 0, 30);
  const skills: SkillId[] = o.legacy?.skill && o.legacy.skill in SKILLS && inheritable(o.legacy.skill) ? [o.legacy.skill] : [];
  return {
    v: 4,
    id: seed.toString(36),
    seed,
    name: o.name,
    num: o.num,
    bats: o.bats,
    type: o.type,
    pos: o.pos,
    diff: CAREER_DIFF,
    stats,
    skills,
    blv: {},
    spXp: 0,
    stamina: 100,
    cond: 2,
    money: 300,
    sp: 30,
    tCount: { hit: 0, power: 0, run: 0, def: 0, special: 0 },
    gear: {},
    bag: {},
    usedItem: false,
    charmNext: false,
    tickets: CAMP_TICKETS,
    phase: "camp",
    week: 0,
    turn: 0,
    weekStart: { ...stats },
    deck,
    bonds: {},
    aff,
    know: {},
    tries: {},
    battle: null,
    offer: null,
    pending: null,
    pick: null,
    missions: null,
    table: TEAM_DEFS.map(() => [0, 0] as [number, number]),
    line: emptyLine(),
    wins: 0,
    hist: [],
    losses: 0,
    injury: null,
    awakened: false,
    mvpPicks: 0,
    legacy: o.legacy ? { name: o.legacy.name, skill: skills[0] } : undefined,
    look: o.look ?? { ...DEFAULT_LOOK },
    log: ["라이징스타 리그 입단! 캠프가 시작됐다."],
    story: { pro: false, ch: 0 },
  };
}

/** 선배의 유산 — 선배 능력치에서 시작 능력치에 더해 주는 양 (최대 +40) */
export const legacyBonus = (v: number) => Math.round(clamp((v - 300) * 0.06, 0, 40));

/* ─────────────── 계산 ─────────────── */

export const trainLv = (c: Pick<Career, "tCount">, k: TrainKey) => Math.min(5, 1 + Math.floor((c.tCount[k] ?? 0) / TRAIN_LV_EVERY));
export const spLv = (c: Pick<Career, "learned" | "spXp">) => (c.learned ? Math.min(5, 1 + Math.floor(c.spXp / SP_EVERY)) : 0);
/** 필살타법 경기당 횟수 — 마스터(Lv5)면 2번 */
export const spUses = (c: Pick<Career, "learned" | "spXp">) => (c.learned ? (spLv(c) >= 5 ? 2 : 1) : 0);

export function ovrOf(c: Pick<Career, "stats" | "skills" | "learned" | "spXp"> & { blv?: Partial<Record<SkillId, number>> }) {
  const s = c.stats;
  let v = (s.hit + s.power + s.run + (s.def ?? s.run)) / 4;
  for (const id of c.skills) if (id in SKILLS) v += skill(id).val * lvMul(c, id);
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
/** 능력치 하나 → 등급 글자 (S ~ G) */
export function statGrade(v: number) {
  const L = [
    [900, "S", "#ff7ae0"], [800, "A", "#ff5a5a"], [700, "B", "#ff9a3d"], [600, "C", "#ffd23f"],
    [500, "D", "#7dff9a"], [400, "E", "#7ad7ff"], [300, "F", "#b6c2ff"], [0, "G", "#9a9a9a"],
  ] as const;
  const r = L.find((x) => v >= x[0])!;
  return { g: r[1], color: r[2] };
}

/** 시즌 종합 → 상위 몇 % (육성 시뮬 백분위표 — scripts/baseball-career-sim.ts 결과를 옮겨 적음). [종합, 그 이상인 비율] */
export const PCT_TABLE: [number, number][] = [
  [950, 0.00001], [900, 0.00002], [850, 0.00005], [800, 0.0002], [750, 0.0008], [700, 0.003], [650, 0.012], [600, 0.035], [550, 0.087],
  [500, 0.35], [450, 0.796], [400, 0.963], [350, 0.995], [300, 1], [0, 1],
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

/** 높을수록 덜 오름 (999 근처에선 거의 안 오름) — 몰빵해도 한 능력치가 끝까지 치솟지 않게 */
const dim = (v: number) => Math.max(0.06, 1 - Math.pow(Math.max(0, v) / TUNE.dimAt, TUNE.dimPow));
/** 능력치 올리기 (타입 적성 · 높을수록 덜) — 실제 오른 값 */
function grow(c: Career, k: StatKey, base: number): number {
  const before = c.stats[k];
  const g = base * TYPES[c.type].apt[k] * dim(before);
  c.stats[k] = clamp(before + g, 1, 999);
  return Math.round(c.stats[k]) - Math.round(before);
}

/** 내 수비 위치 */
export const posOf = (c: Pick<Career, "pos" | "type">): FieldPos => c.pos ?? TYPES[c.type].pos;
/** 타순 (0 = 1번) */
export const slotOfCareer = (c: Pick<Career, "type">) => TYPES[c.type].slot;

/** 경기용 능력치 — 기본 + 특수능력 · 축복 + 장비, 타격 · 파워는 컨디션 배율 */
export function careerGameStats(c: Career): { stats: Stats; raw: Stats; f: number; fx: ReturnType<typeof fxOf> } {
  const f = COND_GAME[c.cond] * (c.stamina < 20 ? 0.9 : 1);
  const fx = fxOf(c);
  const gear = zeroStats();
  for (const id of GEAR_IDS) {
    const t = c.gear[id];
    if (t) gear[GEAR[id].stat] += GEAR_TIER[t - 1].game;
  }
  const stats = zeroStats(), raw = zeroStats();
  for (const k of STAT_KEYS) {
    raw[k] = c.stats[k] + fx.add[k] + gear[k];
    stats[k] = Math.round(clamp(raw[k] * (k === "hit" || k === "power" ? f : 1), 1, 999));
  }
  return { stats, raw, f, fx };
}

export function careerBatter(c: Career): Batter & { def: number; dive: number } {
  const g = careerGameStats(c);
  return {
    name: c.name,
    num: c.num,
    pos: posOf(c),
    bats: c.bats,
    hit: g.stats.hit,
    power: g.stats.power,
    run: g.stats.run,
    def: g.stats.def,
    dive: g.fx.dive,
    base: { hit: Math.round(c.stats.hit), power: Math.round(c.stats.power), run: Math.round(c.stats.run) },
    season: { avg: c.line.ab ? c.line.h / c.line.ab : 0, hr: c.line.hr, rbi: c.line.rbi, ab: c.line.ab, h: c.line.h },
    learned: c.learned,
    sit: g.fx.sit,
    boosts: gameBoosts(c),
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
    for (const k of ["hit", "power", "run"] as const) if (x.add?.[k]) add[k] = Math.round(x.add[k]! * m);
    const sit: NonNullable<Boost["sit"]> = {};
    if (x.sit) for (const [k, v] of Object.entries(x.sit) as [keyof NonNullable<Boost["sit"]>, number][]) if (v) sit[k] = Math.round(v * m);
    const hasAdd = Object.keys(add).length > 0, hasSit = Object.keys(sit).length > 0;
    if (hasAdd || hasSit) out.push({ name: skill(id).name, ...(hasAdd ? { add } : {}), ...(hasSit ? { sit } : {}) });
  }
  return out;
}

/* ─────────────── 진행 ─────────────── */

export type Step = "turn" | "game" | "missions" | "end" | "done" | "pending" | "pick" | "battle" | "offer";
export function stepOf(c: Career): Step {
  if (c.phase === "done") return "done";
  if (c.pending) return "pending";
  if (c.pick) return "pick";
  if (c.battle) return "battle";
  if (c.offer) return "offer";
  if (c.phase === "end") return "end";
  if (c.phase === "camp" && c.tickets <= 0) return "missions";
  if ((c.phase === "season" || c.phase === "final") && c.tickets <= 0) return "game";
  return "turn";
}

/** 지금 구간 설명 */
export function whenText(c: Career) {
  if (c.phase === "camp") return "캠프";
  if (c.phase === "season") return `${c.week}주차`;
  if (c.phase === "final") return "챔피언전 주";
  return "시즌 결산";
}
/** 이번 주 경기 이름 */
export const gameName = (c: Career) => (c.phase === "final" ? "챔피언 결정전" : `라이징스타 리그 ${c.week}차전`);
/** 이번 주 상대 (TEAM_DEFS 번호) */
export const oppOf = (c: Career) => (c.phase === "final" ? (c.finalOpp ?? 1) : 1 + ((c.week - 1) % 3));
/** 이번 경기 열쇠 → careerSetup (상대 선수 시드) */
export const gameKey = (c: Career) => (c.phase === "final" ? 300 + oppOf(c) : c.week);
/** 이번 주 상대 투수 수준 */
export const pitchLv = (c: Career) => PITCH_LV[Math.min(PITCH_LV.length - 1, c.week)];

/* ─────────────── 팀 순위 ─────────────── */

const newTable = (): [number, number][] => TEAM_DEFS.map(() => [0, 0]);
/** 다른 팀 시즌 전력 (시드 고정 · 서로 붙을 때 승률 ±) */
function teamPow(c: Pick<Career, "seed">) {
  const r = makeRng((c.seed * 131 + 3) >>> 0);
  return TEAM_DEFS.map((_, i) => (i === 0 ? 0 : (r() - 0.5) * 0.24));
}
/** 순위표 — 승률 순 (같으면 시드로) */
export function standings(c: Pick<Career, "seed" | "table">) {
  const t = c.table ?? newTable();
  const pow = teamPow(c);
  return TEAM_DEFS.map((d, i) => ({ i, name: d.name, short: d.short, color: d.color, w: t[i][0], l: t[i][1], pct: t[i][0] / Math.max(1, t[i][0] + t[i][1]) }))
    .sort((a, b) => b.pct - a.pct || b.w - a.w || pow[b.i] - pow[a.i])
    .map((r, k) => ({ ...r, rank: k + 1 }));
}
export const myRank = (c: Pick<Career, "seed" | "table">) => standings(c).find((r) => r.i === 0)!.rank;
/** 다른 두 팀끼리 한 경기 */
function simOthers(c: Career, opp: number, rng: Rng) {
  const [x, y] = [1, 2, 3].filter((i) => i !== opp);
  const pow = teamPow(c);
  const xw = rng() < 0.5 + pow[x] - pow[y];
  c.table[xw ? x : y][0]++;
  c.table[xw ? y : x][1]++;
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

export interface Delta {
  stats: Partial<Stats>;
  stamina: number;
  cond: number;
  money: number;
  sp: number;
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
  /** 함께한 캐릭터들 (훈련) + 오른 호감 */
  mates?: { id: BondId; aff: number; friend: boolean }[];
  /** 훈련 결과 카드 덤 분해 (화면 칩) */
  bonus?: string[];
  /** 훈련 종류 */
  train?: TrainKey;
  /** 미연시 장면 (전신 그림 + 대사) */
  vn?: { char: CharId; lines: string[]; skin?: string; key?: string };
  /** 호감 변화 */
  aff?: number;
}

function snap(c: Career) {
  return { stats: { ...c.stats }, stamina: c.stamina, cond: c.cond, money: c.money, sp: c.sp };
}
function diffOf(c: Career, a: ReturnType<typeof snap>): Delta {
  const stats: Partial<Stats> = {};
  for (const k of STAT_KEYS) {
    const d = Math.round(c.stats[k]) - Math.round(a.stats[k]);
    if (d) stats[k] = d;
  }
  return { stats, stamina: Math.round(c.stamina - a.stamina), cond: c.cond - a.cond, money: c.money - a.money, sp: c.sp - a.sp };
}

function addCond(c: Career, d: number) {
  const fx = fxOf(c);
  if (d < 0 && fx.calm) d += 1;
  c.cond = clamp(c.cond + d, fx.condFloor ? 1 : 0, 4);
}
const addStamina = (c: Career, d: number) => (c.stamina = clamp(c.stamina + d, 0, 100));
function addMoney(c: Career, d: number) {
  c.money += Math.round(d * (d > 0 ? 1 + fxOf(c).money : 1));
}
function addSp(c: Career, d: number) {
  const v = Math.round(d * (d > 0 ? 1 + fxOf(c).sp : 1));
  c.sp = Math.max(0, c.sp + v);
  return v;
}
/** 호감 올리기 (축복 보너스 반영) — 실제 오른 값 */
function addAff(c: Career, id: BondId, d: number) {
  const before = c.aff[id] ?? 0;
  const v = d > 0 ? d * (1 + fxOf(c).aff) : d;
  c.aff[id] = clamp(Math.round(before + v), 0, 100);
  return c.aff[id]! - before;
}

function injuryP(c: Career) {
  let p = c.stamina < 30 ? 0.01 + ((30 - c.stamina) / 30) * 0.22 : 0.004;
  p *= Math.max(0.15, 1 + fxOf(c).injury);
  return p;
}
function hurt(c: Career, rng: Rng, worse: boolean): string[] {
  let r = rng();
  if (worse) r *= 0.6;
  const kind: Injury["kind"] = r < 0.1 ? 2 : r < 0.4 ? 1 : 0;
  let left = [1, 3, 6][kind];
  left *= Math.max(0.3, 1 + fxOf(c).injuryDur);
  left = Math.max(1, Math.round(left));
  c.injury = { kind, left };
  const out = [`${INJURY_NAME[kind]}! ${left}턴 동안 숙소에서 쉬어야 한다.`];
  if (kind === 2 && !c.skills.includes("fragile") && !c.skills.includes("iron") && rng() < 0.4) {
    c.skills.push("fragile");
    out.push("특수능력 「부상 체질」이 생겼다…");
  }
  addCond(c, -1);
  return out;
}

/** 훈련 확률 (화면에도 보여 줌): 성공률 = 1 − fail */
export function trainRisk(c: Career) {
  const fx = fxOf(c);
  return {
    injury: injuryP(c),
    fail: clamp(0.02 + (Math.max(0, 50 - c.stamina) / 50) * 0.45 - fx.fail, 0, 0.6),
    great: clamp(0.08 + c.cond * 0.03 + (c.charmNext ? 0.25 : 0) + fx.great, 0, 0.9),
  };
}

/** 그 훈련 효율 배율 (레벨 · 장비 · 특수능력) */
export function trainMul(c: Career, k: TrainKey) {
  const fx = fxOf(c);
  const gear = GEAR_IDS.find((g) => GEAR[g].train === k);
  const tier = gear ? c.gear[gear] ?? 0 : 0;
  return (1 + (trainLv(c, k) - 1) * TRAIN_LV_MUL) * (1 + (tier ? GEAR_TIER[tier - 1].train : 0)) * Math.max(0.3, 1 + fx.train[k] + fx.train.all);
}

/** 이번 턴 훈련장마다 와 있는 덱 캐릭터 (시드 · 턴으로 정해짐). 넷 중 한 곳(자기 능력치 훈련이 반쯤) · 가끔 안 옴 */
export function matesOf(c: Career): Partial<Record<TrainKey, BondId[]>> {
  const out: Partial<Record<TrainKey, BondId[]>> = {};
  if (TUNE.noBond) return out;
  const rng = makeRng((c.seed * 7919 + c.turn * 104729 + 17) >>> 0);
  const keys: TrainKey[] = ["hit", "power", "run", "def"];
  for (const id of c.deck) {
    if (rng() < 0.18) continue;
    const k = rng() < 0.5 ? (BONDS[id].stat as TrainKey) : rng.pick(keys);
    (out[k] ??= []).push(id);
  }
  return out;
}
/** 함께 훈련 배율 덤 (한 사람) — 호감이 높을수록 크고, 우정(호감 60+)이면 크게 */
export function mateBonus(c: Career, id: BondId) {
  const a = c.aff[id] ?? 0;
  return a >= FRIEND_AFF ? 0.6 : 0.22 + Math.min(0.28, a / 220);
}

/** 훈련 미리보기 (화면 패널) — 성장은 대략값 (대성공 · 실패 · 난수 빼고) */
export function trainPreview(c: Career, k: TrainKey) {
  const t = TRAINS[k];
  const mates = matesOf(c)[k] ?? [];
  const mateMul = 1 + mates.reduce((s, id) => s + mateBonus(c, id), 0);
  const mul = COND_TRAIN[c.cond] * trainMul(c, k) * mateMul * TUNE.train;
  const gain: Partial<Stats> = {};
  for (const [sk, w] of Object.entries(t.gain) as [StatKey, number][]) gain[sk] = Math.max(1, Math.round(TRAIN_BASE * w * mul * TYPES[c.type].apt[sk] * dim(c.stats[sk])));
  const r = trainRisk(c);
  const cost = Math.round(t.cost * (1 - fxOf(c).stam));
  return { gain, sp: Math.round((t.sp + mates.length * 2) * (1 + fxOf(c).sp)), money: 30, cost, success: 1 - r.fail, great: r.great, injury: r.injury, mates, mateMul, lv: trainLv(c, k) };
}

/** 훈련 */
function train(c: Career, k: TrainKey, rng: Rng): TurnOut {
  const t = TRAINS[k];
  const a = snap(c);
  const lines: string[] = [];
  const bonus: string[] = [];
  const cost = t.cost * (1 - fxOf(c).stam);
  if (rng() < injuryP(c)) {
    addStamina(c, -cost);
    const l = hurt(c, rng, c.stamina < 10);
    c.charmNext = false;
    return { title: `${t.name} 중 부상!`, tone: "injury", lines: l, delta: diffOf(c, a), train: k };
  }
  const { fail: failP, great: greatP } = trainRisk(c);
  c.charmNext = false;
  const r = rng();
  const tone: TurnOut["tone"] = r < failP ? "fail" : r < failP + greatP ? "great" : "ok";
  // 함께 훈련
  const mates = k !== "special" ? matesOf(c)[k] ?? [] : [];
  let mateMul = 1;
  const mo: NonNullable<TurnOut["mates"]> = [];
  for (const id of mates) {
    const friend = (c.aff[id] ?? 0) >= FRIEND_AFF;
    mateMul += mateBonus(c, id);
    const d = addAff(c, id, friend ? 4 : 6);
    mo.push({ id, aff: d, friend });
  }
  if (mates.length) bonus.push(`${mo.some((m) => m.friend) ? "우정 훈련" : "함께 훈련"} ×${mateMul.toFixed(2)}`);
  const lvMulV = 1 + (trainLv(c, k) - 1) * TRAIN_LV_MUL;
  if (lvMulV > 1) bonus.push(`훈련 Lv${trainLv(c, k)} +${Math.round((lvMulV - 1) * 100)}%`);
  if (tone === "great") bonus.push("대성공 ×1.6");
  const mul = (tone === "fail" ? 0.3 : tone === "great" ? 1.6 : 1) * COND_TRAIN[c.cond] * trainMul(c, k) * mateMul * (0.88 + rng() * 0.24) * TUNE.train;
  for (const [sk, w] of Object.entries(t.gain) as [StatKey, number][]) grow(c, sk, TRAIN_BASE * w * mul);
  addStamina(c, -cost);
  addSp(c, (t.sp + mates.length * 2) * (tone === "fail" ? 0.5 : tone === "great" ? 1.5 : 1));
  addMoney(c, 30);
  const lvBefore = trainLv(c, k);
  c.tCount[k]++;
  if (k === "special") {
    const before = spLv(c);
    c.spXp += tone === "great" ? 2 : tone === "fail" ? 0 : 1;
    if (spLv(c) > before) lines.push(spLv(c) >= 5 ? "필살타법 마스터! 이제 경기당 2번" : `필살타법 레벨 ${spLv(c)}!`);
  } else if (trainLv(c, k) > lvBefore) lines.push(`${t.name} 레벨 ${trainLv(c, k)}! 효율 +${Math.round((trainLv(c, k) - 1) * TRAIN_LV_MUL * 100)}%`);
  if (tone === "great") addCond(c, rng() < 0.35 ? 1 : 0);
  if (tone === "fail") {
    addCond(c, -1);
    lines.unshift("몸이 무거워서 집중이 안 됐다… 컨디션 ↓");
  }
  // 감독 지시
  const od = c.story?.order;
  if (od && !od.ok && od.key === k) {
    od.done++;
    if (od.done >= od.need) {
      od.ok = true;
      addSp(c, ORDER_REWARD.sp);
      addMoney(c, ORDER_REWARD.money);
      lines.push(`감독 지시 달성! 스킬P +${ORDER_REWARD.sp} · 자금 +${ORDER_REWARD.money}`);
    } else lines.push(`감독 지시 ${od.done}/${od.need}`);
  }
  const title = tone === "great" ? "훈련 대성공!" : tone === "fail" ? "훈련 실패…" : "훈련 성공";
  return { title, tone, lines, delta: diffOf(c, a), char: mates[0], mates: mo, bonus, train: k };
}

/** 덱에서 호감 제일 높은 사람 */
export function topAff(c: Pick<Career, "deck" | "aff">): BondId | undefined {
  return [...c.deck].sort((a, b) => (c.aff[b] ?? 0) - (c.aff[a] ?? 0))[0];
}
/** 다음 만남 미리보기 (인연 화면 · 이벤트 카드) */
export function nextBeat(c: Career, id: BondId): { kind: BeatKind | "hang"; why?: string } {
  const v = c.bonds[id] ?? 0;
  if (v >= BOND_MAX) return { kind: "hang" };
  if (c.battle?.char === id) return { kind: BEATS[v] };
  if ((c.aff[id] ?? 0) < VISIT_AFF[v]) return { kind: "hang", why: `호감 ${VISIT_AFF[v]} 필요` };
  return { kind: BEATS[v] };
}

/** 캐릭터 만나기 — 줄기 진행 (이야기 · 축복 · 대결), 호감 모자라면 어울리기 */
function meet(c: Career, id: BondId, rng: Rng): TurnOut {
  const a = snap(c);
  const ch = charById(id);
  const b = BONDS[id];
  const v = c.bonds[id] ?? 0;
  addStamina(c, 5);
  addCond(c, 1);
  const nb = nextBeat(c, id);
  if (nb.kind === "hang") {
    grow(c, b.stat, 10);
    const d = addAff(c, id, v >= BOND_MAX ? 4 : 8);
    const lines = v >= BOND_MAX ? [`${ch.name}와 즐거운 시간.`] : [`${ch.name}와 어울렸다.`, `(다음 이야기는 ${nb.why})`];
    return { title: `${ch.name}와 한때`, tone: "ok", lines, delta: diffOf(c, a), char: id, aff: d };
  }
  const beat = STORY[id][v];
  const title = `${ch.name} · ${BEAT_NAME[nb.kind]}`;
  if (nb.kind === "talk") {
    const opts: Choice[] = [...(beat.choices ?? [])];
    if (beat.special && (c.know[id] ?? 0) >= beat.special.need) opts.push(beat.special.choice);
    c.bonds[id] = v + 1;
    c.pending = { kind: "scene", char: id, title, text: beat.lines[beat.lines.length - 1], choices: opts.map((o) => o.text), scene: { lines: beat.lines, opts, beat: v } };
    return { title, tone: "event", lines: [], delta: diffOf(c, a), char: id, stub: true };
  }
  if (nb.kind === "boon") {
    c.bonds[id] = v + 1;
    grow(c, b.stat, 16);
    const d = addAff(c, id, 5);
    makeBoonPick(c, id, rng, `${ch.name}의 축복`);
    return { title, tone: "event", lines: [`${ch.name}의 축복 — 하나를 고를 수 있다.`], delta: diffOf(c, a), char: id, aff: d, vn: { char: id, lines: beat.lines, key: `${id}:${v}` } };
  }
  // 대결 (이기면 다음 줄기)
  const B = BATTLES[nb.kind];
  c.battle = { char: id, kind: nb.kind, pitches: B.pitches, need: B.need, magic: B.magic, tries: c.tries[id] ?? 0 };
  return { title, tone: "event", lines: [`${ch.name}의 공 ${B.pitches}개 · ${B.need}점 이상이면 승리 · 안타 1점 · 홈런 2점`], delta: diffOf(c, a), char: id, vn: { char: id, lines: beat.lines, key: `${id}:${v}` } };
}

/** 인연 축복 3장 — 그 사람 축복(겹치면 레벨 업) + 조건 맞는 듀오 */
function makeBoonPick(c: Career, id: BondId, rng: Rng, from: string) {
  const own = (x: SkillId) => c.skills.includes(x);
  const lv = (x: SkillId) => (own(x) ? boonLv(c, x) : 0);
  const mine = (BOONS[id] as SkillId[]).filter((x) => x in SKILLS && lv(x) < 3);
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

/** 장소 · 돌발 이벤트 */
function spotEvent(c: Career, e: SpotEvent, rng: Rng): TurnOut {
  const a = snap(c);
  const ev = SPOT_EVENTS[e];
  const lines: string[] = [];
  let tone: TurnOut["tone"] = "event";
  if (e === "quiz") {
    addCond(c, 1);
    if (rng() < 0.75 && makePick(c, rng, "야구 퀴즈쇼 우승")) lines.push("퀴즈쇼 우승! 상품으로 특수능력 하나를 고를 수 있다.");
    else {
      addSp(c, 25);
      lines.push("아깝게 준우승. 상금 대신 스킬P를 받았다.");
    }
  } else if (e === "signing") {
    addMoney(c, 180);
    addCond(c, 1);
    lines.push("줄이 길었다! 팬이 늘었다.");
  } else if (e === "secret") {
    const k = lowestFocus(c);
    grow(c, k, TRAIN_BASE * 1.6);
    addStamina(c, -25);
    lines.push(`강변에서 혼자 ${STAT_NAME[k]} 특훈. 몸이 부서질 것 같다.`);
  } else if (e === "advice") {
    const k = rng.pick(STAT_KEYS);
    grow(c, k, 14);
    addSp(c, 15);
    lines.push(`선배가 ${STAT_NAME[k]} 요령을 알려 줬다.`);
  } else if (e === "fan") {
    addCond(c, 1);
    addStamina(c, 15);
    lines.push("응원 편지가 왔다! 힘이 난다.");
  } else if (e === "coach") {
    c.pending = { kind: "coach", title: ev.name, text: "\"오늘 밤 특별 훈련 할 텐가? 힘들 거다.\"", choices: ["한다!", "사양한다"] };
    return { title: ev.name, tone: "event", lines: ["감독이 불렀다."], stub: true, delta: diffOf(c, a) };
  } else if (e === "night") {
    c.pending = { kind: "night", title: ev.name, text: "동료들이 밤에 자율 훈련을 한다고 한다.", choices: ["같이 나간다", "일찍 잔다"] };
    return { title: ev.name, tone: "event", lines: ["동료가 말을 걸어왔다."], stub: true, delta: diffOf(c, a) };
  } else if (e === "press") {
    c.pending = { kind: "press", title: ev.name, text: "\"요즘 컨디션 어떻습니까? 각오 한마디!\"", choices: ["겸손하게", "자신만만하게"] };
    return { title: ev.name, tone: "event", lines: ["기자가 찾아왔다."], stub: true, delta: diffOf(c, a) };
  } else {
    // 불길한 예감 — 고르면 슬럼프를 피할 확률 (안 고르면 다음 이벤트 때 걸릴 수도)
    const fx = fxOf(c);
    if (fx.slump <= -1 || rng() < 0.5) lines.push("불안했지만 평정심으로 넘겼다. 오히려 마음이 단단해졌다.");
    else {
      addCond(c, -2);
      lines.push("뭘 해도 안 풀린다… 슬럼프다.");
      tone = "fail";
      if (rng() < 0.15 && !c.skills.includes("clutch") && !c.skills.includes("clutchBad")) {
        c.skills.push("clutchBad");
        lines.push("특수능력 「찬스 약함」이 생겼다…");
      }
    }
  }
  return { title: ev.name, tone, lines, delta: diffOf(c, a) };
}

/** 각성 — 능력치 폭발 (한 판에 한 번) */
function tryAwaken(c: Career, rng: Rng, p: number): TurnOut | undefined {
  if (c.awakened) return;
  if (rng() >= p * (1 + fxOf(c).awaken)) return;
  const a = snap(c);
  c.awakened = true;
  for (const k of STAT_KEYS) grow(c, k, 40);
  addCond(c, 4);
  return { title: "각성!", tone: "awaken", lines: ["몸 안에서 뭔가가 깨어났다…!", "모든 능력치 대폭 ↑"], delta: diffOf(c, a) };
}

/** 이벤트 고르기 3장 만들기 (훈련 뒤 확률로) */
function makeOffer(c: Career, rng: Rng) {
  const cards: OfferCard[] = [];
  const ready = c.deck.filter((id) => nextBeat(c, id).kind !== "hang");
  const quiet = c.deck.filter((id) => !ready.includes(id) && (c.bonds[id] ?? 0) < BOND_MAX);
  const bondCard = (id: BondId): OfferCard => {
    const nb = nextBeat(c, id);
    const ch = charById(id);
    return nb.kind === "hang"
      ? { char: id, title: `${ch.name}와 어울리기`, desc: `호감 ↑ · ${STAT_NAME[BONDS[id].stat]} 조금 (${nb.why ?? "이야기 다 봄"})` }
      : { char: id, title: `${ch.name} · ${BEAT_NAME[nb.kind]}`, desc: nb.kind === "talk" ? "이야기 — 고르는 답에 따라 호감 · 이해" : nb.kind === "boon" ? "인연 축복 하나 고르기" : nb.kind === "mini" ? "가벼운 대결 (공 3개) — 이기면 축복" : "필살 전수 대결 (공 5개) — 이기면 필살타법!" };
  };
  const shuffle = <T,>(a: T[]) => a.map((x) => [rng(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  for (const id of shuffle(ready).slice(0, 2)) cards.push(bondCard(id));
  if (cards.length < 2 && quiet.length && rng() < 0.6) cards.push(bondCard(rng.pick(quiet)));
  const evs: SpotEvent[] = ["quiz", "signing", "secret", "advice", "fan", "coach", "night", "press", "slump"];
  const w = (e: SpotEvent) => (e === "quiz" ? 0.6 : e === "slump" ? 0.5 * (1 + fxOf(c).slump) : 1);
  const pool = [...evs];
  while (cards.length < 3 && pool.length) {
    let r = rng() * pool.reduce((s, e) => s + w(e), 0);
    let pick = pool[0];
    for (const e of pool) {
      r -= w(e);
      if (r <= 0) {
        pick = e;
        break;
      }
    }
    pool.splice(pool.indexOf(pick), 1);
    cards.push({ event: pick, title: SPOT_EVENTS[pick].name, desc: SPOT_EVENTS[pick].desc });
  }
  c.offer = { cards: shuffle(cards) };
}

/** 이벤트 카드 고르기 */
export function chooseOffer(c: Career, i: number): TurnOut {
  const o = c.offer;
  if (!o) throw new Error("이벤트 고르기 없음");
  const card = o.cards[i] ?? o.cards[0];
  c.offer = null;
  const rng = turnRng(c, 41 + i);
  const out = card.char ? meet(c, card.char, rng) : spotEvent(c, card.event!, rng);
  pushLog(c, out.title);
  return out;
}

/* ─────────────── 특수능력 고르기 (3장 중 1장) ─────────────── */

/** 고르기·습득 후보 (가진 것 · 인연 · 세트 · 나쁜 것 빼고) */
const pickPool = (c: Career) => SKILL_IDS.filter((id) => !c.skills.includes(id) && !skill(id).noPick && !skill(id).set && !skill(id).bad);

/** 특수능력 고르기 만들기 — 고를 카드가 하나도 없으면 false */
function makePick(c: Career, rng: Rng, from: string) {
  const pool = pickPool(c);
  if (!pool.length) return false;
  const opts: SkillId[] = [];
  const tags = Object.entries(tagCount(c)).filter(([, n]) => (n ?? 0) > 0 && (n ?? 0) < SET_NEED).map(([t]) => t as Tag);
  const want = tags.length ? pool.filter((id) => !skill(id).risk && tags.includes(skill(id).tag as Tag)) : [];
  if (want.length && rng() < 0.75) opts.push(rng.pick(want));
  const risky = pool.filter((id) => skill(id).risk && !opts.includes(id));
  if (risky.length && rng() < 0.35) opts.push(rng.pick(risky));
  const rest = pool.filter((id) => !opts.includes(id) && !skill(id).risk);
  while (opts.length < 3 && rest.length) opts.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]);
  const left = risky.filter((id) => !opts.includes(id));
  while (opts.length < 3 && left.length) opts.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
  if (!opts.length) return false;
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
    lines = [`축복 「${skill(id).name}」 Lv${c.blv[id]}! 효과 ×${BOON_MUL[c.blv[id]! - 1]}`];
  } else {
    lines = gainSkill(c, id);
    if (p.boon && skill(id).boon && (c.know[p.boon] ?? 0) >= 3) {
      c.blv[id] = 2;
      lines.push(`이해 보너스 — 처음부터 Lv2!`);
    }
  }
  if (p.boon) addAff(c, p.boon, 2);
  pushLog(c, `${p.from}: 「${skill(id).name}」`);
  return { title: skill(id).name, tone: lines.length > 1 ? "great" : "event", lines, delta: diffOf(c, a), char: p.boon };
}

/* ─────────────── 스킬 습득 (스킬P) ─────────────── */

/** 이번 주 스킬 진열 6장 (시드 · 주로 정해짐, 산 건 빠짐) */
export function skillShop(c: Career): SkillId[] {
  const rng = makeRng((c.seed * 6007 + c.week * 811 + 99) >>> 0);
  const all = SKILL_IDS.filter((id) => !skill(id).noPick && !skill(id).set && !skill(id).bad);
  const shuffled = all.map((id) => [rng(), id] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  // 가진 태그 쪽을 하나는 넣음 (세트 노리기)
  const tags = Object.entries(tagCount(c)).filter(([, n]) => (n ?? 0) > 0 && (n ?? 0) < SET_NEED).map(([t]) => t as Tag);
  const want = shuffled.find((id) => tags.includes(skill(id).tag as Tag));
  const list = [...(want ? [want] : []), ...shuffled.filter((id) => id !== want)].slice(0, 6);
  return list.filter((id) => !c.skills.includes(id));
}
/** 스킬 값 (가진 일반 카드가 많을수록 비쌈) */
export function skillPrice(c: Career, id: SkillId) {
  const n = c.skills.filter((x) => !skill(x).boon && !skill(x).set && !skill(x).bad).length;
  return (skill(id).risk ? 50 : 70) + n * 15;
}
export function buySkill(c: Career, id: SkillId): string[] | string {
  if (c.skills.includes(id)) return "이미 있어요";
  if (!skillShop(c).includes(id)) return "이번 주 진열이 아니에요";
  const p = skillPrice(c, id);
  if (c.sp < p) return `스킬P가 모자라요 (${p} 필요)`;
  c.sp -= p;
  const lines = gainSkill(c, id);
  pushLog(c, `스킬 습득: 「${skill(id).name}」`);
  return lines;
}

/* ─────────────── 인연 대결 ─────────────── */

/**
 * 대결 결과 반영 — pts = 점수 (안타 1 · 홈런 2).
 * 이기면 줄기 진행: 가벼운 대결 → 축복 고르기 · 필살 전수 대결 → 필살타법 (이미 있으면 축복). 지면 다음 만남에 다시.
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
    c.tries[id] = bt.tries + 1;
    grow(c, b.stat, 6);
    aff = addAff(c, id, 3);
    lines.push(`${ch.name}: "아직이야. 다음에 또 와."`, "(다음에 만나면 다시 도전)");
    pushLog(c, `${ch.name}와 대결 패배 · ${pts}점`);
    return { title: `${ch.name}와 대결 — 패배`, tone: "fail", lines, delta: diffOf(c, a), char: id, aff };
  }
  delete c.tries[id];
  c.bonds[id] = (c.bonds[id] ?? 0) + 1;
  aff = addAff(c, id, bt.kind === "final" ? 10 : 7);
  let extra: TurnOut | undefined;
  if (bt.kind === "mini") {
    grow(c, b.stat, 20);
    makeBoonPick(c, id, rng, `${ch.name}에게 이겼다! 축복`);
    lines.push(`${ch.name}: "…좋아, 인정."`, "축복 하나를 고를 수 있다.");
  } else {
    grow(c, b.stat, 36);
    for (const k of STAT_KEYS) if (k !== b.stat) grow(c, k, 10);
    if (!c.learned) {
      c.learned = id;
      lines.push(`필살타법 「${ch.swing.name}」 전수! 경기당 ${spUses(c)}번 · 「필살 훈련」이 열렸다.`);
    } else {
      lines.push(`이미 「${charById(c.learned).swing.name}」을 익혀서 — 대신 ${ch.name}의 축복을 하나 더.`);
      makeBoonPick(c, id, rng, `${ch.name}의 마지막 가르침`);
    }
    extra = tryAwaken(c, rng, 0.04);
  }
  pushLog(c, `${ch.name}와 대결 승리 · ${pts}점`);
  return { title: `${ch.name}와 대결 — 승리!`, tone: "great", lines, delta: diffOf(c, a), char: id, aff, extra };
}

/** 대결 자동 — 타격 · 파워 · 실력(σ)으로 공마다 안타/홈런 확률 */
export function autoBattle(c: Career, rng: Rng, sigma = 0.075): number {
  const bt = c.battle;
  if (!bt) return 0;
  const bb = careerBatter(c);
  const skillF = clamp(1.35 - sigma * 6, 0.6, 1.25);
  let pts = 0;
  for (let i = 0; i < bt.pitches; i++) {
    const magic = bt.magic.includes(i);
    const pHit = clamp((0.22 + bb.hit / 1800) * skillF * (magic ? 0.6 : 1), 0.05, 0.78);
    if (rng() < pHit) pts += rng() < clamp(0.06 + bb.power / 2200, 0.05, 0.5) ? 2 : 1;
  }
  return pts;
}

/* ─────────────── 턴 행동 ─────────────── */

export type Action = { kind: "train"; key: TrainKey } | { kind: "rest" } | { kind: "play" } | { kind: "clinic" };
export const DORM: Record<"rest" | "play" | "clinic", { name: string; icon: string; desc: string }> = {
  rest: { name: "휴식하기", icon: "🛏️", desc: "체력 +50" },
  play: { name: "게임하기", icon: "🎮", desc: "컨디션 +1 · 체력 +15" },
  clinic: { name: "치료받기", icon: "🩺", desc: "부상 2턴 회복 · 체력 +20" },
};

/** 할 수 없으면 이유 (화면에 그대로) */
export function whyNot(c: Career, a: Action): string | null {
  if (stepOf(c) !== "turn") return "지금은 행동 차례가 아니에요";
  if (c.tickets <= 0) return "행동권이 없어요";
  if (c.injury && a.kind === "train") return "부상 중엔 숙소에서 쉬어야 해요";
  if (a.kind === "train" && a.key === "special" && !c.learned) return "필살타법을 배워야 열려요 — 인연 「필살 전수 대결」에서";
  if (a.kind === "train" && a.key === "special" && spLv(c) >= 5) return "필살타법 마스터 Lv5 — 더 오를 게 없어요";
  if (a.kind === "clinic" && !c.injury) return "아픈 데가 없어요";
  return null;
}

/** 턴 행동 하나 (행동권 1장) */
export function act(c: Career, a: Action): TurnOut {
  const why = whyNot(c, a);
  if (why) throw new Error(why);
  const rng = turnRng(c);
  let out: TurnOut;
  const s0 = snap(c);
  const fx = fxOf(c);
  switch (a.kind) {
    case "train":
      out = train(c, a.key, rng);
      break;
    case "rest":
      addStamina(c, (c.injury ? 35 : 50) * (1 + fx.rest));
      if (rng() < 0.3) addCond(c, 1);
      out = { title: "회복 성공", tone: "ok", lines: [c.injury ? "몸을 추슬렀다." : "푹 쉬었다."], delta: diffOf(c, s0) };
      break;
    case "play":
      addStamina(c, 15 * (1 + fx.rest));
      addCond(c, 1);
      out = { title: "기분 전환", tone: "ok", lines: ["게임 한 판! 기분이 좋아졌다."], delta: diffOf(c, s0) };
      break;
    case "clinic": {
      addStamina(c, 20);
      const lines = ["치료를 받았다."];
      if (c.injury) {
        c.injury.left = Math.max(0, c.injury.left - 2);
        lines.push(c.injury.left ? `복귀까지 ${c.injury.left}턴` : "다 나았다!");
        if (!c.injury.left) c.injury = null;
      }
      out = { title: "치료", tone: "ok", lines, delta: diffOf(c, s0) };
      break;
    }
  }
  c.tickets--;
  c.usedItem = false;
  if (a.kind !== "clinic") tickInjury(c);
  // 훈련 뒤 이벤트 고르기 (덱 사람 이야기가 준비됐으면 더 자주) · 아주 드물게 각성
  if (a.kind === "train" && out.tone !== "injury") {
    const aw = tryAwaken(c, rng, 0.002 * (c.cond === 4 ? 2 : 1));
    // 같이 훈련한 사람 이야기가 준비됐으면 반쯤은 바로 그 사람 이벤트 (슈퍼스타즈: 훈련 끝나고 트레이너 이벤트)
    const mateReady = (out.mates ?? []).map((m) => m.id).filter((id) => nextBeat(c, id).kind !== "hang");
    if (aw) out.extra = aw;
    else if (mateReady.length && rng() < 0.5) out.extra = meet(c, rng.pick(mateReady), rng);
    else {
      const ready = c.deck.some((id) => nextBeat(c, id).kind !== "hang");
      if (rng() < (ready ? 0.5 : 0.3)) makeOffer(c, rng);
    }
  }
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
  if (p.kind === "scene" && p.scene) {
    const id = p.char as BondId;
    const o = p.scene.opts[pick] ?? p.scene.opts[0];
    const aff = addAff(c, id, o.aff);
    if (o.know) c.know[id] = (c.know[id] ?? 0) + 1;
    grow(c, BONDS[id].stat, 10 + o.aff * 0.8);
    lines.push(`호감 ${aff >= 0 ? "+" : ""}${aff}${o.know ? " · 마음이 통했다 · 이해 +1" : ""}`);
    pushLog(c, `${p.title}: ${o.text}`);
    return { title: p.title, tone: o.know ? "great" : "event", lines, delta: diffOf(c, a), char: id, aff, vn: { char: id, lines: [`▶ ${o.text}`, o.reply] } };
  } else if (p.kind === "coach") {
    if (pick === 0) {
      if (rng() < injuryP(c) * 1.5 + 0.03) {
        lines.push(...hurt(c, rng, c.stamina < 25));
        tone = "injury";
      } else {
        const k = lowestFocus(c);
        grow(c, k, TRAIN_BASE * 1.2);
        addStamina(c, -20);
        addSp(c, 15);
        lines.push(`밤새 ${STAT_NAME[k]} 특훈! 감독이 흐뭇해한다.`);
      }
    } else {
      addStamina(c, 5);
      lines.push("감독이 조금 아쉬워한다.");
    }
  } else if (p.kind === "night") {
    if (pick === 0) {
      const k = rng.pick(STAT_KEYS);
      grow(c, k, TRAIN_BASE * 0.7);
      addStamina(c, -12);
      lines.push(`${STAT_NAME[k]} 자율 훈련 완료.`);
    } else {
      addStamina(c, 15);
      lines.push("푹 잤다.");
    }
  } else if (p.kind === "press") {
    if (pick === 0) {
      addSp(c, 12);
      lines.push("겸손한 인터뷰 — 차분하게 다시 다짐했다.");
    } else if (rng() < 0.5) {
      addCond(c, 1);
      addMoney(c, 120);
      lines.push("자신감 넘치는 인터뷰가 화제! 광고 문의까지.");
    } else {
      addCond(c, -1);
      lines.push("건방지다는 기사가 났다… 신경 쓰인다.");
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

/** 캠프 끝: 시즌 미션 3개 고르기 → 1주차 시작 */
export function chooseMissions(c: Career, ms: SeasonMission[]): string | null {
  if (stepOf(c) !== "missions") return "지금은 미션 고를 때가 아니에요";
  const uniq = ms.filter((m, i) => ms.findIndex((x) => x.key === m.key) === i && m.tier >= 0 && m.tier <= 2);
  if (uniq.length !== 3) return "서로 다른 미션 3개를 골라 주세요";
  c.missions = uniq.map((m) => ({ key: m.key, tier: m.tier }));
  c.phase = "season";
  c.week = 1;
  c.tickets = TICKETS;
  c.weekStart = { ...c.stats };
  setOrder(c);
  pushLog(c, "시즌 개막! 시즌 미션: " + c.missions.map(missionName).join(" · "));
  return null;
}

/* ─────────────── 상점 ─────────────── */

export function gearNext(c: Career, id: GearId) {
  const cur = c.gear[id] ?? 0;
  if (cur >= 3) return null;
  const t = GEAR_TIER[cur];
  const why = c.money < t.price ? "자금이 모자라요" : null;
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
  /** 미션 결과 하나씩 (인연 미션 호감) */
  results?: { ok: boolean; partial?: boolean; char?: CharId }[];
  /** 직접 쳤나 (자동이면 false) */
  direct: boolean;
  /** 영양가 — 결승타 · 역전타 · 끝내기 · 병살 */
  clutch?: Clutch;
  /** 도루 성공 · 실패 · 호수비 */
  sb?: number;
  cs?: number;
  df?: number;
}
export const CLUTCH_W = { gw: 1, comeback: 1, walkoff: 1.5, gidp: -0.5 };
/**
 * 경기 평가 S ~ D → 스킬P · 자금 · 컨디션 · 체력 (+ 실전 경험은 기록 따라)
 * 분포 목표 S 6 · A 20 · B 32 · C 25 · D 17%
 */
export const GAME_GRADES = [
  { g: "S", label: "Perfect", sp: 40, money: 150, sta: 4, up: 0.7, down: 0, color: "#ff7ae0" },
  { g: "A", label: "Great", sp: 30, money: 110, sta: 0, up: 0.35, down: 0, color: "#ffcf4a" },
  { g: "B", label: "Good", sp: 20, money: 80, sta: -4, up: 0, down: 0, color: "#7dff9a" },
  { g: "C", label: "Normal", sp: 12, money: 50, sta: -6, up: 0, down: 0, color: "#7ad7ff" },
  { g: "D", label: "Bad", sp: 6, money: 30, sta: -8, up: 0, down: 0.35, color: "#9a9a9a" },
] as const;
/** 경기 평가 가중치 — 타입마다 「제 몫」을 다르게 봄 */
const GRADE_W: Record<BatType, { s: number; xb: number; hr: number; bb: number; r: number; sb: number; df: number }> = {
  contact: { s: 1.3, xb: 1.9, hr: 3.0, bb: 0.8, r: 0.5, sb: 0.6, df: 0.8 },
  power: { s: 0.8, xb: 1.8, hr: 3.2, bb: 0.6, r: 0.4, sb: 0.5, df: 0.8 },
  speed: { s: 1.15, xb: 1.9, hr: 3.0, bb: 0.8, r: 0.8, sb: 1.0, df: 0.8 },
  defense: { s: 1.0, xb: 1.8, hr: 3.0, bb: 0.7, r: 0.55, sb: 0.6, df: 1.3 },
  all: { s: 1.0, xb: 1.8, hr: 3.0, bb: 0.65, r: 0.5, sb: 0.7, df: 0.9 },
};
const GRADE_CUT = [6.4, 3.1, 0.95, -0.4];
export function gameGrade(l: BatLine, missions: number, type: BatType = "all", cl?: Clutch, extra?: { sb?: number; cs?: number; df?: number }) {
  const w = GRADE_W[type];
  const singles = l.h - l.d2 - l.d3 - l.hr;
  const sc =
    singles * w.s + (l.d2 + l.d3 * 1.3) * w.xb + l.hr * w.hr + l.bb * w.bb + l.rbi * 0.8 + l.r * w.r + missions * 0.5 - l.k * 0.25 - (l.ab - l.h) * 0.3 +
    (extra?.sb ?? 0) * w.sb - (extra?.cs ?? 0) * 0.6 + (extra?.df ?? 0) * w.df +
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
  /** 실전 경험으로 오른 능력치 */
  exp?: Partial<Stats>;
  /** 이번 주 성장 (주차 결산) */
  week?: { label: string; gain: Partial<Stats>; stats: Stats };
  /** 이번 경기로 이룬 시즌 미션 */
  missionsDone?: string[];
  /** 정규 시즌이 끝나서 정해진 것 */
  next?: "final" | "end";
}

/** 이번 경기에 나가나 (부상이면 못 나감) */
export const canPlay = (c: Career) => !c.injury;

/** 실전 경험: 기록 따라 능력치 조금 (경기도 성장이 되게) */
export const EXP = { base: 2, h: 3, bb: 1, xb: 2, hr: 6, r: 2, sb: 5, df: 6 };

/** 경기 결과 반영 (출전 못 했으면 null — 팀 결과만 굴림) */
export function applyGame(c: Career, g: GameIn | null): GameSummary {
  if (stepOf(c) !== "game") throw new Error("경기 차례 아님");
  const a = snap(c);
  const rng = turnRng(c, 3);
  const lines: string[] = [];
  let title: string;
  let grade: number | undefined;
  let exp: Partial<Stats> | undefined;
  const missionsDone: string[] = [];
  // 결장: 팀 승패만 (내 전력 없이 조금 불리)
  const win = g ? g.win : rng() < 0.45;
  if (win === true) c.wins++;
  else if (win === false) c.losses++;
  (c.hist ??= []).push(win ? "W" : win === false ? "L" : "D");
  const fx = fxOf(c);
  if (!g) {
    title = `결장 · ${INJURY_NAME[c.injury?.kind ?? 0]} · 팀 ${win ? "승리" : win === false ? "패배" : "무승부"}`;
    lines.push("벤치에서 동료들을 응원했다.");
    addStamina(c, 10);
  } else {
    const l = g.line;
    const L = c.line;
    L.g++;
    for (const k of ["pa", "ab", "h", "d2", "d3", "hr", "rbi", "bb", "k", "r"] as const) L[k] += l[k];
    L.sb += g.sb ?? 0;
    L.df += g.df ?? 0;
    grade = gameGrade(l, g.missions, c.type, g.clutch, g);
    const G = GAME_GRADES[grade];
    // 실전 경험
    const em = 1 + fx.exp;
    const xb = l.d2 + l.d3;
    const e0 = snap(c);
    grow(c, "hit", (EXP.base + l.h * EXP.h + l.bb * EXP.bb) * em);
    grow(c, "power", (EXP.base + xb * EXP.xb + l.hr * EXP.hr) * em);
    grow(c, "run", (EXP.base + l.r * EXP.r + (g.sb ?? 0) * EXP.sb) * em);
    grow(c, "def", (EXP.base + (g.df ?? 0) * EXP.df) * em);
    exp = diffOf(c, e0).stats;
    addSp(c, G.sp + Math.round(g.missionPt / 4));
    addMoney(c, G.money + (win ? 30 : 0) + Math.round(g.missionPt / 3));
    addStamina(c, G.sta + fx.gameSta);
    let up = rng() < G.up;
    for (let i = 0; i < l.hr && !up; i++) up = rng() < fx.hrCond;
    if (up) addCond(c, 1);
    else if (rng() < G.down) addCond(c, -1);
    title = `${l.ab}타수 ${l.h}안타${l.hr ? ` ${l.hr}홈런` : ""}${l.rbi ? ` ${l.rbi}타점` : ""}${g.sb ? ` ${g.sb}도루` : ""}${g.df ? ` 호수비 ${g.df}` : ""} · 팀 ${win ? "승리" : win === false ? "패배" : "무승부"}`;
    if (l.hr >= 2) lines.push("멀티 홈런! 오늘의 주인공.");
    else if (l.h >= 3) lines.push("맹타! 감독이 엄지를 들었다.");
    else if (l.h === 0) lines.push("오늘은 안 풀렸다…");
    if (g.missions) lines.push(`돌발 미션 ${g.missions}개 성공!`);
    const cl = g.clutch;
    if (cl) {
      if (cl.walkoff) lines.push("🎉 끝내기! 동료들이 물을 뿌리며 달려왔다.");
      else if (cl.gw) lines.push("결승타! 오늘 승리는 내 방망이로.");
      if (cl.comeback && !cl.walkoff) lines.push(cl.comeback > 1 ? `역전타 ${cl.comeback}번!` : "역전타!");
      if (cl.gidp) lines.push(cl.gidp > 1 ? `병살 ${cl.gidp}번… 흐름을 끊었다.` : "병살타… 흐름을 끊었다.");
    }
    for (const r of g.results ?? []) {
      if (!r.char || !isBond(r.char)) continue;
      const d = addAff(c, r.char, r.ok ? 6 : r.partial ? 2 : -2);
      lines.push(`${charById(r.char).name}의 미션 ${r.ok ? "성공" : r.partial ? "아쉬움" : "실패"} — 호감 ${d >= 0 ? `+${d}` : d}`);
    }
    // 시즌 미션
    for (const m of c.missions ?? []) {
      if (m.done || missionNow(c, m.key) < missionNeed(m)) continue;
      m.done = true;
      const v = addSp(c, MISSION_TIER[m.tier].sp);
      missionsDone.push(`시즌 미션 「${missionName(m)}」 달성! 스킬P +${v}`);
    }
    lines.push(...missionsDone);
    // S 평가면 가끔 특수능력 고르기
    if (grade === 0 && rng() < 0.25 && c.mvpPicks < 2) {
      c.mvpPicks++;
      makePick(c, rng, "오늘의 MVP");
      lines.push("오늘의 MVP! 특수능력 하나를 고를 수 있다.");
    }
    if (rng() < (c.stamina < 20 ? 0.04 : 0.004) * Math.max(0.2, 1 + fx.injury)) lines.push(...hurt(c, rng, false));
  }
  const label = c.phase === "final" ? "챔피언전 주" : `${c.week}주차`;
  const gain: Partial<Stats> = {};
  for (const k of STAT_KEYS) {
    const d = Math.round(c.stats[k]) - Math.round(c.weekStart[k]);
    if (d) gain[k] = d;
  }
  const week = { label, gain, stats: { ...c.stats } };
  pushLog(c, `${gameName(c)}: ${title}`);
  c.turn++;
  c.usedItem = false;
  tickInjury(c);
  let next: GameSummary["next"];
  if (c.phase === "final") {
    c.result = win ? "우승" : "준우승";
    lines.push(win ? "🏆 라이징스타 리그 우승!!" : "준우승… 그래도 여기까지 왔다.");
    if (win) {
      addSp(c, 30);
      makePick(c, rng, "우승 보상");
    }
    c.phase = "end";
    next = "end";
  } else {
    const opp = oppOf(c);
    if (win !== null) {
      c.table[0][win ? 0 : 1]++;
      c.table[opp][win ? 1 : 0]++;
    }
    simOthers(c, opp, rng);
    if (c.week >= WEEKS) {
      const st = standings(c);
      const me = st.find((r) => r.i === 0)!;
      lines.push(`정규 시즌 끝 — 우리 팀 ${me.rank}위 · ${me.w}승 ${me.l}패`);
      if (me.rank === 1) {
        c.phase = "final";
        c.week = WEEKS + 1;
        c.finalOpp = st[1].i;
        c.tickets = FINAL_TICKETS;
        setOrder(c);
        lines.push(`1위! 챔피언 결정전 — ${TEAM_DEFS[c.finalOpp].name}. 보너스 행동권 ${FINAL_TICKETS}장!`);
        next = "final";
      } else {
        c.result = `${me.rank}위` as PostRes;
        c.phase = "end";
        lines.push("챔피언전 진출 실패… 시즌이 끝났다.");
        next = "end";
      }
    } else {
      c.week++;
      c.tickets = TICKETS;
      setOrder(c);
    }
  }
  c.weekStart = { ...c.stats };
  return { title, lines, delta: diffOf(c, a), dnp: !g, grade, win, exp, week, missionsDone, next };
}

/* ─────────────── 시즌 결산 ─────────────── */

export const avg = (l: { h: number; ab: number }) => (l.ab ? l.h / l.ab : 0);
export const fmtAvg = (v: number) => v.toFixed(3).replace(/^0/, "");
export const ops = (l: BatLine) => {
  const obp = l.pa ? (l.h + l.bb) / l.pa : 0;
  const tb = l.h + l.d2 + l.d3 * 2 + l.hr * 3;
  return obp + (l.ab ? tb / l.ab : 0);
};
/** 시즌 성적 평가 (OPS) */
export function seasonGrade(l: BatLine) {
  const v = ops(l);
  const L = [
    [0.95, "S", "#ff7ae0"], [0.82, "A", "#ffcf4a"], [0.7, "B", "#7dff9a"], [0.6, "C", "#7ad7ff"], [0, "D", "#9a9a9a"],
  ] as const;
  const r = L.find((x) => v >= x[0])!;
  return { g: r[1], color: r[2] };
}

/** 이번 시즌 리그 1위 기록 (시드로 정해짐) — 타이틀 기준 (6경기) */
export function leagueBest(c: Pick<Career, "seed">) {
  const r = makeRng((c.seed * 31 + 977 + 5) >>> 0);
  return { avg: 0.34 + r() * 0.04, hr: 2 + Math.floor(r() * 2), rbi: 5 + Math.floor(r() * 3), sb: 3 + Math.floor(r() * 3) };
}
/** 수상 레이스 — 지금까지 경기 수 기준 1위 페이스와 내 기록 */
export function awardRace(c: Career) {
  const best = leagueBest(c);
  const k = Math.max(1, c.line.g) / WEEKS;
  const L = c.line;
  const rows = [
    { title: "홈런왕", mine: L.hr, pace: Math.round(best.hr * k), fmt: (v: number) => String(v) },
    { title: "타점왕", mine: L.rbi, pace: Math.round(best.rbi * k), fmt: (v: number) => String(v) },
    { title: "도루왕", mine: L.sb, pace: Math.round(best.sb * k), fmt: (v: number) => String(v) },
    { title: "타격왕", mine: avg(L), pace: best.avg, fmt: (v: number) => fmtAvg(v) },
  ];
  return rows
    .map((r) => ({ ...r, lead: r.mine >= r.pace, gap: r.pace - r.mine }))
    .sort((a, b) => (a.lead === b.lead ? a.gap / Math.max(0.001, a.pace) - b.gap / Math.max(0.001, b.pace) : a.lead ? -1 : 1));
}

export interface SeasonSummary {
  line: Line;
  awards: string[];
  result: PostRes;
  ovr: number;
  grade: ReturnType<typeof gradeOf>;
  top: number;
  nick: string[];
  standings: ReturnType<typeof standings>;
  partner?: BondId;
  epilogue?: string;
  missions: { name: string; done: boolean }[];
}

/** 시즌 끝 → 수상 · 등급 · 칭호 (판 끝) */
export function endSeason(c: Career): SeasonSummary {
  if (c.phase !== "end") throw new Error("시즌 결산 차례 아님");
  const L = c.line;
  const awards: string[] = [];
  const best = leagueBest(c);
  if (L.pa >= 15 && avg(L) >= best.avg) awards.push("타격왕");
  if (L.hr >= best.hr) awards.push("홈런왕");
  if (L.rbi >= best.rbi) awards.push("타점왕");
  if (L.sb >= best.sb) awards.push("도루왕");
  if (c.stats.def >= 720 || L.df >= 4) awards.push("골든글러브");
  if (L.pa >= 15 && ops(L) >= 0.85) awards.push("신인왕");
  if (awards.length >= 3 || (L.pa >= 15 && ops(L) >= 1.0)) awards.push("MVP");
  const result = c.result ?? `${myRank(c)}위` as PostRes;
  const ovr = ovrOf(c);
  const nick: string[] = [];
  if (result === "우승") nick.push(awards.includes("MVP") ? "우승의 주역" : "우승 멤버");
  if (awards.includes("MVP")) nick.push("리그의 지배자");
  if (awards.includes("홈런왕")) nick.push("홈런 공장");
  if (awards.includes("타격왕")) nick.push("안타 제조기");
  if (awards.includes("도루왕")) nick.push("바람의 아들");
  if (awards.includes("골든글러브")) nick.push("철벽");
  for (const id of c.skills) if (skill(id).set) nick.push(skill(id).name);
  if (c.awakened) nick.push("각성자");
  if (c.learned) nick.push(`${charById(c.learned).name}의 제자`);
  if (!nick.length) nick.push(ovr >= 450 ? "성실한 루키" : "미완의 유망주");
  const top = topAff(c);
  const partner = top && (c.aff[top] ?? 0) >= 50 ? top : undefined;
  const s: SeasonSummary = {
    line: { ...L }, awards, result, ovr, grade: gradeOf(ovr), top: topPct(ovr), nick, standings: standings(c), partner, epilogue: partner ? EPILOGUE[partner] : undefined,
    missions: (c.missions ?? []).map((m) => ({ name: missionName(m), done: !!m.done })),
  };
  c.summary = s;
  c.phase = "done";
  c.pick = null;
  c.offer = null;
  pushLog(c, `시즌 결산 — 종합 ${ovr}${awards.length ? ` · ${awards.join(" · ")}` : ""}`);
  return s;
}

/* ─────────────── 명예의 전당 ─────────────── */

export interface HofEntry {
  id: string;
  name: string;
  type: BatType;
  ovr: number;
  grade: string;
  nick: string;
  stats: Partial<Stats> & { hit: number; power: number; run: number };
  hr: number;
  avg: number;
  seasons: number;
  at: number;
  gp: number;
  /** 물려줄 수 있는 특수능력 (세트 · 나쁜 것 · 축복 빼고) */
  skills?: SkillId[];
  partner?: CharId;
  look?: Look;
  bats?: "R" | "L";
  num?: number;
  pos?: string;
  /** v4: 수상 · 우승 */
  awards?: string[];
  result?: string;
}
/** 계승할 수 있는 특수능력인가 */
export const inheritable = (id: SkillId) => id in SKILLS && !skill(id).set && !skill(id).bad && !skill(id).boon;
export function hofEntry(c: Career): HofEntry {
  const s = c.summary ?? endSeasonPreview(c);
  const st = {} as Stats;
  for (const k of STAT_KEYS) st[k] = Math.round(c.stats[k]);
  return {
    id: c.id, name: c.name, type: c.type, ovr: s.ovr, grade: s.grade.g, nick: s.nick[0], stats: st, hr: c.line.hr, avg: avg(c.line), seasons: 1, at: Date.now(), gp: 0,
    skills: c.skills.filter(inheritable), partner: s.partner, look: c.look, bats: c.bats, num: c.num, pos: posOf(c), awards: s.awards, result: s.result,
  };
}
/** 결산 전 미리 (명예의 전당 기록용) */
function endSeasonPreview(c: Career): SeasonSummary {
  const cc = JSON.parse(JSON.stringify(c)) as Career;
  cc.phase = "end";
  return endSeason(cc);
}

/* ─────────────── 봇 육성 (자동 진행 · 밸런스 시뮬) ─────────────── */

export interface Policy {
  /** 이 체력 아래면 쉼 */
  restBelow: number;
  /** 주력 능력치 몰빵 정도 0 ~ 1 */
  focus: number;
  /** 함께 훈련 쫓아가는 정도 0 ~ 1 */
  chase: number;
  shop: boolean;
  /** 이벤트에서 무리하는 쪽 고를 확률 */
  bold: number;
}
export const POLICY_AVG: Policy = { restBelow: 40, focus: 0.6, chase: 0.6, shop: true, bold: 0.5 };

/** 봇이 이번 턴에 할 일 */
export function botAction(c: Career, pol: Policy, rng: Rng): Action {
  if (c.injury) return c.injury.left >= 2 ? { kind: "clinic" } : { kind: "rest" };
  if (c.stamina < pol.restBelow) return { kind: "rest" };
  if (c.cond <= 1 && rng() < 0.5) return { kind: "play" };
  if (c.learned && spLv(c) < 5 && rng() < 0.15) return { kind: "train", key: "special" };
  const apt = TYPES[c.type].apt;
  const mates = matesOf(c);
  const keys: TrainKey[] = ["hit", "power", "run", "def"];
  if (rng() < pol.chase) {
    // 파트너(호감 1위)가 있는 훈련 먼저, 아니면 사람 많은 곳
    const top = topAff(c);
    const withTop = keys.find((k) => top && mates[k]?.includes(top));
    if (withTop && rng() < 0.7) return { kind: "train", key: withTop };
    const best = keys.filter((k) => (mates[k]?.length ?? 0) > 0).sort((a, b) => (mates[b]!.length - mates[a]!.length) || apt[b as StatKey] - apt[a as StatKey])[0];
    if (best) return { kind: "train", key: best };
  }
  let key: TrainKey;
  if (rng() < pol.focus) key = c.type === "all" ? rng.pick(keys) : ([...keys].sort((a, b) => apt[b as StatKey] - apt[a as StatKey])[0]);
  else key = rng.pick(keys);
  return { kind: "train", key };
}
/** 봇 상점: 주력 장비 · 스킬 습득 · 체력 모자라면 드링크 */
export function botShop(c: Career) {
  const best = [...STAT_KEYS].sort((a, b) => TYPES[c.type].apt[b] - TYPES[c.type].apt[a]);
  const gearFor: Record<StatKey, GearId> = { hit: "bat", power: "dumbbell", run: "spike", def: "glove" };
  for (const k of best.slice(0, 2)) {
    const n = gearNext(c, gearFor[k]);
    if (n && !n.why && c.money - n.price > 150) buyGear(c, gearFor[k]);
  }
  for (const id of skillShop(c)) if (!skill(id).risk && c.sp >= skillPrice(c, id) + 20) buySkill(c, id);
  if (c.stamina < 45 && c.money >= CONSUMABLES.drink.price + 200 && !c.usedItem) {
    buy(c, "drink");
    consumeItem(c, "drink");
  } else if (c.bag.charm && !c.charmNext && !c.usedItem) consumeItem(c, "charm");
}
/** 봇 미연시 답: insight 확률로 그 사람다운 답(이해), 아니면 아무거나 */
export function botChoose(c: Career, rng: Rng, insight: number): number {
  const p = c.pending;
  if (!p) return 0;
  if (p.scene) {
    const kn = p.scene.opts.findIndex((o) => o.know);
    if (kn >= 0 && rng() < insight) return kn;
    return Math.floor(rng() * p.scene.opts.length);
  }
  return rng() < 0.5 ? 0 : 1;
}
/** 봇 이벤트 카드: 인연 이야기 먼저 */
export function botOffer(c: Career, rng: Rng): number {
  const o = c.offer;
  if (!o) return 0;
  const ready = o.cards.map((x, i) => ({ x, i })).filter(({ x }) => x.char && nextBeat(c, x.char).kind !== "hang");
  if (ready.length) return ready.sort((a, b) => (c.bonds[b.x.char!] ?? 0) - (c.bonds[a.x.char!] ?? 0))[0].i;
  const j = o.cards.findIndex((x) => x.event && SPOT_EVENTS[x.event].tone === "good");
  return j >= 0 ? j : Math.floor(rng() * o.cards.length);
}
/** 봇 시즌 미션: 타입에 맞는 보통 셋 */
export function botMissions(c: Career): SeasonMission[] {
  const pref: Record<BatType, MissionKey[]> = { contact: ["h", "rbi", "xbh"], power: ["hr", "xbh", "rbi"], speed: ["sb", "h", "rbi"], defense: ["df", "h", "rbi"], all: ["h", "rbi", "xbh"] };
  return pref[c.type].map((key) => ({ key, tier: 1 }));
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
