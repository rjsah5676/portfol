/*
 * 대전 봇. 사람과 같은 주문 함수(BattleGame.order)만 씀 — 다음 변동 결과는 모름.
 * 봇이 보는 것 = 사람이 보는 것: 시세 · 마지막 변동 · 몰림(최근 순매수) · 남은 시간 · 내 현금 · 보유.
 * 서버는 250ms 마다 botThink 를 부르고, 봇은 반응 지연(nextAt)이 지나야 움직임.
 */

import { BATTLE, N_STOCKS, maxBuy, shocksBy, untilShock, type BattleGame, type Fill } from "./battle";
import type { Rng } from "./rng";

export type BotStyle = "chaser" | "whale" | "contra" | "ant";
export type BotLevel = 0 | 1 | 2;

export const BOT_STYLES: Record<BotStyle, { name: string; blurb: string }> = {
  chaser: { name: "추격형", blurb: "오르는 종목 · 몰리는 종목을 따라 삼" },
  whale: { name: "세력형", blurb: "한 종목을 크게 사 두고 남들이 따라오면 던짐" },
  contra: { name: "역추세형", blurb: "크게 빠진 걸 줍고 크게 오른 걸 팖" },
  ant: { name: "개미형", blurb: "조금씩 아무거나, 가끔 몰빵" },
};
export const BOT_STYLE_IDS = Object.keys(BOT_STYLES) as BotStyle[];
export const BOT_LEVELS: Record<BotLevel, { name: string; react: [number, number]; noise: number }> = {
  0: { name: "초급", react: [1000, 2000], noise: 0.6 },
  1: { name: "중급", react: [600, 1200], noise: 0.3 },
  2: { name: "고급", react: [400, 800], noise: 0.12 },
};

export interface BotMind {
  style: BotStyle;
  level: BotLevel;
  rng: Rng;
  /** 이 시각(판 시작부터 ms) 전에는 안 움직임 */
  nextAt: number;
  /** 이번 사이클(변동 번호)에 이미 정한 것 */
  cycle: number;
  /** 세력형: 이번에 미는 종목 */
  target: number;
  /** 세력형: 매집 단계에서 남은 주문 수 */
  loads: number;
  /** 이번 사이클에 변동 전에 던질지 (추격 · 세력) */
  dump: boolean;
  /** 이번 사이클에 끝까지 들고 갈지 (몰빵 개미) */
  yolo: boolean;
}

export function newMind(style: BotStyle, level: BotLevel, rng: Rng): BotMind {
  return { style, level, rng, nextAt: 800 + rng() * 2500, cycle: -1, target: -1, loads: 0, dump: false, yolo: false };
}

const react = (m: BotMind) => {
  const [a, b] = BOT_LEVELS[m.level].react;
  return a + m.rng() * (b - a);
};

/** 종목 점수에 난이도만큼 잡음 */
const noisy = (m: BotMind, v: number) => v + (m.rng() - 0.5) * 2 * BOT_LEVELS[m.level].noise;

function argmax(xs: number[]): number {
  let b = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[b]) b = i;
  return b;
}

/** 현금 비율 frac 만큼 사기 (수량은 maxBuy 로 맞춤) */
function buyFrac(g: BattleGame, seat: number, s: number, frac: number, at: number): Fill | null {
  const p = g.players[seat];
  const budget = Math.floor(p.cash * Math.min(1, frac));
  const n = maxBuy(g.prices[s], budget);
  return n > 0 ? g.order(seat, s, "buy", n, at) : null;
}
const sellFrac = (g: BattleGame, seat: number, s: number, frac: number, at: number): Fill | null => {
  const h = g.players[seat].hold[s];
  const n = Math.max(1, Math.round(h * Math.min(1, frac)));
  return h > 0 ? g.order(seat, s, "sell", Math.min(h, n), at) : null;
};
const avg = (g: BattleGame, seat: number, s: number) => {
  const p = g.players[seat];
  return p.hold[s] ? p.cost[s] / p.hold[s] : 0;
};

/**
 * 봇 한 명의 생각 한 번 (250ms 마다). 낸 주문(체결된 것)을 돌려줌.
 * at = 판 시작부터 ms
 */
export function botThink(g: BattleGame, seat: number, m: BotMind, at: number): Fill[] {
  if (g.over || at < m.nextAt) return [];
  const out: Fill[] = [];
  const push = (f: Fill | null | Fill[]) => {
    if (Array.isArray(f)) out.push(...f);
    else if (f) out.push(f);
  };
  const r = m.rng;
  const p = g.players[seat];
  const left = BATTLE.durationMs - at;
  const tNext = untilShock(at);
  const k = shocksBy(at);
  const buyPhase = k === 0;
  const flows = g.flows(at);
  const assets = g.assets(seat);
  const hard = m.level === 2;
  const endgame = left < 30_000;

  // 새 사이클: 이번에 변동 전에 던질지 정함
  if (m.cycle !== k) {
    m.cycle = k;
    m.target = m.style === "whale" ? -1 : m.target;
    m.loads = 0;
    const dumpP = m.style === "chaser" ? 0.1 : m.style === "whale" ? 0.35 : 0;
    m.dump = r() < dumpP;
    m.yolo = m.style === "ant" && r() < 0.12;
  }

  switch (m.style) {
    case "chaser": {
      // 변동 직전: 던지기 (이익 난 것만 · 어려움은 막판엔 안 던지고 끝까지)
      if (!buyPhase && m.dump && tNext < 3800 && tNext > 1200 && !(hard && endgame)) {
        for (let s = 0; s < N_STOCKS; s++) if (p.hold[s] && g.prices[s] > avg(g, seat, s) * 1.06) push(sellFrac(g, seat, s, 1, at));
        break;
      }
      // 남이 던지는 종목(변동 이후 -10% 넘게 빠짐)은 손절
      for (let s = 0; s < N_STOCKS; s++) if (p.hold[s] && g.prices[s] < g.base[s] * 0.85 && r() < 0.5) push(sellFrac(g, seat, s, 0.4, at));
      if (tNext > 3000 && p.cash > assets * 0.1) {
        // 오르는 종목을 따라 사되, 이미 너무 끌어올려진(변동 이후 +15%↑) 건 피함 (어려울수록 잘 피함)
        const score = g.prices.map((_, s) => {
          const pumped = Math.log(g.prices[s] / g.base[s]);
          return noisy(m, (buyPhase ? 0 : Math.log(g.last[s]) * 2.5) + Math.min(flows[s], 30) / 15 + (pumped > 0.14 ? -3 * pumped * (m.level + 1) : pumped * 2));
        });
        const s = argmax(score);
        if (score[s] > 0.15 || buyPhase) push(buyFrac(g, seat, s, buyPhase ? 0.55 + r() * 0.35 : 0.5 + r() * 0.45, at));
      }
      break;
    }
    case "whale": {
      if (m.target < 0 && tNext > 3500 && p.cash > assets * 0.3) {
        // 미는 종목: 싸거나(바닥 근처) 아무도 안 보는 종목 위주
        const score = g.prices.map((pr, s) => noisy(m, -Math.log(pr / BATTLE.startPrice) * 0.5 - Math.abs(flows[s]) / 15));
        m.target = argmax(score);
        m.loads = 2 + Math.floor(r() * 2);
      }
      const s = m.target;
      if (s >= 0 && m.loads > 0 && tNext > 3500) {
        push(buyFrac(g, seat, s, (0.85 + r() * 0.1) / m.loads, at));
        m.loads--;
        break;
      }
      // 따라붙었으면(평단 대비 +12%) 일찍 던지거나, 변동 직전에 던짐
      if (s >= 0 && p.hold[s]) {
        const up = g.prices[s] / Math.max(1, avg(g, seat, s));
        if (up > 1.12 + r() * 0.1 && tNext > 2000) {
          // 따라붙은 만큼 반쯤 넘기고, 다음 종목을 고름 (남은 건 들고 감)
          push(sellFrac(g, seat, s, 0.5 + r() * 0.3, at));
          m.target = -1;
        } else if (m.dump && up > 1.04 && tNext < 3000 && !(hard && endgame)) {
          push(sellFrac(g, seat, s, 1, at));
          m.target = -1;
          m.dump = false;
        }
      }
      // 남은 다른 종목 정리
      for (let x = 0; x < N_STOCKS; x++) if (x !== s && p.hold[x] && g.prices[x] > avg(g, seat, x) * 1.2) push(sellFrac(g, seat, x, 0.5, at));
      break;
    }
    case "contra": {
      // 크게 오른 것 팔기
      for (let s = 0; s < N_STOCKS; s++) if (p.hold[s] && g.prices[s] > avg(g, seat, s) * (1.3 + r() * 0.2)) push(sellFrac(g, seat, s, 0.6 + r() * 0.4, at));
      // 한 번에 3종목까지만 (다 들고 있으면 이미 가진 것에서만 고름)
      const heldN = p.hold.filter((h) => h > 0).length;
      if (tNext > 3000 && p.cash > assets * 0.15) {
        const score = g.prices.map((_, s) => (heldN >= 3 && !p.hold[s] ? -99 : noisy(m, buyPhase ? 0 : -Math.log(g.last[s]) * 3 - Math.max(0, flows[s]) / 20)));
        const s = argmax(score);
        if (score[s] > 0.3 || buyPhase) push(buyFrac(g, seat, s, 0.22 + r() * 0.2, at));
      }
      break;
    }
    case "ant": {
      if (m.yolo && p.cash > assets * 0.5) {
        push(buyFrac(g, seat, Math.floor(r() * N_STOCKS), 1, at));
        break;
      }
      const x = r();
      if (x < 0.3) push(buyFrac(g, seat, Math.floor(r() * N_STOCKS), 0.15 + r() * 0.3, at));
      else if (x < 0.36) push(buyFrac(g, seat, argmax(flows.map((f) => f + r() * 5)), 0.3 + r() * 0.3, at));
      else if (x < 0.46) {
        const held = p.hold.map((h, s) => (h ? s : -1)).filter((s) => s >= 0);
        if (held.length) push(sellFrac(g, seat, held[Math.floor(r() * held.length)], 0.3 + r() * 0.7, at));
      }
      break;
    }
  }
  // 어려움: 막판엔 남은 현금을 제일 잘 오르는 종목에 (끝까지 들고 감)
  if (hard && endgame && left > 2500 && p.cash > assets * 0.2 && m.style !== "ant") {
    const s = argmax(g.prices.map((pr, i) => Math.log(pr / BATTLE.startPrice) + flows[i] / 30));
    push(buyFrac(g, seat, s, 1, at));
  }
  m.nextAt = at + react(m) * (out.length ? 1 : 0.5);
  return out;
}
