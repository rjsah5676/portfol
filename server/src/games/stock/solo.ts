import { z } from "zod";
import type { Database } from "../../db";
import { AppError } from "../../errors";
import type { Gateway } from "../../realtime/gateway";
import type { UserDoc } from "../../users";
import { newId } from "../../ids";
import { HISTORY, MAX_ORDERS, TURNS, dateAt, fillOrder, genSolo, maxBuy, priceAt, roundTick, roundTrips, soloDate0, visibleCount, type Candle, type Preset, type SoloChart, type SoloOrder, type SoloTrade } from "../../../../web/src/lib/stock/solo";
import { newSeed } from "../../../../web/src/lib/stock/rng";
import type { SoloHistoryRow, SoloResult, SoloReview, SoloView } from "../../../../web/src/lib/stock/types";
import { createLocks, materialize, member, noBuyWhileSeated, type PokerLink } from "./common";

/*
 * 솔로(증권거래소) — 서버가 판을 들고 있음 (시드 · 미래 봉은 화면에 안 내려감).
 *
 * 돈: 포커와 같은 users.money 를 그대로 씀 (판마다 전액으로 거래 가능).
 *   매수 → money 에서 빠지고 판의 보유 주식이 늘어남 · 매도 → 반대. 판에 들고 있는 주식의 지금 값은 users.stock.held 에 적어 둠
 *   (회생 판정 · 총자산 순위에 합치려고). 판이 끝나면 마지막 종가로 전부 팔아 money 로.
 * 판(stock_solo 문서)과 돈(users)은 따로 쓰므로, 사람마다 하나씩 차례로 처리(locks)하고
 * 돈 쪽은 조건부 갱신(money ≥ 금액)으로 한 번 더 막음.
 */

interface SoloDoc {
  _id: string;
  uid: string;
  seed: string;
  status: "play" | "done";
  turn: number;
  shares: number;
  cost: number;
  startCash: number;
  trades: SoloTrade[];
  orders?: SoloOrder[];
  memo?: string;
  createdAt: Date;
  endedAt?: Date;
  result?: SoloResult;
  /** 끝난 판 목록 · 순위용 (끝날 때 같이 적음) */
  name?: string;
  preset?: Preset;
}

const CACHE = 200;

export function createSolo(db: Database, gateway: Gateway, poker: PokerLink, now: () => number = Date.now) {
  const col = db.col<Omit<SoloDoc, "_id">>("stock_solo");
  const users = db.col<UserDoc>("users");
  const withLock = createLocks();
  void col.createIndex({ uid: 1, status: 1 }).catch(() => {});
  void col.createIndex({ uid: 1, endedAt: -1 }).catch(() => {});
  void col.createIndex({ endedAt: -1 }).catch(() => {});

  // 시드 → 차트 (자주 부르는 것만 기억)
  const charts = new Map<string, SoloChart>();
  function chartOf(seed: string): SoloChart {
    let c = charts.get(seed);
    if (c) {
      charts.delete(seed);
      charts.set(seed, c);
      return c;
    }
    c = genSolo(seed);
    charts.set(seed, c);
    if (charts.size > CACHE) charts.delete(charts.keys().next().value!);
    return c;
  }

  const moneyOf = async (uid: string) => ((await users.findOne({ _id: uid }, { projection: { money: 1 } })) as { money?: number } | null)?.money ?? 0;

  async function view(d: SoloDoc, have = 0, filled?: SoloView["filled"]): Promise<SoloView> {
    const ch = chartOf(d.seed);
    const vis = d.status === "done" ? HISTORY + TURNS : visibleCount(d.turn);
    const from = Math.max(0, Math.min(have, vis));
    return {
      id: d._id,
      name: ch.name,
      date0: soloDate0(d.seed),
      preset: d.status === "done" ? ch.preset : null,
      turn: d.turn,
      turns: TURNS,
      from,
      candles: ch.candles.slice(from, vis),
      shares: d.shares,
      cost: d.cost,
      cash: await moneyOf(d.uid),
      startCash: d.startCash,
      trades: d.trades,
      orders: d.status === "done" ? [] : (d.orders ?? []),
      ...(filled?.length && { filled }),
      done: d.status === "done",
      result: d.result ?? null,
    };
  }

  const active = async (uid: string) => (await col.findOne({ uid, status: "play" })) as SoloDoc | null;

  /** 들고 있는 주식의 지금 값을 users 에 (회생 · 총자산) */
  const setHeld = (uid: string, v: number) => users.updateOne({ _id: uid }, { $set: { "stock.held": Math.max(0, Math.round(v)) } });

  async function finish(d: SoloDoc, ch: SoloChart): Promise<SoloDoc> {
    const price = priceAt(ch.candles, d.turn);
    const proceeds = d.shares * price;
    const trades = proceeds > 0 ? [...d.trades, { turn: d.turn, side: "sell" as const, qty: d.shares, price }] : d.trades;
    // 판 손익 = 판 동안 판 돈 - 산 돈
    const pnl = trades.reduce((a, t) => a + (t.side === "sell" ? 1 : -1) * t.qty * t.price, 0);
    const { trips, wins } = roundTrips(trades);
    const ret = d.startCash > 0 ? pnl / d.startCash : 0;
    const result: SoloResult = {
      name: ch.name,
      preset: ch.preset,
      start: d.startCash,
      final: d.startCash + pnl,
      pnl,
      ret,
      trips,
      wins,
      turns: d.turn,
      period: [dateAt(soloDate0(d.seed), HISTORY), dateAt(soloDate0(d.seed), HISTORY - 1 + Math.max(1, d.turn))],
    };
    // 판 먼저 닫고(두 번 정산되지 않게) → 돈
    const r = await col.updateOne(
      { _id: d._id, status: "play", turn: d.turn, shares: d.shares },
      { $set: { status: "done", shares: 0, cost: 0, trades, orders: [], result, endedAt: new Date(now()), name: ch.name, preset: ch.preset } }
    );
    if (!r.modifiedCount) throw new AppError("BUSY", "판 상태가 바뀌었어요. 다시 시도해 주세요.", 409);
    const played = d.trades.length > 0;
    await users.updateOne(
      { _id: d.uid },
      {
        $inc: {
          money: proceeds,
          ...(played && {
            "stats.stock.solo.games": 1,
            "stats.stock.solo.sumRet": ret,
            "stats.stock.solo.turns": d.turn,
            "stats.stock.solo.trips": trips,
            [`stats.stock.solo.p.${ch.preset}.games`]: 1,
            ...(pnl > 0 && { "stats.stock.solo.wins": 1, [`stats.stock.solo.p.${ch.preset}.wins`]: 1 }),
          }),
        },
        $set: { "stock.held": 0 },
        ...(played && { $max: { "stats.stock.solo.best": ret }, $min: { "stats.stock.solo.worst": ret } }),
      }
    );
    // 판 끝에 총자산이 500만 밑이면 자동 회생 (포커와 같은 횟수)
    const rv = await poker.autoRevive(d.uid).catch(() => null);
    if (rv?.revived) {
      result.revived = rv.revived;
      await col.updateOne({ _id: d._id }, { $set: { "result.revived": rv.revived } });
    }
    await poker.wallet.refresh(d.uid).catch(() => {});
    return { ...d, status: "done", shares: 0, cost: 0, trades, result };
  }

  const haveSchema = z.object({ have: z.number().int().min(0).max(1000).default(0) });

  // ───────────── 요청 ─────────────

  gateway.rpc("stock.solo.state", async (ctx, raw) => {
    const { uid } = member(ctx);
    const { have } = haveSchema.parse(raw ?? {});
    const d = await active(uid);
    return d ? view(d, have) : null;
  });

  /** 새 판 (하던 판이 있으면 그 판을 그대로) */
  gateway.rpc("stock.solo.start", (ctx) => {
    const { uid } = member(ctx);
    return withLock(uid, async () => {
      const cur = await active(uid);
      if (cur) return view(cur);
      await materialize(db, uid);
      const d: SoloDoc = { _id: newId(16), uid, seed: newSeed(), status: "play", turn: 0, shares: 0, cost: 0, startCash: await moneyOf(uid), trades: [], createdAt: new Date(now()) };
      const { _id, ...rest } = d;
      await col.insertOne({ _id, ...rest } as never);
      return view(d);
    });
  });

  const tradeSchema = z.object({
    side: z.enum(["buy", "sell"]),
    /** 수량 (또는 비율: 1~100 %) */
    qty: z.number().int().min(1).max(1e12).optional(),
    pct: z.number().min(1).max(100).optional(),
    have: z.number().int().min(0).max(1000).default(0),
  });

  gateway.rpc("stock.solo.trade", (ctx, raw) => {
    const { uid } = member(ctx);
    const o = tradeSchema.parse(raw);
    return withLock(uid, async () => {
      const d = await active(uid);
      if (!d) throw new AppError("NO_GAME", "진행 중인 판이 없어요.", 409);
      if (d.turn >= TURNS) throw new AppError("GAME_OVER", "이미 끝난 판이에요.", 409);
      const ch = chartOf(d.seed);
      const price = priceAt(ch.candles, d.turn);
      const trade = async (): Promise<SoloDoc> => {
        if (o.side === "buy") {
          noBuyWhileSeated(poker, uid);
          const cash = await moneyOf(uid);
          const most = maxBuy(cash, price);
          const n = Math.min(most, o.qty ?? Math.floor((most * (o.pct ?? 100)) / 100));
          if (n <= 0) throw new AppError("NOT_ENOUGH", "현금이 모자라요.", 409);
          const amount = n * price;
          const m = await users.updateOne(
            { _id: uid, money: { $gte: amount } },
            { $inc: { money: -amount }, $set: { "stock.held": (d.shares + n) * price } }
          );
          if (!m.modifiedCount) throw new AppError("NOT_ENOUGH", "현금이 모자라요.", 409);
          const t: SoloTrade = { turn: d.turn, side: "buy", qty: n, price };
          const r = await col.updateOne({ _id: d._id, status: "play", shares: d.shares }, { $inc: { shares: n, cost: amount }, $push: { trades: t } } as never);
          if (!r.modifiedCount) {
            await users.updateOne({ _id: uid }, { $inc: { money: amount } });
            throw new AppError("BUSY", "판 상태가 바뀌었어요. 다시 시도해 주세요.", 409);
          }
          return { ...d, shares: d.shares + n, cost: d.cost + amount, trades: [...d.trades, t] };
        }
        const n = Math.min(d.shares, o.qty ?? Math.ceil((d.shares * (o.pct ?? 100)) / 100));
        if (n <= 0) throw new AppError("NO_SHARES", "팔 주식이 없어요.", 409);
        const amount = n * price;
        const keep = d.shares - n;
        const cost = keep ? Math.round(d.cost * (keep / d.shares)) : 0;
        const t: SoloTrade = { turn: d.turn, side: "sell", qty: n, price };
        const r = await col.updateOne({ _id: d._id, status: "play", shares: d.shares }, { $set: { shares: keep, cost }, $push: { trades: t } } as never);
        if (!r.modifiedCount) throw new AppError("BUSY", "판 상태가 바뀌었어요. 다시 시도해 주세요.", 409);
        await users.updateOne({ _id: uid }, { $inc: { money: amount }, $set: { "stock.held": keep * price } });
        return { ...d, shares: keep, cost, trades: [...d.trades, t] };
      };
      const nd = await trade();
      void poker.wallet.refresh(uid).catch(() => {});
      return view(nd, o.have);
    });
  });

  /**
   * 예약 주문 체결 (turn 턴의 봉이 막 열린 뒤). 체결된 것은 trades 에 들어가고 orders 에서 빠짐. 돈은 users 로.
   * 한 봉에서 매수 · 익절 · 손절이 다 닿으면 매수 → 매도 순 (실제 장중 순서는 알 수 없으니 보수적으로 손절을 익절보다 먼저 봄).
   */
  async function runOrders(d: SoloDoc, ch: SoloChart, turn: number): Promise<{ d: SoloDoc; filled: NonNullable<SoloView["filled"]> }> {
    const orders = d.orders ?? [];
    const filled: NonNullable<SoloView["filled"]> = [];
    if (!orders.length) return { d, filled };
    const c = ch.candles[visibleCount(turn) - 1];
    let shares = d.shares,
      cost = d.cost;
    const trades = [...d.trades];
    const left: SoloOrder[] = [];
    const sorted = [...orders].sort((a, b) => (a.kind === "buy" ? 0 : a.kind === "stop" ? 1 : 2) - (b.kind === "buy" ? 0 : b.kind === "stop" ? 1 : 2));
    for (const o of sorted) {
      const p = fillOrder(o, c);
      if (p === null) {
        left.push(o);
        continue;
      }
      if (o.kind === "buy") {
        const cash = await moneyOf(d.uid);
        const n = Math.min(o.qty, maxBuy(cash, p));
        if (n <= 0) continue; // 돈이 모자라면 예약은 사라짐
        const amount = n * p;
        const m = await users.updateOne({ _id: d.uid, money: { $gte: amount } }, { $inc: { money: -amount } });
        if (!m.modifiedCount) continue;
        shares += n;
        cost += amount;
        trades.push({ turn, side: "buy", qty: n, price: p });
        filled.push({ kind: o.kind, qty: n, price: p, turn });
      } else {
        const n = Math.min(o.qty, shares);
        if (n <= 0) continue;
        const amount = n * p;
        const keep = shares - n;
        cost = keep ? Math.round(cost * (keep / shares)) : 0;
        shares = keep;
        await users.updateOne({ _id: d.uid }, { $inc: { money: amount } });
        trades.push({ turn, side: "sell", qty: n, price: p });
        filled.push({ kind: o.kind, qty: n, price: p, turn });
        // 같은 봉에서 손절이 나갔으면 남은 매도 예약은 팔 게 없으면 사라짐 (아래 shares 로 자연히)
      }
    }
    if (filled.length) await col.updateOne({ _id: d._id }, { $set: { shares, cost, trades, orders: left } } as never);
    return { d: { ...d, shares, cost, trades, orders: left }, filled };
  }

  /** 다음 봉 (n 개 · 끝까지 가면 정산). 봉마다 예약 주문을 먼저 봄 */
  gateway.rpc("stock.solo.next", (ctx, raw) => {
    const { uid } = member(ctx);
    const o = z.object({ n: z.number().int().min(1).max(TURNS).default(1), have: z.number().int().min(0).max(1000).default(0) }).parse(raw ?? {});
    return withLock(uid, async () => {
      let d = await active(uid);
      if (!d) throw new AppError("NO_GAME", "진행 중인 판이 없어요.", 409);
      const ch = chartOf(d.seed);
      const target = Math.min(TURNS, d.turn + o.n);
      const filled: NonNullable<SoloView["filled"]> = [];
      while (d.turn < target) {
        const turn: number = d.turn + 1;
        const r = await col.updateOne({ _id: d._id, status: "play", turn: d.turn }, { $set: { turn } });
        if (!r.modifiedCount) throw new AppError("BUSY", "판 상태가 바뀌었어요. 다시 시도해 주세요.", 409);
        d = { ...d, turn };
        if (turn < TURNS) {
          const x = await runOrders(d, ch, turn);
          d = x.d;
          filled.push(...x.filled);
          // 예약이 체결됐으면 거기서 멈춰서 보여 줌 (빨리감기 중에도)
          if (x.filled.length) break;
        }
      }
      if (d.turn >= TURNS) return view(await finish(d, ch), o.have, filled);
      await setHeld(uid, d.shares * priceAt(ch.candles, d.turn));
      void poker.wallet.refresh(uid).catch(() => {});
      return view(d, o.have, filled);
    });
  });

  /** 예약 주문 걸기 */
  gateway.rpc("stock.solo.order", (ctx, raw) => {
    const { uid } = member(ctx);
    const o = z
      .object({ kind: z.enum(["buy", "take", "stop"]), price: z.number().positive().max(1e12), qty: z.number().int().min(1).max(1e12), have: z.number().int().min(0).max(1000).default(0) })
      .parse(raw);
    return withLock(uid, async () => {
      const d = await active(uid);
      if (!d) throw new AppError("NO_GAME", "진행 중인 판이 없어요.", 409);
      if (d.turn >= TURNS) throw new AppError("GAME_OVER", "이미 끝난 판이에요.", 409);
      const orders = d.orders ?? [];
      if (orders.length >= MAX_ORDERS) throw new AppError("TOO_MANY", `예약은 ${MAX_ORDERS}개까지 걸 수 있어요.`, 409);
      const ch = chartOf(d.seed);
      const cur = priceAt(ch.candles, d.turn);
      const price = roundTick(o.price);
      if (o.kind === "buy" && price >= cur) throw new AppError("BAD_PRICE", "지정가 매수는 지금 가격보다 낮게 걸어요.", 400);
      if (o.kind === "take" && price <= cur) throw new AppError("BAD_PRICE", "익절은 지금 가격보다 높게 걸어요.", 400);
      if (o.kind === "stop" && price >= cur) throw new AppError("BAD_PRICE", "손절은 지금 가격보다 낮게 걸어요.", 400);
      if (o.kind !== "buy" && d.shares <= 0) throw new AppError("NO_SHARES", "팔 주식이 없어요.", 409);
      const order: SoloOrder = { id: newId(8), kind: o.kind, price, qty: o.qty };
      await col.updateOne({ _id: d._id, status: "play" }, { $push: { orders: order } } as never);
      return view({ ...d, orders: [...orders, order] }, o.have);
    });
  });

  gateway.rpc("stock.solo.cancelOrder", (ctx, raw) => {
    const { uid } = member(ctx);
    const { id, have } = z.object({ id: z.string().max(20), have: z.number().int().min(0).max(1000).default(0) }).parse(raw);
    return withLock(uid, async () => {
      const d = await active(uid);
      if (!d) throw new AppError("NO_GAME", "진행 중인 판이 없어요.", 409);
      const orders = (d.orders ?? []).filter((x) => x.id !== id);
      await col.updateOne({ _id: d._id }, { $set: { orders } } as never);
      return view({ ...d, orders }, have);
    });
  });

  /** 복기 메모 */
  gateway.rpc("stock.solo.memo", async (ctx, raw) => {
    const { uid } = member(ctx);
    const { id, memo } = z.object({ id: z.string().max(40), memo: z.string().max(200) }).parse(raw);
    const clean = memo.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
    const r = await col.updateOne({ _id: id, uid, status: "done" }, { $set: { memo: clean } } as never);
    if (!r.matchedCount) throw new AppError("NOT_FOUND", "기록이 없어요.", 404);
    return { memo: clean };
  });

  /** 그만하기: 지금 종가로 정리하고 끝 */
  gateway.rpc("stock.solo.quit", (ctx, raw) => {
    const { uid } = member(ctx);
    const { have } = haveSchema.parse(raw ?? {});
    return withLock(uid, async () => {
      const d = await active(uid);
      if (!d) return null;
      return view(await finish(d, chartOf(d.seed)), have);
    });
  });

  gateway.rpc("stock.solo.history", async (ctx) => {
    const { uid } = member(ctx);
    const docs = (await col
      .find({ uid, status: "done" }, { projection: { result: 1, endedAt: 1, name: 1, preset: 1, memo: 1 } })
      .sort({ endedAt: -1 })
      .limit(30)
      .toArray()) as unknown as SoloDoc[];
    return docs
      .filter((d) => d.result)
      .map(
        (d): SoloHistoryRow => ({
          id: d._id,
          at: d.endedAt?.getTime() ?? 0,
          name: d.result!.name,
          preset: d.result!.preset,
          ret: d.result!.ret,
          pnl: d.result!.pnl,
          trips: d.result!.trips,
          turns: d.result!.turns,
          ...(d.memo && { memo: d.memo }),
        })
      );
  });

  gateway.rpc("stock.solo.review", async (ctx, raw) => {
    const { uid } = member(ctx);
    const { id } = z.object({ id: z.string().max(40) }).parse(raw);
    const d = (await col.findOne({ _id: id, uid, status: "done" })) as SoloDoc | null;
    if (!d?.result) throw new AppError("NOT_FOUND", "기록이 없어요.", 404);
    const ch = chartOf(d.seed);
    const out: SoloReview = { id: d._id, name: ch.name, preset: ch.preset, candles: ch.candles as Candle[], trades: d.trades, result: d.result, date0: soloDate0(d.seed), memo: d.memo ?? "" };
    return out;
  });

  return {
    /** 허브 상태 줄: 하던 판의 턴 · 지난 판 수익률 */
    async hub(uid: string): Promise<{ turn: number | null; last: number | null }> {
      const [a, last] = await Promise.all([active(uid), col.find({ uid, status: "done" }, { projection: { result: 1 } }).sort({ endedAt: -1 }).limit(1).toArray()]);
      return { turn: a ? a.turn : null, last: (last[0] as unknown as SoloDoc | undefined)?.result?.ret ?? null };
    },
    /** 주간 손익 순위 (이번 주 월요일부터 끝난 판) */
    async week(from: number, limit = 50) {
      return col
        .aggregate<{ _id: string; pnl: number; games: number }>([
          { $match: { status: "done", endedAt: { $gte: new Date(from) } } },
          { $group: { _id: "$uid", pnl: { $sum: "$result.pnl" }, games: { $sum: 1 } } },
          { $sort: { pnl: -1 } },
          { $limit: limit },
        ])
        .toArray();
    },
    _chartOf: chartOf,
  };
}
