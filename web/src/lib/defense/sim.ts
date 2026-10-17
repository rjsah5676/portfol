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
 * 필드: 9 × 6 칸. 가운데 7 × 4 = 28칸에 유닛, 둘레 사각 길(한 바퀴 26칸)을 적이 시계 방향으로 계속 돔.
 * 한 칸엔 같은 유닛 3기까지 (3기가 되면 합성).
 * 보관함: 필드 밖 BENCH 칸 (cells[CELLS..SLOTS-1]) — 공격 · 범위 효과는 없고, 합성 · 조합식 재료 · 판매는 됨.
 *         처음엔 BENCH_BASE 칸만 열려 있고 정비소에서 1칸씩 영구 해금 (b.mods.bench) — 잠긴 칸은 못 씀.
 *         소환 · 합성 결과는 필드 빈 칸이 먼저, 없으면 보관함으로.
 *
 * 영구 성장(로드아웃: 유닛 레벨 · 연구 · 유물 · 오염 단계)은 progress.ts 의 modsOf 로 보드마다 한 번 계산해 b.mods 에 붙임.
 *
 * 치트 코드 (cheats.ts): 보스(10~50웨이브)를 잡으면 b.cheat 에 3장이 놓이고, 고를 때까지 그 보드는 멈춤 (stepBoard 가 아무것도 안 함).
 *   솔로는 화면(controller)이 시계를 멈추고, 멀티는 CHEAT_MULTI_SEC 이 지나면 첫 카드를 자동으로 고름.
 *   고른 효과는 b.cx 로 합쳐 둠 (피해 · 공속 · 골드 · 적 속도 …), 뽑기는 b.crng (소환 운과 따로).
 */
import { B, BOSS_EVERY, CAP, LAST_WAVE, TPS, TUNE, countOf, hpOf, sec } from "./balance";
import { BOSSES, KIND, MAIN_BOSSES, TOWN_BOSSES, bossOfWave, kindOfWave, phaseOn, type BossDef, type Size, type TeleShape } from "./enemies";
import { CHEAT, CHEATS, CHEAT_MULTI_SEC, CHEAT_OFFER, CHEAT_WAVES, cheatFx0, cheatFxOf, cheatOdds, type CheatFx } from "./cheats";
import { MISSIONS, PATCHES } from "./meta";
import { mixSeed, pick, rnd, rndInt, type Rng } from "./rng";
import { BENCH_MAX, LV_BUFF, LV_DMG, modsOf, type Loadout, type Mods, type Stage } from "./progress";
import { EXP, EXP_RELICS, SHOP, expNodeOf, type ExpNode, type ShopKind } from "./town";
import {
  FACTIONS,
  RECIPE,
  TRANS,
  needMatch,
  SIZE_MULT,
  UNIT,
  poolOf,
  type Faction,
  type Grade,
  type UnitDef,
} from "./units";

export const COLS = 7;
export const ROWS = 4;
export const CELLS = COLS * ROWS;
/** 보관함 칸 수 (최대 — 열린 칸은 b.mods.bench) · 필드 + 보관함 */
export const BENCH = BENCH_MAX;
export const SLOTS = CELLS + BENCH;
export const isBench = (i: number) => i >= CELLS;
export const FIELD_W = COLS + 2;
export const FIELD_H = ROWS + 2;
export const PERIM = 2 * (FIELD_W - 1) + 2 * (FIELD_H - 1);
export const STACK = 3;
/** 쓸 수 있는 칸인지 (잠긴 보관함 칸이 아님) */
export const usable = (b: Board, i: number) => i < CELLS + b.mods.bench;

/** 길 위 거리 → 좌표 (왼쪽 위에서 시작, 시계 방향) */
export function pathPos(d: number): [number, number] {
  const W = FIELD_W - 1,
    H = FIELD_H - 1;
  if (d < W) return [0.5 + d, 0.5];
  if (d < W + H) return [W + 0.5, 0.5 + (d - W)];
  if (d < 2 * W + H) return [W + 0.5 - (d - W - H), H + 0.5];
  return [0.5, H + 0.5 - (d - 2 * W - H)];
}
/** 길 칸(0..PERIM-1) → 격자 좌표 (왼쪽 위 0,0 · 시계 방향) */
export function tileXY(t: number): [number, number] {
  const W = FIELD_W - 1,
    H = FIELD_H - 1;
  if (t < W) return [t, 0];
  if (t < W + H) return [W, t - W];
  if (t < 2 * W + H) return [W - (t - W - H), H];
  return [0, H - (t - 2 * W - H)];
}
/** 모서리 길 칸 (해피 타운 특수 칸) */
export const CORNERS = [0, FIELD_W - 1, FIELD_W + FIELD_H - 2, 2 * (FIELD_W - 1) + FIELD_H - 1];
/** 길 칸 바로 안쪽 유닛 칸 (모서리는 -1) — 해피 타운: 이 칸에 유닛이 있어야 건물 영업 */
export function tileCell(t: number): number {
  if (CORNERS.includes(t)) return -1;
  const [gx, gy] = tileXY(t);
  const c = Math.min(COLS, Math.max(1, gx)) - 1,
    r = Math.min(ROWS, Math.max(1, gy)) - 1;
  return r * COLS + c;
}
/** 유닛 칸 → 그 앞 길 칸들 (가장자리 칸만, 귀퉁이 칸은 둘) */
export function cellTiles(i: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < PERIM; t++) if (tileCell(t) === i) out.push(t);
  return out;
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
  /** 보물방 골렘 */
  tre: boolean;
  /** 분열로 생긴 적 (다시 갈라지지 않음) */
  child: boolean;
  /** 보스 2페이즈 (0 · 1) · 2페이즈 기술별 쿨 */
  ph: number;
  sk2: number[];
  /** 균열: 사라질 때까지 (tick) */
  expire: number;
  /** 마지막으로 때린 유닛 (처치 효과) */
  last: string;
}

export type UpKey = "knight" | "mech" | "arcane" | "hidden";
export type RiftTier = "C" | "B" | "A" | "S";
export const RIFT_TIERS: RiftTier[] = ["C", "B", "A", "S"];

export type Cmd =
  | { t: "summon" }
  | { t: "merge"; c: number }
  | { t: "sell"; c: number }
  | { t: "swap"; a: number; b: number }
  | { t: "up"; k: UpKey }
  | { t: "luck" }
  | { t: "gamble"; g: "E" | "L" }
  | { t: "recipe"; id: string }
  | { t: "patch"; id: string }
  | { t: "rift"; tier: RiftTier }
  | { t: "pick"; id: string }
  /** 치트 코드: 고르기 · 그 카드 다시 뽑기 (i = 0..2) */
  | { t: "cheat"; i: number }
  | { t: "reroll"; i: number }
  /** 포기 — 지금 웨이브에서 진 것으로 끝냄 (기록 · 보상은 거기까지) */
  | { t: "quit" }
  /** 다음 웨이브 부르기 — 이번 웨이브 적이 다 나왔으면 남은 시간을 건너뜀 (남은 1초마다 골드 B.nextGold). 남은 적은 그대로 */
  | { t: "next" }
  /** 해피 타운: 길 칸 p 에 건물 짓기 · 한 단계 올리기 */
  /** 해피 타운 원정: 캠프에서 고르기 (갈림길 주사위 · 드래프트 · 유물 · 상점 물건 · 휴식 — 번호, -1 = 건너뛰기 · 나가기) */
  | { t: "exp"; a: number };

/** 해피 타운 원정 캠프 (고르는 동안 시간이 멈춤) */
export type ExpCamp =
  | { k: "route"; dice: number[] }
  | { k: "draft"; offer: string[]; next: "route" | "relic" }
  | { k: "relic"; offer: string[] }
  | { k: "shop"; items: { kind: ShopKind; cost: number; sold: boolean }[] }
  | { k: "rest" };
export interface ExpState {
  /** 필드 적 한도 더하기 (철벽 · 피의 계약) */
  cap: number;
  /** 끝낸 칸 수 */
  segs: number;
  /** 지금 칸 · 진행 (waves → boss(엘리트 · UR)) */
  node: ExpNode | null;
  stage: "camp" | "waves" | "boss";
  segEnd: number;
  /** 엘리트 보스를 잡았나 (유물 보상) */
  eliteWon: boolean;
  camp: ExpCamp | null;
  relics: string[];
  /** 지나온 칸 (화면) */
  path: { t: number; node: ExpNode }[];
  /** 피의 계약 등 피해 배수 */
  dmg: number;
}

/** 화면 효과 (시뮬 결과에 영향 없음 — fx 가 null 이면 안 쌓음) */
export type Fx =
  | { k: "shot"; c: number; x: number; y: number; def: string; crit: boolean }
  | { k: "aoe"; x: number; y: number; r: number; def: string }
  | { k: "chain"; x1: number; y1: number; x2: number; y2: number; def: string }
  | { k: "ult"; c: number; def: string; name: string }
  | { k: "die"; x: number; y: number; kind: string; boss: boolean; gold: number }
  | { k: "miss"; x: number; y: number }
  | { k: "whip"; c: number }
  | { k: "heal"; x: number; y: number }
  /** 유닛이 칸에 나타남 (소환 · 합성 · 도박 · 조합식) — g 등급 */
  | { k: "spawn"; c: number; g: number };

/** 화면 알림 (토스트 · 획득 연출) */
export type Ev =
  | { t: "unit"; def: string; how: "summon" | "merge" | "gamble" | "recipe" | "pick" | "twin" }
  | { t: "gambleFail"; g: "E" | "L"; refund: boolean }
  | { t: "boss"; boss: number }
  /** 보스 2페이즈 시작 · 예고 시작(warn) / 맞음(hit: 기절한 칸 수) */
  | { t: "phase"; boss: number }
  | { t: "tele"; name: string; snd: string; hit: number | null }
  /** 심연 변이 「봉인」된 칸 (웨이브 시작) */
  | { t: "seal"; cells: number[] }
  /** 보물방 시작 · 끝 (ratio = 깎은 체력 비율) */
  | { t: "treasure"; stage: "start" | "end"; wave: number; ratio?: number; killed?: boolean }
  | { t: "bossDown"; boss: number; gold: number; stones: number; ticket: number | null }
  | { t: "wave"; wave: number }
  | { t: "mission"; id: string }
  | { t: "rift"; tier: number; ok: boolean }
  | { t: "patch"; id: string; auto: boolean }
  | { t: "cheatOffer" }
  | { t: "cheat"; id: string; auto: boolean }
  /** 해피 타운: 건물 · 웨이브 주사위 · 보스 기술 (DICE 순간이동 · MOA 빼앗기 · FORTE 앙코르) */
  | { t: "build"; tile: number; lv: number }
  /** 해피 타운 원정: 말이 from → to 로 가서 그 칸 일을 시작 · 전투 끝 (남은 적 leak 만큼 체력) */
  | { t: "expGo"; from: number; to: number; node: ExpNode; die: number }
  | { t: "expEnd"; node: ExpNode; win: boolean }
  | { t: "warp"; roll: number }
  | { t: "seize"; tile: number }
  | { t: "encore" }
  | { t: "over"; win: boolean };

export type Phase = "prep" | "wave" | "boss" | "break" | "treasure" | "over";

export interface Result {
  win: boolean;
  /** 도달한 웨이브 (클리어면 LAST_WAVE) */
  wave: number;
  tick: number;
  kills: number;
  reason: "clear" | "cap" | "boss" | "quit";
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
  /** 보스 2페이즈 예고: 이 칸들에 t tick 뒤 기절 sec (화면은 빨갛게 표시) */
  tele: { name: string; snd: string; cells: number[]; t: number; sec: number } | null;
  /** 보물방 진행 중 (남은 tick · 받은 골드 · 골렘 체력 · 잡았나) — 그동안 일반 적은 stash 에 */
  troom: { wave: number; t: number; max: number; killed: boolean } | null;
  /** 심연 변이 「봉인」: 이번 웨이브 동안 공격 못 하는 칸 (웨이브 시작 때 정함, 유닛을 옮기면 풀림) */
  sealed: number[];
  stash: Enemy[];
  /** 끝난 보물방 결과 (판 밖 보상 재료) */
  treasure: { wave: number; dmg: number; max: number; killed: boolean } | null;
  cells: Cell[];
  enemies: Enemy[];
  nextId: number;
  gold: number;
  stones: number;
  summons: number;
  free: number;
  up: { knight: number; mech: number; arcane: number; hidden: number };
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
  /** 영구 성장 효과 (판 시작 때 고정) */
  mods: Mods;
  /** 치트 코드: 지금 고르는 중인 카드 (없으면 null — 있으면 보드가 멈춤) · 고른 것 · 합친 효과 · 뽑기 난수 */
  cheat: { kind: "patch" | "cheat"; offer: string[]; rr: number[]; t: number } | null;
  cheats: string[];
  cx: CheatFx;
  crng: Rng;
  /** 배치 따라 바뀌는 전체 피해 배수 (순수 혈통 · 무지개 연합) */
  team: number;
  /** 필드에 가장 많은 세력 (히든 빼고) · 그 비율 0~1 · 순혈 세기 0~1 (비율이 pureFrom 밑이면 0, pureFrom 이면 pureBase, 100% 면 1) — 배치가 바뀌면 다시 계산 */
  mono: Faction | null;
  pureR: number;
  pure: number;
  /** 스테이지 (main 글리치 시티 · town 해피 타운) */
  stage: Stage;
  /** 해피 타운: 길 칸별 건물 단계 0~3 (모서리 · 글리치 시티는 늘 0) */
  bld: number[];
  /** 해피 타운 원정: 내 말 위치 (길 칸) · 원정 상태 (글리치 시티는 null) */
  pos: number;
  exp: ExpState | null;
  /** 해피 타운: MOA 에게 빼앗긴 건물 칸 (보스를 잡으면 돌아옴) */
  seized: number[];
  /** 해피 타운 주사위 · 보스 기술 난수 (소환 운과 따로) */
  trng: Rng;
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

export function newBoard(seed: number, idx: number, lo?: Loadout | null): Board {
  const mods = modsOf(lo);
  const b: Board = {
    idx,
    // 보드마다 같은 시드 → 멀티에서 모두 같은 운으로 시작 (나뉘는 건 각자 고른 것 때문)
    rng: { r: mixSeed(seed, 0) },
    phase: "prep",
    wave: 0,
    wt: -sec(B.prepSec),
    spawned: 0,
    bossT: 0,
    tele: null,
    troom: null,
    sealed: [],
    stash: [],
    treasure: null,
    cells: Array.from({ length: SLOTS }, () => ({ def: null, units: [] })),
    enemies: [],
    nextId: 1,
    gold: B.startGold + mods.startGold,
    stones: mods.startStones,
    summons: 0,
    free: 0,
    up: { knight: 0, mech: 0, arcane: 0, hidden: 0 },
    luck: Math.min(B.luckCost.length, mods.startLuck),
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
    mods,
    // 시작 치트: 패치 4개 중 하나 (고를 때까지 멈춤, 다시 뽑기 없음)
    cheat: { kind: "patch", offer: PATCHES.map((p) => p.id), rr: PATCHES.map(() => 0), t: 0 },
    cheats: [],
    cx: cheatFx0(),
    crng: { r: mixSeed(seed, 77) },
    team: 1,
    mono: null,
    pureR: 0,
    pure: 0,
    stage: mods.stage,
    bld: new Array(PERIM).fill(0),
    pos: 0,
    exp: null,
    seized: [],
    trng: { r: mixSeed(seed, 131) },
    fx: null,
    ev: null,
  };
  if (b.stage === "town") expInit(b);
  return b;
}

/** loadouts: 보드마다 영구 성장 (없으면 기본) */
export function newGame(seed: number, players = 1, loadouts?: (Loadout | null)[]): Game {
  return {
    seed: seed >>> 0,
    tick: 0,
    boards: Array.from({ length: players }, (_, i) => newBoard(seed >>> 0, i, loadouts?.[i])),
    over: false,
  };
}

/* ───────────────────────── 조회 (UI · 봇 공용) ───────────────────────── */

export const summonCost = (b: Board) =>
  Math.max(1, Math.min(B.summon.max, B.summon.base + B.summon.step * b.summons) - b.mods.summonDisc - b.cx.summonDisc);
export const upCost = (b: Board, k: UpKey) =>
  Math.round(
    (B.up[k].base + B.up[k].step * b.up[k]) * b.cx.upCost * (b.patch === "pure" && b.mono === k ? 1 - (1 - TUNE.pureUp) * b.pure : 1)
  );
export const luckCost = (b: Board) => (b.luck < B.luckCost.length ? B.luckCost[b.luck] : Infinity);
export const unitCount = (b: Board) => b.cells.reduce((n, c) => n + c.units.length, 0);
export const hasEmpty = (b: Board) => b.cells.some((c, i) => !c.def && usable(b, i));
/** 판매 금액 */
export const sellPrice = (b: Board, grade: number) => Math.floor((B.sell[grade] ?? 0) * b.mods.sellMult);
/** 판매 값 (골드 · 행운석). 모든 유닛을 팔 수 있음 — 레전드부터는 행운석도 (유닛마다 따로 정한 값이 있으면 그 값) */
export const sellOf = (b: Board, d: UnitDef) => ({
  gold: Math.floor((d.sell?.gold ?? B.sell[d.grade] ?? 0) * b.mods.sellMult),
  stones: d.sell?.stones ?? B.sellStones[d.grade] ?? 0,
});
/** 보스 제한 시간 (초) */
export const bossSecOf = (b: Board) => Math.max(20, B.bossSec + b.mods.bossSec + b.cx.bossSec);
/* ───────────────────────── 해피 타운 원정 ───────────────────────── */

export const expHas = (b: Board, id: string) => !!b.exp?.relics.includes(id);
/** 원정 시작: 출발 포털에서 첫 갈림길 */
function expInit(b: Board) {
  b.phase = "break";
  b.wt = 0;
  b.gold += b.mods.deedGold;
  b.exp = { cap: 0, segs: 0, node: null, stage: "camp", segEnd: 0, eliteWon: false, camp: null, relics: [], path: [], dmg: 1 };
  expRoute(b);
}
function expRoute(b: Board) {
  const x = b.exp!;
  const n = expHas(b, "dice3") ? 3 : 2;
  const dice: number[] = [];
  for (let i = 0; i < n; i++) dice.push(rndInt(b.trng, 6) + 1);
  x.stage = "camp";
  x.node = null;
  x.camp = { k: "route", dice };
}
/** 주사위 눈 d 로 가면 멈추는 칸 (출발 포털을 넘으면 거기서 멈춤 = UR 보스) */
export const expDest = (b: Board, d: number) => (b.pos + d >= PERIM ? 0 : b.pos + d);
/** 가장 낮은 등급 필드 유닛 칸을 한 등급 올림 (같은 세력 · 레전드까지) */
function expGrow(b: Board) {
  let best = -1;
  for (let i = 0; i < CELLS; i++) {
    const d = b.cells[i].def ? UNIT[b.cells[i].def!] : null;
    if (!d || d.grade >= 3 || d.faction === "hidden") continue;
    if (best < 0 || d.grade < UNIT[b.cells[best].def!].grade) best = i;
  }
  if (best < 0) return;
  const d = UNIT[b.cells[best].def!];
  b.cells[best].def = pick(b.trng, poolOf(d.faction, (d.grade + 1) as Grade)).id;
  b.dirty = true;
  b.fx?.push({ k: "spawn", c: best, g: d.grade + 1 });
}
function relicOffer(b: Board): string[] {
  const pool = EXP_RELICS.filter((r) => !b.exp!.relics.includes(r.id)).map((r) => r.id);
  const out: string[] = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(rndInt(b.trng, pool.length), 1)[0]);
  return out;
}
function takeRelic(b: Board, id: string) {
  const x = b.exp!;
  x.relics.push(id);
  if (id === "blood") {
    x.cap -= 20;
    x.dmg *= 1.35;
  }
  if (id === "iron") x.cap += 25;
}
/** 칸 일 시작 */
function expGo(b: Board, d: number) {
  const x = b.exp!;
  const from = b.pos;
  b.pos = expDest(b, d);
  const node = expNodeOf(b.pos);
  x.node = node;
  x.path.push({ t: b.pos, node });
  x.camp = null;
  b.ev?.push({ t: "expGo", from, to: b.pos, node, die: d });
  if (node === "fight" || node === "elite") {
    x.stage = "waves";
    x.eliteWon = false;
    x.segEnd = b.wave + (node === "elite" ? EXP.eliteWaves : EXP.fightWaves);
    startWave(b, b.wave + 1);
  } else if (node === "boss") {
    // 한 바퀴 끝: UR 보스 (타운 단계가 높을수록 센 UR)
    x.stage = "boss";
    b.wave = Math.max(b.wave + 1, EXP.bossWave);
    b.wt = 0;
    b.phase = "boss";
    b.bossT = sec(bossSecOf(b));
    b.ev?.push({ t: "wave", wave: b.wave });
    spawnBoss(b, TOWN_BOSSES[Math.min(TOWN_BOSSES.length - 1, Math.floor((Math.max(1, b.mods.town) - 1) / 3))]);
  } else if (node === "shop") {
    const kinds: ShopKind[] = ["heal", "free", "epic", "legend", "relic", "up"];
    const items: { kind: ShopKind; cost: number; sold: boolean }[] = [];
    while (items.length < 4) {
      const k = kinds.splice(rndInt(b.trng, kinds.length), 1)[0];
      items.push({ kind: k, cost: Math.round(SHOP[k].cost * (1 + EXP.shopUp * x.segs)), sold: false });
    }
    x.stage = "camp";
    x.camp = { k: "shop", items };
  } else if (node === "rest") {
    x.stage = "camp";
    x.camp = { k: "rest" };
  } else {
    const offer = relicOffer(b);
    x.stage = "camp";
    if (offer.length) x.camp = { k: "relic", offer };
    else expRoute(b);
  }
}
/** 전투 칸 마지막 웨이브가 끝남 → 엘리트면 보스, 아니면 정리 시간 */
function expWavesDone(b: Board) {
  const x = b.exp!;
  if (x.node === "elite") {
    x.stage = "boss";
    b.phase = "boss";
    b.bossT = sec(bossSecOf(b));
    spawnBoss(b, MAIN_BOSSES[rndInt(b.trng, MAIN_BOSSES.length)]);
  } else expSegEnd(b);
}
/** 필드 적 n 마리 치움 (앞서가는 적부터 — 보스 · 균열은 빼고) */
function expClear(b: Board, n: number) {
  const keep = b.enemies.filter((e) => e.boss >= 0 || e.rift);
  const rest = b.enemies.filter((e) => !(e.boss >= 0 || e.rift)).sort((p, q) => q.trav - p.trav || p.id - q.id);
  b.enemies = [...keep, ...rest.slice(Math.min(n, rest.length))];
}
/** 전투 칸 끝: 원정 유물 효과 · 드래프트 (남은 적은 필드에 그대로) */
function expSegEnd(b: Board) {
  const x = b.exp!;
  const node = x.node!;
  b.tele = null;
  b.ev?.push({ t: "expEnd", node, win: x.eliteWon });
  x.segs++;
  if (expHas(b, "growth")) expGrow(b);
  if (expHas(b, "piggy")) b.gold += Math.min(150, Math.floor(b.gold * 0.25));
  // 드래프트: 3세력 하나씩 · 칸을 지날수록 높은 등급 (엘리트는 한 등급 위)
  const gr = Math.min(3, 1 + Math.floor(x.segs / 2) + (node === "elite" ? 1 : 0)) as Grade;
  const fs = [...FACTIONS];
  const offer: string[] = [];
  while (fs.length) offer.push(pick(b.trng, poolOf(fs.splice(rndInt(b.trng, fs.length), 1)[0], gr)).id);
  x.stage = "camp";
  b.phase = "break";
  x.camp = { k: "draft", offer, next: node === "elite" && x.eliteWon ? "relic" : "route" };
}
/** 캠프에서 고르기 (명령 exp) */
function expPick(b: Board, a: number): string | null {
  const x = b.exp!;
  const c = x.camp!;
  switch (c.k) {
    case "route": {
      if (!(a >= 0 && a < c.dice.length)) return "고를 주사위가 없어요";
      expGo(b, c.dice[a]);
      return null;
    }
    case "draft": {
      if (a >= 0) {
        const id = c.offer[a];
        if (!id) return "없는 카드예요";
        if (!hasEmpty(b) && !b.cells.some((s) => s.def === id && s.units.length < STACK)) return "빈 칸이 없어요 — 팔거나 합성하고 골라요";
        give(b, id, "pick");
      } else b.gold += EXP.skipGold;
      if (c.next === "relic") {
        const offer = relicOffer(b);
        if (offer.length) {
          x.camp = { k: "relic", offer };
          return null;
        }
      }
      expRoute(b);
      return null;
    }
    case "relic": {
      if (a >= 0) {
        const id = c.offer[a];
        if (!id) return "없는 유물이에요";
        takeRelic(b, id);
      }
      expRoute(b);
      return null;
    }
    case "shop": {
      if (a < 0) {
        expRoute(b);
        return null;
      }
      const it = c.items[a];
      if (!it || it.sold) return "이미 산 물건이에요";
      if (b.gold < it.cost) return "골드가 모자라요";
      if ((it.kind === "epic" || it.kind === "legend") && !hasEmpty(b)) return "빈 칸이 없어요";
      if (it.kind === "relic" && !relicOffer(b).length) return "더 받을 유물이 없어요";
      if (it.kind === "heal" && !b.enemies.some((e) => e.boss < 0 && !e.rift)) return "치울 적이 없어요";
      b.gold -= it.cost;
      it.sold = true;
      if (it.kind === "heal") expClear(b, EXP.shopClear);
      else if (it.kind === "free") b.free += 3;
      else if (it.kind === "epic" || it.kind === "legend") give(b, pick(b.trng, poolOf(pick(b.trng, FACTIONS), it.kind === "epic" ? 2 : 3)).id, "pick");
      else if (it.kind === "relic") {
        const o = relicOffer(b);
        takeRelic(b, o[rndInt(b.trng, o.length)]);
      } else {
        const f = (["knight", "mech", "arcane"] as const).reduce((m, k) => (b.up[k] < b.up[m] ? k : m), "knight" as "knight" | "mech" | "arcane");
        b.up[f] = Math.min(B.up.max, b.up[f] + 2);
      }
      return null;
    }
    case "rest": {
      if (a === 1) expGrow(b);
      else expClear(b, Math.ceil(b.enemies.length * EXP.restClear));
      expRoute(b);
      return null;
    }
  }
}
/** 패배 기준 적 수 */
export const capOf = (b: Board) => CAP + b.cx.cap + (b.exp ? b.exp.cap : 0);
/** 보드에 있는 유닛 수 (id → 수) */
export function counts(b: Board): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of b.cells) if (c.def) m[c.def] = (m[c.def] ?? 0) + c.units.length;
  return m;
}
/** 초월 조합식이 열렸는지 (정비소 해금) */
export const recipeOpen = (b: Board, id: string) => UNIT[id].grade !== TRANS || b.mods.trans.includes(id);
/**
 * 조합식 재료로 뺄 칸들 (재료 하나당 칸 하나, 같은 칸이 여러 번 나올 수 있음). 못 만들면 null.
 * 정해진 유닛 먼저 고르고, @ 재료(아무 신화 · 아무 초월)는 남은 것 중 앞 칸부터 — 적게 쌓인 칸부터 뺌.
 */
export function recipePlan(b: Board, id: string): number[] | null {
  const r = RECIPE[id];
  if (!r || !recipeOpen(b, id)) return null;
  const left = b.cells.map((c) => (c.def ? c.units.length : 0));
  const out: number[] = [];
  const order = [...r.needs].sort((x, y) => (x[0] === "@" ? 1 : 0) - (y[0] === "@" ? 1 : 0));
  for (const n of order) {
    let best = -1;
    for (let i = 0; i < SLOTS; i++) {
      const d = b.cells[i].def;
      if (!d || left[i] <= 0 || !needMatch(n, d) || d === id) continue;
      if (best < 0 || left[i] < left[best]) best = i;
    }
    if (best < 0) return null;
    left[best]--;
    out.push(best);
  }
  return out;
}
/** 지금 만들 수 있는 조합식인지 */
export function canRecipe(b: Board, id: string): boolean {
  return !!recipePlan(b, id);
}
/** 순혈 세기: 가장 많은 세력 비율 r → 0~1 (TUNE.pureFrom 밑이면 0 = 꺼짐, pureFrom 이면 pureBase, 100% 면 1, 사이는 비례) */
export const pureT = (r: number) =>
  r < TUNE.pureFrom - 1e-9
    ? 0
    : Math.min(1, TUNE.pureBase + ((1 - TUNE.pureBase) * (r - TUNE.pureFrom)) / (1 - TUNE.pureFrom));
export const mythCount = (b: Board) =>
  b.cells.reduce((n, c) => n + (c.def && UNIT[c.def].grade >= 4 ? c.units.length : 0), 0);
/** 세력 강화 피해 배수 — 히든은 피해 대신 고유 효과 (hiddenFx) */
export function upMult(b: Board, f: Faction): number {
  if (f === "hidden") return 1;
  return 1 + B.up.perLv * b.up[f];
}
/** 히든 강화: 히든 유닛 고유 효과 배수 (삭제 · 정화 비율, 방어 깎기, 보스 배수) */
export function hiddenFx(b: Board): number {
  return 1 + B.up.hiddenFx * b.up.hidden;
}

/* ───────────────────────── 명령 ───────────────────────── */

/** 명령이 맞는 모양인지 (서버가 받을 때 · 기록을 다시 돌릴 때) */
export function isCmd(x: unknown): x is Cmd {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  const cell = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < SLOTS;
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
      return keys === 2 && (c.k === "knight" || c.k === "mech" || c.k === "arcane" || c.k === "hidden");
    case "gamble":
      return keys === 2 && (c.g === "E" || c.g === "L");
    case "recipe":
    case "pick":
      return keys === 2 && typeof c.id === "string" && !!UNIT[c.id];
    case "patch":
      return keys === 2 && typeof c.id === "string" && PATCHES.some((p) => p.id === c.id);
    case "rift":
      return keys === 2 && RIFT_TIERS.includes(c.tier as RiftTier);
    case "quit":
    case "next":
      return keys === 1;
    case "exp":
      return keys === 2 && Number.isInteger(c.a) && (c.a as number) >= -1 && (c.a as number) < 6;
    case "cheat":
    case "reroll":
      return keys === 2 && Number.isInteger(c.i) && (c.i as number) >= 0 && (c.i as number) < Math.max(CHEAT_OFFER, PATCHES.length);
  }
  return false;
}

/** 명령 실행. 못 하는 명령이면 이유(문자열)를 돌려주고 아무것도 안 바꿈 */
export function apply(g: Game, p: number, cmd: Cmd): string | null {
  const b = g.boards[p];
  if (!b || b.result) return "끝난 판이에요";
  if (b.cheat && cmd.t !== "cheat" && cmd.t !== "reroll" && cmd.t !== "quit") return "치트 코드를 먼저 골라 주세요";
  // 원정 캠프: 시간이 멈춘 채 고르기 · 소환 · 합성 · 판매 · 강화만
  if (b.exp?.camp && (cmd.t === "next" || cmd.t === "rift")) return "갈 길을 먼저 골라요";
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
      // 원정 유물 「서약」: 그 세력만
      const oath = b.exp ? FACTIONS.find((f) => expHas(b, `oath_${f}`)) : undefined;
      const def = pick(b.rng, poolOf(oath ?? pick(b.rng, FACTIONS), grade as Grade));
      give(b, def.id, "summon");
      if (expHas(b, "twin") && hasEmpty(b) && rnd(b.trng) < 0.2) give(b, def.id, "twin");
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
      // 원정 유물 「연금 합성」: 25% 두 등급 위 (레전드까지)
      const up2 = expHas(b, "alch") && d.grade + 2 <= 3 && rnd(b.trng) < 0.25;
      const next = pick(b.rng, poolOf(d.faction, (d.grade + (up2 ? 2 : 1)) as Grade));
      give(b, next.id, "merge", cmd.c);
      return null;
    }
    case "sell": {
      const c = b.cells[cmd.c];
      if (!c.def) return "빈 칸이에요";
      const d = UNIT[c.def];
      c.units.pop();
      if (!c.units.length) c.def = null;
      const sp = sellOf(b, d);
      b.gold += sp.gold;
      b.stones += sp.stones + (d.grade >= 3 ? b.mods.sellStone : 0);
      b.sold++;
      b.dirty = true;
      return null;
    }
    case "swap": {
      if (cmd.a === cmd.b) return null;
      if (!usable(b, cmd.a) || !usable(b, cmd.b)) return "잠긴 보관함 칸이에요";
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
      if (b.wave < gm.from) return `${gm.from}웨이브부터 할 수 있어요`;
      if (b.stones < gm.cost) return "행운석이 모자라요";
      if (!hasEmpty(b)) return "빈 칸이 없어요";
      b.stones -= gm.cost;
      const p = gm.p + (b.patch === "gambler" ? TUNE.gamblerP : 0) + b.mods.gamble + b.cx.gamble;
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
      if (!recipeOpen(b, cmd.id)) return "정비소에서 초월을 해금해야 해요";
      const plan = recipePlan(b, cmd.id);
      if (!plan) return "재료가 모자라요";
      for (const i of plan) {
        const c = b.cells[i];
        c.units.pop();
        if (!c.units.length) c.def = null;
      }
      b.dirty = true;
      give(b, r.id, "recipe");
      b.gold += b.mods.alchemyGold;
      b.stones += b.mods.alchemyStones;
      return null;
    }
    case "patch": {
      // (예전 명령) 시작 치트 창에서 패치를 고르는 것과 같음
      if (b.cheat?.kind !== "patch") return "패치는 판 시작 때 치트 코드로 골라요";
      takeCheat(b, cmd.id, false);
      return null;
    }
    case "rift": {
      if (b.phase === "treasure") return "보물방에선 균열을 못 열어요";
      if (b.wave < B.rift.from) return `${B.rift.from}웨이브부터 열 수 있어요`;
      if (b.riftCd > 0) return "균열이 아직 닫혀 있어요";
      if (b.enemies.some((e) => e.rift)) return "이미 열린 균열이 있어요";
      const S = B.rift.S;
      if (cmd.tier === "S" && b.wave < S.from) return `S 균열은 ${S.from}웨이브부터`;
      const tier = RIFT_TIERS.indexOf(cmd.tier) + 1;
      const kind = KIND[kindOfWave(Math.max(1, b.wave))];
      const e = spawn(b, kind.id, hpOf(b.wave) * B.rift[cmd.tier].hp);
      e.rift = tier;
      e.size = 1;
      e.expire = sec(B.rift.sec);
      b.riftCd = Math.round(sec(B.rift.cd) * b.mods.riftCd);
      return null;
    }
    case "quit": {
      b.cheat = null;
      finish(g, b, false, "quit");
      return null;
    }
    case "next": {
      const why = nextBlock(b);
      if (why) return why;
      if (b.phase === "prep") {
        startWave(b, 1);
        return null;
      }
      if (b.phase === "wave") b.gold += nextBonus(b);
      endWave(b);
      advance(b);
      return null;
    }
    case "cheat": {
      if (!b.cheat) return "고를 치트 코드가 없어요";
      const id = b.cheat.offer[cmd.i];
      if (!id) return "없는 카드예요";
      takeCheat(b, id, false);
      return null;
    }
    case "reroll": {
      const o = b.cheat;
      if (!o) return "고를 치트 코드가 없어요";
      if (!(o.rr[cmd.i] > 0)) return "이 카드는 더 못 바꿔요";
      const nx = drawCheat(b, o.offer);
      if (!nx) return "바꿀 치트 코드가 없어요";
      o.rr[cmd.i]--;
      o.offer[cmd.i] = nx;
      return null;
    }
    case "exp": {
      if (!b.exp?.camp) return "지금은 고를 게 없어요";
      return expPick(b, cmd.a);
    }
    case "pick": {
      if (!b.tickets.length) return "골라 뽑기권이 없어요";
      const d = UNIT[cmd.id];
      // 쌓인(이월된) 뽑기권 중 그 등급 것을 아무거나 씀 (예전 기록은 늘 맨 앞 것과 같은 등급이라 결과 같음)
      const ti = b.tickets.indexOf(d.grade);
      if (ti < 0 || d.faction === "hidden") return "그 등급 뽑기권이 없어요";
      if (!hasEmpty(b) && !b.cells.some((c) => c.def === d.id && c.units.length < STACK))
        return "빈 칸이 없어요";
      b.tickets.splice(ti, 1);
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
  how: "summon" | "merge" | "gamble" | "recipe" | "pick" | "twin",
  prefer = -1
) {
  let at = -1;
  for (let i = 0; i < SLOTS; i++)
    if (b.cells[i].def === id && b.cells[i].units.length < STACK) {
      at = i;
      break;
    }
  if (at < 0 && prefer >= 0 && !b.cells[prefer].def) at = prefer;
  // 필드 빈 칸 먼저, 없으면 보관함 (findIndex 가 앞에서부터라 필드가 먼저)
  if (at < 0) at = b.cells.findIndex((c, i) => !c.def && usable(b, i));
  if (at < 0) return; // (부르는 쪽이 자리를 확인함)
  const c = b.cells[at];
  c.def = id;
  c.units.push({ cd: 0, ult: 0, stun: 0 });
  b.dirty = true;
  b.made[id] = (b.made[id] ?? 0) + 1;
  const d = UNIT[id];
  if (d.grade >= 3 && b.patch === "union") b.free += 2;
  b.ev?.push({ t: "unit", def: id, how });
  b.fx?.push({ k: "spawn", c: at, g: d.grade });
  // 쌍둥이 별: 레전드 이상을 얻으면 확률로 같은 등급 · 같은 세력 하나 더 (그 1기는 다시 굴리지 않음)
  const twin = b.mods.twinStar + b.cx.twin;
  if (twin && d.grade >= 3 && d.faction !== "hidden" && how !== "twin" && hasEmpty(b)) {
    if (rnd(b.rng) < twin) give(b, pick(b.rng, poolOf(d.faction, d.grade)).id, "twin");
  }
}

/* ───────────────────────── 적 ───────────────────────── */

/** 치트 코드 보정 배수 (지난 치트 보스 수 × TUNE.cheatHp) */
export function cheatHpOf(w: number): number {
  let n = 0;
  for (const cw of CHEAT_WAVES) if (w > cw) n++;
  return 1 + TUNE.cheatHp * n;
}

function spawn(b: Board, kindId: string, hp: number): Enemy {
  const k = KIND[kindId];
  const w = Math.max(1, b.wave);
  hp *= cheatHpOf(w);
  const e: Enemy = {
    id: b.nextId++,
    kind: kindId,
    boss: -1,
    rift: 0,
    elite: false,
    hp: hp * b.mods.glitch.hp,
    max: hp * b.mods.glitch.hp,
    armor: Math.round(B.armorPerWave * w * k.armor * b.mods.glitch.armor),
    mres: k.mres,
    pres: 0,
    size: k.size,
    spd: (B.enemySpd * k.spd * b.mods.glitch.spd) / TPS,
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
    tre: false,
    child: false,
    ph: 0,
    sk2: [],
    expire: 0,
    last: "",
  };
  b.enemies.push(e);
  return e;
}

function spawnBoss(b: Board, def: BossDef) {
  const w = b.wave;
  const e = spawn(b, "slime", hpOf(w) * B.bossHp * def.hp * b.mods.glitch.boss);
  e.kind = "boss";
  e.boss = BOSSES.indexOf(def);
  e.armor = Math.round(B.armorPerWave * w * def.armor * b.mods.glitch.armor);
  e.mres = def.mres;
  e.pres = def.pres;
  e.size = def.size;
  e.spd = (B.enemySpd * def.spd * b.mods.glitch.spd) / TPS;
  e.sk = def.skills.map((s) => sec(s.every));
  // 심연 변이 「방벽」: 보호막을 두르고 나옴
  if (b.mods.glitch.mut?.includes("ward")) e.shield = e.max * 0.15;
  b.ev?.push({ t: "boss", boss: e.boss });
}

/* ───────────────────────── 진행 ───────────────────────── */

export function step(g: Game) {
  for (const b of g.boards) {
    if (b.result) continue;
    if (b.cheat) {
      // 고르는 동안 멈춤. 멀티만 시간이 지나면 첫 카드 (솔로는 화면이 시계를 멈춤)
      if (g.boards.length > 1 && ++b.cheat.t >= sec(CHEAT_MULTI_SEC)) takeCheat(b, b.cheat.offer[0], true);
      continue;
    }
    // 원정 캠프: 고르는 동안 멈춤
    if (b.exp?.camp) continue;
    stepBoard(g, b);
  }
  g.tick++;
  g.over = g.boards.every((b) => b.result);
}

function finish(g: Game, b: Board, win: boolean, reason: Result["reason"]) {
  b.result = { win, wave: b.wave, tick: g.tick, kills: b.kills, reason };
  b.phase = "over";
  b.ev?.push({ t: "over", win });
}

/** 다음 웨이브를 부를 수 없는 이유 (부를 수 있으면 null) — 준비 시간 · 적이 다 나온 일반 웨이브 · 보스 뒤 쉬는 시간 */
export function nextBlock(b: Board): string | null {
  if (b.result) return "끝난 판이에요";
  if (b.phase === "treasure") return "보물방이 끝나야 넘어가요";
  if (b.phase === "boss") return "보스를 잡아야 넘어가요";
  if (b.exp && b.exp.stage !== "waves") return "갈 길을 먼저 골라요";
  if (b.phase === "wave" && b.spawned < countOf(b.wave)) return "이번 웨이브 적이 아직 나오는 중이에요";
  return null;
}
/** 지금 부르면 받는 골드 */
export const nextBonus = (b: Board) =>
  b.phase === "wave" ? Math.floor(Math.max(0, sec(B.waveSec) - b.wt) / TPS) * B.nextGold : 0;

/** 보물방 시작: 일반 적은 치워 두고 골렘 한 마리 · 시간 제한 */
function startTreasure(b: Board, w: number) {
  const T = B.treasure;
  b.phase = "treasure";
  b.wave = w;
  b.wt = 0;
  b.stash = b.enemies;
  b.enemies = [];
  b.tele = null;
  const e = spawn(b, "golem", hpOf(T.hpWave) * B.bossHp * T.hp * b.mods.glitch.boss);
  e.tre = true;
  e.size = 1;
  e.armor = 0;
  e.mres = 0;
  e.spd *= T.spd;
  b.troom = { wave: w, t: sec(T.sec), max: e.max, killed: false };
  b.ev?.push({ t: "treasure", stage: "start", wave: w });
}
/** 보물방 끝: 결과 남기고 치워 둔 적을 돌려놓고 그 웨이브 시작 */
function endTreasure(b: Board) {
  const r = b.troom!;
  const e = b.enemies.find((x) => x.tre);
  const dmg = r.killed ? r.max : Math.max(0, r.max - (e ? Math.max(0, e.hp) : 0));
  b.treasure = { wave: r.wave, dmg, max: r.max, killed: r.killed };
  b.enemies = b.stash;
  b.stash = [];
  b.troom = null;
  b.ev?.push({ t: "treasure", stage: "end", wave: r.wave, ratio: dmg / r.max, killed: r.killed });
  startWave(b, r.wave);
}

function startWave(b: Board, w: number) {
  if (w === b.mods.treasure && !b.treasure && !b.troom && w % BOSS_EVERY !== 0) return startTreasure(b, w);
  b.wave = w;
  // 심연 변이 「봉인」: 유닛이 있는 칸 2개 (그 웨이브 동안)
  b.sealed = [];
  if (b.mods.glitch.mut?.includes("lock")) {
    const has: number[] = [];
    for (let i = 0; i < CELLS; i++) if (b.cells[i].def) has.push(i);
    for (let k = 0; k < 2 && has.length; k++) b.sealed.push(has.splice(rndInt(b.rng, has.length), 1)[0]);
    if (b.sealed.length) b.ev?.push({ t: "seal", cells: [...b.sealed] });
  }
  b.wt = 0;
  b.spawned = 0;
  b.ev?.push({ t: "wave", wave: w });
  const boss = !b.exp && w % BOSS_EVERY === 0 ? bossOfWave(w, b.stage) : null;
  if (boss) {
    b.phase = "boss";
    b.bossT = sec(bossSecOf(b));
    spawnBoss(b, boss);
  } else b.phase = "wave";
}

/** 다음 웨이브 (원정이면 그 칸 마지막 웨이브 뒤엔 보스 · 정리) */
function advance(b: Board) {
  if (b.exp && b.wave >= b.exp.segEnd) expWavesDone(b);
  else startWave(b, b.wave + 1);
}

function endWave(b: Board) {
  const wg = Math.floor(
    (B.waveGold.base + B.waveGold.per * b.wave) * b.mods.waveGold * b.cx.waveGold * (b.patch === "interest" ? TUNE.interestWave : 1)
  );
  b.gold += b.wave <= b.mods.firstHarvest ? wg * 2 : wg;
  if (b.patch === "interest") b.gold += Math.min(TUNE.interestMax, Math.floor(b.gold * TUNE.interestPct));
  if (b.cx.interest) b.gold += Math.min(b.cx.interestMax, Math.floor(b.gold * b.cx.interest));
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
      // 엘리트: 5웨이브마다 마지막 적 · 심연 변이 「정예」면 모든 웨이브
      const elite = last && (b.wave % 5 === 0 || !!b.mods.glitch.mut?.includes("rush"));
      const e = spawn(b, kindOfWave(b.wave), hpOf(b.wave) * (elite ? B.eliteHp : 1));
      if (elite) e.elite = true;
      b.spawned++;
    }
    if (++b.wt >= W) {
      endWave(b);
      advance(b);
    }
  } else if (b.phase === "boss") {
    if (--b.bossT <= 0) {
      // 원정 엘리트: 보스는 떠나고 체력이 깎임 (UR 보스는 실패)
      if (b.exp?.node === "elite") {
        // 엘리트 보스는 떠남 (유물 없음)
        b.enemies = b.enemies.filter((e) => e.boss < 0);
        expSegEnd(b);
      } else return finish(g, b, false, "boss");
    }
  } else if (b.phase === "treasure") {
    const r = b.troom!;
    if (--r.t <= 0 || r.killed) endTreasure(b);
  } else if (b.phase === "break" && b.exp) {
    // (원정은 캠프에서 멈춤 — 쉬는 시간 없음)
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
    e.shred = b.cx.shred;
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
      const k = lvBuff(b, a.def.id);
      const sl = Math.min(B.slowCap, (a.def.aura!.slow ?? 0) * k);
      if (sl > e.aSlow) e.aSlow = sl;
      if (a.def.aura!.shred) e.shred += a.def.aura!.shred * k * (a.def.faction === "hidden" ? hiddenFx(b) : 1);
    }
  }

  // ── 적 이동 · 보스 기술 ──
  const coreSlow = 1 - b.cx.slow;
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
    if (b.sealed.length && b.sealed.includes(i)) continue; // 봉인된 칸
    const sp = 1 + b.aspd[i] + b.cx.aspd + b.mods.aspdAll + (def.faction === "hidden" ? 0 : b.mods.facAspd[def.faction]);
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

  if (es.length >= capOf(b)) return finish(g, b, false, "cap");
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
        const as = a.aspd * lvBuff(b, id);
        if (dx * dx + dy * dy <= r2 && as > b.aspd[j]) b.aspd[j] = as;
      }
    }
    if (a.slow || a.shred) {
      const l = by.get(id);
      if (l) l.push(i);
      else by.set(id, [i]);
    }
  }
  b.auras = [...by.entries()].map(([id, cells]) => ({ def: UNIT[id], cells }));
  // 무지개 연합 (필드만, 히든은 안 셈)
  let fk = 0,
    fm = 0,
    fa = 0;
  for (let i = 0; i < CELLS; i++) {
    const f = b.cells[i].def ? UNIT[b.cells[i].def!].faction : null;
    if (f === "knight") fk = 1;
    else if (f === "mech") fm = 1;
    else if (f === "arcane") fa = 1;
  }
  const kinds = fk + fm + fa;
  // 세력 비율 (필드 유닛 수 기준, 히든도 전체에 셈 · 보관함은 안 셈) → 가장 많은 세력과 순혈 세기 0~1
  const n = { knight: 0, mech: 0, arcane: 0 };
  let all = 0;
  for (let i = 0; i < CELLS; i++) {
    const c = b.cells[i];
    if (!c.def) continue;
    all += c.units.length;
    const f = UNIT[c.def].faction;
    if (f !== "hidden") n[f] += c.units.length;
  }
  let top: Faction | null = null;
  for (const f of FACTIONS) if (n[f] > 0 && (!top || n[f] > n[top as "knight"])) top = f;
  b.mono = top;
  b.pureR = top && all ? n[top as "knight"] / all : 0;
  b.pure = pureT(b.pureR);
  b.team =
    (b.pure > 0 ? b.mods.pureBlood : 1) *
    (1 + (b.cx.mono - 1) * b.pure) *
    (kinds === 3 ? b.mods.rainbow * b.cx.tri : 1) *
    b.cx.dmg;
}

/** 사거리 안의 보스 우선, 없으면 가장 많이 간(가장 위험한) 적 */
function target(b: Board, ci: number, range: number): Enemy | null {
  // 심연 변이 「안개」: 사거리 -0.5칸 (1칸 밑으로는 안 줄임)
  if (b.mods.glitch.mut?.includes("fog")) range = Math.max(1, range - 0.5);
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
  let m = upMult(b, def.faction) * b.team * (b.exp ? b.exp.dmg : 1);
  const M = b.mods;
  m *= (1 + LV_DMG * (M.lv[def.id] ?? 0)) * M.relicDmg * M.gritDmg * M.cityDmg;
  if (def.grade >= 4) m *= M.mythDmg;
  if (e.rift) m *= M.riftDmg;
  if (def.faction !== "hidden") m *= M.fac[def.faction];
  const X = b.cx;
  m *= X.fac[def.faction] * (def.grade >= 4 ? X.high : X.low);
  if (e.boss >= 0 || e.elite || e.rift) m *= X.boss * (def.faction === "mech" ? M.mechBoss : 1);
  if (M.warBanner) m *= 1 + M.warBanner * Math.floor((b.up.knight + b.up.mech + b.up.arcane) / 10);
  if (M.vaccine !== 1 && (e.boss >= 0 || e.elite || e.rift)) m *= M.vaccine;
  // 단일 코어: 하나뿐인 신화 · 히든에 힘을 몰아줌
  // 순혈 프로토콜: 가장 많은 세력 비율만큼 그 세력 피해 × (최대 pureDmg)
  if (b.patch === "pure" && b.mono === def.faction) m *= 1 + (TUNE.pureDmg - 1) * b.pure;
  if (e.boss >= 0 && def.boss) m *= def.faction === "hidden" ? 1 + (def.boss - 1) * hiddenFx(b) : def.boss;
  if (def.dtype === "phys") {
    let sz = SIZE_MULT[def.faction][e.size];
    if (def.faction === "knight" && e.size > 0) sz = Math.min(1, sz + M.knightBig);
    m *=
      (e.boss >= 0 ? Math.max(B.bossSizeFloor, sz) : sz) * armorF(e.armor - e.shred) * (1 - e.pres);
  } else m *= 1 - e.mres;
  let dmg = raw * m;
  if (e.shield > 0 && !def.pierce) {
    const s = Math.min(e.shield, dmg);
    e.shield -= s;
    dmg -= s;
  }
  e.hp -= dmg;
  e.last = def.id;
  b.dealt[def.id] = (b.dealt[def.id] ?? 0) + dmg;
  return dmg;
}

/** 유닛 영구 레벨이 버프 · 둔화 · 방어 깎기 · 확률 효과에도 붙는 배수 (레벨당 LV_BUFF) */
const lvBuff = (b: Board, id: string) => 1 + LV_BUFF * (b.mods.lv[id] ?? 0);

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
  if (b.cx.crit && rnd(b.crng) < b.cx.crit) {
    dmg *= 2;
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
      if (p.chance < 1 && rnd(b.rng) >= p.chance * lvBuff(b, def.id)) continue;
      const fx = def.faction === "arcane" ? b.mods.arcaneFx : 1;
      if (p.kind === "stun") stun(t, p.sec);
      else if (p.kind === "slow") {
        const pct = Math.min(B.slowCap, p.pct * fx);
        if (pct >= t.slowP || t.slowT <= 0) {
          t.slowP = pct;
          t.slowT = sec(p.sec);
        }
      } else if (p.kind === "cur" && t.boss < 0 && t.hp > 0) hitRaw(b, def, t, t.hp * p.pct * fx);
    }
  // 처형: 맞은 적 체력이 pct 이하면 바로 쓰러뜨림 (보스 제외)
  if (def.execute && t.hp > 0 && t.boss < 0 && t.hp <= t.max * def.execute * lvBuff(b, def.id)) {
    b.dealt[def.id] = (b.dealt[def.id] ?? 0) + t.hp;
    t.hp = 0;
    t.last = def.id;
  }
  // FORTE 의 오르골: 확률로 궁극기 충전 +1 (낀 판만 난수를 씀)
  if (def.ult && b.mods.ultCharge && rnd(b.rng) < b.mods.ultCharge) u.ult++;
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
    if (boss) hitRaw(b, def, boss, boss.max * U.pct * (def.faction === "hidden" ? hiddenFx(b) : 1));
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
    if (s.kind === "encore") {
      // 앙코르: 체력이 at 밑으로 처음 내려가면 한 번 (sk = -1 이면 이미 씀)
      if (e.sk[k] < 0 || e.hp > e.max * s.at) return;
      e.sk[k] = -1;
      e.hp = Math.min(e.max, e.hp + e.max * s.pct);
      for (const o of b.enemies)
        if (o !== e && o.hp > 0) {
          o.dash = sec(2);
          o.dashMult = 2;
        }
      b.fx?.push({ k: "heal", x: e.x, y: e.y });
      b.ev?.push({ t: "encore" });
      return;
    }
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
      case "warp": {
        // 주사위 눈만큼 앞으로 순간이동
        const roll = rndInt(b.trng, 6) + 1;
        e.d += roll;
        if (e.d >= PERIM) e.d -= PERIM;
        e.trav += roll;
        [e.x, e.y] = pathPos(e.d);
        b.ev?.push({ t: "warp", roll });
        break;
      }
      case "seize": {
        // 가장 높은 건물 (같으면 지난 웨이브에 많이 잡은 칸 · 앞 칸) 하나를 빼앗음
        let best = -1;
        for (let t = 0; t < PERIM; t++) {
          if (!b.bld[t] || b.seized.includes(t)) continue;
          if (best < 0 || b.bld[t] > b.bld[best]) best = t;
        }
        if (best >= 0) {
          b.seized.push(best);
          e.shield += e.max * s.pct;
          b.ev?.push({ t: "seize", tile: best });
        }
        break;
      }
    }
  });
  // 2페이즈 (오염 단계마다 정해진 보스 둘 — PHASE_PAIRS): 체력이 at 밑이면 예고 기술 — 예고 시간 동안 유닛을 옮기면 피함
  const P = def.phase;
  if (P && phaseOn(b.mods.glitch.lv, def.wave)) {
    if (!e.ph && e.hp <= e.max * P.at) {
      e.ph = 1;
      e.sk2 = P.skills.map(() => sec(1.5));
      b.ev?.push({ t: "phase", boss: e.boss });
    }
    if (e.ph)
      P.skills.forEach((s, k) => {
        if (--e.sk2[k] > 0 || b.tele) return;
        e.sk2[k] = sec(s.every);
        if (s.kind !== "tele") return;
        const cells = teleCells(b, s.shape);
        if (cells.length) {
          b.tele = { name: s.name, snd: s.snd, cells, t: sec(s.warn), sec: sec(s.sec) };
          b.ev?.push({ t: "tele", name: s.name, snd: s.snd, hit: null });
        }
      });
  }
  if (b.tele && --b.tele.t <= 0) {
    let hit = 0;
    for (const ci of b.tele.cells) {
      if (!b.cells[ci].def) continue;
      hit++;
      for (const u of b.cells[ci].units) u.stun = Math.max(u.stun, b.tele.sec);
      b.fx?.push({ k: "whip", c: ci });
    }
    b.ev?.push({ t: "tele", name: b.tele.name, snd: b.tele.snd, hit });
    b.tele = null;
  }
}

/** 칸 하나의 세기 어림 (2페이즈 기술이 노릴 곳) — 결정론: 같으면 앞 칸 */
function cellPower(b: Board, i: number): number {
  const c = b.cells[i];
  if (!c.def) return 0;
  const d = UNIT[c.def];
  return d.dmg * d.aps * c.units.length * (d.grade + 1);
}
/** 후보 칸 묶음 중 세기 합이 가장 큰 것 (같으면 앞 — 결정론). 유닛이 하나도 없으면 [] */
function strongest(b: Board, groups: number[][]): number[] {
  let best: number[] = [],
    bv = 0;
  for (const g of groups) {
    let v = 0;
    for (const i of g) v += cellPower(b, i);
    if (v > bv) {
      bv = v;
      best = g;
    }
  }
  return best;
}
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
/** 예고 모양대로 노릴 칸 (유닛이 가장 센 곳) */
export function teleCells(b: Board, shape: TeleShape): number[] {
  const at = (r: number, c: number) => r * COLS + c;
  switch (shape) {
    case "row":
      return strongest(b, range(ROWS).map((r) => range(COLS).map((c) => at(r, c))));
    case "col":
      return strongest(b, range(COLS).map((c) => range(ROWS).map((r) => at(r, c))));
    case "cell":
      return strongest(b, range(CELLS).map((i) => [i]));
    case "two": {
      const one = strongest(b, range(CELLS).map((i) => [i]));
      if (!one.length) return [];
      const two = strongest(b, range(CELLS).filter((i) => i !== one[0]).map((i) => [i]));
      return [...one, ...two];
    }
    case "area":
      return strongest(
        b,
        range(ROWS - 1).flatMap((r) => range(COLS - 1).map((c) => [at(r, c), at(r, c + 1), at(r + 1, c), at(r + 1, c + 1)]))
      );
    case "plus":
      return strongest(
        b,
        range(CELLS).map((i) => {
          const r = Math.floor(i / COLS),
            c = i % COLS;
          const g = [i];
          if (r > 0) g.push(at(r - 1, c));
          if (r < ROWS - 1) g.push(at(r + 1, c));
          if (c > 0) g.push(at(r, c - 1));
          if (c < COLS - 1) g.push(at(r, c + 1));
          return g;
        })
      );
  }
}

/** 처치 처리. 판이 끝나면 true */
function die(g: Game, b: Board, e: Enemy): boolean {
  if (e.last === "~expire") {
    b.ev?.push({ t: "rift", tier: e.rift, ok: false });
    return false;
  }
  if (e.tre) {
    // 보물 골렘: 다음 tick 에 보물방이 끝남 (보상은 판 밖 재화)
    if (b.troom) b.troom.killed = true;
    b.fx?.push({ k: "die", x: e.x, y: e.y, kind: e.kind, boss: true, gold: 0 });
    return false;
  }
  b.kills++;
  // 심연 변이 「분열」: 엘리트 · 대형 적은 체력 30% 짜리 둘로 (분열로 생긴 적 · 보스 · 균열 · 보물은 빼고)
  if (b.mods.glitch.mut?.includes("split") && !e.child && e.boss < 0 && !e.rift && (e.elite || e.size === 2)) {
    for (let k = 0; k < 2; k++) {
      const c = spawn(b, e.kind, 1);
      c.hp = c.max = e.max * 0.3;
      c.armor = e.armor;
      c.mres = e.mres;
      c.size = 1;
      c.child = true;
      c.d = e.d;
      c.trav = e.trav - 0.25 * k;
      c.x = e.x;
      c.y = e.y;
    }
  }
  let gold = 0;
  if (e.rift) {
    const R = B.rift[RIFT_TIERS[e.rift - 1]];
    b.stones += R.stones + b.mods.riftStone;
    gold = R.gold;
    b.rifts++;
    b.ev?.push({ t: "rift", tier: e.rift, ok: true });
  } else if (e.boss >= 0 && b.exp) {
    // 원정: UR 보스 = 원정 성공 · 엘리트 보스 = 남은 적 정리 뒤 유물
    b.tele = null;
    gold = Math.floor((B.bossGold.base + B.bossGold.per * b.wave) * b.mods.bossGold);
    b.free += b.mods.bossFree;
    b.stones += B.bossStones;
    b.ev?.push({ t: "bossDown", boss: e.boss, gold, stones: B.bossStones, ticket: null });
    if (b.exp.node === "boss") {
      b.gold += gold;
      finish(g, b, true, "clear");
      return true;
    }
    b.exp.eliteWon = true;
    expSegEnd(b);
  } else if (e.boss >= 0) {
    b.tele = null;
    b.seized = [];
    gold = Math.floor((B.bossGold.base + B.bossGold.per * b.wave) * b.mods.bossGold);
    b.free += b.mods.bossFree;
    const stones = B.bossStones + Math.floor(b.wave / 20) + (b.patch === "gambler" ? 1 : 0) + b.cx.bossStones;
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
    offerCheat(b);
  } else {
    gold = B.killGold + Math.floor(b.wave / B.killGoldPer) + b.mods.killGold;
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

/* ───────────────────────── 치트 코드 ───────────────────────── */

/** 카드 한 장 뽑기 (등급 → 그 등급에서 아직 안 고르고 지금 안 보이는 것). 없으면 아래 등급 */
function drawCheat(b: Board, shown: readonly string[]): string | null {
  const odds = cheatOdds(b.cheats.length, b.mods.cheatLuck);
  const r = rnd(b.crng) * 100;
  let tier = 0,
    acc = 0;
  for (let i = 0; i < odds.length; i++) {
    acc += odds[i];
    if (r < acc) {
      tier = i;
      break;
    }
  }
  for (let t = tier; t >= 0; t--) {
    const pool = CHEATS.filter((c) => c.tier === t && !b.cheats.includes(c.id) && !shown.includes(c.id));
    if (pool.length) return pool[rndInt(b.crng, pool.length)].id;
  }
  const any = CHEATS.filter((c) => !b.cheats.includes(c.id) && !shown.includes(c.id));
  return any.length ? any[rndInt(b.crng, any.length)].id : null;
}

/** 보스를 잡으면 (10 · 20 · 30 · 40 · 50) 카드 3장을 놓고 보드를 멈춤 */
function offerCheat(b: Board) {
  if (!(CHEAT_WAVES as readonly number[]).includes(b.wave)) return;
  const offer: string[] = [];
  for (let i = 0; i < CHEAT_OFFER; i++) {
    const id = drawCheat(b, offer);
    if (id) offer.push(id);
  }
  if (!offer.length) return;
  b.cheat = { kind: "cheat", offer, rr: offer.map(() => b.mods.cheatReroll), t: 0 };
  b.ev?.push({ t: "cheatOffer" });
}

function takeCheat(b: Board, id: string, auto: boolean) {
  if (b.cheat?.kind === "patch") {
    // 시작 치트 = 패치 (연합 · 도박사 · 단일 코어 · 이자) — 동작은 예전 패치 그대로
    if (!PATCHES.some((p) => p.id === id)) return;
    b.cheat = null;
    b.patch = id;
    // 도박사: 고르는 순간 행운석 +3 (도박이 5웨이브부터라 시작 밑천)
    if (id === "gambler") b.stones += 3;
    b.ev?.push({ t: "patch", id, auto });
    return;
  }
  const c = CHEAT[id];
  b.cheat = null;
  if (!c) return;
  b.cheats.push(id);
  b.cx = cheatFxOf(b.cheats);
  b.dirty = true;
  const n = c.now;
  if (n) {
    b.gold += (n.gold ?? 0) + (n.goldPerWave ?? 0) * b.wave;
    b.stones += n.stones ?? 0;
    b.free += n.free ?? 0;
    if (n.tickets) b.tickets.push(...n.tickets);
    if (n.ups)
      for (const k of ["knight", "mech", "arcane"] as const) b.up[k] = Math.min(B.up.max, b.up[k] + n.ups);
  }
  b.ev?.push({ t: "cheat", id, auto });
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
    mix(b.cheats.length);
    mix(b.pos);
    if (b.exp) {
      mix(b.exp.cap);
      mix(b.exp.segs);
      mix(b.exp.relics.length);
    }
    for (const e of b.enemies) mix(e.hp);
  }
  return h >>> 0;
}
