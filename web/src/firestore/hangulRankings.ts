import { api } from "@/lib/api/http";
import { beginRun, submitRun } from "@/lib/api/rankRun";
import { toDate } from "@/lib/rankDate";
import type { Judge } from "@/lib/hangul/judge";

/*
 * 니들이 한글을 알아? 판정 · 랭킹
 *  GET  /api/hangul/judge?t=글자들
 *  GET  /api/rankings/hangul_rankings?limit=50
 *  POST /api/rankings/hangul_rankings  { name, score, wave, best, bestPts, ticket }
 * 대표글(best)은 서버가 다시 판정해서 문장이 맞는지 · 점수가 맞는지 확인 — server/src/http/rankings.ts
 */

const BOARD = "hangul_rankings";
const PATH = `/api/rankings/${BOARD}`;

const cache = new Map<string, Promise<Judge>>();
/** 같은 글자 줄은 한 번만 물어봄 */
export function judgeLine(text: string): Promise<Judge> {
  let p = cache.get(text);
  if (!p) {
    p = api<Judge>(`/api/hangul/judge?t=${encodeURIComponent(text)}`, { timeoutMs: 15_000 });
    p.catch(() => cache.delete(text));
    cache.set(text, p);
  }
  return p;
}

/** 뭐 되지? — 문장칸 뒤에 units 를 add 순서대로 붙이면 문장 · 낱말이 되는 것들 (server/src/hangul/kiwi.ts) */
export interface Suggestion {
  add: number[];
  text: string;
  sentence: boolean;
  word: string | null;
  points: number;
}
export const suggestLine = (line: string, units: string[]) =>
  api<Suggestion[]>(
    `/api/hangul/suggest?line=${encodeURIComponent(line)}&u=${encodeURIComponent(units.join(","))}`,
    { timeoutMs: 20_000 },
  );

export interface HangulRanking {
  id: string;
  name: string;
  member: boolean;
  avatar: string | null;
  score: number;
  wave: number;
  best: string;
  bestPts: number;
  createdAt: Date | null;
}

export async function getHangulRanking(limit = 30): Promise<HangulRanking[]> {
  const rows = await api<(Omit<HangulRanking, "createdAt"> & { createdAt: number | null })[]>(`${PATH}?limit=${limit}`);
  return rows.map((r) => ({ ...r, member: !!r.member, avatar: r.avatar ?? null, createdAt: toDate(r.createdAt) }));
}

export const beginHangul = () => beginRun(BOARD);

export const submitHangul = (rec: { name: string; score: number; wave: number; best: string; bestPts: number }) =>
  submitRun(BOARD, PATH, rec);
