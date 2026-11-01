import { z } from "zod";
import type { Database } from "../../db";
import { AppError } from "../../errors";
import type { Gateway } from "../../realtime/gateway";
import type { UserDoc } from "../../users";
import { newId } from "../../ids";
import { charOf, lookOf, type CharId, type Look } from "../../../../web/src/lib/poker/rules";
import { LANDMARKS, MAX_UNITS, UNIT_TYPES, landmarkOf, minNextBid, nextSeason, resaleOf, seasonEnd, seasonOf, unitType } from "../../../../web/src/lib/stock/estate";
import type { EstateLotWire, EstateUnitWire, EstateView } from "../../../../web/src/lib/stock/types";
import { skinsOf } from "../poker/wallet";
import { createLocks, faceOf, materialize, member, noBuyWhileSeated, type PokerLink } from "./common";

/*
 * 부동산 · 경매장.
 *  아파트: users.estate.units 에 호실 목록, users.estate.value 에 되팔 때 받을 값의 합 (회생 · 총자산)
 *  명당: stock_lots 문서 하나에 지금 시즌 주인 + 다음 시즌 최고 입찰.
 *    입찰할 때 돈을 바로 빼 두고(users.estate.escrow — 회생 판정에 합침), 더 높은 입찰이 들어오면 앞사람에게 돌려줌.
 *    시즌이 바뀐 뒤 처음 읽을 때 정산: 최고 입찰자가 새 주인 (입찰금은 사라짐) · 입찰이 없으면 빈집.
 */

interface UnitDoc {
  id: string;
  type: string;
  no: number;
  at: number;
}
interface LotDoc {
  _id: string;
  owner: { uid: string; nick: string; char: CharId; look: Look } | null;
  ownerSeason: string | null;
  /** 다음 시즌(season) 을 위한 최고 입찰 */
  bid: { uid: string; nick: string; amount: number; season: string; at: number } | null;
}
type EstateFields = { estate?: { units?: UnitDoc[]; value?: number } };

export function createEstate(db: Database, gateway: Gateway, poker: PokerLink, now: () => number = Date.now) {
  const users = db.col<UserDoc>("users");
  const lots = db.col<Omit<LotDoc, "_id">>("stock_lots");
  const withLock = createLocks();

  /** 시즌이 바뀌었으면 정산 (여러 번 불러도 한 번만: 조건부 갱신) */
  async function settle(): Promise<LotDoc[]> {
    const season = seasonOf(now());
    const docs = (await lots.find({}).toArray()) as unknown as LotDoc[];
    const byId = new Map(docs.map((d) => [d._id, d]));
    const out: LotDoc[] = [];
    for (const lm of LANDMARKS) {
      let d = byId.get(lm.id);
      if (!d) {
        d = { _id: lm.id, owner: null, ownerSeason: null, bid: null };
        await lots.updateOne({ _id: lm.id }, { $setOnInsert: { owner: null, ownerSeason: null, bid: null } }, { upsert: true });
      }
      // 입찰한 시즌이 왔거나 지났으면 → 주인이 바뀜
      if (d.bid && d.bid.season <= season) {
        const b = d.bid;
        const face = await faceOf(db, b.uid);
        const owner = { uid: b.uid, nick: b.nick, char: face.char, look: face.look };
        const r = await lots.updateOne({ _id: lm.id, "bid.uid": b.uid, "bid.amount": b.amount }, { $set: { owner, ownerSeason: b.season, bid: null } });
        if (r.modifiedCount) {
          // 낙찰: 맡겨 둔 입찰금은 사라짐 (돈 소모처)
          await users.updateOne({ _id: b.uid }, { $inc: { "estate.escrow": -b.amount, "stats.stock.estate.won": 1 } });
          d = { ...d, owner, ownerSeason: b.season, bid: null };
        }
        else d = ((await lots.findOne({ _id: lm.id })) as unknown as LotDoc) ?? d;
      }
      // 주인의 시즌이 끝났는데 새 입찰이 없었으면 → 빈집
      if (d.owner && d.ownerSeason && d.ownerSeason < season) {
        await lots.updateOne({ _id: lm.id, ownerSeason: d.ownerSeason }, { $set: { owner: null, ownerSeason: null } });
        d = { ...d, owner: null, ownerSeason: null };
      }
      out.push(d);
    }
    return out;
  }

  const unitsOf = async (uid: string) =>
    ((await users.findOne({ _id: uid }, { projection: { "estate.units": 1 } })) as EstateFields | null)?.estate?.units ?? [];

  async function plate() {
    const docs = await users
      .find({ "estate.value": { $gt: 0 } } as never, { projection: { nick: 1, "estate.units": 1, "estate.value": 1, "poker.char": 1, "poker.skins": 1, "poker.wear": 1 } })
      .sort({ "estate.value": -1 })
      .limit(5)
      .toArray();
    return docs.map((d) => {
      const u = d as unknown as UserDoc & EstateFields & { poker?: { char?: string; skins?: string[]; wear?: Record<string, string> } };
      const units = u.estate?.units ?? [];
      const top = units.reduce<UnitDoc | null>((a, x) => (!a || x.no > a.no ? x : a), null);
      const char = charOf(u.poker?.char);
      return { nick: u.nick, char, look: lookOf(char, skinsOf(u.poker).wear), value: u.estate?.value ?? 0, top: top ? `${top.no}호 ${unitType(top.type)?.name ?? ""}` : "" };
    });
  }

  async function viewOf(uid: string): Promise<EstateView> {
    const season = seasonOf(now());
    const [docs, units, pl, residents] = await Promise.all([settle(), unitsOf(uid), plate(), users.countDocuments({ "estate.value": { $gt: 0 } } as never)]);
    const lotsW: EstateLotWire[] = docs.map((d) => {
      const lm = landmarkOf(d._id)!;
      return {
        id: d._id,
        name: lm.name,
        owner: d.owner ? { nick: d.owner.nick, char: d.owner.char, look: d.owner.look } : null,
        ownerSeason: d.ownerSeason,
        bid: d.bid ? { nick: d.bid.nick, amount: d.bid.amount, mine: d.bid.uid === uid } : null,
        minNext: minNextBid(lm, d.bid?.amount ?? null),
      };
    });
    return {
      season,
      next: nextSeason(season),
      endsAt: seasonEnd(season),
      units: units.map((u): EstateUnitWire => ({ id: u.id, type: u.type, no: u.no, at: u.at })),
      lots: lotsW,
      plate: pl,
      residents,
    };
  }

  gateway.rpc("stock.estate", (ctx) => viewOf(member(ctx).uid));

  gateway.rpc("stock.estate.buy", (ctx, raw) => {
    const { uid } = member(ctx);
    const { type } = z.object({ type: z.enum(UNIT_TYPES.map((u) => u.id) as [string, ...string[]]) }).parse(raw);
    const ut = unitType(type)!;
    return withLock(uid, async () => {
      noBuyWhileSeated(poker, uid);
      await materialize(db, uid);
      const units = await unitsOf(uid);
      if (units.length >= MAX_UNITS) throw new AppError("TOO_MANY", `호실은 ${MAX_UNITS}개까지 가질 수 있어요.`, 409);
      // 호수: 그 평형의 층 · 01~12호 (펜트하우스는 30층 한 줄)
      const floor = ut.floors[0] + Math.floor(Math.random() * (ut.floors[1] - ut.floors[0] + 1));
      const unit: UnitDoc = { id: newId(10), type: ut.id, no: floor * 100 + 1 + Math.floor(Math.random() * 12), at: now() };
      const r = await users.updateOne(
        { _id: uid, money: { $gte: ut.price } },
        { $inc: { money: -ut.price, "estate.value": resaleOf(ut.price), "stats.stock.estate.bought": ut.price }, $push: { "estate.units": unit } } as never
      );
      if (!r.modifiedCount) throw new AppError("NOT_ENOUGH", "현금이 모자라요.", 409);
      await poker.wallet.refresh(uid).catch(() => {});
      return viewOf(uid);
    });
  });

  gateway.rpc("stock.estate.sell", (ctx, raw) => {
    const { uid } = member(ctx);
    const { id } = z.object({ id: z.string().max(20) }).parse(raw);
    return withLock(uid, async () => {
      const unit = (await unitsOf(uid)).find((u) => u.id === id);
      if (!unit) throw new AppError("NOT_FOUND", "없는 호실이에요.", 404);
      const ut = unitType(unit.type);
      if (!ut) throw new AppError("NOT_FOUND", "없는 호실이에요.", 404);
      const back = resaleOf(ut.price);
      const r = await users.updateOne(
        { _id: uid, "estate.units.id": id } as never,
        { $pull: { "estate.units": unit }, $inc: { money: back, "estate.value": -back } } as never
      );
      if (!r.modifiedCount) throw new AppError("NOT_FOUND", "없는 호실이에요.", 404);
      // 소수점 · 옛 값 때문에 음수가 되지 않게
      await users.updateOne({ _id: uid, "estate.value": { $lt: 0 } } as never, { $set: { "estate.value": 0 } });
      await poker.wallet.refresh(uid).catch(() => {});
      return viewOf(uid);
    });
  });

  gateway.rpc("stock.estate.bid", (ctx, raw) => {
    const { uid, nick } = member(ctx);
    const o = z.object({ lot: z.string().max(10), amount: z.number().int().min(1).max(1e15) }).parse(raw);
    const lm = landmarkOf(o.lot);
    if (!lm) throw new AppError("NOT_FOUND", "없는 집이에요.", 404);
    return withLock(uid, async () => {
      noBuyWhileSeated(poker, uid);
      await materialize(db, uid);
      const docs = await settle();
      const d = docs.find((x) => x._id === lm.id)!;
      const season = nextSeason(seasonOf(now()));
      const top = d.bid?.amount ?? null;
      if (o.amount < minNextBid(lm, top)) throw new AppError("LOW_BID", "입찰가가 낮아요. 화면을 새로 보고 다시 입찰해 주세요.", 409);
      const mine = d.bid?.uid === uid;
      // 내 입찰을 올리는 거면 차액만, 아니면 전액을 빼 둠
      const pay = mine ? o.amount - (top ?? 0) : o.amount;
      const m = await users.updateOne({ _id: uid, money: { $gte: pay } }, { $inc: { money: -pay, "estate.escrow": pay, "stats.stock.estate.bids": 1 } });
      if (!m.modifiedCount) throw new AppError("NOT_ENOUGH", "현금이 모자라요.", 409);
      const cond = d.bid ? { _id: lm.id, "bid.uid": d.bid.uid, "bid.amount": d.bid.amount } : { _id: lm.id, bid: null };
      const r = await lots.updateOne(cond as never, { $set: { bid: { uid, nick, amount: o.amount, season, at: now() } } });
      if (!r.modifiedCount) {
        await users.updateOne({ _id: uid }, { $inc: { money: pay, "estate.escrow": -pay } });
        throw new AppError("OUTBID", "방금 다른 입찰이 들어왔어요. 다시 봐 주세요.", 409);
      }
      // 앞사람 입찰금 돌려주기
      if (d.bid && !mine) {
        await users.updateOne({ _id: d.bid.uid }, { $inc: { money: d.bid.amount, "estate.escrow": -d.bid.amount } });
        void poker.wallet.refresh(d.bid.uid).catch(() => {});
      }
      await poker.wallet.refresh(uid).catch(() => {});
      return viewOf(uid);
    });
  });

  return {
    async hub(): Promise<{ bids: number; residents: number }> {
      const docs = await settle();
      return { bids: docs.filter((d) => d.bid).length, residents: await users.countDocuments({ "estate.value": { $gt: 0 } } as never) };
    },
    settle,
  };
}
