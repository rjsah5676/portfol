/**
 * DICE TOWN 난수 (mulberry32) — 상태가 숫자 하나라 판 상태에 그대로 넣고 복제 · 저장됨.
 * 서버가 판을 돌리고, 밸런스 시뮬도 같은 코드라 시드만 같으면 같은 판이 나옴.
 */
export interface Rng {
  r: number;
}

/** [0, 1) */
export function rnd(s: Rng): number {
  let t = (s.r = (s.r + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** [0, n) 정수 */
export const rndInt = (s: Rng, n: number) => Math.floor(rnd(s) * n);

/** 배열에서 하나 */
export const pick = <T>(s: Rng, a: readonly T[]): T => a[rndInt(s, a.length)];

/** 가중치 뽑기 — 인덱스 */
export function pickW(s: Rng, w: readonly number[]): number {
  const sum = w.reduce((a, b) => a + b, 0);
  let r = rnd(s) * sum;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r < 0) return i;
  }
  return w.length - 1;
}
