import { randomInt } from "node:crypto";
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
  GLITCH_MAX,
  CHEAT_RES_OF,
  GP_PACKS,
  GRIT_MAX,
  GP_SELL,
  GP_STORE,
  PACK,
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
  relicShardsToMax,
  RELIC_DUP_CORES,
  PASS,
  PASS_PREMIUM_GP,
  RELIC,
  RELICS,
  RES,
  RES_SLOTS,
  RELIC_SLOTS,
  THEME,
  UNIT_MAX_LV,
  cleanLoadout,
  dailyOf,
  kstDayKey,
  runReward,
  seasonEnds,
  seasonOf,
  weekEnds,
  weekOf,
  weeklyOf,
  transRoll,
  type Goods,
  type Loadout,
  type PassReward,
  type QuestDef,
  type RunMode,
} from "../../../web/src/lib/defense/progress";
import { RECIPE, UNIT, UNITS } from "../../../web/src/lib/defense/units";
import type { Result } from "../../../web/src/lib/defense/sim";

/*
 * 픽셀 글리치 디펜스 — 판 밖 성장 (프로필 · 재화 · 미션 · 시즌 패스 · 상점: 재화샵 · 재화 → GP · 패키지).
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
  boxes: { card: number; relic: number; trans?: number };
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
  load: { res: string[]; relics: string[]; glitch: number; cheat?: string };
  /** 산 치트 연구 (CHEAT_RES id) — 한 번 사면 계속 */
  cheatRes?: string[];
  /** 고를 수 있는 가장 높은 오염 단계 */
  glitchOpen: number;
  /** 클리어한 가장 높은 오염 단계 (-1 = 아직) — 업적 */
  glitchWin: number;
  theme: string;
  day: Prog;
  week: Prog;
  season: { id: number; xp: number; free: number[]; prem: number[]; premium: boolean };
  /** 이번 주 상점(재화샵 · 재화 판매 · 주간 패키지) 산 횟수 (id → 수) */
  shop: { w: number; n: Record<string, number> };
  /** 오늘 산 일일 패키지 (id → 수) */
  shopDay?: { d: string; n: Record<string, number> };
  /** 한 번만 사는 패키지를 산 것 (id → 수) */
  packs: Record<string, number>;
  /** 초월 소환 천장 — 마지막 초월 뒤로 돌린 수 */
  pity: number;
  /** 끈기: 가장 높은 오염 단계 g 에서 연달아 진 판 수 */
  grit?: { g: number; n: number };
  /** 한 번이라도 얻은 유닛 (도감 수집 보상) */
  seen: string[];
  /** 오늘 첫 판 보너스를 받은 날 */
  firstDay: string;
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

/** 이 단계로 시작하면 받을 끈기 판 수 (가장 높은 열린 단계 · 아직 못 깬 단계일 때만) */
export const gritOf = (p: Pick<Profile, "grit" | "glitchOpen" | "glitchWin">, glitch: number) =>
  glitch === p.glitchOpen && glitch > p.glitchWin && p.grit?.g === glitch ? p.grit.n : 0;

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
      load: { res: [], relics: [], glitch: 0, cheat: "" },
      cheatRes: [],
      glitchOpen: 0,
      glitchWin: -1,
      theme: "theme.base",
      day: { key: kstDayKey(t), prog: {}, claimed: [] },
      week: { key: weekOf(t), prog: {}, claimed: [] },
      season: { id: seasonOf(t), xp: 0, free: [], prem: [], premium: false },
      shop: { w: weekOf(t), n: {} },
      packs: {},
      pity: 0,
      seen: [],
      firstDay: "",
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
    if (!p.shop || p.shop.w !== w) p.shop = { w, n: {} };
    p.boxes.trans ??= 0;
    if (!p.shopDay || p.shopDay.d !== d) p.shopDay = { d, n: {} };
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
      week: { n: w, ends: weekEnds(w) },
      seasonEnds: seasonEnds(p.season.id),
      dayEnds: Math.floor((t + 9 * 3600_000) / DAY_MS + 1) * DAY_MS - 9 * 3600_000,
      ...extra,
    };
  }
  type Wire = Awaited<ReturnType<typeof wire>>;

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
      // 최고 레벨까지 쓸 조각이 이미 있으면 (쓸모없는 조각 대신) 글리치 코어
      if ((p.shards[pick.id] ?? 0) >= relicShardsToMax(pick.id, p.relicLv?.[pick.id] ?? 1)) {
        const cores = RELIC_DUP_CORES[pick.tier];
        p.cores += cores;
        return { relic: pick.id, cores };
      }
      p.shards[pick.id] = (p.shards[pick.id] ?? 0) + 1;
      return { relic: pick.id, shard: 1 };
    }
    p.relics.push(pick.id);
    if (p.load.relics.length < RELIC_SLOTS) p.load.relics.push(pick.id);
    return { relic: pick.id };
  };

  /** 상점에서 받는 것 넣기 (초월 소환은 초월 상자로 — 상점 「상자 · 소환」 탭에서 열어요) */
  async function grantGoods(uid: string, p: Profile, g: Goods) {
    p.pieces += g.pieces ?? 0;
    p.cores += g.cores ?? 0;
    p.boxes.card += g.cardBox ?? 0;
    p.boxes.relic += g.relicBox ?? 0;
    p.boxes.trans = (p.boxes.trans ?? 0) + (g.trans ?? 0);
    if (g.item) await users.updateOne({ _id: uid } as never, { $addToSet: { "inv.defense": g.item } } as never);
  }

  /** 초월 소환 한 번 (15% · 10번째 천장). 초월이 아니면 게임 재화 */
  const pullTrans = (p: Profile) => {
    const out = transRoll(p.pity ?? 0, () => randomInt(0, 1_000_000) / 1_000_000);
    p.pity = out.pity;
    if (out.trans) {
      if (!p.trans.includes(out.trans)) {
        p.trans.push(out.trans);
        return { trans: out.trans, pity: p.pity };
      }
      p.cards[out.trans] = (p.cards[out.trans] ?? 0) + BOX.trans.dupCards;
      return { trans: out.trans, dup: BOX.trans.dupCards, pity: p.pity };
    }
    const g = out.give ?? {};
    p.pieces += g.pieces ?? 0;
    p.cores += g.cores ?? 0;
    p.boxes.card += g.cardBox ?? 0;
    return { miss: g, pity: p.pity };
  };

  const weekLeft = (p: Profile, id: string, perWeek: number) => perWeek - (p.shop.n[id] ?? 0);

  return {
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
          cheat: p.load.cheat && (p.cheatRes ?? []).includes(p.load.cheat) ? p.load.cheat : "",
          grit: gritOf(p, Math.min(p.load.glitch, p.glitchOpen)),
        },
        unitIds
      );
    },

    async profile(uid: string): Promise<Wire> {
      return lock.run(`dp:${uid}`, async () => {
        const p = await load(uid);
        await save(p);
        return wire(uid, p);
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
        if (res.win && glitch > p.glitchWin) {
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
        // 끈기: 가장 높은 열린 단계에서 진 판을 셈 (그 단계를 넘기면 0)
        if (glitch === p.glitchOpen && glitch > p.glitchWin) {
          const pushed = glitchUnlocks(glitch, res) || (res.win && glitch >= GLITCH_MAX);
          p.grit = pushed ? { g: glitch, n: 0 } : { g: glitch, n: Math.min(GRIT_MAX, (p.grit?.g === glitch ? p.grit.n : 0) + 1) };
        }
        if (res.win) p.glitchWin = Math.max(p.glitchWin, glitch);
        if (glitchUnlocks(glitch, res) && glitch >= p.glitchOpen && p.glitchOpen < GLITCH_MAX) {
          p.glitchOpen = glitch + 1;
          opened = true;
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
    /** 치트 연구 사기 (글리치 코어 + 픽셀 조각, 한 번) — 칸이 비어 있으면 바로 낌 */
    cheatResBuy(uid: string, id: string) {
      return edit(uid, async (p) => {
        const r = CHEAT_RES_OF[id];
        if (!r) throw bad("없는 치트 연구예요.");
        p.cheatRes ??= [];
        need(!p.cheatRes.includes(id), "이미 산 치트 연구예요.");
        need(p.cores >= r.cores, "글리치 코어가 모자라요.");
        need(p.pieces >= r.pieces, "픽셀 조각이 모자라요.");
        p.cores -= r.cores;
        p.pieces -= r.pieces;
        p.cheatRes.push(id);
        if (!p.load.cheat) p.load.cheat = id;
        return wire(uid, p);
      });
    },

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

    /** 상자 열기 (가진 것 하나) — trans 는 초월 상자 (패키지에서 받은 초월 소환 1번) */
    boxOpen(uid: string, kind: "card" | "relic" | "trans") {
      return edit(uid, async (p) => {
        need((p.boxes[kind] ?? 0) >= 1, "상자가 없어요.");
        p.boxes[kind] = (p.boxes[kind] ?? 0) - 1;
        const got = kind === "card" ? openCards(p) : kind === "relic" ? openRelic(p, BOX.relic.tierOdds) : pullTrans(p);
        return wire(uid, p, { got });
      });
    },

    /** 초월 소환 (글리치 코어) — 15% 초월 · 10번째 천장, 아니면 게임 재화 */
    transSummon(uid: string) {
      return edit(uid, async (p) => {
        need(p.cores >= BOX.trans.cores, "글리치 코어가 모자라요.");
        p.cores -= BOX.trans.cores;
        return wire(uid, p, { got: pullTrans(p) });
      });
    },

    /** 재화샵: GP → 게임 재화 (횟수 제한 없음 — 효율이 낮아서) */
    storeBuy(uid: string, id: string) {
      return edit(uid, async (p) => {
        const it = GP_STORE.find((x) => x.id === id);
        if (!it) throw bad("없는 상품이에요.");
        await points.spend(uid, it.gp, "defense", `store:${id}`);
        await grantGoods(uid, p, it.give);
        return wire(uid, p);
      });
    },

    /** 재화 → GP (재화샵 값의 절반, 주 한도). 프로필을 먼저 저장한 뒤 지급 — 저장 실패로 두 번 받는 일이 없게 */
    storeSell(uid: string, id: string) {
      return edit(uid, async (p) => {
        const it = GP_SELL.find((x) => x.id === id);
        if (!it) throw bad("없는 교환이에요.");
        need(weekLeft(p, id, it.perWeek) > 0, "이번 주 교환을 다 했어요.");
        need(p.pieces >= (it.pay.pieces ?? 0), "픽셀 조각이 모자라요.");
        need(p.cores >= (it.pay.cores ?? 0), "글리치 코어가 모자라요.");
        p.pieces -= it.pay.pieces ?? 0;
        p.cores -= it.pay.cores ?? 0;
        p.shop.n[id] = (p.shop.n[id] ?? 0) + 1;
        await save(p);
        await points.grant(uid, it.gp, "defense", `sell:${id}`);
        return wire(uid, p);
      });
    },

    /** 패키지 (GP 로만) */
    packBuy(uid: string, id: string) {
      return edit(uid, async (p) => {
        const pk = PACK[id];
        if (!pk) throw bad("없는 패키지예요.");
        if (pk.once) need(!(p.packs[id] ?? 0), "이미 산 패키지예요.");
        else if (pk.perDay) need((p.shopDay!.n[id] ?? 0) < pk.perDay, "오늘은 이미 샀어요.");
        else need(weekLeft(p, id, pk.perWeek ?? 1) > 0, "이번 주에 이미 샀어요.");
        if (pk.needWin !== undefined) need(p.glitchWin >= pk.needWin, `오염 ${pk.needWin}단계를 클리어하면 살 수 있어요.`);
        if (pk.give.item) need(!(await inv(uid)).items.includes(pk.give.item), "이미 가진 꾸미기가 들어 있어요.");
        await points.spend(uid, pk.gp, "defense", `pack:${id}`);
        if (pk.once) p.packs[id] = (p.packs[id] ?? 0) + 1;
        else if (pk.perDay) p.shopDay!.n[id] = (p.shopDay!.n[id] ?? 0) + 1;
        else p.shop.n[id] = (p.shop.n[id] ?? 0) + 1;
        await grantGoods(uid, p, pk.give);
        return wire(uid, p, { got: { pack: id } });
      });
    },

    setLoad(uid: string, raw: unknown) {
      const v = z.object({ res: z.array(z.string()).max(RES_SLOTS + FRES_MAX), relics: z.array(z.string()).max(RELIC_SLOTS), glitch: z.number().int().min(0).max(GLITCH_MAX), cheat: z.string().max(20).optional() }).parse(raw);
      return edit(uid, async (p) => {
        need(v.res.every((r) => p.res.includes(r)), "열지 않은 연구가 있어요.");
        const gen = v.res.filter((r) => RES[r]?.group === "general").length;
        need(gen <= RES_SLOTS, `공용 연구는 ${RES_SLOTS}칸까지예요.`);
        need(v.res.length - gen <= p.fslots, "세력 연구칸이 모자라요 (정비소에서 살 수 있어요).");
        need(v.relics.every((r) => p.relics.includes(r)), "없는 유물이 있어요.");
        need(v.glitch <= p.glitchOpen, "아직 열리지 않은 오염 단계예요.");
        const cheat = v.cheat ?? p.load.cheat ?? "";
        need(!cheat || (p.cheatRes ?? []).includes(cheat), "사지 않은 치트 연구예요.");
        p.load = { res: [...new Set(v.res)], relics: [...new Set(v.relics)], glitch: v.glitch, cheat };
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
  };
}
