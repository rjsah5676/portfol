import { randomInt } from "node:crypto";
import { z } from "zod";
import type { Database } from "../../db";
import { AppError, bad } from "../../errors";
import { KeyedMutex } from "../../mutex";
import type { Points } from "../../points";
import {
  CHAR,
  GACHA,
  ITEM,
  MATCH_STARS,
  MAX_LV,
  STARTER,
  PASS_DAY,
  STORE,
  itemUpCost,
  storeItem,
  type Loadout,
} from "../../../../web/src/lib/marble/data";
import { charUpNeed, pullChars, pullItems, type CharPull, type ItemPull } from "../../../../web/src/lib/marble/gacha";
import type { ProfileWire } from "../../../../web/src/lib/marble/wire";

/*
 * DICE TOWN — 판 밖 성장 (별사탕 · 부품 · 캐릭터 · 아이템 · 장착 · 가챠 · GP 상점).
 * 수치 정의는 web/src/lib/marble/data.ts · gacha.ts. 여기선 저장 · 지급만.
 *
 * marble_profile (회원당 문서 하나, _id = uid). 바꾸는 일은 회원별 잠금 안에서 읽고 → 고치고 → 통째로 저장.
 * GP(사이트 포인트)는 points.spend 로만 (원장 reason "marble").
 */

export interface MarbleProfile {
  _id: string;
  stars: number;
  parts: number;
  chars: Record<string, { lv: number; dup: number }>;
  items: Record<string, { lv: number }>;
  load: { char: string | null; dice: string | null; buddy: string | null };
  pity: { char: number; item: number };
  tickets: { char: number; item: number };
  /** 이번 주 상점 산 수 */
  shop: { w: number; n: Record<string, number> };
  /** 한 번만 사는 것 */
  packs: Record<string, number>;
  /** 오늘 첫 승 보너스를 받은 날 (KST) */
  winDay: string;
  games: number;
  wins: number;
  /** 가챠 누적 (업적 · 통계) */
  pulls: { char: number; item: number };
  /** 일일 패스: until 까지(한국 날짜, 포함) · last 마지막으로 받은 날 */
  pass?: { until: string; last: string };
  at: Date;
}

const DAY = 86400_000;
export const kstDay = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
/** 한국 시간 월요일 시작 주 번호 */
export const kstWeek = (t: number) => Math.floor(((t + 9 * 3600_000) / DAY - 4) / 7);

const rand = () => randomInt(0, 2 ** 30) / 2 ** 30;

export type MarbleMeta = ReturnType<typeof createMarbleMeta>;

export function createMarbleMeta(db: Database, points: Points, now: () => number = Date.now) {
  const col = db.col<MarbleProfile>("marble_profile");
  const users = db.col("users");
  const lock = new KeyedMutex();

  const fresh = (uid: string): MarbleProfile => ({
    _id: uid,
    stars: STARTER.stars,
    parts: 0,
    chars: {},
    items: {},
    load: { char: null, dice: null, buddy: null },
    pity: { char: 0, item: 0 },
    tickets: { char: STARTER.charTickets, item: STARTER.itemTickets },
    shop: { w: kstWeek(now()), n: {} },
    packs: {},
    winDay: "",
    games: 0,
    wins: 0,
    pulls: { char: 0, item: 0 },
    at: new Date(now()),
  });

  async function read(uid: string): Promise<MarbleProfile> {
    const d = (await col.findOne({ _id: uid } as never)) as MarbleProfile | null;
    const p = d ?? fresh(uid);
    // 주가 바뀌면 상점 한도 새로
    if (p.shop.w !== kstWeek(now())) p.shop = { w: kstWeek(now()), n: {} };
    p.pulls ??= { char: 0, item: 0 };
    // 없어진 캐릭터(개편 전 스킨 등)는 빼고 별사탕으로 돌려줌
    for (const id of Object.keys(p.chars)) {
      if (CHAR[id]) continue;
      delete p.chars[id];
      p.stars += 450;
      if (p.load.char === id) p.load.char = null;
    }
    return p;
  }
  async function save(p: MarbleProfile) {
    p.at = new Date(now());
    await col.replaceOne({ _id: p._id } as never, p as never, { upsert: true });
  }
  /** 읽고 → fn → 저장 (fn 이 throw 하면 저장 안 함) */
  const edit = <T>(uid: string, fn: (p: MarbleProfile) => T | Promise<T>) =>
    lock.run(`mp:${uid}`, async () => {
      const p = await read(uid);
      const r = await fn(p);
      await save(p);
      return r;
    });

  /** 일일 패스: 오늘 아직 안 받았으면 지급 (받았으면 true) */
  function claimPass(p: MarbleProfile): boolean {
    const today = kstDay(now());
    if (!p.pass || p.pass.until < today || p.pass.last === today) return false;
    p.pass.last = today;
    p.stars += PASS_DAY.stars;
    p.parts += PASS_DAY.parts;
    return true;
  }
  /** 패스 날 수 더하기 (이미 있으면 끝에 이어 붙임) */
  function addPass(p: MarbleProfile, days: number) {
    const today = kstDay(now());
    const from = p.pass && p.pass.until >= today ? p.pass.until : kstDay(now() - DAY);
    p.pass = { until: new Date(Date.parse(from + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10), last: p.pass?.last ?? "" };
    claimPass(p);
  }

  async function wire(uid: string, p?: MarbleProfile): Promise<ProfileWire> {
    const d = p ?? (await read(uid));
    const gp = (await points.get(uid))?.points ?? 0;
    return {
      stars: d.stars,
      parts: d.parts,
      gp,
      chars: d.chars,
      items: d.items,
      load: d.load,
      pity: d.pity,
      tickets: d.tickets,
      shop: d.shop.n,
      packs: d.packs,
      winToday: d.winDay === kstDay(now()),
      pass:
        d.pass && d.pass.until >= kstDay(now())
          ? { until: d.pass.until, today: d.pass.last === kstDay(now()), left: Math.round((Date.parse(d.pass.until) - Date.parse(kstDay(now()))) / DAY) + 1 }
          : null,
      games: d.games,
      wins: d.wins,
    };
  }

  /** 판에 들고 갈 것 (캐릭터가 없으면 null — 가챠부터) */
  async function loadoutOf(uid: string): Promise<Loadout | null> {
    const p = await read(uid);
    const c = p.load.char && p.chars[p.load.char] ? p.load.char : Object.keys(p.chars)[0];
    if (!c || !CHAR[c]) return null;
    const gear = (id: string | null) => (id && p.items[id] ? { id, lv: p.items[id].lv } : null);
    return { char: { id: c, lv: p.chars[c].lv }, dice: gear(p.load.dice), buddy: gear(p.load.buddy) };
  }

  const api = {
    wire,
    loadoutOf,

    async profile(uid: string) {
      return edit(uid, async (p) => {
        const got = claimPass(p);
        return { ...(await wire(uid, p)), ...(got && { passGot: { ...PASS_DAY } }) };
      });
    },

    /** 가챠: kind char | item · n 1 | 10 · ticket 이면 10연차 티켓 */
    async pull(uid: string, raw: unknown): Promise<{ got: (CharPull | ItemPull)[]; profile: ProfileWire }> {
      const o = z.object({ kind: z.enum(["char", "item"]), n: z.union([z.literal(1), z.literal(10)]), ticket: z.boolean().optional() }).parse(raw);
      return edit(uid, async (p) => {
        const G = GACHA[o.kind];
        if (o.ticket) {
          if (o.n !== 10) throw bad("티켓은 10연차예요.");
          if (p.tickets[o.kind] <= 0) throw new AppError("NO_TICKET", "티켓이 없어요.", 409);
          p.tickets[o.kind]--;
        } else {
          const cost = o.n === 10 ? G.ten : G.one;
          if (p.stars < cost) throw new AppError("NEED_STARS", `별사탕이 모자라요 (${cost} 필요).`, 409, { need: cost, have: p.stars });
          p.stars -= cost;
        }
        const got = o.kind === "char" ? pullChars(p, o.n, rand) : pullItems(p, o.n, rand);
        p.pulls[o.kind] += o.n;
        // 처음 얻은 캐릭터 · 아이템이면 바로 장착
        if (o.kind === "char" && !p.load.char) p.load.char = (got.find((x) => x.k === "char") as CharPull | undefined)?.id ?? null;
        if (o.kind === "item")
          for (const x of got)
            if (x.k === "item") {
              const slot = ITEM[x.id].slot;
              if (!p.load[slot]) p.load[slot] = x.id;
            }
        return { got, profile: await wire(uid, p) };
      });
    },

    async charUp(uid: string, raw: unknown) {
      const { id } = z.object({ id: z.string().max(40) }).parse(raw);
      return edit(uid, async (p) => {
        const c = p.chars[id];
        if (!c) throw bad("없는 캐릭터예요.");
        if (c.lv >= MAX_LV) throw bad("이미 최고 강화예요.");
        const need = charUpNeed(c.lv);
        if (c.dup < need) throw new AppError("NEED_DUP", `같은 카드가 ${need}장 필요해요.`, 409);
        c.dup -= need;
        c.lv++;
        return wire(uid, p);
      });
    },

    async itemUp(uid: string, raw: unknown) {
      const { id } = z.object({ id: z.string().max(40) }).parse(raw);
      return edit(uid, async (p) => {
        const it = p.items[id];
        const def = ITEM[id];
        if (!it || !def) throw bad("없는 아이템이에요.");
        if (it.lv >= MAX_LV) throw bad("이미 최고 강화예요.");
        const cost = itemUpCost(def.grade, it.lv);
        if (p.parts < cost) throw new AppError("NEED_PARTS", `부품이 ${cost}개 필요해요.`, 409);
        p.parts -= cost;
        it.lv++;
        return wire(uid, p);
      });
    },

    async equip(uid: string, raw: unknown) {
      const o = z.object({ char: z.string().max(40).optional(), dice: z.string().max(40).nullable().optional(), buddy: z.string().max(40).nullable().optional() }).parse(raw);
      return edit(uid, async (p) => {
        if (o.char !== undefined) {
          if (!p.chars[o.char]) throw bad("없는 캐릭터예요.");
          p.load.char = o.char;
        }
        for (const slot of ["dice", "buddy"] as const) {
          const v = o[slot];
          if (v === undefined) continue;
          if (v !== null && (!p.items[v] || ITEM[v]?.slot !== slot)) throw bad("장착할 수 없는 아이템이에요.");
          p.load[slot] = v;
        }
        return wire(uid, p);
      });
    },

    /** GP 상점 — GP 를 먼저 쓰고 (모자라면 여기서 멈춤) 받을 것을 넣음 */
    async buy(uid: string, raw: unknown, admin = false) {
      const { id } = z.object({ id: z.string().max(40) }).parse(raw);
      const it = storeItem(id);
      if (!it) throw bad("없는 상품이에요.");
      if (it.kind === "admin" && !admin) throw new AppError("FORBIDDEN", "관리자만 살 수 있어요.", 403);
      return edit(uid, async (p) => {
        if (it.once && (p.packs[id] ?? 0) >= 1) throw new AppError("SOLD_OUT", "이미 산 패키지예요.", 409);
        if (it.perWeek && (p.shop.n[id] ?? 0) >= it.perWeek) throw new AppError("SOLD_OUT", "이번 주에 살 수 있는 만큼 샀어요.", 409);
        if ((it.cost?.stars ?? 0) > p.stars) throw new AppError("NOT_ENOUGH", "별사탕이 모자라요.", 400);
        if ((it.cost?.parts ?? 0) > p.parts) throw new AppError("NOT_ENOUGH", "부품이 모자라요.", 400);
        if (it.gp > 0) await points.spend(uid, it.gp, "marble", `store:${id}`);
        p.stars -= it.cost?.stars ?? 0;
        p.parts -= it.cost?.parts ?? 0;
        if (it.once) p.packs[id] = (p.packs[id] ?? 0) + 1;
        if (it.perWeek) p.shop.n[id] = (p.shop.n[id] ?? 0) + 1;
        p.stars += it.give.stars ?? 0;
        p.parts += it.give.parts ?? 0;
        p.tickets.char += it.give.charTickets ?? 0;
        p.tickets.item += it.give.itemTickets ?? 0;
        if (it.give.passDays) addPass(p, it.give.passDays);
        if (it.give.gp) await points.grant(uid, it.give.gp, "marble", `store:${id}`);
        return wire(uid, p);
      });
    },

    /**
     * 판 끝 보상 (회원만). place 1 = 1등. 1:1 이면 이기면 60 · 지면 25, 3~4명이면 2등 40.
     * 오늘 첫 승리면 +100. 사이트 기록 users.stats.marble 도 같이 (업적).
     */
    async onMatch(uid: string, r: { place: number; n: number; how: string; lm: number; mono: boolean }): Promise<{ stars: number; first: boolean }> {
      const win = r.place === 1;
      const res = await edit(uid, (p) => {
        let s = win ? MATCH_STARS.win : r.n >= 3 && r.place === 2 ? Math.round((MATCH_STARS.win + MATCH_STARS.lose) / 2) : MATCH_STARS.lose;
        const today = kstDay(now());
        let first = false;
        if (win && p.winDay !== today) {
          p.winDay = today;
          s += MATCH_STARS.firstWinOfDay;
          first = true;
        }
        p.stars += s;
        p.games++;
        if (win) p.wins++;
        return { stars: s, first };
      });
      await users
        .updateOne(
          { _id: uid } as never,
          { $inc: { "stats.marble.games": 1, ...(win && { "stats.marble.wins": 1 }), ...(r.lm && { "stats.marble.lm": r.lm }), ...(win && r.mono && { "stats.marble.mono": 1 }) } } as never
        )
        .catch((e) => console.warn("[marble] 기록 저장 실패", e));
      return res;
    },

    /** (관리자) 초기화 */
    async reset(uid?: string) {
      if (uid) await col.deleteOne({ _id: uid } as never);
      else await col.deleteMany({});
    },
  };
  return api;
}

export { STORE };
