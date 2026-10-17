/*
 * 픽셀 타운 서바이버 — 캔버스 그리기 (512 × 288 도트 화면, 밖에서 정수배로 키움)
 */
import { ENEMIES, FLAG_CHARGE, GUARD_HP, GUARD_R, LAMP_CHARGE, SHRINE_CHARGE, SPOUT_FUSE, SPOUT_R, TRIAL_R, VIEW_H, VIEW_W, WEAPONS, type EnemyKind, type ThingKind } from "@/lib/survivor/data";
import { BEAM_END, BEAM_ON, type Run, type Zone } from "@/lib/survivor/sim";
import { ARMY_GRADE_COLOR, UNIT } from "@/lib/survivor/army";
import { DECO_CELL, decoAt, digits, getArt, tilesFor, TILE_CHUNK, unitArt, type HeroArt, type MobArt } from "./art";

/* ───────────── 화면 효과 (시뮬 밖, 보기만) ───────────── */

export interface Num {
  x: number;
  y: number;
  v: number;
  crit: boolean;
  t: number;
}
export interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  c: string;
  t: number;
  life: number;
  s: number;
}
export interface Ring {
  x: number;
  y: number;
  r: number;
  c: string;
  t: number;
  life: number;
  fill: boolean;
}
export interface Bolt {
  x: number;
  y: number;
  r: number;
  t: number;
  seed: number;
  /** 천둥 심판 (금빛) */
  j?: boolean;
}

export interface Fx {
  nums: Num[];
  parts: Part[];
  rings: Ring[];
  bolts: Bolt[];
  /** 주사위 눈 (주사위 무기 · 필살기) */
  dice: { x: number; y: number; face: number; t: number; big: boolean }[];
  /** 전기 젤리 연쇄 번개 */
  zaps: { x0: number; y0: number; x1: number; y1: number; t: number }[];
  /** 럭키 출격: 유닛 공격 선 · 베기 */
  shots: { x0: number; y0: number; x1: number; y1: number; c: string; melee: boolean; t: number }[];
  shake: number;
  flash: number;
  flashC: string;
  hurt: number;
  /** 플레이어 걷기 프레임 시간 */
  walkT: number;
  /** 타격 멈춤 (실제 초) · 느린 화면 (실제 초) */
  stop: number;
  slow: number;
  /** 등대 섬광 고리 */
  bursts: { x: number; y: number; t: number }[];
  /** 죽는 몹: 하얗게 번쩍 → 맞은 반대쪽으로 튕겨 날아가며 납작해지고 사라짐 */
  corpses: Corpse[];
  /** 바닥 얼룩 (죽은 자리 · 한동안 남음) */
  stains: { x: number; y: number; c: string; seed: number; s: number; t: number }[];
}
export interface Corpse {
  /** 보스: 깜빡이며 떨다가 터짐 (BOSS_DIE 초) */
  boss?: boolean;
  done?: boolean;
  kind: EnemyKind;
  x: number;
  y: number;
  dx: number;
  dy: number;
  face: number;
  big: number;
  t: number;
}
/** 죽는 연출 길이 · 보스 (떨다가 터지는 시각 · 끝) · 얼룩 남는 시간 · 젬 튀는 시간 */
export const CORPSE_T = 0.34;
export const BOSS_BOOM = 0.9;
const BOSS_DIE = 1.25;
const GEM_POP = 0.3;
const STAIN_T = 14;
export const newFx = (): Fx => ({ nums: [], parts: [], rings: [], bolts: [], dice: [], zaps: [], shots: [], shake: 0, flash: 0, flashC: "#ffffff", hurt: 0, walkT: 0, stop: 0, slow: 0, bursts: [], corpses: [], stains: [] });

export function tickFx(fx: Fx, dt: number) {
  for (const n of fx.nums) n.t += dt;
  fx.nums = fx.nums.filter((n) => n.t < (n.crit ? 0.9 : 0.6));
  for (const p of fx.parts) {
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.9;
    p.vy = p.vy * 0.9 + 60 * dt;
  }
  fx.parts = fx.parts.filter((p) => p.t < p.life);
  for (const c of fx.corpses) {
    c.t += dt;
    // 보스가 터지는 순간: 큰 고리 셋 · 조각 · 번쩍 · 흔들림
    if (c.boss && !c.done && c.t >= BOSS_BOOM) {
      c.done = true;
      const col = MOB_COLOR[c.kind];
      for (let i = 0; i < 3; i++) fx.rings.push({ x: c.x + (i - 1) * 14, y: c.y - 14 - i * 6, r: 46 + i * 22, c: i === 1 ? "#ffffff" : col, t: -i * 0.08, life: 0.45, fill: i === 0 });
      for (let i = 0; i < 70; i++) fx.parts.push({ x: c.x, y: c.y - 14, vx: (Math.random() - 0.5) * 420, vy: -Math.random() * 300, c: i % 3 ? col : "#ffffff", t: 0, life: 0.5 + Math.random() * 0.5, s: 3 });
      fx.flash = 1.3;
      fx.flashC = "#ffffff";
      fx.shake = 14;
    }
  }
  fx.corpses = fx.corpses.filter((c) => c.t < (c.boss ? BOSS_DIE : CORPSE_T));
  for (const st of fx.stains) st.t += dt;
  fx.stains = fx.stains.filter((st) => st.t < STAIN_T);
  for (const b of fx.bursts) b.t += dt;
  fx.bursts = fx.bursts.filter((b) => b.t < 0.7);
  for (const r of fx.rings) r.t += dt;
  fx.rings = fx.rings.filter((r) => r.t < r.life);
  for (const b of fx.bolts) b.t += dt;
  fx.bolts = fx.bolts.filter((b) => b.t < 0.25);
  for (const z of fx.shots) z.t += dt;
  fx.shots = fx.shots.filter((z) => z.t < 0.14);
  for (const z of fx.zaps) z.t += dt;
  fx.zaps = fx.zaps.filter((z) => z.t < 0.18);
  for (const d of fx.dice) d.t += dt;
  fx.dice = fx.dice.filter((d) => d.t < (d.big ? 1.4 : 0.7));
  if (fx.dice.length > 30) fx.dice.splice(0, fx.dice.length - 30);
  fx.shake = Math.max(0, fx.shake - dt * 30);
  fx.flash = Math.max(0, fx.flash - dt * 3);
  fx.hurt = Math.max(0, fx.hurt - dt * 2.5);
  if (fx.nums.length > 90) fx.nums.splice(0, fx.nums.length - 90);
  if (fx.parts.length > 500) fx.parts.splice(0, fx.parts.length - 500);
}

const MOB_COLOR: Record<EnemyKind, string> = {
  bat: "#7c4fc4",
  slime: "#4fd8a0",
  ghost: "#dcd6ff",
  skull: "#f2ecdc",
  mush: "#e2405e",
  golem: "#7d8aa6",
  boss_jelly: "#ff6fb5",
  boss_clock: "#c58bff",
  mouse: "#c8d0e4",
  tin: "#d94a4a",
  cuckoo: "#c48a50",
  gear: "#d0a040",
  hourglass: "#ffd27a",
  boss_cuckoo: "#ffb03a",
  boss_tower: "#ffd23a",
  goblin: "#ffd23a",
};
export const mobColor = (k: EnemyKind) => MOB_COLOR[k];

/* ───────────── 그리기 ───────────── */

let night: HTMLCanvasElement | null = null;

export function draw(ctx: CanvasRenderingContext2D, r: Run, fx: Fx, hero: HeroArt | null, time: number, sups: (HeroArt | null)[] = []) {
  const A = getArt();
  const p = r.p;
  const sx = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;
  const sy = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;
  // 카메라: 플레이어가 가운데 (정수 px 에 맞춰 도트가 흔들리지 않게)
  const camX = Math.round(p.x - VIEW_W / 2 + sx);
  const camY = Math.round(p.y - 10 - VIEW_H / 2 + sy);
  const X = (x: number) => Math.round(x - camX);
  const Y = (y: number) => Math.round(y - camY);
  ctx.imageSmoothingEnabled = false;

  // 바닥
  const tiles = tilesFor(r.stage);
  const TS = tiles.width || TILE_CHUNK;
  const ox = ((camX % TS) + TS) % TS;
  const oy = ((camY % TS) + TS) % TS;
  for (let y = -oy; y < VIEW_H; y += TS) for (let x = -ox; x < VIEW_W; x += TS) ctx.drawImage(tiles, x, y);

  // 보스 철창 바닥 테두리
  if (r.arena) drawArenaFloor(ctx, r, X, Y, time);

  // 맵 오브젝트 바닥 표시 (충전 원 · 시련 원)
  for (const t of r.things) {
    if (!t.alive || Math.abs(t.x - p.x) > VIEW_W / 2 + TRIAL_R + 20 || Math.abs(t.y - p.y) > VIEW_H / 2 + TRIAL_R) continue;
    const tx = X(t.x);
    const ty = Y(t.y);
    if (t.k === "shrine" || t.k === "gshrine" || t.k === "flag") {
      const R = t.k === "flag" ? 24 : 30;
      const c = t.k === "gshrine" ? "#ffd23a" : t.k === "flag" ? "#ff9cc8" : "#4ff0c8";
      ctx.globalAlpha = 0.18 + Math.sin(time * 3 + t.id) * 0.05;
      ellipse(ctx, tx, ty, R, R * 0.8, c);
      ctx.globalAlpha = 0.85;
      dotsRing(ctx, tx, ty, R, R * 0.8, c, time * 0.8, 20);
      const k = t.t / (t.k === "flag" ? FLAG_CHARGE : SHRINE_CHARGE);
      if (k > 0) arc(ctx, tx, ty, R, R * 0.8, -Math.PI / 2, Math.PI * 2 * Math.min(1, k), "#ffffff", 3);
      ctx.globalAlpha = 1;
    } else if (t.k === "lamp") {
      if (!t.on) {
        ctx.globalAlpha = 0.16 + Math.sin(time * 3 + t.id) * 0.05;
        ellipse(ctx, tx, ty, 30, 24, "#ffb03a");
        ctx.globalAlpha = 0.85;
        dotsRing(ctx, tx, ty, 30, 24, "#ffb03a", time * 0.8, 20);
        if (t.t > 0) arc(ctx, tx, ty, 30, 24, -Math.PI / 2, Math.PI * 2 * Math.min(1, t.t / LAMP_CHARGE), "#ffffff", 3);
      } else {
        ctx.globalAlpha = 0.12 + Math.sin(time * 5 + t.id) * 0.04;
        ellipse(ctx, tx, ty, 66, 52, "#ffb03a");
      }
      ctx.globalAlpha = 1;
    } else if (t.k === "guard") {
      // 지키는 등불: 따뜻한 빛 원 + 맞으면 깜빡
      ctx.globalAlpha = 0.14 + Math.sin(time * 4 + t.id) * 0.04;
      ellipse(ctx, tx, ty, GUARD_R, GUARD_R * 0.8, "#ffd23a");
      ctx.globalAlpha = 0.8;
      dotsRing(ctx, tx, ty, GUARD_R, GUARD_R * 0.8, "#ffe9a0", time * 0.5, 28);
      ctx.globalAlpha = 1;
    } else if (t.k === "spout" && !t.on) {
      // 물보라 예고: 원이 차오름
      const k = 1 - Math.max(0, t.t) / SPOUT_FUSE;
      ctx.globalAlpha = 0.14;
      ellipse(ctx, tx, ty, SPOUT_R, SPOUT_R * 0.8, "#7ad7ff");
      ctx.globalAlpha = 0.3 + k * 0.3;
      ellipse(ctx, tx, ty, SPOUT_R * k, SPOUT_R * 0.8 * k, "#7ad7ff");
      ctx.globalAlpha = 0.9;
      dotsRing(ctx, tx, ty, SPOUT_R, SPOUT_R * 0.8, "#c8f0ff", -time * 0.6, 36);
      ctx.globalAlpha = 1;
    } else if (t.k === "trial") {
      const pulse = t.on ? 0.22 + Math.sin(time * 8) * 0.08 : 0.1;
      ctx.globalAlpha = pulse;
      ellipse(ctx, tx, ty, TRIAL_R, TRIAL_R * 0.8, "#e0d8ff");
      ctx.globalAlpha = t.on ? 0.95 : 0.6;
      dotsRing(ctx, tx, ty, TRIAL_R, TRIAL_R * 0.8, t.on ? "#ffffff" : "#e0d8ff", -time * 0.4, 48);
      if (!t.on) dotsRing(ctx, tx, ty, TRIAL_R * 0.45, TRIAL_R * 0.36, "#e0d8ff", time, 16);
      ctx.globalAlpha = 1;
    }
  }
  // 보스 내려찍기 예고 (빨간 원이 차오름)
  for (const z of r.zones) {
    if (z.k !== "slam" || z.delay <= 0) continue;
    const k = 1 - Math.min(1, z.delay / 1.0);
    ctx.globalAlpha = 0.22;
    ellipse(ctx, X(z.x), Y(z.y), z.r, z.r * 0.77, "#ff3d6e");
    ctx.globalAlpha = 0.5 + k * 0.4;
    ellipse(ctx, X(z.x), Y(z.y), z.r * k, z.r * 0.77 * k, "#ff3d6e");
    arc(ctx, X(z.x), Y(z.y), z.r, z.r * 0.77, 0, Math.PI * 2, "#ff8fb8", 2);
    ctx.globalAlpha = 1;
  }

  // 그림자 · 장판
  for (const z of r.zones) {
    if (z.k === "drop" || z.k === "moon") {
      // 떨어질 자리: 줄어드는 원
      const k = Math.max(0, z.delay) / 0.6;
      ctx.globalAlpha = 0.35;
      ellipse(ctx, X(z.x), Y(z.y), z.r * (1 - k * 0.4), z.r * 0.55 * (1 - k * 0.4), z.k === "moon" ? "#fff2a8" : "#ffe17a");
      ctx.globalAlpha = 1;
      // 떨어지는 택배
      const h = Math.max(0, z.delay) * 300;
      const s = z.k === "moon" ? 2 : 1;
      ctx.drawImage(A.parcel, X(z.x) - ((A.parcel.width * s) >> 1), Y(z.y) - A.parcel.height * s - h, A.parcel.width * s, A.parcel.height * s);
    } else if (z.k === "grenade" || z.k === "shell") {
      const k = Math.max(0, z.delay);
      ctx.globalAlpha = 0.35;
      ellipse(ctx, X(z.x), Y(z.y), z.r * 0.8, z.r * 0.45, "#ff8a3d");
      ctx.globalAlpha = 1;
      if (z.k === "grenade") {
        // 플레이어 쪽에서 포물선으로 날아옴
        const tot = 0.7;
        const f = 1 - Math.min(1, k / tot);
        const gx = z.dx + (z.x - z.dx) * f;
        const gy = z.dy + (z.y - z.dy) * f - Math.sin(f * Math.PI) * 50;
        ctx.fillStyle = "#170f2e";
        ctx.fillRect(X(gx) - 3, Y(gy) - 3, 7, 7);
        ctx.fillStyle = "#7f9a4a";
        ctx.fillRect(X(gx) - 2, Y(gy) - 2, 5, 5);
        ctx.fillStyle = "#ffd23a";
        ctx.fillRect(X(gx), Y(gy) - 4, 1, 2);
      } else {
        // 하늘에서 떨어지는 포탄
        const h = k * 320;
        ctx.fillStyle = "#170f2e";
        ctx.fillRect(X(z.x) - 4, Y(z.y) - 12 - h, 9, 12);
        ctx.fillStyle = "#4a4f6a";
        ctx.fillRect(X(z.x) - 3, Y(z.y) - 11 - h, 7, 10);
      }
    }
  }
  // 가시 오라
  for (const w of r.weapons) {
    if (WEAPONS[w.id].pattern !== "aura") continue;
    const def = WEAPONS[w.id];
    const size = def.lv[w.lv - 1].size * (1 + r.stats.area);
    ctx.globalAlpha = 0.16 + Math.sin(time * 6) * 0.04;
    ellipse(ctx, X(p.x), Y(p.y - 4), size, size * 0.8, def.color);
    ctx.globalAlpha = 0.6;
    dotsRing(ctx, X(p.x), Y(p.y - 4), size, size * 0.8, def.color, time * 1.5, 18);
    ctx.globalAlpha = 1;
    // 장미 정원: 둘레를 도는 장미꽃
    if (w.id === "rose" && A.proj.rose) {
      const img = A.proj.rose;
      for (let i = 0; i < 8; i++) {
        const a = time * 0.8 + (i / 8) * Math.PI * 2;
        ctx.drawImage(img, Math.round(X(p.x + Math.cos(a) * size) - img.width / 2), Math.round(Y(p.y - 4 + Math.sin(a) * size * 0.8) - img.height / 2));
      }
    }
  }

  // 바닥 얼룩 (죽은 자리)
  for (const st of fx.stains) {
    const x = X(st.x);
    const y = Y(st.y);
    if (x < -20 || y < -20 || x > VIEW_W + 20 || y > VIEW_H + 20) continue;
    ctx.globalAlpha = 0.42 * Math.min(1, (STAIN_T - st.t) / 3);
    ctx.fillStyle = st.c;
    // 픽셀 몇 덩이로 납작한 얼룩
    let h = st.seed;
    for (let i = 0; i < 6; i++) {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      const ox = ((h >> 8) % (st.s * 2 + 1)) - st.s;
      const oy = (((h >> 16) % (st.s + 1)) - (st.s >> 1)) * 0.5;
      const sz = 2 + ((h >> 4) % 3);
      ctx.fillRect(Math.round(x + ox), Math.round(y + oy), sz + 1, sz);
    }
    ctx.globalAlpha = 1;
  }

  // 줍는 것
  for (const g of r.gems) {
    const img = A.gems[g.v >= 60 ? 3 : g.v >= 20 ? 2 : g.v >= 4 ? 1 : 0];
    // 막 떨어진 젬: 죽은 자리에서 포물선으로 톡 (0.3초)
    const age = g.born !== undefined && !g.pull ? r.t - g.born : 1;
    if (age < GEM_POP) {
      const k = age / GEM_POP;
      const e = 1 - (1 - k) * (1 - k);
      const gx = g.ox! + (g.x - g.ox!) * e;
      const gy = g.oy! + (g.y - g.oy!) * e - Math.sin(k * Math.PI) * 9;
      ctx.drawImage(img, Math.round(X(gx) - (img.width >> 1)), Math.round(Y(gy) - (img.height >> 1)));
      continue;
    }
    ctx.drawImage(img, X(g.x) - (img.width >> 1), Y(g.y) - (img.height >> 1) + (g.pull ? 0 : Math.round(Math.sin(time * 4 + g.x) * 0.8)));
  }
  for (const k of r.pickups) {
    const img = A.pick[k.k];
    const bob = Math.round(Math.sin(time * 4 + k.x) * 1.5);
    const x = X(k.x);
    const y = Y(k.y);
    if (k.k === "coin") {
      ctx.drawImage(img, x - (img.width >> 1), y - img.height + bob);
      continue;
    }
    // 젬 · 코인 말고는 크게 + 바닥 빛 고리 + 반짝 (멀리서도 보이게)
    const c = PICK_C[k.k] ?? "#ffe9a0";
    const sc = k.k === "chest" ? 1.6 : 1.8;
    const w = Math.round(img.width * sc);
    const h = Math.round(img.height * sc);
    const pulse = 0.5 + Math.sin(time * 5 + k.x) * 0.5;
    ctx.globalAlpha = 0.22 + pulse * 0.18;
    ellipse(ctx, x, y + 1, w * 0.75, w * 0.3, c);
    ctx.globalAlpha = 0.9;
    dotsRing(ctx, x, y + 1, w * 0.8 + pulse * 2, w * 0.32 + pulse, c, time * 1.5, 12);
    if (k.k === "chest") {
      // 빛기둥
      ctx.globalAlpha = 0.25 + Math.sin(time * 5) * 0.1;
      ctx.fillStyle = "#ffe9a0";
      ctx.fillRect(x - 6, y - 70, 12, 70);
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(img, x - (w >> 1), y - h + bob, w, h);
    // 반짝
    if (Math.floor(time * 3 + k.x) % 3 === 0) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + (w >> 1) - 2, y - h + bob - 1, 2, 2);
    }
  }
  for (const pr of r.props) ctx.drawImage(A.lamp, X(pr.x) - (A.lamp.width >> 1), Y(pr.y) - A.lamp.height + 1);

  // 사람 · 몹 (아래쪽이 앞에)
  type D = { y: number; f: () => void };
  const ds: D[] = [];
  for (const c of fx.corpses) {
    const art = A.mobs[c.kind];
    if (!art) continue;
    ds.push({ y: c.y, f: () => drawCorpse(ctx, c, art, X, Y) });
  }
  for (const e of r.enemies) {
    const art = A.mobs[e.kind];
    const big = e.elite ? 1.7 : 1;
    ds.push({
      y: e.y,
      f: () => {
        const fr = Math.floor(e.t * (e.kind === "bat" ? 8 : 4)) % 2;
        const img = e.flash > 0 ? art.w[fr] : art.f[fr];
        const w = img.width * big;
        const h = img.height * big;
        const ex = X(e.x);
        const ey = Y(e.y);
        // 그림자
        ctx.globalAlpha = 0.35;
        ellipse(ctx, ex, ey + 1, Math.max(4, e.r), Math.max(2, e.r * 0.4), "#05030f");
        ctx.globalAlpha = e.kind === "ghost" ? 0.8 : 1;
        const hover = e.kind === "bat" || e.kind === "ghost" ? Math.round(-6 + Math.sin(e.t * 3) * 2) : 0;
        if (e.face < 0) {
          ctx.save();
          ctx.translate(ex, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(img, Math.round(-w / 2), ey - h + 2 + hover, w, h);
          ctx.restore();
        } else ctx.drawImage(img, Math.round(ex - w / 2), ey - h + 2 + hover, w, h);
        ctx.globalAlpha = 1;
        if (e.elite) {
          // 금테 표시
          ctx.fillStyle = "#ffd23a";
          ctx.fillRect(ex - 1, ey - h - 3 + hover, 3, 3);
        }
        if (e.boss) drawBossExtra(ctx, r, e, ex, ey, h);
        if (e.ice > 0) {
          // 얼음: 하얀 실루엣을 반투명하게 덮어 얼어붙은 느낌
          ctx.globalAlpha = 0.5;
          const wi = art.w[fr];
          if (e.face < 0) {
            ctx.save();
            ctx.translate(ex, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(wi, Math.round(-w / 2), ey - h + 2 + hover, w, h);
            ctx.restore();
          } else ctx.drawImage(wi, Math.round(ex - w / 2), ey - h + 2 + hover, w, h);
          ctx.globalAlpha = 1;
        }
        if (e.poison > 0) {
          ctx.fillStyle = "#a8e05a";
          ctx.fillRect(ex - 2 + Math.round(Math.sin(e.t * 9) * 2), ey - h - 3, 2, 2);
        }
        if (e.slow > 0) {
          ctx.fillStyle = "#9fdcff";
          ctx.fillRect(ex - 3, ey - h - 2, 2, 2);
          ctx.fillRect(ex + 2, ey - h - 4, 2, 2);
        }
      },
    });
  }
  // 럭키 출격 부대
  if (r.army)
    for (const u of r.army.units) {
      const d = UNIT[u.id];
      const h = 26 + Math.min(4, d.grade) * 2 + (d.grade >= 6 ? 4 : 0);
      ds.push({
        y: u.y,
        f: () => {
          const img = unitArt(u.id, h);
          const ux = X(u.x) + (u.anim > 0 && d.range <= 2.3 ? u.face * 3 : 0);
          const uy = Y(u.y);
          const born = Math.min(1, (r.t - u.born) / 0.25);
          const gc = ARMY_GRADE_COLOR[d.grade];
          ctx.globalAlpha = d.grade >= 3 ? 0.55 + Math.sin(time * 6 + u.uid) * 0.2 : 0.45;
          ellipse(ctx, ux, uy + 1, 8 + Math.min(4, d.grade), 3, gc);
          ctx.globalAlpha = 1;
          if (!img) {
            ctx.fillStyle = gc;
            ctx.fillRect(ux - 4, uy - 12, 8, 12);
            return;
          }
          const w = Math.round(h * born);
          ctx.save();
          ctx.translate(ux, uy + Math.round(h * 0.04));
          if (u.face < 0) ctx.scale(-1, 1);
          ctx.drawImage(img, -(w >> 1), -w, w, w);
          ctx.restore();
        },
      });
    }
  // 응원 동료: 뒤에서 둥실 따라옴
  sups.forEach((sa, i) => {
    if (!sa) return;
    const side = i === 0 ? -1 : 1;
    // 둘이 겹치지 않게: 등 뒤 위 · 아래로 갈라 섬
    const ox = -p.face * (sups.length > 1 ? 20 : 18);
    const oy = (sups.length > 1 ? side * 9 - 2 : -6) + Math.sin(time * 3 + i) * 2;
    const sx = p.x + ox;
    const sy = p.y + oy;
    ds.push({
      y: sy - 0.5,
      f: () => {
        const list = p.moving && sa.walk.length ? sa.walk : sa.idle;
        const fr = list[Math.floor(fx.walkT * (p.moving ? 10 : 3) + i) % list.length];
        const img = p.face > 0 ? fr.r : fr.l;
        const fxp = p.face > 0 ? fr.fx : img.width / fr.q - fr.fx;
        ctx.globalAlpha = 0.3;
        ellipse(ctx, X(sx), Y(sy) + 1, 6, 2, "#05030f");
        ctx.globalAlpha = 0.92;
        heroBlit(ctx, img, fr.q, X(sx) - fxp, Y(sy) - fr.fy);
        ctx.globalAlpha = 1;
      },
    });
  });
  ds.push({
    // 럭키 출격이면 부대에 안 가려지게 주인공을 위로
    y: p.y + (r.army ? 30 : 0),
    f: () => {
      const px = X(p.x);
      const py = Y(p.y);
      ctx.globalAlpha = 0.4;
      ellipse(ctx, px, py + 1, 8, 3, "#05030f");
      ctx.globalAlpha = 1;
      if (r.flag) {
        ctx.globalAlpha = 0.5 + Math.sin(time * 10) * 0.2;
        arc(ctx, px, py - 2, 16, 7, 0, Math.PI * 2, "#ff9cc8", 1);
        ctx.globalAlpha = 1;
      }
      if (r.buff.crit > 0 || r.buff.haste > 0) {
        ctx.globalAlpha = 0.55 + Math.sin(time * 12) * 0.25;
        arc(ctx, px, py, 14, 6, 0, Math.PI * 2, r.buff.crit > 0 ? "#ffd23a" : "#7ff0d8", 2);
        ctx.globalAlpha = 1;
      }
      // 무적 깜빡임
      if (p.inv > 0 && Math.floor(time * 20) % 2 === 0 && p.dashT <= 0 && p.ultT <= 0) return;
      if (hero) {
        const list = p.moving && hero.walk.length ? hero.walk : hero.idle;
        // 필살기 자세 (등대: 랜턴을 머리 위로 — 처음 0.5초 동안 차례로, 그다음 마지막 칸)
        const beam = hero.ult?.length ? r.zones.find((z) => z.alive && z.k === "beam") : undefined;
        const fr = beam && hero.ult ? hero.ult[Math.min(hero.ult.length - 1, Math.floor(beam.t * 6))] : list[Math.floor(fx.walkT * (p.moving ? 10 : 3)) % list.length];
        // 프레임이 아직 없으면 (그림 바꾸는 중) 이번 프레임은 건너뜀
        if (!fr) return;
        const img = p.face > 0 ? fr.r : fr.l;
        const fxp = p.face > 0 ? fr.fx : img.width / fr.q - fr.fx;
        if (p.dashT > 0 || p.ultT > 0) {
          ctx.globalAlpha = 0.35;
          heroBlit(ctx, img, fr.q, px - fxp - p.dx * 10, py - fr.fy - p.dy * 10);
          ctx.globalAlpha = 1;
        }
        heroBlit(ctx, img, fr.q, px - fxp, py - fr.fy);
      } else {
        ctx.fillStyle = "#fff";
        ctx.fillRect(px - 5, py - 18, 10, 18);
      }
    },
  });
  // 맵 오브젝트
  for (const t of r.things) {
    if (!t.alive || Math.abs(t.x - p.x) > VIEW_W / 2 + 40 || Math.abs(t.y - p.y) > VIEW_H / 2 + 50) continue;
    const img = t.k === "lamp" || t.k === "guard" ? A.lamp : t.k === "spout" ? (A.deco.fountain ?? A.things.fountain) : A.things[t.k];
    ds.push({
      y: t.y,
      f: () => {
        const bob = t.k === "merchant" ? Math.round(Math.sin(time * 3) * 1) : t.k === "gshrine" || t.k === "shrine" ? Math.round(Math.sin(time * 2 + t.id) * 1.5) : 0;
        ctx.globalAlpha = 0.35;
        ellipse(ctx, X(t.x), Y(t.y) + 1, img.width * 0.4, 3, "#05030f");
        ctx.globalAlpha = 1;
        // 꺼진 가로등은 어둡게
        if (t.k === "lamp" && !t.on) ctx.filter = "brightness(0.4) saturate(0.4)";
        ctx.drawImage(img, X(t.x) - (img.width >> 1), Y(t.y) - img.height + 2 + bob);
        ctx.filter = "none";
        // 물보라: 솟는 물줄기
        if (t.k === "spout" && t.on) {
          const k = 1 - t.t / 1.2;
          ctx.globalAlpha = 1 - k;
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            const d = k * SPOUT_R;
            ctx.fillStyle = i % 2 ? "#c8f0ff" : "#7ad7ff";
            ctx.fillRect(Math.round(X(t.x) + Math.cos(a) * d), Math.round(Y(t.y) - 12 + Math.sin(a) * d * 0.8 - Math.sin(k * Math.PI) * 26), 3, 3);
          }
          ctx.fillStyle = "#e8fbff";
          ctx.fillRect(X(t.x) - 2, Y(t.y) - img.height - Math.sin(k * Math.PI) * 40, 4, Math.sin(k * Math.PI) * 40 + 6);
          ctx.globalAlpha = 1;
        }
        if (t.k === "guard") {
          // 등불 체력 · 남은 시간
          const k = Math.max(0, t.t) / GUARD_HP;
          const bw = 30;
          const bx = X(t.x) - bw / 2;
          const by = Y(t.y) - img.height - 8;
          ctx.fillStyle = "#05030f";
          ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
          ctx.fillStyle = k > 0.5 ? "#ffd23a" : k > 0.25 ? "#ff9c3a" : "#ff3d6e";
          ctx.fillRect(bx, by, Math.round(bw * k), 3);
          const d = digits(String(Math.max(0, Math.ceil(t.cost - r.t))), "#fff6c8", 1);
          ctx.drawImage(d, X(t.x) - (d.width >> 1), by - d.height - 2);
        }
        if (t.k === "box") {
          const d = digits(String(t.cost), r.p.gold >= t.cost ? "#ffd23a" : "#ff8fb8", 1);
          ctx.drawImage(d, X(t.x) - (d.width >> 1) + 3, Y(t.y) - img.height - 8);
          ctx.fillStyle = "#ffd23a";
          ctx.fillRect(X(t.x) - (d.width >> 1) - 3, Y(t.y) - img.height - 7, 4, 4);
        }
      },
    });
  }
  // 맵 장식 (화면 근처 칸만)
  const c0 = Math.floor((camX - 60) / DECO_CELL);
  const c1 = Math.floor((camX + VIEW_W + 60) / DECO_CELL);
  const r0 = Math.floor((camY - 60) / DECO_CELL);
  const r1 = Math.floor((camY + VIEW_H + 80) / DECO_CELL);
  for (let cy = r0; cy <= r1; cy++)
    for (let cx = c0; cx <= c1; cx++) {
      const d = decoAt(r.def.deco, cx, cy);
      if (!d) continue;
      const img = A.deco[d.k];
      if (!img) continue;
      ds.push({ y: d.y, f: () => ctx.drawImage(img, X(d.x) - (img.width >> 1), Y(d.y) - img.height + 2) });
    }
  ds.sort((a, b) => a.y - b.y);
  for (const d of ds) d.f();

  // 회전 우산
  for (const w of r.weapons) {
    const def = WEAPONS[w.id];
    if (def.pattern !== "orbit") continue;
    const lv = def.lv[w.lv - 1];
    const n = lv.n + r.stats.amount;
    const size = lv.size * (1 + r.stats.area);
    for (let i = 0; i < n; i++) {
      const a = w.ang + (i / n) * Math.PI * 2;
      const x = X(p.x + Math.cos(a) * size);
      const y = Y(p.y + Math.sin(a) * size * 0.8);
      ctx.drawImage(A.umbrella, x - (A.umbrella.width >> 1), y - (A.umbrella.height >> 1) - 4);
    }
  }

  // 정권 · 채찍 · 음파
  for (const z of r.zones) {
    const k = z.t / Math.max(0.01, z.life);
    if (z.k === "cone") {
      // 랜턴 빛살은 밤 위에 (아래 「빛」)
      if (r.weapons[z.slot]?.id === "lantern") continue;
      const a = Math.atan2(z.dy, z.dx);
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.fillStyle = "#ffd0c0";
      ctx.beginPath();
      ctx.moveTo(X(z.x), Y(z.y));
      ctx.arc(X(z.x), Y(z.y), z.r * (0.55 + k * 0.45), a - 0.85, a + 0.85);
      ctx.closePath();
      ctx.fill();
      arc(ctx, X(z.x), Y(z.y), z.r * (0.6 + k * 0.4), z.r * (0.6 + k * 0.4), a - 0.8, 1.6, "#ffffff", 2);
      ctx.globalAlpha = 1;
    } else if (z.k === "whip") {
      ctx.globalAlpha = 1 - k;
      const x0 = X(z.x - z.r / 2);
      const w = Math.round(z.r * Math.min(1, k * 3 + 0.3));
      const xs = z.dx > 0 ? x0 : X(z.x + z.r / 2) - w;
      ctx.fillStyle = "#ff9cc8";
      ctx.fillRect(xs, Y(z.y) - 2, w, 4);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(xs, Y(z.y) - 1, w, 1);
      ctx.globalAlpha = 1;
    } else if (z.k === "pulse") {
      const rad = k * z.r;
      ctx.globalAlpha = 1 - k * 0.8;
      arc(ctx, X(z.x), Y(z.y), rad, rad * 0.8, 0, Math.PI * 2, "#7ff0d8", 3);
      arc(ctx, X(z.x), Y(z.y), Math.max(1, rad - 4), Math.max(1, rad - 4) * 0.8, 0, Math.PI * 2, "#ffffff", 1);
      // 음표 몇 개
      ctx.fillStyle = "#7ff0d8";
      for (let i = 0; i < 6; i++) {
        const an = i * 1.05 + z.x * 0.01;
        const nx = X(z.x + Math.cos(an) * rad);
        const ny = Y(z.y + Math.sin(an) * rad * 0.8);
        ctx.fillRect(nx, ny - 4, 1, 5);
        ctx.fillRect(nx - 2, ny, 3, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  // 회오리 발차기 (원호)
  for (const z of r.zones) {
    if (z.k !== "spin") continue;
    const k = z.t / z.life;
    ctx.globalAlpha = 1 - k;
    arc(ctx, X(z.x), Y(z.y - 4), z.r, z.r * 0.8, -Math.PI / 2 + k * Math.PI * 2, Math.PI * 1.2, "#bff2ff", 3);
    arc(ctx, X(z.x), Y(z.y - 4), z.r - 5, (z.r - 5) * 0.8, -Math.PI / 2 + k * Math.PI * 2 - 0.4, Math.PI * 0.9, "#ffffff", 1);
    ctx.globalAlpha = 1;
  }

  // 투사체
  for (const s of r.shots) {
    const def = WEAPONS[s.w];
    const x = X(s.x);
    const y = Y(s.y);
    switch (s.w) {
      case "fireball": {
        ctx.fillStyle = "#ff5a1f";
        ctx.fillRect(x - Math.round(s.vx * 0.02) - 2, y - Math.round(s.vy * 0.02) - 2, 4, 4);
        ctx.fillStyle = "#ffb03a";
        ctx.fillRect(x - 3, y - 3, 6, 6);
        ctx.fillStyle = "#fff3b0";
        ctx.fillRect(x - 1, y - 1, 3, 3);
        break;
      }
      case "shuriken":
        spin(ctx, A.shuriken, x, y, time * 20);
        break;
      case "gale":
        // 질풍 수리검: 하늘색 꼬리
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#bff2ff";
        ctx.fillRect(x - Math.round(s.vx * 0.03) - 2, y - Math.round(s.vy * 0.03) - 1, 4, 3);
        ctx.globalAlpha = 1;
        spin(ctx, A.proj.gale ?? A.shuriken, x, y, time * 30);
        break;
      case "cyclone": {
        if (A.proj.cyclone) {
          spin(ctx, A.proj.cyclone, x, y, time * 16);
          ctx.globalAlpha = 0.45;
          arc(ctx, x, y, s.r + 2, s.r * 0.8, time * 12, 4, "#ffb03a", 1);
          ctx.globalAlpha = 1;
          break;
        }
        const q = Math.floor(time * 14) % 4;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((q * Math.PI) / 2);
        ctx.drawImage(A.boomerang, -A.boomerang.width, -A.boomerang.height, A.boomerang.width * 2, A.boomerang.height * 2);
        ctx.restore();
        ctx.globalAlpha = 0.5;
        arc(ctx, x, y, s.r + 2, s.r * 0.8, time * 12, 4, "#ffd07a", 1);
        ctx.globalAlpha = 1;
        break;
      }
      case "lance": {
        const a = Math.atan2(s.vy, s.vx);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.fillStyle = "#170f2e";
        ctx.fillRect(-12, -2, 22, 4);
        ctx.fillStyle = "#ffe14a";
        ctx.fillRect(-11, -1, 20, 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(6, -1, 4, 2);
        ctx.restore();
        break;
      }
      case "apple":
        ctx.fillStyle = "#170f2e";
        circle(ctx, x, y, 6);
        ctx.fillStyle = "#e2405e";
        circle(ctx, x, y, 5);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x - 3, y - 3, 2, 2);
        ctx.fillStyle = "#5fa05a";
        ctx.fillRect(x, y - 7, 3, 2);
        break;
      case "cards":
        if (s.wolf) {
          // 늑대 (빨간망토 필살기)
          const f = s.vx < 0 ? -1 : 1;
          ctx.fillStyle = "#170f2e";
          ctx.fillRect(x - 10, y - 7, 20, 11);
          ctx.fillStyle = "#8a8fa8";
          ctx.fillRect(x - 9, y - 6, 18, 9);
          ctx.fillRect(x + f * 8 - 2, y - 10, 5, 5);
          ctx.fillStyle = "#ff3d6e";
          ctx.fillRect(x + f * 9, y - 8, 1, 1);
          ctx.fillStyle = "#c9cde0";
          ctx.fillRect(x - f * 12, y - 6, 4, 2);
        } else {
          const q = Math.floor(time * 12 + s.x) % 2;
          ctx.fillStyle = "#170f2e";
          ctx.fillRect(x - 3, y - 4, q ? 7 : 5, 9);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x - 2, y - 3, q ? 5 : 3, 7);
          ctx.fillStyle = "#b48cff";
          ctx.fillRect(x - 1, y - 1, q ? 3 : 1, 2);
        }
        break;
      case "dice6":
      case "roll": {
        const c = s.w === "roll" ? "#ffd23a" : "#ffffff";
        ctx.fillStyle = "#170f2e";
        ctx.fillRect(x - 4, y - 4, 9, 9);
        ctx.fillStyle = c;
        ctx.fillRect(x - 3, y - 3, 7, 7);
        ctx.fillStyle = "#170f2e";
        const f = Math.floor(time * 10 + s.x) % 3;
        if (f === 0) ctx.fillRect(x, y, 1, 1);
        else if (f === 1) (ctx.fillRect(x - 2, y - 2, 1, 1), ctx.fillRect(x + 2, y + 2, 1, 1));
        else (ctx.fillRect(x - 2, y - 2, 1, 1), ctx.fillRect(x, y, 1, 1), ctx.fillRect(x + 2, y + 2, 1, 1));
        break;
      }
      case "coins":
        ctx.drawImage(A.pick.coin, x - (A.pick.coin.width >> 1), y - (A.pick.coin.height >> 1));
        break;
      case "circus": {
        const rr = Math.round(s.r);
        ctx.fillStyle = "#170f2e";
        circle(ctx, x, y, rr + 1);
        ctx.fillStyle = "#ff5fa0";
        circle(ctx, x, y, rr);
        ctx.fillStyle = "#ffd23a";
        ctx.fillRect(x - rr + 1, y - 2, rr * 2 - 2, 4);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x - Math.round(rr / 2), y - Math.round(rr / 2) - 1, 2, 2);
        break;
      }
      case "boomerang":
        spin(ctx, A.boomerang, x, y, time * 14);
        break;
      case "barrage":
        if (A.proj.barrage) {
          const img = A.proj.barrage;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.round(Math.atan2(s.vy, s.vx) / (Math.PI / 8)) * (Math.PI / 8));
          ctx.drawImage(img, -(img.width >> 1), -(img.height >> 1));
          ctx.restore();
          break;
        }
      // falls through
      case "missile":
      case "blades": {
        const a = Math.atan2(s.vy, s.vx);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        if (s.w === "missile" || s.w === "barrage") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(-6, -1, 3, 2);
          ctx.fillStyle = def.color;
          ctx.fillRect(-3, -2, 7, 4);
          ctx.fillStyle = "#ffd23a";
          ctx.fillRect(4, -1, 2, 2);
        } else {
          ctx.fillStyle = "#fff6c8";
          ctx.fillRect(-5, -1, 10, 2);
          ctx.fillStyle = def.color;
          ctx.fillRect(-7, -2, 3, 4);
          ctx.fillRect(5, 0, 2, 1);
        }
        ctx.restore();
        break;
      }
      case "rainbow":
        if (A.proj.rainbow) {
          const img = A.proj.rainbow;
          const sz = Math.round(s.r * 2 + 2);
          ctx.drawImage(img, x - (sz >> 1), y - (sz >> 1), sz, sz);
          break;
        }
      // falls through
      case "ball":
      case "pinball": {
        const rr = Math.round(s.r);
        // 바닥 그림자 (공이 땅 위를 굴러다니게) · 부딪히면 찌그러짐
        ctx.globalAlpha = 0.35;
        ellipse(ctx, x, y + rr + 1, rr * 0.9, Math.max(1, rr * 0.35), "#05030f");
        ctx.globalAlpha = 1;
        const k = (s.sq ?? 0) / 0.12;
        const a = Math.atan2(s.vy, s.vx);
        // 도트 공 (빛 · 그늘 · 테두리를 픽셀로) — 부딪히면 날아가던 방향으로 찌그러짐
        const img = ballArt(rr, s.w === "rainbow" ? `hsl(${(Math.floor(time * 12 + s.x / 40) % 12) * 30} 95% 62%)` : def.color);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.scale(1 - k * 0.3, 1 + k * 0.3);
        ctx.rotate(-a);
        ctx.drawImage(img, -(img.width >> 1), -(img.height >> 1));
        ctx.restore();
        break;
      }
      default:
        ctx.fillStyle = def.color;
        ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    // 각성 무기: 금빛 반짝이
    if (s.slot >= 0 && r.weapons[s.slot]?.awake && Math.floor(time * 16 + s.x) % 3 === 0) {
      ctx.fillStyle = "#ffd23a";
      ctx.fillRect(x - Math.round(s.vx * 0.02) - 1, y - Math.round(s.vy * 0.02) - 3, 2, 2);
      ctx.fillStyle = "#fff6c8";
      ctx.fillRect(x + 3, y + 1, 1, 1);
    }
  }

  // 적 탄
  for (const b of r.bullets) {
    const x = X(b.x);
    const y = Y(b.y);
    ctx.fillStyle = "#170f2e";
    circle(ctx, x, y, 4);
    ctx.fillStyle = "#c58bff";
    circle(ctx, x, y, 3);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 1, y - 1, 1, 1);
  }

  // 폭발 · 고리
  for (const g of fx.rings) {
    if (g.t < 0) continue;
    const k = g.t / g.life;
    ctx.globalAlpha = (1 - k) * (g.fill ? 0.5 : 0.9);
    const rr = g.r * (0.4 + k * 0.6);
    if (g.fill) ellipse(ctx, X(g.x), Y(g.y), rr, rr * 0.8, g.c);
    else arc(ctx, X(g.x), Y(g.y), rr, rr * 0.8, 0, Math.PI * 2, g.c, 2);
    ctx.globalAlpha = 1;
  }
  // 번개
  for (const b of fx.bolts) {
    const k = b.t / 0.25;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = b.j ? "#fff0a0" : "#e8dcff";
    let bx = X(b.x);
    let by = Y(b.y) - 150;
    let s = b.seed;
    while (by < Y(b.y)) {
      s = (s * 9301 + 49297) % 233280;
      const nx = bx + Math.round((s / 233280 - 0.5) * 8);
      ctx.fillRect(Math.min(bx, nx), by, Math.abs(nx - bx) + 2, 7);
      bx = nx;
      by += 7;
    }
    ctx.fillStyle = "#c8a6ff";
    ellipse(ctx, X(b.x), Y(b.y), b.r, b.r * 0.6, b.j ? "#ffd23a" : "#c8a6ff");
    if (b.j && A.proj.spark) {
      const img = A.proj.spark;
      const sz = Math.round(img.width * (1.2 + k));
      ctx.drawImage(img, X(b.x) - (sz >> 1), Y(b.y) - (sz >> 1) - 2, sz, sz);
    }
    ctx.globalAlpha = 1;
  }
  // 럭키 출격: 유닛 공격
  for (const z of fx.shots) {
    const k = 1 - z.t / 0.14;
    ctx.globalAlpha = k;
    ctx.strokeStyle = z.c;
    if (z.melee) {
      // 베기: 맞은 자리에 짧은 호
      ctx.lineWidth = 2;
      ctx.beginPath();
      const a0 = Math.atan2(z.y1 - z.y0, z.x1 - z.x0);
      ctx.arc(X(z.x1), Y(z.y1), 7 + z.t * 40, a0 - 1, a0 + 1);
      ctx.stroke();
    } else {
      ctx.lineWidth = 1;
      ctx.beginPath();
      const t0 = Math.max(0, z.t / 0.14 - 0.3);
      ctx.moveTo(X(z.x0 + (z.x1 - z.x0) * t0), Y(z.y0 + (z.y1 - z.y0) * t0));
      ctx.lineTo(X(z.x1), Y(z.y1));
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(X(z.x1) - 1, Y(z.y1) - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  // 연쇄 번개
  for (const z of fx.zaps) {
    ctx.globalAlpha = 1 - z.t / 0.18;
    ctx.strokeStyle = "#ffe14a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(z.x0), Y(z.y0));
    const mx = (z.x0 + z.x1) / 2 + Math.sin(z.t * 90) * 6;
    const my = (z.y0 + z.y1) / 2 + Math.cos(z.t * 90) * 6;
    ctx.lineTo(X(mx), Y(my));
    ctx.lineTo(X(z.x1), Y(z.y1));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 조각
  for (const pt of fx.parts) {
    ctx.globalAlpha = 1 - pt.t / pt.life;
    ctx.fillStyle = pt.c;
    ctx.fillRect(X(pt.x), Y(pt.y), pt.s, pt.s);
  }
  ctx.globalAlpha = 1;

  // 밤 (플레이어 · 가로등 · 상자 주변만 밝게)
  drawNight(ctx, r, X, Y, time);

  // 빛 (밤 위에 더해 그림): 랜턴 빛살 · 불씨 · 등대
  drawLight(ctx, r, X, Y, time);
  drawBursts(ctx, fx, X, Y);

  // 불바다 · 소나기 (화면 전체)
  for (const z of r.zones) {
    if (z.k === "fire") {
      ctx.globalAlpha = 0.18 + Math.sin(time * 20) * 0.05;
      ctx.fillStyle = "#ff5a1f";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 0.8;
      for (let i = 0; i < 40; i++) {
        const fx2 = (i * 53 + Math.floor(time * 60) * 7) % VIEW_W;
        const fy2 = VIEW_H - ((i * 37 + Math.floor(time * 90)) % VIEW_H);
        ctx.fillStyle = i % 2 ? "#ffb03a" : "#ff5a1f";
        ctx.fillRect(fx2, fy2, 3, 5);
      }
      ctx.globalAlpha = 1;
    } else if (z.k === "rain") {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#5fc8ff";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#bfe8ff";
      for (let i = 0; i < 70; i++) {
        const rx = (i * 71 + Math.floor(time * 40) * 3) % VIEW_W;
        const ry = (i * 43 + Math.floor(time * 300)) % VIEW_H;
        ctx.fillRect(rx, ry, 1, 6);
      }
      ctx.globalAlpha = 1;
    }
  }

  // 주사위 눈
  for (const d of fx.dice) drawDie(ctx, X(d.x), Y(d.y) - Math.round(Math.min(d.t, 0.2) * 60), d.face, d.big ? 4 : 2, d.t < 0.12 ? 1.3 : 1, 1 - Math.max(0, d.t - (d.big ? 1 : 0.45)) * 3);

  // 피해 숫자
  for (const n of fx.nums) {
    const k = n.t / (n.crit ? 0.9 : 0.6);
    const img = digits(String(n.v), n.crit ? "#ffd23a" : "#ffffff", n.crit ? 2 : 1);
    const pop = n.crit && n.t < 0.08 ? 1.3 : 1;
    ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
    ctx.drawImage(img, X(n.x) - Math.round((img.width * pop) / 2), Y(n.y) - 6 - Math.round(n.t * 28), img.width * pop, img.height * pop);
  }
  ctx.globalAlpha = 1;

  // 보스 돌진 예고선
  for (const e of r.enemies) {
    if (!e.boss || e.boss.phase !== "warn") continue;
    ctx.globalAlpha = 0.45 + Math.sin(time * 30) * 0.25;
    ctx.strokeStyle = "#ff3d6e";
    ctx.lineWidth = e.r * 1.6;
    ctx.beginPath();
    ctx.moveTo(X(e.x), Y(e.y - 8));
    ctx.lineTo(X(e.x + e.boss.dx * 170), Y(e.y - 8 + e.boss.dy * 170));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (r.arena) drawArenaBars(ctx, r, X, Y);
  drawArrows(ctx, r, A.things, time);

  // 피격 · 번쩍
  if (fx.hurt > 0) {
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.3, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.6);
    g.addColorStop(0, "rgba(255,40,80,0)");
    g.addColorStop(1, `rgba(255,40,80,${fx.hurt * 0.5})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (fx.flash > 0) {
    ctx.globalAlpha = Math.min(1, fx.flash) * 0.7;
    ctx.fillStyle = fx.flashC;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
  }
}

/** 죽는 몹 한 마리: 0~0.06초 하얗게 부풀고 → 날아가며 납작 · 흐려짐 */
function drawCorpse(ctx: CanvasRenderingContext2D, c: Corpse, art: MobArt, X: (x: number) => number, Y: (y: number) => number) {
  if (c.boss) {
    // 보스: 하얗게 깜빡이며 점점 세게 떨고 부풀다가 터지는 순간 사라짐
    if (c.t >= BOSS_BOOM) return;
    const k = c.t / BOSS_BOOM;
    const blink = Math.floor(c.t * (8 + k * 22)) % 2 === 0;
    const img = blink ? art.w[0] : art.f[0];
    const sc = c.big * (1 + k * 0.25);
    const w = img.width * sc;
    const h = img.height * sc;
    const jx = (Math.random() - 0.5) * (2 + k * 8);
    const jy = (Math.random() - 0.5) * (1 + k * 4);
    ctx.save();
    ctx.translate(X(c.x) + jx, 0);
    if (c.face < 0) ctx.scale(-1, 1);
    ctx.drawImage(img, Math.round(-w / 2), Math.round(Y(c.y) - h + 2 + jy), Math.round(w), Math.round(h));
    ctx.restore();
    return;
  }
  const k = c.t / CORPSE_T;
  const pop = c.t < 0.06;
  const img = pop ? art.w[0] : art.f[0];
  const ease = 1 - (1 - k) * (1 - k);
  const fly = 22 * c.big * ease;
  const hop = Math.sin(Math.min(1, k * 1.4) * Math.PI) * 7 * c.big;
  const sx = (pop ? 1.25 : 1 + k * 0.35) * c.big;
  const sy = (pop ? 1.25 : 1 - k * 0.65) * c.big;
  const w = img.width * sx;
  const h = img.height * sy;
  const x = X(c.x + c.dx * fly);
  const y = Y(c.y + c.dy * fly * 0.7) - hop;
  ctx.globalAlpha = pop ? 1 : Math.max(0, 1 - k * 1.1);
  ctx.save();
  ctx.translate(x, 0);
  if (c.face < 0) ctx.scale(-1, 1);
  ctx.drawImage(img, Math.round(-w / 2), Math.round(y - h + 2), Math.round(w), Math.round(h));
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** 튕기는 공 도트 그림 (반지름 · 색별로 한 번만 만듦) */
const ballCache = new Map<string, HTMLCanvasElement>();
function ballArt(rr: number, color: string): HTMLCanvasElement {
  const key = `${rr}|${color}`;
  const hit = ballCache.get(key);
  if (hit) return hit;
  const n = rr * 2 + 3;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const g = c.getContext("2d")!;
  // 색 섞기: 바탕색을 한 칸 그려서 읽음
  g.fillStyle = color;
  g.fillRect(0, 0, 1, 1);
  const [R, G, B] = g.getImageData(0, 0, 1, 1).data;
  g.clearRect(0, 0, 1, 1);
  const mix = (t: number, to: number) => `rgb(${Math.round(R + (to - R) * t)},${Math.round(G + (to - G) * t)},${Math.round(B + (to - B) * t)})`;
  const hi = mix(0.45, 255);
  const sh = `rgb(${Math.round(R * 0.62)},${Math.round(G * 0.62)},${Math.round(B * 0.62)})`;
  const o = rr + 1;
  for (let py = 0; py < n; py++)
    for (let px = 0; px < n; px++) {
      const dx = px - o;
      const dy = py - o;
      const d = Math.hypot(dx, dy);
      if (d > rr + 0.6) continue;
      if (d > rr - 0.5) g.fillStyle = "#170f2e";
      else {
        // 왼쪽 위에서 빛
        const l = (-dx - dy) / (rr * 1.4);
        g.fillStyle = l > 0.45 ? hi : l < -0.35 ? sh : color;
      }
      g.fillRect(px, py, 1, 1);
    }
  // 반짝
  g.fillStyle = "#ffffff";
  const sp = Math.max(1, Math.round(rr / 4));
  g.fillRect(o - Math.round(rr / 2), o - Math.round(rr / 2), sp, sp);
  ballCache.set(key, c);
  return c;
}

/** 줍는 것 빛 색 */
const PICK_C: Partial<Record<string, string>> = { meat: "#ff8f8f", magnet: "#7ad7ff", bomb: "#ff9c3a", bag: "#ffd23a", chest: "#ffe9a0" };
const ARROW_C: Record<ThingKind, string> = { shrine: "#4ff0c8", gshrine: "#ffd23a", statue: "#ffd23a", bell: "#ff8a6b", flag: "#ff9cc8", box: "#c58bff", merchant: "#c58bff", fountain: "#7ad7ff", trial: "#e0d8ff", lamp: "#ffb03a", spout: "#7ad7ff", guard: "#ffd23a" };
/** 화면 밖 오브젝트 · 정예 · 보스: 가장자리 화살표 + 작은 그림 */
function drawArrows(ctx: CanvasRenderingContext2D, r: Run, things: Record<ThingKind, HTMLCanvasElement>, time: number) {
  const p = r.p;
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2 + 10;
  const placed: [number, number][] = [];
  const A = getArt();
  type Mark = { x: number; y: number; c: string; img: HTMLCanvasElement; pulse: boolean; far: number };
  const marks: Mark[] = [];
  for (const t of r.things) {
    if (!t.alive) continue;
    const img = t.k === "lamp" || t.k === "guard" ? A.lamp : t.k === "spout" ? (A.deco.fountain ?? things.fountain) : things[t.k];
    marks.push({ x: t.x, y: t.y, c: ARROW_C[t.k], img, pulse: t.k === "trial" || t.k === "merchant" || t.k === "fountain" || t.k === "spout" || t.k === "guard" || (t.k === "lamp" && !t.on), far: t.k === "guard" ? 2000 : 760 });
  }
  // 정예 · 보스 (빨간 화살표, 멀어도 보임)
  for (const e of r.enemies) {
    if (!e.alive || !(e.elite || e.def.boss || e.kind === "goblin")) continue;
    const art = A.mobs[e.kind];
    if (!art) continue;
    marks.push({ x: e.x, y: e.y - 8, c: e.def.boss ? "#ff3d6e" : e.kind === "goblin" ? "#ffd23a" : "#ff8a3d", img: art.f[0], pulse: true, far: 1400 });
  }
  const B = 15; // 칸 반지름
  for (const m of marks) {
    const dx = m.x - p.x;
    const dy = m.y - p.y;
    if (Math.abs(dx) < VIEW_W / 2 - 4 && Math.abs(dy) < VIEW_H / 2 - 4) continue;
    const d = Math.hypot(dx, dy);
    if (d > m.far) continue;
    const k = Math.min((VIEW_W / 2 - B - 10) / Math.abs(dx || 0.01), (VIEW_H / 2 - B - 16) / Math.abs(dy || 0.01));
    let ax = Math.round(cx + dx * k);
    let ay = Math.round(cy + dy * k);
    // 겹치면 가장자리를 따라 비켜 놓음
    for (let n = 0; n < 6 && placed.some(([x, y]) => Math.abs(x - ax) < B * 2 + 2 && Math.abs(y - ay) < B * 2 + 2); n++) {
      if (Math.abs(ax - cx) > VIEW_W / 2 - 40) ay += ay < cy ? B * 2 + 2 : -(B * 2 + 2);
      else ax += ax < cx ? B * 2 + 2 : -(B * 2 + 2);
    }
    placed.push([ax, ay]);
    const a = Math.atan2(dy, dx);
    ctx.globalAlpha = m.pulse ? 0.75 + Math.sin(time * 6) * 0.25 : 0.9;
    ctx.fillStyle = "#07051a";
    ctx.fillRect(ax - B, ay - B, B * 2, B * 2);
    ctx.fillStyle = m.c;
    ctx.fillRect(ax - B + 1, ay - B + 1, B * 2 - 2, 2);
    ctx.fillRect(ax - B + 1, ay + B - 3, B * 2 - 2, 2);
    ctx.fillRect(ax - B + 1, ay - B + 1, 2, B * 2 - 2);
    ctx.fillRect(ax + B - 3, ay - B + 1, 2, B * 2 - 2);
    const sc = Math.min(1.4, (B * 2 - 8) / Math.max(m.img.width, m.img.height));
    ctx.drawImage(m.img, ax - Math.round((m.img.width * sc) / 2), ay - Math.round((m.img.height * sc) / 2), Math.round(m.img.width * sc), Math.round(m.img.height * sc));
    // 방향 삼각형
    const tx = ax + Math.cos(a) * (B + 6);
    const ty = ay + Math.sin(a) * (B + 6);
    ctx.fillStyle = m.c;
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(a) * 6, ty + Math.sin(a) * 6);
    ctx.lineTo(tx + Math.cos(a + 2.4) * 6, ty + Math.sin(a + 2.4) * 6);
    ctx.lineTo(tx + Math.cos(a - 2.4) * 6, ty + Math.sin(a - 2.4) * 6);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawNight(ctx: CanvasRenderingContext2D, r: Run, X: (x: number) => number, Y: (y: number) => number, time: number) {
  if (!night) {
    night = document.createElement("canvas");
    night.width = VIEW_W;
    night.height = VIEW_H;
  }
  const n = night.getContext("2d")!;
  n.globalCompositeOperation = "source-over";
  n.clearRect(0, 0, VIEW_W, VIEW_H);
  // 자정의 종이 울리는 동안은 붉게 맥박
  const toll = r.toll.on > 0 ? 0.5 + Math.sin(time * 6) * 0.5 : 0;
  n.fillStyle = r.toll.on > 0 ? `rgba(${30 + Math.round(toll * 26)}, 6, ${26 - Math.round(toll * 10)}, 0.55)` : r.stage === "clock" ? "rgba(18, 8, 30, 0.52)" : "rgba(8, 6, 32, 0.55)";
  n.fillRect(0, 0, VIEW_W, VIEW_H);
  n.globalCompositeOperation = "destination-out";
  const hole = (x: number, y: number, rad: number, a: number) => {
    const g = n.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    n.fillStyle = g;
    n.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  hole(X(r.p.x), Y(r.p.y - 8), 170, 0.85);
  for (const pr of r.props) hole(X(pr.x), Y(pr.y - 24), 50 + Math.sin(time * 3 + pr.x) * 3, 0.9);
  for (const k of r.pickups) if (k.k !== "coin") hole(X(k.x), Y(k.y - 6), k.k === "chest" ? 44 : 30, 0.9);
  for (const t of r.things) {
    if (!t.alive || t.k === "statue" || t.k === "box") continue;
    if (t.k === "lamp") hole(X(t.x), Y(t.y - 24), t.on ? 96 + Math.sin(time * 3 + t.id) * 4 : 30, t.on ? 0.95 : 0.5);
    if (t.k === "guard") hole(X(t.x), Y(t.y - 20), 90 + Math.sin(time * 3) * 4, 0.95);
    else hole(X(t.x), Y(t.y - 10), t.k === "trial" ? TRIAL_R : 46, t.k === "trial" ? 0.5 : 0.85);
  }
  // 빛나는 장식 (호박등 · 분수)
  const camX = -X(0);
  const camY = -Y(0);
  for (let cy = Math.floor((camY - 60) / DECO_CELL); cy <= Math.floor((camY + VIEW_H + 80) / DECO_CELL); cy++)
    for (let cx = Math.floor((camX - 60) / DECO_CELL); cx <= Math.floor((camX + VIEW_W + 60) / DECO_CELL); cx++) {
      const d = decoAt(r.def.deco, cx, cy);
      if (d?.light) hole(X(d.x), Y(d.y - 10), 44 + Math.sin(time * 4 + cx) * 3, 0.8);
    }
  // 빛 구멍은 부드러운 그라데이션 — 고해상도 화면에서 계단이 지지 않게 부드럽게 늘림
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(night, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

function drawArenaFloor(ctx: CanvasRenderingContext2D, r: Run, X: (x: number) => number, Y: (y: number) => number, time: number) {
  const a = r.arena!;
  ctx.globalAlpha = 0.25 + Math.sin(time * 2) * 0.05;
  ctx.fillStyle = "#3a1f5c";
  ctx.fillRect(X(a.x - a.hw), Y(a.y - a.hh), a.hw * 2, a.hh * 2);
  ctx.globalAlpha = 1;
}
function drawArenaBars(ctx: CanvasRenderingContext2D, r: Run, X: (x: number) => number, Y: (y: number) => number) {
  const a = r.arena!;
  const x0 = X(a.x - a.hw);
  const x1 = X(a.x + a.hw);
  const y0 = Y(a.y - a.hh);
  const y1 = Y(a.y + a.hh);
  ctx.fillStyle = "#170f2e";
  for (let x = x0; x <= x1; x += 8) {
    ctx.fillRect(x, y0 - 14, 3, 14);
    ctx.fillRect(x, y1 - 10, 3, 14);
  }
  for (let y = y0; y <= y1; y += 8) {
    ctx.fillRect(x0 - 2, y - 10, 4, 12);
    ctx.fillRect(x1 - 2, y - 10, 4, 12);
  }
  ctx.fillStyle = "#c58bff";
  ctx.fillRect(x0, y0 - 15, x1 - x0, 2);
  ctx.fillRect(x0, y1 - 11, x1 - x0, 2);
}

function drawBossExtra(ctx: CanvasRenderingContext2D, r: Run, e: Run["enemies"][number], ex: number, ey: number, h: number) {
  // 머리 위 이름 대신 보라 빛 테
  if (e.boss?.enraged) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#ff3d6e";
    ctx.fillRect(ex - 2, ey - h - 6, 4, 4);
    ctx.globalAlpha = 1;
  }
  void r;
}

/* ───────────── 도형 ───────────── */

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, c: string) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, rr: number) {
  ctx.beginPath();
  ctx.arc(x, y, rr, 0, Math.PI * 2);
  ctx.fill();
}
function arc(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a0: number, len: number, c: string, w: number) {
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, a0, a0 + len);
  ctx.stroke();
}
function dotsRing(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, c: string, a0: number, n: number) {
  ctx.fillStyle = c;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    ctx.fillRect(Math.round(x + Math.cos(a) * rx) - 1, Math.round(y + Math.sin(a) * ry) - 1, 2, 2);
  }
}
/** 캐릭터 그림: 고해상도(q 배) 그림을 세계 크기로 부드럽게 (도트 확대가 아니라 원본에서 바로) */
function heroBlit(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, q: number, x: number, y: number) {
  if (q === 1) {
    ctx.drawImage(img, Math.round(x), Math.round(y));
    return;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x, y, img.width / q, img.height / q);
  ctx.imageSmoothingEnabled = false;
}

function spin(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, a: number) {
  // 도트가 뭉개지지 않게 90° 단위로만 돌림
  const q = Math.floor(a / (Math.PI / 2)) % 4;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(img, -(img.width >> 1), -(img.height >> 1));
  ctx.restore();
}

export const enemyName = (k: EnemyKind) => ENEMIES[k].name;

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};
/** 주사위 한 개 (도트) — s = 배율 */
function drawDie(ctx: CanvasRenderingContext2D, x: number, y: number, face: number, s: number, pop: number, a: number) {
  const k = s * pop;
  const w = Math.round(9 * k);
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  ctx.fillStyle = "#170f2e";
  ctx.fillRect(x - (w >> 1) - 1, y - w - 1, w + 2, w + 2);
  ctx.fillStyle = face === 6 ? "#ffd23a" : "#ffffff";
  ctx.fillRect(x - (w >> 1), y - w, w, w);
  ctx.fillStyle = face === 1 ? "#ff3d6e" : "#170f2e";
  const p = Math.max(1, Math.round(k));
  for (const [i, j] of PIPS[face] ?? []) ctx.fillRect(x - (w >> 1) + Math.round((1.5 + i * 2.5) * k) - (p >> 1), y - w + Math.round((1.5 + j * 2.5) * k) - (p >> 1), p + (face === 1 ? p : 0), p + (face === 1 ? p : 0));
  ctx.globalAlpha = 1;
}


/** 반디: 랜턴 빛살 · 불씨 · 등대 빛줄기 — 밤 위에 "lighter" 로 더해 그려서 실제로 밝힘 */
/* ───────────── 반디 빛 그림 (public/patrol/fx · 검은 바탕 = 더해 그림) ───────────── */
const FX_NAMES = ["lens", "beam", "ember", "mote", "ring"] as const;
type FxName = (typeof FX_NAMES)[number];
const fxCache: Partial<Record<FxName, HTMLImageElement | null>> = {};
function fxImg(n: FxName): HTMLImageElement | null {
  if (n in fxCache) return fxCache[n]!;
  fxCache[n] = null;
  if (typeof Image === "undefined") return null;
  const im = new Image();
  im.onload = () => (fxCache[n] = im);
  im.src = `/patrol/fx/${n}.webp`;
  return null;
}
/** 미리 받기 (반디 고르면) */
export function preloadLight() {
  for (const n of FX_NAMES) fxImg(n);
}

/** 등대: 켜짐(렌즈가 밝아짐) → 빛줄기 둘이 돎 (텍스처 · 빛가루) → 끝에 모이며 섬광 */
function drawBeam(ctx: CanvasRenderingContext2D, z: Zone, x: number, y: number, time: number) {
  const on = Math.min(1, z.t / BEAM_ON);
  const endT = z.life - BEAM_END;
  // 끝: 빛줄기가 짧고 가늘어지며 렌즈로 모임
  const gather = z.t > endT ? Math.min(1, (z.t - endT) / BEAM_END) : 0;
  const beam = fxImg("beam");
  const mote = fxImg("mote");
  const R = z.r * on * (1 - gather * 0.85);
  const W = z.r * 0.42 * (1 - gather * 0.7);
  if (on > 0.2) {
    for (let b = 0; b < 2; b++) {
      const a = z.dx + b * Math.PI;
      ctx.save();
      ctx.translate(x, y);
      // 위아래로 눌린 화면이라 y 는 0.8 배
      ctx.scale(1, 0.8);
      ctx.rotate(a);
      ctx.globalAlpha = 0.95 * on;
      if (beam) {
        const row = Math.floor(time * 12 + b) % 3;
        ctx.drawImage(beam, 0, row * 96, 512, 96, 0, -W / 2, R, W);
      } else {
        ctx.fillStyle = "#ffb840";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(R, -W / 2);
        ctx.lineTo(R, W / 2);
        ctx.closePath();
        ctx.fill();
      }
      // 빛가루: 빛줄기 따라 바깥으로 흘러감
      if (mote) {
        for (let i = 0; i < 6; i++) {
          const u = (time * 0.45 + i / 6 + b * 0.08) % 1;
          const d = R * (0.15 + u * 0.8);
          const off = Math.sin(i * 2.1 + time * 2) * W * 0.3 * u;
          const s = 7 + (i % 3) * 2;
          ctx.globalAlpha = (1 - u) * on;
          ctx.drawImage(mote, (i % 4) * 48, 0, 48, 48, d - s / 2, off - s / 2, s, s);
        }
      }
      ctx.restore();
    }
  }
  // 렌즈 (랜턴 자리) — 켜질 때 1~2장, 그다음 3~6장 돌고, 모일 때 커짐
  const lens = fxImg("lens");
  const L = 36 + gather * 18 + Math.sin(time * 9) * 1.5;
  ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(x, y, 1, x, y, L * 1.4);
  g.addColorStop(0, "rgba(255,240,190,0.55)");
  g.addColorStop(1, "rgba(255,170,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - L * 1.4, y - L * 1.4, L * 2.8, L * 2.8);
  if (lens) {
    const f = on < 0.5 ? 0 : on < 1 ? 1 : 2 + (Math.floor(time * 10) % 4);
    const fw = lens.height;
    // 렌즈 테두리(놋쇠)는 보통으로, 빛은 한 번 더 더해서
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(lens, f * fw, 0, fw, fw, x - L / 2, y - L / 2, L, L);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5 + gather * 0.5;
    ctx.drawImage(lens, f * fw, 0, fw, fw, x - L / 2, y - L / 2, L, L);
  } else {
    ctx.globalAlpha = 0.85;
    ellipse(ctx, x, y, 4, 4, "#ffffff");
  }
}

/** 랜턴 빛살 (기본 공격): 랜턴이 한쪽에서 반대쪽으로 휙 비추며 부채꼴이 펼쳐짐 — 빛줄기 텍스처를 부채처럼 겹쳐 그림 */
function drawLanternCone(ctx: CanvasRenderingContext2D, z: Zone, x: number, y: number, k: number, time: number) {
  const a = Math.atan2(z.dy, z.dx);
  const beam = fxImg("beam");
  const mote = fxImg("mote");
  // 0~25%: 휙 쓸며 펼쳐짐 · 그다음 서서히 꺼짐
  const open = Math.min(1, k / 0.25);
  const fade = k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75;
  const R = z.r * (0.8 + open * 0.2);
  const half = 0.9 * open;
  // 랜턴 둘레 빛무리
  const g = ctx.createRadialGradient(x, y, 1, x, y, 22);
  g.addColorStop(0, `rgba(255,240,190,${0.6 * fade})`);
  g.addColorStop(1, "rgba(255,170,60,0)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(x - 22, y - 22, 44, 44);
  if (beam) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) - 0.5;
      const an = a + u * 2 * half;
      const mid = 1 - Math.abs(u) * 1.2;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, 0.8);
      ctx.rotate(an);
      ctx.globalAlpha = 0.5 * fade * (0.55 + mid * 0.45);
      const W = R * (0.42 + mid * 0.12);
      ctx.drawImage(beam, 0, ((i + Math.floor(time * 10)) % 3) * 96, 512, 96, 0, -W / 2, R * (0.85 + mid * 0.15), W);
      ctx.restore();
    }
  } else {
    ctx.globalAlpha = fade * 0.55;
    ctx.fillStyle = "#ffb840";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, R, a - half, a + half);
    ctx.closePath();
    ctx.fill();
  }
  // 빛가루가 바깥으로 흩날림
  if (mote) {
    for (let i = 0; i < 7; i++) {
      const an = a + (((i * 0.37 + z.x * 0.01) % 1) - 0.5) * 2 * half;
      const d = R * (0.25 + ((i * 0.23 + k * 0.9) % 0.75));
      const s2 = 6 + (i % 3) * 2;
      ctx.globalAlpha = fade * 0.9;
      ctx.drawImage(mote, (i % 4) * 48, 0, 48, 48, x + Math.cos(an) * d - s2 / 2, y + Math.sin(an) * d * 0.8 - s2 / 2, s2, s2);
    }
  }
  ctx.globalAlpha = 1;
}

/** 등대 마지막 섬광 고리 (fx.bursts) */
export function drawBursts(ctx: CanvasRenderingContext2D, fx: Fx, X: (x: number) => number, Y: (y: number) => number) {
  if (!fx.bursts.length) return;
  const ring = fxImg("ring");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const b of fx.bursts) {
    const k = b.t / 0.7;
    const s = 40 + k * 420;
    ctx.globalAlpha = 1 - k;
    if (ring) {
      const f = Math.min(3, Math.floor(k * 4));
      const fw = ring.height;
      ctx.drawImage(ring, f * fw, 0, fw, fw, X(b.x) - s / 2, Y(b.y) - s / 2, s, s);
    } else {
      ctx.strokeStyle = "#fff2c0";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(X(b.x), Y(b.y), s / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawLight(ctx: CanvasRenderingContext2D, r: Run, X: (x: number) => number, Y: (y: number) => number, time: number) {
  let any = false;
  for (const z of r.zones) if (z.k === "ember" || z.k === "beam" || (z.k === "cone" && r.weapons[z.slot]?.id === "lantern")) any = true;
  if (!any) return;
  ctx.save();
  const lh = r.zones.find((z) => z.k === "beam");
  if (lh) {
    const d = Math.min(1, lh.t / BEAM_ON, (lh.life - lh.t) / 0.3);
    ctx.globalAlpha = 0.42 * Math.max(0, d);
    ctx.fillStyle = "#0a0830";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "lighter";
  for (const z of r.zones) {
    const k = z.t / Math.max(0.01, z.life);
    if (z.k === "cone" && r.weapons[z.slot]?.id === "lantern") {
      drawLanternCone(ctx, z, X(z.x), Y(z.y), k, time);
    } else if (z.k === "ember") {
      // 불씨: 바닥 빛무리 + 불꽃 그림 (4장 일렁임) — 그림이 아직이면 막대 불꽃
      const x = X(z.x);
      const y = Y(z.y);
      const fade = k > 0.7 ? (1 - k) / 0.3 : Math.min(1, z.t / 0.08);
      const g = ctx.createRadialGradient(x, y - 2, 1, x, y - 2, z.r * 1.3);
      g.addColorStop(0, "rgba(255,170,60,0.55)");
      g.addColorStop(1, "rgba(255,90,20,0)");
      ctx.globalAlpha = fade;
      ctx.fillStyle = g;
      ctx.fillRect(x - z.r * 1.3, y - 2 - z.r * 1.3, z.r * 2.6, z.r * 2.6);
      const em = fxImg("ember");
      if (em) {
        const fw = em.height;
        const h = Math.round(z.r * 1.5);
        for (let i = 0; i < 2; i++) {
          const f = (Math.floor(time * 10 + i * 2 + z.x * 0.3) % 4 + 4) % 4;
          const ox = (i ? 0.4 : -0.35) * z.r;
          const hh = i ? h * 0.75 : h;
          ctx.drawImage(em, f * fw, 0, fw, fw, Math.round(x + ox - hh / 2), Math.round(y - hh * 0.92), hh, hh);
        }
      } else {
        for (let i = 0; i < 3; i++) {
          const fx2 = Math.round(x + (i - 1) * z.r * 0.45);
          const h = 4 + Math.round((Math.sin(time * 18 + i * 2.3 + z.x) + 1) * 2);
          ctx.fillStyle = "#ff5a1f";
          ctx.fillRect(fx2 - 1, y - h, 3, h);
          ctx.fillStyle = "#ffb03a";
          ctx.fillRect(fx2 - 1, y - h + 2, 2, h - 2);
        }
      }
    } else if (z.k === "beam") {
      drawBeam(ctx, z, X(z.x), Y(z.y) - 30, time);
    }
  }
  ctx.restore();
}
