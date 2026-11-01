/* 차트 보조지표 (화면 전용). 값이 없는 앞쪽은 null */

import type { Candle } from "./solo";

export function sma(c: Candle[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    s += c[i].c;
    if (i >= n) s -= c[i - n].c;
    out.push(i >= n - 1 ? s / n : null);
  }
  return out;
}

export function ema(xs: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  let e = xs[0] ?? 0;
  for (let i = 0; i < xs.length; i++) {
    e = i === 0 ? xs[0] : xs[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

export function macd(c: Candle[]) {
  const cl = c.map((x) => x.c);
  const e12 = ema(cl, 12),
    e26 = ema(cl, 26);
  const line = cl.map((_, i) => e12[i] - e26[i]);
  const signal = ema(line, 9);
  return { a: line, b: signal, hist: line.map((v, i) => v - signal[i]) };
}

/** 스토캐스틱 슬로우 (14, 3, 3) */
export function stoch(c: Candle[]) {
  const k: (number | null)[] = [];
  for (let i = 0; i < c.length; i++) {
    if (i < 13) {
      k.push(null);
      continue;
    }
    let hi = -Infinity,
      lo = Infinity;
    for (let j = i - 13; j <= i; j++) {
      hi = Math.max(hi, c[j].h);
      lo = Math.min(lo, c[j].l);
    }
    k.push(hi === lo ? 50 : ((c[i].c - lo) / (hi - lo)) * 100);
  }
  const avg = (xs: (number | null)[], n: number) =>
    xs.map((_, i) => {
      if (i < n - 1) return null;
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) {
        if (xs[j] === null) return null;
        s += xs[j]!;
      }
      return s / n;
    });
  const slowK = avg(k, 3);
  return { a: slowK, b: avg(slowK, 3) };
}

/** CCI (20) */
export function cci(c: Candle[], n = 20) {
  const tp = c.map((x) => (x.h + x.l + x.c) / 3);
  const out: (number | null)[] = [];
  for (let i = 0; i < c.length; i++) {
    if (i < n - 1) {
      out.push(null);
      continue;
    }
    let m = 0;
    for (let j = i - n + 1; j <= i; j++) m += tp[j];
    m /= n;
    let d = 0;
    for (let j = i - n + 1; j <= i; j++) d += Math.abs(tp[j] - m);
    d /= n;
    out.push(d ? (tp[i] - m) / (0.015 * d) : 0);
  }
  return out;
}
