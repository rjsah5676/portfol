/**
 * 육성 v4(한 시즌) 결과 분포 시뮬: npx tsx scripts/baseball-career-sim.ts [선수 수]
 *
 * 봇 선수 여러 명을 한 시즌 끝까지 키워 시즌 종합의 백분위를 냄.
 *   선택 · 실력은 사람마다 다르게 — 체력 관리 · 몰빵 · 함께 훈련 쫓기 · 상점 · 미연시 눈치, 타이밍 σ 30 ~ 110ms,
 *   경기 방식(직접 20% · 하이라이트 60% · 자동 20%)
 * 환경 손잡이: TR=훈련 배율 · FMODE=direct|highlight|auto · NOBOND=1 (인연 끔) · DIST=1 (분포표 PCT_TABLE 줄)
 */
import {
  act, applyGame, autoBattle, botAction, botChoose, botDeck, botMissions, botOffer, botPick, botShop, canPlay, careerBatter, choose, chooseMissions, chooseOffer, choosePick, endSeason, finishBattle,
  gameKey, newCareer, ovrOf, PITCH_LV, pitchLv, slotOfCareer, spUses, stepOf, BONDS, BOND_MAX, STAT_KEYS, TUNE, type BatType, type Career, type Policy,
} from "../src/lib/baseball/career";
import { AUTO_CZ, type SwingHook, botHook, leadCz, careerSetup, playCareerGame } from "../src/lib/baseball/careerGame";
import type { Diff } from "../src/lib/baseball/ai";
import { makeRng } from "../src/lib/baseball/rng";
import { humanSwing } from "../src/lib/baseball/ai";
import { CZ_MOVE, CZ_RANGE } from "../src/lib/baseball/contact";

if (process.env.TR) TUNE.train = Number(process.env.TR);
if (process.env.DIM) Object.assign(TUNE, JSON.parse(process.env.DIM));
if (process.env.PLV) PITCH_LV.splice(0, PITCH_LV.length, ...(JSON.parse(process.env.PLV) as number[]));
if (process.env.NOBOND) TUNE.noBond = true;
if (process.env.AUTOCZ) Object.assign(AUTO_CZ, JSON.parse(process.env.AUTOCZ));
/** 사람 흉내 컨택존 (2026-10-28 실제 로그에 맞춘 값) · 파란 원 따라가기 */
const HCZ = { lead: 0.6, sd: 0.05 };
const FLY = { react: 0.25, sd: 0.06, p: 0.8 };
const czHook = (sigma: number): SwingHook => (s, p, at, b, rng) => {
  const c = humanSwing(p, at, s.strikes, sigma, rng);
  let cz = leadCz(at, HCZ.lead, HCZ.sd, rng);
  if (!p.special && rng() < FLY.p) {
    const t = Math.max(0, p.dur - 0.08 - (0.1 * p.dur + FLY.react + rng.gauss() * FLY.sd));
    const tx = Math.max(-CZ_RANGE.x, Math.min(CZ_RANGE.x, at.x)), ty = Math.max(CZ_RANGE.y0, Math.min(CZ_RANGE.y1, at.y));
    const dx = tx - cz.x, dy = ty - cz.y, d = Math.hypot(dx, dy), m = Math.min(d, CZ_MOVE.flight * t);
    if (d > 1e-6) cz = { x: cz.x + (dx / d) * m, y: cz.y + (dy / d) * m };
  }
  return { swing: c.swing, e: c.e, bunt: false, cz };
};
type Mode = "direct" | "highlight" | "auto";
const FMODE = process.env.FMODE as Mode | undefined;
const N = Number(process.argv[2] ?? 200);
const diff: Diff = 1;
const TYPES: BatType[] = ["contact", "power", "speed", "defense", "all"];

interface Persona {
  pol: Policy;
  sigma: number;
  insight: number;
  type: BatType;
  mode: Mode;
}
function persona(i: number): Persona {
  const r = makeRng(9000 + i * 17);
  const m = r();
  return {
    pol: { restBelow: 22 + r() * 30, focus: 0.3 + r() * 0.65, chase: 0.2 + r() * 0.7, shop: r() < 0.85, bold: r() },
    sigma: (30 + r() * 80) / 1000,
    insight: 0.15 + r() * 0.7,
    type: TYPES[i % TYPES.length],
    mode: m < 0.2 ? "direct" : m < 0.8 ? "highlight" : "auto",
  };
}

function run(i: number) {
  const ps = persona(i);
  const c: Career = newCareer({ name: `봇${i}`, num: 10, bats: i % 3 ? "R" : "L", type: ps.type, seed: 777 + i * 1013, deck: botDeck(ps.type, makeRng(55 + i)) });
  const rng = makeRng(31337 + i * 7);
  let injuries = 0, offers = 0, trains = 0, rests = 0, pas = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const st = stepOf(c);
    if (st === "done") break;
    if (ps.pol.shop) botShop(c);
    if (st === "pending") choose(c, c.pending?.scene ? botChoose(c, rng, ps.insight) : rng() < ps.pol.bold ? 0 : 1);
    else if (st === "battle") finishBattle(c, autoBattle(c, rng, ps.sigma), true);
    else if (st === "pick") choosePick(c, botPick(c, rng));
    else if (st === "offer") (offers++, chooseOffer(c, botOffer(c, rng)));
    else if (st === "missions") chooseMissions(c, botMissions(c));
    else if (st === "end") endSeason(c);
    else if (st === "turn") {
      const a = botAction(c, ps.pol, rng);
      if (a.kind === "train") trains++;
      else rests++;
      const o = act(c, a);
      if (o.tone === "injury" || o.extra?.tone === "injury") injuries++;
    } else if (st === "game") {
      if (canPlay(c)) {
        const setup = careerSetup(c.seed, gameKey(c), careerBatter(c), slotOfCareer(c), diff, pitchLv(c), spUses(c), c.deck.map((id) => [id, BONDS[id].stat]));
        const mode = FMODE ?? ps.mode;
        const bot = botHook(diff);
        const g = mode === "auto" ? playCareerGame(setup, bot, makeRng(c.seed + c.turn * 101), undefined, false) : playCareerGame(setup, czHook(ps.sigma), makeRng(c.seed + c.turn * 101), mode === "highlight" ? bot : undefined);
        pas += g.line.pa;
        applyGame(c, { line: g.line, win: g.win, missionPt: g.missionPt, missions: g.pas.filter((p) => p.mission?.ok).length, results: g.pas.filter((p) => p.mission).map((p) => ({ ok: p.mission!.ok, partial: p.mission!.partial, char: p.mission!.char })), direct: mode !== "auto", clutch: g.clutch, sb: g.sb, cs: g.cs, df: g.df });
      } else applyGame(c, null);
    }
  }
  return { c, ovr: ovrOf(c), ps, injuries, offers, trains, rests, pas };
}

const pct = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const t0 = Date.now();
const res = Array.from({ length: N }, (_, i) => run(i));
const ovrs = res.map((r) => r.ovr).sort((a, b) => a - b);
console.log(`선수 ${N}명 · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
console.log(`종합: 10% ${pct(ovrs, 0.1)} · 25% ${pct(ovrs, 0.25)} · 중앙 ${pct(ovrs, 0.5)} · 75% ${pct(ovrs, 0.75)} · 90% ${pct(ovrs, 0.9)} · 최고 ${ovrs[ovrs.length - 1]} · 최저 ${ovrs[0]}`);
for (const t of TYPES) {
  const rs = res.filter((r) => r.ps.type === t);
  const st = Object.fromEntries(STAT_KEYS.map((k) => [k, Math.round(mean(rs.map((r) => r.c.stats[k])))]));
  console.log(`  ${t.padEnd(8)} 종합 평균 ${Math.round(mean(rs.map((r) => r.ovr)))} · 능력 ${JSON.stringify(st)} · 타율 ${mean(rs.map((r) => (r.c.line.ab ? r.c.line.h / r.c.line.ab : 0))).toFixed(3)} · 홈런 ${mean(rs.map((r) => r.c.line.hr)).toFixed(1)}`);
}
for (const m of ["direct", "highlight", "auto"] as Mode[]) {
  const rs = res.filter((r) => (FMODE ?? r.ps.mode) === m);
  if (rs.length) console.log(`  방식 ${m.padEnd(9)} ${rs.length}명 · 종합 ${Math.round(mean(rs.map((r) => r.ovr)))} · 타율 ${mean(rs.map((r) => (r.c.line.ab ? r.c.line.h / r.c.line.ab : 0))).toFixed(3)}`);
}
const award = (a: string) => ((res.filter((r) => r.c.summary?.awards.includes(a)).length / N) * 100).toFixed(0) + "%";
console.log(`수상: 타격왕 ${award("타격왕")} · 홈런왕 ${award("홈런왕")} · 타점왕 ${award("타점왕")} · 도루왕 ${award("도루왕")} · 골든글러브 ${award("골든글러브")} · 신인왕 ${award("신인왕")} · MVP ${award("MVP")}`);
const resN = (x: string) => ((res.filter((r) => r.c.result === x).length / N) * 100).toFixed(0) + "%";
console.log(`팀: 우승 ${resN("우승")} · 준우승 ${resN("준우승")} · 2위 ${resN("2위")} · 3위 ${resN("3위")} · 4위 ${resN("4위")}`);
console.log(`인연: 필살 습득 ${((res.filter((r) => r.c.learned).length / N) * 100).toFixed(0)}% · 8칸 다 본 사람 평균 ${mean(res.map((r) => r.c.deck.filter((id) => (r.c.bonds[id] ?? 0) >= BOND_MAX).length)).toFixed(2)}명 · 최고 호감 평균 ${Math.round(mean(res.map((r) => Math.max(...r.c.deck.map((id) => r.c.aff[id] ?? 0)))))}`);
console.log(`턴: 훈련 ${mean(res.map((r) => r.trains)).toFixed(1)} · 숙소 ${mean(res.map((r) => r.rests)).toFixed(1)} · 이벤트 고르기 ${mean(res.map((r) => r.offers)).toFixed(1)} · 부상 ${mean(res.map((r) => r.injuries)).toFixed(2)} · 타석 ${mean(res.map((r) => r.pas)).toFixed(1)}`);
console.log(`특수능력 평균 ${mean(res.map((r) => r.c.skills.length)).toFixed(1)}장 · 세트 ${mean(res.map((r) => r.c.skills.filter((s) => s.startsWith("set_")).length)).toFixed(2)} · 남은 스킬P ${Math.round(mean(res.map((r) => r.c.sp)))} · 남은 자금 ${Math.round(mean(res.map((r) => r.c.money)))} · 시즌 미션 ${mean(res.map((r) => (r.c.missions ?? []).filter((m) => m.done).length)).toFixed(2)}/3`);
{
  const q = (f: (c: Career) => number) => { const a = res.map((r) => f(r.c)).sort((x, y) => x - y); return [0.3, 0.5, 0.7, 0.9].map((p) => +pct(a, p).toFixed(3)).join("/"); };
  console.log(`시즌 기록 30/50/70/90%: 안타 ${q((c) => c.line.h)} · 장타 ${q((c) => c.line.d2 + c.line.d3 + c.line.hr)} · 홈런 ${q((c) => c.line.hr)} · 타점 ${q((c) => c.line.rbi)} · 타율 ${q((c) => (c.line.ab ? c.line.h / c.line.ab : 0))} · 도루 ${q((c) => c.line.sb)} · 호수비 ${q((c) => c.line.df)} · 수비 ${q((c) => c.stats.def)}`);
}
if (process.env.DIST) {
  const marks = [950, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300];
  console.log("PCT_TABLE: [" + marks.map((m) => `[${m}, ${Math.max(0.00002, ovrs.filter((o) => o >= m).length / N).toFixed(m >= 800 ? 5 : 3)}]`).join(", ") + ", [0, 1]]");
}
