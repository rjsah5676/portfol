import type { Request } from "express";
import type { Database } from "./db";
import { AppError } from "./errors";

/*
 * 사람 확인 (Cloudflare Turnstile). 봇이 익명으로 랭킹 · 방명록 · 문의를 올리지 못하게.
 *
 *   TURNSTILE_SITE_KEY · TURNSTILE_SECRET 둘 다 있을 때만 켜짐 (없으면 아무것도 안 물어봄 → 로컬 · 테스트 그대로).
 *   확인이 필요하면 403 CAPTCHA_REQUIRED { siteKey } → 브라우저가 Turnstile 을 돌려 토큰을 받고
 *   같은 요청을 X-Captcha-Token 헤더에 실어 다시 보냄 (web/src/lib/captcha.ts).
 *   한 번 통과한 익명 계정(uid)은 PASS_HOURS 동안 다시 안 물어봄 (랭킹). 방명록 · 문의는 보낼 때마다.
 *   Cloudflare 에 닿지 않으면(장애) 막지 않고 통과시킴 — 사이트가 멈추는 것보다 낫다고 봄.
 */

export const CAPTCHA_HEADER = "x-captcha-token";
export const PASS_HOURS = 24;
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const PASSES = "captcha_pass";

/** 통과한 uid 기억 */
export interface PassStore {
  has(uid: string, since: Date): Promise<boolean>;
  add(uid: string, at: Date): Promise<void>;
}

export function mongoPassStore(db: Database): PassStore {
  const col = db.col<{ at: Date }>(PASSES);
  // 기억 기간이 지나면 자동 삭제 (인덱스는 성능·정리용이라 실패해도 됨)
  void col.createIndex({ at: 1 }, { expireAfterSeconds: PASS_HOURS * 3600 }).catch(() => {});
  return {
    has: async (uid, since) => !!(await col.findOne({ _id: uid, at: { $gt: since } }, { projection: { _id: 1 } })),
    add: async (uid, at) => {
      await col.updateOne({ _id: uid }, { $set: { at } }, { upsert: true });
    },
  };
}

export interface Captcha {
  enabled: boolean;
  /**
   * 사람 확인. 통과하면 그냥 끝나고, 아니면 CAPTCHA_REQUIRED 를 던짐.
   * remember: 이 uid 는 통과 후 PASS_HOURS 동안 다시 안 물어봄
   */
  check(req: Request, opts?: { remember?: string }): Promise<void>;
}

const required = (siteKey: string, message = "사람인지 확인이 필요해요.") =>
  new AppError("CAPTCHA_REQUIRED", message, 403, { siteKey });

export function createCaptcha(
  store: PassStore,
  {
    siteKey = process.env.TURNSTILE_SITE_KEY?.trim() ?? "",
    secret = process.env.TURNSTILE_SECRET?.trim() ?? "",
    fetchFn = fetch,
  }: { siteKey?: string; secret?: string; fetchFn?: typeof fetch } = {}
): Captcha {
  const enabled = !!(siteKey && secret);

  async function verify(token: string, ip: string): Promise<boolean> {
    try {
      const res = await fetchFn(VERIFY_URL, {
        method: "POST",
        body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
        signal: AbortSignal.timeout(8000),
      });
      const j = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
      if (!j.success) console.warn("[captcha] 실패", j["error-codes"]);
      return !!j.success;
    } catch (e) {
      console.warn("[captcha] Cloudflare 확인 요청 실패 → 통과시킴", e);
      return true;
    }
  }

  return {
    enabled,
    async check(req, { remember } = {}) {
      if (!enabled) return;
      if (remember && (await store.has(remember, new Date(Date.now() - PASS_HOURS * 3600_000)))) return;
      const token = String(req.headers[CAPTCHA_HEADER] ?? "").slice(0, 2048);
      if (!token) throw required(siteKey);
      if (!(await verify(token, (req.ip ?? "").replace(/^::ffff:/, ""))))
        throw required(siteKey, "확인에 실패했어요. 다시 시도해 주세요.");
      if (remember) await store.add(remember, new Date());
    },
  };
}
