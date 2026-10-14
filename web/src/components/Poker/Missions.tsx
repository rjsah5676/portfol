"use client";

import { DailyMissionList } from "@/components/Points/DailyMissions";
import Sheet from "./Sheet";

/** 포커 일일 미션 (로비 위 「미션」 버튼) — 전체화면 게임 안에서 하나씩 · 모두 받기 (GP) */
export default function Missions({ mobile, maxH, onClose }: { mobile: boolean; maxH: number; onClose: () => void }) {
  return (
    <Sheet mobile={mobile} maxH={Math.min(maxH, 460)} wide={480} fill onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col">
        {/* 머리: 오른쪽 위 닫기(X) 자리를 비워 둠 */}
        <div className="flex h-[48px] shrink-0 items-center border-b border-white/10 pr-[52px] pl-[1em]">
          <span className="pk-frame-title">오늘의 미션</span>
        </div>
        <div className="pk-scroll min-h-0 flex-1 overflow-y-auto p-[0.8em]" data-sheet-scroll>
          <DailyMissionList game="poker" accent="#d6af5c" />
        </div>
      </div>
    </Sheet>
  );
}
