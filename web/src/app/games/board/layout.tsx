import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "온라인 보드게임 — 체스·장기·오목",
  description:
    "체스·장기·오목을 한곳에서. 방을 만들어 친구와 두는 실시간 온라인 대국과 관전, 빠른 대국, 단계별 AI 대국과 AI 랭킹전. 체스 Stockfish, 장기 상차림, 오목 렌주룰 금수 지원.",
  path: "/games/board/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
