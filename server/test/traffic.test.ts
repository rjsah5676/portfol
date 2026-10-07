import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classify, envOf, kstDate, regionLabel, summarize, widthBucket, type HitDoc } from "../src/traffic";
import { startTestServer, type TestServer } from "./helpers";

const IPHONE_KAKAO =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5";
const WIN_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const OWN = ["gunmo.my", "www.gunmo.my"];

describe("유입 경로 분류", () => {
  it("검색 · AI · SNS · 옛 주소 · 사이트 안 · 다른 사이트 · 직접 · 캠페인", () => {
    expect(classify("https://search.naver.com/search.naver?query=%EC%9D%B4%EA%B1%B4%EB%AA%A8", {}, OWN, "")).toEqual({
      source: "search",
      site: "Naver",
      refHost: "search.naver.com",
      term: "이건모",
    });
    expect(classify("https://www.google.co.kr/", {}, OWN, "")).toMatchObject({ source: "search", site: "Google" });
    expect(classify("https://www.google.com/", {}, OWN, "").term).toBeUndefined();
    expect(classify("https://gemini.google.com/app", {}, OWN, "")).toMatchObject({ source: "ai", site: "Gemini" });
    expect(classify("https://chatgpt.com/", {}, OWN, "")).toMatchObject({ source: "ai", site: "ChatGPT" });
    expect(classify("https://t.co/abc", {}, OWN, "")).toMatchObject({ source: "social", site: "X" });
    expect(classify("https://l.instagram.com/", {}, OWN, "")).toMatchObject({ source: "social", site: "Instagram" });
    expect(classify("https://rjsah5676.github.io/", {}, OWN, "")).toMatchObject({ source: "legacy", site: "github.io" });
    expect(classify("https://gunmo.my/games/", {}, OWN, "")).toMatchObject({ source: "internal" });
    expect(classify("https://m.blog.naver.com/x/1", {}, OWN, "")).toMatchObject({ source: "referral", site: "blog.naver.com" });
    expect(classify("", {}, OWN, "")).toEqual({ source: "direct", site: "", refHost: "" });
    // 카톡에서 링크를 누르면 리퍼러가 비어 있음 → 인앱 표시로 카카오톡
    expect(classify("", {}, OWN, "카카오톡")).toMatchObject({ source: "social", site: "KakaoTalk" });
    // UTM 이 있으면 리퍼러보다 우선
    expect(classify("https://t.co/x", { source: "Resume", campaign: "2026" }, OWN, "")).toMatchObject({ source: "campaign", site: "resume" });
    expect(classify("javascript:alert(1)", {}, OWN, "")).toMatchObject({ source: "direct" });
  });

  it("기기 · OS · 브라우저 · 인앱, 화면 구간, 지역 이름", () => {
    expect(envOf(IPHONE_KAKAO)).toEqual({ device: "mobile", os: "iOS", browser: "KAKAOTALK", inapp: "카카오톡" });
    expect(envOf(WIN_CHROME)).toEqual({ device: "desktop", os: "Windows", browser: "Chrome", inapp: "" });
    expect([widthBucket(0), widthBucket(390), widthBucket(1440), widthBucket(2560)]).toEqual(["", "~480", "~1440", "1920~"]);
    expect([regionLabel("KR", "11"), regionLabel("KR", ""), regionLabel("US", "CA"), regionLabel("", "")]).toEqual(["서울", "", "US-CA", ""]);
  });

  it("하루 집계: 유입 · 페이지 · 이탈 · 시간대", () => {
    const base = { day: "2026-10-01", returning: false, device: "mobile", os: "iOS", browser: "Safari", inapp: "", sw: "~480", lang: "ko-KR", tz: "", country: "KR", region: "11", city: "", member: false, ua: "" } as const;
    const docs = [
      { ...base, _id: "1", at: new Date(), hour: 9, sid: "a", entry: true, path: "/", source: "search", site: "Naver", term: "포트폴리오", vh: "x" },
      { ...base, _id: "2", at: new Date(), hour: 9, sid: "a", entry: false, path: "/games/", vh: "x" },
      { ...base, _id: "3", at: new Date(), hour: 21, sid: "b", entry: true, path: "/study/", source: "direct", site: "", vh: "y", returning: true },
    ] as HitDoc[];
    const s = summarize("2026-10-01", docs);
    expect(s).toMatchObject({ hits: 3, entries: 2, uniques: 2, bounces: 1, returning: 1 });
    expect(s.hours[9]).toBe(1);
    expect(s.hours[21]).toBe(1);
    expect(s.dims.source).toEqual([["direct", 1], ["search", 1]]);
    expect(s.dims.site).toEqual([["", 1], ["Naver", 1]]);
    expect(s.dims.term).toEqual([["포트폴리오", 1]]);
    expect(s.dims.landing.map((x) => x[0]).sort()).toEqual(["/", "/study/"]);
    expect(s.dims.page).toHaveLength(3);
    expect(s.dims.region).toEqual([["서울", 2]]);
    expect(s.dims.lang).toEqual([["ko", 2]]);
  });
});

describe("유입 기록 API", () => {
  let s: TestServer;
  let admin: string;
  beforeAll(async () => {
    s = await startTestServer();
    admin = await s.adminToken();
  });
  afterAll(() => s.close());

  async function track(body: object, ua = WIN_CHROME, token?: string) {
    const res = await fetch(`${s.url}/api/track`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": ua, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return res.status;
  }
  const today = kstDate(Date.now());

  it("유입과 페이지 이동을 기록하고, 봇 · 관리자 · /admin 은 건너뜀", async () => {
    const sid = "sess_abcdef01";
    expect(await track({ sid, path: "/", entry: true, returning: false, ref: "https://search.naver.com/search.naver?query=gunmo", screen: { w: 390, h: 844 }, lang: "ko-KR", tz: "Asia/Seoul" }, IPHONE_KAKAO)).toBe(204);
    expect(await track({ sid, path: "/games/", entry: false, returning: false })).toBe(204);
    expect(await track({ sid: "sess_bot00001", path: "/", entry: true, returning: false }, GOOGLEBOT)).toBe(204);
    expect(await track({ sid: "sess_admin001", path: "/", entry: true, returning: false }, WIN_CHROME, admin)).toBe(204);
    expect(await track({ sid: "sess_other001", path: "/admin/", entry: true, returning: false })).toBe(204);
    expect(await track({ sid: "x", path: "/", entry: true, returning: false })).toBe(400);
    expect(await track({ sid, path: "no-slash", entry: true, returning: false })).toBe(400);

    const docs = await s.db.col("traffic_hits").find({}).sort({ at: 1 }).toArray();
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({ entry: true, source: "search", site: "Naver", term: "gunmo", device: "mobile", inapp: "카카오톡", screen: "390x844", sw: "~480", day: today });
    expect(docs[0].ip).toBe("127.0.0.1");
    expect(docs[0].vh).toMatch(/^[0-9a-f]{20}$/);
    expect(docs[1]).toMatchObject({ entry: false, path: "/games/" });
    expect(docs[1].source).toBeUndefined();
    // 같은 날 같은 IP·브라우저 → 같은 해시
    const again = await track({ sid: "sess_abcdef02", path: "/", entry: true, returning: true }, IPHONE_KAKAO);
    expect(again).toBe(204);
    const [a, b] = await s.db.col("traffic_hits").find({ entry: true }).sort({ at: 1 }).toArray();
    expect(b.vh).toBe(a.vh);
  });

  it("회원이면 member 표시", async () => {
    const token = await s.token("tm1", { email: "tm1@example.com" });
    expect((await s.http("/api/me/nick", { method: "PUT", token, body: { nick: "유입회원" } })).status).toBe(200);
    expect(await track({ sid: "sess_member01", path: "/about/", entry: true, returning: false }, WIN_CHROME, token)).toBe(204);
    expect(await s.db.col("traffic_hits").findOne({ sid: "sess_member01" })).toMatchObject({ member: true });
  });

  it("관리자 집계: 기간 · 항목 · 히트맵 · 최근 유입(IP 포함), 개요의 오늘 유입", async () => {
    expect((await s.http(`/api/admin/traffic?from=${today}&to=${today}`)).status).toBe(401);
    expect((await s.http(`/api/admin/traffic?from=${today}&to=2020-01-01`, { token: admin })).status).toBe(400);
    expect((await s.http(`/api/admin/traffic?from=2020-01-01&to=${today}`, { token: admin })).status).toBe(400);

    const from = kstDate(Date.now() - 6 * 86_400_000);
    const { status, body } = await s.http(`/api/admin/traffic?from=${from}&to=${today}`, { token: admin });
    expect(status).toBe(200);
    expect(body.days).toHaveLength(7);
    expect(body.days[6]).toMatchObject({ date: today, entries: 3, hits: 4, members: 1 });
    expect(body.total).toMatchObject({ entries: 3, hits: 4, returning: 1 });
    // 직접 접속 · 카톡(리퍼러 없음) · 네이버 검색
    expect(body.dims.site).toEqual([["", 1], ["KakaoTalk", 1], ["Naver", 1]]);
    expect(body.dims.inapp).toEqual([["카카오톡", 2]]);
    expect(body.heat).toHaveLength(7);
    expect(body.heat.flat().reduce((x: number, y: number) => x + y, 0)).toBe(3);
    expect(body.recent).toHaveLength(3);
    const naver = body.recent.find((r: any) => r.site === "Naver");
    expect(naver).toMatchObject({ source: "search", term: "gunmo", pages: 2, ip: "127.0.0.1", device: "mobile" });

    // 지난 날짜는 집계를 저장해 둠
    expect(await s.db.col("traffic_daily").countDocuments({ _id: from })).toBe(1);
    expect(await s.db.col("traffic_daily").countDocuments({ _id: today })).toBe(0);

    const ov = (await s.http("/api/admin/overview", { token: admin })).body;
    expect(ov.traffic).toMatchObject({ entries: 3, hits: 4 });
    expect(ov.traffic.top).toHaveLength(3);
  });

  it("정리 작업: 30일 지난 원본 IP 를 지움", async () => {
    const old = new Date(Date.now() - 31 * 86_400_000);
    await s.db.col("traffic_hits").insertOne({ _id: "old1", at: old, day: kstDate(old.getTime()), hour: 1, sid: "sess_old00001", entry: true, path: "/", ip: "1.2.3.4", vh: "z" } as never);
    // 서버 안의 traffic 객체로 직접 실행 (타이머는 테스트에서 꺼져 있음)
    const { createTraffic } = await import("../src/traffic");
    await createTraffic(s.db, { geo: false }).maintain();
    const doc = await s.db.col("traffic_hits").findOne({ _id: "old1" });
    expect(doc?.ip).toBeUndefined();
    expect((await s.db.col("traffic_hits").findOne({ sid: "sess_abcdef01" }))?.ip).toBe("127.0.0.1");
  });
});
