/*
 * 오늘의 용의자 — 퍼즐 엔진 (생성기 + 솔버). 화면과 분리돼 있어 서버·테스트·워커에서 그대로 씀.
 *
 * 모든 단서는 "집합 S 안의 범인 수가 허용 목록 A 안에 있다" 한 가지 꼴로 통일한다.
 *   예) 내 이웃 중 범인 2명 → S = 이웃 칸들, A = {2}
 *       B열 범인 수는 홀수 → S = B열, A = {1, 3, 5}
 * 솔버는 이 꼴만 알면 되고, 단서 종류를 늘려도 솔버는 그대로다.
 *
 * "찍기 금지": 지금까지 밝혀진 단서로 모든 경우를 따져서 한쪽으로만 가능한 사람만 지목할 수 있다.
 * 생성기는 처음 한 명부터 이 규칙만으로 끝까지 풀리는 퍼즐만 내놓는다.
 * 난이도는 솔버가 잰 값으로 나눔: 한 번에 새로 확정되는 사람 수, 단서 하나로는 못 푸는 "조합 추론" 단계 수, 단서 종류.
 */

export type Verdict = 0 | 1; // 0 무고, 1 범인
export type Cell = -1 | Verdict;

export type ClueType =
  | "nb"
  | "otherNb"
  | "row"
  | "col"
  | "dir"
  | "job"
  | "edge"
  | "corner"
  | "xor"
  | "same"
  | "diff"
  | "parity"
  | "direct";

export interface Clue {
  /** 단서가 가리키는 사람들 (칸 번호) */
  S: number[];
  /** A[k] = 범인이 k명이면 참 */
  A: boolean[];
  /** 전체 문장 */
  text: string;
  /** 카드에 들어가는 압축 표기 [범위, 값] 예) ["내 이웃", "범인 2"] */
  short: [string, string];
  type: ClueType;
}

export const JOBS = ["경찰", "요리사", "의사", "교사", "화가"] as const;
export type Job = (typeof JOBS)[number];
/** 직업 → 얼굴 그림 파일 이름 (public/suspect/faces/*.webp) */
export const JOB_FACE: Record<Job, string> = {
  경찰: "police",
  요리사: "chef",
  의사: "doctor",
  교사: "teacher",
  화가: "painter",
};

export type Sex = "m" | "f";

export interface Person {
  name: string;
  job: Job;
  /** 얼굴 그림만 남녀로 나눔 (이름으로 정해짐 → 퍼즐 생성 난수엔 영향 없음) */
  sex: Sex;
}

/** 얼굴 그림 주소 (public/suspect/faces/<직업>-<m|f>.webp) */
export const faceOf = (p: Pick<Person, "job" | "sex">) =>
  `/suspect/faces/${JOB_FACE[p.job]}-${p.sex}.webp`;
export const ALL_FACES = JOBS.flatMap((job) =>
  (["m", "f"] as const).map((sex) => faceOf({ job, sex }))
);

export type TierId = "intro" | "easy" | "normal" | "hard" | "hell";

export interface TierSpec {
  id: TierId;
  label: string;
  /** 한 줄 설명 (난이도 고르는 화면) */
  desc: string;
  cols: number;
  rows: number;
  /** 범인 수 범위 */
  crim: [number, number];
  /** 한 번에 새로 확정되는 사람 수 목표 (작을수록 어려움) */
  perRound: number;
  /** 단서 하나만 보고는 못 푸는 "조합 추론" 단계 수 범위 */
  combo: [number, number];
  /** 단서 종류별 가중치 (없는 종류는 안 나옴) */
  weights: Partial<Record<ClueType, number>>;
  /** 일일 랭킹이 있는 난이도인지 (입문은 연습용) */
  ranked: boolean;
}

export const TIERS: Record<TierId, TierSpec> = {
  intro: {
    id: "intro",
    label: "입문",
    desc: "12명 · 단서 하나씩만 읽어도 풀려요",
    cols: 3,
    rows: 4,
    crim: [3, 5],
    perRound: 2,
    combo: [0, 0],
    weights: { nb: 30, row: 12, col: 12, same: 6, diff: 6, direct: 4 },
    ranked: false,
  },
  easy: {
    id: "easy",
    label: "쉬움",
    desc: "20명 · 단서 하나씩 차근차근",
    cols: 4,
    rows: 5,
    crim: [6, 9],
    perRound: 3,
    combo: [0, 0],
    weights: {
      nb: 28,
      row: 10,
      col: 10,
      dir: 10,
      job: 6,
      edge: 3,
      corner: 3,
      same: 6,
      diff: 6,
      direct: 2,
    },
    ranked: true,
  },
  normal: {
    id: "normal",
    label: "보통",
    desc: "단서 두 개를 엮어야 하는 순간이 몇 번",
    cols: 4,
    rows: 5,
    crim: [7, 10],
    perRound: 2,
    combo: [2, 4],
    weights: {
      nb: 24,
      otherNb: 6,
      row: 9,
      col: 9,
      dir: 13,
      job: 8,
      edge: 4,
      corner: 3,
      xor: 7,
      same: 5,
      diff: 5,
      parity: 4,
      direct: 1,
    },
    ranked: true,
  },
  hard: {
    id: "hard",
    label: "어려움",
    desc: "여러 단서를 동시에 굴려야 풀려요",
    cols: 4,
    rows: 5,
    crim: [7, 11],
    perRound: 1.5,
    combo: [5, 9],
    weights: {
      nb: 18,
      otherNb: 10,
      row: 8,
      col: 8,
      dir: 14,
      job: 10,
      edge: 5,
      corner: 3,
      xor: 9,
      same: 5,
      diff: 5,
      parity: 8,
    },
    ranked: true,
  },
  hell: {
    id: "hell",
    label: "지옥",
    desc: "거의 매 수가 조합 추론 · 홀짝 단서 多",
    cols: 4,
    rows: 5,
    crim: [8, 12],
    perRound: 1,
    combo: [10, 99],
    weights: {
      nb: 12,
      otherNb: 12,
      row: 6,
      col: 6,
      dir: 14,
      job: 12,
      edge: 5,
      corner: 3,
      xor: 10,
      same: 4,
      diff: 4,
      parity: 14,
    },
    ranked: true,
  },
};
export const RANKED_TIERS: TierId[] = ["easy", "normal", "hard", "hell"];
export const isTier = (v: string): v is TierId => Object.hasOwn(TIERS, v);

const NAMES = [
  "민지",
  "준호",
  "서연",
  "도윤",
  "하은",
  "지훈",
  "수아",
  "현우",
  "예린",
  "태민",
  "지아",
  "성민",
  "유나",
  "건우",
  "채원",
  "동현",
  "소율",
  "재희",
  "나연",
  "우진",
  "다은",
  "시우",
  "하린",
  "정우",
  "서윤",
  "은호",
  "가윤",
  "민재",
  "윤서",
  "태오",
  "아린",
  "도하",
  "세아",
  "주원",
  "라희",
  "이준",
  "보민",
  "로운",
  "시아",
  "한결",
];
/** 여자 이름 (나머지는 남자) — 얼굴 그림만 고르는 데 씀 */
const FEMALE = new Set([
  "민지",
  "서연",
  "하은",
  "수아",
  "예린",
  "지아",
  "유나",
  "채원",
  "소율",
  "재희",
  "나연",
  "다은",
  "하린",
  "서윤",
  "가윤",
  "윤서",
  "아린",
  "세아",
  "라희",
  "시아",
]);
const COLN = "ABCDEFGH";

/** 받침이 있으면 a, 없으면 b */
export const josa = (w: string, a: string, b: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c % 28 ? a : b;
};

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 7;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(a: T[], r: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** 판 모양 (칸 번호 ↔ 좌표, 이웃 등) */
export class Board {
  readonly cols: number;
  readonly rows: number;
  readonly N: number;
  readonly all: number[];
  readonly edge: number[];
  readonly corners: number[];
  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.N = cols * rows;
    this.all = range(this.N);
    this.edge = this.all.filter((i) => {
      const [r, c] = this.rc(i);
      return r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
    });
    this.corners = [0, cols - 1, this.N - cols, this.N - 1];
  }
  rc(i: number): [number, number] {
    return [Math.floor(i / this.cols), i % this.cols];
  }
  idx(r: number, c: number) {
    return r * this.cols + c;
  }
  /** 칸 이름 (A1, B3 …) */
  code(i: number) {
    const [r, c] = this.rc(i);
    return COLN[c] + (r + 1);
  }
  colName(c: number) {
    return COLN[c];
  }
  neighbors(i: number): number[] {
    const [r0, c0] = this.rc(i);
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const r = r0 + dr;
        const c = c0 + dc;
        if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) out.push(this.idx(r, c));
      }
    return out;
  }
  row(r: number) {
    return range(this.cols).map((c) => this.idx(r, c));
  }
  col(c: number) {
    return range(this.rows).map((r) => this.idx(r, c));
  }
}

// ───────────────────────── 솔버 ─────────────────────────

function feasible(c: Clue, x: ArrayLike<number>): boolean {
  let k = 0;
  let u = 0;
  for (const i of c.S) {
    const v = x[i];
    if (v === 1) k++;
    else if (v < 0) u++;
  }
  for (let t = k; t <= k + u; t++) if (c.A[t]) return true;
  return false;
}

function byVarOf(N: number, cons: Clue[]): number[][] {
  const by: number[][] = Array.from({ length: N }, () => []);
  cons.forEach((c, i) => c.S.forEach((v) => by[v].push(i)));
  return by;
}

/** 단서를 모두 만족하는 배정 하나 (없으면 null) */
function solve(x: ArrayLike<number>, cons: Clue[], by: number[][]): Int8Array | null {
  const y = Int8Array.from(x);
  for (const c of cons) if (!feasible(c, y)) return null;
  const order: number[] = [];
  for (let v = 0; v < y.length; v++) if (y[v] < 0 && by[v].length) order.push(v);
  order.sort((a, b) => by[b].length - by[a].length);
  const rec = (p: number): boolean => {
    if (p === order.length) return true;
    const v = order[p];
    for (let val = 1; val >= 0; val--) {
      y[v] = val;
      let ok = true;
      for (const ci of by[v])
        if (!feasible(cons[ci], y)) {
          ok = false;
          break;
        }
      if (ok && rec(p + 1)) return true;
    }
    y[v] = -1;
    return false;
  };
  return rec(0) ? y : null;
}

export interface Forced {
  i: number;
  v: Verdict;
}

/** 지금 정보로 확정되는 사람 전부 */
export function forcedAll(x: ArrayLike<number>, cons: Clue[]): Forced[] {
  const by = byVarOf(x.length, cons);
  const m = solve(x, cons, by);
  if (!m) return [];
  const out: Forced[] = [];
  for (let i = 0; i < x.length; i++) {
    if (x[i] >= 0 || !by[i].length) continue;
    const y = Int8Array.from(x);
    y[i] = 1 - m[i];
    if (!solve(y, cons, by)) out.push({ i, v: m[i] as Verdict });
  }
  return out;
}

/** 한 사람이 확정되는지: 0/1 = 확정된 쪽, -1 = 아직 근거 부족 */
export function forcedOf(x: ArrayLike<number>, cons: Clue[], i: number): Cell {
  const by = byVarOf(x.length, cons);
  if (!by[i].length) return -1;
  const a = Int8Array.from(x);
  a[i] = 1;
  const c1 = !!solve(a, cons, by);
  a[i] = 0;
  const c0 = !!solve(a, cons, by);
  return c1 && !c0 ? 1 : c0 && !c1 ? 0 : -1;
}

export interface Step {
  /** 단서를 말한 사람 (칸 번호) */
  speaker: number;
  i: number;
  v: Verdict;
}

/** 단서 하나(와 이미 밝혀진 정체)만으로 확정되는 사람들 — 힌트 · 튜토리얼 설명용 */
export function singleClueSteps(
  x: ArrayLike<number>,
  clues: { speaker: number; clue: Clue }[]
): Step[] {
  const out: Step[] = [];
  for (const { speaker, clue } of clues)
    for (const i of clue.S) {
      if (x[i] >= 0) continue;
      const f = forcedOf(x, [clue], i);
      if (f >= 0) out.push({ speaker, i, v: f as Verdict });
    }
  return out;
}

/** 단서 하나만으로 확정되는 이유를 사람 말로 (튜토리얼 · 힌트) */
export function explain(
  P: Person[],
  x: ArrayLike<number>,
  clue: Clue,
  i: number,
  v: Verdict
): string {
  const unknown = clue.S.filter((j) => x[j] < 0);
  const crimKnown = clue.S.filter((j) => x[j] === 1).length;
  const allowed = clue.A.map((ok, k) => (ok ? k : -1)).filter((k) => k >= 0);
  const who = P[i].name;
  const wh = `${who}${josa(who, "은", "는")}`;
  const ve = v ? "범인이에요" : "무고예요";
  const vy = v ? "범인이어야" : "무고여야";
  const other = clue.S.find((j) => j !== i);
  const otherSide = other !== undefined && x[other] >= 0 ? (x[other] ? "범인으" : "무고") : "";
  if (clue.type === "direct") return `단서가 ${who}의 정체를 직접 말해 주고 있어요. ${wh} ${ve}.`;
  if (clue.type === "same")
    return `두 사람은 같은 편인데 한 명이 ${otherSide}로 밝혀졌어요. 그러니 ${wh} ${ve}.`;
  if (clue.type === "diff" || clue.type === "xor")
    return `두 사람 중 범인은 딱 한 명인데 한 명이 ${otherSide}로 밝혀졌어요. 그러니 ${wh} ${ve}.`;
  if (clue.type === "parity")
    return `이 줄에서 아직 모르는 사람은 ${who} 한 명뿐이에요. 홀짝을 맞추려면 ${wh} ${vy} 해요.`;
  if (allowed.length === 1) {
    // 단서가 "무고한 사람 n명"으로 말했으면 무고 기준으로 설명
    const inn = clue.short[1].startsWith("무고");
    const side = inn ? "무고한 사람" : "범인";
    const total = inn ? clue.S.length - allowed[0] : allowed[0];
    const knownSide = inn ? clue.S.filter((j) => x[j] === 0).length : crimKnown;
    const need = total - knownSide;
    const rest =
      unknown.length === 1
        ? `남은 ${wh}`
        : `아직 모르는 ${unknown.length}명은 모두 ${v ? "범인" : "무고"}이고, ${wh}`;
    if (need === 0)
      return knownSide
        ? `이 단서의 ${side} ${total}명은 이미 다 밝혀졌어요. ${rest} ${inn ? "범인이에요" : "무고예요"}.`
        : `이 단서가 가리키는 사람 중엔 ${side}${josa(side, "이", "가")} 없어요. 그러니 ${wh} ${ve}.`;
    if (need === unknown.length)
      return unknown.length === 1
        ? `${side} ${total}명 중 ${knownSide}명이 밝혀졌고, 아직 모르는 사람은 ${who} 한 명뿐이에요. 그러니 ${wh} ${ve}.`
        : `${side}${josa(side, "이", "가")} ${need}명 더 있어야 하는데 아직 모르는 사람이 딱 ${unknown.length}명이에요. 그러니 모두 ${inn ? "무고" : "범인"} — ${wh} ${ve}.`;
  }
  return `이 단서의 숫자를 맞추는 방법이 하나뿐이라 ${wh} ${ve}.`;
}

// ───────────────────────── 단서 만들기 ─────────────────────────

function exact(n: number, k: number) {
  const A = new Array<boolean>(n + 1).fill(false);
  A[k] = true;
  return A;
}
const parityA = (n: number, odd: boolean) =>
  Array.from({ length: n + 1 }, (_, t) => (t % 2 === 1) === odd);
const countIn = (S: number[], truth: ArrayLike<number>) => S.reduce((s, i) => s + truth[i], 0);
const sig = (c: Clue) => [...c.S].sort((a, b) => a - b).join(",") + "|" + c.A.map(Number).join("");

function pickType(w: Partial<Record<ClueType, number>>, r: () => number): ClueType {
  const e = Object.entries(w) as [ClueType, number][];
  let p = r() * e.reduce((s, [, n]) => s + n, 0);
  for (const [t, n] of e) if ((p -= n) <= 0) return t;
  return e[0][0];
}

function makeClue(
  b: Board,
  me: number,
  P: Person[],
  truth: ArrayLike<number>,
  r: () => number,
  w: TierSpec["weights"],
  depth = 0
): Clue {
  const name = (i: number) => P[i].name;
  const inn = r() < 0.35; // 무고한 사람 수로 말할지
  const count = (S: number[], scope: string, sscope: string, t: ClueType): Clue => {
    const k = countIn(S, truth);
    const kk = inn ? S.length - k : k;
    const whoW = inn ? "무고한 사람" : "범인";
    return {
      S,
      A: exact(S.length, k),
      text: `${scope} ${whoW}${josa(whoW, "은", "는")} ${kk === 0 ? "한 명도 없어" : `${kk}명이야`}`,
      short: [sscope, `${inn ? "무고" : "범인"} ${kk}`],
      type: t,
    };
  };
  const retry = () =>
    depth < 20
      ? makeClue(b, me, P, truth, r, w, depth + 1)
      : count(b.neighbors(me), "내 이웃 중", "내 이웃", "nb");
  const other = () => {
    const o = Math.floor(r() * (b.N - 1));
    return o >= me ? o + 1 : o;
  };
  switch (pickType(w, r)) {
    case "nb":
      return count(b.neighbors(me), "내 이웃 중", "내 이웃", "nb");
    case "otherNb": {
      const o = other();
      return count(b.neighbors(o), `${name(o)}의 이웃 중`, `${name(o)} 이웃`, "otherNb");
    }
    case "row": {
      const row = Math.floor(r() * b.rows);
      return count(b.row(row), `${row + 1}행에서`, `${row + 1}행`, "row");
    }
    case "col": {
      const col = Math.floor(r() * b.cols);
      return count(b.col(col), `${b.colName(col)}열에서`, `${b.colName(col)}열`, "col");
    }
    case "dir": {
      const t = Math.floor(r() * b.N);
      const [tr, tc] = b.rc(t);
      const d = Math.floor(r() * 4);
      const S =
        d === 0
          ? range(tr).map((rr) => b.idx(rr, tc))
          : d === 1
            ? range(b.rows - 1 - tr).map((q) => b.idx(tr + 1 + q, tc))
            : d === 2
              ? range(tc).map((c) => b.idx(tr, c))
              : range(b.cols - 1 - tc).map((q) => b.idx(tr, tc + 1 + q));
      if (S.length < 2) return retry();
      const word = ["위쪽", "아래쪽", "왼쪽", "오른쪽"][d];
      // 문장은 짧게 (폰에서도 안내판 한 줄에 들어가게)
      const subj = t === me ? "내" : name(t);
      return count(S, `${subj} ${word}에서`, `${t === me ? "내" : name(t)} ${word}`, "dir");
    }
    case "job": {
      const jobs = [...new Set(P.map((p) => p.job))];
      const j = jobs[Math.floor(r() * jobs.length)];
      return count(
        b.all.filter((i) => P[i].job === j),
        `${j} 중`,
        `${j}들`,
        "job"
      );
    }
    case "edge":
      return count([...b.edge], "테두리에서", "테두리", "edge");
    case "corner":
      return count([...b.corners], "네 귀퉁이에서", "네 귀퉁이", "corner");
    case "xor":
    case "same":
    case "diff": {
      const a = other();
      const c = other();
      if (a === c) return retry();
      const sameSide = truth[a] === truth[c];
      const pair = `${name(a)}·${name(c)}`;
      const and = `${name(a)}${josa(name(a), "과", "와")} ${name(c)}`;
      if (!sameSide && r() < 0.5)
        return {
          S: [a, c],
          A: [false, true, false],
          text: `${and} 중 범인은 딱 한 명이야`,
          short: [pair, "범인 1"],
          type: "xor",
        };
      if (sameSide)
        return {
          S: [a, c],
          A: [true, false, true],
          text: `${and}${josa(name(c), "은", "는")} 같은 편이야`,
          short: [pair, "같은 편"],
          type: "same",
        };
      return {
        S: [a, c],
        A: [false, true, false],
        text: `${and}${josa(name(c), "은", "는")} 서로 다른 편이야`,
        short: [pair, "다른 편"],
        type: "diff",
      };
    }
    case "parity": {
      const isRow = r() < 0.5;
      const n = Math.floor(r() * (isRow ? b.rows : b.cols));
      const S = isRow ? b.row(n) : b.col(n);
      const odd = countIn(S, truth) % 2 === 1;
      const lab = isRow ? `${n + 1}행` : `${b.colName(n)}열`;
      return {
        S,
        A: parityA(S.length, odd),
        text: `${lab}의 범인 수는 ${odd ? "홀수" : "짝수"}야`,
        short: [lab, `범인 ${odd ? "홀수" : "짝수"}`],
        type: "parity",
      };
    }
    case "direct": {
      const z = other();
      return {
        S: [z],
        A: [!truth[z], !!truth[z]],
        text: `${name(z)}${josa(name(z), "은", "는")} ${truth[z] ? "범인이야" : "범인이 아니야"}`,
        short: [name(z), truth[z] ? "범인" : "무고"],
        type: "direct",
      };
    }
  }
}

// ───────────────────────── 생성 ─────────────────────────

export interface Puzzle {
  tier: TierId;
  seed: number;
  cols: number;
  rows: number;
  people: Person[];
  truth: Verdict[];
  /** 사람마다 하나씩 (정체가 밝혀지면 보임) */
  clues: Clue[];
  /** 처음부터 밝혀진 사람 */
  start: number;
  /** 단계마다 새로 확정되는 사람 수 */
  rounds: number[];
  /** 단서 하나로는 못 푸는 단계 수 */
  combos: number;
  crimCount: number;
}

/** 시드와 난이도로 퍼즐 생성. 같은 시드면 어디서든 같은 퍼즐 (오늘의 사건) */
export function generate(seed: number, tierId: TierId): Puzzle {
  const T = TIERS[tierId];
  const r = rng(seed);
  const b = new Board(T.cols, T.rows);
  const N = b.N;
  const jobCount = N >= 20 ? 5 : 4;
  let best: Puzzle | null = null;
  let bestGap = Infinity;
  for (let attempt = 0; attempt < 300; attempt++) {
    const names = shuffle([...NAMES], r).slice(0, N);
    const jobs = shuffle(
      range(N).map((i) => JOBS[i % jobCount]),
      r
    );
    const P: Person[] = range(N).map((i) => ({
      name: names[i],
      job: jobs[i],
      sex: FEMALE.has(names[i]) ? "f" : "m",
    }));
    const nCrim = T.crim[0] + Math.floor(r() * (T.crim[1] - T.crim[0] + 1));
    const truth = new Int8Array(N);
    shuffle([...b.all], r)
      .slice(0, nCrim)
      .forEach((i) => (truth[i] = 1));
    const innocents = b.all.filter((i) => !truth[i]);
    const start = innocents[Math.floor(r() * innocents.length)];
    const clue: Clue[] = new Array<Clue>(N);
    const x = new Int8Array(N).fill(-1);
    x[start] = 0;
    let cons: Clue[] = [];
    let batch = [start];
    const rounds: number[] = [];
    let combos = 0;
    let ok = true;
    for (;;) {
      const anyUnk = x.some((v) => v < 0);
      let pick: { bc: Clue[]; f: Forced[]; combo: boolean; score: number } | null = null;
      for (let tries = 0; tries < 50; tries++) {
        const seen = new Set(cons.map(sig));
        const bc = batch.map((me) => {
          let c: Clue;
          let g = 0;
          do c = makeClue(b, me, P, truth, r, T.weights);
          while (((anyUnk && !c.S.some((i) => x[i] < 0)) || seen.has(sig(c))) && ++g < 40);
          seen.add(sig(c));
          return c;
        });
        if (!anyUnk) {
          pick = { bc, f: [], combo: false, score: 0 };
          break;
        }
        const all = cons.concat(bc);
        const f = forcedAll(x, all);
        if (!f.length) continue;
        // 이번 단계가 단서 하나만으로 풀리는지 (아니면 조합 추론)
        const combo = !singleClueSteps(
          x,
          all.map((c) => ({ speaker: -1, clue: c }))
        ).length;
        let score = Math.abs(f.length - T.perRound);
        if (T.combo[1] === 0 && combo) score += 100; // 쉬운 난이도: 조합 추론 금지
        if (combos >= T.combo[1] && combo) score += 100;
        if (combos < T.combo[1] && T.combo[0] > 0 && !combo) score += 1.5;
        if (!pick || score < pick.score) pick = { bc, f, combo, score };
        if (score < 0.6) break;
      }
      if (!pick || pick.score >= 100) {
        ok = false;
        break;
      }
      const chosen = pick;
      batch.forEach((me, q) => (clue[me] = chosen.bc[q]));
      cons = cons.concat(chosen.bc);
      if (!chosen.f.length) break;
      rounds.push(chosen.f.length);
      if (chosen.combo) combos++;
      chosen.f.forEach((o) => (x[o.i] = o.v));
      batch = chosen.f.map((o) => o.i);
    }
    if (!ok || x.some((v) => v < 0)) continue;
    const puzzle: Puzzle = {
      tier: tierId,
      seed,
      cols: T.cols,
      rows: T.rows,
      people: P,
      truth: Array.from(truth) as Verdict[],
      clues: clue,
      start,
      rounds,
      combos,
      crimCount: nCrim,
    };
    const gap =
      combos < T.combo[0] ? T.combo[0] - combos : combos > T.combo[1] ? combos - T.combo[1] : 0;
    if (gap === 0) return puzzle;
    if (gap < bestGap) {
      bestGap = gap;
      best = puzzle;
    }
  }
  if (!best) throw new Error("퍼즐을 만들지 못했어요");
  return best;
}

// ───────────────────────── 오늘의 사건 · 기록 ─────────────────────────

/** 오늘의 사건 시드 (KST 날짜 + 난이도) — 같은 날 같은 난이도는 누구나 같은 퍼즐 */
export function dailySeed(day: string, tier: TierId): number {
  let h = 2166136261;
  for (const ch of `${day}:${tier}:suspects-v1`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** KST 기준 날짜 "YYYYMMDD" (offsetDays: -1 = 어제) */
export function kstDay(now = Date.now(), offsetDays = 0): string {
  const d = new Date(now + 9 * 3600e3 + offsetDays * 864e5);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 사건 번호 (#1 = 2026-10-31, 처음 연 날) */
export function caseNo(day: string): number {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8));
  return Math.floor((t - Date.UTC(2026, 9, 31)) / 864e5) + 1;
}

/** "10월 31일" */
export const dayLabel = (day: string) => `${+day.slice(4, 6)}월 ${+day.slice(6, 8)}일`;

/** 기록 점수 (초): 걸린 시간 + 실수 30초 + 힌트 60초. 작을수록 좋음 */
export const PENALTY = { miss: 30, hint: 60 } as const;
export const scoreOf = (time: number, miss: number, hint: number) =>
  Math.round((time + miss * PENALTY.miss + hint * PENALTY.hint) * 10) / 10;

/** 랭킹 칸 이름 "YYYYMMDD_tier" */
export const caseKey = (day: string, tier: TierId) => `${day}_${tier}`;
export const CASE_RE = /^(\d{8})_(easy|normal|hard|hell)$/;
