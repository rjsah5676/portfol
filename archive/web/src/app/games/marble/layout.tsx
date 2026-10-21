import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/marble.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = {
  ...pageMeta({
    title: "다이스 타운 (DICE TOWN) - 웹 보드게임 · 부루마블 스타일",
    description:
      "주사위를 굴려 동네를 돌며 땅을 사고 짓고 인수하는 웹 보드게임. 픽셀파이트와 같은 세계관의 캐릭터 스킬 · 장착 아이템 · 맵 3종(해피 타운 · 크로스 익스프레스 · 오르골 정원), 최대 4명 · AI 대전.",
    path: "/games/marble/",
  }),
  // 아이폰 「홈 화면에 추가」 → 주소창 없는 전체화면 앱 (iOS 사파리는 요소 전체화면 API 가 없음)
  manifest: "/marble/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent" as const,
    title: "다이스 타운",
  },
  icons: { apple: "/marble/apple-touch-icon.png" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
