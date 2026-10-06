/**
 * 장기 AI: 알파-베타 탐색 (반복 심화 + 잡는 수 연장 탐색).
 * 의사 합법수로 탐색하고 궁을 잡는 수를 승리로 처리해서, 매 수마다 장군 검사를 하지 않아 빠름.
 * 실제로 두는 수는 루트에서 진짜 합법수(legalMoves) 중에서만 고름.
 */
import {
  A,
  C,
  E,
  H,
  K,
  P,
  R,
  VALUE,
  encode,
  fileOf,
  legalMoves,
  pseudoMoves,
  rankOf,
  type Color,
} from "./engine";

export type Level = "easy" | "normal" | "hard";

const WIN = 100_000;
const other = (c: Color): Color => (c === "w" ? "b" : "w");

/** 초 기준 점수 (양수면 초가 유리) */
function evaluate(bd: Int8Array): number {
  let s = -1.5; // 한 덤
  for (let i = 0; i < 90; i++) {
    const p = bd[i];
    if (!p) continue;
    const t = Math.abs(p);
    const side = p > 0 ? 1 : -1;
    let v = VALUE[t];
    const f = fileOf(i);
    const r = rankOf(i);
    const adv = p > 0 ? 9 - r : r; // 자기 진영에서 얼마나 나왔나 (0~9)
    if (t === P)
      v += adv >= 5 ? 0.4 + (Math.abs(4 - f) <= 1 ? 0.3 : 0) : 0; // 강 건넌 졸, 가운데면 더
    else if (t === H) v += 0.25 * (2 - Math.abs(4 - f) / 2) + (adv >= 2 ? 0.2 : 0);
    else if (t === R) v += adv >= 3 ? 0.3 : 0;
    else if (t === C) v += adv >= 1 ? 0.15 : 0;
    s += side * v;
  }
  return s;
}

function ordered(bd: Int8Array, moves: number[]): number[] {
  return moves
    .map((m) => {
      const victim = bd[m % 90];
      const attacker = Math.abs(bd[Math.floor(m / 90)]);
      return {
        m,
        k: victim
          ? Math.abs(victim) === K
            ? 1000
            : VALUE[Math.abs(victim)] * 10 - attacker
          : -100,
      };
    })
    .sort((a, b) => b.k - a.k)
    .map((x) => x.m);
}

interface Ctx {
  deadline: number;
  nodes: number;
  stop: boolean;
}

function quiesce(
  bd: Int8Array,
  c: Color,
  alpha: number,
  beta: number,
  depth: number,
  ctx: Ctx
): number {
  const stand = (c === "w" ? 1 : -1) * evaluate(bd);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (depth <= 0) return alpha;
  const caps = ordered(
    bd,
    pseudoMoves(bd, c).filter((m) => bd[m % 90] !== 0)
  );
  for (const m of caps) {
    const from = Math.floor(m / 90),
      to = m % 90;
    const cap = bd[to];
    if (Math.abs(cap) === K) return WIN;
    bd[to] = bd[from];
    bd[from] = 0;
    const v = -quiesce(bd, other(c), -beta, -alpha, depth - 1, ctx);
    bd[from] = bd[to];
    bd[to] = cap;
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function search(
  bd: Int8Array,
  c: Color,
  depth: number,
  alpha: number,
  beta: number,
  ctx: Ctx
): number {
  if ((++ctx.nodes & 1023) === 0 && performance.now() > ctx.deadline) ctx.stop = true;
  if (ctx.stop) return 0;
  if (depth === 0) return quiesce(bd, c, alpha, beta, 4, ctx);
  const moves = ordered(bd, pseudoMoves(bd, c));
  if (!moves.length) return (c === "w" ? 1 : -1) * evaluate(bd);
  let best = -Infinity;
  for (const m of moves) {
    const from = Math.floor(m / 90),
      to = m % 90;
    const cap = bd[to];
    if (Math.abs(cap) === K) return WIN + depth; // 궁을 잡을 수 있음 = 이긴 국면
    bd[to] = bd[from];
    bd[from] = 0;
    const v = -search(bd, other(c), depth - 1, -beta, -alpha, ctx);
    bd[from] = bd[to];
    bd[to] = cap;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/** 탐색 깊이·시간, 평가에 섞는 무작위(점수 단위), 아무 수나 둘 확률 */
export interface AIConfig {
  depth: number;
  ms: number;
  noise: number;
  blunder: number;
}

const LEVEL: Record<Level, AIConfig> = {
  easy: { depth: 1, ms: 300, noise: 2.5, blunder: 0.25 },
  normal: { depth: 2, ms: 900, noise: 0.6, blunder: 0 },
  hard: { depth: 6, ms: 1500, noise: 0, blunder: 0 },
};

/** 다음 수 고르기 ("pass" 가능). 둘 수 있는 수가 없으면 null */
export function chooseMove(
  board: Int8Array,
  c: Color,
  level: Level | AIConfig,
  banned: string[] = []
): string | null {
  const bd = Int8Array.from(board);
  const all = legalMoves(bd, c);
  if (!all.length) return "pass";
  // 반복수 제외. 남는 수가 없으면 쉬기 (쉬기도 막혔으면 엔진이 막지 않으므로 아무 수)
  const legal = all.filter((m) => !banned.includes(encode(m)));
  if (!legal.length) return banned.includes("pass") ? encode(all[0]) : "pass";
  const cfg = typeof level === "string" ? LEVEL[level] : level;
  if (Math.random() < cfg.blunder) return encode(legal[Math.floor(Math.random() * legal.length)]);

  const ctx: Ctx = { deadline: performance.now() + cfg.ms, nodes: 0, stop: false };
  let bestMove = legal[0];
  let order = ordered(bd, legal);
  for (let d = 1; d <= cfg.depth; d++) {
    let alpha = -Infinity;
    let iterBest = order[0];
    const scored: { m: number; v: number }[] = [];
    for (const m of order) {
      const from = Math.floor(m / 90),
        to = m % 90;
      const cap = bd[to];
      bd[to] = bd[from];
      bd[from] = 0;
      let v = -search(bd, other(c), d - 1, -Infinity, -alpha + cfg.noise * 2, ctx);
      bd[from] = bd[to];
      bd[to] = cap;
      if (ctx.stop) break;
      v += (Math.random() - 0.5) * cfg.noise;
      scored.push({ m, v });
      if (v > alpha) {
        alpha = v;
        iterBest = m;
      }
    }
    if (ctx.stop && d > 1) break; // 끝까지 못 본 깊이는 버림
    bestMove = iterBest;
    // 다음 깊이는 좋았던 수부터
    order = scored.sort((a, b) => b.v - a.v).map((x) => x.m);
    if (alpha >= WIN / 2) break;
  }
  return encode(bestMove);
}

export { A, C, E, H, R };
