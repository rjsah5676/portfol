import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { orderedId } from "../ids";
import { cleanIp } from "../traffic";
import { h, ms, requireAdmin, userOf } from "./util";

/*
 * 픽셀 프로야구 플레이 기록 (밸런스 분석용). 게임 진행은 브라우저 localStorage 에만 있어서,
 * 경기 · 시즌 결산 · 은퇴 · 특수능력/축복 고르기 · 연습 경기 끝날 때 브라우저가 한 줄씩 보냄.
 *   POST /api/baseball/log                { pid, kind, v?, data }  → 204 (pid: 브라우저마다 고정 id · data JSON 8KB 이하)
 *   GET  /api/admin/baseball/summary      → { total, players, kinds: {kind: n}, first, last }
 *   GET  /api/admin/baseball/logs?kind=&since=&limit= → 최근 것부터 (최대 2000)
 *   GET  /api/admin/baseball/export?kind=&since= → NDJSON 파일 (한 줄 = 기록 하나)
 * 컬렉션 baseball_logs { _id(시간순), at, pid, uid?, kind, v, data }
 */

export interface BaseballLog {
  _id: string;
  at: Date;
  pid: string;
  uid?: string;
  kind: string;
  v: number;
  data: Record<string, unknown>;
}

const logSchema = z.strictObject({
  pid: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
  kind: z.string().regex(/^[a-z_]{2,24}$/),
  v: z.number().int().min(0).max(1_000_000).optional(),
  data: z.record(z.string(), z.unknown()),
});
const MAX_DATA = 8_000;
/** IP 당 1분에 이만큼까지 (넘으면 조용히 버림) */
const PER_MIN = 60;

export function baseballRouters({ auth, db }: Deps): { pub: Router; admin: Router } {
  const col = db.col<Omit<BaseballLog, "_id">>("baseball_logs");
  void col.createIndex({ kind: 1, at: -1 }).catch(() => {});
  void col.createIndex({ pid: 1, at: -1 }).catch(() => {});
  const hits = new Map<string, { n: number; t: number }>();

  const pub = Router();
  pub.post(
    "/log",
    h(async (req) => {
      const input = logSchema.parse(req.body);
      if (JSON.stringify(input.data).length > MAX_DATA) return;
      const ip = cleanIp(req.ip) || "?";
      const now = Date.now();
      const hit = hits.get(ip);
      if (!hit || now - hit.t > 60_000) hits.set(ip, { n: 1, t: now });
      else if (++hit.n > PER_MIN) return;
      if (hits.size > 5000) hits.clear();
      const user = await userOf(auth, req);
      if (user?.admin) return;
      await col.insertOne({ _id: orderedId(), at: new Date(), pid: input.pid, ...(user ? { uid: user.uid } : {}), kind: input.kind, v: input.v ?? 0, data: input.data });
    })
  );

  const admin = Router();
  admin.use((req, _res, next) => {
    requireAdmin(auth, req).then(() => next(), next);
  });
  const filterOf = (q: Record<string, unknown>) => {
    const f: Record<string, unknown> = {};
    if (typeof q.kind === "string" && q.kind) f.kind = q.kind;
    const since = Number(q.since);
    if (since > 0) f.at = { $gte: new Date(since) };
    return f;
  };
  const row = (d: BaseballLog) => ({ id: d._id, at: ms(d.at), pid: d.pid, uid: d.uid ?? null, kind: d.kind, v: d.v, data: d.data });
  admin.get(
    "/summary",
    h(async () => {
      const kinds = await col.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$kind", n: { $sum: 1 } } }]).toArray();
      const players = (await col.distinct("pid")).length;
      const first = await col.find({}).sort({ _id: 1 }).limit(1).next();
      const last = await col.find({}).sort({ _id: -1 }).limit(1).next();
      return {
        total: kinds.reduce((a, k) => a + k.n, 0),
        players,
        kinds: Object.fromEntries(kinds.map((k) => [k._id, k.n])),
        first: first ? ms(first.at) : null,
        last: last ? ms(last.at) : null,
      };
    })
  );
  admin.get(
    "/logs",
    h(async (req) => {
      const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 200));
      const docs = await col.find(filterOf(req.query)).sort({ _id: -1 }).limit(limit).toArray();
      return docs.map((d) => row(d as BaseballLog));
    })
  );
  admin.get("/export", (req, res, next) => {
    (async () => {
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="baseball-logs-${new Date().toISOString().slice(0, 10)}.ndjson"`);
      const cur = col.find(filterOf(req.query)).sort({ _id: 1 });
      for await (const d of cur) res.write(JSON.stringify(row(d as BaseballLog)) + "\n");
      res.end();
    })().catch(next);
  });
  return { pub, admin };
}
