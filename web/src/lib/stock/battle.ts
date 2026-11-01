/*
 * 대전(트레이딩 홀) 규칙 엔진 — 서버 · 시뮬 · 화면 미리보기가 같이 씀.
 *
 * 모두 1억 시작 · 종목 10개 · 시작가 전부 200만. 7분:
 *   0~30초 「구매 구간」(변동 없음) → 30초부터 10초마다 전 종목 랜덤 변동 (39번, 마지막은 6분 50초) → 마지막 10초 → 끝
 * 가격 임팩트: 1주 살 때마다 ×1.01, 팔 때마다 ÷1.01 (복리). 한 주씩 체결되고, 그 주의 체결가는 움직인 "뒤" 시세.
 *   → 사고 바로 되팔면 시세는 제자리 · 돈은 1주마다 1%쯤 손해 (사고팔기를 반복해서 돈을 찍어 내는 구멍 없음)
 *   (처음 안 "체결 = 움직이기 전 시세 · 매도 ×0.99"는 1.01 × 0.99 < 1 이라 왕복할 때마다 돈이 생겨서 바꿈, 11.01)
 *   수수료 없음 · 체결은 서버 도착 순서.
 * 끝나면 보유 주식을 그 순간 시세(임팩트 없이)로 현금화 → 돈이 제일 많은 사람이 1등.
 *
 * 금액은 원 단위 정수(현금 · 체결 금액), 시세는 실수(표시할 때 반올림).
 */

import { normal, rngFrom, uniform, type Rng } from "./rng";

export const BATTLE = {
  minPlayers: 2,
  maxPlayers: 8,
  startCash: 100_000_000,
  startPrice: 2_000_000,
  /** 1주마다 시세 배수 (살 때 ×, 팔 때 ÷) */
  step: 1.01,
  buyPhaseMs: 30_000,
  shockEveryMs: 10_000,
  shocks: 39,
  durationMs: 420_000,
  /** 바닥가 (아래로 안 내려감) */
  floor: 10_000,
  /** 한 번 주문 최대 수량 */
  maxQty: 999,
  /** 1초에 낼 수 있는 주문 수 (사람 · 봇 같음) */
  ordersPerSec: 8,
  /** 「몰림」 표시: 최근 이만큼(ms) 동안 */
  flowMs: 5_000,
  /** … 순매수가 이만큼 이상이면 🔥 */
  hotShares: 25,
  /**
   * 끝날 때 · 총자산 계산 때 보유 주식 값
   *  - "impact": 지금 시세에서 나 혼자 다 판다면 받을 돈 (sellGain) — 기본
   *  - "board" : 보유 × 시세 (임팩트 없이)
   * "board" 는 막판에 바닥 종목을 전액 사기만 해도 자산이 몇 배로 뛰는 구멍이 있어서 "impact" 로 (시뮬 결과, 11.01)
   */
  liquidate: "impact" as Liquidate,
} as const;
export type Liquidate = "impact" | "board";

/** 종목 (색은 화면 타일 강조용) */
export const STOCKS = [
  { name: "게임", color: "#7C5CFF" },
  { name: "연예", color: "#FF6FA8" },
  { name: "IT", color: "#3FA9F5" },
  { name: "서비스", color: "#36C2A0" },
  { name: "국가", color: "#9AA4B2" },
  { name: "음식", color: "#FF9F43" },
  { name: "테마", color: "#F2C14E" },
  { name: "공업", color: "#8D6E63" },
  { name: "연구", color: "#5DD39E" },
  { name: "우주", color: "#5B6CFF" },
] as const;
export const N_STOCKS = STOCKS.length;

/**
 * 변동 분포 (시뮬로 맞춤 — server/scripts/stock-battle-sim.ts).
 * 보통: 로그수익률 ~ N(mu, sigma) 를 [min, max] 로 자름. 가끔 「대박 · 폭락」.
 */
export const SHOCK = {
  mu: 0.02,
  sigma: 0.28,
  min: Math.log(0.6),
  max: Math.log(2),
  /** 대박 · 폭락 확률 (종목마다 · 변동마다) */
  eventP: 0.05,
  /** 대박: ×(1.6 ~ 2.4) */
  boom: [1.6, 2.4],
  /** 폭락: ×(0.25 ~ 0.45) */
  bust: [0.25, 0.45],
  /** 대박이 폭락보다 나올 확률 */
  boomShare: 0.5,
};

// ───────────── 임팩트 · 체결 ─────────────

const R = BATTLE.step;
const LN_R = Math.log(R);
/** N주 매수 비용: p·r + p·r² + … + p·r^N (한 주씩 시세를 올리고 그 시세에 삼) */
export const buyCost = (p: number, n: number) => (n <= 0 ? 0 : Math.round((p * R * (Math.pow(R, n) - 1)) / (R - 1)));
/** N주 매도 수익: p/r + p/r² + … + p/r^N (한 주씩 시세를 내리고 그 시세에 팖) */
export const sellGain = (p: number, n: number) => (n <= 0 ? 0 : Math.round((p * (1 - Math.pow(R, -n))) / (R - 1)));
export const afterBuy = (p: number, n: number) => p * Math.pow(R, n);
export const afterSell = (p: number, n: number) => Math.max(BATTLE.floor, p * Math.pow(R, -n));
/** 현금으로 살 수 있는 최대 수량 */
export function maxBuy(p: number, cash: number): number {
  if (p <= 0 || cash < p * R) return 0;
  let n = Math.floor(Math.log(1 + (cash * (R - 1)) / (p * R)) / LN_R);
  n = Math.min(n, BATTLE.maxQty);
  while (n > 0 && buyCost(p, n) > cash) n--;
  while (n < BATTLE.maxQty && buyCost(p, n + 1) <= cash) n++;
  return n;
}

// ───────────── 시간 ─────────────

/** k 번째(0부터) 변동 시각 (판 시작부터 ms) */
export const shockAt = (k: number) => BATTLE.buyPhaseMs + k * BATTLE.shockEveryMs;
/** 지금(경과 ms)까지 일어난 변동 수 */
export const shocksBy = (ms: number) => (ms < BATTLE.buyPhaseMs ? 0 : Math.min(BATTLE.shocks, Math.floor((ms - BATTLE.buyPhaseMs) / BATTLE.shockEveryMs) + 1));
/** 다음 변동까지 남은 ms (더 없으면 끝까지) */
export function untilShock(ms: number): number {
  const k = shocksBy(ms);
  return k >= BATTLE.shocks ? BATTLE.durationMs - ms : shockAt(k) - ms;
}

// ───────────── 판 ─────────────

export interface BPlayer {
  cash: number;
  hold: number[];
  /** 종목별 들고 있는 주식의 원가 (평단 = cost/hold) */
  cost: number[];
  trades: number;
  /** 최근 1초 주문 시각들 (속도 제한) */
  recent: number[];
}

export interface Fill {
  seat: number;
  stock: number;
  side: "buy" | "sell";
  qty: number;
  /** 체결 금액 */
  amount: number;
  /** 체결 뒤 시세 */
  price: number;
  /** 판 시작부터 ms */
  at: number;
}

export interface ShockEv {
  k: number;
  /** 종목별 배수 */
  mult: number[];
  /** 대박(1) · 폭락(-1) · 보통(0) */
  ev: number[];
  at: number;
}

export interface BattleSnapshot {
  prices: number[];
  base: number[];
  last: number[];
  shocks: number;
}

export class BattleGame {
  readonly n: number;
  readonly rng: Rng;
  prices: number[];
  /** 마지막 변동 직후 시세 (타일의 「변동 이후 %」 기준) */
  base: number[];
  /** 마지막 변동의 배수 */
  last: number[];
  /** 마지막 변동의 종류 */
  lastEv: number[];
  players: BPlayer[];
  /** 일어난 변동 수 */
  shocks = 0;
  /** 체결 기록 (전부) */
  fills: Fill[] = [];
  shockLog: ShockEv[] = [];
  /** 자산 기록: [0] 시작, [k+1] k 번째 변동 직후, 마지막은 끝 */
  curve: number[][] = [];
  /** 종목별 가격 기록 (시작 · 변동 직후) */
  priceCurve: number[][] = [];
  over = false;
  readonly liquidate: Liquidate;

  constructor(n: number, seed: string, opts: { liquidate?: Liquidate } = {}) {
    this.n = n;
    this.liquidate = opts.liquidate ?? BATTLE.liquidate;
    this.rng = rngFrom(`battle:${seed}`);
    this.prices = Array(N_STOCKS).fill(BATTLE.startPrice);
    this.base = [...this.prices];
    this.last = Array(N_STOCKS).fill(1);
    this.lastEv = Array(N_STOCKS).fill(0);
    this.players = Array.from({ length: n }, () => ({ cash: BATTLE.startCash, hold: Array(N_STOCKS).fill(0), cost: Array(N_STOCKS).fill(0), trades: 0, recent: [] }));
    this.curve.push(this.players.map(() => BATTLE.startCash));
    this.priceCurve.push([...this.prices]);
  }

  /** 보유 n 주의 값 (지금 다 판다면 받을 돈 — 다른 사람 매도는 상관없이 나 혼자 판다고 침) */
  holdValue(stock: number, n: number): number {
    if (n <= 0) return 0;
    return this.liquidate === "impact" ? sellGain(this.prices[stock], n) : n * this.prices[stock];
  }

  /** 총자산 = 현금 + 보유 주식을 지금 판다면 받을 돈 */
  assets(seat: number): number {
    const p = this.players[seat];
    let v = p.cash;
    for (let s = 0; s < N_STOCKS; s++) v += this.holdValue(s, p.hold[s]);
    return Math.round(v);
  }

  /** 주문 속도 제한 (사람 · 봇 같음) */
  private rate(p: BPlayer, at: number): boolean {
    p.recent = p.recent.filter((t) => at - t < 1000);
    if (p.recent.length >= BATTLE.ordersPerSec) return false;
    p.recent.push(at);
    return true;
  }

  /**
   * 주문. qty 는 원하는 수량 (가진 돈 · 주식만큼으로 줄여서 체결). 체결 안 되면 null.
   * at = 판 시작부터 ms (끝난 뒤 · 범위 밖이면 거절)
   */
  order(seat: number, stock: number, side: "buy" | "sell", qty: number, at: number): Fill | null {
    if (this.over || at >= BATTLE.durationMs || at < 0) return null;
    const p = this.players[seat];
    if (!p || stock < 0 || stock >= N_STOCKS || !Number.isInteger(qty) || qty <= 0) return null;
    const price = this.prices[stock];
    let n = Math.min(qty, BATTLE.maxQty);
    if (side === "buy") n = Math.min(n, maxBuy(price, p.cash));
    else n = Math.min(n, p.hold[stock]);
    if (n <= 0) return null;
    if (!this.rate(p, at)) return null;
    let amount: number;
    if (side === "buy") {
      amount = buyCost(price, n);
      p.cash -= amount;
      p.hold[stock] += n;
      p.cost[stock] += amount;
      this.prices[stock] = afterBuy(price, n);
    } else {
      amount = sellGain(price, n);
      p.cost[stock] = p.hold[stock] ? p.cost[stock] * (1 - n / p.hold[stock]) : 0;
      p.cash += amount;
      p.hold[stock] -= n;
      this.prices[stock] = afterSell(price, n);
    }
    p.trades++;
    const f: Fill = { seat, stock, side, qty: n, amount, price: this.prices[stock], at };
    this.fills.push(f);
    return f;
  }

  /** 가진 주식 전부 팔기 (종목마다 한 번씩 · 속도 제한은 한 번으로 침) */
  sellAll(seat: number, at: number): Fill[] {
    const p = this.players[seat];
    if (!p || this.over) return [];
    const out: Fill[] = [];
    const saved = p.recent;
    for (let s = 0; s < N_STOCKS; s++) {
      if (!p.hold[s]) continue;
      p.recent = [];
      const f = this.order(seat, s, "sell", p.hold[s], at);
      if (f) out.push(f);
    }
    p.recent = [...saved.filter((t) => at - t < 1000), at];
    return out;
  }

  /** 변동 하나 뽑기 */
  private draw(): { m: number; e: number } {
    const r = this.rng;
    if (r() < SHOCK.eventP) {
      return r() < SHOCK.boomShare ? { m: uniform(r, SHOCK.boom[0], SHOCK.boom[1]), e: 1 } : { m: uniform(r, SHOCK.bust[0], SHOCK.bust[1]), e: -1 };
    }
    const x = Math.min(SHOCK.max, Math.max(SHOCK.min, SHOCK.mu + SHOCK.sigma * normal(r)));
    return { m: Math.exp(x), e: 0 };
  }

  /** 시간을 at(판 시작부터 ms)까지 진행: 지난 변동을 적용하고, 끝났으면 over. 일어난 변동들을 돌려줌 */
  advance(at: number): ShockEv[] {
    const out: ShockEv[] = [];
    if (this.over) return out;
    const due = shocksBy(at);
    while (this.shocks < due) {
      const k = this.shocks;
      const mult: number[] = [],
        ev: number[] = [];
      for (let s = 0; s < N_STOCKS; s++) {
        const d = this.draw();
        const np = Math.max(BATTLE.floor, this.prices[s] * d.m);
        mult.push(np / this.prices[s]);
        ev.push(d.e);
        this.prices[s] = np;
      }
      this.base = [...this.prices];
      this.last = mult;
      this.lastEv = ev;
      this.shocks++;
      const e: ShockEv = { k, mult, ev, at: shockAt(k) };
      this.shockLog.push(e);
      this.curve.push(this.players.map((_, i) => this.assets(i)));
      this.priceCurve.push([...this.prices]);
      out.push(e);
    }
    if (at >= BATTLE.durationMs) this.finish();
    return out;
  }

  /** 끝: 보유 주식을 현금화 (BATTLE.liquidate 방식) */
  finish() {
    if (this.over) return;
    this.over = true;
    // 모두 같은 시세에서 각자 판다고 침 (순서 없음)
    for (const p of this.players) {
      let v = p.cash;
      for (let s = 0; s < N_STOCKS; s++) v += this.holdValue(s, p.hold[s]);
      p.cash = Math.round(v);
      p.hold.fill(0);
      p.cost.fill(0);
    }
    this.curve.push(this.players.map((p) => p.cash));
    this.priceCurve.push([...this.prices]);
  }

  /** 최근 flowMs 동안 종목별 순매수 주식 수 */
  flows(at: number): number[] {
    const f = Array(N_STOCKS).fill(0);
    for (let i = this.fills.length - 1; i >= 0; i--) {
      const x = this.fills[i];
      if (at - x.at > BATTLE.flowMs) break;
      f[x.stock] += x.side === "buy" ? x.qty : -x.qty;
    }
    return f;
  }

  /** 순위 (자리 번호, 자산 많은 순 · 같으면 자리 앞쪽) */
  ranking(): number[] {
    const a = this.players.map((_, i) => this.assets(i));
    return a.map((_, i) => i).sort((x, y) => a[y] - a[x] || x - y);
  }

  /** 판 하이라이트 3줄의 재료 */
  highlights() {
    // 최고 종목 (시작가 대비)
    let best = 0;
    for (let s = 1; s < N_STOCKS; s++) if (this.prices[s] > this.prices[best]) best = s;
    // 한 사이클에 가장 크게 번 사람 (변동 사이 자산 증가)
    let gain = { seat: -1, amount: 0, k: 0 };
    for (let k = 1; k < this.curve.length; k++)
      for (let i = 0; i < this.n; i++) {
        const d = this.curve[k][i] - this.curve[k - 1][i];
        if (d > gain.amount) gain = { seat: i, amount: d, k };
      }
    // 가장 크게 던진 사람 (한 번 매도 금액)
    let dump = { seat: -1, amount: 0, stock: 0 };
    for (const f of this.fills) if (f.side === "sell" && f.amount > dump.amount) dump = { seat: f.seat, amount: f.amount, stock: f.stock };
    return {
      bestStock: { stock: best, mult: this.prices[best] / BATTLE.startPrice },
      bigGain: gain,
      bigDump: dump,
      booms: this.shockLog.reduce((a, e) => a + e.mult.filter((m) => m >= 1.5).length, 0),
    };
  }
}
