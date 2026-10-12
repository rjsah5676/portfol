import { api } from "@/lib/api/http";
import type { AchGame, AchRankRow, AchState, PointLogRow } from "@/lib/points";

/** 포인트 API (server/src/http/points.ts) */
export const getMyPoints = () =>
  api<{ points: number; attendedToday: boolean; log: PointLogRow[] }>(
    "/api/points",
    { auth: true },
  );

export const getAchievements = (game: AchGame) =>
  api<{ list: AchState[]; points: number | null }>(
    `/api/points/achievements/${game}`,
    { auth: true },
  );

export const claimAchievement = (id: string) =>
  api<{ reward: number; points: number }>(
    `/api/points/achievements/${encodeURIComponent(id)}/claim`,
    {
      method: "POST",
      auth: true,
    },
  );

export const getAchRank = (game: AchGame) =>
  api<{ list: AchRankRow[] }>(`/api/points/achievements/${game}/rank`).then(
    (r) => r.list,
  );

export const buyItem = (item: string) =>
  api<{ points: number }>("/api/points/buy", {
    method: "POST",
    auth: true,
    body: { item },
  });
