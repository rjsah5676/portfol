"use client";

import LoveApp from "@/components/Love/LoveApp";

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-0 pt-4 sm:px-4">
      <LoveApp />
      <p className="mt-3 px-3 text-center text-xs text-neutral-500">
        M1 프로토 · 클릭/스페이스 = 다음 · Ctrl 누르는 동안 스킵 · 저장은 이 브라우저에만 남아요
      </p>
    </div>
  );
}
