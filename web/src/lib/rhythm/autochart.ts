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
//   (어려움~ULTIMA는 6%로 통일 — osu 9% · Quaver 1~4% 사이. 빽빽한 곡의 나이트메어·ULTIMA는 넣을 자리가 모자라 2~4%.
//    우리 롱노트는 길어서(한 박 이상) 누르는 동안 다른 노트를 치면 별점이 ×1.25 — 매우 어려움 기준 레벨을 0.5 올림, osu는 0.1)
//   같은 별점이면 osu가 우리보다 노트가 많음 — 동시치기·잭·연타처럼 별점을 튀게 하는 자리가 적어서.
//   그래서 레벨이 맞은 뒤에도 밀도를 올려 보며 같은 레벨에서 가장 빽빽한 채보를 고름(makeAutoCharts)
/** 3.7) 잭 걷어내기 — 줄 단위로 훑으며 앞 줄과 겹치는 레인을 확률 문으로 거름 (notes는 시각순이어야 함) */
function dejack(notes: Note[], beatSec: number, R: AutoRule, rnd: () => number) {
  const fast = beatSec * 0.5 * 1.05; // 8분 이하 간격만 잭으로 침 (측정과 같은 기준)
  // 줄(같은 시각 묶음)로 나눔
  const rows: Note[][] = [];
  for (const n of notes) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].t - n.t) < 1e-6) last.push(n);
    else rows.push([n]);
  }
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const dt = rows[i][0].t - prev[0].t;
    if (dt <= 0 || dt > fast) continue;
    const prevLanes = new Set(prev.map((n) => n.lane));
    for (const n of rows[i]) {
      if (!prevLanes.has(n.lane) || rnd() < R.jackAllow) continue;
      // 옆 레인 중: 이 줄에 없고, 앞 줄과도 안 겹치고, 그 레인의 직전 노트와 jackGap 이상 떨어진 곳
      const mine = new Set(rows[i].map((m) => m.lane));
      const lastAt = (l: number) => {
        for (let k = i - 1; k >= 0 && rows[k][0].t > n.t - R.jackGap - 1e-6; k--)
          if (rows[k].some((m) => m.lane === l)) return rows[k][0].t;
        return -Infinity;
      };
      const cand = [1, -1, 2, -2, 3, -3]
        .map((d) => n.lane + d)
        .filter(
          (l) =>
            l >= 0 && l <= 3 && !mine.has(l) && !prevLanes.has(l) && n.t - lastAt(l) >= R.jackGap
        );
      if (cand.length) n.lane = cand[0];
    }
  }
}

/**
 * 3.8) 트릴 걷어내기 — 단노트 넷이 빠르게(0.21초 이하) 두 레인만 번갈면(A B A B) 넷째를 다른 레인으로.
 * osu·Quaver 랭크 채보 모두 어려움~ULTIMA에서 이런 자리가 줄의 0~0.3%뿐인데 우리는 1~2%였음
 * (킥·스네어가 번갈면 음높이 순위가 그대로 레인이 되고, 패턴 이음매·잭 걷어내기도 가끔 만들어 냄).
 * keep 확률만큼은 그대로 둠
 */
function detrill(notes: Note[], jackGap: number, keep: number, rnd: () => number) {
  const rows: Note[][] = [];
  for (const n of notes) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].t - n.t) < 1e-6) last.push(n);
    else rows.push([n]);
  }
  const FAST = 0.21;
  for (let i = 3; i < rows.length; i++) {
    const [a, b, c, d] = [rows[i - 3], rows[i - 2], rows[i - 1], rows[i]];
    if (a.length !== 1 || b.length !== 1 || c.length !== 1 || d.length !== 1) continue;
    if (d[0].t - c[0].t > FAST || c[0].t - b[0].t > FAST || b[0].t - a[0].t > FAST) continue;
    const [la, lb, lc, ld] = [a[0].lane, b[0].lane, c[0].lane, d[0].lane];
    if (!(la === lc && lb === ld && la !== lb) || rnd() < keep) continue;
    const next = rows[i + 1];
    const lastIn = (l: number) => {
      for (let k = i - 1; k >= 0; k--) if (rows[k].some((m) => m.lane === l)) return rows[k][0].t;
      return -Infinity;
    };
    const cand = [0, 1, 2, 3]
      .filter((l) => l !== la && l !== lb && !(next && next.some((m) => m.lane === l)))
      .filter((l) => d[0].t - lastIn(l) >= jackGap)
      // 넷째 노트와 가까운 레인부터 (손 모양이 크게 안 바뀌게)
      .sort((x, y) => Math.abs(x - ld) - Math.abs(y - ld));
    if (cand.length && !d[0].end) d[0].lane = cand[0];
  }
}

/**
 * 3.9) A B A 줄이기 — 빠른(셋이 0.4초 안) 단노트 셋이 A B A로 같은 레인에 돌아오면 셋째를 다른 레인으로 (rate 확률).
 * osu 랭크 매우 어려움·나이트메어급은 빠른 단노트 셋 중 A B A가 14~16%, 우리는 26~29% — 같은 레인을 금방 다시 쳐서
 * 같은 레인 부담(별점)이 커지고, 같은 레벨에 노트가 osu보다 15% 적었음
 */
function deaba(notes: Note[], jackGap: number, rate: number, rnd: () => number) {
  const rows: Note[][] = [];
  for (const n of notes) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].t - n.t) < 1e-6) last.push(n);
    else rows.push([n]);
  }
  for (let i = 2; i < rows.length; i++) {
    const [a, b, c] = [rows[i - 2], rows[i - 1], rows[i]];
    if (a.length !== 1 || b.length !== 1 || c.length !== 1 || c[0].end || a[0].end) continue;
    if (c[0].t - a[0].t > 0.4) continue;
    const [la, lb] = [a[0].lane, b[0].lane];
    if (c[0].lane !== la || la === lb || rnd() >= rate) continue;
    const next = rows[i + 1];
    const lastIn = (l: number) => {
      for (let k = i - 1; k >= 0; k--) if (rows[k].some((m) => m.lane === l)) return rows[k][0].t;
      return -Infinity;
    };
    const cand = [0, 1, 2, 3]
      .filter((l) => l !== la && l !== lb && !(next && next.some((m) => m.lane === l)))
      .filter((l) => c[0].t - lastIn(l) >= jackGap)
      .sort((x, y) => Math.abs(x - la) - Math.abs(y - la));
    if (cand.length) c[0].lane = cand[0];
  }
}

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
    jackAllow: 0.01,
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
    jackAllow: 0.02,
    jackRun: 2,
    ln: { ratio: 0.09, lens: [1, 1, 1, 2, 2], maxSec: 0.8, onBeat: 0.94 },
  },
  hard: {
    nps: 8.5,
    minGap: 0.08,
    jackGap: 0.17,
    pos: [1, 0.55, 0.3, 0.03, 0],
    fineNeed: 0.45,
    floor: 0.07,
    chord: { every: 2, need: 0.45 },
    holdBeats: 1.5,
    thick: [1.37, 1.1, 1.05],
    tri: 0,
    jackAllow: 0.8,
    jackRun: 3,
    ln: { ratio: 0.06, lens: [1, 1, 1.5, 2], maxSec: 0.9, onBeat: 0.81 },
  },
  expert: {
    nps: 11.3,
    minGap: 0.075,
    jackGap: 0.12,
    pos: [1, 1, 0.75, 0.45, 0.2],
    floor: 0.05,
    chord: { every: 2, need: 0.4 },
    holdBeats: 1.25,
    thick: [1.75, 1.2, 1.0],
    tri: 0.04,
    jackAllow: 0.45,
    jackRun: 3,
    ln: { ratio: 0.06, lens: [1, 1, 1, 1.5, 2], maxSec: 0.8, onBeat: 0.69 },
  },
  // 나이트메어: 매우 어려움보다 촘촘하게 고른 뒤, 센 마디는 16분으로 꽉 채우고 패턴으로만 레인을 깖 (아래 nightmareNotes)
  nightmare: {
    nps: 13,
    minGap: 0.072,
    jackGap: 0.1,
    pos: [1, 1, 0.95, 0.85, 0.5],
    // 16분 자리 타격은 센 것만 고름 (하이햇 16분까지 다 받으면 16분 자리가 줄의 30%를 넘음 — osu·Quaver 18~23%)
    fineNeed: 0.5,
    floor: 0.04,
    chord: { every: 2, need: 0.35 },
    holdBeats: 1.25,
    thick: [1.5, 1.25, 1.0],
    tri: 0.25,
    jackAllow: 0.5,
    jackRun: 4,
    ln: { ratio: 0.06, lens: [1, 1, 1, 1.5], maxSec: 0.7, onBeat: 0.63 },
  },
  // EX+ (Lv19~21): 나이트메어 경로 그대로. osu 랭크 4.75~5.5성 104개 기준 — 초당 15.4(p10 8 · p90 21, 조용한 데는 여전히 비움),
  // 동시치기 43%(3개 7.7%), 잭 15%, 롱노트 7.5%, 32분은 3%뿐 → 32분 연타보다 잭·3개 동시치기·롱노트로 어려움을 올림
  explus: {
    nps: 15,
    minGap: 0.058,
    // 16분 잭(코드잭)까지: osu·Quaver 5성급은 잭 19~26% — 16분 간격(180 BPM 83ms)을 막으면 레벨을 16분 스트림으로만 올리게 됨
    jackGap: 0.07,
    pos: [1, 1, 1, 0.95, 0.6],
    fineNeed: 0.4,
    floor: 0.03,
    chord: { every: 2, need: 0.3 },
    holdBeats: 1.25,
    thick: [1.9, 1.45, 1.15],
    tri: 0.45,
    jackAllow: 0.9,
    jackRun: 6,
    ln: { ratio: 0.06, lens: [1, 1, 1, 1.5, 2], maxSec: 1, onBeat: 0.63 },
  },
};
/** 나이트메어 경로(패턴으로만 레인을 깖)를 쓰는 난이도 */
const isNm = (d: Difficulty) => d === "nightmare" || d === "explus";

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
  /** 아주 센 마디에서 동시치기를 앞 2박에 뭉침(점프스트림 + 뒤 2박 단노트 스트림) — 나이트메어만.
   *  ULTIMA(osu 5성급)는 곡 전체가 점프스트림이라 안 뭉침 (뭉치면 별점 천장이 내려가 나메와 같은 레벨이 됨) */
  cluster?: boolean;
  /** 몇 마디마다 마지막 박을 연타로 (아주 센 마디) */
  burstEvery?: number;
  /** 연타 등분 (8 = 32분, 6 = 16분 셋잇단 — 기본은 6: 32분은 빠른 곡에서 못 칠 만큼 촘촘) */
  burstSub?: number;
  /** 아주 센 마디에서 16분으로 채울 박: 곡에 이 세기 이상인 16분 자리 타격이 있는 박만 */
  fineS?: number;
  /** 동시치기 두께 배율 (1 = 규칙의 thick 그대로) — 레벨이 모자랄 때 16분을 늘리기 전에 동시치기부터 */
  chordScale?: number;
  /** 16분 자리 줄을 동시치기로 바꾸는 몫 (더하기) — 16분 칸을 더 열기 전에 16분 점프스트림으로 레벨을 올림.
   *  osu·Quaver 나이트메어급은 16분 자리가 줄의 18~26%인데 빠른 동시치기 연속(cc)은 6~7% — 우리는 16분만 늘려 31%·1.7%였음 */
  fineChord?: number;
  /** 박 안 두 번째부터의 동시치기 자리(8분 뒷박 등)를 실제 동시치기로 하는 몫 — 박 머리는 늘 동시치기 */
  halfChord?: number;
  /** 16분으로 채우는 박에도 뒷박 동시치기를 넣을지 (빠른 곡은 안 넣음 — 16분 점프스트림이 됨) */
  streamChord?: boolean;
  /** 박 머리 동시치기는 그 자리 타격 세기가 이 이상일 때만 (0 = 늘) */
  headChord?: number;
  /** 뒷박(8분) 노트는 그 자리 타격 세기가 이 이상일 때만 (0 = 늘) — 박마다 같은 「정박 동시치기 + 뒷박」이 되지 않게 */
  offNeed?: number;
  /** 연타 노트 간격이 이보다 짧으면(초) 연타 박을 안 넣음 — 빠른 곡 나이트메어에 50ms 연타가 생기지 않게 */
  burstMinGap?: number;
}
// 나이트메어 박 안 리듬 모양(4칸)도 곡 소리대로 섞음 — 박 머리 동시치기는 센 소리(0.45)에만, 뒷박은 소리 있을 때만(0.25).
//  전엔 박의 38%가 「정박 동시치기 + 뒷박 단노트」 한 모양(osu 최다 모양 17%)이라 단조로웠음 — osu 와 같은 곡에 돌려
//  모양 분포 거리 0.41 → 0.24, 간격 엔트로피 1.20 → 1.41 (osu 1.43), 동시치기 줄 51 → 43% (osu 39%)
// 나이트메어: 정박 위주 — osu · Quaver 랭크 Lv15~17 은 줄의 정박 38~40% · 8분 34~35% · 16분 18~24%,
//  동시치기의 68~70%가 정박 위인데 우리는 34 · 33 · 34% · 56%였음 (16분 단노트 스트림 · 16분 점프스트림으로 레벨을 냄).
//  아주 센 박도 8분 + 박 머리 동시치기로 깔고(뭉치기 없음), 뒷박 동시치기는 60%만, 16분은 센 16분 소리(0.45)에만
const NIGHTMARE_DEFAULT: Required<NightmareTweak> = {
  loud: 0.45,
  full: 0.72,
  loudSub: 2,
  fullSub: 4,
  chordLoud: 1,
  chordFull: 2,
  cluster: false,
  burstEvery: 8,
  burstSub: 6,
  fineS: 0.45,
  chordScale: 1,
  fineChord: 0,
  halfChord: 0.6,
  streamChord: true,
  headChord: 0.45,
  offNeed: 0.25,
  burstMinGap: 0.06,
};
/** EX+ 기본: 센 마디 8분·아주 센 마디 16분 꽉은 나이트메어와 비슷한 문턱(기승전결 유지), 4마디마다 16분 셋잇단 연타 */
const EXPLUS_DEFAULT: Required<NightmareTweak> = {
  loud: 0.45,
  full: 0.6,
  loudSub: 2,
  fullSub: 4,
  chordLoud: 1,
  chordFull: 1,
  cluster: false,
  burstEvery: 4,
  burstSub: 6,
  fineS: 0.2,
  chordScale: 1,
  fineChord: 0,
  halfChord: 1,
  streamChord: true,
  headChord: 0,
  offNeed: 0,
  burstMinGap: 0,
};
/** 16분 점프스트림 몫 상한 — 0 (16분 자리 동시치기는 정박 위주와 반대 · 빠른 곡은 실제 플레이에서 무너지는 자리였음) */
const fineChordMax = (_d: Difficulty, _fast: boolean) => 0;
/** 동시치기 두께 배율 상한 — 빠른 곡(185 BPM↑)은 안 두껍게 (16분을 덜 여는 만큼 동시치기로 메우면 동시치기 66%·잭 37% 벽이 됨).
 *  나이트메어는 16분을 덜 여는 대신 정박 동시치기로 레벨을 냄 */
const chordMax = (d: Difficulty, fast: boolean) => (fast ? 1 : d === "nightmare" ? 2.2 : 1.5);
/** 16분 박을 여는 하한(fineS) — 빠른 곡은 이 밑으로 안 엶. 레벨이 덜 나와도 16분 자리 비중을 osu·Quaver에 맞춤
 *  (185 BPM↑ 나이트메어·ULTIMA 16분 자리 32·45% → 19·26%, osu·Quaver 13~25%). 나이트메어는 보통 곡도 센 16분 소리만 */
const fineMin = (d: Difficulty, fast: boolean) =>
  !fast ? (d === "nightmare" ? 0.45 : -0.1) : d === "nightmare" ? 0.2 : 0.1;
const nmDefault = (d: Difficulty) => (d === "explus" ? EXPLUS_DEFAULT : NIGHTMARE_DEFAULT);

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
  // (나이트메어·ULTIMA는 16분 칸 간격까지 — 210 BPM 넘는 곡은 16분이 72ms 안쪽이라 16분을 못 쓰고 동시치기 벽이 됐음.
  //  osu·Quaver 210~240 BPM 나이트메어·ULTIMA는 16분 자리 16~27%)
  R.minGap = Math.max(R.minGap, isNm(diff) ? Math.min(0.072, (beatSec / 4) * 0.9) : 0.072);
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
        (posKind(o, an.div) < 2 ||
          // (나이트메어·ULTIMA: 16분 박을 다 연 뒤(fineS < 0)엔 약한 16분 타격도)
          (isNm(diff) && (tweak.nightmare?.fineS ?? 0) < 0) ||
          o.s >= (R.fineNeed ?? 0) - 0.6 * (tweak.fill ?? 0)) &&
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
  const cntBar = new Float32Array(nBars);
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
    if (o.s >= 0.3) cntBar[b]++;
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
  // 나이트메어·ULTIMA 채우기용 세기: 곡 안에서의 순위(0~1). 음량 2 : 센 타격 수 1 (osu 랭크 102곡에서 마디별 노트 수와
  // 순위 상관이 가장 높은 조합 0.58 — 위 세기는 0.50). 요즘 곡은 음량이 눌려 세기가 0.6~0.9에 몰려서
  // 문턱(loud·full)을 절대값으로 두면 곡 전체가 '아주 센 마디'가 됨 → 순위로 (osu는 벌스 9 · 코러스 13처럼 구간 차이가 뚜렷)
  const rankI = new Float32Array(nBars);
  {
    const nc = norm(cntBar);
    const v = (b: number) => (2 * nr(b) + nc(b)) / 3;
    const live = [...Array(nBars).keys()].filter((b) => intensity[b] > 0);
    const sorted = live.map(v).sort((x, y) => x - y);
    for (const b of live) {
      let lo = 0;
      let hi = sorted.length;
      const x = v(b);
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (sorted[m] < x) lo = m + 1;
        else hi = m;
      }
      rankI[b] = sorted.length > 1 ? lo / (sorted.length - 1) : 1;
    }
  }
  const nmI = (b: number) => rankI[Math.max(0, Math.min(nBars - 1, b))];
  const jump = (b: number) => (b > 0 ? intensity[b] - intensity[b - 1] : 0);
  const sectionStart = (b: number) => jump(b) >= 0.18 && intensity[b] >= 0.55;
  const buildBar = (b: number) => sectionStart(b + 1) || sectionStart(b + 2);
  // 프레이즈(4마디·8마디) 위상: 구간이 터지는 마디가 가장 많이 걸리는 자리를 프레이즈 시작으로
  // (osu 랭크 채보는 4마디 시작 정박에 동시치기를 다른 정박의 1.5~2.5배, 8마디 시작엔 더 몰아 둠 — 곡 구성이 손에 느껴지게)
  let phrasePhase = 0;
  {
    let best = -1;
    for (let k = 0; k < 4; k++) {
      let v = 0;
      for (let b = 0; b < nBars; b++) if (sectionStart(b)) v += b % 4 === k ? 1 : 0;
      if (v > best) ((best = v), (phrasePhase = k));
    }
  }
  /** 마디가 프레이즈 시작이면 2(8마디) · 1(4마디) · 0 */
  const phraseRank = (b: number) =>
    (b - phrasePhase) % 4 !== 0 ? 0 : (b - phrasePhase) % 8 === 0 ? 2 : 1;
  /** 타격이 마디 첫 박(정박)에 있는지 */
  const onDownbeat = (t: number) => {
    const f = (t - bar0) / barSec;
    return Math.abs(f - Math.round(f)) * barSec < 0.03;
  };
  const dense = diff === "hard" || diff === "expert";
  const factorOf = (b: number) => {
    const I = isNm(diff) ? nmI(b) : intensity[Math.max(0, Math.min(nBars - 1, b))];
    // 세기 → 밀도를 가파르게: 곡의 기승전결을 그대로 따라가야 '곡과 맞는' 채보가 됨.
    // (osu 랭크 채보도 그렇다 — xi「Aragami」Another는 조용한 마디 4~8개, 터지는 마디 24~30개로 4배 차이.
    //  한때 전체 평균 통계에 맞추려 0.85+0.3I로 눌렀더니 벌스·브레이크까지 꽉 차서 맛이 없어졌음)
    // (나이트메어·ULTIMA는 곡 안 순위로 — 아래 nmI)
    let f = dense || isNm(diff) ? 0.15 + 1.15 * I : 0.35 + 0.8 * I;
    if (I < 0.15) f *= 0.8; // 브레이크
    if (buildBar(b)) f *= 1.25; // 빌드업
    return f;
  };
  /** 마디별 목표 노트 수 (밀도 규칙 × 세기) */
  const barTarget = (b: number) => Math.max(1, Math.round(R.nps * barSec * factorOf(b)));

  // 1) 강한 것부터 간격을 지키며 고르기 — 마디마다 목표 개수를 따로 둬서
  //    세기에 따라 밀도가 오르내리고, 조용하지만 빽빽한 구간도 큰 소리 구간에 밀리지 않게
  const perBar = new Map<number, number>();
  const taken: number[] = [];
  const picked: Onset[] = [];
  for (const { o } of cands) {
    const b = barOf(o.t);
    if ((perBar.get(b) ?? 0) >= barTarget(b)) continue;
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
  //      + 소리가 꽉 차서 타격이 따로 안 잡히는 마디(벽)는 fill이 0이어도 마디 목표까지 격자로 채움
  //        (Aragami 15~24초처럼 제일 센 구간이 오히려 비던 문제)
  if (!isNm(diff) && (diff === "hard" || diff === "expert" || (tweak.fill ?? 0) > 0)) {
    // fill 1을 넘으면(1~1.6) 어지간한 마디까지 다 채움
    const fill = Math.min(1.6, tweak.fill ?? 0);
    // 채우기 양이 fill에 따라 이어지게(0에서 살짝만 올려도 센 마디가 한꺼번에 채워지며 노트가 50% 뛰던 것):
    // fill이 커질수록 가장 센 마디부터 차츰 더 넓게 — 단 조용한 마디(0.45 미만)는 안 채움 (벌스까지 꽉 차면 맛없음)
    const loudT = fill > 0 ? Math.max(0.45, 0.95 - fill) : 2;
    // 벽 마디: 세기 0.8 이상인데 고른 타격이 목표의 3/4도 안 되면 목표까지
    const wallT = 0.8;
    const barCount = new Map<number, number>();
    for (const o of picked) barCount.set(barOf(o.t), (barCount.get(barOf(o.t)) ?? 0) + 1);
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
      const b = barOf(t0);
      const I = intensity[Math.max(0, Math.min(nBars - 1, b))];
      const cap = barTarget(b);
      const wall = dense && I >= wallT && (barCount.get(b) ?? 0) < cap * 0.75;
      if (I < loudT && !wall) continue;
      // 12/8(셋잇단 격자)은 점4분을 3·6으로 나눠야 곡 박자에 맞음
      // 잘게 나눈 칸이 너무 촘촘하면(90ms 미만) 한 단계 덜 나눔
      const fine = an.div === 12 ? 6 : 4;
      // 쉬움은 정박만
      const sub = diff === "easy" ? 1 : I >= fullT && beatSec / fine >= 0.08 ? fine : fine / 2;
      const t1 = beatT(k + 1);
      for (let i = 0; i < sub; i++) {
        // 마디 목표(벽 마디는 목표, 채우기는 목표의 1+fill배)를 넘기지 않음 — 세기 차이가 채우기로 뭉개지지 않게
        if ((barCount.get(b) ?? 0) >= cap * (I >= loudT ? 1 + fill : 1)) break;
        const t = t0 + (i * (t1 - t0)) / sub;
        if (tooClose(have, t, R.minGap)) continue;
        let j = have.findIndex((x) => x > t);
        if (j < 0) j = have.length;
        have.splice(j, 0, t);
        added.push({ t, s: 0.3, low: 0.3, mid: 0.3, high: 0.3, cen: nearestCen(an, t), grid: -1 });
        barCount.set(b, (barCount.get(b) ?? 0) + 1);
      }
    }
    picked.push(...added);
    picked.sort((a, b) => a.t - b.t);
  }

  // 1.8) 어려움 이상: 리듬 고르게 — 간격이 직전 간격의 같음·2배·반이 아닌 걸로 갑자기 바뀌는 자리
  //      (osu 4★대 랭크 채보 4%, 손대기 전 우리 10~17%)를 사이에 박을 넣거나 약한 쪽을 빼서 정리
  if (diff === "hard" || diff === "expert" || isNm(diff)) {
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

  if (isNm(diff)) {
    const shift = shiftMs / 1000;
    const def = nmDefault(diff);
    const burstT: number[] = [];
    const nm = nightmareNotes(
      an,
      picked,
      {
        ...def,
        ...tweak.nightmare,
        // 채우기가 클수록 덜 센 마디까지
        loud: (tweak.nightmare?.loud ?? def.loud) - 0.15 * (tweak.fill ?? 0),
        full: (tweak.nightmare?.full ?? def.full) - 0.15 * (tweak.fill ?? 0),
      },
      {
        beatSec,
        barOf,
        intensity: nmI,
        patCtx,
        thick: R.thick,
        tri: R.tri,
        burstOut: burstT,
      }
    );
    const nmRows0 = regularizeRows(nm);
    detrill(nmRows0, R.jackGap, 0.1, rnd);
    deaba(nmRows0, R.jackGap, 0.5, rnd);
    // 곡 안 밀도 고르기는 ULTIMA 만 — NIGHTMARE 에 넣으면 별점이 바뀌어 레벨 맞추기가 다른 시도를 골라
    //  채보가 통째로 바뀜 (PIXEL Fighting NIGHTMARE 레인 47%만 같음). 따로 된 난수로 — 같은 rnd 를 쓰면
    //  뒤의 롱노트 고르기까지 곡 전체가 바뀜
    let evSeed = (seed ^ 0x9e3779b9) >>> 0;
    const evRnd = () => (evSeed = (evSeed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const nmRows =
      diff === "explus"
        ? evenDensity(nmRows0, { an, barOf, nBars, beatSec, minGap: R.minGap, rnd: evRnd })
        : nmRows0;
    // 연타 박: 연타 노트와 45ms 안으로 붙은 다른 노트를 뺌 — 16분(4등분)과 연타(6등분)가 섞이면 30~35ms 간격이 생김
    //  (148 BPM에서 101ms 16분 사이에 67ms 연타 → 34ms, 한 박만 엄청 촘촘)
    const nmClean = burstT.length
      ? nmRows.filter((n) => {
          const d = burstT.map((b) => Math.abs(b - n.t));
          return d.some((x) => x < 0.002) || !d.some((x) => x < 0.045);
        })
      : nmRows;
    const nmHeld = addLongNotes(nmClean, {
      ...R.ln,
      beatSec,
      beatTimes: an.beats,
      rmsAt,
      rnd,
      duringW: 0.15,
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
      // 마디 몫은 세기에 따라 (센 마디에 더, 조용한 마디엔 덜 — 전체 비율은 그대로)
      const cw = chordWeight(byBar, (b) => intensity[Math.max(0, Math.min(nBars - 1, b))]);
      // 반올림 찌꺼기는 마디를 넘기며 이월 (비율이 전체로는 맞게)
      let carry2 = 0;
      let carry3 = 0;
      // 프레이즈 시작 정박은 세기에 보너스(4마디 +0.25 · 8마디 +0.5)를 줘서 동시치기 몫을 먼저 받게
      const sOf = (i: number) => {
        const o = picked[i];
        const pr = onDownbeat(o.t) ? phraseRank(barOf(o.t)) : 0;
        return o.s + (pr === 2 ? 0.5 : pr === 1 ? 0.25 : 0);
      };
      for (const b of [...byBar.keys()].sort((x, y) => x - y)) {
        const list = byBar.get(b)!.sort((x, y) => sOf(y) - sOf(x));
        const want2 = list.length * twoRate * cw(b) + carry2;
        const want3 = list.length * threeRate * cw(b) + carry3;
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
    // 트릴(A B A B) 피하기: osu 랭크 채보는 보통·어려움에서 같은 두 레인을 번갈아 치는 자리가 1~3%뿐인데
    // 우리는 킥·스네어가 번갈면 음높이 순위가 그대로 레인이 돼 8~13%였음 → 보통·어려움은 거의 항상, 그 위는 반쯤 다른 레인으로
    if (!dir && !patLanes && prev2 && prev && prev.t !== o.t && prev2.t !== prev.t) {
      let prev3: Note | undefined;
      for (let k = notes.length - 1; k >= 0; k--)
        if (notes[k].t < prev2.t) {
          prev3 = notes[k];
          break;
        }
      const trillAvoid = diff === "normal" || diff === "hard" ? 0.9 : 0.5;
      if (
        prev3 &&
        prev3.lane === prev.lane &&
        prev2.lane === want &&
        want !== prev.lane &&
        o.t - prev3.t <= beatSec * 2 + 0.01 &&
        rnd() < trillAvoid
      ) {
        const alt = [0, 1, 2, 3].filter((l) => l !== want && l !== prev.lane);
        want = alt[Math.abs(want - alt[0]) <= Math.abs(want - alt[1]) ? 0 : 1];
      }
    }
    // 손 번갈기: 단노트가 같은 손에 이어지면 조금은 다른 손으로 (osu 보통·어려움은 다음 노트가 다른 손일 비율 63~69%, 우리 56~63%)
    if (
      !dir &&
      !patLanes &&
      prev &&
      prev.t !== o.t &&
      hand(prev.lane) === hand(want) &&
      // (매우 어려움은 덜 — osu·Quaver 매우 어려움은 빠른 연속 중 한 손 연속이 22~25%, 우리 19%)
      rnd() < (diff === "expert" ? 0.1 : 0.25)
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
      if (l2 !== want && o.t - laneLast[l2] >= R.jackGap && (jackOk || !prevRow.has(l2))) {
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
      ((sectionStart(barOf(o.t)) && (i === 0 || barOf(picked[i - 1].t) !== barOf(o.t))) ||
        // 8마디 프레이즈 시작 정박도 최소 1개. 보통은 동시치기 몫이 적어(5%) 4마디 시작까지 — 그 몫을 프레이즈에 쓰는 셈
        // (osu 보통 채보: 4마디 시작 정박 40%·8마디 50%가 동시치기, 다른 정박은 15%)
        (onDownbeat(o.t) &&
          (phraseRank(barOf(o.t)) === 2 ||
            (diff === "normal" && phraseRank(barOf(o.t)) === 1 && o.s >= 0.65)) &&
          (diff !== "normal" || o.s >= 0.4) &&
          intensity[Math.max(0, Math.min(nBars - 1, barOf(o.t)))] >= 0.3));
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
          o.t - laneLast[l] >= R.jackGap &&
          (jackOk || !prevRow.has(l)) &&
          !notes.some((m) => m.t === o.t && m.lane === l),
        recent: chordHist,
        rnd,
      });
      for (const l2 of ls) {
        notes.push({ t: o.t, lane: l2 });
        laneLast[l2] = o.t;
      }
    }
  }

  const copyDropped = new Set<Note>();
  const copyAdded: Note[] = [];
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
    // 원본 마디들: 칸(16분·셋잇단) 집합과 칸→레인들. 리듬이 거의 같으면(자카드 ≥ 0.75) 같은 칸의 레인을 가져옴
    // (osu 랭크 채보: 음악이 같은 마디끼리 레인까지 같은 정도가 거울 포함 0.36~0.44, 우리는 0.27~0.34였음 —
    //  꼭 같은 키일 때만 복사하던 걸 '거의 같은' 리듬까지 넓힘. 그대로가 아니라 홀수 번째는 좌우 반전)
    const slotOf = (n: Note, b: number) =>
      Math.round(((n.t - bar0 - b * barSec) / beatSec) * an.div);
    const seen: { slots: Set<number>; lanes: Map<number, number[]>; n: number }[] = [];
    const jac = (a: Set<number>, c: Set<number>) => {
      let inter = 0;
      for (const v of a) if (c.has(v)) inter++;
      return inter / (a.size + c.size - inter);
    };
    for (const [b, list] of [...byBar.entries()].sort((x, y) => x[0] - y[0])) {
      list.sort((x, y) => x.t - y.t || x.lane - y.lane);
      const slots = new Set(list.map((n) => slotOf(n, b)));
      // 8분·16분으로 꽉 찬 마디는 리듬만으로는 다 똑같아 보여서(코러스 8마디가 전부 같은 키) 복사하면
      // 같은 손 모양이 끝없이 반복됨 → 이런 마디는 복사하지 않고 패턴 다양성에 맡김.
      // "프레이즈가 반복된다"고 볼 수 있는 건 리듬에 생김새가 있는(간격이 고르지 않은) 마디뿐
      const ts = [...new Set(list.map((n) => n.t))];
      const ivs = new Set(ts.slice(1).map((t, k) => Math.round((t - ts[k]) * 50)));
      const uniform = ts.length >= 6 && ivs.size <= 1;
      if (uniform || slots.size < 3) continue;
      let hit: (typeof seen)[number] | null = null;
      let bestJ = 0.75;
      for (const sdef of seen) {
        if (sdef.n >= 3) continue;
        const j = jac(sdef.slots, slots);
        if (j >= bestJ) ((bestJ = j), (hit = sdef));
      }
      if (hit) {
        hit.n++;
        const mirror = hit.n % 2 === 1;
        // 같은 칸에 있는 줄만 원본 레인으로 (줄의 노트 수가 같을 때), 나머지 줄은 그대로
        const next = new Map<Note, number>();
        const rows = new Map<number, Note[]>();
        for (const n of list) {
          const sl = slotOf(n, b);
          if (!rows.has(sl)) rows.set(sl, []);
          rows.get(sl)!.push(n);
        }
        const toAdd: Note[] = [];
        const toDrop = new Set<Note>();
        for (const [sl, row] of rows) {
          const src = hit.lanes.get(sl);
          if (!src || Math.abs(src.length - row.length) > 1) continue;
          const lanes = (mirror ? src.map((l) => 3 - l) : src.slice()).sort((x, y) => x - y);
          // 줄의 노트 수가 1개 차이면 원본에 맞춤 (동시치기 모양까지 같아야 '같은 프레이즈'로 느껴짐)
          row.forEach((n, k) => {
            if (k < lanes.length) next.set(n, lanes[k]);
            else toDrop.add(n);
          });
          for (let k = row.length; k < lanes.length; k++)
            toAdd.push({ t: row[0].t, lane: lanes[k] });
        }
        // 복사한 레인이 바로 앞·뒤 줄(연타 간격 안)과 같은 레인이면 그 마디는 복사 안 함
        const laneAt = (n: Note) => next.get(n) ?? n.lane;
        const all = [...(byBar.get(b - 1) ?? []), ...list, ...toAdd, ...(byBar.get(b + 1) ?? [])]
          .filter((n) => !toDrop.has(n))
          .sort((x, y) => x.t - y.t);
        // 복사한 레인이 바로 앞·뒤 줄(연타 간격 안)과 같은 레인이면: 난이도별 잭 허용 확률만큼은 그대로 두고,
        // 아니면 그 노트만 같은 줄에 없는 다른 레인으로 옮김 (옮길 데가 없으면 그 마디는 복사 안 함)
        let bad = false;
        // 바로 앞 줄(시각이 다른 가장 가까운 줄)과만 비교 — 간격과 상관없이 앞 줄과 같은 레인은 잭으로 셈 (레인 배정과 같은 기준)
        for (let k = 1; k < all.length && !bad; k++) {
          let p = k - 1;
          while (p >= 0 && all[p].t === all[k].t) p--;
          if (p < 0) continue;
          const prevT = all[p].t;
          for (let m = p; m >= 0 && all[m].t === prevT; m--) {
            if (laneAt(all[m]) !== laneAt(all[k])) continue;
            if (rnd() < R.jackAllow * 0.4) continue;
            const mine = next.has(all[k]) ? all[k] : next.has(all[m]) ? all[m] : null;
            if (!mine) continue; // 복사와 상관없이 원래 있던 잭
            const rowLanes = new Set(all.filter((x) => x.t === mine.t).map(laneAt));
            const other = mine === all[k] ? all[m] : all[k];
            const free = [1, -1, 2, -2, 3, -3]
              .map((d) => laneAt(mine) + d)
              .filter((l) => l >= 0 && l <= 3 && !rowLanes.has(l) && l !== laneAt(other));
            if (!free.length) {
              bad = true;
              break;
            }
            next.set(mine, free[0]);
          }
        }
        if ((globalThis as { DEBUG_COPY?: boolean }).DEBUG_COPY)
          console.log(
            `copy bar ${b} j=${bestJ.toFixed(2)} rows ${rows.size} copied ${next.size} bad=${bad}`
          );
        if (!bad) {
          for (const [n, l] of next) n.lane = l;
          for (const n of toDrop) copyDropped.add(n);
          copyAdded.push(...toAdd);
          list.push(...toAdd);
        }
      } else {
        const lanes = new Map<number, number[]>();
        for (const n of list) {
          const sl = slotOf(n, b);
          if (!lanes.has(sl)) lanes.set(sl, []);
          lanes.get(sl)!.push(n.lane);
        }
        seen.push({ slots, lanes, n: 0 });
      }
    }
  }

  if (copyDropped.size || copyAdded.length) {
    const kept = notes.filter((n) => !copyDropped.has(n));
    notes.length = 0;
    notes.push(...kept, ...copyAdded);
    notes.sort((x, y) => x.t - y.t || x.lane - y.lane);
  }

  // 3.7) 잭 걷어내기: 어느 경로(레인 배정·패턴·동시치기 짝·마디 복사)로 생겼든, 완성된 줄에서
  //      바로 앞 줄(8분 이하 간격)과 같은 레인인 노트는 난이도별 허용 확률(jackAllow)만큼만 남기고 옆 레인으로.
  //      osu 랭크 측정: 빠른 연속 중 같은 레인이 보통 0% · 어려움 1.5% · 매우 어려움 5.8% — 우리는 13% 안팎이었음
  //      (나이트메어·ULTIMA는 위의 전용 경로에서 패턴으로만 레인을 깔고, 비율도 osu와 비슷해 손대지 않음)
  dejack(notes, beatSec, R, rnd);
  detrill(notes, R.jackGap, 0.1, rnd);
  if (diff === "expert") deaba(notes, R.jackGap, 0.5, rnd);

  // (3.8 곡 안 밀도 고르기는 ULTIMA 만 — HARD · EX 에 넣었더니 센 구간 동시치기 · 16분을 덜어낸 만큼
  //  레벨 맞추기가 곡 전체에 16분을 더 깔아서(Lucky Seven Rush EX 515 → 729노트, 동시치기 52 → 34%) 더 지저분해졌음)

  // 4) 롱노트: osu 랭크 채보처럼 노트의 일정 비율을 짧은 롱노트로 (정박·소리가 남는 자리부터)
  {
    const held = addLongNotes(notes, {
      ...R.ln,
      beatSec,
      beatTimes: an.beats,
      rmsAt,
      rnd,
      duringW: diff === "easy" || diff === "normal" ? 0 : 0.15,
    });
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

/**
 * 곡 안 밀도 높낮이 고르게 (ULTIMA): 2마디씩 노트 수를 그 채보의 중앙값과 비교해서
 *  · 1.3배를 넘는 구간은 3개 동시치기 → 엇박 동시치기 → 앞뒤가 16분인 단노트 → 정박 동시치기 순으로 덜어내고
 *  · 0.55배에 못 미치는(완전히 조용하진 않은) 구간은 그 마디의 센 정박·8분 타격으로 채움.
 * 소리가 꽉 찬 도입부만 레벨보다 훨씬 어렵고(FREEDOM DiVE ULTIMA 도입 16 nps — osu Lv21급) 중간이 텅 비어
 * 평균 레벨은 낮게 나오던 것. osu 랭크 채보는 4초 구간 밀도가 중앙값의 1.2배 안팎, 우리는 1.4배였음.
 * 레벨은 그다음 레벨 맞추기가 다시 맞춤 (높낮이가 줄어든 만큼 다른 구간이 조금 채워짐)
 */
function evenDensity(
  notes: Note[],
  ctx: {
    an: Analysis;
    barOf: (t: number) => number;
    nBars: number;
    beatSec: number;
    minGap: number;
    rnd: () => number;
  }
) {
  const { an, barOf, nBars, beatSec, minGap, rnd } = ctx;
  const HI = 1.3;
  const LO = 0.55;
  const count = new Float32Array(nBars);
  for (const n of notes) {
    const b = barOf(n.t);
    if (b >= 0 && b < nBars) count[b]++;
  }
  const pair = (b: number) => (count[b] + (b + 1 < nBars ? count[b + 1] : count[b])) / 2;
  const vals = [...Array(nBars).keys()].map(pair).filter((v) => v > 0);
  if (vals.length < 8) return notes;
  const p90 = [...vals].sort((x, y) => x - y)[Math.floor(vals.length * 0.9)];
  const live = vals.filter((v) => v >= p90 * 0.3).sort((x, y) => x - y);
  const med = live[Math.floor(live.length / 2)] ?? 0;
  if (med < 4) return notes;
  const cap = med * HI;
  const floor = med * LO;

  // 줄(같은 시각) 단위로
  const rowsOf = (list: Note[]) => {
    const m = new Map<number, Note[]>();
    for (const n of list) {
      const k = Math.round(n.t * 1000);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  };
  const onBeat = (t: number) => {
    const f = (t - (an.beats[0] ?? 0)) / beatSec;
    return Math.abs(f - Math.round(f)) < 0.08;
  };
  const drop = new Set<Note>();
  const byBar = new Map<number, Note[]>();
  for (const n of notes) {
    const b = barOf(n.t);
    if (!byBar.has(b)) byBar.set(b, []);
    byBar.get(b)!.push(n);
  }
  // 1) 넘치는 마디 덜기 — 두 마디 평균이 상한을 넘으면 그 두 마디를 상한까지
  for (let b = 0; b < nBars; b++) {
    const over = Math.round((pair(b) - cap) * 2);
    if (over <= 0) continue;
    const list = [...(byBar.get(b) ?? []), ...(byBar.get(b + 1) ?? [])].filter((n) => !drop.has(n));
    const rows = rowsOf(list);
    // 단계별 후보 (롱노트 머리는 안 건드림 — 아직 롱노트 전이라 end 없음)
    const tiers: Note[][] = [[], [], [], []];
    rows.forEach((r, i) => {
      const prev = rows[i - 1]?.[0].t ?? -9;
      const next = rows[i + 1]?.[0].t ?? 9e9;
      const fine = r[0].t - prev < beatSec * 0.3 && next - r[0].t < beatSec * 0.3;
      if (r.length >= 3) tiers[0].push(r[r.length - 1]);
      else if (r.length === 2 && !onBeat(r[0].t)) tiers[1].push(r[1]);
      else if (r.length === 1 && fine && !onBeat(r[0].t)) tiers[2].push(r[0]);
      else if (r.length === 2) tiers[3].push(r[1]);
    });
    let left = over;
    for (const tier of tiers) {
      if (left <= 0) break;
      // 구간에 고르게: 하나 건너 하나부터
      const order = [...tier.filter((_, i) => i % 2 === 0), ...tier.filter((_, i) => i % 2 === 1)];
      for (const n of order) {
        if (left <= 0) break;
        if (drop.has(n)) continue;
        drop.add(n);
        count[barOf(n.t)]--;
        left--;
      }
    }
  }
  let out = drop.size ? notes.filter((n) => !drop.has(n)) : notes;

  // 2) 빈 마디 채우기 — 그 마디의 센 정박·8분 타격으로 (앞뒤 줄과 다른 레인)
  const add: Note[] = [];
  const times = [...new Set(out.map((n) => n.t))].sort((x, y) => x - y);
  const laneAt = new Map<number, number[]>();
  for (const n of out) {
    const k = Math.round(n.t * 1000);
    if (!laneAt.has(k)) laneAt.set(k, []);
    laneAt.get(k)!.push(n.lane);
  }
  const near = (t: number) => {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (times[m] < t) lo = m + 1;
      else hi = m;
    }
    return { prev: times[lo - 1], next: times[lo] };
  };
  for (let b = 0; b < nBars; b++) {
    const have = count[b];
    if (have >= floor || have < med * 0.15) continue; // 넉넉하거나, 거의 조용한 마디(브레이크)는 그대로
    let need = Math.round(floor - have);
    const cand = an.onsets
      .filter((o) => barOf(o.t) === b && o.grid >= 0 && o.s >= 0.15 && posKind(o, an.div) <= 1)
      .sort((x, y) => y.s - x.s);
    for (const o of cand) {
      if (need <= 0) break;
      const { prev, next } = near(o.t);
      if (
        (prev !== undefined && o.t - prev < minGap) ||
        (next !== undefined && next - o.t < minGap)
      )
        continue;
      const ban = new Set([
        ...(prev !== undefined ? (laneAt.get(Math.round(prev * 1000)) ?? []) : []),
        ...(next !== undefined ? (laneAt.get(Math.round(next * 1000)) ?? []) : []),
      ]);
      const free = [0, 1, 2, 3].filter((l) => !ban.has(l));
      const lane = (free.length ? free : [0, 1, 2, 3])[Math.floor(rnd() * (free.length || 4))];
      add.push({ t: o.t, lane });
      laneAt.set(Math.round(o.t * 1000), [lane]);
      const at = times.findIndex((x) => x > o.t);
      times.splice(at < 0 ? times.length : at, 0, o.t);
      need--;
    }
  }
  if (add.length) out = [...out, ...add].sort((x, y) => x.t - y.t || x.lane - y.lane);
  return out;
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
    /** 누르는 동안 다른 노트 하나당 감점 */
    duringW?: number;
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
    // 누르는 동안 다른 레인 노트가 적은 자리 우선: 롱노트를 누른 채 치는 노트는 별점 ×1.25라
    // 같은 레벨에 노트가 확 줄어듦 (매우 어려움 기준 롱노트가 레벨을 0.5 올렸음 — osu는 0.1)
    let during = 0;
    for (let j = i + 1; j < out.length && out[j].t < n.t + len; j++)
      if (out[j].t > n.t + 1e-6) during++;
    cands.push({ i, len, on, score: keep + o.rnd() * 0.3 - (o.duringW ?? 0) * during });
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
/**
 * 동시치기 마디 몫의 가중치: 센 마디 1.3배, 조용한 마디 0.4배쯤 (0.4 + 0.9·세기), 전체 평균은 1이 되게 정규화.
 * osu 랭크 채보는 동시치기가 코러스·드롭에 몰리고 벌스는 단노트 위주라 — 고르게 뿌리면 밋밋함
 */
function chordWeight<T>(byBar: Map<number, T[]>, intensity: (b: number) => number) {
  let total = 0;
  let wsum = 0;
  const w = (b: number) => 0.4 + 0.9 * intensity(b);
  for (const [b, list] of byBar) {
    total += list.length;
    wsum += list.length * w(b);
  }
  const scale = wsum > 0 ? total / wsum : 1;
  return (b: number) => w(b) * scale;
}

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
    /** 연타 노트 시각을 여기에 넣어 줌 */
    burstOut?: number[];
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
  /** 연타 노트 자리 — 레인을 다 정한 뒤 연타와 붙은 노트를 뺌 */
  const burstKeys = new Set<number>();
  /** burst: 32분 연타처럼 일부러 촘촘한 노트 (합치지 않음) */
  const put = (t: number, count = 1, burst = false) => {
    if (t <= 0 || t > an.duration - 0.2) return;
    const k = key(t);
    // 아주 가까운 슬롯(20ms)은 같은 노트, 72ms 안은 '살짝 어긋난 동시치기'가 되니 딱 붙은 동시치기로 합침
    const same = near(k, 0.02);
    if (burst) burstKeys.add(same ?? k);
    if (same !== null) {
      slots.set(same, Math.max(slots.get(same)!, count));
      return;
    }
    const flam = burst ? null : near(k, Math.min(0.072, (beatSec / 4) * 0.8));
    if (flam !== null) {
      slots.set(flam, 2);
      return;
    }
    slots.set(k, count);
  };
  for (const o of picked) put(o.t, 1);
  const lastPick = picked.length ? picked[picked.length - 1].t : 0;
  const nBeats = Math.ceil(an.duration / beatSec);
  // 박마다 곡에 16분 자리 타격이 있는지 — 아주 센 마디라도 16분은 소리가 16분으로 쪼개지는 박에만 깖.
  // (osu·Quaver 랭크 나이트메어급은 16분 자리가 줄의 18~29%. 센 마디를 통째로 16분으로 채우면 40%를 넘음 —
  //  나머지 박은 8분 + 동시치기(점프)로)
  const beatOf = (t: number) => {
    let lo = 0;
    let hi = beats.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (beats[m] <= t + 0.03) lo = m;
      else hi = m - 1;
    }
    return lo;
  };
  const fineBeat = new Set<number>();
  const fineHits: number[] = [];
  for (const o of an.onsets)
    if (o.grid >= 0 && o.s >= P.fineS && posKind(o, an.div) >= 2) {
      fineBeat.add(beatOf(o.t));
      fineHits.push(o.t);
    }
  fineHits.sort((x, y) => x - y);
  // 16분 박 안에서도 16분 자리는 소리가 있는 칸만 (osu는 16분 박을 다 채우지 않고 갤럽 '따-따따'처럼 소리를 따라감 —
  // 빠른 연속은 줄의 67~80%인데 16분 자리는 26%뿐). fineS < 0 이면 모든 칸
  //  fineS가 0 밑으로 내려가면 소리 없는 16분 칸도 그만큼(−0.1에서 전부) 고르게 섞어 채움 — 레벨이 한 번에 튀지 않게
  const extraFine = Math.min(1, Math.max(0, -P.fineS / 0.1));
  const spread = (k: number, i: number) => ((k * 7 + i * 3) % 10) / 10;
  const fineAt = (t: number, k: number, i: number) =>
    tooClose(fineHits, t, 0.03) || spread(k, i) < extraFine;
  // 그 자리(±30ms) 타격 세기 (없으면 0)
  const onT = an.onsets.map((o) => o.t);
  const sAt = (t: number) => {
    let lo = 0;
    let hi = onT.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (onT[m] < t - 0.03) lo = m + 1;
      else hi = m;
    }
    let v = 0;
    for (let i = lo; i < onT.length && onT[i] <= t + 0.03; i++) v = Math.max(v, an.onsets[i].s);
    return v;
  };
  /** 박 머리: 소리가 세면 동시치기 */
  const headN = (t: number) => (P.headChord <= 0 || sAt(t) >= P.headChord ? 2 : 1);
  /** 뒷박(8분): 소리가 있을 때만 */
  const offOk = (t: number) => P.offNeed <= 0 || sAt(t) >= P.offNeed;
  /** 아주 센 박 채우기: 8분 칸은 늘, 그 사이(16분) 칸은 소리가 있을 때만 */
  const putFine = (t0: number, t1: number, sub: number, k: number) => {
    const step = Math.max(1, Math.round(sub / P.loudSub));
    for (let i = 0; i < sub; i++) {
      const t = t0 + (i * (t1 - t0)) / sub;
      if ((i % step === 0 && (i === 0 || offOk(t))) || fineAt(t, k, i)) put(t, 1);
    }
  };
  for (let k = 0; k < nBeats; k++) {
    const t0 = beatT(k);
    if (t0 > lastPick) break;
    const b = barOf(t0);
    const I = intensity(b);
    if (I < P.loud) {
      // 조용한 마디도 비우지 않음 (osu·Quaver 나이트메어급은 조용한 4초 구간도 중앙값의 0.5~0.66배):
      // 문턱 0.3배 위는 4분, 0.6배 위는 반박까지 (osu 나이트메어급 조용한 4초 0.76배 — 우리 0.56배였음)
      if (I >= P.loud * 0.3) put(t0, 1);
      if (I >= P.loud * 0.6) put((t0 + beatT(k + 1)) / 2, 1);
      continue;
    }
    const full = I >= P.full;
    const t1 = beatT(k + 1);
    const beatInBar = Math.round((t0 - (beats[0] ?? 0)) / beatSec) % 4;
    if (full && !fineBeat.has(k) && spread(k, 0) >= extraFine) {
      // 16분 소리가 없는 박: 8분 + 박마다 동시치기
      for (let i = 0; i < P.loudSub; i++) {
        const t = t0 + (i * (t1 - t0)) / P.loudSub;
        if (i === 0) put(t, headN(t));
        else if (offOk(t)) put(t, 1);
      }
    } else if (full && P.cluster && beatInBar < 2) {
      // 점프스트림: 8분마다 동시치기, 사이 안 채움
      for (let c = 0; c < P.chordFull; c++) put(t0 + (c * (t1 - t0)) / P.chordFull, 2);
      for (let i = 0; i < P.loudSub; i++) put(t0 + (i * (t1 - t0)) / P.loudSub, 1);
    } else if (full && P.cluster) {
      // 단노트 스트림: 16분 채움 + 마디 가운데 박 하나만 동시치기
      if (beatInBar === 2) put(t0, 2);
      putFine(t0, t1, P.fullSub, k);
    } else {
      const sub = full ? P.fullSub : P.loudSub;
      const chords = full ? P.chordFull : P.chordLoud;
      for (let c = 0; c < chords; c++) {
        const t = t0 + (c * (t1 - t0)) / chords;
        if (c === 0) put(t, headN(t));
        else if (offOk(t)) put(t, (!full || P.streamChord) && spread(k, c) < P.halfChord ? 2 : 1);
      }
      if (full) putFine(t0, t1, sub, k);
      else
        for (let i = 0; i < sub; i++) {
          const t = t0 + (i * (t1 - t0)) / sub;
          if (i === 0 || offOk(t)) put(t, 1);
        }
    }
    if (
      full &&
      beatInBar === 3 &&
      b % P.burstEvery === P.burstEvery - 1 &&
      (t1 - t0) / P.burstSub >= P.burstMinGap
    ) {
      // 연타 박은 연타로만: 먼저 깔린 16분·동시치기를 박 안에서 비움 — 안 비우면 16분(4등분)과 연타(6등분)가
      //  섞여 30~35ms 간격이 생김 (148 BPM에서 101ms 16분 사이에 67ms 연타 → 34ms, 한 박만 엄청 촘촘)
      //  여기서 슬롯을 지우면 패턴 고르는 순서가 밀려 곡 전체 레인이 바뀌므로, 채보를 다 만든 뒤 맨 끝에서 뺌
      for (let i = 0; i < P.burstSub; i++) put(t0 + (i * (t1 - t0)) / P.burstSub, 1, true);
    }
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
      const twoRate = Math.min(1, (ctx.thick[k] - 1) * P.chordScale + (k === 2 ? P.fineChord : 0));
      const threeRate = k === 0 ? Math.min(0.9, ctx.tri * P.chordScale) : 0;
      const byBar = new Map<number, number[]>();
      for (const t of g) {
        const b = barOf(t);
        if (!byBar.has(b)) byBar.set(b, []);
        byBar.get(b)!.push(t);
      }
      const cw = chordWeight(byBar, intensity);
      let carry2 = 0;
      let carry3 = 0;
      for (const b of [...byBar.keys()].sort((x, y) => x - y)) {
        const list = byBar.get(b)!;
        const have = list.filter((t) => slots.get(t)! >= 2).length;
        const want2 = list.length * twoRate * cw(b) + carry2;
        const want3 = list.length * threeRate * cw(b) + carry3;
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
    { ...ctx.patCtx, chords: true }
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
  // 연타 노트 자리는 밖에서 마지막에 정리 (리듬 고르기 등을 다 거친 뒤에도 연타와 붙어 있는 것만 뺌)
  ctx.burstOut?.push(...[...new Set(notes.map((n) => n.t))].filter((t) => burstKeys.has(t)));
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
  explus: 20,
};
/** 목표에서 이만큼 벗어나도 됨 */
const LEVEL_TOL = 1;
/** 박당 노트 수 상한 (내장곡 기준: 매우 어려움 2.5~3.1, 나이트메어 3.4~4.5) */
const NPB_CAP: Record<Difficulty, number> = {
  easy: 1,
  normal: 1.7,
  hard: 2.7,
  expert: 3.4,
  nightmare: 4.6,
  explus: 6,
};

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
  // 185 BPM 이상(접어서 120~240): 16분이 81ms 안쪽이라 osu·Quaver는 16분 대신 동시치기로 레벨을 냄
  //  (나이트메어·ULTIMA 16분 자리 osu 23~25% vs 우리 31~45%) → 16분 박을 덜 엶 (레벨은 그만큼 덜 나올 수 있음)
  let foldBpm = displayBpm(an);
  while (foldBpm < 120) foldBpm *= 2;
  while (foldBpm >= 240) foldBpm /= 2;
  const fastSong = foldBpm >= 185;
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
    let nm: Required<NightmareTweak> = {
      ...nmDefault(d),
      // 210 BPM 이상은 8분마다 동시치기면 동시치기 벽(줄의 70%) — 박마다 하나로 (osu·Quaver 37~45%)
      ...(foldBpm >= 210 ? { chordFull: 1 } : {}),
      // 185 BPM 이상 나이트메어: 16분(81ms 안쪽)으로 채우는 박엔 뒷박 동시치기를 안 넣음 — 넣으면 16분 점프스트림
      //  (Crimson Cadenza NIGHTMARE 174~176초: 75ms 간격에 8분마다 동시치기 → 실제 플레이에서 4초에 미스 10)
      ...(fastSong && d === "nightmare" ? { streamChord: false } : {}),
      ...(base.nightmare ?? {}),
    };
    let best: Chart | null = null;
    let bestRaw = 0;
    // 레벨이 맞으면 거기서 멈춤 (맞은 뒤에도 밀도를 올려 '같은 레벨에서 가장 빽빽한' 채보를 고르던 적이 있는데,
    // 별점은 세기 차이가 없는 평평한 채보일수록 같은 레벨에 노트가 많이 들어가서 벽 채보가 됐음 — Monarch 맛없어짐)
    // 시도 기록: 목표를 못 맞추면 아래·위로 가장 가까운 두 시도 사이를 더 잘게 나눠 봄
    const tried: { density: number; fill: number; raw: number; n: number }[] = [];
    let bestOver = false;
    const consider = (chart: Chart, raw: number, over = false) => {
      const dNew = Math.abs(raw - target);
      const dBest = Math.abs(bestRaw - target);
      // 박당 상한을 넘은 채보는 안 넘은 게 하나라도 있으면 밀려남
      if (best && over && !bestOver) return;
      // 같은 거리면 쉬운 쪽(직접 정한 레벨을 넘기지 않게), 같은 레벨이면 노트 많은 쪽
      if (
        !best ||
        (bestOver && !over) ||
        dNew < dBest ||
        (dNew === dBest &&
          (raw < bestRaw || (raw === bestRaw && chart.notes.length > best.notes.length)))
      ) {
        best = chart;
        bestRaw = raw;
        bestOver = over;
      }
    };
    for (let attempt = 0; attempt < (isNm(d) ? 20 : 13); attempt++) {
      const chart = makeAutoChart(an, d, shiftMs, { ...base, density, fill, nightmare: nm });
      // 레벨은 난이도별 최저값으로 올려 놓은 값이라, 맞춰 갈 때는 별점 그대로 잼
      const raw = Math.round(starRating(chart.notes) * 4);
      tried.push({ density, fill, raw, n: chart.notes.length });
      // 박당 노트 수 상한(자동 목표일 때): 별점은 느린 곡에서 16분을 넘는 밀도(동시치기·32분)로 채워야 나오는데
      // 그건 같은 레벨의 빠른 곡보다 훨씬 어렵게 느껴짐 (147 BPM 곡 나이트메어 16이 180 BPM Lv17보다 어려웠음)
      // → 넘으면 '너무 어려움'으로 보고 밀도를 내림 (레벨은 그만큼 낮게 나옴)
      const npb = chart.notes.length / Math.max(1, (an.duration * displayBpm(an)) / 60);
      const over = base.level === undefined && npb > NPB_CAP[d];
      consider(chart, raw, over);
      const miss = over ? Math.max(1, raw - target) : raw - target;
      if ((globalThis as { DEBUG_LV?: boolean }).DEBUG_LV)
        console.log(
          `  ${d} 시도${attempt} 밀도x${density.toFixed(2)} 채우기${fill.toFixed(1)} → Lv${raw} 노트${chart.notes.length} 박당${npb.toFixed(2)}${over ? " 초과" : ""}${isNm(d) ? ` loud${nm.loud.toFixed(2)} full${nm.full.toFixed(2)} fineS${nm.fineS.toFixed(2)} fc${nm.fineChord.toFixed(2)}` : ""}`
        );
      // 나이트메어(자동 목표)는 목표보다 높게는 안 받음 — 이미 구간 가운데라 +1이면 체감이 확 어려워짐
      const ok =
        d === "nightmare" && base.level === undefined
          ? miss <= 0 && miss >= -tol
          : Math.abs(miss) <= tol;
      if (ok) break;
      // 레벨은 밀도에 거의 비례 → 비율로 맞춰 감 (한 번에 너무 크게는 안 움직임)
      const ratio = Math.min(1.6, Math.max(0.6, target / Math.max(1, raw)));
      // 나이트메어·ULTIMA는 밀도 대신 채우기 문턱·동시치기·16분 박으로 올림 (밀도를 키우면 곡의 잔타격(하이햇 16분)까지 다 고름 —
      //  다른 손잡이를 다 쓴 뒤에도 모자라면 그때 밀도를 올림)
      const nmMaxed =
        nm.full <= 0.12 && nm.fineS <= -0.09 && nm.fineChord >= fineChordMax(d, fastSong) - 0.01;
      density = isNm(d) && !nmMaxed ? Math.min(1.3, density * ratio) : density * ratio;
      // 밀도를 올려도 곡에서 찾은 타격이 모자라면 격자 채우기로 (너무 어려우면 채우기부터 줄임)
      // 오갈수록 조금씩 (안 그러면 두 값 사이를 계속 왔다 갔다)
      const step = 0.3 / (1 + attempt * 0.6);
      // (나이트메어·ULTIMA는 채우기를 안 늘림 — 채우기가 아주 센 마디 문턱까지 끌어내려 곡 전체가 16분이 됐음)
      if (miss < 0 && canFill && !isNm(d)) fill = Math.min(1.6, fill + step);
      if (miss > 0 && fill > (isNm(d) ? (base.fill ?? 0) : 0)) fill = Math.max(0, fill - step);
      if (isNm(d)) {
        const k = (Math.sign(miss) * Math.min(3, Math.abs(miss))) / (1 + attempt * 0.25);
        // 동시치기·16분 박은 앞의 문턱을 다 쓴 뒤에 움직이므로 줄이지 않은 걸음으로
        const k2 = Math.sign(miss) * Math.min(2, Math.abs(miss));
        nm = {
          ...nm,
          full: Math.max(0.1, Math.min(1.05, nm.full + 0.1 * k)),
          loud: Math.max(0.15, Math.min(1, nm.loud + 0.08 * k)),
          burstEvery: miss > 0 ? Math.min(16, nm.burstEvery * 2) : nm.burstEvery,
          // 모자라면 16분 박을 넓힘(약한 16분 소리도 16분으로), 넘치면 좁힘
          // (0 밑이면 예전처럼 아주 센 마디는 모든 박을 16분으로)
          // 아주 센 마디를 다 넓힌 뒤에도 모자라면 동시치기를 두껍게, 그래도 모자라면 16분 박을 넓힘
          // (osu·Quaver 랭크는 16분 자리가 줄의 18~29% — 레벨을 16분으로만 올리면 40%를 넘음)
          chordScale:
            k > 0
              ? Math.max(1, nm.chordScale - 0.1 * k)
              : nm.full <= 0.22
                ? Math.min(chordMax(d, fastSong), nm.chordScale - 0.1 * k2)
                : nm.chordScale,
          // 동시치기를 다 두껍게 한 뒤엔 16분 줄을 동시치기로(16분 점프스트림), 그래도 모자라면 16분 박을 넓힘
          fineChord:
            k > 0
              ? Math.max(0, nm.fineChord - 0.05 * k)
              : nm.full <= 0.22 && nm.chordScale >= chordMax(d, fastSong) - 0.05
                ? Math.min(fineChordMax(d, fastSong), nm.fineChord - 0.05 * k2)
                : nm.fineChord,
          fineS:
            k > 0 ||
            (nm.full <= 0.22 &&
              nm.chordScale >= chordMax(d, fastSong) - 0.05 &&
              nm.fineChord >= fineChordMax(d, fastSong) - 0.01)
              ? Math.max(
                  // 아래 난이도보다 2레벨 넘게 높아질 때까지는 16분을 끝까지 열 수 있음 (난이도 사다리 유지)
                  raw < prevLevel + (fastSong ? 1 : 2) ? -0.1 : fineMin(d, fastSong),
                  Math.min(0.6, nm.fineS + 0.05 * (k > 0 ? k : k2))
                )
              : nm.fineS,
        };
      }
    }
    // 목표를 못 맞춘 채 아래(Lv-1)·위(Lv+1) 시도만 있으면 그 사이를 이등분해 가며 찾음 (밀도·채우기를 같이 보간)
    if (!isNm(d) && bestRaw !== target) {
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
    // EX 와 Lv17 이하 NIGHTMARE · ULTIMA: 아주 빠른 같은 레인 연타(잭)를 옆 레인으로 — osu · Quaver 랭크
    //  Lv15~17 채보는 같은 레인 115ms 안 연타가 노트 1000개에 0~2개(p75 8~15), Lv12~14 는 125ms 안이 0개
    //  (p75 0.5~8)인데 우리는 OVERLOAD PROTOCOL NIGHTMARE 86, ANiMA EX 16, Crimson Cadenza ULTIMA(17)는 75ms 잭까지.
    //  채보를 다 고른 뒤 그 자리만 고쳐서 나머지는 그대로
    const picked = best as Chart | null;
    const floor = d === "expert" ? JACK_FLOOR_EX : isNm(d) && bestRaw <= 17 ? JACK_FLOOR_NM : 0;
    if (picked && floor) {
      best = finishChart(spreadFastJacks(picked.notes, floor), d);
      bestRaw = best.level;
    }
    // 나이트메어: 200ms 안 같은 레인 연타(8분 잭)가 노트의 35%를 넘으면 넘는 만큼 옆 레인으로 — 실제 플레이 기록에서
    //  미스가 이 자리에 3~5배 몰렸고(미스율 3.7~5.1% vs 0.6~1.2%), osu · Quaver 160~190 BPM Lv14~17 은 중앙값 32~38%
    if (d === "nightmare" && best) {
      best = finishChart(capJacks((best as Chart).notes, 0.2, 0.35), d);
      bestRaw = best.level;
    }
    out[d] = best!;
    prevLevel = bestRaw;
  }
  return out;
}

/**
 * win 초 안 같은 레인 연타(잭)가 노트의 maxRate 를 넘지 않게: 줄 순서대로 세다가 넘는 잭 노트는 비어 있는
 * 가까운 레인(그 줄에 없고, 그 레인에도 win 안 연타가 안 생기는 곳)으로 옮김. 옮길 데가 없으면 그대로.
 */
function capJacks(src: Note[], win: number, maxRate: number): Note[] {
  const notes = src.map((n) => ({ ...n })).sort((a, b) => a.t - b.t || a.lane - b.lane);
  const last = [-Infinity, -Infinity, -Infinity, -Infinity];
  const busy = [-Infinity, -Infinity, -Infinity, -Infinity];
  let jacks = 0;
  let seen = 0;
  for (let i = 0; i < notes.length;) {
    let j = i;
    while (j < notes.length && Math.abs(notes[j].t - notes[i].t) < 1e-6) j++;
    const row = notes.slice(i, j);
    const used = new Set(row.map((n) => n.lane));
    for (const n of row) {
      seen++;
      if (n.t - last[n.lane] >= win) continue;
      if (jacks + 1 <= maxRate * seen) {
        jacks++;
        continue;
      }
      const free = [1, -1, 2, -2, 3, -3]
        .map((k) => n.lane + k)
        .filter((l) => l >= 0 && l <= 3 && !used.has(l) && n.t - last[l] >= win && busy[l] < n.t);
      if (free.length) {
        used.delete(n.lane);
        n.lane = free[0];
        used.add(n.lane);
      } else jacks++;
    }
    for (const n of row) {
      last[n.lane] = n.end ?? n.t;
      busy[n.lane] = n.end ?? -Infinity;
    }
    i = j;
  }
  return notes;
}

/** 같은 레인 연타의 최소 간격(초): NIGHTMARE · ULTIMA(Lv17 이하) / EX */
const JACK_FLOOR_NM = 0.115;
const JACK_FLOOR_EX = 0.125;

/**
 * 같은 레인에 floor 초 안으로 다시 오는 노트를 비어 있는 가까운 레인으로 옮김 (줄 순서대로).
 * 옮길 데가 없으면 동시치기 줄에선 그 노트를 빼고, 단노트 줄은 그대로 둠(리듬은 지킴).
 */
function spreadFastJacks(src: Note[], floor: number): Note[] {
  const notes = src.map((n) => ({ ...n })).sort((a, b) => a.t - b.t || a.lane - b.lane);
  const last = [-Infinity, -Infinity, -Infinity, -Infinity];
  const busy = [-Infinity, -Infinity, -Infinity, -Infinity]; // 롱노트를 누르는 중이면 끝 시각
  const out: Note[] = [];
  let prevRow = new Set<number>();
  for (let i = 0; i < notes.length;) {
    let j = i;
    while (j < notes.length && Math.abs(notes[j].t - notes[i].t) < 1e-6) j++;
    const row = notes.slice(i, j);
    const used = new Set(row.map((n) => n.lane));
    const kept: Note[] = [];
    for (const n of row) {
      if (n.t - last[n.lane] >= floor - 1e-6) {
        kept.push(n);
        continue;
      }
      const free = [1, -1, 2, -2, 3, -3]
        .map((k) => n.lane + k)
        .filter(
          (l) => l >= 0 && l <= 3 && !used.has(l) && n.t - last[l] >= floor - 1e-6 && busy[l] < n.t
        )
        .sort((a, b) => Number(prevRow.has(a)) - Number(prevRow.has(b)));
      if (free.length) {
        used.delete(n.lane);
        n.lane = free[0];
        used.add(n.lane);
        kept.push(n);
      } else if (row.length === 1) kept.push(n);
    }
    for (const n of kept) {
      last[n.lane] = n.end ?? n.t;
      busy[n.lane] = n.end ?? -Infinity;
      out.push(n);
    }
    prevRow = new Set(kept.map((n) => n.lane));
    i = j;
  }
  return out;
}
