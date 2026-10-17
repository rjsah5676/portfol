/*
 * 픽셀 순찰대 — 무기 덱 · 무기 별 · 무기 상자.
 *  덱 6칸 = 판 안 레벨업 카드에 나오는 공용 무기 (반디 랜턴 · 장비 무기 칸과 따로)
 *  무기는 처음 얻으면 ★1, 같은 무기가 또 나오면 조각 → 별 (★5까지 조각 10개)
 * 브라우저 · 서버 공용 — "@/" import 금지.
 */
import type { WeaponId } from "../survivor/data";

export const DECK_N = 6;
/** 처음부터 가진 · 덱에 들어 있는 기본 6종 */
export const BASE_DECK: WeaponId[] = ["shuriken", "boomerang", "bolt", "thorns", "missile", "ball"];
/** 새 무기 (상자 · 첫 클리어) */
export const NEW_WEAPONS: WeaponId[] = ["umbrella", "grenade", "notes", "coins"];
export const P_WEAPONS: WeaponId[] = [...BASE_DECK, ...NEW_WEAPONS];
export const isPWeapon = (x: unknown): x is WeaponId => typeof x === "string" && (P_WEAPONS as string[]).includes(x);

/** 별: ★n → ★n+1 에 드는 조각 (index 0 = ★1→★2) */
export const STAR_NEED = [1, 2, 3, 4];
export const STAR_MAX = 5;
/** 조각 누적 → 별 (가진 무기만, 1~5) */
export function starOf(shards: number): number {
  let s = 1;
  let left = shards;
  for (const n of STAR_NEED) {
    if (left < n) break;
    left -= n;
    s++;
  }
  return s;
}
/** 다음 별까지: [지금 칸에 모은 조각, 필요한 조각] (★5면 null) */
export function starProgress(shards: number): [number, number] | null {
  let left = shards;
  for (const n of STAR_NEED) {
    if (left < n) return [left, n];
    left -= n;
  }
  return null;
}
/** 별마다 그 무기 피해 +5% (★1 = 0) */
export const STAR_DMG = 0.05;
export const starDmg = (star: number) => 1 + STAR_DMG * (Math.max(1, star) - 1);

/** ★3 고유 효과 (판 엔진 wstat · hurt 에서) */
export const STAR3: Record<string, string> = {
  shuriken: "관통 +1",
  boomerang: "크기 +20%",
  bolt: "번개 범위 +25%",
  thorns: "범위 +15%",
  missile: "폭발 범위 +25%",
  ball: "지속 +30%",
  umbrella: "맞은 적 1초 느려짐",
  grenade: "터진 자리에 2초 불장판",
  notes: "맞은 적 0.3초 멈칫",
  coins: "관통 +1",
};
/** ★5: 여러 개 쏘는 무기는 +1개, 오라 · 파동 · 회전은 범위 +15% */
export const STAR5 = "Lv5 에서 +1개 (오라 · 파동은 범위 +15%)";

/** 무기 역할 한 줄 (덱 화면) */
export const W_ROLE: Record<string, string> = {
  shuriken: "앞으로 연사",
  boomerang: "갔다 돌아오며 관통",
  bolt: "화면 속 적에 낙뢰",
  thorns: "주변 계속 피해",
  missile: "따라가서 폭발",
  ball: "벽을 튕기는 공",
  umbrella: "주위를 돌며 막는 근접 방어",
  grenade: "적 무리에 던져 폭발",
  notes: "박자마다 넓게 퍼지는 파동",
  coins: "흩뿌리기 · 처치하면 코인",
};

/** 처음 클리어하면 주는 무기 (스테이지 번호 → 무기) */
export const FIRST_WEAPON: Record<number, WeaponId> = { 3: "umbrella", 8: "grenade", 13: "notes" };

/* ───────────── 무기 상자 (보석) ───────────── */

export const WBOX = { cost: 200, cost10: 1800 } as const;
/** 한 번 뽑을 때 무기별 확률 (%) — 기본 6종 각 11 · 새 4종 각 8.5 */
export const WBOX_ODDS: Record<string, number> = { shuriken: 11, boomerang: 11, bolt: 11, thorns: 11, missile: 11, ball: 11, umbrella: 8.5, grenade: 8.5, notes: 8.5, coins: 8.5 };
/** 천장: N번 안에 안 가진 새 무기 하나 */
export const WBOX_PITY = 15;

/** 무기 하나 뽑기 (rnd: 0~1 · pity: 안 가진 새 무기가 안 나온 횟수, 고쳐 씀) */
export function rollWeapon(rnd: () => number, own: Partial<Record<WeaponId, number>>, pity: { n: number }): WeaponId {
  const missing = NEW_WEAPONS.filter((w) => own[w] === undefined);
  pity.n++;
  if (missing.length && pity.n >= WBOX_PITY) {
    pity.n = 0;
    return missing[Math.min(missing.length - 1, Math.floor(rnd() * missing.length))];
  }
  let x = rnd() * 100;
  let got: WeaponId = "shuriken";
  for (const w of P_WEAPONS) {
    x -= WBOX_ODDS[w];
    if (x < 0) {
      got = w;
      break;
    }
  }
  if (missing.includes(got)) pity.n = 0;
  return got;
}
