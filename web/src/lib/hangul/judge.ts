/*
 * 니들이 한글을 알아? — 판정 결과 형식과 점수 공식 (브라우저 · 서버 같이 씀)
 *   서버: server/src/hangul/kiwi.ts 가 형태소 분석기(Kiwi)로 글자 줄을 읽어 이 형식으로 돌려줌
 *   GET /api/hangul/judge?t=글자들  →  Judge
 */

/** 형태소 하나: f = 모양, t = 품사(세종 태그), k = 사전에 있는 말인지 (모르는 말은 분석기가 명사로 추측만 함) */
export interface Morph {
  f: string;
  t: string;
  k: boolean;
}

export interface Judge {
  /** 판정한 글자 줄 */
  text: string;
  /** 문장으로 읽은 결과 (끝에 마침표를 붙여 읽음 → 끝이 종결어미면 문장) */
  morphs: Morph[];
  /** 문장 완성: 모르는 말 없이 종결어미(EF)로 끝남 */
  sentence: boolean;
  /** 낱말 하나로 묶을 수 있으면 그 낱말의 대표 품사 (명사 · 동사 · 형용사 · 부사 · 감탄사 …), 아니면 null */
  word: string | null;
  /** 문장이면 점수, 아니면 0 */
  points: number;
  /** 말맛 (분석기 점수 ÷ 글자 수, 소수 둘째 자리) — gradeOf 로 등급 */
  nat: number;
}

/** 뜻을 가진 형태소(체언 · 용언 · 수식언 · 독립언 · 어근) — 조사 · 어미 · 접사 · 부호 빼고 */
export const isContent = (tag: string) => /^(NN|NP|NR|VV|VA|VX|MM|MA|IC|XR|SL|SN)/.test(tag);

export const hangulLen = (s: string) => [...s].filter((c) => c >= "가" && c <= "힣").length;

/**
 * 말맛 = 분석기 점수 ÷ 글자 수 (클수록 사람이 실제로 쓰는 말). 마침표를 붙여 읽은 점수.
 *   실제 문장은 -4 ~ -6.5 ("오늘 힘들다" -4.5 · "아 시발 … 하루였다" -5.7 · "가자" -6.3),
 *   글자를 아무렇게나 붙인 것은 -7 ~ -11 ("르이오" -8.2 · "아 오바자" -7.2)
 */
export const GRADES = [
  { min: -5.2, name: "명문", k: 1.5 },
  { min: -6.6, name: "말 됨", k: 1 },
  { min: -7.6, name: "억지", k: 0.5 },
] as const;
/** 말맛 등급 (이보다 낮으면 외계어 — 문장으로 안 침) */
export const gradeOf = (nat: number) => GRADES.find((g) => nat >= g.min) ?? null;

/**
 * 문장 점수: 길수록 확 커짐 (글자 수^1.6) + 뜻 있는 말이 많을수록 조금 더, × 말맛 등급.
 *   "오늘 힘들다"(5글자, 명문) ≈ 220 · "아 시발 섹스 섹스 좆 같은 하루였다"(14글자, 말 됨) ≈ 1,200
 */
export function sentencePoints(text: string, morphs: Morph[], nat: number): number {
  const n = hangulLen(text);
  const g = gradeOf(nat);
  if (n < 2 || !g) return 0;
  const content = morphs.filter((m) => isContent(m.t)).length;
  return Math.round(10 * n ** 1.6 * (1 + 0.12 * Math.max(0, content - 1)) * g.k);
}

/** 랭킹 점수 = 완성한 문장 점수 합 + 버틴 웨이브 × 이 값 */
export const HANGUL_WAVE_PTS = 100;

/** 글자 줄로 받을 수 있는 최대 글자 수 */
export const LINE_MAX = 30;
/** 판정 요청 글자 줄 형식 (완성된 한글 음절만) */
export const LINE_RE = new RegExp(`^[가-힣]{1,${LINE_MAX}}$`);
