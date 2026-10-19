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
          title="DOODLE PARTY"
          en="Drawing Party Game"
          accent="#FF6B6B"
          desc="그림 맞히기 · 가짜 화가 · 그림 릴레이, 최대 8명 그림 파티게임"
          tags={["최대 8명", "초대 링크", "캐치마인드류", "온라인 그림 게임"]}
          guide={SKETCH_GUIDE}
          ach="sketch"
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
