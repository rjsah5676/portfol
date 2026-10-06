import { api } from "@/lib/api/http";
import { submitRun } from "@/lib/api/rankRun";
import { toDate } from "@/lib/rankDate";

const BOARD = "reaction";

export interface ReactionScore {
  id: string;
  name: string;
  score: number;
  /** 달성 일자 (예전 기록은 없을 수 있음) */
  createdAt: Date | null;
}

/** 서버 응답 한 줄 (날짜는 ms) */
export interface ReactionScoreRow {
  id: string;
  name: string;
  score: number;
  createdAt: number | null;
}
export const REACTION_SCORES_PATH = `/api/rankings/${BOARD}`;
export const toReactionScore = (x: ReactionScoreRow): ReactionScore => ({
  id: x.id,
  name: x.name,
  score: x.score,
  createdAt: toDate(x.createdAt),
});

export async function getTopReactionScores(count = 10): Promise<ReactionScore[]> {
  const rows = await api<ReactionScoreRow[]>(`${REACTION_SCORES_PATH}?limit=${count}`);
  return rows.map(toReactionScore);
}

/** 등록하고, 랭킹에 올라가 있는 내 기록의 id 를 돌려줌 */
export async function addReactionScore(name: string, score: number): Promise<string> {
  return submitRun(BOARD, REACTION_SCORES_PATH, { name, score });
}
