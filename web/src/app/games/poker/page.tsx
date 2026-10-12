"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import { PokerRanks } from "@/components/Poker/Lobby";
import PokerApp, { useRank } from "@/components/Poker/PokerApp";
import { POKER_GUIDE } from "@/data/gameGuides";
import { useNick } from "@/lib/AuthContext";
import { fmtEok, type Look } from "@/lib/poker/rules";
import { asset } from "@/lib/poker/assets";
import type { BuyRankRow } from "@/lib/poker/types";
import { getBuyRank } from "@/realtime/poker";
import { Profile } from "@/components/Poker/parts";

// 포커 순위는 프로필 사진 대신 캐릭터 얼굴 (순위 그림은 절대 주소여야 함 — 상대 주소는 API 서버로 붙음)
const charPic = (look: string) =>
  typeof window === "undefined" ? null : `${window.location.origin}${asset.profile(look as Look)}`;

// 테이블은 ?t=ID 쿼리로 구분 (다른 온라인 게임들과 같은 방식)
function PokerPage() {
  const rank = useRank();
  const nick = useNick();
  const inTable = !!useSearchParams().get("t");
  // 순위 창 탭: 제목 · 시상대도 같이 바뀜
  const [tab, setTab] = useState<"money" | "buy">("money");
  const [buy, setBuy] = useState<BuyRankRow[] | null>(null);
  useEffect(() => {
    if (tab !== "buy") return;
    let alive = true;
    getBuyRank()
      .then((r) => alive && setBuy(r))
      .catch(() => alive && setBuy((cur) => cur ?? []));
    return () => {
      alive = false;
    };
  }, [tab]);
  const buyTop = buy?.slice(0, 3).map((r) => ({
          name: r.nick,
          member: true,
          avatar: charPic(r.look ?? r.char),
          value: fmtEok(r.spent),
          sub: <span>스킨 {r.skins} · 캐릭터 {r.chars}</span>,
        })) ?? null;
  // 위 띠(TopTicker)는 늘 자금 순위, 창 안 시상대는 고른 탭
  const moneyTop = rank?.slice(0, 3).map((r) => ({
          name: r.nick,
          member: true,
          avatar: charPic(r.look ?? r.char),
          value: fmtEok(r.money),
          sub: (
            <span className="inline-flex items-center gap-1">
              <Profile char={r.look ?? r.char} size={14} />
              {r.hands.toLocaleString()}판
            </span>
          ),
        })) ?? null;
  return (
    <>
      <div className="mx-auto max-w-5xl px-3 pt-6 sm:px-6">
        <GameHeader
          icon="♠"
          title="ANIME POKER"
          en="Hold'em · 7 Poker"
          accent="#FFC93C"
          desc="애니풍 캐릭터와 즐기는 홀덤 · 7포커"
          tags={["실시간 멀티", "무료 포커", "웹 홀덤"]}
          guide={POKER_GUIDE}
          scroll={!inTable}
          rank={{
            sub: tab === "buy" ? "구매 순위" : "자금 순위",
            top: moneyTop,
            podium: tab === "buy" ? (buyTop ?? []) : undefined,
            render: () => (
              <PokerRanks rank={rank} myNick={nick ?? undefined} tab={tab} onTab={setTab} buy={buy} />
            ),
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
