/*
 * 픽셀 타운 서바이버 밸런스 시뮬 — 봇이 적을 피해 다니며 카드를 고름.
 *   npx tsx scripts/survivor-sim.ts [판 수] [캐릭터]
 */
import { HERO_IDS, RUN_SEC, xpNeed, type HeroId } from "../../web/src/lib/survivor/data";
import { chooseCard, closeChest, newRun, result, step, type Input, type Run } from "../../web/src/lib/survivor/sim";

const N = Number(process.argv[2] ?? 20);
const only = process.argv[3] as HeroId | undefined;

function botInput(r: Run): Input {
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
  if (gd < 1e9 && close === 0) {
    const gl = Math.hypot(gx, gy) || 1;
    mx += (gx / gl) * 0.7;
    my += (gy / gl) * 0.7;
  }
  if (r.arena) {
    mx += (r.arena.x - p.x) / 200;
    my += (r.arena.y - p.y) / 120;
  }
  return { mx, my, dash: close > 4 || Math.hypot(rx, ry) > 1.2, ult: p.ult >= 100 && cn > 20 };
}

const rows: ReturnType<typeof result>[] = [];
const lvAt: Record<number, number[]> = { 60: [], 180: [], 300: [], 480: [] };
const t0 = Date.now();
let ticks = 0;
let maxEn = 0;
for (let i = 0; i < N; i++) {
  const hero = only ?? HERO_IDS[i % HERO_IDS.length];
  const r = newRun(hero, 1000 + i);
  let guard = 0;
  while (!r.over && guard++ < 60 * (RUN_SEC + 400)) {
    if (r.pause) {
      if (r.pause.k === "chest") closeChest(r);
      else {
        // 무기 먼저, 그다음 아무거나
        const cards = r.pause.cards;
        const k = cards.findIndex((c) => c.k === "fuse");
        const w = cards.findIndex((c) => c.k === "weapon");
        chooseCard(r, k >= 0 ? k : w >= 0 && r.weapons.length < 4 ? w : (r.tick % cards.length));
      }
      continue;
    }
    step(r, botInput(r));
    r.ev.length = 0;
    ticks++;
    if (r.enemies.length > maxEn) maxEn = r.enemies.length;
    for (const s of Object.keys(lvAt)) if (r.tick === Number(s) * 60) lvAt[Number(s)].push(r.p.lv);
  }
  rows.push(result(r));
}
const ms = Date.now() - t0;
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log(`${N}판 · ${(ms / 1000).toFixed(1)}s · 틱당 ${((ms / ticks) * 1000).toFixed(0)}µs · 최대 적 ${maxEn}`);
console.log(`클리어 ${rows.filter((r) => r.win).length}/${N} · 평균 생존 ${avg(rows.map((r) => r.sec)).toFixed(0)}s · 레벨 ${avg(rows.map((r) => r.lv)).toFixed(1)} · 처치 ${avg(rows.map((r) => r.kills)).toFixed(0)} · 코인 ${avg(rows.map((r) => r.coins)).toFixed(0)}`);
console.log("레벨(1·3·5·8분)", Object.entries(lvAt).map(([k, v]) => `${k}s=${avg(v).toFixed(1)}`).join(" "));
const byHero: Record<string, number[]> = {};
for (const r of rows) (byHero[r.hero] ??= []).push(r.win ? 1 : 0);
console.log("캐릭터 클리어율", Object.entries(byHero).map(([h, v]) => `${h} ${(avg(v) * 100).toFixed(0)}%`).join(" · "));
const dead = rows.filter((r) => !r.win).map((r) => r.sec).sort((a, b) => a - b);
console.log("죽은 시각", dead.join(","));
console.log("합체", rows.flatMap((r) => r.fused).join(",") || "없음");
console.log("xpNeed", [1, 5, 10, 20, 30, 40].map((l) => `${l}:${xpNeed(l)}`).join(" "));
