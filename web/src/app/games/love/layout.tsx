import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/love.css";

// M1 프로토: 메뉴 · 검색에 노출 안 함 (주소로만 접속)
export const metadata = pageMeta({
  title: "올인 러브 (가제) - ANIME POKER 외전 미연시 프로토",
  description: "홀덤펍을 배경으로 한 ANIME POKER 외전 미연시 프로토타입.",
  path: "/games/love/",
  noindex: true,
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
