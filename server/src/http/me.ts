import express, { Router, type Request } from "express";
import type { Deps } from "../deps";
import { unauthenticated } from "../errors";
import { createFightRating } from "../games/fightRating";
import { AVATAR_MAX_BYTES, AVATAR_TYPES } from "../users";
import { BOARDS, bpBoard } from "./rankings";
import { h, ms, userOf } from "./util";

/*
 * 로그인한 사람 자신의 정보.
 *   GET /api/me            누구로 로그인했는지 + 프로필(별명·방문 횟수) + 포인트. 별명을 아직 안 정했으면 profile = null
 *                          (회원이면 오늘 첫 접속 출석 포인트를 여기서 줌 → attended)
 *   PUT /api/me/nick       별명 정하기(가입) · 바꾸기  { nick }
 *   PUT /api/me/avatar     프로필 사진 올리기 (본문 = 사진 파일 그대로, JPG · PNG · WebP)
 *   DELETE /api/me/avatar  올린 사진 지우기 (로그인 계정의 사진으로 돌아감)
 *   GET /api/me/summary    내 정보 페이지용: 게임별 최고 기록과 순위, 전적, 픽셀 리듬업 BP 합·순위
 */
export function meRouter({ db, auth, users, points }: Deps): Router {
  const r = Router();

  const me = async (req: Request) => {
    const user = await userOf(auth, req);
    if (!user) throw unauthenticated();
    return user;
  };

  r.get(
    "/",
    h(async (req) => {
      const user = await me(req);
      // 사이트에 들어올 때마다 불림 → 방문 횟수를 여기서 셈
      if (!user.anonymous) await users.visit(user.uid, user.photo ?? undefined);
      const profile = await users.profileOf(user);
      // 회원이면 오늘 첫 접속 출석 포인트 (하루 한 번 — 받았으면 attended 에 그 양, 화면이 한 번 알림)
      const attended = profile ? await points.attend(user.uid).catch(() => 0) : 0;
      const pts = profile ? await points.get(user.uid) : null;
      return {
        uid: user.uid,
        anonymous: user.anonymous,
        admin: user.admin,
        profile,
        points: pts?.points ?? null,
        ...(attended && { attended }),
      };
    })
  );

  r.put(
    "/nick",
    h(async (req) => ({ profile: await users.setNick(await me(req), (req.body as { nick?: unknown } | undefined)?.nick) }))
  );

  r.put(
    "/avatar",
    express.raw({ type: AVATAR_TYPES, limit: AVATAR_MAX_BYTES + 1024 }),
    h(async (req) => ({ profile: await users.setAvatar(await me(req), req.body) }))
  );
  r.delete(
    "/avatar",
    h(async (req) => ({ profile: await users.clearAvatar(await me(req)) }))
  );

  r.get(
    "/summary",
    h(async (req) => {
      const user = await me(req);
      const profile = await users.profileOf(user);
      if (!profile) return { profile: null };

      // 랭킹마다 내 기록 하나 + 그보다 좋은 기록 수로 순위를 셈
      const records = (
        await Promise.all(
          Object.entries(BOARDS).map(async ([board, { sort, split }]) => {
            // 한 사람이 여러 기록을 가질 수 있으면(격투: 캐릭터마다) 가장 좋은 것, 순위는 그보다 좋은 기록을 가진 사람 수로
            const mine = await db.col(board).findOne({ uid: user.uid }, { sort });
            if (!mine) return null;
            const [field, dir] = Object.entries(sort)[0];
            const filter = { [field]: dir === -1 ? { $gt: mine[field] } : { $lt: mine[field] } };
            const better = split
              ? (await db.col(board).distinct("uid", filter)).length
              : await db.col(board).countDocuments(filter);
            const { _id, uid: _uid, createdAt, ...data } = mine;
            return { board, id: _id, rank: better + 1, ...data, createdAt: ms(createdAt) };
          })
        )
      ).filter((x) => x !== null);

      const mine = await db.col("rhythm_rankings").find({ uid: user.uid }).sort({ createdAt: -1 }).limit(200).toArray();
      const rhythm = await Promise.all(
        mine.map(async ({ _id, uid: _uid, createdAt, ...data }) => ({
          id: _id,
          ...data,
          rank: (await db.col("rhythm_rankings").countDocuments({ chart: data.chart, score: { $gt: data.score } })) + 1,
          createdAt: ms(createdAt),
        }))
      );

      // BP: 회원 BP 랭킹에서 내 줄 (곡별 BP는 rhythm 기록과 채보 레벨로 화면에서 계산)
      const board = await bpBoard(db);
      const at = board.findIndex((x) => x.uid === user.uid);
      const bp = { total: at < 0 ? 0 : board[at].bp, rank: at < 0 ? null : at + 1, of: board.length };

      // 격투 온라인 레이팅
      const fightRating = await createFightRating(db, users).mine(user.uid);

      return { profile, stats: await users.statsOf(user.uid), records, rhythm, bp, fightRating, money: await users.moneyOf(user.uid) };
    })
  );

  return r;
}
