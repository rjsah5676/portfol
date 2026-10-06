import { api } from "@/lib/api/http";
import { toDate } from "@/lib/rankDate";

const BOARD = "score";

export interface MelonScore {
  id: string;
  name: string;
  score: number;
  /** 달성 일자 (예전 기록은 없을 수 있음) */
  createdAt: Date | null;
}

/** 서버 응답 한 줄 (날짜는 ms) */
export interface MelonScoreRow {
  id: string;
  name: string;
  score: number;
  createdAt: number | null;
}
export const MELON_SCORES_PATH = `/api/rankings/${BOARD}`;
export const toMelonScore = (x: MelonScoreRow): MelonScore => ({
  id: x.id,
  name: x.name,
  score: x.score,
  createdAt: toDate(x.createdAt),
});

export async function getTopMelonScores(count = 10): Promise<MelonScore[]> {
  const rows = await api<MelonScoreRow[]>(`${MELON_SCORES_PATH}?limit=${count}`);
  return rows.map(toMelonScore);
}

export async function addMelonScore(name: string, score: number): Promise<void> {
  await api(MELON_SCORES_PATH, { method: "POST", body: { name, score } });
}
