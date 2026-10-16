/*
 * 픽셀 타운 서바이버 — 판 시뮬레이션 (60틱 고정). 화면은 이 상태를 읽어서 그리기만 함.
 * 브라우저 · 서버(검증 · 밸런스 시뮬) 공용 — "@/" import 금지.
 */
import { rnd, rndInt, type Rng } from "../defense/rng";
import {
  BASE_STATS,
  DASH_CD,
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
  type HeroId,
  type PassiveId,
  type PickupKind,
  type Rarity,
  type Stats,
  type WeaponId,
  type WeaponLv,
} from "./data";

/* ───────────── 상태 ───────────── */

export interface Input {
  /** 이동 (-1~1, 길이 ≤ 1) */
  mx: number;
  my: number;
  dash: boolean;
  ult: boolean;
}

export interface BossAI {
  phase: "chase" | "warn" | "dash" | "ring" | "summon";
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
  k: "drop" | "fire" | "rain" | "spin" | "moon" | "grenade" | "cone" | "whip" | "pulse" | "shell";
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

export interface WeaponSlot {
  id: WeaponId;
  lv: number;
  t: number;
  /** 회전 각 (orbit) */
  ang: number;
  /** 남은 연사 (facing · spin) */
  burst: number;
  burstT: number;
  dmgDone: number;
}

export interface Card {
  k: "weapon" | "passive" | "fuse" | "coin" | "heal";
  id?: WeaponId | PassiveId;
  /** 지금 레벨 (0 = 새로) */
  from: number;
  /** 받으면 레벨 */
  to: number;
  rarity: Rarity;
}

export type Pause =
  | { k: "level"; cards: Card[]; jackpot: boolean }
  | { k: "chest"; items: Card[]; coins: number; first: boolean; big: boolean };

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
  coins: number;
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
}

/* ───────────── 만들기 ───────────── */

function zone(z: Omit<Zone, "alive" | "dx" | "dy" | "hits"> & Partial<Pick<Zone, "dx" | "dy">>): Zone {
  return { alive: true, dx: 0, dy: 0, hits: [], ...z };
}

export interface RunOpts {
  /** 응원 동료 (최대 2) */
  sup?: HeroId[];
  revive?: number;
  rerolls?: number;
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
    p: { x: 0, y: 0, hp: 0, fx: 1, fy: 0, face: 1, moving: false, inv: 0, dashT: 0, dashCd: 0, dx: 1, dy: 0, ult: 0, ultT: 0, lv: 1, xp: 0, kills: 0, coins: 0, revive: 0 },
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
    rerolls: 2 + (opts.rerolls ?? 0),
    skips: 2,
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
  for (const ps of r.passives) addStats(s, PASSIVES[ps.id].per, ps.lv);
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

function fuse(r: Run, id: WeaponId) {
  const [a, b] = WEAPONS[id].fuse!;
  const ia = r.weapons.findIndex((w) => w.id === a);
  const wa = r.weapons[ia];
  r.weapons = r.weapons.filter((w) => w.id !== b);
  // 첫 재료 자리에 합체 무기
  const at = r.weapons.findIndex((w) => w.id === a);
  r.weapons[at] = { id, lv: 1, t: 0.2, ang: 0, burst: 0, burstT: 0, dmgDone: wa?.dmgDone ?? 0 };
  r.fused.push(id);
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
  return {
    dmg: b.dmg * (1 + s.might),
    cd: b.cd * Math.max(0.4, 1 - s.cooldown) * (r.buff.haste > 0 ? 0.45 : 1),
    n: b.n + (multi ? s.amount : 0),
    size: b.size * (1 + s.area),
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

function hurt(r: Run, e: Enemy, dmg: number, slot: number, kb: number, fromX: number, fromY: number) {
  if (!e.alive) return;
  const s = r.stats;
  const crit = r.buff.crit > 0 || rnd(r.rng) < 0.05 + s.luck * 0.015;
  const v = Math.max(1, Math.round(dmg * (crit ? 2 : 1) * (e.vuln > 0 ? 1.5 : 1) * (0.9 + rnd(r.rng) * 0.2)));
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
  r.ev.push({ t: "dmg", x: e.x, y: e.y - e.r, v, crit });
  if (e.hp <= 0) {
    kill(r, e);
    if (slot >= 0 && r.weapons[slot] && WEAPONS[r.weapons[slot].id].fx === "coin" && rnd(r.rng) < 0.3) dropPickup(r, "coin", e.x, e.y, 1);
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
  p.ult = Math.min(ULT_NEED, p.ult + (e.def.boss ? 40 : e.elite ? 15 : 1));
  r.ev.push({ t: "kill", x: e.x, y: e.y, kind: e.kind, elite: e.elite, boss: !!e.def.boss });
  dropGem(r, e.x, e.y, e.xp);
  if (e.def.boss) {
    dropPickup(r, "chest", e.x, e.y, 1);
    dropPickup(r, "bag", e.x + 14, e.y, 50);
    if (r.bossId === e.id) r.bossId = -1;
    if (e.kind === FINAL_BOSS) {
      r.win = true;
      r.arena = null;
      r.ev.push({ t: "win" });
    } else r.arena = null;
    return;
  }
  if (e.elite) {
    dropPickup(r, "chest", e.x, e.y, 0);
    return;
  }
  const x = rnd(r.rng);
  if (x < 0.018) dropPickup(r, "coin", e.x, e.y, 1);
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
  const hpMul = def.boss ? 1 : 1 + r.t / 140;
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
    dmg: def.dmg * (elite ? 1.5 : 1) * (1 + r.t / 600),
    xp: def.xp * (elite ? 10 : 1),
    elite,
    flash: 0,
    slow: 0,
    stun: 0,
    vuln: 0,
    hitAt: [-9, -9, -9, -9, -9, -9, -9, -9, -9, -9],
    t: rnd(r.rng) * 10,
    face: 1,
    boss: def.boss ? { phase: "chase", t: 2.5, dx: 0, dy: 0, step: 0, enraged: false } : null,
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
  if (r.win && !r.over) r.over = true;
}

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
  // 잡몹 유지
  const finale = r.arena !== null;
  if (!finale) {
    const w = waveAt(r.t);
    let alive = 0;
    for (const e of r.enemies) if (e.alive && !e.def.boss) alive++;
    const target = r.bossId >= 0 ? w.count * 0.5 : w.count;
    r.spawnAcc += w.rate * (r.bossId >= 0 ? 0.5 : 1) * DT;
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
      if (ws.lv >= 5 || def.fx === "sleep")
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
        const s = mkShot(r, slot, ws.id, p.x, p.y - 6, Math.cos(a) * w.spd * 0.6, Math.sin(a) * w.spd * 0.6, w, ws.id === "missile" ? w.size : 0);
        s.r = ws.id === "missile" ? 4 : 5;
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
      if (z.delay <= 0) {
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
  const v = Math.max(1, Math.round(dmg - r.stats.armor));
  p.hp -= v;
  p.inv = 0.5;
  r.taken += v;
  r.ev.push({ t: "hurt", v });
}

function bossAI(r: Run, e: Enemy, dx: number, dy: number) {
  const b = e.boss!;
  const final = e.kind === FINAL_BOSS;
  if (!b.enraged && e.hp < e.maxHp * 0.5) {
    b.enraged = true;
    r.ev.push({ t: "warn", text: `${e.def.name} 분노!` });
  }
  const fast = b.enraged ? 0.7 : 1;
  b.t -= DT;
  switch (b.phase) {
    case "chase":
      e.x += dx * e.speed * DT;
      e.y += dy * e.speed * DT;
      if (Math.abs(dx) > 0.05) e.face = dx > 0 ? 1 : -1;
      if (b.t <= 0) {
        const order: BossAI["phase"][] = final ? ["warn", "ring", "warn", "summon"] : ["warn", "ring", "summon"];
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
    case "bag":
      p.coins += k.v;
      break;
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

/* ───────────── 필살기 ───────────── */

function castUlt(r: Run) {
  const p = r.p;
  if (p.ult < ULT_NEED || r.over) return;
  p.ult = 0;
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

/** 지금 고를 수 있는 카드 후보 */
function candidates(r: Run): Card[] {
  const out: Card[] = [];
  // 합체 (둘 다 만렙) — 무조건 맨 앞
  for (const f of FUSIONS) {
    const [a, b] = WEAPONS[f].fuse!;
    const wa = r.weapons.find((w) => w.id === a);
    const wb = r.weapons.find((w) => w.id === b);
    if (wa && wb && wa.lv >= WEAPONS[a].lv.length && wb.lv >= WEAPONS[b].lv.length) out.push({ k: "fuse", id: f, from: 0, to: 1, rarity: 2 });
  }
  for (const w of r.weapons) {
    const max = WEAPONS[w.id].lv.length;
    if (w.lv < max) out.push({ k: "weapon", id: w.id, from: w.lv, to: w.lv + 1, rarity: 0 });
  }
  if (r.weapons.length < MAX_WEAPONS)
    for (const id of SHARED_WEAPONS) {
      if (r.weapons.some((w) => w.id === id)) continue;
      // 이미 합체에 쓴 재료는 다시 안 나옴
      if (r.fused.some((f) => WEAPONS[f].fuse!.includes(id))) continue;
      out.push({ k: "weapon", id, from: 0, to: 1, rarity: 0 });
    }
  for (const ps of r.passives) if (ps.lv < PASSIVES[ps.id].max) out.push({ k: "passive", id: ps.id, from: ps.lv, to: ps.lv + 1, rarity: 0 });
  if (r.passives.length < MAX_PASSIVES) for (const id of PASSIVE_IDS) if (!r.passives.some((x) => x.id === id)) out.push({ k: "passive", id, from: 0, to: 1, rarity: 0 });
  return out;
}

function maxOf(c: Card) {
  return c.k === "weapon" ? WEAPONS[c.id as WeaponId].lv.length : c.k === "passive" ? PASSIVES[c.id as PassiveId].max : 1;
}

function rollCards(r: Run): Card[] {
  const all = candidates(r);
  const fuses = all.filter((c) => c.k === "fuse");
  const rest = all.filter((c) => c.k !== "fuse");
  const n = r.stats.luck >= 4 ? 4 : 3;
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
  const jackpot = rnd(r.rng) < 0.03 + r.stats.luck * 0.005;
  r.pause = { k: "level", cards: rollCards(r), jackpot };
}

function applyCard(r: Run, c: Card) {
  switch (c.k) {
    case "fuse":
      fuse(r, c.id as WeaponId);
      break;
    case "weapon":
      giveWeapon(r, c.id as WeaponId, c.to - c.from);
      break;
    case "passive":
      givePassive(r, c.id as PassiveId, c.to - c.from);
      break;
    case "coin":
      r.p.coins += 25;
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
    r.p.coins += 10;
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

/* ───────────── 보물 상자 ───────────── */

function openChest(r: Run, big: boolean) {
  r.chests++;
  const first = r.chests === 1;
  const luck = r.stats.luck;
  let n = 1;
  const x = rnd(r.rng);
  if (x < 0.05 + luck * 0.01) n = 5;
  else if (x < 0.28 + luck * 0.025) n = 3;
  if (first || big) n = Math.max(n, 3);
  const items: Card[] = [];
  for (let i = 0; i < n; i++) {
    const all = candidates(r);
    // 합체가 되면 그것부터 (뱀서 진화처럼 상자에서 터짐)
    const c = all.find((c) => c.k === "fuse") ?? (all.length ? all.filter((c) => c.from > 0 || c.k === "fuse").concat(all.filter((c) => c.from === 0))[rndInt(r.rng, Math.min(all.length, Math.max(1, all.filter((c) => c.from > 0).length || all.length)))] : undefined);
    if (!c) break;
    const card: Card = { ...c, to: c.k === "fuse" ? 1 : c.from + 1, rarity: 0 };
    applyCard(r, card);
    items.push(card);
  }
  const coins = 10 + rndInt(r.rng, 21) + (big ? 40 : 0);
  r.p.coins += coins;
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
  coins: number;
  taken: number;
  weapons: { id: WeaponId; lv: number; dmg: number }[];
  passives: { id: PassiveId; lv: number }[];
  fused: WeaponId[];
}

export function result(r: Run): RunResult {
  return {
    hero: r.hero,
    sec: Math.floor(r.t),
    win: r.win,
    lv: r.p.lv,
    kills: r.p.kills,
    coins: r.p.coins,
    taken: Math.round(r.taken),
    weapons: r.weapons.map((w) => ({ id: w.id, lv: w.lv, dmg: Math.round(w.dmgDone) })).sort((a, b) => b.dmg - a.dmg),
    passives: r.passives.map((p) => ({ ...p })),
    fused: [...r.fused],
  };
}

export const timeLeft = (r: Run) => Math.max(0, RUN_SEC - r.t);
