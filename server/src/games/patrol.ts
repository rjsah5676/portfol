/*
 * 픽셀 순찰대 — 판은 브라우저가 돌리고(lib/survivor/sim + 챕터), 서버는 진행 · 장비 · 재화 · 상자만.
 *  patrol.profile          → 재화 · 장비 · 챕터 진행 · 순찰 쌓인 것
 *  patrol.start / finish   → 판 번호 · 기록 확인(plausible) → 코인 · 설계도 · 첫 클리어 보석 · 장비 · 별
 *  진행은 스테이지 단위 (챕터마다 5개 · 1-1 = 1, 2-1 = 6). 예전 챕터 진행(best)은 bestSt = best × 5 로 옮김
 *  patrol.equip / unequip / enhance / reset / merge / mergeAll — 합성 재료 · 초기화한 장비의 강화비는 전액 환급
 *  patrol.box              → 고급(보석, 천장) · 일반(코인, 하루 한 번 무료) 상자
 *  patrol.claim            → 순찰 보상 받기 · 빠른 순찰
 *  patrol.rank             → 랭킹 (깬 스테이지 → 별 합 → 먼저 도달한 순)
 * 숫자는 web/src/lib/patrol/* 에 (화면과 같이 씀).
 */
import { randomInt } from "node:crypto";
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad } from "../errors";
import { newId } from "../ids";
import { KeyedMutex } from "../mutex";
import type { Ctx } from "../realtime/gateway";
import { pictureOf } from "../users";
import { ST_COUNT, SUB, stCh } from "../../../web/src/lib/patrol/chapters";
import {
  BOOST_RUNS,
  BOX,
  firstReward,
  QUICK_FREE,
  QUICK_H,
  REPEAT_GEAR,
  STAR_GEMS,
  WELCOME,
  patrolPending,
  patrolRate,
  plausible,
  rollBox,
  runBlueprints,
  runCoins,
  type PatrolReport,
  type Pity,
} from "../../../web/src/lib/patrol/economy";
import { GEAR, GEAR_IDS, MAX_LV, MERGE_N, SLOTS, enhanceCost, isSlot, mergeOk, power, powerScore, spentOn, type GGrade, type GearItem, type Slot } from "../../../web/src/lib/patrol/gear";

type Stars = [boolean, boolean, boolean];
interface PatrolProfile {
  _id: string;
  coins: number;
  gems: number;
  /** 설계도 */
  bp: number;
  items: GearItem[];
  /** 칸 → 장비 uid */
  equip: Partial<Record<Slot, string>>;
  /** 다 깬 챕터 수 (예전 진행 · 기록용) · 깬 가장 높은 스테이지 (전체 번호, 0 = 아직) */
  best: number;
  bestSt?: number;
  /** "s<스테이지 번호>" → 별 셋 (예전 챕터별 별 "1" · "2" · "3" 은 안 씀) */
  stars: Record<string, Stars>;
  runs: number;
  wins: number;
  kills: number;
  /** 오늘(KST) 판 수 — 첫 5판 두 배 */
  day: string;
  runsToday: number;
  /** 빠른 순찰 · 무료 일반 상자 (KST 날짜) */
  quickDay: string;
  quickUsed: number;
  freeBoxDay: string;
  /** 순찰 보상을 마지막으로 받은 시각 (ms) · 설계도 소수점 이월 */
  patrolAt: number;
  bpFrac: number;
  pity: Pity;
  /** 고급 상자 연 수 */
  boxes: number;
  nextUid: number;
  at: Date;
}
/** 랭킹 (한 사람 한 줄) — score = 깬 스테이지 × 1000 + 별 합 */
interface RankDoc {
  _id: string;
  nick: string;
  score: number;
  st: number;
  stars: number;
  /** 그때 전투력 (표시용) */
  power: number;
  at: Date;
}
/** 스테이지 별만 셈 (예전 챕터 별 "1" · "2" · "3" 은 빼고) */
const starSum = (stars: Record<string, Stars>) => Object.entries(stars).reduce((n, [k, v]) => n + (k.startsWith("s") ? v.filter(Boolean).length : 0), 0);

interface RunDoc {
  _id: string;
  uid: string;
  ch: number;
  st?: number;
  startAt: number;
  done: boolean;
  at: Date;
}

const kstDay = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
const rnd = () => randomInt(0, 1_000_000_000) / 1_000_000_000;
const uidArg = z.string().min(1).max(24);
const finishArg = z.object({
  run: z.string().min(1).max(64),
  sec: z.number().int().min(0).max(36_000),
  kills: z.number().int().min(0).max(2_000_000),
  lv: z.number().int().min(1).max(500),
  win: z.boolean(),
  gold: z.number().int().min(0).max(1_000_000).default(0),
  stars: z.tuple([z.boolean(), z.boolean(), z.boolean()]),
});

export function registerPatrol({ gateway, db }: Deps) {
  const profiles = db.col<PatrolProfile>("patrol_profile");
  const runs = db.col<RunDoc>("patrol_runs");
  const ranks = db.col<RankDoc>("patrol_rank");
  void ranks.createIndex({ score: -1, at: 1 }).catch(() => {});
  // 판 번호는 2일 뒤 자동 삭제
  void runs.createIndex({ at: 1 }, { expireAfterSeconds: 2 * 24 * 60 * 60 }).catch(() => {});
  const users = db.col("users");
  const lock = new KeyedMutex();

  const member = (ctx: Ctx) => {
    if (!ctx.nick) throw new AppError("MEMBER_ONLY", "회원만 할 수 있어요 (별명을 정해 주세요).", 403);
    return ctx.nick;
  };
  const fresh = (uid: string): PatrolProfile => {
    const items: GearItem[] = WELCOME.gear.map((g, i) => ({ uid: String(i + 1), id: g.id, g: g.g, lv: 1 }));
    const equip: Partial<Record<Slot, string>> = {};
    for (const it of items) equip[GEAR[it.id].slot] = it.uid;
    return {
      _id: uid,
      coins: WELCOME.coins,
      gems: WELCOME.gems,
      bp: 0,
      items,
      equip,
      best: 0,
      bestSt: 0,
      stars: {},
      runs: 0,
      wins: 0,
      kills: 0,
      day: "",
      runsToday: 0,
      quickDay: "",
      quickUsed: 0,
      freeBoxDay: "",
      patrolAt: Date.now(),
      bpFrac: 0,
      pity: { hero: 0, legend: 0 },
      boxes: 0,
      nextUid: items.length + 1,
      at: new Date(),
    };
  };
  const read = async (uid: string) => {
    const d = (await profiles.findOne({ _id: uid } as never)) as PatrolProfile | null;
    return d ? { ...fresh(uid), ...d, bestSt: d.bestSt ?? (d.best ?? 0) * SUB, pity: { ...d.pity }, equip: { ...d.equip }, stars: { ...d.stars } } : fresh(uid);
  };
  const save = (p: PatrolProfile) => profiles.replaceOne({ _id: p._id } as never, { ...p, at: new Date() } as never, { upsert: true });
  const today = () => kstDay(Date.now());
  const wire = (p: PatrolProfile) => {
    const now = Date.now();
    const d = today();
    return {
      coins: p.coins,
      gems: p.gems,
      bp: p.bp,
      items: p.items,
      equip: p.equip,
      best: p.best,
      bestSt: p.bestSt ?? 0,
      stars: p.stars,
      runs: p.runs,
      wins: p.wins,
      boostLeft: Math.max(0, BOOST_RUNS - (p.day === d ? p.runsToday : 0)),
      quickLeft: Math.max(0, QUICK_FREE - (p.quickDay === d ? p.quickUsed : 0)),
      freeBox: p.freeBoxDay !== d,
      patrolAt: p.patrolAt,
      pity: p.pity,
      now,
    };
  };
  const newItem = (p: PatrolProfile, id: GearItem["id"], g: GGrade): GearItem => {
    const it = { uid: String(p.nextUid++), id, g, lv: 1 };
    p.items.push(it);
    return it;
  };
  const find = (p: PatrolProfile, uid: string) => {
    const it = p.items.find((x) => x.uid === uid);
    if (!it) throw bad("없는 장비예요.");
    return it;
  };
  /** 하루가 바뀌었으면 오늘 칸 초기화 */
  const roll = (p: PatrolProfile) => {
    const d = today();
    if (p.day !== d) {
      p.day = d;
      p.runsToday = 0;
    }
    if (p.quickDay !== d) {
      p.quickDay = d;
      p.quickUsed = 0;
    }
  };
  const tx = <T>(ctx: Ctx, fn: (p: PatrolProfile) => Promise<T> | T) =>
    lock.run(`pt:${ctx.uid}`, async () => {
      const p = await read(ctx.uid);
      roll(p);
      const out = await fn(p);
      await save(p);
      return out;
    });

  /** 랭킹 한 줄 갱신 (깬 스테이지 · 별이 늘었을 때만) → 내 순위 */
  const putRank = async (uid: string, nick: string, p: PatrolProfile): Promise<number | null> => {
    const score = (p.bestSt ?? 0) * 1000 + starSum(p.stars);
    if (score <= 0) return null;
    const old = (await ranks.findOne({ _id: uid } as never)) as RankDoc | null;
    if (!old || score > old.score) {
      const eq = SLOTS.map((s) => p.items.find((x) => x.uid === p.equip[s])).filter((x): x is GearItem => !!x);
      await ranks.replaceOne({ _id: uid } as never, { _id: uid, nick, score, st: p.bestSt ?? 0, stars: starSum(p.stars), power: powerScore(power(eq)), at: new Date() } as never, { upsert: true });
    } else if (old.nick !== nick) await ranks.updateOne({ _id: uid } as never, { $set: { nick } } as never);
    return (await ranks.countDocuments({ score: { $gt: Math.max(score, old?.score ?? 0) } } as never)) + 1;
  };

  gateway.rpc("patrol.profile", async (ctx) => {
    const nick = member(ctx);
    return tx(ctx, async (p) => {
      // 랭킹이 생기기 전 진행도 한 번 올려 둠
      if ((p.bestSt ?? 0) > 0 && !(await ranks.findOne({ _id: ctx.uid } as never, { projection: { _id: 1 } }))) await putRank(ctx.uid, nick, p);
      return wire(p);
    });
  });

  gateway.rpc("patrol.start", async (ctx, raw) => {
    member(ctx);
    const { st } = z.object({ st: z.number().int().min(1).max(ST_COUNT) }).parse(raw);
    const p = await read(ctx.uid);
    if (st > (p.bestSt ?? 0) + 1) throw bad("앞 스테이지를 먼저 깨야 열려요.");
    const id = newId();
    await runs.insertOne({ _id: id, uid: ctx.uid, ch: stCh(st), st, startAt: Date.now(), done: false, at: new Date() } as never);
    return { run: id };
  });

  gateway.rpc("patrol.finish", async (ctx, raw) => {
    member(ctx);
    const a = finishArg.parse(raw);
    return tx(ctx, async (p) => {
      const run = (await runs.findOne({ _id: a.run } as never)) as RunDoc | null;
      if (!run || run.uid !== ctx.uid) throw bad("없는 판이에요.");
      if (run.done) throw bad("이미 끝낸 판이에요.");
      await runs.updateOne({ _id: a.run } as never, { $set: { done: true } } as never);
      // 예전(챕터 단위) 판은 그 챕터 보스 스테이지로
      const st = run.st ?? run.ch * SUB;
      const rep: PatrolReport = { st, sec: a.sec, kills: a.kills, lv: a.lv, win: a.win, gold: a.gold, stars: a.stars };
      const wall = (Date.now() - run.startAt) / 1000;
      if (!plausible(rep, wall)) {
        console.warn("[patrol] 이상한 기록", ctx.uid, rep, wall);
        throw bad("기록을 확인할 수 없어요.");
      }
      const boosted = p.runsToday < BOOST_RUNS;
      p.runsToday++;
      const k = boosted ? 2 : 1;
      const coins = runCoins(rep) * k;
      const bp = runBlueprints(rep) * k;
      let gems = 0;
      const gear: GearItem[] = [];
      let first = false;
      if (rep.win && st > (p.bestSt ?? 0)) {
        // 첫 클리어: 보석 (챕터 보스 스테이지면 장비 하나도) · 다음 스테이지
        first = true;
        p.bestSt = st;
        p.best = Math.floor(st / SUB);
        const fr = firstReward(st);
        gems += fr.gems;
        if (fr.gear !== null) gear.push(newItem(p, GEAR_IDS[randomInt(0, GEAR_IDS.length)], fr.gear));
      } else if (rep.win && rnd() < REPEAT_GEAR) {
        gear.push(newItem(p, GEAR_IDS[randomInt(0, GEAR_IDS.length)], (rnd() < 0.3 ? 1 : 0) as GGrade));
      }
      // 별: 새로 딴 것만 보석
      const key = `s${st}`;
      const old: Stars = p.stars[key] ?? [false, false, false];
      const now: Stars = [old[0] || rep.stars[0], old[1] || rep.stars[1], old[2] || rep.stars[2]];
      const newStars = now.filter(Boolean).length - old.filter(Boolean).length;
      gems += newStars * STAR_GEMS;
      p.stars[key] = now;
      p.coins += coins;
      p.bp += bp;
      p.gems += gems;
      p.runs++;
      if (rep.win) p.wins++;
      p.kills += rep.kills;
      await users
        .updateOne({ _id: ctx.uid } as never, { $inc: { "stats.patrol.runs": 1, "stats.patrol.kills": rep.kills, ...(rep.win && { "stats.patrol.wins": 1 }) }, $max: { "stats.patrol.best": p.best, "stats.patrol.bestSt": p.bestSt ?? 0 } } as never)
        .catch((e) => console.warn("[patrol] 기록 저장 실패", e));
      // 랭킹: 깬 스테이지나 별이 늘었을 때만 (같으면 먼저 도달한 사람이 위)
      const rank = await putRank(ctx.uid, member(ctx), p);
      return { coins, bp, gems, gear, first, newStars, boosted, rank, profile: wire(p) };
    });
  });

  gateway.rpc("patrol.rank", async (_ctx, raw) => {
    const { limit } = z.object({ limit: z.number().int().min(1).max(100).default(50) }).parse(raw ?? {});
    const docs = (await ranks.find({} as never).sort({ score: -1, at: 1 }).limit(limit).toArray()) as unknown as RankDoc[];
    const av = new Map<string, string>();
    if (docs.length) {
      const us = await users
        .find({ _id: { $in: docs.map((d) => d._id) } } as never)
        .project({ "avatar.at": 1, photo: 1 })
        .toArray();
      for (const u of us) {
        const url = pictureOf(String(u._id), u as { avatar?: { at?: number }; photo?: string | null });
        if (url) av.set(String(u._id), url);
      }
    }
    return docs.map((d) => ({ nick: d.nick, avatar: av.get(d._id) ?? null, st: d.st, stars: d.stars, power: d.power, at: d.at.getTime() }));
  });

  gateway.rpc("patrol.equip", async (ctx, raw) => {
    member(ctx);
    const { uid } = z.object({ uid: uidArg }).parse(raw);
    return tx(ctx, (p) => {
      const it = find(p, uid);
      p.equip[GEAR[it.id].slot] = it.uid;
      return wire(p);
    });
  });

  gateway.rpc("patrol.unequip", async (ctx, raw) => {
    member(ctx);
    const { slot } = z.object({ slot: z.string() }).parse(raw);
    if (!isSlot(slot)) throw bad();
    return tx(ctx, (p) => {
      delete p.equip[slot];
      return wire(p);
    });
  });

  gateway.rpc("patrol.enhance", async (ctx, raw) => {
    member(ctx);
    const { uid, n } = z.object({ uid: uidArg, n: z.number().int().min(1).max(60).default(1) }).parse(raw);
    return tx(ctx, (p) => {
      const it = find(p, uid);
      let done = 0;
      for (let i = 0; i < n; i++) {
        if (it.lv >= MAX_LV[it.g]) break;
        const c = enhanceCost(it.lv);
        if (p.coins < c.coin || p.bp < c.bp) break;
        p.coins -= c.coin;
        p.bp -= c.bp;
        it.lv++;
        done++;
      }
      if (!done) throw bad(it.lv >= MAX_LV[it.g] ? "이 등급 최고 레벨이에요. 합성으로 등급을 올려요." : "코인이나 설계도가 모자라요.");
      return { done, profile: wire(p) };
    });
  });

  /** 재료로 쓴 장비 빼기 (끼고 있었으면 벗김) · 들인 강화비는 돌려줌 */
  const consume = (p: PatrolProfile, uids: string[]) => {
    const back = { coin: 0, bp: 0 };
    for (const x of p.items)
      if (uids.includes(x.uid)) {
        const r = spentOn(x.lv);
        back.coin += r.coin;
        back.bp += r.bp;
      }
    p.coins += back.coin;
    p.bp += back.bp;
    p.items = p.items.filter((x) => !uids.includes(x.uid));
    for (const s of SLOTS) if (p.equip[s] && uids.includes(p.equip[s]!)) delete p.equip[s];
    return back;
  };

  /** 강화 초기화: Lv1 로 · 들인 코인 · 설계도 전액 환급 */
  gateway.rpc("patrol.reset", async (ctx, raw) => {
    member(ctx);
    const { uid } = z.object({ uid: uidArg }).parse(raw);
    return tx(ctx, (p) => {
      const it = find(p, uid);
      if (it.lv <= 1) throw bad("강화하지 않은 장비예요.");
      const back = spentOn(it.lv);
      p.coins += back.coin;
      p.bp += back.bp;
      it.lv = 1;
      return { back, profile: wire(p) };
    });
  });

  gateway.rpc("patrol.merge", async (ctx, raw) => {
    member(ctx);
    const a = z.object({ main: uidArg, fodder: z.array(uidArg).length(MERGE_N - 1) }).parse(raw);
    return tx(ctx, (p) => {
      const main = find(p, a.main);
      const fodder = a.fodder.map((u) => find(p, u));
      const why = mergeOk(main, fodder);
      if (why) throw bad(why);
      const back = consume(p, a.fodder);
      main.g = (main.g + 1) as GGrade;
      return { item: main, back, profile: wire(p) };
    });
  });

  /** 한꺼번에 합성: 칸 · 등급마다 셋씩 (낮은 등급부터, 끼고 있는 것 · 레벨 높은 것을 남김) */
  gateway.rpc("patrol.mergeAll", async (ctx) => {
    member(ctx);
    return tx(ctx, (p) => {
      const made: GearItem[] = [];
      const back = { coin: 0, bp: 0 };
      for (let g = 0 as GGrade; g < 4; g = (g + 1) as GGrade) {
        for (const s of SLOTS) {
          for (;;) {
            const group = p.items.filter((x) => GEAR[x.id].slot === s && x.g === g);
            if (group.length < MERGE_N) break;
            const keep = (x: GearItem) => (p.equip[s] === x.uid ? 1e6 : 0) + x.lv * 10 + (GEAR[x.id].weapon ? 1 : 0);
            group.sort((x, y) => keep(y) - keep(x));
            const main = group[0];
            const fodder = group.slice(-(MERGE_N - 1));
            const b = consume(p, fodder.map((x) => x.uid));
            back.coin += b.coin;
            back.bp += b.bp;
            main.g = (main.g + 1) as GGrade;
            made.push({ ...main });
          }
        }
      }
      if (!made.length) throw bad("합성할 수 있는 장비가 없어요 (같은 칸 · 같은 등급 3개).");
      return { made, back, profile: wire(p) };
    });
  });

  gateway.rpc("patrol.box", async (ctx, raw) => {
    member(ctx);
    const { kind } = z.object({ kind: z.enum(["premium", "premium10", "normal"]) }).parse(raw);
    return tx(ctx, (p) => {
      const got: GearItem[] = [];
      if (kind === "normal") {
        const free = p.freeBoxDay !== today();
        if (free) p.freeBoxDay = today();
        else {
          if (p.coins < BOX.normal.cost) throw bad("코인이 모자라요.");
          p.coins -= BOX.normal.cost;
        }
        const r = rollBox("normal", rnd, null);
        got.push(newItem(p, r.id, r.g));
      } else {
        const n = kind === "premium10" ? BOX.premium10.n : 1;
        const cost = kind === "premium10" ? BOX.premium10.cost : BOX.premium.cost;
        if (p.gems < cost) throw bad("보석이 모자라요.");
        p.gems -= cost;
        for (let i = 0; i < n; i++) {
          // 10연: 마지막 칸은 희귀 이상 (앞에서 안 나왔으면)
          const need = n > 1 && i === n - 1 && !got.some((x) => x.g >= 2) ? 2 : 0;
          const r = rollBox("premium", rnd, p.pity, need as GGrade);
          got.push(newItem(p, r.id, r.g));
          p.boxes++;
        }
      }
      return { got, profile: wire(p) };
    });
  });

  gateway.rpc("patrol.claim", async (ctx, raw) => {
    member(ctx);
    const { quick } = z.object({ quick: z.boolean().default(false) }).parse(raw ?? {});
    return tx(ctx, (p) => {
      const now = Date.now();
      let coin = 0;
      let bp = 0;
      if (quick) {
        if (p.quickUsed >= QUICK_FREE) throw bad("오늘 빠른 순찰을 다 썼어요.");
        p.quickUsed++;
        const r = patrolRate(p.bestSt ?? 0);
        coin = r.coin * QUICK_H;
        bp = r.bp * QUICK_H;
      } else {
        const r = patrolPending(p.bestSt ?? 0, p.patrolAt, now);
        if (r.h < 1 / 60) throw bad("아직 쌓인 게 없어요.");
        coin = r.coin;
        // 설계도 소수점은 다음으로 넘김
        const tot = r.h * patrolRate(p.bestSt ?? 0).bp + (p.bpFrac ?? 0);
        bp = Math.floor(tot);
        p.bpFrac = tot - bp;
        p.patrolAt = now;
      }
      p.coins += coin;
      p.bp += bp;
      return { coin, bp, profile: wire(p) };
    });
  });

  return {};
}
