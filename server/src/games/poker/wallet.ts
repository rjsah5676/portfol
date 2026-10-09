import type { Database } from "../../db";
import { AppError } from "../../errors";
import { pictureOf, type UserDoc } from "../../users";
import { CHAR_PRICE, REVIVE, START_MONEY, charOf, fmtWon, kstDay, lookOf, skinOf, type CharId, type GameKind, type SkinId, type Wear } from "../../../../web/src/lib/poker/rules";
import type { BuyRankRow, RankRow } from "../../../../web/src/lib/poker/types";

/*
 * 포커 자금 (회원의 users 문서에 money 로 저장).
 *
 * 돈이 바뀌는 길은 셋뿐이고 전부 서버 안에서만 일어남
 *   1) 가입할 때 START_MONEY (users.ts 가 넣음. 그 전에 가입한 회원은 서버가 뜰 때 채움)
 *   2) 회생: 조건(보유금액 · 오늘 횟수)을 DB 가 한 번에 확인하고 올림
 *   3) 판이 끝났을 때 딴 만큼 · 잃은 만큼 ($inc). 한 판의 증감 합은 0 (봇 몫 제외)
 * 브라우저는 금액을 보내지 않음 — 보내는 건 "콜", "레이즈 얼마" 같은 행동뿐이고 그것도 서버가 규칙대로 검사.
 * 판 도중의 칩은 서버 메모리에만 있어서, 판이 끝나기 전에 서버가 꺼지면 그 판은 없던 일이 됨(DB 의 돈은 그대로).
 */

export interface WalletDoc {
  money: number;
  reviveUsed: number;
  /** 고른 캐릭터 */
  char: CharId;
  /** 가진 스킨 · 캐릭터별로 입은 스킨 */
  skins: SkinId[];
  wear: Wear;
}

export interface SettleEntry {
  uid: string;
  delta: number;
  game: GameKind;
  /** 팟을 가져갔는지 */
  won: boolean;
  /** 가져간 돈 (가장 크게 먹은 판 기록용) */
  wonAmount: number;
}

type MoneyFields = Pick<UserDoc, "nick"> & { money?: number; revive?: { day: string; n: number }; poker?: { char?: string; skins?: string[]; wear?: Record<string, string> } };
const WALLET_PROJ = { nick: 1, money: 1, revive: 1, "poker.char": 1, "poker.skins": 1, "poker.wear": 1 } as const;

/** 문서의 스킨 목록 · 입은 스킨을 믿을 수 있는 값만 남김 (가진 것 · 그 캐릭터의 스킨만) */
export function skinsOf(p?: MoneyFields["poker"]): { skins: SkinId[]; wear: Wear } {
  const skins = [...new Set((p?.skins ?? []).filter((x) => skinOf(x)))] as SkinId[];
  const wear: Wear = {};
  for (const [c, id] of Object.entries(p?.wear ?? {})) {
    const sk = skinOf(id);
    if (sk && sk.char === c && skins.includes(sk.id)) wear[sk.char] = sk.id;
  }
  return { skins, wear };
}

export type Wallet = ReturnType<typeof createWallet>;

export function createWallet(db: Database, now: () => number = Date.now) {
  const col = db.col<UserDoc>("users");
  const listeners: ((uid: string, w: WalletDoc) => void)[] = [];

  const toWallet = (d: MoneyFields): WalletDoc => ({
    money: d.money ?? START_MONEY,
    reviveUsed: d.revive && d.revive.day === kstDay(now()) ? d.revive.n : 0,
    char: charOf(d.poker?.char),
    ...skinsOf(d.poker),
  });

  /**
   * money 가 아직 없는 회원 문서에 시작 자금을 실제로 써 넣음 (조건부라 여러 번 불러도 한 번만).
   * 필드가 없는 채로 $inc 하면 "1억 + 증감"이 아니라 증감만 남으므로, 돈을 건드리기 전에 반드시 거침.
   */
  const materialize = (uids: string[]) =>
    uids.length ? col.updateMany({ _id: { $in: uids }, money: { $exists: false } }, { $set: { money: START_MONEY } }) : Promise.resolve(null);

  async function get(uid: string): Promise<WalletDoc | null> {
    let d = (await col.findOne({ _id: uid }, { projection: WALLET_PROJ })) as MoneyFields | null;
    if (d && d.money === undefined) {
      await materialize([uid]);
      d = (await col.findOne({ _id: uid }, { projection: WALLET_PROJ })) as MoneyFields | null;
    }
    return d ? toWallet(d) : null;
  }

  const changed = async (uid: string) => {
    const w = await get(uid);
    if (w) listeners.forEach((f) => f(uid, w));
    return w;
  };

  return {
    /** 서버가 뜰 때: 예전에 가입해서 money 가 없는 회원에게 시작 자금을 채움 (여러 번 불러도 한 번만 적용됨) */
    async ensure() {
      await col.updateMany({ money: { $exists: false } }, { $set: { money: START_MONEY } });
    },

    /** 내 자금 (회원이 아니면 null) */
    get,

    /** 여러 명의 보유금액 (판을 시작할 때 한 번에 읽음). 회원이 아닌 uid 는 빠짐 */
    async moneyOf(uids: string[]): Promise<Map<string, number>> {
      const out = new Map<string, number>();
      if (!uids.length) return out;
      await materialize(uids);
      const docs = await col.find({ _id: { $in: uids } }, { projection: { money: 1 } }).toArray();
      for (const d of docs) out.set(String(d._id), (d as MoneyFields).money ?? START_MONEY);
      return out;
    },

    /**
     * 회생. 보유금액이 기준 미만이고 오늘 횟수가 남았을 때만.
     * 조건 확인과 지급을 updateOne 하나로 해서, 동시에 여러 번 눌러도 한 번만 들어감.
     */
    async revive(uid: string): Promise<WalletDoc> {
      await materialize([uid]);
      const day = kstDay(now());
      const under = { _id: uid, money: { $lt: REVIVE.under } };
      // 오늘 이미 받은 적이 있는 경우 → 횟수 +1
      let r = await col.updateOne(
        { ...under, "revive.day": day, "revive.n": { $lt: REVIVE.perDay } },
        { $inc: { money: REVIVE.amount, "revive.n": 1 } }
      );
      // 오늘 처음인 경우 → 횟수를 1 로 새로 씀
      if (!r.modifiedCount)
        r = await col.updateOne({ ...under, "revive.day": { $ne: day } }, { $inc: { money: REVIVE.amount }, $set: { revive: { day, n: 1 } } });
      if (!r.modifiedCount) {
        const w = await get(uid);
        if (!w) throw new AppError("NOT_MEMBER", "회원만 쓸 수 있어요.", 403);
        if (w.money >= REVIVE.under) throw new AppError("NOT_BROKE", "칩이 500만 아래로 내려가면 받을 수 있어요.", 409);
        throw new AppError("REVIVE_LIMIT", "오늘 회생은 다 썼어요. 자정에 다시 채워져요.", 409);
      }
      return (await changed(uid))!;
    },

    /** 판 정산: 사람마다 증감을 반영하고 기록(판 수 · 이긴 판 · 가장 크게 먹은 판)을 올림 */
    async settle(entries: SettleEntry[]) {
      if (!entries.length) return;
      await materialize(entries.map((e) => e.uid));
      await col.bulkWrite(
        entries.map((e) => ({
          updateOne: {
            filter: { _id: e.uid },
            update: {
              $inc: {
                money: e.delta,
                "stats.poker.hands": 1,
                [`stats.poker.${e.game}.hands`]: 1,
                ...(e.won && { [`stats.poker.${e.game}.wins`]: 1 }),
              },
              ...(e.wonAmount > 0 && { $max: { "stats.poker.best": e.wonAmount } }),
            },
          },
        })),
        { ordered: false }
      );
      // 판을 시작할 때 가진 만큼만 걸 수 있어서 음수가 될 일은 없지만, 그사이 관리자가 금액을 고쳤을 때를 대비
      const fixed = await col.updateMany({ _id: { $in: entries.map((e) => e.uid) }, money: { $lt: 0 } }, { $set: { money: 0 } });
      if (fixed.modifiedCount) console.error("[poker] 보유금액이 음수가 되어 0 으로 맞춤 — 있어서는 안 되는 일", entries);
      await Promise.all(entries.map((e) => changed(e.uid)));
    },

    /** 자금 순위: 한 판이라도 친 회원만 */
    async rank(limit = 50): Promise<RankRow[]> {
      const docs = await col
        .find({ "stats.poker.hands": { $gte: 1 } }, { projection: { nick: 1, money: 1, "stats.poker.hands": 1, "poker.char": 1, "poker.skins": 1, "poker.wear": 1, "avatar.at": 1, photo: 1 } })
        .sort({ money: -1 })
        .limit(limit)
        .toArray();
      return docs.map((d) => {
        const u = d as unknown as MoneyFields & { stats?: { poker?: { hands?: number } }; avatar?: { at?: number }; photo?: string | null };
        return {
          // 직접 올린 프로필 사진 → 로그인 계정 사진 → 없으면 null (화면에서 캐릭터 얼굴)
          avatar: pictureOf(String(d._id), u),
          nick: u.nick,
          money: u.money ?? START_MONEY,
          hands: u.stats?.poker?.hands ?? 0,
          char: charOf(u.poker?.char),
          look: lookOf(charOf(u.poker?.char), skinsOf(u.poker).wear),
        };
      });
    },

    /** 구매 순위: 스킨 · (칩으로 사는) 캐릭터에 쓴 칩이 많은 순. 하나라도 산 회원만 */
    async buyRank(limit = 50): Promise<BuyRankRow[]> {
      const docs = await col
        .find(
          { $or: [{ "poker.skins.0": { $exists: true } }, { "poker.chars.0": { $exists: true } }] } as never,
          { projection: { nick: 1, "poker.char": 1, "poker.skins": 1, "poker.chars": 1, "poker.wear": 1, "avatar.at": 1, photo: 1 } }
        )
        .toArray();
      return docs
        .map((d) => {
          const u = d as unknown as MoneyFields & { poker?: { chars?: string[] }; avatar?: { at?: number }; photo?: string | null };
          const { skins, wear } = skinsOf(u.poker);
          const chars = [...new Set(u.poker?.chars ?? [])].filter((c) => (CHAR_PRICE[c] ?? 0) > 0);
          const spent =
            skins.reduce((a, id) => a + (skinOf(id)?.price ?? 0), 0) + chars.reduce((a, c) => a + (CHAR_PRICE[c] ?? 0), 0);
          return {
            avatar: pictureOf(String(d._id), u),
            nick: u.nick,
            char: charOf(u.poker?.char),
            look: lookOf(charOf(u.poker?.char), wear),
            spent,
            skins: skins.length,
            chars: chars.length,
          };
        })
        .filter((r) => r.spent > 0)
        .sort((a, b) => b.spent - a.spent || b.skins + b.chars - (a.skins + a.chars))
        .slice(0, limit);
    },

    /**
     * 스킨 사기: 돈이 모자라지 않고 아직 없을 때만 (한 번의 조건부 갱신이라 두 번 눌러도 한 번만 빠짐). 사면 바로 입음.
     * 테이블에 앉아 있는지는 부르는 쪽에서 막음 (앉아 있는 동안의 칩은 메모리에 있어서).
     */
    async buySkin(uid: string, id: SkinId) {
      const sk = skinOf(id);
      if (!sk) throw new AppError("BAD_REQUEST", "없는 스킨이에요.", 400);
      await materialize([uid]);
      const r = await col.updateOne(
        { _id: uid, money: { $gte: sk.price }, "poker.skins": { $ne: sk.id } } as never,
        { $inc: { money: -sk.price }, $push: { "poker.skins": sk.id }, $set: { [`poker.wear.${sk.char}`]: sk.id } } as never
      );
      if (!r.modifiedCount) {
        const w = await get(uid);
        if (!w) throw new AppError("NOT_MEMBER", "회원만 쓸 수 있어요.", 403);
        if (w.skins.includes(sk.id)) throw new AppError("OWNED", "이미 가진 스킨이에요.", 409);
        throw new AppError("NEED_MONEY", `칩이 모자라요. ${sk.name}은(는) 칩 ${fmtWon(sk.price)}이에요.`, 409, { need: sk.price, money: w.money });
      }
      return (await changed(uid))!;
    },

    /** 스킨 입기 / 벗기 (skin = null 이면 그 캐릭터는 기본 모습) */
    async wearSkin(uid: string, char: CharId, id: SkinId | null) {
      const w = await get(uid);
      if (!w) throw new AppError("NOT_MEMBER", "회원만 쓸 수 있어요.", 403);
      if (id) {
        const sk = skinOf(id);
        if (!sk || sk.char !== char) throw new AppError("BAD_REQUEST", "그 캐릭터의 스킨이 아니에요.", 400);
        if (!w.skins.includes(id)) throw new AppError("NOT_OWNED", "아직 없는 스킨이에요. 상점에서 살 수 있어요.", 409);
        await col.updateOne({ _id: uid }, { $set: { [`poker.wear.${char}`]: id } } as never);
      } else await col.updateOne({ _id: uid }, { $unset: { [`poker.wear.${char}`]: "" } } as never);
      return (await changed(uid))!;
    },

    /** 자금이 바뀌었을 때 (그 사람의 화면에 알림) */
    onChange(fn: (uid: string, w: WalletDoc) => void) {
      listeners.push(fn);
    },
  };
}
