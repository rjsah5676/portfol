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
  hiddenBy,
  isLot,
} from "../../web/src/lib/gmtown/world";
import type { ChannelList, TownSnap } from "../../web/src/lib/gmtown/types";
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

  it("문 앞은 다른 건물에 가려지지 않음 (쿼터뷰에서 건물 뒤는 안 보임)", () => {
    for (const b of BUILDINGS) {
      const f = doorFront(b);
      for (const o of BUILDINGS)
        if (o !== b)
          expect(
            hiddenBy(o, f.x, f.y, 0) || hiddenBy(o, f.x, f.y, 1.6),
            `${b.id} ← ${o.id}`,
          ).toBe(false);
    }
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
async function member(): Promise<TestClient> {
  const uid = `gm${++n}_${Math.random().toString(36).slice(2, 8)}`;
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
