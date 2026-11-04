import { api } from "@/lib/api/http";
import { beginRun, submitRunRes } from "@/lib/api/rankRun";
import { toDate } from "@/lib/rankDate";

/*
 * 픽셀 머지 랭킹 — 오늘의 판(날짜마다) · 무한 모드(전체). server/src/http/rankings.ts
 *  GET  /api/rankings/pixelmerge/:board?limit=50        board = YYYYMMDD | endless
 *  GET  /api/rankings/pixelmerge/:board/summary         한 사람 수 · 중간 점수 · 최고 단계 분포 · 내 순위
 *  POST /api/rankings/pixelmerge/:board  { name, score, drops, maxTier, time, ticket }
 *   한 사람당 가장 높은 점수 하나. 오늘의 판을 처음 올린 회원은 하루 한 번 GP
 */

export interface PixelmergeRankingRow {
  id: string;
  name: string;
  member?: boolean;
  avatar?: string | null;
  score: number;
  drops: number;
  maxTier: number;
  time: number;
  createdAt: number | null;
}
export interface PixelmergeRanking extends Omit<PixelmergeRankingRow, "createdAt"> {
  createdAt: Date | null;
}
export interface PixelmergeSummary {
  total: number;
  median: number | null;
  /** 트로피까지 만든 사람 */
  trophy: number;
  me: { id: string; pos: number; score: number; maxTier: number } | null;
}

const path = (b: string) => `/api/rankings/pixelmerge/${b}`;
const boardOf = (b: string) => `pixelmerge:${b}`;

export async function getMergeRanking(b: string, limit = 50): Promise<PixelmergeRanking[]> {
  const rows = await api<PixelmergeRankingRow[]>(`${path(b)}?limit=${limit}`);
  return rows.map((x) => ({
    ...x,
    member: !!x.member,
    avatar: x.avatar ?? null,
    createdAt: toDate(x.createdAt),
  }));
}
export const getMergeSummary = (b: string) =>
  api<PixelmergeSummary>(`${path(b)}/summary`, { auth: true });

/** 판을 시작할 때 (서버가 걸린 시간을 알게) */
export const beginMerge = (b: string) => beginRun(boardOf(b));

/** gp = 오늘의 판을 처음 올린 회원이 받은 GP, kept = 전에 올린 기록이 더 높아서 그대로 */
export function submitMerge(
  b: string,
  rec: { name: string; score: number; drops: number; maxTier: number; time: number }
): Promise<{ id: string; gp?: number; kept?: boolean }> {
  return submitRunRes<{ id: string; gp?: number; kept?: boolean }>(boardOf(b), path(b), rec);
}
