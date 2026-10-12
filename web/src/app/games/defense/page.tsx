"use client";

import { useEffect, useState } from "react";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import DefenseApp, { RankList } from "@/components/Defense/DefenseApp";
import { fmtTime } from "@/components/Defense/ui";
import { getDefenseRank, type DefenseRankRow } from "@/realtime/defense";

const rows = (rs: DefenseRankRow[]) =>
  rs.map((r) => ({
    name: r.nick,
    member: true,
    avatar: r.avatar,
    value: r.win ? `CLEAR ${fmtTime(r.sec)}` : `W${r.wave}`,
    sub: <span>처치 {r.kills}</span>,
  }));

export default function DefensePage() {
  const [top, setTop] = useState<DefenseRankRow[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    getDefenseRank(3).then(
      (r) => setTop(r.rows),
      () => setTop([])
    );
  }, [open]);
  return (
    <Faded>
      <div className="mx-auto max-w-5xl px-3 pt-6 pb-24 sm:px-6">
        <GameHeader
          icon="👾"
          title="PIXEL LUCKY DEFENSE"
          en="PIXEL FIGHT 외전 · ALPHA"
          accent="#FF5CD6"
          desc="소환 · 합성으로 픽셀 세계를 지키는 랜덤 디펜스"
          tags={["운빨 디펜스", "랭킹모드", "멀티모드", "웹 디펜스 게임"]}
          rank={{
            sub: "최고 기록",
            open,
            onOpenChange: setOpen,
            top: rows(top ?? []),
            render: () => <RankList />,
          }}
        />
        <DefenseApp />
      </div>
    </Faded>
  );
}
