/** BP 계산 — web/src/lib/rhythm/bp.ts 와 같은 식 (바꾸면 둘 다) */
export const BP_TOP_SONGS = 20;
const K = 2.5;
export function bpOf(level: number, score: number): number {
  const s = Math.max(0, Math.min(1, score / 1_000_000));
  const g = (Math.exp(K * s) - 1) / (Math.exp(K) - 1);
  return Math.round(500 * Math.pow(1.16, level - 21) * g);
}
