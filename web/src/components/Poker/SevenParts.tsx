"use client";

import { useState } from "react";
import { madeOf } from "@/lib/poker/cards";
import type { TierId } from "@/lib/poker/rules";
import { bestK, handNameK } from "@/lib/poker/seven";
import { sfx } from "@/lib/poker/sfx";
import { isTopSeat } from "@/lib/poker/showdown";
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
  dealDelay,
  maxW,
}: SeatCardsProps<SevenView>) {
  const p = view.players[seat];
  if (!p) return null;
  const best = view.result?.best[seat];
  const ended = !!view.result && !!settled;
  const w = hero ? sizes.heroCard : sizes.card;
  const count = p.cards?.length ?? (hero ? myHand?.cards.length : p.up.length + p.down) ?? 0;
  // 옆자리는 카드가 늘어나도 폭이 거의 안 늘게 촘촘히 겹침, 내 카드는 숫자가 다 보이게
  let overlap = hero
    ? -Math.round(w * (count >= 6 ? 0.3 : 0.2))
    : -Math.round(w * (side === "top" ? 0.38 : 0.48));
  // 폭이 정해져 있으면 그 안에 들어오게 더 겹침 (숫자 보일 만큼은 남김)
  if (maxW && !hero && count > 1) {
    const cw = p.cards && !hide ? Math.round(w * 1.15) : w;
    const fit = -Math.ceil(cw - (maxW - cw) / (count - 1));
    overlap = Math.min(overlap, Math.max(fit, -Math.round(cw * 0.72)));
  }
  const row = `flex ${side === "right" ? "justify-end" : ""}`;
  const gap = (i: number) => (i ? { marginLeft: overlap } : undefined);

  // 쇼다운에서 깐 7장: 엎어 뒀던 카드만 뒤집히고, 다 깐 뒤 이긴 5장은 빛나고 나머지는 어둡게
  if (p.cards && !(hide && !hero)) {
    // 이긴 사람 = 족보 1등 (사이드 팟만 딴 2등은 진 쪽처럼)
    const won = (view.result?.won[seat] ?? 0) > 0 && isTopSeat(view, seat);
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
              // 깔자마자 족보에 든 5장은 빛남, 다 깐 뒤엔 이긴 사람 것만
              win={!!best?.includes(c) && (!ended || won)}
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
    const made = myHand.cards.length >= 5 ? new Set(madeOf(mine.five)) : null;
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
              delay={dealDelay?.(i, myHand.cards.length)}
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
  // 남의 카드: 엎은 카드(처음 2장 · 7구 1장)는 작게 앞에 한 묶음, 편 카드는 크게 덜 겹쳐서 — 편 카드가 한눈에 보이게
  // (쇼다운 중 아직 안 깐 자리도 이 모양 그대로)
  const downN = p.cards ? p.cards.length - p.up.length : p.down;
  const U = p.up.length;
  const total = downN + U;
  const bw = U ? Math.round(w * 0.72) : w;
  const bg = -Math.round(bw * 0.82);
  const backsW = downN ? bw + (downN - 1) * (bw + bg) : 0;
  let g = -Math.round(w * 0.3);
  if (maxW && U > 1) {
    const room = (maxW - backsW - (downN ? 4 : 0) - w) / (U - 1) - w;
    g = Math.min(g, Math.max(Math.floor(room), -Math.round(w * 0.7)));
  }
  const ml = (m: number) => ({ marginLeft: m });
  return (
    <span className={`flex flex-col gap-[3px] ${side === "right" ? "items-end" : "items-start"}`}>
      <span className={`${row} items-center`}>
        {Array.from({ length: downN }, (_, i) => {
          const dd = dealDelay?.(i, total);
          return (
            <PlayingCard
              key={`d${i}`}
              card={null}
              w={bw}
              tier={tier}
              dim={p.folded}
              deal={dd !== undefined}
              delay={dd}
              style={i ? ml(bg) : undefined}
            />
          );
        })}
        {p.up.map((c, i) => (
          <PlayingCard
            key={c}
            card={c}
            w={w}
            dim={p.folded}
            deal
            delay={dealDelay?.(downN + i, total)}
            style={i ? ml(g) : downN ? ml(4) : undefined}
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
  tier: TierId;
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
      // 효과음: 버릴 카드 고름 = 카드 던지는 소리 · 취소 = 딸깍 · 펼 카드 고름(확정) = 카드 뒤집는 소리
      if (discard < 0) {
        sfx.fold();
        return setDiscard(i);
      }
      if (i === discard) {
        sfx.click();
        return setDiscard(-1);
      }
      sfx.flip();
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
  // 순서: 다이 · 따당 · 삥(또는 콜) · 쿼터 · 하프 (그 순간 할 수 있는 것만)
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
  bet("ddadang");
  bet("bbing");
  // 콜은 삥 자리(세 번째)에 — 미리 행동 줄의 「삥/콜」과 같은 자리라 헷갈리지 않게
  // 받을 돈이 가진 칩 이상이면 콜 = 있는 만큼 올인 (서버가 그렇게 처리, 남는 건 상대가 돌려받음)
  if (lg.toCall > 0)
    buttons.push({
      key: "call",
      label: lg.toCall >= myStack ? "올인 콜" : "콜",
      cls: lg.toCall >= myStack ? "pk-btn-allin" : "pk-btn-call",
      amt: lg.toCall,
      act: { a: "call" },
    });
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
