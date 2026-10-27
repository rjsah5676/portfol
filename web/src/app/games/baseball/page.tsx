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
          title="픽셀 프로야구"
          en="PIXEL 프로야구 · 웹 야구게임"
          badge="ALPHA"
          accent="#FF8A3D"
          desc="타이밍 한 방 — 친구들과 같이 크는 야구"
          tags={["야구게임", "웹게임", "홈런더비"]}
        />
        <Stage>
          <BaseballApp />
        </Stage>
        <p className="mt-3 text-center font-['Nanum_Gothic',sans-serif] text-[12.5px] text-white/45">
          알파 · 베타 단계라 육성 · 구단 · 기록 데이터는 언제든 초기화될 수 있어요.
        </p>
      </div>
    </Faded>
  );
}
