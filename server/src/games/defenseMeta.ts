import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import type { Database } from "../db";
import { AppError, bad } from "../errors";
import { KeyedMutex } from "../mutex";
import type { Points } from "../points";
import {
  BENCH_BASE,
  BENCH_COST,
  BENCH_MAX,
  BOX,
  FRES_COST,
  FRES_MAX,
  TRANS_IDS,
  CORE_EXCHANGE,
  GLITCH_MAX,
  GP_SHOP,
  glitchUnlocks,
  FIRST_RUN_MULT,
  collectReward,
  glitchFirstClear,
  lvCost,
  planUpAll,
  RES_MAX_LV,
  RELIC_MAX_LV,
  resUpCost,
  relicUpCost,
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
  /** 안 연 상자 (카드 상자 · 유물 상자) */
  boxes: { card: number; relic: number };
  /** 유물 조각 (같은 유물이 또 나오면 +1 — 유물 강화 재료) */
  shards: Record<string, number>;
  /** 해금한 초월 */
  trans: string[];
  /** 열린 보관함 칸 · 산 세력 전용 연구칸 */
  bench: number;
  fslots: number;
  /** 유닛 카드 */
  cards: Record<string, number>;
  /** 유닛 레벨 */
  lv: Record<string, number>;
  /** 연 연구 */
  res: string[];
  /** 가진 유물 */
  relics: string[];
  /** 연구 레벨 (없으면 1) */
  resLv?: Record<string, number>;
  /** 유물 레벨 (없으면 1) */
  relicLv?: Record<string, number>;
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
  /** 이번 주 GP 상점 산 횟수 */
  gpBuys: { w: number; relic: number; cards: number; trans: number };
  /** 한 번이라도 얻은 유닛 (도감 수집 보상) */
  seen: string[];
  /** 오늘 첫 판 보너스를 받은 날 */
  firstDay: string;
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
const STARTER = { pieces: 300, boxes: { card: 1, relic: 1 } };

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
      boxes: { ...STARTER.boxes },
      shards: {},
      trans: [],
      bench: BENCH_BASE,
      fslots: 0,
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
      seen: [],
      firstDay: "",
      gpBuys: { w: weekOf(t), relic: 0, cards: 0, trans: 0 },
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
    if (!p.gpBuys || p.gpBuys.w !== w) p.gpBuys = { w, relic: 0, cards: 0, trans: 0 };
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
    p.boxes.card += r.cardBox ?? 0;
    p.boxes.relic += r.relicBox ?? 0;
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

  /** 카드 상자 하나: 등급이 낮을수록 잘 나옴 (히든 · 초월 제외) */
  const openCards = (p: Profile) => {
    const pool = UNITS.filter((u) => u.faction !== "hidden" && u.grade <= 4);
    const wsum = pool.reduce((s, u) => s + (5 - u.grade), 0);
    const cards: Record<string, number> = {};
    for (let i = 0; i < BOX.card.n; i++) {
      let r = randomInt(0, wsum);
      const u = pool.find((x) => (r -= 5 - x.grade) < 0)!;
      cards[u.id] = (cards[u.id] ?? 0) + 1;
    }
    for (const [id, n] of Object.entries(cards)) p.cards[id] = (p.cards[id] ?? 0) + n;
    return { cards };
  };
  /** 유물 하나: 희귀도 → 그 안에서 무작위. 가진 것이면 유물 조각 +1 */
  const openRelic = (p: Profile, odds: readonly number[]) => {
    const tr = randomInt(0, 1_000_000) / 1_000_000;
    const tier = tr < odds[0] ? 0 : tr < odds[0] + odds[1] ? 1 : 2;
    const pool = RELICS.filter((r) => r.tier === tier);
    const pick = pool[randomInt(0, pool.length)];
    if (p.relics.includes(pick.id)) {
      p.shards[pick.id] = (p.shards[pick.id] ?? 0) + 1;
      return { relic: pick.id, shard: 1 };
    }
    p.relics.push(pick.id);
    if (p.load.relics.length < RELIC_SLOTS) p.load.relics.push(pick.id);
    return { relic: pick.id };
  };

  return {
    weeklyKey,
    /** 시즌 판 · 멀티에 들고 갈 로드아웃 (서버가 정함) */
    async loadoutOf(uid: string): Promise<Required<Loadout>> {
      const p = await load(uid);
      const lv = Object.fromEntries(Object.entries(p.lv).filter(([, v]) => v > 0));
      const own = Object.fromEntries(p.relics.map((id) => [id, p.relicLv?.[id] ?? 1]));
      return cleanLoadout(
        {
          lv,
          res: p.load.res.filter((r) => p.res.includes(r)),
          relics: p.load.relics.filter((r) => p.relics.includes(r)),
          glitch: Math.min(p.load.glitch, p.glitchOpen),
          resLv: p.resLv,
          relicLv: p.relicLv,
          bench: p.bench,
          fslots: p.fslots,
          own,
          trans: p.trans,
        },
        unitIds
      );
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
        // 오늘 첫 판: 조각 ×2
        const today = kstDayKey(now());
        const first = p.firstDay !== today;
        if (first) {
          p.firstDay = today;
          rw.pieces *= FIRST_RUN_MULT;
        }
        // 처음 얻은 유닛 (도감 수집)
        const fresh: string[] = [];
        for (const id of Object.keys(st.made).sort()) {
          if (!unitIds.has(id) || p.seen.includes(id)) continue;
          p.seen.push(id);
          const cr = collectReward(UNIT[id].grade);
          if (!cr) continue;
          fresh.push(id);
          rw.pieces += cr.pieces;
          rw.cores += cr.cores ?? 0;
        }
        // 오염 단계 첫 클리어
        let firstClear: { glitch: number; cores: number; relicBox: number } | null = null;
        if (mode !== "weekly" && res.win && glitch > p.glitchWin) {
          const fc = glitchFirstClear(glitch);
          firstClear = { glitch, ...fc };
          rw.cores += fc.cores;
          p.boxes.relic += fc.relicBox;
        }
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
          if (glitchUnlocks(glitch, res) && glitch >= p.glitchOpen && p.glitchOpen < GLITCH_MAX) {
            p.glitchOpen = glitch + 1;
            opened = true;
          }
        }
        return { ...rw, opened: opened ? p.glitchOpen : null, passTier: passTier(p.season.xp), first, fresh, firstClear };
      });
    },

    unitUp(uid: string, id: string) {
      return edit(uid, async (p) => {
        if (!unitIds.has(id)) throw bad("없는 유닛이에요.");
        const lv = p.lv[id] ?? 0;
        need(lv < UNIT_MAX_LV, "이미 최고 레벨이에요.");
        const c = lvCost(UNIT[id].grade, lv);
        need((p.cards[id] ?? 0) >= c.cards, "카드가 모자라요.");
        need(p.pieces >= c.pieces, "픽셀 조각이 모자라요.");
        p.cards[id] -= c.cards;
        p.pieces -= c.pieces;
        p.lv[id] = lv + 1;
        return wire(uid, p);
      });
    },

    /** 일괄 강화 — id 가 있으면 그 유닛만 최대한, 없으면 모든 유닛을 고르게 (planUpAll) */
    unitUpAll(uid: string, id?: string) {
      return edit(uid, async (p) => {
        if (id && !unitIds.has(id)) throw bad("없는 유닛이에요.");
        const pool = id ? [UNIT[id]] : UNITS;
        const plan = planUpAll(pool, p.lv, p.cards, p.pieces);
        need(plan.n > 0, "지금 올릴 수 있는 유닛이 없어요.");
        for (const [k, n] of Object.entries(plan.ups)) {
          p.lv[k] = (p.lv[k] ?? 0) + n;
          p.cards[k] -= plan.cards[k];
        }
        p.pieces -= plan.pieces;
        return { ...(await wire(uid, p)), ups: plan.n };
      });
    },

    /** 레벨 내리기 — 그 레벨에 쓴 카드 · 조각을 모두 돌려줌 (여러 조합을 시험해 보게) */
    unitDown(uid: string, id: string) {
      return edit(uid, async (p) => {
        if (!unitIds.has(id)) throw bad("없는 유닛이에요.");
        const lv = p.lv[id] ?? 0;
        need(lv > 0, "이미 0레벨이에요.");
        const c = lvCost(UNIT[id].grade, lv - 1);
        p.cards[id] = (p.cards[id] ?? 0) + c.cards;
        p.pieces += c.pieces;
        if (lv - 1 > 0) p.lv[id] = lv - 1;
        else delete p.lv[id];
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
        const general = (x: string) => RES[x]?.group === "general";
        const used = p.load.res.filter((x) => general(x) === general(id)).length;
        if (used < (general(id) ? RES_SLOTS : p.fslots)) p.load.res.push(id);
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

    /** 연구 레벨 올리기 (조각) · 내리기 (쓴 조각 전부 돌려받기) */
    resLevel(uid: string, id: string, dir: 1 | -1) {
      return edit(uid, async (p) => {
        need(!!RES[id] && p.res.includes(id), "연 연구만 올릴 수 있어요.");
        p.resLv ??= {};
        const lv = p.resLv[id] ?? 1;
        if (dir > 0) {
          need(lv < RES_MAX_LV, "이미 최고 레벨이에요.");
          const c = resUpCost(id, lv);
          need(p.pieces >= c, "픽셀 조각이 모자라요.");
          p.pieces -= c;
          p.resLv[id] = lv + 1;
        } else {
          need(lv > 1, "이미 1레벨이에요.");
          p.pieces += resUpCost(id, lv - 1);
          if (lv - 1 > 1) p.resLv[id] = lv - 1;
          else delete p.resLv[id];
        }
        return wire(uid, p);
      });
    },

    /** 유물 레벨 올리기 (유물 조각 + 글리치 코어) · 내리기 (쓴 것 전부 돌려받기) */
    relicLevel(uid: string, id: string, dir: 1 | -1) {
      return edit(uid, async (p) => {
        need(!!RELIC[id] && p.relics.includes(id), "가진 유물만 올릴 수 있어요.");
        p.relicLv ??= {};
        const lv = p.relicLv[id] ?? 1;
        if (dir > 0) {
          need(lv < RELIC_MAX_LV, "이미 최고 레벨이에요.");
          const c = relicUpCost(id, lv);
          need((p.shards[id] ?? 0) >= c.shards, "유물 조각이 모자라요 (유물 상자에서 같은 유물이 나오면 생겨요).");
          need(p.cores >= c.cores, "글리치 코어가 모자라요.");
          p.shards[id] -= c.shards;
          p.cores -= c.cores;
          p.relicLv[id] = lv + 1;
        } else {
          need(lv > 1, "이미 1레벨이에요.");
          const c = relicUpCost(id, lv - 1);
          p.shards[id] = (p.shards[id] ?? 0) + c.shards;
          p.cores += c.cores;
          if (lv - 1 > 1) p.relicLv[id] = lv - 1;
          else delete p.relicLv[id];
        }
        return wire(uid, p);
      });
    },

    /** 보관함 칸 하나 해금 (픽셀 조각) */
    benchBuy(uid: string) {
      return edit(uid, async (p) => {
        need(p.bench < BENCH_MAX, "보관함을 다 열었어요.");
        const c = BENCH_COST[p.bench - BENCH_BASE];
        need(p.pieces >= c, "픽셀 조각이 모자라요.");
        p.pieces -= c;
        p.bench++;
        return wire(uid, p);
      });
    },

    /** 세력 전용 연구칸 하나 (글리치 코어) */
    fslotBuy(uid: string) {
      return edit(uid, async (p) => {
        need(p.fslots < FRES_MAX, "세력 연구칸을 다 샀어요.");
        const c = FRES_COST[p.fslots];
        need(p.cores >= c, "글리치 코어가 모자라요.");
        p.cores -= c;
        p.fslots++;
        return wire(uid, p);
      });
    },

    /** 상자 사기: card (조각) · relic (코어) */
    boxBuy(uid: string, kind: "card" | "relic") {
      return edit(uid, async (p) => {
        if (kind === "card") {
          need(p.pieces >= BOX.card.pieces, "픽셀 조각이 모자라요.");
          p.pieces -= BOX.card.pieces;
          p.boxes.card++;
        } else {
          need(p.cores >= BOX.relic.cores, "글리치 코어가 모자라요.");
          p.cores -= BOX.relic.cores;
          p.boxes.relic++;
        }
        return wire(uid, p);
      });
    },

    /** 상자 열기 (가진 것 하나) */
    boxOpen(uid: string, kind: "card" | "relic") {
      return edit(uid, async (p) => {
        need(p.boxes[kind] >= 1, "상자가 없어요.");
        p.boxes[kind]--;
        const got = kind === "card" ? openCards(p) : openRelic(p, BOX.relic.tierOdds);
        return wire(uid, p, { got });
      });
    },

    /** GP 유물 상자 (주 3번, 좋은 확률 · 바로 열림) */
    gpRelic(uid: string) {
      return edit(uid, async (p) => {
        need(p.gpBuys.relic < BOX.relic.gpPerWeek, "이번 주 GP 유물 상자를 다 샀어요.");
        await points.spend(uid, BOX.relic.gp, "defense", "gprelic");
        p.gpBuys.relic++;
        return wire(uid, p, { got: openRelic(p, BOX.relic.gpOdds) });
      });
    },

    /** 초월 소환: 코어 또는 GP (주 2번) */
    transSummon(uid: string, pay: "cores" | "gp") {
      return edit(uid, async (p) => {
        if (pay === "cores") {
          need(p.cores >= BOX.trans.cores, "글리치 코어가 모자라요.");
          p.cores -= BOX.trans.cores;
        } else {
          need(p.gpBuys.trans < BOX.trans.gpPerWeek, "이번 주 GP 초월 소환을 다 했어요.");
          await points.spend(uid, BOX.trans.gp, "defense", "gptrans");
          p.gpBuys.trans++;
        }
        const id = TRANS_IDS[randomInt(0, TRANS_IDS.length)];
        let got: { trans: string; dup?: number };
        if (!p.trans.includes(id)) {
          p.trans.push(id);
          got = { trans: id };
        } else {
          p.cards[id] = (p.cards[id] ?? 0) + BOX.trans.dupCards;
          got = { trans: id, dup: BOX.trans.dupCards };
        }
        return wire(uid, p, { got });
      });
    },

    setLoad(uid: string, raw: unknown) {
      const v = z.object({ res: z.array(z.string()).max(RES_SLOTS + FRES_MAX), relics: z.array(z.string()).max(RELIC_SLOTS), glitch: z.number().int().min(0).max(GLITCH_MAX) }).parse(raw);
      return edit(uid, async (p) => {
        need(v.res.every((r) => p.res.includes(r)), "열지 않은 연구가 있어요.");
        const gen = v.res.filter((r) => RES[r]?.group === "general").length;
        need(gen <= RES_SLOTS, `공용 연구는 ${RES_SLOTS}칸까지예요.`);
        need(v.res.length - gen <= p.fslots, "세력 연구칸이 모자라요 (정비소에서 살 수 있어요).");
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

    /** GP 카드 묶음: 고른 유닛 카드 10장 */
    gpCards(uid: string, id: string) {
      return edit(uid, async (p) => {
        if (!unitIds.has(id)) throw bad("없는 유닛이에요.");
        need(p.gpBuys.cards < GP_SHOP.cards.perWeek, "이번 주 카드 묶음을 다 샀어요.");
        await points.spend(uid, GP_SHOP.cards.gp, "defense", `gpcards:${id}`);
        p.gpBuys.cards++;
        p.cards[id] = (p.cards[id] ?? 0) + GP_SHOP.cards.n;
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
