import { rpc } from "@/lib/api/socket";
import type { HeroId, StageId } from "@/lib/survivor/data";
import type { UpId, Ups } from "@/lib/survivor/progress";
import type { QuestTotals, RunQ } from "@/lib/survivor/quests";

/*
 * 픽셀 타운 서바이버 — 백엔드(server/src/games/survivor.ts)와 통신
 *  프로필(코인 · 영구 강화 · 다이스 타운 보유 캐릭터) · 강화 · 판 시작/끝(보상) · 랭킹
 */

export interface SurvivorProfile {
  gold: number;
  ups: Ups;
  games: number;
  wins: number;
  kills: number;
  firstWinToday: boolean;
  /** 깬 퀘스트 */
  quests: string[];
  /** 클리어한 가장 깊은 밤 (-1 = 아직) — 잠든 골목 */
  depth: number;
  /** 맵마다 클리어한 가장 깊은 밤 (-1 = 아직) */
  depths?: Partial<Record<StageId, number>>;
  tot: QuestTotals;
  /** 다이스 타운 보유 캐릭터 · 강화 */
  chars: Record<string, { lv: number; dup: number }>;
  /** 다이스 타운 별사탕 (뽑기 재화) */
  stars: number;
  /** 캐릭터 10연차 티켓 */
  tickets?: number;
  /** 뽑기 천장 진행 */
  pity?: { char: number; item: number; ur?: number };
}
export interface SurvivorRankRow {
  stage: StageId;
  nick: string;
  avatar: string | null;
  hero: HeroId;
  sec: number;
  kills: number;
  lv: number;
  win: boolean;
  depth: number;
  ot: number;
  at: number;
}
export interface FinishOut {
  stars: number;
  first: boolean;
  gold: number;
  best: boolean;
  rank: number;
  /** 이번에 깬 퀘스트 */
  quests: string[];
  /** 퀘스트 별사탕 */
  qStars: number;
  profile: Omit<SurvivorProfile, "chars" | "stars" | "tickets" | "pity">;
}

export const survivor = {
  profile: () => rpc<SurvivorProfile>("survivor.profile"),
  upgrade: (id: UpId) => rpc<Omit<SurvivorProfile, "chars" | "stars" | "tickets" | "pity">>("survivor.upgrade", { id }),
  start: (hero: HeroId, sup: HeroId[], depth: number, stage: StageId) => rpc<{ run: string }>("survivor.start", { hero, sup, depth, stage }),
  finish: (run: string, r: { sec: number; kills: number; lv: number; win: boolean; ot: number; q: RunQ }) => rpc<FinishOut>("survivor.finish", { run, ...r }),
  rank: (limit = 50, stage: StageId = "town") => rpc<SurvivorRankRow[]>("survivor.rank", { limit, stage }),
};
