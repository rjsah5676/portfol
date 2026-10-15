import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { h, requireAdmin } from "./util";

/*
 * 관리자 · GP 경제 (point_log 원장 · users.points 를 읽기만 함)
 *   GET /api/admin/economy?days=7          유통량 · 보유자 · 상위 보유자 · 기간 지급/소모(사유별 · 날짜별)
 *   GET /api/admin/economy/log?reason=&q=&skip=   사이트 전체 원장 (최신순 50줄, 사유 · 별명으로 거르기)
 */

const DAY = 86_400_000;
const kstDate = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
/** 기간 집계에서 읽는 원장 최대 줄 수 (넘으면 truncated) */
const FLOW_MAX = 50_000;
const PAGE = 50;

interface LogDoc {
  _id: string;
  uid: string;
  at: number;
  delta: number;
  reason: string;
  ref?: string;
  bal?: number;
}

export function adminEconomyRouter({ auth, db }: Deps): Router {
  const r = Router();
  r.use((req, _res, next) => {
    requireAdmin(auth, req).then(() => next(), next);
  });
  const logs = db.col<LogDoc>("point_log");
  const users = db.col<{ _id: string; nick?: string; points?: number }>("users");

  const nicks = async (uids: string[]) =>
    new Map(
      (await users.find({ _id: { $in: [...new Set(uids)] } }, { projection: { nick: 1 } }).toArray()).map((u) => [u._id, u.nick ?? "(탈퇴)"])
    );

  r.get(
    "/",
    h(async (req) => {
      const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).parse(req.query);
      const now = Date.now();
      const dates = Array.from({ length: days }, (_, i) => kstDate(now - (days - 1 - i) * DAY));
      const since = Date.parse(`${dates[0]}T00:00:00+09:00`);

      const [holders, top, rows] = await Promise.all([
        users.find({ nick: { $exists: true } } as never, { projection: { points: 1 } }).toArray(),
        users.find({ points: { $gt: 0 } } as never, { projection: { nick: 1, points: 1 } }).sort({ points: -1 }).limit(10).toArray(),
        logs.find({ at: { $gte: since } } as never, { projection: { at: 1, delta: 1, reason: 1 } }).sort({ at: -1 }).limit(FLOW_MAX).toArray(),
      ]);

      const total = holders.reduce((a, u) => a + (u.points ?? 0), 0);
      const withPoints = holders.filter((u) => (u.points ?? 0) > 0).length;

      const byReason = new Map<string, { in: number; out: number; n: number }>();
      const byDay = new Map(dates.map((d) => [d, { in: 0, out: 0 }]));
      for (const x of rows) {
        const g = byReason.get(x.reason) ?? { in: 0, out: 0, n: 0 };
        const d = byDay.get(kstDate(x.at));
        if (x.delta > 0) {
          g.in += x.delta;
          if (d) d.in += x.delta;
        } else {
          g.out -= x.delta;
          if (d) d.out -= x.delta;
        }
        g.n++;
        byReason.set(x.reason, g);
      }
      return {
        total,
        members: holders.length,
        withPoints,
        top: top.map((u) => ({ uid: u._id, nick: u.nick ?? "", points: u.points ?? 0 })),
        days,
        reasons: [...byReason].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.in + b.out - (a.in + a.out)),
        daily: dates.map((date) => ({ date, ...byDay.get(date)! })),
        truncated: rows.length >= FLOW_MAX,
      };
    })
  );

  r.get(
    "/log",
    h(async (req) => {
      const q = z
        .object({
          reason: z.string().max(20).optional(),
          q: z.string().max(40).optional(),
          skip: z.coerce.number().int().min(0).max(100_000).default(0),
        })
        .parse(req.query);
      const filter: Record<string, unknown> = {};
      if (q.reason) filter.reason = q.reason;
      const who = q.q?.trim();
      if (who) {
        const found = await users
          .find({ $or: [{ nickKey: who.toLowerCase() }, { _id: who }] } as never, { projection: { _id: 1 } })
          .toArray();
        filter.uid = { $in: found.map((u) => u._id) };
      }
      const rows = await logs.find(filter as never).sort({ at: -1 }).skip(q.skip).limit(PAGE + 1).toArray();
      const names = await nicks(rows.map((x) => x.uid));
      return {
        rows: rows.slice(0, PAGE).map((x) => ({
          uid: x.uid,
          nick: names.get(x.uid) ?? "(탈퇴)",
          at: x.at,
          delta: x.delta,
          reason: x.reason,
          ...(x.ref && { ref: x.ref }),
          ...(x.bal !== undefined && { bal: x.bal }),
        })),
        more: rows.length > PAGE,
      };
    })
  );

  return r;
}
