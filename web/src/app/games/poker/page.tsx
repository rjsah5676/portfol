"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import { RankTable } from "@/components/Poker/Lobby";
import PokerApp, { useRank } from "@/components/Poker/PokerApp";
import { POKER_GUIDE } from "@/data/gameGuides";
import { useNick } from "@/lib/AuthContext";
import { fmtEok } from "@/lib/poker/rules";
import { Profile } from "@/components/Poker/parts";

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
          title="ANIME POKER"
          en="Hold'em · 7 Poker"
          accent="#FFC93C"
          desc="애니풍 캐릭터와 즐기는 홀덤 · 7포커"
          guide={POKER_GUIDE}
          scroll={!inTable}
          rank={{
            sub: "자금 순위",
            top: rank?.slice(0, 3).map((r) => ({ name: r.nick, member: true, avatar: r.avatar ?? null, value: fmtEok(r.money), sub: <span className="inline-flex items-center gap-1"><Profile char={r.look ?? r.char} size={14} />{r.hands.toLocaleString()}판</span> })) ?? null,
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
