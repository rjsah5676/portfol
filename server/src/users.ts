import { Binary } from "mongodb";
import type { AuthUser } from "./auth";
import type { Config } from "./config";
import type { Database } from "./db";
import { RANK_COLLECTIONS } from "./db";
import { AppError, bad, forbidden } from "./errors";

/*
 * 회원 = Google 등으로 로그인(익명 아님)하고 별명을 정한 사람. users 컬렉션에 uid 로 한 줄씩.
 * 로그인 자체는 Firebase Auth 가 하고, 여기는 별명·기록만 가짐.
 *
 * 이름 표시 규칙 (사이트 전체 공통)
 *   회원   → 별명 (본인이 입력한 이름은 무시)
 *   비회원 → 입력한 이름 앞에 GUEST_MARK 를 붙여서 저장 — 화면에서 "로그인 안 한 사람"으로 구분해 보여 줌
 */

/** 비회원 이름 앞에 붙는 표시. 별명에는 쓸 수 없는 글자라 회원 이름과 겹치지 않음 */
export const GUEST_MARK = "◦";

/** 별명: 한글·영문·숫자·밑줄 2~10자 (이모지·공백·기호는 안 됨 — 꾸밈은 badge 로 따로) */
const NICK_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9_]{2,10}$/;
/** 아무나 가질 수 없는 별명 (소문자로 비교) */
const RESERVED = ["admin", "administrator", "관리자", "운영자", "운영진", "익명", "비회원", "guest", "게스트", "system", "시스템", "cpu", "gunmo", "건모"];

export interface UserStats {
  /** 랭킹 게임을 시작한 횟수 (랭킹 이름별) */
  plays?: Record<string, number>;
  /** 온라인 대국 전적 (체스·장기·오목) */
  online?: Record<string, { w?: number; l?: number; d?: number }>;
  /** 스케치 퀴즈 */
  sketch?: { correct?: number; points?: number; games?: number };
  /** 격투 온라인 경기 수 */
  fight?: { matches?: number };
}

export interface UserDoc {
  nick: string;
  /** 중복 검사용 (소문자) */
  nickKey: string;
  email: string | null;
  /** 관리자가 붙여 주는 꾸밈(이모지 등). 별명과 따로 둠 */
  badge?: string;
  createdAt: Date;
  updatedAt: Date;
  /** 방문 횟수 (마지막으로 센 뒤 한동안은 다시 안 셈) */
  visits?: number;
  lastVisitAt?: Date;
  /** 직접 올린 프로필 사진 (없으면 로그인 계정의 사진을 씀). at = 올린 시각 — 주소에 붙여 캐시를 가름 */
  avatar?: { type: string; data?: Binary; at: number };
  stats?: UserStats;
}

export interface Profile {
  nick: string;
  badge: string | null;
  createdAt: number;
  visits: number;
  /** 지금까지 한 게임 수 (랭킹 게임 시작 + 온라인 대국·스케치·격투) */
  plays: number;
  /** 직접 올린 프로필 사진 주소 (없으면 null) */
  avatar: string | null;
}

/** 프로필 사진: 브라우저가 256px 로 줄여서 보내므로 넉넉히 200KB 까지 */
export const AVATAR_MAX_BYTES = 200_000;
export const AVATAR_TYPES = ["image/webp", "image/jpeg", "image/png"];
/** 파일 앞머리로 실제 형식을 확인 (보낸 쪽이 적은 형식은 믿지 않음) */
function imageType(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}
export const avatarPath = (uid: string, at: number) => `/api/avatars/${encodeURIComponent(uid)}?v=${at}`;

/** 이 시간 안에 다시 들어온 것은 같은 방문으로 침 */
const VISIT_GAP_MS = 30 * 60_000;

const sum = (o: Record<string, number | undefined> = {}) => Object.values(o).reduce<number>((a, b) => a + (b ?? 0), 0);
const playsOf = (s: UserStats = {}) =>
  sum(s.plays) + Object.values(s.online ?? {}).reduce((a, r) => a + sum(r), 0) + (s.sketch?.games ?? 0) + (s.fight?.matches ?? 0);

const toProfile = (uid: string, d: UserDoc): Profile => ({
  nick: d.nick,
  badge: d.badge ?? null,
  createdAt: d.createdAt.getTime(),
  visits: d.visits ?? 0,
  plays: playsOf(d.stats),
  avatar: d.avatar ? avatarPath(uid, d.avatar.at) : null,
});

/** 입력한 이름에서 표시 글자·제어 문자를 걷어냄 */
const clean = (s: string) =>
  s
    .replaceAll(GUEST_MARK, "")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .trim();

/** 화면에 보일 이름: 회원이면 별명, 아니면 "◦입력한 이름" */
export function displayName(nick: string | null | undefined, typed: string, max = 10): string {
  if (nick) return nick;
  return GUEST_MARK + (clean(typed).slice(0, max) || "익명");
}

/** 꾸밈(배지): 관리자가 특별한 회원에게 붙여 주는 짧은 표시 (이모지 등) */
const BADGE_MAX = 8;

/** 관리자 화면에 내보내는 회원 한 줄 */
export interface AdminUser extends Profile {
  uid: string;
  email: string | null;
  updatedAt: number;
  lastVisitAt: number | null;
  stats: UserStats;
}
const toAdmin = (uid: string, d: UserDoc): AdminUser => ({
  uid,
  ...toProfile(uid, d),
  email: d.email ?? null,
  updatedAt: d.updatedAt?.getTime() ?? d.createdAt.getTime(),
  lastVisitAt: d.lastVisitAt?.getTime() ?? null,
  stats: d.stats ?? {},
});
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 회원의 이름이 저장되는 곳 (별명이 바뀌면 같이 바뀌고, 회원을 지울 때 같이 정리) */
const NAME_COLLECTIONS = [...RANK_COLLECTIONS, "rhythm_rankings", "guest"];

export type Users = ReturnType<typeof createUsers>;

export function createUsers(db: Database, cfg: Pick<Config, "adminNick">) {
  const col = db.col<UserDoc>("users");
  /** uid → 별명 (없으면 null). 요청마다 DB 를 읽지 않게 기억해 둠 */
  const cache = new Map<string, string | null>();
  const renameHooks: ((uid: string, nick: string | null) => void)[] = [];
  const adminKey = cfg.adminNick.toLowerCase();

  async function docOf(uid: string): Promise<UserDoc | null> {
    // 사진 본문은 프로필을 읽을 때마다 가져올 필요가 없어서 뺌
    const d = (await col.findOne({ _id: uid }, { projection: { "avatar.data": 0 } })) as UserDoc | null;
    cache.set(uid, d?.nick ?? null);
    if (cache.size > 20_000) cache.clear();
    return d;
  }

  /** 이름이 저장된 곳(랭킹·방명록)을 새 별명으로 맞춤. 가입 전에 익명으로 남긴 기록도 내 것이 됨 */
  async function syncNames(uid: string, nick: string) {
    const set = { $set: { name: nick, member: true } };
    await Promise.all(NAME_COLLECTIONS.map((c) => db.col(c).updateMany({ uid }, set)));
  }

  return {
    /** 회원의 별명 (비회원·별명 미설정이면 null) */
    async nickOf(user: AuthUser | null): Promise<string | null> {
      if (!user || user.anonymous) return null;
      const hit = cache.get(user.uid);
      if (hit !== undefined) return hit;
      return (await docOf(user.uid))?.nick ?? null;
    },

    /** 내 프로필. 관리자 계정은 처음 들어올 때 정해 둔 별명으로 자동 생성 */
    async profileOf(user: AuthUser): Promise<Profile | null> {
      if (user.anonymous) return null;
      let d = await docOf(user.uid);
      if (!d && user.admin) {
        const now = new Date();
        d = { nick: cfg.adminNick, nickKey: adminKey, email: user.email, createdAt: now, updatedAt: now, visits: 1, lastVisitAt: now };
        try {
          await col.insertOne({ _id: user.uid, ...d });
          cache.set(user.uid, d.nick);
          await syncNames(user.uid, d.nick);
          renameHooks.forEach((f) => f(user.uid, cfg.adminNick));
        } catch {
          d = null; // 별명이 이미 쓰이고 있으면 직접 정하게 둠
        }
      }
      return d ? toProfile(user.uid, d) : null;
    },

    /** 별명 정하기(가입) · 바꾸기 */
    async setNick(user: AuthUser, raw: unknown): Promise<Profile> {
      if (user.anonymous) throw forbidden("로그인이 필요합니다.");
      const nick = typeof raw === "string" ? raw.trim() : "";
      if (!NICK_RE.test(nick)) throw bad("별명은 한글·영문·숫자 2~10자로 정해주세요. (이모지·공백·기호는 쓸 수 없어요)");
      const nickKey = nick.toLowerCase();
      const reserved = RESERVED.includes(nickKey) || nickKey === adminKey;
      if (reserved && !user.admin) throw bad("쓸 수 없는 별명이에요.");
      const now = new Date();
      const taken = () => new AppError("NICK_TAKEN", "이미 다른 사람이 쓰고 있는 별명이에요.", 409);
      // 겹치는 별명은 유일 인덱스가 막아 줌(동시에 요청해도). 미리 한 번 더 확인해서 대부분은 여기서 걸러짐
      const other = await col.findOne({ nickKey, _id: { $ne: user.uid } });
      if (other) throw taken();
      const cur = await docOf(user.uid);
      try {
        if (cur) await col.updateOne({ _id: user.uid }, { $set: { nick, nickKey, updatedAt: now } });
        else await col.insertOne({ _id: user.uid, nick, nickKey, email: user.email, createdAt: now, updatedAt: now, visits: 1, lastVisitAt: now });
      } catch (e) {
        if ((e as { code?: number }).code === 11000) throw taken();
        throw e;
      }
      cache.set(user.uid, nick);
      await syncNames(user.uid, nick);
      renameHooks.forEach((f) => f(user.uid, nick));
      return toProfile(user.uid, { ...(cur ?? { email: user.email, createdAt: now, visits: 1 }), nick, nickKey, updatedAt: now } as UserDoc);
    },

    /** 프로필 사진 올리기 (별명을 정한 회원만). 형식은 파일 앞머리로 확인 */
    async setAvatar(user: AuthUser, body: unknown): Promise<Profile> {
      if (user.anonymous) throw forbidden("로그인이 필요합니다.");
      if (!Buffer.isBuffer(body) || body.length === 0) throw bad("사진 파일을 보내주세요. (JPG · PNG · WebP)");
      if (body.length > AVATAR_MAX_BYTES) throw bad("사진이 너무 커요.");
      const type = imageType(body);
      if (!type) throw bad("JPG · PNG · WebP 사진만 올릴 수 있어요.");
      const at = Date.now();
      const r = await col.updateOne({ _id: user.uid }, { $set: { avatar: { type, data: new Binary(body), at }, updatedAt: new Date(at) } });
      if (!r.matchedCount) throw bad("별명을 먼저 정해주세요.");
      return toProfile(user.uid, (await docOf(user.uid))!);
    },

    /** 올린 사진 지우기 → 로그인 계정의 사진으로 돌아감 */
    async clearAvatar(user: AuthUser): Promise<Profile | null> {
      if (user.anonymous) throw forbidden("로그인이 필요합니다.");
      await col.updateOne({ _id: user.uid }, { $unset: { avatar: "" } });
      const d = await docOf(user.uid);
      return d ? toProfile(user.uid, d) : null;
    },

    /** 프로필 사진 파일 (누구나 볼 수 있음) */
    async avatarOf(uid: string): Promise<{ type: string; data: Buffer } | null> {
      const d = (await col.findOne({ _id: uid }, { projection: { avatar: 1 } })) as Pick<UserDoc, "avatar"> | null;
      const a = d?.avatar;
      if (!a?.data) return null;
      return { type: a.type, data: Buffer.from(a.data.buffer) };
    },

    /** 방문 한 번 세기 (회원만). 마지막으로 센 지 30분이 안 됐으면 그대로 */
    async visit(uid: string) {
      const now = new Date();
      const since = new Date(now.getTime() - VISIT_GAP_MS);
      await col
        .updateOne(
          { _id: uid, $or: [{ lastVisitAt: { $exists: false } }, { lastVisitAt: { $lt: since } }] },
          { $inc: { visits: 1 }, $set: { lastVisitAt: now } }
        )
        .catch((e) => console.warn("[users] 방문 기록 실패", e));
    },

    /** 별명이 생기거나 바뀌었을 때 (접속 중인 소켓의 이름을 바꾸는 데 씀) */
    onRename(fn: (uid: string, nick: string | null) => void) {
      renameHooks.push(fn);
    },

    // ───────────── 관리자 ─────────────

    /** (관리자) 회원 목록: 별명·이메일로 찾기, 최근 가입 순 */
    async adminList(opts: { q?: string; limit?: number; skip?: number } = {}): Promise<{ total: number; items: AdminUser[] }> {
      const q = (opts.q ?? "").trim();
      const filter = q
        ? { $or: [{ nickKey: { $regex: escapeRe(q.toLowerCase()) } }, { email: { $regex: escapeRe(q), $options: "i" } }] }
        : {};
      const [total, docs] = await Promise.all([
        col.countDocuments(filter),
        col
          .find(filter, { projection: { "avatar.data": 0 } })
          .sort({ createdAt: -1 })
          .skip(opts.skip ?? 0)
          .limit(opts.limit ?? 100)
          .toArray(),
      ]);
      return { total, items: docs.map((d) => toAdmin(String(d._id), d as unknown as UserDoc)) };
    },

    /** (관리자) 별명 · 꾸밈 바꾸기. 별명 규칙(글자·길이·중복)은 그대로, 예약어만 허용 */
    async adminUpdate(uid: string, patch: { nick?: string; badge?: string | null }): Promise<AdminUser> {
      const cur = await docOf(uid);
      if (!cur) throw new AppError("NOT_FOUND", "없는 회원이에요.", 404);
      const set: Record<string, unknown> = { updatedAt: new Date() };
      const unset: Record<string, string> = {};
      let renamed: string | null = null;
      if (patch.nick !== undefined && patch.nick.trim() !== cur.nick) {
        const nick = patch.nick.trim();
        if (!NICK_RE.test(nick)) throw bad("별명은 한글·영문·숫자 2~10자로 정해주세요. (이모지·공백·기호는 쓸 수 없어요)");
        const nickKey = nick.toLowerCase();
        if (await col.findOne({ nickKey, _id: { $ne: uid } })) throw new AppError("NICK_TAKEN", "이미 다른 사람이 쓰고 있는 별명이에요.", 409);
        Object.assign(set, { nick, nickKey });
        renamed = nick;
      }
      if (patch.badge !== undefined) {
        const badge = (patch.badge ?? "").trim();
        if ([...badge].length > BADGE_MAX) throw bad(`꾸밈은 ${BADGE_MAX}자까지예요.`);
        if (badge) set.badge = badge;
        else unset.badge = "";
      }
      try {
        const update = { $set: set, ...(Object.keys(unset).length && { $unset: unset }) };
        await col.updateOne({ _id: uid }, update as Parameters<typeof col.updateOne>[1]);
      } catch (e) {
        if ((e as { code?: number }).code === 11000) throw new AppError("NICK_TAKEN", "이미 다른 사람이 쓰고 있는 별명이에요.", 409);
        throw e;
      }
      if (renamed) {
        cache.set(uid, renamed);
        await syncNames(uid, renamed);
        renameHooks.forEach((f) => f(uid, renamed));
      }
      return toAdmin(uid, (await docOf(uid))!);
    },

    /** (관리자) 올린 프로필 사진 지우기 */
    async adminClearAvatar(uid: string): Promise<void> {
      await col.updateOne({ _id: uid }, { $unset: { avatar: "" } });
    },

    /**
     * (관리자) 회원 지우기. 로그인 계정(Firebase)은 그대로라 다시 들어오면 별명부터 새로 정하게 됨.
     * records = true 면 그 사람의 랭킹·방명록도 지우고, 아니면 기록은 남기되 회원 표시만 뗌.
     */
    async adminRemove(uid: string, records: boolean): Promise<{ removed: boolean }> {
      const r = await col.deleteOne({ _id: uid });
      cache.set(uid, null);
      await Promise.all(
        NAME_COLLECTIONS.map((c) =>
          records ? db.col(c).deleteMany({ uid }) : db.col(c).updateMany({ uid }, { $unset: { member: "" } })
        )
      );
      renameHooks.forEach((f) => f(uid, null));
      return { removed: r.deletedCount > 0 };
    },

    /** 꾸밈이 붙은 회원들: 별명 → 꾸밈 (이름을 보여 주는 화면이 별명 옆에 붙임) */
    async badges(): Promise<Record<string, string>> {
      const docs = await col.find({ badge: { $exists: true } }, { projection: { nick: 1, badge: 1 } }).limit(1000).toArray();
      return Object.fromEntries(docs.filter((d) => d.badge).map((d) => [d.nick, d.badge as string]));
    },

    /** (관리자) 회원 수와 최근 가입한 사람들 */
    async adminRecent(limit = 5): Promise<{ total: number; recent: AdminUser[] }> {
      const [total, docs] = await Promise.all([
        col.countDocuments({}),
        col.find({}, { projection: { "avatar.data": 0 } }).sort({ createdAt: -1 }).limit(limit).toArray(),
      ]);
      return { total, recent: docs.map((d) => toAdmin(String(d._id), d as unknown as UserDoc)) };
    },

    /** 기록 숫자 올리기 (회원만 — 없는 uid 면 아무 일도 없음). 예: bump(uid, { "stats.online.chess.w": 1 }) */
    bump(uid: string, inc: Record<string, number>) {
      col.updateOne({ _id: uid }, { $inc: inc }).catch((e) => console.warn("[users] 기록 저장 실패", e));
    },

    async statsOf(uid: string): Promise<UserStats> {
      return ((await col.findOne({ _id: uid })) as UserDoc | null)?.stats ?? {};
    },
  };
}
