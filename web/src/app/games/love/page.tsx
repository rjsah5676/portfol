"use client";

import GameHeader from "@/components/GameHeader";
import LoveApp from "@/components/Love/LoveApp";
import Stage from "@/components/Love/Stage";
import { LOVE_GUIDE } from "@/data/gameGuides";

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-0 pt-6 pb-16 sm:px-4">
      {/* 게임 위 헤더 (다른 게임과 같은 GameHeader) */}
      <div className="px-3 sm:px-0">
        <GameHeader
          icon="px:love"
          title="올인 러브"
          en="ANIME POKER 외전 · BETA 1.0"
          accent="#FF8FB1"
          desc="홀덤펍 딜러의 4주 — 풀 CG · 엔딩 18종 미연시"
          tags={["미연시", "비주얼노벨", "멀티엔딩", "무료 웹게임"]}
          guide={LOVE_GUIDE}
        />
      </div>
      {/* 무대: 전체화면 띠 · 폰 가로 안내 · 공용 로딩 화면 (다른 게임과 같은 방식) */}
      <Stage>
        <LoveApp />
      </Stage>
      <p className="mt-3 px-3 text-center text-xs text-neutral-500">
        클릭/스페이스 = 다음 · Ctrl 누르는 동안 스킵 · L = 지난 대사 · 우클릭 = 대사창 숨기기 · 저장은 이 브라우저에만 남아요
      </p>
    </div>
  );
}
