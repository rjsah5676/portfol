/*
 * 픽셀 순찰대 — 재화 · 보상 · 상자 · 순찰 (숫자는 여기 한 곳)
 * 코인: 강화 · 일반 상자 / 보석: 고급 상자 / 설계도: 강화 (맛보기는 한 종류)
 * 브라우저 · 서버 공용 — "@/" import 금지.
 */
import { SUB, stCh, stLen, stSub } from "./chapters";
import { GEAR_IDS, type GGrade, type GearId } from "./gear";

/* ───────────── 판 보상 ───────────── */

export interface PatrolReport {
  /** 스테이지 전체 번호 (1-1 = 1 · 2-1 = 6) */
  st: number;
  sec: number;
  kills: number;
  lv: number;
  win: boolean;
  /** 판에서 주운 코인 */
  gold: number;
  /** 별 3개 */
  stars: [boolean, boolean, boolean];
}

/** 판에서 주운 코인 상한 (기록 확인용) */
export const goldCap = (sec: number) => 300 + sec;
/** 스테이지 보상 배율 (1-1 = 1 → 3-5 = 1.7) */
export const stMul = (st: number) => 1 + (st - 1) * 0.05;
export function runCoins(r: PatrolReport): number {
  const m = stMul(r.st);
  const boss = stSub(r.st) === SUB;
  return Math.round((r.kills * 0.12 + r.sec * 0.64) * m + (r.win ? (boss ? 150 : 60) * m : 0)) + Math.min(r.gold, goldCap(r.sec));
}
export const runBlueprints = (r: PatrolReport) => (r.win ? (stSub(r.st) === SUB ? 3 + 2 * stCh(r.st) : 1 + stCh(r.st)) : Math.floor(r.sec / 75));
/** 하루 첫 N판은 보상 두 배 */
export const BOOST_RUNS = 5;
/** 첫 클리어 보석 · 장비 등급 — 챕터 보스 스테이지(X-5) */
export const FIRST_GEMS = [300, 300, 500];
export const FIRST_GEAR: GGrade[] = [1, 1, 2];
/** 첫 클리어 보석 — 짧은 스테이지(X-1 ~ X-4), 챕터별 */
export const SHORT_GEMS = [60, 80, 100];
/** 스테이지 첫 클리어 보상 */
export const firstReward = (st: number): { gems: number; gear: GGrade | null } =>
  stSub(st) === SUB ? { gems: FIRST_GEMS[stCh(st) - 1] ?? 300, gear: FIRST_GEAR[stCh(st) - 1] ?? 1 } : { gems: SHORT_GEMS[stCh(st) - 1] ?? 60, gear: null };
/** 다시 깰 때 장비가 나올 확률 (일반 · 고급) */
export const REPEAT_GEAR = 0.3;
/** 별 하나 새로 딸 때 보석 */
export const STAR_GEMS = 40;

/** 시작 선물 */
export const WELCOME = { gems: 900, coins: 200, gear: [{ id: "w_shuriken" as GearId, g: 0 as GGrade }, { id: "a_jumper" as GearId, g: 0 as GGrade }] };

/** 기록이 말이 되나 (wall = 서버가 잰 판 시간, 초) */
export function plausible(r: PatrolReport, wall: number): boolean {
  if (r.sec > wall + 8) return false;
  if (r.win && r.sec < stLen(r.st)) return false;
  if (r.sec > stLen(r.st) + 200) return false;
  if (r.kills > r.sec * 14 + 60) return false;
  if (r.lv > 2 + r.sec / 4) return false;
  if (r.gold > goldCap(r.sec) * 2) return false;
  if (!r.win && r.stars.some(Boolean)) return false;
  return true;
}

/* ───────────── 상자 ───────────── */

export type BoxKind = "premium" | "premium10" | "normal";
export const BOX = {
  /** 고급 상자: 보석 */
  premium: { cost: 300, odds: [0, 55, 33, 10, 2] },
  premium10: { cost: 2700, n: 10 },
  /** 일반 상자: 코인 (하루 한 번 무료) */
  normal: { cost: 400, odds: [70, 25, 5, 0, 0] },
} as const;
/** 천장: 고급 상자 N번 안에 영웅 이상 · 전설 */
export const PITY_HERO = 10;
export const PITY_LEGEND = 50;

export interface Pity {
  hero: number;
  legend: number;
}
/** 상자 하나 굴리기 (rnd: 0~1, pity 는 고급 상자만 · 고쳐 씀) */
export function rollBox(kind: "premium" | "normal", rnd: () => number, pity: Pity | null, atLeast: GGrade = 0): { id: GearId; g: GGrade } {
  const odds = BOX[kind].odds;
  let x = rnd() * 100;
  let g = 0 as GGrade;
  for (let k = 0; k < odds.length; k++) {
    x -= odds[k];
    if (x < 0) {
      g = k as GGrade;
      break;
    }
  }
  if (pity) {
    pity.hero++;
    pity.legend++;
    if (pity.legend >= PITY_LEGEND) g = 4;
    else if (pity.hero >= PITY_HERO && g < 3) g = 3;
    if (g >= 3) pity.hero = 0;
    if (g >= 4) pity.legend = 0;
  }
  if (g < atLeast) g = atLeast;
  const id = GEAR_IDS[Math.min(GEAR_IDS.length - 1, Math.floor(rnd() * GEAR_IDS.length))];
  return { id, g };
}

/* ───────────── 순찰 (접속 안 해도 쌓임) ───────────── */

/** 시간당: 코인 80 + 8 × 깬 스테이지 · 설계도 1 */
export const patrolRate = (bestSt: number) => ({ coin: 80 + 8 * Math.max(0, bestSt), bp: 1 });
export const PATROL_MAX_H = 12;
/** 빠른 순찰: 2시간치 즉시, 하루 3번 무료 */
export const QUICK_H = 2;
export const QUICK_FREE = 3;
/** 쌓인 순찰 보상 (ms 단위 시간) */
export function patrolPending(best: number, since: number, now: number) {
  const h = Math.min(PATROL_MAX_H, Math.max(0, now - since) / 3600_000);
  const r = patrolRate(best);
  return { h, coin: Math.floor(r.coin * h), bp: Math.floor(r.bp * h) };
}
