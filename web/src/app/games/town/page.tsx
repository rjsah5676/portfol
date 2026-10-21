"use client";

import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import TownApp from "@/components/Town/TownApp";

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-5xl px-3 pt-6 sm:px-6">
        <GameHeader
          icon="🏘️"
          title="TABLE TOWN"
          en="Board Game Town"
          accent="#FFC94A"
          desc="친구 · 캐릭터 봇과 함께하는 온라인 원카드 · 빈자리는 봇이 채워 줘요"
          tags={["원카드", "온라인 원카드", "봇 대전", "무료 카드게임"]}
        />
      </div>
      <Faded>
        <TownApp />
      </Faded>
    </>
  );
}
