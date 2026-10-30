import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import AdminGate from "@/components/Admin/AdminGate";

// 2026-10-31 메뉴에서 내림 — 관리자 「내린 게임」 탭에서만 들어감 (noindex + AdminGate)
export const metadata = pageMeta({
  title: "픽셀 프로야구 - 웹 야구게임 · 선수 육성 (프로토)",
  description: "게임빌 프로야구 감성의 웹 야구게임 프로토타입. 타이밍 타격 · 게이지 투구 · 마구와 필살타법 · 돌발미션 · 홈런더비.",
  path: "/games/baseball/",
  noindex: true,
});

export default function Layout({ children }: { children: ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
