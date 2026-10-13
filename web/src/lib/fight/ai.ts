/**
 * 격투게임 AI — 매 프레임 상태를 보고 "사람처럼" 입력을 만들어 냄.
 * 반응 속도(몇 프레임 뒤에 알아채나), 가드·대공·콤보 확률로 단계를 나눔.
 * 오프라인 전용이라 결정론일 필요는 없지만, 같은 시드면 같은 행동을 하도록 자체 난수를 씀.
 */
import { CHARS, SUB, type CharDef, type MoveDef } from "./chars";
import { IN, VIEW_H, clone, isAir, mapOf, platBelow, step, type Fighter, type State } from "./sim";
import type { Plat } from "./maps";
import { ROUTES, type ComboRoute, type Starter } from "./combos";

/** 콤보 길로 넣는 피해 상한 (캐릭터마다 길 피해가 달라 너무 아픈 길이 승률을 흔들지 않게) */
const ROUTE_CAP = 260;

export interface AILevel {
  id: string;
  name: string;
  /** 상대 공격을 알아채는 데 걸리는 프레임 */
  react: number;
  /** 알아챈 공격을 막을 확률 */
  block: number;
  /** 맞혔을 때 다음 기술로 이어 갈 확률 */
  combo: number;
  /** 뛰어드는 상대를 강공격으로 떨어뜨릴 확률 */
  antiAir: number;
  /** 공격적인 정도 */
  aggro: number;
  /** 프레임당 필살기(탄) 쓸 확률 */
  special: number;
  /** 잡기 풀 확률 (없으면 block × 0.8) */
  tech?: number;
  /** 저스트 가드 노릴 확률 (없으면 combo × 0.6) */
  just?: number;
  /** 끼어들기: 상대 기술이 나오기 전에 더 빠른 약으로 먼저 때림 */
  interrupt?: number;
  /** 내다보기(프레임): 상대가 기술을 쓰거나 빈틈일 때, 할 수 있는 행동을 미리 돌려 보고 가장 나은 걸 고름 */
  look?: number;
  /** 내다보기를 쓸 확률 (없으면 1) — 달인과 지존 사이 레이팅은 이걸로 섞음 */
  lookP?: number;
  /** 시작기(잡기·아이덴티티·약·발차기)가 맞으면 그 캐릭터의 콤보 길(combos.ts)로 이어 칠 확률 */
  route?: number;
  /** 읽기: 이번 판에서 본 상대 버릇(일어날 때 · 막은 뒤 · 잡기 풀기 · 점프)으로 미리 대응할 정도 0~1 */
  read?: number;
  /** 노림수(읽기로 내 행동을 미리 돌려 보기)를 쓸 확률 — 가장 큰 실력 차이 */
  plan?: number;
  /** 내다볼 때 상대의 대응(가만히·가드·약·점프)을 이만큼 같이 돌려 보고 가장 나쁜 경우로 값을 매김 (1이면 지금 입력 그대로만) */
  robust?: number;
}

export const AI_LEVELS: AILevel[] = [
  {
    id: "1",
    name: "입문",
    react: 30,
    read: 0,
    block: 0.05,
    combo: 0,
    antiAir: 0.05,
    aggro: 0.25,
    special: 0.004,
  },
  {
    id: "2",
    name: "초급",
    react: 24,
    read: 0.1,
    block: 0.2,
    combo: 0.2,
    antiAir: 0.15,
    aggro: 0.35,
    special: 0.006,
  },
  {
    id: "3",
    name: "중급",
    react: 18,
    read: 0.3,
    block: 0.42,
    combo: 0.45,
    antiAir: 0.35,
    aggro: 0.45,
    special: 0.008,
  },
  {
    id: "4",
    name: "상급",
    react: 14,
    read: 0.5,
    plan: 0,
    block: 0.6,
    combo: 0.7,
    antiAir: 0.55,
    aggro: 0.55,
    special: 0.01,
  },
  {
    id: "5",
    name: "고수",
    react: 12,
    read: 0.65,
    plan: 0.008,
    block: 0.76,
    combo: 0.86,
    antiAir: 0.7,
    aggro: 0.6,
    special: 0.012,
  },
  {
    id: "6",
    name: "달인",
    react: 10,
    read: 0.8,
    plan: 0.05,
    block: 0.95,
    combo: 1,
    antiAir: 0.95,
    aggro: 0.72,
    special: 0.02,
    route: 0.6,
  },
  {
    id: "7",
    name: "지존",
    react: 9,
    read: 0.9,
    plan: 0.5,
    block: 1,
    combo: 1,
    antiAir: 1,
    aggro: 0.8,
    special: 0.025,
    // 잡기 풀기: 사람은 거의 찍기 — AI도 찍는 정도로 (10.12 0.42 → 0.32: 거의 다 풀던 것)
    tech: 0.32,
    just: 0.9,
    interrupt: 0.85,
    look: 28,
    route: 1,
  },
];

/**
 * 레이팅 기준선: AI 대전 단계가 랭크전 레이팅 어디에 놓이는지 (초급 200 · 지존 2000).
 * 랭크전 봇은 레이팅에 맞춰 이웃한 두 단계를 섞은 세부 난이도로 둠 (예: 1400 = 고수와 달인 중간).
 */
export const AI_RATING = [0, 200, 500, 850, 1200, 1600, 2000];

/** 지존 위 단계 — 랭크전 봇 전용 (AI 대전에서는 고를 수 없음) */
export const RANK_TIERS: (AILevel & { rating: number })[] = [
  { ...AI_LEVELS[6], id: "8", name: "전설", rating: 2200, tech: 0.34, read: 0.95, plan: 0.8, aggro: 0.84, just: 0.95, interrupt: 0.9, robust: 3 },
  { ...AI_LEVELS[6], id: "9", name: "신화", rating: 2400, tech: 0.36, read: 1, plan: 1, aggro: 0.87, just: 1, interrupt: 0.95, robust: 4, look: 32 },
  { ...AI_LEVELS[6], id: "10", name: "초월", rating: 2600, tech: 0.38, read: 1, plan: 1, react: 8, aggro: 0.9, just: 1, interrupt: 1, robust: 5, look: 32 },
];
/** 랭크전 봇 레이팅 상한 */
export const BOT_MAX = 2600;

/**
 * 캐릭터 보정 (레이팅): 같은 단계라도 AI가 다루기 쉬운 캐릭터가 따로 있음 (낮은 단계는 리치 긴 소영·제나, 지존은 빠른 건모).
 * 봇은 (레이팅 + 보정)의 실력으로 둠 → 어떤 캐릭터를 골라도 그 레이팅만큼만 셈. 같은 레이팅 AI끼리 붙여 승률 50% 근처로 맞춘 값.
 * ADJ_AT 레이팅마다 값, 사이는 섞음.
 */
export const ADJ_AT = [200, 500, 850, 1200, 1600, 2000, 2400];
export const CHAR_ADJ: Record<string, number[]> = {
  kai: [-3, -21, 88, 96, 22, 27, 358],
  igna: [-80, -109, 18, 100, -8, -26, -168],
  soyoung: [69, -36, -156, -183, -100, 155, 192],
  lily: [-14, 124, 222, 293, 44, -156, -440],
  zena: [-120, -259, -401, -309, 33, 184, 508],
  gunmo: [172, 414, 466, 364, 64, -46, -46],
  ivan: [-52, -156, -222, 14, 10, -124, -402],
};
function charAdj(r: number, id: string) {
  const t = CHAR_ADJ[id];
  if (!t) return 0;
  if (r <= ADJ_AT[0]) return t[0];
  for (let i = 0; i < ADJ_AT.length - 1; i++)
    if (r < ADJ_AT[i + 1]) return t[i] + ((t[i + 1] - t[i]) * (r - ADJ_AT[i])) / (ADJ_AT[i + 1] - ADJ_AT[i]);
  return t[t.length - 1];
}

const ANCHORS: { r: number; l: AILevel }[] = [
  ...AI_LEVELS.map((l, i) => ({ r: AI_RATING[i], l })),
  ...RANK_TIERS.map((l) => ({ r: l.rating, l })),
];
/** 빈 값은 next() 의 기본값으로 채워서 섞을 수 있게 */
const filled = (l: AILevel) => ({
  react: l.react,
  block: l.block,
  combo: l.combo,
  antiAir: l.antiAir,
  aggro: l.aggro,
  special: l.special,
  tech: l.tech ?? l.block * 0.4,
  just: l.just ?? l.combo * 0.6,
  interrupt: l.interrupt ?? 0,
  route: l.route ?? 0,
  robust: l.robust ?? 1,
  read: l.read ?? 0,
  plan: l.plan ?? 0,
});

/** 레이팅 r 의 AI 세부 난이도 (캐릭터를 주면 캐릭터 보정까지) */
export function aiForRating(r: number, charId?: string): AILevel {
  const e = Math.max(0, Math.min(BOT_MAX, r + (charId ? charAdj(r, charId) : 0)));
  let i = 0;
  while (i < ANCHORS.length - 2 && e >= ANCHORS[i + 1].r) i++;
  const a = ANCHORS[i],
    b = ANCHORS[i + 1];
  const t = Math.max(0, Math.min(1, (e - a.r) / (b.r - a.r)));
  const A = filled(a.l),
    B = filled(b.l);
  const mix = {} as Record<keyof typeof A, number>;
  for (const key of Object.keys(A) as (keyof typeof A)[]) mix[key] = A[key] + (B[key] - A[key]) * t;
  const lv: AILevel = {
    id: `r${Math.round(r)}`,
    name: (t < 0.5 ? a : b).l.name,
    ...mix,
    react: Math.round(mix.react),
    robust: Math.round(mix.robust),
  };
  // 내다보기: 아래 단계에 없으면 위 단계 쪽으로 갈수록 자주 씀
  if (a.l.look || b.l.look) {
    lv.look = Math.round(a.l.look && b.l.look ? a.l.look + (b.l.look - a.l.look) * t : (b.l.look ?? a.l.look)!);
    lv.lookP = a.l.look ? 1 : t;
  }
  return lv;
}

/**
 * AI 지문: 랭크전 봇전은 서버가 같은 경기를 다시 돌려 확인하니, 브라우저와 서버의 AI가 똑같아야 함.
 * 단계 값·보정·콤보 길은 자동으로 들어가고, next() 같은 판단 코드를 바꿨으면 AI_REV 를 올릴 것.
 */
const AI_REV = 10;
export const AI_ID = (() => {
  const str = AI_REV + JSON.stringify([AI_LEVELS, RANK_TIERS, AI_RATING, ADJ_AT, CHAR_ADJ, ROUTES, ROUTE_CAP]);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
})();

/** AI 대전 단계 i 를 캐릭터 보정까지 넣은 난이도로 */
export const aiLevelFor = (i: number, charId?: string) => aiForRating(AI_RATING[i] ?? 0, charId);


function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Intent =
  | "approach"
  | "retreat"
  | "wait"
  | "jumpIn"
  | "poke"
  | "jab"
  | "fireball"
  | "block"
  | "space"
  | "throw";

/** 기술 사거리(px): 박스 끝 + 여유 */
const reachOf = (m: MoveDef, extra = 4) => m.box.x + m.box.w + extra;
/** 공중에서 손이 닿는 거리 (공중 약 · 발차기 · 공중 아이덴티티 — 돌진은 돌진 거리, 탄은 멀리) */
const airSReachOf = (c: CharDef) => {
  const sa = { ...c.moves.S, ...(c.moves.S.air ?? {}) } as MoveDef;
  return Math.min(sa.proj ? 230 : reachOf(sa) + (sa.rush ? Math.trunc((sa.rush.vx * sa.active) / SUB) : 0), 230);
};
const airReachOf = (c: CharDef) => Math.max(reachOf(c.moves.J), reachOf(c.moves.K), airSReachOf(c));

/** 상대가 그 상황에서 한 행동 */
type Act = "atk" | "throw" | "jump" | "block" | "wait";
const ACTS: Act[] = ["atk", "throw", "jump", "block", "wait"];
/** 상황별 상대 버릇: 그 상황마다 상대가 뭘 했는지 셈 (오래된 건 조금씩 잊음 — 상대가 바꾸면 따라감) */
class Habit {
  n: Record<Act, number>;
  constructor(prior: Record<Act, number>) {
    this.n = { ...prior };
  }
  add(a: Act) {
    for (const k of ACTS) this.n[k] *= 0.85;
    this.n[a] += 1;
  }
  p(a: Act) {
    let t = 0;
    for (const k of ACTS) t += this.n[k];
    return this.n[a] / t;
  }
}
/** 일어날 때 · 막은 뒤 버릇의 처음 값 (아직 본 게 없을 때) */
const WAKE_PRIOR: Record<Act, number> = { atk: 0.8, throw: 0.2, jump: 0.4, block: 0.8, wait: 0.8 };
/** 쓰러진 상대가 일어나는 동안 할 일 (일어날 때 버릇으로 고름) */
type Oki = "bait" | "throw" | "aa" | "meaty";
/**
 * 노림수 설정: 몇 프레임마다 · 몇 프레임 앞까지 돌려 볼지, 둘 만한 수의 최소 값, 미리 넣을 입력 수, 상대와의 거리(상대 손 닿는 거리 + range),
 * 기대값과 최악의 경우를 섞는 비율 (10.11 사람 흉내 상대로 맞춤)
 */
const K = { every: 2, W: 24, WV: 40, thr: 4, plan: 8, range: 70, worst: 0.4 };
/** 일어나는 동작 프레임 (sim RISE_T 와 같게) */
const RISE_T = 14;

export class FightAI {
  private r: () => number;
  private intent: Intent = "wait";
  private hold = 0;
  private lastPress = 0;
  /** 상대가 공격을 시작한 걸 처음 본 프레임 */
  private sawAtk = -1;
  private sawJump = -1;
  /** 뛰어들며 치는 공격을 처음 본 프레임 · 막을지 */
  private sawAir = -1;
  private airBlockDecision: boolean | null = null;
  /** 상대가 뛰어서 공중 손 닿는 거리로 들어옴: 처음 본 프레임 · 어떻게 할지 (뛸 때 한 번 정함 — 공격이 나온 걸 보고 반응하는 게 아니라 뛰는 걸 보고 미리) */
  private sawZone = -1;
  private zonePlan: "guard" | "back" | "none" | null = null;
  /** 내가 떠 있을 때 상대가 공중 아이덴티티로 받아치려고 뛰어오름: 피할지 (상대 점프마다 한 번 정함) */
  private dodgeDecision: boolean | null = null;
  private respect: boolean | null = null;
  private blockDecision: boolean | null = null;
  private aaDecision: boolean | null = null;
  private comboDecision: boolean | null = null;
  private techDecision: boolean | null = null;
  private gcDecision: boolean | null = null;
  private cutDecision: boolean | null = null;
  private lookDecision: boolean | null = null;
  /** 차지 기술을 몇 프레임 모을지 (-1 = 아직 안 정함) */
  private chargeGoal = -1;
  /** 상대가 가만히(서 있거나 가드만) 있은 프레임 수 — 오래 가만히 있으면 먼저 들어감 */
  private oStill = 0;
  private oX = 0;
  /** 이어 치는 중인 콤보 길 · 다음 프레임 · 좌우 뒤집기 · 상대가 맞지 않은 채 지난 프레임 */
  private route: ComboRoute | null = null;
  private routeI = 0;
  private routeFlip = false;
  private routeIdle = 0;
  private routeHp = 0;
  private prevRoute = 0;
  /** 내다보고 고른 입력 (남은 프레임) */
  private plan: number[] = [];
  /** 대시 입력 (톡·떼고·톡) 남은 프레임 */
  private dashSeq: number[] = [];
  /** 낭떠러지 건너가는 중: 목표 발판 (2단 점프 + 공중 대시로) */
  private crossTo: Plat | null = null;
  /** 한 번 점프로 못 닿는 높은 발판의 상대에게 가려고 거쳐 가는 발판 (계단처럼) */
  private climb: Plat | null = null;
  private climbUntil = 0;
  // ── 읽기 (상대 버릇) ──
  private wake = new Habit(WAKE_PRIOR);
  private afterBlk = new Habit(WAKE_PRIOR);
  /** 지금 지켜보는 상황 (일어남 · 막은 뒤) — 끝나기 전에 상대가 처음 한 행동을 버릇에 더함 */
  private watch: { h: Habit; until: number } | null = null;
  private po = { st: "", stun: 0 };
  /** 가까이서 상대가 잡기 / 타격을 낸 횟수, 내 잡기를 상대가 푼 횟수 / 내 잡기가 들어간 횟수 */
  private oThrows = 0.6;
  private oStrikes = 2;
  private oTechs = 0.6;
  private myGrabs = 2;
  /** 중거리에서 상대가 뛴 횟수 / 중거리에 있던 프레임 */
  private oJumps = 0;
  private midT = 300;
  /** 이 프레임까지 미리 가드 (읽기) */
  private guardUntil = -1;
  /** 상대가 막은 뒤 내 다음 수 (읽기) */
  private after: "guard" | "throw" | "jab" | null = null;
  private afterUntil = -1;
  /** 쓰러진 상대 일어날 때 노림수 */
  private oki: Oki | null = null;
  /** 상대 공격 · 빈틈을 처음 본 프레임 (내다보기도 알아챈 뒤에만) */
  private sawHot = -1;
  /** 가까운 거리(중립)에서 상대가 하는 행동 — 10프레임마다 처음 한 행동 */
  private near = new Habit({ atk: 1, throw: 0.3, jump: 0.5, block: 0.8, wait: 1.5 });
  private nearWin = { until: -1, act: null as Act | null };
  private nextRead = 0;
  /** 가까이서 상대가 공격을 내는 빈도 (프레임당) */
  private closeAtk = 0.02;
  /** 윗발판 상대에게 올라갈 때 상대 손이 안 닿는 쪽 가장자리 (그 밑에서 점프) */
  private entry: number | null = null;
  private entryUntil = 0;
  /** 밑에서 올라가다 위의 상대에게 맞은 횟수 — 많을수록 더 조심 (빈틈을 기다림) */
  private upHits = 0;
  private prevSt = "";
  /** 이번에 윗발판으로 올라갈 때 조심해서 올라가나 (null = 아직 안 정함) */
  private upSmart: boolean | null = null;
  /** 윗발판 상대를 떠보는 낮은 점프 중 */
  private bait = false;
  private jump2At = 0;
  private wasAir = false;
  /** 떨어지는 중 발판으로 복귀하는 중 (착지할 때까지) */
  private recover = false;
  private prevDir = 0;
  private dirTapAt: Record<number, number> = { [IN.L]: -99, [IN.R]: -99 };
  /** 저스트 가드 노리기: 상대 판정이 나오기 이 프레임 전에 ↓ */
  private justPlan = -1;

  constructor(
    public level: AILevel,
    seed = 1
  ) {
    this.r = rng(seed);
  }

  next(s: State, me: 0 | 1): number {
    const f = s.p[me];
    const o = s.p[1 - me];
    if (s.phase !== "fight") return 0;
    const c = CHARS[f.ch];
    const oc = CHARS[o.ch];
    const map = mapOf(s);
    const toward = o.x > f.x ? IN.R : IN.L;
    const away = o.x > f.x ? IN.L : IN.R;
    const dist = Math.abs(o.x - f.x) / SUB;
    const dy = (o.h - f.h) / SUB;
    const L = this.level;
    const air = isAir(s, f);
    let out = 0;
    // 상대가 가만히 있나 (서 있거나 가드, 거의 안 움직임)
    if ((o.st === "idle" || o.st === "block") && Math.abs(o.x - this.oX) < 2 * SUB) this.oStill++;
    else this.oStill = 0;
    this.oX = o.x;
    const passive = this.oStill > 90;
    // 밑에서 올라가다(위의 상대에게) 맞은 횟수
    if (f.st === "hit" && this.prevSt !== "hit" && dy > 30) this.upHits = Math.min(4, this.upHits + 1);
    this.prevSt = f.st;
    if (dy < 30) this.upSmart = null;
    this.observe(s, me, dist);
    if (!air && Math.abs(dy) < 20 && this.upHits > 0 && this.r() < 0.004) this.upHits--;

    // 버튼은 한 프레임 누르고 떼야 새로 눌린 걸로 침
    const press = (b: number) => {
      if (this.lastPress & b) return;
      out |= b;
    };
    // 공중에서 상대가 공중 아이덴티티를 쥔 채 올라오는데 내 공중 공격은 안 닿는 거리 — 허공에 휘둘러 굳지 말고 물러남
    // (휘두르다 굳은 채 공중 L에 맞던 것, 10.13 · 한 번 마주칠 때마다 단계별 확률로 한 번 정함 — 늘 피하진 않음)
    const oUpNow = air && isAir(s, o) && (o.st === "jump" || o.st === "atk") && o.cd === 0 && o.face > 0 === f.x > o.x;
    if (!oUpNow) this.respect = null;
    const finish = () => {
      if (oUpNow && out & (IN.A | IN.B) && dist > reachOf(c.moves.J) + 12 && dist < airReachOf(oc) + 60) {
        if (this.respect === null) this.respect = this.r() < L.antiAir * 0.6 + (L.read ?? 0) * 0.3;
        if (this.respect) out = (out & ~(IN.A | IN.B | IN.L | IN.R)) | away;
      }
      this.lastPress = out & (IN.A | IN.B | IN.C | IN.X | IN.J);
      // 방금 톡 했던 방향을 다시 누르면 대시가 나감 → 대시 거리 안에 낭떠러지면 이번엔 안 누름
      if (!isAir(s, f) && !this.crossTo && f.st !== "dash") {
        for (const b of [IN.L, IN.R]) {
          const tap = out & b & ~this.prevDir && s.f - this.dirTapAt[b] <= 15;
          if (tap && !platBelow(map, f.x + (b === IN.R ? 160 : -160) * SUB, f.h)) out &= ~b;
        }
      }
      // 방향키를 새로 누른 프레임 기록
      for (const b of [IN.L, IN.R]) if (out & b & ~this.prevDir) this.dirTapAt[b] = s.f;
      this.prevDir = out & (IN.L | IN.R);
      return out;
    };

    // ── 차지 기술 (이반 철곰권): 기 모으는 동안 버튼을 누르고 있음 — 상대가 막고 있거나 멀거나 쓰러져 있으면 끝까지(가드 부수기), 아니면 짧게 ──
    const chg = c.moves.S.charge;
    if (chg && f.st === "atk" && f.mv === "S" && !air) {
      if (this.chargeGoal < 0) {
        const full = o.st === "block" || o.st === "down" || o.st === "rise" || dist > 110 || this.oStill > 30;
        this.chargeGoal = full && this.r() < 0.4 + L.combo * 0.5 ? chg.max : Math.floor(this.r() * chg.max * 0.5);
      }
      if (f.chg < this.chargeGoal && f.t <= chg.at + 1) {
        this.lastPress = IN.C;
        return IN.C;
      }
    } else this.chargeGoal = -1;
    if (this.dashSeq.length) {
      out = this.dashSeq.shift()!;
      return finish();
    }
    if (f.st === "hit" || f.st === "down" || f.st === "ko") ((this.plan = []), (this.route = null));
    // ── 콤보 길: 내 시작기가 방금 맞았으면 그 캐릭터의 콤보 길로 이어 침 ──
    if (!this.route && L.route && o.combo <= 2) {
      const routes = ROUTES[c.id] ?? {};
      let st: Starter | null = null;
      for (const e of s.ev) {
        if (e.p !== me) continue;
        if (e.k === "throw") st = "T";
        else if (e.k === "hit" && e.m === "S" && routes.S) st = "S";
        else if (e.k === "hit" && e.m === "L" && f.chain <= 1) st = "L4";
        else if (e.k === "hit" && e.m === "H" && f.chain <= 1) st = "H";
      }
      const rt = st ? routes[st] : undefined;
      if (rt && this.r() < L.route) {
        this.route = rt;
        this.routeI = rt.k0 + 1;
        this.routeFlip = o.x < f.x;
        this.routeIdle = 0;
        this.routeHp = o.hp;
        this.prevRoute = 0;
      }
    }
    if (this.route) {
      const busy = o.st === "hit" || o.st === "down" || o.trapT > 0 || o.grabbed > 0;
      this.routeIdle = busy ? 0 : this.routeIdle + 1;
      // 콤보 길은 피해 ROUTE_CAP 까지만 (캐릭터마다 길이 달라 너무 아픈 길이 승률을 흔들지 않게) — 그다음은 원래 판단으로
      if (this.routeI >= this.route.r.length || this.routeIdle > 1 || this.routeHp - o.hp >= ROUTE_CAP) this.route = null;
      else {
        let a = this.route.r[this.routeI];
        // 길을 그대로 따라가다 상대가 먼저 풀려 내가 공중에서 얻어맞던 것 (10.13) — 사람처럼, 다음 타가 안 들어갈 것 같으면
        // 뛰거나 새로 치지 않고 길을 접음: 상대가 곧 풀리는데(땅에서 맞는 중 · 남은 경직 짧음) 새로 뛰려 하거나,
        // 상대가 더는 맞는 중이 아닌데 공격을 새로 누르려 할 때
        // (띄운 상대도 남은 경직이 이번 기술 발생보다 짧으면 공중에서 먼저 풀려 받아침 — 그땐 새로 안 침)
        const held = o.grabbed > 0 || o.trapT > 0 || o.st === "down";
        const fresh = a & ~this.prevRoute & (IN.J | IN.A | IN.B | IN.C);
        const nm = !fresh ? undefined : fresh & IN.J ? undefined : air
          ? fresh & IN.A ? c.moves.J : fresh & IN.B ? c.moves.K : c.moves.S.air
          : fresh & IN.A ? c.moves.L : fresh & IN.B ? c.moves.H : c.moves.S;
        const needT = fresh & IN.J ? 14 : (nm?.startup ?? 0) + 2;
        if (fresh && !held && (o.st !== "hit" || o.stun < needT)) {
          this.route = null;
          this.prevRoute = 0;
        } else {
        this.routeI++;
        this.prevRoute = a;
        if (this.routeFlip) a = (a & ~(IN.L | IN.R)) | (a & IN.L ? IN.R : 0) | (a & IN.R ? IN.L : 0);
        out = a;
        this.lastPress = 0;
        // (입력을 그대로 내보냄 — finish 의 대시 보정 등은 거치지 않음)
        this.prevDir = a & (IN.L | IN.R);
        return a;
        }
      }
    }
    // 미리 짜 둔 땅 수순을 따라가는 중에 상대가 이쪽으로 뛰어들어 온 걸 알아챘으면 수순을 접고 다시 판단
    // (짜 둔 대로 발차기·잡기를 내밀다 공중 L에 맞던 것, 10.13 — 상황이 바뀌면 사람도 하던 걸 멈춤)
    if (this.plan.length && !air && this.sawZone >= 0 && s.f - this.sawZone >= L.react && isAir(s, o) && o.st !== "hit") this.plan = [];
    if (this.plan.length) {
      out = this.plan.shift()!;
      return finish();
    }

    // ── 비눗방울에 갇힘: 연타로 탈출 (단계가 높을수록 빠르게) ──
    if (f.trapT > 0) {
      if (this.r() < L.block) press(IN.A);
      return finish();
    }
    // ── 잡혔다: 풀기 (단계별 확률) ──
    if (f.grabbed > 0) {
      if (this.techDecision === null) {
        // 잡기 풀기는 보고 하기엔 짧아 찍기 — 상대가 가까이서 잡기를 자주 쓰면(읽기) 더 자주 미리 누름
        const base = L.tech ?? L.block * 0.4;
        const share = this.oThrows / (this.oThrows + this.oStrikes);
        const rd = L.read ?? 0;
        // (10.12 읽기 상한 0.75 → 0.5, 잡기 비율 가중 2.2 → 1.4: 잡기를 자주 쓰면 거의 다 풀던 것)
        this.techDecision = this.r() < base * (1 - rd) + rd * Math.min(0.5, base * (0.5 + 1.4 * share));
      }
      if (this.techDecision) out = IN.A | IN.B;
      return finish();
    }
    this.techDecision = null;

    // 공중 대시 입력 (톡·떼고·톡): 3~14프레임 안에 두 번 눌러야 함
    const airDash = (dir: number) => {
      this.dashSeq = [0, dir, dir, 0, 0, dir, dir, dir];
      return finish();
    };
    // ── 공중에서 받아치기 피하기: 내가 떠 있는데 상대가 공중 아이덴티티(건모 Alt+Tab · 제나 뇌격돌 · 소영 채찍 …)를
    // 쓸 수 있는 채로 뛰어오르며 다가오면 공중 대시로 빠짐 (공중에선 못 막아서 다 맞던 것, 10.13 — 보고 반응이 아니라 뛰는 걸 보고)
    {
      const oUp = isAir(s, o) && (o.st === "jump" || o.st === "atk") && o.cd === 0 && o.face > 0 === f.x > o.x;
      if (!oUp) this.dodgeDecision = null;
      else if (air && f.st === "jump" && !f.airDash && dist < airReachOf(oc) + 40 && dist > 50) {
        if (this.dodgeDecision === null) this.dodgeDecision = this.r() < L.antiAir * 0.55 + (L.read ?? 0) * 0.25;
        if (this.dodgeDecision) {
          this.dodgeDecision = false;
          return airDash(away);
        }
      }
    }
    // ── 공중 노림수: 뛰어서 다가가는 중 — 상대가 하던 행동 비율로 공격 타이밍 · 2단 점프 · 공중 대시를 미리 돌려 보고 파고듦 ──
    if ((L.plan ?? 0) > 0 && air && f.st === "jump" && !isAir(s, o) && dist < 160 && Math.abs(dy) < 170 && s.f >= this.nextRead && o.st !== "hit") {
      this.nextRead = s.f + K.every;
      if (this.r() < (L.plan ?? 0)) {
        const wts = ACTS.map((a) => [a, this.near.p(a)] as [Act, number]);
        const best = this.lookAhead(s, me, K.WV, true, toward, away, wts, this.airCands(toward, away, f), true);
        if (best && best.v > K.thr) {
          this.plan = best.seq.slice(1, K.plan + 6);
          out = best.seq[0];
          return finish();
        }
      }
    }
    // ── 윗발판 상대에게 올라가기: 상대 손이 안 닿는 쪽 가장자리 밑으로 가서 점프 → 그쪽 끝에 내려앉음 ──
    if (this.entry !== null) {
      const ex = this.entry * SUB;
      const oNear = Math.abs(o.x - ex) / SUB < Math.max(reachOf(oc.moves.L), reachOf(oc.moves.H)) + 30;
      const landedUp = !air && dy < 30;
      if (landedUp || s.f > this.entryUntil || f.st === "hit" || f.st === "down" || f.st === "ko" || isAir(s, o) || (!air && oNear)) this.entry = null;
      else if (f.st === "idle" || f.st === "walk" || f.st === "dash" || f.st === "jump") {
        if (!air) {
          if (Math.abs(ex - f.x) > 14 * SUB) out |= ex > f.x ? IN.R : IN.L;
          else press(IN.J);
        } else {
          if (Math.abs(ex - f.x) > 10 * SUB) out |= ex > f.x ? IN.R : IN.L;
          if (dy > 20 && f.jumps < 2 && f.vh <= 150) press(IN.J);
          if (c.glide && f.jumps >= 2 && f.vh < 0 && dy < 0) out |= IN.J;
        }
        return finish();
      }
    }
    // ── 높은 발판으로 올라가는 중: 거쳐 갈 발판 아래로 가서 점프, 꼭대기에서 2단 점프, 발판 안쪽으로 ──
    if (this.climb) {
      const p = this.climb;
      const landed = !air && Math.abs(f.h - p.y * SUB) < SUB && platBelow(map, f.x, f.h) === p;
      if (landed || s.f > this.climbUntil || f.st === "hit" || f.st === "down" || f.st === "ko" || dy < 30) this.climb = null;
      else if (f.st === "idle" || f.st === "walk" || f.st === "dash" || f.st === "jump") {
        const near = Math.max((p.x0 + 18) * SUB, Math.min((p.x1 - 18) * SUB, f.x));
        const mid = ((p.x0 + p.x1) / 2) * SUB;
        if (!air) {
          // 발판 가장자리 근처까지 걸어가서 점프 (발판 쪽으로 기울여)
          if (Math.abs(near - f.x) > 36 * SUB) out |= near > f.x ? IN.R : IN.L;
          else {
            out |= mid > f.x ? IN.R : IN.L;
            press(IN.J);
          }
        } else {
          const inside = f.x > (p.x0 + 12) * SUB && f.x < (p.x1 - 12) * SUB;
          if (!inside) out |= mid > f.x ? IN.R : IN.L;
          // 아직 발판보다 낮으면 꼭대기 근처에서 2단 점프
          if (f.h < p.y * SUB + 12 * SUB && f.jumps < 2 && f.vh <= 150) press(IN.J);
          if (c.glide && f.jumps >= 2 && f.vh < 0 && f.h > p.y * SUB) out |= IN.J;
        }
        return finish();
      }
    }

    // 건너가기는 착지하거나 맞으면 끝
    if ((!air && this.wasAir) || f.st === "hit" || f.st === "down") this.crossTo = null;
    if (!air) this.recover = false;
    this.wasAir = air;
    // ── 건너편 발판으로 점프 중: 꼭대기에서 2단 점프, 그다음 공중 대시 ──
    if (air && this.crossTo && f.st === "jump") {
      const t = this.crossTo;
      const dir = (t.x0 + t.x1) / 2 > f.x / SUB ? IN.R : IN.L;
      out |= dir;
      if (f.jumps < 2 && f.vh <= 0) {
        press(IN.J);
        this.jump2At = s.f;
      } else if (f.jumps >= 2 && !f.airDash && s.f - this.jump2At >= 4) return airDash(dir);
      if (c.glide && f.jumps >= 2 && f.vh < 0) out |= IN.J;
      return finish();
    }

    // ── 떨어지는 중: 가까운 발판으로 복귀 ──
    if (air && f.st !== "hit" && f.st !== "ko") {
      // 지금 속도로 가면 착지할 발판이 없으면
      const under = platBelow(map, f.x + f.vx * 24, f.h);
      // 한 번 복귀하기 시작하면 착지할 때까지 계속 (발판 끝에서 왔다 갔다 하지 않게)
      if (!under || f.h / SUB > VIEW_H || this.recover) {
        this.recover = true;
        let best = map.plats[0];
        let bd = Infinity;
        // 지금 날아가는 쪽(관성)을 감안해서 가까운 발판
        const px = f.x + f.vx * 16;
        for (const p of map.plats) {
          const cx = ((p.x0 + p.x1) / 2) * SUB;
          const ex = Math.max(p.x0 * SUB, Math.min(p.x1 * SUB, px));
          const d = Math.abs(ex - px) + Math.max(0, p.y * SUB - f.h) * 2 + Math.abs(cx - px) * 0.1;
          if (d < bd) ((bd = d), (best = p));
        }
        if (this.crossTo) best = this.crossTo;
        const cx = ((best.x0 + best.x1) / 2) * SUB;
        // 발판 위에 들어와 있으면 그냥 내려앉음, 아니면 안쪽으로
        const inside = f.x > best.x0 * SUB + 12 * SUB && f.x < best.x1 * SUB - 12 * SUB;
        if (!inside) out |= cx > f.x ? IN.R : IN.L;
        if (f.jumps < 2 && f.vh < 0 && f.h < best.y * SUB + 40 * SUB) press(IN.J);
        // 점프를 다 써도 못 닿으면 공중 대시
        else if (f.jumps >= 2 && !f.airDash && f.vh < 0 && !inside && f.h < best.y * SUB + 60 * SUB) return airDash(cx > f.x ? IN.R : IN.L);
        // 공중 돌진 아이덴티티(제나 뇌격돌)로 옆으로 복귀: 다 쓰고도 못 닿고, 돌진 방향으로 발판이 있으면
        else if (f.jumps >= 2 && f.airDash && f.cd === 0 && !inside && c.moves.S.air?.rush?.airVh === 0 && f.h > best.y * SUB - 20 * SUB) {
          out = cx > f.x ? IN.R : IN.L;
          if ((f.face > 0) === (cx > f.x)) press(IN.C);
          return finish();
        }
        // 우산 활강 (점프를 다 쓴 뒤)
        if (c.glide && f.vh < 0 && f.jumps >= 2) out |= IN.J;
        return finish();
      }
    }

    // ── 상대 공격 감지 (반응 지연) ──
    const om = o.st === "atk" && o.mv ? oc.moves[o.mv] : null;
    const oAtk = !!om && o.mv !== "J" && o.mv !== "T";
    if (oAtk) {
      if (this.sawAtk < 0) this.sawAtk = s.f;
    } else {
      this.sawAtk = -1;
      this.blockDecision = null;
      this.cutDecision = null;
      this.justPlan = -1;
    }
    const oJumpIn = isAir(s, o) && dy > 20 && dy < 120 && dist < 90 && o.vh < 0;
    if (oJumpIn) {
      if (this.sawJump < 0) this.sawJump = s.f;
    } else {
      this.sawJump = -1;
      this.aaDecision = null;
    }
    const noticed = (t: number) => t >= 0 && s.f - t >= L.react;
    // 뛰어들며 치는 공격 (공중 약 · 발차기 · 공중 아이덴티티 · 필살기): 나를 보고 위에서 떨어지며 닿을 거리 — 막음 (10.13: 공중 약은 공격으로 안 봐서 점프 약 연타에 다 맞던 것)
    const oAirAtk = !!om && isAir(s, o) && o.mv !== "T" && dy > -20 && dy < 150 && dist < 130 && o.face > 0 === f.x > o.x;
    // 뛰어든 상대의 공중 손 닿는 거리 안 (나를 보고, 비슷한 높이 ~ 위)
    // (이쪽으로 오며 뛰는 중이면 반응 시간 동안 다가올 거리만큼 더 멀리서부터 — 사람도 뛰는 걸 보고 미리 대비)
    const oCome = o.vx !== 0 && o.vx > 0 === f.x > o.x ? Math.min(90, (Math.abs(o.vx) * (L.react + 6)) / SUB) : 0;
    // 공중 아이덴티티가 준비됐고, 공중 약 · 발차기는 안 닿는데 그건 닿는 거리일 때만 (더 가까이 오면 평소처럼 대공 · 공중전 —
    // 뛰어드는 상대마다 미리 웅크리면 점프 공격만 하는 상대에게 손을 못 써서 더 짐)
    // (소영 채찍처럼 공중 약 · 발차기보다 훨씬 아래까지 닿는 거면 위에서 내려치는 거라 가까워도 막음)
    const oSa = { ...oc.moves.S, ...(oc.moves.S.air ?? {}) } as MoveDef;
    const oDeep = oSa.box.y - oSa.box.h < Math.min(oc.moves.J.box.y - oc.moves.J.box.h, oc.moves.K.box.y - oc.moves.K.box.h) - 40;
    const oJR = oDeep ? 0 : Math.max(reachOf(oc.moves.J), reachOf(oc.moves.K));
    const oZone =
      isAir(s, o) && (o.st === "jump" || o.st === "atk") && (o.cd < 60 || o.st === "atk") && o.face > 0 === f.x > o.x && dy > -30 && dy < 170 && dist > oJR + 8 && dist < airSReachOf(oc) + 24 + oCome;
    if (!isAir(s, o) || o.st === "hit") ((this.sawZone = -1), (this.zonePlan = null));
    else if (oZone && this.sawZone < 0) this.sawZone = s.f;
    if (oAirAtk) {
      if (this.sawAir < 0) this.sawAir = s.f;
    } else {
      this.sawAir = -1;
      this.airBlockDecision = null;
    }

    const lReach = reachOf(c.moves.L, 6);
    const hReach = reachOf(c.moves.H);
    const tReach = reachOf(c.moves.T, 2);
    const sm = c.moves.S;
    const idReach = sm.proj
      ? 9999
      : sm.box.x + sm.box.w + (sm.rush ? Math.trunc((sm.rush.vx * (sm.active + 4)) / SUB) : 0);
    // 상대의 가장 긴 평타 사거리 (이 밖에서 서성이면 안전)
    const oReach = Math.max(reachOf(oc.moves.L), reachOf(oc.moves.H));
    const faceOk = (f.face > 0) === (o.x > f.x);
    const hitBtn = (b: number) => {
      if (!faceOk) out |= toward;
      else press(b);
    };

    // ── 띄운 상대 공중 콤보 (잡기·약 4단 마무리 뒤) ──
    if (o.st === "hit" && o.float && !o.kd && this.r() < L.combo + 0.2) {
      if (f.st === "atk" && f.hit && (f.mv === "T" || f.mv === "G" || (f.mv === "L" && f.chain >= 4))) {
        // 점프 캔슬
        press(IN.J);
        return finish();
      }
      // (뜬 상대가 곧 풀리면 쫓아 뛰거나 새로 치지 않음 — 공중에서 먼저 풀린 상대에게 받아치기 당하던 것, 10.13)
      if ((f.st === "idle" || f.st === "walk") && !air && dist < 60 && o.stun >= 16) {
        out |= toward;
        press(IN.J);
        return finish();
      }
      if (f.st === "jump" || (f.st === "atk" && f.hit && (f.mv === "J" || f.mv === "K"))) {
        out |= toward;
        // 공중 연속: 약 위주로 이어 치다 마지막은 발차기 (박자: 판정이 맞은 직후에 누름)
        if (dist < 48 && dy > -25 && dy < 70 && o.stun >= c.moves.J.startup + 2 && this.r() < 0.35 + L.combo * 0.6) {
          if (c.moves.S.air?.hug && f.cd === 0 && !o.hugd && (o.combo >= 3 || f.airUsed >= 3) && this.r() < 0.5 + L.combo * 0.5) {
            // 곰 포옹으로 마무리: 안고 내리꽂아 기절 → 땅에서 이어 침
            press(IN.C);
          } else if ((o.floatT > 90 || o.combo >= 6 || (f.airUsed >= 4 && f.airK >= 2)) && f.airS === 0) {
            // 오래 띄웠거나 다 썼으면 ↓ + K 마무리 내려찍기
            out |= IN.D;
            hitBtn(IN.B);
          } else hitBtn(f.airK >= 2 || (f.airUsed < 3 && f.airK === 0) ? IN.A : IN.B);
        } else if (f.jumps < 2 && f.vh < 0 && dy > 30) press(IN.J);
        return finish();
      }
    }
    // ── 콤보 이어 가기 ──
    if (f.st === "atk" && f.hit && o.st === "hit") {
      if (this.comboDecision === null) this.comboDecision = this.r() < L.combo;
      if (this.comboDecision) {
        // 끌어당긴 뒤: 잡기로 띄우거나 약 콤보
        // 끌어당김(소영)·일시정지(건모) 뒤: 잡기로 띄우거나 약 콤보
        // 건모: 공중 콤보 중간에 Alt+F4 → 콤보 초기화, 착지해서 한 콤보 더
        if ((f.mv === "J" || f.mv === "K") && c.moves.X.bsod && !o.bsodd && f.meter >= 100 && this.r() < 0.6 && this.ultHits(s, me, 0)) press(IN.X);
        // 건모: ⏸ 일시정지 → 필살기 Alt+F4 로 캔슬 (느린 시작도 확정)
        else if (f.mv === "S" && c.moves.X.bsod && o.mark === 1 && f.meter >= 100 && this.r() < 0.7 && this.ultHits(s, me, 0)) press(IN.X);
        else if (f.mv === "S" && (o.pulled || o.mark === 1)) press(this.r() < 0.5 ? IN.A | IN.B : IN.A);
        else if (f.mv === "L") press(f.chain < 4 && this.r() < 0.6 ? IN.A : IN.B);
        else if (f.mv === "H") {
          if (f.meter >= 100 && this.r() < 0.6 && this.ultHits(s, me, 0)) press(IN.X);
          else if (f.cd === 0 && !sm.proj) press(IN.C);
          else if (f.chain < 2) press(IN.B);
        }
      }
      return finish();
    }
    if (f.st !== "atk") this.comboDecision = null;

    const free = f.st === "idle" || f.st === "walk";
    const blocking = f.st === "block";
    const aligned = Math.abs(dy) < 30;
    const incoming = s.proj.find(
      (p) => p.k === 0 && p.o !== me && Math.sign(p.vx) === Math.sign(f.x - p.x) && Math.abs(p.h - f.h - 30 * SUB) < 30 * SUB
    );
    // 발밑 불기둥 피하기
    const pillar = s.proj.find((p) => p.k === 1 && p.o !== me && Math.abs(p.x - f.x) < 40 * SUB && p.t < 24);
    if (pillar && (free || blocking) && !air && this.r() < L.block + 0.1) {
      out |= pillar.x > f.x ? IN.L : IN.R;
      if (Math.abs(pillar.x - f.x) < 20 * SUB) press(IN.J);
      return finish();
    }
    const projDist = incoming ? Math.abs(incoming.x - f.x) / SUB : 999;

    // ── 뛰어든 상대: 공중 공격이 나오기 전에 미리 (사람처럼 뛰는 걸 보고) 막거나 물러남 ──
    // (10.13: 공중 L 처럼 빠른 공중 기술은 나온 걸 보고는 못 막아서 다 맞던 것 — 반응보다 흐름으로)
    if ((free || blocking) && !air && oZone && noticed(this.sawZone)) {
      if (this.zonePlan === null) {
        const rd = L.read ?? 0;
        const grab = !!oc.moves.S.air?.hug; // 이반 곰 포옹: 못 막음 → 물러남
        const pg = grab ? 0 : L.block * (0.7 + 0.25 * rd);
        const pb = grab ? 0.45 + 0.5 * L.block : 0.1 + 0.2 * rd;
        const x = this.r();
        this.zonePlan = x < pg ? "guard" : x < pg + pb ? "back" : "none";
      }
      if (this.zonePlan === "guard") {
        out = IN.D;
        return finish();
      }
      if (this.zonePlan === "back") {
        out |= away;
        return finish();
      }
    }
    // ── 뛰어드는 공격 막기 ──
    if ((free || blocking) && !air && oAirAtk && noticed(this.sawAir)) {
      if (this.airBlockDecision === null) this.airBlockDecision = this.r() < L.block;
      if (this.airBlockDecision) {
        out = IN.D;
        return finish();
      }
    }
    // ── 내다보기 (지존): 상대가 기술을 쓰거나 빈틈이면 할 수 있는 행동을 다 돌려 보고 고름 ──
    if (L.look && (free || blocking) && !air && dist < 160 && Math.abs(dy) < 60) {
      const hot0 = oAtk || o.st === "hit" || o.st === "down" || (o.st === "atk" && !o.hit) || (incoming && projDist < 140) || oJumpIn;
      // 사람처럼: 상황을 본 뒤 반응 시간이 지나야 내다봄 (보자마자 정답을 고르지 않게)
      if (!hot0) this.sawHot = -1;
      else if (this.sawHot < 0) this.sawHot = s.f;
      const hot = hot0 && noticed(this.sawHot);
      if (!hot0) this.lookDecision = null;
      else if (this.lookDecision === null) this.lookDecision = this.r() < (L.lookP ?? 1);
      if (hot && this.lookDecision) {
        const best = this.lookAhead(s, me, L.look, faceOk, toward, away);
        if (best) {
          this.plan = best.seq.slice(1, 6);
          out = best.seq[0];
          return finish();
        }
      }
    }

    // ── 막는 중: 가드 반격 / 막은 뒤 반격(프레임 이득) ──
    if (blocking && !air) {
      if (f.stun > 0) {
        // 가드 반격: 상대가 아직 기술 중이고 게이지가 있으면 (단계별 확률)
        if (this.gcDecision === null) this.gcDecision = this.r() < L.combo * 0.5;
        if (this.gcDecision && f.meter >= 25 && om && o.t < om.startup + om.active + om.recovery - 6 && this.r() < 0.5) {
          out = IN.D;
          press(IN.B);
          return finish();
        }
        out = IN.D;
        return finish();
      }
      this.gcDecision = null;
      // 경직 끝: 상대가 아직 빈틈이면 반격, 아니면 가드 유지 여부 결정
      // (공중에서 친 상대는 곧 공중 약을 또 이어 쳐서 반격이 지기만 함 → 착지할 때까지 막고 있음, 10.13)
      if (oAirAtk || (isAir(s, o) && o.st === "atk" && dist < 110)) {
        out = IN.D;
        return finish();
      }
      if (om && aligned && dist < lReach) {
        const left = om.startup + om.active + om.recovery - o.t;
        if (left >= 3 && this.r() < L.combo) {
          hitBtn(left > 10 ? IN.B : IN.A);
          return finish();
        }
      }
      if (oAtk && dist < oReach + 20) {
        out = IN.D;
        return finish();
      }
    }

    if ((free || blocking) && !air) {
      const rd = L.read ?? 0;
      // ── 읽기: 미리 가드 (상대가 이 상황에서 잘 때리면 보기 전에 막고 있음) ──
      if (this.guardUntil >= s.f && aligned) {
        out = IN.D;
        return finish();
      }
      // ── 읽기: 내 공격이 막힌 뒤 다음 수 ──
      if (this.after && free && aligned && dist < 90) {
        const a = this.after;
        this.after = null;
        if (a === "guard") {
          this.guardUntil = s.f + 14;
          out = IN.D;
          return finish();
        }
        if (a === "throw" && faceOk) {
          if (dist > tReach - 2) {
            // 한 걸음 다가가서 잡기
            this.dashSeq = [toward, toward, toward, toward | IN.A | IN.B];
            return finish();
          }
          press(IN.A | IN.B);
          return finish();
        }
        if (a === "jab" && dist < lReach + 6) {
          hitBtn(IN.A);
          return finish();
        }
      }
      // ── 읽기: 쓰러진 상대가 일어날 때 노림수 (일어날 때 버릇으로 고름) ──
      if ((o.st === "down" && o.t >= 26) || o.st === "rise") {
        if (this.oki === null) {
          const h = this.wake;
          const techR = Math.min(0.8, this.oTechs / this.myGrabs);
          const w: [Oki, number][] = [
            ["bait", h.p("atk") * 1.2],
            ["throw", (h.p("block") + h.p("wait") * 0.4) * (1 - techR)],
            ["aa", h.p("jump")],
            ["meaty", h.p("wait") + h.p("block") * 0.3 + 0.12],
          ];
          if (this.r() < rd) {
            // 버릇에 맞춰 (확률을 제곱해서 많이 한 쪽으로 더 쏠리게)
            let t = 0;
            for (const x of w) t += x[1] ** 2;
            let r = this.r() * t;
            this.oki = w[w.length - 1][0];
            for (const x of w) if ((r -= x[1] ** 2) <= 0) {
              this.oki = x[0];
              break;
            }
          } else this.oki = this.r() < L.combo ? "meaty" : "bait";
        }
        const rising = o.st === "rise";
        const left = rising ? RISE_T - o.t : RISE_T + 36 - o.t;
        switch (this.oki) {
          case "bait":
            // 상대 손 닿는 거리 바로 밖에서 가드 → 일어나며 친 걸 막고 반격(막은 뒤 반격은 위 가드 처리)
            if (dist < oReach + 6) out |= away;
            else if (dist > oReach + 24) out |= toward;
            if (rising && left <= 4) this.guardUntil = s.f + 16;
            return finish();
          case "throw":
            if (dist > tReach - 6) out |= toward;
            return finish(); // 일어난 첫 프레임에 잡기 (아래 "일어남" 처리)
          case "aa":
            if (dist < 36) out |= away;
            else if (dist > 60) out |= toward;
            this.aaDecision = true;
            return finish();
          case "meaty": {
            // 일어나는 순간 판정이 나오게 미리 약
            const st = c.moves.L.startup;
            if (dist > lReach - 8) out |= toward;
            else if (rising && left <= st && left >= st - 2 && faceOk) press(IN.A);
            return finish();
          }
        }
      }
      if (this.oki === "throw" && o.st === "idle" && dist < tReach && faceOk && o.t < 2) {
        this.oki = null;
        press(IN.A | IN.B);
        return finish();
      }
      // ── 노림수: 가까운 중립에서 상대가 하던 행동 비율로 내 행동들을 미리 돌려 보고 기대값이 좋은 수를 둠 ──
      if ((L.plan ?? 0) > 0 && (free || (blocking && f.stun === 0)) && dist < oReach + K.range && !oAtk && o.st !== "hit" && s.f >= this.nextRead) {
        this.nextRead = s.f + K.every;
        if (this.r() < (L.plan ?? 0)) {
          const wts = ACTS.map((a) => [a, this.near.p(a)] as [Act, number]);
          // 높이가 다르면(윗발판 · 아래) 점프로 파고들기 · 받아치기까지 길게 돌려 봄
          // (상대가 그냥 뛰어 있는 거면 높이 차이가 아님 — 점프로 마중 나가면 공중에서 먼저 맞음, 10.13)
          const vert = Math.abs(dy) > 40 && !isAir(s, o);
          const best = this.lookAhead(s, me, vert ? K.WV : K.W, faceOk, toward, away, wts, vert ? this.vertCands(toward, away) : undefined);
          if (best && best.v > K.thr) {
            this.plan = best.seq.slice(1, K.plan);
            out = best.seq[0];
            return finish();
          }
        }
      }
      // ── 읽기: 가까이서 상대가 자주 때리면 가끔 미리 가드 (반응으로는 빠른 약을 못 막으니) ──
      if (free && aligned && dist < oReach + 8 && !oAtk && rd > 0) {
        const busy = Math.min(1, this.closeAtk * 30);
        if (this.r() < rd * L.block * busy * 0.06) {
          this.guardUntil = s.f + 8 + Math.floor(this.r() * 8);
          out = IN.D;
          return finish();
        }
      }
      // 끼어들기 (지존): 상대 기술이 나오기 전에 내 약이 먼저 닿으면 먼저 때림
      if (L.interrupt && free && om && oAtk && noticed(this.sawAtk) && aligned && dist < lReach && faceOk && om.startup - o.t > c.moves.L.startup + 1) {
        if (this.cutDecision === null) this.cutDecision = this.r() < L.interrupt;
        if (this.cutDecision) {
          press(IN.A);
          return finish();
        }
      }
      // 막기 (↓): 상대 공격을 알아챘고, 닿을 거리면 — 고수는 판정 직전에 올려 저스트 가드
      const reach = om ? reachOf(om, 18) : 0;
      if (oAtk && noticed(this.sawAtk) && aligned && (dist < reach || o.mv === "X")) {
        if (this.blockDecision === null) {
          this.blockDecision = this.r() < L.block;
          this.justPlan = this.r() < (L.just ?? L.combo * 0.6) ? 2 + Math.floor(this.r() * 3) : -1;
        }
        if (this.blockDecision) {
          const untilHit = om!.startup - o.t;
          if (this.justPlan >= 0 && untilHit > this.justPlan && f.st !== "block") {
            // 아직 안 올림 (저스트 가드 타이밍 기다림) — 대신 살짝 물러남
            out |= away;
            return finish();
          }
          out = IN.D;
          return finish();
        }
      }
      // 탄: 막거나 뛰어넘기
      if (incoming && projDist < 90 && projDist > 16) {
        if (this.blockDecision === null) this.blockDecision = this.r() < L.block;
        if (this.blockDecision) {
          if (this.r() < 0.5) press(IN.J);
          else out |= IN.D;
          return finish();
        }
      }
      // 대공
      if (oJumpIn && noticed(this.sawJump)) {
        // 상대가 자주 뛰는 걸 봤으면(읽기) 대공을 미리 노리고 있음
        if (this.aaDecision === null) this.aaDecision = this.r() < Math.min(1, L.antiAir * (0.8 + 0.5 * (L.read ?? 0) * this.jumpy()));
        // (10.13) 땅 발차기 대공은 시작이 느리고 판정이 낮아 공중 약에 지기만 함 → 막고 착지 빈틈에 반격
        // (마주 뛰어올라 공중 약으로 받아치기도 해 봤는데 시뮬에서 더 많이 짐)
        if (this.aaDecision && dist < 70) {
          out = IN.D;
          return finish();
        }
      }
      // 누운 상대: 다가가서 때리거나(피해 절반, 못 막음) 잡아서 다시 띄움 — 일어나기 직전엔 안 들어감
      if (o.st === "down" && Math.abs(dy) < 20 && o.t < 28 && this.r() < L.combo) {
        if (dist > tReach - 2) out |= toward;
        else if (faceOk && this.r() < L.combo * 0.5) press(IN.A | IN.B);
        else hitBtn(IN.A);
        return finish();
      }
      // 묶인 상대 때리기: 탄·끌어당김에 맞아 경직 중이면 달려가서 콤보
      if (o.st === "hit" && o.stun > 8 && aligned && this.r() < L.combo) {
        if (dist > lReach - 4) out |= toward;
        else hitBtn(o.stun > 16 ? IN.B : IN.A);
        return finish();
      }
      // 헛침 벌주기: 상대가 기술 뒷동작(회복)인데 내 사거리 안
      if (om && !o.hit && o.t >= om.startup + om.active && aligned && noticed(this.sawAtk)) {
        const left = om.startup + om.active + om.recovery - o.t;
        if (left >= 4 && dist < hReach && this.r() < L.combo) {
          hitBtn(dist < lReach && left < 9 ? IN.A : IN.B);
          return finish();
        }
      }
      // 잡기: 상대가 가드로 버티면 (가까이) — 막는 경직 중엔 안 잡히니 경직이 풀린 뒤에
      if (o.st === "block" && o.stun === 0 && dist < tReach && faceOk && this.r() < L.aggro * 0.15) {
        press(IN.A | IN.B);
        return finish();
      }
      // 돌진 잡기: 조금 떨어져서 가드로 버티는 상대 (게이지 25) — 톡·떼고·톡으로 대시한 뒤 약+발차기
      if (
        o.st === "block" &&
        f.meter >= 25 &&
        free &&
        aligned &&
        dist > tReach + 10 &&
        dist < 150 &&
        this.r() < L.aggro * L.combo * 0.06 &&
        platBelow(map, o.x, f.h)?.y === platBelow(map, f.x, f.h)?.y
      ) {
        this.dashSeq = [toward, 0, 0, 0, toward, toward, toward | IN.A | IN.B, toward];
        return finish();
      }
      // 필살기: 상대가 빈틈이 크거나 가까우면
      const sx = c.moves.X.box;
      // (돌진 필살기 — 제나 뇌섬일창 · 카이 천풍난무 — 는 돌진 거리까지)
      const rx = c.moves.X.rush;
      const ultReach = c.moves.X.summon || c.moves.X.proj ? 400 : sx.x + sx.w + 8 + (rx ? Math.trunc((rx.vx * c.moves.X.active) / SUB) : 0);
      // 허공에 쓰지 않게: 지금 쓰면 맞는지(막혀도 X) 미리 돌려 보고 씀 — 반응 시간 전에 본 상대 공격은 아직 모르는 걸로
      if (f.meter >= 100 && dist < ultReach && ((om && noticed(this.sawAtk) && o.t < 10) || this.r() < 0.02) && this.ultHits(s, me, toward)) {
        out |= toward;
        press(IN.X);
        return finish();
      }
    }

    // ── 높이 맞추기: 위로 점프 / 아래로 내려가기 ──
    // 위 상대 손 닿는 거리: 평타 · 공중 아이덴티티가 곧 준비되면 그것까지 (뛰어오르는 나를 공중에서 받아침)
    const oUpReach = Math.max(oReach, o.cd < 30 ? Math.min(airReachOf(oc), 200) : 0);
    if (free && !air) {
      // 한 번에 못 올라가는 높이(2단 점프로 약 228px)면 중간 발판을 거쳐 감
      if (dy > 50 && !isAir(s, o) && !this.climb) {
        const tp = platBelow(map, o.x, o.h);
        const myY = f.h / SUB;
        const here = platBelow(map, f.x, f.h);
        if (tp && tp.y - myY > 205) {
          let best: Plat | null = null;
          let bs = -Infinity;
          for (const p of map.plats) {
            if (p === here || p.y <= myY + 30 || p.y - myY > 205) continue;
            const px = Math.max(p.x0, Math.min(p.x1, f.x / SUB));
            const tx = Math.max(p.x0, Math.min(p.x1, o.x / SUB));
            // 높을수록, 상대 쪽일수록, 지금 자리에서 가까울수록
            // 거쳐 갈 발판에 내려앉는 자리가 위 상대 손 닿는 곳이면 피함 (거기로 뛰어오르다 맞고 떨어짐)
            const land = Math.max(p.x0 + 18, Math.min(p.x1 - 18, f.x / SUB));
            // (공중 아이덴티티가 곧 준비되면 그 거리까지 — 뛰어내리며 받아침, 10.13)
            const risky = p.y > o.h / SUB - 150 && Math.abs(land - o.x / SUB) < oUpReach + 45;
            const sc = p.y * 2 - Math.abs(tx - o.x / SUB) * 0.6 - Math.abs(px - f.x / SUB) * 0.4 - (risky ? 400 : 0);
            if (sc > bs) ((bs = sc), (best = p));
          }
          if (best) {
            this.climb = best;
            this.climbUntil = s.f + 240;
            return finish();
          }
        }
      }
      if (dy > 50 && dist < 300 && !isAir(s, o)) {
        // 바로 밑에서(또는 비스듬히 상대 쪽으로) 뛰어오르면 위에서 기다리던 상대에게 맞고 떨어짐 →
        //  · 상대 손이 안 닿는 쪽 가장자리에 내려앉게 올라가거나
        //  · 그럴 자리가 없으면 손 닿는 거리 밖에서 기다렸다가 상대가 헛치거나 맞은 틈(빈틈)에 올라감
        //    (시간이 없고 지고 있으면 그냥 올라감 · 위에서 맞을수록(upHits) 더 기다림)
        // 낮은 단계는 가끔만 이렇게 생각함 (올라갈 때마다 정함)
        if (this.upSmart === null) this.upSmart = this.r() < 0.25 + L.antiAir * 0.75;
        const tp = platBelow(map, o.x, o.h);
        const here = platBelow(map, f.x, f.h);
        const oBusy = (o.st === "atk" && o.t > 3) || o.st === "hit" || o.st === "down" || o.st === "rise" || o.trapT > 0 || o.grabbed > 0;
        const danger = oUpReach + 45;
        const hurry = s.timer < 25 * 60 && f.hp / c.hp <= o.hp / oc.hp;
        if (tp && here && this.upSmart && !oBusy && !hurry) {
          let ex: number | null = null;
          let far = 0;
          for (const cx of [tp.x0 + 22, tp.x1 - 22]) {
            const d = Math.abs(cx - o.x / SUB);
            // 뛰어오를 자리: 내 발판 위에서 그 가장자리에 가장 가까운 곳 (공중에서 90px 까지는 옆으로 감)
            const tx = Math.max(here.x0 + 10, Math.min(here.x1 - 10, cx));
            if (d > danger + 25 && d > far && Math.abs(tx - cx) < 90 && Math.abs(tx - o.x / SUB) > danger) ((far = d), (ex = cx));
          }
          if (ex !== null) {
            this.entry = ex;
            this.entryUntil = s.f + 150;
            return finish();
          }
          // 돌아갈 자리가 없음: 손 닿는 거리 밖에서 기다림 (탄이 있으면 쏨).
          // 가끔 제자리 낮은 점프로 떠봄(bait) — 위에서 헛치면 그 빈틈에 2단 점프로 올라감 (공중 처리는 아래)
          if (dist < danger + 20) out |= away;
          else if (dist > danger + 60) out |= toward;
          else if (this.r() < 0.012 + L.aggro * 0.012) {
            this.bait = true;
            press(IN.J);
          }
          if (f.cd === 0 && (c.moves.S.proj || c.moves.S.summon) && this.r() < 0.03 + L.special * 2) press(IN.C);
          return finish();
        }
        if (this.r() < (this.upSmart ? 0.8 : 0.5)) {
          out |= dist > 30 ? toward : 0;
          press(IN.J);
          return finish();
        }
      }
      if (dy < -50 && dist < 300) {
        // 아래에 있는 상대: 발판 끝으로 걸어 내려감 (하단 점프 없음)
        const on = platBelow(map, f.x, f.h);
        if (on && !on.solid) {
          const toL = f.x - on.x0 * SUB,
            toR = on.x1 * SUB - f.x;
          // 상대 쪽 가장자리로 계속 걸어서 떨어짐 (예전엔 가장자리 6px 안에 오면 반대로 돌아서 → 끝에서 좌우로 왔다 갔다,
          // 방향키를 번갈아 톡톡 눌러 대시까지 나가던 것)
          const side = Math.abs(o.x - on.x0 * SUB) < Math.abs(o.x - on.x1 * SUB) ? -1 : 1;
          void toL, toR;
          out |= side > 0 ? IN.R : IN.L;
          return finish();
        }
      }
    }
    // 떠보기 점프: 위의 상대가 헛치고 있으면(빈틈) 2단 점프로 올라가고, 아니면 그대로 내려옴
    if (!air || f.st === "hit") this.bait = false;
    if (this.bait && f.st === "jump") {
      const oOpen = (o.st === "atk" && o.t > 3 && !o.hit) || o.st === "hit" || o.st === "down";
      if (oOpen && f.jumps < 2) {
        this.bait = false;
        out |= toward;
        press(IN.J);
      }
      return finish();
    }
    // 공중끼리: 가까우면 빠른 공중 약으로 먼저 침 (10.13 — 공중에서 마주치면 가만히 맞던 것)
    if (f.st === "jump" && isAir(s, o) && o.st !== "hit" && dist < 64 && dy > -45 && dy < 55 && f.airUsed < 4 && this.r() < 0.3 + L.antiAir * 0.6) {
      out |= toward;
      press(IN.A);
      return finish();
    }
    // (높은 발판 위 상대에게 2단 점프로 올라감 — 상대가 그냥 공중에 떠서 치고 있으면 쫓아 올라가다 맞기만 함)
    if (f.st === "jump" && dy > 70 && f.vh < 200 && f.jumps < 2 && !(isAir(s, o) && o.st === "atk")) {
      out |= this.entry !== null ? (this.entry * SUB > f.x ? IN.R : IN.L) : toward;
      press(IN.J);
      return finish();
    }
    // 공중 뇌격돌(제나): 비슷한 높이 · 돌진 거리 안의 상대에게 파고들며 찌름 (단계가 높을수록 자주)
    const ar = c.moves.S.air?.rush;
    if (
      f.st === "jump" && f.cd === 0 && ar && ar.airVh === 0 && !ar.landBurst && dist > 30 && dist < 190 && Math.abs(dy) < 34 && o.st !== "down" &&
      (f.jumps < 2 || !!platBelow(map, f.x + (o.x > f.x ? 1 : -1) * 190 * SUB, f.h)) && this.r() < 0.02 + L.aggro * 0.05
    ) {
      out |= toward;
      if ((f.face > 0) === (o.x > f.x)) press(IN.C);
      return finish();
    }
    // 공중 아이덴티티로 자리 바꾸기 (건모 Alt+Tab): 상대 위에서 내려오는 중이면 가끔
    if (f.st === "jump" && f.cd === 0 && c.moves.S.air?.swap && dist < 50 && dy < -10 && dy > -70 && this.r() < L.aggro * 0.2) {
      out |= toward;
      press(IN.C);
      return finish();
    }
    // 공중 잡기(이반 곰 포옹): 가까이 있으면 막든 말든 붙잡음
    if (f.st === "jump" && f.cd === 0 && c.moves.S.air?.hug && dist < 34 && dy > -50 && dy < 40 && o.st !== "down" && this.r() < 0.25 + L.aggro * 0.5) {
      out |= toward;
      press(IN.C);
      return finish();
    }
    // 공중 공격: 내려오면서 상대 위에 있으면
    if (f.st === "jump" && dist < 40 && dy < 0 && dy > -70 && f.vh < 0 && this.r() < L.aggro) {
      hitBtn(this.r() < 0.5 ? IN.A : IN.B);
      return finish();
    }

    // ── 행동 정하기 (몇 프레임씩 유지) ──
    if (--this.hold <= 0 || (!free && !blocking && f.st !== "jump")) {
      this.decide(s, me, dist, lReach, hReach, oReach);
    }
    switch (this.intent) {
      case "approach": {
        // 리치형은 상대 사거리 밖(내 사거리 안)까지만 다가감
        const stopAt = hReach > oReach + 10 ? Math.max(oReach + 6, hReach - 10) : 0;
        if (dist > stopAt) out |= toward;
        else if (free && aligned && this.r() < 0.3 + L.aggro * 0.3) hitBtn(dist < lReach ? IN.A : IN.B);
        if (free && !air && dist > 200 && this.r() < 0.05 + L.aggro * 0.05 && platBelow(map, f.x + (toward === IN.R ? 220 : -220) * SUB, f.h)?.y === platBelow(map, f.x, f.h)?.y)
          this.dashSeq = [0, toward, toward, toward];
        if (dist < lReach && free && aligned && this.r() < L.aggro * 0.2) hitBtn(IN.A);
        break;
      }
      case "retreat": {
        out |= away;
        // 물러나다 따라붙으면 돌아서서 찌름
        const closing = (o.st === "walk" || o.st === "dash") && Math.sign(o.vx) === Math.sign(f.x - o.x);
        if (free && aligned && closing && dist < lReach + 2 && this.r() < L.combo) {
          out &= ~(IN.L | IN.R);
          hitBtn(IN.A);
        }
        break;
      }
      case "space": {
        // 발 재기(풋시): 내 평타는 닿고 상대 평타는 안 닿는 거리를 유지, 들어오면 찌름
        // (내 발차기가 닿는 거리 안쪽으로 — 예전엔 닿지 않는 거리에서 멈춰 서서, 가만히 있는 상대를 영영 안 때렸음)
        // 상대가 오래 가만히 있으면 약이 닿는 거리까지 들어감
        const ideal = passive ? lReach - 6 : Math.min(Math.max(oReach + 6, hReach - 6), hReach - 4);
        const closing = (o.st === "walk" || o.st === "dash" || (o.st === "jump" && Math.abs(o.vx) > 300)) && Math.sign(o.vx) === Math.sign(f.x - o.x);
        if (dist > Math.min(ideal + 14, hReach - 2)) out |= toward;
        else if (dist < ideal - 10) out |= away;
        if (free && aligned) {
          // 들어오는 상대는 바로 찌름 (대시는 특히), 가만히 있으면 가끔 찔러 봄. 등 돌리고 있으면 먼저 돌아섬
          const want = closing ? L.combo : passive ? 0.25 + L.aggro * 0.3 : 0.12 + L.aggro * 0.15;
          if (dist < lReach + 4 && this.r() < want) {
            out &= ~(IN.L | IN.R);
            hitBtn(IN.A);
          } else if (dist < hReach && dist > lReach - 6 && this.r() < want * 0.8) {
            out &= ~(IN.L | IN.R);
            hitBtn(IN.B);
          }
        }
        break;
      }
      case "jumpIn":
        if (free) {
          out |= toward;
          // 상대가 공중 아이덴티티(건모 Alt+Tab · 제나 뇌격돌 · 소영 채찍 …)를 쓸 수 있으면 그 손 닿는 거리 안으로는 잘 안 뛰어듦
          // — 뛰어들다 공중에서 받아치기 당하기만 함 (10.13). 가끔은 섞음
          const oAA = o.cd < 30 && dist < airReachOf(oc) + 70 && this.r() > 0.05;
          if (this.r() < 0.2 && !(isAir(s, o) && dist < 160) && !oAA) press(IN.J);
        } else if (f.st === "jump" && dist < 50 && dy < 10) {
          out |= toward;
          press(IN.B);
        }
        break;
      case "poke":
        if (dist > hReach) out |= toward;
        else if (free && aligned) hitBtn(IN.B);
        break;
      case "jab":
        if (dist > lReach) out |= toward;
        else if (free && aligned) hitBtn(IN.A);
        break;
      case "throw":
        if (dist > tReach) out |= toward;
        else if (free && aligned && faceOk) press(IN.A | IN.B);
        break;
      case "fireball":
        // 탄이 아닌 아이덴티티(돌진·채찍)는 닿는 거리에서만
        if (dist > idReach) out |= toward;
        else if (free && aligned && f.cd === 0) hitBtn(IN.C);
        break;
      case "block":
        if (free && !air) out = IN.D;
        break;
      default:
        break;
    }
    if (free && aligned && dist > 120 && dist < idReach && faceOk && this.r() < L.special && f.cd === 0)
      press(IN.C);
    // 우산 활강: 점프를 다 쓴 뒤 내려올 때 (토글하면 2단 점프가 돼 버리니 꾹 누름)
    if (c.glide && f.st === "jump" && f.vh < 0 && f.jumps >= 2 && dist > 60) out |= IN.J;
    // 기술 중엔 뒤로 누르지 않음 (방향키 우선이라 누르면 돌아섬)
    if (f.st === "atk" && !air) out &= ~away;
    // 건너가기로 했으면 끝까지 걸어가서 (멀리 뛰려고) 가장자리에서 점프 (대시가 나갔으면 대시 점프)
    if (!air && this.crossTo && (free || f.st === "dash")) {
      const t = this.crossTo;
      const dir = (t.x0 + t.x1) / 2 > f.x / SUB ? 1 : -1;
      out = (out & ~(IN.L | IN.R)) | (dir > 0 ? IN.R : IN.L);
      if (!platBelow(map, f.x + dir * (f.st === "dash" ? 24 : 10) * SUB, f.h)) press(IN.J);
      return finish();
    }
    // 걷다가 낭떠러지면 멈춤 (아래에 발판이 없으면) — 상대가 건너편 발판에 있으면 가끔 뛰어서 건넘
    if (!air && (out & (IN.L | IN.R))) {
      const dir = out & IN.R ? 1 : -1;
      const ax = f.x + dir * 24 * SUB;
      if (!platBelow(map, ax, f.h)) {
        out &= ~(IN.L | IN.R);
        const there = !isAir(s, o) ? platBelow(map, o.x, o.h) : null;
        if (free && there && there !== platBelow(map, f.x, f.h) && (dir > 0) === (o.x > f.x) && this.r() < 0.08 + L.aggro * 0.1) {
          this.crossTo = there;
          out |= dir > 0 ? IN.R : IN.L;
        }
      }
    }
    return finish();
  }

  /**
   * 읽기: 상대 버릇 세기 — 일어날 때 · 내 공격을 막은 뒤 처음 한 행동, 가까이서 잡기/타격 비율,
   * 내 잡기를 푸는 비율, 중거리 점프 빈도. 상황이 시작되는 순간 그 버릇으로 미리 대응을 정함.
   */
  private observe(s: State, me: 0 | 1, dist: number) {
    const f = s.p[me];
    const o = s.p[1 - me];
    const ps = this.po;
    const L = this.level;
    const rd = L.read ?? 0;
    const oc = CHARS[o.ch];
    const oReach = Math.max(reachOf(oc.moves.L), reachOf(oc.moves.H));
    const oAir = isAir(s, o);
    // 상황 시작: 일어남 / 내 공격을 막는 경직이 풀림
    if (ps.st === "rise" && o.st !== "rise") this.watch = { h: this.wake, until: s.f + 20 };
    else if (ps.st === "block" && ps.stun > 0 && o.stun === 0 && dist < 130) {
      this.watch = { h: this.afterBlk, until: s.f + 16 };
      // 막힌 뒤 내 다음 수: 상대가 막고 나서 잘 때리면 가드, 가만히(가드 · 기다림)면 잡기(잘 풀면 약으로 끊어 치기)
      if (rd > 0 && this.r() < rd) {
        const h = this.afterBlk;
        const pA = h.p("atk") + h.p("throw") * 0.5,
          pS = h.p("block") + h.p("wait");
        const techR = this.oTechs / this.myGrabs;
        const x = this.r() * (pA + pS + 0.15);
        this.after = x < pA ? "guard" : x < pA + pS * (1 - Math.min(0.8, techR)) ? "throw" : "jab";
        this.afterUntil = s.f + 24;
      }
    }
    if (this.watch) {
      let a: Act | null = null;
      if (o.st === "atk") a = o.mv === "T" ? "throw" : "atk";
      else if (o.st === "jump" || (oAir && o.st !== "hit")) a = "jump";
      else if (o.st === "block" && o.stun === 0) a = "block";
      if (o.st === "hit" || o.st === "down" || o.grabbed > 0) this.watch = null;
      else if (a) {
        this.watch.h.add(a);
        this.watch = null;
      } else if (s.f >= this.watch.until) {
        this.watch.h.add("wait");
        this.watch = null;
      }
    }
    // 가까이서 잡기 / 타격
    if (ps.st !== "atk" && o.st === "atk" && dist < 80) {
      this.oThrows *= 0.95;
      this.oStrikes *= 0.95;
      if (o.mv === "T") this.oThrows++;
      else if (o.mv !== "J") this.oStrikes++;
    }
    for (const e of s.ev) {
      if (e.k === "throw" && e.p === me && e.m !== "S") this.myGrabs++;
      if (e.k === "tech" && e.p === 1 - me) this.oTechs++;
    }
    // 중거리 점프
    if (dist > 50 && dist < 220) {
      if (!oAir) this.midT++;
      if (ps.st !== "jump" && o.st === "jump") this.oJumps++;
    }
    // 미리 가드 놓친 건 풀기 (멀어지면)
    if (this.guardUntil >= s.f && dist > oReach + 40) this.guardUntil = -1;
    if (this.afterUntil < s.f) this.after = null;
    if (o.st !== "down" && o.st !== "rise" && o.t > 2) this.oki = null;
    // 중립 버릇: 가까울 때 10프레임마다 상대가 처음 한 행동
    const fr = s.p[me];
    const neutral = dist < oReach + 50 && o.st !== "hit" && o.st !== "down" && o.st !== "rise" && fr.st !== "hit" && fr.st !== "down";
    if (neutral) {
      const nw = this.nearWin;
      if (nw.until < s.f) {
        if (nw.until >= 0) this.near.add(nw.act ?? "wait");
        nw.until = s.f + 10;
        nw.act = null;
      }
      if (!nw.act) {
        if (ps.st !== "atk" && o.st === "atk") nw.act = o.mv === "T" ? "throw" : "atk";
        else if (ps.st !== "jump" && o.st === "jump") nw.act = "jump";
        else if (o.st === "block" && o.stun === 0) nw.act = "block";
      }
    } else this.nearWin.until = -1;
    // 가까이(상대 손 닿는 거리)에서 상대가 때리는 빈도 (프레임당, 천천히 따라감)
    if (dist < oReach + 12 && !oAir) {
      const started = ps.st !== "atk" && o.st === "atk" && o.mv !== "T" && o.mv !== "J";
      this.closeAtk = this.closeAtk * 0.992 + (started ? 0.008 : 0);
    }
    ps.st = o.st;
    ps.stun = o.stun;
  }

  /** 땅에서 높이가 다른 상대에게: 점프 → (2단 점프) → 공격 타이밍 여러 가지, 바깥에서 올라갔다 공중 대시로 파고들기 */
  private vertCands(toward: number, away: number): number[][] {
    const out: number[][] = [];
    const rep = (n: number, x: number) => Array.from({ length: n }, () => x);
    for (const d of [toward, 0, away])
      for (const j2 of [8, 14])
        for (const atk of [IN.A, IN.B])
          for (const at of [4, 10]) out.push([IN.J | d, ...rep(j2, d), IN.J | d, ...rep(at, d), atk | d, d]);
    // 올라가서 공중 대시(톡·떼고·톡)로 파고들며 발차기
    for (const j2 of [8, 14]) out.push([IN.J, ...rep(j2, 0), IN.J, 0, 0, 0, 0, toward, 0, toward, toward, IN.B | toward, toward]);
    return out;
  }

  /** 공중에서: 지금 · 조금 뒤 공격, 2단 점프 뒤 공격, 공중 대시로 파고들기, 아이덴티티, 물러나기 */
  private airCands(toward: number, away: number, f: Fighter): number[][] {
    const out: number[][] = [];
    const rep = (n: number, x: number) => Array.from({ length: n }, () => x);
    for (const d of [toward, 0, away]) {
      out.push(rep(4, d));
      for (const atk of [IN.A, IN.B]) for (const at of [0, 3, 6, 10]) out.push([...rep(at, d), atk | d, d]);
    }
    if (f.jumps < 2) for (const atk of [IN.A, IN.B]) for (const at of [3, 8]) out.push([IN.J | toward, ...rep(at, toward), atk | toward, toward]);
    if (!f.airDash) for (const atk of [IN.A, IN.B]) out.push([0, toward, 0, toward, toward, atk | toward, toward]);
    if (f.cd === 0) out.push([IN.C | toward, toward]);
    return out;
  }

  /** 지금 필살기를 쓰면 상대가 맞나 (상대는 지금 누르는 방향을 그대로 유지한다고 봄) — 허공에 쓰는 것 막기 */
  private ultHits(s: State, me: 0 | 1, dir: number) {
    const t = clone(s);
    const o = t.p[1 - me];
    const held = (o.hist[o.hist.length - 1] & (IN.L | IN.R | IN.D)) | (o.st === "block" ? IN.D : 0);
    for (let k = 0; k < 110; k++) {
      step(t, me === 0 ? [k === 0 ? IN.X | dir : 0, held] : [held, k === 0 ? IN.X | dir : 0]);
      const d = t.p[1 - me];
      const f = t.p[me];
      // 맞혀도 내가 낭떠러지로 날아가 버리면 안 씀 (제나 뇌섬일창처럼 멀리 꿰뚫는 기술)
      if (d.st === "hit" || d.st === "down" || d.grabbed > 0) return !this.offStage(t, me, k);
      if (k > 4 && (f.st !== "atk" || f.mv !== "X") && !t.proj.some((p) => p.o === me)) return false;
      if (t.phase !== "fight") return false;
    }
    return false;
  }

  /** 돌진기를 끝까지 돌려 봤을 때 내 발밑에 발판이 없나 (k 프레임 돌린 상태에서 남은 동작까지) */
  private offStage(t: State, me: 0 | 1, k: number) {
    const u = clone(t);
    for (let j = k; j < 110; j++) {
      const f = u.p[me];
      if (f.st !== "atk") break;
      step(u, me === 0 ? [0, 0] : [0, 0]);
    }
    const f = u.p[me];
    return !platBelow(mapOf(u), f.x, f.h + 4 * SUB);
  }

  /** 상대가 중거리에서 뛰는 빈도 0~1 (10초에 3번 이상이면 1) */
  private jumpy() {
    return Math.min(1, ((this.oJumps / this.midT) * 600) / 3);
  }

  /**
   * 후보 입력열을 각각 W프레임 돌려 보고 손익이 가장 좋은 걸 돌려줌.
   * weighted 가 없으면(반응): 상대 대응 몇 가지 중 최악 · 평균으로 매김.
   * weighted 가 있으면(읽기): 상대가 이 상황에서 하던 행동 비율대로 기대값으로 매김 → 노림수 (상대가 잘 하는 걸 잡아먹는 수)
   */
  private lookAhead(
    s: State,
    me: 0 | 1,
    W: number,
    faceOk: boolean,
    toward: number,
    away: number,
    weighted?: [Act, number][],
    extra?: number[][],
    only = false
  ): { seq: number[]; v: number } | null {
    const f = s.p[me];
    const o = s.p[1 - me];
    const held = (o.hist[o.hist.length - 1] & (IN.L | IN.R | IN.D)) | (o.st === "block" ? IN.D : 0);
    const seq = (first: number[], rest: number) => {
      const a = first.slice();
      while (a.length < W) a.push(rest);
      return a;
    };
    const cands: number[][] = only ? [] : [seq([], IN.D), seq([], 0), seq([], away), seq([IN.J | away], away), seq([IN.J | toward], toward)];
    if (extra) for (const e of extra) cands.push(seq(e, e[e.length - 1] & (IN.L | IN.R | IN.D)));
    if (faceOk && !only) {
      for (const b of [IN.A, IN.B, IN.C, IN.A | IN.B]) cands.push(seq([b, 0, 0], IN.D));
      if (f.meter >= 100 && this.ultHits(s, me, 0)) cands.push(seq([IN.X, 0, 0], IN.D));
      if (f.st === "block" && f.stun > 0 && f.meter >= 25) cands.push(seq([IN.D | IN.B, IN.D, IN.D], IN.D));
      cands.push(seq([0, toward, toward, IN.B], IN.D));
      if (weighted) {
        // 노림수: 한 박자 늦춘 공격 (상대 헛침 · 버튼 누르기를 기다렸다 때림), 다가가 잡기, 물러났다 찌르기
        cands.push(seq([IN.D, IN.D, IN.D, IN.D, IN.D, IN.D, IN.B], IN.D));
        cands.push(seq([away, away, away, away, 0, IN.B], IN.D));
        cands.push(seq([toward, toward, IN.A | IN.B], IN.D));
        cands.push(seq([0, 0, 0, IN.A], IN.D));
      }
    }
    // 상대가 공중 아이덴티티를 쓸 수 있고 그 거리 안이면 뛰는 수는 빼고 봄 — 상대 대응 모형에 '뛰어서 공중 L' 이 없어서
    // 내다보기가 점프를 좋게 보고 뛰었다가 공중에서 받아치기 당하던 것 (10.13). 가끔은 그대로 섞음
    if (o.cd < 30 && Math.abs(o.x - f.x) / SUB < airReachOf(CHARS[o.ch]) + 70 && this.r() > 0.05) {
      const nj = cands.filter((c) => !c.some((x) => x & IN.J));
      if (nj.length) cands.splice(0, cands.length, ...nj);
    }
    const oTo = o.x < f.x ? IN.R : IN.L;
    // 상대 대응: [첫 2프레임 뒤 누를 입력, 무게]
    const actIn: Record<Act, number> = { wait: held, block: IN.D, atk: IN.A, jump: IN.J | oTo, throw: IN.A | IN.B };
    const replies: [number, number][] = weighted
      ? weighted.filter((x) => x[1] > 0.04).map(([a, w]) => [actIn[a], w])
      : [held, IN.D, IN.A, IN.J | oTo, IN.B].slice(0, Math.max(1, this.level.robust ?? 1)).map((x) => [x, 1]);
    // 읽기에선 상대 공격은 약 · 발차기 반반으로 봄
    if (weighted) {
      const ai = replies.findIndex((r) => r[0] === IN.A);
      if (ai >= 0) {
        replies[ai][1] /= 2;
        replies.push([IN.B, replies[ai][1]]);
      }
    }
    let best: number[] | null = null;
    let bestV = -Infinity;
    for (const c of cands) {
      let worst = Infinity,
        sum = 0,
        wsum = 0;
      for (let ri = 0; ri < replies.length; ri++) {
        const [rep, wt] = replies[ri];
        const t = clone(s);
        const my0 = t.p[me].hp,
          op0 = t.p[1 - me].hp;
        for (let k = 0; k < W; k++) {
          // 상대 대응: 반응 모드 0번은 지금 누르는 그대로, 나머지는 2프레임 뒤부터 그 버튼(누르는 건 한 번만, 그다음은 방향만)
          // 읽기에선 상대가 때리는 버릇이면 연타로 봄 (7프레임마다 다시 누름)
          const mash = weighted && rep === IN.A && k > 2 && (k - 2) % 7 === 0;
          const oi = (!weighted && ri === 0) || k < 2 ? held : k === 2 || mash ? rep : rep & (IN.L | IN.R | IN.D);
          step(t, me === 0 ? [c[k], oi] : [oi, c[k]]);
          if (t.phase !== "fight") break;
        }
        const dealt = op0 - t.p[1 - me].hp,
          took = my0 - t.p[me].hp;
        let v = dealt - took * 1.3;
        // 맞았거나 넘어진 채 끝나면 감점, 상대가 경직 중이면 가점 (이어 갈 수 있음)
        if (t.p[me].st === "hit" || t.p[me].st === "down") v -= 40;
        // 발밑에 발판이 없는 곳에서 끝나면 크게 감점 (돌진으로 낭떠러지 넘어가기)
        if (!platBelow(mapOf(t), t.p[me].x, t.p[me].h + 4 * SUB) && t.p[me].jumps >= 2) v -= 80;
        if (t.p[1 - me].st === "hit" || t.p[1 - me].st === "down") v += 20;
        worst = Math.min(worst, v);
        sum += v * wt;
        wsum += wt;
      }
      const avg = sum / wsum;
      const v = weighted ? avg * (1 - K.worst) + worst * K.worst : replies.length > 1 ? worst * 0.6 + avg * 0.4 : worst;
      if (v > bestV + 0.5) ((bestV = v), (best = c));
    }
    return best ? { seq: best, v: bestV } : null;
  }

  private decide(s: State, me: 0 | 1, dist: number, lReach: number, hReach: number, oReach: number) {
    const L = this.level;
    const r = this.r();
    const f: Fighter = s.p[me];
    const o: Fighter = s.p[1 - me];
    const c = CHARS[f.ch];
    this.hold = 8 + Math.floor(this.r() * 18);
    const lowHp = f.hp < c.hp * 0.25;
    // 사거리 우위가 있으면 발 재기를 선호 (리치형)
    const longer = hReach > oReach + 10;
    const zoner = !!c.moves.S.proj;
    // 상대가 오래 가만히 있으면 다가가서 때림 (발 재기·대기로 서로 멈춰 있지 않게)
    if (this.oStill > 90 && r < 0.45 + L.aggro * 0.45) {
      this.intent = dist > 55 ? "approach" : r < 0.3 ? "throw" : "jab";
      return;
    }
    if (dist > 120) {
      if (zoner && r < 0.35 && f.cd === 0) this.intent = "fireball";
      else if (longer && r < 0.7) this.intent = "space";
      else
        this.intent =
          r < 0.55 + L.aggro * 0.3 ? "approach" : r < 0.8 ? "fireball" : r < 0.9 ? "jumpIn" : "wait";
    } else if (dist > 55) {
      if (longer && r < 0.6 + L.combo * 0.25) this.intent = "space";
      else if (longer && r < 0.8 && f.cd === 0) this.intent = "fireball";
      else if (r < L.aggro * 0.35) this.intent = "poke";
      else if (r < L.aggro * 0.6) this.intent = "jumpIn";
      else if (r < 0.75) this.intent = "approach";
      else if (r < 0.85) this.intent = "fireball";
      else this.intent = lowHp ? "retreat" : "wait";
    } else {
      if (o.st === "atk" && o.t > 6)
        this.intent = "jab"; // 상대 빈틈
      else if (o.st === "block" && r < L.aggro * 0.5) this.intent = "throw";
      else if (longer && r < 0.45) this.intent = "retreat"; // 리치형은 붙으면 떨어짐
      else if (longer && r < 0.6) this.intent = "jab";
      else if (r < L.aggro * 0.7) this.intent = "jab";
      else if (r < L.aggro) this.intent = "poke";
      else if (r < L.aggro + 0.15) this.intent = "block";
      else if (r < L.aggro + 0.3) this.intent = "retreat";
      else this.intent = "wait";
      this.hold = 4 + Math.floor(this.r() * 10);
    }
    void lReach;
  }
}
