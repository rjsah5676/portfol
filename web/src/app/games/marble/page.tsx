"use client";

import { useEffect, useState } from "react";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import MarbleApp from "@/components/Marble/MarbleApp";
import { MARBLE_GUIDE } from "@/data/gameGuides";
import { marble, type RankRow } from "@/realtime/marble";

export default function MarblePage() {
  const [top, setTop] = useState<RankRow[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    marble.rank().then(setTop, () => setTop([]));
  }, [open]);
  const rows = (top ?? []).map((r) => ({
    name: r.nick,
    member: true,
    avatar: r.avatar,
    value: `${r.wins}승`,
    sub: <span>{r.games}판 · 승률 {r.games ? Math.round((r.wins / r.games) * 100) : 0}%</span>,
  }));
  return (
    <Faded>
      <div className="mx-auto max-w-[1076px] px-3 pt-6 pb-24 sm:px-6">
        <GameHeader
          icon="🎲"
          title="DICE TOWN"
          en="PIXEL FIGHT 세계관 · BETA"
          accent="#FFC94A"
          desc="주사위를 굴려 땅을 사고 짓고 인수하는 보드게임"
          tags={["보드게임", "부루마블 스타일", "최대 4명", "AI 대전", "웹 보드게임"]}
          ach="marble"
          guide={MARBLE_GUIDE}
          rank={{
            sub: "승리 순",
            open,
            onOpenChange: setOpen,
            top: rows.slice(0, 3),
            render: () => (
              <ol className="flex flex-col gap-1.5 text-sm">
                {rows.map((r, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
                    <b className="w-6 text-center">{i + 1}</b>
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="font-bold">{r.value}</span>
                    <span className="text-xs text-white/50">{r.sub}</span>
                  </li>
                ))}
                {!rows.length && <li className="text-white/60">아직 기록이 없어요</li>}
              </ol>
            ),
          }}
        />
        <MarbleApp />
      </div>
    </Faded>
  );
}
