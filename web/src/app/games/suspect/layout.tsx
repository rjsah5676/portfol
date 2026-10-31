import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "오늘의 용의자 - 하루 한 판 추리 퍼즐 (데일리 논리 퍼즐 · 랭킹)",
  description:
    "단서만으로 20명 중 범인을 가려내는 무료 데일리 추리 퍼즐. 매일 새 사건, 쉬움부터 지옥까지 4단계 난이도, 찍기 없이 논리로만 풀리는 판, 연필 메모, 2단계 힌트, 2분 입문 튜토리얼, 날마다 난이도별 랭킹.",
  path: "/games/suspect/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
