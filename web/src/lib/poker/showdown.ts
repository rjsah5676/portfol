import { evaluate } from "./cards";
import { bestK } from "./seven";
import type { HoldemView, SevenView } from "./types";

/**
 * 쇼다운에서 족보가 제일 센 자리들 (같으면 여럿). 쇼다운이 아니면 null.
 * 사이드 팟만 따 간 2등은 돈은 받아도 "이긴 사람"이 아님 — 이긴 동작 · 이긴 카드 빛남 · WINNER 이름은 여기 든 사람만.
 */
export function topHands(hand: HoldemView | SevenView | null | undefined): Set<number> | null {
  if (!hand?.result?.showdown) return null;
  const board = hand.game === "holdem" ? (hand as HoldemView).board : [];
  const sc: [number, number][] = [];
  for (const [k, p] of Object.entries(hand.players)) {
    if (!p || p.folded || !p.cards) continue;
    const cards = [...p.cards, ...board];
    if (cards.length < 5) continue;
    sc.push([Number(k), hand.game === "holdem" ? evaluate(cards) : bestK(cards).score]);
  }
  if (!sc.length) return null;
  const top = Math.max(...sc.map((x) => x[1]));
  return new Set(sc.filter((x) => x[1] === top).map((x) => x[0]));
}

/** 이 자리가 "이긴 사람"인지 (쇼다운이면 족보 1등, 아니면 판을 가져간 사람) */
export const isTopSeat = (hand: HoldemView | SevenView | null | undefined, seat: number) => {
  const tops = topHands(hand);
  return tops ? tops.has(seat) : (hand?.result?.won[seat] ?? 0) > 0;
};
