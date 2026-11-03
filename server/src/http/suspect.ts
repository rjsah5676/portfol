import { Router } from "express";
import { z } from "zod";
import { kstDay } from "../../../web/src/lib/suspect/engine";
import type { Deps } from "../deps";
import { clearSuspectHall } from "./suspectHall";
import { h, requireAdmin } from "./util";

/*
 * 오늘의 용의자 관리자 초기화.
 *  판 진행 · 해결 기록은 각 브라우저 localStorage 에만 있어서, 서버엔 "언제 · 어느 날짜를 초기화했는지"만 두고
 *  게임이 열릴 때 그보다 오래된 기록을 스스로 지움 (올인 러브 초기화와 같은 방식 — http/love.ts)
 *   - 데일리 초기화: 모든 날짜의 판 진행 · 해결 수 · 연속 해결 · 최고 기록 (day "all")
 *   - 데일리 랭킹 초기화: suspect_rankings 에서 그날(또는 전부) 기록을 지우고, 그 날짜의 판 진행도 같이 초기화
 *     (랭킹만 지우면 브라우저엔 「이미 푼 사건」으로 남아서 다시 풀 수가 없었음)
 *
 *   GET  /api/suspect/reset                  { at, resets: [{ at, day }] } (최근 것부터 · 없으면 at 0)
 *   GET  /api/admin/suspect/stats            { today, total } 랭킹 기록 수 (관리자)
 *   POST /api/admin/suspect/reset            { confirm: "데일리 초기화" } → { at }
 *   POST /api/admin/suspect/rankings/reset   { confirm: "데일리 랭킹 초기화", day: "YYYYMMDD" | "all" } → { deleted, at }
 */

export const SUSPECT_RESET_CONFIRM = "데일리 초기화";
export const SUSPECT_RANK_RESET_CONFIRM = "데일리 랭킹 초기화";
/** 기억해 두는 초기화 수 (한동안 안 들어온 브라우저도 그사이 초기화를 다 따라가게) */
const KEEP = 30;

export interface SuspectReset {
  at: number;
  /** "YYYYMMDD" 그날만 · "all" 전부 */
  day: string;
}

export function suspectRouters({ auth, db }: Deps): { pub: Router; admin: Router } {
  const conf = db.col<{ _id: string; resetAt?: number; resets?: SuspectReset[] }>("site_config");
  const ranks = db.col("suspect_rankings");
  let resets: SuspectReset[] = [];
  const ready = conf
    .findOne({ _id: "suspect" })
    .then((d) => {
      resets = d?.resets ?? (d?.resetAt ? [{ at: d.resetAt, day: "all" }] : []);
    })
    .catch(() => {});
  const push = async (day: string) => {
    await ready;
    // 같은 ms 에 두 번 눌러도 순서가 갈리게
    const at = Math.max(Date.now(), (resets[0]?.at ?? 0) + 1);
    resets = [{ at, day }, ...resets].slice(0, KEEP);
    await conf.updateOne({ _id: "suspect" }, { $set: { resets, resetAt: at } }, { upsert: true });
    return at;
  };

  const pub = Router();
  pub.get(
    "/reset",
    h(async (_req, res) => {
      await ready;
      // 초기화한 직후 바로 반영되게 캐시하지 않음 (게임을 열 때 한 번만 부름)
      res.setHeader("Cache-Control", "no-store");
      return { at: resets[0]?.at ?? 0, resets };
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
      return { at: await push("all") };
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
      clearSuspectHall();
      const at = await push(day);
      console.warn(`[admin] 오늘의 용의자 랭킹 초기화 ${day} → ${r.deletedCount}`);
      return { deleted: r.deletedCount, at };
    }),
  );
  return { pub, admin };
}
