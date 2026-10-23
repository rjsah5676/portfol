import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/love.css";

export const metadata = {
  ...pageMeta({
    title: "올인 러브 - ANIME POKER 외전 미연시",
    description:
      "홀덤펍 딜러의 4주. 연서 · 에이미 두 히로인, 이벤트 CG · 감정 음성 · 엔딩 18종의 ANIME POKER 외전 미연시. 설치 없이 브라우저에서 바로.",
    path: "/games/love/",
  }),
  // 앱 아이콘 (홈 화면 추가 · 탭 아이콘)
  icons: {
    icon: [{ url: "/love/ui/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/love/ui/apple-touch-icon.png",
  },
};

// 올인 러브 글꼴: 대사 · UI 프리텐다드, 서술 · 이름표 고운바탕 (CSS @import 대신 링크로 — React 가 head 로 올려 줌)
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        precedence="default"
      />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&display=swap"
        precedence="default"
      />
      {children}
    </>
  );
}
