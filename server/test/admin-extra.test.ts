import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RpcError, startTestServer, type TestServer } from "./helpers";

/* 관리자 보강: GP 경제 · 회원 상품 지급/회수 · 이용 정지(실시간 · HTTP 막기) · 사이트 공지 */

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.close();
});

let n = 0;
async function member() {
  const uid = `ax${++n}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `${uid}@example.com`;
  const token = await srv.token(uid, { email });
  const nick = `관리${n}${uid.slice(-3)}`;
  expect((await srv.http("/api/me/nick", { method: "PUT", token, body: { nick } })).status).toBe(200);
  return { uid, token, nick, email };
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof RpcError ? e.code : `THROWN:${String(e)}`;
  }
};

describe("관리자 보강", () => {
  it("GP 경제: 유통량 · 사유별 지급 · 원장(별명으로 거르기)", async () => {
    const a = await member();
    await srv.http("/api/me", { token: a.token }); // 출석
    const admin = await srv.adminToken();
    const e = (await srv.http("/api/admin/economy?days=7", { token: admin })).body;
    expect(e.total).toBeGreaterThan(0);
    expect(e.reasons.find((x: { reason: string }) => x.reason === "attend").in).toBeGreaterThan(0);
    expect(e.daily).toHaveLength(7);
    const log = (await srv.http(`/api/admin/economy/log?q=${encodeURIComponent(a.nick)}`, { token: admin })).body;
    expect(log.rows.every((x: { uid: string }) => x.uid === a.uid)).toBe(true);
    expect(log.rows[0]).toMatchObject({ nick: a.nick, reason: "attend" });
    expect((await srv.http("/api/admin/economy", { token: a.token })).status).toBe(403);
  });

  it("상품 지급 · 회수: 이미 가지면 OWNED, 없으면 NOT_OWNED", async () => {
    const a = await member();
    const admin = await srv.adminToken();
    const give = (give: boolean) => srv.http(`/api/admin/members/${a.uid}/items`, { method: "POST", token: admin, body: { item: "poker.char.mio", give } });
    expect((await give(true)).body.items).toContain("poker.char.mio");
    expect((await give(true)).body.error.code).toBe("OWNED");
    expect((await srv.http(`/api/admin/members/${a.uid}`, { token: admin })).body.items).toContain("poker.char.mio");
    expect((await give(false)).body.items).not.toContain("poker.char.mio");
    expect((await give(false)).body.error.code).toBe("NOT_OWNED");
  });

  it("이용 정지: 실시간 요청 · 쓰기 HTTP 가 막히고, 풀면 다시 됨", async () => {
    const a = await member();
    const c = await srv.client(a.uid, { email: a.email });
    const admin = await srv.adminToken();
    const ban = (days: number | null) => srv.http(`/api/admin/members/${a.uid}/ban`, { method: "PUT", token: admin, body: { days, reason: "도배" } });
    expect((await ban(3)).body.ban.reason).toBe("도배");
    expect(await code(c.rpc("poker.buyChar", { char: "mio" }))).toBe("BANNED");
    const claim = await srv.http("/api/points/achievements/poker.hands-100/claim", { method: "POST", token: a.token });
    expect(claim.body.error.code).toBe("BANNED");
    expect(claim.body.error.message).toContain("도배");
    // 읽기는 됨
    expect((await srv.http("/api/me", { token: a.token })).status).toBe(200);
    const list = (await srv.http("/api/admin/users?sort=banned", { token: admin })).body.items as { uid: string }[];
    expect(list.some((u) => u.uid === a.uid)).toBe(true);
    await ban(0);
    expect(await code(c.rpc("poker.buyChar", { char: "mio" }))).toBe("NEED_POINTS");
  });

  it("사이트 공지: 올리면 누구나 보고, 기한이 지나거나 내리면 null", async () => {
    const admin = await srv.adminToken();
    const put = (body: object) => srv.http("/api/admin/notice", { method: "PUT", token: admin, body });
    expect((await put({ text: "점검 안내", link: "javascript:alert(1)" })).status).toBe(400);
    const r = await put({ text: "점검 안내", link: "/faq/", tone: "warn" });
    expect(r.body.notice).toMatchObject({ text: "점검 안내", link: "/faq/", tone: "warn" });
    expect((await srv.http("/api/notice")).body.notice.text).toBe("점검 안내");
    await put({ text: "지난 공지", until: Date.now() - 1000 });
    expect((await srv.http("/api/notice")).body.notice).toBeNull();
    await srv.http("/api/admin/notice", { method: "DELETE", token: admin });
    expect((await srv.http("/api/notice")).body.notice).toBeNull();
  });

  it("미연시 초기화: 관리자만, 확인 문구가 맞아야 하고, 누구나 시각을 읽음", async () => {
    const admin = await srv.adminToken();
    const user = await member();
    const go = (token: string, confirm: string) => srv.http("/api/admin/love/reset", { method: "POST", token, body: { confirm } });
    expect((await srv.http("/api/love/reset")).body.at).toBe(0);
    expect((await go(user.token, "미연시 초기화")).status).not.toBe(200);
    expect((await go(admin, "초기화")).status).toBe(400);
    const r = await go(admin, "미연시 초기화");
    expect(r.body.at).toBeGreaterThan(0);
    expect((await srv.http("/api/love/reset")).body.at).toBe(r.body.at);
  });
});
