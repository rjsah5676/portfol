/*
 * 픽셀 타운 서바이버 — 유물 (상자 · 상인 · 소원 우물에서만 나옴, 칸 제한 없이 겹쳐 쌓임)
 * 레벨업 카드(무기 · 패시브)와 따로 노는 두 번째 성장 축 — 메가봉크 아이템처럼 발동형 효과가 섞임.
 * 시뮬 · 화면 · 서버 공용, "@/" import 금지.
 */
import type { Stats } from "./data";

export type RelicId =
  | "gym"
  | "sneaker"
  | "watch"
  | "magnetring"
  | "bandage"
  | "piggy"
  | "horseshoe"
  | "firecracker"
  | "icecube"
  | "glasses"
  | "pillow"
  | "tailwind"
  | "fang"
  | "bubble"
  | "zap"
  | "poison"
  | "whetstone"
  | "scythe"
  | "balloon"
  | "backpack"
  | "fork"
  | "phoenix"
  | "goldendice"
  | "shadow";

/** 0 일반 · 1 희귀 · 2 영웅 · 3 전설 */
export type RelicRarity = 0 | 1 | 2 | 3;
export const RELIC_RARITY_NAME = ["일반", "희귀", "영웅", "전설"];
export const RELIC_RARITY_COLOR = ["#cfd6ea", "#5fb8ff", "#c58bff", "#ffd23a"];

export interface RelicDef {
  id: RelicId;
  name: string;
  rarity: RelicRarity;
  /** 한 개당 효과 (겹치면 더해짐) */
  desc: string;
  /** 단순 능력치 유물 */
  stat?: Partial<Stats>;
  /** 최대 몇 개까지 */
  max?: number;
  /** 처음부터 나옴 (아니면 퀘스트로 해금) */
  base?: boolean;
  color: string;
}

const R = (id: RelicId, name: string, rarity: RelicRarity, desc: string, color: string, o: Partial<RelicDef> = {}): RelicDef => ({ id, name, rarity, desc, color, ...o });

export const RELICS: Record<RelicId, RelicDef> = {
  // 일반 — 능력치
  gym: R("gym", "근육 젤리", 0, "피해 +8%", "#ff6b6b", { stat: { might: 0.08 }, base: true }),
  sneaker: R("sneaker", "스프링 운동화", 0, "이동 속도 +8%", "#7dff9a", { stat: { speed: 0.08 }, base: true }),
  watch: R("watch", "태엽 시계", 0, "쿨타임 −5%", "#7ad7ff", { stat: { cooldown: 0.05 }, base: true }),
  magnetring: R("magnetring", "자석 반지", 0, "줍는 범위 +25%", "#9fb6ff", { stat: { magnet: 0.25 }, base: true }),
  bandage: R("bandage", "반창고", 0, "초당 회복 +0.3", "#ffb3c6", { stat: { regen: 0.3 }, base: true }),
  piggy: R("piggy", "돼지 저금통", 0, "줍는 금화 +20%", "#ffb0d0", { base: true }),
  horseshoe: R("horseshoe", "행운 편자", 0, "행운 +1", "#5fe08a", { stat: { luck: 1 }, base: true }),
  // 희귀 — 조건 · 발동
  firecracker: R("firecracker", "폭죽 사탕", 1, "맞힐 때 7% 확률로 펑! (피해 60%)", "#ff8a3d", { base: true }),
  icecube: R("icecube", "얼음 사탕", 1, "맞힐 때 6% 확률로 1.2초 얼림", "#9fe8ff", { base: true }),
  glasses: R("glasses", "돋보기 안경", 1, "체력 90% 넘는 적에게 피해 +25%", "#ffe9a0"),
  pillow: R("pillow", "낮잠 베개", 1, "멈춰 있으면 피해 +20%", "#d8d4ff"),
  tailwind: R("tailwind", "꼬리 바람", 1, "움직이는 동안 피해 +10%", "#bff2ff"),
  fang: R("fang", "흡혈 송곳니", 1, "처치할 때 4% 확률로 체력 +3", "#e2405e", { base: true }),
  bubble: R("bubble", "비눗방울 방패", 1, "15초마다 한 번 맞아도 안 아파요 (겹치면 더 빨리)", "#7ff0d8", { base: true, max: 4 }),
  // 영웅 — 강한 발동
  zap: R("zap", "전기 젤리", 2, "맞힐 때 7% 확률로 번개가 3마리를 타고 흘러요", "#ffe14a"),
  poison: R("poison", "독버섯 가루", 2, "맞힐 때 10% 확률로 3초 독 (초당 피해 40%)", "#a8e05a"),
  whetstone: R("whetstone", "날카로운 숫돌", 2, "치명타 확률 +6% · 치명타 피해 +30%", "#e6ecff", { base: true }),
  scythe: R("scythe", "사신의 낫", 2, "체력 8% 이하 일반 적은 바로 쓰러져요 (최대 24%)", "#8a8fa8", { max: 3 }),
  balloon: R("balloon", "풍선 갑옷", 2, "맞으면 주변이 펑 터지며 밀쳐내요 (3초마다)", "#ff9cf0"),
  backpack: R("backpack", "폭탄 배낭", 2, "처치할 때 6% 확률로 그 자리가 터져요", "#ffb03a"),
  // 전설
  fork: R("fork", "황금 포크", 3, "치명타의 15%가 메가 치명타 (피해 ×5)", "#ffd23a"),
  phoenix: R("phoenix", "불사조 깃털", 3, "쓰러지면 한 번 다시 일어나요", "#ff7a3d", { max: 2 }),
  goldendice: R("goldendice", "황금 주사위", 3, "레벨업 카드 +1장 · 잭팟 확률 +5%", "#ffd23a", { max: 1 }),
  shadow: R("shadow", "그림자 분신", 3, "투사체 +1", "#b48cff", { stat: { amount: 1 }, max: 2 }),
};
export const RELIC_IDS = Object.keys(RELICS) as RelicId[];
export const BASE_RELICS: RelicId[] = RELIC_IDS.filter((id) => RELICS[id].base);
export const relicMax = (id: RelicId) => RELICS[id].max ?? 99;

/** 등급 굴리기 확률 (행운이 높으면 위로) */
export function relicRarityWeights(luck: number, bonus = 0): number[] {
  const l = Math.max(0, luck) + bonus * 4;
  return [Math.max(10, 55 - l * 3), 28 + l * 0.8, 13 + l * 1.4, 4 + l * 0.8];
}

/** 상인 값 (등급 · 시간) */
export const relicPrice = (rar: RelicRarity, t: number) => Math.round([30, 60, 110, 200][rar] * (1 + Math.min(1, t / 600) * 0.6));
