import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "온라인 체스",
  description:
    "방을 만들어 친구와 두는 실시간 온라인 체스와 AI 대국(레이팅 400~2400, Stockfish). 제한 시간·선후공 선택, 무르기, 관전 지원.",
  path: "/games/chess/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
