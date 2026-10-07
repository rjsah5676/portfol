import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOUD_SOURCES, createCloudIps, fetchCloudLists } from "../src/cloudIps";
import { classify, createTraffic, envOf, kstDate, regionLabel, summarize, widthBucket, type HitDoc } from "../src/traffic";
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
    expect(classify("https://gunmo-portfolio.firebaseapp.com/", {}, OWN, "")).toMatchObject({ source: "legacy", site: "firebase" });
    expect(classify("https://gunmo-portfolio.web.app/x", {}, OWN, "")).toMatchObject({ source: "legacy", site: "firebase" });
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

describe("클라우드 IP", () => {
  it("업체별 공개 목록 형식 읽기", () => {
    const by = Object.fromEntries(CLOUD_SOURCES.map((x) => [x.name, x.parse]));
    expect(by.AWS(JSON.stringify({ prefixes: [{ ip_prefix: "3.0.0.0/15" }], ipv6_prefixes: [{ ipv6_prefix: "2600:1f00::/24" }] }))).toEqual(["3.0.0.0/15", "2600:1f00::/24"]);
    expect(by.GCP(JSON.stringify({ prefixes: [{ ipv4Prefix: "34.1.208.0/20" }, { ipv6Prefix: "2600:1900::/35" }] }))).toEqual(["34.1.208.0/20", "2600:1900::/35"]);
    expect(by.Azure(JSON.stringify({ values: [{ name: "AzureCloud", properties: { addressPrefixes: ["4.144.0.0/12"] } }, { name: "Other", properties: { addressPrefixes: ["9.9.9.9/32"] } }] }))).toEqual(["4.144.0.0/12"]);
    expect(by.Oracle(JSON.stringify({ regions: [{ cidrs: [{ cidr: "129.146.0.0/21" }] }] }))).toEqual(["129.146.0.0/21"]);
    expect(by.DigitalOcean("5.101.96.0/21,NL,NL-NH,Amsterdam,1098 XH\n2a03:b0c0::/32,NL,,,\n")).toEqual(["5.101.96.0/21", "2a03:b0c0::/32"]);
  });

  it("IP → 업체 (IPv4 · IPv6 · 겹친 대역 · 목록 없음)", () => {
    const c = createCloudIps();
    expect(c.lookup("34.248.137.227")).toBeNull();
    c.set({ AWS: ["34.240.0.0/13", "34.248.0.0/16", "54.198.0.0/16", "2600:1f00::/24", "bad", "1.2.3.4/40"], GCP: ["35.190.0.0/17"] });
    expect(c.counts()).toEqual({ AWS: 4, GCP: 1 });
    expect(c.lookup("34.248.137.227")).toBe("AWS");
    expect(c.lookup("54.198.174.208")).toBe("AWS");
    expect(c.lookup("35.190.1.1")).toBe("GCP");
    expect(c.lookup("35.190.128.1")).toBe("");
    expect(c.lookup("121.134.1.1")).toBe("");
    expect(c.lookup("::ffff:34.248.1.1")).toBe("");
    expect(c.lookup("2600:1f18:abcd::1")).toBe("AWS");
    expect(c.lookup("2001:db8::1")).toBe("");
    expect(c.lookup("not-ip")).toBe("");
  });

  it("받아오기: 실패한 업체는 빠지고 이유가 남음", async () => {
    const r = await fetchCloudLists([
      { name: "A", url: async () => "1.0.0.0/8", parse: (b) => [b] },
      { name: "B", url: async () => { throw new Error("막힘"); }, parse: () => [] },
      { name: "C", url: async () => "", parse: () => [] },
    ]);
    expect(r.lists).toEqual({ A: ["1.0.0.0/8"] });
    expect(r.errors.sort()).toEqual(["B: 막힘", "C: 빈 목록"]);
  });

  it("하루 집계에 사람만(클라우드 뺀) 집계가 같이 붙음", () => {
    const base = { day: "2026-10-02", returning: false, device: "desktop", os: "Linux", browser: "Chrome", inapp: "", sw: "~1920", lang: "en", tz: "", country: "IE", region: "", city: "", member: false, ua: "", hour: 20, at: new Date() } as const;
    const s = summarize("2026-10-02", [
      { ...base, _id: "1", sid: "a", entry: true, path: "/", source: "direct", site: "", vh: "x", cloud: "AWS" },
      { ...base, _id: "2", sid: "b", entry: true, path: "/", source: "direct", site: "", vh: "y", cloud: "" },
      { ...base, _id: "3", sid: "c", entry: true, path: "/", source: "direct", site: "", vh: "z" },
    ] as HitDoc[]);
    expect(s.entries).toBe(3);
    expect(s.dims.cloud).toEqual([["AWS", 1]]);
    expect(s.human).toMatchObject({ entries: 2, hits: 2 });
    expect(s.human!.dims.cloud).toEqual([]);
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
    expect(await s.db.col("traffic_hits").findOne({ sid: "sess_member01" })).toMatchObject({ member: true, uid: "tm1" });
    // 비회원 기록에는 uid 없음
    expect((await s.db.col("traffic_hits").findOne({ sid: "sess_abcdef01" }))?.uid).toBeUndefined();
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
    expect(body.recent.find((r: any) => r.member)).toMatchObject({ nick: "유입회원" });
    expect(body.recent.filter((r: any) => !r.member).every((r: any) => r.nick === "")).toBe(true);
    const naver = body.recent.find((r: any) => r.site === "Naver");
    expect(naver).toMatchObject({ source: "search", term: "gunmo", pages: 2, ip: "127.0.0.1", device: "mobile" });

    // 지난 날짜는 집계를 저장해 둠
    expect(await s.db.col("traffic_daily").countDocuments({ _id: from })).toBe(1);
    expect(await s.db.col("traffic_daily").countDocuments({ _id: today })).toBe(0);

    const ov = (await s.http("/api/admin/overview", { token: admin })).body;
    expect(ov.traffic).toMatchObject({ entries: 3, hits: 4 });
    expect(ov.traffic.top).toHaveLength(3);
  });

  it("클라우드 IP 표시 · 사람만 보기 · 목록 받은 뒤 예전 기록에도 표시 · 옛 Firebase 주소 고치기", async () => {
    const day = kstDate(Date.now() - 2 * 86_400_000);
    const base = { at: new Date(Date.now() - 2 * 86_400_000), day, hour: 3, entry: true, returning: false, path: "/", source: "direct", site: "", device: "desktop", os: "Linux", browser: "Chrome", inapp: "", sw: "", lang: "", tz: "", country: "", region: "", city: "", member: false, ua: "" };
    await s.db.col("traffic_hits").insertMany([
      { ...base, _id: "c1", sid: "sess_cloud001", ip: "34.248.137.227", vh: "c1" },
      { ...base, _id: "c2", sid: "sess_cloud002", ip: "121.134.1.1", vh: "c2" },
      { ...base, _id: "c3", sid: "sess_cloud003", ip: "54.198.174.208", vh: "c3", source: "referral", site: "gunmo-portfolio.firebaseapp.com", refHost: "gunmo-portfolio.firebaseapp.com" },
    ] as never);
    // 앞 테스트가 이 날짜를 (빈 날로) 집계해 저장해 뒀을 수 있음 → 지우고 시작 (테스트끼리 서로 안 물리게)
    await s.db.col("traffic_daily").deleteOne({ _id: day } as never);
    // 목록 없을 때 본 그날 집계 → 저장됨
    const before = (await s.http(`/api/admin/traffic?from=${day}&to=${day}&human=1`, { token: admin })).body;
    expect(before.total.entries).toBe(3);
    expect(before.cloud).toMatchObject({ entries: 0, loaded: false });

    const t = createTraffic(s.db, { geo: false, cloud: true, fetchLists: async () => ({ lists: { AWS: ["34.240.0.0/13", "34.248.0.0/16", "54.198.0.0/16"] }, errors: ["Azure: 막힘"] }) });
    await t.maintain();
    const docs = await s.db.col("traffic_hits").find({ _id: { $in: ["c1", "c2", "c3"] } }).sort({ _id: 1 }).toArray();
    expect(docs.map((d) => d.cloud)).toEqual(["AWS", "", "AWS"]);
    expect(docs[2]).toMatchObject({ source: "legacy", site: "firebase" });
    expect((await s.db.col("traffic_meta").findOne({ _id: "cloud" }))?.lists.AWS).toHaveLength(2);

    // 집계를 지우고 다시 만듦 → 전체 3 · 사람만 1
    const all = (await t.range(day, day)).total.entries;
    const human = await t.range(day, day, { human: true });
    expect(all).toBe(3);
    expect(human.total.entries).toBe(1);
    expect(human.cloud).toMatchObject({ entries: 2, loaded: true, counts: { AWS: 2 }, errors: ["Azure: 막힘"] });
    expect(human.recent.map((r) => r.ip)).toEqual(["121.134.1.1"]);
    const full = await t.range(day, day);
    expect(full.recent.filter((r) => r.cloud === "AWS")).toHaveLength(2);
    expect(full.dims.source).toEqual(expect.arrayContaining([["legacy", 1]]));

    // 새 traffic 객체도 저장된 목록으로 바로 표시 (다시 받지 않음)
    let fetched = 0;
    const t2 = createTraffic(s.db, { geo: false, cloud: true, fetchLists: async () => (fetched++, { lists: {}, errors: [] }) });
    await t2.maintain();
    expect(fetched).toBe(0);
    await t2.record({ sid: "sess_cloud004", path: "/", entry: true, returning: false }, { ip: "34.248.1.1", ua: WIN_CHROME, member: false, ownHosts: OWN });
    expect((await s.db.col("traffic_hits").findOne({ sid: "sess_cloud004" }))?.cloud).toBe("AWS");
    await s.db.col("traffic_hits").deleteMany({ _id: { $in: ["c1", "c2", "c3"] } });
    await s.db.col("traffic_hits").deleteMany({ sid: "sess_cloud004" });
  });

  it("회원을 지우면 유입 기록의 uid 도 뗌", async () => {
    const token = await s.token("tm2", { email: "tm2@example.com" });
    expect((await s.http("/api/me/nick", { method: "PUT", token, body: { nick: "지울회원" } })).status).toBe(200);
    expect(await track({ sid: "sess_member02", path: "/", entry: true, returning: false }, WIN_CHROME, token)).toBe(204);
    expect((await s.db.col("traffic_hits").findOne({ sid: "sess_member02" }))?.uid).toBe("tm2");
    expect((await s.http("/api/admin/users/tm2", { method: "DELETE", token: admin })).status).toBe(200);
    const doc = await s.db.col("traffic_hits").findOne({ sid: "sess_member02" });
    expect(doc?.uid).toBeUndefined();
    expect(doc?.member).toBe(true);
    await s.db.col("traffic_hits").deleteMany({ sid: "sess_member02" });
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
