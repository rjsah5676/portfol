import { api } from "@/lib/api/http";
import { submitRun } from "@/lib/api/rankRun";
import { toDate } from "@/lib/rankDate";

/**
 * 체스·장기·오목 AI 랭킹 모드 기록 (이긴 판만).
 * 점수 계산은 lib/aiScore, 여기선 저장·조회만.
 */
export type AIRankColl =
  "chess_ai_rankings" | "janggi_ai_rankings" | "omok_ai_rankings" | "fight_ai_rankings";

export interface AIRankEntry {
  name: string;
  score: number;
  /** 상대 (체스: 레이팅 숫자 문자열, 장기·오목: 봇 id) */
  opp: string;
  moves: number;
  seconds: number;
  lead: number;
}

export interface AIRankRow extends AIRankEntry {
  id: string;
  createdAt: Date | null;
}

interface Row extends AIRankEntry {
  id: string;
  createdAt: number | null;
}

export async function getAIRanks(coll: AIRankColl, count = 10): Promise<AIRankRow[]> {
  const rows = await api<Row[]>(`/api/rankings/${coll}?limit=${count}`);
  return rows.map((x) => ({
    id: x.id,
    name: x.name,
    score: x.score,
    opp: String(x.opp),
    moves: x.moves,
    seconds: x.seconds,
    lead: x.lead,
    createdAt: toDate(x.createdAt),
  }));
}

export async function addAIRank(coll: AIRankColl, e: AIRankEntry): Promise<void> {
  const { name, score, opp, moves, seconds, lead } = e;
  await submitRun(coll, `/api/rankings/${coll}`, { name, score, opp, moves, seconds, lead });
}
