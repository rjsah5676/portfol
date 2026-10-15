import { api } from "@/lib/api/http";
import type { AchGame, AchRankRow, AchState, DailyState, PointLogRow } from "@/lib/points";

/** 포인트 API (server/src/http/points.ts) */
export const getMyPoints = () =>
  api<{ points: number; attendedToday: boolean; log: PointLogRow[] }>("/api/points", {
    auth: true,
  });

export const getAchievements = (game: AchGame) =>
  api<{ list: AchState[]; points: number | null }>(`/api/points/achievements/${game}`, {
    auth: true,
  });

export const claimAchievement = (id: string) =>
  api<{ reward: number; points: number }>(
    `/api/points/achievements/${encodeURIComponent(id)}/claim`,
    {
      method: "POST",
      auth: true,
    }
  );

export const getAchRank = (game: AchGame) =>
  api<{ list: AchRankRow[] }>(`/api/points/achievements/${game}/rank`).then((r) => r.list);

/** 그 게임에서 포인트로 산 물건 (상품 ref 목록) */
export const getInventory = (game: string) =>
  api<{ list: string[] }>(`/api/points/inv/${game}`, { auth: true }).then((r) => r.list);

/** VIRUS IDLE 기록 보고 (server/src/http/virus.ts) — files · bosses · formats 는 늘어난 만큼 */
export const reportVirus = (body: {
  best: number;
  clears: number;
  files: number;
  bosses: number;
  formats: number;
  /** 업적용 최고값 기록 (virus.* — lib/virus/logic.ts virusMetric) */
  [k: string]: number;
}) => api<{ ok: true }>("/api/virus/stats", { method: "POST", auth: true, body });

/** VIRUS IDLE GP 상점 (server/src/http/virus.ts) */
type VShopRes = import("@/lib/virus/gpShop").VShopState;
export const getVirusShop = () => api<VShopRes>("/api/virus/shop", { auth: true });
export const virusStore = (id: string) =>
  api<VShopRes & { points: number }>("/api/virus/store", {
    method: "POST",
    auth: true,
    body: { id },
  });
export const virusPack = (id: string) =>
  api<VShopRes & { points: number; utils: string[] }>("/api/virus/pack", {
    method: "POST",
    auth: true,
    body: { id },
  });
export const virusSell = (id: string, have: number) =>
  api<VShopRes & { points: number; paid: number }>("/api/virus/sell", {
    method: "POST",
    auth: true,
    body: { id, have },
  });
export const virusClaim = () =>
  api<VShopRes & { got: { cores: number; warpH: number } }>("/api/virus/claim", {
    method: "POST",
    auth: true,
  });

export const buyItem = (item: string) =>
  api<{ points: number }>("/api/points/buy", {
    method: "POST",
    auth: true,
    body: { item },
  });

export const getDaily = (game: AchGame) =>
  api<{ list: DailyState[]; points: number | null }>(`/api/points/daily/${game}`, { auth: true });

/** 일일 미션 받기 — id 가 없으면 받을 수 있는 것 전부 */
export const claimDaily = (game: AchGame, id?: string) =>
  api<{ reward: number; ids: string[]; points: number }>(`/api/points/daily/${game}/claim`, {
    method: "POST",
    auth: true,
    body: id ? { id } : {},
  });
