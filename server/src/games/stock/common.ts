import type { Database } from "../../db";
import { AppError, forbidden } from "../../errors";
import type { Ctx } from "../../realtime/gateway";
import type { UserDoc } from "../../users";
import { START_MONEY, charOf, lookOf, type CharId, type Look } from "../../../../web/src/lib/poker/rules";
import { skinsOf, type Wallet } from "../poker/wallet";

/** 주식 마을이 포커에서 빌려 쓰는 것 (지갑은 포커와 같은 돈) */
export interface PokerLink {
  wallet: Wallet;
  /** 포커 테이블에 앉아 있나 (그동안은 칩이 테이블에 묶여 있음 → 사기 · 입찰 막음) */
  seated(uid: string): boolean;
  /** 돈이 줄었을 때 자동 회생 확인 */
  autoRevive(uid: string): Promise<{ revived?: { amount: number; left: number } } | null>;
}

/** 회원만 (게스트는 지갑이 없음) */
export function member(ctx: Ctx): { uid: string; nick: string } {
  if (!ctx.nick || ctx.user?.anonymous) throw forbidden("회원만 이용할 수 있어요. 로그인해 주세요.");
  return { uid: ctx.uid, nick: ctx.nick };
}

export const noBuyWhileSeated = (poker: PokerLink, uid: string) => {
  if (poker.seated(uid)) throw new AppError("SEATED", "포커 테이블에 앉아 있는 동안은 살 수 없어요. 테이블에서 일어난 뒤에 해 주세요.", 409);
};

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

type FaceDoc = Pick<UserDoc, "nick"> & { poker?: { char?: string; skins?: string[]; wear?: Record<string, string> } };
/** 회원의 포커 캐릭터 · 입은 스킨 (아바타) */
export async function faceOf(db: Database, uid: string): Promise<{ nick: string; char: CharId; look: Look }> {
  const d = (await db.col<UserDoc>("users").findOne({ _id: uid }, { projection: { nick: 1, "poker.char": 1, "poker.skins": 1, "poker.wear": 1 } })) as FaceDoc | null;
  const char = charOf(d?.poker?.char);
  return { nick: d?.nick ?? "", char, look: lookOf(char, skinsOf(d?.poker).wear) };
}

/** money 필드가 없는 회원에게 시작 자금을 먼저 써 넣음 (없는 채로 $inc 하면 증감만 남음) */
export const materialize = (db: Database, uid: string) =>
  db.col<UserDoc>("users").updateOne({ _id: uid, money: { $exists: false } }, { $set: { money: START_MONEY } });

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
