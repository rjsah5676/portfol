import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { createCaptcha, type PassStore } from "../src/captcha";

/** 메모리에 기억하는 통과 목록 */
function memStore(): PassStore & { map: Map<string, Date> } {
  const map = new Map<string, Date>();
  return { map, has: async (uid, since) => (map.get(uid)?.getTime() ?? 0) > since.getTime(), add: async (uid, at) => void map.set(uid, at) };
}
const req = (token?: string) => ({ headers: token ? { "x-captcha-token": token } : {}, ip: "::ffff:1.2.3.4" }) as unknown as Request;
/** Cloudflare 응답 흉내: 받은 요청을 calls 에 남김 */
function fakeFetch(success: boolean | "down") {
  const calls: URLSearchParams[] = [];
  const fn = (async (_url: string, init: RequestInit) => {
    calls.push(init.body as URLSearchParams);
    if (success === "down") throw new Error("network");
    return new Response(JSON.stringify({ success, "error-codes": success ? [] : ["invalid-input-response"] }));
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => `${e.code}:${e.status}:${e.data?.siteKey}`);

describe("사람 확인 (Turnstile)", () => {
  it("키가 없으면 꺼져 있어서 아무것도 안 물어봄", async () => {
    const c = createCaptcha(memStore(), { siteKey: "", secret: "" });
    expect(c.enabled).toBe(false);
    expect(await code(c.check(req()))).toBe("ok");
  });

  it("토큰이 없으면 CAPTCHA_REQUIRED(사이트 키 포함), 맞으면 통과하고 uid 를 기억", async () => {
    const store = memStore();
    const f = fakeFetch(true);
    const c = createCaptcha(store, { siteKey: "site", secret: "sec", fetchFn: f.fn });
    expect(await code(c.check(req(), { remember: "u1" }))).toBe("CAPTCHA_REQUIRED:403:site");
    expect(await code(c.check(req("tok"), { remember: "u1" }))).toBe("ok");
    expect(Object.fromEntries(f.calls[0])).toEqual({ secret: "sec", response: "tok", remoteip: "1.2.3.4" });
    // 기억한 uid 는 토큰 없이 통과, Cloudflare 에 다시 묻지 않음
    expect(await code(c.check(req(), { remember: "u1" }))).toBe("ok");
    expect(f.calls).toHaveLength(1);
    // 기억 기간이 지나면 다시
    store.map.set("u1", new Date(Date.now() - 25 * 3600_000));
    expect(await code(c.check(req(), { remember: "u1" }))).toBe("CAPTCHA_REQUIRED:403:site");
    // uid 가 없으면(비로그인) 매번
    expect(await code(c.check(req("tok")))).toBe("ok");
    expect(await code(c.check(req()))).toBe("CAPTCHA_REQUIRED:403:site");
  });

  it("틀린 토큰은 거절, Cloudflare 에 닿지 않으면 통과", async () => {
    const bad = createCaptcha(memStore(), { siteKey: "site", secret: "sec", fetchFn: fakeFetch(false).fn });
    expect(await code(bad.check(req("x"), { remember: "u2" }))).toBe("CAPTCHA_REQUIRED:403:site");
    const down = createCaptcha(memStore(), { siteKey: "site", secret: "sec", fetchFn: fakeFetch("down").fn });
    expect(await code(down.check(req("x")))).toBe("ok");
  });
});
