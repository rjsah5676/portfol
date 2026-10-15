import { randomUUID } from "node:crypto";
import type { Database } from "./db";
import { AppError } from "./errors";
import { KeyedMutex } from "./mutex";
import type { Points } from "./points";
import type { MailAdminRow, MailItem } from "../../web/src/lib/mail";

/*
 * 우편 (사이트 공용 · 플로팅 버튼의 우편함). 관리자가 보내고, 받는 사람이 「받기」를 눌러야 GP 가 들어감.
 *   mail      { _id, to: "*"(모든 회원) | uid[], title, body, points, at, until(받을 수 있는 마지막 때), atDate }
 *   mail_got  { _id: "<우편 id>:<uid>", mail, uid, at } — 받았다는 표시. _id 가 겹치면 이미 받은 것 (두 번 눌러도 한 번)
 * 기한이 지난 우편은 목록에서 빠지고 못 받음. mail 은 기한 뒤 30일, mail_got 은 1년 뒤 저절로 지워짐.
 */

const DAY = 24 * 3600 * 1000;
export const MAIL_MAX_DAYS = 90;

interface MailDoc {
  _id: string;
  to: "*" | string[];
  title: string;
  body: string;
  points: number;
  at: number;
  until: number;
  atDate: Date;
}

export function createMail(db: Database, points: Points, now: () => number = Date.now) {
  const col = db.col<MailDoc>("mail");
  const got = db.col<{ _id: string; mail: string; uid: string; at: number; atDate: Date }>("mail_got");
  const users = db.col("users");
  const lock = new KeyedMutex();
  void col.createIndex({ to: 1, until: -1 }).catch(() => {});
  void col.createIndex({ atDate: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
  void got.createIndex({ uid: 1 }).catch(() => {});
  void got.createIndex({ mail: 1 }).catch(() => {});
  void got.createIndex({ atDate: 1 }, { expireAfterSeconds: 365 * 24 * 3600 }).catch(() => {});

  /** 이 사람이 지금 받을 수 있는(기한 안) 우편 */
  const mine = (uid: string) =>
    col
      .find({ $or: [{ to: "*" }, { to: uid }], until: { $gt: now() } } as never)
      .sort({ at: -1 })
      .limit(100)
      .toArray();

  async function list(uid: string): Promise<MailItem[]> {
    const ms = await mine(uid);
    if (!ms.length) return [];
    const done = new Map((await got.find({ _id: { $in: ms.map((m) => `${m._id}:${uid}`) } }).toArray()).map((g) => [g.mail, g.at]));
    return ms.map((m) => ({ id: m._id, title: m.title, body: m.body, points: m.points, at: m.at, until: m.until, gotAt: done.get(m._id) ?? null }));
  }

  /** 하나 받기 (자물쇠 안에서). 받은 GP */
  async function take(uid: string, m: MailDoc): Promise<number> {
    try {
      await got.insertOne({ _id: `${m._id}:${uid}`, mail: m._id, uid, at: now(), atDate: new Date(now()) });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new AppError("CLAIMED", "이미 받은 우편이에요.", 409);
      throw e;
    }
    if (m.points > 0) {
      try {
        await points.grant(uid, m.points, "mail", m.title.slice(0, 40));
      } catch (e) {
        await got.deleteOne({ _id: `${m._id}:${uid}` });
        throw e;
      }
    }
    return m.points;
  }

  const member = async (uid: string) => {
    if (!(await points.get(uid))) throw new AppError("NOT_MEMBER", "회원만 우편을 받을 수 있어요.", 403);
  };
  const balance = async (uid: string) => (await points.get(uid))?.points ?? 0;

  return {
    list,

    /** 안 받은 우편 수 (플로팅 버튼 표시) */
    async unread(uid: string): Promise<number> {
      return (await list(uid)).filter((m) => m.gotAt === null).length;
    },

    /** 하나 받기 */
    claim: (uid: string, id: string) =>
      lock.run(uid, async () => {
        await member(uid);
        const m = await col.findOne({ _id: id, $or: [{ to: "*" }, { to: uid }] } as never);
        if (!m) throw new AppError("NOT_FOUND", "없는 우편이에요.", 404);
        if (m.until <= now()) throw new AppError("EXPIRED", "기한이 지난 우편이에요.", 410);
        const reward = await take(uid, m);
        return { reward, count: 1, points: await balance(uid) };
      }),

    /** 받을 수 있는 것 전부 */
    claimAll: (uid: string) =>
      lock.run(uid, async () => {
        await member(uid);
        const left = (await list(uid)).filter((m) => m.gotAt === null);
        if (!left.length) throw new AppError("NOT_YET", "받을 우편이 없어요.", 409);
        const docs = await col.find({ _id: { $in: left.map((m) => m.id) } }).toArray();
        let reward = 0;
        let count = 0;
        for (const m of docs) {
          try {
            reward += await take(uid, m);
            count++;
          } catch (e) {
            if (!(e instanceof AppError && e.code === "CLAIMED")) throw e;
          }
        }
        return { reward, count, points: await balance(uid) };
      }),

    /** (관리자) 보내기. to: "*" 모든 회원, 아니면 별명 목록 */
    async send(input: { to: "*" | string[]; title: string; body: string; points: number; days: number }): Promise<{ id: string; to: number | "*" }> {
      let to: "*" | string[] = "*";
      if (input.to !== "*") {
        const keys = [...new Set(input.to.map((n) => n.trim().toLowerCase()).filter(Boolean))];
        if (!keys.length) throw new AppError("BAD_REQUEST", "받는 사람을 적어 주세요.", 400);
        const found = (await users.find({ nickKey: { $in: keys } }, { projection: { nickKey: 1 } }).toArray()) as unknown as { _id: string; nickKey: string }[];
        const miss = keys.filter((k) => !found.some((f) => f.nickKey === k));
        if (miss.length) throw new AppError("NOT_FOUND", `없는 별명: ${miss.join(", ")}`, 404);
        to = found.map((f) => f._id);
      }
      const at = now();
      const until = at + Math.min(MAIL_MAX_DAYS, Math.max(1, Math.floor(input.days))) * DAY;
      const id = randomUUID().slice(0, 12);
      await col.insertOne({ _id: id, to, title: input.title, body: input.body, points: Math.max(0, Math.floor(input.points)), at, until, atDate: new Date(until + 30 * DAY) });
      return { id, to: to === "*" ? "*" : to.length };
    },

    /** (관리자) 보낸 우편 (최근 50) + 받은 사람 수 */
    async sent(): Promise<MailAdminRow[]> {
      const ms = await col.find({}).sort({ at: -1 }).limit(50).toArray();
      const names = new Map(
        ((await users.find({ _id: { $in: ms.flatMap((m) => (m.to === "*" ? [] : m.to)) } }, { projection: { nick: 1 } }).toArray()) as unknown as { _id: string; nick?: string }[]).map((u) => [u._id, u.nick ?? u._id])
      );
      return Promise.all(
        ms.map(async (m) => ({
          id: m._id,
          to: m.to === "*" ? ("*" as const) : m.to.map((u) => names.get(u) ?? u),
          title: m.title,
          body: m.body,
          points: m.points,
          at: m.at,
          until: m.until,
          got: await got.countDocuments({ mail: m._id }),
        }))
      );
    },

    /** (관리자) 회수 — 아직 안 받은 사람은 더 못 받음 (이미 받은 GP 는 그대로) */
    async remove(id: string): Promise<void> {
      await col.deleteOne({ _id: id });
    },
  };
}

export type Mail = ReturnType<typeof createMail>;
