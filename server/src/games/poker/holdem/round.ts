import { bestFive, categoryOf, CAT, evaluate, madeOf, shuffledDeck, type Card } from "../../../../../web/src/lib/poker/cards";
import { UNIT } from "../../../../../web/src/lib/poker/rules";
import type { HoldemPlayer, HoldemView, PokerEvent, ResultWire } from "../../../../../web/src/lib/poker/types";
import type { Brain, Cue } from "../personas";
import { RoundError, type BotMove, type GameDef, type Round, type RoundSeat, type StartOptions, type Step } from "../round";
import { decideHoldem, Models, type BotView } from "./bots";
import { Hand, HandError, type ActType } from "./engine";

/* 홀덤 엔진을 테이블이 쓰는 모양(Round)으로 감쌈: 입력 검사, 화면용 상태, 진행 사이의 뜸, 봇에게 보여 줄 것 */

interface Mem {
  button?: number;
  models?: Models;
}

class HoldemRound implements Round {
  private hand: Hand;
  private last = new Map<number, { a: string; amt: number }>();
  /** 올인으로 베팅이 끝나 패를 까 놓았는지 */
  private revealed = false;
  private result: ResultWire | null = null;

  constructor(
    private seats: RoundSeat[],
    private bb: number,
    hand: Hand
  ) {
    this.hand = hand;
  }

  get engine(): Hand {
    return this.hand;
  }

  waiting(): number[] {
    return this.hand.phase === "bet" && this.hand.toAct >= 0 ? [this.hand.toAct] : [];
  }
  waitKind(): "act" {
    return "act";
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

  private apply(seat: number, type: ActType, amount = 0): PokerEvent[] {
    const before = this.hand.currentBet;
    let item;
    try {
      item = this.hand.act(seat, type, amount);
    } catch (e) {
      if (e instanceof HandError) throw new RoundError(e.message);
      throw e;
    }
    const a = item.allIn && item.add > 0 ? "allin" : type === "raise" ? (before === 0 ? "bet" : "raise") : type;
    this.last.set(seat, { a, amt: type === "fold" || type === "check" ? 0 : item.to });
    const ev: PokerEvent[] = [{ t: "act", seat, a, amt: item.add, allIn: item.allIn }];
    if (this.hand.phase === "done") ev.push(...this.finish());
    return ev;
  }

  act(seat: number, input: unknown): PokerEvent[] {
    const o = (input ?? {}) as { a?: unknown; amt?: unknown };
    if (o.a !== "fold" && o.a !== "check" && o.a !== "call" && o.a !== "raise") throw new RoundError("알 수 없는 행동입니다.");
    const amt = o.a === "raise" ? Number(o.amt) : 0;
    if (o.a === "raise" && !Number.isSafeInteger(amt)) throw new RoundError("금액이 잘못됐습니다.");
    return this.apply(seat, o.a, amt);
  }

  timeout(seat: number, fold = false): PokerEvent[] {
    return this.apply(seat, !fold && this.hand.legal(seat).canCheck ? "check" : "fold");
  }

  step(): Step {
    const h = this.hand;
    if (h.phase !== "deal") throw new RoundError("진행할 것이 없습니다.");
    // 올인으로 베팅이 끝났으면 먼저 패를 다 깜
    if (h.runout && !this.revealed) {
      this.revealed = true;
      const ev: PokerEvent[] = h.live.map((p) => ({ t: "show", seat: p.seat, cards: [...p.cards], name: "" }));
      return { ev, pause: 1400 };
    }
    if (h.street === 3) {
      h.advance();
      return { ev: this.finish(), pause: 0 };
    }
    const cards = h.advance();
    this.last.clear();
    return { ev: [{ t: "board", street: h.street, cards }], pause: h.runout ? 1700 : h.street === 1 ? 1100 : 800 };
  }

  /** 끝났을 때의 이벤트와 결과 */
  private finish(): PokerEvent[] {
    const r = this.hand.result!;
    const ev: PokerEvent[] = [];
    const names: Record<number, string> = {};
    const best: Record<number, Card[]> = {};
    for (const s of r.shows) {
      if (s.cards) {
        names[s.seat] = s.name;
        if (!this.revealed) ev.push({ t: "show", seat: s.seat, cards: [...s.cards], name: s.name });
      } else ev.push({ t: "muck", seat: s.seat });
    }
    for (const [seat, amt] of Object.entries(r.won)) {
      const n = Number(seat);
      if (r.showdown) best[n] = madeOf(bestFive([...this.hand.player(n)!.cards, ...r.board]));
      ev.push({ t: "win", seat: n, amt, name: names[n] ?? null });
    }
    this.result = { showdown: r.showdown, pots: r.pots, won: r.won, names, best };
    return ev;
  }

  view(deadline: number): HoldemView {
    const h = this.hand;
    const shown = new Map<number, [Card, Card]>();
    if (this.revealed) for (const p of h.live) shown.set(p.seat, p.cards);
    for (const s of h.result?.shows ?? []) if (s.cards) shown.set(s.seat, s.cards);
    const players: Record<number, HoldemPlayer> = {};
    for (const p of h.players)
      players[p.seat] = {
        bet: p.bet,
        invested: p.invested,
        folded: p.folded,
        allIn: p.allIn,
        last: this.last.get(p.seat) ?? null,
        cards: shown.get(p.seat) ?? null,
      };
    const toAct = h.phase === "bet" ? h.toAct : -1;
    return {
      game: "holdem",
      button: h.button,
      sbSeat: h.sbSeat,
      bbSeat: h.bbSeat,
      bb: this.bb,
      street: h.street,
      board: h.board.slice(),
      pot: h.phase === "done" ? Object.values(h.result!.won).reduce((a, b) => a + b, 0) : h.pot,
      pots: h.phase === "done" ? h.result!.pots.map(({ amount, seats }) => ({ amount, seats })) : h.pots(),
      currentBet: h.currentBet,
      players,
      toAct,
      deadline: toAct >= 0 ? deadline : 0,
      legal: toAct >= 0 ? h.legal(toAct) : null,
      result: this.result,
    };
  }

  secret(seat: number) {
    const p = this.hand.player(seat);
    return p ? { cards: [...p.cards] } : null;
  }

  botMove(seat: number, brain: Brain, models: Models = new Models()): BotMove {
    const h = this.hand;
    const me = h.player(seat)!;
    const keyOf = new Map(this.seats.map((s) => [s.seat, s.key]));
    // 봇에게 넘기는 것: 자기 패 + 모두가 보는 것만
    const v: BotView = {
      seat,
      cards: me.cards,
      board: h.board.slice(),
      street: h.street,
      pot: h.pot,
      sb: h.sb,
      bb: h.bb,
      unit: h.unit,
      currentBet: h.currentBet,
      legal: h.legal(seat),
      button: h.button,
      sbSeat: h.sbSeat,
      bbSeat: h.bbSeat,
      players: h.players.map((p) => ({
        seat: p.seat,
        key: keyOf.get(p.seat) ?? `seat:${p.seat}`,
        stack: p.stack,
        bet: p.bet,
        invested: p.invested,
        folded: p.folded,
        allIn: p.allIn,
      })),
      history: h.history,
    };
    const d = decideHoldem(v, brain, models);
    return { input: { a: d.type, amt: d.amount }, thinkMs: d.thinkMs, cue: d.cue };
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
    if (d >= 30 * this.bb) return "bigWin";
    if (d > 0) return "win";
    if (d <= -20 * this.bb) {
      // 투페어 이상을 들고 쇼다운에서 크게 졌으면 억울한 판
      const strong = r.showdown && !p.folded && categoryOf(evaluate([...p.cards, ...r.board])) >= CAT.TWO_PAIR;
      return strong ? "badBeat" : "lose";
    }
    return undefined;
  }

  bluffers(): number[] {
    const r = this.hand.result;
    if (!r?.showdown) return [];
    // 리버에 걸었다가 받혀서, 하이카드·낮은 페어를 보여 주고 진 사람
    const river = this.hand.history.filter((x) => x.street === 3 && x.type === "raise");
    const out: number[] = [];
    for (const s of r.shows) {
      if (!s.cards || (r.won[s.seat] ?? 0) > 0) continue;
      if (river.some((x) => x.seat === s.seat) && categoryOf(s.score) <= CAT.PAIR) out.push(s.seat);
    }
    return out;
  }

  audit() {
    const h = this.hand;
    return {
      button: h.button,
      board: h.board,
      players: h.players.map((p) => ({ seat: p.seat, cards: p.cards, start: p.start, end: p.stack, folded: p.folded })),
      // "구간 자리 행동 낸돈"
      actions: h.history.map((x) => `${x.street} ${x.seat} ${x.type} ${x.add}`),
      pots: h.result?.pots,
    };
  }

  history() {
    return this.hand.history;
  }
}

export const holdem: GameDef = {
  kind: "holdem",
  // 한 판에 적어도 기본 판돈 + 빅블라인드는 있어야 함
  minStack: (tier) => tier.ante + tier.bb,
  base: (tier) => tier.bb,

  start(o: StartOptions) {
    const mem = o.mem as Mem;
    const seats = [...o.seats].sort((a, b) => a.seat - b.seat);
    // 버튼은 지난 판 버튼의 다음 참가자
    const prev = mem.button ?? seats[o.randInt(seats.length)].seat - 1;
    const button = (seats.find((s) => s.seat > prev) ?? seats[0]).seat;
    mem.button = button;
    const models = (mem.models ??= new Models());
    const hand = new Hand({
      seats: seats.map((s) => ({ seat: s.seat, stack: s.stack })),
      button,
      sb: o.tier.sb,
      bb: o.tier.bb,
      ante: o.tier.ante,
      deck: shuffledDeck(o.randInt),
      unit: UNIT,
    });
    const round = new HoldemRound(seats, o.tier.bb, hand);
    // 봇은 테이블의 상대 기록을 같이 봄
    const base = round.botMove.bind(round);
    round.botMove = (seat, brain) => base(seat, brain, models);
    const ev: PokerEvent[] = [{ t: "hand", no: o.handNo }];
    for (const h of hand.history) if (h.type === "ante" || h.type === "sb" || h.type === "bb") ev.push({ t: "post", seat: h.seat, kind: h.type, amt: h.add });
    return { round, ev, pause: 1800 }; // 화면에서 카드 나눠 주는 시간
  },

  learn(round, mem, keyOf) {
    const r = round as HoldemRound;
    ((mem as Mem).models ??= new Models()).observe(
      r.history(),
      keyOf,
      r.engine.players.map((p) => p.seat)
    );
  },
};
