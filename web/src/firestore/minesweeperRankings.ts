import { api } from "@/lib/api/http";
import { toDate } from "@/lib/rankDate";

const BOARD = "minesweeper_rankings";

export interface MineRanking {
  id: string;
  name: string;
  time: number;
  /** 달성 일자 (예전 기록은 없을 수 있음) */
  createdAt: Date | null;
}

/** 서버 응답 한 줄 (날짜는 ms) */
export interface MineRankingRow {
  id: string;
  name: string;
  time: number;
  createdAt: number | null;
}
export const MINE_RANKINGS_PATH = `/api/rankings/${BOARD}`;
export const toMineRanking = (x: MineRankingRow): MineRanking => ({
  id: x.id,
  name: x.name,
  time: x.time,
  createdAt: toDate(x.createdAt),
});

export async function getTopRankings(count = 10): Promise<MineRanking[]> {
  const rows = await api<MineRankingRow[]>(`${MINE_RANKINGS_PATH}?limit=${count}`);
  return rows.map(toMineRanking);
}

export async function addRanking(name: string, time: number): Promise<void> {
  await api(MINE_RANKINGS_PATH, { method: "POST", body: { name, time } });
}
