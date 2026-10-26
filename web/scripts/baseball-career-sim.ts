/**
 * 육성 결과 분포 시뮬: npx tsx scripts/baseball-career-sim.ts [커리어 수] [난이도 0~2]
 *
 * 봇 선수 여러 명을 끝까지 키워 은퇴 종합의 백분위를 냄.
 *   선택 · 실력은 사람마다 다르게 — 체력 관리(무리 정도) · 외출 · 몰빵 · 상점, 타이밍 σ 30 ~ 110ms
 *   같은 시드 · 같은 성향으로 GP 부스트 0 vs 전부 를 비교해서 GP 몫(≤ 30%) 확인
 */
import {
  act, applyGame, botAction, botShop, canPlay, careerBatter, choose, endSeason, newCareer, ovrOf, stepOf, TALENTS, GP_IDS,
  TUNE, type BatType, type Career, type GpId, type Policy,
} from "../src/lib/baseball/career";
if (process.env.XP) TUNE.gameXp = Number(process.env.XP);
if (process.env.TR) TUNE.train = Number(process.env.TR);
import { botHook, careerSetup, humanHook, playCareerGame } from "../src/lib/baseball/careerGame";
import type { Diff } from "../src/lib/baseball/ai";
import { makeRng } from "../src/lib/baseball/rng";

const N = Number(process.argv[2] ?? 300);
const diff = Number(process.argv[3] ?? 1) as Diff;
const TYPES: BatType[] = ["contact", "power", "speed", "defense", "all"];

interface Persona {
  pol: Policy;
  sigma: number;
  type: BatType;
}

function persona(i: number): Persona {
  const r = makeRng(9000 + i * 17);
  return {
    pol: {
      restBelow: 18 + r() * 40,
      outing: 0.05 + r() * 0.25,
      focus: 0.3 + r() * 0.65,
      shop: r() < 0.75,
      bold: r(),
    },
    sigma: (30 + r() * 80) / 1000,
    type: TYPES[i % TYPES.length],
  };
}

function run(i: number, gp: GpId[], sig?: number, auto = false) {
  const ps = persona(i);
  if (sig) ps.sigma = sig;
  const c: Career = newCareer({ name: `봇${i}`, num: 10, bats: i % 3 ? "R" : "L", type: ps.type, diff, gp, seed: 777 + i * 1013 });
  const rng = makeRng(31337 + i * 7);
  const talent0 = c.talent;
  let injuries = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const st = stepOf(c);
    if (st === "retired") break;
    if (ps.pol.shop) botShop(c);
    if (st === "pending") choose(c, rng() < ps.pol.bold ? 0 : 1);
    else if (st === "turn") {
      const o = act(c, botAction(c, ps.pol, rng));
      if (o.tone === "injury" || o.extra?.tone === "injury") injuries++;
    } else if (st === "game") {
      if (canPlay(c)) {
        const setup = careerSetup(c.seed, c.season, c.week, careerBatter(c), c.trust, diff);
        const g = playCareerGame(setup, auto ? botHook(diff) : humanHook(ps.sigma), makeRng(c.seed + c.turn * 101));
        applyGame(c, { line: g.line, win: g.win, missionPt: g.missionPt, missions: g.pas.filter((p) => p.mission?.ok).length, direct: true });
      } else applyGame(c, null);
    } else if (st === "seasonEnd") endSeason(c);
  }
  return { ovr: ovrOf(c), c, talent0, injuries, sigma: ps.sigma, pol: ps.pol };
}

const pct = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const t0 = Date.now();
const base: ReturnType<typeof run>[] = [];
const gpAll: number[] = [];
for (let i = 0; i < N; i++) {
  base.push(run(i, []));
  gpAll.push(run(i, [...GP_IDS]).ovr);
}
const o0 = base.map((r) => r.ovr).sort((a, b) => a - b);
const o1 = [...gpAll].sort((a, b) => a - b);
console.log(`${N}명 · 난이도 ${diff} · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
console.log("백분위      p3   p10   p25   p50   p75   p90   p97   p99  max");
const row = (name: string, a: number[]) =>
  console.log(name.padEnd(10), [0.03, 0.1, 0.25, 0.5, 0.75, 0.9, 0.97, 0.99].map((p) => String(pct(a, p)).padStart(5)).join(" "), String(a[a.length - 1]).padStart(4));
row("GP 0", o0);
row("GP 전부", o1);
const ratio = [0.1, 0.5, 0.9, 0.97].map((p) => (pct(o1, p) / pct(o0, p)).toFixed(2));
console.log("GP 전부 / GP 0 (p10 p50 p90 p97):", ratio.join(" "));
let share = 0;
for (let i = 0; i < N; i++) share += Math.max(0, gpAll[i] - base[i].ovr) / Math.max(1, gpAll[i]);
console.log(`GP 몫 평균 ${(share / N * 100).toFixed(1)}%  (같은 선수 GP 전부 대비)`);
console.log(`800+ ${(o0.filter((v) => v >= 800).length / N * 100).toFixed(1)}%  900+ ${(o0.filter((v) => v >= 900).length / N * 100).toFixed(2)}%  ≤200 ${(o0.filter((v) => v <= 200).length / N * 100).toFixed(1)}%`);
// 재능 · 실력 · 각성별 평균
const by = <K extends string | number>(key: (r: ReturnType<typeof run>) => K) => {
  const m = new Map<K, number[]>();
  for (const r of base) m.set(key(r), [...(m.get(key(r)) ?? []), r.ovr]);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}:${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}(${v.length})`).join("  ");
};
console.log("재능별 평균", by((r) => TALENTS[r.talent0].g));
console.log("타이밍 σ별", by((r) => (r.sigma < 0.05 ? "a<50ms" : r.sigma < 0.075 ? "b<75ms" : "c<110ms")));
console.log("체력관리별", by((r) => (r.pol.restBelow < 30 ? "a무리" : r.pol.restBelow < 45 ? "b보통" : "c신중")));
console.log("각성", by((r) => (r.c.awakened ? "O" : "X")));
console.log("부상횟수", by((r) => Math.min(r.injuries, 4)));
console.log("타입", by((r) => r.c.type));
const avgOf = (f: (c: Career) => number) => (base.reduce((a, r) => a + f(r.c), 0) / N).toFixed(1);
console.log(`평균 스탯 hit ${avgOf((c) => c.stats.hit)} pow ${avgOf((c) => c.stats.power)} run ${avgOf((c) => c.stats.run)} def ${avgOf((c) => c.stats.def)} · 특수능력 ${avgOf((c) => c.skills.length)} · 필살 ${avgOf((c) => (c.learned ? 1 : 0))}`);
console.log(`통산 평균 타율 ${(base.reduce((a, r) => a + r.c.total.h / Math.max(1, r.c.total.ab), 0) / N).toFixed(3)}  HR ${avgOf((c) => c.total.hr)}  타석 ${avgOf((c) => c.total.pa)}  신뢰 ${avgOf((c) => c.trust)}`);

// 실력 차이 (같은 선수 · 같은 선택, 타이밍만 다르게)
{
  const M = Math.min(N, 80);
  let a = 0, b = 0, au = 0;
  for (let i = 0; i < M; i++) {
    a += run(i, [], 0.035).ovr;
    b += run(i, [], 0.1).ovr;
    au += run(i, [], undefined, true).ovr;
  }
  console.log(`실력 차이 (같은 선수 ${M}명): 타이밍 σ35ms 평균 ${Math.round(a / M)} vs σ100ms 평균 ${Math.round(b / M)} · 자동 진행만 ${Math.round(au / M)}`);
}

// 상위 % 표 (career.ts PCT_TABLE 에 옮겨 적기)
{
  const cuts = [950, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150];
  console.log("PCT_TABLE", cuts.map((v) => `[${v}, ${+(o0.filter((x) => x >= v).length / N).toFixed(4)}]`).join(", "));
}
