"use client";

import { Suspense } from "react";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import StockApp from "@/components/Stock/StockApp";
import { STOCK_GUIDE } from "@/data/gameGuides";

function StockPage() {
  return (
    <>
      <div className="mx-auto max-w-5xl px-3 pt-6 sm:px-6">
        <GameHeader
          icon="px:stock"
          title="주식게임"
          en="STOCK GAME · Chart · Coin · Live Battle"
          accent="#F2C14E"
          desc="차트 하나로 50턴 솔로 · 10배 코인 · 친구 · 봇과 7분 실시간 주식 대전"
          tags={["주식게임", "웹 주식게임", "모의 투자", "실시간 대전"]}
          guide={STOCK_GUIDE}
        />
      </div>
      <Faded>
        <div className="px-3 pb-10 sm:px-6">
          <StockApp />
        </div>
      </Faded>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <StockPage />
    </Suspense>
  );
}
