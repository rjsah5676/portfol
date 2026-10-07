import { api } from "@/lib/api/http";
import { toDate } from "@/lib/rankDate";

/** 격투 랭크전 레이팅 (서버 games/fightRating.ts — 랭크전(회원끼리 자동 매칭)만, Elo 1000에서 시작) */
export interface FightRatingRow {
  id: string;
  name: string;
  member: boolean;
  avatar: string | null;
  r: number;
  /** 레이팅에 반영된 판 수 */
  n: number;
  w: number;
  l: number;
  d: number;
  peak: number;
  /** 마지막 경기 시각 */
  at: Date | null;
}

/** 이 판 수 전까지는 배치 중 */
export const RATING_PLACEMENT = 10;

export async function getFightRatings(count = 10): Promise<FightRatingRow[]> {
  const rows = await api<(Partial<FightRatingRow> & { createdAt?: number | null })[]>(`/api/rankings/fight-rating?limit=${count}`);
  return rows.map((x) => ({
    id: String(x.id ?? ""),
    name: String(x.name ?? ""),
    member: true,
    avatar: x.avatar ?? null,
    r: x.r ?? 1000,
    n: x.n ?? 0,
    w: x.w ?? 0,
    l: x.l ?? 0,
    d: x.d ?? 0,
    peak: x.peak ?? x.r ?? 1000,
    at: toDate(x.createdAt ?? null),
  }));
}

/** "12승 3패 · 승률 80%" (+ 배치 중) */
export function ratingSub(x: { n: number; w: number; l: number; d: number }) {
  const total = x.w + x.l + x.d;
  const rate = total ? Math.round((x.w / total) * 100) : 0;
  return `${x.w}승 ${x.l}패${x.d ? ` ${x.d}무` : ""} · 승률 ${rate}%${x.n < RATING_PLACEMENT ? ` · 배치 ${x.n}/${RATING_PLACEMENT}` : ""}`;
}

/** 랭크전 캐릭터 통계 (c = CHARS 번호). vs: a가 b를 상대로 이긴 판(무승부 0.5) / 붙은 판 */
export interface RankStats {
  games: number;
  chars: { c: number; w: number; l: number; d: number }[];
  vs: { a: number; b: number; w: number; g: number }[];
  /** 내 캐릭터별 기록 (로그인했을 때) */
  mine?: { c: number; w: number; l: number; d: number }[];
}

export const getRankStats = () => api<RankStats>("/api/rankings/fight-rank-stats", { auth: true });

/** 강세·약세 기준: 이 판 수 이상 붙었을 때만 */
export const MATCHUP_MIN = 5;
export type Tier = "strong" | "weak" | "even" | "few";
export const tierOf = (rate: number, games: number): Tier =>
  games < MATCHUP_MIN ? "few" : rate >= 0.55 ? "strong" : rate <= 0.45 ? "weak" : "even";
