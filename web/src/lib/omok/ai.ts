/**
 * 오목 AI
 *
 * 1) 모양표: 한 점을 중심으로 한 방향 ±5칸(나머지 10칸 × 빈칸/내 돌/막힘 = 3^10가지)의 모양
 *    (5목·열린4·4·열린3·3·열린2·2)을 처음 한 번 표로 만들어 둠 → 탐색 중엔 표만 찾아봄.
 *    "열린3 = 한 수 더 두면 열린4가 되는 모양"처럼 돌이 하나 더 많은 모양을 먼저 계산해 두고 거꾸로 채움.
 * 2) 후보 수: 돌 주변 2칸 안의 빈칸을 공격(내 모양) + 수비(상대 모양) 점수로 정렬해 앞쪽만.
 * 3) VCF: 4를 연달아 두며 상대가 막을 수밖에 없게 몰아서 이기는 수순을 먼저 찾음.
 *    렌주룰에서 흑이 막아야 할 자리가 금수면 못 막으니 그대로 승리 → 백 AI가 이걸 노림.
 * 4) 알파-베타 탐색 (반복 심화, 시간 제한). 강한 단계는 상대 VCF가 생기는 수를 피함.
 * 금수는 규칙 엔진(forbidden)으로 정확히 판정 — 흑 AI는 금수에 안 두고, 상대 흑의 금수 자리는 안 막음.
 */
import {
  CENTER,
  DX,
  DY,
  MAX_SIZE,
  N,
  SIZE,
  WHITE,
  exactFive,
  forbidden,
  hasForbidden,
  makesFive,
  otherStone,
  setBoardN,
  sqName,
  stoneOf,
  type Color,
  type Rule,
  type Stone,
} from "./engine";

export interface AIConfig {
  /** 탐색 깊이 (수) */
  depth: number;
  /** 한 수 생각 시간 상한 */
  ms: number;
  /** 루트 점수에 섞는 무작위 (클수록 엉뚱한 수) */
  noise: number;
  /** 이 확률로 그럴듯한 후보 중 아무거나 (실수) */
  blunder: number;
  /** 연속 4로 이기는 수순 찾기 */
  vcf: boolean;
  /** 상대 VCF가 생기는 수 피하기 */
  guard: boolean;
}

// ───────────── 모양표 ─────────────
const NONE = 0,
  TWO = 1,
  OPEN2 = 2,
  THREE = 3,
  OPEN3 = 4,
  FOUR = 5,
  OPEN4 = 6,
  FIVE = 7;

const POW3 = [1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683];
const KEYS = 59049;
/** 칸 위치(0~10, 5가 가운데) → 키 자릿수 */
const DIGIT = [0, 1, 2, 3, 4, -1, 5, 6, 7, 8, 9];

function buildTable(ex: boolean): Uint8Array {
  const table = new Uint8Array(KEYS);
  // 내 돌 수가 많은 키부터 (한 수 더 둔 모양을 먼저 알아야 하므로)
  const byOwn: number[][] = Array.from({ length: 11 }, () => []);
  const L = new Int8Array(11);
  for (let key = 0; key < KEYS; key++) {
    let k = key,
      own = 0;
    for (let j = 0; j < 10; j++) {
      if (k % 3 === 1) own++;
      k = (k / 3) | 0;
    }
    byOwn[own].push(key);
  }
  const runAt = (c: number) => {
    let n = 1;
    for (let j = c + 1; j <= 10 && L[j] === 1; j++) n++;
    for (let j = c - 1; j >= 0 && L[j] === 1; j--) n++;
    return n;
  };
  const five = (c: number) => {
    const r = runAt(c);
    return ex ? r === 5 : r >= 5;
  };
  for (let own = 10; own >= 0; own--) {
    for (const key of byOwn[own]) {
      let k = key;
      for (let p = 0; p <= 10; p++) {
        if (p === 5) {
          L[5] = 1;
          continue;
        }
        L[p] = k % 3;
        k = (k / 3) | 0;
      }
      if (five(5)) {
        table[key] = FIVE;
        continue;
      }
      // 한 수로 5가 되는 자리 (가운데와 이어져야 함)
      const comps: number[] = [];
      for (let q = 1; q <= 9; q++) {
        if (L[q] !== 0) continue;
        let ok = true;
        const st = q > 5 ? 1 : -1;
        for (let j = 5 + st; j !== q; j += st) if (L[j] !== 1) ok = false;
        if (!ok) continue;
        L[q] = 1;
        if (five(q)) comps.push(q);
        L[q] = 0;
      }
      if (comps.length) {
        table[key] = comps.length >= 2 ? OPEN4 : FOUR;
        continue;
      }
      let best = NONE;
      for (let q = 1; q <= 9; q++) {
        if (L[q] !== 0) continue;
        const sh = table[key + POW3[DIGIT[q]]]; // 0 → 1
        const v =
          sh === OPEN4
            ? OPEN3
            : sh === FOUR
              ? THREE
              : sh === OPEN3
                ? OPEN2
                : sh === THREE
                  ? TWO
                  : NONE;
        if (v > best) best = v;
      }
      table[key] = best;
    }
  }
  return table;
}

let TABLES: { ex: Uint8Array; loose: Uint8Array } | null = null;
function tables() {
  return (TABLES ??= { ex: buildTable(true), loose: buildTable(false) });
}

// ───────────── 점 점수 ─────────────
const S_FIVE = 100_000_000;
const S_WIN = 1_000_000; // 열린4 / 4-4 / 4-3 → 다음 수에 이김
const S_33 = 200_000;
const WIN = 1_000_000_000;

/** i에 s를 둘 때 4방향 모양 개수, 상대 o 기준도 함께 */
function shapesAt(
  bd: Int8Array,
  i: number,
  s: Stone,
  tS: Uint8Array,
  tO: Uint8Array,
  outS: Int8Array,
  outO: Int8Array
) {
  outS.fill(0);
  outO.fill(0);
  const x = i % N,
    y = (i / N) | 0;
  for (let d = 0; d < 4; d++) {
    let kS = 0,
      kO = 0;
    for (let p = 0; p <= 10; p++) {
      if (p === 5) continue;
      const off = p - 5;
      const xx = x + DX[d] * off,
        yy = y + DY[d] * off;
      const w = POW3[DIGIT[p]];
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) {
        kS += 2 * w;
        kO += 2 * w;
        continue;
      }
      const v = bd[yy * N + xx];
      if (v === 0) continue;
      if (v === s) {
        kS += w;
        kO += 2 * w;
      } else {
        kS += 2 * w;
        kO += w;
      }
    }
    outS[tS[kS]]++;
    outO[tO[kO]]++;
  }
}

function scoreOf(n: Int8Array): number {
  if (n[FIVE]) return S_FIVE;
  if (n[OPEN4] || n[FOUR] >= 2 || (n[FOUR] && n[OPEN3])) return S_WIN;
  if (n[OPEN3] >= 2) return S_33;
  return n[FOUR] * 1500 + n[OPEN3] * 1200 + n[THREE] * 200 + n[OPEN2] * 120 + n[TWO] * 20 + 1;
}

/** 금수일 수도 있는 모양인지 (그때만 정밀 판정) */
function maybeForbidden(n: Int8Array, rule: Rule) {
  if (rule === "renju") return n[OPEN4] + n[FOUR] >= 2 || n[OPEN3] >= 2 || n[OPEN4] >= 1;
  return n[OPEN3] >= 2;
}

interface Cand {
  i: number;
  /** 정렬 점수 */
  k: number;
  a: number; // 공격
  b: number; // 상대가 여기 두면 (수비 가치)
}

interface Gen {
  list: Cand[];
  fiveS: number;
  fiveO: number[];
  maxS: number;
  sumS: number;
  sumO: number;
}

const mark = new Int32Array(MAX_SIZE);
let markGen = 0;
const nS = new Int8Array(8),
  nO = new Int8Array(8);

function gen(bd: Int8Array, s: Stone, rule: Rule): Gen {
  const T = tables();
  const o = otherStone(s);
  const tS = exactFive(rule, s) ? T.ex : T.loose;
  const tO = exactFive(rule, o) ? T.ex : T.loose;
  const fS = hasForbidden(rule, s),
    fO = hasForbidden(rule, o);
  markGen++;
  const list: Cand[] = [];
  let fiveS = -1;
  const fiveO: number[] = [];
  let maxS = 0,
    sumS = 0,
    sumO = 0;
  for (let p = 0; p < SIZE; p++) {
    if (!bd[p]) continue;
    const px = p % N,
      py = (p / N) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      const yy = py + dy;
      if (yy < 0 || yy >= N) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const xx = px + dx;
        if (xx < 0 || xx >= N) continue;
        const q = yy * N + xx;
        if (bd[q] || mark[q] === markGen) continue;
        mark[q] = markGen;
        shapesAt(bd, q, s, tS, tO, nS, nO);
        let a = scoreOf(nS);
        let b = scoreOf(nO);
        let legal = true;
        if (fS && a < S_FIVE && maybeForbidden(nS, rule) && forbidden(bd, q, s, rule))
          legal = false;
        if (fO && b < S_FIVE && maybeForbidden(nO, rule) && forbidden(bd, q, o, rule)) b = 0; // 상대가 못 두는 자리
        if (b >= S_FIVE) fiveO.push(q);
        if (!legal) {
          sumO += Math.min(b, S_33);
          continue;
        }
        if (a >= S_FIVE && fiveS < 0) fiveS = q;
        if (a > maxS) maxS = a;
        sumS += Math.min(a, S_33);
        sumO += Math.min(b, S_33);
        list.push({ i: q, a, b, k: a + b * 0.85 });
      }
    }
  }
  list.sort((x, y) => y.k - x.k);
  return { list, fiveS, fiveO, maxS, sumS, sumO };
}

function legalFor(bd: Int8Array, i: number, s: Stone, rule: Rule) {
  return bd[i] === 0 && !forbidden(bd, i, s, rule);
}

// ───────────── VCF (연속 4) ─────────────
interface Budget {
  nodes: number;
  deadline: number;
}

/** 방금 i에 둔 s 돌로 생긴 5목 자리 (i 지나는 줄만 확인) */
function fivePointsThrough(bd: Int8Array, i: number, s: Stone, rule: Rule, out: number[]) {
  out.length = 0;
  const x = i % N,
    y = (i / N) | 0;
  for (let d = 0; d < 4; d++) {
    for (let k = -4; k <= 4; k++) {
      if (!k) continue;
      const xx = x + DX[d] * k,
        yy = y + DY[d] * k;
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const q = yy * N + xx;
      if (bd[q] === 0 && !out.includes(q) && makesFive(bd, q, s, rule)) out.push(q);
    }
  }
  return out;
}

function vcf(bd: Int8Array, s: Stone, rule: Rule, depth: number, B: Budget, oppLast = -1): number {
  if (--B.nodes < 0 || performance.now() > B.deadline) return -1;
  const o = otherStone(s);
  const T = tables();
  const tS = exactFive(rule, s) ? T.ex : T.loose;
  const tO = exactFive(rule, o) ? T.ex : T.loose;
  // 상대가 방금 둔 수로 5목 자리가 생겼으면, 내가 바로 5목을 못 만드는 한 VCF 실패
  const g = gen(bd, s, rule);
  if (g.fiveS >= 0) return g.fiveS;
  if (oppLast >= 0 ? fivePointsThrough(bd, oppLast, o, rule, []).length : g.fiveO.length) return -1;
  if (depth <= 0) return -1;
  const comps: number[] = [];
  for (const c of g.list) {
    shapesAt(bd, c.i, s, tS, tO, nS, nO);
    if (!nS[FOUR] && !nS[OPEN4]) continue;
    bd[c.i] = s;
    fivePointsThrough(bd, c.i, s, rule, comps);
    let win = false;
    if (comps.length >= 2) win = true;
    else if (comps.length === 1) {
      const block = comps[0];
      if (!legalFor(bd, block, o, rule))
        win = true; // 상대가 금수라 못 막음
      else {
        bd[block] = o;
        // 막는 수가 상대 5목이면 실패, 아니면 계속 몰기
        if (!makesFiveAfter(bd, block, o, rule)) win = vcf(bd, s, rule, depth - 1, B, block) >= 0;
        bd[block] = 0;
      }
    }
    bd[c.i] = 0;
    if (win) return c.i;
    if (B.nodes < 0) return -1;
  }
  return -1;
}

/** 이미 놓인 돌 i가 5목을 이뤘는지 */
function makesFiveAfter(bd: Int8Array, i: number, s: Stone, rule: Rule) {
  bd[i] = 0;
  const r = makesFive(bd, i, s, rule);
  bd[i] = s;
  return r;
}

// ───────────── 알파-베타 ─────────────
interface Ctx {
  rule: Rule;
  deadline: number;
  stop: boolean;
  nodes: number;
}

function negamax(
  bd: Int8Array,
  s: Stone,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: Ctx
): number {
  if ((++ctx.nodes & 255) === 0 && performance.now() > ctx.deadline) ctx.stop = true;
  if (ctx.stop) return 0;
  const g = gen(bd, s, ctx.rule);
  if (g.fiveS >= 0) return WIN - ply;
  if (g.fiveO.length >= 2) return -(WIN - ply - 1);
  let moves: number[];
  if (g.fiveO.length === 1) {
    const blk = g.fiveO[0];
    if (!g.list.some((c) => c.i === blk)) return -(WIN - ply - 1); // 막을 자리가 금수
    moves = [blk];
  } else {
    if (g.maxS >= S_WIN) return WIN - ply - 2; // 열린4·4-4·4-3을 만들 수 있음
    if (depth <= 0) return g.sumS - g.sumO * 0.9;
    const k = depth >= 4 ? 9 : depth >= 2 ? 8 : 7;
    moves = g.list.slice(0, k).map((c) => c.i);
  }
  if (!moves.length) return 0;
  const o = otherStone(s);
  let best = -Infinity;
  for (const m of moves) {
    bd[m] = s;
    const v = -negamax(bd, o, depth - 1, -beta, -alpha, ply + 1, ctx);
    bd[m] = 0;
    if (ctx.stop) return best === -Infinity ? 0 : best;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

// ───────────── 루트 ─────────────
export function chooseMove(
  board: Int8Array,
  color: Color,
  rule: Rule,
  cfg: AIConfig
): string | null {
  // 판 크기는 넘겨받은 판 칸 수로 (워커는 따로 도는 모듈이라 여기서 맞춤)
  setBoardN(Math.round(Math.sqrt(board.length)));
  const bd = Int8Array.from(board);
  const s = stoneOf(color);
  const o = otherStone(s);
  const start = performance.now();
  const deadline = start + cfg.ms;
  let stones = 0;
  for (let i = 0; i < SIZE; i++) if (bd[i]) stones++;

  if (stones === 0) return sqName(CENTER);
  if (stones === 1 && s === WHITE) {
    // 첫 응수: 흑 돌 바로 옆(대각선 포함)
    let b = 0;
    while (b < SIZE && !bd[b]) b++;
    const opts: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = (b % N) + dx,
          yy = ((b / N) | 0) + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < N && yy < N) opts.push(yy * N + xx);
      }
    // 가운데 쪽 우선
    opts.sort((p, q) => dist2(p) - dist2(q));
    return sqName(opts[Math.floor(Math.random() * Math.min(4, opts.length))]);
  }

  const g = gen(bd, s, rule);
  if (!g.list.length) {
    for (let i = 0; i < SIZE; i++) if (legalFor(bd, i, s, rule)) return sqName(i);
    return null;
  }
  if (g.fiveS >= 0) return sqName(g.fiveS);
  if (g.fiveO.length) {
    const blk = g.fiveO.find((q) => g.list.some((c) => c.i === q));
    return sqName(blk ?? g.list[0].i);
  }

  if (cfg.vcf) {
    const m = vcf(bd, s, rule, 14, { nodes: 6000, deadline: start + cfg.ms * 0.35 });
    if (m >= 0) return sqName(m);
  }

  const rootK = Math.min(g.list.length, cfg.depth >= 4 ? 12 : 10);
  let root = g.list.slice(0, rootK).map((c) => ({ i: c.i, v: c.k, k: c.k }));

  // 실수: 그럴듯한 후보 중 아무거나 (내 승리 수는 안 놓치고, 열린3 막기는 아주 약한 단계만 놓침)
  if (
    Math.random() < cfg.blunder &&
    g.maxS < S_WIN &&
    (cfg.blunder >= 0.3 || g.list[0].b < S_WIN)
  ) {
    const pool = g.list.slice(0, Math.min(6, g.list.length));
    return sqName(pool[Math.floor(Math.random() * pool.length)].i);
  }

  const ctx: Ctx = { rule, deadline, stop: false, nodes: 0 };
  for (let d = 1; d <= cfg.depth; d++) {
    const scored: { i: number; v: number; k: number }[] = [];
    let alpha = -Infinity;
    for (const r of root) {
      bd[r.i] = s;
      const v = -negamax(bd, o, d - 1, -Infinity, -alpha + 1, 1, ctx);
      bd[r.i] = 0;
      if (ctx.stop) break;
      scored.push({ i: r.i, v, k: r.k });
      if (v > alpha) alpha = v;
    }
    if (ctx.stop && scored.length < root.length) {
      // 끝까지 못 본 깊이: 본 것 중 더 좋은 게 있으면 앞으로
      if (scored.length) {
        const top = scored.reduce((a, b) => (b.v > a.v ? b : a));
        const prevBest = root[0];
        if (top.v > (prevBest.v ?? -Infinity)) root = [top, ...root.filter((r) => r.i !== top.i)];
      }
      break;
    }
    scored.sort((a, b) => b.v - a.v || b.k - a.k);
    root = scored;
    if (root[0].v >= WIN - 50) break; // 이기는 수순 찾음
  }

  // 무작위 섞기 (같은 판에서도 다르게, 약한 단계는 엉뚱하게)
  const noisy = root.map((r) => ({
    ...r,
    n: r.v + (cfg.noise ? (Math.random() - 0.5) * cfg.noise * 2000 : Math.random() * 0.5),
  }));
  // 이기는/지는 수는 무작위로 뒤집히지 않게
  noisy.sort((a, b) => {
    const wa = Math.abs(a.v) > WIN / 2,
      wb = Math.abs(b.v) > WIN / 2;
    if (wa || wb) return b.v - a.v;
    return b.n - a.n;
  });

  if (cfg.guard) {
    for (const r of noisy.slice(0, 5)) {
      if (performance.now() > deadline + cfg.ms * 0.5) break;
      if (r.v > WIN / 2) return sqName(r.i);
      bd[r.i] = s;
      const opp = vcf(bd, o, rule, 12, { nodes: 2500, deadline: deadline + cfg.ms * 0.5 }, -1);
      bd[r.i] = 0;
      if (opp < 0) return sqName(r.i);
    }
  }
  return sqName(noisy[0].i);
}

function dist2(i: number) {
  const c = (N - 1) / 2;
  const x = (i % N) - c,
    y = ((i / N) | 0) - c;
  return x * x + y * y;
}
