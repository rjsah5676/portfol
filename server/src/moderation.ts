import type { NextFunction, Request, Response } from "express";
import type { Auth } from "./auth";
import type { Database } from "./db";
import { AppError } from "./errors";
import { userOf } from "./http/util";

/*
 * 이용 정지 (관리자 → 회원).
 *   users.ban = { until: ms | null(영구), reason, at }
 * 정지된 회원은 보기만 할 수 있음: 실시간 요청(rpc — 게임 행동 · 채팅 · 상점) 과 쓰기 HTTP(랭킹 등록 · 방명록 · 업적 받기 …)를 막음.
 * 문의 보내기 · 내 정보 보기 · 방문 기록은 그대로 (정지에 대해 물어볼 수 있게).
 * 서버가 한 프로세스라 정지 목록을 메모리에 들고 있고, 관리자가 바꾸면 바로 갱신.
 */

export interface Ban {
  until: number | null;
  reason: string;
  at: number;
}

/** 쓰기라도 막지 않는 HTTP 경로 (/api 뒤) */
const ALLOW = [/^\/track\b/, /^\/inquiries\/?$/, /^\/admin\//];

const fmt = (t: number) => {
  const d = new Date(t + 9 * 3600_000);
  return `${d.toISOString().slice(0, 10).replaceAll("-", ".")} ${d.toISOString().slice(11, 16)}`;
};
export const banMessage = (b: Ban) =>
  `이용이 제한된 계정이에요 (${b.until === null ? "기한 없음" : `${fmt(b.until)}까지`}${b.reason ? ` · 사유: ${b.reason}` : ""}). 문의는 소개 페이지의 문의하기로 보내 주세요.`;

export function createModeration(db: Database, now: () => number = Date.now) {
  const users = db.col<{ _id: string; ban?: Ban }>("users");
  const bans = new Map<string, Ban>();
  const ready = users
    .find({ ban: { $exists: true } } as never, { projection: { ban: 1 } })
    .toArray()
    .then((docs) => docs.forEach((d) => d.ban && bans.set(d._id, d.ban)))
    .catch((e) => console.warn("[moderation] 정지 목록 읽기 실패", e));

  const active = (uid: string): Ban | null => {
    const b = bans.get(uid);
    if (!b) return null;
    if (b.until !== null && b.until <= now()) return null;
    return b;
  };

  return {
    ready,
    active,
    /** 정지 중이면 안내 문구, 아니면 null */
    blocked(uid: string): string | null {
      const b = active(uid);
      return b ? banMessage(b) : null;
    },
    /** 정지 · 풀기. days: null 이면 영구, 0 이면 풀기 */
    async set(uid: string, days: number | null, reason: string): Promise<Ban | null> {
      if (days === 0) {
        await users.updateOne({ _id: uid }, { $unset: { ban: "" } } as never);
        bans.delete(uid);
        return null;
      }
      const b: Ban = { until: days === null ? null : now() + days * 86_400_000, reason: reason.trim().slice(0, 100), at: now() };
      const r = await users.updateOne({ _id: uid }, { $set: { ban: b } } as never);
      if (!r.matchedCount) throw new AppError("NOT_FOUND", "없는 회원이에요.", 404);
      bans.set(uid, b);
      return b;
    },
    /** 지금 정지 중인 회원 수 */
    count: () => [...bans.keys()].filter((u) => active(u)).length,
  };
}

export type Moderation = ReturnType<typeof createModeration>;

/** express: 정지된 회원의 쓰기 요청을 막음 (로그인 토큰이 있을 때만 확인) */
export function banGuard(auth: Auth, mod: Moderation) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (!req.headers.authorization || ALLOW.some((re) => re.test(req.path))) return next();
    userOf(auth, req)
      .then((user) => {
        const why = user ? mod.blocked(user.uid) : null;
        next(why ? new AppError("BANNED", why, 403) : undefined);
      })
      .catch(() => next());
  };
}
