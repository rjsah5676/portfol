"use client";

import { useEffect, useState, type ReactNode } from "react";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import FightGame from "@/components/Fight/FightGame";
import { FIGHT_GUIDE } from "@/data/gameGuides";
import { RankBoard, useAIRankTop } from "@/components/AIRank";
import type { AIRankRow } from "@/firestore/aiRankings";
import { getFightRatings, ratingSub, RATING_PLACEMENT, type FightRatingRow } from "@/firestore/fightRating";
import RankList from "@/components/RankList";
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

/** 온라인 레이팅 순위 (모드를 바꿀 때마다 새로) */
function useFightRatings(on: boolean) {
  const [rows, setRows] = useState<FightRatingRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    getFightRatings(20)
      .then((r) => alive && (setRows(r), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [on]);
  return { rows, failed };
}

const ratingRows = (rows: FightRatingRow[]) =>
  rows.map((r) => ({
    name: r.name,
    member: true,
    avatar: r.avatar,
    value: r.r.toLocaleString(),
    sub: ratingSub(r),
    date: r.at,
  }));

type RankMode = "ai" | "rating";

/** 랭킹 종류: AI 대전 기록 · 온라인 레이팅 */
function ModeTabs({ mode, setMode }: { mode: RankMode; setMode: (m: RankMode) => void }) {
  const tabs: [RankMode, string][] = [
    ["ai", "🤖 AI 대전"],
    ["rating", "🌐 온라인 레이팅"],
  ];
  return (
    <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
      {tabs.map(([m, name]) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={`cursor-pointer rounded-lg py-1.5 font-['Nanum_Gothic',sans-serif] text-sm transition-colors ${
            mode === m ? "bg-[#FF8A3D]/90 font-bold text-[#2A0E3A]" : "text-white/60 hover:text-white"
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export default function FightPage() {
  const top = useAIRankTop("fight_ai_rankings");
  const [ch, setCh] = useState("");
  const [mode, setMode] = useState<RankMode>("ai");
  const chTop = useAIRankTop("fight_ai_rankings", ch || undefined);
  const rating = useFightRatings(mode === "rating");
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
            sub: mode === "ai" ? "AI 대전" : "온라인 레이팅",
            top: topRows(top),
            podium: mode === "rating" ? ratingRows(rating.rows ?? []) : ch ? topRows(chTop) : null,
            head: () => (
              <>
                <ModeTabs mode={mode} setMode={setMode} />
                {mode === "ai" ? (
                  <ChTabs ch={ch} setCh={setCh} />
                ) : (
                  <p className="mb-3 px-1 text-[11px] text-white/35">
                    회원끼리 한 온라인 경기만 · 1000점에서 시작 · 강한 상대를 이길수록 많이 올라요 · 처음 {RATING_PLACEMENT}판은
                    배치(크게 변함) · 같은 상대와는 하루 5판까지만 반영
                  </p>
                )}
              </>
            ),
            render: () =>
              mode === "ai" ? (
                <RankBoard
                  coll="fight_ai_rankings"
                  oppLabel={oppLabel}
                  vs={false}
                  bare
                  skip={3}
                  refresh={refresh}
                  ch={ch || undefined}
                />
              ) : rating.failed ? (
                <p className="py-3 font-mono text-xs text-white/30">랭킹을 불러오지 못했어요</p>
              ) : !rating.rows ? (
                <p className="py-3 font-mono text-xs text-white/30">불러오는 중…</p>
              ) : (
                <RankList
                  rows={ratingRows(rating.rows)}
                  skip={3}
                  empty="아직 레이팅 경기가 없어요 — 회원끼리 온라인 대전을 해 보세요"
                />
              ),
          }}
        />
        <FightGame onRanked={() => setRefresh((n) => n + 1)} />
      </div>
    </Faded>
  );
}
