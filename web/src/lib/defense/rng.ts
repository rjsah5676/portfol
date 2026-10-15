/**
 * 픽셀 글리치 디펜스 난수 — 판(시드)이 같으면 브라우저 · 서버 어디서 돌려도 똑같이 나와야 해서 정수 연산만 씀 (mulberry32).
 * 상태는 보드 안의 숫자 하나라 그대로 저장 · 복제됨.
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

/** 시드 섞기 (보드 번호 등) */
export function mixSeed(seed: number, k: number): number {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
