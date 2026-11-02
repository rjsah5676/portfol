/*
 * 솔로 — 턴제 차트 게임의 규칙과 차트 생성기. 서버 · 화면 · 시뮬이 같이 씀.
 *
 * 한 판 = 숨겨진 가상 종목 하나. 시작할 때 과거 봉 HISTORY 개가 보이고, ▶ 를 누를 때마다 봉이 하나씩 열림 (TURNS 번).
 * 거래는 턴을 쓰지 않음 · 체결가 = 지금 봉 종가 · 수수료 없음. TURNS 번째 봉이 열리면 보유 주식을 그 종가로 자동 정리.
 *
 * 생성기 (현실형)
 *  - 일간 로그수익률 = 레짐 드리프트 + GARCH(1,1) 변동성 × t(4) 잡음 + 낮은 확률의 점프(갭)
 *  - 하루 = 시가(밤사이 갭) → 장중 경로(브라운 브리지)로 고가 · 저가 → 종가. 가격제한 ±30% · 호가 단위 반올림
 *  - 차트 유형(프리셋)은 "과거 봉의 모양"을 정함. 앞으로 열릴 봉(판 구간)은 프리셋과 무관한 대칭 레짐이라
 *    과거 모양만 보고 방향을 맞힐 수 없음 → 단순 전략(보유 · 랜덤 · 추세추종)의 판당 기대수익 ≈ 0 (출시 조건, 테스트로 확인)
 *  - 대신 급등주 · 급락주는 판 구간에서도 변동성이 크게 남아서 몰빵하면 크게 벌거나 꼬라박음
 */

import { normal, pickOf, rngFrom, studentT, uniform, weighted, type Rng } from "./rng";

/** 시작할 때 보이는 과거 봉 수 (차트 기본 화면은 이 중 최근 120개 · 120일선 계산용으로 넉넉히) */
export const HISTORY = 240;
/** 한 판의 턴 수 (= 열리는 봉 수) */
export const TURNS = 50;
/** 차트 기본 화면에 보이는 봉 수 */
export const VIEW_BARS = 120;
/** 가격제한폭 */
export const LIMIT = 0.3;

export type Preset = "up" | "down" | "surge" | "crash" | "box";
export const PRESETS: Record<Preset, { name: string; blurb: string }> = {
  up: { name: "정배열", blurb: "이평선이 위로 차곡차곡 쌓인 상승 추세" },
  down: { name: "역배열", blurb: "이평선이 거꾸로 쌓인 하락 추세" },
  surge: { name: "급등주", blurb: "최근 며칠 사이 폭등한 종목" },
  crash: { name: "급락주", blurb: "최근 며칠 사이 폭락한 종목" },
  box: { name: "박스권", blurb: "일정한 범위 안에서 오르내리는 횡보" },
};
export const PRESET_IDS = Object.keys(PRESETS) as Preset[];
/** 판마다 뽑히는 비율 (v1 은 유저가 고르지 않음) */
const PRESET_WEIGHT: Record<Preset, number> = { up: 24, down: 20, surge: 18, crash: 14, box: 24 };

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface SoloChart {
  name: string;
  preset: Preset;
  candles: Candle[];
}

/** 호가 단위 (원) */
export function tickSize(p: number): number {
  if (p < 2_000) return 1;
  if (p < 5_000) return 5;
  if (p < 20_000) return 10;
  if (p < 50_000) return 50;
  if (p < 200_000) return 100;
  if (p < 500_000) return 500;
  return 1_000;
}
export const roundTick = (p: number) => {
  const t = tickSize(p);
  return Math.max(1, Math.round(p / t) * t);
};
/** 가격제한 안의 호가 (상한은 내림 · 하한은 올림) */
const limitUp = (prev: number) => {
  const raw = prev * (1 + LIMIT);
  const t = tickSize(raw);
  return Math.floor(raw / t) * t;
};
const limitDown = (prev: number) => {
  const raw = prev * (1 - LIMIT);
  const t = tickSize(raw);
  return Math.max(1, Math.ceil(raw / t) * t);
};

// ───────────── 가상 종목명 ─────────────

const NAME_A = ["번개", "구름", "별빛", "달토끼", "호랑이", "푸른", "은하", "무지개", "여우", "고래", "새벽", "황금", "바람", "단풍", "청룡", "모래", "파도", "솔잎", "하늘", "용궁", "백두", "한빛", "꿀벌", "까치", "다람쥐", "소나기", "초롱", "반딧불"];
const NAME_B = ["전자", "바이오", "화학", "제약", "엔터", "게임즈", "중공업", "식품", "모빌리티", "에너지", "반도체", "로보틱스", "건설", "해운", "항공", "통신", "소프트", "뷰티", "디스플레이", "배터리", "우주항공", "리츠", "테크", "물산"];
export const stockName = (r: Rng) => `${pickOf(r, NAME_A)}${pickOf(r, NAME_B)}`;

// ───────────── 생성기 ─────────────

interface Regime {
  /** 일간 로그 드리프트 */
  mu: number;
  /** 장기 변동성 배수 */
  vol: number;
  /** 남은 날 수 */
  left: number;
}

/** 판 구간의 레짐: 상승 · 하락 · 횡보가 대칭으로 (평균 드리프트 0) */
function futureRegime(r: Rng): Regime {
  const k = r();
  const mu = k < 0.36 ? uniform(r, 0.0015, 0.0045) : k < 0.72 ? -uniform(r, 0.0015, 0.0045) : 0;
  return { mu, vol: uniform(r, 0.8, 1.3), left: 3 + Math.floor(-Math.log(1 - r()) * 7) };
}

/**
 * 과거 봉 구간의 레짐 계획: 프리셋 모양이 나오게 끝쪽(최근)일수록 강하게.
 * i = 0..HISTORY-1, 돌려주는 값은 그날의 드리프트 · 변동성 배수 · 점프 확률
 */
function historyPlan(preset: Preset, r: Rng): (i: number, logP: number, base: number) => { mu: number; vol: number; jump: number; big?: number } {
  const n = HISTORY;
  switch (preset) {
    case "up": {
      const start = Math.floor(uniform(r, 60, 140)); // 이때부터 상승 추세
      const mu = uniform(r, 0.003, 0.006);
      return (i) => (i < start ? { mu: uniform(r, -0.002, 0.002), vol: 1, jump: 0.012 } : { mu, vol: 0.9, jump: 0.01 });
    }
    case "down": {
      const start = Math.floor(uniform(r, 60, 140));
      const mu = -uniform(r, 0.003, 0.006);
      return (i) => (i < start ? { mu: uniform(r, -0.002, 0.002), vol: 1, jump: 0.012 } : { mu, vol: 1.05, jump: 0.014 });
    }
    case "surge": {
      const len = Math.floor(uniform(r, 4, 12)); // 마지막 len 일 동안 폭등
      const days = new Set<number>();
      const hits = Math.max(2, Math.round(len * uniform(r, 0.35, 0.6)));
      while (days.size < hits) days.add(n - 1 - Math.floor(r() * len));
      return (i) =>
        i < n - len
          ? { mu: uniform(r, -0.0015, 0.0015), vol: 0.9, jump: 0.01 }
          : { mu: 0.025, vol: 2.2, jump: 0, ...(days.has(i) && { big: uniform(r, 0.09, 0.3) }) };
    }
    case "crash": {
      const len = Math.floor(uniform(r, 4, 12));
      const days = new Set<number>();
      const hits = Math.max(2, Math.round(len * uniform(r, 0.35, 0.6)));
      while (days.size < hits) days.add(n - 1 - Math.floor(r() * len));
      return (i) =>
        i < n - len
          ? { mu: uniform(r, -0.001, 0.002), vol: 0.9, jump: 0.01 }
          : { mu: -0.025, vol: 2.2, jump: 0, ...(days.has(i) && { big: -uniform(r, 0.09, 0.3) }) };
    }
    case "box": {
      // 로그가격이 중심으로 돌아오려는 힘 (OU) — 박스 폭은 ±10~20%
      const k = uniform(r, 0.04, 0.09);
      return (_i, logP, base) => ({ mu: -k * (logP - base), vol: 0.85, jump: 0.006 });
    }
  }
}

/** 판 구간 변동성 배수 (급등 · 급락주는 처음에 크게 흔들리다 서서히 줄어듦) */
const futureVol = (preset: Preset, t: number) =>
  preset === "surge" || preset === "crash" ? 1 + 1.4 * Math.exp(-t / 18) : preset === "box" ? 0.95 : 1;

/** 점프 크기 (부호 반반 · 평균 크기 12%) */
const jumpSize = (r: Rng) => (r() < 0.5 ? -1 : 1) * Math.min(0.28, Math.abs(0.12 + 0.06 * normal(r)));

/**
 * 판 구간 하루 수익률이 마팅게일(기댓값 1배)이 되도록 빼 주는 보정 — 잡음 · 점프 · 가격제한 때문에 생기는 치우침.
 * 시뮬(testsuite: stock-solo EV)로 맞춘 값. 생성기를 바꾸면 다시 맞출 것.
 */
const FUTURE_JUMP = 0.012;
const DRIFT_FIX: Record<Preset, number> = { up: -0.00004, down: -0.00004, surge: -0.00004, crash: -0.00004, box: -0.00004 };

/** 시드 → 차트 (같은 시드면 늘 같은 차트). preset 을 주면 그 유형으로 */
export function genSolo(seed: string, presetIn?: Preset): SoloChart {
  const r = rngFrom(`solo:${seed}`);
  const preset = presetIn ?? weighted(r, PRESET_WEIGHT);
  const name = stockName(r);
  // 첫 봉 가격: 3천 ~ 30만 (로그 균등)
  const p0 = Math.exp(uniform(r, Math.log(3_000), Math.log(300_000)));
  const plan = historyPlan(preset, r);
  // 장기 일간 변동성 (종목마다 다름)
  const sigmaL = uniform(r, 0.017, 0.028);
  const A = 0.08,
    B = 0.9;
  const omega = sigmaL * sigmaL * (1 - A - B);
  let s2 = sigmaL * sigmaL;
  let prevNoise = 0;
  // 거래대금 기준 (하루 20억 ~ 300억원)
  const turnover = Math.exp(uniform(r, Math.log(2e9), Math.log(3e10)));

  const candles: Candle[] = [];
  let prev = roundTick(p0);
  const base = Math.log(prev);
  let reg = futureRegime(r);
  const total = HISTORY + TURNS;
  for (let i = 0; i < total; i++) {
    const hist = i < HISTORY;
    const t = i - HISTORY; // 판 구간 몇 번째 날
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
      jumpP = FUTURE_JUMP * (preset === "surge" || preset === "crash" ? 1.6 : 1);
    }
    s2 = omega + A * prevNoise * prevNoise + B * s2;
    const sig = Math.sqrt(s2) * volMul;
    const z = studentT(r, 4);
    const noise = sig * z;
    prevNoise = Math.sqrt(s2) * z;
    let jump = big ?? (r() < jumpP ? jumpSize(r) : 0);
    if (big !== undefined) jump += noise * 0.3;
    // 판 구간: 마팅게일 보정 (잡음 분산 · 점프 기댓값)
    const comp = hist ? 0 : -0.5 * sig * sig - jumpP * 0.0072 + DRIFT_FIX[preset];
    let x = mu + comp + (big !== undefined ? 0 : noise) + jump;
    // 가격제한
    const up = limitUp(prev),
      dn = limitDown(prev);
    let close = roundTick(prev * Math.exp(x));
    close = Math.min(up, Math.max(dn, close));
    x = Math.log(close / prev);
    // 시가: 밤사이 갭 = 수익률의 일부(점프는 거의 시가에서 남)
    const gapShare = jump !== 0 ? uniform(r, 0.6, 1) : uniform(r, 0.1, 0.45);
    let open = roundTick(prev * Math.exp(x * gapShare + sig * 0.25 * normal(r)));
    open = Math.min(up, Math.max(dn, open));
    // 장중 경로 (시가 → 종가 브라운 브리지)
    const steps = 18;
    const lo = Math.log(open),
      lc = Math.log(close);
    const isig = sig * 0.55;
    let w = 0;
    let hi = Math.max(open, close),
      lw = Math.min(open, close);
    for (let k = 1; k < steps; k++) {
      w += normal(r) * isig / Math.sqrt(steps);
      const f = k / steps;
      const lp = lo + (lc - lo) * f + w - f * w; // 끝에서 종가에 붙도록 잡음을 줄임
      const p = Math.exp(lp);
      if (p > hi) hi = p;
      if (p < lw) lw = p;
    }
    // 꼬리 조금 더
    hi *= 1 + Math.abs(normal(r)) * sig * 0.2;
    lw *= 1 - Math.abs(normal(r)) * sig * 0.2;
    const h = Math.min(up, Math.max(roundTick(hi), open, close));
    const l = Math.max(dn, Math.min(roundTick(lw), open, close));
    // 거래량: 변동이 클수록 · 급등락 날 크게
    const shock = Math.abs(x) / Math.max(0.005, sigmaL);
    const vol = (turnover / close) * Math.exp(0.35 * normal(r)) * (0.6 + 0.45 * shock + (big !== undefined ? uniform(r, 2, 6) : 0));
    candles.push({ o: open, h, l, c: close, v: Math.max(100, Math.round(vol)) });
    prev = close;
  }
  return { name, preset, candles };
}

// ───────────── 판 규칙 (서버 검증 · 화면 미리보기 공용) ─────────────

/** turn 턴일 때 보이는 봉 수 */
export const visibleCount = (turn: number) => HISTORY + Math.min(TURNS, Math.max(0, turn));
/** turn 턴의 체결가 (지금 보이는 마지막 봉의 종가) */
export const priceAt = (candles: Candle[], turn: number) => candles[visibleCount(turn) - 1].c;
/** 살 수 있는 최대 수량 */
export const maxBuy = (cash: number, price: number) => (price > 0 ? Math.floor(cash / price) : 0);

export interface SoloTrade {
  /** 거래한 턴 (0..TURNS-1) */
  turn: number;
  side: "buy" | "sell";
  qty: number;
  price: number;
}

// ───────────── 예약 주문 ─────────────

/**
 * 예약 주문 (차트스쿨의 「예약」). 다음 봉이 열릴 때 그 봉의 고가 · 저가가 예약가에 닿으면 체결.
 *  - buy   : 지정가 매수 — 저가 ≤ 예약가면 min(예약가, 시가)에 삼
 *  - take  : 익절 매도 — 고가 ≥ 예약가면 max(예약가, 시가)에 팖
 *  - stop  : 손절 매도 — 저가 ≤ 예약가면 min(예약가, 시가)에 팖 (갭 하락이면 시가)
 * 수량은 예약할 때 정한 주 수 (매수는 체결 시점 현금 안에서).
 */
export type OrderKind = "buy" | "take" | "stop";
export interface SoloOrder {
  id: string;
  kind: OrderKind;
  price: number;
  qty: number;
}
export const MAX_ORDERS = 4;
export const ORDER_NAME: Record<OrderKind, string> = { buy: "지정가 매수", take: "익절 매도", stop: "손절 매도" };
/** 봉 하나에서 예약이 체결되는지 · 체결가 */
export function fillOrder(o: SoloOrder, c: Candle): number | null {
  if (o.kind === "buy") return c.l <= o.price ? roundTick(Math.min(o.price, c.o)) : null;
  if (o.kind === "take") return c.h >= o.price ? roundTick(Math.max(o.price, c.o)) : null;
  return c.l <= o.price ? roundTick(Math.min(o.price, c.o)) : null;
}

// ───────────── 가상 날짜 ─────────────

/** 판의 첫 봉 날짜 (시드로 정함, 최근 몇 년 안의 어느 날) · 주말은 건너뜀 */
export function soloDate0(seed: string): number {
  const r = rngFrom(`date:${seed}`);
  const d = new Date(Date.UTC(2018 + Math.floor(r() * 7), Math.floor(r() * 12), 1 + Math.floor(r() * 28)));
  return d.getTime();
}
export function dateAt(date0: number, i: number): number {
  const d = new Date(date0);
  let k = 0;
  while (k < i) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) k++;
  }
  return d.getTime();
}
export const fmtDate = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
};

/** 거래 기록 → 왕복 횟수 · 이긴 왕복 수 (매도로 포지션이 0 이 될 때마다 한 번) */
export function roundTrips(trades: SoloTrade[]): { trips: number; wins: number } {
  let sh = 0,
    cost = 0,
    proceeds = 0,
    trips = 0,
    wins = 0;
  for (const t of trades) {
    if (t.side === "buy") {
      sh += t.qty;
      cost += t.qty * t.price;
    } else {
      sh -= t.qty;
      proceeds += t.qty * t.price;
      if (sh === 0) {
        trips++;
        if (proceeds > cost) wins++;
        cost = 0;
        proceeds = 0;
      }
    }
  }
  return { trips, wins };
}
