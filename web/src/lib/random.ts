// 사다리·룰렛 공용 난수. Math.random 대신 crypto로 뽑아서 "조작 의심" 없이 공정하게.

/** 0 이상 max 미만 정수 */
export function randInt(max: number): number {
  if (max <= 0) return 0;
  const buf = new Uint32Array(1);
  // 모듈로 편향 제거: max의 배수 범위를 넘는 값은 버리고 다시 뽑음
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % max;
}

/** 0 이상 1 미만 실수 */
export const rand = () => randInt(1_000_000) / 1_000_000;

/** Fisher–Yates 셔플 (원본 유지) */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 쉼표·줄바꿈으로 구분된 문자열 → 항목 배열 (앞뒤 공백 제거, 빈 값 제외) */
export const splitItems = (text: string) =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
