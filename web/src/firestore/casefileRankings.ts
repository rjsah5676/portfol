import { api } from "@/lib/api/http";
import { beginRun, submitRunRes } from "@/lib/api/rankRun";
import { toDate } from "@/lib/rankDate";

/*
 * 오늘의 사건 파일 랭킹 — 날짜 · 난이도마다 따로 (case = "YYYYMMDD_tier"). server/src/http/rankings.ts
 *  GET  /api/rankings/casefile/:case?limit=50
 *  GET  /api/rankings/casefile/:case/summary        푼 사람 · 한 번에 해결 · 중간 기록 · 평균 오답 · 내 순위
 *  POST /api/rankings/casefile/:case  { name, time, wrong, score, cell, it, ticket }
 *   서버가 같은 시드로 사건을 다시 만들어 동선표(cell · it)가 정답인지 확인하고, 정답은 저장하지 않음. 첫 기록만 남음
 */

export interface CasefileRankingRow {
  id: string;
  name: string;
  member?: boolean;
  avatar?: string | null;
  /** 기록 (초) = 시간 + 오답 × 120 */
  score: number;
  time: number;
  wrong: number;
  createdAt: number | null;
}
export interface CasefileRanking extends Omit<CasefileRankingRow, "createdAt"> {
  createdAt: Date | null;
}
export interface CasefileSummary {
  total: number;
  /** 오답 없이 푼 사람 */
  clean: number;
  median: number | null;
  avgWrong: number | null;
  me: { id: string; pos: number; score: number; wrong: number } | null;
}

const path = (c: string) => `/api/rankings/casefile/${c}`;
const boardOf = (c: string) => `casefile:${c}`;

export async function getCaseRanking(c: string, limit = 50): Promise<CasefileRanking[]> {
  const rows = await api<CasefileRankingRow[]>(`${path(c)}?limit=${limit}`);
  return rows.map((x) => ({
    ...x,
    member: !!x.member,
    avatar: x.avatar ?? null,
    createdAt: toDate(x.createdAt),
  }));
}
export const getCaseSummary = (c: string) =>
  api<CasefileSummary>(`${path(c)}/summary`, { auth: true });

/** 오늘의 사건을 처음 열 때 (서버가 푼 시간을 알게) */
export const beginCase = (c: string) => beginRun(boardOf(c));

/** 올린 기록 id · 처음 올렸으면 회원 GP (DAILY_GP) */
export function submitCase(
  c: string,
  rec: { name: string; time: number; wrong: number; score: number; cell: number[][]; it: number[] }
): Promise<{ id: string; gp?: number; kept?: boolean }> {
  return submitRunRes<{ id: string; gp?: number; kept?: boolean }>(boardOf(c), path(c), rec);
}
