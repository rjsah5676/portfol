"use client";

import { useState } from "react";
import { madeOf } from "@/lib/poker/cards";
import type { TierId } from "@/lib/poker/rules";
import { bestK, handNameK } from "@/lib/poker/seven";
import { sfx } from "@/lib/poker/sfx";
import { isTopSeat } from "@/lib/poker/showdown";
import type { MyHand, SevenAction, SevenBet, SevenView } from "@/lib/poker/types";
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
  // 폭이 정해져 있으면(틀의 카드 칸) 그 안에 들어오게 더 겹침 (숫자 · 무늬 보일 만큼은 남김). 내 카드는 칸이 남으면 덜 겹침
  if (maxW && count > 1) {
    const fit = -Math.ceil(w - (maxW - w) / (count - 1));
    overlap = hero
      ? Math.max(Math.min(fit, -Math.round(w * 0.06)), -Math.round(w * 0.8))
      : Math.min(overlap, Math.max(fit, -Math.round(w * 0.8)));
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
              w={w}
              // 깔자마자 족보에 든 5장은 빛남, 다 깐 뒤엔 이긴 사람 것만
              win={!!best?.includes(c) && (!ended || won)}
              dim={ended && (!won || (!!best && !best.includes(c)))}
              className={wasDown ? "pk-flip" : ""}
              delay={wasDown ? k++ * 90 : 0}
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
          return (
            <PlayingCard
              key={c}
              card={c}
              w={w}
              dim={p.folded}
              deal
              delay={dealDelay?.(i, myHand.cards.length)}
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
  // 남의 카드: 엎은 카드(처음 2장 · 7구 1장)는 앞에 촘촘한 한 묶음, 편 카드는 덜 겹쳐서 — 편 카드가 한눈에 보이게
  // (쇼다운 중 아직 안 깐 자리도 이 모양 그대로)
  const downN = p.cards ? p.cards.length - p.up.length : p.down;
  const U = p.up.length;
  const total = downN + U;
  // 엎은 카드도 편 카드와 같은 크기 (작게 하면 뭐가 몇 장인지 눈에 안 들어옴) — 대신 촘촘히 겹친 묶음
  const bw = w;
  const bg = -Math.round(bw * 0.8);
  const backsW = downN ? bw + (downN - 1) * (bw + bg) : 0;
  // 편 카드는 숫자 · 무늬(왼쪽 위)만 보이면 되니 반쯤 겹침 (한게임처럼)
  let g = -Math.round(w * 0.52);
  if (maxW && U > 1) {
    const room = (maxW - backsW - (downN ? 4 : 0) - w) / (U - 1) - w;
    g = Math.min(g, Math.max(Math.floor(room), -Math.round(w * 0.8)));
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

/** 카드 고르기: 화면 가운데에 크게 — 첫 번째 누른 카드 = 버림, 두 번째 = 펴기 → 바로 확정 (버린 카드를 다시 누르면 취소) */
export function SevenChoice({
  myHand,
  busy,
  onAct,
  tier,
  cw,
}: {
  myHand: MyHand | null;
  busy: boolean;
  onAct: (a: SevenAction) => void;
  tier: TierId;
  cw: number;
}) {
  const [discard, setDiscard] = useState(-1);
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
  return (
    <div className="pk-frame pk-pop flex flex-col items-center gap-[0.6em] px-[1em] py-[0.8em]" style={{ background: "rgba(10,11,18,0.94)" }}>
      <p className="text-center text-[1em] text-white/85">
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
      <div className="flex gap-[0.6em]">
        {cards.map((c, i) => (
          <button
            key={c}
            type="button"
            onClick={() => pick(i)}
            aria-pressed={i === discard}
            className="relative cursor-pointer rounded-[0.5em]"
          >
            <PlayingCard card={c} w={cw} tier={tier} pick={i === discard ? "discard" : undefined} deal delay={i * 70} />
            {i === discard && (
              <span className="pk-tag absolute inset-x-0 -bottom-[0.3em] mx-auto w-max bg-[#4b4f5a]">버림</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 7포커 베팅 버튼 줄 (한게임식): 다섯 칸이 늘 같은 자리 — 다이 · 삥(받을 돈 있으면 따당) · 콜 · 쿼터 · 하프.
 * 내 차례면 할 수 있는 칸만 켜지고 금액이 위에 붙음. 남의 차례엔 전부 어둡게 잠기고, 미리 누르기가 되면 칸 왼쪽에 작은 체크 상자.
 */
export function SevenBar({
  view,
  mySeat,
  myStack,
  busy,
  myTurn,
  onAct,
  pre,
  onPre,
}: {
  view: SevenView | null;
  mySeat: number;
  myStack: number;
  busy: boolean;
  myTurn: boolean;
  onAct: (a: SevenAction) => void;
  pre: string;
  onPre: (k: string) => void;
}) {
  const lg = view && !view.result && myTurn && view.phase === "bet" && view.toAct === mySeat ? view.legal : null;
  const live = !!lg;
  type Slot = { key: string; label: string; cls: string; amt?: number; act?: SevenAction };
  const bet = (b: SevenBet, key: string, idle: string): Slot => {
    const v = lg?.bets[b];
    if (v === undefined) return { key, label: idle, cls: `pk-btn-${b}` };
    const allIn = v >= myStack;
    return { key, label: allIn ? "올인" : BET_LABEL[b], cls: allIn ? "pk-btn-allin" : `pk-btn-${b}`, amt: v, act: { a: b } };
  };
  const slots: Slot[] = [
    { key: "die", label: "다이", cls: "pk-btn-fold", act: live ? { a: "die" } : undefined },
    // 아무도 안 걸었으면 삥, 누가 걸었으면 따당(받을 돈의 2배)
    lg && lg.bets.ddadang !== undefined ? bet("ddadang", "bbdd", "삥") : bet("bbing", "bbdd", "삥"),
    lg && lg.toCall > 0
      ? {
          key: "call",
          label: lg.toCall >= myStack ? "올인 콜" : "콜",
          cls: lg.toCall >= myStack ? "pk-btn-allin" : "pk-btn-call",
          amt: lg.toCall,
          act: { a: "call" },
        }
      : { key: "call", label: "콜", cls: "pk-btn-call" },
    bet("quarter", "quarter", "쿼터"),
    bet("half", "half", "하프"),
  ];
  // 미리 누르기: 이번 구에 내 차례가 또 올 때만 (아직 안 쳤거나, 낸 뒤 누가 더 올렸을 때)
  const myP = view?.players[mySeat];
  const canPre =
    !live && !!view && !!myP && !myP.folded && !myP.allIn && !view.result && view.phase === "bet" && (!myP.last || myP.bet < view.currentBet);
  return (
    <div className="pk-frame pk-sevenbar flex h-full gap-[0.3em] p-[0.4em]" data-live={live ? "1" : undefined}>
      {slots.map((b) => {
        const on = live && !!b.act && !busy;
        return (
          <button
            key={b.key}
            type="button"
            disabled={live ? !on : !canPre}
            aria-pressed={!live && canPre ? pre === b.key : undefined}
            onClick={() => (live ? b.act && onAct(b.act) : onPre(b.key))}
            className={`pk-btn ${b.cls} pk-sbtn relative flex h-full min-w-0 flex-1 flex-col items-center justify-center px-[0.2em] whitespace-nowrap ${live ? "" : "pk-sbtn-idle"}`}
          >
            {live && b.amt !== undefined && (
              <span className="pk-sbtn-amt">
                <Money won={b.amt} />
              </span>
            )}
            {!live && canPre && <span className={`pk-sbtn-box ${pre === b.key ? "pk-sbtn-box-on" : ""}`} aria-hidden />}
            <span className="text-[1.15em]">{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}
