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
  /** 회원의 기록인지 */
  member: boolean;
  /** 회원이 올린 프로필 사진 주소 (없으면 null) */
  avatar: string | null;
  createdAt: Date | null;
}

interface Row extends AIRankEntry {
  id: string;
  member?: boolean;
  avatar?: string | null;
  createdAt: number | null;
}

/** ch: 격투 AI만 — 내 캐릭터별 순위 (없으면 전체: 사람마다 가장 좋은 기록 하나) */
export async function getAIRanks(coll: AIRankColl, count = 10, ch?: string): Promise<AIRankRow[]> {
  const rows = await api<Row[]>(`/api/rankings/${coll}?limit=${count}${ch ? `&ch=${encodeURIComponent(ch)}` : ""}`);
  return rows.map((x) => ({
    id: x.id,
    name: x.name,
    member: !!x.member,
    avatar: x.avatar ?? null,
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
