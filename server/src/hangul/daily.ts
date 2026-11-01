import {
  chosungOf,
  coreOf,
  dailyNo,
  type DailyCheck,
  type DailyPuzzle,
  type DailyTier,
  kstDay,
  PZ_RE,
  sameTiles,
  skeletonOf,
  sortTiles,
  tierOfLen,
  tilesOf,
} from "../../../web/src/lib/hangul/daily";
import { gradeOf, isLine } from "../../../web/src/lib/hangul/judge";
import { DAILY_BANK } from "./dailyBank";
import { judge } from "./kiwi";

/*
 * 「오늘의 자모」 서버 쪽: 날짜 · 난이도 → 오늘 문제, 정답 확인, 힌트 (정답 문장은 서버만 앎)
 */

/** 난이도마다 문제 목록 (은행 순서 그대로) */
const BY_TIER: Record<DailyTier, string[]> = { 1: [], 2: [], 3: [] };
for (const s of DAILY_BANK) BY_TIER[tierOfLen(coreOf(s).length)].push(s);

/** 받는 날짜: 어제 · 오늘 · 내일 (자정 무렵 · 시계 어긋남 여유) */
export const dayOpen = (day: string, now = Date.now()) =>
  day >= kstDay(now, -1) && day <= kstDay(now, 1) && dailyNo(day) >= 1;

/** 퍼즐 키 → 정답 문장 (없는 키 · 열리지 않은 날이면 null) */
export function answerOf(pz: string, now = Date.now()): string | null {
  const m = PZ_RE.exec(pz);
  if (!m || !dayOpen(m[1], now)) return null;
  const list = BY_TIER[Number(m[2]) as DailyTier];
  return list[(dailyNo(m[1]) - 1) % list.length] ?? null;
}

export function puzzleOf(pz: string, now = Date.now()): DailyPuzzle | null {
  const a = answerOf(pz, now);
  if (!a) return null;
  const day = pz.slice(0, 8);
  return {
    pz,
    day,
    tier: Number(pz.slice(-1)) as DailyTier,
    no: dailyNo(day),
    tiles: sortTiles(tilesOf(a)),
    len: coreOf(a).length,
  };
}

/** 힌트 n 단계 값 (1 띄어쓰기 틀 · 2 첫 글자 · 3 초성) */
export function hintOf(answer: string, n: number): number[] | string {
  return n === 1 ? skeletonOf(answer) : n === 2 ? coreOf(answer)[0] : chosungOf(answer);
}

/**
 * 내 문장 확인: 주어진 자모를 다 썼는지 → 원래 문장과 같으면 정답, 아니면 판정기가 문장이라고 하면 별해.
 *   판정기가 꺼져 있으면 별해는 못 따짐 (JudgeOffError 그대로 올라감)
 */
export async function checkDaily(answer: string, text: string): Promise<DailyCheck> {
  const core = coreOf(text);
  if (!isLine(text) || !sameTiles(tilesOf(core), tilesOf(answer)))
    return { kind: null, why: "tiles", spaced: text };
  if (core === coreOf(answer)) return { kind: "정답", spaced: answer, answer };
  const j = await judge(text);
  const ok = j.sentence && !!gradeOf(j.nat);
  if (!ok) return { kind: null, why: "sentence", spaced: j.spaced };
  // 속담의 낱말(형태소)을 순서만 바꾼 건 별해가 아님 — 아니면 낱말만 맞추고 섞어서 쉽게 풀림
  const a = await judge(coreOf(answer));
  if (sameForms(j.morphs, a.morphs)) return { kind: null, why: "order", spaced: j.spaced };
  return { kind: "별해", spaced: j.spaced, answer };
}
/** 형태소 모양 묶음이 같은지 (순서 · 품사 무관) */
const sameForms = (x: { f: string }[], y: { f: string }[]) => {
  const fx = x.map((m) => m.f).filter((f) => f !== ".").sort();
  const fy = y.map((m) => m.f).filter((f) => f !== ".").sort();
  return fx.length === fy.length && fx.every((f, i) => f === fy[i]);
};

/** 개발 · 시험용: 은행 난이도별 개수 */
export const bankSizes = () => ({ 1: BY_TIER[1].length, 2: BY_TIER[2].length, 3: BY_TIER[3].length });
