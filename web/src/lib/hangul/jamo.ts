/*
 * 니들이 한글을 알아? — 자모 모아쓰기
 *   자음 + 모음 → 글자(가) · 글자 + 자음 → 받침(각) · 글자 + 모음 재료 → 모음 바뀐 글자(기+ㆍ=가, 가+ㅣ=개)
 *   같은 자음 둘 → 된소리(ㄱ+ㄱ=ㄲ) · 모음은 천지인(ㆍ ㅡ ㅣ)으로 조립 (아래)
 */

export const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
export const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
export const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
/** 홑받침 + ㄲ ㅆ (겹받침은 조립 안 함) */
const OK_JONG = new Set(["ㄱ","ㄲ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"]);
const TENSE: Record<string, string> = { ㄱ: "ㄲ", ㄷ: "ㄸ", ㅂ: "ㅃ", ㅅ: "ㅆ", ㅈ: "ㅉ" };

/*
 * 모음은 천지인: 뽑기에서는 ㆍ(하늘) ㅡ(땅) ㅣ(사람) 셋만 나오고, 누르는 순서대로 겹쳐 모음을 만듦 (폰 천지인 자판과 같은 규칙).
 *   ㅣ→ㆍ = ㅏ · ㆍ→ㅣ = ㅓ · ㆍ→ㅡ = ㅗ · ㅡ→ㆍ = ㅜ · ㆍ→ㆍ = ᆢ(ㆍㆍ) · ㅏ→ㆍ = ㅑ · ᆢ→ㅣ = ㅕ · ᆢ→ㅡ = ㅛ · ㅜ→ㆍ = ㅠ
 *   ㅏ→ㅣ = ㅐ · ㅓ→ㅣ = ㅔ · ㅗ→ㅣ = ㅚ → ㆍ = ㅘ → ㅣ = ㅙ · ㅜ→ㅣ = ㅟ · ㅠ→ㅣ = ㅝ → ㅣ = ㅞ · ㅡ→ㅣ = ㅢ
 * 순서를 거꾸로 눌러도 그쪽 조합이 따로 없으면 받아 줌 (ㆍ→ㅏ 도 ㅑ). 옛 방식 ㅗ+ㅏ = ㅘ 같은 것도 그대로.
 */
export const DOT = "ㆍ";
export const DOTS = "ᆢ";
const CJI: Record<string, string> = {
  "ㆍㆍ": DOTS, "ㅣᆢ": "ㅑ", "ㅡᆢ": "ㅠ",
  "ㅣㆍ": "ㅏ", "ㅏㆍ": "ㅑ", "ㆍㅣ": "ㅓ", "ᆢㅣ": "ㅕ",
  "ㆍㅡ": "ㅗ", "ᆢㅡ": "ㅛ", "ㅡㆍ": "ㅜ", "ㅜㆍ": "ㅠ",
  // ㅏ→ㆍ = ㅑ 처럼 점 하나 더 찍기로도 (사람들이 먼저 떠올리는 방법)
  "ㅓㆍ": "ㅕ", "ㅗㆍ": "ㅛ",
  "ㅏㅣ": "ㅐ", "ㅑㅣ": "ㅒ", "ㅓㅣ": "ㅔ", "ㅕㅣ": "ㅖ",
  "ㅗㅣ": "ㅚ", "ㅚㆍ": "ㅘ", "ㅘㅣ": "ㅙ",
  "ㅜㅣ": "ㅟ", "ㅠㅣ": "ㅝ", "ㅝㅣ": "ㅞ", "ㅡㅣ": "ㅢ",
  "ㅗㅏ": "ㅘ", "ㅗㅐ": "ㅙ", "ㅜㅓ": "ㅝ", "ㅜㅔ": "ㅞ",
};
const vcomp = (a: string, b: string): string | null => CJI[a + b] ?? CJI[b + a] ?? null;
/** 모음 재료 (완성 모음 + ㆍ · ᆢ) */
export const isVowelish = (j: string) => JUNG.includes(j) || j === DOT || j === DOTS;
/** 화면에 쓰는 모양 (ㆍ 는 붓글씨 글꼴에서 너무 작고 ᆢ 는 글꼴에 없는 경우가 많아 점으로) */
export const shown = (j: string) => (j === DOT ? "•" : j === DOTS ? "••" : j);

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
  if (j === DOT) return 1;
  if (BASE_STROKE[j]) return BASE_STROKE[j];
  for (const [b, t] of Object.entries(TENSE)) if (t === j) return BASE_STROKE[b] * 2;
  return 3;
}
export const syllableStroke = (ch: string) => decompose(ch).reduce((s, j) => s + stroke(j), 0);

/** 실제 한국어에서 자주 쓰는 자모일수록 잘 나옴 (조사 · 어미에 많이 쓰는 ㅇ ㄴ ㄱ ㄹ, ㅏ ㅣ ㅓ ㅡ) */
export const CONS_W: Record<string, number> = { ㄱ: 10, ㄴ: 10, ㄷ: 8, ㄹ: 8, ㅁ: 6, ㅂ: 5, ㅅ: 8, ㅇ: 13, ㅈ: 6, ㅊ: 3, ㅋ: 2, ㅌ: 2, ㅍ: 2, ㅎ: 6 };
/** 천지인 재료: ㆍ 는 거의 모든 모음에 들어가서 가장 잘 나옴 */
export const VOWS_W: Record<string, number> = { "ㆍ": 40, ㅣ: 38, ㅡ: 22 };
/**
 * 자동 짝짓기용 모음 만드는 법 (자주 쓰는 모음일수록 w 큼) — 가진 재료로 되는 것 중에서 고름
 */
export const VOWEL_RECIPES: { v: string; need: string[]; w: number }[] = [
  { v: "ㅏ", need: ["ㅣ", DOT], w: 13 },
  { v: "ㅣ", need: ["ㅣ"], w: 10 },
  { v: "ㅓ", need: [DOT, "ㅣ"], w: 8 },
  { v: "ㅗ", need: [DOT, "ㅡ"], w: 7 },
  { v: "ㅡ", need: ["ㅡ"], w: 6 },
  { v: "ㅜ", need: ["ㅡ", DOT], w: 6 },
  { v: "ㅐ", need: ["ㅣ", DOT, "ㅣ"], w: 3 },
  { v: "ㅔ", need: [DOT, "ㅣ", "ㅣ"], w: 3 },
  { v: "ㅕ", need: [DOT, DOT, "ㅣ"], w: 3 },
  { v: "ㅑ", need: ["ㅣ", DOT, DOT], w: 1 },
  { v: "ㅛ", need: [DOT, DOT, "ㅡ"], w: 1 },
  { v: "ㅠ", need: ["ㅡ", DOT, DOT], w: 1 },
];
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

/** 겹받침: 받침 있는 글자에 자음 하나 더 (어+ㅂ=업 → 업+ㅅ=없) */
const JONG2: Record<string, string> = {
  "ㄱㅅ": "ㄳ", "ㄴㅈ": "ㄵ", "ㄴㅎ": "ㄶ", "ㄹㄱ": "ㄺ", "ㄹㅁ": "ㄻ", "ㄹㅂ": "ㄼ",
  "ㄹㅅ": "ㄽ", "ㄹㅌ": "ㄾ", "ㄹㅍ": "ㄿ", "ㄹㅎ": "ㅀ", "ㅂㅅ": "ㅄ",
};

/** 글자에 자모 붙이기 (받침 · 겹받침 · 모음 바꾸기), 안 되면 null */
export function addToSyllable(s: string, j: string): string | null {
  const [c, v, f] = decompose(s);
  if (f) return isCons(j) && JONG2[f + j] ? compose(c, v, JONG2[f + j]) : null;
  if (isCons(j)) return OK_JONG.has(j) ? compose(c, v, j) : null;
  const nv = vcomp(v, j);
  return nv && JUNG.includes(nv) ? compose(c, nv) : null;
}
