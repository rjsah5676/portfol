import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestClient, type TestServer } from "./helpers";

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

let seq = 0;
/** 테스트마다 새 사용자 (한 사람은 진행중인 방을 하나만 가질 수 있어서) */
const user = (name: string) => s.client(`${name}-${++seq}`);

interface Opts {
  g?: "chess" | "janggi" | "omok";
  color?: "w" | "b" | "r";
  timeMin?: number;
  incSec?: number;
  password?: string;
  variant?: string;
}
const create = (c: TestClient, o: Opts = {}) =>
  c.rpc<string>("board.createRoom", {
    g: o.g ?? "chess",
    name: "테스트 방",
    nick: "방장",
    color: o.color ?? "w",
    timeMin: o.timeMin ?? 0,
    incSec: o.incSec ?? 0,
    password: o.password ?? "",
    variant: o.variant ?? "",
  });

/** 방장(백) + 상대(흑)가 앉아서 시작한 체스 방 */
async function started(o: Opts = {}) {
  const host = await user("host");
  const guest = await user("guest");
  const g = o.g ?? "chess";
  const id = await create(host, o);
  await guest.rpc("board.joinAsPlayer", { g, id, nick: "상대" });
  await host.rpc("board.startGame", { g, id });
  const sub = await host.sub("board.room", { g, id });
  const call = (c: TestClient, op: string, extra: object = {}) => c.rpc(`board.${op}`, { g, id, ...extra });
  /** 지금 방 상태 */
  const room = async () => (await (await user("peek")).sub("board.room", { g, id })).data;
  return { host, guest, id, g, sub, call, room };
}

describe("방 만들기 · 로비", () => {
  it("만든 방이 로비 구독자에게 보이고, 로그인 없이도 로비·방을 볼 수 있음", async () => {
    const anon = await s.client();
    const lobby = await anon.sub("board.lobby", { g: "chess" });
    const host = await user("host");
    const id = await create(host, { color: "b", timeMin: 5, incSec: 3 });
    const ev = await lobby.wait((e) => e.t === "list" && e.d.list.some((r: any) => r.id === id));
    expect(ev.d.s).toBeGreaterThan(lobby.data.s);

    const room = (await anon.sub("board.room", { g: "chess", id })).data;
    expect(room).toMatchObject({
      id,
      name: "테스트 방",
      hostUid: host.uid,
      whiteUid: "",
      blackUid: host.uid,
      blackName: "◦방장",
      status: "waiting",
      moves: [],
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      whiteMs: 300_000,
      blackMs: 300_000,
      turnStartedAt: null,
      locked: false,
      spectators: {},
      v: 1,
    });
    expect(typeof room.createdAt).toBe("number");
    // 비밀번호 관련 값은 방 데이터에 실려 나가지 않음
    // (값 전체를 글자로 찾으면 랜덤 방 id 에 "pw" 같은 글자가 섞일 때 틀리게 실패함 → 키 이름으로 확인)
    expect(Object.keys(room).filter((k) => /invite|pw|access/i.test(k))).toEqual([]);
  });

  it("없는 방 구독은 null, 로그인 없이 요청하면 UNAUTHENTICATED", async () => {
    const anon = await s.client();
    expect((await anon.sub("board.room", { g: "chess", id: "nope" })).data).toBeNull();
    await expect(create(anon)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("진행중인 방이 있으면 또 만들거나 다른 방에 앉을 수 없음 (ACTIVE_ROOM + 그 방)", async () => {
    const a = await user("a");
    const b = await user("b");
    const id = await create(a);
    await expect(create(a)).rejects.toMatchObject({
      code: "ACTIVE_ROOM",
      message: "이미 진행중인 게임이 있습니다.",
      data: { id },
    });
    const other = await create(b);
    await expect(a.rpc("board.joinAsPlayer", { g: "chess", id: other, nick: "a" })).rejects.toMatchObject({
      code: "ACTIVE_ROOM",
    });
    expect(await a.rpc("board.findMyActiveRoom", { g: "chess" })).toMatchObject({ id });
    expect(await (await user("c")).rpc("board.findMyActiveRoom", { g: "chess" })).toBeNull();
    // 다른 게임은 따로 셈
    await expect(create(a, { g: "omok" })).resolves.toBeTypeOf("string");
  });

  it("랜덤 색은 둘 중 하나, 이름이 비면 거절", async () => {
    const a = await user("a");
    const id = await create(a, { color: "r" });
    const room = (await a.sub("board.room", { g: "chess", id })).data;
    expect([room.whiteUid, room.blackUid].filter(Boolean)).toEqual([a.uid]);
    const b = await user("b");
    await expect(b.rpc("board.createRoom", { g: "chess", name: "   ", nick: "b", color: "w", timeMin: 0, incSec: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("착석 · 시작 · 퇴장", () => {
  it("빈 자리에 앉고, 방장만 시작할 수 있음", async () => {
    const host = await user("host");
    const guest = await user("guest");
    const id = await create(host);
    const ref = { g: "chess", id };
    await expect(host.rpc("board.startGame", ref)).rejects.toMatchObject({ message: "상대가 아직 입장하지 않았습니다." });
    await guest.rpc("board.joinAsPlayer", { ...ref, nick: "상대" });
    await expect(guest.rpc("board.startGame", ref)).rejects.toMatchObject({ message: "방장만 시작할 수 있습니다." });
    const third = await user("third");
    await expect(third.rpc("board.joinAsPlayer", { ...ref, nick: "x" })).rejects.toMatchObject({ message: "빈 자리가 없습니다." });

    const sub = await guest.sub("board.room", ref);
    expect(sub.data).toMatchObject({ blackUid: guest.uid, blackName: "◦상대", status: "waiting" });
    await host.rpc("board.startGame", ref);
    const ev = await sub.wait((e) => e.d?.status === "playing");
    expect(ev.d.turnStartedAt).toBeTypeOf("number");
    expect(ev.d.v).toBeGreaterThan(sub.data.v);
    await expect(third.rpc("board.joinAsPlayer", { ...ref, nick: "x" })).rejects.toMatchObject({
      message: "이미 대국이 시작된 방입니다.",
    });
  });

  it("대기방: 참가자가 나가면 자리만 비고, 방장이 나가면 방이 닫힘. 대국 중에는 나가도 자리 유지", async () => {
    const host = await user("host");
    const guest = await user("guest");
    const id = await create(host);
    const ref = { g: "chess", id };
    const sub = await host.sub("board.room", ref);
    await guest.rpc("board.joinAsPlayer", { ...ref, nick: "상대" });
    await guest.rpc("board.leaveRoom", ref);
    expect((await sub.wait((e) => e.d.blackUid === "" && e.d.v > 2)).d).toMatchObject({ blackName: "", status: "waiting" });
    await host.rpc("board.leaveRoom", ref);
    expect((await sub.wait((e) => e.d.status === "closed")).d.hostUid).toBe(host.uid);

    const g2 = await started();
    await g2.call(g2.guest, "leaveRoom");
    expect(await g2.room()).toMatchObject({ status: "playing", blackUid: g2.guest.uid });
  });

  it("관전은 2명까지, 관전자가 나가면 자리가 빔", async () => {
    const { id, g, room } = await started();
    const ref = { g, id };
    const [w1, w2, w3] = await Promise.all([user("w"), user("w"), user("w")]);
    await w1.rpc("board.joinAsSpectator", { ...ref, nick: "관1" });
    await w1.rpc("board.beat", { ...ref, name: "관1" });
    await w2.rpc("board.joinAsSpectator", { ...ref, nick: "관2" });
    await w2.rpc("board.beat", { ...ref, name: "관2" });
    await expect(w3.rpc("board.joinAsSpectator", { ...ref, nick: "관3" })).rejects.toMatchObject({
      message: "관전 인원이 가득 찼습니다. (최대 2명)",
    });
    await w1.rpc("board.leaveRoom", ref);
    await w3.rpc("board.joinAsSpectator", { ...ref, nick: "관3" });
    expect(Object.keys((await room()).spectators).sort()).toEqual([w2.uid, w3.uid].sort());
  });

  it("하트비트가 끊긴 관전자 자리는 다음 사람이 들어올 때 정리됨", async () => {
    const { id, g, room } = await started();
    const ref = { g, id };
    const [w1, w2, w3] = await Promise.all([user("w"), user("w"), user("w")]);
    // w1 은 하트비트를 한 번도 안 보냄, w2 는 방금 보냄
    await w1.rpc("board.joinAsSpectator", { ...ref, nick: "관1" });
    await w2.rpc("board.joinAsSpectator", { ...ref, nick: "관2" });
    await w2.rpc("board.beat", { ...ref, name: "관2" });
    await w3.rpc("board.joinAsSpectator", { ...ref, nick: "관3" });
    expect(Object.keys((await room()).spectators).sort()).toEqual([w2.uid, w3.uid].sort());
  });
});

describe("대국", () => {
  it("수 두기: 서버가 차례·규칙을 검증하고 방 구독자에게 새 상태를 보냄", async () => {
    const { host, guest, sub, call } = await started();
    await expect(call(guest, "makeMove", { move: "e7e5" })).rejects.toMatchObject({ message: "내 차례가 아닙니다." });
    await expect(call(host, "makeMove", { move: "e2e5" })).rejects.toMatchObject({ code: "ILLEGAL_MOVE" });
    await expect(call(await user("x"), "makeMove", { move: "e2e4" })).rejects.toMatchObject({
      message: "대국 중이 아닙니다.",
    });

    const before = sub.data;
    await call(host, "makeMove", { move: "e2e4" });
    const ev = await sub.wait((e) => e.d.moves.length === 1);
    expect(ev.d).toMatchObject({
      moves: ["e2e4"],
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      status: "playing",
    });
    expect(ev.d.v).toBe(before.v + 1);
    expect(ev.d.turnStartedAt).toBeGreaterThanOrEqual(before.turnStartedAt);
  });

  it("체크메이트면 바로 종료 (풀스 메이트)", async () => {
    const { host, guest, call, room } = await started();
    for (const [c, move] of [
      [host, "f2f3"],
      [guest, "e7e5"],
      [host, "g2g4"],
      [guest, "d8h4"],
    ] as const)
      await call(c, "makeMove", { move });
    expect(await room()).toMatchObject({ status: "ended", result: "0-1", reason: "checkmate" });
    await expect(call(host, "makeMove", { move: "a2a3" })).rejects.toMatchObject({ message: "대국 중이 아닙니다." });
  });

  it("시간제: 둔 쪽 시간이 줄고 추가 시간이 붙음, 시간이 남아 있으면 시간패 선언은 무시", async () => {
    const { host, guest, call, room } = await started({ timeMin: 1, incSec: 5 });
    await call(host, "makeMove", { move: "e2e4" });
    const r = await room();
    expect(r.whiteMs).toBeGreaterThan(60_000 + 5000 - 2000);
    expect(r.whiteMs).toBeLessThanOrEqual(65_000);
    expect(r.blackMs).toBe(60_000);
    await call(guest, "claimTimeout");
    expect((await room()).status).toBe("playing");
  });

  it("시간이 다 된 뒤에는 시간패 선언이 받아들여짐 (기물이 있으면 상대 승)", async () => {
    const { host, guest, id, call, room } = await started({ timeMin: 1 });
    await call(host, "makeMove", { move: "e2e4" });
    // 흑 차례가 2분 전에 시작된 것으로
    await s.db.col("chess_rooms").updateOne({ _id: id }, { $set: { turnStartedAt: new Date(Date.now() - 120_000) } });
    await call(host, "claimTimeout");
    expect(await room()).toMatchObject({ status: "ended", result: "1-0", reason: "timeout", blackMs: 0 });
    void guest;
  });

  it("무르기: 방금 둔 쪽은 1수, 상대가 받은 뒤면 2수 되돌림. 거절하면 그대로", async () => {
    const { host, guest, call, room } = await started();
    await call(host, "makeMove", { move: "e2e4" });
    await call(host, "requestUndo");
    expect((await room()).undoReq).toEqual({ uid: host.uid, ply: 1 });
    // 요청한 본인은 수락할 수 없음
    await call(host, "respondUndo", { accept: true });
    expect((await room()).moves).toEqual(["e2e4"]);
    await call(guest, "respondUndo", { accept: false });
    expect(await room()).toMatchObject({ moves: ["e2e4"], undoReq: null });

    await call(guest, "makeMove", { move: "e7e5" });
    await call(host, "requestUndo");
    await call(guest, "respondUndo", { accept: true });
    expect(await room()).toMatchObject({
      moves: [],
      undoReq: null,
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    });

    // 그 사이 수가 진행되면 요청은 무효
    await call(host, "makeMove", { move: "d2d4" });
    await call(host, "requestUndo");
    await call(guest, "makeMove", { move: "d7d5" });
    expect((await room()).undoReq).toBeNull();
    await call(host, "cancelUndo");
  });

  it("무승부 제안·수락, 기권", async () => {
    const a = await started();
    await a.call(a.host, "offerDraw");
    expect((await a.room()).drawOffer).toBe(a.host.uid);
    await a.call(a.host, "respondDraw", { accept: true }); // 제안한 본인은 못 받음
    expect((await a.room()).status).toBe("playing");
    await a.call(a.guest, "respondDraw", { accept: false });
    expect((await a.room()).drawOffer).toBe("");
    await a.call(a.guest, "offerDraw");
    await a.call(a.host, "respondDraw", { accept: true });
    expect(await a.room()).toMatchObject({ status: "ended", result: "1/2-1/2", reason: "agreement" });

    const b = await started();
    await b.call(b.guest, "resign");
    expect(await b.room()).toMatchObject({ status: "ended", result: "1-0", reason: "resign" });
  });

  it("다시 하기: 둘 다 누르면 색을 바꿔 새 대국", async () => {
    const { host, guest, call, room } = await started({ timeMin: 3 });
    await call(host, "makeMove", { move: "e2e4" });
    await call(host, "resign");
    await call(guest, "requestRematch");
    expect(await room()).toMatchObject({ status: "ended", rematch: guest.uid });
    await call(host, "cancelRematch");
    expect((await room()).rematch).toBe("");
    await call(host, "requestRematch");
    await call(guest, "requestRematch");
    expect(await room()).toMatchObject({
      status: "playing",
      whiteUid: guest.uid,
      whiteName: "◦상대",
      blackUid: host.uid,
      blackName: "◦방장",
      moves: [],
      result: "",
      reason: "",
      rematch: "",
      whiteMs: 180_000,
      blackMs: 180_000,
    });
  });

  it("일시정지·재개·시간 추가는 방장만", async () => {
    const { host, guest, call, room } = await started({ timeMin: 1 });
    await expect(call(guest, "pauseGame")).rejects.toMatchObject({ message: "방장만 할 수 있습니다." });
    await call(host, "pauseGame");
    expect((await room()).pausedAt).toBeTypeOf("number");
    await expect(call(host, "makeMove", { move: "e2e4" })).rejects.toMatchObject({ message: "일시정지 중입니다." });
    await expect(call(host, "claimAbandon")).rejects.toMatchObject({
      message: "일시정지 중에는 승리 선언을 할 수 없습니다.",
    });
    await call(host, "addTime", { color: "b" });
    expect((await room()).blackMs).toBe(90_000);
    await call(host, "resumeGame");
    expect((await room()).pausedAt).toBeNull();
    await call(host, "makeMove", { move: "e2e4" });

    const free = await started();
    await expect(free.call(free.host, "addTime", { color: "w" })).rejects.toMatchObject({ message: "무제한 대국입니다." });
  });

  it("2시간 넘게 멈춘 대국은 무승부로 끝남", async () => {
    const { host, guest, id, call, room } = await started();
    await call(host, "pauseGame");
    await call(guest, "expirePausedGame");
    expect((await room()).status).toBe("playing");
    await s.db.col("chess_rooms").updateOne({ _id: id }, { $set: { pausedAt: new Date(Date.now() - 3 * 3600_000) } });
    await expect(call(host, "resumeGame")).rejects.toMatchObject({
      message: "일시정지가 2시간을 넘어 대국이 종료되었습니다.",
    });
    await call(guest, "expirePausedGame");
    expect(await room()).toMatchObject({ status: "ended", result: "1/2-1/2", reason: "paused" });
  });
});

describe("접속 상태 · 승리 선언", () => {
  it("하트비트가 presence 구독자에게 전달되고, 대기방 방장의 하트비트는 방도 갱신", async () => {
    const host = await user("host");
    const id = await create(host);
    const ref = { g: "chess", id };
    const pres = await host.sub("board.presence", ref);
    const room = await host.sub("board.room", ref);
    expect(pres.data).toEqual({});
    await host.rpc("board.beat", { ...ref, name: "방장", bumpRoom: true });
    const ev = await pres.wait((e) => e.t === "presence");
    expect(ev.d[host.uid!]).toMatchObject({ name: "◦방장" });
    expect(Math.abs(ev.d[host.uid!].lastSeen - Date.now())).toBeLessThan(5000);
    expect((await room.wait()).d.updatedAt).toBeGreaterThanOrEqual(room.data.updatedAt);
    // 참가자가 아닌 사람의 하트비트는 기록하지 않음
    const x = await user("x");
    await x.rpc("board.beat", { ...ref, name: "x" });
    expect(Object.keys((await x.sub("board.presence", ref)).data)).toEqual([host.uid]);
  });

  it("상대가 3분 넘게 안 보일 때만 승리 선언 가능", async () => {
    const { host, guest, id, call, room } = await started();
    await call(guest, "beat", { name: "상대" });
    await expect(call(host, "claimAbandon")).rejects.toMatchObject({ message: "상대가 아직 접속 중입니다." });
    await s.db
      .col("board_presence")
      .updateOne({ _id: `chess_rooms/${id}/${guest.uid}` }, { $set: { lastSeen: new Date(Date.now() - 200_000) } });
    await call(host, "claimAbandon");
    expect(await room()).toMatchObject({ status: "ended", result: "1-0", reason: "abandon" });
  });
});

describe("비밀번호 방", () => {
  it("비번이나 초대키를 맞혀야 앉거나 관전할 수 있음", async () => {
    const host = await user("host");
    const id = await create(host, { password: " 1234 " });
    const ref = { g: "chess", id };
    const a = await user("a");
    expect((await a.sub("board.room", ref)).data.locked).toBe(true);
    expect(await a.rpc("board.hasRoomAccess", ref)).toBe(false);
    expect(await host.rpc("board.hasRoomAccess", ref)).toBe(true);
    await expect(a.rpc("board.joinAsPlayer", { ...ref, nick: "a" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(a.rpc("board.joinAsSpectator", { ...ref, nick: "a" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(a.rpc("board.unlockRoom", { ...ref, password: "0000" })).rejects.toMatchObject({
      code: "WRONG_PASSWORD",
      message: "비밀번호가 맞지 않습니다.",
    });
    await expect(a.rpc("board.unlockRoom", { ...ref, invite: "wrong" })).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    // 초대키는 참가자만 받을 수 있음
    expect(await a.rpc("board.inviteKey", ref)).toBe("");
    const key = await host.rpc<string>("board.inviteKey", ref);
    expect(key.length).toBeGreaterThan(10);

    await a.rpc("board.unlockRoom", { ...ref, password: "1234" });
    expect(await a.rpc("board.hasRoomAccess", ref)).toBe(true);
    await a.rpc("board.joinAsSpectator", { ...ref, nick: "a" });

    const b = await user("b");
    await b.rpc("board.unlockRoom", { ...ref, invite: key });
    await b.rpc("board.joinAsPlayer", { ...ref, nick: "b" });
    expect((await b.sub("board.room", ref)).data.blackUid).toBe(b.uid);
  });

  it("비번을 계속 틀리면 잠시 막힘", async () => {
    const host = await user("host");
    const id = await create(host, { password: "pw" });
    const a = await user("a");
    for (let i = 0; i < 10; i++)
      await expect(a.rpc("board.unlockRoom", { g: "chess", id, password: `x${i}` })).rejects.toMatchObject({
        code: "WRONG_PASSWORD",
      });
    await expect(a.rpc("board.unlockRoom", { g: "chess", id, password: "pw" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});

describe("채팅", () => {
  it("대국자·관전자만 쓸 수 있고, 보낸 id 그대로 구독자에게 전달됨", async () => {
    const { host, guest, id, g } = await started();
    const ref = { g, id };
    const anon = await s.client();
    const chat = await anon.sub("board.chat", ref);
    expect(chat.data).toEqual([]);
    await host.rpc("board.sendChat", { ...ref, name: "방장", text: "  안녕  ", cid: "AbCdEfGhIjKlMnOpQrSt" });
    const ev = await chat.wait((e) => e.t === "add");
    expect(ev.d).toMatchObject({ id: "AbCdEfGhIjKlMnOpQrSt", uid: host.uid, name: "◦방장", text: "안녕" });
    expect(ev.d.at).toBeTypeOf("number");
    await guest.rpc("board.sendChat", { ...ref, name: "상대", text: "x".repeat(300) });
    expect((await chat.wait((e) => e.t === "add")).d.text).toHaveLength(200);
    await expect((await user("x")).rpc("board.sendChat", { ...ref, name: "x", text: "끼어들기" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // 나중에 구독한 사람은 오래된 것부터 받음
    const later = (await (await user("y")).sub("board.chat", ref)).data;
    expect(later.map((m: any) => m.name)).toEqual(["◦방장", "◦상대"]);
  });
});

describe("장기 · 오목", () => {
  it("장기: 방 생성과 첫 수", async () => {
    const { host, call, room } = await started({ g: "janggi", variant: "heeh/ehhe" });
    const first = await room();
    expect(first.variant).toBe("heeh/ehhe");
    expect(first.fen.length).toBeGreaterThan(10);
    await expect(call(host, "makeMove", { move: "zz" })).rejects.toMatchObject({ code: "ILLEGAL_MOVE" });
  });

  it("오목: 다섯 개를 이으면 종료", async () => {
    const { host, guest, call, room } = await started({ g: "omok", variant: "free" });
    const black = ["h8", "i8", "j8", "k8", "l8"];
    const white = ["h9", "i9", "j9", "k9"];
    for (let i = 0; i < 5; i++) {
      await call(host, "makeMove", { move: black[i] });
      if (i < 4) await call(guest, "makeMove", { move: white[i] });
    }
    expect(await room()).toMatchObject({ status: "ended", result: "1-0", reason: "five" });
  });
});

describe("관리자", () => {
  it("관리자가 방을 지우면 구독자는 null 을 받고 채팅·접속기록도 지워짐", async () => {
    const { host, id, sub, call } = await started();
    await call(host, "beat", { name: "방장" });
    await call(host, "sendChat", { name: "방장", text: "hi" });
    const res = await s.http("/api/admin/rooms/delete", {
      method: "POST",
      token: await s.adminToken(),
      body: { coll: "chess_rooms", ids: [id] },
    });
    expect(res.status).toBe(204);
    expect((await sub.wait((e) => e.t === "room" && e.d === null)).d).toBeNull();
    for (const col of ["board_chat", "board_presence"])
      expect(await s.db.col(col).countDocuments({ room: `chess_rooms/${id}` })).toBe(0);
    expect(await s.db.col("board_private").countDocuments({ _id: `chess_rooms/${id}` })).toBe(0);
  });
});
