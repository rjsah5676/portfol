/**
 * 밸런스용 자동 플레이어 — 사람이 할 법한 단순한 전략 몇 가지.
 * 시뮬 배치(scripts/defense-sim.ts) · 게임 안 개발자 창의 "자동 플레이"가 씀.
 * 같은 상태면 늘 같은 명령 (결정론) → 봇 판도 기록으로 다시 돌릴 수 있음.
 */
import { B } from "./balance";
import { PATCHES } from "./meta";
import {
  CELLS,
  STACK,
  apply,
  canRecipe,
  hasEmpty,
  luckCost,
  summonCost,
  upCost,
  type Board,
  type Cmd,
  type Game,
} from "./sim";
import { FACTIONS, RECIPES, UNIT, poolOf, type Faction, type Grade } from "./units";

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
    name: "도박사",
    focus: null,
    patch: "gambler",
    upBias: 1.5,
    gamble: true,
    rift: true,
    every: 15,
  },
  {
    name: "단일코어",
    focus: null,
    patch: "core",
    upBias: 1.5,
    gamble: true,
    rift: true,
    every: 15,
  },
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
function factionDps(b: Board): Record<Exclude<Faction, "hidden">, number> {
  const out = { knight: 0, mech: 0, arcane: 0 };
  for (const c of b.cells) {
    if (!c.def) continue;
    const d = UNIT[c.def];
    const v =
      d.dmg *
      d.aps *
      c.units.length *
      (d.splash ? 1 + d.splash.pct : 1) *
      (d.chain ? 1 + d.chain.n * 0.5 : 1);
    if (d.faction === "hidden") for (const f of FACTIONS) out[f] += v / 3;
    else out[d.faction] += v;
  }
  return out;
}

/** 이번 생각 차례에 할 명령 하나 (없으면 null) */
export function botMove(b: Board, cfg: BotCfg, skip: ReadonlySet<string> = new Set()): Cmd | null {
  if (b.result) return null;
  const ok = (c: Cmd) => (skip.has(c.t) ? null : c);
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
  // 조합식 (신화 · 히든)
  for (const r of RECIPES)
    if (canRecipe(b, r.id)) {
      const c = ok({ t: "recipe", id: r.id });
      if (c) return c;
    }
  // 합성
  for (let i = 0; i < CELLS; i++) {
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
    (Object.entries(dps).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0] as "knight");
  const sc = summonCost(b);
  const uc = upCost(b, main);
  if (b.up[main] < B.up.max && uc <= b.gold && uc <= sc * cfg.upBias) {
    const c = ok({ t: "up", k: main });
    if (c) return c;
  }
  if (b.wave >= 6 && luckCost(b) <= b.gold * 0.6) {
    const c = ok({ t: "luck" });
    if (c) return c;
  }
  if (hasEmpty(b) && (b.gold >= sc || b.free > 0)) {
    const c = ok({ t: "summon" });
    if (c) return c;
  }
  // 칸이 꽉 찼으면: 주력이 아닌 낮은 등급 낱개부터 판매
  if (!hasEmpty(b)) {
    let sell = -1,
      worst = Infinity;
    for (let i = 0; i < CELLS; i++) {
      const c = b.cells[i];
      if (!c.def) continue;
      const d = UNIT[c.def];
      if (d.grade > 1) continue;
      const v = d.grade * 10 + c.units.length + (d.faction === main ? 5 : 0);
      if (v < worst) {
        worst = v;
        sell = i;
      }
    }
    if (sell >= 0 && b.gold >= sc) {
      const c = ok({ t: "sell", c: sell });
      if (c) return c;
    }
  }
  // 남는 돈은 강화
  if (b.up[main] < B.up.max && uc <= b.gold) {
    const c = ok({ t: "up", k: main });
    if (c) return c;
  }
  const others = FACTIONS.filter(
    (f) => f !== main && dps[f] > 0 && b.up[f] < B.up.max && upCost(b, f) <= b.gold * 0.5
  );
  if (others.length) {
    const c = ok({ t: "up", k: others[0] });
    if (c) return c;
  }
  return null;
}

/** 봇 한 차례: 할 수 있는 동안 여러 번 (한 차례 최대 8개) — 실행한 명령을 돌려줌 */
export function botTurn(g: Game, p: number, cfg: BotCfg): Cmd[] {
  const b = g.boards[p];
  if (g.tick % cfg.every !== 0) return [];
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
