"use client";

import { useEffect, useState } from "react";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import SurvivorApp from "@/components/Survivor/SurvivorApp";
import { SURVIVOR_GUIDE } from "@/data/gameGuides";
import { HEROES } from "@/lib/survivor/data";
import { survivor, type SurvivorRankRow } from "@/realtime/survivor";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function SurvivorPage() {
  const [top, setTop] = useState<SurvivorRankRow[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    survivor.rank(50).then(setTop, () => setTop([]));
  }, [open]);
  const rows = (top ?? []).map((r) => ({
    name: r.nick,
    member: true,
    avatar: r.avatar,
    value: r.win ? "CLEAR" : mmss(r.sec),
    sub: (
      <span>
        {HEROES[r.hero]?.name ?? r.hero} · Lv{r.lv} · 처치 {r.kills.toLocaleString()}
      </span>
    ),
  }));
  return (
    <Faded>
      <div className="mx-auto max-w-[1076px] px-3 pt-6 pb-24 sm:px-6">
        <GameHeader
          icon="🌙"
          title="PIXEL TOWN SURVIVOR"
          en="DICE TOWN 외전 · BETA"
          accent="#FF4FA3"
          desc="밤의 픽셀 타운에서 새벽까지 버티는 뱀서라이크"
          tags={["뱀서라이크", "로그라이크", "웹게임", "랭킹"]}
          ach="survivor"
          guide={SURVIVOR_GUIDE}
          rank={{
            sub: "클리어 → 버틴 시간 → 처치 순",
            open,
            onOpenChange: setOpen,
            top: rows.slice(0, 3),
            render: () => (
              <ol className="flex flex-col gap-1.5 text-sm">
                {rows.map((r, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
                    <b className="w-6 text-center">{i + 1}</b>
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className={`font-bold ${r.value === "CLEAR" ? "text-[#4ff0c8]" : ""}`}>{r.value}</span>
                    <span className="text-xs text-white/50">{r.sub}</span>
                  </li>
                ))}
                {top && !rows.length && <li className="text-white/60">아직 기록이 없어요 — 첫 새벽의 주인공이 돼 보세요</li>}
                {!top && <li className="text-white/60">불러오는 중…</li>}
              </ol>
            ),
          }}
        />
        <SurvivorApp />
      </div>
    </Faded>
  );
}
