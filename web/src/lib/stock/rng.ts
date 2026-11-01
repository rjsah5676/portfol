/*
 * 주식 게임 공용 난수 (서버 · 화면 · 시뮬이 같이 씀).
 * 차트는 시드 하나로 언제든 똑같이 다시 만들 수 있어야 해서(복기 · 서버 재시작) 결정적 난수를 씀.
 */

export type Rng = () => number;

/** sfc32: 빠르고 주기가 긴 32비트 난수. 0 이상 1 미만 */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** 문자열 · 숫자 시드 → 난수 (같은 시드면 늘 같은 수열) */
export function rngFrom(seed: string | number): Rng {
  const s = String(seed);
  // cyrb128 해시로 상태 4개를 만듦
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const r = sfc32(h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1);
  for (let i = 0; i < 12; i++) r(); // 처음 몇 개는 버림
  return r;
}

/** 표준정규 (Box–Muller) */
export function normal(r: Rng): number {
  let u = 0;
  while (u <= 1e-12) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** 자유도 nu 의 t 분포를 분산 1 로 맞춘 값 (꼬리가 두꺼운 잡음). nu 는 정수 (>2) */
export function studentT(r: Rng, nu = 4): number {
  let chi = 0;
  for (let i = 0; i < nu; i++) {
    const z = normal(r);
    chi += z * z;
  }
  return (normal(r) / Math.sqrt(chi / nu)) * Math.sqrt((nu - 2) / nu);
}

export const uniform = (r: Rng, a: number, b: number) => a + (b - a) * r();
export const pickOf = <T,>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
/** 가중치 뽑기 */
export function weighted<T extends string>(r: Rng, w: Record<T, number>): T {
  const keys = Object.keys(w) as T[];
  let x = r() * keys.reduce((a, k) => a + w[k], 0);
  for (const k of keys) if ((x -= w[k]) < 0) return k;
  return keys[keys.length - 1];
}
/** 서버용 무작위 시드 (화면에 안 내려감) */
export const newSeed = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
