import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "반응속도 테스트",
  description: "버튼이 파란색으로 바뀌는 순간 클릭! 5회 평균으로 측정하는 반응속도 테스트와 랭킹.",
  path: "/games/rspeed/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
