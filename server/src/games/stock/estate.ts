import { z } from "zod";
import type { Database } from "../../db";
import { AppError } from "../../errors";
import type { Gateway } from "../../realtime/gateway";
import type { UserDoc } from "../../users";
import { newId } from "../../ids";
import { charOf, kstDay, lookOf, type CharId, type Look } from "../../../../web/src/lib/poker/rules";
import { HOME_TYPES, LOT_NAMES, MAX_UNITS, dailyOf, homeRank, homeType, lotHome, resaleOf } from "../../../../web/src/lib/stock/estate";
import type { AttendResult, EstateLotWire, EstateUnitWire, EstateView, HomeView } from "../../../../web/src/lib/stock/types";
import { skinsOf } from "../poker/wallet";
import { createLocks, faceOf, materialize, member, noBuyWhileSeated, type PokerLink } from "./common";

/*
 * 부동산.
 *  집: users.estate.units 에 목록(아파트형 호수 · 단독형 자리), users.estate.value 에 되팔 때 받을 값의 합 (회생 · 총자산)
 *  단독형 자리: stock_lots 문서 하나에 주인 (선착순 고정가, 경매 없음)
 *  출석 보너스: 집이 있으면 하루 한 번 (KST) 가진 집값 합 × DAILY — users.estate.attend 에 받은 날
 *  집 안: 내 집 · 남의 집 구경 (stock.home) — 방문 수는 users.estate.visits
 */

interface UnitDoc {
  id: string;
  type: string;
  no: number;
  lot?: string;
  at: number;
}
interface LotDoc {
  _id: string;
  owner: { uid: string; nick: string; char: CharId; look: Look } | null;
  unit: string | null;
  at: number | null;
}
type EstateFields = { estate?: { units?: UnitDoc[]; value?: number; attend?: string; visits?: number } };

export function createEstate(db: Database, gateway: Gateway, poker: PokerLink, now: () => number = Date.now) {
  const users = db.col<UserDoc>("users");
  const lots = db.col<Omit<LotDoc, "_id">>("stock_lots");
  const withLock = createLocks();
  const ALL_LOTS = HOME_TYPES.flatMap((t) => t.lots ?? []);

  const unitsOf = async (uid: string) =>
    ((await users.findOne({ _id: uid }, { projection: { "estate.units": 1 } })) as EstateFields | null)?.estate?.units ?? [];
  const wire = (u: UnitDoc): EstateUnitWire => ({ id: u.id, type: u.type, no: u.no, ...(u.lot && { lot: u.lot }), at: u.at });
  const valueOf = (units: UnitDoc[]) => units.reduce((a, u) => a + resaleOf(homeType(u.type)?.price ?? 0), 0);
  const dailyOfUnits = (units: UnitDoc[]) => units.reduce((a, u) => a + dailyOf(homeType(u.type)?.price ?? 0), 0);
  const bestOf = (units: UnitDoc[]) => units.reduce<UnitDoc | null>((a, x) => (!a || homeRank(x.type) > homeRank(a.type) || (homeRank(x.type) === homeRank(a.type) && x.no > a.no) ? x : a), null);
  const label = (u: UnitDoc | null) => (u ? (u.lot ? LOT_NAMES[u.lot] : `${u.no}호 ${homeType(u.type)?.name ?? ""}`) : "");

  async function lotDocs(): Promise<LotDoc[]> {
    const docs = (await lots.find({}).toArray()) as unknown as LotDoc[];
    const by = new Map(docs.map((d) => [d._id, d]));
    return ALL_LOTS.map((id) => by.get(id) ?? { _id: id, owner: null, unit: null, at: null });
  }
  const lotsWire = (docs: LotDoc[]): EstateLotWire[] => docs.map((d) => ({ lot: d._id, name: LOT_NAMES[d._id] ?? d._id, type: lotHome(d._id)!.id, owner: d.owner }));

  async function plate() {
    const docs = await users
      .find({ "estate.value": { $gt: 0 } } as never, { projection: { nick: 1, "estate.units": 1, "estate.value": 1, "poker.char": 1, "poker.skins": 1, "poker.wear": 1 } })
      .sort({ "estate.value": -1 })
      .limit(5)
      .toArray();
    return docs.map((d) => {
      const u = d as unknown as UserDoc & EstateFields & { _id: string; poker?: { char?: string; skins?: string[]; wear?: Record<string, string> } };
      const char = charOf(u.poker?.char);
      return { uid: String(u._id), nick: u.nick, char, look: lookOf(char, skinsOf(u.poker).wear), value: u.estate?.value ?? 0, top: label(bestOf(u.estate?.units ?? [])) };
    });
  }

  async function viewOf(uid: string): Promise<EstateView> {
    const [doc, docs, pl, residents] = await Promise.all([
      users.findOne({ _id: uid }, { projection: { "estate.units": 1, "estate.attend": 1 } }) as Promise<EstateFields | null>,
      lotDocs(),
      plate(),
      users.countDocuments({ "estate.value": { $gt: 0 } } as never),
    ]);
    const units = doc?.estate?.units ?? [];
    return {
      units: units.map(wire),
      lots: lotsWire(docs),
      plate: pl,
      residents,
      daily: { amount: dailyOfUnits(units), claimed: doc?.estate?.attend === kstDay(now()) },
    };
  }

  gateway.rpc("stock.estate", (ctx) => viewOf(member(ctx).uid));

  gateway.rpc("stock.estate.buy", (ctx, raw) => {
    const { uid, nick } = member(ctx);
    const o = z.object({ type: z.enum(HOME_TYPES.map((u) => u.id) as [string, ...string[]]), lot: z.string().max(20).optional() }).parse(raw);
    const ht = homeType(o.type)!;
    return withLock(uid, async () => {
      noBuyWhileSeated(poker, uid);
      await materialize(db, uid);
      const units = await unitsOf(uid);
      if (units.length >= MAX_UNITS) throw new AppError("TOO_MANY", `집은 ${MAX_UNITS}채까지 가질 수 있어요.`, 409);
      let unit: UnitDoc;
      if (ht.kind === "house") {
        // 단독형: 빈 자리 하나 (고른 자리가 있으면 그 자리)
        const docs = await lotDocs();
        const free = docs.filter((d) => ht.lots!.includes(d._id) && !d.owner);
        const pick = o.lot ? free.find((d) => d._id === o.lot) : free[0];
        if (!pick) throw new AppError("SOLD_OUT", o.lot ? "방금 다른 분이 샀어요." : "남은 자리가 없어요.", 409);
        unit = { id: newId(10), type: ht.id, no: 0, lot: pick._id, at: now() };
        const face = await faceOf(db, uid);
        // 자리 먼저 잡고(선착순) → 돈. 돈이 모자라면 자리를 되돌림
        const l = await lots.updateOne({ _id: pick._id, owner: null } as never, { $set: { owner: { uid, nick, char: face.char, look: face.look }, unit: unit.id, at: now() } }, { upsert: true }).catch(() => null);
        if (!l || (!l.modifiedCount && !l.upsertedCount)) throw new AppError("SOLD_OUT", "방금 다른 분이 샀어요.", 409);
        const r = await users.updateOne(
          { _id: uid, money: { $gte: ht.price } },
          { $inc: { money: -ht.price, "estate.value": resaleOf(ht.price), "stats.stock.estate.bought": ht.price }, $push: { "estate.units": unit } } as never
        );
        if (!r.modifiedCount) {
          await lots.updateOne({ _id: pick._id, unit: unit.id } as never, { $set: { owner: null, unit: null, at: null } });
          throw new AppError("NOT_ENOUGH", "현금이 모자라요.", 409);
        }
      } else {
        // 아파트형: 그 평형의 층 · 01~12호
        const floor = ht.floors![0] + Math.floor(Math.random() * (ht.floors![1] - ht.floors![0] + 1));
        unit = { id: newId(10), type: ht.id, no: floor * 100 + 1 + Math.floor(Math.random() * 12), at: now() };
        const r = await users.updateOne(
          { _id: uid, money: { $gte: ht.price } },
          { $inc: { money: -ht.price, "estate.value": resaleOf(ht.price), "stats.stock.estate.bought": ht.price }, $push: { "estate.units": unit } } as never
        );
        if (!r.modifiedCount) throw new AppError("NOT_ENOUGH", "현금이 모자라요.", 409);
      }
      await poker.wallet.refresh(uid).catch(() => {});
      return viewOf(uid);
    });
  });

  gateway.rpc("stock.estate.sell", (ctx, raw) => {
    const { uid } = member(ctx);
    const { id } = z.object({ id: z.string().max(20) }).parse(raw);
    return withLock(uid, async () => {
      const unit = (await unitsOf(uid)).find((u) => u.id === id);
      if (!unit) throw new AppError("NOT_FOUND", "없는 집이에요.", 404);
      const ht = homeType(unit.type);
      if (!ht) throw new AppError("NOT_FOUND", "없는 집이에요.", 404);
      const back = resaleOf(ht.price);
      const r = await users.updateOne({ _id: uid, "estate.units.id": id } as never, { $pull: { "estate.units": { id } }, $inc: { money: back, "estate.value": -back } } as never);
      if (!r.modifiedCount) throw new AppError("NOT_FOUND", "없는 집이에요.", 404);
      if (unit.lot) await lots.updateOne({ _id: unit.lot, unit: id } as never, { $set: { owner: null, unit: null, at: null } });
      // 소수점 · 옛 값 때문에 음수가 되지 않게
      await users.updateOne({ _id: uid, "estate.value": { $lt: 0 } } as never, { $set: { "estate.value": 0 } });
      await poker.wallet.refresh(uid).catch(() => {});
      return viewOf(uid);
    });
  });

  /** 출석 보너스 (하루 한 번 · 집이 있을 때). 받을 게 없으면 null */
  async function attend(uid: string): Promise<AttendResult | null> {
    return withLock(uid, async () => {
      const d = (await users.findOne({ _id: uid }, { projection: { "estate.units": 1, "estate.attend": 1 } })) as EstateFields | null;
      const units = d?.estate?.units ?? [];
      const day = kstDay(now());
      if (!units.length || d?.estate?.attend === day) return null;
      const amount = dailyOfUnits(units);
      if (amount <= 0) return null;
      await materialize(db, uid);
      const r = await users.updateOne({ _id: uid, "estate.attend": { $ne: day } } as never, { $set: { "estate.attend": day }, $inc: { money: amount, "stats.stock.estate.daily": amount } });
      if (!r.modifiedCount) return null;
      await poker.wallet.refresh(uid).catch(() => {});
      return { amount, homes: units.length };
    });
  }
  gateway.rpc("stock.estate.attend", (ctx) => attend(member(ctx).uid));

  /** 집 안 (uid 없으면 내 집). 남의 집이면 방문 수 +1 */
  gateway.rpc("stock.home", async (ctx, raw) => {
    const me = member(ctx);
    const { uid } = z.object({ uid: z.string().max(64).optional() }).parse(raw ?? {});
    const target = uid ?? me.uid;
    const d = (await users.findOne({ _id: target }, { projection: { nick: 1, "estate.units": 1, "estate.value": 1, "estate.visits": 1, "poker.char": 1, "poker.skins": 1, "poker.wear": 1 } })) as
      | (UserDoc & EstateFields & { poker?: { char?: string; skins?: string[]; wear?: Record<string, string> } })
      | null;
    if (!d) throw new AppError("NOT_FOUND", "없는 분이에요.", 404);
    const units = d.estate?.units ?? [];
    if (!units.length) throw new AppError("NO_HOME", uid ? "아직 집이 없는 분이에요." : "아직 집이 없어요. 부동산에서 집을 사 보세요.", 404);
    const mine = target === me.uid;
    let visits = d.estate?.visits ?? 0;
    if (!mine) {
      await users.updateOne({ _id: target }, { $inc: { "estate.visits": 1 } });
      visits++;
    }
    const char = charOf(d.poker?.char);
    const out: HomeView = {
      owner: { uid: target, nick: d.nick, char, look: lookOf(char, skinsOf(d.poker).wear) },
      mine,
      homes: [...units].sort((a, b) => homeRank(b.type) - homeRank(a.type)).map(wire),
      best: bestOf(units) ? wire(bestOf(units)!) : null,
      value: d.estate?.value ?? valueOf(units),
      daily: dailyOfUnits(units),
      visits,
      furniture: [],
    };
    return out;
  });

  return {
    async hub(uid: string | null): Promise<{ residents: number; homes: number; dailyLeft: boolean }> {
      const residents = await users.countDocuments({ "estate.value": { $gt: 0 } } as never);
      if (!uid) return { residents, homes: 0, dailyLeft: false };
      const d = (await users.findOne({ _id: uid }, { projection: { "estate.units": 1, "estate.attend": 1 } })) as EstateFields | null;
      const n = d?.estate?.units?.length ?? 0;
      return { residents, homes: n, dailyLeft: n > 0 && d?.estate?.attend !== kstDay(now()) };
    },
    attend,
    lotDocs,
  };
}
