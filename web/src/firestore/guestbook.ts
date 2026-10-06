import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../firebase";

const COLLECTION = "guest";

export const NOTE_COLORS = ["lavender", "yellow", "mint", "pink", "sky"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface GuestEntry {
  docId: string;
  id: number;
  name: string;
  contents: string;
  date: string;
  /** 예전 글에는 없음 → id 기준으로 색 배정 */
  color?: NoteColor;
}

/** 실시간 구독 (다른 사람이 남긴 메모도 바로 붙음) */
export function subscribeGuestEntries(
  cb: (entries: GuestEntry[]) => void,
  onError?: (e: Error) => void
) {
  const q = query(collection(db, COLLECTION), orderBy("id", "desc"), limit(300));
  return onSnapshot(
    q,
    (snap) =>
      cb(snap.docs.map((d) => ({ ...(d.data() as Omit<GuestEntry, "docId">), docId: d.id }))),
    onError
  );
}

export async function addGuestEntry({
  name,
  contents,
  color,
}: Pick<GuestEntry, "name" | "contents" | "color">): Promise<number> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const id = now.getTime();
  const date = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일  ${now.getHours()}:${pad(now.getMinutes())}`;
  await addDoc(collection(db, COLLECTION), {
    name,
    contents,
    id,
    date,
    color: color ?? "lavender",
  });
  return id;
}

/** 관리자 전용 (보안 규칙에서 isAdmin 검사) */
export async function deleteGuestEntry(docId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, docId));
}
