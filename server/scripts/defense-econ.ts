/**
 * 픽셀 운빨 디펜스 — 성장 경제 시뮬 (봇 한 명이 처음부터 오염 30 클리어까지 판을 계속하면 몇 시간 걸리나)
 *   npx tsx scripts/defense-econ.ts [-b 봇이름] [--speed 2] [--max 1500] [--gp 1] [--log 25]
 *
 * 판마다: 지금 성장(정비소 프로필)으로 로드아웃을 만들어 봇이 실제로 판을 돌림 (sim.ts, 결정론) →
 *   서버와 같은 보상 함수(progress.ts runReward · collectReward · glitchFirstClear · 미션 어림 · 시즌 패스 무료)로 재화 →
 *   욕심쟁이 소비(보관함 → 연구 → 유닛 강화 → 코어: 세력칸 · 유물 상자 · 유물 강화 · 초월 소환) →
 *   업적 GP(이 게임 업적만) 로 패키지 · 재화샵.
 * 시간 = 판 시간(게임 속 초) ÷ 배속(기본 2, 사람은 ×1~×3 섞어 씀) + 판 사이 30초.
 * 봇은 사람보다 배치 · 균열 · 조합이 서툴러서 실제 사람은 이보다 빠름 (봇 시간 ≈ 상한).
 */
import { createRequire } from "node:module";
import { B, TPS, TUNE } from "../../web/src/lib/defense/balance";
import { botByName, botTurn, type BotCfg } from "../../web/src/lib/defense/bot";
import { newGame, step, type Board } from "../../web/src/lib/defense/sim";
import { EXP, EXP_BOSS_PATCH, SQUAD_NEXT } from "../../web/src/lib/defense/town";
import { UNIT, UNITS, RECIPES } from "../../web/src/lib/defense/units";
import { ACHIEVEMENTS } from "../../web/src/lib/points";
import {
  BENCH_BASE,
  BENCH_COST,
  BENCH_MAX,
  BOX,
  CHEAT_RES,
  DAILY_POOL,
  FRES_COST,
  FRES_MAX,
  GLITCH,
  GLITCH_MAX,
  GRIT_MAX,
  GP_PACKS,
  packPct,
  GP_SELL,
  type Goods,
  PASS,
  RELICS,
  RELIC,
  RELIC_MAX_LV,
  RES,
  RES_MAX_LV,
  TRANS_IDS,
  UNIT_MAX_LV,
  WEEKLY_POOL,
  collectReward,
  LV_COST,
  deepGlitch,
  glitchFirstClear,
  glitchUnlocks,
  lvCost,
  relicUpCost,
  relicShardsToMax,
  RELIC_DUP_CORES,
  resUpCost,
  runReward,
  transRoll,
  TREASURE,
  TREASURE_WAVES,
  treasureChance,
  treasureReward,
  type Loadout,
  TOWN_MAX,
  TOWN_RELIC,
  MASTERY_FROM,
  masteryNeed,
  townAvail,
  townFirstClear,
  townGlitchLv,
} from "../../web/src/lib/defense/progress";

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const BOT = opt("-b", "균형")!;
const SPEED = Number(opt("--speed", "2"));
const MAXRUNS = Number(opt("--max", "1500"));
const USE_GP = opt("--gp", "1") === "1";
/** 봇은 초월 조합을 못 써서 기본은 초월 소환에 코어를 안 씀 (--trans 1 이면 씀) */
const USE_TRANS = opt("--trans", "0") === "1";
/** --nogrit 1: 끈기 없이 (비교용) */
const NO_GRIT = opt("--nogrit", "0") === "1";
const LOG = Number(opt("--log", "25"));
const SEED = Number(opt("--seed", "7"));
/** --town N: 원정이 열려 있고 아직 안 깬 단계가 있으면 N판에 한 번 원정 (0 = 원정 안 함). 메인 50 + 원정 23 을 다 깨면 끝 */
const TOWN_EVERY_RUNS = Number(opt("--town", "0"));
/** 원정 판 사이 고르는 시간 (분, 시간은 멈추지만 사람은 고민함) */
const TOWN_CAMP_MIN = Number(opt("--campmin", "2"));
/** --mastery 0 이면 심연 숙련 끔 (비교용) · --mbase/--mstep 로 필요 경험치 곡선 바꿔 보기 */
const USE_MAST = opt("--mastery", "1") === "1";
const MBASE = opt("--mbase");
const MSTEP = opt("--mstep");
const mNeed = (lv: number) => (MBASE || MSTEP ? Number(MBASE ?? 300) + Number(MSTEP ?? 25) * lv : masteryNeed(lv));

/* 결정론 난수 (상자 · 초월 소환 어림용 — 판 시드와 별개) */
let rs = SEED * 2654435761;
const R = () => {
  rs = (Math.imul(rs ^ (rs >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
  return rs / 4294967296;
};

/* ── 실험용: 심연 곡선 · 심연 보상 기울기 · 레벨업 조각 배수 바꿔 보기 (progress.ts 가 두 벌 불릴 수 있어 둘 다) ── */
{
  const both = <T,>(k: string, mine: T): T[] => [...new Set([mine, createRequire(import.meta.url)("../../web/src/lib/defense/progress.ts")[k] as T])];
  const deep = opt("--deep");
  const rslope = opt("--rslope");
  if (deep || rslope) {
    const [hpPerLv, armor11, armor20, boss15, boss25, spd20] = (deep ?? "0.015,1.08,1.15,1.03,1.08,1.06").split(",").map(Number);
    const d = deepGlitch({ hpPerLv, armor11, armor20, boss15, boss25, spd20 });
    for (const arr of both("GLITCH", GLITCH))
      d.forEach((x, i) => Object.assign(arr[11 + i], x, rslope ? { reward: Math.round((4 + Number(rslope) * (i + 1)) * 100) / 100 } : {}));
  }
// --tune k=v,k=v : balance.ts TUNE 값 바꿔 보기 (두 벌 다)
{
  const tv = opt("--tune");
  if (tv)
    for (const T of new Set([TUNE, createRequire(import.meta.url)("../../web/src/lib/defense/balance.ts").TUNE]))
      for (const kv of tv.split(",")) {
        const [k, v] = kv.split("=");
        (T as Record<string, number>)[k] = Number(v);
      }
}
  const ch = opt("--cheathp");
  if (ch) for (const T of new Set([TUNE, createRequire(import.meta.url)("../../web/src/lib/defense/balance.ts").TUNE])) T.cheatHp = Number(ch);
  const lvm = Number(opt("--lvmult", "1"));
  if (lvm !== 1) for (const arr of both("LV_COST", LV_COST)) for (const c of arr) c.pieces = Math.round(c.pieces * lvm);
  const cm = Number(opt("--cardmult", "1"));
  if (cm !== 1) for (const arr of both("LV_COST", LV_COST)) for (const c of arr) c.cards = Math.round(c.cards * cm);
}

const cfg: BotCfg = botByName(BOT)!;
const focus = cfg.focus;

interface P {
  pieces: number;
  cores: number;
  gp: number;
  cards: Record<string, number>;
  lv: Record<string, number>;
  res: string[];
  resLv: Record<string, number>;
  relics: string[];
  relicLv: Record<string, number>;
  shards: Record<string, number>;
  bench: number;
  fslots: number;
  trans: string[];
  pity: number;
  cheatRes: string[];
  grit: { g: number; n: number };
  glitchOpen: number;
  glitchWin: number;
  seen: Set<string>;
  boxes: { card: number; relic: number };
  ach: Set<string>;
  bought: Record<string, number>;
  xp: number;
  passGot: number;
  week: number;
  weekBuys: Record<string, number>;
  dayBuys: Record<string, number>;
  stats: { runs: number; wins: number; kills: number; wave: number };
  townDone: number[];
  mlv: number;
  mxp: number;
  squads: string[];
  patches: string[];
  expSeen: string[];
}
const p: P = {
  pieces: 300,
  cores: 0,
  gp: 0,
  cards: {},
  lv: {},
  res: [],
  resLv: {},
  relics: [],
  relicLv: {},
  shards: {},
  bench: BENCH_BASE,
  fslots: 0,
  trans: [],
  pity: 0,
  cheatRes: [],
  grit: { g: 0, n: 0 },
  glitchOpen: 0,
  glitchWin: -1,
  seen: new Set(),
  boxes: { card: 1, relic: 1 },
  ach: new Set(),
  bought: {},
  xp: 0,
  passGot: 0,
  week: -1,
  weekBuys: {},
  dayBuys: {},
  stats: { runs: 0, wins: 0, kills: 0, wave: 0 },
  townDone: [],
  mlv: 0,
  mxp: 0,
  squads: ["knight"],
  patches: [],
  expSeen: [],
};

/* ── 봇이 끼는 연구 · 유물 (그 길에 맞게) ── */
const GEN_RES = ["g_gold", "g_wave", "g_summon", "g_boss", "g_stone", "g_sell"];
const FAC_RES: Record<string, string[]> = {
  knight: ["k_drill", "k_tactic", "k_rally"],
  mech: ["m_drill", "m_tune", "m_bounty"],
  arcane: ["a_drill", "a_focus", "a_echo"],
};
const facRes = focus ? FAC_RES[focus] : ["k_drill", "m_drill", "a_drill"];
// 순수 혈통은 한 세력 70% 이상일 때만 켜짐 → 순혈 운영(보관함 · 판매로 비율을 맞춤)만 끼고, 섞어 쓰는 주력 세력 봇은 안 낌
const RELIC_PREF = focus
  ? [...(cfg.patch === "pure" ? ["pure_blood"] : []), "vaccine", "hourglass", "war_banner", "twin_star", "alchemy", "gold_gear", "lucky_clover", "first_harvest"]
  : ["rainbow", "vaccine", "war_banner", "twin_star", "hourglass", "alchemy", "gold_gear", "lucky_clover", "first_harvest"];

function loadout(): Loadout {
  const gen = GEN_RES.filter((r) => p.res.includes(r)).slice(0, 4);
  const fr = facRes.filter((r) => p.res.includes(r)).slice(0, p.fslots);
  const relics = RELIC_PREF.filter((r) => p.relics.includes(r)).slice(0, 3);
  return {
    lv: { ...p.lv },
    res: [...gen, ...fr],
    resLv: { ...p.resLv },
    relics,
    relicLv: { ...p.relicLv },
    glitch: p.glitchOpen,
    bench: p.bench,
    fslots: p.fslots,
    own: Object.fromEntries(p.relics.map((id) => [id, p.relicLv[id] ?? 1])),
    trans: [...p.trans],
    cheat: p.cheatRes.includes("x_luck") ? "x_luck" : (p.cheatRes[0] ?? ""),
    grit: NO_GRIT || p.glitchOpen <= p.glitchWin || p.grit.g !== p.glitchOpen ? 0 : p.grit.n,
    mastery: p.mlv,
  };
}

/** 이 길에서 키울 유닛 (주력 세력 + 히든 + 초월). 균형이면 전부 */
const mine = UNITS.filter((u) => !focus || u.faction === focus || u.faction === "hidden");

/** 보물방 (서버 defense.start · onRun 과 같은 규칙) — --treasure 0 이면 끔 */
const USE_TRE = opt("--treasure", "1") === "1";
let twaves = 0,
  treasures = 0;
function play(seed: number, town = 0) {
  const lo: Loadout = town
    ? { ...loadout(), grit: 0, stage: "town", town, squads: [...p.squads], patches: [...p.patches], expSeen: [...p.expSeen] }
    : { ...loadout(), patches: [...p.patches] };
  if (!town && USE_TRE && R() < treasureChance(twaves, lo.glitch ?? 0)) {
    lo.treasure = TREASURE_WAVES[Math.floor(R() * TREASURE_WAVES.length)];
    twaves = 0;
    treasures++;
  }
  const g = newGame(seed, 1, [lo]);
  const b = g.boards[0];
  while (!g.over && g.tick < 220_000) {
    for (const c of botTurn(g, 0, cfg)) {
      // botTurn 이 이미 apply 함
      void c;
    }
    step(g);
  }
  if (town) return { r: b.result!, made: b.made, exp: b.exp };
  if ((lo.glitch ?? 0) >= TREASURE.minGlitch) twaves = Math.min(TREASURE.cap, twaves + b.result!.wave);
  if (b.treasure) {
    const t = treasureReward(lo.glitch ?? 0, b.treasure);
    p.pieces += t.pieces ?? 0;
    p.cores += t.cores ?? 0;
    p.boxes.card += t.cardBox ?? 0;
  }
  return { r: b.result!, made: b.made, exp: null as Board["exp"] };
}

/** 원정 판 보상 (서버 defenseMeta.onTownRun 과 같은 규칙) */
function townReward(r: { win: boolean; wave: number; kills: number; reason: string }, made: Record<string, number>, lv: number, x: NonNullable<Board["exp"]>) {
  const grades = Object.fromEntries(Object.keys(made).map((id) => [id, UNIT[id]?.grade ?? 0]));
  const rw = runReward("town", r, made, grades, townGlitchLv(lv));
  if (r.win && r.reason === "clear" && x.act >= 2) {
    rw.pieces = Math.round(rw.pieces * EXP.act2Reward);
    rw.cores = Math.round(rw.cores * EXP.act2Reward);
  }
  for (const id of Object.keys(made).sort()) {
    if (p.seen.has(id)) continue;
    p.seen.add(id);
    const cr = collectReward(UNIT[id].grade);
    if (cr) {
      rw.pieces += cr.pieces;
      rw.cores += cr.cores ?? 0;
    }
  }
  if (r.win && !p.townDone.includes(lv)) {
    p.townDone.push(lv);
    const g = townFirstClear(lv);
    rw.cores += g.cores ?? 0;
    p.boxes.relic += g.relicBox ?? 0;
    p.boxes.card += g.cardBox ?? 0;
    const tr = TOWN_RELIC[lv];
    if (tr && !p.relics.includes(tr)) p.relics.push(tr);
  }
  const nx = r.win && x.squad ? SQUAD_NEXT[x.squad] : undefined;
  if (nx && !p.squads.includes(nx)) p.squads.push(nx);
  for (const f of x.kills) if (EXP_BOSS_PATCH[f] && !p.patches.includes(EXP_BOSS_PATCH[f])) p.patches.push(EXP_BOSS_PATCH[f]);
  for (const id of x.relics) if (!id.startsWith("sq_") && !p.expSeen.includes(id)) p.expSeen.push(id);
  p.pieces += Math.round(rw.pieces);
  p.cores += Math.round(rw.cores);
  for (const [id, n] of Object.entries(rw.cards)) p.cards[id] = (p.cards[id] ?? 0) + n;
  p.xp += rw.xp;
  gainMastery(r.wave);
  p.stats.runs++;
  p.stats.kills += r.kills;
}
/** 심연 숙련 (서버 defenseMeta 와 같은 규칙) */
function gainMastery(wave: number) {
  if (!USE_MAST || p.glitchWin < MASTERY_FROM) return;
  p.mxp += wave;
  while (p.mxp >= mNeed(p.mlv)) {
    p.mxp -= mNeed(p.mlv);
    p.mlv++;
  }
}

/* ── 보상 ── */
const DAILY_AVG = DAILY_POOL.reduce((a, q) => a + q.pieces, 0) / DAILY_POOL.length;
const WEEKLY_AVG = WEEKLY_POOL.reduce((a, q) => a + q.pieces, 0) / WEEKLY_POOL.length;
const WEEKLY_CORE = WEEKLY_POOL.reduce((a, q) => a + (q.cores ?? 0), 0) / WEEKLY_POOL.length;
const QUEST_XP = DAILY_POOL.reduce((a, q) => a + q.xp, 0) / DAILY_POOL.length;
/** 하루에 몇 판 (첫 판 ×2 · 일일 미션 · 주간 미션 · 시즌 패스 주기 어림) */
const RUNS_PER_DAY = Number(opt("--perday", "8"));
/** 한 주 = 하루 판 수 × 7 */
const RUNS_PER_WEEK = RUNS_PER_DAY * 7;

let hours = 0;
let gpTotal = 0;
let gpSold = 0;
const log: string[] = [];

function reward(r: { win: boolean; wave: number; kills: number; tick: number }, made: Record<string, number>, glitch: number) {
  const grades = Object.fromEntries(Object.keys(made).map((id) => [id, UNIT[id]?.grade ?? 0]));
  // 끈기 (서버 defenseMeta.onRun 과 같은 규칙)
  if (glitch === p.glitchOpen && glitch > p.glitchWin)
    p.grit = glitchUnlocks(glitch, r) || r.win ? { g: glitch, n: 0 } : { g: glitch, n: Math.min(GRIT_MAX, (p.grit.g === glitch ? p.grit.n : 0) + 1) };
  const rw = runReward("season", r, made, grades, glitch);
  if (p.stats.runs % RUNS_PER_DAY === 0) {
    rw.pieces *= 2; // 오늘 첫 판
    // 일일 미션 3개 (다 한다고 봄)
    rw.pieces += DAILY_AVG * 3;
    p.xp += QUEST_XP * 3;
  }
  if (p.stats.runs % (RUNS_PER_DAY * 7) === 0) {
    rw.pieces += WEEKLY_AVG * 3;
    rw.cores += WEEKLY_CORE * 3;
    p.xp += 150 * 3;
  }
  for (const id of Object.keys(made).sort()) {
    if (p.seen.has(id)) continue;
    p.seen.add(id);
    const cr = collectReward(UNIT[id].grade);
    if (cr) {
      rw.pieces += cr.pieces;
      rw.cores += cr.cores ?? 0;
    }
  }
  if (r.win && glitch > p.glitchWin) {
    const fc = glitchFirstClear(glitch);
    rw.cores += fc.cores;
    p.boxes.relic += fc.relicBox;
    p.glitchWin = glitch;
  }
  p.pieces += Math.round(rw.pieces);
  p.cores += Math.round(rw.cores);
  for (const [id, n] of Object.entries(rw.cards)) p.cards[id] = (p.cards[id] ?? 0) + n;
  p.xp += rw.xp;
  // 시즌 패스 무료 줄 (시즌이 4주마다 돌지만 xp 를 계속 쌓는 것으로 어림 — 30단계 넘으면 다음 시즌)
  for (;;) {
    const t = p.passGot % 30;
    const need = PASS[t].xp - (t ? PASS[t - 1].xp : 0);
    if (p.xp < need) break;
    p.xp -= need;
    const f = PASS[t].free;
    p.pieces += f.pieces ?? 0;
    p.cores += f.cores ?? 0;
    p.boxes.card += f.cardBox ?? 0;
    p.boxes.relic += f.relicBox ?? 0;
    p.gp += 0; // 패스 GP 는 업적 GP 가 아니라서 셈에서 뺌
    p.passGot++;
  }
  if (glitchUnlocks(glitch, r) && glitch >= p.glitchOpen && p.glitchOpen < GLITCH_MAX) p.glitchOpen = glitch + 1;
  if (r.win) p.stats.wins++;
  gainMastery(r.wave);
  p.stats.runs++;
  p.stats.kills += r.kills;
  p.stats.wave = Math.max(p.stats.wave, r.wave);
}

/* ── 업적 GP (이 게임 것만) ── */
function achievements() {
  const m: Record<string, number> = {
    "defense.runs": p.stats.runs,
    "defense.wave": p.stats.wave,
    "defense.wins": p.stats.wins,
    "defense.kills": p.stats.kills,
    "defense.glitch": p.glitchWin + 1,
    "defense.maxlv": Math.max(0, ...Object.values(p.lv)),
    "defense.relics": p.relics.length,
  };
  for (const a of ACHIEVEMENTS) {
    if (a.game !== "defense" || p.ach.has(a.id)) continue;
    if ((m[a.metric] ?? 0) >= a.goal) {
      p.ach.add(a.id);
      p.gp += a.reward;
      gpTotal += a.reward;
    }
  }
}

/* ── 소비 ── */
function openBoxes() {
  while (p.boxes.card > 0) {
    p.boxes.card--;
    const pool = UNITS.filter((u) => u.faction !== "hidden" && u.grade <= 4);
    const wsum = pool.reduce((s, u) => s + (5 - u.grade), 0);
    for (let i = 0; i < BOX.card.n; i++) {
      let r = Math.floor(R() * wsum);
      const u = pool.find((x) => (r -= 5 - x.grade) < 0)!;
      p.cards[u.id] = (p.cards[u.id] ?? 0) + 1;
    }
  }
  while (p.boxes.relic > 0) {
    p.boxes.relic--;
    const tr = R();
    const o = BOX.relic.tierOdds;
    const tier = tr < o[0] ? 0 : tr < o[0] + o[1] ? 1 : 2;
    const pool = RELICS.filter((r) => r.tier === tier);
    const pick = pool[Math.floor(R() * pool.length)];
    if (p.relics.includes(pick.id)) {
      if ((p.shards[pick.id] ?? 0) >= relicShardsToMax(pick.id, p.relicLv[pick.id] ?? 1)) p.cores += RELIC_DUP_CORES[pick.tier];
      else p.shards[pick.id] = (p.shards[pick.id] ?? 0) + 1;
    }
    else p.relics.push(pick.id);
  }
}

function spend() {
  openBoxes();
  // GP: 남는 재화를 GP 로 (주 한도) → 패키지 (재화샵은 효율이 낮아 안 씀)
  if (USE_GP) {
    const wk = Math.floor(p.stats.runs / RUNS_PER_WEEK);
    if (p.week !== wk) {
      p.week = wk;
      p.weekBuys = {};
    }
    for (const x of GP_SELL) {
      // 조각은 쓸 데가 다 막혔을 때만 (만 개 넘게 남으면) · 코어는 안 팜
      if (x.pay.cores) continue;
      while ((p.weekBuys[x.id] ?? 0) < x.perWeek && p.pieces >= (x.pay.pieces ?? 0) + 10_000) {
        p.pieces -= x.pay.pieces ?? 0;
        p.gp += x.gp;
        gpSold += x.gp;
        p.weekBuys[x.id] = (p.weekBuys[x.id] ?? 0) + 1;
      }
    }
    for (const pk of [...GP_PACKS].sort((a, b) => packPct(b) - packPct(a))) {
      const n = p.bought[pk.id] ?? 0;
      if (pk.once && n) continue;
      if (pk.needWin !== undefined && p.glitchWin < pk.needWin) continue;
      const day = Math.floor(p.stats.runs / RUNS_PER_DAY);
      if (pk.perDay) {
        if ((p.dayBuys[`${day}:${pk.id}`] ?? 0) >= pk.perDay) continue;
      } else if (!pk.once && (p.weekBuys[pk.id] ?? 0) >= (pk.perWeek ?? 1)) continue;
      if (pk.give.trans && !USE_TRANS) continue;
      if (p.gp >= pk.gp) {
        p.gp -= pk.gp;
        p.bought[pk.id] = n + 1;
        if (pk.perDay) p.dayBuys[`${day}:${pk.id}`] = (p.dayBuys[`${day}:${pk.id}`] ?? 0) + 1;
        else p.weekBuys[pk.id] = (p.weekBuys[pk.id] ?? 0) + 1;
        addGoods(pk.give);
      }
    }
    openBoxes();
  }
  // 보관함 (조각)
  while (p.bench < BENCH_MAX && p.pieces >= BENCH_COST[p.bench - BENCH_BASE] * 1.5) {
    p.pieces -= BENCH_COST[p.bench - BENCH_BASE];
    p.bench++;
  }
  // 연구 열기 · 올리기 (장착할 것만)
  const want = [...GEN_RES.slice(0, 4), ...facRes.slice(0, Math.max(p.fslots, 0))];
  for (const id of want) {
    if (!p.res.includes(id) && p.pieces >= RES[id].cost) {
      p.pieces -= RES[id].cost;
      p.res.push(id);
    }
  }
  // 조각을 유닛 · 연구에 나눔: 연구 레벨은 유닛 평균 레벨을 따라감
  let guard = 0;
  while (guard++ < 400) {
    const avgLv = mine.reduce((a, u) => a + (p.lv[u.id] ?? 0), 0) / mine.length;
    // 연구: 가장 낮은 것부터, 유닛 평균 레벨 / 2 까지
    const r = want.filter((id) => p.res.includes(id) && (p.resLv[id] ?? 1) < RES_MAX_LV).sort((a, b) => (p.resLv[a] ?? 1) - (p.resLv[b] ?? 1))[0];
    if (r && (p.resLv[r] ?? 1) <= avgLv / 2 + 1 && p.pieces >= resUpCost(r, p.resLv[r] ?? 1)) {
      p.pieces -= resUpCost(r, p.resLv[r] ?? 1);
      p.resLv[r] = (p.resLv[r] ?? 1) + 1;
      continue;
    }
    // 유닛: 가장 낮은 레벨 · 높은 등급부터 (카드가 있는 것)
    const u = mine
      .filter((x) => (p.lv[x.id] ?? 0) < UNIT_MAX_LV && (p.cards[x.id] ?? 0) >= lvCost(x.grade, p.lv[x.id] ?? 0).cards && p.pieces >= lvCost(x.grade, p.lv[x.id] ?? 0).pieces)
      .sort((a, b) => (p.lv[a.id] ?? 0) - (p.lv[b.id] ?? 0) || b.grade - a.grade)[0];
    if (u) {
      const c = lvCost(u.grade, p.lv[u.id] ?? 0);
      p.cards[u.id] -= c.cards;
      p.pieces -= c.pieces;
      p.lv[u.id] = (p.lv[u.id] ?? 0) + 1;
      continue;
    }
    // 남는 조각 → 카드 상자 (카드가 모자라 막혔을 때)
    const reserve = p.fslots >= Math.min(FRES_MAX, facRes.length) && !p.cheatRes.includes("x_luck") ? 12000 : 0;
    if (p.pieces >= BOX.card.pieces * 4 + reserve) {
      p.pieces -= BOX.card.pieces;
      p.boxes.card++;
      openBoxes();
      continue;
    }
    break;
  }
  // 코어: 세력칸 → 초월(내 세력 것 없으면) → 유물 강화 → 유물 상자
  guard = 0;
  while (guard++ < 200) {
    if (p.fslots < Math.min(FRES_MAX, facRes.length) && p.cores >= FRES_COST[p.fslots]) {
      p.cores -= FRES_COST[p.fslots];
      p.fslots++;
      continue;
    }
    // 치트 연구: 세력칸을 다 산 뒤 (확률 증폭기 먼저)
    const cr = CHEAT_RES.find((x) => !p.cheatRes.includes(x.id) && x.id === "x_luck");
    if (p.fslots >= Math.min(FRES_MAX, facRes.length) && cr && p.cores >= cr.cores && p.pieces >= cr.pieces) {
      p.cores -= cr.cores;
      p.pieces -= cr.pieces;
      p.cheatRes.push(cr.id);
      continue;
    }
    const myTrans = focus ? TRANS_IDS.filter((t) => UNIT[t].faction === focus) : [...TRANS_IDS];
    if (USE_TRANS && p.glitchOpen >= 8 && myTrans.some((t) => !p.trans.includes(t)) && p.cores >= BOX.trans.cores) {
      p.cores -= BOX.trans.cores;
      transPull();
      continue;
    }
    const eq = RELIC_PREF.filter((r) => p.relics.includes(r)).slice(0, 3);
    const up = [...eq, ...p.relics.filter((r) => !eq.includes(r))].find((r) => (p.relicLv[r] ?? 1) < RELIC_MAX_LV && (p.shards[r] ?? 0) >= relicUpCost(r, p.relicLv[r] ?? 1).shards && p.cores >= relicUpCost(r, p.relicLv[r] ?? 1).cores);
    if (up) {
      const c = relicUpCost(up, p.relicLv[up] ?? 1);
      p.shards[up] -= c.shards;
      p.cores -= c.cores;
      p.relicLv[up] = (p.relicLv[up] ?? 1) + 1;
      continue;
    }
    const relicsMaxed = p.relics.length === RELICS.length && RELICS.every((r) => (p.relicLv[r.id] ?? 1) >= RELIC_MAX_LV);
    // 치트 연구를 사려고 코어를 모으는 중이면 유물 상자는 미룸
    const saving = p.fslots >= Math.min(FRES_MAX, facRes.length) && !p.cheatRes.includes("x_luck") ? 120 : 0;
    if (!relicsMaxed && p.cores >= BOX.relic.cores + saving) {
      p.cores -= BOX.relic.cores;
      p.boxes.relic++;
      openBoxes();
      continue;
    }
    break;
  }
}

function addGoods(g: Goods) {
  p.pieces += g.pieces ?? 0;
  p.cores += g.cores ?? 0;
  p.boxes.card += g.cardBox ?? 0;
  p.boxes.relic += g.relicBox ?? 0;
  for (let i = 0; i < (g.trans ?? 0); i++) transPull();
}
function transPull() {
  const out = transRoll(p.pity, R);
  p.pity = out.pity;
  if (out.trans) {
    if (!p.trans.includes(out.trans)) p.trans.push(out.trans);
    else p.cards[out.trans] = (p.cards[out.trans] ?? 0) + BOX.trans.dupCards;
  } else if (out.give) addGoods(out.give);
}

/* ── 돌리기 ── */
const t0 = Date.now();
let firstAt: Record<number, number> = {};
const townAt: Record<number, number> = {};
let townRuns = 0;
for (let i = 0; i < MAXRUNS; i++) {
  const glitch = p.glitchOpen;
  // 메인을 다 깼으면 원정만
  const skipMain = TOWN_EVERY_RUNS > 0 && p.glitchWin >= GLITCH_MAX;
  const { r, made } = skipMain ? { r: { win: false, wave: 0, tick: 0, kills: 0 }, made: {} } : play(SEED * 100000 + i);
  if (!skipMain) {
  const min = r.tick / TPS / 60;
  hours += (min / SPEED + 0.5) / 60;
  reward(r, made, glitch);
  achievements();
  spend();
  if (r.win && firstAt[glitch] === undefined) firstAt[glitch] = hours;
  if (i % LOG === 0 || (r.win && glitch === GLITCH_MAX))
    log.push(
      `${String(i).padStart(4)}판 ${hours.toFixed(1).padStart(5)}h 오염${String(glitch).padStart(2)} ${r.win ? "클리어" : `${r.wave}W`.padStart(4)} · 조각 ${p.pieces} 코어 ${p.cores} GP ${p.gp}/${gpTotal}+${gpSold} · 유닛평균Lv ${(mine.reduce((a, u) => a + (p.lv[u.id] ?? 0), 0) / mine.length).toFixed(1)} · 연구 ${Object.values(p.resLv).join("")} · 유물 ${p.relics.length}개 Lv합 ${p.relics.reduce((a, x) => a + (p.relicLv[x] ?? 1), 0)} · 보관 ${p.bench} 세력칸 ${p.fslots} · 초월 ${p.trans.length} · 치트연구 ${p.cheatRes.join("")} · 숙련 ${p.mlv}`
    );
  }
  if (!skipMain && r.win && glitch === GLITCH_MAX && (!TOWN_EVERY_RUNS || p.townDone.includes(TOWN_MAX))) break;
  // 원정: N판마다, 열린 단계 중 안 깬 게 있으면
  const tl = townAvail(p.glitchOpen, p.townDone);
  const mainDone = p.glitchWin >= GLITCH_MAX;
  if (TOWN_EVERY_RUNS && tl > 0 && !p.townDone.includes(tl) && (mainDone || i % TOWN_EVERY_RUNS === TOWN_EVERY_RUNS - 1)) {
    const t = play(SEED * 100000 + 50000 + i, tl);
    hours += (t.r.tick / TPS / 60 / SPEED + 0.5 + TOWN_CAMP_MIN) / 60;
    townRuns++;
    townReward(t.r, t.made, tl, t.exp!);
    achievements();
    spend();
    if (t.r.win && townAt[tl] === undefined) townAt[tl] = hours;
    if (LOG && townRuns % 10 === 0) log.push(`  원정 ${townRuns}판 ${hours.toFixed(1)}h · ${tl}단계 ${t.r.win ? (t.r.reason === "act2" ? "1막 클리어" : "클리어") : "실패"} · 분대 ${p.squads.length} · 시작 치트 ${p.patches.length}`);
  }
  if (mainDone && TOWN_EVERY_RUNS && p.townDone.includes(TOWN_MAX)) break;
}
console.log(`성장 경제 시뮬 — 봇 ${BOT} · 배속 ${SPEED} · 하루 ${RUNS_PER_DAY}판 · GP ${USE_GP ? "씀" : "안 씀"} · ${args.join(" ")}`);
console.log(log.join("\n"));
console.log("\n오염 단계 첫 클리어 시간: " + Object.entries(firstAt).map(([g, h]) => `${g}:${h.toFixed(0)}h`).join(" "));
console.log(`보물방 ${treasures}번`);
if (TOWN_EVERY_RUNS) console.log(`원정 ${townRuns}판 · 단계 첫 클리어 시간: ` + Object.entries(townAt).map(([g, h]) => `${g}:${h.toFixed(0)}h`).join(" ") + ` · 분대 ${p.squads.join(",")} · 시작 치트 ${p.patches.join(",")} · 도감 ${p.expSeen.length}`);
console.log(`총 ${p.stats.runs}판 · ${hours.toFixed(1)}시간 · 업적 GP ${gpTotal} · 판매 GP ${gpSold} · 패키지 ${JSON.stringify(p.bought)} · 계산 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
void B;
void RELIC;
void RECIPES;
