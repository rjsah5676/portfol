import type { ReactNode } from "react";
import AdminGate from "@/components/Admin/AdminGate";

// 2026-11-05 메뉴에서 내림 — 관리자 「내린 게임」 탭에서만 들어감 (page.tsx noindex + AdminGate)
export default function Layout({ children }: { children: ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
