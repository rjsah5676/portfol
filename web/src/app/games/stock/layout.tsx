import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/stock.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "주식게임 - 무료 웹 주식게임 · 모의 투자 · 실시간 주식 대전",
  description:
    "무료 웹 주식게임. 1억으로 시작해 차트 하나를 50턴 동안 사고팔아 돈을 불리는 솔로 모드, 1 · 3 · 10배 레버리지 코인, 친구 · 봇과 7분 동안 10개 종목을 사고파는 실시간 대전, 총자산 · 주간 손익 순위까지. PC · 모바일 가로 화면 지원, 실제 돈이 오가지 않는 모의 투자 게임이에요.",
  path: "/games/stock/",
  keywords: ["주식게임", "웹 주식게임", "주식 게임", "모의 투자 게임", "차트 게임", "코인 게임", "주식 대전", "무료 주식 게임"],
  // 메인 그림 확인 전까지 메뉴 · 검색에서 숨김 — 공개할 때 지우고 sitemap.ts · navMenu.ts 되돌리기
  noindex: true,
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
