/**
 * 플레이 기록 보내기 (밸런스 분석용 — 관리자 「야구 플레이 데이터」에서 내려받음).
 * 브라우저마다 고정 id(pid)만 붙이고 개인정보는 안 보냄. 실패해도 게임엔 영향 없음 (보내고 잊음).
 *   서버: POST /api/baseball/log { pid, kind, v, data }
 */
import { API_URL } from "@/lib/api/config";

/** 기록 형식 판 (필드가 바뀌면 올림) */
export const LOG_V = 1;
const PID_KEY = "pxb:pid";

function pid(): string {
  try {
    let v = localStorage.getItem(PID_KEY);
    if (!v) {
      v = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[b % 62]).join("");
      localStorage.setItem(PID_KEY, v);
    }
    return v;
  } catch {
    return "anonymous0";
  }
}

export function logPlay(kind: string, data: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ pid: pid(), kind, v: LOG_V, data });
    if (body.length > 8000) return;
    // 로그인했으면 토큰도 (회원 구분 · 관리자 기록은 서버가 버림)
    void (async () => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const { auth } = await import("@/firebase");
        const token = await auth.currentUser?.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch {}
      await fetch(`${API_URL}/api/baseball/log`, { method: "POST", headers, body, keepalive: true }).catch(() => {});
    })();
  } catch {}
}
