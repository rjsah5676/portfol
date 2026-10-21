/*
 * 픽셀 순찰대 — 장비 6칸 (1단계 맛보기: 칸마다 2종 = 12종, 등급 5단).
 * 무기 · 목걸이 · 장갑 = 공격력 (판 안 모든 피해 +공격력×2%), 갑옷 · 벨트 · 신발 = 체력.
 * 희귀 · 영웅 · 전설에서 특수 효과가 하나씩 열림 (무기는 희귀 = 시작 무기 Lv2, 나머지는 유물 효과를 판 시작 때 받음).
 * 브라우저 · 서버 공용 — "@/" import 금지.
 */
import type { WeaponId } from "../survivor/data";
import { RELICS, type RelicId } from "../survivor/relics";

export type Slot = "weapon" | "neck" | "glove" | "armor" | "belt" | "shoe";
export const SLOTS: Slot[] = ["weapon", "neck", "glove", "armor", "belt", "shoe"];
export const SLOT_NAME: Record<Slot, string> = { weapon: "무기", neck: "목걸이", glove: "장갑", armor: "갑옷", belt: "벨트", shoe: "신발" };
export const isSlot = (x: unknown): x is Slot => typeof x === "string" && (SLOTS as string[]).includes(x);

/** 0 일반 · 1 고급 · 2 희귀 · 3 영웅 · 4 전설 */
export type GGrade = 0 | 1 | 2 | 3 | 4;
export const G_MAX: GGrade = 4;
export const GRADE_NAME = ["일반", "고급", "희귀", "영웅", "전설"];
export const GRADE_COLOR = ["#b8c0d8", "#6fe08a", "#5fb8ff", "#c58bff", "#ffd23a"];
/** 등급별 최대 레벨 */
export const MAX_LV = [10, 20, 30, 40, 50];

export type GearFx = { k: "wlv" } | { k: "relic"; id: RelicId };

export type GearId = "w_shuriken" | "w_boomerang" | "n_firefly" | "n_clock" | "g_leather" | "g_mech" | "a_jumper" | "a_coat" | "b_tool" | "b_lamp" | "s_sneaker" | "s_boots";

export interface GearDef {
  id: GearId;
  slot: Slot;
  name: string;
  /** 한 줄 소개 */
  desc: string;
  /** 무기 칸: 판 시작 때 들고 가는 공용 무기 */
  weapon?: WeaponId;
  /** 희귀 · 영웅 · 전설에서 열리는 효과 */
  fx: [GearFx, GearFx, GearFx];
}

const W = { k: "wlv" } as const;
const R = (id: RelicId): GearFx => ({ k: "relic", id });
const D = (id: GearId, slot: Slot, name: string, desc: string, fx: [GearFx, GearFx, GearFx], weapon?: WeaponId): GearDef => ({ id, slot, name, desc, fx, ...(weapon && { weapon }) });

export const GEAR: Record<GearId, GearDef> = {
  w_shuriken: D("w_shuriken", "weapon", "순찰 수리검", "바라보는 쪽으로 연달아 던지는 수리검을 들고 시작", [W, R("whetstone"), R("shadow")], "shuriken"),
  w_boomerang: D("w_boomerang", "weapon", "구조 부메랑", "던지면 돌아오는 부메랑을 들고 시작", [W, R("tailwind"), R("fork")], "boomerang"),
  n_firefly: D("n_firefly", "neck", "반딧불 목걸이", "작은 빛이 맴도는 목걸이", [R("firecracker"), R("zap"), R("fork")]),
  n_clock: D("n_clock", "neck", "태엽 펜던트", "멈추지 않는 작은 시계", [R("watch"), R("glasses"), R("goldendice")]),
  g_leather: D("g_leather", "glove", "가죽 장갑", "손에 꼭 맞는 순찰 장갑", [R("gym"), R("poison"), R("scythe")]),
  g_mech: D("g_mech", "glove", "정비 장갑", "볼트가 쓰던 공구 장갑", [R("icecube"), R("backpack"), R("shadow")]),
  a_jumper: D("a_jumper", "armor", "순찰 점퍼", "반사띠가 달린 순찰대 점퍼", [R("bandage"), R("bubble"), R("phoenix")]),
  a_coat: D("a_coat", "armor", "방풍 코트", "밤바람을 막는 두꺼운 코트", [R("bubble"), R("balloon"), R("phoenix")]),
  b_tool: D("b_tool", "belt", "공구 벨트", "주머니가 많은 벨트", [R("fang"), R("balloon"), R("goldendice")]),
  b_lamp: D("b_lamp", "belt", "랜턴 벨트", "랜턴을 거는 고리 벨트", [R("magnetring"), R("pillow"), R("phoenix")]),
  s_sneaker: D("s_sneaker", "shoe", "순찰 운동화", "가볍고 빠른 운동화", [R("sneaker"), R("tailwind"), R("shadow")]),
  s_boots: D("s_boots", "shoe", "장화", "웅덩이도 거침없는 장화", [R("horseshoe"), R("bubble"), R("fork")]),
};
export const GEAR_IDS = Object.keys(GEAR) as GearId[];
export const isGearId = (x: unknown): x is GearId => typeof x === "string" && x in GEAR;
export const gearOfSlot = (s: Slot) => GEAR_IDS.filter((id) => GEAR[id].slot === s);

/** 공격력 칸인지 */
export const isAtkSlot = (s: Slot) => s === "weapon" || s === "neck" || s === "glove";
const BASE: Record<"weapon" | "atk" | "hp", number[]> = {
  weapon: [10, 16, 26, 42, 68],
  atk: [6, 10, 16, 26, 42],
  hp: [15, 24, 38, 62, 100],
};
/** 주 능력치 (공격력 또는 체력) — 레벨마다 기본값 +10% */
export function mainStat(id: GearId, g: GGrade, lv: number): { k: "atk" | "hp"; v: number } {
  const s = GEAR[id].slot;
  const base = s === "weapon" ? BASE.weapon[g] : isAtkSlot(s) ? BASE.atk[g] : BASE.hp[g];
  return { k: isAtkSlot(s) ? "atk" : "hp", v: Math.round(base * (1 + 0.1 * (Math.max(1, lv) - 1))) };
}

/** 효과 설명 */
export function fxText(f: GearFx, id: GearId): string {
  if (f.k === "wlv") return `${GEAR[id].weapon ? "시작 무기 Lv2" : ""}`;
  return `${RELICS[f.id].name} — ${RELICS[f.id].desc}`;
}

/** 가진 장비 하나 */
export interface GearItem {
  uid: string;
  id: GearId;
  g: GGrade;
  lv: number;
}

/** 공격력 1 = 판 안 피해 +2% (판 안 성장이 커서 장비 차이가 보이게) */
export const ATK_PCT = 2;
/** 장착한 장비 → 판에 넘길 힘 (판에는 atk × ATK_PCT 를 피해 % 로) */
export interface GearPower {
  atk: number;
  hp: number;
  weapon?: WeaponId;
  wlv: number;
  relics: RelicId[];
}
export function power(items: GearItem[]): GearPower {
  const out: GearPower = { atk: 0, hp: 0, wlv: 1, relics: [] };
  for (const it of items) {
    const m = mainStat(it.id, it.g, it.lv);
    out[m.k] += m.v;
    const def = GEAR[it.id];
    if (def.weapon) out.weapon = def.weapon;
    for (let k = 0; k < 3; k++) {
      if (it.g < 2 + k) break;
      const f = def.fx[k];
      if (f.k === "wlv") out.wlv = 2;
      else out.relics.push(f.id);
    }
  }
  return out;
}
/** 전투력 (한 숫자 — 화면 표시용) */
export const powerScore = (p: GearPower) => Math.round(p.atk * 10 + p.hp * 2 + p.relics.length * 40 + (p.wlv - 1) * 30);

/** 강화 비용 (Lv → Lv+1) */
export const enhanceCost = (lv: number) => ({ coin: 30 + 20 * lv, bp: Math.ceil(lv / 2) });
/** Lv1 → lv 까지 들인 코인 · 설계도 — 합성 재료로 쓰거나 초기화하면 전부 돌려줌 */
export function spentOn(lv: number): { coin: number; bp: number } {
  let coin = 0;
  let bp = 0;
  for (let l = 1; l < lv; l++) {
    const c = enhanceCost(l);
    coin += c.coin;
    bp += c.bp;
  }
  return { coin, bp };
}

/** 합성: 같은 칸 · 같은 등급 3개 (고른 장비 + 재료 2) → 고른 장비가 다음 등급 (레벨 유지) */
export const MERGE_N = 3;
export function mergeOk(main: GearItem, fodder: GearItem[]): string | null {
  if (main.g >= G_MAX) return "이미 최고 등급이에요.";
  if (fodder.length !== MERGE_N - 1) return `재료가 ${MERGE_N - 1}개 필요해요.`;
  if (fodder.some((f) => f.uid === main.uid) || new Set(fodder.map((f) => f.uid)).size !== fodder.length) return "같은 장비를 두 번 쓸 수 없어요.";
  if (fodder.some((f) => GEAR[f.id].slot !== GEAR[main.id].slot || f.g !== main.g)) return "같은 칸 · 같은 등급이어야 해요.";
  return null;
}
