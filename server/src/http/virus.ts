import { Router, type Request } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad, unauthenticated } from "../errors";
import { KeyedMutex } from "../mutex";
import type { UserDoc } from "../users";
import { h, userOf } from "./util";
import { kstDayKey, weekOf } from "../../../web/src/lib/defense/progress";
import { VGP_SELL, VGP_STORE, VPACK, WARP_MAX_H, type VGoods, type VShopState } from "../../../web/src/lib/virus/gpShop";

/*
 * VIRUS IDLE — 진행은 브라우저 저장본에만 있어서 게임이 기록을 보고하고, GP 상점은 서버가 「받을 물건」으로 넘겨줌
 *   POST /api/virus/stats   { best, clears, files, bosses, formats }  기록 보고 (업적 · 일일 미션 — achievements.ts)
 *     best · clears: 지금까지 넘은 최고 스테이지 · KILLSWITCH 격퇴 수 (최고값만 남김)
 *     files · bosses · formats: 지난 보고 뒤로 늘어난 만큼 (더함 — 한 번에 너무 크면 자름)
 *   GET  /api/virus/shop    GP 상점 상태 (받을 물건 · 이번 주 · 오늘 산 횟수 · 한 번짜리 · 최고 스테이지)
 *   POST /api/virus/store   { id }  재화샵 (GP → 커널 코어 · 시간 가속, 횟수 제한 없음)
 *   POST /api/virus/pack    { id }  패키지 (GP 로만 — 매일 · 매주 · 한 번 · 스테이지 조건)
 *   POST /api/virus/sell    { id, have }  커널 코어 → GP (주 한도 — 게임이 가진 코어 수를 알려 주고, 성공하면 게임에서 뺌)
 *   POST /api/virus/claim   받을 물건을 넘겨주고 비움 (게임이 저장본에 넣음)
 * 상품 정의는 web/src/lib/virus/gpShop.ts. 브라우저가 보낸 기록 · 코어 수를 그대로 믿음 (서버가 다시 계산할 기록이 없음)
 */
/** 최고값만 남기는 기록 (업적 — lib/points.ts 의 virus.* · 게임은 lib/virus/logic.ts virusMetric) */
const MAX_KEYS = [
  "pure",
  "bypass",
  "mods",
  "modMax",
  "blitz",
  "root",
  "lifetime",
  "ups",
  "evo",
  "clutch",
  "fails",
  "jackpots",
  "offMax",
  "play",
] as const;
const big = z.number().min(0).max(1e300);
const stats = z.object({
  best: z.number().int().min(0).max(1001),
  clears: z.number().int().min(0).max(100_000),
  files: z.number().int().min(0).max(10_000_000),
  bosses: z.number().int().min(0).max(1_000_000),
  formats: z.number().int().min(0).max(10_000),
  // v1.4 까지 게임은 위 다섯만 보냄 — 없으면 0
  ...Object.fromEntries(MAX_KEYS.map((k) => [k, big.optional()])),
}) as z.ZodType<
  { best: number; clears: number; files: number; bosses: number; formats: number } & Partial<
    Record<(typeof MAX_KEYS)[number], number>
  >
>;
const idBody = z.object({ id: z.string().max(40) });

/** 회원 문서 virusShop */
interface ShopDoc {
  /** 이번 주 (weekOf) · 오늘 (kstDayKey) — 바뀌면 횟수를 새로 */
  w?: number;
  d?: string;
  week?: Record<string, number>;
  day?: Record<string, number>;
  once?: string[];
  pending?: { cores?: number; warpH?: number };
}
type Doc = UserDoc & { virusShop?: ShopDoc; inv?: Record<string, string[]>; stats?: UserDoc["stats"] };

export function virusRouter({ db, auth, points }: Deps): Router {
  const r = Router();
  const users = () => db.col<Doc>("users");
  const lock = new KeyedMutex();

  const member = async (req: Request) => {
    const user = await userOf(auth, req);
    if (!user || user.anonymous) throw unauthenticated();
    if (!(await points.get(user.uid))) throw new AppError("NOT_MEMBER", "회원만 쓸 수 있어요.", 403);
    return user;
  };
  const need = (ok: boolean, msg: string) => {
    if (!ok) throw new AppError("NEED", msg, 409);
  };

  /** 이번 주 · 오늘로 맞춘 상점 상태 (저장은 안 함) */
  const read = async (uid: string) => {
    const d = (await users().findOne(
      { _id: uid },
      { projection: { virusShop: 1, "stats.virus.best": 1, "inv.virus": 1 } }
    )) as Doc | null;
    const t = Date.now();
    const s = d?.virusShop ?? {};
    const w = weekOf(t);
    const day = kstDayKey(t);
    const shop: Required<ShopDoc> = {
      w,
      d: day,
      week: s.w === w ? (s.week ?? {}) : {},
      day: s.d === day ? (s.day ?? {}) : {},
      once: s.once ?? [],
      pending: { cores: s.pending?.cores ?? 0, warpH: s.pending?.warpH ?? 0 },
    };
    return { shop, best: d?.stats?.virus?.best ?? 0, owned: d?.inv?.virus ?? [] };
  };
  const view = (x: Awaited<ReturnType<typeof read>>): VShopState => ({
    pending: { cores: x.shop.pending.cores ?? 0, warpH: x.shop.pending.warpH ?? 0 },
    week: x.shop.week,
    day: x.shop.day,
    once: x.shop.once,
    best: x.best,
  });
  /** 산 것 넣기: 코어 · 시간 가속은 받을 물건으로, 편의성은 계정 보유 목록으로 */
  const grant = (shop: Required<ShopDoc>, g: VGoods) => {
    shop.pending.cores = (shop.pending.cores ?? 0) + (g.cores ?? 0);
    shop.pending.warpH = (shop.pending.warpH ?? 0) + (g.warpH ?? 0);
  };
  const save = async (uid: string, shop: Required<ShopDoc>, utils: string[] = []) => {
    await users().updateOne(
      { _id: uid },
      { $set: { virusShop: shop }, ...(utils.length && { $addToSet: { "inv.virus": { $each: utils } } }) }
    );
  };

  r.post(
    "/stats",
    h(async (req) => {
      const user = await userOf(auth, req);
      if (!user || user.anonymous) throw unauthenticated();
      const b = stats.parse(req.body);
      await users().updateOne(
        { _id: user.uid },
        {
          $max: {
            "stats.virus.best": b.best,
            "stats.virus.clears": b.clears,
            ...Object.fromEntries(MAX_KEYS.map((k) => [`stats.virus.${k}`, b[k] ?? 0])),
          },
          $inc: { "stats.virus.files": b.files, "stats.virus.bosses": b.bosses, "stats.virus.formats": b.formats },
        }
      );
      return { ok: true };
    })
  );

  r.get(
    "/shop",
    h(async (req) => {
      const user = await member(req);
      return view(await read(user.uid));
    })
  );

  r.post(
    "/store",
    h(async (req) => {
      const user = await member(req);
      const { id } = idBody.parse(req.body);
      const it = VGP_STORE.find((x) => x.id === id);
      if (!it) throw bad("없는 상품이에요.");
      return lock.run(user.uid, async () => {
        const x = await read(user.uid);
        const bal = await points.spend(user.uid, it.gp, "virus", `store:${id}`);
        grant(x.shop, it.give);
        await save(user.uid, x.shop);
        return { ...view(x), points: bal };
      });
    })
  );

  r.post(
    "/pack",
    h(async (req) => {
      const user = await member(req);
      const { id } = idBody.parse(req.body);
      const pk = VPACK[id];
      if (!pk) throw bad("없는 패키지예요.");
      return lock.run(user.uid, async () => {
        const x = await read(user.uid);
        if (pk.once) need(!x.shop.once.includes(id), "이미 산 패키지예요.");
        else if (pk.perDay) need((x.shop.day[id] ?? 0) < pk.perDay, "오늘은 이미 샀어요.");
        else need((x.shop.week[id] ?? 0) < (pk.perWeek ?? 1), "이번 주에 이미 샀어요.");
        if (pk.needBest) need(x.best >= pk.needBest, `스테이지 ${pk.needBest}을 넘기면 살 수 있어요.`);
        const utils = pk.give.utils ?? [];
        need(!utils.some((k) => x.owned.includes(k)), "이미 가진 편의성이 들어 있어요.");
        const items = pk.give.items ?? [];
        need(!items.some((k) => x.owned.includes(k)), "이미 가진 꾸미기가 들어 있어요.");
        const bal = await points.spend(user.uid, pk.gp, "virus", `pack:${id}`);
        if (pk.once) x.shop.once.push(id);
        else if (pk.perDay) x.shop.day[id] = (x.shop.day[id] ?? 0) + 1;
        else x.shop.week[id] = (x.shop.week[id] ?? 0) + 1;
        grant(x.shop, pk.give);
        // 편의성 · 꾸미기는 계정 보유 목록(inv.virus)에 바로
        await save(user.uid, x.shop, [...utils, ...items]);
        return { ...view(x), points: bal, utils, items };
      });
    })
  );

  r.post(
    "/sell",
    h(async (req) => {
      const user = await member(req);
      const { id, have } = idBody.extend({ have: z.number().int().min(0).max(1_000_000) }).parse(req.body);
      const it = VGP_SELL.find((x) => x.id === id);
      if (!it) throw bad("없는 교환이에요.");
      return lock.run(user.uid, async () => {
        const x = await read(user.uid);
        need((x.shop.week[id] ?? 0) < it.perWeek, "이번 주 교환을 다 했어요.");
        need(have >= it.cores, "커널 코어가 모자라요.");
        // 횟수를 먼저 저장한 뒤 지급 — 저장 실패로 두 번 받는 일이 없게
        x.shop.week[id] = (x.shop.week[id] ?? 0) + 1;
        await save(user.uid, x.shop);
        const bal = await points.grant(user.uid, it.gp, "virus", `sell:${id}`);
        return { ...view(x), points: bal, paid: it.cores };
      });
    })
  );

  r.post(
    "/claim",
    h(async (req) => {
      const user = await member(req);
      return lock.run(user.uid, async () => {
        const x = await read(user.uid);
        const cores = x.shop.pending.cores ?? 0;
        // 시간 가속은 한 번에 WARP_MAX_H 까지 (나머지는 다음에)
        const warpH = Math.min(WARP_MAX_H, x.shop.pending.warpH ?? 0);
        x.shop.pending = { cores: 0, warpH: (x.shop.pending.warpH ?? 0) - warpH };
        if (cores || warpH) await save(user.uid, x.shop);
        return { got: { cores, warpH }, ...view(x) };
      });
    })
  );

  return r;
}
