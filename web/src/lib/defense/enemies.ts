/**
 * 글리치 디펜스 적 — 픽셀 세계를 갉아먹는 버그(글리치) 몬스터 + 글리치에 오염된 PIXEL FIGHT 파이터 보스.
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
  | { kind: "evade"; every: number; sec: number };

export interface BossDef {
  wave: number;
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
    hp: 1,
    armor: 1.5,
    mres: 0,
    pres: 0.5,
    skills: [{ kind: "shield", every: 8, pct: 0.05 }],
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
    hp: 1,
    armor: 2,
    mres: 0.5,
    pres: 0,
    skills: [{ kind: "summon", every: 8, n: 4, hp: 2 }],
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
    hp: 1.3,
    armor: 2,
    mres: 0.25,
    pres: 0.25,
    skills: [
      { kind: "dash", every: 7, sec: 1.2, mult: 2.5 },
      { kind: "evade", every: 9, sec: 1.2 },
      { kind: "heal", every: 10, pct: 0.03 },
    ],
    line: "바람은… 멈추지 않아… 이 세계가 끝날 때까지.",
    color: "#7CF2C2",
  },
];
export const bossOfWave = (w: number) => BOSSES.find((b) => b.wave === w) ?? null;
