import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import AdminGate from "@/components/Admin/AdminGate";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "PIXEL RESET STORY (픽셀 리셋 스토리) - PIXEL FIGHT 외전 웹 로그라이크 (ALPHA)",
  description:
    "업데이트가 깨진 픽셀파이트 세계. 초기화되기 전에, 글리치가 시작된 맨 아래까지 내려가자. 아이템 229종 조합 · 소환수 · 세트 변신 · 시크릿 62개로 아이템 · 캐릭터 해금 · 파이터 5명 · 5월드 10층 · 특수방 8종 · 엘리트 몬스터 · 랭킹 · 업적, 설치 없이 브라우저에서 하는 탑뷰 로그라이크.",
  path: "/games/rogue/",
  noindex: true,
});

export default function Layout({ children }: { children: ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
