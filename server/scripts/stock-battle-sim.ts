/*
 * 대전 밸런스 시뮬: 봇끼리 헤드리스로 N판 (250ms 틱, 서버와 같은 엔진 · 같은 봇).
 *   npx tsx scripts/stock-battle-sim.ts [판 수=1000] [인원=8]
 * 목표: 1등 10~40배 · 꼴찌 0.1~0.5배 · 판당 「대박」(한 번에 +50% 이상) 체감 2~4번 · 한 성격이 압도하지 않음 · 가만히 있는 사람은 꼴찌권
 */
import { BATTLE, BattleGame } from "../../web/src/lib/stock/battle";
import { BOT_STYLE_IDS, botThink, newMind, type BotLevel, type BotStyle } from "../../web/src/lib/stock/bots";
import { rngFrom } from "../../web/src/lib/stock/rng";

const N = Number(process.argv[2] ?? 1000);
const P = Number(process.argv[3] ?? 8);
const TICK = 250;
const MODE = (process.env.MODE ?? "impact") as "impact" | "board";
/** 마지막 자리: idle(가만히) · sniper(마지막 변동 뒤에 제일 싼 종목 전액) · holder(시작에 3종목 나눠 사서 끝까지) */
const LAST = process.env.LAST ?? "idle";
const r = rngFrom("sim-setup");

const winners: number[] = [],
  lasts: number[] = [],
  medians: number[] = [],
  idleRank: number[] = [],
  booms: number[] = [],
  boomsHeld: number[] = [],
  bestStock: number[] = [];
const wins: Record<string, number> = {},
  seats: Record<string, number> = {},
  avgMult: Record<string, number[]> = {};
const lvWins: number[] = [0, 0, 0],
  lvSeats: number[] = [0, 0, 0];

for (let gi = 0; gi < N; gi++) {
  const g = new BattleGame(P, `sim${gi}`, { liquidate: MODE });
  // 마지막 자리는 가만히 있는 사람
  const minds = Array.from({ length: LAST === "bot" ? P : P - 1 }, (_, i) => {
    const style = BOT_STYLE_IDS[Math.floor(r() * 4)] as BotStyle;
    const level = Math.floor(r() * 3) as BotLevel;
    return newMind(style, level, rngFrom(`m${gi}:${i}`));
  });
  let felt = 0;
  for (let t = 0; t <= BATTLE.durationMs; t += TICK) {
    const ev = g.advance(t);
    for (const e of ev) {
      // 「체감 대박」: 누가 들고 있던 종목이 한 번에 +50% 이상
      for (let s = 0; s < 10; s++) if (e.ev[s] === 1) felt += g.players.filter((p) => p.hold[s] > 0).length / P;
    }
    if (g.over) break;
    const order = minds.map((_, i) => i).sort(() => r() - 0.5);
    for (const i of order) botThink(g, i, minds[i], t);
    const me = P - 1;
    if (LAST === "sniper" && g.shocks >= BATTLE.shocks && g.players[me].cash > 0) {
      const s = g.prices.indexOf(Math.min(...g.prices));
      g.order(me, s, "buy", 999, t);
    }
    if (LAST === "holder" && t >= 1000 && t < 3000) for (const s of [0, 3, 6]) g.order(me, s, "buy", 13, t);
  }
  g.advance(BATTLE.durationMs);
  const rank = g.ranking();
  const mult = g.players.map((p) => p.cash / BATTLE.startCash);
  winners.push(mult[rank[0]]);
  lasts.push(mult[rank[P - 1]]);
  medians.push([...mult].sort((a, b) => a - b)[P >> 1]);
  idleRank.push(rank.indexOf(P - 1) + 1);
  const h = g.highlights();
  booms.push(h.booms);
  boomsHeld.push(felt);
  bestStock.push(h.bestStock.mult);
  minds.forEach((m, i) => {
    const key = `${m.style}`;
    seats[key] = (seats[key] ?? 0) + 1;
    (avgMult[key] ??= []).push(mult[i]);
    lvSeats[m.level]++;
    if (rank[0] === i) {
      wins[key] = (wins[key] ?? 0) + 1;
      lvWins[m.level]++;
    }
  });
}

const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
const f = (v: number) => v.toFixed(v < 1 ? 2 : 1);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`${N}판 · ${P}명 (봇 ${P - 1} + ${LAST} 1) · 정리 ${MODE}`);
console.log(`1등 배수   p10 ${f(q(winners, 0.1))}  중앙 ${f(q(winners, 0.5))}  p90 ${f(q(winners, 0.9))}  (목표 10~40)  10~40 안 ${(100 * winners.filter((w) => w >= 10 && w <= 40).length / N).toFixed(0)}%`);
console.log(`꼴찌 배수   p10 ${f(q(lasts, 0.1))}  중앙 ${f(q(lasts, 0.5))}  p90 ${f(q(lasts, 0.9))}  (목표 0.1~0.5)`);
console.log(`중간 사람   중앙 ${f(q(medians, 0.5))}`);
console.log(`${LAST} 평균 등수 ${mean(idleRank).toFixed(1)} / ${P}  (꼴찌 ${(100 * idleRank.filter((x) => x === P).length / N).toFixed(0)}% · 하위 2 ${(100 * idleRank.filter((x) => x >= P - 1).length / N).toFixed(0)}%)`);
console.log(`대박(+50%↑) 판당 전체 ${mean(booms).toFixed(1)} · 한 사람이 들고 있다 맞은 「대박 이벤트」 ${mean(boomsHeld).toFixed(1)}  (목표 체감 2~4)`);
console.log(`최고 종목 배수 중앙 ${f(q(bestStock, 0.5))}  p90 ${f(q(bestStock, 0.9))}`);
for (const s of BOT_STYLE_IDS) console.log(`  ${s.padEnd(7)} 1등률 ${((100 * (wins[s] ?? 0)) / (seats[s] ?? 1)).toFixed(1)}%  (공정 ${(100 / P).toFixed(1)}%)  평균 배수 ${f(mean(avgMult[s] ?? [0]))}  중앙 ${f(q(avgMult[s] ?? [0], 0.5))}`);
console.log(`  난이도 1등률 ` + [0, 1, 2].map((l) => `${["쉬움", "보통", "어려움"][l]} ${((100 * lvWins[l]) / Math.max(1, lvSeats[l])).toFixed(1)}%`).join("  "));
