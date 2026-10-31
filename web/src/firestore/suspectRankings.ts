import { api } from "@/lib/api/http";
import { beginRun, submitRun } from "@/lib/api/rankRun";
import { toDate } from "@/lib/rankDate";

/*
 * 오늘의 용의자 랭킹 — 날짜 · 난이도마다 따로 (case = "YYYYMMDD_tier").
 *  GET  /api/rankings/suspect/:case?limit=50
 *  POST /api/rankings/suspect/:case  { name, time, miss, hint, score, ticket }
 * 오늘의 사건은 첫 기록만 남음 (다시 풀면 답을 아니까) — server/src/http/rankings.ts
 */

export interface SuspectRankingRow {
  id: string;
  name: string;
  member?: boolean;
  avatar?: string | null;
  /** 기록 (초) = 시간 + 실수 30초 + 힌트 60초 */
  score: number;
  time: number;
  miss: number;
  hint: number;
  createdAt: number | null;
}
export interface SuspectRanking extends Omit<SuspectRankingRow, "createdAt"> {
  createdAt: Date | null;
}

export const suspectRankPath = (c: string) => `/api/rankings/suspect/${c}`;
const boardOf = (c: string) => `suspect:${c}`;

export const toSuspectRanking = (x: SuspectRankingRow): SuspectRanking => ({
  ...x,
  member: !!x.member,
  avatar: x.avatar ?? null,
  createdAt: toDate(x.createdAt),
});

export async function getCaseRanking(c: string, limit = 50): Promise<SuspectRanking[]> {
  const rows = await api<SuspectRankingRow[]>(`${suspectRankPath(c)}?limit=${limit}`);
  return rows.map(toSuspectRanking);
}

/** 오늘의 사건을 처음 열 때 (서버가 판 시작 시각을 알게 함) */
export const beginCase = (c: string) => beginRun(boardOf(c));

export async function submitCase(
  c: string,
  rec: { name: string; time: number; miss: number; hint: number; score: number }
): Promise<string> {
  return submitRun(boardOf(c), suspectRankPath(c), rec);
}
