import { api } from "@/lib/api/http";
import { submitRun } from "@/lib/api/rankRun";
import { toDate } from "@/lib/rankDate";

const BOARD = "score";

export interface MelonScore {
  id: string;
  name: string;
  /** 회원의 기록인지 */
  member: boolean;
  score: number;
  /** 달성 일자 (예전 기록은 없을 수 있음) */
  createdAt: Date | null;
}

/** 서버 응답 한 줄 (날짜는 ms) */
export interface MelonScoreRow {
  id: string;
  name: string;
  member?: boolean;
  score: number;
  createdAt: number | null;
}
export const MELON_SCORES_PATH = `/api/rankings/${BOARD}`;
export const toMelonScore = (x: MelonScoreRow): MelonScore => ({
  id: x.id,
  name: x.name,
  member: !!x.member,
  score: x.score,
  createdAt: toDate(x.createdAt),
});

export async function getTopMelonScores(count = 10): Promise<MelonScore[]> {
  const rows = await api<MelonScoreRow[]>(`${MELON_SCORES_PATH}?limit=${count}`);
  return rows.map(toMelonScore);
}

export async function addMelonScore(name: string, score: number): Promise<void> {
  await submitRun(BOARD, MELON_SCORES_PATH, { name, score });
}
