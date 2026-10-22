"use client";

import { useEffect, useState } from "react";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import PatrolApp from "@/components/Patrol/PatrolApp";
import { PATROL_GUIDE } from "@/data/gameGuides";
import { stName } from "@/lib/patrol/chapters";
import { patrol, type PatrolRankRow } from "@/realtime/patrol";

export default function PatrolPage() {
  const [top, setTop] = useState<PatrolRankRow[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    patrol.rank(50).then(setTop, () => setTop([]));
  }, [open]);
  const rows = (top ?? []).map((r) => ({
    name: r.nick,
    member: true,
    avatar: r.avatar,
    value: `${stName(r.st)} 클리어`,
    sub: (
      <span>
        ★ {r.stars} · 전투력 {r.power.toLocaleString()}
      </span>
    ),
  }));
  return (
    <Faded>
      <div className="mx-auto max-w-[1076px] px-3 pt-6 pb-24 sm:px-6">
        <GameHeader
          icon="px:patrol"
          title="PIXEL PATROL"
          en="픽셀 순찰대 · ALPHA"
          accent="#FFB03A"
          desc="스테이지를 밀고, 장비를 뽑아 키워서 다시 도전하는 뱀서라이크"
          tags={["뱀서라이크", "스테이지", "장비 뽑기", "웹게임", "랭킹"]}
          ach="patrol"
          guide={PATROL_GUIDE}
          rank={{
            sub: "깬 스테이지 → 별 합 → 먼저 도달한 순",
            open,
            onOpenChange: setOpen,
            top: rows.slice(0, 3),
            render: () => (
              <ol className="flex flex-col gap-1.5 text-sm">
                {rows.map((r, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
                    <b className="w-6 text-center">{i + 1}</b>
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="font-bold text-[#ffb03a]">{r.value}</span>
                    <span className="text-xs text-white/50">{r.sub}</span>
                  </li>
                ))}
                {top && !rows.length && <li className="text-white/60">아직 기록이 없어요 — 첫 스테이지를 깨고 1등이 돼 보세요</li>}
                {!top && <li className="text-white/60">불러오는 중…</li>}
              </ol>
            ),
          }}
        />
        <PatrolApp />
      </div>
    </Faded>
  );
}
