import type { Deps } from "../deps";
import { ms } from "./util";

/*
 * 오늘의 용의자 누적 랭킹 (명예의 전당) — 날짜 상관없이 한 사람이 푼 사건 수 · 1위 횟수 · 완벽 해결 수.
 *  suspect_rankings 전체를 모아야 해서 1분 캐시. 새 기록이 올라오거나 관리자가 랭킹을 지우면 비움
 *   tier = "all" 이면 전 난이도, 아니면 그 난이도 사건만
 */

export interface HallRow {
  uid: string;
  name: string;
  member: boolean;
  /** 푼 사건 수 */
  solved: number;
  /** 그 사건 1위 횟수 (오늘 사건은 아직 바뀔 수 있음) */
  wins: number;
  /** 실수 없이 푼 사건 수 */
  perfect: number;
  /** 처음 · 마지막으로 올린 시각 (ms) */
  first: number;
  last: number | null;
}
export interface Hall {
  /** 기록이 하나라도 있는 사건 수 */
  cases: number;
  list: HallRow[];
}

const TTL = 60_000;
const cache = new Map<string, { at: number; v: Promise<Hall> }>();
export const clearSuspectHall = () => cache.clear();

export function suspectHall(db: Deps["db"], tier: string): Promise<Hall> {
  const hit = cache.get(tier);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const v = load(db, tier);
  cache.set(tier, { at: Date.now(), v });
  v.catch(() => cache.delete(tier));
  return v;
}

async function load(db: Deps["db"], tier: string): Promise<Hall> {
  const col = db.col("suspect_rankings");
  const match = tier === "all" ? {} : { case: { $regex: `_${tier}$` } };
  const [people, winners] = await Promise.all([
    col
      .aggregate<{
        _id: string;
        solved: number;
        perfect: number;
        name: string;
        member?: boolean;
        first: Date;
        last: Date;
      }>([
        { $match: match },
        { $sort: { createdAt: 1 } },
        {
          $group: {
            _id: "$uid",
            solved: { $sum: 1 },
            perfect: {
              $sum: { $cond: [{ $and: [{ $eq: ["$miss", 0] }, { $eq: ["$hint", 0] }] }, 1, 0] },
            },
            name: { $last: "$name" },
            member: { $last: "$member" },
            first: { $min: "$createdAt" },
            last: { $max: "$createdAt" },
          },
        },
      ])
      .toArray(),
    // 사건마다 1등 (점수 → 먼저 올린 순) → 사람마다 몇 번
    col
      .aggregate<{ _id: string; wins: number }>([
        { $match: match },
        { $sort: { case: 1, score: 1, createdAt: 1 } },
        { $group: { _id: "$case", uid: { $first: "$uid" } } },
        { $group: { _id: "$uid", wins: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const wins = new Map(winners.map((w) => [String(w._id), w.wins]));
  return {
    cases: winners.reduce((n, w) => n + w.wins, 0),
    list: people.map((p) => ({
      uid: String(p._id),
      name: p.name,
      member: !!p.member,
      solved: p.solved,
      wins: wins.get(String(p._id)) ?? 0,
      perfect: p.perfect,
      first: ms(p.first) ?? 0,
      last: ms(p.last),
    })),
  };
}

export type HallSort = "solved" | "wins";
/** 해결 수 순(같으면 1위 횟수) · 1위 횟수 순(같으면 해결 수). 둘 다 같으면 먼저 시작한 사람 */
export function sortHall(list: HallRow[], by: HallSort): HallRow[] {
  const k = (x: HallRow) => (by === "wins" ? [x.wins, x.solved] : [x.solved, x.wins]);
  return [...list].sort((a, b) => {
    const [a1, a2] = k(a);
    const [b1, b2] = k(b);
    return b1 - a1 || b2 - a2 || a.first - b.first;
  });
}
