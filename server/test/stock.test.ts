import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REVIVE, START_MONEY } from "../../web/src/lib/poker/rules";
import { BATTLE, BattleGame, buyCost, maxBuy, sellGain } from "../../web/src/lib/stock/battle";
import { botThink, newMind } from "../../web/src/lib/stock/bots";
import { COIN_TURNS, LIQ, coinQty, genCoin, liqPrice, marginValue } from "../../web/src/lib/stock/coin";
import { DAILY, HOME_TYPES, RESALE, dailyOf, resaleOf } from "../../web/src/lib/stock/estate";
import { rngFrom } from "../../web/src/lib/stock/rng";
import { HISTORY, TURNS, genSolo } from "../../web/src/lib/stock/solo";
import type { AttendResult, BRecords, BResult, CoinView, EstateView, HomeView, SoloView, StockMe } from "../../web/src/lib/stock/types";
import { STRATS, playOnce } from "../scripts/stock-solo-sim";
import { RpcError, sleep, startTestServer, type TestClient, type TestServer } from "./helpers";

/*
 * 주식 마을: 규칙 엔진(임팩트 · 생성기 기대수익) + 솔로 · 부동산 · 대전 통합 테스트.
 * 대전은 시간 배율(timeScale)로 7분을 2초 남짓으로 돌림.
 */

describe("규칙 엔진", () => {
  it("임팩트: N주 비용 · 수익 공식, 살 수 있는 최대 수량", () => {
    const p = 2_000_000;
    expect(buyCost(p, 1)).toBe(Math.round(p * 1.01));
    expect(buyCost(p, 2)).toBe(Math.round(p * 1.01 + p * 1.01 * 1.01));
    expect(sellGain(p, 2)).toBe(Math.round(p / 1.01 + p / 1.01 / 1.01));
    const n = maxBuy(p, BATTLE.startCash);
    expect(buyCost(p, n)).toBeLessThanOrEqual(BATTLE.startCash);
    expect(buyCost(p, n + 1)).toBeGreaterThan(BATTLE.startCash);
    expect(n).toBe(40); // 1억 · 200만 → 40주
  });

  it("대전: 사고 바로 되팔면 시세는 제자리 · 돈은 조금 손해 (왕복으로 돈을 찍어 낼 수 없음)", () => {
    const g = new BattleGame(2, "t1");
    g.order(0, 3, "buy", 30, 1000);
    expect(g.assets(0)).toBeLessThan(BATTLE.startCash);
    expect(g.assets(0)).toBeGreaterThan(BATTLE.startCash * 0.95);
    g.order(0, 3, "sell", 30, 1200);
    expect(g.players[0].cash).toBeLessThan(BATTLE.startCash);
    expect(Math.abs(g.prices[3] / BATTLE.startPrice - 1)).toBeLessThan(1e-9);
    // 1초에 8번씩 사고팔기를 반복해도 줄기만 함
    const h = new BattleGame(1, "t1c");
    for (let k = 0; k < 200; k++) {
      h.order(0, 0, "buy", 20, k * 300);
      h.order(0, 0, "sell", 20, k * 300 + 1);
    }
    expect(h.players[0].cash).toBeLessThan(BATTLE.startCash);
    // 바닥가 종목을 전액 사도 자산이 몇 배로 뛰지 않음 (예전 "보유 × 시세" 방식의 구멍)
    const f = new BattleGame(1, "t1b");
    f.prices[0] = BATTLE.floor;
    f.order(0, 0, "buy", BATTLE.maxQty, 1000);
    expect(f.assets(0)).toBeLessThanOrEqual(BATTLE.startCash);
  });

  it("대전: 변동 39번 · 끝나면 전부 현금 · 속도 제한", () => {
    const g = new BattleGame(3, "t2");
    for (let k = 0; k < 20; k++) g.order(0, 0, "buy", 1, 500);
    expect(g.players[0].trades).toBe(BATTLE.ordersPerSec);
    g.advance(BATTLE.durationMs);
    expect(g.over).toBe(true);
    expect(g.shocks).toBe(BATTLE.shocks);
    expect(g.curve.length).toBe(BATTLE.shocks + 2);
    expect(g.players.every((p) => p.hold.every((h) => h === 0))).toBe(true);
    expect(g.order(1, 0, "buy", 1, BATTLE.durationMs - 1)).toBeNull();
  });

  it("봇: 봇끼리 한 판이 문제없이 돌고 돈이 음수가 되지 않음", () => {
    const g = new BattleGame(6, "t3");
    const minds = (["chaser", "whale", "contra", "ant", "chaser", "whale"] as const).map((s, i) => newMind(s, (i % 3) as 0 | 1 | 2, rngFrom(`b${i}`)));
    for (let t = 0; t <= BATTLE.durationMs; t += 250) {
      g.advance(t);
      if (g.over) break;
      minds.forEach((m, i) => botThink(g, i, m, t));
      for (const p of g.players) expect(p.cash).toBeGreaterThanOrEqual(0);
    }
    g.advance(BATTLE.durationMs);
    expect(g.fills.length).toBeGreaterThan(50);
  });

  it("솔로 생성기: 같은 시드면 같은 차트 · 가격제한 · 호가", () => {
    const a = genSolo("seed-a"),
      b = genSolo("seed-a");
    expect(a).toEqual(b);
    expect(a.candles.length).toBe(HISTORY + TURNS);
    for (let i = 1; i < a.candles.length; i++) {
      const c = a.candles[i],
        prev = a.candles[i - 1].c;
      expect(c.h).toBeGreaterThanOrEqual(Math.max(c.o, c.c));
      expect(c.l).toBeLessThanOrEqual(Math.min(c.o, c.c));
      expect(c.c / prev).toBeLessThanOrEqual(1.3 + 1e-9);
      expect(c.c / prev).toBeGreaterThanOrEqual(0.7 - 1e-9);
    }
  });

  // 출시 조건: 단순 전략(보유 · 랜덤 · 추세추종)의 판당 평균 수익률 ≈ 0 (시드 고정이라 결과가 늘 같음)
  it("솔로 생성기: 단순 전략 기대수익 ≈ 0, 몰빵 꼬라박기는 있음", () => {
    const charts = Array.from({ length: 3000 }, (_, k) => genSolo(`ev${k}`));
    let x = 7;
    const r = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (const name of ["hold", "random", "momentum", "contrarian", "breakout"]) {
      const g = charts.map((c) => playOnce(c.candles, STRATS[name], r));
      const mean = g.reduce((a, b) => a + b, 0) / g.length - 1;
      expect(Math.abs(mean), name).toBeLessThan(0.025);
      if (name === "hold") expect(g.filter((v) => v < 0.7).length / g.length).toBeGreaterThan(0.03);
    }
  }, 60_000);
});

// ───────────── 서버 ─────────────

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer({ stock: { timeScale: 0.005 } });
});
afterAll(async () => {
  await srv.close();
});

let n = 0;
async function member(): Promise<{ uid: string; c: TestClient }> {
  const uid = `st${++n}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `${uid}@example.com`;
  const token = await srv.token(uid, { email });
  const r = await srv.http("/api/me/nick", { method: "PUT", token, body: { nick: `주식${n}` } });
  expect(r.status).toBe(200);
  return { uid, c: await srv.client(uid, { email }) };
}
const users = () => srv.db.col("users");
const doc = async (uid: string) => (await users().findOne({ _id: uid })) as Record<string, any> | null;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof RpcError ? e.code : `THROWN:${String(e)}`;
  }
};

describe("솔로", () => {
  it("게스트는 못 함", async () => {
    const g = await srv.client("guest1");
    expect(await code(g.rpc("stock.solo.start"))).toBe("FORBIDDEN");
  });

  it("시작 → 과거 봉만 보임 · 종목명은 처음부터 · 매수 · 매도 · 다음 봉 · 끝까지 → 정산", async () => {
    const { uid, c } = await member();
    let v = await c.rpc<SoloView>("stock.solo.start");
    expect(v.candles.length).toBe(HISTORY);
    expect(v.name.length).toBeGreaterThan(0);
    expect(v.date0).toBeGreaterThan(0);
    expect(v.orders).toEqual([]);
    expect(v.preset).toBeNull();
    expect(v.cash).toBe(START_MONEY);
    const price = v.candles[HISTORY - 1].c;
    // 같은 판을 다시 시작하면 그 판 그대로
    expect((await c.rpc<SoloView>("stock.solo.start")).id).toBe(v.id);

    v = await c.rpc<SoloView>("stock.solo.trade", { side: "buy", pct: 100, have: HISTORY });
    const qty = Math.floor(START_MONEY / price);
    expect(v.shares).toBe(qty);
    expect(v.candles.length).toBe(0); // have 이후 새 봉 없음
    expect((await doc(uid))!.money).toBe(START_MONEY - qty * price);
    expect((await doc(uid))!.stock.held).toBe(qty * price);
    // 돈보다 많이는 못 삼
    expect(await code(c.rpc("stock.solo.trade", { side: "buy", qty: 10_000_000 }))).toBe("NOT_ENOUGH");

    v = await c.rpc<SoloView>("stock.solo.next", { n: 1, have: HISTORY });
    expect(v.turn).toBe(1);
    expect(v.candles.length).toBe(1);
    expect(v.from).toBe(HISTORY);
    v = await c.rpc<SoloView>("stock.solo.trade", { side: "sell", pct: 50, have: HISTORY + 1 });
    expect(v.shares).toBe(qty - Math.ceil(qty / 2));

    v = await c.rpc<SoloView>("stock.solo.next", { n: TURNS, have: HISTORY + 1 });
    expect(v.done).toBe(true);
    expect(v.preset).not.toBeNull();
    expect(v.result!.period).toBeTruthy();
    const res = v.result!;
    const d = (await doc(uid))!;
    expect(d.money).toBe(START_MONEY + res.pnl);
    expect(d.stock.held).toBe(0);
    expect(d.stats.stock.solo.games).toBe(1);

    const me = await c.rpc<StockMe>("stock.me");
    expect(me.solo.games).toBe(1);
    expect(me.total).toBe(d.money);
    const hist = await c.rpc<{ id: string }[]>("stock.solo.history");
    expect(hist[0].id).toBe(v.id);
    // 끝난 판에 메모
    await c.rpc("stock.solo.memo", { id: v.id, memo: "급등 뒤 추격은 금물" });
    expect((await c.rpc<{ id: string; memo?: string }[]>("stock.solo.history"))[0].memo).toBe("급등 뒤 추격은 금물");
    const rv = await c.rpc<{ candles: unknown[] }>("stock.solo.review", { id: v.id });
    expect(rv.candles.length).toBe(HISTORY + TURNS);
    expect(await c.rpc("stock.solo.state")).toBeNull();
  });

  it("예약 주문: 지정가 매수는 지금보다 낮게 · 손절은 들고 있어야 · 체결되면 멈춤 · 최대 4개", async () => {
    const { uid, c } = await member();
    let v = await c.rpc<SoloView>("stock.solo.start");
    const price = v.candles[HISTORY - 1].c;
    expect(await code(c.rpc("stock.solo.order", { kind: "buy", price: price * 1.1, qty: 1 }))).toBe("BAD_PRICE");
    // 아주 낮은 지정가 매수는 안 걸림 → 끝까지 가도 체결 없음
    v = await c.rpc<SoloView>("stock.solo.order", { kind: "buy", price: Math.max(1, Math.round(price * 0.01)), qty: 1, have: HISTORY });
    expect(v.orders.length).toBe(1);
    for (let k = 0; k < 3; k++) v = await c.rpc<SoloView>("stock.solo.order", { kind: "buy", price: Math.max(1, Math.round(price * 0.02)), qty: 1, have: HISTORY });
    expect(v.orders.length).toBe(4);
    expect(await code(c.rpc("stock.solo.order", { kind: "buy", price: Math.max(1, Math.round(price * 0.03)), qty: 1 }))).toBe("TOO_MANY");
    v = await c.rpc<SoloView>("stock.solo.cancelOrder", { id: v.orders[3].id, have: HISTORY });
    expect(v.orders.length).toBe(3);
    // 지금 가격 바로 밑 지정가 → 몇 턴 안에 체결되고 거기서 멈춤
    v = await c.rpc<SoloView>("stock.solo.order", { kind: "buy", price: Math.round(price * 0.97), qty: 1, have: HISTORY });
    const id = v.orders[3].id;
    v = await c.rpc<SoloView>("stock.solo.next", { n: TURNS, have: HISTORY });
    if (v.filled?.length) {
      expect(v.filled[0].kind).toBe("buy");
      expect(v.turn).toBeLessThan(TURNS);
      expect(v.shares).toBe(1);
      expect(v.orders.find((o) => o.id === id)).toBeUndefined();
      expect((await doc(uid))!.money).toBeLessThan(START_MONEY);
    } else expect(v.done).toBe(true);
    await c.rpc("stock.solo.quit");
  });

  it("들고 있는 주식은 회생 판정에 합침 (주식에 다 넣고 회생 받기 막기)", async () => {
    const { uid, c } = await member();
    await c.rpc<SoloView>("stock.solo.start");
    await c.rpc<SoloView>("stock.solo.trade", { side: "buy", pct: 100 });
    // 현금은 거의 0 이지만 주식이 있음
    expect((await doc(uid))!.money).toBeLessThan(REVIVE.under);
    expect(await code(c.rpc("poker.revive"))).toBe("NOT_BROKE");
    await c.rpc("stock.solo.quit");
  });
});

describe("부동산", () => {
  it("고시원 사고 팔기: 되팔면 50% · 집 값(되팔 값)은 총자산에 합침", async () => {
    const { uid, c } = await member();
    const st = HOME_TYPES[0];
    await users().updateOne({ _id: uid }, { $set: { money: st.price } });
    let v = await c.rpc<EstateView>("stock.estate.buy", { type: st.id });
    expect(v.units.length).toBe(1);
    expect(v.units[0].no).toBeGreaterThan(0);
    let d = (await doc(uid))!;
    expect(d.money).toBe(0);
    expect(d.estate.value).toBe(resaleOf(st.price));
    expect(await code(c.rpc("poker.revive"))).toBe("NOT_BROKE");
    expect(await code(c.rpc("stock.estate.buy", { type: st.id }))).toBe("NOT_ENOUGH");
    v = await c.rpc<EstateView>("stock.estate.sell", { id: v.units[0].id });
    d = (await doc(uid))!;
    expect(v.units.length).toBe(0);
    expect(d.money).toBe(st.price * RESALE);
    expect(d.estate.value).toBe(0);
  });

  it("단독주택 자리: 선착순 · 팔면 자리가 비고 · 남의 집 구경하면 방문 수가 오름", async () => {
    const a = await member(),
      b = await member();
    const ht = HOME_TYPES.find((h) => h.kind === "house")!;
    await users().updateMany({ _id: { $in: [a.uid, b.uid] } }, { $set: { money: ht.price * 2 } });
    const lot = ht.lots![0];
    let v = await a.c.rpc<EstateView>("stock.estate.buy", { type: ht.id, lot });
    expect(v.units[0].lot).toBe(lot);
    expect(v.lots.find((l) => l.lot === lot)!.owner!.uid).toBe(a.uid);
    expect(await code(b.c.rpc("stock.estate.buy", { type: ht.id, lot }))).toBe("SOLD_OUT");
    // 남의 집 구경
    const h = await b.c.rpc<HomeView>("stock.home", { uid: a.uid });
    expect(h.mine).toBe(false);
    expect(h.owner.uid).toBe(a.uid);
    expect(h.visits).toBe(1);
    expect(h.furniture).toEqual([]);
    expect(await code(b.c.rpc("stock.home"))).toBe("NO_HOME");
    // 팔면 자리가 빔
    v = await a.c.rpc<EstateView>("stock.estate.sell", { id: v.units[0].id });
    expect(v.lots.find((l) => l.lot === lot)!.owner).toBeNull();
    expect((await doc(a.uid))!.money).toBe(ht.price * 2 - ht.price + resaleOf(ht.price));
  });

  it("출석 보너스: 집값의 0.2% · 하루 한 번", async () => {
    const { uid, c } = await member();
    expect(await c.rpc<AttendResult | null>("stock.estate.attend")).toBeNull();
    const st = HOME_TYPES[1];
    await users().updateOne({ _id: uid }, { $set: { money: st.price } });
    await c.rpc<EstateView>("stock.estate.buy", { type: st.id });
    const r = await c.rpc<AttendResult | null>("stock.estate.attend");
    expect(r!.amount).toBe(dailyOf(st.price));
    expect(r!.amount).toBe(Math.round(st.price * DAILY));
    expect((await doc(uid))!.money).toBe(r!.amount);
    expect(await c.rpc<AttendResult | null>("stock.estate.attend")).toBeNull();
    const v = await c.rpc<EstateView>("stock.estate");
    expect(v.daily.claimed).toBe(true);
  });
});

describe("코인", () => {
  it("생성기: 기대수익이 주식보다 뚜렷하게 마이너스 (−3% ~ −12%)", () => {
    let sum = 0;
    const N = 400;
    for (let k = 0; k < N; k++) {
      const ch = genCoin(`ev${k}`);
      const a = ch.candles[ch.candles.length - 1 - COIN_TURNS].c;
      const b = ch.candles[ch.candles.length - 1].c;
      sum += b / a - 1;
    }
    const ev = sum / N;
    expect(ev).toBeLessThan(-0.03);
    expect(ev).toBeGreaterThan(-0.12);
  });

  it("레버리지 수식: 10배는 9% 빠지면 청산 · 평가액은 증거금 × (1 + 배수 × 수익률)", () => {
    expect(liqPrice(10, 1000)).toBeCloseTo(1000 * (1 - LIQ / 10));
    expect(marginValue(100_000, 3, 1000, 1100)).toBe(130_000);
    expect(marginValue(100_000, 10, 1000, 900)).toBe(0);
    expect(coinQty(100_000, 10, 1000)).toBe(1000);
  });

  it("진입 · 정리 · 넘기기 · 끝 → 기록", async () => {
    const { uid, c } = await member();
    await users().updateOne({ _id: uid }, { $set: { money: 10_000_000 } });
    let v = await c.rpc<CoinView>("stock.coin.start");
    expect(v.turn).toBe(0);
    expect(v.pos).toBeNull();
    v = await c.rpc<CoinView>("stock.coin.open", { margin: 1_000_000, lev: 1 });
    expect(v.pos!.margin).toBe(1_000_000);
    expect((await doc(uid))!.money).toBe(9_000_000);
    expect(await code(c.rpc("stock.coin.open", { margin: 1_000_000, lev: 10 }))).toBe("LEV");
    v = await c.rpc<CoinView>("stock.coin.close", { pct: 50 });
    expect(v.pos!.margin).toBe(500_000);
    expect((await doc(uid))!.money).toBe(9_500_000);
    v = await c.rpc<CoinView>("stock.coin.next", { n: COIN_TURNS });
    expect(v.done).toBe(true);
    expect(v.result).not.toBeNull();
    const d = (await doc(uid))!;
    expect(d.stock.coinHeld ?? 0).toBe(0);
    // 1배는 청산이 없으니 남은 증거금이 가격대로 돌아옴
    expect(d.money).toBeGreaterThan(9_500_000);
    const hist = await c.rpc<{ id: string }[]>("stock.coin.history");
    expect(hist.length).toBe(1);
    const me = await c.rpc<StockMe>("stock.me");
    expect(me.coin.games).toBe(1);
  });
});

describe("대전", () => {
  it("방 만들기 · 봇 · 시작 · 주문 · 끝 → 결과 · 전적", async () => {
    const { uid, c } = await member();
    const { id } = await c.rpc<{ id: string }>("stock.room.create", { bots: 3, max: 6 });
    const room = await c.sub<any>("stock.room", { id });
    expect(room.data.room.seats.filter(Boolean).length).toBe(4);
    await c.rpc("stock.room.addBot", { id });
    // 처음 봇 3명은 성격이 서로 다름 (랜덤이지만 안 겹치게)
    const styles = new Set(room.data.room.seats.filter((s: any) => s?.bot).map((s: any) => s.bot.style));
    expect(styles.size).toBe(3);
    expect(await code(c.rpc("stock.room.order", { id, stock: 0, side: "buy", qty: 1 }))).toBe("NOT_PLAYING");
    await c.rpc("stock.room.start", { id });
    const r1 = await c.rpc<{ ok: boolean; qty: number }>("stock.room.order", { id, stock: 2, side: "buy", qty: 10 });
    expect(r1.ok).toBe(true);
    expect(r1.qty).toBe(10);
    const res = (await room.wait((e) => e.t === "result", 20_000)).d as BResult;
    expect(res.rows.length).toBe(5);
    expect(res.rows[0].rank).toBe(1);
    expect(res.curve.length).toBe(BATTLE.shocks + 2);
    const mine = res.rows.find((x) => x.uid === uid)!;
    expect(mine.trades).toBeGreaterThanOrEqual(1);
    await sleep(200);
    const rec = await c.rpc<BRecords>("stock.battle.records");
    expect(rec.stats.games).toBe(1);
    expect(rec.list[0].id).toBe(res.id);
    expect((await c.rpc<BResult>("stock.battle.game", { id: res.id })).id).toBe(res.id);
    // 대전 돈은 지갑과 따로
    expect((await doc(uid))!.money).toBe(START_MONEY);
  }, 30_000);

  it("방장만 봇 추가 · 시작", async () => {
    const a = await member(),
      b = await member();
    const { id } = await a.c.rpc<{ id: string }>("stock.room.create", { bots: 0 });
    await b.c.rpc("stock.room.join", { id });
    expect(await code(b.c.rpc("stock.room.addBot", { id }))).toBe("FORBIDDEN");
    expect(await code(b.c.rpc("stock.room.start", { id }))).toBe("FORBIDDEN");
    await a.c.rpc("stock.room.leave", { id });
    // 방장이 나가면 남은 사람이 이어받음
    expect(await code(b.c.rpc("stock.room.addBot", { id }))).toBe("OK");
  });
});
