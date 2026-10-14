import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError } from "../errors";
import type { Moderation } from "../moderation";
import { grantOf } from "../points";
import { SHOP, shopItem } from "../../../web/src/lib/points";
import { h, requireAdmin } from "./util";

/*
 * 관리자 · 회원 더 보기 (../http/admin.ts 의 회원 목록 · 고치기와 같이 씀)
 *   GET   /api/admin/members/:uid           가진 상품 · 게임 요약(격투 랭크 · 디펜스 최고 · 포커 칩 · 업적 수) · 정지 상태
 *   POST  /api/admin/members/:uid/items     { item, give }  상품 주기 · 빼기 (GP 는 그대로)
 *   PUT   /api/admin/members/:uid/ban       { days: n | null(영구) | 0(풀기), reason }
 */

/** "a.b" 경로의 배열 값 */
const arrAt = (doc: Record<string, unknown>, path: string): unknown[] => {
  const v = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), doc);
  return Array.isArray(v) ? v : [];
};

export function adminMembersRouter({ auth, db }: Deps, mod: Moderation): Router {
  const r = Router();
  r.use((req, _res, next) => {
    requireAdmin(auth, req).then(() => next(), next);
  });
  const users = db.col("users");

  const owned = (d: Record<string, unknown>) =>
    SHOP.filter((it) => {
      const [path, ref] = Object.entries(grantOf(it).owned)[0];
      return arrAt(d, path).includes(ref);
    }).map((it) => it.id);

  r.get(
    "/:uid",
    h(async (req) => {
      const uid = String(req.params.uid);
      const d = (await users.findOne({ _id: uid }, { projection: { "avatar.data": 0 } })) as Record<string, unknown> | null;
      if (!d) throw new AppError("NOT_FOUND", "없는 회원이에요.", 404);
      const [fight, defense] = await Promise.all([
        db.col("fight_rank_ratings").findOne({ uid } as never),
        db.col("defense_rank").find({ uid } as never).sort({ score: -1 }).limit(1).toArray(),
      ]);
      const f = fight as { r?: number; n?: number; w?: number; l?: number; peak?: number } | null;
      const df = defense[0] as { wave?: number; win?: boolean; glitch?: number; ver?: string } | undefined;
      return {
        items: owned(d),
        shop: SHOP.map((it) => ({ id: it.id, game: it.game, name: it.name, price: it.price })),
        achs: Array.isArray(d.achs) ? d.achs.length : 0,
        fight: f ? { r: Math.round(f.r ?? 0), n: f.n ?? 0, w: f.w ?? 0, l: f.l ?? 0, peak: Math.round(f.peak ?? 0) } : null,
        defense: df ? { wave: df.wave ?? 0, win: !!df.win, glitch: df.glitch ?? 0, ver: df.ver ?? "" } : null,
        ban: mod.active(uid),
      };
    })
  );

  r.post(
    "/:uid/items",
    h(async (req) => {
      const uid = String(req.params.uid);
      const body = z.strictObject({ item: z.string().max(80), give: z.boolean() }).parse(req.body);
      const it = shopItem(body.item);
      if (!it) throw new AppError("NOT_FOUND", "없는 상품이에요.", 404);
      const g = grantOf(it);
      const [path, ref] = Object.entries(g.owned)[0];
      const res = body.give
        ? await users.updateOne({ _id: uid, [path]: { $ne: ref } } as never, g.update as never)
        : await users.updateOne({ _id: uid, [path]: ref } as never, { $pull: { [path]: ref } } as never);
      if (!res.matchedCount) {
        if (!(await users.findOne({ _id: uid }, { projection: { _id: 1 } }))) throw new AppError("NOT_FOUND", "없는 회원이에요.", 404);
        throw new AppError(body.give ? "OWNED" : "NOT_OWNED", body.give ? "이미 가진 상품이에요." : "가지고 있지 않은 상품이에요.", 409);
      }
      console.warn(`[admin] 상품 ${body.give ? "지급" : "회수"} ${uid} ${it.id}`);
      const d = (await users.findOne({ _id: uid })) as Record<string, unknown>;
      return { items: owned(d) };
    })
  );

  r.put(
    "/:uid/ban",
    h(async (req) => {
      const body = z
        .strictObject({ days: z.number().int().min(0).max(3650).nullable(), reason: z.string().max(100).default("") })
        .parse(req.body);
      const ban = await mod.set(String(req.params.uid), body.days, body.reason);
      console.warn(`[admin] 이용 정지 ${req.params.uid} ${body.days === 0 ? "풀기" : `${body.days ?? "영구"}일`} ${body.reason}`);
      return { ban };
    })
  );

  return r;
}
