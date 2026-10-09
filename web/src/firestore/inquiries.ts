import { withCaptcha } from "@/lib/captcha";
import { api } from "@/lib/api/http";
import { subscribe } from "@/lib/api/socket";
import { toTimestamp, type Timestamp } from "@/lib/api/timestamp";

// 방문자 문의 (플로팅 버튼 → 문의하기). 쓰기는 누구나, 조회·수정·삭제는 관리자만 (서버에서 검사)

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
  /** 로그인한 채로 남겼으면 회원 uid · 별명 */
  uid: string | null;
  nick: string | null;
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function addInquiry({ name, email, phone, message }: InquiryInput): Promise<void> {
  // 익명이면 사람 확인을 거칠 수 있음
  await withCaptcha((headers) =>
    api("/api/inquiries", {
      method: "POST",
      // 로그인한 상태면 토큰을 같이 보내서 누구인지 남김 (안 했으면 그냥 익명)
      auth: true,
      headers,
      body: {
        name: name.trim().slice(0, INQUIRY_LIMITS.name),
        email: email.trim().slice(0, INQUIRY_LIMITS.email),
        phone: phone.trim().slice(0, INQUIRY_LIMITS.phone),
        message: message.trim().slice(0, INQUIRY_LIMITS.message),
      },
    })
  );
}

interface Row extends InquiryInput {
  id: string;
  read: boolean;
  createdAt: number | null;
  uid?: string | null;
  nick?: string | null;
}
/** 서버가 보내는 목록 (s = 조회 순번, 클수록 최신) */
interface Snapshot {
  s: number;
  list: Row[];
}

/** 관리자 전용: 실시간 구독 (최신순) */
export function subscribeInquiries(cb: (list: Inquiry[]) => void, onError?: (e: Error) => void) {
  let last = 0;
  const apply = (snap: Snapshot) => {
    if (snap.s < last) return;
    last = snap.s;
    cb(
      snap.list.map((d) => ({
        id: d.id,
        name: d.name ?? "",
        email: d.email ?? "",
        phone: d.phone ?? "",
        message: d.message ?? "",
        read: !!d.read,
        createdAt: toTimestamp(d.createdAt),
        uid: d.uid ?? null,
        nick: d.nick ?? null,
      }))
    );
  };
  return subscribe<Snapshot>("inquiries", null, {
    onSnapshot: apply,
    onEvent: (type, data) => {
      if (type === "list") apply(data as Snapshot);
    },
    onError,
  });
}

export async function setInquiryRead(id: string, read: boolean): Promise<void> {
  await api(`/api/inquiries/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { read },
    auth: true,
  });
}

export async function deleteInquiry(id: string): Promise<void> {
  await api(`/api/inquiries/${encodeURIComponent(id)}`, { method: "DELETE", auth: true });
}
