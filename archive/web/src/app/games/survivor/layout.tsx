import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/survivor.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "픽셀 타운 서바이버 (PIXEL TOWN SURVIVOR) - 웹 뱀서라이크",
  description: "밤이 된 픽셀 타운에 몰려드는 몬스터를 10분 동안 버텨라. 레벨업 카드 · 무기 합체 · 보물 상자 · 필살기로 새벽 보스를 쓰러뜨리는 웹 뱀서라이크 (베타).",
  path: "/games/survivor/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
