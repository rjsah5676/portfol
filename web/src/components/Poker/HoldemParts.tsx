"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { evaluate, handName, rankOf } from "@/lib/poker/cards";
import { UNIT, fmtWon } from "@/lib/poker/rules";
import type { HoldemAction, HoldemView, MyHand, SeatWire } from "@/lib/poker/types";
import { Money, PlayingCard } from "./parts";
import type { SeatCardsProps, Sizes } from "./TableView";

/* 홀덤에서만 쓰는 화면 조각: 가운데(바닥 카드 · 팟), 자리의 패, 행동 버튼 */

export function holdemHint(my: MyHand, view: HoldemView): string {
  if (my.cards.length < 2) return "";
  if (view.board.length >= 3) return handName(evaluate([...my.cards, ...view.board]));
  return rankOf(my.cards[0]) === rankOf(my.cards[1]) ? "포켓 페어" : "";
}

export function holdemSeatCards({ view, seat, hero, myHand, tier, sizes }: SeatCardsProps<HoldemView>) {
  const p = view.players[seat];
  if (!p) return null;
  const best = view.result?.best[seat];
  const ended = !!view.result;
  // 쇼다운에서 깐 패
  if (p.cards) {
    const w = hero ? sizes.heroCard : Math.round(sizes.card * 1.25);
    return (
      <span className="flex gap-0.5">
        {p.cards.map((c) => (
          <PlayingCard key={c} card={c} w={w} win={!!best?.includes(c)} dim={ended && !(view.result!.won[seat] > 0)} />
        ))}
      </span>
    );
  }
  if (hero && myHand) {
    return (
      <span className="flex gap-1">
        {myHand.cards.map((c, i) => (
          <PlayingCard key={c} card={c} w={sizes.heroCard} dim={p.folded} deal delay={i * 90} />
        ))}
      </span>
    );
  }
  if (p.folded) return null;
  return (
    <span className="flex">
      <PlayingCard card={null} w={sizes.card} tier={tier} deal />
      <PlayingCard card={null} w={sizes.card} tier={tier} deal delay={80} style={{ marginLeft: -sizes.card * 0.45 }} />
    </span>
  );
}

export function HoldemCenter({ view, tier, sizes, seats }: { view: HoldemView; tier: number; sizes: Sizes; seats: (SeatWire | null)[] }) {
  const res = view.result;
  // 이긴 사람의 5장에 든 바닥 카드를 강조
  const winning = useMemo(() => {
    const set = new Set<number>();
    if (res?.showdown) for (const seat of Object.keys(res.won)) for (const c of res.best[Number(seat)] ?? []) set.add(c);
    return set;
  }, [res]);
  const winners = res ? Object.keys(res.won).map(Number) : [];
  // 이번 구간에 건 돈은 각자 앞에, 그 전까지 모인 돈이 가운데 팟
  const street = Object.values(view.players).reduce((a, p) => a + p.bet, 0);
  const collected = res ? view.pot : view.pot - street;
  return (
    <>
      {res && (
        // (좁은 화면에서는 팟 위에 띄움: 줄을 차지하면 바닥 카드가 아래로 밀려 아래쪽 옆자리의 카드와 겹침)
        <div
          className={`pk-pop pk-title rounded-full bg-[var(--pk-brass)] px-4 py-1 text-center text-sm break-keep text-[#2a1e05] shadow-lg sm:text-lg ${
            sizes.compact ? "absolute bottom-full left-1/2 mb-1.5 w-max max-w-full -translate-x-1/2" : ""
          }`}
        >
          {winners.map((s) => seats[s]?.name ?? "?").join(" · ")} 승{res.names[winners[0]] ? ` — ${res.names[winners[0]]}` : ""}
        </div>
      )}
      <div className="flex min-h-[26px] items-center gap-2 rounded-full bg-black/40 px-3.5 py-1">
        <span className="text-[11px] text-white/55">{res ? "팟" : street > 0 && collected > 0 ? "모인 팟" : "팟"}</span>
        <Money won={res || collected > 0 ? collected : view.pot} className="text-lg text-white sm:text-2xl" />
        {!res && street > 0 && collected > 0 && <span className="text-[11px] text-white/45">전체 {fmtWon(view.pot)}</span>}
      </div>
      <div className="flex gap-1 sm:gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => {
          const c = view.board[i];
          return c === undefined ? (
            <span
              key={`e${i}`}
              className="rounded-[6px] border border-dashed border-white/15"
              style={{ width: sizes.boardCard, aspectRatio: "5 / 7" } as CSSProperties}
              aria-hidden
            />
          ) : (
            <PlayingCard key={c} card={c} w={sizes.boardCard} tier={tier} deal delay={i < 3 ? i * 110 : 0} win={winning.has(c)} dim={!!res?.showdown && winning.size > 0 && !winning.has(c)} />
          );
        })}
      </div>
      {view.pots.length > 1 && !res && Object.values(view.players).some((p) => p.allIn) && (
        <div className="flex flex-wrap justify-center gap-x-2 text-[10px] text-white/60 sm:text-[11px]">
          {view.pots.map((p, i) => (
            <span key={i}>
              {i === 0 ? "메인" : `사이드${view.pots.length > 2 ? ` ${i}` : ""}`} {fmtWon(p.amount)}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function HoldemActions({
  view,
  mySeat,
  myStack,
  busy,
  onAct,
  unitBB,
}: {
  view: HoldemView;
  mySeat: number;
  myStack: number;
  busy: boolean;
  onAct: (a: HoldemAction) => void;
  unitBB: number;
}) {
  const lg = view.legal!;
  const myBet = view.players[mySeat]?.bet ?? 0;
  const steps = Math.max(0, Math.ceil((lg.maxTo - lg.minTo) / UNIT));
  // (차례가 새로 오면 부모가 key 를 바꿔서 최소 금액부터 다시 시작)
  const [k, setK] = useState(0);
  const amount = Math.min(lg.maxTo, lg.minTo + k * UNIT);
  const allIn = amount >= lg.maxTo;
  const toK = (to: number) => Math.max(0, Math.min(steps, Math.round((Math.max(lg.minTo, Math.min(lg.maxTo, to)) - lg.minTo) / UNIT)));
  /** 팟의 몇 배로 걸지 → 총액 (콜한 뒤의 팟 기준) */
  const potTo = (f: number) => view.currentBet + Math.round((f * (view.pot + lg.toCall)) / UNIT) * UNIT;
  const presets: [string, number][] = [
    ["최소", lg.minTo],
    ["½팟", potTo(0.5)],
    ["⅔팟", potTo(0.67)],
    ["팟", potTo(1)],
    ["올인", lg.maxTo],
  ];
  const callAll = lg.toCall >= myStack;
  const big = "flex-1 cursor-pointer rounded-xl px-2 py-3 text-center text-[15px] font-bold transition active:scale-[0.98] disabled:opacity-50 sm:text-base";

  // 키보드: F 폴드 · C 체크/콜 · R 레이즈
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (busy || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      // 글자를 치는 중(채팅 등)에는 안 먹게. 레이즈 슬라이더는 글자를 치는 칸이 아니므로 그대로 먹음
      const el = e.target as HTMLElement | null;
      if (el && ((el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range") || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      // 자판이 한글 상태면 e.key 가 ㄹ·ㅊ·ㄱ 으로 옴 → 영문자가 아닐 때는 키의 자리(code)로 판단
      const typed = e.key.toLowerCase();
      const key = /^[a-z]$/.test(typed) ? typed : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : typed;
      if (key === "f" && !lg.canCheck) onAct({ a: "fold" });
      else if (key === "c") onAct({ a: lg.canCheck ? "check" : "call" });
      else if (key === "r" && lg.canRaise) onAct({ a: "raise", amt: amount });
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [busy, lg.canCheck, lg.canRaise, amount, onAct]);

  return (
    <div className="grid gap-2">
      {lg.canRaise && steps > 0 && (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {presets.map(([label, to], idx) => {
              const kk = toK(to);
              // 같은 금액이 되는 버튼이 여럿이면 앞의 것만 켜진 것으로 표시
              const on = kk === k && presets.findIndex(([, t2]) => toK(t2) === k) === idx;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setK(kk)}
                  className={`shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-xs transition ${on ? "bg-[var(--pk-raise)] font-bold text-[#2a1903]" : "bg-white/[0.07] text-white/75 hover:bg-white/15"}`}
                >
                  {label}
                </button>
              );
            })}
            <span className="ml-auto shrink-0 pl-2 text-right text-xs text-white/50">
              {(amount / unitBB).toFixed(amount % unitBB ? 1 : 0)}BB
            </span>
          </div>
          <input
            type="range"
            className="pk-range w-full"
            min={0}
            max={steps}
            step={1}
            value={k}
            aria-label="레이즈 금액"
            aria-valuetext={`${fmtWon(amount)}원`}
            onChange={(e) => setK(Number(e.target.value))}
            style={{ "--fill": `${steps ? (k / steps) * 100 : 100}%` } as CSSProperties}
          />
        </div>
      )}
      <div className="flex gap-2">
        {!lg.canCheck && (
          <button type="button" disabled={busy} onClick={() => onAct({ a: "fold" })} className={`${big} max-w-[26%] bg-white/[0.08] text-white/80 hover:bg-white/15`}>
            폴드
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onAct({ a: lg.canCheck ? "check" : "call" })}
          className={`${big} bg-[var(--pk-call)] text-[#06231c] hover:brightness-110`}
        >
          {lg.canCheck ? "체크" : (
            <>
              {callAll ? "올인 콜" : "콜"} <Money won={lg.toCall} className="text-[1.1em]" />
            </>
          )}
        </button>
        {lg.canRaise && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAct({ a: "raise", amt: amount })}
            className={`${big} ${allIn ? "bg-[var(--pk-danger)] text-white" : "bg-[var(--pk-raise)] text-[#2a1903]"} hover:brightness-110`}
          >
            {allIn ? "올인" : view.currentBet === 0 ? "벳" : "레이즈"} <Money won={allIn ? amount - myBet : amount} className="text-[1.1em]" />
          </button>
        )}
      </div>
    </div>
  );
}
