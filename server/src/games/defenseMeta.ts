import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import type { Database } from "../db";
import { AppError, bad } from "../errors";
import { KeyedMutex } from "../mutex";
import type { Points } from "../points";
import {
  CHEST,
  CORE_EXCHANGE,
  GLITCH_MAX,
  GLITCH_UNLOCK_WAVE,
  LV_COST,
  PASS,
  PASS_PREMIUM_GP,
  RELIC,
  RELICS,
  RELIC_CORE_PRICE,
  RES,
  RES_SLOTS,
  RELIC_SLOTS,
  THEME,
  UNIT_MAX_LV,
  WEEKLY_GP,
  WEEKLY_JOIN_GP,
  cleanLoadout,
  dailyOf,
  kstDayKey,
  runReward,
  seasonEnds,
  seasonOf,
  weekEnds,
  weekOf,
  weeklyOf,
  weeklyRelics,
  type Loadout,
  type PassReward,
  type QuestDef,
  type RunMode,
} from "../../../web/src/lib/defense/progress";
import { RECIPE, UNIT, UNITS } from "../../../web/src/lib/defense/units";
import type { Result } from "../../../web/src/lib/defense/sim";

/*
 * 픽셀 글리치 디펜스 — 판 밖 성장 (프로필 · 재화 · 미션 · 시즌 패스 · 주간 도전 GP).
 * 정의(수치)는 web/src/lib/defense/progress.ts. 여기선 저장 · 지급만.
 *
 * defense_profile (회원당 문서 하나, _id = uid). 바꾸는 일은 회원별 잠금 안에서 읽고 → 고치고 → 통째로 저장.
 * 판 보상은 defense.ts 가 기록을 다시 돌려 검증한 뒤에만 onRun 으로 넣음.
 * GP(사이트 포인트)는 points.spend / grant 로만 (원장에 남음).
 */

export interface Prog {
  key: string | number;
  prog: Record<string, number>;
  claimed: string[];
}
export interface Profile {
  _id: string;
  pieces: number;
  cores: number;
  chests: number;
  /** 유닛 카드 */
  cards: Record<string, number>;
  /** 유닛 레벨 */
  lv: Record<string, number>;
  /** 연 연구 */
  res: string[];
  /** 가진 유물 */
  relics: string[];
  /** 장착 (시즌 판 · 멀티에 들고 감) */
  load: { res: string[]; relics: string[]; glitch: number };
  /** 고를 수 있는 가장 높은 오염 단계 */
  glitchOpen: number;
  /** 클리어한 가장 높은 오염 단계 (-1 = 아직) — 업적 */
  glitchWin: number;
  theme: string;
  day: Prog;
  week: Prog;
  season: { id: number; xp: number; free: number[]; prem: number[]; premium: boolean };
  coreBuys: { w: number; n: number };
  /** 주간 도전 GP 를 확인한 마지막 주 */
  paidWeek: number;
  runs: number;
  at: Date;
}

/** 판 하나에서 미션이 보는 숫자 */
export interface RunStats {
  made: Record<string, number>;
  rifts: number;
}

/** 시작 선물 */
const STARTER = { pieces: 300, chests: 1 };

const DAY_MS = 86_400_000;

export function weeklySeed(week: number): number {
  const secret = process.env.DEFENSE_SECRET ?? process.env.SESSION_SECRET ?? "pixel-glitch-defense";
  const h = createHash("sha256").update(`${secret}:weekly:${week}`).digest();
  return (h.readUInt32BE(0) % (2 ** 31 - 2)) + 1;
}
export const weeklyLoadout = (week: number): Loadout => ({ relics: weeklyRelics(week), glitch: 0 });

/** 미션 숫자 (판 하나) */
export function questValues(mode: RunMode, res: Result, st: RunStats, players: number): Record<QuestDef["metric"], number> {
  let legend = 0,
    myth = 0,
    recipe = 0;
  const fac = { knight: 0, mech: 0, arcane: 0 };
  for (const [id, n] of Object.entries(st.made)) {
    const u = UNIT[id];
    if (!u) continue;
    if (u.grade === 3) legend += n;
    if (u.grade >= 4) myth += n;
    if (RECIPE[id]) recipe += n;
    if (u.faction !== "hidden") fac[u.faction] += n;
  }
  return {
    runs: 1,
    wave: res.wave,
    bosses: Math.floor(Math.min(res.wave - (res.win ? 0 : 1), 60) / 10),
    legend,
    myth,
    recipe,
    knight: fac.knight,
    mech: fac.mech,
    arcane: fac.arcane,
    rift: st.rifts,
    win: res.win ? 1 : 0,
    multi: mode === "multi" && players > 1 ? 1 : 0,
  };
}

/** 패스 단계 (xp 로) */
export const passTier = (xp: number) => PASS.filter((t) => xp >= t.xp).length;

export type DefenseMeta = ReturnType<typeof createDefenseMeta>;

export function createDefenseMeta(db: Database, points: Points, now: () => number = Date.now) {
  const col = db.col<Profile>("defense_profile");
  const users = db.col("users");
  const ranks = db.col<{ ver: string; uid: string; score: number }>("defense_rank");
  const lock = new KeyedMutex();
  const unitIds = new Set(UNITS.map((u) => u.id));

  const fresh = (uid: string): Profile => {
    const t = now();
    return {
      _id: uid,
      pieces: STARTER.pieces,
      cores: 0,
      chests: STARTER.chests,
      cards: {},
      lv: {},
      res: [],
      relics: [],
      load: { res: [], relics: [], glitch: 0 },
      glitchOpen: 0,
      glitchWin: -1,
      theme: "theme.base",
      day: { key: kstDayKey(t), prog: {}, claimed: [] },
      week: { key: weekOf(t), prog: {}, claimed: [] },
      season: { id: seasonOf(t), xp: 0, free: [], prem: [], premium: false },
      coreBuys: { w: weekOf(t), n: 0 },
      paidWeek: weekOf(t) - 1,
      runs: 0,
      at: new Date(t),
    };
  };

  /** 날 · 주 · 시즌이 바뀌었으면 새로 */
  const roll = (p: Profile) => {
    const t = now();
    const d = kstDayKey(t);
    const w = weekOf(t);
    const s = seasonOf(t);
    if (p.day.key !== d) p.day = { key: d, prog: {}, claimed: [] };
    if (p.week.key !== w) p.week = { key: w, prog: {}, claimed: [] };
    if (p.season.id !== s) p.season = { id: s, xp: 0, free: [], prem: [], premium: false };
    if (p.coreBuys.w !== w) p.coreBuys = { w, n: 0 };
    return p;
  };

  const load = async (uid: string) => {
    const d = await col.findOne({ _id: uid });
    return roll(d ? { ...fresh(uid), ...d } : fresh(uid));
  };
  const save = (p: Profile) => col.replaceOne({ _id: p._id }, { ...p, at: new Date(now()) }, { upsert: true });

  /** 회원별 차례로: 읽고 → fn 이 고치고 → 저장 */
  const edit = <R>(uid: string, fn: (p: Profile) => Promise<R> | R) =>
    lock.run(`dp:${uid}`, async () => {
      const p = await load(uid);
      const r = await fn(p);
      await save(p);
      return r;
    });

  const inv = async (uid: string) => {
    const d = (await users.findOne({ _id: uid }, { projection: { "inv.defense": 1, points: 1 } })) as { inv?: { defense?: string[] }; points?: number } | null;
    return { items: d?.inv?.defense ?? [], points: d?.points ?? 0 };
  };

  const need = (ok: boolean, msg: string) => {
    if (!ok) throw new AppError("NEED", msg, 409);
  };

  /** 패스 · 미션 보상 넣기 (GP · 꾸미기는 프로필 밖이라 따로) */
  async function give(uid: string, p: Profile, r: PassReward & { xp?: number }, ref: string) {
    p.pieces += r.pieces ?? 0;
    p.cores += r.cores ?? 0;
    p.chests += r.chest ?? 0;
    if (r.xp) p.season.xp += r.xp;
    if (r.gp) await points.grant(uid, r.gp, "defense", ref);
    if (r.item) await users.updateOne({ _id: uid } as never, { $addToSet: { "inv.defense": r.item } } as never);
  }

  /** 주간 도전 순위 GP: 지난주 기록이 있으면 한 번만 */
  async function payWeekly(uid: string, p: Profile) {
    const last = weekOf(now()) - 1;
    if (p.paidWeek >= last) return null;
    p.paidWeek = last;
    const key = weeklyKey(last);
    const mine = await ranks.findOne({ _id: `${key}:${uid}` } as never);
    if (!mine) return null;
    const rank = (await ranks.countDocuments({ ver: key, score: { $gt: mine.score } })) + 1;
    const gp = (WEEKLY_GP.find((x) => rank <= x.upTo)?.gp ?? 0) + WEEKLY_JOIN_GP;
    // 프로필(paidWeek)을 먼저 저장한 뒤 지급 — 저장 실패로 두 번 받는 일이 없게
    await save(p);
    await points.grant(uid, gp, "defense", `weekly:${last}:${rank}`);
    return { week: last, rank, gp };
  }

  const questsOf = (p: Profile) => {
    const t = now();
    const row = (q: QuestDef, pr: Prog) => ({ ...q, value: Math.min(q.goal, pr.prog[q.metric] ?? 0), claimed: pr.claimed.includes(q.id) });
    return { daily: dailyOf(t).map((q) => row(q, p.day)), weekly: weeklyOf(t).map((q) => row(q, p.week)) };
  };

  async function wire(uid: string, p: Profile, extra?: Record<string, unknown>) {
    const t = now();
    const w = weekOf(t);
    const { items, points: gp } = await inv(uid);
    const { _id, at: _at, ...rest } = p;
    return {
      ...rest,
      quests: questsOf(p),
      passTier: passTier(p.season.xp),
      themes: ["theme.base", ...items.filter((i) => THEME[i])],
      gp,
      week: { n: w, ends: weekEnds(w), relics: weeklyRelics(w) },
      seasonEnds: seasonEnds(p.season.id),
      dayEnds: Math.floor((t + 9 * 3600_000) / DAY_MS + 1) * DAY_MS - 9 * 3600_000,
      ...extra,
    };
  }
  type Wire = Awaited<ReturnType<typeof wire>>;

  const weeklyKey = (w: number) => `w${w}`;

  return {
    weeklyKey,
    /** 시즌 판 · 멀티에 들고 갈 로드아웃 (서버가 정함) */
    async loadoutOf(uid: string): Promise<Required<Loadout>> {
      const p = await load(uid);
      const lv = Object.fromEntries(Object.entries(p.lv).filter(([, v]) => v > 0));
      return cleanLoadout({ lv, res: p.load.res.filter((r) => p.res.includes(r)), relics: p.load.relics.filter((r) => p.relics.includes(r)), glitch: Math.min(p.load.glitch, p.glitchOpen) }, unitIds);
    },

    async profile(uid: string): Promise<Wire> {
      return lock.run(`dp:${uid}`, async () => {
        const p = await load(uid);
        const paid = await payWeekly(uid, p);
        await save(p);
        return wire(uid, p, { paid });
      });
    },

    /** 검증된 판 하나 → 보상 · 미션 · 패스 경험치 · 오염 단계 열기 */
    async onRun(uid: string, mode: RunMode, res: Result, st: RunStats, glitch: number, players = 1) {
      return edit(uid, (p) => {
        const grades = Object.fromEntries(Object.keys(st.made).map((id) => [id, UNIT[id]?.grade ?? 0]));
        const rw = runReward(mode === "multi" && players < 2 ? "season" : mode, res, st.made, grades, glitch);
        p.pieces += rw.pieces;
        p.cores += rw.cores;
        for (const [id, n] of Object.entries(rw.cards)) if (unitIds.has(id)) p.cards[id] = (p.cards[id] ?? 0) + n;
        p.season.xp += rw.xp;
        p.runs++;
        const qv = questValues(mode, res, st, players);
        for (const pr of [p.day, p.week])
          for (const [k, v] of Object.entries(qv)) {
            if (!v) continue;
            pr.prog[k] = k === "wave" ? Math.max(pr.prog[k] ?? 0, v) : (pr.prog[k] ?? 0) + v;
          }
        let opened = false;
        if (mode !== "weekly") {
          if (res.win) p.glitchWin = Math.max(p.glitchWin, glitch);
          if ((res.win || res.wave >= GLITCH_UNLOCK_WAVE) && glitch >= p.glitchOpen && p.glitchOpen < GLITCH_MAX) {
            p.glitchOpen = glitch + 1;
            opened = true;
          }
        }
        return { ...rw, opened: opened ? p.glitchOpen : null, passTier: passTier(p.season.xp) };
      });
    },

    unitUp(uid: string, id: string) {
      return edit(uid, async (p) => {
        if (!unitIds.has(id)) throw bad("없는 유닛이에요.");
        const lv = p.lv[id] ?? 0;
        need(lv < UNIT_MAX_LV, "이미 최고 레벨이에요.");
        const c = LV_COST[lv];
        need((p.cards[id] ?? 0) >= c.cards, "카드가 모자라요.");
        need(p.pieces >= c.pieces, "픽셀 조각이 모자라요.");
        p.cards[id] -= c.cards;
        p.pieces -= c.pieces;
        p.lv[id] = lv + 1;
        return wire(uid, p);
      });
    },

    resBuy(uid: string, id: string) {
      return edit(uid, async (p) => {
        const r = RES[id];
        if (!r) throw bad("없는 연구예요.");
        need(!p.res.includes(id), "이미 연 연구예요.");
        need(p.pieces >= r.cost, "픽셀 조각이 모자라요.");
        p.pieces -= r.cost;
        p.res.push(id);
        if (p.load.res.length < RES_SLOTS) p.load.res.push(id);
        return wire(uid, p);
      });
    },

    relicBuy(uid: string, id: string) {
      return edit(uid, async (p) => {
        const r = RELIC[id];
        if (!r) throw bad("없는 유물이에요.");
        need(!p.relics.includes(id), "이미 가진 유물이에요.");
        const price = RELIC_CORE_PRICE[r.tier];
        need(p.cores >= price, "글리치 코어가 모자라요.");
        p.cores -= price;
        p.relics.push(id);
        if (p.load.relics.length < RELIC_SLOTS) p.load.relics.push(id);
        return wire(uid, p);
      });
    },

    chestBuy(uid: string) {
      return edit(uid, async (p) => {
        need(p.pieces >= CHEST.price, "픽셀 조각이 모자라요.");
        p.pieces -= CHEST.price;
        p.chests++;
        return wire(uid, p);
      });
    },

    chestOpen(uid: string) {
      return edit(uid, async (p) => {
        need(p.chests >= 1, "상자가 없어요.");
        p.chests--;
        const roll = randomInt(0, 1_000_000) / 1_000_000;
        let got: { relic?: string; dup?: number; cards?: Record<string, number> };
        if (roll < CHEST.relicChance) {
          const tr = randomInt(0, 1_000_000) / 1_000_000;
          const tier = tr < CHEST.tierOdds[0] ? 0 : tr < CHEST.tierOdds[0] + CHEST.tierOdds[1] ? 1 : 2;
          const pool = RELICS.filter((r) => r.tier === tier);
          const pick = pool[randomInt(0, pool.length)];
          if (p.relics.includes(pick.id)) {
            p.cores += CHEST.dupCores;
            got = { relic: pick.id, dup: CHEST.dupCores };
          } else {
            p.relics.push(pick.id);
            if (p.load.relics.length < RELIC_SLOTS) p.load.relics.push(pick.id);
            got = { relic: pick.id };
          }
        } else {
          // 카드 묶음: 등급이 낮을수록 잘 나옴 (히든 제외)
          const pool = UNITS.filter((u) => u.faction !== "hidden" && u.grade <= 4);
          const wsum = pool.reduce((s, u) => s + (5 - u.grade), 0);
          const cards: Record<string, number> = {};
          for (let i = 0; i < CHEST.cards; i++) {
            let r = randomInt(0, wsum);
            const u = pool.find((x) => (r -= 5 - x.grade) < 0)!;
            cards[u.id] = (cards[u.id] ?? 0) + 1;
          }
          for (const [id, n] of Object.entries(cards)) p.cards[id] = (p.cards[id] ?? 0) + n;
          got = { cards };
        }
        return wire(uid, p, { got });
      });
    },

    setLoad(uid: string, raw: unknown) {
      const v = z.object({ res: z.array(z.string()).max(RES_SLOTS), relics: z.array(z.string()).max(RELIC_SLOTS), glitch: z.number().int().min(0).max(GLITCH_MAX) }).parse(raw);
      return edit(uid, async (p) => {
        need(v.res.every((r) => p.res.includes(r)), "열지 않은 연구가 있어요.");
        need(v.relics.every((r) => p.relics.includes(r)), "없는 유물이 있어요.");
        need(v.glitch <= p.glitchOpen, "아직 열리지 않은 오염 단계예요.");
        p.load = { res: [...new Set(v.res)], relics: [...new Set(v.relics)], glitch: v.glitch };
        return wire(uid, p);
      });
    },

    setTheme(uid: string, id: string) {
      return edit(uid, async (p) => {
        if (!THEME[id]) throw bad("없는 테마예요.");
        if (id !== "theme.base") need((await inv(uid)).items.includes(id), "아직 없는 테마예요.");
        p.theme = id;
        return wire(uid, p);
      });
    },

    questClaim(uid: string, id: string) {
      return edit(uid, async (p) => {
        const t = now();
        const d = dailyOf(t).find((q) => q.id === id);
        const w = weeklyOf(t).find((q) => q.id === id);
        const q = d ?? w;
        if (!q) throw bad("지금 미션이 아니에요.");
        const pr = d ? p.day : p.week;
        need(!pr.claimed.includes(id), "이미 받았어요.");
        need((pr.prog[q.metric] ?? 0) >= q.goal, "아직 다 못 했어요.");
        pr.claimed.push(id);
        await give(uid, p, { pieces: q.pieces, cores: q.cores, xp: q.xp }, `quest:${id}`);
        return wire(uid, p);
      });
    },

    /** 받을 수 있는 패스 보상을 모두 */
    passClaim(uid: string) {
      return edit(uid, async (p) => {
        const tier = passTier(p.season.xp);
        let n = 0;
        for (let i = 0; i < tier; i++) {
          if (!p.season.free.includes(i)) {
            p.season.free.push(i);
            await give(uid, p, PASS[i].free, `pass:${p.season.id}:${i}`);
            n++;
          }
          if (p.season.premium && !p.season.prem.includes(i)) {
            p.season.prem.push(i);
            await give(uid, p, PASS[i].premium, `pass+:${p.season.id}:${i}`);
            n++;
          }
        }
        need(n > 0, "받을 보상이 없어요.");
        return wire(uid, p);
      });
    },

    passBuy(uid: string) {
      return edit(uid, async (p) => {
        need(!p.season.premium, "이미 프리미엄이에요.");
        await points.spend(uid, PASS_PREMIUM_GP, "defense", `pass:${p.season.id}`);
        p.season.premium = true;
        return wire(uid, p);
      });
    },

    coresBuy(uid: string) {
      return edit(uid, async (p) => {
        need(p.coreBuys.n < CORE_EXCHANGE.maxPerWeek, "이번 주 교환을 다 했어요.");
        await points.spend(uid, CORE_EXCHANGE.gp, "defense", "cores");
        p.coreBuys.n++;
        p.cores += CORE_EXCHANGE.cores;
        return wire(uid, p);
      });
    },
  };
}
