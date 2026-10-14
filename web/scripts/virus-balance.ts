/**
 * 바이러스 키우기 밸런스 시뮬레이션 — 계속 켜 두고 보는 플레이어를 흉내 내서 성장 속도를 뽑는다.
 *
 *   npx tsx scripts/virus-balance.ts [시간=72] [BAL키=값 ...] [--no-rand] [--no-shop] [--auto] [--rate] [--to-end]
 *   예) npx tsx scripts/virus-balance.ts 24 hpGrowth=1.16 dataRatio=6
 *
 *  플레이어 행동
 *   - 업그레이드: 초당 피해가 가장 많이 오르는 것(비용 대비)을 골라, 살 수 있게 되면 바로 삼
 *     업그레이드별 랜덤 강화(그 업그레이드 1~3레벨)의 평균 효율이 더 좋으면 랜덤 강화를 삼
 *   - 보스에게 지면 파일을 RETRY_FARM 초 동안 감염시킨 뒤 재도전
 *   - 같은 스테이지에서 보스에게 STUCK_FAILS 번 지거나 STUCK_SECS 초 넘게 걸리면 포맷 (포맷할 수 있을 때)
 *   - 포맷하면 루트 권한 상점에서 프로파일러 · 크론잡 · 크론 데몬 먼저(모자라면 모아 둠), 그다음 가장 싼 것부터 살 수 있는 만큼 삼
 *
 *  목표 (보고서 기준)
 *   - 첫 30분: 20~30스테이지, 업그레이드를 5~20초마다 하나
 *   - 첫 포맷: 30~60분
 *   - 그 뒤 한 회차: 1~3시간, 회차마다 조금씩 더 멀리
 */
import {
  BAL,
  BOSS_TIME,
  MOBS_PER_STAGE,
  UPGRADES,
  bossData,
  bossHp,
  canFormat,
  dps,
  format,
  gainData as gainDataRaw,
  mobData,
  mobHp,
  newSave,
  pendingRoot,
  stats,
  upgCost,
  type Save,
  randUpgrade,
  randExpectedGain,
  randPrice,
  SHOP,
  buyShop,
  rootLeft,
  shopCost,
  shopLocked,
  applyPlan,
  apexData,
  apexHp,
  apexCount,
  isApexStage,
  MAX_STAGE,
  finalHp,
  finalData,
  optimalPlan,
  autoBuy,
  autoRoot,
  backdoorCut,
  evoStage,
  EVOLUTION,
  bossTimeOf,
  buyUpgrade,
  checkAch,
  ACH,
  fmtBytes,
  avgHit,
  milestoneCore,
  fmt,
  dropFrag,
  rollBoss,
  dropKey,
  compileAll,
  ROSTER,
  APEX,
} from "../src/lib/virus/logic";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
/** --no-rand: 랜덤 강화 없이 (비교용) */
const NO_RAND = process.argv.includes("--no-rand");
/** --no-shop: 루트 권한 상점 없이 (비교용) */
const NO_SHOP = process.argv.includes("--no-shop");
/** --auto: 크론 데몬을 산 뒤로는 자동 최적 업그레이드(크론잡)만 쓰는 플레이어 */
const AUTO = process.argv.includes("--auto");
/** --auto 에서 효율 1등을 못 사면 모아 두기 (크론 데몬) */
const WAIT = process.argv.includes("--wait");
/** 편의성(프로파일러 · 크론잡 · 크론 데몬)을 처음부터 가진 채 시작 (GP로 산 것처럼 — 루트 권한을 안 씀) */
const UTIL_FREE = process.argv.includes("--util-free");
/** 편의성을 아예 안 삼 */
const NO_UTIL = process.argv.includes("--no-util");
/** 우회 키 최적 배분: --kalloc 처음부터 가짐 · --kalloc-buy=가격 크론 데몬 다음으로 루트 권한으로 삼 */
const KALLOC_FREE = process.argv.includes("--kalloc");
const KALLOC_BUY = Number(process.argv.find((a) => a.startsWith("--kalloc-buy="))?.split("=")[1]);
if (KALLOC_BUY > 0) SHOP.find((d) => d.key === "kalloc")!.base = KALLOC_BUY;
/** --to-end: 마지막 스테이지까지 가서 최종 보스를 처음 잡으면 멈춤 */
const TO_END = process.argv.includes("--to-end");
/** --quiet: 100스테이지 표만 */
const QUIET = process.argv.includes("--quiet");
/** --no-kernel: 커널 코어를 쓰지 않음 (비교용) */
const NO_KERNEL = process.argv.includes("--no-kernel");
/** stuck=600: 한 스테이지에 이 초 넘게 머물면 막혔다고 보고 변이 */
let STUCK_SECS = 600;
/**
 * --rate: 변이 효율이 꺾이면 변이 (최적 루트 근사) — 이번 회차의 「변이하면 오를 피해 배율의 로그 ÷ 회차 시간」이
 * 최고점에서 RATE_DROP 아래로 떨어지면. 막혔을 때(stuck)도 변이
 */
const RATE = process.argv.includes("--rate");
let RATE_DROP = 0.9;
const HOURS = Number(args.find((a) => !a.includes("=")) ?? 72);
for (const a of args.filter((x) => x.includes("="))) {
  const [k, v] = a.split("=");
  // evo=50,200,500 → 진화 단계 기준 바꿔 보기
  if (k === "evo") {
    v.split(",").forEach((n, i) => (EVOLUTION[i + 1].min = Number(n)));
    continue;
  }
  // shopGrowth=1.3 → 루트킷 · 데이터 마이닝 가격 배율
  if (k === "shopGrowth") {
    SHOP.filter((d) => d.key === "rootkit" || d.key === "miner").forEach(
      (d) => (d.growth = Number(v))
    );
    continue;
  }
  if (k === "drop") {
    RATE_DROP = Number(v);
    continue;
  }
  if (k === "stuck") {
    STUCK_SECS = Number(v);
    continue;
  }
  if (!(k in BAL)) throw new Error(`BAL에 없는 키: ${k}`);
  (BAL as Record<string, number>)[k] = Number(v);
}

const DT = 0.25;
const RETRY_FARM = 30;
const STUCK_FAILS = 3;

const fmtT = (x: number) =>
  x < 60
    ? `${x.toFixed(0)}초`
    : x < 3600
      ? `${(x / 60).toFixed(1)}분`
      : `${(x / 3600).toFixed(1)}시간`;

/** 비용 대비 초당 피해가 가장 많이 오르는 업그레이드 */
function bestUpgrade(s: Save) {
  const st = stats(s);
  const now = dps(st);
  let best: { key: (typeof UPGRADES)[number]["key"]; cost: number; score: number } | null = null;
  for (const u of UPGRADES) {
    const cost = upgCost(u, s.lv[u.key], st);
    s.lv[u.key]++;
    const gain = Math.log(dps(stats(s)) / now);
    s.lv[u.key]--;
    const score = gain / cost;
    if (!best || score > best.score) best = { key: u.key, cost, score };
  }
  return best;
}

let s = newSave();
let t = 0;
if (UTIL_FREE) Object.assign(s.shop, { profiler: 1, cron: 1, daemon: 1 });
if (KALLOC_FREE) s.shop.kalloc = 1;
/** 편의성을 산 때 (시각 · 그때 최고 스테이지) */
const utilAt: string[] = [];
/** 자동 구매 사이 가장 긴 공백 (자동으로 사는 플레이어가 「멈췄다」고 느끼는지) */
let lastAutoBuy = 0;
let autoGap = { secs: 0, at: 0, stage: 0 };
let st = stats(s);
let hp = mobHp(1, st);
let boss = false;
let left = BOSS_TIME;
let fails = 0;
let farmLeft = 0;
let stageStart = 0;
let runStart = 0;
let buys = 0;
let buys30 = 0;
let rands = 0;
const stageAt: Record<number, number> = {};
const slowStages: string[] = [];
const runs: string[] = [];
/** --runs: 회차마다 (번호 · 회차 시간 · 도달 스테이지 · 최고 · 받은 루트 권한 · 루트 합계 · 끝난 시각) 표로 */
const RUNS_ALL = process.argv.includes("--runs");
const runRows: string[] = [];
const evoAt: Record<number, number> = {};
const apexAt: Record<number, number> = {};

let overflow = "";

/**
 * 루트 권한 쓰기: 프로파일러 → 크론잡 → 크론 데몬 먼저 (못 사면 모아 둠), 그다음 가장 싼 것부터
 * (커널 프로파일러 · 자동 컴파일러는 추천 · 편의라 시뮬레이터엔 쓸모없음 — 사지 않음)
 */
/** --all-util: 편의성을 모두 사고 커널 권한 「루트 권한 자동 투자」로 효율 강화를 삼 */
const ALL_UTIL = process.argv.includes("--all-util");
const UTIL = ALL_UTIL
  ? ["profiler", "cron", "daemon", "kprof", "autoc", "kalloc"]
  : ["profiler", "cron", "daemon"];
const SKIP = ["kprof", "autoc", "kalloc"];
function spendRoot(sv: Save) {
  for (const k of [...(NO_UTIL ? [] : UTIL), ...(KALLOC_BUY > 0 ? ["kalloc"] : [])]) {
    const key = k as (typeof SHOP)[number]["key"];
    if (sv.shop[key]) continue;
    if (!buyShop(sv, key)) return;
    utilAt.push(`${SHOP.find((d) => d.key === key)!.name} ${fmtT(t)}(${sv.best})`);
  }
  // 루트 권한 자동 투자가 있으면 그것대로 (효율 순 · 1등을 못 사면 모아 둠)
  if (sv.shop.kroot) {
    autoRoot(sv);
    return;
  }
  for (let i = 0; i < 500; i++) {
    const options = SHOP.filter(
      (d) =>
        !UTIL.includes(d.key) &&
        !SKIP.includes(d.key) &&
        d.group !== "core" &&
        (d.max == null || sv.shop[d.key] < d.max)
    );
    options.sort((a, b) => shopCost(a, sv.shop[a.key]) - shopCost(b, sv.shop[b.key]));
    if (!options.length || !buyShop(sv, options[0].key)) break;
  }
  if (rootLeft(sv) < 0) throw new Error("루트 권한이 음수");
}

/** 커널 코어: 커널 권한을 위에서부터 차례로 (잠기지 않은 다음 것 — 마지막은 커널 패치 반복). --no-kernel 이면 안 씀 */
function spendCores(sv: Save) {
  if (NO_KERNEL) return;
  for (let k = 0; k < 200; k++) {
    const next = SHOP.find(
      (d) => d.group === "core" && !shopLocked(sv, d) && (d.max == null || sv.shop[d.key] < d.max)
    );
    if (!next || !buyShop(sv, next.key)) break;
    if (!kernelAt[next.key]) kernelAt[next.key] = { t, stage: sv.best - 1 };
  }
}
/** 커널 권한을 산 시각 · 그때 최고 스테이지 */
const kernelAt: Record<string, { t: number; stage: number }> = {};
/** 최고 스테이지가 처음 100 · 200 … 을 넘은 시각 · 그때 변이 횟수 */
const bestAt: Record<number, { t: number; formats: number }> = {};
const diagSeen = new Set<number>();
/** --stages: 최고 스테이지가 처음 넘은 시각 (10스테이지마다) · 그때 그 스테이지 한 판(파일 10개 + 보스) 걸리는 시간 */
const STAGES = process.argv.includes("--stages");
const stageRows: string[] = [];
let stageSeen = 0;
function noteBest() {
  if (STAGES)
    while (stageSeen + 10 < s.best && stageSeen + 10 <= MAX_STAGE) {
      stageSeen += 10;
      const q = stats(s);
      const d = dps(q);
      const floor = 1 / Math.max(0.1, q.aps * q.shotsMul);
      const mob = Math.max(floor, mobHp(stageSeen, q) / d);
      const boss = Math.max(floor, bossHp(stageSeen, q) / (d * q.bossDmgMul * q.fxBossMul));
      stageRows.push(
        [
          stageSeen,
          fmtT(t),
          s.formats,
          (mob * 10 + boss).toFixed(1),
          mob.toFixed(2),
          boss.toFixed(2),
          ((mobHp(stageSeen, q) / d) * q.aps * q.shotsMul).toFixed(1),
        ].join("	")
      );
    }
  if (
    process.env.DIAG &&
    s.best % 10 === 1 &&
    s.best >= Number(process.env.DIAG_FROM ?? 81) &&
    s.best <= Number(process.env.DIAG_TO ?? 221) &&
    !diagSeen.has(s.best)
  ) {
    diagSeen.add(s.best);
    const q = stats(s);
    console.log(
      `  [${fmtT(t)}] best ${s.best - 1} · 변이 ${s.formats} · 루트 ${fmt(s.root)} (×${fmt(q.rootMul)}) · lv ${JSON.stringify(s.lv)} · 모듈 ${s.mods.join(",")} · 우회 ${s.byp.join(",")} · dmg ${fmt(q.dmg)} · fx ×${q.fxMul.toFixed(1)} · 상점 ${s.shop.rootkit}/${s.shop.miner}`
    );
  }
  for (let n = 100; n <= MAX_STAGE; n += 100)
    if (s.best > n && bestAt[n] == null) bestAt[n] = { t, formats: s.formats };
}
/** 모듈 · 우회 기술을 처음 열 때 (시각 · 스테이지 · 그 순간 DPS 상승 — 보스 상대 기댓값) */
const unlocks: string[] = [];
/** 보스 · 상위 보스를 잡은 뒤: 조각 · 키를 얻고 바로 컴파일 (팝업을 바로 누르는 플레이어) */
function loot(kind: "boss" | "apex", fresh: boolean) {
  const before = feel();
  const opened: string[] = [];
  if (kind === "boss") dropFrag(s, fresh);
  else {
    const k = dropKey(s, fresh);
    if (k.opened) opened.push(`🛡️ ${APEX[k.index].trait} v1`);
  }
  for (const c of compileAll(s)) {
    if (c.kind === "mod" && s.mods[c.i] === c.to && !unlockedMod.has(c.i)) {
      unlockedMod.add(c.i);
      opened.push(`📦 ${ROSTER[c.i].module} v${c.to}`);
    }
  }
  if (opened.length) {
    const after = feel();
    const pc = (a: number, b: number) =>
      `${a / b >= 1.005 ? "+" : ""}${((a / b - 1) * 100).toFixed(0)}%`;
    unlocks.push(
      `  ${fmtT(t).padStart(7)} · ${String(s.stage).padStart(4)} · ${opened.join(" + ")} → 보스 DPS ${pc(after.boss, before.boss)} · 파일 ${pc(after.file, before.file)} · 데이터 ${pc(after.data, before.data)} · 보스 시간 ${after.time - before.time >= 0 ? "+" : ""}${(after.time - before.time).toFixed(1)}초`
    );
  }
}
/** 체감 지표: 보스 DPS · 초당 파일 감염 (첫 발 강타 · 이월 반영) · 초당 데이터 · 보스 제한 시간 (암호화 잠금 상한 포함) */
function feel() {
  const q = stats(s);
  const hp = mobHp(s.stage, q);
  const d = dps(q);
  const left = Math.max(
    hp * 0.02,
    hp * (1 - backdoorCut(q.fx, false)) - Math.max(0, q.fx.first - 1) * avgHit(q)
  );
  const file = d / left;
  return {
    boss: d * q.bossDmgMul * q.fxBossMul,
    file,
    data: file * mobData(s.stage, q) * (1 + q.fx.leech),
    time: bossTimeOf("boss", q) + q.fx.lockCap,
  };
}
const unlockedMod = new Set<number>();
/** 이번 보스 전투에서 암호화 잠금으로 늘린 시간 */
/** 이번 회차 변이 효율 최고점 (--rate) */
let peakRate = 0;
let lockGained = 0;

let apex = false;
let fin = false;
let finalAt = -1;
function nextEnemy() {
  st = stats(s);
  boss = s.kills >= MOBS_PER_STAGE && farmLeft <= 0;
  // 스테이지 100 상위 보스까지 잡으면 최종 보스, 10스테이지마다 보스를 잡으면 상위 보스(보안 시스템)
  fin = boss && s.finalReady;
  apex = boss && s.bossDone && !fin;
  hp = fin
    ? finalHp(st, s.clears)
    : apex
      ? apexHp(s.stage, st)
      : boss
        ? bossHp(s.stage, st)
        : mobHp(s.stage, st);
  left = bossTimeOf(fin ? "final" : apex ? "apex" : "boss", st);
  leftMax = left;
  lockGained = 0;
  // 백도어 침투(깎인 채로) · 부트 선점(첫 발 강타)
  hp *= 1 - backdoorCut(st.fx, boss);
  if (st.fx.first > 1) hp -= (st.fx.first - 1) * avgHit(st);
}
let leftMax = BOSS_TIME;
const achAt: Record<string, number> = {};

/** --ttk: 10분마다 지금 스테이지의 파일 10개 vs 보스 처치 시간 (우회 기술 때문에 보스가 파일보다 빨리 잡히는지) */
const TTK = process.argv.includes("--ttk");
let nextTtk = 0;
const ttkRows: string[] = [];
while (t < HOURS * 3600) {
  if (TTK && t >= nextTtk) {
    nextTtk += 600;
    const q = stats(s);
    const d = dps(q);
    const floor = 1 / Math.max(0.1, q.aps * q.shotsMul);
    const mob = Math.max(floor, mobHp(s.stage, q) / d);
    const boss = Math.max(floor, bossHp(s.stage, q) / (d * q.bossDmgMul * q.fxBossMul));
    ttkRows.push(
      `${fmtT(t).padStart(8)} · 스테이지 ${String(s.stage).padStart(4)} · 파일 1개 ${mob.toFixed(2)}초 (10개 ${(mob * 10).toFixed(1)}초) · 보스 ${boss.toFixed(2)}초 · 보스/파일 ×${(boss / mob).toFixed(2)}`
    );
  }
  // 업그레이드 (한 틱에 최대 1000번 — 숫자가 무한대로 튀면 멈춤)
  if (AUTO && s.shop.daemon) {
    // --wait: 게임의 크론 데몬과 같게 (autoBuy) · 아니면 예전처럼 가진 데이터로 최적 조합만
    const ups = s.rec.ups;
    const bought = WAIT ? autoBuy(s) : applyPlan(s, optimalPlan(s));
    if (bought) {
      buys += s.rec.ups - ups;
      if (lastAutoBuy && t - lastAutoBuy > autoGap.secs)
        autoGap = { secs: t - lastAutoBuy, at: t, stage: s.stage };
      lastAutoBuy = t;
    }
  } else
    for (let i = 0; i < 1000; i++) {
      const b = bestUpgrade(s);
      // 업그레이드별 랜덤 강화 중 평균 효율이 가장 좋은 것
      let f: { key: (typeof UPGRADES)[number]["key"]; price: number; score: number } | null = null;
      if (!NO_RAND || !b)
        for (const u of UPGRADES) {
          const price = randPrice(s, u.key);
          const score = randExpectedGain(s, u.key) / price;
          if (!f || score > f.score) f = { key: u.key, price, score };
        }
      if (f && (!b || f.score > b.score)) {
        if (!Number.isFinite(f.price) || !randUpgrade(s, f.key)) break;
        rands++;
      } else {
        if (!b || !Number.isFinite(b.cost) || s.data < b.cost) break;
        buyUpgrade(
          s,
          UPGRADES.find((u) => u.key === b.key)!,
          1
        );
      }
      buys++;
      if (t <= 1800) buys30++;
    }
  if (!Number.isFinite(s.data) || !Number.isFinite(dps(stats(s)))) {
    overflow = `${fmtT(t)}에 숫자가 무한대로 넘침 (스테이지 ${s.stage}) — 성장이 너무 빠름`;
    break;
  }
  const evo = evoStage(s.lv);
  if (evoAt[evo] == null) evoAt[evo] = t;
  st = stats(s);
  hp -= dps(st) * (boss ? st.bossDmgMul * st.fxBossMul : 1) * DT;
  t += DT;
  if (boss) {
    left -= DT;
    // 암호화 잠금: 보스에게 익스플로잇이 터질 때마다 시간 + (전투당 상한)
    if (st.fx.lockT && lockGained < st.fx.lockCap) {
      const g = Math.min(
        st.fx.lockCap - lockGained,
        st.critChance * st.aps * st.shotsMul * st.fx.lockT * DT
      );
      left += g;
      lockGained += g;
    }
  } else if (farmLeft > 0) farmLeft -= DT;

  if (Math.floor(t) !== Math.floor(t - DT)) {
    for (const a of checkAch(s)) achAt[a.id] = t;
  }
  if (hp <= 0) {
    // 러브레터 미끼: 명중마다 미리 빼낸 데이터 (평균만큼 보상에 얹음)
    const gainData = (sv: Save, n: number) => gainDataRaw(sv, n * (1 + st.fx.leech));
    if (boss) {
      if (left <= 1) s.rec.clutch++;
      if (fin) {
        const took = leftMax - left;
        if (!s.rec.bestFinal || took < s.rec.bestFinal) s.rec.bestFinal = took;
      } else if (apex) s.rec.apexes++;
      else s.rec.bosses++;
    }
    if (fin) {
      // 최종 보스: 스테이지 100에 머물며 다시 파일부터
      gainData(s, finalData(st));
      if (finalAt < 0) finalAt = t;
      s.clears++;
      s.cores++;
      spendCores(s);
      s.finalReady = false;
      s.kills = 0;
      fails = 0;
      if (TO_END) break;
    } else if (boss && apex && s.stage >= MAX_STAGE) {
      // 마지막 상위 보스: 더 나아가지 않고 바로 최종 보스
      gainData(s, apexData(s.stage, st));
      loot("apex", s.stage >= s.best);
      if (s.stage > s.apexBest && apexAt[apexCount(s.stage)] == null)
        apexAt[apexCount(s.stage)] = t;
      s.apexBest = Math.max(s.apexBest, s.stage);
      if (s.formats === 0 && stageAt[MAX_STAGE] == null) stageAt[MAX_STAGE] = t;
      s.bossDone = false;
      s.finalReady = true;
      s.best = Math.max(s.best, MAX_STAGE + 1);
      noteBest();
      fails = 0;
    } else if (boss && !apex && isApexStage(s.stage)) {
      // 보스는 잡았고 상위 보스가 남음 (스테이지는 그대로)
      gainData(s, bossData(s.stage, st));
      loot("boss", s.stage >= s.best);
      s.bossDone = true;
      fails = 0;
    } else if (boss) {
      gainData(s, apex ? apexData(s.stage, st) : bossData(s.stage, st));
      loot(apex ? "apex" : "boss", s.stage >= s.best);
      if (apex) {
        if (s.stage > s.apexBest && apexAt[apexCount(s.stage)] == null)
          apexAt[apexCount(s.stage)] = t;
        // 100스테이지마다 처음 넘으면 커널 코어
        if (s.stage > s.apexBest && milestoneCore(s.stage)) {
          s.cores++;
          spendCores(s);
        }
        s.apexBest = Math.max(s.apexBest, s.stage);
      }
      s.bossDone = false;
      const took = t - stageStart;
      if (s.formats === 0 && stageAt[s.stage] == null) stageAt[s.stage] = t;
      if (took > 600)
        slowStages.push(
          `  회차 ${s.formats + 1} · 스테이지 ${s.stage}: ${fmtT(took)} (보스 실패 ${fails}번)`
        );
      s.stage++;
      s.best = Math.max(s.best, s.stage);
      s.runTop = Math.max(s.runTop, s.stage);
      rollBoss(s);
      noteBest();
      s.kills = 0;
      fails = 0;
      stageStart = t;
    } else {
      gainData(s, mobData(s.stage, st));
      s.kills = Math.min(MOBS_PER_STAGE, s.kills + 1);
      s.rec.files++;
    }
    nextEnemy();
  } else if (boss && left <= 0) {
    fails++;
    s.rec.fails++;
    farmLeft = RETRY_FARM;
    nextEnemy();
  }
  let stuck = fails >= STUCK_FAILS || t - stageStart > STUCK_SECS;
  // 변이 효율: 루트 권한으로 오를 피해 배율(로그) ÷ 이번 회차 시간 — 꺾이면 변이
  if (RATE && Math.floor(t) % 5 === 0 && t - Math.floor(t) < DT) {
    const pend = pendingRoot(s);
    const rate =
      pend > 0
        ? Math.log((1 + BAL.rootBonus * (s.root + pend)) / (1 + BAL.rootBonus * s.root)) /
          Math.max(60, t - runStart)
        : 0;
    if (rate > peakRate) peakRate = rate;
    else if (rate > 0 && rate < peakRate * RATE_DROP) stuck = true;
  }
  if (stuck && canFormat(s)) {
    runRows.push(
      [
        s.formats + 1,
        fmtT(t - runStart),
        s.stage,
        s.best - 1,
        fmt(pendingRoot(s)),
        fmt(s.root + pendingRoot(s)),
        fmtT(t),
      ].join(String.fromCharCode(9))
    );
    runs.push(
      `  회차 ${s.formats + 1}: ${fmtT(t - runStart)} 동안 스테이지 ${s.stage}까지 → 루트 권한 +${pendingRoot(s)} (합계 ${s.root + pendingRoot(s)}) · 끝난 시각 ${fmtT(t)} · 상점 ${Object.values(s.shop).join("/")}`
    );
    s = format(s);
    if (!NO_SHOP) spendRoot(s);
    peakRate = 0;
    runStart = t;
    stageStart = t;
    fails = 0;
    farmLeft = 0;
    nextEnemy();
  }
}

console.log(
  `밸런스 시뮬레이션 (${HOURS}시간, 계속 켜 둔 플레이어${NO_RAND ? ", 랜덤 강화 없이" : ""}${NO_SHOP ? ", 상점 없이" : ""}${AUTO ? ", 자동 구매만" : ""})`
);
console.log(`BAL: ${JSON.stringify(BAL)}\n`);
if (overflow)
  console.log(`⚠ ${overflow}
`);
console.log(
  "100스테이지마다 (최고 스테이지가 처음 넘은 시각 · 그 100스테이지에 걸린 시간 · 그때까지 변이):"
);
let prevT = 0;
for (let n = 100; n <= MAX_STAGE; n += 100) {
  const b = bestAt[n];
  if (!b) {
    console.log(`  ${String(n).padStart(4)} 돌파: -`);
    break;
  }
  console.log(
    `  ${String(n).padStart(4)} 돌파: ${fmtT(b.t).padStart(7)} · +${fmtT(b.t - prevT).padStart(7)} · 변이 ${b.formats}번`
  );
  prevT = b.t;
}
console.log(
  `  끝 시각 ${fmtT(t)} · 최고 ${s.best - 1} · 지금 스테이지 ${s.stage} · 루트 권한 ${fmt(s.root)} · 코어 ${s.cores}`
);
if (AUTO)
  console.log(
    `자동 구매 최대 공백: ${fmtT(autoGap.secs)} (${fmtT(autoGap.at)} · 스테이지 ${autoGap.stage})`
  );
if (STAGES)
  console.log(
    ["스테이지	처음 도달	변이	한 판(초)	파일(초)	보스(초)	파일 명중 수", ...stageRows].join(
      String.fromCharCode(10)
    )
  );
if (TTK) console.log(["처치 시간 (10분마다):", ...ttkRows].join(String.fromCharCode(10)));
console.log("편의성 산 때: " + (utilAt.join(" → ") || "없음"));
console.log(
  "커널 권한 산 때: " +
    (SHOP.filter((d) => d.group === "core" && kernelAt[d.key])
      .map((d) => `${d.name} ${fmtT(kernelAt[d.key].t)}(${kernelAt[d.key].stage})`)
      .join(" → ") || "없음")
);
console.log("\n모듈 · 우회 기술을 처음 열 때:");
console.log(unlocks.join("\n") || "  없음");
console.log(`  끝: 모듈 ${s.mods.map((v, i) => `${ROSTER[i].module} v${v}`).join(" · ")}`);
console.log(`       우회 ${s.byp.map((v, i) => `${APEX[i].trait} v${v}`).join(" · ")}`);
if (QUIET) process.exit(0);
console.log("\n첫 회차 스테이지 도달 시각:");
console.log(
  "  " +
    [2, 3, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100]
      .filter((n) => stageAt[n] != null)
      .map((n) => `${n} → ${fmtT(stageAt[n])}`)
      .join(" · ")
);
console.log(
  `첫 30분: 업그레이드 ${buys30}번 (평균 ${buys30 ? (1800 / buys30).toFixed(1) : "-"}초마다)`
);
console.log(`\n회차 (포맷 ${runs.length}번):`);
if (RUNS_ALL)
  console.log(
    [
      "회차표",
      ["회차", "회차 시간", "도달", "최고", "+루트", "루트 합계", "끝난 시각"].join(
        String.fromCharCode(9)
      ),
      ...runRows,
    ].join(String.fromCharCode(10))
  );
console.log(runs.slice(0, 12).join("\n") || "  없음");
if (runs.length > 12) console.log(`  … (${runs.length - 12}회차 더)`);
console.log(
  `  지금 회차 ${s.formats + 1}: ${fmtT(t - runStart)}째, 스테이지 ${s.stage} · 최고 ${s.best} · 루트 권한 ${s.root}`
);
console.log(`\n10분 넘게 걸린 스테이지 ${slowStages.length}개:`);
console.log(slowStages.slice(0, 10).join("\n") || "  없음");
console.log(`\n업그레이드 총 ${buys}번 (그중 랜덤 강화 ${rands}번) · 레벨 ${JSON.stringify(s.lv)}`);
console.log(
  "진화 처음 도달: " +
    EVOLUTION.map((e, i) => `${e.name} ${evoAt[i] == null ? "-" : fmtT(evoAt[i])}`).join(" · ")
);
console.log(
  "상위 보스 처음 처치: " +
    (Object.entries(apexAt)
      .map(([n, at]) => `${n}번째 ${fmtT(at)}`)
      .join(" · ") || "없음")
);
console.log(`최종 보스 처음 격퇴: ${finalAt < 0 ? "없음" : fmtT(finalAt)} (모두 ${s.clears}번)`);
console.log(`루트 권한 상점: ${JSON.stringify(s.shop)} · 남은 포인트 ${rootLeft(s)}`);
console.log(
  `누적 데이터 ${fmtBytes(s.lifetime)} · 파일 ${s.rec.files} · 보스 ${s.rec.bosses} · 차단 ${s.rec.fails} · KILLSWITCH 최단 ${s.rec.bestFinal.toFixed(1)}초`
);
console.log(`\n업적 ${s.ach.length}/${ACH.length} (피해 ×${stats(s).achMul.toFixed(2)}):`);
console.log(
  "  " + ACH.map((a) => `${a.name} ${achAt[a.id] == null ? "-" : fmtT(achAt[a.id])}`).join(" · ")
);
