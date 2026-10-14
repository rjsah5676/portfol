/**
 * 픽셀 운빨 디펜스 — 영구 성장(판 밖) 정의. 시뮬 · 서버 · 화면이 같이 씀 (브라우저 전용 API 금지).
 *
 * 판에 들고 가는 것 = 로드아웃(Loadout): 유닛 레벨 · 연구(공용 4칸 + 세력 전용 0~3칸) · 유물(장착 3칸 + 가진 유물 보유 효과)
 *   · 오염 단계 · 보관함 칸 수 · 해금한 초월.
 *   서버가 판 시작(defense.start) 때 계정에 저장된 걸로 정해서 시드와 같이 기록 → 검증 · 멀티에서 그대로 다시 돌림.
 *   시뮬은 modsOf(로드아웃) 한 번만 계산해서 보드에 붙임 (매 tick 계산 X).
 *
 * 재화: 픽셀 조각(기본) · 유닛 카드(유닛별) · 글리치 코어(희귀). 보상은 서버가 기록을 다시 돌려 검증한 뒤에만.
 * GP(사이트 공용 포인트, lib/points.ts)는 상점(패키지 · 재화샵) · 시즌 패스 프리미엄에 씀. 게임 재화 → GP 교환도 상점에서 (GP_SELL).
 *
 * 수치를 바꾸면 balance.ts 의 BALANCE_VER 도 올리기 (판 결과가 바뀜).
 */
import { TUNE } from "./balance";
import { CHEAT_REROLL } from "./cheats";
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
  /** 장착한 연구 레벨 (없으면 1) */
  resLv?: Record<string, number>;
  /** 장착한 유물 레벨 (없으면 1) */
  relicLv?: Record<string, number>;
  /** 열린 보관함 칸 (BENCH_BASE..BENCH_MAX) */
  bench?: number;
  /** 산 세력 전용 연구칸 (0..FRES_MAX) */
  fslots?: number;
  /** 가진 유물 전부 (id → 레벨) — 보유 효과 */
  own?: Record<string, number>;
  /** 해금한 초월 (조합식이 열림) */
  trans?: string[];
  /** 치트 연구칸에 낀 것 (CHEAT_RES id, 없으면 "") */
  cheat?: string;
  /** 끈기: 열린 가장 높은 오염 단계에서 연달아 못 깬 판 수 (서버가 셈, 0..GRIT_MAX) */
  grit?: number;
  /** 보물방이 열리는 웨이브 (서버가 판 시작 때 뽑음, 0 = 없음) — treasureWaveOk */
  treasure?: number;
}

/* ───────────────────────── 보물방 ───────────────────────── */

/**
 * 보물방: 오염 1단계 이상 시즌 판을 시작할 때마다 (쌓인 웨이브 ÷ cap)^exp 확률 — cap(500)웨이브면 100% 천장.
 * 쌓인 웨이브 = 지난 보물방 뒤로 검증된 판에서 도달한 웨이브 합 (건실하게 오래 버틸수록 빨리 참). 뜨면 0 으로.
 * exp 1.7 → 판당 25~55웨이브면 중앙값 ≈ 240웨이브 (짧게 끊는 사람 ≈ 195, 길게 버티는 사람 ≈ 260), 10%~90% ≈ 125~360.
 * 열리는 웨이브는 11~59 중 보스 웨이브 빼고 무작위 — 늦게 뜰수록 덱이 세서 많이 깎음(운).
 */
export const TREASURE = { cap: 500, exp: 1.7, from: 11, to: 59, minGlitch: 1 } as const;
export const treasureWaveOk = (w: unknown) =>
  Number.isInteger(w) && (w as number) >= TREASURE.from && (w as number) <= TREASURE.to && (w as number) % 10 !== 0;
export const TREASURE_WAVES = Array.from({ length: TREASURE.to - TREASURE.from + 1 }, (_, i) => TREASURE.from + i).filter(treasureWaveOk);
/** 이번 판 보물방 확률 (0~1) */
export const treasureChance = (waves: number, glitch: number) =>
  glitch < TREASURE.minGlitch ? 0 : Math.min(1, Math.pow(Math.max(0, waves) / TREASURE.cap, TREASURE.exp));
/**
 * 보물방 판 밖 보상: 깎은 체력 비율 r(0~1) 에 비례 × 오염 단계 보상 배수. 잡으면 카드 상자 +1.
 * 다 깎으면 조각 ≈ 일반 판 2판 몫 · 코어 ≈ 클리어 한 번 몫
 */
export function treasureReward(glitch: number, t: { dmg: number; max: number; killed: boolean }): Goods {
  const g = GLITCH[Math.max(0, Math.min(GLITCH_MAX, glitch))];
  const r = t.max > 0 ? Math.max(0, Math.min(1, t.dmg / t.max)) : 0;
  return {
    pieces: Math.round(600 * r * g.reward),
    cores: Math.floor(8 * r * (1 + glitch / 10)),
    ...(t.killed ? { cardBox: 1 } : {}),
  };
}

/**
 * 끈기 — 가장 높은 오염 단계(새 단계)에서 연달아 지면 판마다 모든 피해 +GRIT_PER (최대 GRIT_MAX 판).
 * 그 단계를 깨거나(10~) 40웨이브를 넘겨 다음 단계를 열면(0~9) 0 으로. 전략 · 운에 따라 막히는 시간이 너무 벌어지지 않게.
 */
export const GRIT_PER = 0.06;
export const GRIT_MAX = 15;

/** 보관함: 처음 BENCH_BASE 칸, 정비소에서 1칸씩 BENCH_MAX 까지 (픽셀 조각) */
export const BENCH_BASE = 3;
export const BENCH_MAX = 6;
export const BENCH_COST = [1500, 3000, 6000] as const;
/** 세력 전용 연구칸: 기사단 · 기계공방 · 마도회 연구만 (글리치 코어) — 공용 4칸엔 공동 연구만 */
export const FRES_MAX = 3;
export const FRES_COST = [15, 30, 60] as const;
/** 초월 (세력마다 1종) */
export const TRANS_IDS = ["k_astra", "m_deus", "a_origin"] as const;
/** 유물 보유 효과: 가진 유물 하나 · 레벨 하나당 모든 피해 +% (일반 · 희귀 · 전설) */
export const RELIC_PASSIVE = [0.4, 0.7, 1] as const;

/**
 * 치트 연구 — 치트 연구칸 1칸 (누구나), 상점에서 한 번 사면 계속. 둘 중 하나만 낌. 비쌈 (오래 하는 사람의 목표)
 *  리롤 회로: 치트 코드 카드마다 다시 뽑기 +1 · 확률 증폭기: 비밀 등급 ×1.5 · 금지 등급 ×2
 */
export interface CheatResDef {
  id: string;
  name: string;
  desc: string;
  cores: number;
  pieces: number;
}
export const CHEAT_RES: CheatResDef[] = [
  { id: "x_reroll", name: "리롤 회로", desc: "치트 코드 카드마다 다시 뽑기 +1 (1번 → 2번)", cores: 120, pieces: 12000 },
  { id: "x_luck", name: "확률 증폭기", desc: "치트 코드 비밀 등급 ×1.5 · 금지 등급 ×2 확률", cores: 120, pieces: 12000 },
];
export const CHEAT_RES_OF: Record<string, CheatResDef> = Object.fromEntries(CHEAT_RES.map((x) => [x.id, x]));

export const UNIT_MAX_LV = 10;
/** 유닛 레벨 하나당 그 유닛 피해 + */
export const LV_DMG = 0.03;
/** 유닛 레벨 하나당 그 유닛 버프 · 둔화 · 방어 깎기 · 확률 효과 + (아군 공속 오라 등도 강해짐) */
export const LV_BUFF = 0.03;
export const RES_SLOTS = 4;
export const RELIC_SLOTS = 3;
export const GLITCH_MAX = 30;

/* ───────────────────────── 연구 ───────────────────────── */

/** 연구 · 유물 최고 레벨 (1 = 처음 연 상태) */
export const RES_MAX_LV = 5;
export const RELIC_MAX_LV = 5;
/** 레벨마다 효과 늘어나는 비율 — 1레벨 효과 × (1 + k × (레벨-1)) */
const sc = (lv: number, k: number) => 1 + k * (Math.max(1, lv) - 1);
const rd = (x: number) => Math.round(x);

export interface ResearchDef {
  id: string;
  name: string;
  /** 1레벨 설명 (화면에서 레벨별은 resDesc) */
  desc: string;
  /** 설명 틀 — {v} 자리에 val(레벨) */
  tpl: string;
  /** 레벨 → 효과 수치 (정수, 시뮬이 modsOf 로 읽음) */
  val: (lv: number) => number;
  /** 어느 줄 (화면 묶음) */
  group: Faction | "general";
  /** 여는 값 (픽셀 조각) — 레벨 n → n+1 은 cost × n */
  cost: number;
}

const res = (id: string, name: string, tpl: string, val: (lv: number) => number, group: ResearchDef["group"], cost: number): ResearchDef => ({
  id,
  name,
  tpl,
  val,
  group,
  cost,
  desc: tpl.replace("{v}", String(val(1))),
});

export const RESEARCH: ResearchDef[] = [
  res("g_gold", "비상금", "시작 골드 +{v}", (l) => rd(40 * sc(l, 0.25)), "general", 300),
  res("g_summon", "소환 할인", "소환 비용 -{v}G", (l) => rd(2 * sc(l, 0.25)), "general", 600),
  res("g_wave", "웨이브 수당", "웨이브를 넘길 때 받는 골드 +{v}%", (l) => rd(20 * sc(l, 0.25)), "general", 900),
  res("g_stone", "행운석 주머니", "시작 행운석 +{v}", (l) => rd(2 * sc(l, 0.25)), "general", 600),
  res("g_boss", "버티기 훈련", "보스 제한 시간 +{v}초", (l) => rd(8 * sc(l, 0.25)), "general", 1200),
  res("g_sell", "고물상", "유닛 판매 금액 +{v}%", (l) => 50 + 10 * (Math.max(1, l) - 1), "general", 400),
  res("k_drill", "기사단 훈련", "기사단 피해 +{v}%", (l) => rd(10 * sc(l, 0.25)), "knight", 800),
  res("k_tactic", "대형 진형", "기사단이 중형 · 대형 적에게 주는 피해 +{v}%p", (l) => rd(30 * sc(l, 0.25)), "knight", 1500),
  res("m_drill", "공방 개조", "기계공방 피해 +{v}%", (l) => rd(10 * sc(l, 0.25)), "mech", 800),
  res("m_tune", "과급 장치", "기계공방 공격 속도 +{v}%", (l) => rd(13 * sc(l, 0.25)), "mech", 1500),
  res("m_bounty", "대물 탄두", "기계공방이 보스 · 엘리트 · 균열에게 주는 피해 +{v}%", (l) => rd(20 * sc(l, 0.25)), "mech", 1500),
  res("k_rally", "돌격 나팔", "기사단 공격 속도 +{v}%", (l) => rd(10 * sc(l, 0.25)), "knight", 1500),
  res("a_drill", "마도 수련", "마도회 피해 +{v}%", (l) => rd(10 * sc(l, 0.25)), "arcane", 800),
  res("a_echo", "마력 공명", "마도회 공격 속도 +{v}%", (l) => rd(18 * sc(l, 0.25)), "arcane", 1500),
  res("a_focus", "마력 집중", "마도회 둔화 · 체력 비례 피해 효과 +{v}%", (l) => rd(25 * sc(l, 0.25)), "arcane", 1500),
];
export const RES: Record<string, ResearchDef> = Object.fromEntries(RESEARCH.map((r) => [r.id, r]));
export const resDesc = (id: string, lv = 1) => RES[id]?.tpl.replace("{v}", String(RES[id].val(lv))) ?? "";
/** 연구 lv → lv+1 조각 */
export const resUpCost = (id: string, lv: number) => (RES[id]?.cost ?? 0) * lv;

/* ───────────────────────── 유물 ───────────────────────── */

export interface RelicDef {
  id: string;
  name: string;
  /** 1레벨 설명 (레벨별은 relicDesc) */
  desc: string;
  /** 레벨 → 설명 */
  at: (lv: number) => string;
  /** 희귀도 0 일반 · 1 희귀 · 2 전설 (상자 확률 · 코어 값) */
  tier: 0 | 1 | 2;
  /** 어울리는 길 (화면 안내 · 봇 루트) */
  route: "mono" | "mix" | "gamble" | "eco" | "boss" | "any";
}

/**
 * 유물 레벨별 수치 — 희귀도가 높을수록 레벨당 덜 오름 (일반 +25% · 희귀 +20% · 전설 +15%, 5레벨이면 일반 2배)
 * 시뮬은 modsOf 가 이 값을 읽음.
 */
export const RELIC_VAL = {
  gold_gear: (l: number) => (l >= 5 ? 3 : l >= 3 ? 2 : 1),
  gold_gear_wave: (l: number) => (Math.max(1, l) - 1) * 5,
  first_harvest: (l: number) => 15 + 3 * (Math.max(1, l) - 1),
  lucky_clover: (l: number) => (l >= 4 ? 2 : 1),
  rift_cd: (l: number) => 30 + 5 * (Math.max(1, l) - 1),
  rift_stone: (l: number) => (l >= 5 ? 2 : 1),
  gambler_coin: (l: number) => rd(6 * sc(l, 0.2)),
  hourglass: (l: number) => rd(10 * sc(l, 0.2)),
  alchemy_gold: (l: number) => rd(80 * sc(l, 0.2)),
  alchemy_stone: (l: number) => 2 + Math.floor((Math.max(1, l) - 1) / 2),
  vaccine: (l: number) => rd(25 * sc(l, 0.2)),
  pure_blood: (l: number) => rd(25 * sc(l, 0.15)),
  rainbow: (l: number) => rd(9 * sc(l, 0.15)),
  twin_star: (l: number) => rd(15 * sc(l, 0.15)),
  war_banner: (l: number) => rd(40 * sc(l, 0.15)) / 10,
};
const V = RELIC_VAL;

const relic = (id: string, name: string, at: (l: number) => string, tier: RelicDef["tier"], route: RelicDef["route"]): RelicDef => ({ id, name, at, tier, route, desc: at(1) });

export const RELICS: RelicDef[] = [
  relic("gold_gear", "황금 톱니", (l) => `적 처치 골드 +${V.gold_gear(l)}${V.gold_gear_wave(l) ? ` · 웨이브 골드 +${V.gold_gear_wave(l)}%` : ""}`, 0, "eco"),
  relic("first_harvest", "첫 수확", (l) => `1~${V.first_harvest(l)}웨이브 동안 웨이브 골드 2배`, 0, "eco"),
  relic("lucky_clover", "네잎클로버", (l) => `소환 확률 강화 ${V.lucky_clover(l)}단계를 들고 시작`, 0, "any"),
  relic("rift_compass", "균열 나침반", (l) => `균열 다시 열기 ${V.rift_cd(l)}% 빠름 · 닫으면 행운석 +${V.rift_stone(l)}`, 0, "gamble"),
  relic("gambler_coin", "도박꾼의 동전", (l) => `행운석 도박 성공률 +${V.gambler_coin(l)}%p`, 1, "gamble"),
  relic("hourglass", "시간의 모래", (l) => `보스 제한 시간 +${V.hourglass(l)}초`, 1, "boss"),
  relic("alchemy", "연금술 노트", (l) => `조합식으로 신화 · 히든을 만들면 골드 +${V.alchemy_gold(l)} · 행운석 +${V.alchemy_stone(l)}`, 1, "any"),
  relic("vaccine", "글리치 백신", (l) => `보스 · 엘리트 · 균열 적에게 주는 피해 +${V.vaccine(l)}%`, 1, "boss"),
  relic("pure_blood", "순수 혈통", (l) => `필드에서 한 세력이 ${Math.round(TUNE.pureFrom * 100)}% 이상이면 (보관함 제외) 모든 피해 +${V.pure_blood(l)}%`, 2, "mono"),
  relic("rainbow", "무지개 연합", (l) => `필드에 세 세력이 모두 있으면 모든 피해 +${V.rainbow(l)}%`, 2, "mix"),
  relic("twin_star", "쌍둥이 별", (l) => `레전드 이상을 얻을 때 ${V.twin_star(l)}% 확률로 같은 등급 같은 세력 1기 더 (빈 칸이 있으면)`, 2, "any"),
  relic("war_banner", "전쟁 깃발", (l) => `세력 강화 레벨 합 10마다 모든 피해 +${V.war_banner(l)}%`, 2, "mix"),
];
export const RELIC: Record<string, RelicDef> = Object.fromEntries(RELICS.map((r) => [r.id, r]));
export const relicDesc = (id: string, lv = 1) => RELIC[id]?.at(lv) ?? "";

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
  /** 적 방어력 배수 (11단계부터) */
  armor: number;
  /** 보스 체력 배수 (11단계부터, 적 체력 배수에 더 곱함) */
  boss: number;
  /** 이 단계에서 새로 붙는 규칙 (화면 안내) */
  rule: string;
}
/** 단계마다 앞 단계 규칙을 모두 포함 */
const BASE_GLITCH: GlitchDef[] = [
  { lv: 0, hp: 1, spd: 1, bossSec: 0, reward: 1, armor: 1, boss: 1, rule: "기본" },
  { lv: 1, hp: 1.12, spd: 1, bossSec: 0, reward: 1.2, armor: 1, boss: 1, rule: "적 체력 +12%" },
  { lv: 2, hp: 1.24, spd: 1, bossSec: -3, reward: 1.4, armor: 1, boss: 1, rule: "보스 제한 시간 -3초" },
  { lv: 3, hp: 1.36, spd: 1.04, bossSec: -3, reward: 1.6, armor: 1, boss: 1, rule: "적 속도 +4%" },
  { lv: 4, hp: 1.5, spd: 1.04, bossSec: -6, reward: 1.85, armor: 1, boss: 1, rule: "보스 제한 시간 -6초" },
  { lv: 5, hp: 1.65, spd: 1.06, bossSec: -6, reward: 2.1, armor: 1, boss: 1, rule: "적 체력 +65% · 속도 +6%" },
  { lv: 6, hp: 1.8, spd: 1.06, bossSec: -9, reward: 2.4, armor: 1, boss: 1, rule: "보스 제한 시간 -9초" },
  { lv: 7, hp: 1.98, spd: 1.08, bossSec: -9, reward: 2.7, armor: 1, boss: 1, rule: "적 속도 +8%" },
  { lv: 8, hp: 2.16, spd: 1.08, bossSec: -12, reward: 3, armor: 1, boss: 1, rule: "보스 제한 시간 -12초" },
  { lv: 9, hp: 2.36, spd: 1.1, bossSec: -12, reward: 3.4, armor: 1, boss: 1, rule: "적 체력 +136% · 속도 +10%" },
  { lv: 10, hp: 2.6, spd: 1.1, bossSec: -15, reward: 4, armor: 1, boss: 1, rule: "끝판 — 보스 제한 시간 -15초" },
];
/**
 * 11~30단계 (심연): 10단계 위에 한 단계마다 적 체력 +8.5%(10단계 기준) · 보상 +0.1, 5단계마다 새 규칙 (DEEP_PARAMS)
 *  11~ 방어력 · 15~ 보스 체력 · 20~ 속도 · 방어력 더 · 25~ 보스 체력 더 · 보스 시간 -18 · 30 끝
 *  (다 키운 봇이 30단계를 다섯 판에 한 번쯤 깨는 정도 — 사람은 배치 · 초월이 더 나아서 이보다 쉬움)
 */
const x100 = (v: number) => `×${v}`;
const deepRule = (P: DeepParams): Record<number, string> => ({
  11: `심연 — 적 방어력 ${x100(P.armor11)}`,
  15: `보스 체력 ${x100(P.boss15)}`,
  20: `적 속도 ${x100(P.spd20)} · 방어력 ${x100(P.armor20)}`,
  25: `보스 체력 ${x100(P.boss25)} · 보스 시간 -18초`,
  30: "끝없는 오염 — 마지막 단계",
});
/** 심연 곡선 값 (밸런스 시뮬이 --deep 으로 바꿔 볼 수 있음) */
export interface DeepParams {
  hpPerLv: number;
  armor11: number;
  armor20: number;
  boss15: number;
  boss25: number;
  spd20: number;
  /** 단계마다 보상 배수 + (10단계 4 에서) */
  rewardPerLv?: number;
}
export const DEEP_PARAMS: DeepParams = { hpPerLv: 0.085, armor11: 1.15, armor20: 1.28, boss15: 1.08, boss25: 1.15, spd20: 1.1, rewardPerLv: 0.1 };
export function deepGlitch(P: DeepParams): GlitchDef[] {
  const top = BASE_GLITCH[10];
  const rules = deepRule(P);
  return Array.from({ length: 20 }, (_, i): GlitchDef => {
    const lv = 11 + i;
    const hp = Math.round(top.hp * (1 + P.hpPerLv * (lv - 10)) * 100) / 100;
    return {
      lv,
      hp,
      spd: lv >= 20 ? P.spd20 : top.spd,
      bossSec: lv >= 25 ? -18 : top.bossSec,
      reward: Math.round((top.reward + (P.rewardPerLv ?? 0.1) * (lv - 10)) * 100) / 100,
      armor: lv >= 20 ? P.armor20 : P.armor11,
      boss: lv >= 25 ? P.boss25 : lv >= 15 ? P.boss15 : 1,
      rule: rules[lv] ?? `적 체력 +${Math.round((hp - 1) * 100)}%`,
    };
  });
}
export const GLITCH: GlitchDef[] = [...BASE_GLITCH, ...deepGlitch(DEEP_PARAMS)];

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
  /** 세력별 공격 속도 + (연구) */
  facAspd: Record<"knight" | "mech" | "arcane", number>;
  /** 기계공방 보스 · 엘리트 · 균열 피해 × */
  mechBoss: number;
  arcaneFx: number;
  killGold: number;
  /** 이 웨이브까지 웨이브 골드 2배 (0 = 없음) */
  firstHarvest: number;
  riftCd: number;
  riftStone: number;
  gamble: number;
  alchemyGold: number;
  alchemyStones: number;
  vaccine: number;
  pureBlood: number;
  rainbow: number;
  twinStar: number;
  warBanner: number;
  glitch: GlitchDef;
  /** 장착한 연구 · 유물 id (화면 표시용, 시뮬은 위 값만 씀) */
  res: string[];
  relics: string[];
  resLv: Record<string, number>;
  relicLv: Record<string, number>;
  /** 열린 보관함 칸 */
  bench: number;
  /** 해금한 초월 */
  trans: string[];
  /** 유물 보유 효과 (모든 피해 배수) */
  relicDmg: number;
  /** 치트 코드: 카드마다 다시 뽑기 횟수 · 높은 등급 확률 */
  cheatReroll: number;
  cheatLuck: boolean;
  /** 낀 치트 연구 (화면 표시) */
  cheat: string;
  /** 끈기 판 수 · 모든 피해 배수 */
  grit: number;
  gritDmg: number;
  /** 보물방 웨이브 (0 = 없음) */
  treasure: number;
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
  const fslots = clampInt(lo?.fslots, 0, FRES_MAX);
  // 공용 칸엔 공동 연구만, 세력 칸엔 세력 연구만
  const res = [
    ...uniq(lo?.res, (s) => RES[s]?.group === "general", RES_SLOTS),
    ...uniq(lo?.res, (s) => !!RES[s] && RES[s].group !== "general", fslots),
  ];
  const relics = uniq(lo?.relics, (s) => !!RELIC[s], RELIC_SLOTS);
  // 레벨은 장착한 것만, 2 이상만 (1 은 기본이라 안 적음 — 예전 기록과 모양이 같게)
  const lvs = (src: Record<string, number> | undefined, ids: string[], max: number) => {
    const o: Record<string, number> = {};
    for (const id of ids) {
      const n = clampInt(src?.[id], 1, max);
      if (n > 1) o[id] = n;
    }
    return o;
  };
  return {
    lv,
    res,
    relics,
    glitch: clampInt(lo?.glitch, 0, GLITCH_MAX),
    resLv: lvs(lo?.resLv, res, RES_MAX_LV),
    relicLv: lvs(lo?.relicLv, relics, RELIC_MAX_LV),
    bench: Number.isInteger(lo?.bench) ? clampInt(lo?.bench, BENCH_BASE, BENCH_MAX) : BENCH_BASE,
    fslots,
    own: Object.fromEntries(
      Object.entries(lo?.own ?? {})
        .filter(([k]) => !!RELIC[k])
        .map(([k, v]) => [k, clampInt(v, 1, RELIC_MAX_LV)])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    ),
    trans: uniq(lo?.trans, (s) => (TRANS_IDS as readonly string[]).includes(s), TRANS_IDS.length).sort(),
    cheat: typeof lo?.cheat === "string" && CHEAT_RES_OF[lo.cheat] ? lo.cheat : "",
    grit: clampInt(lo?.grit, 0, GRIT_MAX),
    treasure: treasureWaveOk(lo?.treasure) ? (lo!.treasure as number) : 0,
  };
}

/** 유물 보유 효과 합 (%) */
export function relicPassive(own: Record<string, number> | undefined): number {
  let p = 0;
  for (const [id, lv] of Object.entries(own ?? {})) if (RELIC[id]) p += RELIC_PASSIVE[RELIC[id].tier] * lv;
  return Math.round(p * 10) / 10;
}

export function modsOf(lo: Loadout | null | undefined): Mods {
  const L = cleanLoadout(lo);
  const r = new Set(L.res);
  const x = new Set(L.relics);
  /** 장착한 연구 수치 (안 끼면 0) */
  const R = (id: string) => (r.has(id) ? RES[id].val(L.resLv[id] ?? 1) : 0);
  /** 장착한 유물 레벨 (안 끼면 0) */
  const X = (id: string) => (x.has(id) ? (L.relicLv[id] ?? 1) : 0);
  const has = (id: string) => x.has(id);
  return {
    lv: L.lv,
    startGold: R("g_gold"),
    startStones: R("g_stone"),
    startLuck: has("lucky_clover") ? V.lucky_clover(X("lucky_clover")) : 0,
    summonDisc: R("g_summon"),
    waveGold: (1 + R("g_wave") / 100) * (1 + (has("gold_gear") ? V.gold_gear_wave(X("gold_gear")) : 0) / 100),
    sellMult: 1 + R("g_sell") / 100,
    bossSec: R("g_boss") + (has("hourglass") ? V.hourglass(X("hourglass")) : 0) + GLITCH[L.glitch].bossSec,
    fac: {
      knight: 1 + R("k_drill") / 100,
      mech: 1 + R("m_drill") / 100,
      arcane: 1 + R("a_drill") / 100,
    },
    knightBig: R("k_tactic") / 100,
    facAspd: { knight: R("k_rally") / 100, mech: R("m_tune") / 100, arcane: R("a_echo") / 100 },
    mechBoss: 1 + R("m_bounty") / 100,
    arcaneFx: 1 + R("a_focus") / 100,
    killGold: has("gold_gear") ? V.gold_gear(X("gold_gear")) : 0,
    firstHarvest: has("first_harvest") ? V.first_harvest(X("first_harvest")) : 0,
    riftCd: has("rift_compass") ? 1 - V.rift_cd(X("rift_compass")) / 100 : 1,
    riftStone: has("rift_compass") ? V.rift_stone(X("rift_compass")) : 0,
    gamble: has("gambler_coin") ? V.gambler_coin(X("gambler_coin")) / 100 : 0,
    alchemyGold: has("alchemy") ? V.alchemy_gold(X("alchemy")) : 0,
    alchemyStones: has("alchemy") ? V.alchemy_stone(X("alchemy")) : 0,
    vaccine: 1 + (has("vaccine") ? V.vaccine(X("vaccine")) : 0) / 100,
    pureBlood: 1 + (has("pure_blood") ? V.pure_blood(X("pure_blood")) : 0) / 100,
    rainbow: 1 + (has("rainbow") ? V.rainbow(X("rainbow")) : 0) / 100,
    twinStar: has("twin_star") ? V.twin_star(X("twin_star")) / 100 : 0,
    warBanner: has("war_banner") ? V.war_banner(X("war_banner")) / 100 : 0,
    glitch: GLITCH[L.glitch],
    res: L.res,
    relics: L.relics,
    resLv: L.resLv,
    relicLv: L.relicLv,
    bench: L.bench,
    trans: L.trans,
    relicDmg: 1 + relicPassive(L.own) / 100,
    cheatReroll: CHEAT_REROLL + (L.cheat === "x_reroll" ? 1 : 0),
    cheatLuck: L.cheat === "x_luck",
    cheat: L.cheat,
    grit: L.grit,
    gritDmg: 1 + GRIT_PER * L.grit,
    treasure: L.treasure,
  };
}

/* ───────────────────────── 유닛 레벨업 ───────────────────────── */

/** lv → lv+1 에 드는 카드 · 조각 */
export const LV_COST: { cards: number; pieces: number }[] = [
  { cards: 5, pieces: 50 },
  { cards: 10, pieces: 100 },
  { cards: 15, pieces: 180 },
  { cards: 25, pieces: 300 },
  { cards: 38, pieces: 450 },
  { cards: 50, pieces: 650 },
  { cards: 75, pieces: 900 },
  { cards: 100, pieces: 1200 },
  { cards: 150, pieces: 1600 },
  { cards: 200, pieces: 2200 },
];

/**
 * 등급별 레벨업 조각 배수 — 같은 +3% 라도 신화 · 히든은 원래 피해가 훨씬 커서 실제로 늘어나는 피해가 큼 → 더 비싸게.
 * (카드는 같은 수: 높은 등급은 판에서 얻기 어려워 카드 모으는 데서 이미 오래 걸림)
 */
export const LV_GRADE_MULT = [0.5, 0.7, 1, 1.4, 2, 2, 3];
export function lvCost(grade: number, lv: number): { cards: number; pieces: number } {
  const c = LV_COST[Math.max(0, Math.min(UNIT_MAX_LV - 1, lv))];
  return { cards: c.cards, pieces: Math.round((c.pieces * (LV_GRADE_MULT[grade] ?? 1)) / 10) * 10 };
}

/**
 * 일괄 강화 계획 — 가진 카드 · 조각으로 할 수 있는 만큼 (서버 · 화면 미리보기가 같은 함수).
 * ids 순서대로 한 바퀴씩 1레벨씩 올리고, 조각이 모자라면 싼 것부터 계속 → 낮은 레벨이 고르게 오름.
 * 결과: 유닛별 오를 레벨 수 · 쓸 카드 · 조각 (lv · cards 는 바꾸지 않음)
 */
export function planUpAll(
  units: { id: string; grade: number }[],
  lv: Record<string, number>,
  cards: Record<string, number>,
  pieces: number,
): { ups: Record<string, number>; cards: Record<string, number>; pieces: number; n: number } {
  const L: Record<string, number> = {};
  const C: Record<string, number> = {};
  for (const u of units) {
    L[u.id] = lv[u.id] ?? 0;
    C[u.id] = cards[u.id] ?? 0;
  }
  const ups: Record<string, number> = {};
  const used: Record<string, number> = {};
  let left = pieces;
  let n = 0;
  for (;;) {
    let best: { id: string; grade: number } | null = null;
    let bc = 0;
    for (const u of units) {
      if (L[u.id] >= UNIT_MAX_LV) continue;
      const c = lvCost(u.grade, L[u.id]);
      if (C[u.id] < c.cards || left < c.pieces) continue;
      // 레벨 낮은 것 먼저, 같으면 조각 싼 것
      if (!best || L[u.id] < L[best.id] || (L[u.id] === L[best.id] && c.pieces < bc)) {
        best = u;
        bc = c.pieces;
      }
    }
    if (!best) break;
    const c = lvCost(best.grade, L[best.id]);
    C[best.id] -= c.cards;
    used[best.id] = (used[best.id] ?? 0) + c.cards;
    left -= c.pieces;
    L[best.id]++;
    ups[best.id] = (ups[best.id] ?? 0) + 1;
    n++;
  }
  return { ups, cards: used, pieces: pieces - left, n };
}

/** 오염 단계를 처음 클리어하면 (단계마다 한 번) */
export const glitchFirstClear = (g: number) => ({ cores: 3 + g, relicBox: 1 + Math.floor(g / 10) });
/** 하루 첫 판 (검증된 판) 픽셀 조각 배수 */
export const FIRST_RUN_MULT = 2;
/** 처음 얻은 유닛 (도감 수집) 보상 — 에픽부터 */
export function collectReward(grade: number): { pieces: number; cores?: number } | null {
  return grade >= 6 ? { pieces: 800, cores: 8 } : grade >= 5 ? { pieces: 500, cores: 5 } : grade === 4 ? { pieces: 300, cores: 3 } : grade === 3 ? { pieces: 100 } : grade === 2 ? { pieces: 40 } : null;
}

/* ───────────────────────── 판 보상 (서버가 검증 뒤 계산) ───────────────────────── */

export type RunMode = "season" | "multi";

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

/** 다음 오염 단계가 열리는 웨이브 (그 단계에서 이만큼 버티거나 클리어) — 10단계부터(심연으로 가는 문)는 클리어해야 열림 */
export const GLITCH_UNLOCK_WAVE = 40;
export const GLITCH_DEEP_FROM = 10;
export const glitchUnlocks = (glitch: number, r: { win: boolean; wave: number }) =>
  r.win || (glitch < GLITCH_DEEP_FROM && r.wave >= GLITCH_UNLOCK_WAVE);

/* ───────────────────────── 상점 상자 (상품별로 따로) ───────────────────────── */

/**
 * 카드 상자: 무작위 유닛 카드 (낮은 등급이 잘 나옴) — 픽셀 조각
 * 유물 상자: 유물 하나 (희귀도 확률) — 가진 유물이면 그 유물 조각 +1 (유물 강화 재료) — 글리치 코어
 * 초월 소환: 15% 로 초월 셋 중 하나 (처음이면 해금 · 이미 있으면 그 유닛 카드) — 아니면 게임 재화.
 *   천장: 초월 없이 9번 넘기면 10번째는 반드시 초월 (pity = 마지막 초월 뒤로 돌린 수) — 글리치 코어
 * GP 로는 상점의 재화샵 · 패키지에서만 (GP_STORE · GP_PACKS)
 */
export const BOX = {
  card: { pieces: 300, n: 12 },
  relic: { cores: 12, tierOdds: [0.6, 0.3, 0.1] },
  trans: { cores: 40, rate: 0.15, pity: 10, dupCards: 15 },
} as const;
/** 초월 소환에서 초월이 안 나오면 (85%) — 가중치대로 하나 */
export const TRANS_MISS: { w: number; give: Goods }[] = [
  { w: 50, give: { pieces: 600 } },
  { w: 30, give: { cores: 8 } },
  { w: 20, give: { cardBox: 2 } },
];
/**
 * 초월 소환 한 번 (서버 · 성장 시뮬이 같은 함수). r() 은 [0,1) 난수.
 * 결과 pity 는 저장할 새 값 (초월이 나오면 0).
 */
export function transRoll(pity: number, r: () => number): { pity: number; trans?: string; give?: Goods } {
  const n = Math.max(0, pity | 0) + 1;
  if (n >= BOX.trans.pity || r() < BOX.trans.rate) {
    return { pity: 0, trans: TRANS_IDS[Math.min(TRANS_IDS.length - 1, Math.floor(r() * TRANS_IDS.length))] };
  }
  const sum = TRANS_MISS.reduce((a, m) => a + m.w, 0);
  let x = r() * sum;
  const m = TRANS_MISS.find((t) => (x -= t.w) < 0) ?? TRANS_MISS[0];
  return { pity: n, give: m.give };
}

/* ───────────────────────── 상점: 재화샵 · 패키지 (GP) ───────────────────────── */

/** 상점에서 오가는 것 (게임 재화 · 상자 · 초월 소환 · 꾸미기) */
export interface Goods {
  pieces?: number;
  cores?: number;
  cardBox?: number;
  relicBox?: number;
  /** 초월 상자 (초월 소환 1번씩 — 상점 「상자 · 소환」 탭에서 열기) */
  trans?: number;
  /** 꾸미기 id (inv.defense) */
  item?: string;
}
/**
 * GP 기준값 — 재화샵 값 (= 100%). 패키지 이득 % 는 이 값으로 셈.
 * 조각 2GP · 코어 250GP · 카드 상자 600GP(=300조각) · 유물 상자 3,000GP(=12코어) · 초월 소환 10,000GP(=40코어)
 */
export const GP_VALUE = { pieces: 2, cores: 250, cardBox: 600, relicBox: 3000, trans: 10_000 } as const;
export const goodsGp = (g: Goods) =>
  (g.pieces ?? 0) * GP_VALUE.pieces +
  (g.cores ?? 0) * GP_VALUE.cores +
  (g.cardBox ?? 0) * GP_VALUE.cardBox +
  (g.relicBox ?? 0) * GP_VALUE.relicBox +
  (g.trans ?? 0) * GP_VALUE.trans;

export interface StoreItem {
  id: string;
  name: string;
  gp: number;
  give: Goods;
}
/** 재화샵: GP → 게임 재화 (효율 낮음 — 판에서 버는 게 훨씬 빠름. 급할 때 · 남는 GP 용) · 횟수 제한 없음 */
export const GP_STORE: StoreItem[] = [
  { id: "s_pieces", name: "픽셀 조각 500", gp: 1000, give: { pieces: 500 } },
  { id: "s_cores", name: "글리치 코어 4", gp: 1000, give: { cores: 4 } },
  { id: "s_card", name: "카드 상자", gp: 600, give: { cardBox: 1 } },
  { id: "s_relic", name: "유물 상자", gp: 3000, give: { relicBox: 1 } },
];
export interface SellItem {
  id: string;
  name: string;
  /** 내는 게임 재화 */
  pay: { pieces?: number; cores?: number };
  gp: number;
  perWeek: number;
}
/** 재화 → GP: 재화샵 값의 절반 (조각 1,000 = 재화샵 2,000GP → 1,000GP) */
export const GP_SELL: SellItem[] = [
  { id: "x_pieces", name: "픽셀 조각 1,000 → GP", pay: { pieces: 1000 }, gp: 1000, perWeek: 3 },
  { id: "x_cores", name: "글리치 코어 4 → GP", pay: { cores: 4 }, gp: 500, perWeek: 2 },
];

export interface PackDef {
  id: string;
  name: string;
  desc: string;
  gp: number;
  give: Goods;
  /** 한 번만 (계정) */
  once?: boolean;
  /** 주마다 (once · perDay 가 아니면) */
  perWeek?: number;
  /** 하루마다 (한국 시간 0시에 다시) */
  perDay?: number;
  /** 이 오염 단계를 클리어해야 보임 */
  needWin?: number;
}
/** 패키지: GP 로만. 재화샵 값의 3~8배 (이득 % = goodsGp ÷ gp) — 일일 300% · 주간 550~670% · 한 번짜리 520~800% */
export const GP_PACKS: PackDef[] = [
  { id: "p_daily", name: "일일 보급 꾸러미", desc: "매일 — 조각 · 카드 상자", gp: 500, perDay: 1, give: { pieces: 450, cardBox: 1 } },
  { id: "p_start", name: "신입 수호자 꾸러미", desc: "처음 한 번 — 정비소를 빠르게 시작", gp: 1000, once: true, give: { pieces: 1500, cardBox: 2, cores: 4 } },
  { id: "p_week", name: "주간 보급 꾸러미", desc: "매주 — 조각 · 카드 · 코어", gp: 1500, perWeek: 1, give: { pieces: 2500, cardBox: 3, cores: 6 } },
  { id: "p_relic", name: "유물 탐사 꾸러미", desc: "매주 — 유물 상자 3 + 강화용 코어", gp: 2000, perWeek: 1, give: { relicBox: 3, cores: 8 } },
  { id: "p_trans", name: "초월 계약 꾸러미", desc: "매주 — 초월 상자 2개", gp: 3000, perWeek: 1, give: { trans: 2 } },
  { id: "p_forest", name: "픽셀 숲 꾸러미", desc: "한 번 — 블록 테마 「픽셀 숲」 + 조각 · 카드", gp: 3000, once: true, give: { item: "theme.forest", pieces: 3000, cardBox: 5 } },
  { id: "p_deep10", name: "심연 개척 꾸러미", desc: "오염 10단계 클리어 뒤 한 번", gp: 4000, once: true, needWin: 10, give: { pieces: 6000, cores: 16, relicBox: 2, trans: 1 } },
  { id: "p_deep20", name: "심연 정복 꾸러미", desc: "오염 20단계 클리어 뒤 한 번", gp: 6000, once: true, needWin: 20, give: { pieces: 10000, cores: 24, relicBox: 3, trans: 1 } },
];
export const PACK: Record<string, PackDef> = Object.fromEntries(GP_PACKS.map((x) => [x.id, x]));
/** 패키지 이득 % (재화샵 값 대비, 꾸미기는 셈에서 뺌) */
export const packPct = (pk: PackDef) => Math.round((goodsGp(pk.give) / pk.gp) * 100);

/** 유물 희귀도 값 (일반 · 희귀 · 전설) — 강화 코어 계산용 (유물은 상자에서만 나옴) */
export const RELIC_CORE_PRICE = [8, 15, 30] as const;
/** 최고 레벨까지 더 필요한 유물 조각 (지금 레벨 lv 에서) */
export const relicShardsToMax = (id: string, lv: number) => {
  let n = 0;
  for (let l = Math.max(1, lv); l < RELIC_MAX_LV; l++) n += relicUpCost(id, l).shards;
  return n;
};
/** 겹친 유물인데 조각이 이미 최고 레벨까지 충분하면 조각 대신 글리치 코어 (일반 · 희귀 · 전설) */
export const RELIC_DUP_CORES = [3, 5, 8] as const;
/** 유물 lv → lv+1: 그 유물 조각(같은 유물이 또 나오면 1개) lv 개 + 코어 (희귀도 값 × lv ÷ 2) */
export const relicUpCost = (id: string, lv: number) => ({
  shards: lv,
  cores: Math.ceil(((RELIC_CORE_PRICE[RELIC[id]?.tier ?? 0] ?? 0) * lv) / 2),
});

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

/* ───────────────────────── 시즌 패스 ───────────────────────── */

export interface PassReward {
  pieces?: number;
  cores?: number;
  /** 카드 상자 · 유물 상자 */
  cardBox?: number;
  relicBox?: number;
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
    t % 10 === 0 ? { cores: 5, gp: 300, relicBox: 1 } : t % 5 === 0 ? { cardBox: 2, gp: 100 } : t % 2 === 0 ? { pieces: 150 } : { pieces: 100 };
  const premium: PassReward =
    t === 30
      ? { item: "theme.gold", cores: 10 }
      : t === 20
        ? { item: "theme.neon", cores: 5 }
        : t === 10
          ? { item: "theme.ice", cores: 5 }
          : t % 3 === 0
            ? { relicBox: 1 }
            : { pieces: 200, cardBox: 1 };
  return { xp, free, premium };
});
/** 프리미엄 줄 값 (GP) */
export const PASS_PREMIUM_GP = 5000;

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
