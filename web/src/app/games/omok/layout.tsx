import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "온라인 오목",
  description:
    "브라우저에서 두는 오목. 렌주룰(흑 3-3·4-4·장목 금수)·일반룰·자유룰, 방을 만들어 친구와 두는 실시간 온라인 대국과 18급~5단 AI 대국·랭킹전, 관전·무르기·채팅, 모바일 터치 지원.",
  path: "/games/omok/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
