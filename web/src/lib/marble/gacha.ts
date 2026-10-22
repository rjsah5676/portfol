/*
 * DICE TOWN 가챠 · 강화 계산 (서버가 돌리고, 화면은 확률 · 비용 표시에 씀).
 * 난수는 받은 rand() 만 씀 (서버는 crypto randomInt 로 만든 것).
 */

import {
  CHAR_OVERFLOW_STARS,
  CHAR_UP_DUPES,
  GACHA,
  ITEM_DUP_PARTS,
  MAX_LV,
  charOn,
  ITEMS,
  type Grade,
} from "./data";

export interface Owned {
  chars: Record<string, { lv: number; dup: number }>;
  items: Record<string, { lv: number }>;
  stars: number;
  parts: number;
  /** ur: UR 천장 (예전 프로필엔 없음) */
  pity: { char: number; item: number; ur?: number };
}

export type CharPull = { k: "char"; id: string; grade: Grade; fresh: boolean; stars?: number };
export type ItemPull = { k: "item"; id: string; grade: Exclude<Grade, "UR">; fresh: boolean; parts?: number } | { k: "parts"; n: number };

const pickGrade = <G extends string>(rate: Record<G, number>, r: number): G => {
  const ks = Object.keys(rate) as G[];
  let acc = 0;
  for (const k of ks) {
    acc += rate[k];
    if (r < acc) return k;
  }
  return ks[0];
};

/** 이 캐릭터를 끝까지 강화하는 데 아직 필요한 같은 카드 수 */
export const dupesToMax = (lv: number, dup: number) => Math.max(0, CHAR_UP_DUPES.slice(lv).reduce((a, b) => a + b, 0) - dup);

/** 지금 나올 수 있는 등급별 캐릭터 (UR 이 아직 없으면 그 확률은 SSR 로) */
function charRates(): Record<Grade, number> {
  const r = { ...GACHA.char.rate };
  const on = charOn();
  for (const g of ["UR", "SSR", "SR"] as Grade[]) {
    if (!on.some((c) => c.grade === g)) {
      const down = g === "UR" ? "SSR" : g === "SSR" ? "SR" : "R";
      r[down] += r[g];
      r[g] = 0;
    }
  }
  return r;
}
export const CHAR_RATES = charRates;

/** 캐릭터 n 번 (o 를 그 자리에서 바꿈) */
export function pullChars(o: Owned, n: number, rand: () => number): CharPull[] {
  const rates = charRates();
  const out: CharPull[] = [];
  const pool = (g: Grade) => charOn().filter((c) => c.grade === g);
  for (let i = 0; i < n; i++) {
    o.pity.char++;
    o.pity.ur = (o.pity.ur ?? 0) + 1;
    let g = pickGrade(rates, rand());
    // UR 천장: 이 횟수 안에 UR 이 안 나오면 UR 확정
    if (rates.UR > 0 && o.pity.ur >= GACHA.char.urPity) g = "UR";
    // 천장: SSR 이상 확정 (UR · SSR 비율대로)
    if (o.pity.char >= GACHA.char.pity && g !== "SSR" && g !== "UR") g = rates.UR > 0 && rand() < rates.UR / (rates.UR + rates.SSR) ? "UR" : "SSR";
    // 10연차 마지막: 앞에 SR 이상이 없으면 SR 확정
    if (n >= 10 && i === n - 1 && g === "R" && !out.some((x) => x.grade !== "R")) g = "SR";
    if (g === "SSR" || g === "UR") o.pity.char = 0;
    if (g === "UR") o.pity.ur = 0;
    const list = pool(g);
    const c = list[Math.floor(rand() * list.length)] ?? charOn()[0];
    out.push(giveChar(o, c.id, c.grade));
  }
  return out;
}

export function giveChar(o: Owned, id: string, grade: Grade): CharPull {
  const have = o.chars[id];
  if (!have) {
    o.chars[id] = { lv: 0, dup: 0 };
    return { k: "char", id, grade, fresh: true };
  }
  // 끝까지 강화할 만큼 카드가 이미 있으면 별사탕으로
  if (dupesToMax(have.lv, have.dup) <= 0) {
    const s = CHAR_OVERFLOW_STARS[grade];
    o.stars += s;
    return { k: "char", id, grade, fresh: false, stars: s };
  }
  have.dup++;
  return { k: "char", id, grade, fresh: false };
}

/** 아이템 n 번 — 아이템이 아니면 부품 꾸러미 */
export function pullItems(o: Owned, n: number, rand: () => number): ItemPull[] {
  const out: ItemPull[] = [];
  for (let i = 0; i < n; i++) {
    o.pity.item++;
    // 10연차 마지막: 앞에 아이템이 하나도 없으면 아이템 확정
    const forceItem = n >= 10 && i === n - 1 && !out.some((x) => x.k === "item");
    const pity = o.pity.item >= GACHA.item.pity;
    if (!forceItem && !pity && rand() >= GACHA.item.itemRate) {
      let r = rand(),
        amt = GACHA.item.parts[0][1];
      for (const [w, v] of GACHA.item.parts) {
        if (r < w) {
          amt = v;
          break;
        }
        r -= w;
      }
      o.parts += amt;
      out.push({ k: "parts", n: amt });
      continue;
    }
    const g: Exclude<Grade, "UR"> = pity ? "SSR" : pickGrade(GACHA.item.rate, rand());
    if (g === "SSR") o.pity.item = 0;
    const list = ITEMS.filter((x) => x.grade === g);
    const it = list[Math.floor(rand() * list.length)];
    if (!o.items[it.id]) {
      o.items[it.id] = { lv: 0 };
      out.push({ k: "item", id: it.id, grade: g, fresh: true });
    } else {
      const p = ITEM_DUP_PARTS[g];
      o.parts += p;
      out.push({ k: "item", id: it.id, grade: g, fresh: false, parts: p });
    }
  }
  return out;
}

/** 캐릭터 강화에 지금 필요한 같은 카드 (만렙이면 0) */
export const charUpNeed = (lv: number) => (lv >= MAX_LV ? 0 : CHAR_UP_DUPES[lv]);
