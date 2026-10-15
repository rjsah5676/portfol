import { Router, type Request } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, unauthenticated } from "../errors";
import { h, userOf } from "./util";

/*
 * 포인트 (숫자 · 상품 · 업적 정의는 web/src/lib/points.ts, 바꾸는 건 ../points.ts)
 *   GET  /api/points                         내 잔액 · 오늘 출석 여부 · 최근 내역
 *   GET  /api/points/achievements/:game      그 게임 업적 (진행 숫자 · 받았는지). 로그인 안 했으면 숫자 0
 *   GET  /api/points/achievements/:game/rank 업적 랭킹 (그 게임 업적으로 받은 포인트 합)
 *   POST /api/points/achievements/:id/claim  업적 보상 받기 (서버가 기록으로 다시 확인)
 *   GET  /api/points/daily/:game             그 게임 일일 미션 (오늘 한 만큼 · 받았는지). 로그인 안 했으면 숫자 0
 *   POST /api/points/daily/:game/claim       { id? } 일일 미션 보상 받기 (id 가 없으면 받을 수 있는 것 전부)
 *   POST /api/points/buy                     { item } 상품 사기 (포커 상품은 포커 상점에서도 같은 것)
 *   GET  /api/points/inventory/:game         그 게임에서 산 물건 ref 목록 (inv.<게임>). 로그인 안 했으면 빈 목록
 * 출석 포인트는 GET /api/me (사이트에 들어올 때) 에서 하루 한 번 들어감.
 */
export function pointsRouter({ auth, points }: Deps): Router {
  const r = Router();

  const member = async (req: Request) => {
    const user = await userOf(auth, req);
    if (!user || user.anonymous) throw unauthenticated();
    return user;
  };
  const game = z.enum(["poker", "fight", "defense", "rhythm", "sketch", "marble"]);

  r.get(
    "/",
    h(async (req) => {
      const user = await member(req);
      const info = await points.get(user.uid);
      if (!info) throw new AppError("NOT_MEMBER", "회원만 쓸 수 있어요.", 403);
      return { ...info, log: await points.log(user.uid, 30) };
    })
  );

  r.get(
    "/achievements/:game",
    h(async (req) => {
      const g = game.parse(req.params.game);
      const user = await userOf(auth, req);
      const uid = user && !user.anonymous && (await points.get(user.uid)) ? user.uid : null;
      return { list: await points.achievements(uid, g), points: uid ? ((await points.get(uid))?.points ?? 0) : null };
    })
  );

  r.get(
    "/achievements/:game/rank",
    h(async (req) => ({ list: await points.achRank(game.parse(req.params.game), 50) }))
  );

  r.post(
    "/achievements/:id/claim",
    h(async (req) => {
      const user = await member(req);
      return points.claim(user.uid, z.string().max(60).parse(req.params.id));
    })
  );

  r.get(
    "/daily/:game",
    h(async (req) => {
      const g = game.parse(req.params.game);
      const user = await userOf(auth, req);
      const uid = user && !user.anonymous && (await points.get(user.uid)) ? user.uid : null;
      return { list: await points.daily(uid, g), points: uid ? ((await points.get(uid))?.points ?? 0) : null };
    })
  );

  r.post(
    "/daily/:game/claim",
    h(async (req) => {
      const user = await member(req);
      const id = z.object({ id: z.string().max(60).optional() }).parse(req.body ?? {}).id;
      return points.claimDaily(user.uid, game.parse(req.params.game), id);
    })
  );

  r.post(
    "/buy",
    h(async (req) => {
      const user = await member(req);
      const { item } = z.object({ item: z.string().max(80) }).parse(req.body);
      return { points: await points.buy(user.uid, item) };
    })
  );

  r.get(
    "/inventory/:game",
    h(async (req) => {
      const g = game.parse(req.params.game);
      const user = await userOf(auth, req);
      return { list: user && !user.anonymous ? await points.inventory(user.uid, g) : [] };
    })
  );

  return r;
}
