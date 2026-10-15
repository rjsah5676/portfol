import { api } from "@/lib/api/http";
import type { MailAdminRow, MailItem } from "@/lib/mail";

/** 우편 API (server/src/http/mail.ts) */
export const getMail = () =>
  api<{ list: MailItem[]; unread: number }>("/api/mail", { auth: true });

export const getMailUnread = () =>
  api<{ unread: number }>("/api/mail/unread", { auth: true });

export const claimMail = (id: string) =>
  api<{ reward: number; count: number; points: number }>(
    `/api/mail/${encodeURIComponent(id)}/claim`,
    { method: "POST", auth: true },
  );

export const claimAllMail = () =>
  api<{ reward: number; count: number; points: number }>(
    "/api/mail/claim-all",
    { method: "POST", auth: true },
  );

/* 관리자 */
export const adminMailList = () =>
  api<{ list: MailAdminRow[] }>("/api/admin/mail", { auth: true });

export const adminSendMail = (body: {
  to: "*" | string[];
  title: string;
  body: string;
  points: number;
  days: number;
}) =>
  api<{ id: string; to: number | "*" }>("/api/admin/mail", {
    method: "POST",
    auth: true,
    body,
  });

export const adminRemoveMail = (id: string) =>
  api(`/api/admin/mail/${encodeURIComponent(id)}`, {
    method: "DELETE",
    auth: true,
  });
