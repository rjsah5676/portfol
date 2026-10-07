"use client";

import { useState } from "react";
import { bestK, handNameK } from "@/lib/poker/seven";
import type { MyHand, SeatWire, SevenAction, SevenBet, SevenView } from "@/lib/poker/types";
import { Money, PlayingCard } from "./parts";
import type { SeatCardsProps } from "./TableView";

/* 7포커에서만 쓰는 화면 조각: 가운데(팟 · 몇 구), 자리의 카드(편 카드 · 엎은 카드), 카드 고르기 · 베팅 버튼 */

export function sevenHint(my: MyHand): string {
  // 고르기 전(4장 받은 상태)에는 아직 족보가 없음
  if (!my.down || my.cards.length < 2) return "";
  return handNameK(bestK(my.cards).score);
}

export function sevenSeatCards({ view, seat, hero, myHand, tier, sizes, align }: SeatCardsProps<SevenView>) {
  const p = view.players[seat];
  if (!p) return null;
  const best = view.result?.best[seat];
  const w = hero ? (sizes.compact ? 34 : 50) : sizes.card;
  // (좁은 화면에서는 6~7장이 되면 옆자리의 카드와 내 카드가 서로 넘어오므로 더 촘촘히 겹침)
  const count = p.cards?.length ?? (hero ? myHand?.cards.length : 0) ?? 0;
  const overlap = hero ? -(sizes.compact ? (count >= 6 ? 13 : 8) : 12) : -Math.round(w * (sizes.compact ? 0.5 : 0.38));
  const row = `flex ${align === "right" ? "justify-end" : ""}`;
  const gap = (i: number) => (i ? { marginLeft: overlap } : undefined);

  // 쇼다운에서 깐 7장
  if (p.cards) {
    const won = (view.result?.won[seat] ?? 0) > 0;
    return (
      <span className={row}>
        {p.cards.map((c, i) => (
          <PlayingCard key={c} card={c} w={hero ? w : Math.round(w * 1.1)} win={won && !!best?.includes(c)} dim={!won || (!!best && !best.includes(c))} style={gap(i)} />
        ))}
      </span>
    );
  }
  // 내 카드: 전부 보이되, 엎어 둔 카드는 아래로 살짝 내려 구분
  if (hero && myHand) {
    if (!myHand.down) return null; // 고르는 중에는 아래 고르기 화면에서 보여 줌
    return (
      <span className={row}>
        {myHand.cards.map((c, i) => {
          const down = myHand.down!.includes(i);
          return (
            <span key={c} className="relative" style={gap(i)}>
              <PlayingCard card={c} w={w} dim={p.folded} deal style={{ transform: down ? "translateY(14%)" : undefined, filter: down && !p.folded ? "brightness(0.82)" : undefined }} />
              {down && <span className="absolute inset-x-0 -bottom-[3px] text-center text-[9px] leading-none text-white/55">엎음</span>}
            </span>
          );
        })}
      </span>
    );
  }
  // 남의 카드: 엎은 2장 · 편 카드들 · (7구) 엎은 1장
  const downFirst = Math.min(2, p.down);
  const downLast = p.up.length ? p.down - downFirst : 0;
  const leading = p.up.length ? downFirst : p.down;
  return (
    <span className={row}>
      {Array.from({ length: leading }, (_, i) => (
        <PlayingCard key={`d${i}`} card={null} w={w} tier={tier} dim={p.folded} style={gap(i)} />
      ))}
      {p.up.map((c, i) => (
        <PlayingCard key={c} card={c} w={w} dim={p.folded} deal style={gap(leading + i)} />
      ))}
      {Array.from({ length: downLast }, (_, i) => (
        <PlayingCard key={`l${i}`} card={null} w={w} tier={tier} dim={p.folded} deal style={gap(1)} />
      ))}
    </span>
  );
}

export function SevenCenter({ view, seats }: { view: SevenView; seats: (SeatWire | null)[] }) {
  const res = view.result;
  const winners = res ? Object.keys(res.won).map(Number) : [];
  const stage = view.phase === "choice" ? "버릴 카드 · 펼 카드 고르는 중" : view.round === 7 ? "7구 · 히든" : view.round >= 4 ? `${view.round}구` : "카드 펴는 중";
  return (
    <>
      {!res && <span className="rounded-full bg-black/35 px-3 py-0.5 text-[11px] text-white/70 sm:text-xs">{stage}</span>}
      <div className="flex flex-col items-center rounded-2xl bg-black/40 px-5 py-2">
        <span className="text-[11px] text-white/55">팟</span>
        <Money won={view.pot} className="text-2xl text-white sm:text-4xl" />
      </div>
      {view.pots.length > 1 && !res && Object.values(view.players).some((p) => p.allIn) && (
        <div className="flex flex-wrap justify-center gap-x-2 text-[10px] text-white/60 sm:text-[11px]">
          {view.pots.map((p, i) => (
            <span key={i}>
              {i === 0 ? "메인" : "사이드"} <Money won={p.amount} />
            </span>
          ))}
        </div>
      )}
      {res && (
        <div className="pk-pop pk-title rounded-full bg-[var(--pk-brass)] px-4 py-1 text-center text-sm break-keep text-[#2a1e05] shadow-lg sm:text-lg">
          {winners.map((s) => seats[s]?.name ?? "?").join(" · ")} 승{res.names[winners[0]] ? ` — ${res.names[winners[0]]}` : ""}
        </div>
      )}
    </>
  );
}

const BET_LABEL: Record<SevenBet, string> = { bbing: "삥", ddadang: "따당", quarter: "쿼터", half: "하프", full: "풀" };
const BET_ORDER: SevenBet[] = ["bbing", "ddadang", "quarter", "half", "full"];

export function SevenActions({
  view,
  mySeat,
  myHand,
  busy,
  onAct,
  tier,
  compact,
}: {
  view: SevenView;
  mySeat: number;
  myHand: MyHand | null;
  busy: boolean;
  onAct: (a: SevenAction) => void;
  tier: number;
  compact: boolean;
}) {
  const [discard, setDiscard] = useState(-1);
  const [open, setOpen] = useState(-1);
  const choosing = view.phase === "choice";

  if (choosing) {
    const cards = myHand && !myHand.down ? myHand.cards : [];
    const pick = (i: number) => {
      if (i === discard) {
        setDiscard(-1);
        return;
      }
      if (i === open) {
        setOpen(-1);
        return;
      }
      if (discard < 0) setDiscard(i);
      else setOpen(i);
    };
    const ready = discard >= 0 && open >= 0;
    return (
      // 넓은 화면에서는 카드 옆에 안내 · 확정 버튼을 둠 (세로로 쌓으면 낮은 화면에서 확정 버튼이 화면 아래로 밀려남)
      <div className="flex flex-col items-center gap-2.5 py-1 sm:grid sm:grid-cols-[auto_minmax(0,20rem)] sm:justify-center sm:gap-x-6 sm:gap-y-2 sm:py-2">
        <p className="text-center text-sm text-white/80 sm:col-start-2 sm:row-start-1 sm:self-end">
          {discard < 0 ? (
            <>
              <b className="text-white">버릴 카드</b> 한 장을 고르세요
            </>
          ) : open < 0 ? (
            <>
              이제 <b className="text-[var(--pk-call)]">펼 카드</b> 한 장을 고르세요 (나머지 두 장은 숨겨져요)
            </>
          ) : (
            "이대로 할까요? 카드를 다시 누르면 취소돼요."
          )}
        </p>
        <div className="flex gap-2 sm:col-start-1 sm:row-span-2 sm:row-start-1">
          {cards.map((c, i) => (
            <button key={c} type="button" onClick={() => pick(i)} aria-pressed={i === discard || i === open} className="relative cursor-pointer rounded-md">
              <PlayingCard card={c} w={compact ? 58 : 74} tier={tier} pick={i === discard ? "discard" : i === open ? "open" : undefined} deal delay={i * 70} />
              {(i === discard || i === open) && (
                <span className={`absolute inset-x-0 -bottom-1 mx-auto w-max rounded-full px-2 text-[10px] font-bold ${i === discard ? "bg-white/20 text-white" : "bg-[var(--pk-call)] text-[#06231c]"}`}>
                  {i === discard ? "버림" : "펴기"}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => onAct({ a: "choose", discard, open })}
          className="w-full max-w-xs cursor-pointer rounded-xl bg-white py-2.5 text-sm font-bold text-[#15161a] hover:bg-[var(--pk-brass)] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35 sm:col-start-2 sm:row-start-2 sm:self-start"
        >
          확정
        </button>
      </div>
    );
  }

  const lg = view.legal;
  if (!lg || view.toAct !== mySeat) return null;
  const bets = BET_ORDER.filter((b) => lg.bets[b] !== undefined);
  const big = "cursor-pointer rounded-xl px-2 py-2.5 text-center font-bold transition active:scale-[0.98] disabled:opacity-50";
  return (
    <div className="grid gap-2">
      {bets.length > 0 && (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${bets.length}, minmax(0, 1fr))` }}>
          {bets.map((b) => (
            <button key={b} type="button" disabled={busy} onClick={() => onAct({ a: b })} className={`${big} bg-[var(--pk-raise)] text-[#2a1903] hover:brightness-110`}>
              <span className="block text-[15px] sm:text-base">{BET_LABEL[b]}</span>
              <Money won={lg.bets[b]!} className="block text-[13px] opacity-80 sm:text-sm" />
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        {!lg.canCheck && (
          <button type="button" disabled={busy} onClick={() => onAct({ a: "die" })} className={`${big} w-[26%] bg-white/[0.08] text-[15px] text-white/80 hover:bg-white/15`}>
            다이
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onAct({ a: lg.canCheck ? "check" : "call" })}
          className={`${big} flex-1 bg-[var(--pk-call)] text-[15px] text-[#06231c] hover:brightness-110 sm:text-base`}
        >
          {lg.canCheck ? "체크" : (
            <>
              콜 <Money won={lg.toCall} className="text-[1.1em]" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
