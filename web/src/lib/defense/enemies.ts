/**
 * 픽셀 글리치 디펜스 적 — 픽셀 세계를 갉아먹는 버그(글리치) 몬스터 + 글리치에 오염된 PIXEL FIGHT 파이터 보스.
 *
 * size 0 소형 · 1 중형 · 2 대형 → 세력 상성 (units.ts SIZE_MULT)
 * hp · armor 는 웨이브 기본값(balance.ts)에 곱하는 배수, mres/pres 는 마법 · 물리 저항 (0~1)
 */

export type Size = 0 | 1 | 2;
export const SIZE_NAME = ["소형", "중형", "대형"] as const;

export interface EnemyKind {
  id: string;
  name: string;
  size: Size;
  spd: number;
  hp: number;
  armor: number;
  mres: number;
  /** 그림 없을 때 색 */
  color: string;
}

export const KINDS: EnemyKind[] = [
  {
    id: "slime",
    name: "글리치 슬라임",
    size: 0,
    spd: 1,
    hp: 1,
    armor: 1,
    mres: 0,
    color: "#5BE07A",
  },
  {
    id: "bat",
    name: "노이즈 박쥐",
    size: 0,
    spd: 1.35,
    hp: 0.7,
    armor: 0.6,
    mres: 0,
    color: "#8C7BFF",
  },
  {
    id: "bug",
    name: "픽셀 버그",
    size: 0,
    spd: 1.1,
    hp: 0.9,
    armor: 1.5,
    mres: 0,
    color: "#FF6B6B",
  },
  {
    id: "block",
    name: "깨진 블록",
    size: 1,
    spd: 0.9,
    hp: 1.3,
    armor: 2,
    mres: 0,
    color: "#C9A26B",
  },
  {
    id: "skull",
    name: "에러 해골",
    size: 1,
    spd: 1,
    hp: 1.1,
    armor: 1,
    mres: 0.3,
    color: "#E8E8E8",
  },
  {
    id: "ghost",
    name: "404 유령",
    size: 1,
    spd: 1.15,
    hp: 0.9,
    armor: 0,
    mres: 0.5,
    color: "#7FE7FF",
  },
  {
    id: "golem",
    name: "데드픽셀 골렘",
    size: 2,
    spd: 0.75,
    hp: 1.8,
    armor: 2.5,
    mres: 0,
    color: "#7A7A8C",
  },
  {
    id: "worm",
    name: "무한 루프 웜",
    size: 2,
    spd: 0.85,
    hp: 1.6,
    armor: 1.5,
    mres: 0.2,
    color: "#FF9F43",
  },
];
export const KIND: Record<string, EnemyKind> = Object.fromEntries(KINDS.map((k) => [k.id, k]));

/**
 * 웨이브 → 나오는 적 종류. 세력마다 유리한 웨이브가 고르게 오도록 크기를 돌림.
 * (1~3 은 쉬운 소형으로 시작)
 */
const ROTATION = [
  "slime",
  "bat",
  "block",
  "bug",
  "golem",
  "skull",
  "worm",
  "ghost",
  "slime",
  "block",
  "bat",
  "golem",
  "bug",
  "worm",
  "skull",
  "ghost",
];
export function kindOfWave(w: number): string {
  if (w <= 2) return "slime";
  if (w === 3) return "bat";
  return ROTATION[(w - 4) % ROTATION.length];
}

/** 보스 기술 */
export type BossSkill =
  /** every 초마다 최대 체력 pct 회복 */
  | { kind: "heal"; every: number; pct: number }
  /** every 초마다 유닛이 있는 칸 n 개를 sec 초 기절 */
  | { kind: "whip"; every: number; n: number; sec: number }
  /** every 초마다 sec 초 동안 속도 ×mult */
  | { kind: "dash"; every: number; sec: number; mult: number }
  /** every 초마다 최대 체력 pct 만큼 보호막 */
  | { kind: "shield"; every: number; pct: number }
  /** every 초마다 졸개 n 마리 (그 웨이브 적 체력 × hp) */
  | { kind: "summon"; every: number; n: number; hp: number }
  /** every 초마다 sec 초 동안 모든 피해 무시 */
  | { kind: "evade"; every: number; sec: number }
  /** (픽셀 타운 DICE) every 초마다 주사위 — 눈(1~6)만큼 길을 순간이동 */
  | { kind: "warp"; every: number }
  /** (픽셀 타운 MOA) every 초마다 가장 높은 건물 하나를 빼앗음 (보스를 잡을 때까지 영업 정지) · 빼앗을 때마다 최대 체력 pct 보호막 */
  | { kind: "seize"; every: number; pct: number }
  /** (픽셀 타운 FORTE) 체력이 at 밑으로 처음 내려가면 한 번: 최대 체력 pct 회복 + 필드의 다른 적 2초 질주 (every 는 안 씀) */
  | { kind: "encore"; every: number; at: number; pct: number }
  /** (원정 MOA) every 초마다 가진 골드 pct 를 빼앗음 — 잡으면 빼앗긴 만큼 ×2 돌려받음 */
  | { kind: "steal"; every: number; pct: number }
  /** (원정 FORTE) 체력이 at 밑으로 처음 내려가면 한 번: 같은 보스 n 기가 최대 체력 hp 비율로 갈라져 나옴 (모두 잡아야 끝) */
  | { kind: "split"; every: number; at: number; n: number; hp: number }
  /**
   * (2페이즈) 예고 기술: 유닛이 가장 센 곳을 shape 모양으로 warn 초 동안 빨갛게 표시 → 그때 그 칸에 **남아 있는** 유닛 sec 초 기절.
   * 표시되는 동안 끌어서 옮기면 피함 (약한 유닛을 넣어 두면 미끼). snd = 맞을 때 효과음 tele-<snd>
   */
  | { kind: "tele"; shape: TeleShape; every: number; warn: number; sec: number; name: string; snd: string };

/** 예고 모양: 가로줄 · 세로줄 · 한 칸 · 센 칸 둘 · 2×2 · 십자(센 칸 + 상하좌우) */
export type TeleShape = "row" | "col" | "cell" | "two" | "area" | "plus";

/** 보스 2페이즈가 나오는 첫 오염 단계 */
export const BOSS_PHASE_GLITCH = 15;
/**
 * 단계마다 2페이즈가 나오는 보스 둘 (보스 웨이브) — 단계마다 정해져 있음 (판마다 무작위가 아님 → 다시 시작해도 같음).
 * 15단계부터 쉬운 조합 → 어려운 조합 순 (웨이브 합), 30단계는 50 · 60
 */
export const PHASE_PAIRS: Record<number, [number, number]> = {
  15: [10, 20],
  16: [10, 30],
  17: [10, 40],
  18: [20, 30],
  19: [10, 50],
  20: [20, 40],
  21: [10, 60],
  22: [20, 50],
  23: [30, 40],
  24: [20, 60],
  25: [30, 50],
  26: [30, 60],
  27: [40, 50],
  28: [40, 60],
  29: [50, 60],
  30: [50, 60],
};
/** 심연 2막: 31~39 단계는 셋 (40 · 50 · 60), 40단계부터는 여섯 모두 */
export const phaseWaves = (glitch: number): number[] =>
  glitch >= 40 ? [10, 20, 30, 40, 50, 60] : glitch > 30 ? [40, 50, 60] : (PHASE_PAIRS[glitch] ?? []);
/** 이 오염 단계에서 이 보스(웨이브)가 2페이즈를 쓰나 */
export const phaseOn = (glitch: number, wave: number) => phaseWaves(glitch).includes(wave);
/** 2페이즈 예고 기술 이름 */
export const phaseSkillName = (d: BossDef) => {
  const s = d.phase?.skills.find((x) => x.kind === "tele");
  return s && s.kind === "tele" ? s.name : "";
};
/** 이 단계 2페이즈 보스 소개 ("제나 뇌섬일창 · 이반 곰 포옹"), 없으면 "" */
export const phaseText = (glitch: number) =>
  phaseWaves(glitch)
    .map((w) => BOSSES.find((x) => !x.stage && x.wave === w))
    .map((d) => (d ? `${d.name.replace("글리치 ", "")} ${phaseSkillName(d)}` : ""))
    .join(" · ");

export interface BossDef {
  wave: number;
  /** 이 스테이지에서만 나오는 보스 (없으면 글리치 시티 = 기본) */
  stage?: "town";
  /** PIXEL FIGHT 캐릭터 id (그림 · 이름) */
  fighter: string;
  name: string;
  title: string;
  size: Size;
  spd: number;
  hp: number;
  armor: number;
  mres: number;
  pres: number;
  skills: BossSkill[];
  /** 2페이즈 (오염 BOSS_PHASE_GLITCH 단계부터): 체력이 at 비율 밑이면 skills 를 더 씀 */
  phase?: { at: number; skills: BossSkill[]; line: string };
  /** 보스 등장 대사 */
  line: string;
  color: string;
}

export const BOSSES: BossDef[] = [
  {
    wave: 10,
    fighter: "lily",
    name: "글리치 릴리",
    title: "오염된 우산",
    size: 0,
    spd: 0.9,
    hp: 0.4,
    armor: 0.5,
    mres: 0,
    pres: 0,
    skills: [{ kind: "heal", every: 6, pct: 0.04 }],
    phase: {
      at: 0.5,
      skills: [{ kind: "tele", shape: "col", every: 8, warn: 2, sec: 2.5, name: "장마 파도", snd: "wave" }],
      line: "비 와요… 우산 없으면… 다 젖어요!",
    },
    line: "우산 밑은… 버그 안 와요… 헤헤…",
    color: "#7FD3FF",
  },
  {
    wave: 20,
    fighter: "soyoung",
    name: "글리치 소영",
    title: "오염된 채찍",
    size: 1,
    spd: 0.85,
    hp: 0.8,
    armor: 1,
    mres: 0,
    pres: 0,
    skills: [{ kind: "whip", every: 7, n: 2, sec: 2.5 }],
    phase: {
      at: 0.5,
      skills: [{ kind: "tele", shape: "two", every: 7, warn: 2, sec: 3, name: "채찍 난무", snd: "whip" }],
      line: "제일 잘난 두 명, 앞으로 나와요.",
    },
    line: "수업 시간에 딴짓하는 유닛은 벌이에요.",
    color: "#FF8FB1",
  },
  {
    wave: 30,
    fighter: "zena",
    name: "글리치 제나",
    title: "오염된 번개창",
    size: 1,
    spd: 1,
    hp: 1,
    armor: 1,
    mres: 0.2,
    pres: 0,
    skills: [{ kind: "dash", every: 6, sec: 1.5, mult: 3 }],
    phase: {
      at: 0.5,
      skills: [{ kind: "tele", shape: "row", every: 7, warn: 2, sec: 3, name: "뇌섬일창", snd: "bolt" }],
      line: "뇌섬일창— 그 줄, 다 태워 줄게!",
    },
    line: "번개보다 빠르게— 지지직—",
    color: "#FFE15C",
  },
  {
    wave: 40,
    fighter: "igna",
    name: "글리치 이그나",
    title: "오염된 불꽃",
    size: 1,
    spd: 0.85,
    hp: 0.55,
    armor: 1.5,
    mres: 0,
    pres: 0.35,
    skills: [{ kind: "shield", every: 10, pct: 0.05 }],
    phase: {
      at: 0.5,
      skills: [{ kind: "tele", shape: "area", every: 8, warn: 2, sec: 3, name: "업화주", snd: "fire" }],
      line: "불기둥이 따라간다. 도망쳐 봐.",
    },
    line: "물리로는 못 꺼. 마법이면 몰라도.",
    color: "#FF6A3D",
  },
  {
    wave: 50,
    fighter: "ivan",
    name: "글리치 이반",
    title: "오염된 교관",
    size: 2,
    spd: 0.7,
    hp: 0.5,
    armor: 2,
    mres: 0.5,
    pres: 0,
    skills: [{ kind: "summon", every: 9, n: 3, hp: 1.5 }],
    phase: {
      at: 0.5,
      skills: [{ kind: "tele", shape: "cell", every: 8, warn: 2.5, sec: 6, name: "곰 포옹", snd: "grab" }],
      line: "제일 센 놈부터… 곰 포옹이다!",
    },
    line: "신병들! 저 방어선을 뚫어라!",
    color: "#9FB0C8",
  },
  {
    wave: 60,
    fighter: "kai",
    name: "글리치 카이",
    title: "오염된 바람 · 최종",
    size: 2,
    spd: 1.1,
    hp: 0.35,
    armor: 2,
    mres: 0.25,
    pres: 0.25,
    skills: [
      { kind: "dash", every: 7, sec: 1.2, mult: 2.5 },
      { kind: "evade", every: 9, sec: 1.2 },
      { kind: "heal", every: 10, pct: 0.03 },
    ],
    phase: {
      at: 0.5,
      skills: [{ kind: "tele", shape: "plus", every: 7, warn: 1.8, sec: 3, name: "질풍 낙하", snd: "wind" }],
      line: "바람이 내려앉는 곳엔… 아무것도 안 남아.",
    },
    line: "바람은… 멈추지 않아… 이 세계가 끝날 때까지.",
    color: "#7CF2C2",
  },
];
/**
 * 픽셀 타운 보스 — PIXEL MARBLE 의 UR 셋이 글리치에 먹힘 (10 · 30 · 50웨이브). 20 · 40 · 60 은 글리치 시티 보스 그대로.
 * 그림: public/defense/bosses/ur-*.webp (fighter 가 그림 id)
 */
export const TOWN_BOSSES: BossDef[] = [
  {
    wave: 0,
    stage: "town",
    fighter: "ur-dice",
    name: "글리치 DICE",
    title: "운명을 굴리는 요정",
    size: 0,
    spd: 0.9,
    hp: 0.55,
    armor: 0.5,
    mres: 0,
    pres: 0,
    skills: [
      { kind: "warp", every: 5 },
      { kind: "whip", every: 7, n: 2, sec: 2.5 },
      { kind: "heal", every: 9, pct: 0.03 },
    ],
    line: "주사위 굴려 볼까? 누가 멈출지는… 운명이 정해!",
    color: "#7fe8d8",
  },
  {
    wave: 0,
    stage: "town",
    fighter: "ur-moa",
    name: "글리치 MOA",
    title: "탐욕의 고양이 재벌",
    size: 1,
    spd: 0.85,
    hp: 0.9,
    armor: 1.2,
    mres: 0.2,
    pres: 0,
    skills: [
      { kind: "steal", every: 6, pct: 0.1 },
      { kind: "shield", every: 9, pct: 0.06 },
    ],
    line: "네 골드, 전부 내 거야냥. 되찾고 싶으면 날 쓰러뜨려 봐.",
    color: "#ffd36b",
  },
  {
    wave: 0,
    stage: "town",
    fighter: "ur-forte",
    name: "글리치 FORTE",
    title: "분열하는 오르골 소년",
    size: 1,
    spd: 0.8,
    hp: 0.6,
    armor: 1.8,
    mres: 0.35,
    pres: 0,
    skills: [
      { kind: "summon", every: 8, n: 3, hp: 1.3 },
      { kind: "split", every: 1, at: 0.5, n: 2, hp: 0.35 },
    ],
    line: "박수는… 아직이야. 앙코르는 셋이서 할게.",
    color: "#ff9ec7",
  },
];
BOSSES.push(...TOWN_BOSSES);
/** 이 웨이브 보스 — 픽셀 타운은 10 · 30 · 50 이 UR 보스, 나머지는 글리치 시티 보스 */
export const bossOfWave = (w: number, stage: "main" | "town" = "main") =>
  (stage === "town" ? BOSSES.find((b) => b.stage === "town" && b.wave === w) : null) ??
  BOSSES.find((b) => !b.stage && b.wave === w) ??
  null;
/** 글리치 시티(기본) 보스 6명 */
export const MAIN_BOSSES = BOSSES.filter((b) => !b.stage);
