"use client";

import { useCallback, useEffect, useState } from "react";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import Nick from "@/components/Nick";
import RogueFrame from "@/components/Rogue/RogueFrame";
import { ROGUE_GUIDE } from "@/data/gameGuides";
import { ROGUE_CHAR_NAME, floorLabel, type RogueChar } from "@/lib/rogue/rules";
import { rogue, type RogueRankRow } from "@/realtime/rogue";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const recordOf = (r: RogueRankRow) =>
  r.win ? `${floorLabel(r.floor)} CLEAR · ${mmss(r.sec)}` : `${floorLabel(r.floor)}층`;
const charOf = (r: RogueRankRow) => ROGUE_CHAR_NAME[(r.char as RogueChar) in ROGUE_CHAR_NAME ? (r.char as RogueChar) : "kai"];
const buildOf = (r: RogueRankRow, n: number) =>
  r.build.slice(0, n).join(" · ") + (r.build.length > n ? ` 외 ${r.build.length - n}` : "");

export default function RoguePage() {
  const [top, setTop] = useState<RogueRankRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    rogue.rank(50).then(setTop, () => setTop([]));
  }, [open, tick]);
  const onFinish = useCallback(() => setTick((t) => t + 1), []);
  const rows = (top ?? []).map((r) => ({
    name: r.nick,
    member: true,
    avatar: r.avatar,
    value: recordOf(r),
    sub: (
      <span>
        {charOf(r)} · {buildOf(r, 3)}
      </span>
    ),
  }));
  return (
    <Faded>
      <div className="mx-auto max-w-[1200px] px-3 pt-6 pb-24 sm:px-6">
        <GameHeader
          icon="⚔️"
          title="PIXEL RESET STORY"
          en="픽셀 리셋 스토리 · PIXEL FIGHT 외전 · ALPHA"
          accent="#FF3D5E"
          desc="초기화되기 전에, 글리치가 시작된 맨 아래까지 내려가자"
          tags={["로그라이크", "아이템 조합", "캐릭터 해금", "웹게임", "랭킹"]}
          ach="rogue"
          guide={ROGUE_GUIDE}
          rank={{
            sub: "도달한 층 → 클리어 → (클리어면 빠른 순 · 아니면 처치 순)",
            open,
            onOpenChange: setOpen,
            top: rows.slice(0, 3),
            render: () => (
              <ol className="flex flex-col gap-1.5 text-sm">
                {top === null && <li className="text-white/50">불러오는 중…</li>}
                {top?.length === 0 && (
                  <li className="text-white/50">
                    아직 기록이 없어요. 첫 기록의 주인공이 되어 보세요!
                  </li>
                )}
                {top?.map((r, i) => (
                  <li
                    key={r.nick + r.at}
                    className="flex items-baseline gap-3 rounded-lg bg-white/[0.03] px-3 py-2"
                  >
                    <span className="w-6 shrink-0 text-right font-mono text-white/50">{i + 1}</span>
                    <span className="w-28 shrink-0 truncate">
                      <Nick name={r.nick} guest={false} />
                    </span>
                    <span
                      className={`shrink-0 font-mono ${r.win ? "text-[#ffcf4a]" : "text-white/85"}`}
                    >
                      {recordOf(r)}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-xs text-white/45"
                      title={r.build.join(" · ")}
                    >
                      <span style={{ color: ({ igna: "#ff9a3c", ivan: "#ff6a4a", lily: "#5ec8ff", dice: "#c77dff" } as Record<string, string>)[r.char] ?? "#9fe8ff" }}>{charOf(r)}</span> ·{" "}
                      {buildOf(r, 8)} · 처치 {r.kills.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
            ),
          }}
        />
        <RogueFrame onFinish={onFinish} />
        <p className="mt-3 text-center text-xs break-keep text-white/40">
          게임 화면을 한 번 누르면 키보드가 먹혀요 · 회원(별명)으로 하면 랭킹 · 업적에 기록돼요 ·
          아직 ALPHA라 밸런스 · 그림이 바뀔 수 있어요
        </p>
      </div>
    </Faded>
  );
}
