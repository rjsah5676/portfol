/*
 * 시작 전 사다리 타기 (차례 정하기) — 서버 · 화면이 같이 씀.
 * 세로줄 cols 개, 가로대는 rows 줄 중 어딘가에. 한 줄에서 이웃한 가로대는 붙지 않게.
 */

export const LADDER_ROWS = 7;

/** 가로대 만들기 (rnd(n) = 0..n-1) */
export function makeRungs(cols: number, rnd: (n: number) => number, rows = LADDER_ROWS): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols - 1) {
      if (rnd(100) < 55) {
        out.push([r, c]);
        c += 2;
      } else c++;
    }
  }
  // 세로줄 사이마다 적어도 하나는 있게
  for (let c = 0; c < cols - 1; c++)
    if (!out.some(([, x]) => x === c)) {
      const free = Array.from({ length: rows }, (_, r) => r).filter((r) => !out.some(([y, x]) => y === r && Math.abs(x - c) <= 1));
      if (free.length) out.push([free[rnd(free.length)], c]);
    }
  return out;
}

/** 위 칸 col 에서 내려가며 지나는 길: [세로줄, 줄] 꼭짓점 목록 · 끝 칸 */
export function trace(cols: number, rows: number, rungs: [number, number][], col: number): { path: [number, number][]; end: number } {
  let c = col;
  const path: [number, number][] = [[c, -1]];
  for (let r = 0; r < rows; r++) {
    const right = rungs.some(([y, x]) => y === r && x === c);
    const left = rungs.some(([y, x]) => y === r && x === c - 1);
    if (right || left) {
      path.push([c, r]);
      c += right ? 1 : -1;
      path.push([c, r]);
    }
  }
  path.push([c, rows]);
  return { path, end: Math.max(0, Math.min(cols - 1, c)) };
}
