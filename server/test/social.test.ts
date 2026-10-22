import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OFFLINE_GRACE_MS } from "../src/social";
import { RpcError, startTestServer, type TestClient, type TestServer } from "./helpers";

/* 친구 · 접속 표시 · 메신저 · 정보보기 · 신고 */

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.close();
});

let n = 0;
async function member() {
  const uid = `so${++n}_${Math.random().toString(36).slice(2, 8)}`;
  const token = await srv.token(uid, { email: `${uid}@example.com` });
  const nick = `친구${n}${uid.slice(-3)}`;
  expect((await srv.http("/api/me/nick", { method: "PUT", token, body: { nick } })).status).toBe(200);
  const c = await srv.client(uid, { email: `${uid}@example.com` });
  return { uid, token, nick, c };
}
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: RpcError) => e.code);
const sub = (c: TestClient) => c.sub<{ uid: string; friends: any[] }>("social");

describe("친구", () => {
  it("요청 → 상대에게 'in' · 나에게 'out', 수락하면 둘 다 friends + 서로 접속 중으로 보임", async () => {
    const a = await member();
    const b = await member();
    const sa = await sub(a.c);
    const sb = await sub(b.c);
    expect(sa.data.friends).toEqual([]);
    expect((await a.c.rpc("social.request", { nick: b.nick })).status).toBe("out");
    expect((await sb.wait((e) => e.t === "friend")).d).toMatchObject({ uid: a.uid, nick: a.nick, status: "in", online: false });
    expect((await sa.wait((e) => e.t === "friend")).d).toMatchObject({ uid: b.uid, status: "out" });
    // 두 번 요청 · 나에게 요청 · 없는 별명
    expect(await code(a.c.rpc("social.request", { nick: b.nick }))).toBe("ALREADY");
    expect(await code(a.c.rpc("social.request", { nick: a.nick }))).toBe("BAD_REQUEST");
    expect(await code(a.c.rpc("social.request", { nick: "없는별명999" }))).toBe("NOT_FOUND");
    // 보낸 사람은 수락 못 함
    expect(await code(a.c.rpc("social.accept", { uid: b.uid }))).toBe("NOT_FOUND");
    await b.c.rpc("social.accept", { uid: a.uid });
    expect((await sa.wait((e) => e.t === "friend" && e.d.status === "friends")).d).toMatchObject({ uid: b.uid, online: true });
    expect((await sb.wait((e) => e.t === "friend" && e.d.status === "friends")).d).toMatchObject({ uid: a.uid, online: true });
    // 다시 구독하면 목록에 그대로
    const again = await sub(a.c);
    expect(again.data.friends).toHaveLength(1);
    expect(again.data.friends[0]).toMatchObject({ uid: b.uid, status: "friends", online: true });
  });

  it("상대가 먼저 보낸 요청이 있으면 내 요청은 바로 수락, 삭제하면 둘 다 unfriend", async () => {
    const a = await member();
    const b = await member();
    const sa = await sub(a.c);
    await a.c.rpc("social.request", { nick: b.nick });
    expect((await b.c.rpc("social.request", { nick: a.nick })).status).toBe("friends");
    await sa.wait((e) => e.t === "friend" && e.d.status === "friends");
    await b.c.rpc("social.remove", { uid: a.uid });
    expect((await sa.wait((e) => e.t === "unfriend")).d).toEqual({ uid: b.uid });
    expect(await srv.db.col("friends").countDocuments({})).toBeGreaterThanOrEqual(0);
    // 친구가 아니면 메시지 못 보냄
    expect(await code(a.c.rpc("dm.send", { uid: b.uid, text: "안녕" }))).toBe("NOT_FRIENDS");
  });

  it("비회원(별명 없음)은 구독 · 요청 못 함", async () => {
    const anon = await srv.client("anon-social");
    expect(await code(anon.rpc("social.request", { nick: "아무나" }))).toBe("FORBIDDEN");
    expect(await code(sub(anon))).toBe("FORBIDDEN");
  });
});

describe("메신저 · 접속 표시", () => {
  async function pair() {
    const a = await member();
    const b = await member();
    await a.c.rpc("social.request", { nick: b.nick });
    await b.c.rpc("social.accept", { uid: a.uid });
    return { a, b };
  }

  it("보내면 상대 안 읽은 수 +1, 읽으면 0 + 보낸 사람에게 '읽음', 기록은 오래된 것부터", async () => {
    const { a, b } = await pair();
    const sa = await sub(a.c);
    const sb = await sub(b.c);
    await a.c.rpc("dm.send", { uid: b.uid, text: "  안녕\u0007하세요  " });
    const ev = await sb.wait((e) => e.t === "dm");
    expect(ev.d).toMatchObject({ uid: a.uid, unread: 1, msg: { from: a.uid, text: "안녕하세요" } });
    await a.c.rpc("dm.send", { uid: b.uid, text: "두 번째" });
    expect((await sb.wait((e) => e.t === "dm")).d.unread).toBe(2);
    const h = await b.c.rpc("dm.history", { uid: a.uid });
    expect(h.msgs.map((m: any) => m.text)).toEqual(["안녕하세요", "두 번째"]);
    expect(h.more).toBe(false);
    await b.c.rpc("dm.read", { uid: a.uid });
    expect((await sa.wait((e) => e.t === "read")).d).toMatchObject({ uid: b.uid, by: b.uid });
    const list = (await sub(b.c)).data.friends;
    expect(list[0]).toMatchObject({ unread: 0, last: { mine: false, text: "두 번째" } });
    // 빈 글 · 너무 긴 글
    expect(await code(a.c.rpc("dm.send", { uid: b.uid, text: "   " }))).toBe("BAD_REQUEST");
    expect(await code(a.c.rpc("dm.send", { uid: b.uid, text: "가".repeat(501) }))).toBe("BAD_REQUEST");
  });

  it("있는 곳이 친구에게 보이고, 나가면 잠시 뒤 오프라인 + 마지막 접속", async () => {
    const { a, b } = await pair();
    const sa = await sub(a.c);
    await sub(b.c);
    await b.c.rpc("social.where", { where: "ANIME POKER" });
    expect((await sa.wait((e) => e.t === "presence" && e.d.uid === b.uid && e.d.where)).d).toMatchObject({ online: true, where: "ANIME POKER" });
    b.c.close();
    const off = await sa.wait((e) => e.t === "presence" && e.d.uid === b.uid && !e.d.online, OFFLINE_GRACE_MS + 4000);
    expect(off.d.seen).toBeGreaterThan(0);
  }, 20_000);
});

describe("정보보기 · 신고", () => {
  it("카드: 누구나 보지만 이메일 · GP 는 없음, 사이와 접속 표시는 친구에게만", async () => {
    const a = await member();
    const b = await member();
    const pub = await srv.http(`/api/users/${encodeURIComponent(a.nick)}/card`);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ uid: a.uid, nick: a.nick, rel: null, presence: null });
    expect(JSON.stringify(pub.body)).not.toContain("@example.com");
    expect(pub.body).not.toHaveProperty("points");
    expect((await srv.http(`/api/users/${encodeURIComponent(a.nick)}/card`, { token: a.token })).body.rel).toBe("self");
    await b.c.rpc("social.request", { nick: a.nick });
    expect((await srv.http(`/api/users/${encodeURIComponent(a.nick)}/card`, { token: b.token })).body.rel).toBe("out");
    expect((await srv.http(`/api/users/${encodeURIComponent(b.nick)}/card`, { token: a.token })).body.rel).toBe("in");
    expect((await srv.http("/api/users/없는별명/card")).status).toBe(404);
  });

  it("신고: 회원만, 같은 사람은 한동안 한 번, 메시지 기록이 같이 붙고 관리자가 처리", async () => {
    const a = await member();
    const b = await member();
    await a.c.rpc("social.request", { nick: b.nick });
    await b.c.rpc("social.accept", { uid: a.uid });
    await b.c.rpc("dm.send", { uid: a.uid, text: "나쁜 말" });
    const body = { nick: b.nick, reason: "욕설 · 비하", text: "메시지로 욕했어요", where: "/me/" };
    expect((await srv.http("/api/reports", { method: "POST", body })).status).toBe(401);
    const r = await srv.http("/api/reports", { method: "POST", token: a.token, body });
    expect(r.status).toBe(200);
    expect((await srv.http("/api/reports", { method: "POST", token: a.token, body })).status).toBe(409);
    expect((await srv.http("/api/reports", { method: "POST", token: a.token, body: { ...body, nick: a.nick } })).status).toBe(400);
    expect((await srv.http("/api/reports", { method: "POST", token: a.token, body: { ...body, reason: "아무거나" } })).status).toBe(400);
    const admin = await srv.adminToken();
    expect((await srv.http("/api/admin/reports", { token: a.token })).status).toBe(403);
    const list = await srv.http("/api/admin/reports", { token: admin });
    const row = list.body.list.find((x: any) => x.id === r.body.id);
    expect(row).toMatchObject({ from: { nick: a.nick }, target: { nick: b.nick }, status: "open", dms: [{ from: b.uid, text: "나쁜 말" }] });
    expect((await srv.http(`/api/admin/reports/${r.body.id}`, { method: "POST", token: admin, body: { status: "done", note: "경고함" } })).status).toBe(204);
    const done = (await srv.http("/api/admin/reports?status=done", { token: admin })).body.list.find((x: any) => x.id === r.body.id);
    expect(done).toMatchObject({ status: "done", note: "경고함" });
    expect(done.doneAt).toBeGreaterThan(0);
  });
});
