/*
 * PIXEL MARBLE — 캐릭터 · 장착 아이템 · 등급 · 강화 정의 (서버 · 화면 · 밸런스 시뮬이 같이 씀).
 *
 * 강도는 "파워" p 하나로 셈: p = 등급 바닥(R 0 · SR 5 · SSR 10 · UR 15) + 강화 단계(0~5).
 *   → 아랫 등급 5강(풀강) = 윗 등급 0강. 효과 수치는 전부 p 의 일차식이라 그대로 이어짐.
 * 수치를 바꾸면 BALANCE_VER 를 올리고 `server/scripts/marble-sim.ts` 로 1:1 승률(목표 풀세팅 vs R 0강 ≈ 70%)을 확인.
 * 이 폴더는 브라우저 · 서버 둘 다에서 돌아서 브라우저 전용 API · "@/…" 경로를 쓰지 않음.
 */

export const BALANCE_VER = "m1";

export type Grade = "R" | "SR" | "SSR" | "UR";
export const GRADES: Grade[] = ["R", "SR", "SSR", "UR"];
export const GRADE_FLOOR: Record<Grade, number> = { R: 0, SR: 5, SSR: 10, UR: 15 };
export const GRADE_COLOR: Record<Grade, string> = { R: "#7fb2ff", SR: "#c48cff", SSR: "#ffc23d", UR: "#ff6fae" };
export const MAX_LV = 5;
/** 강화 0→1 … 4→5 에 드는 같은 카드 수 (합 9) */
export const CHAR_UP_DUPES = [1, 1, 2, 2, 3];
export const power = (g: Grade, lv: number) => GRADE_FLOOR[g] + Math.max(0, Math.min(MAX_LV, lv));

/**
 * 밸런스 손잡이 — 효과 종류별 배수 (시뮬이 `--tune k=v` 로 바꿔 봄).
 * 효과식이 a + b·p 꼴이라 여기서 전체 세기를 한 번에 조절.
 */
export const TUNE = {
  /** 캐릭터 패시브 전체 */
  passive: 1,
  /** 장착 아이템 전체 */
  item: 1,
  /** 액티브 크기 */
  active: 1,
};

/* ───────────── 효과 (판 안에서 엔진이 읽는 숫자) ───────────── */

export type SkillKind =
  | "reroll" // 굴린 뒤 다시 굴리기 (카이)
  | "boost" // 고른 내 땅의 동네(내 땅) 통행료 n배 · 3바퀴 (이그나)
  | "shield" // 다음 통행료 mag 만큼 깎음 (릴리)
  | "sale" // 다음 인수 비용 mag 만큼 깎음 (이반)
  | "pull" // 상대 말을 1~3칸 끌어옴 (소영)
  | "dash" // 굴리지 않고 앞쪽 2~n칸 중 골라 이동 (제나)
  | "pick" // 원하는 눈(2~12)으로 굴리기 (태권 카이)
  | "fireworks" // 고른 땅의 동네 + 양옆 두 칸 안의 내 땅까지 통행료 n배 (불꽃놀이 이그나)
  | "hop" // 이번 이동에 남 땅에 서면 다음 안전한 칸까지 뜀 (개구리 릴리)
  | "freeze" // 상대 한 명 다음 차례 쉼 (겨울 이반)
  | "bunny" // 굴린 뒤 0~3칸 더 (바니 소영)
  | "concert" // 상대들이 가진 돈의 mag 를 팬 사인회 값으로 (아이돌 제나)
  | "debug" // 상대 땅 건물 한 단계 지움 (학생 건모)
  | "fate" // 원하는 더블(1~6 짝)로 굴리기 — 더블이라 한 번 더 (주사위 요정 DICE)
  | "buyout" // 굴리기 전 상대 땅 하나를 멀리서 인수 (인수 비용 × mag) (고양이 재벌 MOA)
  | "encore"; // 이번 차례 끝나고 한 번 더 (오르골 FORTE)

/** 언제 쓰는지: pre = 굴리기 전 · post = 굴린 뒤(이동 전) */
export const SKILL_TIME: Record<SkillKind, "pre" | "post"> = {
  reroll: "post",
  boost: "pre",
  shield: "pre",
  sale: "pre",
  pull: "pre",
  dash: "pre",
  pick: "pre",
  fireworks: "pre",
  hop: "pre",
  freeze: "pre",
  bunny: "post",
  concert: "pre",
  debug: "pre",
  fate: "pre",
  buyout: "pre",
  encore: "pre",
};

/** 대상 고르기: none · ownCity(내 땅) · foeCity(남의 건물 땅) · foeLand(살 수 있는 남의 땅) · foe(상대, pull 은 칸 수 n 도) · num(숫자) */
export const SKILL_TARGET: Record<SkillKind, "none" | "ownCity" | "foeCity" | "foeLand" | "foe" | "num"> = {
  reroll: "none",
  boost: "ownCity",
  shield: "none",
  sale: "none",
  pull: "foe",
  dash: "num",
  pick: "num",
  fireworks: "ownCity",
  hop: "none",
  freeze: "foe",
  bunny: "num",
  concert: "none",
  debug: "foeCity",
  fate: "num",
  buyout: "foeLand",
  encore: "none",
};

export interface Fx {
  /** 출발 월급 + (비율) */
  salary: number;
  /** 내 땅 통행료 받을 때 + */
  tollRecv: number;
  /** 남 땅 통행료 낼 때 − */
  tollPay: number;
  /** 건설비 − */
  build: number;
  /** 내가 인수할 때 − */
  acq: number;
  /** 남이 내 땅을 인수할 때 더 받음 + */
  defend: number;
  /** 남이 내 땅을 인수하려 할 때 막을 확률 */
  defendBlock: number;
  /** 남이 내 땅을 지나가기만 해도 통행료의 이만큼 */
  passFee: number;
  /** 남이 내 통행료를 낼 때 이 확률로 50% 더 (감전) */
  shock: number;
  /** 더블이 나오면 받는 코인 */
  doubleBonus: number;
  /** 수리소에 서도 바로 나감 */
  jailFree: number;
  /** 남 땅에 설 때 이 확률로 1칸 더 굴러감 */
  dodge: number;
  /** 더블이 아니면 이 확률로 두 번째 주사위를 첫째와 같게 (더블 확률 ↑) */
  twin: number;
  /** 럭키 박스에서 두 장 보고 좋은 쪽 */
  cardLuck: number;
  /** 인수하자마자 한 단계 무료 증축 */
  freeUpAfterAcq: number;
  /** 끌어당기기(소영)로 끌려온 상대가 내 땅에서 내는 통행료 비율 */
  pullPay: number;
  /** 판당 한 번, 큰 통행료(RULE.rewindMin 이상)를 이 비율만큼 되돌려 받음 */
  rewind: number;
  /** 판당 횟수: +1 조정 · 눈 고르기 · 다시 굴리기 */
  usesAdjust: number;
  usesPick: number;
  usesReroll: number;
}
export const ZERO_FX: Fx = {
  salary: 0,
  tollRecv: 0,
  tollPay: 0,
  build: 0,
  acq: 0,
  defend: 0,
  defendBlock: 0,
  passFee: 0,
  shock: 0,
  doubleBonus: 0,
  jailFree: 0,
  dodge: 0,
  twin: 0,
  cardLuck: 0,
  freeUpAfterAcq: 0,
  pullPay: 0,
  rewind: 0,
  usesAdjust: 0,
  usesPick: 0,
  usesReroll: 0,
};

export interface SkillFx {
  kind: SkillKind;
  /** 다시 쓸 때까지 내 차례 수 */
  cd: number;
  /** 크기 (배수 · 비율 · 최대 칸) */
  mag: number;
}

/* ───────────── 캐릭터 ───────────── */

/** 픽셀파이트 도트 시트 id (public/fight/<sprite>.json) — 말(토큰) 그림 */
export interface CharDef {
  id: string;
  name: string;
  /** 짧은 별칭 (스킨 이름 등) */
  title: string;
  grade: Grade;
  /** 원래 캐릭터 (픽셀파이트) */
  base: "kai" | "igna" | "lily" | "ivan" | "soyoung" | "zena" | "gunmo" | "orig";
  sprite: string;
  /** 카드 그림 (없으면 픽셀파이트 얼굴) */
  art?: string;
  color: string;
  /** 판 안 한 줄 소개 */
  line: string;
  passive: { name: string; fx: (p: number) => Partial<Fx>; desc: (p: number) => string };
  active: { name: string; kind: SkillKind; cd: (p: number) => number; mag: (p: number) => number; desc: (p: number) => string };
  /** 그림 승인 전이면 false (가챠 · 도감에 안 나옴) */
  on: boolean;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const lin = (ab: readonly number[], p: number) => ab[0] + ab[1] * p;
/** 쿨: 기본에서 파워 every 마다 1 줄어듦 (최소 2) */
const cdOf = (c: { cd: number; cdEvery?: number }) => (p: number) => Math.max(2, c.cd - Math.floor(p / (c.cdEvery ?? 7)));

/**
 * 캐릭터 수치표 — [a, b] 는 a + b·p (p = 파워). 밸런스는 여기만 고치면 됨.
 * 목표(효과 없는 인형 상대 1:1, 시뮬 --mode solo): 파워 0 ≈ 58% · 파워 15 ≈ 66%
 */
export const CK = {
  kai: { cd: 10, sal: [0.03, 0.01] },
  igna: { cd: 5, recv: [0.22, 0.02], boost: [1.0, 0.04] },
  lily: { cd: 7, pay: [0.05, 0.012], shield: [0.5, 0.025] },
  ivan: { cd: 6, build: [0.2, 0.02], sale: [0.5, 0.02] },
  soyoung: { cd: 9, fee: [0.006, 0.001], pull: 2, pay: [0.3, 0.02] },
  zena: { cd: 5, shock: [0.15, 0.02], dash: 8 },
  "kai-tkd": { cd: 8, sal: [0.06, 0.015], dbl: [20, 5] },
  "igna-fw": { cd: 4, recv: [0.22, 0.02], boost: [1.2, 0.05], spark: [0.15, 0.015] },
  "lily-frog": { cd: 5, pay: [0.05, 0.012] },
  "ivan-winter": { cd: 9, build: [0.15, 0.015], def: [0.1, 0.02] },
  "soyoung-bunny": { cd: 7, fee: [0.012, 0.0015] },
  "zena-idol": { cd: 7, shock: [0.12, 0.015], fan: [0.06, 0.004] },
  "gunmo-school": { cd: 6, acq: [0.2, 0.015] },
  "ur-dice": { cd: 9, twin: [0.11, 0.005], dbl: [40, 3] },
  "ur-moa": { cd: 10, acq: [0.08, 0.006], build: [0.05, 0.004], buy: [1.6, -0.015] },
  "ur-forte": { cd: 5, sal: [0.4, 0.02], recv: [0.18, 0.01] },
};
const k = <T extends keyof typeof CK>(id: T) => CK[id];
const P = (v: number) => v * TUNE.passive;
const A = (v: number) => v * TUNE.active;

export const CHARS: CharDef[] = [
  /* ── R: 픽셀파이트 기본 넷 ── */
  {
    id: "kai",
    name: "카이",
    title: "바람의 주먹",
    grade: "R",
    base: "kai",
    sprite: "kai",
    color: "#4a7dff",
    line: "출발할 때마다 바람처럼 돈이 붙는 여행 체질",
    passive: { name: "순풍", fx: (p) => ({ salary: P(lin(k("kai").sal, p)) }), desc: (p) => `출발 월급 +${pct(P(lin(k("kai").sal, p)))}` },
    active: { name: "질풍 다시 굴리기", kind: "reroll", cd: cdOf(k("kai")), mag: () => 1, desc: () => "굴린 뒤 한 번 다시 굴려요" },
    on: true,
  },
  {
    id: "igna",
    name: "이그나",
    title: "불꽃 술사",
    grade: "R",
    base: "igna",
    sprite: "igna",
    color: "#ff6a3d",
    line: "내 땅에 불을 지펴 통행료를 끓어오르게",
    passive: { name: "뜨끈한 장사", fx: (p) => ({ tollRecv: P(lin(k("igna").recv, p)) }), desc: (p) => `내 땅 통행료 +${pct(P(lin(k("igna").recv, p)))}` },
    active: {
      name: "열기 축제",
      kind: "boost",
      cd: cdOf(k("igna")),
      mag: (p) => 1 + A(lin(k("igna").boost, p)),
      desc: (p) => `고른 내 땅이 있는 동네의 내 땅 전부 통행료 ×${(1 + A(lin(k("igna").boost, p))).toFixed(2)} (3바퀴)`,
    },
    on: true,
  },
  {
    id: "lily",
    name: "릴리",
    title: "우산 꼬마",
    grade: "R",
    base: "lily",
    sprite: "lily",
    color: "#46c9ff",
    line: "우산으로 통행료 비를 막는 꼬마",
    passive: { name: "작은 우산", fx: (p) => ({ tollPay: P(lin(k("lily").pay, p)) }), desc: (p) => `남 땅 통행료 −${pct(P(lin(k("lily").pay, p)))}` },
    active: {
      name: "물방울 방패",
      kind: "shield",
      cd: cdOf(k("lily")),
      mag: (p) => Math.min(1, A(lin(k("lily").shield, p))),
      desc: (p) => `다음 통행료 −${pct(Math.min(1, A(lin(k("lily").shield, p))))}`,
    },
    on: true,
  },
  {
    id: "ivan",
    name: "이반",
    title: "교관",
    grade: "R",
    base: "ivan",
    sprite: "ivan",
    color: "#8a9bb0",
    line: "튼튼하게 짓고 거침없이 사들이는 교관",
    passive: { name: "튼튼한 기초", fx: (p) => ({ build: P(lin(k("ivan").build, p)) }), desc: (p) => `건설비 −${pct(P(lin(k("ivan").build, p)))}` },
    active: {
      name: "정권 인수",
      kind: "sale",
      cd: cdOf(k("ivan")),
      mag: (p) => Math.min(0.9, A(lin(k("ivan").sale, p))),
      desc: (p) => `다음 인수 비용 −${pct(Math.min(0.9, A(lin(k("ivan").sale, p))))}`,
    },
    on: true,
  },

  /* ── SR ── */
  {
    id: "soyoung",
    name: "소영",
    title: "엄한 선생님",
    grade: "SR",
    base: "soyoung",
    sprite: "soyoung",
    color: "#c05bff",
    line: "내 땅 앞을 지나가기만 해도 출석 체크",
    passive: {
      name: "출석 체크",
      fx: (p) => ({ passFee: P(lin(k("soyoung").fee, p)), pullPay: Math.min(1, A(lin(k("soyoung").pay, p))) }),
      desc: (p) => `남이 내 땅을 지나가면 그 통행료의 ${pct(P(lin(k("soyoung").fee, p)))}`,
    },
    active: {
      name: "채찍 끌어당기기",
      kind: "pull",
      cd: cdOf(k("soyoung")),
      mag: () => k("soyoung").pull,
      desc: (p) => `상대 말을 1~${k("soyoung").pull}칸 앞으로 끌어와요 (선 칸이 내 땅이면 통행료의 ${pct(Math.min(1, A(lin(k("soyoung").pay, p))))}를 바로 내요)`,
    },
    on: true,
  },
  {
    id: "zena",
    name: "제나",
    title: "번개 창술사",
    grade: "SR",
    base: "zena",
    sprite: "zena",
    color: "#ffd23f",
    line: "통행료에 번개를 실어 찌릿",
    passive: { name: "정전기", fx: (p) => ({ shock: P(lin(k("zena").shock, p)) }), desc: (p) => `내 통행료를 낼 때 ${pct(P(lin(k("zena").shock, p)))} 확률로 50% 더` },
    active: {
      name: "번개 질주",
      kind: "dash",
      cd: cdOf(k("zena")),
      mag: () => k("zena").dash,
      desc: () => `굴리지 않고 앞쪽 2~${k("zena").dash}칸 중 골라 이동`,
    },
    on: true,
  },

  /* ── SSR: 픽셀파이트 스킨 버전 ── */
  {
    id: "kai-tkd",
    name: "카이",
    title: "태권 카이",
    grade: "SSR",
    base: "kai",
    sprite: "kai-tkd",
    color: "#3d6bff",
    line: "기합 한 번에 원하는 눈이 나온다",
    passive: {
      name: "도복 순풍",
      fx: (p) => ({ salary: P(lin(k("kai-tkd").sal, p)), doubleBonus: P(lin(k("kai-tkd").dbl, p)) }),
      desc: (p) => `출발 월급 +${pct(P(lin(k("kai-tkd").sal, p)))} · 더블이면 +${Math.round(P(lin(k("kai-tkd").dbl, p)))}`,
    },
    active: { name: "기합 굴리기", kind: "pick", cd: cdOf(k("kai-tkd")), mag: () => 12, desc: () => "원하는 눈(2~12)으로 굴려요 (더블 아님)" },
    on: true,
  },
  {
    id: "igna-fw",
    name: "이그나",
    title: "불꽃놀이 이그나",
    grade: "SSR",
    base: "igna",
    sprite: "igna-fw",
    color: "#ff4fa0",
    line: "불꽃놀이는 이웃 땅까지 번진다",
    passive: {
      name: "축제 장사",
      fx: (p) => ({ tollRecv: P(lin(k("igna-fw").recv, p)), shock: P(lin(k("igna-fw").spark, p)) }),
      desc: (p) => `내 땅 통행료 +${pct(P(lin(k("igna-fw").recv, p)))} · 낼 때 ${pct(P(lin(k("igna-fw").spark, p)))} 확률로 불꽃이 튀어 50% 더`,
    },
    active: {
      name: "연쇄 불꽃놀이",
      kind: "fireworks",
      cd: cdOf(k("igna-fw")),
      mag: (p) => 1 + A(lin(k("igna-fw").boost, p)),
      desc: (p) => `고른 내 땅의 동네 + 양옆 두 칸 안의 내 땅까지 통행료 ×${(1 + A(lin(k("igna-fw").boost, p))).toFixed(2)} (3바퀴)`,
    },
    on: true,
  },
  {
    id: "lily-frog",
    name: "릴리",
    title: "개구리 릴리",
    grade: "SSR",
    base: "lily",
    sprite: "lily-frog",
    color: "#5fd35a",
    line: "개굴! 남의 땅은 폴짝 건너뛰기",
    passive: {
      name: "개구리 우비",
      fx: (p) => ({ tollPay: P(lin(k("lily-frog").pay, p)), jailFree: 1 }),
      desc: (p) => `남 땅 통행료 −${pct(P(lin(k("lily-frog").pay, p)))} · 수리소에 서도 바로 나감`,
    },
    active: { name: "폴짝", kind: "hop", cd: cdOf(k("lily-frog")), mag: () => 3, desc: () => "이번 이동에 남 땅에 서면 다음 안전한 칸까지 뛰어요 (최대 3칸)" },
    on: true,
  },
  {
    id: "ivan-winter",
    name: "이반",
    title: "겨울 이반",
    grade: "SSR",
    base: "ivan",
    sprite: "ivan-winter",
    color: "#8fd8ff",
    line: "얼어붙은 땅은 누구도 못 뺏는다",
    passive: {
      name: "동토의 성벽",
      fx: (p) => ({ build: P(lin(k("ivan-winter").build, p)), defend: P(lin(k("ivan-winter").def, p)) }),
      desc: (p) => `건설비 −${pct(P(lin(k("ivan-winter").build, p)))} · 내 땅 인수당하면 ${pct(P(lin(k("ivan-winter").def, p)))} 더 받음`,
    },
    active: { name: "얼음 감옥", kind: "freeze", cd: cdOf(k("ivan-winter")), mag: () => 1, desc: () => "상대 한 명이 다음 차례를 쉬어요" },
    on: true,
  },
  {
    id: "soyoung-bunny",
    name: "소영",
    title: "바니 소영",
    grade: "SSR",
    base: "soyoung",
    sprite: "soyoung-bunny",
    color: "#ff7ad9",
    line: "깡총깡총, 한 발 더 가면 내 땅",
    passive: {
      name: "출석부 바니",
      fx: (p) => ({ passFee: P(lin(k("soyoung-bunny").fee, p)) }),
      desc: (p) => `남이 내 땅을 지나가면 그 통행료의 ${pct(P(lin(k("soyoung-bunny").fee, p)))}`,
    },
    active: { name: "깡총 점프", kind: "bunny", cd: cdOf(k("soyoung-bunny")), mag: () => 3, desc: () => "굴린 뒤 0~3칸 더 가요" },
    on: true,
  },
  {
    id: "zena-idol",
    name: "제나",
    title: "아이돌 제나",
    grade: "SSR",
    base: "zena",
    sprite: "zena-idol",
    color: "#ffe066",
    line: "무대 위 정전기는 팬서비스",
    passive: {
      name: "무대 정전기",
      fx: (p) => ({ shock: P(lin(k("zena-idol").shock, p)) }),
      desc: (p) => `내 통행료를 낼 때 ${pct(P(lin(k("zena-idol").shock, p)))} 확률로 50% 더`,
    },
    active: {
      name: "팬 사인회",
      kind: "concert",
      cd: cdOf(k("zena-idol")),
      mag: (p) => A(lin(k("zena-idol").fan, p)),
      desc: (p) => `상대마다 가진 돈의 ${pct(A(lin(k("zena-idol").fan, p)))}를 사인회 값으로 받아요`,
    },
    on: true,
  },
  {
    id: "gunmo-school",
    name: "건모",
    title: "학생 건모",
    grade: "SSR",
    base: "gunmo",
    sprite: "gunmo-school",
    color: "#7c8cff",
    line: "남의 건물도 버그면 지운다",
    passive: {
      name: "코드 리뷰",
      fx: (p) => ({ acq: P(lin(k("gunmo-school").acq, p)) }),
      desc: (p) => `인수 비용 −${pct(P(lin(k("gunmo-school").acq, p)))}`,
    },
    active: { name: "디버그", kind: "debug", cd: cdOf(k("gunmo-school")), mag: () => 1, desc: () => "상대 땅 하나의 건물을 한 단계 지워요 (랜드마크 제외)" },
    on: true,
  },

  /* ── UR: 마블 오리지널 ── */
  {
    id: "ur-dice",
    name: "DICE",
    title: "주사위 요정",
    grade: "UR",
    base: "orig",
    sprite: "ur-dice",
    art: "/marble/art/ur-dice.webp",
    color: "#7fe0c8",
    line: "주사위가 굴러가는 곳엔 언제나 내가 있어!",
    passive: {
      name: "요정의 눈짓",
      fx: (p) => ({ twin: P(lin(k("ur-dice").twin, p)), doubleBonus: P(lin(k("ur-dice").dbl, p)) }),
      desc: (p) => `더블 확률 ↑ (${pct(P(lin(k("ur-dice").twin, p)))}) · 더블이면 +${Math.round(P(lin(k("ur-dice").dbl, p)))}`,
    },
    active: { name: "운명의 주사위", kind: "fate", cd: cdOf(k("ur-dice")), mag: () => 6, desc: () => "원하는 더블(1·1 ~ 6·6)로 굴려요 — 더블이라 한 번 더" },
    on: true,
  },
  {
    id: "ur-moa",
    name: "MOA",
    title: "고양이 재벌",
    grade: "UR",
    base: "orig",
    sprite: "ur-moa",
    art: "/marble/art/ur-moa.webp",
    color: "#e8c25a",
    line: "이 동네, 통째로 사도 될까냥?",
    passive: {
      name: "큰손",
      fx: (p) => ({ acq: P(lin(k("ur-moa").acq, p)), build: P(lin(k("ur-moa").build, p)) }),
      desc: (p) => `인수 비용 −${pct(P(lin(k("ur-moa").acq, p)))} · 건설 비용 −${pct(P(lin(k("ur-moa").build, p)))}`,
    },
    active: {
      name: "원격 매입",
      kind: "buyout",
      cd: cdOf(k("ur-moa")),
      mag: (p) => Math.max(1, lin(k("ur-moa").buy, p)),
      desc: (p) => `굴리기 전, 상대 땅 하나를 인수 비용의 ${pct(Math.max(1, lin(k("ur-moa").buy, p)))}로 바로 사요 (랜드마크 제외)`,
    },
    on: true,
  },
  {
    id: "ur-forte",
    name: "FORTE",
    title: "오르골 소년",
    grade: "UR",
    base: "orig",
    sprite: "ur-forte",
    art: "/marble/art/ur-forte.webp",
    color: "#ff9ec7",
    line: "태엽을 한 번 더 감으면, 춤도 한 번 더",
    passive: {
      name: "태엽 장단",
      fx: (p) => ({ salary: P(lin(k("ur-forte").sal, p)), tollRecv: P(lin(k("ur-forte").recv, p)) }),
      desc: (p) => `출발 월급 +${pct(P(lin(k("ur-forte").sal, p)))} · 내 땅 통행료 +${pct(P(lin(k("ur-forte").recv, p)))}`,
    },
    active: { name: "앙코르", kind: "encore", cd: cdOf(k("ur-forte")), mag: () => 1, desc: () => "이번 차례가 끝나면 한 번 더 해요" },
    on: true,
  },
];

/** 카드 그림 · 얼굴 그림 경로 */
export const artOf = (c: Pick<CharDef, "art" | "sprite">) => c.art ?? `/fight/art/${c.sprite}.webp`;
export const faceOf = (c: Pick<CharDef, "art" | "sprite">) => (c.art ? c.art.replace(/\.webp$/, "-face.webp") : `/fight/art/${c.sprite}-face.webp`);

/** 시뮬 · 연습용 효과 없는 인형 (가챠 · 도감에 안 나옴) */
export const DUMMY: CharDef = {
  id: "dummy",
  name: "연습 인형",
  title: "연습 인형",
  grade: "R",
  base: "orig",
  sprite: "kai",
  color: "#999999",
  line: "",
  passive: { name: "-", fx: () => ({}), desc: () => "-" },
  active: { name: "-", kind: "shield", cd: () => 999, mag: () => 0, desc: () => "-" },
  on: false,
};

export const CHAR: Record<string, CharDef> = Object.fromEntries([...CHARS, DUMMY].map((c) => [c.id, c]));
export const charOn = () => CHARS.filter((c) => c.on);

/* ───────────── 장착 아이템 (주사위 · 동행) ───────────── */

export type ItemSlot = "dice" | "buddy";
export interface ItemDef {
  id: string;
  slot: ItemSlot;
  name: string;
  grade: Exclude<Grade, "UR">;
  /** 아이콘 그림 (public/marble/items/<id>.webp, 없으면 도트 자리표시) */
  fx: (p: number) => Partial<Fx>;
  desc: (p: number) => string;
}
const I = (v: number) => v * TUNE.item;
/** 판당 횟수: base + (파워가 at 이상이면 1) */
const usesAt = (base: number, at: number) => (p: number) => base + (p >= at ? 1 : 0);

/** 아이템 수치표 — 목표(인형 상대, 아이템 하나만): 파워 0 ≈ 52% · 파워 15 ≈ 58% */
export const IK = {
  d_heavy: { dodge: [0.15, 0.015] },
  d_spark: { dbl: [60, 15] },
  d_twin: { twin: [0.15, 0.01], dbl: [40, 8] },
  d_slide: { at: 99, dodge: [0, 0.006] },
  d_gold: { at: 99, dbl: [40, 8] },
  d_time: { rewind: [0.5, 0.02], min: 400 },
  b_hamster: { pay: [0.1, 0.012] },
  b_pigeon: { build: [0.15, 0.015] },
  b_robot: { sal: [0.15, 0.02] },
  b_dog: { recv: [0.1, 0.01], def: [0.15, 0.02] },
  b_cat: { sal: [0.12, 0.015], recv: [0.06, 0.008] },
  b_fox: { acq: [0.2, 0.02], build: [0.08, 0.01] },
};
const ik = <T extends keyof typeof IK>(id: T) => IK[id];

export const ITEMS: ItemDef[] = [
  /* 주사위 */
  {
    id: "d_heavy",
    slot: "dice",
    name: "묵직한 주사위",
    grade: "R",
    fx: (p) => ({ dodge: I(lin(ik("d_heavy").dodge, p)) }),
    desc: (p) => `남 땅에 서게 되면 ${pct(I(lin(ik("d_heavy").dodge, p)))} 확률로 한 칸 더 굴러가요`,
  },
  {
    id: "d_spark",
    slot: "dice",
    name: "반짝 주사위",
    grade: "R",
    fx: (p) => ({ doubleBonus: I(lin(ik("d_spark").dbl, p)) }),
    desc: (p) => `더블이 나오면 +${Math.round(I(lin(ik("d_spark").dbl, p)))}`,
  },
  {
    id: "d_twin",
    slot: "dice",
    name: "쌍둥이 주사위",
    grade: "SR",
    fx: (p) => ({ twin: I(lin(ik("d_twin").twin, p)), doubleBonus: I(lin(ik("d_twin").dbl, p)) }),
    desc: (p) => `더블 확률 ↑ (안 나오면 ${pct(I(lin(ik("d_twin").twin, p)))} 확률로 맞춰짐) · 더블이면 +${Math.round(I(lin(ik("d_twin").dbl, p)))}`,
  },
  {
    id: "d_slide",
    slot: "dice",
    name: "미끄럼 주사위",
    grade: "SR",
    fx: (p) => ({ usesAdjust: usesAt(1, ik("d_slide").at)(p), dodge: I(lin(ik("d_slide").dodge, p)) }),
    desc: (p) =>
      `굴린 뒤 한 칸 더 미끄러지기 (판당 ${usesAt(1, ik("d_slide").at)(p)}번)${lin(ik("d_slide").dodge, p) > 0 ? ` · 남 땅이면 ${pct(I(lin(ik("d_slide").dodge, p)))} 확률로 한 칸 더` : ""}`,
  },
  {
    id: "d_gold",
    slot: "dice",
    name: "황금 주사위",
    grade: "SSR",
    fx: (p) => ({ usesPick: usesAt(1, ik("d_gold").at)(p), doubleBonus: I(lin(ik("d_gold").dbl, p)) }),
    desc: (p) => `원하는 눈(2~12)으로 굴리기 (판당 ${usesAt(1, ik("d_gold").at)(p)}번) · 더블이면 +${Math.round(I(lin(ik("d_gold").dbl, p)))}`,
  },
  {
    id: "d_time",
    slot: "dice",
    name: "시간 주사위",
    grade: "SSR",
    fx: (p) => ({ rewind: I(lin(ik("d_time").rewind, p)) }),
    desc: (p) => `판당 한 번, ${ik("d_time").min} 넘는 통행료를 낼 때 시간을 되감아 ${pct(Math.min(1, I(lin(ik("d_time").rewind, p))))} 돌려받아요`,
  },
  /* 동행 */
  {
    id: "b_hamster",
    slot: "buddy",
    name: "저금통 햄스터",
    grade: "R",
    fx: (p) => ({ tollPay: I(lin(ik("b_hamster").pay, p)) }),
    desc: (p) => `통행료를 낼 때 ${pct(I(lin(ik("b_hamster").pay, p)))} 돌려받아요`,
  },
  {
    id: "b_pigeon",
    slot: "buddy",
    name: "건축 비둘기",
    grade: "R",
    fx: (p) => ({ build: I(lin(ik("b_pigeon").build, p)) }),
    desc: (p) => `건설비 −${pct(I(lin(ik("b_pigeon").build, p)))}`,
  },
  {
    id: "b_robot",
    slot: "buddy",
    name: "수리공 로봇",
    grade: "SR",
    fx: (p) => ({ jailFree: 1, salary: I(lin(ik("b_robot").sal, p)) }),
    desc: (p) => `수리소에 서도 바로 나감 · 출발 월급 +${pct(I(lin(ik("b_robot").sal, p)))}`,
  },
  {
    id: "b_dog",
    slot: "buddy",
    name: "경비견",
    grade: "SR",
    fx: (p) => ({ tollRecv: I(lin(ik("b_dog").recv, p)), defend: I(lin(ik("b_dog").def, p)), defendBlock: I(0.1) }),
    desc: (p) =>
      `내 땅 통행료 +${pct(I(lin(ik("b_dog").recv, p)))} · 인수당하면 ${pct(I(lin(ik("b_dog").def, p)))} 더 받음 · ${pct(I(0.1))} 확률로 인수를 막음`,
  },
  {
    id: "b_cat",
    slot: "buddy",
    name: "행운 고양이",
    grade: "SSR",
    fx: (p) => ({ cardLuck: 1, salary: I(lin(ik("b_cat").sal, p)), tollRecv: I(lin(ik("b_cat").recv, p)) }),
    desc: (p) => `럭키 박스는 두 장 보고 좋은 쪽 · 출발 월급 +${pct(I(lin(ik("b_cat").sal, p)))} · 내 땅 통행료 +${pct(I(lin(ik("b_cat").recv, p)))}`,
  },
  {
    id: "b_fox",
    slot: "buddy",
    name: "부동산 여우",
    grade: "SSR",
    fx: (p) => ({ acq: I(lin(ik("b_fox").acq, p)), build: I(lin(ik("b_fox").build, p)), freeUpAfterAcq: 1 }),
    desc: (p) => `인수 비용 −${pct(I(lin(ik("b_fox").acq, p)))} · 건설비 −${pct(I(lin(ik("b_fox").build, p)))} · 인수하자마자 한 단계 무료 증축`,
  },
];
export const ITEM: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

/* ───────────── 로드아웃 (판에 들고 가는 것) ───────────── */

export interface Gear {
  id: string;
  lv: number;
}
export interface Loadout {
  char: Gear;
  dice?: Gear | null;
  buddy?: Gear | null;
}

export function fxOf(lo: Loadout): { fx: Fx; skill: SkillFx } {
  const fx: Fx = { ...ZERO_FX };
  const add = (f: Partial<Fx>) => {
    for (const [k, v] of Object.entries(f) as [keyof Fx, number][]) fx[k] = k === "jailFree" || k === "cardLuck" || k === "freeUpAfterAcq" ? Math.max(fx[k], v) : fx[k] + v;
  };
  const c = CHAR[lo.char.id] ?? CHAR.kai;
  const pc = power(c.grade, lo.char.lv);
  add(c.passive.fx(pc));
  for (const g of [lo.dice, lo.buddy]) {
    if (!g) continue;
    const it = ITEM[g.id];
    if (it) add(it.fx(power(it.grade, g.lv)));
  }
  // 깎는 값은 90% 를 넘지 않게
  for (const k of ["tollPay", "build", "acq"] as const) fx[k] = Math.min(0.9, fx[k]);
  return { fx, skill: { kind: c.active.kind, cd: c.active.cd(pc), mag: c.active.mag(pc) } };
}

/* ───────────── 판 밖 재화 · 가챠 ───────────── */

/** 별사탕(✦): 판 보상 · 미션 → 가챠 */
export const STAR = { name: "별사탕" };
/** 부품: 아이템 가챠의 재료 · 중복 아이템 → 아이템 강화 */
export const PARTS = { name: "부품" };

export const GACHA = {
  char: {
    one: 150,
    ten: 1350,
    /** 등급 확률 */
    rate: { R: 0.7, SR: 0.24, SSR: 0.054, UR: 0.006 } as Record<Grade, number>,
    /** 이 횟수 안에 SSR 이상이 안 나오면 확정 */
    pity: 80,
  },
  item: {
    one: 100,
    ten: 900,
    /** 아이템이 나올 확률 (나머지는 부품 꾸러미) */
    itemRate: 0.4,
    rate: { R: 0.72, SR: 0.24, SSR: 0.04 } as Record<Exclude<Grade, "UR">, number>,
    pity: 60,
    /** 부품 꾸러미 (확률 · 양) */
    parts: [
      [0.6, 10],
      [0.3, 25],
      [0.1, 60],
    ] as [number, number][],
  },
};

/** 캐릭터 강화가 끝난 뒤 중복 → 별사탕 */
export const CHAR_OVERFLOW_STARS: Record<Grade, number> = { R: 15, SR: 45, SSR: 150, UR: 400 };
/** 중복 아이템 → 부품 */
export const ITEM_DUP_PARTS: Record<Exclude<Grade, "UR">, number> = { R: 15, SR: 45, SSR: 180 };
/** 아이템 강화 0→1 … 4→5 부품 (등급 배수) */
export const ITEM_UP_PARTS = [10, 20, 35, 55, 80];
export const ITEM_GRADE_MULT: Record<Exclude<Grade, "UR">, number> = { R: 1, SR: 2.5, SSR: 6 };
export const itemUpCost = (g: Exclude<Grade, "UR">, lv: number) => (lv >= MAX_LV ? 0 : Math.round(ITEM_UP_PARTS[lv] * ITEM_GRADE_MULT[g]));

/** 판 보상 (별사탕) — 1:1 기준, 4인이면 등수 */
export const MATCH_STARS = { win: 60, lose: 25, firstWinOfDay: 100, aiOnlyMult: 0.6 };

/* ───────────── 처음 받는 것 · GP 상점 ───────────── */

/** 처음 들어오면: 캐릭터 · 아이템 10연차 티켓 한 장씩 + 별사탕 */
export const STARTER = { stars: 300, charTickets: 1, itemTickets: 1 };

export interface StoreItem {
  id: string;
  name: string;
  gp: number;
  give: { stars?: number; parts?: number; charTickets?: number; itemTickets?: number };
  /** 한 주(한국 시간 월요일 시작) 살 수 있는 수 · 한 번만(once) */
  perWeek?: number;
  once?: boolean;
  desc: string;
}
/** GP 로 사는 것 — 재화는 1,000GP ≈ 별사탕 300 (10연차 ≈ 4,500GP), 패키지는 그보다 3~4배 이득 */
export const STORE: StoreItem[] = [
  { id: "s_star", name: "별사탕 300", gp: 1000, give: { stars: 300 }, perWeek: 5, desc: "캐릭터 2번 · 아이템 3번" },
  { id: "s_parts", name: "부품 60", gp: 600, give: { parts: 60 }, perWeek: 5, desc: "아이템 강화 재료" },
  { id: "p_start", name: "새내기 여행 가방", gp: 1000, give: { stars: 1350, parts: 100 }, once: true, desc: "캐릭터 10연차 한 번 + 부품 100" },
  { id: "p_week", name: "주간 여행 꾸러미", gp: 2000, give: { charTickets: 1, itemTickets: 1, parts: 120 }, perWeek: 1, desc: "캐릭터 · 아이템 10연차 티켓 한 장씩 + 부품 120" },
];
export const storeItem = (id: unknown) => STORE.find((s) => s.id === id);
