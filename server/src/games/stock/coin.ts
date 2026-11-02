import { z } from "zod";
import type { Database } from "../../db";
import { AppError } from "../../errors";
import type { Gateway } from "../../realtime/gateway";
import type { UserDoc } from "../../users";
import { newId } from "../../ids";
import {
  COIN_HISTORY,
  COIN_TURNS,
  LEVERAGES,
  coinDate0,
  coinDateAt,
  coinPriceAt,
  coinQty,
  coinVisible,
  genCoin,
  liqPrice,
  liquidated,
  marginValue,
  type CoinChart,
  type CoinPos,
  type CoinTrade,
  type Leverage,
} from "../../../../web/src/lib/stock/coin";
import { newSeed } from "../../../../web/src/lib/stock/rng";
import type { CoinHistoryRow, CoinResult, CoinReview, CoinView } from "../../../../web/src/lib/stock/types";
import type { Candle } from "../../../../web/src/lib/stock/solo";
import { createLocks, member, type StkWallet } from "./common";

/*
 * 코인 거래소 — 솔로와 같은 구조 (서버가 판을 들고 있음 · 미래 봉은 안 내려감).
 * 돈: 주식게임 전용 지갑 users.stk.cash. 진입하면 증거금이 현금에서 빠지고, 포지션의 지금 평가액은 users.stk.coinHeld (회생 · 총자산).
 * 포지션은 한 판에 하나 (같은 배수면 추가 진입 = 평단 합침). 청산(봉 저가가 청산가 밑)이면 증거금은 사라짐.
 */

interface CoinDoc {
  _id: string;
  uid: string;
  seed: string;
  status: "play" | "done";
  turn: number;
  pos: CoinPos | null;
  startCash: number;
  trades: CoinTrade[];
  createdAt: Date;
  endedAt?: Date;
  result?: CoinResult;
  name?: string;
}

const CACHE = 200;
const MIN_MARGIN = 10_000;

export function createCoin(db: Database, gateway: Gateway, wallet: StkWallet, now: () => number = Date.now) {
  const col = db.col<Omit<CoinDoc, "_id">>("stk_coin");
  const users = db.col<UserDoc>("users");
  const withLock = createLocks();
  void col.createIndex({ uid: 1, status: 1 }).catch(() => {});
  void col.createIndex({ uid: 1, endedAt: -1 }).catch(() => {});

  const charts = new Map<string, CoinChart>();
  function chartOf(seed: string): CoinChart {
    let c = charts.get(seed);
    if (c) {
      charts.delete(seed);
      charts.set(seed, c);
      return c;
    }
    c = genCoin(seed);
    charts.set(seed, c);
    if (charts.size > CACHE) charts.delete(charts.keys().next().value!);
    return c;
  }
  const moneyOf = (uid: string) => wallet.cash(uid);
  const setHeld = (uid: string, v: number) => users.updateOne({ _id: uid }, { $set: { "stk.coinHeld": Math.max(0, Math.round(v)) } });
  const active = async (uid: string) => (await col.findOne({ uid, status: "play" })) as CoinDoc | null;

  async function view(d: CoinDoc, have = 0, liq?: CoinView["liq"]): Promise<CoinView> {
    const ch = chartOf(d.seed);
    const vis = d.status === "done" ? COIN_HISTORY + COIN_TURNS : coinVisible(d.turn);
    const from = Math.max(0, Math.min(have, vis));
    return {
      id: d._id,
      name: ch.name,
      sym: ch.sym,
      date0: coinDate0(d.seed),
      preset: d.status === "done" ? ch.preset : null,
      turn: d.turn,
      turns: COIN_TURNS,
      from,
      candles: ch.candles.slice(from, vis),
      pos: d.status === "done" ? null : d.pos,
      cash: await moneyOf(d.uid),
      startCash: d.startCash,
      trades: d.trades,
      ...(liq && { liq }),
      done: d.status === "done",
      result: d.result ?? null,
    };
  }

  function summarize(trades: CoinTrade[]) {
    let opens = 0,
      wins = 0,
      liqs = 0,
      maxLev = 1,
      put = 0,
      got = 0;
    // 진입 → 종료 묶음: 종료(close · liq) 때마다 그 포지션에 넣은 증거금 합과 비교
    let curPut = 0;
    for (const t of trades) {
      maxLev = Math.max(maxLev, t.lev);
      if (t.side === "open") {
        if (curPut === 0) opens++;
        curPut += t.margin;
        put += t.margin;
      } else {
        got += t.back ?? 0;
        if (t.side === "liq") liqs++;
        // 포지션이 다 닫혔는지는 margin(남은 증거금)이 0 인지로
        if (t.margin === 0) {
          if ((t.back ?? 0) > 0 && curPut > 0 && t.back! >= curPut) wins++;
          curPut = 0;
        }
      }
    }
    return { opens, wins, liqs, maxLev, pnl: got - put };
  }

  async function finish(d: CoinDoc, ch: CoinChart, liqTurn?: number): Promise<CoinDoc> {
    const price = coinPriceAt(ch.candles, d.turn);
    let trades = d.trades;
    let back = 0;
    if (d.pos) {
      back = marginValue(d.pos.margin, d.pos.lev, d.pos.entry, price);
      trades = [...trades, { turn: d.turn, side: "close", margin: 0, lev: d.pos.lev, price, back }];
    }
    const sm = summarize(trades);
    const ret = d.startCash > 0 ? sm.pnl / d.startCash : 0;
    const result: CoinResult = {
      name: ch.name,
      sym: ch.sym,
      preset: ch.preset,
      start: d.startCash,
      final: d.startCash + sm.pnl,
      pnl: sm.pnl,
      ret,
      opens: sm.opens,
      wins: sm.wins,
      liqs: sm.liqs,
      maxLev: sm.maxLev,
      turns: liqTurn ?? d.turn,
      period: [coinDateAt(coinDate0(d.seed), COIN_HISTORY), coinDateAt(coinDate0(d.seed), COIN_HISTORY - 1 + Math.max(1, d.turn))],
    };
    const r = await col.updateOne({ _id: d._id, status: "play", turn: d.turn }, { $set: { status: "done", pos: null, trades, result, endedAt: new Date(now()), name: ch.name } });
    if (!r.modifiedCount) throw new AppError("BUSY", "판 상태가 바뀌었어요. 다시 시도해 주세요.", 409);
    const played = trades.length > 0;
    await users.updateOne(
      { _id: d.uid },
      {
        $inc: {
          "stk.cash": back,
          ...(played && {
            "stats.stk.coin.games": 1,
            "stats.stk.coin.sumRet": ret,
            "stats.stk.coin.liq": sm.liqs,
            ...(sm.pnl > 0 && { "stats.stk.coin.wins": 1 }),
          }),
        },
        $set: { "stk.coinHeld": 0 },
        ...(played && { $max: { "stats.stk.coin.best": ret }, $min: { "stats.stk.coin.worst": ret } }),
      }
    );
    const rv = await wallet.revive(d.uid).catch(() => null);
    if (rv?.revived) {
      result.revived = rv.revived;
      await col.updateOne({ _id: d._id }, { $set: { "result.revived": rv.revived } });
    }
    return { ...d, status: "done", pos: null, trades, result };
  }

  const haveSchema = z.object({ have: z.number().int().min(0).max(1000).default(0) });

  gateway.rpc("stock.coin.state", async (ctx, raw) => {
    const { uid } = member(ctx);
    const { have } = haveSchema.parse(raw ?? {});
    const d = await active(uid);
    return d ? view(d, have) : null;
  });

  gateway.rpc("stock.coin.start", (ctx) => {
    const { uid } = member(ctx);
    return withLock(uid, async () => {
      const cur = await active(uid);
      if (cur) return view(cur);
      await wallet.ensure(uid);
      const d: CoinDoc = { _id: newId(16), uid, seed: newSeed(), status: "play", turn: 0, pos: null, startCash: await moneyOf(uid), trades: [], createdAt: new Date(now()) };
      const { _id, ...rest } = d;
      await col.insertOne({ _id, ...rest } as never);
      return view(d);
    });
  });

  /** 진입 (롱): 증거금 · 배수 */
  gateway.rpc("stock.coin.open", (ctx, raw) => {
    const { uid } = member(ctx);
    const o = z.object({ margin: z.number().int().min(MIN_MARGIN).max(1e15), lev: z.union([z.literal(1), z.literal(3), z.literal(10)]), have: z.number().int().min(0).max(1000).default(0) }).parse(raw);
    return withLock(uid, async () => {
      const d = await active(uid);
      if (!d) throw new AppError("NO_GAME", "진행 중인 판이 없어요.", 409);
      if (d.turn >= COIN_TURNS) throw new AppError("GAME_OVER", "이미 끝난 판이에요.", 409);
      if (d.pos && d.pos.lev !== o.lev) throw new AppError("LEV", `지금 ${d.pos.lev}배 포지션이 있어요. 먼저 정리하거나 같은 배수로 추가해 주세요.`, 409);
      const ch = chartOf(d.seed);
      const price = coinPriceAt(ch.candles, d.turn);
      const cash = await moneyOf(uid);
      const margin = Math.min(o.margin, cash);
      if (margin < MIN_MARGIN) throw new AppError("NOT_ENOUGH", "증거금이 모자라요.", 409);
      const m = await users.updateOne({ _id: uid, "stk.cash": { $gte: margin } }, { $inc: { "stk.cash": -margin } });
      if (!m.modifiedCount) throw new AppError("NOT_ENOUGH", "현금이 모자라요.", 409);
      const lev = o.lev as Leverage;
      let pos: CoinPos;
      if (d.pos) {
        // 추가 진입: 지금 평가액 + 새 증거금 = 새 증거금, 진입가 = 지금 가격 (평가액 기준으로 다시 잡음)
        const cur = marginValue(d.pos.margin, d.pos.lev, d.pos.entry, price);
        const nm = cur + margin;
        pos = { margin: nm, lev, entry: price, qty: coinQty(nm, lev, price) };
      } else pos = { margin, lev, entry: price, qty: coinQty(margin, lev, price) };
      const t: CoinTrade = { turn: d.turn, side: "open", margin, lev, price };
      const r = await col.updateOne({ _id: d._id, status: "play", turn: d.turn }, { $set: { pos }, $push: { trades: t } } as never);
      if (!r.modifiedCount) {
        await users.updateOne({ _id: uid }, { $inc: { "stk.cash": margin } });
        throw new AppError("BUSY", "판 상태가 바뀌었어요. 다시 시도해 주세요.", 409);
      }
      await setHeld(uid, marginValue(pos.margin, pos.lev, pos.entry, price));
      return view({ ...d, pos, trades: [...d.trades, t] }, o.have);
    });
  });

  /** 정리 (일부 비율 · 전부) */
  gateway.rpc("stock.coin.close", (ctx, raw) => {
    const { uid } = member(ctx);
    const o = z.object({ pct: z.number().min(1).max(100).default(100), have: z.number().int().min(0).max(1000).default(0) }).parse(raw ?? {});
    return withLock(uid, async () => {
      const d = await active(uid);
      if (!d) throw new AppError("NO_GAME", "진행 중인 판이 없어요.", 409);
      if (!d.pos) throw new AppError("NO_POS", "정리할 포지션이 없어요.", 409);
      const ch = chartOf(d.seed);
      const price = coinPriceAt(ch.candles, d.turn);
      const total = marginValue(d.pos.margin, d.pos.lev, d.pos.entry, price);
      const frac = Math.min(1, o.pct / 100);
      const back = frac >= 1 ? total : Math.floor(total * frac);
      const keepMargin = frac >= 1 ? 0 : Math.round(d.pos.margin * (1 - frac));
      const pos: CoinPos | null = keepMargin > 0 ? { ...d.pos, margin: keepMargin, qty: coinQty(keepMargin, d.pos.lev, d.pos.entry) } : null;
      const t: CoinTrade = { turn: d.turn, side: "close", margin: keepMargin, lev: d.pos.lev, price, back };
      const r = await col.updateOne({ _id: d._id, status: "play", turn: d.turn }, { $set: { pos }, $push: { trades: t } } as never);
      if (!r.modifiedCount) throw new AppError("BUSY", "판 상태가 바뀌었어요. 다시 시도해 주세요.", 409);
      await users.updateOne({ _id: uid }, { $inc: { "stk.cash": back }, $set: { "stk.coinHeld": pos ? marginValue(pos.margin, pos.lev, pos.entry, price) : 0 } });
      return view({ ...d, pos, trades: [...d.trades, t] }, o.have);
    });
  });

  gateway.rpc("stock.coin.next", (ctx, raw) => {
    const { uid } = member(ctx);
    const o = z.object({ n: z.number().int().min(1).max(COIN_TURNS).default(1), have: z.number().int().min(0).max(1000).default(0) }).parse(raw ?? {});
    return withLock(uid, async () => {
      let d = await active(uid);
      if (!d) throw new AppError("NO_GAME", "진행 중인 판이 없어요.", 409);
      const ch = chartOf(d.seed);
      const target = Math.min(COIN_TURNS, d.turn + o.n);
      let liq: CoinView["liq"];
      while (d.turn < target) {
        const turn: number = d.turn + 1;
        const r = await col.updateOne({ _id: d._id, status: "play", turn: d.turn }, { $set: { turn } });
        if (!r.modifiedCount) throw new AppError("BUSY", "판 상태가 바뀌었어요. 다시 시도해 주세요.", 409);
        d = { ...d, turn };
        const c = ch.candles[coinVisible(turn) - 1];
        if (d.pos && liquidated(d.pos, c)) {
          const lp = liqPrice(d.pos.lev, d.pos.entry);
          const t: CoinTrade = { turn, side: "liq", margin: 0, lev: d.pos.lev, price: lp, back: 0 };
          liq = { turn, price: lp, margin: d.pos.margin };
          await col.updateOne({ _id: d._id }, { $set: { pos: null }, $push: { trades: t } } as never);
          d = { ...d, pos: null, trades: [...d.trades, t] };
          break; // 청산되면 거기서 멈춰서 보여 줌
        }
      }
      if (d.turn >= COIN_TURNS) return view(await finish(d, ch), o.have, liq);
      await setHeld(uid, d.pos ? marginValue(d.pos.margin, d.pos.lev, d.pos.entry, coinPriceAt(ch.candles, d.turn)) : 0);
      return view(d, o.have, liq);
    });
  });

  gateway.rpc("stock.coin.quit", (ctx, raw) => {
    const { uid } = member(ctx);
    const { have } = haveSchema.parse(raw ?? {});
    return withLock(uid, async () => {
      const d = await active(uid);
      if (!d) return null;
      return view(await finish(d, chartOf(d.seed)), have);
    });
  });

  gateway.rpc("stock.coin.history", async (ctx) => {
    const { uid } = member(ctx);
    const docs = (await col.find({ uid, status: "done" }, { projection: { result: 1, endedAt: 1 } }).sort({ endedAt: -1 }).limit(30).toArray()) as unknown as CoinDoc[];
    return docs
      .filter((d) => d.result)
      .map(
        (d): CoinHistoryRow => ({ id: d._id, at: d.endedAt?.getTime() ?? 0, name: d.result!.name, sym: d.result!.sym, ret: d.result!.ret, pnl: d.result!.pnl, liqs: d.result!.liqs, maxLev: d.result!.maxLev, turns: d.result!.turns })
      );
  });

  gateway.rpc("stock.coin.review", async (ctx, raw) => {
    const { uid } = member(ctx);
    const { id } = z.object({ id: z.string().max(40) }).parse(raw);
    const d = (await col.findOne({ _id: id, uid, status: "done" })) as CoinDoc | null;
    if (!d?.result) throw new AppError("NOT_FOUND", "기록이 없어요.", 404);
    const ch = chartOf(d.seed);
    const out: CoinReview = { id: d._id, name: ch.name, sym: ch.sym, candles: ch.candles as Candle[], trades: d.trades, result: d.result, date0: coinDate0(d.seed) };
    return out;
  });

  return {
    async hub(uid: string): Promise<{ turn: number | null; last: number | null }> {
      const [a, last] = await Promise.all([active(uid), col.find({ uid, status: "done" }, { projection: { result: 1 } }).sort({ endedAt: -1 }).limit(1).toArray()]);
      return { turn: a ? a.turn : null, last: (last[0] as unknown as CoinDoc | undefined)?.result?.ret ?? null };
    },
    /** 기간 손익 (순위용) */
    async since(from: number, limit = 200) {
      return col
        .aggregate<{ _id: string; pnl: number; games: number }>([
          { $match: { status: "done", endedAt: { $gte: new Date(from) } } },
          { $group: { _id: "$uid", pnl: { $sum: "$result.pnl" }, games: { $sum: 1 } } },
          { $limit: limit },
        ])
        .toArray();
    },
    _chartOf: chartOf,
    _leverages: LEVERAGES,
  };
}
