import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plausible, rogueScore, type RogueReport } from "../../web/src/lib/rogue/rules";
import { startTestServer, type TestClient, type TestServer } from "./helpers";

const rep = (o: Partial<RogueReport> = {}): RogueReport => ({
  floor: 1,
  endFloor: 4,
  win: false,
  sec: 10,
  kills: 12,
  bosses: 0,
  items: 1,
  build: ["천풍난무", "붉은 노이즈"],
  secret: false,
  noHit: 0,
  cheats: 0,
  codex: 3,
  ch: 0,
  seed: 123,
  char: "kai",
  elites: 0,
  specials: 0,
  arcade: 0,
  unlocks: 0,
  ...o,
});

describe("픽셀 리셋 스토리 기록 규칙", () => {
  it("말이 되는 기록만", () => {
    expect(plausible(rep(), 60)).toBe(true);
    expect(plausible(rep({ floor: 4, endFloor: 4, win: true, bosses: 4, ch: 2, sec: 600 }), 700)).toBe(true);
    expect(plausible(rep({ sec: 200 }), 60)).toBe(false); // 서버가 잰 시간보다 김
    expect(plausible(rep({ floor: 5, endFloor: 4 }), 9999)).toBe(false); // 목표보다 깊음
    expect(plausible(rep({ floor: 3, endFloor: 4, win: true, bosses: 3, sec: 300 }), 9999)).toBe(false); // 목표 층 전에 클리어
    expect(plausible(rep({ floor: 3, bosses: 0, sec: 300 }), 9999)).toBe(false); // 보스 안 잡고 3층
    expect(plausible(rep({ floor: 2, bosses: 1, ch: 1, sec: 300 }), 9999)).toBe(false); // 챕터 보스 안 잡았는데 ch 1
    expect(plausible(rep({ kills: 5000, sec: 30 }), 9999)).toBe(false);
    expect(plausible(rep({ elites: 13 }), 9999)).toBe(false); // 처치보다 많은 엘리트
    expect(plausible(rep({ char: "igna", elites: 2, specials: 1, arcade: 5 }), 60)).toBe(true);
    expect(plausible(rep({ char: "lily", unlocks: 12 }), 60)).toBe(true);
    expect(plausible(rep({ unlocks: 999 }), 60)).toBe(false);
    expect(plausible(rep({ char: "dice", unlocks: 54 }), 60)).toBe(true);
  });
  it("랭킹 순서: 깊이 → 클리어 → 빠른 클리어 / 처치", () => {
    const deep = rogueScore({ floor: 5, win: false, sec: 2000, kills: 10 });
    const clear4 = rogueScore({ floor: 4, win: true, sec: 900, kills: 999 });
    const clear4slow = rogueScore({ floor: 4, win: true, sec: 1500, kills: 9999 });
    const die4 = rogueScore({ floor: 4, win: false, sec: 100, kills: 99_999 });
    expect(deep).toBeGreaterThan(clear4);
    expect(clear4).toBeGreaterThan(clear4slow);
    expect(clear4slow).toBeGreaterThan(die4);
  });
});

describe("픽셀 리셋 스토리 서버", () => {
  let srv: TestServer;
  let n = 0;
  async function member(): Promise<TestClient> {
    const uid = `rg${++n}`;
    const email = `${uid}@example.com`;
    const token = await srv.token(uid, { email });
    const r = await srv.http("/api/me/nick", { method: "PUT", token, body: { nick: `생존${n}` } });
    expect(r.status).toBe(200);
    return srv.client(uid, { email });
  }
  beforeAll(async () => {
    srv = await startTestServer();
  });
  afterAll(async () => {
    await srv.close();
  });

  it("별명 없으면 기록 안 됨", async () => {
    const c = await srv.client("rg-guest");
    await expect(c.rpc("rogue.start")).rejects.toMatchObject({ code: "MEMBER_ONLY" });
    c.close();
  });

  it("시작 → 끝 → 랭킹 · 업적 통계 · 새 업적 이름 · 같은 판 두 번 안 됨", async () => {
    const c = await member();
    const { run } = await c.rpc("rogue.start");
    const out = await c.rpc("rogue.finish", { run, rep: rep({ secret: true }) });
    expect(out.best).toBe(true);
    expect(out.rank).toBe(1);
    expect(out.ach).toEqual(expect.arrayContaining(["부팅 완료", "수상한 벽"]));
    await expect(c.rpc("rogue.finish", { run, rep: rep() })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const rows = await c.rpc("rogue.rank", { limit: 10 });
    expect(rows[0]).toMatchObject({ nick: "생존1", floor: 1, win: false, build: ["천풍난무", "붉은 노이즈"] });

    // 더 낮은 기록은 랭킹을 안 바꾸지만 통계는 쌓임
    const r2 = await c.rpc("rogue.start");
    const out2 = await c.rpc("rogue.finish", { run: r2.run, rep: rep({ kills: 3 }) });
    expect(out2.best).toBe(false);
    expect(out2.ach).toEqual([]);
    const u = (await srv.db.col("users").findOne({ _id: "rg1" } as never)) as { stats?: { rogue?: Record<string, number> } } | null;
    expect(u?.stats?.rogue).toMatchObject({ runs: 2, kills: 15, secrets: 1, codex: 3 });
    c.close();
  });

  it("이그나 판 · 예전 화면 기록(캐릭터 없음)", async () => {
    const c = await member();
    const { run } = await c.rpc("rogue.start");
    // 2층까지 간 120초짜리 판 → 서버가 잰 시작 시각도 그만큼 앞으로 (안 그러면 "잰 시간보다 긴 기록"으로 거절)
    await srv.db.col("rogue_runs").updateOne({ _id: run } as never, { $set: { startAt: Date.now() - 130_000 } });
    const out = await c.rpc("rogue.finish", { run, rep: rep({ char: "igna", elites: 3, specials: 1, arcade: 4, floor: 2, bosses: 1, sec: 120, kills: 40 }) });
    expect(out.ach).toEqual(expect.arrayContaining(["얼음을 녹인 불꽃"]));
    const rows = await c.rpc("rogue.rank", { limit: 10 });
    expect(rows.find((r: { nick: string }) => r.nick === "생존2")).toMatchObject({ char: "igna", floor: 2 });
    const r2 = await c.rpc("rogue.start");
    const old = Object.fromEntries(Object.entries(rep({ kills: 1 })).filter(([k]) => !["char", "elites", "specials", "arcade"].includes(k)));
    await c.rpc("rogue.finish", { run: r2.run, rep: old });
    const u = (await srv.db.col("users").findOne({ _id: "rg2" } as never)) as { stats?: { rogue?: Record<string, number> } } | null;
    expect(u?.stats?.rogue).toMatchObject({ ignaRuns: 1, elites: 3, specials: 1, arcade: 4 });
    c.close();
  });

  it("말이 안 되는 기록은 거절", async () => {
    const c = await member();
    const { run } = await c.rpc("rogue.start");
    await expect(c.rpc("rogue.finish", { run, rep: rep({ floor: 4, endFloor: 4, win: true, bosses: 4, ch: 2, sec: 900 }) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    c.close();
  });
});
