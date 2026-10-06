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
import { fillCreateTimes, toDate } from "@/lib/rankDate";

// 곡·난이도별로 서브컬렉션을 나눠서 score 하나로만 정렬 (복합 인덱스 불필요)
// rhythm_rankings/{songId}_{diff}/scores/{autoId}
const scoresOf = (songId: string, diff: string) =>
  collection(db, "rhythm_rankings", `${songId}_${diff}`, "scores");

export const RHYTHM_NAME_MAX = 12;

export interface RhythmRanking {
  id: string;
  name: string;
  score: number;
  acc: number;
  maxCombo: number;
  fc: boolean;
  ap: boolean;
  /** 달성 일자 */
  createdAt: Date | null;
}

export async function getRhythmTop(
  songId: string,
  diff: string,
  count = 10
): Promise<RhythmRanking[]> {
  const snap = await getDocs(query(scoresOf(songId, diff), orderBy("score", "desc"), limit(count)));
  const rows = snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      name: String(x.name ?? ""),
      score: Number(x.score ?? 0),
      acc: Number(x.acc ?? 0),
      maxCombo: Number(x.maxCombo ?? 0),
      fc: !!x.fc,
      ap: !!x.ap,
      createdAt: toDate(x.createdAt),
    };
  });
  return fillCreateTimes(`rhythm_rankings/${songId}_${diff}/scores`, rows);
}

export async function addRhythmRanking(
  songId: string,
  diff: string,
  r: Omit<RhythmRanking, "id" | "createdAt">
): Promise<string> {
  const ref = await addDoc(scoresOf(songId, diff), {
    name: r.name.trim().slice(0, RHYTHM_NAME_MAX),
    score: Math.round(r.score),
    acc: Math.round(r.acc * 100) / 100,
    maxCombo: Math.round(r.maxCombo),
    fc: r.fc,
    ap: r.ap,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
