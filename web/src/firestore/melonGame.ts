import { api } from "@/lib/api/http";
import { submitRun } from "@/lib/api/rankRun";
import { toDate } from "@/lib/rankDate";

const BOARD = "score";

export interface MelonScore {
  id: string;
  name: string;
  /** 회원의 기록인지 */
  member: boolean;
  /** 회원이 올린 프로필 사진 주소 (없으면 null) */
  avatar: string | null;
  score: number;
  /** 달성 일자 (예전 기록은 없을 수 있음) */
  createdAt: Date | null;
}

/** 서버 응답 한 줄 (날짜는 ms) */
export interface MelonScoreRow {
  id: string;
  name: string;
  member?: boolean;
  avatar?: string | null;
  score: number;
  createdAt: number | null;
}
export const MELON_SCORES_PATH = `/api/rankings/${BOARD}`;
export const toMelonScore = (x: MelonScoreRow): MelonScore => ({
  id: x.id,
  name: x.name,
  member: !!x.member,
  avatar: x.avatar ?? null,
  score: x.score,
  createdAt: toDate(x.createdAt),
});

/** 순위 범위: YYYYMMDD = 그날(데일리), all = 통합 (server/src/http/rankings.ts /melon/:board) */
export const melonRankPath = (b: string) => `/api/rankings/melon/${b}`;

export async function getMelonRanking(b: string, limit = 50): Promise<MelonScore[]> {
  const rows = await api<MelonScoreRow[]>(`${melonRankPath(b)}?limit=${limit}`);
  return rows.map(toMelonScore);
}

/** 한 범위 요약 — 내 기록(me)은 로그인(비회원 익명 포함)했을 때만 */
export interface MelonSummary {
  total: number;
  median: number | null;
  avg: number | null;
  me: { id: string; pos: number; score: number } | null;
}
export const getMelonSummary = (b: string) =>
  api<MelonSummary>(`${melonRankPath(b)}/summary`, { auth: true });

/** 한 번 올리면 통합 · 오늘 데일리에 같이 반영됨 (각각 내 최고 기록만 남음) */

export async function addMelonScore(name: string, score: number): Promise<void> {
  await submitRun(BOARD, MELON_SCORES_PATH, { name, score });
}
