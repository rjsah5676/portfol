"use client";

import { useState } from "react";
import { madeOf, type Card } from "@/lib/poker/cards";
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

/** 카드 사이 간격 (카드 폭 대비) — 모서리 숫자 · 무늬가 보이는 만큼 */
const STEP = 0.3;

/** 7포커 카드 놓는 순서: 엎은 카드(처음 2장) → 편 카드(받은 순서) → 히든(7번째 장, 늘 맨 끝) */
function orderSeven(cards: Card[], isUp: (c: Card, i: number) => boolean) {
  const all = cards.map((c, i) => ({ c, i, up: isUp(c, i), hidden: cards.length === 7 && i === 6 && !isUp(c, i) }));
  return [...all.filter((x) => !x.up && !x.hidden), ...all.filter((x) => x.up), ...all.filter((x) => x.hidden)];
}

export function sevenSeatCards({
  view,
  seat,
  hero,
  myHand,
  tier,
  sizes,
  hide,
  settled,
  dealDelay,
  maxW,
  hiddenShut,
  onPeek,
}: SeatCardsProps<SevenView>) {
  const p = view.players[seat];
  if (!p) return null;
  const best = view.result?.best[seat];
  const ended = !!view.result && !!settled;
  const w = hero ? sizes.heroCard : sizes.card;
  const count = p.cards?.length ?? (hero ? myHand?.cards.length : p.up.length + p.down) ?? 0;
  // 남 · 나 모두 한게임처럼 왼쪽부터 같은 간격으로 차곡차곡 (칸을 꽉 채우려고 벌리지 않음) — 모서리 숫자 · 무늬만 보이는 간격
  // 7장이 다 들어와도 칸 안에 들어가는 간격으로 고정 (칸이 그보다 좁으면 그때만 더 겹침)
  let overlap = -Math.round(w * (1 - STEP));
  if (maxW && count > 1) {
    const fit = -Math.ceil(w - (maxW - w) / (count - 1));
    overlap = Math.min(overlap, fit);
  }
  const row = "flex";
  const gap = (i: number) => (i ? { marginLeft: overlap } : undefined);

  // 쇼다운에서 깐 7장: 엎어 뒀던 카드만 뒤집히고, 다 깐 뒤 이긴 5장은 빛나고 나머지는 어둡게 (순서는 판 중과 같게: 엎은 2장 → 편 카드 → 히든)
  if (p.cards && !(hide && !hero)) {
    // 이긴 사람 = 족보 1등 (사이드 팟만 딴 2등은 진 쪽처럼)
    const won = (view.result?.won[seat] ?? 0) > 0 && isTopSeat(view, seat);
    let k = 0;
    return (
      <span className={row}>
        {orderSeven(p.cards, (c) => p.up.includes(c)).map(({ c, up }, j, all) => {
          const wasDown = !hero && !up;
          return (
            <PlayingCard
              key={c}
              card={c}
              w={w}
              covered={j < all.length - 1}
              // 깔자마자 족보에 든 5장은 빛남, 다 깐 뒤엔 이긴 사람 것만
              win={!!best?.includes(c) && (!ended || won)}
              dim={ended && (!won || (!!best && !best.includes(c)))}
              className={wasDown ? "pk-flip" : ""}
              delay={wasDown ? k++ * 90 : 0}
              style={gap(j)}
            />
          );
        })}
      </span>
    );
  }
  // 내 카드: 메이드에 든 카드는 위로. 히든(7번째)은 엎은 채로 맨 끝 — 눌러야 열림 (안 열어도 베팅은 됨, 쇼다운 때 열림)
  if (hero && myHand) {
    // 고르는 중: 고르기는 화면 가운데에서, 내 틀에는 남들처럼 엎은 카드 묶음
    if (!myHand.down)
      return (
        <span className={`${row} items-center`}>
          {myHand.cards.map((c, i) => (
            <PlayingCard
              key={`d${c}`}
              card={null}
              w={w}
              tier={tier}
              deal
              delay={dealDelay?.(i, myHand.cards.length)}
              style={i ? { marginLeft: -Math.round(w * 0.8) } : undefined}
            />
          ))}
        </span>
      );
    const shut = !!hiddenShut && myHand.cards.length === 7;
    const evalCards = shut ? myHand.cards.slice(0, 6) : myHand.cards;
    const mine = bestK(evalCards);
    const made = evalCards.length >= 5 ? new Set(madeOf(mine.five)) : null;
    const downs = myHand.down;
    const n = myHand.cards.length;
    return (
      <span className={row}>
        {orderSeven(myHand.cards, (_, i) => !downs.includes(i)).map(({ c, i, hidden }, j, all) =>
          hidden && shut ? (
            <button
              key="hidden"
              type="button"
              onClick={onPeek}
              className="pk-peek relative cursor-pointer rounded-[0.5em]"
              style={gap(j)}
              aria-label="히든 카드 열어 보기"
            >
              <PlayingCard card={null} w={w} tier={tier} deal delay={dealDelay?.(n - 1, n)} />
              <span className="pk-peek-tag">눌러서 확인</span>
            </button>
          ) : (
            <PlayingCard
              key={c}
              card={c}
              w={w}
              covered={j < all.length - 1}
              dim={p.folded}
              deal={!hidden}
              className={hidden ? "pk-flip" : ""}
              delay={hidden ? 0 : dealDelay?.(i, n)}
              style={{
                ...gap(j),
                transform: made?.has(c) ? "translateY(-10%)" : undefined,
                filter: made && !made.has(c) ? "brightness(0.75)" : undefined,
              }}
            />
          )
        )}
      </span>
    );
  }
  // 남의 카드: 엎은 카드(처음 2장)는 앞에 촘촘한 한 묶음 → 편 카드 → 7구 히든은 엎은 채로 맨 끝
  // (쇼다운 중 아직 안 깐 자리도 이 모양 그대로)
  const downAll = p.cards ? p.cards.length - p.up.length : p.down;
  const hid = count === 7 && downAll >= 3 ? 1 : 0;
  const downN = downAll - hid;
  const U = p.up.length;
  const total = downAll + U;
  // 엎은 카드도 편 카드와 같은 크기 · 같은 간격 — 7장 모두 한 줄로 고르게
  const bw = w;
  const bg = overlap;
  const g = overlap;
  const ml = (m: number) => ({ marginLeft: m });
  return (
    <span className="flex flex-col items-start gap-[3px]">
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
            covered={i < p.up.length - 1 || hid > 0}
            dim={p.folded}
            deal
            delay={dealDelay?.(downN + i, total)}
            style={i || downN ? ml(g) : undefined}
          />
        ))}
        {hid > 0 && (
          <PlayingCard
            key="hidden"
            card={null}
            w={bw}
            tier={tier}
            dim={p.folded}
            deal={dealDelay?.(total - 1, total) !== undefined}
            delay={dealDelay?.(total - 1, total)}
            style={ml(g)}
          />
        )}
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
  /** k = 글자 그림 · 색 (다이 · 삥 · 따당 · 콜 · 쿼터 · 하프 · 올인) */
  type Slot = { key: string; label: string; k: string; amt?: number; act?: SevenAction };
  const bet = (b: SevenBet, key: string, idle: string): Slot => {
    const v = lg?.bets[b];
    if (v === undefined) return { key, label: idle, k: key === "bbdd" ? "bbing" : b };
    // 팟이 커져 그 베팅이 가진 칩을 다 쓰게 되면 칸이 「올인」으로 바뀜
    const allIn = v >= myStack;
    return { key, label: allIn ? "올인" : BET_LABEL[b], k: allIn ? "allin" : b, amt: v, act: { a: b } };
  };
  const slots: Slot[] = [
    { key: "die", label: "다이", k: "die", act: live ? { a: "die" } : undefined },
    // 아무도 안 걸었으면 삥, 누가 걸었으면 따당(받을 돈의 2배)
    lg && lg.bets.ddadang !== undefined ? bet("ddadang", "bbdd", "삥") : bet("bbing", "bbdd", "삥"),
    lg && lg.toCall > 0
      ? { key: "call", label: lg.toCall >= myStack ? "올인" : "콜", k: lg.toCall >= myStack ? "allin" : "call", amt: lg.toCall, act: { a: "call" } }
      : { key: "call", label: "콜", k: "call" },
    bet("quarter", "quarter", "쿼터"),
    bet("half", "half", "하프"),
  ];
  // 미리 누르기: 이번 구에 내 차례가 또 올 때만 (아직 안 쳤거나, 낸 뒤 누가 더 올렸을 때)
  const myP = view?.players[mySeat];
  const canPre =
    !live && !!view && !!myP && !myP.folded && !myP.allIn && !view.result && view.phase === "bet" && (!myP.last || myP.bet < view.currentBet);
  return (
    <div className="pk-sevenbar flex h-full gap-[0.35em] pt-[0.75em]" data-live={live ? "1" : undefined}>
      {slots.map((b) => {
        const on = live && !!b.act && !busy;
        return (
          <button
            key={b.key}
            type="button"
            data-k={b.k}
            disabled={live ? !on : !canPre}
            aria-pressed={!live && canPre ? pre === b.key : undefined}
            onClick={() => (live ? b.act && onAct(b.act) : onPre(b.key))}
            className="pk-sbtn relative flex h-full min-w-0 flex-1 flex-col items-center justify-center whitespace-nowrap"
          >
            {live && b.amt !== undefined && (
              <span className="pk-sbtn-amt pk-num">
                <Money won={b.amt} />
              </span>
            )}
            {/* 글자는 행동 글자 그림 (판 위 외침과 같은 그림) */}
            {}
            <img src={`/poker/ui/act-${b.k}.webp`} alt={b.label} draggable={false} className="pk-sbtn-img" />
          </button>
        );
      })}
    </div>
  );
}
