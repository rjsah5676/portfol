import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { h, requireAdmin } from "./util";

/*
 * 사이트 공지 띠 (모든 페이지 메뉴 아래). 한 번에 하나.
 *   GET /api/notice           지금 공지 (없거나 기한이 지났으면 null)
 *   PUT /api/admin/notice     { text, link?, tone, until? } · DELETE 로 내림 (관리자)
 * site_config 컬렉션의 문서 "notice" 에 저장, 서버 메모리에 들고 있음.
 */

export interface SiteNotice {
  /** 공지마다 다른 id — 닫은 공지를 브라우저가 기억할 때 씀 */
  id: string;
  text: string;
  link?: string;
  tone: "info" | "event" | "warn";
  /** 이때까지 보임 (null 이면 내릴 때까지) */
  until: number | null;
  at: number;
}

export function noticeRouters({ auth, db }: Deps): { pub: Router; admin: Router } {
  const col = db.col<SiteNotice & { _id: string }>("site_config");
  let cur: SiteNotice | null = null;
  const ready = col
    .findOne({ _id: "notice" })
    .then((d) => {
      if (d) {
        const { _id, ...n } = d;
        void _id;
        cur = n;
      }
    })
    .catch(() => {});
  const live = () => (cur && (cur.until === null || cur.until > Date.now()) ? cur : null);

  const pub = Router();
  pub.get(
    "/",
    h(async (_req, res) => {
      await ready;
      res.setHeader("Cache-Control", "public, max-age=30");
      return { notice: live() };
    })
  );

  const admin = Router();
  admin.use((req, _res, next) => {
    requireAdmin(auth, req).then(() => next(), next);
  });
  admin.get(
    "/",
    h(async () => {
      await ready;
      return { notice: cur };
    })
  );
  admin.put(
    "/",
    h(async (req) => {
      const b = z
        .strictObject({
          text: z.string().trim().min(1).max(200),
          link: z
            .string()
            .trim()
            .max(300)
            .regex(/^(\/|https:\/\/)/, "링크는 / 로 시작하는 사이트 주소나 https:// 주소만 돼요.")
            .optional()
            .or(z.literal("")),
          tone: z.enum(["info", "event", "warn"]).default("info"),
          until: z.number().int().nullable().default(null),
        })
        .parse(req.body);
      const n: SiteNotice = { id: Date.now().toString(36), text: b.text, ...(b.link ? { link: b.link } : {}), tone: b.tone, until: b.until, at: Date.now() };
      await col.replaceOne({ _id: "notice" }, n, { upsert: true });
      cur = n;
      return { notice: n };
    })
  );
  admin.delete(
    "/",
    h(async () => {
      await col.deleteOne({ _id: "notice" });
      cur = null;
    })
  );
  return { pub, admin };
}
