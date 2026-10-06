import { doc, getDoc, setDoc, increment } from "firebase/firestore";
import { db } from "../firebase";

const COLLECTION = "siteStats";
const TOTAL_ID = "total";
const dailyId = (dateKey: string) => `daily_${dateKey}`;

export interface VisitorStats {
  today: number;
  total: number;
}

// 방문 기록: 문서가 없으면 count=1로 생성, 있으면 +1 (규칙에서 +1만 허용)
export async function recordVisit(dateKey: string): Promise<void> {
  await Promise.all([
    setDoc(doc(db, COLLECTION, TOTAL_ID), { count: increment(1) }, { merge: true }),
    setDoc(doc(db, COLLECTION, dailyId(dateKey)), { count: increment(1) }, { merge: true }),
  ]);
}

export async function getVisitorStats(dateKey: string): Promise<VisitorStats> {
  const [total, today] = await Promise.all([
    getDoc(doc(db, COLLECTION, TOTAL_ID)),
    getDoc(doc(db, COLLECTION, dailyId(dateKey))),
  ]);
  return {
    total: (total.data()?.count as number) ?? 0,
    today: (today.data()?.count as number) ?? 0,
  };
}
