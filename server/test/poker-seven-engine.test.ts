import { describe, expect, it } from "vitest";
import { RAISES_PER_ROUND, SevenError, SevenHand, type SevenAct, type SevenBet } from "../src/games/poker/seven/engine";
import { chooseSeven, decideSeven, type SevenBotView } from "../src/games/poker/seven/bots";
import { newBrain } from "../src/games/poker/personas";
import { parseCards, shuffledDeck, type Card } from "../../web/src/lib/poker/cards";
import { BOT_IDS, TIERS, UNIT, type TierId } from "../../web/src/lib/poker/rules";
import { KCAT, autoChoice, bestK, evaluateK, handNameK, kCategory, openRank } from "../../web/src/lib/poker/seven";

/*
 * 7포커 엔진 · 한국식 족보 · 봇 검증 — 스펙(룰 1~12)을 기준으로 손으로 계산한 값과 비교.
 * 엔진이 "지금 그렇게 돈다" 가 아니라 "그래야 한다" 를 적음.
 */

// ───────────── 도우미 ─────────────

/** 고정 난수 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = (t: string) => parseCards(t);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const SUIT_CH = "shdc";
const sortedJoin = (xs: readonly number[]) => [...xs].sort((a, b) => a - b).join(",");

const BET_TYPES: SevenBet[] = ["bbing", "ddadang", "quarter", "half", "full"];
const ALL_ACTS: SevenAct[] = ["die", "check", "call", ...BET_TYPES];

// ───────────── 따로 만든 족보 판정 (룰 10 만 보고 씀 — seven.ts 와 독립) ─────────────

/** 무늬의 세기: ♠ > ♦ > ♥ > ♣  (suit 값은 ♠0 ♥1 ♦2 ♣3) */
const SUIT_STRENGTH = [4, 2, 3, 1];
/** 비교 열쇠: [족보, 숫자 5칸, 무늬] — 앞에서부터 큰 쪽이 이김 */
type Key = number[];
const cmpKey = (a: Key, b: Key): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
};

/** 룰 10 의 순서 (약한 것부터 0…12) */
const RC = { TOP: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, BACK: 5, MOUNTAIN: 6, FLUSH: 7, FULL: 8, QUADS: 9, SF: 10, BACK_SF: 11, ROYAL: 12 } as const;
/** 내 순서 → seven.ts 의 KCAT */
const KC = [
  KCAT.TOP,
  KCAT.PAIR,
  KCAT.TWO_PAIR,
  KCAT.TRIPS,
  KCAT.STRAIGHT,
  KCAT.BACK_STRAIGHT,
  KCAT.MOUNTAIN,
  KCAT.FLUSH,
  KCAT.FULL_HOUSE,
  KCAT.QUADS,
  KCAT.STRAIGHT_FLUSH,
  KCAT.BACK_STRAIGHT_FLUSH,
  KCAT.ROYAL,
];

function refKey5(cs: readonly Card[]): Key {
  const count = new Array<number>(13).fill(0);
  const bestSuit = new Array<number>(13).fill(0);
  const suits = new Set<number>();
  for (const c of cs) {
    const r = c >> 2;
    count[r]++;
    bestSuit[r] = Math.max(bestSuit[r], SUIT_STRENGTH[c & 3]);
    suits.add(c & 3);
  }
  const present: number[] = [];
  for (let r = 12; r >= 0; r--) if (count[r]) present.push(r);
  const flush = suits.size === 1;
  const once = (rs: number[]) => rs.every((r) => count[r] === 1);
  const mountain = once([8, 9, 10, 11, 12]);
  const back = once([12, 0, 1, 2, 3]);
  const run = present.length === 5 && present[0] - present[4] === 4;
  const high = present[0];
  // 같은 숫자 묶음: 장수 많은 순 → 숫자 높은 순
  const groups = [...present].sort((a, b) => count[b] - count[a] || b - a);
  const shape = groups.map((r) => count[r]).join("");
  const key = (cat: number, ranks: number[], suit: number): Key => [cat, ...[...ranks, 0, 0, 0, 0, 0].slice(0, 5), suit];

  if (flush && mountain) return key(RC.ROYAL, [], bestSuit[12]);
  if (flush && back) return key(RC.BACK_SF, [], bestSuit[12]);
  if (flush && run) return key(RC.SF, [high], bestSuit[high]);
  if (shape === "41") return key(RC.QUADS, groups, bestSuit[groups[0]]);
  if (shape === "32") return key(RC.FULL, groups, bestSuit[groups[0]]);
  if (flush) return key(RC.FLUSH, present, bestSuit[high]);
  if (mountain) return key(RC.MOUNTAIN, [], bestSuit[12]);
  if (back) return key(RC.BACK, [], bestSuit[12]);
  if (run) return key(RC.STRAIGHT, [high], bestSuit[high]);
  if (shape === "311") return key(RC.TRIPS, groups, bestSuit[groups[0]]);
  if (shape === "221") return key(RC.TWO_PAIR, groups, bestSuit[groups[0]]);
  if (shape === "2111") return key(RC.PAIR, groups, bestSuit[groups[0]]);
  return key(RC.TOP, present, bestSuit[high]);
}

/** n 장에서 5장을 고르는 모든 경우 (비트마스크) */
const FIVE_OF: number[][] = [];
for (let n = 5; n <= 7; n++) {
  FIVE_OF[n] = [];
  for (let m = 0; m < 1 << n; m++) {
    let bits = 0;
    for (let i = 0; i < n; i++) if (m & (1 << i)) bits++;
    if (bits === 5) FIVE_OF[n].push(m);
  }
}
function refBest(cards: readonly Card[]): Key {
  let best: Key | null = null;
  for (const m of FIVE_OF[cards.length]) {
    const k = refKey5(cards.filter((_, i) => m & (1 << i)));
    if (!best || cmpKey(k, best) > 0) best = k;
  }
  return best!;
}

/** 펴 놓은 카드의 순위 (룰 4) — openRank 와 독립 */
function refOpenKey(up: readonly Card[]): Key {
  const count = new Map<number, number>();
  const bestSuit = new Map<number, number>();
  for (const c of up) {
    count.set(c >> 2, (count.get(c >> 2) ?? 0) + 1);
    bestSuit.set(c >> 2, Math.max(bestSuit.get(c >> 2) ?? 0, SUIT_STRENGTH[c & 3]));
  }
  const groups = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || b - a);
  const shape = groups.map((r) => count.get(r)!);
  const cat = shape[0] === 4 ? 4 : shape[0] === 3 ? 3 : shape[0] === 2 && shape[1] === 2 ? 2 : shape[0] === 2 ? 1 : 0;
  return [cat, ...[...groups, 0, 0, 0, 0].slice(0, 4), bestSuit.get(groups[0]) ?? 0];
}

// ───────────── 룰 10: 족보 ─────────────

describe("한국식 족보 (룰 10)", () => {
  const ev = (t: string) => evaluateK(C(t));
  const cat = (t: string) => kCategory(ev(t));
  /** 왼쪽이 오른쪽보다 셈 */
  const beats = (a: string, b: string) => {
    expect(ev(a), `${a}  >  ${b}`).toBeGreaterThan(ev(b));
    // 따로 만든 판정도 같은 말을 해야 함 (테스트 자체의 실수 방지)
    expect(cmpKey(refBest(C(a)), refBest(C(b))), `기준 구현: ${a} > ${b}`).toBe(1);
  };
  /** 약한 것부터 차례로 세짐 */
  const ascending = (...hands: string[]) => {
    for (let i = 1; i < hands.length; i++) beats(hands[i], hands[i - 1]);
  };

  it("열세 가지 족보가 순서대로 셈", () => {
    const ladder: [string, number][] = [
      ["As Kd 9h 7c 3s", KCAT.TOP],
      ["2s 2d 5h 7c 9s", KCAT.PAIR],
      ["2s 2d 3h 3c 9s", KCAT.TWO_PAIR],
      ["2s 2d 2h 7c 9s", KCAT.TRIPS],
      ["2d 3h 4c 5s 6s", KCAT.STRAIGHT],
      ["As 2d 3h 4c 5s", KCAT.BACK_STRAIGHT],
      ["Ts Jd Qh Kc As", KCAT.MOUNTAIN],
      ["2s 4s 6s 8s 9s", KCAT.FLUSH],
      ["2s 2d 2h 3c 3s", KCAT.FULL_HOUSE],
      ["2s 2d 2h 2c 3s", KCAT.QUADS],
      ["2s 3s 4s 5s 6s", KCAT.STRAIGHT_FLUSH],
      ["Ac 2c 3c 4c 5c", KCAT.BACK_STRAIGHT_FLUSH],
      ["Tc Jc Qc Kc Ac", KCAT.ROYAL],
    ];
    expect(ladder.map(([h]) => cat(h))).toEqual(ladder.map(([, k]) => k));
    ascending(...ladder.map(([h]) => h));
  });

  it("가장 센 낮은 족보 < 가장 약한 높은 족보", () => {
    beats("2h 2c 3d 4s 5d", "As Kd Qh Jc 9s"); // 원페어 > 탑
    beats("3h 3c 2h 2c 4d", "As Ad Kh Qc Js"); // 투페어 > 원페어
    beats("2h 2d 2c 3s 4s", "As Ad Ks Kd Qs"); // 트리플 > 투페어
    beats("2c 3h 4c 5s 6c", "As Ad Ah Ks Qs"); // 스트레이트 > 트리플
    beats("Ac 2d 3h 4s 5s", "9s Td Jh Qc Ks"); // 백스트레이트 > K 스트레이트
    beats("Tc Jd Qh Ks Ac", "As 2d 3h 4c 5s"); // 마운틴 > 백스트레이트
    beats("2c 3c 4c 5c 7c", "Ts Jd Qh Kc As"); // 플러시 > 마운틴
    beats("2h 2d 2c 3h 3c", "As Ks Qs Js 9s"); // 풀하우스 > 플러시
    beats("2s 2d 2h 2c 3c", "As Ad Ah Ks Kd"); // 포카드 > 풀하우스
    beats("2c 3c 4c 5c 6c", "As Ad Ah Ac Ks"); // 스트레이트 플러시 > 포카드
    beats("Ac 2c 3c 4c 5c", "9s Ts Js Qs Ks"); // 백 스트레이트 플러시 > K 스트레이트 플러시
    beats("Tc Jc Qc Kc Ac", "As 2s 3s 4s 5s"); // 로열 > 백 스트레이트 플러시
  });

  it("스트레이트: 마운틴 > 백스트레이트 > K > … > 6", () => {
    ascending("2d 3h 4c 5s 6s", "3d 4h 5c 6s 7s", "8s 9d Th Jc Qs", "9s Td Jh Qc Ks", "As 2d 3h 4c 5s", "Ts Jd Qh Kc As");
    expect(cat("9s Td Jh Qc Ks")).toBe(KCAT.STRAIGHT);
    // Q-K-A-2-3 · K-A-2-3-4 는 스트레이트가 아님
    expect(cat("Qs Kd Ah 2c 3s")).toBe(KCAT.TOP);
    expect(cat("Ks Ad 2h 3c 4s")).toBe(KCAT.TOP);
  });

  it("스트레이트 플러시: 로열 > 백 > K > … > 6", () => {
    ascending("2h 3h 4h 5h 6h", "8c 9c Tc Jc Qc", "9c Tc Jc Qc Kc", "Ac 2c 3c 4c 5c", "Tc Jc Qc Kc Ac");
    expect(cat("9c Tc Jc Qc Kc")).toBe(KCAT.STRAIGHT_FLUSH);
  });

  it("숫자(킥커)로 가림", () => {
    beats("As Kd 9h 7c 3s", "Ad Ks 9c 7h 2s");
    beats("As Qd 9h 7c 3s", "Ks Qs 9c 7h 3d");
    beats("3s 3d Ah Kc Qs", "2s 2d Ah Kc Qd");
    beats("As Ad Kh 7c 3s", "Ah Ac Qh Jc Ts");
    beats("As Ad Kh 7c 3s", "Ah Ac Kd 7d 2s");
    beats("As Ad 3h 3c 2s", "Ks Kd Qh Qc Js");
    beats("As Ad Kh Kc 3s", "Ah Ac Qh Qc Js");
    beats("As Ad 3h 3c Ks", "Ah Ac 3d 3s Qs");
    beats("3s 3d 3h 4c 5s", "2s 2d 2h Ac Ks");
    beats("7s 7d 7h Ac 3s", "7s 7d 7h Kc Qs");
    beats("7s 7d 7h Ac 3s", "7s 7d 7h Ac 2s");
    beats("7s 7d 7h 7c As", "7s 7d 7h 7c Ks");
    beats("3s 3d 3h 3c 2s", "2s 2d 2h 2c As");
    beats("4s 4d 4h 2c 2s", "3s 3d 3h Ac As");
    beats("4s 4d 4h Ac As", "4s 4d 4h Kc Ks");
    beats("As Ks Qs Js 9s", "Ad Kd Qd Jd 8d");
    beats("As 7s 5s 4s 3s", "Kd Qd Jd Td 8d");
  });

  it("숫자가 다 같으면 무늬 (♠ ♦ ♥ ♣ 순)", () => {
    // 탑 · 스트레이트 · 플러시 계열은 가장 높은 카드의 무늬
    ascending("Ac Ks 9s 7s 3d", "Ah Ks 9s 7s 3d", "Ad Ks 9s 7s 3h", "As Kc 9c 7c 3d");
    ascending("5s 6s 7s 8d 9c", "5s 6s 7s 8d 9h", "5s 6s 7s 8h 9d", "5c 6c 7c 8d 9s");
    ascending("Tc Jc Qd Kd Ac", "Ts Js Qs Kd Ah", "Ts Js Qs Kh Ad", "Tc Jc Qc Kd As");
    ascending("Ac Kc 9c 7c 3c", "Ah Kh 9h 7h 3h", "Ad Kd 9d 7d 3d", "As Ks 9s 7s 3s");
    ascending("5c 6c 7c 8c 9c", "5h 6h 7h 8h 9h", "5d 6d 7d 8d 9d", "5s 6s 7s 8s 9s");
    ascending("Tc Jc Qc Kc Ac", "Th Jh Qh Kh Ah", "Td Jd Qd Kd Ad", "Ts Js Qs Ks As");
    // 백스트레이트는 A 의 무늬 (5 의 무늬가 아님)
    ascending("Ac 2s 3s 4s 5d", "Ah 2s 3s 4s 5d", "Ad 2s 3s 4s 5h", "As 2c 3c 4c 5d");
    beats("As 2c 3c 4c 5c", "Ad 2s 3s 4s 5s");
    ascending("Ac 2c 3c 4c 5c", "Ah 2h 3h 4h 5h", "Ad 2d 3d 4d 5d", "As 2s 3s 4s 5s");
    // 원페어 · 투페어 · 트리플 · 풀하우스는 가장 큰 묶음에서 가장 센 무늬
    beats("Ks Kh Ac 7c 3c", "Kd Kc As 7s 3s");
    beats("Ks Kc Ac 7c 3c", "Kd Kh As 7s 3s");
    beats("Kd Kc Ac 7c 3c", "Kh Kc As 7s 3s");
    beats("Ks Kc 5h 5c Ad", "Kd Kh 5s 5d As"); // 낮은 페어 · 킥커의 무늬는 안 봄
    beats("7s 7h 7c Ah Kh", "7d 7h 7c As Ks");
    beats("7s 7h 7c Kh Kc", "7d 7h 7c Ks Kd");
  });

  it("무늬보다 숫자가 먼저", () => {
    beats("Ac Kc Qc Jc 9d", "As Ks Qs Js 8d"); // 탑
    beats("Kh Kc Ac 7c 3c", "Ks Kd Qs 7s 3s"); // 원페어 킥커
    beats("Kh Kc Ac 7c 3c", "Ks Kd As 7s 2s");
    beats("Kh Kc 5h 5c Ac", "Ks Kd 5s 5d Qs"); // 투페어 킥커
    beats("Kh Kc 6h 6c 2c", "Ks Kd 5s 5d As"); // 투페어 낮은 페어
    beats("6c 7c 8c 9c Td", "5s 6s 7s 8s 9d"); // 스트레이트
    beats("Ac Kc Qc Jc 9c", "As Ks Qs Js 8s"); // 플러시
    beats("6c 7c 8c 9c Tc", "5s 6s 7s 8s 9s"); // 스트레이트 플러시
  });

  it("7장에서 가장 센 5장을 고름", () => {
    const same = (seven: string, five: string) => expect(ev(seven), `${seven} → ${five}`).toBe(ev(five));
    // 페어 셋 → 높은 두 페어 + 가장 높은 킥커
    same("As Ad Ks Kd Qs Qd 2c", "As Ad Ks Kd Qs");
    same("9s 9d 5s 5d 3s 3d Ac", "9s 9d 5s 5d Ac");
    same("9s 9d 5s 5d 3s 3d 2c", "9s 9d 5s 5d 3s");
    // 트리플 둘 → 풀하우스 (높은 쪽이 트리플)
    same("As Ad Ah Ks Kd Kh 2c", "As Ad Ah Ks Kd");
    same("3s 3d 3h Ks Kd Kh Ac", "Ks Kd Kh 3s 3d");
    // 트리플 + 페어 둘 → 높은 페어
    same("7s 7d 7h Ks Kd 2h 2c", "7s 7d 7h Ks Kd");
    // 포카드 + 트리플 · 포카드 + 페어 + 높은 한 장
    same("7s 7d 7h 7c Ks Kd Kh", "7s 7d 7h 7c Ks");
    same("7s 7d 7h 7c 2s 2d Ah", "7s 7d 7h 7c Ah");
    // 같은 무늬 6·7장 → 위에서 5장
    same("As Ks 9s 7s 5s 3s 2d", "As Ks 9s 7s 5s");
    same("As Ks 9s 7s 5s 3s 2s", "As Ks 9s 7s 5s");
    // 스트레이트와 플러시가 서로 다른 5장으로 됨 → 플러시 (스트레이트 플러시는 아님)
    expect(cat("5s 6s 7s 8d 9d Ks 2s")).toBe(KCAT.FLUSH);
    same("5s 6s 7s 8d 9d Ks 2s", "Ks 7s 6s 5s 2s");
    expect(cat("As 2s 3s 4s 5d 9s Kc")).toBe(KCAT.FLUSH);
    // 스트레이트 플러시가 일반 스트레이트보다 낮은 끗이어도 스트레이트 플러시
    expect(cat("5s 6s 7s 8s 9s Td Jc")).toBe(KCAT.STRAIGHT_FLUSH);
    same("5s 6s 7s 8s 9s Td Jc", "5s 6s 7s 8s 9s");
    // A-2-3-4-5-6: 6 스트레이트가 아니라 백스트레이트 (더 셈)
    expect(cat("As 2d 3h 4c 5s 6d Kc")).toBe(KCAT.BACK_STRAIGHT);
    expect(cat("As 2s 3s 4s 5s 6s Kc")).toBe(KCAT.BACK_STRAIGHT_FLUSH);
    // 9-T-J-Q-K-A: 마운틴
    expect(cat("9s Td Jh Qc Ks Ad 2c")).toBe(KCAT.MOUNTAIN);
    expect(cat("As 2d 3h 4c 5s Kd Qh")).toBe(KCAT.BACK_STRAIGHT);
    // 스트레이트 > 트리플 (둘 다 될 때), 6·7장 스트레이트 → 가장 높은 끗
    expect(cat("5s 5d 5h 6c 7s 8d 9c")).toBe(KCAT.STRAIGHT);
    same("4s 5d 6h 7c 8s 9d Tc", "6h 7c 8s 9d Tc");
    // 맨 위 숫자가 두 장이면 센 무늬 쪽을 씀
    same("5d 6d 7h 8h 9c 9s 2c", "5d 6d 7h 8h 9s");
    same("Ac As 2d 3h 4c 5d Kh", "As 2d 3h 4c 5d");
    same("Ks Kc Ad 9h 7c 3d 2h", "Ks Kc Ad 9h 7c");
    same("Ac Kd Qh Jc 9s 3d 2h", "Ac Kd Qh Jc 9s");
    // 5 · 6장
    same("As Ad Ks Kd Qs Qd", "As Ad Ks Kd Qs");
  });

  it("bestK 가 고른 5장 · 이름", () => {
    const seven = C("9s 9d 5s 5d 3s 3d Ac");
    const b = bestK(seven);
    expect(b.five).toHaveLength(5);
    expect(evaluateK(b.five)).toBe(b.score);
    expect(sortedJoin(b.five)).toBe(sortedJoin(C("9s 9d 5s 5d Ac")));
    expect(handNameK(ev("Ts Js Qs Ks As"))).toBe("로열 스트레이트 플러시");
    expect(handNameK(ev("Ac 2c 3c 4c 5c"))).toBe("백 스트레이트 플러시");
    expect(handNameK(ev("5s 6s 7s 8s 9s"))).toBe("9 스트레이트 플러시");
    expect(handNameK(ev("7s 7d 7h 7c As"))).toBe("7 포카드");
    expect(handNameK(ev("7s 7d 7h Kc Ks"))).toBe("7·K 풀하우스");
    expect(handNameK(ev("As Ks 9s 7s 5s"))).toBe("A 플러시");
    expect(handNameK(ev("Ts Jd Qh Kc As"))).toBe("마운틴");
    expect(handNameK(ev("As 2d 3h 4c 5s"))).toBe("백스트레이트");
    expect(handNameK(ev("5s 6d 7h 8c 9s"))).toBe("9 스트레이트");
    expect(handNameK(ev("7s 7d 7h Kc 2s"))).toBe("7 트리플");
    expect(handNameK(ev("As Ad 7h 7c 3s"))).toBe("A·7 투페어");
    expect(handNameK(ev("Ts Td 7h 5c 3s"))).toBe("10 원페어");
    expect(handNameK(ev("Ks Jd 7h 5c 3s"))).toBe("K 탑");
  });

  /** 엔진 쪽 판정과 따로 만든 판정이 두 패의 대소를 똑같이 말하는지 */
  function crossCheck(name: string, hands: Card[][], seen: Set<number>) {
    let prev: { e: number; k: Key; cards: Card[] } | null = null;
    for (const cards of hands) {
      const b = bestK(cards);
      const k = refBest(cards);
      const lab = () => cards.map((c) => `${"23456789TJQKA"[c >> 2]}${SUIT_CH[c & 3]}`).join(" ");
      if (kCategory(b.score) !== KC[k[0]]) throw new Error(`${name}: 족보가 다름 [${lab()}] ${kCategory(b.score)} vs ${KC[k[0]]}`);
      if (b.five.length !== 5 || new Set(b.five).size !== 5 || b.five.some((c) => !cards.includes(c)) || evaluateK(b.five) !== b.score)
        throw new Error(`${name}: bestK().five 가 이상함 [${lab()}] → ${b.five}`);
      if (cmpKey(refKey5(b.five), k) !== 0) throw new Error(`${name}: 고른 5장이 가장 센 5장이 아님 [${lab()}]`);
      seen.add(k[0]);
      if (prev && Math.sign(b.score - prev.e) !== cmpKey(k, prev.k))
        throw new Error(`${name}: 대소가 다름 [${lab()}] vs [${prev.cards}] → 엔진 ${Math.sign(b.score - prev.e)} / 기준 ${cmpKey(k, prev.k)}`);
      prev = { e: b.score, k, cards };
    }
  }

  it("무작위 7장 2만 5천 개 (+ 5·6장): 따로 만든 판정과 대소가 같음", () => {
    const rng = mulberry32(20261007);
    const ri = (k: number) => Math.floor(rng() * k);
    const hands: Card[][] = [];
    for (let i = 0; i < 25000; i++) hands.push(shuffledDeck(ri).slice(0, 7));
    for (let i = 0; i < 4000; i++) hands.push(shuffledDeck(ri).slice(0, 5 + (i % 2)));
    const seen = new Set<number>();
    crossCheck("무작위", hands, seen);
    expect(seen.size).toBeGreaterThanOrEqual(9);
  }, 120_000);

  it("드문 족보 보강: 무늬 둘짜리 덱 · 좁은 끗 · 무늬만 바꾼 쌍둥이", () => {
    const rng = mulberry32(77);
    const ri = (k: number) => Math.floor(rng() * k);
    const shuffle = (pool: Card[]) => {
      for (let k = pool.length - 1; k > 0; k--) {
        const j = ri(k + 1);
        [pool[k], pool[j]] = [pool[j], pool[k]];
      }
      return pool;
    };
    const seen = new Set<number>();

    // (1) 무늬 둘만 있는 덱 — 플러시 · 스트레이트 플러시 · 로열이 자주 나옴
    const two: Card[][] = [];
    for (let i = 0; i < 12000; i++) {
      const s1 = ri(4);
      const s2 = (s1 + 1 + ri(3)) % 4;
      const pool: Card[] = [];
      for (let r = 0; r < 13; r++) pool.push((r << 2) | s1, (r << 2) | s2);
      two.push(shuffle(pool).slice(0, 7));
    }
    crossCheck("무늬 둘", two, seen);

    // (2) 끗을 좁힘 — 스트레이트 · 마운틴 · 백스트레이트 · 풀하우스 · 포카드 · 킥커 싸움
    const narrow: Card[][] = [];
    for (let i = 0; i < 12000; i++) {
      const pool: Card[] = [];
      const lo = ri(9);
      for (let r = lo; r < lo + 6 && r < 13; r++) for (let s = 0; s < 4; s++) pool.push((r << 2) | s);
      if (lo < 4) for (let s = 0; s < 4; s++) pool.push((12 << 2) | s);
      narrow.push(shuffle(pool).slice(0, 7));
    }
    crossCheck("좁은 끗", narrow, seen);

    // (3) 한 무늬로 이어지는 다섯 끗(lo = 0 이면 A-2-3-4-5) + 같은 무늬 세 장 + 다른 무늬 한 장에서 7장 — 스트레이트 플러시끼리
    const sf: Card[][] = [];
    for (let i = 0; i < 4000; i++) {
      const s = ri(4);
      const o = (s + 1 + ri(3)) % 4;
      const lo = ri(9);
      const run = lo === 0 ? [12, 0, 1, 2, 3] : [lo, lo + 1, lo + 2, lo + 3, lo + 4];
      const rest: number[] = [];
      for (let r = 0; r < 13; r++) if (!run.includes(r)) rest.push(r);
      const suited = [...run, ...shuffle(rest).slice(0, 3)].map((r) => (r << 2) | s);
      sf.push(shuffle([...suited, (ri(13) << 2) | o]).slice(0, 7));
    }
    crossCheck("한 무늬", sf, seen);

    // (4) 숫자는 그대로 두고 무늬만 바꾼 쌍둥이 — 무늬로만 갈리는 승부
    let suitOnly = 0;
    for (let i = 0; i < 12000; i++) {
      const a = (i % 3 === 0 ? two[i] : i % 3 === 1 ? narrow[i] : shuffledDeck(ri).slice(0, 7)) as Card[];
      const perm = shuffle([0, 1, 2, 3]);
      const b = a.map((c) => ((c >> 2) << 2) | perm[c & 3]);
      const d1 = Math.sign(evaluateK(a) - evaluateK(b));
      const d2 = cmpKey(refBest(a), refBest(b));
      if (d1 !== d2) throw new Error(`쌍둥이: 대소가 다름 [${a}] vs [${b}] → 엔진 ${d1} / 기준 ${d2}`);
      if (d2 !== 0) suitOnly++;
    }
    expect(suitOnly).toBeGreaterThan(3000);
    // 열세 가지가 전부 나왔어야 함
    expect([...seen].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  }, 120_000);

  it("서로 다른 카드로 된 두 패는 비기지 않음", () => {
    const rng = mulberry32(5);
    const ri = (k: number) => Math.floor(rng() * k);
    for (let i = 0; i < 6000; i++) {
      // 끗을 좁혀서 같은 숫자 조합이 자주 나오게
      const pool: Card[] = [];
      const lo = ri(8);
      for (let r = lo; r < lo + 5; r++) for (let s = 0; s < 4; s++) pool.push((r << 2) | s);
      for (let k = pool.length - 1; k > 0; k--) {
        const j = ri(k + 1);
        [pool[k], pool[j]] = [pool[j], pool[k]];
      }
      const a = pool.slice(0, 7);
      const b = pool.slice(7, 14);
      if (evaluateK(a) === evaluateK(b)) throw new Error(`비김: [${a}] vs [${b}]`);
    }
  });
});

// ───────────── 룰 4: 펴 놓은 카드의 순위 ─────────────

describe("펴 놓은 카드의 순위 openRank (룰 4)", () => {
  const or = (t: string) => openRank(C(t));
  const ascending = (...ups: string[]) => {
    for (let i = 1; i < ups.length; i++) {
      expect(or(ups[i]), `${ups[i]} > ${ups[i - 1]}`).toBeGreaterThan(or(ups[i - 1]));
      expect(cmpKey(refOpenKey(C(ups[i])), refOpenKey(C(ups[i - 1])))).toBe(1);
    }
  };

  it("포카드 > 트리플 > 투페어 > 원페어 > 높은 카드", () => {
    ascending("As Kd Qh Jc", "2s 2d 3h 4c", "3s 3d 2h 2c", "2s 2d 2h 3c", "2s 2d 2h 2c");
    ascending("As Kd Qh", "2s 2d 3h", "2s 2d 2h");
    ascending("As Ad Kh Qc", "3s 3d 2h 2c"); // 낮은 투페어 > 높은 원페어
    ascending("As Ad Ks Kd", "2s 2d 2h 3c"); // 낮은 트리플 > 높은 투페어
    ascending("As Ad Ah Kd", "2s 2d 2h 2c");
    ascending("As Kd", "2h 2c");
  });

  it("같은 족보면 숫자, 그다음 무늬 (♠ ♦ ♥ ♣ 순)", () => {
    ascending("2c", "2h", "2d", "2s", "3c", "Kc", "Ac", "Ah", "Ad", "As");
    ascending("As Qd", "Ac Kd"); // 숫자가 먼저
    ascending("As 2d", "Ac 3d");
    ascending("Ac 7s", "Ah 7c", "Ad 7c", "As 7c"); // 숫자가 같으면 가장 높은 카드의 무늬
    ascending("9d 9h", "9s 9c"); // 페어는 그 페어에서 가장 센 무늬
    ascending("9s 9c Kd", "9d 9h Ac"); // 킥커가 무늬보다 먼저
    ascending("Ks Kd 5h 5c", "Ah Ac 2h 2c");
    ascending("Kh Kc 5s 5d", "Kd Ks 5h 5c"); // 같은 투페어 → 높은 페어의 무늬
    ascending("As Ad Ks Kd", "2h 2d 2c 3s");
  });

  it("무작위: 따로 만든 순위와 대소가 같음", () => {
    const rng = mulberry32(9);
    const ri = (k: number) => Math.floor(rng() * k);
    for (let i = 0; i < 20000; i++) {
      const n = 1 + (i % 4);
      // 끗을 좁혀서 페어 · 트리플이 자주 나오게
      const pool: Card[] = [];
      const lo = ri(10);
      for (let r = lo; r < lo + 4 && r < 13; r++) for (let s = 0; s < 4; s++) pool.push((r << 2) | s);
      for (let k = pool.length - 1; k > 0; k--) {
        const j = ri(k + 1);
        [pool[k], pool[j]] = [pool[j], pool[k]];
      }
      const a = pool.slice(0, n);
      const b = pool.slice(n, 2 * n);
      const d1 = Math.sign(openRank(a) - openRank(b));
      const d2 = cmpKey(refOpenKey(a), refOpenKey(b));
      if (d1 !== d2 || d1 === 0) throw new Error(`대소가 다름: [${a}] vs [${b}] → ${d1} / ${d2}`);
    }
  });
});

// ───────────── 기본 선택 ─────────────

describe("autoChoice (기본 선택)", () => {
  it("언제나 서로 다른 0~3 위치를 돌려줌 · 받은 카드를 안 건드림", () => {
    const rng = mulberry32(3);
    const ri = (k: number) => Math.floor(rng() * k);
    for (let i = 0; i < 30000; i++) {
      const dealt = shuffledDeck(ri).slice(0, 4);
      const copy = [...dealt];
      const c = autoChoice(dealt);
      if (![0, 1, 2, 3].includes(c.discard) || ![0, 1, 2, 3].includes(c.open) || c.discard === c.open) throw new Error(`[${dealt}] → ${JSON.stringify(c)}`);
      expect(dealt).toEqual(copy);
    }
  });

  it("(seven.ts 주석대로) 트리플 · 페어는 남기고, 페어는 숨김", () => {
    const pick = (t: string) => {
      const d = C(t);
      const c = autoChoice(d);
      return { discard: d[c.discard], open: d[c.open] };
    };
    const [k2] = C("2c");
    expect(pick("Ks Kd Kh 2c").discard).toBe(k2);
    expect(pick("2c Ks Kd Kh").discard).toBe(k2);
    // 페어 + 나머지 둘: 페어는 엎어 둠
    for (const t of ["Ks Kd 7h 2c", "7h Ks 2c Kd", "2c 7h Kd Ks"]) {
      const p = pick(t);
      expect(p.discard >> 2, t).not.toBe(11);
      expect(p.open >> 2, t).not.toBe(11);
    }
    // 투페어: 높은 페어를 남기고 낮은 쪽 한 장을 폄
    const tp = pick("Ks Kd 7h 7c");
    expect(tp.discard >> 2).toBe(5);
    expect(tp.open >> 2).toBe(5);
  });
});

// ───────────── 덱 짜기 ─────────────

interface Rig {
  stacks: Record<number, number>;
  ante?: number;
  unit?: number;
  /** 자리 → 처음 받는 4장. chooseAll 의 기본 선택(3 을 버리고 2 를 폄) 기준으로 "엎 엎 폄 버림". "?" 는 아무 카드 */
  dealt?: Record<number, string>;
  /** 자리 → 4·5·6·7구에 받는 카드 */
  later?: Record<number, string>;
  /** 자리 → 이 구부터는 카드를 안 받음 (그 전에 죽음) */
  gone?: Record<number, number>;
}

/** 원하는 카드가 나오도록 덱을 짬. 뽑히는 순서: 한 장씩 네 바퀴(자리 순) → 구마다 살아 있는 사람에게 자리 순으로 한 장 */
function rigDeck(o: Rig): Card[] {
  const seats = Object.keys(o.stacks)
    .map(Number)
    .sort((a, b) => a - b);
  const parse = (t: string | undefined): (Card | null)[] => {
    const out: (Card | null)[] = (t ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((x) => (x === "?" ? null : C(x)[0]));
    while (out.length < 4) out.push(null);
    return out;
  };
  const dealt = new Map(seats.map((s) => [s, parse(o.dealt?.[s])]));
  const later = new Map(seats.map((s) => [s, parse(o.later?.[s])]));
  const used = new Set<Card>();
  for (const m of [dealt, later])
    for (const list of m.values())
      for (const c of list) {
        if (c === null) continue;
        if (used.has(c)) throw new Error(`덱 짜기: 같은 카드가 두 번 (${c})`);
        used.add(c);
      }
  const spare: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) spare.push(c);
  const take = () => spare.shift()!;
  const seq: Card[] = [];
  for (let i = 0; i < 4; i++) for (const s of seats) seq.push(dealt.get(s)![i] ?? take());
  for (let r = 4; r <= 7; r++)
    for (const s of seats) {
      if ((o.gone?.[s] ?? 99) <= r) continue;
      seq.push(later.get(s)![r - 4] ?? take());
    }
  // 덱은 뒤에서부터 뽑음
  return [...spare, ...seq.reverse()];
}

function mk(o: Rig): SevenHand {
  return new SevenHand({
    seats: Object.entries(o.stacks).map(([seat, stack]) => ({ seat: Number(seat), stack })),
    ante: o.ante ?? 100,
    unit: o.unit ?? 10,
    deck: rigDeck(o),
  });
}

/** 아직 안 고른 사람 모두: 4번째 카드를 버리고 3번째 카드를 폄 */
function chooseAll(h: SevenHand) {
  for (const s of h.choosing()) h.choose(s, 3, 2);
}

/**
 * 기본 판. hero 는 4구부터 A 페어를 펴 놓아 끝까지 보스이고, 쇼다운도 이김(A 원페어).
 * 나머지는 전부 K 탑(K Q 10 8 6)이라 K 의 무늬로 갈림 — hero 를 뺀 자리 순으로 j 번째: 2번째(♠) > 0번째(♦) > 3번째(♥) > 1번째(♣)
 */
function preset(seats: number[], hero: number): Required<Pick<Rig, "dealt" | "later">> {
  const ranks = ["2", "4", "6", "8", "T", "Q", "K"];
  const junk = ["7s", "7h", "7c", "9s"];
  const dealt: Record<number, string> = { [hero]: "3s 5h As 3h" };
  const later: Record<number, string> = { [hero]: "Ad 7d 9c Js" };
  seats
    .filter((s) => s !== hero)
    .sort((a, b) => a - b)
    .forEach((seat, j) => {
      const c = ranks.map((r, k) => r + SUIT_CH[(j + k) % 4]);
      dealt[seat] = `${c[0]} ${c[1]} ${c[2]} ${junk[j]}`;
      later[seat] = c.slice(3).join(" ");
    });
  return { dealt, later };
}

/** 기본 판을 만들고 다 고른 상태 (phase deal, 아직 3구) */
function table(stacks: Record<number, number>, hero: number, extra: Partial<Rig> = {}): SevenHand {
  const h = mk({ stacks, ...preset(Object.keys(stacks).map(Number), hero), ...extra });
  chooseAll(h);
  return h;
}
/** 기본 판의 4구 베팅 시작 */
function start(stacks: Record<number, number>, hero: number, extra: Partial<Rig> = {}): SevenHand {
  const h = table(stacks, hero, extra);
  h.advance();
  return h;
}

type Step = [seat: number, type: SevenAct];
function play(h: SevenHand, steps: Step[]) {
  for (const [seat, type] of steps) h.act(seat, type);
}
/** phase 가 deal 인 동안 계속 돌림 */
function runOut(h: SevenHand): number {
  let n = 0;
  while (h.phase === "deal") {
    h.advance();
    if (++n > 8) throw new Error("advance 가 끝나지 않음");
  }
  return n;
}
/** 이번 구를 전부 체크로 넘김 */
function checkRound(h: SevenHand) {
  let guard = 0;
  while (h.phase === "bet") {
    h.act(h.toAct, "check");
    if (++guard > 20) throw new Error("베팅이 끝나지 않음");
  }
}
/** 남은 구를 전부 체크로 넘기며 끝까지 */
function checkDown(h: SevenHand) {
  let guard = 0;
  while (h.phase !== "done") {
    if (h.phase === "deal") h.advance();
    else h.act(h.toAct, "check");
    if (++guard > 80) throw new Error("끝나지 않음");
  }
}
const stacksOf = (h: SevenHand) => Object.fromEntries(h.players.map((p) => [p.seat, p.stack]));
const upOf = (h: SevenHand, seat: number) => h.upCards(h.player(seat)!);

/** 룰 11: 칩 보존 */
function expectConserved(h: SevenHand) {
  expect(h.phase).toBe("done");
  const r = h.result!;
  expect(sum(h.players.map((p) => p.stack))).toBe(sum(h.players.map((p) => p.start)));
  for (const p of h.players) expect(r.delta[p.seat]).toBe(p.stack - p.start);
  expect(sum(Object.values(r.delta))).toBe(0);
  expect(sum(Object.values(r.won))).toBe(sum(r.pots.map((p) => p.amount)));
}

/** 룰 12: SevenError 를 내고 상태는 그대로 */
function rejects(h: SevenHand, fn: () => unknown, what = "") {
  const before = JSON.stringify(h);
  expect(fn, what).toThrow(SevenError);
  expect(JSON.stringify(h), `${what}: 상태가 바뀜`).toBe(before);
}

describe("덱 짜기 도우미", () => {
  it("네 바퀴로 한 장씩 → 구마다 살아 있는 사람에게 자리 순으로", () => {
    const h = mk({
      stacks: { 1: 1000, 4: 1000, 6: 1000 },
      dealt: { 1: "As Ah Kd 2c", 4: "Ks Kh Qd 3c", 6: "Qs Qh Jd 4c" },
      later: { 1: "5s 6s 7s 8s", 4: "5h 6h 7h 8h", 6: "5d 6d 7d 8d" },
      gone: { 4: 6 },
    });
    expect(h.player(1)!.dealt).toEqual(C("As Ah Kd 2c"));
    expect(h.player(4)!.dealt).toEqual(C("Ks Kh Qd 3c"));
    expect(h.player(6)!.dealt).toEqual(C("Qs Qh Jd 4c"));
    chooseAll(h);
    expect(sortedJoin(h.player(1)!.cards)).toBe(sortedJoin(C("As Ah Kd")));
    expect(upOf(h, 4)).toEqual(C("Qd"));
    expect(h.advance()).toEqual([
      { seat: 1, card: C("5s")[0], up: true },
      { seat: 4, card: C("5h")[0], up: true },
      { seat: 6, card: C("5d")[0], up: true },
    ]);
    checkRound(h);
    h.advance();
    expect(sortedJoin(h.player(4)!.cards)).toBe(sortedJoin(C("Ks Kh Qd 5h 6h")));
    // 4번이 죽으면 6구부터는 1 · 6번만 받음
    while (h.toAct !== 4) h.act(h.toAct, "check");
    h.act(4, "die");
    checkRound(h);
    expect(h.advance()).toEqual([
      { seat: 1, card: C("7s")[0], up: true },
      { seat: 6, card: C("7d")[0], up: true },
    ]);
    checkDown(h);
    expect(sortedJoin(h.player(1)!.cards)).toBe(sortedJoin(C("As Ah Kd 5s 6s 7s 8s")));
    expect(sortedJoin(h.player(6)!.cards)).toBe(sortedJoin(C("Qs Qh Jd 5d 6d 7d 8d")));
    expect(sortedJoin(h.player(4)!.cards)).toBe(sortedJoin(C("Ks Kh Qd 5h 6h")));
  });

  it("기본 판: hero 가 4구부터 보스이고 쇼다운도 이김, 나머지는 K 의 무늬 순", () => {
    const h = table({ 0: 1000, 2: 1000, 3: 1000, 5: 1000, 8: 1000 }, 3);
    for (let r = 4; r <= 7; r++) {
      h.advance();
      expect(h.boss).toBe(3);
      expect(h.toAct).toBe(3);
      checkRound(h);
    }
    h.advance();
    const ranked = [...h.result!.shows].sort((a, b) => b.score - a.score);
    expect(ranked.map((s) => s.seat)).toEqual([3, 5, 0, 8, 2]);
    expect(ranked.map((s) => s.name)).toEqual(["A 원페어", "K 탑", "K 탑", "K 탑", "K 탑"]);
    expect(h.result!.won).toEqual({ 3: 500 });
    expectConserved(h);
  });
});

// ───────────── 룰 1: 앤티 ─────────────

describe("앤티 (룰 1)", () => {
  it("모두 앤티를 내고 바로 팟으로 (구별 벳이 아님), 4장씩 받고 고르기부터", () => {
    const h = mk({ stacks: { 0: 1000, 3: 1000, 5: 1000 } });
    expect(stacksOf(h)).toEqual({ 0: 900, 3: 900, 5: 900 });
    expect(h.pot).toBe(300);
    expect(h.phase).toBe("choice");
    expect(h.currentBet).toBe(0);
    expect(h.toAct).toBe(-1);
    for (const p of h.players) {
      expect(p).toMatchObject({ bet: 0, invested: 100, allIn: false, folded: false, chosen: false });
      expect(p.dealt).toHaveLength(4);
      expect(p.cards).toHaveLength(0);
    }
    expect(h.choosing()).toEqual([0, 3, 5]);
    expect(h.history.map((x) => [x.seat, x.type, x.add])).toEqual([
      [0, "ante", 100],
      [3, "ante", 100],
      [5, "ante", 100],
    ]);
    expect(new Set(h.players.flatMap((p) => p.dealt)).size).toBe(12);
  });

  it("모자라면 있는 만큼 내고 올인", () => {
    const h = mk({ stacks: { 0: 1000, 3: 60, 5: 100 } });
    expect(stacksOf(h)).toEqual({ 0: 900, 3: 0, 5: 0 });
    expect(h.player(3)).toMatchObject({ invested: 60, allIn: true, bet: 0 });
    expect(h.player(5)).toMatchObject({ invested: 100, allIn: true, bet: 0 });
    expect(h.pot).toBe(260);
    // 올인한 사람도 고름
    expect(h.choosing()).toEqual([0, 3, 5]);
  });

  it("2~5명", () => {
    expect(() => mk({ stacks: { 0: 1000 } })).toThrow(SevenError);
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 1000, 4: 1000 } });
    chooseAll(h);
    checkDown(h);
    expectConserved(h);
    expect(h.result!.shows).toHaveLength(5);
  });
});

// ───────────── 룰 2: 고르기 ─────────────

describe("고르기 (룰 2)", () => {
  it("한 장 버리고 한 장 펴고 두 장은 엎어 둠. 다 고르면 deal", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, dealt: { 0: "As Ah Kd 2c", 1: "Ks Kh Qd 3c", 2: "Qs Qh Jd 4c" } });
    h.choose(0, 3, 2);
    expect(h.player(0)!.chosen).toBe(true);
    expect(sortedJoin(h.player(0)!.cards)).toBe(sortedJoin(C("As Ah Kd")));
    expect(upOf(h, 0)).toEqual(C("Kd"));
    expect(h.player(0)!.up.filter((u) => !u)).toHaveLength(2);
    expect(h.phase).toBe("choice");
    expect(h.choosing()).toEqual([1, 2]);
    // 버린 카드 0번, 편 카드 1번
    h.choose(1, 0, 1);
    expect(sortedJoin(h.player(1)!.cards)).toBe(sortedJoin(C("Kh Qd 3c")));
    expect(upOf(h, 1)).toEqual(C("Kh"));
    expect(h.phase).toBe("choice");
    h.autoChoose(2);
    const p = h.player(2)!;
    expect(p.cards).toHaveLength(3);
    expect(p.cards.every((c) => p.dealt.includes(c))).toBe(true);
    expect(p.up.filter(Boolean)).toHaveLength(1);
    expect(h.phase).toBe("deal");
    expect(h.choosing()).toEqual([]);
    // 받은 4장은 그대로
    expect(p.dealt).toEqual(C("Qs Qh Jd 4c"));
  });

  it("고르는 중에는 순서가 없음 (아무나 먼저)", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 } });
    h.choose(2, 0, 1);
    h.choose(0, 1, 0);
    expect(h.phase).toBe("choice");
    h.choose(1, 2, 3);
    expect(h.phase).toBe("deal");
  });
});

// ───────────── 룰 3: 흐름 ─────────────

describe("한 판의 흐름 (룰 3)", () => {
  it("4 · 5 · 6구는 펴서, 7구는 엎어서. 구마다 베팅, 7구 베팅 뒤 쇼다운", () => {
    const h = table({ 0: 1000, 1: 1000, 2: 1000 }, 0);
    expect(h.phase).toBe("deal");
    expect(h.round).toBe(3);
    for (let r = 4; r <= 7; r++) {
      const dealt = h.advance();
      expect(h.round).toBe(r);
      expect(dealt.map((d) => d.seat)).toEqual([0, 1, 2]);
      expect(dealt.every((d) => d.up === r < 7)).toBe(true);
      for (const d of dealt) expect(h.player(d.seat)!.cards[r - 1]).toBe(d.card);
      expect(h.phase).toBe("bet");
      expect(h.currentBet).toBe(0);
      // 보스(0번)부터 자리 순으로
      for (const s of [0, 1, 2]) {
        expect(h.toAct).toBe(s);
        expect(h.legal(s).canCheck).toBe(true);
        h.act(s, "check");
      }
      expect(h.phase).toBe("deal");
      expect(h.toAct).toBe(-1);
    }
    for (const p of h.players) {
      expect(p.cards).toHaveLength(7);
      expect(p.up).toEqual([false, false, true, true, true, true, false]);
    }
    h.advance();
    expect(h.phase).toBe("done");
    const r = h.result!;
    expect(r.showdown).toBe(true);
    expect(r.pots).toEqual([{ amount: 300, seats: [0, 1, 2], winners: [0] }]);
    expect(r.won).toEqual({ 0: 300 });
    expect(r.delta).toEqual({ 0: 200, 1: -100, 2: -100 });
    expect(r.shows).toHaveLength(3);
    for (const s of r.shows) {
      expect(s.cards).toHaveLength(7);
      expect(sortedJoin(s.cards)).toBe(sortedJoin(h.player(s.seat)!.cards));
      expect(s.score).toBe(evaluateK(s.cards));
      expect(s.name).toBe(handNameK(s.score));
    }
    expectConserved(h);
  });
});

// ───────────── 룰 4: 보스 ─────────────

describe("보스 (룰 4)", () => {
  it("펴 놓은 카드가 가장 높은 사람부터 자리 순으로 (끝자리 다음은 첫 자리). 7구는 6구와 같음", () => {
    const h = mk({
      stacks: { 1: 1000, 4: 1000, 6: 1000 },
      dealt: { 1: "2s 3d Ac 9h", 4: "2h 3c Kh Jd", 6: "2d 3s 9c 8h" },
      //          4구  5구  6구  7구(엎음)
      later: { 1: "7d Ad 5c As", 4: "Ks 4c 4h Kd", 6: "9s 4d 9d 5d" },
    });
    chooseAll(h);
    const order = () => {
      const out: number[] = [];
      while (h.phase === "bet") {
        out.push(h.toAct);
        h.act(h.toAct, "check");
      }
      return out;
    };
    // 4구: A 탑(1) · K 페어(4) · 9 페어(6)
    h.advance();
    expect(h.boss).toBe(4);
    expect(order()).toEqual([4, 6, 1]);
    // 5구: A 페어(1) · K 페어(4) · 9 페어(6)
    h.advance();
    expect(h.boss).toBe(1);
    expect(order()).toEqual([1, 4, 6]);
    // 6구: A 페어(1) · K·4 투페어(4) · 9 트리플(6)
    h.advance();
    expect(h.boss).toBe(6);
    expect(order()).toEqual([6, 1, 4]);
    // 7구: 엎은 카드(1번의 A, 4번의 K)는 안 봄
    h.advance();
    expect(h.boss).toBe(6);
    expect(order()).toEqual([6, 1, 4]);
    h.advance();
    // 쇼다운은 7장 전부: K 풀하우스(4) > A 트리플(1) … 9 트리플(6)
    expect(h.result!.won).toEqual({ 4: 300 });
    expectConserved(h);
  });

  /** 2~3명이 4구에 이렇게 펴 놓았을 때의 보스 */
  const bossOf = (ups: Record<number, string>): number => {
    const dealt: Record<number, string> = {};
    const later: Record<number, string> = {};
    const stacks: Record<number, number> = {};
    for (const [s, t] of Object.entries(ups)) {
      const [a, b] = t.split(" ");
      dealt[Number(s)] = `? ? ${a} ?`;
      later[Number(s)] = b;
      stacks[Number(s)] = 1000;
    }
    const h = mk({ stacks, dealt, later });
    chooseAll(h);
    h.advance();
    expect(h.toAct).toBe(h.boss);
    return h.boss;
  };

  it("숫자까지 같으면 무늬 (♠ ♦ ♥ ♣ 순)", () => {
    expect(bossOf({ 0: "Ah 7c", 1: "As 7d" })).toBe(1);
    expect(bossOf({ 0: "As 7c", 1: "Ah 7d" })).toBe(0);
    expect(bossOf({ 0: "Ah 7s", 1: "Ad 7c" })).toBe(1);
    expect(bossOf({ 0: "Ac 7s", 1: "Ah 7d" })).toBe(1);
    expect(bossOf({ 0: "Ad 7s", 1: "Ac 7d", 2: "Ah 7h" })).toBe(0);
    // 페어끼리: 그 페어에서 가장 센 무늬
    expect(bossOf({ 0: "9d 9h", 1: "9s 9c" })).toBe(1);
    expect(bossOf({ 0: "9s 9c", 1: "9d 9h" })).toBe(0);
  });

  it("무늬보다 숫자가 먼저, 숫자보다 족보가 먼저", () => {
    expect(bossOf({ 0: "Ac 8c", 1: "As 7s" })).toBe(0);
    expect(bossOf({ 0: "Kc Qc", 1: "As 2s" })).toBe(1);
    expect(bossOf({ 0: "2c 2h", 1: "As Ks" })).toBe(0);
    expect(bossOf({ 2: "2c 2h", 5: "As Ks", 7: "3c 3h" })).toBe(7);
  });

  it("보스가 죽으면 다음 구에는 남은 사람 중에서 다시 정함", () => {
    // 기본 판: 0번이 보스. 나머지의 편 카드는 6 → 8 → 10 → Q (전부 같은 숫자) 라 무늬로 갈림
    const h = start({ 0: 1000, 1: 1000, 2: 1000 }, 0, { gone: { 0: 5 } });
    expect(h.boss).toBe(0);
    play(h, [
      [0, "die"],
      [1, "check"],
      [2, "check"],
    ]);
    h.advance();
    // 5구: 1번은 6♦ 8♣ T♠, 2번은 6♣ 8♠ T♥ → 가장 높은 카드(10)의 무늬: ♠ > ♥
    expect(upOf(h, 1)).toEqual(C("6d 8c Ts"));
    expect(upOf(h, 2)).toEqual(C("6c 8s Th"));
    expect(h.boss).toBe(1);
    expect(h.toAct).toBe(1);
    play(h, [
      [1, "check"],
      [2, "check"],
    ]);
    h.advance();
    // 6구: Q♥(1) vs Q♦(2) → ♦
    expect(h.boss).toBe(2);
    expect(h.toAct).toBe(2);
  });

  it("보스가 올인이면 그다음 사람부터", () => {
    // 1번(보스)은 앤티로 올인
    const h = start({ 0: 1000, 1: 100, 2: 1000 }, 1);
    expect(h.boss).toBe(1);
    expect(h.player(1)!.allIn).toBe(true);
    expect(h.toAct).toBe(2);
    h.act(2, "check");
    expect(h.toAct).toBe(0);
    h.act(0, "check");
    expect(h.phase).toBe("deal");
    // 보스가 끝자리면 첫 자리부터
    const g = start({ 0: 1000, 1: 1000, 2: 100 }, 2);
    expect(g.boss).toBe(2);
    expect(g.toAct).toBe(0);
    g.act(0, "check");
    expect(g.toAct).toBe(1);
  });
});

// ───────────── 룰 5: 베팅 ─────────────

describe("베팅 금액 (룰 5)", () => {
  it("삥 · 따당 · 쿼터 · 하프 · 풀 (앤티 100, 단위 10) — 한 사람이 한 구에 두 번까지", () => {
    const h = start({ 0: 10000, 1: 10000, 2: 10000 }, 0);
    expect(h.pot).toBe(300);
    // 팟 300: 쿼터 75 → 70 → 앤티보다 작으니 100
    expect(h.legal(0)).toEqual({ canCheck: true, toCall: 0, bets: { bbing: 100, quarter: 100, half: 150, full: 300 } });
    expect(h.act(0, "bbing")).toMatchObject({ seat: 0, type: "bbing", add: 100, aggressive: true, potBefore: 300, allIn: false });
    expect(h.player(0)).toMatchObject({ stack: 9800, bet: 100, raises: 1 });
    expect(h.currentBet).toBe(100);
    // 1번: 100 을 받고, 콜한 뒤의 팟은 500
    expect(h.toAct).toBe(1);
    expect(h.legal(1)).toEqual({ canCheck: false, toCall: 100, bets: { ddadang: 200, quarter: 220, half: 350, full: 600 } });
    h.act(1, "half");
    expect(h.player(1)).toMatchObject({ stack: 9550, bet: 350, raises: 1 });
    expect(h.currentBet).toBe(350);
    expect(h.pot).toBe(750);
    // 2번: 350 을 받음, 콜한 뒤의 팟 1100
    expect(h.legal(2)).toEqual({ canCheck: false, toCall: 350, bets: { ddadang: 700, quarter: 620, half: 900, full: 1450 } });
    h.act(2, "call");
    expect(h.player(2)).toMatchObject({ stack: 9550, bet: 350, raises: 0 });
    // 0번: 250 을 받음, 콜한 뒤의 팟 1350 → 쿼터 337.5 → 330, 하프 675 → 670
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toEqual({ canCheck: false, toCall: 250, bets: { ddadang: 500, quarter: 580, half: 920, full: 1600 } });
    h.act(0, "ddadang");
    expect(h.player(0)).toMatchObject({ stack: 9300, bet: 600, raises: 2 });
    // 1번: 250 을 받음, 콜한 뒤의 팟 1850
    expect(h.legal(1)).toEqual({ canCheck: false, toCall: 250, bets: { ddadang: 500, quarter: 710, half: 1170, full: 2100 } });
    h.act(1, "full");
    expect(h.player(1)).toMatchObject({ stack: 7450, bet: 2450, raises: 2 });
    expect(h.pot).toBe(3700);
    // 2번: 2100 을 받음, 콜한 뒤의 팟 5800
    expect(h.legal(2)).toEqual({ canCheck: false, toCall: 2100, bets: { ddadang: 4200, quarter: 3550, half: 5000, full: 7900 } });
    h.act(2, "ddadang");
    expect(h.player(2)).toMatchObject({ stack: 5350, bet: 4550, raises: 1 });
    // 0번은 이미 두 번 올림 → 콜 · 다이만
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toEqual({ canCheck: false, toCall: 3950, bets: {} });
    for (const t of BET_TYPES) rejects(h, () => h.act(0, t), `세 번째 ${t}`);
    h.act(0, "call");
    expect(h.legal(1)).toEqual({ canCheck: false, toCall: 2100, bets: {} });
    for (const t of BET_TYPES) rejects(h, () => h.act(1, t), `세 번째 ${t}`);
    h.act(1, "call");
    // 모두 맞췄으니 끝 (2번은 한 번 더 올릴 수 있었지만 마지막에 올린 사람)
    expect(h.phase).toBe("deal");
    expect(stacksOf(h)).toEqual({ 0: 5350, 1: 5350, 2: 5350 });
    expect(h.pot).toBe(13950);
    // 다음 구에는 횟수가 다시 0
    h.advance();
    expect(h.toAct).toBe(0);
    expect(h.players.map((p) => [p.bet, p.raises])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    // 팟 13950: 쿼터 3487.5 → 3480, 하프 6975 → 6970 인데 0번의 스택은 5350
    expect(h.legal(0)).toEqual({ canCheck: true, toCall: 0, bets: { bbing: 100, quarter: 3480, half: 5350, full: 5350 } });
    expect(RAISES_PER_ROUND).toBe(2);
  });

  it("헤즈업: 삥 → 따당 → 따당 → 따당 뒤에는 콜 · 다이만", () => {
    const h = start({ 0: 10000, 1: 10000 }, 0);
    play(h, [
      [0, "bbing"],
      [1, "ddadang"],
      [0, "ddadang"],
      [1, "ddadang"],
    ]);
    expect(h.players.map((p) => p.bet)).toEqual([300, 400]);
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toEqual({ canCheck: false, toCall: 100, bets: {} });
    rejects(h, () => h.act(0, "ddadang"));
    h.act(0, "call");
    expect(h.phase).toBe("deal");
    expect(h.pot).toBe(1000);
  });

  it("체크 뒤에 벳이 나오면 다시 차례가 옴 (체크는 횟수에 안 들어감)", () => {
    const h = start({ 0: 10000, 1: 10000, 2: 10000 }, 0);
    play(h, [
      [0, "check"],
      [1, "check"],
    ]);
    expect(h.legal(2).bets.bbing).toBe(100);
    h.act(2, "bbing");
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toEqual({ canCheck: false, toCall: 100, bets: { ddadang: 200, quarter: 220, half: 350, full: 600 } });
    h.act(0, "ddadang");
    expect(h.toAct).toBe(1);
    h.act(1, "call");
    expect(h.toAct).toBe(2);
    expect(h.legal(2).toCall).toBe(100);
    h.act(2, "call");
    expect(h.phase).toBe("deal");
    expect(h.pot).toBe(900);
  });

  it("단위 100: 쿼터 · 하프 · 풀은 단위로 내림, 그래도 앤티보다 작지는 않음", () => {
    const h = start({ 0: 10000, 1: 10000, 2: 10000 }, 0, { unit: 100 });
    // 팟 300: 75 → 0 → 100, 150 → 100, 300
    expect(h.legal(0).bets).toEqual({ bbing: 100, quarter: 100, half: 100, full: 300 });
    h.act(0, "bbing");
    // 콜한 뒤의 팟 500: 125 → 100, 250 → 200, 500
    expect(h.legal(1).bets).toEqual({ ddadang: 200, quarter: 200, half: 300, full: 600 });
  });

  it("스택을 넘으면 올인으로 깎임", () => {
    const h = start({ 0: 10000, 1: 550, 2: 10000 }, 0);
    h.act(0, "bbing");
    expect(h.legal(1)).toEqual({ canCheck: false, toCall: 100, bets: { ddadang: 200, quarter: 220, half: 350, full: 450 } });
    expect(h.act(1, "full")).toMatchObject({ add: 450, aggressive: true, allIn: true });
    expect(h.player(1)).toMatchObject({ stack: 0, bet: 450, allIn: true, raises: 1 });
    expect(h.currentBet).toBe(450);
    expect(h.legal(2).toCall).toBe(450);
  });

  it("스택이 받을 돈 이하면 올릴 수 없음 (콜 = 있는 만큼 올인)", () => {
    for (const [stack, toCall] of [
      [350, 250],
      [400, 300],
    ]) {
      const h = start({ 0: 10000, 1: stack, 2: 10000 }, 0);
      h.act(0, "full"); // 300
      expect(h.legal(1)).toEqual({ canCheck: false, toCall, bets: {} });
      rejects(h, () => h.act(1, "ddadang"));
      rejects(h, () => h.act(1, "check"));
      expect(h.act(1, "call")).toMatchObject({ add: toCall, aggressive: false, allIn: true });
      // 모자란 콜은 벳을 바꾸지 않음
      expect(h.currentBet).toBe(300);
      expect(h.legal(2).toCall).toBe(300);
      h.act(2, "call");
      expect(h.phase).toBe("deal");
    }
  });

  it("앤티보다 적게 올린 올인 뒤: 다음 사람의 따당은 받을 돈 + 앤티 이상", () => {
    const h = start({ 0: 10000, 1: 250, 2: 10000 }, 0);
    h.act(0, "bbing");
    // 1번은 150 뿐: 어떤 베팅이든 150 올인
    expect(h.legal(1)).toEqual({ canCheck: false, toCall: 100, bets: { ddadang: 150, quarter: 150, half: 150, full: 150 } });
    h.act(1, "ddadang");
    expect(h.player(1)).toMatchObject({ stack: 0, bet: 150, allIn: true });
    expect(h.currentBet).toBe(150);
    // 2번: 150 을 받음, 콜한 뒤의 팟 700
    expect(h.legal(2)).toEqual({ canCheck: false, toCall: 150, bets: { ddadang: 300, quarter: 320, half: 500, full: 850 } });
    h.act(2, "call");
    // 0번: 50 만 더 내면 됨. 따당은 50 + 50 이 아니라 50 + 앤티(올리는 폭은 앤티 이상), 콜한 뒤의 팟 750
    expect(h.legal(0)).toEqual({ canCheck: false, toCall: 50, bets: { ddadang: 150, quarter: 230, half: 420, full: 800 } });
  });

  it("따당 = 받을 돈의 두 배 (받을 돈이 단위에 안 맞아도)", () => {
    // 앤티 10 · 단위 10. 1번은 47 올인 → 2번이 받을 돈 47
    const h = start({ 0: 1000, 1: 57, 2: 1000 }, 0, { ante: 10, unit: 10 });
    h.act(0, "bbing");
    h.act(1, "full");
    expect(h.player(1)).toMatchObject({ stack: 0, bet: 47, allIn: true });
    expect(h.legal(2).toCall).toBe(47);
    expect(h.legal(2).bets.ddadang).toBe(94);
  });

  it("다른 사람이 전부 올인이면 올릴 수 없음", () => {
    const h = start({ 0: 10000, 1: 600 }, 0);
    h.act(0, "bbing");
    // 1번: 100 + 콜한 뒤의 팟 400 = 500 = 전부
    expect(h.legal(1).bets.full).toBe(500);
    h.act(1, "full");
    expect(h.legal(0)).toEqual({ canCheck: false, toCall: 400, bets: {} });
    for (const t of BET_TYPES) rejects(h, () => h.act(0, t));
    h.act(0, "call");
    expect(h.phase).toBe("deal");
    expect(h.pot).toBe(1200);
  });
});

// ───────────── 룰 6 · 7 · 8: 올인 ─────────────

describe("올인 · 사이드팟 · 돌려주기 (룰 6 · 7 · 8)", () => {
  it("룰 6: 한 명만 행동할 수 있으면 베팅 없이 7구까지 돌리고 쇼다운", () => {
    const h = start({ 0: 10000, 1: 600 }, 0);
    play(h, [
      [0, "bbing"],
      [1, "full"],
      [0, "call"],
    ]);
    expect(h.phase).toBe("deal");
    for (let r = 5; r <= 7; r++) {
      const dealt = h.advance();
      expect(dealt).toHaveLength(2);
      expect(h.round).toBe(r);
      expect(h.phase).toBe("deal");
      expect(h.toAct).toBe(-1);
      rejects(h, () => h.act(0, "check"));
    }
    h.advance();
    expect(h.phase).toBe("done");
    expect(h.result!.showdown).toBe(true);
    expect(h.result!.won).toEqual({ 0: 1200 });
    expect(stacksOf(h)).toEqual({ 0: 10600, 1: 0 });
    expectConserved(h);
  });

  it("룰 6: 전원이 앤티로 올인이면 고르기만 하고 끝까지", () => {
    const h = table({ 0: 100, 1: 100, 2: 100 }, 1);
    expect(runOut(h)).toBe(5);
    expect(h.result!.won).toEqual({ 1: 300 });
    expectConserved(h);
  });

  it("룰 7: 혼자 남은 사람은 가장 큰 올인까지만 맞추고, 올릴 수 없음", () => {
    const h = start({ 0: 10000, 1: 400, 2: 250 }, 0);
    h.act(0, "bbing");
    // 1번: 풀(600)이 300 올인으로 깎임
    h.act(1, "full");
    expect(h.player(1)).toMatchObject({ stack: 0, bet: 300 });
    // 2번: 150 뿐
    expect(h.legal(2)).toEqual({ canCheck: false, toCall: 150, bets: {} });
    h.act(2, "call");
    // 0번: 300 까지만 (200 더), 올릴 수는 없음
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toEqual({ canCheck: false, toCall: 200, bets: {} });
    for (const t of BET_TYPES) rejects(h, () => h.act(0, t));
    h.act(0, "call");
    expect(h.phase).toBe("deal");
    expect(h.pots()).toEqual([
      { amount: 750, seats: [0, 1, 2] },
      { amount: 300, seats: [0, 1] },
    ]);
    expect(runOut(h)).toBe(4);
    expect(h.result!.won).toEqual({ 0: 1050 });
    expect(stacksOf(h)).toEqual({ 0: 10650, 1: 0, 2: 0 });
    expectConserved(h);
  });

  it("룰 8: 받는 사람 없는 벳은 돌려줌 (헤즈업, 모자란 콜)", () => {
    const h = start({ 0: 10000, 1: 400 }, 0);
    play(h, [
      [0, "full"], // 200
      [1, "call"],
    ]);
    h.advance();
    expect(h.legal(0).bets.full).toBe(600);
    h.act(0, "full");
    expect(h.legal(1)).toEqual({ canCheck: false, toCall: 100, bets: {} });
    h.act(1, "call");
    // 600 중 100 만 받음 → 500 은 바로 돌아옴
    expect(h.phase).toBe("deal");
    expect(h.player(0)).toMatchObject({ stack: 9600, invested: 400, allIn: false });
    expect(h.player(1)).toMatchObject({ stack: 0, invested: 400, allIn: true });
    expect(h.pot).toBe(800);
    expect(runOut(h)).toBe(3);
    expect(h.result!.pots).toEqual([{ amount: 800, seats: [0, 1], winners: [0] }]);
    expect(stacksOf(h)).toEqual({ 0: 10400, 1: 0 });
    expectConserved(h);
  });

  it("룰 8: 올인한 쪽이 이겨도 넘친 벳은 못 가져감", () => {
    // 1번이 보스이자 가장 센 패
    const h = start({ 0: 10000, 1: 400 }, 1);
    expect(h.toAct).toBe(1);
    h.act(1, "bbing");
    // 0번: 100 + 콜한 뒤의 팟 400 = 500
    expect(h.legal(0).bets.full).toBe(500);
    h.act(0, "full");
    expect(h.legal(1)).toEqual({ canCheck: false, toCall: 200, bets: {} });
    h.act(1, "call");
    expect(h.player(0)).toMatchObject({ stack: 9600, invested: 400 });
    runOut(h);
    expect(h.result!.won).toEqual({ 1: 800 });
    expect(stacksOf(h)).toEqual({ 0: 9600, 1: 800 });
    expect(h.result!.delta).toEqual({ 0: -400, 1: 400 });
    expectConserved(h);
  });

  it("룰 8: 3인 — 둘이 모자란 콜, 가장 큰 올인을 넘는 만큼만 돌려줌", () => {
    const h = start({ 0: 10000, 1: 300, 2: 250 }, 0);
    h.act(0, "full"); // 300
    h.act(1, "call"); // 200 올인
    h.act(2, "call"); // 150 올인
    expect(h.phase).toBe("deal");
    expect(h.player(0)).toMatchObject({ stack: 9700, invested: 300 });
    expect(h.pots()).toEqual([
      { amount: 750, seats: [0, 1, 2] },
      { amount: 100, seats: [0, 1] },
    ]);
    runOut(h);
    expect(stacksOf(h)).toEqual({ 0: 10550, 1: 0, 2: 0 });
    expectConserved(h);
  });

  it("룰 8: 사이드팟 — 죽은 사람의 돈은 팟에 남고, 자격이 같은 팟은 하나로", () => {
    // 2번이 보스이자 가장 센 패(가장 짧은 스택). 그다음은 0번(K♦) > 1번(K♣), 3번(K♠)은 중간에 죽음
    const h = start({ 0: 5000, 1: 600, 2: 300, 3: 5000 }, 2, { gone: { 3: 6 } });
    expect(h.toAct).toBe(2);
    expect(h.legal(2)).toEqual({ canCheck: true, toCall: 0, bets: { bbing: 100, quarter: 100, half: 200, full: 200 } });
    h.act(2, "full"); // 200 올인
    expect(h.toAct).toBe(3);
    expect(h.legal(3)).toEqual({ canCheck: false, toCall: 200, bets: { ddadang: 400, quarter: 400, half: 600, full: 1000 } });
    h.act(3, "ddadang"); // 400
    h.act(0, "call");
    expect(h.legal(1)).toMatchObject({ toCall: 400, bets: { ddadang: 500, full: 500 } });
    h.act(1, "call");
    expect(h.phase).toBe("deal");
    expect(h.pot).toBe(1800);
    expect(h.pots()).toEqual([
      { amount: 1200, seats: [0, 1, 2, 3] },
      { amount: 600, seats: [0, 1, 3] },
    ]);
    // 5구: 보스(2번)는 올인 → 3번부터
    h.advance();
    expect(h.boss).toBe(2);
    expect(h.toAct).toBe(3);
    h.act(3, "bbing");
    h.act(0, "ddadang");
    expect(h.legal(1)).toEqual({ canCheck: false, toCall: 100, bets: {} });
    h.act(1, "call");
    expect(h.toAct).toBe(3);
    expect(h.legal(3).toCall).toBe(100);
    h.act(3, "die");
    // 0번의 200 중 100 은 1번의 올인 · 3번의 죽은 돈이 받음 → 100 만 돌아옴
    expect(h.phase).toBe("deal");
    expect(h.players.map((p) => p.invested)).toEqual([600, 600, 300, 600]);
    expect(h.player(0)!.stack).toBe(4400);
    expect(h.pots()).toEqual([
      { amount: 1200, seats: [0, 1, 2] },
      { amount: 900, seats: [0, 1] },
    ]);
    expect(runOut(h)).toBe(3);
    const r = h.result!;
    expect(r.pots).toEqual([
      { amount: 1200, seats: [0, 1, 2], winners: [2] },
      { amount: 900, seats: [0, 1], winners: [0] },
    ]);
    expect(r.won).toEqual({ 2: 1200, 0: 900 });
    expect(stacksOf(h)).toEqual({ 0: 5300, 1: 0, 2: 1200, 3: 4400 });
    expect(r.delta).toEqual({ 0: 300, 1: -600, 2: 900, 3: -600 });
    expect(r.shows.map((s) => s.seat).sort()).toEqual([0, 1, 2]);
    expectConserved(h);
  });

  it("룰 8: 올인 셋의 금액이 다 다름 → 팟 셋", () => {
    // 3번이 가장 센 패(가장 짧음), 그다음 2번(K♠) > 0번(K♦) > 1번(K♣)
    const h = start({ 0: 10000, 1: 900, 2: 500, 3: 300 }, 3);
    expect(h.toAct).toBe(3);
    h.act(3, "full"); // 200 올인 (팟 400)
    h.act(0, "full"); // 200 + (600 + 200) = 1000
    expect(h.player(0)!.bet).toBe(1000);
    h.act(1, "call"); // 800 올인
    h.act(2, "call"); // 400 올인
    expect(h.phase).toBe("deal");
    // 0번의 1000 중 800 까지만 받음
    expect(h.players.map((p) => p.invested)).toEqual([900, 900, 500, 300]);
    expect(h.player(0)!.stack).toBe(9100);
    expect(h.pots()).toEqual([
      { amount: 1200, seats: [0, 1, 2, 3] },
      { amount: 600, seats: [0, 1, 2] },
      { amount: 800, seats: [0, 1] },
    ]);
    runOut(h);
    expect(h.result!.won).toEqual({ 3: 1200, 2: 600, 0: 800 });
    expect(stacksOf(h)).toEqual({ 0: 9900, 1: 0, 2: 600, 3: 1200 });
    expectConserved(h);
  });

  it("앤티가 모자란 사람과의 헤즈업: 베팅 없이 끝까지, 넘친 앤티는 돌려받음", () => {
    // 0번은 60 뿐 → 앤티 100 중 40 은 받는 사람이 없음
    const win = table({ 0: 60, 1: 1000 }, 0);
    expect(runOut(win)).toBe(5);
    expect(stacksOf(win)).toEqual({ 0: 120, 1: 940 });
    expect(win.result!.delta).toEqual({ 0: 60, 1: -60 });
    expectConserved(win);
    const lose = table({ 0: 60, 1: 1000 }, 1);
    runOut(lose);
    expect(stacksOf(lose)).toEqual({ 0: 0, 1: 1060 });
    expectConserved(lose);
  });

  it("넘친 앤티는 '딴 돈' 이 아님: 진 사람의 won 에 잡히면 안 됨 (팟은 120 하나)", () => {
    const h = table({ 0: 60, 1: 1000 }, 0);
    runOut(h);
    expect(h.result!.pots).toEqual([{ amount: 120, seats: [0, 1], winners: [0] }]);
    expect(h.result!.won).toEqual({ 0: 120 });
  });
});

describe("스펙이 모호한 곳 (엔진이 어떻게 하든 통과 — 칩 보존만 봄)", () => {
  it("앤티가 넘친 사람이 고르는 중에 죽음: 남은 사람이 끝내고 칩은 보존됨", () => {
    // 0번은 60 뿐, 1번은 앤티 100 을 다 냄 → 1번이 죽으면 40 은 받은 사람이 없던 돈
    // (엔진: 0번이 160 을 다 가져감 = 낸 돈 60 으로 100 을 땀. 테이블 스테이크대로면 120 만 가져가고 40 은 1번에게 돌아감)
    const h = mk({ stacks: { 0: 60, 1: 1000 } });
    h.act(1, "die");
    expect(h.phase).toBe("done");
    expect(h.result!.showdown).toBe(false);
    expect(Object.keys(h.result!.won)).toEqual(["0"]);
    expectConserved(h);
  });
});

// ───────────── 룰 9: 다이 ─────────────

describe("한 명만 남으면 끝 (룰 9)", () => {
  it("고르는 중에 다이: 헤즈업이면 바로 끝", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000 } });
    const item = h.act(1, "die");
    expect(item).toMatchObject({ seat: 1, type: "die", add: 0 });
    expect(h.phase).toBe("done");
    expect(h.toAct).toBe(-1);
    const r = h.result!;
    expect(r.showdown).toBe(false);
    expect(r.shows).toEqual([]);
    expect(r.pots).toEqual([{ amount: 200, seats: [0], winners: [0] }]);
    expect(r.won).toEqual({ 0: 200 });
    expect(r.delta).toEqual({ 0: 100, 1: -100 });
    expect(stacksOf(h)).toEqual({ 0: 1100, 1: 900 });
    expectConserved(h);
    rejects(h, () => h.choose(0, 0, 1));
    rejects(h, () => h.advance());
  });

  it("고르는 중에 다이: 3인이면 남은 둘이 계속 (죽은 사람은 안 골라도 되고 카드도 안 받음)", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, ...preset([0, 1, 2], 0), gone: { 1: 4 } });
    h.choose(0, 3, 2);
    h.act(1, "die");
    expect(h.phase).toBe("choice");
    expect(h.choosing()).toEqual([2]);
    rejects(h, () => h.choose(1, 3, 2), "죽은 사람이 고름");
    rejects(h, () => h.act(1, "die"), "두 번 죽음");
    h.choose(2, 3, 2);
    expect(h.phase).toBe("deal");
    expect(h.advance().map((d) => d.seat)).toEqual([0, 2]);
    expect(h.toAct).toBe(0);
    h.act(0, "check");
    expect(h.toAct).toBe(2);
    h.act(2, "check");
    checkDown(h);
    expect(h.result!.pots).toEqual([{ amount: 300, seats: [0, 2], winners: [0] }]);
    expect(stacksOf(h)).toEqual({ 0: 1200, 1: 900, 2: 900 });
    expectConserved(h);
  });

  it("고르는 중에 다이: 마지막으로 안 고른 사람이 죽으면 deal 로", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 } });
    h.choose(0, 3, 2);
    h.choose(2, 3, 2);
    h.act(1, "die");
    expect(h.phase).toBe("deal");
  });

  it("베팅 중: 벳에 모두 죽으면 벳은 돌려받고 팟만 가져감", () => {
    const h = start({ 0: 10000, 1: 10000, 2: 10000 }, 0);
    play(h, [
      [0, "full"],
      [1, "die"],
    ]);
    expect(h.phase).toBe("bet");
    expect(h.toAct).toBe(2);
    h.act(2, "die");
    expect(h.phase).toBe("done");
    const r = h.result!;
    expect(r.showdown).toBe(false);
    expect(r.shows).toEqual([]);
    expect(r.pots).toEqual([{ amount: 300, seats: [0], winners: [0] }]);
    expect(r.won).toEqual({ 0: 300 });
    expect(r.delta).toEqual({ 0: 200, 1: -100, 2: -100 });
    expect(stacksOf(h)).toEqual({ 0: 10200, 1: 9900, 2: 9900 });
    expectConserved(h);
    for (const t of ALL_ACTS) rejects(h, () => h.act(0, t), `끝난 뒤 ${t}`);
    rejects(h, () => h.advance());
  });

  it("베팅 중: 받은 벳은 팟에 남음", () => {
    const h = start({ 0: 10000, 1: 10000, 2: 10000 }, 0, { gone: { 2: 5 } });
    play(h, [
      [0, "full"], // 300
      [1, "call"],
      [2, "die"],
    ]);
    h.advance();
    play(h, [
      [0, "bbing"],
      [1, "ddadang"], // 200
      [0, "die"],
    ]);
    expect(h.phase).toBe("done");
    // 1번: 따당 200 중 100 은 0번의 삥이 받음 → 100 만 돌아옴
    expect(h.result!.won).toEqual({ 1: 1100 });
    expect(stacksOf(h)).toEqual({ 0: 9500, 1: 10600, 2: 9900 });
    expectConserved(h);
  });

  it("체크할 수 있어도 죽을 수 있음", () => {
    const h = start({ 0: 10000, 1: 10000 }, 0);
    h.act(0, "die");
    expect(h.phase).toBe("done");
    expect(h.result!.won).toEqual({ 1: 200 });
    expectConserved(h);
  });

  it("올인한 사람만 남기고 다 죽으면 올인한 사람이 가져감", () => {
    const h = start({ 0: 10000, 1: 100, 2: 10000 }, 1, { gone: { 0: 5 } });
    // 보스(1번, 앤티로 올인) 다음인 2번부터
    expect(h.toAct).toBe(2);
    play(h, [
      [2, "bbing"],
      [0, "die"],
    ]);
    // 2번의 삥은 받는 사람이 없어 돌아옴
    expect(h.phase).toBe("deal");
    expect(h.player(2)!.stack).toBe(9900);
    runOut(h);
    expect(h.result!.won).toEqual({ 1: 300 });
    expect(stacksOf(h)).toEqual({ 0: 9900, 1: 300, 2: 9900 });
    expectConserved(h);
  });
});

// ───────────── 룰 10: 쇼다운 ─────────────

describe("쇼다운은 한국식 족보로 (룰 10)", () => {
  const duel = (a: [string, string], b: [string, string]) => {
    const h = mk({ stacks: { 0: 1000, 1: 1000 }, dealt: { 0: a[0], 1: b[0] }, later: { 0: a[1], 1: b[1] } });
    chooseAll(h);
    checkDown(h);
    expectConserved(h);
    expect(h.result!.showdown).toBe(true);
    expect(h.result!.shows.map((s) => s.cards.length)).toEqual([7, 7]);
    const name = (seat: number) => h.result!.shows.find((s) => s.seat === seat)!.name;
    return { winner: Number(Object.keys(h.result!.won)[0]), won: h.result!.won, names: [name(0), name(1)] };
  };
  const BACK: [string, string] = ["As 2d 3h 9c", "4c 5s 8d Jh"];

  it("백스트레이트 > K 스트레이트", () => {
    const r = duel(BACK, ["9s Td Jc 2c", "Qh Kd 2h 7s"]);
    expect(r.names).toEqual(["백스트레이트", "K 스트레이트"]);
    expect(r.won).toEqual({ 0: 200 });
  });

  it("마운틴 > 백스트레이트", () => {
    const r = duel(BACK, ["Ts Jd Qc 2c", "Kh Ad 2h 7s"]);
    expect(r.names).toEqual(["백스트레이트", "마운틴"]);
    expect(r.won).toEqual({ 1: 200 });
  });

  it("플러시 > 마운틴, 풀하우스 > 플러시", () => {
    expect(duel(["2c 5c 9c 3d", "Jc Kc 3h 4s"], ["Ts Jd Qc 2s", "Kh Ad 2h 7s"]).names).toEqual(["K 플러시", "마운틴"]);
    expect(duel(["2c 5c 9c 3d", "Jc Kc 3h 4s"], ["Ts Jd Qc 2s", "Kh Ad 2h 7s"]).winner).toBe(0);
    const r = duel(["2c 5c 9c 3d", "Jc Kc 3h 4s"], ["7s 7d 7h 2s", "8h 8d 2h Qs"]);
    expect(r.names).toEqual(["K 플러시", "7·8 풀하우스"]);
    expect(r.winner).toBe(1);
  });

  it("숫자가 다 같으면 무늬: K♠ 페어가 K♥ 페어를 이김 (나눠 갖지 않음)", () => {
    const r = duel(["Kh Kc Ah 4s", "9h 7d 3c 2d"], ["Ks Kd Ac 4h", "9s 7h 3d 2h"]);
    expect(r.names).toEqual(["K 원페어", "K 원페어"]);
    expect(r.won).toEqual({ 1: 200 });
  });

  it("무늬보다 킥커가 먼저", () => {
    const r = duel(["Kh Kc Ah 4s", "9h 7d 3c 2d"], ["Ks Kd Qc 4h", "9s 7h 3d 2h"]);
    expect(r.won).toEqual({ 0: 200 });
  });

  it("같은 스트레이트끼리는 맨 위 카드의 무늬", () => {
    // 5-6-7-8-9: 9♦ vs 9♥
    const r = duel(["5s 6d 7c Kc", "8h 9h 2s Jd"], ["5h 6c 7d Kd", "8s 9d 2h Js"]);
    expect(r.names).toEqual(["9 스트레이트", "9 스트레이트"]);
    expect(r.won).toEqual({ 1: 200 });
  });
});

// ───────────── 룰 12: 안 되는 행동 ─────────────

describe("안 되는 행동은 예외, 상태는 그대로 (룰 12)", () => {
  it("고르는 중", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 } });
    for (const t of ALL_ACTS) if (t !== "die") rejects(h, () => h.act(0, t), `고르는 중 ${t}`);
    rejects(h, () => h.advance(), "고르는 중 advance");
    rejects(h, () => h.choose(0, 1, 1), "같은 위치");
    rejects(h, () => h.choose(0, 4, 0), "범위 밖");
    rejects(h, () => h.choose(0, 0, 4), "범위 밖");
    rejects(h, () => h.choose(0, -1, 2), "음수");
    rejects(h, () => h.choose(0, 1.5, 2), "정수가 아님");
    rejects(h, () => h.choose(0, Number.NaN, 2), "NaN");
    rejects(h, () => h.choose(9, 0, 1), "없는 자리");
    rejects(h, () => h.autoChoose(9), "없는 자리");
    rejects(h, () => h.act(9, "die"), "없는 자리");
    h.choose(0, 3, 2);
    rejects(h, () => h.choose(0, 0, 1), "두 번 고름");
    rejects(h, () => h.autoChoose(0), "두 번 고름");
    expect(h.phase).toBe("choice");
  });

  it("카드를 돌릴 차례 (deal)", () => {
    const h = table({ 0: 1000, 1: 1000 }, 0);
    for (const t of ALL_ACTS) rejects(h, () => h.act(0, t), `deal 중 ${t}`);
    rejects(h, () => h.choose(0, 0, 1));
    rejects(h, () => h.autoChoose(1));
  });

  it("베팅 중", () => {
    const h = start({ 0: 10000, 1: 10000, 2: 10000 }, 0);
    for (const t of ALL_ACTS) rejects(h, () => h.act(1, t), `차례 아닌 ${t}`);
    for (const t of ALL_ACTS) rejects(h, () => h.act(2, t), `차례 아닌 ${t}`);
    rejects(h, () => h.act(0, "call"), "낼 게 없는데 콜");
    rejects(h, () => h.act(0, "ddadang"), "벳이 없는데 따당");
    rejects(h, () => h.act(0, "raise" as SevenAct), "모르는 행동");
    rejects(h, () => h.advance(), "베팅 중 advance");
    rejects(h, () => h.choose(0, 0, 1), "베팅 중 고르기");
    h.act(0, "bbing");
    rejects(h, () => h.act(1, "check"), "벳을 받았는데 체크");
    rejects(h, () => h.act(1, "bbing"), "벳이 있는데 삥");
    rejects(h, () => h.act(0, "call"), "차례가 지남");
    h.act(1, "die");
    rejects(h, () => h.act(1, "die"), "죽은 사람");
    rejects(h, () => h.act(1, "call"), "죽은 사람");
    expect(h.toAct).toBe(2);
  });

  it("legal().bets 에 없는 이름은 전부 거절 (자바스크립트 객체에 원래 있는 이름 포함)", () => {
    const h = start({ 0: 10000, 1: 10000, 2: 10000 }, 0);
    h.act(0, "full");
    // 1번은 300 을 받아야 함. 돈을 안 내고 차례만 넘길 수 있으면 안 됨
    for (const t of ["", "raise", "ante", "constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) rejects(h, () => h.act(1, t as SevenAct), `"${t}"`);
    expect(h.toAct).toBe(1);
    expect(h.history).toHaveLength(4);
  });

  it("끝난 뒤", () => {
    const h = start({ 0: 1000, 1: 1000 }, 0);
    checkDown(h);
    for (const s of [0, 1]) for (const t of ALL_ACTS) rejects(h, () => h.act(s, t), `끝난 뒤 ${t}`);
    rejects(h, () => h.advance());
    rejects(h, () => h.choose(0, 0, 1));
    rejects(h, () => h.autoChoose(0));
  });
});

// ───────────── 퍼즈용: 스펙만 보고 따로 만든 기준 구현 ─────────────

interface RP {
  seat: number;
  start: number;
  stack: number;
  bet: number;
  inv: number;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  raises: number;
  dealt: Card[];
  down: Card[];
  up: Card[];
  chosen: boolean;
}
interface RefLegal {
  canCheck: boolean;
  toCall: number;
  bets: Partial<Record<SevenBet, number>>;
}
interface RefPot {
  amount: number;
  seats: number[];
  winners: number[];
}

class Ref {
  ps: RP[];
  phase: "choice" | "bet" | "deal" | "done" = "choice";
  round = 3;
  curBet = 0;
  toAct = -1;
  boss = -1;
  showdown = false;
  /** 돌려준 횟수 (퍼즈가 그 경우를 지나갔는지 확인용) */
  refunds = 0;
  /** 뽑히는 순서 */
  private seq: Card[];
  private at = 0;

  constructor(
    seats: { seat: number; stack: number }[],
    readonly ante: number,
    readonly unit: number,
    deck: Card[],
  ) {
    this.seq = [...deck].reverse();
    // 룰 1
    this.ps = [...seats]
      .sort((a, b) => a.seat - b.seat)
      .map((s) => {
        const add = Math.min(ante, s.stack);
        return { seat: s.seat, start: s.stack, stack: s.stack - add, bet: 0, inv: add, folded: false, allIn: s.stack === add, acted: false, raises: 0, dealt: [], down: [], up: [], chosen: false };
      });
    for (let i = 0; i < 4; i++) for (const p of this.ps) p.dealt.push(this.seq[this.at++]);
  }

  p(seat: number): RP {
    return this.ps.find((x) => x.seat === seat)!;
  }
  get live(): RP[] {
    return this.ps.filter((x) => !x.folded);
  }
  get able(): RP[] {
    return this.ps.filter((x) => !x.folded && !x.allIn);
  }
  get pot(): number {
    return sum(this.ps.map((x) => x.inv));
  }
  /** seat 다음부터 자리 순으로 한 바퀴 (seat 자신이 맨 끝) */
  private clockwise(seat: number): RP[] {
    const i = this.ps.findIndex((x) => x.seat === seat);
    return [...this.ps.slice(i + 1), ...this.ps.slice(0, i + 1)];
  }
  private othersAble(p: RP): boolean {
    return this.able.some((x) => x !== p);
  }

  // 룰 2
  choose(seat: number, discard: number, open: number) {
    const p = this.p(seat);
    p.up = [p.dealt[open]];
    p.down = p.dealt.filter((_, i) => i !== discard && i !== open);
    p.chosen = true;
    if (this.live.every((x) => x.chosen)) this.phase = "deal";
  }

  /** 룰 7 */
  owes(p: RP): number {
    if (this.othersAble(p)) return Math.max(0, this.curBet - p.bet);
    const top = Math.max(0, ...this.live.filter((x) => x !== p).map((x) => x.bet));
    return Math.max(0, top - p.bet);
  }

  /** 룰 5 */
  legal(seat: number): RefLegal {
    const p = this.p(seat);
    const owes = this.owes(p);
    const bets: RefLegal["bets"] = {};
    if (p.raises < 2 && this.othersAble(p) && p.stack > owes) {
      const cap = (v: number) => Math.min(p.stack, v);
      const after = this.pot + owes;
      const part = (den: number) => owes + Math.max(this.ante, Math.floor(after / (den * this.unit)) * this.unit);
      if (this.curBet === 0) bets.bbing = cap(this.ante);
      if (owes > 0) bets.ddadang = cap(owes + Math.max(this.ante, owes));
      bets.quarter = cap(part(4));
      bets.half = cap(part(2));
      bets.full = cap(part(1));
    }
    return { canCheck: owes === 0, toCall: Math.min(p.stack, owes), bets };
  }

  /** 룰 9 */
  die(seat: number) {
    const p = this.p(seat);
    p.folded = true;
    if (this.live.length === 1) {
      this.phase = "done";
      this.toAct = -1;
      return;
    }
    if (this.phase === "choice") {
      if (this.live.every((x) => x.chosen)) this.phase = "deal";
      return;
    }
    this.nextOrClose(seat);
  }

  /** add = 이번에 내는 돈 (콜 · 벳) */
  act(seat: number, type: SevenAct, add: number) {
    if (type === "die") return this.die(seat);
    const p = this.p(seat);
    if (type !== "check") {
      const a = Math.min(add, p.stack);
      p.stack -= a;
      p.bet += a;
      p.inv += a;
      if (p.stack === 0) p.allIn = true;
      if (type !== "call" && p.bet > this.curBet) {
        this.curBet = p.bet;
        p.raises++;
      }
    }
    p.acted = true;
    this.nextOrClose(seat);
  }

  /** 룰 5 · 6: 살아 있고 올인이 아닌 사람이 모두 행동했고 벳을 맞췄으면 끝. 혼자 남아 낼 것도 없으면 끝 */
  private nextOrClose(from: number) {
    for (const p of this.clockwise(from)) {
      if (p.folded || p.allIn) continue;
      if (p.acted && p.bet >= this.curBet) continue;
      if (this.othersAble(p) || this.owes(p) > 0) {
        this.toAct = p.seat;
        return;
      }
      break;
    }
    this.toAct = -1;
    this.phase = "deal";
    this.refund();
  }

  /** 룰 8: 아무도 받지 못한 몫 (죽은 사람이 낸 돈도 '받은' 것으로 침) */
  private uncalled(): { p: RP; amount: number } | null {
    const [top, second] = [...this.ps].sort((a, b) => b.inv - a.inv);
    if (top.folded || top.inv <= second.inv) return null;
    return { p: top, amount: top.inv - second.inv };
  }
  private refund() {
    const u = this.uncalled();
    if (!u) return;
    u.p.inv -= u.amount;
    u.p.bet = Math.max(0, u.p.bet - u.amount);
    u.p.stack += u.amount;
    u.p.allIn = false;
    this.refunds++;
  }

  /** 룰 3 · 4 · 6. 돌린 카드 (쇼다운이면 null) */
  advance(): { seat: number; card: Card; up: boolean }[] | null {
    if (this.round === 7) {
      this.phase = "done";
      this.showdown = true;
      this.toAct = -1;
      return null;
    }
    this.round++;
    const faceUp = this.round < 7;
    const out: { seat: number; card: Card; up: boolean }[] = [];
    for (const p of this.live) {
      const card = this.seq[this.at++];
      (faceUp ? p.up : p.down).push(card);
      out.push({ seat: p.seat, card, up: faceUp });
    }
    for (const p of this.ps) {
      p.bet = 0;
      p.acted = false;
      p.raises = 0;
    }
    this.curBet = 0;
    let boss = this.live[0];
    for (const p of this.live) if (cmpKey(refOpenKey(p.up), refOpenKey(boss.up)) > 0) boss = p;
    this.boss = boss.seat;
    if (this.able.length >= 2) {
      this.phase = "bet";
      this.toAct = boss.allIn ? this.clockwise(boss.seat).find((p) => !p.folded && !p.allIn)!.seat : boss.seat;
    } else {
      this.phase = "deal";
      this.toAct = -1;
    }
    return out;
  }

  /**
   * 룰 8 · 9 · 10: 끝났을 때의 정산.
   * refund = 끝까지 돌려받지 못한 "받는 사람 없는 몫" (베팅 라운드가 한 번도 안 닫힌 판의 넘친 앤티). 팟에 넣지 않고 주인에게 돌려줌.
   */
  settle(): { pots: RefPot[]; won: Record<number, number>; refund: { seat: number; amount: number } | null; final: Map<number, number>; tie: boolean } {
    const left = new Map(this.ps.map((p) => [p.seat, p.inv]));
    const u = this.uncalled();
    if (u) left.set(u.p.seat, u.p.inv - u.amount);
    const pots: RefPot[] = [];
    let tie = false;
    const live = this.live;
    if (!this.showdown) {
      const w = live[0];
      pots.push({ amount: sum([...left.values()]), seats: [w.seat], winners: [w.seat] });
    } else {
      // 가장 적게 낸 사람의 높이만큼씩 깎아 가며 팟을 만듦
      for (;;) {
        const rem = live.filter((p) => left.get(p.seat)! > 0);
        if (!rem.length) break;
        const m = Math.min(...rem.map((p) => left.get(p.seat)!));
        let amount = 0;
        for (const p of this.ps) {
          const t = Math.min(left.get(p.seat)!, m);
          amount += t;
          left.set(p.seat, left.get(p.seat)! - t);
        }
        const seats = rem.map((p) => p.seat);
        const last = pots[pots.length - 1];
        if (last && last.seats.join() === seats.join()) last.amount += amount;
        else pots.push({ amount, seats, winners: [] });
      }
      // 살아 있는 누구보다도 많이 낸 죽은 돈은 맨 위 팟으로
      const dead = sum([...left.values()]);
      if (dead > 0) pots[pots.length - 1].amount += dead;
      const keys = new Map(live.map((p) => [p.seat, refBest([...p.down, ...p.up])]));
      for (const pot of pots) {
        let best = keys.get(pot.seats[0])!;
        for (const s of pot.seats) if (cmpKey(keys.get(s)!, best) > 0) best = keys.get(s)!;
        pot.winners = pot.seats.filter((s) => cmpKey(keys.get(s)!, best) === 0);
        if (pot.winners.length > 1) tie = true;
      }
    }
    const won: Record<number, number> = {};
    for (const pot of pots) for (const s of pot.winners) won[s] = (won[s] ?? 0) + pot.amount / pot.winners.length;
    const final = new Map(this.ps.map((p) => [p.seat, p.stack + (won[p.seat] ?? 0) + (u && u.p === p ? u.amount : 0)]));
    return { pots, won, refund: u ? { seat: u.p.seat, amount: u.amount } : null, final, tie };
  }
}

// ───────────── 퍼즈 ─────────────

interface FuzzCfg {
  name: string;
  seed: number;
  hands: number;
  unit: number;
  antes: number[];
  /** 스택을 단위의 배수로만 */
  unitStacks: boolean;
  /** 다이를 고를 무게 (기본 1 = 다른 행동과 같은 확률) */
  dieWeight?: number;
  /** 앤티 이하의 스택이 나올 확률 (기본 0.12) */
  tiny?: number;
  /** 베팅 하나하나를 고를 무게 (기본 1) */
  betWeight?: number;
  /** 모두 깊은 스택 (앤티의 200~2200배) */
  deep?: boolean;
}
interface FuzzOut {
  /** 분류 → 어긴 사례 (재현 정보 포함, 분류마다 앞의 몇 개만) */
  v: Map<string, string[]>;
  count: Map<string, number>;
  stats: Record<string, number>;
}

/** 판을 통째로 복사 (되는 행동을 원래 판을 건드리지 않고 해 보려고) */
const cloneHand = (h: SevenHand): SevenHand => Object.assign(Object.create(SevenHand.prototype) as SevenHand, structuredClone({ ...h }));

function fuzz(cfg: FuzzCfg): FuzzOut {
  const rng = mulberry32(cfg.seed);
  const ri = (n: number) => Math.floor(rng() * n);
  const v = new Map<string, string[]>();
  const count = new Map<string, number>();
  const stats: Record<string, number> = {
    hands: 0,
    showdown: 0,
    foldEnd: 0,
    choiceFold: 0,
    sidePots: 0,
    runout: 0,
    shortAnte: 0,
    refunds: 0,
    capped: 0,
    lone: 0,
    allInBoss: 0,
    actions: 0,
    raises: 0,
    round7Bets: 0,
    ddadangOdd: 0,
    uncalledAnte: 0,
    huge: 0,
  };

  for (let n = 0; n < cfg.hands; n++) {
    // ── 판 만들기
    const np = 2 + ri(4);
    const allSeats = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = allSeats.length - 1; i > 0; i--) {
      const j = ri(i + 1);
      [allSeats[i], allSeats[j]] = [allSeats[j], allSeats[i]];
    }
    const ante = cfg.antes[ri(cfg.antes.length)];
    const u = cfg.unit;
    const seats = allSeats.slice(0, np).map((seat) => {
      const k = rng();
      const tiny = cfg.tiny ?? 0.12;
      let stack: number;
      if (cfg.deep) stack = ante * (200 + ri(2000));
      else if (k < tiny) stack = 1 + ri(ante); // 앤티 이하
      else if (k < tiny + 0.25) stack = ante + 1 + ri(ante * 9);
      else if (k < 0.85) stack = ante * 10 + ri(ante * 190);
      else if (k < 0.93) stack = ante * (20 + ri(4)); // 같은 스택이 자주 나오게
      else {
        stack = ante * (10_000 + ri(1_000_000)); // 아주 큼
        stats.huge++;
      }
      if (cfg.unitStacks) stack = Math.max(u, Math.round(stack / u) * u);
      return { seat, stack };
    });
    const deck = shuffledDeck(ri);
    const log: string[] = [];
    const where = () => `[${cfg.name} #${n}] seats=${JSON.stringify(seats.map((s) => [s.seat, s.stack]))} ante=${ante} unit=${u} acts=[${log.join(" ")}] deck=[${deck.join(",")}]`;
    const viol = (cat: string, msg: string) => {
      count.set(cat, (count.get(cat) ?? 0) + 1);
      const list = v.get(cat) ?? [];
      if (list.length < 2) list.push(`${msg}  ${where()}`);
      v.set(cat, list);
    };

    let h: SevenHand;
    try {
      h = new SevenHand({ seats, ante, deck, unit: u });
    } catch (e) {
      viol("stuck", `생성 중 예외: ${e}`);
      continue;
    }
    const ref = new Ref(seats, ante, u, deck);
    stats.hands++;
    if (ref.ps.some((p) => p.allIn)) stats.shortAnte++;
    const total = sum(seats.map((s) => s.stack));
    const sorted = [...seats].sort((a, b) => a.seat - b.seat).map((s) => s.seat);
    const anySeat = () => sorted[ri(np)];

    // 룰 1 · 2: 앤티와 처음 4장
    if (h.phase !== "choice" || h.round !== 3 || h.toAct !== -1) viol("state", `처음 상태: phase ${h.phase} round ${h.round} toAct ${h.toAct}`);
    for (const p of h.players) {
      const q = ref.p(p.seat);
      if (p.dealt.join() !== q.dealt.join()) viol("deal", `자리 ${p.seat} 가 받은 4장 ${p.dealt} (기대 ${q.dealt})`);
      if (p.bet !== 0) viol("state", `앤티가 구별 벳으로 잡힘: 자리 ${p.seat} bet ${p.bet}`);
    }

    /** 이번 구에 자리별로 걸거나 올린 횟수 (엔진의 기록에서 따로 셈) */
    const raised = new Map<number, number>();
    /** advance 직후 (첫 차례 = 보스) */
    let fresh = false;

    /** 엔진 상태가 기준 구현과 같은지. 다르면 false (이 판은 더 못 따라감) */
    const sameState = (): boolean => {
      if (h.phase !== ref.phase) {
        viol("state", `phase ${h.phase} (기대 ${ref.phase})`);
        return false;
      }
      if (h.phase === "bet" && h.toAct < 0) {
        viol("stuck", "bet 인데 toAct 가 −1");
        return false;
      }
      if (h.phase !== "done" && h.round !== ref.round) {
        viol("state", `round ${h.round} (기대 ${ref.round})`);
        return false;
      }
      if (h.phase === "bet" && fresh && h.boss !== ref.boss) viol("boss", `boss ${h.boss} (기대 ${ref.boss})`);
      if (h.toAct !== ref.toAct) {
        viol(fresh ? "boss" : "state", `toAct ${h.toAct} (기대 ${ref.toAct})`);
        return false;
      }
      for (const p of h.players) {
        const q = ref.p(p.seat);
        if (p.stack < 0 || p.bet < 0 || p.invested < 0) viol("conservation", `자리 ${p.seat} 음수`);
        if (p.raises > RAISES_PER_ROUND) viol("raise-cap", `자리 ${p.seat} raises ${p.raises}`);
        if (p.cards.length !== p.up.length) viol("deal", `자리 ${p.seat}: cards 와 up 의 길이가 다름`);
        if (q.chosen) {
          const up = p.cards.filter((_, i) => p.up[i]);
          const down = p.cards.filter((_, i) => !p.up[i]);
          if (sortedJoin(up) !== sortedJoin(q.up) || sortedJoin(down) !== sortedJoin(q.down)) {
            viol("deal", `자리 ${p.seat}: 편 카드 ${up} / 엎은 카드 ${down} (기대 ${q.up} / ${q.down})`);
            return false;
          }
        } else if (p.cards.length) viol("deal", `자리 ${p.seat}: 안 골랐는데 카드가 있음`);
        if (h.phase === "done") continue; // 끝난 뒤의 스택은 정산에서 따로 봄
        if (p.stack !== q.stack || p.invested !== q.inv || p.folded !== q.folded || p.allIn !== q.allIn || (h.phase === "bet" && p.bet !== q.bet)) {
          viol("state", `자리 ${p.seat}: stack ${p.stack}/${q.stack} bet ${p.bet}/${q.bet} inv ${p.invested}/${q.inv} folded ${p.folded}/${q.folded} allIn ${p.allIn}/${q.allIn} (엔진/기대)`);
          return false;
        }
      }
      if (h.phase !== "done") {
        if (sum(h.players.map((p) => p.stack)) + h.pot !== total) viol("conservation", "스택 + 팟 ≠ 처음 칩 합계");
        const ps = h.pots();
        if (sum(ps.map((p) => p.amount)) !== h.pot) viol("pots", `pots() 합 ${sum(ps.map((p) => p.amount))} ≠ pot ${h.pot}`);
        for (const pot of ps) if (!pot.seats.length || pot.seats.some((s) => ref.p(s).folded)) viol("pots", "죽은 사람이 팟 자격에 있음 (또는 자격자가 없음)");
        if (h.phase === "bet" && h.currentBet !== ref.curBet) viol("state", `currentBet ${h.currentBet} (기대 ${ref.curBet})`);
      }
      return true;
    };

    /** 판 전체(덱 포함)의 스냅샷. 판이 바뀌는 행동을 한 뒤에는 snap 을 비움 */
    let snap: string | null = null;
    const rejected = (what: string, fn: () => unknown) => {
      const before = (snap ??= JSON.stringify(h));
      let threw = false;
      try {
        fn();
      } catch (e) {
        threw = e instanceof SevenError;
        if (!threw) viol("illegal", `${what}: SevenError 가 아닌 예외 ${e}`);
      }
      if (!threw) viol("illegal", `${what}: 예외가 안 남`);
      const after = JSON.stringify(h);
      if (after !== before) {
        viol("illegal", `${what}: 상태가 바뀜`);
        snap = after;
      }
    };
    const accepted = (what: string, seat: number, type: SevenAct) => {
      try {
        cloneHand(h).act(seat, type);
      } catch (e) {
        viol("legal-throws", `${what}: 되는 행동인데 예외 ${e}`);
      }
    };

    let ok = sameState();
    let steps = 0;
    let ranOut = false;
    while (ok && h.phase !== "done") {
      if (++steps > 300) {
        viol("stuck", "300 걸음 안에 끝나지 않음");
        ok = false;
        break;
      }

      // ── 고르기 (룰 2)
      if (h.phase === "choice") {
        const waiting = h.choosing();
        const want = ref.live.filter((p) => !p.chosen).map((p) => p.seat);
        if (waiting.join() !== want.join() || !waiting.length) {
          viol("state", `choosing() ${waiting} (기대 ${want})`);
          ok = false;
          break;
        }
        const seat = waiting[ri(waiting.length)];
        const me = h.player(seat)!;
        rejected("고르는 중 체크", () => h.act(seat, "check"));
        rejected("고르는 중 콜", () => h.act(seat, "call"));
        rejected("고르는 중 벳", () => h.act(seat, BET_TYPES[ri(5)]));
        rejected("고르는 중 advance", () => h.advance());
        rejected("같은 위치를 고름", () => h.choose(seat, 2, 2));
        rejected("범위 밖을 고름", () => h.choose(seat, ri(2) ? 4 : -1, 0));
        rejected("범위 밖을 고름", () => h.choose(seat, 1, ri(2) ? 4 : 2.5));
        const done = h.players.find((p) => p.chosen && !p.folded);
        if (done) {
          rejected("두 번 고름", () => h.choose(done.seat, 0, 1));
          rejected("두 번 고름(auto)", () => h.autoChoose(done.seat));
        }
        const dead = h.players.find((p) => p.folded);
        if (dead) {
          rejected("죽은 사람이 고름", () => h.choose(dead.seat, 0, 1));
          rejected("죽은 사람이 또 죽음", () => h.act(dead.seat, "die"));
        }
        const k = rng();
        snap = null;
        try {
          if (k < 0.04) {
            log.push(`${seat}x`);
            h.act(seat, "die");
            ref.die(seat);
            stats.choiceFold++;
          } else if (k < 0.24) {
            h.autoChoose(seat);
            // 무엇을 골랐는지는 엔진의 결과에서 읽음 (기본 선택의 내용은 스펙에 없음)
            const open = me.cards.filter((_, i) => me.up[i]);
            const gone = me.dealt.filter((c) => !me.cards.includes(c));
            if (me.cards.length !== 3 || open.length !== 1 || gone.length !== 1 || new Set(me.cards).size !== 3 || me.cards.some((c) => !me.dealt.includes(c))) {
              viol("deal", `autoChoose 결과가 이상함: cards ${me.cards} up ${me.up} dealt ${me.dealt}`);
              ok = false;
              break;
            }
            log.push(`${seat}c${me.dealt.indexOf(gone[0])}/${me.dealt.indexOf(open[0])}(auto)`);
            ref.choose(seat, me.dealt.indexOf(gone[0]), me.dealt.indexOf(open[0]));
          } else {
            const d = ri(4);
            const o = (d + 1 + ri(3)) % 4;
            log.push(`${seat}c${d}/${o}`);
            h.choose(seat, d, o);
            ref.choose(seat, d, o);
            if (me.cards.length !== 3 || me.up.filter((x) => !x).length !== 2) viol("deal", `고른 뒤: cards ${me.cards} up ${me.up}`);
          }
        } catch (e) {
          viol("legal-throws", `고르기에서 예외: ${e}`);
          ok = false;
          break;
        }
        ok = sameState();
        continue;
      }

      // ── 카드 돌리기 (룰 3 · 4 · 6)
      if (h.phase === "deal") {
        const s = anySeat();
        rejected("카드 돌릴 차례에 행동", () => h.act(s, ALL_ACTS[ri(ALL_ACTS.length)]));
        rejected("카드 돌릴 차례에 고르기", () => h.choose(s, 0, 1));
        const before = h.round;
        snap = null;
        let dealt: { seat: number; card: Card; up: boolean }[];
        try {
          dealt = h.advance();
        } catch (e) {
          viol("stuck", `advance 예외: ${e}`);
          ok = false;
          break;
        }
        log.push("/");
        const exp = ref.advance();
        const phaseNow = h.phase as string;
        if (before === 7) {
          if (phaseNow !== "done") {
            viol("state", "7구 뒤 advance 인데 안 끝남");
            ok = false;
          }
          break;
        }
        if (JSON.stringify(dealt) !== JSON.stringify(exp)) viol("deal", `${before + 1}구 카드 ${JSON.stringify(dealt)} (기대 ${JSON.stringify(exp)})`);
        raised.clear();
        fresh = true;
        if (ref.toAct < 0) ranOut = true;
        else if (ref.p(ref.boss).allIn) stats.allInBoss++;
        ok = sameState();
        continue;
      }

      // ── 베팅 (룰 5 · 7)
      const seat = h.toAct;
      const me = h.player(seat);
      if (!me || me.folded || me.allIn) {
        viol("stuck", `toAct ${seat} 가 행동할 수 없는 자리`);
        ok = false;
        break;
      }
      const lg = h.legal(seat);
      const rl = ref.legal(seat);
      const owed = ref.owes(ref.p(seat));
      const offered = BET_TYPES.filter((t) => lg.bets[t] !== undefined);
      // legal() 자체의 앞뒤
      if (lg.toCall > me.stack || lg.toCall < 0) viol("legal-self", `toCall ${lg.toCall} > stack ${me.stack}`);
      if (lg.canCheck === lg.toCall > 0) viol("legal-self", `체크·콜 중 정확히 하나여야: canCheck ${lg.canCheck} toCall ${lg.toCall}`);
      for (const t of offered) {
        const a = lg.bets[t]!;
        if (!(a > owed) || a > me.stack || !Number.isInteger(a)) viol("legal-self", `${t} ${a}: 받을 돈 ${owed} 보다 커야 하고 스택 ${me.stack} 이하여야`);
      }
      if (offered.length && (raised.get(seat) ?? 0) >= 2) viol("raise-cap", `자리 ${seat}: 이미 두 번 올렸는데 ${offered} 가 열려 있음`);
      // 스펙 기준과 비교
      let legalOk = true;
      if (lg.toCall !== rl.toCall || lg.canCheck !== rl.canCheck) {
        viol("legal-ref", `자리 ${seat}: toCall ${lg.toCall}/${rl.toCall} canCheck ${lg.canCheck}/${rl.canCheck} (엔진/기대)`);
        legalOk = false;
      }
      const wantTypes = BET_TYPES.filter((t) => rl.bets[t] !== undefined);
      if (offered.join() !== wantTypes.join()) {
        viol("legal-ref", `자리 ${seat}: 열린 베팅 [${offered}] (기대 [${wantTypes}])`);
        legalOk = false;
      } else
        for (const t of offered) {
          if (lg.bets[t] === rl.bets[t]) continue;
          if (t === "ddadang") {
            viol("ddadang", `자리 ${seat}: 받을 돈 ${owed} · 스택 ${me.stack} 인데 따당 ${lg.bets[t]} (기대 ${rl.bets[t]})`);
            stats.ddadangOdd++;
          } else viol("legal-ref", `자리 ${seat}: ${t} ${lg.bets[t]} (기대 ${rl.bets[t]}, 받을 돈 ${owed}, 팟 ${h.pot})`);
        }
      if (!rl.bets.full && ref.p(seat).raises >= 2) stats.capped++;
      if (ref.able.length === 1) stats.lone++;

      // 안 되는 행동: 예외 + 상태 그대로 (룰 12)
      const others = sorted.filter((s) => s !== seat);
      const other = others[ri(others.length)];
      rejected("차례 아닌 사람", () => h.act(other, ALL_ACTS[ri(ALL_ACTS.length)]));
      rejected("차례 아닌 사람의 다이", () => h.act(other, "die"));
      rejected("없는 자리", () => h.act(99, "die"));
      rejected("베팅 중 advance", () => h.advance());
      rejected("베팅 중 고르기", () => h.choose(seat, 0, 1));
      if (lg.canCheck) rejected("낼 게 없는데 콜", () => h.act(seat, "call"));
      else rejected("벳을 받았는데 체크", () => h.act(seat, "check"));
      for (const t of BET_TYPES) if (lg.bets[t] === undefined) rejected(`안 열린 베팅 ${t}`, () => h.act(seat, t));
      // 되는 행동: 복사본에서 전부 해 봄 (느려서 세 번에 한 번만 — 고른 행동은 어차피 아래에서 실제로 함)
      if (steps % 3 === 0) {
        accepted("다이", seat, "die");
        accepted(lg.canCheck ? "체크" : "콜", seat, lg.canCheck ? "check" : "call");
        for (const t of offered) accepted(t, seat, t);
      }
      if (!legalOk) {
        ok = false;
        break;
      }

      // ── 되는 행동 중에서 무작위로 하나
      const w = cfg.dieWeight ?? 1;
      const bw = cfg.betWeight ?? 1;
      let pickAt = rng() * (w + 1 + bw * offered.length);
      let type: SevenAct = "die";
      if (pickAt >= w) {
        pickAt -= w;
        type = pickAt < 1 ? (lg.canCheck ? "check" : "call") : offered[Math.min(offered.length - 1, Math.floor((pickAt - 1) / bw))];
      }
      const expAdd = type === "die" || type === "check" ? 0 : type === "call" ? rl.toCall : lg.bets[type as SevenBet]!;
      const isBet = (BET_TYPES as SevenAct[]).includes(type);
      log.push(`${seat}${type}${expAdd ? `(${expAdd})` : ""}`);
      const stack0 = me.stack;
      const pot0 = h.pot;
      const hist0 = h.history.length;
      snap = null;
      let item;
      try {
        item = h.act(seat, type);
      } catch (e) {
        viol("legal-throws", `되는 행동인데 예외: ${e}`);
        ok = false;
        break;
      }
      stats.actions++;
      fresh = false;
      ref.act(seat, type, expAdd);
      if (isBet) {
        stats.raises++;
        raised.set(seat, (raised.get(seat) ?? 0) + 1);
        if ((raised.get(seat) ?? 0) > 2) viol("raise-cap", `자리 ${seat} 가 한 구에 세 번 올림`);
        if (h.round === 7) stats.round7Bets++;
      }
      // 돌려준 기록
      if (item.add !== expAdd || item.seat !== seat || item.type !== type || item.aggressive !== isBet || item.potBefore !== pot0 || item.round !== ref.round || h.history.length !== hist0 + 1 || h.history[hist0] !== item)
        viol("state", `기록이 다름: ${JSON.stringify(item)} (기대 add ${expAdd})`);
      if (type !== "die" && item.allIn !== (expAdd > 0 && expAdd === stack0)) viol("state", `기록의 allIn ${item.allIn}`);
      ok = sameState();
    }
    if (!ok) continue;

    // ── 끝: 따로 계산한 정산과 비교 (룰 8 · 9 · 10 · 11)
    const r = h.result;
    if (!r) {
      viol("stuck", "done 인데 result 가 없음");
      continue;
    }
    for (const s of sorted) {
      rejected("끝난 뒤 행동", () => h.act(s, ALL_ACTS[ri(ALL_ACTS.length)]));
      rejected("끝난 뒤 고르기", () => h.choose(s, 0, 1));
    }
    rejected("끝난 뒤 advance", () => h.advance());
    if (h.toAct !== -1) viol("state", "끝났는데 toAct 가 남음");
    if (sum(h.players.map((p) => p.stack)) !== total) viol("conservation", `끝난 뒤 칩 합계 ${sum(h.players.map((p) => p.stack))} ≠ ${total}`);
    if (sum(Object.values(r.delta)) !== 0) viol("conservation", "delta 합 ≠ 0");
    for (const p of h.players) {
      if (p.stack < 0) viol("conservation", `자리 ${p.seat} 스택 음수`);
      if (r.delta[p.seat] !== p.stack - p.start) viol("conservation", `delta[${p.seat}] ≠ 끝 − 시작`);
    }
    if (sum(Object.values(r.won)) !== sum(r.pots.map((p) => p.amount))) viol("conservation", "won 합 ≠ 팟 합");
    if (Object.values(r.won).some((x) => x < 0 || !Number.isInteger(x))) viol("payout", "won 에 음수 · 소수가 있음");
    for (const pot of r.pots) {
      if (!pot.seats.length || pot.seats.some((s) => ref.p(s).folded)) viol("pots", "죽은 사람이 팟 자격에 있음");
      if (pot.winners.length === 0 || pot.winners.some((s) => !pot.seats.includes(s))) viol("pots", "승자가 자격자 밖에 있음");
    }
    if (new Set(r.pots.map((p) => p.seats.join())).size !== r.pots.length) viol("pots", `자격이 같은 팟이 둘: ${JSON.stringify(r.pots)}`);
    for (const s of Object.keys(r.won)) if (ref.p(Number(s)).folded) viol("payout", `죽은 자리 ${s} 가 돈을 받음`);
    // 카드가 겹치지 않음 (받은 4장 + 나중에 받은 카드)
    const all = h.players.flatMap((p) => [...p.dealt, ...p.cards.filter((c) => !p.dealt.includes(c))]);
    if (new Set(all).size !== all.length || all.some((c) => !Number.isInteger(c) || c < 0 || c > 51)) viol("deal", "카드가 겹치거나 범위 밖");
    stats.refunds += ref.refunds;

    const exp = ref.settle();
    if (exp.tie) viol("payout", "기준 구현에서 비김이 나옴 (있을 수 없음)");
    const norm = (ps: RefPot[]) =>
      JSON.stringify(ps.map((p) => [p.amount, [...p.seats].sort((a, b) => a - b), [...p.winners].sort((a, b) => a - b)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const liveSeats = ref.live.map((p) => p.seat);
    let asPot = false;
    if (norm(r.pots) !== norm(exp.pots)) {
      // 받는 사람 없는 몫을 돌려주는 대신 "혼자 자격이 있는 팟" 으로 준 경우는 따로 셈
      // (그 사람만 자격이 있는 팟이 이미 있으면 거기에 얹힌 꼴)
      let alt: RefPot[] | null = null;
      if (exp.refund) {
        const { seat, amount } = exp.refund;
        alt = exp.pots.map((p) => ({ ...p }));
        const own = alt.find((p) => p.seats.length === 1 && p.seats[0] === seat);
        if (own) own.amount += amount;
        else alt.push({ amount, seats: [seat], winners: [seat] });
      }
      if (alt && norm(r.pots) === norm(alt)) {
        asPot = true;
        stats.uncalledAnte++;
        viol("uncalled-ante", `받는 사람 없는 ${exp.refund!.amount} 이 자리 ${exp.refund!.seat} 의 팟 · won 으로 잡힘: pots ${JSON.stringify(r.pots)}`);
      } else viol("pots", `pots ${norm(r.pots)} (기대 ${norm(exp.pots)}${exp.refund ? `, 돌려줄 몫 ${JSON.stringify(exp.refund)}` : ""})`);
    }
    for (const p of ref.ps) {
      const got = r.won[p.seat] ?? 0;
      // (돌려줄 몫이 팟으로 잡힌 경우는 위에서 이미 셌으니 여기서는 그만큼 봐줌)
      const want = (exp.won[p.seat] ?? 0) + (asPot && exp.refund!.seat === p.seat ? exp.refund!.amount : 0);
      if (got !== want) viol("payout", `won[${p.seat}] ${got} (기대 ${want})`);
      if (h.player(p.seat)!.stack !== exp.final.get(p.seat)) viol("payout", `자리 ${p.seat} 끝 스택 ${h.player(p.seat)!.stack} (기대 ${exp.final.get(p.seat)})`);
    }
    if (!ref.showdown) {
      // 룰 9
      stats.foldEnd++;
      if (r.showdown !== false || r.shows.length !== 0) viol("shows", "다이로 끝났는데 쇼다운");
    } else {
      // 룰 10
      stats.showdown++;
      if (ranOut) stats.runout++;
      if (exp.pots.length > 1) stats.sidePots++;
      if (r.showdown !== true) viol("shows", "쇼다운인데 showdown 이 false");
      if (r.shows.length !== liveSeats.length || liveSeats.some((s) => !r.shows.some((x) => x.seat === s))) viol("shows", `shows 의 자리 ${r.shows.map((s) => s.seat)} (살아 있는 자리 ${liveSeats})`);
      for (const s of r.shows) {
        const q = ref.p(s.seat);
        const p = h.player(s.seat)!;
        if (s.cards.length !== 7 || sortedJoin(s.cards) !== sortedJoin([...q.down, ...q.up])) viol("shows", `자리 ${s.seat} 가 깐 카드 ${s.cards} (기대 ${[...q.down, ...q.up]})`);
        if (p.cards.length !== 7 || p.up.filter((x) => !x).length !== 3) viol("shows", `자리 ${s.seat}: 7장 · 엎은 카드 3장이어야 (cards ${p.cards.length}, up ${p.up})`);
        if (s.score !== evaluateK(s.cards) || s.name !== handNameK(s.score)) viol("shows", `자리 ${s.seat} 의 score · name 이 다름`);
        if (kCategory(s.score) !== KC[refBest(s.cards)[0]]) viol("shows", `자리 ${s.seat} 의 족보가 다름`);
      }
    }
  }
  return { v, count, stats };
}

const FUZZ_CATS: [cat: string, title: string][] = [
  ["stuck", "모든 판이 끝남 (멈춤·무한 반복 없음, toAct 는 행동할 수 있는 자리)"],
  ["deal", "카드가 스펙 순서대로 나감 · 겹치지 않음 · 고르면 엎 2 + 폄 1"],
  ["boss", "구마다 보스부터 (올인이면 그다음 사람)"],
  ["legal-self", "legal() 의 앞뒤가 맞음 (toCall ≤ 스택, 체크·콜 중 하나, 베팅은 받을 돈 초과 · 스택 이하)"],
  ["legal-ref", "legal() 의 toCall · canCheck · 열린 베팅 · 금액이 스펙과 같음 (따당 금액은 따로)"],
  ["ddadang", "따당 = 받을 돈 + max(앤티, 받을 돈)"],
  ["raise-cap", "한 사람이 한 구에 걸거나 올리는 건 두 번까지"],
  ["illegal", "안 되는 행동은 SevenError 를 내고 상태를 안 바꿈"],
  ["legal-throws", "되는 행동은 예외 없이 됨"],
  ["state", "행동 순서 · 스택 · 벳 · 라운드 끝이 스펙과 같음"],
  ["conservation", "칩 보존 · delta 합 0 · won 합 = 팟 합"],
  ["pots", "팟 구성 · 자격 · 승자"],
  ["payout", "정산(끝 스택 · won)이 따로 계산한 값과 같음"],
  ["uncalled-ante", "받는 사람 없는 몫(넘친 앤티)은 팟 · won 이 아니라 돌려준 것으로"],
  ["shows", "쇼다운: 살아 있는 사람 전부 7장(엎은 카드 3장) 공개"],
];

const FUZZ_TIMEOUT = 180_000;

function fuzzSuite(cfg: FuzzCfg, minimums: Record<string, number>) {
  describe(`퍼즈: ${cfg.name} (${cfg.hands}판)`, () => {
    let out: FuzzOut | null = null;
    const run = () => (out ??= fuzz(cfg));
    for (const [cat, title] of FUZZ_CATS) {
      it(
        title,
        () => {
          const o = run();
          const n = o.count.get(cat) ?? 0;
          expect(o.v.get(cat) ?? [], `${n}건`).toEqual([]);
        },
        FUZZ_TIMEOUT,
      );
    }
    it(
      "퍼즈가 여러 경우를 실제로 지나감",
      () => {
        const o = run();
        if (process.env.SEVEN_FUZZ_STATS) console.log(cfg.name, o.stats, Object.fromEntries(o.count));
        for (const [k, min] of Object.entries(minimums)) expect(o.stats[k], k).toBeGreaterThanOrEqual(min);
      },
      FUZZ_TIMEOUT,
    );
  });
}

// 단위 1, 아무 스택 (앤티보다 적은 스택 · 아주 큰 스택 포함), 행동은 고르게 (체크/콜 · 다이 · 열린 베팅 하나하나가 같은 확률)
fuzzSuite(
  { name: "단위 1", seed: 1, hands: 3000, unit: 1, antes: [10, 1, 100, 7], unitStacks: false },
  { showdown: 1200, foldEnd: 600, choiceFold: 150, sidePots: 600, runout: 800, shortAnte: 600, refunds: 600, capped: 400, lone: 400, allInBoss: 150, huge: 400 },
);
// 덜 죽는 판: 사이드팟 · 두 번 제한
fuzzSuite(
  { name: "단위 1 · 덜 죽음", seed: 4, hands: 2000, unit: 1, antes: [10, 100], unitStacks: false, dieWeight: 0.15, tiny: 0.05 },
  { showdown: 1200, sidePots: 800, capped: 600, refunds: 500, lone: 500 },
);
// 깊은 스택 · 체크/콜 위주: 7구까지 가는 베팅, 올인 없는 쇼다운
fuzzSuite(
  { name: "단위 10 · 깊은 스택", seed: 6, hands: 1500, unit: 10, antes: [10, 100], unitStacks: true, dieWeight: 0.06, betWeight: 0.12, deep: true },
  { showdown: 800, foldEnd: 100, round7Bets: 800, capped: 300, sidePots: 150 },
);
// 단위 10, 스택도 단위의 배수
fuzzSuite(
  { name: "단위 10 · 스택도 배수", seed: 2, hands: 1500, unit: 10, antes: [10, 50, 100], unitStacks: true, dieWeight: 0.4 },
  { showdown: 800, foldEnd: 150, sidePots: 500 },
);
// 단위 10, 스택은 아무 값 (올인 금액이 단위에 안 맞을 수 있음)
fuzzSuite(
  { name: "단위 10 · 스택은 아무 값", seed: 3, hands: 1500, unit: 10, antes: [10, 50, 100], unitStacks: false, dieWeight: 0.4 },
  { showdown: 800, foldEnd: 150, sidePots: 500 },
);
// 실제 판돈 (앤티 10만 · 50만 · 250만, 단위 1만)
fuzzSuite(
  { name: "실제 판돈", seed: 5, hands: 1500, unit: UNIT, antes: TIERS.map((t) => t.ante), unitStacks: true, dieWeight: 0.4, tiny: 0.03 },
  { showdown: 800, foldEnd: 200, sidePots: 500 },
);

// ───────────── 봇 ─────────────

/** 얼려서, 봇이 받은 정보를 고치려 들면 예외가 나게 */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const x of Object.values(o as object)) deepFreeze(x);
  }
  return o;
}

/** seven/round.ts 의 botMove 와 같은 모양 — 공개된 것만으로 만듦 (자기 카드, 모두의 펴 놓은 카드, 칩, 지금까지의 행동) */
function botView(h: SevenHand, seat: number): SevenBotView {
  const me = h.player(seat)!;
  return {
    seat,
    cards: [...me.cards],
    round: h.round,
    pot: h.pot,
    ante: h.ante,
    legal: structuredClone(h.legal(seat)),
    players: h.players.map((p) => ({
      seat: p.seat,
      key: `seat:${p.seat}`,
      up: p.cards.filter((_, i) => p.up[i]),
      folded: p.folded,
      allIn: p.allIn,
      stack: p.stack,
      bet: p.bet,
      invested: p.invested,
    })),
    history: h.history.map((x) => ({ ...x })),
  };
}

interface BotOut {
  v: Map<string, string[]>;
  stats: Record<string, number>;
  ms: number;
  maxMs: number;
}

function runBots(seed: number, hands: number): BotOut {
  const rng = mulberry32(seed);
  const ri = (n: number) => Math.floor(rng() * n);
  const v = new Map<string, string[]>();
  const stats: Record<string, number> = { hands: 0, decisions: 0, chooses: 0, showdown: 0, die: 0, check: 0, call: 0, bet: 0, facingBet: 0, round7: 0, allInSeen: 0, capped: 0 };
  for (const id of BOT_IDS) for (const t of [1, 2, 3]) stats[`${id}:${t}`] = 0;
  let ms = 0;
  let maxMs = 0;
  const HIST_KEYS = ["add", "aggressive", "allIn", "potBefore", "round", "seat", "toCallBefore", "type"].join();

  for (let n = 0; n < hands; n++) {
    const tier = ((n % 3) + 1) as TierId;
    const ante = TIERS[tier - 1].ante;
    const np = 2 + ri(4);
    const seats = Array.from({ length: np }, (_, seat) => {
      const k = rng();
      const stack = k < 0.08 ? UNIT * (1 + ri(ante / UNIT)) : k < 0.4 ? ante * (1 + ri(20)) : ante * (20 + ri(1000));
      return { seat, stack };
    });
    const deck = shuffledDeck(ri);
    const brains = new Map(
      seats.map((s, i) => {
        const b = newBrain(BOT_IDS[(n + i) % BOT_IDS.length], tier, rng);
        // 흔들린 상태도 섞음
        if (rng() < 0.3) b.heat = rng();
        return [s.seat, b] as const;
      }),
    );
    const log: string[] = [];
    const viol = (cat: string, msg: string) => {
      const list = v.get(cat) ?? [];
      if (list.length < 3) list.push(`${msg}  [#${n}] tier=${tier} seats=${JSON.stringify(seats.map((s) => [s.seat, s.stack, brains.get(s.seat)!.id]))} acts=[${log.join(" ")}] deck=[${deck.join(",")}]`);
      v.set(cat, list);
    };
    const h = new SevenHand({ seats, ante, deck, unit: UNIT });
    stats.hands++;
    let guard = 0;
    while (h.phase !== "done" && ++guard < 300) {
      if (h.phase === "choice") {
        for (const seat of h.choosing()) {
          const me = h.player(seat)!;
          const dealt = deepFreeze([...me.dealt]);
          let c;
          try {
            c = chooseSeven(dealt as Card[], brains.get(seat)!);
          } catch (e) {
            viol("choose", `chooseSeven 예외: ${e}`);
            h.autoChoose(seat);
            continue;
          }
          stats.chooses++;
          const idx = (i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < 4;
          if (!idx(c.discard) || !idx(c.open) || c.discard === c.open) viol("choose", `고른 위치가 이상함: ${JSON.stringify(c)}`);
          if (!Number.isFinite(c.thinkMs) || c.thinkMs < 0) viol("choose", `thinkMs ${c.thinkMs}`);
          try {
            h.choose(seat, c.discard, c.open);
            log.push(`${seat}c${c.discard}/${c.open}`);
          } catch (e) {
            viol("choose", `엔진이 안 받음: ${JSON.stringify(c)} → ${e}`);
            h.autoChoose(seat);
          }
        }
        continue;
      }
      if (h.phase === "deal") {
        h.advance();
        log.push("/");
        continue;
      }
      const seat = h.toAct;
      const brain = brains.get(seat)!;
      const view = botView(h, seat);
      // 봇에게 준 것 안에 남의 엎은 카드 · 버린 카드 · 덱이 없는지
      const mine = new Set(h.player(seat)!.cards);
      const publicCards = new Set(h.players.flatMap((p) => p.cards.filter((_, i) => p.up[i])));
      if (view.cards.some((c) => !mine.has(c))) viol("leak", "내 카드가 아닌 것이 cards 에 있음");
      for (const p of view.players) if (p.up.some((c) => !publicCards.has(c))) viol("leak", `자리 ${p.seat} 의 엎은 카드가 보임`);
      for (const x of view.history) if (Object.keys(x).sort().join() !== HIST_KEYS) viol("leak", `history 에 모르는 칸: ${Object.keys(x)}`);
      if (Object.keys(view).sort().join() !== "ante,cards,history,legal,players,pot,round,seat") viol("leak", "view 에 모르는 칸");
      if (Object.keys(view.players[0]).sort().join() !== "allIn,bet,folded,invested,key,seat,stack,up") viol("leak", "players 에 모르는 칸");
      deepFreeze(view);
      const snap = JSON.stringify(h);
      let d;
      const t0 = performance.now();
      try {
        d = decideSeven(view, brain);
      } catch (e) {
        viol("decide", `decideSeven 예외: ${e}`);
        h.act(seat, "die");
        continue;
      }
      const dt = performance.now() - t0;
      ms += dt;
      maxMs = Math.max(maxMs, dt);
      stats.decisions++;
      stats[`${brain.id}:${n % 3 + 1}`]++;
      if (JSON.stringify(h) !== snap) viol("decide", "봇이 판을 건드림");
      const lg = view.legal;
      if (lg.toCall > 0) stats.facingBet++;
      if (h.round === 7) stats.round7++;
      if (h.players.some((p) => p.allIn)) stats.allInSeen++;
      if (!Object.keys(lg.bets).length) stats.capped++;
      const legalNow = d.type === "die" || (d.type === "check" ? lg.canCheck : d.type === "call" ? lg.toCall > 0 : lg.bets[d.type as SevenBet] !== undefined);
      if (!legalNow) viol("decide", `안 되는 행동을 고름: ${d.type} (legal ${JSON.stringify(lg)})`);
      if (!Number.isFinite(d.thinkMs) || d.thinkMs < 0) viol("decide", `thinkMs ${d.thinkMs}`);
      // 체크할 수 있는데 죽는 건 손해
      if (d.type === "die" && lg.canCheck) viol("fold-free", `체크할 수 있는데 죽음 (${brain.id})`);
      stats[d.type === "die" || d.type === "check" || d.type === "call" ? d.type : "bet"]++;
      // 가끔은 봇의 결정 대신 아무 행동이나 해서 여러 상태를 만듦 (결정 자체는 위에서 복사본으로 확인)
      let type: SevenAct = d.type;
      if (legalNow && rng() < 0.15) {
        try {
          cloneHand(h).act(seat, d.type);
        } catch (e) {
          viol("decide", `엔진이 안 받음: ${d.type} → ${e}`);
        }
        const options: SevenAct[] = [lg.canCheck ? "check" : "call", ...BET_TYPES.filter((t) => lg.bets[t] !== undefined)];
        type = options[ri(options.length)];
      }
      try {
        h.act(seat, type);
        log.push(`${seat}${type}`);
      } catch (e) {
        viol("decide", `엔진이 안 받음: ${type} → ${e}`);
        h.act(seat, lg.canCheck ? "check" : "die");
      }
    }
    if (h.phase !== "done") viol("decide", "판이 안 끝남");
    else if (h.result!.showdown) stats.showdown++;
  }
  return { v, stats, ms, maxMs };
}

describe("봇 (공개된 정보만 보고 둠)", () => {
  let out: BotOut | null = null;
  const run = () => (out ??= runBots(11, 1500));
  const none = (cat: string) => expect(run().v.get(cat) ?? []).toEqual([]);
  const T = 120_000;

  it("decideSeven: 언제나 엔진에서 되는 행동 · 판을 건드리지 않음", () => none("decide"), T);
  it("chooseSeven: 서로 다른 0~3 위치", () => none("choose"), T);
  it("봇에게 준 정보에 남의 엎은 카드가 없음 (그래도 잘 둠)", () => none("leak"), T);
  it("체크할 수 있을 때는 죽지 않음", () => none("fold-free"), T);
  it(
    "한 번 생각하는 데 평균 50ms 미만",
    () => {
      const o = run();
      if (process.env.SEVEN_FUZZ_STATS) console.log("bots", o.stats, `avg ${(o.ms / o.stats.decisions).toFixed(3)}ms max ${o.maxMs.toFixed(1)}ms`);
      expect(o.ms / o.stats.decisions).toBeLessThan(50);
    },
    T,
  );
  it(
    "여러 상태를 실제로 지나감 (네 봇 × 세 단계)",
    () => {
      const s = run().stats;
      expect(s.decisions).toBeGreaterThanOrEqual(3000);
      expect(s.chooses).toBeGreaterThanOrEqual(3000);
      for (const id of BOT_IDS) for (const t of [1, 2, 3]) expect(s[`${id}:${t}`], `${id}:${t}`).toBeGreaterThanOrEqual(100);
      for (const k of ["die", "check", "call", "bet", "facingBet", "round7", "allInSeen", "capped", "showdown"]) expect(s[k], k).toBeGreaterThanOrEqual(50);
    },
    T,
  );

  it("승률 계산이 상대의 자리 순서에 좌우되지 않음 (5인 · 상대가 모두 두 번씩 올린 4구)", () => {
    // 0번(봇)은 K 페어를 엎어 둠. 상대 넷 중 하나가 A 페어를 펴 놓았고, 넷 다 두 번씩 올렸음.
    // 팟 오즈를 바꿔 가며 "반 넘게 콜하는 가장 큰 need" 를 찾음 = 봇이 본 승률 − 고정된 여유. A 페어가 어느 자리에 있든 비슷해야 함
    const view = (strongSeat: number, need: number): SevenBotView => {
      const ups = ["2c 7d", "3c 8d", "4c 9d", "5c Td"];
      const players = [0, 1, 2, 3, 4].map((seat) => ({
        seat,
        key: `seat:${seat}`,
        up: seat === 0 ? C("6h 2h") : C(seat === strongSeat ? "As Ah" : ups[seat - 1]),
        folded: false,
        allIn: false,
        stack: 1e9,
        bet: 0,
        invested: 100,
      }));
      const history: SevenBotView["history"] = [];
      for (let seat = 1; seat <= 4; seat++)
        for (let i = 0; i < 2; i++) history.push({ round: 4, seat, type: "ddadang", aggressive: true, add: 100, potBefore: 0, toCallBefore: 0, allIn: false });
      const toCall = 1000;
      return { seat: 0, cards: C("Ks Kd 6h 2h"), round: 4, pot: Math.round(toCall / need - toCall), ante: 100, legal: { canCheck: false, toCall, bets: {} }, players, history };
    };
    const seen = (strongSeat: number) => {
      let best = 0;
      for (let need = 0.02; need < 0.5; need += 0.02) {
        const brain = newBrain("gunmo", 3, mulberry32(7));
        let calls = 0;
        for (let i = 0; i < 40; i++) if (decideSeven(view(strongSeat, need), brain).type === "call") calls++;
        if (calls >= 20) best = need;
      }
      return Math.round(best * 100) / 100;
    };
    const first = seen(1);
    const last = seen(4);
    expect(Math.abs(first - last), `A 페어가 1번 자리일 때 ${first}, 4번(마지막) 자리일 때 ${last}`).toBeLessThanOrEqual(0.06);
  }, T);

  it("7구에 로열 스트레이트 플러시를 들고 벳을 받으면 죽지 않음", () => {
    for (const id of BOT_IDS)
      for (const tier of [1, 2, 3] as TierId[]) {
        const h = mk({
          stacks: { 0: 100000, 1: 100000 },
          dealt: { 0: "As Ks Qs 2c", 1: "2h 3d 9c 4c" },
          later: { 0: "Js 7d 8h Ts", 1: "9d 5h Jc 6d" },
        });
        chooseAll(h);
        for (let r = 4; r <= 6; r++) {
          h.advance();
          checkRound(h);
        }
        h.advance();
        // 9 페어를 펴 놓은 1번이 보스: 풀 벳
        expect(h.toAct).toBe(1);
        h.act(1, "full");
        const brain = newBrain(id, tier, mulberry32(tier * 7 + id.length));
        for (let i = 0; i < 20; i++) {
          const d = decideSeven(botView(h, 0), brain);
          expect(d.type, `${id} ${tier}`).not.toBe("die");
        }
      }
  });
});
