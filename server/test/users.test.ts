import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_EMAIL, startTestServer, type TestClient, type TestServer } from "./helpers";

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

/** 회원(익명이 아닌 로그인) 토큰 */
const memberToken = (uid: string) => s.token(uid, { email: `${uid}@example.com` });
const setNick = async (uid: string, nick: unknown) =>
  s.http("/api/me/nick", { method: "PUT", token: await memberToken(uid), body: { nick } });
/** 별명까지 정한 회원 */
async function member(uid: string, nick: string) {
  expect((await setNick(uid, nick)).status).toBe(200);
  return memberToken(uid);
}

/** 게임을 ago초 한 것처럼 티켓 시각을 돌려 놓고 기록 등록 */
async function rank(token: string, board: string, body: object, ago = 600) {
  const t = await s.http("/api/rankings/tickets", { method: "POST", token, body: { board } });
  await s.db.col("rank_tickets").updateOne({ _id: t.body.ticket }, { $set: { createdAt: new Date(Date.now() - ago * 1000) } });
  return s.http(`/api/rankings/${board}`, { method: "POST", token, body: { ...body, ticket: t.body.ticket } });
}

describe("내 정보 · 별명", () => {
  it("로그인 상태에 따라: 비로그인 401, 익명·별명 없는 회원은 프로필 없음", async () => {
    expect((await s.http("/api/me")).status).toBe(401);
    const anon = await s.http("/api/me", { token: await s.token("anon1") });
    expect(anon.body).toEqual({ uid: "anon1", anonymous: true, admin: false, profile: null });
    const fresh = await s.http("/api/me", { token: await memberToken("fresh1") });
    expect(fresh.body).toEqual({ uid: "fresh1", anonymous: false, admin: false, profile: null });
  });

  it("별명 규칙: 한글·영문·숫자 2~10자, 이모지·공백·기호·예약어 안 됨, 익명은 못 정함", async () => {
    for (const bad of ["a", "열한글자가넘는별명이다", "별 명", "별명😀", "별명!", "◦별명", "admin", "관리자", "건모", "이건모", "GUEST", "", 123])
      expect((await setNick("rule1", bad)).status, String(bad)).toBe(400);
    expect((await s.http("/api/me/nick", { method: "PUT", token: await s.token("anon2"), body: { nick: "익명이" } })).status).toBe(403);
    const ok = await setNick("rule1", "별명_Abc1");
    expect(ok.status).toBe(200);
    expect(ok.body.profile).toMatchObject({ nick: "별명_Abc1", badge: null });
    expect((await s.http("/api/me", { token: await memberToken("rule1") })).body.profile.nick).toBe("별명_Abc1");
  });

  it("별명은 대소문자 구분 없이 하나뿐이고, 바꿀 수 있음", async () => {
    await member("dup1", "Tiger");
    expect((await setNick("dup2", "tiger")).status).toBe(409);
    expect((await setNick("dup2", "TIGER")).body.error.code).toBe("NICK_TAKEN");
    // 본인은 대소문자만 바꿔도 됨
    expect((await setNick("dup1", "tiger")).status).toBe(200);
    // 바꾸면 예전 별명은 다른 사람이 쓸 수 있음
    expect((await setNick("dup1", "Lion")).status).toBe(200);
    expect((await setNick("dup2", "Tiger")).status).toBe(200);
    // 동시에 같은 별명을 요청해도 한 사람만
    const res = await Promise.all(["race1", "race2", "race3"].map((u) => setNick(u, "동시별명")));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it("방문 횟수: 들어올 때 세되, 30분 안에 다시 들어온 것은 같은 방문", async () => {
    const token = await member("vis1", "방문자");
    const visits = async () => (await s.http("/api/me", { token })).body.profile.visits;
    expect(await visits()).toBe(1); // 가입한 날이 첫 방문
    expect(await visits()).toBe(1);
    await s.db.col("users").updateOne({ _id: "vis1" }, { $set: { lastVisitAt: new Date(Date.now() - 31 * 60_000) } });
    expect(await visits()).toBe(2);
    expect(await visits()).toBe(2);
    // 방문을 세기 전에 가입한 계정(값이 없음)은 다음 방문부터 셈
    await s.db.col("users").updateOne({ _id: "vis1" }, { $unset: { visits: "", lastVisitAt: "" } });
    expect(await visits()).toBe(1);
  });

  it("로그인 계정 사진: 들어올 때 적어 두고, 직접 올린 사진이 없으면 랭킹(포커 자금 순위)에 그 사진이 나옴", async () => {
    const pic = "https://lh3.googleusercontent.com/a/test-photo=s96-c";
    const token = await member("pic1", "구글사진");
    const t2 = await s.token("pic1", { email: "pic1@example.com", picture: pic });
    await s.http("/api/me", { token: t2 });
    await s.db.col("users").updateOne({ _id: "pic1" }, { $set: { money: 1, "stats.poker.hands": 3 } });
    const list = (await s.http("/api/poker/rank")).body.list as { nick: string; avatar: string | null }[];
    expect(list.find((r) => r.nick === "구글사진")?.avatar).toBe(pic);
    // 토큰에 사진이 없는 로그인(비밀번호 등)이면 그대로 둠
    await s.http("/api/me", { token });
    expect(((await s.db.col("users").findOne({ _id: "pic1" })) as { photo?: string }).photo).toBe(pic);
  });

  it("프로필 사진: 올리면 주소가 생기고 누구나 볼 수 있음, 지우면 없어짐. 사진이 아닌 파일·큰 파일·비회원은 거절", async () => {
    const token = await member("av1", "사진회원");
    const put = (body: Buffer, type: string, t = token) =>
      fetch(`${s.url}/api/me/avatar`, { method: "PUT", headers: { Authorization: `Bearer ${t}`, "Content-Type": type }, body: new Uint8Array(body) });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
    const res = await put(png, "image/png");
    expect(res.status).toBe(200);
    const { profile } = (await res.json()) as any;
    expect(profile.avatar).toMatch(/^\/api\/avatars\/av1\?v=\d+$/);
    expect((await s.http("/api/me", { token })).body.profile.avatar).toBe(profile.avatar);
    // 로그인 없이도 받아짐, 형식은 파일 내용 기준
    const img = await fetch(s.url + profile.avatar);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await img.arrayBuffer()).equals(png)).toBe(true);
    // 거절: 사진이 아닌 내용(형식만 사진이라고 적음) · 너무 큼 · 별명 없는 회원 · 익명
    expect((await put(Buffer.from("<script>alert(1)</script>"), "image/png")).status).toBe(400);
    expect((await put(Buffer.concat([png, Buffer.alloc(210_000)]), "image/png")).status).toBeGreaterThanOrEqual(400);
    expect((await put(png, "image/png", await memberToken("av-nonick"))).status).toBe(400);
    expect((await put(png, "image/png", await s.token("av-anon"))).status).toBe(403);
    // 지우기
    const del = await s.http("/api/me/avatar", { method: "DELETE", token });
    expect(del.body.profile.avatar).toBeNull();
    expect((await fetch(`${s.url}/api/avatars/av1`)).status).toBe(404);
  });

  it("관리자 계정은 처음 들어올 때 정해 둔 별명(이건모)이 자동으로 붙음", async () => {
    const res = await s.http("/api/me", { token: await s.adminToken() });
    expect(res.body).toMatchObject({ anonymous: false, admin: true, profile: { nick: "이건모" } });
    // 관리자는 예약된 별명도 쓸 수 있음
    expect((await s.http("/api/me/nick", { method: "PUT", token: await s.adminToken(), body: { nick: "건모" } })).status).toBe(200);
    expect((await s.http("/api/me/nick", { method: "PUT", token: await s.adminToken(), body: { nick: "이건모" } })).status).toBe(200);
  });
});

describe("이름이 들어가는 곳", () => {
  it("랭킹: 회원은 보낸 이름과 상관없이 별명으로, 비회원 기록에는 회원 표시가 없음", async () => {
    const token = await member("rk1", "랭커");
    expect((await rank(token, "score", { name: "아무이름", score: 77 })).status).toBe(200);
    expect((await rank(token, "reaction", { score: 250 })).status).toBe(200); // 이름을 안 보내도 됨
    expect((await rank(await s.token("rk-anon"), "score", { name: "손님", score: 70 })).status).toBe(200);
    expect((await rank(await s.token("rk-anon2"), "score", { score: 70 })).status).toBe(400); // 비회원은 이름 필수
    const rows = (await s.http("/api/rankings/score?limit=100")).body;
    expect(rows.find((r: any) => r.score === 77)).toMatchObject({ name: "랭커", member: true });
    const guest = rows.find((r: any) => r.name === "손님");
    expect(guest.member).toBeUndefined();
    expect(guest.uid).toBeUndefined();
  });

  it("별명을 바꾸면 내 랭킹·방명록의 이름도 같이 바뀜. 가입 전 익명 기록도 내 것이 됨", async () => {
    // 가입 전(별명 없음)에 남긴 기록
    const token = await memberToken("mv1");
    await rank(token, "minesweeper_rankings", { name: "가입전", time: 50 });
    await member("mv1", "처음별명");
    await rank(token, "score", { score: 33 });
    await s.http("/api/guest", { method: "POST", token, body: { name: "", contents: "회원 글", id: Date.now(), date: "d" } });
    await setNick("mv1", "바꾼별명");
    expect((await s.http("/api/rankings/minesweeper_rankings?limit=100")).body.find((r: any) => r.time === 50)).toMatchObject({ name: "바꾼별명", member: true });
    expect((await s.http("/api/rankings/score?limit=100")).body.find((r: any) => r.score === 33)).toMatchObject({ name: "바꾼별명" });
    const note = (await s.http("/api/guest")).body.find((g: any) => g.contents === "회원 글");
    expect(note).toMatchObject({ name: "바꾼별명", member: true });
    expect(note.uid).toBeUndefined();
  });

  it("방명록: 비회원은 적은 이름 그대로", async () => {
    await s.http("/api/guest", { method: "POST", body: { name: "지나가던", contents: "손님 글", id: Date.now(), date: "d" } });
    const note = (await s.http("/api/guest")).body.find((g: any) => g.contents === "손님 글");
    expect(note.name).toBe("지나가던");
    expect(note.member).toBeUndefined();
  });

  it("온라인 게임: 회원은 별명, 비회원은 적은 이름 앞에 표시(◦)가 붙음", async () => {
    const mToken = await member("on1", "온라인회원");
    const m = await s.client("on1", { email: "on1@example.com" });
    const g = await s.client("on-guest");
    const id = await m.rpc<string>("board.createRoom", { g: "chess", name: "방", nick: "무시되는이름", color: "w", timeMin: 0, incSec: 0, password: "", variant: "" });
    await g.rpc("board.joinAsPlayer", { g: "chess", id, nick: "◦◦손님" });
    const room = (await g.sub("board.room", { g: "chess", id })).data;
    expect(room).toMatchObject({ whiteName: "온라인회원", blackName: "◦손님" });

    // 접속 중에 별명을 바꾸면 그다음부터 새 별명
    await s.http("/api/me/nick", { method: "PUT", token: mToken, body: { nick: "새별명" } });
    const sk = await m.rpc<string>("sketch.createRoom", { nick: "x", name: "", max: 4, turnMode: "order", drawTime: 60, rounds: 1, hints: false, password: "" });
    await m.rpc("sketch.join", { id: sk, nick: "x" });
    await g.rpc("sketch.join", { id: sk, nick: "손님" });
    const sroom = (await g.sub("sketch.room", { id: sk })).data;
    expect(sroom.meta.name).toBe("새별명의 방");
    expect(sroom.players[m.uid!].nick).toBe("새별명");
    expect(sroom.players[g.uid!].nick).toBe("◦손님");

    const f = await g.rpc<string>("fight.createRoom", { nick: "손님", name: "" });
    await m.rpc("fight.join", { id: f, nick: "아무거나", ch: 0 });
    const froom = (await g.sub("fight.room", { id: f })).data;
    expect(froom.players[m.uid!].nick).toBe("새별명");
  });
});

describe("회원 기록", () => {
  async function playChess(white: TestClient, black: TestClient, end: (call: (c: TestClient, op: string, extra?: object) => Promise<unknown>) => Promise<void>) {
    const id = await white.rpc<string>("board.createRoom", { g: "chess", name: "방", nick: "a", color: "w", timeMin: 0, incSec: 0, password: "", variant: "" });
    await black.rpc("board.joinAsPlayer", { g: "chess", id, nick: "b" });
    await white.rpc("board.startGame", { g: "chess", id });
    const call = (c: TestClient, op: string, extra: object = {}) => c.rpc(`board.${op}`, { g: "chess", id, ...extra });
    await end(call);
  }

  it("격투 온라인 승패: 둘이 같은 결과를 알리면 기록, 다르면 안 함, 기권·경기 중 나감은 그쪽 패배", async () => {
    const aToken = await member("ft1", "격투하나");
    const bToken = await member("ft2", "격투둘");
    const a = await s.client("ft1", { email: "ft1@example.com" });
    const b = await s.client("ft2", { email: "ft2@example.com" });
    const id = await a.rpc<string>("fight.createRoom", { nick: "a", name: "" });
    await a.rpc("fight.join", { id, nick: "a", ch: 0 });
    await b.rpc("fight.join", { id, nick: "b", ch: 0 });
    const start = () => a.rpc<string>("fight.startMatch", { id, chars: [0, 1], map: 0, delay: 2, maxRb: 12 });
    const fightOf = async (t: string) => (await s.http("/api/me/summary", { token: t })).body.stats.online?.fight;
    const settle = () => new Promise((r) => setTimeout(r, 150)); // 기록은 응답을 기다리지 않고 저장됨

    // 1) 둘 다 "1P 승" → 하나 승 1, 둘 패 1 (같은 신고를 또 보내도 한 번만)
    let m = await start();
    await a.rpc("fight.result", { id, match: m, winner: 0 });
    await a.rpc("fight.result", { id, match: m, winner: 0 });
    await settle();
    expect(await fightOf(aToken)).toBeUndefined(); // 한쪽만 알렸으면 아직
    await b.rpc("fight.result", { id, match: m, winner: 0 });
    await a.rpc("fight.endMatch", { id, match: m });
    await settle();
    expect(await fightOf(aToken)).toEqual({ w: 1 });
    expect(await fightOf(bToken)).toEqual({ l: 1 });

    // 2) 서로 다르게 알림 → 기록 안 함
    m = await start();
    await a.rpc("fight.result", { id, match: m, winner: 0 });
    await b.rpc("fight.result", { id, match: m, winner: 1 });
    await settle();
    expect(await fightOf(aToken)).toEqual({ w: 1 });

    // 3) 1P가 경기 중에 기권 → 2P 승
    m = await start();
    await a.rpc("fight.forfeit", { id, match: m });
    await settle();
    expect(await fightOf(aToken)).toEqual({ w: 1, l: 1 });
    expect(await fightOf(bToken)).toEqual({ l: 1, w: 1 });

    // 4) 경기 중에 2P가 방을 나가고 1P가 경기를 끝냄 → 1P 승
    m = await start();
    await b.rpc("fight.leave", { id });
    await a.rpc("fight.endMatch", { id, match: m });
    await settle();
    expect(await fightOf(aToken)).toEqual({ w: 2, l: 1 });
    expect(await fightOf(bToken)).toEqual({ l: 2, w: 1 });

    // 판 수: 격투는 시작한 경기 수(4)로만 셈 (승패 기록은 따로 안 더함)
    expect((await s.http("/api/me", { token: aToken })).body.profile.plays).toBe(4);

    // 일반 방 대전은 레이팅이 없음
    expect((await s.http("/api/me/summary", { token: aToken })).body.fightRating).toBeNull();
  });

  it("격투 랭크전: 회원만 큐, 매칭 → 둘 다 수락 → 전용 방(로비에 안 보임·맵은 서버가 정함·한 판만) → 레이팅·캐릭터 통계", async () => {
    const aToken = await member("rk1", "랭크하나");
    const bToken = await member("rk2", "랭크둘");
    const a = await s.client("rk1", { email: "rk1@example.com" });
    const b = await s.client("rk2", { email: "rk2@example.com" });
    const g = await s.client("rkg");
    await expect(g.rpc("fight.rankQueue", { build: "x", maps: 5 })).rejects.toMatchObject({ code: "MEMBERS_ONLY" });

    const sa = await a.sub("fight.rank");
    const sb = await b.sub("fight.rank");
    expect(sa.data).toEqual({ s: "idle" });
    await a.rpc("fight.rankQueue", { build: "x", maps: 5 });
    expect((await sa.wait((e) => e.d.s === "queue")).d.s).toBe("queue");
    // 빌드가 다르면 안 짝지음
    await member("rk3", "랭크셋");
    const c = await s.client("rk3", { email: "rk3@example.com" });
    await c.rpc("fight.rankQueue", { build: "y", maps: 5 });
    await b.rpc("fight.rankQueue", { build: "x", maps: 3 });
    const fa = (await sa.wait((e) => e.d.s === "found")).d;
    const fb = (await sb.wait((e) => e.d.s === "found")).d;
    expect(fa.id).toBe(fb.id);
    expect(fa.opp).toMatchObject({ nick: "랭크둘", r: 1000, n: 0 });

    // 거절 → 거절한 쪽은 대기, 수락 안 한 상대도 다시 큐로
    await b.rpc("fight.rankRespond", { id: fb.id, accept: false });
    expect((await sb.wait((e) => e.d.s === "idle")).d.s).toBe("idle");
    expect((await sa.wait((e) => e.d.s === "queue")).d.note).toContain("거절");
    await b.rpc("fight.rankQueue", { build: "x", maps: 3 });
    const f2 = (await sa.wait((e) => e.d.s === "found")).d;
    await a.rpc("fight.rankRespond", { id: f2.id, accept: true });
    await b.rpc("fight.rankRespond", { id: f2.id, accept: true });
    const room = (await sa.wait((e) => e.d.s === "room")).d.room as string;
    expect((await sb.wait((e) => e.d.s === "room")).d.room).toBe(room);

    // 로비에 안 보이고, 다른 사람은 못 들어옴
    const lobby = await g.sub("fight.lobby");
    expect(lobby.data.some((r: any) => r.id === room)).toBe(false);
    await expect(g.rpc("fight.join", { id: room, nick: "x", ch: 0 })).rejects.toMatchObject({ code: "ROOM_FULL" });
    expect(await a.rpc("fight.join", { id: room, nick: "a", ch: 0 })).toEqual({ seat: 0 });
    expect(await b.rpc("fight.join", { id: room, nick: "b", ch: 1 })).toEqual({ seat: 1 });
    await expect(a.rpc("fight.setPick", { id: room, pick: 2 })).rejects.toBeTruthy();
    const sub = await a.sub("fight.room", { id: room });
    const mapPick = sub.data.state.pick as number;
    expect(mapPick).toBeGreaterThanOrEqual(0);
    expect(mapPick).toBeLessThan(3);
    // 보낸 맵은 무시하고 서버가 정한 맵, 한 판만
    const m = await a.rpc<string>("fight.startMatch", { id: room, chars: [0, 1], map: 4, delay: 2, maxRb: 12 });
    expect((await sub.wait((e) => e.d.state.match === m)).d.state.map).toBe(mapPick);
    await a.rpc("fight.result", { id: room, match: m, winner: 0 });
    await b.rpc("fight.result", { id: room, match: m, winner: 0 });
    const res = (await sub.wait((e) => e.d.rank?.result?.rated)).d.rank.result;
    expect(res).toMatchObject({ out: 0, rated: true, delta: [20, -20], r: [1020, 980] });
    await a.rpc("fight.endMatch", { id: room, match: m });
    await expect(a.rpc("fight.startMatch", { id: room, chars: [0, 1], map: 0, delay: 2, maxRb: 12 })).rejects.toBeTruthy();

    expect((await s.http("/api/me/summary", { token: aToken })).body.fightRating).toMatchObject({ r: 1020, n: 1, w: 1, rank: 1 });
    expect((await s.http("/api/me/summary", { token: bToken })).body.fightRating).toMatchObject({ r: 980, n: 1, l: 1 });
    const board = (await s.http("/api/rankings/fight-rating")).body as { name: string; r: number; uid?: string }[];
    expect(board.filter((x) => x.name.startsWith("랭크")).map((x) => [x.name, x.r])).toEqual([
      ["랭크하나", 1020],
      ["랭크둘", 980],
    ]);
    const stats = (await s.http("/api/rankings/fight-rank-stats", { token: aToken })).body;
    expect(stats.chars).toEqual(expect.arrayContaining([{ c: 0, w: 1, l: 0, d: 0 }, { c: 1, w: 0, l: 1, d: 0 }]));
    expect(stats.vs).toEqual(expect.arrayContaining([{ a: 0, b: 1, w: 1, g: 1 }]));
    expect(stats.mine).toEqual([{ c: 0, w: 1, l: 0, d: 0 }]);
    void c;
  });

  it("온라인 대국 결과가 전적에 쌓이고, 내 정보에 최고 기록·순위·판 수가 나옴", async () => {
    const aToken = await member("st1", "전적하나");
    const bToken = await member("st2", "전적둘");
    const a = await s.client("st1", { email: "st1@example.com" });
    const b = await s.client("st2", { email: "st2@example.com" });
    // 한 수씩 두고 흑이 기권 → 백 승
    await playChess(a, b, async (call) => {
      await call(a, "makeMove", { move: "e2e4" });
      await call(b, "makeMove", { move: "e7e5" });
      await call(b, "resign");
    });
    // 한 수도 안 두고 끝난 판은 세지 않음
    await playChess(a, b, async (call) => {
      await call(a, "resign");
    });
    // 랭킹 기록: 둘 다 멜론, 전적하나가 더 높음
    await rank(aToken, "score", { score: 201 });
    await rank(bToken, "score", { score: 199 });
    await new Promise((r) => setTimeout(r, 200)); // 기록은 응답을 기다리지 않고 저장됨

    const sumA = (await s.http("/api/me/summary", { token: aToken })).body;
    const sumB = (await s.http("/api/me/summary", { token: bToken })).body;
    expect(sumA.profile.nick).toBe("전적하나");
    expect(sumA.stats.online.chess).toEqual({ w: 1 });
    expect(sumB.stats.online.chess).toEqual({ l: 1 });
    expect(sumA.stats.plays.score).toBe(1);
    // 프로필의 판 수 = 랭킹 게임 시작 1 + 온라인 대국 1
    expect((await s.http("/api/me", { token: aToken })).body.profile.plays).toBe(2);
    const recA = sumA.records.find((r: any) => r.board === "score");
    const recB = sumB.records.find((r: any) => r.board === "score");
    expect(recA).toMatchObject({ score: 201, name: "전적하나" });
    expect(recB.rank).toBe(recA.rank + 1);
    expect(recA.uid).toBeUndefined();

    // 별명을 안 정했으면 요약도 없음, 비로그인은 401
    expect((await s.http("/api/me/summary", { token: await memberToken("nonick") })).body).toEqual({ profile: null });
    expect((await s.http("/api/me/summary")).status).toBe(401);
  });
});
