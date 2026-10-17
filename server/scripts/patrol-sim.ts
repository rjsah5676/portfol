/*
 * 픽셀 순찰대 챕터 밸런스 시뮬 — 서바이버 봇(survivor-sim)으로 챕터를 장비 묶음별로 돌림.
 *   npx tsx scripts/patrol-sim.ts [판 수] [스테이지 전체 번호 1~15] [장비: start | mid | strong | 공격,체력]
 */
import { TRIAL_R } from "../../web/src/lib/survivor/data";
import { chooseBless, chooseCard, closeChest, maxHp, newRun, result, step, type Input, type Run } from "../../web/src/lib/survivor/sim";
import { stName, stage } from "../../web/src/lib/patrol/chapters";
import { ATK_PCT, power, type GearItem } from "../../web/src/lib/patrol/gear";

const N = Number(process.argv[2] ?? 20);
const CH = Number(process.argv[3] ?? 1);
const KIT = process.argv[4] ?? "start";
const it = (id: GearItem["id"], g: GearItem["g"], lv: number): GearItem => ({ uid: id, id, g, lv });
const SETS: Record<string, GearItem[]> = {
  /** 시작 선물 그대로 */
  start: [it("w_shuriken", 0, 1), it("a_jumper", 0, 1)],
  /** 챕터 1~2를 깨고 상자 몇 개 · 강화 조금 (맛보기 30분쯤) */
  mid: [it("w_shuriken", 1, 8), it("n_firefly", 2, 5), it("g_leather", 1, 5), it("a_jumper", 1, 8), it("b_tool", 0, 5), it("s_sneaker", 1, 1)],
  /** 하루쯤 */
  strong: [it("w_shuriken", 2, 15), it("n_firefly", 2, 12), it("g_leather", 2, 10), it("a_jumper", 2, 12), it("b_tool", 1, 10), it("s_sneaker", 1, 10)],
};
const gp = SETS[KIT] ? power(SETS[KIT]) : (() => {
  const [a, h] = KIT.split(",").map(Number);
  return { atk: a, hp: h, weapon: "shuriken" as const, wlv: 1, relics: [] };
})();
const ch = { ...stage(CH)!, ...(process.env.HP && { hp: Number(process.env.HP) }), ...(process.env.DMG && { dmg: Number(process.env.DMG) }), ...(process.env.XP && { xp: Number(process.env.XP) }) };

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
const lvAt: Record<number, number[]> = { 60: [], 150: [], 295: [] };
/** 체력 최저 비율 (분마다) — 판 중간에 얼마나 위태로웠나 */
const lowAt: number[][] = Array.from({ length: 9 }, () => []);
for (let i = 0; i < N; i++) {
  const r = newRun("bandi", 5000 + i, { maxHp: gp.hp }, { chapter: ch, gear: { atk: gp.atk * ATK_PCT, weapon: gp.weapon, wlv: gp.wlv, relics: gp.relics } });
  let guard = 0;
  while (!r.over && guard++ < 60 * (ch.len + 400)) {
    const pz = r.pause;
    if (pz) {
      if (pz.k === "chest") closeChest(r);
      else if (pz.k === "bless") chooseBless(r, 0);
      else if (pz.k === "level") {
        const cards = pz.cards;
        const k = cards.findIndex((c) => c.k === "fuse" || c.k === "evo" || c.k === "awake");
        const w = cards.findIndex((c) => c.k === "weapon");
        chooseCard(r, k >= 0 ? k : w >= 0 && r.weapons.length < 4 ? w : r.tick % cards.length);
      } else r.pause = null;
      continue;
    }
    step(r, botInput(r));
    r.ev.length = 0;
    const m = Math.floor(r.t / 60);
    if (m < 9) {
      const v = Math.max(0, r.p.hp) / maxHp(r);
      const a = lowAt[m];
      if (a.length <= i) a.push(v);
      else a[i] = Math.min(a[i], v);
    }
    for (const s of Object.keys(lvAt)) if (r.tick === Number(s) * 60) lvAt[Number(s)].push(r.p.lv);
  }
  const res = result(r);
  rows.push(res);
  if (process.argv.includes("v")) console.log(r.win ? "WIN" : `dead ${Math.floor(r.t)}s`, `lv${r.p.lv} 처치${r.p.kills} hp${Math.round(r.p.hp)}/${maxHp(r)} 보스${r.finalAge}s 별${res.ch?.stars.map((x) => (x ? "★" : "☆")).join("")}`);
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const wins = rows.filter((r) => r.win);
console.log(`스테이지 ${stName(CH)} · 장비 ${KIT} (공격 ${gp.atk} · 체력 ${gp.hp} · 효과 ${gp.relics.join(",") || "-"}) · ${N}판`);
console.log(`클리어 ${wins.length}/${N} (${((wins.length / N) * 100).toFixed(0)}%) · 평균 생존 ${avg(rows.map((r) => r.sec)).toFixed(0)}s · 레벨 ${avg(rows.map((r) => r.lv)).toFixed(1)} · 처치 ${avg(rows.map((r) => r.kills)).toFixed(0)} · 별 ${avg(rows.map((r) => r.ch!.stars.filter(Boolean).length)).toFixed(2)}`);
console.log("레벨(1·4·8분)", Object.entries(lvAt).map(([k, v]) => `${k}s=${avg(v).toFixed(1)}`).join(" "));
console.log("분마다 최저 체력%", lowAt.map((a, k) => `${k}m=${(avg(a) * 100).toFixed(0)}`).join(" "));
const dead = rows.filter((r) => !r.win).map((r) => r.sec).sort((a, b) => a - b);
console.log("죽은 시각", dead.join(" "));
