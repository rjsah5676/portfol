import { evaluate, handName, type Card } from "../../../../../web/src/lib/poker/cards";

/*
 * 노리밋 텍사스 홀덤 한 판 (서버 메모리 안의 순수 로직 — 소켓·DB·타이머를 모름).
 *
 * 흐름: new Hand(…) → [act(seat, …) 를 toAct 가 없어질 때까지] → advance() 로 다음 카드 → … → phase 가 "done" 이면 result
 * 진행 속도(카드 까는 사이의 뜸)는 테이블(index.ts)이 advance() 를 부르는 시점으로 정함.
 *
 * 적용한 룰
 *  - 버튼 다음이 SB, 그다음이 BB. 둘만 남으면 버튼이 SB 이고 프리플랍에 먼저 행동, 플랍부터는 BB 가 먼저
 *  - 블라인드를 다 못 내면 있는 만큼만 내고 올인. 콜 금액은 그래도 BB 전액
 *  - 최소 벳 = BB, 최소 레이즈 = 직전 벳·레이즈가 올린 폭. 올인은 그보다 적어도 됨
 *  - 최소 레이즈에 못 미치는 올인은, 이미 행동한 사람에게 레이즈 기회를 다시 주지 않음 (콜·폴드만).
 *    못 미치는 올인이 여러 번 쌓여 한 번의 레이즈 폭 이상이 되면 다시 열림
 *  - 받는 사람이 없는 벳은 돌려줌. 올인 금액이 다르면 사이드팟
 *  - 쇼다운: 마지막 베팅 라운드에 마지막으로 벳·레이즈한 사람부터, 없으면 버튼 왼쪽부터 차례로 깜.
 *    앞에서 깐 패를 못 이기고 받을 팟도 없으면 덮음(머크). 올인한 사람이 있는 판은 전부 깜
 *  - 팟을 나눌 때 남는 칩은 버튼 왼쪽에서 가까운 승자부터
 */

export type ActType = "fold" | "check" | "call" | "raise";
export type Phase = "bet" | "deal" | "done";
/** 0 프리플랍 · 1 플랍 · 2 턴 · 3 리버 */
export type Street = 0 | 1 | 2 | 3;

export interface HandPlayer {
  seat: number;
  /** 지금 손에 남은 칩 */
  stack: number;
  /** 판을 시작할 때의 칩 */
  start: number;
  /** 이번 베팅 라운드에 낸 돈 */
  bet: number;
  /** 이 판에 낸 돈 전부 */
  invested: number;
  folded: boolean;
  allIn: boolean;
  /** 이번 베팅 라운드에 행동을 했는지 */
  acted: boolean;
  /** 마지막으로 행동했을 때의 콜 금액 (레이즈 기회가 다시 열렸는지 판단) */
  responded: number;
  cards: [Card, Card];
}

export interface Legal {
  toCall: number;
  canCheck: boolean;
  canRaise: boolean;
  /** 레이즈할 때 이번 라운드 총액의 최소·최대 (max = 올인). min > max 일 수 없게 맞춰 둠 */
  minTo: number;
  maxTo: number;
}

/** 기록 (봇이 상대 레인지를 좁힐 때 · 핸드 로그) */
export interface HistoryItem {
  street: Street;
  seat: number;
  type: "ante" | "sb" | "bb" | ActType;
  /** 벳·레이즈인지 (콜 금액보다 더 냄) */
  aggressive: boolean;
  /** 이 행동으로 낸 돈 */
  add: number;
  /** 행동 뒤 그 사람의 이번 라운드 총액 */
  to: number;
  /** 행동 직전의 팟 전체(이번 라운드 벳 포함)와 콜 금액 */
  potBefore: number;
  toCallBefore: number;
  allIn: boolean;
}

export interface Pot {
  amount: number;
  /** 이 팟을 가져갈 자격이 있는 자리 */
  seats: number[];
}

export interface Show {
  seat: number;
  /** 깠으면 카드, 덮었으면 null */
  cards: [Card, Card] | null;
  score: number;
  name: string;
}

export interface HandResult {
  /** 폴드로 끝났으면 false (아무도 패를 안 깜) */
  showdown: boolean;
  pots: (Pot & { winners: number[] })[];
  /** 깐 순서대로 */
  shows: Show[];
  /** 자리 → 받은 돈 (팟에서 가져간 합계) */
  won: Record<number, number>;
  /** 자리 → 이 판의 증감 (끝났을 때 칩 − 시작할 때 칩) */
  delta: Record<number, number>;
  board: Card[];
}

export class HandError extends Error {}

export interface HandOptions {
  /** 이 판에 참가하는 자리들 (2명 이상, 칩이 있는 사람만) */
  seats: { seat: number; stack: number }[];
  /** 버튼 자리 (참가자 중 하나) */
  button: number;
  sb: number;
  bb: number;
  /** 기본 판돈: 판 시작할 때 전원이 내는 돈 (팟에만 들어가고 콜 금액에는 안 셈) */
  ante?: number;
  /** 섞어 둔 덱 (뒤에서부터 뽑음) */
  deck: Card[];
  /** 베팅 단위 (올인이 아니면 이 배수로만) */
  unit?: number;
}

export class Hand {
  readonly players: HandPlayer[];
  readonly button: number;
  readonly sbSeat: number;
  readonly bbSeat: number;
  readonly sb: number;
  readonly bb: number;
  readonly ante: number;
  readonly unit: number;
  board: Card[] = [];
  street: Street = 0;
  phase: Phase = "bet";
  /** 이번 라운드의 콜 금액 (각자 여기까지 맞춰야 함) */
  currentBet = 0;
  /** 마지막 벳·레이즈가 올린 폭 (다음 최소 레이즈 폭) */
  lastRaise: number;
  /** 지금 행동할 자리 (-1 = 없음) */
  toAct = -1;
  /** 이번 라운드에 마지막으로 벳·레이즈한 자리 */
  aggressor = -1;
  /** 프리플랍에 마지막으로 레이즈한 자리 (없으면 -1) */
  preflopAggressor = -1;
  /** 베팅이 더 없을 때(올인) 패를 까 놓고 남은 카드를 까는 중 */
  runout = false;
  history: HistoryItem[] = [];
  result: HandResult | null = null;
  private deck: Card[];

  constructor(o: HandOptions) {
    if (o.seats.length < 2) throw new HandError("두 명 이상 필요합니다.");
    if (o.seats.some((s) => !(s.stack > 0))) throw new HandError("칩이 없는 자리가 있습니다.");
    if (new Set(o.seats.map((s) => s.seat)).size !== o.seats.length) throw new HandError("자리가 겹칩니다.");
    this.sb = o.sb;
    this.bb = o.bb;
    this.ante = o.ante ?? 0;
    this.unit = o.unit ?? 1;
    this.lastRaise = o.bb;
    this.deck = o.deck.slice();
    this.button = o.button;
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
        responded: 0,
        cards: [-1, -1] as [Card, Card],
      }));
    if (!this.player(o.button)) throw new HandError("버튼 자리에 참가자가 없습니다.");

    const n = this.players.length;
    // 둘이면 버튼이 SB
    this.sbSeat = n === 2 ? o.button : this.after(o.button).seat;
    this.bbSeat = this.after(this.sbSeat).seat;

    // 카드는 SB 부터 한 장씩 두 바퀴
    for (let round = 0; round < 2; round++) {
      let p = this.player(this.sbSeat)!;
      for (let i = 0; i < n; i++) {
        p.cards[round] = this.draw();
        p = this.after(p.seat);
      }
    }

    if (this.ante > 0) for (const p of this.players) this.postAnte(p);
    this.post(this.sbSeat, this.sb, "sb");
    this.post(this.bbSeat, this.bb, "bb");
    // 블라인드를 다 못 냈어도 콜 금액은 BB 전액
    this.currentBet = this.bb;
    this.toAct = this.next(this.bbSeat);
    if (this.toAct < 0) this.closeRound();
  }

  // ───────────── 조회 ─────────────

  player(seat: number): HandPlayer | undefined {
    return this.players.find((p) => p.seat === seat);
  }

  /** 지금까지 팟에 들어간 돈 전부 (이번 라운드 벳 포함) */
  get pot(): number {
    let s = 0;
    for (const p of this.players) s += p.invested;
    return s;
  }

  /** 아직 안 죽은 사람들 */
  get live(): HandPlayer[] {
    return this.players.filter((p) => !p.folded);
  }

  /** 나 말고 아직 더 걸 수 있는 사람이 있는지 */
  private ableOthers(p: HandPlayer): boolean {
    return this.players.some((q) => q !== p && !q.folded && !q.allIn);
  }

  /**
   * 실제로 맞춰야 하는 금액. 보통은 콜 금액까지지만, 나머지가 전부 올인이면 그중 가장 많이 낸 사람까지만
   * (그보다 더 내 봐야 받을 사람이 없어 돌려받음 — 예: 블라인드를 다 못 낸 올인)
   */
  private owed(p: HandPlayer): number {
    if (this.ableOthers(p)) return Math.max(0, this.currentBet - p.bet);
    let top = 0;
    for (const q of this.players) if (q !== p && !q.folded) top = Math.max(top, q.bet);
    return Math.max(0, top - p.bet);
  }

  legal(seat: number): Legal {
    const p = this.player(seat);
    if (!p || p.folded || p.allIn) return { toCall: 0, canCheck: false, canRaise: false, minTo: 0, maxTo: 0 };
    const owed = this.owed(p);
    const toCall = Math.min(p.stack, owed);
    const maxTo = p.bet + p.stack;
    // 레이즈 기회: 이번 라운드에 아직 행동을 안 했거나, 내가 행동한 뒤로 한 번의 레이즈 폭 이상 올랐을 때
    const reopened = !p.acted || this.currentBet - p.responded >= this.lastRaise;
    // 나 말고 더 걸 수 있는 사람이 있어야 레이즈가 의미가 있음
    const canRaise = reopened && this.ableOthers(p) && maxTo > this.currentBet;
    // 올인이 끼면 콜 금액이 단위에 안 맞을 수 있음 → 최소 레이즈는 단위로 올림 (가진 칩을 넘으면 올인)
    const minTo = Math.min(maxTo, Math.ceil((this.currentBet + this.lastRaise) / this.unit) * this.unit);
    return { toCall, canCheck: owed === 0, canRaise, minTo, maxTo };
  }

  /** 지금 기준으로 팟을 나눔 (메인·사이드). 화면 표시와 정산이 같은 계산을 씀 */
  pots(): Pot[] {
    const live = this.players.filter((p) => !p.folded);
    const levels = [...new Set(live.map((p) => p.invested))].filter((v) => v > 0).sort((a, b) => a - b);
    const out: Pot[] = [];
    let prev = 0;
    for (const lv of levels) {
      let amount = 0;
      for (const p of this.players) amount += Math.min(p.invested, lv) - Math.min(p.invested, prev);
      const seats = live.filter((p) => p.invested >= lv).map((p) => p.seat);
      const last = out[out.length - 1];
      // 자격이 같은 팟은 하나로
      if (last && last.seats.length === seats.length && last.seats.every((s, i) => s === seats[i])) last.amount += amount;
      else if (amount > 0) out.push({ amount, seats });
      prev = lv;
    }
    // 죽은 사람이 가장 많이 낸 경우는 없지만(받는 사람 없는 벳은 돌려주므로), 혹시 남으면 마지막 팟에
    let rest = 0;
    for (const p of this.players) rest += Math.max(0, p.invested - prev);
    if (rest > 0) {
      if (out.length) out[out.length - 1].amount += rest;
      else out.push({ amount: rest, seats: live.map((p) => p.seat) });
    }
    return out;
  }

  // ───────────── 진행 ─────────────

  /**
   * 행동. amount 는 raise 일 때만: 이번 라운드에 내가 낸 돈의 총액(raise to).
   * 규칙에 안 맞으면 HandError.
   */
  act(seat: number, type: ActType, amount = 0): HistoryItem {
    if (this.phase !== "bet" || this.toAct !== seat) throw new HandError("지금은 행동할 차례가 아닙니다.");
    const p = this.player(seat)!;
    const lg = this.legal(seat);
    const potBefore = this.pot;
    const toCallBefore = lg.toCall;
    let add = 0;
    let aggressive = false;

    if (type === "fold") {
      p.folded = true;
    } else if (type === "check") {
      if (!lg.canCheck) throw new HandError("체크할 수 없습니다.");
    } else if (type === "call") {
      if (lg.canCheck || lg.toCall <= 0) throw new HandError("콜할 금액이 없습니다.");
      add = lg.toCall;
    } else if (type === "raise") {
      if (!lg.canRaise) throw new HandError("레이즈할 수 없습니다.");
      if (!Number.isSafeInteger(amount)) throw new HandError("금액이 잘못됐습니다.");
      if (amount > lg.maxTo) throw new HandError("가진 칩보다 많이 걸 수 없습니다.");
      if (amount <= this.currentBet) throw new HandError("콜 금액보다 많아야 합니다.");
      const allIn = amount === lg.maxTo;
      if (!allIn) {
        if (amount < lg.minTo) throw new HandError("최소 레이즈보다 적습니다.");
        if (amount % this.unit !== 0) throw new HandError("베팅 단위에 맞지 않습니다.");
      }
      add = amount - p.bet;
      const inc = amount - this.currentBet;
      // 한 번의 레이즈 폭 이상이면 정식 레이즈 → 다음 최소 레이즈 폭이 됨. 못 미치는 올인은 폭을 그대로 둠
      if (inc >= this.lastRaise) this.lastRaise = inc;
      this.currentBet = amount;
      this.aggressor = seat;
      if (this.street === 0) this.preflopAggressor = seat;
      aggressive = true;
    } else {
      throw new HandError("알 수 없는 행동입니다.");
    }

    if (add > 0) this.pay(p, add);
    p.acted = true;
    p.responded = this.currentBet;
    const item: HistoryItem = {
      street: this.street,
      seat,
      type,
      aggressive,
      add,
      to: p.bet,
      potBefore,
      toCallBefore,
      allIn: p.allIn,
    };
    this.history.push(item);

    if (this.live.length === 1) {
      this.finishByFold();
      return item;
    }
    this.toAct = this.next(seat);
    if (this.toAct < 0) this.closeRound();
    return item;
  }

  /**
   * 베팅 라운드가 끝난 뒤: 다음 카드를 깔거나(플랍 3장·턴·리버), 리버까지 끝났으면 쇼다운.
   * 깐 카드를 돌려줌 (쇼다운으로 끝났으면 빈 배열).
   */
  advance(): Card[] {
    if (this.phase !== "deal") throw new HandError("카드를 깔 차례가 아닙니다.");
    if (this.street === 3) {
      this.showdown();
      return [];
    }
    this.street = (this.street + 1) as Street;
    const dealt: Card[] = [];
    this.draw(); // 번 카드
    for (let i = 0; i < (this.street === 1 ? 3 : 1); i++) dealt.push(this.draw());
    this.board.push(...dealt);

    for (const p of this.players) {
      p.bet = 0;
      p.acted = false;
      p.responded = 0;
    }
    this.currentBet = 0;
    this.lastRaise = this.bb;
    this.aggressor = -1;

    // 걸 수 있는 사람이 둘 이상이어야 베팅이 있음
    const able = this.players.filter((p) => !p.folded && !p.allIn).length;
    if (able >= 2) {
      this.phase = "bet";
      this.toAct = this.next(this.button);
    } else {
      this.runout = true;
      this.toAct = -1;
      this.phase = "deal";
    }
    return dealt;
  }

  // ───────────── 내부 ─────────────

  private draw(): Card {
    const c = this.deck.pop();
    if (c === undefined) throw new HandError("덱이 비었습니다.");
    return c;
  }

  /** seat 다음(시계 방향) 참가자 */
  private after(seat: number): HandPlayer {
    const ps = this.players;
    for (const p of ps) if (p.seat > seat) return p;
    return ps[0];
  }

  private pay(p: HandPlayer, amount: number) {
    const a = Math.min(amount, p.stack);
    p.stack -= a;
    p.bet += a;
    p.invested += a;
    if (p.stack === 0) p.allIn = true;
  }

  private post(seat: number, blind: number, type: "sb" | "bb") {
    const p = this.player(seat)!;
    const potBefore = this.pot;
    const add = Math.min(blind, p.stack);
    this.pay(p, add);
    this.history.push({ street: 0, seat, type, aggressive: false, add, to: p.bet, potBefore, toCallBefore: 0, allIn: p.allIn });
  }

  /** 기본 판돈: 팟에 바로 들어감 (이번 라운드 벳이 아님) */
  private postAnte(p: HandPlayer) {
    const potBefore = this.pot;
    const add = Math.min(this.ante, p.stack);
    p.stack -= add;
    p.invested += add;
    if (p.stack === 0) p.allIn = true;
    this.history.push({ street: 0, seat: p.seat, type: "ante", aggressive: false, add, to: 0, potBefore, toCallBefore: 0, allIn: p.allIn });
  }

  /** from 다음부터 돌면서 행동해야 하는 사람 (없으면 -1) */
  private next(from: number): number {
    let p = this.after(from);
    for (let i = 0; i < this.players.length; i++) {
      if (!p.folded && !p.allIn && (!p.acted || p.bet < this.currentBet)) {
        // 나머지가 전부 올인이고 맞출 것도 없으면 행동할 일이 없음
        if (this.ableOthers(p) || this.owed(p) > 0) return p.seat;
        return -1;
      }
      p = this.after(p.seat);
    }
    return -1;
  }

  /** 받는 사람이 없는 벳을 돌려줌: 이번 판에 가장 많이 낸 사람이 둘째보다 더 낸 만큼 */
  private returnUncalled() {
    let top: HandPlayer | null = null;
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
    // 더 걸 수 있는 사람이 하나 이하면 남은 카드는 패를 까 놓고 진행
    if (this.players.filter((p) => !p.folded && !p.allIn).length < 2 && this.street < 3) this.runout = true;
  }

  private finishByFold() {
    this.toAct = -1;
    this.returnUncalled();
    const winner = this.live[0];
    const amount = this.pot;
    winner.stack += amount;
    this.phase = "done";
    this.result = {
      showdown: false,
      pots: [{ amount, seats: [winner.seat], winners: [winner.seat] }],
      shows: [],
      won: { [winner.seat]: amount },
      delta: this.deltas(),
      board: this.board.slice(),
    };
  }

  private deltas(): Record<number, number> {
    const d: Record<number, number> = {};
    for (const p of this.players) d[p.seat] = p.stack - p.start;
    return d;
  }

  /** 버튼 왼쪽부터 시계 방향 순서 */
  private fromButton(): HandPlayer[] {
    const out: HandPlayer[] = [];
    let p = this.after(this.button);
    for (let i = 0; i < this.players.length; i++) {
      out.push(p);
      p = this.after(p.seat);
    }
    return out;
  }

  private showdown() {
    const order = this.fromButton();
    const live = order.filter((p) => !p.folded);
    const score = new Map<number, number>();
    for (const p of live) score.set(p.seat, evaluate([...p.cards, ...this.board]));

    const pots = this.pots().map((pot) => {
      let best = -1;
      for (const s of pot.seats) best = Math.max(best, score.get(s)!);
      return { ...pot, winners: pot.seats.filter((s) => score.get(s) === best) };
    });

    const won: Record<number, number> = {};
    for (const pot of pots) {
      // 버튼 왼쪽에서 가까운 승자부터
      const winners = order.filter((p) => pot.winners.includes(p.seat));
      // 단위에 안 맞는 팟(단위보다 작은 올인이 낀 경우)은 1원 단위로 나눔
      const unit = pot.amount % this.unit === 0 ? this.unit : 1;
      const each = Math.floor(pot.amount / winners.length / unit) * unit;
      let rest = pot.amount - each * winners.length;
      for (const w of winners) {
        const extra = rest >= unit ? unit : 0;
        rest -= extra;
        won[w.seat] = (won[w.seat] ?? 0) + each + extra;
      }
    }
    for (const p of this.players) p.stack += won[p.seat] ?? 0;

    // 까는 순서: 리버에서 마지막으로 벳·레이즈한 사람부터, 없으면 버튼 왼쪽부터
    const first = live.findIndex((p) => p.seat === this.aggressor);
    const showOrder = first > 0 ? [...live.slice(first), ...live.slice(0, first)] : live;
    const shows: Show[] = [];
    const showAll = this.runout || live.some((p) => p.allIn);
    let bestShown = -1;
    for (const p of showOrder) {
      const s = score.get(p.seat)!;
      // 올인한 사람이 있는 판은 전부 깜. 아니면 앞에서 깐 패를 못 이기고 받을 것도 없을 때 덮음
      const show = showAll || shows.length === 0 || s >= bestShown || (won[p.seat] ?? 0) > 0;
      shows.push({ seat: p.seat, cards: show ? p.cards : null, score: s, name: handName(s) });
      if (show) bestShown = Math.max(bestShown, s);
    }

    this.phase = "done";
    this.result = { showdown: true, pots, shows, won, delta: this.deltas(), board: this.board.slice() };
  }
}
