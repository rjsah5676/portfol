/**
 * 장기 규칙 엔진 (서버 없이 브라우저에서 수 검증·AI 탐색에 같이 씀).
 *
 * 판: 가로 9줄(a~i) × 세로 10줄(0~9). 0줄이 위(한), 9줄이 아래(초). 칸 번호 = 줄 × 9 + 열.
 * 기물: 양수 = 초(w, 먼저 둠), 음수 = 한(b). 1궁 2사 3상 4마 5차 6포 7졸(병)
 * 수 표기: "e8e7" (출발·도착 칸), 한수쉼은 "pass".
 *
 * 규칙 정리 (단순화한 부분 포함)
 *  - 궁·사: 자기 궁성 안에서 한 칸 (궁성 대각선 위에서는 대각선으로도)
 *  - 차: 직선 무제한 + 궁성 대각선
 *  - 포: 기물 하나(포 제외)를 넘어서 이동·잡기, 포는 못 잡음 · 궁성 대각선도 넘기 가능
 *  - 마: 한 칸 직진 후 대각선 한 칸 (직진 칸이 막히면 못 감)
 *  - 상: 한 칸 직진 후 대각선 두 칸 (지나는 두 칸이 막히면 못 감)
 *  - 졸·병: 앞·옆 한 칸, 상대 궁성 안에서는 앞쪽 대각선도
 *  - 자기 궁이 장군 받는 수는 둘 수 없음, 장군이 아니면 한수쉼 가능
 *  - 끝: 외통(장군인데 둘 수 없음) / 빅장(두 궁이 사이에 아무것도 없이 마주봄) · 양쪽 연속 한수쉼 · 200수 → 점수 판정
 *  - 점수: 차13 포7 마5 상3 사3 졸2, 한은 덤 1.5
 */

export type Color = "w" | "b";
export const K = 1,
  A = 2,
  E = 3,
  H = 4,
  R = 5,
  C = 6,
  P = 7;
export const TYPE_NAME: Record<number, string> = {
  1: "궁",
  2: "사",
  3: "상",
  4: "마",
  5: "차",
  6: "포",
  7: "졸",
};
export const VALUE: Record<number, number> = { 1: 0, 2: 3, 3: 3, 4: 5, 5: 13, 6: 7, 7: 2 };
export const HAN_BONUS = 1.5;
export const MAX_PLIES = 200;

export const FILES = "abcdefghi";
export const sq = (f: number, r: number) => r * 9 + f;
export const fileOf = (s: number) => s % 9;
export const rankOf = (s: number) => Math.floor(s / 9);
export const sqName = (s: number) => `${FILES[fileOf(s)]}${rankOf(s)}`;
export const parseSq = (n: string) => sq(FILES.indexOf(n[0]), Number(n[1]));
const on = (f: number, r: number) => f >= 0 && f < 9 && r >= 0 && r < 10;

const colorOfPiece = (p: number): Color => (p > 0 ? "w" : "b");
const sign = (c: Color) => (c === "w" ? 1 : -1);

// ── 궁성 ──
const inPalaceOf = (f: number, r: number, c: Color) =>
  f >= 3 && f <= 5 && (c === "w" ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
const inAnyPalace = (f: number, r: number) => f >= 3 && f <= 5 && (r <= 2 || r >= 7);
/** 궁성 대각선으로 이어진 이웃 (모서리 ↔ 가운데) */
const DIAG = new Map<number, number[]>();
for (const cr of [1, 8]) {
  const center = sq(4, cr);
  const corners = [sq(3, cr - 1), sq(5, cr - 1), sq(3, cr + 1), sq(5, cr + 1)];
  DIAG.set(center, corners);
  for (const c of corners) DIAG.set(c, [center]);
}
/** 모서리에서 가운데를 지나 맞은편 모서리 */
const oppositeCorner = (corner: number) => {
  const f = fileOf(corner),
    r = rankOf(corner);
  const cr = r <= 2 ? 1 : 8;
  return sq(8 - f, 2 * cr - r);
};
const isCorner = (s: number) => DIAG.has(s) && DIAG.get(s)!.length === 1;
const centerOf = (corner: number) => DIAG.get(corner)![0];

const ORTH = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// ── 상차림 (b·c·g·h 열의 마/상 배치) ──
export type Setup = "hehe" | "ehhe" | "heeh" | "eheh";
export const SETUPS: { v: Setup; label: string }[] = [
  { v: "heeh", label: "마상상마" },
  { v: "ehhe", label: "상마마상" },
  { v: "hehe", label: "마상마상" },
  { v: "eheh", label: "상마상마" },
];

export function startBoard(w: Setup = "heeh", b: Setup = "heeh"): Int8Array {
  const bd = new Int8Array(90);
  const back = (setup: Setup) => {
    const t = (ch: string) => (ch === "h" ? H : E);
    return [R, t(setup[0]), t(setup[1]), A, 0, A, t(setup[2]), t(setup[3]), R];
  };
  // 한 (위) — 화면에서 마주보므로 상차림은 좌우를 뒤집어 놓음
  back(b)
    .reverse()
    .forEach((t, f) => t && (bd[sq(f, 0)] = -t));
  bd[sq(4, 1)] = -K;
  bd[sq(1, 2)] = -C;
  bd[sq(7, 2)] = -C;
  for (const f of [0, 2, 4, 6, 8]) bd[sq(f, 3)] = -P;
  // 초 (아래)
  back(w).forEach((t, f) => t && (bd[sq(f, 9)] = t));
  bd[sq(4, 8)] = K;
  bd[sq(1, 7)] = C;
  bd[sq(7, 7)] = C;
  for (const f of [0, 2, 4, 6, 8]) bd[sq(f, 6)] = P;
  return bd;
}

// ── 의사 합법수 (자기 궁 장군 여부는 안 봄) ──
/** from*90+to 로 묶은 수 목록 */
export function pseudoMoves(bd: Int8Array, c: Color, out: number[] = []): number[] {
  const s = sign(c);
  const enemyOrEmpty = (t: number) => bd[t] * s <= 0;
  for (let from = 0; from < 90; from++) {
    const p = bd[from] * s;
    if (p <= 0) continue;
    const f = fileOf(from),
      r = rankOf(from);
    switch (p) {
      case K:
      case A: {
        for (const [dx, dy] of ORTH) {
          const nf = f + dx,
            nr = r + dy;
          if (inPalaceOf(nf, nr, c)) {
            const t = sq(nf, nr);
            if (enemyOrEmpty(t)) out.push(from * 90 + t);
          }
        }
        for (const t of DIAG.get(from) ?? [])
          if (inPalaceOf(fileOf(t), rankOf(t), c) && enemyOrEmpty(t)) out.push(from * 90 + t);
        break;
      }
      case R: {
        for (const [dx, dy] of ORTH) {
          let nf = f + dx,
            nr = r + dy;
          while (on(nf, nr)) {
            const t = sq(nf, nr);
            if (bd[t] === 0) out.push(from * 90 + t);
            else {
              if (bd[t] * s < 0) out.push(from * 90 + t);
              break;
            }
            nf += dx;
            nr += dy;
          }
        }
        if (DIAG.has(from)) {
          if (isCorner(from)) {
            const mid = centerOf(from);
            if (bd[mid] === 0) {
              out.push(from * 90 + mid);
              const far = oppositeCorner(from);
              if (enemyOrEmpty(far)) out.push(from * 90 + far);
            } else if (bd[mid] * s < 0) out.push(from * 90 + mid);
          } else for (const t of DIAG.get(from)!) if (enemyOrEmpty(t)) out.push(from * 90 + t);
        }
        break;
      }
      case C: {
        for (const [dx, dy] of ORTH) {
          let nf = f + dx,
            nr = r + dy;
          // 넘을 기물 찾기
          while (on(nf, nr) && bd[sq(nf, nr)] === 0) {
            nf += dx;
            nr += dy;
          }
          if (!on(nf, nr) || Math.abs(bd[sq(nf, nr)]) === C) continue;
          nf += dx;
          nr += dy;
          while (on(nf, nr)) {
            const t = sq(nf, nr);
            if (bd[t] === 0) out.push(from * 90 + t);
            else {
              if (bd[t] * s < 0 && Math.abs(bd[t]) !== C) out.push(from * 90 + t);
              break;
            }
            nf += dx;
            nr += dy;
          }
        }
        if (isCorner(from)) {
          const mid = centerOf(from);
          const far = oppositeCorner(from);
          if (
            bd[mid] !== 0 &&
            Math.abs(bd[mid]) !== C &&
            (bd[far] === 0 || (bd[far] * s < 0 && Math.abs(bd[far]) !== C))
          )
            out.push(from * 90 + far);
        }
        break;
      }
      case H: {
        for (const [dx, dy] of ORTH) {
          if (!on(f + dx, r + dy) || bd[sq(f + dx, r + dy)] !== 0) continue;
          for (const e of [-1, 1]) {
            const nf = f + 2 * dx + (dx === 0 ? e : 0),
              nr = r + 2 * dy + (dy === 0 ? e : 0);
            if (on(nf, nr) && enemyOrEmpty(sq(nf, nr))) out.push(from * 90 + sq(nf, nr));
          }
        }
        break;
      }
      case E: {
        for (const [dx, dy] of ORTH) {
          if (!on(f + dx, r + dy) || bd[sq(f + dx, r + dy)] !== 0) continue;
          for (const e of [-1, 1]) {
            const ex = dx === 0 ? e : 0,
              ey = dy === 0 ? e : 0;
            const mf = f + 2 * dx + ex,
              mr = r + 2 * dy + ey;
            if (!on(mf, mr) || bd[sq(mf, mr)] !== 0) continue;
            const nf = f + 3 * dx + 2 * ex,
              nr = r + 3 * dy + 2 * ey;
            if (on(nf, nr) && enemyOrEmpty(sq(nf, nr))) out.push(from * 90 + sq(nf, nr));
          }
        }
        break;
      }
      case P: {
        const fwd = c === "w" ? -1 : 1;
        for (const [dx, dy] of [
          [0, fwd],
          [1, 0],
          [-1, 0],
        ]) {
          const nf = f + dx,
            nr = r + dy;
          if (on(nf, nr) && enemyOrEmpty(sq(nf, nr))) out.push(from * 90 + sq(nf, nr));
        }
        // 상대 궁성 안에서 앞쪽 대각선
        if (DIAG.has(from) && inAnyPalace(f, r) && !inPalaceOf(f, r, c))
          for (const t of DIAG.get(from)!)
            if ((rankOf(t) - r) * fwd > 0 && enemyOrEmpty(t)) out.push(from * 90 + t);
        break;
      }
    }
  }
  return out;
}

export const kingSq = (bd: Int8Array, c: Color) => bd.indexOf(K * sign(c));

export function isAttacked(bd: Int8Array, target: number, by: Color): boolean {
  const list = pseudoMoves(bd, by);
  for (const m of list) if (m % 90 === target) return true;
  return false;
}

export const inCheck = (bd: Int8Array, c: Color) => {
  const k = kingSq(bd, c);
  return k >= 0 && isAttacked(bd, k, c === "w" ? "b" : "w");
};

/** 두 궁이 같은 세로줄에서 사이에 아무것도 없이 마주봄 */
export function isBikjang(bd: Int8Array): boolean {
  const a = kingSq(bd, "w"),
    b = kingSq(bd, "b");
  if (a < 0 || b < 0 || fileOf(a) !== fileOf(b)) return false;
  for (let s = Math.min(a, b) + 9; s < Math.max(a, b); s += 9) if (bd[s] !== 0) return false;
  return true;
}

export function legalMoves(bd: Int8Array, c: Color): number[] {
  const out: number[] = [];
  for (const m of pseudoMoves(bd, c)) {
    const from = Math.floor(m / 90),
      to = m % 90;
    const cap = bd[to];
    bd[to] = bd[from];
    bd[from] = 0;
    if (!inCheck(bd, c)) out.push(m);
    bd[from] = bd[to];
    bd[to] = cap;
  }
  return out;
}

export function material(bd: Int8Array, c: Color): number {
  const s = sign(c);
  let sum = c === "b" ? HAN_BONUS : 0;
  for (let i = 0; i < 90; i++) if (bd[i] * s > 0) sum += VALUE[bd[i] * s];
  return sum;
}

export const encode = (m: number) => sqName(Math.floor(m / 90)) + sqName(m % 90);
export const decode = (mv: string) => parseSq(mv.slice(0, 2)) * 90 + parseSq(mv.slice(2, 4));

// ── 대국 (기보를 쌓아가며 판 상태 유지) ──
export type GameEnd = {
  result: "1-0" | "0-1";
  reason: "checkmate" | "bikjang" | "passes" | "maxplies";
} | null;

export interface PieceInfo {
  type: number;
  color: Color;
}

/** 같은 국면(판 + 차례)을 이 횟수째 만드는 수는 반복수로 금지 */
export const REPEAT_LIMIT = 3;

export class Janggi {
  bd: Int8Array;
  moveList: string[] = [];
  private turnColor: Color = "w";
  /** 지금까지 나온 국면별 횟수 (반복수 금지용) */
  private seen = new Map<string, number>();

  constructor(setup?: { w?: Setup; b?: Setup }) {
    this.bd = startBoard(setup?.w, setup?.b);
    this.remember();
  }

  private remember() {
    const k = this.fen();
    this.seen.set(k, (this.seen.get(k) ?? 0) + 1);
  }

  /** 이 수를 두면 나오는 국면이 이미 (REPEAT_LIMIT-1)번 나왔나 */
  private repeats(m: number | "pass"): boolean {
    const next = this.turnColor === "w" ? "b" : "w";
    if (m === "pass")
      return (this.seen.get(`${Array.from(this.bd).join(",")} ${next}`) ?? 0) >= REPEAT_LIMIT - 1;
    const from = Math.floor(m / 90),
      to = m % 90;
    const cap = this.bd[to];
    this.bd[to] = this.bd[from];
    this.bd[from] = 0;
    const k = `${Array.from(this.bd).join(",")} ${next}`;
    this.bd[from] = this.bd[to];
    this.bd[to] = cap;
    return (this.seen.get(k) ?? 0) >= REPEAT_LIMIT - 1;
  }

  /**
   * 반복수라서 못 두는 수들 ("pass" 포함 가능).
   * 둘 수 있는 게 전부 반복수면 막지 않음 (갇혀서 못 두는 일이 없게).
   */
  banned(): string[] {
    const all = legalMoves(this.bd, this.turnColor);
    const out = all.filter((m) => this.repeats(m)).map(encode);
    const passOk = !this.inCheck();
    const passBanned = passOk && this.repeats("pass");
    if (passBanned) out.push("pass");
    const options = all.length + (passOk ? 1 : 0);
    return out.length >= options ? [] : out;
  }

  /** fen()으로 만든 문자열에서 판·차례만 복원 (기보는 비어 있음 — 화면 표시용) */
  static fromFen(fen: string) {
    const g = new Janggi();
    const [cells, turn] = fen.split(" ");
    const arr = cells.split(",").map(Number);
    if (arr.length === 90) g.bd = Int8Array.from(arr);
    g.turnColor = turn === "b" ? "b" : "w";
    g.seen = new Map();
    g.remember();
    return g;
  }

  /** 기보 재생 — 이미 둔 수는 반복수 검사 안 함 (규칙 추가 전 기보 호환) */
  static replay(moves: string[], setup?: { w?: Setup; b?: Setup }) {
    const g = new Janggi(setup);
    for (const m of moves) g.move(m, true);
    return g;
  }

  turn(): Color {
    return this.turnColor;
  }

  /** 화면 표시용 판 [줄][열] */
  board(): (PieceInfo | null)[][] {
    return Array.from({ length: 10 }, (_, r) =>
      Array.from({ length: 9 }, (_, f) => {
        const p = this.bd[sq(f, r)];
        return p ? { type: Math.abs(p), color: colorOfPiece(p) } : null;
      })
    );
  }

  /** 판 + 차례 문자열 (같은 국면 비교·저장용) */
  fen(): string {
    return `${Array.from(this.bd).join(",")} ${this.turnColor}`;
  }

  inCheck(c: Color = this.turnColor) {
    return inCheck(this.bd, c);
  }

  /** 둘 수 있는 수 (반복수 제외) */
  legal(): string[] {
    const ban = new Set(this.banned());
    return legalMoves(this.bd, this.turnColor)
      .map(encode)
      .filter((m) => !ban.has(m));
  }

  /** 이 칸 기물이 갈 수 있는 칸 이름들 */
  targetsFrom(square: string): string[] {
    const from = parseSq(square);
    const ban = new Set(this.banned());
    return legalMoves(this.bd, this.turnColor)
      .filter((m) => Math.floor(m / 90) === from && !ban.has(encode(m)))
      .map((m) => sqName(m % 90));
  }

  canPass() {
    return !this.inCheck() && !this.banned().includes("pass");
  }

  /** 불법수면 throw */
  move(mv: string, allowRepeat = false) {
    if (mv === "pass") {
      if (this.inCheck()) throw new Error("장군을 받은 상태에서는 쉴 수 없습니다.");
      if (!allowRepeat && this.repeats("pass") && this.banned().includes("pass"))
        throw new Error("반복수는 둘 수 없습니다.");
    } else {
      const m = decode(mv);
      if (!legalMoves(this.bd, this.turnColor).includes(m)) throw new Error("둘 수 없는 수입니다.");
      if (!allowRepeat && this.repeats(m) && this.banned().includes(mv))
        throw new Error("반복수는 둘 수 없습니다.");
      const from = Math.floor(m / 90),
        to = m % 90;
      this.bd[to] = this.bd[from];
      this.bd[from] = 0;
    }
    this.moveList.push(mv);
    this.turnColor = this.turnColor === "w" ? "b" : "w";
    this.remember();
  }

  score(c: Color) {
    return material(this.bd, c);
  }

  end(): GameEnd {
    const t = this.turnColor;
    const byScore = (reason: "bikjang" | "passes" | "maxplies"): GameEnd => ({
      result: this.score("w") > this.score("b") ? "1-0" : "0-1",
      reason,
    });
    if (this.inCheck(t) && legalMoves(this.bd, t).length === 0)
      return { result: t === "w" ? "0-1" : "1-0", reason: "checkmate" };
    if (this.moveList.length && this.moveList.at(-1) !== "pass" && isBikjang(this.bd))
      return byScore("bikjang");
    const n = this.moveList.length;
    if (n >= 2 && this.moveList[n - 1] === "pass" && this.moveList[n - 2] === "pass")
      return byScore("passes");
    if (n >= MAX_PLIES) return byScore("maxplies");
    return null;
  }

  /** 잡힌 기물 (색별로, 잡힌 쪽 기준) */
  captured(): Record<Color, number[]> {
    const start = startBoard();
    const count = (bd: Int8Array, c: Color) => {
      const m: Record<number, number> = {};
      const s = sign(c);
      for (let i = 0; i < 90; i++) if (bd[i] * s > 0) m[bd[i] * s] = (m[bd[i] * s] ?? 0) + 1;
      return m;
    };
    const out: Record<Color, number[]> = { w: [], b: [] };
    for (const c of ["w", "b"] as Color[]) {
      const a = count(start, c),
        b = count(this.bd, c);
      for (const t of [R, C, H, E, A, P])
        for (let i = 0; i < (a[t] ?? 0) - (b[t] ?? 0); i++) out[c].push(t);
    }
    return out;
  }
}

/** 기보 한 수를 사람이 읽는 말로: "차 a9→a7" */
export function describeMove(bdBefore: Int8Array, mv: string): string {
  if (mv === "pass") return "한수쉼";
  const m = decode(mv);
  const from = Math.floor(m / 90),
    to = m % 90;
  const p = Math.abs(bdBefore[from]);
  const cap = bdBefore[to] ? `×${TYPE_NAME[Math.abs(bdBefore[to])]}` : "";
  return `${TYPE_NAME[p]} ${sqName(from)}→${sqName(to)}${cap}`;
}
