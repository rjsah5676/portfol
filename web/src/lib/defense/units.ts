/**
 * 픽셀 글리치 디펜스 유닛 — 세 세력(기사단 · 기계공방 · 마도회) + 히든.
 *
 * 세력 = 공격 상성 (메운디의 진동형 · 폭발형 · 일반형):
 *   기사단  물리 · 작은 적에 강함 (대형에 약함), 단일 · 치명타 · 기절
 *   기계공방 물리 · 큰 적에 강함 (소형에 약함), 범위 폭발 · 방어 깎기
 *   마도회  마법 · 크기 무관 · 방어 무시 (마법 저항엔 막힘), 둔화 · 체력 비례 · 강화가 쌈
 *
 * 등급 0 노말 · 1 레어 · 2 에픽 · 3 레전드 (여기까지 소환 · 합성) · 4 신화 (조합식) · 5 히든 (숨은 조합식)
 * 같은 유닛 3개 → 같은 세력 다음 등급 무작위. 레전드는 합성 대신 조합식으로 신화.
 *
 * 수치 단위: dmg 한 대 피해, aps 초당 공격, range 칸, 확률 0~1, sec 초.
 * 그림은 assets.ts (id 로 연결) — 여기는 성능만.
 */

export type Faction = "knight" | "mech" | "arcane" | "hidden";
export type Grade = 0 | 1 | 2 | 3 | 4 | 5;
export type DmgType = "phys" | "magic";

export type Proc =
  /** 기절 */
  | { chance: number; kind: "stun"; sec: number }
  /** 지금 체력의 pct 만큼 마법 피해 (보스 제외) */
  | { chance: number; kind: "cur"; pct: number }
  /** 둔화 (pct 만큼 느리게, sec 동안) */
  | { chance: number; kind: "slow"; pct: number; sec: number };

export type Ult =
  /** 대상 둘레 r 칸 안 전부 피해 × mult (+ 기절 · 지금 체력 비례) */
  | {
      every: number;
      kind: "nova";
      r: number;
      mult: number;
      stun?: number;
      cur?: number;
      name: string;
    }
  /** 체력이 가장 많은 적 n 마리에게 × mult */
  | { every: number; kind: "barrage"; n: number; mult: number; name: string }
  /** 가장 앞선 일반 적 하나 삭제 (보스는 최대 체력 pct 피해) */
  | { every: number; kind: "delete"; pct: number; name: string };

export interface UnitDef {
  id: string;
  name: string;
  faction: Faction;
  grade: Grade;
  dtype: DmgType;
  dmg: number;
  aps: number;
  range: number;
  /** 대상 둘레 r 칸에 pct 만큼 */
  splash?: { r: number; pct: number };
  /** 대상에서 가까운 n 마리로 튐 (한 번 튈 때마다 × pct) */
  chain?: { n: number; pct: number };
  crit?: { chance: number; mult: number };
  procs?: Proc[];
  /** 범위 효과 — slow: 적 둔화(같은 종류는 가장 센 것만), shred: 적 방어 깎기(유닛 종류마다 더함), aspd: 아군 공속 */
  aura?: { r: number; slow?: number; shred?: number; aspd?: number };
  /** 보스 피해 배수 */
  boss?: number;
  ult?: Ult;
  /** 처치할 때: 골드 · 행운석 확률 */
  onKill?: { gold?: number; goldChance?: number; stone?: number };
  /** 한 줄 설명 (도감 · 선택 창) */
  desc: string;
  /** 그림 없을 때 보일 글자 (1~2자) */
  glyph: string;
}

export const GRADE_NAME = ["노말", "레어", "에픽", "레전드", "신화", "히든"] as const;
export const GRADE_COLOR = [
  "#B8C0CC",
  "#4FC3F7",
  "#B388FF",
  "#FFC93C",
  "#FF5C8A",
  "#4CFFB0",
] as const;
export const FACTION_NAME: Record<Faction, string> = {
  knight: "기사단",
  mech: "기계공방",
  arcane: "마도회",
  hidden: "히든",
};
export const FACTION_COLOR: Record<Faction, string> = {
  knight: "#6EC1FF",
  mech: "#FFB347",
  arcane: "#C08CFF",
  hidden: "#4CFFB0",
};
/** 세력 피해 배수 [소형, 중형, 대형] (물리만) */
export const SIZE_MULT: Record<Faction, [number, number, number]> = {
  knight: [1, 0.7, 0.45],
  mech: [0.5, 0.8, 1],
  arcane: [1, 1, 1],
  hidden: [1, 1, 1],
};
export const FACTIONS: Exclude<Faction, "hidden">[] = ["knight", "mech", "arcane"];

const U = (d: Omit<UnitDef, "dtype"> & { dtype?: DmgType }): UnitDef => ({
  dtype: d.faction === "arcane" ? "magic" : "phys",
  ...d,
});

export const UNITS: UnitDef[] = [
  // ───────── 기사단 ─────────
  U({
    id: "k_squire",
    name: "견습 검사",
    faction: "knight",
    grade: 0,
    dmg: 10,
    aps: 1,
    range: 1.8,
    glyph: "검",
    desc: "기본 근접 검사",
  }),
  U({
    id: "k_shield",
    name: "방패병",
    faction: "knight",
    grade: 0,
    dmg: 6,
    aps: 0.9,
    range: 1.6,
    glyph: "방",
    procs: [{ chance: 0.1, kind: "stun", sec: 0.6 }],
    desc: "10% 확률 0.6초 기절",
  }),
  U({
    id: "k_spear",
    name: "창병",
    faction: "knight",
    grade: 0,
    dmg: 8,
    aps: 1,
    range: 2.4,
    glyph: "창",
    desc: "기사단 노말 중 사거리가 김",
  }),

  U({
    id: "k_twin",
    name: "쌍검사",
    faction: "knight",
    grade: 1,
    dmg: 13,
    aps: 2,
    range: 1.8,
    glyph: "쌍",
    crit: { chance: 0.15, mult: 2 },
    desc: "빠른 연타 · 15% 치명타 ×2",
  }),
  U({
    id: "k_knight",
    name: "기사",
    faction: "knight",
    grade: 1,
    dmg: 30,
    aps: 0.9,
    range: 2,
    glyph: "기",
    procs: [{ chance: 0.15, kind: "stun", sec: 0.8 }],
    desc: "15% 확률 0.8초 기절",
  }),
  U({
    id: "k_axe",
    name: "도끼전사",
    faction: "knight",
    grade: 1,
    dmg: 26,
    aps: 1,
    range: 1.8,
    glyph: "도",
    splash: { r: 0.8, pct: 0.5 },
    desc: "주변 50% 범위 피해",
  }),

  U({
    id: "k_paladin",
    name: "성기사",
    faction: "knight",
    grade: 2,
    dmg: 60,
    aps: 1,
    range: 2.2,
    glyph: "성",
    aura: { r: 1.6, aspd: 0.15 },
    desc: "주변 아군 공격 속도 +15%",
  }),
  U({
    id: "k_blade",
    name: "검호",
    faction: "knight",
    grade: 2,
    dmg: 45,
    aps: 2.2,
    range: 2,
    glyph: "호",
    crit: { chance: 0.25, mult: 2.5 },
    desc: "25% 치명타 ×2.5",
  }),
  U({
    id: "k_hunter",
    name: "마물 사냥꾼",
    faction: "knight",
    grade: 2,
    dmg: 80,
    aps: 0.9,
    range: 2.6,
    glyph: "냥",
    boss: 1.5,
    aura: { r: 2.6, shred: 15 },
    desc: "보스 피해 ×1.5 · 방어 깎기 15",
  }),

  U({
    id: "k_commander",
    name: "성검 기사단장",
    faction: "knight",
    grade: 3,
    dmg: 210,
    aps: 1.2,
    range: 2.6,
    glyph: "단",
    ult: { every: 10, kind: "nova", r: 1.2, mult: 6, stun: 1, name: "성검 해방" },
    desc: "10타마다 성검 해방 (범위 ×6 · 1초 기절)",
  }),
  U({
    id: "k_gale",
    name: "질풍 검호",
    faction: "knight",
    grade: 3,
    dmg: 120,
    aps: 3,
    range: 2.2,
    glyph: "질",
    crit: { chance: 0.3, mult: 3 },
    chain: { n: 2, pct: 0.6 },
    desc: "초고속 연타 · 30% 치명타 ×3 · 2마리로 튐",
  }),

  U({
    id: "k_saint",
    name: "검성",
    faction: "knight",
    grade: 4,
    dmg: 600,
    aps: 1.6,
    range: 3,
    glyph: "검성",
    crit: { chance: 0.3, mult: 3 },
    boss: 1.3,
    ult: { every: 8, kind: "nova", r: 2, mult: 5, name: "천검" },
    desc: "치명타 ×3 · 8타마다 천검 (넓은 범위 ×5) · 보스 ×1.3",
  }),
  U({
    id: "k_dragoon",
    name: "용기사",
    faction: "knight",
    grade: 4,
    dmg: 900,
    aps: 1,
    range: 3.2,
    glyph: "용",
    splash: { r: 1, pct: 0.7 },
    aura: { r: 3.2, shred: 30 },
    ult: { every: 6, kind: "nova", r: 1.4, mult: 3, stun: 1.5, name: "용의 강하" },
    desc: "범위 공격 · 방어 깎기 30 · 6타마다 강하 (1.5초 기절)",
  }),

  // ───────── 기계공방 ─────────
  U({
    id: "m_bolt",
    name: "볼트 공병",
    faction: "mech",
    grade: 0,
    dmg: 9,
    aps: 0.9,
    range: 2.6,
    glyph: "볼",
    desc: "기본 원거리 공병",
  }),
  U({
    id: "m_turret",
    name: "소형 포탑",
    faction: "mech",
    grade: 0,
    dmg: 12,
    aps: 0.7,
    range: 3,
    glyph: "포",
    splash: { r: 0.6, pct: 0.4 },
    desc: "작은 범위 폭발",
  }),
  U({
    id: "m_drone",
    name: "태엽 드론",
    faction: "mech",
    grade: 0,
    dmg: 5,
    aps: 1.6,
    range: 2.4,
    glyph: "드",
    desc: "빠른 연사",
  }),

  U({
    id: "m_flame",
    name: "화염방사병",
    faction: "mech",
    grade: 1,
    dmg: 10,
    aps: 2.5,
    range: 1.8,
    glyph: "화",
    splash: { r: 0.8, pct: 0.6 },
    desc: "짧은 사거리 · 넓게 태움",
  }),
  U({
    id: "m_mortar",
    name: "박격포병",
    faction: "mech",
    grade: 1,
    dmg: 45,
    aps: 0.5,
    range: 3.6,
    glyph: "박",
    splash: { r: 1, pct: 0.7 },
    desc: "느리지만 큰 폭발",
  }),
  U({
    id: "m_coil",
    name: "테슬라 코일",
    faction: "mech",
    grade: 1,
    dmg: 18,
    aps: 1.1,
    range: 2.4,
    glyph: "코",
    chain: { n: 3, pct: 0.7 },
    procs: [{ chance: 0.1, kind: "stun", sec: 0.4 }],
    desc: "3마리로 튀는 전기 · 10% 짧은 기절",
  }),

  U({
    id: "m_rail",
    name: "레일건 저격수",
    faction: "mech",
    grade: 2,
    dmg: 160,
    aps: 0.5,
    range: 4,
    glyph: "레",
    boss: 1.3,
    desc: "아주 긴 사거리 · 강한 한 방 · 보스 ×1.3",
  }),
  U({
    id: "m_missile",
    name: "미사일 포대",
    faction: "mech",
    grade: 2,
    dmg: 55,
    aps: 0.8,
    range: 3.4,
    glyph: "미",
    splash: { r: 1.2, pct: 0.8 },
    desc: "넓은 폭발",
  }),
  U({
    id: "m_scrap",
    name: "해체 드론",
    faction: "mech",
    grade: 2,
    dmg: 30,
    aps: 1,
    range: 2.6,
    glyph: "해",
    aura: { r: 2.6, shred: 25 },
    desc: "주변 적 방어 깎기 25",
  }),

  U({
    id: "m_titan",
    name: "거신 메카",
    faction: "mech",
    grade: 3,
    dmg: 380,
    aps: 0.7,
    range: 3,
    glyph: "거",
    splash: { r: 1.2, pct: 0.8 },
    ult: { every: 8, kind: "barrage", n: 3, mult: 4, name: "일제 사격" },
    desc: "범위 포격 · 8타마다 체력 많은 3마리에 ×4",
  }),
  U({
    id: "m_orbit",
    name: "궤도 포격 위성",
    faction: "mech",
    grade: 3,
    dmg: 260,
    aps: 0.6,
    range: 99,
    glyph: "궤",
    splash: { r: 1, pct: 0.6 },
    desc: "필드 어디든 포격",
  }),

  U({
    id: "m_omega",
    name: "기계신 오메가",
    faction: "mech",
    grade: 4,
    dmg: 1400,
    aps: 0.8,
    range: 3.6,
    glyph: "오",
    splash: { r: 1.4, pct: 0.9 },
    ult: { every: 6, kind: "nova", r: 2, mult: 6, name: "오메가 캐논" },
    desc: "거대한 폭발 · 6타마다 오메가 캐논 (×6)",
  }),
  U({
    id: "m_arsenal",
    name: "무한 병기고",
    faction: "mech",
    grade: 4,
    dmg: 500,
    aps: 2,
    range: 4,
    glyph: "무",
    chain: { n: 4, pct: 0.8 },
    aura: { r: 4, shred: 30 },
    desc: "4마리로 튀는 연사 · 방어 깎기 30",
  }),

  // ───────── 마도회 ─────────
  U({
    id: "a_novice",
    name: "견습 마법사",
    faction: "arcane",
    grade: 0,
    dmg: 10,
    aps: 1,
    range: 2.6,
    glyph: "마",
    desc: "기본 마법 (방어 무시)",
  }),
  U({
    id: "a_frost",
    name: "얼음 술사",
    faction: "arcane",
    grade: 0,
    dmg: 6,
    aps: 1,
    range: 2.4,
    glyph: "얼",
    procs: [{ chance: 1, kind: "slow", pct: 0.15, sec: 1.5 }],
    desc: "맞은 적 15% 둔화",
  }),
  U({
    id: "a_star",
    name: "점성술사",
    faction: "arcane",
    grade: 0,
    dmg: 8,
    aps: 0.9,
    range: 2.6,
    glyph: "점",
    onKill: { gold: 1, goldChance: 0.25 },
    desc: "처치하면 25% 확률 골드 +1",
  }),

  U({
    id: "a_bolt",
    name: "번개 술사",
    faction: "arcane",
    grade: 1,
    dmg: 18,
    aps: 1.1,
    range: 2.6,
    glyph: "번",
    chain: { n: 3, pct: 0.7 },
    desc: "3마리로 튀는 번개",
  }),
  U({
    id: "a_venom",
    name: "독술사",
    faction: "arcane",
    grade: 1,
    dmg: 10,
    aps: 1.2,
    range: 2.4,
    glyph: "독",
    procs: [{ chance: 0.2, kind: "cur", pct: 0.04 }],
    desc: "20% 확률 지금 체력 4% (보스 제외)",
  }),
  U({
    id: "a_wind",
    name: "바람 정령사",
    faction: "arcane",
    grade: 1,
    dmg: 12,
    aps: 1.4,
    range: 2.4,
    glyph: "풍",
    aura: { r: 2.4, slow: 0.15 },
    desc: "주변 적 15% 둔화",
  }),

  U({
    id: "a_chrono",
    name: "시간술사",
    faction: "arcane",
    grade: 2,
    dmg: 25,
    aps: 1,
    range: 2.6,
    glyph: "시",
    aura: { r: 2.6, slow: 0.25 },
    procs: [{ chance: 0.08, kind: "stun", sec: 1 }],
    desc: "주변 25% 둔화 · 8% 1초 기절",
  }),
  U({
    id: "a_pyro",
    name: "화염 마도사",
    faction: "arcane",
    grade: 2,
    dmg: 62,
    aps: 0.9,
    range: 2.8,
    glyph: "염",
    splash: { r: 1, pct: 0.7 },
    desc: "불꽃 범위 마법",
  }),
  U({
    id: "a_seal",
    name: "결계사",
    faction: "arcane",
    grade: 2,
    dmg: 38,
    aps: 1,
    range: 2.6,
    glyph: "결",
    procs: [{ chance: 0.15, kind: "stun", sec: 1.2 }],
    desc: "15% 1.2초 기절",
  }),

  U({
    id: "a_archmage",
    name: "대마도사",
    faction: "arcane",
    grade: 3,
    dmg: 188,
    aps: 1,
    range: 3,
    glyph: "대",
    ult: { every: 6, kind: "nova", r: 1.6, mult: 6, stun: 0.8, name: "메테오" },
    desc: "6타마다 메테오 (범위 ×6 · 기절)",
  }),
  U({
    id: "a_sage",
    name: "별의 현자",
    faction: "arcane",
    grade: 3,
    dmg: 112,
    aps: 1.2,
    range: 3,
    glyph: "현",
    aura: { r: 3, slow: 0.3 },
    procs: [{ chance: 0.2, kind: "cur", pct: 0.06 }],
    onKill: { stone: 0.02 },
    desc: "주변 30% 둔화 · 20% 지금 체력 6% · 처치 시 2% 행운석",
  }),

  U({
    id: "a_void",
    name: "공허의 마녀",
    faction: "arcane",
    grade: 4,
    dmg: 562,
    aps: 1.2,
    range: 3.2,
    glyph: "공",
    chain: { n: 5, pct: 0.8 },
    aura: { r: 3.2, slow: 0.35 },
    ult: { every: 8, kind: "nova", r: 1.6, mult: 2, stun: 2, cur: 0.1, name: "블랙홀" },
    desc: "5마리로 튐 · 35% 둔화 · 8타마다 블랙홀 (2초 기절 · 지금 체력 10%)",
  }),
  U({
    id: "a_lord",
    name: "시간의 군주",
    faction: "arcane",
    grade: 4,
    dmg: 375,
    aps: 1,
    range: 3,
    glyph: "군",
    aura: { r: 3, slow: 0.4 },
    procs: [{ chance: 0.2, kind: "cur", pct: 0.08 }],
    ult: { every: 5, kind: "nova", r: 2.5, mult: 1, stun: 1.5, name: "시간 정지" },
    desc: "40% 둔화 · 지금 체력 8% · 5타마다 시간 정지 (넓은 1.5초 기절)",
  }),

  // ───────── 히든 ─────────
  U({
    id: "h_glitchpet",
    name: "길들인 글리치",
    faction: "hidden",
    grade: 5,
    dtype: "magic",
    dmg: 40,
    aps: 1.5,
    range: 2.6,
    glyph: "?",
    chain: { n: 2, pct: 0.8 },
    procs: [{ chance: 0.1, kind: "cur", pct: 0.05 }],
    desc: "세 세력 견습생이 주운 글리치. 튀는 공격 · 지금 체력 5%",
  }),
  U({
    id: "h_debugger",
    name: "디버거 건모",
    faction: "hidden",
    grade: 5,
    dtype: "magic",
    dmg: 1200,
    aps: 1,
    range: 99,
    glyph: "건모",
    aura: { r: 99, shred: 20 },
    ult: { every: 10, kind: "delete", pct: 0.05, name: "디버그" },
    desc: "필드 전체 · 방어 깎기 20 · 10타마다 버그 하나 삭제 (보스는 최대 체력 5%)",
  }),
];

export const UNIT: Record<string, UnitDef> = Object.fromEntries(UNITS.map((u) => [u.id, u]));
export const unitIndex = (id: string) => UNITS.findIndex((u) => u.id === id);

/** 세력 · 등급별 유닛 (소환 · 합성 · 도박 · 골라 뽑기) */
export const POOL: Record<string, UnitDef[]> = {};
for (const u of UNITS) (POOL[`${u.faction}:${u.grade}`] ??= []).push(u);
export const poolOf = (f: Faction, g: Grade) => POOL[`${f}:${g}`] ?? [];

export interface Recipe {
  id: string;
  /** 재료 유닛 id (같은 게 여러 번 나오면 그만큼) */
  needs: string[];
  /** 히든: 처음 만들기 전엔 도감에 ??? */
  hidden?: boolean;
}

export const RECIPES: Recipe[] = [
  { id: "k_saint", needs: ["k_commander", "k_blade", "k_knight"] },
  { id: "k_dragoon", needs: ["k_gale", "k_hunter", "k_axe"] },
  { id: "m_omega", needs: ["m_titan", "m_missile", "m_mortar"] },
  { id: "m_arsenal", needs: ["m_orbit", "m_rail", "m_coil"] },
  { id: "a_void", needs: ["a_archmage", "a_chrono", "a_bolt"] },
  { id: "a_lord", needs: ["a_sage", "a_seal", "a_wind"] },
  {
    id: "h_glitchpet",
    needs: ["k_squire", "m_bolt", "a_novice"],
    hidden: true,
  },
  { id: "h_debugger", needs: ["k_commander", "m_titan", "a_archmage"], hidden: true },
];
export const RECIPE: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
