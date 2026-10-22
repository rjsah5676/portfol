import { api } from "@/lib/api/http";
import type { ReportReason, ReportRow, UserCard } from "@/lib/social";

/** 정보보기 · 신고 API (server/src/http/social.ts). 친구 · 메시지는 lib/socialStore (실시간) */
export const getUserCard = (nick: string) =>
  api<UserCard>(`/api/users/${encodeURIComponent(nick)}/card`, { auth: true });

export const sendReport = (body: {
  nick: string;
  reason: ReportReason;
  text: string;
  where: string;
}) => api<{ id: string }>("/api/reports", { method: "POST", body, auth: true });

/* 관리자 */
export const adminReports = (status: "open" | "done" | "all") =>
  api<{ list: ReportRow[]; open: number }>(`/api/admin/reports?status=${status}`, { auth: true });

export const adminSetReport = (id: string, body: { status?: "open" | "done"; note?: string }) =>
  api(`/api/admin/reports/${encodeURIComponent(id)}`, {
    method: "POST",
    body,
    auth: true,
  });
