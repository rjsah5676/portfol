"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import SketchApp from "@/components/Sketch/SketchApp";
import { SKETCH_GUIDE } from "@/data/gameGuides";

// 방은 ?room=ID(&k=초대키) 쿼리로 구분 (다른 온라인 게임들과 같은 방식)
function SketchPage() {
  const inRoom = !!useSearchParams().get("room");
  return (
    <>
      <div className="mx-auto max-w-5xl px-3 pt-6 sm:px-6">
        <GameHeader
          icon="🎨"
          title="스케치 퀴즈"
          en="Sketch Quiz"
          accent="#FF6B6B"
          desc="한 명이 그리고 나머지가 맞히는 실시간 그림 퀴즈"
          guide={SKETCH_GUIDE}
          scroll={!inRoom}
        />
      </div>
      <Faded>
        <SketchApp />
      </Faded>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SketchPage />
    </Suspense>
  );
}
