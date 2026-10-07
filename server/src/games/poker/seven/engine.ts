import type { Card } from "../../../../../web/src/lib/poker/cards";
import { autoChoice, evaluateK, handNameK, openRank } from "../../../../../web/src/lib/poker/seven";

/*
 * 7포커 한 판 (한게임식). 홀덤 엔진처럼 소켓·DB·타이머를 모르는 순수 로직.
 *
 * 흐름
 *   앤티 → 4장씩 받음 → [고르기] 1장 버리고 1장 폄 (동시에)
 *   → 4구(편 카드) · 베팅 → 5구 · 베팅 → 6구 · 베팅 → 7구(엎은 카드) · 베팅 → 쇼다운
 * 룰
 *   - 구마다 펴 놓은 카드가 가장 높은 사람(보스)부터 시계 방향
 *   - 베팅: 다이 / 체크(앞에 벳이 없을 때) / 콜 / 삥(첫 벳, 앤티만큼) / 따당(받을 돈의 2배) / 쿼터 · 하프 · 풀(콜 + 팟의 1/4 · 1/2 · 전부)
 *   - 한 사람이 한 구에 걸거나 올릴 수 있는 건 2번까지
 *   - 돈이 모자라면 있는 만큼 올인, 올인 금액이 다르면 사이드팟. 받는 사람 없는 벳은 돌려줌
 *   - 쇼다운은 남은 사람 전부 공개, 한국식 족보(마운틴 > 백스트레이트, 무늬 ♠ > ◆ > ♥ > ♣)
 */

export type SevenBet = "bbing" | "ddadang" | "quarter" | "half" | "full";
export type SevenAct = "die" | "check" | "call" | SevenBet;
export type SevenPhase = "choice" | "bet" | "deal" | "done";
export const RAISES_PER_ROUND = 2;

export interface SevenPlayer {
  seat: number;
  stack: number;
  start: number;
  bet: number;
  invested: number;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  /** 이번 구에 걸거나 올린 횟수 */
  raises: number;
  /** 처음 받은 4장 */
  dealt: Card[];
  chosen: boolean;
  /** 가진 카드 (받은 순서) 와, 그 카드가 펴져 있는지 */
  cards: Card[];
  up: boolean[];
}

export interface SevenLegal {
  canCheck: boolean;
  toCall: number;
  bets: Partial<Record<SevenBet, number>>;
}

export interface SevenHistory {
  round: number;
  seat: number;
  type: SevenAct | "ante";
  aggressive: boolean;
  add: number;
  potBefore: number;
  toCallBefore: number;
  allIn: boolean;
}

export interface SevenResult {
  showdown: boolean;
  pots: { amount: number; seats: number[]; winners: number[] }[];
  shows: { seat: number; cards: Card[]; score: number; name: string }[];
  won: Record<number, number>;
  delta: Record<number, number>;
}

export class SevenError extends Error {}

export interface SevenOptions {
  seats: { seat: number; stack: number }[];
  ante: number;
  deck: Card[];
  unit?: number;
}

export class SevenHand {
  readonly players: SevenPlayer[];
  readonly ante: number;
  readonly unit: number;
  phase: SevenPhase = "choice";
  /** 지금 몇 구인지 (3 = 고르는 중, 4~7) */
  round = 3;
  boss = -1;
  currentBet = 0;
  toAct = -1;
  history: SevenHistory[] = [];
  result: SevenResult | null = null;
  private deck: Card[];

  constructor(o: SevenOptions) {
    if (o.seats.length < 2) throw new SevenError("두 명 이상 필요합니다.");
    if (o.seats.length * 8 > 52) throw new SevenError("인원이 너무 많습니다.");
    if (o.seats.some((s) => !(s.stack > 0))) throw new SevenError("칩이 없는 자리가 있습니다.");
    if (new Set(o.seats.map((s) => s.seat)).size !== o.seats.length) throw new SevenError("자리가 겹칩니다.");
    if (!Number.isSafeInteger(o.ante) || o.ante <= 0) throw new SevenError("기본 판돈이 잘못됐습니다.");
    this.ante = o.ante;
    this.unit = o.unit ?? 1;
    this.deck = o.deck.slice();
    this.players = [...o.seats]
      .sort((a, b) => a.seat - b.seat)
      .map((s) => ({
        seat: s.seat,
        stack: s.stack,
        start: s.stack,
        bet: 0,
        invested: 0,
        folded: false,
        allIn: false,
        acted: false,
        raises: 0,
        dealt: [],
        chosen: false,
        cards: [],
        up: [],
      }));
    for (const p of this.players) {
      const potBefore = this.pot;
      const add = Math.min(this.ante, p.stack);
      this.pay(p, add);
      // 앤티는 구별 벳이 아니라 팟으로 바로 들어감
      p.bet = 0;
      this.history.push({ round: 3, seat: p.seat, type: "ante", aggressive: false, add, potBefore, toCallBefore: 0, allIn: p.allIn });
    }
    for (let i = 0; i < 4; i++) for (const p of this.players) p.dealt.push(this.draw());
  }

  // ───────────── 조회 ─────────────

  player(seat: number): SevenPlayer | undefined {
    return this.players.find((p) => p.seat === seat);
  }
  get pot(): number {
    let s = 0;
    for (const p of this.players) s += p.invested;
    return s;
  }
  get live(): SevenPlayer[] {
    return this.players.filter((p) => !p.folded);
  }
  /** 펴 놓은 카드 */
  upCards(p: SevenPlayer): Card[] {
    return p.cards.filter((_, i) => p.up[i]);
  }
  /** 아직 고르지 않은 사람들 */
  choosing(): number[] {
    return this.phase === "choice" ? this.live.filter((p) => !p.chosen).map((p) => p.seat) : [];
  }

  private ableOthers(p: SevenPlayer): boolean {
    return this.players.some((q) => q !== p && !q.folded && !q.allIn);
  }
  /** 실제로 맞춰야 하는 금액 (나머지가 전부 올인이면 그중 가장 많이 낸 사람까지만) */
  private owed(p: SevenPlayer): number {
    if (this.ableOthers(p)) return Math.max(0, this.currentBet - p.bet);
    let top = 0;
    for (const q of this.players) if (q !== p && !q.folded) top = Math.max(top, q.bet);
    return Math.max(0, top - p.bet);
  }

  legal(seat: number): SevenLegal {
    const p = this.player(seat);
    if (!p || p.folded || p.allIn || this.phase !== "bet") return { canCheck: false, toCall: 0, bets: {} };
    const owed = this.owed(p);
    const toCall = Math.min(p.stack, owed);
    const bets: SevenLegal["bets"] = {};
    if (p.raises < RAISES_PER_ROUND && this.ableOthers(p) && p.stack > owed) {
      const pot = this.pot + owed; // 콜한 뒤의 팟
      const floor = (v: number) => Math.floor(v / this.unit) * this.unit;
      // 올리는 폭은 적어도 앤티만큼, 가진 돈을 넘으면 올인
      const add = (raise: number) => Math.min(p.stack, owed + Math.max(this.ante, floor(raise)));
      if (this.currentBet === 0) bets.bbing = add(this.ante);
      // 따당은 받을 돈의 정확히 2배 (단위에 안 맞는 올인을 받는 경우에도)
      else if (owed > 0) bets.ddadang = Math.min(p.stack, owed + Math.max(this.ante, owed));
      bets.quarter = add(pot / 4);
      bets.half = add(pot / 2);
      bets.full = add(pot);
    }
    return { canCheck: owed === 0, toCall, bets };
  }

  pots(): { amount: number; seats: number[] }[] {
    const live = this.players.filter((p) => !p.folded);
    const levels = [...new Set(live.map((p) => p.invested))].filter((v) => v > 0).sort((a, b) => a - b);
    const out: { amount: number; seats: number[] }[] = [];
    let prev = 0;
    for (const lv of levels) {
      let amount = 0;
      for (const p of this.players) amount += Math.min(p.invested, lv) - Math.min(p.invested, prev);
      const seats = live.filter((p) => p.invested >= lv).map((p) => p.seat);
      const last = out[out.length - 1];
      if (last && last.seats.length === seats.length && last.seats.every((s, i) => s === seats[i])) last.amount += amount;
      else if (amount > 0) out.push({ amount, seats });
      prev = lv;
    }
    let rest = 0;
    for (const p of this.players) rest += Math.max(0, p.invested - prev);
    if (rest > 0) {
      if (out.length) out[out.length - 1].amount += rest;
      else out.push({ amount: rest, seats: live.map((p) => p.seat) });
    }
    return out;
  }

  // ───────────── 고르기 ─────────────

  /** 받은 4장 중 버릴 카드와 펼 카드 (위치 0~3) */
  choose(seat: number, discard: number, open: number) {
    const p = this.player(seat);
    if (this.phase !== "choice" || !p || p.folded || p.chosen) throw new SevenError("지금은 고를 수 없습니다.");
    const ok = (i: number) => Number.isInteger(i) && i >= 0 && i < 4;
    if (!ok(discard) || !ok(open) || discard === open) throw new SevenError("버릴 카드와 펼 카드를 다르게 골라주세요.");
    // 엎은 2장을 앞에, 편 1장을 뒤에 (받은 순서는 유지)
    const down = p.dealt.filter((_, i) => i !== discard && i !== open);
    p.cards = [...down, p.dealt[open]];
    p.up = [false, false, true];
    p.chosen = true;
    if (!this.choosing().length) this.phase = "deal";
  }

  /** 시간 안에 못 고른 사람은 기본 선택으로 */
  autoChoose(seat: number) {
    const p = this.player(seat);
    if (!p) throw new SevenError("참가자가 아닙니다.");
    const c = autoChoice(p.dealt);
    this.choose(seat, c.discard, c.open);
  }

  // ───────────── 베팅 ─────────────

  act(seat: number, type: SevenAct): SevenHistory {
    const p = this.player(seat);
    if (!p) throw new SevenError("참가자가 아닙니다.");
    // 다이는 고르는 중에도 가능 (자리를 뜬 사람)
    if (type === "die" && this.phase === "choice" && !p.folded) return this.fold(p);
    if (this.phase !== "bet" || this.toAct !== seat) throw new SevenError("지금은 차례가 아닙니다.");
    const lg = this.legal(seat);
    const potBefore = this.pot;
    let add = 0;
    let aggressive = false;
    if (type === "die") return this.fold(p);
    if (type === "check") {
      if (!lg.canCheck) throw new SevenError("체크할 수 없습니다.");
    } else if (type === "call") {
      if (lg.canCheck || lg.toCall <= 0) throw new SevenError("콜할 금액이 없습니다.");
      add = lg.toCall;
    } else {
      const amount = Object.hasOwn(lg.bets, type) ? lg.bets[type] : undefined;
      if (typeof amount !== "number") throw new SevenError("지금은 그 베팅을 할 수 없습니다.");
      add = amount;
      aggressive = p.bet + add > this.currentBet;
    }
    if (add > 0) this.pay(p, add);
    if (aggressive) {
      this.currentBet = p.bet;
      p.raises++;
    }
    p.acted = true;
    const item: SevenHistory = { round: this.round, seat, type, aggressive, add, potBefore, toCallBefore: lg.toCall, allIn: p.allIn };
    this.history.push(item);
    this.toAct = this.next(seat);
    if (this.toAct < 0) this.closeRound();
    return item;
  }

  private fold(p: SevenPlayer): SevenHistory {
    const item: SevenHistory = { round: this.round, seat: p.seat, type: "die", aggressive: false, add: 0, potBefore: this.pot, toCallBefore: this.phase === "bet" ? this.legal(p.seat).toCall : 0, allIn: false };
    p.folded = true;
    p.acted = true;
    this.history.push(item);
    if (this.live.length === 1) {
      this.finishByFold();
      return item;
    }
    if (this.phase === "choice") {
      if (!this.choosing().length) this.phase = "deal";
      return item;
    }
    if (this.toAct === p.seat) {
      this.toAct = this.next(p.seat);
      if (this.toAct < 0) this.closeRound();
    }
    return item;
  }

  /** 다음 카드를 돌리거나(4~7구), 7구 베팅까지 끝났으면 쇼다운. 돌린 카드를 돌려줌 */
  advance(): { seat: number; card: Card; up: boolean }[] {
    if (this.phase !== "deal") throw new SevenError("카드를 돌릴 차례가 아닙니다.");
    if (this.round === 7) {
      this.showdown();
      return [];
    }
    this.round++;
    const up = this.round < 7;
    const dealt: { seat: number; card: Card; up: boolean }[] = [];
    for (const p of this.live) {
      const card = this.draw();
      p.cards.push(card);
      p.up.push(up);
      dealt.push({ seat: p.seat, card, up });
    }
    for (const p of this.players) {
      p.bet = 0;
      p.acted = false;
      p.raises = 0;
    }
    this.currentBet = 0;
    this.boss = this.findBoss();
    const able = this.players.filter((p) => !p.folded && !p.allIn).length;
    if (able >= 2) {
      this.phase = "bet";
      const b = this.player(this.boss)!;
      this.toAct = !b.allIn ? this.boss : this.next(this.boss);
    } else {
      this.toAct = -1;
      this.phase = "deal";
    }
    return dealt;
  }

  // ───────────── 내부 ─────────────

  private draw(): Card {
    const c = this.deck.pop();
    if (c === undefined) throw new SevenError("덱이 비었습니다.");
    return c;
  }
  private after(seat: number): SevenPlayer {
    for (const p of this.players) if (p.seat > seat) return p;
    return this.players[0];
  }
  private pay(p: SevenPlayer, amount: number) {
    const a = Math.min(amount, p.stack);
    p.stack -= a;
    p.bet += a;
    p.invested += a;
    if (p.stack === 0) p.allIn = true;
  }

  /** 펴 놓은 카드가 가장 높은 사람 */
  private findBoss(): number {
    let best = -1;
    let seat = -1;
    for (const p of this.live) {
      const r = openRank(this.upCards(p));
      if (r > best) {
        best = r;
        seat = p.seat;
      }
    }
    return seat;
  }

  private next(from: number): number {
    let p = this.after(from);
    for (let i = 0; i < this.players.length; i++) {
      if (!p.folded && !p.allIn && (!p.acted || p.bet < this.currentBet)) {
        if (this.ableOthers(p) || this.owed(p) > 0) return p.seat;
        return -1;
      }
      p = this.after(p.seat);
    }
    return -1;
  }

  private returnUncalled() {
    let top: SevenPlayer | null = null;
    let second = 0;
    for (const p of this.players) {
      if (!top || p.invested > top.invested) {
        if (top) second = Math.max(second, top.invested);
        top = p;
      } else second = Math.max(second, p.invested);
    }
    if (!top || top.folded) return;
    const extra = top.invested - second;
    if (extra <= 0) return;
    top.invested -= extra;
    top.bet = Math.max(0, top.bet - extra);
    top.stack += extra;
    top.allIn = false;
  }

  private closeRound() {
    this.toAct = -1;
    this.returnUncalled();
    this.phase = "deal";
  }

  private deltas(): Record<number, number> {
    const d: Record<number, number> = {};
    for (const p of this.players) d[p.seat] = p.stack - p.start;
    return d;
  }

  private finishByFold() {
    this.toAct = -1;
    this.returnUncalled();
    const winner = this.live[0];
    const amount = this.pot;
    winner.stack += amount;
    this.phase = "done";
    this.result = { showdown: false, pots: [{ amount, seats: [winner.seat], winners: [winner.seat] }], shows: [], won: { [winner.seat]: amount }, delta: this.deltas() };
  }

  private showdown() {
    // 베팅 없이 여기까지 온 경우(앤티만으로 올인)에도 받는 사람 없는 몫은 돌려줌
    this.returnUncalled();
    const live = this.live;
    const score = new Map<number, number>();
    for (const p of live) score.set(p.seat, evaluateK(p.cards));
    const pots = this.pots().map((pot) => {
      let best = -1;
      for (const s of pot.seats) best = Math.max(best, score.get(s)!);
      return { ...pot, winners: pot.seats.filter((s) => score.get(s) === best) };
    });
    const won: Record<number, number> = {};
    for (const pot of pots) {
      // 무늬까지 가리므로 승자는 보통 한 명. 그래도 나눠야 하면 자리 순으로 남는 칩을 줌
      const unit = pot.amount % this.unit === 0 ? this.unit : 1;
      const each = Math.floor(pot.amount / pot.winners.length / unit) * unit;
      let rest = pot.amount - each * pot.winners.length;
      for (const s of pot.winners) {
        const extra = rest >= unit ? unit : 0;
        rest -= extra;
        won[s] = (won[s] ?? 0) + each + extra;
      }
    }
    for (const p of this.players) p.stack += won[p.seat] ?? 0;
    // 보스부터 차례로 깜
    const shows = [...live]
      .sort((a, b) => score.get(b.seat)! - score.get(a.seat)!)
      .map((p) => ({ seat: p.seat, cards: [...p.cards], score: score.get(p.seat)!, name: handNameK(score.get(p.seat)!) }));
    this.phase = "done";
    this.result = { showdown: true, pots, shows, won, delta: this.deltas() };
  }
}
