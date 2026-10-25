import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { h, requireAdmin } from "./util";

/*
 * 올인 러브(미연시) 데이터 초기화. 게임 진행은 각 브라우저 localStorage 에만 있어서,
 * 서버에는 "언제 초기화했는지"만 두고 게임이 시작할 때 이 시각보다 오래된 기록을 스스로 지운다.
 *   GET  /api/love/reset          { at } (초기화한 적 없으면 0)
 *   POST /api/admin/love/reset    { confirm: "미연시 초기화" } → { at } (관리자)
 * site_config 컬렉션의 문서 "love" 에 저장, 서버 메모리에도 들고 있음.
 */

export const LOVE_RESET_CONFIRM = "미연시 초기화";

export function loveRouters({ auth, db }: Deps): { pub: Router; admin: Router } {
  const col = db.col<{ _id: string; resetAt: number }>("site_config");
  let at = 0;
  const ready = col
    .findOne({ _id: "love" })
    .then((d) => {
      if (d?.resetAt) at = d.resetAt;
    })
    .catch(() => {});

  const pub = Router();
  pub.get(
    "/reset",
    h(async (_req, res) => {
      await ready;
      res.setHeader("Cache-Control", "public, max-age=30");
      return { at };
    })
  );

  const admin = Router();
  admin.use((req, _res, next) => {
    requireAdmin(auth, req).then(() => next(), next);
  });
  admin.post(
    "/reset",
    h(async (req) => {
      z.strictObject({ confirm: z.literal(LOVE_RESET_CONFIRM) }).parse(req.body);
      await ready;
      at = Date.now();
      await col.updateOne({ _id: "love" }, { $set: { resetAt: at } }, { upsert: true });
      return { at };
    })
  );
  return { pub, admin };
}
