import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers";

let s: TestServer;
let admin: string;
beforeAll(async () => {
  s = await startTestServer();
  admin = await s.adminToken();
});
afterAll(() => s.close());

const memberToken = (uid: string) => s.token(uid, { email: `${uid}@example.com` });
async function member(uid: string, nick: string) {
  const token = await memberToken(uid);
  expect((await s.http("/api/me/nick", { method: "PUT", token, body: { nick } })).status).toBe(200);
  return token;
}
/** 랭킹 기록 하나 (티켓 시각을 돌려 놓고 등록) */
async function rank(token: string, board: string, body: object) {
  const t = await s.http("/api/rankings/tickets", { method: "POST", token, body: { board } });
  await s.db.col("rank_tickets").updateOne({ _id: t.body.ticket }, { $set: { createdAt: new Date(Date.now() - 600_000) } });
  return s.http(`/api/rankings/${board}`, { method: "POST", token, body: { ...body, ticket: t.body.ticket } });
}

describe("관리자: 권한", () => {
  it("관리자가 아니면 어떤 관리자 주소도 못 씀", async () => {
    const user = await member("plain1", "보통회원");
    for (const path of ["/api/admin/overview", "/api/admin/users", "/api/admin/live"]) {
      expect((await s.http(path)).status).toBe(401);
      expect((await s.http(path, { token: user })).status).toBe(403);
    }
    expect((await s.http("/api/admin/users/plain1", { method: "PATCH", token: user, body: { badge: "👑" } })).status).toBe(403);
    expect((await s.http("/api/admin/users/plain1", { method: "DELETE", token: user })).status).toBe(403);
  });
});

describe("관리자: 한눈에 보기", () => {
  it("방문자(14일) · 회원 · 문의 · 글 · 랭킹 · 방 · 서버 상태와 최근 활동이 한 번에 옴", async () => {
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    await s.http("/api/stats/visit", { method: "POST", body: { dateKey: today } });
    await s.http("/api/stats/visit", { method: "POST", body: { dateKey: today } });
    await s.http("/api/inquiries", { method: "POST", body: { name: "문의자", email: "q@example.com", phone: "", message: "안녕하세요" } });
    await s.http("/api/guest", { method: "POST", body: { name: "손님", contents: "다녀가요", id: Date.now(), date: "d" } });
    const token = await member("ov1", "개요회원");
    await rank(token, "score", { score: 88 });

    const { status, body } = await s.http("/api/admin/overview", { token: admin });
    expect(status).toBe(200);
    expect(body.visitors.total).toBeGreaterThanOrEqual(2);
    expect(body.visitors.today).toBe(2);
    expect(body.visitors.daily).toHaveLength(14);
    expect(body.visitors.daily[13]).toEqual({ date: today, count: 2 });
    expect(body.members.total).toBeGreaterThanOrEqual(1);
    expect(body.members.recent[0].nick).toBe("개요회원");
    expect(body.inquiries).toMatchObject({ total: 1, unread: 1 });
    expect(body.guest.total).toBe(1);
    expect(body.rankings.score).toBe(1);
    expect(body.rooms.chess_rooms).toEqual({ total: 0, playing: 0, waiting: 0 });
    expect(body.live).toEqual({ sketch: { rooms: 0, players: 0 }, fight: { rooms: 0, players: 0 }, poker: { rooms: 0, players: 0 } });
    expect(body.server.node).toMatch(/^v\d+/);
    const kinds = body.activity.map((a: any) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["member", "guest", "inquiry", "rank"]));
    // 최근 것이 위로
    expect(body.activity.map((a: any) => a.at)).toEqual([...body.activity.map((a: any) => a.at)].sort((a, b) => b - a));
  });
});

describe("관리자: 회원", () => {
  it("목록 · 찾기, 별명과 꾸밈 바꾸기 (꾸밈은 이모지 가능, 별명 규칙은 그대로)", async () => {
    const token = await member("mu1", "원래별명");
    await member("mu2", "다른사람");
    await rank(token, "score", { score: 120 });

    const all = (await s.http("/api/admin/users", { token: admin })).body;
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(all.items[0]).toMatchObject({ uid: "mu2", nick: "다른사람", email: "mu2@example.com", badge: null });
    expect(all.items[0].avatar).toBeNull();
    const found = (await s.http(`/api/admin/users?q=${encodeURIComponent("원래")}`, { token: admin })).body;
    expect(found.items.map((u: any) => u.uid)).toEqual(["mu1"]);
    expect((await s.http("/api/admin/users?q=MU2@EXAMPLE", { token: admin })).body.items.map((u: any) => u.uid)).toEqual(["mu2"]);
    // 정규식 글자를 넣어도 그냥 글자로 찾음
    expect((await s.http(`/api/admin/users?q=${encodeURIComponent(".*")}`, { token: admin })).body.total).toBe(0);

    const patch = (body: object) => s.http("/api/admin/users/mu1", { method: "PATCH", token: admin, body });
    expect((await patch({ badge: "👑" })).body).toMatchObject({ nick: "원래별명", badge: "👑" });
    expect((await s.http("/api/me", { token })).body.profile.badge).toBe("👑");
    // 꾸밈은 누구나 받아 갈 수 있음 (랭킹·방명록에서 별명 옆에 보여 줌)
    expect((await s.http("/api/badges")).body).toMatchObject({ 원래별명: "👑" });
    expect((await patch({ badge: "가".repeat(9) })).status).toBe(400);
    expect((await patch({ badge: null })).body.badge).toBeNull();
    expect((await s.http("/api/badges")).body).not.toHaveProperty("원래별명");
    // 별명: 이모지 · 중복은 관리자도 안 됨, 바꾸면 그 사람 랭킹 이름도 같이
    expect((await patch({ nick: "별명😀" })).status).toBe(400);
    expect((await patch({ nick: "다른사람" })).status).toBe(409);
    expect((await patch({ nick: "관리자가바꿈" })).body.nick).toBe("관리자가바꿈");
    expect((await s.http("/api/rankings/score?limit=100")).body.find((r: any) => r.score === 120).name).toBe("관리자가바꿈");
    expect((await s.http("/api/admin/users/nobody", { method: "PATCH", token: admin, body: { badge: "x" } })).status).toBe(404);
  });

  it("프로필 사진 지우기, 회원 지우기 (기록 남기기 / 같이 지우기)", async () => {
    const keep = await member("del1", "기록남김");
    const wipe = await member("del2", "기록삭제");
    await rank(keep, "score", { score: 61 });
    await rank(wipe, "score", { score: 62 });
    await s.http("/api/guest", { method: "POST", token: wipe, body: { name: "", contents: "지워질 글", id: Date.now(), date: "d" } });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
    await fetch(`${s.url}/api/me/avatar`, { method: "PUT", headers: { Authorization: `Bearer ${keep}`, "Content-Type": "image/png" }, body: new Uint8Array(png) });
    expect((await fetch(`${s.url}/api/avatars/del1`)).status).toBe(200);
    expect((await s.http("/api/admin/users/del1/avatar", { method: "DELETE", token: admin })).status).toBe(204);
    expect((await fetch(`${s.url}/api/avatars/del1`)).status).toBe(404);

    // 기록은 남기고 회원만: 랭킹에 이름은 남고 회원 표시가 빠짐
    expect((await s.http("/api/admin/users/del1", { method: "DELETE", token: admin })).body).toEqual({ removed: true });
    const rows = (await s.http("/api/rankings/score?limit=100")).body;
    const kept = rows.find((r: any) => r.score === 61);
    expect(kept.name).toBe("기록남김");
    expect(kept.member).toBeUndefined();
    expect((await s.http("/api/me", { token: keep })).body.profile).toBeNull(); // 다시 들어오면 별명부터
    // 기록까지: 랭킹 · 방명록에서 사라짐
    expect((await s.http("/api/admin/users/del2?records=1", { method: "DELETE", token: admin })).body).toEqual({ removed: true });
    expect((await s.http("/api/rankings/score?limit=100")).body.some((r: any) => r.score === 62)).toBe(false);
    expect((await s.http("/api/guest")).body.some((g: any) => g.contents === "지워질 글")).toBe(false);
    // 지운 별명은 다른 사람이 쓸 수 있음
    await member("del3", "기록삭제");
    expect((await s.http("/api/admin/users/del2", { method: "DELETE", token: admin })).body).toEqual({ removed: false });
  });
});

describe("관리자: 열려 있는 방", () => {
  it("스케치 · 격투 방이 목록에 나오고, 닫으면 안에 있던 사람에게 방이 없어졌다고 알림", async () => {
    const a = await s.client("live-a");
    const b = await s.client("live-b");
    const sk = await a.rpc<string>("sketch.createRoom", { nick: "그림", name: "그림방", max: 4, turnMode: "order", drawTime: 60, rounds: 1, hints: false, password: "" });
    await a.rpc("sketch.join", { id: sk, nick: "그림" });
    const f = await b.rpc<string>("fight.createRoom", { nick: "격투", name: "격투방" });
    await b.rpc("fight.join", { id: f, nick: "격투", ch: 0 });

    const live = (await s.http("/api/admin/live", { token: admin })).body;
    expect(live.sketch).toEqual([expect.objectContaining({ id: sk, name: "그림방", status: "waiting", players: ["◦그림"] })]);
    expect(live.fight).toEqual([expect.objectContaining({ id: f, name: "격투방", status: "wait", players: ["◦격투"] })]);
    expect((await s.http("/api/admin/overview", { token: admin })).body.live).toEqual({ sketch: { rooms: 1, players: 1 }, fight: { rooms: 1, players: 1 }, poker: { rooms: 0, players: 0 } });

    const room = await a.sub("sketch.room", { id: sk });
    const close = (game: string, id: string) => s.http("/api/admin/live/close", { method: "POST", token: admin, body: { game, id } });
    expect((await close("sketch", sk)).body).toEqual({ closed: true });
    expect((await room.wait((e) => e.t === "room")).d).toBeNull();
    expect((await close("sketch", sk)).body).toEqual({ closed: false });
    expect((await close("fight", f)).body).toEqual({ closed: true });
    expect((await close("chess", "x")).status).toBe(400);
    expect((await s.http("/api/admin/live", { token: admin })).body).toEqual({ sketch: [], fight: [], poker: [] });
  });
});
