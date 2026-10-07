"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import { RankTable } from "@/components/Poker/Lobby";
import PokerApp, { useRank } from "@/components/Poker/PokerApp";
import { POKER_GUIDE } from "@/data/gameGuides";
import { useNick } from "@/lib/AuthContext";
import { fmtShort } from "@/lib/poker/rules";

// 테이블은 ?t=ID 쿼리로 구분 (다른 온라인 게임들과 같은 방식)
function PokerPage() {
  const rank = useRank();
  const nick = useNick();
  const inTable = !!useSearchParams().get("t");
  return (
    <>
      <div className="mx-auto max-w-5xl px-3 pt-6 sm:px-6">
        <GameHeader
          icon="♠"
          title="포커"
          en="Hold'em · 7 Poker"
          accent="#E7B95B"
          desc="홀덤과 7포커 — 회원 전용, 가입하면 1억"
          guide={POKER_GUIDE}
          scroll={!inTable}
          rank={{
            sub: "자금 순위",
            top: rank?.slice(0, 3).map((r) => ({ name: r.nick, member: true, value: `${fmtShort(r.money)}`, sub: `${r.hands.toLocaleString()}판` })) ?? null,
            render: () => <RankTable rank={rank} myNick={nick ?? undefined} />,
          }}
        />
      </div>
      <Faded>
        <PokerApp rank={rank} />
      </Faded>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PokerPage />
    </Suspense>
  );
}
