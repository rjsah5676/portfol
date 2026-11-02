import { Router } from "express";
import { z } from "zod";
import { kstDay } from "../../../web/src/lib/suspect/engine";
import type { Deps } from "../deps";
import { h, requireAdmin } from "./util";

/*
 * 오늘의 용의자 관리자 초기화.
 *  데일리 초기화: 판 진행 · 해결 기록은 각 브라우저 localStorage 에만 있어서, 서버엔 "언제 초기화했는지"만 두고
 *    게임이 열릴 때 이 시각보다 오래된 기록을 스스로 지움 (올인 러브 초기화와 같은 방식 — http/love.ts)
 *  데일리 랭킹 초기화: suspect_rankings 에서 그날(또는 전부) 기록을 지움
 *
 *   GET  /api/suspect/reset                  { at } (초기화한 적 없으면 0)
 *   GET  /api/admin/suspect/stats            { today, total } 랭킹 기록 수 (관리자)
 *   POST /api/admin/suspect/reset            { confirm: "데일리 초기화" } → { at }
 *   POST /api/admin/suspect/rankings/reset   { confirm: "데일리 랭킹 초기화", day: "YYYYMMDD" | "all" } → { deleted }
 */

export const SUSPECT_RESET_CONFIRM = "데일리 초기화";
export const SUSPECT_RANK_RESET_CONFIRM = "데일리 랭킹 초기화";

export function suspectRouters({ auth, db }: Deps): { pub: Router; admin: Router } {
  const conf = db.col<{ _id: string; resetAt: number }>("site_config");
  const ranks = db.col("suspect_rankings");
  let at = 0;
  const ready = conf
    .findOne({ _id: "suspect" })
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
    }),
  );

  const admin = Router();
  admin.use((req, _res, next) => {
    requireAdmin(auth, req).then(() => next(), next);
  });
  admin.get(
    "/stats",
    h(async () => {
      const day = kstDay();
      const [today, total] = await Promise.all([
        ranks.countDocuments({ case: { $regex: `^${day}_` } }),
        ranks.countDocuments({}),
      ]);
      return { today, total };
    }),
  );
  admin.post(
    "/reset",
    h(async (req) => {
      z.strictObject({ confirm: z.literal(SUSPECT_RESET_CONFIRM) }).parse(req.body);
      await ready;
      at = Date.now();
      await conf.updateOne({ _id: "suspect" }, { $set: { resetAt: at } }, { upsert: true });
      return { at };
    }),
  );
  admin.post(
    "/rankings/reset",
    h(async (req) => {
      const { day } = z
        .strictObject({
          confirm: z.literal(SUSPECT_RANK_RESET_CONFIRM),
          day: z.union([z.literal("all"), z.string().regex(/^\d{8}$/)]),
        })
        .parse(req.body);
      const r = await ranks.deleteMany(day === "all" ? {} : { case: { $regex: `^${day}_` } });
      console.warn(`[admin] 오늘의 용의자 랭킹 초기화 ${day} → ${r.deletedCount}`);
      return { deleted: r.deletedCount };
    }),
  );
  return { pub, admin };
}
