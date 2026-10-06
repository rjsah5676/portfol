import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "프로젝트",
  description: "MIMYO, AirBoard, KickEat, Oh! Sori 등 이건모가 참여한 팀·개인 프로젝트 목록과 사용 기술.",
  path: "/project/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
