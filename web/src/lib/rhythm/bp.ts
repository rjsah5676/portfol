/**
 * BP(Best Performance): 곡마다 가장 좋은 판 하나의 점수를 난이도에 따라 환산한 점수. 회원 랭킹은 곡별 BP 상위 20곡의 합.
 *
 *  BP = 500 × 1.16^(레벨 − 21) × g(점수),  g(s) = (e^(2.5·s/1,000,000) − 1) / (e^2.5 − 1)
 *  - 레벨: 한 단계(1레벨)마다 16%씩 — Lv21 올퍼펙 500, Lv17 275, Lv13 152, Lv9 84, Lv3 34
 *  - 점수: 0점 0 → 100만 점 1. 직선이 아니라 위로 갈수록 가파른 지수 꼴(완만하게): 50만 점 22%, 90만 점 76%, 95만 점 88%
 *  server/src/http/bp.ts 와 같은 식 — 바꾸면 둘 다
 */
export const BP_TOP_SONGS = 20;
const K = 2.5;
export function bpOf(level: number, score: number): number {
  const s = Math.max(0, Math.min(1, score / 1_000_000));
  const g = (Math.exp(K * s) - 1) / (Math.exp(K) - 1);
  return Math.round(500 * Math.pow(1.16, level - 21) * g);
}
