import { z } from "zod";
import type { Deps } from "../../deps";
import type { UserDoc } from "../../users";
import { pictureOf } from "../../users";
import type { Preset } from "../../../../web/src/lib/stock/solo";
import type { HubStatus, SoloStats, StockMe, StockRankRow } from "../../../../web/src/lib/stock/types";
import { createBattle, type BattleOptions } from "./battle";
import { createStkWallet, dropLegacyStock, member, monthStart, weekStart, type StkFields } from "./common";
import { createSolo } from "./solo";
import { createCoin } from "./coin";
import { createExchange, type PokerLink } from "./exchange";

/*
 * 주식게임 — 솔로(차트 50턴) · 코인(레버리지) · 대전(2~8명 7분) · 순위.
 * 돈은 이 게임 전용 지갑(users.stk). 처음 1억, 판 끝 총자산 500만 밑이면 1천만으로 회생.
 * 포커 칩과는 환전소로만 오감 (1:1).
 *
 * 요청
 *   stock.me      내 지갑(현금 · 들고 있는 주식 · 총자산) + 솔로 · 코인 · 대전 기록
 *   stock.hub     모드마다 상태 한 줄
 *   stock.rank    총자산 순위 · 주간 · 월간 손익 순위
 *   stock.exchange · stock.exchange.view   환전소 — 주식게임 돈 ↔ 포커 칩 1:1 (exchange.ts)
 *   stock.solo.*  (solo.ts)   stock.coin.*  (coin.ts)   stock.room.* · stock.battle.*  (battle.ts)
 */

export interface StockOptions extends BattleOptions {}

type MeDoc = UserDoc &
  StkFields & {
    stats?: {
      stk?: {
        solo?: { games?: number; wins?: number; sumRet?: number; best?: number; worst?: number; p?: Partial<Record<Preset, { games?: number; wins?: number }>> };
        coin?: { games?: number; wins?: number; sumRet?: number; best?: number; worst?: number; liq?: number };
        battle?: { games?: number; wins?: number; rankSum?: number; best?: number; top3?: number };
      };
    };
  };

export function registerStock({ db, gateway }: Deps, opts: StockOptions = {}, poker?: PokerLink) {
  const now = opts.now ?? Date.now;
  const users = db.col<UserDoc>("users");
  void dropLegacyStock(db);
  const wallet = createStkWallet(db);
  const solo = createSolo(db, gateway, wallet, now);
  const coin = createCoin(db, gateway, wallet, now);
  const battle = createBattle(db, gateway, opts);
  createExchange(db, gateway, wallet, poker, now);

  const soloStats = (d: MeDoc | null): SoloStats => {
    const s = d?.stats?.stk?.solo ?? {};
    const byPreset: SoloStats["byPreset"] = {};
    for (const [k, v] of Object.entries(s.p ?? {})) byPreset[k as Preset] = { games: v?.games ?? 0, wins: v?.wins ?? 0 };
    return { games: s.games ?? 0, wins: s.wins ?? 0, sumRet: s.sumRet ?? 0, best: s.best ?? null, worst: s.worst ?? null, byPreset };
  };

  gateway.rpc("stock.me", async (ctx): Promise<StockMe> => {
    const { uid, nick } = member(ctx);
    const w = await wallet.get(uid);
    const d = (await users.findOne({ _id: uid }, { projection: { stats: 1 } })) as MeDoc | null;
    const held = w.held + w.coinHeld;
    const b = d?.stats?.stk?.battle ?? {};
    const c = d?.stats?.stk?.coin ?? {};
    return {
      nick,
      money: w.cash,
      held,
      total: w.cash + held,
      revives: w.revives,
      solo: soloStats(d),
      coin: { games: c.games ?? 0, wins: c.wins ?? 0, sumRet: c.sumRet ?? 0, best: c.best ?? null, worst: c.worst ?? null, liq: c.liq ?? 0 },
      battle: { games: b.games ?? 0, wins: b.wins ?? 0, rankSum: b.rankSum ?? 0, best: b.best ?? null, top3: b.top3 ?? 0 },
    };
  });

  gateway.rpc("stock.hub", async (ctx): Promise<HubStatus> => {
    const uid = ctx.nick && !ctx.user?.anonymous ? ctx.uid : null;
    const [s, c] = await Promise.all([uid ? solo.hub(uid) : Promise.resolve({ turn: null, last: null }), uid ? coin.hub(uid) : Promise.resolve({ turn: null, last: null })]);
    const b = battle.hub();
    return { soloTurn: s.turn, soloLast: s.last, coinTurn: c.turn, coinLast: c.last, rooms: b.rooms, playing: b.playing };
  });

  const TOTAL = { $add: [{ $ifNull: ["$stk.cash", 0] }, { $ifNull: ["$stk.held", 0] }, { $ifNull: ["$stk.coinHeld", 0] }] };
  const PROJ = { nick: 1, "avatar.at": 1, photo: 1, "stats.stk": 1 } as const;
  const face = (d: MeDoc & { _id?: string; avatar?: { at?: number }; photo?: string | null }) => ({ uid: String(d._id ?? ""), nick: d.nick, avatar: pictureOf(String(d._id ?? ""), d) });

  gateway.rpc("stock.rank", async (_ctx, raw): Promise<StockRankRow[]> => {
    const { kind } = z.object({ kind: z.enum(["assets", "week", "month"]).default("assets") }).parse(raw ?? {});
    if (kind === "week" || kind === "month") {
      const from = kind === "week" ? weekStart(now()) : monthStart(now());
      const [sRows, cRows] = await Promise.all([solo.week(from, 200), coin.since(from)]);
      const merged = new Map<string, { _id: string; pnl: number; games: number }>();
      for (const r of [...sRows, ...cRows]) {
        const m = merged.get(r._id) ?? { _id: r._id, pnl: 0, games: 0 };
        m.pnl += r.pnl;
        m.games += r.games;
        merged.set(r._id, m);
      }
      const rows = [...merged.values()].sort((a, b) => b.pnl - a.pnl).slice(0, 50);
      const docs = await users.find({ _id: { $in: rows.map((r) => r._id) } }, { projection: PROJ }).toArray();
      const by = new Map(docs.map((d) => [String(d._id), d as unknown as MeDoc]));
      return rows
        .filter((r) => by.get(r._id)?.nick)
        .map((r) => ({ ...face({ ...by.get(r._id)!, _id: r._id } as never), value: r.pnl, games: r.games, sub: r.games }));
    }
    // 총자산: 주식게임을 한 번이라도 한 회원 (솔로 · 코인 · 대전)
    const docs = await users
      .aggregate([
        { $match: { $or: [{ "stats.stk.solo.games": { $gte: 1 } }, { "stats.stk.coin.games": { $gte: 1 } }, { "stats.stk.battle.games": { $gte: 1 } }] } },
        { $project: { ...PROJ, "stk.cash": 1, "stk.held": 1, "stk.coinHeld": 1 } },
        { $addFields: { total: TOTAL } },
        { $sort: { total: -1 } },
        { $limit: 50 },
      ])
      .toArray();
    return docs.map((x) => {
      const d = x as unknown as MeDoc & { total: number };
      const s = d.stats?.stk?.solo;
      return {
        ...face(d as never),
        value: d.total,
        games: (s?.games ?? 0) + (d.stats?.stk?.coin?.games ?? 0) + (d.stats?.stk?.battle?.games ?? 0),
        sub: s?.games ? (s.wins ?? 0) / s.games : 0,
      };
    });
  });

  return {
    live: battle.live,
    close: battle.close,
    adminList: battle.adminList,
    adminClose: battle.adminClose,
    _battle: battle,
    _solo: solo,
    _coin: coin,
    _wallet: wallet,
  };
}
