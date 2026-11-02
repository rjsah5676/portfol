import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/gmtown.css";

// page.tsx 가 "use client" 라 metadata 는 여기서
export const metadata = pageMeta({
  title: "GMTOWN - gunmo.my 마을 광장",
  description: "gunmo.my 의 게임들이 모인 마을. 리듬업 · 파이트 · 포커 · 디펜스 · 올인 러브 · 용의자 · 증권거래소 건물을 걸어 다니며 들어가고, 같은 채널 사람들과 만나서 이야기해요.",
  path: "/gmtown/",
  // 만드는 중 — 메뉴 · 검색에서 숨김 (공개할 때 지우고 sitemap.ts 에 추가)
  noindex: true,
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
