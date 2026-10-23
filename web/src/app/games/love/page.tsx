"use client";

import LoveApp from "@/components/Love/LoveApp";
import Stage from "@/components/Love/Stage";

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-0 pt-4 pb-16 sm:px-4">
      {/* 무대: 전체화면 띠 · 폰 가로 안내 · 공용 로딩 화면 (다른 게임과 같은 방식) */}
      <Stage>
        <LoveApp />
      </Stage>
      <p className="mt-3 px-3 text-center text-xs text-neutral-500">
        클릭/스페이스 = 다음 · Ctrl 누르는 동안 스킵 · 휠 위 = 지난 대사 · 우클릭 = 대사창 숨기기 · 저장은 이 브라우저에만 남아요
      </p>
    </div>
  );
}
