/*
 * 대전 봇 v2 — 사람처럼 매매하는 봇. 사람과 같은 주문 함수(BattleGame.order)만 씀 · 다음 변동 결과는 모름.
 * 봇이 보는 것 = 사람이 보는 것: 시세 · 마지막 변동 · 몰림(최근 순매수) · 남은 시간 · 내 현금 · 보유.
 *
 * 속도 (v1 은 250ms 마다 여러 주문을 쏟아내서 사람 같지 않았음)
 *  - 생각 한 번에 주문 최대 1개 (전부 던질 때만 2개). 주문 뒤엔 1.2~4초 쉼, 아무것도 안 했으면 0.6~2초 뒤 다시 봄
 *  - 사람이 폰에서 누르는 속도: 10초 사이클에 많아야 3~4번. 판 전체 거래 수 상한 CAP (난이도별 45~70)
 *
 * 사람 투자 행동 (행동경제학 — 봇 전부에 공통으로 입힘, 성격은 비율만 다름)
 *  - 처분 효과(disposition): 조금 오르면 금방 익절(+8~15%), 떨어지면 손절을 못 하고 들고 있다가(-30% 넘게) 공포 투매
 *  - 군집(herding) · 주목 효과: 남들이 몰리는 종목 · 방금 대박 난 종목을 따라 삼
 *  - 하우스머니 효과: 번 돈이 있으면 베팅이 커지고(과신), 크게 잃은 직후엔 한동안 움츠림
 *  - 앵커링: 내 평단 밑으로는 잘 안 팜 ("본전만 오면 판다")
 *  - 변동 직전 긴장: 변동 2~3초 전에 던지거나 사는 결정이 몰림 (사람도 그때 손이 바빠짐)
 *
 * 성격 4가지 (방장이 고르지 않음 — 방에 넣을 때 랜덤)
 *  추격형 chaser: 오르는 종목 · 몰리는 종목을 따라 삼, 익절 빠름
 *  세력형 whale : 한 종목을 크게 사 두고 남들이 따라오면 던짐
 *  역추세 contra: 크게 빠진 걸 줍고 크게 오른 걸 팖, 손절도 함
 *  개미형 ant   : 조금씩 아무거나, 가끔 몰빵, 처분 효과 제일 심함
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
/** 난이도: 반응 시간 · 판단 잡음 · 판 전체 거래 수 상한 · 성격 섞임 (초급은 성격대로 못 함) */
export const BOT_LEVELS: Record<BotLevel, { name: string; react: [number, number]; idle: [number, number]; noise: number; cap: number }> = {
  0: { name: "초급", react: [2200, 4200], idle: [1200, 2400], noise: 0.6, cap: 45 },
  1: { name: "중급", react: [1500, 3000], idle: [800, 1800], noise: 0.3, cap: 58 },
  2: { name: "고급", react: [1200, 2200], idle: [600, 1400], noise: 0.12, cap: 70 },
};
/** 방에 봇을 넣을 때 난이도 뽑는 비율 */
export const LEVEL_WEIGHT: [number, number, number] = [35, 45, 20];

export interface BotMind {
  style: BotStyle;
  level: BotLevel;
  rng: Rng;
  nextAt: number;
  cycle: number;
  target: number;
  loads: number;
  dump: boolean;
  yolo: boolean;
  /** 사람 성향 (판마다 조금씩 다름) */
  takeProfit: number; // 익절 선 (평단 대비 배수)
  panic: number; // 공포 투매 선
  greed: number; // 하우스머니 — 번 돈이 있으면 베팅 커짐 (0~1)
  /** 크게 잃은 뒤 움츠린 시각까지 */
  shyUntil: number;
  /** 마지막으로 본 자산 (손실 감지) */
  lastAssets: number;
  trades: number;
}

export function newMind(style: BotStyle, level: BotLevel, rng: Rng): BotMind {
  return {
    style,
    level,
    rng,
    nextAt: 1500 + rng() * 4000,
    cycle: -1,
    target: -1,
    loads: 0,
    dump: false,
    yolo: false,
    takeProfit: style === "ant" ? 1.06 + rng() * 0.06 : style === "chaser" ? 1.08 + rng() * 0.08 : 1.15 + rng() * 0.15,
    panic: style === "contra" ? 0.8 : 0.62 + rng() * 0.12,
    greed: 0.3 + rng() * 0.5,
    shyUntil: 0,
    lastAssets: BATTLE.startCash,
    trades: 0,
  };
}

const between = (m: BotMind, [a, b]: [number, number]) => a + m.rng() * (b - a);
const noisy = (m: BotMind, v: number) => v + (m.rng() - 0.5) * 2 * BOT_LEVELS[m.level].noise;
function argmax(xs: number[]): number {
  let b = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[b]) b = i;
  return b;
}
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
 * 봇 한 명의 생각 한 번. 낸 주문(체결된 것)을 돌려줌 — 한 번에 최대 1개 (전부 던지기는 2개까지).
 * at = 판 시작부터 ms
 */
export function botThink(g: BattleGame, seat: number, m: BotMind, at: number): Fill[] {
  if (g.over || at < m.nextAt) return [];
  const L = BOT_LEVELS[m.level];
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
  const out: Fill[] = [];
  let acted = false;
  const push = (f: Fill | null) => {
    if (f) {
      out.push(f);
      acted = true;
      m.trades++;
    }
  };
  // 거래 수 상한 (사람은 그렇게 많이 못 누름)
  const capped = m.trades >= L.cap && !endgame;

  // 하우스머니 · 손실 뒤 움츠림
  const gainRatio = assets / BATTLE.startCash;
  if (assets < m.lastAssets * 0.7 && at > m.shyUntil) m.shyUntil = at + 8000 + r() * 12000; // 30% 넘게 잃으면 한동안 가만히
  m.lastAssets = assets;
  const shy = at < m.shyUntil;
  const sizeMul = shy ? 0.5 : 1 + (gainRatio > 1.5 ? m.greed * Math.min(1, (gainRatio - 1) / 3) : 0);

  // 새 사이클: 이번에 변동 전에 던질지 정함 (사람은 변동 직전에 손이 바빠짐)
  if (m.cycle !== k) {
    m.cycle = k;
    m.target = m.style === "whale" ? -1 : m.target;
    m.loads = 0;
    const dumpP = m.style === "chaser" ? 0.15 : m.style === "whale" ? 0.35 : m.style === "ant" ? 0.08 : 0;
    m.dump = r() < dumpP;
    m.yolo = m.style === "ant" && r() < 0.1 && !shy;
  }

  // ── 공통 1: 처분 효과 — 이익 난 건 빨리 챙김 (평단 × takeProfit), 손실은 평단 밑에서 잘 안 팖
  if (!capped) {
    for (let s = 0; s < N_STOCKS && !acted; s++) {
      if (!p.hold[s]) continue;
      const up = g.prices[s] / Math.max(1, avg(g, seat, s));
      if (up >= m.takeProfit && r() < (m.style === "contra" ? 0.5 : 0.75)) push(sellFrac(g, seat, s, m.style === "ant" ? 1 : 0.5 + r() * 0.5, at));
      // 공포 투매: 평단 대비 panic 밑 + 방금 또 빠짐
      else if (up <= m.panic && g.last[s] < 0.9 && r() < 0.6) push(sellFrac(g, seat, s, 1, at));
    }
  }

  if (!acted && !capped)
    switch (m.style) {
      case "chaser": {
        if (!buyPhase && m.dump && tNext < 3500 && tNext > 1000 && !(hard && endgame)) {
          // 변동 직전 던지기 (이익 난 것만)
          for (let s = 0; s < N_STOCKS && out.length < 2; s++) if (p.hold[s] && g.prices[s] > avg(g, seat, s) * 1.04) push(sellFrac(g, seat, s, 1, at));
          break;
        }
        if (tNext > 2500 && p.cash > assets * 0.1 && !shy) {
          // 주목 효과: 방금 대박 난 종목 · 몰리는 종목. 너무 끌어올려진 건(변동 뒤 +15%↑) 어려울수록 피함
          const score = g.prices.map((_, s) => {
            const pumped = Math.log(g.prices[s] / g.base[s]);
            const boom = g.lastEv[s] > 0 ? 1.2 : 0;
            return noisy(m, (buyPhase ? 0 : Math.log(g.last[s]) * 2.5) + boom + Math.min(flows[s], 30) / 15 + (pumped > 0.14 ? -3 * pumped * (m.level + 1) : pumped * 2));
          });
          const s = argmax(score);
          if (score[s] > 0.15 || buyPhase) push(buyFrac(g, seat, s, (buyPhase ? 0.5 + r() * 0.4 : 0.4 + r() * 0.45) * sizeMul, at));
        }
        break;
      }
      case "whale": {
        if (m.target < 0 && tNext > 3500 && p.cash > assets * 0.3 && !shy) {
          const score = g.prices.map((pr, s) => noisy(m, -Math.log(pr / BATTLE.startPrice) * 0.5 - Math.abs(flows[s]) / 15));
          m.target = argmax(score);
          m.loads = 2 + Math.floor(r() * 2);
        }
        const s = m.target;
        if (s >= 0 && m.loads > 0 && tNext > 3000) {
          push(buyFrac(g, seat, s, ((0.85 + r() * 0.1) / m.loads) * sizeMul, at));
          m.loads--;
          break;
        }
        if (s >= 0 && p.hold[s]) {
          const up = g.prices[s] / Math.max(1, avg(g, seat, s));
          if (up > 1.12 + r() * 0.1 && tNext > 2000) {
            push(sellFrac(g, seat, s, 0.5 + r() * 0.3, at));
            m.target = -1;
          } else if (m.dump && up > 1.04 && tNext < 3000 && !(hard && endgame)) {
            push(sellFrac(g, seat, s, 1, at));
            m.target = -1;
            m.dump = false;
          }
        }
        if (!acted) for (let x = 0; x < N_STOCKS && !acted; x++) if (x !== s && p.hold[x] && g.prices[x] > avg(g, seat, x) * 1.2) push(sellFrac(g, seat, x, 0.5, at));
        break;
      }
      case "contra": {
        // 크게 오른 것 팔기 (처분 효과보다 더 높은 선)
        for (let s = 0; s < N_STOCKS && !acted; s++) if (p.hold[s] && g.prices[s] > avg(g, seat, s) * (1.3 + r() * 0.2)) push(sellFrac(g, seat, s, 0.6 + r() * 0.4, at));
        // 손절도 함 (역추세는 규율이 있음)
        for (let s = 0; s < N_STOCKS && !acted; s++) if (p.hold[s] && g.prices[s] < avg(g, seat, s) * 0.75 && r() < 0.35) push(sellFrac(g, seat, s, 1, at));
        const heldN = p.hold.filter((h) => h > 0).length;
        if (!acted && tNext > 2500 && p.cash > assets * 0.15 && !shy) {
          const score = g.prices.map((_, s) => (heldN >= 3 && !p.hold[s] ? -99 : noisy(m, buyPhase ? 0 : -Math.log(g.last[s]) * 3 - Math.max(0, flows[s]) / 20)));
          const s = argmax(score);
          if (score[s] > 0.3 || buyPhase) push(buyFrac(g, seat, s, (0.22 + r() * 0.2) * sizeMul, at));
        }
        break;
      }
      case "ant": {
        if (m.yolo && p.cash > assets * 0.5) {
          push(buyFrac(g, seat, argmax(flows.map((f) => f + r() * 20)), 1, at));
          m.yolo = false;
          break;
        }
        const x = r();
        if (x < 0.22 && !shy) push(buyFrac(g, seat, Math.floor(r() * N_STOCKS), (0.15 + r() * 0.3) * sizeMul, at));
        else if (x < 0.3 && !shy) push(buyFrac(g, seat, argmax(flows.map((f) => f + r() * 5)), (0.3 + r() * 0.3) * sizeMul, at));
        else if (x < 0.38) {
          // 본전 앵커링: 평단 넘은 것만 팔고, 밑이면 "본전 오면 판다"
          const held = p.hold.map((h, s) => (h && g.prices[s] >= avg(g, seat, s) * 0.98 ? s : -1)).filter((s) => s >= 0);
          if (held.length) push(sellFrac(g, seat, held[Math.floor(r() * held.length)], 0.3 + r() * 0.7, at));
        }
        break;
      }
    }
  // 어려움: 막판엔 남은 현금을 제일 잘 오르는 종목에 (끝까지 들고 감)
  if (!acted && hard && endgame && left > 2500 && p.cash > assets * 0.2 && m.style !== "ant") {
    const s = argmax(g.prices.map((pr, i) => Math.log(pr / BATTLE.startPrice) + flows[i] / 30));
    push(buyFrac(g, seat, s, 1, at));
  }
  // 변동 직전엔 사람도 손이 빨라짐 (반응 시간 60%)
  const rush = !buyPhase && tNext < 3000 ? 0.6 : 1;
  m.nextAt = at + (acted ? between(m, L.react) : between(m, L.idle)) * rush;
  return out;
}
