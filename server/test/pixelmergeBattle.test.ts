import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sleep, startTestServer, type TestClient, type TestServer } from "./helpers";

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

let seq = 0;
const user = (name: string) => s.client(`${name}-${++seq}`);

/** 방장 + n-1명이 들어와 있는 방 */
async function roomWith(n: number, mode: "normal" | "junk" = "normal") {
  const host = await user("host");
  const id = await host.rpc<string>("pmb.create", { mode });
  await host.rpc("pmb.join", { id, nick: "방장" });
  const others: TestClient[] = [];
  for (let i = 0; i < n - 1; i++) {
    const c = await user("p");
    await sleep(2);
    await c.rpc("pmb.join", { id, nick: `친구${i + 1}` });
    others.push(c);
  }
  return { host, others, id };
}

describe("픽셀 머지 친구 대전", () => {
  it("혼자서는 시작 못 하고, 방장만 시작 · 모드 바꾸기", async () => {
    const host = await user("solo");
    const id = await host.rpc<string>("pmb.create", { mode: "normal" });
    await host.rpc("pmb.join", { id, nick: "방장" });
    await expect(host.rpc("pmb.start", { id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const c = await user("p");
    await c.rpc("pmb.join", { id, nick: "친구" });
    await expect(c.rpc("pmb.start", { id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.rpc("pmb.mode", { id, mode: "junk" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await host.rpc("pmb.mode", { id, mode: "junk" });
    const room = (await c.sub("pmb.room", { id })).data;
    expect(room).toMatchObject({ mode: "junk", phase: "lobby", hostUid: host.uid });
    expect(Object.keys(room.players)).toHaveLength(2);
  });

  it("같은 시드로 시작 → 공 위치 중계 → 먼저 넘친 순서대로 꼴등, 한 명 남으면 1등으로 끝", async () => {
    const { host, others, id } = await roomWith(3);
    const [a, b] = others;
    const sub = await a.sub("pmb.room", { id });
    await host.rpc("pmb.start", { id });
    const started = await sub.wait((e) => e.t === "room" && e.d?.phase === "playing");
    const round = started.d.round;
    expect(round.roster).toEqual([host.uid, a.uid, b.uid]);
    expect(round.seed).toEqual(expect.any(Number));

    await b.rpc("pmb.snap", { id, round: round.no, s: [120, 2, 200, 0, 3, 100.4, 500, 12] });
    const live = await sub.wait((e) => e.t === "live" && !!e.d.snaps[b.uid!]);
    expect(live.d.snaps[b.uid!]).toEqual([120, 2, 200, 0, 3, 100, 500, 12]);

    // 일반 모드에선 방해 공이 안 감
    expect(await host.rpc("pmb.attack", { id, round: round.no, n: 3 })).toBeNull();

    await b.rpc("pmb.dead", { id, round: round.no, score: 120, maxTier: 3 });
    const one = await sub.wait((e) => e.t === "room" && !!e.d.round.places[b.uid!]);
    expect(one.d.phase).toBe("playing");
    expect(one.d.round.places[b.uid!]).toMatchObject({ place: 3, score: 120, nick: "◦친구2" });

    await host.rpc("pmb.snap", { id, round: round.no, s: [900, 0, 200, 0] });
    await a.rpc("pmb.dead", { id, round: round.no, score: 300, maxTier: 5 });
    const end = await sub.wait((e) => e.t === "room" && e.d.phase === "result");
    expect(end.d.round.places[a.uid!].place).toBe(2);
    expect(end.d.round.places[host.uid!]).toMatchObject({ place: 1, score: 900 });

    await expect(a.rpc("pmb.back", { id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await host.rpc("pmb.back", { id });
    await sub.wait((e) => e.t === "room" && e.d.phase === "lobby");
  });

  it("방해 모드: 살아 있는 상대에게 방해 공 · 게임 중에 나가면 탈락 처리", async () => {
    const { host, others, id } = await roomWith(2, "junk");
    const [a] = others;
    const sub = await a.sub("pmb.room", { id });
    await host.rpc("pmb.start", { id });
    const round = (await sub.wait((e) => e.t === "room" && e.d?.phase === "playing")).d.round;
    // 시작 카운트다운 전에는 무시
    expect(await host.rpc("pmb.attack", { id, round: round.no, n: 3 })).toBeNull();
    await sleep(round.startAt - Date.now() + 50);
    expect(await host.rpc("pmb.attack", { id, round: round.no, n: 3 })).toEqual({ to: a.uid });
    const junk = await sub.wait((e) => e.t === "junk");
    expect(junk.d).toMatchObject({ to: a.uid, from: host.uid, n: 3 });
    await expect(host.rpc("pmb.attack", { id, round: round.no, n: 99 })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await a.rpc("pmb.leave", { id });
    const end = await sub.wait((e) => e.t === "room" && e.d?.phase === "result");
    expect(end.d.round.places[host.uid!]).toMatchObject({ place: 1, sent: 3 });
    expect(end.d.round.places[a.uid!].place).toBe(2);
  });
});
