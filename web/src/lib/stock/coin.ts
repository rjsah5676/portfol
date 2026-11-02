/*
 * 코인 거래소 — 하이리스크 · 하이리턴 버전의 차트 게임. 서버 · 화면 · 시뮬이 같이 씀.
 *
 * 솔로와 같은 50턴 루프인데
 *  - 1턴 = 1시간봉, 가격제한 없음, 24시간
 *  - 변동성은 주식의 4배쯤 (턴당 로그수익률 표준편차 ~8%), 꼬리 더 두꺼움(t(3)) · 급등락(점프) 잦음
 *  - 판당 기대수익 −7% (주식은 0): 들고만 있으면 평균 7% 잃음 — 대신 몇 배로 뛰는 판도 있음
 *  - 레버리지 1 · 3 · 10배: 증거금(내 돈)으로 포지션 = 증거금 × 배수. 롱만 (코인은 오를 때 버는 게임)
 *    청산: 포지션 손실이 증거금의 LIQ(90%)를 넘으면 그 봉에서 청산 — 증거금은 사라짐 (봉 안의 저가로 판정)
 *  - 수수료 없음 · 체결가 = 봉 종가
 */

import { normal, pickOf, rngFrom, studentT, uniform, weighted, type Rng } from "./rng";
import type { Candle } from "./solo";

export const COIN_HISTORY = 240;
export const COIN_TURNS = 50;
export const LEVERAGES = [1, 3, 10] as const;
export type Leverage = (typeof LEVERAGES)[number];
/** 손실이 증거금의 이 비율에 닿으면 청산 */
export const LIQ = 0.9;

export type CoinPreset = "moon" | "dump" | "pump" | "chop" | "bleed";
export const COIN_PRESETS: Record<CoinPreset, { name: string }> = {
  moon: { name: "떡상 중" },
  dump: { name: "떡락 중" },
  pump: { name: "펌핑" },
  chop: { name: "횡보" },
  bleed: { name: "서서히 빠짐" },
};
const PRESET_WEIGHT: Record<CoinPreset, number> = { moon: 22, dump: 20, pump: 18, chop: 22, bleed: 18 };

export interface CoinChart {
  name: string;
  sym: string;
  preset: CoinPreset;
  candles: Candle[];
}

const NAME_A = ["도지", "루나", "페페", "문", "로켓", "라면", "치킨", "핑크", "고양이", "햄스터", "번개", "용", "달", "불꽃", "구름", "감자", "떡", "별", "토끼", "펭귄", "유령", "빙수", "마라", "참치"];
const NAME_B = ["코인", "토큰", "체인", "스왑", "파이낸스", "프로토콜", "다오", "인", "넷", "X", "AI", "밈", "버스", "랜드", "머니"];
export const coinName = (r: Rng) => {
  const a = pickOf(r, NAME_A),
    b = pickOf(r, NAME_B);
  const sym = (a.replace(/[^가-힣A-Z]/g, "").slice(0, 2) + b.replace(/[^가-힣A-Z]/g, "").slice(0, 1)).toUpperCase();
  return { name: `${a}${b}`, sym };
};

/** 호가 단위 (코인은 가격대가 넓음) */
export function coinTick(p: number): number {
  if (p < 10) return 0.01;
  if (p < 100) return 0.1;
  if (p < 1_000) return 1;
  if (p < 10_000) return 5;
  if (p < 100_000) return 10;
  if (p < 1_000_000) return 100;
  return 1_000;
}
export const coinRound = (p: number) => {
  const t = coinTick(p);
  return Math.max(t, Math.round(p / t) * t);
};

/** 포지션 = 증거금 × 배수 / 진입가 = 수량(소수점 OK, 1e-4 단위) */
export const coinQty = (margin: number, lev: number, price: number) => Math.floor(((margin * lev) / price) * 1e4) / 1e4;
/** 지금 포지션 가치 → 증거금 평가액 (= 증거금 + 손익). 0 밑으로는 안 감 */
export const marginValue = (margin: number, lev: number, entry: number, price: number) => Math.max(0, Math.round(margin * (1 + lev * (price / entry - 1))));
/** 청산가 (저가가 이 밑으로 가면 청산) */
export const liqPrice = (lev: number, entry: number) => entry * (1 - LIQ / lev);

// ───────────── 생성기 ─────────────

interface Regime {
  mu: number;
  vol: number;
  left: number;
}
function futureRegime(r: Rng): Regime {
  const k = r();
  const mu = k < 0.34 ? uniform(r, 0.004, 0.012) : k < 0.7 ? -uniform(r, 0.004, 0.012) : 0;
  return { mu, vol: uniform(r, 0.75, 1.4), left: 2 + Math.floor(-Math.log(1 - r()) * 5) };
}

function historyPlan(preset: CoinPreset, r: Rng): (i: number, logP: number, base: number) => { mu: number; vol: number; jump: number; big?: number } {
  const n = COIN_HISTORY;
  switch (preset) {
    case "moon": {
      const start = Math.floor(uniform(r, 60, 150));
      const mu = uniform(r, 0.008, 0.016);
      return (i) => (i < start ? { mu: uniform(r, -0.004, 0.004), vol: 1, jump: 0.03 } : { mu, vol: 1.1, jump: 0.035 });
    }
    case "dump": {
      const start = Math.floor(uniform(r, 60, 150));
      const mu = -uniform(r, 0.008, 0.016);
      return (i) => (i < start ? { mu: uniform(r, -0.004, 0.004), vol: 1, jump: 0.03 } : { mu, vol: 1.2, jump: 0.04 });
    }
    case "pump": {
      const len = Math.floor(uniform(r, 3, 10));
      const days = new Set<number>();
      const hits = Math.max(2, Math.round(len * uniform(r, 0.4, 0.7)));
      while (days.size < hits) days.add(n - 1 - Math.floor(r() * len));
      return (i) => (i < n - len ? { mu: uniform(r, -0.003, 0.003), vol: 0.9, jump: 0.025 } : { mu: 0.06, vol: 2.5, jump: 0, ...(days.has(i) && { big: uniform(r, 0.15, 0.6) }) });
    }
    case "chop": {
      const k = uniform(r, 0.05, 0.1);
      return (_i, logP, base) => ({ mu: -k * (logP - base), vol: 0.8, jump: 0.015 });
    }
    case "bleed": {
      return () => ({ mu: -uniform(r, 0.002, 0.005), vol: 0.85, jump: 0.02 });
    }
  }
}

const futureVol = (preset: CoinPreset, t: number) => (preset === "pump" ? 1 + 1.6 * Math.exp(-t / 14) : preset === "chop" ? 0.9 : 1);
const jumpSize = (r: Rng) => (r() < 0.5 ? -1 : 1) * Math.min(0.5, Math.abs(0.18 + 0.1 * normal(r)));
const FUTURE_JUMP = 0.04;
/** 판 구간 기대수익 −7% 가 되도록 (시뮬로 맞춘 값 — 생성기를 바꾸면 scripts/stock-coin-sim 으로 다시) */
export const COIN_EV = -0.07;
const DRIFT = Math.log(1 + COIN_EV) / COIN_TURNS;
const DRIFT_FIX = 0.0003;

export function genCoin(seed: string, presetIn?: CoinPreset): CoinChart {
  const r = rngFrom(`coin:${seed}`);
  const preset = presetIn ?? weighted(r, PRESET_WEIGHT);
  const { name, sym } = coinName(r);
  // 첫 봉 가격: 1원 ~ 5천만원 (로그 균등) — 밈코인부터 비트급까지
  const p0 = Math.exp(uniform(r, Math.log(1), Math.log(50_000_000)));
  const plan = historyPlan(preset, r);
  const sigmaL = uniform(r, 0.06, 0.1);
  const A = 0.1,
    B = 0.85;
  const omega = sigmaL * sigmaL * (1 - A - B);
  let s2 = sigmaL * sigmaL;
  let prevNoise = 0;
  const turnover = Math.exp(uniform(r, Math.log(5e8), Math.log(2e11)));
  const candles: Candle[] = [];
  let prev = coinRound(p0);
  const base = Math.log(prev);
  let reg = futureRegime(r);
  const total = COIN_HISTORY + COIN_TURNS;
  for (let i = 0; i < total; i++) {
    const hist = i < COIN_HISTORY;
    const t = i - COIN_HISTORY;
    let mu: number, volMul: number, jumpP: number, big: number | undefined;
    if (hist) {
      const d = plan(i, Math.log(prev), base);
      mu = d.mu;
      volMul = d.vol;
      jumpP = d.jump;
      big = d.big;
    } else {
      if (reg.left-- <= 0) reg = futureRegime(r);
      volMul = reg.vol * futureVol(preset, t);
      mu = reg.mu;
      jumpP = FUTURE_JUMP * (preset === "pump" ? 1.5 : 1);
    }
    s2 = omega + A * prevNoise * prevNoise + B * s2;
    const sig = Math.sqrt(s2) * volMul;
    const z = studentT(r, 3);
    const noise = sig * Math.max(-6, Math.min(6, z));
    prevNoise = Math.sqrt(s2) * Math.max(-4, Math.min(4, z));
    let jump = big ?? (r() < jumpP ? jumpSize(r) : 0);
    if (big !== undefined) jump += noise * 0.3;
    // 판 구간: 마팅게일 보정 + 기대수익 −7% 드리프트
    const comp = hist ? 0 : -0.5 * sig * sig - jumpP * 0.0215 + DRIFT + DRIFT_FIX;
    let x = mu + comp + (big !== undefined ? 0 : noise) + jump;
    x = Math.max(-1.2, Math.min(1.2, x));
    const close = coinRound(prev * Math.exp(x));
    x = Math.log(close / prev);
    const gapShare = jump !== 0 ? uniform(r, 0.5, 0.9) : uniform(r, 0.05, 0.3);
    const open = coinRound(prev * Math.exp(x * gapShare + sig * 0.3 * normal(r)));
    const steps = 12;
    const lo = Math.log(open),
      lc = Math.log(close);
    const isig = sig * 0.7;
    let w = 0;
    let hi = Math.max(open, close),
      lw = Math.min(open, close);
    for (let k = 1; k < steps; k++) {
      w += (normal(r) * isig) / Math.sqrt(steps);
      const f = k / steps;
      const p = Math.exp(lo + (lc - lo) * f + w - f * w);
      if (p > hi) hi = p;
      if (p < lw) lw = p;
    }
    hi *= 1 + Math.abs(normal(r)) * sig * 0.3;
    lw *= 1 - Math.abs(normal(r)) * sig * 0.3;
    const h = Math.max(coinRound(hi), open, close);
    const l = Math.max(coinTick(lw), Math.min(coinRound(lw), open, close));
    const shock = Math.abs(x) / Math.max(0.01, sigmaL);
    const vol = (turnover / close) * Math.exp(0.4 * normal(r)) * (0.5 + 0.5 * shock + (big !== undefined ? uniform(r, 2, 8) : 0));
    candles.push({ o: open, h, l, c: close, v: Math.max(1, Math.round(vol)) });
    prev = close;
  }
  return { name, sym, preset, candles };
}

export const coinVisible = (turn: number) => COIN_HISTORY + Math.min(COIN_TURNS, Math.max(0, turn));
export const coinPriceAt = (candles: Candle[], turn: number) => candles[coinVisible(turn) - 1].c;

/** 가상 시각: 첫 봉 (시드) · i 번째 봉 = +i 시간 */
export function coinDate0(seed: string): number {
  const r = rngFrom(`cdate:${seed}`);
  return Date.UTC(2020 + Math.floor(r() * 6), Math.floor(r() * 12), 1 + Math.floor(r() * 28), Math.floor(r() * 24));
}
export const coinDateAt = (date0: number, i: number) => date0 + i * 3600_000;
export const fmtHour = (t: number) => {
  const d = new Date(t + 9 * 3600_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
};

// ───────────── 포지션 ─────────────

/** 한 판의 포지션 (하나만 — 코인은 진입 · 청산이 단순해야 재밌음) */
export interface CoinPos {
  /** 증거금 (내 돈) */
  margin: number;
  lev: Leverage;
  /** 진입가 (추가 진입 시 가중 평균) */
  entry: number;
  qty: number;
}
export interface CoinTrade {
  turn: number;
  side: "open" | "close" | "liq";
  margin: number;
  lev: number;
  price: number;
  /** close · liq: 돌려받은 돈 */
  back?: number;
}
/** 봉 하나에서 청산되는지 (저가 기준) */
export const liquidated = (pos: CoinPos, c: Candle) => c.l <= liqPrice(pos.lev, pos.entry);
