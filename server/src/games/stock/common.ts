import type { Database } from "../../db";
import { forbidden } from "../../errors";
import type { Ctx } from "../../realtime/gateway";
import type { UserDoc } from "../../users";
import { REVIVE_TO, REVIVE_UNDER, START_CASH } from "../../../../web/src/lib/stock/money";

/*
 * 주식게임 전용 지갑 — 다른 게임 돈과 섞이지 않음.
 *   users.stk.cash      현금
 *   users.stk.held      솔로 판에 들고 있는 주식의 지금 값 (회생 판정 · 총자산)
 *   users.stk.coinHeld  코인 포지션의 지금 평가액 (회생 판정 · 총자산)
 *   users.stk.revives   회생 받은 횟수
 *   users.stats.stk.*   솔로 · 코인 · 대전 전적
 */

export interface StkFields {
  stk?: { cash?: number; held?: number; coinHeld?: number; revives?: number };
}

/** 회원만 (게스트는 지갑이 없음) */
export function member(ctx: Ctx): { uid: string; nick: string } {
  if (!ctx.nick || ctx.user?.anonymous) throw forbidden("회원만 이용할 수 있어요. 로그인해 주세요.");
  return { uid: ctx.uid, nick: ctx.nick };
}

export type StkWallet = ReturnType<typeof createStkWallet>;

export function createStkWallet(db: Database) {
  const users = db.col<UserDoc & StkFields>("users");

  /** 지갑이 아직 없는 회원에게 시작 자금을 먼저 써 넣음 (없는 채로 $inc 하면 증감만 남음) */
  const ensure = (uid: string) => users.updateOne({ _id: uid, "stk.cash": { $exists: false } } as never, { $set: { "stk.cash": START_CASH } } as never);

  async function get(uid: string): Promise<{ cash: number; held: number; coinHeld: number; revives: number }> {
    await ensure(uid);
    const d = (await users.findOne({ _id: uid }, { projection: { stk: 1 } })) as StkFields | null;
    return {
      cash: d?.stk?.cash ?? START_CASH,
      held: Math.max(0, d?.stk?.held ?? 0),
      coinHeld: Math.max(0, d?.stk?.coinHeld ?? 0),
      revives: d?.stk?.revives ?? 0,
    };
  }

  return {
    ensure,
    get,
    cash: async (uid: string) => (await get(uid)).cash,
    /** 판이 끝났을 때 총자산(현금 + 들고 있는 주식 · 코인)이 500만 밑이면 1천만으로 회생 */
    async revive(uid: string): Promise<{ revived?: { amount: number } } | null> {
      const r = await users.updateOne(
        {
          _id: uid,
          $expr: { $lt: [{ $add: [{ $ifNull: ["$stk.cash", START_CASH] }, { $ifNull: ["$stk.held", 0] }, { $ifNull: ["$stk.coinHeld", 0] }] }, REVIVE_UNDER] },
        } as never,
        { $set: { "stk.cash": REVIVE_TO }, $inc: { "stk.revives": 1 } } as never
      );
      return r.modifiedCount ? { revived: { amount: REVIVE_TO } } : null;
    },
  };
}

/** 한 사람의 돈이 움직이는 일은 한 번에 하나씩 (연타 · 여러 탭이 겹쳐도 금액이 안 틀어지게) */
export function createLocks() {
  const locks = new Map<string, Promise<unknown>>();
  return function withLock<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(uid) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.catch(() => {});
    locks.set(uid, tail);
    void tail.then(() => {
      if (locks.get(uid) === tail) locks.delete(uid);
    });
    return run;
  };
}

/**
 * 옛 주식 마을(포커 지갑 공유 · 부동산) 데이터 정리 — 서버 뜰 때마다 돌아도 같음.
 * 새 코드는 stk · stats.stk · stk_* 컬렉션만 쓰므로 옛 필드 · 컬렉션은 지움.
 */
export async function dropLegacyStock(db: Database) {
  await db
    .col("users")
    .updateMany({ $or: [{ stock: { $exists: true } }, { estate: { $exists: true } }, { "stats.stock": { $exists: true } }] }, { $unset: { stock: "", estate: "", "stats.stock": "" } })
    .catch((e) => console.warn("[stock] legacy users", e));
  const have = new Set((await db.db.listCollections({}, { nameOnly: true }).toArray().catch(() => [])).map((c) => c.name));
  for (const name of ["stock_solo", "stock_coin", "stock_battles", "stock_lots"]) {
    if (have.has(name)) await db.db.dropCollection(name).catch((e) => console.warn("[stock] drop", name, e));
  }
}

/** 한국 시간 이번 주 월요일 0시 */
export function weekStart(t: number): number {
  const k = new Date(t + 9 * 3600_000);
  const day = (k.getUTCDay() + 6) % 7; // 월=0
  const mon = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - day);
  return mon - 9 * 3600_000;
}

/** 한국 시간 이번 달 1일 0시 */
export function monthStart(t: number): number {
  const k = new Date(t + 9 * 3600_000);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - 9 * 3600_000;
}
