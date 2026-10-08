/*
 * 홀덤 카드 · 족보 판정 (서버와 화면이 같이 씀 — server/src/games/holdem 이 이 파일을 직접 import)
 *
 * 카드 한 장 = 0~51 숫자.  rank = c >> 2 (0 = 2 … 8 = 10, 9 = J, 10 = Q, 11 = K, 12 = A),  suit = c & 3 (♠ ♥ ♦ ♣)
 * 족보 점수 = 숫자 하나. 클수록 센 패이고, 같으면 무승부(킥커까지 다 들어 있음).
 *   category * 16^5 + (비교 순서대로 랭크 5개를 16진 자리로)
 */

export type Card = number;

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export const SUITS = ["♠", "♥", "♦", "♣"] as const;

export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;
export const card = (rank: number, suit: number): Card => (rank << 2) | suit;
export const cardLabel = (c: Card) => `${RANKS[rankOf(c)]}${SUITS[suitOf(c)]}`;

/** "As Kd 10h" 같은 글을 카드로 (테스트·디버깅용). 무늬: s h d c */
export function parseCards(text: string): Card[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const suit = "shdc".indexOf(t.slice(-1).toLowerCase());
      const r = t.slice(0, -1).toUpperCase();
      const rank = RANKS.indexOf((r === "T" ? "10" : r) as (typeof RANKS)[number]);
      if (suit < 0 || rank < 0) throw new Error(`카드 형식 오류: ${t}`);
      return card(rank, suit);
    });
}

/** 섞은 덱. randInt(n) = 0 이상 n 미만 정수 (서버는 암호학적 난수, 테스트는 고정 난수) */
export function shuffledDeck(randInt: (n: number) => number): Card[] {
  const d: Card[] = [];
  for (let i = 0; i < 52; i++) d.push(i);
  for (let i = 51; i > 0; i--) {
    const j = randInt(i + 1);
    const t = d[i];
    d[i] = d[j];
    d[j] = t;
  }
  return d;
}

// ───────────── 족보 ─────────────

export const CAT = {
  HIGH: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export const CAT_NAMES = [
  "하이카드",
  "원페어",
  "투페어",
  "트리플",
  "스트레이트",
  "플러시",
  "풀하우스",
  "포카드",
  "스트레이트 플러시",
] as const;

const P5 = 16 ** 5;
const pack = (cat: number, a = 0, b = 0, c = 0, d = 0, e = 0) =>
  cat * P5 + a * 65536 + b * 4096 + c * 256 + d * 16 + e;

/** 랭크 비트마스크에서 스트레이트의 가장 높은 랭크 (없으면 -1). A-2-3-4-5 는 5 하이(랭크 3) */
function straightHigh(mask: number): number {
  for (let h = 12; h >= 4; h--) if (((mask >> (h - 4)) & 0x1f) === 0x1f) return h;
  return (mask & 0x100f) === 0x100f ? 3 : -1;
}

// 판정 중에 쓰는 임시 배열 (매번 새로 만들지 않게 — 봇이 한 번 생각할 때 수천 번 부름)
const cnt = new Int8Array(13);
const suitMask = new Int32Array(4);
const suitCnt = new Int8Array(4);

/** 카드 5~7장에서 가장 센 5장의 족보 점수 */
export function evaluate(cards: readonly Card[]): number {
  cnt.fill(0);
  suitMask.fill(0);
  suitCnt.fill(0);
  let mask = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    cnt[r]++;
    mask |= 1 << r;
    suitMask[s] |= 1 << r;
    suitCnt[s]++;
  }

  // 플러시 계열 (7장 안에서는 플러시와 포카드·풀하우스가 같이 나올 수 없음)
  for (let s = 0; s < 4; s++) {
    if (suitCnt[s] < 5) continue;
    const fm = suitMask[s];
    const sh = straightHigh(fm);
    if (sh >= 0) return pack(CAT.STRAIGHT_FLUSH, sh);
    const k: number[] = [];
    for (let r = 12; r >= 0 && k.length < 5; r--) if (fm & (1 << r)) k.push(r);
    return pack(CAT.FLUSH, k[0], k[1], k[2], k[3], k[4]);
  }

  let quad = -1;
  let trip = -1;
  let trip2 = -1;
  let pair = -1;
  let pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = cnt[r];
    if (n === 4) quad = r;
    else if (n === 3) {
      if (trip < 0) trip = r;
      else if (trip2 < 0) trip2 = r;
    } else if (n === 2) {
      if (pair < 0) pair = r;
      else if (pair2 < 0) pair2 = r;
    }
  }
  /** 주어진 랭크들을 뺀 나머지에서 높은 순으로 n개 */
  const kick = (n: number, x = -1, y = -1): number[] => {
    const out: number[] = [];
    for (let r = 12; r >= 0 && out.length < n; r--) if (cnt[r] && r !== x && r !== y) out.push(r);
    return out;
  };

  if (quad >= 0) return pack(CAT.QUADS, quad, kick(1, quad)[0]);
  if (trip >= 0) {
    // 트리플이 둘이면 낮은 쪽이 페어 역할
    const p = Math.max(trip2, pair);
    if (p >= 0) return pack(CAT.FULL_HOUSE, trip, p);
  }
  const sh = straightHigh(mask);
  if (sh >= 0) return pack(CAT.STRAIGHT, sh);
  if (trip >= 0) {
    const k = kick(2, trip);
    return pack(CAT.TRIPS, trip, k[0], k[1]);
  }
  if (pair >= 0 && pair2 >= 0) return pack(CAT.TWO_PAIR, pair, pair2, kick(1, pair, pair2)[0]);
  if (pair >= 0) {
    const k = kick(3, pair);
    return pack(CAT.PAIR, pair, k[0], k[1], k[2]);
  }
  const k = kick(5);
  return pack(CAT.HIGH, k[0], k[1], k[2], k[3], k[4]);
}

export const categoryOf = (score: number) => Math.floor(score / P5);
/** 점수에 들어 있는 랭크 (i = 0 이 가장 먼저 비교되는 것) */
const tie = (score: number, i: number) => Math.floor(score / 16 ** (4 - i)) % 16;

/** 화면에 보여 줄 족보 이름. 예: "A 원페어", "K·7 투페어", "9 풀하우스", "로열 플러시" */
export function handName(score: number): string {
  const cat = categoryOf(score);
  const a = RANKS[tie(score, 0)];
  const b = RANKS[tie(score, 1)];
  switch (cat) {
    case CAT.STRAIGHT_FLUSH:
      return tie(score, 0) === 12 ? "로열 플러시" : `${a} 하이 스트레이트 플러시`;
    case CAT.QUADS:
      return `${a} 포카드`;
    case CAT.FULL_HOUSE:
      return `${a}·${b} 풀하우스`;
    case CAT.FLUSH:
      return `${a} 하이 플러시`;
    case CAT.STRAIGHT:
      return `${a} 하이 스트레이트`;
    case CAT.TRIPS:
      return `${a} 트리플`;
    case CAT.TWO_PAIR:
      return `${a}·${b} 투페어`;
    case CAT.PAIR:
      return `${a} 원페어`;
    default:
      return `${a} 하이`;
  }
}

/** 가장 센 5장이 어떤 카드인지 (쇼다운에서 이긴 카드 강조용). 카드가 5장 미만이면 그대로 */
export function bestFive(cards: readonly Card[]): Card[] {
  if (cards.length <= 5) return [...cards];
  const n = cards.length;
  let best = -1;
  let pick: Card[] = [];
  // 7장 중 2장(6장이면 1장)을 빼는 모든 경우
  for (let i = 0; i < n; i++) {
    for (let j = n === 6 ? n : i + 1; j <= n; j++) {
      const five = cards.filter((_, k) => k !== i && k !== j);
      if (five.length !== 5) continue;
      const s = evaluate(five);
      if (s > best) {
        best = s;
        pick = five;
      }
      if (n === 6) break;
    }
  }
  return pick;
}

/**
 * 가장 센 5장 중 족보를 "이루는" 카드만 (강조 표시용).
 * 원페어·투페어·트리플·포카드·풀하우스는 짝이 맞는 카드만, 스트레이트·플러시 계열은 5장 다, 하이카드는 제일 높은 한 장.
 */
export function madeOf(five: readonly Card[]): Card[] {
  if (five.length < 5) return [...five];
  const cnt = new Array<number>(13).fill(0);
  for (const c of five) cnt[rankOf(c)]++;
  if (cnt.some((n) => n >= 2)) return five.filter((c) => cnt[rankOf(c)] >= 2);
  const flush = five.every((c) => suitOf(c) === suitOf(five[0]));
  const rs = five.map(rankOf).sort((a, b) => a - b);
  const straight =
    rs[4] - rs[0] === 4 ||
    (rs[0] === 0 && rs[1] === 1 && rs[2] === 2 && rs[3] === 3 && rs[4] === 12);
  if (flush || straight) return [...five];
  const top = Math.max(...rs);
  return five.filter((c) => rankOf(c) === top);
}
