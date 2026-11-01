import type { Morph } from "./judge";

/*
 * 두 문장이 이어지는지 (브라우저 · 서버 같이 씀)
 *   1인 모드: 글(문장칸)에서 앞뒤 문장 → 이음 점수
 *   대전 모드: 상대가 보낸 문장 ↔ 내 문장 → 받아치기
 * 형태소 분석기는 문장을 하나씩 따로 읽어서(순서를 섞어도 점수가 같음) 문장끼리는 규칙으로 봄:
 *   이음말로 시작(그래서 · 근데 · 그리고 …) · 가리키는 말(그거 · 거기 · 그때 …) · 앞 문장의 뜻 있는 말을 다시 씀
 * 한 쌍에 최대 2 (이음말만 붙여 대는 것 막기)
 */
const POINTERS = new Set([
  "그",
  "이",
  "저",
  "그거",
  "이거",
  "저거",
  "그것",
  "이것",
  "저것",
  "거기",
  "여기",
  "저기",
  "그곳",
  "이곳",
  "그때",
  "그녀",
  "걔",
  "얘",
  "쟤",
  "그놈",
  "이놈",
  "저놈",
]);
export interface Link {
  level: 0 | 1 | 2;
  why: string[];
}
/** 뜻 있는 말(명사 · 동사 · 형용사 · 어근)의 모양 — 같은 말 찾기용 */
export const keyOf = (m: Morph) => (/^(NNG|NNP|VV|VA|XR)/.test(m.t) ? m.f : null);

/** a(앞 문장)의 형태소 → b(뒤 문장)의 형태소가 이어지는지 */
export function linkMorphs(am: Morph[], bm: Morph[]): Link {
  const why: string[] = [];
  const first = bm.find((m) => m.t !== "IC");
  if (first?.t === "MAJ") why.push(`이음말 「${first.f}」`);
  const ptr = bm.find((m) => /^(NP|MM|NN)/.test(m.t) && POINTERS.has(m.f));
  if (ptr) why.push(`가리킴 「${ptr.f}」`);
  const seen = new Set(am.map(keyOf).filter(Boolean));
  const same = bm.map(keyOf).find((f) => f && seen.has(f));
  if (same) why.push(`같은 말 「${same}」`);
  return { level: Math.min(2, why.length) as Link["level"], why };
}
