"use client";

import { useState } from "react";
import { AchievementList, useAchReady } from "@/components/Points/Achievements";
import { DailyMissionList, useDailyReady } from "@/components/Points/DailyMissions";
import Sheet from "./Sheet";

/** 포커 미션 창 (로비 위 「미션」 버튼) — 오늘의 미션 · 업적 탭, 전체화면 게임 안에서 하나씩 · 모두 받기 (GP) */
export default function Missions({ mobile, maxH, onClose }: { mobile: boolean; maxH: number; onClose: () => void }) {
  const [tab, setTab] = useState<"daily" | "ach">("daily");
  // 탭을 옮길 때 받을 수 있는 수를 다시 셈 (받고 나서 숫자가 줄게)
  const daily = useDailyReady("poker", tab);
  const ach = useAchReady("poker", tab);
  return (
    <Sheet mobile={mobile} maxH={Math.min(maxH, 560)} wide={520} fill onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col">
        {/* 머리: 탭 · 오른쪽 위 닫기(X) 자리를 비워 둠 */}
        <div className="flex h-[48px] shrink-0 items-center border-b border-white/10 pr-[52px] pl-[0.6em]">
          <div className="pk-seg w-full max-w-[20em]" role="tablist">
            {(
              [
                ["daily", "오늘의 미션", daily],
                ["ach", "업적", ach],
              ] as const
            ).map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
              >
                {label}
                {/* 받을 수 있는 수 (탭 틀이 넘치는 걸 잘라서 글자 옆에) */}
                {n > 0 && (
                  <span className="ml-[0.35em] rounded-full bg-[#ff4d5e] px-[0.45em] text-[0.85em] text-white">
                    {n > 9 ? "9+" : n}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div key={tab} className="pk-scroll min-h-0 flex-1 overflow-y-auto p-[0.8em]" data-sheet-scroll>
          {tab === "daily" ? (
            <DailyMissionList game="poker" accent="#d6af5c" />
          ) : (
            <AchievementList game="poker" accent="#d6af5c" dailyAt="옆 「오늘의 미션」 탭" />
          )}
        </div>
      </div>
    </Sheet>
  );
}
