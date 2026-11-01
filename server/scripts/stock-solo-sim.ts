/*
 * 솔로 차트 생성기 검증: 단순 전략들의 판당 평균 수익률이 0 근처인지 (출시 조건) + 몰빵 꼬라박기가 실제로 나오는지.
 *   npx tsx scripts/stock-solo-sim.ts [판 수=20000]
 */
import { HISTORY, PRESET_IDS, TURNS, genSolo, type Candle, type Preset } from "../../web/src/lib/stock/solo";

type Strat = (c: Candle[], i: number, holding: boolean, r: () => number) => boolean; // 이 봉 종가에서 들고 있을지

const ma = (c: Candle[], i: number, n: number) => {
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += c[k].c;
  return s / n;
};
export const STRATS: Record<string, Strat> = {
  hold: () => true,
  random: (_c, _i, h, r) => (r() < 0.15 ? !h : h),
  momentum: (c, i, h) => {
    const p = c[i].c,
      m5 = ma(c, i, 5),
      m20 = ma(c, i, 20);
    if (!h && p > m5 && m5 > m20) return true;
    if (h && p < m5) return false;
    return h;
  },
  maCross: (c, i) => ma(c, i, 5) > ma(c, i, 20),
  contrarian: (c, i, h) => {
    const p = c[i].c,
      m20 = ma(c, i, 20);
    if (!h && p < m20 * 0.93) return true;
    if (h && p > m20) return false;
    return h;
  },
  breakout: (c, i, h) => {
    let hi = 0,
      lo = Infinity;
    for (let k = i - 20; k < i; k++) {
      hi = Math.max(hi, c[k].h);
      lo = Math.min(lo, c[k].l);
    }
    if (!h && c[i].c > hi) return true;
    if (h && c[i].c < ma(c, i, 10)) return false;
    return h;
  },
  // 급등 다음 날 따라 사기 (+8% 이상 오른 날) · 3일 뒤 팖
  chaseSurge: (c, i) => {
    for (let k = 0; k < 3; k++) if (c[i - k].c / c[i - k - 1].c > 1.08) return true;
    return false;
  },
};

/** 한 판: 전액으로 매매. 최종/시작 배수 */
export function playOnce(c: Candle[], s: Strat, r: () => number): number {
  let cash = 1,
    sh = 0,
    h = false;
  for (let t = 0; t < TURNS; t++) {
    const i = HISTORY + t - 1;
    const want = s(c, i, h, r);
    if (want && !h) {
      sh = cash / c[i].c;
      cash = 0;
      h = true;
    } else if (!want && h) {
      cash = sh * c[i].c;
      sh = 0;
      h = false;
    }
  }
  const last = c[HISTORY + TURNS - 1].c;
  return cash + sh * last;
}

function main() {
  const N = Number(process.argv[2] ?? 20000);
  let x = 12345;
  const r = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const charts = Array.from({ length: N }, (_, k) => genSolo(`sim${k}`));
  const by: Record<string, Record<Preset | "all", number[]>> = {};
  for (const [name, s] of Object.entries(STRATS)) {
    by[name] = { all: [], up: [], down: [], surge: [], crash: [], box: [] };
    for (const ch of charts) {
      const g = playOnce(ch.candles, s, r);
      by[name].all.push(g);
      by[name][ch.preset].push(g);
    }
  }
  const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / Math.max(1, a.length);
  const se = (a: number[]) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, a.length - 1) / Math.max(1, a.length));
  };
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${(100 * v).toFixed(1)}%`;
  console.log(`판 수 ${N}`, Object.fromEntries(PRESET_IDS.map((p) => [p, charts.filter((c) => c.preset === p).length])));
  for (const [name, d] of Object.entries(by)) {
    const a = d.all;
    const sorted = [...a].sort((p, q) => p - q);
    console.log(
      `${name.padEnd(11)} 평균 ${pct(mean(a) - 1).padStart(7)} ±${(196 * se(a)).toFixed(1)}  중앙 ${pct(sorted[a.length >> 1] - 1).padStart(7)}  -30%↓ ${(100 * a.filter((g) => g < 0.7).length / a.length).toFixed(1)}%  -50%↓ ${(100 * a.filter((g) => g < 0.5).length / a.length).toFixed(1)}%  +50%↑ ${(100 * a.filter((g) => g > 1.5).length / a.length).toFixed(1)}%  | ` +
        PRESET_IDS.map((p) => `${p} ${pct(mean(d[p]) - 1)}`).join("  ")
    );
  }
  // 하루 수익률 분포 (판 구간)
  const rets: number[] = [];
  for (const ch of charts.slice(0, 3000)) for (let i = HISTORY; i < HISTORY + TURNS; i++) rets.push(ch.candles[i].c / ch.candles[i - 1].c - 1);
  const sd = Math.sqrt(mean(rets.map((v) => v * v)));
  console.log(`판 구간 일간 변동성 ${(sd * 100).toFixed(2)}%  상한가 ${(100 * rets.filter((v) => v > 0.29).length / rets.length).toFixed(2)}%  하한가 ${(100 * rets.filter((v) => v < -0.29).length / rets.length).toFixed(2)}%  ±10%↑ ${(100 * rets.filter((v) => Math.abs(v) > 0.1).length / rets.length).toFixed(2)}%`);
}

if (process.argv[1]?.includes("stock-solo-sim")) main();
