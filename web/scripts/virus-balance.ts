/**
 * 바이러스 키우기 밸런스 시뮬레이션 — 계속 켜 두고 보는 플레이어를 흉내 내서 성장 속도를 뽑는다.
 *
 *   npx tsx scripts/virus-balance.ts [시간=72] [BAL키=값 ...] [--no-rand] [--no-shop] [--auto] [--chal]
 *   예) npx tsx scripts/virus-balance.ts 24 hpGrowth=1.16 dataRatio=6
 *
 *  플레이어 행동
 *   - 업그레이드: 초당 피해가 가장 많이 오르는 것(비용 대비)을 골라, 살 수 있게 되면 바로 삼
 *     업그레이드별 랜덤 강화(그 업그레이드 1~3레벨)의 평균 효율이 더 좋으면 랜덤 강화를 삼
 *   - 보스에게 지면 파일을 RETRY_FARM 초 동안 감염시킨 뒤 재도전
 *   - 같은 스테이지에서 보스에게 STUCK_FAILS 번 지거나 STUCK_SECS 초 넘게 걸리면 포맷 (포맷할 수 있을 때)
 *   - 포맷하면 루트 권한 상점에서 프로파일러 · 크론잡 · 크론 데몬 먼저(모자라면 모아 둠), 그다음 가장 싼 것부터 살 수 있는 만큼 삼
 *   - --chal: 첫 KILLSWITCH 를 잡은 뒤 챌린지 변이를 차례로 하나씩 (각각 걸린 시간 · 1시간 안에 못 하면 포기)
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
  gainData,
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
  applyPlan,
  apexData,
  apexHp,
  apexCount,
  isApexStage,
  MAX_STAGE,
  finalHp,
  finalData,
  optimalPlan,
  evoStage,
  EVOLUTION,
  bossTimeOf,
  buyUpgrade,
  checkAch,
  ACH,
  CHAL,
  checkChal,
  startChal,
  upgLocked,
  randLocked,
  fmtBytes,
  type ChalKey,
} from "../src/lib/virus/logic";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
/** --no-rand: 랜덤 강화 없이 (비교용) */
const NO_RAND = process.argv.includes("--no-rand");
/** --no-shop: 루트 권한 상점 없이 (비교용) */
const NO_SHOP = process.argv.includes("--no-shop");
/** --auto: 크론 데몬을 산 뒤로는 자동 최적 업그레이드(크론잡)만 쓰는 플레이어 */
const AUTO = process.argv.includes("--auto");
/** --chal: 첫 KILLSWITCH 뒤 챌린지 변이를 차례로 */
const CHALS = process.argv.includes("--chal");
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
  // goal.single=100 → 챌린지 목표 스테이지 바꿔 보기
  if (k.startsWith("goal.")) {
    const c = CHAL.find((x) => x.key === k.slice(5));
    if (!c) throw new Error(`없는 챌린지: ${k}`);
    c.goal = Number(v);
    continue;
  }
  if (!(k in BAL)) throw new Error(`BAL에 없는 키: ${k}`);
  (BAL as Record<string, number>)[k] = Number(v);
}

const DT = 0.25;
const RETRY_FARM = 30;
const STUCK_FAILS = 3;
/** 한 스테이지가 이보다 오래 걸리면 막혔다고 보고 포맷 */
const STUCK_SECS = 600;

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
    if (upgLocked(s, u.key)) continue;
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
const evoAt: Record<number, number> = {};
const apexAt: Record<number, number> = {};

let overflow = "";

/** 루트 권한 쓰기: 프로파일러 → 크론잡 → 크론 데몬 먼저 (못 사면 모아 둠), 그다음 가장 싼 것부터 */
const UTIL = ["profiler", "cron", "daemon", "kprof"];
function spendRoot(sv: Save) {
  for (const k of UTIL) {
    const key = k as (typeof SHOP)[number]["key"];
    if (sv.shop[key]) continue;
    if (!buyShop(sv, key)) return;
  }
  for (let i = 0; i < 500; i++) {
    const options = SHOP.filter(
      (d) =>
        !UTIL.includes(d.key) && d.group !== "core" && (d.max == null || sv.shop[d.key] < d.max)
    );
    options.sort((a, b) => shopCost(a, sv.shop[a.key]) - shopCost(b, sv.shop[b.key]));
    if (!options.length || !buyShop(sv, options[0].key)) break;
  }
  if (rootLeft(sv) < 0) throw new Error("루트 권한이 음수");
}

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
}
let leftMax = BOSS_TIME;
const achAt: Record<string, number> = {};
/** 챌린지: 지금 하는 것 · 시작 시각 · 결과 */
let chalIdx = -1;
let chalStart = 0;
const chalLog: string[] = [];
function nextChal() {
  chalIdx++;
  if (chalIdx >= CHAL.length) return;
  s = startChal(s, CHAL[chalIdx].key as ChalKey);
  if (!NO_SHOP) spendRoot(s);
  chalStart = t;
  runStart = t;
  stageStart = t;
  fails = 0;
  farmLeft = 0;
  nextEnemy();
}

while (t < HOURS * 3600) {
  // 업그레이드 (한 틱에 최대 1000번 — 숫자가 무한대로 튀면 멈춤)
  if (AUTO && s.shop.daemon && s.chal !== "lock") {
    const p = optimalPlan(s);
    if (applyPlan(s, p)) buys += p.count;
  } else
    for (let i = 0; i < 1000; i++) {
      const b = bestUpgrade(s);
      // 업그레이드별 랜덤 강화 중 평균 효율이 가장 좋은 것
      let f: { key: (typeof UPGRADES)[number]["key"]; price: number; score: number } | null = null;
      if (!NO_RAND || !b)
        for (const u of UPGRADES) {
          if (randLocked(s, u.key)) continue;
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
  hp -= dps(st) * (boss ? st.bossDmgMul : 1) * DT;
  t += DT;
  if (boss) left -= DT;
  else if (farmLeft > 0) farmLeft -= DT;

  if (Math.floor(t) !== Math.floor(t - DT)) {
    for (const a of checkAch(s)) achAt[a.id] = t;
  }
  if (hp <= 0) {
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
      // 커널 코어: 가장 싼 것부터 (인터럽트 지연은 최대 3)
      for (let k = 0; k < 50; k++) {
        const c = SHOP.filter(
          (d) => d.group === "core" && (d.max == null || s.shop[d.key] < d.max)
        );
        c.sort((a, b) => shopCost(a, s.shop[a.key]) - shopCost(b, s.shop[b.key]));
        if (!c.length || !buyShop(s, c[0].key)) break;
      }
      s.finalReady = false;
      s.kills = 0;
      fails = 0;
      if (CHALS && chalIdx < 0) nextChal();
    } else if (boss && apex && s.stage >= MAX_STAGE) {
      // 마지막 상위 보스: 더 나아가지 않고 바로 최종 보스
      gainData(s, apexData(s.stage, st));
      if (s.stage > s.apexBest && apexAt[apexCount(s.stage)] == null)
        apexAt[apexCount(s.stage)] = t;
      s.apexBest = Math.max(s.apexBest, s.stage);
      if (s.formats === 0 && stageAt[MAX_STAGE] == null) stageAt[MAX_STAGE] = t;
      s.bossDone = false;
      s.finalReady = true;
      s.best = Math.max(s.best, MAX_STAGE + 1);
      fails = 0;
    } else if (boss && !apex && isApexStage(s.stage)) {
      // 보스는 잡았고 상위 보스가 남음 (스테이지는 그대로)
      gainData(s, bossData(s.stage, st));
      s.bossDone = true;
      fails = 0;
    } else if (boss) {
      gainData(s, apex ? apexData(s.stage, st) : bossData(s.stage, st));
      if (apex) {
        if (s.stage > s.apexBest && apexAt[apexCount(s.stage)] == null)
          apexAt[apexCount(s.stage)] = t;
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
      s.kills = 0;
      fails = 0;
      stageStart = t;
      const done = checkChal(s);
      if (done) {
        chalLog.push(`  ${done.icon} ${done.name} (목표 ${done.goal}): ${fmtT(t - chalStart)}`);
        nextChal();
      }
    } else {
      gainData(s, mobData(s.stage, st));
      s.kills = Math.min(MOBS_PER_STAGE, s.kills + 1);
      s.rec.files++;
      // 연쇄 감염: 다음 파일도 바로
      if (s.kills < MOBS_PER_STAGE && Math.random() < st.chain) {
        gainData(s, mobData(s.stage, st));
        s.kills++;
        s.rec.files++;
        s.rec.chains++;
      }
    }
    nextEnemy();
  } else if (boss && left <= 0) {
    fails++;
    s.rec.fails++;
    farmLeft = RETRY_FARM;
    nextEnemy();
  }
  if (s.chal && t - chalStart > 3600) {
    chalLog.push(
      `  ${CHAL[chalIdx].icon} ${CHAL[chalIdx].name} (목표 ${CHAL[chalIdx].goal}): 1시간 안에 실패 — 스테이지 ${s.stage}에서 포기`
    );
    s.chal = null;
    nextChal();
  }
  if ((fails >= STUCK_FAILS || t - stageStart > STUCK_SECS) && canFormat(s) && !s.chal) {
    runs.push(
      `  회차 ${s.formats + 1}: ${fmtT(t - runStart)} 동안 스테이지 ${s.stage}까지 → 루트 권한 +${pendingRoot(s)} (합계 ${s.root + pendingRoot(s)}) · 끝난 시각 ${fmtT(t)} · 상점 ${Object.values(s.shop).join("/")}`
    );
    s = format(s);
    if (!NO_SHOP) spendRoot(s);
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
console.log("첫 회차 스테이지 도달 시각:");
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
  `누적 데이터 ${fmtBytes(s.lifetime)} · 파일 ${s.rec.files} (연쇄 ${s.rec.chains}) · 보스 ${s.rec.bosses} · 차단 ${s.rec.fails} · KILLSWITCH 최단 ${s.rec.bestFinal.toFixed(1)}초`
);
console.log(`\n업적 ${s.ach.length}/${ACH.length} (피해 ×${stats(s).achMul.toFixed(2)}):`);
console.log(
  "  " + ACH.map((a) => `${a.name} ${achAt[a.id] == null ? "-" : fmtT(achAt[a.id])}`).join(" · ")
);
if (CHALS) console.log(`\n챌린지 변이:\n${chalLog.join("\n") || "  시작 못 함"}`);
