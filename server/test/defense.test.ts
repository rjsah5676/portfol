import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { B, BALANCE_VER, LAST_WAVE, countOf, sec } from "../../web/src/lib/defense/balance";
import { BOTS, botTurn } from "../../web/src/lib/defense/bot";
import { HASH_TICKS, TICKS_PER_TURN, TURN_MS, replay, replayer, scoreOf, validLog, type LogEntry } from "../../web/src/lib/defense/replay";
import { CELLS, SLOTS, apply, hashGame, isCmd, newGame, pureT, step, unitCount, upCost, type Game } from "../../web/src/lib/defense/sim";
import { RECIPES, UNIT, UNITS } from "../../web/src/lib/defense/units";
import { PHASE_PAIRS, phaseOn } from "../../web/src/lib/defense/enemies";
import { CHEATS, CHEAT_MULTI_SEC, cheatFxOf, cheatOdds } from "../../web/src/lib/defense/cheats";
import { TPS } from "../../web/src/lib/defense/balance";
import { GLITCH, relicShardsToMax, CHEAT_RES, BOX, BENCH_COST, FRES_COST, TRANS_IDS, GP_PACKS, GP_SELL, GP_STORE, PACK, PASS_PREMIUM_GP, RESEARCH, lvCost, modsOf, packPct, planUpAll, seasonScore, transRoll } from "../../web/src/lib/defense/progress";
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

/** 새 판 + 시작 치트(패치) 를 첫 카드(연합)로 고른 상태 */
function started(seed: number, players = 1, lo?: Parameters<typeof newGame>[2]): Game {
  const g = newGame(seed, players, lo);
  for (let p = 0; p < players; p++) apply(g, p, { t: "cheat", i: 0 });
  return g;
}

describe("픽셀 글리치 디펜스 엔진", () => {
  it("시작 치트: 패치 4개 중 하나를 고를 때까지 멈춤 · 도박사는 행운석 +3", () => {
    const g = newGame(3, 1);
    const b = g.boards[0];
    expect(b.cheat?.kind).toBe("patch");
    expect(b.cheat?.offer).toEqual(["union", "gambler", "pure", "interest"]);
    expect(apply(g, 0, { t: "summon" })).toBeTruthy();
    expect(apply(g, 0, { t: "reroll", i: 0 })).toBeTruthy();
    for (let i = 0; i < 60; i++) step(g);
    expect(b.wt).toBeLessThan(0);
    expect(b.wave).toBe(0);
    const st = b.stones;
    expect(apply(g, 0, { t: "cheat", i: 1 })).toBeNull();
    expect(b.patch).toBe("gambler");
    expect(b.stones).toBe(st + 3);
    expect(b.cheat).toBeNull();
    expect(b.cheats).toEqual([]);
  });

  it("데이터: 조합식 재료 · 결과가 다 있는 유닛", () => {
    for (const r of RECIPES) {
      expect(UNIT[r.id]).toBeTruthy();
      for (const n of r.needs) expect(UNIT[n] || /^@[46]$/.test(n), n).toBeTruthy();
    }
    expect(new Set(UNITS.map((u) => u.id)).size).toBe(UNITS.length);
  });

  it("치트 코드: 보스를 잡으면 3장 · 고를 때까지 멈춤 · 카드마다 다시 뽑기 1번 · 효과", () => {
    expect(new Set(CHEATS.map((c) => c.id)).size).toBe(CHEATS.length);
    for (const t of [0, 1, 2, 3]) expect(CHEATS.filter((c) => c.tier === t).length).toBeGreaterThanOrEqual(6);
    for (let n = 0; n < 5; n++)
      for (const luck of [false, true]) {
        const o = cheatOdds(n, luck);
        expect(Math.round(o.reduce((a, x) => a + x, 0))).toBe(100);
        expect(o.every((x) => x >= 0)).toBe(true);
      }
    const g = started(7, 1);
    const b = g.boards[0];
    while (!b.cheat && !g.over) {
      botTurn(g, 0, BOTS[0]);
      step(g);
    }
    expect(b.wave).toBe(10);
    expect(b.cheat!.offer).toHaveLength(3);
    expect(new Set(b.cheat!.offer).size).toBe(3);
    expect(b.cheat!.rr).toEqual([1, 1, 1]);
    // 멈춤: 시간이 가도 보드는 그대로, 다른 명령은 안 됨
    const wt = b.wt,
      hp = b.enemies.map((e) => e.hp);
    for (let i = 0; i < 90; i++) step(g);
    expect(b.wt).toBe(wt);
    expect(b.enemies.map((e) => e.hp)).toEqual(hp);
    expect(apply(g, 0, { t: "summon" })).toBeTruthy();
    // 다시 뽑기: 다른 카드 · 한 번만
    const before = b.cheat!.offer[0];
    expect(apply(g, 0, { t: "reroll", i: 0 })).toBeNull();
    expect(b.cheat!.offer[0]).not.toBe(before);
    expect(b.cheat!.offer.filter((x) => x === b.cheat!.offer[0])).toHaveLength(1);
    expect(apply(g, 0, { t: "reroll", i: 0 })).toBeTruthy();
    const id = b.cheat!.offer[1];
    expect(apply(g, 0, { t: "cheat", i: 1 })).toBeNull();
    expect(b.cheat).toBeNull();
    expect(b.cheats).toEqual([id]);
    expect(b.cx).toEqual(cheatFxOf([id]));
    expect(isCmd({ t: "cheat", i: 2 })).toBe(true);
    expect(isCmd({ t: "cheat", i: 3 })).toBe(true);
    expect(isCmd({ t: "cheat", i: 4 })).toBe(false);
    expect(apply(g, 0, { t: "cheat", i: 3 })).toBeTruthy();
    // 리롤 회로: 카드마다 2번
    expect(modsOf({ cheat: "x_reroll" }).cheatReroll).toBe(2);
    expect(modsOf({ cheat: "nope" }).cheatReroll).toBe(1);
  });

  it("순혈 프로토콜: 가장 많은 세력 70% 이상이면 켜짐 (히든은 전체에 셈 · 보관함은 안 셈) · 강화 할인", () => {
    const g = newGame(5, 1);
    const b = g.boards[0];
    expect(apply(g, 0, { t: "cheat", i: 2 })).toBeNull();
    expect(b.patch).toBe("pure");
    const mech = UNITS.find((u) => u.faction === "mech" && u.grade === 0)!.id;
    const knight = UNITS.find((u) => u.faction === "knight" && u.grade === 0)!.id;
    const hidden = UNITS.find((u) => u.faction === "hidden")!.id;
    const put = (i: number, id: string, n = 1) => ((b.cells[i] = { def: id, units: Array.from({ length: n }, () => ({ cd: 0, ult: 0, stun: 0 })) }), (b.dirty = true));
    const base = upCost(b, "mech");
    put(0, mech, 3);
    put(CELLS, knight, 3); // 보관함은 안 셈
    step(g);
    expect(b.mono).toBe("mech");
    expect(b.pure).toBe(1);
    expect(upCost(b, "mech")).toBeLessThan(base);
    expect(upCost(b, "knight")).toBe(base);
    expect(pureT(0.69)).toBe(0);
    expect(pureT(0.7)).toBeCloseTo(0.5);
    // 히든 1 섞으면 3/4 = 75% → 비례해서 약해짐
    put(1, hidden);
    step(g);
    expect(b.pure).toBeCloseTo(pureT(0.75));
    expect(b.pure).toBeLessThan(1);
    // 기사단이 더 많아지면 기사단 기준 (6/10 = 60% → 70% 밑이라 꺼짐)
    put(2, knight, 3);
    put(3, knight, 3);
    step(g);
    expect(b.mono).toBe("knight");
    expect(b.pureR).toBeCloseTo(0.6);
    expect(b.pure).toBe(0);
    // 고르게 섞이면 (3 · 3 · 3 + 히든) 꺼짐
    put(3, UNITS.find((u) => u.faction === "arcane" && u.grade === 0)!.id, 3);
    step(g);
    expect(b.pure).toBe(0);
  });

  it("다음 웨이브 부르기: 준비 시간 건너뛰기 · 적이 다 나온 뒤만 · 남은 시간만큼 골드 · 보스는 안 됨", () => {
    const g = newGame(9, 1);
    const b = g.boards[0];
    expect(apply(g, 0, { t: "cheat", i: 0 })).toBeNull();
    expect(b.phase).toBe("prep");
    expect(apply(g, 0, { t: "next" })).toBeNull();
    expect(b.wave).toBe(1);
    expect(apply(g, 0, { t: "next" })).not.toBeNull(); // 아직 나오는 중 → 아무것도 안 바뀜
    expect(b.wave).toBe(1);
    while (b.spawned < countOf(1)) step(g);
    const gold = b.gold;
    const bonus = Math.floor((sec(B.waveSec) - b.wt) / TPS) * B.nextGold;
    expect(bonus).toBeGreaterThan(0);
    expect(apply(g, 0, { t: "next" })).toBeNull();
    expect(b.wave).toBe(2);
    expect(b.gold).toBeGreaterThanOrEqual(gold + bonus); // 웨이브 골드 + 보너스
    expect(isCmd({ t: "next" })).toBe(true);
    expect(isCmd({ t: "next", x: 1 })).toBe(false);
    b.phase = "boss";
    expect(apply(g, 0, { t: "next" })).toBe("보스를 잡아야 넘어가요");
  });

  it("보스 2페이즈: 단계마다 정해진 보스 둘 — 16단계 제나는 체력 절반 밑이면 가장 센 줄 예고 → 남아 있던 유닛만 기절, 옮긴 유닛은 안 맞음", () => {
    const g = newGame(11, 1);
    const b = g.boards[0];
    expect(apply(g, 0, { t: "cheat", i: 0 })).toBeNull();
    b.mods = { ...b.mods, glitch: GLITCH[16] };
    const id = UNITS.find((u) => u.faction === "knight" && u.grade === 2)!.id;
    const put = (i: number) => ((b.cells[i] = { def: id, units: [{ cd: 0, ult: 0, stun: 0 }] }), (b.dirty = true));
    put(0);
    put(1);
    put(CELLS - 1); // 맨 아랫줄 1칸 → 윗줄(2칸)이 가장 셈
    b.phase = "wave";
    b.wave = 29;
    b.spawned = countOf(29);
    expect(apply(g, 0, { t: "next" })).toBeNull();
    expect(b.phase).toBe("boss");
    const boss = b.enemies.find((e) => e.boss >= 0)!;
    boss.hp = boss.max * 0.4;
    for (let i = 0; i < TPS * 10 && !b.tele; i++) step(g);
    expect(b.tele?.name).toBe("뇌섬일창");
    expect(b.tele!.cells).toContain(0);
    expect(b.tele!.cells).not.toContain(CELLS - 1);
    // 예고 중에 1번 칸 유닛을 표시 밖으로 옮김
    const out = CELLS - 2;
    expect(apply(g, 0, { t: "swap", a: 1, b: out })).toBeNull();
    while (b.tele) step(g);
    expect(b.cells[0].units[0].stun).toBeGreaterThan(0);
    expect(b.cells[out].units[0].stun).toBe(0);
    // 15단계는 릴리 · 소영만 → 제나는 2페이즈 없음 (같은 단계면 늘 같은 보스)
    expect(PHASE_PAIRS[15]).toEqual([10, 20]);
    expect(phaseOn(14, 30)).toBe(false);
    expect(Object.values(PHASE_PAIRS).flat().filter((w, i, a) => a.indexOf(w) === i).sort((x, y) => x - y)).toEqual([10, 20, 30, 40, 50, 60]);
    const g2 = newGame(11, 1);
    const b2 = g2.boards[0];
    apply(g2, 0, { t: "cheat", i: 0 });
    b2.mods = { ...b2.mods, glitch: GLITCH[15] };
    b2.cells[0] = { def: id, units: [{ cd: 0, ult: 0, stun: 0 }] };
    b2.dirty = true;
    b2.phase = "wave";
    b2.wave = 29;
    b2.spawned = countOf(29);
    apply(g2, 0, { t: "next" });
    b2.enemies.find((e) => e.boss >= 0)!.hp *= 0.4;
    for (let i = 0; i < TPS * 10; i++) step(g2);
    expect(b2.tele).toBeNull();
  });

  it("치트 코드 멀티: 시간이 지나면 첫 카드를 자동으로", () => {
    const g = started(7, 2);
    const b = g.boards[0];
    while (!b.cheat && !g.over) {
      botTurn(g, 0, BOTS[0]);
      if (!g.boards[1].cheat) botTurn(g, 1, BOTS[0]);
      step(g);
    }
    const first = b.cheat!.offer[0];
    for (let i = 0; i < CHEAT_MULTI_SEC * TPS + 1; i++) step(g);
    expect(b.cheat).toBeNull();
    expect(b.cheats).toEqual([first]);
  });

  it("결정론: 같은 시드 · 같은 기록이면 결과가 똑같음", () => {
    const { g, log } = botGame(42);
    const again = replay(42, 1, log);
    expect(again.boards[0].result).toEqual(g.boards[0].result);
    expect(hashGame(again)).toBe(hashGame(g));
    expect(validLog(log, 1)).toBe(true);
  });

  it("못 하는 명령은 아무것도 안 바꿈", () => {
    const g = started(1, 1);
    const b = g.boards[0];
    const before = JSON.stringify(b);
    expect(apply(g, 0, { t: "merge", c: 0 })).toBeTruthy();
    expect(apply(g, 0, { t: "sell", c: 3 })).toBeTruthy();
    expect(apply(g, 0, { t: "gamble", g: "E" })).toBeTruthy();
    expect(apply(g, 0, { t: "pick", id: "k_squire" })).toBeTruthy();
    expect(JSON.stringify(b)).toBe(before);
  });

  it("소환 → 같은 유닛 3기 합성 → 다음 등급", () => {
    const g = started(7, 1);
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
    const g = started(5, 1);
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
    const g = started(3, 1);
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
    const p3 = await c.rpc("defense.box.open", { kind: "card" });
    expect(p3.got).toBeTruthy();
    await c.rpc("defense.box.buy", { kind: "card" });
    expect((await c.rpc("defense.profile")).pieces).toBe(p2.pieces - BOX.card.pieces);
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
      $set: { pieces: 100000, cards: { k_squire: 40, m_bolt: 5 } },
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
    const m1 = modsOf({ fslots: 1, res: ["g_gold", "k_drill", "g_sell"], relics: ["first_harvest", "rift_compass", "alchemy"] });
    expect([m1.startGold, m1.fac.knight, m1.sellMult, m1.firstHarvest, m1.riftCd, m1.riftStone, m1.alchemyGold, m1.alchemyStones]).toEqual([40, 1.1, 1.5, 15, 0.7, 1, 80, 2]);
    const m5 = modsOf({ fslots: 1, res: ["g_gold", "k_drill"], relics: ["first_harvest"], resLv: { g_gold: 5, k_drill: 5, nope: 3 }, relicLv: { first_harvest: 5, vaccine: 5 } });
    expect([m5.startGold, m5.fac.knight, m5.firstHarvest]).toEqual([80, 1.2, 27]);
    expect(m5.resLv).toEqual({ g_gold: 5, k_drill: 5 });
    expect(m5.relicLv).toEqual({ first_harvest: 5 });

    const c = await member();
    await c.rpc("defense.profile");
    await srv.db.col("defense_profile").updateOne({ _id: c.uid! } as never, { $set: { pieces: 10000, cores: 100, shards: { vaccine: 1 }, res: ["g_gold"], relics: ["vaccine"], load: { res: ["g_gold"], relics: ["vaccine"], glitch: 0 } } });
    await expect(c.rpc("defense.res.level", { id: "g_stone", dir: 1 })).rejects.toThrow();
    await expect(c.rpc("defense.res.level", { id: "g_gold", dir: -1 })).rejects.toThrow();
    const a = await c.rpc("defense.res.level", { id: "g_gold", dir: 1 });
    expect(a.resLv.g_gold).toBe(2);
    expect(a.pieces).toBe(10000 - RESEARCH.find((r) => r.id === "g_gold")!.cost);
    const b = await c.rpc("defense.relic.level", { id: "vaccine", dir: 1 });
    expect(b.relicLv.vaccine).toBe(2);
    expect(b.cores).toBe(92);
    expect(b.shards.vaccine).toBe(0);
    const { loadout } = await c.rpc("defense.start", { mode: "season" });
    expect(loadout).toMatchObject({ resLv: { g_gold: 2 }, relicLv: { vaccine: 2 } });
    const d = await c.rpc("defense.relic.level", { id: "vaccine", dir: -1 });
    expect(d.cores).toBe(100);
    expect(d.relicLv.vaccine).toBeUndefined();
    c.close();
  });

  it("끈기: 가장 높은 단계에서 연달아 지면 다음 판 피해 +6%씩 · 단계를 넘기면 0", async () => {
    const c = await member();
    for (let k = 1; k <= 2; k++) {
      const st = await c.rpc("defense.start", { mode: "season" });
      expect(st.loadout.grit).toBe(k - 1);
      const fin = await c.rpc("defense.finish", { run: st.run, log: [[5, 0, { t: "quit" }]] });
      expect(fin.result.win).toBe(false);
    }
    const st = await c.rpc("defense.start", { mode: "season" });
    expect(st.loadout.grit).toBe(2);
    expect(modsOf(st.loadout).gritDmg).toBeCloseTo(1.12);
    // 단계를 넘기면 (0~9 는 40웨이브) 끈기 0
    await srv.db.col("defense_profile").updateOne({ _id: c.uid! } as never, { $set: { glitchOpen: 1 } });
    expect((await c.rpc("defense.start", { mode: "season" })).loadout.grit).toBe(0);
    c.close();
  });

  it("치트 연구: 상점에서 사고 (한 번) · 1칸에 끼면 로드아웃으로", async () => {
    const c = await member();
    const x = CHEAT_RES[0];
    await expect(c.rpc("defense.cheatres.buy", { id: x.id })).rejects.toThrow();
    await c.rpc("defense.profile");
    await srv.db.col("defense_profile").updateOne({ _id: c.uid! } as never, { $set: { pieces: x.pieces * 3, cores: x.cores * 3 } });
    const a = await c.rpc("defense.cheatres.buy", { id: x.id });
    expect(a.cheatRes).toEqual([x.id]);
    expect(a.load.cheat).toBe(x.id);
    await expect(c.rpc("defense.cheatres.buy", { id: x.id })).rejects.toThrow();
    await expect(c.rpc("defense.load", { res: [], relics: [], glitch: 0, cheat: CHEAT_RES[1].id })).rejects.toThrow();
    const { loadout } = await c.rpc("defense.start", { mode: "season" });
    expect(loadout.cheat).toBe(x.id);
    await c.rpc("defense.load", { res: [], relics: [], glitch: 0, cheat: "" });
    expect((await c.rpc("defense.start", { mode: "season" })).loadout.cheat).toBe("");
    c.close();
  });

  it("주간 도전은 없음 (weekly 모드 거절)", async () => {
    const a = await member();
    await expect(a.rpc("defense.start", { mode: "weekly" })).rejects.toThrow();
    await expect(a.rpc("defense.rank", { board: "weekly" })).rejects.toThrow();
    a.close();
  });

  it("상점: 재화샵 · 재화 → GP(절반) · 패키지(GP, 한도) · 패스 프리미엄", async () => {
    const c = await member();
    await expect(c.rpc("defense.pass.buy")).rejects.toThrow();
    await expect(c.rpc("defense.pack.buy", { id: "p_start" })).rejects.toThrow();
    const s0 = GP_STORE.find((x) => x.id === "s_cores")!;
    const pk = PACK.p_start;
    await srv.db.col("users").updateOne({ _id: c.uid! } as never, { $set: { points: PASS_PREMIUM_GP + s0.gp + pk.gp } });
    const p0 = await c.rpc("defense.profile");
    const a = await c.rpc("defense.store.buy", { id: "s_cores" });
    expect(a.cores).toBe(p0.cores + s0.give.cores!);
    const b = await c.rpc("defense.pack.buy", { id: "p_start" });
    expect(b.pieces).toBe(p0.pieces + pk.give.pieces!);
    expect(b.boxes.card).toBe(p0.boxes.card + pk.give.cardBox!);
    expect(b.packs.p_start).toBe(1);
    const p = await c.rpc("defense.pass.buy");
    expect(p.season.premium).toBe(true);
    expect(p.gp).toBe(0);
    // 한 번만 패키지 · GP 모자람 · 오염 단계 조건
    await srv.db.col("users").updateOne({ _id: c.uid! } as never, { $set: { points: 100_000 } });
    await expect(c.rpc("defense.pack.buy", { id: "p_start" })).rejects.toThrow();
    await expect(c.rpc("defense.pack.buy", { id: "p_deep10" })).rejects.toThrow();
    // 일일 패키지: 하루 1번 (300%)
    expect(packPct(PACK.p_daily)).toBe(300);
    await c.rpc("defense.pack.buy", { id: "p_daily" });
    await expect(c.rpc("defense.pack.buy", { id: "p_daily" })).rejects.toThrow();
    // 주간 패키지: 주 1번
    await c.rpc("defense.pack.buy", { id: "p_week" });
    await expect(c.rpc("defense.pack.buy", { id: "p_week" })).rejects.toThrow();
    // 초월 패키지: 초월 상자 2개 (바로 돌리지 않음) → 상점에서 열면 초월 소환 1번씩
    const t = await c.rpc("defense.pack.buy", { id: "p_trans" });
    expect(t.boxes.trans).toBe(2);
    const o = await c.rpc("defense.box.open", { kind: "trans" });
    expect(o.boxes.trans).toBe(1);
    expect(o.got.pity === 0 ? !!o.got.trans : !!o.got.miss).toBe(true);
    await expect(c.rpc("defense.box.buy", { kind: "trans" })).rejects.toThrow();
    // 재화 → GP: 재화샵 값의 절반 · 주 한도
    const x = GP_SELL.find((q) => q.id === "x_pieces")!;
    await srv.db.col("defense_profile").updateOne({ _id: c.uid! } as never, { $set: { pieces: 10_000 } });
    const gp0 = (await c.rpc("defense.profile")).gp;
    for (let i = 0; i < x.perWeek; i++) await c.rpc("defense.store.sell", { id: "x_pieces" });
    await expect(c.rpc("defense.store.sell", { id: "x_pieces" })).rejects.toThrow();
    const after = await c.rpc("defense.profile");
    expect(after.gp).toBe(gp0 + x.gp * x.perWeek);
    expect(after.pieces).toBe(10_000 - x.pay.pieces! * x.perWeek);
    // 재화샵은 횟수 제한 없음 (GP 만 있으면)
    for (let i = 0; i < 7; i++) await c.rpc("defense.store.buy", { id: "s_cores" });
    c.close();
  });

  it("상점 수치: 패키지는 재화샵의 3~8배 · 판매는 재화샵 값의 절반", () => {
    for (const pk of GP_PACKS) {
      expect(packPct(pk)).toBeGreaterThanOrEqual(300);
      expect(packPct(pk)).toBeLessThanOrEqual(800);
    }
    for (const it of GP_STORE) expect(it.gp).toBeGreaterThan(0);
    // 조각 1,000 은 재화샵에서 2,000GP → 판매는 1,000GP · 코어 4 는 1,000GP → 500GP
    const buyPer = (k: "pieces" | "cores") => { const s = GP_STORE.find((x) => x.give[k] && Object.keys(x.give).length === 1)!; return s.gp / s.give[k]!; };
    for (const x of GP_SELL) {
      const k = x.pay.pieces ? "pieces" : "cores";
      expect(x.gp).toBe((buyPer(k) * x.pay[k]!) / 2);
    }
  });

  it("초월 소환: 15% · 10번째 천장 · 아니면 게임 재화", () => {
    let st = 7;
    const r = () => ((st = (Math.imul(st ^ (st >>> 15), 2246822519) + 0x9e3779b9) >>> 0), st / 4294967296);
    let hits = 0;
    let maxGap = 0;
    let gap = 0;
    let pity = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const o = transRoll(pity, r);
      pity = o.pity;
      if (o.trans) {
        expect(TRANS_IDS).toContain(o.trans);
        hits++;
        maxGap = Math.max(maxGap, gap + 1);
        gap = 0;
      } else {
        gap++;
        expect(Object.keys(o.give ?? {}).length).toBe(1);
      }
    }
    expect(maxGap).toBeLessThanOrEqual(BOX.trans.pity);
    // 천장 덕분에 실제 확률은 15% 보다 조금 높음 (≈18.6%)
    expect(hits / N).toBeGreaterThan(0.17);
    expect(hits / N).toBeLessThan(0.2);
    expect(transRoll(BOX.trans.pity - 1, () => 0.99).trans).toBeTruthy();
  });

  it("베타: 보관함 · 세력 연구칸 해금 · 유물 상자 조각 · 초월 소환 → 로드아웃", async () => {
    const c = await member();
    const p0 = await c.rpc("defense.profile");
    expect(p0.bench).toBe(3);
    expect(p0.boxes).toEqual({ card: 1, relic: 1, trans: 0 });
    await expect(c.rpc("defense.fslot.buy")).rejects.toThrow();
    await srv.db.col("defense_profile").updateOne({ _id: c.uid! } as never, { $set: { pieces: 20000, cores: 500, res: ["g_gold", "k_drill"], pity: BOX.trans.pity - 1 } });
    const b = await c.rpc("defense.bench.buy");
    expect(b.bench).toBe(4);
    expect(b.pieces).toBe(20000 - BENCH_COST[0]);
    // 세력 연구는 세력 칸이 없으면 못 낌
    await expect(c.rpc("defense.load", { res: ["g_gold", "k_drill"], relics: [], glitch: 0 })).rejects.toThrow();
    const f = await c.rpc("defense.fslot.buy");
    expect(f.fslots).toBe(1);
    expect(f.cores).toBe(500 - FRES_COST[0]);
    await c.rpc("defense.load", { res: ["g_gold", "k_drill"], relics: [], glitch: 0 });
    // 유물 상자: 같은 유물이 또 나오면 조각
    let shards = 0;
    for (let i = 0; i < 12; i++) {
      await c.rpc("defense.box.buy", { kind: "relic" });
      const o = await c.rpc("defense.box.open", { kind: "relic" });
      if (o.got.shard) shards++;
    }
    const pr = await c.rpc("defense.profile");
    expect(Object.values(pr.shards as Record<string, number>).reduce((a, x) => a + x, 0)).toBe(shards);
    // 초월 소환
    // 천장 직전이라 반드시 초월
    const t = await c.rpc("defense.trans");
    expect(TRANS_IDS).toContain(t.got.trans);
    expect(t.trans).toEqual([t.got.trans]);
    const { loadout } = await c.rpc("defense.start", { mode: "season" });
    expect(loadout.bench).toBe(4);
    expect(loadout.fslots).toBe(1);
    expect(loadout.res).toEqual(["g_gold", "k_drill"]);
    expect(loadout.trans).toEqual([t.got.trans]);
    expect(Object.keys(loadout.own).length).toBe(pr.relics.length);
    expect(modsOf(loadout).relicDmg).toBeGreaterThan(1);
    // 겹친 유물: 최고 레벨까지 조각이 충분하면 조각 대신 코어
    expect(relicShardsToMax("vaccine", 1)).toBe(10);
    expect(relicShardsToMax("vaccine", 5)).toBe(0);
    c.close();
  });

  it("베타 엔진: 7×4 · 잠긴 보관함 · 초월은 해금해야 조합 · 히든 @ 재료", () => {
    const g = started(7, 1, [{ trans: [] }]);
    const b = g.boards[0];
    expect(CELLS).toBe(28);
    expect(apply(g, 0, { t: "swap", a: 0, b: CELLS + 4 })).toBeTruthy(); // 잠긴 칸
    for (const id of ["k_saint", "k_dragoon", "k_lion"]) {
      const i = b.cells.findIndex((c) => !c.def);
      b.cells[i] = { def: id, units: [{ cd: 0, ult: 0, stun: 0 }] };
    }
    expect(apply(g, 0, { t: "recipe", id: "k_astra" })).toBeTruthy();
    const g2 = started(7, 1, [{ trans: ["k_astra"] }]);
    const b2 = g2.boards[0];
    for (const id of ["k_saint", "k_dragoon", "k_lion", "m_omega", "a_void"]) {
      const i = b2.cells.findIndex((c) => !c.def);
      b2.cells[i] = { def: id, units: [{ cd: 0, ult: 0, stun: 0 }] };
    }
    expect(apply(g2, 0, { t: "recipe", id: "k_astra" })).toBeNull();
    expect(apply(g2, 0, { t: "recipe", id: "h_noa" })).toBeNull();
    expect(b2.cells.filter((c) => c.def).map((c) => c.def)).toEqual(["h_noa"]);
  });
});
