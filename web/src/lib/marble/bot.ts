/*
 * DICE TOWN v2 AI — 잠글 주사위 · 이동 · 스킬 · 아이템을 고름.
 *
 * 값 = 족보 보상(코인 어림) + 고른 이동의 값(지나며 별 · 도착 칸 · 다음 차례 별 거리).
 * 다시 굴릴지는 잠글 조합마다 몇 번 굴려 보고(몬테카를로) 기대값이 지금보다 크면 굴림.
 * greed: 클수록 큰 족보(야추 · 포카드)를 노림.
 */
import { SKILL_TIME } from "./data";
import {
  CARDS,
  HANDS,
  STAR_VALUE,
  bestMove,
  canSkill,
  cardBlock,
  handOf,
  kindAt,
  moveSums,
  moveValue,
  starDist,
  starPrice,
  standings,
  timeoutAction,
  warpBest,
  type Action,
  type CardId,
  type Game,
  type HandId,
} from "./engine";

export interface BotStyle {
  greed: number;
}
export const DEFAULT_STYLE: BotStyle = { greed: 0 };

/** 간단한 난수 (판 rng 를 건드리지 않게 — 시드는 판 상태에서) */
function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 족보 보상 어림 (코인) */
function handValue(g: Game, pi: number, dice: readonly number[], h: HandId = handOf(dice), greed = 0): number {
  const p = g.players[pi];
  const t = g.turn!;
  const m = t.dbl ? 2 : 1;
  const d = HANDS[h];
  let v = d.coins;
  if (h === "pair" || h === "two") v += p.fx.comboCoin;
  if (h === "triple" || h === "full" || h === "four" || h === "yacht") v += p.fx.bigCombo;
  if (h === "small" || h === "large") v += p.fx.straightBonus;
  if (d.card) v += (p.cards.length >= 3 ? 3 : 5) * d.card;
  if (d.steal) v += d.steal * 1.4;
  if (d.star) v += STAR_VALUE * d.star + p.fx.yachtBonus + 4 * greed;
  if (h === "four") v += 2 * greed;
  v *= m;
  if (d.jump) {
    const coins = p.coins + (d.coins + p.fx.straightBonus) * m;
    v += coins >= starPrice(g, pi) ? STAR_VALUE + (g.frenzy ? 8 : 0) : 4;
  }
  return v;
}

/** 이 주사위로 멈추면 얼마나 좋은지 */
function stopValue(g: Game, pi: number, dice: readonly number[], greed = 0): number {
  const t = g.turn!;
  const h = handOf(dice);
  const hv = handValue(g, pi, dice, h, greed);
  if (h === "large") return hv;
  const extra = HANDS[h].coins * (t.dbl ? 2 : 1);
  const sums = h === "small" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : moveSums(dice, t.tri ? 3 : 2);
  let best = -1e9;
  for (const s of sums) best = Math.max(best, moveValue(g, pi, s + t.boost, extra));
  return hv + best;
}

/** 잠글 조합 후보 (같은 눈 묶음은 하나로) */
function holdSets(dice: readonly number[]): number[][] {
  const n = dice.length;
  const seen = new Set<string>();
  const out: number[][] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    if (mask === (1 << n) - 1) continue;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) idx.push(i);
    const key = idx
      .map((i) => dice[i])
      .sort()
      .join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(idx);
  }
  return out;
}

/** 잠그고 나머지 굴렸을 때 기대값 */
function expectHold(g: Game, pi: number, dice: readonly number[], hold: number[], rollsLeft: number, rand: () => number, samples: number, greed: number): number {
  let sum = 0;
  const keep = new Set(hold);
  for (let s = 0; s < samples; s++) {
    const d = dice.map((v, i) => (keep.has(i) ? v : 1 + Math.floor(rand() * 6)));
    let v = stopValue(g, pi, d, greed);
    // 한 번 더 굴릴 수 있으면 "같은 눈 묶음 잠그기" 정도로 약간 더 기대
    if (rollsLeft > 1) {
      const h = handOf(d);
      if (h === "none" || h === "pair" || h === "two" || h === "triple") v += 1.2;
    }
    sum += v;
  }
  return sum / samples;
}

function decideRoll(g: Game, pi: number, greed: number): Action {
  const t = g.turn!;
  const p = g.players[pi];
  const rand = lcg(g.seed ^ (g.steps * 2654435761));
  const now = stopValue(g, pi, t.dice, greed);
  const canRe = t.rolls > 0 || p.uses.reroll > 0;
  if (canRe) {
    const sets = holdSets(t.dice);
    let bestV = -1e9;
    let bestH: number[] = [];
    const samples = sets.length > 20 ? 10 : 14;
    for (const h of sets) {
      const v = expectHold(g, pi, t.dice, h, t.rolls, rand, samples, greed);
      if (v > bestV) [bestV, bestH] = [v, h];
    }
    // 판당 횟수(시간 주사위)는 아껴 씀
    const margin = t.rolls > 0 ? 0.8 : 4;
    if (bestV > now + margin) return { t: "reroll", pick: bestH };
  }
  const b = bestMove(g, pi);
  // 미끄럼: ±1 이 더 좋으면
  if (p.uses.slide > 0 && b.n === undefined && handOf(t.dice) !== "large") {
    const extra = HANDS[handOf(t.dice)].coins;
    const base = moveValue(g, pi, b.steps, extra);
    for (const d of [1, -1]) {
      if (b.steps + d < 1) continue;
      if (moveValue(g, pi, b.steps + d, extra) > base + 6) return { t: "move", pick: b.pick, d };
    }
  }
  return b.n !== undefined ? { t: "move", n: b.n } : { t: "move", pick: b.pick };
}

/** 주사위를 바꾸는 스킬 · 카드: 바꾼 뒤 멈춤 값이 가장 큰 것 */
function bestDieEdit(g: Game, pi: number, edits: { i: number; v: number }[][], greed: number): { k: number; v: number } {
  const t = g.turn!;
  let best = { k: -1, v: stopValue(g, pi, t.dice, greed) };
  edits.forEach((e, k) => {
    const d = [...t.dice];
    for (const { i, v } of e) d[i] = v;
    const v = stopValue(g, pi, d, greed);
    if (v > best.v) best = { k, v };
  });
  return best;
}

function trySkill(g: Game, pi: number, greed: number): Action | null {
  if (!canSkill(g, pi)) return null;
  const p = g.players[pi];
  const t = g.turn!;
  const pr = g.prompt!;
  const { kind, mag } = p.skill;
  const st = standings(g);
  const leader = st.find((q) => q !== pi) ?? (pi === 0 ? 1 : 0);
  const dicePhase = pr.k === "dice";
  // 굴린 뒤에 쓰는 게 나은 것들은 굴린 뒤에
  switch (kind) {
    case "seal":
      return { t: "skill", target: leader };
    case "sleep":
      return { t: "skill" };
    case "circus":
      return g.players.some((q, i) => i !== pi && q.coins > 0) ? { t: "skill" } : null;
    case "shield":
      return p.shield === 0 ? { t: "skill" } : null;
    case "encore":
      return { t: "skill" };
    case "pull": {
      // 상대를 빨강 · 함정에 세우거나 별에서 멀어지게
      let best: { q: number; n: number; v: number } | null = null;
      for (const q of g.players.keys()) {
        if (q === pi) continue;
        for (let n = -mag; n <= mag; n++) {
          if (!n) continue;
          const pos = (g.players[q].pos + n + 32) % 32;
          const k = kindAt(g, pos);
          let v = k === "red" ? 4 : k === "trap" ? 5 : 0;
          if (g.traps[pos] >= 0 && g.traps[pos] !== q) v += 5;
          const before = starDist(g, g.players[q].pos);
          const after = starDist(g, pos);
          if (before <= 12 && after > 12) v += 6;
          v += q === leader ? 1 : 0;
          if (!best || v > best.v) best = { q, n, v };
        }
      }
      return best && best.v >= 4 ? { t: "skill", target: best.q, n: best.n } : null;
    }
    default:
      break;
  }
  if (!dicePhase) return null;
  const now = stopValue(g, pi, t.dice, greed);
  switch (kind) {
    case "reroll":
      return t.rolls === 0 && handOf(t.dice) !== "yacht" ? { t: "skill" } : null;
    case "double": {
      const h = handOf(t.dice);
      return HAND_ORDER_VAL[h] >= 3 && t.rolls === 0 ? { t: "skill" } : null;
    }
    case "tri":
      // 다시 굴리기 +1 이 같이 오니 다 쓴 뒤에
      return t.rolls === 0 && handOf(t.dice) !== "yacht" ? { t: "skill" } : null;
    case "bunny":
    case "hop":
      return t.rolls === 0 ? { t: "skill" } : null;
    case "vip": {
      const d = starDist(g, p.pos);
      return t.rolls === 0 && d <= 15 && p.coins + 6 >= starPrice(g, pi) - mag ? { t: "skill" } : null;
    }
    case "six":
    case "nudge":
    case "magic":
    case "copy": {
      const edits: { i: number; v: number }[][] = [];
      const n = t.dice.length;
      if (kind === "six") for (let i = 0; i < n; i++) edits.push([{ i, v: 6 }]);
      if (kind === "nudge")
        for (let i = 0; i < n; i++)
          for (let d = -mag; d <= mag; d++) {
            const v = t.dice[i] + d;
            if (d && v >= 1 && v <= 6) edits.push([{ i, v }]);
          }
      if (kind === "magic")
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) edits.push([{ i, v: a }, { i: j, v: b }]);
      if (kind === "copy")
        for (let s = 0; s < n; s++) {
          const others = [...Array(n).keys()].filter((i) => i !== s && t.dice[i] !== t.dice[s]);
          for (let a = 0; a < others.length; a++)
            for (let b = a + 1; b < others.length; b++)
              edits.push([
                { i: others[a], v: t.dice[s] },
                { i: others[b], v: t.dice[s] },
              ]);
        }
      const best = bestDieEdit(g, pi, edits, greed);
      // 다시 굴리기가 남았으면 크게 좋아질 때만
      const need = t.rolls > 0 ? 10 : 3;
      if (best.k < 0 || best.v < now + need) return null;
      const e = edits[best.k];
      if (kind === "six") return { t: "skill", die: e[0].i };
      if (kind === "nudge") return { t: "skill", die: e[0].i, n: e[0].v - t.dice[e[0].i] };
      if (kind === "magic") return { t: "skill", pick: [e[0].i, e[1].i], vals: [e[0].v, e[1].v] };
      const src = t.dice.findIndex((v, i) => v === e[0].v && !e.some((x) => x.i === i));
      return { t: "skill", die: src, pick: e.map((x) => x.i) };
    }
  }
  void SKILL_TIME;
  return null;
}
const HAND_ORDER_VAL: Record<HandId, number> = { none: 0, pair: 1, two: 2, triple: 3, small: 3, full: 4, large: 5, four: 6, yacht: 8 };

function tryCard(g: Game, pi: number, greed: number): Action | null {
  const p = g.players[pi];
  const t = g.turn!;
  const pr = g.prompt!;
  const st = standings(g);
  const leader = st.find((q) => q !== pi) ?? (pi === 0 ? 1 : 0);
  const ok = (id: CardId) => p.cards.includes(id) && !cardBlock(g, pi, id);
  if (pr.k === "turn") {
    if (ok("thief")) {
      const q = [...g.players.keys()].filter((i) => i !== pi).sort((a, b) => g.players[b].coins - g.players[a].coins)[0];
      if (g.players[q].coins >= 3) return { t: "card", id: "thief", target: q };
    }
    if (ok("starmove")) {
      const d = starDist(g, p.pos);
      if (d > 12) {
        const to = g.stars.filter((s) => s !== g.star).sort((a, b) => Math.abs(starDistTo(g, p.pos, a) - 7) - Math.abs(starDistTo(g, p.pos, b) - 7))[0];
        if (starDistTo(g, p.pos, to) <= 12 && p.coins + 4 >= starPrice(g, pi)) return { t: "card", id: "starmove", tile: to };
      }
    }
    if (ok("swap")) {
      const myD = starDist(g, p.pos);
      const q = [...g.players.keys()].filter((i) => i !== pi).sort((a, b) => starDist(g, g.players[a].pos) - starDist(g, g.players[b].pos))[0];
      const qd = starDist(g, g.players[q].pos);
      if (myD > 12 && qd >= 2 && qd <= 9 && p.coins + 4 >= starPrice(g, pi)) return { t: "card", id: "swap", target: q };
    }
    if (ok("trap") && kindAt(g, p.pos) !== "red") return { t: "card", id: "trap" };
    void leader;
    return null;
  }
  // 굴린 뒤
  if (ok("gold")) {
    const edits: { i: number; v: number }[][] = [];
    for (let i = 0; i < t.dice.length; i++) for (let v = 1; v <= 6; v++) if (v !== t.dice[i]) edits.push([{ i, v }]);
    const now = stopValue(g, pi, t.dice, greed);
    const best = bestDieEdit(g, pi, edits, greed);
    const need = t.rolls > 0 ? 12 : 5;
    if (best.k >= 0 && best.v >= now + need) return { t: "card", id: "gold", die: edits[best.k][0].i, n: edits[best.k][0].v };
  }
  if (ok("boost") && t.rolls === 0 && handOf(t.dice) !== "large") {
    const b = bestMove(g, pi);
    const extra = HANDS[handOf(t.dice)].coins;
    if (moveValue(g, pi, b.steps + 3, extra) > b.v + 6) return { t: "card", id: "boost" };
  }
  if (ok("reroll") && t.rolls === 0 && p.uses.reroll === 0) {
    const h = handOf(t.dice);
    if (h === "none" || h === "pair" || h === "two") return { t: "card", id: "reroll" };
  }
  return null;
}
const starDistTo = (g: Game, from: number, to: number) => (to - from + 32) % 32;

/** 황금 주사위 (장착) */
function tryGear(g: Game, pi: number, greed: number): Action | null {
  const p = g.players[pi];
  const t = g.turn!;
  if (p.uses.gold <= 0) return null;
  const edits: { i: number; v: number }[][] = [];
  for (let i = 0; i < t.dice.length; i++) for (let v = 1; v <= 6; v++) if (v !== t.dice[i]) edits.push([{ i, v }]);
  const now = stopValue(g, pi, t.dice, greed);
  const best = bestDieEdit(g, pi, edits, greed);
  const need = t.rolls > 0 ? 14 : 7;
  if (best.k >= 0 && best.v >= now + need) return { t: "gear", die: edits[best.k][0].i, n: edits[best.k][0].v };
  return null;
}

export function botAction(g: Game, style: BotStyle = DEFAULT_STYLE): Action {
  const pr = g.prompt;
  if (!pr) throw new Error("no prompt");
  const pi = pr.p;
  const greed = Math.max(-0.5, Math.min(1, style.greed));
  try {
    switch (pr.k) {
      case "turn":
        return trySkill(g, pi, greed) ?? tryCard(g, pi, greed) ?? { t: "roll", power: 0.5 };
      case "dice":
        return trySkill(g, pi, greed) ?? tryCard(g, pi, greed) ?? tryGear(g, pi, greed) ?? decideRoll(g, pi, greed);
      case "foe":
        return { t: "target", target: [...pr.opts].sort((a, b) => g.players[b].stars - g.players[a].stars || g.players[b].coins - g.players[a].coins)[0] };
      case "warp":
        return { t: "warp", tile: warpBest(g, pi) };
      case "more":
        return timeoutAction(g);
    }
  } catch {
    return timeoutAction(g);
  }
  void CARDS;
  return timeoutAction(g);
}
