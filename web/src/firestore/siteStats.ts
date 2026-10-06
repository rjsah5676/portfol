import { api } from "@/lib/api/http";

export interface VisitorStats {
  today: number;
  total: number;
}

// 방문 기록: 누적(total)과 그날(daily_YYYY-MM-DD) 카운터를 +1
export async function recordVisit(dateKey: string): Promise<void> {
  await api("/api/stats/visit", { method: "POST", body: { dateKey } });
}

export async function getVisitorStats(dateKey: string): Promise<VisitorStats> {
  return api<VisitorStats>(`/api/stats?date=${encodeURIComponent(dateKey)}`);
}
