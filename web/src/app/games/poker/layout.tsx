import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/poker.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = {
  ...pageMeta({
    title: "애니메 포커 (ANIME POKER)",
    description:
      "무료로 온라인 플레이하는 애니풍 포커. 마음에 드는 캐릭터를 골라 텍사스 홀덤과 7포커를 실시간으로 즐겨 보세요. PC · 모바일 지원, 실제 돈이 오가지 않는 무료 게임이에요.",
    path: "/games/poker/",
  }),
  manifest: "/poker/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent" as const, title: "ANIME POKER" },
  icons: { apple: "/poker/ui/apple-touch-icon.png" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
