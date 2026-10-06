import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "방명록",
  description: "Gunmo's Dev Life 방명록. 자유롭게 한마디 남겨주세요.",
  path: "/guest/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
