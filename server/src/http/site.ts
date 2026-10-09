import { Router, type Request } from "express";
import type { AuthUser } from "../auth";
import type { Captcha } from "../captcha";
import { z } from "zod";
import type { Deps } from "../deps";
import { notFound } from "../errors";
import { newId } from "../ids";
import { liveList } from "../realtime/liveList";
import { h, ms, requireAdmin, userOf } from "./util";

/*
 * 사이트 공통 데이터: 방명록 · 문의 · 방문자 수
 *   GET/POST /api/guest          DELETE /api/guest/:id (관리자)        구독 채널 "guest"
 *   POST /api/inquiries          PATCH·DELETE /api/inquiries/:id (관리자)  구독 채널 "inquiries" (관리자)
 *   POST /api/stats/visit        GET /api/stats?date=YYYY-MM-DD
 * 방명록 · 문의 쓰기는 익명이면 사람 확인(captcha.ts)을 거침
 */

export const NOTE_COLORS = ["lavender", "yellow", "mint", "pink", "sky"] as const;

const guestSchema = z.strictObject({
  name: z.string().max(20),
  contents: z.string().max(50),
  // id(작성 시각 ms)와 표시용 날짜 문자열은 지금처럼 작성자 브라우저 기준으로 만든 값을 받음
  id: z.number().finite(),
  date: z.string().max(60),
  color: z.enum(NOTE_COLORS).optional(),
});

const inquirySchema = z.strictObject({
  name: z.string().min(1).max(30),
  email: z
    .string()
    .max(100)
    .regex(/^[^@\s]+@[^@\s]+[.][^@\s]+$/),
  phone: z.string().max(20),
  message: z.string().min(1).max(1000),
});

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** 익명(로그인 안 함 · 익명 로그인)이면 사람 확인. Google 로그인한 사람은 건너뜀 */
async function humanCheck(captcha: Captcha | undefined, req: Request, user: AuthUser | null) {
  if (!captcha || (user && !user.anonymous)) return;
  await captcha.check(req, { remember: user?.uid });
}

export function siteRouter({ db, auth, gateway, users }: Deps, captcha?: Captcha) {
  const r = Router();

  // ── 방명록 ──
  const guest = liveList(gateway, "guest", async () => {
    const docs = await db.col("guest").find({}).sort({ id: -1 }).limit(300).toArray();
    return docs.map(({ _id, uid: _uid, ...rest }) => ({ ...rest, docId: _id }));
  });
  gateway.channel("guest", { key: () => guest.key, snapshot: () => guest.load() });

  r.get(
    "/guest",
    h(async () => (await guest.load()).list)
  );
  r.post(
    "/guest",
    h(async (req) => {
      const data = guestSchema.parse(req.body);
      // 회원이 쓰면 별명으로 (적은 이름은 무시), member 표시가 없는 글이 비회원 글
      const user = await userOf(auth, req);
      await humanCheck(captcha, req, user);
      const nick = await users.nickOf(user);
      const owner = nick ? { name: nick, uid: user!.uid, member: true } : {};
      const _id = newId();
      await db.col("guest").insertOne({ _id, ...data, ...owner });
      guest.publish();
      return { docId: _id };
    })
  );
  r.delete(
    "/guest/:id",
    h(async (req) => {
      await requireAdmin(auth, req);
      await db.col("guest").deleteOne({ _id: String(req.params.id) });
      guest.publish();
    })
  );

  // ── 문의 ──
  const inquiries = liveList(gateway, "inquiries", async () => {
    const docs = await db.col("inquiries").find({}).sort({ createdAt: -1 }).limit(300).toArray();
    return docs.map((d) => ({
      id: d._id,
      name: d.name ?? "",
      email: d.email ?? "",
      phone: d.phone ?? "",
      message: d.message ?? "",
      read: !!d.read,
      createdAt: ms(d.createdAt),
      uid: d.uid ?? null,
      nick: d.nick ?? null,
    }));
  });
  gateway.channel("inquiries", {
    key(ctx) {
      ctx.requireAdmin();
      return inquiries.key;
    },
    snapshot: () => inquiries.load(),
  });

  r.post(
    "/inquiries",
    h(async (req) => {
      const data = inquirySchema.parse(req.body);
      // 로그인한 상태로 남기면 누구인지(회원 uid · 별명)를 같이 저장
      const user = await userOf(auth, req);
      await humanCheck(captcha, req, user);
      const member = user ? { uid: user.uid, nick: await users.nickByUid(user.uid) } : {};
      await db.col("inquiries").insertOne({ _id: newId(), ...data, ...member, read: false, createdAt: new Date() });
      inquiries.publish();
    })
  );
  r.patch(
    "/inquiries/:id",
    h(async (req) => {
      await requireAdmin(auth, req);
      const { read } = z.strictObject({ read: z.boolean() }).parse(req.body);
      const res = await db.col("inquiries").updateOne({ _id: String(req.params.id) }, { $set: { read } });
      if (!res.matchedCount) throw notFound();
      inquiries.publish();
    })
  );
  r.delete(
    "/inquiries/:id",
    h(async (req) => {
      await requireAdmin(auth, req);
      await db.col("inquiries").deleteOne({ _id: String(req.params.id) });
      inquiries.publish();
    })
  );

  // ── 방문자 수 (total = 누적, daily_YYYY-MM-DD = 일별) ──
  r.post(
    "/stats/visit",
    h(async (req) => {
      const { dateKey } = z.strictObject({ dateKey: z.string().regex(DATE_KEY) }).parse(req.body);
      const stats = db.col("siteStats");
      await Promise.all([
        stats.updateOne({ _id: "total" }, { $inc: { count: 1 } }, { upsert: true }),
        stats.updateOne({ _id: `daily_${dateKey}` }, { $inc: { count: 1 } }, { upsert: true }),
      ]);
    })
  );
  r.get(
    "/stats",
    h(async (req) => {
      const dateKey = z.string().regex(DATE_KEY).parse(req.query.date);
      const stats = db.col<{ count: number }>("siteStats");
      const [total, today] = await Promise.all([
        stats.findOne({ _id: "total" }),
        stats.findOne({ _id: `daily_${dateKey}` }),
      ]);
      return { total: total?.count ?? 0, today: today?.count ?? 0 };
    })
  );

  return { router: r, publishGuest: guest.publish };
}
