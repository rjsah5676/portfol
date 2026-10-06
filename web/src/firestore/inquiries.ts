import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";

// 방문자 문의 (플로팅 버튼 → 문의하기). 쓰기는 누구나, 조회·수정·삭제는 관리자만 (firestore.rules)
const COLLECTION = "inquiries";

export const INQUIRY_LIMITS = { name: 30, email: 100, phone: 20, message: 1000 } as const;

export interface InquiryInput {
  name: string;
  email: string;
  /** 선택 입력 (없으면 빈 문자열) */
  phone: string;
  message: string;
}

export interface Inquiry extends InquiryInput {
  id: string;
  read: boolean;
  createdAt: Timestamp | null;
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function addInquiry({ name, email, phone, message }: InquiryInput): Promise<void> {
  await addDoc(collection(db, COLLECTION), {
    name: name.trim().slice(0, INQUIRY_LIMITS.name),
    email: email.trim().slice(0, INQUIRY_LIMITS.email),
    phone: phone.trim().slice(0, INQUIRY_LIMITS.phone),
    message: message.trim().slice(0, INQUIRY_LIMITS.message),
    read: false,
    createdAt: serverTimestamp(),
  });
}

/** 관리자 전용: 실시간 구독 (최신순) */
export function subscribeInquiries(cb: (list: Inquiry[]) => void, onError?: (e: Error) => void) {
  const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"), limit(300));
  return onSnapshot(
    q,
    (snap) =>
      cb(
        snap.docs.map((d) => {
          const data = d.data({ serverTimestamps: "estimate" });
          return {
            id: d.id,
            name: data.name ?? "",
            email: data.email ?? "",
            phone: data.phone ?? "",
            message: data.message ?? "",
            read: !!data.read,
            createdAt: (data.createdAt as Timestamp) ?? null,
          };
        })
      ),
    onError
  );
}

export async function setInquiryRead(id: string, read: boolean): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { read });
}

export async function deleteInquiry(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}
