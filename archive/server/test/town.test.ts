import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { botChoice, type OCView } from "../../web/src/lib/town/onecard";
import { sleep, startTestServer, type TestClient, type TestServer } from "./helpers";

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

let seq = 0;
const user = (name: string) => s.client(`${name}-${++seq}`);
const ME = (nick: string) => ({ nick, char: "haru", look: "base" });

async function makeRoom(host: TestClient, o: object = {}) {
  return host.rpc<{ id: string; seat: number }>("town.create", { ...ME("방장"), ...o });
}

describe("TABLE TOWN 방", () => {
  it("방을 만들면 로비에 보이고, 봇 채우기면 봇 한 명이 먼저 앉아 있음", async () => {
    const anon = await s.client();
    const lobby = await anon.sub("town.lobby", { game: "onecard" });
    const host = await user("h");
    const { id, seat } = await makeRoom(host, { title: "  한 판 하실 분~ ", level: 2 });
    expect(seat).toBe(0);
    const ev = await lobby.wait((e) => e.d.some((r: any) => r.id === id));
    const item = ev.d.find((r: any) => r.id === id);
    expect(item).toMatchObject({ title: "한 판 하실 분~", count: 2, humans: 1, max: 4, level: 2, phase: "wait" });
    expect(item.host.nick).toBe("◦방장");
  });

  it("게스트 닉네임 검사 · 운영자 사칭 거절", async () => {
    const c = await user("bad");
    await expect(c.rpc("town.create", ME("관리자"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(c.rpc("town.create", ME("a"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("방장은 강퇴 · 강퇴된 사람은 다시 못 들어옴", async () => {
    const host = await user("h");
    const { id } = await makeRoom(host);
    const guest = await user("g");
    const r = await guest.rpc("town.join", { id, ...ME("손님") });
    expect(r.seat).toBe(2);
    const sub = await host.sub("town.room", { id });
    // 방장이 아니면 강퇴 못 함
    await expect(guest.rpc("town.kick", { id, seat: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await host.rpc("town.kick", { id, seat: 2 });
    await sub.wait((e) => e.t === "room" && e.d.seats[2] === null);
    await expect(guest.rpc("town.join", { id, ...ME("손님") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // 봇도 내보낼 수 있음
    await host.rpc("town.kick", { id, seat: 1 });
    await sub.wait((e) => e.t === "room" && e.d.seats[1] === null);
  });

  it("바로 입장이 꺼진 방은 방장이 허락해야 앉음 · 비밀번호 방", async () => {
    const host = await user("h");
    const { id } = await makeRoom(host, { autoJoin: false, password: "1234" });
    const g = await user("g");
    await expect(g.rpc("town.join", { id, ...ME("손님") })).rejects.toMatchObject({ code: "NEED_PASSWORD" });
    await expect(g.rpc("town.join", { id, ...ME("손님"), password: "0000" })).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    const gsub = await g.sub("town.room", { id });
    const res = await g.rpc("town.join", { id, ...ME("손님"), password: "1234" });
    expect(res.knock).toBe(true);
    const hs = await host.sub("town.room", { id });
    expect(hs.data.room.knock.map((k: any) => k.nick)).toEqual(["◦손님"]);
    await host.rpc("town.approve", { id, uid: g.uid, ok: true });
    await gsub.wait((e) => e.t === "room" && e.d.seats.some((x: any) => x?.uid === g.uid));
  });

  it("빠른 입장: 빈 자리 있는 공개 방으로, 없으면 새 방", async () => {
    const host = await user("h");
    const { id } = await makeRoom(host, { title: "빠른방" });
    const q = await user("q");
    const r = await q.rpc("town.quick", { ...ME("빠른이"), game: "onecard" });
    expect(r.made).toBe(false);
    expect(typeof r.id).toBe("string");
    // 방 하나가 꽉 차면 새로 만듦 (봇 자리는 사람에게 내줌)
    const lone = await user("l");
    const mine = await lone.rpc("town.quick", { ...ME("혼자"), game: "onecard" });
    expect(mine.id).toBeTruthy();
    void id;
  });

  it("판: 내 손패만 보이고, 내 차례에만 낼 수 있음 · 끝까지 가면 결과와 코인", async () => {
    const host = await user("h");
    const { id } = await makeRoom(host, { level: 0, mode: "fast" });
    const g = await user("g");
    await g.rpc("town.join", { id, ...ME("손님") });
    const hs = await host.sub("town.room", { id });
    const gs = await g.sub("town.room", { id });
    await host.rpc("town.start", { id });
    const first = (await hs.wait((e) => e.t === "game")).d;
    const v: OCView = first.v;
    expect(v.n).toBe(4);
    expect(v.hand).toHaveLength(5);
    expect(v.counts.every((c: number) => c === 5)).toBe(true);
    const gv: OCView = (await gs.wait((e) => e.t === "game")).d.v;
    expect(gv.me).not.toBe(v.me);
    // 남의 차례에 내면 무시
    const notMine = v.turn === v.me ? g : host;
    const nm = notMine === host ? v : gv;
    expect((await notMine.rpc("town.play", { id, seq: nm.seq, card: nm.hand![0].id })).ok).toBe(false);

    // 둘 다 자동으로 둠: 내 차례면 봇처럼 고르고, 원카드 창이 열리면 외침
    const latest = new Map<TestClient, OCView>();
    const loop = async (c: TestClient, sub: any) => {
      let seen = 0;
      for (;;) {
        await sleep(5);
        const evs = sub.events.slice(seen);
        seen = sub.events.length;
        for (const e of evs) if (e.t === "game") latest.set(c, e.d.v);
        if (evs.some((e: any) => e.t === "room" && e.d.result)) return evs.find((e: any) => e.t === "room" && e.d.result).d.result;
        const lv = latest.get(c);
        if (!lv || lv.over) continue;
        if (lv.one && lv.one.pi === lv.me && !lv.one.called) await c.rpc("town.one", { id }).catch(() => {});
        if (lv.turn === lv.me && lv.hand) {
          const st: any = { ...lv, hands: Array.from({ length: lv.n }, (_, i) => (i === lv.me ? lv.hand : Array(lv.counts[i]).fill({ id: -1, r: 0, s: 9 }))), pile: [lv.top], draw: [] };
          const ch = botChoice(st, lv.me, "normal", Math.random, 1);
          if (ch) await c.rpc("town.play", { id, seq: lv.seq, card: ch.id, suit: ch.suit }).catch(() => {});
          else await c.rpc("town.draw", { id, seq: lv.seq }).catch(() => {});
          latest.delete(c);
        }
      }
    };
    const [res] = await Promise.all([loop(host, hs), loop(g, gs)]);
    expect(res.order).toHaveLength(4);
    expect(res.gain.reduce((a: number, b: number) => a + b, 0)).toBeGreaterThan(0);
  }, 90_000);

  it("판 중에 끊긴 사람은 자동으로 진행되고, 끝나면 자리에서 빠짐", async () => {
    const host = await user("h");
    const { id } = await makeRoom(host, { mode: "fast" });
    const g = await user("g");
    await g.rpc("town.join", { id, ...ME("손님") });
    const hs = await host.sub("town.room", { id });
    await host.rpc("town.start", { id });
    g.close();
    await hs.wait((e) => e.t === "room" && e.d.seats[2]?.away === true, 5000);
    // 방장도 손 놓고 기다리면(시간 초과 → 자동 받기) 너무 오래 걸리니 방장도 나감 → 둘 다 자동
    const host2 = await user("w");
    const ws = await host2.sub("town.room", { id });
    await host.rpc("town.leave", { id });
    const end = await ws.wait((e) => e.t === "room" && !!e.d?.result, 80_000);
    expect(end.d.seats[2]).toBeNull();
  }, 90_000);

  it("회원: 내 정보 · 방 만들기 · 뽑기 · 장착 (코인 · 코스튬이 서버에)", async () => {
    const uid = `mem-${++seq}`;
    const token = await s.token(uid, { email: `${uid}@example.com` });
    expect((await s.http("/api/me/nick", { method: "PUT", token, body: { nick: "회원님" } })).status).toBe(200);
    const m = await s.client(uid, { email: `${uid}@example.com` });
    const me = await m.rpc("town.me");
    expect(me).toMatchObject({ coins: 1000, owned: [], pity: 0, char: "haru", look: "base" });
    // 방: 이름은 별명 (게스트 표시 없음)
    const { id } = await m.rpc("town.create", { nick: "", char: "ruru", look: "base" });
    const sub = await m.sub("town.room", { id });
    expect(sub.data.room.seats[0]).toMatchObject({ nick: "회원님", member: true, char: "haru" });
    // 뽑기: 300 쓰고 꽝이면 50 돌려받음
    const g = await m.rpc("town.gacha", { feat: 0, n: 1 });
    expect(g.pulls).toHaveLength(1);
    expect(g.me.coins).toBe(g.pulls[0].kind === "lucky" ? 750 : 700);
    // 없는 코스튬은 장착 못 함
    if (g.pulls[0].kind === "lucky") await expect(m.rpc("town.setLook", { char: "haru", look: "cos1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await m.rpc("town.setLook", { char: "ruru", look: "base" })).toMatchObject({ char: "ruru", look: "base" });
    // 게스트는 회원 기능을 못 씀
    const guest = await user("gg");
    expect(await guest.rpc("town.me")).toBeNull();
    await expect(guest.rpc("town.gacha", { feat: 0, n: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("코인 상점: GP 로 코인 사기 (모자라면 거절) · 마을 채팅", async () => {
    const uid = `buy-${++seq}`;
    const token = await s.token(uid, { email: `${uid}@example.com` });
    expect((await s.http("/api/me/nick", { method: "PUT", token, body: { nick: "사는사람" } })).status).toBe(200);
    await s.db.col("users").updateOne({ _id: uid }, { $set: { points: 1800 } });
    const m = await s.client(uid, { email: `${uid}@example.com` });
    await m.rpc("town.me");
    const r = await m.rpc("town.buyCoins", { pack: "m" });
    expect(r.points).toBe(300);
    expect(r.me.coins).toBe(1000 + 3300);
    await expect(m.rpc("town.buyCoins", { pack: "s" })).rejects.toBeTruthy();
    expect((await m.rpc("town.me")).coins).toBe(4300);
    // 마을 채팅
    const g = await user("sq");
    const sub = await g.sub("town.square");
    await m.rpc("town.say", { nick: "", char: "haru", look: "base", text: "  안녕하세요  " });
    const ev = await sub.wait((e) => e.t === "say");
    expect(ev.d).toMatchObject({ nick: "사는사람", text: "안녕하세요" });
    await expect(m.rpc("town.say", { nick: "", char: "haru", look: "base", text: "도배" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
