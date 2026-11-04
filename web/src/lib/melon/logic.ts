/**
 * 멜론 게임 규칙 (화면과 분리한 순수 로직).
 * 예전 코드와 판정·점수·시간이 완전히 같게 옮김:
 *  - 판: 가로 21 × 세로 12, 칸마다 1~9 무작위
 *  - 드래그 사각형의 두 꼭짓점이 걸친 칸(양 끝 포함)이 선택됨.
 *    칸 번호는 Math.trunc(좌표 / 칸 크기) → 판 왼쪽·위쪽 바깥 한 칸 이내(-40~0)도 0번 칸으로 잡힘 (예전과 동일)
 *  - 선택한 칸 숫자 합이 10 또는 20이면 남아 있는 멜론을 모두 지우고, 지운 개수만큼 점수
 *  - 시간: 130에서 100ms마다 0.11씩 줄고 0 밑으로 내려가면 끝 (약 118초)
 */

export const COLS = 21;
export const ROWS = 12;
/** 칸 크기(논리 좌표) */
export const CELL = 40;

export const TIME_START = 130;
export const TIME_STEP = 0.11;
export const TICK_MS = 100;
/** 예전 게임 기준 전체 시간(초) – 표시용 */
export const TOTAL_SEC = (TIME_START / TIME_STEP) * (TICK_MS / 1000);

/** board[col][row], 0이면 지워진 칸 */
export type Board = number[][];

export function createBoard(): Board {
  return Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, () => Math.trunc(Math.random() * 9) + 1)
  );
}

export interface Range {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** 판 기준 좌표(px, 판 왼쪽 위가 0,0) 두 점 → 선택 칸 범위 (판 밖 번호도 그대로 둠, 셀 때 거름) */
export function rangeOf(ax: number, ay: number, bx: number, by: number): Range {
  return {
    c0: Math.trunc(Math.min(ax, bx) / CELL),
    r0: Math.trunc(Math.min(ay, by) / CELL),
    c1: Math.trunc(Math.max(ax, bx) / CELL),
    r1: Math.trunc(Math.max(ay, by) / CELL),
  };
}

const inBoard = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS;

/** 범위 안에 남아 있는 칸들 */
export function cellsIn(board: Board, g: Range): { c: number; r: number; v: number }[] {
  const out: { c: number; r: number; v: number }[] = [];
  for (let c = g.c0; c <= g.c1; c++)
    for (let r = g.r0; r <= g.r1; r++)
      if (inBoard(c, r) && board[c][r] !== 0) out.push({ c, r, v: board[c][r] });
  return out;
}

export const isClear = (sum: number) => sum === 10 || sum === 20;

// ── 데일리 랭킹 날짜 (한국 시간 기준, 서버 · 화면이 같이 씀) ──

/** 데일리 랭킹을 시작한 날 (이전 날짜는 고를 수 없음) */
export const FIRST_DAY = "20261104";
export const DAY_RE = /^\d{8}$/;
/** 한국 시간 날짜 YYYYMMDD (offset = 며칠 뒤) */
export function kstDay(t = Date.now(), offset = 0): string {
  return new Date(t + 9 * 3600e3 + offset * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
}
export function shiftDay(d: string, n: number): string {
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) + n * 864e5);
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}`;
}
export const dayLabel = (d: string) => `${+d.slice(4, 6)}월 ${+d.slice(6, 8)}일`;
const WEEK = "일월화수목금토";
export const weekdayOf = (d: string) =>
  WEEK[new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))).getUTCDay()];
