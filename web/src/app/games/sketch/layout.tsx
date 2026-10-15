import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/sketch.css";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "두들 파티 (DOODLE PARTY) - 온라인 그림 맞히기 · 파티게임",
  description:
    "설치 없이 브라우저에서 친구들과 하는 무료 그림 파티게임. 캐치마인드처럼 그림 맞히기, 한 명만 제시어를 모르는 가짜 화가, 엉뚱한 그림에 가짜 제목을 붙이는 그림 속 거짓말, 개르틱폰 같은 그림 릴레이까지 4가지 모드. 최대 8명, 초대 링크 · 비밀번호 방 · PC · 모바일 지원.",
  path: "/games/sketch/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
