import { api } from "@/lib/api/http";
import type { Profile } from "@/lib/AuthContext";

/** 내 정보 페이지용 요약 (서버: GET /api/me/summary) */
export interface MyRecord {
  /** 랭킹 이름 (score = 멜론게임, minesweeper_rankings, reaction, *_ai_rankings) */
  board: string;
  id: string;
  /** 그 랭킹에서 내 순위 */
  rank: number;
  score?: number;
  time?: number;
  opp?: string;
  moves?: number;
  seconds?: number;
  createdAt: number | null;
}

export interface MyRhythmRecord {
  id: string;
  /** 곡id_난이도 */
  chart: string;
  score: number;
  acc: number;
  maxCombo: number;
  fc: boolean;
  ap: boolean;
  rank: number;
  createdAt: number | null;
}

export interface MyStats {
  /** 랭킹 게임을 시작한 횟수 */
  plays?: Record<string, number>;
  /** 온라인 대국 전적 (chess · janggi · omok) */
  online?: Record<string, { w?: number; l?: number; d?: number }>;
  sketch?: { correct?: number; points?: number; games?: number };
  fight?: { matches?: number };
}

export interface MySummary {
  profile: Profile | null;
  stats?: MyStats;
  records?: MyRecord[];
  rhythm?: MyRhythmRecord[];
}

export const getMySummary = () => api<MySummary>("/api/me/summary", { auth: true });
