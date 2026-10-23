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
import { PATCHES } from "./meta";
import { EXP_RELICS } from "./town";
import { ENGRAVES, type Engr, type EngrId } from "./engrave";
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
  /** 스테이지 — 없거나 "main" = 글리치 시티 (기본) · "town" = 픽셀 타운 */
  stage?: Stage;
  /** 픽셀 타운 단계 1..TOWN_MAX (stage 가 town 일 때만 씀) */
  town?: number;
  /** 글리치 원정: 해금한 시작 분대 (knight · mech · arcane) */
  squads?: string[];
  /** 유닛 각인 (유닛 id → 특성 · 등급) — engrave.ts */
  engr?: Record<string, Engr>;
  /** 원정 칸에 낀 원정 유물 (RELIC from "town" — 글리치 원정 첫 클리어로 얻음, 일반 칸과 따로) */
  trelic?: string;
  /** 원정 보스로 해금한 시작 치트 (meta.ts PATCHES 의 lock 있는 것) */
  patches?: string[];
  /** 원정 유물 도감 (찾은 원정 유물 id) — 수가 차면 새 유물이 원정 풀에 */
  expSeen?: string[];
}

/* ───────────────────────── 스테이지 ───────────────────────── */

export type Stage = "main" | "town";
/**
 * 글리치 원정 (stage "town" · 로그라이크 확장 모드) — 메인(글리치 시티)을 밀면 원정 단계 상한이 열리고, 성장을 앞당겨 주는 곳.
 *  - 원정 단계 N 은 「메인 오염 townNeed(N) 열기」와 「원정 N-1 단계 클리어」 둘 다 (townAvail)
 *  - 적 세기 = 메인 오염 townGlitchLv(단계) 수준 · 보상은 그 단계 × TOWN_REWARD · 단계마다 비틀기 (town.ts EXP_ASC)
 *  - 규칙: 지도 · 분대 · 드래프트 · 원정 유물 · 기믹 엘리트 · 보스 (town.ts · sim.ts 글리치 원정)
 */
export const TOWN_FROM = 6;
export const TOWN_EVERY = 2;
export const TOWN_MAX = 23;
export const TOWN_REWARD = 1.3;
/** 메인에서 연 오염 단계 → 열린 픽셀 타운 단계 (0 = 아직) */
export const townOpenOf = (glitchOpen: number) =>
  glitchOpen < TOWN_FROM ? 0 : Math.min(TOWN_MAX, 1 + Math.floor((glitchOpen - TOWN_FROM) / TOWN_EVERY));
/** 지금 고를 수 있는 원정 단계 상한 — 메인 조건 · 바로 아래 단계 클리어 둘 다 (done = 클리어한 단계들) */
export const townAvail = (glitchOpen: number, done: readonly number[] = []) =>
  Math.min(townOpenOf(glitchOpen), (done.length ? Math.max(...done) : 0) + 1);
/** 이 픽셀 타운 단계가 열리는 메인 오염 단계 */
export const townNeed = (lv: number) => TOWN_FROM + (Math.max(1, lv) - 1) * TOWN_EVERY;
/** 픽셀 타운 단계의 적 세기 (메인 오염 단계로) */
export const townGlitchLv = (lv: number) => Math.min(GLITCH_MAX, TOWN_TUNE.off + 2 * Math.max(1, Math.min(TOWN_MAX, lv)));
/**
 * 원정 단계 → 오염 단계 = off + 2 × 단계 · hpTo 단계까지는 적 체력 × hp (시뮬이 바꿔 볼 수 있게 객체)
 * 2026-10-22: 원정 11~15 를 사람이 거의 첫 판에 깸 → 14단계(오염 30)까지 적 체력 ×1.3.
 *  15단계(오염 32)부터는 31단계 체력 점프가 그대로 들어와서 따로 안 올림
 */
export const TOWN_TUNE = { off: 2, hp: 1.3, hpTo: 14 };
/** 원정 단계의 오염 단계 규칙 (적 체력 배수까지) */
export const townGlitch = (lv: number): GlitchDef => {
  const g = GLITCH[townGlitchLv(lv)];
  return lv <= TOWN_TUNE.hpTo ? { ...g, hp: Math.round(g.hp * TOWN_TUNE.hp * 100) / 100 } : g;
};
/** 픽셀 타운 단계를 처음 클리어하면 */
export const townFirstClear = (lv: number): Goods => ({ cores: 4 + lv, relicBox: 1, cardBox: 1 });
/** 해피 타운 단계 첫 클리어로만 얻는 유물 (상자에선 안 나옴) */
export const TOWN_RELIC: Record<number, string> = { 5: "lucky_dice", 10: "golden_deed", 15: "moa_card", 20: "forte_box" };

/* ───────────────────────── 오늘의 도전 ───────────────────────── */

/** 오늘의 도전: 모두 같은 시드(날짜) · 영구 성장 없이 이 규칙으로 — 실력만 겨룸 */
export const DAILY_RULE: Loadout = { glitch: 0 };
/**
 * 오늘의 도전 그날 첫 완료 보상 — 연 오염 단계(glitchOpen)가 높을수록 많이.
 * 조각 = 1,000 × 그 단계 시즌 보상 배율 (50 단위), 코어 = 5 + 단계
 */
export const dailyFirstOf = (g: number): Goods => {
  const lv = Math.max(0, Math.min(GLITCH_MAX, g));
  return { pieces: Math.round((1000 * GLITCH[lv].reward) / 50) * 50, cores: 5 + lv };
};

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
 * 다 깎으면 조각 ≈ 일반 판 2~3판 몫 · 코어 ≈ 클리어 한 번 몫 (골드는 안 줌 — 판 밖 재화만)
 */
export function treasureReward(glitch: number, t: { dmg: number; max: number; killed: boolean }): Goods {
  const g = GLITCH[Math.max(0, Math.min(GLITCH_MAX, glitch))];
  const r = t.max > 0 ? Math.max(0, Math.min(1, t.dmg / t.max)) : 0;
  return {
    pieces: Math.round(800 * r * g.reward),
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
/** 오염 RELIC_SLOT4_WIN 단계를 클리어하면 일반 유물 칸 +1 */
export const RELIC_SLOT4_WIN = 30;
export const RELIC_SLOTS_MAX = 4;
/** 장착 프리셋 칸 수 · 프리셋 (연구 · 유물 · 치트 연구 · 원정 칸 — 오염 단계는 안 담음) */
export const PRESET_MAX = 3;
export interface LoadPreset {
  name: string;
  res: string[];
  relics: string[];
  cheat?: string;
  trelic?: string;
}
export const relicSlotsOf = (glitchWin: number) => (glitchWin >= RELIC_SLOT4_WIN ? RELIC_SLOTS_MAX : RELIC_SLOTS);
/** 원정 유물 (글리치 원정 첫 클리어로만) — 일반 3칸과 따로 원정 칸 1칸 */
export const isTownRelic = (id: string) => RELIC[id]?.from === "town";
export const GLITCH_MAX = 50;
/** 심연 1막 끝 (예전 마지막 단계 — 업적 · 문구 기준) */
export const GLITCH_ACT1 = 30;

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
  /** 얻는 곳 — 없으면 유물 상자 · deep = 오염 30 클리어 뒤 유물 상자 · town = 해피 타운 단계 첫 클리어(상자에선 안 나옴) */
  from?: "deep" | "town";
}

/**
 * 2026-10-21: 전설이 희귀 · 골드 유물보다 약하다는 말 + 시뮬(오염 22, 전설 조합 클리어 0~20% vs 희귀 80% · 골드 50%) → 전설 수치 1.2~1.9배 (더 올리면 오염 50까지 봇 시간이 40h 밑으로 떨어짐)
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
  pure_blood: (l: number) => rd(35 * sc(l, 0.15)),
  twin_star: (l: number) => rd(15 * sc(l, 0.15)),
  war_banner: (l: number) => rd(70 * sc(l, 0.15)) / 10,
  // 2026-10-22 전설 유물 규칙 (수치보다 플레이가 바뀌게)
  pure_steer: (l: number) => rd(25 * sc(l, 0.15)),
  // 2026-10-22 (3): 수치를 올려도 골드 · 희귀에서 넘어갈 이유(도파민)가 없다는 말 → 무지개 · 전쟁 깃발을 「터지는 순간」이 있는 규칙으로 바꿈
  rainbow_every: (l: number) => (l >= 5 ? 20 : l >= 3 ? 25 : 30),
  rainbow_leg: (l: number) => rd(10 * sc(l, 0.2)),
  war_every: (l: number) => (l >= 5 ? 6 : l >= 3 ? 8 : 10),
  war_free: (_l: number) => 1,
  // 심연 2막 (오염 30 클리어 뒤 상자) · 해피 타운 첫 클리어
  myth_seal: (l: number) => rd(30 * sc(l, 0.15)),
  overdrive: (l: number) => rd(20 * sc(l, 0.15)),
  seal_refund: (l: number) => rd(25 * sc(l, 0.15)),
  over_boss: (l: number) => rd(60 * sc(l, 0.15)),
  chrono_core: (l: number) => rd(6 * sc(l, 0.2)),
  void_stone: (l: number) => rd(30 * sc(l, 0.2)),
  lucky_dice: (l: number) => (l >= 5 ? 4 : l >= 3 ? 3 : 2),
  golden_deed: (l: number) => (l >= 4 ? 2 : 1),
  moa_card: (l: number) => rd(30 * sc(l, 0.2)),
  moa_reroll: (l: number) => rd(25 * sc(l, 0.15)),
  forte_box: (l: number) => rd(25 * sc(l, 0.15)),
};
const V = RELIC_VAL;

const relic = (id: string, name: string, at: (l: number) => string, tier: RelicDef["tier"], route: RelicDef["route"], from?: RelicDef["from"]): RelicDef => ({
  id,
  name,
  at,
  tier,
  route,
  desc: at(1),
  ...(from && { from }),
});
/** 심연 2막 유물이 상자에 나오기 시작하는 클리어 단계 */
export const DEEP_RELIC_WIN = 30;

export const RELICS: RelicDef[] = [
  relic("gold_gear", "황금 톱니", (l) => `적 처치 골드 +${V.gold_gear(l)}${V.gold_gear_wave(l) ? ` · 웨이브 골드 +${V.gold_gear_wave(l)}%` : ""}`, 0, "eco"),
  relic("first_harvest", "첫 수확", (l) => `1~${V.first_harvest(l)}웨이브 동안 웨이브 골드 2배`, 0, "eco"),
  relic("lucky_clover", "네잎클로버", (l) => `소환 확률 강화 ${V.lucky_clover(l)}단계를 들고 시작`, 0, "any"),
  relic("rift_compass", "균열 나침반", (l) => `균열 다시 열기 ${V.rift_cd(l)}% 빠름 · 닫으면 행운석 +${V.rift_stone(l)}`, 0, "gamble"),
  relic("gambler_coin", "도박꾼의 동전", (l) => `행운석 도박 성공률 +${V.gambler_coin(l)}%p`, 1, "gamble"),
  relic("hourglass", "시간의 모래", (l) => `보스 제한 시간 +${V.hourglass(l)}초`, 1, "boss"),
  relic("alchemy", "연금술 노트", (l) => `조합식으로 신화 · 히든을 만들면 골드 +${V.alchemy_gold(l)} · 행운석 +${V.alchemy_stone(l)}`, 1, "any"),
  relic("vaccine", "글리치 백신", (l) => `보스 · 엘리트 · 균열 적에게 주는 피해 +${V.vaccine(l)}%`, 1, "boss"),
  relic("pure_blood", "순수 혈통", (l) => `소환이 ${V.pure_steer(l)}% 확률로 필드에서 가장 많은 세력으로 나와요 · 한 세력이 ${Math.round(TUNE.pureFrom * 100)}% 이상이면 (보관함 제외) 모든 피해 +${V.pure_blood(l)}%`, 2, "mono"),
  relic("rainbow", "무지개 프리즘", (l) => `소환 ${V.rainbow_every(l)}번마다 무지개 소환 — 에픽 이상 확정, ${V.rainbow_leg(l)}% 확률로 레전드 (세력 상관없이 어떤 길에도)`, 2, "any"),
  relic("twin_star", "쌍둥이 별", (l) => `레전드 이상을 얻을 때 ${V.twin_star(l)}% 확률로 같은 등급 같은 세력 1기 더 (빈 칸이 있으면)`, 2, "any"),
  relic("war_banner", "전쟁 깃발", (l) => `세력 강화 레벨 합이 ${V.war_every(l)}의 배수를 넘을 때마다 그 세력 레전드 1기 (필드가 꽉 차면 그 세력 가장 낮은 칸 한 등급 업) · 보스를 잡으면 세 세력 강화 +${V.war_free(l)} (공짜) · 강화 합 10마다 모든 피해 +${V.war_banner(l)}%`, 2, "mix"),
  relic("myth_seal", "신화의 인장", (l) => `조합식으로 신화 · 히든 · 초월을 만들면 ${V.seal_refund(l)}% 확률로 재료 중 가장 높은 유닛 1기가 돌아와요 · 신화 이상 피해 +${V.myth_seal(l)}%`, 2, "any", "deep"),
  relic("overdrive", "과부하 회로", (l) => `모든 유닛 공격 속도 +${V.overdrive(l)}% · 필드에 적이 많을수록 더 (1마리당 +0.5%, 최대 +${V.over_boss(l)}% · 보스가 있으면 최대)`, 2, "any", "deep"),
  relic("chrono_core", "크로노 코어", (l) => `보스 제한 시간 +${V.chrono_core(l)}초 · 보스 처치 골드 +50%`, 1, "boss", "deep"),
  relic("void_stone", "공허석", (l) => `균열 적에게 주는 피해 +${V.void_stone(l)}% · 균열을 닫으면 행운석 +1`, 1, "gamble", "deep"),
  relic("lucky_dice", "행운 주사위", (l) => `보스를 잡으면 무료 소환 ${V.lucky_dice(l)}회`, 1, "any", "town"),
  relic("golden_deed", "황금 지도", (l) => `적 처치 골드 +${V.golden_deed(l)} · 글리치 원정 시작 골드 +${V.golden_deed(l) * 100}`, 1, "eco", "town"),
  relic("moa_card", "MOA 의 명함", (l) => `에픽 이하를 팔면 ${V.moa_reroll(l)}% 확률로 같은 등급 무작위 유닛이 나와요 · 판매 금액 +${V.moa_card(l)}% · 레전드 이상을 팔면 행운석 +1`, 2, "eco", "town"),
  relic("forte_box", "FORTE 의 오르골", (l) => `궁극기를 쓰면 필드의 다른 궁극기 유닛 모두 충전 +1 (연쇄) · 공격할 때 ${V.forte_box(l)}% 확률로 궁극기 충전 +1`, 2, "any", "town"),
];
export const RELIC: Record<string, RelicDef> = Object.fromEntries(RELICS.map((r) => [r.id, r]));
export const relicDesc = (id: string, lv = 1) => RELIC[id]?.at(lv) ?? "";

/* ───────────────────────── 오염 단계 ───────────────────────── */

/**
 * 심연 변이 (판의 규칙이 바뀜 — 숫자만 오르는 것 말고):
 *  split 분열 (16단계+): 엘리트 · 대형 적이 쓰러지면 체력 30% 짜리 둘로 갈라짐
 *  lock  봉인 (21단계+): 웨이브마다 유닛이 있는 칸 2개가 그 웨이브 동안 봉인(공격 안 함) — 유닛을 다른 칸으로 옮기면 풀림
 */
export type Mutator = "split" | "lock" | "rush" | "ward" | "fog";
export const MUTATORS: Record<Mutator, { name: string; desc: string; from: number }> = {
  split: { name: "분열", desc: "엘리트 · 대형 적이 쓰러지면 체력 30% 짜리 둘로 갈라져요", from: 16 },
  lock: { name: "봉인", desc: "웨이브마다 유닛이 있는 칸 2개가 봉인돼 공격을 못 해요 — 다른 칸으로 옮기면 풀려요", from: 21 },
  rush: { name: "정예", desc: "모든 일반 웨이브 마지막 적이 엘리트예요 (원래는 5웨이브마다)", from: 35 },
  ward: { name: "방벽", desc: "보스가 최대 체력 15% 보호막을 두르고 나와요", from: 40 },
  fog: { name: "안개", desc: "모든 유닛 사거리 -0.5칸", from: 45 },
};
export const mutatorsOf = (lv: number): Mutator[] => (Object.keys(MUTATORS) as Mutator[]).filter((m) => lv >= MUTATORS[m].from);

export interface GlitchDef {
  lv: number;
  /** 심연 변이 (MUTATORS) */
  mut?: Mutator[];
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
 * 11~30단계 (심연): 10단계 위에 한 단계마다 적 체력 +9.5%(10단계 기준, 26~30은 +8%) · 보상 +0.1, 5단계마다 새 규칙 (DEEP_PARAMS)
 * 31~50단계 (심연 2막): 한 단계마다 +12% — 30 클리어로 여는 유물 4칸 · 각인이 받쳐 줌
 *  11~ 방어력 · 15~ 보스 체력 · 20~ 속도 · 방어력 더 · 25~ 보스 체력 더 · 보스 시간 -18 · 30 끝
 *  (다 키운 봇이 30단계를 다섯 판에 한 번쯤 깨는 정도 — 사람은 배치 · 초월이 더 나아서 이보다 쉬움)
 */
const x100 = (v: number) => `×${v}`;
const deepRule = (P: DeepParams): Record<number, string> => ({
  11: `심연 — 적 방어력 ${x100(P.armor11)}`,
  15: `보스 체력 ${x100(P.boss15)}`,
  20: `적 속도 ${x100(P.spd20)} · 방어력 ${x100(P.armor20)}`,
  25: `보스 체력 ${x100(P.boss25)} · 보스 시간 -18초`,
  30: "끝없는 오염 — 심연 1막 끝",
  31: "심연 2막 — 적 체력이 크게 올라요 (유물 4칸 · 각인 몫) · 보스 시간 -21초 · 보스 2페이즈 셋 (40 · 50 · 60웨이브)",
  35: "심연 변이 「정예」 · 보스 시간 -24초",
  40: "보스 6명 모두 2페이즈 · 심연 변이 「방벽」 · 보스 시간 -27초",
  45: "심연 변이 「안개」 · 보스 시간 -30초",
  50: `글리치의 심장 — 보스 체력 ${x100(P.boss50 ?? 1.1)} · 마지막 단계`,
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
  /** 26~30단계 기울기 (없으면 hpPerLv) — 30 클리어(유물 4칸 · 각인)를 열기 전 벽을 낮춤 */
  hpPerLv26?: number;
  /** 31단계부터 단계마다 적 체력 + (10단계 기준, 없으면 hpPerLv) · 50단계 보스 체력 */
  hpPerLv2?: number;
  boss50?: number;
  /** 31단계에서 한 번에 더하는 적 체력 (10단계 기준) — 30 클리어로 여는 유물 4칸 · 각인만큼 */
  jump31?: number;
}
// 2026-10-21: 30단계가 너무 세서 못 연다는 말 → 26~30 기울기 0.085 → 0.04, 대신 31~ 0.06 → 0.09 (30 클리어로 여는 유물 4칸 · 각인이 받쳐 줌)
// 2026-10-22: 「전반적으로 쉬워졌다」 + 다 키운 봇(유물 3칸 · 각인 없음)이 30 · 35 · 40을 50~90% 깨던 것 → 11~25 0.085 → 0.095 · 26~30 0.04 → 0.08
// 2026-10-22 (2): 「30 깨니까 그 뒤가 너무 쉬움」 — 사람 기록에서 31 · 32 · 33 을 한두 판에 깸 (예전 30은 7판). 31 체력이 옛 30보다 낮았고 유물 4칸 · 각인이 더해짐
//   → 31에서 한 번에 +1.2 (유물 4칸 · 각인 몫) · 31~ 0.12 → 0.13. 성장 시뮬(defense-econ)에서 31~50 단계마다 봇 3~20판 (26~30 과 비슷한 결)
export const DEEP_PARAMS: DeepParams = { hpPerLv: 0.095, armor11: 1.15, armor20: 1.28, boss15: 1.08, boss25: 1.15, spd20: 1.1, rewardPerLv: 0.1, hpPerLv26: 0.08, hpPerLv2: 0.13, boss50: 1.1, jump31: 1.2 };
/**
 * 심연 보스 제한 시간 (더함). 25~30 -18 · 2026-10-23: 31~ -21 · 35~ -24 · 40~ -27 · 45~ -30
 *  예전 30 언저리의 재미는 40 · 50 · 60 보스 시간초과(제한 42초)로 지는 판이 섞이는 것이었는데,
 *  치트 연구 「행운」으로 「시간 정지」(+15초)가 거의 매 판 나와 31~ 보스 제한이 57~63초가 되며 보스 벽이 사라졌음
 */
export const deepBossSec = (lv: number): number | null => (lv >= 45 ? -30 : lv >= 40 ? -27 : lv >= 35 ? -24 : lv >= 31 ? -21 : lv >= 25 ? -18 : null);
export function deepGlitch(P: DeepParams): GlitchDef[] {
  const top = BASE_GLITCH[10];
  const rules = deepRule(P);
  return Array.from({ length: GLITCH_MAX - 10 }, (_, i): GlitchDef => {
    const lv = 11 + i;
    // 31단계부터는 기울기 hpPerLv2 (새 유물 · 도시 개발 · 다 키운 성장이 받쳐 주는 만큼)
    const s26 = P.hpPerLv26 ?? P.hpPerLv;
    const k =
      lv <= 25
        ? P.hpPerLv * (lv - 10)
        : lv <= 30
          ? P.hpPerLv * 15 + s26 * (lv - 25)
          : P.hpPerLv * 15 + s26 * 5 + (P.jump31 ?? 0) + (P.hpPerLv2 ?? P.hpPerLv) * (lv - 30);
    const hp = Math.round(top.hp * (1 + k) * 100) / 100;
    return {
      lv,
      hp,
      spd: lv >= 20 ? P.spd20 : top.spd,
      bossSec: deepBossSec(lv) ?? top.bossSec,
      reward: Math.round((top.reward + (P.rewardPerLv ?? 0.1) * (lv - 10)) * 100) / 100,
      armor: lv >= 20 ? P.armor20 : P.armor11,
      boss: lv >= 50 ? P.boss25 * (P.boss50 ?? 1.1) : lv >= 25 ? P.boss25 : lv >= 15 ? P.boss15 : 1,
      mut: mutatorsOf(lv),
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
  /** 유닛 각인 (유닛 id → 특성 · 등급) */
  engr: Record<string, Engr>;
  /** 보물방 웨이브 (0 = 없음) */
  treasure: number;
  /** 스테이지 · 픽셀 타운 단계 (main 이면 0) */
  stage: Stage;
  town: number;
  /** 글리치 원정: 해금한 시작 분대 */
  squads: string[];
  patches: string[];
  expSeen: string[];
  /** 심연 2막 · 원정 유물 */
  mythDmg: number;
  aspdAll: number;
  bossGold: number;
  riftDmg: number;
  bossFree: number;
  /** 해피 타운 원정 시작 골드 + */
  /** 글리치 원정 시작 골드 + (황금 지도) */
  expGold: number;
  sellStone: number;
  ultCharge: number;
  /** 2026-10-22 전설 유물 규칙: 순수 혈통 소환 쏠림 · 무지개 소환 주기(0 없음) · 그 레전드 확률 · 전쟁 깃발 레전드 주기(강화 합, 0 없음) · 인장 재료 돌려받기 · 과부하 적 수 비례 공속 상한 · MOA 다시 굴리기 · 오르골 연쇄 (확률은 0~1) */
  pureSteer: number;
  rainbowEvery: number;
  rainbowLeg: number;
  warEvery: number;
  warFree: number;
  sealRefund: number;
  overBoss: number;
  moaReroll: number;
  forteChain: boolean;
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
  // 원정 유물(from town)은 일반 칸에 못 끼고 원정 칸(trelic) 하나에만 — 예전 기록에서 일반 칸에 낀 건 원정 칸으로 옮김
  const relics = uniq(lo?.relics, (s) => !!RELIC[s] && !isTownRelic(s), RELIC_SLOTS_MAX);
  const trelic =
    typeof lo?.trelic === "string" && isTownRelic(lo.trelic)
      ? lo.trelic
      : (uniq(lo?.relics, (s) => isTownRelic(s), 1)[0] ?? "");
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
    relicLv: lvs(lo?.relicLv, trelic ? [...relics, trelic] : relics, RELIC_MAX_LV),
    trelic,
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
    engr: Object.fromEntries(
      Object.entries(lo?.engr ?? {})
        .filter(([k, g]) => (!unitIds || unitIds.has(k)) && !!g && !!ENGRAVES[g.e as EngrId] && Number.isInteger(g.t) && g.t >= 0 && g.t <= 3)
        .map(([k, g]) => [k, { e: g.e, t: g.t }] as [string, Engr])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    ),
    treasure: lo?.stage === "town" ? 0 : treasureWaveOk(lo?.treasure) ? (lo!.treasure as number) : 0,
    stage: lo?.stage === "town" ? "town" : "main",
    town: lo?.stage === "town" ? clampInt(lo?.town, 1, TOWN_MAX) : 0,
    squads: ["knight", "mech", "arcane"].filter((q) => q === "knight" || (lo?.squads ?? []).includes(q)),
    patches: PATCHES.filter((p) => p.lock && (lo?.patches ?? []).includes(p.id)).map((p) => p.id),
    expSeen: EXP_RELICS.filter((r) => !r.start && (lo?.expSeen ?? []).includes(r.id)).map((r) => r.id),
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
  const x = new Set(L.trelic ? [...L.relics, L.trelic] : L.relics);
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
    sellMult: 1 + R("g_sell") / 100 + (has("moa_card") ? V.moa_card(X("moa_card")) / 100 : 0),
    bossSec:
      R("g_boss") +
      (has("hourglass") ? V.hourglass(X("hourglass")) : 0) +
      (has("chrono_core") ? V.chrono_core(X("chrono_core")) : 0) +
      GLITCH[L.stage === "town" ? townGlitchLv(L.town) : L.glitch].bossSec,
    fac: {
      knight: 1 + R("k_drill") / 100,
      mech: 1 + R("m_drill") / 100,
      arcane: 1 + R("a_drill") / 100,
    },
    knightBig: R("k_tactic") / 100,
    facAspd: { knight: R("k_rally") / 100, mech: R("m_tune") / 100, arcane: R("a_echo") / 100 },
    mechBoss: 1 + R("m_bounty") / 100,
    arcaneFx: 1 + R("a_focus") / 100,
    killGold: (has("gold_gear") ? V.gold_gear(X("gold_gear")) : 0) + (has("golden_deed") ? V.golden_deed(X("golden_deed")) : 0),
    firstHarvest: has("first_harvest") ? V.first_harvest(X("first_harvest")) : 0,
    riftCd: has("rift_compass") ? 1 - V.rift_cd(X("rift_compass")) / 100 : 1,
    riftStone: (has("rift_compass") ? V.rift_stone(X("rift_compass")) : 0) + (has("void_stone") ? 1 : 0),
    gamble: has("gambler_coin") ? V.gambler_coin(X("gambler_coin")) / 100 : 0,
    alchemyGold: has("alchemy") ? V.alchemy_gold(X("alchemy")) : 0,
    alchemyStones: has("alchemy") ? V.alchemy_stone(X("alchemy")) : 0,
    vaccine: 1 + (has("vaccine") ? V.vaccine(X("vaccine")) : 0) / 100,
    pureBlood: 1 + (has("pure_blood") ? V.pure_blood(X("pure_blood")) : 0) / 100,
    twinStar: has("twin_star") ? V.twin_star(X("twin_star")) / 100 : 0,
    warBanner: has("war_banner") ? V.war_banner(X("war_banner")) / 100 : 0,
    // 픽셀 타운은 단계에 맞는 메인 오염 단계 세기 (오염 단계 규칙 · 2페이즈 · 심연 변이도 그 단계 것)
    glitch: L.stage === "town" ? townGlitch(L.town) : GLITCH[L.glitch],
    res: L.res,
    relics: L.trelic ? [...L.relics, L.trelic] : L.relics,
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
    engr: L.engr,
    treasure: L.treasure,
    stage: L.stage,
    town: L.town,
    squads: L.squads,
    patches: L.patches,
    expSeen: L.expSeen,
    mythDmg: 1 + (has("myth_seal") ? V.myth_seal(X("myth_seal")) : 0) / 100,
    aspdAll: has("overdrive") ? V.overdrive(X("overdrive")) / 100 : 0,
    bossGold: has("chrono_core") ? 1.5 : 1,
    riftDmg: 1 + (has("void_stone") ? V.void_stone(X("void_stone")) : 0) / 100,
    bossFree: has("lucky_dice") ? V.lucky_dice(X("lucky_dice")) : 0,
    expGold: has("golden_deed") ? V.golden_deed(X("golden_deed")) * 100 : 0,
    sellStone: has("moa_card") ? 1 : 0,
    ultCharge: has("forte_box") ? V.forte_box(X("forte_box")) / 100 : 0,
    pureSteer: has("pure_blood") ? V.pure_steer(X("pure_blood")) / 100 : 0,
    rainbowEvery: has("rainbow") ? V.rainbow_every(X("rainbow")) : 0,
    rainbowLeg: has("rainbow") ? V.rainbow_leg(X("rainbow")) / 100 : 0,
    warEvery: has("war_banner") ? V.war_every(X("war_banner")) : 0,
    warFree: has("war_banner") ? V.war_free(X("war_banner")) : 0,
    sealRefund: has("myth_seal") ? V.seal_refund(X("myth_seal")) / 100 : 0,
    overBoss: has("overdrive") ? V.over_boss(X("overdrive")) / 100 : 0,
    moaReroll: has("moa_card") ? V.moa_reroll(X("moa_card")) / 100 : 0,
    forteChain: has("forte_box"),
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

export type RunMode = "season" | "multi" | "town";

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
  const modeMult = mode === "multi" ? 1.2 : mode === "town" ? TOWN_REWARD : 1;
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
 * 초월 소환: 15% 로 초월 셋 중 하나 (처음이면 해금 · 이미 있으면 그 유닛 카드 dupCards + 코어 dupCores) — 아니면 게임 재화.
 *   천장: 초월 없이 9번 넘기면 10번째는 반드시 초월 (pity = 마지막 초월 뒤로 돌린 수) — 글리치 코어
 * GP 로는 상점의 재화샵 · 패키지에서만 (GP_STORE · GP_PACKS)
 */
export const BOX = {
  card: { pieces: 300, n: 12 },
  relic: { cores: 12, tierOdds: [0.6, 0.3, 0.1] },
  // 중복: 카드 50(Lv.10까지 468장의 약 1/9) + 코어 40(한 번 더 돌릴 만큼) — 예전 카드 15장은 꽝(코어 8 · 조각 600)보다 못하다는 말이 있어 올림 (2026-10-19)
  trans: { cores: 40, rate: 0.15, pity: 10, dupCards: 50, dupCores: 40 },
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
