import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Auth, AuthUser } from "../auth";
import { forbidden, unauthenticated } from "../errors";

/** async 핸들러의 오류를 express 오류 처리기로 넘김. 반환값은 JSON으로 응답 */
export const h =
  (fn: (req: Request, res: Response) => unknown): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((body) => {
        if (res.headersSent) return;
        if (body === undefined) res.status(204).end();
        else res.json(body);
      })
      .catch(next);
  };

/** Authorization: Bearer <Firebase ID 토큰> → 사용자 (없거나 잘못됐으면 null) */
export async function userOf(auth: Auth, req: Request): Promise<AuthUser | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  if (!m) return null;
  return auth.verify(m[1]).catch(() => null);
}

export async function requireAdmin(auth: Auth, req: Request): Promise<AuthUser> {
  const user = await userOf(auth, req);
  if (!user) throw unauthenticated();
  if (!user.admin) throw forbidden();
  return user;
}

/** Date → ms (없으면 null). 응답의 날짜는 전부 ms 숫자로 통일 */
export const ms = (v: unknown): number | null =>
  v instanceof Date ? v.getTime() : typeof v === "number" ? v : null;
