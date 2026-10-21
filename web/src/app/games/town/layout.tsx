import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/town.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = {
  ...pageMeta({
    title: "테이블 타운 (TABLE TOWN) - 캐릭터와 함께하는 온라인 보드게임 마을",
    description:
      "마을을 돌아다니다 게임방에 들어가 원카드 · 조커뽑기 · 윷놀이 · 체스 · 장기 · 오목을 즐기는 무료 웹 보드게임. 혼자 와도 빈자리는 개성 있는 캐릭터 봇이 채워 줘요. 설치 없이 PC · 모바일 지원.",
    path: "/games/town/",
  }),
  icons: { apple: "/town/ui/apple-touch-icon.png" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
