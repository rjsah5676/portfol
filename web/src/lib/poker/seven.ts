import { RANKS, type Card } from "./cards";

/*
 * 7포커 족보 (한국식) — 서버와 화면이 같이 씀.
 *
 *  로열 스트레이트 플러시 > 백 스트레이트 플러시 > 스트레이트 플러시 > 포카드 > 풀하우스 > 플러시
 *  > 마운틴(10-J-Q-K-A) > 백스트레이트(A-2-3-4-5) > 스트레이트 > 트리플 > 투페어 > 원페어 > 탑
 *  숫자까지 같으면 무늬로 가림: ♠ > ◆ > ♥ > ♣
 *
 * 점수 = 숫자 하나 (클수록 셈). 카드가 서로 겹치지 않으므로 두 사람의 점수가 같을 일은 없음.
 */

export const KCAT = {
  TOP: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  BACK_STRAIGHT: 5,
  MOUNTAIN: 6,
  FLUSH: 7,
  FULL_HOUSE: 8,
  QUADS: 9,
  STRAIGHT_FLUSH: 10,
  BACK_STRAIGHT_FLUSH: 11,
  ROYAL: 12,
} as const;

/** 무늬의 세기: ♠ 3 · ◆ 2 · ♥ 1 · ♣ 0  (카드의 suit 값은 ♠0 ♥1 ♦2 ♣3) */
const SUIT_POWER = [3, 1, 2, 0];
const suitPower = (c: Card) => SUIT_POWER[c & 3];

const pack = (cat: number, ranks: number[], suit: number) => {
  let v = cat;
  for (let i = 0; i < 5; i++) v = v * 16 + (ranks[i] ?? 0);
  return v * 4 + suit;
};

/** 정확히 5장의 점수 */
function score5(c: Card[]): number {
  const ranks = c.map((x) => x >> 2).sort((a, b) => b - a);
  const flush = c.every((x) => (x & 3) === (c[0] & 3));
  const uniq = new Set(ranks).size === 5;
  const mountain = uniq && ranks[0] === 12 && ranks[4] === 8;
  const back = uniq && ranks[0] === 12 && ranks[1] === 3 && ranks[4] === 0;
  const straight = uniq && (ranks[0] - ranks[4] === 4 || back);
  /** 그 숫자의 카드 중 가장 센 무늬 */
  const suitOfRank = (r: number) => Math.max(...c.filter((x) => x >> 2 === r).map(suitPower));
  const top = suitOfRank(ranks[0]);

  if (flush && mountain) return pack(KCAT.ROYAL, [], top);
  if (flush && back) return pack(KCAT.BACK_STRAIGHT_FLUSH, [], top);
  if (flush && straight) return pack(KCAT.STRAIGHT_FLUSH, [ranks[0]], top);

  // 같은 숫자끼리 묶어서: 장수 많은 순 → 숫자 높은 순
  const count = new Map<number, number>();
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1);
  const groups = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const order = groups.map((g) => g[0]);
  const shape = groups.map((g) => g[1]).join("");
  const key = suitOfRank(order[0]);

  if (shape === "41") return pack(KCAT.QUADS, order, key);
  if (shape === "32") return pack(KCAT.FULL_HOUSE, order, key);
  if (flush) return pack(KCAT.FLUSH, ranks, top);
  if (mountain) return pack(KCAT.MOUNTAIN, [], top);
  if (back) return pack(KCAT.BACK_STRAIGHT, [], top);
  if (straight) return pack(KCAT.STRAIGHT, [ranks[0]], top);
  if (shape === "311") return pack(KCAT.TRIPS, order, key);
  if (shape === "221") return pack(KCAT.TWO_PAIR, order, key);
  if (shape === "2111") return pack(KCAT.PAIR, order, key);
  return pack(KCAT.TOP, ranks, top);
}

/** 5~7장에서 가장 센 5장과 그 점수 */
export function bestK(cards: readonly Card[]): { score: number; five: Card[] } {
  const n = cards.length;
  if (n < 5) return { score: openRank(cards), five: [...cards] };
  let best = -1;
  let pick: Card[] = [];
  const five: Card[] = [0, 0, 0, 0, 0];
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            five[0] = cards[a];
            five[1] = cards[b];
            five[2] = cards[c];
            five[3] = cards[d];
            five[4] = cards[e];
            const s = score5(five);
            if (s > best) {
              best = s;
              pick = [...five];
            }
          }
  return { score: best, five: pick };
}

export const evaluateK = (cards: readonly Card[]) => bestK(cards).score;
export const kCategory = (score: number) => Math.floor(score / 4 / 16 ** 5);
const kRank = (score: number, i: number) => Math.floor(score / 4 / 16 ** (4 - i)) % 16;

export function handNameK(score: number): string {
  const a = RANKS[kRank(score, 0)];
  const b = RANKS[kRank(score, 1)];
  switch (kCategory(score)) {
    case KCAT.ROYAL:
      return "로열 스트레이트 플러시";
    case KCAT.BACK_STRAIGHT_FLUSH:
      return "백 스트레이트 플러시";
    case KCAT.STRAIGHT_FLUSH:
      return `${a} 스트레이트 플러시`;
    case KCAT.QUADS:
      return `${a} 포카드`;
    case KCAT.FULL_HOUSE:
      return `${a}·${b} 풀하우스`;
    case KCAT.FLUSH:
      return `${a} 플러시`;
    case KCAT.MOUNTAIN:
      return "마운틴";
    case KCAT.BACK_STRAIGHT:
      return "백스트레이트";
    case KCAT.STRAIGHT:
      return `${a} 스트레이트`;
    case KCAT.TRIPS:
      return `${a} 트리플`;
    case KCAT.TWO_PAIR:
      return `${a}·${b} 투페어`;
    case KCAT.PAIR:
      return `${a} 원페어`;
    default:
      return `${a} 탑`;
  }
}

/**
 * 펴 놓은 카드(1~4장)만으로 매기는 순위 — 구마다 가장 높은 사람이 보스(먼저 거는 사람).
 * 포카드 > 트리플 > 투페어 > 원페어 > 높은 카드, 같으면 숫자, 그래도 같으면 무늬.
 */
export function openRank(up: readonly Card[]): number {
  if (!up.length) return 0;
  const count = new Map<number, number>();
  for (const c of up) count.set(c >> 2, (count.get(c >> 2) ?? 0) + 1);
  const groups = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join("");
  const cat = shape.startsWith("4") ? KCAT.QUADS : shape.startsWith("3") ? KCAT.TRIPS : shape.startsWith("22") ? KCAT.TWO_PAIR : shape.startsWith("2") ? KCAT.PAIR : KCAT.TOP;
  const keyRank = groups[0][0];
  const key = Math.max(...up.filter((c) => c >> 2 === keyRank).map(suitPower));
  return pack(
    cat,
    groups.map((g) => g[0]),
    key
  );
}

/**
 * 받은 4장에서 무엇을 버리고 무엇을 펼지 (시간 안에 못 고른 사람 · 봇의 기본 선택).
 * 남기는 3장: 트리플 > 페어 > 같은 무늬 3장 > 이어지는 3장 > 높은 카드.  펴는 카드: 페어는 숨기고, 아니면 가장 낮은 카드.
 */
export function autoChoice(dealt: readonly Card[]): { discard: number; open: number } {
  let best = -1;
  let discard = 0;
  for (let d = 0; d < dealt.length; d++) {
    const keep = dealt.filter((_, i) => i !== d);
    const r = keep.map((c) => c >> 2).sort((a, b) => b - a);
    const suited = keep.every((c) => (c & 3) === (keep[0] & 3));
    const pairRank = r[0] === r[1] ? r[0] : r[1] === r[2] ? r[1] : -1;
    const trips = r[0] === r[2];
    const span = r[0] - r[2];
    let v = r[0] + r[1] * 0.6 + r[2] * 0.3;
    if (trips) v += 400;
    else if (pairRank >= 0) v += 150 + pairRank * 4;
    if (suited) v += 70;
    if (pairRank < 0 && span <= 4) v += span === 2 ? 45 : 25;
    if (v > best) {
      best = v;
      discard = d;
    }
  }
  const idx = dealt.map((_, i) => i).filter((i) => i !== discard);
  const rankOf = (i: number) => dealt[i] >> 2;
  // 페어가 있으면 페어가 아닌 카드를, 없으면 가장 낮은 카드를 폄
  const paired = idx.filter((i) => idx.some((j) => j !== i && rankOf(j) === rankOf(i)));
  const pool = paired.length && paired.length < 3 ? idx.filter((i) => !paired.includes(i)) : idx;
  const open = pool.reduce((a, b) => (rankOf(b) < rankOf(a) ? b : a));
  return { discard, open };
}
