/**
 * 픽셀 글리치 디펜스 시뮬레이션 (결정론).
 *
 * 같은 시드 + 같은 명령 기록 → 브라우저 · 서버 · 시뮬레이터 어디서 돌려도 결과가 똑같음.
 *  - 랭킹: 서버가 명령 기록을 다시 돌려(replay.ts) 결과를 직접 계산 → 점수를 꾸며 보낼 수 없음
 *  - 멀티: 서버가 명령만 모아 뿌리고(락스텝) 각자 같은 시뮬을 돌림
 *  - 밸런스: 봇(bot.ts)으로 수천 판을 빠르게 돌림
 * 그래서 여기서는: Math.random · Date · Math.pow/sin/exp 같은 엔진마다 끝자리가 다를 수 있는 함수를 안 씀
 * (+ - × ÷ · sqrt · 비교만), 배열 순서도 늘 같은 순서로.
 *
 * Game = 보드(플레이어) 여러 개. 지금은 보드끼리 서로 영향이 없음 (각자 웨이브 · 각자 적).
 * 나중에 "남 돕기"를 넣을 땐 명령에 다른 보드를 가리키는 것(예: gift { to, c })만 추가하면 같은 step 안에서 처리됨.
 *
 * 필드: 8 × 5 칸. 가운데 6 × 3 = 18칸에 유닛, 둘레 사각 길(한 바퀴 22칸)을 적이 시계 방향으로 계속 돔.
 * 한 칸엔 같은 유닛 3기까지 (3기가 되면 합성).
 */
import { B, BOSS_EVERY, CAP, LAST_WAVE, TPS, countOf, hpOf, sec } from "./balance";
import { BOSSES, KIND, bossOfWave, kindOfWave, type BossDef, type Size } from "./enemies";
import { MISSIONS, PATCH_DEADLINE, PATCHES } from "./meta";
import { mixSeed, pick, rnd, rndInt, type Rng } from "./rng";
import {
  FACTIONS,
  RECIPE,
  SIZE_MULT,
  UNIT,
  poolOf,
  type Faction,
  type Grade,
  type UnitDef,
} from "./units";

export const COLS = 6;
export const ROWS = 3;
export const CELLS = COLS * ROWS;
export const FIELD_W = 8;
export const FIELD_H = 5;
export const PERIM = 22;
export const STACK = 3;

/** 길 위 거리 → 좌표 (왼쪽 위에서 시작, 시계 방향) */
export function pathPos(d: number): [number, number] {
  if (d < 7) return [0.5 + d, 0.5];
  if (d < 11) return [7.5, 0.5 + (d - 7)];
  if (d < 18) return [7.5 - (d - 11), 4.5];
  return [0.5, 4.5 - (d - 18)];
}
export const cellX = (i: number) => 1.5 + (i % COLS);
export const cellY = (i: number) => 1.5 + Math.floor(i / COLS);

export interface Unit {
  /** 다음 공격까지 (tick, 공속 버프만큼 빨리 줄어듦) */
  cd: number;
  /** 궁극기 충전 (공격 수) */
  ult: number;
  /** 기절 (tick) */
  stun: number;
}
export interface Cell {
  def: string | null;
  units: Unit[];
}

export interface Enemy {
  id: number;
  kind: string;
  /** BOSSES 번호 (-1 = 보스 아님) */
  boss: number;
  /** 글리치 균열 등급 0 없음 · 1 C · 2 B · 3 A */
  rift: number;
  elite: boolean;
  hp: number;
  max: number;
  armor: number;
  mres: number;
  pres: number;
  size: Size;
  /** 기본 속도 (칸/tick) */
  spd: number;
  /** 길 위 위치 (0 ~ PERIM) · 지금까지 간 거리 */
  d: number;
  trav: number;
  x: number;
  y: number;
  stun: number;
  slowP: number;
  slowT: number;
  /** 이번 tick 범위 효과 (매 tick 다시 계산) */
  aSlow: number;
  shred: number;
  shield: number;
  evade: number;
  dash: number;
  dashMult: number;
  /** 보스 기술별 쿨 (tick) */
  sk: number[];
  /** 균열: 사라질 때까지 (tick) */
  expire: number;
  /** 마지막으로 때린 유닛 (처치 효과) */
  last: string;
}

export type Cmd =
  | { t: "summon" }
  | { t: "merge"; c: number }
  | { t: "sell"; c: number }
  | { t: "swap"; a: number; b: number }
  | { t: "up"; k: "knight" | "mech" | "arcane" }
  | { t: "luck" }
  | { t: "gamble"; g: "E" | "L" }
  | { t: "recipe"; id: string }
  | { t: "patch"; id: string }
  | { t: "rift"; tier: "C" | "B" | "A" }
  | { t: "pick"; id: string };

/** 화면 효과 (시뮬 결과에 영향 없음 — fx 가 null 이면 안 쌓음) */
export type Fx =
  | { k: "shot"; c: number; x: number; y: number; def: string; crit: boolean }
  | { k: "aoe"; x: number; y: number; r: number; def: string }
  | { k: "chain"; x1: number; y1: number; x2: number; y2: number; def: string }
  | { k: "ult"; c: number; def: string; name: string }
  | { k: "die"; x: number; y: number; kind: string; boss: boolean; gold: number }
  | { k: "miss"; x: number; y: number }
  | { k: "whip"; c: number }
  | { k: "heal"; x: number; y: number };

/** 화면 알림 (토스트 · 획득 연출) */
export type Ev =
  | { t: "unit"; def: string; how: "summon" | "merge" | "gamble" | "recipe" | "pick" }
  | { t: "gambleFail"; g: "E" | "L"; refund: boolean }
  | { t: "boss"; boss: number }
  | { t: "bossDown"; boss: number; gold: number; stones: number; ticket: number | null }
  | { t: "wave"; wave: number }
  | { t: "mission"; id: string }
  | { t: "rift"; tier: number; ok: boolean }
  | { t: "patch"; id: string; auto: boolean }
  | { t: "over"; win: boolean };

export type Phase = "prep" | "wave" | "boss" | "break" | "over";

export interface Result {
  win: boolean;
  /** 도달한 웨이브 (클리어면 LAST_WAVE) */
  wave: number;
  tick: number;
  kills: number;
  reason: "clear" | "cap" | "boss";
}

export interface Board {
  idx: number;
  rng: Rng;
  phase: Phase;
  wave: number;
  /** 이번 웨이브에서 지난 tick (prep 은 음수부터) */
  wt: number;
  spawned: number;
  bossT: number;
  cells: Cell[];
  enemies: Enemy[];
  nextId: number;
  gold: number;
  stones: number;
  summons: number;
  free: number;
  up: { knight: number; mech: number; arcane: number };
  luck: number;
  patch: string | null;
  tickets: number[];
  riftCd: number;
  rifts: number;
  missions: string[];
  sold: number;
  failStreak: number;
  /** 이 판에서 얻은 유닛 수 (id → 수) */
  made: Record<string, number>;
  kills: number;
  /** 유닛 종류별 넣은 피해 (DPS 측정 · 밸런스 통계) */
  dealt: Record<string, number>;
  result: Result | null;
  /** 칸별 공속 버프 (배치가 바뀌면 다시 계산) */
  aspd: number[];
  dirty: boolean;
  /** 범위 효과(둔화 · 방어 깎기)를 가진 유닛 종류 → 그 칸들 */
  auras: { def: UnitDef; cells: number[] }[];
  fx: Fx[] | null;
  ev: Ev[] | null;
}

export interface Game {
  seed: number;
  tick: number;
  boards: Board[];
  over: boolean;
}

/* ───────────────────────── 만들기 ───────────────────────── */

export function newBoard(seed: number, idx: number): Board {
  return {
    idx,
    // 보드마다 같은 시드 → 멀티에서 모두 같은 운으로 시작 (나뉘는 건 각자 고른 것 때문)
    rng: { r: mixSeed(seed, 0) },
    phase: "prep",
    wave: 0,
    wt: -sec(B.prepSec),
    spawned: 0,
    bossT: 0,
    cells: Array.from({ length: CELLS }, () => ({ def: null, units: [] })),
    enemies: [],
    nextId: 1,
    gold: B.startGold,
    stones: 0,
    summons: 0,
    free: 0,
    up: { knight: 0, mech: 0, arcane: 0 },
    luck: 0,
    patch: null,
    tickets: [],
    riftCd: 0,
    rifts: 0,
    missions: [],
    sold: 0,
    failStreak: 0,
    made: {},
    kills: 0,
    dealt: {},
    result: null,
    aspd: new Array(CELLS).fill(0),
    dirty: true,
    auras: [],
    fx: null,
    ev: null,
  };
}

export function newGame(seed: number, players = 1): Game {
  return {
    seed: seed >>> 0,
    tick: 0,
    boards: Array.from({ length: players }, (_, i) => newBoard(seed >>> 0, i)),
    over: false,
  };
}

/* ───────────────────────── 조회 (UI · 봇 공용) ───────────────────────── */

export const summonCost = (b: Board) =>
  Math.min(B.summon.max, B.summon.base + B.summon.step * b.summons);
export const upCost = (b: Board, k: "knight" | "mech" | "arcane") =>
  B.up[k].base + B.up[k].step * b.up[k];
export const luckCost = (b: Board) => (b.luck < B.luckCost.length ? B.luckCost[b.luck] : Infinity);
export const unitCount = (b: Board) => b.cells.reduce((n, c) => n + c.units.length, 0);
export const hasEmpty = (b: Board) => b.cells.some((c) => !c.def);
/** 보드에 있는 유닛 수 (id → 수) */
export function counts(b: Board): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of b.cells) if (c.def) m[c.def] = (m[c.def] ?? 0) + c.units.length;
  return m;
}
/** 지금 만들 수 있는 조합식인지 */
export function canRecipe(b: Board, id: string): boolean {
  const r = RECIPE[id];
  if (!r) return false;
  if (b.patch === "core" && mythCount(b) >= 1) return false;
  const have = counts(b);
  const need: Record<string, number> = {};
  for (const n of r.needs) need[n] = (need[n] ?? 0) + 1;
  return Object.entries(need).every(([k, v]) => (have[k] ?? 0) >= v);
}
export const mythCount = (b: Board) =>
  b.cells.reduce((n, c) => n + (c.def && UNIT[c.def].grade >= 4 ? c.units.length : 0), 0);
/** 세력 강화 배수 (히든은 세 세력 평균) */
export function upMult(b: Board, f: Faction): number {
  const lv = f === "hidden" ? (b.up.knight + b.up.mech + b.up.arcane) / 3 : b.up[f];
  return 1 + B.up.perLv * lv;
}

/* ───────────────────────── 명령 ───────────────────────── */

/** 명령이 맞는 모양인지 (서버가 받을 때 · 기록을 다시 돌릴 때) */
export function isCmd(x: unknown): x is Cmd {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  const cell = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < CELLS;
  const keys = Object.keys(c).length;
  switch (c.t) {
    case "summon":
    case "luck":
      return keys === 1;
    case "merge":
    case "sell":
      return keys === 2 && cell(c.c);
    case "swap":
      return keys === 3 && cell(c.a) && cell(c.b);
    case "up":
      return keys === 2 && (c.k === "knight" || c.k === "mech" || c.k === "arcane");
    case "gamble":
      return keys === 2 && (c.g === "E" || c.g === "L");
    case "recipe":
    case "pick":
      return keys === 2 && typeof c.id === "string" && !!UNIT[c.id];
    case "patch":
      return keys === 2 && typeof c.id === "string" && PATCHES.some((p) => p.id === c.id);
    case "rift":
      return keys === 2 && (c.tier === "C" || c.tier === "B" || c.tier === "A");
  }
  return false;
}

/** 명령 실행. 못 하는 명령이면 이유(문자열)를 돌려주고 아무것도 안 바꿈 */
export function apply(g: Game, p: number, cmd: Cmd): string | null {
  const b = g.boards[p];
  if (!b || b.result) return "끝난 판이에요";
  switch (cmd.t) {
    case "summon": {
      if (!hasEmpty(b)) return "빈 칸이 없어요";
      const free = b.free > 0;
      const cost = summonCost(b);
      if (!free && b.gold < cost) return "골드가 모자라요";
      if (free) b.free--;
      else {
        b.gold -= cost;
        b.summons++;
      }
      const odds = B.odds[b.luck];
      const r = rnd(b.rng) * 100;
      let grade = 0,
        acc = 0;
      for (let i = 0; i < odds.length; i++) {
        acc += odds[i];
        if (r < acc) {
          grade = i;
          break;
        }
      }
      const def = pick(b.rng, poolOf(pick(b.rng, FACTIONS), grade as Grade));
      give(b, def.id, "summon");
      return null;
    }
    case "merge": {
      const c = b.cells[cmd.c];
      if (!c.def || c.units.length < STACK) return "같은 유닛 3기가 모여야 해요";
      const d = UNIT[c.def];
      if (d.grade >= 3) return "레전드부터는 조합식으로 올려요";
      c.def = null;
      c.units = [];
      b.dirty = true;
      const next = pick(b.rng, poolOf(d.faction, (d.grade + 1) as Grade));
      give(b, next.id, "merge", cmd.c);
      return null;
    }
    case "sell": {
      const c = b.cells[cmd.c];
      if (!c.def) return "빈 칸이에요";
      const d = UNIT[c.def];
      if (d.grade > 2) return "레전드부터는 팔 수 없어요";
      c.units.pop();
      if (!c.units.length) c.def = null;
      b.gold += B.sell[d.grade] ?? 0;
      b.sold++;
      b.dirty = true;
      return null;
    }
    case "swap": {
      if (cmd.a === cmd.b) return null;
      const A = b.cells[cmd.a],
        Bc = b.cells[cmd.b];
      // 같은 유닛이면 한 칸으로 모음 (3기까지)
      if (A.def && A.def === Bc.def) {
        while (A.units.length && Bc.units.length < STACK) Bc.units.push(A.units.pop()!);
        if (!A.units.length) A.def = null;
      } else {
        b.cells[cmd.a] = Bc;
        b.cells[cmd.b] = A;
      }
      b.dirty = true;
      return null;
    }
    case "up": {
      if (b.up[cmd.k] >= B.up.max) return "최대 강화예요";
      const cost = upCost(b, cmd.k);
      if (b.gold < cost) return "골드가 모자라요";
      b.gold -= cost;
      b.up[cmd.k]++;
      return null;
    }
    case "luck": {
      const cost = luckCost(b);
      if (!Number.isFinite(cost)) return "최대 강화예요";
      if (b.gold < cost) return "골드가 모자라요";
      b.gold -= cost;
      b.luck++;
      return null;
    }
    case "gamble": {
      const gm = B.gamble[cmd.g];
      if (b.stones < gm.cost) return "행운석이 모자라요";
      if (!hasEmpty(b)) return "빈 칸이 없어요";
      b.stones -= gm.cost;
      const p = gm.p + (b.patch === "gambler" ? 0.08 : 0);
      if (rnd(b.rng) < p) {
        b.failStreak = 0;
        const def = pick(b.rng, poolOf(pick(b.rng, FACTIONS), cmd.g === "E" ? 2 : 3));
        give(b, def.id, "gamble");
      } else {
        b.failStreak++;
        const refund = b.patch === "gambler" && cmd.g === "L";
        if (refund) b.stones++;
        b.ev?.push({ t: "gambleFail", g: cmd.g, refund });
      }
      return null;
    }
    case "recipe": {
      const r = RECIPE[cmd.id];
      if (!r) return "없는 조합식이에요";
      if (b.patch === "core" && mythCount(b) >= 1) return "단일 코어: 신화 · 히든은 1개만";
      if (!canRecipe(b, cmd.id)) return "재료가 모자라요";
      // 재료가 여러 칸에 있으면 적게 쌓인 칸부터 뺌
      for (const n of r.needs) {
        let best = -1;
        for (let i = 0; i < CELLS; i++)
          if (
            b.cells[i].def === n &&
            (best < 0 || b.cells[i].units.length < b.cells[best].units.length)
          )
            best = i;
        const c = b.cells[best];
        c.units.pop();
        if (!c.units.length) c.def = null;
      }
      b.dirty = true;
      give(b, r.id, "recipe");
      return null;
    }
    case "patch": {
      if (b.patch) return "패치는 한 번만 고를 수 있어요";
      if (b.wave >= PATCH_DEADLINE) return "패치는 10웨이브 전까지만";
      b.patch = cmd.id;
      b.ev?.push({ t: "patch", id: cmd.id, auto: false });
      return null;
    }
    case "rift": {
      if (b.wave < B.rift.from) return `${B.rift.from}웨이브부터 열 수 있어요`;
      if (b.riftCd > 0) return "균열이 아직 닫혀 있어요";
      if (b.enemies.some((e) => e.rift)) return "이미 열린 균열이 있어요";
      const tier = cmd.tier === "C" ? 1 : cmd.tier === "B" ? 2 : 3;
      const kind = KIND[kindOfWave(Math.max(1, b.wave))];
      const e = spawn(b, kind.id, hpOf(b.wave) * B.rift[cmd.tier].hp);
      e.rift = tier;
      e.size = 1;
      e.expire = sec(B.rift.sec);
      b.riftCd = sec(B.rift.cd);
      return null;
    }
    case "pick": {
      if (!b.tickets.length) return "골라 뽑기권이 없어요";
      const d = UNIT[cmd.id];
      if (d.grade !== b.tickets[0] || d.faction === "hidden") return "그 등급이 아니에요";
      if (!hasEmpty(b) && !b.cells.some((c) => c.def === d.id && c.units.length < STACK))
        return "빈 칸이 없어요";
      b.tickets.shift();
      give(b, d.id, "pick");
      return null;
    }
  }
  return "모르는 명령";
}

/** 유닛 하나를 보드에 놓음: 같은 유닛이 덜 찬 칸 → 빈 칸(prefer 우선) 순 */
function give(
  b: Board,
  id: string,
  how: "summon" | "merge" | "gamble" | "recipe" | "pick",
  prefer = -1
) {
  let at = -1;
  for (let i = 0; i < CELLS; i++)
    if (b.cells[i].def === id && b.cells[i].units.length < STACK) {
      at = i;
      break;
    }
  if (at < 0 && prefer >= 0 && !b.cells[prefer].def) at = prefer;
  if (at < 0) at = b.cells.findIndex((c) => !c.def);
  if (at < 0) return; // (부르는 쪽이 자리를 확인함)
  const c = b.cells[at];
  c.def = id;
  c.units.push({ cd: 0, ult: 0, stun: 0 });
  b.dirty = true;
  b.made[id] = (b.made[id] ?? 0) + 1;
  const d = UNIT[id];
  if (d.grade >= 3 && b.patch === "union") b.free += 2;
  b.ev?.push({ t: "unit", def: id, how });
}

/* ───────────────────────── 적 ───────────────────────── */

function spawn(b: Board, kindId: string, hp: number): Enemy {
  const k = KIND[kindId];
  const w = Math.max(1, b.wave);
  const e: Enemy = {
    id: b.nextId++,
    kind: kindId,
    boss: -1,
    rift: 0,
    elite: false,
    hp,
    max: hp,
    armor: Math.round(B.armorPerWave * w * k.armor),
    mres: k.mres,
    pres: 0,
    size: k.size,
    spd: (B.enemySpd * k.spd) / TPS,
    d: 0,
    trav: 0,
    x: 0.5,
    y: 0.5,
    stun: 0,
    slowP: 0,
    slowT: 0,
    aSlow: 0,
    shred: 0,
    shield: 0,
    evade: 0,
    dash: 0,
    dashMult: 1,
    sk: [],
    expire: 0,
    last: "",
  };
  b.enemies.push(e);
  return e;
}

function spawnBoss(b: Board, def: BossDef) {
  const w = b.wave;
  const e = spawn(b, "slime", hpOf(w) * B.bossHp * def.hp);
  e.kind = "boss";
  e.boss = BOSSES.indexOf(def);
  e.armor = Math.round(B.armorPerWave * w * def.armor);
  e.mres = def.mres;
  e.pres = def.pres;
  e.size = def.size;
  e.spd = (B.enemySpd * def.spd) / TPS;
  e.sk = def.skills.map((s) => sec(s.every));
  b.ev?.push({ t: "boss", boss: e.boss });
}

/* ───────────────────────── 진행 ───────────────────────── */

export function step(g: Game) {
  for (const b of g.boards) if (!b.result) stepBoard(g, b);
  g.tick++;
  g.over = g.boards.every((b) => b.result);
}

function finish(g: Game, b: Board, win: boolean, reason: Result["reason"]) {
  b.result = { win, wave: b.wave, tick: g.tick, kills: b.kills, reason };
  b.phase = "over";
  b.ev?.push({ t: "over", win });
}

function startWave(b: Board, w: number) {
  b.wave = w;
  b.wt = 0;
  b.spawned = 0;
  if (w >= PATCH_DEADLINE && !b.patch) {
    b.patch = "union";
    b.ev?.push({ t: "patch", id: "union", auto: true });
  }
  b.ev?.push({ t: "wave", wave: w });
  const boss = w % BOSS_EVERY === 0 ? bossOfWave(w) : null;
  if (boss) {
    b.phase = "boss";
    b.bossT = sec(B.bossSec);
    spawnBoss(b, boss);
  } else b.phase = "wave";
}

function endWave(b: Board) {
  b.gold += B.waveGold.base + B.waveGold.per * b.wave;
  if (b.patch === "interest") b.gold += Math.min(40, Math.floor(b.gold * 0.06));
}

const armorF = (a: number) => (a >= 0 ? 100 / (100 + a) : 2 - 100 / (100 - a));

function stepBoard(g: Game, b: Board) {
  // ── 웨이브 시계 ──
  const W = sec(B.waveSec),
    gap = sec(B.spawnGap);
  if (b.phase === "prep") {
    if (++b.wt >= 0) startWave(b, 1);
  } else if (b.phase === "wave") {
    const n = countOf(b.wave);
    if (b.spawned < n && b.wt % gap === 0) {
      const last = b.spawned === n - 1;
      const elite = last && b.wave % 5 === 0;
      const e = spawn(b, kindOfWave(b.wave), hpOf(b.wave) * (elite ? B.eliteHp : 1));
      if (elite) e.elite = true;
      b.spawned++;
    }
    if (++b.wt >= W) {
      endWave(b);
      startWave(b, b.wave + 1);
    }
  } else if (b.phase === "boss") {
    if (--b.bossT <= 0) return finish(g, b, false, "boss");
  } else if (b.phase === "break") {
    if (++b.wt >= sec(B.breakSec)) {
      endWave(b);
      startWave(b, b.wave + 1);
    }
  }
  if (b.riftCd > 0) b.riftCd--;

  // ── 배치가 바뀌었으면 범위 효과 다시 ──
  if (b.dirty) rebuild(b);

  // ── 적 위치 · 범위 효과 ──
  const es = b.enemies;
  for (const e of es) {
    const [x, y] = pathPos(e.d);
    e.x = x;
    e.y = y;
    e.aSlow = 0;
    e.shred = 0;
  }
  for (const a of b.auras) {
    const r2 = a.def.aura!.r * a.def.aura!.r;
    for (const e of es) {
      let inR = false;
      for (const ci of a.cells) {
        const dx = e.x - cellX(ci),
          dy = e.y - cellY(ci);
        if (dx * dx + dy * dy <= r2) {
          inR = true;
          break;
        }
      }
      if (!inR) continue;
      if (a.def.aura!.slow && a.def.aura!.slow > e.aSlow) e.aSlow = a.def.aura!.slow;
      if (a.def.aura!.shred) e.shred += a.def.aura!.shred;
    }
  }

  // ── 적 이동 · 보스 기술 ──
  const coreSlow = b.patch === "core" ? 0.92 : 1;
  for (const e of es) {
    if (e.evade > 0) e.evade--;
    if (e.expire > 0 && --e.expire === 0) {
      e.hp = 0;
      e.last = "~expire";
    }
    if (e.boss >= 0) bossTick(b, e);
    if (e.stun > 0) {
      e.stun--;
      continue;
    }
    const timed = e.slowT > 0 ? e.slowP : 0;
    if (e.slowT > 0) e.slowT--;
    let slow = 1 - (1 - e.aSlow) * (1 - timed);
    if (slow > B.slowCap) slow = B.slowCap;
    if (e.boss >= 0) slow *= B.bossCc;
    let v = e.spd * (1 - slow) * coreSlow;
    if (e.dash > 0) {
      e.dash--;
      v *= e.dashMult;
    }
    e.d += v;
    if (e.d >= PERIM) e.d -= PERIM;
    e.trav += v;
  }

  // ── 유닛 공격 ──
  for (let i = 0; i < CELLS; i++) {
    const c = b.cells[i];
    if (!c.def) continue;
    const def = UNIT[c.def];
    const sp = 1 + b.aspd[i];
    const period = TPS / def.aps;
    for (const u of c.units) {
      if (u.stun > 0) {
        u.stun--;
        continue;
      }
      u.cd -= sp;
      if (u.cd > 0) continue;
      const t = target(b, i, def.range);
      if (!t) {
        u.cd = 0;
        continue;
      }
      attack(b, i, def, u, t);
      u.cd += period;
    }
  }

  // ── 쓰러진 적 ──
  let alive = 0;
  for (const e of es) {
    if (e.hp > 0) {
      es[alive++] = e;
      continue;
    }
    if (die(g, b, e)) return;
  }
  es.length = alive;

  if (es.length >= CAP) return finish(g, b, false, "cap");
  if ((g.tick & 7) === 0) checkMissions(b);
}

function rebuild(b: Board) {
  b.dirty = false;
  b.aspd.fill(0);
  const by = new Map<string, number[]>();
  for (let i = 0; i < CELLS; i++) {
    const id = b.cells[i].def;
    if (!id) continue;
    const a = UNIT[id].aura;
    if (!a) continue;
    if (a.aspd) {
      // 공속 버프: 같은 종류는 안 겹치고 가장 센 것만
      const r2 = a.r * a.r;
      for (let j = 0; j < CELLS; j++) {
        if (!b.cells[j].def) continue;
        const dx = cellX(i) - cellX(j),
          dy = cellY(i) - cellY(j);
        if (dx * dx + dy * dy <= r2 && a.aspd > b.aspd[j]) b.aspd[j] = a.aspd;
      }
    }
    if (a.slow || a.shred) {
      const l = by.get(id);
      if (l) l.push(i);
      else by.set(id, [i]);
    }
  }
  b.auras = [...by.entries()].map(([id, cells]) => ({ def: UNIT[id], cells }));
}

/** 사거리 안의 보스 우선, 없으면 가장 많이 간(가장 위험한) 적 */
function target(b: Board, ci: number, range: number): Enemy | null {
  const cx = cellX(ci),
    cy = cellY(ci),
    r2 = range * range;
  let best: Enemy | null = null;
  for (const e of b.enemies) {
    if (e.hp <= 0) continue;
    const dx = e.x - cx,
      dy = e.y - cy;
    if (dx * dx + dy * dy > r2) continue;
    if (e.boss >= 0) return e;
    if (!best || e.trav > best.trav) best = e;
  }
  return best;
}

function hit(b: Board, def: UnitDef, e: Enemy, raw: number): number {
  if (e.hp <= 0) return 0;
  if (e.evade > 0) {
    b.fx?.push({ k: "miss", x: e.x, y: e.y });
    return 0;
  }
  let m = upMult(b, def.faction);
  if (b.patch === "core") m *= 1.15;
  if (e.boss >= 0 && def.boss) m *= def.boss;
  if (def.dtype === "phys") {
    const sz = SIZE_MULT[def.faction][e.size];
    m *=
      (e.boss >= 0 ? Math.max(B.bossSizeFloor, sz) : sz) * armorF(e.armor - e.shred) * (1 - e.pres);
  } else m *= 1 - e.mres;
  let dmg = raw * m;
  if (e.shield > 0) {
    const s = Math.min(e.shield, dmg);
    e.shield -= s;
    dmg -= s;
  }
  e.hp -= dmg;
  e.last = def.id;
  b.dealt[def.id] = (b.dealt[def.id] ?? 0) + dmg;
  return dmg;
}

function stun(e: Enemy, s: number) {
  const t = Math.round(sec(s) * (e.boss >= 0 ? B.bossCc : 1));
  if (t > e.stun) e.stun = t;
}

function around(
  b: Board,
  x: number,
  y: number,
  r: number,
  skip: Enemy | null,
  fn: (e: Enemy) => void
) {
  const r2 = r * r;
  for (const o of b.enemies) {
    if (o === skip || o.hp <= 0) continue;
    const dx = o.x - x,
      dy = o.y - y;
    if (dx * dx + dy * dy <= r2) fn(o);
  }
}

function attack(b: Board, ci: number, def: UnitDef, u: Unit, t: Enemy) {
  let dmg = def.dmg;
  let crit = false;
  if (def.crit && rnd(b.rng) < def.crit.chance) {
    dmg *= def.crit.mult;
    crit = true;
  }
  const tx = t.x,
    ty = t.y;
  b.fx?.push({ k: "shot", c: ci, x: tx, y: ty, def: def.id, crit });
  hit(b, def, t, dmg);
  if (def.splash) {
    const s = def.splash;
    around(b, tx, ty, s.r, t, (o) => hit(b, def, o, dmg * s.pct));
    b.fx?.push({ k: "aoe", x: tx, y: ty, r: s.r, def: def.id });
  }
  if (def.chain) {
    const done = new Set<Enemy>([t]);
    let cur = t,
      d = dmg;
    for (let k = 0; k < def.chain.n; k++) {
      let best: Enemy | null = null,
        bd = 1.6 * 1.6;
      for (const o of b.enemies) {
        if (o.hp <= 0 || done.has(o)) continue;
        const dx = o.x - cur.x,
          dy = o.y - cur.y,
          dd = dx * dx + dy * dy;
        if (dd < bd) {
          bd = dd;
          best = o;
        }
      }
      if (!best) break;
      d *= def.chain.pct;
      b.fx?.push({ k: "chain", x1: cur.x, y1: cur.y, x2: best.x, y2: best.y, def: def.id });
      hit(b, def, best, d);
      done.add(best);
      cur = best;
    }
  }
  if (def.procs)
    for (const p of def.procs) {
      if (p.chance < 1 && rnd(b.rng) >= p.chance) continue;
      if (p.kind === "stun") stun(t, p.sec);
      else if (p.kind === "slow") {
        if (p.pct >= t.slowP || t.slowT <= 0) {
          t.slowP = p.pct;
          t.slowT = sec(p.sec);
        }
      } else if (p.kind === "cur" && t.boss < 0 && t.hp > 0) hitRaw(b, def, t, t.hp * p.pct);
    }
  if (def.ult && ++u.ult >= def.ult.every) {
    u.ult = 0;
    ult(b, ci, def, t, tx, ty);
  }
}

/** 체력 비례 피해: 강화 · 상성 없이 마법 저항만 */
function hitRaw(b: Board, def: UnitDef, e: Enemy, raw: number) {
  if (e.evade > 0) return;
  const dmg = raw * (1 - e.mres);
  e.hp -= dmg;
  e.last = def.id;
  b.dealt[def.id] = (b.dealt[def.id] ?? 0) + dmg;
}

function ult(b: Board, ci: number, def: UnitDef, t: Enemy, tx: number, ty: number) {
  const U = def.ult!;
  b.fx?.push({ k: "ult", c: ci, def: def.id, name: U.name });
  if (U.kind === "nova") {
    const all = (o: Enemy) => {
      hit(b, def, o, def.dmg * U.mult);
      if (U.stun) stun(o, U.stun);
      if (U.cur && o.boss < 0 && o.hp > 0) hitRaw(b, def, o, o.hp * U.cur);
    };
    if (t.hp > 0) all(t);
    around(b, tx, ty, U.r, t, all);
    b.fx?.push({ k: "aoe", x: tx, y: ty, r: U.r, def: def.id });
  } else if (U.kind === "barrage") {
    const tops = b.enemies
      .filter((e) => e.hp > 0)
      .sort((a, c) => c.hp - a.hp || a.id - c.id)
      .slice(0, U.n);
    for (const e of tops) {
      hit(b, def, e, def.dmg * U.mult);
      b.fx?.push({ k: "aoe", x: e.x, y: e.y, r: 0.5, def: def.id });
    }
  } else if (U.kind === "delete") {
    let best: Enemy | null = null;
    for (const e of b.enemies)
      if (e.hp > 0 && e.boss < 0 && !e.rift && (!best || e.trav > best.trav)) best = e;
    const boss = b.enemies.find((e) => e.hp > 0 && e.boss >= 0);
    if (boss) hitRaw(b, def, boss, boss.max * U.pct);
    else if (best) {
      b.dealt[def.id] = (b.dealt[def.id] ?? 0) + best.hp;
      best.hp = 0;
      best.last = def.id;
      b.fx?.push({ k: "aoe", x: best.x, y: best.y, r: 0.4, def: def.id });
    }
  }
}

function bossTick(b: Board, e: Enemy) {
  const def = BOSSES[e.boss];
  def.skills.forEach((s, k) => {
    if (--e.sk[k] > 0) return;
    e.sk[k] = sec(s.every);
    switch (s.kind) {
      case "heal":
        e.hp = Math.min(e.max, e.hp + e.max * s.pct);
        b.fx?.push({ k: "heal", x: e.x, y: e.y });
        break;
      case "whip": {
        const filled: number[] = [];
        for (let i = 0; i < CELLS; i++) if (b.cells[i].def) filled.push(i);
        for (let n = 0; n < s.n && filled.length; n++) {
          const ci = filled.splice(rndInt(b.rng, filled.length), 1)[0];
          for (const u of b.cells[ci].units) u.stun = Math.max(u.stun, sec(s.sec));
          b.fx?.push({ k: "whip", c: ci });
        }
        break;
      }
      case "dash":
        e.dash = sec(s.sec);
        e.dashMult = s.mult;
        break;
      case "shield":
        e.shield += e.max * s.pct;
        break;
      case "summon":
        for (let n = 0; n < s.n; n++) {
          const m = spawn(b, "skull", hpOf(b.wave) * s.hp);
          m.d = e.d;
          m.trav = e.trav - 0.3 * (n + 1);
          [m.x, m.y] = pathPos(m.d);
        }
        break;
      case "evade":
        e.evade = sec(s.sec);
        break;
    }
  });
}

/** 처치 처리. 판이 끝나면 true */
function die(g: Game, b: Board, e: Enemy): boolean {
  if (e.last === "~expire") {
    b.ev?.push({ t: "rift", tier: e.rift, ok: false });
    return false;
  }
  b.kills++;
  let gold = 0;
  if (e.rift) {
    const R = e.rift === 1 ? B.rift.C : e.rift === 2 ? B.rift.B : B.rift.A;
    b.stones += R.stones;
    gold = R.gold;
    b.rifts++;
    b.ev?.push({ t: "rift", tier: e.rift, ok: true });
  } else if (e.boss >= 0) {
    gold = B.bossGold.base + B.bossGold.per * b.wave;
    const stones = B.bossStones + Math.floor(b.wave / 20);
    b.stones += stones;
    const tk = B.bossTicket[b.wave];
    if (tk !== undefined) b.tickets.push(tk);
    b.ev?.push({ t: "bossDown", boss: e.boss, gold, stones, ticket: tk ?? null });
    if (b.wave >= LAST_WAVE) {
      b.gold += gold;
      finish(g, b, true, "clear");
      return true;
    }
    b.phase = "break";
    b.wt = 0;
  } else {
    gold = B.killGold + Math.floor(b.wave / B.killGoldPer);
  }
  const k = UNIT[e.last]?.onKill;
  if (k) {
    if (k.gold && (k.goldChance === undefined || rnd(b.rng) < k.goldChance)) gold += k.gold;
    if (k.stone && rnd(b.rng) < k.stone) b.stones++;
  }
  b.gold += gold;
  b.fx?.push({ k: "die", x: e.x, y: e.y, kind: e.kind, boss: e.boss >= 0, gold });
  return false;
}

function checkMissions(b: Board) {
  for (const m of MISSIONS) {
    if (b.missions.includes(m.id) || !missionDone(b, m.id)) continue;
    b.missions.push(m.id);
    b.gold += m.gold ?? 0;
    b.stones += m.stones ?? 0;
    b.ev?.push({ t: "mission", id: m.id });
  }
}

const madeGrade = (b: Board, g: number) => Object.keys(b.made).some((id) => UNIT[id].grade === g);
function missionDone(b: Board, id: string): boolean {
  switch (id) {
    case "rare":
      return madeGrade(b, 1);
    case "trio": {
      const have = counts(b);
      return FACTIONS.some((f) => poolOf(f, 0).every((u) => have[u.id]));
    }
    case "epic":
      return madeGrade(b, 2);
    case "army":
      return unitCount(b) >= 25;
    case "legend":
      return madeGrade(b, 3);
    case "seller":
      return b.sold >= 10;
    case "allEpic":
      return FACTIONS.every((f) =>
        b.cells.some((c) => c.def && UNIT[c.def].faction === f && UNIT[c.def].grade >= 2)
      );
    case "unlucky":
      return b.failStreak >= 3;
    case "myth":
      return madeGrade(b, 4);
    case "hidden":
      return madeGrade(b, 5);
    case "rift":
      return b.rifts >= 5;
  }
  return false;
}

/** 멀티 어긋남 확인용 (같은 tick 에 모두 같은 값이어야 함) */
export function hashGame(g: Game): number {
  let h = g.tick | 0;
  const mix = (v: number) => {
    h = Math.imul(h ^ (Math.round(v * 16) | 0), 0x01000193) >>> 0;
  };
  for (const b of g.boards) {
    mix(b.gold);
    mix(b.stones);
    mix(b.wave);
    mix(b.kills);
    mix(b.enemies.length);
    mix(b.rng.r);
    for (const e of b.enemies) mix(e.hp);
  }
  return h >>> 0;
}
