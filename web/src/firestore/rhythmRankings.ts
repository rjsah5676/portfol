import { api } from "@/lib/api/http";
import { submitRun } from "@/lib/api/rankRun";
import { toDate } from "@/lib/rankDate";

// 곡·난이도별로 따로 줄 세움: /api/rankings/rhythm/{songId}_{diff}
const chartPath = (songId: string, diff: string) =>
  `/api/rankings/rhythm/${encodeURIComponent(`${songId}_${diff}`)}`;

/** 게임을 시작할 때 beginRun 에 넘기는 랭킹 이름 */
export const rhythmBoard = (songId: string, diff: string) => `rhythm:${songId}_${diff}`;

export const RHYTHM_NAME_MAX = 10;

export interface RhythmRanking {
  id: string;
  name: string;
  /** 회원의 기록인지 */
  member: boolean;
  /** 회원이 올린 프로필 사진 주소 (없으면 null) */
  avatar: string | null;
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
    member: !!x.member,
    avatar: x.avatar ?? null,
    score: Number(x.score ?? 0),
    acc: Number(x.acc ?? 0),
    maxCombo: Number(x.maxCombo ?? 0),
    fc: !!x.fc,
    ap: !!x.ap,
    createdAt: toDate(x.createdAt),
  }));
}

/** 회원 BP 랭킹 한 줄 */
export interface BpRanking {
  id: string;
  rank: number;
  name: string;
  member: boolean;
  avatar: string | null;
  /** 곡별 최고 BP 상위 20곡 합 */
  bp: number;
  /** 기록이 있는 곡 수 */
  songs: number;
  /** 가장 높은 BP를 낸 채보 */
  best: { bp: number; chart: string; score: number } | null;
}

export async function getBpTop(count = 20): Promise<BpRanking[]> {
  const rows = await api<Partial<BpRanking>[]>(`/api/rankings/rhythm-bp?limit=${count}`);
  return rows.map((x, i) => ({
    id: String(x.id ?? i),
    rank: Number(x.rank ?? i + 1),
    name: String(x.name ?? ""),
    member: !!x.member,
    avatar: x.avatar ?? null,
    bp: Number(x.bp ?? 0),
    songs: Number(x.songs ?? 0),
    best: x.best ?? null,
  }));
}

export async function addRhythmRanking(
  songId: string,
  diff: string,
  r: Omit<RhythmRanking, "id" | "createdAt" | "member" | "avatar">
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
