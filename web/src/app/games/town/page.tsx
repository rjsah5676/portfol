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
          desc="마을을 돌아다니다 게임방에 들어가는 캐릭터 보드게임 · 빈자리는 봇이 채워 줘요"
          tags={["원카드", "보드게임 마을", "봇 대전", "무료 카드게임"]}
        />
      </div>
      <Faded>
        <TownApp />
      </Faded>
    </>
  );
}
