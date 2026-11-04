"use client";

import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import GMTownApp from "@/components/GMTown/GMTownApp";

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-5xl px-3 pt-6 sm:px-6">
        <GameHeader
          icon="🏘️"
          title="ANIME TOWN"
          en="Web 3D Playground"
          accent="#F2C14E"
          desc="웹 3D 실험용 놀이터 — 3D 캐릭터로 마을을 걷고, 건물에 들어가 게임하고, 같은 채널 사람들과 이야기해요"
          tags={["3D 마을", "실시간 채널", "순간이동 지도", "실험 중"]}
          badge="ALPHA"
        />
      </div>
      <Faded>
        <GMTownApp />
      </Faded>
    </>
  );
}
