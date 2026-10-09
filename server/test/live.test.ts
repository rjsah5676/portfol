import { afterEach, describe, expect, it } from "vitest";
import type { MyHand, TableWire, Wallet } from "../../web/src/lib/poker/types";
import { RpcError, sleep, startTestServer, type TestClient, type TestServer } from "./helpers";

/*
 * 배포(서버 재시작) 때 방 이어받기 (src/live.ts):
 * 내려가는 서버가 공지 → 새 판을 막고 진행 중인 판을 기다림 → 방을 DB 에 저장, 같은 DB 로 뜬 새 서버가 그대로 이어받음.
 */

const servers: TestServer[] = [];
async function start(dbName?: string) {
  const s = await startTestServer(dbName ? { dbName } : {});
  servers.push(s);
  return s;
}
afterEach(async () => {
  // 마지막 서버만 DB 를 지움 (내려간 서버는 이미 닫혀 있음)
  for (const s of servers.splice(0)) await s.close().catch(() => {});
});

async function until(cond: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`시간 초과: ${what}`);
    await sleep(30);
  }
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof RpcError ? e.code : `THROWN:${String(e)}`;
  }
};

describe("스케치 퀴즈", () => {
  it("그리던 중에 서버가 다시 켜져도 차례 · 점수 · 그림 · 채팅이 그대로이고, 남은 시간은 내려가 있던 만큼 미뤄짐", async () => {
    const s1 = await start();
    const a = await s1.client("sk-a");
    const b = await s1.client("sk-b");
    const id = await a.rpc<string>("sketch.createRoom", { nick: "가", name: "이어받기", max: 4, turnMode: "order", drawTime: 60, rounds: 1, hints: true, password: "" });
    await a.rpc("sketch.join", { id, nick: "가" });
    await b.rpc("sketch.join", { id, nick: "나" });
    await a.rpc("sketch.startGame", { id });
    const before = (await a.sub("sketch.room", { id })).data;
    const turnId = before.state.turnId as string;
    await a.rpc("sketch.chooseWord", { id, turnId, word: "사과", hint: "○○", level: 0 });
    await a.rpc("sketch.addStroke", { id, turn: turnId, s: { g: "pen", c: "#000", p: "M0 0L1 1" } });
    await b.rpc("sketch.sendChat", { id, nick: "나", text: "안녕" });
    const drawing = (await (await b.sub("sketch.room", { id })).data).state;

    await s1.shutdown(0);
    expect(a.notices[0]).toMatchObject({ t: "restart" });
    await sleep(120);

    const s2 = await start(s1.dbName);
    const a2 = await s2.client("sk-a");
    const b2 = await s2.client("sk-b");
    const room = (await a2.sub("sketch.room", { id })).data;
    expect(room.state).toMatchObject({ phase: "drawing", turnId, drawer: "sk-a", hint: "○○" });
    expect(room.state.endsAt).toBeGreaterThanOrEqual(drawing.endsAt + 100);
    expect(Object.keys(room.players).sort()).toEqual(["sk-a", "sk-b"]);
    expect(Object.keys(room.scores).sort()).toEqual(["sk-a", "sk-b"]);
    expect((await a2.sub("sketch.strokes", { id, turn: turnId })).data).toHaveLength(1);
    expect((await b2.sub("sketch.chat", { id })).data.map((m: any) => m.text)).toContain("안녕");
    // 그리는 사람은 제시어를 그대로 받음
    expect((await a2.sub("sketch.words", { id })).data).toMatchObject({ word: "사과" });

    // 방을 다시 구독한 연결이 자리 주인 → 그 연결이 끊기면 평소처럼 자리에서 빠짐
    const watch = await b2.sub("sketch.room", { id });
    a2.close();
    await watch.wait((e) => e.t === "room" && !e.d.players["sk-a"]);
  });
});

describe("격투", () => {
  const START = { chars: [0, 1], map: 0, delay: 2, maxRb: 10 };

  it("내려가는 동안 새 경기는 못 열고, 경기 중이던 방은 이어받아서 결과를 그대로 알릴 수 있음", async () => {
    const s1 = await start();
    const a = await s1.client("ft-a");
    const b = await s1.client("ft-b");
    const id = await a.rpc<string>("fight.createRoom", { nick: "에이", name: "" });
    await a.rpc("fight.join", { id, nick: "에이", ch: 0 });
    await b.rpc("fight.join", { id, nick: "비", ch: 1 });
    const match = await a.rpc<string>("fight.startMatch", { id, ...START });
    await a.rpc("fight.result", { id, match, winner: 0 });

    // 경기 중이라 기다리는 동안 → 새 경기 시작은 거절
    const down = s1.shutdown(600);
    await sleep(100);
    expect(await code(a.rpc("fight.startMatch", { id, ...START }))).toBe("RESTARTING");
    await down;

    const s2 = await start(s1.dbName);
    const a2 = await s2.client("ft-a");
    const b2 = await s2.client("ft-b");
    const room = (await a2.sub("fight.room", { id })).data;
    // 서버가 내려가며 끊긴 연결로 자리를 비우지 않음
    expect(room.state).toMatchObject({ phase: "play", match });
    expect(Object.keys(room.players).sort()).toEqual(["ft-a", "ft-b"]);
    expect(room.seats).toEqual({ 0: "ft-a", 1: "ft-b" });
    const watch = await b2.sub("fight.room", { id });
    // 경기는 P2P 로 이어졌고, 끝나면 새 서버에 알림
    await b2.rpc("fight.result", { id, match, winner: 0 });
    await a2.rpc("fight.endMatch", { id, match });
    await watch.wait((e) => e.t === "room" && e.d?.state.phase === "wait");
    // 다시 켜진 서버에서는 새 경기도 됨
    expect(typeof (await a2.rpc<string>("fight.startMatch", { id, ...START }))).toBe("string");
  });
});

describe("포커", () => {
  let n = 0;
  async function member(s: TestServer, uid: string): Promise<TestClient> {
    const email = `${uid}@example.com`;
    const r = await s.http("/api/me/nick", { method: "PUT", token: await s.token(uid, { email }), body: { nick: `이어${++n}` } });
    expect([200, 409]).toContain(r.status);
    return s.client(uid, { email });
  }
  const moneyOf = async (s: TestServer, uid: string) => ((await s.db.col("users").findOne({ _id: uid })) as { money?: number } | null)?.money;

  it("판 도중 기다리는 시간이 지나면 그 판은 없던 일(돈 그대로), 테이블 · 자리는 이어받고, 다시 접속하면 다음 판이 시작됨", async () => {
    const s1 = await start();
    const a = await member(s1, "pk-live");
    const id = await a.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
    const table = await a.sub<{ table: TableWire }>("poker.table", { id });
    await a.sub("poker.me", { id });
    await a.rpc("poker.sit", { id });
    const last = () => ([...table.events].reverse().find((e) => e.t === "state")?.d ?? table.data?.table) as TableWire | undefined;
    // 봇이 들어와 판이 시작될 때까지 (사람은 제한 시간 4초 — 행동하지 않고 둠)
    await until(() => !!last()?.hand && !last()?.hand?.result, "판 시작");
    const handNo = last()!.handNo;
    const money = await moneyOf(s1, "pk-live");

    await s1.shutdown(200);
    // 끝나지 않은 판은 정산되지 않음
    expect(await moneyOf(s1, "pk-live").catch(() => money)).toBe(money);

    const s2 = await start(s1.dbName);
    const a2 = await s2.client("pk-live", { email: "pk-live@example.com" });
    expect((await a2.rpc<Wallet>("poker.wallet")).table).toBe(id);
    const t2 = await a2.sub<{ table: TableWire }>("poker.table", { id });
    const restored = t2.data!.table;
    expect(restored.handNo).toBe(handNo);
    expect(restored.hand).toBeNull();
    const mine = restored.seats.find((x) => x?.uid === "pk-live");
    expect(mine).toBeTruthy();
    expect(await moneyOf(s2, "pk-live")).toBe(money);
    // 다시 접속(poker.me) → 다음 판
    await a2.sub<MyHand | null>("poker.me", { id });
    const last2 = () => ([...t2.events].reverse().find((e) => e.t === "state")?.d ?? t2.data?.table) as TableWire | undefined;
    await until(() => (last2()?.handNo ?? 0) > handNo, "다음 판 시작");
  });

  it("내려가는 동안은 다음 판을 돌리지 않음", async () => {
    const s1 = await start();
    const a = await member(s1, "pk-drain");
    const id = await a.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
    const table = await a.sub<{ table: TableWire }>("poker.table", { id });
    await a.sub("poker.me", { id });
    await a.rpc("poker.sit", { id });
    const last = () => ([...table.events].reverse().find((e) => e.t === "state")?.d ?? table.data?.table) as TableWire | undefined;
    await until(() => !!last()?.hand && !last()?.hand?.result, "판 시작");
    const handNo = last()!.handNo;
    // 기다리는 동안 이번 판을 접으면 판이 끝나고, 다음 판은 시작되지 않은 채 내려감
    const down = s1.shutdown(3000);
    await sleep(50);
    await a.rpc("poker.act", { id, hand: handNo, a: "fold" }).catch(() => {});
    await down;
    expect(Math.max(...table.events.filter((e) => e.t === "state").map((e) => (e.d as TableWire).handNo))).toBe(handNo);
  });
});
