/*
 * 픽셀 타운 서바이버 — 판 시뮬레이션 (60틱 고정). 화면은 이 상태를 읽어서 그리기만 함.
 * 브라우저 · 서버(검증 · 밸런스 시뮬) 공용 — "@/" import 금지.
 */
import { rnd, rndInt, type Rng } from "../defense/rng";
import {
  AWAKEN_NEED,
  BASE_STATS,
  BASE_WEAPONS,
  BLESS,
  boxCost,
  DASH_CD,
  depthMul,
  EVOLUTIONS,
  FLAG_CHARGE,
  OT_STEP,
  SHRINE_CHARGE,
  TRIAL_R,
  TRIAL_SEC,
  DT,
  ENEMIES,
  EVENTS,
  FINAL_BOSS,
  FUSIONS,
  HEROES,
  MAX_PASSIVES,
  MAX_WEAPONS,
  PASSIVES,
  PASSIVE_IDS,
  RUN_SEC,
  SHARED_WEAPONS,
  ULT_NEED,
  VIEW_H,
  VIEW_W,
  WAVES,
  WEAPONS,
  xpNeed,
  type EnemyDef,
  type EnemyKind,
  type FlagBuff,
  type HeroId,
  type ThingKind,
  type PassiveId,
  type PickupKind,
  type Rarity,
  type Stats,
  type WeaponId,
  type WeaponLv,
} from "./data";
import { emptyQ, type RunQ } from "./quests";
import { BASE_RELICS, RELICS, RELIC_IDS, relicMax, relicPrice, relicRarityWeights, type RelicId, type RelicRarity } from "./relics";

/* ───────────── 상태 ───────────── */

export interface Input {
  /** 이동 (-1~1, 길이 ≤ 1) */
  mx: number;
  my: number;
  dash: boolean;
  ult: boolean;
}

export interface BossAI {
  phase: "chase" | "warn" | "dash" | "ring" | "summon" | "slam";
  /** 나온 뒤 흐른 시간 (격노 타이머) */
  age: number;
  /** 시간 초과 격노 */
  rage: boolean;
  t: number;
  dx: number;
  dy: number;
  step: number;
  enraged: boolean;
}

export interface Enemy {
  id: number;
  alive: boolean;
  kind: EnemyKind;
  def: EnemyDef;
  x: number;
  y: number;
  /** 넉백 속도 */
  kx: number;
  ky: number;
  hp: number;
  maxHp: number;
  r: number;
  speed: number;
  dmg: number;
  xp: number;
  elite: boolean;
  flash: number;
  slow: number;
  /** 기절 · 잠 (못 움직임) */
  stun: number;
  /** 더 아프게 맞음 (몽글 꿈나라) */
  vuln: number;
  /** 얼음 (얼음 사탕 — 그림용, 못 움직이는 건 stun) */
  ice: number;
  /** 독: 남은 시간 · 초당 피해 */
  poison: number;
  poisonD: number;
  /** 무기 칸마다 마지막으로 맞은 시각 (계속 닿는 무기의 재타격 간격) */
  hitAt: number[];
  /** 걷기 애니메이션 · 흔들림 */
  t: number;
  face: 1 | -1;
  boss: BossAI | null;
}

export interface Shot {
  alive: boolean;
  w: WeaponId;
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  pierce: number;
  life: number;
  t: number;
  kb: number;
  /** 폭발 반지름 (0 = 안 터짐) */
  boom: number;
  /** 유도 대상 */
  target: number;
  /** 돌아오는지 (부메랑) */
  back: boolean;
  hits: number[];
  /** 늑대 (빨간망토 필살기): 크게 그림 */
  wolf?: boolean;
}

/** 시간이 지나며 피해를 주는 자리 (택배 낙하 · 불바다 · 회전 차기 그림) */
export interface Zone {
  alive: boolean;
  k: "drop" | "fire" | "rain" | "spin" | "moon" | "grenade" | "cone" | "whip" | "pulse" | "shell" | "slam";
  /** 방향 (cone · whip) */
  dx: number;
  dy: number;
  /** 이미 맞은 적 (pulse) */
  hits: number[];
  slot: number;
  x: number;
  y: number;
  r: number;
  dmg: number;
  /** 터지기 전 지연 (drop) · 남은 시간 */
  delay: number;
  life: number;
  t: number;
  tick: number;
  kb: number;
  /** 플레이어를 따라감 (spin) */
  follow: boolean;
}

export interface Gem {
  alive: boolean;
  x: number;
  y: number;
  v: number;
  pull: boolean;
  sp: number;
}

export interface Pickup {
  alive: boolean;
  k: PickupKind;
  x: number;
  y: number;
  v: number;
  pull: boolean;
  sp: number;
  t: number;
}

export interface EBullet {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  life: number;
}

/** 부수면 아이템이 나오는 가로등 */
export interface Prop {
  alive: boolean;
  x: number;
  y: number;
  hp: number;
}

/** 맵 오브젝트 (성소 · 상인 · 상자 · 시련 …) */
export interface Thing {
  id: number;
  alive: boolean;
  k: ThingKind;
  x: number;
  y: number;
  /** 충전 진행 (초) · 시련 남은 시간 */
  t: number;
  /** 시련 진행 중 */
  on: boolean;
  /** 상자 값 */
  cost: number;
  /** 상인 · 우물이 내놓은 유물 (다시 와도 같은 것) */
  offers?: RelicId[];
}

export interface Bless {
  k: keyof Stats;
  v: number;
  rar: RelicRarity;
}

export interface WeaponSlot {
  id: WeaponId;
  lv: number;
  /** 고유 무기 각성 */
  awake?: boolean;
  t: number;
  /** 회전 각 (orbit) */
  ang: number;
  /** 남은 연사 (facing · spin) */
  burst: number;
  burstT: number;
  dmgDone: number;
}

export interface Card {
  k: "weapon" | "passive" | "fuse" | "evo" | "awake" | "relic" | "coin" | "heal";
  id?: WeaponId | PassiveId | RelicId;
  /** 지금 레벨 (0 = 새로) */
  from: number;
  /** 받으면 레벨 */
  to: number;
  rarity: Rarity;
}

export type Pause =
  | { k: "level"; cards: Card[]; jackpot: boolean }
  | { k: "chest"; items: Card[]; coins: number; first: boolean; big: boolean }
  /** 충전 성소: 능력치 셋 중 하나 */
  | { k: "bless"; opts: Bless[]; gold: boolean }
  /** 떠돌이 상인 */
  | { k: "shop"; offers: { id: RelicId; price: number }[]; thing: number }
  /** 소원 우물 */
  | { k: "wish"; offers: RelicId[]; thing: number }
  /** 시계지기 처치 — 정산 / 오버타임 */
  | { k: "dawn" };

export type Ev =
  | { t: "dmg"; x: number; y: number; v: number; crit: boolean }
  | { t: "kill"; x: number; y: number; kind: EnemyKind; elite: boolean; boss: boolean }
  | { t: "gem"; v: number }
  | { t: "lvl"; lv: number }
  | { t: "pick"; k: PickupKind; v: number }
  | { t: "hurt"; v: number }
  | { t: "boom"; x: number; y: number; r: number; c: string }
  | { t: "bolt"; x: number; y: number; r: number }
  | { t: "dice"; x: number; y: number; face: number }
  | { t: "fire"; w: WeaponId }
  | { t: "chest" }
  | { t: "boss"; kind: EnemyKind; arena: boolean }
  | { t: "warn"; text: string }
  | { t: "ult"; hero: HeroId }
  | { t: "assist"; hero: HeroId }
  | { t: "dash" }
  | { t: "fuse"; id: WeaponId }
  | { t: "prop"; x: number; y: number }
  | { t: "evo"; id: WeaponId }
  | { t: "awake"; id: WeaponId }
  | { t: "relic"; id: RelicId }
  | { t: "thing"; k: ThingKind; text: string }
  | { t: "nogold"; need: number }
  | { t: "trial"; ok: boolean }
  | { t: "rage"; name: string }
  | { t: "ot"; lv: number }
  | { t: "zap"; x0: number; y0: number; x1: number; y1: number }
  | { t: "shield" }
  | { t: "win" }
  | { t: "dead" };

export interface Player {
  x: number;
  y: number;
  hp: number;
  /** 바라보는 방향 (단위 벡터) */
  fx: number;
  fy: number;
  face: 1 | -1;
  moving: boolean;
  inv: number;
  dashT: number;
  dashCd: number;
  dx: number;
  dy: number;
  ult: number;
  /** 필살기 진행 (카이 돌진) */
  ultT: number;
  lv: number;
  xp: number;
  kills: number;
  /** 판 안 금화 (상자 · 상인 · 성소에 씀) */
  gold: number;
  revive: number;
}

export interface Run {
  hero: HeroId;
  seed: number;
  rng: Rng;
  t: number;
  tick: number;
  p: Player;
  stats: Stats;
  weapons: WeaponSlot[];
  passives: { id: PassiveId; lv: number }[];
  enemies: Enemy[];
  shots: Shot[];
  zones: Zone[];
  gems: Gem[];
  pickups: Pickup[];
  bullets: EBullet[];
  props: Prop[];
  pause: Pause | null;
  /** 아직 고르지 않은 레벨업 수 */
  pending: number;
  rerolls: number;
  skips: number;
  over: boolean;
  win: boolean;
  /** 지금 보스 (적 id, 없으면 -1) */
  bossId: number;
  arena: { x: number; y: number; hw: number; hh: number } | null;
  nextEvent: number;
  propT: number;
  spawnAcc: number;
  chests: number;
  fused: WeaponId[];
  nextId: number;
  ev: Ev[];
  /** 이번 판 받은 피해 합 · 최고 콤보 등 결과용 */
  taken: number;
  /** 버프 남은 시간: 모든 공격 치명타 · 쿨타임 빠르게 */
  buff: { crit: number; haste: number };
  /** 카이 · 제나 돌진 남은 횟수 */
  dashes: number;
  /** 응원 동료 */
  sup: HeroId[];
  /** 판 밖 보너스 (강화 · 동료 · 영구 강화) */
  bonus: Partial<Stats>;
  /** 동료 필살기 거들기 대기 */
  assist: { hero: HeroId; t: number }[];
  /** 유물 (개수) */
  relics: Partial<Record<RelicId, number>>;
  /** 얻은 순서 (화면 · 결과) */
  relicOrder: RelicId[];
  /** 성소 축복 합 */
  blessed: Partial<Stats>;
  things: Thing[];
  thingT: number;
  /** 종류별로 다음에 나올 수 있는 시각 */
  cool: Partial<Record<ThingKind, number>>;
  /** 상자 연 수 (값이 오름) */
  boxes: number;
  /** 탐욕 저주 (적 체력 · 수 · 경험치 +) */
  curse: number;
  /** 다음 상인 · 우물 */
  merchantT: number;
  /** 정해진 시각에 나오는 것 (시련 · 우물) */
  sched: { at: number; k: ThingKind }[];
  /** 레벨업 카드에 나올 수 있는 것 (해금) */
  pool: { weapons: WeaponId[]; relics: RelicId[] };
  banish: number;
  banned: string[];
  depth: number;
  /** 오버타임 (클리어 뒤 계속) */
  ot: boolean;
  otT: number;
  otLv: number;
  /** 마지막으로 맞은 시각 */
  hitAt: number;
  bubbleT: number;
  balloonT: number;
  /** 퀘스트용 */
  q: RunQ;
  /** 깃발 버프 */
  flag: { k: FlagBuff; t: number } | null;
}

/* ───────────── 만들기 ───────────── */

function zone(z: Omit<Zone, "alive" | "dx" | "dy" | "hits"> & Partial<Pick<Zone, "dx" | "dy">>): Zone {
  return { alive: true, dx: 0, dy: 0, hits: [], ...z };
}

export interface RunOpts {
  /** 응원 동료 (최대 2) */
  sup?: HeroId[];
  revive?: number;
  /** 다시 뽑기 · 건너뛰기 · 카드 지우기 (해금 + 영구 강화 합) */
  rerolls?: number;
  skips?: number;
  banish?: number;
  /** 시작 금화 */
  gold?: number;
  /** 해금된 공용 무기 · 유물 (없으면 기본) */
  weapons?: WeaponId[];
  relics?: RelicId[];
  /** 밤의 깊이 */
  depth?: number;
}

export function newRun(hero: HeroId, seed: number, bonus: Partial<Stats> = {}, opts: RunOpts = {}): Run {
  const h = HEROES[hero];
  const stats: Stats = { ...BASE_STATS };
  addStats(stats, h.passive.stat);
  addStats(stats, bonus);
  const r: Run = {
    hero,
    seed,
    rng: { r: seed | 0 },
    t: 0,
    tick: 0,
    p: { x: 0, y: 0, hp: 0, fx: 1, fy: 0, face: 1, moving: false, inv: 0, dashT: 0, dashCd: 0, dx: 1, dy: 0, ult: 0, ultT: 0, lv: 1, xp: 0, kills: 0, gold: opts.gold ?? 0, revive: 0 },
    stats,
    weapons: [],
    passives: [],
    enemies: [],
    shots: [],
    zones: [],
    gems: [],
    pickups: [],
    bullets: [],
    props: [],
    pause: null,
    pending: 0,
    rerolls: opts.rerolls ?? 1,
    skips: opts.skips ?? 1,
    over: false,
    win: false,
    bossId: -1,
    arena: null,
    nextEvent: 0,
    propT: 8,
    spawnAcc: 0,
    chests: 0,
    fused: [],
    nextId: 1,
    ev: [],
    taken: 0,
    buff: { crit: 0, haste: 0 },
    dashes: 0,
    sup: opts.sup ?? [],
    bonus: { ...bonus },
    assist: [],
    relics: {},
    relicOrder: [],
    blessed: {},
    things: [],
    thingT: 3,
    cool: {},
    boxes: 0,
    curse: 0,
    merchantT: 75,
    sched: [
      { at: 130, k: "trial" },
      { at: 200, k: "fountain" },
      { at: 350, k: "trial" },
      { at: 440, k: "fountain" },
      { at: 515, k: "trial" },
    ],
    pool: { weapons: opts.weapons ?? BASE_WEAPONS, relics: opts.relics ?? BASE_RELICS },
    banish: opts.banish ?? 0,
    banned: [],
    depth: Math.max(0, opts.depth ?? 0),
    ot: false,
    otT: 0,
    otLv: 0,
    hitAt: 0,
    bubbleT: 0,
    balloonT: 0,
    q: emptyQ(),
    flag: null,
  };
  r.p.hp = maxHp(r);
  r.p.revive = opts.revive ?? 0;
  giveWeapon(r, h.weapon, 1);
  // 처음 화면이 비어 보이지 않게 가로등 몇 개 · 시작하자마자 손맛이 오게 가까이 몹 한 무리
  for (let i = 0; i < 3; i++) spawnProp(r, 120 + i * 60);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    spawnEnemy(r, i % 3 ? "bat" : "slime", Math.cos(a) * 170, Math.sin(a) * 105);
  }
  return r;
}

function addStats(s: Stats, add: Partial<Stats>, k = 1) {
  for (const key of Object.keys(add) as (keyof Stats)[]) s[key] += (add[key] ?? 0) * k;
}

export const maxHp = (r: Run) => HEROES[r.hero].hp + r.stats.maxHp;

function recomputeStats(r: Run) {
  const s: Stats = { ...BASE_STATS };
  addStats(s, HEROES[r.hero].passive.stat);
  addStats(s, r.bonus);
  addStats(s, r.blessed);
  for (const ps of r.passives) addStats(s, PASSIVES[ps.id].per, ps.lv);
  for (const id of RELIC_IDS) {
    const n = r.relics[id];
    if (n && RELICS[id].stat) addStats(s, RELICS[id].stat!, n);
  }
  const before = maxHp(r);
  r.stats = s;
  // 최대 체력이 늘면 그만큼 채움
  const after = maxHp(r);
  if (after > before) r.p.hp += after - before;
  r.p.hp = Math.min(r.p.hp, after);
}

function giveWeapon(r: Run, id: WeaponId, lv: number) {
  const have = r.weapons.find((w) => w.id === id);
  if (have) {
    have.lv = Math.min(WEAPONS[id].lv.length, have.lv + lv);
    return;
  }
  r.weapons.push({ id, lv: Math.min(WEAPONS[id].lv.length, lv), t: 0.4, ang: 0, burst: 0, burstT: 0, dmgDone: 0 });
}

function givePassive(r: Run, id: PassiveId, lv: number) {
  const have = r.passives.find((x) => x.id === id);
  if (have) have.lv = Math.min(PASSIVES[id].max, have.lv + lv);
  else r.passives.push({ id, lv: Math.min(PASSIVES[id].max, lv) });
  recomputeStats(r);
}

/** 유물 얻기 */
function giveRelic(r: Run, id: RelicId) {
  const n = r.relics[id] ?? 0;
  if (n >= relicMax(id)) return;
  r.relics[id] = n + 1;
  if (!n) r.relicOrder.push(id);
  r.q.relics++;
  if (RELICS[id].rarity === 3) r.q.legends++;
  if (id === "phoenix") r.p.revive++;
  if (RELICS[id].stat) recomputeStats(r);
  r.ev.push({ t: "relic", id });
}
const rel = (r: Run, id: RelicId) => r.relics[id] ?? 0;

/** 진화: 바탕 무기 자리에 진화 무기 */
function evolve(r: Run, id: WeaponId) {
  const [base] = WEAPONS[id].evo!;
  const at = r.weapons.findIndex((w) => w.id === base);
  if (at < 0) return;
  r.weapons[at] = { id, lv: 1, t: 0.2, ang: 0, burst: 0, burstT: 0, dmgDone: r.weapons[at].dmgDone };
  r.q.evos++;
  r.ev.push({ t: "evo", id });
}

function awaken(r: Run, id: WeaponId) {
  const w = r.weapons.find((x) => x.id === id);
  if (!w || w.awake) return;
  w.awake = true;
  r.q.awakens++;
  r.ev.push({ t: "awake", id });
}

function fuse(r: Run, id: WeaponId) {
  const [a, b] = WEAPONS[id].fuse!;
  const ia = r.weapons.findIndex((w) => w.id === a);
  const wa = r.weapons[ia];
  r.weapons = r.weapons.filter((w) => w.id !== b);
  // 첫 재료 자리에 합체 무기
  const at = r.weapons.findIndex((w) => w.id === a);
  r.weapons[at] = { id, lv: 1, t: 0.2, ang: 0, burst: 0, burstT: 0, dmgDone: wa?.dmgDone ?? 0 };
  r.fused.push(id);
  r.q.fuses++;
  r.ev.push({ t: "fuse", id });
}

/* ───────────── 무기 수치 ───────────── */

interface W {
  dmg: number;
  cd: number;
  n: number;
  size: number;
  spd: number;
  pierce: number;
  dur: number;
  kb: number;
}
function wstat(r: Run, ws: WeaponSlot): W {
  const def = WEAPONS[ws.id];
  const b: WeaponLv = def.lv[Math.min(def.lv.length, ws.lv) - 1];
  const s = r.stats;
  const multi = def.pattern !== "aura" && def.pattern !== "spin";
  const aw = ws.awake ? 1 : 0;
  const haste = r.buff.haste > 0 || r.flag?.k === "haste";
  return {
    dmg: b.dmg * (1 + s.might) * (aw ? 1.6 : 1),
    cd: b.cd * Math.max(0.4, 1 - s.cooldown) * (haste ? 0.45 : 1) * (aw ? 0.85 : 1),
    n: b.n + (multi ? s.amount : 0) + (aw && multi ? 1 : 0),
    size: b.size * (1 + s.area) * (aw ? 1.2 : 1),
    spd: b.spd * (1 + s.pspeed),
    pierce: b.pierce,
    dur: b.dur * (1 + s.duration),
    kb: b.kb,
  };
}

/* ───────────── 공간 격자 (플레이어 중심) ───────────── */

const CELL = 24;
const GW = 60;
const GH = 40;
const head = new Int32Array(GW * GH);
let next = new Int32Array(1024);
let gx0 = 0;
let gy0 = 0;

function buildGrid(r: Run) {
  head.fill(-1);
  if (next.length < r.enemies.length) next = new Int32Array(r.enemies.length * 2);
  gx0 = Math.floor((r.p.x - (GW * CELL) / 2) / CELL);
  gy0 = Math.floor((r.p.y - (GH * CELL) / 2) / CELL);
  const es = r.enemies;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (!e.alive) continue;
    const cx = Math.floor(e.x / CELL) - gx0;
    const cy = Math.floor(e.y / CELL) - gy0;
    if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) continue;
    const c = cy * GW + cx;
    next[i] = head[c];
    head[c] = i;
  }
}

/** (x, y) 반지름 rad 안(적 몸 포함)의 적마다 fn — fn 이 true 를 돌려주면 멈춤 */
function near(r: Run, x: number, y: number, rad: number, fn: (e: Enemy) => boolean | void) {
  const reach = rad + 16;
  const c0 = Math.max(0, Math.floor((x - reach) / CELL) - gx0);
  const c1 = Math.min(GW - 1, Math.floor((x + reach) / CELL) - gx0);
  const r0 = Math.max(0, Math.floor((y - reach) / CELL) - gy0);
  const r1 = Math.min(GH - 1, Math.floor((y + reach) / CELL) - gy0);
  const es = r.enemies;
  for (let cy = r0; cy <= r1; cy++)
    for (let cx = c0; cx <= c1; cx++)
      for (let i = head[cy * GW + cx]; i >= 0; i = next[i]) {
        const e = es[i];
        if (!e.alive) continue;
        const dx = e.x - x;
        const dy = e.y - y;
        const rr = rad + e.r;
        if (dx * dx + dy * dy <= rr * rr && fn(e)) return;
      }
  // 격자 밖(아주 먼) 보스도 놓치지 않게
  if (r.bossId >= 0) {
    const b = r.enemies.find((e) => e.id === r.bossId && e.alive);
    if (b) {
      const cx = Math.floor(b.x / CELL) - gx0;
      const cy = Math.floor(b.y / CELL) - gy0;
      if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) {
        const dx = b.x - x;
        const dy = b.y - y;
        if (dx * dx + dy * dy <= (rad + b.r) ** 2) fn(b);
      }
    }
  }
}

function nearest(r: Run, x: number, y: number, maxD: number, skip?: Set<number>): Enemy | null {
  let best: Enemy | null = null;
  let bd = maxD * maxD;
  for (const e of r.enemies) {
    if (!e.alive || skip?.has(e.id)) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** 화면 안 적 */
function onScreen(r: Run, e: Enemy, pad = 0) {
  return Math.abs(e.x - r.p.x) < VIEW_W / 2 + pad && Math.abs(e.y - r.p.y) < VIEW_H / 2 + pad;
}

/* ───────────── 피해 ───────────── */

/** 유물 발동으로 나온 피해 (다시 발동하지 않게) */
const PROC = -2;

function hurt(r: Run, e: Enemy, dmg: number, slot: number, kb: number, fromX: number, fromY: number) {
  if (!e.alive) return;
  const s = r.stats;
  // 조건부 피해 (유물 · 깃발)
  let mul = 1;
  if (rel(r, "glasses") && e.hp >= e.maxHp * 0.9) mul += 0.25 * rel(r, "glasses");
  if (rel(r, "pillow") && !r.p.moving) mul += 0.2 * rel(r, "pillow");
  if (rel(r, "tailwind") && r.p.moving) mul += 0.1 * rel(r, "tailwind");
  if (r.flag?.k === "might") mul += 0.5;
  const whet = rel(r, "whetstone");
  const crit = r.buff.crit > 0 || rnd(r.rng) < 0.05 + s.luck * 0.015 + whet * 0.06;
  let cm = crit ? 2 + whet * 0.3 : 1;
  let mega = false;
  if (crit && rel(r, "fork") && rnd(r.rng) < 0.15 * rel(r, "fork")) {
    cm = 5 + whet * 0.3;
    mega = true;
  }
  const v = Math.max(1, Math.round(dmg * mul * cm * (e.vuln > 0 ? 1.5 : 1) * (0.9 + rnd(r.rng) * 0.2)));
  e.hp -= v;
  e.flash = 0.08;
  if (slot >= 0 && r.weapons[slot]) r.weapons[slot].dmgDone += Math.min(v, e.hp + v);
  if (kb > 0 && !e.def.boss) {
    const dx = e.x - fromX;
    const dy = e.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    const k = kb * (1 - e.def.heavy) * (e.elite ? 0.3 : 1);
    e.kx += (dx / d) * k;
    e.ky += (dy / d) * k;
  }
  r.ev.push({ t: "dmg", x: e.x, y: e.y - e.r, v, crit: crit || mega });
  // 사신의 낫: 조금 남은 일반 적은 바로
  const sc = rel(r, "scythe");
  if (sc && e.hp > 0 && !e.def.boss && !e.elite && e.hp <= e.maxHp * Math.min(0.24, 0.08 * sc)) e.hp = 0;
  if (e.hp <= 0) {
    kill(r, e);
    if (slot >= 0 && r.weapons[slot] && WEAPONS[r.weapons[slot].id].fx === "coin" && rnd(r.rng) < 0.3) dropPickup(r, "coin", e.x, e.y, 1);
  }
  if (slot !== PROC) procs(r, e, dmg);
}

/** 맞힐 때 발동하는 유물 */
function procs(r: Run, e: Enemy, dmg: number) {
  const fc = rel(r, "firecracker");
  if (fc && rnd(r.rng) < 0.07 * fc) {
    const rad = 24 * (1 + r.stats.area);
    r.ev.push({ t: "boom", x: e.x, y: e.y, r: rad, c: "#ff8a3d" });
    aoe(r, e.x, e.y, rad, dmg * 0.6, PROC, 20);
  }
  const ic = rel(r, "icecube");
  if (ic && e.alive && rnd(r.rng) < 0.06 * ic) {
    if (e.def.boss) e.slow = Math.max(e.slow, 1.5);
    else {
      e.stun = Math.max(e.stun, 1.2);
      e.ice = 1.2;
    }
  }
  const zp = rel(r, "zap");
  if (zp && rnd(r.rng) < 0.07 * zp) {
    let from: Enemy = e;
    const skip = new Set<number>([e.id]);
    for (let i = 0; i < 3; i++) {
      const n = nearest(r, from.x, from.y, 90, skip);
      if (!n) break;
      skip.add(n.id);
      r.ev.push({ t: "zap", x0: from.x, y0: from.y - 4, x1: n.x, y1: n.y - 4 });
      hurt(r, n, dmg * 0.8, PROC, 0, from.x, from.y);
      from = n;
    }
  }
  const po = rel(r, "poison");
  if (po && e.alive && rnd(r.rng) < 0.1 * po) {
    e.poison = 3;
    e.poisonD = Math.max(e.poisonD, dmg * 0.4);
  }
}

function aoe(r: Run, x: number, y: number, rad: number, dmg: number, slot: number, kb: number) {
  near(r, x, y, rad, (e) => {
    hurt(r, e, dmg, slot, kb, x, y);
  });
  hitProps(r, x, y, rad);
}

function hitProps(r: Run, x: number, y: number, rad: number) {
  for (const pr of r.props) {
    if (!pr.alive) continue;
    if ((pr.x - x) ** 2 + (pr.y - y) ** 2 <= (rad + 7) ** 2) breakProp(r, pr);
  }
}

function breakProp(r: Run, pr: Prop) {
  pr.alive = false;
  r.ev.push({ t: "prop", x: pr.x, y: pr.y });
  const x = rnd(r.rng);
  const k: PickupKind = x < 0.28 ? "meat" : x < 0.42 ? "magnet" : x < 0.56 ? "bomb" : x < 0.66 ? "bag" : "coin";
  dropPickup(r, k, pr.x, pr.y, k === "bag" ? 20 : k === "coin" ? 5 : 0);
}

function kill(r: Run, e: Enemy) {
  e.alive = false;
  const p = r.p;
  p.kills++;
  const fg = rel(r, "fang");
  if (fg && rnd(r.rng) < 0.04 * fg) p.hp = Math.min(maxHp(r), p.hp + 3);
  const bp = rel(r, "backpack");
  if (bp && rnd(r.rng) < 0.06 * bp) {
    const rad = 30 * (1 + r.stats.area);
    r.ev.push({ t: "boom", x: e.x, y: e.y, r: rad, c: "#ffb03a" });
    aoe(r, e.x, e.y, rad, 25 * (1 + r.stats.might) * (1 + r.t / 300), PROC, 30);
  }
  p.ult = Math.min(ULT_NEED, p.ult + (e.def.boss ? 40 : e.elite ? 15 : 1));
  r.ev.push({ t: "kill", x: e.x, y: e.y, kind: e.kind, elite: e.elite, boss: !!e.def.boss });
  dropGem(r, e.x, e.y, e.xp);
  if (e.def.boss) {
    dropPickup(r, "chest", e.x, e.y, 1);
    dropPickup(r, "bag", e.x + 14, e.y, 50);
    if (r.bossId === e.id) r.bossId = -1;
    const age = Math.max(1, Math.round(e.boss?.age ?? 0));
    if (e.kind === "boss_jelly") r.q.jelly = r.q.jelly || age;
    if (e.kind === FINAL_BOSS) {
      r.q.clock = r.q.clock || age;
      if (!r.win) {
        r.win = true;
        r.arena = null;
        r.ev.push({ t: "win" });
        // 정산할지 오버타임으로 더 버틸지
        r.pause = { k: "dawn" };
      }
    } else r.arena = null;
    return;
  }
  if (e.elite) {
    r.q.elites++;
    dropPickup(r, "chest", e.x, e.y, 0);
    return;
  }
  const x = rnd(r.rng);
  if (x < 0.035) dropPickup(r, "coin", e.x, e.y, 1 + Math.floor(r.t / 200));
  else if (x < 0.0205) dropPickup(r, "meat", e.x, e.y, 0);
  else if (x < 0.0215) dropPickup(r, "magnet", e.x, e.y, 0);
}

function dropGem(r: Run, x: number, y: number, v: number) {
  const alive = r.gems.length;
  if (alive >= 420) {
    // 너무 많으면 이미 있는 젬에 더함 (뱀서처럼)
    const g = r.gems[r.tick % alive];
    g.v += v;
    return;
  }
  r.gems.push({ alive: true, x, y, v, pull: false, sp: 0 });
}

function dropPickup(r: Run, k: PickupKind, x: number, y: number, v: number) {
  r.pickups.push({ alive: true, k, x, y, v, pull: false, sp: 0, t: 0 });
}

/* ───────────── 적 만들기 ───────────── */

function spawnEnemy(r: Run, kind: EnemyKind, x: number, y: number, elite = false): Enemy {
  const def = ENEMIES[kind];
  const dm = depthMul(r.depth);
  // 오버타임: 30초마다 체력 · 피해가 계속 오름
  const ot = 1 + r.otLv * 0.25;
  const hpMul = (def.boss ? 1 : 1 + r.t / 140) * dm.hp * (1 + r.curse) * ot;
  const e: Enemy = {
    id: r.nextId++,
    alive: true,
    kind,
    def,
    x,
    y,
    kx: 0,
    ky: 0,
    hp: def.hp * hpMul * (elite ? 14 : 1),
    maxHp: 0,
    r: def.r * (elite ? 1.7 : 1),
    speed: def.speed * (elite ? 0.9 : 1) * (0.92 + rnd(r.rng) * 0.16),
    dmg: def.dmg * (elite ? 1.5 : 1) * (1 + Math.min(r.t, 900) / 600) * dm.dmg * (1 + r.curse * 0.5) * (1 + r.otLv * 0.12),
    xp: def.xp * (elite ? 10 : 1) * (1 + r.curse * 0.5),
    elite,
    flash: 0,
    slow: 0,
    stun: 0,
    vuln: 0,
    ice: 0,
    poison: 0,
    poisonD: 0,
    hitAt: [-9, -9, -9, -9, -9, -9, -9, -9, -9, -9],
    t: rnd(r.rng) * 10,
    face: 1,
    boss: def.boss ? { phase: "chase", t: 2.5, dx: 0, dy: 0, step: 0, enraged: false, age: 0, rage: false } : null,
  };
  e.maxHp = e.hp;
  r.enemies.push(e);
  return e;
}

/** 화면 바깥 둘레에서 */
function ringPos(r: Run, rad = 300): [number, number] {
  const a = rnd(r.rng) * Math.PI * 2;
  // 화면 비율에 맞춰 타원으로 (16:9 화면에서 위아래는 덜 멀게)
  return [r.p.x + Math.cos(a) * rad, r.p.y + Math.sin(a) * rad * 0.62];
}

function waveAt(t: number) {
  let w = WAVES[0];
  for (const x of WAVES) if (t >= x.at) w = x;
  return w;
}

function pickKind(r: Run, mix: Partial<Record<EnemyKind, number>>): EnemyKind {
  const ks = Object.keys(mix) as EnemyKind[];
  let sum = 0;
  for (const k of ks) sum += mix[k]!;
  let x = rnd(r.rng) * sum;
  for (const k of ks) {
    x -= mix[k]!;
    if (x <= 0) return k;
  }
  return ks[0];
}

function spawnProp(r: Run, dist: number) {
  const a = rnd(r.rng) * Math.PI * 2;
  r.props.push({ alive: true, x: r.p.x + Math.cos(a) * dist, y: r.p.y + Math.sin(a) * dist * 0.6, hp: 1 });
}

/* ───────────── 한 틱 ───────────── */

export function step(r: Run, inp: Input) {
  if (r.pause || r.over) return;
  r.tick++;
  r.t += DT;
  r.buff.crit = Math.max(0, r.buff.crit - DT);
  r.buff.haste = Math.max(0, r.buff.haste - DT);
  r.bubbleT = Math.max(0, r.bubbleT - DT);
  r.balloonT = Math.max(0, r.balloonT - DT);
  if (r.flag && (r.flag.t -= DT) <= 0) r.flag = null;
  if (r.ot) {
    r.otT += DT;
    const lv = Math.floor(r.otT / OT_STEP);
    if (lv > r.otLv) {
      r.otLv = lv;
      r.ev.push({ t: "ot", lv });
    }
  }
  for (const a of r.assist) {
    a.t -= DT;
    if (a.t <= 0) {
      r.ev.push({ t: "assist", hero: a.hero });
      doUlt(r, a.hero, 0.4);
    }
  }
  if (r.assist.length) r.assist = r.assist.filter((a) => a.t > 0);
  buildGrid(r);
  movePlayer(r, inp);
  timeline(r);
  for (let i = 0; i < r.weapons.length; i++) fireWeapon(r, i);
  updateShots(r);
  updateZones(r);
  updateEnemies(r);
  updateBullets(r);
  updatePickups(r);
  updateThings(r);
  if (inp.ult) castUlt(r);
  compact(r);
  // 레벨업
  const p = r.p;
  while (p.xp >= xpNeed(p.lv)) {
    p.xp -= xpNeed(p.lv);
    p.lv++;
    r.pending++;
    r.ev.push({ t: "lvl", lv: p.lv });
  }
  if (r.pending > 0 && !r.pause && !r.over) openLevel(r);
  if (p.hp <= 0 && !r.over) {
    r.q.noHit = Math.max(r.q.noHit, Math.floor(r.t - r.hitAt));
    if (p.revive > 0) {
      p.revive--;
      p.hp = maxHp(r) * 0.5;
      p.inv = 2;
      screenBomb(r, false);
    } else {
      r.over = true;
      r.ev.push({ t: "dead" });
    }
  }
}

/** 시계지기 처치 뒤: true = 오버타임 도전 · false = 정산 */
export function dawnChoice(r: Run, more: boolean) {
  if (r.pause?.k !== "dawn") return;
  r.pause = null;
  if (!more) {
    r.over = true;
    return;
  }
  r.ot = true;
  r.otT = 0;
  r.otLv = 0;
  p_heal(r, 0.5);
  r.ev.push({ t: "ot", lv: 0 });
  if (r.pending > 0) openLevel(r);
}
const p_heal = (r: Run, k: number) => (r.p.hp = Math.min(maxHp(r), r.p.hp + maxHp(r) * k));

function movePlayer(r: Run, inp: Input) {
  const p = r.p;
  let mx = inp.mx;
  let my = inp.my;
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  p.moving = len > 0.15;
  if (p.moving) {
    const l = Math.hypot(mx, my);
    p.fx = mx / l;
    p.fy = my / l;
    if (Math.abs(mx) > 0.1) p.face = mx > 0 ? 1 : -1;
  }
  p.inv = Math.max(0, p.inv - DT);
  p.dashCd = Math.max(0, p.dashCd - DT);
  if (inp.dash && p.dashCd <= 0 && p.dashT <= 0) {
    p.dashT = 0.16;
    p.dashCd = DASH_CD;
    p.dx = p.fx;
    p.dy = p.fy;
    p.inv = Math.max(p.inv, 0.3);
    r.ev.push({ t: "dash" });
  }
  const sp = HEROES[r.hero].speed * (1 + r.stats.speed);
  if (p.ultT <= 0 && r.dashes > 0) {
    // 제나 전광석화: 다음 돌진 (가까운 적 쪽으로)
    r.dashes--;
    const e = nearest(r, p.x, p.y, 260);
    const dx = e ? e.x - p.x : p.fx;
    const dy = e ? e.y - p.y : p.fy;
    const d = Math.hypot(dx, dy) || 1;
    p.dx = dx / d;
    p.dy = dy / d;
    p.ultT = 0.32;
    p.inv = Math.max(p.inv, 0.5);
    r.ev.push({ t: "bolt", x: p.x, y: p.y, r: 30 });
  }
  if (p.ultT > 0) {
    // 카이 돌풍 돌진 · 제나 번개 돌진
    p.ultT -= DT;
    const v = 420;
    p.x += p.dx * v * DT;
    p.y += p.dy * v * DT;
    hitProps(r, p.x, p.y, 26);
    near(r, p.x, p.y, 26 * (1 + r.stats.area), (e) => {
      if (r.t - e.hitAt[7] < 0.4) return;
      e.hitAt[7] = r.t;
      hurt(r, e, 70 * (1 + r.stats.might), -1, 140, p.x - p.dx * 10, p.y - p.dy * 10);
    });
  } else if (p.dashT > 0) {
    p.dashT -= DT;
    p.x += p.dx * sp * 4 * DT;
    p.y += p.dy * sp * 4 * DT;
  } else {
    p.x += mx * sp * DT;
    p.y += my * sp * DT;
  }
  if (r.arena) {
    const a = r.arena;
    p.x = Math.max(a.x - a.hw + 6, Math.min(a.x + a.hw - 6, p.x));
    p.y = Math.max(a.y - a.hh + 8, Math.min(a.y + a.hh - 4, p.y));
  }
  // 회복
  if (r.stats.regen > 0) p.hp = Math.min(maxHp(r), p.hp + r.stats.regen * DT);
}

function timeline(r: Run) {
  // 정해진 이벤트
  while (r.nextEvent < EVENTS.length && r.t >= EVENTS[r.nextEvent].at) {
    const ev = EVENTS[r.nextEvent++];
    if (ev.k === "elite") {
      const [x, y] = ringPos(r);
      spawnEnemy(r, ev.kind, x, y, true);
      r.ev.push({ t: "warn", text: "엘리트 등장! 처치하면 보물 상자" });
    } else if (ev.k === "ring") {
      for (let i = 0; i < ev.n; i++) {
        const a = (i / ev.n) * Math.PI * 2;
        spawnEnemy(r, ev.kind, r.p.x + Math.cos(a) * 230, r.p.y + Math.sin(a) * 150);
      }
      r.ev.push({ t: "warn", text: ev.kind === "bat" ? "박쥐 떼가 에워싸요!" : "유령 떼가 에워싸요!" });
    } else if (ev.k === "boss") {
      if (ev.arena) {
        // 철창: 주변 잡몹 정리 (보상 없이 사라짐)
        for (const e of r.enemies) if (!e.def.boss) e.alive = false;
        r.arena = { x: r.p.x, y: r.p.y, hw: 230, hh: 128 };
      }
      const [x, y] = ev.arena ? [r.p.x + 150, r.p.y - 40] : ringPos(r, 260);
      const b = spawnEnemy(r, ev.kind, x, y);
      r.bossId = b.id;
      r.ev.push({ t: "boss", kind: ev.kind, arena: ev.arena });
    }
  }
  // 오버타임: 45초마다 정예
  if (r.ot && Math.floor(r.otT / 45) > Math.floor((r.otT - DT) / 45)) {
    const [x, y] = ringPos(r);
    const ks: EnemyKind[] = ["skull", "mush", "golem"];
    spawnEnemy(r, ks[rndInt(r.rng, 3)], x, y, true);
    r.ev.push({ t: "warn", text: "오버타임 정예!" });
  }
  // 잡몹 유지
  const finale = r.arena !== null;
  if (!finale) {
    const w = waveAt(r.t);
    let alive = 0;
    for (const e of r.enemies) if (e.alive && !e.def.boss) alive++;
    const more = depthMul(r.depth).spawn * (1 + r.curse * 0.5) * (1 + r.otLv * 0.15);
    const target = (r.bossId >= 0 ? w.count * 0.5 : w.count) * Math.min(1.8, more);
    r.spawnAcc += w.rate * (r.bossId >= 0 ? 0.5 : 1) * more * DT;
    // 처음 몇 초는 금방 손맛이 오게 가까이 몰려 있음
    const need = Math.min(Math.floor(r.spawnAcc), Math.ceil(target - alive));
    r.spawnAcc -= Math.max(0, need);
    if (r.spawnAcc > 3) r.spawnAcc = 3;
    for (let i = 0; i < need; i++) {
      const [x, y] = ringPos(r);
      spawnEnemy(r, pickKind(r, w.mix), x, y);
    }
  }
  // 가로등
  r.propT -= DT;
  if (r.propT <= 0) {
    r.propT = 14 + rnd(r.rng) * 8;
    let n = 0;
    for (const pr of r.props) if (pr.alive) n++;
    if (n < 6 && !finale) spawnProp(r, 260 + rnd(r.rng) * 80);
  }
}

/* ───────────── 무기 쏘기 ───────────── */

function fireWeapon(r: Run, slot: number) {
  const ws = r.weapons[slot];
  const def = WEAPONS[ws.id];
  const w = wstat(r, ws);
  const p = r.p;
  if (def.pattern === "orbit") {
    ws.ang += w.spd * DT;
    const bodyR = 9 * (1 + r.stats.area);
    for (let i = 0; i < w.n; i++) {
      const a = ws.ang + (i / w.n) * Math.PI * 2;
      const x = p.x + Math.cos(a) * w.size;
      const y = p.y + Math.sin(a) * w.size * 0.8;
      near(r, x, y, bodyR, (e) => {
        if (r.t - e.hitAt[slot] < 0.45) return;
        e.hitAt[slot] = r.t;
        hurt(r, e, w.dmg, slot, w.kb, p.x, p.y);
      });
      hitProps(r, x, y, bodyR);
    }
    return;
  }
  // 연사 중 (facing · spin 두 번째 회전)
  if (ws.burst > 0) {
    ws.burstT -= DT;
    if (ws.burstT <= 0) {
      ws.burst--;
      ws.burstT = def.pattern === "spin" ? 0.26 : def.pattern === "cone" ? 0.18 : 0.07;
      emitOne(r, slot, ws, w, ws.burst);
    }
  }
  ws.t -= DT;
  if (ws.t > 0) return;
  ws.t = w.cd;
  switch (def.pattern) {
    case "spin":
    case "facing":
    case "cone":
      ws.burst = w.n - 1;
      ws.burstT = def.pattern === "spin" ? 0.26 : def.pattern === "cone" ? 0.18 : 0.07;
      emitOne(r, slot, ws, w, w.n - 1);
      break;
    case "whip": {
      // 바라보는 쪽 먼저, 레벨 2부터 반대쪽도
      const side = p.face;
      for (let i = 0; i < Math.min(2, w.n); i++) {
        const sx = i === 0 ? side : -side;
        const cx = p.x + sx * (w.size / 2 + 4);
        const cy = p.y - 8 + i * 6;
        r.zones.push(zone({ k: "whip", slot, x: cx, y: cy, r: w.size, dmg: 0, delay: 0, life: w.dur, t: 0, tick: 0, kb: 0, follow: false, dx: sx, dy: 0 }));
        for (const e of r.enemies) {
          if (!e.alive) continue;
          if (Math.abs(e.x - cx) <= w.size / 2 + e.r && Math.abs(e.y - cy) <= 12 + e.r) hurt(r, e, w.dmg, slot, w.kb, p.x, e.y);
        }
        hitProps(r, cx, cy, w.size / 2);
      }
      r.ev.push({ t: "fire", w: ws.id });
      break;
    }
    case "spread": {
      const n = w.n;
      for (let i = 0; i < n; i++) {
        const a = (n > 1 ? (i / (n - 1) - 0.5) : 0) * 0.9 + (rnd(r.rng) - 0.5) * 0.12;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const sp = w.spd * (0.85 + rnd(r.rng) * 0.3);
        const sh = mkShot(r, slot, ws.id, p.x, p.y - 6, (p.fx * ca - p.fy * sa) * sp, (p.fx * sa + p.fy * ca) * sp, w, 0);
        sh.r = 5;
        r.shots.push(sh);
      }
      r.ev.push({ t: "fire", w: ws.id });
      break;
    }
    case "pulse":
      ws.burst = w.n - 1;
      ws.burstT = 0.35;
      emitOne(r, slot, ws, w, w.n - 1);
      break;
    case "aura":
      aoe(r, p.x, p.y, w.size, w.dmg, slot, 0);
      if (ws.id === "rose") {
        // 장미 정원: 묶고 · 체력 회복
        let n = 0;
        near(r, p.x, p.y, w.size, (e) => {
          e.slow = Math.max(e.slow, 0.8);
          n++;
        });
        if (n) p.hp = Math.min(maxHp(r), p.hp + 0.4);
      } else if (ws.lv >= 5 || def.fx === "sleep")
        near(r, p.x, p.y, w.size, (e) => {
          e.slow = Math.max(e.slow, def.fx === "sleep" ? 1 : 0.6);
          // 몽글 5레벨: 가끔 아예 잠듦
          if (def.fx === "sleep" && ws.lv >= 5 && !e.def.boss && rnd(r.rng) < 0.08) e.stun = Math.max(e.stun, 1.2);
        });
      break;
    case "nearest": {
      const skip = new Set<number>();
      for (let i = 0; i < w.n; i++) {
        const e = nearest(r, p.x, p.y, 320, skip);
        const tx = e ? e.x : p.x + p.fx * 100;
        const ty = e ? e.y : p.y + p.fy * 100;
        if (e && skip.size < 8) skip.add(e.id);
        shoot(r, slot, ws.id, p.x, p.y - 6, tx, ty, w, w.size);
      }
      if (w.n) r.ev.push({ t: "fire", w: ws.id });
      break;
    }
    case "drop": {
      const cand = r.enemies.filter((e) => e.alive && onScreen(r, e, -20));
      for (let i = 0; i < w.n; i++) {
        const e = cand.length ? cand[rndInt(r.rng, cand.length)] : null;
        const x = e ? e.x : p.x + (rnd(r.rng) - 0.5) * 300;
        const y = e ? e.y : p.y + (rnd(r.rng) - 0.5) * 160;
        r.zones.push(zone({ k: ws.id === "grenade" ? "grenade" : "drop", slot, x, y, r: w.size, dmg: w.dmg, delay: w.dur + i * 0.08, life: 0.3, t: 0, tick: 0, kb: w.kb, follow: false, dx: p.x, dy: p.y }));
      }
      break;
    }
    case "boomerang": {
      for (let i = 0; i < w.n; i++) {
        const e = nearest(r, p.x, p.y, 300);
        let ax = e ? e.x - p.x : p.fx;
        let ay = e ? e.y - p.y : p.fy;
        const d = Math.hypot(ax, ay) || 1;
        const spread = (i - (w.n - 1) / 2) * 0.5;
        const ca = Math.cos(spread);
        const sa = Math.sin(spread);
        [ax, ay] = [(ax / d) * ca - (ay / d) * sa, (ax / d) * sa + (ay / d) * ca];
        r.shots.push(mkShot(r, slot, ws.id, p.x, p.y, ax * w.spd, ay * w.spd, w, 0));
      }
      r.ev.push({ t: "fire", w: ws.id });
      break;
    }
    case "strike": {
      const cand = r.enemies.filter((e) => e.alive && onScreen(r, e, -10));
      for (let i = 0; i < w.n; i++) {
        if (!cand.length) break;
        const k = rndInt(r.rng, cand.length);
        const e = cand[k];
        cand.splice(k, 1);
        r.ev.push({ t: "bolt", x: e.x, y: e.y, r: w.size });
        aoe(r, e.x, e.y, w.size, w.dmg, slot, 0);
      }
      break;
    }
    case "homing": {
      for (let i = 0; i < w.n; i++) {
        const a = rnd(r.rng) * Math.PI * 2;
        const boomy = ws.id === "missile" || ws.id === "barrage";
        const s = mkShot(r, slot, ws.id, p.x, p.y - 6, Math.cos(a) * w.spd * 0.6, Math.sin(a) * w.spd * 0.6, w, boomy ? w.size : 0);
        s.r = boomy ? 4 : 5;
        if (ws.id === "cards") s.life = w.dur;
        r.shots.push(s);
      }
      r.ev.push({ t: "fire", w: ws.id });
      break;
    }
    case "bounce": {
      for (let i = 0; i < w.n; i++) {
        const a = rnd(r.rng) * Math.PI * 2;
        r.shots.push(mkShot(r, slot, ws.id, p.x, p.y, Math.cos(a) * w.spd, Math.sin(a) * w.spd, w, 0));
      }
      r.ev.push({ t: "fire", w: ws.id });
      break;
    }
  }
}

function emitOne(r: Run, slot: number, ws: WeaponSlot, w: W, left: number) {
  const p = r.p;
  const pat = WEAPONS[ws.id].pattern;
  if (pat === "cone") {
    // 앞쪽 부채꼴 (±50°)
    r.zones.push(zone({ k: "cone", slot, x: p.x, y: p.y - 6, r: w.size, dmg: 0, delay: 0, life: w.dur, t: 0, tick: 0, kb: 0, follow: true, dx: p.fx, dy: p.fy }));
    near(r, p.x, p.y - 6, w.size, (e) => {
      const dx = e.x - p.x;
      const dy = e.y - p.y + 6;
      const d = Math.hypot(dx, dy) || 1;
      if ((dx * p.fx + dy * p.fy) / d < 0.62 && d > e.r + 6) return;
      hurt(r, e, w.dmg, slot, w.kb, p.x, p.y);
    });
    hitProps(r, p.x + p.fx * w.size * 0.6, p.y + p.fy * w.size * 0.6, w.size * 0.5);
    r.ev.push({ t: "fire", w: ws.id });
    return;
  }
  if (pat === "pulse") {
    r.zones.push(zone({ k: "pulse", slot, x: p.x, y: p.y - 4, r: w.size, dmg: w.dmg, delay: 0, life: w.dur, t: 0, tick: 0, kb: w.kb, follow: true }));
    r.ev.push({ t: "fire", w: ws.id });
    return;
  }
  if (pat === "spin") {
    r.zones.push(zone({ k: "spin", slot, x: p.x, y: p.y, r: w.size, dmg: 0, delay: 0, life: w.dur, t: 0, tick: 0, kb: 0, follow: true }));
    aoe(r, p.x, p.y - 4, w.size, w.dmg, slot, w.kb);
    r.ev.push({ t: "fire", w: ws.id });
    return;
  }
  // facing: 조금씩 퍼지게
  const spread = (left % 2 ? 1 : -1) * Math.ceil(left / 2) * 0.12;
  const ca = Math.cos(spread);
  const sa = Math.sin(spread);
  const dx = p.fx * ca - p.fy * sa;
  const dy = p.fx * sa + p.fy * ca;
  r.shots.push(mkShot(r, slot, ws.id, p.x, p.y - 6, dx * w.spd, dy * w.spd, w, 0));
  r.ev.push({ t: "fire", w: ws.id });
}

function mkShot(r: Run, slot: number, id: WeaponId, x: number, y: number, vx: number, vy: number, w: W, boom: number): Shot {
  return { alive: true, w: id, slot, x, y, vx, vy, r: w.size, dmg: w.dmg, pierce: w.pierce, life: w.dur, t: 0, kb: w.kb, boom, target: -1, back: false, hits: [] };
}

function shoot(r: Run, slot: number, id: WeaponId, x: number, y: number, tx: number, ty: number, w: W, boom: number) {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy) || 1;
  const s = mkShot(r, slot, id, x, y, (dx / d) * w.spd, (dy / d) * w.spd, w, boom);
  s.r = 5;
  r.shots.push(s);
}

/* ───────────── 투사체 ───────────── */

function updateShots(r: Run) {
  const p = r.p;
  for (const s of r.shots) {
    if (!s.alive) continue;
    s.t += DT;
    const def = WEAPONS[s.w];
    if (def.pattern === "boomerang") {
      // 앞으로 날아가다 느려져서 플레이어에게 돌아옴
      const half = s.life * 0.45;
      if (s.t < half) {
        const k = 1 - (s.t / half) * 0.9;
        s.x += s.vx * k * DT;
        s.y += s.vy * k * DT;
      } else {
        const dx = p.x - s.x;
        const dy = p.y - 6 - s.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = Math.hypot(s.vx, s.vy) * Math.min(1.4, (s.t - half) * 2.2 + 0.2);
        s.x += (dx / d) * sp * DT;
        s.y += (dy / d) * sp * DT;
        if (d < 10) s.alive = false;
      }
      if (s.t > s.life * 2.2) s.alive = false;
    } else if (def.pattern === "homing") {
      let tgt = s.target >= 0 ? r.enemies.find((e) => e.id === s.target && e.alive) : undefined;
      if (!tgt) {
        tgt = nearest(r, s.x, s.y, 260) ?? undefined;
        s.target = tgt ? tgt.id : -1;
      }
      const sp = Math.hypot(s.vx, s.vy);
      const want = WEAPONS[s.w].lv[0].spd * (1 + r.stats.pspeed);
      const nsp = Math.min(want, sp + want * 2 * DT);
      if (tgt) {
        const dx = tgt.x - s.x;
        const dy = tgt.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        const turn = 9 * DT;
        s.vx += ((dx / d) * nsp - s.vx) * turn;
        s.vy += ((dy / d) * nsp - s.vy) * turn;
      }
      const k = nsp / (Math.hypot(s.vx, s.vy) || 1);
      s.vx *= k;
      s.vy *= k;
      s.x += s.vx * DT;
      s.y += s.vy * DT;
    } else if (def.pattern === "bounce") {
      s.x += s.vx * DT;
      s.y += s.vy * DT;
      const hw = VIEW_W / 2 - 4;
      const hh = VIEW_H / 2 - 4;
      if (s.x < p.x - hw) (s.x = p.x - hw), (s.vx = Math.abs(s.vx));
      if (s.x > p.x + hw) (s.x = p.x + hw), (s.vx = -Math.abs(s.vx));
      if (s.y < p.y - hh) (s.y = p.y - hh), (s.vy = Math.abs(s.vy));
      if (s.y > p.y + hh) (s.y = p.y + hh), (s.vy = -Math.abs(s.vy));
    } else {
      s.x += s.vx * DT;
      s.y += s.vy * DT;
    }
    if (def.pattern !== "boomerang" && s.t > s.life) {
      if (s.boom) explode(r, s);
      s.alive = false;
      continue;
    }
    // 맞히기
    const rehit = def.pattern === "boomerang" || def.pattern === "bounce";
    near(r, s.x, s.y, s.r, (e) => {
      if (rehit) {
        const hs = s.slot >= 0 ? s.slot : 8;
        if (r.t - e.hitAt[hs] < 0.35) return;
        e.hitAt[hs] = r.t;
      } else if (s.hits.includes(e.id)) return;
      if (s.boom) {
        explode(r, s);
        s.alive = false;
        return true;
      }
      hurt(r, e, s.dmg, s.slot, s.kb, s.x - s.vx * 0.05, s.y - s.vy * 0.05);
      if (WEAPONS[s.w].fx === "six" && rnd(r.rng) < 1 / 6) {
        // 6이 나오면 펑
        r.ev.push({ t: "dice", x: s.x, y: s.y, face: 6 });
        r.ev.push({ t: "boom", x: s.x, y: s.y, r: 28 * (1 + r.stats.area), c: "#fff2c0" });
        aoe(r, s.x, s.y, 28 * (1 + r.stats.area), s.dmg * 3, s.slot, 40);
      }
      if (!rehit) {
        s.hits.push(e.id);
        if (s.hits.length > s.pierce) {
          s.alive = false;
          return true;
        }
      }
    });
    if (s.alive) hitProps(r, s.x, s.y, s.r);
  }
}

function explode(r: Run, s: Shot) {
  let dmg = s.dmg;
  if (WEAPONS[s.w].fx === "dice") {
    // 주사위 굴림: 나온 눈만큼 피해 ×
    const face = 1 + rndInt(r.rng, 6);
    dmg *= face;
    r.ev.push({ t: "dice", x: s.x, y: s.y, face });
  }
  r.ev.push({ t: "boom", x: s.x, y: s.y, r: s.boom, c: WEAPONS[s.w].color });
  aoe(r, s.x, s.y, s.boom, dmg, s.slot, s.kb);
}

function updateZones(r: Run) {
  const p = r.p;
  for (const z of r.zones) {
    if (!z.alive) continue;
    if (z.follow) {
      z.x = p.x;
      z.y = p.y;
    }
    if (z.delay > 0) {
      z.delay -= DT;
      if (z.delay <= 0 && z.k === "slam") {
        r.ev.push({ t: "boom", x: z.x, y: z.y, r: z.r, c: "#ff3d6e" });
        if (Math.hypot(p.x - z.x, (p.y - z.y) * 1.3) < z.r + 4) damagePlayer(r, z.dmg);
      } else if (z.delay <= 0) {
        r.ev.push({ t: "boom", x: z.x, y: z.y, r: z.r, c: z.k === "moon" ? "#fff2a8" : z.k === "grenade" || z.k === "shell" ? "#ffb03a" : "#ffe17a" });
        aoe(r, z.x, z.y, z.r, z.dmg, z.slot, z.kb);
      }
      continue;
    }
    z.t += DT;
    if (z.k === "pulse") {
      // 퍼져 나가는 고리 — 지나간 적을 한 번씩
      const rad = (z.t / z.life) * z.r;
      near(r, z.x, z.y, rad, (e) => {
        if (z.hits.includes(e.id)) return;
        const d = Math.hypot(e.x - z.x, e.y - z.y);
        if (d < rad - 14 - e.r) return;
        z.hits.push(e.id);
        hurt(r, e, z.dmg, z.slot, z.kb, z.x, z.y);
      });
    }
    if (z.k === "fire" || z.k === "rain") {
      z.tick -= DT;
      if (z.tick <= 0) {
        z.tick = z.k === "fire" ? 0.25 : 0.3;
        for (const e of r.enemies) {
          if (!e.alive || !onScreen(r, e, 20)) continue;
          if (z.k === "rain") e.slow = Math.max(e.slow, 2);
          hurt(r, e, z.dmg, -1, 0, e.x, e.y);
        }
      }
    }
    if (z.t >= z.life) z.alive = false;
  }
}

/* ───────────── 적 ───────────── */

function updateEnemies(r: Run) {
  const p = r.p;
  const es = r.enemies;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (!e.alive) continue;
    e.t += DT;
    e.flash = Math.max(0, e.flash - DT);
    e.slow = Math.max(0, e.slow - DT);
    e.vuln = Math.max(0, e.vuln - DT);
    e.ice = Math.max(0, e.ice - DT);
    if (e.poison > 0) {
      e.poison -= DT;
      // 독: 0.5초마다
      if (Math.floor(e.poison * 2) !== Math.floor((e.poison + DT) * 2)) {
        hurt(r, e, e.poisonD * 0.5, PROC, 0, e.x, e.y);
        if (!e.alive) continue;
      }
      if (e.poison <= 0) e.poisonD = 0;
    }
    if (e.stun > 0) {
      e.stun -= DT;
      e.x += e.kx * DT;
      e.y += e.ky * DT;
      e.kx *= 0.86;
      e.ky *= 0.86;
      continue;
    }
    let dx = p.x - e.x;
    let dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    let sp = e.speed * (e.slow > 0 ? 0.45 : 1);
    if (e.boss) {
      bossAI(r, e, dx, dy);
    } else {
      if (e.kind === "bat") {
        // 박쥐는 흔들흔들
        const w = Math.sin(e.t * 6 + e.id) * 0.6;
        const ox = -dy * w;
        const oy = dx * w;
        dx += ox;
        dy += oy;
      }
      e.x += dx * sp * DT + e.kx * DT;
      e.y += dy * sp * DT + e.ky * DT;
      if (Math.abs(dx) > 0.05) e.face = dx > 0 ? 1 : -1;
    }
    e.kx *= 0.86;
    e.ky *= 0.86;
    // 서로 밀기 (겹쳐서 한 덩어리가 되지 않게)
    if (!e.def.ghost && !e.boss) {
      let px = 0;
      let py = 0;
      let n = 0;
      near(r, e.x, e.y, e.r, (o) => {
        if (o === e || o.def.ghost || n > 6) return;
        const ox = e.x - o.x;
        const oy = e.y - o.y;
        const od = Math.hypot(ox, oy) || 0.01;
        const overlap = e.r + o.r - od;
        if (overlap > 0) {
          px += (ox / od) * overlap;
          py += (oy / od) * overlap;
          n++;
        }
      });
      if (n) {
        e.x += px * 0.25;
        e.y += py * 0.25;
      }
    }
    if (r.arena && e.boss) {
      const a = r.arena;
      e.x = Math.max(a.x - a.hw + e.r, Math.min(a.x + a.hw - e.r, e.x));
      e.y = Math.max(a.y - a.hh + e.r, Math.min(a.y + a.hh - e.r, e.y));
    }
    // 플레이어와 닿음
    const pr = 6;
    if ((p.x - e.x) ** 2 + (p.y - 4 - e.y) ** 2 < (pr + e.r) ** 2) {
      damagePlayer(r, e.dmg);
      sp = 0;
    }
    // 너무 멀어진 잡몹은 반대편 화면 밖으로 다시
    if (!e.def.boss && d > 420) {
      const [x, y] = [p.x + (p.x - e.x) * 0.7, p.y + (p.y - e.y) * 0.7];
      e.x = x;
      e.y = y;
    }
  }
}

function damagePlayer(r: Run, dmg: number) {
  const p = r.p;
  if (p.inv > 0 || r.over) return;
  r.q.noHit = Math.max(r.q.noHit, Math.floor(r.t - r.hitAt));
  r.hitAt = r.t;
  // 비눗방울 방패: 한 번 막음
  if (rel(r, "bubble") && r.bubbleT <= 0) {
    r.bubbleT = 15 * Math.pow(0.8, rel(r, "bubble") - 1);
    p.inv = 0.5;
    r.ev.push({ t: "shield" });
    return;
  }
  const v = Math.max(1, Math.round(dmg - r.stats.armor));
  p.hp -= v;
  p.inv = 0.5;
  r.taken += v;
  r.ev.push({ t: "hurt", v });
  if (rel(r, "balloon") && r.balloonT <= 0) {
    r.balloonT = 3;
    const rad = 70 * (1 + r.stats.area);
    r.ev.push({ t: "boom", x: p.x, y: p.y, r: rad, c: "#ff9cf0" });
    aoe(r, p.x, p.y, rad, (30 + p.lv) * rel(r, "balloon") * (1 + r.stats.might), PROC, 160);
  }
}

function bossAI(r: Run, e: Enemy, dx: number, dy: number) {
  const b = e.boss!;
  const final = e.kind === FINAL_BOSS;
  if (!b.enraged && e.hp < e.maxHp * 0.5) {
    b.enraged = true;
    r.ev.push({ t: "warn", text: `${e.def.name} 분노!` });
  }
  b.age += DT;
  // 너무 오래 끌면 격노 (집중포화식 시간 제한)
  if (!b.rage && b.age >= bossLimit(e.kind)) {
    b.rage = true;
    e.speed *= 1.35;
    e.dmg *= 1.4;
    r.ev.push({ t: "rage", name: e.def.name });
  }
  const fast = (b.enraged ? 0.7 : 1) * (b.rage ? 0.6 : 1);
  b.t -= DT;
  switch (b.phase) {
    case "chase":
      e.x += dx * e.speed * DT;
      e.y += dy * e.speed * DT;
      if (Math.abs(dx) > 0.05) e.face = dx > 0 ? 1 : -1;
      if (b.t <= 0) {
        const order: BossAI["phase"][] = final ? ["warn", "ring", "slam", "warn", "summon", "slam"] : ["warn", "slam", "ring", "summon"];
        b.phase = order[b.step++ % order.length];
        b.t = b.phase === "warn" ? 0.9 : 0.2;
        if (b.phase === "warn") {
          b.dx = dx;
          b.dy = dy;
        }
      }
      break;
    case "warn":
      if (b.t <= 0) {
        b.phase = "dash";
        b.t = 0.55;
      }
      break;
    case "dash":
      e.x += b.dx * 290 * DT;
      e.y += b.dy * 290 * DT;
      if (b.t <= 0) {
        b.phase = "chase";
        b.t = 2.4 * fast;
      }
      break;
    case "ring": {
      const n = final ? (b.enraged ? 20 : 16) : 12;
      const off = r.t;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        r.bullets.push({ alive: true, x: e.x, y: e.y - 8, vx: Math.cos(a) * 78, vy: Math.sin(a) * 78, r: 4, dmg: e.dmg * 0.6, life: 5 });
      }
      if (final && b.enraged)
        for (let i = 0; i < n; i++) {
          const a = off + ((i + 0.5) / n) * Math.PI * 2;
          r.bullets.push({ alive: true, x: e.x, y: e.y - 8, vx: Math.cos(a) * 55, vy: Math.sin(a) * 55, r: 4, dmg: e.dmg * 0.6, life: 6 });
        }
      b.phase = "chase";
      b.t = 2.2 * fast;
      break;
    }
    case "slam": {
      // 바닥 내려찍기: 빨간 원이 차오르고 1초 뒤 터짐 (플레이어 자리 + 둘레)
      const n = (final ? 5 : 3) + (b.rage ? 3 : 0);
      const p = r.p;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(r.rng);
        const k = i === 0 ? 0 : 50 + rnd(r.rng) * 60;
        r.zones.push(zone({ k: "slam", slot: -1, x: p.x + Math.cos(a) * k, y: p.y + Math.sin(a) * k * 0.7, r: final ? 40 : 34, dmg: e.dmg * 1.2, delay: 1.0 + i * 0.06, life: 0.25, t: 0, tick: 0, kb: 0, follow: false }));
      }
      b.phase = "chase";
      b.t = 1.6 * fast;
      break;
    }
    case "summon": {
      const kind: EnemyKind = final ? "skull" : "bat";
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        spawnEnemy(r, kind, e.x + Math.cos(a) * 40, e.y + Math.sin(a) * 30);
      }
      b.phase = "chase";
      b.t = 2.6 * fast;
      break;
    }
  }
}

/** 격노까지 (초) */
export const bossLimit = (k: EnemyKind) => (k === FINAL_BOSS ? 120 : 80);

function updateBullets(r: Run) {
  const p = r.p;
  for (const b of r.bullets) {
    if (!b.alive) continue;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.life -= DT;
    if (b.life <= 0) b.alive = false;
    else if ((p.x - b.x) ** 2 + (p.y - 6 - b.y) ** 2 < (5 + b.r) ** 2) {
      damagePlayer(r, b.dmg);
      b.alive = false;
    }
  }
}

/* ───────────── 줍기 ───────────── */

function updatePickups(r: Run) {
  const p = r.p;
  const mag = 32 * (1 + r.stats.magnet);
  const pull = (o: { x: number; y: number; pull: boolean; sp: number }) => {
    const dx = p.x - o.x;
    const dy = p.y - 6 - o.y;
    const d = Math.hypot(dx, dy);
    if (!o.pull && d < mag) o.pull = true;
    if (o.pull) {
      o.sp = Math.min(520, o.sp + 900 * DT);
      // 처음엔 살짝 튕겨 나갔다 빨려 듦
      const k = o.sp < 80 ? -0.4 : 1;
      o.x += (dx / (d || 1)) * o.sp * DT * k;
      o.y += (dy / (d || 1)) * o.sp * DT * k;
    }
    return d < 9;
  };
  for (const g of r.gems) {
    if (!g.alive) continue;
    if (pull(g)) {
      g.alive = false;
      p.xp += g.v * (1 + r.stats.growth);
      r.ev.push({ t: "gem", v: g.v });
    }
  }
  for (const k of r.pickups) {
    if (!k.alive) continue;
    k.t += DT;
    // 아이템은 자석 범위의 절반에서만 (일부러 주우러 가게)
    const dx = p.x - k.x;
    const dy = p.y - 6 - k.y;
    const d = Math.hypot(dx, dy);
    if (!k.pull && d < Math.max(16, mag * 0.5)) k.pull = true;
    if (k.pull && pull(k)) {
      k.alive = false;
      collect(r, k);
    }
  }
  for (const pr of r.props) if (pr.alive && (pr.x - p.x) ** 2 + (pr.y - p.y) ** 2 < 14 ** 2) breakProp(r, pr);
}

function collect(r: Run, k: Pickup) {
  const p = r.p;
  r.ev.push({ t: "pick", k: k.k, v: k.v });
  switch (k.k) {
    case "meat":
      p.hp = Math.min(maxHp(r), p.hp + 30);
      break;
    case "magnet":
      for (const g of r.gems) g.pull = true;
      break;
    case "bomb":
      screenBomb(r, true);
      break;
    case "coin":
    case "bag": {
      const v = Math.round(k.v * (1 + 0.2 * rel(r, "piggy")));
      p.gold += v;
      r.q.gold += v;
      break;
    }
    case "chest":
      openChest(r, k.v === 1);
      break;
  }
}

/** 화면 속 잡몹 전부 처치 */
function screenBomb(r: Run, loot: boolean) {
  r.ev.push({ t: "boom", x: r.p.x, y: r.p.y, r: 300, c: "#ffffff" });
  for (const e of r.enemies) {
    if (!e.alive || e.def.boss || !onScreen(r, e, 30)) continue;
    if (loot) hurt(r, e, e.hp + 1, -1, 0, e.x, e.y);
    else e.alive = false;
  }
}

/* ───────────── 맵 오브젝트 ───────────── */

/** 종류 · 동시에 몇 개 · 처음 나오는 시각 · 쓰고 나서 다시 나오기까지 (초) */
const THING_PLAN: { k: ThingKind; n: number; at: number; cool: number }[] = [
  { k: "shrine", n: 2, at: 0, cool: 30 },
  { k: "box", n: 2, at: 0, cool: 12 },
  { k: "flag", n: 1, at: 25, cool: 40 },
  { k: "statue", n: 1, at: 45, cool: 70 },
  { k: "bell", n: 1, at: 80, cool: 75 },
];

function spawnThing(r: Run, k: ThingKind, d0 = 300, d1 = 470) {
  // 다른 오브젝트와 너무 붙지 않게 몇 번 시도
  let x = 0;
  let y = 0;
  for (let i = 0; i < 6; i++) {
    const a = rnd(r.rng) * Math.PI * 2;
    const d = d0 + rnd(r.rng) * (d1 - d0);
    x = r.p.x + Math.cos(a) * d;
    y = r.p.y + Math.sin(a) * d * 0.7;
    if (!r.things.some((t) => t.alive && (t.x - x) ** 2 + (t.y - y) ** 2 < 90 ** 2)) break;
  }
  const t: Thing = { id: r.nextId++, alive: true, k, x, y, t: 0, on: false, cost: k === "box" ? boxCost(r.boxes) : 0 };
  r.things.push(t);
  return t;
}

function manageThings(r: Run) {
  r.thingT -= DT;
  if (r.thingT > 0) return;
  r.thingT = 1;
  if (r.arena) return;
  const p = r.p;
  for (const t of r.things) {
    if (!t.alive || t.on) continue;
    // 너무 멀어지면 다른 데서 다시
    if ((t.x - p.x) ** 2 + ((t.y - p.y) / 0.7) ** 2 > 1000 ** 2) t.alive = false;
  }
  const count = (k: ThingKind) => r.things.filter((t) => t.alive && (t.k === k || (k === "shrine" && t.k === "gshrine"))).length;
  for (const pl of THING_PLAN) {
    if (r.t < pl.at || r.t < (r.cool[pl.k] ?? 0) || count(pl.k) >= pl.n) continue;
    spawnThing(r, pl.k === "shrine" && rnd(r.rng) < 0.12 + r.stats.luck * 0.01 ? "gshrine" : pl.k);
  }
  if (r.t >= r.merchantT && !count("merchant")) {
    spawnThing(r, "merchant", 260, 380);
    r.merchantT = Infinity;
    r.ev.push({ t: "thing", k: "merchant", text: "떠돌이 상인이 왔어요!" });
  }
  while (r.sched.length && r.t >= r.sched[0].at) {
    const k = r.sched.shift()!.k;
    if (r.ot) continue;
    spawnThing(r, k, 220, 300);
    r.ev.push({ t: "thing", k, text: k === "trial" ? "달빛 시련이 열렸어요!" : "소원 우물이 솟아났어요!" });
  }
}

/** 쓴 오브젝트는 사라지고, 같은 종류는 한동안 안 나옴 */
function used(r: Run, t: Thing) {
  t.alive = false;
  const k = t.k === "gshrine" ? "shrine" : t.k;
  const pl = THING_PLAN.find((x) => x.k === k);
  if (pl) r.cool[k] = Math.max(r.cool[k] ?? 0, r.t + pl.cool);
}

function updateThings(r: Run) {
  manageThings(r);
  if (r.arena) return;
  const p = r.p;
  for (const t of r.things) {
    if (!t.alive) continue;
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    const d = Math.hypot(dx, dy * 1.25);
    switch (t.k) {
      case "shrine":
      case "gshrine":
      case "flag": {
        const R = t.k === "flag" ? 24 : 30;
        const need = t.k === "flag" ? FLAG_CHARGE : SHRINE_CHARGE;
        if (d < R) t.t += DT;
        else t.t = Math.max(0, t.t - DT * 0.5);
        if (t.t >= need) {
          used(r, t);
          if (t.k === "flag") {
            const ks: FlagBuff[] = ["might", "haste", "speed", "magnet"];
            const k = ks[rndInt(r.rng, ks.length)];
            r.flag = { k, t: 20 };
            if (k === "magnet") for (const g of r.gems) g.pull = true;
            r.q.flags++;
            r.ev.push({ t: "thing", k: "flag", text: "응원 깃발!" });
          } else {
            r.q.shrines++;
            openBless(r, t.k === "gshrine");
          }
        }
        break;
      }
      case "statue":
        if (d < 16) {
          used(r, t);
          const v = 30 + Math.floor(r.t / 8);
          p.gold += v;
          r.q.gold += v;
          r.curse += 0.08;
          r.q.statues++;
          r.ev.push({ t: "thing", k: "statue", text: `금화 +${v} · 저주 +8%` });
        }
        break;
      case "bell":
        if (d < 16) {
          used(r, t);
          r.q.bells++;
          const ks: EnemyKind[] = r.t < 200 ? ["slime", "ghost"] : r.t < 400 ? ["skull", "mush"] : ["mush", "golem"];
          spawnEnemy(r, ks[rndInt(r.rng, ks.length)], t.x + 40, t.y - 20, true);
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            spawnEnemy(r, ks[0], t.x + Math.cos(a) * 60, t.y + Math.sin(a) * 40);
          }
          r.ev.push({ t: "warn", text: "도전자 등장! 잡으면 보물 상자" });
        }
        break;
      case "box":
        t.t = Math.max(0, t.t - DT);
        if (d < 16 && t.t <= 0) {
          t.cost = boxCost(r.boxes);
          if (p.gold >= t.cost) {
            p.gold -= t.cost;
            r.boxes++;
            r.q.boxes++;
            used(r, t);
            openChest(r, false, true);
          } else {
            t.t = 2;
            r.ev.push({ t: "nogold", need: t.cost });
          }
        }
        if (t.alive) t.cost = boxCost(r.boxes);
        break;
      case "merchant":
      case "fountain":
        if (d < 18) {
          if (!t.on) {
            t.on = true;
            if (!t.offers) {
              // 서로 다른 셋 (풀이 작으면 그보다 적게)
              const o: RelicId[] = [];
              for (let i = 0; i < 12 && o.length < 3; i++) {
                const id = rollRelic(r, t.k === "fountain" ? 1 : 0);
                if (!o.includes(id)) o.push(id);
              }
              t.offers = o;
            }
            if (t.k === "merchant") r.pause = { k: "shop", offers: t.offers.map((id) => ({ id, price: relicPrice(RELICS[id].rarity, r.t) })), thing: t.id };
            else r.pause = { k: "wish", offers: t.offers, thing: t.id };
          }
        } else t.on = false;
        break;
      case "trial":
        if (!t.on) {
          if (d < TRIAL_R * 0.45) {
            t.on = true;
            t.t = TRIAL_SEC;
            r.ev.push({ t: "warn", text: `원 안에서 ${TRIAL_SEC}초 버텨요!` });
          }
          break;
        }
        t.t -= DT;
        // 시련: 원 둘레에서 몹이 쏟아짐
        if (r.tick % 6 === 0) {
          const a = rnd(r.rng) * Math.PI * 2;
          const w = waveAt(r.t);
          spawnEnemy(r, pickKind(r, w.mix), t.x + Math.cos(a) * (TRIAL_R + 60), t.y + Math.sin(a) * (TRIAL_R + 60) * 0.8);
        }
        if (d > TRIAL_R) {
          t.alive = false;
          r.ev.push({ t: "trial", ok: false });
        } else if (t.t <= 0) {
          t.alive = false;
          r.q.trials++;
          dropGem(r, t.x, t.y - 10, Math.round(xpNeed(p.lv) * 1.2));
          dropPickup(r, "chest", t.x, t.y, 0);
          p.gold += 40;
          r.q.gold += 40;
          r.ev.push({ t: "trial", ok: true });
        }
        break;
    }
  }
}

/** 유물 하나 굴리기 (bonus = 등급 올림) */
function rollRelic(r: Run, bonus: number): RelicId {
  const ws = relicRarityWeights(r.stats.luck, bonus);
  let sum = 0;
  for (const w of ws) sum += w;
  let x = rnd(r.rng) * sum;
  let rar = 0;
  for (; rar < 3; rar++) {
    x -= ws[rar];
    if (x <= 0) break;
  }
  const ok = (id: RelicId) => r.pool.relics.includes(id) && rel(r, id) < relicMax(id);
  for (let k = rar; k >= 0; k--) {
    const c = r.pool.relics.filter((id) => RELICS[id].rarity === k && ok(id));
    if (c.length) return c[rndInt(r.rng, c.length)];
  }
  const any = r.pool.relics.filter(ok);
  return any.length ? any[rndInt(r.rng, any.length)] : "gym";
}

function openBless(r: Run, gold: boolean) {
  const keys = BLESS.map((b, i) => i);
  const opts: Bless[] = [];
  for (let i = 0; i < 3 && keys.length; i++) {
    const k = keys.splice(rndInt(r.rng, keys.length), 1)[0];
    const x = rnd(r.rng);
    const luck = r.stats.luck * 0.012;
    let rar: RelicRarity = x < 0.04 + luck ? 3 : x < 0.16 + luck * 2 ? 2 : x < 0.45 + luck * 2 ? 1 : 0;
    if (gold) rar = Math.max(2, rar) as RelicRarity;
    opts.push({ k: BLESS[k].k, v: BLESS[k].v[rar], rar });
  }
  r.pause = { k: "bless", opts, gold };
  r.ev.push({ t: "thing", k: gold ? "gshrine" : "shrine", text: gold ? "황금 성소!" : "성소 충전!" });
}

export function chooseBless(r: Run, i: number) {
  if (r.pause?.k !== "bless") return;
  const b = r.pause.opts[i];
  if (!b) return;
  r.blessed[b.k] = (r.blessed[b.k] ?? 0) + b.v;
  recomputeStats(r);
  r.pause = null;
  if (r.pending > 0) openLevel(r);
}

export function buyRelic(r: Run, i: number) {
  if (r.pause?.k !== "shop") return;
  const o = r.pause.offers[i];
  if (!o || r.p.gold < o.price) return;
  r.p.gold -= o.price;
  r.q.buys++;
  giveRelic(r, o.id);
  const id = r.pause.thing;
  const t = r.things.find((x) => x.id === id);
  if (t) t.alive = false;
  r.merchantT = r.t + 110;
  r.pause = null;
  if (r.pending > 0) openLevel(r);
}

export function chooseWish(r: Run, i: number) {
  if (r.pause?.k !== "wish") return;
  const id = r.pause.offers[i];
  if (!id) return;
  giveRelic(r, id);
  r.q.fountains++;
  const tid = r.pause.thing;
  const t = r.things.find((x) => x.id === tid);
  if (t) t.alive = false;
  r.pause = null;
  if (r.pending > 0) openLevel(r);
}

/** 상점 · 우물 그냥 나가기 */
export function leaveThing(r: Run) {
  if (r.pause?.k !== "shop" && r.pause?.k !== "wish") return;
  r.pause = null;
  if (r.pending > 0) openLevel(r);
}

/* ───────────── 필살기 ───────────── */

function castUlt(r: Run) {
  const p = r.p;
  if (p.ult < ULT_NEED || r.over) return;
  p.ult = 0;
  r.q.ults++;
  r.ev.push({ t: "ult", hero: r.hero });
  doUlt(r, r.hero, 1);
  // 응원 동료도 차례로 거들어 줌 (40%)
  r.sup.forEach((h, i) => r.assist.push({ hero: h, t: 0.55 + i * 0.5 }));
}

/** 필살기 (m = 세기: 본인 1, 동료 거들기 0.4) */
function doUlt(r: Run, hero: HeroId, m: number) {
  const p = r.p;
  const s = r.stats;
  if (m < 1 && (hero === "kai" || hero === "zena")) {
    // 동료의 돌진은 플레이어를 끌고 가지 않게 주변 충격파로
    r.ev.push({ t: hero === "zena" ? "bolt" : "boom", x: p.x, y: p.y, r: 90, c: HEROES[hero].color });
    near(r, p.x, p.y, 90 * (1 + s.area), (e) => {
      hurt(r, e, 70 * (1 + s.might) * m * m * 2, -1, 120, p.x, p.y);
    });
    return;
  }
  switch (hero) {
    case "kai":
      p.ultT = 0.5;
      p.dx = p.fx;
      p.dy = p.fy;
      p.inv = Math.max(p.inv, 0.8);
      break;
    case "igna":
      r.zones.push(zone({ k: "fire", slot: -1, x: p.x, y: p.y, r: 999, dmg: 9 * (1 + s.might) * m, delay: 0, life: 4, t: 0, tick: 0, kb: 0, follow: true }));
      break;
    case "lily":
      r.zones.push(zone({ k: "rain", slot: -1, x: p.x, y: p.y, r: 999, dmg: 5 * (1 + s.might) * m, delay: 0, life: 3.5, t: 0, tick: 0, kb: 0, follow: true }));
      p.inv = Math.max(p.inv, 1);
      break;
    case "ivan":
      near(r, p.x, p.y, 130 * (1 + s.area), (e) => {
        if (!e.def.boss) e.stun = Math.max(e.stun, 3);
        hurt(r, e, 60 * (1 + s.might) * m, -1, 120, p.x, p.y);
      });
      r.ev.push({ t: "boom", x: p.x, y: p.y, r: 130 * (1 + s.area), c: "#ff8a6b" });
      break;
    case "soyoung":
      // 화면 속 적을 끌어와서 내려침
      for (const e of r.enemies) {
        if (!e.alive || !onScreen(r, e, 20) || e.def.boss) continue;
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        e.kx += dx * 3.2;
        e.ky += dy * 3.2;
        e.stun = Math.max(e.stun, 0.6);
      }
      r.zones.push(zone({ k: "shell", slot: -1, x: p.x, y: p.y, r: 90 * (1 + s.area), dmg: 80 * (1 + s.might) * m, delay: 0.55, life: 0.3, t: 0, tick: 0, kb: 160, follow: true }));
      break;
    case "zena":
      r.dashes = 3;
      p.ultT = 0;
      break;
    case "ivan-marine":
      for (let i = 0; i < Math.round(14 * Math.max(0.5, m)); i++) {
        const x = p.x + (rnd(r.rng) - 0.5) * (VIEW_W - 40);
        const y = p.y + (rnd(r.rng) - 0.5) * (VIEW_H - 40);
        r.zones.push(zone({ k: "shell", slot: -1, x, y, r: 36 * (1 + s.area), dmg: 70 * (1 + s.might) * m, delay: 0.4 + i * 0.13, life: 0.3, t: 0, tick: 0, kb: 70, follow: false }));
      }
      break;
    case "igna-student":
      r.buff.crit = Math.max(r.buff.crit, 6 * m);
      break;
    case "lily-hood":
      for (let i = 0; i < (m < 1 ? 1 : 3); i++) {
        const a = (i / 3) * Math.PI * 2;
        const sh = mkShot(r, -1, "apple", p.x, p.y, Math.cos(a) * 160, Math.sin(a) * 160, { dmg: 40 * (1 + s.might) * m, cd: 0, n: 1, size: 12, spd: 230, pierce: 99, dur: 6, kb: 60 }, 0);
        sh.r = 12;
        sh.w = "cards";
        sh.target = -1;
        sh.wolf = true;
        r.shots.push(sh);
      }
      break;
    case "mirage":
      r.buff.haste = Math.max(r.buff.haste, 8 * m);
      break;
    case "lolo":
      for (let i = 0; i < Math.round(12 * Math.max(0.5, m)); i++) {
        const a = (i / 12) * Math.PI * 2;
        r.shots.push(mkShot(r, -1, "circus", p.x, p.y, Math.cos(a) * 220, Math.sin(a) * 220, { dmg: 30 * (1 + s.might) * m, cd: 0, n: 1, size: 13, spd: 220, pierce: 99, dur: 6, kb: 80 }, 0));
      }
      break;
    case "mongle":
      for (const e of r.enemies) {
        if (!e.alive || !onScreen(r, e, 20)) continue;
        if (!e.def.boss) e.stun = Math.max(e.stun, 4 * Math.max(0.5, m));
        else e.slow = Math.max(e.slow, 4);
        e.vuln = Math.max(e.vuln, 6);
      }
      p.inv = Math.max(p.inv, 1);
      break;
    case "ur-dice": {
      const face = 1 + rndInt(r.rng, 6);
      r.ev.push({ t: "dice", x: p.x, y: p.y - 40, face });
      if (face === 6) {
        screenBomb(r, true);
        for (const e of r.enemies) if (e.alive && e.def.boss) hurt(r, e, e.maxHp * 0.12, -1, 0, e.x, e.y);
      } else
        for (const e of r.enemies) if (e.alive && onScreen(r, e, 20)) hurt(r, e, face * 25 * (1 + s.might) * m, -1, 60, p.x, p.y);
      break;
    }
    case "ur-moa":
      for (const e of r.enemies) {
        if (!e.alive || !onScreen(r, e, 20)) continue;
        hurt(r, e, 70 * (1 + s.might) * m, -1, 30, e.x, e.y - 10);
        if (!e.alive && rnd(r.rng) < 0.5) dropPickup(r, "coin", e.x, e.y, 2);
      }
      r.ev.push({ t: "boom", x: p.x, y: p.y, r: 300, c: "#ffd23a" });
      break;
    case "ur-forte":
      r.buff.haste = Math.max(r.buff.haste, 6 * m);
      for (const w of r.weapons) w.t = 0;
      break;
    case "toto":
      for (let i = 0; i < Math.round(10 * Math.max(0.5, m)); i++) {
        const x = p.x + (rnd(r.rng) - 0.5) * (VIEW_W - 60);
        const y = p.y + (rnd(r.rng) - 0.5) * (VIEW_H - 50);
        r.zones.push(zone({ k: "moon", slot: -1, x, y, r: 42 * (1 + s.area), dmg: 90 * (1 + s.might) * m, delay: 0.5 + i * 0.12, life: 0.3, t: 0, tick: 0, kb: 80, follow: false }));
      }
      break;
  }
}

/* ───────────── 정리 (죽은 것 빼기) ───────────── */

function compactArr<T extends { alive: boolean }>(a: T[]) {
  let j = 0;
  for (let i = 0; i < a.length; i++) if (a[i].alive) a[j++] = a[i];
  a.length = j;
}
function compact(r: Run) {
  compactArr(r.enemies);
  compactArr(r.shots);
  compactArr(r.zones);
  compactArr(r.gems);
  compactArr(r.pickups);
  compactArr(r.bullets);
  compactArr(r.props);
}

/* ───────────── 레벨업 카드 ───────────── */

function rollRarity(r: Run): Rarity {
  const luck = r.stats.luck;
  const x = rnd(r.rng);
  if (x < 0.025 + luck * 0.006) return 2;
  if (x < 0.13 + luck * 0.02) return 1;
  return 0;
}

/** 진화 · 합체 · 각성 (조건 되면 맨 앞에) */
function specials(r: Run): Card[] {
  const out: Card[] = [];
  const maxed = (id: WeaponId) => {
    const w = r.weapons.find((x) => x.id === id);
    return !!w && w.lv >= WEAPONS[id].lv.length;
  };
  for (const f of FUSIONS) {
    const [a, b] = WEAPONS[f].fuse!;
    if (maxed(a) && maxed(b)) out.push({ k: "fuse", id: f, from: 0, to: 1, rarity: 2 });
  }
  for (const f of EVOLUTIONS) {
    const [base, need] = WEAPONS[f].evo!;
    if (maxed(base) && r.passives.some((x) => x.id === need)) out.push({ k: "evo", id: f, from: 0, to: 1, rarity: 2 });
  }
  for (const w of r.weapons) {
    if (WEAPONS[w.id].owner !== r.hero || w.awake || !maxed(w.id)) continue;
    if (r.passives.some((x) => x.id === AWAKEN_NEED[r.hero])) out.push({ k: "awake", id: w.id, from: 0, to: 1, rarity: 2 });
  }
  return out;
}
const cardKey = (c: Card) => `${c.k}:${c.id}`;

/** 지금 고를 수 있는 카드 후보 */
function candidates(r: Run): Card[] {
  const out: Card[] = specials(r);
  for (const w of r.weapons) {
    const max = WEAPONS[w.id].lv.length;
    if (w.lv < max) out.push({ k: "weapon", id: w.id, from: w.lv, to: w.lv + 1, rarity: 0 });
  }
  if (r.weapons.length < MAX_WEAPONS)
    for (const id of SHARED_WEAPONS) {
      if (!r.pool.weapons.includes(id)) continue;
      if (r.weapons.some((w) => w.id === id || WEAPONS[w.id].evo?.[0] === id)) continue;
      // 이미 합체에 쓴 재료는 다시 안 나옴
      if (r.fused.some((f) => WEAPONS[f].fuse!.includes(id))) continue;
      out.push({ k: "weapon", id, from: 0, to: 1, rarity: 0 });
    }
  for (const ps of r.passives) if (ps.lv < PASSIVES[ps.id].max) out.push({ k: "passive", id: ps.id, from: ps.lv, to: ps.lv + 1, rarity: 0 });
  if (r.passives.length < MAX_PASSIVES) for (const id of PASSIVE_IDS) if (!r.passives.some((x) => x.id === id)) out.push({ k: "passive", id, from: 0, to: 1, rarity: 0 });
  return out.filter((c) => !r.banned.includes(cardKey(c)));
}

function maxOf(c: Card) {
  return c.k === "weapon" ? WEAPONS[c.id as WeaponId].lv.length : c.k === "passive" ? PASSIVES[c.id as PassiveId].max : 1;
}
const special = (c: Card) => c.k === "fuse" || c.k === "evo" || c.k === "awake";

function rollCards(r: Run): Card[] {
  const all = candidates(r);
  const fuses = all.filter(special);
  const rest = all.filter((c) => !special(c));
  const n = Math.min(4, (r.stats.luck >= 4 ? 4 : 3) + rel(r, "goldendice"));
  const out: Card[] = [...fuses.slice(0, n)];
  // 가진 걸 올리는 카드가 조금 더 잘 나오게 (빌드가 모이게)
  const weight = (c: Card) => (c.from > 0 ? 1.6 : c.k === "weapon" ? 1.2 : 1);
  while (out.length < n && rest.length) {
    let sum = 0;
    for (const c of rest) sum += weight(c);
    let x = rnd(r.rng) * sum;
    let k = 0;
    for (; k < rest.length - 1; k++) {
      x -= weight(rest[k]);
      if (x <= 0) break;
    }
    const c = rest.splice(k, 1)[0];
    const rar = rollRarity(r);
    const to = Math.min(maxOf(c), c.from + 1 + rar);
    out.push({ ...c, to, rarity: (to - c.from - 1) as Rarity });
  }
  if (!out.length) out.push({ k: "coin", from: 0, to: 0, rarity: 0 }, { k: "heal", from: 0, to: 0, rarity: 0 });
  return out;
}

function openLevel(r: Run) {
  const jackpot = rnd(r.rng) < 0.03 + r.stats.luck * 0.005 + rel(r, "goldendice") * 0.05;
  r.pause = { k: "level", cards: rollCards(r), jackpot };
}

function applyCard(r: Run, c: Card) {
  switch (c.k) {
    case "fuse":
      fuse(r, c.id as WeaponId);
      break;
    case "evo":
      evolve(r, c.id as WeaponId);
      break;
    case "awake":
      awaken(r, c.id as WeaponId);
      break;
    case "relic":
      giveRelic(r, c.id as RelicId);
      break;
    case "weapon":
      giveWeapon(r, c.id as WeaponId, c.to - c.from);
      break;
    case "passive":
      givePassive(r, c.id as PassiveId, c.to - c.from);
      break;
    case "coin":
      r.p.gold += 25;
      r.q.gold += 25;
      break;
    case "heal":
      r.p.hp = Math.min(maxHp(r), r.p.hp + 40);
      break;
  }
}

/** 레벨업 카드 고르기 (i = -1 이면 건너뛰기 · 잭팟이면 i 무시하고 전부) */
export function chooseCard(r: Run, i: number) {
  const pz = r.pause;
  if (!pz || pz.k !== "level") return;
  if (i === -1) {
    if (r.skips <= 0) return;
    r.skips--;
    r.p.gold += 10;
    r.q.gold += 10;
  } else if (pz.jackpot) for (const c of pz.cards) applyCard(r, c);
  else {
    const c = pz.cards[i];
    if (!c) return;
    applyCard(r, c);
  }
  r.pending--;
  r.pause = null;
  if (r.pending > 0) openLevel(r);
}

export function reroll(r: Run) {
  const pz = r.pause;
  if (!pz || pz.k !== "level" || r.rerolls <= 0 || pz.jackpot) return;
  r.rerolls--;
  r.pause = { k: "level", cards: rollCards(r), jackpot: false };
}

/** 카드 지우기: 이번 판에서 다시 안 나옴 · 그 칸만 새로 */
export function banishCard(r: Run, i: number) {
  const pz = r.pause;
  if (!pz || pz.k !== "level" || r.banish <= 0 || pz.jackpot) return;
  const c = pz.cards[i];
  if (!c || special(c) || c.k === "coin" || c.k === "heal") return;
  r.banish--;
  r.banned.push(cardKey(c));
  const keep = pz.cards.filter((_, j) => j !== i);
  const fresh = rollCards(r).filter((x) => !keep.some((k) => cardKey(k) === cardKey(x)));
  r.pause = { k: "level", cards: [...keep.slice(0, i), ...(fresh[0] ? [fresh[0]] : []), ...keep.slice(i)], jackpot: false };
}

/* ───────────── 보물 상자 ───────────── */

function openChest(r: Run, big: boolean, box = false) {
  r.chests++;
  r.q.chests++;
  const first = r.chests === 1;
  const luck = r.stats.luck;
  let n = 1;
  const x = rnd(r.rng);
  if (x < 0.05 + luck * 0.01) n = 5;
  else if (x < 0.28 + luck * 0.025) n = 3;
  if (box) n = x < 0.12 + luck * 0.01 ? 3 : 1;
  else if (first || big) n = Math.max(n, 3);
  const items: Card[] = [];
  for (let i = 0; i < n; i++) {
    // 진화 · 합체 · 각성이 되면 그것부터 (뱀서처럼 상자에서 터짐)
    const sp = specials(r)[0];
    const card: Card = sp ?? { k: "relic", id: rollRelic(r, big ? 1 : 0), from: 0, to: 1, rarity: 0 };
    applyCard(r, card);
    items.push(card);
  }
  const coins = box ? 0 : 10 + rndInt(r.rng, 21) + (big ? 40 : 0);
  r.p.gold += coins;
  r.q.gold += coins;
  r.pause = { k: "chest", items, coins, first, big };
  r.ev.push({ t: "chest" });
}

export function closeChest(r: Run) {
  if (r.pause?.k !== "chest") return;
  r.pause = null;
  if (r.pending > 0) openLevel(r);
}

/* ───────────── 결과 ───────────── */

export interface RunResult {
  hero: HeroId;
  sec: number;
  win: boolean;
  lv: number;
  kills: number;
  /** 판 안에서 주운 금화 */
  gold: number;
  taken: number;
  depth: number;
  /** 오버타임 버틴 시간 */
  ot: number;
  weapons: { id: WeaponId; lv: number; dmg: number; awake?: boolean }[];
  passives: { id: PassiveId; lv: number }[];
  relics: { id: RelicId; n: number }[];
  fused: WeaponId[];
  q: RunQ;
}

export function result(r: Run): RunResult {
  const q = { ...r.q, noHit: Math.max(r.q.noHit, Math.floor(r.t - r.hitAt)) };
  return {
    hero: r.hero,
    sec: Math.floor(r.t),
    win: r.win,
    lv: r.p.lv,
    kills: r.p.kills,
    gold: r.q.gold,
    taken: Math.round(r.taken),
    depth: r.depth,
    ot: Math.floor(r.otT),
    weapons: r.weapons.map((w) => ({ id: w.id, lv: w.lv, dmg: Math.round(w.dmgDone), awake: w.awake })).sort((a, b) => b.dmg - a.dmg),
    passives: r.passives.map((p) => ({ ...p })),
    relics: r.relicOrder.map((id) => ({ id, n: r.relics[id] ?? 0 })),
    fused: [...r.fused],
    q,
  };
}

export const timeLeft = (r: Run) => Math.max(0, RUN_SEC - r.t);
