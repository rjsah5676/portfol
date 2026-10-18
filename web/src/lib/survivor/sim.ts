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
  PATROL_EVOLUTIONS,
  FLAG_CHARGE,
  OT_STEP,
  SHRINE_CHARGE,
  LAMP_CHARGE,
  LAMP_R,
  SPOUT_FUSE,
  GUARD_AGGRO,
  GUARD_HP,
  GUARD_R,
  BEACON,
  TIDE_H,
  type Quest,
  type GuideK,
  SPOUT_R,
  TRIAL_R,
  TRIAL_SEC,
  DT,
  ENEMIES,
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
  STAGES,
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
  type BossPhase,
  type ChapterDef,
  type StageDef,
  type StageId,
} from "./data";
import { ARMY_CAP, ARMY_DMG, ARMY_PER_LV, ARMY_GRADE_COLOR, GLOBAL_RANGE, TILE, UNIT, buyCost, craftable, fullRefund, luckTier, mergeKey, mergeable, pickNeeds, rollGrade, rollUnit, sizeOf } from "./army";
import { SIZE_MULT, type Faction, type Grade as UnitGrade } from "../defense/units";
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
  phase: "chase" | "dash" | BossPhase;
  /** 회오리 남은 시간 · 바늘 각도 */
  spin: number;
  ang: number;
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
  /** 곧장 질주하는 몹의 지금 방향 */
  mx: number;
  my: number;
  /** 등불을 노림 (지키기 판) */
  tgt?: boolean;
  /** 보물 도깨비: 사라질 때까지 남은 초 · 다음 금화를 흘릴 체력 비율 */
  left?: number;
  drop?: number;
}

/** 럭키 출격: 부대 유닛 */
export interface ArmyUnit {
  uid: number;
  id: string;
  x: number;
  y: number;
  /** 다음 공격까지 · 다음 필살까지 */
  cd: number;
  ult: number;
  /** 공격 모션 (초) */
  anim: number;
  face: 1 | -1;
  dmgDone: number;
  /** 들어온 시각 (등장 연출) */
  born: number;
}
export interface Army {
  units: ArmyUnit[];
  /** 금화로 소환한 수 (값이 오름) */
  bought: number;
  uid: number;
  /** 지금까지 가장 높은 등급 */
  best: number;
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
  /** 튕기는 공: 부딪힌 뒤 찌그러짐 (초, 그림용) */
  sq?: number;
}

/** 시간이 지나며 피해를 주는 자리 (택배 낙하 · 불바다 · 회전 차기 그림) */
export interface Zone {
  alive: boolean;
  k: "drop" | "fire" | "rain" | "spin" | "moon" | "grenade" | "cone" | "whip" | "pulse" | "shell" | "slam" | "ember" | "beam" | "thrust" | "snow";
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
  /** 떨어진 시각 · 튀어나온 자리 (그림: 톡 튀어 포물선으로 내려앉음) */
  born?: number;
  ox?: number;
  oy?: number;
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
  /** w: 때린 무기 (없으면 유물 · 필살) · big: 정예 · 보스 */
  | { t: "dmg"; x: number; y: number; v: number; crit: boolean; w?: WeaponId; big?: boolean }
  /** face: 보던 방향 · dx, dy: 날아갈 방향 (맞은 쪽 반대, 단위 벡터) — 죽는 연출용 */
  | { t: "kill"; x: number; y: number; kind: EnemyKind; elite: boolean; boss: boolean; face: number; dx: number; dy: number }
  | { t: "gem"; v: number }
  | { t: "lvl"; lv: number }
  | { t: "pick"; k: PickupKind; v: number }
  | { t: "hurt"; v: number }
  | { t: "boom"; x: number; y: number; r: number; c: string; w?: WeaponId }
  | { t: "bolt"; x: number; y: number; r: number; j?: boolean }
  | { t: "dice"; x: number; y: number; face: number }
  | { t: "fire"; w: WeaponId }
  | { t: "thorns"; x: number; y: number; r: number }
  /** 순찰대 기믹이 처음 나옴 → 안내 */
  | { t: "guide"; k: GuideK }
  | { t: "tide"; y: number }
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
  | { t: "trialgo" }
  | { t: "slam"; x: number; y: number }
  | { t: "rage"; name: string }
  | { t: "ot"; lv: number }
  | { t: "zap"; x0: number; y0: number; x1: number; y1: number }
  | { t: "shield" }
  | { t: "toll"; on: boolean }
  /** 등대 마지막 섬광 */
  | { t: "lhflash"; x: number; y: number }
  | { t: "frostflash"; x: number; y: number }
  | { t: "fog"; on: boolean }
  | { t: "beamin" }
  /** 럭키 출격: 소환 · 합성 · 조합 (full = 부대가 가득 차 금화로) */
  | { t: "summon"; id: string; grade: number; src: "lv" | "chest" | "buy" | "merge" | "craft" | "start"; full?: number }
  /** 유닛 공격 (선 · 근접이면 베기) */
  | { t: "ahit"; x0: number; y0: number; x1: number; y1: number; c: string; melee: boolean }
  /** 유닛 필살 (레전드 이상은 이름 외침) */
  | { t: "ault"; id: string; name: string; x: number; y: number; r: number; c: string }
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
  stage: StageId;
  /** 이번 판 맵 정의 (챕터면 챕터 웨이브 · 이벤트 · 보스를 얹은 것) */
  def: StageDef;
  /** 픽셀 순찰대 챕터 (없으면 보통 서바이버 판) */
  ch: ChapterDef | null;
  /** 판 길이 (초) — 이때 마지막 보스 */
  len: number;
  /** 장비 공격력 → 모든 피해 배율 */
  atk: number;
  /** 챕터 보스를 잡는 데 걸린 초 (별 3) */
  finalAge: number;
  /** 레벨업 경험치 배율 (챕터는 빨리 큼) */
  xpk: number;
  /** 럭키 출격 (실험 모드) — 없으면 보통 판 */
  army: Army | null;
  /** 자정의 종 (시계탑 광장): 남은 울림 시간 · 다음 울림 시각 */
  toll: { on: number; next: number };
  /** 순찰대 무기 별 */
  wstar: Partial<Record<WeaponId, number>>;
  /** 순찰대 특수 판 목표 진행 (없으면 목표 없음) · 지킬 등불 */
  quest: { q: Quest; got: number; need: number; done: boolean; fail: boolean } | null;
  guard: Thing | null;
  /** 구역 2 기믹: 밀물 (남은 시간 · 다음 · 띠 가운데 y) · 안개 · 등대 각도 */
  tide: { on: number; next: number; y: number };
  fog: { on: number; next: number };
  beacon: { ang: number; tick: number; lit: boolean } | null;
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
  /** 멀리 두고 온 젬 경험치 (다음 젬들에 나눠 얹음) */
  gemBank: number;
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
  stage?: StageId;
  /** 럭키 출격: 레벨업 · 상자 · 금화로 디펜스 유닛 부대 */
  army?: boolean;
  /** 픽셀 순찰대 챕터 */
  chapter?: ChapterDef;
  /** 장비: 공격력 (피해 ×(1+atk/100)) · 무기 칸 시작 무기 · 판 시작 때 받는 유물 */
  gear?: { atk: number; weapon?: WeaponId; wlv?: number; relics?: RelicId[] };
  /** 순찰대 무기 별 (1~5) — 피해 +5%씩 · ★3 고유 효과 · ★5 Lv5 +1개 */
  wstars?: Partial<Record<WeaponId, number>>;
}

/** 판 맵 정의: 챕터면 바탕 맵에 챕터 웨이브 · 이벤트 · 보스 · 배율을 얹음 */
function defOf(stage: StageDef, ch: ChapterDef | undefined): StageDef {
  if (!ch) return stage;
  return { ...stage, waves: ch.waves, events: ch.events, final: ch.final, boss: { ...stage.boss, ...ch.boss }, hp: ch.hp, toll: ch.toll, deco: ch.deco ?? stage.deco };
}

export function newRun(hero: HeroId, seed: number, bonus: Partial<Stats> = {}, opts: RunOpts = {}): Run {
  const h = HEROES[hero];
  const stats: Stats = { ...BASE_STATS };
  addStats(stats, h.passive.stat);
  addStats(stats, bonus);
  const ch = opts.chapter;
  const stage = STAGES[ch?.stage ?? opts.stage ?? "town"] ?? STAGES.town;
  const def = defOf(stage, ch);
  const r: Run = {
    hero,
    stage: stage.id,
    def,
    ch: ch ?? null,
    len: ch?.len ?? RUN_SEC,
    atk: 1 + Math.max(0, opts.gear?.atk ?? 0) / 100,
    finalAge: 0,
    xpk: ch?.xp ?? 1,
    army: opts.army ? { units: [], bought: 0, uid: 1, best: 0 } : null,
    toll: { on: 0, next: def.toll?.from ?? 1e9 },
    quest: ch?.quest ? { q: ch.quest, got: 0, need: ch.quest.k === "guard" ? 1 : ch.quest.n, done: false, fail: false } : null,
    guard: null,
    tide: { on: 0, next: ch?.tide?.from ?? 1e9, y: 0 },
    fog: { on: 0, next: ch?.fog?.from ?? 1e9 },
    beacon: ch?.beacon ? { ang: 0, tick: 0, lit: false } : null,
    wstar: opts.wstars ?? {},
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
    // 챕터: 상인 · 우물 없음, 시련만 두 번
    merchantT: ch ? Infinity : 75,
    sched: ch
      ? [
          { at: 110, k: "trial" },
          { at: 300, k: "trial" },
        ]
      : [
          { at: 130, k: "trial" },
          { at: 200, k: "fountain" },
          { at: 350, k: "trial" },
          { at: 440, k: "fountain" },
          { at: 515, k: "trial" },
        ],
    pool: ch ? { weapons: opts.weapons ?? SHARED_WEAPONS, relics: [] } : { weapons: opts.weapons ?? BASE_WEAPONS, relics: opts.relics ?? BASE_RELICS },
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
    gemBank: 0,
    flag: null,
  };
  r.p.hp = maxHp(r);
  r.p.revive = opts.revive ?? 0;
  giveWeapon(r, h.weapon, 1);
  // 장비: 무기 칸 시작 무기 · 특수 효과 유물
  const g = opts.gear;
  if (g?.weapon && g.weapon !== h.weapon) giveWeapon(r, g.weapon, Math.max(1, g.wlv ?? 1));
  for (const id of g?.relics ?? []) giveRelic(r, id);
  // 장비 효과는 시작할 때 알림 띄우지 않음
  if (g?.relics?.length) r.ev.length = 0;
  if (r.army) {
    // 공용 무기 카드는 안 나옴 (부대가 무기) · 시작 부대 둘
    r.pool = { ...r.pool, weapons: [] };
    armyRoll(r, 0, "start");
    armyRoll(r, 0, "start");
  }
  // 처음 화면이 비어 보이지 않게 가로등 몇 개 · 시작하자마자 손맛이 오게 가까이 몹 한 무리
  for (let i = 0; i < 3; i++) spawnProp(r, 120 + i * 60);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    spawnEnemy(r, stage.opening[i % 3 ? 0 : 1], Math.cos(a) * 170, Math.sin(a) * 105);
  }
  return r;
}

function addStats(s: Stats, add: Partial<Stats>, k = 1) {
  for (const key of Object.keys(add) as (keyof Stats)[]) s[key] += (add[key] ?? 0) * k;
}

export const maxHp = (r: Run) => HEROES[r.hero].hp + r.stats.maxHp;
/** 지금 레벨에서 다음 레벨까지 경험치 (챕터는 배율) */
export const needXp = (r: Run) => Math.max(1, Math.round(xpNeed(r.p.lv) * r.xpk));

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
/** 순찰대 판에서만 곱하는 무기 피해 (서바이버 캐릭터 무기를 덱 무기로 쓸 때) */
const PATROL_WMUL: Partial<Record<WeaponId, number>> = { umbrella: 3, downpour: 2.5 };
function wstat(r: Run, ws: WeaponSlot): W {
  const def = WEAPONS[ws.id];
  const b: WeaponLv = def.lv[Math.min(def.lv.length, ws.lv) - 1];
  const s = r.stats;
  const multi = def.pattern !== "aura" && def.pattern !== "spin";
  const aw = ws.awake ? 1 : 0;
  const haste = r.buff.haste > 0 || r.flag?.k === "haste";
  // 순찰대 무기 별: 피해 +5%씩 · ★3 고유 · ★5 Lv5 에서 +1개 (오라 · 파동 · 회전은 범위)
  const st = r.wstar[ws.id] ?? 1;
  // 순찰대에서만: 넉백이 커서 피해가 거의 안 쌓이는 무기 보정
  const pm = r.ch ? (PATROL_WMUL[ws.id] ?? 1) : 1;
  const s3 = st >= 3 ? ws.id : "";
  const s5 = st >= 5 && ws.lv >= def.lv.length;
  const wide = def.pattern === "aura" || def.pattern === "pulse" || def.pattern === "spin";
  return {
    dmg: b.dmg * (1 + s.might) * (aw ? 1.6 : 1) * (1 + 0.05 * (st - 1)) * pm,
    cd: b.cd * Math.max(0.4, 1 - s.cooldown) * (haste ? 0.45 : 1) * (aw ? 0.85 : 1),
    n: b.n + (multi ? s.amount : 0) + (aw && multi ? 1 : 0) + (s5 && !wide ? 1 : 0),
    size:
      b.size *
      (1 + s.area) *
      (aw ? 1.2 : 1) *
      (s3 === "boomerang" ? 1.2 : s3 === "bolt" || s3 === "missile" ? 1.25 : s3 === "thorns" ? 1.15 : 1) *
      (s5 && wide ? 1.15 : 1),
    spd: b.spd * (1 + s.pspeed),
    pierce: b.pierce + (s3 === "shuriken" || s3 === "coins" ? 1 : 0),
    dur: b.dur * (1 + s.duration) * (s3 === "ball" ? 1.3 : 1),
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
  if (inTide(r, e.y)) mul += 0.25;
  const whet = rel(r, "whetstone");
  const crit = r.buff.crit > 0 || rnd(r.rng) < 0.05 + s.luck * 0.015 + whet * 0.06;
  let cm = crit ? 2 + whet * 0.3 : 1;
  let mega = false;
  if (crit && rel(r, "fork") && rnd(r.rng) < 0.15 * rel(r, "fork")) {
    cm = 5 + whet * 0.3;
    mega = true;
  }
  const v = Math.max(1, Math.round(dmg * r.atk * mul * cm * (e.vuln > 0 ? 1.5 : 1) * (0.9 + rnd(r.rng) * 0.2)));
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
  r.ev.push({ t: "dmg", x: e.x, y: e.y - e.r, v, crit: crit || mega, w: slot >= 0 ? r.weapons[slot]?.id : undefined, big: e.elite || e.def.boss });
  // 보물 도깨비: 체력 15% 깎일 때마다 금화를 흘림
  while (e.drop !== undefined && e.hp > 0 && e.hp < e.maxHp * e.drop) {
    e.drop -= 0.15;
    dropPickup(r, "coin", e.x + (rnd(r.rng) - 0.5) * 16, e.y + (rnd(r.rng) - 0.5) * 10, 2 + Math.floor(r.t / 60));
  }
  // 사신의 낫: 조금 남은 일반 적은 바로
  const sc = rel(r, "scythe");
  if (sc && e.hp > 0 && !e.def.boss && !e.elite && e.hp <= e.maxHp * Math.min(0.24, 0.08 * sc)) e.hp = 0;
  if (e.hp <= 0) {
    kill(r, e);
    if (slot >= 0 && r.weapons[slot] && WEAPONS[r.weapons[slot].id].fx === "coin" && rnd(r.rng) < (r.weapons[slot].id === "goldrain" ? 0.5 : 0.3)) dropPickup(r, "coin", e.x, e.y, 1);
  }
  // 순찰대 무기 ★3: 물방울 우산 = 느려짐 · 음표 파동 = 멈칫
  if (slot >= 0 && e.alive && !e.def.boss) {
    const wid = r.weapons[slot]?.id;
    if (wid === "downpour") e.slow = Math.max(e.slow, 1.2);
    else if (wid === "symphony") e.stun = Math.max(e.stun, 0.35);
    else if (wid && (r.wstar[wid] ?? 1) >= 3) {
      if (wid === "umbrella") e.slow = Math.max(e.slow, 1);
      else if (wid === "notes") e.stun = Math.max(e.stun, 0.3);
    }
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
  // 날아갈 방향: 마지막 넉백 쪽 (없으면 플레이어 반대쪽)
  let kx = e.kx;
  let ky = e.ky;
  if (Math.hypot(kx, ky) < 1) {
    kx = e.x - p.x;
    ky = e.y - p.y;
  }
  const kd = Math.hypot(kx, ky) || 1;
  r.ev.push({ t: "kill", x: e.x, y: e.y, kind: e.kind, elite: e.elite, boss: !!e.def.boss, face: e.face, dx: kx / kd, dy: ky / kd });
  dropGem(r, e.x, e.y, e.xp);
  if (e.def.boss) {
    dropPickup(r, "chest", e.x, e.y, 1);
    dropPickup(r, "bag", e.x + 14, e.y, 50);
    if (r.bossId === e.id) r.bossId = -1;
    const age = Math.max(1, Math.round(e.boss?.age ?? 0));
    if (e.kind === "boss_jelly") r.q.jelly = r.q.jelly || age;
    if (e.kind === "boss_cuckoo") r.q.cuckoo = r.q.cuckoo || age;
    if (e.kind === r.def.final) {
      if (e.kind === "boss_clock") r.q.clock = r.q.clock || age;
      else if (e.kind === "boss_tower") r.q.tower = r.q.tower || age;
      if (r.ch && !r.win) {
        // 챕터: 보스를 잡으면 바로 클리어 (오버타임 없음)
        r.finalAge = age;
        r.win = true;
        r.over = true;
        r.arena = null;
        r.ev.push({ t: "win" });
      } else if (!r.win) {
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
    if (r.quest?.q.k === "rush") questGot(r);
    dropPickup(r, "chest", e.x, e.y, 0);
    return;
  }
  if (e.kind === "goblin") {
    if (r.quest?.q.k === "goblin") questGot(r);
    dropPickup(r, "chest", e.x, e.y, 0);
    dropPickup(r, "bag", e.x + 12, e.y, 20 + Math.floor(r.t / 10));
    r.ev.push({ t: "warn", text: "보물 도깨비를 잡았어요!" });
    return;
  }
  // 안개 속 처치: 코인을 더 떨굼
  if (r.fog.on > 0 && rnd(r.rng) < 0.15) dropPickup(r, "coin", e.x, e.y, 2 + Math.floor(r.t / 120));
  const x = rnd(r.rng);
  if (x < 0.035) dropPickup(r, "coin", e.x, e.y, 1 + Math.floor(r.t / 200));
  else if (x < 0.0205) dropPickup(r, "meat", e.x, e.y, 0);
  else if (x < 0.0215) dropPickup(r, "magnet", e.x, e.y, 0);
}

/** 밀물 띠 안인지 (y 만 봄 — 띠는 가로로 길게) */
export const inTide = (r: Run, y: number) => r.tide.on > 0 && Math.abs(y - r.tide.y) < TIDE_H;
/** 등대 빛줄기 안인지 */
export function inBeacon(r: Run, x: number, y: number) {
  if (!r.beacon) return false;
  const dx = x - BEACON.x;
  const dy = (y - BEACON.y) / 0.8;
  const d = Math.hypot(dx, dy);
  if (d > BEACON.len || d < 10) return false;
  const a = Math.atan2(dy, dx);
  for (let k = 0; k < 2; k++) {
    let da = Math.abs(a - (r.beacon.ang + k * Math.PI));
    da = Math.min(da % (Math.PI * 2), Math.PI * 2 - (da % (Math.PI * 2)));
    if (da < BEACON.half) return true;
  }
  return false;
}

function questGot(r: Run) {
  const qs = r.quest!;
  qs.got++;
  if (qs.got >= qs.need && !qs.done) {
    qs.done = true;
    r.ev.push({ t: "warn", text: "목표 달성! ★" });
  }
}

function dropGem(r: Run, x: number, y: number, v: number) {
  // 자정의 종이 울리는 동안 경험치 두 배
  if (r.toll.on > 0) v *= 2;
  // 멀리 두고 온 젬 몫을 조금씩 새 젬에 얹어 줌 (한꺼번에 몰리지 않게)
  if (r.gemBank > 0) {
    const take = Math.min(r.gemBank, Math.max(v * 2, needXp(r) * 0.12));
    r.gemBank -= take;
    v += take;
  }
  const alive = r.gems.length;
  if (alive >= GEM_CAP) {
    // 너무 많으면 떨어진 자리에서 가장 가까운 젬에 더함 (먼 데 있는 젬에 몰려 레벨이 멈췄다 한꺼번에 오르지 않게)
    let best = r.gems[0];
    let bd = Infinity;
    for (const g of r.gems) {
      if (!g.alive || g.pull) continue;
      const d = (g.x - x) ** 2 + (g.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    best.v += v;
    return;
  }
  // 죽은 자리에서 조금 옆으로 톡 튀어나감
  const a = rnd(r.rng) * Math.PI * 2;
  const d = 6 + rnd(r.rng) * 10;
  r.gems.push({ alive: true, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, v, pull: false, sp: 0, born: r.t, ox: x, oy: y });
}
const GEM_CAP = 420;
/** 이만큼 멀어진 젬은 치우고 그 경험치 절반은 다음 젬들에 나눠 얹음 (두고 가면 손해는 보게) */
const GEM_FAR = 560;
function sweepFarGems(r: Run) {
  const p = r.p;
  for (const g of r.gems) {
    if (!g.alive || g.pull) continue;
    if ((g.x - p.x) ** 2 + ((g.y - p.y) * 1.4) ** 2 > GEM_FAR * GEM_FAR) {
      g.alive = false;
      r.gemBank += g.v * 0.5;
    }
  }
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
  const hpMul = (def.boss ? 1 : 1 + r.t / 140) * dm.hp * (1 + r.curse) * ot * r.def.hp;
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
    dmg: def.dmg * (elite ? 1.5 : 1) * (1 + Math.min(r.t, 900) / 600) * dm.dmg * (1 + r.curse * 0.5) * (1 + r.otLv * 0.12) * (r.ch?.dmg ?? 1),
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
    boss: def.boss ? { phase: "chase", t: 2.5, dx: 0, dy: 0, step: 0, enraged: false, age: 0, rage: false, spin: 0, ang: 0 } : null,
    mx: 0,
    my: 0,
  };
  e.maxHp = e.hp;
  if (r.guard?.alive && !def.boss && def.move !== "flee" && rnd(r.rng) < GUARD_AGGRO) e.tgt = true;
  r.enemies.push(e);
  return e;
}

/** 화면 바깥 둘레에서 */
function ringPos(r: Run, rad = 300): [number, number] {
  const a = rnd(r.rng) * Math.PI * 2;
  // 화면 비율에 맞춰 타원으로 (16:9 화면에서 위아래는 덜 멀게)
  return [r.p.x + Math.cos(a) * rad, r.p.y + Math.sin(a) * rad * 0.62];
}

function waveAt(r: Run, t: number) {
  const ws = r.def.waves;
  let w = ws[0];
  for (const x of ws) if (t >= x.at) w = x;
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
  if (r.army) updateArmy(r);
  updateShots(r);
  updateZones(r);
  updateEnemies(r);
  updateBullets(r);
  updatePickups(r);
  if (r.tick % 30 === 0) sweepFarGems(r);
  updateThings(r);
  if (inp.ult) castUlt(r);
  compact(r);
  // 레벨업
  const p = r.p;
  while (p.xp >= needXp(r)) {
    p.xp -= needXp(r);
    p.lv++;
    // 럭키 출격: 레벨업마다 소환, 다섯 번째마다 카드 (패시브 · 유물 · 고유 무기)
    if (r.army && p.lv % 5 !== 0) armyRoll(r, 0, "lv");
    else r.pending++;
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
  const sp = HEROES[r.hero].speed * (1 + r.stats.speed) * (inTide(r, r.p.y) ? 0.8 : 1);
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
  const st = r.def;
  const EVS = st.events;
  while (r.nextEvent < EVS.length && r.t >= EVS[r.nextEvent].at) {
    const ev = EVS[r.nextEvent++];
    if (ev.k === "elite") {
      const n = ev.n ?? 1;
      for (let i = 0; i < n; i++) {
        const [x, y] = ringPos(r);
        spawnEnemy(r, ev.kind, x, y, true);
      }
      r.ev.push({ t: "warn", text: n > 1 ? `엘리트 ${n}마리! 처치하면 보물 상자` : "엘리트 등장! 처치하면 보물 상자" });
      if (r.quest?.q.k === "rush") r.ev.push({ t: "guide", k: "rush" });
    } else if (ev.k === "ring") {
      for (let i = 0; i < ev.n; i++) {
        const a = (i / ev.n) * Math.PI * 2;
        spawnEnemy(r, ev.kind, r.p.x + Math.cos(a) * 230, r.p.y + Math.sin(a) * 150);
      }
      r.ev.push({ t: "warn", text: `${ENEMIES[ev.kind].name} 떼가 에워싸요!` });
    } else if (ev.k === "boss") {
      if (ev.arena) {
        // 철창: 주변 잡몹 정리 (보상 없이 사라짐)
        for (const e of r.enemies) if (!e.def.boss) e.alive = false;
        if (r.toll.on > 0) {
          r.toll.on = 0;
          r.ev.push({ t: "toll", on: false });
        }
        r.arena = { x: r.p.x, y: r.p.y, hw: 230, hh: 128 };
      }
      const [x, y] = ev.arena ? [r.p.x + 150, r.p.y - 40] : ringPos(r, 260);
      const b = spawnEnemy(r, ev.kind, x, y);
      r.bossId = b.id;
      r.ev.push({ t: "boss", kind: ev.kind, arena: ev.arena });
    } else if (ev.k === "lamps") {
      for (let i = 0; i < ev.n; i++) {
        const t = spawnThing(r, "lamp", 140, 260);
        t.t = 0;
        t.cost = r.t + 45;
      }
      r.ev.push({ t: "thing", k: "lamp", text: "꺼진 가로등! 옆에 서 있으면 켜져요" });
      r.ev.push({ t: "guide", k: "lamp" });
    } else if (ev.k === "spout") {
      const t = spawnThing(r, "spout", 110, 190);
      t.t = SPOUT_FUSE;
      r.ev.push({ t: "thing", k: "spout", text: "분수가 곧 솟아요! 적을 끌고 와요" });
      r.ev.push({ t: "guide", k: "spout" });
    } else if (ev.k === "goblin") {
      const a = rnd(r.rng) * Math.PI * 2;
      const g = spawnEnemy(r, "goblin", r.p.x + Math.cos(a) * 130, r.p.y + Math.sin(a) * 80);
      g.left = 15;
      g.drop = 0.85;
      r.ev.push({ t: "warn", text: "보물 도깨비! 도망치기 전에 잡아요" });
      r.ev.push({ t: "guide", k: "goblin" });
    } else if (ev.k === "guard") {
      // 지킬 등불: 플레이어 옆에 · t = 체력 · cost = 끝나는 시각 · on = 지키는 중 (멀어져도 안 치움)
      const t: Thing = { id: r.nextId++, alive: true, k: "guard", x: r.p.x + 50, y: r.p.y, t: GUARD_HP, on: true, cost: ev.until };
      r.things.push(t);
      r.guard = t;
      r.ev.push({ t: "thing", k: "guard", text: `등불을 지켜요! ${Math.round(ev.until - r.t)}초 동안 꺼지지 않게` });
      r.ev.push({ t: "guide", k: "guard" });
    }
  }
  // 오버타임: 45초마다 정예
  if (r.ot && Math.floor(r.otT / 45) > Math.floor((r.otT - DT) / 45)) {
    const [x, y] = ringPos(r);
    const ks = st.otElites;
    spawnEnemy(r, ks[rndInt(r.rng, ks.length)], x, y, true);
    r.ev.push({ t: "warn", text: "오버타임 정예!" });
  }
  // 밀물 · 안개 (안개 항구): 보스전 중엔 쉼
  const ch = r.ch;
  if (ch?.tide) {
    if (r.tide.on > 0) {
      r.tide.on -= DT;
      if (r.tide.on <= 0 || r.arena) {
        r.tide.on = 0;
        r.ev.push({ t: "warn", text: "물이 빠졌어요" });
      }
    } else if (r.t >= r.tide.next) {
      r.tide.next += ch.tide.every;
      if (r.bossId < 0 && !r.arena) {
        r.tide.on = ch.tide.dur;
        r.tide.y = r.p.y + (rnd(r.rng) < 0.5 ? -1 : 1) * (60 + rnd(r.rng) * 50);
        r.ev.push({ t: "tide", y: r.tide.y });
        r.ev.push({ t: "guide", k: "tide" });
      }
    }
  }
  if (ch?.fog) {
    if (r.fog.on > 0) {
      r.fog.on -= DT;
      if (r.fog.on <= 0 || r.arena) {
        r.fog.on = 0;
        r.ev.push({ t: "fog", on: false });
      }
    } else if (r.t >= r.fog.next) {
      r.fog.next += ch.fog.every;
      if (r.bossId < 0 && !r.arena) {
        r.fog.on = ch.fog.dur;
        r.ev.push({ t: "fog", on: true });
        r.ev.push({ t: "guide", k: "fog" });
      }
    }
  }
  if (r.beacon && ch?.beacon) {
    const bc = r.beacon;
    bc.ang += ch.beacon.speed * DT;
    if (r.tick === 180) r.ev.push({ t: "guide", k: "beacon" });
    // 빛 안: 체력이 참 (초당 2%) · 0.5초마다 빛에 닿은 적이 탐
    const lit = inBeacon(r, r.p.x, r.p.y);
    if (lit) r.p.hp = Math.min(maxHp(r), r.p.hp + maxHp(r) * 0.02 * DT);
    if (lit !== bc.lit) {
      bc.lit = lit;
      if (lit) r.ev.push({ t: "beamin" });
    }
    bc.tick -= DT;
    if (bc.tick <= 0) {
      bc.tick = 0.5;
      for (const e of r.enemies)
        if (e.alive && inBeacon(r, e.x, e.y)) {
          hurt(r, e, (10 + r.t * 0.12) * (1 + r.stats.might), PROC, 0, BEACON.x, BEACON.y);
          if (!e.def.boss) e.slow = Math.max(e.slow, 0.6);
        }
    }
  }
  // 자정의 종 (시계탑 광장): 울리는 동안 적이 빨라지고 경험치 두 배 — 보스전 중엔 쉼
  if (st.toll) {
    if (r.toll.on > 0) {
      r.toll.on -= DT;
      if (r.toll.on <= 0) {
        r.q.tolls++;
        r.ev.push({ t: "toll", on: false });
      }
    } else if (r.t >= r.toll.next) {
      r.toll.next += st.toll.every;
      if (r.bossId < 0 && !r.arena) {
        r.toll.on = st.toll.dur;
        r.ev.push({ t: "toll", on: true });
        if (r.ch) r.ev.push({ t: "guide", k: "toll" });
      }
    }
  }
  // 잡몹 유지
  const finale = r.arena !== null;
  if (!finale) {
    const w = waveAt(r, r.t);
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
    // 폭우 우산: 화면 근처 적에게 빗방울
    if (ws.id === "downpour") {
      ws.t -= DT;
      if (ws.t <= 0) {
        ws.t = w.cd;
        const cand = r.enemies.filter((e) => e.alive && Math.abs(e.x - p.x) < 170 && Math.abs(e.y - p.y) < 110);
        for (let i = 0; i < 2 && cand.length; i++) {
          const e = cand[rndInt(r.rng, cand.length)];
          r.ev.push({ t: "boom", x: e.x, y: e.y, r: 22, c: "#7ad7ff", w: "downpour" });
          aoe(r, e.x, e.y, 22, w.dmg * 0.9, slot, 10);
        }
      }
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
    case "thrust":
      ws.burst = w.n - 1;
      ws.burstT = def.pattern === "spin" ? 0.26 : def.pattern === "cone" ? 0.18 : def.pattern === "thrust" ? 0.12 : 0.07;
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
      aoe(r, p.x, p.y, w.size, w.dmg, slot, w.kb);
      // 가시 돋음: 화면에 가시가 솟는 연출
      if (ws.id === "thorns") r.ev.push({ t: "thorns", x: p.x, y: p.y - 4, r: w.size });
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
        r.zones.push(zone({ k: ws.id === "grenade" || ws.id === "cluster" ? "grenade" : "drop", slot, x, y, r: w.size, dmg: w.dmg, delay: w.dur + i * 0.08, life: 0.3, t: 0, tick: 0, kb: w.kb, follow: false, dx: p.x, dy: p.y }));
      }
      if ((ws.id === "grenade" || ws.id === "cluster") && w.n) r.ev.push({ t: "fire", w: ws.id });
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
        r.ev.push({ t: "bolt", x: e.x, y: e.y, r: w.size, j: ws.id === "judgment" });
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
    const lantern = ws.id === "lantern";
    const lit: Enemy[] = [];
    near(r, p.x, p.y - 6, w.size, (e) => {
      const dx = e.x - p.x;
      const dy = e.y - p.y + 6;
      const d = Math.hypot(dx, dy) || 1;
      if ((dx * p.fx + dy * p.fy) / d < 0.62 && d > e.r + 6) return;
      if (lantern && lit.length < 2 && d > w.size * 0.35) lit.push(e);
      hurt(r, e, w.dmg, slot, w.kb, p.x, p.y);
    });
    // 랜턴: 맞은 자리 (없으면 빛 끝) 에 불씨 — 1.2초 동안 0.3초마다 피해 30%
    if (lantern) {
      const spots = lit.length ? lit.map((e) => [e.x, e.y]) : [[p.x + p.fx * w.size * 0.7, p.y + p.fy * w.size * 0.7]];
      for (const [x, y] of spots) r.zones.push(zone({ k: "ember", slot, x, y, r: 14 * (1 + r.stats.area) * (ws.awake ? 1.3 : 1), dmg: w.dmg * 0.3, delay: 0, life: 1.2 * (1 + r.stats.duration), t: 0, tick: 0.15, kb: 0, follow: false }));
    }
    hitProps(r, p.x + p.fx * w.size * 0.6, p.y + p.fy * w.size * 0.6, w.size * 0.5);
    r.ev.push({ t: "fire", w: ws.id });
    return;
  }
  if (pat === "thrust") {
    // 서리 세검: 바라보는 쪽으로 찌르기 (두 번째부터 ±18° 부채꼴) — 찌른 끝에서 얼음이 터짐, 맞은 적은 느려짐
    const k = w.n - 1 - left;
    const off = k === 0 ? 0 : k % 2 ? 0.32 : -0.32;
    const ca = Math.cos(off);
    const sa = Math.sin(off);
    const dx = p.fx * ca - p.fy * sa;
    const dy = p.fx * sa + p.fy * ca;
    const ox = p.x;
    const oy = p.y - 6;
    const len = w.size;
    r.zones.push(zone({ k: "thrust", slot, x: ox, y: oy, r: len, dmg: 0, delay: 0, life: w.dur, t: 0, tick: 0, kb: 0, follow: true, dx, dy }));
    near(r, ox, oy, len, (e) => {
      const ex = e.x - ox;
      const ey = e.y - oy;
      if (ex * dx + ey * dy < -e.r) return;
      if (Math.abs(ex * dy - ey * dx) > 7 + e.r) return;
      hurt(r, e, w.dmg, slot, w.kb, ox, oy);
      if (e.alive && !e.def.boss) e.slow = Math.max(e.slow, 1);
    });
    const tx = ox + dx * len;
    const ty = oy + dy * len;
    const br = 18 * (1 + r.stats.area) * (ws.awake ? 1.3 : 1);
    near(r, tx, ty, br, (e) => {
      hurt(r, e, w.dmg * 0.5, slot, 10, tx, ty);
      if (e.alive && !e.def.boss) e.slow = Math.max(e.slow, 1.5);
    });
    hitProps(r, tx, ty, br);
    r.ev.push({ t: "boom", x: tx, y: ty, r: br, c: "#bfeeff", w: "frost" });
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

/** 투사체 크기 상한: 범위(area)로 커져도 기본 크기의 1.5배 · 16px 까지 (화면을 덮지 않게) */
function shotR(r: Run, slot: number, id: WeaponId, size: number) {
  const ws = slot >= 0 ? r.weapons[slot] : undefined;
  const lvs = WEAPONS[id].lv;
  const base = ws ? lvs[Math.min(lvs.length - 1, ws.lv - 1)].size : size;
  return Math.min(size, Math.max(base, Math.min(base * 1.5, 16)));
}

function mkShot(r: Run, slot: number, id: WeaponId, x: number, y: number, vx: number, vy: number, w: W, boom: number): Shot {
  return { alive: true, w: id, slot, x, y, vx, vy, r: shotR(r, slot, id, w.size), dmg: w.dmg, pierce: w.pierce, life: w.dur, t: 0, kb: w.kb, boom, target: -1, back: false, hits: [] };
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
      const vx0 = s.vx;
      const vy0 = s.vy;
      if (s.x < p.x - hw) (s.x = p.x - hw), (s.vx = Math.abs(s.vx));
      if (s.x > p.x + hw) (s.x = p.x + hw), (s.vx = -Math.abs(s.vx));
      if (s.y < p.y - hh) (s.y = p.y - hh), (s.vy = Math.abs(s.vy));
      if (s.y > p.y + hh) (s.y = p.y + hh), (s.vy = -Math.abs(s.vy));
      if (s.vx !== vx0 || s.vy !== vy0) s.sq = 0.12;
      if (s.sq) s.sq = Math.max(0, s.sq - DT);
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
      if (def.pattern === "bounce") {
        // 튕기는 공: 맞은 적에서 튕겨 나감 (붕 뜨지 않고 퉁퉁 부딪히는 맛)
        const nx = s.x - e.x;
        const ny = s.y - e.y;
        const nd = Math.hypot(nx, ny) || 1;
        const dot = (s.vx * nx + s.vy * ny) / nd;
        if (dot < 0) {
          s.vx -= (2 * dot * nx) / nd;
          s.vy -= (2 * dot * ny) / nd;
        }
        s.sq = 0.12;
      }
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

/** 등대: 켜지는 시간 · 끝에 모였다 터지는 시간 */
export const BEAM_ON = 0.4;
export const BEAM_END = 0.6;
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
        r.ev.push({ t: "slam", x: z.x, y: z.y });
        if (Math.hypot(p.x - z.x, (p.y - z.y) * 1.3) < z.r + 4) damagePlayer(r, z.dmg);
      } else if (z.delay <= 0) {
        const zw = z.slot >= 0 ? r.weapons[z.slot]?.id : undefined;
        r.ev.push({ t: "boom", x: z.x, y: z.y, r: z.r, c: z.k === "moon" ? "#fff2a8" : z.k === "grenade" || z.k === "shell" ? "#ffb03a" : "#ffe17a", ...(zw && { w: zw }) });
        aoe(r, z.x, z.y, z.r, z.dmg, z.slot, z.kb);
        // 집속 수류탄: 둘레에 작은 폭탄 셋 (작은 폭탄은 tick = -1 — 또 쪼개지지 않게)
        if (z.k === "grenade" && zw === "cluster" && z.tick !== -1)
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + rnd(r.rng);
            r.zones.push(zone({ k: "grenade", slot: z.slot, x: z.x + Math.cos(a) * z.r * 0.9, y: z.y + Math.sin(a) * z.r * 0.7, r: z.r * 0.6, dmg: z.dmg * 0.45, delay: 0.16 + i * 0.07, life: 0.3, t: 0, tick: -1, kb: z.kb * 0.5, follow: false }));
          }
        // 수류탄 ★3: 터진 자리에 2초 불장판
        if (z.k === "grenade" && zw === "grenade" && (r.wstar.grenade ?? 1) >= 3)
          r.zones.push(zone({ k: "ember", slot: z.slot, x: z.x, y: z.y, r: z.r * 0.7, dmg: z.dmg * 0.15, delay: 0, life: 2, t: 0, tick: 0, kb: 0, follow: false }));
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
    if (z.k === "ember") {
      // 불씨: 그 자리 적에게 계속
      z.tick -= DT;
      if (z.tick <= 0) {
        z.tick = 0.3;
        near(r, z.x, z.y, z.r, (e) => hurt(r, e, z.dmg, z.slot, 0, z.x, z.y));
      }
    }
    if (z.k === "beam") {
      // 등대: 켜짐 0.4초 → 빛줄기 두 갈래가 돌며 지나가는 적을 태움 (dx = 지금 각도) → 끝 0.6초 모였다가 섬광
      const end = z.life - BEAM_END;
      if (z.t >= z.life - 0.12 && !z.hits.length) {
        z.hits.push(1);
        r.ev.push({ t: "lhflash", x: z.x, y: z.y - 30 });
        for (const e of r.enemies) if (e.alive && onScreen(r, e, 10)) hurt(r, e, z.dmg * 5, -1, 60, z.x, z.y);
      }
      if (z.t < BEAM_ON || z.t > end) {
        if (z.t >= z.life) z.alive = false;
        continue;
      }
      z.dx += 2.3 * DT;
      z.tick -= DT;
      if (z.tick <= 0) {
        z.tick = 0.1;
        near(r, z.x, z.y - 6, z.r, (e) => {
          const a = Math.atan2(e.y - z.y + 6, e.x - z.x);
          const off = Math.abs((((a - z.dx) % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2);
          if (off > 0.32 && Math.hypot(e.x - z.x, e.y - z.y) > 22) return;
          hurt(r, e, z.dmg, -1, 18, z.x, z.y);
        });
      }
    }
    if (z.k === "snow") {
      // 눈보라: 0.3초마다 화면 속 적 느려짐 + 피해 → 끝에 얼음이 깨지며 큰 피해 (보스도)
      if (z.t >= z.life - 0.05 && !z.hits.length) {
        z.hits.push(1);
        r.ev.push({ t: "frostflash", x: z.x, y: z.y });
        for (const e of r.enemies) if (e.alive && onScreen(r, e, 10)) hurt(r, e, z.dmg * 12, -1, 50, z.x, z.y);
      }
      z.tick -= DT;
      if (z.tick <= 0) {
        z.tick = 0.3;
        for (const e of r.enemies) {
          if (!e.alive || !onScreen(r, e, 20)) continue;
          e.slow = Math.max(e.slow, 1.2);
          if (!e.def.boss) e.vuln = Math.max(e.vuln, 1.2);
          hurt(r, e, z.dmg, -1, 0, e.x, e.y);
        }
      }
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
    let sp = e.speed * (e.slow > 0 ? 0.45 : 1) * (r.toll.on > 0 && !e.def.boss ? 1.25 : 1) * (!e.def.boss && inTide(r, e.y) ? 0.5 : 1);
    // 등불을 노리는 적: 등불 쪽으로 · 닿으면 멈춰서 갉아먹음
    const gd = r.guard;
    if (e.tgt && gd?.alive) {
      const gx = gd.x - e.x;
      const gy = gd.y - e.y;
      const gl = Math.hypot(gx, gy) || 1;
      if (gl < 260 || d > gl) {
        dx = gx / gl;
        dy = gy / gl;
        if (gl < e.r + 9) {
          gd.t -= e.dmg * 0.4 * DT;
          sp = 0;
        }
      }
    }
    if (e.def.move === "flee") {
      // 보물 도깨비: 반대로 달아남 · 멀어지면 느긋하게 갈지자 · 시간이 다 되면 사라짐
      e.left = (e.left ?? 0) - DT;
      if (e.left <= 0) {
        e.alive = false;
        r.ev.push({ t: "boom", x: e.x, y: e.y, r: 18, c: "#ffd23a" });
        r.ev.push({ t: "warn", text: "보물 도깨비가 도망쳤어요…" });
        continue;
      }
      const w = Math.sin(e.t * 3 + e.id) * 0.9;
      const fx = -dx + dy * w;
      const fy = -dy - dx * w;
      const fl = Math.hypot(fx, fy) || 1;
      dx = fx / fl;
      dy = fy / fl;
      if (d > 170) sp *= 0.35;
      e.x += dx * sp * DT + e.kx * DT;
      e.y += dy * sp * DT + e.ky * DT;
      e.kx *= 0.86;
      e.ky *= 0.86;
      if (Math.abs(dx) > 0.05) e.face = dx > 0 ? 1 : -1;
      continue;
    }
    if (e.boss) {
      bossAI(r, e, dx, dy);
    } else {
      if (e.def.move === "dart") {
        // 태엽 쥐: 방향을 잡으면 1초 동안 곧장 (옆으로 비키면 지나감)
        if (e.mx === 0 && e.my === 0) {
          e.mx = dx;
          e.my = dy;
        }
        if (Math.floor(e.t) !== Math.floor(e.t - DT)) {
          e.mx = dx;
          e.my = dy;
        }
        dx = e.mx;
        dy = e.my;
      } else if (e.def.move === "dive" && (e.t + e.id * 0.37) % 2.6 < 0.5) {
        // 뻐꾸기: 가끔 확 급강하 (플레이어 걸음보다 조금 느리게 — 피할 수 있게)
        sp *= 1.8;
      }
      if (e.def.move === "side") {
        // 집게 게: 옆걸음 — 다가오면서 좌우로 크게 비킴
        const w = Math.sin(e.t * 1.6 + e.id) > 0 ? 1 : -1;
        const ox = -dy * w * 0.9;
        const oy = dx * w * 0.9;
        dx = dx * 0.6 + ox;
        dy = dy * 0.6 + oy;
      }
      if (e.def.move === "wobble") {
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
    if (!e.def.boss && !e.tgt && d > 420) {
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
  const st = r.def;
  const final = e.kind === st.final;
  const plan = st.boss[e.kind] ?? { order: ["warn", "ring", "summon"] as BossPhase[], minion: st.opening[0] };
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
        const order = plan.order;
        b.phase = order[b.step++ % order.length];
        b.t = b.phase === "warn" ? 0.9 : 0.2;
        if (b.phase === "warn") {
          b.dx = dx;
          b.dy = dy;
        } else if (b.phase === "spiral") {
          b.spin = (b.enraged ? 3.4 : 2.6) * (b.rage ? 1.2 : 1);
          b.t = 0;
        } else if (b.phase === "blink") {
          // 순간이동: 도착할 자리에 원이 먼저 (0.85초 뒤 내려앉으며 쾅)
          const a = rnd(r.rng) * Math.PI * 2;
          b.dx = r.p.x + Math.cos(a) * 70;
          b.dy = r.p.y + Math.sin(a) * 50;
          if (r.arena) {
            b.dx = Math.max(r.arena.x - r.arena.hw + e.r, Math.min(r.arena.x + r.arena.hw - e.r, b.dx));
            b.dy = Math.max(r.arena.y - r.arena.hh + e.r, Math.min(r.arena.y + r.arena.hh - e.r, b.dy));
          }
          r.zones.push(zone({ k: "slam", slot: -1, x: b.dx, y: b.dy, r: 46, dmg: e.dmg * 1.3, delay: 0.85, life: 0.25, t: 0, tick: 0, kb: 0, follow: false }));
          b.t = 0.85;
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
    case "fan": {
      // 깃털 부채: 플레이어 쪽으로 부채꼴 (분노하면 두 겹)
      const base = Math.atan2(r.p.y - 6 - e.y, r.p.x - e.x);
      const n = b.enraged ? 9 : 7;
      for (let k = 0; k < (b.enraged ? 2 : 1); k++)
        for (let i = 0; i < n; i++) {
          const a = base + (i / (n - 1) - 0.5) * 1.4;
          const v = 100 - k * 28;
          r.bullets.push({ alive: true, x: e.x, y: e.y - 8, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 4, dmg: e.dmg * 0.55, life: 5 });
        }
      b.phase = "chase";
      b.t = 1.9 * fast;
      break;
    }
    case "spiral": {
      // 시곗바늘 회오리: 제자리에서 바늘 팔 2~4개로 탄을 흩뿌림
      b.spin -= DT;
      if (b.t <= 0) {
        b.t = 0.11;
        const arms = 2 + (b.enraged ? 1 : 0) + (b.rage ? 1 : 0);
        b.ang += 0.3;
        for (let i = 0; i < arms; i++) {
          const a = b.ang + (i / arms) * Math.PI * 2;
          r.bullets.push({ alive: true, x: e.x, y: e.y - 10, vx: Math.cos(a) * 82, vy: Math.sin(a) * 82, r: 4, dmg: e.dmg * 0.5, life: 5 });
        }
      }
      if (b.spin <= 0) {
        b.phase = "chase";
        b.t = 1.6 * fast;
      }
      break;
    }
    case "chime": {
      // 열두 번 종: 플레이어 둘레 시계 눈금 12곳이 1시부터 차례로 터지고 마지막에 가운데
      const p = r.p;
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + ((i + 1) / 12) * Math.PI * 2;
        r.zones.push(zone({ k: "slam", slot: -1, x: p.x + Math.cos(a) * 84, y: p.y + Math.sin(a) * 60, r: 26, dmg: e.dmg, delay: 0.75 + i * 0.09, life: 0.2, t: 0, tick: 0, kb: 0, follow: false }));
      }
      r.zones.push(zone({ k: "slam", slot: -1, x: p.x, y: p.y, r: 34, dmg: e.dmg * 1.3, delay: 0.75 + 12 * 0.09 + 0.25, life: 0.25, t: 0, tick: 0, kb: 0, follow: false }));
      b.phase = "chase";
      b.t = 2.4 * fast;
      break;
    }
    case "blink":
      if (b.t <= 0) {
        e.x = b.dx;
        e.y = b.dy;
        r.ev.push({ t: "boom", x: e.x, y: e.y, r: 46, c: r.def.color });
        b.phase = "chase";
        b.t = 1.8 * fast;
      }
      break;
    case "summon": {
      const kind: EnemyKind = plan.minion;
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
export const bossLimit = (k: EnemyKind) => (Object.values(STAGES).some((s) => s.final === k) ? 120 : 80);

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
    // 챕터: 성소만 (금화 상자 · 깃발 · 저주 동상 · 종 없음)
    if (r.ch && pl.k !== "shrine") continue;
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
      case "lamp": {
        // 꺼진 가로등: 옆에 서 있으면 켜짐 → 주변 적 불타고 치킨 · 켜진 채 15초 (cost = 사라지는 시각)
        if (!t.on) {
          if (d < 30) t.t += DT;
          else t.t = Math.max(0, t.t - DT * 0.5);
          if (t.t >= LAMP_CHARGE) {
            t.on = true;
            t.cost = r.t + 15;
            r.q.shrines++;
            r.ev.push({ t: "boom", x: t.x, y: t.y - 14, r: LAMP_R, c: "#ffb03a" });
            r.ev.push({ t: "thing", k: "lamp", text: "가로등 켜짐!" });
            near(r, t.x, t.y, LAMP_R, (e) => {
              hurt(r, e, (30 + r.t * 0.35) * (1 + r.stats.might), PROC, 40, t.x, t.y);
              e.slow = Math.max(e.slow, 2);
            });
            dropPickup(r, "meat", t.x + 10, t.y + 6, 1);
          } else if (r.t > t.cost) t.alive = false;
        } else {
          // 켜진 동안 가까이 온 적을 조금씩 태움
          if (Math.floor(r.t) > Math.floor(r.t - DT)) near(r, t.x, t.y, LAMP_R * 0.6, (e) => hurt(r, e, (8 + r.t * 0.08) * (1 + r.stats.might), PROC, 0, t.x, t.y));
          if (r.t > t.cost) t.alive = false;
        }
        break;
      }
      case "guard": {
        // 지킬 등불: 1초마다 주변 적을 조금 태움 · 체력이 다 닳으면 꺼짐 · 끝 시각까지 버티면 보상
        if (Math.floor(r.t) > Math.floor(r.t - DT)) near(r, t.x, t.y, GUARD_R, (e) => hurt(r, e, (6 + r.t * 0.06) * (1 + r.stats.might), PROC, 20, t.x, t.y));
        const qs = r.quest;
        if (t.t <= 0) {
          t.alive = false;
          if (qs) qs.fail = true;
          r.ev.push({ t: "boom", x: t.x, y: t.y - 14, r: 40, c: "#6b63a3" });
          r.ev.push({ t: "warn", text: "등불이 꺼졌어요…" });
        } else if (r.t >= t.cost) {
          t.alive = false;
          if (qs?.q.k === "guard") questGot(r);
          r.ev.push({ t: "boom", x: t.x, y: t.y - 14, r: LAMP_R * 1.3, c: "#ffd23a" });
          r.ev.push({ t: "thing", k: "guard", text: "등불을 지켜냈어요!" });
          near(r, t.x, t.y, LAMP_R * 1.3, (e) => hurt(r, e, (40 + r.t * 0.4) * (1 + r.stats.might), PROC, 60, t.x, t.y));
          dropPickup(r, "chest", t.x, t.y + 8, 0);
          dropPickup(r, "meat", t.x + 14, t.y + 6, 1);
        }
        break;
      }
      case "spout": {
        // 분수: 시간이 되면 물보라 — 원 안 적 기절 · 피해, 플레이어가 원 안이면 젬이 다 몰려옴
        if (!t.on) {
          t.t -= DT;
          if (t.t <= 0) {
            t.on = true;
            t.t = 1.2;
            r.ev.push({ t: "boom", x: t.x, y: t.y - 10, r: SPOUT_R, c: "#7ad7ff" });
            near(r, t.x, t.y, SPOUT_R, (e) => {
              hurt(r, e, (24 + r.t * 0.3) * (1 + r.stats.might), PROC, 30, t.x, t.y);
              if (!e.def.boss) e.stun = Math.max(e.stun, 2.5);
            });
            const inside = Math.hypot(dx, dy * 1.25) < SPOUT_R;
            if (inside) for (const g of r.gems) g.pull = true;
            r.ev.push({ t: "thing", k: "spout", text: inside ? "물보라! 젬이 몰려와요" : "물보라!" });
          }
        } else {
          t.t -= DT;
          if (t.t <= 0) t.alive = false;
        }
        break;
      }
      case "trial":
        if (!t.on) {
          if (d < TRIAL_R * 0.45) {
            t.on = true;
            t.t = TRIAL_SEC;
            r.ev.push({ t: "trialgo" });
          }
          break;
        }
        t.t -= DT;
        // 시련: 원 둘레에서 몹이 쏟아짐
        if (r.tick % 6 === 0) {
          const a = rnd(r.rng) * Math.PI * 2;
          const w = waveAt(r, r.t);
          spawnEnemy(r, pickKind(r, w.mix), t.x + Math.cos(a) * (TRIAL_R + 60), t.y + Math.sin(a) * (TRIAL_R + 60) * 0.8);
        }
        if (d > TRIAL_R) {
          t.alive = false;
          r.ev.push({ t: "trial", ok: false });
        } else if (t.t <= 0) {
          t.alive = false;
          r.q.trials++;
          dropGem(r, t.x, t.y - 10, Math.round(needXp(r) * 1.2));
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
function doUlt(r: Run, who: HeroId, m: number) {
  const p = r.p;
  const s = r.stats;
  // 키트를 빌린 캐릭터는 원래 캐릭터 필살기
  const hero = HEROES[who].kit;
  if (m < 1 && (hero === "kai" || hero === "zena")) {
    // 동료의 돌진은 플레이어를 끌고 가지 않게 주변 충격파로
    r.ev.push({ t: hero === "zena" ? "bolt" : "boom", x: p.x, y: p.y, r: 90, c: HEROES[who].color });
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
    case "bandi":
      r.zones.push(zone({ k: "beam", slot: -1, x: p.x, y: p.y, r: 180 * (1 + s.area), dmg: 30 * (1 + s.might) * m, delay: 0, life: BEAM_ON + 5 * Math.max(0.5, m) * (1 + s.duration) + BEAM_END, t: 0, tick: 0, kb: 0, follow: true, dx: Math.atan2(p.fy, p.fx), dy: 0 }));
      break;
    case "seolhee":
      r.zones.push(zone({ k: "snow", slot: -1, x: p.x, y: p.y, r: 999, dmg: 7 * (1 + s.might) * m, delay: 0, life: 5 * Math.max(0.5, m) * (1 + s.duration), t: 0, tick: 0.2, kb: 0, follow: true }));
      p.inv = Math.max(p.inv, 1);
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
  for (const f of r.ch ? [...EVOLUTIONS, ...PATROL_EVOLUTIONS] : EVOLUTIONS) {
    const [base, need] = WEAPONS[f].evo!;
    if (maxed(base) && r.passives.some((x) => x.id === need)) out.push({ k: "evo", id: f, from: 0, to: 1, rarity: 2 });
  }
  for (const w of r.weapons) {
    if (WEAPONS[w.id].owner !== HEROES[r.hero].kit || w.awake || !maxed(w.id)) continue;
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
    // 판 무기 풀 (서바이버 = 해금한 공용 무기 · 순찰대 = 무기 덱)
    for (const id of r.pool.weapons) {
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
  if (r.army && !box) {
    // 럭키 출격: 상자 = 확률 좋은 소환 1 · 3 · 5 (멈추지 않음)
    const x = rnd(r.rng);
    const n = big || r.chests === 1 ? 3 : x < 0.06 + r.stats.luck * 0.01 ? 5 : x < 0.3 ? 3 : 1;
    for (let i = 0; i < n; i++) armyRoll(r, big ? 2 : 1, "chest");
    const coins = 10 + rndInt(r.rng, 21) + (big ? 40 : 0);
    r.p.gold += coins;
    r.q.gold += coins;
    r.ev.push({ t: "chest" });
    return;
  }
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
    const card: Card = sp ?? (r.ch ? chestUp(r) : { k: "relic", id: rollRelic(r, big ? 1 : 0), from: 0, to: 1, rarity: 0 });
    applyCard(r, card);
    items.push(card);
  }
  const coins = box ? 0 : 10 + rndInt(r.rng, 21) + (big ? 40 : 0);
  r.p.gold += coins;
  r.q.gold += coins;
  r.pause = { k: "chest", items, coins, first, big };
  r.ev.push({ t: "chest" });
}

/** 챕터 상자 한 칸: 가진 무기 · 패시브 +1 (탕탕처럼) — 올릴 게 없으면 회복 */
function chestUp(r: Run): Card {
  const cand = candidates(r).filter((c) => !special(c) && (c.from > 0 || c.k === "passive" || r.weapons.length < 3));
  const own = cand.filter((c) => c.from > 0);
  const pool = own.length && rnd(r.rng) < 0.8 ? own : cand;
  if (!pool.length) return { k: "heal", from: 0, to: 0, rarity: 0 };
  const c = pool[rndInt(r.rng, pool.length)];
  return { ...c, to: c.from + 1, rarity: 0 };
}

export function closeChest(r: Run) {
  if (r.pause?.k !== "chest") return;
  r.pause = null;
  if (r.pending > 0) openLevel(r);
}

/* ───────────── 럭키 출격 (부대) ───────────── */

/** 부대 유닛이 낸 피해 (무기 칸이 아님) */
const ARMY_SLOT = -3;

function armyAdd(r: Run, id: string, src: Extract<Ev, { t: "summon" }>["src"]) {
  const a = r.army!;
  const def = UNIT[id];
  if (a.units.length >= ARMY_CAP) {
    const g = fullRefund(def.grade as UnitGrade);
    r.p.gold += g;
    r.ev.push({ t: "summon", id, grade: def.grade, src, full: g });
    return;
  }
  const p = r.p;
  a.units.push({ uid: a.uid++, id, x: p.x, y: p.y - 4, cd: 0.4, ult: (def.ult?.every ?? 0) * 0.5, anim: 0, face: 1, dmgDone: 0, born: r.t });
  a.best = Math.max(a.best, def.grade);
  r.ev.push({ t: "summon", id, grade: def.grade, src });
}

/** 무작위 소환 (boost = 확률 단계 +) */
function armyRoll(r: Run, boost: number, src: Extract<Ev, { t: "summon" }>["src"]) {
  const g = rollGrade(rnd(r.rng), luckTier(r.stats.luck, boost));
  armyAdd(r, rollUnit(rnd(r.rng), rnd(r.rng), g).id, src);
}

/** 금화 소환 */
export function armyBuy(r: Run): boolean {
  const a = r.army;
  if (!a || r.pause || r.over) return false;
  const cost = buyCost(a.bought);
  if (r.p.gold < cost) {
    r.ev.push({ t: "nogold", need: cost });
    return false;
  }
  r.p.gold -= cost;
  a.bought++;
  armyRoll(r, 0, "buy");
  return true;
}

/** 같은 세력 · 같은 등급 셋 → 그 세력 다음 등급 무작위 (key 없으면 가장 높은 등급부터) */
export function armyMerge(r: Run, key?: string): boolean {
  const a = r.army;
  if (!a || r.pause || r.over) return false;
  const ids = a.units.map((u) => u.id);
  const ok = mergeable(ids);
  const pick = key ?? ok[0];
  if (!pick || !ok.includes(pick)) return false;
  // 가장 약한(늦게 들어온) 셋을 씀 — 조합식 재료로 쓰일 레전드 이상은 안 건드림
  let left = 3;
  for (let i = a.units.length - 1; i >= 0 && left > 0; i--)
    if (mergeKey(a.units[i].id) === pick) {
      a.units.splice(i, 1);
      left--;
    }
  const [f, g] = pick.split(":");
  const up = rollUnit(0, rnd(r.rng), (Number(g) + 1) as UnitGrade, f as Faction);
  armyAdd(r, up.id, "merge");
  return true;
}

/** 신화 조합식 (id 없으면 되는 것 중 첫째) */
export function armyCraft(r: Run, id?: string): boolean {
  const a = r.army;
  if (!a || r.pause || r.over) return false;
  const ids = a.units.map((u) => u.id);
  const rc = craftable(ids).find((x) => !id || x.id === id);
  if (!rc) return false;
  const use = pickNeeds(ids, rc)!.sort((x, y) => y - x);
  for (const i of use) a.units.splice(i, 1);
  armyAdd(r, rc.id, "craft");
  return true;
}

function unitDmg(r: Run, id: string, e: Enemy): number {
  const d = UNIT[id];
  let v = d.dmg * ARMY_DMG * (1 + r.stats.might) * (1 + ARMY_PER_LV * (r.p.lv - 1));
  if (d.dtype === "phys") v *= SIZE_MULT[d.faction][sizeOf(e.r, !!e.def.boss)];
  if (e.def.boss && d.boss) v *= d.boss;
  return v;
}

function updateArmy(r: Run) {
  const a = r.army!;
  const p = r.p;
  const s = r.stats;
  const n = a.units.length;
  // 오라: 아군 공속 (합, 최대 +60%)
  let aspd = 0;
  for (const u of a.units) aspd += UNIT[u.id].aura?.aspd ?? 0;
  aspd = Math.min(0.6, aspd);
  const area = 1 + s.area;
  for (let i = 0; i < n; i++) {
    const u = a.units[i];
    const d = UNIT[u.id];
    // 대형: 해바라기 배치 (안쪽부터) · 주인공을 따라감
    const ang = i * 2.39996 + r.t * 0.15;
    const rad = 24 + 11 * Math.sqrt(i + 1);
    const tx = p.x + Math.cos(ang) * rad;
    const ty = p.y - 2 + Math.sin(ang) * rad * 0.62;
    const k = Math.min(1, DT * 7);
    u.x += (tx - u.x) * k;
    u.y += (ty - u.y) * k;
    u.anim = Math.max(0, u.anim - DT);
    // 둔화 오라
    if (d.aura?.slow && r.tick % 10 === i % 10)
      near(r, u.x, u.y, d.aura.r * TILE * area, (e) => {
        if (!e.def.boss) e.slow = Math.max(e.slow, 0.3);
      });
    const range = d.range >= 50 ? GLOBAL_RANGE : d.range * TILE * (d.range > 2.3 ? area : 1) + 6;
    // 필살
    if (d.ult) {
      u.ult -= DT;
      if (u.ult <= 0) {
        const t = nearest(r, u.x, u.y, Math.max(range, 120));
        if (t) {
          unitUlt(r, u, t);
          u.ult = d.ult.every * (1 - Math.min(0.4, s.cooldown));
        } else u.ult = 0.3;
      }
    }
    u.cd -= DT * (1 + aspd + s.cooldown);
    if (u.cd > 0) continue;
    const e = nearest(r, u.x, u.y, range);
    if (!e) {
      u.cd = 0.08;
      continue;
    }
    u.cd = 1 / d.aps;
    u.anim = 0.18;
    u.face = e.x >= u.x ? 1 : -1;
    unitAttack(r, u, e, range);
  }
}

function unitHit(r: Run, u: ArmyUnit, e: Enemy, v: number, kb: number) {
  const before = e.hp;
  hurt(r, e, v, ARMY_SLOT, kb, u.x, u.y);
  u.dmgDone += Math.max(0, Math.min(before, before - e.hp));
}

function unitAttack(r: Run, u: ArmyUnit, e: Enemy, range: number) {
  const d = UNIT[u.id];
  const c = ARMY_GRADE_COLOR[d.grade];
  const melee = range <= 2.3 * TILE + 6;
  let v = unitDmg(r, u.id, e);
  if (d.crit && rnd(r.rng) < d.crit.chance) v *= d.crit.mult;
  r.ev.push({ t: "ahit", x0: u.x, y0: u.y - 8, x1: e.x, y1: e.y - e.r * 0.5, c, melee });
  const area = 1 + r.stats.area;
  const tx = e.x;
  const ty = e.y;
  unitHit(r, u, e, v, melee ? 60 : 25);
  // 처형
  if (d.execute && e.alive && !e.def.boss && e.hp <= e.maxHp * d.execute) unitHit(r, u, e, e.hp + 1, 0);
  // 범위
  if (d.splash) {
    const rad = d.splash.r * TILE * area;
    r.ev.push({ t: "boom", x: tx, y: ty, r: rad, c });
    near(r, tx, ty, rad, (o) => {
      if (o !== e) unitHit(r, u, o, unitDmg(r, u.id, o) * d.splash!.pct, 20);
    });
  }
  // 연쇄
  if (d.chain) {
    const hit = new Set<number>([e.id]);
    let from = { x: tx, y: ty };
    let dv = v;
    for (let k = 0; k < d.chain.n; k++) {
      const nx = nearest(r, from.x, from.y, 70, hit);
      if (!nx) break;
      hit.add(nx.id);
      dv *= d.chain.pct;
      r.ev.push({ t: "zap", x0: from.x, y0: from.y - 6, x1: nx.x, y1: nx.y - 6 });
      unitHit(r, u, nx, dv, 0);
      from = { x: nx.x, y: nx.y };
    }
  }
  // 발동 효과
  if (d.procs)
    for (const pc of d.procs) {
      if (rnd(r.rng) >= pc.chance) continue;
      if (pc.kind === "stun" && e.alive && !e.def.boss) e.stun = Math.max(e.stun, pc.sec);
      else if (pc.kind === "slow" && e.alive) e.slow = Math.max(e.slow, pc.sec);
      else if (pc.kind === "cur" && e.alive && !e.def.boss) unitHit(r, u, e, e.hp * pc.pct, 0);
    }
  // 처치 금화
  if (!e.alive && d.onKill?.gold && rnd(r.rng) < (d.onKill.goldChance ?? 1)) {
    r.p.gold += d.onKill.gold;
    r.q.gold += d.onKill.gold;
  }
}

function unitUlt(r: Run, u: ArmyUnit, t: Enemy) {
  const d = UNIT[u.id];
  const ult = d.ult!;
  const c = ARMY_GRADE_COLOR[d.grade];
  const base = unitDmg(r, u.id, t);
  u.anim = 0.35;
  if (ult.kind === "nova") {
    const rad = Math.min(220, ult.r * TILE * (1 + r.stats.area));
    r.ev.push({ t: "ault", id: u.id, name: ult.name, x: t.x, y: t.y, r: rad, c });
    near(r, t.x, t.y, rad, (e) => {
      unitHit(r, u, e, unitDmg(r, u.id, e) * ult.mult, 80);
      if (e.alive && !e.def.boss && ult.stun) e.stun = Math.max(e.stun, ult.stun);
      if (e.alive && !e.def.boss && ult.cur) unitHit(r, u, e, e.hp * ult.cur, 0);
    });
  } else if (ult.kind === "barrage") {
    r.ev.push({ t: "ault", id: u.id, name: ult.name, x: u.x, y: u.y, r: 0, c });
    const list = r.enemies.filter((e) => e.alive && onScreen(r, e)).sort((x, y) => y.hp - x.hp);
    for (const e of list.slice(0, ult.n)) {
      r.ev.push({ t: "ahit", x0: u.x, y0: u.y - 10, x1: e.x, y1: e.y - e.r * 0.5, c, melee: false });
      r.ev.push({ t: "boom", x: e.x, y: e.y, r: 18, c });
      unitHit(r, u, e, base * ult.mult, 40);
    }
  } else {
    r.ev.push({ t: "ault", id: u.id, name: ult.name, x: t.x, y: t.y, r: 24, c });
    if (t.def.boss) unitHit(r, u, t, t.maxHp * ult.pct, 0);
    else unitHit(r, u, t, t.hp + 1, 0);
  }
}

/* ───────────── 결과 ───────────── */

export interface RunResult {
  hero: HeroId;
  stage: StageId;
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
  /** 럭키 출격 부대 (피해 순) */
  army?: { id: string; dmg: number }[];
  /** 픽셀 순찰대: 챕터 · 스테이지 번호 · 별 3개 (클리어 · 체력 50% 이상 · 보스 N초 안에) */
  ch?: { id: number; st: number; stars: [boolean, boolean, boolean]; hp: number; finalAge: number };
}

export function result(r: Run): RunResult {
  const q = { ...r.q, noHit: Math.max(r.q.noHit, Math.floor(r.t - r.hitAt)) };
  return {
    hero: r.hero,
    stage: r.stage,
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
    ...(r.army && { army: r.army.units.map((u) => ({ id: u.id, dmg: Math.round(u.dmgDone) })).sort((x, y) => y.dmg - x.dmg) }),
    ...(r.ch && { ch: chapterOut(r) }),
  };
}

function chapterOut(r: Run): NonNullable<RunResult["ch"]> {
  const hp = Math.max(0, r.p.hp) / maxHp(r);
  // 별 2: 특수 판은 목표 달성, 나머지는 체력 50% 이상
  const s2 = r.quest ? r.quest.done : hp >= 0.5;
  return { id: r.ch!.id, st: r.ch!.st ?? r.ch!.id * 5, stars: [r.win, r.win && s2, r.win && r.finalAge > 0 && r.finalAge <= (r.ch!.bossStar ?? 60)], hp: Math.round(hp * 100) / 100, finalAge: r.finalAge };
}

export const timeLeft = (r: Run) => Math.max(0, r.len - r.t);
