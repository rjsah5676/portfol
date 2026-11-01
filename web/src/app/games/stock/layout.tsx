import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/stock.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "애니메 차트 (ANIME CHART) - 주식게임 · 웹 주식게임 · 모의 투자 대전",
  description:
    "무료 웹 주식게임 애니메 차트. 차트 하나로 50턴 동안 사고팔아 돈을 불리는 솔로 모드, 10배 레버리지 코인 거래소, 친구 · 봇과 7분 동안 10개 종목을 사고파는 실시간 대전, 번 돈으로 집을 사는 마을까지. PC · 모바일 가로 화면 지원, 실제 돈이 오가지 않는 게임이에요.",
  path: "/games/stock/",
  keywords: ["주식게임", "웹 주식게임", "주식 게임", "모의 투자 게임", "차트 게임", "코인 게임", "주식 대전", "무료 주식 게임"],
  // 아트(마을 · 메뉴 그림 · 대표 이미지)가 들어오기 전까지는 검색에 안 내보냄 — 출시 때 지우고 sitemap.ts · navMenu.ts 에 추가
  noindex: true,
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
