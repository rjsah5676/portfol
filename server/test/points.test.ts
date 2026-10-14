import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ATTEND_POINTS, POKER_EXCHANGE, achievementOf, dailyMission, shopFor } from "../../web/src/lib/points";
import { START_MONEY } from "../../web/src/lib/poker/rules";
import type { Wallet } from "../../web/src/lib/poker/types";
import { RpcError, sleep, startTestServer, type TestClient, type TestServer } from "./helpers";

/*
 * 포인트: 출석(하루 한 번) · 업적(서버가 기록으로 확인, 한 번만) · 포커 상점(포인트로 구매) · 환전(칩 ↔ 포인트, 앉아 있으면 안 됨)
 * · 칩 업적은 환전으로 받은 칩을 뺌 · 관리자 조정 · 원장.
 */

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.close();
});

async function until(cond: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`시간 초과: ${what}`);
    await sleep(30);
  }
}

let n = 0;
async function member(): Promise<{ uid: string; token: string; c: TestClient }> {
  const uid = `pt${++n}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `${uid}@example.com`;
  const token = await srv.token(uid, { email });
  const r = await srv.http("/api/me/nick", { method: "PUT", token, body: { nick: `포인트${n}${uid.slice(-3)}` } });
  expect(r.status).toBe(200);
  return { uid, token, c: await srv.client(uid, { email }) };
}
const users = () => srv.db.col("users");
const set = (uid: string, v: Record<string, unknown>) => users().updateOne({ _id: uid }, { $set: v });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof RpcError ? e.code : `THROWN:${String(e)}`;
  }
};

describe("포인트", () => {
  it("출석: /api/me 에서 하루 한 번만 200P (여러 번 불러도)", async () => {
    const a = await member();
    const r1 = await srv.http("/api/me", { token: a.token });
    expect(r1.body.attended).toBe(ATTEND_POINTS);
    expect(r1.body.points).toBe(ATTEND_POINTS);
    const rs = await Promise.all([1, 2, 3].map(() => srv.http("/api/me", { token: a.token })));
    expect(rs.every((r) => !r.body.attended && r.body.points === ATTEND_POINTS)).toBe(true);
    const p = await srv.http("/api/points", { token: a.token });
    expect(p.body).toMatchObject({ points: ATTEND_POINTS, attendedToday: true });
    expect(p.body.log[0]).toMatchObject({ delta: ATTEND_POINTS, reason: "attend", bal: ATTEND_POINTS });
    // 다음 날이면 또
    await set(a.uid, { pointsDay: "2000-01-01" });
    expect((await srv.http("/api/me", { token: a.token })).body.points).toBe(ATTEND_POINTS * 2);
  });

  it("업적: 달성 전엔 못 받고, 달성하면 한 번만 (동시에 눌러도)", async () => {
    const a = await member();
    const id = "poker.hands-100";
    const claim = () => srv.http(`/api/points/achievements/${id}/claim`, { method: "POST", token: a.token });
    expect((await claim()).body.error.code).toBe("NOT_YET");
    await set(a.uid, { "stats.poker.hands": 120, points: 0 });
    const list = (await srv.http("/api/points/achievements/poker", { token: a.token })).body.list as { id: string; value: number; claimedAt: number | null }[];
    expect(list.find((x) => x.id === id)).toMatchObject({ value: 120, claimedAt: null });
    const rs = await Promise.all([claim(), claim(), claim()]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.body?.error?.code === "CLAIMED")).toHaveLength(2);
    expect(((await users().findOne({ _id: a.uid })) as { points?: number }).points).toBe(achievementOf(id)!.reward);
    // 로그인 안 하면 숫자 0 으로 목록만
    const anon = (await srv.http("/api/points/achievements/poker")).body;
    expect(anon.points).toBeNull();
    expect(anon.list.every((x: { value: number }) => x.value === 0)).toBe(true);
  });

  it("포커 상점: 미오는 포인트로 — 모자라면 NEED_POINTS, 사면 포인트만 빠지고 바로 그 캐릭터", async () => {
    const a = await member();
    const mio = shopFor("poker", "char", "mio")!;
    await set(a.uid, { points: mio.price - 1 });
    expect(await code(a.c.rpc("poker.buyChar", { char: "mio" }))).toBe("NEED_POINTS");
    await set(a.uid, { points: mio.price + 7 });
    const w = await a.c.rpc<Wallet>("poker.buyChar", { char: "mio" });
    expect(w).toMatchObject({ char: "mio", chars: ["mio"], points: 7, money: START_MONEY });
    expect(await code(a.c.rpc("poker.buyChar", { char: "mio" }))).toBe("OWNED");
  });

  it("환전: 칩 → 포인트는 500만을 남겨야 하고, 포인트 → 칩, 앉아 있으면 안 됨, 칩 업적은 환전 칩을 뺌", async () => {
    const a = await member();
    const U = POKER_EXCHANGE;
    await set(a.uid, { money: U.chips * 2 + U.keepChips - 1, points: 0 });
    expect(await code(a.c.rpc("poker.exchange", { dir: "toPoints", units: 2 }))).toBe("NEED_MONEY");
    let w = await a.c.rpc<Wallet>("poker.exchange", { dir: "toPoints", units: 1 });
    expect(w.points).toBe(U.points);
    expect(w.money).toBe(U.chips + U.keepChips - 1);
    expect(await code(a.c.rpc("poker.exchange", { dir: "toChips", units: 2 }))).toBe("NEED_POINTS");
    await set(a.uid, { points: U.points * 30 });
    w = await a.c.rpc<Wallet>("poker.exchange", { dir: "toChips", units: 30 });
    expect(w.points).toBe(0);
    // 칩 업적: 지금 칩 − (받은 30칸 − 내준 1칸)
    const list = (await srv.http("/api/points/achievements/poker", { token: a.token })).body.list as { id: string; value: number }[];
    expect(list.find((x) => x.id === "poker.chips-3")!.value).toBe(w.money - (30 - 1) * U.chips);
    // 앉아 있으면 못 바꿈
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    await a.c.rpc("poker.sit", { id });
    expect(await code(a.c.rpc("poker.exchange", { dir: "toPoints", units: 1 }))).toBe("SEATED");
    await a.c.rpc("poker.leave", { id });
  });

  it("포인트가 바뀌면 포커 지갑도 바로 (업적 받기)", async () => {
    const a = await member();
    await set(a.uid, { "stats.poker.hands": 100, points: 5 });
    const sub = await a.c.sub<Wallet>("poker.wallet", null);
    await srv.http("/api/points/achievements/poker.hands-100/claim", { method: "POST", token: a.token });
    await until(() => [...sub.events].some((e) => e.t === "wallet" && (e.d as Wallet).points === 5 + achievementOf("poker.hands-100")!.reward), "지갑 포인트");
  });

  it("관리자: 포인트를 그 값으로 맞추면 원장에 '운영자 조정'", async () => {
    const a = await member();
    await set(a.uid, { points: 100 });
    const admin = await srv.adminToken();
    const r = await srv.http(`/api/admin/users/${a.uid}`, { method: "PATCH", token: admin, body: { points: 1234 } });
    expect(r.status).toBe(200);
    expect(r.body.points).toBe(1234);
    const log = (await srv.http(`/api/admin/users/${a.uid}/points`, { token: admin })).body.log;
    expect(log[0]).toMatchObject({ delta: 1134, reason: "admin", bal: 1234 });
  });

  it("일일 미션: 그날 처음 본 뒤로 한 만큼 · 하나씩 / 모두 받기 · 두 번 못 받음 · 날이 바뀌면 새로", async () => {
    const a = await member();
    await set(a.uid, { "stats.poker.hands": 100, "stats.poker.holdem.wins": 10, points: 0 });
    type Row = { id: string; value: number; got: boolean };
    const list = async () => (await srv.http("/api/points/daily/poker", { token: a.token })).body.list as Row[];
    const claim = (id?: string) => srv.http("/api/points/daily/poker/claim", { method: "POST", token: a.token, body: id ? { id } : {} });
    expect((await list()).every((x) => x.value === 0 && !x.got)).toBe(true);
    await set(a.uid, { "stats.poker.hands": 112, "stats.poker.holdem.wins": 13 });
    expect((await list()).find((x) => x.id === "poker.d-hands")?.value).toBe(12);
    const one = await claim("poker.d-hands");
    expect(one.body.reward).toBe(dailyMission("poker.d-hands")!.reward);
    expect((await claim("poker.d-hands30")).body.error.code).toBe("NOT_YET");
    expect((await claim("fight.d-games")).body.error.code).toBe("BAD_REQUEST");
    // 모두 받기: 남은 것(3승)만, 동시에 눌러도 한 번
    const rs = await Promise.all([claim(), claim(), claim()]);
    const ok = rs.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    expect(ok[0].body.ids).toEqual(["poker.d-wins"]);
    expect((await claim()).body.error.code).toBe("NOT_YET");
    const total = dailyMission("poker.d-hands")!.reward + dailyMission("poker.d-wins")!.reward;
    expect(((await users().findOne({ _id: a.uid })) as { points?: number }).points).toBe(total);
    expect((await list()).filter((x) => x.got).map((x) => x.id)).toEqual(["poker.d-hands", "poker.d-wins"]);
    // 다음 날: 그때 숫자부터 다시
    await set(a.uid, { "daily.day": "2000-01-01" });
    expect((await list()).every((x) => x.value === 0 && !x.got)).toBe(true);
  });
});
