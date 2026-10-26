"use client";

import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import BaseballApp from "@/components/Baseball/BaseballApp";
import Stage from "@/components/Baseball/Stage";

export default function BaseballPage() {
  return (
    <Faded>
      <div className="mx-auto max-w-[1280px] px-3 pt-6 pb-24 sm:px-6">
        <GameHeader
          icon="⚾"
          title="PIXEL BASEBALL"
          en="픽셀 베이스볼 · 가제 · M1 PROTO"
          accent="#FF8A3D"
          desc="타이밍 한 방, 마구 한 방 — 픽셀파이트 마선수들이 뛰는 야구"
          tags={["야구게임", "웹게임", "홈런더비"]}
        />
        <Stage>
          <BaseballApp />
        </Stage>
      </div>
    </Faded>
  );
}
