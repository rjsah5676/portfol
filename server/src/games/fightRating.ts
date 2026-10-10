/**
 * 격투 랭크전 레이팅 (Elo) · 랭크전 경기 기록(캐릭터 통계용) — 랭크전(회원끼리 자동 매칭 · 못 찾으면 봇)만. 일반 방 대전은 반영 안 함.
 *
 *  - 처음 1000점. 기대 승률 E = 1 / (1 + 10^((상대 − 나) / 400)), 바뀌는 점수 = K × (결과 − E)
 *    결과: 승 1 · 무 0.5 · 패 0
 *  - K: 처음 10판(배치)은 40, 그 뒤 24
 *  - 배치 보정: 배치 중에 이기면 얼마나 압도했는지(라운드 2:0, 남은 체력)만큼 최대 1.8배, 배치 3연승부터는 1.2배 더
 *    → 실력이 이 점수대가 아닌 사람은 배치 동안 빨리 제자리로
 *  - 봇전: 12초 안에 사람을 못 찾으면 비슷한 레이팅의 AI(봇)와. 봇 레이팅은 고정(최대 BOT_MAX)이라
 *    BOT_MAX 이상인 사람은 봇을 이겨도 1~2점만 오르고, 지면 보통 Elo 대로 크게 내려감
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

/** 랭크전 봇 레이팅 상한 (web lib/fight/ai.ts BOT_MAX 와 같게) */
export const BOT_MAX = 2600;

export const kOf = (games: number) => (games < RATING_PLACEMENT ? 40 : 24);

/** 경기 내용: 이긴 쪽 기준 라운드 차(0~2)와 마지막 라운드 남은 체력(0~1) — 배치 보정에 씀 */
export interface Margin {
  rounds: number;
  hp: number;
}
/** 압도 정도 0~1 (2:0 에 체력 가득이면 1) */
export const dominance = (m?: Margin | null) =>
  m ? Math.max(0, Math.min(1, 0.5 * (Math.max(0, Math.min(2, m.rounds)) / 2) + 0.5 * Math.max(0, Math.min(1, m.hp)))) : 0;

/**
 * 한 사람의 점수 변화.
 *  r, n: 내 점수·판 수 · opp: 상대 점수 · score: 1 승 · 0.5 무 · 0 패 · m: 이겼을 때 경기 내용
 *  streak: 이번 판 전 연승(+)·연패(−) 수
 *  bot: 상대가 봇
 */
export function rankDelta(r: number, n: number, opp: number, score: number, o: { m?: Margin | null; streak?: number; bot?: boolean } = {}) {
  const e = 1 / (1 + 10 ** ((opp - r) / 400));
  let d = kOf(n) * (score - e);
  const st = o.streak ?? 0;
  if (score === 1 && n < RATING_PLACEMENT) d *= (1 + 0.8 * dominance(o.m)) * (st >= 2 ? 1.2 : 1);
  else d *= streakMul(st, score);
  // 봇 레이팅 상한 위: 봇을 이겨도 1~2점 (상한 근처 봇이면 2)
  if (o.bot && score === 1 && r >= BOT_MAX) return opp >= r - 150 ? 2 : 1;
  const v = Math.round(d);
  // 이겼는데 0점·졌는데 0점은 없게 (아주 큰 점수 차여도 1점은 움직임)
  return score === 1 ? Math.max(1, v) : score === 0 ? Math.min(-1, v) : v;
}

/**
 * 연승·연패 보정 (배치 뒤): 3연승째부터 얻는 점수 ×1.1, 5연승째부터 ×1.2 /
 * 3연패째부터 잃는 점수 ×1.1, 5연패째부터 ×1.2 — 실력이 바뀐 사람이 빨리 제자리로
 */
export function streakMul(streak: number, score: number) {
  if (score === 1 && streak >= 2) return streak >= 4 ? 1.2 : 1.1;
  if (score === 0 && streak <= -2) return streak <= -4 ? 1.2 : 1.1;
  return 1;
}
/** 다음 연승·연패 수: 이기면 +, 지면 −, 비기면 0 */
export const nextStreak = (prev: number | undefined, res: "w" | "l" | "d") => {
  const p = prev ?? 0;
  return res === "w" ? (p > 0 ? p + 1 : 1) : res === "l" ? (p < 0 ? p - 1 : -1) : 0;
};

/** 두 사람의 점수 변화 (배치 보정 없이). score = 0번 사람의 결과 (1 승 · 0.5 무 · 0 패) */
export function eloDelta(r0: number, r1: number, n0: number, n1: number, score: number): [number, number] {
  return [rankDelta(r0, n0, r1, score), rankDelta(r1, n1, r0, 1 - score)];
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
  /** 지금 연승(+)·연패(−) 수 — 배치 연승 보정, 배치 뒤 연승·연패 보정 */
  streak?: number;
  /** 봇전 판 수 */
  bots?: number;
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
  /** 봇전 (1번 자리가 봇 — uids[1] 은 "bot:별명") — 캐릭터 통계엔 사람 판과 똑같이 들어감 */
  bot?: boolean;
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
    async logGame(uids: [string, string], chars: [number, number], map: number, out: 0 | 1 | 2, bot = false) {
      await games.insertOne({ _id: newId(), at: new Date(), uids, chars, map, out, ...(bot ? { bot: true } : {}) });
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
          if (c0 < 0 || c1 < 0 || c0 === c1) continue;
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
    async rate(uids: [string, string], out: 0 | 1 | 2, m?: Margin | null): Promise<{ delta: [number, number]; r: [number, number] } | null> {
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
        const delta: [number, number] = [
          rankDelta(ra, da?.n ?? 0, rb, score, { m, streak: da?.streak }),
          rankDelta(rb, dbDoc?.n ?? 0, ra, 1 - score, { m, streak: dbDoc?.streak }),
        ];
        const now = new Date();
        const save = (uid: string, name: string, prev: RatingDoc | null, r: number, res: "w" | "l" | "d") =>
          col.updateOne(
            { uid },
            {
              $set: { name, member: true, r, updatedAt: now, peak: Math.max(prev?.peak ?? RATING_START, r), streak: nextStreak(prev?.streak, res) },
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

    /** 봇전 결과 반영 (봇 레이팅은 고정이라 내 점수만). out: 0 = 나 승, 1 = 봇 승, 2 = 무승부 */
    async rateBot(uid: string, botR: number, out: 0 | 1 | 2, m?: Margin | null): Promise<{ delta: number; r: number } | null> {
      const name = await users.nickByUid(uid);
      if (!name) return null;
      return mutex.run("fight-rating", async () => {
        const prev = await col.findOne({ uid });
        const r0 = prev?.r ?? RATING_START;
        const score = out === 2 ? 0.5 : out === 0 ? 1 : 0;
        const delta = rankDelta(r0, prev?.n ?? 0, botR, score, { m, streak: prev?.streak, bot: true });
        const r = Math.max(0, r0 + delta);
        const res = out === 2 ? "d" : out === 0 ? "w" : "l";
        await col.updateOne(
          { uid },
          {
            $set: { name, member: true, r, updatedAt: new Date(), peak: Math.max(prev?.peak ?? RATING_START, r), streak: nextStreak(prev?.streak, res) },
            $inc: { n: 1, bots: 1, [res]: 1 },
            $setOnInsert: { _id: newId(), uid },
          },
          { upsert: true }
        );
        return { delta: r - r0, r };
      });
    },

    /** 내 최근 랭크전 (새것부터): 내 캐릭터 · 상대 · 상대 캐릭터 · 결과 · AI전인지 */
    async recent(uid: string, limit: number) {
      const docs = await games.find({ uids: uid }).sort({ at: -1 }).limit(limit).toArray();
      const opps = [...new Set(docs.map((g) => g.uids[g.uids[0] === uid ? 1 : 0]).filter((u) => !u.startsWith("bot:")))];
      const names = new Map(await Promise.all(opps.map(async (u) => [u, (await users.nickByUid(u)) ?? "?"] as const)));
      return docs.map((g) => {
        const seat = g.uids[0] === uid ? 0 : 1;
        const o = g.uids[1 - seat];
        return {
          at: g.at.getTime(),
          ch: g.chars[seat],
          oppCh: g.chars[1 - seat],
          opp: o.startsWith("bot:") ? o.slice(4) : (names.get(o) ?? "?"),
          bot: !!g.bot,
          map: g.map,
          res: g.out === 2 ? ("d" as const) : g.out === seat ? ("w" as const) : ("l" as const),
        };
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
