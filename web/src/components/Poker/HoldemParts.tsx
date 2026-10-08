"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { evaluate, handName, rankOf } from "@/lib/poker/cards";
import { UNIT, fmtWon, type TierId } from "@/lib/poker/rules";
import type { HoldemAction, HoldemView, MyHand } from "@/lib/poker/types";
import { Money, PlayingCard } from "./parts";
import type { SeatCardsProps, Sizes } from "./TableView";

/* 홀덤에서만 쓰는 화면 조각: 바닥 카드, 자리의 패, 행동 버튼 */

export function holdemHint(my: MyHand, view: HoldemView): string {
  if (my.cards.length < 2) return "";
  if (view.board.length >= 3) return handName(evaluate([...my.cards, ...view.board]));
  return rankOf(my.cards[0]) === rankOf(my.cards[1]) ? "포켓 페어" : "";
}

export function holdemSeatCards({
  view,
  seat,
  hero,
  myHand,
  tier,
  sizes,
  hide,
  settled,
  dealDelay,
}: SeatCardsProps<HoldemView>) {
  const p = view.players[seat];
  if (!p) return null;
  const best = view.result?.best[seat];
  const ended = !!view.result && !!settled;
  // 쇼다운에서 깐 패 (아직 안 깐 자리는 뒷면 그대로, 깔 때 뒤집힘)
  if (p.cards && !hide) {
    const w = hero ? sizes.heroCard : Math.round(sizes.card * 1.3);
    return (
      <span className="flex gap-[0.15em]">
        {p.cards.map((c, i) => (
          <PlayingCard
            key={c}
            card={c}
            w={w}
            win={ended && !!best?.includes(c)}
            dim={ended && !(view.result!.won[seat] > 0)}
            className={hero ? "" : "pk-flip"}
            delay={hero ? 0 : i * 140}
          />
        ))}
      </span>
    );
  }
  if (hero && myHand) {
    return (
      <span className="flex gap-[0.3em]">
        {myHand.cards.map((c, i) => (
          <PlayingCard
            key={c}
            card={c}
            w={sizes.heroCard}
            dim={p.folded}
            deal
            delay={dealDelay?.(i, 2) ?? i * 90}
          />
        ))}
      </span>
    );
  }
  if (p.folded) return null;
  // 쇼다운 중 아직 안 깐 자리는 뒷면이 그대로 (나눠 주는 움직임은 처음 한 번만)
  const stay = !!p.cards;
  return (
    <span className="flex">
      <PlayingCard card={null} w={sizes.card} tier={tier} deal={!stay} delay={dealDelay?.(0, 2)} />
      <PlayingCard
        card={null}
        w={sizes.card}
        tier={tier}
        deal={!stay}
        delay={stay ? 0 : (dealDelay?.(1, 2) ?? 80)}
        style={{ marginLeft: -sizes.card * 0.5 }}
      />
    </span>
  );
}

/** 가운데 위: 지금 어느 구간인지 */
export function HoldemStage({ view }: { view: HoldemView }) {
  if (view.result) return null;
  return (
    <span className="rounded-[4px] bg-black/55 px-[0.7em] py-[0.05em] text-[0.7em] text-white/70">
      {["프리플랍", "플랍", "턴", "리버"][view.street] ?? ""}
    </span>
  );
}

/** 바닥 카드 5장 (이긴 5장에 든 카드는 빛남) */
export function HoldemBoard({
  view,
  tier,
  sizes,
  settled,
}: {
  view: HoldemView;
  tier: TierId;
  sizes: Sizes;
  settled: boolean;
}) {
  const res = view.result;
  const winning = useMemo(() => {
    const set = new Set<number>();
    if (res?.showdown && settled)
      for (const seat of Object.keys(res.won))
        for (const c of res.best[Number(seat)] ?? []) set.add(c);
    return set;
  }, [res, settled]);
  return (
    <div className="flex gap-[0.25em]">
      {[0, 1, 2, 3, 4].map((i) => {
        const c = view.board[i];
        return c === undefined ? (
          <span
            key={`e${i}`}
            className="rounded-[0.4em] border border-dashed border-white/20"
            style={{ width: sizes.boardCard, aspectRatio: "5 / 7" } as CSSProperties}
            aria-hidden
          />
        ) : (
          <PlayingCard
            key={c}
            card={c}
            w={sizes.boardCard}
            tier={tier}
            deal
            delay={i < 3 ? i * 110 : 0}
            win={winning.has(c)}
            dim={!!res?.showdown && winning.size > 0 && !winning.has(c)}
          />
        );
      })}
    </div>
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
  o: "h" | "v";
}) {
  const lg = view.legal!;
  const myBet = view.players[mySeat]?.bet ?? 0;
  const steps = Math.max(0, Math.ceil((lg.maxTo - lg.minTo) / UNIT));
  const [k, setK] = useState(0);
  const amount = Math.min(lg.maxTo, lg.minTo + k * UNIT);
  const allIn = amount >= lg.maxTo;
  const toK = (to: number) =>
    Math.max(
      0,
      Math.min(steps, Math.round((Math.max(lg.minTo, Math.min(lg.maxTo, to)) - lg.minTo) / UNIT))
    );
  const potTo = (f: number) =>
    view.currentBet + Math.round((f * (view.pot + lg.toCall)) / UNIT) * UNIT;
  const presets: [string, number][] = [
    ["최소", lg.minTo],
    ["½팟", potTo(0.5)],
    ["⅔팟", potTo(0.67)],
    ["팟", potTo(1)],
    ["올인", lg.maxTo],
  ];
  const callAll = lg.toCall >= myStack;

  // 키보드: F 폴드 · C 체크/콜 · R 레이즈
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (busy || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        ((el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range") ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      const typed = e.key.toLowerCase();
      const key = /^[a-z]$/.test(typed)
        ? typed
        : /^Key[A-Z]$/.test(e.code)
          ? e.code.slice(3).toLowerCase()
          : typed;
      if (key === "f" && !lg.canCheck) onAct({ a: "fold" });
      else if (key === "c") onAct({ a: lg.canCheck ? "check" : "call" });
      else if (key === "r" && lg.canRaise) onAct({ a: "raise", amt: amount });
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [busy, lg.canCheck, lg.canRaise, amount, onAct]);

  const big =
    "pk-btn flex flex-1 flex-col items-center justify-center gap-[0.1em] px-[0.3em] py-[0.55em] whitespace-nowrap";
  const amt = (won: number) => <Money won={won} className="text-[1.08em] opacity-95" />;
  return (
    <div className="pk-frame grid gap-[0.45em] p-[0.5em]">
      {lg.canRaise && steps > 0 && (
        <>
          {/* 금액 빠른 선택: 큰 버튼 5개 한 줄 */}
          <div className="grid grid-cols-5 gap-[0.3em]">
            {presets.map(([label, to], idx) => {
              const kk = toK(to);
              const on = kk === k && presets.findIndex(([, t2]) => toK(t2) === k) === idx;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setK(kk)}
                  className="pk-preset"
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-[0.55em]">
            <input
              type="range"
              className="pk-range min-w-0 flex-1"
              min={0}
              max={steps}
              step={1}
              value={k}
              aria-label="레이즈 금액"
              aria-valuetext={`${fmtWon(amount)}칩`}
              onChange={(e) => setK(Number(e.target.value))}
              style={
                {
                  "--fill": `${steps ? (k / steps) * 100 : 100}%`,
                  height: "1.8em",
                } as CSSProperties
              }
            />
            <span className="pk-raise-amt">
              <Money won={amount} className="text-[1.05em] text-white" />
              <span className="pk-num text-[0.78em] text-[#ffb54a]">
                {(amount / unitBB).toFixed(amount % unitBB ? 1 : 0)}BB
              </span>
            </span>
          </div>
        </>
      )}
      <div className="flex gap-[0.4em]">
        {!lg.canCheck && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAct({ a: "fold" })}
            className={`${big} pk-btn-fold`}
          >
            <span className="text-[1.05em]">폴드</span>
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onAct({ a: lg.canCheck ? "check" : "call" })}
          className={`${big} pk-btn-call`}
        >
          <span className="text-[1.05em]">{lg.canCheck ? "체크" : callAll ? "올인 콜" : "콜"}</span>
          {!lg.canCheck && amt(lg.toCall)}
        </button>
        {lg.canRaise && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAct({ a: "raise", amt: amount })}
            className={`${big} ${allIn ? "pk-btn-allin" : "pk-btn-raise"}`}
          >
            <span className="text-[1.05em]">
              {allIn ? "올인" : view.currentBet === 0 ? "벳" : "레이즈"}
            </span>
            {amt(allIn ? amount - myBet : amount)}
          </button>
        )}
      </div>
    </div>
  );
}
