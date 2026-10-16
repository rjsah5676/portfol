/*
 * DICE TOWN 판 엔진 — 서버가 돌리고(권위), 밸런스 시뮬도 같은 코드.
 *
 *   newGame(설정)        → 판 상태 G (첫 프롬프트까지 진행)
 *   act(G, 자리, 행동)    → 검사 → 바꿈 → 다음 프롬프트까지 진행. 이번에 생긴 일은 G.ev 에 (화면 연출용)
 *   timeoutAction(G)     → 시간이 다 됐을 때 대신 할 행동
 *
 * 한 번에 한 사람(G.prompt.p)에게만 물음. 난수는 G.rng 만 씀 (같은 시드 + 같은 행동 = 같은 판).
 * 브라우저 전용 API · "@/…" 경로를 쓰지 않음 (서버가 상대 경로로 import).
 */

import { CHAR, SKILL_TARGET, SKILL_TIME, fxOf, type Fx, type Loadout, type SkillFx, type SkillKind } from "./data";
import { MAPS, type MapDef, type MapId, type TileDef } from "./maps";
import { pickW, rnd, rndInt, type Rng } from "./rng";

/* ───────────── 규칙 숫자 ───────────── */

export const RULE = {
  /** 힘 조절 굴리기: 노린 구간이 나올 기본 확률 */
  controlBase: 0.1,
  /** 대출: 판마다 1번 · 빌린 돈의 130%를 갚음 · 월급의 절반씩 자동 상환 */
  loanTimes: 1,
  loanRate: 1.3,
  loanRepay: 0.5,
  startCash: 2000,
  salary: 250,
  /** 수리소: 이만큼 차례 동안 더블이 나와야 나감 (못 나오면 그다음 차례에 나감) */
  jailTurns: 2,
  jailPay: 100,
  taxRate: 0.1,
  taxMin: 30,
  bonus: 300,
  /** 골든 포털 월급 비율 */
  start2: 0.7,
  /** 처음 살 때 한 번에 지을 수 있는 단계 (0 = 땅만 · 1 오두막 · 2 하우스 · 3 타워) — 랜드마크는 타워가 선 땅에 다시 서야 */
  buyMaxLv: 3,
  /** 단계별 비용 (땅값 배수): 땅 · 오두막 · 하우스 · 타워 · 랜드마크 */
  cost: [1, 0.5, 1, 1.5, 2.5],
  /** 통행료 = 투자액 × 이 비율 (단계별) — 모두의마블 비율: 싼 땅 타워 ≈ 시작 돈 17%, 비싼 땅 타워 ≈ 72%, 랜드마크 ≈ 146% */
  toll: [0.4, 0.75, 1.1, 1.45, 1.8],
  /** 명소 통행료 = 땅값 × spotToll × 2^(가진 명소 수 − 1) */
  spotToll: 0.5,
  /** 색 그룹을 다 가지면 통행료 배수 */
  monoMult: 2,
  /** 축제 무대 통행료 배수 */
  festMult: 2,
  /** 인수 비용 = 투자액 × */
  acqMult: 1,
  /** 돈이 모자랄 때 땅을 팔면 투자액의 */
  sellRate: 0.5,
  /** 트리플 독점 (색 그룹 수) */
  triple: 3,
  /** 스킬 효과(축제 · 불꽃) 지속 바퀴 */
  boostRounds: 3,
  /** 시간 주사위가 되감는 통행료 하한 */
  rewindMin: 250,
};

export const LEVEL_NAME = ["땅", "오두막", "하우스", "타워", "랜드마크"];
export const LANDMARK = 4;

/** 단계 lv 까지 들어간 투자액 (땅값 배수의 누적) */
export const investedOf = (price: number, lv: number) => Math.round(price * RULE.cost.slice(0, lv + 1).reduce((a, b) => a + b, 0));
export const baseToll = (price: number, lv: number) => Math.round(investedOf(price, lv) * RULE.toll[lv]);

/* 건물은 오두막 · 하우스 · 타워를 따로따로 (모두의마블처럼 골라 짓기) — b = 지은 건물 비트 (1 오두막 · 2 하우스 · 4 타워) */
const popcount = (b: number) => (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1);
/** 그 칸에 서 있는 건물 비트 (옛 저장본은 lv 로 채움) */
export const bitsOf = (t: { lv: number; b?: number }) => (t.lv >= LANDMARK ? 7 : (t.b ?? (1 << Math.min(t.lv, 3)) - 1));
/** 지은 건물 번호들 (1 오두막 · 2 하우스 · 3 타워) */
export const builtOf = (t: { lv: number; b?: number }) => [1, 2, 3].filter((k) => (bitsOf(t) >> (k - 1)) & 1);
/** 칸 상태 기준 투자액 · 통행료 */
export const investedT = (price: number, t: { lv: number; b?: number }) =>
  Math.round(price * (RULE.cost[0] + builtOf(t).reduce((a, k) => a + RULE.cost[k], 0) + (t.lv >= LANDMARK ? RULE.cost[LANDMARK] : 0)));
export const baseTollT = (price: number, t: { lv: number; b?: number }) => Math.round(investedT(price, t) * RULE.toll[Math.min(t.lv, LANDMARK)]);

/* ───────────── 마을 소식 (해피 타운) ───────────── */

export type TownEventId = "rain" | "festa" | "boom" | "slump" | "build";
export const TOWN_EVENTS: Record<TownEventId, { name: string; desc: string }> = {
  rain: { name: "장마", desc: "명소 통행료 절반" },
  festa: { name: "동네 축제", desc: "한 동네 통행료 2배" },
  boom: { name: "호황", desc: "출발 월급 1.5배" },
  slump: { name: "불경기", desc: "모든 통행료 −20%" },
  build: { name: "건설 붐", desc: "건설비 −30%" },
};

/* ───────────── 럭키 박스 ───────────── */

export type CardId = "allow" | "fine" | "toStart" | "toJail" | "toWarp" | "freeBuild" | "halfToll" | "acqSale" | "festInvite" | "back3" | "gift" | "congrats";
export const CARDS: Record<CardId, { name: string; desc: string; w: number; good: number }> = {
  allow: { name: "용돈", desc: "+300코인", w: 3, good: 2 },
  fine: { name: "과속 딱지", desc: "−100코인", w: 2, good: -2 },
  toStart: { name: "출발 포털로", desc: "출발 포털로 바로 가서 월급", w: 1, good: 2 },
  toJail: { name: "수리소 호출", desc: "도트 수리소로", w: 1, good: -3 },
  toWarp: { name: "워프 티켓", desc: "워프 게이트로", w: 1, good: 1 },
  freeBuild: { name: "무료 공사권", desc: "다음에 짓는 건물 하나 무료 (가지고 있음)", w: 2, good: 3 },
  halfToll: { name: "반값 쿠폰", desc: "다음 통행료 반값 (가지고 있음)", w: 2, good: 3 },
  acqSale: { name: "부동산 세일", desc: "다음 인수 30% 할인 (가지고 있음)", w: 1, good: 2 },
  festInvite: { name: "축제 초대장", desc: "내 땅 하나에 축제", w: 1, good: 2 },
  back3: { name: "뒤로 세 칸", desc: "세 칸 뒤로", w: 1, good: 0 },
  gift: { name: "기부 천사", desc: "상대마다 50코인씩 줌", w: 1, good: -1 },
  congrats: { name: "축하 파티", desc: "상대마다 120코인씩 받음", w: 1, good: 2 },
};
const CARD_IDS = Object.keys(CARDS) as CardId[];

/* ───────────── 상태 ───────────── */

export interface PlayerIn {
  id: string;
  name: string;
  bot: boolean;
  lo: Loadout;
}

export interface PState {
  id: string;
  name: string;
  bot: boolean;
  lo: Loadout;
  fx: Fx;
  skill: SkillFx;
  cash: number;
  pos: number;
  alive: boolean;
  /** 파산 순서 (1 = 가장 먼저) · 0 = 살아 있음 */
  out: number;
  jail: number;
  warp: boolean;
  frozen: number;
  /** 스킬 쿨 (0 = 쓸 수 있음) */
  cd: number;
  /** 다음 통행료 깎기 (스킬) */
  shield: number;
  /** 다음 인수 깎기 (스킬) */
  sale: number;
  /** 이번 이동 폴짝 */
  hop: boolean;
  /** 앙코르 (이번 차례 끝나고 한 번 더) */
  encore?: boolean;
  keep: { free: number; half: number; acq: number };
  /** 갚을 빚 · 빌린 횟수 */
  debt: number;
  loans: number;
  uses: { adjust: number; pick: number; reroll: number; rewind: number };
  doubles: number;
  laps: number;
  /** 축제 무대로 연 축제 칸 (-1 없음) */
  fest: number;
  stat: { paid: number; got: number; built: number; lm: number; acq: number; skill: number; mono: number };
}

export interface TState {
  owner: number;
  /** 건물 수 (0 땅만 · 1~3 · 4 랜드마크) */
  lv: number;
  /** 지은 건물 비트 (1 오두막 · 2 하우스 · 4 타워) */
  b?: number;
  /** 스킬 통행료 배수 · 남은 바퀴 */
  boost: number;
  boostLeft: number;
}

export type Prompt =
  | { k: "turn"; p: number; jail: boolean; warp: boolean }
  | { k: "post"; p: number; dice: [number, number]; steps: number }
  | { k: "fork"; p: number; opts: number[]; steps: number }
  | { k: "rail"; p: number; opts: number[] }
  /** items: 고를 수 있는 것 (0 땅 · 1 오두막 · 2 하우스 · 3 타워 · 4 랜드마크), costs: 그 하나씩 값 */
  | { k: "buy"; p: number; tile: number; from: number; items: number[]; costs: number[] }
  | { k: "acq"; p: number; tile: number; cost: number }
  | { k: "fest"; p: number; tiles: number[] }
  /** 통행료가 가진 돈보다 많음: 대출할지 (안 하면 땅 팔기 → 파산) */
  /** 통행료가 모자람: 대출(canLoan) · 팔 땅 고르기(lands: 칸 · 받는 돈) · 파산 */
  | { k: "loan"; p: number; tile: number; amt: number; need: number; debt: number; sell: number; shock: boolean; orig?: number; by?: string[]; canLoan: boolean; lands: { tile: number; got: number }[] }
  /** 출발 포털: 내 땅 하나 골라 짓기 */
  | { k: "start"; p: number; tiles: number[] };

export type Action =
  | { t: "roll"; power?: number }
  | { t: "pay" } // 수리소 돈 내고 나가기 (그리고 굴림)
  | { t: "warp"; to: number }
  | { t: "pick"; n: number } // 황금 주사위 (아이템)
  | { t: "skill"; target?: number; n?: number }
  | { t: "keep" }
  | { t: "reroll" } // 아이템 다시 굴리기
  | { t: "adjust"; d: 1 }
  | { t: "fork"; to: number }
  | { t: "rail"; to: number }
  | { t: "buy"; lv: number; pick?: number[] } // lv -1 = 안 삼 · pick = 고른 것들 (없으면 lv 단계까지)
  | { t: "acq"; yes: boolean }
  | { t: "fest"; tile: number }
  | { t: "start"; tile: number } // -1 = 안 지음
  | { t: "loan"; yes: boolean; /** 먼저 팔 땅 (고른 순서대로) */ sell?: number[] };

export type WinHow = "bankrupt" | "triple" | "line" | "spot" | "rounds";

export type Ev =
  | { t: "turn"; p: number; round: number }
  | { t: "roll"; p: number; d: [number, number]; dbl: boolean; how?: "pick" | "reroll" | "jail"; power?: number; ctrl?: boolean; twin?: boolean }
  | { t: "adjust"; p: number; steps: number; why: string }
  | { t: "rewind"; p: number; amt: number }
  | { t: "encore"; p: number }
  | { t: "move"; p: number; path: number[]; warp?: boolean; pull?: boolean; rail?: boolean; /** 마지막 몇 칸이 폴짝 · 묵직한 주사위로 더 간 칸 */ bonus?: number; bonusWhy?: string }
  | { t: "salary"; p: number; amt: number; half?: boolean; why?: string; /** 잭팟으로 받은 몫 */ pot?: number }
  | { t: "pay"; from: number; to: number; amt: number; why: string; tile?: number; shock?: boolean; /** 깎이기 전 금액 · 깎은 것들 */ orig?: number; by?: string[] }
  | { t: "buy"; p: number; tile: number; lv: number; cost: number; b?: number; top?: number }
  | { t: "acq"; p: number; from: number; tile: number; cost: number }
  | { t: "block"; p: number; tile: number }
  | { t: "sell"; p: number; tile: number; got: number }
  | { t: "card"; p: number; card: CardId; alt?: CardId }
  | { t: "jail"; p: number; turns: number }
  | { t: "free"; p: number; why: string }
  | { t: "fest"; p: number; tile: number }
  | { t: "skill"; p: number; kind: SkillKind; name: string; target?: number; n?: number; tiles?: number[]; /** 상륙 돌격으로 부서진 것 (1~3 건물 · 4 랜드마크) */ lost?: number }
  | { t: "frozen"; p: number }
  | { t: "town"; ev: TownEventId; group?: number }
  | { t: "rotate"; order: number[] }
  | { t: "mono"; p: number; group: number }
  /** 독점 코앞 (명소 하나 남음) — 다들 막으라고 크게 알림 */
  | { t: "threat"; p: number; kind: "spot" | "triple" | "line"; have: number; need: number }
  | { t: "bankrupt"; p: number }
  | { t: "loan"; p: number; amt: number; debt: number }
  | { t: "repay"; p: number; amt: number; left: number }
  | { t: "over"; winner: number; how: WinHow; detail?: number }
  /** 못 하고 넘어감 — 이유 안내 (need = 모자란 비용) */
  | { t: "nope"; p: number; why: string; tile?: number; need?: number };

export interface Game {
  map: MapId;
  seed: number;
  rng: Rng;
  players: PState[];
  tiles: TState[];
  /** 자리 → 칸 id (orgel 만 바뀜) */
  order: number[];
  cur: number;
  round: number;
  rounds: number;
  /** 첫 차례 자리 (바퀴 셈) */
  first: number;
  prompt: Prompt | null;
  /** 굴린 주사위 (post · fork 사이에 들고 있음) */
  dice: [number, number] | null;
  /** 이번 이동이 더블인지 (한 번 더) */
  again: boolean;
  town: { id: TownEventId; group: number; left: number } | null;
  ev: Ev[];
  over: { winner: number; how: WinHow; detail?: number } | null;
  outN: number;
  /** 황금 다리 잭팟: 은행에 낸 돈(세금 · 벌금 · 수리비 …)이 쌓이고, 다리에 서면 통째로 */
  pot?: number;
  /** 행동 수 (무한 루프 방지 · 기록) */
  steps: number;
}

/* ───────────── 도우미 ───────────── */

export const mapOf = (g: Game): MapDef => MAPS[g.map];
const tileAt = (g: Game, slot: number) => g.order[slot];
const defAt = (g: Game, slot: number): TileDef => mapOf(g).tiles[tileAt(g, slot)];
/** 칸 id → 지금 놓인 자리 */
export const slotOf = (g: Game, tile: number) => g.order.indexOf(tile);
const ownable = (d: TileDef) => d.kind === "city" || d.kind === "spot";
const alive = (g: Game) => g.players.filter((p) => p.alive);
const foes = (g: Game, pi: number) => g.players.map((_, i) => i).filter((i) => i !== pi && g.players[i].alive);

function emit(g: Game, e: Ev) {
  g.ev.push(e);
}

/** 이 칸(자리)에서 한 칸 앞 — 갈림길이면 고른 쪽 */
function nextSlot(g: Game, slot: number, choose?: number): number {
  const m = mapOf(g);
  const nx = m.tiles[slot]?.next;
  if (nx && nx.length > 1) return choose !== undefined && nx.includes(choose) ? choose : nx[0];
  return (slot + 1) % m.tiles.length;
}
/** 한 칸 뒤 */
function prevSlot(g: Game, slot: number): number {
  const m = mapOf(g);
  return (slot - 1 + m.tiles.length) % m.tiles.length;
}

/** 지금 판에서 그 칸 통행료 (payer 기준 깎기 전 · 받는 쪽 효과까지) */
export function tollOf(g: Game, tile: number): number {
  const m = mapOf(g);
  const d = m.tiles[tile];
  const t = g.tiles[tile];
  if (t.owner < 0 || !d.price) return 0;
  const owner = g.players[t.owner];
  let v: number;
  if (d.kind === "spot") {
    const n = m.tiles.filter((x, i) => x.kind === "spot" && g.tiles[i].owner === t.owner).length;
    v = d.price * RULE.spotToll * 2 ** Math.max(0, n - 1);
    if (g.town?.id === "rain") v *= 0.5;
  } else {
    v = baseTollT(d.price, t);
    if (d.group !== undefined && groupOwned(g, d.group) === t.owner) v *= RULE.monoMult;
    if (owner.fest === tile) v *= RULE.festMult;
    if (g.town?.id === "festa" && g.town.group === d.group) v *= 2;
  }
  if (t.boostLeft > 0) v *= t.boost;
  if (g.town?.id === "slump") v *= 0.8;
  v *= 1 + owner.fx.tollRecv;
  return Math.round(v);
}

/** 통행료 배율 (독점 · 축제 · 마을 축제 · 스킬 부스트 · 명소 여러 개) — 보드 표시용 */
export function tollMult(g: Game, tile: number): number {
  const m = mapOf(g);
  const d = m.tiles[tile];
  const t = g.tiles[tile];
  if (t.owner < 0) return 1;
  let k = 1;
  if (d.kind === "spot") {
    const n = m.tiles.filter((x, i) => x.kind === "spot" && g.tiles[i].owner === t.owner).length;
    k *= 2 ** Math.max(0, n - 1);
  } else {
    if (d.group !== undefined && groupOwned(g, d.group) === t.owner) k *= RULE.monoMult;
    if (g.players[t.owner].fest === tile) k *= RULE.festMult;
    if (g.town?.id === "festa" && g.town.group === d.group) k *= 2;
  }
  if (t.boostLeft > 0) k *= t.boost;
  return Math.round(k * 10) / 10;
}

/** 그룹을 한 사람이 다 가졌으면 그 사람, 아니면 -1 */
export function groupOwned(g: Game, group: number): number {
  const m = mapOf(g);
  let o = -2;
  for (let i = 0; i < m.tiles.length; i++) {
    if (m.tiles[i].group !== group) continue;
    const w = g.tiles[i].owner;
    if (w < 0) return -1;
    if (o === -2) o = w;
    else if (o !== w) return -1;
  }
  return o < 0 ? -1 : o;
}

/** 건설비 (pi 기준 · 단계 from → to) */
export function buildCost(g: Game, pi: number, tile: number, from: number, to: number): number {
  const d = mapOf(g).tiles[tile];
  if (!d.price) return 0;
  let c = 0;
  for (let l = from + 1; l <= to; l++) c += d.price * RULE.cost[l];
  // 땅값(0단계)은 건설비 할인 없음 — 처음 살 때 from = -1
  const land = from < 0 ? d.price : 0;
  c -= land;
  let k = 1 - g.players[pi].fx.build;
  if (g.town?.id === "build") k *= 0.7;
  return Math.round(land + c * k);
}

/** 인수 비용 (pi 가 산다면) */
export function acqCost(g: Game, pi: number, tile: number): number {
  const d = mapOf(g).tiles[tile];
  const t = g.tiles[tile];
  const p = g.players[pi];
  const owner = g.players[t.owner];
  let v = investedT(d.price ?? 0, t) * RULE.acqMult;
  v *= 1 + owner.fx.defend;
  v *= 1 - p.fx.acq;
  if (p.sale) v *= 1 - p.sale;
  if (p.keep.acq) v *= 0.7;
  return Math.max(1, Math.round(v));
}

/** 원격 매입 비용 (MOA) */
export function buyoutCost(g: Game, pi: number, tile: number): number {
  return Math.round(acqCost(g, pi, tile) * g.players[pi].skill.mag);
}

/** 자산 = 돈 + 땅 투자액 */
export function assetsOf(g: Game, pi: number): number {
  const m = mapOf(g);
  let a = g.players[pi].cash - g.players[pi].debt;
  for (let i = 0; i < m.tiles.length; i++) if (g.tiles[i].owner === pi) a += investedT(m.tiles[i].price ?? 0, g.tiles[i]);
  return a;
}

/* ───────────── 판 만들기 ───────────── */

export function newGame(o: { map: MapId; seed: number; players: PlayerIn[]; rounds?: number; first?: number }): Game {
  const m = MAPS[o.map];
  const startSlot = m.tiles.findIndex((t) => t.kind === "start");
  const g: Game = {
    map: o.map,
    seed: o.seed >>> 0,
    rng: { r: o.seed | 0 },
    players: o.players.map((p) => {
      const { fx, skill } = fxOf(p.lo);
      return {
        id: p.id,
        name: p.name,
        bot: p.bot,
        lo: p.lo,
        fx,
        skill,
        cash: RULE.startCash,
        pos: startSlot,
        alive: true,
        out: 0,
        jail: 0,
        warp: false,
        frozen: 0,
        cd: 0,
        shield: 0,
        sale: 0,
        hop: false,
        keep: { free: 0, half: 0, acq: 0 },
        debt: 0,
        loans: 0,
        uses: { adjust: fx.usesAdjust, pick: fx.usesPick, reroll: fx.usesReroll, rewind: fx.rewind > 0 ? 1 : 0 },
        doubles: 0,
        laps: 0,
        fest: -1,
        stat: { paid: 0, got: 0, built: 0, lm: 0, acq: 0, skill: 0, mono: 0 },
      };
    }),
    tiles: m.tiles.map(() => ({ owner: -1, lv: 0, b: 0, boost: 1, boostLeft: 0 })),
    order: m.tiles.map((_, i) => i),
    cur: 0,
    round: 1,
    rounds: o.rounds ?? m.rounds,
    first: 0,
    prompt: null,
    dice: null,
    again: false,
    town: null,
    ev: [],
    over: null,
    outN: 0,
    pot: 0,
    steps: 0,
  };
  g.cur = g.first = o.first ?? rndInt(g.rng, g.players.length);
  roundStart(g);
  startTurn(g);
  return g;
}

/* ───────────── 차례 ───────────── */

/** fresh = 새 차례 (더블 · 앙코르로 한 번 더는 아님 — 그때는 쿨이 안 줄어듦) */
function startTurn(g: Game, fresh = true): void {
  if (g.over) return;
  const p = g.players[g.cur];
  g.dice = null;
  g.again = false;
  p.hop = false;
  emit(g, { t: "turn", p: g.cur, round: g.round });
  if (fresh && p.cd > 0) p.cd--;
  if (p.frozen > 0) {
    p.frozen--;
    emit(g, { t: "frozen", p: g.cur });
    return endTurn(g);
  }
  g.prompt = { k: "turn", p: g.cur, jail: p.jail > 0, warp: p.warp };
}

function endTurn(g: Game): void {
  if (g.over) return;
  const p = g.players[g.cur];
  if (g.again && p.alive && p.jail === 0) {
    g.again = false;
    g.prompt = null;
    return startTurn(g, false);
  }
  if (p.encore) {
    p.encore = false;
    if (p.alive && p.jail === 0) {
      p.doubles = 0;
      g.prompt = null;
      emit(g, { t: "encore", p: g.cur });
      return startTurn(g, false);
    }
  }
  p.doubles = 0;
  // 다음 살아 있는 사람
  const n = g.players.length;
  let i = g.cur;
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (i === g.first) {
      g.round++;
      if (g.round > g.rounds) return finishByAssets(g);
      roundStart(g);
      if (g.over) return;
    }
    if (g.players[i].alive) break;
  }
  g.cur = i;
  g.prompt = null;
  startTurn(g);
}

function roundStart(g: Game): void {
  for (const t of g.tiles) if (t.boostLeft > 0 && --t.boostLeft === 0) t.boost = 1;
  const m = mapOf(g);
  if (m.id === "town" && m.every && (g.round - 1) % m.every === 0) {
    const ids = Object.keys(TOWN_EVENTS) as TownEventId[];
    const id = ids[rndInt(g.rng, ids.length)];
    const group = rndInt(g.rng, m.groups.length);
    g.town = { id, group, left: m.every };
    emit(g, { t: "town", ev: id, ...(id === "festa" && { group }) });
  }
  if (m.id === "orgel" && m.every && g.round > 1 && (g.round - 1) % m.every === 0) rotateOrgel(g);
}

/** 네 변(모서리 빼고 7자리씩)이 시계 방향으로 한 변씩 */
function rotateOrgel(g: Game) {
  const side = (k: number) => [1, 2, 3, 4, 5, 6, 7].map((i) => k * 8 + i);
  const prev = [...g.order];
  for (let k = 0; k < 4; k++) {
    const from = side(k);
    const to = side((k + 1) % 4);
    from.forEach((s, j) => (g.order[to[j]] = prev[s]));
  }
  emit(g, { t: "rotate", order: [...g.order] });
}

/* ───────────── 행동 ───────────── */

export class ActError extends Error {}
const bad = (m: string) => {
  throw new ActError(m);
};

export function act(g: Game, pi: number, a: Action): void {
  g.ev = [];
  if (g.over) bad("끝난 판이에요");
  const pr = g.prompt;
  if (!pr || pr.p !== pi) bad("내 차례가 아니에요");
  g.steps++;
  const p = g.players[pi];
  switch (pr!.k) {
    case "turn": {
      if (a.t === "skill") return doSkill(g, pi, a, "pre");
      if (a.t === "pay") {
        if (!pr!.jail) bad("수리소가 아니에요");
        if (p.cash < RULE.jailPay) bad("돈이 모자라요");
        pay(g, pi, -1, RULE.jailPay, "수리비");
        p.jail = 0;
        emit(g, { t: "free", p: pi, why: "수리비" });
        g.prompt = { k: "turn", p: pi, jail: false, warp: p.warp };
        return;
      }
      if (a.t === "warp") {
        if (!pr!.warp) bad("워프할 수 없어요");
        const m = mapOf(g);
        if (!(a.to >= 0 && a.to < m.tiles.length)) bad("없는 칸이에요");
        p.warp = false;
        return warpTo(g, pi, a.to);
      }
      if (a.t === "pick") {
        if (pr!.jail || pr!.warp) bad("지금은 못 써요");
        if (p.uses.pick <= 0) bad("남은 횟수가 없어요");
        if (!(a.n >= 2 && a.n <= 12)) bad("2~12 중에서 골라 주세요");
        p.uses.pick--;
        return pickRoll(g, pi, a.n, "pick");
      }
      if (a.t === "roll") {
        if (pr!.warp) bad("워프할 칸을 골라 주세요");
        return roll(g, pi, typeof a.power === "number" ? a.power : undefined);
      }
      return bad("지금 할 수 없는 행동이에요");
    }
    case "post": {
      const post = pr as Extract<Prompt, { k: "post" }>;
      if (a.t === "skill") return doSkill(g, pi, a, "post");
      if (a.t === "reroll") {
        if (p.uses.reroll <= 0) bad("남은 횟수가 없어요");
        p.uses.reroll--;
        return reroll(g, pi, "reroll");
      }
      if (a.t === "adjust") {
        if (p.uses.adjust <= 0) bad("남은 횟수가 없어요");
        if (a.d !== 1) bad("한 칸 더만 돼요");
        const s = post.steps + a.d;
        if (s < 1) bad("한 칸은 가야 해요");
        p.uses.adjust--;
        emit(g, { t: "adjust", p: pi, steps: s, why: "미끄럼 주사위" });
        return commitMove(g, pi, s);
      }
      if (a.t === "keep") return commitMove(g, pi, post.steps);
      return bad("지금 할 수 없는 행동이에요");
    }
    case "rail": {
      const r = pr as Extract<Prompt, { k: "rail" }>;
      if (a.t !== "rail") bad("탈 역을 골라 주세요");
      const to = (a as { to: number }).to;
      g.prompt = null;
      if (to < 0) return endTurn(g);
      if (!r.opts.includes(to)) bad("갈 수 없는 역이에요");
      emit(g, { t: "move", p: pi, path: [to], warp: true, rail: true });
      p.pos = to;
      return endTurn(g);
    }
    case "fork": {
      const f = pr as Extract<Prompt, { k: "fork" }>;
      if (a.t !== "fork" || !f.opts.includes(a.to)) bad("갈 길을 골라 주세요");
      g.prompt = null;
      return walk(g, pi, f.steps, (a as { to: number }).to);
    }
    case "buy": {
      const b = pr as Extract<Prompt, { k: "buy" }>;
      if (a.t !== "buy") bad("지을지 골라 주세요");
      const { lv, pick } = a as { lv: number; pick?: number[] };
      let sel = pick ? [...new Set(pick)] : lv >= 0 ? b.items.filter((k) => k <= lv) : [];
      if (lv < 0 && !pick) sel = [];
      if (sel.some((k) => !b.items.includes(k))) bad("고를 수 없는 건물이에요");
      // 빈 땅은 땅부터
      if (sel.length && b.from < 0 && !sel.includes(0)) bad("땅부터 사야 해요");
      const cost = sel.reduce((s2, k) => s2 + b.costs[b.items.indexOf(k)], 0);
      if (cost > p.cash) bad("돈이 모자라요");
      g.prompt = null;
      if (sel.length) {
        build(g, pi, b.tile, b.from, sel, cost);
        if (g.over) return;
      }
      return endTurn(g);
    }
    case "acq": {
      const q = pr as Extract<Prompt, { k: "acq" }>;
      if (a.t !== "acq") bad("인수할지 골라 주세요");
      g.prompt = null;
      if ((a as { yes: boolean }).yes) {
        const cost = acqCost(g, pi, q.tile);
        if (cost > p.cash) bad("돈이 모자라요");
        return acquire(g, pi, q.tile, cost);
      }
      return endTurn(g);
    }
    case "fest": {
      const f = pr as Extract<Prompt, { k: "fest" }>;
      if (a.t !== "fest" || !f.tiles.includes((a as { tile: number }).tile)) bad("축제를 열 땅을 골라 주세요");
      g.prompt = null;
      p.fest = (a as { tile: number }).tile;
      emit(g, { t: "fest", p: pi, tile: p.fest });
      return endTurn(g);
    }
    case "loan": {
      const l = pr as Extract<Prompt, { k: "loan" }>;
      if (a.t !== "loan") bad("대출할지 골라 주세요");
      g.prompt = null;
      const picks = (a as { sell?: number[] }).sell ?? [];
      for (const t of picks) if (g.tiles[t]?.owner === pi) sellTile(g, pi, t);
      if ((a as { yes: boolean }).yes && l.canLoan !== false && p.cash < l.amt) {
        l.need = l.amt - p.cash;
        l.debt = Math.round(l.need * RULE.loanRate);
        p.loans++;
        p.cash += l.need;
        p.debt += l.debt;
        emit(g, { t: "loan", p: pi, amt: l.need, debt: l.debt });
      }
      pay(g, pi, g.tiles[l.tile].owner, l.amt, "통행료", l.tile, l.shock, l.by ? { orig: l.orig ?? l.amt, by: l.by } : undefined);
      return afterToll(g, pi, l.tile);
    }
    case "start": {
      const st = pr as Extract<Prompt, { k: "start" }>;
      if (a.t !== "start") bad("지을 땅을 골라 주세요");
      const tile = (a as { tile: number }).tile;
      g.prompt = null;
      if (tile < 0) return endTurn(g);
      if (!st.tiles.includes(tile)) bad("지을 수 없는 땅이에요");
      return offerBuy(g, pi, tile, g.tiles[tile].lv);
    }
  }
}

/** 시간이 다 됐을 때 */
export function timeoutAction(g: Game): Action {
  const pr = g.prompt!;
  switch (pr.k) {
    case "turn":
      if (pr.warp) {
        const m = mapOf(g);
        return { t: "warp", to: m.tiles.findIndex((t) => t.kind === "start") };
      }
      return { t: "roll" };
    case "post":
      return { t: "keep" };
    case "fork":
      return { t: "fork", to: pr.opts[0] };
    case "rail":
      return { t: "rail", to: -1 };
    case "buy":
      return { t: "buy", lv: -1 };
    case "acq":
      return { t: "acq", yes: false };
    case "fest":
      return { t: "fest", tile: pr.tiles[0] };
    case "start":
      return { t: "start", tile: -1 };
    case "loan":
      return { t: "loan", yes: true };
  }
}

/* ───────────── 굴리기 · 이동 ───────────── */

/** 힘 게이지 구간: 약 0~1/3 · 중 · 강 2/3~1 */
export const powerZone = (power: number): "low" | "mid" | "high" => (power < 1 / 3 ? "low" : power > 2 / 3 ? "high" : "mid");
/** 구간마다 노리는 합 */
export const ZONE_SUM: Record<"low" | "mid" | "high", [number, number]> = { low: [2, 6], mid: [6, 8], high: [8, 12] };
/** 원하는 구간이 나올 확률 (기본 + 캐릭터 · 아이템 컨트롤) */
export const controlChance = (p: { fx: Fx }) => Math.min(0.6, RULE.controlBase + p.fx.control);

/** 주사위 두 개. power(0~1)를 주면 컨트롤 확률만큼 그 구간 합으로 */
function rollDice(g: Game, pi: number, power?: number): { d: [number, number]; ctrl: boolean; twin: boolean } {
  const p = g.players[pi];
  let twin = false;
  const one = (): [number, number] => {
    twin = false;
    const a = 1 + rndInt(g.rng, 6);
    let b = 1 + rndInt(g.rng, 6);
    if (a !== b && p.fx.twin > 0 && rnd(g.rng) < p.fx.twin) {
      b = a;
      twin = true;
    }
    return [a, b];
  };
  if (power === undefined || !(power >= 0 && power <= 1) || rnd(g.rng) >= controlChance(p)) {
    const d = one();
    return { d, ctrl: false, twin };
  }
  const [lo, hi] = ZONE_SUM[powerZone(power)];
  for (let i = 0; i < 40; i++) {
    const d = one();
    if (d[0] + d[1] >= lo && d[0] + d[1] <= hi) return { d, ctrl: true, twin };
  }
  const d = one();
  return { d, ctrl: false, twin };
}

/** 쓸 수 있는 "굴린 뒤" 선택이 있으면 post 로 물음 */
function hasPost(g: Game, pi: number): boolean {
  const p = g.players[pi];
  return p.uses.reroll > 0 || p.uses.adjust > 0 || (p.cd === 0 && SKILL_TIME[p.skill.kind] === "post");
}

function roll(g: Game, pi: number, power?: number): void {
  const p = g.players[pi];
  const { d, ctrl, twin } = rollDice(g, pi, power);
  const pw = { ...(power !== undefined && { power: Math.round(power * 100) / 100, ...(ctrl && { ctrl }) }), ...(twin && { twin }) };
  const dbl = d[0] === d[1];
  if (p.jail > 0) {
    emit(g, { t: "roll", p: pi, d, dbl, how: "jail", ...pw });
    if (dbl) {
      p.jail = 0;
      emit(g, { t: "free", p: pi, why: "더블" });
      g.dice = d;
      // 수리소에서 나온 더블은 한 번 더 굴리지 않음
      return walk(g, pi, d[0] + d[1]);
    }
    p.jail--;
    g.prompt = null;
    return endTurn(g);
  }
  g.dice = d;
  emit(g, { t: "roll", p: pi, d, dbl, ...pw });
  if (hasPost(g, pi)) {
    g.prompt = { k: "post", p: pi, dice: d, steps: d[0] + d[1] };
    return;
  }
  commitMove(g, pi, d[0] + d[1]);
}

function reroll(g: Game, pi: number, why: "reroll"): void {
  const { d, twin } = rollDice(g, pi);
  g.dice = d;
  emit(g, { t: "roll", p: pi, d, dbl: d[0] === d[1], how: why, ...(twin && { twin }) });
  if (hasPost(g, pi)) {
    g.prompt = { k: "post", p: pi, dice: d, steps: d[0] + d[1] };
    return;
  }
  commitMove(g, pi, d[0] + d[1]);
}

/** 원하는 눈 — 더블 아님 (나눌 수 있게 보여 줄 주사위만 만듦) */
function pickRoll(g: Game, pi: number, n: number, how: "pick"): void {
  let a = Math.min(6, Math.max(1, n - 1));
  let b = n - a;
  // 같은 눈이면 하나를 옮겨 더블로 안 보이게 (2 · 12 는 어쩔 수 없음)
  if (a === b && a > 1 && b < 6) {
    a--;
    b++;
  }
  const d: [number, number] = [a, b];
  g.dice = d;
  emit(g, { t: "roll", p: pi, d, dbl: false, how });
  g.players[pi].doubles = 0;
  g.again = false;
  return walk(g, pi, n);
}

/** 이동 확정: 더블 셈 · 세 번이면 수리소 */
function commitMove(g: Game, pi: number, steps: number): void {
  const p = g.players[pi];
  const d = g.dice!;
  const dbl = d[0] === d[1];
  if (dbl) {
    p.doubles++;
    if (p.fx.doubleBonus > 0) {
      const amt = Math.round(p.fx.doubleBonus);
      p.cash += amt;
      emit(g, { t: "salary", p: pi, amt, half: true, why: "더블 보너스" });
    }
    if (p.doubles >= 3) {
      p.doubles = 0;
      g.again = false;
      return sendJail(g, pi);
    }
    g.again = true;
  } else g.again = false;
  g.prompt = null;
  walk(g, pi, steps);
}

/** 앞으로 steps 칸 (갈림길을 지나면 먼저 물음) */
function walk(g: Game, pi: number, steps: number, fork?: number): void {
  const p = g.players[pi];
  const m = mapOf(g);
  // 갈림길: 지금 서 있거나 지나가게 되면 물음 (고른 뒤 fork 로 다시 들어옴)
  if (m.junction !== undefined && fork === undefined) {
    let s = p.pos;
    for (let k = 0; k < steps; k++) {
      if (s === m.junction) {
        g.prompt = { k: "fork", p: pi, opts: [...m.tiles[m.junction].next], steps };
        return;
      }
      s = nextSlot(g, s);
    }
  }
  const path: number[] = [];
  let s = p.pos;
  for (let k = 0; k < steps; k++) {
    s = nextSlot(g, s, s === m.junction ? fork : undefined);
    path.push(s);
  }
  // 폴짝 · 묵직한 주사위: 남 땅에 서게 되면 더 감
  const foeAt = (slot: number) => {
    const t = g.tiles[tileAt(g, slot)];
    return t.owner >= 0 && t.owner !== pi;
  };
  const base = path.length;
  let bonusWhy: string | undefined;
  if (p.hop && foeAt(s)) {
    for (let k = 0; k < 3 && foeAt(s); k++) {
      s = nextSlot(g, s, s === m.junction ? fork : undefined);
      path.push(s);
    }
    bonusWhy = "폴짝";
  } else if (p.fx.dodge > 0 && foeAt(s) && rnd(g.rng) < p.fx.dodge) {
    s = nextSlot(g, s, s === m.junction ? fork : undefined);
    path.push(s);
    bonusWhy = "묵직한 주사위";
  }
  moveAlong(g, pi, path, bonusWhy ? { bonus: path.length - base, bonusWhy } : {});
  if (g.over || !p.alive) return g.over ? undefined : endTurn(g);
  land(g, pi);
}

/** 길을 따라 이동 — 출발 · 골든 포털 월급, 출석 체크(지나가기만 해도) */
function moveAlong(g: Game, pi: number, path: number[], opt: { warp?: boolean; pull?: boolean; bonus?: number; bonusWhy?: string } = {}) {
  const p = g.players[pi];
  emit(g, { t: "move", p: pi, path, ...(opt.warp && { warp: true }), ...(opt.pull && { pull: true }), ...(opt.bonus && { bonus: opt.bonus, bonusWhy: opt.bonusWhy }) });
  path.forEach((s, k) => {
    if (!p.alive) return;
    const d = defAt(g, s);
    if (d.kind === "start") giveSalary(g, pi, 1);
    else if (d.kind === "start2") giveSalary(g, pi, RULE.start2);
    // 지나가는 칸 (마지막 칸 빼고): 주인이 출석 체크(passFee)를 가지고 있으면
    if (!opt.warp && k < path.length - 1 && ownable(d)) {
      const t = g.tiles[tileAt(g, s)];
      if (t.owner >= 0 && t.owner !== pi) {
        const ow = g.players[t.owner];
        if (ow.alive && ow.fx.passFee > 0) {
          const amt = Math.round(tollOf(g, tileAt(g, s)) * ow.fx.passFee);
          if (amt > 0) pay(g, pi, t.owner, amt, "출석 체크", tileAt(g, s));
        }
      }
    }
  });
  if (p.alive) p.pos = path[path.length - 1] ?? p.pos;
}

function giveSalary(g: Game, pi: number, k: number) {
  const p = g.players[pi];
  let amt = RULE.salary * k * (1 + p.fx.salary);
  if (g.town?.id === "boom") amt *= 1.5;
  amt = Math.round(amt);
  p.cash += amt;
  if (k === 1) p.laps++;
  emit(g, { t: "salary", p: pi, amt });
  if (p.debt > 0) {
    const r = Math.min(p.debt, Math.round(amt * RULE.loanRepay));
    p.debt -= r;
    p.cash -= r;
    emit(g, { t: "repay", p: pi, amt: r, left: p.debt });
  }
}

function warpTo(g: Game, pi: number, to: number): void {
  const p = g.players[pi];
  const m = mapOf(g);
  // 워프: 한 번에 그 자리로 — 출발 포털을 넘어가면(번호가 줄면) 월급 (cross 는 출발 칸으로 갈 때만)
  const passStart = to <= p.pos;
  g.prompt = null;
  emit(g, { t: "move", p: pi, path: [to], warp: true });
  if (passStart && m.tiles[g.order[to]].kind !== "start") giveSalary(g, pi, 1);
  if (m.tiles[g.order[to]].kind === "start") giveSalary(g, pi, 1);
  p.pos = to;
  land(g, pi);
}

function sendJail(g: Game, pi: number): void {
  const p = g.players[pi];
  const m = mapOf(g);
  const j = g.order.findIndex((t) => m.tiles[t].kind === "jail");
  g.prompt = null;
  p.warp = false;
  emit(g, { t: "move", p: pi, path: [j], warp: true });
  p.pos = j;
  if (p.fx.jailFree) {
    emit(g, { t: "free", p: pi, why: "바로 나감" });
  } else {
    p.jail = RULE.jailTurns;
    emit(g, { t: "jail", p: pi, turns: p.jail });
  }
  g.again = false;
  endTurn(g);
}

/* ───────────── 칸에 섬 ───────────── */

function land(g: Game, pi: number): void {
  const p = g.players[pi];
  const tile = tileAt(g, p.pos);
  const d = mapOf(g).tiles[tile];
  const t = g.tiles[tile];
  switch (d.kind) {
    case "city":
    case "spot": {
      if (t.owner < 0) return offerBuy(g, pi, tile, -1);
      if (t.owner === pi) return offerBuy(g, pi, tile, t.lv);
      // 남의 땅: 통행료 (모자라면 대출 물어봄)
      const due = tollDue(g, pi, tile);
      const lands = sellList(g, pi);
      const canLoan = p.loans < RULE.loanTimes;
      if (due.amt > p.cash && (canLoan || lands.length)) {
        const need = due.amt - p.cash;
        g.prompt = { k: "loan", p: pi, tile, amt: due.amt, need, debt: Math.round(need * RULE.loanRate), sell: sellValue(g, pi), shock: due.shock, ...(due.by.length && { orig: due.orig, by: due.by }), canLoan, lands };
        return;
      }
      if (due.amt > 0) pay(g, pi, t.owner, due.amt, "통행료", tile, due.shock, due);
      return afterToll(g, pi, tile);
    }
    case "box":
      return drawCard(g, pi);
    case "jail":
      if (p.fx.jailFree) {
        emit(g, { t: "free", p: pi, why: "바로 나감" });
        return endTurn(g);
      }
      p.jail = RULE.jailTurns;
      g.again = false;
      emit(g, { t: "jail", p: pi, turns: p.jail });
      return endTurn(g);
    case "fest": {
      const mine = ownedCities(g, pi);
      if (!mine.length) {
        emit(g, { t: "nope", p: pi, why: "축제를 열 내 땅이 없어요" });
        return endTurn(g);
      }
      g.prompt = { k: "fest", p: pi, tiles: mine };
      return;
    }
    case "warp":
      p.warp = true;
      g.again = false;
      return endTurn(g);
    case "rail": {
      // 기차역: 다른 역으로 바로 (또는 남기)
      const m = mapOf(g);
      const opts = g.order.map((t, s) => (m.tiles[t].kind === "rail" && s !== p.pos ? s : -1)).filter((s) => s >= 0);
      if (!opts.length) return endTurn(g);
      g.prompt = { k: "rail", p: pi, opts };
      return;
    }
    case "start": {
      // 출발 포털에 딱 서면: 내 땅 하나 골라 더 짓기
      const opts = startBuildable(g, pi);
      if (!opts.length) {
        emit(g, { t: "nope", p: pi, why: ownedCities(g, pi).length ? "더 지을 수 있는 내 땅이 없어요" : "아직 가진 땅이 없어요" });
        return endTurn(g);
      }
      g.prompt = { k: "start", p: pi, tiles: opts };
      return;
    }
    case "tax": {
      const inv = assetsOf(g, pi) - p.cash;
      const amt = Math.max(RULE.taxMin, Math.round(inv * RULE.taxRate));
      pay(g, pi, -1, amt, "세금");
      return endTurn(g);
    }
    case "bonus": {
      // 기본 보너스 + 쌓인 잭팟 전부
      const pot = g.pot ?? 0;
      const amt = RULE.bonus + pot;
      p.cash += amt;
      g.pot = 0;
      emit(g, { t: "salary", p: pi, amt, half: true, why: pot > 0 ? "황금 다리 잭팟" : "황금 다리", ...(pot > 0 && { pot }) });
      return endTurn(g);
    }
    default:
      return endTurn(g);
  }
}

const ownedCities = (g: Game, pi: number) =>
  mapOf(g)
    .tiles.map((d, i) => (d.kind === "city" && g.tiles[i].owner === pi ? i : -1))
    .filter((i) => i >= 0);

/** 출발 포털에서 지을 수 있는 내 땅 (랜드마크 전 · 다음 단계 살 돈 있음) */
export function startBuildable(g: Game, pi: number): number[] {
  const p = g.players[pi];
  return ownedCities(g, pi).filter((i) => {
    const items = buyItems(g, i, g.tiles[i].lv);
    return items.length > 0 && Math.min(...items.map((k) => itemCost(g, pi, i, k))) <= p.cash;
  });
}

/** 그 칸에서 지금 고를 수 있는 것 (0 땅 · 1 오두막 · 2 하우스 · 3 타워 · 4 랜드마크) */
function buyItems(g: Game, tile: number, from: number): number[] {
  const d = mapOf(g).tiles[tile];
  if (d.kind === "spot") return from < 0 ? [0] : [];
  if (d.kind !== "city") return [];
  if (from < 0) return [0, 1, 2, 3].filter((k) => k <= RULE.buyMaxLv);
  if (from >= LANDMARK) return [];
  if (from === 3) return [LANDMARK];
  const has = bitsOf(g.tiles[tile]);
  return [1, 2, 3].filter((k) => !((has >> (k - 1)) & 1));
}

/** 하나씩 값 (땅값은 할인 없음) */
function itemCost(g: Game, pi: number, tile: number, k: number): number {
  const d = mapOf(g).tiles[tile];
  if (!d.price) return 0;
  if (k === 0) return d.price;
  let m = 1 - g.players[pi].fx.build;
  if (g.town?.id === "build") m *= 0.7;
  return Math.round(d.price * RULE.cost[k] * m);
}

/** 사기 / 짓기 프롬프트 (from = 지금 단계, -1 = 빈 땅) */
function offerBuy(g: Game, pi: number, tile: number, from: number): void {
  const p = g.players[pi];
  const d = mapOf(g).tiles[tile];
  const items = buyItems(g, tile, from);
  if (!items.length) {
    if (d.kind === "spot" && from >= 0) emit(g, { t: "nope", p: pi, why: "명소는 더 지을 수 없어요", tile });
    return endTurn(g);
  }
  const costs = items.map((k) => itemCost(g, pi, tile, k));
  // 무료 공사권: 이번에 고를 수 있는 첫 건물 하나 무료
  if (p.keep.free && d.kind === "city") {
    const j = items.findIndex((k) => k >= 1);
    if (j >= 0) costs[j] = 0;
  }
  // 하나도 못 사면 넘어감 (빈 땅은 땅값부터)
  const need = from < 0 ? costs[0] : Math.min(...costs);
  if (need > p.cash) {
    emit(g, { t: "nope", p: pi, why: from < 0 ? "땅값이 모자라요" : items.includes(LANDMARK) ? "랜드마크 지을 돈이 모자라요" : "건물 지을 돈이 모자라요", tile, need });
    return endTurn(g);
  }
  g.prompt = { k: "buy", p: pi, tile, from, items, costs };
}

function build(g: Game, pi: number, tile: number, from: number, sel: number[], cost: number) {
  const p = g.players[pi];
  const t = g.tiles[tile];
  if (p.keep.free && sel.some((k) => k >= 1)) p.keep.free = 0;
  p.cash -= cost;
  t.owner = pi;
  const blds = sel.filter((k) => k >= 1 && k <= 3);
  if (from < 0) t.b = 0;
  else t.b = bitsOf(t);
  for (const k of blds) t.b |= 1 << (k - 1);
  if (sel.includes(LANDMARK)) {
    t.lv = LANDMARK;
    t.b = 7;
  } else t.lv = popcount(t.b);
  p.stat.built += blds.length + (sel.includes(LANDMARK) ? 1 : 0);
  if (t.lv === LANDMARK) p.stat.lm++;
  emit(g, { t: "buy", p: pi, tile, lv: t.lv, cost, b: t.b, top: Math.max(...sel) });
  checkWin(g, pi, tile);
}

/** 통행료 낸 뒤: 인수 물어보기 또는 끝 */
function afterToll(g: Game, pi: number, tile: number): void {
  const p = g.players[pi];
  if (g.over) return;
  if (!p.alive) return endTurn(g);
  const d = mapOf(g).tiles[tile];
  if (d.kind === "city" && g.tiles[tile].lv < LANDMARK) {
    const cost = acqCost(g, pi, tile);
    if (cost <= p.cash) {
      g.prompt = { k: "acq", p: pi, tile, cost };
      return;
    }
    emit(g, { t: "nope", p: pi, why: "인수 비용이 모자라요", tile, need: cost });
  } else if (d.kind === "city") emit(g, { t: "nope", p: pi, why: "랜드마크는 인수할 수 없어요", tile });
  return endTurn(g);
}

/** 땅을 다 팔면 받는 돈 */
export function sellValue(g: Game, pi: number): number {
  const m = mapOf(g);
  let v = 0;
  for (let i = 0; i < m.tiles.length; i++) if (g.tiles[i].owner === pi) v += Math.round(investedT(m.tiles[i].price ?? 0, g.tiles[i]) * RULE.sellRate);
  return v;
}

function payToll(g: Game, pi: number, tile: number, k = 1) {
  const due = tollDue(g, pi, tile, k);
  if (due.amt > 0) pay(g, pi, g.tiles[tile].owner, due.amt, "통행료", tile, due.shock, due);
}

/** 낼 통행료 (깎기 · 되감기 다 반영, 쓴 효과는 소모) */
function tollDue(g: Game, pi: number, tile: number, k = 1): { amt: number; shock: boolean; orig: number; by: string[] } {
  const p = g.players[pi];
  const t = g.tiles[tile];
  const owner = g.players[t.owner];
  let amt = tollOf(g, tile) * k;
  let shock = false;
  if (owner.fx.shock > 0 && rnd(g.rng) < owner.fx.shock) {
    amt = Math.round(amt * 1.5);
    shock = true;
  }
  const orig = Math.round(amt);
  const by: string[] = [];
  if (p.fx.tollPay > 0) {
    amt *= 1 - p.fx.tollPay;
    by.push("통행료 할인");
  }
  if (p.shield) {
    amt *= 1 - p.shield;
    p.shield = 0;
    by.push(CHAR[p.lo.char.id]?.active.name ?? "방패");
  }
  if (p.keep.half) {
    amt *= 0.5;
    p.keep.half = 0;
    by.push("반값 쿠폰");
  }
  amt = Math.round(amt);
  // 시간 주사위: 큰 통행료 한 번 되감기
  if (p.uses.rewind > 0 && amt >= RULE.rewindMin) {
    p.uses.rewind--;
    const back = Math.round(amt * Math.min(1, p.fx.rewind));
    amt -= back;
    emit(g, { t: "rewind", p: pi, amt: back });
  }
  return { amt, shock, orig, by };
}

function acquire(g: Game, pi: number, tile: number, cost: number): void {
  const p = g.players[pi];
  const t = g.tiles[tile];
  const from = t.owner;
  const ow = g.players[from];
  if (ow.fx.defendBlock > 0 && rnd(g.rng) < ow.fx.defendBlock) {
    emit(g, { t: "block", p: from, tile });
    return endTurn(g);
  }
  p.cash -= cost;
  ow.cash += cost;
  p.sale = 0;
  p.keep.acq = 0;
  t.owner = pi;
  if (ow.fest === tile) ow.fest = -1;
  p.stat.acq++;
  emit(g, { t: "acq", p: pi, from, tile, cost });
  if (p.fx.freeUpAfterAcq && t.lv < 3) {
    const has = bitsOf(t);
    const k = [1, 2, 3].find((x) => !((has >> (x - 1)) & 1))!;
    t.b = has | (1 << (k - 1));
    t.lv = popcount(t.b);
    emit(g, { t: "buy", p: pi, tile, lv: t.lv, cost: 0, b: t.b, top: k });
  }
  checkWin(g, pi, tile);
  if (g.over) return;
  // 인수한 뒤 더 지을 수 있으면
  return offerBuy(g, pi, tile, t.lv);
}

/* ───────────── 돈 ───────────── */

/** from → to(-1 = 은행). 모자라면 땅을 팔고, 그래도 모자라면 파산 */
function pay(g: Game, from: number, to: number, amt: number, why: string, tile?: number, shock?: boolean, cut?: { orig: number; by: string[] }) {
  const p = g.players[from];
  if (p.cash < amt) raise(g, from, amt);
  const paid = Math.min(p.cash, amt);
  p.cash -= paid;
  p.stat.paid += paid;
  if (to >= 0) {
    g.players[to].cash += paid;
    g.players[to].stat.got += paid;
  } else if (mapOf(g).tiles.some((d) => d.kind === "bonus")) g.pot = (g.pot ?? 0) + paid;
  emit(g, { t: "pay", from, to, amt: paid, why, ...(tile !== undefined && { tile }), ...(shock && { shock }), ...(cut && cut.by.length && cut.orig > amt && { orig: cut.orig, by: cut.by }) });
  if (paid < amt) bankrupt(g, from);
}

/** 돈이 모자라면 싼 땅부터 팖 (투자액의 절반) */
function raise(g: Game, pi: number, need: number) {
  const p = g.players[pi];
  const m = mapOf(g);
  const mine = m.tiles
    .map((d, i) => ({ i, v: g.tiles[i].owner === pi ? investedT(d.price ?? 0, g.tiles[i]) : -1 }))
    .filter((x) => x.v >= 0)
    .sort((a, b) => a.v - b.v || a.i - b.i);
  for (const x of mine) {
    if (p.cash >= need) break;
    sellTile(g, pi, x.i);
  }
}

/** 땅 하나 팔기 (넣은 돈의 절반) */
function sellTile(g: Game, pi: number, tile: number) {
  const p = g.players[pi];
  const d = mapOf(g).tiles[tile];
  const t = g.tiles[tile];
  const got = Math.round(investedT(d.price ?? 0, t) * RULE.sellRate);
  p.cash += got;
  t.owner = -1;
  t.lv = 0;
  t.b = 0;
  t.boost = 1;
  t.boostLeft = 0;
  if (p.fest === tile) p.fest = -1;
  emit(g, { t: "sell", p: pi, tile, got });
}

/** 팔 수 있는 내 땅 · 받는 돈 (싼 것부터) */
export function sellList(g: Game, pi: number): { tile: number; got: number }[] {
  const m = mapOf(g);
  return m.tiles
    .map((d, i) => (g.tiles[i].owner === pi ? { tile: i, got: Math.round(investedT(d.price ?? 0, g.tiles[i]) * RULE.sellRate) } : null))
    .filter((x): x is { tile: number; got: number } => !!x)
    .sort((a, b) => a.got - b.got || a.tile - b.tile);
}

function bankrupt(g: Game, pi: number) {
  const p = g.players[pi];
  p.alive = false;
  p.out = ++g.outN;
  p.cash = 0;
  for (const t of g.tiles)
    if (t.owner === pi) {
      t.owner = -1;
      t.lv = 0;
      t.b = 0;
      t.boost = 1;
      t.boostLeft = 0;
    }
  emit(g, { t: "bankrupt", p: pi });
  const left = alive(g);
  if (left.length <= 1) endGame(g, g.players.indexOf(left[0] ?? p), "bankrupt");
}

/* ───────────── 승리 ───────────── */

function checkWin(g: Game, pi: number, tile: number) {
  const m = mapOf(g);
  const d = m.tiles[tile];
  if (d.group !== undefined && groupOwned(g, d.group) === pi) {
    g.players[pi].stat.mono++;
    emit(g, { t: "mono", p: pi, group: d.group });
  }
  const groups = m.groups.filter((_, gi) => groupOwned(g, gi) === pi).length;
  if (groups >= RULE.triple) return endGame(g, pi, "triple");
  let lineThreat: { have: number; need: number } | null = null;
  const slot = slotOf(g, tile);
  for (let li = 0; li < m.lines.length; li++) {
    const tiles = m.lines[li].map((s) => (m.id === "orgel" ? g.order[s] : s)).filter((t) => ownable(m.tiles[t]));
    const have = tiles.filter((t) => g.tiles[t].owner === pi).length;
    if (tiles.length && have === tiles.length) return endGame(g, pi, "line", li);
    // 방금 산 칸이 있는 줄이 하나만 남았으면 (그 남은 칸을 남이 가졌어도 인수로 뺏을 수 있으니 알림)
    if (tiles.length > 2 && have === tiles.length - 1 && m.lines[li].includes(m.id === "orgel" ? slot : tile)) lineThreat = { have, need: tiles.length };
  }
  // 방금 동네 하나를 독점해서 트리플까지 하나 남음
  if (d.group !== undefined && groupOwned(g, d.group) === pi && groups === RULE.triple - 1) emit(g, { t: "threat", p: pi, kind: "triple", have: groups, need: RULE.triple });
  else if (lineThreat) emit(g, { t: "threat", p: pi, kind: "line", ...lineThreat });
  // 명소 독점: 명소를 전부 가지면 승리 (명소는 인수 · 스킬로 뺏을 수 없음)
  const spots = m.tiles.map((x, i) => (x.kind === "spot" ? i : -1)).filter((i) => i >= 0);
  const mine = spots.filter((t) => g.tiles[t].owner === pi).length;
  if (spots.length && mine === spots.length) return endGame(g, pi, "spot");
  if (d.kind === "spot" && spots.length > 1 && mine === spots.length - 1) emit(g, { t: "threat", p: pi, kind: "spot", have: mine, need: spots.length });
}

function finishByAssets(g: Game): void {
  const best = g.players
    .map((_, i) => i)
    .filter((i) => g.players[i].alive)
    .sort((a, b) => assetsOf(g, b) - assetsOf(g, a) || a - b)[0];
  endGame(g, best, "rounds");
}

function endGame(g: Game, winner: number, how: WinHow, detail?: number) {
  g.over = { winner, how, ...(detail !== undefined && { detail }) };
  g.prompt = null;
  emit(g, { t: "over", winner, how, ...(detail !== undefined && { detail }) });
}

/** 순위 (1등부터 자리 번호): 이긴 사람 → 살아 있는 사람 자산순 → 늦게 파산한 순 */
export function standings(g: Game): number[] {
  const idx = g.players.map((_, i) => i);
  const w = g.over?.winner ?? -1;
  return idx.sort((a, b) => {
    if (a === w) return -1;
    if (b === w) return 1;
    const pa = g.players[a],
      pb = g.players[b];
    if (pa.alive !== pb.alive) return pa.alive ? -1 : 1;
    if (!pa.alive) return pb.out - pa.out;
    return assetsOf(g, b) - assetsOf(g, a);
  });
}

/* ───────────── 럭키 박스 ───────────── */

function drawOne(g: Game): CardId {
  return CARD_IDS[pickW(g.rng, CARD_IDS.map((c) => CARDS[c].w))];
}

function drawCard(g: Game, pi: number): void {
  const p = g.players[pi];
  let card = drawOne(g);
  let alt: CardId | undefined;
  if (p.fx.cardLuck) {
    const b = drawOne(g);
    if (CARDS[b].good > CARDS[card].good) {
      alt = card;
      card = b;
    } else alt = b;
  }
  emit(g, { t: "card", p: pi, card, ...(alt && { alt }) });
  const m = mapOf(g);
  switch (card) {
    case "allow":
      p.cash += 300;
      emit(g, { t: "salary", p: pi, amt: 300, half: true, why: "용돈" });
      return endTurn(g);
    case "fine":
      pay(g, pi, -1, 100, "과속 딱지");
      return endTurn(g);
    case "toStart": {
      const s = g.order.findIndex((t) => m.tiles[t].kind === "start");
      emit(g, { t: "move", p: pi, path: [s], warp: true });
      p.pos = s;
      giveSalary(g, pi, 1);
      // 출발 포털에 딱 선 것과 같음: 내 땅 하나 골라 더 짓기
      return land(g, pi);
    }
    case "toJail":
      return sendJail(g, pi);
    case "toWarp": {
      const s = g.order.findIndex((t) => m.tiles[t].kind === "warp");
      g.again = false;
      // 워프 칸이 없는 맵(크로스 익스프레스): 지금 바로 갈 칸을 고름
      if (s < 0) {
        g.prompt = { k: "turn", p: pi, jail: false, warp: true };
        return;
      }
      emit(g, { t: "move", p: pi, path: [s], warp: true });
      p.pos = s;
      p.warp = true;
      return endTurn(g);
    }
    case "freeBuild":
      p.keep.free = 1;
      return endTurn(g);
    case "halfToll":
      p.keep.half = 1;
      return endTurn(g);
    case "acqSale":
      p.keep.acq = 1;
      return endTurn(g);
    case "festInvite": {
      const mine = ownedCities(g, pi);
      if (!mine.length) {
        emit(g, { t: "nope", p: pi, why: "축제를 열 내 땅이 없어요" });
        return endTurn(g);
      }
      g.prompt = { k: "fest", p: pi, tiles: mine };
      return;
    }
    case "back3": {
      const path: number[] = [];
      let s = p.pos;
      for (let k = 0; k < 3; k++) {
        s = prevSlot(g, s);
        path.push(s);
      }
      emit(g, { t: "move", p: pi, path });
      p.pos = s;
      return land(g, pi);
    }
    case "gift":
      for (const f of foes(g, pi)) {
        pay(g, pi, f, 50, "기부 천사");
        if (!p.alive || g.over) break;
      }
      return g.over ? undefined : endTurn(g);
    case "congrats":
      for (const f of foes(g, pi)) {
        pay(g, f, pi, 120, "축하 파티");
        if (g.over) return;
      }
      return endTurn(g);
  }
}

/* ───────────── 스킬 ───────────── */

/** 지금 쓸 수 있는 스킬 대상 (화면 · 봇) */
export function skillTargets(g: Game, pi: number): number[] {
  const p = g.players[pi];
  const m = mapOf(g);
  switch (SKILL_TARGET[p.skill.kind]) {
    case "ownCity":
      return ownedCities(g, pi);
    case "foeCity":
      return m.tiles.map((d, i) => (d.kind === "city" && g.tiles[i].owner >= 0 && g.tiles[i].owner !== pi && g.tiles[i].lv >= 1 && g.tiles[i].lv < LANDMARK ? i : -1)).filter((i) => i >= 0);
    case "foeLand":
      return m.tiles
        .map((d, i) => (d.kind === "city" && g.tiles[i].owner >= 0 && g.tiles[i].owner !== pi && g.tiles[i].lv < LANDMARK && buyoutCost(g, pi, i) <= p.cash ? i : -1))
        .filter((i) => i >= 0);
    case "foe":
      return foes(g, pi);
    default:
      return [];
  }
}
/** 숫자 고르는 스킬의 범위 */
export function skillRange(g: Game, pi: number): [number, number] | null {
  const s = g.players[pi].skill;
  if (s.kind === "pick") return [2, 12];
  if (s.kind === "fate") return [1, 6];
  if (s.kind === "dash") return [2, Math.round(s.mag)];
  if (s.kind === "bunny") return [0, 3];
  if (s.kind === "pull") return [1, Math.max(1, Math.round(s.mag))];
  return null;
}
export function canSkill(g: Game, pi: number): boolean {
  const p = g.players[pi];
  const pr = g.prompt;
  if (!pr || pr.p !== pi || p.cd > 0) return false;
  // 첫 바퀴(각자 첫 차례)엔 스킬 못 씀
  if (g.round <= 1) return false;
  const when = SKILL_TIME[p.skill.kind];
  if (pr.k === "turn" && (pr.jail || pr.warp)) return false;
  if (!((pr.k === "turn" && when === "pre") || (pr.k === "post" && when === "post"))) return false;
  const tg = SKILL_TARGET[p.skill.kind];
  if (tg === "ownCity" || tg === "foeCity" || tg === "foeLand" || tg === "foe") return skillTargets(g, pi).length > 0;
  return true;
}

function doSkill(g: Game, pi: number, a: { target?: number; n?: number }, when: "pre" | "post"): void {
  const p = g.players[pi];
  if (!canSkill(g, pi) || SKILL_TIME[p.skill.kind] !== when) bad("지금은 스킬을 쓸 수 없어요");
  const k = p.skill.kind;
  const tg = SKILL_TARGET[k];
  const name = CHAR[p.lo.char.id]?.active.name ?? "스킬";
  const targets = skillTargets(g, pi);
  if ((tg === "ownCity" || tg === "foeCity" || tg === "foeLand" || tg === "foe") && !targets.includes(a.target ?? -9)) bad("대상을 골라 주세요");
  const range = skillRange(g, pi);
  if (range && (k !== "pull" || a.n !== undefined)) {
    const n = a.n ?? -1;
    if (!(Number.isInteger(n) && n >= range[0] && n <= range[1])) bad(`${range[0]}~${range[1]} 중에서 골라 주세요`);
  }
  p.cd = p.skill.cd + 1; // 다음 내 차례 시작에 하나 줄어서 딱 cd 차례 쉼
  p.stat.skill++;
  const mag = p.skill.mag;
  const ev: Ev & { t: "skill" } = { t: "skill", p: pi, kind: k, name, ...(a.target !== undefined && { target: a.target }), ...(a.n !== undefined && { n: a.n }) };
  switch (k) {
    case "reroll":
      emit(g, ev);
      return reroll(g, pi, "reroll");
    case "bunny": {
      emit(g, ev);
      const pr = g.prompt as Extract<Prompt, { k: "post" }>;
      return commitMove(g, pi, pr.steps + (a.n ?? 0));
    }
    case "boost":
    case "fireworks": {
      const m = mapOf(g);
      const grp = m.tiles[a.target!].group;
      // 같은 동네의 내 땅 전부
      const tiles = m.tiles.map((d, i) => (d.kind === "city" && d.group === grp && g.tiles[i].owner === pi ? i : -1)).filter((i) => i >= 0);
      if (k === "fireworks") {
        // + 양옆 두 칸 안의 내 땅
        const s = slotOf(g, a.target!);
        const near = [prevSlot(g, s), prevSlot(g, prevSlot(g, s)), nextSlot(g, s), nextSlot(g, nextSlot(g, s))];
        for (const ns of near) {
          const t = g.order[ns];
          if (g.tiles[t].owner === pi && m.tiles[t].kind === "city" && !tiles.includes(t)) tiles.push(t);
        }
      }
      for (const t of tiles) {
        g.tiles[t].boost = mag;
        g.tiles[t].boostLeft = RULE.boostRounds;
      }
      ev.tiles = tiles;
      emit(g, ev);
      return;
    }
    case "shield":
      p.shield = mag;
      emit(g, ev);
      return;
    case "sale":
      p.sale = mag;
      emit(g, ev);
      return;
    case "hop":
      p.hop = true;
      emit(g, ev);
      return;
    case "freeze":
      g.players[a.target!].frozen = 1;
      emit(g, ev);
      return;
    case "concert": {
      emit(g, ev);
      for (const f of foes(g, pi)) {
        const amt = Math.round(g.players[f].cash * mag);
        if (amt > 0) pay(g, f, pi, amt, "팬 사인회");
        if (g.over) return;
      }
      return;
    }
    case "debug": {
      const t = g.tiles[a.target!];
      // 가장 높은 건물 하나 허묾 (랜드마크면 랜드마크만)
      if (t.lv >= LANDMARK) {
        t.lv = 3;
        t.b = 7;
        ev.lost = LANDMARK;
      } else {
        const has = bitsOf(t);
        const k = [3, 2, 1].find((x) => (has >> (x - 1)) & 1);
        t.b = k ? has & ~(1 << (k - 1)) : 0;
        t.lv = popcount(t.b);
        if (k) ev.lost = k;
      }
      emit(g, ev);
      return;
    }
    case "pull": {
      const n = a.n ?? Math.max(1, Math.round(mag));
      ev.n = n;
      emit(g, ev);
      const f = g.players[a.target!];
      const path: number[] = [];
      let s = f.pos;
      for (let i = 0; i < n; i++) {
        s = nextSlot(g, s);
        path.push(s);
      }
      moveAlong(g, a.target!, path, { pull: true });
      if (g.over) return;
      if (f.alive) {
        const tile = tileAt(g, f.pos);
        const tt = g.tiles[tile];
        if (tt.owner === pi) payToll(g, a.target!, tile, p.fx.pullPay || 1);
        else if (tt.owner >= 0 && tt.owner !== a.target) payToll(g, a.target!, tile);
      }
      return;
    }
    case "dash": {
      emit(g, ev);
      g.dice = null;
      g.again = false;
      p.doubles = 0;
      g.prompt = null;
      return walk(g, pi, a.n!);
    }
    case "pick":
      emit(g, ev);
      return pickRoll(g, pi, a.n!, "pick");
    case "fate": {
      emit(g, ev);
      const d: [number, number] = [a.n!, a.n!];
      g.dice = d;
      emit(g, { t: "roll", p: pi, d, dbl: true, how: "pick" });
      return commitMove(g, pi, d[0] + d[1]);
    }
    case "buyout": {
      const tile = a.target!;
      const t = g.tiles[tile];
      const from = t.owner;
      const ow = g.players[from];
      const cost = buyoutCost(g, pi, tile);
      emit(g, ev);
      if (ow.fx.defendBlock > 0 && rnd(g.rng) < ow.fx.defendBlock) {
        emit(g, { t: "block", p: from, tile });
        return;
      }
      p.cash -= cost;
      ow.cash += cost;
      p.sale = 0;
      t.owner = pi;
      if (ow.fest === tile) ow.fest = -1;
      p.stat.acq++;
      emit(g, { t: "acq", p: pi, from, tile, cost });
      checkWin(g, pi, tile);
      return;
    }
    case "encore":
      p.encore = true;
      emit(g, ev);
      return;
  }
}

/** 판 상태 복사 (봇 미리 보기 · 시뮬) */
export const cloneGame = (g: Game): Game => JSON.parse(JSON.stringify(g)) as Game;
