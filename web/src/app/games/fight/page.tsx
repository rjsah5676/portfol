"use client";

import { useState, type ReactNode } from "react";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import FightGame from "@/components/Fight/FightGame";
import { FIGHT_GUIDE } from "@/data/gameGuides";
import { RankBoard, useAIRankTop } from "@/components/AIRank";
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

export default function FightPage() {
  const top = useAIRankTop("fight_ai_rankings");
  const [refresh, setRefresh] = useState(0);
  return (
    <Faded>
      <div className="mx-auto max-w-5xl px-3 pt-6 pb-24 sm:px-6">
        <GameHeader
          icon="🥊"
          title="픽셀 격투"
          en="Pixel Fighter"
          accent="#FF8A3D"
          desc="도트 캐릭터 5명의 1:1 플랫폼 대전 — AI, 한 키보드 2인, 온라인"
          guide={FIGHT_GUIDE}
          rank={{
            sub: "AI 대전",
            top: top.map((r) => ({
              name: r.name,
              value: pointsOf(r.score).toLocaleString(),
              sub: oppLabel(r.opp),
            })),
            render: () => (
              <RankBoard
                coll="fight_ai_rankings"
                oppLabel={oppLabel}
                vs={false}
                bare
                skip={3}
                refresh={refresh}
              />
            ),
          }}
        />
        <FightGame onRanked={() => setRefresh((n) => n + 1)} />
      </div>
    </Faded>
  );
}
