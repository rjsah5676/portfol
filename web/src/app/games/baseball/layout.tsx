import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// M1 프로토 — 메뉴에 안 걸고 검색에도 안 나오게
export const metadata = pageMeta({
  title: "픽셀 프로야구 - 웹 야구게임 · 선수 육성 (프로토)",
  description: "게임빌 프로야구 감성의 웹 야구게임 프로토타입. 타이밍 타격 · 게이지 투구 · 마구와 필살타법 · 돌발미션 · 홈런더비.",
  path: "/games/baseball/",
  noindex: true,
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
