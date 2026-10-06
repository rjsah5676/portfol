import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "픽셀 격투",
  description:
    "브라우저에서 하는 1:1 도트 플랫폼 격투게임. 캐릭터 5명·맵 2개, 발판·2단 점프·대시, 약 4단·발차기 2단·아이덴티티·필살기, AI 6단계 대전과 랭킹, 한 키보드 2인 대전, 게임패드·모바일 터치 지원.",
  path: "/games/fight/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
