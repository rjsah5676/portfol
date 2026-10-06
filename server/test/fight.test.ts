import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sleep, startTestServer, type TestClient, type TestServer } from "./helpers";

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

let seq = 0;
const user = (name: string) => s.client(`${name}-${++seq}`);
const create = (c: TestClient, name = "") => c.rpc<string>("fight.createRoom", { nick: "방장", name });
const join = (c: TestClient, id: string, nick: string, ch = 0) => c.rpc<{ seat: 0 | 1 }>("fight.join", { id, nick, ch });
const peek = async (id: string) => (await (await user("peek")).sub("fight.room", { id })).data;

/** 두 선수가 앉아 있는 방 (a = 방장·0번 자리, b = 1번 자리) */
async function duel() {
  const a = await user("a");
  const b = await user("b");
  const id = await create(a);
  await join(a, id, "에이");
  await sleep(2);
  await join(b, id, "비");
  const pair = `${a.uid}_${b.uid}`;
  return { a, b, id, pair };
}
const START = { chars: [2, 3], map: 1, delay: 3, maxRb: 12 };

describe("로비 · 방", () => {
  it("만든 방이 로비에 보이고(로그인 없이도) 인원·경기 여부가 서버에서 갱신됨", async () => {
    const lobby = await (await s.client()).sub("fight.lobby");
    const a = await user("a");
    const id = await create(a, "  한판  ");
    const row = (await lobby.wait((e) => e.d.some((r: any) => r.id === id))).d.find((r: any) => r.id === id);
    expect(row).toMatchObject({ name: "한판", host: "방장", count: 0, playing: false });
    expect(row.createdAt).toBeTypeOf("number");
    await join(a, id, "에이");
    await lobby.wait((e) => e.d.find((r: any) => r.id === id)?.count === 1);
    expect((await peek(await create(await user("x")))).meta.name).toBe("방장의 방");
  });

  it("방 상태는 로그인한 사람만, 없는 방은 null / 입장은 NO_ROOM", async () => {
    const id = await create(await user("a"));
    await expect((await s.client()).sub("fight.room", { id })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await peek("nope")).toBeNull();
    await expect(join(await user("b"), "nope", "비")).rejects.toMatchObject({ code: "NO_ROOM" });
    expect(await peek(id)).toMatchObject({
      seats: {},
      players: {},
      watchers: {},
      state: { phase: "wait", match: "", chars: [0, 1], map: 0, pick: -1, delay: 2, maxRb: 10 },
    });
  });
});

describe("자리", () => {
  it("0번·1번 순서로 앉고 세 번째는 ROOM_FULL", async () => {
    const { a, b, id } = await duel();
    const room = await peek(id);
    expect(room.seats).toEqual({ 0: a.uid, 1: b.uid });
    expect(room.players[a.uid!]).toMatchObject({ nick: "에이", seat: 0, ch: 0, ready: false });
    expect(room.players[b.uid!]).toMatchObject({ nick: "비", seat: 1 });
    expect(room.meta.hostUid).toBe(a.uid);
    await expect(join(await user("c"), id, "씨")).rejects.toMatchObject({ code: "ROOM_FULL", message: "room full" });
    // 이미 앉아 있는 사람이 다시 들어오면 같은 자리
    expect(await join(b, id, "비")).toEqual({ seat: 1 });
  });

  it("소켓이 끊기면 자리·선수가 지워지고 남은 사람이 방장, 빈자리는 다음 사람이 앉음", async () => {
    const { a, b, id } = await duel();
    const sub = await b.sub("fight.room", { id });
    const lobby = await b.sub("fight.lobby");
    a.close();
    const ev = await sub.wait((e) => e.d && !e.d.players[a.uid!]);
    expect(ev.d.seats).toEqual({ 1: b.uid });
    expect(ev.d.meta.hostUid).toBe(b.uid);
    await lobby.wait((e) => e.d.find((r: any) => r.id === id)?.count === 1);
    const c = await user("c");
    expect(await join(c, id, "씨")).toEqual({ seat: 0 });
  });

  it("잠깐 끊겼던 사람은 원래 자리로 복구되지만, 그 사이 남이 앉았으면 실패", async () => {
    const { a, b, id } = await duel();
    await b.rpc("fight.leave", { id });
    await b.rpc("fight.takeSeat", { id, seat: 1, nick: "비", ch: 4, joinedAt: 1 });
    const room = await peek(id);
    expect(room.players[b.uid!]).toMatchObject({ seat: 1, ch: 4, ready: false });
    // 방 생성 전 시각은 바로잡힘
    expect(room.players[b.uid!].joinedAt).toBeGreaterThanOrEqual(room.meta.createdAt);
    await b.rpc("fight.leave", { id });
    const c = await user("c");
    await join(c, id, "씨");
    await expect(b.rpc("fight.takeSeat", { id, seat: 1, nick: "비", ch: 0 })).rejects.toMatchObject({ code: "ROOM_FULL" });
    void a;
  });

  it("나간 뒤 아무도 없으면 방이 정리되고, 사람이 있으면 정리 요청을 무시", async () => {
    const { a, b, id } = await duel();
    const sub = await (await user("w")).sub("fight.room", { id });
    await a.rpc("fight.cleanupEmptyRoom", { id });
    expect(await peek(id)).not.toBeNull();
    await a.rpc("fight.leave", { id });
    expect(await peek(id)).not.toBeNull();
    await b.rpc("fight.leave", { id });
    expect((await sub.wait((e) => e.d === null)).d).toBeNull();
    expect(await peek(id)).toBeNull();
    // 만들고 아무도 안 들어온 방은 로비의 정리 요청으로 지워짐
    const id2 = await create(a);
    await b.rpc("fight.cleanupEmptyRoom", { id: id2 });
    expect(await peek(id2)).toBeNull();
  });
});

describe("대기실", () => {
  it("캐릭터·준비·맵 선택이 방 구독자에게 전달됨 (맵은 방장만)", async () => {
    const { a, b, id } = await duel();
    const sub = await b.sub("fight.room", { id });
    await a.rpc("fight.setChar", { id, ch: -1 });
    await a.rpc("fight.setReady", { id, ready: true });
    expect((await sub.wait((e) => e.d.players[a.uid!].ready)).d.players[a.uid!]).toMatchObject({ ch: -1, ready: true });
    await expect(b.rpc("fight.setPick", { id, pick: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await a.rpc("fight.setPick", { id, pick: 2 });
    expect((await sub.wait((e) => e.d.state.pick === 2)).d.state.phase).toBe("wait");
    await expect((await user("x")).rpc("fight.setReady", { id, ready: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("채팅은 선수만 쓰고, 나중에 구독하면 최근 것부터 받음", async () => {
    const { a, b, id } = await duel();
    const chat = await b.sub("fight.chat", { id });
    expect(chat.data).toEqual([]);
    await a.rpc("fight.sendChat", { id, nick: "에이", text: "ㄱㄱ" });
    expect((await chat.wait((e) => e.t === "add")).d).toMatchObject({ uid: a.uid, nick: "에이", text: "ㄱㄱ" });
    const w = await user("w");
    await expect(w.rpc("fight.sendChat", { id, nick: "w", text: "hi" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await w.sub("fight.chat", { id })).data).toHaveLength(1);
  });

  it("경기 시작은 방장만·둘 다 있을 때만, 끝나면 대기 상태로", async () => {
    const { a, b, id } = await duel();
    await expect(b.rpc("fight.startMatch", { id, ...START })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const sub = await b.sub("fight.room", { id });
    const match = await a.rpc<string>("fight.startMatch", { id, ...START });
    expect((await sub.wait((e) => e.d.state.phase === "play")).d.state).toMatchObject({ phase: "play", match, ...START, pick: -1 });
    await b.rpc("fight.endMatch", { id, match: "other" });
    expect((await peek(id)).state.phase).toBe("play");
    await b.rpc("fight.endMatch", { id, match });
    expect((await peek(id)).state).toMatchObject({ phase: "wait", match });

    const solo = await user("solo");
    const id2 = await create(solo);
    await join(solo, id2, "혼자");
    await expect(solo.rpc("fight.startMatch", { id: id2, ...START })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("WebRTC 연결 정보 · 입력 중계", () => {
  it("먼저 올려둔 offer 를 나중에 구독한 상대가 받고, answer 가 돌아감. 선수가 아니면 거절", async () => {
    const { a, b, id, pair } = await duel();
    await a.rpc("fight.sigOffer", { id, pair, offer: { n: "n1", sdp: "offer-sdp" } });
    const forB = await b.sub("fight.sig", { id, pair });
    expect(forB.data).toEqual({ offer: { n: "n1", sdp: "offer-sdp" } });
    const forA = await a.sub("fight.sig", { id, pair });
    await b.rpc("fight.sigAnswer", { id, pair, answer: { n: "n1", sdp: "answer-sdp" } });
    expect((await forA.wait((e) => e.d?.answer)).d).toEqual({
      offer: { n: "n1", sdp: "offer-sdp" },
      answer: { n: "n1", sdp: "answer-sdp" },
    });
    // 새 offer 는 이전 answer 를 지움
    await a.rpc("fight.sigOffer", { id, pair, offer: { n: "n2", sdp: "o2" } });
    expect((await forB.wait((e) => e.d?.offer?.n === "n2")).d).toEqual({ offer: { n: "n2", sdp: "o2" } });

    const x = await user("x");
    await expect(x.sub("fight.sig", { id, pair })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(x.rpc("fight.sigOffer", { id, pair, offer: { n: "z", sdp: "z" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("중계: 내 자리 값만 쓸 수 있고 상대에게 전달됨, 2000자 초과는 거절", async () => {
    const { a, b, id } = await duel();
    const fromA = await b.sub("fight.relay", { id, seat: 0 });
    expect(fromA.data).toBeNull();
    await a.rpc("fight.relay", { id, v: '{"k":"hb"}' });
    expect((await fromA.wait((e) => e.t === "value")).d).toBe('{"k":"hb"}');
    // 나중에 구독하면 마지막 값을 받음
    expect((await b.sub("fight.relay", { id, seat: 0 })).data).toBe('{"k":"hb"}');
    expect((await a.sub("fight.relay", { id, seat: 1 })).data).toBeNull();
    await expect(a.rpc("fight.relay", { id, v: "x".repeat(2001) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const x = await user("x");
    await expect(x.rpc("fight.relay", { id, v: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(x.sub("fight.relay", { id, seat: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("관전", () => {
  it("입력 기록이 순서대로 쌓이고 늦게 온 관전자도 처음부터 받음, 새 경기에서 비워짐", async () => {
    const { a, b, id } = await duel();
    const match = await a.rpc<string>("fight.startMatch", { id, ...START });
    const w = await user("w");
    const live = await w.sub("fight.watch", { id, match, seat: 0 });
    expect(live.data).toEqual([]);
    await a.rpc("fight.watchChunk", { id, match, n: 0, f: 3, i: "0,1,2" });
    await a.rpc("fight.watchChunk", { id, match, n: 1, f: 33, i: "a,b" });
    await b.rpc("fight.watchChunk", { id, match, n: 0, f: 3, i: "z" });
    expect((await live.wait((e) => e.t === "add")).d).toEqual({ n: 0, f: 3, i: "0,1,2" });
    const late = await (await user("late")).sub("fight.watch", { id, match, seat: 0 });
    expect(late.data).toEqual([
      { n: 0, f: 3, i: "0,1,2" },
      { n: 1, f: 33, i: "a,b" },
    ]);
    expect((await w.sub("fight.watch", { id, match, seat: 1 })).data).toEqual([{ n: 0, f: 3, i: "z" }]);
    // 선수가 아니면 못 올림, 다른 매치 id 는 무시
    await expect(w.rpc("fight.watchChunk", { id, match, n: 0, f: 0, i: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await a.rpc("fight.watchChunk", { id, match: "old", n: 5, f: 0, i: "q" });
    expect((await w.sub("fight.watch", { id, match, seat: 0 })).data).toHaveLength(2);

    await a.rpc("fight.endMatch", { id, match });
    const match2 = await a.rpc<string>("fight.startMatch", { id, ...START });
    expect(match2).not.toBe(match);
    expect((await w.sub("fight.watch", { id, match: match2, seat: 0 })).data).toEqual([]);
    expect((await w.sub("fight.watch", { id, match, seat: 0 })).data).toEqual([]);
  });

  it("관전자 표시: 등록·해제, 끊기면 자동 제거", async () => {
    const { a, id } = await duel();
    const sub = await a.sub("fight.room", { id });
    const w = await user("w");
    await w.rpc("fight.watchJoin", { id, nick: "구경" });
    expect((await sub.wait((e) => e.d.watchers[w.uid!])).d.watchers[w.uid!]).toMatchObject({ nick: "구경" });
    await w.rpc("fight.watchLeave", { id });
    await sub.wait((e) => !e.d.watchers[w.uid!]);
    const w2 = await user("w2");
    await w2.rpc("fight.watchJoin", { id, nick: "둘" });
    await sub.wait((e) => e.d.watchers[w2.uid!]);
    w2.close();
    await sub.wait((e) => !e.d.watchers[w2.uid!]);
    // 없는 방을 관전하려 해도 오류는 아님
    await w.rpc("fight.watchJoin", { id: "nope", nick: "구경" });
  });
});
