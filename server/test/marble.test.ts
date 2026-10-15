import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHARS, CHAR_UP_DUPES, GACHA, ITEMS, STARTER, fxOf, power } from "../../web/src/lib/marble/data";
import { act, newGame, standings, timeoutAction, type Game } from "../../web/src/lib/marble/engine";
import { botAction } from "../../web/src/lib/marble/bot";
import { MAPS, MAP_IDS } from "../../web/src/lib/marble/maps";
import { pullChars, pullItems, type Owned } from "../../web/src/lib/marble/gacha";
import { startTestServer, type TestClient, type TestServer } from "./helpers";

const lo = (id = "kai") => ({ char: { id, lv: 0 } });
function botGame(map: (typeof MAP_IDS)[number], seed: number): Game {
  const g = newGame({ map, seed, players: [0, 1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, bot: true, lo: lo(CHARS[(seed + i) % CHARS.length].id) })) });
  let guard = 0;
  while (!g.over && guard++ < 5000) act(g, g.prompt!.p, botAction(g));
  return g;
}

describe("픽셀 마블 엔진", () => {
  it("맵: 칸 · 그룹 · 라인 · 다음 칸이 맞음", () => {
    for (const id of MAP_IDS) {
      const m = MAPS[id];
      expect(m.tiles.filter((t) => t.kind === "start")).toHaveLength(1);
      expect(m.tiles.filter((t) => t.kind === "jail").length).toBeGreaterThanOrEqual(1);
      for (const t of m.tiles) for (const n of t.next) expect(m.tiles[n]).toBeTruthy();
      for (let gi = 0; gi < m.groups.length; gi++) expect(m.tiles.filter((t) => t.group === gi).length).toBeGreaterThanOrEqual(2);
      // 격자 좌표가 겹치지 않음
      expect(new Set(m.tiles.map((t) => `${t.x},${t.y}`)).size).toBe(m.tiles.length);
    }
  });

  it("AI 끼리 세 맵 모두 끝까지 감 · 같은 시드면 같은 판", () => {
    for (const map of MAP_IDS)
      for (const seed of [1, 2, 3]) {
        const a = botGame(map, seed);
        expect(a.over).toBeTruthy();
        const b = botGame(map, seed);
        expect(b.over).toEqual(a.over);
        expect(standings(a)).toHaveLength(3);
      }
  });

  it("시간이 다 되면 대신 하는 행동은 늘 받아들여짐", () => {
    const g = newGame({ map: "cross", seed: 9, players: [{ id: "a", name: "A", bot: false, lo: lo() }, { id: "b", name: "B", bot: false, lo: lo("lily") }] });
    let guard = 0;
    while (!g.over && guard++ < 3000) act(g, g.prompt!.p, timeoutAction(g));
    expect(g.over).toBeTruthy();
  });

  it("남의 차례 · 엉뚱한 행동은 거절하고 상태를 안 바꿈", () => {
    const g = newGame({ map: "town", seed: 5, first: 0, players: [{ id: "a", name: "A", bot: false, lo: lo() }, { id: "b", name: "B", bot: false, lo: lo() }] });
    const before = JSON.stringify(g.players);
    expect(() => act(g, 1, { t: "roll" })).toThrow();
    expect(() => act(g, 0, { t: "buy", lv: 2 })).toThrow();
    expect(JSON.stringify(g.players)).toBe(before);
  });

  it("파워: 아랫 등급 5강 = 윗 등급 0강", () => {
    expect(power("R", 5)).toBe(power("SR", 0));
    expect(power("SR", 5)).toBe(power("SSR", 0));
    expect(power("SSR", 5)).toBe(power("UR", 0));
    // 같은 캐릭터면 강화할수록 효과가 줄지 않음
    for (const c of CHARS) {
      const a = fxOf({ char: { id: c.id, lv: 0 } });
      const b = fxOf({ char: { id: c.id, lv: 5 } });
      for (const k of Object.keys(a.fx) as (keyof typeof a.fx)[]) expect(b.fx[k]).toBeGreaterThanOrEqual(a.fx[k]);
      expect(b.skill.cd).toBeLessThanOrEqual(a.skill.cd);
    }
  });

  it("가챠: 10연차는 SR 이상 하나 · 천장 · 중복은 강화 카드 → 다 차면 별사탕", () => {
    let r = 0.001;
    const low = () => (r = (r * 9301 + 49297) % 233280) / 233280 * 0.69; // 늘 R 이 나오는 난수
    const o: Owned = { chars: {}, items: {}, stars: 0, parts: 0, pity: { char: 0, item: 0 } };
    const got = pullChars(o, 10, low);
    expect(got.some((x) => x.grade !== "R")).toBe(true);
    for (let i = 0; i < GACHA.char.pity; i++) pullChars(o, 1, low);
    expect(Object.keys(o.chars).some((id) => ["SSR", "UR"].includes(CHARS.find((c) => c.id === id)!.grade))).toBe(true);
    // R 캐릭터는 같은 카드가 계속 나와서 강화 재료가 다 차면 별사탕
    const need = CHAR_UP_DUPES.reduce((a, b) => a + b, 0);
    const rIds = Object.keys(o.chars).filter((id) => CHARS.find((c) => c.id === id)!.grade === "R");
    expect(rIds.length).toBeGreaterThan(0);
    for (const id of rIds) expect(o.chars[id].dup).toBeLessThanOrEqual(need);
    expect(o.stars).toBeGreaterThan(0);
    // 아이템: 10번이면 아이템이 하나는
    const o2: Owned = { chars: {}, items: {}, stars: 0, parts: 0, pity: { char: 0, item: 0 } };
    const it = pullItems(o2, 10, () => 0.99);
    expect(it.some((x) => x.k === "item")).toBe(true);
    expect(ITEMS.length).toBeGreaterThan(0);
  });
});

describe("픽셀 마블 서버", () => {
  let srv: TestServer;
  let n = 0;
  async function member(): Promise<TestClient> {
    const uid = `mb${++n}`;
    const email = `${uid}@example.com`;
    const token = await srv.token(uid, { email });
    const r = await srv.http("/api/me/nick", { method: "PUT", token, body: { nick: `마블${n}` } });
    expect(r.status).toBe(200);
    return srv.client(uid, { email });
  }
  beforeAll(async () => {
    srv = await startTestServer();
  });
  afterAll(async () => {
    await srv.close();
  });

  it("처음: 티켓 · 별사탕 → 캐릭터 없으면 입장 못 함 → 10연차 티켓 → 장착", async () => {
    const c = await member();
    const p = await c.rpc("marble.profile");
    expect(p.stars).toBe(STARTER.stars);
    expect(p.tickets).toEqual({ char: 1, item: 1 });
    await expect(c.rpc("marble.quick", {})).rejects.toMatchObject({ code: "NO_CHAR" });
    const r = await c.rpc("marble.pull", { kind: "char", n: 10, ticket: true });
    expect(r.got).toHaveLength(10);
    expect(r.profile.tickets.char).toBe(0);
    expect(r.profile.load.char).toBeTruthy();
    await expect(c.rpc("marble.pull", { kind: "char", n: 10, ticket: true })).rejects.toMatchObject({ code: "NO_TICKET" });
    const r2 = await c.rpc("marble.pull", { kind: "item", n: 10, ticket: true });
    expect(r2.got.some((x: { k: string }) => x.k === "item")).toBe(true);
    c.close();
  });

  it("바로 입장: AI 가 들어와 판이 시작되고, 끝까지 자동으로 두면 보상 · 기록", async () => {
    const c = await member();
    await c.rpc("marble.pull", { kind: "char", n: 10, ticket: true });
    const { id } = await c.rpc("marble.quick", { map: "town", max: 2 });
    const sub = await c.sub("marble.room", { id });
    // 내 자리 자동 진행 (끝까지 AI 가 대신)
    await c.rpc("marble.auto", { id, on: true }).catch(() => {});
    const start = await sub.wait((e) => e.t === "room" && e.d.phase === "play" && !!e.d.game, 15000);
    expect(start.d.seats.filter(Boolean)).toHaveLength(2);
    expect(start.d.game.rng).toBeUndefined();
    await c.rpc("marble.auto", { id, on: true });
    const end = await sub.wait((e) => e.t === "room" && e.d.phase === "end", 20000);
    expect(end.d.result).toHaveLength(2);
    const me = end.d.result.find((x: { bot: boolean }) => !x.bot);
    expect(me.stars).toBeGreaterThan(0);
    const u = await srv.db.col("users").findOne({ _id: c.uid } as never);
    expect((u as any).stats.marble.games).toBe(1);
    c.close();
  });

  it("방 설정: AI 입장은 바로 입장 허용일 때만 · 방장만 · 비밀번호", async () => {
    const a = await member();
    const b = await member();
    for (const x of [a, b]) await x.rpc("marble.pull", { kind: "char", n: 10, ticket: true });
    const { id } = await a.rpc("marble.create", { map: "orgel", max: 3, quick: false, bots: true, pw: "1234" });
    const sub = await a.sub("marble.room", { id });
    expect(sub.data.bots).toBe(false);
    expect(sub.data.locked).toBe(true);
    await expect(b.rpc("marble.opts", { id, quick: true })).rejects.toThrow();
    await expect(b.rpc("marble.join", { id, pw: "0000" })).rejects.toMatchObject({ code: "BAD_PASSWORD" });
    await b.rpc("marble.join", { id, pw: "1234" });
    await a.rpc("marble.opts", { id, quick: true, bots: true, addBot: true });
    const ev = await sub.wait((e) => e.t === "room" && e.d.seats.filter(Boolean).length === 3);
    expect(ev.d.seats.some((s: { bot: boolean } | null) => s?.bot)).toBe(true);
    a.close();
    b.close();
  });
});
