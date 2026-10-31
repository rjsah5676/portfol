/*
 * 니들이 한글을 알아? — 자모 모아쓰기
 *   자음 + 모음 → 글자(가) · 글자 + 자음 → 받침(각) · 글자 + 모음 → 겹모음 글자(가+ㅣ=개)
 *   같은 자음 둘 → 된소리(ㄱ+ㄱ=ㄲ) · 모음 둘 → 겹모음(ㅗ+ㅏ=ㅘ)
 */

export const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
export const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
export const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
/** 홑받침 + ㄲ ㅆ (겹받침은 조립 안 함) */
const OK_JONG = new Set(["ㄱ","ㄲ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"]);
const TENSE: Record<string, string> = { ㄱ: "ㄲ", ㄷ: "ㄸ", ㅂ: "ㅃ", ㅅ: "ㅆ", ㅈ: "ㅉ" };
const VCOMP: Record<string, string> = {
  "ㅏㅣ": "ㅐ", "ㅓㅣ": "ㅔ", "ㅑㅣ": "ㅒ", "ㅕㅣ": "ㅖ", "ㅗㅏ": "ㅘ", "ㅗㅐ": "ㅙ", "ㅗㅣ": "ㅚ",
  "ㅜㅓ": "ㅝ", "ㅜㅔ": "ㅞ", "ㅜㅣ": "ㅟ", "ㅡㅣ": "ㅢ", "ㅘㅣ": "ㅙ", "ㅝㅣ": "ㅞ",
};
const vcomp = (a: string, b: string): string | null => VCOMP[a + b] ?? VCOMP[b + a] ?? null;

export const isCons = (j: string) => CHO.includes(j);
export const compose = (c: string, v: string, f = "") =>
  String.fromCharCode(0xac00 + (CHO.indexOf(c) * 21 + JUNG.indexOf(v)) * 28 + JONG.indexOf(f));
export function decompose(ch: string): [string, string, string] {
  const c = ch.charCodeAt(0) - 0xac00;
  return [CHO[Math.floor(c / 588)], JUNG[Math.floor((c % 588) / 28)], JONG[c % 28]];
}

const BASE_STROKE: Record<string, number> = {
  ㄱ: 1, ㄴ: 1, ㄷ: 2, ㄹ: 3, ㅁ: 3, ㅂ: 4, ㅅ: 2, ㅇ: 1, ㅈ: 2, ㅊ: 3, ㅋ: 2, ㅌ: 3, ㅍ: 4, ㅎ: 3,
  ㅏ: 2, ㅑ: 3, ㅓ: 2, ㅕ: 3, ㅗ: 2, ㅛ: 3, ㅜ: 2, ㅠ: 3, ㅡ: 1, ㅣ: 1,
};
/** 획 수 (된소리 = 2배, 겹모음 = 합) */
export function stroke(j: string): number {
  if (!j) return 0;
  if (BASE_STROKE[j]) return BASE_STROKE[j];
  for (const [b, t] of Object.entries(TENSE)) if (t === j) return BASE_STROKE[b] * 2;
  for (const [k, v] of Object.entries(VCOMP)) if (v === j) return [...k].reduce((s, x) => s + stroke(x), 0);
  return 2;
}
export const syllableStroke = (ch: string) => decompose(ch).reduce((s, j) => s + stroke(j), 0);

/** 실제 한국어에서 자주 쓰는 자모일수록 잘 나옴 (조사 · 어미에 많이 쓰는 ㅇ ㄴ ㄱ ㄹ, ㅏ ㅣ ㅓ ㅡ) */
export const CONS_W: Record<string, number> = { ㄱ: 10, ㄴ: 10, ㄷ: 8, ㄹ: 8, ㅁ: 6, ㅂ: 5, ㅅ: 8, ㅇ: 13, ㅈ: 6, ㅊ: 3, ㅋ: 2, ㅌ: 2, ㅍ: 2, ㅎ: 6 };
export const VOWS_W: Record<string, number> = { ㅏ: 13, ㅑ: 1, ㅓ: 8, ㅕ: 3, ㅗ: 7, ㅛ: 1, ㅜ: 6, ㅠ: 1, ㅡ: 7, ㅣ: 12 };
export function pick(W: Record<string, number>, rnd: () => number = Math.random): string {
  const ks = Object.keys(W);
  let r = rnd() * ks.reduce((s, k) => s + W[k], 0);
  for (const k of ks) if ((r -= W[k]) < 0) return k;
  return ks[0];
}

/** 자모 둘 합치기 → 새 자모(된소리 · 겹모음) 또는 글자, 안 되면 null */
export function joinJamo(a: string, b: string): { jamo: string } | { syllable: string } | null {
  const ca = isCons(a), cb = isCons(b);
  if (ca !== cb) {
    const [c, v] = ca ? [a, b] : [b, a];
    if (!JUNG.includes(v)) return null;
    return { syllable: compose(c, v) };
  }
  if (ca && a === b && TENSE[a]) return { jamo: TENSE[a] };
  if (!ca) {
    const v = vcomp(a, b);
    if (v) return { jamo: v };
  }
  return null;
}

/** 글자에 자모 붙이기 (받침 · 겹모음), 안 되면 null */
export function addToSyllable(s: string, j: string): string | null {
  const [c, v, f] = decompose(s);
  if (f) return null;
  if (isCons(j)) return OK_JONG.has(j) ? compose(c, v, j) : null;
  const nv = vcomp(v, j);
  return nv ? compose(c, nv) : null;
}
