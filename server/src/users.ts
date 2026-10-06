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
  stats?: UserStats;
}

export interface Profile {
  nick: string;
  badge: string | null;
  createdAt: number;
  visits: number;
  /** 지금까지 한 게임 수 (랭킹 게임 시작 + 온라인 대국·스케치·격투) */
  plays: number;
}

/** 이 시간 안에 다시 들어온 것은 같은 방문으로 침 */
const VISIT_GAP_MS = 30 * 60_000;

const sum = (o: Record<string, number | undefined> = {}) => Object.values(o).reduce<number>((a, b) => a + (b ?? 0), 0);
const playsOf = (s: UserStats = {}) =>
  sum(s.plays) + Object.values(s.online ?? {}).reduce((a, r) => a + sum(r), 0) + (s.sketch?.games ?? 0) + (s.fight?.matches ?? 0);

const toProfile = (d: UserDoc): Profile => ({
  nick: d.nick,
  badge: d.badge ?? null,
  createdAt: d.createdAt.getTime(),
  visits: d.visits ?? 0,
  plays: playsOf(d.stats),
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

export type Users = ReturnType<typeof createUsers>;

export function createUsers(db: Database, cfg: Pick<Config, "adminNick">) {
  const col = db.col<UserDoc>("users");
  /** uid → 별명 (없으면 null). 요청마다 DB 를 읽지 않게 기억해 둠 */
  const cache = new Map<string, string | null>();
  const renameHooks: ((uid: string, nick: string) => void)[] = [];
  const adminKey = cfg.adminNick.toLowerCase();

  async function docOf(uid: string): Promise<UserDoc | null> {
    const d = (await col.findOne({ _id: uid })) as UserDoc | null;
    cache.set(uid, d?.nick ?? null);
    if (cache.size > 20_000) cache.clear();
    return d;
  }

  /** 이름이 저장된 곳(랭킹·방명록)을 새 별명으로 맞춤. 가입 전에 익명으로 남긴 기록도 내 것이 됨 */
  async function syncNames(uid: string, nick: string) {
    const set = { $set: { name: nick, member: true } };
    await Promise.all([...RANK_COLLECTIONS, "rhythm_rankings", "guest"].map((c) => db.col(c).updateMany({ uid }, set)));
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
      return d ? toProfile(d) : null;
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
      return toProfile({ ...(cur ?? { email: user.email, createdAt: now, visits: 1 }), nick, nickKey, updatedAt: now } as UserDoc);
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
    onRename(fn: (uid: string, nick: string) => void) {
      renameHooks.push(fn);
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
