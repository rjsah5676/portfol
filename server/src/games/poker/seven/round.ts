import { shuffledDeck, type Card } from "../../../../../web/src/lib/poker/cards";
import { UNIT } from "../../../../../web/src/lib/poker/rules";
import { bestK, kCategory, KCAT } from "../../../../../web/src/lib/poker/seven";
import type { PokerEvent, ResultWire, SevenPlayer as SevenPlayerWire, SevenView } from "../../../../../web/src/lib/poker/types";
import type { Brain, Cue } from "../personas";
import { RoundError, type BotMove, type GameDef, type Round, type RoundSeat, type StartOptions, type Step } from "../round";
import { chooseSeven, decideSeven, type SevenBotView } from "./bots";
import { SevenError, SevenHand, type SevenAct } from "./engine";

/* 7포커 엔진을 테이블이 쓰는 모양(Round)으로 감쌈 */

const ACTS: SevenAct[] = ["die", "check", "call", "bbing", "ddadang", "quarter", "half", "full"];

class SevenRound implements Round {
  private last = new Map<number, { a: string; amt: number }>();
  /** 고른 카드를 한꺼번에 폈는지 */
  private opened = false;
  private result: ResultWire | null = null;

  constructor(
    private seats: RoundSeat[],
    private ante: number,
    private hand: SevenHand
  ) {}

  waiting(): number[] {
    if (this.hand.phase === "choice") return this.hand.choosing();
    return this.hand.phase === "bet" && this.hand.toAct >= 0 ? [this.hand.toAct] : [];
  }
  waitKind(): "act" | "choice" {
    return this.hand.phase === "choice" ? "choice" : "act";
  }
  done(): boolean {
    return this.hand.phase === "done";
  }
  stack(seat: number): number {
    return this.hand.player(seat)?.stack ?? 0;
  }
  alive(seat: number): boolean {
    const p = this.hand.player(seat);
    return !!p && !p.folded;
  }

  private guard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof SevenError) throw new RoundError(e.message);
      throw e;
    }
  }

  private bet(seat: number, type: SevenAct): PokerEvent[] {
    const item = this.guard(() => this.hand.act(seat, type));
    const p = this.hand.player(seat)!;
    const a = item.allIn && item.add > 0 ? "allin" : type;
    this.last.set(seat, { a, amt: type === "die" || type === "check" ? 0 : p.bet });
    const ev: PokerEvent[] = [{ t: "act", seat, a, amt: item.add, allIn: item.allIn }];
    if (this.hand.phase === "done") ev.push(...this.finish());
    return ev;
  }

  act(seat: number, input: unknown): PokerEvent[] {
    const o = (input ?? {}) as { a?: unknown; discard?: unknown; open?: unknown };
    if (o.a === "choose") {
      if (typeof o.discard !== "number" || typeof o.open !== "number") throw new RoundError("버릴 카드와 펼 카드를 골라주세요.");
      this.guard(() => this.hand.choose(seat, o.discard as number, o.open as number));
      return [];
    }
    if (!ACTS.includes(o.a as SevenAct)) throw new RoundError("알 수 없는 행동입니다.");
    if (this.hand.phase !== "bet") throw new RoundError("지금은 베팅할 수 없습니다.");
    return this.bet(seat, o.a as SevenAct);
  }

  timeout(seat: number, fold = false): PokerEvent[] {
    if (this.hand.phase === "choice") {
      if (fold) return this.bet(seat, "die");
      this.guard(() => this.hand.autoChoose(seat));
      return [];
    }
    return this.bet(seat, !fold && this.hand.legal(seat).canCheck ? "check" : "die");
  }

  step(): Step {
    const h = this.hand;
    if (h.phase !== "deal") throw new RoundError("진행할 것이 없습니다.");
    // 다 골랐으면 펴기로 한 카드를 한꺼번에 폄
    if (!this.opened) {
      this.opened = true;
      const ev: PokerEvent[] = h.live.map((p) => ({ t: "open", seat: p.seat, card: h.upCards(p)[0] }));
      return { ev, pause: 1000 };
    }
    if (h.round === 7) {
      h.advance();
      return { ev: this.finish(), pause: 0 };
    }
    const dealt = h.advance();
    this.last.clear();
    const runout = h.phase === "deal";
    return {
      ev: [{ t: "deal", round: h.round, cards: dealt.map((d) => ({ seat: d.seat, card: d.up ? d.card : null })) }],
      pause: runout ? 1300 : 1000,
    };
  }

  private finish(): PokerEvent[] {
    const r = this.hand.result!;
    const ev: PokerEvent[] = [];
    const names: Record<number, string> = {};
    const best: Record<number, Card[]> = {};
    for (const s of r.shows) {
      names[s.seat] = s.name;
      ev.push({ t: "show", seat: s.seat, cards: s.cards, name: s.name });
    }
    for (const [seat, amt] of Object.entries(r.won)) {
      const n = Number(seat);
      if (r.showdown) best[n] = bestK(this.hand.player(n)!.cards).five;
      ev.push({ t: "win", seat: n, amt, name: names[n] ?? null });
    }
    this.result = { showdown: r.showdown, pots: r.pots, won: r.won, names, best };
    return ev;
  }

  view(deadline: number): SevenView {
    const h = this.hand;
    const shown = new Map<number, Card[]>();
    for (const s of h.result?.shows ?? []) shown.set(s.seat, s.cards);
    const players: Record<number, SevenPlayerWire> = {};
    for (const p of h.players) {
      const picked = p.chosen && this.opened;
      players[p.seat] = {
        bet: p.bet,
        invested: p.invested,
        folded: p.folded,
        allIn: p.allIn,
        last: this.last.get(p.seat) ?? null,
        up: picked ? h.upCards(p) : [],
        // 고르는 중에는 받은 4장(고른 뒤에는 3장)이 전부 엎어져 있음
        down: picked ? p.up.filter((u) => !u).length : p.chosen ? 3 : 4,
        chosen: p.chosen,
        cards: shown.get(p.seat) ?? null,
      };
    }
    const toAct = h.phase === "bet" ? h.toAct : -1;
    const waiting = h.phase === "choice" || toAct >= 0;
    return {
      game: "seven",
      ante: this.ante,
      phase: h.phase,
      round: h.round,
      boss: h.boss,
      pot: h.phase === "done" ? Object.values(h.result!.won).reduce((a, b) => a + b, 0) : h.pot,
      pots: h.phase === "done" ? h.result!.pots.map(({ amount, seats }) => ({ amount, seats })) : h.pots(),
      currentBet: h.currentBet,
      players,
      toAct,
      deadline: waiting ? deadline : 0,
      legal: toAct >= 0 ? h.legal(toAct) : null,
      result: this.result,
    };
  }

  secret(seat: number) {
    const p = this.hand.player(seat);
    if (!p) return null;
    if (!p.chosen) return { cards: [...p.dealt] };
    return { cards: [...p.cards], down: p.up.map((u, i) => (u ? -1 : i)).filter((i) => i >= 0) };
  }

  botMove(seat: number, brain: Brain): BotMove {
    const h = this.hand;
    const me = h.player(seat)!;
    if (h.phase === "choice") {
      const c = chooseSeven(me.dealt, brain);
      return { input: { a: "choose", discard: c.discard, open: c.open }, thinkMs: c.thinkMs };
    }
    const keyOf = new Map(this.seats.map((s) => [s.seat, s.key]));
    const v: SevenBotView = {
      seat,
      cards: [...me.cards],
      round: h.round,
      pot: h.pot,
      ante: h.ante,
      legal: h.legal(seat),
      players: h.players.map((p) => ({
        seat: p.seat,
        key: keyOf.get(p.seat) ?? `seat:${p.seat}`,
        up: h.upCards(p),
        folded: p.folded,
        allIn: p.allIn,
        stack: p.stack,
        bet: p.bet,
        invested: p.invested,
      })),
      history: h.history,
    };
    const d = decideSeven(v, brain);
    return { input: { a: d.type }, thinkMs: d.thinkMs, cue: d.cue };
  }

  deltas() {
    return this.hand.result?.delta ?? {};
  }
  won() {
    return this.hand.result?.won ?? {};
  }

  cueFor(seat: number): Cue | undefined {
    const r = this.hand.result;
    const p = this.hand.player(seat);
    if (!r || !p) return undefined;
    const d = r.delta[seat] ?? 0;
    const base = this.ante * 2;
    if (d >= 30 * base) return "bigWin";
    if (d > 0) return "win";
    if (d <= -20 * base) {
      const mine = r.shows.find((s) => s.seat === seat);
      return mine && kCategory(mine.score) >= KCAT.TRIPS ? "badBeat" : "lose";
    }
    return undefined;
  }

  bluffers(): number[] {
    const r = this.hand.result;
    if (!r?.showdown) return [];
    // 마지막 구에 걸었다가 받혀서, 원페어 이하를 보여 주고 진 사람
    const lastBets = this.hand.history.filter((x) => x.round === 7 && x.aggressive);
    return r.shows.filter((s) => !(r.won[s.seat] > 0) && kCategory(s.score) <= KCAT.PAIR && lastBets.some((x) => x.seat === s.seat)).map((s) => s.seat);
  }

  audit() {
    const h = this.hand;
    return {
      players: h.players.map((p) => ({ seat: p.seat, dealt: p.dealt, cards: p.cards, up: p.up, start: p.start, end: p.stack, folded: p.folded })),
      // "구 자리 행동 낸돈"
      actions: h.history.map((x) => `${x.round} ${x.seat} ${x.type} ${x.add}`),
      pots: h.result?.pots,
    };
  }
}

export const seven: GameDef = {
  kind: "seven",
  minStack: (tier) => tier.ante,
  base: (tier) => tier.ante * 2,

  start(o: StartOptions) {
    const seats = [...o.seats].sort((a, b) => a.seat - b.seat);
    const hand = new SevenHand({
      seats: seats.map((s) => ({ seat: s.seat, stack: s.stack })),
      ante: o.tier.ante,
      deck: shuffledDeck(o.randInt),
      unit: UNIT,
    });
    const round = new SevenRound(seats, o.tier.ante, hand);
    const ev: PokerEvent[] = [{ t: "hand", no: o.handNo }];
    for (const h of hand.history) if (h.type === "ante") ev.push({ t: "post", seat: h.seat, kind: "ante", amt: h.add });
    ev.push({ t: "deal", round: 3, cards: seats.flatMap((s) => [0, 1, 2, 3].map(() => ({ seat: s.seat, card: null }))) });
    return { round, ev, pause: 1500 };
  },
};
