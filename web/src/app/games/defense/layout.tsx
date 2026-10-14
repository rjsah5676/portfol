import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/defense.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = {
  ...pageMeta({
    title: "픽셀 운빨 디펜스 (PIXEL LUCKY DEFENSE) - 웹 디펜스 게임",
    description:
      "픽셀 세계를 갉아먹는 글리치를 막는 랜덤 디펜스. 기사단 · 기계공방 · 마도회 수호자를 소환 · 합성해 60웨이브를 버티세요. 랭킹 · 멀티 지원 (베타).",
    path: "/games/defense/",
  }),
  // 아이폰 「홈 화면에 추가」 → 주소창 없는 전체화면 앱 (iOS 사파리는 요소 전체화면 API 가 없음)
  manifest: "/defense/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent" as const,
    title: "픽셀 디펜스",
  },
  icons: { apple: "/defense/ui/apple-touch-icon.png" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
