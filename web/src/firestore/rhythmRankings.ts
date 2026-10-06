import { api } from "@/lib/api/http";
import { submitRun } from "@/lib/api/rankRun";
import { toDate } from "@/lib/rankDate";

// 곡·난이도별로 따로 줄 세움: /api/rankings/rhythm/{songId}_{diff}
const chartPath = (songId: string, diff: string) =>
  `/api/rankings/rhythm/${encodeURIComponent(`${songId}_${diff}`)}`;

/** 게임을 시작할 때 beginRun 에 넘기는 랭킹 이름 */
export const rhythmBoard = (songId: string, diff: string) => `rhythm:${songId}_${diff}`;

export const RHYTHM_NAME_MAX = 12;

export interface RhythmRanking {
  id: string;
  name: string;
  score: number;
  acc: number;
  maxCombo: number;
  fc: boolean;
  ap: boolean;
  /** 달성 일자 */
  createdAt: Date | null;
}

type Row = Partial<Omit<RhythmRanking, "id" | "createdAt">> & {
  id: string;
  createdAt: number | null;
};

export async function getRhythmTop(
  songId: string,
  diff: string,
  count = 10
): Promise<RhythmRanking[]> {
  const rows = await api<Row[]>(`${chartPath(songId, diff)}?limit=${count}`);
  return rows.map((x) => ({
    id: x.id,
    name: String(x.name ?? ""),
    score: Number(x.score ?? 0),
    acc: Number(x.acc ?? 0),
    maxCombo: Number(x.maxCombo ?? 0),
    fc: !!x.fc,
    ap: !!x.ap,
    createdAt: toDate(x.createdAt),
  }));
}

export async function addRhythmRanking(
  songId: string,
  diff: string,
  r: Omit<RhythmRanking, "id" | "createdAt">
): Promise<string> {
  return submitRun(rhythmBoard(songId, diff), chartPath(songId, diff), {
    name: r.name.trim().slice(0, RHYTHM_NAME_MAX),
    score: Math.round(r.score),
    acc: Math.round(r.acc * 100) / 100,
    maxCombo: Math.round(r.maxCombo),
    fc: r.fc,
    ap: r.ap,
  });
}
