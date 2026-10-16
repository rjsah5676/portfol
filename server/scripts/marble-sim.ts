/*
 * DICE TOWN 밸런스 시뮬 — AI 끼리 잔뜩 돌려 승률 · 판 흐름을 봄.
 *
 *   npx tsx scripts/marble-sim.ts                     # 흐름: 무작위 장비 3인 (별 · 족보 · 코인 출처 · 역전)
 *   npx tsx scripts/marble-sim.ts --mode char         # 캐릭터별: 그 캐릭터(2강, 장비 없음) vs 연습 인형 둘
 *   npx tsx scripts/marble-sim.ts --mode item         # 아이템별: 인형 + 그 아이템(2강) vs 인형 둘
 *   npx tsx scripts/marble-sim.ts --mode mirror       # 인형끼리 (자리 · 선 치우침 확인, 1/n 근처여야)
 *   -n 300 · -p 3(인원) · --rule starPrice=25 · --ck kai.cd=4 · --tune passive=1.2
 */
import { createRequire } from "node:module";
import type { Loadout } from "../../web/src/lib/marble/data";
// web 쪽은 CommonJS 라 engine 이 require 로 부르는 data 와 같은 인스턴스를 써야 --ck · --tune 이 먹음
const { CHARS, CK, IK, ITEMS, TUNE } = createRequire(import.meta.url)("../../web/src/lib/marble/data") as typeof import("../../web/src/lib/marble/data");
import { RULE, act, newGame, standings, type Game } from "../../web/src/lib/marble/engine";
import { botAction } from "../../web/src/lib/marble/bot";

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const N = Number(opt("-n", "300"));
const NP = Number(opt("-p", "3"));
const MODE = opt("--mode", "flow")!;
for (const kv of (opt("--tune", "") ?? "").split(",").filter(Boolean)) {
  const [k, v] = kv.split("=");
  (TUNE as Record<string, number>)[k] = Number(v);
}
for (const kv of (opt("--rule", "") ?? "").split(",").filter(Boolean)) {
  const [k, v] = kv.split("=");
  (RULE as Record<string, unknown>)[k] = Number(v);
}
// --ck kai.cd=4,ur-moa.cut=8/7 (캐릭터 · 아이템 수치표 바꿔 보기)
for (const kv of (opt("--ck", "") ?? "").split(",").filter(Boolean)) {
  const [path, v] = kv.split("=");
  const [id, f] = path.split(".");
  const tbl = (id in CK ? CK : IK) as unknown as Record<string, Record<string, unknown>>;
  tbl[id][f] = v.includes("/") ? v.split("/").map(Number) : Number(v);
}

let seedCounter = 12345;
const rand = () => {
  seedCounter = (Math.imul(seedCounter, 1103515245) + 12345) >>> 0;
  return seedCounter / 4294967296;
};
const pickOf = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
const DUMMY: Loadout = { char: { id: "dummy", lv: 0 } };

function play(los: Loadout[], seed: number): Game {
  const g = newGame({ seed, first: seed % los.length, players: los.map((lo, i) => ({ id: `p${i}`, name: `P${i}`, bot: true, lo })) });
  let guard = 0;
  while (!g.over && guard++ < 6000) act(g, g.prompt!.p, botAction(g, { greed: rand() * 0.8 - 0.3 }));
  if (!g.over) throw new Error("판이 안 끝남");
  return g;
}

/** 0번 자리(테스트 대상) 승률 — 자리를 돌려 가며 */
function winRate(target: Loadout, n = N): number {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const los = Array.from({ length: NP }, () => DUMMY);
    const at = i % NP;
    los[at] = target;
    const g = play(los, 1000 + i);
    if (standings(g)[0] === at) w++;
  }
  return w / n;
}

if (MODE === "char") {
  console.log(`캐릭터 2강 vs 인형 ${NP - 1} (기준 ${(100 / NP).toFixed(0)}%) · ${N}판`);
  for (const c of CHARS) console.log(`${c.grade.padEnd(3)} ${c.id.padEnd(13)} ${(winRate({ char: { id: c.id, lv: 2 } }) * 100).toFixed(1)}%`);
} else if (MODE === "item") {
  console.log(`인형 + 아이템 2강 vs 인형 ${NP - 1} (기준 ${(100 / NP).toFixed(0)}%) · ${N}판`);
  for (const it of ITEMS) console.log(`${it.grade.padEnd(3)} ${it.id.padEnd(10)} ${(winRate({ char: { id: "dummy", lv: 0 }, [it.slot]: { id: it.id, lv: 2 } }) * 100).toFixed(1)}%`);
} else if (MODE === "mirror") {
  const wins = Array(NP).fill(0);
  for (let i = 0; i < N; i++) {
    const g = play(Array(NP).fill(DUMMY), 500 + i);
    wins[(standings(g)[0] - g.first + NP) % NP]++;
  }
  console.log("차례 순서별 1등 (선 · 둘째 …)", wins.map((w) => `${((w / N) * 100).toFixed(0)}%`).join(" · "));
} else {
  // 흐름
  const hands: Record<string, number> = {};
  const coin: Record<string, number> = {};
  let turns = 0;
  let stars = 0;
  let buy = 0;
  let yacht = 0;
  let comeback = 0;
  let close = 0;
  for (let i = 0; i < N; i++) {
    const los: Loadout[] = Array.from({ length: NP }, () => {
      const c = pickOf(CHARS);
      const it = (slot: "dice" | "buddy") => (rand() < 0.7 ? { id: pickOf(ITEMS.filter((x) => x.slot === slot)).id, lv: Math.floor(rand() * 4) } : null);
      return { char: { id: c.id, lv: Math.floor(rand() * 4) }, dice: it("dice"), buddy: it("buddy") };
    });
    const g = newGame({ seed: 7 + i, players: los.map((lo, k) => ({ id: `p${k}`, name: `P${k}`, bot: true, lo })) });
    let guard = 0;
    while (!g.over && guard++ < 6000) {
      act(g, g.prompt!.p, botAction(g, { greed: rand() * 0.8 - 0.3 }));
      for (const e of g.ev) {
        if (e.t === "turn") turns++;
        if (e.t === "hand") hands[e.hand] = (hands[e.hand] ?? 0) + 1;
        if (e.t === "coin" && e.amt > 0) coin[e.why] = (coin[e.why] ?? 0) + e.amt;
        if (e.t === "star") {
          stars++;
          if (e.why === "buy" || e.why === "vip") buy++;
          if (e.why === "yacht") yacht++;
        }
      }
    }
    const st = standings(g);
    if (g.lead >= 0 && g.lead !== st[0]) comeback++;
    if (g.players[st[0]].stars - g.players[st[1]].stars <= 1) close++;
  }
  const pct = (v: number) => `${((v / N) * 100).toFixed(0)}%`;
  console.log(`${NP}인 ${N}판 · 차례 ${(turns / N).toFixed(1)} · 별/인 ${(stars / N / NP).toFixed(2)} (산 별 ${(buy / N / NP).toFixed(2)} · 야추 ${(yacht / N).toFixed(2)}/판)`);
  console.log(`막판 역전 ${pct(comeback)} · 1·2등 별 차 1 이하 ${pct(close)}`);
  console.log("족보", Object.entries(hands).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((v / turns) * 100).toFixed(1)}%`).join(" · "));
  console.log("코인/차례", Object.entries(coin).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / turns).toFixed(2)}`).join(" · "));
}
