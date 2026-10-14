import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers";

/* 우편: 관리자가 보내고(전체 · 별명), 받는 사람이 받기 → GP. 두 번 눌러도 한 번, 회수하면 못 받음 */

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.close();
});

let n = 0;
async function member() {
  const uid = `ml${++n}_${Math.random().toString(36).slice(2, 8)}`;
  const token = await srv.token(uid, { email: `${uid}@example.com` });
  const nick = `우편${n}${uid.slice(-3)}`;
  expect((await srv.http("/api/me/nick", { method: "PUT", token, body: { nick } })).status).toBe(200);
  await srv.db.col("users").updateOne({ _id: uid }, { $set: { points: 0 } });
  return { uid, token, nick };
}
const pts = async (uid: string) => ((await srv.db.col("users").findOne({ _id: uid })) as { points?: number }).points;

describe("우편", () => {
  it("별명으로 보내면 그 사람만, 받기는 한 번만 (동시에 눌러도), 원장에 '우편'", async () => {
    const a = await member();
    const b = await member();
    const admin = await srv.adminToken();
    const s = await srv.http("/api/admin/mail", { method: "POST", token: admin, body: { to: [a.nick], title: "보상", body: "고마워요", points: 300, days: 7 } });
    expect(s.status).toBe(200);
    expect(s.body.to).toBe(1);
    expect((await srv.http("/api/mail/unread", { token: a.token })).body.unread).toBe(1);
    expect((await srv.http("/api/mail/unread", { token: b.token })).body.unread).toBe(0);
    const id = s.body.id as string;
    const rs = await Promise.all([1, 2, 3].map(() => srv.http(`/api/mail/${id}/claim`, { method: "POST", token: a.token })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.body?.error?.code === "CLAIMED")).toHaveLength(2);
    expect(await pts(a.uid)).toBe(300);
    expect((await srv.http(`/api/mail/${id}/claim`, { method: "POST", token: b.token })).status).toBe(404);
    const log = (await srv.http("/api/points", { token: a.token })).body.log;
    expect(log[0]).toMatchObject({ delta: 300, reason: "mail", ref: "보상" });
    const list = (await srv.http("/api/mail", { token: a.token })).body;
    expect(list.unread).toBe(0);
    expect(list.list[0].gotAt).not.toBeNull();
  });

  it("모든 회원: 전부 받기로 한꺼번에, 회수한 우편은 못 받음, 없는 별명은 거절", async () => {
    const a = await member();
    const admin = await srv.adminToken();
    const send = (body: object) => srv.http("/api/admin/mail", { method: "POST", token: admin, body: { body: "", days: 3, ...body } });
    await send({ to: "*", title: "전체1", points: 100 });
    await send({ to: "*", title: "공지", points: 0 });
    const gone = (await send({ to: "*", title: "회수", points: 999 })).body.id;
    expect((await srv.http(`/api/admin/mail/${gone}`, { method: "DELETE", token: admin })).status).toBe(204);
    expect((await send({ to: ["없는사람이름"], title: "x", points: 1 })).status).toBe(404);
    const r = await srv.http("/api/mail/claim-all", { method: "POST", token: a.token });
    expect(r.status).toBe(200);
    expect(r.body.reward).toBeGreaterThanOrEqual(100);
    expect(r.body.points).toBe(await pts(a.uid));
    expect((await srv.http("/api/mail/claim-all", { method: "POST", token: a.token })).body.error.code).toBe("NOT_YET");
    const sent = (await srv.http("/api/admin/mail", { token: admin })).body.list as { title: string; got: number }[];
    expect(sent.find((m) => m.title === "전체1")!.got).toBeGreaterThanOrEqual(1);
    expect(sent.some((m) => m.title === "회수")).toBe(false);
    // 비회원 · 관리자 아님
    expect((await srv.http("/api/mail")).status).toBe(401);
    expect((await srv.http("/api/admin/mail", { token: a.token })).status).toBe(403);
  });
});
