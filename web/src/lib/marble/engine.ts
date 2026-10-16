/*
 * DICE TOWN v2 엔진 — 야추 × 보드 파티.
 *
 * 한 차례: (스킬 · 아이템) → 주사위 5개 굴리기 → 잠그고 다시 굴리기 최대 2번
 *   → 주사위 2개 골라 그 합만큼 이동 · 5개 전체 족보로 보상 → 지나가며 별 사기 → 도착 칸 효과.
 * 10바퀴 뒤 별이 가장 많은 사람이 이김 (동점이면 코인). 판 끝에 보너스 별 셋. 막판 3바퀴는 두 배.
 *
 * 서버가 판을 돌리고(act), 화면은 ev 를 순서대로 연출. 밸런스 시뮬도 같은 코드.
 * 이 폴더는 브라우저 · 서버 둘 다에서 돌아서 "@/…" 경로를 쓰지 않음.
 */
import { fxOf, SKILL_TIME, type Fx, type Loadout, type SkillFx, type SkillKind } from "./data";
import { MAPS, type MapDef, type MapId, type TileKind } from "./maps";
import { rnd, rndInt, pickW, type Rng } from "./rng";

/* ───────────── 규칙 수치 ───────────── */

export const RULE = {
  startCoins: 10,
  starPrice: 25,
  /** 별 값 아래 끝 (할인해도) */
  starMin: 5,
  rerolls: 2,
  dice: 5,
  maxCards: 3,
  /** 출발 지날 때 */
  start: 5,
  blue: 3,
  red: 3,
  /** 별 없는 별 자리 */
  starEmpty: 1,
  /** 잭팟 처음 · 털린 뒤 다시 채우는 값 */
  potSeed: 5,
  /** 막판 바퀴 수 · 배수 · 꼴찌 보너스 */
  frenzyRounds: 3,
  frenzyMult: 2,
  catchup: 10,
  vsStake: 6,
  /** 축제: 주사위 하나 × 이만큼 */
  festPer: 2,
  /** 남이 깐 함정 */
  trapFee: 5,
  /** 아이템 칸에서 손이 꽉 찼으면 */
  fullHandCoins: 3,
  /** 판 끝 보너스 별 */
  bonusStars: true,
};

/* ───────────── 족보 ───────────── */

export type HandId = "none" | "pair" | "two" | "triple" | "small" | "full" | "large" | "four" | "yacht";
export const HAND_ORDER: HandId[] = ["none", "pair", "two", "triple", "small", "full", "large", "four", "yacht"];

export interface HandDef {
  name: string;
  /** 족보왕 점수 */
  pts: number;
  /** 보상 */
  coins: number;
  card?: number;
  steal?: number;
  star?: number;
  /** 이동을 1~12 중 마음대로 */
  free?: boolean;
  /** 별 칸으로 순간이동 */
  jump?: boolean;
  desc: string;
}
export const HANDS: Record<HandId, HandDef> = {
  none: { name: "꽝", pts: 0, coins: 0, desc: "보상 없음" },
  pair: { name: "원 페어", pts: 1, coins: 1, desc: "코인 +1" },
  two: { name: "투 페어", pts: 2, coins: 3, desc: "코인 +3" },
  triple: { name: "트리플", pts: 3, coins: 0, card: 1, desc: "아이템 1장" },
  small: { name: "스몰 스트레이트", pts: 3, coins: 1, free: true, desc: "이동을 1~12 중 마음대로 + 코인 +1" },
  full: { name: "풀하우스", pts: 4, coins: 0, steal: 5, desc: "상대 한 명에게서 5코인 뺏기" },
  large: { name: "라지 스트레이트", pts: 5, coins: 2, jump: true, desc: "별 칸으로 순간이동 + 코인 +2" },
  four: { name: "포카드", pts: 6, coins: 5, card: 1, desc: "코인 +5 + 아이템 1장" },
  yacht: { name: "야추", pts: 8, coins: 0, star: 1, desc: "별 1개 바로!" },
};

/** 주사위 눈들의 족보 (0 = 없는 주사위는 무시, 6개면 그중 가장 좋은 것) */
export function handOf(dice: readonly number[]): HandId {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) if (d >= 1 && d <= 6) c[d]++;
  const counts = c.slice(1).sort((a, b) => b - a);
  const run = (a: number, b: number) => {
    for (let v = a; v <= b; v++) if (!c[v]) return false;
    return true;
  };
  if (counts[0] >= 5) return "yacht";
  if (counts[0] >= 4) return "four";
  if (run(1, 5) || run(2, 6)) return "large";
  if (counts[0] >= 3 && counts[1] >= 2) return "full";
  if (run(1, 4) || run(2, 5) || run(3, 6)) return "small";
  if (counts[0] >= 3) return "triple";
  if (counts[0] >= 2 && counts[1] >= 2) return "two";
  if (counts[0] >= 2) return "pair";
  return "none";
}

/* ───────────── 아이템 카드 (손에 최대 3장) ───────────── */

export type CardId = "gold" | "boost" | "reroll" | "thief" | "swap" | "starmove" | "trap" | "shield";
export interface CardDef {
  name: string;
  desc: string;
  /** pre = 굴리기 전 · dice = 굴린 뒤 · any = 이동 전 아무 때나 · auto = 저절로 (손해 막기) */
  when: "pre" | "dice" | "any" | "auto";
  /** 대상: die(주사위 + 눈) · foe(상대) · star(별 자리) */
  target?: "die" | "foe" | "star";
  w: number;
}
export const CARDS: Record<CardId, CardDef> = {
  gold: { name: "황금 주사위", desc: "주사위 하나를 원하는 눈으로", when: "dice", target: "die", w: 9 },
  boost: { name: "로켓 부츠", desc: "이번 이동 +3칸", when: "any", w: 12 },
  reroll: { name: "다시 굴리기 +1", desc: "이번 차례 다시 굴리기 한 번 더", when: "any", w: 16 },
  thief: { name: "코인 도둑", desc: "상대 한 명에게서 5코인 슬쩍", when: "any", target: "foe", w: 14 },
  swap: { name: "자리 바꾸기", desc: "상대 한 명과 말 자리를 바꿔요", when: "any", target: "foe", w: 8 },
  starmove: { name: "별 이사", desc: "별을 다른 별 자리로 옮겨요", when: "any", target: "star", w: 9 },
  trap: { name: "함정 설치", desc: "지금 칸에 함정 — 밟은 상대가 나에게 5코인", when: "any", w: 12 },
  shield: { name: "방패", desc: "가지고 있으면 다음 손해 한 번을 막아요", when: "auto", w: 12 },
};
export const CARD_IDS = Object.keys(CARDS) as CardId[];
const THIEF = 5;

/* ───────────── 마을 소식 (이벤트 칸) ───────────── */

export type EventId = "starmove" | "share" | "swap" | "rain" | "lucky" | "gust" | "tax" | "gift";
export const EVENTS: Record<EventId, { name: string; desc: string; v: number; w: number }> = {
  starmove: { name: "별이 이사 가요", desc: "별이 다른 별 자리로 옮겨 가요", v: 0, w: 12 },
  share: { name: "나눔 장터", desc: "코인 부자가 가장 가난한 사람에게 5코인", v: 1, w: 10 },
  swap: { name: "뒤죽박죽", desc: "아무 상대 한 명과 자리가 바뀌어요", v: 1, w: 9 },
  rain: { name: "코인 비", desc: "모두 코인 +3", v: 3, w: 12 },
  lucky: { name: "행운의 편지", desc: "코인 +6", v: 6, w: 14 },
  gust: { name: "돌풍", desc: "앞으로 1~6칸 더 날아가요", v: 3, w: 12 },
  tax: { name: "세금 고지서", desc: "코인 −4 (잭팟에 쌓여요)", v: -4, w: 11 },
  gift: { name: "깜짝 선물", desc: "아이템 1장", v: 5, w: 12 },
};
const EVENT_IDS = Object.keys(EVENTS) as EventId[];

/* ───────────── 상태 ───────────── */

export interface PState {
  id: string;
  name: string;
  bot: boolean;
  lo: Loadout;
  fx: Fx;
  skill: SkillFx;
  coins: number;
  stars: number;
  pos: number;
  /** 스킬 쿨 (내 차례 수) */
  cd: number;
  cards: CardId[];
  /** 스킬 방패 (다음 손해 막기) */
  shield: number;
  /** 다음 차례 다시 굴리기 0번 (함정 · 자장가) */
  sleep: boolean;
  /** 다음 차례 봉인될 주사위 수 */
  seal: number;
  /** 판당 횟수 남은 것 */
  uses: { reroll: number; gold: number; slide: number };
  stat: {
    /** 번 코인 합 (코인왕) */
    earned: number;
    /** 움직인 칸 */
    moved: number;
    /** 잃은 코인 (불운왕) */
    lost: number;
    /** 족보 점수 합 (족보왕) */
    hand: number;
    best: HandId;
    yacht: number;
    /** 산 별 */
    bought: number;
    skill: number;
  };
}

export interface Turn {
  /** 주사위 수 (봉인 · 여섯째 반영) */
  n: number;
  dice: number[];
  held: boolean[];
  /** 남은 다시 굴리기 */
  rolls: number;
  rolled: boolean;
  /** 이번 차례 스킬 썼나 · 효과 */
  skilled: boolean;
  dbl: boolean;
  vip: number;
  hop: boolean;
  tri: boolean;
  bunny: boolean;
  encore: boolean;
  /** 로켓 부츠: 이동 + */
  boost: number;
  /** 이번 차례 산 별 수 */
  bought: number;
  /** 토토: 이번 차례 받은 지나감 코인 */
  passGot: number;
  /** 확정한 이동 (족보 보상 고르는 동안 들고 있음) */
  mv: { steps: number; jump: boolean } | null;
  hand: HandId | null;
  /** 앙코르로 받은 차례 */
  again: boolean;
}

export type Prompt =
  | { k: "turn"; p: number }
  | { k: "dice"; p: number }
  | { k: "foe"; p: number; why: "steal" | "vs"; opts: number[] }
  | { k: "warp"; p: number }
  | { k: "more"; p: number; max: number };

export type Action =
  | { t: "roll"; power?: number }
  | { t: "hold"; pick: number[] }
  | { t: "reroll"; pick?: number[] }
  | { t: "move"; pick?: number[]; n?: number; d?: number }
  | { t: "skill"; target?: number; die?: number; n?: number; pick?: number[]; vals?: number[] }
  | { t: "card"; id: CardId; target?: number; die?: number; n?: number; tile?: number }
  | { t: "gear"; die: number; n: number }
  | { t: "target"; target: number }
  | { t: "warp"; tile: number }
  | { t: "more"; n: number };

export type CoinWhy =
  | "start"
  | "blue"
  | "red"
  | "empty"
  | "hand"
  | "card"
  | "steal"
  | "thief"
  | "vs"
  | "fest"
  | "jackpot"
  | "event"
  | "trap"
  | "circus"
  | "pass"
  | "shield"
  | "catchup";

export type Ev =
  | { t: "turn"; p: number; round: number; again?: boolean }
  | { t: "round"; round: number; frenzy?: boolean }
  | { t: "frenzy"; last: number[] }
  | { t: "roll"; p: number; dice: number[]; held: boolean[]; re: number; power?: number; lucky?: number }
  | { t: "hold"; p: number; held: boolean[] }
  | { t: "die"; p: number; i: number; from: number; to: number; why: "skill" | "card" | "gear" }
  | { t: "hand"; p: number; hand: HandId; x2?: boolean }
  | { t: "move"; p: number; path: number[]; why: "move" | "pull" | "warp" | "jump" | "gust" | "swap" | "more" | "hop" }
  | { t: "coin"; p: number; amt: number; why: CoinWhy; from?: number; pot?: number }
  | { t: "star"; p: number; at: number; price: number; why: "buy" | "vip" | "yacht" | "bonus"; n?: number }
  | { t: "starMove"; from: number; to: number }
  | { t: "card"; p: number; id: CardId; use?: boolean; target?: number; lost?: boolean }
  | { t: "skill"; p: number; kind: SkillKind; target?: number }
  | { t: "vs"; p: number; q: number; a: [number, number]; b: [number, number]; win: number; amt: number }
  | { t: "fest"; p: number; d: number; amt: number }
  | { t: "event"; p: number; id: EventId; alt?: EventId }
  | { t: "trap"; p: number; at: number }
  | { t: "debuff"; p: number; kind: "sleep" | "seal" | "trap"; by?: number }
  | { t: "block"; p: number; why: "shield" | "card" | "guard" | "immune" }
  | { t: "swap"; a: number; b: number }
  | { t: "bonus"; kind: "coin" | "hand" | "unlucky"; ps: number[]; val: number }
  | { t: "nope"; p: number; why: string };

export type WinHow = "stars";
type MoveWhy = Extract<Ev, { t: "move" }>["why"];

export interface Game {
  map: MapId;
  seed: number;
  rng: Rng;
  players: PState[];
  cur: number;
  round: number;
  rounds: number;
  first: number;
  prompt: Prompt | null;
  turn: Turn | null;
  /** 별이 있는 자리 */
  star: number;
  /** 별 자리 후보 */
  stars: number[];
  /** 자리별 함정 주인 (−1 = 없음) */
  traps: number[];
  pot: number;
  frenzy: boolean;
  /** 막판 시작 때 1등 (−1 = 아직) — 역전승 기록 */
  lead: number;
  ev: Ev[];
  over: { winner: number; how: WinHow } | null;
  /** 행동 수 (무한 루프 방지 · 기록) */
  steps: number;
}

export class ActError extends Error {}

/* ───────────── 도우미 ───────────── */

export const mapOf = (g: Game): MapDef => MAPS[g.map];
export const kindAt = (g: Game, slot: number): TileKind => mapOf(g).tiles[slot].kind;
const N = (g: Game) => mapOf(g).tiles.length;
const foes = (g: Game, pi: number) => g.players.map((_, i) => i).filter((i) => i !== pi);
const emit = (g: Game, e: Ev) => void g.ev.push(e);
function fail(msg: string): never {
  throw new ActError(msg);
}

/** 앞으로 steps 칸 길 (출발 자리 빼고, 도착 포함) */
export function pathOf(g: Game, from: number, steps: number): number[] {
  const n = N(g);
  const out: number[] = [];
  const dir = steps >= 0 ? 1 : -1;
  for (let i = 1; i <= Math.abs(steps); i++) out.push((((from + dir * i) % n) + n) % n);
  return out;
}
/** 여기서 별까지 앞으로 몇 칸 (같은 칸이면 0) */
export const starDist = (g: Game, from: number) => (g.star - from + N(g)) % N(g);

/** 이 사람이 지금 내는 별 값 */
export function starPrice(g: Game, pi: number): number {
  const p = g.players[pi];
  const vip = g.cur === pi && g.turn ? g.turn.vip : 0;
  return Math.max(RULE.starMin, RULE.starPrice - p.fx.starCut - vip);
}

/** 순위: 별 → 코인 → 차례 순 */
export function standings(g: Game): number[] {
  return g.players
    .map((_, i) => i)
    .sort((a, b) => g.players[b].stars - g.players[a].stars || g.players[b].coins - g.players[a].coins || ((a - g.first + 99) % g.players.length) - ((b - g.first + 99) % g.players.length));
}

export const cloneGame = (g: Game): Game => JSON.parse(JSON.stringify(g)) as Game;

const roll1 = (g: Game) => 1 + rndInt(g.rng, 6);
const frenzyX = (g: Game) => (g.frenzy ? RULE.frenzyMult : 1);

/* ───────────── 코인 ───────────── */

function gain(g: Game, pi: number, amt: number, why: CoinWhy, from?: number) {
  if (amt <= 0) return;
  const p = g.players[pi];
  p.coins += amt;
  p.stat.earned += amt;
  emit(g, { t: "coin", p: pi, amt, why, ...(from !== undefined && { from }) });
}

/** 손해 막기 (방패 스킬 → 방패 카드). 막았으면 true */
function blocked(g: Game, pi: number, steal: boolean): boolean {
  const p = g.players[pi];
  if (p.coins <= 0) return false;
  if (p.shield > 0) {
    p.shield--;
    emit(g, { t: "block", p: pi, why: "shield" });
    // 릴리: 막을 때마다 코인
    if (p.skill.kind === "shield" && p.skill.extra) gain(g, pi, p.skill.extra, "shield");
    return true;
  }
  const ci = p.cards.indexOf("shield");
  if (ci >= 0) {
    p.cards.splice(ci, 1);
    emit(g, { t: "card", p: pi, id: "shield", use: true });
    emit(g, { t: "block", p: pi, why: "card" });
    return true;
  }
  if (steal && p.fx.guard > 0 && rnd(g.rng) < p.fx.guard) {
    emit(g, { t: "block", p: pi, why: "guard" });
    return true;
  }
  return false;
}

/**
 * 잃기. to: 다른 사람 번호 · "pot"(잭팟에 쌓임) · "bank"(사라짐). steal 이면 경비견 · 철통 경계가 먹음.
 * 실제로 잃은 양을 돌려줌.
 */
function lose(g: Game, pi: number, amt: number, why: CoinWhy, to: number | "pot" | "bank", steal = false): number {
  const p = g.players[pi];
  if (amt <= 0 || p.coins <= 0) return 0;
  if (blocked(g, pi, steal)) return 0;
  if (steal) amt = Math.max(1, amt - p.fx.stealGuard);
  const x = Math.min(p.coins, amt);
  p.coins -= x;
  p.stat.lost += x;
  if (to === "pot") g.pot += x;
  emit(g, { t: "coin", p: pi, amt: -x, why, ...(typeof to === "number" && { from: to }), ...(to === "pot" && { pot: g.pot }) });
  if (typeof to === "number") {
    const q = g.players[to];
    q.coins += x;
    q.stat.earned += x;
    emit(g, { t: "coin", p: to, amt: x, why, from: pi });
  }
  return x;
}

function giveCard(g: Game, pi: number, why: "tile" | "hand" | "event" | "catchup"): boolean {
  const p = g.players[pi];
  if (p.cards.length >= RULE.maxCards) {
    gain(g, pi, RULE.fullHandCoins, "card");
    return false;
  }
  const id = CARD_IDS[pickW(g.rng, CARD_IDS.map((c) => CARDS[c].w))];
  p.cards.push(id);
  emit(g, { t: "card", p: pi, id });
  void why;
  return true;
}

/* ───────────── 별 ───────────── */

function moveStar(g: Game, to?: number) {
  const from = g.star;
  const opts = g.stars.filter((s) => s !== from);
  g.star = to !== undefined && opts.includes(to) ? to : opts[rndInt(g.rng, opts.length)];
  emit(g, { t: "starMove", from, to: g.star });
}

/** 별 사기 (돈 되면 저절로) — 샀으면 true */
function tryBuyStar(g: Game, pi: number, why: "buy" | "vip"): boolean {
  const p = g.players[pi];
  const price = starPrice(g, pi);
  if (p.coins < price) {
    emit(g, { t: "nope", p: pi, why: `별 값 ${price}코인이 모자라요` });
    return false;
  }
  p.coins -= price;
  p.stars++;
  p.stat.bought++;
  if (g.turn && g.cur === pi) g.turn.bought++;
  emit(g, { t: "star", p: pi, at: g.star, price, why });
  moveStar(g);
  return true;
}

/* ───────────── 판 시작 ───────────── */

export interface PlayerIn {
  id: string;
  name: string;
  bot: boolean;
  lo: Loadout;
}

export function newGame(o: { map?: MapId; seed: number; players: PlayerIn[]; rounds?: number; first?: number }): Game {
  const map: MapId = o.map && MAPS[o.map] ? o.map : "town";
  const m = MAPS[map];
  const startSlot = m.tiles.findIndex((t) => t.kind === "start");
  const stars = m.tiles.map((t, i) => (t.kind === "star" ? i : -1)).filter((i) => i >= 0);
  const g: Game = {
    map,
    seed: o.seed >>> 0,
    rng: { r: o.seed | 0 },
    players: o.players.map((pl) => {
      const { fx, skill } = fxOf(pl.lo);
      return {
        id: pl.id,
        name: pl.name,
        bot: pl.bot,
        lo: pl.lo,
        fx,
        skill,
        coins: RULE.startCoins + fx.startCoins,
        stars: 0,
        pos: startSlot,
        cd: 0,
        cards: [],
        shield: 0,
        sleep: false,
        seal: 0,
        uses: { reroll: fx.usesReroll, gold: fx.usesGold, slide: fx.usesSlide },
        stat: { earned: 0, moved: 0, lost: 0, hand: 0, best: "none", yacht: 0, bought: 0, skill: 0 },
      };
    }),
    cur: 0,
    round: 1,
    rounds: o.rounds ?? m.rounds,
    first: 0,
    prompt: null,
    turn: null,
    star: stars[0],
    stars,
    traps: m.tiles.map(() => -1),
    pot: RULE.potSeed,
    frenzy: false,
    lead: -1,
    ev: [],
    over: null,
    steps: 0,
  };
  g.cur = g.first = o.first ?? rndInt(g.rng, g.players.length);
  // 첫 별: 출발에서 너무 가깝지 않은 곳 (둘째 이후 아무 데나)
  const far = stars.filter((s) => s >= 8);
  g.star = far[rndInt(g.rng, far.length)] ?? stars[0];
  emit(g, { t: "round", round: 1 });
  startTurn(g, true);
  return g;
}

/* ───────────── 차례 ───────────── */

function startTurn(g: Game, fresh: boolean) {
  const pi = g.cur;
  const p = g.players[pi];
  if (fresh && p.cd > 0) p.cd--;
  const n = Math.max(3, RULE.dice - p.seal);
  const t: Turn = {
    n,
    dice: [],
    held: [],
    rolls: p.sleep ? 0 : RULE.rerolls,
    rolled: false,
    skilled: false,
    dbl: false,
    vip: 0,
    hop: false,
    tri: false,
    bunny: false,
    encore: false,
    boost: 0,
    bought: 0,
    passGot: 0,
    mv: null,
    hand: null,
    again: !fresh,
  };
  g.turn = t;
  emit(g, { t: "turn", p: pi, round: g.round, ...(!fresh && { again: true }) });
  if (p.sleep) emit(g, { t: "debuff", p: pi, kind: "sleep" });
  if (p.seal) emit(g, { t: "debuff", p: pi, kind: "seal" });
  p.sleep = false;
  p.seal = 0;
  g.prompt = { k: "turn", p: pi };
}

function endTurn(g: Game) {
  const t = g.turn!;
  g.prompt = null;
  if (t.encore) {
    emit(g, { t: "skill", p: g.cur, kind: "encore" });
    startTurn(g, false);
    return;
  }
  g.cur = (g.cur + 1) % g.players.length;
  if (g.cur === g.first) {
    g.round++;
    if (g.round > g.rounds) return finish(g);
    const frenzy = g.round > g.rounds - RULE.frenzyRounds && g.rounds > RULE.frenzyRounds + 2;
    emit(g, { t: "round", round: g.round, ...(frenzy && !g.frenzy && { frenzy: true }) });
    if (frenzy && !g.frenzy) {
      g.frenzy = true;
      // 꼴찌(별 → 코인) 위로금
      const st = standings(g);
      g.lead = st[0];
      const lastP = g.players[st[st.length - 1]];
      const last = st.filter((i) => g.players[i].stars === lastP.stars && g.players[i].coins === lastP.coins);
      emit(g, { t: "frenzy", last });
      for (const i of last) {
        gain(g, i, RULE.catchup, "catchup");
        giveCard(g, i, "catchup");
      }
    }
  }
  startTurn(g, true);
}

function finish(g: Game) {
  g.round = g.rounds;
  g.prompt = null;
  g.turn = null;
  if (RULE.bonusStars) {
    const award = (kind: "coin" | "hand" | "unlucky", val: (p: PState) => number) => {
      const best = Math.max(...g.players.map(val));
      if (best <= 0) return;
      const ps = g.players.map((p, i) => (val(p) === best ? i : -1)).filter((i) => i >= 0);
      emit(g, { t: "bonus", kind, ps, val: best });
      for (const i of ps) {
        g.players[i].stars++;
        emit(g, { t: "star", p: i, at: -1, price: 0, why: "bonus" });
      }
    };
    award("coin", (p) => p.stat.earned);
    award("hand", (p) => p.stat.hand);
    award("unlucky", (p) => p.stat.lost);
  }
  g.over = { winner: standings(g)[0], how: "stars" };
}

/* ───────────── 굴리기 ───────────── */

function rollDice(g: Game, first: boolean) {
  const t = g.turn!;
  const p = g.players[g.cur];
  for (let i = 0; i < t.n; i++) {
    if (t.held[i]) continue;
    let v = roll1(g);
    if (!first && v === 1 && p.fx.noOne > 0 && rnd(g.rng) < p.fx.noOne) v = roll1(g);
    t.dice[i] = v;
  }
  let lucky: number | undefined;
  if (first && p.fx.twin > 0 && new Set(t.dice).size === t.dice.length && rnd(g.rng) < p.fx.twin) {
    // 짝 하나 맞춰 줌
    const a = rndInt(g.rng, t.n);
    let b = rndInt(g.rng, t.n - 1);
    if (b >= a) b++;
    t.dice[b] = t.dice[a];
    lucky = b;
  }
  return lucky;
}

/* ───────────── 이동 ───────────── */

/** 앞으로 걷기: 지나가며 출발 코인 · 별 사기 · 토토 배달비. 도착 자리 돌려줌 */
function walk(g: Game, pi: number, steps: number, why: MoveWhy): number {
  const p = g.players[pi];
  const path = pathOf(g, p.pos, steps);
  if (!path.length) return p.pos;
  emit(g, { t: "move", p: pi, path, why });
  const t = g.turn;
  for (const s of path) {
    p.pos = s;
    p.stat.moved++;
    const k = kindAt(g, s);
    if (k === "start") gain(g, pi, RULE.start + p.fx.startBonus, "start");
    if (s === g.star && pi === g.cur) tryBuyStar(g, pi, "buy");
    else if (k === "blue" && s !== path[path.length - 1] && p.fx.passBlue > 0 && t && pi === g.cur && t.passGot < p.fx.passBlue) {
      t.passGot++;
      gain(g, pi, 1, "pass");
    }
  }
  return p.pos;
}

/** 순간이동 (지나가는 효과 없음) */
function teleport(g: Game, pi: number, to: number, why: "warp" | "jump" | "swap" | "pull") {
  const p = g.players[pi];
  emit(g, { t: "move", p: pi, path: [to], why });
  p.pos = to;
}

const isBad = (g: Game, pi: number, slot: number) => {
  const k = kindAt(g, slot);
  return k === "red" || k === "trap" || (g.traps[slot] >= 0 && g.traps[slot] !== pi);
};

/** 빨간망토: 나쁜 칸이면 폴짝 */
function hopIfBad(g: Game, pi: number) {
  const t = g.turn!;
  if (!t.hop) return;
  let guard = 0;
  while (isBad(g, pi, g.players[pi].pos) && guard++ < 4) walk(g, pi, 1, "hop");
}

/**
 * 도착 칸 효과. 프롬프트가 생기면 true (차례 끝내지 말 것).
 * depth: 돌풍 · 워프로 이어진 횟수
 */
function land(g: Game, pi: number, depth = 0): boolean {
  const p = g.players[pi];
  const s = p.pos;
  const k = kindAt(g, s);
  // 막판 배수 · 행운 바구니(도착 칸 코인 2배)
  const bag = g.cur === pi && g.turn?.hop ? 2 : 1;
  const x = frenzyX(g);
  // 남이 깐 함정
  const owner = g.traps[s];
  if (owner >= 0 && owner !== pi) {
    g.traps[s] = -1;
    if (p.fx.trapFree) emit(g, { t: "block", p: pi, why: "immune" });
    else lose(g, pi, RULE.trapFee, "trap", owner);
  }
  switch (k) {
    case "blue":
      gain(g, pi, (RULE.blue + p.fx.blueBonus) * x * bag, "blue");
      break;
    case "star":
      if (s !== g.star) gain(g, pi, RULE.starEmpty * x * bag, "empty");
      break;
    case "red":
      lose(g, pi, Math.max(0, RULE.red - p.fx.redCut) * x, "red", "pot");
      break;
    case "item":
      giveCard(g, pi, "tile");
      if (p.fx.itemBonus) gain(g, pi, p.fx.itemBonus * bag, "card");
      break;
    case "vs": {
      const opts = foes(g, pi);
      if (!opts.length) break;
      g.prompt = { k: "foe", p: pi, why: "vs", opts };
      return true;
    }
    case "trap":
      if (p.fx.trapFree) emit(g, { t: "block", p: pi, why: "immune" });
      else {
        p.sleep = true;
        emit(g, { t: "debuff", p: pi, kind: "trap" });
      }
      break;
    case "warp":
      if (depth > 1) break;
      g.prompt = { k: "warp", p: pi };
      return true;
    case "fest": {
      const d = roll1(g);
      const amt = Math.round(d * RULE.festPer * (1 + p.fx.festMult) * bag);
      emit(g, { t: "fest", p: pi, d, amt });
      gain(g, pi, amt, "fest");
      break;
    }
    case "jackpot": {
      const base = g.pot;
      const amt = Math.round(base * (1 + p.fx.jackpotMult) * bag);
      g.pot = RULE.potSeed;
      p.coins += amt;
      p.stat.earned += amt;
      emit(g, { t: "coin", p: pi, amt, why: "jackpot", pot: g.pot });
      break;
    }
    case "event":
      return doEvent(g, pi, depth);
    case "start":
      break;
  }
  return false;
}

function doEvent(g: Game, pi: number, depth: number): boolean {
  const p = g.players[pi];
  const draw = () => EVENT_IDS[pickW(g.rng, EVENT_IDS.map((e) => EVENTS[e].w))];
  let id = draw();
  let alt: EventId | undefined;
  if (p.fx.eventLuck) {
    alt = draw();
    if (EVENTS[alt].v > EVENTS[id].v) [id, alt] = [alt, id];
  }
  emit(g, { t: "event", p: pi, id, ...(alt && { alt }) });
  switch (id) {
    case "starmove":
      moveStar(g);
      break;
    case "share": {
      const by = [...g.players.keys()].sort((a, b) => g.players[b].coins - g.players[a].coins);
      const rich = by[0];
      const poor = by[by.length - 1];
      if (rich !== poor && g.players[rich].coins > g.players[poor].coins) lose(g, rich, 5, "event", poor);
      break;
    }
    case "swap": {
      const fs = foes(g, pi);
      const q = fs[rndInt(g.rng, fs.length)];
      swapPos(g, pi, q);
      break;
    }
    case "rain":
      for (let i = 0; i < g.players.length; i++) gain(g, i, 3, "event");
      break;
    case "lucky":
      gain(g, pi, 6, "event");
      break;
    case "gust": {
      const n = roll1(g);
      walk(g, pi, n, "gust");
      if (depth < 2) return land(g, pi, depth + 1);
      break;
    }
    case "tax":
      lose(g, pi, 4, "event", "pot");
      break;
    case "gift":
      giveCard(g, pi, "event");
      break;
  }
  return false;
}

function swapPos(g: Game, a: number, b: number) {
  const pa = g.players[a].pos;
  const pb = g.players[b].pos;
  g.players[a].pos = pb;
  g.players[b].pos = pa;
  emit(g, { t: "swap", a, b });
}

function resolveVs(g: Game, pi: number, q: number) {
  const a: [number, number] = [roll1(g), roll1(g)];
  const b: [number, number] = [roll1(g), roll1(g)];
  const sa = a[0] + a[1];
  const sb = b[0] + b[1];
  const win = sa > sb ? pi : sb > sa ? q : -1;
  const stake = RULE.vsStake * frenzyX(g);
  emit(g, { t: "vs", p: pi, q, a, b, win, amt: win >= 0 ? Math.min(stake, g.players[win === pi ? q : pi].coins) : 0 });
  if (win < 0) return;
  const loser = win === pi ? q : pi;
  lose(g, loser, stake, "vs", win, true);
  const bonus = g.players[win].fx.vsBonus;
  if (bonus) gain(g, win, bonus, "vs");
}

/* ───────────── 족보 보상 → 이동 ───────────── */

/** 족보 보상 (풀하우스는 대상 고르기 프롬프트). 프롬프트가 생기면 true */
function rewardHand(g: Game, pi: number): boolean {
  const t = g.turn!;
  const p = g.players[pi];
  const h = t.hand!;
  const d = HANDS[h];
  const m = t.dbl ? 2 : 1;
  emit(g, { t: "hand", p: pi, hand: h, ...(t.dbl && h !== "none" && { x2: true }) });
  p.stat.hand += d.pts;
  if (HAND_ORDER.indexOf(h) > HAND_ORDER.indexOf(p.stat.best)) p.stat.best = h;
  let coins = d.coins;
  if (h === "pair" || h === "two") coins += p.fx.comboCoin;
  if (HAND_ORDER.indexOf(h) >= HAND_ORDER.indexOf("triple") && h !== "small" && h !== "large") coins += p.fx.bigCombo;
  if (h === "small" || h === "large") coins += p.fx.straightBonus;
  if (h === "yacht") {
    coins += p.fx.yachtBonus;
    p.stat.yacht++;
    for (let i = 0; i < (d.star ?? 0) * m; i++) {
      p.stars++;
      emit(g, { t: "star", p: pi, at: -1, price: 0, why: "yacht", n: i + 1 });
    }
  }
  gain(g, pi, coins * m, "hand");
  for (let i = 0; i < (d.card ?? 0) * m; i++) giveCard(g, pi, "hand");
  if (d.steal) {
    const opts = foes(g, pi).filter((q) => g.players[q].coins > 0);
    if (opts.length) {
      g.prompt = { k: "foe", p: pi, why: "steal", opts };
      return true;
    }
  }
  return false;
}

function afterHand(g: Game) {
  const pi = g.cur;
  const t = g.turn!;
  const p = g.players[pi];
  const mv = t.mv!;
  g.prompt = null;
  if (mv.jump) {
    teleport(g, pi, g.star, "jump");
    p.stat.moved += mv.steps;
    tryBuyStar(g, pi, "buy");
  } else {
    walk(g, pi, mv.steps, "move");
  }
  if (t.bunny) {
    g.prompt = { k: "more", p: pi, max: 3 };
    return;
  }
  afterMove(g);
}

function afterMove(g: Game) {
  const pi = g.cur;
  const t = g.turn!;
  g.prompt = null;
  hopIfBad(g, pi);
  // MOA: 도착 칸에서 3칸 안 별
  if (t.vip && !t.bought) {
    const d = starDist(g, g.players[pi].pos);
    if (d >= 1 && d <= VIP_RANGE) tryBuyStar(g, pi, "vip");
  }
  if (land(g, pi)) return;
  endTurn(g);
}

/* ───────────── 스킬 ───────────── */

export const VIP_RANGE = 4;

/** 지금 스킬을 쓸 수 있나 (이유 문자열 · 되면 null) */
export function skillBlock(g: Game, pi: number): string | null {
  const p = g.players[pi];
  const t = g.turn;
  if (!t || g.cur !== pi || !g.prompt || (g.prompt.k !== "turn" && g.prompt.k !== "dice")) return "지금은 못 써요";
  if (g.round <= 1) return "첫 바퀴엔 스킬을 못 써요";
  if (t.skilled) return "이번 차례에 이미 썼어요";
  if (p.cd > 0) return `${p.cd}차례 뒤에 쓸 수 있어요`;
  if (SKILL_TIME[p.skill.kind] === "dice" && !t.rolled) return "주사위를 굴린 뒤에 써요";
  if (p.skill.kind === "encore" && t.again) return "앙코르 차례엔 못 써요";
  return null;
}
export const canSkill = (g: Game, pi: number) => skillBlock(g, pi) === null;

const dieIdx = (t: Turn, i: unknown): number => (typeof i === "number" && Number.isInteger(i) && i >= 0 && i < t.n ? i : fail("주사위를 골라 주세요"));
const face = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 6 ? v : fail("1~6 중에서 골라 주세요"));
const foeIdx = (g: Game, pi: number, q: unknown): number =>
  typeof q === "number" && Number.isInteger(q) && q >= 0 && q < g.players.length && q !== pi ? q : fail("상대를 골라 주세요");

function setDie(g: Game, pi: number, i: number, v: number, why: "skill" | "card" | "gear") {
  const t = g.turn!;
  const from = t.dice[i];
  t.dice[i] = v;
  emit(g, { t: "die", p: pi, i, from, to: v, why });
}

function applySkill(g: Game, pi: number, a: Extract<Action, { t: "skill" }>) {
  const why = skillBlock(g, pi);
  if (why) fail(why);
  const p = g.players[pi];
  const t = g.turn!;
  const { kind, mag } = p.skill;
  // 검사 먼저 (실패하면 쿨 안 돎)
  let target: number | undefined;
  switch (kind) {
    case "nudge": {
      const i = dieIdx(t, a.die);
      const d = a.n ?? 0;
      if (!Number.isInteger(d) || d === 0 || Math.abs(d) > mag) fail(`±1~${mag} 중에서 골라 주세요`);
      const v = t.dice[i] + d;
      if (v < 1 || v > 6) fail("1~6 밖으로는 못 바꿔요");
      break;
    }
    case "six":
      if (t.dice[dieIdx(t, a.die)] === 6) fail("이미 6이에요");
      break;
    case "magic": {
      const pk = a.pick ?? [];
      const vs = a.vals ?? [];
      if (pk.length !== 2 || vs.length !== 2 || pk[0] === pk[1]) fail("주사위 두 개와 눈을 골라 주세요");
      pk.forEach((i) => dieIdx(t, i));
      vs.forEach(face);
      break;
    }
    case "copy": {
      const src = dieIdx(t, a.die);
      const pk = [...new Set(a.pick ?? [])].filter((i) => i !== src);
      if (!pk.length || pk.length > mag) fail(`바꿀 주사위를 1~${mag}개 골라 주세요`);
      pk.forEach((i) => dieIdx(t, i));
      break;
    }
    case "pull": {
      target = foeIdx(g, pi, a.target);
      const n = a.n ?? 0;
      if (!Number.isInteger(n) || n === 0 || Math.abs(n) > mag) fail(`앞뒤 1~${mag}칸 중에서 골라 주세요`);
      break;
    }
    case "seal":
      target = foeIdx(g, pi, a.target);
      break;
  }
  t.skilled = true;
  p.cd = p.skill.cd;
  p.stat.skill++;
  if (kind !== "encore") emit(g, { t: "skill", p: pi, kind, ...(target !== undefined && { target }) });
  switch (kind) {
    case "reroll":
      t.rolls += mag;
      break;
    case "double":
      t.dbl = true;
      break;
    case "shield":
      p.shield += mag;
      break;
    case "nudge": {
      const i = a.die!;
      setDie(g, pi, i, t.dice[i] + a.n!, "skill");
      break;
    }
    case "six":
      setDie(g, pi, a.die!, 6, "skill");
      break;
    case "magic":
      a.pick!.forEach((i, j) => setDie(g, pi, i, a.vals![j], "skill"));
      break;
    case "copy": {
      const src = a.die!;
      [...new Set(a.pick!)].filter((i) => i !== src).forEach((i) => setDie(g, pi, i, t.dice[src], "skill"));
      break;
    }
    case "pull": {
      const q = target!;
      const n = a.n!;
      const qp = g.players[q];
      const path = pathOf(g, qp.pos, n);
      emit(g, { t: "move", p: q, path, why: "pull" });
      qp.pos = path[path.length - 1];
      lose(g, q, p.skill.extra ?? 0, "steal", pi, true);
      // 끌려간 칸이 나쁜 칸이면 그대로 당함
      const k = kindAt(g, qp.pos);
      const own = g.traps[qp.pos];
      if (own >= 0 && own !== q) {
        g.traps[qp.pos] = -1;
        if (qp.fx.trapFree) emit(g, { t: "block", p: q, why: "immune" });
        else lose(g, q, RULE.trapFee, "trap", own);
      }
      if (k === "red") lose(g, q, Math.max(0, RULE.red - qp.fx.redCut) * frenzyX(g), "red", "pot");
      if (k === "trap") {
        if (qp.fx.trapFree) emit(g, { t: "block", p: q, why: "immune" });
        else {
          qp.sleep = true;
          emit(g, { t: "debuff", p: q, kind: "trap", by: pi });
        }
      }
      break;
    }
    case "tri":
      t.tri = true;
      break;
    case "seal":
      g.players[target!].seal = mag;
      emit(g, { t: "debuff", p: target!, kind: "seal", by: pi });
      break;
    case "sleep":
      for (const q of foes(g, pi)) {
        g.players[q].sleep = true;
        emit(g, { t: "debuff", p: q, kind: "sleep", by: pi });
      }
      break;
    case "hop":
      t.hop = true;
      break;
    case "bunny":
      t.bunny = true;
      break;
    case "circus":
      for (const q of foes(g, pi)) lose(g, q, mag, "circus", pi);
      break;
    case "vip":
      t.vip = mag;
      break;
    case "encore":
      t.encore = true;
      emit(g, { t: "skill", p: pi, kind });
      break;
  }
}

/* ───────────── 아이템 카드 ───────────── */

export function cardBlock(g: Game, pi: number, id: CardId): string | null {
  const p = g.players[pi];
  const t = g.turn;
  if (!t || g.cur !== pi || !g.prompt || (g.prompt.k !== "turn" && g.prompt.k !== "dice")) return "지금은 못 써요";
  if (!p.cards.includes(id)) return "그 아이템이 없어요";
  const c = CARDS[id];
  if (c.when === "auto") return "가지고 있으면 저절로 막아요";
  if (c.when === "pre" && t.rolled) return "굴리기 전에 써요";
  if (c.when === "dice" && !t.rolled) return "굴린 뒤에 써요";
  if (id === "trap") {
    const k = kindAt(g, p.pos);
    if (k === "start" || k === "star" || g.traps[p.pos] >= 0) return "여기엔 함정을 못 깔아요";
  }
  if (id === "boost" && t.mv) return "이미 움직였어요";
  return null;
}

function applyCard(g: Game, pi: number, a: Extract<Action, { t: "card" }>) {
  if (!CARDS[a.id]) fail("없는 아이템이에요");
  const why = cardBlock(g, pi, a.id);
  if (why) fail(why);
  const p = g.players[pi];
  const t = g.turn!;
  let target: number | undefined;
  if (CARDS[a.id].target === "foe") target = foeIdx(g, pi, a.target);
  if (a.id === "gold") {
    dieIdx(t, a.die);
    face(a.n);
  }
  if (a.id === "starmove" && (a.tile === undefined || a.tile === g.star || !g.stars.includes(a.tile))) fail("옮길 별 자리를 골라 주세요");
  p.cards.splice(p.cards.indexOf(a.id), 1);
  emit(g, { t: "card", p: pi, id: a.id, use: true, ...(target !== undefined && { target }) });
  switch (a.id) {
    case "gold":
      setDie(g, pi, a.die!, a.n!, "card");
      break;
    case "boost":
      t.boost += 3;
      break;
    case "reroll":
      t.rolls++;
      break;
    case "thief":
      lose(g, target!, THIEF, "thief", pi, true);
      break;
    case "swap":
      swapPos(g, pi, target!);
      break;
    case "starmove":
      moveStar(g, a.tile);
      break;
    case "trap":
      g.traps[p.pos] = pi;
      emit(g, { t: "trap", p: pi, at: p.pos });
      break;
  }
}

/* ───────────── 이동 고르기 ───────────── */

/** 이 주사위들로 갈 수 있는 걸음 수 (고를 개수 k) */
export function moveSums(dice: readonly number[], k: number): number[] {
  const out = new Set<number>();
  const n = dice.length;
  const rec = (start: number, left: number, sum: number) => {
    if (!left) return void out.add(sum);
    for (let i = start; i < n; i++) rec(i + 1, left - 1, sum + dice[i]);
  };
  rec(0, Math.min(k, n), 0);
  return [...out].sort((a, b) => a - b);
}
/** 걸음 수 → 그 합이 되는 주사위 번호 */
export function pickFor(dice: readonly number[], k: number, sum: number): number[] | null {
  const n = dice.length;
  let res: number[] | null = null;
  const rec = (start: number, left: number, s: number, acc: number[]) => {
    if (res) return;
    if (!left) {
      if (s === sum) res = acc;
      return;
    }
    for (let i = start; i < n; i++) rec(i + 1, left - 1, s + dice[i], [...acc, i]);
  };
  rec(0, Math.min(k, n), 0, []);
  return res;
}

/** 이 칸에 서면 대략 몇 코인어치 (AI · 자동 진행 · 화면 추천) */
export function tileValue(g: Game, pi: number, slot: number): number {
  const hop = g.cur === pi && g.turn?.hop;
  if (hop && isBad(g, pi, slot)) return 1;
  const v = tileValue0(g, pi, slot);
  return hop && v > 0 && kindAt(g, slot) !== "vs" && kindAt(g, slot) !== "event" && kindAt(g, slot) !== "warp" ? v * 2 : v;
}
function tileValue0(g: Game, pi: number, slot: number): number {
  const p = g.players[pi];
  const x = frenzyX(g);
  let v = 0;
  if (g.traps[slot] >= 0 && g.traps[slot] !== pi && !p.fx.trapFree) v -= RULE.trapFee + 1;
  switch (kindAt(g, slot)) {
    case "blue":
      return v + (RULE.blue + p.fx.blueBonus) * x;
    case "star":
      return v + (slot === g.star ? 0 : RULE.starEmpty * x);
    case "red":
      return v - Math.max(0, RULE.red - p.fx.redCut) * x - 1;
    case "item":
      return v + (p.cards.length >= RULE.maxCards ? RULE.fullHandCoins : 5) + p.fx.itemBonus;
    case "vs":
      return v + 2 + p.fx.vsBonus / 2;
    case "trap":
      return v + (p.fx.trapFree ? 0 : -4);
    case "warp":
      return v + 6;
    case "fest":
      return v + 3.5 * RULE.festPer * (1 + p.fx.festMult);
    case "jackpot":
      return v + g.pot * (1 + p.fx.jackpotMult);
    case "event":
      return v + 2 + (p.fx.eventLuck ? 2 : 0);
    default:
      return v;
  }
}

/** 별 하나의 코인 가치 (막판일수록 큼) */
export const STAR_VALUE = 32;

/**
 * steps 칸 가면 얼마나 좋은지 (코인 단위 어림): 지나며 별 사기 + 도착 칸 + 다음 차례 별 거리.
 * extraCoins: 이번 족보로 이동 전에 받을 코인
 */
export function moveValue(g: Game, pi: number, steps: number, extraCoins = 0): number {
  const p = g.players[pi];
  const n = N(g);
  let coins = p.coins + extraCoins;
  let v = 0;
  const price = starPrice(g, pi);
  let star = g.star;
  let pos = p.pos;
  for (let i = 1; i <= steps; i++) {
    pos = (pos + 1) % n;
    if (kindAt(g, pos) === "start") {
      coins += RULE.start + p.fx.startBonus;
      v += RULE.start + p.fx.startBonus;
    }
    if (pos === star && coins >= price) {
      v += STAR_VALUE + (g.frenzy ? 8 : 0);
      coins -= price;
      star = -1; // 다음 별은 어디일지 모름
    }
  }
  v += tileValue(g, pi, pos);
  // 다음 차례: 별이 앞으로 2~12칸이면 좋음
  if (star >= 0) {
    const d = (star - pos + n) % n;
    if (d >= 2 && d <= 12) v += coins + 6 >= price ? 6 : 2;
  }
  return v;
}

/** 지금 주사위로 가장 좋은 이동 (화면 추천 · 자동 진행) */
export function bestMove(g: Game, pi: number): { pick?: number[]; n?: number; steps: number; v: number } {
  const t = g.turn!;
  const h = handOf(t.dice);
  if (h === "large") return { pick: [], steps: starDist(g, g.players[pi].pos), v: 99 };
  const extra = HANDS[h].coins * (t.dbl ? 2 : 1);
  const k = t.tri ? 3 : 2;
  let best = { pick: undefined as number[] | undefined, n: undefined as number | undefined, steps: 0, v: -1e9 };
  const sums = h === "small" ? Array.from({ length: 12 }, (_, i) => i + 1) : moveSums(t.dice, k);
  for (const s of sums) {
    const v = moveValue(g, pi, s + t.boost, extra);
    if (v > best.v) best = { pick: h === "small" ? undefined : pickFor(t.dice, k, s)!, n: h === "small" ? s : undefined, steps: s + t.boost, v };
  }
  return best;
}

/* ───────────── act ───────────── */

export function act(g: Game, pi: number, a: Action): void {
  g.ev = [];
  if (g.over) fail("끝난 판이에요");
  const pr = g.prompt;
  if (!pr || pr.p !== pi) fail("내 차례가 아니에요");
  if (++g.steps > 20_000) fail("판이 너무 길어요");
  const t = g.turn!;
  const p = g.players[pi];
  switch (a.t) {
    case "roll": {
      if (pr.k !== "turn") fail("지금은 굴릴 수 없어요");
      t.dice = Array.from({ length: t.n }, () => 0);
      t.held = Array.from({ length: t.n }, () => false);
      const lucky = rollDice(g, true);
      t.rolled = true;
      emit(g, { t: "roll", p: pi, dice: [...t.dice], held: [...t.held], re: 0, ...(a.power !== undefined && { power: a.power }), ...(lucky !== undefined && { lucky }) });
      g.prompt = { k: "dice", p: pi };
      return;
    }
    case "hold": {
      if (pr.k !== "dice") fail("지금은 잠글 수 없어요");
      const set = new Set((a.pick ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < t.n));
      t.held = t.dice.map((_, i) => set.has(i));
      emit(g, { t: "hold", p: pi, held: [...t.held] });
      return;
    }
    case "reroll": {
      if (pr.k !== "dice") fail("지금은 다시 굴릴 수 없어요");
      if (t.rolls <= 0 && p.uses.reroll <= 0) fail("다시 굴리기를 다 썼어요");
      let held = [...t.held];
      if (a.pick) {
        const set = new Set(a.pick.filter((i) => Number.isInteger(i) && i >= 0 && i < t.n));
        held = t.dice.map((_, i) => set.has(i));
      }
      while (held.length < t.n) held.push(false);
      if (held.every(Boolean)) fail("다시 굴릴 주사위를 남겨 주세요");
      t.held = held;
      if (t.rolls > 0) t.rolls--;
      else p.uses.reroll--;
      // 여섯째 주사위를 굴린 뒤에 썼으면 새 주사위는 0 → 이번에 굴림
      while (t.dice.length < t.n) t.dice.push(0);
      rollDice(g, false);
      emit(g, { t: "roll", p: pi, dice: [...t.dice], held: [...t.held], re: 1 });
      return;
    }
    case "move": {
      if (pr.k !== "dice") fail("지금은 움직일 수 없어요");
      if (t.dice.some((d) => d < 1)) fail("새 주사위를 먼저 굴려 주세요");
      const h = handOf(t.dice);
      let steps = 0;
      let jump = false;
      if (h === "large") {
        jump = true;
        steps = starDist(g, p.pos);
      } else if (a.n !== undefined && !a.pick?.length) {
        if (h !== "small") fail("스몰 스트레이트일 때만 마음대로 고를 수 있어요");
        if (!Number.isInteger(a.n) || a.n < 1 || a.n > 12) fail("1~12 중에서 골라 주세요");
        steps = a.n;
      } else {
        const k = t.tri ? 3 : 2;
        const pk = [...new Set(a.pick ?? [])];
        if (pk.length !== k) fail(`주사위 ${k}개를 골라 주세요`);
        pk.forEach((i) => dieIdx(t, i));
        steps = pk.reduce((s, i) => s + t.dice[i], 0);
      }
      if (!jump) steps += t.boost;
      if (a.d && !jump) {
        if (p.uses.slide <= 0) fail("미끄럼을 다 썼어요");
        if (a.d !== 1 && a.d !== -1) fail("한 칸만 미끄러질 수 있어요");
        p.uses.slide--;
        steps = Math.max(1, steps + a.d);
      }
      t.hand = h;
      t.mv = { steps, jump };
      g.prompt = null;
      if (rewardHand(g, pi)) return;
      afterHand(g);
      return;
    }
    case "skill":
      applySkill(g, pi, a);
      return;
    case "card":
      applyCard(g, pi, a);
      return;
    case "gear": {
      if (pr.k !== "dice") fail("굴린 뒤에 써요");
      if (p.uses.gold <= 0) fail("황금 주사위를 다 썼어요");
      const i = dieIdx(t, a.die);
      setDie(g, pi, i, face(a.n), "gear");
      p.uses.gold--;
      return;
    }
    case "target": {
      if (pr.k !== "foe") fail("지금은 고를 수 없어요");
      if (!pr.opts.includes(a.target)) fail("그 사람은 고를 수 없어요");
      g.prompt = null;
      if (pr.why === "steal") {
        lose(g, a.target, HANDS.full.steal! * (t.dbl ? 2 : 1), "steal", pi, true);
        afterHand(g);
      } else {
        resolveVs(g, pi, a.target);
        endTurn(g);
      }
      return;
    }
    case "warp": {
      if (pr.k !== "warp") fail("지금은 워프할 수 없어요");
      const tile = a.tile;
      if (!Number.isInteger(tile) || tile < 0 || tile >= N(g) || tile === p.pos || tile === g.star || kindAt(g, tile) === "warp") fail("갈 칸을 골라 주세요");
      g.prompt = null;
      teleport(g, pi, tile, "warp");
      if (land(g, pi, 2)) return;
      endTurn(g);
      return;
    }
    case "more": {
      if (pr.k !== "more") fail("지금은 못 해요");
      const n = a.n;
      if (!Number.isInteger(n) || n < 0 || n > pr.max) fail(`0~${pr.max} 중에서 골라 주세요`);
      g.prompt = null;
      if (n > 0) walk(g, pi, n, "more");
      afterMove(g);
      return;
    }
    default:
      fail("모르는 행동이에요");
  }
}

/* ───────────── 제한 시간 넘김 → 자동 ───────────── */

export function timeoutAction(g: Game): Action {
  const pr = g.prompt!;
  const pi = pr.p;
  switch (pr.k) {
    case "turn":
      return { t: "roll" };
    case "dice": {
      const b = bestMove(g, pi);
      return b.n !== undefined ? { t: "move", n: b.n } : { t: "move", pick: b.pick };
    }
    case "foe": {
      const q = [...pr.opts].sort((a, b) => g.players[b].stars - g.players[a].stars || g.players[b].coins - g.players[a].coins)[0];
      return { t: "target", target: q };
    }
    case "warp":
      return { t: "warp", tile: warpBest(g, pi) };
    case "more": {
      let best = 0;
      let bv = -1e9;
      for (let n = 0; n <= pr.max; n++) {
        const v = moveValueFrom(g, pi, n);
        if (v > bv) [bv, best] = [v, n];
      }
      return { t: "more", n: best };
    }
  }
}

/** 워프: 별 바로 뒤(다음 차례 사기 좋은 곳) 중 좋은 칸 */
export function warpBest(g: Game, pi: number): number {
  const n = N(g);
  const p = g.players[pi];
  let best = -1;
  let bv = -1e9;
  for (let s = 0; s < n; s++) {
    if (s === p.pos || s === g.star || kindAt(g, s) === "warp") continue;
    const d = (g.star - s + n) % n;
    let v = tileValue(g, pi, s);
    if (kindAt(g, s) === "vs") v = 2;
    if (d >= 2 && d <= 7) v += 10 - Math.abs(d - 5);
    if (v > bv) [bv, best] = [v, s];
  }
  return best;
}

/** 토토 0~n칸 더 — 별 사기 포함 */
function moveValueFrom(g: Game, pi: number, n: number): number {
  if (n === 0) return tileValue(g, pi, g.players[pi].pos);
  return moveValue(g, pi, n);
}
