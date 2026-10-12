import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/defense.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
// 알파 동안은 검색에 안 올림 (noindex) · 메뉴에도 아직 없음 — 정식 공개 때 navMenu.ts · sitemap.ts 에 추가
export const metadata = pageMeta({
  title: "글리치 디펜스 (GLITCH DEFENSE) - PIXEL FIGHT 외전 랜덤 디펜스",
  description:
    "픽셀 세계를 갉아먹는 글리치를 막는 랜덤 디펜스. 기사단 · 기계공방 · 마도회 수호자를 소환 · 합성해 60웨이브를 버티세요. 랭킹 · 멀티 지원 (알파).",
  path: "/games/defense/",
  noindex: true,
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
