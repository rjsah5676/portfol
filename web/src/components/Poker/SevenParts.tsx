"use client";

import { useState } from "react";
import { bestK, handNameK } from "@/lib/poker/seven";
import type { MyHand, SevenAction, SevenBet, SevenView } from "@/lib/poker/types";
import type { Orient } from "./layout";
import { Money, PlayingCard } from "./parts";
import type { SeatCardsProps } from "./TableView";

/* 7포커에서만 쓰는 화면 조각: 몇 구인지, 자리의 카드(편 카드 · 엎은 카드), 카드 고르기 · 베팅 버튼 */

export function sevenHint(my: MyHand): string {
  if (!my.down || my.cards.length < 2) return "";
  return handNameK(bestK(my.cards).score);
}

export function sevenSeatCards({
  view,
  seat,
  hero,
  myHand,
  tier,
  sizes,
  side,
  hide,
  settled,
}: SeatCardsProps<SevenView>) {
  const p = view.players[seat];
  if (!p) return null;
  const best = view.result?.best[seat];
  const ended = !!view.result && !!settled;
  const w = hero ? sizes.heroCard : sizes.card;
  const count = p.cards?.length ?? (hero ? myHand?.cards.length : p.up.length + p.down) ?? 0;
  // 옆자리는 카드가 늘어나도 폭이 거의 안 늘게 촘촘히 겹침, 내 카드는 숫자가 다 보이게
  const overlap = hero
    ? -Math.round(w * (count >= 6 ? 0.3 : 0.2))
    : -Math.round(w * (side === "top" ? 0.38 : 0.48));
  const row = `flex ${side === "right" ? "justify-end" : ""}`;
  const gap = (i: number) => (i ? { marginLeft: overlap } : undefined);

  // 쇼다운에서 깐 7장: 엎어 뒀던 카드만 뒤집히고, 다 깐 뒤 이긴 5장은 빛나고 나머지는 어둡게
  if (p.cards && !(hide && !hero)) {
    const won = (view.result?.won[seat] ?? 0) > 0;
    let k = 0;
    return (
      <span className={row}>
        {p.cards.map((c, i) => {
          const wasDown = !hero && !p.up.includes(c);
          return (
            <PlayingCard
              key={c}
              card={c}
              w={hero ? w : Math.round(w * 1.15)}
              win={ended && won && !!best?.includes(c)}
              dim={ended && (!won || (!!best && !best.includes(c)))}
              className={wasDown ? "pk-flip" : ""}
              delay={wasDown ? k++ * 140 : 0}
              style={gap(i)}
            />
          );
        })}
      </span>
    );
  }
  // 내 카드: 전부 보이되, 메이드에 든 카드는 위로 · 엎어 둔 카드는 표시
  if (hero && myHand) {
    if (!myHand.down) return null; // 고르는 중에는 아래 고르기 화면에서
    const mine = bestK(myHand.cards);
    const made = myHand.cards.length >= 5 ? new Set(mine.five) : null;
    return (
      <span className={row}>
        {myHand.cards.map((c, i) => {
          const down = myHand.down!.includes(i);
          return (
            <PlayingCard
              key={c}
              card={c}
              w={w}
              dim={p.folded}
              deal
              down={down}
              style={{
                ...gap(i),
                transform: made?.has(c) ? "translateY(-10%)" : undefined,
                filter: made && !made.has(c) ? "brightness(0.75)" : undefined,
              }}
            />
          );
        })}
      </span>
    );
  }
  // 남의 카드: 엎은 2장 · 편 카드들 · (7구) 엎은 1장 (쇼다운 중 아직 안 깐 자리도 이 모양 그대로)
  const downN = p.cards ? p.cards.length - p.up.length : p.down;
  const downFirst = Math.min(2, downN);
  const downLast = p.up.length ? downN - downFirst : 0;
  const leading = p.up.length ? downFirst : downN;
  return (
    <span className={`flex flex-col gap-[3px] ${side === "right" ? "items-end" : "items-start"}`}>
      <span className={row}>
        {Array.from({ length: leading }, (_, i) => (
          <PlayingCard key={`d${i}`} card={null} w={w} tier={tier} dim={p.folded} style={gap(i)} />
        ))}
        {p.up.map((c, i) => (
          <PlayingCard key={c} card={c} w={w} dim={p.folded} deal style={gap(leading + i)} />
        ))}
        {Array.from({ length: downLast }, (_, i) => (
          <PlayingCard
            key={`l${i}`}
            card={null}
            w={w}
            tier={tier}
            dim={p.folded}
            deal
            style={gap(1)}
          />
        ))}
      </span>
    </span>
  );
}

/** 가운데 위: 지금 몇 구인지 */
export function SevenStage({ view }: { view: SevenView }) {
  if (view.result) return null;
  const stage =
    view.phase === "choice"
      ? "카드 고르는 중"
      : view.round === 7
        ? "7구 · 히든"
        : view.round >= 4
          ? `${view.round}구`
          : "카드 펴는 중";
  return (
    <span className="rounded-[4px] bg-black/55 px-[0.7em] py-[0.05em] text-[0.7em] text-white/70">
      {stage}
    </span>
  );
}

const BET_LABEL: Record<SevenBet, string> = {
  bbing: "삥",
  ddadang: "따당",
  quarter: "쿼터",
  half: "하프",
  full: "풀",
};

export function SevenActions({
  view,
  mySeat,
  myStack,
  myHand,
  busy,
  onAct,
  tier,
  u,
  o,
}: {
  view: SevenView;
  mySeat: number;
  myStack: number;
  myHand: MyHand | null;
  busy: boolean;
  onAct: (a: SevenAction) => void;
  tier: 1 | 2 | 3;
  u: number;
  o: Orient;
}) {
  const [discard, setDiscard] = useState(-1);
  const choosing = view.phase === "choice";

  // 고르기: 첫 번째 누른 카드 = 버림, 두 번째 = 펴기 → 바로 확정 (버린 카드를 다시 누르면 취소)
  if (choosing) {
    const cards = myHand && !myHand.down ? myHand.cards : [];
    const pick = (i: number) => {
      if (busy) return;
      if (discard < 0) return setDiscard(i);
      if (i === discard) return setDiscard(-1);
      onAct({ a: "choose", discard, open: i });
    };
    const cw = o === "h" ? u * 10 : u * 17;
    return (
      <div className="pk-frame flex flex-col items-center gap-[0.5em] px-[0.7em] py-[0.55em]">
        <p className="text-center text-[0.8em] text-white/80">
          {discard < 0 ? (
            <>
              <b className="text-white">버릴 카드</b>를 누르세요
            </>
          ) : (
            <>
              이제 <b className="text-[var(--pk-call)]">펼 카드</b>를 누르세요
            </>
          )}
        </p>
        <div className="flex gap-[0.5em]">
          {cards.map((c, i) => (
            <button
              key={c}
              type="button"
              onClick={() => pick(i)}
              aria-pressed={i === discard}
              className="relative cursor-pointer rounded-[0.5em]"
            >
              <PlayingCard
                card={c}
                w={cw}
                tier={tier}
                pick={i === discard ? "discard" : undefined}
                deal
                delay={i * 70}
              />
              {i === discard && (
                <span className="pk-tag absolute inset-x-0 -bottom-[0.3em] mx-auto w-max bg-[#4b4f5a]">
                  버림
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const lg = view.legal;
  if (!lg || view.toAct !== mySeat) return null;
  const big =
    "pk-btn flex min-w-0 flex-1 flex-col items-center justify-center px-[0.2em] py-[0.55em] whitespace-nowrap";
  // 순서: 다이 · 삥(또는 콜) · 따당 · 쿼터 · 하프 (그 순간 할 수 있는 것만)
  const buttons: { key: string; label: string; cls: string; amt?: number; act: SevenAction }[] = [];
  buttons.push({ key: "die", label: "다이", cls: "pk-btn-fold", act: { a: "die" } });
  const bet = (b: SevenBet) => {
    const v = lg.bets[b];
    if (v === undefined) return;
    const allIn = v >= myStack;
    buttons.push({
      key: b,
      label: allIn ? "올인" : BET_LABEL[b],
      cls: allIn ? "pk-btn-allin" : `pk-btn-${b}`,
      amt: v,
      act: { a: b },
    });
  };
  bet("bbing");
  // 콜은 삥 자리(두 번째)에 — 미리 행동 줄의 「삥/콜」과 같은 자리라 헷갈리지 않게
  // 받을 돈이 가진 칩 이상이면 콜 = 있는 만큼 올인 (서버가 그렇게 처리, 남는 건 상대가 돌려받음)
  if (lg.toCall > 0)
    buttons.push({
      key: "call",
      label: lg.toCall >= myStack ? "올인 콜" : "콜",
      cls: lg.toCall >= myStack ? "pk-btn-allin" : "pk-btn-call",
      amt: lg.toCall,
      act: { a: "call" },
    });
  bet("ddadang");
  bet("quarter");
  bet("half");
  return (
    // 버튼 한 줄: 색으로 구분
    <div className="pk-frame flex gap-[0.3em] p-[0.45em]">
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          disabled={busy}
          onClick={() => onAct(b.act)}
          className={`${big} ${b.cls}`}
        >
          <span className="text-[1.02em]">{b.label}</span>
          {b.amt !== undefined ? (
            <Money won={b.amt} className="text-[1.08em] opacity-95" />
          ) : (
            <span className="pk-num text-[1.08em] opacity-0">0</span>
          )}
        </button>
      ))}
    </div>
  );
}
