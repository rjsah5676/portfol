/*
 * 픽셀 타운 서바이버 — 숫자 · 정의 (시뮬 · 화면 · 서버 공용, "@/" import 금지)
 * 세계 단위 = 화면 픽셀 (보이는 범위 VIEW_W × VIEW_H). 시간 = 초.
 */
import { CAST, kitOf, type CastId, type Grade } from "../cast";

export const VIEW_W = 512;
export const VIEW_H = 288;
export const TPS = 60;
export const DT = 1 / TPS;
/** 한 판 (초) — 이때 새벽 보스 */
export const RUN_SEC = 600;

/* ───────────── 캐릭터 (다이스 타운 16명 — 뽑기 · 강화 그대로) ───────────── */

/** 픽셀 순찰대 (서바이버 오리지널) — 다이스 타운 명부(lib/cast)에 안 들어감 */
export type PatrolId = "bandi";
/** 다이스 타운 · 서바이버 공용 명부 (lib/cast) 의 캐릭터 id + 픽셀 순찰대 */
export type HeroId = CastId | PatrolId;
export type { Grade };

export interface HeroDef {
  id: HeroId;
  name: string;
  title: string;
  grade: Grade;
  /** 도트 시트 (public/fight/<sprite>.json — "/" 가 있으면 public/<sprite>.json) */
  sprite: string;
  /** 서바이버 안 무기 · 이펙트 색 (명부 대표색과 따로) */
  color: string;
  weapon: WeaponId;
  ult: { name: string; desc: string };
  passive: { name: string; desc: string; stat: Partial<Stats> };
  hp: number;
  speed: number;
  /** 고유 무기 각성에 필요한 패시브 */
  awaken: PassiveId;
  /** 키트 주인 (전용이면 자기 id, 빌렸으면 원래 캐릭터 id) — 필살기 · 고유 무기 판정 */
  kit: HeroId;
  /** 전용 키트 없이 원래 캐릭터 키트를 빌려 합류한 캐릭터 */
  borrowed?: boolean;
}
type Kit = Omit<HeroDef, "id" | "name" | "title" | "grade" | "sprite" | "kit" | "borrowed">;

const K = (color: string, weapon: WeaponId, ult: [string, string], passive: [string, string, Partial<Stats>], hp: number, speed: number, awaken: PassiveId): Kit => ({
  color,
  weapon,
  ult: { name: ult[0], desc: ult[1] },
  passive: { name: passive[0], desc: passive[1], stat: passive[2] },
  hp,
  speed,
  awaken,
});

/** 서바이버 키트 (무기 · 필살기 · 패시브 · 체력 · 속도 · 각성 조건) — 없는 캐릭터는 원래 캐릭터 것을 빌림 */
const KITS: Partial<Record<HeroId, Kit>> = {
  kai: K("#5fd0ff", "kick", ["돌풍 돌진", "바라보는 쪽으로 돌진하며 길 위의 적을 날려요"], ["바람 걸음", "이동 속도 +10%", { speed: 0.1 }], 110, 74, "speed"),
  igna: K("#ff7a3d", "fireball", ["불바다", "화면 전체가 4초 동안 불타요"], ["타오르는 마력", "피해 +10%", { might: 0.1 }], 90, 70, "might"),
  lily: K("#7ad7ff", "umbrella", ["소나기", "화면 전체 적이 느려지고 물방울에 맞아요"], ["튼튼 우산", "받는 피해 −1", { armor: 1 }], 100, 70, "maxHp"),
  ivan: K("#ff5a5a", "punch", ["정신 교육", "주변 적을 3초 동안 기절시키고 크게 때려요"], ["단련된 몸", "최대 체력 +30", { maxHp: 30 }], 130, 66, "area"),
  soyoung: K("#ff7fb0", "whip", ["앞으로 나와!", "화면 속 적을 전부 끌어와 내려쳐요"], ["매의 눈", "행운 +2", { luck: 2 }], 100, 70, "luck"),
  zena: K("#ffe14a", "lance", ["전광석화", "번개처럼 세 번 돌진해요"], ["번개 걸음", "쿨타임 −8%", { cooldown: 0.08 }], 95, 76, "cooldown"),
  "ivan-marine": K("#7fb06b", "grenade", ["포격 지원", "화면 곳곳에 포탄이 떨어져요"], ["강철 체력", "초당 회복 +0.4", { regen: 0.4 }], 120, 66, "area"),
  "igna-student": K("#ff9a4d", "dice6", ["정답은 6!", "6초 동안 모든 공격이 치명타"], ["벼락치기", "경험치 +10%", { growth: 0.1 }], 90, 70, "luck"),
  "lily-hood": K("#e2405e", "apple", ["늑대 사냥", "늑대 세 마리가 적을 물어뜯으며 달려요"], ["사냥꾼 감", "자석 +40%", { magnet: 0.4 }], 100, 72, "magnet"),
  toto: K("#ffd86b", "parcel", ["보름달 배송", "거대한 달빛 택배가 화면 곳곳에 떨어져요"], ["덤 서비스", "행운 +2", { luck: 2 }], 95, 74, "amount"),
  mirage: K("#b48cff", "cards", ["분신 마술", "8초 동안 모든 무기가 두 배 빠르게 쏴요"], ["트릭 카드", "투사체 +1", { amount: 1 }], 90, 72, "amount"),
  lolo: K("#ff5fa0", "circus", ["대공연", "서커스 공 12개가 화면을 휩쓸어요"], ["무대 체질", "범위 +15%", { area: 0.15 }], 100, 70, "area"),
  mongle: K("#d8d4ff", "sleep", ["꿈나라", "화면 속 적이 4초 동안 잠들고 더 아프게 맞아요"], ["포근한 털", "받는 피해 −2", { armor: 2 }], 130, 64, "maxHp"),
  "ur-dice": K("#ffd23a", "roll", ["잭팟 롤", "거대 주사위! 6이 나오면 화면 전멸"], ["행운 요정", "행운 +4", { luck: 4 }], 100, 72, "luck"),
  "ur-moa": K("#ffc94a", "coins", ["돈다발 비", "화면 전체에 금화가 쏟아져 때리고 코인을 뿌려요"], ["금고 고양이", "줍는 범위 +30% · 피해 +10%", { magnet: 0.3, might: 0.1 }], 105, 72, "magnet"),
  "ur-forte": K("#7ff0d8", "notes", ["앙코르", "6초 동안 모든 무기 쿨타임이 확 줄어요"], ["리듬감", "쿨타임 −10%", { cooldown: 0.1 }], 100, 72, "cooldown"),
  // 픽셀 순찰대
  bandi: K("#ffd27a", "lantern", ["등대", "8초 동안 빛줄기 두 갈래가 주변을 돌며 태워요"], ["반딧불 자석", "줍는 범위 +30%", { magnet: 0.3 }], 100, 72, "area"),
};

/** 픽셀 순찰대 명부 (정체성) — 키트는 위 KITS */
const PATROL: { id: PatrolId; name: string; title: string; grade: Grade; sprite: string }[] = [
  { id: "bandi", name: "반디", title: "랜턴 순찰대원", grade: "R", sprite: "patrol/hero/bandi" },
];

export const HEROES = Object.fromEntries([
  ...CAST.filter((c) => c.on).flatMap((c) => {
    const k = kitOf(KITS, c);
    return k ? [[c.id, { ...k, id: c.id as HeroId, name: c.name, title: c.title, grade: c.grade, sprite: c.sprite, kit: (KITS[c.id as HeroId] ? c.id : c.base) as HeroId, ...(!KITS[c.id as HeroId] && { borrowed: true }) } satisfies HeroDef]] : [];
  }),
  ...PATROL.map((c) => [c.id, { ...KITS[c.id]!, ...c, kit: c.id } satisfies HeroDef]),
]) as Record<HeroId, HeroDef>;
/** 서바이버(다이스 타운 명부) 캐릭터 — 픽셀 순찰대는 PATROL_IDS */
export const HERO_IDS = Object.keys(HEROES).filter((h) => !PATROL.some((c) => c.id === h)) as HeroId[];
export const PATROL_IDS = PATROL.map((c) => c.id);
/** 처음부터 열린 캐릭터 (나머지는 다이스 타운 뽑기) */
export const FREE_HEROES: HeroId[] = ["kai", "igna", "lily", "ivan"];
/** 등급 바닥 + 강화 레벨 → 능력치 보너스 (다이스 타운 power() 와 같은 눈금) */
export const GRADE_FLOOR: Record<Grade, number> = { R: 0, SR: 5, SSR: 10, UR: 15 };
export const powerBonus = (grade: Grade, lv: number): Partial<Stats> => {
  const pw = GRADE_FLOOR[grade] + lv;
  return { might: pw * 0.015, maxHp: pw * 2 };
};

/* ───────────── 능력치 (패시브 · 캐릭터 · 영구 강화가 더함) ───────────── */

export interface Stats {
  /** 피해 배율 (+0.1 = +10%) */
  might: number;
  /** 쿨타임 감소 (+0.08 = −8%) */
  cooldown: number;
  /** 범위 배율 */
  area: number;
  /** 투사체 개수 + */
  amount: number;
  /** 이동 속도 배율 */
  speed: number;
  /** 최대 체력 + */
  maxHp: number;
  /** 초당 회복 */
  regen: number;
  /** 받는 피해 − */
  armor: number;
  /** 자석 범위 배율 */
  magnet: number;
  /** 행운 (크리 · 카드 등급 · 상자) */
  luck: number;
  /** 경험치 배율 */
  growth: number;
  /** 투사체 속도 배율 */
  pspeed: number;
  /** 지속 시간 배율 */
  duration: number;
}
export const BASE_STATS: Stats = { might: 0, cooldown: 0, area: 0, amount: 0, speed: 0, maxHp: 0, regen: 0, armor: 0, magnet: 0, luck: 0, growth: 0, pspeed: 0, duration: 0 };

/* ───────────── 무기 ───────────── */

export type WeaponId =
  // 고유 (캐릭터 시작 무기)
  | "kick"
  | "fireball"
  | "umbrella"
  | "parcel"
  | "punch"
  | "whip"
  | "lance"
  | "grenade"
  | "dice6"
  | "apple"
  | "cards"
  | "circus"
  | "sleep"
  | "roll"
  | "coins"
  | "notes"
  // 픽셀 순찰대 고유
  | "lantern"
  // 공용
  | "shuriken"
  | "boomerang"
  | "bolt"
  | "thorns"
  | "missile"
  | "ball"
  // 합체
  | "blades"
  | "pinball"
  // 진화 (공용 무기 Lv5 + 짝 패시브)
  | "gale"
  | "cyclone"
  | "judgment"
  | "rose"
  | "barrage"
  | "rainbow"
  // 순찰대 새 무기 진화 (순찰대 판에서만)
  | "downpour"
  | "cluster"
  | "symphony"
  | "goldrain";

export type Pattern = "spin" | "nearest" | "orbit" | "drop" | "facing" | "boomerang" | "strike" | "aura" | "homing" | "bounce" | "cone" | "whip" | "spread" | "pulse";

/** 레벨마다 값 (index 0 = Lv1) */
export interface WeaponLv {
  dmg: number;
  /** 쿨타임 (초) */
  cd: number;
  /** 한 번에 몇 개 */
  n: number;
  /** 크기 (반지름 · 폭) */
  size: number;
  /** 투사체 속도 */
  spd: number;
  /** 관통 (0 = 하나 맞으면 사라짐, 99 = 무한) */
  pierce: number;
  /** 지속 (초) */
  dur: number;
  /** 넉백 */
  kb: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** 고유 무기 주인 (없으면 공용) */
  owner?: HeroId;
  /** 합체 재료 */
  fuse?: [WeaponId, WeaponId];
  /** 진화: [바탕 무기, 짝 패시브] */
  evo?: [WeaponId, PassiveId];
  pattern: Pattern;
  color: string;
  /** 레벨업 카드 설명 (Lv1 = 새로 얻을 때) */
  desc: string[];
  lv: WeaponLv[];
  /** 특수: dice = 눈(1~6)만큼 피해 배수 · six = 6분의 1로 폭발 · sleep = 닿으면 재움 · coin = 처치 시 코인 */
  fx?: "dice" | "six" | "sleep" | "coin";
}

const L = (dmg: number, cd: number, n: number, size: number, spd: number, pierce: number, dur: number, kb = 0): WeaponLv => ({ dmg, cd, n, size, spd, pierce, dur, kb });

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  kick: {
    id: "kick",
    name: "회오리 발차기",
    owner: "kai",
    pattern: "spin",
    color: "#9fe8ff",
    desc: ["주변을 한 바퀴 휩쓸어요", "피해 +4", "범위 +15%", "쿨타임 −0.2초", "피해 +6 · 두 번 회전"],
    lv: [L(10, 1.3, 1, 40, 0, 99, 0.22, 60), L(14, 1.3, 1, 40, 0, 99, 0.22, 60), L(14, 1.3, 1, 46, 0, 99, 0.22, 70), L(14, 1.1, 1, 46, 0, 99, 0.22, 70), L(20, 1.1, 2, 50, 0, 99, 0.22, 80)],
  },
  fireball: {
    id: "fireball",
    name: "화염구",
    owner: "igna",
    pattern: "nearest",
    color: "#ff8a3d",
    desc: ["가까운 적에게 날아가 터져요", "+1개", "폭발 범위 +25%", "피해 +6", "+1개 · 피해 +6"],
    lv: [L(12, 1.15, 1, 18, 170, 0, 2, 20), L(12, 1.15, 2, 18, 170, 0, 2, 20), L(12, 1.15, 2, 23, 170, 0, 2, 20), L(18, 1.05, 2, 23, 180, 0, 2, 25), L(24, 1.0, 3, 25, 190, 0, 2, 25)],
  },
  umbrella: {
    id: "umbrella",
    name: "물방울 우산",
    owner: "lily",
    pattern: "orbit",
    color: "#7ad7ff",
    desc: ["우산이 주위를 돌며 막아요", "+1개", "피해 +4 · 반지름 +", "+1개", "+1개 · 더 빨리 회전"],
    lv: [L(8, 0, 2, 40, 3.2, 99, 0, 40), L(8, 0, 3, 40, 3.2, 99, 0, 40), L(12, 0, 3, 46, 3.4, 99, 0, 45), L(12, 0, 4, 46, 3.6, 99, 0, 45), L(14, 0, 5, 50, 4.4, 99, 0, 50)],
  },
  parcel: {
    id: "parcel",
    name: "달빛 택배",
    owner: "toto",
    pattern: "drop",
    color: "#ffe17a",
    desc: ["적 위로 택배가 떨어져 터져요", "+1개", "피해 +8", "폭발 범위 +25%", "+2개 · 더 빨리"],
    lv: [L(18, 1.7, 2, 22, 0, 99, 0.55, 30), L(18, 1.7, 3, 22, 0, 99, 0.55, 30), L(26, 1.7, 3, 22, 0, 99, 0.55, 30), L(26, 1.6, 3, 28, 0, 99, 0.5, 35), L(30, 1.35, 5, 30, 0, 99, 0.45, 40)],
  },
  punch: {
    id: "punch",
    name: "정권 찌르기",
    owner: "ivan",
    pattern: "cone",
    color: "#ff8a6b",
    desc: ["앞쪽으로 충격파 주먹 (강한 넉백)", "피해 +6", "범위 +20%", "쿨타임 −0.2초", "피해 +10 · 두 번 연타"],
    lv: [L(16, 1.25, 1, 46, 0, 99, 0.2, 110), L(22, 1.25, 1, 46, 0, 99, 0.2, 110), L(22, 1.25, 1, 55, 0, 99, 0.2, 120), L(22, 1.05, 1, 55, 0, 99, 0.2, 120), L(32, 1.05, 2, 58, 0, 99, 0.2, 130)],
  },
  whip: {
    id: "whip",
    name: "가죽 채찍",
    owner: "soyoung",
    pattern: "whip",
    color: "#ff9cc8",
    desc: ["좌우로 길게 후려쳐요", "양쪽 동시에", "피해 +6", "길이 +20%", "피해 +8 · 더 빨리"],
    lv: [L(14, 1.2, 1, 78, 0, 99, 0.18, 40), L(14, 1.2, 2, 78, 0, 99, 0.18, 40), L(20, 1.2, 2, 78, 0, 99, 0.18, 45), L(20, 1.2, 2, 94, 0, 99, 0.18, 45), L(28, 0.95, 2, 98, 0, 99, 0.18, 50)],
  },
  lance: {
    id: "lance",
    name: "번개 창",
    owner: "zena",
    pattern: "facing",
    color: "#ffe14a",
    desc: ["바라보는 쪽으로 꿰뚫는 번개 창", "+1개", "피해 +8", "+1개", "피해 +10 · 더 빨리"],
    lv: [L(20, 1.1, 1, 7, 360, 99, 0.9, 25), L(20, 1.1, 2, 7, 360, 99, 0.9, 25), L(28, 1.1, 2, 7, 360, 99, 0.9, 25), L(28, 1.1, 3, 7, 380, 99, 0.9, 30), L(38, 0.85, 3, 8, 400, 99, 0.9, 30)],
  },
  grenade: {
    id: "grenade",
    name: "수류탄",
    owner: "ivan-marine",
    pattern: "drop",
    color: "#a8c060",
    desc: ["적 무리에 수류탄을 던져요", "+1개", "폭발 범위 +25%", "피해 +10", "+2개"],
    lv: [L(22, 1.6, 1, 26, 0, 99, 0.7, 50), L(22, 1.6, 2, 26, 0, 99, 0.7, 50), L(22, 1.6, 2, 32, 0, 99, 0.7, 55), L(32, 1.5, 2, 32, 0, 99, 0.7, 55), L(34, 1.3, 4, 34, 0, 99, 0.6, 60)],
  },
  dice6: {
    id: "dice6",
    name: "6면 주사위",
    owner: "igna-student",
    pattern: "bounce",
    color: "#fff2c0",
    fx: "six",
    desc: ["튕겨 다니는 주사위 — 6이 나오면 펑!", "+1개", "피해 +5", "+1개 · 더 오래", "+1개 · 폭발 범위 +"],
    lv: [L(12, 2.6, 2, 7, 190, 99, 3, 15), L(12, 2.6, 3, 7, 190, 99, 3, 15), L(17, 2.6, 3, 7, 200, 99, 3, 15), L(17, 2.4, 4, 7, 210, 99, 4, 18), L(20, 2.2, 5, 8, 220, 99, 4, 20)],
  },
  apple: {
    id: "apple",
    name: "사과 바구니",
    owner: "lily-hood",
    pattern: "boomerang",
    color: "#ff5a5a",
    desc: ["사과 바구니를 던졌다 받아요", "+1개", "피해 +6 · 크기 +", "+1개", "피해 +8 · 더 멀리"],
    lv: [L(13, 1.5, 1, 9, 210, 99, 1.4, 25), L(13, 1.5, 2, 9, 210, 99, 1.4, 25), L(19, 1.5, 2, 11, 210, 99, 1.4, 30), L(19, 1.4, 3, 11, 220, 99, 1.4, 30), L(27, 1.3, 3, 12, 250, 99, 1.6, 35)],
  },
  cards: {
    id: "cards",
    name: "트릭 카드",
    owner: "mirage",
    pattern: "homing",
    color: "#c9a6ff",
    desc: ["적을 쫓아가는 마술 카드", "+1개", "피해 +6", "+2개", "관통 +2 · 더 빨리"],
    lv: [L(12, 1.0, 2, 6, 210, 0, 2.4, 10), L(12, 1.0, 3, 6, 210, 0, 2.4, 10), L(18, 1.0, 3, 6, 220, 0, 2.4, 10), L(18, 1.0, 5, 6, 230, 0, 2.4, 12), L(18, 0.8, 5, 6, 260, 2, 2.4, 12)],
  },
  circus: {
    id: "circus",
    name: "서커스 공",
    owner: "lolo",
    pattern: "bounce",
    color: "#ff5fa0",
    desc: ["크고 무거운 서커스 공이 튕겨 다녀요", "+1개", "피해 +8 · 크기 +", "+1개 · 더 오래", "+1개 · 넉백 +"],
    lv: [L(16, 3.0, 1, 11, 160, 99, 4, 50), L(16, 3.0, 2, 11, 160, 99, 4, 50), L(24, 3.0, 2, 13, 160, 99, 4, 55), L(24, 2.8, 3, 13, 170, 99, 5, 55), L(28, 2.6, 4, 14, 180, 99, 5, 70)],
  },
  sleep: {
    id: "sleep",
    name: "수면 구름",
    owner: "mongle",
    pattern: "aura",
    color: "#d8d4ff",
    fx: "sleep",
    desc: ["주변 적을 느리게 재우며 피해", "범위 +15%", "피해 +3", "범위 +15% · 더 자주", "피해 +5 · 깊은 잠"],
    lv: [L(6, 0.55, 1, 36, 0, 99, 0, 0), L(6, 0.55, 1, 41, 0, 99, 0, 0), L(9, 0.55, 1, 41, 0, 99, 0, 0), L(9, 0.45, 1, 47, 0, 99, 0, 0), L(14, 0.45, 1, 50, 0, 99, 0, 0)],
  },
  roll: {
    id: "roll",
    name: "주사위 굴림",
    owner: "ur-dice",
    pattern: "nearest",
    color: "#ffd23a",
    fx: "dice",
    desc: ["주사위를 던져요 — 나온 눈만큼 피해 ×", "+1개", "피해 +4", "+1개 · 폭발 범위 +", "+1개 · 더 빨리"],
    lv: [L(8, 1.0, 1, 14, 200, 0, 2, 20), L(8, 1.0, 2, 14, 200, 0, 2, 20), L(12, 1.0, 2, 14, 200, 0, 2, 20), L(12, 1.0, 3, 18, 210, 0, 2, 25), L(14, 0.8, 4, 18, 220, 0, 2, 25)],
  },
  coins: {
    id: "coins",
    name: "금화 샷건",
    owner: "ur-moa",
    pattern: "spread",
    color: "#ffd23a",
    fx: "coin",
    desc: ["앞으로 금화를 흩뿌려요 (처치 시 코인)", "+2개", "피해 +5", "관통 +1", "+3개 · 더 빨리"],
    lv: [L(10, 1.0, 4, 5, 260, 0, 0.5, 15), L(10, 1.0, 6, 5, 260, 0, 0.5, 15), L(15, 1.0, 6, 5, 270, 0, 0.5, 15), L(15, 1.0, 6, 5, 280, 1, 0.55, 18), L(17, 0.8, 9, 5, 300, 1, 0.6, 20)],
  },
  notes: {
    id: "notes",
    name: "음표 파동",
    owner: "ur-forte",
    pattern: "pulse",
    color: "#7ff0d8",
    desc: ["박자마다 퍼져 나가는 음파", "범위 +15%", "피해 +6", "한 박자 더", "피해 +8 · 범위 +"],
    lv: [L(14, 1.4, 1, 80, 0, 99, 0.5, 40), L(14, 1.4, 1, 92, 0, 99, 0.5, 40), L(20, 1.4, 1, 92, 0, 99, 0.5, 45), L(20, 1.4, 2, 92, 0, 99, 0.5, 45), L(28, 1.2, 2, 104, 0, 99, 0.5, 50)],
  },
  lantern: {
    id: "lantern",
    name: "랜턴 빛살",
    owner: "bandi",
    pattern: "cone",
    color: "#ffd27a",
    desc: ["앞쪽을 비추는 빛살 — 맞은 자리에 불씨가 남아요", "피해 +4", "사거리 +15%", "쿨타임 −0.15초", "피해 +6 · 두 번 비춤"],
    lv: [L(11, 1.0, 1, 68, 0, 99, 0.24, 25), L(15, 1.0, 1, 68, 0, 99, 0.24, 25), L(15, 1.0, 1, 78, 0, 99, 0.24, 28), L(15, 0.85, 1, 78, 0, 99, 0.24, 28), L(21, 0.85, 2, 82, 0, 99, 0.24, 32)],
  },
  shuriken: {
    id: "shuriken",
    name: "수리검",
    pattern: "facing",
    color: "#e6ecff",
    desc: ["바라보는 쪽으로 연달아 던져요", "+1개", "관통 +1", "피해 +5", "+2개 · 더 빨리"],
    lv: [L(9, 0.85, 1, 6, 260, 0, 1.2, 8), L(9, 0.85, 2, 6, 260, 0, 1.2, 8), L(9, 0.85, 2, 6, 260, 1, 1.2, 8), L(14, 0.8, 2, 6, 280, 1, 1.2, 8), L(14, 0.6, 4, 6, 300, 2, 1.2, 10)],
  },
  boomerang: {
    id: "boomerang",
    name: "부메랑",
    pattern: "boomerang",
    color: "#ffb84d",
    desc: ["던지면 돌아와요 (관통)", "+1개", "피해 +6 · 크기 +", "+1개", "피해 +8 · 더 멀리"],
    lv: [L(12, 1.6, 1, 8, 200, 99, 1.4, 25), L(12, 1.6, 2, 8, 200, 99, 1.4, 25), L(18, 1.6, 2, 10, 200, 99, 1.4, 30), L(18, 1.5, 3, 10, 210, 99, 1.4, 30), L(26, 1.4, 3, 11, 240, 99, 1.6, 35)],
  },
  bolt: {
    id: "bolt",
    name: "낙뢰",
    pattern: "strike",
    color: "#c8a6ff",
    desc: ["화면 속 적에게 번개가 꽂혀요", "+1개", "피해 +10", "+1개 · 범위 +", "+2개 · 더 빨리"],
    lv: [L(22, 2.0, 1, 14, 0, 99, 0, 0), L(22, 2.0, 2, 14, 0, 99, 0, 0), L(32, 2.0, 2, 14, 0, 99, 0, 0), L(32, 1.8, 3, 18, 0, 99, 0, 0), L(36, 1.5, 5, 20, 0, 99, 0, 0)],
  },
  thorns: {
    id: "thorns",
    name: "가시 오라",
    pattern: "aura",
    color: "#7dff9a",
    // 가시 돋음: 일정 간격으로 가시가 사방으로 확 솟아 찌르고 밀어냄 (예전: 0.5초마다 반지름 30 안에 조금씩 — 닿을 일이 거의 없어 밋밋했음)
    desc: ["주기적으로 가시가 사방으로 솟아 찌르고 밀어내요", "범위 +15%", "피해 +6", "범위 +15% · 더 자주", "피해 +6 · 적을 느리게"],
    lv: [L(12, 1.0, 1, 48, 0, 99, 0, 30), L(12, 1.0, 1, 56, 0, 99, 0, 30), L(18, 1.0, 1, 56, 0, 99, 0, 32), L(18, 0.85, 1, 64, 0, 99, 0, 36), L(24, 0.8, 1, 68, 0, 99, 0, 40)],
  },
  missile: {
    id: "missile",
    name: "유도 미사일",
    pattern: "homing",
    color: "#ff6b8a",
    desc: ["적을 따라가 터지는 미사일", "+1개", "피해 +8", "폭발 범위 +30%", "+2개"],
    lv: [L(16, 1.4, 1, 14, 150, 0, 3, 15), L(16, 1.4, 2, 14, 150, 0, 3, 15), L(24, 1.4, 2, 14, 160, 0, 3, 15), L(24, 1.3, 2, 18, 170, 0, 3, 20), L(26, 1.2, 4, 18, 180, 0, 3, 20)],
  },
  ball: {
    id: "ball",
    name: "튕기는 공",
    pattern: "bounce",
    color: "#ff9cf0",
    desc: ["화면 벽을 튕겨 다니는 공", "+1개", "피해 +5 · 더 오래", "+1개", "+1개 · 크기 +"],
    lv: [L(10, 3.0, 1, 7, 170, 99, 3, 15), L(10, 3.0, 2, 7, 170, 99, 3, 15), L(15, 3.0, 2, 7, 180, 99, 4, 15), L(15, 2.8, 3, 7, 190, 99, 4, 18), L(18, 2.6, 4, 9, 200, 99, 4.5, 20)],
  },
  /* 순찰대 새 무기 진화 — 순찰대 판에서만 (PATROL_EVOLUTIONS) */
  downpour: {
    id: "downpour",
    name: "폭우 우산",
    evo: ["umbrella", "maxHp"],
    pattern: "orbit",
    color: "#5fb8ff",
    desc: ["물방울 우산 진화! 큰 우산 6개 · 주변 적에게 빗방울이 쏟아지고 맞은 적은 느려져요"],
    lv: [L(20, 0.5, 6, 58, 4.8, 99, 0, 55)],
  },
  cluster: {
    id: "cluster",
    name: "집속 수류탄",
    evo: ["grenade", "area"],
    pattern: "drop",
    color: "#ff9c3a",
    desc: ["수류탄 진화! 터지면 작은 폭탄 셋이 둘레에서 한 번 더 터져요"],
    lv: [L(46, 1.2, 5, 40, 0, 99, 0.6, 60)],
  },
  symphony: {
    id: "symphony",
    name: "교향곡",
    evo: ["notes", "cooldown"],
    pattern: "pulse",
    color: "#ffd27a",
    desc: ["음표 파동 진화! 한 박자에 세 겹 파동 · 맞은 적은 잠깐 멈칫해요"],
    lv: [L(40, 1.0, 3, 124, 0, 99, 0.5, 50)],
  },
  goldrain: {
    id: "goldrain",
    name: "황금 소나기",
    evo: ["coins", "luck"],
    pattern: "spread",
    color: "#ffd23a",
    fx: "coin",
    desc: ["금화 샷건 진화! 금화 12개 · 관통 · 처치하면 코인이 더 잘 나와요"],
    lv: [L(24, 0.6, 12, 6, 320, 2, 0.65, 20)],
  },
  blades: {
    id: "blades",
    name: "천 개의 칼날",
    fuse: ["shuriken", "missile"],
    pattern: "homing",
    color: "#ffe36b",
    desc: ["수리검 + 미사일 합체! 칼날이 끝없이 적을 쫓아요"],
    lv: [L(26, 0.18, 2, 9, 300, 2, 2.2, 10)],
  },
  pinball: {
    id: "pinball",
    name: "핀볼 폭풍",
    fuse: ["boomerang", "ball"],
    pattern: "bounce",
    color: "#7bf6ff",
    desc: ["부메랑 + 공 합체! 거대한 공들이 화면을 휩쓸어요"],
    lv: [L(30, 1.6, 6, 14, 260, 99, 6, 40)],
  },
  gale: {
    id: "gale",
    name: "질풍 수리검",
    evo: ["shuriken", "speed"],
    pattern: "facing",
    color: "#bff2ff",
    desc: ["수리검 진화! 쉴 새 없이 꿰뚫는 수리검 폭풍"],
    lv: [L(22, 0.42, 6, 7, 340, 4, 1.3, 10)],
  },
  cyclone: {
    id: "cyclone",
    name: "회오리 부메랑",
    evo: ["boomerang", "area"],
    pattern: "boomerang",
    color: "#ffd07a",
    desc: ["부메랑 진화! 거대한 부메랑이 적을 휘감아요"],
    lv: [L(34, 1.2, 4, 16, 250, 99, 1.8, 45)],
  },
  judgment: {
    id: "judgment",
    name: "천둥 심판",
    evo: ["bolt", "luck"],
    pattern: "strike",
    color: "#e0c8ff",
    desc: ["낙뢰 진화! 하늘이 화면을 번개로 덮어요"],
    lv: [L(48, 1.1, 8, 26, 0, 99, 0, 20)],
  },
  rose: {
    id: "rose",
    name: "장미 정원",
    evo: ["thorns", "maxHp"],
    pattern: "aura",
    color: "#ff7fb0",
    desc: ["가시 오라 진화! 넓은 장미 덤불 · 적을 묶고 체력을 채워요"],
    lv: [L(18, 0.32, 1, 62, 0, 99, 0, 0)],
  },
  barrage: {
    id: "barrage",
    name: "융단 폭격",
    evo: ["missile", "might"],
    pattern: "homing",
    color: "#ff9a6b",
    desc: ["미사일 진화! 미사일 떼가 쏟아져 연달아 터져요"],
    lv: [L(34, 0.9, 6, 26, 200, 0, 3, 25)],
  },
  rainbow: {
    id: "rainbow",
    name: "무지개 공",
    evo: ["ball", "cooldown"],
    pattern: "bounce",
    color: "#ffffff",
    desc: ["공 진화! 무지개 공이 끝없이 튕겨요"],
    lv: [L(30, 2.2, 6, 10, 230, 99, 5, 25)],
  },
};
export const SHARED_WEAPONS: WeaponId[] = ["shuriken", "boomerang", "bolt", "thorns", "missile", "ball"];
/** 처음부터 레벨업 카드에 나오는 공용 무기 (나머지는 퀘스트로 해금) */
export const BASE_WEAPONS: WeaponId[] = ["shuriken", "boomerang", "bolt", "thorns"];
export const FUSIONS: WeaponId[] = ["blades", "pinball"];
export const EVOLUTIONS: WeaponId[] = ["gale", "cyclone", "judgment", "rose", "barrage", "rainbow"];
/** 순찰대 새 무기 진화 (순찰대 판에서만 — 서바이버 캐릭터 무기는 각성이 따로 있음) */
export const PATROL_EVOLUTIONS: WeaponId[] = ["downpour", "cluster", "symphony", "goldrain"];
/** 고유 무기 각성: Lv5 + 이 패시브 → 상자 · 카드에서 각성 (피해 ×1.6 · +1개 · 크기 ×1.2) */
export const AWAKEN_NEED = Object.fromEntries((Object.keys(HEROES) as HeroId[]).map((h) => [h, HEROES[h].awaken])) as Record<HeroId, PassiveId>;
export const MAX_WEAPONS = 6;
export const MAX_PASSIVES = 6;

/* ───────────── 패시브 ───────────── */

export type PassiveId = "might" | "cooldown" | "area" | "amount" | "speed" | "maxHp" | "magnet" | "luck";

export interface PassiveDef {
  id: PassiveId;
  name: string;
  /** 레벨당 더하는 값 */
  per: Partial<Stats>;
  desc: string;
  color: string;
  max: number;
}
export const PASSIVES: Record<PassiveId, PassiveDef> = {
  might: { id: "might", name: "힘의 장갑", per: { might: 0.1 }, desc: "피해 +10%", color: "#ff6b6b", max: 5 },
  cooldown: { id: "cooldown", name: "모래시계", per: { cooldown: 0.08 }, desc: "쿨타임 −8%", color: "#7ad7ff", max: 5 },
  area: { id: "area", name: "확성기", per: { area: 0.1 }, desc: "범위 +10%", color: "#b48cff", max: 5 },
  amount: { id: "amount", name: "복제 주사위", per: { amount: 1 }, desc: "투사체 +1", color: "#ffd23a", max: 2 },
  speed: { id: "speed", name: "날개 신발", per: { speed: 0.1 }, desc: "이동 속도 +10%", color: "#7dff9a", max: 5 },
  maxHp: { id: "maxHp", name: "하트 사탕", per: { maxHp: 20, regen: 0.2 }, desc: "최대 체력 +20 · 회복 +0.2/초", color: "#ff7fb0", max: 5 },
  magnet: { id: "magnet", name: "자석", per: { magnet: 0.3 }, desc: "줍는 범위 +30%", color: "#9fb6ff", max: 5 },
  luck: { id: "luck", name: "네잎 클로버", per: { luck: 1 }, desc: "행운 +1 (크리 · 카드 등급 · 상자)", color: "#5fe08a", max: 5 },
};
export const PASSIVE_IDS = Object.keys(PASSIVES) as PassiveId[];

/* ───────────── 적 ───────────── */

export type EnemyKind =
  | "bat"
  | "slime"
  | "ghost"
  | "skull"
  | "mush"
  | "golem"
  | "boss_jelly"
  | "boss_clock"
  // 시계탑 광장
  | "mouse"
  | "tin"
  | "cuckoo"
  | "gear"
  | "hourglass"
  | "boss_cuckoo"
  | "boss_tower"
  // 순찰대 특수 판: 맞으면 금화를 흘리며 도망치는 도깨비
  | "goblin";

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  /** 몸 반지름 (충돌) */
  r: number;
  xp: number;
  /** 넉백 저항 0~1 */
  heavy: number;
  /** 다른 적을 밀지 않음 (유령) */
  ghost?: boolean;
  boss?: boolean;
  /** 움직임 버릇: 흔들 (박쥐) · 곧장 질주 (태엽 쥐) · 급강하 (뻐꾸기) */
  move?: "wobble" | "dart" | "dive" | "flee";
}
export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  bat: { kind: "bat", name: "밤박쥐", hp: 5, speed: 46, dmg: 3, r: 5, xp: 1, heavy: 0, move: "wobble" },
  slime: { kind: "slime", name: "꿈 슬라임", hp: 13, speed: 26, dmg: 5, r: 7, xp: 1, heavy: 0.2 },
  ghost: { kind: "ghost", name: "장난 유령", hp: 20, speed: 36, dmg: 7, r: 7, xp: 2, heavy: 0.3, ghost: true },
  skull: { kind: "skull", name: "해골 병정", hp: 42, speed: 30, dmg: 9, r: 8, xp: 3, heavy: 0.4 },
  mush: { kind: "mush", name: "독버섯", hp: 70, speed: 24, dmg: 11, r: 9, xp: 4, heavy: 0.5 },
  golem: { kind: "golem", name: "돌골렘", hp: 160, speed: 22, dmg: 15, r: 12, xp: 7, heavy: 0.85 },
  /** 5분: 밤마다 분수대에서 부풀어 오르는 젤리 왕 */
  boss_jelly: { kind: "boss_jelly", name: "킹 젤리", hp: 2600, speed: 32, dmg: 20, r: 18, xp: 120, heavy: 1, boss: true },
  /** 10분: 마을 시계탑에 깃든 자정의 문지기 — 쓰러뜨리면 새벽이 와요 */
  boss_clock: { kind: "boss_clock", name: "자정의 시계지기", hp: 9000, speed: 36, dmg: 26, r: 18, xp: 300, heavy: 1, boss: true },
  /* 시계탑 광장 — 시계지기가 쓰러지자 멈춰 버린 광장의 태엽 장난감들 */
  mouse: { kind: "mouse", name: "태엽 쥐", hp: 7, speed: 50, dmg: 3, r: 5, xp: 1, heavy: 0, move: "dart" },
  tin: { kind: "tin", name: "양철 병정", hp: 46, speed: 29, dmg: 9, r: 8, xp: 3, heavy: 0.45 },
  cuckoo: { kind: "cuckoo", name: "고장 난 뻐꾸기", hp: 24, speed: 36, dmg: 6, r: 6, xp: 2, heavy: 0.2, ghost: true, move: "dive" },
  gear: { kind: "gear", name: "톱니 굴렁쇠", hp: 85, speed: 27, dmg: 12, r: 9, xp: 4, heavy: 0.55 },
  hourglass: { kind: "hourglass", name: "모래시계 골렘", hp: 190, speed: 21, dmg: 16, r: 12, xp: 8, heavy: 0.9 },
  /** 5분: 시계탑 뻐꾸기 창에서 튀어나온 여왕 */
  boss_cuckoo: { kind: "boss_cuckoo", name: "뻐꾸기 여왕", hp: 3400, speed: 38, dmg: 22, r: 18, xp: 150, heavy: 1, boss: true },
  /** 10분: 자정에 멈춘 시계탑 그 자체 — 다시 돌려 놓으면 새벽 */
  boss_tower: { kind: "boss_tower", name: "멈춘 대시계", hp: 12000, speed: 26, dmg: 28, r: 22, xp: 400, heavy: 1, boss: true },
  /** 순찰대 특수 판: 닿아도 안 아픔 · 도망침 · 맞을 때마다 금화 · 시간 지나면 사라짐 */
  goblin: { kind: "goblin", name: "보물 도깨비", hp: 380, speed: 46, dmg: 0, r: 8, xp: 20, heavy: 0.9, ghost: true, move: "flee" },
};

/** 분마다 나오는 적 (가중치) · 화면에 유지할 수 */
export interface WaveDef {
  at: number;
  mix: Partial<Record<EnemyKind, number>>;
  /** 화면에 유지할 최대 수 */
  count: number;
  /** 초당 새로 나오는 수 */
  rate: number;
}
const TOWN_WAVES: WaveDef[] = [
  { at: 0, mix: { bat: 6, slime: 4 }, count: 30, rate: 3.2 },
  { at: 45, mix: { bat: 5, slime: 5 }, count: 50, rate: 4.5 },
  { at: 90, mix: { bat: 4, slime: 4, ghost: 3 }, count: 70, rate: 5.5 },
  { at: 150, mix: { slime: 3, ghost: 4, bat: 3 }, count: 95, rate: 6.5 },
  { at: 210, mix: { ghost: 3, skull: 4, bat: 2 }, count: 120, rate: 7.5 },
  { at: 270, mix: { skull: 5, ghost: 3, slime: 2 }, count: 140, rate: 8.5 },
  { at: 330, mix: { skull: 4, mush: 3, bat: 3 }, count: 165, rate: 10 },
  { at: 390, mix: { mush: 4, skull: 4, ghost: 2 }, count: 190, rate: 11.5 },
  { at: 450, mix: { mush: 4, golem: 2, skull: 3 }, count: 220, rate: 13 },
  { at: 510, mix: { golem: 3, mush: 4, bat: 4 }, count: 270, rate: 16 },
  { at: 560, mix: { golem: 4, mush: 3, skull: 3, bat: 3 }, count: 320, rate: 20 },
];

/** 정해진 순간 이벤트 */
export type TimedEvent =
  | { at: number; k: "elite"; kind: EnemyKind; n?: number }
  | { at: number; k: "ring"; kind: EnemyKind; n: number }
  | { at: number; k: "boss"; kind: EnemyKind; arena: boolean }
  /** 챕터 기믹: 꺼진 가로등 n개 · 분수 하나 */
  | { at: number; k: "lamps"; n: number }
  | { at: number; k: "spout" }
  /** 순찰대 특수 판: 보물 도깨비 · 지킬 등불 */
  | { at: number; k: "goblin" }
  | { at: number; k: "guard"; until: number };
const TOWN_EVENTS: TimedEvent[] = [
  { at: 150, k: "elite", kind: "slime" },
  { at: 240, k: "ring", kind: "bat", n: 40 },
  { at: 300, k: "boss", kind: "boss_jelly", arena: false },
  { at: 420, k: "ring", kind: "ghost", n: 36 },
  { at: 450, k: "elite", kind: "skull" },
  { at: 540, k: "elite", kind: "golem" },
  { at: RUN_SEC, k: "boss", kind: "boss_clock", arena: true },
];

const CLOCK_WAVES: WaveDef[] = [
  { at: 0, mix: { mouse: 6, bat: 4 }, count: 30, rate: 3.3 },
  { at: 45, mix: { mouse: 5, bat: 3, cuckoo: 2 }, count: 52, rate: 4.6 },
  { at: 90, mix: { mouse: 4, cuckoo: 4, ghost: 2 }, count: 72, rate: 5.6 },
  { at: 150, mix: { cuckoo: 4, mouse: 3, tin: 2 }, count: 98, rate: 6.6 },
  { at: 210, mix: { tin: 4, cuckoo: 3, mouse: 2 }, count: 125, rate: 7.7 },
  { at: 270, mix: { tin: 5, cuckoo: 3, mouse: 2 }, count: 145, rate: 8.8 },
  { at: 330, mix: { tin: 4, gear: 3, mouse: 3 }, count: 170, rate: 10.3 },
  { at: 390, mix: { gear: 4, tin: 4, cuckoo: 2 }, count: 196, rate: 11.8 },
  { at: 450, mix: { gear: 4, hourglass: 2, tin: 3 }, count: 226, rate: 13.4 },
  { at: 510, mix: { hourglass: 3, gear: 4, mouse: 4 }, count: 278, rate: 16.5 },
  { at: 560, mix: { hourglass: 4, gear: 3, tin: 3, cuckoo: 3 }, count: 330, rate: 20.5 },
]
const CLOCK_EVENTS: TimedEvent[] = [
  { at: 175, k: "ring", kind: "mouse", n: 40 },
  { at: 150, k: "elite", kind: "tin" },
  { at: 300, k: "boss", kind: "boss_cuckoo", arena: false },
  { at: 420, k: "ring", kind: "cuckoo", n: 36 },
  { at: 450, k: "elite", kind: "gear" },
  { at: 540, k: "elite", kind: "hourglass" },
  { at: RUN_SEC, k: "boss", kind: "boss_tower", arena: true },
];

/* ───────────── 스테이지 (맵) ───────────── */

export type StageId = "town" | "clock";
/** 보스 패턴 (돌아가며) */
export type BossPhase = "warn" | "ring" | "summon" | "slam" | "fan" | "spiral" | "chime" | "blink";
export interface StageDef {
  id: StageId;
  name: string;
  en: string;
  desc: string;
  /** 대표색 (고르기 화면 · 표시) */
  color: string;
  waves: WaveDef[];
  events: TimedEvent[];
  /** 5분 보스 · 10분(새벽) 보스 */
  mid: EnemyKind;
  final: EnemyKind;
  /** 보스 패턴 순서 · 부하 */
  boss: Partial<Record<EnemyKind, { order: BossPhase[]; minion: EnemyKind }>>;
  /** 시작하자마자 둘러싼 무리 · 오버타임 정예 */
  opening: [EnemyKind, EnemyKind];
  otElites: EnemyKind[];
  /** 몹 체력 배율 · 보상 배율 (깊이와 곱함) */
  hp: number;
  reward: number;
  /** 바닥 (public/survivor/<ground>.png) · 바닥이 없을 때 물들일 색 */
  ground: string;
  tint: string;
  /** 장식 (public/survivor/deco/<k>.png) · 가중치 */
  deco: { k: string; w: number; light?: boolean }[];
  /** 자정의 종: from 초부터 every 초마다 dur 초 동안 적이 빨라지고 젬이 두 배 */
  toll?: { from: number; every: number; dur: number };
  /** 열리는 조건 (이 스테이지를 깊이 0 이상 클리어) */
  need?: StageId;
}
export const STAGES: Record<StageId, StageDef> = {
  town: {
    id: "town",
    name: "잠든 골목",
    en: "SLEEPING ALLEY",
    desc: "가로등만 깜빡이는 밤의 골목. 분수대의 킹 젤리와 시계탑의 문지기가 새벽을 막고 있어요.",
    color: "#c58bff",
    waves: TOWN_WAVES,
    events: TOWN_EVENTS,
    mid: "boss_jelly",
    final: "boss_clock",
    boss: {
      boss_jelly: { order: ["warn", "slam", "ring", "summon"], minion: "bat" },
      boss_clock: { order: ["warn", "ring", "slam", "warn", "summon", "slam"], minion: "skull" },
    },
    opening: ["bat", "slime"],
    otElites: ["skull", "mush", "golem"],
    hp: 1,
    reward: 1,
    ground: "ground",
    tint: "",
    deco: [
      { k: "bush", w: 6 },
      { k: "flowers", w: 5 },
      { k: "rocks", w: 4 },
      { k: "tree", w: 4 },
      { k: "bench", w: 3 },
      { k: "crates", w: 2 },
      { k: "sign", w: 2 },
      { k: "mailbox", w: 1.5 },
      { k: "pumpkin", w: 2, light: true },
      { k: "statue", w: 1 },
      { k: "well", w: 1 },
      { k: "fountain", w: 1, light: true },
    ],
  },
  clock: {
    id: "clock",
    name: "시계탑 광장",
    en: "CLOCKTOWER PLAZA",
    desc: "문지기가 쓰러지자 광장의 대시계가 자정에 멈췄어요. 태엽 장난감들이 깨어나고, 종이 울릴 때마다 밤이 거칠어져요.",
    color: "#ffb03a",
    waves: CLOCK_WAVES,
    events: CLOCK_EVENTS,
    mid: "boss_cuckoo",
    final: "boss_tower",
    boss: {
      boss_cuckoo: { order: ["fan", "warn", "summon", "fan", "slam"], minion: "cuckoo" },
      boss_tower: { order: ["chime", "spiral", "summon", "blink", "chime", "spiral", "ring"], minion: "tin" },
    },
    opening: ["mouse", "mouse"],
    otElites: ["tin", "gear", "hourglass"],
    hp: 1.2,
    reward: 1.35,
    ground: "ground_clock",
    tint: "#ffb03a",
    deco: [
      { k: "gears", w: 5 },
      { k: "flowers", w: 3 },
      { k: "bench", w: 3 },
      { k: "clockpost", w: 3, light: true },
      { k: "toycart", w: 2 },
      { k: "crates", w: 2 },
      { k: "bellfallen", w: 1.5 },
      { k: "music", w: 1.5, light: true },
      { k: "sign", w: 1 },
    ],
    toll: { from: 140, every: 100, dur: 12 },
    need: "town",
  },
};
export const STAGE_IDS = Object.keys(STAGES) as StageId[];
export const isStage = (x: unknown): x is StageId => typeof x === "string" && x in STAGES;

/* ───────────── 챕터 (픽셀 순찰대) — 내용은 lib/patrol/chapters ───────────── */

export interface ChapterDef {
  /** 1부터 */
  id: number;
  name: string;
  /** 바탕 맵 (바닥 · 장식 · 보스 패턴) */
  stage: StageId;
  /** 판 길이 (초) — 이때 챕터 보스 */
  len: number;
  waves: WaveDef[];
  events: TimedEvent[];
  /** 적 체력 · 피해 배율 */
  hp: number;
  dmg: number;
  /** 챕터 보스 (잡으면 클리어) */
  final: EnemyKind;
  /** 레벨업 경험치 배율 (1 = 서바이버와 같음 · 1.2 = 20% 더 필요) */
  xp?: number;
  /** 별 3: 보스를 이 초 안에 */
  bossStar?: number;
  /** 보스 패턴 (없으면 바탕 맵 것) */
  boss?: StageDef["boss"];
  /** 스테이지 (전체 번호 1부터 · 챕터 안 번호 1~5) — 없으면 챕터 통째 */
  st?: number;
  sub?: number;
  /** 챕터 기믹 한 줄 (로비) */
  tip?: string;
  /** 장식 (없으면 바탕 맵 것) · 자정의 종 */
  deco?: StageDef["deco"];
  toll?: StageDef["toll"];
  /** 스테이지 종류 (X-1 기본 · X-2 기믹 · X-3 특수 · X-4 포위 · X-5 보스) */
  kind?: StageKind;
  /** 특수 판 목표 (별 2 = 목표 달성) */
  quest?: Quest;
}

/** 순찰대 기믹 안내 (로비 미리보기 · 판에서 처음 나올 때) */
export type GuideK = "lamp" | "spout" | "toll" | "goblin" | "guard" | "rush";
export const GIMMICK_GUIDE: Record<GuideK, { icon: string; title: string; c: string; steps: string[] }> = {
  lamp: { icon: "💡", title: "꺼진 가로등", c: "#ffb03a", steps: ["옆에 1.5초 서 있으면 켜져요", "켜지는 순간 주변 적이 불타고 치킨이 떨어져요", "켜진 15초 동안 가까이 온 적을 계속 태워요"] },
  spout: { icon: "⛲", title: "분수 물보라", c: "#7ad7ff", steps: ["원이 차오르고 4초 뒤 물보라가 솟아요", "원 안 적은 기절 + 피해 — 적을 끌고 들어가요", "그때 내가 원 안이면 젬이 전부 몰려와요"] },
  toll: { icon: "🔔", title: "자정의 종", c: "#ffb03a", steps: ["종이 울리는 12초 동안 적이 빨라져요", "대신 경험치가 두 배 — 버티면서 쓸어 담아요"] },
  goblin: { icon: "💰", title: "보물 도깨비", c: "#ffd23a", steps: ["안 아파요 — 도망치니까 쫓아가요", "맞을 때마다 코인, 잡으면 보물 상자", "15초 지나면 사라져요"] },
  guard: { icon: "🏮", title: "등불 지키기", c: "#ffd23a", steps: ["새로 나오는 적의 절반이 등불을 노려요", "등불 곁에서 막아요 — 체력이 0이 되면 꺼져요", "끝까지 지키면 보물 상자 + 섬광"] },
  rush: { icon: "⚔", title: "정예 러시", c: "#ff8a5c", steps: ["정예가 줄줄이 나와요 — 잡을 때마다 보물 상자", "미니 보스 전에 다 잡으면 별"] },
};
/** 이 판에 나오는 기믹 (로비 미리보기) */
export function guidesOf(def: ChapterDef): GuideK[] {
  const out: GuideK[] = [];
  if (def.events.some((e) => e.k === "lamps")) out.push("lamp");
  if (def.events.some((e) => e.k === "spout")) out.push("spout");
  if (def.toll) out.push("toll");
  if (def.quest) out.push(def.quest.k);
  return out;
}

export type StageKind = "basic" | "gimmick" | "special" | "siege" | "boss";
export const STAGE_KIND: Record<StageKind, { name: string; c: string }> = {
  basic: { name: "기본", c: "#9fb6ff" },
  gimmick: { name: "기믹", c: "#7ad7ff" },
  special: { name: "특수", c: "#ffd23a" },
  siege: { name: "포위", c: "#ff8a5c" },
  boss: { name: "보스", c: "#ff3d6e" },
};
/** 특수 판 목표: 보물 도깨비 n마리 잡기 · 정예 n마리 처치 · 등불 지키기 */
export type Quest = { k: "goblin"; n: number } | { k: "rush"; n: number } | { k: "guard" };
export const questName = (q: Quest) => (q.k === "goblin" ? `보물 도깨비 ${q.n}마리 다 잡기` : q.k === "rush" ? `정예 ${q.n}마리 다 처치` : "등불 지켜내기");

/* ───────────── 경험치 · 줍기 ───────────── */

/** 레벨 L → L+1 에 필요한 경험치 */
export function xpNeed(L: number): number {
  if (L < 20) return 4 + (L - 1) * 6;
  if (L < 40) return 118 + (L - 20) * 10;
  return 318 + (L - 40) * 15;
}

export type PickupKind = "meat" | "magnet" | "bomb" | "coin" | "bag" | "chest";
export const PICKUP_NAME: Record<PickupKind, string> = { meat: "고기", magnet: "자석", bomb: "폭탄", coin: "코인", bag: "코인 주머니", chest: "보물 상자" };

/** 레벨업 카드 등급 — 일반 +1 · 영웅 +2 · 전설 +3 레벨 */
export type Rarity = 0 | 1 | 2;
export const RARITY_NAME = ["일반", "영웅", "전설"];
export const RARITY_COLOR = ["#cfd6ea", "#c58bff", "#ffd23a"];

export const ULT_NEED = 100;
export const DASH_CD = 2.6;

/* ───────────── 맵 오브젝트 (메가봉크 성소 · 집중포화 맵 목표) ───────────── */

export type ThingKind = "shrine" | "gshrine" | "statue" | "bell" | "flag" | "box" | "merchant" | "fountain" | "trial" | "lamp" | "spout" | "guard";
export const THING_NAME: Record<ThingKind, string> = {
  shrine: "충전 성소",
  gshrine: "황금 성소",
  statue: "황금 고양이상",
  bell: "도전의 종",
  flag: "응원 깃발",
  box: "보물 상자",
  merchant: "떠돌이 상인",
  fountain: "소원 우물",
  trial: "달빛 시련",
  lamp: "꺼진 가로등",
  spout: "분수",
  guard: "지킬 등불",
};
export const THING_DESC: Record<ThingKind, string> = {
  shrine: "원 안에 서 있으면 충전 — 능력치 3개 중 하나",
  gshrine: "충전하면 영웅 · 전설 능력치 중 하나",
  statue: "만지면 금화 — 대신 저주가 쌓여 적이 세져요 (경험치도 늘어요)",
  bell: "치면 정예가 나타나요 — 잡으면 보물 상자",
  flag: "깃발을 세우면 20초 동안 강해져요",
  box: "금화를 내고 열어요 (열수록 비싸져요)",
  merchant: "금화로 유물을 팔아요 (하나 사면 떠나요)",
  fountain: "유물 3개 중 하나를 공짜로",
  trial: "원 안에서 25초 버티면 큰 보상",
  lamp: "옆에 서 있으면 켜져요 — 켜지는 순간 주변 적이 불타고 치킨이 나와요",
  spout: "곧 물보라가 솟아요 — 원 안 적은 기절, 원 안에 있으면 젬이 몰려와요",
  guard: "적이 등불을 노려요 — 꺼지지 않게 지키면 보물 상자",
};
/** 충전 시간 (초) — 원 안에 있어야 참 */
export const SHRINE_CHARGE = 2.4;
export const FLAG_CHARGE = 1.4;
export const TRIAL_SEC = 25;
export const TRIAL_R = 110;
/** 챕터 기믹: 가로등 켜는 시간 · 불타는 범위 / 분수 물보라까지 · 범위 */
export const LAMP_CHARGE = 1.5;
export const LAMP_R = 110;
export const SPOUT_FUSE = 4;
export const SPOUT_R = 100;
/** 지킬 등불: 체력 · 지키는 동안 주변 적을 조금씩 태우는 반지름 · 적이 노리는 비율 */
export const GUARD_HP = 100;
export const GUARD_R = 70;
export const GUARD_AGGRO = 0.45;
export const boxCost = (opened: number) => 20 + opened * 14;

/** 성소 축복 (능력치 하나) — 등급 0~3 별 값 */
export const BLESS: { k: keyof Stats; name: string; v: [number, number, number, number]; fmt: "pct" | "num" }[] = [
  { k: "might", name: "피해", v: [0.06, 0.1, 0.15, 0.25], fmt: "pct" },
  { k: "cooldown", name: "쿨타임 감소", v: [0.04, 0.06, 0.09, 0.14], fmt: "pct" },
  { k: "area", name: "범위", v: [0.06, 0.1, 0.15, 0.22], fmt: "pct" },
  { k: "speed", name: "이동 속도", v: [0.05, 0.08, 0.12, 0.18], fmt: "pct" },
  { k: "maxHp", name: "최대 체력", v: [10, 18, 28, 45], fmt: "num" },
  { k: "regen", name: "초당 회복", v: [0.2, 0.35, 0.5, 0.8], fmt: "num" },
  { k: "luck", name: "행운", v: [1, 1, 2, 3], fmt: "num" },
  { k: "growth", name: "경험치", v: [0.06, 0.1, 0.15, 0.22], fmt: "pct" },
  { k: "magnet", name: "줍는 범위", v: [0.15, 0.25, 0.4, 0.6], fmt: "pct" },
  { k: "armor", name: "방어", v: [1, 1, 2, 3], fmt: "num" },
];

/** 응원 깃발 버프 */
export type FlagBuff = "might" | "haste" | "speed" | "magnet";
export const FLAG_NAME: Record<FlagBuff, string> = { might: "피해 +50%", haste: "공격 속도 두 배", speed: "이동 +40%", magnet: "젬 전부 끌어오기" };

/* ───────────── 밤의 깊이 (난이도) ───────────── */

export const MAX_DEPTH = 10;
export const depthMul = (d: number) => ({ hp: 1 + d * 0.3, dmg: 1 + d * 0.1, spawn: 1 + d * 0.05, reward: 1 + d * 0.2 });
/** 오버타임 (클리어 뒤 계속): 30초마다 강해짐 */
export const OT_STEP = 30;
