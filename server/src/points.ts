import type { Database } from "./db";
import { AppError } from "./errors";
import { newId } from "./ids";
import { KeyedMutex } from "./mutex";
import { metricsOf } from "./achievements";
import { pictureOf, type UserDoc } from "./users";
import { skinOf as fightSkinOf } from "../../web/src/lib/fight/skins";
import { START_MONEY, kstDay, skinOf } from "../../web/src/lib/poker/rules";
import {
  ACHIEVEMENTS,
  ATTEND_POINTS,
  DAILY_METRICS,
  DAILY_MISSIONS,
  POINT,
  POKER_EXCHANGE,
  achievementOf,
  achievementsOf,
  fmtPoint,
  shopItem,
  type AchGame,
  claimableTimes,
  dailyMission,
  dailyOf,
  repKey,
  type DailyState,
  type AchRankRow,
  type AchState,
  type PointLogRow,
  type ShopItem,
} from "../../web/src/lib/points";

/*
 * 포인트 (사이트 공용 재화). 숫자 · 상품 · 업적 정의는 web/src/lib/points.ts.
 *
 * 회원 문서(users)에
 *   points       잔액
 *   pointsDay    마지막으로 출석 포인트를 받은 날 (한국 시간)
 *   achs         받은 업적 [{ id, at }]
 *   achRep       반복형 업적을 받은 횟수 { <id 의 . 을 __ 로>: n } (반복형은 10.14 일일 미션으로 바뀌어 지금은 안 씀)
 *   daily        일일 미션 { day: 한국 날짜, base: 그날 처음 본 업적 숫자, got: 받은 미션 id }
 *   inv.<게임>   포인트로 산 물건 (포커는 기존 poker.chars · poker.skins 를 그대로 씀)
 *   poker.exch   포인트 → 칩으로 바꿔 받은 칩 − 칩 → 포인트로 내준 칩 (포커 칩 업적에서 빼는 몫)
 * 잔액이 바뀌는 건 전부 조건부 updateOne 하나로 (두 번 눌러도 한 번만, 모자라면 안 바뀜) + 원장 point_log 에 한 줄.
 */

type PointFields = Pick<UserDoc, "nick" | "money"> & {
  points?: number;
  pointsDay?: string;
  achs?: { id: string; at: number }[];
  achRep?: Record<string, number>;
  poker?: { chars?: string[]; skins?: string[]; exch?: number };
  inv?: Record<string, string[]>;
  daily?: { day: string; base: Record<string, number>; got: string[] };
};

export interface PointsInfo {
  points: number;
  /** 오늘 출석 포인트를 받았는지 */
  attendedToday: boolean;
}

/** 일일 미션 기준값 키: 지표 이름의 "." → "__" */
const baseKey = (metric: string) => metric.replaceAll(".", "__");
const baseOf = (base: Record<string, number>, metric: string) => base[baseKey(metric)] ?? base[metric] ?? 0;

/** 원장 보관 기간 */
const LOG_TTL_DAYS = 365;

/** 상품을 샀을 때 남는 곳: 이미 가졌는지 보는 조건 + 넣는 갱신 */
export function grantOf(item: ShopItem): { owned: Record<string, unknown>; update: Record<string, unknown> } {
  if (item.game === "poker" && item.kind === "char")
    return { owned: { "poker.chars": item.ref }, update: { $push: { "poker.chars": item.ref }, $set: { "poker.char": item.ref } } };
  if (item.game === "poker" && item.kind === "skin") {
    const char = skinOf(item.ref)?.char ?? item.ref.split("-")[0];
    return { owned: { "poker.skins": item.ref }, update: { $push: { "poker.skins": item.ref }, $set: { [`poker.wear.${char}`]: item.ref } } };
  }
  // 격투 스킨: 사자마자 그 캐릭터에 착용 (보관함에서 바꿀 수 있음)
  const fs = item.game === "fight" && item.kind === "skin" ? fightSkinOf(item.ref) : null;
  if (fs) return { owned: { "inv.fight": item.ref }, update: { $push: { "inv.fight": item.ref }, $set: { [`fightWear.${fs.ch}`]: item.ref } } };
  return { owned: { [`inv.${item.game}`]: item.ref }, update: { $push: { [`inv.${item.game}`]: item.ref } } };
}

/** 반복형 업적을 받은 횟수 */
const repTimes = (d: PointFields | null | undefined, id: string) => d?.achRep?.[repKey(id).slice("achRep.".length)] ?? 0;

export type Points = ReturnType<typeof createPoints>;

export function createPoints(db: Database, now: () => number = Date.now) {
  const col = db.col<UserDoc>("users");
  const logs = db.col<PointLogRow & { _id: string; uid: string; atDate: Date }>("point_log");
  void logs.createIndex({ uid: 1, at: -1 }).catch(() => {});
  void logs.createIndex({ atDate: 1 }, { expireAfterSeconds: LOG_TTL_DAYS * 24 * 3600 }).catch(() => {});
  const listeners: ((uid: string, points: number) => void)[] = [];
  const rankCache = new Map<AchGame, { at: number; rows: AchRankRow[] }>();

  const read = async (uid: string) =>
    (await col.findOne({ _id: uid }, { projection: { nick: 1, money: 1, points: 1, pointsDay: 1, achs: 1, achRep: 1, daily: 1, "poker.chars": 1, "poker.skins": 1, "poker.exch": 1, inv: 1 } })) as PointFields | null;

  /** 잔액이 바뀐 뒤: 원장 한 줄 + 알림 */
  async function after(uid: string, delta: number, reason: string, ref?: string) {
    const d = await read(uid);
    const bal = d?.points ?? 0;
    const t = now();
    await logs
      .insertOne({ _id: newId(), uid, at: t, atDate: new Date(t), delta, reason, ...(ref && { ref }), bal })
      .catch((e) => console.warn("[points] 원장 저장 실패", e));
    listeners.forEach((f) => f(uid, bal));
    return bal;
  }

  const notMember = () => new AppError("NOT_MEMBER", "회원만 쓸 수 있어요.", 403);
  const short = (need: number, have: number) =>
    new AppError("NEED_POINTS", `${POINT.name}가 모자라요. ${fmtPoint(need)}가 필요해요. (지금 ${fmtPoint(have)})`, 409, { need, points: have });

  // 한 회원의 잔액을 바꾸는 일은 차례로 (조건부 갱신만으로도 막히지만, 문서 단위 원자성이 약한 DB(FerretDB 등)에서도 두 번 들어가지 않게)
  const lock = new KeyedMutex();
  const locked =
    <A extends unknown[], R>(fn: (uid: string, ...a: A) => Promise<R>) =>
    (uid: string, ...a: A) =>
      lock.run(`pt:${uid}`, () => fn(uid, ...a));

  /** 오늘 일일 미션 기준: 오늘 처음이면 지금 업적 숫자를 적어 둠 (그 뒤로 늘어난 만큼이 오늘 한 것) */
  async function dailyToday(uid: string, d: PointFields | null) {
    const day = kstDay(now());
    if (d?.daily?.day === day) return d.daily;
    const games = [...new Set(DAILY_MISSIONS.map((x) => x.game))];
    const ms: Record<string, number> = Object.assign({}, ...(await Promise.all(games.map((g) => metricsOf(db, uid, g)))));
    // 키에 "." 를 넣지 않음 (몽고 계열 DB 마다 점 들어간 필드 이름을 막기도 함) — 읽을 때는 예전 점 키도 봄 (baseOf)
    const base = Object.fromEntries(DAILY_METRICS.map((k) => [baseKey(k), ms[k] ?? 0]));
    // 여러 곳에서 동시에 처음 열어도 한 번만 적음 (먼저 적은 쪽 기준)
    await col.updateOne({ _id: uid, nick: { $exists: true }, "daily.day": { $ne: day } } as never, { $set: { daily: { day, base, got: [] } } } as never);
    return (await read(uid))?.daily ?? { day, base, got: [] };
  }

  const api = {
    async get(uid: string): Promise<PointsInfo | null> {
      const d = await read(uid);
      if (!d || !d.nick) return null;
      return { points: d.points ?? 0, attendedToday: d.pointsDay === kstDay(now()) };
    },

    /** 출석: 오늘(한국 시간) 처음이면 ATTEND_POINTS. 조건 확인과 지급이 updateOne 하나 — 여러 탭에서 동시에 들어와도 하루 한 번. 받은 양(아니면 0) */
    async attend(uid: string): Promise<number> {
      const day = kstDay(now());
      const r = await col.updateOne(
        { _id: uid, nick: { $exists: true }, pointsDay: { $ne: day } } as never,
        { $set: { pointsDay: day }, $inc: { points: ATTEND_POINTS } } as never
      );
      if (!r.modifiedCount) return 0;
      await after(uid, ATTEND_POINTS, "attend");
      // 하루 처음 들어온 때를 일일 미션 기준으로
      await dailyToday(uid, await read(uid)).catch((e) => console.warn("[points] 일일 미션 기준 저장 실패", e));
      return ATTEND_POINTS;
    },

    /** 상품 사기: 포인트가 충분하고 아직 없을 때만. 산 뒤 잔액 */
    async buy(uid: string, itemId: string): Promise<number> {
      const item = shopItem(itemId);
      if (!item) throw new AppError("BAD_REQUEST", "없는 상품이에요.", 400);
      const g = grantOf(item);
      const notOwned = Object.fromEntries(Object.entries(g.owned).map(([k, v]) => [k, { $ne: v }]));
      const update = { ...g.update, $inc: { points: -item.price } };
      const r = await col.updateOne({ _id: uid, nick: { $exists: true }, points: { $gte: item.price }, ...notOwned } as never, update as never);
      if (!r.modifiedCount) {
        const d = await read(uid);
        if (!d?.nick) throw notMember();
        const [k, v] = Object.entries(g.owned)[0];
        const have = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], d) as string[] | undefined;
        if (have?.includes(v as string)) throw new AppError("OWNED", "이미 가진 상품이에요.", 409);
        throw short(item.price, d.points ?? 0);
      }
      return after(uid, -item.price, "buy", item.id);
    },

    /** 그 게임에서 포인트로 산 물건 (inv.<게임>) */
    async inventory(uid: string, game: string): Promise<string[]> {
      return (await read(uid))?.inv?.[game] ?? [];
    },

    /**
     * 포커 칩 → 포인트 (units 칸). 바꾼 뒤에도 칩이 keepChips 이상 남아야 함 (기본 칩 지급 → 환전을 되풀이하지 못하게).
     * 테이블에 앉아 있는지는 부르는 쪽(포커)에서 막음 — 앉은 동안의 칩은 판에 들고 있어서.
     */
    async chipsToPoints(uid: string, units: number): Promise<number> {
      const n = Math.floor(units);
      if (!(n >= 1 && n <= POKER_EXCHANGE.maxUnits)) throw new AppError("BAD_REQUEST", "바꿀 양을 다시 골라 주세요.", 400);
      const chips = n * POKER_EXCHANGE.chips;
      const pts = n * POKER_EXCHANGE.points;
      await col.updateOne({ _id: uid, money: { $exists: false } }, { $set: { money: START_MONEY } });
      const r = await col.updateOne(
        { _id: uid, nick: { $exists: true }, money: { $gte: chips + POKER_EXCHANGE.keepChips } } as never,
        { $inc: { money: -chips, points: pts, "poker.exch": -chips } } as never
      );
      if (!r.modifiedCount) {
        const d = await read(uid);
        if (!d?.nick) throw notMember();
        throw new AppError("NEED_MONEY", "칩이 모자라요. 바꾼 뒤에도 칩 500만은 남아 있어야 해요.", 409, { need: chips + POKER_EXCHANGE.keepChips, money: d.money ?? 0 });
      }
      return after(uid, pts, "exchange", "fromChips");
    },

    /** 포인트 → 포커 칩 (units 칸) */
    async pointsToChips(uid: string, units: number): Promise<number> {
      const n = Math.floor(units);
      if (!(n >= 1 && n <= POKER_EXCHANGE.maxUnits)) throw new AppError("BAD_REQUEST", "바꿀 양을 다시 골라 주세요.", 400);
      const chips = n * POKER_EXCHANGE.chips;
      const pts = n * POKER_EXCHANGE.points;
      await col.updateOne({ _id: uid, money: { $exists: false } }, { $set: { money: START_MONEY } });
      const r = await col.updateOne(
        { _id: uid, nick: { $exists: true }, points: { $gte: pts } } as never,
        { $inc: { points: -pts, money: chips, "poker.exch": chips } } as never
      );
      if (!r.modifiedCount) {
        const d = await read(uid);
        if (!d?.nick) throw notMember();
        throw short(pts, d.points ?? 0);
      }
      return after(uid, -pts, "exchange", "toChips");
    },

    /** 업적 목록 (그 게임) — 지금 숫자와 받았는지 */
    async achievements(uid: string | null, game: AchGame): Promise<AchState[]> {
      const list = achievementsOf(game);
      if (!uid) return list.map((x) => ({ id: x.id, value: 0, claimedAt: null }));
      const [m, d] = await Promise.all([metricsOf(db, uid, game), read(uid)]);
      const got = new Map((d?.achs ?? []).map((x) => [x.id, x.at]));
      return list.map((x) =>
        x.repeat
          ? { id: x.id, value: m[x.metric] ?? 0, claimedAt: null, times: repTimes(d, x.id) }
          : { id: x.id, value: m[x.metric] ?? 0, claimedAt: got.get(x.id) ?? null }
      );
    },

    /** 업적 보상 받기: 조건을 서버가 기록으로 다시 확인하고, 아직 안 받았을 때만 (updateOne 하나) */
    async claim(uid: string, id: string): Promise<{ reward: number; points: number }> {
      const ach = achievementOf(id);
      if (!ach) throw new AppError("BAD_REQUEST", "없는 업적이에요.", 400);
      const m = await metricsOf(db, uid, ach.game);
      if ((m[ach.metric] ?? 0) < ach.goal) throw new AppError("NOT_YET", "아직 달성하지 않은 업적이에요.", 409);
      if (ach.repeat) {
        // 반복형: 쌓인 만큼(여러 번이면 한꺼번에). 받은 횟수가 읽은 그대로일 때만 올림 — 두 번 눌러도 한 번만
        const d = await read(uid);
        if (!d?.nick) throw notMember();
        const n = repTimes(d, ach.id);
        const k = Math.floor((m[ach.metric] ?? 0) / ach.goal) - n;
        if (k <= 0) throw new AppError("NOT_YET", "다음 보상까지 조금 더 해야 해요.", 409);
        const key = repKey(ach.id);
        const r = await col.updateOne(
          { _id: uid, ...(n ? { [key]: n } : { $or: [{ [key]: { $exists: false } }, { [key]: 0 }] }) } as never,
          { $set: { [key]: n + k }, $inc: { points: ach.reward * k } } as never
        );
        if (!r.modifiedCount) throw new AppError("CLAIMED", "이미 받았어요.", 409);
        rankCache.delete(ach.game);
        return { reward: ach.reward * k, points: await after(uid, ach.reward * k, "ach", ach.id) };
      }
      const r = await col.updateOne(
        { _id: uid, nick: { $exists: true }, "achs.id": { $ne: ach.id } } as never,
        { $push: { achs: { id: ach.id, at: now() } }, $inc: { points: ach.reward } } as never
      );
      if (!r.modifiedCount) {
        const d = await read(uid);
        if (!d?.nick) throw notMember();
        throw new AppError("CLAIMED", "이미 받은 업적이에요.", 409);
      }
      rankCache.delete(ach.game);
      return { reward: ach.reward, points: await after(uid, ach.reward, "ach", ach.id) };
    },

    /** 일일 미션 (그 게임) — 오늘 한 만큼 · 받았는지. 비회원은 0 */
    async daily(uid: string | null, game: AchGame): Promise<DailyState[]> {
      const list = dailyOf(game);
      const d = uid ? await read(uid) : null;
      if (!uid || !d?.nick) return list.map((x) => ({ id: x.id, value: 0, got: false }));
      const [dl, m] = await Promise.all([dailyToday(uid, d), metricsOf(db, uid, game)]);
      return list.map((x) => ({ id: x.id, value: Math.max(0, (m[x.metric] ?? 0) - baseOf(dl.base, x.metric)), got: dl.got.includes(x.id) }));
    },

    /** 일일 미션 받기: id 를 주면 그것만, 안 주면 그 게임에서 받을 수 있는 것 전부 한 번에. 조건부 updateOne 하나 (두 번 눌러도 한 번) */
    async claimDaily(uid: string, game: AchGame, id?: string): Promise<{ reward: number; ids: string[]; points: number }> {
      if (id !== undefined && dailyMission(id)?.game !== game) throw new AppError("BAD_REQUEST", "없는 미션이에요.", 400);
      const st = await api.daily(uid, game);
      const ids = st.filter((s) => !s.got && s.value >= (dailyMission(s.id)?.goal ?? Infinity) && (!id || s.id === id)).map((s) => s.id);
      if (!ids.length) throw new AppError("NOT_YET", id ? "아직 다 못 한 미션이에요." : "받을 수 있는 미션이 없어요.", 409);
      const reward = ids.reduce((sum, x) => sum + (dailyMission(x)?.reward ?? 0), 0);
      const r = await col.updateOne(
        { _id: uid, nick: { $exists: true }, "daily.day": kstDay(now()), "daily.got": { $nin: ids } } as never,
        { $push: { "daily.got": { $each: ids } }, $inc: { points: reward } } as never
      );
      if (!r.modifiedCount) throw new AppError("CLAIMED", "이미 받았어요.", 409);
      return { reward, ids, points: await after(uid, reward, "daily", ids.join(",")) };
    },

    /** 받을 수 있는데 안 받은 업적 수 (게임별) — 버튼 점 표시용 */
    async claimable(uid: string, game: AchGame): Promise<number> {
      const s = await api.achievements(uid, game);
      return s.filter((x) => {
        const a = achievementOf(x.id);
        return !!a && claimableTimes(a, x) > 0;
      }).length;
    },

    /**
     * 업적 랭킹 (그 게임): 받은 업적의 보상 포인트 합이 많은 순 — 같으면 먼저 다 모은 사람.
     * 회원 수가 많지 않아 업적을 하나라도 받은 회원을 읽어 계산 (30초 기억)
     */
    async achRank(game: AchGame, limit = 50): Promise<AchRankRow[]> {
      const hit = rankCache.get(game);
      if (hit && now() - hit.at < 30_000) return hit.rows.slice(0, limit);
      const defs = achievementsOf(game);
      const ids = new Map(defs.filter((x) => !x.repeat).map((x) => [x.id, x.reward]));
      const reps = defs.filter((x) => x.repeat);
      const docs = await col
        .find({ $or: [{ "achs.0": { $exists: true } }, { achRep: { $exists: true } }] } as never, { projection: { nick: 1, achs: 1, achRep: 1, "avatar.at": 1, photo: 1 } })
        .toArray();
      const rows = docs
        .map((d) => {
          const u = d as unknown as PointFields & { avatar?: { at?: number }; photo?: string | null };
          const mine = (u.achs ?? []).filter((x) => ids.has(x.id));
          // 반복형은 받은 횟수 × 보상 (받은 시각은 따로 안 남겨서 순서 정할 때는 일회형만)
          const repPts = reps.reduce((s, x) => s + repTimes(u, x.id) * x.reward, 0);
          const repN = reps.reduce((s, x) => s + repTimes(u, x.id), 0);
          return {
            nick: u.nick,
            avatar: pictureOf(String(d._id), u),
            points: mine.reduce((s, x) => s + (ids.get(x.id) ?? 0), 0) + repPts,
            count: mine.length + repN,
            at: Math.max(0, ...mine.map((x) => x.at)),
          };
        })
        .filter((r) => r.nick && r.count > 0)
        .sort((a, b) => b.points - a.points || a.at - b.at);
      rankCache.set(game, { at: now(), rows });
      return rows.slice(0, limit);
    },

    /** 최근 원장 */
    async log(uid: string, limit = 30): Promise<PointLogRow[]> {
      const rows = await logs.find({ uid }).sort({ at: -1 }).limit(limit).toArray();
      return rows.map(({ at, delta, reason, ref, bal }) => ({ at, delta, reason, ...(ref && { ref }), ...(bal !== undefined && { bal }) }));
    },

    /** 게임 안에서 포인트 쓰기 (예: 디펜스 시즌 패스 · 코어 교환). 모자라면 NEED_POINTS. 쓴 뒤 잔액 */
    async spend(uid: string, amount: number, reason: string, ref?: string): Promise<number> {
      const n = Math.floor(amount);
      if (!(n > 0)) throw new AppError("BAD_REQUEST", "잘못된 값이에요.", 400);
      const r = await col.updateOne({ _id: uid, nick: { $exists: true }, points: { $gte: n } } as never, { $inc: { points: -n } } as never);
      if (!r.modifiedCount) {
        const d = await read(uid);
        if (!d?.nick) throw notMember();
        throw short(n, d.points ?? 0);
      }
      return after(uid, -n, reason, ref);
    },

    /** 게임 보상으로 포인트 주기 (예: 디펜스 주간 도전 순위). 준 뒤 잔액 */
    async grant(uid: string, amount: number, reason: string, ref?: string): Promise<number> {
      const n = Math.floor(amount);
      if (!(n > 0)) return (await read(uid))?.points ?? 0;
      const r = await col.updateOne({ _id: uid, nick: { $exists: true } } as never, { $inc: { points: n } } as never);
      if (!r.modifiedCount) throw notMember();
      return after(uid, n, reason, ref);
    },

    /** (관리자) 잔액을 그 값으로 맞춤 — 차이만큼 원장에 */
    async adminSet(uid: string, points: number): Promise<number> {
      const d = await read(uid);
      if (!d) throw new AppError("NOT_FOUND", "없는 회원이에요.", 404);
      const to = Math.max(0, Math.floor(points));
      const delta = to - (d.points ?? 0);
      if (!delta) return to;
      await col.updateOne({ _id: uid }, { $set: { points: to } });
      return after(uid, delta, "admin");
    },

    onChange(fn: (uid: string, points: number) => void) {
      listeners.push(fn);
    },

    /** 모든 업적 정의 (테스트 · 관리자용) */
    all: ACHIEVEMENTS,
  };
  return {
    ...api,
    attend: locked(api.attend),
    buy: locked(api.buy),
    chipsToPoints: locked(api.chipsToPoints),
    pointsToChips: locked(api.pointsToChips),
    claim: locked(api.claim),
    claimDaily: locked(api.claimDaily),
    spend: locked(api.spend),
    grant: locked(api.grant),
    adminSet: locked(api.adminSet),
  };
}
