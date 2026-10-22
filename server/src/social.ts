import type { Database } from "./db";
import { AppError, bad, forbidden, notFound } from "./errors";
import { createFightRating } from "./games/fightRating";
import { bpBoard } from "./http/rankings";
import { newId, orderedId } from "./ids";
import { KeyedMutex } from "./mutex";
import type { Ctx, Gateway } from "./realtime/gateway";
import { pictureOf, type UserDoc, type Users } from "./users";
import {
  DM_MAX_LEN,
  DM_PAGE,
  FRIEND_MAX,
  FRIEND_PENDING_MAX,
  REPORT_REASONS,
  REPORT_TEXT_MAX,
  WHERE_MAX,
  type DmMsg,
  type FriendEntry,
  type FriendStatus,
  type Presence,
  type ReportReason,
  type ReportRow,
  type SocialSnapshot,
  type UserCard,
} from "../../web/src/lib/social";

/*
 * 친구 · 접속 표시 · 메신저 · 정보보기 · 신고 (타입 · 상수는 web/src/lib/social.ts).
 *
 * 저장
 *   friends   두 사람마다 한 줄: _id = "작은uid|큰uid", a · b (정렬), status pending | friends, from (요청한 사람),
 *             last (마지막 메시지 미리보기), ua · ub (a · b 가 안 읽은 수), ra · rb (a · b 가 어디까지 읽었는지)
 *   dm        메시지 한 개씩 (pair · from · to · text · at), 180일 뒤 자동 삭제
 *   reports   신고 (관리자 화면)
 *   users.seenAt  마지막 접속 (나갈 때 적음)
 *
 * 접속 중 = 그 회원의 「social」 구독이 하나라도 붙어 있음 (사이트를 열어 두면 SocialRoot 가 구독함).
 * 탭을 옮기거나 새로고침할 때 깜빡이지 않게, 마지막 구독이 끊기고 OFFLINE_GRACE_MS 동안 다시 안 붙으면 나간 것으로 침.
 *
 * 다른 게임에서 쓸 것 (deps.social): areFriends · friendsOf · isOnline · presenceOf · setWhere · notify
 */

export const OFFLINE_GRACE_MS = 6000;
/** 메시지 도배 막기: 1분에 이만큼 */
const DM_PER_MIN = 30;
/** 같은 사람을 다시 신고할 수 있기까지 */
const REPORT_GAP_MS = 12 * 3600_000;
/** 신고에 같이 붙이는 두 사람 사이 최근 메시지 수 */
const REPORT_DMS = 30;
const DM_TTL_DAYS = 180;

interface FriendDoc {
  _id: string;
  a: string;
  b: string;
  status: "pending" | "friends";
  from: string;
  at: Date;
  since?: Date;
  last?: { at: number; from: string; text: string };
  ua?: number;
  ub?: number;
  ra?: number;
  rb?: number;
}

interface DmDoc {
  _id: string;
  pair: string;
  from: string;
  to: string;
  text: string;
  at: number;
  atDate: Date;
}

interface ReportDoc {
  _id: string;
  at: Date;
  from: string;
  fromNick: string;
  target: string;
  targetNick: string;
  reason: ReportReason;
  text: string;
  where: string;
  dms: { from: string; text: string; at: number }[];
  status: "open" | "done";
  note?: string;
  doneAt?: Date;
}

type UserLite = Pick<UserDoc, "nick" | "badge" | "avatar" | "photo"> & { _id: string; seenAt?: Date };

export const pairOf = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
const sideOf = (d: Pick<FriendDoc, "a">, uid: string) => (d.a === uid ? "a" : "b");
const otherOf = (d: Pick<FriendDoc, "a" | "b">, uid: string) => (d.a === uid ? d.b : d.a);
const keyOf = (uid: string) => `social:${uid}`;
/** 메시지 · 신고 글: 줄바꿈은 두고 제어 문자만 뺌 */
const cleanText = (s: string) => s.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? c : "")).replace(/\n{4,}/g, "\n\n\n").trim();

export type Social = ReturnType<typeof createSocial>;

export function createSocial(db: Database, gateway: Gateway, users: Users, now: () => number = Date.now) {
  const friends = db.col<FriendDoc>("friends");
  const dms = db.col<DmDoc>("dm");
  const reports = db.col<ReportDoc>("reports");
  const userCol = db.col<UserDoc>("users");
  for (const [c, k, o] of [
    [friends, { a: 1 }, {}],
    [friends, { b: 1 }, {}],
    [dms, { pair: 1, at: -1 }, {}],
    [dms, { atDate: 1 }, { expireAfterSeconds: DM_TTL_DAYS * 24 * 3600 }],
    [reports, { status: 1, at: -1 }, {}],
    [reports, { from: 1, target: 1, at: -1 }, {}],
  ] as const)
    void (c as typeof friends).createIndex(k as never, o).catch((e) => console.warn("[social] index", e));

  const lock = new KeyedMutex();
  const fightRating = createFightRating(db, users);

  /** 접속 중인 회원 → 있는 곳 (null = 그냥 접속 중) */
  const online = new Map<string, string | null>();
  /** 마지막 구독이 끊긴 뒤 나간 것으로 칠 때까지의 타이머 */
  const leaving = new Map<string, ReturnType<typeof setTimeout>>();
  /** 메시지 보낸 시각들 (최근 1분) */
  const sent = new Map<string, number[]>();

  const member = (ctx: Ctx) => {
    const uid = ctx.uid;
    if (!ctx.nick) throw forbidden("회원만 쓸 수 있어요. 별명을 먼저 정해주세요.");
    return uid;
  };

  async function liteOf(uids: string[]): Promise<Map<string, UserLite>> {
    if (!uids.length) return new Map();
    const docs = (await userCol
      .find({ _id: { $in: uids } } as never, { projection: { nick: 1, badge: 1, "avatar.at": 1, "avatar.type": 1, photo: 1, seenAt: 1 } })
      .toArray()) as unknown as UserLite[];
    return new Map(docs.filter((d) => d.nick).map((d) => [String(d._id), d]));
  }

  const presenceOf = (uid: string, u?: UserLite | null): Presence => ({
    uid,
    online: online.has(uid),
    where: online.get(uid) ?? null,
    seen: u?.seenAt?.getTime() ?? null,
  });

  /** 친구 한 줄을 me 가 보는 모양으로 */
  function entryOf(d: FriendDoc, me: string, u: UserLite): FriendEntry {
    const other = otherOf(d, me);
    const mine = sideOf(d, me);
    const status: FriendStatus = d.status === "friends" ? "friends" : d.from === me ? "out" : "in";
    const pres = status === "friends" ? presenceOf(other, u) : { online: false, where: null, seen: null };
    return {
      uid: other,
      nick: u.nick,
      badge: u.badge ?? null,
      pic: pictureOf(other, u),
      status,
      at: (d.since ?? d.at).getTime(),
      online: pres.online,
      where: pres.where,
      seen: pres.seen,
      unread: (mine === "a" ? d.ua : d.ub) ?? 0,
      last: d.last && status === "friends" ? { at: d.last.at, mine: d.last.from === me, text: d.last.text } : null,
      readAt: (mine === "a" ? d.rb : d.ra) ?? 0,
    };
  }

  async function docsOf(uid: string): Promise<FriendDoc[]> {
    return friends.find({ $or: [{ a: uid }, { b: uid }] } as never).toArray() as Promise<FriendDoc[]>;
  }

  async function listOf(uid: string): Promise<FriendEntry[]> {
    const docs = await docsOf(uid);
    const lite = await liteOf(docs.map((d) => otherOf(d, uid)));
    return docs
      .filter((d) => lite.has(otherOf(d, uid))) // 지워진 회원은 빼고
      .map((d) => entryOf(d, uid, lite.get(otherOf(d, uid))!));
  }

  /** 한 줄이 바뀌었을 때 두 사람 모두에게 (상대가 보는 모양으로 각각) */
  async function pushPair(d: FriendDoc) {
    const lite = await liteOf([d.a, d.b]);
    for (const me of [d.a, d.b]) {
      const u = lite.get(otherOf(d, me));
      if (u) gateway.emit(keyOf(me), "friend", entryOf(d, me, u));
    }
  }

  async function friendUids(uid: string): Promise<string[]> {
    const docs = await friends.find({ $or: [{ a: uid }, { b: uid }], status: "friends" } as never, { projection: { a: 1, b: 1 } }).toArray();
    return docs.map((d) => otherOf(d as FriendDoc, uid));
  }

  async function broadcastPresence(uid: string) {
    const u = (await liteOf([uid])).get(uid);
    const p = presenceOf(uid, u);
    for (const f of await friendUids(uid)) gateway.emit(keyOf(f), "presence", p);
  }

  async function friendsDoc(me: string, other: string): Promise<FriendDoc> {
    const d = (await friends.findOne({ _id: pairOf(me, other) })) as FriendDoc | null;
    if (!d || d.status !== "friends") throw new AppError("NOT_FRIENDS", "친구끼리만 메시지를 주고받을 수 있어요.", 403);
    return d;
  }

  const uidArg = (a: unknown) => {
    const uid = (a as { uid?: unknown } | null)?.uid;
    if (typeof uid !== "string" || !uid || uid.length > 128) throw bad();
    return uid;
  };

  // ───────────── 실시간 ─────────────

  gateway.channel("social", {
    key(ctx) {
      return keyOf(member(ctx));
    },
    async snapshot(ctx): Promise<SocialSnapshot> {
      const uid = ctx.uid;
      const t = leaving.get(uid);
      if (t) {
        clearTimeout(t);
        leaving.delete(uid);
      }
      if (!online.has(uid)) {
        online.set(uid, null);
        void broadcastPresence(uid).catch(() => {});
      }
      return { uid, friends: await listOf(uid) };
    },
    closed(ctx, key) {
      const uid = ctx.user?.uid;
      if (!uid || gateway.subscribers(key).length > 0 || leaving.has(uid)) return;
      leaving.set(
        uid,
        setTimeout(() => {
          leaving.delete(uid);
          if (gateway.subscribers(key).length > 0) return;
          online.delete(uid);
          void userCol
            .updateOne({ _id: uid }, { $set: { seenAt: new Date(now()) } })
            .then(() => broadcastPresence(uid))
            .catch(() => {});
        }, OFFLINE_GRACE_MS).unref()
      );
    },
  });

  /** 친구 요청 (상대가 나한테 이미 요청했으면 바로 친구) */
  gateway.rpc("social.request", async (ctx, a) => {
    const me = member(ctx);
    const nick = (a as { nick?: unknown } | null)?.nick;
    if (typeof nick !== "string" || !nick.trim()) throw bad("별명을 적어주세요.");
    const target = (await userCol.findOne({ nickKey: nick.trim().toLowerCase() } as never, { projection: { _id: 1 } })) as { _id: string } | null;
    if (!target) throw notFound("그 별명의 회원이 없어요.");
    const other = String(target._id);
    if (other === me) throw bad("나에게는 친구 요청을 보낼 수 없어요.");
    const id = pairOf(me, other);
    return lock.run(id, async () => {
      const cur = (await friends.findOne({ _id: id })) as FriendDoc | null;
      if (cur?.status === "friends") throw new AppError("ALREADY", "이미 친구예요.", 409);
      if (cur && cur.from === me) throw new AppError("ALREADY", "이미 요청을 보냈어요. 상대가 수락하면 친구가 돼요.", 409);
      if (cur) {
        // 상대가 먼저 보낸 요청 → 수락
        await friends.updateOne({ _id: id }, { $set: { status: "friends", since: new Date(now()) } });
      } else {
        const mine = await docsOf(me);
        if (mine.length >= FRIEND_MAX) throw new AppError("LIMIT", `친구는 요청까지 합쳐 ${FRIEND_MAX}명까지예요.`, 409);
        if (mine.filter((d) => d.status === "pending" && d.from === me).length >= FRIEND_PENDING_MAX)
          throw new AppError("LIMIT", `수락을 기다리는 요청이 ${FRIEND_PENDING_MAX}개예요. 몇 개를 취소하거나 기다려 주세요.`, 409);
        const theirs = await friends.countDocuments({ $or: [{ a: other }, { b: other }] } as never);
        if (theirs >= FRIEND_MAX) throw new AppError("LIMIT", "상대의 친구 목록이 가득 찼어요.", 409);
        const [x, y] = me < other ? [me, other] : [other, me];
        await friends.insertOne({ _id: id, a: x, b: y, status: "pending", from: me, at: new Date(now()) });
      }
      const d = (await friends.findOne({ _id: id })) as FriendDoc;
      await pushPair(d);
      if (d.status === "friends") for (const u of [d.a, d.b]) void broadcastPresence(u).catch(() => {});
      return { status: d.status === "friends" ? "friends" : "out" };
    });
  });

  /** 받은 요청 수락 */
  gateway.rpc("social.accept", async (ctx, a) => {
    const me = member(ctx);
    const other = uidArg(a);
    const id = pairOf(me, other);
    return lock.run(id, async () => {
      const cur = (await friends.findOne({ _id: id })) as FriendDoc | null;
      if (!cur || cur.status !== "pending" || cur.from !== other) throw notFound("받은 친구 요청이 없어요.");
      await friends.updateOne({ _id: id }, { $set: { status: "friends", since: new Date(now()) } });
      const d = (await friends.findOne({ _id: id })) as FriendDoc;
      await pushPair(d);
      for (const u of [d.a, d.b]) void broadcastPresence(u).catch(() => {});
      return { status: "friends" };
    });
  });

  /** 친구 끊기 · 받은 요청 거절 · 보낸 요청 취소 — 모두 그 줄을 지움 (메시지 기록은 기한까지 남음) */
  gateway.rpc("social.remove", async (ctx, a) => {
    const me = member(ctx);
    const other = uidArg(a);
    const id = pairOf(me, other);
    await lock.run(id, async () => {
      const r = await friends.deleteOne({ _id: id });
      if (!r.deletedCount) return;
      gateway.emit(keyOf(me), "unfriend", { uid: other });
      gateway.emit(keyOf(other), "unfriend", { uid: me });
    });
  });

  /** 지금 있는 곳 (화면이 페이지를 옮길 때 보냄). 게임 서버는 setWhere 로 직접 */
  gateway.rpc("social.where", async (ctx, a) => {
    const me = member(ctx);
    const w = (a as { where?: unknown } | null)?.where;
    await api.setWhere(me, typeof w === "string" ? w : null);
  });

  /** 대화 불러오기: before 보다 오래된 것 DM_PAGE 개 (오래된 것부터) */
  gateway.rpc("dm.history", async (ctx, a) => {
    const me = member(ctx);
    const other = uidArg(a);
    const before = (a as { before?: unknown }).before;
    await friendsDoc(me, other);
    const filter: Record<string, unknown> = { pair: pairOf(me, other) };
    if (typeof before === "number" && Number.isFinite(before)) filter.at = { $lt: before };
    const docs = (await dms.find(filter as never).sort({ at: -1 }).limit(DM_PAGE).toArray()) as DmDoc[];
    const msgs: DmMsg[] = docs.reverse().map((d) => ({ id: d._id, from: d.from, text: d.text, at: d.at }));
    return { msgs, more: docs.length === DM_PAGE };
  });

  gateway.rpc("dm.send", async (ctx, a) => {
    const me = member(ctx);
    const other = uidArg(a);
    const raw = (a as { text?: unknown }).text;
    const text = typeof raw === "string" ? cleanText(raw) : "";
    if (!text) throw bad("메시지를 적어주세요.");
    if ([...text].length > DM_MAX_LEN) throw bad(`메시지는 ${DM_MAX_LEN}자까지예요.`);
    const t = now();
    const recent = (sent.get(me) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= DM_PER_MIN) throw new AppError("RATE_LIMITED", "메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내주세요.", 429);
    recent.push(t);
    sent.set(me, recent);
    if (sent.size > 5000) sent.clear();
    const id = pairOf(me, other);
    return lock.run(id, async () => {
      const d = await friendsDoc(me, other);
      const msg: DmMsg = { id: orderedId(), from: me, text, at: t };
      await dms.insertOne({ _id: msg.id, pair: id, from: me, to: other, text, at: t, atDate: new Date(t) });
      const theirs = sideOf(d, other);
      const preview = { at: t, from: me, text: [...text].slice(0, 80).join("") };
      // 내가 보냈으면 내 쪽은 다 읽은 것
      await friends.updateOne(
        { _id: id },
        { $set: { last: preview, [sideOf(d, me) === "a" ? "ra" : "rb"]: t, [sideOf(d, me) === "a" ? "ua" : "ub"]: 0 }, $inc: { [theirs === "a" ? "ua" : "ub"]: 1 } } as never
      );
      const after = (await friends.findOne({ _id: id })) as FriendDoc;
      gateway.emit(keyOf(other), "dm", { uid: me, msg, unread: (theirs === "a" ? after.ua : after.ub) ?? 1 });
      gateway.emit(keyOf(me), "dm", { uid: other, msg, unread: 0 });
      return msg;
    });
  });

  /** 대화를 열어 봄 → 안 읽은 수 0, 상대에게 「읽음」 */
  gateway.rpc("dm.read", async (ctx, a) => {
    const me = member(ctx);
    const other = uidArg(a);
    const id = pairOf(me, other);
    await lock.run(id, async () => {
      const d = await friendsDoc(me, other);
      const s = sideOf(d, me);
      const t = now();
      await friends.updateOne({ _id: id }, { $set: { [s === "a" ? "ua" : "ub"]: 0, [s === "a" ? "ra" : "rb"]: t } } as never);
      gateway.emit(keyOf(me), "read", { uid: other, at: t, by: me });
      gateway.emit(keyOf(other), "read", { uid: me, at: t, by: me });
    });
  });

  // 별명 · 꾸밈이 바뀌면 친구들 목록에도
  // (회원을 지우면 nick = null → 친구들 목록에서 뺌)
  users.onRename((uid, nick) => {
    void docsOf(uid)
      .then((docs) =>
        Promise.all(
          docs.map((d) => (nick ? pushPair(d) : Promise.resolve(gateway.emit(keyOf(otherOf(d, uid)), "unfriend", { uid }))))
        )
      )
      .catch(() => {});
  });

  const api = {
    // ───────────── 다른 모듈 · 게임용 ─────────────

    async areFriends(x: string, y: string): Promise<boolean> {
      if (x === y) return false;
      return (await friends.countDocuments({ _id: pairOf(x, y), status: "friends" } as never)) > 0;
    },
    /** 친구 uid 목록 */
    friendsOf: friendUids,
    isOnline: (uid: string) => online.has(uid),
    presenceOf: (uid: string) => presenceOf(uid),
    /** 있는 곳 바꾸기 (null = 그냥 접속 중). 접속 중이 아니면 무시 */
    async setWhere(uid: string, where: string | null) {
      if (!online.has(uid)) return;
      const w = where ? cleanText(where).slice(0, WHERE_MAX) || null : null;
      if (online.get(uid) === w) return;
      online.set(uid, w);
      await broadcastPresence(uid);
    },
    /** 그 회원의 열려 있는 모든 화면에 알림 (게임 초대 등 — 타입은 쓰는 쪽에서 정함) */
    notify(uid: string, type: string, data: unknown) {
      gateway.emit(keyOf(uid), type, data);
    },

    // ───────────── 정보보기 ─────────────

    /** 별명으로 공개 정보 카드. viewer = 보는 사람 uid (사이 · 접속 표시용) */
    async card(nick: string, viewer: string | null): Promise<UserCard> {
      const d = (await userCol.findOne({ nickKey: nick.trim().toLowerCase() } as never, { projection: { "avatar.data": 0, email: 0 } })) as
        | (UserDoc & { _id: string; seenAt?: Date; achs?: unknown[]; stats?: UserDoc["stats"] & { defense?: { runs?: number; wins?: number; wave?: number } } })
        | null;
      if (!d) throw notFound("그 별명의 회원이 없어요.");
      const uid = String(d._id);
      const s = d.stats ?? {};
      const [rating, bp, fcount, rel] = await Promise.all([
        fightRating.mine(uid).catch(() => null),
        bpBoard(db).catch(() => []),
        friends.countDocuments({ $or: [{ a: uid }, { b: uid }], status: "friends" } as never),
        viewer && viewer !== uid ? (friends.findOne({ _id: pairOf(viewer, uid) }) as Promise<FriendDoc | null>) : Promise.resolve(null),
      ]);
      const at = bp.findIndex((x) => x.uid === uid);
      const relation: UserCard["rel"] = !viewer
        ? null
        : viewer === uid
          ? "self"
          : !rel
            ? null
            : rel.status === "friends"
              ? "friends"
              : rel.from === viewer
                ? "out"
                : "in";
      const showPres = relation === "self" || relation === "friends";
      const poker = s.poker;
      const playsOf = (o: Record<string, number | undefined> = {}) => Object.values(o).reduce<number>((x, y) => x + (y ?? 0), 0);
      return {
        uid,
        nick: d.nick,
        badge: d.badge ?? null,
        pic: pictureOf(uid, d),
        since: d.createdAt.getTime(),
        plays:
          playsOf(s.plays) +
          Object.entries(s.online ?? {}).reduce((x, [g, r]) => x + (g === "fight" ? 0 : playsOf(r)), 0) +
          (s.sketch?.games ?? 0) +
          (s.fight?.matches ?? 0) +
          (poker?.games ?? 0),
        achs: Array.isArray(d.achs) ? d.achs.length : 0,
        friends: fcount,
        poker: poker?.hands ? { money: d.money ?? 0, hands: poker.hands, wins: (poker.holdem?.wins ?? 0) + (poker.seven?.wins ?? 0) } : null,
        fight:
          s.fight?.matches || rating
            ? { matches: s.fight?.matches ?? 0, rating: rating ? { r: rating.r, rank: rating.rank, of: rating.of, w: rating.w, l: rating.l } : null }
            : null,
        rhythm: at >= 0 ? { bp: bp[at].bp, rank: at + 1, of: bp.length } : null,
        defense: s.defense?.runs ? { runs: s.defense.runs, wins: s.defense.wins ?? 0, wave: s.defense.wave ?? 0 } : null,
        sketch: s.sketch?.games ? { games: s.sketch.games, wins: s.sketch.wins ?? 0, correct: s.sketch.correct ?? 0 } : null,
        online: (["chess", "janggi", "omok"] as const)
          .map((g) => ({ game: g, w: s.online?.[g]?.w ?? 0, l: s.online?.[g]?.l ?? 0, d: s.online?.[g]?.d ?? 0 }))
          .filter((r) => r.w + r.l + r.d > 0),
        rel: relation,
        presence: showPres ? presenceOf(uid, d as unknown as UserLite) : null,
      };
    },

    // ───────────── 신고 ─────────────

    async report(fromUid: string, input: { nick: string; reason: ReportReason; text: string; where: string }): Promise<{ id: string }> {
      const fromNick = await users.nickByUid(fromUid);
      if (!fromNick) throw forbidden("회원만 신고할 수 있어요.");
      if (!REPORT_REASONS.includes(input.reason)) throw bad("사유를 골라주세요.");
      const t = (await userCol.findOne({ nickKey: input.nick.trim().toLowerCase() } as never, { projection: { nick: 1 } })) as { _id: string; nick: string } | null;
      if (!t) throw notFound("그 별명의 회원이 없어요.");
      const target = String(t._id);
      if (target === fromUid) throw bad("나 자신은 신고할 수 없어요.");
      return lock.run(`rp:${fromUid}`, async () => {
        const recent = await reports.findOne({ from: fromUid, target, at: { $gt: new Date(now() - REPORT_GAP_MS) } } as never);
        if (recent) throw new AppError("ALREADY", "이 회원은 최근에 이미 신고했어요. 관리자가 확인할게요.", 409);
        const excerpt = (await dms
          .find({ pair: pairOf(fromUid, target) } as never)
          .sort({ at: -1 })
          .limit(REPORT_DMS)
          .toArray()) as DmDoc[];
        const id = newId();
        await reports.insertOne({
          _id: id,
          at: new Date(now()),
          from: fromUid,
          fromNick,
          target,
          targetNick: t.nick,
          reason: input.reason,
          text: cleanText(input.text).slice(0, REPORT_TEXT_MAX),
          where: input.where.slice(0, 200),
          dms: excerpt.reverse().map((m) => ({ from: m.from, text: m.text, at: m.at })),
          status: "open",
        });
        return { id };
      });
    },

    /** (관리자) 신고 목록 */
    async reportList(status: "open" | "done" | "all", limit = 100): Promise<{ list: ReportRow[]; open: number }> {
      const filter = status === "all" ? {} : { status };
      const [docs, open] = await Promise.all([
        reports.find(filter as never).sort({ at: -1 }).limit(limit).toArray() as Promise<ReportDoc[]>,
        reports.countDocuments({ status: "open" } as never),
      ]);
      // 신고한 · 당한 사람의 지금 별명 (그새 바뀌었을 수 있어서)
      const lite = await liteOf([...new Set(docs.flatMap((d) => [d.from, d.target]))]);
      return {
        open,
        list: docs.map((d) => ({
          id: d._id,
          at: d.at.getTime(),
          from: { uid: d.from, nick: lite.get(d.from)?.nick ?? d.fromNick },
          target: { uid: d.target, nick: lite.get(d.target)?.nick ?? d.targetNick },
          reason: d.reason,
          text: d.text,
          where: d.where,
          dms: d.dms ?? [],
          status: d.status,
          note: d.note ?? "",
          doneAt: d.doneAt?.getTime() ?? null,
        })),
      };
    },

    /** (관리자) 처리 표시 · 메모 */
    async reportSet(id: string, patch: { status?: "open" | "done"; note?: string }): Promise<void> {
      const set: Record<string, unknown> = {};
      const unset: Record<string, string> = {};
      if (patch.status) {
        set.status = patch.status;
        if (patch.status === "done") set.doneAt = new Date(now());
        else unset.doneAt = "";
      }
      if (patch.note !== undefined) set.note = patch.note.slice(0, 500);
      const r = await reports.updateOne({ _id: id }, { $set: set, ...(Object.keys(unset).length && { $unset: unset }) } as never);
      if (!r.matchedCount) throw notFound("없는 신고예요.");
    },

    /** 서버를 끌 때 */
    close() {
      for (const t of leaving.values()) clearTimeout(t);
      leaving.clear();
    },
  };
  return api;
}
