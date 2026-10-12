import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BALANCE_VER, LAST_WAVE } from "../../web/src/lib/defense/balance";
import { BOTS, botTurn } from "../../web/src/lib/defense/bot";
import { replay, scoreOf, validLog, type LogEntry } from "../../web/src/lib/defense/replay";
import { CELLS, apply, hashGame, isCmd, newGame, step, unitCount, type Game } from "../../web/src/lib/defense/sim";
import { RECIPES, UNIT, UNITS } from "../../web/src/lib/defense/units";
import { startTestServer, type TestClient, type TestServer } from "./helpers";

/** 봇 한 판 (기록 포함) */
function botGame(seed: number, bot = 0, until = Infinity): { g: Game; log: LogEntry[] } {
  const g = newGame(seed, 1);
  const log: LogEntry[] = [];
  while (!g.over && g.tick < until) {
    for (const c of botTurn(g, 0, BOTS[bot])) log.push([g.tick, 0, c]);
    step(g);
  }
  return { g, log };
}

describe("글리치 디펜스 엔진", () => {
  it("데이터: 조합식 재료 · 결과가 다 있는 유닛", () => {
    for (const r of RECIPES) {
      expect(UNIT[r.id]).toBeTruthy();
      for (const n of r.needs) expect(UNIT[n], n).toBeTruthy();
    }
    expect(new Set(UNITS.map((u) => u.id)).size).toBe(UNITS.length);
  });

  it("결정론: 같은 시드 · 같은 기록이면 결과가 똑같음", () => {
    const { g, log } = botGame(42);
    const again = replay(42, 1, log);
    expect(again.boards[0].result).toEqual(g.boards[0].result);
    expect(hashGame(again)).toBe(hashGame(g));
    expect(validLog(log, 1)).toBe(true);
  });

  it("못 하는 명령은 아무것도 안 바꿈", () => {
    const g = newGame(1, 1);
    const b = g.boards[0];
    const before = JSON.stringify(b);
    expect(apply(g, 0, { t: "merge", c: 0 })).toBeTruthy();
    expect(apply(g, 0, { t: "sell", c: 3 })).toBeTruthy();
    expect(apply(g, 0, { t: "gamble", g: "E" })).toBeTruthy();
    expect(apply(g, 0, { t: "pick", id: "k_squire" })).toBeTruthy();
    expect(JSON.stringify(b)).toBe(before);
  });

  it("소환 → 같은 유닛 3기 합성 → 다음 등급", () => {
    const g = newGame(7, 1);
    const b = g.boards[0];
    b.gold = 10_000;
    for (let i = 0; i < 40 && b.cells.some((c) => !c.def); i++) apply(g, 0, { t: "summon" });
    expect(unitCount(b)).toBeGreaterThan(17);
    const full = b.cells.findIndex((c) => c.def && c.units.length === 3 && UNIT[c.def].grade < 3);
    expect(full).toBeGreaterThanOrEqual(0);
    const g0 = UNIT[b.cells[full].def!].grade;
    const n0 = unitCount(b);
    expect(apply(g, 0, { t: "merge", c: full })).toBeNull();
    expect(unitCount(b)).toBe(n0 - 2);
    expect(Object.keys(b.made).some((id) => UNIT[id].grade === g0 + 1)).toBe(true);
  });

  it("명령 모양 검사", () => {
    expect(isCmd({ t: "summon" })).toBe(true);
    expect(isCmd({ t: "summon", x: 1 })).toBe(false);
    expect(isCmd({ t: "merge", c: CELLS })).toBe(false);
    expect(isCmd({ t: "recipe", id: "nope" })).toBe(false);
    expect(validLog([[5, 0, { t: "summon" }], [3, 0, { t: "summon" }]], 1)).toBe(false);
  });

  it("점수: 클리어가 늘 위, 그다음 웨이브", () => {
    expect(scoreOf({ win: true, wave: LAST_WAVE, tick: 99_999, kills: 1 })).toBeGreaterThan(scoreOf({ win: false, wave: LAST_WAVE, tick: 1, kills: 9999 }));
    expect(scoreOf({ win: false, wave: 31, tick: 0, kills: 0 })).toBeGreaterThan(scoreOf({ win: false, wave: 30, tick: 0, kills: 9999 }));
  });
});

describe("글리치 디펜스 서버", () => {
  let srv: TestServer;
  let n = 0;
  async function member(): Promise<TestClient> {
    const uid = `def${++n}`;
    const email = `${uid}@example.com`;
    const token = await srv.token(uid, { email });
    const r = await srv.http("/api/me/nick", { method: "PUT", token, body: { nick: `디펜${n}` } });
    expect(r.status).toBe(200);
    return srv.client(uid, { email });
  }
  beforeAll(async () => {
    srv = await startTestServer();
  });
  afterAll(async () => {
    await srv.close();
  });

  it("랭킹: 서버가 준 시드로 기록을 다시 돌려 점수를 매김 · 꾸민 기록은 거절", async () => {
    const c = await member();
    const { run, seed, ver } = await c.rpc("defense.start");
    expect(ver).toBe(BALANCE_VER);
    const { g, log } = botGame(seed);
    // 너무 빨리 끝냄 (최대 배속보다 빠름) → 시작 시각을 과거로 돌려서 통과시킴
    await srv.db.col("defense_runs").updateOne({ _id: run }, { $set: { at: new Date(Date.now() - 3600_000) } });
    const res = await c.rpc("defense.finish", { run, log });
    expect(res.result).toEqual(g.boards[0].result);
    expect(res.rank).toBe(1);
    // 같은 판을 두 번은 못 냄
    await expect(c.rpc("defense.finish", { run, log })).rejects.toThrow();
    const rank = await c.rpc("defense.rank", { limit: 10 });
    expect(rank.rows[0].wave).toBe(g.boards[0].result!.wave);
    c.close();
  });

  it("랭킹: 시작하자마자 끝낸 판은 거절", async () => {
    const c = await member();
    const { run, seed } = await c.rpc("defense.start");
    const { log } = botGame(seed);
    await expect(c.rpc("defense.finish", { run, log })).rejects.toThrow();
    c.close();
  });

  it("멀티: 방 → 시작 → 턴마다 명령을 모아 뿌림", async () => {
    const a = await member();
    const b = await member();
    const { id } = await a.rpc("defense.create", {});
    await b.rpc("defense.join", { id });
    const sa = await a.sub("defense.room", { id });
    await b.rpc("defense.ready", { id, ready: true });
    await a.rpc("defense.begin", { id });
    const start = await sa.wait((e) => e.t === "start");
    expect(start.d.players).toHaveLength(2);
    await b.rpc("defense.cmd", { id, c: [{ t: "summon" }] });
    const turn = await sa.wait((e) => e.t === "turn" && e.d.c.length > 0, 3000);
    expect(turn.d.c[0]).toEqual([1, { t: "summon" }]);
    await a.rpc("defense.over", { id, win: false, wave: 1 });
    await b.rpc("defense.over", { id, win: false, wave: 1 });
    const result = await sa.wait((e) => e.t === "result", 10_000);
    expect(result.d).toHaveLength(2);
    a.close();
    b.close();
  });
});
