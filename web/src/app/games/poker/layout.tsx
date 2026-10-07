import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/poker.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = {
  ...pageMeta({
    title: "ANIME POKER (홀덤 · 7포커)",
    description:
      "애니풍 캐릭터 5명 중 하나를 골라 텍사스 홀덤과 7포커를 다른 유저들과 실시간으로 즐기는 카드 게임. 판돈 3단계, 순위, 모바일 전체화면. 실제 돈이 오가지 않는 게임 점수로만 진행돼요.",
    path: "/games/poker/",
  }),
  manifest: "/poker/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent" as const, title: "ANIME POKER" },
  icons: { apple: "/poker/ui/apple-touch-icon.png" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
