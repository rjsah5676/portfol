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

const COLLECTION = "score";

export interface MelonScore {
  id: string;
  name: string;
  score: number;
  /** 달성 일자 (예전 기록은 없음) */
  createdAt: Date | null;
}

export async function getTopMelonScores(count = 10): Promise<MelonScore[]> {
  const q = query(collection(db, COLLECTION), orderBy("score", "desc"), limit(count));
  const snapshot = await getDocs(q);
  const rows = snapshot.docs.map((d) => {
    const x = d.data();
    return { id: d.id, name: x.name, score: x.score, createdAt: toDate(x.createdAt) } as MelonScore;
  });
  return fillCreateTimes(COLLECTION, rows);
}

export async function addMelonScore(name: string, score: number): Promise<void> {
  await addDoc(collection(db, COLLECTION), { name, score, createdAt: serverTimestamp() });
}
