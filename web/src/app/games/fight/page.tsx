"use client";

import { useState, type ReactNode } from "react";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import FightGame from "@/components/Fight/FightGame";
import { FIGHT_GUIDE } from "@/data/gameGuides";
import { RankBoard, useAIRankTop } from "@/components/AIRank";
import type { AIRankRow } from "@/firestore/aiRankings";
import { AI_LEVELS } from "@/lib/fight/ai";
import { pointsOf } from "@/lib/aiScore";
import { CHARS } from "@/lib/fight/chars";

/** 기록의 상대 표기: "3" 또는 "3:kai>igna" (AI 단계:내 캐릭터>상대 캐릭터) → "AI 3단계 고수 · **카이** vs 이그나" */
const oppLabel = (opp: string): ReactNode => {
  const [lv, pair] = opp.split(":");
  const i = Number(lv) - 1;
  const base = AI_LEVELS[i] ? `AI ${i + 1}단계 ${AI_LEVELS[i].name}` : opp;
  if (!pair) return `vs ${base}`;
  const [me, foe] = pair.split(">").map((id) => CHARS.find((c) => c.id === id)?.name ?? id);
  return (
    <>
      {base} · <b className="font-bold text-white/75">{me}</b> vs {foe}
    </>
  );
};

const topRows = (rows: AIRankRow[]) =>
  rows.map((r) => ({
    name: r.name,
    member: r.member,
    avatar: r.avatar,
    value: pointsOf(r.score).toLocaleString(),
    sub: oppLabel(r.opp),
  }));

/** 랭킹 나누기: 전체(사람마다 가장 좋은 기록 하나) · 내 캐릭터별 */
function ChTabs({ ch, setCh }: { ch: string; setCh: (c: string) => void }) {
  const tabs = [{ id: "", name: "전체" }, ...CHARS.map((c) => ({ id: c.id, name: c.name }))];
  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setCh(t.id)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${
              ch === t.id
                ? "border-[#FF8A3D] bg-[#FF8A3D] font-bold text-[#2A0E3A]"
                : "border-white/10 bg-white/[0.03] text-white/60 hover:border-[#FF8A3D]/50 hover:text-white"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-white/35">
        {ch ? "그 캐릭터로 이긴 기록 — 한 사람당 하나" : "모든 캐릭터 — 한 사람당 가장 좋은 기록 하나"}
      </p>
    </div>
  );
}

export default function FightPage() {
  const top = useAIRankTop("fight_ai_rankings");
  const [ch, setCh] = useState("");
  const chTop = useAIRankTop("fight_ai_rankings", ch || undefined);
  const [refresh, setRefresh] = useState(0);
  return (
    <Faded>
      <div className="mx-auto max-w-5xl px-3 pt-6 pb-24 sm:px-6">
        <GameHeader
          icon="🥊"
          title="픽셀 격투"
          en="Pixel Fighter"
          accent="#FF8A3D"
          desc="도트 캐릭터 6명의 1:1 플랫폼 대전 — AI, 한 키보드 2인, 온라인"
          guide={FIGHT_GUIDE}
          rank={{
            sub: "AI 대전",
            top: topRows(top),
            podium: ch ? topRows(chTop) : null,
            head: () => <ChTabs ch={ch} setCh={setCh} />,
            render: () => (
              <RankBoard
                coll="fight_ai_rankings"
                oppLabel={oppLabel}
                vs={false}
                bare
                skip={3}
                refresh={refresh}
                ch={ch || undefined}
              />
            ),
          }}
        />
        <FightGame onRanked={() => setRefresh((n) => n + 1)} />
      </div>
    </Faded>
  );
}
