/*
 * 픽셀 타운 서바이버 — 판 밖 성장 (영구 강화 · 보상 · 동료). 서버 · 화면 공용, "@/" import 금지.
 */
import { CAST_BY } from "../cast";
import { depthMul, HEROES, HERO_IDS, RUN_SEC, STAGES, type HeroId, type StageId, type Stats } from "./data";
import type { RunQ } from "./quests";

/* ───────────── 영구 강화 (코인으로) ───────────── */

export type UpId = "might" | "maxHp" | "armor" | "regen" | "speed" | "magnet" | "luck" | "growth" | "cooldown" | "area" | "revive" | "reroll";

export interface UpDef {
  id: UpId;
  name: string;
  desc: string;
  max: number;
  /** 레벨당 */
  per: Partial<Stats>;
  /** 첫 레벨 값 (다음 레벨마다 +base) */
  base: number;
}
export const UPGRADES: UpDef[] = [
  { id: "might", name: "힘", desc: "피해 +5%", max: 5, per: { might: 0.05 }, base: 120 },
  { id: "maxHp", name: "체력", desc: "최대 체력 +10", max: 5, per: { maxHp: 10 }, base: 100 },
  { id: "armor", name: "방어", desc: "받는 피해 −1", max: 3, per: { armor: 1 }, base: 250 },
  { id: "regen", name: "회복", desc: "초당 회복 +0.2", max: 3, per: { regen: 0.2 }, base: 200 },
  { id: "speed", name: "이동", desc: "이동 속도 +5%", max: 3, per: { speed: 0.05 }, base: 150 },
  { id: "magnet", name: "자석", desc: "줍는 범위 +15%", max: 3, per: { magnet: 0.15 }, base: 100 },
  { id: "luck", name: "행운", desc: "행운 +1", max: 3, per: { luck: 1 }, base: 200 },
  { id: "growth", name: "성장", desc: "경험치 +5%", max: 5, per: { growth: 0.05 }, base: 150 },
  { id: "cooldown", name: "쿨타임", desc: "쿨타임 −3%", max: 3, per: { cooldown: 0.03 }, base: 250 },
  { id: "area", name: "범위", desc: "범위 +5%", max: 3, per: { area: 0.05 }, base: 200 },
  { id: "revive", name: "부활", desc: "쓰러지면 한 번 일어남", max: 1, per: {}, base: 1500 },
  { id: "reroll", name: "다시 뽑기", desc: "레벨업 다시 뽑기 +1", max: 3, per: {}, base: 300 },
];
export const UP: Record<UpId, UpDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpId, UpDef>;
/** 다음 레벨 값 */
export const upCost = (id: UpId, lv: number) => UP[id].base * (lv + 1);

export type Ups = Partial<Record<UpId, number>>;

/** 영구 강화 → 판 시작 보너스 */
export function upBonus(ups: Ups): { stats: Partial<Stats>; revive: number; rerolls: number } {
  const stats: Partial<Stats> = {};
  for (const u of UPGRADES) {
    const lv = Math.min(u.max, ups[u.id] ?? 0);
    for (const [k, v] of Object.entries(u.per) as [keyof Stats, number][]) stats[k] = (stats[k] ?? 0) + v * lv;
  }
  return { stats, revive: Math.min(1, ups.revive ?? 0), rerolls: Math.min(3, ups.reroll ?? 0) };
}

/* ───────────── 응원 동료 ───────────── */

/** 같은 계열 셋이면 팀 시너지 */
export type Team = "fight" | "skin" | "town" | "ur";
/** 계열은 명부에서 바로 정함: 격투가 본인 → 동창회 · 격투가 코스튬 → 코스튬 파티 · UR → 전설 · 나머지 → 주민 */
export const teamOf = (h: HeroId): Team => {
  const c = CAST_BY[h as keyof typeof CAST_BY];
  if (!c) return "town";
  return c.grade === "UR" ? "ur" : c.base === "orig" ? "town" : c.base === c.id ? "fight" : "skin";
};
export const TEAM_OF = Object.fromEntries(HERO_IDS.map((h) => [h, teamOf(h)])) as Record<HeroId, Team>;
export const TEAM_NAME: Record<Team, string> = { fight: "픽셀파이트 동창회", skin: "코스튬 파티", town: "다이스 타운 주민", ur: "전설의 셋" };
export const TEAM_BONUS: Record<Team, { desc: string; stat: Partial<Stats> }> = {
  fight: { desc: "피해 +15%", stat: { might: 0.15 } },
  skin: { desc: "최대 체력 +40 · 회복 +0.3", stat: { maxHp: 40, regen: 0.3 } },
  town: { desc: "행운 +3 · 자석 +30%", stat: { luck: 3, magnet: 0.3 } },
  ur: { desc: "쿨타임 −12% · 투사체 +1", stat: { cooldown: 0.12, amount: 1 } },
};

/** 동료 패시브는 절반만 */
export function supportBonus(main: HeroId, sup: HeroId[]): { stats: Partial<Stats>; team: Team | null } {
  const stats: Partial<Stats> = {};
  for (const id of sup) {
    for (const [k, v] of Object.entries(HEROES[id].passive.stat) as [keyof Stats, number][]) stats[k] = (stats[k] ?? 0) + v * 0.5;
  }
  const all = [main, ...sup];
  const team = all.length === 3 && all.every((h) => TEAM_OF[h] === TEAM_OF[main]) ? TEAM_OF[main] : null;
  if (team) for (const [k, v] of Object.entries(TEAM_BONUS[team].stat) as [keyof Stats, number][]) stats[k] = (stats[k] ?? 0) + v;
  return { stats, team };
}

/* ───────────── 판 보상 ───────────── */

export interface RunReport {
  hero: HeroId;
  sec: number;
  kills: number;
  lv: number;
  win: boolean;
  depth: number;
  /** 오버타임 (초) */
  ot: number;
  q: RunQ;
  /** 맵 (없으면 잠든 골목) */
  stage?: StageId;
}
/** 깊이 × 맵 보상 배율 */
const rewardMul = (r: RunReport) => depthMul(r.depth).reward * STAGES[r.stage ?? "town"].reward;

/** 다이스 타운 별사탕 (뽑기 재화) */
export const STAR_FIRST_WIN = 60;
export function runStars(r: RunReport): number {
  const sec = Math.min(r.sec, RUN_SEC + 600);
  const base = Math.floor(sec / 60) * 4 + Math.floor(r.kills / 150) + (r.win ? 30 : 0);
  return Math.min(Math.round(120 * rewardMul(r)), Math.round(base * rewardMul(r)));
}
/** 영구 강화 코인: 버틴 시간 · 처치 · 클리어 (판 안 금화와 따로 — 금화는 판 안에서 다 써도 됨) */
export function runCoins(r: RunReport): number {
  const sec = Math.min(r.sec, RUN_SEC + 900);
  return Math.round(((sec / 60) * 12 + Math.min(r.kills, 30_000) / 40 + (r.win ? 100 : 0)) * rewardMul(r));
}
/** 랭킹 점수 (맵마다 따로): 깊이 → 클리어 → 버틴 시간(오버타임 포함) → 처치 */
export const runScore = (r: RunReport) => Math.min(r.depth, 99) * 10_000_000 + (r.win ? 1_000_000 : 0) + Math.min(r.sec, 9999) * 100 + Math.min(r.kills, 99);
/** 말이 되는 기록인지 (조작 걸러내기) */
export function plausible(r: RunReport, wallSec: number): boolean {
  if (!(r.sec >= 0 && r.kills >= 0 && r.lv >= 1)) return false;
  if (r.sec > wallSec + 5) return false;
  if (r.kills > r.sec * 60 + 50) return false;
  if (r.lv > 250) return false;
  if (r.win && r.sec < RUN_SEC) return false;
  if (r.ot > Math.max(0, r.sec - RUN_SEC) + 5) return false;
  const q = r.q;
  if (q.chests > r.sec / 6 + 6 || q.shrines > r.sec / 10 + 4 || q.trials > 3 || q.gold > r.sec * 6 + 400) return false;
  // 그 맵에 없는 보스 · 종
  const st = r.stage ?? "town";
  if (st === "town" && (q.cuckoo || q.tower || q.tolls)) return false;
  if (st === "clock" && (q.jelly || q.clock)) return false;
  if (q.tolls > r.sec / 90 + 1) return false;
  if ((q.clock || q.tower) && !r.win) return false;
  return true;
}
