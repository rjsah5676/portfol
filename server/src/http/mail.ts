import { Router, type Request } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { unauthenticated } from "../errors";
import { MAIL_MAX_DAYS, type Mail } from "../mail";
import { h, requireAdmin, userOf } from "./util";

/*
 * 우편 (../mail.ts)
 *   GET  /api/mail                  내 우편 (기한 안) + 안 받은 수
 *   GET  /api/mail/unread           안 받은 수만 (플로팅 버튼)
 *   POST /api/mail/:id/claim        하나 받기 (GP 가 있으면 그만큼)
 *   POST /api/mail/claim-all        전부 받기
 * 관리자
 *   GET    /api/admin/mail          보낸 우편 (최근 50, 받은 사람 수)
 *   POST   /api/admin/mail          { to: "*" | 별명[], title, body, points, days }
 *   DELETE /api/admin/mail/:id      회수 (안 받은 사람은 더 못 받음)
 */
export function mailRouter({ auth }: Deps, mail: Mail): Router {
  const r = Router();
  const member = async (req: Request) => {
    const user = await userOf(auth, req);
    if (!user || user.anonymous) throw unauthenticated();
    return user;
  };

  r.get(
    "/",
    h(async (req) => {
      const list = await mail.list((await member(req)).uid);
      return { list, unread: list.filter((m) => m.gotAt === null).length };
    })
  );
  r.get(
    "/unread",
    h(async (req) => {
      const user = await userOf(auth, req);
      return { unread: user && !user.anonymous ? await mail.unread(user.uid) : 0 };
    })
  );
  r.post(
    "/claim-all",
    h(async (req) => mail.claimAll((await member(req)).uid))
  );
  r.post(
    "/:id/claim",
    h(async (req) => mail.claim((await member(req)).uid, z.string().max(40).parse(req.params.id)))
  );
  return r;
}

export function mailAdminRouter({ auth }: Deps, mail: Mail): Router {
  const r = Router();
  r.use((req, _res, next) => {
    requireAdmin(auth, req).then(() => next(), next);
  });
  r.get(
    "/",
    h(async () => ({ list: await mail.sent() }))
  );
  r.post(
    "/",
    h(async (req) => {
      const body = z
        .object({
          to: z.union([z.literal("*"), z.array(z.string().max(20)).min(1).max(200)]),
          title: z.string().trim().min(1).max(40),
          body: z.string().trim().max(500).default(""),
          points: z.number().int().min(0).max(1_000_000),
          days: z.number().int().min(1).max(MAIL_MAX_DAYS),
        })
        .parse(req.body);
      return mail.send(body);
    })
  );
  r.delete(
    "/:id",
    h(async (req) => {
      await mail.remove(String(req.params.id));
    })
  );
  return r;
}
