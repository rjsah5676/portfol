/*
 * 럭키 출격 (실험) — 레벨업 · 상자 · 금화로 픽셀 글리치 디펜스 유닛을 소환해 부대를 꾸리고,
 * 같은 유닛 셋이면 합성, 조합식이 맞으면 신화. 부대는 주인공을 따라다니며 알아서 싸움.
 * 유닛 성능 · 확률 · 조합식은 디펜스 데이터를 그대로 읽음 (lib/defense/units · balance).
 * 시뮬 · 화면 공용, "@/" import 금지.
 */
import { B } from "../defense/balance";
import { FACTIONS, RECIPES, UNIT, needMatch, poolOf, type Faction, type Grade, type Recipe, type UnitDef } from "../defense/units";

export { GRADE_COLOR as ARMY_GRADE_COLOR, GRADE_NAME as ARMY_GRADE_NAME, FACTION_NAME, FACTION_COLOR, UNIT } from "../defense/units";
export type { UnitDef };

/** 부대 최대 인원 */
export const ARMY_CAP = 16;
/** 디펜스 1칸 → 서바이버 px */
export const TILE = 30;
/** 사거리 99(맵 전체) 유닛의 실제 사거리 */
export const GLOBAL_RANGE = 260;
/** 피해 배수 (밸런스) */
export const ARMY_DMG = 1.5;
/** 주인공 레벨마다 부대 피해 + (보통 판의 무기 레벨업 대신) */
export const ARMY_PER_LV = 0.06;
/** 금화 소환 비용: base + step × 지금까지 금화로 소환한 수 (max) */
export const buyCost = (n: number) => Math.min(B.summon.max, B.summon.base + B.summon.step * n);
/** 부대가 가득 찼을 때 들어온 유닛 → 금화 */
export const fullRefund = (g: Grade) => Math.round((B.sell[g] ?? 8) * 0.6);

/** 행운 → 소환 확률 단계 (0~5) */
export const luckTier = (luck: number, boost = 0) => Math.max(0, Math.min(5, Math.floor(luck / 2) + boost));
/** 소환 등급 (노말 · 레어 · 에픽 · 레전드) */
export function rollGrade(x: number, tier: number): Grade {
  const o = B.odds[Math.max(0, Math.min(B.odds.length - 1, tier))];
  let acc = 0;
  for (let g = 0; g < o.length; g++) {
    acc += o[g] / 100;
    if (x < acc) return g as Grade;
  }
  return 0;
}
/** 세력 무작위 → 그 등급 유닛 무작위 */
export function rollUnit(x1: number, x2: number, g: Grade, faction?: Faction): UnitDef {
  const f = faction ?? FACTIONS[Math.min(FACTIONS.length - 1, Math.floor(x1 * FACTIONS.length))];
  const pool = poolOf(f, g);
  return pool[Math.min(pool.length - 1, Math.floor(x2 * pool.length))];
}

/** 합성 묶음 키 — 디펜스보다 빠르게: 같은 세력 · 같은 등급 셋이면 합성 (유닛이 같을 필요 없음) */
export const mergeKey = (id: string) => `${UNIT[id].faction}:${UNIT[id].grade}`;
/** 합성할 수 있는 묶음 (에픽까지) — 높은 등급 먼저 */
export function mergeable(ids: string[]): string[] {
  const n = new Map<string, number>();
  for (const id of ids) if (UNIT[id].grade <= 2 && UNIT[id].faction !== "hidden") n.set(mergeKey(id), (n.get(mergeKey(id)) ?? 0) + 1);
  return [...n.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => Number(b[0].split(":")[1]) - Number(a[0].split(":")[1]))
    .map(([k]) => k);
}

/** 지금 재료가 다 있는 신화 조합식 (초월 · 히든 빼고) */
export function craftable(ids: string[]): Recipe[] {
  return RECIPES.filter((rc) => UNIT[rc.id].grade === 4 && pickNeeds(ids, rc) !== null);
}
/** 조합식 재료로 쓸 부대 순번 (모자라면 null) */
export function pickNeeds(ids: string[], rc: Recipe): number[] | null {
  const used: number[] = [];
  for (const need of rc.needs) {
    const i = ids.findIndex((id, k) => !used.includes(k) && needMatch(need, id));
    if (i < 0) return null;
    used.push(i);
  }
  return used;
}

/** 적 크기 (세력 상성): 0 소형 · 1 중형 · 2 대형 */
export const sizeOf = (r: number, boss: boolean) => (boss || r >= 11 ? 2 : r >= 8 ? 1 : 0);
