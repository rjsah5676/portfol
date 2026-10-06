import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers";

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

describe("랭킹", () => {
  it("멜론게임: 등록하고 점수 높은 순으로 조회", async () => {
    for (const score of [10, 200, 50])
      expect((await s.http("/api/rankings/score", { method: "POST", body: { name: "a", score } })).status).toBe(200);
    const { body } = await s.http("/api/rankings/score?limit=2");
    expect(body.map((r: any) => r.score)).toEqual([200, 50]);
    expect(typeof body[0].createdAt).toBe("number");
  });

  it("지뢰찾기·반응속도는 낮은 값이 위", async () => {
    for (const time of [30, 12.5, 99]) await s.http("/api/rankings/minesweeper_rankings", { method: "POST", body: { name: "a", time } });
    expect((await s.http("/api/rankings/minesweeper_rankings")).body.map((r: any) => r.time)).toEqual([12.5, 30, 99]);
  });

  it("규칙 밖의 값은 거절 (범위·형식·여분 필드)", async () => {
    const post = (board: string, body: unknown) => s.http(`/api/rankings/${board}`, { method: "POST", body }).then((r) => r.status);
    expect(await post("score", { name: "a", score: 253 })).toBe(400);
    expect(await post("score", { name: "a", score: 1.5 })).toBe(400);
    expect(await post("score", { name: "", score: 1 })).toBe(400);
    expect(await post("score", { name: "a", score: 1, extra: 1 })).toBe(400);
    expect(await post("reaction", { name: "a", score: 79 })).toBe(400);
    expect(await post("minesweeper_rankings", { name: "a", time: 9 })).toBe(400);
    expect(await post("nope", { name: "a", score: 1 })).toBe(404);
  });

  it("AI 랭킹: 점수의 단계와 상대가 맞아야 함", async () => {
    const base = { name: "a", moves: 30, seconds: 100, lead: 5 };
    const post = (board: string, body: object) =>
      s.http(`/api/rankings/${board}`, { method: "POST", body: { ...base, ...body } }).then((r) => r.status);
    expect(await post("chess_ai_rankings", { score: 3_000_500, opp: "1200" })).toBe(200);
    expect(await post("chess_ai_rankings", { score: 3_000_500, opp: "800" })).toBe(400);
    expect(await post("chess_ai_rankings", { score: 500, opp: "400" })).toBe(400);
    expect(await post("janggi_ai_rankings", { score: 12_000_001, opp: "yisunsin" })).toBe(200);
    expect(await post("omok_ai_rankings", { score: 8_000_001, opp: "alpha" })).toBe(200);
    expect(await post("omok_ai_rankings", { score: 8_000_001, opp: "toString" })).toBe(400);
    expect(await post("fight_ai_rankings", { score: 3_000_001, opp: "3:kai>igna" })).toBe(200);
    expect(await post("fight_ai_rankings", { score: 3_000_001, opp: "4" })).toBe(400);
  });

  it("리듬게임: 곡·난이도별로 따로", async () => {
    const row = { name: "a", score: 900_000, acc: 98.12, maxCombo: 300, fc: true, ap: false };
    expect((await s.http("/api/rankings/rhythm/anima_hard", { method: "POST", body: row })).status).toBe(200);
    expect((await s.http("/api/rankings/rhythm/anima_easy", { method: "POST", body: { ...row, score: 1 } })).status).toBe(200);
    expect((await s.http("/api/rankings/rhythm/anima_weird", { method: "POST", body: row })).status).toBe(400);
    const { body } = await s.http("/api/rankings/rhythm/anima_hard");
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject(row);
    expect(body[0].chart).toBeUndefined();
  });
});

describe("방명록 · 문의 · 방문자", () => {
  it("방명록: 쓰면 구독자에게 목록이 다시 옴, 삭제는 관리자만", async () => {
    const c = await s.client();
    const sub = await c.sub("guest");
    expect(sub.data.list).toEqual([]);
    const res = await s.http("/api/guest", {
      method: "POST",
      body: { name: "건모", contents: "안녕", id: 1700000000000, date: "2026년 10월 6일  23:15", color: "mint" },
    });
    expect(res.status).toBe(200);
    const ev = await sub.wait((e) => e.t === "list");
    expect(ev.d.list).toHaveLength(1);
    expect(ev.d.list[0]).toMatchObject({ docId: res.body.docId, name: "건모", color: "mint" });
    expect(ev.d.s).toBeGreaterThan(sub.data.s);

    expect((await s.http(`/api/guest/${res.body.docId}`, { method: "DELETE" })).status).toBe(401);
    expect((await s.http(`/api/guest/${res.body.docId}`, { method: "DELETE", token: await s.token("someone") })).status).toBe(403);
    expect((await s.http(`/api/guest/${res.body.docId}`, { method: "DELETE", token: await s.adminToken() })).status).toBe(204);
    expect((await s.http("/api/guest")).body).toEqual([]);
  });

  it("문의: 누구나 작성, 조회·읽음 처리는 관리자만", async () => {
    const ok = { name: "a", email: "a@b.co", phone: "", message: "hi" };
    expect((await s.http("/api/inquiries", { method: "POST", body: ok })).status).toBe(204);
    expect((await s.http("/api/inquiries", { method: "POST", body: { ...ok, email: "nope" } })).status).toBe(400);
    expect((await s.http("/api/inquiries", { method: "POST", body: { ...ok, read: true } })).status).toBe(400);

    const guest = await s.client("visitor");
    await expect(guest.sub("inquiries")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const admin = await s.client("admin-uid", { email: "admin@example.com" });
    const sub = await admin.sub("inquiries");
    expect(sub.data.list).toHaveLength(1);
    expect(sub.data.list[0]).toMatchObject({ ...ok, read: false });
    const id = sub.data.list[0].id;
    expect((await s.http(`/api/inquiries/${id}`, { method: "PATCH", body: { read: true }, token: await s.adminToken() })).status).toBe(204);
    expect((await sub.wait()).d.list[0].read).toBe(true);
  });

  it("방문자 수: 누적과 일별", async () => {
    await s.http("/api/stats/visit", { method: "POST", body: { dateKey: "2026-10-06" } });
    await s.http("/api/stats/visit", { method: "POST", body: { dateKey: "2026-10-06" } });
    await s.http("/api/stats/visit", { method: "POST", body: { dateKey: "2026-10-07" } });
    expect((await s.http("/api/stats?date=2026-10-06")).body).toEqual({ total: 3, today: 2 });
    expect((await s.http("/api/stats?date=2026-10-08")).body).toEqual({ total: 3, today: 0 });
    expect((await s.http("/api/stats/visit", { method: "POST", body: { dateKey: "오늘" } })).status).toBe(400);
  });
});

describe("글 · 관리자 데이터", () => {
  it("글: 읽기는 공개, 쓰기는 관리자", async () => {
    const post = { title: "t", content: "<p>c</p>", category: "Java", date: "2026-10-6 1:5" };
    expect((await s.http("/api/study-posts", { method: "POST", body: post })).status).toBe(401);
    const admin = await s.adminToken();
    const { body } = await s.http("/api/study-posts", { method: "POST", body: post, token: admin });
    expect(body.id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect((await s.http(`/api/study-posts/${body.id}`)).body).toEqual({ id: body.id, ...post, section: "study" });
    await s.http(`/api/study-posts/${body.id}`, { method: "PATCH", body: { date: "2026-1-1 0:0", section: "retro" }, token: admin });
    expect((await s.http("/api/study-posts")).body[0]).toMatchObject({ section: "retro", date: "2026-1-1 0:0", title: "t" });
    expect((await s.http("/api/study-posts/none")).status).toBe(404);
    expect((await s.http(`/api/study-posts/${body.id}`, { method: "DELETE", token: admin })).status).toBe(204);
    expect((await s.http("/api/study-posts")).body).toEqual([]);
  });

  it("글이 바뀌면 프론트에 캐시 갱신을 알림 (설정돼 있을 때만)", async () => {
    const { createWebNotifier } = await import("../src/webNotify");
    const calls: { url: string; secret: string | null }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, secret: new Headers(init.headers).get("x-revalidate-secret") });
      return new Response("{}");
    }) as unknown as typeof fetch;
    const on = createWebNotifier({ webRevalidateUrl: "http://web:3000/internal/revalidate/", revalidateSecret: "s3" }, fake);
    await on.postsChanged();
    expect(calls).toEqual([{ url: "http://web:3000/internal/revalidate/", secret: "s3" }]);
    const off = createWebNotifier({ webRevalidateUrl: "", revalidateSecret: "" }, fake);
    await off.postsChanged();
    expect(calls).toHaveLength(1);
    // 알림이 실패해도 예외를 밖으로 던지지 않음
    const broken = createWebNotifier({ webRevalidateUrl: "http://x/", revalidateSecret: "s" }, (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch);
    await expect(broken.postsChanged()).resolves.toBeUndefined();
  });

  it("관리자 데이터: 조회·교체·삭제, 날짜는 __timestamp로 오감", async () => {
    const admin = await s.adminToken();
    await s.http("/api/rankings/reaction", { method: "POST", body: { name: "old", score: 300 } });
    expect((await s.http("/api/admin/docs?path=reaction")).status).toBe(401);
    const list = (await s.http("/api/admin/docs?path=reaction", { token: admin })).body;
    expect(list).toHaveLength(1);
    expect(list[0].data.createdAt.__timestamp).toMatch(/^\d{4}-/);
    const id = list[0].id;
    const put = await s.http("/api/admin/docs", {
      method: "PUT",
      token: admin,
      body: { path: "reaction", id, data: { name: "new", score: 250, createdAt: { __timestamp: "2020-01-02T03:04:05.000Z" } } },
    });
    expect(put.status).toBe(204);
    const row = (await s.http("/api/rankings/reaction")).body[0];
    expect(row).toMatchObject({ id, name: "new", score: 250, createdAt: Date.parse("2020-01-02T03:04:05.000Z") });
    expect((await s.http("/api/admin/docs?path=secret_stuff", { token: admin })).status).toBe(400);
    expect((await s.http("/api/admin/docs/delete", { method: "POST", token: admin, body: { path: "reaction", ids: [id] } })).status).toBe(204);
    expect((await s.http("/api/rankings/reaction")).body).toEqual([]);

    // 리듬게임은 곡·난이도 경로로
    await s.http("/api/rankings/rhythm/monarch_expert", { method: "POST", body: { name: "a", score: 5, acc: 1, maxCombo: 1, fc: false, ap: false } });
    const rh = (await s.http("/api/admin/docs?path=rhythm_rankings/monarch_expert/scores", { token: admin })).body;
    expect(rh).toHaveLength(1);
    expect(rh[0].data.chart).toBeUndefined();
    expect((await s.http("/api/admin/docs?path=rhythm_rankings/other_easy/scores", { token: admin })).body).toEqual([]);
  });
});
