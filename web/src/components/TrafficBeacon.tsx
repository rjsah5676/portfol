"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { API_URL } from "@/lib/api/config";

/*
 * 유입 분석: 페이지를 열거나 옮길 때마다 서버(/api/track)에 한 줄 남김.
 * 탭 하나 = 세션(sessionStorage). 세션의 첫 페이지에만 리퍼러 · UTM 을 같이 보냄.
 * 관리자 화면(/admin)은 보내지 않음. 기존 방문자 수(FooterWidgets)와는 따로 셈.
 */

const SID_KEY = "tv_sid";
const SEEN_KEY = "tv_seen";
const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;

function newSid(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 로그인 중이면 토큰 (회원 여부 표시용). Firebase 가 늦으면 기다리지 않음 */
async function bearer(): Promise<Record<string, string>> {
  try {
    const { auth } = await import("@/firebase");
    const ready = await Promise.race([
      auth.authStateReady().then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), 2500)),
    ]);
    const token = ready ? await auth.currentUser?.getIdToken() : undefined;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function session(): { sid: string; entry: boolean; returning: boolean } {
  let sid = "";
  let entry = false;
  let returning = false;
  try {
    sid = sessionStorage.getItem(SID_KEY) ?? "";
    if (!sid) {
      sid = newSid();
      entry = true;
      sessionStorage.setItem(SID_KEY, sid);
    }
  } catch {
    // 저장소가 막힌 환경 → 페이지마다 새 세션
    sid = newSid();
    entry = true;
  }
  try {
    returning = !!localStorage.getItem(SEEN_KEY);
    if (!returning) localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    // 모름 → 처음 온 것으로
  }
  return { sid, entry, returning };
}

export default function TrafficBeacon() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname === last.current || pathname.startsWith("/admin")) return;
    last.current = pathname;

    const { sid, entry, returning } = session();
    const body: Record<string, unknown> = {
      sid,
      path: pathname.slice(0, 300),
      entry,
      returning,
      screen: { w: Math.round(window.screen?.width ?? 0), h: Math.round(window.screen?.height ?? 0) },
      lang: (navigator.language ?? "").slice(0, 35),
      tz: (Intl.DateTimeFormat().resolvedOptions().timeZone ?? "").slice(0, 64),
    };
    if (entry) {
      if (document.referrer) body.ref = document.referrer.slice(0, 1000);
      const q = new URLSearchParams(window.location.search);
      const utm = Object.fromEntries(
        UTM_KEYS.map((k) => [k, q.get(`utm_${k}`)?.slice(0, 100)]).filter(([, v]) => v)
      );
      if (Object.keys(utm).length) body.utm = utm;
    }

    void bearer().then((auth) =>
      fetch(`${API_URL}/api/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => undefined)
    );
  }, [pathname]);

  return null;
}
