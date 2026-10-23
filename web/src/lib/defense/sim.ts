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
import { MISSIONS, PATCHES, patchesFor } from "./meta";
import { ENGRAVES, type EngrId } from "./engrave";
import { mixSeed, pick, rnd, rndInt, type Rng } from "./rng";
import { BENCH_MAX, LV_BUFF, LV_DMG, modsOf, type Loadout, type Mods, type Stage } from "./progress";
import { EVENTS, EXP, EXP_RELICS, FIGHT_MOD, GIM, OATH_P, SHOP, SQUADS, ascOn, type EventId, type ExpNode, type FightMod, type Gim, type ShopKind } from "./town";
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
  /** 공격 수 (각인 「치명 리듬」) */
  n?: number;
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
  /** 글리치 원정: 기믹 엘리트 종류 · 기술 시계 · 분열 깊이 · 보스가 빼앗은 골드 */
  gim: Gim | "";
  gt: number;
  gd: number;
  loot: number;
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
  /** 글리치 원정: 캠프에서 고르기 (분대 · 지도 칸 · 드래프트 · 유물 · 상점 물건 · 휴식 · 이벤트 선택지 — 번호, -1 = 건너뛰기 · 나가기) */
  | { t: "exp"; a: number };

/** 글리치 원정 지도 칸 (층마다 몇 개 · next = 위층 이어진 칸 번호) */
export interface ExpMapNode {
  lane: number;
  kind: ExpNode;
  mod: FightMod | null;
  gim: Gim | null;
  next: number[];
}
/** 글리치 원정 캠프 (고르는 동안 시간이 멈춤) */
export type ExpCamp =
  | { k: "squad"; opts: string[] }
  | { k: "map" }
  | { k: "draft"; offer: string[]; next: "map" | "relic" }
  | { k: "relic"; offer: string[] }
  | { k: "shop"; items: { kind: ShopKind; cost: number; sold: boolean }[] }
  | { k: "rest" }
  | { k: "event"; id: EventId }
  /** 1막 보스를 잡음 → 귀환 or 2막 */
  | { k: "act" };
export interface ExpState {
  hp: number;
  max: number;
  /** 지금 칸 (층 · 그 층 번호, 출발 전 -1) */
  f: number;
  i: number;
  map: ExpMapNode[][];
  /** 꼭대기 보스 (BOSSES 번호) */
  boss: number;
  squad: string | null;
  relics: string[];
  curses: string[];
  node: ExpNode | null;
  mod: FightMod | null;
  /** camp(고르기) → waves(웨이브) → clean(정리 시간) · boss(보스) */
  stage: "camp" | "waves" | "clean" | "boss";
  segStart: number;
  segEnd: number;
  cleanT: number;
  /** 기믹 엘리트가 나왔나 · 도망친 수 */
  gimOut: boolean;
  gimEsc: number;
  /** 이번 전투 보상 배수 (함정 2) */
  reward: number;
  camp: ExpCamp | null;
  /** 피의 계약 등 피해 배수 · 응급 키트 썼나 */
  dmg: number;
  kit: boolean;
  /** 지나온 칸 (층마다 고른 번호) */
  trail: number[];
  /** 막 (1 · 2) · 잡은 원정 보스 (fighter id) · 한 번 쓰는 유물 (phoenix) */
  act: number;
  kills: string[];
  used: string[];
  /** 드래프트로 고른 유닛 (판이 끝나면 메인 카드로) */
  picked: string[];
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
  | { t: "unit"; def: string; how: "summon" | "merge" | "gamble" | "recipe" | "pick" | "twin" | "relic" }
  | { t: "gambleFail"; g: "E" | "L"; refund: boolean }
  /** 유물 규칙이 터짐 (전쟁 깃발 공짜 강화 · 신화의 인장 재료 돌려받기) */
  | { t: "relicProc"; id: string }
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
  /** 글리치 원정: 칸 이동 · 전투 끝 (남은 적 leak 만큼 체력 · 엘리트를 잡았나) · 골드를 빼앗김 */
  | { t: "expGo"; f: number; i: number; node: ExpNode }
  | { t: "expEnd"; node: ExpNode; leak: number; hp: number; won: boolean; gold: number }
  | { t: "expSteal"; gold: number }
  | { t: "expRevive" }
  | { t: "expAct" }
  | { t: "dice"; n: number }
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
  reason: "clear" | "cap" | "boss" | "quit" | "act2";
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
  /** 무지개 프리즘: 다음 무지개 소환까지 센 소환 수 */
  rbow: number;
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
  /** 칸별 피해 버프 (UnitDef.buff — 여러 기가 겹침, 배치가 바뀌면 다시 계산) */
  dbuf: number[];
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
    rbow: 0,
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
    dbuf: new Array(CELLS).fill(0),
    mods,
    // 시작 치트: 패치 4개 중 하나 (고를 때까지 멈춤, 다시 뽑기 없음)
    cheat: { kind: "patch", offer: patchesFor(mods.patches), rr: patchesFor(mods.patches).map(() => 0), t: 0 },
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
  Math.max(1, Math.min(B.summon.max, B.summon.base + B.summon.step * b.summons) - b.mods.summonDisc - b.cx.summonDisc) +
  (b.exp ? 5 * b.exp.curses.filter((c) => c === "heavy").length : 0);
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
/* ───────────────────────── 글리치 원정 ───────────────────────── */

export const expHas = (b: Board, id: string) => !!b.exp?.relics.includes(id);
const expAsc = (b: Board, lv: number) => !!b.exp && ascOn(b.mods.town, lv);
const MODS: FightMod[] = ["swarm", "armor", "rush", "gold", "split"];
const GIMS: Gim[] = ["thief", "healer", "golem", "mirror"];

/** 지도 만들기 (판 시드 → 늘 같은 지도): EXP.floors 층 + 보스 층 */
function genMap(b: Board): ExpMapNode[][] {
  const r = b.trng;
  const F = EXP.floors;
  const eliteW = ascOn(b.mods.town, 7) ? 26 : 16;
  const map: ExpMapNode[][] = [];
  for (let f = 0; f < F; f++) {
    const lanes = [0, 1, 2, 3];
    const n = 3 + rndInt(r, 2);
    while (lanes.length > n) lanes.splice(rndInt(r, lanes.length), 1);
    map.push(
      lanes.map((lane) => {
        let kind: ExpNode = "fight";
        if (f === 3) kind = "treasure";
        else if (f === F - 1) kind = "rest";
        else if (f > 0) {
          const w: [ExpNode, number][] = [
            ["fight", 45],
            ["event", 22],
            ["elite", f >= 2 ? eliteW : 0],
            ["shop", 10],
            ["rest", f >= 3 ? 8 : 0],
          ];
          let t = rndInt(r, w.reduce((m, x) => m + x[1], 0));
          for (const [k, v] of w) {
            if (t < v) {
              kind = k;
              break;
            }
            t -= v;
          }
        }
        const mod = kind === "fight" && f >= 1 && rndInt(r, 2) === 0 ? MODS[rndInt(r, MODS.length)] : null;
        const gim = kind === "elite" ? GIMS[rndInt(r, GIMS.length)] : null;
        return { lane, kind, mod, gim, next: [] as number[] };
      })
    );
  }
  for (let f = 0; f < F - 1; f++) {
    const A = map[f],
      N = map[f + 1];
    for (const a of A) {
      const near = N.map((x, j) => (Math.abs(x.lane - a.lane) <= 1 ? j : -1)).filter((j) => j >= 0);
      if (!near.length) {
        let best = 0;
        N.forEach((x, j) => {
          if (Math.abs(x.lane - a.lane) < Math.abs(N[best].lane - a.lane)) best = j;
        });
        near.push(best);
      }
      const k = near.length >= 2 && rndInt(r, 2) === 0 ? 2 : 1;
      while (a.next.length < k && near.length) a.next.push(near.splice(rndInt(r, near.length), 1)[0]);
      a.next.sort((p, q) => p - q);
    }
    N.forEach((x, j) => {
      if (A.some((a) => a.next.includes(j))) return;
      let best = 0;
      A.forEach((a, i) => {
        if (Math.abs(a.lane - x.lane) < Math.abs(A[best].lane - x.lane)) best = i;
      });
      A[best].next.push(j);
      A[best].next.sort((p, q) => p - q);
    });
  }
  for (const a of map[F - 1]) a.next = [0];
  map.push([{ lane: 1.5, kind: "boss", mod: null, gim: null, next: [] }]);
  return map;
}
/** 지금 갈 수 있는 위층 칸 번호 */
export function expNext(b: Board): number[] {
  const x = b.exp;
  if (!x) return [];
  if (x.f < 0) return x.map[0].map((_, j) => j);
  return x.map[x.f]?.[x.i]?.next ?? [];
}
/** 원정 시작: 분대 고르기부터 */
function expInit(b: Board) {
  b.phase = "break";
  b.wt = 0;
  const max = EXP.hp - (ascOn(b.mods.town, 6) ? 6 : 0);
  b.exp = {
    hp: max,
    max,
    f: -1,
    i: -1,
    map: [],
    boss: 0,
    squad: null,
    relics: [],
    curses: ascOn(b.mods.town, 3) ? ["corrode"] : [],
    node: null,
    mod: null,
    stage: "camp",
    segStart: 0,
    segEnd: 0,
    cleanT: 0,
    gimOut: false,
    gimEsc: 0,
    reward: 1,
    camp: null,
    dmg: 1,
    kit: false,
    trail: [],
    act: 1,
    kills: [],
    used: [],
    picked: [],
  };
  b.gold += b.mods.expGold;
  b.exp.map = genMap(b);
  b.exp.boss = BOSSES.indexOf(TOWN_BOSSES[rndInt(b.trng, TOWN_BOSSES.length)]);
  const opts = SQUADS.map((q) => q.id as string).filter((id) => b.mods.squads.includes(id));
  b.exp.camp = { k: "squad", opts: opts.length ? opts : ["knight"] };
}
function toMap(b: Board) {
  const x = b.exp!;
  x.stage = "camp";
  x.node = null;
  x.mod = null;
  x.camp = { k: "map" };
  b.phase = "break";
}
/** 전쟁 깃발: 그 세력 강화 레벨이 before → 지금 사이에 N 의 배수를 넘은 만큼 그 세력 레전드 (2026-10-23: 세 세력 합 → 세력마다) */
function warTick(b: Board, before: number, faction: Faction) {
  const N = b.mods.warEvery;
  if (!N || faction === "hidden") return;
  const now = b.up[faction];
  for (let k = Math.floor(before / N); k < Math.floor(now / N); k++) {
    relicLegend(b, faction);
    b.ev?.push({ t: "relicProc", id: "war_banner" });
  }
}
/** 유물이 주는 레전드 1기 — 필드 빈 칸이 있으면 거기로 (보관함에 들어가면 안 싸워서), 없으면 그 세력 가장 낮은 필드 칸 한 등급 업 */
function relicLegend(b: Board, faction: Faction) {
  let free = false;
  for (let i = 0; i < CELLS && !free; i++) if (!b.cells[i].def) free = true;
  if (free) give(b, pick(b.rng, poolOf(faction, 3)).id, "relic");
  else expGrow(b, faction);
}
/** 가장 낮은 등급 필드 유닛 칸 (faction 이면 그 세력만) 을 한 등급 올림 — 레전드까지 */
function expGrow(b: Board, faction?: Faction) {
  let best = -1;
  for (let i = 0; i < CELLS; i++) {
    const d = b.cells[i].def ? UNIT[b.cells[i].def!] : null;
    if (!d || d.grade >= 3 || d.faction === "hidden" || (faction && d.faction !== faction)) continue;
    if (best < 0 || d.grade < UNIT[b.cells[best].def!].grade) best = i;
  }
  if (best < 0) return;
  const d = UNIT[b.cells[best].def!];
  b.cells[best].def = pick(b.trng, poolOf(d.faction, (d.grade + 1) as Grade)).id;
  b.dirty = true;
  b.fx?.push({ k: "spawn", c: best, g: d.grade + 1 });
}
function relicOffer(b: Board, n = expHas(b, "hunter") ? 4 : 3): string[] {
  const pool = EXP_RELICS.filter((r) => !r.start && !b.exp!.relics.includes(r.id) && (!r.need || b.mods.expSeen.length >= r.need)).map((r) => r.id);
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(rndInt(b.trng, pool.length), 1)[0]);
  return out;
}
function takeRelic(b: Board, id: string) {
  const x = b.exp!;
  x.relics.push(id);
  if (id === "blood") {
    x.max = Math.max(1, x.max - 10);
    x.hp = Math.min(x.hp, x.max);
    x.dmg *= 1.35;
  }
  if (id === "glass") x.dmg *= 1.6;
}
/** 원정 체력 깎임 (응급 키트) */
function expHurt(b: Board, n: number) {
  const x = b.exp!;
  x.hp = Math.max(0, Math.min(x.max, x.hp - n));
  if (expHas(b, "kit") && !x.kit && x.hp > 0 && x.hp < 10) {
    x.kit = true;
    x.hp = Math.min(x.max, x.hp + 15);
  }
  if (x.hp <= 0 && expHas(b, "phoenix") && !x.used.includes("phoenix")) {
    x.used.push("phoenix");
    x.hp = Math.ceil(x.max / 2);
    b.ev?.push({ t: "expRevive" });
  }
}
/** 무작위 세력(또는 faction) · 등급 유닛 하나 (자리 있으면) */
function giveRandom(b: Board, grade: Grade, faction?: Faction) {
  if (!hasEmpty(b)) return;
  give(b, pick(b.trng, poolOf(faction ?? pick(b.trng, FACTIONS), grade)).id, "pick");
}
function pickSquad(b: Board, id: string) {
  const x = b.exp!;
  const f = id as Faction;
  x.squad = id;
  for (let k = 0; k < 2; k++) giveRandom(b, 1, f);
  for (let k = 0; k < 3; k++) giveRandom(b, 0, f);
  const sq = SQUADS.find((q) => q.id === id);
  if (sq) x.relics.push(sq.relic);
  toMap(b);
}
/** 전투 · 엘리트 시작 (층에 맞는 웨이브부터) */
function startFight(b: Board, kind: "fight" | "elite", gim: Gim | null) {
  const x = b.exp!;
  x.stage = "waves";
  x.camp = null;
  x.gimOut = false;
  x.gimEsc = 0;
  const base = EXP.waveBase - 1 + EXP.waveFloor * Math.max(0, x.f) + (x.act - 1) * EXP.act2Wave;
  b.wave = base;
  x.segStart = base + 1;
  x.segEnd = base + (kind === "elite" ? EXP.eliteWaves : EXP.fightWaves);
  if (expHas(b, "sq_knight")) b.free += 2;
  if (expHas(b, "sq_arcane")) expGrow(b, "arcane");
  startWave(b, base + 1);
  if (kind === "elite" && gim) {
    const G = GIM[gim];
    const e = spawn(b, kindOfWave(b.wave), hpOf(b.wave) * G.hp * (expAsc(b, 2) ? 1.3 : 1));
    e.elite = true;
    e.gim = gim;
    e.size = G.size;
    e.spd *= G.spd;
    if (gim === "mirror") e.pres = 0.5;
    x.gimOut = true;
  }
}
function startBoss(b: Board) {
  const x = b.exp!;
  x.stage = "boss";
  x.camp = null;
  b.wave = x.act > 1 ? EXP.act2Boss : EXP.bossWave;
  b.wt = 0;
  b.phase = "boss";
  b.bossT = sec(bossSecOf(b));
  b.ev?.push({ t: "wave", wave: b.wave });
  spawnBoss(b, BOSSES[x.boss]);
  if (expAsc(b, 5)) {
    const e = b.enemies[b.enemies.length - 1];
    e.hp = e.max = e.max * 1.25;
  }
}
/** 지도에서 위층 칸 j 로 */
function expGoto(b: Board, j: number) {
  const x = b.exp!;
  x.f++;
  x.i = j;
  x.trail.push(j);
  const n = x.map[x.f][j];
  x.node = n.kind;
  x.mod = n.mod;
  x.reward = 1;
  b.ev?.push({ t: "expGo", f: x.f, i: j, node: n.kind });
  if (n.kind === "fight" || n.kind === "elite") return startFight(b, n.kind, n.gim);
  if (n.kind === "boss") return startBoss(b);
  x.stage = "camp";
  if (n.kind === "shop") {
    const kinds: ShopKind[] = ["heal", "free", "epic", "legend", "relic", "up"];
    const k = (1 + 0.08 * x.f) * (expAsc(b, 4) ? 1.2 : 1) * (expHas(b, "goldhand") ? 0.8 : 1);
    const items: { kind: ShopKind; cost: number; sold: boolean }[] = [];
    if (x.curses.length) items.push({ kind: "uncurse", cost: Math.round(SHOP.uncurse.cost * k), sold: false });
    while (items.length < 5 && kinds.length) {
      const kd = kinds.splice(rndInt(b.trng, kinds.length), 1)[0];
      items.push({ kind: kd, cost: Math.round(SHOP[kd].cost * k), sold: false });
    }
    x.camp = { k: "shop", items };
  } else if (n.kind === "rest") x.camp = { k: "rest" };
  else if (n.kind === "event") {
    const ids = Object.keys(EVENTS) as EventId[];
    x.camp = { k: "event", id: ids[rndInt(b.trng, ids.length)] };
  } else {
    const offer = relicOffer(b);
    if (offer.length) x.camp = { k: "relic", offer };
    else toMap(b);
  }
}
/** 전투 칸 마지막 웨이브가 끝남 → 정리 시간 */
function expWavesDone(b: Board) {
  const x = b.exp!;
  x.stage = "clean";
  x.cleanT = sec(EXP.cleanSec);
  b.phase = "break";
  b.wt = 0;
}
/** 전투 칸 끝: 남은 적만큼 원정 체력 · 유물 효과 · 보상 · 드래프트 */
/** 지금 끝나면 깎일 원정 체력 (화면 미리보기 · 전투 끝 같은 식) */
export function expLeak(b: Board): { leak: number; gimLeft: number } {
  let leak = 0,
    gimLeft = 0;
  for (const e of b.enemies) {
    if (e.boss >= 0 || e.rift || e.hp <= 0) continue;
    if (e.gim) gimLeft++;
    else leak += e.elite ? EXP.leakElite : EXP.leak;
  }
  if (expAsc(b, 8)) leak *= 1.5;
  if (expHas(b, "iron")) leak /= 2;
  if (expHas(b, "glass")) leak *= 2;
  return { leak: Math.min(EXP.leakMax, Math.ceil(leak)) + gimLeft * EXP.gimEscape, gimLeft };
}
function expSegEnd(g: Game, b: Board) {
  const x = b.exp!;
  const { leak, gimLeft } = expLeak(b);
  const node = x.node!;
  const won = node === "elite" && x.gimOut && gimLeft === 0 && x.gimEsc === 0;
  b.enemies = [];
  b.tele = null;
  if (leak > 0) expHurt(b, leak);
  else if (expHas(b, "vamp")) x.hp = Math.min(x.max, x.hp + 3);
  const gold = Math.round(((node === "elite" ? EXP.eliteGold : EXP.fightGold) + EXP.floorGold * (Math.max(0, x.f) + (x.act - 1) * EXP.floors)) * x.reward);
  b.ev?.push({ t: "expEnd", node, leak, hp: x.hp, won, gold });
  if (x.hp <= 0) return finish(g, b, false, "cap");
  b.gold += gold;
  x.reward = 1;
  if (expHas(b, "growth")) expGrow(b);
  if (expHas(b, "piggy")) b.gold += Math.min(120, Math.floor(b.gold * 0.2));
  // 드래프트: 세력마다 하나 (+전리품 가방) · 층이 높을수록 높은 등급 · 엘리트는 한 등급 위
  const gr = Math.min(3, (x.f <= 1 ? 1 : x.f <= 4 ? 2 : 3) + (node === "elite" ? 1 : 0) + (x.act - 1)) as Grade;
  const fs = [...FACTIONS];
  const offer: string[] = [];
  while (fs.length) offer.push(pick(b.trng, poolOf(fs.splice(rndInt(b.trng, fs.length), 1)[0], gr)).id);
  if (expHas(b, "bag")) offer.push(pick(b.trng, poolOf(pick(b.trng, FACTIONS), gr)).id);
  x.stage = "camp";
  x.mod = null;
  b.phase = "break";
  x.camp = { k: "draft", offer, next: won ? "relic" : "map" };
}
/** 기믹 엘리트 매 tick */
function gimTick(b: Board, e: Enemy) {
  if (e.gim === "thief") {
    if (e.trav >= PERIM) {
      const s = Math.min(150, Math.floor(b.gold * 0.25));
      b.gold -= s;
      e.hp = 0;
      e.last = "~escape";
      if (b.exp) b.exp.gimEsc++;
      b.ev?.push({ t: "expSteal", gold: s });
    }
  } else if (e.gim === "healer") {
    if (++e.gt >= sec(3)) {
      e.gt = 0;
      for (const o of b.enemies)
        if (o !== e && o.boss < 0 && o.hp > 0 && (o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= 4) o.hp = Math.min(o.max, o.hp + o.max * 0.06);
      b.fx?.push({ k: "heal", x: e.x, y: e.y });
    }
  } else if (e.gim === "mirror") {
    if (++e.gt >= sec(6)) {
      e.gt = 0;
      e.shield = Math.min(e.max * 0.4, e.shield + e.max * 0.2);
    }
  }
}
/** 캠프에서 고르기 (명령 exp) */
function expPick(g: Game, b: Board, a: number): string | null {
  const x = b.exp!;
  const c = x.camp!;
  switch (c.k) {
    case "squad": {
      const id = c.opts[a];
      if (!id) return "없는 분대예요";
      pickSquad(b, id);
      return null;
    }
    case "map": {
      if (!expNext(b).includes(a)) return "갈 수 없는 칸이에요";
      expGoto(b, a);
      return null;
    }
    case "draft": {
      if (a >= 0) {
        const id = c.offer[a];
        if (!id) return "없는 카드예요";
        if (!hasEmpty(b) && !b.cells.some((s) => s.def === id && s.units.length < STACK)) return "빈 칸이 없어요 — 팔거나 합성하고 골라요";
        give(b, id, "pick");
        x.picked.push(id);
        if (expHas(b, "echo") && hasEmpty(b)) give(b, id, "pick");
      } else b.gold += EXP.skipGold;
      if (c.next === "relic") {
        const offer = relicOffer(b);
        if (offer.length) {
          x.camp = { k: "relic", offer };
          return null;
        }
      }
      toMap(b);
      return null;
    }
    case "relic": {
      if (a >= 0) {
        const id = c.offer[a];
        if (!id) return "없는 유물이에요";
        takeRelic(b, id);
      }
      toMap(b);
      return null;
    }
    case "shop": {
      if (a < 0) {
        toMap(b);
        return null;
      }
      const it = c.items[a];
      if (!it || it.sold) return "이미 산 물건이에요";
      if (b.gold < it.cost) return "골드가 모자라요";
      if ((it.kind === "epic" || it.kind === "legend") && !hasEmpty(b)) return "빈 칸이 없어요";
      if (it.kind === "relic" && !relicOffer(b, 1).length) return "더 받을 유물이 없어요";
      if (it.kind === "heal" && x.hp >= x.max) return "체력이 가득해요";
      if (it.kind === "uncurse" && !x.curses.length) return "저주가 없어요";
      b.gold -= it.cost;
      it.sold = true;
      if (it.kind === "heal") x.hp = Math.min(x.max, x.hp + 8);
      else if (it.kind === "free") b.free += 3;
      else if (it.kind === "epic") giveRandom(b, 2);
      else if (it.kind === "legend") giveRandom(b, 3);
      else if (it.kind === "relic") takeRelic(b, relicOffer(b, 1)[0]);
      else if (it.kind === "uncurse") x.curses.pop();
      else {
        const f = (["knight", "mech", "arcane"] as const).reduce((m, k) => (b.up[k] < b.up[m] ? k : m), "knight" as "knight" | "mech" | "arcane");
        b.up[f] = Math.min(B.up.max, b.up[f] + 2);
      }
      return null;
    }
    case "rest": {
      if (a === 1) expGrow(b);
      else x.hp = Math.min(x.max, x.hp + Math.ceil(x.max * EXP.restHeal * (expAsc(b, 9) ? 0.5 : 1)));
      toMap(b);
      return null;
    }
    case "act": {
      if (a === 0) {
        finish(g, b, true, "clear");
        return null;
      }
      if (a !== 1) return "고를 수 없는 선택지예요";
      // 2막: 새 지도 · 다른 보스 · 체력 조금 회복 (유닛 · 유물 · 골드는 그대로)
      x.act = 2;
      x.f = -1;
      x.i = 0;
      x.trail = [];
      x.map = genMap(b);
      const rest = TOWN_BOSSES.filter((d) => BOSSES.indexOf(d) !== x.boss);
      x.boss = BOSSES.indexOf(rest[rndInt(b.trng, rest.length)]);
      x.hp = Math.min(x.max, x.hp + EXP.act2Heal);
      b.enemies = [];
      b.tele = null;
      b.ev?.push({ t: "expAct" });
      toMap(b);
      return null;
    }
    case "event": {
      if (a !== 0 && a !== 1) return "고를 수 없는 선택지예요";
      switch (c.id) {
        case "vend":
          if (a === 0) {
            if (b.gold < 60) return "골드가 모자라요";
            if (!hasEmpty(b)) return "빈 칸이 없어요";
            b.gold -= 60;
            giveRandom(b, rnd(b.trng) < 0.3 ? 3 : 2);
          }
          break;
        case "merc":
          if (a === 0) {
            if (!hasEmpty(b)) return "빈 칸이 없어요";
            giveRandom(b, 1);
            giveRandom(b, 1);
          } else b.gold += 100;
          break;
        case "altar":
          if (a === 0) {
            const o = relicOffer(b, 1);
            x.curses.push("corrode");
            if (o.length) takeRelic(b, o[0]);
          }
          break;
        case "spring":
          if (a === 0) {
            if (x.hp <= 8) return "원정 체력이 모자라요";
            expHurt(b, 8);
            expGrow(b);
            expGrow(b);
          } else x.hp = Math.min(x.max, x.hp + 6);
          break;
        case "trap":
          if (a === 0) {
            x.node = "fight";
            startFight(b, "fight", null);
            x.mod = "swarm";
            x.reward = 2;
            return null;
          }
          expHurt(b, 6);
          if (x.hp <= 0) {
            finish(g, b, false, "cap");
            return null;
          }
          break;
        case "rat":
          if (a === 0) {
            const bet = Math.floor(b.gold / 2);
            b.gold += rnd(b.trng) < 0.5 ? bet : -bet;
          }
          break;
      }
      toMap(b);
      return null;
    }
  }
}
/** 원정 전투 웨이브 적 수 (수식어) */
export const waveCount = (b: Board) => {
  const n = countOf(b.wave);
  const m = b.exp?.mod ? FIGHT_MOD[b.exp.mod].count : 1;
  return Math.max(1, Math.round(n * m));
};
/** 패배 기준 적 수 */
export const capOf = (b: Board) => CAP + b.cx.cap;
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
 * @3:세력(아무 그 세력 레전드)은 반대로 많이 쌓인 칸부터 (남는 레전드 정리).
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
      // @3:세력(키메라 짬처리)은 가장 많이 쌓인 칸부터 — 낱개는 신화 재료로 남겨 둠
      const spare = n.includes(":");
      if (best < 0 || (spare ? left[i] > left[best] : left[i] < left[best])) best = i;
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
      // 무지개 프리즘: N번째 소환은 에픽 이상 확정 (확률로 레전드)
      if (b.mods.rainbowEvery && ++b.rbow >= b.mods.rainbowEvery) {
        b.rbow = 0;
        const rg = rnd(b.rng) < b.mods.rainbowLeg ? 3 : 2;
        if (rg > grade) grade = rg;
        b.ev?.push({ t: "relicProc", id: "rainbow" });
      }
      // 원정 유물 「서약」: OATH_P 확률로 그 세력 (2026-10-22: 늘 → 확률, 한 세력만 나와 신화 20기씩 쌓이던 것)
      // 유물 「순수 혈통」: 확률로 필드에서 가장 많은 세력 (낀 판만 난수를 씀)
      const oath = b.exp ? FACTIONS.find((f) => expHas(b, `oath_${f}`)) : undefined;
      let fac: Faction | undefined = oath && rnd(b.rng) < OATH_P ? oath : undefined;
      if (!fac && b.mods.pureSteer && b.mono && rnd(b.rng) < b.mods.pureSteer) fac = b.mono;
      const def = pick(b.rng, poolOf(fac ?? pick(b.rng, FACTIONS), grade as Grade));
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
      const up2 = (expHas(b, "alch") && d.grade + 2 <= 3 && rnd(b.trng) < 0.25) || (egv(b, d.id, "fuse") > 0 && d.grade + 2 <= 3 && rnd(b.rng) < egv(b, d.id, "fuse") / 100);
      const next = pick(b.rng, poolOf(d.faction, (d.grade + (up2 ? 2 : 1)) as Grade));
      give(b, next.id, "merge", cmd.c);
      // 시작 치트 「분열 프로토콜」: 25% 같은 유닛 하나 더
      if (b.patch === "split" && hasEmpty(b) && rnd(b.crng) < 0.35) give(b, next.id, "merge");
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
      // MOA 의 명함: 에픽 이하를 팔면 확률로 같은 등급 무작위 유닛
      if (b.mods.moaReroll && d.grade <= 2 && d.faction !== "hidden" && hasEmpty(b) && rnd(b.rng) < b.mods.moaReroll)
        give(b, pick(b.rng, poolOf(pick(b.rng, FACTIONS), d.grade as Grade)).id, "relic");
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
      const upBefore = b.up[cmd.k];
      b.up[cmd.k]++;
      if (cmd.k !== "hidden") warTick(b, upBefore, cmd.k);
      if (cmd.k === "hidden") b.dirty = true; // 키메라 버프가 히든 강화를 받음
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
      // 신화의 인장: 재료 중 가장 높은 등급 하나를 확률로 돌려받음
      let top: string | null = null;
      for (const i of plan) {
        const c = b.cells[i];
        if (c.def && (!top || UNIT[c.def].grade > UNIT[top].grade)) top = c.def;
        c.units.pop();
        if (!c.units.length) c.def = null;
      }
      b.dirty = true;
      give(b, r.id, "recipe");
      if (top && b.mods.sealRefund && hasEmpty(b) && rnd(b.rng) < b.mods.sealRefund) {
        give(b, top, "relic");
        b.ev?.push({ t: "relicProc", id: "myth_seal" });
      }
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
      return expPick(g, b, cmd.a);
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
  how: "summon" | "merge" | "gamble" | "recipe" | "pick" | "twin" | "relic",
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
  c.units.push({ cd: 0, ult: 0, stun: 0, n: 0 });
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
  // 각인 「분신」: 같은 유닛 하나 더
  const et = egv(b, id, "twin");
  if (et && how !== "twin" && hasEmpty(b) && rnd(b.rng) < et / 100) give(b, id, "twin");
}

/** 이 유닛 종류의 각인이 kind 면 그 수치 (아니면 0) */
function egv(b: Board, id: string, kind: EngrId): number {
  const g = b.mods.engr[id];
  return g && g.e === kind ? ENGRAVES[kind].val[g.t] : 0;
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
  // 원정: 전투 수식어 · 저주 「부식」
  const M = b.exp?.mod ? FIGHT_MOD[b.exp.mod] : null;
  if (b.exp) hp *= (M ? M.hp : 1) * 1.1 ** b.exp.curses.filter((c) => c === "corrode").length;
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
    gim: "",
    gt: 0,
    gd: 0,
    loot: 0,
    last: "",
  };
  if (M) {
    e.spd *= M.spd;
    e.armor = Math.round(e.armor * M.armor);
  }
  b.enemies.push(e);
  return e;
}

function spawnBoss(b: Board, def: BossDef) {
  const w = b.wave;
  const e = spawn(b, "slime", hpOf(w) * B.bossHp * def.hp * b.mods.glitch.boss * (!b.exp && w >= LAST_WAVE ? B.finalBossHp : 1));
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
  // 원정 2막에서 쓰러져도 1막 클리어는 인정
  if (!win && b.exp && b.exp.act >= 2) {
    win = true;
    reason = "act2";
  }
  b.result = { win, wave: b.wave, tick: g.tick, kills: b.kills, reason };
  b.phase = "over";
  b.ev?.push({ t: "over", win });
}

/** 다음 웨이브를 부를 수 없는 이유 (부를 수 있으면 null) — 준비 시간 · 적이 다 나온 일반 웨이브 · 보스 뒤 쉬는 시간 */
export function nextBlock(b: Board): string | null {
  if (b.result) return "끝난 판이에요";
  if (b.phase === "treasure") return "보물방이 끝나야 넘어가요";
  if (b.phase === "boss") return "보스를 잡아야 넘어가요";
  if (b.exp && b.exp.stage !== "waves") return b.exp.stage === "clean" ? "남은 적을 정리하는 중이에요" : "갈 길을 먼저 골라요";
  if (b.phase === "wave" && b.spawned < waveCount(b)) return "이번 웨이브 적이 아직 나오는 중이에요";
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
  // 시작 치트 「주사위 프로토콜」
  if (b.patch === "dice") {
    const n = 1 + rndInt(b.crng, 6);
    // 2026-10-21 체감이 약하다는 말 → 눈 × 15 골드 · 6이면 무료 소환 4 + 행운석 1
    b.gold += n * 15;
    if (n === 6) {
      b.free += 4;
      b.stones += 1;
    }
    b.ev?.push({ t: "dice", n });
  }
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
    (B.waveGold.base + B.waveGold.per * b.wave) * b.mods.waveGold * b.cx.waveGold * (b.patch === "interest" ? TUNE.interestWave : b.patch === "greed" ? 0.8 : 1)
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
    const n = waveCount(b);
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
      return finish(g, b, false, "boss");
    }
  } else if (b.phase === "treasure") {
    const r = b.troom!;
    if (--r.t <= 0 || r.killed) endTreasure(b);
  } else if (b.phase === "break" && b.exp) {
    // 원정 정리 시간: 남은 적을 다 잡거나 시간이 다 되면 칸 끝 (캠프에선 step 이 멈춤)
    if (b.exp.stage === "clean" && (--b.exp.cleanT <= 0 || !b.enemies.some((e) => e.boss < 0 && !e.rift && e.hp > 0))) return expSegEnd(g, b);
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
    if (e.gim) gimTick(b, e);
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
  // 과부하 회로: 필드 적이 많을수록 공속 더 (1마리당 +0.5%, 최대 overBoss) · 보스가 있으면 최대
  let over = 0;
  if (b.mods.overBoss) {
    let n = 0;
    for (const e of es) if (e.hp > 0) n += e.boss >= 0 ? 999 : 1;
    over = Math.min(b.mods.overBoss, n * 0.005);
  }
  for (let i = 0; i < CELLS; i++) {
    const c = b.cells[i];
    if (!c.def) continue;
    const def = UNIT[c.def];
    if (b.sealed.length && b.sealed.includes(i)) continue; // 봉인된 칸
    const sp = 1 + b.aspd[i] + b.cx.aspd + b.mods.aspdAll + over + (def.faction === "hidden" ? 0 : b.mods.facAspd[def.faction]) + egv(b, def.id, "rapid") / 100;
    const range = def.range + egv(b, def.id, "reach");
    const period = TPS / def.aps;
    for (const u of c.units) {
      if (u.stun > 0) {
        u.stun--;
        continue;
      }
      u.cd -= sp;
      if (u.cd > 0) continue;
      const t = target(b, i, range);
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
  // 피해 버프(키메라): 같은 종류도 겹침 — 버프 주는 유닛 수만큼 더함, 칸마다 cap 까지 (보관함은 주지도 받지도 않음)
  b.dbuf.fill(0);
  for (let i = 0; i < CELLS; i++) {
    const c = b.cells[i];
    const bf = c.def ? UNIT[c.def].buff : undefined;
    if (!bf) continue;
    const add = bf.pct * c.units.length * (UNIT[c.def!].faction === "hidden" ? hiddenFx(b) : 1);
    const r2 = bf.r * bf.r;
    for (let j = 0; j < CELLS; j++) {
      if (!b.cells[j].def) continue;
      const dx = cellX(i) - cellX(j),
        dy = cellY(i) - cellY(j);
      if (dx * dx + dy * dy <= r2) b.dbuf[j] = Math.min(bf.cap * (UNIT[c.def!].faction === "hidden" ? hiddenFx(b) : 1), b.dbuf[j] + add);
    }
  }
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
    (kinds === 3 ? b.cx.tri : 1) *
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
  let m = upMult(b, def.faction) * b.team;
  if (b.exp) {
    m *= b.exp.dmg;
    if (expHas(b, "sq_mech") && (e.boss >= 0 || e.gim)) m *= 1.25;
    if (expHas(b, "hunter") && (e.gim || e.elite)) m *= 1.5;
    if (expHas(b, "first") && b.exp.stage === "waves" && b.wave === b.exp.segStart) m *= 2;
  }
  const M = b.mods;
  m *= (1 + LV_DMG * (M.lv[def.id] ?? 0)) * M.relicDmg * M.gritDmg;
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
  // 각인: 거인 사냥 · 성장형 · 관통
  if (M.engr[def.id]) {
    const eh = egv(b, def.id, "hunter");
    if (eh && (e.boss >= 0 || e.elite || e.rift)) m *= 1 + eh / 100;
    const eg = egv(b, def.id, "growth");
    if (eg) m *= 1 + (eg / 100) * b.wave;
  }
  const pierce = 1 - egv(b, def.id, "pierce") / 100;
  if (def.dtype === "phys") {
    let sz = SIZE_MULT[def.faction][e.size];
    if (def.faction === "knight" && e.size > 0) sz = Math.min(1, sz + M.knightBig);
    m *=
      (e.boss >= 0 ? Math.max(B.bossSizeFloor, sz) : sz) * armorF(e.armor * pierce - e.shred) * (1 - e.pres);
  } else m *= 1 - e.mres * pierce;
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
  let dmg = def.dmg * (1 + b.dbuf[ci]);
  let crit = false;
  if (def.crit && rnd(b.rng) < def.crit.chance) {
    dmg *= def.crit.mult;
    crit = true;
  }
  if (b.cx.crit && rnd(b.crng) < b.cx.crit) {
    dmg *= 2;
    crit = true;
  }
  // 각인 「치명 리듬」: 4번째 공격마다
  u.n = (u.n ?? 0) + 1;
  const ec = egv(b, def.id, "crit");
  if (ec && u.n % 4 === 0) {
    dmg *= ec;
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
  // 각인 「서리」 · 「처형」
  const ef = egv(b, def.id, "frost");
  if (ef && t.hp > 0) {
    const pct = Math.min(B.slowCap, ef / 100);
    if (pct >= t.slowP || t.slowT <= 0) {
      t.slowP = pct;
      t.slowT = sec(1.5);
    }
  }
  const er = egv(b, def.id, "reap");
  if (er && t.hp > 0 && t.boss < 0 && t.hp <= t.max * (er / 100)) {
    b.dealt[def.id] = (b.dealt[def.id] ?? 0) + t.hp;
    t.hp = 0;
    t.last = def.id;
  }
  // FORTE 의 오르골: 확률로 궁극기 충전 +1 (낀 판만 난수를 씀)
  if (def.ult && b.mods.ultCharge && rnd(b.rng) < b.mods.ultCharge) u.ult++;
  if (def.ult && ++u.ult >= def.ult.every) {
    u.ult = 0;
    ult(b, ci, def, t, tx, ty);
    // FORTE 의 오르골: 궁극기를 쓰면 필드의 다른 궁극기 유닛 모두 충전 +1 — 바로 터뜨리진 않고 다음 공격에서 (연쇄)
    if (b.mods.forteChain)
      for (let j = 0; j < CELLS; j++) if (j !== ci && b.cells[j].def && UNIT[b.cells[j].def!].ult) for (const v of b.cells[j].units) v.ult++;
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
    if (s.kind === "split") {
      // 분열: 체력이 at 밑으로 처음 내려가면 한 번 — 같은 보스 n 기 (분열은 다시 안 함)
      if (e.sk[k] < 0 || e.hp > e.max * s.at) return;
      e.sk[k] = -1;
      for (let n = 0; n < s.n; n++) {
        const c = spawn(b, "slime", 1);
        Object.assign(c, { kind: e.kind, boss: e.boss, armor: e.armor, mres: e.mres, pres: e.pres, size: e.size, spd: e.spd });
        c.hp = c.max = e.max * s.hp;
        c.sk = e.sk.map((v, j) => (j === k ? -1 : v + 30 * (n + 1)));
        c.d = e.d;
        c.trav = e.trav - 0.4 * (n + 1);
        [c.x, c.y] = pathPos(c.d);
      }
      b.fx?.push({ k: "heal", x: e.x, y: e.y });
      b.ev?.push({ t: "encore" });
      return;
    }
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
      case "steal": {
        const n = Math.floor(b.gold * s.pct);
        b.gold -= n;
        e.loot += n;
        if (n > 0) b.ev?.push({ t: "expSteal", gold: n });
        break;
      }
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
  if (e.last === "~escape") return false;
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
  // 분열 골렘: 둘로 (두 번까지)
  if (e.gim === "golem" && e.gd < 2) {
    for (let k = 0; k < 2; k++) {
      const c = spawn(b, e.kind, 1);
      c.hp = c.max = e.max * 0.4;
      c.armor = e.armor;
      c.mres = e.mres;
      c.size = Math.max(0, e.size - 1) as Size;
      c.spd = e.spd;
      c.elite = true;
      c.gim = "golem";
      c.gd = e.gd + 1;
      c.d = e.d;
      c.trav = e.trav - 0.25 * k;
      c.x = e.x;
      c.y = e.y;
    }
  }
  if ((b.mods.glitch.mut?.includes("split") || b.exp?.mod === "split") && !e.child && !e.gim && e.boss < 0 && !e.rift && (e.elite || e.size === 2)) {
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
    // 원정 보스: 갈라진 것까지 모두 잡으면 원정 성공 (빼앗긴 골드 ×2 돌려받음)
    b.tele = null;
    gold = Math.floor((B.bossGold.base + B.bossGold.per * b.wave) * b.mods.bossGold) + e.loot * 2;
    b.ev?.push({ t: "bossDown", boss: e.boss, gold, stones: 0, ticket: null });
    // 분신 둘을 한 tick 에 잡아도 한 번만 (먼저 처리된 쪽이 stage · result 를 바꿈)
    if (b.exp.stage === "boss" && !b.result && !b.enemies.some((o) => o !== e && o.boss >= 0 && o.hp > 0)) {
      b.gold += gold;
      const x = b.exp;
      x.kills.push(BOSSES[x.boss].fighter);
      if (x.act === 1) {
        // 1막 끝: 귀환할지 2막으로 갈지 (고르는 동안 멈춤, 남은 졸개는 2막에 들어갈 때 치움)
        x.stage = "camp";
        x.camp = { k: "act" };
        b.phase = "break";
        b.tele = null;
        return false;
      }
      finish(g, b, true, "clear");
      return true;
    }
  } else if (e.boss >= 0) {
    b.tele = null;
    b.seized = [];
    gold = Math.floor((B.bossGold.base + B.bossGold.per * b.wave) * b.mods.bossGold);
    b.free += b.mods.bossFree;
    // 전쟁 깃발: 보스를 잡으면 세 세력 강화 + (공짜) — 그 세력 강화가 N 의 배수를 넘으면 그 세력 레전드
    if (b.mods.warFree)
      for (const f of FACTIONS) {
        const before = b.up[f as "knight"];
        b.up[f as "knight"] = Math.min(B.up.max, before + b.mods.warFree);
        warTick(b, before, f);
      }
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
    if (b.patch === "greed") gold = Math.round(gold * 2.5);
    // 각인 「황금 손」 · 「폭발」 (쓰러뜨린 유닛)
    const kd = UNIT[e.last];
    if (kd && b.mods.engr[kd.id]) {
      gold += egv(b, kd.id, "coin");
      const eb = egv(b, kd.id, "blast");
      if (eb) {
        around(b, e.x, e.y, 1.2, e, (o) => hit(b, kd, o, kd.dmg * (eb / 100)));
        b.fx?.push({ k: "aoe", x: e.x, y: e.y, r: 1.2, def: kd.id });
      }
    }
    if (b.exp) {
      if (b.exp.mod) gold = Math.floor(gold * FIGHT_MOD[b.exp.mod].gold);
      if (expHas(b, "goldhand")) gold += 1;
      if (e.gim === "thief") gold += 80;
    }
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
    if (!PATCHES.some((p) => p.id === id) || !b.cheat.offer.includes(id)) return;
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
      mix(b.exp.hp);
      mix(b.exp.f);
      mix(b.exp.relics.length);
      mix(b.exp.act);
    }
    for (const e of b.enemies) mix(e.hp);
  }
  return h >>> 0;
}
