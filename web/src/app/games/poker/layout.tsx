import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/poker.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "포커 (홀덤 · 7포커)",
  description:
    "회원이 되면 게임 머니 1억 원. 텍사스 홀덤과 7포커를 같은 돈으로, 성격이 다른 봇 네 명 또는 친구와 실시간으로 칩니다. 판돈 3단계, 자금 순위.",
  path: "/games/poker/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
