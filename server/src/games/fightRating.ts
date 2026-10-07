/**
 * 격투 온라인 레이팅 (Elo) — 회원끼리 한 경기만.
 *
 *  - 처음 1000점. 기대 승률 E = 1 / (1 + 10^((상대 − 나) / 400)), 바뀌는 점수 = K × (결과 − E)
 *    결과: 승 1 · 무 0.5 · 패 0
 *  - K: 처음 10판은 40 (빨리 제자리를 찾게), 그 뒤 24
 *  - 같은 두 사람끼리는 하루(24시간)에 5판까지만 레이팅에 반영 (둘이 짜고 올리기 막기). 승패 전적은 그대로 쌓임
 *  - 비회원이 한 명이라도 끼면 반영 안 함
 */
import type { Database } from "../db";
import { newId } from "../ids";
import { KeyedMutex } from "../mutex";
import type { Users } from "../users";

export const RATING_START = 1000;
/** 이 판 수 전까지는 "배치 중" (K 가 크고, 랭킹에 표시) */
export const RATING_PLACEMENT = 10;
export const PAIR_DAILY_MAX = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export const kOf = (games: number) => (games < RATING_PLACEMENT ? 40 : 24);

/** 두 사람의 점수 변화. score = 0번 사람의 결과 (1 승 · 0.5 무 · 0 패) */
export function eloDelta(r0: number, r1: number, n0: number, n1: number, score: number): [number, number] {
  const e0 = 1 / (1 + 10 ** ((r1 - r0) / 400));
  return [Math.round(kOf(n0) * (score - e0)), Math.round(kOf(n1) * (1 - score - (1 - e0)))];
}

export interface RatingDoc {
  _id: string;
  uid: string;
  /** 별명 (바뀌면 users.syncNames 가 맞춤) */
  name: string;
  member: boolean;
  r: number;
  /** 레이팅에 반영된 판 수 */
  n: number;
  w: number;
  l: number;
  d: number;
  peak: number;
  updatedAt: Date;
}

export type FightRating = ReturnType<typeof createFightRating>;

export function createFightRating(db: Database, users: Users) {
  const col = db.col<RatingDoc>("fight_ratings");
  const log = db.col<{ pair: string; at: Date }>("fight_rating_log");
  const mutex = new KeyedMutex();

  return {
    /** 경기 결과 반영. out: 0 = 0번 자리 승, 1 = 1번 자리 승, 2 = 무승부. 반영했으면 바뀐 점수 */
    async rate(uids: [string, string], out: 0 | 1 | 2): Promise<[number, number] | null> {
      const [a, b] = uids;
      if (!a || !b || a === b) return null;
      const [na, nb] = await Promise.all([users.nickByUid(a), users.nickByUid(b)]);
      if (!na || !nb) return null;
      // 한 번에 하나씩 (두 사람 점수를 읽고 쓰는 사이에 다른 경기 결과가 끼지 않게)
      return mutex.run("fight-rating", async () => {
        const pair = [a, b].sort().join(":");
        const recent = await log.countDocuments({ pair, at: { $gt: new Date(Date.now() - DAY_MS) } });
        if (recent >= PAIR_DAILY_MAX) return null;
        await log.insertOne({ _id: newId(), pair, at: new Date() });

        const [da, dbDoc] = await Promise.all([col.findOne({ uid: a }), col.findOne({ uid: b })]);
        const ra = da?.r ?? RATING_START,
          rb = dbDoc?.r ?? RATING_START;
        const score = out === 2 ? 0.5 : out === 0 ? 1 : 0;
        const delta = eloDelta(ra, rb, da?.n ?? 0, dbDoc?.n ?? 0, score);
        const now = new Date();
        const save = (uid: string, name: string, prev: RatingDoc | null, r: number, res: "w" | "l" | "d") =>
          col.updateOne(
            { uid },
            {
              $set: { name, member: true, r, updatedAt: now, peak: Math.max(prev?.peak ?? RATING_START, r) },
              $inc: { n: 1, [res]: 1 },
              $setOnInsert: { _id: newId(), uid },
            },
            { upsert: true }
          );
        await Promise.all([
          save(a, na, da, ra + delta[0], out === 2 ? "d" : out === 0 ? "w" : "l"),
          save(b, nb, dbDoc, rb + delta[1], out === 2 ? "d" : out === 1 ? "w" : "l"),
        ]);
        return delta;
      });
    },

    /** 레이팅 랭킹 (회원만, 높은 순) */
    async top(limit: number) {
      return col.find({ member: true, n: { $gt: 0 } }).sort({ r: -1, n: -1, _id: 1 }).limit(limit).toArray();
    },

    /** 내 레이팅과 순위 (없으면 null) */
    async mine(uid: string) {
      const d = await col.findOne({ uid });
      if (!d || !d.n) return null;
      const [better, of] = await Promise.all([
        col.countDocuments({ member: true, n: { $gt: 0 }, r: { $gt: d.r } }),
        col.countDocuments({ member: true, n: { $gt: 0 } }),
      ]);
      return { r: d.r, n: d.n, w: d.w ?? 0, l: d.l ?? 0, d: d.d ?? 0, peak: d.peak, rank: better + 1, of };
    },
  };
}
