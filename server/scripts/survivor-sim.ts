/*
 * 픽셀 타운 서바이버 밸런스 시뮬 — 봇이 적을 피해 다니며 카드를 고르고, 맵 오브젝트도 들름.
 *   npx tsx scripts/survivor-sim.ts [판 수] [캐릭터|-] [깊이] [full = 전부 해금] [ot = 오버타임] [clock = 시계탑 광장]
 */
import { HERO_IDS, RUN_SEC, SHARED_WEAPONS, TRIAL_R, xpNeed, type HeroId } from "../../web/src/lib/survivor/data";
import { UNIT } from "../../web/src/lib/defense/units";
import { QUESTS, unlocksOf } from "../../web/src/lib/survivor/quests";
import { RELIC_IDS } from "../../web/src/lib/survivor/relics";
import { armyBuy, armyCraft, armyMerge, buyRelic, chooseBless, chooseCard, chooseWish, closeChest, dawnChoice, leaveThing, maxHp, newRun, result, step, type Input, type Run } from "../../web/src/lib/survivor/sim";

const N = Number(process.argv[2] ?? 20);
const only = process.argv[3] && process.argv[3] !== "-" ? (process.argv[3] as HeroId) : undefined;
const DEPTH = Number(process.argv[4] ?? 0);
const FULL = process.argv.includes("full");
const OT = process.argv.includes("ot");
const STAGE = process.argv.includes("clock") ? "clock" : "town";
/** 럭키 출격: 봇은 합성 · 조합을 바로 하고, 금화가 넉넉하면 소환 */
const ARMY = process.argv.includes("army");
const un = unlocksOf(FULL ? QUESTS.map((q) => q.id) : []);

const seen = new Set<number>();
function botInput(r: Run): Input {
  for (const t of r.things) if (t.on && (t.k === "merchant" || t.k === "fountain")) seen.add(t.id);
  // 뱀서 고수식: 적 무리 둘레를 원을 그리며 돌고(접선), 너무 가까우면 벌어지고, 젬 · 아이템은 주우러 감
  const p = r.p;
  let cx = 0;
  let cy = 0;
  let cn = 0;
  let rx = 0;
  let ry = 0;
  let close = 0;
  for (const e of r.enemies) {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 160 * 160) {
      cx += e.x;
      cy += e.y;
      cn++;
    }
    const keep = e.def.boss ? 70 : e.elite ? 40 : 26;
    if (d2 < keep * keep) {
      const d = Math.sqrt(d2) || 1;
      const w = (keep - d) / keep;
      rx += (dx / d) * w * (e.def.boss ? 3 : 1);
      ry += (dy / d) * w * (e.def.boss ? 3 : 1);
      close++;
    }
  }
  for (const b of r.bullets) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < 40) {
      rx += (dx / (d || 1)) * 2;
      ry += (dy / (d || 1)) * 2;
    }
  }
  let mx = 0;
  let my = 0;
  if (cn) {
    cx /= cn;
    cy /= cn;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    // 접선 (시계 방향) + 거리 60 유지
    mx += (-dy / d) * 0.8 + (dx / d) * (60 - d) * 0.02;
    my += (dx / d) * 0.8 + (dy / d) * (60 - d) * 0.02;
  }
  mx += rx * 2.2;
  my += ry * 2.2;
  let gd = 1e9;
  let gx = 0;
  let gy = 0;
  for (const g of r.gems) {
    const d = (g.x - p.x) ** 2 + (g.y - p.y) ** 2;
    if (d < gd) (gd = d), (gx = g.x - p.x), (gy = g.y - p.y);
  }
  for (const k of r.pickups) {
    const d = (k.x - p.x) ** 2 + (k.y - p.y) ** 2 / 4;
    if (d < gd) (gd = d), (gx = k.x - p.x), (gy = k.y - p.y);
  }
  // 맵 오브젝트: 안 위험할 때 들름 (시련 중이면 원 안에)
  const trial = r.things.find((t) => t.alive && t.k === "trial" && t.on);
  if (trial) {
    const dx = trial.x - p.x;
    const dy = trial.y - p.y;
    const d = Math.hypot(dx, dy * 1.25);
    if (d > TRIAL_R * 0.5) {
      mx += (dx / (d || 1)) * 2;
      my += (dy / (d || 1)) * 2;
    }
  } else if (close === 0 && p.hp > maxHpOf(r) * 0.4) {
    let best = 1e9;
    let tx = 0;
    let ty = 0;
    for (const t of r.things) {
      if (!t.alive) continue;
      if (t.k === "box" && p.gold < t.cost) continue;
      if ((t.k === "merchant" || t.k === "fountain") && seen.has(t.id)) continue;
      if (t.k === "merchant" && p.gold < 40) continue;
      const d = (t.x - p.x) ** 2 + (t.y - p.y) ** 2;
      if (d < best && d < 520 ** 2) (best = d), (tx = t.x - p.x), (ty = t.y - p.y);
    }
    if (best < 1e9 && !(gd < 70 ** 2)) {
      const l = Math.hypot(tx, ty) || 1;
      mx += (tx / l) * 0.9;
      my += (ty / l) * 0.9;
    } else if (gd < 1e9) {
      const gl = Math.hypot(gx, gy) || 1;
      mx += (gx / gl) * 0.7;
      my += (gy / gl) * 0.7;
    }
  }
  if (r.arena) {
    mx += (r.arena.x - p.x) / 200;
    my += (r.arena.y - p.y) / 120;
  }
  return { mx, my, dash: close > 4 || Math.hypot(rx, ry) > 1.2, ult: p.ult >= 100 && cn > 20 };
}

const maxHpOf = (r: Run) => maxHp(r);

const rows: ReturnType<typeof result>[] = [];
// 레벨 정체 · 몰아서 레벨업 확인: 10초 동안 오른 레벨 최대 · 20초 넘게 안 오른 구간 수 · 젬 수 최대
let jumpMax = 0;
let stalls = 0;
let gemMax = 0;
const lvAt: Record<number, number[]> = { 60: [], 180: [], 300: [], 480: [] };
const t0 = Date.now();
let ticks = 0;
let maxEn = 0;
for (let i = 0; i < N; i++) {
  const hero = only ?? HERO_IDS[i % HERO_IDS.length];
  const r = newRun(hero, 1000 + i, {}, { depth: DEPTH, weapons: un.weapons, relics: un.relics, rerolls: un.rerolls, skips: un.skips, banish: un.banish, gold: un.gold, stage: STAGE, army: ARMY });
  let guard = 0;
  let lv10 = 1;
  let lastUp = 0;
  let lastLv = 1;
  while (!r.over && guard++ < 60 * (RUN_SEC + 900)) {
    const pz = r.pause;
    if (pz) {
      if (pz.k === "chest") closeChest(r);
      else if (pz.k === "bless") chooseBless(r, 0);
      else if (pz.k === "wish") chooseWish(r, 0);
      else if (pz.k === "shop") {
        const k = pz.offers.findIndex((o) => o.price <= r.p.gold);
        if (k >= 0) buyRelic(r, k);
        else leaveThing(r);
      } else if (pz.k === "dawn") dawnChoice(r, OT);
      else {
        // 진화 · 합체 먼저, 무기, 그다음 아무거나
        const cards = pz.cards;
        const k = cards.findIndex((c) => c.k === "fuse" || c.k === "evo" || c.k === "awake");
        const w = cards.findIndex((c) => c.k === "weapon");
        chooseCard(r, k >= 0 ? k : w >= 0 && r.weapons.length < 4 ? w : r.tick % cards.length);
      }
      continue;
    }
    if (r.army && r.tick % 30 === 0) {
      while (armyCraft(r) || armyMerge(r));
      if (r.p.gold > 60 + r.army.bought * 2) armyBuy(r);
    }
    const inp = botInput(r);
    if (process.env.TRACE === String(1000 + i) && r.tick % 300 === 0) {
      const near = r.things.filter((t) => t.alive).map((t) => `${t.k}@${Math.round(Math.hypot(t.x - r.p.x, t.y - r.p.y))}${t.on ? "*" : ""}${t.t ? ":" + t.t.toFixed(1) : ""}`).join(" ");
      console.log(Math.floor(r.t), "lv", r.p.lv, "gems", r.gems.length, "kills", r.p.kills, "hp", Math.round(r.p.hp), "pos", Math.round(r.p.x), Math.round(r.p.y), "in", inp.mx.toFixed(2), inp.my.toFixed(2), "|", near);
    }
    step(r, inp);
    r.ev.length = 0;
    ticks++;
    if (r.gems.length > gemMax) gemMax = r.gems.length;
    if (r.p.lv !== lastLv) {
      if (r.t - lastUp > 20 && r.t < 600) {
        stalls++;
        if (process.env.STALL) console.log("정체", hero, Math.round(lastUp), "→", Math.round(r.t), "lv", r.p.lv, "젬", r.gems.length, "보스", r.bossId >= 0);
      }
      lastUp = r.t;
      lastLv = r.p.lv;
    }
    if (r.tick % 600 === 0) {
      jumpMax = Math.max(jumpMax, r.p.lv - lv10);
      lv10 = r.p.lv;
    }
    if (r.enemies.length > maxEn) maxEn = r.enemies.length;
    for (const s of Object.keys(lvAt)) if (r.tick === Number(s) * 60) lvAt[Number(s)].push(r.p.lv);
  }
  rows.push(result(r));
  if (process.argv.includes("v")) console.log(hero, r.win ? "WIN" : `dead ${Math.floor(r.t)}s`, `lv${r.p.lv} curse ${r.curse.toFixed(2)} 종${r.q.bells} 상${r.q.statues} 시련${r.q.trials} 성소${r.q.shrines} 유물${r.q.relics} 금화${r.p.gold} hp${maxHp(r)}`);
}
const ms = Date.now() - t0;
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log(`${N}판 · ${(ms / 1000).toFixed(1)}s · 틱당 ${((ms / ticks) * 1000).toFixed(0)}µs · 최대 적 ${maxEn}`);
console.log(`클리어 ${rows.filter((r) => r.win).length}/${N} · 평균 생존 ${avg(rows.map((r) => r.sec)).toFixed(0)}s · 레벨 ${avg(rows.map((r) => r.lv)).toFixed(1)} · 처치 ${avg(rows.map((r) => r.kills)).toFixed(0)} · 금화 ${avg(rows.map((r) => r.gold)).toFixed(0)} · 오버타임 ${avg(rows.map((r) => r.ot)).toFixed(0)}s`);
console.log("레벨(1·3·5·8분)", Object.entries(lvAt).map(([k, v]) => `${k}s=${avg(v).toFixed(1)}`).join(" "));
const byHero: Record<string, number[]> = {};
for (const r of rows) (byHero[r.hero] ??= []).push(r.win ? 1 : 0);
console.log("캐릭터 클리어율", Object.entries(byHero).map(([h, v]) => `${h} ${(avg(v) * 100).toFixed(0)}%`).join(" · "));
const dead = rows.filter((r) => !r.win).map((r) => r.sec).sort((a, b) => a - b);
console.log("죽은 시각", dead.join(","));
console.log("합체", rows.flatMap((r) => r.fused).join(",") || "없음");
const qa = (k: keyof (typeof rows)[number]["q"]) => avg(rows.map((r) => r.q[k])).toFixed(1);
console.log(`맵 ${STAGE} · 종 ${qa("tolls")} · 중간 보스 처치 ${rows.filter((r) => r.q.jelly || r.q.cuckoo).length}/${N}`);
console.log(`판당: 상자 ${qa("chests")} · 금화상자 ${qa("boxes")} · 성소 ${qa("shrines")} · 깃발 ${qa("flags")} · 고양이상 ${qa("statues")} · 종 ${qa("bells")} · 상인 ${qa("buys")} · 우물 ${qa("fountains")} · 시련 ${qa("trials")} · 진화 ${qa("evos")} · 각성 ${qa("awakens")} · 유물 ${qa("relics")} · 전설 ${qa("legends")}`);
console.log("무기 풀", un.weapons.length, "/", SHARED_WEAPONS.length, "· 유물 풀", un.relics.length, "/", RELIC_IDS.length);
if (ARMY) {
  const best = rows.map((r) => Math.max(0, ...(r.army ?? []).map((u) => UNIT[u.id].grade)));
  console.log(`부대: 평균 인원 ${avg(rows.map((r) => r.army?.length ?? 0)).toFixed(1)} · 최고 등급 평균 ${avg(best).toFixed(1)} · 신화 이상 ${best.filter((g) => g >= 4).length}/${N}판`);
}
console.log(`10초 최대 레벨업 ${jumpMax} · 20초+ 정체 ${stalls}회 · 젬 최대 ${gemMax}`);
console.log("xpNeed", [1, 5, 10, 20, 30, 40].map((l) => `${l}:${xpNeed(l)}`).join(" "));
