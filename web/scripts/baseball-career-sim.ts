/**
 * 육성 결과 분포 시뮬: npx tsx scripts/baseball-career-sim.ts [커리어 수] [난이도 0~2] [GP 비교 수] [실력 비교 수]
 *
 * 봇 선수 여러 명을 끝까지(10년, 은퇴 연차는 성향) 키워 은퇴 종합의 백분위를 냄.
 *   선택 · 실력은 사람마다 다르게 — 체력 관리(무리 정도) · 외출 · 몰빵 · 상점 · 은퇴 연차, 타이밍 σ 30 ~ 110ms,
 *   경기 방식(직접 20% · 하이라이트 60% · 자동 20%)
 *   같은 시드 · 같은 성향으로 GP 부스트 0 vs 전부 를 비교해서 GP 몫(≤ 30%) 확인
 */
import {
  act, applyGame, botAction, botPick, botShop, canPlay, careerBatter, choose, choosePick, decideRetire, endSeason, newCareer, ovrOf, spUses, stepOf,
  TALENTS, GP_IDS, TUNE, type BatType, type Career, type GpId, type Policy,
} from "../src/lib/baseball/career";
import { botHook, careerSetup, humanHook, playCareerGame } from "../src/lib/baseball/careerGame";
import type { Diff } from "../src/lib/baseball/ai";
import { makeRng } from "../src/lib/baseball/rng";

if (process.env.XP) TUNE.gameXp = Number(process.env.XP);
if (process.env.TR) TUNE.train = Number(process.env.TR);

const N = Number(process.argv[2] ?? 200);
const diff = Number(process.argv[3] ?? 1) as Diff;
const NGP = Number(process.argv[4] ?? Math.min(N, 80));
const NSK = Number(process.argv[5] ?? Math.min(N, 40));
const TYPES: BatType[] = ["contact", "power", "speed", "defense", "all"];
type Mode = "direct" | "highlight" | "auto";

interface Persona {
  pol: Policy;
  sigma: number;
  type: BatType;
  mode: Mode;
}

function persona(i: number): Persona {
  const r = makeRng(9000 + i * 17);
  const m = r();
  return {
    pol: {
      restBelow: 18 + r() * 40,
      outing: 0.2 + r() * 0.7,
      focus: 0.3 + r() * 0.65,
      shop: r() < 0.8,
      bold: r(),
      retireAt: r() < 0.6 ? 10 : 7 + Math.floor(r() * 3),
    },
    sigma: (30 + r() * 80) / 1000,
    type: TYPES[i % TYPES.length],
    mode: m < 0.2 ? "direct" : m < 0.8 ? "highlight" : "auto",
  };
}

export function run(i: number, gp: GpId[], over: Partial<Persona> = {}) {
  const ps = { ...persona(i), ...over };
  const c: Career = newCareer({ name: `봇${i}`, num: 10, bats: i % 3 ? "R" : "L", type: ps.type, diff, gp, seed: 777 + i * 1013 });
  const rng = makeRng(31337 + i * 7);
  const talent0 = c.talent;
  let injuries = 0;
  let spent = 0;
  for (let guard = 0; guard < 6000; guard++) {
    const st = stepOf(c);
    if (st === "retired") break;
    const m0 = c.money;
    if (ps.pol.shop) botShop(c);
    spent += Math.max(0, m0 - c.money);
    if (st === "pending") choose(c, rng() < ps.pol.bold ? 0 : 1);
    else if (st === "pick") choosePick(c, botPick(c, rng));
    else if (st === "retireAsk") decideRetire(c, c.season >= ps.pol.retireAt);
    else if (st === "turn") {
      const o = act(c, botAction(c, ps.pol, rng));
      if (o.tone === "injury" || o.extra?.tone === "injury") injuries++;
    } else if (st === "game") {
      if (canPlay(c)) {
        const setup = careerSetup(c.seed, c.season, c.week * 2 + c.gameInWeek, careerBatter(c), c.trust, diff, spUses(c));
        const me = humanHook(ps.sigma);
        const bot = botHook(diff);
        const g =
          ps.mode === "auto"
            ? playCareerGame(setup, bot, makeRng(c.seed + c.turn * 101))
            : playCareerGame(setup, me, makeRng(c.seed + c.turn * 101), ps.mode === "highlight" ? bot : undefined);
        applyGame(c, { line: g.line, win: g.win, missionPt: g.missionPt, missions: g.pas.filter((p) => p.mission?.ok).length, direct: ps.mode !== "auto" });
      } else applyGame(c, null);
    } else if (st === "seasonEnd") endSeason(c);
  }
  return { ovr: ovrOf(c), c, talent0, injuries, sigma: ps.sigma, pol: ps.pol, mode: ps.mode, spent };
}

const pct = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const t0 = Date.now();
const base: ReturnType<typeof run>[] = [];
for (let i = 0; i < N; i++) base.push(run(i, []));
const o0 = base.map((r) => r.ovr).sort((a, b) => a - b);
console.log(`${N}명 · 난이도 ${diff} · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
console.log("백분위      p3   p10   p25   p50   p75   p90   p97   p99  max");
const row = (name: string, a: number[]) =>
  console.log(name.padEnd(10), [0.03, 0.1, 0.25, 0.5, 0.75, 0.9, 0.97, 0.99].map((p) => String(pct(a, p)).padStart(5)).join(" "), String(a[a.length - 1]).padStart(4));
row("전체", o0);
console.log(`800+ ${(o0.filter((v) => v >= 800).length / N * 100).toFixed(1)}%  900+ ${(o0.filter((v) => v >= 900).length / N * 100).toFixed(2)}%  ≤200 ${(o0.filter((v) => v <= 200).length / N * 100).toFixed(1)}%`);
const by = <K extends string | number>(key: (r: ReturnType<typeof run>) => K) => {
  const m = new Map<K, number[]>();
  for (const r of base) m.set(key(r), [...(m.get(key(r)) ?? []), r.ovr]);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}:${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}(${v.length})`).join("  ");
};
console.log("재능별 평균", by((r) => TALENTS[r.talent0].g));
console.log("경기 방식", by((r) => r.mode));
console.log("체력관리별", by((r) => (r.pol.restBelow < 30 ? "a무리" : r.pol.restBelow < 45 ? "b보통" : "c신중")));
console.log("은퇴 연차", by((r) => r.c.seasons.length));
console.log("각성", by((r) => (r.c.awakened ? "O" : "X")));
console.log("부상횟수", by((r) => Math.min(r.injuries, 6)));
console.log("타입", by((r) => r.c.type));
console.log("세트 수", by((r) => r.c.skills.filter((s) => s.startsWith("set_")).length));
const avgOf = (f: (c: Career) => number) => (base.reduce((a, r) => a + f(r.c), 0) / N).toFixed(1);
console.log(`평균 스탯 hit ${avgOf((c) => c.stats.hit)} pow ${avgOf((c) => c.stats.power)} run ${avgOf((c) => c.stats.run)} def ${avgOf((c) => c.stats.def)} · 특수능력 ${avgOf((c) => c.skills.length)} · 필살 ${avgOf((c) => (c.learned ? 1 : 0))} · 인기도 ${avgOf((c) => c.fame)}`);
console.log(`통산 평균 타율 ${(base.reduce((a, r) => a + r.c.total.h / Math.max(1, r.c.total.ab), 0) / N).toFixed(3)}  HR ${avgOf((c) => c.total.hr)}  경기 ${avgOf((c) => c.total.g)}  신뢰 ${avgOf((c) => c.trust)}`);
console.log(`자금: 쓴 돈 ${(base.reduce((a, r) => a + r.spent, 0) / N).toFixed(0)} · 남은 돈 ${avgOf((c) => c.money)} · 장비 단계 합 ${avgOf((c) => Object.values(c.gear).reduce((a, b) => a + (b ?? 0), 0))}`);

// GP: 같은 선수 GP 0 vs 전부
{
  const a: number[] = [];
  const b: number[] = [];
  let share = 0;
  for (let i = 0; i < NGP; i++) {
    const x = base[i].ovr;
    const y = run(i, [...GP_IDS]).ovr;
    a.push(x);
    b.push(y);
    share += Math.max(0, y - x) / Math.max(1, y);
  }
  a.sort((p, q) => p - q);
  b.sort((p, q) => p - q);
  console.log(`GP (같은 선수 ${NGP}명): 백분위 p10 p50 p90 비율 ${[0.1, 0.5, 0.9].map((p) => (pct(b, p) / pct(a, p)).toFixed(2)).join(" ")} · GP 몫 평균 ${(share / NGP * 100).toFixed(1)}%`);
}
// 실력: 같은 선수 · 같은 선택, 직접 출전 타이밍만 다르게
{
  let a = 0, b = 0, au = 0;
  for (let i = 0; i < NSK; i++) {
    a += run(i, [], { sigma: 0.035, mode: "direct" }).ovr;
    b += run(i, [], { sigma: 0.1, mode: "direct" }).ovr;
    au += run(i, [], { mode: "auto" }).ovr;
  }
  console.log(`실력 (같은 선수 ${NSK}명 · 직접): σ35ms ${Math.round(a / NSK)} vs σ100ms ${Math.round(b / NSK)} · 자동만 ${Math.round(au / NSK)}`);
}
{
  const cuts = [950, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150];
  console.log("PCT_TABLE", cuts.map((v) => `[${v}, ${+(o0.filter((x) => x >= v).length / N).toFixed(4)}]`).join(", "));
}
