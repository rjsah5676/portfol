import { describe, expect, it } from "vitest";
import { Hand, HandError, type ActType } from "../src/games/poker/holdem/engine";
import {
  CAT,
  bestFive,
  categoryOf,
  evaluate,
  handName,
  parseCards,
  shuffledDeck,
  type Card,
} from "../../web/src/lib/poker/cards";

/*
 * 홀덤 엔진 검증 — 스펙(룰 1~14)을 기준으로 손으로 계산한 값과 비교.
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


/** 시계 방향 다음 자리 (엔진과 따로 계산) */
function nextSeat(sorted: number[], seat: number): number {
  for (const s of sorted) if (s > seat) return s;
  return sorted[0];
}

/** SB 부터 시계 방향 */
function dealOrder(seats: number[], button: number): number[] {
  const sorted = [...seats].sort((a, b) => a - b);
  let s = sorted.length === 2 ? button : nextSeat(sorted, button);
  const out: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    out.push(s);
    s = nextSeat(sorted, s);
  }
  return out;
}

interface Rig {
  stacks: Record<number, number>;
  button: number;
  sb?: number;
  bb?: number;
  /** 기본 판돈 (없으면 0) */
  ante?: number;
  unit?: number;
  /** 자리 → "As Kd" */
  holes?: Record<number, string>;
  /** "2c 7d 9h 3s 4d" (플랍 3 + 턴 + 리버) */
  board?: string;
}

/** 원하는 패·보드가 나오도록 덱을 짬 (나머지는 안 쓴 카드로 채움) */
function rigDeck(o: Rig): Card[] {
  const seats = Object.keys(o.stacks).map(Number);
  const order = dealOrder(seats, o.button);
  const holes: Record<number, Card[]> = {};
  for (const [s, t] of Object.entries(o.holes ?? {})) holes[Number(s)] = parseCards(t);
  const board = parseCards(o.board ?? "");
  const used = new Set<Card>([...Object.values(holes).flat(), ...board]);
  const spare: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) spare.push(c);
  const take = () => spare.shift()!;

  // 뽑히는 순서: 한 장씩 두 바퀴 → 번 → 플랍 3 → 번 → 턴 → 번 → 리버
  const seq: Card[] = [];
  for (let r = 0; r < 2; r++) for (const s of order) seq.push(holes[s]?.[r] ?? take());
  seq.push(take(), board[0] ?? take(), board[1] ?? take(), board[2] ?? take());
  seq.push(take(), board[3] ?? take());
  seq.push(take(), board[4] ?? take());
  // 덱은 뒤에서부터 뽑음
  return [...spare, ...seq.reverse()];
}

function mk(o: Rig): Hand {
  return new Hand({
    seats: Object.entries(o.stacks).map(([seat, stack]) => ({ seat: Number(seat), stack })),
    button: o.button,
    sb: o.sb ?? 5,
    bb: o.bb ?? 10,
    ante: o.ante,
    unit: o.unit,
    deck: rigDeck(o),
  });
}

type Step = [seat: number, type: ActType, amount?: number];
function play(h: Hand, steps: Step[]) {
  for (const [seat, type, amount] of steps) h.act(seat, type, amount);
}

/** phase 가 deal 인 동안 계속 깜 */
function runOut(h: Hand) {
  let guard = 0;
  while (h.phase === "deal") {
    h.advance();
    if (++guard > 10) throw new Error("advance 가 끝나지 않음");
  }
}

const stacksOf = (h: Hand) => Object.fromEntries(h.players.map((p) => [p.seat, p.stack]));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** 룰 12: 칩 보존 */
function expectConserved(h: Hand) {
  expect(h.phase).toBe("done");
  const r = h.result!;
  expect(sum(h.players.map((p) => p.stack))).toBe(sum(h.players.map((p) => p.start)));
  for (const p of h.players) expect(r.delta[p.seat]).toBe(p.stack - p.start);
  expect(sum(Object.values(r.delta))).toBe(0);
  expect(sum(Object.values(r.won))).toBe(sum(r.pots.map((p) => p.amount)));
}

// ───────────── 따로 만든 족보 판정 (엔진·cards.ts 와 독립) ─────────────

function refScore5(c: Card[]): number {
  const rs = c.map((x) => x >> 2).sort((a, b) => b - a);
  const flush = c.every((x) => (x & 3) === (c[0] & 3));
  const uniq = [...new Set(rs)];
  let sh = -1;
  if (uniq.length === 5) {
    if (rs[0] - rs[4] === 4) sh = rs[0];
    else if (rs[0] === 12 && rs[1] === 3 && rs[4] === 0) sh = 3;
  }
  const groups = uniq
    .map((r) => [rs.filter((x) => x === r).length, r] as const)
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const shape = groups.map((g) => g[0]).join("");
  let cat = 0;
  let tb = groups.map((g) => g[1]);
  if (sh >= 0 && flush) (cat = 8), (tb = [sh]);
  else if (shape === "41") cat = 7;
  else if (shape === "32") cat = 6;
  else if (flush) cat = 5;
  else if (sh >= 0) (cat = 4), (tb = [sh]);
  else if (shape === "311") cat = 3;
  else if (shape === "221") cat = 2;
  else if (shape === "2111") cat = 1;
  let v = cat;
  for (let i = 0; i < 5; i++) v = v * 13 + (tb[i] ?? 0);
  return v;
}

/** 5~7장에서 5장을 고르는 모든 경우 중 최고 */
function refScore(cards: Card[]): number {
  const n = cards.length;
  let best = -1;
  const pick: Card[] = [];
  const rec = (from: number) => {
    if (pick.length === 5) {
      best = Math.max(best, refScore5(pick));
      return;
    }
    for (let i = from; i < n; i++) {
      pick.push(cards[i]);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return best;
}
const refCat = (score: number) => Math.floor(score / 13 ** 5);

// ───────────── 룰 13: 족보 ─────────────

describe("족보 판정 (룰 13)", () => {
  const ev = (t: string) => evaluate(parseCards(t));
  const cat = (t: string) => categoryOf(ev(t));

  it("아홉 가지 족보가 순서대로 셈", () => {
    const ladder = [
      "As Kd 9h 7c 3s", // 하이카드
      "2s 2d 5h 7c 9s", // 원페어
      "2s 2d 3h 3c 9s", // 투페어
      "2s 2d 2h 7c 9s", // 트리플
      "As 2d 3h 4c 5s", // 스트레이트 (휠)
      "2s 4s 6s 8s 9s", // 플러시
      "2s 2d 2h 3c 3s", // 풀하우스
      "2s 2d 2h 2c 3s", // 포카드
      "As 2s 3s 4s 5s", // 스트레이트 플러시 (스틸 휠)
    ];
    const cats = ladder.map(cat);
    expect(cats).toEqual([
      CAT.HIGH,
      CAT.PAIR,
      CAT.TWO_PAIR,
      CAT.TRIPS,
      CAT.STRAIGHT,
      CAT.FLUSH,
      CAT.FULL_HOUSE,
      CAT.QUADS,
      CAT.STRAIGHT_FLUSH,
    ]);
    const scores = ladder.map(ev);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    // 가장 센 낮은 족보 < 가장 약한 높은 족보
    expect(ev("As Kd Qh Jc 9s")).toBeLessThan(ev("2s 2d 3h 4c 5s"));
    expect(ev("As Ad Kh Qc Js")).toBeLessThan(ev("2s 2d 3h 3c 4s"));
    expect(ev("As Ad Kh Kc Qs")).toBeLessThan(ev("2s 2d 2h 3c 4s"));
    expect(ev("As Ad Ah Kc Qs")).toBeLessThan(ev("As 2d 3h 4c 5s"));
    expect(ev("As Kd Qh Jc Ts")).toBeLessThan(ev("2s 3s 4s 5s 7s"));
    expect(ev("As Ks Qs Js 9s")).toBeLessThan(ev("2s 2d 2h 3c 3s"));
    expect(ev("As Ad Ah Kc Ks")).toBeLessThan(ev("2s 2d 2h 2c 3s"));
    expect(ev("As Ad Ah Ac Ks")).toBeLessThan(ev("As 2s 3s 4s 5s"));
  });

  it("킥커로 승부가 갈림", () => {
    expect(ev("As Kd 9h 7c 3s")).toBeGreaterThan(ev("Ad Ks 9c 7h 2s"));
    expect(ev("As Ad Kh 7c 3s")).toBeGreaterThan(ev("Ah Ac Qh Jc Ts"));
    expect(ev("As Ad Kh 7c 3s")).toBeGreaterThan(ev("Ah Ac Kd 7d 2s"));
    expect(ev("As Ad Kh Kc 3s")).toBeGreaterThan(ev("Ah Ac Qh Qc Js"));
    expect(ev("As Ad 3h 3c Ks")).toBeGreaterThan(ev("Ah Ac 3d 3s Qs"));
    expect(ev("Ks Kd 3h 3c 2s")).toBeLessThan(ev("As Ad 2h 2c 3s"));
    expect(ev("7s 7d 7h Ac 3s")).toBeGreaterThan(ev("7s 7d 7h Kc Qs"));
    expect(ev("7s 7d 7h Ac 3s")).toBeGreaterThan(ev("7s 7d 7h Ac 2s"));
    expect(ev("7s 7d 7h 7c As")).toBeGreaterThan(ev("7s 7d 7h 7c Ks"));
    expect(ev("3s 3d 3h Ac As")).toBeLessThan(ev("4s 4d 4h 2c 2s"));
    expect(ev("4s 4d 4h Ac As")).toBeGreaterThan(ev("4s 4d 4h Kc Ks"));
    expect(ev("As Ks Qs Js 9s")).toBeGreaterThan(ev("Ad Kd Qd Jd 8d"));
    expect(ev("As 7s 5s 4s 3s")).toBeGreaterThan(ev("Kd Qd Jd Td 8d"));
    // 무늬는 상관없음
    expect(ev("As Kd 9h 7c 3s")).toBe(ev("Ad Kc 9s 7h 3d"));
  });

  it("휠은 가장 낮은 스트레이트, A 하이가 가장 높음", () => {
    const wheel = ev("As 2d 3h 4c 5s");
    const six = ev("2d 3h 4c 5s 6s");
    const broadway = ev("As Kd Qh Jc Ts");
    const kingHigh = ev("Kd Qh Jc Ts 9s");
    expect(wheel).toBeLessThan(six);
    expect(kingHigh).toBeLessThan(broadway);
    expect(wheel).toBeGreaterThan(ev("As Ad Ah Kc Qs"));
    // Q-K-A-2-3 은 스트레이트가 아님
    expect(cat("Qs Kd Ah 2c 3s")).toBe(CAT.HIGH);
    // 스틸 휠 < 6 하이 스트레이트 플러시 < 로열
    const steel = ev("As 2s 3s 4s 5s");
    expect(categoryOf(steel)).toBe(CAT.STRAIGHT_FLUSH);
    expect(steel).toBeLessThan(ev("2s 3s 4s 5s 6s"));
    expect(ev("Ks Qs Js Ts 9s")).toBeLessThan(ev("As Ks Qs Js Ts"));
    expect(steel).toBeGreaterThan(ev("As Ad Ah Ac Ks"));
    // 7장: A-2-3-4-5-6 이면 6 하이
    expect(ev("As 2d 3h 4c 5s 6d Kc")).toBe(six);
    // 7장: 휠 + 같은 무늬 5장이지만 스트레이트 플러시는 아님 → 플러시
    expect(cat("As 2s 3s 4s 5d 9s Kc")).toBe(CAT.FLUSH);
    // 7장: 스트레이트 플러시가 일반 스트레이트보다 낮은 끗이어도 스트레이트 플러시
    expect(cat("5s 6s 7s 8s 9s Td Jc")).toBe(CAT.STRAIGHT_FLUSH);
    expect(ev("5s 6s 7s 8s 9s Td Jc")).toBe(ev("5d 6d 7d 8d 9d"));
  });

  it("7장에서 가장 센 5장을 고름", () => {
    // 페어 셋 → 높은 두 페어 + 가장 높은 킥커 (셋째 페어의 끗이 킥커가 될 수도)
    expect(ev("As Ad Ks Kd Qs Qd 2c")).toBe(ev("As Ad Ks Kd Qs"));
    expect(ev("9s 9d 5s 5d 3s 3d Ac")).toBe(ev("9s 9d 5s 5d Ac"));
    expect(ev("9s 9d 5s 5d 3s 3d 2c")).toBe(ev("9s 9d 5s 5d 3s"));
    // 트리플 둘 → 풀하우스 (높은 쪽이 트리플)
    expect(ev("As Ad Ah Ks Kd Kh 2c")).toBe(ev("As Ad Ah Ks Kd"));
    expect(ev("3s 3d 3h Ks Kd Kh Ac")).toBe(ev("Ks Kd Kh 3s 3d"));
    // 트리플 + 페어 둘 → 높은 페어
    expect(ev("7s 7d 7h Ks Kd 2h 2c")).toBe(ev("7s 7d 7h Ks Kd"));
    // 포카드 + 트리플 → 킥커는 트리플의 끗
    expect(ev("7s 7d 7h 7c Ks Kd Kh")).toBe(ev("7s 7d 7h 7c Ks"));
    // 포카드 + 페어 + 높은 한 장
    expect(ev("7s 7d 7h 7c 2s 2d Ah")).toBe(ev("7s 7d 7h 7c Ah"));
    // 같은 무늬 6·7장 → 위에서 5장
    expect(ev("As Ks 9s 7s 5s 3s 2d")).toBe(ev("As Ks 9s 7s 5s"));
    expect(ev("As Ks 9s 7s 5s 3s 2s")).toBe(ev("As Ks 9s 7s 5s"));
    // 플러시 > 스트레이트 (둘 다 될 때)
    expect(cat("2s 3s 4s 5d 6s 9s Kc")).toBe(CAT.FLUSH);
    // 스트레이트 > 트리플 (둘 다 될 때)
    expect(cat("5s 5d 5h 6c 7s 8d 9c")).toBe(CAT.STRAIGHT);
    // 6·7장 스트레이트 → 가장 높은 끗
    expect(ev("4s 5d 6h 7c 8s 9d Tc")).toBe(ev("6h 7c 8s 9d Tc"));
  });

  it("보드만으로 되는 패는 무승부", () => {
    const board = "Ts Jd Qh Kc As";
    expect(ev(`2c 3d ${board}`)).toBe(ev(`7h 7c ${board}`));
    const flushBoard = "As Ks Qs 9s 7s";
    expect(ev(`2c 3d ${flushBoard}`)).toBe(ev(`Ah Ad ${flushBoard}`));
    // 하지만 같은 무늬 더 높은 카드가 손에 있으면 이김
    expect(ev(`Js 3d ${flushBoard}`)).toBeGreaterThan(ev(`Ah Ad ${flushBoard}`));
    // 보드 포카드 + 킥커 싸움
    expect(ev("Ah 2c 8s 8d 8h 8c 3d")).toBeGreaterThan(ev("Kh Kc 8s 8d 8h 8c 3d"));
    expect(ev("4h 2c 8s 8d 8h 8c Ad")).toBe(ev("Kh Kc 8s 8d 8h 8c Ad"));
  });

  it("이름 · bestFive", () => {
    expect(handName(ev("As Ks Qs Js Ts"))).toBe("로열 플러시");
    expect(handName(ev("As Ad 7h 7c 3s"))).toBe("A·7 투페어");
    expect(handName(ev("As 2d 3h 4c 5s"))).toBe("5 하이 스트레이트");
    const seven = parseCards("9s 9d 5s 5d 3s 3d Ac");
    const five = bestFive(seven);
    expect(five).toHaveLength(5);
    expect(evaluate(five)).toBe(evaluate(seven));
    expect([...five].sort((a, b) => a - b)).toEqual(parseCards("9s 9d 5s 5d Ac").sort((a, b) => a - b));
  });

  it("무작위 5~7장: 따로 만든 판정(모든 5장 조합)과 대소가 같음", () => {
    const rng = mulberry32(20261007);
    const draw = (n: number) => shuffledDeck((k) => Math.floor(rng() * k)).slice(0, n);
    let prev: { e: number; r: number } | null = null;
    const seen = new Set<number>();
    for (let i = 0; i < 30000; i++) {
      const n = i % 10 === 0 ? 5 : i % 10 === 1 ? 6 : 7;
      const cards = draw(n);
      const e = evaluate(cards);
      const r = refScore(cards);
      if (categoryOf(e) !== refCat(r)) throw new Error(`족보가 다름: ${cards.join(",")} ${categoryOf(e)} vs ${refCat(r)}`);
      seen.add(refCat(r));
      if (n > 5 && evaluate(bestFive(cards)) !== e) throw new Error(`bestFive 불일치: ${cards.join(",")}`);
      if (prev && Math.sign(e - prev.e) !== Math.sign(r - prev.r)) throw new Error(`대소가 다름: ${cards.join(",")}`);
      prev = { e, r };
    }
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it("족보별로 골라 만든 패끼리도 대소가 같음 (드문 족보 보강)", () => {
    const rng = mulberry32(77);
    // 같은 보드를 두 사람이 나눠 쓰는 꼴 — 무승부·킥커 싸움이 자주 나오게 끗을 좁힘
    for (let i = 0; i < 20000; i++) {
      const pool: Card[] = [];
      const lo = Math.floor(rng() * 8);
      for (let r = lo; r < lo + 6 && r < 13; r++) for (let s = 0; s < 4; s++) pool.push((r << 2) | s);
      // 휠이 나오게 낮은 끗 쪽에는 A 를 섞음
      if (lo < 3) for (let s = 0; s < 4; s++) pool.push((12 << 2) | s);
      for (let k = pool.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1));
        [pool[k], pool[j]] = [pool[j], pool[k]];
      }
      const board = pool.slice(0, 5);
      const a = [...pool.slice(5, 7), ...board];
      const b = [...pool.slice(7, 9), ...board];
      const d1 = Math.sign(evaluate(a) - evaluate(b));
      const d2 = Math.sign(refScore(a) - refScore(b));
      if (d1 !== d2) throw new Error(`대소가 다름: [${a}] vs [${b}] → ${d1} / ${d2}`);
    }
  });
});

// ───────────── 덱 도우미 확인 ─────────────

describe("덱 짜기 도우미", () => {
  it("3인: 원하는 패와 보드가 나옴 (SB 부터 한 장씩 두 바퀴, 번 → 3 · 번 → 1 · 번 → 1)", () => {
    const h = mk({
      stacks: { 0: 1000, 1: 1000, 2: 1000 },
      button: 0,
      holes: { 0: "As Ah", 1: "Ks Kh", 2: "Qs Qh" },
      board: "2c 7d 9h 3s 4d",
    });
    expect(h.player(0)!.cards).toEqual(parseCards("As Ah"));
    expect(h.player(1)!.cards).toEqual(parseCards("Ks Kh"));
    expect(h.player(2)!.cards).toEqual(parseCards("Qs Qh"));
    play(h, [
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    expect(h.phase).toBe("deal");
    expect(h.advance()).toEqual(parseCards("2c 7d 9h"));
    expect(h.street).toBe(1);
    play(h, [
      [1, "check"],
      [2, "check"],
      [0, "check"],
    ]);
    expect(h.advance()).toEqual(parseCards("3s"));
    play(h, [
      [1, "check"],
      [2, "check"],
      [0, "check"],
    ]);
    expect(h.advance()).toEqual(parseCards("4d"));
    expect(h.board).toEqual(parseCards("2c 7d 9h 3s 4d"));
  });

  it("헤즈업 · 띄엄띄엄 앉은 자리도 맞게 나옴", () => {
    const hu = mk({ stacks: { 2: 500, 7: 500 }, button: 7, holes: { 2: "2c 3d", 7: "Ac Ad" }, board: "Ks Qs Js 9d 8d" });
    expect(hu.player(2)!.cards).toEqual(parseCards("2c 3d"));
    expect(hu.player(7)!.cards).toEqual(parseCards("Ac Ad"));
    play(hu, [
      [7, "call"],
      [2, "check"],
    ]);
    runOutChecking(hu);
    expect(hu.result!.board).toEqual(parseCards("Ks Qs Js 9d 8d"));

    const four = mk({
      stacks: { 1: 500, 3: 500, 5: 500, 8: 500 },
      button: 5,
      holes: { 1: "2c 3d", 3: "4c 5d", 5: "6c 7d", 8: "8c 9d" },
    });
    expect(four.player(1)!.cards).toEqual(parseCards("2c 3d"));
    expect(four.player(3)!.cards).toEqual(parseCards("4c 5d"));
    expect(four.player(5)!.cards).toEqual(parseCards("6c 7d"));
    expect(four.player(8)!.cards).toEqual(parseCards("8c 9d"));
  });
});

/** 남은 라운드를 전부 체크로 넘기며 끝까지 */
function runOutChecking(h: Hand) {
  let guard = 0;
  while (h.phase !== "done") {
    if (h.phase === "deal") h.advance();
    else h.act(h.toAct, "check");
    if (++guard > 60) throw new Error("끝나지 않음");
  }
}

// ───────────── 룰 1: 버튼 · 블라인드 · 순서 ─────────────

describe("버튼 · 블라인드 · 행동 순서 (룰 1)", () => {
  it("3인: 버튼 다음이 SB, 그다음이 BB, 프리플랍은 BB 다음(=버튼)부터", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    expect([h.sbSeat, h.bbSeat]).toEqual([1, 2]);
    expect(stacksOf(h)).toEqual({ 0: 1000, 1: 995, 2: 990 });
    expect(h.pot).toBe(15);
    expect(h.phase).toBe("bet");
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 10, canCheck: false, canRaise: true, minTo: 20, maxTo: 1000 });
    h.act(0, "call");
    expect(h.toAct).toBe(1);
    expect(h.legal(1)).toMatchObject({ toCall: 5, canCheck: false, canRaise: true, minTo: 20, maxTo: 1000 });
  });

  it("버튼이 끝자리면 한 바퀴 돌아서 SB · BB", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 2 });
    expect([h.sbSeat, h.bbSeat, h.toAct]).toEqual([0, 1, 2]);
    const g = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 1 });
    expect([g.sbSeat, g.bbSeat, g.toAct]).toEqual([2, 0, 1]);
  });

  it("4인 띄엄띄엄: 버튼 5 → SB 8, BB 1, UTG 3 → 5 → 8 → 1", () => {
    const h = mk({ stacks: { 1: 1000, 3: 1000, 5: 1000, 8: 1000 }, button: 5 });
    expect([h.sbSeat, h.bbSeat, h.toAct]).toEqual([8, 1, 3]);
    expect(stacksOf(h)).toEqual({ 1: 990, 3: 1000, 5: 1000, 8: 995 });
    h.act(3, "call");
    expect(h.toAct).toBe(5);
    h.act(5, "call");
    expect(h.toAct).toBe(8);
    h.act(8, "call");
    expect(h.toAct).toBe(1);
    h.act(1, "check");
    expect(h.phase).toBe("deal");
    // 플랍부터는 버튼 다음(SB)부터
    h.advance();
    expect(h.toAct).toBe(8);
    h.act(8, "check");
    expect(h.toAct).toBe(1);
    h.act(1, "check");
    expect(h.toAct).toBe(3);
    h.act(3, "check");
    expect(h.toAct).toBe(5);
  });

  it("헤즈업: 버튼이 SB 이고 프리플랍 먼저, 플랍부터는 BB 먼저", () => {
    const h = mk({ stacks: { 2: 1000, 4: 1000 }, button: 4 });
    expect([h.sbSeat, h.bbSeat]).toEqual([4, 2]);
    expect(stacksOf(h)).toEqual({ 2: 990, 4: 995 });
    expect(h.toAct).toBe(4);
    h.act(4, "call");
    expect(h.toAct).toBe(2);
    h.act(2, "check");
    for (const street of [1, 2, 3]) {
      h.advance();
      expect(h.street).toBe(street);
      expect(h.toAct).toBe(2);
      h.act(2, "check");
      expect(h.toAct).toBe(4);
      h.act(4, "check");
      expect(h.phase).toBe("deal");
    }
    h.advance();
    expect(h.phase).toBe("done");
    expectConserved(h);
  });

  it("헤즈업: 버튼이 낮은 자리여도 같음", () => {
    const h = mk({ stacks: { 2: 1000, 4: 1000 }, button: 2 });
    expect([h.sbSeat, h.bbSeat, h.toAct]).toEqual([2, 4, 2]);
    play(h, [
      [2, "call"],
      [4, "check"],
    ]);
    h.advance();
    expect(h.toAct).toBe(4);
  });

  it("플랍 이후: 버튼 다음부터 살아 있고 올인이 아닌 첫 사람", () => {
    // SB 가 죽으면 BB 부터
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 1000 }, button: 0 });
    play(h, [
      [3, "call"],
      [0, "call"],
      [1, "fold"],
      [2, "check"],
    ]);
    h.advance();
    expect(h.toAct).toBe(2);
    // SB 가 올인이면 건너뜀. BB 도 죽었으면 그다음
    const g = mk({ stacks: { 0: 1000, 1: 10, 2: 1000, 3: 1000 }, button: 0 });
    play(g, [
      [3, "call"],
      [0, "call"],
      [1, "call"], // 5 더 내고 올인
      [2, "check"],
    ]);
    expect(g.player(1)!.allIn).toBe(true);
    g.advance();
    expect(g.toAct).toBe(2);
    play(g, [
      [2, "check"],
      [3, "raise", 10],
      [0, "call"],
      [2, "fold"],
    ]);
    g.advance();
    expect(g.toAct).toBe(3);
  });
});

// ───────────── 룰 2 · 9: 모자란 블라인드 ─────────────

describe("모자란 블라인드 (룰 2 · 9)", () => {
  it("헤즈업, SB 가 모자람(3): 올인 처리, 베팅 없이 바로 런아웃, BB 는 7 을 돌려받음", () => {
    const h = mk({
      stacks: { 0: 3, 1: 1000 },
      button: 0,
      holes: { 0: "As Ah", 1: "7c 2d" },
      board: "Ks Qd 9h 5c 3s",
    });
    expect(h.player(0)).toMatchObject({ stack: 0, bet: 3, allIn: true });
    expect(h.phase).toBe("deal");
    expect(h.toAct).toBe(-1);
    expect(h.runout).toBe(true);
    // 받는 사람 없는 7 은 돌아옴
    expect(h.player(1)!.stack).toBe(997);
    expect(h.pot).toBe(6);
    runOut(h);
    expect(h.result!.showdown).toBe(true);
    expect(h.result!.won).toEqual({ 0: 6 });
    expect(stacksOf(h)).toEqual({ 0: 6, 1: 997 });
    expect(h.result!.delta).toEqual({ 0: 3, 1: -3 });
    expectConserved(h);
  });

  it("헤즈업, SB 가 딱 SB 만큼(5): 올인, BB 는 5 를 돌려받음", () => {
    const h = mk({ stacks: { 0: 5, 1: 1000 }, button: 0, holes: { 0: "7c 2d", 1: "As Ah" }, board: "Ks Qd 9h 5c 3s" });
    expect(h.phase).toBe("deal");
    expect(h.runout).toBe(true);
    runOut(h);
    expect(stacksOf(h)).toEqual({ 0: 0, 1: 1005 });
    expect(h.result!.won).toEqual({ 1: 10 });
    expectConserved(h);
  });

  it("헤즈업, SB 가 7: 5 를 내고 2 를 더 콜하면 올인 (레이즈 불가), BB 는 3 을 돌려받음", () => {
    const h = mk({ stacks: { 0: 7, 1: 1000 }, button: 0, holes: { 0: "As Ah", 1: "7c 2d" }, board: "Ks Qd 9h 5c 3s" });
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 2, canCheck: false, canRaise: false });
    expect(() => h.act(0, "raise", 7)).toThrow(HandError);
    h.act(0, "call");
    expect(h.phase).toBe("deal");
    expect(h.runout).toBe(true);
    expect(h.player(1)!.stack).toBe(993);
    runOut(h);
    expect(stacksOf(h)).toEqual({ 0: 14, 1: 993 });
    expectConserved(h);
  });

  it("헤즈업, BB 가 모자람(7): SB 는 2 만 더 내면 됨 (가장 큰 올인까지만), 레이즈 불가", () => {
    const h = mk({ stacks: { 0: 1000, 1: 7 }, button: 0, holes: { 0: "7c 2d", 1: "As Ah" }, board: "Ks Qd 9h 5c 3s" });
    expect(h.player(1)).toMatchObject({ stack: 0, bet: 7, allIn: true });
    expect(h.phase).toBe("bet");
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 2, canCheck: false, canRaise: false });
    expect(() => h.act(0, "check")).toThrow(HandError);
    expect(() => h.act(0, "raise", 20)).toThrow(HandError);
    h.act(0, "call");
    expect(h.player(0)!.stack).toBe(993);
    expect(h.phase).toBe("deal");
    expect(h.toAct).toBe(-1);
    expect(h.runout).toBe(true);
    runOut(h);
    expect(h.result!.won).toEqual({ 1: 14 });
    expect(stacksOf(h)).toEqual({ 0: 993, 1: 14 });
    expectConserved(h);
  });

  it("헤즈업, BB 가 모자람(7) 인데 SB 가 폴드: BB 는 2 를 돌려받고 10 을 가져감", () => {
    const h = mk({ stacks: { 0: 1000, 1: 7 }, button: 0 });
    h.act(0, "fold");
    expect(h.phase).toBe("done");
    expect(h.result!.showdown).toBe(false);
    expect(h.result!.won).toEqual({ 1: 10 });
    expect(h.result!.delta).toEqual({ 0: -5, 1: 5 });
    expect(stacksOf(h)).toEqual({ 0: 995, 1: 12 });
    expectConserved(h);
  });

  it("헤즈업, BB 가 SB 보다도 적음(3): 베팅 없이 런아웃, SB 는 2 를 돌려받음", () => {
    const h = mk({ stacks: { 0: 1000, 1: 3 }, button: 0, holes: { 0: "7c 2d", 1: "As Ah" }, board: "Ks Qd 9h 5c 3s" });
    expect(h.phase).toBe("deal");
    expect(h.toAct).toBe(-1);
    expect(h.runout).toBe(true);
    expect(h.player(0)!.stack).toBe(997);
    runOut(h);
    expect(stacksOf(h)).toEqual({ 0: 997, 1: 6 });
    expectConserved(h);
  });

  it("헤즈업, 둘 다 모자람(SB 3 · BB 7): 둘 다 올인, BB 는 4 를 돌려받고 팟은 6", () => {
    const h = mk({ stacks: { 0: 3, 1: 7 }, button: 0, holes: { 0: "As Ah", 1: "7c 2d" }, board: "Ks Qd 9h 5c 3s" });
    expect(h.phase).toBe("deal");
    expect(h.toAct).toBe(-1);
    expect(h.runout).toBe(true);
    expect(h.pot).toBe(6);
    expect(h.player(1)!.stack).toBe(4);
    runOut(h);
    expect(h.result!.pots).toEqual([{ amount: 6, seats: [0, 1], winners: [0] }]);
    expect(stacksOf(h)).toEqual({ 0: 6, 1: 4 });
    expectConserved(h);
  });

  it("헤즈업, 둘 다 모자람(SB 4 · BB 2): SB 가 2 를 돌려받음", () => {
    const h = mk({ stacks: { 0: 4, 1: 2 }, button: 0, holes: { 0: "7c 2d", 1: "As Ah" }, board: "Ks Qd 9h 5c 3s" });
    expect(h.phase).toBe("deal");
    runOut(h);
    expect(stacksOf(h)).toEqual({ 0: 2, 1: 4 });
    expectConserved(h);
  });

  it("3인, BB 가 모자람(4): 콜 금액은 그래도 10, 최소 레이즈는 20. 둘 다 콜하면 메인 12 + 사이드 12", () => {
    const h = mk({
      stacks: { 0: 1000, 1: 1000, 2: 4 },
      button: 0,
      holes: { 0: "7c 2d", 1: "8c 3d", 2: "As Ah" },
      board: "Ks Qd 9h 5c 4s",
    });
    expect(h.player(2)).toMatchObject({ stack: 0, bet: 4, allIn: true });
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 10, canRaise: true, minTo: 20 });
    expect(() => h.act(0, "raise", 15)).toThrow(HandError);
    h.act(0, "call");
    expect(h.toAct).toBe(1);
    expect(h.legal(1)).toMatchObject({ toCall: 5, canCheck: false, canRaise: true, minTo: 20 });
    h.act(1, "call");
    expect(h.phase).toBe("deal");
    expect(h.runout).toBe(false);
    expect(h.pots()).toEqual([
      { amount: 12, seats: [0, 1, 2] },
      { amount: 12, seats: [0, 1] },
    ]);
    // 플랍: 둘이 계속 베팅할 수 있음. SB(1) 먼저
    h.advance();
    expect(h.phase).toBe("bet");
    expect(h.toAct).toBe(1);
    runOutChecking(h);
    // 메인은 올인한 AA, 사이드는 8 하이 vs 7 하이 → 1번
    expect(h.result!.won).toEqual({ 2: 12, 1: 12 });
    expect(stacksOf(h)).toEqual({ 0: 990, 1: 1002, 2: 12 });
    expectConserved(h);
  });

  it("3인, BB 가 모자람(4), 버튼이 폴드: SB 는 맞출 게 없어 베팅 없이 런아웃, 1 을 돌려받음", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 4 }, button: 0, holes: { 1: "7c 2d", 2: "As Ah" }, board: "Ks Qd 9h 5c 3s" });
    h.act(0, "fold");
    expect(h.phase).toBe("deal");
    expect(h.toAct).toBe(-1);
    expect(h.runout).toBe(true);
    expect(h.player(1)!.stack).toBe(996);
    runOut(h);
    expect(h.result!.won).toEqual({ 2: 8 });
    expect(stacksOf(h)).toEqual({ 0: 1000, 1: 996, 2: 8 });
    expectConserved(h);
  });

  it("3인, BB 가 모자람(4), 버튼 콜 10 · SB 폴드: 버튼은 5 를 돌려받음 (SB 의 죽은 돈 5 까지만 맞춘 셈)", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 4 }, button: 0, holes: { 0: "7c 2d", 2: "As Ah" }, board: "Ks Qd 9h 5c 3s" });
    play(h, [
      [0, "call"],
      [1, "fold"],
    ]);
    expect(h.phase).toBe("deal");
    expect(h.runout).toBe(true);
    expect(h.player(0)!.stack).toBe(995);
    expect(h.pots()).toEqual([
      { amount: 12, seats: [0, 2] },
      { amount: 2, seats: [0] },
    ]);
    runOut(h);
    expect(h.result!.won).toEqual({ 2: 12, 0: 2 });
    expect(stacksOf(h)).toEqual({ 0: 997, 1: 995, 2: 12 });
    expectConserved(h);
  });

  it("3인, BB 가 7, 버튼 폴드: SB 는 2 만 더 내면 됨", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 7 }, button: 0 });
    h.act(0, "fold");
    expect(h.toAct).toBe(1);
    expect(h.legal(1)).toMatchObject({ toCall: 2, canCheck: false, canRaise: false });
    h.act(1, "call");
    expect(h.phase).toBe("deal");
    expect(h.runout).toBe(true);
    expect(h.pot).toBe(14);
  });

  it("3인, SB 가 모자람(2): 버튼은 10 을 콜, BB 는 옵션", () => {
    const h = mk({
      stacks: { 0: 1000, 1: 2, 2: 1000 },
      button: 0,
      holes: { 0: "7c 2d", 1: "As Ah", 2: "8c 3d" },
      board: "Ks Qd 9h 5c 4s",
    });
    expect(h.player(1)).toMatchObject({ stack: 0, bet: 2, allIn: true });
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 10, canRaise: true, minTo: 20 });
    h.act(0, "call");
    expect(h.toAct).toBe(2);
    expect(h.legal(2)).toMatchObject({ toCall: 0, canCheck: true, canRaise: true, minTo: 20 });
    h.act(2, "check");
    expect(h.pots()).toEqual([
      { amount: 6, seats: [0, 1, 2] },
      { amount: 16, seats: [0, 2] },
    ]);
    h.advance();
    expect(h.toAct).toBe(2);
    runOutChecking(h);
    expect(h.result!.won).toEqual({ 1: 6, 2: 16 });
    expect(stacksOf(h)).toEqual({ 0: 990, 1: 6, 2: 1006 });
    expectConserved(h);
  });

  it("4인, 두 블라인드 다 모자람(SB 3 · BB 6): UTG 는 10, UTG 가 죽으면 버튼은 6 만", () => {
    const h = mk({ stacks: { 0: 1000, 1: 3, 2: 6, 3: 1000 }, button: 0 });
    expect(h.toAct).toBe(3);
    expect(h.legal(3)).toMatchObject({ toCall: 10, canRaise: true, minTo: 20 });
    h.act(3, "fold");
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 6, canCheck: false, canRaise: false });
    h.act(0, "call");
    expect(h.phase).toBe("deal");
    expect(h.runout).toBe(true);
    expect(h.pots()).toEqual([
      { amount: 9, seats: [0, 1, 2] },
      { amount: 6, seats: [0, 2] },
    ]);
  });

  it("4인, 두 블라인드 다 모자람: UTG 콜 10 · 버튼 폴드 → UTG 는 4 를 돌려받음", () => {
    const h = mk({ stacks: { 0: 1000, 1: 3, 2: 6, 3: 1000 }, button: 0 });
    play(h, [
      [3, "call"],
      [0, "fold"],
    ]);
    expect(h.phase).toBe("deal");
    expect(h.runout).toBe(true);
    expect(h.player(3)!.stack).toBe(994);
    expect(h.pot).toBe(15);
  });

  it("4인, BB 4 · UTG 8 올인 콜 · 버튼 콜 10 · SB 폴드: 버튼은 2 를 돌려받고 팟은 16 + 9", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 4, 3: 8 }, button: 0 });
    expect(h.legal(3)).toMatchObject({ toCall: 8, canRaise: false });
    play(h, [
      [3, "call"],
      [0, "call"],
      [1, "fold"],
    ]);
    expect(h.phase).toBe("deal");
    expect(h.player(0)!.stack).toBe(992);
    expect(h.pots()).toEqual([
      { amount: 16, seats: [0, 2, 3] },
      { amount: 9, seats: [0, 3] },
    ]);
  });

  it("3인, 버튼이 8 올인 콜, BB 는 4 올인: SB 는 8 까지만(3 더) 맞춤", () => {
    const h = mk({ stacks: { 0: 8, 1: 1000, 2: 4 }, button: 0 });
    expect(h.legal(0)).toMatchObject({ toCall: 8, canRaise: false });
    h.act(0, "call");
    expect(h.toAct).toBe(1);
    expect(h.legal(1)).toMatchObject({ toCall: 3, canCheck: false, canRaise: false });
    h.act(1, "call");
    expect(h.phase).toBe("deal");
    expect(h.pots()).toEqual([
      { amount: 12, seats: [0, 1, 2] },
      { amount: 8, seats: [0, 1] },
    ]);
  });
});

// ───────────── 앤티 ─────────────

describe("앤티 (판을 시작할 때 전원이 냄)", () => {
  it("앤티를 안 주면 0: 역사에 ante 가 없고 팟은 블라인드만", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    expect(h.ante).toBe(0);
    expect(h.history.map((x) => x.type)).toEqual(["sb", "bb"]);
    expect(h.pot).toBe(15);
  });

  it("전원이 블라인드 전에 앤티를 팟에 냄 — 콜 금액 · 최소 레이즈에는 안 셈", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0, ante: 2, holes: { 0: "As Ah", 1: "7c 2d", 2: "8c 3d" }, board: "Ks Qd 9h 5c 4s" });
    expect(h.ante).toBe(2);
    // 앤티는 자리 순으로 먼저, 그다음 SB · BB
    expect(h.history.map((x) => [x.seat, x.type, x.add, x.potBefore])).toEqual([
      [0, "ante", 2, 0],
      [1, "ante", 2, 2],
      [2, "ante", 2, 4],
      [1, "sb", 5, 6],
      [2, "bb", 10, 11],
    ]);
    expect(h.pot).toBe(21);
    // 앤티는 이번 라운드 벳이 아니라 invested 에만
    expect(h.player(0)).toMatchObject({ stack: 998, bet: 0, invested: 2, allIn: false });
    expect(h.player(1)).toMatchObject({ stack: 993, bet: 5, invested: 7 });
    expect(h.player(2)).toMatchObject({ stack: 988, bet: 10, invested: 12 });
    expect(h.currentBet).toBe(10);
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 10, canCheck: false, canRaise: true, minTo: 20 });
    play(h, [
      [0, "call"],
      [1, "call"],
    ]);
    expect(h.legal(2)).toMatchObject({ toCall: 0, canCheck: true });
    h.act(2, "check");
    expect(h.phase).toBe("deal");
    // 팟 = 앤티 6 + 콜 30, 전원 자격
    expect(h.pot).toBe(36);
    expect(h.players.map((p) => p.invested)).toEqual([12, 12, 12]);
    expect(h.pots()).toEqual([{ amount: 36, seats: [0, 1, 2] }]);
    runOutChecking(h);
    expect(h.result!.won).toEqual({ 0: 36 });
    expect(h.result!.delta).toEqual({ 0: 24, 1: -12, 2: -12 });
    expectConserved(h);
  });

  it("앤티보다 적은 스택은 있는 만큼 내고 올인 (블라인드는 못 냄), 받는 사람 없는 몫은 돌아옴", () => {
    // 헤즈업: 버튼(0)이 SB 인데 1 뿐 → 앤티로 1 을 내고 올인. BB 는 앤티 2 + 블라인드 10 중 1 만 받힘
    const h = mk({ stacks: { 0: 1, 1: 1000 }, button: 0, ante: 2, holes: { 0: "As Ah", 1: "7c 2d" }, board: "Ks Qd 9h 5c 3s" });
    expect(h.history.map((x) => [x.seat, x.type, x.add, x.allIn])).toEqual([
      [0, "ante", 1, true],
      [1, "ante", 2, false],
      [0, "sb", 0, true],
      [1, "bb", 10, false],
    ]);
    expect(h.player(0)).toMatchObject({ stack: 0, bet: 0, invested: 1, allIn: true });
    // 베팅할 사람이 없음 → 바로 런아웃, 1번은 11 을 돌려받음
    expect(h.phase).toBe("deal");
    expect(h.toAct).toBe(-1);
    expect(h.runout).toBe(true);
    expect(h.player(1)).toMatchObject({ stack: 999, invested: 1 });
    expect(h.pot).toBe(2);
    expect(h.pots()).toEqual([{ amount: 2, seats: [0, 1] }]);
    runOut(h);
    expect(h.result!.won).toEqual({ 0: 2 });
    expect(stacksOf(h)).toEqual({ 0: 2, 1: 999 });
    expect(h.result!.delta).toEqual({ 0: 1, 1: -1 });
    expectConserved(h);
  });

  it("3인, 한 명이 앤티로 올인: 그 사람은 사이드팟 자격이 없고 메인팟은 앤티 높이까지만", () => {
    // 2번(BB)은 1 뿐. 0번(버튼)이 가장 센 패, 그다음 1번
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1 }, button: 0, ante: 2, holes: { 0: "As Ah", 1: "Kc Kd", 2: "7c 2d" }, board: "Qs Jd 9h 5c 3s" });
    expect(h.player(2)).toMatchObject({ stack: 0, bet: 0, invested: 1, allIn: true });
    // BB 를 못 냈어도 콜 금액은 BB 전액
    expect(h.currentBet).toBe(10);
    expect(h.toAct).toBe(0);
    expect(h.legal(0).toCall).toBe(10);
    play(h, [
      [0, "call"],
      [1, "call"],
    ]);
    expect(h.phase).toBe("deal");
    expect(h.players.map((p) => p.invested)).toEqual([12, 12, 1]);
    expect(h.pots()).toEqual([
      { amount: 3, seats: [0, 1, 2] },
      { amount: 22, seats: [0, 1] },
    ]);
    runOutChecking(h);
    expect(h.result!.pots).toEqual([
      { amount: 3, seats: [0, 1, 2], winners: [0] },
      { amount: 22, seats: [0, 1], winners: [0] },
    ]);
    expect(h.result!.won).toEqual({ 0: 25 });
    expect(stacksOf(h)).toEqual({ 0: 1013, 1: 988, 2: 0 });
    expectConserved(h);
  });
});

// ───────────── 룰 3: 최소 벳 · 레이즈 ─────────────

describe("최소 벳 · 최소 레이즈 · 단위 (룰 3)", () => {
  it("프리플랍 최소 레이즈는 2×BB, 그 뒤로는 직전 레이즈 폭만큼", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    expect(() => h.act(0, "raise", 19)).toThrow(HandError);
    expect(() => h.act(0, "raise", 10)).toThrow(HandError);
    h.act(0, "raise", 20);
    expect(h.player(0)).toMatchObject({ stack: 980, bet: 20 });
    expect(h.legal(1)).toMatchObject({ toCall: 15, minTo: 30, maxTo: 1000, canRaise: true });
    expect(() => h.act(1, "raise", 29)).toThrow(HandError);
    // raise-to 50: SB 는 5 를 이미 냈으니 45 를 더 냄. 올린 폭 30 → 다음 최소는 80
    const item = h.act(1, "raise", 50);
    expect(item).toMatchObject({ add: 45, to: 50, aggressive: true });
    expect(h.player(1)).toMatchObject({ stack: 950, bet: 50 });
    expect(h.legal(2)).toMatchObject({ toCall: 40, minTo: 80, canRaise: true });
    expect(() => h.act(2, "raise", 79)).toThrow(HandError);
    h.act(2, "raise", 80);
    expect(h.player(2)).toMatchObject({ stack: 920, bet: 80 });
    // 버튼: 60 더 내야 콜, 최소 레이즈는 110
    expect(h.legal(0)).toMatchObject({ toCall: 60, minTo: 110, canRaise: true });
    expect(h.pot).toBe(150);
  });

  it("플랍 이후 최소 벳은 BB, 레이즈 폭은 그 라운드의 직전 벳·레이즈", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000 }, button: 0 });
    play(h, [
      [0, "raise", 40],
      [1, "call"],
    ]);
    h.advance();
    // 프리플랍 레이즈 폭(30)은 다음 라운드로 넘어가지 않음
    expect(h.legal(1)).toMatchObject({ toCall: 0, canCheck: true, canRaise: true, minTo: 10, maxTo: 960 });
    expect(() => h.act(1, "raise", 9)).toThrow(HandError);
    expect(() => h.act(1, "raise", 0)).toThrow(HandError);
    h.act(1, "raise", 30);
    expect(h.legal(0)).toMatchObject({ toCall: 30, minTo: 60 });
    expect(() => h.act(0, "raise", 59)).toThrow(HandError);
    h.act(0, "raise", 100);
    expect(h.legal(1)).toMatchObject({ toCall: 70, minTo: 170 });
    expect(() => h.act(1, "raise", 169)).toThrow(HandError);
    h.act(1, "raise", 170);
    expect(h.legal(0)).toMatchObject({ toCall: 70, minTo: 240 });
  });

  it("올인은 최소에 못 미쳐도 됨 (벳 · 레이즈 모두), 가진 것보다 많이는 안 됨", () => {
    const h = mk({ stacks: { 0: 1000, 1: 16 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "check"],
    ]);
    h.advance();
    // BB 는 6 남음: 6 올인 벳 가능
    expect(h.legal(1)).toMatchObject({ canRaise: true, minTo: 6, maxTo: 6 });
    expect(() => h.act(1, "raise", 7)).toThrow(HandError);
    expect(() => h.act(1, "raise", 5)).toThrow(HandError);
    h.act(1, "raise", 6);
    expect(h.player(1)).toMatchObject({ stack: 0, allIn: true });
    expect(h.legal(0)).toMatchObject({ toCall: 6, canRaise: false });

    const g = mk({ stacks: { 0: 1000, 1: 1000, 2: 25 }, button: 0 });
    g.act(0, "raise", 20);
    g.act(1, "call");
    // BB 는 25 가 전부: 최소 30 에 못 미치지만 올인은 됨
    expect(g.legal(2)).toMatchObject({ toCall: 10, canRaise: true, minTo: 25, maxTo: 25 });
    expect(() => g.act(2, "raise", 24)).toThrow(HandError);
    expect(() => g.act(2, "raise", 26)).toThrow(HandError);
    g.act(2, "raise", 25);
    expect(g.player(2)).toMatchObject({ stack: 0, bet: 25, allIn: true });
  });

  it("단위: 올인이 아니면 단위의 배수만", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 23 }, button: 0, unit: 5 });
    expect(() => h.act(0, "raise", 22)).toThrow(HandError);
    expect(() => h.act(0, "raise", 21)).toThrow(HandError);
    h.act(0, "raise", 25);
    expect(() => h.act(1, "raise", 42)).toThrow(HandError);
    h.act(1, "call");
    // BB 23 올인은 단위에 안 맞아도 됨 (레이즈는 아님 — 25 에 못 미치는 콜)
    expect(h.legal(2)).toMatchObject({ toCall: 13, canRaise: false });
    h.act(2, "call");
    expect(h.player(2)).toMatchObject({ stack: 0, bet: 23, allIn: true });
    expect(h.phase).toBe("deal");

    // 단위에 안 맞는 올인 레이즈
    const g = mk({ stacks: { 0: 1000, 1: 1000, 2: 43 }, button: 0, unit: 5 });
    g.act(0, "raise", 25);
    g.act(1, "call");
    g.act(2, "raise", 43);
    expect(g.currentBet).toBe(43);
    expect(g.player(2)!.allIn).toBe(true);
  });

  it("단위 10, 73 올인 레이즈(정식 레이즈) 뒤: legal().minTo 로 레이즈가 돼야 함", () => {
    // 20 → 73: 폭 53. 다음 최소는 126 인데 단위(10)에 안 맞음 → 130 이어야 하거나, 126 을 받아 줘야 함
    const h = mk({ stacks: { 0: 73, 1: 2000, 2: 2000 }, button: 0, sb: 10, bb: 20, unit: 10 });
    h.act(0, "raise", 73);
    const lg = h.legal(1);
    expect(lg.canRaise).toBe(true);
    expect(lg.minTo).toBeGreaterThanOrEqual(126);
    expect(() => h.act(1, "raise", lg.minTo)).not.toThrow();
  });

  it("최소 벳에 못 미치는 올인 벳(5) 뒤: 아직 행동 안 한 사람의 최소 레이즈는 5 + BB = 15", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 15 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    h.advance();
    play(h, [
      [1, "check"],
      [2, "raise", 5], // 올인
    ]);
    expect(h.lastRaise).toBe(10);
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 5, canCheck: false, canRaise: true, minTo: 15 });
    expect(() => h.act(0, "raise", 14)).toThrow(HandError);
    h.act(0, "call");
    // 체크했던 1번: 5 를 맞춰야 함 (레이즈 가능 여부는 스펙이 모호 — 여기서는 안 봄)
    expect(h.toAct).toBe(1);
    expect(h.legal(1)).toMatchObject({ toCall: 5, canCheck: false });
  });

  it("단위에 안 맞는 올인 뒤에도 legal().minTo 는 실제로 낼 수 있는 금액이어야 함", () => {
    // 단위 10. 플랍에서 1번이 100 벳, 2번이 153 올인(못 미치는 레이즈) → 3번의 최소 레이즈는 253 이상인 "단위 배수"
    const h = mk({ stacks: { 0: 2000, 1: 2000, 2: 173, 3: 2000 }, button: 0, sb: 10, bb: 20, unit: 10 });
    play(h, [
      [3, "call"],
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    h.advance();
    play(h, [
      [1, "raise", 100],
      [2, "raise", 153],
    ]);
    const lg = h.legal(3);
    expect(lg.canRaise).toBe(true);
    expect(lg.minTo).toBeGreaterThanOrEqual(253);
    // legal() 이 알려 준 최소 금액으로 레이즈가 돼야 함
    expect(() => h.act(3, "raise", lg.minTo)).not.toThrow();
  });
});

// ───────────── 룰 4: 못 미치는 올인 ─────────────

describe("최소 레이즈에 못 미치는 올인 (룰 4)", () => {
  /** 4인이 모두 10 씩 내고 플랍을 봄. 플랍 순서: 1 → 2 → 3 → 0 */
  function flop4(stacks: Record<number, number>): Hand {
    const h = mk({ stacks, button: 0 });
    play(h, [
      [3, "call"],
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    h.advance();
    expect(h.toAct).toBe(1);
    expect(h.pot).toBe(40);
    return h;
  }

  it("(a) 벳한 사람이 못 미치는 올인을 받음 → 다시 레이즈 못 함 (콜·폴드만)", () => {
    const h = flop4({ 0: 1000, 1: 1000, 2: 160, 3: 1000 });
    play(h, [
      [1, "raise", 100],
      [2, "raise", 150], // 올인, 폭 50 < 100
      [3, "call"],
      [0, "fold"],
    ]);
    expect(h.lastRaise).toBe(100);
    expect(h.toAct).toBe(1);
    expect(h.legal(1)).toMatchObject({ toCall: 50, canCheck: false, canRaise: false });
    expect(() => h.act(1, "raise", 250)).toThrow(HandError);
    expect(() => h.act(1, "raise", 990)).toThrow(HandError);
    h.act(1, "call");
    expect(h.phase).toBe("deal");
    expect(h.pot).toBe(40 + 450);
    expect(h.runout).toBe(false);
  });

  it("(b) 이미 콜한 사람도 못 미치는 올인에는 레이즈 못 함", () => {
    const h = flop4({ 0: 1000, 1: 1000, 2: 1000, 3: 160 });
    play(h, [
      [1, "raise", 100],
      [2, "call"],
      [3, "raise", 150], // 올인, 폭 50
    ]);
    // 0번은 아직 행동 전 → 레이즈 가능
    expect(h.legal(0)).toMatchObject({ toCall: 150, canRaise: true, minTo: 250 });
    h.act(0, "call");
    expect(h.legal(1)).toMatchObject({ toCall: 50, canRaise: false });
    expect(() => h.act(1, "raise", 250)).toThrow(HandError);
    h.act(1, "call");
    expect(h.toAct).toBe(2);
    expect(h.legal(2)).toMatchObject({ toCall: 50, canRaise: false });
    expect(() => h.act(2, "raise", 250)).toThrow(HandError);
    h.act(2, "call");
    expect(h.phase).toBe("deal");
    expect(h.pot).toBe(40 + 600);
  });

  it("(c) 아직 행동 안 한 사람은 레이즈 가능, 최소는 콜 금액 + 직전 정식 레이즈 폭", () => {
    const h = flop4({ 0: 1000, 1: 1000, 2: 160, 3: 1000 });
    play(h, [
      [1, "raise", 100],
      [2, "raise", 150],
    ]);
    expect(h.toAct).toBe(3);
    expect(h.legal(3)).toMatchObject({ toCall: 150, canRaise: true, minTo: 250, maxTo: 990 });
    expect(() => h.act(3, "raise", 249)).toThrow(HandError);
    h.act(3, "raise", 250);
    h.act(0, "fold");
    // 정식 레이즈(폭 100)가 나왔으니 1번에게 다시 열림: 250 − 100 = 150 ≥ 100
    expect(h.legal(1)).toMatchObject({ toCall: 150, canRaise: true, minTo: 350 });
    h.act(1, "raise", 350);
    expect(h.legal(3)).toMatchObject({ toCall: 100, canRaise: true, minTo: 450 });
  });

  it("(d) 못 미치는 올인 둘이 합쳐 한 번의 레이즈 폭 이상이면 다시 열림", () => {
    const h = flop4({ 0: 1000, 1: 1000, 2: 160, 3: 210 });
    play(h, [
      [1, "raise", 100],
      [2, "raise", 150], // 올인 +50
      [3, "raise", 200], // 올인 +50
      [0, "call"],
    ]);
    expect(h.lastRaise).toBe(100);
    expect(h.toAct).toBe(1);
    // 100 → 200: 합쳐서 100 ≥ 100
    expect(h.legal(1)).toMatchObject({ toCall: 100, canRaise: true, minTo: 300 });
    expect(() => h.act(1, "raise", 299)).toThrow(HandError);
    h.act(1, "raise", 300);
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 100, canRaise: true, minTo: 400 });
  });

  it("(d′) 첫 올인을 이미 콜한 사람에게는 둘째 올인(+50)만으로는 안 열림", () => {
    const h = flop4({ 0: 210, 1: 1000, 2: 160, 3: 1000 });
    play(h, [
      [1, "raise", 100],
      [2, "raise", 150], // 올인
      [3, "call"], // 150 에 응수
      [0, "raise", 200], // 올인 +50
    ]);
    expect(h.legal(1)).toMatchObject({ toCall: 100, canRaise: true, minTo: 300 });
    h.act(1, "call");
    // 3번은 150 에서 200: +50 뿐
    expect(h.toAct).toBe(3);
    expect(h.legal(3)).toMatchObject({ toCall: 50, canRaise: false });
    expect(() => h.act(3, "raise", 300)).toThrow(HandError);
    h.act(3, "call");
    expect(h.phase).toBe("deal");
  });

  it("딱 최소 레이즈만큼의 올인은 정식 레이즈 → 다시 열림", () => {
    const h = flop4({ 0: 1000, 1: 1000, 2: 210, 3: 1000 });
    play(h, [
      [1, "raise", 100],
      [2, "raise", 200], // 올인, 폭 100
      [3, "call"],
      [0, "fold"],
    ]);
    expect(h.legal(1)).toMatchObject({ toCall: 100, canRaise: true, minTo: 300 });
  });

  it("프리플랍: 림프한 사람들은 BB 의 못 미치는 올인(15)에 레이즈 못 함", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 15 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "call"],
    ]);
    expect(h.legal(2)).toMatchObject({ toCall: 0, canCheck: true, canRaise: true, minTo: 15, maxTo: 15 });
    h.act(2, "raise", 15);
    expect(h.legal(0)).toMatchObject({ toCall: 5, canRaise: false });
    expect(() => h.act(0, "raise", 25)).toThrow(HandError);
    h.act(0, "call");
    expect(h.legal(1)).toMatchObject({ toCall: 5, canRaise: false });
    h.act(1, "call");
    expect(h.phase).toBe("deal");
    expect(h.pot).toBe(45);
  });

  it("프리플랍: 레이즈(30) 뒤 SB 의 못 미치는 올인(45) — 행동 전인 BB 는 65 부터 레이즈, 레이즈한 사람은 못 함", () => {
    const h = mk({ stacks: { 0: 1000, 1: 45, 2: 1000 }, button: 0 });
    play(h, [
      [0, "raise", 30],
      [1, "raise", 45],
    ]);
    expect(h.legal(2)).toMatchObject({ toCall: 35, canRaise: true, minTo: 65 });
    expect(() => h.act(2, "raise", 64)).toThrow(HandError);
    h.act(2, "call");
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 15, canRaise: false });
    h.act(0, "call");
    expect(h.phase).toBe("deal");
    expect(h.pot).toBe(135);
  });
});

// ───────────── 룰 5: BB 옵션 ─────────────

describe("BB 옵션 (룰 5)", () => {
  it("림프로 돌아오면 BB 가 체크하거나 레이즈할 수 있음", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "call"],
    ]);
    expect(h.phase).toBe("bet");
    expect(h.toAct).toBe(2);
    expect(h.legal(2)).toMatchObject({ toCall: 0, canCheck: true, canRaise: true, minTo: 20 });
    expect(() => h.act(2, "call")).toThrow(HandError);
    h.act(2, "raise", 30);
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 20, canRaise: true, minTo: 50 });
    play(h, [
      [0, "call"],
      [1, "fold"],
    ]);
    expect(h.phase).toBe("deal");
    expect(h.pot).toBe(70);
  });

  it("BB 가 체크하면 라운드 끝", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    expect(h.phase).toBe("deal");
    expect(h.toAct).toBe(-1);
    expect(h.pot).toBe(30);
  });

  it("헤즈업: SB 가 콜하면 BB 옵션", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000 }, button: 0 });
    h.act(0, "call");
    expect(h.phase).toBe("bet");
    expect(h.toAct).toBe(1);
    expect(h.legal(1)).toMatchObject({ canCheck: true, canRaise: true, minTo: 20 });
    h.act(1, "raise", 40);
    expect(h.toAct).toBe(0);
    expect(h.legal(0)).toMatchObject({ toCall: 30, minTo: 70 });
  });

  it("SB 가 죽고 버튼만 림프해도 BB 옵션", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "fold"],
    ]);
    expect(h.phase).toBe("bet");
    expect(h.toAct).toBe(2);
    expect(h.legal(2).canCheck).toBe(true);
  });

  it("레이즈에 모두 콜하면 레이즈한 사람에게 다시 돌아가지 않음", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    play(h, [
      [0, "raise", 30],
      [1, "call"],
      [2, "call"],
    ]);
    expect(h.phase).toBe("deal");
    expect(h.pot).toBe(90);
  });
});

// ───────────── 룰 6 · 11: 받는 사람 없는 벳 · 폴드로 끝 ─────────────

describe("받는 사람 없는 벳 · 폴드로 끝남 (룰 6 · 11)", () => {
  it("헤즈업: SB 가 30 으로 레이즈, BB 폴드 → 20 은 돌려받고 won 은 20", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000 }, button: 0 });
    h.act(0, "raise", 30);
    h.act(1, "fold");
    expect(h.phase).toBe("done");
    expect(h.toAct).toBe(-1);
    const r = h.result!;
    expect(r.showdown).toBe(false);
    expect(r.shows).toEqual([]);
    expect(r.won).toEqual({ 0: 20 });
    expect(r.pots).toEqual([{ amount: 20, seats: [0], winners: [0] }]);
    expect(r.delta).toEqual({ 0: 10, 1: -10 });
    expect(stacksOf(h)).toEqual({ 0: 1010, 1: 990 });
    expectConserved(h);
    expect(() => h.act(0, "check")).toThrow(HandError);
    expect(() => h.advance()).toThrow(HandError);
  });

  it("전부 죽어 BB 가 걸어서 이김: SB 의 5 만 얻음", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    play(h, [
      [0, "fold"],
      [1, "fold"],
    ]);
    expect(h.phase).toBe("done");
    expect(h.result!.won).toEqual({ 2: 10 });
    expect(h.result!.delta).toEqual({ 0: 0, 1: -5, 2: 5 });
    expectConserved(h);
  });

  it("헤즈업: SB 가 바로 폴드", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000 }, button: 0 });
    h.act(0, "fold");
    expect(h.result!.won).toEqual({ 1: 10 });
    expect(h.result!.delta).toEqual({ 0: -5, 1: 5 });
    expectConserved(h);
  });

  it("앞 라운드 돈 + 턴 벳 200 에 폴드: 200 은 돌려받고 won 은 120", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "check"],
    ]);
    h.advance();
    play(h, [
      [1, "raise", 50],
      [0, "call"],
    ]);
    h.advance();
    play(h, [
      [1, "raise", 200],
      [0, "fold"],
    ]);
    const r = h.result!;
    expect(r.showdown).toBe(false);
    expect(r.won).toEqual({ 1: 120 });
    expect(r.delta).toEqual({ 0: -60, 1: 60 });
    expect(r.board).toHaveLength(4);
    expectConserved(h);
  });

  it("레이즈에 폴드: 레이즈로 더 올린 만큼만 돌려받음", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "check"],
    ]);
    h.advance();
    play(h, [
      [1, "raise", 50],
      [0, "raise", 200],
      [1, "fold"],
    ]);
    // 팟: 20 + 50 + (200 중 50) = 120
    expect(h.result!.won).toEqual({ 0: 120 });
    expect(h.result!.delta).toEqual({ 0: 60, 1: -60 });
    expectConserved(h);
  });

  it("콜한 사람이 전부 더 적게 올인: 벳 100 에 40 올인 콜 → 60 을 돌려받음", () => {
    const h = mk({
      stacks: { 0: 1000, 1: 50, 2: 1000 },
      button: 0,
      holes: { 1: "As Ah", 2: "7c 2d" },
      board: "Ks Qd 9h 5c 3s",
    });
    play(h, [
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    h.advance();
    play(h, [
      [1, "check"],
      [2, "raise", 100],
      [0, "fold"],
    ]);
    expect(h.toAct).toBe(1);
    expect(h.legal(1)).toMatchObject({ toCall: 40, canRaise: false });
    h.act(1, "call");
    expect(h.phase).toBe("deal");
    expect(h.toAct).toBe(-1);
    expect(h.runout).toBe(true);
    expect(h.player(2)!.stack).toBe(950);
    expect(h.pot).toBe(110);
    runOut(h);
    expect(h.result!.won).toEqual({ 1: 110 });
    expect(stacksOf(h)).toEqual({ 0: 990, 1: 110, 2: 950 });
    expectConserved(h);
  });

  it("올인 콜이 둘(40 · 70): 가장 많이 낸 콜(70)까지만 받고 30 을 돌려받음", () => {
    const h = mk({ stacks: { 0: 80, 1: 50, 2: 1000 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    h.advance();
    play(h, [
      [1, "check"],
      [2, "raise", 100],
      [0, "call"],
      [1, "call"],
    ]);
    expect(h.phase).toBe("deal");
    expect(h.runout).toBe(true);
    expect(h.player(2)!.stack).toBe(920);
    expect(h.pots()).toEqual([
      { amount: 150, seats: [0, 1, 2] },
      { amount: 60, seats: [0, 2] },
    ]);
  });

  it("3인 중 둘이 죽으면 바로 끝 (보드를 더 깔지 않음)", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    h.advance();
    play(h, [
      [1, "raise", 20],
      [2, "fold"],
      [0, "fold"],
    ]);
    expect(h.phase).toBe("done");
    const r = h.result!;
    expect(r.showdown).toBe(false);
    expect(r.shows).toEqual([]);
    expect(r.board).toHaveLength(3);
    expect(r.won).toEqual({ 1: 30 });
    expect(r.delta).toEqual({ 0: -10, 1: 20, 2: -10 });
    expectConserved(h);
  });

  it("체크할 수 있을 때 폴드해도 됨 — 남은 한 명이 이김", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "fold"],
    ]);
    expect(h.phase).toBe("done");
    expect(h.result!.won).toEqual({ 0: 20 });
    expect(h.result!.delta).toEqual({ 0: 10, 1: -10 });
    expectConserved(h);
  });
});

// ───────────── 룰 7: 사이드팟 ─────────────

describe("사이드팟 (룰 7)", () => {
  const board = "2c 7d 9h 3s 4d";
  /** 0번 700 · 1번 300 · 2번 100 이 프리플랍에 전부 올인 */
  function threeWayAllIn(holes: Record<number, string>, b = board): Hand {
    const h = mk({ stacks: { 0: 700, 1: 300, 2: 100 }, button: 0, holes, board: b });
    expect(h.legal(0)).toMatchObject({ toCall: 10, canRaise: true, maxTo: 700 });
    h.act(0, "raise", 700);
    expect(h.legal(1)).toMatchObject({ toCall: 295, canRaise: false });
    h.act(1, "call");
    expect(h.legal(2)).toMatchObject({ toCall: 90, canRaise: false });
    h.act(2, "call");
    expect(h.phase).toBe("deal");
    expect(h.toAct).toBe(-1);
    expect(h.runout).toBe(true);
    // 0번의 400 은 받는 사람이 없어 바로 돌아옴
    expect(h.player(0)!.stack).toBe(400);
    expect(h.pots()).toEqual([
      { amount: 300, seats: [0, 1, 2] },
      { amount: 400, seats: [0, 1] },
    ]);
    runOut(h);
    expect(h.result!.showdown).toBe(true);
    return h;
  }

  it("가장 적은 스택이 최고 패, 중간이 둘째: 메인 300 → 2번, 사이드 400 → 1번, 0번은 400 돌려받음", () => {
    const h = threeWayAllIn({ 0: "Qs Qh", 1: "Ks Kh", 2: "As Ah" });
    const r = h.result!;
    expect(r.pots).toEqual([
      { amount: 300, seats: [0, 1, 2], winners: [2] },
      { amount: 400, seats: [0, 1], winners: [1] },
    ]);
    expect(r.won).toEqual({ 2: 300, 1: 400 });
    expect(stacksOf(h)).toEqual({ 0: 400, 1: 400, 2: 300 });
    expect(r.delta).toEqual({ 0: -300, 1: 100, 2: 200 });
    // 올인 판은 전부 깜
    expect(r.shows).toHaveLength(3);
    for (const s of r.shows) expect(s.cards).not.toBeNull();
    expectConserved(h);
  });

  it("가장 큰 스택이 최고 패: 전부 가져감", () => {
    const h = threeWayAllIn({ 0: "As Ah", 1: "Ks Kh", 2: "Qs Qh" });
    expect(h.result!.won).toEqual({ 0: 700 });
    expect(stacksOf(h)).toEqual({ 0: 1100, 1: 0, 2: 0 });
    expectConserved(h);
  });

  it("중간 스택이 최고 패: 메인 + 사이드 700, 0번은 돌려받은 400 만", () => {
    const h = threeWayAllIn({ 0: "Qs Qh", 1: "As Ah", 2: "Ks Kh" });
    expect(h.result!.won).toEqual({ 1: 700 });
    expect(stacksOf(h)).toEqual({ 0: 400, 1: 700, 2: 0 });
    expectConserved(h);
  });

  it("가장 적은 스택이 최고, 가장 큰 스택이 둘째: 메인 300 → 2번, 사이드 400 → 0번", () => {
    const h = threeWayAllIn({ 0: "Ks Kh", 1: "Qs Qh", 2: "As Ah" });
    expect(h.result!.won).toEqual({ 2: 300, 0: 400 });
    expect(stacksOf(h)).toEqual({ 0: 800, 1: 0, 2: 300 });
    expectConserved(h);
  });

  it("메인팟이 무승부(0번 · 2번): 150 씩, 사이드는 0번", () => {
    const h = threeWayAllIn({ 0: "Ad Kd", 1: "Qs Qh", 2: "Ac Kc" }, "As Kh 7c 4d 2s");
    const r = h.result!;
    expect(r.pots).toEqual([
      { amount: 300, seats: [0, 1, 2], winners: [0, 2] },
      { amount: 400, seats: [0, 1], winners: [0] },
    ]);
    expect(r.won).toEqual({ 0: 550, 2: 150 });
    expect(stacksOf(h)).toEqual({ 0: 950, 1: 0, 2: 150 });
    expectConserved(h);
  });

  it("죽은 사람의 돈은 팟에 남음: 올인(50)은 메인 155 만, 사이드 160 은 남은 한 명에게", () => {
    const h = mk({
      stacks: { 0: 1000, 1: 1000, 2: 50, 3: 1000 },
      button: 0,
      holes: { 0: "Jc Td", 2: "As Ah", 3: "Ks Kh" },
      board,
    });
    play(h, [
      [3, "raise", 30],
      [0, "call"],
      [1, "fold"], // 5 는 죽은 돈
      [2, "call"],
    ]);
    h.advance();
    expect(h.toAct).toBe(2);
    play(h, [
      [2, "raise", 20], // 올인
      [3, "raise", 100],
      [0, "call"],
    ]);
    expect(h.phase).toBe("deal");
    expect(h.runout).toBe(false);
    h.advance();
    expect(h.phase).toBe("bet");
    expect(h.toAct).toBe(3);
    play(h, [
      [3, "raise", 200],
      [0, "fold"],
    ]);
    // 아직 2번(올인)이 살아 있으니 끝나지 않고, 200 은 돌아옴
    expect(h.phase).toBe("deal");
    expect(h.runout).toBe(true);
    expect(h.player(3)!.stack).toBe(870);
    expect(h.pots()).toEqual([
      { amount: 155, seats: [2, 3] },
      { amount: 160, seats: [3] },
    ]);
    runOut(h);
    const r = h.result!;
    expect(r.showdown).toBe(true);
    expect(r.won).toEqual({ 2: 155, 3: 160 });
    expect(stacksOf(h)).toEqual({ 0: 870, 1: 995, 2: 155, 3: 1030 });
    expect(r.delta).toEqual({ 0: -130, 1: -5, 2: 105, 3: 30 });
    expectConserved(h);
  });

  it("죽은 사람이 중간 금액까지 냈어도 자격이 같은 팟은 하나: 메인 400 + 사이드 500", () => {
    const h = mk({
      stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 100 },
      button: 0,
      holes: { 0: "Jc Td", 1: "Ks Kh", 2: "Qs Qh", 3: "As Ah" },
      board,
    });
    play(h, [
      [3, "raise", 100], // 올인
      [0, "call"],
      [1, "call"],
      [2, "call"],
    ]);
    h.advance();
    play(h, [
      [1, "raise", 100],
      [2, "call"],
      [0, "call"],
    ]);
    h.advance();
    play(h, [
      [1, "raise", 100],
      [2, "call"],
      [0, "fold"], // 200 을 내고 죽음
    ]);
    expect(h.pots()).toEqual([
      { amount: 400, seats: [1, 2, 3] },
      { amount: 500, seats: [1, 2] },
    ]);
    h.advance();
    play(h, [
      [1, "check"],
      [2, "check"],
    ]);
    h.advance();
    const r = h.result!;
    expect(r.pots).toEqual([
      { amount: 400, seats: [1, 2, 3], winners: [3] },
      { amount: 500, seats: [1, 2], winners: [1] },
    ]);
    expect(r.won).toEqual({ 3: 400, 1: 500 });
    expect(stacksOf(h)).toEqual({ 0: 800, 1: 1200, 2: 700, 3: 400 });
    expectConserved(h);
  });

  it("올인 금액이 넷 다 다름(50 · 120 · 300 · 800): 팟 200 / 210 / 360, 순서대로 센 패", () => {
    // 3번(UTG) 800 올인 → 0번 300 · 1번 120 · 2번 50 이 차례로 올인 콜
    const h = mk({
      stacks: { 0: 300, 1: 120, 2: 50, 3: 800 },
      button: 0,
      holes: { 0: "Qs Qh", 1: "Ks Kh", 2: "As Ah", 3: "Jc Jd" },
      board,
    });
    play(h, [
      [3, "raise", 800],
      [0, "call"],
      [1, "call"],
      [2, "call"],
    ]);
    expect(h.player(3)!.stack).toBe(500);
    expect(h.pots()).toEqual([
      { amount: 200, seats: [0, 1, 2, 3] },
      { amount: 210, seats: [0, 1, 3] },
      { amount: 360, seats: [0, 3] },
    ]);
    runOut(h);
    expect(h.result!.won).toEqual({ 2: 200, 1: 210, 0: 360 });
    expect(stacksOf(h)).toEqual({ 0: 360, 1: 210, 2: 200, 3: 500 });
    expectConserved(h);
  });
});

// ───────────── 룰 8: 런아웃 ─────────────

describe("베팅이 더 없을 때의 런아웃 (룰 8)", () => {
  it("헤즈업 프리플랍 올인 콜: deal · toAct −1 · runout, advance 네 번으로 쇼다운", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000 }, button: 0, holes: { 0: "As Ah", 1: "Ks Kh" }, board: "2c 7d 9h 3s 4d" });
    h.act(0, "raise", 1000);
    expect(h.legal(1)).toMatchObject({ toCall: 990, canRaise: false });
    h.act(1, "call");
    expect(h.phase).toBe("deal");
    expect(h.toAct).toBe(-1);
    expect(h.runout).toBe(true);
    expect(() => h.act(0, "check")).toThrow(HandError);
    expect(() => h.act(1, "check")).toThrow(HandError);
    expect(h.advance()).toHaveLength(3);
    expect([h.phase, h.toAct, h.runout, h.street]).toEqual(["deal", -1, true, 1]);
    expect(h.advance()).toHaveLength(1);
    expect([h.phase, h.toAct, h.runout, h.street]).toEqual(["deal", -1, true, 2]);
    expect(h.advance()).toHaveLength(1);
    expect([h.phase, h.toAct, h.runout, h.street]).toEqual(["deal", -1, true, 3]);
    expect(h.result).toBeNull();
    expect(h.advance()).toEqual([]);
    expect(h.phase).toBe("done");
    const r = h.result!;
    expect(r.showdown).toBe(true);
    expect(r.board).toEqual(parseCards("2c 7d 9h 3s 4d"));
    expect(r.won).toEqual({ 0: 2000 });
    expect(stacksOf(h)).toEqual({ 0: 2000, 1: 0 });
    expect(r.shows.map((s) => s.cards)).not.toContain(null);
    expectConserved(h);
    expect(() => h.advance()).toThrow(HandError);
  });

  it("스택이 다른 올인 콜: 600 은 돌려받고 팟 800", () => {
    const h = mk({ stacks: { 0: 1000, 1: 400 }, button: 0, holes: { 0: "7c 2d", 1: "Ks Kh" }, board: "As Qd 9h 3s 4d" });
    h.act(0, "raise", 1000);
    h.act(1, "call");
    expect(h.runout).toBe(true);
    expect(h.player(0)!.stack).toBe(600);
    expect(h.pot).toBe(800);
    runOut(h);
    expect(stacksOf(h)).toEqual({ 0: 600, 1: 800 });
    expectConserved(h);
  });

  it("플랍에서 올인 한 명 + 둘 중 하나가 죽음 → 남은 카드는 베팅 없이", () => {
    const h = mk({
      stacks: { 0: 1000, 1: 1000, 2: 30 },
      button: 0,
      holes: { 1: "7c 2d", 2: "As Ah" },
      board: "Ks Qd 9h 5c 3s",
    });
    play(h, [
      [0, "raise", 30],
      [1, "call"],
      [2, "call"], // 올인
    ]);
    expect(h.runout).toBe(false);
    h.advance();
    expect(h.phase).toBe("bet");
    expect(h.toAct).toBe(1);
    play(h, [
      [1, "raise", 50],
      [0, "fold"],
    ]);
    expect([h.phase, h.toAct, h.runout]).toEqual(["deal", -1, true]);
    expect(h.player(1)!.stack).toBe(970);
    h.advance();
    expect([h.phase, h.toAct, h.street]).toEqual(["deal", -1, 2]);
    h.advance();
    expect([h.phase, h.toAct, h.street]).toEqual(["deal", -1, 3]);
    h.advance();
    expect(h.phase).toBe("done");
    expect(h.result!.won).toEqual({ 2: 90 });
    expect(stacksOf(h)).toEqual({ 0: 970, 1: 970, 2: 90 });
    expectConserved(h);
  });

  it("올인이 있어도 걸 수 있는 사람이 둘이면 베팅은 계속", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 30 }, button: 0 });
    play(h, [
      [0, "raise", 30],
      [1, "call"],
      [2, "call"],
    ]);
    for (const street of [1, 2, 3]) {
      h.advance();
      expect([h.phase, h.toAct, h.street, h.runout]).toEqual(["bet", 1, street, false]);
      play(h, [
        [1, "check"],
        [0, "check"],
      ]);
      expect(h.phase).toBe("deal");
    }
    h.advance();
    expect(h.phase).toBe("done");
    expectConserved(h);
  });

  it("플랍 체크 뒤 올인 벳을 받으면: 혼자 남은 사람은 콜·폴드만 (레이즈 불가)", () => {
    const h = mk({ stacks: { 0: 80, 1: 1000, 2: 50 }, button: 0 });
    play(h, [
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    h.advance();
    play(h, [
      [1, "check"],
      [2, "raise", 40], // 올인
      [0, "raise", 70], // 올인
    ]);
    expect(h.toAct).toBe(1);
    expect(h.legal(1)).toMatchObject({ toCall: 70, canCheck: false, canRaise: false });
    expect(() => h.act(1, "raise", 200)).toThrow(HandError);
    h.act(1, "call");
    expect([h.phase, h.toAct, h.runout]).toEqual(["deal", -1, true]);
    expect(h.pots()).toEqual([
      { amount: 150, seats: [0, 1, 2] },
      { amount: 60, seats: [0, 1] },
    ]);
  });

  it("리버 올인 콜: advance 한 번으로 쇼다운, 전부 깜", () => {
    const h = mk({ stacks: { 0: 500, 1: 500 }, button: 0, holes: { 0: "7c 2d", 1: "As Ah" }, board: "Ks Qd 9h 5c 3s" });
    play(h, [
      [0, "call"],
      [1, "check"],
    ]);
    for (let i = 0; i < 3; i++) {
      h.advance();
      if (i < 2)
        play(h, [
          [1, "check"],
          [0, "check"],
        ]);
    }
    play(h, [
      [1, "raise", 490],
      [0, "call"],
    ]);
    expect([h.phase, h.toAct]).toEqual(["deal", -1]);
    h.advance();
    expect(h.phase).toBe("done");
    expect(h.result!.shows.map((s) => s.cards)).not.toContain(null);
    expect(stacksOf(h)).toEqual({ 0: 0, 1: 1000 });
    expectConserved(h);
  });
});

// ───────────── 룰 10: 쇼다운 ─────────────

describe("쇼다운 (룰 10)", () => {
  const royal = "Ts Js Qs Ks As";

  /** 3인이 10 씩 내고(누가 죽을지는 fold 로) 끝까지 체크 */
  function limpedCheckDown(o: Rig, foldSeat = -1): Hand {
    const h = mk(o);
    for (let i = 0; i < 3; i++) {
      const s = h.toAct;
      if (s === foldSeat) h.act(s, "fold");
      else if (h.legal(s).canCheck) h.act(s, "check");
      else h.act(s, "call");
    }
    expect(h.phase).toBe("deal");
    runOutChecking(h);
    return h;
  }

  it("보드가 로열이면 무승부. 남는 칩 1 은 버튼 왼쪽에서 가까운 승자에게 (버튼 위치를 바꿔 가며)", () => {
    // 버튼 0: SB 1 이 5 를 내고 죽음 → 팟 25. 버튼 왼쪽부터 1(죽음) → 2 → 0
    let h = limpedCheckDown({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0, board: royal }, 1);
    expect(h.result!.pots).toEqual([{ amount: 25, seats: [0, 2], winners: [0, 2] }]);
    expect(h.result!.won).toEqual({ 0: 12, 2: 13 });
    expect(stacksOf(h)).toEqual({ 0: 1002, 1: 995, 2: 1003 });
    expectConserved(h);
    // 버튼 2: SB 0 이 죽음. 버튼 왼쪽부터 0(죽음) → 1 → 2
    h = limpedCheckDown({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 2, board: royal }, 0);
    expect(h.result!.won).toEqual({ 1: 13, 2: 12 });
    expectConserved(h);
    // 버튼 1: SB 2 가 죽음. 버튼 왼쪽부터 2(죽음) → 0 → 1
    h = limpedCheckDown({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 1, board: royal }, 2);
    expect(h.result!.won).toEqual({ 0: 13, 1: 12 });
    expectConserved(h);
  });

  it("단위 5: 25 를 둘이 나누면 10 씩 + 남는 5 는 버튼 왼쪽 승자", () => {
    const h = limpedCheckDown({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0, board: royal, unit: 5 }, 1);
    expect(h.result!.won).toEqual({ 0: 10, 2: 15 });
    expect(stacksOf(h)).toEqual({ 0: 1000, 1: 995, 2: 1005 });
    expectConserved(h);
  });

  it("셋이 나누고 2 가 남음(팟 35): 버튼(맨 뒤)은 11, 버튼 왼쪽 첫 승자는 12 이상", () => {
    // 스펙이 "남는 칩은 첫 승자에게" 인지 "앞에서부터 하나씩" 인지 모호 → 둘 다에서 참인 것만 확인
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 1000 }, button: 0, board: royal });
    play(h, [
      [3, "call"],
      [0, "call"],
      [1, "fold"],
      [2, "check"],
    ]);
    runOutChecking(h);
    const w = h.result!.won;
    expect(w[0] + w[2] + w[3]).toBe(35);
    expect(w[0]).toBe(11);
    expect(w[2]).toBeGreaterThanOrEqual(12);
    expect(w[3]).toBeGreaterThanOrEqual(11);
    expect(w[2]).toBeGreaterThanOrEqual(w[3]);
    expectConserved(h);
  });

  it("스택이 단위의 배수가 아닐 때의 무승부 (스펙 모호 — 칩 보존만 확인)", () => {
    // 단위 5, 둘 다 3 씩 낸 팟 6 을 비김: "단위 배수로 똑같이" 면 0 씩이고 남는 6 은 전부 첫 승자 몫 → 한 명은 비기고도 3 을 잃음
    const h = mk({ stacks: { 0: 10, 1: 3 }, button: 0, unit: 5, board: royal });
    runOut(h);
    expect(h.result!.pots).toEqual([{ amount: 6, seats: [0, 1], winners: [0, 1] }]);
    expect((h.result!.won[0] ?? 0) + (h.result!.won[1] ?? 0)).toBe(6);
    expectConserved(h);
  });

  it("전원이 보드로 비기면 낸 만큼 돌려받음 (딱 나눠질 때)", () => {
    const h = limpedCheckDown({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0, board: royal });
    expect(h.result!.won).toEqual({ 0: 10, 1: 10, 2: 10 });
    expect(h.result!.delta).toEqual({ 0: 0, 1: 0, 2: 0 });
    expectConserved(h);
  });

  const b = "3c 8d 9h Js 4d";
  it("리버가 체크로 돌면 버튼 왼쪽부터 깜. 앞 패를 못 이기고 받을 것도 없으면 덮음", () => {
    // 순서 1 → 2 → 0. 1: 7 하이, 2: KK, 0: QQ
    const h = limpedCheckDown({
      stacks: { 0: 1000, 1: 1000, 2: 1000 },
      button: 0,
      holes: { 0: "Qs Qh", 1: "7c 2d", 2: "Ks Kh" },
      board: b,
    });
    const r = h.result!;
    expect(r.shows.map((s) => s.seat)).toEqual([1, 2, 0]);
    expect(r.shows[0].cards).toEqual(parseCards("7c 2d"));
    expect(r.shows[1].cards).toEqual(parseCards("Ks Kh"));
    expect(r.shows[2].cards).toBeNull();
    expect(r.won).toEqual({ 2: 30 });
    expectConserved(h);
  });

  it("첫 사람이 가장 세면 나머지는 전부 덮음", () => {
    const h = limpedCheckDown({
      stacks: { 0: 1000, 1: 1000, 2: 1000 },
      button: 0,
      holes: { 0: "Qs Qh", 1: "As Ah", 2: "Ks Kh" },
      board: b,
    });
    const r = h.result!;
    expect(r.shows.map((s) => s.seat)).toEqual([1, 2, 0]);
    expect(r.shows.map((s) => s.cards)).toEqual([parseCards("As Ah"), null, null]);
    expect(r.won).toEqual({ 1: 30 });
  });

  it("점점 센 패가 나오면 전부 깜", () => {
    const h = limpedCheckDown({
      stacks: { 0: 1000, 1: 1000, 2: 1000 },
      button: 0,
      holes: { 0: "As Ah", 1: "Qs Qh", 2: "Ks Kh" },
      board: b,
    });
    expect(h.result!.shows.map((s) => s.cards)).toEqual([parseCards("Qs Qh"), parseCards("Ks Kh"), parseCards("As Ah")]);
    expect(h.result!.won).toEqual({ 0: 30 });
  });

  it("앞 패와 비기면 깜 (팟을 나눔), 진 사람만 덮음", () => {
    const h = limpedCheckDown({
      stacks: { 0: 1000, 1: 1000, 2: 1000 },
      button: 0,
      holes: { 0: "7c 2d", 1: "As 2c", 2: "Ad 3c" },
      board: "Ks Kd Qs Qd Jh",
    });
    const r = h.result!;
    expect(r.shows.map((s) => s.seat)).toEqual([1, 2, 0]);
    expect(r.shows.map((s) => s.cards)).toEqual([parseCards("As 2c"), parseCards("Ad 3c"), null]);
    expect(r.won).toEqual({ 1: 15, 2: 15 });
    expectConserved(h);
  });

  /** 3인이 림프, 플랍·턴 체크, 리버에서 steps 대로 */
  function toRiver(holes: Record<number, string>, steps: Step[], turnSteps?: Step[]): Hand {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0, holes, board: b });
    play(h, [
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    h.advance();
    play(h, [
      [1, "check"],
      [2, "check"],
      [0, "check"],
    ]);
    h.advance();
    play(
      h,
      turnSteps ?? [
        [1, "check"],
        [2, "check"],
        [0, "check"],
      ],
    );
    h.advance();
    expect(h.street).toBe(3);
    play(h, steps);
    expect(h.phase).toBe("deal");
    h.advance();
    expect(h.phase).toBe("done");
    return h;
  }

  it("리버에서 마지막으로 벳한 사람부터 깜 (그다음은 시계 방향)", () => {
    // 2번이 QQ 로 벳, 0번 AA 콜, 1번 KK 콜 → 2 → 0 → 1 순서. 1번은 AA 를 못 이겨 덮음
    const h = toRiver({ 0: "As Ah", 1: "Ks Kh", 2: "Qs Qh" }, [
      [1, "check"],
      [2, "raise", 20],
      [0, "call"],
      [1, "call"],
    ]);
    const r = h.result!;
    expect(r.shows.map((s) => s.seat)).toEqual([2, 0, 1]);
    expect(r.shows.map((s) => s.cards)).toEqual([parseCards("Qs Qh"), parseCards("As Ah"), null]);
    expect(r.won).toEqual({ 0: 90 });
    expect(stacksOf(h)).toEqual({ 0: 1060, 1: 970, 2: 970 });
    expectConserved(h);
  });

  it("리버에서 레이즈가 나오면 레이즈한 사람부터", () => {
    // 1번 벳 20, 2번 레이즈 60, 0번 폴드, 1번 콜 → 2 → 1
    const h = toRiver({ 0: "7c 2d", 1: "As Ah", 2: "Ks Kh" }, [
      [1, "raise", 20],
      [2, "raise", 60],
      [0, "fold"],
      [1, "call"],
    ]);
    const r = h.result!;
    expect(r.shows.map((s) => s.seat)).toEqual([2, 1]);
    expect(r.shows.map((s) => s.cards)).toEqual([parseCards("Ks Kh"), parseCards("As Ah")]);
    expect(r.won).toEqual({ 1: 150 });
    expectConserved(h);
  });

  it("벳한 사람이 버튼 왼쪽 첫 자리여도 그 사람부터 (그리고 진 콜러는 덮음)", () => {
    const h = toRiver({ 0: "7c 2d", 1: "As Ah", 2: "Ks Kh" }, [
      [1, "raise", 20],
      [2, "call"],
      [0, "fold"],
    ]);
    const r = h.result!;
    expect(r.shows.map((s) => s.seat)).toEqual([1, 2]);
    expect(r.shows.map((s) => s.cards)).toEqual([parseCards("As Ah"), null]);
  });

  it("턴에 벳이 있었어도 리버가 체크로 돌면 버튼 왼쪽부터", () => {
    const h = toRiver(
      { 0: "As Ah", 1: "Qs Qh", 2: "Ks Kh" },
      [
        [1, "check"],
        [2, "check"],
        [0, "check"],
      ],
      [
        [1, "check"],
        [2, "check"],
        [0, "raise", 20],
        [1, "call"],
        [2, "call"],
      ],
    );
    expect(h.result!.shows.map((s) => s.seat)).toEqual([1, 2, 0]);
    expect(h.result!.shows.map((s) => s.cards)).not.toContain(null);
    expect(h.result!.won).toEqual({ 0: 90 });
  });

  it("올인한 사람이 있으면 진 사람도 전부 깜", () => {
    // 리버: 1번 AA 가 벳, 2번(KK) 콜, 0번은 QQ 로 콜하며 올인 → 원래라면 덮을 2 · 0 도 깜
    const h = mk({
      stacks: { 0: 30, 1: 1000, 2: 1000 },
      button: 0,
      holes: { 0: "Qs Qh", 1: "As Ah", 2: "Ks Kh" },
      board: b,
    });
    play(h, [
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    for (let i = 0; i < 3; i++) {
      h.advance();
      if (i < 2)
        play(h, [
          [1, "check"],
          [2, "check"],
          [0, "check"],
        ]);
    }
    play(h, [
      [1, "raise", 20],
      [2, "call"],
      [0, "call"],
    ]);
    expect(h.player(0)!.allIn).toBe(true);
    h.advance();
    const r = h.result!;
    expect(r.shows).toHaveLength(3);
    expect(r.shows.map((s) => s.cards)).not.toContain(null);
    expect(r.shows[0].seat).toBe(1);
    expect(r.won).toEqual({ 1: 90 });
    expectConserved(h);
  });

  it("7장 중 가장 센 5장으로 겨룸: 보드 플러시 4장 + 손의 한 장", () => {
    const h = limpedCheckDown({
      stacks: { 0: 1000, 1: 1000, 2: 1000 },
      button: 0,
      holes: { 0: "2s 2d", 1: "Kc Kd", 2: "As Ah" },
      board: "3s 8s 9s Js 4d",
    });
    // 0번: 2s 로 J 하이 플러시, 2번: As 로 A 하이 플러시, 1번: KK
    expect(h.result!.won).toEqual({ 2: 30 });
    expect(h.result!.shows.map((s) => s.cards)).toEqual([parseCards("Kc Kd"), parseCards("As Ah"), null]);
    const top = h.result!.shows.find((s) => s.seat === 2)!;
    expect(top.score).toBe(evaluate(parseCards("As Ah 3s 8s 9s Js 4d")));
    expect(categoryOf(top.score)).toBe(CAT.FLUSH);
  });
});

// ───────────── 룰 14: 잘못된 행동 ─────────────

describe("잘못된 행동은 예외, 상태는 그대로 (룰 14)", () => {
  /** 예외가 나고 판이 조금도 바뀌지 않았는지 */
  function expectRejected(h: Hand, fn: () => unknown) {
    const before = JSON.stringify(h);
    expect(fn).toThrow(HandError);
    expect(JSON.stringify(h)).toBe(before);
  }

  it("차례가 아닌 사람 · 없는 자리", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    expectRejected(h, () => h.act(1, "call"));
    expectRejected(h, () => h.act(2, "check"));
    expectRejected(h, () => h.act(1, "fold"));
    expectRejected(h, () => h.act(7, "fold"));
    expectRejected(h, () => h.act(-1, "fold"));
    expect(h.toAct).toBe(0);
  });

  it("벳을 받았는데 체크 · 낼 게 없는데 콜", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    expectRejected(h, () => h.act(0, "check"));
    h.act(0, "call");
    expectRejected(h, () => h.act(1, "check"));
    h.act(1, "call");
    expectRejected(h, () => h.act(2, "call"));
    h.act(2, "check");
    h.advance();
    expectRejected(h, () => h.act(1, "call"));
    h.act(1, "raise", 10);
    expectRejected(h, () => h.act(2, "check"));
  });

  it("레이즈 금액: 최소 미만 · 스택 초과 · 콜 금액 이하 · 정수가 아님 · 단위", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0, unit: 5 });
    expectRejected(h, () => h.act(0, "raise", 15));
    expectRejected(h, () => h.act(0, "raise", 10));
    expectRejected(h, () => h.act(0, "raise", 5));
    expectRejected(h, () => h.act(0, "raise", 0));
    expectRejected(h, () => h.act(0, "raise", -20));
    expectRejected(h, () => h.act(0, "raise", 1001));
    expectRejected(h, () => h.act(0, "raise", 1005));
    expectRejected(h, () => h.act(0, "raise", 22));
    expectRejected(h, () => h.act(0, "raise", 20.5));
    expectRejected(h, () => h.act(0, "raise", NaN));
    expectRejected(h, () => h.act(0, "raise", Infinity));
    expectRejected(h, () => h.act(0, "raise"));
    expectRejected(h, () => h.act(0, "bet" as ActType, 20));
    h.act(0, "raise", 1000);
    expect(h.player(0)).toMatchObject({ stack: 0, allIn: true });
  });

  it("canRaise 가 false 면 레이즈 불가 (못 미치는 올인 뒤 · 상대가 전부 올인 · 콜도 벅찰 때)", () => {
    // 콜도 벅참
    const a = mk({ stacks: { 0: 8, 1: 1000, 2: 1000 }, button: 0 });
    expect(a.legal(0).canRaise).toBe(false);
    expectRejected(a, () => a.act(0, "raise", 8));
    // 상대가 전부 올인
    const c = mk({ stacks: { 0: 1000, 1: 1000 }, button: 0 });
    c.act(0, "raise", 1000);
    expect(c.legal(1).canRaise).toBe(false);
    expectRejected(c, () => c.act(1, "raise", 1000));
    expectRejected(c, () => c.act(1, "check"));
  });

  it("끝난 판 · 카드 까는 중에는 행동 불가, 베팅 중에는 advance 불가", () => {
    const h = mk({ stacks: { 0: 1000, 1: 1000 }, button: 0 });
    expectRejected(h, () => h.advance());
    play(h, [
      [0, "call"],
      [1, "check"],
    ]);
    expect(h.phase).toBe("deal");
    expectRejected(h, () => h.act(1, "check"));
    expectRejected(h, () => h.act(0, "fold"));
    h.advance();
    h.act(1, "raise", 10);
    h.act(0, "fold");
    expect(h.phase).toBe("done");
    for (const s of [0, 1]) {
      expectRejected(h, () => h.act(s, "check"));
      expectRejected(h, () => h.act(s, "fold"));
      expectRejected(h, () => h.act(s, "call"));
      expectRejected(h, () => h.act(s, "raise", 20));
    }
    expectRejected(h, () => h.advance());
  });

  it("판을 시작할 수 없는 경우", () => {
    const deck = shuffledDeck((n) => n - 1);
    expect(() => new Hand({ seats: [{ seat: 0, stack: 100 }], button: 0, sb: 5, bb: 10, deck })).toThrow(HandError);
    expect(
      () =>
        new Hand({
          seats: [
            { seat: 0, stack: 100 },
            { seat: 1, stack: 0 },
          ],
          button: 0,
          sb: 5,
          bb: 10,
          deck,
        }),
    ).toThrow(HandError);
    expect(
      () =>
        new Hand({
          seats: [
            { seat: 0, stack: 100 },
            { seat: 1, stack: 100 },
          ],
          button: 5,
          sb: 5,
          bb: 10,
          deck,
        }),
    ).toThrow(HandError);
  });

  it("넘겨준 덱 배열은 건드리지 않음", () => {
    const deck = shuffledDeck((n) => n - 1);
    const copy = deck.slice();
    const h = new Hand({
      seats: [
        { seat: 0, stack: 100 },
        { seat: 1, stack: 100 },
      ],
      button: 0,
      sb: 5,
      bb: 10,
      deck,
    });
    play(h, [
      [0, "call"],
      [1, "check"],
    ]);
    runOutChecking(h);
    expect(deck).toEqual(copy);
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
  /** 마지막으로 행동했을 때의 콜 금액 */
  at: number;
}
interface RefLegal {
  toCall: number;
  canCheck: boolean;
  canRaise: boolean;
  minTo: number;
  maxTo: number;
}

class Ref {
  ps: RP[];
  street = 0;
  curBet: number;
  lastFull: number;
  /** 이번 라운드에 마지막으로 벳·레이즈한 자리 */
  aggressor = -1;
  toAct = -1;
  /** 한 명 빼고 다 죽음 */
  over = false;
  /** 못 미치는 올인이 나온 횟수 · 돌려준 횟수 (퍼즈가 그 경우를 지나갔는지 확인용) */
  shortAllIns = 0;
  returns = 0;

  constructor(
    seats: { seat: number; stack: number }[],
    readonly button: number,
    readonly sb: number,
    readonly bb: number,
    readonly unit: number,
  ) {
    this.ps = [...seats]
      .sort((a, b) => a.seat - b.seat)
      .map((s) => ({ seat: s.seat, start: s.stack, stack: s.stack, bet: 0, inv: 0, folded: false, allIn: false, acted: false, at: 0 }));
    const order = dealOrder(
      seats.map((s) => s.seat),
      button,
    );
    this.pay(this.p(order[0]), sb);
    this.pay(this.p(order[1]), bb);
    this.curBet = bb;
    this.lastFull = bb;
    this.toAct = this.nextFrom(order[1]);
    if (this.toAct < 0) this.returnUncalled();
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
  /** seat 다음부터 시계 방향으로 한 바퀴 (seat 자신이 맨 끝) */
  clockwise(seat: number): RP[] {
    const i = this.ps.findIndex((x) => x.seat === seat);
    return [...this.ps.slice(i + 1), ...this.ps.slice(0, i + 1)];
  }
  private pay(p: RP, amount: number) {
    const a = Math.min(amount, p.stack);
    p.stack -= a;
    p.bet += a;
    p.inv += a;
    if (p.stack === 0) p.allIn = true;
  }
  private othersAble(p: RP): boolean {
    return this.able.some((x) => x !== p);
  }
  /** 룰 2 · 9 */
  owes(p: RP): number {
    if (this.othersAble(p)) return Math.max(0, this.curBet - p.bet);
    const top = Math.max(0, ...this.live.filter((x) => x !== p).map((x) => x.bet));
    return Math.max(0, top - p.bet);
  }
  legal(seat: number): RefLegal {
    const p = this.p(seat);
    const owes = this.owes(p);
    const maxTo = p.bet + p.stack;
    // 룰 4
    const reopened = !p.acted || this.curBet - p.at >= this.lastFull;
    const canRaise = reopened && this.othersAble(p) && maxTo > this.curBet;
    // 룰 3: 올인이 아니면 단위의 배수
    const min = Math.ceil((this.curBet + this.lastFull) / this.unit) * this.unit;
    return { toCall: Math.min(p.stack, owes), canCheck: owes === 0, canRaise, minTo: Math.min(maxTo, min), maxTo };
  }
  /** 룰 8: 혼자 남아 맞출 것도 없으면 행동할 일이 없음 */
  private nextFrom(seat: number): number {
    for (const p of this.clockwise(seat)) {
      if (p.folded || p.allIn) continue;
      if (this.owes(p) > 0 || (!p.acted && this.othersAble(p))) return p.seat;
    }
    return -1;
  }
  /** 룰 6 */
  private returnUncalled() {
    const sorted = [...this.ps].sort((a, b) => b.inv - a.inv);
    const [top, second] = sorted;
    const extra = top.inv - second.inv;
    if (extra <= 0 || top.folded) return;
    top.inv -= extra;
    top.bet -= extra;
    top.stack += extra;
    top.allIn = false;
    this.returns++;
  }
  act(seat: number, type: ActType, amount = 0) {
    const p = this.p(seat);
    if (type === "fold") p.folded = true;
    else if (type === "call") this.pay(p, this.legal(seat).toCall);
    else if (type === "raise") {
      const inc = amount - this.curBet;
      this.pay(p, amount - p.bet);
      if (inc >= this.lastFull) this.lastFull = inc;
      else this.shortAllIns++;
      this.curBet = amount;
      this.aggressor = seat;
    }
    p.acted = true;
    p.at = this.curBet;
    if (this.live.length === 1) {
      this.over = true;
      this.toAct = -1;
      this.returnUncalled();
      return;
    }
    this.toAct = this.nextFrom(seat);
    if (this.toAct < 0) this.returnUncalled();
  }
  nextStreet() {
    this.street++;
    for (const p of this.ps) {
      p.bet = 0;
      p.acted = false;
      p.at = 0;
    }
    this.curBet = 0;
    this.lastFull = this.bb;
    this.aggressor = -1;
    this.toAct = this.able.length >= 2 ? this.nextFrom(this.button) : -1;
  }

  /** 룰 7: 팟 나누기 (모든 사람이 낸 금액 단계별로 자른 뒤 자격이 같은 것끼리 합침) */
  pots(): { amount: number; seats: number[] }[] {
    const levels = [...new Set(this.ps.map((p) => p.inv))].filter((v) => v > 0).sort((a, b) => a - b);
    const out: { amount: number; seats: number[] }[] = [];
    let prev = 0;
    for (const lv of levels) {
      const amount = sum(this.ps.map((p) => Math.max(0, Math.min(p.inv, lv) - prev)));
      const seats = this.live.filter((p) => p.inv >= lv).map((p) => p.seat);
      const last = out[out.length - 1];
      if (last && (seats.length === 0 || last.seats.join() === seats.join())) last.amount += amount;
      else out.push({ amount, seats });
      prev = lv;
    }
    return out;
  }

  /** 룰 10 · 12: 쇼다운 정산 */
  settle(holes: Map<number, Card[]>, board: Card[]) {
    const fromButton = this.clockwise(this.button);
    const score = new Map<number, number>();
    for (const p of this.live) score.set(p.seat, refScore([...holes.get(p.seat)!, ...board]));
    const won: Record<number, number> = {};
    const pots = this.pots().map((pot) => {
      const best = Math.max(...pot.seats.map((s) => score.get(s)!));
      const winners = pot.seats.filter((s) => score.get(s) === best);
      // 단위 배수로 똑같이, 남는 칩은 버튼 왼쪽 승자부터 하나씩.
      // 팟이 단위에 안 맞으면(단위보다 작은 올인이 낀 경우) 1 단위로 나눔 — 비긴 사람이 손해 보지 않게
      const order = fromButton.filter((p) => winners.includes(p.seat)).map((p) => p.seat);
      const unit = pot.amount % this.unit === 0 ? this.unit : 1;
      const each = Math.floor(pot.amount / (order.length * unit)) * unit;
      let rest = pot.amount - each * order.length;
      const share = order.map(() => each);
      for (let i = 0; rest >= unit; i++) {
        share[i] += unit;
        rest -= unit;
      }
      order.forEach((s, i) => (won[s] = (won[s] ?? 0) + share[i]));
      return { ...pot, winners };
    });
    // 까는 순서와 머크
    let order = fromButton.filter((p) => !p.folded);
    const ai = order.findIndex((p) => p.seat === this.aggressor);
    if (this.street === 3 && ai > 0) order = [...order.slice(ai), ...order.slice(0, ai)];
    const showAll = this.live.some((p) => p.allIn);
    let bestShown = -1;
    const shows = order.map((p, i) => {
      const s = score.get(p.seat)!;
      const show = showAll || i === 0 || s >= bestShown || (won[p.seat] ?? 0) > 0;
      if (show) bestShown = Math.max(bestShown, s);
      return { seat: p.seat, shown: show };
    });
    return { pots, won, shows, showAll, score };
  }
}

// ───────────── 퍼즈 ─────────────

interface FuzzCfg {
  name: string;
  seed: number;
  hands: number;
  unit: number;
  /** [sb, bb] 후보 */
  blinds: [number, number][];
  /** 스택을 단위의 배수로만 */
  unitStacks: boolean;
  /** 블라인드 이하의 스택이 나올 확률 (기본 0.2) · 10BB 이하 (기본 0.3) */
  tiny?: number;
  short?: number;
  /** 레이즈할 때 올인으로 갈 확률 (기본 0.2) · 금액을 작은 쪽으로 치우치게 하는 지수 (기본 3) */
  shove?: number;
  skew?: number;
}

interface FuzzOut {
  /** 분류 → 어긴 사례 (재현 정보 포함, 분류마다 앞의 몇 개만) */
  v: Map<string, string[]>;
  count: Map<string, number>;
  stats: Record<string, number>;
}

/** 판을 통째로 복사 (되는 행동을 원래 판을 건드리지 않고 해 보려고) */
const cloneHand = (h: Hand): Hand => Object.assign(Object.create(Hand.prototype) as Hand, structuredClone({ ...h }));

function fuzz(cfg: FuzzCfg): FuzzOut {
  const rng = mulberry32(cfg.seed);
  const ri = (n: number) => Math.floor(rng() * n);
  const v = new Map<string, string[]>();
  const count = new Map<string, number>();
  const stats: Record<string, number> = {
    hands: 0,
    showdown: 0,
    foldEnd: 0,
    sidePots: 0,
    split: 0,
    runout: 0,
    muck: 0,
    shortAllIn: 0,
    shortBlind: 0,
    returned: 0,
    actions: 0,
    reopenBlocked: 0,
    lone: 0,
    tieZero: 0,
    riverBet: 0,
    plainShowdown: 0,
    riverAggressorFirst: 0,
  };

  for (let n = 0; n < cfg.hands; n++) {
    // ── 판 만들기
    const np = 2 + ri(5);
    const allSeats = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = allSeats.length - 1; i > 0; i--) {
      const j = ri(i + 1);
      [allSeats[i], allSeats[j]] = [allSeats[j], allSeats[i]];
    }
    const [sb, bb] = cfg.blinds[ri(cfg.blinds.length)];
    const u = cfg.unit;
    const seats = allSeats.slice(0, np).map((seat) => {
      const k = rng();
      let stack: number;
      const tiny = cfg.tiny ?? 0.2;
      if (k < tiny) stack = 1 + ri(bb); // 블라인드보다 적거나 같음
      else if (k < tiny + (cfg.short ?? 0.3)) stack = bb + 1 + ri(bb * 9);
      else if (k < 0.9) stack = bb * 10 + ri(bb * 190);
      else stack = bb * (20 + ri(4)); // 같은 스택이 자주 나오게
      if (cfg.unitStacks) stack = Math.max(u, Math.round(stack / u) * u);
      return { seat, stack };
    });
    const button = seats[ri(np)].seat;
    const deck = shuffledDeck(ri);
    const log: string[] = [];
    const where = () =>
      `[${cfg.name} #${n}] seats=${JSON.stringify(seats.map((s) => [s.seat, s.stack]))} btn=${button} sb=${sb} bb=${bb} unit=${u} acts=[${log.join(" ")}]`;
    const viol = (cat: string, msg: string) => {
      count.set(cat, (count.get(cat) ?? 0) + 1);
      const list = v.get(cat) ?? [];
      if (list.length < 3) list.push(`${msg}  ${where()}`);
      v.set(cat, list);
    };

    let h: Hand;
    try {
      h = new Hand({ seats, button, sb, bb, unit: u, deck });
    } catch (e) {
      viol("stuck", `생성 중 예외: ${e}`);
      continue;
    }
    const ref = new Ref(seats, button, sb, bb, u);
    stats.hands++;
    if (ref.ps.some((p) => p.allIn)) stats.shortBlind++;
    const total = sum(seats.map((s) => s.stack));

    // 카드가 스펙대로 나갔는지 (SB 부터 한 장씩 두 바퀴)
    const order = dealOrder(
      seats.map((s) => s.seat),
      button,
    );
    const holes = new Map<number, Card[]>();
    order.forEach((s, i) => holes.set(s, [deck[51 - i], deck[51 - np - i]]));
    for (const p of h.players) if (p.cards.join() !== holes.get(p.seat)!.join()) viol("deal", `자리 ${p.seat} 의 패가 다름`);
    const expBoard = [1, 2, 3, 5, 7].map((k) => deck[51 - (2 * np + k)]);

    /** 엔진 상태가 기준 구현과 같은지. 다르면 false (이 판은 더 못 따라감) */
    const sameState = (): boolean => {
      const phase = ref.over ? "done" : ref.toAct >= 0 ? "bet" : "deal";
      if (h.phase !== phase && !(h.phase === "done" && ref.over)) {
        viol("state", `phase ${h.phase} (기대 ${phase})`);
        return false;
      }
      if (h.toAct !== ref.toAct) {
        viol("state", `toAct ${h.toAct} (기대 ${ref.toAct})`);
        return false;
      }
      if (h.phase === "bet" && h.toAct < 0) {
        viol("stuck", "bet 인데 toAct 가 −1");
        return false;
      }
      for (const p of h.players) {
        const q = ref.p(p.seat);
        if (p.stack < 0 || p.bet < 0 || p.invested < 0) viol("conservation", `자리 ${p.seat} 음수`);
        if (h.phase === "done") continue; // 끝난 뒤의 스택은 정산에서 따로 봄
        if (p.stack !== q.stack || p.bet !== q.bet || p.invested !== q.inv || p.folded !== q.folded || p.allIn !== q.allIn) {
          viol(
            "state",
            `자리 ${p.seat}: stack ${p.stack}/${q.stack} bet ${p.bet}/${q.bet} inv ${p.invested}/${q.inv} folded ${p.folded}/${q.folded} allIn ${p.allIn}/${q.allIn} (엔진/기대)`,
          );
          return false;
        }
      }
      if (h.phase !== "done") {
        if (sum(h.players.map((p) => p.stack)) + h.pot !== total) viol("conservation", "스택 + 팟 ≠ 처음 칩 합계");
        const ps = h.pots();
        if (sum(ps.map((p) => p.amount)) !== h.pot) viol("pots", `pots() 합 ${sum(ps.map((p) => p.amount))} ≠ pot ${h.pot}`);
        for (const pot of ps) if (pot.seats.some((s) => ref.p(s).folded)) viol("pots", "죽은 사람이 팟 자격에 있음");
        if (h.phase === "deal" && JSON.stringify(ps) !== JSON.stringify(ref.pots()))
          viol("pots", `pots() ${JSON.stringify(ps)} (기대 ${JSON.stringify(ref.pots())})`);
      }
      if (h.phase === "deal" && h.street < 3) {
        const exp = ref.able.length < 2;
        if (h.runout !== exp) viol("runout", `street ${h.street}: runout ${h.runout} (기대 ${exp})`);
      }
      return true;
    };

    const rejected = (what: string, fn: () => unknown) => {
      const before = JSON.stringify(h);
      let threw = false;
      try {
        fn();
      } catch (e) {
        threw = e instanceof HandError;
        if (!threw) viol("illegal", `${what}: HandError 가 아닌 예외 ${e}`);
      }
      if (!threw) viol("illegal", `${what}: 예외가 안 남`);
      if (JSON.stringify(h) !== before) viol("illegal", `${what}: 상태가 바뀜`);
      return threw;
    };
    const accepted = (what: string, type: ActType, amount?: number) => {
      try {
        cloneHand(h).act(h.toAct, type, amount);
      } catch (e) {
        viol("legal-throws", `${what}: 되는 행동인데 예외 ${e}`);
      }
    };

    let ok = sameState();
    let steps = 0;
    let ranOut = false;
    /** 리버에서 베팅 라운드가 실제로 열렸는지 */
    let riverBetting = false;
    while (ok && h.phase !== "done") {
      if (++steps > 400) {
        viol("stuck", "400 걸음 안에 끝나지 않음");
        ok = false;
        break;
      }
      if (h.phase === "deal") {
        if (steps % 3 === 0) rejected("카드 까는 중 행동", () => h.act(seats[ri(np)].seat, "fold"));
        const street = h.street;
        let dealt: Card[];
        try {
          dealt = h.advance();
        } catch (e) {
          viol("stuck", `advance 예외: ${e}`);
          ok = false;
          break;
        }
        log.push("/");
        // (advance 가 phase 를 바꾸지만 TS 는 위에서 좁힌 "deal" 로 기억함)
        const phaseNow = h.phase as string;
        if (street === 3) {
          if (phaseNow !== "done") {
            viol("state", "리버 뒤 advance 인데 안 끝남");
            ok = false;
          }
          break;
        }
        if (phaseNow === "done") {
          viol("state", `street ${street} 에서 끝남`);
          ok = false;
          break;
        }
        ref.nextStreet();
        if (ref.toAct < 0) ranOut = true;
        else if (ref.street === 3) riverBetting = true;
        const exp = street === 0 ? expBoard.slice(0, 3) : [expBoard[street + 2]];
        if (dealt.join() !== exp.join()) viol("deal", `street ${street + 1} 카드 ${dealt} (기대 ${exp})`);
        ok = sameState();
        continue;
      }

      // ── 베팅
      const seat = h.toAct;
      const me = h.player(seat);
      if (!me || me.folded || me.allIn) {
        viol("stuck", `toAct ${seat} 가 행동할 수 없는 자리`);
        ok = false;
        break;
      }
      const lg = h.legal(seat);
      const rl = ref.legal(seat);
      // legal() 자체의 앞뒤
      if (lg.minTo > lg.maxTo) viol("legal-self", `minTo ${lg.minTo} > maxTo ${lg.maxTo}`);
      if (lg.toCall > me.stack || lg.toCall < 0) viol("legal-self", `toCall ${lg.toCall} > stack ${me.stack}`);
      if (lg.canCheck === lg.toCall > 0) viol("legal-self", `체크·콜 중 정확히 하나여야: canCheck ${lg.canCheck} toCall ${lg.toCall}`);
      if (lg.maxTo !== me.bet + me.stack) viol("legal-self", `maxTo ${lg.maxTo} ≠ bet + stack`);
      // 스펙 기준과 비교
      if (lg.toCall !== rl.toCall || lg.canCheck !== rl.canCheck)
        viol("legal-ref", `자리 ${seat}: toCall ${lg.toCall}/${rl.toCall} canCheck ${lg.canCheck}/${rl.canCheck} (엔진/기대)`);
      if (lg.canRaise !== rl.canRaise) viol("legal-ref", `자리 ${seat}: canRaise ${lg.canRaise} (기대 ${rl.canRaise})`);
      if (lg.canRaise && rl.canRaise && lg.minTo !== rl.minTo)
        viol("minTo", `자리 ${seat}: minTo ${lg.minTo} (단위 ${u} 에 맞는 최소는 ${rl.minTo}, maxTo ${lg.maxTo})`);
      if (!rl.canRaise && ref.p(seat).acted && rl.maxTo > ref.curBet && ref.able.length > 1) stats.reopenBlocked++;
      if (ref.able.length === 1) stats.lone++;

      // 안 되는 행동: 예외 + 상태 그대로
      const other = h.players.find((p) => p.seat !== seat)!.seat;
      rejected("차례 아닌 사람", () => h.act(other, "fold"));
      rejected("베팅 중 advance", () => h.advance());
      if (lg.canCheck) rejected("낼 게 없는데 콜", () => h.act(seat, "call"));
      else rejected("벳을 받았는데 체크", () => h.act(seat, "check"));
      rejected("스택보다 많이", () => h.act(seat, "raise", lg.maxTo + 1));
      if (lg.canRaise) {
        rejected(`최소 미만(minTo − 단위 = ${lg.minTo - u})`, () => h.act(seat, "raise", lg.minTo - u));
        if (rl.minTo - 1 !== lg.minTo - u) rejected(`최소 미만(${rl.minTo - 1})`, () => h.act(seat, "raise", rl.minTo - 1));
        if (u > 1 && rl.minTo + 1 < lg.maxTo) rejected(`단위에 안 맞음(${rl.minTo + 1})`, () => h.act(seat, "raise", rl.minTo + 1));
        rejected("콜 금액으로 레이즈", () => h.act(seat, "raise", h.currentBet));
      } else {
        rejected("canRaise false 인데 올인 레이즈", () => h.act(seat, "raise", lg.maxTo));
        rejected("canRaise false 인데 최소 레이즈", () => h.act(seat, "raise", ref.curBet + ref.lastFull));
      }
      // 되는 행동: 복사본에서 전부 해 봄
      accepted("폴드", "fold");
      accepted(lg.canCheck ? "체크" : "콜", lg.canCheck ? "check" : "call");
      if (lg.canRaise) {
        accepted(`올인 ${lg.maxTo}`, "raise", lg.maxTo);
        accepted(`legal().minTo ${lg.minTo}`, "raise", lg.minTo);
      }

      // ── 무작위로 하나 고름 (엔진의 legal 기준. 단, 금액은 단위에 맞춤)
      let type: ActType;
      let amount = 0;
      const k = rng();
      const canRaise = lg.canRaise && rl.canRaise;
      if (k < (lg.canCheck ? 0.03 : 0.22)) type = "fold";
      else if (k < (canRaise ? 0.6 : 2)) type = lg.canCheck ? "check" : "call";
      else {
        type = "raise";
        const m = rng();
        if (m < 0.3) amount = rl.minTo;
        else if (m < 0.3 + (cfg.shove ?? 0.2)) amount = lg.maxTo;
        else {
          // 작은 금액 쪽으로 치우치게
          const span = lg.maxTo - rl.minTo;
          amount = rl.minTo + Math.floor((rng() ** (cfg.skew ?? 3) * span) / u) * u;
          amount = Math.floor(amount / u) * u;
          if (amount < rl.minTo) amount = rl.minTo;
          if (amount > lg.maxTo) amount = lg.maxTo;
        }
      }
      log.push(`${seat}${type === "raise" ? `r${amount}` : type[0]}`);
      const bet0 = me.bet;
      const stack0 = me.stack;
      let item;
      try {
        item = h.act(seat, type, amount);
      } catch (e) {
        viol("legal-throws", `되는 행동인데 예외: ${e}`);
        ok = false;
        break;
      }
      stats.actions++;
      ref.act(seat, type, amount);
      // 돌려준 기록
      const expAdd = type === "raise" ? amount - bet0 : type === "call" ? rl.toCall : 0;
      if (item.add !== expAdd || item.to !== bet0 + expAdd || item.seat !== seat || item.type !== type)
        viol("state", `기록이 다름: add ${item.add} (기대 ${expAdd}) to ${item.to}`);
      if (item.allIn !== (expAdd === stack0 && type !== "fold" && type !== "check")) viol("state", `기록의 allIn ${item.allIn}`);
      ok = sameState();
    }
    if (!ok) continue;

    // ── 끝: 따로 계산한 정산과 비교
    const r = h.result;
    if (!r) {
      viol("stuck", "done 인데 result 가 없음");
      continue;
    }
    if (h.toAct !== -1) viol("state", "끝났는데 toAct 가 남음");
    if (sum(h.players.map((p) => p.stack)) !== total) viol("conservation", `끝난 뒤 칩 합계 ${sum(h.players.map((p) => p.stack))} ≠ ${total}`);
    if (sum(Object.values(r.delta)) !== 0) viol("conservation", "delta 합 ≠ 0");
    for (const p of h.players) {
      if (p.stack < 0) viol("conservation", `자리 ${p.seat} 스택 음수`);
      if (r.delta[p.seat] !== p.stack - p.start) viol("conservation", `delta[${p.seat}] ≠ 끝 − 시작`);
    }
    if (sum(Object.values(r.won)) !== sum(r.pots.map((p) => p.amount))) viol("conservation", "won 합 ≠ 팟 합");
    for (const pot of r.pots) {
      if (pot.seats.some((s) => ref.p(s).folded)) viol("pots", "죽은 사람이 팟 자격에 있음");
      if (pot.winners.length === 0 || pot.winners.some((s) => !pot.seats.includes(s))) viol("pots", "승자가 자격자 밖에 있음");
    }
    for (const s of Object.keys(r.won)) if (ref.p(Number(s)).folded) viol("payout", `죽은 자리 ${s} 가 돈을 받음`);
    if (ref.returns > 0) stats.returned++;

    const potTotal = sum(ref.ps.map((p) => p.inv));
    const expStack = new Map<number, number>();
    if (ref.over) {
      // 룰 6 · 11
      stats.foldEnd++;
      const w = ref.live[0];
      if (r.showdown !== false || r.shows.length !== 0) viol("shows", "폴드로 끝났는데 쇼다운");
      if (JSON.stringify(r.won) !== JSON.stringify({ [w.seat]: potTotal })) viol("payout", `폴드 승: won ${JSON.stringify(r.won)} (기대 {${w.seat}: ${potTotal}})`);
      if (JSON.stringify(r.pots) !== JSON.stringify([{ amount: potTotal, seats: [w.seat], winners: [w.seat] }]))
        viol("pots", `폴드 승: pots ${JSON.stringify(r.pots)}`);
      for (const p of ref.ps) expStack.set(p.seat, p.stack + (p === w ? potTotal : 0));
    } else {
      stats.showdown++;
      if (ranOut) stats.runout++;
      if (r.showdown !== true) viol("shows", "쇼다운인데 showdown 이 false");
      if (r.board.length !== 5 || r.board.join() !== expBoard.join()) viol("deal", `보드 ${r.board} (기대 ${expBoard})`);
      const exp = ref.settle(holes, r.board);
      if (exp.pots.length > 1) stats.sidePots++;
      if (exp.pots.some((p) => p.winners.length > 1)) stats.split++;
      const norm = (ps: { amount: number; seats: number[]; winners: number[] }[]) =>
        JSON.stringify(ps.map((p) => [p.amount, [...p.seats].sort((a, b) => a - b), [...p.winners].sort((a, b) => a - b)]));
      if (norm(r.pots) !== norm(exp.pots)) viol("pots", `pots ${norm(r.pots)} (기대 ${norm(exp.pots)})`);
      for (const p of ref.ps) {
        const got = r.won[p.seat] ?? 0;
        const want = exp.won[p.seat] ?? 0;
        if (got !== want) viol("payout", `won[${p.seat}] ${got} (기대 ${want})`);
        expStack.set(p.seat, p.stack + want);
      }
      if (Object.values(r.won).some((x) => x < 0)) viol("payout", "won 에 음수가 있음");
      // 비겼는데 0 을 받는 경우 (팟이 단위보다 작을 때 — 스펙 문구대로면 가능. 보고서의 "모호한 점" 참고)
      if (exp.pots.some((p) => p.winners.some((s) => (r.won[s] ?? 0) === 0))) stats.tieZero++;
      // 까는 순서 · 머크
      const liveSeats = ref.live.map((p) => p.seat);
      if (r.shows.length !== liveSeats.length || liveSeats.some((s) => !r.shows.some((x) => x.seat === s)))
        viol("shows", `shows 의 자리 ${r.shows.map((s) => s.seat)} (살아 있는 자리 ${liveSeats})`);
      else {
        for (const s of r.shows) {
          if (s.cards && s.cards.join() !== holes.get(s.seat)!.join()) viol("shows", `자리 ${s.seat} 가 깐 카드가 다름`);
          if (s.score !== evaluate([...holes.get(s.seat)!, ...r.board])) viol("shows", `자리 ${s.seat} 의 score 가 다름`);
        }
        if (exp.showAll) {
          if (r.shows.some((s) => s.cards === null)) viol("shows", "올인 판인데 덮은 사람이 있음");
          // 리버 베팅이 없던 런아웃은 "마지막 베팅 라운드" 가 어느 쪽인지 모호 → 순서는 리버 베팅이 있었을 때만
          const got = r.shows.map((s) => s.seat).join(" ");
          const want = exp.shows.map((s) => s.seat).join(" ");
          if (riverBetting && got !== want) viol("shows", `까는 순서 ${got} (기대 ${want})`);
          if (riverBetting && ref.aggressor >= 0) stats.riverBet++;
        } else {
          const got = r.shows.map((s) => `${s.seat}${s.cards ? "+" : "-"}`).join(" ");
          const want = exp.shows.map((s) => `${s.seat}${s.shown ? "+" : "-"}`).join(" ");
          if (got !== want) viol("shows", `까는 순서·머크 ${got} (기대 ${want})`);
          if (exp.shows.some((s) => !s.shown)) stats.muck++;
          stats.plainShowdown++;
          if (ref.aggressor >= 0 && exp.shows[0].seat !== ref.clockwise(button).find((p) => !p.folded)!.seat) stats.riverAggressorFirst++;
        }
      }
    }
    for (const p of h.players) if (p.stack !== expStack.get(p.seat)) viol("payout", `자리 ${p.seat} 끝 스택 ${p.stack} (기대 ${expStack.get(p.seat)})`);
    stats.shortAllIn += ref.shortAllIns;
  }
  return { v, count, stats };
}

const FUZZ_CATS: [cat: string, title: string][] = [
  ["stuck", "모든 판이 끝남 (멈춤·무한 반복 없음, toAct 는 행동할 수 있는 자리)"],
  ["deal", "카드가 스펙 순서대로 나감"],
  ["legal-self", "legal() 의 앞뒤가 맞음"],
  ["legal-ref", "legal() 의 toCall · canCheck · canRaise 가 스펙과 같음"],
  ["minTo", "legal().minTo 가 실제 최소 레이즈와 같음"],
  ["illegal", "안 되는 행동은 예외를 내고 상태를 안 바꿈"],
  ["legal-throws", "되는 행동은 예외 없이 됨"],
  ["state", "행동 순서 · 스택 · 벳이 스펙과 같음"],
  ["runout", "runout 표시"],
  ["conservation", "칩 보존 · delta 합 0 · won 합 = 팟 합"],
  ["pots", "팟 구성 · 자격 · 승자"],
  ["payout", "정산이 따로 계산한 값과 같음"],
  ["shows", "까는 순서 · 머크"],
];

const FUZZ_TIMEOUT = 180_000;

function fuzzSuite(cfg: FuzzCfg, minimums: Record<string, number>) {
  describe(`퍼즈: ${cfg.name} (${cfg.hands}판)`, () => {
    let out: FuzzOut | null = null;
    const run = () => (out ??= fuzz(cfg));
    for (const [cat, title] of FUZZ_CATS) {
      it(title, () => {
        const o = run();
        const n = o.count.get(cat) ?? 0;
        expect(o.v.get(cat) ?? [], `${n}건`).toEqual([]);
      }, FUZZ_TIMEOUT);
    }
    it("퍼즈가 여러 경우를 실제로 지나감", () => {
      const o = run();
      if (process.env.HOLDEM_FUZZ_STATS) console.log(cfg.name, o.stats);
      for (const [k, min] of Object.entries(minimums)) expect(o.stats[k], k).toBeGreaterThanOrEqual(min);
    }, FUZZ_TIMEOUT);
  });
}

const wide = { showdown: 300, foldEnd: 300, sidePots: 100, split: 5, runout: 100, muck: 20, shortAllIn: 50, shortBlind: 100, returned: 300, reopenBlocked: 20, lone: 100 };

// 단위 1, 아무 스택
fuzzSuite({ name: "단위 1", seed: 1, hands: 4000, unit: 1, blinds: [[5, 10], [1, 2], [50, 100], [10, 10]], unitStacks: false }, wide);
// 깊은 스택 위주: 여러 라운드 베팅 · 올인 없는 쇼다운 · 머크 · 리버 벳한 사람부터 까기
fuzzSuite(
  { name: "단위 1 · 깊은 스택", seed: 4, hands: 3000, unit: 1, blinds: [[5, 10]], unitStacks: false, tiny: 0.02, short: 0.08, shove: 0.02, skew: 8 },
  { showdown: 500, foldEnd: 500, plainShowdown: 300, muck: 150, riverAggressorFirst: 30, reopenBlocked: 5, split: 5 },
);
// 단위 10, 스택도 단위의 배수
fuzzSuite({ name: "단위 10 · 스택도 배수", seed: 2, hands: 2000, unit: 10, blinds: [[10, 20], [50, 100]], unitStacks: true }, { showdown: 100, foldEnd: 100, sidePots: 30 });
// 단위 5, 스택은 아무 값 (올인 금액이 단위에 안 맞을 수 있음)
fuzzSuite({ name: "단위 5 · 스택은 아무 값", seed: 3, hands: 2000, unit: 5, blinds: [[5, 10], [25, 50]], unitStacks: false }, { showdown: 100, foldEnd: 100, sidePots: 30 });

