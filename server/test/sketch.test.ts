import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sleep, startTestServer, type TestClient, type TestServer } from "./helpers";

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

let seq = 0;
const user = (name: string) => s.client(`${name}-${++seq}`);

const OPTS = { nick: "방장", name: "", max: 4, turnMode: "order", drawTime: 60, rounds: 1, hints: true, password: "" };
const create = (c: TestClient, o: Partial<typeof OPTS> = {}) => c.rpc<string>("sketch.createRoom", { ...OPTS, ...o });
const join = (c: TestClient, id: string, nick: string, extra: object = {}) => c.rpc("sketch.join", { id, nick, ...extra });
const peek = async (id: string) => (await (await user("peek")).sub("sketch.room", { id })).data;

/** 방장 + 참가자들이 들어와 있는 방 */
async function roomWith(n: number, o: Partial<typeof OPTS> = {}) {
  const host = await user("host");
  const id = await create(host, o);
  await join(host, id, "방장");
  const others: TestClient[] = [];
  for (let i = 0; i < n - 1; i++) {
    const c = await user("p");
    await sleep(2); // 입장 순서가 분명하게
    await join(c, id, `참가${i + 1}`);
    others.push(c);
  }
  return { host, others, id };
}

/** 그리는 사람이 제시어를 골라 그리기 단계까지 */
async function toDrawing(id: string, drawer: TestClient, word = "사과") {
  const state = (await peek(id)).state;
  await drawer.rpc("sketch.setChoices", { id, turnId: state.turnId, choices: [{ word, level: 1 }, { word: "배", level: 0 }] });
  await drawer.rpc("sketch.chooseWord", { id, turnId: state.turnId, word, hint: "◦◦", level: 1 });
  return state.turnId as string;
}

describe("방 만들기 · 로비", () => {
  it("만든 방이 로비에 보이고(로그인 없이도), 인원·단계가 서버에서 갱신됨", async () => {
    const anon = await s.client();
    const lobby = await anon.sub("sketch.lobby");
    const host = await user("host");
    const id = await create(host, { name: "  우리 방  ", max: 99 });
    const first = await lobby.wait((e) => e.d.some((r: any) => r.id === id));
    expect(first.d.find((r: any) => r.id === id)).toMatchObject({
      name: "우리 방",
      locked: false,
      max: 8,
      count: 0,
      phase: "waiting",
      turnMode: "order",
    });
    await join(host, id, "방장");
    await lobby.wait((e) => e.d.find((r: any) => r.id === id)?.count === 1);
    // 이름을 비우면 "닉네임의 방"
    const id2 = await create(await user("h2"), { nick: "철수" });
    expect((await peek(id2)).meta.name).toBe("철수의 방");
  });

  it("방 상태는 로그인한 사람만 볼 수 있고, 없는 방은 null", async () => {
    const id = await create(await user("host"));
    await expect((await s.client()).sub("sketch.room", { id })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect((await (await user("a")).sub("sketch.room", { id: "nope" })).data).toBeNull();
    const room = await peek(id);
    expect(room.meta).toMatchObject({ max: 4, drawTime: 60, rounds: 1, hints: true, locked: false });
    expect(room.state.phase).toBe("waiting");
    expect(JSON.stringify(room)).not.toMatch(/invite|"pw"|access/);
  });

  it("설정 범위를 벗어나면 거절", async () => {
    const c = await user("c");
    await expect(create(c, { drawTime: 10 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(create(c, { rounds: 11 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(create(c, { nick: "열한글자가넘는닉네임이다" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("입장 · 퇴장", () => {
  it("입장하면 자리와 점수 자리가 생기고, 정원이 차면 새 사람은 못 들어옴", async () => {
    const { host, others, id } = await roomWith(2, { max: 2 });
    const room = await peek(id);
    expect(Object.keys(room.players).sort()).toEqual([host.uid, others[0].uid].sort());
    expect(room.scores[others[0].uid!]).toEqual({ nick: "◦참가1", score: 0 });
    await expect(join(await user("late"), id, "늦음")).rejects.toMatchObject({ code: "ROOM_FULL" });
    // 이미 있던 사람이 다시 들어오는 건 됨
    await join(others[0], id, "참가1");
  });

  it("소켓이 끊기면 자리에서 빠지고, 방장이었으면 먼저 들어온 사람이 이어받음. 점수는 남음", async () => {
    const { host, others, id } = await roomWith(3);
    const sub = await others[1].sub("sketch.room", { id });
    host.close();
    const ev = await sub.wait((e) => e.d && !e.d.players[host.uid!]);
    expect(ev.d.meta.hostUid).toBe(others[0].uid);
    expect(ev.d.scores[host.uid!]).toBeDefined();
  });

  it("재연결(rejoin)은 원래 입장 시각을 유지해 순서가 안 바뀜", async () => {
    const { host, others, id } = await roomWith(2);
    const before = (await peek(id)).players[host.uid!].joinedAt;
    await host.rpc("sketch.leave", { id });
    await join(host, id, "방장", { joinedAt: before, rejoin: true });
    const room = await peek(id);
    expect(room.players[host.uid!].joinedAt).toBe(before);
    // 방장은 그 사이 넘어갔음
    expect(room.meta.hostUid).toBe(others[0].uid);
  });

  it("나갈 때 닉네임을 주면 안내 메시지가 올라감", async () => {
    const { host, others, id } = await roomWith(2);
    const chat = await host.sub("sketch.chat", { id });
    await others[0].rpc("sketch.leave", { id, nick: "참가1" });
    expect((await chat.wait((e) => e.t === "add")).d).toMatchObject({ kind: "system", uid: "", text: "◦참가1님이 나갔어요." });
  });

  it("빈 방 정리: 사람이 있으면 그대로, 없으면 삭제되고 구독자는 null 을 받음", async () => {
    const { host, id } = await roomWith(1);
    const anyone = await user("x");
    const sub = await anyone.sub("sketch.room", { id });
    await anyone.rpc("sketch.cleanupEmptyRoom", { id });
    expect((await peek(id)).id).toBe(id);
    await host.rpc("sketch.leave", { id });
    await anyone.rpc("sketch.cleanupEmptyRoom", { id });
    expect((await sub.wait((e) => e.t === "room" && e.d === null)).d).toBeNull();
    expect(await peek(id)).toBeNull();
  });
});

describe("비밀번호 방 · 강퇴", () => {
  it("비번이나 초대키를 맞혀야 입장, 초대키는 참가자만 받음", async () => {
    const host = await user("host");
    const id = await create(host, { password: "1234" });
    await join(host, id, "방장");
    const a = await user("a");
    expect((await peek(id)).meta.locked).toBe(true);
    expect(await a.rpc("sketch.hasAccess", { id })).toBe(false);
    await expect(join(a, id, "a")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(a.rpc("sketch.unlockRoom", { id, password: "0000" })).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    expect(await a.rpc("sketch.getInvite", { id })).toBeNull();
    const key = await host.rpc<string>("sketch.getInvite", { id });
    await a.rpc("sketch.unlockRoom", { id, password: "1234" });
    expect(await a.rpc("sketch.hasAccess", { id })).toBe(true);
    await join(a, id, "a");
    const b = await user("b");
    await expect(b.rpc("sketch.unlockRoom", { id, invite: "x" })).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await b.rpc("sketch.unlockRoom", { id, invite: key });
    await join(b, id, "b");
  });

  it("방장만 강퇴할 수 있고, 강퇴된 사람은 자리·점수가 지워지며 다시 못 들어옴", async () => {
    const { host, others, id } = await roomWith(3);
    const [a, b] = others;
    const chatOfA = await a.sub("sketch.chat", { id });
    await expect(b.rpc("sketch.kick", { id, target: a.uid })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await host.rpc("sketch.kick", { id, target: a.uid });
    const room = await peek(id);
    expect(room.kicked[a.uid!]).toBe("◦참가1");
    expect(room.players[a.uid!]).toBeUndefined();
    expect(room.scores[a.uid!]).toBeUndefined();
    await expect(join(a, id, "참가1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    // 보고 있던 채팅 구독도 끊김
    await chatOfA.wait((e) => e.t === "closed");
    await expect(a.sub("sketch.chat", { id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("진행", () => {
  it("리더만 시작할 수 있고, 2명 이상이어야 시작됨", async () => {
    const { host, id } = await roomWith(1);
    await host.rpc("sketch.startGame", { id });
    expect((await peek(id)).state.phase).toBe("waiting");

    const g = await roomWith(2);
    await expect(g.others[0].rpc("sketch.startGame", { id: g.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const chat = await g.host.sub("sketch.chat", { id: g.id });
    await g.host.rpc("sketch.startGame", { id: g.id });
    const st = (await peek(g.id)).state;
    expect(st).toMatchObject({ phase: "choosing", turnNo: 1, drawer: g.host.uid, drawerNick: "◦방장", drawn: { [g.host.uid!]: 1 } });
    expect(st.turnId).not.toBe("");
    expect(st.endsAt - Date.now()).toBeGreaterThan(13_000);
    expect((await chat.wait((e) => e.d?.kind === "system")).d.text).toContain("게임 시작!");
  });

  it("제시어는 그리는 사람만 볼 수 있음", async () => {
    const { host, others, id } = await roomWith(2);
    await host.rpc("sketch.startGame", { id });
    const turnId = (await peek(id)).state.turnId;
    await expect(others[0].sub("sketch.words", { id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(others[0].rpc("sketch.setChoices", { id, turnId, choices: [{ word: "x", level: 0 }] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const words = await host.sub("sketch.words", { id });
    expect(words.data).toBeNull();
    await host.rpc("sketch.setChoices", { id, turnId, choices: [{ word: "사과", level: 1 }, { word: "배", level: 0 }] });
    expect((await words.wait((e) => e.t === "value")).d).toEqual({ turnId, choices: ["사과", "배"], levels: [1, 0] });
    await host.rpc("sketch.chooseWord", { id, turnId, word: "사과", hint: "◦◦", level: 1 });
    expect((await words.wait((e) => e.d?.word)).d.word).toBe("사과");
    const st = (await peek(id)).state;
    expect(st).toMatchObject({ phase: "drawing", hint: "◦◦", level: 1 });
    expect(st.endsAt - Date.now()).toBeGreaterThan(58_000);
    // 방 상태에는 정답이 실려 나가지 않음
    expect(JSON.stringify(await peek(id))).not.toContain("사과");
    await host.rpc("sketch.setHint", { id, turnId, hint: "사◦" });
    expect((await peek(id)).state.hint).toBe("사◦");
  });

  it("그림: 그리는 사람만 올리고 참가자에게 전달, 되돌리기·전체 지우기, 늦게 본 사람은 처음부터 받음", async () => {
    const { host, others, id } = await roomWith(2);
    await host.rpc("sketch.startGame", { id });
    const turn = await toDrawing(id, host);
    const view = await others[0].sub("sketch.strokes", { id, turn });
    expect(view.data).toEqual([]);
    const s1 = { g: "g1", c: "#000", w: 4, p: "1,1 2,2" };
    const k1 = await host.rpc<string>("sketch.addStroke", { id, turn, s: s1 });
    const k2 = await host.rpc<string>("sketch.addStroke", { id, turn, s: { g: "g1", c: "#000", w: 4, p: "2,2 3,3", e: 1 } });
    expect(k2 > k1).toBe(true);
    expect((await view.wait((e) => e.t === "add")).d).toEqual([k1, s1]);
    await expect(others[0].rpc("sketch.addStroke", { id, turn, s: s1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(host.rpc("sketch.addStroke", { id, turn: "other-turn", s: s1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect((await user("x")).sub("sketch.strokes", { id, turn })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const late = await others[0].sub("sketch.strokes", { id, turn });
    expect(late.data.map((x: any) => x[0])).toEqual([k1, k2]);
    await host.rpc("sketch.removeStrokes", { id, turn, keys: [k2] });
    expect((await view.wait((e) => e.t === "remove")).d).toEqual([k2]);
    await host.rpc("sketch.clearStrokes", { id, turn });
    await view.wait((e) => e.t === "clear");
    expect((await others[0].sub("sketch.strokes", { id, turn })).data).toEqual([]);
  });

  it("정답 시도는 그리는 사람에게만 가고, 정답 처리 시 점수(첫 정답 +30, 그린 사람은 절반)가 붙음", async () => {
    const { host, others, id } = await roomWith(3);
    const [a, b] = others;
    await host.rpc("sketch.startGame", { id });
    const turnId = await toDrawing(id, host);
    await expect(a.sub("sketch.guesses", { id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const guesses = await host.sub("sketch.guesses", { id });
    const chat = await b.sub("sketch.chat", { id });
    await a.rpc("sketch.sendGuess", { id, nick: "◦참가1", text: "사 과", turnId });
    const g = (await guesses.wait((e) => e.t === "add")).d;
    expect(g).toMatchObject({ uid: a.uid, nick: "◦참가1", text: "사 과", turnId });
    // 채팅에는 안 올라감
    expect(chat.events.filter((e) => e.d?.text === "사 과")).toEqual([]);
    await host.rpc("sketch.removeGuess", { id, guessId: g.id });
    expect((await host.sub("sketch.guesses", { id })).data).toEqual([]);

    await expect(a.rpc("sketch.markCorrect", { id, guess: { uid: a.uid, nick: "참가1", turnId } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await host.rpc("sketch.markCorrect", { id, guess: { uid: a.uid, nick: "참가1", turnId } });
    let room = await peek(id);
    // 60초 중 거의 다 남음 × 난이도 1.2 → (20 + 80) × 1.2 = 120 근처, 첫 정답 +30
    const ptsA = room.state.correct[a.uid!];
    expect(ptsA).toBeGreaterThanOrEqual(145);
    expect(ptsA).toBeLessThanOrEqual(150);
    expect(room.state.firstCorrect).toBe(a.uid);
    expect(room.scores[a.uid!].score).toBe(ptsA);
    expect(room.scores[host.uid!].score).toBe(Math.round((ptsA - 30) / 2));
    const msg = (await chat.wait((e) => e.d?.kind === "correct")).d;
    expect(msg.text).toBe(`◦참가1님이 제일 먼저 정답을 맞혔어요! (+${ptsA} 🥇) · 그린 사람 +${Math.round((ptsA - 30) / 2)}`);

    // 같은 사람을 또 처리해도 한 번만 반영
    await host.rpc("sketch.markCorrect", { id, guess: { uid: a.uid, nick: "참가1", turnId } });
    expect((await peek(id)).scores[a.uid!].score).toBe(ptsA);
    // 두 번째 정답자는 보너스 없음
    await host.rpc("sketch.markCorrect", { id, guess: { uid: b.uid, nick: "참가2", turnId } });
    room = await peek(id);
    expect(room.state.correct[b.uid!]).toBeLessThanOrEqual(120);
    expect(room.state.firstCorrect).toBe(a.uid);

    // 오답은 그리는 사람이 채팅으로 넘겨줌
    await host.rpc("sketch.relayGuess", { id, guess: { uid: b.uid, nick: "참가2", text: "바나나" } });
    expect((await chat.wait((e) => e.d?.text === "바나나")).d).toMatchObject({ kind: "msg", uid: b.uid, nick: "◦참가2" });
  });

  it("차례 종료 → 정답 공개·사용 단어 기록 → 다음 차례는 입장 순서, 모두 그리면 게임 끝", async () => {
    const { host, others, id } = await roomWith(2);
    const [a] = others;
    await host.rpc("sketch.startGame", { id });
    const t1 = await toDrawing(id, host, "포크 레인");
    const chat = await a.sub("sketch.chat", { id });
    // 참가자(리더도 그리는 사람도 아님)는 끝낼 수 없음
    await expect(a.rpc("sketch.endTurn", { id, turnId: t1, reveal: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await host.rpc("sketch.endTurn", { id, turnId: t1, reveal: "포크 레인" });
    let room = await peek(id);
    expect(room.state).toMatchObject({ phase: "reveal", reveal: "포크 레인" });
    expect(room.used).toEqual({ 포크레인: true });
    expect((await chat.wait((e) => e.d?.kind === "system")).d.text).toBe("정답은 「포크 레인」");
    // 이미 끝난 차례를 또 끝내도 변화 없음
    await host.rpc("sketch.endTurn", { id, turnId: t1, reveal: "포크 레인" });

    await expect(a.rpc("sketch.nextTurn", { id, turnId: t1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const oldWords = await host.sub("sketch.words", { id });
    await host.rpc("sketch.nextTurn", { id, turnId: t1 });
    room = await peek(id);
    expect(room.state).toMatchObject({
      phase: "choosing",
      turnNo: 2,
      drawer: a.uid,
      drawerNick: "◦참가1",
      correct: {},
      firstCorrect: "",
      drawn: { [host.uid!]: 1, [a.uid!]: 1 },
    });
    expect(room.state.turnId).not.toBe(t1);
    // 이전에 그리던 사람의 제시어 구독은 끊기고, 새로 그리는 사람은 빈 값부터
    await oldWords.wait((e) => e.t === "closed");
    expect((await a.sub("sketch.words", { id })).data).toBeNull();

    // 리더가 대신 끝내면 정답 없이 건너뜀
    await host.rpc("sketch.endTurn", { id, turnId: room.state.turnId, reveal: "몰래" });
    room = await peek(id);
    expect(room.state.reveal).toBe("");
    expect((await chat.wait((e) => e.d?.text === "이번 차례는 건너뛰었어요.")).d.kind).toBe("system");
    await host.rpc("sketch.nextTurn", { id, turnId: room.state.turnId });
    expect((await peek(id)).state).toMatchObject({ phase: "ended", endsAt: 0 });
    expect((await chat.wait((e) => e.d?.text?.startsWith("게임 끝!"))).d.kind).toBe("system");

    await expect(a.rpc("sketch.backToWaiting", { id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await host.rpc("sketch.backToWaiting", { id });
    expect((await peek(id)).state).toMatchObject({ phase: "waiting", turnId: "", drawn: {} });
  });

  it("정답자 다음 차례 모드: 첫 정답자가 다음에 그림", async () => {
    const { host, others, id } = await roomWith(3, { turnMode: "winner", rounds: 2 });
    const [a, b] = others;
    await host.rpc("sketch.startGame", { id });
    const t1 = await toDrawing(id, host);
    await host.rpc("sketch.markCorrect", { id, guess: { uid: b.uid, nick: "참가2", turnId: t1 } });
    await host.rpc("sketch.endTurn", { id, turnId: t1, reveal: "사과" });
    await host.rpc("sketch.nextTurn", { id, turnId: t1 });
    expect((await peek(id)).state.drawer).toBe(b.uid);
    void a;
  });

  it("그리는 사람이 나가면 리더가 차례를 넘길 수 있음", async () => {
    const { host, others, id } = await roomWith(3, { rounds: 2 });
    const [a, b] = others;
    await host.rpc("sketch.startGame", { id });
    const t1 = await toDrawing(id, host);
    await host.rpc("sketch.endTurn", { id, turnId: t1, reveal: "사과" });
    await host.rpc("sketch.nextTurn", { id, turnId: t1 });
    const t2 = (await peek(id)).state.turnId;
    a.close(); // 지금 그리는 사람(참가1)이 끊김
    await sleep(100);
    expect((await peek(id)).players[a.uid!]).toBeUndefined();
    await host.rpc("sketch.endTurn", { id, turnId: t2, reveal: "" });
    await host.rpc("sketch.nextTurn", { id, turnId: t2 });
    // 나간 사람 "다음"을 알 수 없으면 입장 순서 맨 앞에서부터 아직 덜 그린 사람 (기존 규칙 그대로)
    expect((await peek(id)).state.drawer).toBe(host.uid);
    void b;
  });
});

describe("채팅", () => {
  it("참가자만 쓰고 읽음, 나중에 구독하면 최근 것부터 받음", async () => {
    const { host, others, id } = await roomWith(2);
    const outsider = await user("x");
    await expect(outsider.sub("sketch.chat", { id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.rpc("sketch.sendChat", { id, nick: "x", text: "hi" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const chat = await host.sub("sketch.chat", { id });
    await others[0].rpc("sketch.sendChat", { id, nick: "◦참가1", text: "안녕" });
    const m = (await chat.wait((e) => e.t === "add")).d;
    expect(m).toMatchObject({ uid: others[0].uid, nick: "◦참가1", text: "안녕", kind: "msg" });
    expect(m.ts).toBeTypeOf("number");
    await others[0].rpc("sketch.systemChat", { id, text: "참가1님이 들어왔어요." });
    const later = (await others[0].sub("sketch.chat", { id })).data;
    expect(later.map((x: any) => x.kind)).toEqual(["msg", "system"]);
    await expect(host.rpc("sketch.sendChat", { id, nick: "방장", text: "x".repeat(101) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("오래 비어 있는 방", () => {
  it("설정한 시간 넘게 비어 있으면 서버가 정리함", async () => {
    const { registerSketch } = await import("../src/games/sketch");
    // 같은 게이트웨이에 다시 등록할 수는 없으니, 정리 로직만 별도 서버로 확인
    const { loadConfig } = await import("../src/config");
    const { createServer } = await import("node:http");
    const { Gateway } = await import("../src/realtime/gateway");
    const http = createServer();
    const cfg = loadConfig({ NODE_ENV: "test", PORT: "0" });
    const gateway = new Gateway(http, cfg, { verify: async (t) => ({ uid: t, email: null, anonymous: true, admin: false }) });
    const sk = registerSketch({ cfg, gateway, auth: null as never, db: null as never, web: null as never, users: { bump() {} } as never }, { emptyRoomTtlMs: 30, sweepIntervalMs: 20 });
    await new Promise<void>((r) => http.listen(0, r));
    const { io } = await import("socket.io-client");
    const port = (http.address() as { port: number }).port;
    const c = io(`http://127.0.0.1:${port}`, { transports: ["websocket"] });
    await new Promise<void>((r) => c.once("connect", () => r()));
    await c.emitWithAck("auth", "u1");
    const res = await c.emitWithAck("rpc", { m: "sketch.createRoom", a: OPTS });
    const id = res.d;
    expect((await c.emitWithAck("sub", { ch: "sketch.room", p: { id } })).d.d.id).toBe(id);
    await sleep(120);
    expect((await c.emitWithAck("sub", { ch: "sketch.room", p: { id } })).d.d).toBeNull();
    c.disconnect();
    sk.close();
    await gateway.close();
  });
});
