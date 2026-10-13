import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/defense.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "픽셀 운빨 디펜스 (PIXEL LUCKY DEFENSE) - 웹 디펜스 게임",
  description:
    "픽셀 세계를 갉아먹는 글리치를 막는 랜덤 디펜스. 기사단 · 기계공방 · 마도회 수호자를 소환 · 합성해 60웨이브를 버티세요. 랭킹 · 멀티 지원 (베타).",
  path: "/games/defense/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
