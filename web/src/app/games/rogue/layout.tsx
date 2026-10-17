import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "픽셀 생존기 - PIXEL FIGHT 외전 웹 로그라이크 (ALPHA)",
  description:
    "업데이트가 깨진 픽셀파이트 세계. 초기화되기 전에 글리치가 시작된 맨 아래까지 내려가는 아이작류 탑뷰 로그라이크. 아이템 37종 조합 · 4챕터 8층 · 숨겨진 방 · 치트 콘솔 · 랭킹 · 업적, 설치 없이 브라우저에서.",
  path: "/games/rogue/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
