import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "스케치 퀴즈",
  description:
    "최대 8명이 함께하는 실시간 그림 맞히기 게임. 한 명이 제시어를 그리고 나머지가 맞혀요. 비밀번호 방, 초대 링크, 힌트 지원.",
  path: "/games/sketch/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
