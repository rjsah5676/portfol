import { z } from "zod";
import type { Deps } from "../../deps";
import type { UserDoc } from "../../users";
import { pictureOf } from "../../users";
import { START_MONEY, charOf, lookOf } from "../../../../web/src/lib/poker/rules";
import type { Preset } from "../../../../web/src/lib/stock/solo";
import type { HubStatus, SoloStats, StockMe, StockRankRow } from "../../../../web/src/lib/stock/types";
import { skinsOf } from "../poker/wallet";
import { createBattle, type BattleOptions } from "./battle";
import { member, monthStart, weekStart, type PokerLink } from "./common";
import { createEstate } from "./estate";
import { createSolo } from "./solo";
import { createCoin } from "./coin";

/*
 * 주식 마을 (STOCK VILLAGE) — 솔로(증권거래소) · 대전(트레이딩 홀) · 부동산 · 순위.
 * 돈은 애니메 포커와 같은 users.money (지갑 · 회생 규칙도 포커 것을 그대로 씀).
 *
 * 요청
 *   stock.me      내 지갑(현금 · 금고 · 주식 · 집 · 총자산) + 솔로 · 대전 기록
 *   stock.hub     마을 건물마다 상태 한 줄
 *   stock.rank    총자산 순위 · 주간 손익 순위
 *   stock.solo.*  (solo.ts)   stock.estate*  (estate.ts)   stock.room.* · stock.battle.*  (battle.ts)
 */

export interface StockOptions extends BattleOptions {}

type MeDoc = UserDoc & {
  money?: number;
  revive?: { day: string; n: number };
  poker?: { char?: string; skins?: string[]; wear?: Record<string, string>; vault?: number };
  stock?: { held?: number; coinHeld?: number };
  estate?: { value?: number; escrow?: number };
  stats?: {
    stock?: {
      solo?: { games?: number; wins?: number; sumRet?: number; best?: number; worst?: number; p?: Partial<Record<Preset, { games?: number; wins?: number }>> };
      coin?: { games?: number; wins?: number; sumRet?: number; best?: number; worst?: number; liq?: number };
      battle?: { games?: number; wins?: number; rankSum?: number; best?: number; top3?: number };
    };
  };
};

export function registerStock({ db, gateway }: Deps, poker: PokerLink, opts: StockOptions = {}) {
  const now = opts.now ?? Date.now;
  const users = db.col<UserDoc>("users");
  const solo = createSolo(db, gateway, poker, now);
  const estate = createEstate(db, gateway, poker, now);
  const coin = createCoin(db, gateway, poker, now);
  const battle = createBattle(db, gateway, opts);

  const soloStats = (d: MeDoc | null): SoloStats => {
    const s = d?.stats?.stock?.solo ?? {};
    const byPreset: SoloStats["byPreset"] = {};
    for (const [k, v] of Object.entries(s.p ?? {})) byPreset[k as Preset] = { games: v?.games ?? 0, wins: v?.wins ?? 0 };
    return { games: s.games ?? 0, wins: s.wins ?? 0, sumRet: s.sumRet ?? 0, best: s.best ?? null, worst: s.worst ?? null, byPreset };
  };

  gateway.rpc("stock.me", async (ctx): Promise<StockMe> => {
    const { uid, nick } = member(ctx);
    await poker.wallet.get(uid); // 시작 자금이 없는 옛 회원이면 채움
    const d = (await users.findOne({ _id: uid })) as MeDoc | null;
    const char = charOf(d?.poker?.char);
    const w = await poker.wallet.get(uid);
    const money = d?.money ?? START_MONEY;
    const vault = Math.max(0, d?.poker?.vault ?? 0);
    const held = Math.max(0, d?.stock?.held ?? 0) + Math.max(0, d?.stock?.coinHeld ?? 0);
    const est = Math.max(0, d?.estate?.value ?? 0) + Math.max(0, d?.estate?.escrow ?? 0);
    const b = d?.stats?.stock?.battle ?? {};
    return {
      nick,
      char: w?.char ?? char,
      look: lookOf(w?.char ?? char, skinsOf(d?.poker).wear),
      money,
      vault,
      held,
      estate: est,
      total: money + vault + held + est,
      reviveUsed: w?.reviveUsed ?? 0,
      seated: poker.seated(uid),
      solo: soloStats(d),
      coin: { games: d?.stats?.stock?.coin?.games ?? 0, wins: d?.stats?.stock?.coin?.wins ?? 0, sumRet: d?.stats?.stock?.coin?.sumRet ?? 0, best: d?.stats?.stock?.coin?.best ?? null, worst: d?.stats?.stock?.coin?.worst ?? null, liq: d?.stats?.stock?.coin?.liq ?? 0 },
      battle: { games: b.games ?? 0, wins: b.wins ?? 0, rankSum: b.rankSum ?? 0, best: b.best ?? null, top3: b.top3 ?? 0 },
    };
  });

  gateway.rpc("stock.hub", async (ctx): Promise<HubStatus> => {
    const uid = ctx.nick && !ctx.user?.anonymous ? ctx.uid : null;
    const [s, e, c] = await Promise.all([uid ? solo.hub(uid) : Promise.resolve({ turn: null, last: null }), estate.hub(uid), uid ? coin.hub(uid) : Promise.resolve({ turn: null, last: null })]);
    const b = battle.hub();
    return { soloTurn: s.turn, soloLast: s.last, coinTurn: c.turn, coinLast: c.last, rooms: b.rooms, playing: b.playing, residents: e.residents, homes: e.homes, dailyLeft: e.dailyLeft };
  });

  const TOTAL = {
    $add: [{ $ifNull: ["$money", START_MONEY] }, { $ifNull: ["$poker.vault", 0] }, { $ifNull: ["$stock.held", 0] }, { $ifNull: ["$stock.coinHeld", 0] }, { $ifNull: ["$estate.value", 0] }, { $ifNull: ["$estate.escrow", 0] }],
  };
  const PROJ = { nick: 1, "poker.char": 1, "poker.skins": 1, "poker.wear": 1, "avatar.at": 1, photo: 1, "stats.stock": 1 } as const;
  const face = (d: MeDoc & { _id?: string; avatar?: { at?: number }; photo?: string | null }) => {
    const char = charOf(d.poker?.char);
    return { uid: String(d._id ?? ""), nick: d.nick, char, look: lookOf(char, skinsOf(d.poker).wear), avatar: pictureOf(String(d._id ?? ""), d) };
  };

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
    // 총자산: 주식 마을을 한 번이라도 한 회원 (솔로 · 대전 · 집)
    const docs = await users
      .aggregate([
        { $match: { $or: [{ "stats.stock.solo.games": { $gte: 1 } }, { "stats.stock.battle.games": { $gte: 1 } }, { "estate.value": { $gt: 0 } }] } },
        { $project: { ...PROJ, money: 1, "poker.vault": 1, "stock.held": 1, "stock.coinHeld": 1, "estate.value": 1, "estate.escrow": 1 } },
        { $addFields: { total: TOTAL } },
        { $sort: { total: -1 } },
        { $limit: 50 },
      ])
      .toArray();
    return docs.map((x) => {
      const d = x as unknown as MeDoc & { total: number };
      const s = d.stats?.stock?.solo;
      return { ...face(d as never), value: d.total, games: (s?.games ?? 0) + (d.stats?.stock?.battle?.games ?? 0), sub: s?.games ? (s.wins ?? 0) / s.games : 0 };
    });
  });

  return {
    live: battle.live,
    close: battle.close,
    adminList: battle.adminList,
    adminClose: battle.adminClose,
    _battle: battle,
    _solo: solo,
    _estate: estate,
    _coin: coin,
  };
}
