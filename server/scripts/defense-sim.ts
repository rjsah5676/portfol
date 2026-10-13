/**
 * 픽셀 글리치 디펜스 밸런스 시뮬 — 봇 전략별로 여러 판을 돌려 결과를 표로.
 *
 *   npx tsx scripts/defense-sim.ts                 전략 전부 × 20판
 *   npx tsx scripts/defense-sim.ts -n 100 -b 마도회   한 전략만 100판
 *   npx tsx scripts/defense-sim.ts --curve          웨이브별 적 체력 · 봇 DPS 곡선
 *   npx tsx scripts/defense-sim.ts --json out.json  결과를 파일로
 *   npx tsx scripts/defense-sim.ts --meta mid      영구 성장을 든 봇 (mid: 몇 주 한 사람 · late: 많이 한 사람 · max: 다 모은 사람)
 *   npx tsx scripts/defense-sim.ts --meta max --glitch 6   오염 단계까지
 *
 * 봇 판도 명령 기록을 남겨 replay 로 다시 돌려 보고 결과가 같은지 확인함 (결정론 검사).
 */
import { writeFileSync } from "node:fs";
import { BALANCE_VER, LAST_WAVE, TPS, hpOf } from "../../web/src/lib/defense/balance";
import { BOTS, botByName, botTurn, type BotCfg } from "../../web/src/lib/defense/bot";
import { replay, type LogEntry } from "../../web/src/lib/defense/replay";
import { newGame, step, unitCount, type Game } from "../../web/src/lib/defense/sim";
import { GRADE_NAME, UNIT, UNITS } from "../../web/src/lib/defense/units";
import type { Loadout } from "../../web/src/lib/defense/progress";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const N = Number(opt("-n") ?? 20);
const only = opt("-b");
const seed0 = Number(opt("--seed") ?? 1000);
const curve = args.includes("--curve");
const verify = !args.includes("--no-verify");
const metaLv = opt("--meta");
const glitch = Number(opt("--glitch") ?? 0);

/** 봇 길에 맞춘 영구 성장 (그 길을 꾸준히 한 사람이 들고 올 만한 것) */
function loadoutFor(cfg: BotCfg): Loadout | null {
  if (!metaLv) return null;
  const lvN = metaLv === "max" ? 10 : metaLv === "late" ? 6 : 3;
  const lv: Record<string, number> = {};
  for (const u of UNITS) if (!cfg.focus || u.faction === cfg.focus || u.faction === "hidden") lv[u.id] = cfg.focus ? lvN : Math.max(1, lvN - 1);
  const fres: Record<string, string[]> = { knight: ["k_drill", "k_tactic"], mech: ["m_drill", "m_tune"], arcane: ["a_drill", "a_focus"] };
  const res = cfg.focus ? ["g_wave", "g_boss", ...fres[cfg.focus]] : ["g_gold", "g_wave", "g_boss", "g_summon"];
  const relics =
    metaLv === "mid"
      ? ["gold_gear", "first_harvest", cfg.gamble ? "gambler_coin" : "lucky_clover"]
      : cfg.focus
        ? ["pure_blood", "vaccine", "hourglass"]
        : ["rainbow", "war_banner", "vaccine"];
  return { lv, res: metaLv === "mid" ? res.slice(0, 2) : res, relics, glitch };
}

interface Run {
  bot: string;
  seed: number;
  win: boolean;
  wave: number;
  reason: string;
  min: number;
  kills: number;
  ms: number;
  dealt: Record<string, number>;
  snap: Record<number, { gold: number; stones: number; units: number; best: number; up: number }>;
  dps: Record<number, number>;
}

function play(cfg: BotCfg, seed: number): Run {
  const lo = loadoutFor(cfg);
  const g: Game = newGame(seed, 1, [lo]);
  const b = g.boards[0];
  const log: LogEntry[] = [];
  const snap: Run["snap"] = {};
  const dps: Run["dps"] = {};
  let lastWave = 0,
    lastDealt = 0,
    lastTick = 0;
  const t0 = performance.now();
  while (!g.over && g.tick < 200_000) {
    for (const c of botTurn(g, 0, cfg)) log.push([g.tick, 0, c]);
    step(g);
    if (b.wave !== lastWave) {
      const total = Object.values(b.dealt).reduce((a, x) => a + x, 0);
      if (lastWave > 0) dps[lastWave] = (total - lastDealt) / ((g.tick - lastTick) / TPS);
      lastDealt = total;
      lastTick = g.tick;
      lastWave = b.wave;
      if (b.wave % 10 === 0 || b.wave === 5) {
        let best = 0;
        for (const c of b.cells) if (c.def) best = Math.max(best, UNIT[c.def].grade);
        snap[b.wave] = { gold: b.gold, stones: b.stones, units: unitCount(b), best, up: b.up.knight + b.up.mech + b.up.arcane };
      }
    }
  }
  const ms = performance.now() - t0;
  const r = b.result!;
  if (verify) {
    const again = replay(seed, 1, log, [lo]).boards[0].result!;
    if (again.wave !== r.wave || again.tick !== r.tick || again.kills !== r.kills || again.win !== r.win)
      throw new Error(`결정론 깨짐: ${cfg.name} seed ${seed} — ${JSON.stringify(r)} vs ${JSON.stringify(again)}`);
  }
  return { bot: cfg.name, seed, win: r.win, wave: r.wave, reason: r.reason, min: r.tick / TPS / 60, kills: r.kills, ms, dealt: b.dealt, snap, dps };
}

const bots = only ? [botByName(only)] : BOTS;
const runs: Run[] = [];
for (const cfg of bots) for (let i = 0; i < N; i++) runs.push(play(cfg, seed0 + i));

const pct = (a: number, n: number) => `${((a / n) * 100).toFixed(0)}%`;
const avg = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

console.log(`\n픽셀 글리치 디펜스 밸런스 시뮬 (버전 ${BALANCE_VER}) — 전략별 ${N}판${metaLv ? ` · 성장 ${metaLv} · 오염 ${glitch}` : ""}${verify ? " · 결정론 확인함" : ""}\n`);
console.log("전략      클리어  평균웨이브 중앙  사망(필드/보스)  평균시간  판당계산");
for (const cfg of bots) {
  const rs = runs.filter((r) => r.bot === cfg.name);
  const cap = rs.filter((r) => r.reason === "cap").length,
    boss = rs.filter((r) => r.reason === "boss").length;
  console.log(
    `${cfg.name.padEnd(8)}  ${pct(rs.filter((r) => r.win).length, rs.length).padStart(5)}  ${avg(rs.map((r) => r.wave)).toFixed(1).padStart(8)}  ${String(med(rs.map((r) => r.wave))).padStart(4)}  ${`${cap}/${boss}`.padStart(13)}  ${avg(rs.map((r) => r.min)).toFixed(1).padStart(6)}분  ${avg(rs.map((r) => r.ms)).toFixed(0).padStart(6)}ms`
  );
}

// 어디서 죽나 (웨이브 구간별)
console.log("\n죽은 웨이브 분포 (전체)");
const buckets: Record<string, number> = {};
for (const r of runs.filter((x) => !x.win)) {
  const k = r.reason === "boss" ? `${r.wave}보스` : `${Math.floor((r.wave - 1) / 10) * 10 + 1}~${Math.floor((r.wave - 1) / 10) * 10 + 10}`;
  buckets[k] = (buckets[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(buckets).sort()) console.log(`  ${k.padEnd(8)} ${"█".repeat(Math.ceil((v / runs.length) * 60))} ${v}`);

// 유닛 피해 비중
console.log("\n유닛별 피해 비중 (전체 판 합)");
const dealt: Record<string, number> = {};
for (const r of runs) for (const [k, v] of Object.entries(r.dealt)) dealt[k] = (dealt[k] ?? 0) + v;
const tot = Object.values(dealt).reduce((a, x) => a + x, 0);
for (const [k, v] of Object.entries(dealt).sort((a, b) => b[1] - a[1]).slice(0, 20))
  console.log(`  ${`${UNIT[k].name}(${GRADE_NAME[UNIT[k].grade]})`.padEnd(16)} ${((v / tot) * 100).toFixed(1).padStart(5)}%`);

// 웨이브별 상태
console.log("\n웨이브별 평균 상태 (도달한 판만)");
console.log("웨이브  골드  행운석  유닛  최고등급  강화합");
for (const w of [5, 10, 20, 30, 40, 50, 60]) {
  const s = runs.map((r) => r.snap[w]).filter(Boolean);
  if (!s.length) continue;
  console.log(
    `${String(w).padStart(5)}  ${avg(s.map((x) => x.gold)).toFixed(0).padStart(4)}  ${avg(s.map((x) => x.stones)).toFixed(1).padStart(6)}  ${avg(s.map((x) => x.units)).toFixed(1).padStart(4)}  ${avg(s.map((x) => x.best)).toFixed(2).padStart(8)}  ${avg(s.map((x) => x.up)).toFixed(1).padStart(6)}   (${s.length}판)`
  );
}

if (curve) {
  console.log("\n웨이브별 적 체력(20마리 합) vs 봇 평균 DPS × 20초");
  for (let w = 1; w <= LAST_WAVE; w += 3) {
    const d = runs.map((r) => r.dps[w]).filter((x) => x !== undefined);
    console.log(`  w${String(w).padStart(2)}  적 ${String(hpOf(w) * 20).padStart(9)}  처리량 ${avg(d).toFixed(0).padStart(9)}×20=${(avg(d) * 20).toFixed(0).padStart(10)}  (${d.length}판)`);
  }
}

const out = opt("--json");
if (out) {
  writeFileSync(out, JSON.stringify({ ver: BALANCE_VER, runs: runs.map(({ dealt: _d, ...r }) => r) }, null, 1));
  console.log(`\n저장: ${out}`);
}
