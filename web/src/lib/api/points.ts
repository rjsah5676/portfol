import { api } from "@/lib/api/http";
import type { AchGame, AchRankRow, AchState, DailyState, PointLogRow } from "@/lib/points";

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

/** 그 게임에서 산 물건 ref 목록 (비회원은 빈 목록) */
export const getInventory = (game: AchGame) =>
  api<{ list: string[] }>(`/api/points/inventory/${game}`, { auth: true }).then((r) => r.list);

export const getDaily = (game: AchGame) =>
  api<{ list: DailyState[]; points: number | null }>(
    `/api/points/daily/${game}`,
    { auth: true },
  );

/** 일일 미션 받기 — id 가 없으면 받을 수 있는 것 전부 */
export const claimDaily = (game: AchGame, id?: string) =>
  api<{ reward: number; ids: string[]; points: number }>(
    `/api/points/daily/${game}/claim`,
    { method: "POST", auth: true, body: id ? { id } : {} },
  );
