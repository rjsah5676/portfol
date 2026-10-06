/*
 * 오목 규칙 엔진 (15×15 또는 19×19, 순수 함수 + 작은 게임 클래스)
 *
 * 좌석 이름은 방 시스템(boardRooms) 기준: w = 흑(선수), b = 백.
 * 판은 Int8Array(N*N), 0 = 빈칸, 1 = 흑, 2 = 백. 인덱스 = y * N + x (y=0이 맨 위).
 * 수 표기는 "h8" (열 a~o(19줄은 a~s), 줄 1~N, 1이 맨 아래).
 * 판 크기(N)는 모듈 전체가 같이 씀 — 판을 만들 때(Omok 생성·AI 계산) setBoardN으로 맞춤.
 * 한 화면엔 판이 하나라 괜찮음.
 *
 * 규칙
 *  - renju(렌주·국제룰): 첫 수는 천원(가운데). 흑만 금수 — 3-3, 4-4, 장목(6목 이상).
 *    흑은 정확히 5목, 백은 5목 이상(장목 포함)이면 승리.
 *  - normal(일반룰): 흑·백 모두 3-3 금지(4-4는 허용). 양쪽 다 정확히 5목만 승리, 장목은 무효.
 *  - free(자유룰): 금수 없음, 5목 이상이면 승리.
 *  금수 자리는 아예 못 두게 막음. 단 5목이 완성되는 수는 금수 모양이어도 둘 수 있음(5목 우선).
 *  "삼"은 금수가 아닌 자리에 한 수 더 둬서 열린 4(양쪽이 다 5가 되는 4)를 만들 수 있는 모양만 침.
 *  → 거짓 삼(열린 4를 만들 자리가 금수뿐)은 삼이 아니라서 재귀로 판정.
 */

export type BoardN = 15 | 19;
export const BOARD_NS: { v: BoardN; label: string }[] = [
  { v: 15, label: "15줄" },
  { v: 19, label: "19줄" },
];
export const MAX_N = 19;
export const MAX_SIZE = MAX_N * MAX_N;
export let N: BoardN = 15;
export let SIZE = N * N;
export const FILES = "abcdefghijklmnopqrs";
export let CENTER = 7 * N + 7;
export const isBoardN = (n: number): n is BoardN => n === 15 || n === 19;
/** 판 크기 바꾸기 (규칙 판정·AI가 모두 이 값을 씀) */
export function setBoardN(n: number) {
  const v: BoardN = isBoardN(n) ? n : 15;
  if (v === N) return;
  N = v;
  SIZE = v * v;
  CENTER = ((v - 1) / 2) * v + (v - 1) / 2;
}

export type Color = "w" | "b";
export type Rule = "renju" | "normal" | "free";
export type Stone = 1 | 2;
export const BLACK: Stone = 1;
export const WHITE: Stone = 2;

export const RULES: { v: Rule; label: string; desc: string }[] = [
  { v: "renju", label: "렌주룰", desc: "흑만 3-3·4-4·장목 금지, 첫 수 천원" },
  { v: "normal", label: "일반룰", desc: "흑·백 모두 3-3 금지, 장목 무효" },
  { v: "free", label: "자유룰", desc: "금수 없음, 5목 이상 승리" },
];
export const RULE_LABEL: Record<Rule, string> = {
  renju: "렌주룰",
  normal: "일반룰",
  free: "자유룰",
};
export const isRule = (v: string): v is Rule => v === "renju" || v === "normal" || v === "free";

export const stoneOf = (c: Color): Stone => (c === "w" ? BLACK : WHITE);
export const colorOfStone = (s: number): Color => (s === BLACK ? "w" : "b");
export const otherStone = (s: Stone): Stone => (s === BLACK ? WHITE : BLACK);

export function sqName(i: number) {
  return `${FILES[i % N]}${N - Math.floor(i / N)}`;
}
export function parseSq(s: string): number {
  const x = FILES.indexOf(s[0]);
  const rs = s.slice(1);
  const r = Number(rs);
  if (x < 0 || !Number.isInteger(r) || r < 1 || r > N || String(r) !== rs) return -1;
  return (N - r) * N + x;
}

// 가로, 세로, ↘, ↗
export const DX = [1, 0, 1, 1];
export const DY = [0, 1, 1, -1];

/** 이 돌 색이 "정확히 5목"이어야 이기는지 (장목 무효) */
export const exactFive = (rule: Rule, s: Stone) =>
  rule === "normal" || (rule === "renju" && s === BLACK);

/** 이 돌 색에 금수가 있는지 */
export const hasForbidden = (rule: Rule, s: Stone) =>
  rule === "normal" || (rule === "renju" && s === BLACK);

/** (x,y)에 s가 있다고 치고 d 방향 연속 개수 */
function run(bd: Int8Array, x: number, y: number, d: number, s: number): number {
  let n = 1;
  const dx = DX[d],
    dy = DY[d];
  for (let k = 1; ; k++) {
    const xx = x + dx * k,
      yy = y + dy * k;
    if (xx < 0 || yy < 0 || xx >= N || yy >= N || bd[yy * N + xx] !== s) break;
    n++;
  }
  for (let k = 1; ; k++) {
    const xx = x - dx * k,
      yy = y - dy * k;
    if (xx < 0 || yy < 0 || xx >= N || yy >= N || bd[yy * N + xx] !== s) break;
    n++;
  }
  return n;
}

/** i에 s를 두면 5목이 되나 (i는 비어 있어도 됨) */
export function makesFive(bd: Int8Array, i: number, s: Stone, rule: Rule): boolean {
  const x = i % N,
    y = (i / N) | 0;
  const ex = exactFive(rule, s);
  for (let d = 0; d < 4; d++) {
    const n = run(bd, x, y, d, s);
    if (ex ? n === 5 : n >= 5) return true;
  }
  return false;
}

/** 5목이 된 줄 (승리 표시용) */
export function fiveLine(bd: Int8Array, i: number, s: Stone, rule: Rule): number[] {
  const x = i % N,
    y = (i / N) | 0;
  const ex = exactFive(rule, s);
  for (let d = 0; d < 4; d++) {
    const n = run(bd, x, y, d, s);
    if (!(ex ? n === 5 : n >= 5)) continue;
    const line = [i];
    for (const sign of [1, -1]) {
      for (let k = 1; ; k++) {
        const xx = x + DX[d] * k * sign,
          yy = y + DY[d] * k * sign;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N || bd[yy * N + xx] !== s) break;
        line.push(yy * N + xx);
      }
    }
    return line;
  }
  return [];
}

/**
 * i(이미 s가 놓인 상태)를 포함해 d 방향으로 한 수 더 두면 5목이 되는 빈 자리들 (i 기준 거리 k).
 * 2개이고 거리 5면 열린 4(.XXXX.), 그 외 2개면 한 줄 4-4(X.XXX.X 같은 모양).
 */
function completions(bd: Int8Array, i: number, d: number, s: Stone, ex: boolean): number[] {
  const x = i % N,
    y = (i / N) | 0;
  const out: number[] = [];
  for (let k = -4; k <= 4; k++) {
    if (!k) continue;
    const xx = x + DX[d] * k,
      yy = y + DY[d] * k;
    if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
    const q = yy * N + xx;
    if (bd[q] !== 0) continue;
    // i와 q 사이가 전부 s여야 같은 줄의 5목
    let between = true;
    const step = k > 0 ? 1 : -1;
    for (let j = step; j !== k; j += step) {
      if (bd[(y + DY[d] * j) * N + (x + DX[d] * j)] !== s) {
        between = false;
        break;
      }
    }
    if (!between) continue;
    const n = run(bd, xx, yy, d, s);
    if (ex ? n === 5 : n >= 5) out.push(k);
  }
  return out;
}

function fourCount(bd: Int8Array, i: number, d: number, s: Stone, ex: boolean): number {
  const ks = completions(bd, i, d, s, ex);
  if (ks.length <= 1) return ks.length;
  return ks.length === 2 && Math.abs(ks[0] - ks[1]) === 5 ? 1 : 2;
}

function isStraightFour(bd: Int8Array, i: number, d: number, s: Stone, ex: boolean): boolean {
  const ks = completions(bd, i, d, s, ex);
  return ks.length === 2 && Math.abs(ks[0] - ks[1]) === 5;
}

/** i(s가 놓인 상태)가 d 방향으로 "삼"인가 — 금수 아닌 자리 한 수로 열린 4를 만들 수 있어야 함 */
function isThree(
  bd: Int8Array,
  i: number,
  d: number,
  s: Stone,
  rule: Rule,
  depth: number
): boolean {
  const ex = exactFive(rule, s);
  const x = i % N,
    y = (i / N) | 0;
  for (let k = -4; k <= 4; k++) {
    if (!k) continue;
    const xx = x + DX[d] * k,
      yy = y + DY[d] * k;
    if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
    const q = yy * N + xx;
    if (bd[q] !== 0) continue;
    bd[q] = s;
    const straight = isStraightFour(bd, i, d, s, ex);
    bd[q] = 0;
    if (straight && (depth > 3 || !forbidden(bd, q, s, rule, depth + 1))) return true;
  }
  return false;
}

export type Forbid = "33" | "44" | "6";
export const FORBID_LABEL: Record<Forbid, string> = { "33": "3-3", "44": "4-4", "6": "장목" };

/** 빈 자리 i에 s를 두는 게 금수인가 (금수 종류, 아니면 null) */
export function forbidden(
  bd: Int8Array,
  i: number,
  s: Stone,
  rule: Rule,
  depth = 0
): Forbid | null {
  if (bd[i] !== 0 || !hasForbidden(rule, s)) return null;
  const x = i % N,
    y = (i / N) | 0;

  // 빠른 거르기: 주변(±4)에 내 돌이 2개 이상인 방향이 2개 미만이고 한 줄 4-4·장목 가능성도 없으면 통과
  let dirs2 = 0;
  let dense = false;
  for (let d = 0; d < 4; d++) {
    let c = 0;
    for (let k = -4; k <= 4; k++) {
      if (!k) continue;
      const xx = x + DX[d] * k,
        yy = y + DY[d] * k;
      if (xx >= 0 && yy >= 0 && xx < N && yy < N && bd[yy * N + xx] === s) c++;
    }
    if (c >= 2) dirs2++;
    if (c >= 4) dense = true;
  }
  if (dirs2 < 2 && !dense) return null;

  const ex = exactFive(rule, s);
  bd[i] = s;
  try {
    // 5목이 되면 금수가 아님
    for (let d = 0; d < 4; d++) {
      const n = run(bd, x, y, d, s);
      if (ex ? n === 5 : n >= 5) return null;
    }
    if (rule === "renju") for (let d = 0; d < 4; d++) if (run(bd, x, y, d, s) >= 6) return "6";
    // 4가 생긴 방향은 삼으로 세지 않음 (4-3은 허용)
    const fourDirs: boolean[] = [];
    let fours = 0;
    for (let d = 0; d < 4; d++) {
      const f = fourCount(bd, i, d, s, ex);
      fourDirs[d] = f > 0;
      fours += f;
    }
    if (rule === "renju" && fours >= 2) return "44";
    let threes = 0;
    for (let d = 0; d < 4; d++) {
      if (fourDirs[d]) continue;
      if (isThree(bd, i, d, s, rule, depth)) threes++;
      if (threes >= 2) return "33";
    }
    return null;
  } finally {
    bd[i] = 0;
  }
}

/** 이미 놓인 돌 i 때문에 그 돌 색이 다음 수에 5목을 만들 수 있게 됐나 (4·열린4) */
export function makesFourAt(bd: Int8Array, i: number, rule: Rule): boolean {
  const s = bd[i] as Stone;
  if (!s) return false;
  const ex = exactFive(rule, s);
  for (let d = 0; d < 4; d++) if (completions(bd, i, d, s, ex).length) return true;
  return false;
}

/** 이미 놓인 돌 i가 만든 위협: 4(다음 수 5목) 또는 열린3 (대사·안내용) */
export function threatAt(bd: Int8Array, i: number, rule: Rule): "four" | "three" | null {
  const s = bd[i] as Stone;
  if (!s) return null;
  if (makesFourAt(bd, i, rule)) return "four";
  for (let d = 0; d < 4; d++) if (isThree(bd, i, d, s, rule, 0)) return "three";
  return null;
}

export type EndReason = "five" | "full";
export interface GameEnd {
  result: "1-0" | "0-1" | "1/2-1/2";
  reason: EndReason;
}

/** 수 하나가 왜 안 되는지 (되면 null) */
export function illegalReason(bd: Int8Array, ply: number, i: number, rule: Rule): string | null {
  if (i < 0 || i >= SIZE) return "잘못된 자리입니다.";
  if (bd[i] !== 0) return "이미 돌이 있는 자리입니다.";
  if (rule === "renju" && ply === 0 && i !== CENTER) return "렌주룰: 첫 수는 천원(가운데)에 둬요.";
  const s: Stone = ply % 2 === 0 ? BLACK : WHITE;
  const f = forbidden(bd, i, s, rule);
  if (f) return `금수(${FORBID_LABEL[f]})라서 둘 수 없는 자리입니다.`;
  return null;
}

export class Omok {
  bd: Int8Array;
  /** 판 줄 수 */
  readonly n: BoardN;
  /** 둔 자리 인덱스 */
  hist: number[] = [];
  winLine: number[] = [];
  private ended: GameEnd | null = null;

  constructor(
    public rule: Rule = "renju",
    n: number = 15
  ) {
    setBoardN(n);
    this.n = N;
    this.bd = new Int8Array(SIZE);
  }

  static replay(moves: string[], rule: Rule, n: number = 15): Omok {
    const g = new Omok(rule, n);
    for (const m of moves) g.move(m);
    return g;
  }

  /** fen = "규칙 N*N칸(.xo) 수" — 낙관적 표시·관전용 (칸 수로 판 크기를 앎) */
  static fromFen(fen: string): Omok {
    const [r, cells = ""] = fen.split(" ");
    const g = new Omok(isRule(r) ? r : "renju", cells.length === 361 ? 19 : 15);
    let n = 0;
    for (let i = 0; i < SIZE; i++) {
      const ch = cells[i];
      if (ch === "x") ((g.bd[i] = BLACK), n++);
      else if (ch === "o") ((g.bd[i] = WHITE), n++);
    }
    g.hist = Array.from({ length: n }, () => -1);
    return g;
  }

  fen(): string {
    setBoardN(this.n);
    let cells = "";
    for (let i = 0; i < SIZE; i++)
      cells += this.bd[i] === BLACK ? "x" : this.bd[i] === WHITE ? "o" : ".";
    return `${this.rule} ${cells} ${this.hist.length}`;
  }

  get ply() {
    return this.hist.length;
  }
  turn(): Color {
    return this.hist.length % 2 === 0 ? "w" : "b";
  }
  end(): GameEnd | null {
    return this.ended;
  }

  illegal(i: number): string | null {
    // 판 크기는 모듈이 같이 쓰는 값이라, 다른 판을 만든 뒤에도 이 판 기준으로 다시 맞춤
    setBoardN(this.n);
    if (this.ended) return "대국이 끝났습니다.";
    return illegalReason(this.bd, this.hist.length, i, this.rule);
  }

  /** 수 두기, 불법수면 throw */
  move(mv: string) {
    setBoardN(this.n);
    const i = parseSq(mv);
    const why = this.illegal(i);
    if (why) throw new Error(why);
    this.place(i);
  }

  private place(i: number) {
    const s: Stone = this.hist.length % 2 === 0 ? BLACK : WHITE;
    if (makesFive(this.bd, i, s, this.rule)) {
      this.bd[i] = s;
      this.winLine = fiveLine(this.bd, i, s, this.rule);
      this.ended = { result: s === BLACK ? "1-0" : "0-1", reason: "five" };
    } else {
      this.bd[i] = s;
      if (this.hist.length + 1 >= SIZE) this.ended = { result: "1/2-1/2", reason: "full" };
    }
    this.hist.push(i);
  }

  /** 지금 차례인 쪽의 금수 자리들 (판에 ✕로 표시) */
  forbiddenPoints(): number[] {
    if (this.ended) return [];
    setBoardN(this.n);
    const s: Stone = this.hist.length % 2 === 0 ? BLACK : WHITE;
    if (!hasForbidden(this.rule, s)) return [];
    const out: number[] = [];
    for (let i = 0; i < SIZE; i++)
      if (this.bd[i] === 0 && forbidden(this.bd, i, s, this.rule)) out.push(i);
    return out;
  }

  stones(): number {
    setBoardN(this.n);
    let n = 0;
    for (let i = 0; i < SIZE; i++) if (this.bd[i]) n++;
    return n;
  }
}
