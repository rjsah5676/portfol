import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/town.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = {
  ...pageMeta({
    title: "테이블 타운 (TABLE TOWN) - 캐릭터와 함께하는 온라인 원카드",
    description:
      "친구나 캐릭터 봇과 함께하는 무료 온라인 원카드. 혼자 와도 빈자리는 봇이 채워 줘요. 설치 없이 PC · 모바일 지원.",
    path: "/games/town/",
  }),
  // 아이폰 「홈 화면에 추가」 → 주소창 없는 전체화면 앱 (iOS 사파리는 요소 전체화면 API 가 없음) · 안드로이드는 「앱으로 설치」
  manifest: "/town/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent" as const,
    title: "테이블 타운",
  },
  icons: { apple: "/town/app/apple-touch-icon.png" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
