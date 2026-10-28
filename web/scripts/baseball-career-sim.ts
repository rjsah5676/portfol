/**
 * 육성 결과 분포 시뮬: npx tsx scripts/baseball-career-sim.ts [커리어 수] [난이도 0~2] [GP 비교 수] [실력 비교 수]
 *
 * 봇 선수 여러 명을 끝까지(10년, 은퇴 연차는 성향) 키워 은퇴 종합의 백분위를 냄.
 *   선택 · 실력은 사람마다 다르게 — 체력 관리(무리 정도) · 외출 · 몰빵 · 상점 · 은퇴 연차, 타이밍 σ 30 ~ 110ms,
 *   경기 방식(직접 20% · 하이라이트 60% · 자동 20%)
 *   같은 시드 · 같은 성향으로 GP 부스트 0 vs 전부 를 비교해서 GP 몫(≤ 30%) 확인
 */
import {
  act, advance, applyGame, autoBattle, botChoose, botDeck, botTurn, botPick, botShop, canPlay, careerBatter, choose, choosePick, decideRetire, endSeason, finishBattle, gameKey, newCareer, ovrOf, spUses, stepOf,
  BONDS, TALENTS, GP_IDS, TUNE, type BatType, type Career, type GpId, type Policy, type SkillId,
} from "../src/lib/baseball/career";
import { botHook, careerSetup, humanHook, playCareerGame } from "../src/lib/baseball/careerGame";
import type { Diff } from "../src/lib/baseball/ai";
import { makeRng } from "../src/lib/baseball/rng";
import { GROW } from "../src/lib/baseball/data";
import { TYPES as TYPE_DEF } from "../src/lib/baseball/career";
// 튜닝: GROW='{"base":300,"k":0.6}' · APT='{"contact":{"hit":1.3},"power":{"power":1.1}}'
if (process.env.GROW) Object.assign(GROW, JSON.parse(process.env.GROW));
if (process.env.APT) for (const [k, v] of Object.entries(JSON.parse(process.env.APT) as Record<string, object>)) Object.assign(TYPE_DEF[k as BatType].apt, v);

// TAL='[[0.72,360],[0.82,420],...]' — 재능 F~SS 의 [mul, limit] 덮어쓰기
if (process.env.TAL) (JSON.parse(process.env.TAL) as [number, number][]).forEach(([mul, limit], i) => Object.assign(TALENTS[i], { mul, limit }));
if (process.env.TR) TUNE.train = Number(process.env.TR);

const N = Number(process.argv[2] ?? 200);
const diff = Number(process.argv[3] ?? 1) as Diff;
const NGP = Number(process.argv[4] ?? Math.min(N, 80));
const NSK = Number(process.argv[5] ?? Math.min(N, 40));
const TYPES: BatType[] = ["contact", "power", "all"];
type Mode = "direct" | "highlight" | "auto";

export interface Persona {
  pol: Policy;
  sigma: number;
  /** 미연시에서 그 사람다운 답 고를 확률 */
  insight: number;
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
    insight: 0.15 + r() * 0.7,
    type: TYPES[i % TYPES.length],
    mode: m < 0.2 ? "direct" : m < 0.8 ? "highlight" : "auto",
  };
}

export function run(i: number, gp: GpId[], over: Partial<Persona> = {}, extra: SkillId[] = []) {
  const ps = { ...persona(i), ...over };
  const c: Career = newCareer({ name: `봇${i}`, num: 10, bats: i % 3 ? "R" : "L", type: ps.type, diff, gp, seed: 777 + i * 1013, deck: botDeck(ps.type, makeRng(55 + i)) });
  // 처음부터 특수능력(축복 등) 하나 쥐여 주고 비교할 때 (BOON=1)
  for (const id of extra) if (!c.skills.includes(id)) c.skills.push(id);
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
    if (st === "pending") choose(c, c.pending?.scene ? botChoose(c, rng, ps.insight) : rng() < ps.pol.bold ? 0 : 1);
    else if (st === "battle") finishBattle(c, autoBattle(c, rng, ps.sigma), true);
    else if (st === "pick") choosePick(c, botPick(c, rng));
    else if (st === "retireAsk") decideRetire(c, c.season >= ps.pol.retireAt);
    else if (st === "turn") {
      const a = botTurn(c, ps.pol, rng);
      if (!a) advance(c);
      else {
        const o = act(c, a);
        if (o.tone === "injury" || o.extra?.tone === "injury") injuries++;
      }
    } else if (st === "game") {
      if (canPlay(c)) {
        const setup = careerSetup(c.seed, c.season, gameKey(c), careerBatter(c), c.trust, diff, spUses(c), c.deck.map((id) => [id, BONDS[id].stat]));
        const me = humanHook(ps.sigma);
        const bot = botHook(diff);
        const g =
          ps.mode === "auto"
            ? playCareerGame(setup, bot, makeRng(c.seed + c.turn * 101))
            : playCareerGame(setup, me, makeRng(c.seed + c.turn * 101), ps.mode === "highlight" ? bot : undefined);
        applyGame(c, { line: g.line, win: g.win, missionPt: g.missionPt, missions: g.pas.filter((p) => p.mission?.ok).length, results: g.pas.filter((p) => p.mission).map((p) => ({ ok: p.mission!.ok, partial: p.mission!.partial, char: p.mission!.char })), direct: ps.mode !== "auto" });
      } else applyGame(c, null);
    } else if (st === "seasonEnd") endSeason(c);
  }
  return { ovr: ovrOf(c), c, talent0, injuries, sigma: ps.sigma, pol: ps.pol, mode: ps.mode, spent };
}

const pct = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];

/**
 * 실력 · 운 · GP 몫 (SHARE=1): 실력 단계 K개 × 시드 M개를 다 돌려서 2원 분산분해.
 *   실력 u (0 ~ 1) = 타이밍 σ 110 → 30ms · 체력 관리 · 몰빵 · 외출 · 미연시 눈치 · 상점 · 경기 방식(직접)
 *   운 = 시드 (숨은 재능 · 대성공 · 부상 · 각성 · 고르기 패 · 지도)
 *   GP = 전부 산 것 vs 안 산 것 평균 차이 / 종합
 */
function skilled(u: number): Partial<Persona> {
  return {
    sigma: (110 - 80 * u) / 1000,
    insight: 0.1 + 0.8 * u,
    pol: { restBelow: 22 + 22 * u, outing: 0.25 + 0.6 * u, focus: 0.35 + 0.5 * u, shop: u > 0.2, bold: 0.5, retireAt: 10 },
    mode: "direct",
  };
}
function share() {
  const K = Number(process.env.K ?? 5);
  const M = Number(process.env.M ?? 40);
  const grid: number[][] = [];
  for (let k = 0; k < K; k++) {
    const row: number[] = [];
    for (let m = 0; m < M; m++) row.push(run(m, [...GP_IDS], skilled(k / (K - 1))).ovr);
    grid.push(row);
    console.log(`실력 ${(k / (K - 1)).toFixed(2)}: 평균 ${Math.round(row.reduce((a, b) => a + b, 0) / M)} · p10 ${[...row].sort((a, b) => a - b)[Math.floor(M * 0.1)]} · p90 ${[...row].sort((a, b) => a - b)[Math.floor(M * 0.9)]}`);
  }
  const all = grid.flat();
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const rowM = grid.map((r) => r.reduce((a, b) => a + b, 0) / M);
  const colM = Array.from({ length: M }, (_, m) => grid.reduce((a, r) => a + r[m], 0) / K);
  const vS = rowM.reduce((a, v) => a + (v - mean) ** 2, 0) / K;
  const vL = colM.reduce((a, v) => a + (v - mean) ** 2, 0) / M;
  const vT = all.reduce((a, v) => a + (v - mean) ** 2, 0) / all.length;
  // GP: 중간 실력에서 같은 시드로
  let g0 = 0, g1 = 0;
  const NG = Math.min(M, 30);
  for (let m = 0; m < NG; m++) {
    g0 += run(m, [], skilled(0.5)).ovr;
    g1 += run(m, [...GP_IDS], skilled(0.5)).ovr;
  }
  const gpGain = (g1 - g0) / NG;
  // 몫: 표준편차 기준 (실력 폭 · 운 폭 · GP 차이) — 체감은 「얼마나 흔들리나」라서 σ 로 비교
  const sS = Math.sqrt(vS) * 2, sL = Math.sqrt(vL) * 2, sG = gpGain;
  const tot = sS + sL + Math.max(0, sG);
  console.log(`분산: 실력 ${(vS / vT * 100).toFixed(0)}% · 운 ${(vL / vT * 100).toFixed(0)}% · 상호작용 ${((1 - (vS + vL) / vT) * 100).toFixed(0)}%`);
  console.log(`폭(2σ): 실력 ${sS.toFixed(0)} · 운 ${sL.toFixed(0)} · GP +${sG.toFixed(0)} → 몫 실력 ${(sS / tot * 100).toFixed(0)} / 운 ${(sL / tot * 100).toFixed(0)} / GP ${(sG / tot * 100).toFixed(0)}`);
}
/** 코치 · 인연 몫 (COACH=1): 같은 선수로 코치 없음 / C / S · 인연 끔 비교 */
function coachShare() {
  const M = Number(process.env.M ?? 40);
  const avgOf = (f: () => number[]) => {
    const v = f().sort((a, b) => a - b);
    console.log(`  p10 ${v[Math.floor(v.length * 0.1)]} · p50 ${v[Math.floor(v.length / 2)]} · p90 ${v[Math.floor(v.length * 0.9)]} · max ${v[v.length - 1]}`);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const runs = (gp: GpId[] | undefined, coach: "C" | "S", noBond: boolean) => {
    TUNE.coach = coach;
    TUNE.noBond = noBond;
    const out = Array.from({ length: M }, (_, m) => run(m, gp ?? [...GP_IDS]).ovr);
    TUNE.coach = "C";
    TUNE.noBond = false;
    return out;
  };
  const none = avgOf(() => runs([], "C", false));
  const c = avgOf(() => runs(undefined, "C", false));
  const sAll = avgOf(() => runs(undefined, "S", false));
  const noBondC = avgOf(() => runs(undefined, "C", true));
  console.log(`코치 없음 ${none.toFixed(0)} · 전부 C ${c.toFixed(0)} · 전부 S ${sAll.toFixed(0)} · 인연 끔(C) ${noBondC.toFixed(0)}`);
  console.log(`코치 몫: C ${(((c - none) / c) * 100).toFixed(1)}% · S ${(((sAll - none) / sAll) * 100).toFixed(1)}%  |  인연 몫 ${(((c - noBondC) / c) * 100).toFixed(1)}% (+${(c - noBondC).toFixed(0)}) vs 코치 S-없음 +${(sAll - none).toFixed(0)}`);
}

if (process.env.SHARE) share();
else if (process.env.COACH) coachShare();
else if (process.env.BOON) boonValue();
else if (process.env.DIST) statDist();
else main();

function main() {
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
  console.log(`평균 스탯 hit ${avgOf((c) => c.stats.hit)} pow ${avgOf((c) => c.stats.power)} run ${avgOf((c) => c.stats.run)} · 특수능력 ${avgOf((c) => c.skills.length)} · 필살 ${avgOf((c) => (c.learned ? 1 : 0))} · 인기도 ${avgOf((c) => c.fame)}`);
  console.log(`통산 평균 타율 ${(base.reduce((a, r) => a + r.c.total.h / Math.max(1, r.c.total.ab), 0) / N).toFixed(3)}  HR ${avgOf((c) => c.total.hr)}  경기 ${avgOf((c) => c.total.g)}  신뢰 ${avgOf((c) => c.trust)}`);
  const posts = base.flatMap((r) => r.c.seasons.map((s) => s.post ?? "?"));
  const cnt = (k: string) => ((posts.filter((p) => p === k).length / Math.max(1, posts.length)) * 100).toFixed(0);
  console.log(`가을야구 (시즌 ${posts.length}): 우승 ${cnt("우승")}% · 준우승 ${cnt("준우승")}% · 준PO 탈락 ${cnt("준PO 탈락")}% · 진출 실패 ${cnt("진출 실패")}%`);
  console.log(`자금: 쓴 돈 ${(base.reduce((a, r) => a + r.spent, 0) / N).toFixed(0)} · 남은 돈 ${avgOf((c) => c.money)} · 장비 단계 합 ${avgOf((c) => Object.values(c.gear).reduce((a, b) => a + (b ?? 0), 0))}`);

  // 코치: 같은 선수 코치 없음 vs 전부 C (기본)
  {
    const a: number[] = [];
    const b: number[] = [];
    let share = 0;
    for (let i = 0; i < NGP; i++) {
      const x = run(i, []).ovr;
      const y = base[i].ovr;
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

}

/**
 * 축복 값어치 (BOON=b_mei_palm,b_mei_gap,...): 같은 선수 N명에게 처음부터 그 축복 하나를 쥐여 줬을 때 은퇴 종합 · 통산 타율 · 홈런이 없을 때보다 얼마나 오르나
 *   (축복 고르기에서 「정답」이 정해져 있는지 보려고 — 비슷하면 고를 맛이 있음)
 */
function boonValue() {
  const ids = process.env.BOON!.split(",") as SkillId[];
  const M = N;
  const stat = (rs: ReturnType<typeof run>[]) => {
    const o = rs.reduce((a, r) => a + r.ovr, 0) / rs.length;
    const avg = rs.reduce((a, r) => a + r.c.total.h / Math.max(1, r.c.total.ab), 0) / rs.length;
    const hr = rs.reduce((a, r) => a + r.c.total.hr, 0) / rs.length;
    return { o, avg, hr };
  };
  const base = stat(Array.from({ length: M }, (_, i) => run(i, [])));
  console.log(`없음: 종합 ${base.o.toFixed(1)} 타율 ${base.avg.toFixed(3)} HR ${base.hr.toFixed(1)}`);
  for (const id of ids) {
    const r = stat(Array.from({ length: M }, (_, i) => run(i, [], {}, [id])));
    console.log(`${id.padEnd(18)} 종합 ${(r.o - base.o >= 0 ? "+" : "") + (r.o - base.o).toFixed(1)}  타율 ${(r.avg - base.avg >= 0 ? "+" : "") + (r.avg - base.avg).toFixed(3)}  HR ${(r.hr - base.hr >= 0 ? "+" : "") + (r.hr - base.hr).toFixed(1)}`);
  }
}

/**
 * 능력치 쏠림 · 연차별 타율 (DIST=1): 은퇴 때 가장 높은 능력치 · 타격 · 파워 · 주루 백분위, 몰빵 성향(focus ≥ 0.8)만 따로,
 * 직접 출전 사람 타율(시즌별 중앙값)
 */
function statDist() {
  const rs = Array.from({ length: N }, (_, i) => run(i, []));
  const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
  const row = (name: string, a: number[]) => console.log(name.padEnd(14), [0.1, 0.5, 0.9, 0.97, 0.99].map((p) => Math.round(q(a, p))).join(" / "), " max", Math.round(Math.max(...a)));
  console.log("백분위 p10 / p50 / p90 / p97 / p99");
  row("종합", rs.map((r) => r.ovr));
  row("최고 능력치", rs.map((r) => Math.max(r.c.stats.hit, r.c.stats.power, r.c.stats.run)));
  row("타격", rs.map((r) => r.c.stats.hit));
  row("파워", rs.map((r) => r.c.stats.power));
  row("주루", rs.map((r) => r.c.stats.run));
  const foc = rs.filter((r) => r.pol.focus >= 0.8);
  row(`몰빵(${foc.length}) 최고`, foc.map((r) => Math.max(r.c.stats.hit, r.c.stats.power, r.c.stats.run)));
  for (let y = 0; y < 4; y++) {
    const av = rs.filter((r) => r.mode !== "auto" && r.c.seasons[y]).map((r) => r.c.seasons[y].line.h / Math.max(1, r.c.seasons[y].line.ab));
    const all = rs.filter((r) => r.c.seasons[y]).map((r) => r.c.seasons[y].line.h / Math.max(1, r.c.seasons[y].line.ab));
    console.log(`${y + 1}년차 타율 (직접·하이라이트) p25 ${q(av, 0.25).toFixed(3)} 중앙 ${q(av, 0.5).toFixed(3)} p75 ${q(av, 0.75).toFixed(3)}  · 전체 중앙 ${q(all, 0.5).toFixed(3)}`);
  }
}
