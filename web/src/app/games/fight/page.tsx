"use client";

import { useEffect, useState } from "react";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import FightGame from "@/components/Fight/FightGame";
import { FIGHT_GUIDE } from "@/data/gameGuides";
import { getFightRatings, ratingSub, type FightRatingRow } from "@/firestore/fightRating";
import FightStats from "@/components/Fight/FightStats";
import RankList from "@/components/RankList";
import { rankTierOf } from "@/lib/fight/tiers";

/** 랭크전 레이팅 순위 (버튼의 1~3위 · 모달) */
function useFightRatings(n: number, tick: number) {
  const [rows, setRows] = useState<FightRatingRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getFightRatings(n)
      .then((r) => alive && (setRows(r), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [n, tick]);
  return { rows, failed };
}

const ratingRows = (rows: FightRatingRow[]) =>
  rows.map((r) => ({
    name: r.name,
    member: true,
    avatar: r.avatar,
    value: r.r.toLocaleString(),
    // 등급(색, 한 줄) + 전적(배치 중이면 ratingSub 가 "배치 n/10" 을 붙임) — 한 줄에 다 넣으면 시상대 · 목록에서 등급이 잘려서 두 줄로
    sub: (
      <>
        {r.n >= 10 && (
          <span className="block truncate font-bold" style={{ color: rankTierOf(r.r, r.n).tier.color }}>
            {rankTierOf(r.r, r.n).label}
          </span>
        )}
        <span className="block truncate">{ratingSub(r)}</span>
      </>
    ),
    date: r.at,
  }));

export default function FightPage() {
  const [open, setOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  // 모달을 열 때마다 새로
  const [tick, setTick] = useState(0);
  const top = useFightRatings(3, tick);
  const all = useFightRatings(20, tick);
  return (
    <Faded>
      <div className="mx-auto max-w-5xl px-3 pt-6 pb-24 sm:px-6">
        <GameHeader
          icon="🥊"
          title="PIXEL FIGHT"
          en="Fighting Game"
          accent="#FF8A3D"
          desc="도트 캐릭터 7명의 1:1 플랫폼 대전"
          tags={["AI 대전", "온라인 대전", "랭크전", "웹 격투게임"]}
          ach="fight"
          guide={FIGHT_GUIDE}
          extra={(pill) => (
            <button
              type="button"
              onClick={() => setStatsOpen(true)}
              aria-label="캐릭터 통계"
              className={`${pill} border-[#FF8A3D]/30 bg-[#FF8A3D]/[0.07] text-[#FFC79E] hover:border-[#FF8A3D]/60`}
            >
              <span aria-hidden>📊</span>
              <span>통계</span>
            </button>
          )}
          rank={{
            sub: "랭크전",
            open,
            onOpenChange: (o) => {
              setOpen(o);
              if (o) setTick((n) => n + 1);
            },
            top: ratingRows(top.rows ?? []),
            podium: ratingRows(all.rows ?? []),
            render: () =>
              all.failed ? (
                <p className="py-3 font-mono text-xs text-white/30">랭킹을 불러오지 못했어요</p>
              ) : !all.rows ? (
                <p className="py-3 font-mono text-xs text-white/30">불러오는 중…</p>
              ) : (
                <RankList rows={ratingRows(all.rows)} skip={3} empty="아직 랭크전 기록이 없어요 — 온라인 → ⚔ 랭크전으로 첫 판을 해 보세요" />
              ),
          }}
        />
        <FightStats open={statsOpen} onClose={() => setStatsOpen(false)} />
        <FightGame />
      </div>
    </Faded>
  );
}
