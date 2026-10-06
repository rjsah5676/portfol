import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({ title: "관리자", path: "/admin/", noindex: true });

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
