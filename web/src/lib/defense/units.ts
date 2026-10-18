/**
 * 픽셀 글리치 디펜스 유닛 — 세 세력(기사단 · 기계공방 · 마도회) + 히든.
 *
 * 세력 = 공격 상성 (메운디의 진동형 · 폭발형 · 일반형):
 *   기사단  물리 · 작은 적에 강함 (대형에 약함), 단일 · 치명타 · 기절
 *   기계공방 물리 · 큰 적에 강함 (소형에 약함), 범위 폭발 · 방어 깎기
 *   마도회  마법 · 크기 무관 · 방어 무시 (마법 저항엔 막힘), 둔화 · 체력 비례 · 강화가 쌈
 *
 * 등급 0 노말 · 1 레어 · 2 에픽 · 3 레전드 (여기까지 소환 · 합성) · 4 신화 (조합식) · 5 히든 (숨은 조합식, 무거움)
 *      · 6 초월 (세력마다 1종, 신화 3기 조합 — 정비소 「초월 소환」으로 해금해야 조합식이 열림)
 * 같은 유닛 3개 → 같은 세력 다음 등급 무작위. 레전드는 합성 대신 조합식으로 신화.
 *
 * 수치 단위: dmg 한 대 피해, aps 초당 공격, range 칸, 확률 0~1, sec 초.
 * 그림은 assets.ts (id 로 연결) — 여기는 성능만.
 */

export type Faction = "knight" | "mech" | "arcane" | "hidden";
export type Grade = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** 초월 등급 */
export const TRANS = 6;
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
  /** 처형: 맞은 적 체력이 최대의 이 비율 이하면 바로 쓰러뜨림 (보스 제외) */
  execute?: number;
  /** 보스 보호막 무시 */
  pierce?: boolean;
  ult?: Ult;
  /** 피해 버프: 주변 r 칸 아군 피해 +pct — 다른 버프와 달리 여러 기가 겹침 (칸마다 합, 최대 cap) · 히든 강화(hiddenFx)를 받음 */
  buff?: { r: number; pct: number; cap: number };
  /** 처치할 때: 골드 · 행운석 확률 */
  onKill?: { gold?: number; goldChance?: number; stone?: number };
  /** 판매 값 (없으면 등급 기본값 balance.ts B.sell · B.sellStones) */
  sell?: { gold: number; stones: number };
  /** 한 줄 설명 (도감 · 선택 창) */
  desc: string;
  /** 그림 없을 때 보일 글자 (1~2자) */
  glyph: string;
}

export const GRADE_NAME = ["노말", "레어", "에픽", "레전드", "신화", "히든", "초월"] as const;
export const GRADE_COLOR = [
  "#B8C0CC",
  "#4FC3F7",
  "#B388FF",
  "#FFC93C",
  "#FF5C8A",
  "#4CFFB0",
  "#FFF6D6",
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
  U({
    id: "k_aegis",
    name: "성녀 이지스",
    faction: "knight",
    grade: 4,
    dmg: 420,
    aps: 1.4,
    range: 2.8,
    glyph: "녀",
    aura: { r: 2.2, aspd: 0.25 },
    ult: { every: 8, kind: "nova", r: 1.6, mult: 4, stun: 1, name: "성역" },
    desc: "주변 아군 공격 속도 +25% · 8타마다 성역 (범위 ×4 · 1초 기절)",
  }),
  U({
    id: "k_black",
    name: "흑기사",
    faction: "knight",
    grade: 3,
    dmg: 260,
    aps: 1.1,
    range: 2.4,
    glyph: "흑",
    crit: { chance: 0.15, mult: 2 },
    execute: 0.15,
    desc: "체력 15% 이하 적 처형 (보스 제외) · 15% 치명타 ×2",
  }),
  U({
    id: "k_lion",
    name: "사자왕 레온",
    faction: "knight",
    grade: 4,
    dmg: 700,
    aps: 1.3,
    range: 2.8,
    glyph: "사",
    aura: { r: 2.4, aspd: 0.3 },
    ult: { every: 10, kind: "nova", r: 2, mult: 4, stun: 1.5, name: "사자후" },
    desc: "주변 아군 공격 속도 +30% · 10타마다 사자후 (범위 ×4 · 1.5초 기절)",
  }),
  U({
    id: "k_astra",
    name: "천공의 검제 아스트라",
    faction: "knight",
    grade: 6,
    dmg: 2200,
    aps: 1.8,
    range: 3.4,
    glyph: "검제",
    crit: { chance: 0.35, mult: 3 },
    boss: 1.4,
    aura: { r: 3, aspd: 0.2 },
    ult: { every: 8, kind: "nova", r: 9, mult: 4, name: "천공 검우" },
    desc: "초월 · 35% 치명타 ×3 · 보스 ×1.4 · 주변 공속 +20% · 8타마다 필드 전체에 검의 비 (×4)",
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
  U({
    id: "m_inferno",
    name: "인페르노 기갑",
    faction: "mech",
    grade: 4,
    dmg: 210,
    aps: 3,
    range: 2.4,
    glyph: "인",
    splash: { r: 1.2, pct: 0.8 },
    aura: { r: 2.4, shred: 25 },
    ult: { every: 12, kind: "nova", r: 2.2, mult: 5, name: "대화재" },
    desc: "짧은 사거리 화염 연사 (넓게 태움) · 방어 깎기 25 · 12타마다 대화재 (×5)",
  }),
  U({
    id: "m_chief",
    name: "공병대장",
    faction: "mech",
    grade: 3,
    dmg: 180,
    aps: 1.2,
    range: 3,
    glyph: "대",
    splash: { r: 0.8, pct: 0.5 },
    aura: { r: 2, aspd: 0.15 },
    desc: "작은 범위 폭발 · 주변 아군 공격 속도 +15%",
  }),
  U({
    id: "m_grav",
    name: "그래비톤 포",
    faction: "mech",
    grade: 4,
    dmg: 900,
    aps: 0.7,
    range: 3.6,
    glyph: "중",
    splash: { r: 1.6, pct: 0.9 },
    aura: { r: 3, slow: 0.45 },
    ult: { every: 8, kind: "nova", r: 2.2, mult: 4, stun: 0.8, name: "중력 붕괴" },
    desc: "큰 범위 폭발 · 주변 적 45% 둔화 · 8타마다 중력 붕괴 (×4 · 0.8초 기절)",
  }),
  U({
    id: "m_deus",
    name: "기계대제 데우스",
    faction: "mech",
    grade: 6,
    dmg: 3200,
    aps: 1,
    range: 99,
    glyph: "대제",
    splash: { r: 1.6, pct: 1 },
    aura: { r: 99, shred: 35 },
    ult: { every: 5, kind: "barrage", n: 8, mult: 5, name: "데우스 엑스 마키나" },
    desc: "초월 · 필드 어디든 큰 폭발 · 필드 전체 방어 깎기 35 · 5타마다 체력 많은 8마리에 ×5",
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
    aura: { r: 1.6, slow: 0.35 },
    procs: [{ chance: 0.08, kind: "stun", sec: 1 }],
    desc: "가까운 적 35% 둔화 · 8% 1초 기절",
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
  U({
    id: "a_plague",
    name: "역병의 마녀",
    faction: "arcane",
    grade: 4,
    dmg: 380,
    aps: 1.1,
    range: 3,
    glyph: "역",
    chain: { n: 3, pct: 0.8 },
    aura: { r: 3, shred: 25 },
    procs: [{ chance: 0.25, kind: "cur", pct: 0.07 }],
    ult: { every: 7, kind: "nova", r: 1.8, mult: 3, cur: 0.1, name: "역병 폭발" },
    desc: "3마리로 튐 · 방어 깎기 25 · 25% 지금 체력 7% · 7타마다 역병 폭발 (지금 체력 10%)",
  }),
  U({
    id: "a_moon",
    name: "달의 무녀",
    faction: "arcane",
    grade: 3,
    dmg: 150,
    aps: 1.1,
    range: 3,
    glyph: "달",
    chain: { n: 3, pct: 0.7 },
    procs: [{ chance: 0.5, kind: "slow", pct: 0.3, sec: 1.5 }],
    desc: "3마리로 튀는 달빛 · 50% 확률 30% 둔화",
  }),
  U({
    id: "a_dream",
    name: "꿈의 마녀 루나",
    faction: "arcane",
    grade: 4,
    dmg: 450,
    aps: 1.2,
    range: 3.2,
    glyph: "꿈",
    chain: { n: 4, pct: 0.8 },
    procs: [{ chance: 0.15, kind: "stun", sec: 2 }],
    ult: { every: 7, kind: "nova", r: 2.4, mult: 2, stun: 3, name: "깊은 잠" },
    desc: "4마리로 튐 · 15% 확률 2초 잠 · 7타마다 깊은 잠 (범위 3초 정지, 보스는 짧게)",
  }),
  U({
    id: "a_origin",
    name: "원초의 마도왕",
    faction: "arcane",
    grade: 6,
    dmg: 1800,
    aps: 1.3,
    range: 3.6,
    glyph: "원초",
    chain: { n: 6, pct: 0.85 },
    aura: { r: 3.6, slow: 0.5 },
    procs: [{ chance: 0.2, kind: "cur", pct: 0.08 }],
    ult: { every: 6, kind: "nova", r: 3, mult: 4, stun: 2, cur: 0.12, name: "원초의 별" },
    desc: "초월 · 6마리로 튐 · 주변 50% 둔화 · 지금 체력 8% · 6타마다 원초의 별 (×4 · 2초 정지 · 체력 12%)",
  }),

  // ───────── 히든 ─────────
  U({
    id: "h_debugger",
    name: "디버거 건모",
    faction: "hidden",
    grade: 5,
    dtype: "magic",
    dmg: 2600,
    aps: 1,
    range: 99,
    glyph: "건모",
    aura: { r: 99, shred: 30 },
    ult: { every: 8, kind: "delete", pct: 0.06, name: "디버그" },
    desc: "필드 전체 · 방어 깎기 30 · 8타마다 버그 하나 삭제 (보스는 최대 체력 6%)",
  }),
  U({
    id: "h_noa",
    name: "백신 노아",
    faction: "hidden",
    grade: 5,
    dtype: "magic",
    dmg: 4000,
    aps: 1.2,
    range: 99,
    glyph: "노아",
    boss: 2.5,
    pierce: true,
    aura: { r: 99, shred: 40 },
    ult: { every: 6, kind: "delete", pct: 0.08, name: "백신 주입" },
    desc: "글리치를 쫓아온 안드로이드. 필드 전체 · 보스 ×2.5 · 보호막 무시 · 방어 깎기 40 · 6타마다 정화 (보스는 최대 체력 8%)",
  }),
  // 짬처리 히든: 세 세력 레전드 하나씩 → 주변 아군 피해 버프 (여러 기면 버프가 겹침)
  U({
    id: "h_chimera",
    name: "오버플로 키메라",
    faction: "hidden",
    grade: 5,
    dtype: "magic",
    dmg: 700,
    aps: 1.2,
    range: 3.2,
    glyph: "키메",
    splash: { r: 1, pct: 0.5 },
    buff: { r: 2.2, pct: 0.12, cap: 1.2 },
    ult: { every: 10, kind: "nova", r: 1.6, mult: 3, name: "오버플로" },
    desc: "남은 레전드가 뭉친 버그 덩어리. 주변 아군 피해 +12% — 다른 버프와 달리 여러 기면 겹쳐요 (칸마다 최대 +120%) · 범위 공격 · 10타마다 오버플로 (범위 ×3)",
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
  { id: "k_aegis", needs: ["k_gale", "k_paladin", "k_twin"] },
  { id: "k_lion", needs: ["k_black", "k_hunter", "k_knight"] },
  { id: "m_omega", needs: ["m_titan", "m_missile", "m_mortar"] },
  { id: "m_arsenal", needs: ["m_orbit", "m_rail", "m_coil"] },
  { id: "m_inferno", needs: ["m_titan", "m_scrap", "m_flame"] },
  { id: "m_grav", needs: ["m_chief", "m_missile", "m_coil"] },
  { id: "a_void", needs: ["a_archmage", "a_chrono", "a_bolt"] },
  { id: "a_lord", needs: ["a_sage", "a_seal", "a_wind"] },
  { id: "a_plague", needs: ["a_sage", "a_pyro", "a_venom"] },
  { id: "a_dream", needs: ["a_moon", "a_chrono", "a_wind"] },
  // 초월 — 정비소에서 해금한 것만 (b.mods.trans)
  { id: "k_astra", needs: ["k_saint", "k_dragoon", "k_lion"] },
  { id: "m_deus", needs: ["m_omega", "m_arsenal", "m_grav"] },
  { id: "a_origin", needs: ["a_void", "a_lord", "a_dream"] },
  // 히든 — 끝까지 데려갈 무거운 조합 (@6 = 아무 초월 · @4 = 아무 신화)
  { id: "h_debugger", needs: ["k_aegis", "m_inferno", "a_plague"], hidden: true },
  { id: "h_noa", needs: ["@6", "@4", "@4"], hidden: true },
  // @3:세력 = 그 세력 아무 레전드
  { id: "h_chimera", needs: ["@3:knight", "@3:mech", "@3:arcane"], hidden: true },
];
/** @ 재료의 등급 (@4 → 4 · @3:knight → 3) */
export const needGrade = (n: string) => Number(n.slice(1).split(":")[0]);
/** 재료 이름 (@4 아무 신화 · @6 아무 초월 · @3:세력 그 세력 아무 레전드) */
export const needName = (n: string) => {
  if (n[0] !== "@") return UNIT[n]?.name ?? n;
  const f = n.split(":")[1] as Faction | undefined;
  return `아무 ${f ? FACTION_NAME[f] + " " : ""}${GRADE_NAME[needGrade(n)]}`;
};
/** 재료 칸에 이 유닛이 맞는지 */
export const needMatch = (n: string, id: string) => {
  if (n[0] !== "@") return n === id;
  const d = UNIT[id];
  const f = n.split(":")[1];
  return d.grade === needGrade(n) && d.faction !== "hidden" && (!f || d.faction === f);
};
export const RECIPE: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
