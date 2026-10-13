/**
 * 픽셀 운빨 디펜스 — 영구 성장(판 밖) 정의. 시뮬 · 서버 · 화면이 같이 씀 (브라우저 전용 API 금지).
 *
 * 판에 들고 가는 것 = 로드아웃(Loadout): 유닛 레벨 · 연구(장착 4칸) · 유물(장착 3칸) · 오염 단계.
 *   서버가 판 시작(defense.start) 때 계정에 저장된 걸로 정해서 시드와 같이 기록 → 검증 · 멀티에서 그대로 다시 돌림.
 *   시뮬은 modsOf(로드아웃) 한 번만 계산해서 보드에 붙임 (매 tick 계산 X).
 *
 * 재화: 픽셀 조각(기본) · 유닛 카드(유닛별) · 글리치 코어(희귀). 보상은 서버가 기록을 다시 돌려 검증한 뒤에만.
 * GP(사이트 공용 포인트, lib/points.ts)는 꾸미기 · 시즌 패스 프리미엄 · 코어 교환에 씀.
 *
 * 수치를 바꾸면 balance.ts 의 BALANCE_VER 도 올리기 (판 결과가 바뀜).
 */
import type { Faction } from "./units";

/* ───────────────────────── 로드아웃 ───────────────────────── */

export interface Loadout {
  /** 유닛 영구 레벨 (id → 0..UNIT_MAX_LV) */
  lv?: Record<string, number>;
  /** 장착한 연구 (최대 RES_SLOTS) */
  res?: string[];
  /** 장착한 유물 (최대 RELIC_SLOTS) */
  relics?: string[];
  /** 오염 단계 0..GLITCH_MAX */
  glitch?: number;
}

export const UNIT_MAX_LV = 10;
/** 유닛 레벨 하나당 그 유닛 피해 + */
export const LV_DMG = 0.03;
export const RES_SLOTS = 4;
export const RELIC_SLOTS = 3;
export const GLITCH_MAX = 10;

/* ───────────────────────── 연구 ───────────────────────── */

export interface ResearchDef {
  id: string;
  name: string;
  desc: string;
  /** 어느 줄 (화면 묶음) */
  group: Faction | "general";
  /** 여는 값 (픽셀 조각) */
  cost: number;
}

export const RESEARCH: ResearchDef[] = [
  { id: "g_gold", name: "비상금", desc: "시작 골드 +40", group: "general", cost: 300 },
  { id: "g_summon", name: "소환 할인", desc: "소환 비용 -2G", group: "general", cost: 600 },
  { id: "g_wave", name: "웨이브 수당", desc: "웨이브를 넘길 때 받는 골드 +20%", group: "general", cost: 900 },
  { id: "g_stone", name: "행운석 주머니", desc: "시작 행운석 +2", group: "general", cost: 600 },
  { id: "g_boss", name: "버티기 훈련", desc: "보스 제한 시간 +8초", group: "general", cost: 1200 },
  { id: "g_sell", name: "고물상", desc: "유닛 판매 금액 ×1.5", group: "general", cost: 400 },
  { id: "k_drill", name: "기사단 훈련", desc: "기사단 피해 +10%", group: "knight", cost: 800 },
  { id: "k_tactic", name: "대형 진형", desc: "기사단이 중형 · 대형 적에게 주는 피해 +20%p", group: "knight", cost: 1500 },
  { id: "m_drill", name: "공방 개조", desc: "기계공방 피해 +10%", group: "mech", cost: 800 },
  { id: "m_tune", name: "과급 장치", desc: "기계공방 공격 속도 +10%", group: "mech", cost: 1500 },
  { id: "a_drill", name: "마도 수련", desc: "마도회 피해 +10%", group: "arcane", cost: 800 },
  { id: "a_focus", name: "마력 집중", desc: "마도회 둔화 · 체력 비례 피해 효과 +25%", group: "arcane", cost: 1500 },
];
export const RES: Record<string, ResearchDef> = Object.fromEntries(RESEARCH.map((r) => [r.id, r]));

/* ───────────────────────── 유물 ───────────────────────── */

export interface RelicDef {
  id: string;
  name: string;
  desc: string;
  /** 희귀도 0 일반 · 1 희귀 · 2 전설 (상자 확률 · 코어 값) */
  tier: 0 | 1 | 2;
  /** 어울리는 길 (화면 안내 · 봇 루트) */
  route: "mono" | "mix" | "gamble" | "eco" | "boss" | "any";
}

export const RELICS: RelicDef[] = [
  { id: "gold_gear", name: "황금 톱니", desc: "적 처치 골드 +1", tier: 0, route: "eco" },
  { id: "first_harvest", name: "첫 수확", desc: "1~15웨이브 동안 웨이브 골드 2배", tier: 0, route: "eco" },
  { id: "lucky_clover", name: "네잎클로버", desc: "소환 확률 강화 1단계를 들고 시작", tier: 0, route: "any" },
  { id: "rift_compass", name: "균열 나침반", desc: "균열 다시 열기 30% 빠름 · 닫으면 행운석 +1", tier: 0, route: "gamble" },
  { id: "gambler_coin", name: "도박꾼의 동전", desc: "행운석 도박 성공률 +6%p", tier: 1, route: "gamble" },
  { id: "hourglass", name: "시간의 모래", desc: "보스 제한 시간 +10초", tier: 1, route: "boss" },
  { id: "alchemy", name: "연금술 노트", desc: "조합식으로 신화 · 히든을 만들면 골드 +80 · 행운석 +2", tier: 1, route: "any" },
  { id: "vaccine", name: "글리치 백신", desc: "보스 · 엘리트 · 균열 적에게 주는 피해 +25%", tier: 1, route: "boss" },
  { id: "pure_blood", name: "순수 혈통", desc: "필드에 한 세력만 있으면 (히든 제외) 모든 피해 +25%", tier: 2, route: "mono" },
  { id: "rainbow", name: "무지개 연합", desc: "필드에 세 세력이 모두 있으면 모든 피해 +12%", tier: 2, route: "mix" },
  { id: "twin_star", name: "쌍둥이 별", desc: "레전드 이상을 얻을 때 15% 확률로 같은 등급 같은 세력 1기 더 (빈 칸이 있으면)", tier: 2, route: "any" },
  { id: "war_banner", name: "전쟁 깃발", desc: "세력 강화 레벨 합 10마다 모든 피해 +4%", tier: 2, route: "mix" },
];
export const RELIC: Record<string, RelicDef> = Object.fromEntries(RELICS.map((r) => [r.id, r]));

/* ───────────────────────── 오염 단계 ───────────────────────── */

export interface GlitchDef {
  lv: number;
  /** 적 체력 배수 */
  hp: number;
  /** 적 속도 배수 */
  spd: number;
  /** 보스 제한 시간 (초, 더함) */
  bossSec: number;
  /** 보상 배수 */
  reward: number;
  /** 이 단계에서 새로 붙는 규칙 (화면 안내) */
  rule: string;
}
/** 단계마다 앞 단계 규칙을 모두 포함 */
export const GLITCH: GlitchDef[] = [
  { lv: 0, hp: 1, spd: 1, bossSec: 0, reward: 1, rule: "기본" },
  { lv: 1, hp: 1.12, spd: 1, bossSec: 0, reward: 1.2, rule: "적 체력 +12%" },
  { lv: 2, hp: 1.24, spd: 1, bossSec: -3, reward: 1.4, rule: "보스 제한 시간 -3초" },
  { lv: 3, hp: 1.36, spd: 1.04, bossSec: -3, reward: 1.6, rule: "적 속도 +4%" },
  { lv: 4, hp: 1.5, spd: 1.04, bossSec: -6, reward: 1.85, rule: "보스 제한 시간 -6초" },
  { lv: 5, hp: 1.65, spd: 1.06, bossSec: -6, reward: 2.1, rule: "적 체력 +65% · 속도 +6%" },
  { lv: 6, hp: 1.8, spd: 1.06, bossSec: -9, reward: 2.4, rule: "보스 제한 시간 -9초" },
  { lv: 7, hp: 1.98, spd: 1.08, bossSec: -9, reward: 2.7, rule: "적 속도 +8%" },
  { lv: 8, hp: 2.16, spd: 1.08, bossSec: -12, reward: 3, rule: "보스 제한 시간 -12초" },
  { lv: 9, hp: 2.36, spd: 1.1, bossSec: -12, reward: 3.4, rule: "적 체력 +136% · 속도 +10%" },
  { lv: 10, hp: 2.6, spd: 1.1, bossSec: -15, reward: 4, rule: "끝판 — 보스 제한 시간 -15초" },
];

/* ───────────────────────── 판에 붙는 효과 (시뮬이 읽음) ───────────────────────── */

export interface Mods {
  lv: Record<string, number>;
  startGold: number;
  startStones: number;
  startLuck: number;
  summonDisc: number;
  waveGold: number;
  sellMult: number;
  bossSec: number;
  /** 세력별 피해 배수 (연구) */
  fac: Record<"knight" | "mech" | "arcane", number>;
  /** 기사단 중 · 대형 상성 더함 */
  knightBig: number;
  mechAspd: number;
  arcaneFx: number;
  killGold: number;
  firstHarvest: boolean;
  riftCd: number;
  riftStone: number;
  gamble: number;
  alchemy: boolean;
  vaccine: number;
  pureBlood: number;
  rainbow: number;
  twinStar: number;
  warBanner: number;
  glitch: GlitchDef;
}

const clampInt = (v: unknown, lo: number, hi: number) =>
  Number.isInteger(v) ? Math.max(lo, Math.min(hi, v as number)) : lo;

/** 로드아웃을 깨끗하게 (모르는 id · 넘치는 칸 · 범위 밖 값은 버림) — 서버가 저장 · 시작할 때도 이걸로 */
export function cleanLoadout(lo: Loadout | null | undefined, unitIds?: Set<string>): Required<Loadout> {
  const lv: Record<string, number> = {};
  for (const [k, v] of Object.entries(lo?.lv ?? {})) {
    if (unitIds && !unitIds.has(k)) continue;
    const n = clampInt(v, 0, UNIT_MAX_LV);
    if (n > 0) lv[k] = n;
  }
  const uniq = (a: unknown, ok: (s: string) => boolean, max: number) =>
    [...new Set(Array.isArray(a) ? a.filter((s): s is string => typeof s === "string" && ok(s)) : [])].slice(0, max);
  return {
    lv,
    res: uniq(lo?.res, (s) => !!RES[s], RES_SLOTS),
    relics: uniq(lo?.relics, (s) => !!RELIC[s], RELIC_SLOTS),
    glitch: clampInt(lo?.glitch, 0, GLITCH_MAX),
  };
}

export function modsOf(lo: Loadout | null | undefined): Mods {
  const L = cleanLoadout(lo);
  const r = new Set(L.res);
  const x = new Set(L.relics);
  return {
    lv: L.lv,
    startGold: r.has("g_gold") ? 40 : 0,
    startStones: r.has("g_stone") ? 2 : 0,
    startLuck: x.has("lucky_clover") ? 1 : 0,
    summonDisc: r.has("g_summon") ? 2 : 0,
    waveGold: r.has("g_wave") ? 1.2 : 1,
    sellMult: r.has("g_sell") ? 1.5 : 1,
    bossSec: (r.has("g_boss") ? 8 : 0) + (x.has("hourglass") ? 10 : 0) + GLITCH[L.glitch].bossSec,
    fac: {
      knight: r.has("k_drill") ? 1.1 : 1,
      mech: r.has("m_drill") ? 1.1 : 1,
      arcane: r.has("a_drill") ? 1.1 : 1,
    },
    knightBig: r.has("k_tactic") ? 0.2 : 0,
    mechAspd: r.has("m_tune") ? 0.1 : 0,
    arcaneFx: r.has("a_focus") ? 1.25 : 1,
    killGold: x.has("gold_gear") ? 1 : 0,
    firstHarvest: x.has("first_harvest"),
    riftCd: x.has("rift_compass") ? 0.7 : 1,
    riftStone: x.has("rift_compass") ? 1 : 0,
    gamble: x.has("gambler_coin") ? 0.06 : 0,
    alchemy: x.has("alchemy"),
    vaccine: x.has("vaccine") ? 1.25 : 1,
    pureBlood: x.has("pure_blood") ? 1.25 : 1,
    rainbow: x.has("rainbow") ? 1.12 : 1,
    twinStar: x.has("twin_star") ? 0.15 : 0,
    warBanner: x.has("war_banner") ? 0.04 : 0,
    glitch: GLITCH[L.glitch],
  };
}

/* ───────────────────────── 유닛 레벨업 ───────────────────────── */

/** lv → lv+1 에 드는 카드 · 조각 */
export const LV_COST: { cards: number; pieces: number }[] = [
  { cards: 2, pieces: 50 },
  { cards: 4, pieces: 100 },
  { cards: 6, pieces: 180 },
  { cards: 10, pieces: 300 },
  { cards: 15, pieces: 450 },
  { cards: 20, pieces: 650 },
  { cards: 30, pieces: 900 },
  { cards: 40, pieces: 1200 },
  { cards: 60, pieces: 1600 },
  { cards: 80, pieces: 2200 },
];

/* ───────────────────────── 판 보상 (서버가 검증 뒤 계산) ───────────────────────── */

export type RunMode = "season" | "weekly" | "multi";

export interface RunReward {
  pieces: number;
  cores: number;
  /** 유닛 카드 (id → 장) */
  cards: Record<string, number>;
  /** 시즌 경험치 */
  xp: number;
}

/**
 * 판 하나 보상. made = 이 판에서 얻은 유닛 수(id → 수), bosses = 잡은 보스 수.
 * 카드: 만든 유닛 종류마다 1장(레전드 이상은 2장) — 한 판 최대 30장. 코어: 오염 단계 클리어 · 보스 50웨이브 이상.
 */
export function runReward(
  mode: RunMode,
  r: { win: boolean; wave: number; kills: number },
  made: Record<string, number>,
  grades: Record<string, number>,
  glitch: number
): RunReward {
  const bosses = Math.floor(Math.min(r.wave - (r.win ? 0 : 1), 60) / 10);
  const g = GLITCH[Math.max(0, Math.min(GLITCH_MAX, glitch))];
  const modeMult = mode === "multi" ? 1.2 : 1;
  const base = 20 + r.wave * 3 + bosses * 20 + (r.win ? 250 : 0) + Math.floor(Math.min(r.kills, 3000) / 30);
  const pieces = Math.round(base * g.reward * modeMult);
  const cards: Record<string, number> = {};
  let n = 0;
  for (const id of Object.keys(made).sort()) {
    if (n >= 30) break;
    const k = (grades[id] ?? 0) >= 3 ? 2 : 1;
    cards[id] = k;
    n += k;
  }
  const cores = (r.win ? 3 + Math.floor(glitch / 2) : 0) + (r.wave >= 50 ? 1 : 0);
  const xp = Math.round((r.wave * 2 + bosses * 10 + (r.win ? 100 : 0)) * modeMult);
  return { pieces, cores, cards, xp };
}

/**
 * 시즌 랭킹 점수: 오염 단계가 높을수록 위 (단계 하나 = 20웨이브 몫).
 * 같은 단계면 클리어 > 높은 웨이브 > 처치 수, 클리어끼리는 빨리 깬 쪽.
 */
export function seasonScore(r: { win: boolean; wave: number; tick: number; kills: number }, glitch: number): number {
  const base = r.win ? 7e7 - Math.min(r.tick, 9e6) : r.wave * 1e6 + Math.min(999_999, r.kills);
  return Math.max(0, Math.min(GLITCH_MAX, glitch | 0)) * 2e7 + base;
}

/** 다음 오염 단계가 열리는 웨이브 (그 단계에서 이만큼 버티거나 클리어) */
export const GLITCH_UNLOCK_WAVE = 40;

/* ───────────────────────── 상자 ───────────────────────── */

/** 상자: 조각으로 사서 열면 유물(안 가진 것 우선) 또는 카드 묶음 */
export const CHEST = {
  /** 조각 값 */
  price: 400,
  /** 유물이 나올 확률 (안 가진 유물이 있을 때) */
  relicChance: 0.35,
  /** 유물 희귀도 확률 */
  tierOdds: [0.6, 0.3, 0.1],
  /** 카드 묶음: 무작위 유닛 이만큼 */
  cards: 12,
  /** 이미 가진 유물이 또 나오면 코어로 */
  dupCores: 3,
} as const;
/** 코어로 원하는 유물 바로 사기 */
export const RELIC_CORE_PRICE = [8, 15, 30] as const;

/* ───────────────────────── 일일 · 주간 미션 ───────────────────────── */

export interface QuestDef {
  id: string;
  name: string;
  /** 판 결과에서 더하는 값 (서버 계산) */
  metric: "runs" | "wave" | "bosses" | "legend" | "myth" | "recipe" | "knight" | "mech" | "arcane" | "rift" | "win" | "multi";
  goal: number;
  pieces: number;
  cores?: number;
  xp: number;
}

/** 하루 3개 (날짜로 정해짐 · 모두 같음) */
export const DAILY_POOL: QuestDef[] = [
  { id: "d_runs", name: "오늘의 출근", metric: "runs", goal: 2, pieces: 80, xp: 30 },
  { id: "d_wave30", name: "30웨이브 넘기", metric: "wave", goal: 30, pieces: 120, xp: 40 },
  { id: "d_bosses", name: "보스 사냥", metric: "bosses", goal: 5, pieces: 120, xp: 40 },
  { id: "d_legend", name: "전설 수집", metric: "legend", goal: 3, pieces: 100, xp: 30 },
  { id: "d_myth", name: "신화 강림", metric: "myth", goal: 1, pieces: 150, xp: 50 },
  { id: "d_knight", name: "기사단의 날", metric: "knight", goal: 8, pieces: 100, xp: 30 },
  { id: "d_mech", name: "기계공방의 날", metric: "mech", goal: 8, pieces: 100, xp: 30 },
  { id: "d_arcane", name: "마도회의 날", metric: "arcane", goal: 8, pieces: 100, xp: 30 },
  { id: "d_rift", name: "균열 닫기", metric: "rift", goal: 3, pieces: 100, xp: 30 },
  { id: "d_multi", name: "같이 하자", metric: "multi", goal: 1, pieces: 120, xp: 40 },
];
/** 한 주 3개 */
export const WEEKLY_POOL: QuestDef[] = [
  { id: "w_runs", name: "꾸준함", metric: "runs", goal: 10, pieces: 400, cores: 2, xp: 150 },
  { id: "w_bosses", name: "보스 헌터", metric: "bosses", goal: 30, pieces: 500, cores: 2, xp: 150 },
  { id: "w_myth", name: "신화 수집가", metric: "myth", goal: 5, pieces: 500, cores: 3, xp: 150 },
  { id: "w_win", name: "세계를 지키다", metric: "win", goal: 1, pieces: 800, cores: 5, xp: 200 },
  { id: "w_recipe", name: "조합 장인", metric: "recipe", goal: 8, pieces: 400, cores: 2, xp: 150 },
];

/* ───────────────────────── 시간 (한국 시간 기준) ───────────────────────── */

const KST = 9 * 3600_000;
const DAY = 86_400_000;
/** 주 · 시즌 기준일: 2026-10-12(월) 0시 KST */
export const EPOCH = Date.UTC(2026, 9, 12) - KST;
export const kstDayKey = (t: number) => new Date(t + KST).toISOString().slice(0, 10);
/** 주 번호 (월요일 0시 KST 에 바뀜) */
export const weekOf = (t: number) => Math.floor((t - EPOCH) / (7 * DAY));
export const SEASON_WEEKS = 4;
export const seasonOf = (t: number) => Math.floor(weekOf(t) / SEASON_WEEKS) + 1;
export const seasonEnds = (s: number) => EPOCH + s * SEASON_WEEKS * 7 * DAY;
export const weekEnds = (w: number) => EPOCH + (w + 1) * 7 * DAY;

/** 날짜 · 주로 미션 고르기 (모두 같음) */
function pickN<T>(pool: T[], n: number, key: number): T[] {
  const a = pool.slice();
  let h = (key * 2654435761) >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
export const dailyOf = (t: number) => pickN(DAILY_POOL, 3, Math.floor((t - EPOCH) / DAY) + 7);
export const weeklyOf = (t: number) => pickN(WEEKLY_POOL, 3, weekOf(t) + 101);

/** 주간 도전: 모두 같은 유물 3개 (강화 · 연구 없음, 오염 0) */
export function weeklyRelics(week: number): string[] {
  return pickN(RELICS, 3, week + 977).map((r) => r.id);
}

/* ───────────────────────── 시즌 패스 ───────────────────────── */

export interface PassReward {
  pieces?: number;
  cores?: number;
  chest?: number;
  gp?: number;
  /** 꾸미기 id (inv.defense) */
  item?: string;
}
export interface PassTier {
  xp: number;
  free: PassReward;
  premium: PassReward;
}
/** 30단계. xp 는 누적 */
export const PASS: PassTier[] = Array.from({ length: 30 }, (_, i): PassTier => {
  const t = i + 1;
  const xp = 100 * t + 10 * t * t;
  const free: PassReward =
    t % 10 === 0 ? { cores: 5, gp: 300 } : t % 5 === 0 ? { chest: 1, gp: 100 } : t % 2 === 0 ? { pieces: 150 } : { pieces: 100 };
  const premium: PassReward =
    t === 30
      ? { item: "theme.gold", cores: 10 }
      : t === 20
        ? { item: "theme.neon", cores: 5 }
        : t === 10
          ? { item: "theme.ice", cores: 5 }
          : t % 3 === 0
            ? { chest: 1 }
            : { pieces: 200 };
  return { xp, free, premium };
});
/** 프리미엄 줄 값 (GP) */
export const PASS_PREMIUM_GP = 5000;

/** GP → 글리치 코어 교환 (주에 max 번) */
export const CORE_EXCHANGE = { gp: 1000, cores: 4, maxPerWeek: 5 } as const;

/** 주간 도전 순위 GP 보상 (주가 끝나면 다음 접속 때 받음) */
export const WEEKLY_GP: { upTo: number; gp: number }[] = [
  { upTo: 1, gp: 3000 },
  { upTo: 3, gp: 2000 },
  { upTo: 10, gp: 1000 },
  { upTo: 50, gp: 300 },
];
/** 주간 도전에 한 판이라도 끝내면 (순위와 별개) */
export const WEEKLY_JOIN_GP = 100;

/* ───────────────────────── 꾸미기 (블록 테마) ───────────────────────── */

export interface ThemeDef {
  id: string;
  name: string;
  /** 블록 윗면 색을 세력색 대신 이 색들로 (기사단 · 기계공방 · 마도회 · 빈 칸) */
  top: [string, string, string, string];
  /** 돌길 색 [바탕, 밝은 돌, 어두운 돌] */
  road: [string, string, string];
}
export const THEMES: ThemeDef[] = [
  { id: "theme.base", name: "기본", top: ["", "", "", "#2a2350"], road: ["#2b2348", "#3a3060", "#2f274f"] },
  { id: "theme.ice", name: "얼음 성채", top: ["#2c6f9e", "#5d7f9e", "#5a5fa8", "#22405c"], road: ["#1e3a52", "#2d5675", "#244560"] },
  { id: "theme.neon", name: "네온 시티", top: ["#0f6a8c", "#8c4a0f", "#5f1f8c", "#1a1033"], road: ["#140b26", "#2a1550", "#1d0f3a"] },
  { id: "theme.gold", name: "황금 신전", top: ["#8a6a1c", "#9a5a14", "#7a4a8a", "#4a3a14"], road: ["#3a2c10", "#5a4418", "#4a3812"] },
  { id: "theme.forest", name: "픽셀 숲", top: ["#2f6a4a", "#6a5a2a", "#4a3a6a", "#1f3a2a"], road: ["#23331f", "#34502d", "#2a4026"] },
];
export const THEME: Record<string, ThemeDef> = Object.fromEntries(THEMES.map((t) => [t.id, t]));
