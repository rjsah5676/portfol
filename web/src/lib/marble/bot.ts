/*
 * PIXEL MARBLE AI — 지금 프롬프트에 대한 행동 하나를 고름. 서버의 AI 플레이어와 밸런스 시뮬이 같이 씀.
 * 사람처럼 "다음 굴림 위험(남 땅 통행료 기대값)" 만큼 돈을 남겨 두고 사고 · 짓고 · 인수함.
 */

import {
  LANDMARK,
  RULE,
  assetsOf,
  baseToll,
  buyoutCost,
  canSkill,
  groupOwned,
  mapOf,
  skillRange,
  skillTargets,
  tollOf,
  type Action,
  type Game,
} from "./engine";
import { MAPS } from "./maps";

const PROB = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((x) => x / 36);

/** 성격: 0 = 보통 · 값이 크면 더 과감 (AI 플레이어마다 조금씩 다르게) */
export interface BotStyle {
  greed: number;
}
export const DEFAULT_STYLE: BotStyle = { greed: 0 };

function next1(g: Game, s: number, fork?: number): number {
  const m = MAPS[g.map];
  if (m.id === "cross") {
    const nx = m.tiles[s].next;
    return nx.length > 1 ? (fork !== undefined && nx.includes(fork) ? fork : nx[0]) : nx[0];
  }
  return (s + 1) % m.tiles.length;
}
/** steps 칸 뒤 자리 (갈림길은 fork 쪽) */
function slotAfter(g: Game, pos: number, steps: number, fork?: number): number {
  let s = pos;
  for (let k = 0; k < steps; k++) s = next1(g, s, s === MAPS[g.map].junction ? fork : undefined);
  return s;
}
/** 갈림길에서 고를 수 있는 쪽들 (없으면 [undefined]) */
function forks(g: Game, pos: number, steps: number): (number | undefined)[] {
  const m = MAPS[g.map];
  if (m.junction === undefined) return [undefined];
  let s = pos;
  for (let k = 0; k < steps; k++) {
    if (s === m.junction) return [...m.tiles[m.junction].next];
    s = next1(g, s);
  }
  return [undefined];
}

/** pi 가 지금 낼 통행료 (내 깎기 포함, 어림) */
function tollFor(g: Game, pi: number, tile: number): number {
  const p = g.players[pi];
  let v = tollOf(g, tile) * (1 - p.fx.tollPay);
  if (p.shield) v *= 1 - p.shield;
  if (p.keep.half) v *= 0.5;
  return v;
}

/** 다음 한 번 굴림에서 남 땅에 걸릴 기대 통행료 */
export function danger(g: Game, pi: number, from?: number): number {
  const p = g.players[pi];
  const pos = from ?? p.pos;
  let e = 0;
  for (let s = 2; s <= 12; s++) {
    // 갈림길이면 덜 아픈 쪽으로 감
    const vs = forks(g, pos, s).map((f) => {
      const tile = g.order[slotAfter(g, pos, s, f)];
      const t = g.tiles[tile];
      return t.owner >= 0 && t.owner !== pi ? tollFor(g, pi, tile) : 0;
    });
    e += PROB[s] * Math.min(...vs);
  }
  return e;
}

/** 가장 비싼 남 땅 통행료 (앞으로 12칸 안) */
function maxAhead(g: Game, pi: number): number {
  const p = g.players[pi];
  let mx = 0;
  for (let s = 1; s <= 12; s++)
    for (const f of forks(g, p.pos, s)) {
      const tile = g.order[slotAfter(g, p.pos, s, f)];
      const t = g.tiles[tile];
      if (t.owner >= 0 && t.owner !== pi) mx = Math.max(mx, tollFor(g, pi, tile));
    }
  return mx;
}

/** 남겨 둘 돈 */
function reserve(g: Game, pi: number, style: BotStyle): number {
  const late = g.round / g.rounds;
  return Math.max(150, (1.4 - style.greed * 0.3) * danger(g, pi) + (0.35 - 0.1 * style.greed) * maxAhead(g, pi) + 120 * (1 - late));
}

/** 이 자리에 서면 얼마나 좋은지 (돈 어림) */
function landValue(g: Game, pi: number, slot: number): number {
  const p = g.players[pi];
  const m = mapOf(g);
  const tile = g.order[slot];
  const d = m.tiles[tile];
  const t = g.tiles[tile];
  switch (d.kind) {
    case "city":
    case "spot": {
      if (t.owner >= 0 && t.owner !== pi) {
        let v = -tollFor(g, pi, tile);
        // 인수해서 그룹을 막거나 채울 수 있으면 조금 낫다
        if (d.kind === "city" && t.lv < LANDMARK && d.group !== undefined && groupOwned(g, d.group) === t.owner) v += 120;
        return v;
      }
      if (t.owner < 0) {
        const can = p.cash - (d.price ?? 0) > 150;
        let v = can ? (d.price ?? 0) * 0.7 + 40 : 5;
        if (can && d.group !== undefined) {
          const others = m.tiles.filter((x, i) => x.group === d.group && i !== tile);
          const mine = others.filter((x) => g.tiles[m.tiles.indexOf(x)].owner === pi).length;
          if (mine === others.length) v += 300;
          else v += mine * 60;
        }
        return v;
      }
      // 내 땅
      if (t.lv >= LANDMARK || d.kind === "spot") return 10;
      return 60 + (d.price ?? 0) * (t.lv === 3 ? 1.2 : 0.5);
    }
    case "start":
      return RULE.salary * (1 + p.fx.salary);
    case "start2":
      return RULE.salary * RULE.start2;
    case "bonus":
      return RULE.bonus;
    case "box":
      return 40;
    case "jail":
      return p.fx.jailFree ? 0 : g.round / g.rounds > 0.6 ? 30 : -70;
    case "fest":
      return g.tiles.some((x, i) => x.owner === pi && m.tiles[i].kind === "city") ? 90 : 0;
    case "warp":
      return 70;
    case "tax":
      return -Math.max(RULE.taxMin, (assetsOf(g, pi) - p.cash) * RULE.taxRate);
  }
}

/** steps 칸 가서 설 때 가치 (갈림길이면 좋은 쪽) — 지나가며 받는 월급도 */
function stepsValue(g: Game, pi: number, steps: number, from?: number): number {
  const p = g.players[pi];
  const pos = from ?? p.pos;
  let best = -Infinity;
  for (const f of forks(g, pos, steps)) {
    let s = pos;
    let v = 0;
    for (let k = 0; k < steps; k++) {
      s = next1(g, s, s === MAPS[g.map].junction ? f : undefined);
      const kd = MAPS[g.map].tiles[g.order[s]].kind;
      if (k < steps - 1 && kd === "start") v += RULE.salary * (1 + p.fx.salary);
      if (k < steps - 1 && kd === "start2") v += RULE.salary * RULE.start2;
    }
    v += landValue(g, pi, s);
    best = Math.max(best, v);
  }
  return best;
}
const expectedRoll = (g: Game, pi: number) => {
  let e = 0;
  for (let s = 2; s <= 12; s++) e += PROB[s] * stepsValue(g, pi, s);
  return e;
};

/* ───────────── 고르기 ───────────── */

export function botAction(g: Game, style: BotStyle = DEFAULT_STYLE): Action {
  const pr = g.prompt!;
  const pi = pr.p;
  const p = g.players[pi];
  const m = mapOf(g);
  switch (pr.k) {
    case "turn": {
      if (pr.warp) {
        let best = p.pos,
          bv = -Infinity;
        for (let s = 0; s < m.tiles.length; s++) {
          const kd = m.tiles[g.order[s]].kind;
          if (kd === "warp") continue;
          const v = landValue(g, pi, s) + (m.id !== "cross" && s <= p.pos ? RULE.salary : 0);
          if (v > bv) {
            bv = v;
            best = s;
          }
        }
        return { t: "warp", to: best };
      }
      if (pr.jail) {
        const early = g.round / g.rounds < 0.45;
        if (early && p.cash > 700 && danger(g, pi) < p.cash * 0.15) return { t: "pay" };
        return { t: "roll" };
      }
      const sk = skillChoice(g, pi);
      if (sk) return sk;
      if (p.uses.pick > 0) {
        let bn = 7,
          bv = -Infinity;
        for (let n = 2; n <= 12; n++) {
          const v = stepsValue(g, pi, n);
          if (v > bv) {
            bv = v;
            bn = n;
          }
        }
        if (bv - expectedRoll(g, pi) > 220) return { t: "pick", n: bn };
      }
      return { t: "roll" };
    }
    case "post": {
      const cur = stepsValue(g, pi, pr.steps);
      // 스킬 (다시 굴리기 · 깡총)
      if (canSkill(g, pi)) {
        if (p.skill.kind === "reroll" && cur < expectedRoll(g, pi) - 120) return { t: "skill" };
        if (p.skill.kind === "bunny") {
          let bn = 0,
            bv = cur;
          for (let n = 1; n <= 3; n++) {
            const v = stepsValue(g, pi, pr.steps + n);
            if (v > bv + 60) {
              bv = v;
              bn = n;
            }
          }
          if (bn > 0) return { t: "skill", n: bn };
        }
      }
      if (p.uses.adjust > 0 && stepsValue(g, pi, pr.steps + 1) > cur + 150) return { t: "adjust", d: 1 };
      if (p.uses.reroll > 0 && cur < expectedRoll(g, pi) - 200) return { t: "reroll" };
      return { t: "keep" };
    }
    case "fork": {
      let best = pr.opts[0],
        bv = -Infinity;
      for (const o of pr.opts) {
        let s = p.pos;
        for (let k = 0; k < pr.steps; k++) s = next1(g, s, s === m.junction ? o : undefined);
        // 서는 칸 + 그 루프의 내 땅 수(길게 보면 내 땅이 많은 루프가 덜 위험)
        const loop = m.tiles.map((_, i) => i).filter((i) => (o === 1 ? i < 16 && i > 0 : i >= 16));
        const foeTolls = loop.reduce((a, i) => a + (g.tiles[i].owner >= 0 && g.tiles[i].owner !== pi ? tollFor(g, pi, i) : 0), 0);
        const v = landValue(g, pi, s) - foeTolls * 0.05;
        if (v > bv) {
          bv = v;
          best = o;
        }
      }
      return { t: "fork", to: best };
    }
    case "buy": {
      const d = m.tiles[pr.tile];
      const res = reserve(g, pi, style);
      let completes = false;
      if (d.group !== undefined) {
        const others = m.tiles.filter((x, i) => x.group === d.group && i !== pr.tile);
        completes = others.every((x) => g.tiles[m.tiles.indexOf(x)].owner === pi);
      }
      let pick = -1;
      for (let lv = pr.max; lv > pr.from; lv--) {
        const c = pr.costs[lv - pr.from - 1];
        const keep = lv === LANDMARK ? res * 0.6 : completes ? res * 0.5 : lv <= 0 ? res * 0.6 : res;
        if (p.cash - c >= keep) {
          pick = lv;
          break;
        }
      }
      return { t: "buy", lv: pick };
    }
    case "acq": {
      const d = m.tiles[pr.tile];
      const t = g.tiles[pr.tile];
      const res = reserve(g, pi, style);
      if (p.cash - pr.cost < res * 0.8) return { t: "acq", yes: false };
      let worth = baseToll(d.price ?? 0, t.lv) * 1.5;
      if (d.group !== undefined) {
        const go = groupOwned(g, d.group);
        if (go >= 0 && go !== pi) worth += 400; // 남의 독점 깨기
        const others = m.tiles.filter((x, i) => x.group === d.group && i !== pr.tile);
        if (others.every((x) => g.tiles[m.tiles.indexOf(x)].owner === pi)) worth += 800; // 내 독점
      }
      return { t: "acq", yes: worth + 100 * style.greed >= pr.cost * 0.6 };
    }
    case "fest": {
      let best = pr.tiles[0],
        bv = -1;
      for (const t of pr.tiles) {
        const v = tollOf(g, t);
        if (v > bv) {
          bv = v;
          best = t;
        }
      }
      return { t: "fest", tile: best };
    }
  }
}

/** 굴리기 전 스킬: 쓸 만하면 행동, 아니면 null */
function skillChoice(g: Game, pi: number): Action | null {
  if (!canSkill(g, pi)) return null;
  const p = g.players[pi];
  const m = mapOf(g);
  const k = p.skill.kind;
  const targets = skillTargets(g, pi);
  switch (k) {
    case "boost":
    case "fireworks": {
      let best = -1,
        bv = 0;
      for (const t of targets) {
        if (g.tiles[t].boostLeft > 0) continue;
        const grp = m.tiles[t].group;
        let v = targets.filter((x) => m.tiles[x].group === grp).reduce((a, x) => a + tollOf(g, x), 0);
        if (k === "fireworks") v *= 1.4;
        if (v > bv) {
          bv = v;
          best = t;
        }
      }
      return best >= 0 && bv >= 140 ? { t: "skill", target: best } : null;
    }
    case "shield":
    case "hop":
      return danger(g, pi) > 110 || maxAhead(g, pi) > 500 ? { t: "skill" } : null;
    case "sale": {
      // 앞에 인수할 만한 남 땅이 있으면
      const has = g.tiles.some((t, i) => t.owner >= 0 && t.owner !== pi && m.tiles[i].kind === "city" && t.lv < LANDMARK && t.lv >= 1);
      return has && p.cash > 500 ? { t: "skill" } : null;
    }
    case "pull": {
      let best: Action | null = null,
        bv = 120;
      for (const f of targets) {
        const fp = g.players[f];
        for (let n = 1; n <= skillRange(g, pi)![1]; n++) {
          const tile = g.order[slotAfter(g, fp.pos, n)];
          const t = g.tiles[tile];
          const v = t.owner === pi ? tollOf(g, tile) * (p.fx.pullPay || 1) : 0;
          if (v > bv) {
            bv = v;
            best = { t: "skill", target: f, n };
          }
        }
      }
      return best;
    }
    case "dash":
    case "pick": {
      const r = skillRange(g, pi)!;
      let bn = r[0],
        bv = -Infinity;
      for (let n = r[0]; n <= r[1]; n++) {
        const v = stepsValue(g, pi, n);
        if (v > bv) {
          bv = v;
          bn = n;
        }
      }
      return bv - expectedRoll(g, pi) > 150 ? { t: "skill", n: bn } : null;
    }
    case "freeze":
      return targets.length ? { t: "skill", target: targets.sort((a, b) => assetsOf(g, b) - assetsOf(g, a))[0] } : null;
    case "concert": {
      const sum = targets.length ? targets.reduce((a, f) => a + g.players[f].cash, 0) : g.players.filter((_, i) => i !== pi && g.players[i].alive).reduce((a, x) => a + x.cash, 0);
      return sum * p.skill.mag > 60 ? { t: "skill" } : null;
    }
    case "debug": {
      let best = -1,
        bv = 0;
      for (const t of targets) {
        const v = tollOf(g, t);
        if (v > bv) {
          bv = v;
          best = t;
        }
      }
      return best >= 0 && bv > 150 ? { t: "skill", target: best } : null;
    }
    case "fate": {
      let bn = 1,
        bv = -Infinity;
      for (let n = 1; n <= 6; n++) {
        const v = stepsValue(g, pi, n * 2);
        if (v > bv) {
          bv = v;
          bn = n;
        }
      }
      // 더블이라 한 번 더 — 그만큼 덤
      return bv + 120 - expectedRoll(g, pi) > 120 && p.doubles < 2 ? { t: "skill", n: bn } : null;
    }
    case "buyout": {
      let best = -1,
        bv = 0;
      for (const t of targets) {
        const cost = buyoutCost(g, pi, t);
        if (p.cash - cost < 300) continue;
        const grp = m.tiles[t].group;
        const rest = m.tiles.every((d, i) => i === t || d.kind !== "city" || d.group !== grp || g.tiles[i].owner === pi);
        const v = tollOf(g, t) * 2 + (rest ? 600 : 0) - cost * 0.3;
        if (v > bv) {
          bv = v;
          best = t;
        }
      }
      return best >= 0 && bv > 200 ? { t: "skill", target: best } : null;
    }
    case "encore":
      return { t: "skill" };
    default:
      return null;
  }
}
