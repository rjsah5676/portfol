import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultCharts, fromFirestoreValue, importFirestore } from "../scripts/import-firestore";
import { startTestServer, type TestServer } from "./helpers";

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

const BASE = "https://firestore.googleapis.com/v1/projects/p1/databases/(default)/documents";
const doc = (path: string, fields: Record<string, unknown>, createTime = "2024-05-06T07:08:09.123456Z") => ({
  name: `projects/p1/databases/(default)/documents/${path}`,
  fields,
  createTime,
  updateTime: createTime,
});
const str = (v: string) => ({ stringValue: v });
const int = (v: number) => ({ integerValue: String(v) });
const dbl = (v: number) => ({ doubleValue: v });
const ts = (v: string) => ({ timestampValue: v });

/** 가짜 Firestore: 경로 → 페이지들 */
function fakeFirestore(pages: Record<string, { documents?: unknown[] }[]>, extra: Record<string, () => Response> = {}) {
  const calls: { url: string; auth: string | null }[] = [];
  const fn = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({ url: input, auth: new Headers(init?.headers).get("authorization") });
    if (extra[url.origin + url.pathname]) return extra[url.origin + url.pathname]();
    const path = decodeURIComponent(url.href.split("?")[0]).replace(`${BASE}/`, "");
    const list = pages[path];
    if (!list) return new Response("{}", { status: 200 });
    const i = Number(url.searchParams.get("pageToken") ?? 0);
    return Response.json({ ...list[i], ...(i + 1 < list.length ? { nextPageToken: String(i + 1) } : {}) });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("Firestore → MongoDB 이전", () => {
  it("값 타입 변환", () => {
    expect(fromFirestoreValue(int(42))).toBe(42);
    expect(fromFirestoreValue(dbl(1.5))).toBe(1.5);
    expect(fromFirestoreValue({ booleanValue: true })).toBe(true);
    expect(fromFirestoreValue({ nullValue: null })).toBeNull();
    expect(fromFirestoreValue(ts("2026-01-02T03:04:05Z"))).toEqual(new Date("2026-01-02T03:04:05Z"));
    expect(
      fromFirestoreValue({ mapValue: { fields: { a: int(1), b: { arrayValue: { values: [str("x"), int(2)] } } } } })
    ).toEqual({ a: 1, b: ["x", 2] });
    expect(fromFirestoreValue({ arrayValue: {} })).toEqual([]);
  });

  it("리듬게임 차트 목록은 프론트 채보 파일에서 가져옴", () => {
    const charts = defaultCharts();
    expect(charts).toContain("jilju_easy");
    expect(charts).toContain("anima_nightmare");
    expect(charts.length % 5).toBe(0);
  });

  it("옮긴 데이터가 서버 API에서 원래와 같은 모양으로 읽히고, 다시 실행해도 중복되지 않음", async () => {
    const { fn, calls } = fakeFirestore({
      // 두 쪽에 걸친 목록
      score: [
        { documents: [doc("score/a1", { name: str("건모"), score: int(200), createdAt: ts("2026-10-01T00:00:00Z") })] },
        // 날짜 필드가 없는 예전 기록 → 문서 생성 시각으로 채워짐
        { documents: [doc("score/a2", { name: str("옛날"), score: int(120) }, "2021-07-08T09:10:11Z")] },
      ],
      minesweeper_rankings: [{ documents: [doc("minesweeper_rankings/m1", { name: str("건모"), time: dbl(41.25) })] }],
      "rhythm_rankings/jilju_hard/scores": [
        {
          documents: [
            doc("rhythm_rankings/jilju_hard/scores/r1", {
              name: str("건모"),
              score: int(987654),
              acc: dbl(98.76),
              maxCombo: int(432),
              fc: { booleanValue: true },
              ap: { booleanValue: false },
              createdAt: ts("2026-10-02T00:00:00Z"),
            }),
          ],
        },
      ],
      guest: [
        {
          documents: [
            doc("guest/g1", { name: str("방문자"), contents: str("안녕하세요"), id: int(1790000000000), date: str("2026년 9월 21일  23:13"), color: str("mint") }),
            doc("guest/g2", { name: str("옛글"), contents: str("예전 메모"), id: int(12), date: str("2021년 7월 8일  9:05") }),
          ],
        },
      ],
      siteStats: [{ documents: [doc("siteStats/total", { count: int(4321) }), doc("siteStats/daily_2026-10-06", { count: int(17) })] }],
      studyPosts: [
        {
          documents: [
            doc("studyPosts/AbCdEf0123456789XyZw", {
              title: str("제목"),
              content: str("<p>본문</p>"),
              category: str("Java"),
              date: str("2026-10-4 1:40"),
              section: str("retro"),
            }),
            // section 이 없던 예전 글
            doc("studyPosts/OldPost0000000000000", { title: str("예전 글"), content: str("<p>x</p>"), category: str("etc"), date: str("2025-1-3 9:5") }),
          ],
        },
      ],
    });

    const run = () => importFirestore(s.db.db, { project: "p1", apiKey: "k", charts: ["jilju_hard", "anima_easy"], fetch: fn });
    const first = await run();
    expect(first.errors).toEqual({});
    expect(first.skipped).toEqual(["inquiries"]);
    expect(first.counts).toMatchObject({ score: 2, minesweeper_rankings: 1, rhythm_rankings: 1, guest: 2, siteStats: 2, studyPosts: 2 });
    // 목록 요청에 API 키와 페이지 토큰이 실림
    expect(calls.some((c) => c.url.includes("/score?") && c.url.includes("key=k") && c.url.includes("pageToken=1"))).toBe(true);

    const second = await run();
    expect(second.counts).toEqual(first.counts);
    expect(await s.db.col("score").countDocuments()).toBe(2);
    expect(await s.db.col("rhythm_rankings").countDocuments()).toBe(1);

    // ── 서버 API로 읽기 ──
    const scores = (await s.http("/api/rankings/score")).body;
    expect(scores).toEqual([
      { id: "a1", name: "건모", score: 200, createdAt: Date.parse("2026-10-01T00:00:00Z") },
      { id: "a2", name: "옛날", score: 120, createdAt: Date.parse("2021-07-08T09:10:11Z") },
    ]);
    expect((await s.http("/api/rankings/minesweeper_rankings")).body[0]).toMatchObject({ id: "m1", time: 41.25 });
    expect((await s.http("/api/rankings/rhythm/jilju_hard")).body).toEqual([
      { id: "r1", name: "건모", score: 987654, acc: 98.76, maxCombo: 432, fc: true, ap: false, createdAt: Date.parse("2026-10-02T00:00:00Z") },
    ]);
    expect((await s.http("/api/guest")).body).toEqual([
      { docId: "g1", name: "방문자", contents: "안녕하세요", id: 1790000000000, date: "2026년 9월 21일  23:13", color: "mint" },
      { docId: "g2", name: "옛글", contents: "예전 메모", id: 12, date: "2021년 7월 8일  9:05" },
    ]);
    expect((await s.http("/api/stats?date=2026-10-06")).body).toEqual({ total: 4321, today: 17 });
    const posts = (await s.http("/api/study-posts")).body;
    expect(posts).toHaveLength(2);
    expect(posts.find((p: any) => p.id === "AbCdEf0123456789XyZw")).toEqual({
      id: "AbCdEf0123456789XyZw",
      title: "제목",
      content: "<p>본문</p>",
      category: "Java",
      date: "2026-10-4 1:40",
      section: "retro",
    });
    expect(posts.find((p: any) => p.id === "OldPost0000000000000").section).toBeUndefined();
  });

  it("문의는 관리자 로그인 토큰으로 읽고, 실패한 컬렉션이 있어도 나머지는 계속 옮김", async () => {
    const { fn, calls } = fakeFirestore(
      {
        inquiries: [
          {
            documents: [
              doc("inquiries/q1", {
                name: str("홍길동"),
                email: str("a@b.co"),
                phone: str(""),
                message: str("문의합니다"),
                read: { booleanValue: false },
                createdAt: ts("2026-10-05T12:00:00Z"),
              }),
            ],
          },
        ],
        reaction: [{ documents: [doc("reaction/x1", { name: str("z"), score: int(250) })] }],
      },
      {
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword": () => Response.json({ idToken: "ADMIN_TOKEN" }),
        [`${BASE}/guest`]: () => new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 }),
      }
    );
    const res = await importFirestore(s.db.db, {
      project: "p1",
      apiKey: "k",
      charts: [],
      only: ["guest", "reaction", "inquiries"],
      adminEmail: "admin@example.com",
      adminPassword: "pw",
      fetch: fn,
    });
    expect(Object.keys(res.errors)).toEqual(["guest"]);
    expect(res.errors.guest).toContain("403");
    expect(res.counts).toMatchObject({ reaction: 1, inquiries: 1 });
    expect(calls.find((c) => c.url.includes("/inquiries?"))?.auth).toBe("Bearer ADMIN_TOKEN");
    // --only 에 없는 컬렉션은 요청하지 않음
    expect(calls.some((c) => c.url.includes("/score?"))).toBe(false);

    const admin = await s.client("admin-uid", { email: "admin@example.com" });
    const inbox = (await admin.sub("inquiries")).data.list;
    expect(inbox).toEqual([
      { id: "q1", name: "홍길동", email: "a@b.co", phone: "", message: "문의합니다", read: false, createdAt: Date.parse("2026-10-05T12:00:00Z") },
    ]);
  });

  it("dry-run 은 DB에 쓰지 않음", async () => {
    const { fn } = fakeFirestore({ omok_ai_rankings: [{ documents: [doc("omok_ai_rankings/o1", { name: str("a"), score: int(2000001) })] }] });
    const res = await importFirestore(null as never, { project: "p1", apiKey: "k", charts: [], only: ["omok_ai_rankings"], dryRun: true, fetch: fn });
    expect(res.counts.omok_ai_rankings).toBe(1);
    expect(await s.db.col("omok_ai_rankings").countDocuments()).toBe(0);
  });
});
