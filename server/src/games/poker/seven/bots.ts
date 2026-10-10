import { evaluate, type Card } from "../../../../../web/src/lib/poker/cards";
import { autoChoice } from "../../../../../web/src/lib/poker/seven";
import { moodOf, type Brain, type Cue } from "../personas";
import type { SevenAct, SevenBet, SevenHistory, SevenLegal } from "./engine";

/*
 * 7포커 봇의 판단. 봇이 보는 것: 자기 카드 전부, 모두의 펴 놓은 카드, 각자의 칩·벳, 지금까지의 행동.
 *
 * 남은 카드를 무작위로 채워 가며 끝까지 갔을 때 내가 이길 확률을 계산함.
 * 세게 친 상대는 엎은 카드가 좋을 가능성이 높으므로, 그 사람의 엎은 카드는 여러 번 뽑아 좋은 쪽을 씀(읽기).
 * 받을 때는 팟 오즈와 비교, 걸 때는 승률에 맞는 크기(삥 · 따당 · 쿼터 · 하프 · 풀)를 고름.
 */

export interface SevenBotPlayer {
  seat: number;
  key: string;
  up: Card[];
  folded: boolean;
  allIn: boolean;
  stack: number;
  bet: number;
  invested: number;
}

export interface SevenBotView {
  seat: number;
  cards: Card[];
  round: number;
  pot: number;
  ante: number;
  legal: SevenLegal;
  players: SevenBotPlayer[];
  history: SevenHistory[];
}

export interface SevenDecision {
  type: SevenAct;
  thinkMs: number;
  cue?: Cue;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const gauss = (rand: () => number) => (rand() + rand() + rand() - 1.5) * 1.15;

function equity(v: SevenBotView, brain: Brain, heavy = false): number {
  const rand = brain.rand;
  const opps = v.players.filter((p) => !p.folded && p.seat !== v.seat);
  if (!opps.length) return 1;
  const seen = new Uint8Array(52);
  for (const c of v.cards) seen[c] = 1;
  for (const p of v.players) for (const c of p.up) seen[c] = 1;
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) if (!seen[c]) deck.push(c);

  // 세게 친 만큼 좋은 쪽으로 뽑음 (읽기의 깊이에 따라)
  const tries = opps.map((p) => {
    const raises = v.history.filter((h) => h.seat === p.seat && h.aggressive).length;
    // 스택이 걸린 콜을 따질 때는 서툰 봇도 세게 친 사람을 제대로 읽음
    return 1 + (heavy || rand() < brain.skill.read ? Math.min(2, raises) : 0);
  });
  const mine = [...v.cards];
  const myNeed = 7 - v.cards.length;
  const hand: Card[] = [0, 0, 0, 0, 0, 0, 0];
  const sims = brain.skill.sims;
  let total = 0;
  for (let it = 0; it < sims; it++) {
    let n = deck.length;
    const draw = (): Card => {
      const j = Math.floor(rand() * n);
      const c = deck[j];
      deck[j] = deck[n - 1];
      deck[n - 1] = c;
      n--;
      return c;
    };
    for (let i = 0; i < myNeed; i++) mine[v.cards.length + i] = draw();
    const me = evaluate(mine);
    let best = -1;
    let ties = 0;
    for (let k = 0; k < opps.length; k++) {
      const up = opps[k].up;
      for (let i = 0; i < up.length; i++) hand[i] = up[i];
      // 여러 번 뽑아 좋은 쪽을 쓰되, 매번 같은 남은 카드에서 다시 뽑음 (앞사람이 카드를 다 써서 뒷사람이 못 뽑는 일이 없게)
      const base = n;
      let s = -1;
      for (let t = 0; t < tries[k]; t++) {
        n = base;
        for (let i = up.length; i < 7; i++) hand[i] = draw();
        s = Math.max(s, evaluate(hand));
      }
      if (s > best) {
        best = s;
        ties = 1;
      } else if (s === best) ties++;
    }
    total += me > best ? 1 : me === best ? 1 / (ties + 1) : 0;
  }
  return total / sims;
}

/** 내 펴 놓은 카드가 세 보이는지 (페어가 보이거나 같은 무늬 3장 이상) */
function looksScary(up: Card[]): boolean {
  const ranks = new Map<number, number>();
  const suits = [0, 0, 0, 0];
  for (const c of up) {
    ranks.set(c >> 2, (ranks.get(c >> 2) ?? 0) + 1);
    suits[c & 3]++;
  }
  return [...ranks.values()].some((n) => n >= 2) || Math.max(...suits) >= 3;
}

/** 다음 장으로 완성을 노리는 패인지: 같은 무늬 4장, 또는 4장 연속(양쪽 열림) */
function hasDraw(cards: Card[]): boolean {
  const suits = [0, 0, 0, 0];
  const ranks = new Set<number>();
  for (const c of cards) {
    suits[c & 3]++;
    ranks.add(c >> 2);
  }
  if (Math.max(...suits) === 4) return true;
  if (ranks.has(12)) ranks.add(-1); // A 는 1 로도
  for (let lo = -1; lo <= 8; lo++) if ([0, 1, 2, 3].every((k) => ranks.has(lo + k)) && !ranks.has(lo - 1) && !ranks.has(lo + 4)) return true;
  return false;
}

export function chooseSeven(dealt: Card[], brain: Brain): { discard: number; open: number; thinkMs: number } {
  const c = autoChoice(dealt);
  return { ...c, thinkMs: Math.round((900 + brain.rand() * 2200) * brain.persona.pace) };
}

export function decideSeven(v: SevenBotView, brain: Brain): SevenDecision {
  const p = moodOf(brain);
  const r = brain.rand;
  const me = v.players.find((x) => x.seat === v.seat)!;
  const { toCall, bets } = v.legal;
  const n = v.players.filter((x) => !x.folded && x.seat !== v.seat).length;
  const heavy = toCall >= me.stack * 0.4;
  const eq = clamp(equity(v, brain, heavy) + gauss(r) * (heavy ? Math.min(brain.skill.noise, 0.03) : brain.skill.noise), 0, 1);
  const last = v.round === 7;
  const think = (lo: number, hi: number) => Math.round((lo + (hi - lo) * r()) * p.pace);

  /** 세기(0~1)에 맞는 베팅을 고름: 작은 것부터 삥/따당 · 쿼터 · 하프 (풀은 게임에서 뺐음) */
  const order: SevenBet[] = ["bbing", "ddadang", "quarter", "half"];
  const avail = order.filter((b) => bets[b] !== undefined);
  const pickBet = (s: number): SevenBet | undefined => {
    if (!avail.length) return undefined;
    const i = clamp(Math.round(s * p.sizing * (avail.length - 1) + (r() - 0.5) * 0.8), 0, avail.length - 1);
    let b = avail[i];
    // 스택의 절반 넘게 들어가는 베팅은 확실할 때만
    while ((bets[b] ?? 0) > me.stack * 0.5 && eq < 0.8 && avail.indexOf(b) > 0) b = avail[avail.indexOf(b) - 1];
    return b;
  };
  const allIn = (b: SevenBet | "call") => (b === "call" ? toCall : (bets[b] ?? 0)) >= me.stack;

  if (toCall > 0) {
    const need = toCall / (v.pot + toCall);
    const big = toCall >= v.pot * 0.4 || toCall >= me.stack * 0.5;
    let margin = p.callMargin + 0.03 * (n - 1) + (last ? 0.01 : 0.035);
    // 칩의 큰 몫(올인 받기 등): 걸리는 몫 · 상대 수만큼 더 조심하고, 최소한 제 몫 정도는 이길 패여야 받음
    const risk = Math.min(1, toCall / Math.max(1, me.stack));
    if (risk >= 0.4) margin = Math.max(margin, 0.02) + 0.06 * risk + 0.03 * (n - 1);
    const floorEq = risk >= 0.4 ? 0.95 / (n + 1) + 0.03 : 0;
    // 재미 보정: 싼 베팅은 다음 장을 보러 잘 따라감 (마지막 구 전)
    if (!last && toCall <= v.pot * 0.3 && toCall < me.stack * 0.12) margin -= 0.045 * brain.skill.fun;
    const valueThr = 0.7 + 0.05 * (n - 1) + p.valueShift;
    if (avail.length && eq >= valueThr) {
      if (!last && eq > 0.88 && r() < p.slowplay) return { type: "call", thinkMs: think(1400, 3000) };
      const b = pickBet(eq >= 0.88 ? 0.9 : eq >= 0.78 ? 0.6 : 0.3)!;
      return { type: b, thinkMs: think(1600, 3800), cue: allIn(b) ? "allin" : eq >= 0.8 ? "bigRaise" : "raise" };
    }
    // 드로우로 되받아침 (마지막 구 전, 판이 너무 크지 않을 때)
    if (avail.length && !last && !big && eq < valueThr && hasDraw(v.cards) && r() < p.semiBluff * 0.45) {
      const b = pickBet(0.45)!;
      return { type: b, thinkMs: think(1700, 3600), cue: allIn(b) ? "allin" : "raise" };
    }
    if (avail.length && n === 1 && eq < 0.3 && !big && looksScary(me.up) && r() < 0.05 * p.bluff) {
      const b = pickBet(0.5)!;
      return { type: b, thinkMs: think(2000, 4200), cue: "bigRaise" };
    }
    if (eq >= need + margin && eq >= floorEq) return { type: "call", thinkMs: think(big ? 2000 : 1000, big ? 4800 : 2400), cue: allIn("call") ? "allin" : big && eq < 0.55 ? "heroCall" : "call" };
    return { type: "die", thinkMs: think(big ? 1600 : 800, big ? 3800 : 2000), cue: big && eq > 0.3 ? "bigFold" : "fold" };
  }

  // 받을 돈이 없음: 체크가 없으니 삥 이상을 걸거나 죽어야 함
  if (!avail.length) return { type: "die", thinkMs: think(600, 1200) };
  const valueThr = 0.6 + 0.05 * (n - 1) + p.valueShift;
  if (eq >= valueThr) {
    // 센 패를 숨길 때는 가장 작은 삥만
    if (!last && eq > 0.85 && r() < p.slowplay) return { type: avail[0], thinkMs: think(1100, 2400) };
    const b = pickBet(eq >= 0.85 ? (last ? 1 : 0.8) : eq >= 0.72 ? 0.55 : 0.2)!;
    return { type: b, thinkMs: think(1200, 3000), cue: allIn(b) ? "allin" : "raise" };
  }
  // 드로우로 먼저 세게 (완성되면 크게 먹고, 상대가 죽으면 그냥 먹음)
  if (!last && hasDraw(v.cards) && r() < p.semiBluff * 0.8) {
    const b = pickBet(0.4)!;
    return { type: b, thinkMs: think(1300, 3000), cue: allIn(b) ? "allin" : "raise" };
  }
  if (eq < 0.4 && r() < 0.1 * p.bluff * (n === 1 ? 1 : 0.4) * (looksScary(me.up) ? 1.7 : 0.8)) {
    const b = pickBet(0.55)!;
    return { type: b, thinkMs: think(1500, 3400), cue: "bigRaise" };
  }
  // 삥 한 번 값으로 다음 장을 볼 만한지
  const bbing = bets[avail[0]] ?? v.ante;
  const need = bbing / (v.pot + bbing);
  if (eq >= need + p.callMargin + 0.02 * (n - 1) + (last ? 0.08 : 0)) return { type: avail[0], thinkMs: think(700, 1800) };
  return { type: "die", thinkMs: think(600, 1500), cue: "fold" };
}
