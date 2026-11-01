import { CHO, compose, decompose, JONG, JUNG } from "./jamo";

/*
 * 니들이 한글을 알아? — 「오늘의 자모」 데일리 퍼즐 규칙 (브라우저 · 서버 같이 씀)
 *
 *   매일 자정(한국 시간) 난이도마다 속담 · 관용구 한 문장을 자모로 흩어서 줌 (정답은 서버만 앎).
 *   자모를 자판처럼 눌러(두벌식으로 저절로 글자가 됨) 주어진 자모를 **다 써서** 문장을 만들면:
 *     원래 문장과 같으면 「정답」, 다르지만 판정기가 말이 된다고 하면 「별해」 — 둘 다 풀린 걸로 침.
 *   모음은 천지인이 아니라 완성된 모음(ㅏ ㅘ …) 그대로, 쌍자음 첫소리는 한 장(ㄲ), 겹받침은 두 장(ㄳ → ㄱ ㅅ).
 *   기록 = 걸린 시간 + 힌트 × HINT_SEC (작을수록 좋음), 날짜 · 난이도마다 첫 기록만.
 */

export type DailyTier = 1 | 2 | 3;
export const DAILY_TIERS: { id: DailyTier; label: string; desc: string }[] = [
  { id: 1, label: "쉬움", desc: "7글자 이하" },
  { id: 2, label: "보통", desc: "8~10글자" },
  { id: 3, label: "어려움", desc: "11글자 이상" },
];
/** 힌트 하나에 붙는 시간(초) */
export const HINT_SEC = 30;
/** 힌트 단계: 1 = 띄어쓰기 틀(낱말마다 글자 수) · 2 = 첫 글자 · 3 = 초성 전부 */
export const HINT_MAX = 3;
export const dailyScore = (time: number, hint: number) => Math.round((time + hint * HINT_SEC) * 10) / 10;

/** 한국 시간 날짜 "YYYYMMDD" */
export function kstDay(now = Date.now(), offsetDays = 0): string {
  const d = new Date(now + 9 * 3600e3 + offsetDays * 864e5);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}
/** 퍼즐 번호 (#1 = 2026-11-01, 처음 연 날) */
export function dailyNo(day: string): number {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8));
  return Math.floor((t - Date.UTC(2026, 10, 1)) / 864e5) + 1;
}
/** 퍼즐 키 "YYYYMMDD_t" (랭킹 칸 이름도 이것) */
export const pzKey = (day: string, tier: DailyTier) => `${day}_${tier}`;
export const PZ_RE = /^(\d{8})_([123])$/;
export const tierOfKey = (pz: string) => Number(pz.slice(-1)) as DailyTier;

/** 난이도: 한글 글자 수로 */
export const tierOfLen = (n: number): DailyTier => (n <= 7 ? 1 : n <= 10 ? 2 : 3);

/** 한글만 (띄어쓰기 · 부호 뺀 것) */
export const coreOf = (t: string) => t.replace(/[^가-힣]/g, "");

/** 겹받침 → 두 장 */
const SPLIT: Record<string, [string, string]> = {
  ㄳ: ["ㄱ", "ㅅ"],
  ㄵ: ["ㄴ", "ㅈ"],
  ㄶ: ["ㄴ", "ㅎ"],
  ㄺ: ["ㄹ", "ㄱ"],
  ㄻ: ["ㄹ", "ㅁ"],
  ㄼ: ["ㄹ", "ㅂ"],
  ㄽ: ["ㄹ", "ㅅ"],
  ㄾ: ["ㄹ", "ㅌ"],
  ㄿ: ["ㄹ", "ㅍ"],
  ㅀ: ["ㄹ", "ㅎ"],
  ㅄ: ["ㅂ", "ㅅ"],
};
const JOIN: Record<string, string> = Object.fromEntries(
  Object.entries(SPLIT).map(([k, [a, b]]) => [a + b, k])
);

/** 문장 → 자모 조각들 (글자 순서대로) */
export function tilesOf(text: string): string[] {
  const out: string[] = [];
  for (const ch of coreOf(text)) {
    const [c, v, f] = decompose(ch);
    out.push(c, v);
    if (f) out.push(...(SPLIT[f] ?? [f]));
  }
  return out;
}

/** 자판에 보일 순서: 자음(가나다) → 모음(ㅏㅐㅑ…) */
const ORDER = [...CHO, ...JUNG];
export const sortTiles = (t: string[]) =>
  [...t].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

/** 두 자모 묶음이 같은지 (순서 무관) */
export function sameTiles(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = sortTiles(a),
    y = sortTiles(b);
  return x.every((v, i) => v === y[i]);
}

/** 개수 세기 */
export function countTiles(t: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const j of t) m.set(j, (m.get(j) ?? 0) + 1);
  return m;
}

export const isConsTile = (j: string) => CHO.includes(j);
export const isVowelTile = (j: string) => JUNG.includes(j);
/** 받침으로 쓸 수 있는 자음 (ㄸ ㅃ ㅉ 은 못 씀) */
const canJong = (j: string) => JONG.includes(j);

/**
 * 두벌식 조합: 누른 자모 순서 → 글자들 (휴대폰 자판처럼).
 *   자음 + 모음 → 글자, 그 뒤 자음은 받침, 받침 뒤에 모음이 오면 받침이 다음 글자 첫소리로 넘어감(겹받침이면 뒤쪽만).
 *   부호(, . ? !)는 그대로. 글자가 못 된 자모는 낱자로 남음 (그런 줄은 문장이 아님)
 */
export function composeKeys(keys: string[]): string {
  let out = "";
  let cho = "",
    jung = "",
    jong = "";
  const flush = () => {
    if (cho && jung) out += compose(cho, jung, jong);
    else out += cho + jung + jong;
    cho = jung = jong = "";
  };
  for (const k of keys) {
    if (isVowelTile(k)) {
      if (cho && !jung) jung = k;
      else if (jong) {
        // 받침이 다음 글자 첫소리로 (겹받침이면 뒤쪽 하나만)
        const split = SPLIT[jong];
        const move = split ? split[1] : jong;
        jong = split ? split[0] : "";
        flush();
        cho = move;
        jung = k;
      } else {
        flush();
        jung = k;
      }
    } else if (isConsTile(k)) {
      if (cho && jung && !jong && canJong(k)) jong = k;
      else if (jong && JOIN[jong + k]) jong = JOIN[jong + k];
      else {
        flush();
        cho = k;
      }
    } else {
      flush();
      out += k;
    }
  }
  flush();
  return out;
}

/** 다 조합된 줄인지 (낱자가 남지 않음) */
export const allSyllables = (s: string) => /^[가-힣,.?! ]*$/.test(s) && /[가-힣]/.test(s);

/** 힌트 1: 띄어쓰기 틀 (낱말마다 글자 수) */
export const skeletonOf = (answer: string) => answer.trim().split(/\s+/).map((w) => coreOf(w).length);
/** 힌트 3: 초성 (띄어쓰기 그대로) */
export const chosungOf = (answer: string) =>
  answer
    .trim()
    .split(/\s+/)
    .map((w) => [...coreOf(w)].map((ch) => decompose(ch)[0]).join(""))
    .join(" ");

/** 서버가 내려 주는 오늘 퍼즐 */
export interface DailyPuzzle {
  pz: string;
  day: string;
  tier: DailyTier;
  no: number;
  /** 자판 순서로 정렬한 자모 조각들 */
  tiles: string[];
  /** 정답 글자 수 */
  len: number;
}
/** 정답 확인 결과 */
export interface DailyCheck {
  /** 정답 · 별해면 풀림 */
  kind: "정답" | "별해" | null;
  /** 안 풀렸을 때 까닭: 자모가 다름 · 문장이 아님 · 속담 낱말을 순서만 바꿈 */
  why?: "tiles" | "sentence" | "order";
  /** 띄어쓰기 고친 내 문장 */
  spaced: string;
  /** 풀렸을 때만: 원래 문장 */
  answer?: string;
}
