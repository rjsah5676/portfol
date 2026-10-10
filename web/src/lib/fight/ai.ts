/**
 * 격투게임 AI — 매 프레임 상태를 보고 "사람처럼" 입력을 만들어 냄.
 * 반응 속도(몇 프레임 뒤에 알아채나), 가드·대공·콤보 확률로 단계를 나눔.
 * 오프라인 전용이라 결정론일 필요는 없지만, 같은 시드면 같은 행동을 하도록 자체 난수를 씀.
 */
import { CHARS, SUB, type MoveDef } from "./chars";
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
  /** 내다볼 때 상대의 대응(가만히·가드·약·점프)을 이만큼 같이 돌려 보고 가장 나쁜 경우로 값을 매김 (1이면 지금 입력 그대로만) */
  robust?: number;
}

export const AI_LEVELS: AILevel[] = [
  {
    id: "1",
    name: "입문",
    react: 30,
    block: 0.05,
    combo: 0,
    antiAir: 0.05,
    aggro: 0.25,
    special: 0.004,
  },
  {
    id: "2",
    name: "초급",
    react: 22,
    block: 0.2,
    combo: 0.2,
    antiAir: 0.15,
    aggro: 0.35,
    special: 0.006,
  },
  {
    id: "3",
    name: "중급",
    react: 16,
    block: 0.42,
    combo: 0.45,
    antiAir: 0.35,
    aggro: 0.45,
    special: 0.008,
  },
  {
    id: "4",
    name: "상급",
    react: 12,
    block: 0.6,
    combo: 0.7,
    antiAir: 0.55,
    aggro: 0.55,
    special: 0.01,
  },
  {
    id: "5",
    name: "고수",
    react: 9,
    block: 0.76,
    combo: 0.86,
    antiAir: 0.7,
    aggro: 0.6,
    special: 0.012,
  },
  {
    id: "6",
    name: "달인",
    react: 4,
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
    react: 1,
    block: 1,
    combo: 1,
    antiAir: 1,
    aggro: 0.8,
    special: 0.025,
    tech: 1,
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
  { ...AI_LEVELS[6], id: "8", name: "전설", rating: 2200, aggro: 0.84, just: 0.95, interrupt: 0.9, robust: 3 },
  { ...AI_LEVELS[6], id: "9", name: "신화", rating: 2400, aggro: 0.87, just: 1, interrupt: 0.95, robust: 4, look: 32 },
  { ...AI_LEVELS[6], id: "10", name: "초월", rating: 2600, aggro: 0.9, just: 1, interrupt: 1, robust: 5, look: 32 },
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
  kai: [-42, -46, -43, 400, 103, -24, -92],
  igna: [-75, -132, -194, -154, -10, -139, -216],
  soyoung: [42, -84, -194, -269, -58, 478, 579],
  lily: [50, 172, 281, 294, 30, -190, -25],
  zena: [-80, -140, -204, -326, 20, 66, 318],
  gunmo: [142, 346, 572, 400, 28, -100, -425],
  ivan: [-80, -174, -208, 28, -19, -80, -120],
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
  tech: l.tech ?? l.block * 0.8,
  just: l.just ?? l.combo * 0.6,
  interrupt: l.interrupt ?? 0,
  route: l.route ?? 0,
  robust: l.robust ?? 1,
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
const AI_REV = 5;
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

export class FightAI {
  private r: () => number;
  private intent: Intent = "wait";
  private hold = 0;
  private lastPress = 0;
  /** 상대가 공격을 시작한 걸 처음 본 프레임 */
  private sawAtk = -1;
  private sawJump = -1;
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
  /** 내다보고 고른 입력 (남은 프레임) */
  private plan: number[] = [];
  /** 대시 입력 (톡·떼고·톡) 남은 프레임 */
  private dashSeq: number[] = [];
  /** 낭떠러지 건너가는 중: 목표 발판 (2단 점프 + 공중 대시로) */
  private crossTo: Plat | null = null;
  /** 한 번 점프로 못 닿는 높은 발판의 상대에게 가려고 거쳐 가는 발판 (계단처럼) */
  private climb: Plat | null = null;
  private climbUntil = 0;
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

    // 버튼은 한 프레임 누르고 떼야 새로 눌린 걸로 침
    const press = (b: number) => {
      if (this.lastPress & b) return;
      out |= b;
    };
    const finish = () => {
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
      }
    }
    if (this.route) {
      const busy = o.st === "hit" || o.st === "down" || o.trapT > 0 || o.grabbed > 0;
      this.routeIdle = busy ? 0 : this.routeIdle + 1;
      // 콤보 길은 피해 ROUTE_CAP 까지만 (캐릭터마다 길이 달라 너무 아픈 길이 승률을 흔들지 않게) — 그다음은 원래 판단으로
      if (this.routeI >= this.route.r.length || this.routeIdle > 3 || this.routeHp - o.hp >= ROUTE_CAP) this.route = null;
      else {
        let a = this.route.r[this.routeI++];
        if (this.routeFlip) a = (a & ~(IN.L | IN.R)) | (a & IN.L ? IN.R : 0) | (a & IN.R ? IN.L : 0);
        out = a;
        this.lastPress = 0;
        // (입력을 그대로 내보냄 — finish 의 대시 보정 등은 거치지 않음)
        this.prevDir = a & (IN.L | IN.R);
        return a;
      }
    }
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
      if (this.techDecision === null) this.techDecision = this.r() < (L.tech ?? L.block * 0.8);
      if (this.techDecision) out = IN.A | IN.B;
      return finish();
    }
    this.techDecision = null;

    // 공중 대시 입력 (톡·떼고·톡): 3~14프레임 안에 두 번 눌러야 함
    const airDash = (dir: number) => {
      this.dashSeq = [0, dir, dir, 0, 0, dir, dir, dir];
      return finish();
    };
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
      if ((f.st === "idle" || f.st === "walk") && !air && dist < 60) {
        out |= toward;
        press(IN.J);
        return finish();
      }
      if (f.st === "jump" || (f.st === "atk" && f.hit && (f.mv === "J" || f.mv === "K"))) {
        out |= toward;
        // 공중 연속: 약 위주로 이어 치다 마지막은 발차기 (박자: 판정이 맞은 직후에 누름)
        if (dist < 48 && dy > -25 && dy < 70 && this.r() < 0.35 + L.combo * 0.6) {
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
        if (f.mv === "S" && (o.pulled || o.mark === 1)) press(this.r() < 0.5 ? IN.A | IN.B : IN.A);
        else if (f.mv === "L") press(f.chain < 4 && this.r() < 0.6 ? IN.A : IN.B);
        else if (f.mv === "H") {
          if (f.meter >= 100 && this.r() < 0.6) press(IN.X);
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

    // ── 내다보기 (지존): 상대가 기술을 쓰거나 빈틈이면 할 수 있는 행동을 다 돌려 보고 고름 ──
    if (L.look && (free || blocking) && !air && dist < 160 && Math.abs(dy) < 60) {
      const hot = oAtk || o.st === "hit" || o.st === "down" || (o.st === "atk" && !o.hit) || (incoming && projDist < 140) || oJumpIn;
      if (!hot) this.lookDecision = null;
      else if (this.lookDecision === null) this.lookDecision = this.r() < (L.lookP ?? 1);
      if (hot && this.lookDecision) {
        const best = this.lookAhead(s, me, L.look, faceOk, toward, away);
        if (best) {
          this.plan = best.slice(1, 6);
          out = best[0];
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
        if (this.aaDecision === null) this.aaDecision = this.r() < L.antiAir;
        if (this.aaDecision && dist < 50) {
          out |= toward;
          press(IN.B);
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
      const ultReach = c.moves.X.summon || c.moves.X.proj ? 400 : sx.x + sx.w + 8;
      if (f.meter >= 100 && aligned && dist < ultReach && ((om && o.t < 6) || this.r() < 0.02)) {
        out |= toward;
        press(IN.X);
        return finish();
      }
    }

    // ── 높이 맞추기: 위로 점프 / 아래로 내려가기 ──
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
            const sc = p.y * 2 - Math.abs(tx - o.x / SUB) * 0.6 - Math.abs(px - f.x / SUB) * 0.4;
            if (sc > bs) ((bs = sc), (best = p));
          }
          if (best) {
            this.climb = best;
            this.climbUntil = s.f + 240;
            return finish();
          }
        }
      }
      if (dy > 50 && dist < 260 && !isAir(s, o) && this.r() < 0.5) {
        out |= dist > 30 ? toward : 0;
        press(IN.J);
        return finish();
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
    if (f.st === "jump" && dy > 70 && f.vh < 200 && f.jumps < 2) {
      out |= toward;
      press(IN.J);
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
          if (this.r() < 0.2) press(IN.J);
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

  /** 후보 입력열을 각각 W프레임 돌려 보고 (상대는 지금 누른 방향만 유지) 손익이 가장 좋은 걸 돌려줌 */
  private lookAhead(s: State, me: 0 | 1, W: number, faceOk: boolean, toward: number, away: number): number[] | null {
    const f = s.p[me];
    const o = s.p[1 - me];
    const held = (o.hist[o.hist.length - 1] & (IN.L | IN.R | IN.D)) | (o.st === "block" ? IN.D : 0);
    const seq = (first: number[], rest: number) => {
      const a = first.slice();
      while (a.length < W) a.push(rest);
      return a;
    };
    const cands: number[][] = [seq([], IN.D), seq([], 0), seq([], away), seq([IN.J | away], away), seq([IN.J | toward], toward)];
    if (faceOk) {
      for (const b of [IN.A, IN.B, IN.C, IN.A | IN.B]) cands.push(seq([b, 0, 0], IN.D));
      if (f.meter >= 100) cands.push(seq([IN.X, 0, 0], IN.D));
      if (f.st === "block" && f.stun > 0 && f.meter >= 25) cands.push(seq([IN.D | IN.B, IN.D, IN.D], IN.D));
      cands.push(seq([0, toward, toward, IN.B], IN.D));
    }
    let best: number[] | null = null;
    let bestV = -Infinity;
    const oTo = o.x < f.x ? IN.R : IN.L;
    const replies = [held, IN.D, IN.A, IN.J | oTo, IN.B].slice(0, Math.max(1, this.level.robust ?? 1));
    for (const c of cands) {
      let worst = Infinity,
        sum = 0;
      for (let ri = 0; ri < replies.length; ri++) {
        const rep = replies[ri];
        const t = clone(s);
        const my0 = t.p[me].hp,
          op0 = t.p[1 - me].hp;
        let v = 0;
        for (let k = 0; k < W; k++) {
          // 상대 대응: 0번은 지금 누르는 그대로, 나머지는 2프레임 뒤부터 그 버튼(누르는 건 한 번만, 그다음은 방향만)
          const oi = ri === 0 || k < 2 ? held : k === 2 ? rep : rep & (IN.L | IN.R | IN.D);
          step(t, me === 0 ? [c[k], oi] : [oi, c[k]]);
          if (t.phase !== "fight") break;
        }
        const dealt = op0 - t.p[1 - me].hp,
          took = my0 - t.p[me].hp;
        v = dealt - took * 1.3;
        // 맞았거나 넘어진 채 끝나면 감점, 상대가 경직 중이면 가점 (이어 갈 수 있음)
        if (t.p[me].st === "hit" || t.p[me].st === "down") v -= 40;
        if (t.p[1 - me].st === "hit" || t.p[1 - me].st === "down") v += 20;
        worst = Math.min(worst, v);
        sum += v;
      }
      const v = replies.length > 1 ? worst * 0.6 + (sum / replies.length) * 0.4 : worst;
      if (v > bestV + 0.5) ((bestV = v), (best = c));
    }
    return best;
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
