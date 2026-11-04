import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BOARD,
  BUILDINGS,
  CHANNEL_CAP,
  SPAWN,
  WORLD,
  blocked,
  doorAt,
  doorFront,
  isLot,
  warps,
} from "../../web/src/lib/gmtown/world";
import type { ChannelList, TownSnap } from "../../web/src/lib/gmtown/types";
import { checkLayout, enterAt, fitLayout, houseGeo, levelH, nextLevel, LV_STAIR, CELL, FLOOR_H } from "../../web/src/lib/gmtown/house";
import {
  RpcError,
  sleep,
  startTestServer,
  type TestClient,
  type TestServer,
} from "./helpers";

/*
 * GMTOWN: 마을 지도(부딪힘 · 문) + 채널 들어가기 · 서로 보이기 · 움직이기 검사 · 채팅 · 나가기.
 */

describe("마을 지도", () => {
  it("들어오는 곳 · 모든 문 앞은 걸을 수 있고, 문 앞에 서면 그 건물", () => {
    expect(blocked(SPAWN.x, SPAWN.y)).toBe(false);
    for (const b of BUILDINGS) {
      const f = doorFront(b);
      expect(blocked(f.x, f.y), b.id).toBe(false);
      expect(doorAt(f.x, f.y)?.id, b.id).toBe(b.id);
      // 건물 안은 막힘 (빈 터는 걸어 들어갈 수 있음)
      expect(blocked(b.x + b.w / 2, b.y + b.d / 2), b.id).toBe(!isLot(b));
    }
    expect(blocked(BOARD.x, BOARD.y)).toBe(true);
  });

  it("들어오는 곳에서 모든 문까지 걸어갈 수 있음 (0.5m 격자)", () => {
    const G = 0.5,
      W = Math.ceil(WORLD.w / G),
      H = Math.ceil(WORLD.h / G);
    const seen = new Uint8Array(W * H);
    const at = (x: number, y: number) =>
      Math.floor(y / G) * W + Math.floor(x / G);
    const q = [at(SPAWN.x, SPAWN.y)];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop()!;
      const x = i % W,
        y = (i / W) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && !blocked((nx + 0.5) * G, (ny + 0.5) * G, 0.36)) {
          seen[j] = 1;
          q.push(j);
        }
      }
    }
    for (const b of BUILDINGS)
      expect(seen[at(doorFront(b).x, doorFront(b).y)], b.id).toBe(1);
  });

  it("지도 순간이동 자리는 모두 막히지 않은 곳", () => {
    const w = warps();
    expect(w.length).toBeGreaterThan(5);
    for (const p of w) expect(blocked(p.x, p.y), p.id).toBe(false);
    expect(new Set(w.map((p) => p.id)).size).toBe(w.length);
  });

  it("건물끼리 겹치지 않음", () => {
    for (const a of BUILDINGS)
      for (const b of BUILDINGS) {
        if (a === b) continue;
        const overlap =
          a.x < b.x + b.w &&
          b.x < a.x + a.w &&
          a.y < b.y + b.d &&
          b.y < a.y + a.d;
        expect(overlap, `${a.id} · ${b.id}`).toBe(false);
      }
  });
});

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.close();
});

let n = 0;
let lastUid = "";
async function member(): Promise<TestClient> {
  const uid = `gm${++n}_${Math.random().toString(36).slice(2, 8)}`;
  lastUid = uid;
  const email = `${uid}@example.com`;
  const token = await srv.token(uid, { email });
  const r = await srv.http("/api/me/nick", {
    method: "PUT",
    token,
    body: { nick: `마을${n}` },
  });
  expect(r.status).toBe(200);
  return srv.client(uid, { email });
}
const guest = () =>
  srv.client(`guest_${++n}_${Math.random().toString(36).slice(2, 6)}`);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof RpcError ? e.code : `THROWN:${String(e)}`;
  }
};

describe("광장", () => {
  it("로그인(게스트 포함) 안 하면 못 들어옴", async () => {
    const c = await srv.client();
    expect(await code(c.sub("gmtown.ch", { ch: 7 }))).toBe("UNAUTHENTICATED");
  });

  it("회원 · 게스트가 같은 채널에서 서로 보이고, 걸으면 위치가 감", async () => {
    const a = await member();
    const g = await guest();
    const sa = await a.sub<TownSnap>("gmtown.ch", { ch: 2 });
    expect(sa.data.ch).toBe(2);
    expect(sa.data.cap).toBe(CHANNEL_CAP);
    const meA = sa.data.players.find((p) => p.id === sa.data.me)!;
    expect(meA.name.startsWith("마을")).toBe(true);
    expect(meA.guest).toBe(false);
    expect(blocked(meA.x, meA.y)).toBe(false);

    const sg = await g.sub<TownSnap>("gmtown.ch", { ch: 2 });
    const meG = sg.data.players.find((p) => p.id === sg.data.me)!;
    expect(meG.guest).toBe(true);
    expect(meG.name).toMatch(/^◦손님\d{4}$/);
    expect(sg.data.players.some((p) => p.id === sa.data.me)).toBe(true);
    const joined = await sa.wait(
      (e) => e.t === "join" && e.d.id === sg.data.me,
    );
    expect(joined.d.guest).toBe(true);

    // 조금 걸음 → 다른 사람에게 mv
    await g.rpc("gmtown.move", { x: meG.x + 0.2, y: meG.y, d: 2, m: 1 });
    const mv = await sa.wait(
      (e) => e.t === "mv" && e.d.some((r: unknown[]) => r[0] === sg.data.me),
    );
    const row = mv.d.find((r: unknown[]) => r[0] === sg.data.me);
    expect(row[1]).toBeCloseTo(meG.x + 0.2, 1);
    expect(row[3]).toBe(2);
    expect(row[4]).toBe(1);

    // 나가면 leave
    g.close();
    const left = await sa.wait((e) => e.t === "leave" && e.d === sg.data.me);
    expect(left).toBeTruthy();
    a.close();
  });

  it("순간이동 · 막힌 곳은 서버가 바로잡음 (snap)", async () => {
    const a = await member();
    const s = await a.sub<TownSnap>("gmtown.ch", {
      ch: 3,
      x: SPAWN.x,
      y: SPAWN.y,
    });
    const me = s.data.players.find((p) => p.id === s.data.me)!;
    expect(me.x).toBe(SPAWN.x);
    // 안내판 안으로
    await a.rpc("gmtown.move", { x: BOARD.x, y: BOARD.y, d: 2, m: 1 });
    const back = await s.wait((e) => e.t === "snap");
    expect(back.d).toEqual({ x: SPAWN.x, y: SPAWN.y });
    // 멀리 순간이동 (광장 쪽 큰길) → 예산(2.5m)만큼만
    await a.rpc("gmtown.move", {
      x: SPAWN.x - 20,
      y: SPAWN.y - 20,
      d: 7,
      m: 1,
    });
    const cut = await s.wait((e) => e.t === "snap" && e.d.x !== SPAWN.x);
    const moved = Math.hypot(cut.d.x - SPAWN.x, cut.d.y - SPAWN.y);
    expect(moved).toBeGreaterThan(2);
    expect(moved).toBeLessThan(2.7);
    a.close();
  });

  it("지도 순간이동: 정해진 곳만 · 잠깐 쉬었다 다시 · 다른 사람에게도 옮겨 보임", async () => {
    const a = await member();
    const b = await member();
    const sa = await a.sub<TownSnap>("gmtown.ch", { ch: 6 });
    const sb = await b.sub<TownSnap>("gmtown.ch", { ch: 6 });
    const to = warps().find((w) => w.id === "stock")!;
    const r = await a.rpc<{ x: number; y: number }>("gmtown.warp", { to: "stock" });
    expect(r.x).toBeCloseTo(to.x, 1);
    expect(r.y).toBeCloseTo(to.y, 1);
    const mv = await sb.wait(
      (e) => e.t === "mv" && e.d.some((row: unknown[]) => row[0] === sa.data.me),
    );
    const row = mv.d.find((row: unknown[]) => row[0] === sa.data.me);
    expect(row[1]).toBeCloseTo(to.x, 1);
    // 이어서 걸으면 새 자리에서부터
    await a.rpc("gmtown.move", { x: to.x + 0.3, y: to.y, d: 2, m: 1 });
    expect(await code(a.rpc("gmtown.warp", { to: "plaza" }))).toBe("RATE_LIMITED");
    expect(await code(a.rpc("gmtown.warp", { to: "nowhere" }))).toBe("BAD_REQUEST");
    a.close();
    b.close();
  });

  it("캐릭터 바꾸기: 같은 채널에 char · 다시 들어온 사람도 새 캐릭터로 보임 · 없는 캐릭터는 거절", async () => {
    const a = await member();
    const b = await member();
    const sa = await a.sub<TownSnap>("gmtown.ch", { ch: 8, c: "amy" });
    const sb = await b.sub<TownSnap>("gmtown.ch", { ch: 8 });
    await a.rpc("gmtown.char", { c: "sera" });
    const ev = await sb.wait((e) => e.t === "char" && e.d.id === sa.data.me);
    expect(ev.d.c).toBe("sera");
    const c = await member();
    const sc = await c.sub<TownSnap>("gmtown.ch", { ch: 8 });
    expect(sc.data.players.find((p) => p.id === sa.data.me)?.c).toBe("sera");
    expect(await code(a.rpc("gmtown.char", { c: "nobody" }))).toBe("BAD_REQUEST");
    a.close();
    b.close();
    c.close();
  });

  it("집 계약: 게스트 거절 · GP 모자라면 거절 · 한 단계씩 · 이미 산 단계 거절 · GP 차감", async () => {
    const g = await guest();
    await g.sub<TownSnap>("gmtown.ch", { ch: 9 });
    expect((await g.rpc<{ tier: number; gp: number | null }>("gmtown.house")).gp).toBeNull();
    expect(await code(g.rpc("gmtown.house.buy", { tier: 1 }))).toBe("FORBIDDEN");
    g.close();

    const a = await member();
    const uid = lastUid;
    await a.sub<TownSnap>("gmtown.ch", { ch: 9 });
    await srv.db.col("users").updateOne({ _id: uid }, { $set: { points: 0 } });
    expect((await a.rpc<{ tier: number }>("gmtown.house")).tier).toBe(0);
    expect(await code(a.rpc("gmtown.house.buy", { tier: 1 }))).not.toBe("OK");
    await srv.db.col("users").updateOne({ _id: uid }, { $set: { points: 30_000 } });
    expect(await code(a.rpc("gmtown.house.buy", { tier: 2 }))).toBe("BAD_REQUEST");
    const r1 = await a.rpc<{ tier: number; gp: number }>("gmtown.house.buy", { tier: 1 });
    expect(r1.tier).toBe(1);
    expect(r1.gp).toBe(30_000 - 5_000);
    expect(await code(a.rpc("gmtown.house.buy", { tier: 1 }))).toBe("ALREADY");
    const r2 = await a.rpc<{ tier: number; gp: number }>("gmtown.house.buy", { tier: 2 });
    expect(r2.tier).toBe(2);
    expect(r2.gp).toBe(30_000 - 5_000 - 15_000);
    expect((await a.rpc<{ tier: number }>("gmtown.house")).tier).toBe(2);
    a.close();
  });

  it("집 안: 첫 계약에 기본 가구 · 가게 · 배치 저장(겹침 · 방 밖 · 개수 거절) · 들어가면 마을에서 안 보이고 나오면 문 앞", async () => {
    const a = await member();
    const uid = lastUid;
    const b = await member();
    const sa = await a.sub<TownSnap>("gmtown.ch", { ch: 10 });
    const sb = await b.sub<TownSnap>("gmtown.ch", { ch: 10 });
    expect(await code(a.rpc("gmtown.house.enter"))).toBe("BAD_REQUEST");
    await srv.db.col("users").updateOne({ _id: uid }, { $set: { points: 20_000 } });
    const h = await a.rpc<{ tier: number; inv: Record<string, number>; layout: unknown[] }>("gmtown.house.buy", { tier: 1 });
    expect(h.inv.bed).toBe(1);
    expect(h.layout.length).toBeGreaterThan(3);
    // 가게
    const h2 = await a.rpc<{ inv: Record<string, number>; gp: number }>("gmtown.house.shop", { id: "sofa" });
    expect(h2.inv.sofa).toBe(1);
    expect(h2.gp).toBe(20_000 - 5_000 - 3_000);
    // 배치
    const ok = [...(h.layout as object[]), { i: "sofa", x: 0, y: 5, r: 0 }];
    expect(await code(a.rpc("gmtown.house.save", { layout: ok }))).toBe("OK");
    expect(await code(a.rpc("gmtown.house.save", { layout: [...ok, { i: "sofa", x: 6, y: 0, r: 0 }] }))).toBe("BAD_REQUEST");
    expect(await code(a.rpc("gmtown.house.save", { layout: [{ i: "bed", x: 10, y: 0, r: 0 }] }))).toBe("BAD_REQUEST");
    expect(await code(a.rpc("gmtown.house.save", { layout: [{ i: "bed", x: 0, y: 0, r: 0 }, { i: "desk", x: 1, y: 1, r: 0 }] }))).toBe("BAD_REQUEST");
    expect((await a.rpc<{ layout: unknown[] }>("gmtown.house")).layout.length).toBe(ok.length);
    // 들어가기 · 나오기
    await a.rpc("gmtown.house.enter");
    const ev = await sb.wait((e) => e.t === "home" && e.d.id === sa.data.me);
    expect(ev.d.on).toBe(true);
    const c = await member();
    const sc = await c.sub<TownSnap>("gmtown.ch", { ch: 10 });
    expect(sc.data.players.find((p) => p.id === sa.data.me)?.home).toBeTruthy();
    const out = await a.rpc<{ x: number; y: number }>("gmtown.house.leave");
    const ev2 = await sb.wait((e) => e.t === "home" && e.d.id === sa.data.me && e.d.on === false);
    expect(ev2.d.x).toBeCloseTo(out.x, 1);
    expect(blocked(out.x, out.y)).toBe(false);
    a.close();
    b.close();
    c.close();
  });

  it("2층 집 · 정원: 계단 자리 · 층 · 마당 가구 검사, 넓히면 안 맞는 가구는 빠짐, 계단으로 오르내림", () => {
    const inv = { bed: 2, sofa: 1, tree: 1, chair: 1, rug: 1 };
    // 2층은 3단계부터
    expect(checkLayout(2, [{ i: "sofa", x: 6, y: 0, r: 0, f: 1 }], inv)).not.toBeNull();
    expect(checkLayout(3, [{ i: "sofa", x: 6, y: 0, r: 0, f: 1 }], inv)).toBeNull();
    // 계단 자리 (1층 · 2층 구멍) — 러그도 안 됨
    const g = houseGeo(3);
    expect(checkLayout(3, [{ i: "sofa", x: 0, y: g.stair!.y0 + 2, r: 0 }], inv)).toContain("계단");
    expect(checkLayout(3, [{ i: "rug", x: 0, y: g.stair!.y0, r: 0, f: 1 }], inv)).toContain("계단");
    // 정원 가구는 마당에만, 집 가구는 집 안에만, 의자는 어디든
    const g4 = houseGeo(4);
    expect(checkLayout(3, [{ i: "tree", x: 10, y: 0, r: 0 }], inv)).not.toBeNull();
    expect(checkLayout(4, [{ i: "tree", x: 3, y: g4.d + 2, r: 0 }], inv)).toBeNull();
    expect(checkLayout(4, [{ i: "tree", x: 3, y: 2, r: 0 }], inv)).not.toBeNull();
    expect(checkLayout(4, [{ i: "sofa", x: 3, y: g4.d + 2, r: 0 }], inv)).not.toBeNull();
    expect(checkLayout(4, [{ i: "chair", x: 3, y: g4.d + 2, r: 0 }], inv)).toBeNull();
    expect(checkLayout(4, [{ i: "tree", x: 3, y: g4.d - 1, r: 0 }], inv)).not.toBeNull();
    // 대문 가는 길
    expect(checkLayout(4, [{ i: "chair", x: g4.door.x0, y: g4.gd - 3, r: 0 }], inv)).not.toBeNull();
    // 넓힐 때: 계단 자리에 있던 소파는 빠지고 침대는 그대로
    const kept = fitLayout(3, [{ i: "bed", x: 6, y: 0, r: 0 }, { i: "sofa", x: 0, y: 6, r: 0 }], inv);
    expect(kept.map((p) => p.i)).toEqual(["bed"]);
    // 계단: 아래에서 들어가 위로 나오면 2층 (높이 0 → FLOOR_H)
    const s = g.stair!;
    const x = g.ox + ((s.x0 + s.x1) / 2) * CELL;
    let lv = 0;
    for (let y = g.oy + (s.y1 + 0.5) * CELL; y > g.oy + (s.y0 - 1) * CELL; y -= 0.1) {
      lv = nextLevel(g, lv, x, y);
      if (lv === LV_STAIR) expect(levelH(g, lv, x, y)).toBeGreaterThanOrEqual(0);
    }
    expect(lv).toBe(1);
    expect(levelH(g, lv, x, g.oy)).toBe(FLOOR_H);
    for (let y = g.oy + (s.y0 - 0.5) * CELL; y < g.oy + (s.y1 + 1) * CELL; y += 0.1) lv = nextLevel(g, lv, x, y);
    expect(lv).toBe(0);
    // 들어오는 곳 (정원 주택은 대문 안쪽)
    expect(enterAt(4).y).toBeGreaterThan(g4.oy + g4.dm);
  });

  it("친구 초대: 초대받은 사람만 놀러 감 · 같은 집 사람은 집 안 움직임(층)을 봄 · 주인이 가구를 바꾸면 hlayout", async () => {
    const a = await member();
    const ua = lastUid;
    const b = await member();
    const g = await guest();
    const sa = await a.sub<TownSnap>("gmtown.ch", { ch: 12 });
    const sb = await b.sub<TownSnap>("gmtown.ch", { ch: 12 });
    const sg = await g.sub<TownSnap>("gmtown.ch", { ch: 12 });
    // 집이 없으면 초대 못 함 · 게스트는 초대 못 함
    expect(await code(a.rpc("gmtown.house.invite", { to: sb.data.me }))).toBe("BAD_REQUEST");
    expect(await code(g.rpc("gmtown.house.invite", { to: sa.data.me }))).toBe("FORBIDDEN");
    await srv.db.col("users").updateOne({ _id: ua }, { $set: { points: 20_000 } });
    const h = await a.rpc<{ layout: object[] }>("gmtown.house.buy", { tier: 1 });
    const me = await a.rpc<{ room: string }>("gmtown.house.enter");
    // 초대 없이는 못 감
    expect(await code(b.rpc("gmtown.house.visit", { from: sa.data.me }))).toBe("FORBIDDEN");
    await a.rpc("gmtown.house.invite", { to: sb.data.me });
    const inv = await sb.wait((e) => e.t === "invite");
    expect(inv.d.from).toBe(sa.data.me);
    // 다른 사람(게스트)은 이 초대로 못 감
    expect(await code(g.rpc("gmtown.house.visit", { from: sa.data.me }))).toBe("FORBIDDEN");
    const v = await b.rpc<{ room: string; owner: string; tier: number; layout: unknown[] }>("gmtown.house.visit", { from: sa.data.me });
    expect(v.room).toBe(me.room);
    expect(v.tier).toBe(1);
    expect(v.owner).toBeTruthy();
    const ev = await sa.wait((e) => e.t === "home" && e.d.id === sb.data.me && e.d.on === true);
    expect(ev.d.room).toBe(me.room);
    // 집 안에서 걸음 (층 포함) — 같은 채널에 mv
    const at = enterAt(1);
    await b.rpc("gmtown.move", { x: at.x, y: at.y - 0.5, d: 0, m: 1, f: 0 });
    const mv = await sa.wait((e) => e.t === "mv" && e.d.some((r: unknown[]) => r[0] === sb.data.me));
    const row = mv.d.find((r: unknown[]) => r[0] === sb.data.me);
    expect(row[2]).toBeCloseTo(at.y - 0.5, 1);
    expect(row[5]).toBe(0);
    // 주인이 가구를 옮기면 놀러 온 사람에게 hlayout
    await a.rpc("gmtown.house.save", { layout: h.layout.slice(0, 2) });
    const hl = await sb.wait((e) => e.t === "hlayout");
    expect(hl.d.room).toBe(me.room);
    expect(hl.d.layout.length).toBe(2);
    a.close();
    b.close();
    g.close();
  });

  it("돈 표시: 회원은 GP · 포커 칩(금고 포함) · 주식 총자산, 게스트는 없음", async () => {
    const g = await guest();
    await g.sub<TownSnap>("gmtown.ch", { ch: 13 });
    expect(await g.rpc("gmtown.wallet")).toBeNull();
    g.close();
    const a = await member();
    const uid = lastUid;
    await a.sub<TownSnap>("gmtown.ch", { ch: 13 });
    await srv.db.col("users").updateOne({ _id: uid }, { $set: { points: 1234, money: 5_000_000, "poker.vault": 1_000_000, stk: { cash: 70_000_000, held: 20_000_000, coinHeld: 5_000_000 } } });
    const w = await a.rpc<{ gp: number; chips: number; stock: number }>("gmtown.wallet");
    expect(w).toEqual({ gp: 1234, chips: 6_000_000, stock: 95_000_000 });
    a.close();
  });

  it("채팅: 같은 채널 모두에게 · 너무 빠르면 거절 · 길면 자름 · 다른 채널엔 안 감", async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    const sa = await a.sub<TownSnap>("gmtown.ch", { ch: 4 });
    const sb = await b.sub<TownSnap>("gmtown.ch", { ch: 4 });
    const sc = await c.sub<TownSnap>("gmtown.ch", { ch: 5 });
    await a.rpc("gmtown.chat", { text: "  안녕\n하세요  " });
    const got = await sb.wait((e) => e.t === "chat");
    expect(got.d.text).toBe("안녕 하세요");
    expect(got.d.id).toBe(sa.data.me);
    expect(await code(a.rpc("gmtown.chat", { text: "또" }))).toBe(
      "RATE_LIMITED",
    );
    await sleep(750);
    await a.rpc("gmtown.chat", { text: "가".repeat(200) });
    const long = await sb.wait(
      (e) => e.t === "chat" && e.d.text.startsWith("가"),
    );
    expect(long.d.text.length).toBe(60);
    await sleep(100);
    expect(sc.events.some((e) => e.t === "chat")).toBe(false);
    // 늦게 온 사람도 최근 채팅을 받음
    const d = await member();
    const sd = await d.sub<TownSnap>("gmtown.ch", { ch: 4 });
    expect(sd.data.chat.map((m) => m.text)).toContain("안녕 하세요");
    for (const x of [a, b, c, d]) x.close();
  });

  it("채널 목록 · 채널 옮기기 (옮기면 이전 채널에서 나감)", async () => {
    const a = await member();
    const b = await member();
    const sa = await a.sub<TownSnap>("gmtown.ch", { ch: 6 });
    const sb = await b.sub<TownSnap>("gmtown.ch", { ch: 6 });
    const list = await a.rpc<ChannelList>("gmtown.channels");
    expect(list.list.find((r) => r.ch === 6)?.n).toBe(2);
    expect(list.list.some((r) => r.n === 0)).toBe(true);
    // b 가 8채널로 (위치 이어감)
    const pos = sb.data.players.find((p) => p.id === sb.data.me)!;
    const s8 = await b.sub<TownSnap>("gmtown.ch", {
      ch: 8,
      x: pos.x,
      y: pos.y,
    });
    sb.close();
    expect(s8.data.ch).toBe(8);
    expect(s8.data.players.find((p) => p.id === s8.data.me)!.x).toBe(pos.x);
    await sa.wait((e) => e.t === "leave");
    const after = await a.rpc<ChannelList>("gmtown.channels");
    expect(after.list.find((r) => r.ch === 6)?.n).toBe(1);
    expect(after.list.find((r) => r.ch === 8)?.n).toBe(1);
    a.close();
    b.close();
  });
});
