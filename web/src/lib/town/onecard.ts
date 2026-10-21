/*
 * 원카드 규칙 (서버 · 화면이 같이 씀) — 상태를 바꾸는 순수 함수 모음.
 *  서버(server/src/games/town.ts)가 이 함수로 판을 진행하고, 화면은 서버가 보내 준 상태 · 사건(이벤트)을 그림.
 *
 * 규칙
 *  - 2~4명, 7장씩. 바닥 카드와 무늬나 숫자가 같으면 냄. 조커는 아무 때나.
 *  - 공격: 2 = +2 · A = +3 · 조커 = +5. 공격 중엔 같은 숫자나 같은 무늬의 더 센 공격, 조커로만 받아침 → 못 받으면 쌓인 만큼 받음
 *  - 7 무늬 바꾸기 · J 다음 사람 건너뛰기 · Q 방향 반대 · K 한 장 더
 *  - 1장 남으면 「원카드!」 외치기 — 외치기 전에 남이 먼저 누르면 잡혀서 +1장, 아무도 안 누르고 시간이 지나도 +1장
 *  - 20장이 되면 파산 (판에서 빠짐). 한 명이 다 털면 끝, 나머지는 남은 장 수 순
 */

export interface Card {
  id: number;
  /** 2~14 (11 J · 12 Q · 13 K · 14 A), 조커는 99 */
  r: number;
  /** 0 ♠ · 1 ♥ · 2 ♦ · 3 ♣, 조커는 -1 */
  s: number;
  jk?: boolean;
}

export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export const HAND_SIZE = 7;
export const BUST = 20;
/** 내 차례 제한 시간 */
export const TURN_MS = 15_000;
/** 원카드 외칠 시간 */
export const ONE_MS = 2_600;

export interface OneWindow {
  pi: number;
  called: boolean;
  until: number;
}

export interface OCState {
  n: number;
  hands: Card[][];
  out: boolean[];
  turn: number;
  dir: 1 | -1;
  pile: Card[];
  draw: Card[];
  suit: number;
  /** 조커 뒤: 아무 무늬나 */
  free: boolean;
  /** 쌓인 공격 장 수 */
  pending: number;
  /** 지금 공격 세기 (1: 2 · 2: A · 3: 조커) */
  atk: number;
  one: OneWindow | null;
  over: boolean;
  /** 끝났을 때 순위 (자리 번호, 1등부터) */
  order: number[];
  /** 수가 하나 진행될 때마다 +1 (차례 시계 · 늦게 온 요청 구분) */
  seq: number;
  /** 지금 차례가 끝나는 시각 */
  deadline: number;
  /** 한 차례 시간 (빠른 판은 짧음) */
  turnMs: number;
}

export type OCEvent =
  | { t: "play"; pi: number; card: Card; suit?: number }
  | { t: "draw"; pi: number; n: number; atk: boolean }
  | { t: "shuffle" }
  | { t: "skip"; pi: number }
  | { t: "reverse" }
  | { t: "again"; pi: number }
  | { t: "one"; pi: number }
  | { t: "oneCall"; pi: number }
  | { t: "caught"; pi: number; by: number }
  | { t: "oneMiss"; pi: number }
  | { t: "bust"; pi: number }
  | { t: "timeout"; pi: number }
  | { t: "end"; order: number[] };

export type Rng = () => number;

export const isRed = (c: Card) => !c.jk && (c.s === 1 || c.s === 2);
export const rankLabel = (r: number) => (r === 14 ? "A" : r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : String(r));
/** 공격 세기 (0 = 공격 카드 아님) */
export const strength = (c: Card) => (c.jk ? 3 : c.r === 14 ? 2 : c.r === 2 ? 1 : 0);

function shuffle<T>(a: T[], rng: Rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface GameOpts {
  /** 처음 나눠 줄 장 수 (빠른 판 5장) */
  hand?: number;
  turnMs?: number;
}
/** 판 종류: 일반 판 · 빠른 판 */
export const MODES = {
  normal: { name: "일반 판", hand: HAND_SIZE, turnMs: TURN_MS },
  fast: { name: "빠른 판", hand: 5, turnMs: 9_000 },
} as const;
export type GameMode = keyof typeof MODES;

export function newGame(n: number, rng: Rng = Math.random, now = Date.now(), o: GameOpts = {}): OCState {
  const handSize = o.hand ?? HAND_SIZE;
  const turnMs = o.turnMs ?? TURN_MS;
  let id = 0;
  const deck: Card[] = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) deck.push({ id: ++id, r, s });
  deck.push({ id: ++id, r: 99, s: -1, jk: true }, { id: ++id, r: 99, s: -1, jk: true });
  shuffle(deck, rng);
  const hands: Card[][] = Array.from({ length: n }, () => []);
  for (let k = 0; k < handSize; k++) for (const h of hands) h.push(deck.pop()!);
  // 첫 바닥은 기능 없는 카드로
  let top = deck.pop()!;
  while (top.jk || [2, 7, 11, 12, 13, 14].includes(top.r)) {
    deck.unshift(top);
    top = deck.pop()!;
  }
  return {
    n,
    hands,
    out: Array(n).fill(false),
    turn: Math.floor(rng() * n),
    dir: 1,
    pile: [top],
    draw: deck,
    suit: top.s,
    free: false,
    pending: 0,
    atk: 0,
    one: null,
    over: false,
    order: [],
    seq: 0,
    deadline: now + turnMs,
    turnMs,
  };
}

export const top = (st: OCState) => st.pile[st.pile.length - 1];

export function playable(st: OCState, c: Card): boolean {
  const t = top(st);
  if (st.pending > 0) {
    const k = strength(c);
    if (!k) return false;
    if (c.jk) return true;
    if (k === st.atk) return t.jk ? false : c.r === t.r;
    return k > st.atk && c.s === st.suit;
  }
  if (c.jk || st.free) return true;
  return c.s === st.suit || (!t.jk && c.r === t.r);
}

export function nextIdx(st: OCState, from: number, steps = 1): number {
  let t = from;
  for (let k = 0; k < steps; k++) {
    let guard = 0;
    do t = (t + st.dir + st.n) % st.n;
    while (st.out[t] && ++guard < st.n);
  }
  return t;
}

const alive = (st: OCState) => st.out.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);

function takeCards(st: OCState, pi: number, n: number, ev: OCEvent[], rng: Rng): number {
  let got = 0;
  for (let k = 0; k < n; k++) {
    if (!st.draw.length) {
      const t = st.pile.pop()!;
      st.draw = shuffle(st.pile, rng);
      st.pile = [t];
      if (st.draw.length) ev.push({ t: "shuffle" });
    }
    const c = st.draw.pop();
    if (!c) break;
    st.hands[pi].push(c);
    got++;
  }
  return got;
}

function finish(st: OCState, winner: number | null, ev: OCEvent[]) {
  st.over = true;
  st.one = null;
  const idx = [...Array(st.n).keys()];
  st.order = idx.sort((a, b) => {
    if (a === winner) return -1;
    if (b === winner) return 1;
    if (st.out[a] !== st.out[b]) return st.out[a] ? 1 : -1;
    return st.hands[a].length - st.hands[b].length;
  });
  ev.push({ t: "end", order: st.order });
}

/** 파산 확인 · 혼자 남으면 끝 */
function checkBust(st: OCState, pi: number, ev: OCEvent[]): boolean {
  if (st.hands[pi].length < BUST) return false;
  st.out[pi] = true;
  st.draw.unshift(...st.hands[pi]);
  st.hands[pi] = [];
  ev.push({ t: "bust", pi });
  if (st.one?.pi === pi) st.one = null;
  const left = alive(st);
  if (left.length <= 1) finish(st, left[0] ?? null, ev);
  return true;
}

function advance(st: OCState, to: number, now: number) {
  st.turn = to;
  st.seq++;
  st.deadline = now + (st.turnMs || TURN_MS);
}

/** 카드 내기. 못 내는 카드면 null */
export function play(st: OCState, pi: number, cardId: number, suit: number | undefined, _rng: Rng = Math.random, now = Date.now()): OCEvent[] | null {
  if (st.over || st.turn !== pi || st.out[pi]) return null;
  const h = st.hands[pi];
  const c = h.find((x) => x.id === cardId);
  if (!c || !playable(st, c)) return null;
  const ev: OCEvent[] = [];
  h.splice(h.indexOf(c), 1);
  st.pile.push(c);
  if (c.jk) {
    st.pending += 5;
    st.atk = 3;
    st.free = true;
  } else {
    st.free = false;
    st.suit = c.s;
    if (c.r === 2) {
      st.pending += 2;
      st.atk = 1;
    } else if (c.r === 14) {
      st.pending += 3;
      st.atk = 2;
    }
    if (c.r === 7 && st.pending === 0 && suit !== undefined && suit >= 0 && suit < 4) st.suit = suit;
  }
  ev.push({ t: "play", pi, card: c, suit: c.r === 7 && !c.jk ? st.suit : undefined });
  // 내가 원카드 걸려 있었는데 그 사이 냈으면(1장 → 0장) 창은 닫힘
  if (st.one && st.one.pi === pi) st.one = null;
  if (h.length === 0) {
    finish(st, pi, ev);
    return ev;
  }
  if (h.length === 1) {
    st.one = { pi, called: false, until: now + ONE_MS };
    ev.push({ t: "one", pi });
  }
  if (c.r === 11 && !c.jk) {
    const s = nextIdx(st, pi, 1);
    ev.push({ t: "skip", pi: s });
    advance(st, nextIdx(st, pi, 2), now);
  } else if (c.r === 12 && !c.jk) {
    st.dir = st.dir === 1 ? -1 : 1;
    ev.push({ t: "reverse" });
    advance(st, nextIdx(st, pi, 1), now);
  } else if (c.r === 13 && !c.jk) {
    ev.push({ t: "again", pi });
    advance(st, pi, now);
  } else advance(st, nextIdx(st, pi, 1), now);
  return ev;
}

/** 카드 받기 (공격이 쌓였으면 그만큼, 아니면 1장) */
export function drawCards(st: OCState, pi: number, rng: Rng = Math.random, now = Date.now(), timeout = false): OCEvent[] | null {
  if (st.over || st.turn !== pi || st.out[pi]) return null;
  const ev: OCEvent[] = [];
  if (timeout) ev.push({ t: "timeout", pi });
  const atk = st.pending > 0;
  const n = atk ? st.pending : 1;
  st.pending = 0;
  st.atk = 0;
  if (st.one?.pi === pi) st.one = null;
  const got = takeCards(st, pi, n, ev, rng);
  ev.push({ t: "draw", pi, n: got, atk });
  if (checkBust(st, pi, ev) && st.over) return ev;
  advance(st, nextIdx(st, pi, 1), now);
  return ev;
}

/** 원카드 버튼: 내 창이면 외치기, 남의 창이면 잡기 */
export function pressOne(st: OCState, pi: number, rng: Rng = Math.random): OCEvent[] | null {
  const o = st.one;
  if (st.over || !o || o.called || st.out[pi]) return null;
  if (o.pi === pi) {
    o.called = true;
    return [{ t: "oneCall", pi }];
  }
  st.one = null;
  const ev: OCEvent[] = [{ t: "caught", pi: o.pi, by: pi }];
  takeCards(st, o.pi, 1, ev, rng);
  ev.push({ t: "draw", pi: o.pi, n: 1, atk: false });
  checkBust(st, o.pi, ev);
  return ev;
}

/** 원카드 창 시간이 다 됨: 안 외쳤으면 +1장 */
export function oneExpire(st: OCState, rng: Rng = Math.random): OCEvent[] | null {
  const o = st.one;
  if (!o) return null;
  st.one = null;
  if (o.called || st.over) return [];
  const ev: OCEvent[] = [{ t: "oneMiss", pi: o.pi }];
  takeCards(st, o.pi, 1, ev, rng);
  ev.push({ t: "draw", pi: o.pi, n: 1, atk: false });
  checkBust(st, o.pi, ev);
  return ev;
}

// ───────────── 봇 ─────────────

export type BotStyle = "aggro" | "saver" | "normal";
/** 봇 난이도: 0 초급 · 1 중급 · 2 고급 */
export type BotLevel = 0 | 1 | 2;
export const BOT_LEVELS = ["초급", "중급", "고급"] as const;
/** 난이도별: 원카드 외치기를 깜빡할 확률 · 남을 잡을 확률 · 반응 시간(ms) */
export const BOT_ONE = [
  { miss: 0.45, catch: 0.12, react: [1300, 2300] },
  { miss: 0.18, catch: 0.4, react: [800, 1900] },
  { miss: 0.03, catch: 0.8, react: [450, 1200] },
] as const;

/** 봇이 낼 카드 (null = 받기) */
export function botChoice(st: OCState, pi: number, style: BotStyle, rng: Rng = Math.random, level: BotLevel = 1): { id: number; suit?: number } | null {
  const hand = st.hands[pi];
  const cards = hand.filter((c) => playable(st, c));
  if (!cards.length) return null;
  const bestSuit = (except?: Card) => {
    const cc = [0, 0, 0, 0];
    hand.filter((x) => x !== except && !x.jk).forEach((x) => cc[x.s]++);
    return cc.indexOf(Math.max(...cc));
  };
  // 초급: 아무거나 (가끔 낼 수 있는데도 받음)
  if (level === 0) {
    if (st.pending === 0 && rng() < 0.1) return null;
    if (st.pending > 0 && rng() < 0.25) return null;
    const c = cards[Math.floor(rng() * cards.length)];
    return { id: c.id, suit: c.r === 7 && !c.jk ? Math.floor(rng() * 4) : undefined };
  }
  if (st.pending > 0) {
    cards.sort((a, b) => strength(a) - strength(b));
    return { id: cards[0].id };
  }
  const nxt = nextIdx(st, pi, 1);
  const nxtN = st.hands[nxt].length;
  const danger = nxtN <= 2 || hand.length <= 3;
  const cnt = [0, 0, 0, 0];
  hand.forEach((c) => {
    if (!c.jk) cnt[c.s]++;
  });
  const minOther = Math.min(...st.hands.map((h, i) => (i === pi || st.out[i] ? 99 : h.length)));
  let best = cards[0],
    bs = -1e9;
  for (const c of cards) {
    let s = c.jk ? 0 : cnt[c.s] + rng() * (level === 2 ? 0.6 : 1.5);
    const atk = strength(c);
    if (level === 2) {
      // 고급: 공격 카드는 막을 때 쓰려고 아끼다가, 다음 사람이 거의 다 털었으면 바로 공격 · 건너뛰기
      if (atk) s += nxtN <= 2 ? 8 : hand.length <= 2 ? 4 : -4;
      if (c.jk) s += nxtN <= 1 ? 6 : -8;
      if ((c.r === 11 || c.r === 12) && !c.jk) s += nxtN <= 2 ? 6 : minOther <= 2 ? 2 : -1;
      if (c.r === 13 && !c.jk) s += hand.some((x) => x !== c && (x.jk || x.s === c.s || x.r === 13)) ? 3 : -3;
      if (c.r === 7 && !c.jk) s += cards.length === 1 ? 2 : cnt[c.s] <= 1 ? 1 : -2;
      // 같은 숫자가 많은 카드부터 털어 무늬를 바꿀 길을 남김
      if (!c.jk) s += hand.filter((x) => x !== c && x.r === c.r).length * 0.6;
    } else {
      if (atk) {
        if (style === "aggro") s += 5;
        else if (style === "saver") s += danger ? 6 : -6;
        else s += danger ? 3 : 0;
      }
      if (c.jk && style !== "aggro" && !danger) s -= 6;
      if ((c.r === 11 || c.r === 12) && !c.jk) s += nxtN <= 3 ? 3 : 0;
      if (c.r === 13 && !c.jk) s += hand.some((x) => x !== c && !x.jk && (x.s === c.s || x.r === 13)) ? 2 : -2;
      if (c.r === 7 && !c.jk) s += cards.length === 1 ? 2 : -1;
    }
    if (s > bs) {
      bs = s;
      best = c;
    }
  }
  return { id: best.id, suit: best.r === 7 && !best.jk ? bestSuit(best) : undefined };
}

/** 화면에 보낼 상태: 남의 손패는 장 수만 */
export interface OCView {
  n: number;
  counts: number[];
  out: boolean[];
  turn: number;
  dir: 1 | -1;
  top: Card;
  drawLeft: number;
  suit: number;
  free: boolean;
  pending: number;
  atk: number;
  one: OneWindow | null;
  over: boolean;
  order: number[];
  seq: number;
  deadline: number;
  /** 보는 사람 자리의 손패 (관전이면 null) */
  hand: Card[] | null;
  me: number;
}

export function view(st: OCState, me: number): OCView {
  return {
    n: st.n,
    counts: st.hands.map((h) => h.length),
    out: [...st.out],
    turn: st.turn,
    dir: st.dir,
    top: top(st),
    drawLeft: st.draw.length,
    suit: st.suit,
    free: st.free,
    pending: st.pending,
    atk: st.atk,
    one: st.one ? { ...st.one } : null,
    over: st.over,
    order: [...st.order],
    seq: st.seq,
    deadline: st.deadline,
    hand: me >= 0 && me < st.n ? st.hands[me].map((c) => ({ ...c })) : null,
    me,
  };
}
