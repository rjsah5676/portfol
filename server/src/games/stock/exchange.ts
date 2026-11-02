import { z } from "zod";
import type { Database } from "../../db";
import { AppError } from "../../errors";
import type { Gateway } from "../../realtime/gateway";
import type { UserDoc } from "../../users";
import { REVIVE } from "../../../../web/src/lib/poker/rules";
import { EXCHANGE_MAX, EXCHANGE_UNIT, REVIVE_UNDER } from "../../../../web/src/lib/stock/money";
import type { ExchangeView } from "../../../../web/src/lib/stock/types";
import { member, type StkFields, type StkWallet } from "./common";

/*
 * 환전소 — 주식게임 돈(users.stk.cash) ↔ 포커 칩(users.money) 1:1. 주식게임 화면에서만 열림.
 *
 * 두 돈이 같은 users 문서에 있어서, 조건 확인 · 빼기 · 넣기를 updateOne 하나로 함 (두 번 눌러도 · 동시에 눌러도 한 번만).
 * 막는 것
 *   - 포커 테이블에 앉아 있을 때 (판 중의 칩은 서버 메모리에 있고 끝나면 증감으로 정산되므로, 그사이 빼 가면 음수가 됨)
 *   - 환전하고 나서 보내는 쪽이 회생 기준(500만) 밑으로 내려가는 것 — 한쪽을 비우고 회생을 받아 반대쪽으로 옮기는 돈 복사를 막음
 * 바꿀 때마다 stk_exchange 에 남김 (운영자 확인용)
 */

export interface PokerLink {
  busy(uid: string): boolean;
  /** 포커 화면의 지갑 갱신 */
  refresh(uid: string): Promise<unknown>;
}

type Doc = UserDoc & StkFields & { money?: number; poker?: { vault?: number } };

const STK_TOTAL = { $add: [{ $ifNull: ["$stk.cash", 0] }, { $ifNull: ["$stk.held", 0] }, { $ifNull: ["$stk.coinHeld", 0] }] };
const POKER_TOTAL = { $add: [{ $ifNull: ["$money", 0] }, { $ifNull: ["$poker.vault", 0] }] };
const floorUnit = (n: number) => Math.max(0, Math.floor(n / EXCHANGE_UNIT) * EXCHANGE_UNIT);

export function createExchange(db: Database, gateway: Gateway, wallet: StkWallet, poker: PokerLink | undefined, now: () => number) {
  const users = db.col<Doc>("users");
  const log = db.col<{ uid: string; dir: string; amount: number; at: Date }>("stk_exchange");

  async function view(uid: string): Promise<ExchangeView> {
    const w = await wallet.get(uid);
    const d = (await users.findOne({ _id: uid }, { projection: { money: 1, "poker.vault": 1 } })) as Doc | null;
    const chips = Math.max(0, d?.money ?? 0);
    const vault = Math.max(0, d?.poker?.vault ?? 0);
    const stkTotal = w.cash + w.held + w.coinHeld;
    const busy = !!poker?.busy(uid);
    return {
      cash: w.cash,
      stkTotal,
      chips,
      vault,
      busy,
      open: !!poker && d?.money !== undefined,
      maxToPoker: Math.min(EXCHANGE_MAX, floorUnit(Math.min(w.cash, stkTotal - REVIVE_UNDER))),
      maxToStock: Math.min(EXCHANGE_MAX, floorUnit(Math.min(chips, chips + vault - REVIVE.under))),
    };
  }

  gateway.rpc("stock.exchange.view", async (ctx) => view(member(ctx).uid));

  gateway.rpc("stock.exchange", async (ctx, raw): Promise<ExchangeView> => {
    const { uid } = member(ctx);
    const { dir, amount } = z
      .object({ dir: z.enum(["toPoker", "toStock"]), amount: z.number().int().min(EXCHANGE_UNIT).max(EXCHANGE_MAX).multipleOf(EXCHANGE_UNIT) })
      .parse(raw);
    if (!poker) throw new AppError("CLOSED", "지금은 환전소가 닫혀 있어요.", 409);
    if (poker.busy(uid)) throw new AppError("SEATED", "포커 테이블에서 일어난 뒤에 바꿀 수 있어요.", 409);
    await wallet.ensure(uid);
    const r =
      dir === "toPoker"
        ? await users.updateOne(
            {
              _id: uid,
              money: { $exists: true },
              "stk.cash": { $gte: amount },
              $expr: { $gte: [{ $subtract: [STK_TOTAL, amount] }, REVIVE_UNDER] },
            } as never,
            { $inc: { "stk.cash": -amount, money: amount } } as never
          )
        : await users.updateOne(
            {
              _id: uid,
              money: { $gte: amount },
              $expr: { $gte: [{ $subtract: [POKER_TOTAL, amount] }, REVIVE.under] },
            } as never,
            { $inc: { money: -amount, "stk.cash": amount } } as never
          );
    if (!r.modifiedCount) {
      const v = await view(uid);
      const max = dir === "toPoker" ? v.maxToPoker : v.maxToStock;
      throw new AppError("NOT_ENOUGH", max > 0 ? "바꿀 수 있는 금액을 넘었어요. 최대 금액을 다시 확인해 주세요." : "바꾸고 나서 남는 돈이 500만은 넘어야 해요.", 409);
    }
    // 바꾸는 사이에 포커 테이블에 앉았으면(드묾) 되돌림
    if (poker.busy(uid)) {
      await users.updateOne({ _id: uid }, (dir === "toPoker" ? { $inc: { "stk.cash": amount, money: -amount } } : { $inc: { money: amount, "stk.cash": -amount } }) as never);
      throw new AppError("SEATED", "포커 테이블에서 일어난 뒤에 바꿀 수 있어요.", 409);
    }
    await log.insertOne({ uid, dir, amount, at: new Date(now()) } as never).catch((e) => console.warn("[stock] 환전 기록", e));
    void poker.refresh(uid).catch(() => {});
    return view(uid);
  });
}
