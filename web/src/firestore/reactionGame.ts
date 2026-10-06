import {
  collection,
  addDoc,
  getDocs,
  orderBy,
  limit,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { fillCreateTimes, toDate } from "@/lib/rankDate";

const COLLECTION = "reaction";

export interface ReactionScore {
  id: string;
  name: string;
  score: number;
  /** 달성 일자 (예전 기록은 없음) */
  createdAt: Date | null;
}

export async function getTopReactionScores(count = 10): Promise<ReactionScore[]> {
  const q = query(collection(db, COLLECTION), orderBy("score", "asc"), limit(count));
  const snapshot = await getDocs(q);
  const rows = snapshot.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      name: x.name,
      score: x.score,
      createdAt: toDate(x.createdAt),
    } as ReactionScore;
  });
  return fillCreateTimes(COLLECTION, rows);
}

export async function addReactionScore(name: string, score: number): Promise<void> {
  await addDoc(collection(db, COLLECTION), { name, score, createdAt: serverTimestamp() });
}
