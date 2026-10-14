/**
 * 치트 코드 — 판 안 선택 강화 (다른 게임의 "증강체").
 * 보스를 잡을 때마다 (10 · 20 · 30 · 40 · 50웨이브, 마지막 60 은 빼고) 3개 중 하나를 고름. 고르는 동안 그 보드는 멈춤.
 *  - 카드마다 다시 뽑기(리롤) 1번 (치트 연구 「리롤 회로」 를 끼면 +1)
 *  - 등급 4단계: 기본 · 고급 · 비밀 · 금지 — 보스가 뒤로 갈수록 높은 등급이 잘 나옴 (치트 연구 「확률 증폭기」 로 더)
 *  - 종류: 유닛 · 골드 · 피해 · 버프 (+ 세력 · 패치 · 전략에 맞춘 것 → 원툴 · 이자 · 도박 · 단일 코어 모두 고를 거리가 있게)
 * 한 판에 같은 코드는 한 번만. 효과는 sim.ts 가 b.cx(합친 값) 로 읽음 — 정의 · 계산은 여기, 적용 시점은 sim.ts.
 * 시뮬은 결정론: 뽑기는 보드의 따로 된 난수(b.crng) 로만 → 치트를 고르는 것과 상관없이 소환 운은 그대로.
 */
import type { Faction } from "./units";

export type CheatCat = "unit" | "gold" | "dmg" | "buff";
export const CHEAT_CAT_NAME: Record<CheatCat, string> = { unit: "유닛", gold: "골드", dmg: "피해", buff: "버프" };
/** 등급 0..3 */
export const CHEAT_TIER_NAME = ["기본", "고급", "비밀", "금지"] as const;
export const CHEAT_TIER_COLOR = ["#c9c2e6", "#5ff2ff", "#c08cff", "#ff5fa8"] as const;

/** 판 안에서 합쳐 쓰는 치트 효과 (곱은 1, 합은 0 이 기본) */
export interface CheatFx {
  /** 모든 피해 ×(곱) */
  dmg: number;
  /** 세력별 피해 × */
  fac: Record<Faction, number>;
  /** 보스 · 엘리트 · 균열에게 × */
  boss: number;
  /** 레전드 이하 × · 신화 이상 × */
  low: number;
  high: number;
  /** 필드가 한 세력뿐이면 × · 세 세력 모두면 × */
  mono: number;
  tri: number;
  /** 공격 속도 + (합) */
  aspd: number;
  /** 치명: 확률 (합) — 맞으면 ×2 */
  crit: number;
  /** 적 이동 속도 × (1 - slow) */
  slow: number;
  /** 적 방어력 - (합) */
  shred: number;
  /** 웨이브 골드 × · 처치 골드 + · 이자 (웨이브마다 가진 골드 % · 최대) */
  waveGold: number;
  killGold: number;
  interest: number;
  interestMax: number;
  /** 소환 비용 - · 강화 비용 × */
  summonDisc: number;
  upCost: number;
  /** 보스 제한 시간 + (초) */
  bossSec: number;
  /** 패배 기준 적 수 + */
  cap: number;
  /** 레전드 이상을 얻으면 같은 등급 하나 더 (확률, 합) */
  twin: number;
  /** 도박 성공률 + · 보스 행운석 + */
  gamble: number;
  bossStones: number;
}
export const cheatFx0 = (): CheatFx => ({
  dmg: 1,
  fac: { knight: 1, mech: 1, arcane: 1, hidden: 1 },
  boss: 1,
  low: 1,
  high: 1,
  mono: 1,
  tri: 1,
  aspd: 0,
  crit: 0,
  slow: 0,
  shred: 0,
  waveGold: 1,
  killGold: 0,
  interest: 0,
  interestMax: 0,
  summonDisc: 0,
  upCost: 1,
  bossSec: 0,
  cap: 0,
  twin: 0,
  gamble: 0,
  bossStones: 0,
});

/** 고른 순간 바로 받는 것 */
export interface CheatNow {
  gold?: number;
  /** 웨이브 × 이 값 만큼 골드 더 */
  goldPerWave?: number;
  stones?: number;
  free?: number;
  /** 골라 뽑기권 (등급) */
  tickets?: number[];
  /** 세력 강화 레벨 + (모든 세력) */
  ups?: number;
}

export interface CheatDef {
  id: string;
  name: string;
  desc: string;
  tier: 0 | 1 | 2 | 3;
  cat: CheatCat;
  /** 지속 효과 (CheatFx 에 더하거나 곱함) */
  fx?: (c: CheatFx) => void;
  now?: CheatNow;
  /** 이 세력 전용 (봇이 고를 때 · 화면 색) */
  faction?: Exclude<Faction, "hidden">;
}

const mul = (k: keyof CheatFx, v: number) => (c: CheatFx) => {
  (c[k] as number) *= v;
};
const add = (k: keyof CheatFx, v: number) => (c: CheatFx) => {
  (c[k] as number) += v;
};
const facMul = (f: Faction, v: number) => (c: CheatFx) => {
  c.fac[f] *= v;
};

export const CHEATS: CheatDef[] = [
  /* ── 기본 (0) ── */
  { id: "c_cash", name: "긴급 자금", desc: "지금 골드 +120 (+웨이브 × 6)", tier: 0, cat: "gold", now: { gold: 120, goldPerWave: 6 } },
  { id: "c_salary", name: "정기 수당", desc: "웨이브 골드 +25%", tier: 0, cat: "gold", fx: mul("waveGold", 1.25) },
  { id: "c_pouch", name: "행운 주머니", desc: "지금 행운석 +4", tier: 0, cat: "gold", now: { stones: 4 } },
  { id: "c_trial", name: "무료 체험판", desc: "무료 소환 6회", tier: 0, cat: "unit", now: { free: 6 } },
  { id: "c_ticketR", name: "레어 쿠폰", desc: "골라 뽑기권 (레어) 2장", tier: 0, cat: "unit", now: { tickets: [1, 1] } },
  { id: "c_overclock", name: "오버클럭", desc: "모든 피해 +8%", tier: 0, cat: "dmg", fx: mul("dmg", 1.08) },
  { id: "c_ping", name: "핑 감소", desc: "모든 유닛 공격 속도 +6%", tier: 0, cat: "buff", fx: add("aspd", 0.06) },
  { id: "c_extend", name: "시간 연장", desc: "보스 제한 시간 +8초", tier: 0, cat: "buff", fx: add("bossSec", 8) },
  { id: "c_knight1", name: "기사단 훈련 코드", desc: "기사단 피해 +15%", tier: 0, cat: "dmg", faction: "knight", fx: facMul("knight", 1.15) },
  { id: "c_mech1", name: "공방 튜닝 코드", desc: "기계공방 피해 +15%", tier: 0, cat: "dmg", faction: "mech", fx: facMul("mech", 1.15) },
  { id: "c_arcane1", name: "마력 증폭 코드", desc: "마도회 피해 +15%", tier: 0, cat: "dmg", faction: "arcane", fx: facMul("arcane", 1.15) },

  /* ── 고급 (1) ── */
  { id: "c_bounty", name: "현상금 사냥", desc: "처치 골드 +2", tier: 1, cat: "gold", fx: add("killGold", 2) },
  {
    id: "c_compound",
    name: "복리 계좌",
    desc: "웨이브마다 가진 골드의 6% 이자 (최대 50)",
    tier: 1,
    cat: "gold",
    fx: (c) => {
      c.interest += 0.06;
      c.interestMax += 50;
    },
  },
  { id: "c_ticketE", name: "에픽 쿠폰", desc: "골라 뽑기권 (에픽) 2장", tier: 1, cat: "unit", now: { tickets: [2, 2] } },
  { id: "c_clone", name: "복제 버그", desc: "레전드 이상을 얻으면 15% 로 같은 등급 하나 더", tier: 1, cat: "unit", fx: add("twin", 0.15) },
  { id: "c_bosskill", name: "보스 킬러", desc: "보스 · 엘리트 · 균열에게 피해 +25%", tier: 1, cat: "dmg", fx: mul("boss", 1.25) },
  { id: "c_lag", name: "렉 유발", desc: "모든 적 이동 속도 -7%", tier: 1, cat: "buff", fx: add("slow", 0.07) },
  { id: "c_hack", name: "방어 해킹", desc: "적 방어력 -12", tier: 1, cat: "buff", fx: add("shred", 12) },
  { id: "c_patchup", name: "강화 패키지", desc: "모든 세력 강화 +3레벨", tier: 1, cat: "buff", now: { ups: 3 } },
  { id: "c_dice", name: "주사위 조작", desc: "도박 성공률 +10%p · 보스를 잡으면 행운석 +1", tier: 1, cat: "gold", fx: (c) => ((c.gamble += 0.1), (c.bossStones += 1)) },
  { id: "c_knight2", name: "기사단 각성", desc: "기사단 피해 +30%", tier: 1, cat: "dmg", faction: "knight", fx: facMul("knight", 1.3) },
  { id: "c_mech2", name: "공방 과부하", desc: "기계공방 피해 +30%", tier: 1, cat: "dmg", faction: "mech", fx: facMul("mech", 1.3) },
  { id: "c_arcane2", name: "마력 폭주", desc: "마도회 피해 +30%", tier: 1, cat: "dmg", faction: "arcane", fx: facMul("arcane", 1.3) },

  /* ── 비밀 (2) ── */
  { id: "c_ticketL", name: "레전드 쿠폰", desc: "골라 뽑기권 (레전드) 1장", tier: 2, cat: "unit", now: { tickets: [3] } },
  {
    id: "c_discount",
    name: "할인 코드",
    desc: "소환 비용 -6 · 강화 비용 -20%",
    tier: 2,
    cat: "gold",
    fx: (c) => {
      c.summonDisc += 6;
      c.upCost *= 0.8;
    },
  },
  { id: "c_crit", name: "치명 코드", desc: "모든 공격 12% 확률로 치명 (피해 ×2)", tier: 2, cat: "dmg", fx: add("crit", 0.12) },
  { id: "c_underdog", name: "약자 보호법", desc: "레전드 이하 피해 +35%", tier: 2, cat: "dmg", fx: mul("low", 1.35) },
  { id: "c_legend", name: "신화 패치", desc: "신화 · 히든 · 초월 피해 +25%", tier: 2, cat: "dmg", fx: mul("high", 1.25) },
  { id: "c_tri", name: "삼색 동맹", desc: "필드에 세 세력이 모두 있으면 모든 피해 +20%", tier: 2, cat: "dmg", fx: mul("tri", 1.2) },
  { id: "c_mono", name: "순혈 프로토콜", desc: "필드가 한 세력뿐이면 (히든 빼고) 모든 피해 +35%", tier: 2, cat: "dmg", fx: mul("mono", 1.35) },
  { id: "c_frame", name: "프레임 해제", desc: "모든 유닛 공격 속도 +15%", tier: 2, cat: "buff", fx: add("aspd", 0.15) },
  { id: "c_memory", name: "메모리 확장", desc: "패배 기준 적 수 +25", tier: 2, cat: "buff", fx: add("cap", 25) },

  /* ── 금지 (3) ── */
  { id: "c_god", name: "갓 모드", desc: "모든 피해 +30%", tier: 3, cat: "dmg", fx: mul("dmg", 1.3) },
  { id: "c_ticketM", name: "신화 직배송", desc: "골라 뽑기권 (신화) 1장", tier: 3, cat: "unit", now: { tickets: [4] } },
  {
    id: "c_infinite",
    name: "무한 동전 버그",
    desc: "지금 골드 +400 · 웨이브 골드 +40%",
    tier: 3,
    cat: "gold",
    now: { gold: 400 },
    fx: mul("waveGold", 1.4),
  },
  {
    id: "c_timestop",
    name: "시간 정지",
    desc: "모든 적 이동 속도 -15% · 보스 제한 시간 +15초",
    tier: 3,
    cat: "buff",
    fx: (c) => {
      c.slow += 0.15;
      c.bossSec += 15;
    },
  },
  { id: "c_knight3", name: "성기사단 강림", desc: "기사단 피해 +60%", tier: 3, cat: "dmg", faction: "knight", fx: facMul("knight", 1.6) },
  { id: "c_mech3", name: "최종 병기 코드", desc: "기계공방 피해 +60%", tier: 3, cat: "dmg", faction: "mech", fx: facMul("mech", 1.6) },
  { id: "c_arcane3", name: "금단의 주문서", desc: "마도회 피해 +60%", tier: 3, cat: "dmg", faction: "arcane", fx: facMul("arcane", 1.6) },
];
export const CHEAT: Record<string, CheatDef> = Object.fromEntries(CHEATS.map((c) => [c.id, c]));

/** 치트가 나오는 보스 웨이브 (마지막 보스는 빼고) */
export const CHEAT_WAVES = [10, 20, 30, 40, 50] as const;
/** 한 번에 보여 주는 수 · 카드마다 다시 뽑기 기본 횟수 */
export const CHEAT_OFFER = 3;
export const CHEAT_REROLL = 1;
/** 멀티: 이 시간 안에 안 고르면 첫 카드로 (다른 사람을 오래 기다리게 하지 않게) */
export const CHEAT_MULTI_SEC = 20;

/** 등급 확률 (%) — 몇 번째 치트인지 (0..4) 에 따라 */
const ODDS: number[][] = [
  [62, 30, 7, 1],
  [50, 34, 13, 3],
  [40, 36, 19, 5],
  [32, 36, 24, 8],
  [25, 35, 28, 12],
];
/** 등급 확률 — luck 이면 (치트 연구 「확률 증폭기」) 비밀 ×1.5 · 금지 ×2, 그만큼 기본에서 (모자라면 고급에서) 뺌 */
export function cheatOdds(n: number, luck: boolean): number[] {
  const o = [...ODDS[Math.max(0, Math.min(ODDS.length - 1, n))]];
  if (luck) {
    const add2 = o[2] * 0.5,
      add3 = o[3];
    o[2] += add2;
    o[3] += add3;
    const take = Math.min(o[0], add2 + add3);
    o[0] -= take;
    o[1] -= add2 + add3 - take;
  }
  return o;
}

/** 고른 치트들 → 합친 효과 */
export function cheatFxOf(ids: readonly string[]): CheatFx {
  const c = cheatFx0();
  for (const id of ids) CHEAT[id]?.fx?.(c);
  return c;
}
