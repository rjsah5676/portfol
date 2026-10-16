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
  /** 회원으로 친 기록인지 (BP는 회원 기록만) */
  member?: boolean;
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
  /** 포커: 친 판 수 · 이긴 판 · 한 판에 가장 크게 먹은 돈 */
  poker?: {
    games?: number;
    hands?: number;
    best?: number;
    holdem?: { hands?: number; wins?: number };
    seven?: { hands?: number; wins?: number };
  };
}

export interface MySummary {
  profile: Profile | null;
  stats?: MyStats;
  records?: MyRecord[];
  rhythm?: MyRhythmRecord[];
  /** 픽셀 리듬업 BP 합과 회원 BP 랭킹 순위 (기록이 없으면 rank null) */
  bp?: { total: number; rank: number | null; of: number };
  /** 격투 온라인 레이팅 (회원끼리 경기, 한 판도 없으면 null) */
  fightRating?: { r: number; n: number; w: number; l: number; d: number; peak: number; rank: number; of: number } | null;
  /** 포커 자금 */
  money?: number;
}

export const getMySummary = () => api<MySummary>("/api/me/summary", { auth: true });
