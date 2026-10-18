/**
 * 밸런스용 자동 플레이어 — 사람이 할 법한 단순한 전략 몇 가지.
 * 시뮬 배치(scripts/defense-sim.ts) · 게임 안 개발자 창의 "자동 플레이"가 씀.
 * 같은 상태면 늘 같은 명령 (결정론) → 봇 판도 기록으로 다시 돌릴 수 있음.
 */
import { B, BOSS_EVERY } from "./balance";
import { CHEAT, type CheatDef } from "./cheats";
import { PATCHES } from "./meta";
import {
  CELLS,
  SLOTS,
  expNext,
  STACK,
  apply,
  canRecipe,
  usable,
  hasEmpty,
  luckCost,
  nextBlock,
  summonCost,
  upCost,
  type Board,
  type Cmd,
  type Game,
} from "./sim";
import { FACTIONS, RECIPES, UNIT, poolOf, type Faction, type Grade } from "./units";
import type { Loadout } from "./progress";

/** 조합식 재료 (팔지 않고 남겨 둠) */
const MATERIAL = new Set(RECIPES.filter((r) => !r.hidden).flatMap((r) => r.needs));

export interface BotCfg {
  name: string;
  /** 주력 세력 (null = 상황 따라 가장 강한 세력) */
  focus: Exclude<Faction, "hidden"> | null;
  patch: string;
  /** 소환 대신 강화를 고르는 기준: 강화 비용 ≤ 소환 비용 × 이 값 */
  upBias: number;
  gamble: boolean;
  rift: boolean;
  /** 몇 tick 마다 생각하는지 (사람 손 속도 흉내) */
  every: number;
  /** 이 골드는 남겨 둠 (이자 째기) — 필드가 위험하면 무시 */
  keep?: number;
  /** 영구 성장 (루트별 연구 · 유물). 시뮬 스크립트가 newGame 에 넘김 */
  lo?: Loadout;
}

export const BOTS: BotCfg[] = [
  { name: "균형", focus: null, patch: "union", upBias: 1.5, gamble: true, rift: true, every: 15 },
  {
    name: "기사단",
    focus: "knight",
    patch: "union",
    upBias: 1.5,
    gamble: true,
    rift: true,
    every: 15,
  },
  {
    name: "기계공방",
    focus: "mech",
    patch: "union",
    upBias: 1.5,
    gamble: true,
    rift: true,
    every: 15,
  },
  {
    name: "마도회",
    focus: "arcane",
    patch: "union",
    upBias: 1.5,
    gamble: true,
    rift: true,
    every: 15,
  },
  {
    name: "이자",
    focus: null,
    patch: "interest",
    upBias: 1.5,
    gamble: true,
    rift: true,
    every: 15,
  },
  {
    name: "이자째기",
    focus: null,
    patch: "interest",
    upBias: 1.5,
    gamble: true,
    rift: true,
    every: 15,
    keep: 700,
  },
  {
    name: "도박사",
    focus: null,
    patch: "gambler",
    upBias: 1.5,
    gamble: true,
    rift: true,
    every: 15,
  },
  {
    name: "순혈",
    focus: "mech",
    patch: "pure",
    upBias: 1.5,
    gamble: true,
    rift: true,
    every: 15,
  },
  { name: "주사위", focus: null, patch: "dice", upBias: 1.5, gamble: true, rift: true, every: 15 },
  { name: "탐욕", focus: null, patch: "greed", upBias: 1.5, gamble: true, rift: true, every: 15 },
  { name: "분열", focus: null, patch: "split", upBias: 1.5, gamble: true, rift: true, every: 15 },
  {
    name: "소환만",
    focus: null,
    patch: "union",
    upBias: 0.6,
    gamble: false,
    rift: false,
    every: 15,
  },
];
export const botByName = (n: string) => BOTS.find((b) => b.name === n) ?? BOTS[0];

/** 세력별 대략적인 DPS (강화 고를 때) */
function factionDps(b: Board): Record<Faction, number> {
  const out = { knight: 0, mech: 0, arcane: 0, hidden: 0 };
  for (const c of b.cells) {
    if (!c.def) continue;
    const d = UNIT[c.def];
    const v =
      d.dmg *
      d.aps *
      c.units.length *
      (d.splash ? 1 + d.splash.pct : 1) *
      (d.chain ? 1 + d.chain.n * 0.5 : 1);
    out[d.faction] += v;
  }
  return out;
}

/**
 * 치트 코드 점수 (봇이 고를 때) — 등급이 높을수록, 내 길(주력 세력 · 패치)에 맞을수록.
 * 사람처럼 "그럭저럭 맞는 것"을 고르는 정도 (완벽한 계산 X)
 */
function cheatScore(b: Board, cfg: BotCfg, c: CheatDef): number {
  let v = 100 + c.tier * 100;
  const dps = factionDps(b);
  const main = cfg.focus ?? (Object.entries(dps).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0] as Faction);
  if (c.faction) v += c.faction === main ? 60 : -150;
  if (c.id === "c_mono") v += cfg.focus ? 80 : -120;
  if (c.id === "c_tri") v += cfg.focus ? -150 : 20;
  if (c.cat === "dmg" && !c.faction) v += 30;
  if (c.id === "c_compound" || c.id === "c_salary" || c.id === "c_infinite") v += cfg.patch === "interest" ? 60 : 0;
  if (c.id === "c_dice" || c.id === "c_pouch") v += cfg.patch === "gambler" ? 70 : -30;
  if (c.id === "c_mono") v += cfg.patch === "pure" ? 60 : 0;
  return v;
}

/** 이번 생각 차례에 할 명령 하나 (없으면 null) */
export function botMove(b: Board, cfg: BotCfg, skip: ReadonlySet<string> = new Set()): Cmd | null {
  if (b.result) return null;
  const ok = (c: Cmd) => (skip.has(c.t) ? null : c);
  if (b.cheat?.kind === "patch") {
    const i = b.cheat.offer.indexOf(cfg.patch);
    return { t: "cheat", i: Math.max(0, i) };
  }
  if (b.cheat) {
    const sc = b.cheat.offer.map((id) => cheatScore(b, cfg, CHEAT[id]));
    const best = sc.indexOf(Math.max(...sc));
    // 가장 낮은 카드가 기본 등급이고 다시 뽑기가 남았으면 그 카드를 바꿔 봄
    const low = sc.indexOf(Math.min(...sc));
    if (!skip.has("reroll") && b.cheat.rr[low] > 0 && CHEAT[b.cheat.offer[low]].tier === 0 && low !== best)
      return { t: "reroll", i: low };
    return { t: "cheat", i: best };
  }
  // 글리치 원정 캠프
  if (b.exp?.camp && !skip.has("exp")) {
    const x = b.exp,
      c = b.exp.camp;
    const low = x.hp < x.max * 0.5;
    switch (c.k) {
      case "squad": {
        const i = c.opts.indexOf(cfg.focus ?? "");
        return { t: "exp", a: Math.max(0, i) };
      }
      case "map": {
        let best = expNext(b)[0],
          bv = -Infinity;
        for (const j of expNext(b)) {
          const n = x.map[x.f + 1][j];
          const v =
            n.kind === "rest" ? (low ? 60 : 5) : n.kind === "elite" ? (x.hp > x.max * 0.6 ? 25 : -40) : n.kind === "shop" ? (b.gold > 250 ? 30 : 0) : n.kind === "treasure" ? 40 : n.kind === "event" ? 12 : 10;
          if (v > bv) (bv = v), (best = j);
        }
        return { t: "exp", a: best };
      }
      case "draft": {
        const dps = factionDps(b);
        const main = cfg.focus ?? (Object.entries(dps).sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))[0][0] as Faction);
        // 빈 칸이 없으면 같은 유닛 칸에 얹을 수 있는 카드만 (없으면 건너뛰기)
        const fits = (id: string) => hasEmpty(b) || b.cells.some((s) => s.def === id && s.units.length < STACK);
        if (!c.offer.some(fits)) return { t: "exp", a: -1 };
        const mi = c.offer.findIndex((id) => UNIT[id].faction === main && fits(id));
        return { t: "exp", a: mi >= 0 ? mi : c.offer.findIndex(fits) };
      }
      case "relic": {
        const pref = ["growth", "echo", "phoenix", "alch", "first", "iron", "hunter", "vamp", "piggy", "twin", "bag", "kit", "goldhand", `oath_${cfg.focus ?? "x"}`];
        for (const id of pref) {
          const i = c.offer.indexOf(id);
          if (i >= 0) return { t: "exp", a: i };
        }
        return { t: "exp", a: Math.max(0, c.offer.findIndex((id) => id !== "blood" && !id.startsWith("oath_"))) };
      }
      case "shop": {
        const want = (k: string) => {
          const i = c.items.findIndex((it) => it.kind === k && !it.sold);
          return i >= 0 && b.gold >= c.items[i].cost ? i : -1;
        };
        let i = x.hp < x.max * 0.6 ? want("heal") : -1;
        if (i < 0 && x.curses.length) i = want("uncurse");
        if (i < 0 && hasEmpty(b)) i = want("legend");
        if (i < 0 && hasEmpty(b) && b.gold > 260) i = want("epic");
        if (i < 0 && b.gold > 350) i = want("relic");
        return { t: "exp", a: i };
      }
      case "rest":
        return { t: "exp", a: x.hp < x.max * 0.7 ? 0 : 1 };
      case "act":
        // 1막 보스를 잡음: 체력이 절반 넘게 남았으면 2막
        return { t: "exp", a: x.hp >= x.max * 0.5 ? 1 : 0 };
      case "event": {
        const a =
          c.id === "vend" ? (b.gold >= 60 && hasEmpty(b) ? 0 : 1) : c.id === "merc" ? (hasEmpty(b) ? 0 : 1) : c.id === "spring" ? (x.hp > 16 ? 0 : 1) : c.id === "trap" ? (x.hp > 12 ? 0 : 1) : 1;
        return { t: "exp", a };
      }
    }
  }
  // 보스 2페이즈 예고: 표시된 칸의 유닛을 빈 칸 · 약한 칸으로 피함 (사람이 끌어서 하는 것과 같은 swap)
  // 심연 변이 「봉인」: 봉인된 칸의 유닛도 같은 식으로 빼냄
  if ((b.tele && b.tele.t > 3) || b.sealed.some((i) => b.cells[i].def)) {
    const c = dodge(b, b.tele && b.tele.t > 3 ? b.tele.cells : b.sealed);
    if (c) {
      const d = ok(c);
      if (d) return d;
    }
  }
  if (!b.patch && PATCHES.some((p) => p.id === cfg.patch)) {
    const c = ok({ t: "patch", id: cfg.patch });
    if (c) return c;
  }
  // 골라 뽑기: 주력 세력에서 공격력 가장 센 것
  if (b.tickets.length) {
    const g = b.tickets[0] as Grade;
    const fs = cfg.focus ? [cfg.focus] : FACTIONS;
    const opts = fs.flatMap((f) => poolOf(f, g));
    const best = opts.sort((x, y) => y.dmg * y.aps - x.dmg * x.aps || x.id.localeCompare(y.id))[0];
    if (best) {
      const c = ok({ t: "pick", id: best.id });
      if (c) return c;
    }
  }
  // 조합식 (신화 · 히든) — 단일 코어면 길들인 글리치(약한 히든)로 한 종류를 정하지 않음
  for (const r of RECIPES)
    if (canRecipe(b, r.id)) {
      const c = ok({ t: "recipe", id: r.id });
      if (c) return c;
    }
  // 순혈 프로토콜: 비율(70%)을 맞추려고 필드의 다른 세력은 보관함으로, 자리가 없으면 팖
  //  에픽 이하는 늘 · 레전드는 프로토콜이 꺼져 있을 때만 (신화 이상은 그대로). 다른 세력 조합식 재료도 안 남김
  if (cfg.patch === "pure" && cfg.focus) {
    let j = -1;
    for (let k = CELLS; k < SLOTS; k++)
      if (usable(b, k) && !b.cells[k].def) {
        j = k;
        break;
      }
    for (let i = 0; i < CELLS; i++) {
      const d = b.cells[i].def ? UNIT[b.cells[i].def!] : null;
      if (!d || d.faction === cfg.focus || d.faction === "hidden" || d.grade > (b.pure > 0 ? 2 : 3)) continue;
      const c = ok(j >= 0 ? { t: "swap", a: i, b: j } : { t: "sell", c: i });
      if (c) return c;
    }
  }
  // 보관함 정리: 같은 유닛이 있는 칸으로 모으기 → 필드 빈 칸으로 올리기 → 필드의 약한 낱개와 바꾸기
  const mv = benchMove(b, cfg.patch === "pure" ? cfg.focus : null);
  if (mv) {
    const c = ok(mv);
    if (c) return c;
  }
  // 합성
  for (let i = 0; i < SLOTS; i++) {
    const c = b.cells[i];
    if (c.def && c.units.length >= STACK && UNIT[c.def].grade < 3) {
      const c = ok({ t: "merge", c: i });
      if (c) return c;
    }
  }
  if (
    cfg.rift &&
    b.riftCd === 0 &&
    !b.enemies.some((e) => e.rift) &&
    b.wave >= B.rift.from &&
    b.enemies.length < 40
  ) {
    const tier = b.wave >= 40 ? "A" : b.wave >= 20 ? "B" : "C";
    {
      const c = ok({ t: "rift", tier });
      if (c) return c;
    }
  }
  if (cfg.gamble && b.stones >= B.gamble.E.cost && hasEmpty(b)) {
    const c = ok({ t: "gamble", g: "E" });
    if (c) return c;
  }

  const dps = factionDps(b);
  const main =
    cfg.focus ??
    (Object.entries(dps).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0] as Faction);
  const sc = summonCost(b);
  const uc = upCost(b, main);
  // 이자 째기: 필드가 안전하면 keep 만큼은 남겨 둠
  const keep = cfg.keep && b.enemies.length < 45 && b.phase !== "boss" ? cfg.keep : 0;
  const gold = Math.max(0, b.gold - keep);
  if (b.up[main] < B.up.max && uc <= gold && uc <= sc * cfg.upBias) {
    const c = ok({ t: "up", k: main });
    if (c) return c;
  }
  if (b.wave >= 6 && luckCost(b) <= gold * 0.6) {
    const c = ok({ t: "luck" });
    if (c) return c;
  }
  if (hasEmpty(b) && (gold >= sc || b.free > 0)) {
    const c = ok({ t: "summon" });
    if (c) return c;
  }
  // 칸이 꽉 찼으면: 주력이 아닌 낮은 등급 낱개부터 판매 (조합식 재료는 남김)
  if (!hasEmpty(b)) {
    let sell = -1,
      worst = Infinity;
    for (let i = 0; i < SLOTS; i++) {
      const c = b.cells[i];
      if (!c.def) continue;
      const d = UNIT[c.def];
      // 팔 수 있는 건 다 팔 수 있지만 봇은 에픽까지만 (재료 · 주력은 아낌)
      if (d.grade > 2) continue;
      const v =
        d.grade * 10 + c.units.length + (d.faction === main ? 5 : 0) + (MATERIAL.has(d.id) ? 20 : 0);
      if (v < worst) {
        worst = v;
        sell = i;
      }
    }
    if (sell >= 0 && gold >= sc) {
      const c = ok({ t: "sell", c: sell });
      if (c) return c;
    }
  }
  // 남는 돈은 강화
  if (b.up[main] < B.up.max && uc <= gold) {
    const c = ok({ t: "up", k: main });
    if (c) return c;
  }
  const others = FACTIONS.filter(
    (f) => f !== main && dps[f] > 0 && b.up[f] < B.up.max && upCost(b, f) <= gold * 0.5
  );
  if (others.length) {
    const c = ok({ t: "up", k: others[0] });
    if (c) return c;
  }
  // 할 거 다 했고 필드가 비었으면 다음 웨이브 부르기 (보스 웨이브 앞은 안 부름 — 사람도 보스 전엔 정비)
  if (b.phase === "wave" && b.enemies.length === 0 && (b.wave + 1) % BOSS_EVERY !== 0 && !nextBlock(b)) {
    const c = ok({ t: "next" });
    if (c) return c;
  }
  return null;
}

/** 칸 세기 (sim.ts cellPower 와 같은 어림) */
const powerOf = (b: Board, i: number) => {
  const c = b.cells[i];
  if (!c.def) return 0;
  const d = UNIT[c.def];
  return d.dmg * d.aps * c.units.length * (d.grade + 1);
};
/** 예고된 칸에서 가장 센 유닛을 표시 밖 빈 칸(없으면 더 약한 칸)으로 옮기는 명령 하나 */
function dodge(b: Board, cells: number[]): Cmd | null {
  const hit = new Set(cells);
  const from = [...hit].filter((i) => b.cells[i].def).sort((x, y) => powerOf(b, y) - powerOf(b, x) || x - y);
  for (const i of from) {
    const pi = powerOf(b, i);
    let j = -1,
      jv = Infinity;
    for (let k = 0; k < CELLS; k++) {
      if (hit.has(k) || !usable(b, k)) continue;
      const v = powerOf(b, k);
      if (v < jv && v < pi) {
        jv = v;
        j = k;
      }
    }
    if (j >= 0) return { t: "swap", a: i, b: j };
  }
  return null;
}

/** 유닛 가치 (자리 고를 때) */
const worth = (id: string, n: number) => {
  const d = UNIT[id];
  return (d.grade + 1) * 100 + n * 10 + d.dmg * d.aps * 0.01;
};

/** 보관함 → 필드 정리 명령 하나 (only: 이 세력 · 히든만 필드로 — 순혈) */
function benchMove(b: Board, only: Faction | null = null): Cmd | null {
  const fit = (id: string) => !only || UNIT[id].faction === only || UNIT[id].faction === "hidden";
  for (let j = CELLS; j < SLOTS; j++) {
    const bj = b.cells[j];
    if (!bj.def || !fit(bj.def)) continue;
    // 같은 유닛이 필드에 덜 찬 칸이 있으면 그리로 모음
    for (let i = 0; i < CELLS; i++)
      if (b.cells[i].def === bj.def && b.cells[i].units.length < STACK) return { t: "swap", a: j, b: i };
  }
  // 필드에 빈 칸이 있으면 보관함에서 가장 값진 것 올림
  const empty = b.cells.findIndex((c, i) => i < CELLS && !c.def);
  let best = -1,
    bv = -1;
  for (let j = CELLS; j < SLOTS; j++) {
    const c = b.cells[j];
    if (!c.def || !fit(c.def)) continue;
    const v = worth(c.def, c.units.length);
    if (v > bv) {
      bv = v;
      best = j;
    }
  }
  if (best < 0) return null;
  if (empty >= 0) return { t: "swap", a: best, b: empty };
  // 필드의 가장 약한 칸보다 보관함 것이 훨씬 세면 바꿈
  let weak = -1,
    wv = Infinity;
  for (let i = 0; i < CELLS; i++) {
    const c = b.cells[i];
    if (!c.def) continue;
    const v = worth(c.def, c.units.length);
    if (v < wv) {
      wv = v;
      weak = i;
    }
  }
  if (weak >= 0 && bv > wv + 100) return { t: "swap", a: best, b: weak };
  return null;
}

/** 봇 한 차례: 할 수 있는 동안 여러 번 (한 차례 최대 8개) — 실행한 명령을 돌려줌 */
export function botTurn(g: Game, p: number, cfg: BotCfg): Cmd[] {
  const b = g.boards[p];
  if (g.tick % cfg.every !== 0 && !b.cheat) return [];
  const done: Cmd[] = [];
  const skip = new Set<string>();
  for (let n = 0; n < 12; n++) {
    const c = botMove(b, cfg, skip);
    if (!c) break;
    // 못 하는 명령이면 그 종류는 이번 차례에 건너뛰고 다음 것 (자리 없음 등으로 멈추지 않게)
    if (apply(g, p, c)) skip.add(c.t);
    else done.push(c);
  }
  return done;
}
