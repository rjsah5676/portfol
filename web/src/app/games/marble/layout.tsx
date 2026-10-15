import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/marble.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = {
  ...pageMeta({
    title: "픽셀 마블 (PIXEL MARBLE) - 웹 보드게임 · 부루마블 스타일",
    description:
      "주사위를 굴려 픽셀 동네를 돌며 땅을 사고 짓고 인수하는 웹 보드게임. 픽셀파이트 캐릭터 스킬 · 장착 아이템 · 맵 3종(픽셀 타운 · 크로스로드 · 오르골 정원), 1:1 · 최대 4명 · AI 대전.",
    path: "/games/marble/",
  }),
  // 아이폰 「홈 화면에 추가」 → 주소창 없는 전체화면 앱 (iOS 사파리는 요소 전체화면 API 가 없음)
  manifest: "/marble/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent" as const,
    title: "픽셀 마블",
  },
  icons: { apple: "/marble/apple-touch-icon.png" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
