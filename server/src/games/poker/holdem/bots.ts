import { evaluate, type Card } from "../../../../../web/src/lib/poker/cards";
import { moodOf, type Brain, type Cue, type Persona } from "../personas";
import type { ActType, HistoryItem, Legal } from "./engine";

/*
 * 홀덤 봇의 판단.
 *
 * 봇이 받는 것(BotView)은 그 자리에 앉은 사람이 볼 수 있는 것뿐: 자기 패, 바닥 카드, 각자의 칩·벳, 지금까지의 행동.
 *
 * 프리플랍  시작 패 169종의 세기 순위(시뮬레이션으로 만든 표)를 자리·앞사람 행동·스택 깊이에 맞춘 범위와 비교
 * 플랍 이후  상대가 "그렇게 쳤다면 들고 있을 만한 패"의 분포(레인지)를 만들고, 그 레인지 상대로 내 승률을 계산
 *            → 받을 때는 팟 오즈와 비교, 걸 때는 승률·보드 성격·주도권·자리로 크기와 빈도를 정함
 * 성격(Persona)이 범위·빈도·기준을 움직이고, 단계(Skill)가 계산의 정확도와 읽기의 깊이를 정함.
 */

export interface BotPlayer {
  seat: number;
  /** 상대 기록을 쌓는 이름표 (사람은 uid, 봇은 bot:id) */
  key: string;
  stack: number;
  bet: number;
  invested: number;
  folded: boolean;
  allIn: boolean;
}

export interface BotView {
  seat: number;
  cards: [Card, Card];
  board: Card[];
  street: number;
  pot: number;
  sb: number;
  bb: number;
  unit: number;
  currentBet: number;
  legal: Legal;
  button: number;
  sbSeat: number;
  bbSeat: number;
  players: BotPlayer[];
  history: HistoryItem[];
}

export interface Decision {
  type: ActType;
  amount?: number;
  thinkMs: number;
  cue?: Cue;
}

// ───────────── 시작 패 순위표 ─────────────
// 169종을 무작위 상대 1·2·4명 상대 승률로 줄 세운 것. 값 = 이 패보다 센 패의 비율(천분율, 0 = AA).
// 위치: 페어 r*13+r · 같은 무늬 hi*13+lo · 다른 무늬 lo*13+hi (r = 0(2) … 12(A))
// prettier-ignore
const PCT = [560,995,968,959,977,986,950,905,836,760,691,538,377,872,441,932,896,941,923,914,887,811,730,624,502,332,842,748,310,821,848,857,878,866,769,703,591,469,294,805,709,609,218,778,739,799,787,721,643,529,431,255,827,745,664,582,132,682,670,658,633,615,511,395,279,830,751,649,585,487,85,600,567,551,520,457,359,246,793,754,697,576,490,425,35,478,419,410,386,317,196,712,715,676,557,493,401,338,25,350,303,270,237,169,652,606,573,544,448,368,288,214,20,208,184,139,104,579,496,484,463,445,341,261,202,128,16,151,113,72,451,437,404,365,326,323,222,163,119,98,11,92,57,371,344,285,264,231,228,175,125,78,66,51,7,45,225,190,178,160,157,145,122,81,63,39,32,29,2];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 시작 패의 세기 (0 = 가장 셈 … 1 = 가장 약함) */
export function handPct(c1: Card, c2: Card): number {
  const r1 = c1 >> 2;
  const r2 = c2 >> 2;
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const idx = hi === lo || (c1 & 3) === (c2 & 3) ? hi * 13 + lo : lo * 13 + hi;
  return PCT[idx] / 1000;
}

// 두 장 조합 1326가지
const CA = new Uint8Array(1326);
const CB = new Uint8Array(1326);
const CP = new Float32Array(1326);
{
  let i = 0;
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++) {
      CA[i] = a;
      CB[i] = b;
      CP[i] = handPct(a, b);
      i++;
    }
}

function gauss(rand: () => number): number {
  // 대충 정규분포 (세 번 더해서)
  return (rand() + rand() + rand() - 1.5) * 1.15;
}

// ───────────── 상대 기록 ─────────────

interface Stat {
  hands: number;
  /** 돈을 자진해서 넣고 들어온 판 */
  vpip: number;
  /** 프리플랍에 레이즈한 판 */
  pfr: number;
  /** 플랍 이후 벳·레이즈 / 콜 횟수 */
  bets: number;
  calls: number;
  /** 플랍 이후 벳을 마주한 횟수와 그때 죽은 횟수 */
  faced: number;
  folded: number;
}

/** 테이블에 앉은 사람들이 어떻게 치는지 (모두가 볼 수 있는 행동만 셈). 테이블의 봇들이 같이 봄 */
export class Models {
  private stats = new Map<string, Stat>();

  private of(key: string): Stat {
    let s = this.stats.get(key);
    if (!s) this.stats.set(key, (s = { hands: 0, vpip: 0, pfr: 0, bets: 0, calls: 0, faced: 0, folded: 0 }));
    return s;
  }

  /** 판이 끝난 뒤 그 판의 기록을 쌓음 */
  observe(history: HistoryItem[], keyOf: (seat: number) => string | undefined, seats: number[]) {
    for (const seat of seats) {
      const key = keyOf(seat);
      if (!key) continue;
      const s = this.of(key);
      const mine = history.filter((h) => h.seat === seat);
      s.hands++;
      if (mine.some((h) => h.street === 0 && (h.type === "call" || h.type === "raise"))) s.vpip++;
      if (mine.some((h) => h.street === 0 && h.type === "raise")) s.pfr++;
      for (const h of mine) {
        if (h.street === 0) continue;
        if (h.type === "raise") s.bets++;
        if (h.type === "call") s.calls++;
        if (h.toCallBefore > 0) {
          s.faced++;
          if (h.type === "fold") s.folded++;
        }
      }
    }
    if (this.stats.size > 200) this.stats.clear();
  }

  /** 들어오는 폭 (1 = 보통). 기록이 적을 때는 보통 쪽으로 당김 */
  loose(key: string): number {
    const s = this.stats.get(key);
    if (!s) return 1;
    return clamp((s.vpip + 0.28 * 10) / (s.hands + 10) / 0.28, 0.6, 2.2);
  }
  /** 블러프가 섞인 정도 (1 = 보통): 걸기만 하고 잘 안 받는 사람일수록 큼 */
  bluffy(key: string): number {
    const s = this.stats.get(key);
    if (!s) return 1;
    return clamp((s.bets + 3) / (s.calls + 3), 0.5, 2);
  }
  /** 벳을 맞으면 죽는 비율 */
  foldy(key: string): number {
    const s = this.stats.get(key);
    if (!s) return 0.45;
    return (s.folded + 0.45 * 8) / (s.faced + 8);
  }
}

// ───────────── 보드 읽기 ─────────────

const cntS = new Int8Array(4);
/** 드로우 아웃 수 어림 (플러시 드로우 9, 양방 8, 빵꾸 4) — 이미 완성된 건 0 */
function drawOuts(cards: Card[]): number {
  cntS.fill(0);
  let mask = 0;
  for (const c of cards) {
    cntS[c & 3]++;
    mask |= 1 << (c >> 2);
  }
  let flush = 0;
  for (let s = 0; s < 4; s++) {
    if (cntS[s] >= 5) return 0;
    if (cntS[s] === 4) flush = 9;
  }
  const made = (m: number) => {
    for (let h = 12; h >= 4; h--) if (((m >> (h - 4)) & 0x1f) === 0x1f) return true;
    return (m & 0x100f) === 0x100f;
  };
  if (made(mask)) return flush;
  let comp = 0;
  for (let r = 0; r < 13; r++) if (!(mask & (1 << r)) && made(mask | (1 << r))) comp++;
  const straight = comp >= 2 ? 8 : comp === 1 ? 4 : 0;
  return Math.min(15, flush + straight - (flush && straight ? 2 : 0));
}

/** 보드가 젖었는지 (드로우가 많이 깔린 보드): 0 마름 … 1 흠뻑 */
function wetness(board: Card[]): number {
  cntS.fill(0);
  const ranks: number[] = [];
  for (const c of board) {
    cntS[c & 3]++;
    ranks.push(c >> 2);
  }
  const suited = Math.max(cntS[0], cntS[1], cntS[2], cntS[3]);
  ranks.sort((a, b) => a - b);
  let close = 0;
  for (let i = 1; i < ranks.length; i++) if (ranks[i] - ranks[i - 1] <= 2 && ranks[i] !== ranks[i - 1]) close++;
  return clamp((suited >= 3 ? 0.6 : suited === 2 ? 0.3 : 0) + close * 0.2, 0, 1);
}

// ───────────── 상대 레인지 ─────────────

/** 프리플랍 행동으로 본 패 분포: x = 패의 세기(0 셈 … 1 약함) → 그 패를 들고 있을 만한 정도 */
function preflopWeight(kind: string, x: number): number {
  switch (kind) {
    case "check": // BB 가 그냥 봄: 아무 패나, 센 패는 올렸을 테니 적게
      return x < 0.12 ? 0.35 : 1;
    case "limp":
      return x < 0.1 ? 0.3 : x < 0.6 ? 1 : x < 0.85 ? 0.2 : 0.06;
    case "call": // 레이즈를 콜
      return x < 0.04 ? 0.35 : x < 0.3 ? 1 : x < 0.45 ? 0.4 : 0.08;
    case "call3": // 3벳을 콜
      return x < 0.02 ? 0.5 : x < 0.1 ? 1 : x < 0.18 ? 0.3 : 0.03;
    case "open":
      return x < 0.22 ? 1 : x < 0.35 ? 0.5 : x < 0.5 ? 0.1 : 0.02;
    case "3bet":
      return x < 0.07 ? 1 : x < 0.25 ? 0.35 : 0.03;
    default: // 4벳 이상
      return x < 0.035 ? 1 : x < 0.1 ? 0.15 : 0.01;
  }
}

/** 그 사람이 프리플랍에 어떻게 들어왔는지 */
function preflopKind(history: HistoryItem[], seat: number): string {
  let raises = 0;
  let kind = "check";
  for (const h of history) {
    if (h.street !== 0) break;
    if (h.type === "raise") {
      raises++;
      if (h.seat === seat) kind = raises === 1 ? "open" : raises === 2 ? "3bet" : "4bet";
    } else if (h.type === "call" && h.seat === seat) {
      kind = raises === 0 ? "limp" : raises === 1 ? "call" : "call3";
    }
  }
  return kind;
}

interface Villain {
  seat: number;
  key: string;
  w: Float32Array;
  cum: Float64Array;
  total: number;
}

interface Read {
  villains: Villain[];
  /** 지금 보드에서 내 패가 전체 조합 중 어디쯤인지 (1 = 최강) */
  myQ: number;
  valid: Uint8Array;
}

const scoreBuf = new Int32Array(1326);
const sortBuf = new Int32Array(1326);

/** 지금 보드에서 각 조합의 세기 순위(0~1)와 드로우 여부 */
function strengths(board: Card[], valid: Uint8Array, withDraws: boolean) {
  const q = new Float32Array(1326);
  const draw = new Uint8Array(1326);
  let n = 0;
  const cards = [0, 0, ...board];
  for (let i = 0; i < 1326; i++) {
    if (!valid[i]) continue;
    cards[0] = CA[i];
    cards[1] = CB[i];
    const s = evaluate(cards);
    scoreBuf[i] = s;
    sortBuf[n++] = s;
    if (withDraws && drawOuts(cards) >= 8) draw[i] = 1;
  }
  const sorted = sortBuf.subarray(0, n).sort();
  const rank = (s: number) => {
    // s 보다 작은 것의 수 + 같은 것의 절반
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sorted[m] < s) lo = m + 1;
      else hi = m;
    }
    let up = lo;
    let hi2 = n;
    while (up < hi2) {
      const m = (up + hi2) >> 1;
      if (sorted[m] <= s) up = m + 1;
      else hi2 = m;
    }
    return (lo + up) / 2 / n;
  };
  for (let i = 0; i < 1326; i++) if (valid[i]) q[i] = rank(scoreBuf[i]);
  return { q, draw, rank };
}

/** 큰 돈을 받을지 따질 때: 서툰 봇도 "크게 미는 사람의 패"는 좁게 읽음 (읽기 깊이 최소 0.85) */
function bigCallBrain(brain: Brain): Brain {
  if (brain.skill.read >= 0.85) return brain;
  return { ...brain, skill: { ...brain.skill, read: 0.85, adapt: Math.max(brain.skill.adapt, 0.5) } };
}

function readTable(v: BotView, brain: Brain, models: Models): Read {
  const skill = brain.skill;
  const dead = new Uint8Array(52);
  dead[v.cards[0]] = 1;
  dead[v.cards[1]] = 1;
  for (const c of v.board) dead[c] = 1;
  const valid = new Uint8Array(1326);
  for (let i = 0; i < 1326; i++) valid[i] = dead[CA[i]] || dead[CB[i]] ? 0 : 1;

  const live = v.players.filter((p) => !p.folded && p.seat !== v.seat);
  const villains: Villain[] = live.map((p) => {
    const kind = preflopKind(v.history, p.seat);
    const L = 1 + (models.loose(p.key) - 1) * skill.adapt;
    const w = new Float32Array(1326);
    for (let i = 0; i < 1326; i++) if (valid[i]) w[i] = preflopWeight(kind, CP[i] / L);
    return { seat: p.seat, key: p.key, w, cum: new Float64Array(1326), total: 0 };
  });

  let myQ = 0.5;
  // 플랍부터 지금까지, 구간마다 "그 보드에서 그렇게 쳤다면" 으로 좁힘
  for (let st = 1; st <= v.street; st++) {
    const board = v.board.slice(0, st + 2);
    const acts = v.history.filter((h) => h.street === st && h.seat !== v.seat);
    const last = st === v.street;
    if (!acts.length && !last) continue;
    const { q, draw, rank } = strengths(board, valid, st < 3);
    if (last) myQ = rank(evaluate([...v.cards, ...board]));
    for (const h of acts) {
      const vil = villains.find((x) => x.seat === h.seat);
      if (!vil) continue;
      const bluffy = 1 + (models.bluffy(vil.key) - 1) * skill.adapt;
      if (h.type === "raise") {
        const rho = Math.min(1.2, h.add / Math.max(1, h.potBefore));
        const isRaise = h.toCallBefore > 0;
        const tau = 0.6 + (0.22 * rho) / 1.2 + (isRaise ? 0.08 : 0) + (st === 3 ? 0.04 : 0);
        const air = clamp(0.15 * bluffy * (isRaise ? 0.5 : 1), 0.04, 0.45);
        for (let i = 0; i < 1326; i++) {
          if (!vil.w[i]) continue;
          const s = q[i];
          vil.w[i] *= s >= tau ? 1 : draw[i] ? 0.6 : s >= 0.45 ? 0.2 : air;
        }
      } else if (h.type === "check") {
        for (let i = 0; i < 1326; i++) if (vil.w[i]) vil.w[i] *= q[i] >= 0.85 ? 0.35 : q[i] >= 0.65 ? 0.7 : 1;
      } else if (h.type === "call") {
        for (let i = 0; i < 1326; i++) {
          if (!vil.w[i]) continue;
          const s = q[i];
          vil.w[i] *= s >= 0.92 ? 0.5 : s >= 0.35 ? 1 : draw[i] ? 0.9 : 0.12;
        }
      }
    }
  }

  // 읽기의 깊이: 얕으면 "아무 패나" 쪽으로 섞음
  for (const vil of villains) {
    let max = 0;
    for (let i = 0; i < 1326; i++) if (vil.w[i] > max) max = vil.w[i];
    let acc = 0;
    for (let i = 0; i < 1326; i++) {
      if (valid[i]) {
        const w = max > 0 ? vil.w[i] / max : 1;
        vil.w[i] = 1 - skill.read + skill.read * w;
        acc += vil.w[i];
      }
      vil.cum[i] = acc;
    }
    vil.total = acc;
  }
  return { villains, myQ, valid };
}

const usedAt = new Int32Array(52);
let stamp = 0;

/** 상대 레인지 상대로 끝까지 갔을 때 내가 이길 확률 (비기면 나눠 가짐) */
function equity(v: BotView, read: Read, sims: number, rand: () => number): number {
  const { villains } = read;
  if (!villains.length) return 1;
  const board = v.board;
  const mine = [v.cards[0], v.cards[1], 0, 0, 0, 0, 0];
  const theirs = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < board.length; i++) mine[2 + i] = theirs[2 + i] = board[i];

  // 리버에서 한 명 상대면 전부 따져 봄
  if (board.length === 5 && villains.length === 1) {
    const me = evaluate(mine);
    const vil = villains[0];
    let win = 0;
    for (let i = 0; i < 1326; i++) {
      const w = vil.w[i];
      if (!w || !read.valid[i]) continue;
      theirs[0] = CA[i];
      theirs[1] = CB[i];
      const s = evaluate(theirs);
      win += me > s ? w : me === s ? w / 2 : 0;
    }
    return vil.total > 0 ? win / vil.total : 0.5;
  }

  const pick = (vil: Villain): number => {
    const t = rand() * vil.total;
    let lo = 0;
    let hi = 1325;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (vil.cum[m] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const free = (): Card => {
    for (;;) {
      const c = Math.floor(rand() * 52);
      if (usedAt[c] !== stamp) {
        usedAt[c] = stamp;
        return c;
      }
    }
  };

  const holes = new Int32Array(villains.length * 2);
  let total = 0;
  for (let it = 0; it < sims; it++) {
    if (++stamp > 2_000_000_000) {
      stamp = 1;
      usedAt.fill(0);
    }
    usedAt[v.cards[0]] = usedAt[v.cards[1]] = stamp;
    for (const c of board) usedAt[c] = stamp;
    for (let k = 0; k < villains.length; k++) {
      let a = -1;
      let b = -1;
      for (let tries = 0; tries < 6; tries++) {
        const i = pick(villains[k]);
        if (usedAt[CA[i]] !== stamp && usedAt[CB[i]] !== stamp) {
          a = CA[i];
          b = CB[i];
          break;
        }
      }
      if (a < 0) {
        a = free();
        b = free();
      } else usedAt[a] = usedAt[b] = stamp;
      holes[k * 2] = a;
      holes[k * 2 + 1] = b;
    }
    for (let i = board.length; i < 5; i++) mine[2 + i] = theirs[2 + i] = free();
    const me = evaluate(mine);
    let best = -1;
    let ties = 0;
    for (let k = 0; k < villains.length; k++) {
      theirs[0] = holes[k * 2];
      theirs[1] = holes[k * 2 + 1];
      const s = evaluate(theirs);
      if (s > best) {
        best = s;
        ties = 1;
      } else if (s === best) ties++;
    }
    if (me > best) total += 1;
    else if (me === best) total += 1 / (ties + 1);
  }
  return total / sims;
}

// ───────────── 금액 ─────────────

/** 보기 좋은 금액으로 (SB 단위), 규칙 범위 안으로. 칩이 얼마 안 남으면 올인 */
function sizeTo(v: BotView, target: number): number {
  const { minTo, maxTo } = v.legal;
  const step = Math.max(v.unit, v.sb);
  let to = Math.round(target / step) * step;
  to = clamp(to, minTo, maxTo);
  // 걸고 나서 남는 칩이 건 돈의 1/3 도 안 되면 그냥 다 넣음
  const me = v.players.find((p) => p.seat === v.seat)!;
  const left = maxTo - to;
  if (left < (to - me.bet) * 0.34) to = maxTo;
  return to;
}

const pick = (rand: () => number, lo: number, hi: number) => lo + (hi - lo) * rand();

// ───────────── 프리플랍 ─────────────

function preflopOrder(v: BotView): number[] {
  const seats = v.players.map((p) => p.seat);
  const n = seats.length;
  const start = n === 2 ? seats.indexOf(v.sbSeat) : (seats.indexOf(v.bbSeat) + 1) % n;
  return seats.map((_, i) => seats[(start + i) % n]);
}

function preflop(v: BotView, brain: Brain, models: Models): Decision {
  const p = moodOf(brain);
  const r = brain.rand;
  const me = v.players.find((x) => x.seat === v.seat)!;
  const pct = clamp(handPct(v.cards[0], v.cards[1]) + gauss(r) * brain.skill.noise * 0.5, 0, 1);
  const order = preflopOrder(v);
  const behind = order.length - 1 - order.indexOf(v.seat);
  const hist = v.history.filter((h) => h.street === 0);
  const raises = hist.filter((h) => h.type === "raise");
  const limpers = hist.filter((h) => h.type === "call" && !raises.length).length;
  const { toCall, canCheck, canRaise } = v.legal;
  const need = toCall > 0 ? toCall / (v.pot + toCall) : 0;
  const others = v.players.filter((x) => !x.folded && x.seat !== v.seat);
  const eff = Math.min(me.stack + me.bet, Math.max(...others.map((x) => x.stack + x.bet)));
  const effBB = eff / v.bb;
  const r1 = v.cards[0] >> 2;
  const r2 = v.cards[1] >> 2;
  const pair = r1 === r2;
  const suited = (v.cards[0] & 3) === (v.cards[1] & 3);
  const speculative = pair || (suited && Math.abs(r1 - r2) <= 2);
  const fast = (lo: number, hi: number) => Math.round(pick(r, lo, hi) * p.pace);
  const fold = (): Decision =>
    canCheck ? { type: "check", thinkMs: fast(600, 1300) } : { type: "fold", thinkMs: fast(600, 1500), cue: toCall > 12 * v.bb ? "bigFold" : undefined };
  const raiseTo = (to: number, cue?: Cue): Decision => {
    if (!canRaise) return toCall > 0 ? { type: "call", thinkMs: fast(900, 2000) } : { type: "check", thinkMs: fast(700, 1400) };
    const amount = sizeTo(v, to);
    const all = amount === v.legal.maxTo;
    return { type: "raise", amount, thinkMs: fast(all ? 2200 : 1100, all ? 4200 : 2600), cue: all ? "allin" : cue };
  };

  // 상대가 올인했거나 받으면 내 칩의 큰 몫이 들어가는 자리 → 상대 레인지 상대 승률로 판단
  // (크게 미는 사람은 아무 패나 들고 있지 않다고 보고, 잡패로 스택을 걸지 않게)
  if (toCall > 0 && (toCall >= me.stack * 0.4 || !canRaise) && raises.length) {
    const read = readTable(v, bigCallBrain(brain), models);
    const eq = equity(v, read, brain.skill.sims, r) + gauss(r) * Math.min(brain.skill.noise, 0.03);
    const risk = Math.min(1, toCall / Math.max(1, me.stack));
    // 칩의 큰 몫이면: 성격이 아무리 헐거워도 거의 손해 없는 기준 + 걸리는 몫만큼 더 조심
    const margin = Math.max(p.callMargin, -0.02) + 0.02 + 0.06 * risk;
    // 잡패 바닥: 싸게 받는 게 아니면(팟 오즈 35% 이상) 상위 32% 밖 패로는 안 받음
    const junk = need >= 0.35 && pct > 0.32;
    const ok = !junk && eq >= need + margin;
    return ok ? { type: "call", thinkMs: fast(2200, 4800), cue: toCall >= me.stack ? "allin" : "call" } : { ...fold(), thinkMs: fast(1800, 3600) };
  }

  // ── 아직 아무도 안 올림 ──
  if (!raises.length) {
    const base = order.length === 2 ? 0.7 : [0.5, 0.48, 0.4, 0.27, 0.19, 0.15][Math.min(5, behind)];
    const open = Math.min(0.95, base * p.loose * Math.pow(0.9, limpers));
    // 칩이 얼마 없으면 밀거나 죽거나
    if (effBB <= 12) {
      const push = Math.min(0.9, [0.6, 0.5, 0.36, 0.27, 0.21, 0.17][Math.min(5, behind)] * Math.pow(12 / Math.max(3, effBB), 0.5) * (0.8 + 0.2 * p.loose));
      if (pct < push) return raiseTo(v.legal.maxTo);
      return fold();
    }
    if (pct < open) {
      if (pct < open * 0.25 || r() < p.raiseShare) {
        const fromBlind = v.seat === v.sbSeat || v.seat === v.bbSeat;
        const bbs = (order.length === 2 ? 2.3 : fromBlind ? 3 : 2.5) + limpers;
        return raiseTo(bbs * v.bb * p.sizing, "raise");
      }
      return toCall > 0 ? { type: "call", thinkMs: fast(900, 1900) } : { type: "check", thinkMs: fast(700, 1400) };
    }
    // 따라 들어오기: 느슨한 성격은 넓게, SB 는 싸니까 넓게
    const cheap = toCall > 0 && toCall <= v.bb;
    const fun = brain.skill.fun;
    let limp = v.seat === v.sbSeat ? Math.min(0.78, open * 1.6) : p.raiseShare < 0.5 ? open * 1.3 : speculative && limpers ? open * 1.25 : 0;
    // 재미 보정: 싸게 볼 수 있으면 "한 번 보자" — 여럿이 들어와 있으면 더 (동네판은 거의 다 들어감)
    limp = Math.max(limp, open * (1.2 + 0.7 * fun) * (limpers >= 2 ? 1 + 0.2 * fun : 1));
    if (cheap && pct < limp) return { type: "call", thinkMs: fast(900, 1900) };
    return fold();
  }

  // ── 누가 올림 ──
  const last = raises[raises.length - 1];
  const raiser = v.players.find((x) => x.seat === last.seat)!;
  const L = 1 + (models.loose(raiser.key) - 1) * brain.skill.adapt;
  const raiseBB = v.currentBet / v.bb;
  const myRaises = raises.filter((h) => h.seat === v.seat).length;
  const oddsFactor = clamp(Math.pow(0.3 / Math.max(0.05, need), 0.6), 0.5, 1.8);
  const deepBonus = speculative && effBB >= 40 && need < 0.3 ? 1.25 : 1;
  const inBlind = v.seat === v.bbSeat || v.seat === v.sbSeat;

  if (raises.length === 1 && !myRaises) {
    const R = clamp(0.22 * L, 0.08, 0.6);
    const sizeAdj = clamp(Math.sqrt(3 / Math.max(2, raiseBB)), 0.6, 1.15);
    const value = Math.min(0.09, R * 0.22) * (0.7 + 0.3 * p.reraise);
    if (effBB <= 14) {
      if (pct < Math.max(value, 0.07 * Math.sqrt(14 / Math.max(4, effBB)) * L)) return raiseTo(v.legal.maxTo);
      return fold();
    }
    if (pct < value) {
      if (r() < p.slowplay * 0.6) return { type: "call", thinkMs: fast(1300, 2600) };
      return raiseTo(v.currentBet * (inBlind ? 3.7 : 3.1) * p.sizing, "bigRaise");
    }
    // 가끔 가볍게 다시 올림 (콜하기엔 애매한 패로)
    if (pct > R * 0.85 && pct < R * 1.5 && r() < 0.07 * p.reraise * (behind === 0 ? 1.3 : 1)) return raiseTo(v.currentBet * (inBlind ? 3.7 : 3.1) * p.sizing, "bigRaise");
    const callThr = R * 0.85 * sizeAdj * oddsFactor * (0.75 + 0.25 * p.loose) * deepBonus - p.callMargin * 1.5;
    if (pct < callThr) return { type: "call", thinkMs: fast(1000, 2200), cue: "call" };
    return fold();
  }

  // ── 다시 올린 판 (3벳 이상) ──
  const premium = 0.024 * (0.8 + 0.2 * p.reraise);
  if (pct < premium) {
    if (raises.length >= 3 || v.currentBet * 2.3 >= eff * 0.4) return raiseTo(v.legal.maxTo);
    if (r() < p.slowplay) return { type: "call", thinkMs: fast(1500, 3000) };
    return raiseTo(v.currentBet * 2.3, "bigRaise");
  }
  const opened = myRaises > 0;
  const callThr = (opened ? 0.075 : 0.055) * clamp(L, 0.8, 1.6) * oddsFactor * deepBonus * (0.8 + 0.2 * p.loose) - p.callMargin;
  if (raises.length === 2 && pct < callThr) return { type: "call", thinkMs: fast(1400, 3000), cue: "call" };
  return { ...fold(), thinkMs: fast(900, 2200) };
}

// ───────────── 플랍 이후 ─────────────

function postflop(v: BotView, brain: Brain, models: Models): Decision {
  const p: Persona = moodOf(brain);
  const r = brain.rand;
  const me = v.players.find((x) => x.seat === v.seat)!;
  const { toCall, canRaise, maxTo } = v.legal;
  // 칩의 큰 몫이 걸린 벳을 받을 때는 상대 레인지를 제대로 읽음 (크게 거는 사람은 아무 패나 아님)
  const heavy = v.legal.toCall >= me.stack * 0.4;
  const read = readTable(v, heavy ? bigCallBrain(brain) : brain, models);
  const live = read.villains;
  const n = live.length;
  const eq = clamp(equity(v, read, brain.skill.sims, r) + gauss(r) * (heavy ? Math.min(brain.skill.noise, 0.03) : brain.skill.noise), 0, 1);
  const outs = v.street < 3 ? drawOuts([...v.cards, ...v.board]) : 0;
  const wet = wetness(v.board);
  const pot = v.pot;
  const others = v.players.filter((x) => !x.folded && x.seat !== v.seat);
  const eff = Math.min(me.stack, Math.max(0, ...others.map((x) => x.stack + x.bet - me.bet)));
  const spr = eff / Math.max(1, pot);
  const river = v.street === 3;
  const think = (lo: number, hi: number) => Math.round(pick(r, lo, hi) * p.pace);

  // 자리: 이번 구간에 내 뒤로 행동할 사람이 없으면 유리한 자리
  const seats = v.players.map((x) => x.seat);
  const fromBtn = seats.map((_, i) => seats[(seats.indexOf(v.button) + 1 + i) % seats.length]);
  const liveOrder = fromBtn.filter((s) => !v.players.find((x) => x.seat === s)!.folded);
  const inPosition = liveOrder[liveOrder.length - 1] === v.seat;
  // 주도권: 직전 구간에 마지막으로 건 사람이 나
  const prev = v.history.filter((h) => h.street === v.street - 1 && h.type === "raise");
  const initiative = prev.length > 0 && prev[prev.length - 1].seat === v.seat;

  // ── 벳을 마주함 ──
  if (toCall > 0) {
    const need = toCall / (pot + toCall);
    const hist = v.history.filter((h) => h.street === v.street && h.type === "raise");
    const aggr = hist.length ? v.players.find((x) => x.seat === hist[hist.length - 1].seat) : undefined;
    const grudge = aggr ? (brain.grudge.get(aggr.key) ?? 0) : 0;
    const big = toCall >= pot * 0.45 || toCall >= me.stack * 0.5;
    const commitBB = (me.invested + toCall) / v.bb;
    // 받는 기준: 팟 오즈 + 성격 + 여럿이면 조심 − 앙금 − 드로우의 뒷심
    // (리버 전에는 뒤에 또 돈이 들어가고, 자리가 나쁘면 승률만큼 못 챙기므로 조금 더 높게)
    let margin = p.callMargin + 0.03 * (n - 1) - 0.03 * grudge + (river ? 0.02 : inPosition ? 0.045 : 0.065);
    // 재미 보정: 작은 벳은 "한 장 더 보자"며 잘 받아 줌 (리버 전, 스택에 비해 싸게 볼 때)
    if (!river && toCall <= pot * 0.35 && toCall < me.stack * 0.12) margin -= 0.05 * brain.skill.fun;
    // 판이 아주 커질 때는 애매한 패로 스택을 걸지 않음
    if (commitBB > 120 && read.myQ < 0.93) margin += 0.07;
    // 칩의 큰 몫을 받는 자리(올인 받기 등): 헐거운 성격 · 기분 보정은 거의 빼고, 걸리는 몫만큼 더 조심
    const risk = Math.min(1, toCall / Math.max(1, me.stack));
    if (risk >= 0.4) margin = Math.max(margin, 0.02) + 0.05 * risk;
    const implied = !river && spr > 2 ? (outs >= 8 ? 0.06 : outs >= 4 && spr > 4 ? 0.02 : 0) : 0;

    const valueThr = 0.72 + 0.04 * (n - 1) + p.valueShift;
    if (canRaise && eq >= valueThr && !(commitBB > 120 && read.myQ < 0.93 && eq < 0.8)) {
      // 아주 센 패는 가끔 콜만 하며 숨김
      if (!river && eq > 0.88 && r() < p.slowplay) return { type: "call", thinkMs: think(1500, 3200) };
      const to = v.currentBet + (pot + toCall) * pick(r, 0.6, 0.95) * p.sizing;
      const amount = sizeTo(v, to);
      return { type: "raise", amount, thinkMs: think(1800, 4000), cue: amount === maxTo ? "allin" : "bigRaise" };
    }
    // 드로우로 되받아침
    if (canRaise && !river && outs >= 8 && spr > 1.5 && r() < p.semiBluff * 0.7) {
      const amount = sizeTo(v, v.currentBet + (pot + toCall) * pick(r, 0.6, 0.85));
      return { type: "raise", amount, thinkMs: think(1800, 3800), cue: amount === maxTo ? "allin" : "raise" };
    }
    // 순수 블러프 레이즈: 한 명 상대로 아주 가끔, 잘 죽는 사람에게
    if (canRaise && n === 1 && eq < 0.3 && !big && r() < 0.035 * p.bluff * (models.foldy(live[0].key) / 0.45)) {
      const amount = sizeTo(v, v.currentBet + (pot + toCall) * pick(r, 0.7, 1));
      return { type: "raise", amount, thinkMs: think(2200, 4500), cue: "bigRaise" };
    }
    if (eq + implied >= need + margin) {
      const hero = big && eq < 0.55;
      return { type: "call", thinkMs: think(big ? 2200 : 1100, big ? 5200 : 2600), cue: toCall >= me.stack ? "allin" : hero ? "heroCall" : "call" };
    }
    return { type: "fold", thinkMs: think(big ? 1800 : 900, big ? 4200 : 2200), cue: big && eq > 0.3 ? "bigFold" : "fold" };
  }

  // ── 내가 걸 수 있음 (앞에 벳 없음) ──
  if (!canRaise) return { type: "check", thinkMs: think(700, 1500) };
  const bet = (frac: number, cue?: Cue): Decision => {
    const amount = sizeTo(v, pot * frac * p.sizing);
    return { type: "raise", amount, thinkMs: think(1300, 3200), cue: amount === maxTo ? "allin" : cue };
  };
  const valueThr = 0.62 + 0.05 * (n - 1) + p.valueShift;
  if (eq >= valueThr) {
    // 덫: 아주 센 패, 마른 보드, 뒤에 걸어 줄 사람이 있을 때
    if (!river && eq > 0.85 && wet < 0.5 && !inPosition && r() < p.slowplay) return { type: "check", thinkMs: think(1200, 2600), cue: "check" };
    if (spr < 1.3) return bet(spr + 0.5, "raise");
    if (river) {
      if (eq > 0.86) return bet(r() < 0.18 * p.sizing ? pick(r, 1.1, 1.5) : pick(r, 0.7, 1), "bigRaise");
      return bet(eq > 0.74 ? pick(r, 0.5, 0.7) : pick(r, 0.3, 0.45));
    }
    return bet(wet > 0.45 ? pick(r, 0.62, 0.8) : pick(r, 0.33, 0.55), "raise");
  }
  // 드로우로 먼저 침
  if (!river && outs >= 8 && r() < p.semiBluff * (initiative ? 1.4 : 1) * (n === 1 ? 1 : 0.6)) return bet(pick(r, 0.5, 0.7), "raise");
  // 블러프: 주도권·자리·상대 수·상대가 얼마나 잘 죽는지
  if (eq < 0.42) {
    const foldy = live.reduce((a, x) => a * clamp(models.foldy(x.key) / 0.45, 0.5, 1.6), 1);
    const base = initiative ? (v.street === 1 ? 0.55 * p.cbet : 0.38 * p.cbet) : 0.16;
    const crowd = n === 1 ? 1 : n === 2 ? 0.35 : 0.1;
    const freq = base * p.bluff * crowd * (inPosition ? 1.2 : 0.85) * (river ? 0.6 : 1) * (1 + (foldy - 1) * brain.skill.adapt);
    if (r() < freq) {
      if (river) return bet(pick(r, 0.66, 1), "bigRaise");
      return bet(v.street === 1 ? (wet > 0.45 ? pick(r, 0.5, 0.66) : pick(r, 0.3, 0.45)) : pick(r, 0.6, 0.75), "raise");
    }
  }
  return { type: "check", thinkMs: think(800, 2000) };
}

export function decideHoldem(v: BotView, brain: Brain, models: Models): Decision {
  const d = v.street === 0 ? preflop(v, brain, models) : postflop(v, brain, models);
  // 규칙 밖의 결정이 나오지 않게 한 번 더 맞춤
  const lg = v.legal;
  if (d.type === "check" && !lg.canCheck) return { ...d, type: lg.toCall > 0 ? "fold" : "check" };
  if (d.type === "fold" && lg.canCheck) return { ...d, type: "check", cue: undefined };
  if (d.type === "call" && lg.canCheck) return { ...d, type: "check", cue: undefined };
  if (d.type === "raise") {
    if (!lg.canRaise) return { ...d, type: lg.toCall > 0 ? "call" : "check", amount: undefined };
    d.amount = clamp(d.amount ?? lg.minTo, lg.minTo, lg.maxTo);
  }
  return d;
}
