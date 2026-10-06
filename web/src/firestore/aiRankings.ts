import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
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

export async function getAIRanks(coll: AIRankColl, count = 10): Promise<AIRankRow[]> {
  const snap = await getDocs(query(collection(db, coll), orderBy("score", "desc"), limit(count)));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      name: x.name,
      score: x.score,
      opp: String(x.opp),
      moves: x.moves,
      seconds: x.seconds,
      lead: x.lead,
      createdAt: toDate(x.createdAt),
    };
  });
}

export async function addAIRank(coll: AIRankColl, e: AIRankEntry): Promise<void> {
  await addDoc(collection(db, coll), { ...e, createdAt: serverTimestamp() });
}
