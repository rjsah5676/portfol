import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { cleanIp } from "../traffic";
import { h, userOf } from "./util";

/*
 * 유입 기록 (페이지를 열거나 옮길 때마다 브라우저가 보냄)
 *   POST /api/track   { sid, path, entry, returning, ref?, utm?, screen?, lang?, tz? }  → 204
 * 봇 · 관리자 · /admin 페이지는 기록하지 않음 (응답은 똑같이 204).
 */

const str = (max: number) => z.string().max(max);
const trackSchema = z.strictObject({
  sid: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  path: z.string().min(1).max(300).startsWith("/"),
  entry: z.boolean(),
  returning: z.boolean(),
  ref: str(1000).optional(),
  utm: z
    .strictObject({
      source: str(100).optional(),
      medium: str(100).optional(),
      campaign: str(100).optional(),
      term: str(100).optional(),
      content: str(100).optional(),
    })
    .optional(),
  screen: z.strictObject({ w: z.number().int().min(0).max(20000), h: z.number().int().min(0).max(20000) }).optional(),
  lang: str(35).optional(),
  tz: str(64).optional(),
});

export function trackRouter({ auth, users, traffic, cfg }: Deps) {
  const r = Router();
  const configured = (cfg.corsOrigins === "*" ? [] : cfg.corsOrigins)
    .map((o) => {
      try {
        return new URL(o).hostname;
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  r.post(
    "/track",
    h(async (req) => {
      const input = trackSchema.parse(req.body);
      if (input.path.startsWith("/admin")) return;
      const user = await userOf(auth, req);
      if (user?.admin) return;
      const member = !!(await users.nickOf(user));
      const host = req.hostname?.toLowerCase() ?? "";
      const ownHosts = [...new Set([host, host.replace(/^www\./, ""), `www.${host.replace(/^www\./, "")}`, ...configured])];
      await traffic.record(input, {
        ip: cleanIp(req.ip),
        ua: String(req.headers["user-agent"] ?? ""),
        member,
        ownHosts,
      });
    })
  );
  return r;
}
