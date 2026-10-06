/**
 * 분석 결과(analyze.ts) → 난이도별 4키 채보.
 *  - 난이도마다 목표 밀도(초당 노트)에 맞춰 강한 타격부터 고름
 *  - 정박(4분) > 8분 > 16분 순으로 우선 (쉬울수록 정박 위주)
 *  - 레인은 음색 높이(높은 소리 → 오른쪽), 같은 레인 연타는 피함
 *  - 킥+심벌처럼 저음·고음이 같이 크게 터지는 정박은 동시치기
 *  - 다음 타격까지 소리가 길게 이어지면 롱노트
 *
 * 사람이 짠 채보처럼 보이게 하는 다듬기:
 *  - 곡의 세기(마디별 음량)를 따라 밀도를 올렸다 내림 — 코러스는 빽빽하게, 브레이크는 비우고,
 *    드롭 직전 2마디는 빌드업으로 조금 더 채움
 *  - 세기가 확 커지는 마디(드롭·코러스 진입)의 첫 노트는 동시치기
 *  - 빠른 연속 노트는 왼손(D F)·오른손(J K)을 번갈아 치게 배치
 *  - 같은 프레이즈가 반복되면(마디의 타격 배치가 같으면) 같은 노트 배치를 다시 씀 → 외워서 치는 재미
 *  - 타격이 고르게 이어지는 구간(스트림)은 계단·연타·트릴 같은 익숙한 패턴으로 깔아 줌 (patterns.ts)
 */
import type { Analysis, Onset } from "./analyze";
import { DIV_TRIPLET, FPS, displayBpm, gridPos } from "./analyze";
import { finishChart, type Chart, type Difficulty, type Note } from "./chart";
import { assignPatterns, chordPartners, type PatternCtx } from "./patterns";
import { starRating } from "./stars";

interface AutoRule {
  /** 목표 초당 노트 수 (곡에 타격이 그만큼 없으면 그보다 적게) */
  nps: number;
  minGap: number;
  jackGap: number;
  /** 격자 위치별 가중치 [정박, 8분, 16분, 32분, 격자 밖] */
  pos: [number, number, number, number, number];
  /** 16분 자리 타격은 이 세기 이상일 때만 (어려움은 8분 위주 — osu 어려움은 16분이 3%) */
  fineNeed?: number;
  /** 이 세기 미만 타격은 버림 */
  floor: number;
  /** 동시치기: 어느 위치에서, 얼마나 세야 */
  chord: { every: number; need: number } | null;
  /** 롱노트가 되려면 다음 노트까지 최소 비트 수 */
  holdBeats: number;
  /**
   * 박 위치별 평균 동시 노트 수 [정박, 반박(셋잇단은 1/3·2/3박), 그 밖].
   * 위치마다 센 타격부터 이 평균이 될 때까지 동시치기(2개, 넘치면 3개)로 만듦
   */
  thick: [number, number, number];
  /** 정박 줄 중 3개 동시치기로 만들 비율 (센 타격부터) — osu: 3개짜리가 줄의 1 · 4 · 8% (어려움·매우 어려움·나이트메어), 거의 정박 */
  tri: number;
  /** 바로 앞 줄과 같은 레인(잭)을 그대로 둘 확률 — 낮을수록 옆 레인으로 피함 */
  jackAllow: number;
  /** 같은 레인 최대 연속 */
  jackRun: number;
  /** 롱노트: 노트 중 비율, 길이(박) 후보, 최대 길이(초), 정박에서 시작하는 비율 */
  ln: { ratio: number; lens: number[]; maxSec: number; onBeat: number };
}

// 목표값은 osu!mania 4키 랭크 채보(150곡 722채보)를 같은 별점 구간에서 잰 중앙값.
// 난이도별 별점: 쉬움 ≈0.75★ · 보통 1.5 · 어려움 2.25 · 매우 어려움 3.25 · 나이트메어 4★ (레벨 = 별점 × 4)
//   (osu 곡의 가장 쉬운 채보가 Lv6 안팎이라 쉬움(Lv3)은 osu에 거의 없는 영역 — 가장 쉬운 채보 쪽으로)
//   정박 / 반박 / 16분 자리 비율       99/1/0 · 82/15/0 · 58/35/2 · 43/36/18 · 38/33/24
//   동시치기 줄 비율 (3개짜리)         3 · 9 · 24 · 32 (1) · 39 (5)%
//   (보통은 5% 안팎으로 — 동시치기가 별점을 크게 올려서, 같은 레벨이면 동시치기 대신 노트를 고르게 더 깖)
//   잭(앞 줄과 같은 레인)              1 · 5 · 8 · 9 · 14%
//   롱노트 비율·길이                   21%·0.7초 · 12%·0.37초 · 10%·0.27초 · 9%·0.17초 · 6%·0.16초
//   (롱노트는 어려움부터 osu의 절반쯤으로 — 실제로 쳐보니 그대로는 많게 느껴짐. 짧은 롱노트는 빼고 최소 0.33초·거의 한 박부터)
//   같은 별점이면 osu가 우리보다 노트가 많음 — 동시치기·잭·연타처럼 별점을 튀게 하는 자리가 적어서.
//   그래서 레벨이 맞은 뒤에도 밀도를 올려 보며 같은 레벨에서 가장 빽빽한 채보를 고름(makeAutoCharts)
const AUTO_RULES: Record<Difficulty, AutoRule> = {
  easy: {
    nps: 3,
    minGap: 0.2,
    jackGap: 0.5,
    pos: [1, 0.25, 0.02, 0, 0],
    floor: 0.15,
    chord: { every: 16, need: 0.6 },
    holdBeats: 2,
    thick: [1.02, 1, 1],
    tri: 0,
    jackAllow: 0.04,
    jackRun: 2,
    ln: { ratio: 0.12, lens: [1, 1, 2, 2, 3], maxSec: 1, onBeat: 0.95 },
  },
  normal: {
    nps: 5,
    minGap: 0.15,
    jackGap: 0.3,
    pos: [1, 0.35, 0.02, 0, 0],
    floor: 0.1,
    chord: { every: 4, need: 0.45 },
    holdBeats: 1.5,
    thick: [1.05, 1.02, 1],
    tri: 0,
    jackAllow: 0.08,
    jackRun: 2,
    ln: { ratio: 0.09, lens: [1, 1, 1, 2, 2], maxSec: 0.8, onBeat: 0.94 },
  },
  hard: {
    nps: 8.5,
    minGap: 0.08,
    jackGap: 0.17,
    pos: [1, 0.85, 0.12, 0.03, 0],
    fineNeed: 0.6,
    floor: 0.07,
    chord: { every: 2, need: 0.45 },
    holdBeats: 1.5,
    thick: [1.37, 1.1, 1.05],
    tri: 0.04,
    jackAllow: 0.2,
    jackRun: 3,
    ln: { ratio: 0.04, lens: [1, 1, 1.5, 2], maxSec: 0.9, onBeat: 0.81 },
  },
  expert: {
    nps: 11.3,
    minGap: 0.075,
    jackGap: 0.12,
    pos: [1, 1, 0.75, 0.45, 0.2],
    floor: 0.05,
    chord: { every: 2, need: 0.4 },
    holdBeats: 1.25,
    thick: [1.69, 1.2, 1.06],
    tri: 0.06,
    jackAllow: 0.25,
    jackRun: 3,
    ln: { ratio: 0.04, lens: [1, 1, 1, 1.5, 2], maxSec: 0.8, onBeat: 0.69 },
  },
  // 나이트메어: 매우 어려움보다 촘촘하게 고른 뒤, 센 마디는 16분으로 꽉 채우고 패턴으로만 레인을 깖 (아래 nightmareNotes)
  nightmare: {
    nps: 13,
    minGap: 0.072,
    jackGap: 0.1,
    pos: [1, 1, 0.95, 0.85, 0.5],
    floor: 0.04,
    chord: { every: 2, need: 0.35 },
    holdBeats: 1.25,
    thick: [1.5, 1.15, 1.05],
    tri: 0.25,
    jackAllow: 0.5,
    jackRun: 4,
    ln: { ratio: 0.03, lens: [1, 1, 1, 1.5], maxSec: 0.7, onBeat: 0.63 },
  },
};

/** 나이트메어 채우기 설정 (곡별 손보기 가능) */
export interface NightmareTweak {
  /** 이 세기(0~1) 이상인 마디는 8분으로 채움 */
  loud?: number;
  /** 이 세기 이상인 마디는 16분으로 꽉 채우고 박마다 동시치기 */
  full?: number;
  /** 센 마디 박 등분 (2 = 8분, 3 = 셋잇단) */
  loudSub?: number;
  /** 아주 센 마디 박 등분 (4 = 16분, 6 = 16분 셋잇단) */
  fullSub?: number;
  /** 박당 동시치기 수: 센 마디 / 아주 센 마디 */
  chordLoud?: number;
  chordFull?: number;
  /** 몇 마디마다 마지막 박을 연타로 (아주 센 마디) */
  burstEvery?: number;
  /** 연타 등분 (8 = 32분, 6 = 16분 셋잇단 — 기본은 6: 32분은 빠른 곡에서 못 칠 만큼 촘촘) */
  burstSub?: number;
}
const NIGHTMARE_DEFAULT: Required<NightmareTweak> = {
  loud: 0.45,
  full: 0.72,
  loudSub: 2,
  fullSub: 4,
  chordLoud: 1,
  chordFull: 2,
  burstEvery: 8,
  burstSub: 6,
};

function nearestCen(an: Analysis, t: number) {
  let best = 0;
  let bd = Infinity;
  for (const o of an.onsets) {
    const d = Math.abs(o.t - t);
    if (d < bd) {
      bd = d;
      best = o.cen;
    }
  }
  return best;
}

/**
 * 타격의 박 위치: 0 정박 · 1 8분 · 2 16분 · 3 그 사이 · 4 격자 밖.
 * 셋잇단 격자(12/8·셔플, div 12)는 점4분 한 박을 셋으로 나눈 자리(4·8칸)가 그 곡의 '8분',
 * 여섯으로 나눈 자리(2·6·10칸)가 '16분' — 4/4 곡의 8분·16분과 같은 무게로 고름
 */
const posKind = (o: Onset, div: number) => {
  if (o.grid < 0) return 4;
  if (div !== DIV_TRIPLET) return gridPos(o.grid, div);
  const g = ((o.grid % div) + div) % div;
  return g === 0 ? 0 : g % 4 === 0 ? 1 : g % 2 === 0 ? 2 : 3;
};

/** 정렬된 시각 배열에서 t 근처(±gap)에 이미 있는지 */
function tooClose(sorted: number[], t: number, gap: number) {
  let a = 0;
  let b = sorted.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (sorted[m] < t) a = m + 1;
    else b = m;
  }
  return (
    (a < sorted.length && sorted[a] - t < gap - 1e-6) || (a > 0 && t - sorted[a - 1] < gap - 1e-6)
  );
}

/** 곡별 손보기: 기본 규칙 위에 덮어씀 (내장곡 채보를 뽑을 때 난이도 목표에 맞추려고) */
export interface AutoTweak {
  /** 목표 밀도 배율 (1.3이면 30% 더 빽빽하게) */
  density?: number;
  /** 동시치기 간격(16분음표 단위)·필요 세기 */
  chordEvery?: number;
  chordNeed?: number;
  /** 세분 칸(32분·셋잇단) 가중치 */
  finePos?: number;
  /** 나이트메어 채우기 */
  nightmare?: NightmareTweak;
  /**
   * 격자 채우기 0~1 (어려움·매우 어려움·나이트메어): 곡에서 찾은 타격만으로 목표 밀도가 안 나올 때
   * 센 마디에 8분(어려움)·16분(매우 어려움) 자리를 더함. 클수록 덜 센 마디까지 채움
   */
  fill?: number;
  /** 다른 난이도의 규칙을 빌려 씀 (보스곡의 쉬움을 어려움 규칙 절반 밀도로 뽑는 식) */
  rule?: Difficulty;
  /** 목표 레벨을 직접 (내장곡: 직접 쳐 보고 정한 레벨) — 없으면 TARGET_LEVEL */
  level?: number;
  /** 진단용: 패턴을 고를 때마다 (이름, 마디, 길이) */
  onPick?: PatternCtx["onPick"];
}

/**
 * @param shiftMs 곡별 보정(ms, +면 노트가 늦게) — 지금은 안 씀(0)
 */
export function makeAutoChart(
  an: Analysis,
  diff: Difficulty,
  shiftMs = 0,
  tweak: AutoTweak = {}
): Chart {
  const base = AUTO_RULES[tweak.rule ?? diff];
  const R: AutoRule = {
    ...base,
    nps: base.nps * (tweak.density ?? 1),
    pos: [...base.pos] as AutoRule["pos"],
    chord:
      base.chord && (tweak.chordEvery || tweak.chordNeed)
        ? {
            every: tweak.chordEvery ?? base.chord.every,
            need: tweak.chordNeed ?? base.chord.need,
          }
        : base.chord,
  };
  if (tweak.finePos !== undefined) R.pos[3] = tweak.finePos;
  const beatSec = 60 / an.bpm;
  // 격자 한 칸이 70ms보다 좁은 빠른 곡: 홀수 칸(4/4는 32분, 12/8은 셋잇단 16분 사이)·격자 밖 타격은 안 씀.
  // 바로 옆 칸에 붙어 '살짝 어긋난 동시치기'가 되거나, 일정하던 간격이 갑자기 1.5배가 되는 엇박이 됨
  // (12/8의 셋잇단 8분·16분은 짝수 칸이라 그대로)
  const tightGrid = beatSec / an.div < 0.07;
  if (tightGrid) R.pos[4] = 0;
  // 노트 사이 최소 72ms — 그보다 붙으면 손으로는 동시치기처럼 느껴져서 '살짝 어긋난 동시치기'가 됨
  R.minGap = Math.max(R.minGap, 0.072);
  // 쉬움·보통: 최소 간격을 박 단위로 — 쉬움은 한 박(느린 곡은 반 박, 아주 빠른 곡은 두 박),
  // 보통은 반 박(빠른 곡은 한 박). 박에서 어긋난 짧은 간격이 별점만 올리고 치기엔 어색해서
  // (osu 쉬운 채보는 정박·반박만, 간격이 고름)
  if (diff === "easy" || diff === "normal") {
    let g = diff === "easy" ? beatSec : beatSec / 2;
    const lo = diff === "easy" ? 0.3 : 0.15;
    while (g < lo) g *= 2;
    while (diff === "easy" && g / 2 >= lo && g > 0.6) g /= 2;
    R.minGap = Math.max(R.minGap, g * 0.9);
  }
  const cands = an.onsets
    // 격자 밖 타격(셋잇단·싱커페이션 등)은 아주 셀 때만
    .filter(
      (o) =>
        o.s >= R.floor &&
        R.pos[posKind(o, an.div)] > 0 &&
        // 격자 채우기(fill)로도 레벨이 모자란 곡은 16분 타격도 차츰 허용
        (posKind(o, an.div) < 2 || o.s >= (R.fineNeed ?? 0) - 0.6 * (tweak.fill ?? 0)) &&
        (o.grid >= 0 || o.s >= 0.5) &&
        !(tightGrid && o.grid % 2 !== 0)
    )
    .map((o) => ({
      o,
      w: o.s * R.pos[posKind(o, an.div)] * (0.8 + 0.2 * Math.max(o.low, o.mid)),
    }))
    .sort((a, b) => b.w - a.w);

  // ── 마디·세기 ──
  const barSec = beatSec * 4;
  // 마디 첫 박: 4박 중 저음(킥)이 가장 센 자리를 첫 박으로
  const beats = an.beats;
  const lowAtBeat = (t: number) => {
    let v = 0;
    for (const o of an.onsets) if (Math.abs(o.t - t) < 0.03) v = Math.max(v, o.low * o.s);
    return v;
  };
  let phase = 0;
  let best = -1;
  for (let k = 0; k < 4; k++) {
    let sum = 0;
    for (let i = k; i < beats.length; i += 4) sum += lowAtBeat(beats[i]);
    if (sum > best) {
      best = sum;
      phase = k;
    }
  }
  const bar0 = (beats[phase] ?? 0) - Math.ceil((beats[phase] ?? 0) / barSec) * barSec;
  const barOf = (t: number) => Math.floor((t - bar0) / barSec);
  const nBars = barOf(an.duration) + 1;
  const rmsAt = (t: number) =>
    an.rms[Math.max(0, Math.min(an.rms.length - 1, Math.round(t * FPS)))];
  // 마디별 세기 = 음량 + 타격 세기 합 + 고역(심벌·분위기) 세기.
  // 요즘 음원은 음량이 평평하게 눌려 있어서 음량만으로는 코러스·벌스 차이가 안 나고,
  // 심벌이 많이 깔리는 구간(코러스·드롭)은 고역 타격이 확 늘어남 → 셋을 섞어서 0~1
  const rmsBar = new Float32Array(nBars);
  const hitBar = new Float32Array(nBars);
  const highBar = new Float32Array(nBars);
  for (let b = 0; b < nBars; b++) {
    let sum = 0;
    let n = 0;
    for (let t = bar0 + b * barSec; t < bar0 + (b + 1) * barSec; t += 0.05) {
      if (t < 0 || t > an.duration) continue;
      sum += rmsAt(t);
      n++;
    }
    rmsBar[b] = n ? sum / n : 0;
  }
  for (const o of an.onsets) {
    const b = barOf(o.t);
    if (b < 0 || b >= nBars) continue;
    hitBar[b] += o.s;
    highBar[b] += o.high * o.s;
  }
  const p95 = (arr: Float32Array) => [...arr].sort((x, y) => x - y)[Math.floor(nBars * 0.95)] || 1;
  const norm = (arr: Float32Array) => {
    const q = p95(arr);
    return (i: number) => Math.min(1, (arr[Math.max(0, Math.min(nBars - 1, i))] ?? 0) / q);
  };
  const nr = norm(rmsBar);
  const nh = norm(hitBar);
  const ng = norm(highBar);
  const intensity = new Float32Array(nBars);
  for (let b = 0; b < nBars; b++) {
    // 음량 비중을 높게: 타격 세기·고역만 보면 조용하지만 드럼이 또렷한 구간이 꽉 찬 구간만큼 세게 잡힘
    const v = (i: number) => 0.5 * nr(i) + 0.25 * nh(i) + 0.25 * ng(i);
    // 앞 마디보다 뒤 마디를 더 보고 섞음: 구간이 터지는 첫 마디가 직전 조용한 마디에 눌리지 않게
    const mixed = 0.15 * v(b - 1) + 0.55 * v(b) + 0.3 * v(b + 1);
    // 대비를 키움: 0.35 이하는 0, 0.95 이상은 1 (벌스 ≈ 0.3, 코러스 ≈ 1)
    intensity[b] = Math.max(0, Math.min(1, (mixed - 0.35) / 0.6));
  }
  const jump = (b: number) => (b > 0 ? intensity[b] - intensity[b - 1] : 0);
  const sectionStart = (b: number) => jump(b) >= 0.18 && intensity[b] >= 0.55;
  const buildBar = (b: number) => sectionStart(b + 1) || sectionStart(b + 2);
  const dense = diff === "hard" || diff === "expert";
  const factorOf = (b: number) => {
    const I = intensity[Math.max(0, Math.min(nBars - 1, b))];
    // osu 랭크 채보는 가장 빽빽한 구간이 보통 구간의 1.2배 정도 — 세기 차이를 밀도에 너무 크게 옮기지 않음
    let f = dense ? 0.85 + 0.3 * I : 0.75 + 0.4 * I;
    if (I < 0.15) f *= 0.85; // 브레이크
    if (buildBar(b)) f *= 1.25; // 빌드업
    return f;
  };

  // 1) 강한 것부터 간격을 지키며 고르기 — 마디마다 목표 개수를 따로 둬서
  //    세기에 따라 밀도가 오르내리고, 조용하지만 빽빽한 구간도 큰 소리 구간에 밀리지 않게
  const perBar = new Map<number, number>();
  const taken: number[] = [];
  const picked: Onset[] = [];
  for (const { o } of cands) {
    const b = barOf(o.t);
    const target = Math.max(1, Math.round(R.nps * barSec * factorOf(b)));
    if ((perBar.get(b) ?? 0) >= target) continue;
    if (tooClose(taken, o.t, R.minGap)) continue;
    let i = taken.findIndex((t) => t > o.t);
    if (i < 0) i = taken.length;
    taken.splice(i, 0, o.t);
    picked.push(o);
    perBar.set(b, (perBar.get(b) ?? 0) + 1);
  }
  picked.sort((a, b) => a.t - b.t);

  // 1.2) 쉬움·보통: 소리가 나는데 너무 오래 비는 자리를 박 위에 채움 (osu 쉬운 채보는 4초 넘게 비는 데가 거의 없음)
  if ((diff === "easy" || diff === "normal") && picked.length) {
    // 비어도 되는 최대 길이: 쉬움 ≈1.6초, 보통 ≈0.9초 (박 단위로 올림)
    const maxBeats = Math.max(
      diff === "easy" ? 2 : 1,
      Math.ceil((diff === "easy" ? 1.6 : 0.9) / beatSec - 0.15)
    );
    const quiet =
      [...an.beats.map(rmsAt)].sort((x, y) => x - y)[Math.floor(an.beats.length * 0.5)] * 0.35;
    const times = picked.map((o) => o.t);
    const added: Onset[] = [];
    let last = -Infinity;
    let j = 0;
    const end = times[times.length - 1];
    for (const bt of an.beats) {
      if (bt > end) break;
      while (j < times.length && times[j] <= bt + 0.03) last = Math.max(last, times[j++]);
      if (bt - last < maxBeats * beatSec - 0.03) continue;
      const next = j < times.length ? times[j] : Infinity;
      if (next - bt < R.minGap || bt - last < R.minGap) continue;
      if (rmsAt(bt) < quiet) continue;
      added.push({
        t: bt,
        s: 0.3,
        low: 0.3,
        mid: 0.3,
        high: 0.3,
        cen: nearestCen(an, bt),
        grid: 0,
      });
      last = bt;
    }
    picked.push(...added);
    picked.sort((a, b) => a.t - b.t);
  }

  // 1.5) 격자 채우기 — 어려움은 센 마디를 8분으로, 매우 어려움은 아주 센 마디를 16분으로 (fill이 클수록 더 넓게)
  if (diff !== "nightmare" && (tweak.fill ?? 0) > 0) {
    // fill 1을 넘으면(1~1.6) 어지간한 마디까지 다 채움
    const fill = Math.min(1.6, tweak.fill ?? 0);
    // 채우기 양이 fill에 따라 이어지게(0에서 살짝만 올려도 센 마디가 한꺼번에 채워지며 노트가 50% 뛰던 것):
    // fill이 커질수록 가장 센 마디부터 차츰 더 조용한 마디까지, 브레이크(0.15 미만)만 빼고
    const loudT = Math.max(0.15, 0.95 - fill);
    // 보통은 8분까지만, 어려움은 8분(채우기가 1을 넘으면 아주 센 마디만 16분), 매우 어려움은 아주 센 마디만 16분
    const fullT =
      diff === "expert"
        ? Math.max(0.2, 0.95 - 0.45 * fill)
        : diff === "hard"
          ? Math.max(0.6, 1.9 - fill)
          : 2;
    const have = picked.map((o) => o.t);
    const beatT = (k: number) =>
      k < an.beats.length
        ? an.beats[k]
        : an.beats[an.beats.length - 1] + (k - an.beats.length + 1) * beatSec;
    const lastPick = picked.length ? picked[picked.length - 1].t : 0;
    const added: Onset[] = [];
    for (let k = 0; k < Math.ceil(an.duration / beatSec); k++) {
      const t0 = beatT(k);
      if (t0 > lastPick) break;
      const I = intensity[Math.max(0, Math.min(nBars - 1, barOf(t0)))];
      if (I < loudT) continue;
      // 12/8(셋잇단 격자)은 점4분을 3·6으로 나눠야 곡 박자에 맞음
      // 잘게 나눈 칸이 너무 촘촘하면(90ms 미만) 한 단계 덜 나눔
      const fine = an.div === 12 ? 6 : 4;
      // 쉬움은 정박만
      const sub = diff === "easy" ? 1 : I >= fullT && beatSec / fine >= 0.08 ? fine : fine / 2;
      const t1 = beatT(k + 1);
      for (let i = 0; i < sub; i++) {
        const t = t0 + (i * (t1 - t0)) / sub;
        if (tooClose(have, t, R.minGap)) continue;
        let j = have.findIndex((x) => x > t);
        if (j < 0) j = have.length;
        have.splice(j, 0, t);
        added.push({ t, s: 0.3, low: 0.3, mid: 0.3, high: 0.3, cen: nearestCen(an, t), grid: -1 });
      }
    }
    picked.push(...added);
    picked.sort((a, b) => a.t - b.t);
  }

  // 1.8) 어려움 이상: 리듬 고르게 — 간격이 직전 간격의 같음·2배·반이 아닌 걸로 갑자기 바뀌는 자리
  //      (osu 4★대 랭크 채보 4%, 손대기 전 우리 10~17%)를 사이에 박을 넣거나 약한 쪽을 빼서 정리
  if (diff === "hard" || diff === "expert" || diff === "nightmare") {
    const fixed = regularizeRhythm(picked, R.minGap, (t) => nearestCen(an, t));
    picked.length = 0;
    picked.push(...fixed);
  }

  // 2) 레인: 주변 4초 안에서 음색 높이 순위 → 0~3
  //    + 계단: 가까운(8분 이내) 타격 3개 이상이 음색 높이가 한 방향으로 흐르면 레인도 한 칸씩
  const stairs = new Map<number, 1 | -1>();
  for (let i = 0; i < picked.length;) {
    let j = i;
    const dir = Math.sign(picked[i + 1]?.cen - picked[i].cen) as 1 | -1 | 0;
    while (
      j + 1 < picked.length &&
      picked[j + 1].t - picked[j].t <= beatSec / 2 + 0.01 &&
      Math.sign(picked[j + 1].cen - picked[j].cen) === dir &&
      Math.abs(picked[j + 1].cen - picked[j].cen) > 0.08
    )
      j++;
    if (dir !== 0 && j - i + 1 >= 3) for (let k = i; k <= j; k++) stairs.set(k, dir);
    i = j - i + 1 >= 3 ? j + 1 : i + 1;
  }
  // 2.5) 스트림 패턴 (계단·연타·트릴…) — 고정 시드라 같은 곡은 늘 같은 채보
  let seed = (Math.round(an.bpm * 100) + diff.length * 7919) >>> 0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const patCtx: PatternCtx = {
    diff,
    beatSec,
    jackGap: R.jackGap,
    chords: R.chord !== null,
    barOf,
    intensity: (b) => intensity[Math.max(0, Math.min(nBars - 1, b))],
    rnd,
    onPick: tweak.onPick,
  };
  const patterned = assignPatterns(
    picked.map((o) => ({ t: o.t, cen: o.cen, count: 1 })),
    patCtx
  );

  if (diff === "nightmare") {
    const shift = shiftMs / 1000;
    const nm = nightmareNotes(
      an,
      picked,
      {
        ...NIGHTMARE_DEFAULT,
        ...tweak.nightmare,
        // 채우기가 클수록 덜 센 마디까지
        loud: (tweak.nightmare?.loud ?? NIGHTMARE_DEFAULT.loud) - 0.3 * (tweak.fill ?? 0),
        full: (tweak.nightmare?.full ?? NIGHTMARE_DEFAULT.full) - 0.3 * (tweak.fill ?? 0),
      },
      {
        beatSec,
        barOf,
        intensity: (b) => intensity[Math.max(0, Math.min(nBars - 1, b))],
        patCtx,
        thick: R.thick,
        tri: R.tri,
      }
    );
    const nmHeld = addLongNotes(regularizeRows(nm), {
      ...R.ln,
      beatSec,
      beatTimes: an.beats,
      rmsAt,
      rnd,
    });
    for (const n of nmHeld) {
      n.t += shift;
      if (n.end) n.end += shift;
    }
    return finishChart(
      nmHeld.filter((n) => n.t > 0.3),
      diff
    );
  }

  // 3) 동시치기 개수 — 박 위치별로 센 타격(센 마디일수록 우선)부터 목표 평균(R.thick)이 될 때까지
  //    (osu 랭크 채보: 동시치기는 정박에 몰리고, 반박·16분으로 갈수록 얇음)
  const extra = new Map<number, number>();
  {
    const beatsArr = an.beats;
    const kindAt = (t: number) => {
      let a = 0;
      let b = beatsArr.length - 1;
      while (b - a > 1) {
        const m = (a + b) >> 1;
        if (beatsArr[m] <= t) a = m;
        else b = m;
      }
      const base = t >= beatsArr[b] ? beatsArr[b] : beatsArr[a];
      const f = (t - base) / beatSec;
      const near = (x: number) => Math.abs(f - x) < 0.04;
      if (near(0) || near(1)) return 0;
      if (near(0.5) || (an.div === 12 && (near(1 / 3) || near(2 / 3)))) return 1;
      return 2;
    };
    // 동시치기는 곡 전체에 고르게: 마디마다 몫을 정하고(그 마디 줄 수 × 비율) 그 안에서 센 타격부터.
    // 전엔 센 마디부터 채워서 코러스·드럼 인트로에 동시치기가 몰리고 그 구간만 별점이 튀어 — 같은 레벨에서 노트가 줄었음
    const groups: number[][] = [[], [], []];
    picked.forEach((o, i) => groups[kindAt(o.t)].push(i));
    groups.forEach((g, k) => {
      const m = R.thick[k];
      const twoRate = Math.min(1, m - 1);
      const threeRate = k === 0 ? R.tri : Math.max(0, m - 2);
      const byBar = new Map<number, number[]>();
      for (const i of g) {
        const b = barOf(picked[i].t);
        if (!byBar.has(b)) byBar.set(b, []);
        byBar.get(b)!.push(i);
      }
      // 반올림 찌꺼기는 마디를 넘기며 이월 (비율이 전체로는 맞게)
      let carry2 = 0;
      let carry3 = 0;
      for (const b of [...byBar.keys()].sort((x, y) => x - y)) {
        const list = byBar.get(b)!.sort((x, y) => picked[y].s - picked[x].s);
        const want2 = list.length * twoRate + carry2;
        const want3 = list.length * threeRate + carry3;
        const two = Math.min(list.length, Math.round(want2));
        const three = Math.min(two, Math.round(want3));
        carry2 = want2 - two;
        carry3 = want3 - three;
        list.forEach((i, r) => {
          if (r < two) extra.set(i, r < three ? 2 : 1);
        });
      }
    });
    // 3개 동시치기 옆(연타 간격 1.5배 안)에 동시치기가 붙으면 레인이 모자람 → 2개로
    picked.forEach((o, i) => {
      if (extra.get(i) !== 2) return;
      const crowded = [i - 1, i + 1].some(
        (j) => picked[j] && Math.abs(picked[j].t - o.t) < R.jackGap * 1.5 && extra.has(j)
      );
      if (crowded) extra.set(i, 1);
    });
  }

  const notes: Note[] = [];
  const laneLast = [-Infinity, -Infinity, -Infinity, -Infinity];
  /** 최근 동시치기 모양 (chordPartners) */
  const chordHist: string[] = [];
  let prevLane = -1;
  let sameRun = 0;
  for (let i = 0, lo = 0, hi = 0; i < picked.length; i++) {
    const o = picked[i];
    while (picked[lo].t < o.t - 2) lo++;
    while (hi < picked.length && picked[hi].t <= o.t + 2) hi++;
    let below = 0;
    let total = 0;
    for (let k = lo; k < hi; k++) {
      if (k === i) continue;
      total++;
      if (picked[k].cen < o.cen) below++;
      else if (picked[k].cen === o.cen && k < i) below++;
    }
    let want = total ? Math.min(3, Math.floor((below / total) * 4)) : 1;
    const patLanes = patterned.get(i) ?? null;
    if (patLanes) want = patLanes[0];
    const dir = patLanes ? undefined : stairs.get(i);
    if (dir && prevLane >= 0) {
      want = prevLane + dir;
      if (want < 0 || want > 3) want = prevLane - dir;
      want = Math.max(0, Math.min(3, want));
    }
    // 빠른 연속(16분 이내)이 한 손에 3번 몰리면 다른 손으로 — 계단은 예외
    const hand = (l: number) => (l < 2 ? 0 : 1);
    const prev = notes[notes.length - 1];
    // 동시치기 짝(같은 시각)은 건너뛰고 그 앞 노트
    let prev2: Note | undefined;
    for (let k = notes.length - 2; k >= 0; k--)
      if (notes[k].t !== prev?.t) {
        prev2 = notes[k];
        break;
      }
    if (
      !dir &&
      !patLanes &&
      prev &&
      prev2 &&
      o.t - prev.t <= beatSec / 4 + 0.01 &&
      prev.t - prev2.t <= beatSec / 4 + 0.01 &&
      hand(prev.lane) === hand(prev2.lane) &&
      hand(want) === hand(prev.lane)
    )
      want = hand(want) === 0 ? (want === 0 ? 2 : 3) : want === 2 ? 0 : 1;
    // 같은 레인 연타·같은 레인 연속(jackRun 넘게)은 옆 레인으로.
    // 바로 앞 줄과 같은 레인(잭)은 난이도별 확률(jackAllow)만큼만 남김 — osu 랭크 채보 비율에 맞춤
    const prevRow = new Set<number>();
    for (let k = notes.length - 1; k >= 0; k--) {
      if (prevRow.size && notes[k].t !== notes[k + 1]?.t) break;
      prevRow.add(notes[k].lane);
    }
    const jackOk = rnd() < R.jackAllow;
    const blocked = (l: number) =>
      o.t - laneLast[l] < R.jackGap ||
      (l === prevLane && sameRun >= R.jackRun - 1) ||
      (!jackOk && !patLanes && !dir && prevRow.has(l));
    if (blocked(want)) {
      const order = [1, -1, 2, -2, 3, -3]
        .map((d) => want + d)
        .filter((l) => l >= 0 && l <= 3 && !blocked(l));
      if (order.length) want = order[0];
    }
    sameRun = want === prevLane ? sameRun + 1 : 0;
    prevLane = want;
    laneLast[want] = o.t;
    notes.push({ t: o.t, lane: want });

    // 패턴이 준 동시치기 짝
    let paired = 0;
    if (patLanes && patLanes.length === 2) {
      const l2 = patLanes[1] === want ? patLanes[0] : patLanes[1];
      if (l2 !== want && o.t - laneLast[l2] >= R.jackGap) {
        notes.push({ t: o.t, lane: l2 });
        laneLast[l2] = o.t;
        // 3개 동시치기 자리가 아니면 패턴 짝으로 끝
        if ((extra.get(i) ?? 0) < 2) continue;
        paired = 1;
      }
    }

    // 동시치기 붙이기 — 3)에서 정한 개수 + 구간 진입(드롭·코러스) 첫 노트는 최소 1개
    const entry =
      R.chord !== null &&
      sectionStart(barOf(o.t)) &&
      (i === 0 || barOf(picked[i - 1].t) !== barOf(o.t));
    const more = Math.max(extra.get(i) ?? 0, entry ? 1 : 0) - paired;
    if (more > 0) {
      // 짝 레인: 거울(D+K·F+J)만 반복되지 않게 — 바로 앞 줄 레인·최근 동시치기 모양은 피함
      const prevRow = new Set<number>();
      for (let k = notes.length - 2; k >= 0 && notes[k].t !== o.t; k--) {
        if (prevRow.size && notes[k].t !== notes[k + 1].t) break;
        prevRow.add(notes[k].lane);
      }
      const ls = chordPartners(want, more, {
        avoid: prevRow,
        ok: (l) =>
          o.t - laneLast[l] >= R.jackGap && !notes.some((m) => m.t === o.t && m.lane === l),
        recent: chordHist,
        rnd,
      });
      for (const l2 of ls) {
        notes.push({ t: o.t, lane: l2 });
        laneLast[l2] = o.t;
      }
    }
  }

  // 3.5) 프레이즈 반복: 마디 안 노트 배치(상대 시각)가 같은 마디는 먼저 나온 마디의 레인을 다시 씀
  //      — 음악이 반복되면 손 모양도 반복(외워 치는 재미). 다만 그대로가 아니라 홀수 번째 반복은
  //      좌우 반전으로, "같은 듯 다른" 변주가 되게 (사람 매퍼의 반복-변주 원칙)
  {
    const byBar = new Map<number, Note[]>();
    for (const n of notes) {
      const b = barOf(n.t);
      if (!byBar.has(b)) byBar.set(b, []);
      byBar.get(b)!.push(n);
    }
    const seen = new Map<string, { lanes: number[]; n: number }>();
    for (const [b, list] of [...byBar.entries()].sort((x, y) => x[0] - y[0])) {
      list.sort((x, y) => x.t - y.t || x.lane - y.lane);
      const key = list
        .map((n) => Math.round(((n.t - bar0 - b * barSec) / beatSec) * an.div))
        .join(",");
      // 8분·16분으로 꽉 찬 마디는 리듬만으로는 다 똑같아 보여서(코러스 8마디가 전부 같은 키) 복사하면
      // 같은 손 모양이 끝없이 반복됨 → 이런 마디는 복사하지 않고 패턴 다양성에 맡김.
      // "프레이즈가 반복된다"고 볼 수 있는 건 리듬에 생김새가 있는(간격이 고르지 않은) 마디뿐
      const ts = [...new Set(list.map((n) => n.t))];
      const ivs = new Set(ts.slice(1).map((t, k) => Math.round((t - ts[k]) * 50)));
      const uniform = ts.length >= 6 && ivs.size <= 1;
      const hit = seen.get(key);
      if (!uniform && hit && hit.lanes.length === list.length && list.length >= 3 && hit.n < 3) {
        hit.n++;
        const lanes = hit.n % 2 === 1 ? hit.lanes.map((l) => 3 - l) : hit.lanes;
        // 복사했을 때 같은 시각에 같은 레인이 겹치면(동시치기) 복사 안 함
        const clash = list.some((n, k) =>
          list.some((m, k2) => k2 !== k && m.t === n.t && lanes[k2] === lanes[k])
        );
        if (!clash) list.forEach((n, k) => (n.lane = lanes[k]));
      } else if (!uniform && list.length >= 3 && (!hit || hit.n >= 3))
        // 처음 보는 리듬(또는 세 번 복사한 뒤)은 이 마디를 새 원본으로
        seen.set(key, { lanes: list.map((n) => n.lane), n: 0 });
    }
  }

  // 4) 롱노트: osu 랭크 채보처럼 노트의 일정 비율을 짧은 롱노트로 (정박·소리가 남는 자리부터)
  {
    const held = addLongNotes(notes, { ...R.ln, beatSec, beatTimes: an.beats, rmsAt, rnd });
    notes.length = 0;
    notes.push(...held);
  }

  const shift = shiftMs / 1000;
  if (shift)
    for (const n of notes) {
      n.t += shift;
      if (n.end) n.end += shift;
    }
  return finishChart(
    notes.filter((n) => n.t > 0.3),
    diff
  );
}

/** 간격 비율이 같음(≈1)·2배·반이면 고른 리듬 */
const evenRatio = (r: number) =>
  (r > 0.8 && r < 1.25) || (r > 1.8 && r < 2.2) || (r > 0.45 && r < 0.55);
/** 빠른 구간(간격 0.4초 미만)에서만 따짐 — 느린 데선 리듬이 바뀌어도 읽을 시간이 있음 */
const FAST_GAP = 0.4;

/**
 * 리듬 고르게: 연달아 빠른 두 간격 g1→g2가 고르지 않으면
 *  ① 긴 쪽을 짧은 쪽 길이로 나눠 사이에 노트를 넣어 보고(남는 간격도 고르면),
 *  ② 안 되면 가운데 노트(약하면) 또는 뒤 노트를 뺌.
 * 넣는 노트는 원래 간격의 배수 자리라 격자 위에 떨어짐.
 */
function regularizeRhythm(src: Onset[], minGap: number, cenAt: (t: number) => number): Onset[] {
  const a = [...src].sort((x, y) => x.t - y.t);
  const okNew = (prev: number | undefined, g: number) =>
    prev === undefined || prev >= FAST_GAP || g >= FAST_GAP || evenRatio(g / prev);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 2; i < a.length; i++) {
      const g1 = a[i - 1].t - a[i - 2].t;
      const g2 = a[i].t - a[i - 1].t;
      if (g1 >= FAST_GAP || g2 >= FAST_GAP || evenRatio(g2 / g1)) continue;
      changed = true;
      // ① 넣기
      if (g2 > g1 && g1 >= minGap) {
        const t = a[i - 1].t + g1;
        const rest = a[i].t - t;
        const g3 = a[i + 1] ? a[i + 1].t - a[i].t : undefined;
        if (rest >= minGap && evenRatio(rest / g1) && okNew(rest, g3 ?? FAST_GAP)) {
          a.splice(i, 0, { t, s: 0.3, low: 0.3, mid: 0.3, high: 0.3, cen: cenAt(t), grid: 0 });
          continue;
        }
      }
      if (g1 > g2 && g2 >= minGap) {
        const t = a[i - 1].t - g2;
        const rest = t - a[i - 2].t;
        const g0 = i >= 3 ? a[i - 2].t - a[i - 3].t : undefined;
        if (rest >= minGap && evenRatio(rest / g2) && okNew(g0, rest)) {
          a.splice(i - 1, 0, { t, s: 0.3, low: 0.3, mid: 0.3, high: 0.3, cen: cenAt(t), grid: 0 });
          continue;
        }
      }
      // ② 빼기: 가운데가 뒤보다 약하면 가운데, 아니면 뒤
      a.splice(a[i - 1].s <= a[i].s ? i - 1 : i, 1);
      i = Math.max(1, i - 2);
    }
    if (!changed) break;
  }
  return a;
}

/** 나이트메어 마무리: 채우기 마디 경계 등에서 생긴 고르지 않은 리듬을 줄 단위로 빼서 정리 (넣지는 않음) */
function regularizeRows(notes: Note[]): Note[] {
  const rows = new Map<number, Note[]>();
  for (const n of notes) rows.set(n.t, [...(rows.get(n.t) ?? []), n]);
  const ts = [...rows.keys()].sort((x, y) => x - y);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 2; i < ts.length; i++) {
      const g1 = ts[i - 1] - ts[i - 2];
      const g2 = ts[i] - ts[i - 1];
      if (g1 >= FAST_GAP || g2 >= FAST_GAP || evenRatio(g2 / g1)) continue;
      changed = true;
      // 노트가 적은 줄(같으면 가운데)을 뺌
      const k = rows.get(ts[i])!.length < rows.get(ts[i - 1])!.length ? i : i - 1;
      rows.delete(ts[k]);
      ts.splice(k, 1);
      i = Math.max(1, i - 2);
    }
    if (!changed) break;
  }
  return ts.flatMap((t) => rows.get(t)!);
}

/**
 * 롱노트 깔기 — 노트 중 ratio만큼을 짧은 롱노트로. 길이는 박 단위 후보(beats)에서 고르고 maxSec까지,
 * 같은 레인 다음 노트 전에 끝나게. 정박에서 시작하는 걸 onBeat 비율만큼 우선하고, 소리가 남는 자리일수록 먼저.
 * 곡 전체에 고르게 퍼지게 롱노트끼리 최소 간격을 둠. 롱노트를 누르는 동안 다른 레인 노트는 그대로 침.
 */
function addLongNotes(
  notes: Note[],
  o: {
    ratio: number;
    lens: number[];
    maxSec: number;
    onBeat: number;
    beatSec: number;
    beatTimes: number[];
    rmsAt: (t: number) => number;
    rnd: () => number;
  }
): Note[] {
  const out = notes.map((n) => ({ ...n })).sort((x, y) => x.t - y.t || x.lane - y.lane);
  const want = Math.round(out.length * o.ratio);
  if (!want || out.length < 8) return out;
  // 같은 레인 다음 노트 시각
  const nextSame = new Array<number>(out.length).fill(Infinity);
  const lastIdx = new Map<number, number>();
  for (let i = out.length - 1; i >= 0; i--) {
    const j = lastIdx.get(out[i].lane);
    if (j !== undefined) nextSame[i] = out[j].t;
    lastIdx.set(out[i].lane, i);
  }
  const rowSize = new Map<number, number>();
  for (const n of out) rowSize.set(n.t, (rowSize.get(n.t) ?? 0) + 1);
  const bt = o.beatTimes;
  const nearBeat = (t: number) => {
    let lo = 0,
      hi = bt.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (bt[m] < t) lo = m + 1;
      else hi = m;
    }
    const d = Math.min(Math.abs((bt[lo] ?? -9) - t), Math.abs((bt[lo - 1] ?? -9) - t));
    return d < Math.max(0.03, o.beatSec * 0.08);
  };
  // 너무 짧은 롱노트(단노트랑 구분이 안 되고 떼기만 귀찮은)는 안 넣음: 최소 0.33초·거의 한 박
  const minLen = Math.max(0.33, o.beatSec * 0.9);
  type Cand = { i: number; len: number; score: number; on: boolean };
  const cands: Cand[] = [];
  out.forEach((n, i) => {
    if (n.t < 0.3 || n.end) return;
    if ((rowSize.get(n.t) ?? 1) > 2) return;
    const pick = o.lens[Math.floor(o.rnd() * o.lens.length)] ?? 1;
    const room = nextSame[i] - n.t - Math.max(0.1, o.beatSec * 0.25);
    const len = Math.min(pick * o.beatSec, o.maxSec, room);
    if (len < minLen) return;
    const on = nearBeat(n.t);
    const head = o.rmsAt(n.t) + 1e-6;
    let sus = 0;
    for (let k = 1; k <= 4; k++) sus += o.rmsAt(n.t + (len * k) / 4);
    const keep = Math.min(1.2, sus / 4 / head);
    cands.push({ i, len, on, score: keep + o.rnd() * 0.3 });
  });
  // 정박 비율을 맞춰 고름: 정박 몫 / 엇박 몫
  const onWant = Math.round(want * o.onBeat);
  const span = out[out.length - 1].t - out[0].t || 1;
  const gap = (span / want) * 0.4;
  const starts: number[] = [];
  const take = (list: Cand[], k: number) => {
    list.sort((x, y) => y.score - x.score);
    let got = 0;
    for (const c of list) {
      if (got >= k) break;
      const t = out[c.i].t;
      if (starts.some((s) => Math.abs(s - t) < gap)) continue;
      // 이 롱노트를 누르는 사이 같은 레인에 이미 다른 롱노트 끝이 겹치지 않게 (nextSame로 보장됨)
      out[c.i].end = t + c.len;
      starts.push(t);
      got++;
    }
    return got;
  };
  const gotOn = take(
    cands.filter((c) => c.on),
    onWant
  );
  take(
    cands.filter((c) => !c.on),
    want - gotOn
  );
  return out;
}

/**
 * 나이트메어: 고른 타격 위에 센 마디를 8분·16분으로 꽉 채우고(박마다 동시치기, 프레이즈 끝 32분 연타),
 * 레인은 음색이 아니라 전부 패턴(계단·연타·트릴…)으로 깖. 쉼이 2박 넘게 없으면 한 스트림으로 봐서
 * 거의 모든 노트가 알아볼 수 있는 패턴 안에 들어감.
 */
function nightmareNotes(
  an: Analysis,
  picked: Onset[],
  P: Required<NightmareTweak>,
  ctx: {
    beatSec: number;
    barOf: (t: number) => number;
    intensity: (bar: number) => number;
    patCtx: PatternCtx;
    thick: [number, number, number];
    tri: number;
  }
): Note[] {
  const { beatSec, barOf, intensity } = ctx;
  const beats = an.beats;
  const beatT = (k: number) =>
    k < beats.length ? beats[k] : beats[beats.length - 1] + (k - beats.length + 1) * beatSec;
  // 슬롯: 시각 → 노트 수 (1 또는 2)
  const slots = new Map<number, number>();
  const key = (t: number) => Math.round(t * 200) / 200; // 5ms 격자
  const near = (k: number, range: number) => {
    let best: number | null = null;
    for (const s of slots.keys())
      if (Math.abs(s - k) <= range && (best === null || Math.abs(s - k) < Math.abs(best - k)))
        best = s;
    return best;
  };
  /** burst: 32분 연타처럼 일부러 촘촘한 노트 (합치지 않음) */
  const put = (t: number, count = 1, burst = false) => {
    if (t <= 0 || t > an.duration - 0.2) return;
    const k = key(t);
    // 아주 가까운 슬롯(20ms)은 같은 노트, 72ms 안은 '살짝 어긋난 동시치기'가 되니 딱 붙은 동시치기로 합침
    const same = near(k, 0.02);
    if (same !== null) {
      slots.set(same, Math.max(slots.get(same)!, count));
      return;
    }
    const flam = burst ? null : near(k, 0.072);
    if (flam !== null) {
      slots.set(flam, 2);
      return;
    }
    slots.set(k, count);
  };
  for (const o of picked) put(o.t, 1);
  const lastPick = picked.length ? picked[picked.length - 1].t : 0;
  const nBeats = Math.ceil(an.duration / beatSec);
  for (let k = 0; k < nBeats; k++) {
    const t0 = beatT(k);
    if (t0 > lastPick) break;
    const b = barOf(t0);
    const I = intensity(b);
    if (I < P.loud) {
      // 조용한 마디도 정박은 비우지 않음 (osu 나이트메어급은 조용한 구간도 평균의 2/3은 됨)
      if (I >= P.loud * 0.5) put(t0, 1);
      continue;
    }
    const full = I >= P.full;
    const t1 = beatT(k + 1);
    const beatInBar = Math.round((t0 - (beats[0] ?? 0)) / beatSec) % 4;
    const sub = full ? P.fullSub : P.loudSub;
    const chords = full ? P.chordFull : P.chordLoud;
    for (let c = 0; c < chords; c++) put(t0 + (c * (t1 - t0)) / chords, 2);
    for (let i = 0; i < sub; i++) put(t0 + (i * (t1 - t0)) / sub, 1);
    if (full && beatInBar === 3 && b % P.burstEvery === P.burstEvery - 1)
      for (let i = 0; i < P.burstSub; i++) put(t0 + (i * (t1 - t0)) / P.burstSub, 1, true);
  }
  // 박 위치별 두께를 목표 평균(thick)까지 — 센 마디부터 2개, 넘치면 3개
  {
    const kindAt = (t: number) => {
      const k = Math.round((t - (beats[0] ?? 0)) / beatSec);
      const f = (t - beatT(Math.max(0, Math.min(k, nBeats)))) / beatSec;
      const near = (x: number) => Math.abs(f - x) < 0.04;
      if (near(0)) return 0;
      if (near(0.5) || near(-0.5) || (an.div === 12 && (near(1 / 3) || near(-1 / 3)))) return 1;
      return 2;
    };
    const groups: number[][] = [[], [], []];
    const ks = [...slots.keys()];
    ks.forEach((t) => groups[kindAt(t)].push(t));
    // 동시치기는 곡 전체에 고르게(마디마다 몫) — 센 마디에 몰면 그 구간만 별점이 튀어 같은 레벨에서 노트가 줄어듦.
    // 마디 안에선 센 타격(가까운 타격 세기)부터
    const strengthAt = (t: number) => {
      let v = 0;
      for (const o of an.onsets) if (Math.abs(o.t - t) < 0.03) v = Math.max(v, o.s);
      return v;
    };
    groups.forEach((g, k) => {
      const twoRate = Math.min(1, ctx.thick[k] - 1);
      const threeRate = k === 0 ? ctx.tri : 0;
      const byBar = new Map<number, number[]>();
      for (const t of g) {
        const b = barOf(t);
        if (!byBar.has(b)) byBar.set(b, []);
        byBar.get(b)!.push(t);
      }
      let carry2 = 0;
      let carry3 = 0;
      for (const b of [...byBar.keys()].sort((x, y) => x - y)) {
        const list = byBar.get(b)!;
        const have = list.filter((t) => slots.get(t)! >= 2).length;
        const want2 = list.length * twoRate + carry2;
        const want3 = list.length * threeRate + carry3;
        const two = Math.min(list.length, Math.round(want2));
        const three = Math.min(two, Math.round(want3));
        carry2 = want2 - two;
        carry3 = want3 - three;
        const order = [...list].sort((x, y) => strengthAt(y) - strengthAt(x) || x - y);
        let need = two - have;
        for (const t of order) {
          if (need <= 0) break;
          if (slots.get(t)! >= 2) continue;
          slots.set(t, 2);
          need--;
        }
        order.slice(0, three).forEach((t) => slots.set(t, 3));
      }
    });
    // 3개 동시치기 바로 옆(연타 간격 1.5배 안)에 동시치기가 붙으면 남는 레인이 없어 줄이 통째로 빠짐 → 2개로
    const win = ctx.patCtx.jackGap * 1.5;
    const sorted = [...slots.keys()].sort((x, y) => x - y);
    sorted.forEach((t, i) => {
      if (slots.get(t)! < 3) return;
      const crowded = [sorted[i - 1], sorted[i + 1]].some(
        (u) => u !== undefined && Math.abs(u - t) < win && slots.get(u)! >= 2
      );
      if (crowded) slots.set(t, 2);
    });
  }
  const times = [...slots.keys()].sort((a, b) => a - b);
  // 패턴용 음색: 가장 가까운 타격의 음색
  const cen = times.map((t) => nearestCen(an, t));
  // 나이트메어는 2박 쉼까지 한 스트림으로 (거의 전부 패턴 안에)
  const assigned = assignPatterns(
    times.map((t, i) => ({ t, cen: cen[i], count: slots.get(t)! })),
    { ...ctx.patCtx, diff: "nightmare", chords: true }
  );
  const notes: Note[] = [];
  const laneLast = [-Infinity, -Infinity, -Infinity, -Infinity];
  let prev: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const count = slots.get(t)!;
    let lanes = assigned.get(i) ?? [];
    // 패턴 밖(드문 경우): 앞 노트와 다른 손, 연타 간격 지키며
    if (lanes.length < count) {
      const free = [0, 1, 2, 3].filter(
        (l) => !lanes.includes(l) && t - laneLast[l] >= ctx.patCtx.jackGap
      );
      free.sort((a, b2) => {
        const ha = prev.some((p) => p < 2 === a < 2) ? 1 : 0;
        const hb = prev.some((p) => p < 2 === b2 < 2) ? 1 : 0;
        return ha - hb;
      });
      lanes = [...lanes, ...free].slice(0, count);
    }
    lanes = lanes.filter((l) => t - laneLast[l] >= ctx.patCtx.jackGap - 1e-6);
    if (!lanes.length) continue;
    for (const l of lanes) {
      notes.push({ t, lane: l });
      laneLast[l] = t;
    }
    prev = lanes;
  }
  return notes;
}

/**
 * 난이도별 목표 레벨 (레벨 = osu!mania 별점 × 4). 나이트메어는 17 이상 —
 * 그 위 등급이 생기면 여기에 더하면 됨
 */
export const TARGET_LEVEL: Record<Difficulty, number> = {
  // 각 레벨 구간(chart.ts LEVEL_BANDS: 1~3 / 4~6 / 7~11 / 12~14 / 15~18)의 가운데
  easy: 2,
  normal: 5,
  hard: 9,
  expert: 13,
  nightmare: 16,
};
/** 목표에서 이만큼 벗어나도 됨 */
const LEVEL_TOL = 1;

/** 나이트메어 목표 레벨 — 빠른 곡은 더 높게 (체감 템포 170↑ 17, 200↑ 18) */
const nightmareGoal = (an: Analysis) => {
  const bpm = displayBpm(an);
  return bpm >= 200 ? 18 : bpm >= 170 ? 17 : TARGET_LEVEL.nightmare;
};

/**
 * 난이도별 채보를 한 번에 — 각 난이도가 목표 레벨(TARGET_LEVEL)에 들어올 때까지
 * 밀도(·어려움 이상은 격자 채우기)를 조절해 다시 뽑는다. 가장 가까운 결과를 씀.
 * 곡에 타격이 적어 목표까지 못 올라가도, 아래 난이도보다는 최소 2레벨 높게.
 * @param diffs 만들 난이도 (보스곡·내 음악은 nightmare 포함)
 */
export function makeAutoCharts(
  an: Analysis,
  diffs: Difficulty[],
  shiftMs = 0,
  tweaks: Partial<Record<Difficulty, AutoTweak>> = {}
): Partial<Record<Difficulty, Chart>> {
  const out: Partial<Record<Difficulty, Chart>> = {};
  let prevLevel = -Infinity;
  for (const d of diffs) {
    const base = tweaks[d] ?? {};
    // 직접 정한 레벨은 그대로, 아니면 구간 가운데 (아래 난이도보다는 최소 1 높게)
    const goal = d === "nightmare" ? nightmareGoal(an) : TARGET_LEVEL[d];
    const target = base.level ?? Math.max(goal, prevLevel + 1);
    const tol = base.level !== undefined ? 0 : LEVEL_TOL;
    const canFill = true;
    let density = base.density ?? 1;
    let fill = base.fill ?? 0;
    // 나이트메어는 밀도보다 16분 채우는 마디(full)·8분 마디(loud)·연타 간격으로 난이도가 정해짐
    let nm: Required<NightmareTweak> = { ...NIGHTMARE_DEFAULT, ...(base.nightmare ?? {}) };
    let best: Chart | null = null;
    let bestRaw = 0;
    // 레벨이 맞은 뒤에도 밀도를 조금씩 올려 보며 같은 레벨에서 가장 빽빽한 채보를 고름
    // (osu 랭크 채보는 같은 별점에서 우리보다 노트가 많음 — 동시치기·잭 같은 '튀는 자리'가 적어서)
    let hit = 0;
    // 시도 기록: 목표를 못 맞추면 아래·위로 가장 가까운 두 시도 사이를 더 잘게 나눠 봄
    const tried: { density: number; fill: number; raw: number; n: number }[] = [];
    const consider = (chart: Chart, raw: number) => {
      const dNew = Math.abs(raw - target);
      const dBest = Math.abs(bestRaw - target);
      // 같은 거리면 쉬운 쪽(직접 정한 레벨을 넘기지 않게), 같은 레벨이면 노트 많은 쪽
      if (
        !best ||
        dNew < dBest ||
        (dNew === dBest &&
          (raw < bestRaw || (raw === bestRaw && chart.notes.length > best.notes.length)))
      ) {
        best = chart;
        bestRaw = raw;
      }
    };
    for (let attempt = 0; attempt < 13; attempt++) {
      const chart = makeAutoChart(an, d, shiftMs, { ...base, density, fill, nightmare: nm });
      // 레벨은 난이도별 최저값으로 올려 놓은 값이라, 맞춰 갈 때는 별점 그대로 잼
      const raw = Math.round(starRating(chart.notes) * 4);
      tried.push({ density, fill, raw, n: chart.notes.length });
      consider(chart, raw);
      const miss = raw - target;
      if ((globalThis as { DEBUG_LV?: boolean }).DEBUG_LV)
        console.log(
          `  ${d} 시도${attempt} 밀도x${density.toFixed(2)} 채우기${fill.toFixed(1)} → Lv${raw} 노트${chart.notes.length}`
        );
      // 나이트메어(자동 목표)는 목표보다 높게는 안 받음 — 이미 구간 가운데라 +1이면 체감이 확 어려워짐
      const ok =
        d === "nightmare" && base.level === undefined
          ? miss <= 0 && miss >= -tol
          : Math.abs(miss) <= tol;
      if (ok || hit > 0) {
        if (hit >= 3 || (hit > 0 && !ok)) break;
        hit++;
        if (d === "nightmare") nm = { ...nm, loud: nm.loud - 0.03, full: nm.full - 0.03 };
        else {
          density *= 1.1;
          fill = Math.min(1.6, fill + 0.05);
        }
        continue;
      }
      // 레벨은 밀도에 거의 비례 → 비율로 맞춰 감 (한 번에 너무 크게는 안 움직임)
      const ratio = Math.min(1.6, Math.max(0.6, target / Math.max(1, raw)));
      density *= ratio;
      // 밀도를 올려도 곡에서 찾은 타격이 모자라면 격자 채우기로 (너무 어려우면 채우기부터 줄임)
      // 오갈수록 조금씩 (안 그러면 두 값 사이를 계속 왔다 갔다)
      const step = 0.3 / (1 + attempt * 0.6);
      if (miss < 0 && canFill) fill = Math.min(1.6, fill + step);
      if (miss > 0 && fill > 0) fill = Math.max(0, fill - step);
      if (d === "nightmare") {
        const k = (Math.sign(miss) * Math.min(3, Math.abs(miss))) / (1 + attempt * 0.6);
        nm = {
          ...nm,
          full: Math.max(0.3, Math.min(1.05, nm.full + 0.06 * k)),
          loud: Math.max(0.2, Math.min(1, nm.loud + 0.05 * k)),
          burstEvery: miss > 0 ? Math.min(16, nm.burstEvery * 2) : nm.burstEvery,
        };
      }
    }
    // 목표를 못 맞춘 채 아래(Lv-1)·위(Lv+1) 시도만 있으면 그 사이를 이등분해 가며 찾음 (밀도·채우기를 같이 보간)
    if (d !== "nightmare" && bestRaw !== target) {
      let lo = tried.filter((t) => t.raw < target).sort((a, b) => b.raw - a.raw || b.n - a.n)[0];
      let hi = tried.filter((t) => t.raw > target).sort((a, b) => a.raw - b.raw || a.n - b.n)[0];
      for (let k = 0; lo && hi && k < 4; k++) {
        const mid = { density: (lo.density + hi.density) / 2, fill: (lo.fill + hi.fill) / 2 };
        const chart = makeAutoChart(an, d, shiftMs, { ...base, ...mid, nightmare: nm });
        const raw = Math.round(starRating(chart.notes) * 4);
        if ((globalThis as { DEBUG_LV?: boolean }).DEBUG_LV)
          console.log(
            `  ${d} 보간${k} 밀도x${mid.density.toFixed(2)} 채우기${mid.fill.toFixed(2)} → Lv${raw} 노트${chart.notes.length}`
          );
        consider(chart, raw);
        if (raw === target) break;
        const t = { ...mid, raw, n: chart.notes.length };
        if (raw < target) lo = t;
        else hi = t;
      }
    }
    out[d] = best!;
    prevLevel = bestRaw;
  }
  return out;
}
