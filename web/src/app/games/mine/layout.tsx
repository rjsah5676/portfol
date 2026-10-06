import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "지뢰찾기",
  description: "지뢰 99개 고급 난이도 지뢰찾기. 모바일 꾹 누르기 지원, 클리어 기록 랭킹 등록.",
  path: "/games/mine/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
