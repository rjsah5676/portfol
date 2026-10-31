import type { Metadata } from "next";
import HangulApp from "@/components/Hangul/HangulApp";
import "@/css/hangul.css";

/*
 * 니들이 한글을 알아? — 프로토 (메뉴에는 아직 안 넣음 · 검색 제외)
 * 문장 판정은 서버의 형태소 분석기: server 에서 `npm run kiwi:model` 로 모델을 받아 둬야 함
 */
export const metadata: Metadata = {
  title: "니들이 한글을 알아? (프로토)",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col items-center px-3 pt-6 pb-16 sm:px-6">
      <HangulApp />
    </div>
  );
}
