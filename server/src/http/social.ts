import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { unauthenticated } from "../errors";
import { REPORT_REASONS, REPORT_TEXT_MAX } from "../../../web/src/lib/social";
import { h, requireAdmin, userOf } from "./util";

/*
 * 정보보기 · 신고 (../social.ts). 친구 · 메신저는 실시간(rpc · "social" 구독)으로만.
 *   GET  /api/users/:nick/card        공개 정보 카드 (누구나, 로그인했으면 나와의 사이 · 친구면 접속 표시까지)
 *   POST /api/reports                 { nick, reason, text, where }  회원만
 * 관리자
 *   GET  /api/admin/reports?status=open|done|all
 *   POST /api/admin/reports/:id       { status?, note? }
 */
export function socialRouter({ auth, social }: Deps): Router {
  const r = Router();
  r.get(
    "/users/:nick/card",
    h(async (req) => {
      const nick = z.string().trim().min(1).max(20).parse(req.params.nick);
      const user = await userOf(auth, req);
      return social.card(nick, user && !user.anonymous ? user.uid : null);
    })
  );
  r.post(
    "/reports",
    h(async (req) => {
      const user = await userOf(auth, req);
      if (!user || user.anonymous) throw unauthenticated();
      const body = z
        .object({
          nick: z.string().trim().min(1).max(20),
          reason: z.enum(REPORT_REASONS),
          text: z.string().max(REPORT_TEXT_MAX * 2).default(""),
          where: z.string().max(300).default(""),
        })
        .parse(req.body);
      return social.report(user.uid, body);
    })
  );
  return r;
}

export function socialAdminRouter({ auth, social }: Deps): Router {
  const r = Router();
  r.use((req, _res, next) => {
    requireAdmin(auth, req).then(() => next(), next);
  });
  r.get(
    "/",
    h(async (req) => {
      const status = z.enum(["open", "done", "all"]).default("open").parse(req.query.status);
      return social.reportList(status);
    })
  );
  r.post(
    "/:id",
    h(async (req) => {
      const body = z.object({ status: z.enum(["open", "done"]).optional(), note: z.string().max(500).optional() }).parse(req.body);
      await social.reportSet(z.string().max(40).parse(req.params.id), body);
    })
  );
  return r;
}
