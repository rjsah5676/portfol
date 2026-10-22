import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import AdminGate from "@/components/Admin/AdminGate";
import "@/css/survivor.css";
import "@/css/patrol.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "픽셀 순찰대 (PIXEL PATROL) - 웹 뱀서라이크",
  description: "밤의 픽셀 타운을 지키는 순찰대. 스테이지를 밀며 보스를 쓰러뜨리고, 장비 상자 · 합성 · 강화로 더 강해지는 웹 뱀서라이크 (알파).",
  path: "/games/patrol/",
  noindex: true,
});

export default function Layout({ children }: { children: ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
