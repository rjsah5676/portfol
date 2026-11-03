import { api } from "@/lib/api/http";
import { beginRun, submitRunRes } from "@/lib/api/rankRun";
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
  /** 기록 (초) = 시간 + 실수 120초 (오늘의 사건엔 힌트 없음 — hint 는 늘 0) */
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

/** 올린 기록 id · 처음 올려서 받은 GP (회원만, 사건마다 한 번 — 난이도별 DAILY_GP) */
export async function submitCase(
  c: string,
  rec: { name: string; time: number; miss: number; hint: number; score: number }
): Promise<{ id: string; gp?: number; kept?: boolean }> {
  return submitRunRes<{ id: string; gp?: number; kept?: boolean }>(boardOf(c), suspectRankPath(c), rec);
}

/** 사건 하나 요약 — 내 기록(me)은 로그인(비회원 익명 포함)했을 때만 */
export interface CaseSummary {
  total: number;
  perfect: number;
  /** 가운데 사람의 기록 (초) */
  median: number | null;
  avgMiss: number | null;
  me: { id: string; pos: number; score: number; time: number; miss: number } | null;
}
export const getCaseSummary = (c: string) =>
  api<CaseSummary>(`${suspectRankPath(c)}/summary`, { auth: true });

/** 누적 랭킹 (날짜 상관없이) — tier "all" 이면 전 난이도 */
export type HallSort = "solved" | "wins";
export interface HallRow {
  name: string;
  member: boolean;
  avatar: string | null;
  solved: number;
  wins: number;
  perfect: number;
  last: Date | null;
  me?: boolean;
}
export interface Hall {
  players: number;
  /** 기록이 하나라도 있는 사건 수 */
  cases: number;
  /** 모든 사람이 푼 사건 수 합 */
  solves: number;
  rows: HallRow[];
  me: { pos: number; solved: number; wins: number; perfect: number } | null;
}
export async function getSuspectHall(tier: string, sort: HallSort, limit = 50): Promise<Hall> {
  const h = await api<Omit<Hall, "rows"> & { rows: (Omit<HallRow, "last"> & { last: number | null })[] }>(
    `/api/rankings/suspect-hall?tier=${tier}&sort=${sort}&limit=${limit}`,
    { auth: true }
  );
  return { ...h, rows: h.rows.map((r) => ({ ...r, avatar: r.avatar ?? null, last: toDate(r.last) })) };
}
