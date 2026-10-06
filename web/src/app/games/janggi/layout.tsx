import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "온라인 장기",
  description:
    "브라우저에서 두는 한국 장기. 방을 만들어 친구와 두는 실시간 온라인 대국과 장영실·이순신 등 위인 AI 대국(18급~5단, 상차림 선택), 관전·무르기·한수쉼, 모바일 터치 지원.",
  path: "/games/janggi/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
