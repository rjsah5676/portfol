/**
 * 픽셀파이트 AI 시뮬레이션 통계 — 서버가 상시로 AI끼리 랭크전을 돌려 캐릭터 · 상성 표본을 쌓음.
 *
 *  - 등급(브론즈 ~ 레전드)마다 그 등급 가운데쯤 레이팅 실력의 AI 둘을 (캐릭터 보정 없이) 붙임 → 실력대별 캐릭터 강약
 *  - 판은 작업 스레드(fightSim.worker.ts)에서 돌려 메인 스레드(모든 게임 · 소켓)를 안 막음.
 *    작업 스레드도 쉬엄쉬엄 돌고(한 코어 1/3 이하), FIGHT_SIM_SEC 초(기본 120)마다 한 판 — 앞 판이 안 끝났으면 건너뜀
 *  - 결과는 밸런스 버전(BUILD_ID)별로 따로: fight_sim 에 (버전 · 등급 · 캐릭터 a · b) 칸마다 승·무·판 수를 더함
 *  - 켜기: 운영(NODE_ENV=production)에선 기본 켬, FIGHT_SIM=0 이면 끔 · 개발에선 FIGHT_SIM=1 일 때만
 */
import { Worker } from "node:worker_threads";
import type { Database } from "../db";
import { CHARS } from "../../../web/src/lib/fight/chars";
import { MAPS } from "../../../web/src/lib/fight/maps";
import { BUILD_ID } from "../../../web/src/lib/fight/sim";
import { SIM_TIER_R } from "../../../web/src/lib/fight/tiers";
import { FIGHT_VER } from "../../../web/src/lib/fight/version";
import type { SimJob, SimResult } from "./fightSim.worker";

/** (버전 · 등급 · a · b) 한 칸: a가 b를 상대로 w승 d무 / g판 */
export interface SimCell {
  _id: string;
  build: number;
  tier: number;
  a: number;
  b: number;
  w: number;
  d: number;
  g: number;
}
/** 밸런스 버전 (사람 랭크전 · AI 시뮬 공통) — 처음 본 때 · 마지막 · 판 수 */
export interface BuildDoc {
  _id: string;
  ver: string;
  from: Date;
  at: Date;
  sim?: number;
  human?: number;
}

/** 지금 버전을 버전 목록에 올림 (사람 판이면 human, AI 판이면 sim 을 하나 더함) */
export async function touchBuild(db: Database, kind: "sim" | "human") {
  const now = new Date();
  await db
    .col<BuildDoc>("fight_builds")
    .updateOne({ _id: String(BUILD_ID) }, { $set: { ver: FIGHT_VER, at: now }, $setOnInsert: { from: now }, $inc: { [kind]: 1 } }, { upsert: true });
}

let started = false;

export function startFightSim(db: Database) {
  if (started) return;
  started = true;
  const env = process.env.FIGHT_SIM;
  const on = env !== undefined ? env !== "0" : process.env.NODE_ENV === "production";
  if (!on) return;
  const sec = Math.max(20, Number(process.env.FIGHT_SIM_SEC) || 120);
  const cells = db.col<SimCell>("fight_sim");
  // 운영 묶음(dist/index.js) 옆의 dist/fightSim.worker.js 를 작업 스레드로
  const dev = import.meta.url.endsWith(".ts");
  const file = new URL("./fightSim.worker.js", import.meta.url);
  let worker: Worker | null = null;
  let busy = false;
  let fails = 0;
  let n = 0;

  const record = async (r: SimResult) => {
    const upd = (a: number, b: number, w: number, d: number) =>
      cells.updateOne(
        { _id: `${r.build}:${r.tier}:${a}:${b}` },
        { $inc: { w, d, g: 1 }, $setOnInsert: { build: r.build, tier: r.tier, a, b } },
        { upsert: true }
      );
    const dr = r.out === 2 ? 1 : 0;
    await Promise.all([upd(r.a, r.b, r.out === 0 ? 1 : 0, dr), upd(r.b, r.a, r.out === 1 ? 1 : 0, dr), touchBuild(db, "sim")]);
  };

  const spawn = () => {
    const w = new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: 96 } });
    w.unref();
    w.on("message", done);
    const dead = (why: unknown) => {
      if (worker !== w) return;
      worker = null;
      busy = false;
      // 계속 죽으면 멈춤 (서버는 그대로)
      if (++fails <= 3) {
        console.warn("[fight-sim] 작업 스레드 다시 띄움", why);
        setTimeout(spawn, 30_000 * fails).unref();
      } else console.warn("[fight-sim] 작업 스레드가 계속 죽어서 멈춤", why);
    };
    w.on("error", dead);
    w.on("exit", (code) => dead(`exit ${code}`));
    worker = w;
  };
  const done = (m: SimResult | { error: string }) => {
    busy = false;
    if ("error" in m) {
      console.warn("[fight-sim] 판 실패", m.error);
      return;
    }
    fails = 0;
    record(m).catch((e) => console.warn("[fight-sim] 기록 실패", e));
  };
  // 개발(tsx로 .ts 그대로 실행): 작업 스레드엔 tsx 가 안 걸려서 메인에서 그대로 (운영은 늘 작업 스레드)
  let send: (job: SimJob) => void;
  if (dev) {
    send = (job) => {
      import("./fightSim.worker")
        .then((mod) => mod.runSim(job))
        .then(done, (e) => done({ error: String(e) }));
    };
  } else {
    spawn();
    send = (job) => worker?.postMessage(job);
  }

  const tick = () => {
    if ((!dev && !worker) || busy) return;
    const tier = n++ % SIM_TIER_R.length;
    const a = Math.floor(Math.random() * CHARS.length);
    let b = Math.floor(Math.random() * (CHARS.length - 1));
    if (b >= a) b++;
    const job: SimJob = {
      tier,
      R: SIM_TIER_R[tier],
      a,
      b,
      map: Math.floor(Math.random() * MAPS.length),
      seed: (Math.random() * 2 ** 31) >>> 0,
    };
    busy = true;
    send(job);
  };
  // 서버가 막 떠서 바쁠 때는 피해 1분 뒤부터
  setTimeout(() => {
    tick();
    setInterval(tick, sec * 1000).unref();
  }, 60_000).unref();
}

/** AI 시뮬 통계 (버전 · 등급; tier < 0 이면 전체) — 사람 랭크전 통계와 같은 모양 */
export async function simStats(db: Database, build: number, tier: number) {
  const q: Record<string, unknown> = { build };
  if (tier >= 0) q.tier = tier;
  const docs = await db.col<SimCell>("fight_sim").find(q).toArray();
  const ch = new Map<number, { c: number; w: number; l: number; d: number }>();
  const vs = new Map<string, { a: number; b: number; w: number; g: number }>();
  let g2 = 0;
  for (const x of docs) {
    const c = ch.get(x.a) ?? { c: x.a, w: 0, l: 0, d: 0 };
    c.w += x.w;
    c.d += x.d;
    c.l += x.g - x.w - x.d;
    ch.set(x.a, c);
    const k = `${x.a}:${x.b}`;
    const v = vs.get(k) ?? { a: x.a, b: x.b, w: 0, g: 0 };
    v.w += x.w + x.d / 2;
    v.g += x.g;
    vs.set(k, v);
    g2 += x.g;
  }
  return { games: g2 / 2, chars: [...ch.values()], vs: [...vs.values()] };
}
