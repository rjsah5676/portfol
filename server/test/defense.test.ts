import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BALANCE_VER, LAST_WAVE } from "../../web/src/lib/defense/balance";
import { BOTS, botTurn } from "../../web/src/lib/defense/bot";
import { HASH_TICKS, TICKS_PER_TURN, TURN_MS, replay, replayer, scoreOf, validLog, type LogEntry } from "../../web/src/lib/defense/replay";
import { CELLS, SLOTS, apply, hashGame, isCmd, newGame, step, unitCount, type Game } from "../../web/src/lib/defense/sim";
import { RECIPES, UNIT, UNITS } from "../../web/src/lib/defense/units";
import { CHEST, CORE_EXCHANGE, GP_SHOP, PASS_PREMIUM_GP, RESEARCH, lvCost, modsOf, planUpAll, seasonScore, weeklyRelics, weekOf } from "../../web/src/lib/defense/progress";
import { startTestServer, type TestClient, type TestServer } from "./helpers";

/** 봇 한 판 (기록 포함) */
function botGame(seed: number, bot = 0, until = Infinity, lo?: Parameters<typeof newGame>[2]): { g: Game; log: LogEntry[] } {
  const g = newGame(seed, 1, lo);
  const log: LogEntry[] = [];
  while (!g.over && g.tick < until) {
    for (const c of botTurn(g, 0, BOTS[bot])) log.push([g.tick, 0, c]);
    step(g);
  }
  return { g, log };
}

describe("픽셀 글리치 디펜스 엔진", () => {
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
    expect(isCmd({ t: "merge", c: CELLS })).toBe(true); // 보관함 칸
    expect(isCmd({ t: "merge", c: SLOTS })).toBe(false);
    expect(isCmd({ t: "recipe", id: "nope" })).toBe(false);
    expect(validLog([[5, 0, { t: "summon" }], [3, 0, { t: "summon" }]], 1)).toBe(false);
  });

  it("로드아웃: 같은 시드 · 같은 성장이면 다시 돌려도 같음, 성장이 판을 바꿈", () => {
    const lo = { lv: { k_squire: 5 }, res: ["g_gold", "k_drill"], relics: ["gold_gear", "pure_blood"], glitch: 2 };
    const { g, log } = botGame(9, 0, 4000, [lo]);
    expect(g.boards[0].gold).not.toBe(botGame(9, 0, 4000).g.boards[0].gold);
    const r = replayer(9, 1, log, [lo]);
    r.run(4000);
    expect(r.game.tick).toBe(g.tick);
    expect(hashGame(r.game)).toBe(hashGame(g));
    const m = modsOf({ res: ["nope", "g_gold"], relics: ["x"], glitch: 99 });
    expect(m.startGold).toBe(40);
    expect(m.glitch.lv).toBe(30);
  });

  it("v0.3: 포기 · 모든 유닛 판매 · 도박은 웨이브부터", () => {
    const g = newGame(5, 1);
    const b = g.boards[0];
    // 도박: 처음엔 막힘 (상태 그대로)
    b.stones = 10;
    expect(apply(g, 0, { t: "gamble", g: "E" })).toBeTruthy();
    expect(b.stones).toBe(10);
    // 레전드 판매: 골드 + 행운석
    b.cells[0].def = "k_commander";
    b.cells[0].units = [{} as never];
    const gold = b.gold;
    expect(apply(g, 0, { t: "sell", c: 0 })).toBeNull();
    expect(b.gold).toBeGreaterThan(gold);
    expect(b.stones).toBe(11);
    // 포기 → 결과
    expect(isCmd({ t: "quit" })).toBe(true);
    expect(apply(g, 0, { t: "quit" })).toBeNull();
    expect(b.result?.reason).toBe("quit");
    expect(g.boards.every((x) => x.result)).toBe(true);
  });

  it("보관함: 필드가 차면 보관함으로, 보관함 유닛은 공격 안 함", () => {
    const g = newGame(3, 1);
    const b = g.boards[0];
    b.gold = 100_000;
    for (let i = 0; i < 80; i++) apply(g, 0, { t: "summon" });
    expect(b.cells.slice(CELLS).some((c) => c.def)).toBe(true);
  });

  it("시즌 점수: 오염 단계가 높을수록 위", () => {
    const win0 = seasonScore({ win: true, wave: LAST_WAVE, tick: 50_000, kills: 0 }, 0);
    expect(seasonScore({ win: false, wave: 55, tick: 0, kills: 0 }, 1)).toBeGreaterThan(win0);
    expect(seasonScore({ win: false, wave: 20, tick: 0, kills: 0 }, 1)).toBeLessThan(win0);
  });

  it("점수: 클리어가 늘 위, 그다음 웨이브", () => {
    expect(scoreOf({ win: true, wave: LAST_WAVE, tick: 99_999, kills: 1 })).toBeGreaterThan(scoreOf({ win: false, wave: LAST_WAVE, tick: 1, kills: 9999 }));
    expect(scoreOf({ win: false, wave: 31, tick: 0, kills: 0 })).toBeGreaterThan(scoreOf({ win: false, wave: 30, tick: 0, kills: 9999 }));
  });
});

describe("픽셀 글리치 디펜스 서버", () => {
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
    // 새로고침 뒤 돌아가기: 내 진행 중인 방을 찾고, 다시 들어가면 자리 그대로
    expect((await b.rpc("defense.mine"))?.id).toBe(id);
    expect(await b.rpc("defense.join", { id })).toEqual({ id });
    await b.rpc("defense.cmd", { id, c: [{ t: "summon" }] });
    const turn = await sa.wait((e) => e.t === "turn" && e.d.c.length > 0, 3000);
    expect(turn.d.c[0]).toEqual([1, { t: "summon" }]);
    // 어긋남 감시: tick 0 은 같은 값 → 괜찮음, 다른 값이면 "desync"
    expect(await a.rpc("defense.hash", { id, tick: 0, h: 123 })).toEqual({ ok: true });
    expect(await b.rpc("defense.hash", { id, tick: 0, h: 123 })).toEqual({ ok: true });
    await expect(a.rpc("defense.hash", { id, tick: 7, h: 1 })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, HASH_TICKS * (TURN_MS / TICKS_PER_TURN) + 300));
    await a.rpc("defense.hash", { id, tick: HASH_TICKS, h: 1 });
    expect(await b.rpc("defense.hash", { id, tick: HASH_TICKS, h: 2 })).toEqual({ ok: false });
    const ds = await sa.wait((e) => e.t === "desync", 3000);
    expect(ds.d.tick).toBe(HASH_TICKS);
    await a.rpc("defense.over", { id, win: false, wave: 1 });
    await b.rpc("defense.over", { id, win: false, wave: 1 });
    const result = await sa.wait((e) => e.t === "result", 10_000);
    expect(result.d).toHaveLength(2);
    a.close();
    b.close();
  });

  it("성장: 검증된 판 보상 → 연구 · 상자 · 로드아웃 → 다음 판에 들고 감", async () => {
    const c = await member();
    const p0 = await c.rpc("defense.profile");
    expect(p0.pieces).toBeGreaterThan(0);
    expect(p0.quests.daily).toHaveLength(3);
    const { run, seed, loadout } = await c.rpc("defense.start", { mode: "season" });
    expect(loadout).toMatchObject({ res: [], relics: [], glitch: 0 });
    const { log } = botGame(seed, 0, Infinity, [loadout]);
    await srv.db.col("defense_runs").updateOne({ _id: run }, { $set: { at: new Date(Date.now() - 3600_000) } });
    const fin = await c.rpc("defense.finish", { run, log });
    expect(fin.reward.pieces).toBeGreaterThan(0);
    const p1 = await c.rpc("defense.profile");
    expect(p1.pieces).toBe(p0.pieces + fin.reward.pieces);
    expect(Object.keys(p1.cards).length).toBeGreaterThan(0);
    expect(p1.season.xp).toBe(fin.reward.xp);
    // 연구 사기 (모자라면 거절, 실패는 아무것도 안 바꿈)
    await srv.db.col("defense_profile").updateOne({ _id: c.uid! } as never, { $set: { pieces: 5000 } });
    await expect(c.rpc("defense.res.buy", { id: "nope" })).rejects.toThrow();
    const r = RESEARCH.find((x) => x.id === "g_gold")!;
    const p2 = await c.rpc("defense.res.buy", { id: "g_gold" });
    expect(p2.pieces).toBe(5000 - r.cost);
    expect(p2.load.res).toEqual(["g_gold"]);
    await expect(c.rpc("defense.res.buy", { id: "g_gold" })).rejects.toThrow();
    // 유닛 강화 → 내리면 그대로 돌려받음
    await srv.db.col("defense_profile").updateOne({ _id: c.uid! } as never, { $set: { "cards.k_squire": 5 } });
    const up = await c.rpc("defense.unit.up", { id: "k_squire" });
    expect(up.lv.k_squire).toBe(1);
    const down = await c.rpc("defense.unit.down", { id: "k_squire" });
    expect(down.lv.k_squire ?? 0).toBe(0);
    expect(down.cards.k_squire).toBe(5);
    expect(down.pieces).toBe(up.pieces + lvCost(0, 0).pieces);
    // 상자
    const p3 = await c.rpc("defense.chest.open");
    expect(p3.got).toBeTruthy();
    await c.rpc("defense.chest.buy");
    expect((await c.rpc("defense.profile")).pieces).toBe(p2.pieces - CHEST.price);
    // 오염 단계는 열린 만큼만
    await expect(c.rpc("defense.load", { res: ["g_gold"], relics: [], glitch: 3 })).rejects.toThrow();
    const s2 = await c.rpc("defense.start", { mode: "season" });
    expect(s2.loadout.res).toEqual(["g_gold"]);
    c.close();
  });

  it("일괄 강화: 한 유닛 최대한 · 모든 유닛 고르게, 할 게 없으면 거절", async () => {
    const c = await member();
    await c.rpc("defense.profile");
    await expect(c.rpc("defense.unit.upAll", {})).rejects.toThrow();
    await srv.db.col("defense_profile").updateOne({ _id: c.uid! } as never, {
      $set: { pieces: 100000, cards: { k_squire: 40, m_bolt: 3 } },
    });
    const one = await c.rpc("defense.unit.upAll", { id: "k_squire" });
    const plan = planUpAll([UNIT.k_squire], {}, { k_squire: 40 }, 100000);
    expect(one.lv.k_squire).toBe(plan.n);
    expect(plan.n).toBeGreaterThan(1);
    expect(one.pieces).toBe(100000 - plan.pieces);
    expect(one.lv.m_bolt ?? 0).toBe(0);
    const all = await c.rpc("defense.unit.upAll", {});
    expect(all.lv.m_bolt).toBe(1);
    expect(all.ups).toBeGreaterThan(0);
    // 다시 하면 더 할 게 없음
    await expect(c.rpc("defense.unit.upAll", {})).rejects.toThrow();
    c.close();
  });

  it("연구 · 유물 레벨: 1레벨은 예전 수치 그대로, 올리면 로드아웃에 실림 · 내리면 전부 돌려받기", async () => {
    // 1레벨 = 예전 값 (예전 기록 다시 돌리기가 그대로 맞게)
    const m1 = modsOf({ res: ["g_gold", "k_drill", "g_sell"], relics: ["first_harvest", "rift_compass", "alchemy"] });
    expect([m1.startGold, m1.fac.knight, m1.sellMult, m1.firstHarvest, m1.riftCd, m1.riftStone, m1.alchemyGold, m1.alchemyStones]).toEqual([40, 1.1, 1.5, 15, 0.7, 1, 80, 2]);
    const m5 = modsOf({ res: ["g_gold", "k_drill"], relics: ["first_harvest"], resLv: { g_gold: 5, k_drill: 5, nope: 3 }, relicLv: { first_harvest: 5, vaccine: 5 } });
    expect([m5.startGold, m5.fac.knight, m5.firstHarvest]).toEqual([80, 1.2, 27]);
    expect(m5.resLv).toEqual({ g_gold: 5, k_drill: 5 });
    expect(m5.relicLv).toEqual({ first_harvest: 5 });

    const c = await member();
    await c.rpc("defense.profile");
    await srv.db.col("defense_profile").updateOne({ _id: c.uid! } as never, { $set: { pieces: 10000, cores: 100, res: ["g_gold"], relics: ["vaccine"], load: { res: ["g_gold"], relics: ["vaccine"], glitch: 0 } } });
    await expect(c.rpc("defense.res.level", { id: "g_stone", dir: 1 })).rejects.toThrow();
    await expect(c.rpc("defense.res.level", { id: "g_gold", dir: -1 })).rejects.toThrow();
    const a = await c.rpc("defense.res.level", { id: "g_gold", dir: 1 });
    expect(a.resLv.g_gold).toBe(2);
    expect(a.pieces).toBe(10000 - RESEARCH.find((r) => r.id === "g_gold")!.cost);
    const b = await c.rpc("defense.relic.level", { id: "vaccine", dir: 1 });
    expect(b.relicLv.vaccine).toBe(2);
    expect(b.cores).toBe(85);
    const { loadout } = await c.rpc("defense.start", { mode: "season" });
    expect(loadout).toMatchObject({ resLv: { g_gold: 2 }, relicLv: { vaccine: 2 } });
    const d = await c.rpc("defense.relic.level", { id: "vaccine", dir: -1 });
    expect(d.cores).toBe(100);
    expect(d.relicLv.vaccine).toBeUndefined();
    c.close();
  });

  it("주간 도전: 모두 같은 시드 · 같은 유물, 강화 없음", async () => {
    const a = await member();
    const b = await member();
    const sa = await a.rpc("defense.start", { mode: "weekly" });
    const sb = await b.rpc("defense.start", { mode: "weekly" });
    expect(sa.seed).toBe(sb.seed);
    expect(sa.loadout.relics).toEqual(weeklyRelics(weekOf(Date.now())));
    expect(sa.loadout.lv ?? {}).toEqual({});
    const { log } = botGame(sa.seed, 0, Infinity, [sa.loadout]);
    await srv.db.col("defense_runs").updateOne({ _id: sa.run }, { $set: { at: new Date(Date.now() - 3600_000) } });
    const fin = await a.rpc("defense.finish", { run: sa.run, log });
    expect(fin.mode).toBe("weekly");
    const wr = await a.rpc("defense.rank", { board: "weekly" });
    expect(wr.rows).toHaveLength(1);
    expect((await a.rpc("defense.rank", { board: "season" })).rows.some((x: { nick: string }) => x.nick === wr.rows[0].nick)).toBe(false);
    a.close();
    b.close();
  });

  it("GP: 패스 프리미엄 · 코어 교환은 GP 로 (모자라면 거절)", async () => {
    const c = await member();
    await expect(c.rpc("defense.pass.buy")).rejects.toThrow();
    await srv.db.col("users").updateOne({ _id: c.uid! } as never, { $set: { points: PASS_PREMIUM_GP + CORE_EXCHANGE.gp + GP_SHOP.chest.gp + GP_SHOP.cards.gp } });
    const gc = await c.rpc("defense.gp.chest");
    expect(gc.got.relic).toBeTruthy();
    expect(gc.relics).toContain(gc.got.relic);
    const gk = await c.rpc("defense.gp.cards", { id: "a_void" });
    expect(gk.cards.a_void).toBe(GP_SHOP.cards.n);
    const p = await c.rpc("defense.pass.buy");
    expect(p.season.premium).toBe(true);
    const q = await c.rpc("defense.cores.buy");
    expect(q.cores).toBe(CORE_EXCHANGE.cores);
    expect(q.gp).toBe(0);
    await expect(c.rpc("defense.cores.buy")).rejects.toThrow();
    c.close();
  });
});
