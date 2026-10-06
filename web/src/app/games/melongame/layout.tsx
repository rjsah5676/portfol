import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "멜론 게임",
  description:
    "드래그해서 합이 10 또는 20이 되도록 멜론을 없애는 2분 타임어택 퍼즐 게임. 랭킹 등록 지원.",
  path: "/games/melongame/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
