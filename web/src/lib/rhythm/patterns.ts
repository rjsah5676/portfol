/**
 * 자동 채보의 "손맛" 패턴.
 *
 * 쉼 없이 이어지는 구간(스트림: 노트 사이가 한 박 이하로 4개 이상)을 찾아서,
 * 레인을 음색 순위가 아니라 리듬게임에서 익숙한 패턴으로 깔아 준다.
 *
 * 사람이 짜는 채보에서 배운 원칙 (osu!mania·DJMAX 매퍼 가이드, TaikoNation 논문):
 *  1. 패턴은 많을수록 좋다 — 좋은 채보는 한 곡 안에서 같은 모양을 거의 다시 쓰지 않는다
 *     (사람 채보의 패턴 조합 92%가 서로 다름). 그래서 기본 모양에 좌우 반전·역방향을 곱해
 *     어휘를 늘리고, 이미 쓴 모양·방금 쓴 모양·같은 계열은 뽑힐 확률을 확 낮춘다.
 *  2. 반복은 "변주된 반복"으로 — 같은 패턴을 그대로 끄는 건 최대 2마디. 다음 마디는
 *     반전·역방향 같은 변주로 잇고, 그다음엔 다른 모양으로 넘어간다.
 *  3. 음과 어울리게 — 계단 방향은 음색 흐름(올라가면 →, 내려가면 ←), 동시치기·점프
 *     스트림은 센 구간, 조용한 구간은 단순한 모양.
 *  4. 손이 꼬이지 않게 — 패턴이 바뀌는 자리에서 같은 레인이 바로 또 나오지 않게 시작 위치를
 *     고르고, 같은 레인 연타 간격(jackGap)을 넘는 모양만 쓴다. 한 손 연타(D F D F…)는 짧게.
 *
 *   계단 D F J K · 지그재그 D F J K J F · 3계단 D F J F · S계단 D F J F J K
 *   트릴 D F K J · 벌림 D J F K · 벌림/안쪽/바깥 트릴 D J · F J · D K
 *   W D F D J F K J K · 사다리 D F J F D F J K · 바운스 D J F K J D K F
 *   앵커 D F D J D K · 잭계단 D D F F J J K K · 잭트릴 D D K K
 *   넓은연타 DF JK · 교차연타 DK FJ · 벌림연타 DJ FK · 점프스트림 DF K FJ D JK F DK J
 *   점프버스트 DF J K DF K J
 */
import type { Difficulty } from "./chart";

/** 한 칸: 레인 하나 또는 동시치기 두 레인 */
export type Step = number | [number, number];

export interface Pattern {
  name: string;
  /** 같은 계열(계단·트릴…) — 연달아 같은 계열이 나오지 않게 */
  family: string;
  steps: Step[];
  /** 동시치기 패턴 — 동시치기가 허용되는 난이도에서, 느린 간격에서만 */
  chord?: boolean;
  /** 올라가는/내려가는 짝 (음색 흐름에 맞춰 고름) */
  dir?: 1 | -1;
  /** 뽑힐 가중치 */
  w: number;
  /** 이 길이 이상 구간에서만 */
  minLen: number;
  /** 이 난이도부터 (0 쉬움 … 4 나이트메어) */
  tier: number;
  /** 세기 0~1에 따른 가중치 배율: [조용할 때, 셀 때] */
  mood?: [number, number];
}

const TIER: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2, expert: 3, nightmare: 4 };

/** 기본 모양 — 좌우 반전·역방향은 아래에서 자동으로 만든다 */
const BASE: Pattern[] = [
  { name: "stair", family: "stair", steps: [0, 1, 2, 3], dir: 1, w: 3, minLen: 4, tier: 0 },
  {
    name: "zigzag",
    family: "zigzag",
    steps: [0, 1, 2, 3, 2, 1],
    w: 2.5,
    minLen: 6,
    tier: 0,
  },
  { name: "stair3", family: "stair3", steps: [0, 1, 2, 1], dir: 1, w: 1.5, minLen: 4, tier: 0 },
  {
    name: "s-stair",
    family: "stair3",
    steps: [0, 1, 2, 1, 2, 3],
    dir: 1,
    w: 1.8,
    minLen: 6,
    tier: 0,
  },
  { name: "trill", family: "trill", steps: [0, 1, 3, 2], w: 2, minLen: 4, tier: 0 },
  { name: "split", family: "split", steps: [0, 2, 1, 3], dir: 1, w: 1.3, minLen: 4, tier: 0 },
  // 네 레인을 다 쓰는 긴 모양 (한 바퀴 8칸): 같은 레인이 2칸 안에 안 돌아옴
  { name: "w", family: "wave", steps: [0, 1, 0, 2, 1, 3, 2, 3], w: 1.4, minLen: 8, tier: 1 },
  {
    name: "ladder",
    family: "wave",
    steps: [0, 1, 2, 1, 0, 1, 2, 3],
    dir: 1,
    w: 1.3,
    minLen: 8,
    tier: 1,
  },
  { name: "bounce", family: "split", steps: [0, 2, 1, 3, 2, 0, 3, 1], w: 1.2, minLen: 8, tier: 1 },
  {
    name: "pendulum",
    family: "wave",
    steps: [1, 0, 2, 1, 3, 2],
    dir: 1,
    w: 1.2,
    minLen: 6,
    tier: 1,
  },
  // 두 레인 트릴: 양손(벌림·안쪽·바깥)은 길어도 괜찮고, 한 손(D F)은 짧게만
  { name: "split-trill", family: "trill2", steps: [0, 2], w: 1.3, minLen: 4, tier: 0 },
  { name: "inner-trill", family: "trill2", steps: [1, 2], w: 1.1, minLen: 4, tier: 0 },
  { name: "outer-trill", family: "trill2", steps: [0, 3], w: 1.0, minLen: 4, tier: 0 },
  { name: "alt-L", family: "alt", steps: [0, 1], w: 0.5, minLen: 4, tier: 0 },
  {
    name: "alt-switch",
    family: "alt",
    steps: [0, 1, 0, 1, 2, 3, 2, 3],
    w: 1.6,
    minLen: 8,
    tier: 0,
  },
  // 앵커: 한 레인을 축으로 (D F D J D K) — 8분 이상 간격에서
  {
    name: "anchor",
    family: "anchor",
    steps: [0, 1, 0, 2, 0, 3],
    dir: 1,
    w: 1.3,
    minLen: 6,
    tier: 2,
  },
  { name: "anchor-in", family: "anchor", steps: [1, 0, 1, 2, 1, 3], w: 1.0, minLen: 6, tier: 2 },
  // 잭(같은 레인 두 번): 연타 간격을 넘는 느린 간격에서만 통과되므로 자연히 어려움↑에서만
  {
    name: "jack-stair",
    family: "jack",
    steps: [0, 0, 1, 1, 2, 2, 3, 3],
    dir: 1,
    w: 0.9,
    minLen: 8,
    tier: 2,
  },
  { name: "jack-trill", family: "jack", steps: [0, 0, 3, 3], w: 0.6, minLen: 4, tier: 3 },
  {
    name: "triangle",
    family: "zigzag",
    steps: [0, 1, 2, 3, 3, 2, 1, 0],
    w: 0.9,
    minLen: 8,
    tier: 2,
  },
  // 동시치기 (센 구간에서)
  {
    name: "wide",
    family: "jump",
    steps: [
      [0, 1],
      [2, 3],
    ],
    chord: true,
    // 두 모양만 번갈아 → 길면 지루해서 가볍게 (섞인 점프스트림 쪽을 더 자주)
    w: 0.8,
    minLen: 4,
    tier: 1,
    mood: [0.4, 1.6],
  },
  {
    name: "cross-jump",
    family: "jump",
    steps: [
      [0, 3],
      [1, 2],
    ],
    chord: true,
    // DK FJ DK FJ… 가 너무 자주 나와서 확 줄임
    w: 0.35,
    minLen: 4,
    tier: 1,
    mood: [0.4, 1.6],
  },
  {
    name: "split-jump",
    family: "jump",
    steps: [
      [0, 2],
      [1, 3],
    ],
    chord: true,
    w: 0.7,
    minLen: 4,
    tier: 2,
    mood: [0.4, 1.6],
  },
  // 점프스트림: 동시치기와 단노트가 번갈아 (DF K FJ D JK F DK J)
  {
    name: "jumpstream",
    family: "jumpstream",
    steps: [[0, 1], 3, [1, 2], 0, [2, 3], 1, [0, 3], 2],
    chord: true,
    w: 2.2,
    minLen: 8,
    tier: 2,
    mood: [0.3, 1.8],
  },
  // 점프버스트: 동시치기 뒤 단노트 두 개 (DF J K DF K J)
  {
    name: "jumpburst",
    family: "jumpstream",
    steps: [[0, 1], 2, 3, [0, 1], 3, 2],
    chord: true,
    w: 1.4,
    minLen: 6,
    tier: 2,
    mood: [0.3, 1.6],
  },
];

const mirrorStep = (s: Step): Step =>
  typeof s === "number" ? 3 - s : ([3 - s[0], 3 - s[1]].sort((a, b) => a - b) as [number, number]);
/** 회전해서 같아지는 모양은 하나로 (0 3 1 2 는 3 1 2 0 과 같은 바퀴) */
function keyOf(steps: Step[]) {
  const one = (arr: Step[]) => arr.map((s) => (typeof s === "number" ? s : s.join("+"))).join(",");
  let best = "";
  for (let r = 0; r < steps.length; r++) {
    const k = one([...steps.slice(r), ...steps.slice(0, r)]);
    if (!best || k < best) best = k;
  }
  return best;
}

/**
 * 어휘 만들기: 기본 모양 + 좌우 반전 + 역방향(+반전) — 같은 모양이 되면 하나로.
 * 반전·역방향은 방향(dir)이 뒤집힌다.
 */
function expand(base: Pattern[]): Pattern[] {
  const out: Pattern[] = [];
  const seen = new Set<string>();
  const add = (p: Pattern) => {
    const k = keyOf(p.steps);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  for (const p of base) {
    add(p);
    const flip = (d?: 1 | -1) => (d ? (-d as 1 | -1) : undefined);
    add({ ...p, name: `${p.name}'`, steps: p.steps.map(mirrorStep), dir: flip(p.dir) });
    add({ ...p, name: `${p.name}<`, steps: [...p.steps].reverse(), dir: flip(p.dir) });
    add({ ...p, name: `${p.name}<'`, steps: [...p.steps].reverse().map(mirrorStep), dir: p.dir });
  }
  return out;
}

export const PATTERNS: Pattern[] = expand(BASE);
/** 변주 짝: 같은 기본 모양의 반전·역방향 (이름에서 ' < 를 뗀 것이 같음) */
const shapeOf = (p: Pattern) => p.name.replace(/['<]+$/, "");

export const lanesOf = (s: Step): number[] => (typeof s === "number" ? [s] : s);
const hand = (l: number) => (l < 2 ? 0 : 1);

/** 같은 레인이 다시 나오기까지 최소 몇 칸인지 (연타 간격 검사용) */
function reuseGap(p: Pattern) {
  let min = Infinity;
  const n = p.steps.length;
  for (let i = 0; i < n; i++)
    for (const l of lanesOf(p.steps[i]))
      for (let d = 1; d <= n; d++)
        if (lanesOf(p.steps[(i + d) % n]).includes(l)) {
          min = Math.min(min, d);
          break;
        }
  return min;
}
const GAP = new Map(PATTERNS.map((p) => [p, reuseGap(p)]));

/** 스트림의 한 칸(같은 시각의 노트 묶음) */
export interface Slot {
  t: number;
  /** 음색 높이 (없으면 0) */
  cen: number;
  /** 이 시각에 노트가 몇 개인지 (1 또는 2) */
  count: number;
}

export interface PatternCtx {
  diff: Difficulty;
  beatSec: number;
  /** 같은 레인 연타 최소 간격(초) */
  jackGap: number;
  /** 동시치기 허용 여부 */
  chords: boolean;
  /** 마디 번호 */
  barOf: (t: number) => number;
  /** 마디 세기 0~1 */
  intensity: (bar: number) => number;
  /** 0~1 난수 (고정 시드) */
  rnd: () => number;
  /** 진단용: 조각마다 고른 패턴 */
  onPick?: (name: string, bar: number, len: number) => void;
}

/** 간격 g가 어느 음표쯤인지: 1 = 4분, 2 = 8분, 4 = 16분 이상 */
function subdivision(g: number, beatSec: number): 1 | 2 | 4 {
  if (g >= beatSec * 0.75) return 1;
  if (g >= beatSec * 0.375) return 2;
  return 4;
}

/** 곡 전체에서 패턴을 얼마나 썼는지 — 다양성 유지용 */
interface History {
  /** 최근 동시치기 모양 (짝 고를 때 같은 모양이 번갈아 반복되지 않게) */
  chords: string[];
  /** 모양(반전·역방향 묶음)별 사용 횟수 */
  shape: Map<string, number>;
  /** 최근에 고른 모양 (오래된 것부터) */
  recent: string[];
  lastFamily: string | null;
}

/**
 * 스트림을 찾아 패턴 레인을 매긴다.
 * @returns slot index → 레인들 (count만큼). 패턴에 안 들어간 칸은 없음.
 */
export function assignPatterns(slots: Slot[], ctx: PatternCtx): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const hist: History = { chords: [], shape: new Map(), recent: [], lastFamily: null };
  // 쉬움·보통은 노트가 띄엄띄엄이라 2박까지를 "이어진다"고 봄 (D _ F _ J _ K 도 계단으로 읽힘)
  // 나이트메어도 2박: 거의 모든 노트를 패턴 안에 넣기 위해
  const maxGap =
    ctx.beatSec *
    (ctx.diff === "easy" || ctx.diff === "normal" || ctx.diff === "nightmare" ? 2.1 : 1.05);
  let i = 0;
  while (i < slots.length - 3) {
    let j = i;
    while (j + 1 < slots.length && slots[j + 1].t - slots[j].t <= maxGap) j++;
    if (j - i + 1 >= 4) layStream(slots, i, j, ctx, out, hist);
    i = j + 1;
  }
  return out;
}

const prevOf = (out: Map<number, number[]>, k: number) => (k > 0 && out.get(k - 1)) || [];

/** 패턴을 시작할 위치: 바로 앞 칸(이미 정해진 레인)과 같은 레인·같은 손으로 시작하지 않게 */
function bestOffset(pat: Pattern, prevLanes: number[]) {
  const n = pat.steps.length;
  let bestOff = 0;
  let bestScore = -Infinity;
  for (let off = 0; off < n; off++) {
    const first = lanesOf(pat.steps[off]);
    let sc = 0;
    if (first.some((l) => prevLanes.includes(l))) sc -= 10;
    if (prevLanes.length && first.every((l) => prevLanes.every((pl) => hand(pl) !== hand(l))))
      sc += 2;
    if (off === 0) sc += 1; // 가능하면 패턴 처음부터
    if (sc > bestScore) {
      bestScore = sc;
      bestOff = off;
    }
  }
  return bestOff;
}

function layStream(
  slots: Slot[],
  from: number,
  to: number,
  ctx: PatternCtx,
  out: Map<number, number[]>,
  hist: History
) {
  // 마디 경계로 끊어 조각(chunk)으로 — 너무 짧은 꼬리는 앞 조각에 붙임
  const chunks: [number, number][] = [];
  let s = from;
  for (let k = from + 1; k <= to; k++)
    if (ctx.barOf(slots[k].t) !== ctx.barOf(slots[k - 1].t)) {
      chunks.push([s, k - 1]);
      s = k;
    }
  chunks.push([s, to]);
  for (let k = chunks.length - 1; k > 0; k--)
    if (chunks[k][1] - chunks[k][0] + 1 < 3) {
      chunks[k - 1][1] = chunks[k][1];
      chunks.splice(k, 1);
    }
  if (chunks[0][1] - chunks[0][0] + 1 < 3 && chunks.length > 1) {
    chunks[1][0] = chunks[0][0];
    chunks.splice(0, 1);
  }
  // 16분으로 꽉 찬 마디(12칸 이상)는 반 마디씩 — 한 마디 내내 같은 4칸 모양이 네 바퀴 도는 대신
  // 뒷 반 마디는 변주(반전·역방향)나 다른 모양으로
  for (let k = chunks.length - 1; k >= 0; k--) {
    const [a, b] = chunks[k];
    if (b - a + 1 >= 12) {
      const mid = a + Math.ceil((b - a + 1) / 2);
      chunks.splice(k, 1, [a, mid - 1], [mid, b]);
    }
  }

  const tier = TIER[ctx.diff];
  let cur: Pattern | null = null;
  let phase = 0;
  let kept = 0; // 같은 모양을 몇 마디째 이어 가는지
  const oneHand = (p: Pattern | null) => !!p && p.name.startsWith("alt-L");
  const remember = (p: Pattern) => {
    const sh = shapeOf(p);
    hist.shape.set(sh, (hist.shape.get(sh) ?? 0) + 1);
    hist.recent.push(sh);
    if (hist.recent.length > 4) hist.recent.shift();
    hist.lastFamily = p.family;
  };

  for (const [a, b] of chunks) {
    const len = b - a + 1;
    // 이 조각의 가장 촘촘한 간격 기준으로 쓸 수 있는 패턴 (같은 레인 연타 간격 지키기)
    let g = Infinity;
    for (let k = a; k < b; k++) g = Math.min(g, slots[k + 1].t - slots[k].t);
    const sub = subdivision(g, ctx.beatSec);
    // 동시치기 패턴은 느린 간격에서만: 어려움·매우 어려움은 8분까지, 보통은 4분만
    const chordOk =
      ctx.chords &&
      (ctx.diff === "normal"
        ? sub === 1
        : ctx.diff === "easy"
          ? false
          : ctx.diff === "nightmare"
            ? true
            : sub <= 2);
    const usable = (p: Pattern) =>
      p.tier <= tier && (!p.chord || chordOk) && GAP.get(p)! * g >= ctx.jackGap - 1e-6;
    const allowed = PATTERNS.filter(usable);
    if (!allowed.length) {
      cur = null;
      continue;
    }
    // 음색 흐름: 올라가면 1, 내려가면 -1
    const slope = slots[b].cen - slots[a].cen;
    const dir: 1 | -1 | 0 = Math.abs(slope) < 0.06 ? 0 : slope > 0 ? 1 : -1;
    const I = ctx.intensity(ctx.barOf(slots[a].t));

    // ── 이어 가기: 같은 모양을 변주하며 최대 2마디 더 (그대로 1번, 그 뒤엔 반전·역방향만) ──
    let next: Pattern | null = null;
    if (cur && !oneHand(cur) && kept < 2) {
      const pKeep = kept === 0 ? 0.6 : 0.3;
      if (ctx.rnd() < pKeep) {
        const sh = shapeOf(cur);
        const variants = allowed.filter((p) => shapeOf(p) === sh && len >= p.minLen);
        const cands = variants.map((p) => ({
          p,
          // 그대로는 처음 한 번만, 변주는 흐름 방향이 맞으면 더
          w: p === cur ? (kept === 0 ? 1 : 0) : p.dir && dir && p.dir !== dir ? 0.4 : 1,
        }));
        next = pick(cands, ctx.rnd);
      }
    }
    if (next) {
      kept++;
      if (next !== cur) {
        // 변주로 바꿀 땐 손이 꼬이지 않는 자리에서 시작
        cur = next;
        phase = bestOffset(cur, prevOf(out, a));
      }
    } else {
      // ── 새 모양: 안 쓴 모양·안 쓴 계열 우선 ──
      const cands = allowed
        .filter((p) => len >= p.minLen && (!cur || shapeOf(p) !== shapeOf(cur)))
        .map((p) => {
          let w = p.w;
          if (p.dir && dir && p.dir !== dir) w *= 0.25; // 흐름과 반대 방향은 드물게
          if (p.mood) w *= p.mood[0] + (p.mood[1] - p.mood[0]) * I; // 동시치기는 센 구간에서
          if (p.chord && sub === 4) w *= 0.35; // 16분 동시치기 연타는 드물게
          if (p.family === "alt" && sub === 4) w *= 1.3; // 16분은 연타가 제맛
          if (p.family === "stair" && len >= 8) w *= 1.3;
          if (len >= 8 && p.steps.length <= 4 && !p.chord) w *= 0.7; // 긴 조각엔 긴 모양을
          if (p.family === "jack" && I < 0.5) w *= 0.3; // 잭은 센 구간에서만
          // 다양성: 이미 쓴 모양은 쓴 만큼 덜, 최근 4조각 안에 나온 모양은 거의 안, 같은 계열 연속도 덜
          const sh = shapeOf(p);
          w /= 1 + 0.8 * (hist.shape.get(sh) ?? 0);
          if (hist.recent.includes(sh)) w *= 0.12;
          if (p.family === hist.lastFamily) w *= 0.4;
          return { p, w };
        });
      cur = pick(cands, ctx.rnd);
      if (!cur) continue;
      kept = 0;
      // 한 손 연타가 8개 넘게 이어지면 손을 바꿔 가며 (D F D F J K J K)
      if (oneHand(cur) && len > 8) cur = PATTERNS.find((p) => p.name === "alt-switch")!;
      phase = bestOffset(cur, prevOf(out, a));
      remember(cur);
    }
    const pat = cur;
    ctx.onPick?.(pat.name, ctx.barOf(slots[a].t), len);
    const stepAt = (ph: number) =>
      lanesOf(pat.steps[((ph % pat.steps.length) + pat.steps.length) % pat.steps.length]);
    for (let k = a; k <= b; k++, phase++) {
      const lanes = stepAt(phase);
      if (lanes.length >= slots[k].count) {
        out.set(k, lanes.slice(0, Math.max(1, slots[k].count)));
        continue;
      }
      // 이 칸은 패턴보다 두꺼운 동시치기(2개·3개): 모자란 짝은 앞뒤 칸과 겹치지 않게, 최근 모양과 다르게
      const main = lanes[0];
      const near = new Set([...stepAt(phase + 1), ...(k > a ? stepAt(phase - 1) : prevOf(out, k))]);
      const partners = chordPartners(main, slots[k].count - lanes.length, {
        avoid: near,
        ok: (l) => !lanes.includes(l),
        recent: hist.chords,
        rnd: ctx.rnd,
      });
      out.set(k, [...lanes, ...partners]);
    }
  }
}

/**
 * 동시치기 짝 레인 고르기 — 늘 거울 모양(D+K, F+J)만 나와 DK FJ DK FJ 처럼 번갈지 않게.
 * 바로 앞 줄에 쓴 레인(avoid)·최근 두 동시치기와 같은 모양은 피하고, 나머지는 섞어서 고름.
 * recent에 고른 모양을 쌓음 (최근 3개).
 */
/** osu 랭크 4K 2노트 동시치기 모양 빈도(한 손 01·23, 양끝 03이 흔하고 가운데·대각은 덜) */
const PAIR_W: Record<string, number> = {
  "01": 1,
  "23": 1,
  "03": 0.95,
  "12": 0.5,
  "02": 0.55,
  "13": 0.55,
};

export function chordPartners(
  main: number,
  n: number,
  opts: { avoid: Set<number>; ok: (l: number) => boolean; recent: string[]; rnd: () => number }
): number[] {
  const picked: number[] = [];
  const shapeOf = (ls: number[]) => [...ls].sort((x, y) => x - y).join("");
  for (let c = 0; c < n; c++) {
    const cands = [0, 1, 2, 3].filter((l) => l !== main && !picked.includes(l) && opts.ok(l));
    if (!cands.length) break;
    const score = (l: number) => {
      const shape = shapeOf([main, ...picked, l]);
      const r = opts.recent;
      return (
        (opts.avoid.has(l) ? 3 : 0) +
        (shape === r[r.length - 1] ? 2.5 : 0) +
        (shape === r[r.length - 2] ? 2 : 0) +
        (shape === r[r.length - 3] ? 0.8 : 0) +
        (1 - (PAIR_W[shape] ?? 0.8)) * 1.5 +
        opts.rnd() * 1.5
      );
    };
    cands.sort((x, y) => score(x) - score(y));
    picked.push(cands[0]);
  }
  if (picked.length) {
    opts.recent.push(shapeOf([main, ...picked]));
    if (opts.recent.length > 3) opts.recent.shift();
  }
  return picked;
}

/** 가중치 뽑기 (가중치 합이 0이면 null) */
function pick(cands: { p: Pattern; w: number }[], rnd: () => number): Pattern | null {
  const total = cands.reduce((acc, c) => acc + c.w, 0);
  if (!cands.length || total <= 0) return null;
  let r = rnd() * total;
  for (const c of cands) {
    r -= c.w;
    if (r <= 0) return c.p;
  }
  return cands[cands.length - 1].p;
}
