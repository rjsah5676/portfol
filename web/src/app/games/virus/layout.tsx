import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"를 쓰는 컴포넌트라 metadata는 layout에서 지정
export const metadata = pageMeta({
  title: "바이러스 키우기",
  description:
    "내 컴퓨터 바이러스로 파일을 감염시켜 데이터를 훔치고, 네트워크를 장악한 전설의 바이러스를 격퇴해 코드를 빼앗는 방치형 게임.",
  path: "/games/virus/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
