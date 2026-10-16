/*
 * DICE TOWN — 캐릭터 · 장착 아이템 · 등급 · 강화 정의 (서버 · 화면 · 밸런스 시뮬이 같이 씀).
 *
 * 강도는 "파워" p 하나로 셈: p = 등급 바닥(R 0 · SR 5 · SSR 10 · UR 15) + 강화 단계(0~5).
 *   → 아랫 등급 5강(풀강) = 윗 등급 0강. 효과 수치는 전부 p 의 일차식이라 그대로 이어짐.
 * 수치를 바꾸면 BALANCE_VER 를 올리고 `server/scripts/marble-sim.ts` 로 1:1 승률(목표 풀세팅 vs R 0강 ≈ 70%)을 확인.
 * 이 폴더는 브라우저 · 서버 둘 다에서 돌아서 브라우저 전용 API · "@/…" 경로를 쓰지 않음.
 */

export const BALANCE_VER = "v2";

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
  | "reroll" // 이번 차례 다시 굴리기 +1 (카이)
  | "double" // 이번 차례 족보 보상 2배 (이그나)
  | "shield" // 다음 손해 한 번 막기 (릴리)
  | "nudge" // 주사위 하나 ±1 (이반)
  | "pull" // 상대 말 1~3칸 앞뒤로 끌기 (소영)
  | "tri" // 이번 이동은 주사위 3개 합 (제나)
  | "seal" // 상대 다음 굴림 주사위 하나 봉인 (오도해병 이반)
  | "six" // 주사위 하나를 6으로 (학생 이그나)
  | "hop" // 이번 이동에 빨강 · 함정 칸은 폴짝 (빨간망토 릴리)
  | "bunny" // 이동 뒤 0~3칸 더 (토토)
  | "magic" // 주사위 두 개 원하는 눈으로 (미라쥬)
  | "circus" // 상대마다 코인 걷기 (롤로)
  | "sleep" // 상대 다음 차례 다시 굴리기 0번 (몽글)
  | "copy" // 주사위 하나의 눈을 다른 두 개에 복사 (DICE)
  | "vip" // 이번 차례 별 값 − · 별 사기 범위 + (MOA)
  | "encore"; // 이번 차례 끝나고 한 번 더 (FORTE)

/** 언제 쓰는지: any = 굴리기 전 · 굴린 뒤(이동 고르기 전) 아무 때나 · dice = 굴린 뒤에만 (주사위를 만짐) */
export const SKILL_TIME: Record<SkillKind, "any" | "dice"> = {
  reroll: "any",
  double: "any",
  shield: "any",
  nudge: "dice",
  pull: "any",
  tri: "any",
  seal: "any",
  six: "dice",
  hop: "any",
  bunny: "any",
  magic: "dice",
  circus: "any",
  sleep: "any",
  copy: "dice",
  vip: "any",
  encore: "any",
};

/**
 * 대상: none · foe(상대) · die(주사위 하나) · nudge(주사위 하나 + ±) · magic(주사위 둘 + 눈 둘)
 * · copy(원본 주사위 + 바꿀 주사위들) · pull(상대 + 칸 수 −3~3)
 */
export const SKILL_TARGET: Record<SkillKind, "none" | "foe" | "die" | "nudge" | "magic" | "copy" | "pull"> = {
  reroll: "none",
  double: "none",
  shield: "none",
  nudge: "nudge",
  pull: "pull",
  tri: "none",
  seal: "foe",
  six: "die",
  hop: "none",
  bunny: "none",
  magic: "magic",
  circus: "none",
  sleep: "none",
  copy: "copy",
  vip: "none",
  encore: "none",
};

export interface Fx {
  /** 시작 코인 + */
  startCoins: number;
  /** 출발 지날 때 코인 + */
  startBonus: number;
  /** 파랑 칸 + */
  blueBonus: number;
  /** 빨강 칸 손해 − */
  redCut: number;
  /** 코인 족보(페어 · 투 페어) 보상 + */
  comboCoin: number;
  /** 트리플 이상 족보면 코인 + */
  bigCombo: number;
  /** 스트레이트 보상 코인 + */
  straightBonus: number;
  /** 야추 보상 코인 + */
  yachtBonus: number;
  /** 뺏길 때 덜 뺏김 − */
  stealGuard: number;
  /** 뺏기 · 대결 손해를 이 확률로 막음 */
  guard: number;
  /** 럭키 박스에서 코인 + */
  itemBonus: number;
  /** 지나간 파랑 칸마다 +1 (차례당 최대) */
  passBlue: number;
  /** 첫 굴림: 이 확률로 주사위 하나가 다른 주사위와 짝이 맞음 */
  twin: number;
  /** 다시 굴린 주사위가 1이면 이 확률로 한 번 더 굴림 */
  noOne: number;
  /** VS 대결 이기면 코인 + */
  vsBonus: number;
  /** 함정 면역 (1) */
  trapFree: number;
  /** 마을 소식은 두 장 보고 좋은 쪽 (1) */
  eventLuck: number;
  /** 잭팟 + (비율) */
  jackpotMult: number;
  /** 축제 보상 + (비율) */
  festMult: number;
  /** 별 값 − */
  starCut: number;
  /** 판당 횟수: 다시 굴리기 + · 황금 눈 고르기 · 미끄럼 ±1 */
  usesReroll: number;
  usesGold: number;
  usesSlide: number;
}
export const ZERO_FX: Fx = {
  startCoins: 0,
  startBonus: 0,
  blueBonus: 0,
  redCut: 0,
  comboCoin: 0,
  bigCombo: 0,
  straightBonus: 0,
  yachtBonus: 0,
  stealGuard: 0,
  guard: 0,
  itemBonus: 0,
  passBlue: 0,
  twin: 0,
  noOne: 0,
  vsBonus: 0,
  trapFree: 0,
  eventLuck: 0,
  jackpotMult: 0,
  festMult: 0,
  starCut: 0,
  usesReroll: 0,
  usesGold: 0,
  usesSlide: 0,
};
/** 더하지 않고 큰 쪽 (있다 · 없다) */
const MAX_KEYS: (keyof Fx)[] = ["trapFree", "eventLuck"];

export interface SkillFx {
  kind: SkillKind;
  /** 다시 쓸 때까지 내 차례 수 */
  cd: number;
  /** 크기 (코인 · 칸 · 개수) */
  mag: number;
  /** 덤 (소영 벌금 등) */
  extra?: number;
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
  /** 판 안 한 줄 소개 (대사) */
  line: string;
  /** 가방 프로필 소개 */
  bio?: string;
  passive: { name: string; fx: (p: number) => Partial<Fx>; desc: (p: number) => string };
  active: { name: string; kind: SkillKind; cd: (p: number) => number; mag: (p: number) => number; extra?: (p: number) => number; desc: (p: number) => string };
  /** 그림 승인 전이면 false (가챠 · 도감에 안 나옴) */
  on: boolean;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const lin = (ab: readonly number[], p: number) => ab[0] + ab[1] * p;
/** a + (파워 every 마다 1) */
const st = (ab: readonly number[], p: number) => ab[0] + (ab[1] > 0 ? Math.floor(p / ab[1]) : 0);
/** 쿨: 기본에서 파워 every 마다 1 줄어듦 (최소 2) */
const cdOf = (c: { cd: number; cdEvery?: number }) => (p: number) => Math.max(2, c.cd - Math.floor(p / (c.cdEvery ?? 8)));

/**
 * 캐릭터 수치표 — 계단 [a, every] 는 a + ⌊p/every⌋ · 비율 [a, b] 는 a + b·p (p = 파워 0~20).
 * 밸런스는 여기만 고치면 됨 (시뮬 --ck kai.cd=4).
 */
export const CK = {
  kai: { cd: 2, start: [3, 7] },
  igna: { cd: 6, blue: [1, 10] },
  lily: { cd: 3, red: [2, 10], shield: 2, bonus: 3 },
  ivan: { cd: 3, coins: [3, 4], nudge: [1, 12] },
  soyoung: { cd: 3, combo: [1, 10], pull: 3, fee: [2, 7] },
  zena: { cd: 2, str: [2, 5], start: 3 },
  "ivan-marine": { cd: 2, guard: [2, 5] },
  "igna-student": { cd: 6, big: [1, 6] },
  "lily-hood": { cd: 4, item: [2, 5] },
  toto: { cd: 6, pass: [2, 10] },
  mirage: { cd: 6, twin: [0.15, 0.01] },
  lolo: { cd: 5, vs: [3, 5], fee: [2, 6] },
  mongle: { cd: 3, red: [3, 10], start: 3 },
  "ur-dice": { cd: 10, yacht: [5, 4] },
  "ur-moa": { cd: 3, jack: [0.5, 0.02], cut: [12, 7] },
  "ur-forte": { cd: 13, start: [0, 10] },
};
const k = <T extends keyof typeof CK>(id: T) => CK[id];
const P = (v: number) => v * TUNE.passive;

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
    line: "한 번 더! 바람처럼 다시 굴려",
    bio: "바람처럼 떠도는 거리의 격투가. 마음에 안 드는 주사위는 질풍처럼 한 번 더 굴려 버려요.",
    passive: { name: "순풍", fx: (p) => ({ startBonus: st(k("kai").start, p) }), desc: (p) => `출발을 지날 때 코인 +${st(k("kai").start, p)}` },
    active: { name: "질풍 다시 굴리기", kind: "reroll", cd: cdOf(k("kai")), mag: () => 1, desc: () => "이번 차례 다시 굴리기 +1번" },
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
    line: "족보에 불을 붙이면 보상도 활활",
    bio: "불꽃을 다루는 술사. 주사위 족보에 불을 지펴 보상을 두 배로 끓어오르게 만들어요.",
    passive: { name: "뜨끈한 장사", fx: (p) => ({ blueBonus: st(k("igna").blue, p) }), desc: (p) => `파랑 칸 코인 +${st(k("igna").blue, p)}` },
    active: { name: "열기 축제", kind: "double", cd: cdOf(k("igna")), mag: () => 2, desc: () => "이번 차례 족보 보상 2배 (야추면 별 2개!)" },
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
    line: "우산으로 손해 비를 막는 꼬마",
    bio: "우산과 오리 장화를 좋아하는 꼬마. 빨강 칸 비가 와도 우산을 쓰윽 펴서 막아요.",
    passive: { name: "작은 우산", fx: (p) => ({ redCut: st(k("lily").red, p) }), desc: (p) => `빨강 칸 손해 −${st(k("lily").red, p)}` },
    active: {
      name: "물방울 방패",
      kind: "shield",
      cd: cdOf(k("lily")),
      mag: () => k("lily").shield,
      extra: () => k("lily").bonus,
      desc: () => `다음 손해 ${k("lily").shield}번을 막고, 막을 때마다 코인 +${k("lily").bonus} (빨강 · 뺏기 · 함정 · 대결)`,
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
    line: "주사위도 정신 교육부터",
    bio: "엄격한 교관. 삐딱한 주사위는 손가락으로 툭 쳐서 한 눈씩 바로잡아요.",
    passive: { name: "튼튼한 기초", fx: (p) => ({ startCoins: st(k("ivan").coins, p) }), desc: (p) => `시작 코인 +${st(k("ivan").coins, p)}` },
    active: {
      name: "정권 교정",
      kind: "nudge",
      cd: cdOf(k("ivan")),
      mag: (p) => st(k("ivan").nudge, p),
      desc: (p) => `주사위 하나를 ±${st(k("ivan").nudge, p)} 바꿔요`,
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
    line: "거기, 앞으로 나와!",
    bio: "규칙에 엄한 선생님. 딴짓하는 학생은 채찍으로 쓱 끌어다가 빨강 칸에 세워요.",
    passive: { name: "칭찬 스티커", fx: (p) => ({ comboCoin: st(k("soyoung").combo, p) }), desc: (p) => `페어 · 투 페어 보상 +${st(k("soyoung").combo, p)}코인` },
    active: {
      name: "채찍 끌어당기기",
      kind: "pull",
      cd: cdOf(k("soyoung")),
      mag: () => k("soyoung").pull,
      extra: (p) => st(k("soyoung").fee, p),
      desc: (p) => `상대 말을 앞뒤 1~${k("soyoung").pull}칸 끌어오고 ${st(k("soyoung").fee, p)}코인 벌금 (선 칸이 빨강 · 함정이면 그대로 당해요)`,
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
    line: "번개처럼 세 걸음!",
    bio: "번개 창을 든 창술사. 주사위 세 개를 한꺼번에 찔러 멀리까지 번쩍 달려가요.",
    passive: {
      name: "전광석화",
      fx: (p) => ({ straightBonus: st(k("zena").str, p), startBonus: k("zena").start }),
      desc: (p) => `스트레이트면 코인 +${st(k("zena").str, p)} · 출발을 지날 때 +${k("zena").start}`,
    },
    active: { name: "번개 질주", kind: "tri", cd: cdOf(k("zena")), mag: () => 3, desc: () => "이번 이동은 주사위 3개를 골라 그 합만큼" },
    on: true,
  },

  /* ── SR: 픽셀파이트 캐릭터 + 다이스 타운 스킨 ── */
  {
    id: "ivan-marine",
    name: "이반",
    title: "오도해병 이반",
    grade: "SR",
    base: "ivan",
    sprite: "ivan-marine",
    art: "/marble/art/ivan-marine.webp",
    color: "#d8402f",
    line: "필승! 주사위 하나 압수",
    bio: "오늘부터 해병대 체험! 필승 구호와 함께 상대 주사위 하나를 압수해 버리는 열혈 이반.",
    passive: { name: "철통 경계", fx: (p) => ({ stealGuard: st(k("ivan-marine").guard, p) }), desc: (p) => `코인을 뺏길 때 ${st(k("ivan-marine").guard, p)} 덜 뺏겨요` },
    active: { name: "주사위 압수", kind: "seal", cd: cdOf(k("ivan-marine")), mag: () => 1, desc: () => "상대 한 명의 다음 굴림 주사위 하나를 봉인해요" },
    on: true,
  },
  {
    id: "igna-student",
    name: "이그나",
    title: "학생 이그나",
    grade: "SR",
    base: "igna",
    sprite: "igna-student",
    art: "/marble/art/igna-student.webp",
    color: "#3a2f4f",
    line: "정답은 언제나 6!",
    bio: "검은 머리로 변신한 모범생(?) 이그나. 시험지에 6만 적어 내는데 이상하게 다 맞아요.",
    passive: { name: "열공 모드", fx: (p) => ({ bigCombo: st(k("igna-student").big, p) }), desc: (p) => `트리플 이상 족보면 코인 +${st(k("igna-student").big, p)}` },
    active: { name: "만점 답안", kind: "six", cd: cdOf(k("igna-student")), mag: () => 1, desc: () => "주사위 하나를 6으로 바꿔요" },
    on: true,
  },
  {
    id: "lily-hood",
    name: "릴리",
    title: "빨간망토 릴리",
    grade: "SR",
    base: "lily",
    sprite: "lily-hood",
    art: "/marble/art/lily-hood.webp",
    color: "#e2394b",
    line: "늑대 소굴은 폴짝 건너뛰어요",
    bio: "할머니 댁에 심부름 가는 빨간망토 릴리. 늑대 소굴(빨강 · 함정)은 폴짝 건너뛰는 게 요령이에요.",
    passive: { name: "심부름 바구니", fx: (p) => ({ itemBonus: st(k("lily-hood").item, p) }), desc: (p) => `럭키 박스에서 코인 +${st(k("lily-hood").item, p)}` },
    active: { name: "행운 바구니", kind: "hop", cd: cdOf(k("lily-hood")), mag: () => 2, desc: () => "이번 차례 도착 칸 코인 2배 · 빨강 · 함정 칸이면 다음 칸으로 폴짝" },
    on: true,
  },

  /* ── SSR: 다이스 타운 오리지널 ── */
  {
    id: "toto",
    name: "토토",
    title: "달토끼 배달부",
    grade: "SSR",
    base: "orig",
    sprite: "toto",
    art: "/marble/art/toto.webp",
    color: "#3d4f9a",
    line: "달빛 편지 배달 왔어요~ 한 칸 더!",
    bio: "달나라 우체국의 배달부 토끼. 롤러스케이트로 몇 칸 더 달려가고, 지나가는 집마다 배달비를 챙겨요.",
    passive: {
      name: "배달비",
      fx: (p) => ({ passBlue: st(k("toto").pass, p) }),
      desc: (p) => `지나간 파랑 칸마다 코인 +1 (차례당 최대 ${st(k("toto").pass, p)})`,
    },
    active: { name: "달토끼 점프", kind: "bunny", cd: cdOf(k("toto")), mag: () => 3, desc: () => "이동한 뒤 0~3칸 더 가요" },
    on: true,
  },
  {
    id: "mirage",
    name: "미라쥬",
    title: "꼬마 마술사",
    grade: "SSR",
    base: "orig",
    sprite: "mirage",
    art: "/marble/art/mirage.webp",
    color: "#7b4fd6",
    line: "자, 이 주사위를 잘 보세요… 짠!",
    bio: "주사위를 카드처럼 다루는 꼬마 마술사. 원하는 눈을 짠! 하고 꺼내 보이는 게 장기예요.",
    passive: {
      name: "카드 트릭",
      fx: (p) => ({ twin: P(lin(k("mirage").twin, p)) }),
      desc: (p) => `첫 굴림에 ${pct(P(lin(k("mirage").twin, p)))} 확률로 짝이 하나 더`,
    },
    active: { name: "마술 굴리기", kind: "magic", cd: cdOf(k("mirage")), mag: () => 2, desc: () => "주사위 두 개를 원하는 눈으로 바꿔요" },
    on: true,
  },
  {
    id: "lolo",
    name: "롤로",
    title: "서커스 단장",
    grade: "SSR",
    base: "orig",
    sprite: "lolo",
    art: "/marble/art/lolo.webp",
    color: "#e0442f",
    line: "레이디스 앤 젠틀맨! 관람료는 선불이에요",
    bio: "서커스단의 당찬 단장. 물개 파트너와 함께 공연을 열어 모두에게 관람료를 걷어요.",
    passive: { name: "링 마스터", fx: (p) => ({ vsBonus: st(k("lolo").vs, p) }), desc: (p) => `VS 대결에서 이기면 코인 +${st(k("lolo").vs, p)}` },
    active: {
      name: "서커스 공연",
      kind: "circus",
      cd: cdOf(k("lolo")),
      mag: (p) => st(k("lolo").fee, p),
      desc: (p) => `상대마다 ${st(k("lolo").fee, p)}코인씩 관람료를 받아요`,
    },
    on: true,
  },
  {
    id: "mongle",
    name: "몽글",
    title: "잠꾸러기 양",
    grade: "SSR",
    base: "orig",
    sprite: "mongle",
    art: "/marble/art/mongle.webp",
    color: "#8fb4ff",
    line: "양 한 마리… 양 두 마리… 쿨쿨",
    bio: "구름처럼 폭신한 잠꾸러기 양. 자장가 한 곡이면 누구든 졸려서 주사위를 한 번밖에 못 굴려요.",
    passive: {
      name: "포근한 털",
      fx: (p) => ({ trapFree: 1, redCut: st(k("mongle").red, p), startBonus: k("mongle").start }),
      desc: (p) => `함정 면역 · 빨강 칸 손해 −${st(k("mongle").red, p)} · 출발을 지날 때 +${k("mongle").start}`,
    },
    active: { name: "자장가", kind: "sleep", cd: cdOf(k("mongle")), mag: () => 1, desc: () => "상대 모두 다음 차례에 다시 굴리기를 못 해요" },
    on: true,
  },

  /* ── UR: 다이스 타운 오리지널 ── */
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
    bio: "주사위의 요정. 굴러가는 모든 주사위에 깃들어 있다가, 마음에 드는 눈을 몇 개든 복사해 줘요.",
    passive: {
      name: "요정의 눈짓",
      fx: (p) => ({ yachtBonus: st(k("ur-dice").yacht, p), usesReroll: 1 }),
      desc: (p) => `야추면 코인 +${st(k("ur-dice").yacht, p)} · 판당 한 번 다시 굴리기 +1`,
    },
    active: { name: "운명 복사", kind: "copy", cd: cdOf(k("ur-dice")), mag: () => 2, desc: () => "주사위 하나의 눈을 다른 주사위 두 개에 복사해요" },
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
    line: "그 별, 내가 살게냥",
    bio: "다이스 타운 최고의 재벌 고양이. 별이 멀리 있어도 집사를 보내 할인가에 사 와요.",
    passive: {
      name: "큰손",
      fx: (p) => ({ jackpotMult: P(lin(k("ur-moa").jack, p)) }),
      desc: (p) => `잭팟 +${pct(P(lin(k("ur-moa").jack, p)))}`,
    },
    active: {
      name: "VIP 쇼핑",
      kind: "vip",
      cd: cdOf(k("ur-moa")),
      mag: (p) => st(k("ur-moa").cut, p),
      desc: (p) => `이번 차례 별 값 −${st(k("ur-moa").cut, p)} · 별이 도착 칸에서 4칸 안이면 사요`,
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
    bio: "오르골 정원에서 태어난 태엽 소년. 태엽을 한 번 더 감으면 춤도, 차례도 한 번 더!",
    passive: {
      name: "태엽 장단",
      fx: (p) => ({ startBonus: st(k("ur-forte").start, p), festMult: 1 }),
      desc: (p) => (st(k("ur-forte").start, p) > 0 ? `출발을 지날 때 코인 +${st(k("ur-forte").start, p)} · 축제 보상 2배` : "축제 보상 2배"),
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

/** 아이템 수치표 — 계단 [a, every] · 비율 [a, b] (캐릭터와 같음) */
export const IK = {
  d_heavy: { one: [0.35, 0.02] },
  d_spark: { big: [1, 5] },
  d_twin: { twin: [0.1, 0.008] },
  d_slide: { at: 10 },
  d_gold: { at: 15 },
  d_time: { at: 15 },
  b_hamster: { red: [1, 10] },
  b_pigeon: { item: [2, 5] },
  b_robot: { start: [1, 10] },
  b_dog: { guard: [0.25, 0.02] },
  b_cat: { start: [1, 10] },
  b_fox: { cut: [2, 7] },
};
const ik = <T extends keyof typeof IK>(id: T) => IK[id];

export const ITEMS: ItemDef[] = [
  /* 주사위 */
  {
    id: "d_heavy",
    slot: "dice",
    name: "묵직한 주사위",
    grade: "R",
    fx: (p) => ({ noOne: Math.min(0.9, I(lin(ik("d_heavy").one, p))) }),
    desc: (p) => `다시 굴린 주사위가 1이면 ${pct(Math.min(0.9, I(lin(ik("d_heavy").one, p))))} 확률로 한 번 더 굴러가요`,
  },
  {
    id: "d_spark",
    slot: "dice",
    name: "반짝 주사위",
    grade: "R",
    fx: (p) => ({ bigCombo: st(ik("d_spark").big, p) }),
    desc: (p) => `트리플 이상 족보면 코인 +${st(ik("d_spark").big, p)}`,
  },
  {
    id: "d_twin",
    slot: "dice",
    name: "쌍둥이 주사위",
    grade: "SR",
    fx: (p) => ({ twin: I(lin(ik("d_twin").twin, p)) }),
    desc: (p) => `첫 굴림에 ${pct(I(lin(ik("d_twin").twin, p)))} 확률로 짝이 하나 더`,
  },
  {
    id: "d_slide",
    slot: "dice",
    name: "미끄럼 주사위",
    grade: "SR",
    fx: (p) => ({ usesSlide: usesAt(1, ik("d_slide").at)(p) }),
    desc: (p) => `이동할 때 한 칸 더 · 덜 미끄러지기 (판당 ${usesAt(1, ik("d_slide").at)(p)}번)`,
  },
  {
    id: "d_gold",
    slot: "dice",
    name: "황금 주사위",
    grade: "SSR",
    fx: (p) => ({ usesGold: usesAt(1, ik("d_gold").at)(p) }),
    desc: (p) => `주사위 하나를 원하는 눈으로 (판당 ${usesAt(1, ik("d_gold").at)(p)}번)`,
  },
  {
    id: "d_time",
    slot: "dice",
    name: "시간 주사위",
    grade: "SSR",
    fx: (p) => ({ usesReroll: usesAt(1, ik("d_time").at)(p) }),
    desc: (p) => `시간을 되감아 다시 굴리기 +1 (판당 ${usesAt(1, ik("d_time").at)(p)}번)`,
  },
  /* 동행 */
  {
    id: "b_hamster",
    slot: "buddy",
    name: "저금통 햄스터",
    grade: "R",
    fx: (p) => ({ redCut: st(ik("b_hamster").red, p) }),
    desc: (p) => `빨강 칸 손해 −${st(ik("b_hamster").red, p)}`,
  },
  {
    id: "b_pigeon",
    slot: "buddy",
    name: "배달 비둘기",
    grade: "R",
    fx: (p) => ({ itemBonus: st(ik("b_pigeon").item, p) }),
    desc: (p) => `럭키 박스에서 코인 +${st(ik("b_pigeon").item, p)}`,
  },
  {
    id: "b_robot",
    slot: "buddy",
    name: "수리공 로봇",
    grade: "SR",
    fx: (p) => ({ trapFree: 1, startBonus: st(ik("b_robot").start, p) }),
    desc: (p) => `함정 면역 · 출발을 지날 때 코인 +${st(ik("b_robot").start, p)}`,
  },
  {
    id: "b_dog",
    slot: "buddy",
    name: "경비견",
    grade: "SR",
    fx: (p) => ({ guard: Math.min(0.8, I(lin(ik("b_dog").guard, p))) }),
    desc: (p) => `코인을 뺏기거나 대결에 지면 ${pct(Math.min(0.8, I(lin(ik("b_dog").guard, p))))} 확률로 막아요`,
  },
  {
    id: "b_cat",
    slot: "buddy",
    name: "행운 고양이",
    grade: "SSR",
    fx: (p) => ({ eventLuck: 1, startBonus: st(ik("b_cat").start, p) }),
    desc: (p) => `마을 소식은 두 장 보고 좋은 쪽 · 출발을 지날 때 코인 +${st(ik("b_cat").start, p)}`,
  },
  {
    id: "b_fox",
    slot: "buddy",
    name: "흥정 여우",
    grade: "SSR",
    fx: (p) => ({ starCut: st(ik("b_fox").cut, p) }),
    desc: (p) => `별 값 −${st(ik("b_fox").cut, p)}코인`,
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
    for (const [k, v] of Object.entries(f) as [keyof Fx, number][]) fx[k] = MAX_KEYS.includes(k) ? Math.max(fx[k], v) : fx[k] + v;
  };
  const c = CHAR[lo.char.id] ?? CHAR.kai;
  const pc = power(c.grade, lo.char.lv);
  add(c.passive.fx(pc));
  for (const g of [lo.dice, lo.buddy]) {
    if (!g) continue;
    const it = ITEM[g.id];
    if (it) add(it.fx(power(it.grade, g.lv)));
  }
  fx.twin = Math.min(0.6, fx.twin);
  fx.guard = Math.min(0.8, fx.guard);
  const extra = c.active.extra?.(pc);
  return { fx, skill: { kind: c.active.kind, cd: c.active.cd(pc), mag: c.active.mag(pc), ...(extra !== undefined && { extra }) } };
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
    /** 이 횟수 안에 UR 이 안 나오면 UR 확정 */
    urPity: 150,
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

export interface StoreGive {
  stars?: number;
  parts?: number;
  charTickets?: number;
  itemTickets?: number;
  /** 사이트 포인트(GP) 돌려받기 */
  gp?: number;
  /** 일일 패스 날 수 (매일 PASS_DAY 만큼) */
  passDays?: number;
}
export interface StoreItem {
  id: string;
  name: string;
  /** pass 패스 · pack 패키지 · cur 재화 · swap GP 로 바꾸기 · admin 관리자 */
  kind: "pass" | "pack" | "cur" | "swap" | "admin";
  gp: number;
  /** GP 대신 재화로 사는 것 (swap) */
  cost?: { stars?: number; parts?: number };
  give: StoreGive;
  /** 한 주(한국 시간 월요일 시작) 살 수 있는 수 · 한 번만(once) */
  perWeek?: number;
  once?: boolean;
  desc: string;
}
/** 일일 패스: 하루 한 번 (메뉴에 들어오면 자동으로) */
export const PASS_DAY = { stars: 100, parts: 10 };
/** GP 환산 (이득 % 계산용): 1,000GP = 별사탕 300 · 600GP = 부품 60 */
const GP_PER = { star: 1000 / 300, part: 10 };
export function giveValueGp(g: StoreGive): number {
  const stars = (g.stars ?? 0) + (g.charTickets ?? 0) * GACHA.char.ten + (g.itemTickets ?? 0) * GACHA.item.ten + (g.passDays ?? 0) * PASS_DAY.stars;
  const parts = (g.parts ?? 0) + (g.passDays ?? 0) * PASS_DAY.parts;
  return Math.round(stars * GP_PER.star + parts * GP_PER.part + (g.gp ?? 0));
}
/** 값 대비 이득 % (GP 로 사는 것만) */
export const storeBonus = (it: StoreItem) => (it.gp > 0 ? Math.round((giveValueGp(it.give) / it.gp - 1) * 100) : 0);

/** GP 상점 — 재화는 1,000GP = 별사탕 300 (10연차 ≈ 4,500GP), 패스 · 패키지는 몇 배 이득. GP 로 되돌리기는 절반 값 */
export const STORE: StoreItem[] = [
  { id: "p_daily", kind: "pass", name: "일일 패스 14일", gp: 2000, give: { stars: 300, passDays: 14 }, desc: `바로 별사탕 300 + 14일 동안 매일 별사탕 ${PASS_DAY.stars} · 부품 ${PASS_DAY.parts}` },
  { id: "p_week", kind: "pass", name: "주간 여행 꾸러미", gp: 2000, give: { charTickets: 1, itemTickets: 1, parts: 120 }, perWeek: 1, desc: "캐릭터 · 아이템 10연차 티켓 한 장씩 + 부품 120 (주 1회)" },
  { id: "p_start", kind: "pack", name: "첫 손님 패키지", gp: 1000, give: { stars: 1500, parts: 200, charTickets: 1, itemTickets: 1, passDays: 7 }, once: true, desc: "별사탕 1,500 · 부품 200 · 10연차 티켓 둘 · 일일 패스 7일 (한 번만)" },
  { id: "s_star", kind: "cur", name: "별사탕 300", gp: 1000, give: { stars: 300 }, desc: "캐릭터 2번 · 아이템 3번" },
  { id: "s_parts", kind: "cur", name: "부품 60", gp: 600, give: { parts: 60 }, desc: "아이템 강화 재료" },
  { id: "x_star", kind: "swap", name: "별사탕 → GP", gp: 0, cost: { stars: 300 }, give: { gp: 500 }, desc: "별사탕 300 을 500GP 로 (절반 값)" },
  { id: "x_parts", kind: "swap", name: "부품 → GP", gp: 0, cost: { parts: 60 }, give: { gp: 300 }, desc: "부품 60 을 300GP 로 (절반 값)" },
  { id: "a_all", kind: "admin", name: "관리자 지원금", gp: 0, give: { stars: 10000, parts: 10000, gp: 10000, charTickets: 10, itemTickets: 10 }, desc: "모든 재화 +10,000 · 티켓 +10 (관리자만, 무제한)" },
];
export const storeItem = (id: unknown) => STORE.find((s) => s.id === id);
