/*
 * 픽셀 타운 서바이버 — 캔버스 그리기 (512 × 288 도트 화면, 밖에서 정수배로 키움)
 */
import { ENEMIES, FLAG_CHARGE, SHRINE_CHARGE, TRIAL_R, VIEW_H, VIEW_W, WEAPONS, type EnemyKind, type ThingKind } from "@/lib/survivor/data";
import type { Run } from "@/lib/survivor/sim";
import { DECO_CELL, decoAt, digits, getArt, TILE_CHUNK, type HeroArt } from "./art";

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
  shake: number;
  flash: number;
  flashC: string;
  hurt: number;
  /** 플레이어 걷기 프레임 시간 */
  walkT: number;
}
export const newFx = (): Fx => ({ nums: [], parts: [], rings: [], bolts: [], dice: [], zaps: [], shake: 0, flash: 0, flashC: "#ffffff", hurt: 0, walkT: 0 });

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
  for (const r of fx.rings) r.t += dt;
  fx.rings = fx.rings.filter((r) => r.t < r.life);
  for (const b of fx.bolts) b.t += dt;
  fx.bolts = fx.bolts.filter((b) => b.t < 0.25);
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
  const TS = A.tiles.width || TILE_CHUNK;
  const ox = ((camX % TS) + TS) % TS;
  const oy = ((camY % TS) + TS) % TS;
  for (let y = -oy; y < VIEW_H; y += TS) for (let x = -ox; x < VIEW_W; x += TS) ctx.drawImage(A.tiles, x, y);

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
  }

  // 줍는 것
  for (const g of r.gems) {
    const img = A.gems[g.v >= 60 ? 3 : g.v >= 20 ? 2 : g.v >= 4 ? 1 : 0];
    ctx.drawImage(img, X(g.x) - (img.width >> 1), Y(g.y) - (img.height >> 1) + (g.pull ? 0 : Math.round(Math.sin(time * 4 + g.x) * 0.8)));
  }
  for (const k of r.pickups) {
    const img = A.pick[k.k];
    const bob = Math.round(Math.sin(time * 4 + k.x) * 1.5);
    if (k.k === "chest") {
      // 빛기둥
      ctx.globalAlpha = 0.25 + Math.sin(time * 5) * 0.1;
      ctx.fillStyle = "#ffe9a0";
      ctx.fillRect(X(k.x) - 5, Y(k.y) - 60, 10, 60);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(img, X(k.x) - (img.width >> 1), Y(k.y) - img.height + bob);
  }
  for (const pr of r.props) ctx.drawImage(A.lamp, X(pr.x) - (A.lamp.width >> 1), Y(pr.y) - A.lamp.height + 1);

  // 사람 · 몹 (아래쪽이 앞에)
  type D = { y: number; f: () => void };
  const ds: D[] = [];
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
        const fxp = p.face > 0 ? fr.fx : img.width - fr.fx;
        ctx.globalAlpha = 0.3;
        ellipse(ctx, X(sx), Y(sy) + 1, 6, 2, "#05030f");
        ctx.globalAlpha = 0.92;
        ctx.drawImage(img, Math.round(X(sx) - fxp), Math.round(Y(sy) - fr.fy));
        ctx.globalAlpha = 1;
      },
    });
  });
  ds.push({
    y: p.y,
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
        const fr = list[Math.floor(fx.walkT * (p.moving ? 10 : 3)) % list.length];
        const img = p.face > 0 ? fr.r : fr.l;
        const fxp = p.face > 0 ? fr.fx : img.width - fr.fx;
        if (p.dashT > 0 || p.ultT > 0) {
          ctx.globalAlpha = 0.35;
          ctx.drawImage(img, Math.round(px - fxp - p.dx * 10), Math.round(py - fr.fy - p.dy * 10));
          ctx.globalAlpha = 1;
        }
        ctx.drawImage(img, Math.round(px - fxp), Math.round(py - fr.fy));
      } else {
        ctx.fillStyle = "#fff";
        ctx.fillRect(px - 5, py - 18, 10, 18);
      }
    },
  });
  // 맵 오브젝트
  for (const t of r.things) {
    if (!t.alive || Math.abs(t.x - p.x) > VIEW_W / 2 + 40 || Math.abs(t.y - p.y) > VIEW_H / 2 + 50) continue;
    const img = A.things[t.k];
    ds.push({
      y: t.y,
      f: () => {
        const bob = t.k === "merchant" ? Math.round(Math.sin(time * 3) * 1) : t.k === "gshrine" || t.k === "shrine" ? Math.round(Math.sin(time * 2 + t.id) * 1.5) : 0;
        ctx.globalAlpha = 0.35;
        ellipse(ctx, X(t.x), Y(t.y) + 1, img.width * 0.4, 3, "#05030f");
        ctx.globalAlpha = 1;
        ctx.drawImage(img, X(t.x) - (img.width >> 1), Y(t.y) - img.height + 2 + bob);
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
      const d = decoAt(cx, cy);
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
        spin(ctx, A.shuriken, x, y, time * 30);
        break;
      case "cyclone": {
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
      case "missile":
      case "barrage":
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
      case "ball":
      case "rainbow":
      case "pinball": {
        const rr = Math.round(s.r);
        ctx.fillStyle = "#170f2e";
        circle(ctx, x, y, rr + 1);
        ctx.fillStyle = s.w === "rainbow" ? `hsl(${Math.floor(time * 360 + s.x) % 360} 95% 65%)` : def.color;
        circle(ctx, x, y, rr);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x - Math.round(rr / 2), y - Math.round(rr / 2), 2, 2);
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
    ctx.fillStyle = "#e8dcff";
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
    ellipse(ctx, X(b.x), Y(b.y), b.r, b.r * 0.6, "#c8a6ff");
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

const ARROW_C: Record<ThingKind, string> = { shrine: "#4ff0c8", gshrine: "#ffd23a", statue: "#ffd23a", bell: "#ff8a6b", flag: "#ff9cc8", box: "#c58bff", merchant: "#c58bff", fountain: "#7ad7ff", trial: "#e0d8ff" };
/** 화면 밖 오브젝트: 가장자리 화살표 + 작은 그림 */
function drawArrows(ctx: CanvasRenderingContext2D, r: Run, things: Record<ThingKind, HTMLCanvasElement>, time: number) {
  const p = r.p;
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2 + 10;
  const placed: [number, number][] = [];
  for (const t of r.things) {
    if (!t.alive) continue;
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    if (Math.abs(dx) < VIEW_W / 2 - 4 && Math.abs(dy) < VIEW_H / 2 - 4) continue;
    const d = Math.hypot(dx, dy);
    if (d > 760) continue;
    const k = Math.min((VIEW_W / 2 - 22) / Math.abs(dx || 0.01), (VIEW_H / 2 - 30) / Math.abs(dy || 0.01));
    let ax = Math.round(cx + dx * k);
    let ay = Math.round(cy + dy * k);
    // 겹치면 가장자리를 따라 비켜 놓음
    for (let n = 0; n < 6 && placed.some(([x, y]) => Math.abs(x - ax) < 24 && Math.abs(y - ay) < 24); n++) {
      if (Math.abs(ax - cx) > VIEW_W / 2 - 30) ay += ay < cy ? 24 : -24;
      else ax += ax < cx ? 24 : -24;
    }
    placed.push([ax, ay]);
    const a = Math.atan2(dy, dx);
    const c = ARROW_C[t.k];
    const pulse = t.k === "trial" || t.k === "merchant" || t.k === "fountain" ? 0.7 + Math.sin(time * 6) * 0.3 : 0.85;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#07051a";
    ctx.fillRect(ax - 11, ay - 11, 22, 22);
    ctx.fillStyle = c;
    ctx.fillRect(ax - 10, ay - 10, 20, 1);
    ctx.fillRect(ax - 10, ay + 9, 20, 1);
    const img = things[t.k];
    const sc = Math.min(1, 16 / Math.max(img.width, img.height));
    ctx.drawImage(img, ax - Math.round((img.width * sc) / 2), ay - Math.round((img.height * sc) / 2), Math.round(img.width * sc), Math.round(img.height * sc));
    // 방향 삼각형
    const tx = ax + Math.cos(a) * 15;
    const ty = ay + Math.sin(a) * 15;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(a) * 4, ty + Math.sin(a) * 4);
    ctx.lineTo(tx + Math.cos(a + 2.4) * 4, ty + Math.sin(a + 2.4) * 4);
    ctx.lineTo(tx + Math.cos(a - 2.4) * 4, ty + Math.sin(a - 2.4) * 4);
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
  n.fillStyle = "rgba(8, 6, 32, 0.55)";
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
  for (const k of r.pickups) if (k.k === "chest") hole(X(k.x), Y(k.y - 6), 40, 0.9);
  for (const t of r.things) if (t.alive && t.k !== "statue" && t.k !== "box") hole(X(t.x), Y(t.y - 10), t.k === "trial" ? TRIAL_R : 46, t.k === "trial" ? 0.5 : 0.85);
  // 빛나는 장식 (호박등 · 분수)
  const camX = -X(0);
  const camY = -Y(0);
  for (let cy = Math.floor((camY - 60) / DECO_CELL); cy <= Math.floor((camY + VIEW_H + 80) / DECO_CELL); cy++)
    for (let cx = Math.floor((camX - 60) / DECO_CELL); cx <= Math.floor((camX + VIEW_W + 60) / DECO_CELL); cx++) {
      const d = decoAt(cx, cy);
      if (d?.light) hole(X(d.x), Y(d.y - 10), 44 + Math.sin(time * 4 + cx) * 3, 0.8);
    }
  ctx.drawImage(night, 0, 0);
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
