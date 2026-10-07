/**
 * 격투 랭크전 레이팅 (Elo) · 랭크전 경기 기록(캐릭터 통계용) — 랭크전(회원끼리 자동 매칭)만. 일반 방 대전은 반영 안 함.
 *
 *  - 처음 1000점. 기대 승률 E = 1 / (1 + 10^((상대 − 나) / 400)), 바뀌는 점수 = K × (결과 − E)
 *    결과: 승 1 · 무 0.5 · 패 0
 *  - K: 처음 10판은 40 (빨리 제자리를 찾게), 그 뒤 24
 *  - 같은 두 사람끼리는 하루(24시간)에 10판까지만 레이팅에 반영 (둘이 짜고 올리기 막기). 승패·캐릭터 통계는 그대로 쌓임
 *  - 비회원은 랭크전에 못 들어옴 (매칭 큐에서 막음)
 */
import type { Database } from "../db";
import { newId } from "../ids";
import { KeyedMutex } from "../mutex";
import type { Users } from "../users";

export const RATING_START = 1000;
/** 이 판 수 전까지는 "배치 중" (K 가 크고, 랭킹에 표시) */
export const RATING_PLACEMENT = 10;
export const PAIR_DAILY_MAX = 10;
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

/** 랭크전 한 판 (캐릭터 통계용). chars = 캐릭터 번호 (web lib/fight/chars 의 CHARS 순서) */
export interface RankGame {
  _id: string;
  at: Date;
  uids: [string, string];
  chars: [number, number];
  map: number;
  /** 0 = 0번 자리 승, 1 = 1번 자리 승, 2 = 무승부 */
  out: 0 | 1 | 2;
}

/** 캐릭터 통계: 캐릭터별 승·패·무 (같은 캐릭터끼리 붙은 판은 뺌) + 상성(행 캐릭터가 열 캐릭터를 이긴 판 / 붙은 판) */
export interface RankStats {
  games: number;
  chars: { c: number; w: number; l: number; d: number }[];
  vs: { a: number; b: number; w: number; g: number }[];
  /** 로그인한 사람의 캐릭터별 기록 (같은 캐릭터끼리 판 포함) */
  mine?: { c: number; w: number; l: number; d: number }[];
}

export type FightRating = ReturnType<typeof createFightRating>;

export function createFightRating(db: Database, users: Users) {
  // 랭크전 도입(10.08)으로 새로 시작 — 예전 일반 대전 레이팅(fight_ratings)은 안 씀
  const col = db.col<RatingDoc>("fight_rank_ratings");
  const log = db.col<{ pair: string; at: Date }>("fight_rank_log");
  const games = db.col<RankGame>("fight_rank_games");
  let statsCache: { at: number; v: RankStats } | null = null;
  const mutex = new KeyedMutex();

  return {
    /** 랭크전 한 판 기록 (캐릭터 통계) */
    async logGame(uids: [string, string], chars: [number, number], map: number, out: 0 | 1 | 2) {
      await games.insertOne({ _id: newId(), at: new Date(), uids, chars, map, out });
      statsCache = null;
    },

    /** 캐릭터 통계 (1분 기억) + uid 가 있으면 그 사람의 캐릭터별 기록 */
    async stats(uid?: string): Promise<RankStats> {
      if (!statsCache || Date.now() - statsCache.at > 60_000) {
        const docs = await games.find({}, { projection: { chars: 1, out: 1 } }).toArray();
        const ch = new Map<number, { c: number; w: number; l: number; d: number }>();
        const vs = new Map<string, { a: number; b: number; w: number; g: number }>();
        const add = (c: number, k: "w" | "l" | "d") => {
          const x = ch.get(c) ?? { c, w: 0, l: 0, d: 0 };
          x[k]++;
          ch.set(c, x);
        };
        for (const g of docs) {
          const [c0, c1] = g.chars;
          if (c0 === c1) continue;
          add(c0, g.out === 2 ? "d" : g.out === 0 ? "w" : "l");
          add(c1, g.out === 2 ? "d" : g.out === 1 ? "w" : "l");
          for (const [a, b, win] of [
            [c0, c1, g.out === 0 ? 1 : g.out === 2 ? 0.5 : 0],
            [c1, c0, g.out === 1 ? 1 : g.out === 2 ? 0.5 : 0],
          ]) {
            const k = `${a}:${b}`;
            const x = vs.get(k) ?? { a, b, w: 0, g: 0 };
            x.w += win;
            x.g++;
            vs.set(k, x);
          }
        }
        statsCache = { at: Date.now(), v: { games: docs.length, chars: [...ch.values()], vs: [...vs.values()] } };
      }
      if (!uid) return statsCache.v;
      const my = await games.find({ uids: uid }, { projection: { uids: 1, chars: 1, out: 1 } }).toArray();
      const m = new Map<number, { c: number; w: number; l: number; d: number }>();
      for (const g of my) {
        const seat = g.uids[0] === uid ? 0 : 1;
        const c = g.chars[seat];
        const x = m.get(c) ?? { c, w: 0, l: 0, d: 0 };
        x[g.out === 2 ? "d" : g.out === seat ? "w" : "l"]++;
        m.set(c, x);
      }
      return { ...statsCache.v, mine: [...m.values()] };
    },

    /** 지금 레이팅 (없으면 시작 점수) — 매칭 화면 표시용 */
    async ratingOf(uid: string) {
      const d = await col.findOne({ uid });
      return { r: d?.r ?? RATING_START, n: d?.n ?? 0 };
    },

    /** 경기 결과 반영. out: 0 = 0번 자리 승, 1 = 1번 자리 승, 2 = 무승부. 반영했으면 바뀐 점수와 새 점수 */
    async rate(uids: [string, string], out: 0 | 1 | 2): Promise<{ delta: [number, number]; r: [number, number] } | null> {
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
        return { delta, r: [ra + delta[0], rb + delta[1]] as [number, number] };
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
