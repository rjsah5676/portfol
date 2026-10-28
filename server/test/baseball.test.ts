import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers";

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

const member = (uid: string) => s.token(uid, { email: `${uid}@example.com` });

describe("야구 클라우드 세이브", () => {
  it("비로그인 · 익명은 못 씀", async () => {
    expect((await s.http("/api/baseball/save")).status).toBe(401);
    const anon = await s.token("anon1", { anonymous: true });
    expect((await s.http("/api/baseball/save", { token: anon })).status).toBe(401);
    expect((await s.http("/api/baseball/save", { method: "PUT", token: anon, body: { data: {}, prev: 0 } })).status).toBe(401);
  });

  it("처음엔 없음 → 올리면 rev 1 → 받으면 그대로", async () => {
    const t = await member("bb1");
    expect((await s.http("/api/baseball/save", { token: t })).body).toEqual({ save: null });
    const put = await s.http("/api/baseball/save", { method: "PUT", token: t, body: { data: { "pxb:career:v3": '{"v":3}', "pxb:club:v1": "{}" }, prev: 0 } });
    expect(put.status).toBe(200);
    expect(put.body.rev).toBe(1);
    const got = await s.http("/api/baseball/save", { token: t });
    expect(got.body.save.rev).toBe(1);
    expect(got.body.save.data).toEqual({ "pxb:career:v3": '{"v":3}', "pxb:club:v1": "{}" });
  });

  it("다른 기기가 먼저 올렸으면 409 SAVE_CONFLICT (지금 rev 같이)", async () => {
    const t = await member("bb2");
    await s.http("/api/baseball/save", { method: "PUT", token: t, body: { data: { "pxb:v1": "a" }, prev: 0 } });
    const a = await s.http("/api/baseball/save", { method: "PUT", token: t, body: { data: { "pxb:v1": "b" }, prev: 1 } });
    expect(a.body.rev).toBe(2);
    // 예전 rev 로 올리면 거절
    const b = await s.http("/api/baseball/save", { method: "PUT", token: t, body: { data: { "pxb:v1": "c" }, prev: 1 } });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe("SAVE_CONFLICT");
    expect(b.body.error.data.rev).toBe(2);
    // 처음(prev 0)인 척해도 거절
    expect((await s.http("/api/baseball/save", { method: "PUT", token: t, body: { data: { "pxb:v1": "d" }, prev: 0 } })).status).toBe(409);
    expect((await s.http("/api/baseball/save", { token: t })).body.save.data).toEqual({ "pxb:v1": "b" });
  });

  it("계정끼리 섞이지 않음 · 이상한 키 · 너무 큰 건 거절", async () => {
    const t = await member("bb3");
    expect((await s.http("/api/baseball/save", { token: t })).body).toEqual({ save: null });
    expect((await s.http("/api/baseball/save", { method: "PUT", token: t, body: { data: { "other:key": "x" }, prev: 0 } })).status).toBe(400);
    expect((await s.http("/api/baseball/save", { method: "PUT", token: t, body: { data: { "pxb:big": "x".repeat(1_000_001) }, prev: 0 } })).status).toBe(413);
  });
});
