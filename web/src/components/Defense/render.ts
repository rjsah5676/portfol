/**
 * 필드 그리기 (캔버스). 시뮬 상태를 읽기만 함.
 * 그림(assets.ts)이 있으면 그 그림, 없으면 코드로 그린 도트 자리표시 — 에셋을 받으면 연결표에 넣기만 하면 됨.
 * 좌표: 필드 1칸 = CELL px (디자인 기준). 캔버스는 화면 배율 × 기기 픽셀 비율로 키워서 그림.
 */
import { BOSSES, KIND } from "@/lib/defense/enemies";
import {
  ENEMY_ART,
  FIELD_ART,
  UNIT_ART,
  bossFace,
  img,
  type SpriteSpec,
} from "@/lib/defense/assets";
import { CAP } from "@/lib/defense/balance";
import {
  CELLS,
  COLS,
  FIELD_H,
  FIELD_W,
  PERIM,
  STACK,
  cellX,
  cellY,
  pathPos,
  type Board,
  type Enemy,
  type Fx,
} from "@/lib/defense/sim";
import { FACTION_COLOR, GRADE_COLOR, UNIT } from "@/lib/defense/units";

export const CELL = 76;
export const FW = FIELD_W * CELL;
export const FH = FIELD_H * CELL;

/** 화면 효과 (수명 있는 것) */
export interface Vfx {
  fx: Fx;
  t: number;
  life: number;
}
export interface View {
  sel: number;
  /** 끌고 있는 칸 · 지금 손가락 위치 (디자인 px) */
  drag: { from: number; x: number; y: number } | null;
  hover: number;
  vfx: Vfx[];
  /** 칸별 마지막 공격 시각 (ms, 공격 동작) */
  shotAt: number[];
  now: number;
}
export const newView = (): View => ({
  sel: -1,
  drag: null,
  hover: -1,
  vfx: [],
  shotAt: new Array(CELLS).fill(0),
  now: 0,
});

const FX_LIFE: Record<Fx["k"], number> = {
  shot: 140,
  aoe: 320,
  chain: 180,
  ult: 900,
  die: 500,
  miss: 400,
  whip: 700,
  heal: 600,
};

/** 시뮬에서 온 효과를 화면 효과로 (한 프레임에 너무 많으면 앞쪽은 버림 — 배속일 때) */
export function pushFx(v: View, list: Fx[]) {
  const keep = list.length > 160 ? list.slice(-160) : list;
  for (const fx of keep) {
    if (fx.k === "shot") v.shotAt[fx.c] = v.now;
    v.vfx.push({ fx, t: v.now, life: FX_LIFE[fx.k] });
  }
  if (v.vfx.length > 400) v.vfx.splice(0, v.vfx.length - 400);
}

export const cellAt = (x: number, y: number) => {
  const c = Math.floor(x / CELL) - 1,
    r = Math.floor(y / CELL) - 1;
  if (c < 0 || c >= COLS || r < 0 || r >= CELLS / COLS) return -1;
  return r * COLS + c;
};

/* ── 작은 도트 그림 (자리표시) ── */

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** 종류마다 정해진 8×8 좌우 대칭 무늬 */
const patterns = new Map<string, boolean[]>();
function pattern(id: string): boolean[] {
  let p = patterns.get(id);
  if (p) return p;
  let h = hash(id);
  p = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 4; x++) {
      h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
      const edge = y === 0 || y === 7 || x === 0;
      p[y * 8 + x] = p[y * 8 + 7 - x] = (h & 7) > (edge ? 4 : 1);
    }
  patterns.set(id, p);
  return p;
}
function pixelBlob(
  ctx: CanvasRenderingContext2D,
  id: string,
  cx: number,
  cy: number,
  size: number,
  color: string,
  eye = "#111"
) {
  const p = pattern(id);
  const px = size / 8;
  ctx.fillStyle = color;
  for (let i = 0; i < 64; i++)
    if (p[i])
      ctx.fillRect(
        Math.round(cx - size / 2 + (i % 8) * px),
        Math.round(cy - size / 2 + Math.floor(i / 8) * px),
        Math.ceil(px),
        Math.ceil(px)
      );
  ctx.fillStyle = eye;
  ctx.fillRect(Math.round(cx - px * 2), Math.round(cy - px), Math.ceil(px), Math.ceil(px));
  ctx.fillRect(Math.round(cx + px), Math.round(cy - px), Math.ceil(px), Math.ceil(px));
}

function sprite(
  ctx: CanvasRenderingContext2D,
  s: SpriteSpec,
  cx: number,
  footY: number,
  size: number,
  now: number,
  attackT: number
) {
  const im = img(s.src);
  if (!im) return false;
  const row =
    s.attack && now - attackT < (s.attack.frames / s.attack.fps) * 1000 ? s.attack : s.idle;
  const f =
    row === s.idle
      ? Math.floor((now / 1000) * row.fps) % row.frames
      : Math.min(row.frames - 1, Math.floor(((now - attackT) / 1000) * row.fps));
  const [ax, ay] = s.anchor ?? [0.5, 0.9];
  const k = (size * (s.scale ?? 1)) / s.h;
  const w = s.w * k,
    h = s.h * k;
  ctx.imageSmoothingEnabled = !s.pixel;
  ctx.drawImage(im, f * s.w, row.row * s.h, s.w, s.h, cx - w * ax, footY - h * ay, w, h);
  ctx.imageSmoothingEnabled = true;
  return true;
}

/* ── 그리기 ── */

export function draw(ctx: CanvasRenderingContext2D, b: Board, v: View, opt: { range: boolean }) {
  const now = v.now;
  ctx.clearRect(0, 0, FW, FH);
  // 배경
  const bg = FIELD_ART ? img(FIELD_ART) : null;
  if (bg) ctx.drawImage(bg, 0, 0, FW, FH);
  else {
    ctx.fillStyle = "#0b0f1d";
    ctx.fillRect(0, 0, FW, FH);
    ctx.strokeStyle = "rgba(120,140,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= FW; x += CELL / 4) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, FH);
      ctx.stroke();
    }
    for (let y = 0; y <= FH; y += CELL / 4) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(FW, y + 0.5);
      ctx.stroke();
    }
  }
  // 길 (사각 고리)
  const danger = Math.min(1, Math.max(0, (b.enemies.length - CAP * 0.6) / (CAP * 0.4)));
  ctx.strokeStyle = `rgba(${150 + danger * 105},${70 - danger * 40},${255 - danger * 180},0.22)`;
  ctx.lineWidth = CELL * 0.7;
  ctx.lineJoin = "round";
  ctx.strokeRect(CELL / 2, CELL / 2, FW - CELL, FH - CELL);
  ctx.setLineDash([6, 10]);
  ctx.lineDashOffset = -now / 40;
  ctx.strokeStyle = "rgba(200,180,255,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(CELL / 2, CELL / 2, FW - CELL, FH - CELL);
  ctx.setLineDash([]);
  // 균열 입구 (적이 나오는 곳)
  const pulse = 0.5 + 0.5 * Math.sin(now / 200);
  ctx.fillStyle = `rgba(255,60,200,${0.25 + pulse * 0.25})`;
  ctx.beginPath();
  ctx.arc(CELL / 2, CELL / 2, CELL * 0.32 + pulse * 3, 0, Math.PI * 2);
  ctx.fill();

  // 칸
  for (let i = 0; i < CELLS; i++) {
    const x = (cellX(i) - 0.5) * CELL + 3,
      y = (cellY(i) - 0.5) * CELL + 3,
      s = CELL - 6;
    const c = b.cells[i];
    const target = v.drag && v.hover === i && v.drag.from !== i;
    ctx.fillStyle = target
      ? "rgba(255,255,255,0.14)"
      : c.def
        ? "rgba(255,255,255,0.05)"
        : "rgba(255,255,255,0.025)";
    roundRect(ctx, x, y, s, s, 10);
    ctx.fill();
    const full = c.def && c.units.length >= STACK && UNIT[c.def].grade < 3;
    ctx.strokeStyle =
      v.sel === i
        ? "#fff"
        : full
          ? `rgba(255,220,90,${0.5 + pulse * 0.5})`
          : c.def
            ? GRADE_COLOR[UNIT[c.def].grade] + "55"
            : "rgba(255,255,255,0.08)";
    ctx.lineWidth = v.sel === i ? 2.5 : full ? 2 : 1;
    ctx.stroke();
  }

  // 고른 칸의 사거리
  const showRange = (i: number) => {
    const c = b.cells[i];
    if (!c?.def) return;
    const d = UNIT[c.def];
    const r = Math.min(d.range, 9) * CELL;
    ctx.fillStyle = FACTION_COLOR[d.faction] + "14";
    ctx.strokeStyle = FACTION_COLOR[d.faction] + "88";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cellX(i) * CELL, cellY(i) * CELL, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (d.aura) {
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(cellX(i) * CELL, cellY(i) * CELL, Math.min(d.aura.r, 9) * CELL, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };
  if (opt.range && v.sel >= 0) showRange(v.sel);

  // 적
  const ens = [...b.enemies].sort((a, c) => a.size - c.size);
  for (const e of ens) drawEnemy(ctx, e, now);

  // 유닛
  for (let i = 0; i < CELLS; i++) {
    const c = b.cells[i];
    if (!c.def || (v.drag && v.drag.from === i)) continue;
    drawStack(
      ctx,
      i,
      c.def,
      c.units.map((u) => u.stun > 0),
      cellX(i) * CELL,
      cellY(i) * CELL,
      now,
      v.shotAt[i],
      c.units.length
    );
    // 궁극기 충전
    const d = UNIT[c.def];
    if (d.ult) {
      const u0 = c.units.reduce((m, u) => Math.max(m, u.ult), 0);
      const x = (cellX(i) - 0.5) * CELL + 10,
        y = (cellY(i) + 0.5) * CELL - 10;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x, y, CELL - 20, 4);
      ctx.fillStyle = "#7ef3ff";
      ctx.fillRect(x, y, ((CELL - 20) * u0) / d.ult.every, 4);
    }
  }
  // 끌고 있는 유닛
  if (v.drag) {
    const c = b.cells[v.drag.from];
    if (c.def) {
      ctx.globalAlpha = 0.85;
      drawStack(
        ctx,
        v.drag.from,
        c.def,
        c.units.map(() => false),
        v.drag.x,
        v.drag.y,
        now,
        0,
        c.units.length
      );
      ctx.globalAlpha = 1;
    }
  }

  drawFx(ctx, v, b);

  // 위험 테두리
  if (danger > 0) {
    ctx.strokeStyle = `rgba(255,40,60,${danger * (0.35 + 0.25 * pulse)})`;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, FW - 10, FH - 10);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const STACK_POS: [number, number][][] = [
  [],
  [[0, 2]],
  [
    [-14, 4],
    [14, 4],
  ],
  [
    [0, -10],
    [-15, 12],
    [15, 12],
  ],
];

/** 한 칸의 유닛들 (1~3기) */
export function drawStack(
  ctx: CanvasRenderingContext2D,
  ci: number,
  id: string,
  stun: boolean[],
  cx: number,
  cy: number,
  now: number,
  shotT: number,
  n: number
) {
  const d = UNIT[id];
  const big = d.grade >= 3;
  const size = n === 1 ? 44 : 32;
  const pos = STACK_POS[Math.min(3, n)];
  // 높은 등급은 빛
  if (d.grade >= 3) {
    const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, CELL * 0.5);
    g.addColorStop(0, GRADE_COLOR[d.grade] + "66");
    g.addColorStop(1, GRADE_COLOR[d.grade] + "00");
    ctx.fillStyle = g;
    ctx.fillRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL);
  }
  const art = UNIT_ART[id];
  for (let k = 0; k < pos.length; k++) {
    const [ox, oy] = pos[k];
    const x = cx + ox,
      y = cy + oy;
    const bob = Math.sin(now / 300 + ci + k) * 1.5;
    const kick = now - shotT < 100 ? -2 : 0;
    if (art && sprite(ctx, art, x, y + size / 2 + bob, size * (big ? 1.15 : 1), now, shotT))
      continue;
    // 자리표시: 세력 색 몸통 + 등급 테두리 + 글자
    const s = size * (big ? 1.1 : 1);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, y + s / 2 - 1, s * 0.38, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = FACTION_COLOR[d.faction];
    roundRect(ctx, x - s / 2 + 4, y - s / 2 + bob + kick + 2, s - 8, s - 6, 7);
    ctx.fill();
    ctx.lineWidth = d.grade >= 2 ? 3 : 2;
    ctx.strokeStyle = GRADE_COLOR[d.grade];
    ctx.stroke();
    ctx.fillStyle = "#0b0f1d";
    ctx.font = `bold ${d.glyph.length > 1 ? s * 0.3 : s * 0.42}px 'Black Han Sans', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(d.glyph, x, y + bob + kick + 1);
    if (stun[k]) {
      ctx.fillStyle = "#ffe066";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText("✦", x + s / 3, y - s / 2 + 2);
    }
  }
  if (n > 1) {
    ctx.fillStyle = n >= STACK && d.grade < 3 ? "#ffd84a" : "rgba(0,0,0,0.65)";
    roundRect(ctx, cx + CELL / 2 - 26, cy - CELL / 2 + 6, 20, 16, 5);
    ctx.fill();
    ctx.fillStyle = n >= STACK && d.grade < 3 ? "#1a1300" : "#fff";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`×${n}`, cx + CELL / 2 - 16, cy - CELL / 2 + 14.5);
  }
}

const faceCache = new Map<string, string>();
function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, now: number) {
  const x = e.x * CELL,
    y = e.y * CELL;
  if (e.boss >= 0) {
    const def = BOSSES[e.boss];
    const r = 30;
    const src = faceCache.get(def.fighter) ?? bossFace(def.fighter);
    faceCache.set(def.fighter, src);
    const im = img(src);
    ctx.save();
    ctx.globalAlpha = e.evade > 0 ? 0.35 : 1;
    // 글리치: 가끔 옆으로 어긋난 색 띠
    const gl = Math.sin(now / 90 + e.id) > 0.85 ? 4 : 0;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = def.color + "55";
    ctx.fill();
    ctx.clip();
    if (im) {
      ctx.drawImage(im, x - r - gl, y - r, r * 2, r * 2);
      if (gl) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.35;
        ctx.drawImage(im, x - r + gl, y - r, r * 2, r * 2);
      }
    } else pixelBlob(ctx, def.fighter, x, y, r * 1.6, def.color);
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = e.shield > 0 ? "#7fd3ff" : def.color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (e.stun > 0) stars(ctx, x, y - r, now);
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(x - 32, y + r + 3, 64, 6);
    ctx.fillStyle = "#ff3d6e";
    ctx.fillRect(x - 32, y + r + 3, (64 * Math.max(0, e.hp)) / e.max, 6);
    return;
  }
  const k = KIND[e.kind];
  const size = e.size === 0 ? 24 : e.size === 1 ? 32 : 42;
  const s = e.elite || e.rift ? size * 1.3 : size;
  const hop = Math.abs(Math.sin(now / 160 + e.id)) * (e.stun > 0 ? 0 : 3);
  if (e.rift) {
    ctx.fillStyle = `rgba(255,60,200,${0.25 + 0.15 * Math.sin(now / 120)})`;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
  const art = ENEMY_ART[e.kind];
  if (!(art && sprite(ctx, art, x, y + s / 2 - hop, s, now, 0))) {
    pixelBlob(
      ctx,
      e.kind,
      x,
      y - hop,
      s,
      e.slowT > 0 || e.aSlow > 0 ? mix(k.color, "#7fd3ff") : k.color
    );
  }
  if (e.elite) {
    ctx.fillStyle = "#ffd84a";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("♛", x, y - s / 2 - 10);
  }
  if (e.stun > 0) stars(ctx, x, y - s / 2 - 2, now);
  // 체력
  if (e.hp < e.max) {
    const w = Math.max(20, s);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - w / 2, y + s / 2 + 1, w, 3);
    ctx.fillStyle = e.rift ? "#ff5cd6" : e.elite ? "#ffd84a" : "#7dff8a";
    ctx.fillRect(x - w / 2, y + s / 2 + 1, (w * Math.max(0, e.hp)) / e.max, 3);
  }
}

const mix = (a: string, b: string) => {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round((p(a, i) + p(b, i)) / 2)).join(",")})`;
};
function stars(ctx: CanvasRenderingContext2D, x: number, y: number, now: number) {
  ctx.fillStyle = "#ffe066";
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i < 3; i++) {
    const a = now / 200 + (i * Math.PI * 2) / 3;
    ctx.fillText("✦", x + Math.cos(a) * 9, y + Math.sin(a) * 3);
  }
}

function drawFx(ctx: CanvasRenderingContext2D, v: View, b: Board) {
  const now = v.now;
  v.vfx = v.vfx.filter((f) => now - f.t < f.life);
  for (const { fx, t, life } of v.vfx) {
    const p = (now - t) / life;
    const a = 1 - p;
    switch (fx.k) {
      case "shot": {
        const d = UNIT[fx.def];
        const sx = cellX(fx.c) * CELL,
          sy = cellY(fx.c) * CELL;
        ctx.strokeStyle = fx.crit
          ? `rgba(255,220,80,${a})`
          : hexA(FACTION_COLOR[d.faction], a * 0.9);
        ctx.lineWidth = fx.crit ? 3 : d.grade >= 3 ? 2.5 : 1.5;
        const tx = fx.x * CELL,
          ty = fx.y * CELL;
        // 날아가는 짧은 선
        const h0 = Math.min(1, p * 2.2),
          h1 = Math.max(0, h0 - 0.35);
        ctx.beginPath();
        ctx.moveTo(sx + (tx - sx) * h1, sy + (ty - sy) * h1);
        ctx.lineTo(sx + (tx - sx) * h0, sy + (ty - sy) * h0);
        ctx.stroke();
        if (fx.crit && p > 0.4) {
          ctx.fillStyle = `rgba(255,220,80,${a})`;
          ctx.font = "bold 13px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("CRIT", tx, ty - 14 - p * 10);
        }
        break;
      }
      case "aoe":
        ctx.strokeStyle = hexA(FACTION_COLOR[UNIT[fx.def].faction], a * 0.8);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(fx.x * CELL, fx.y * CELL, fx.r * CELL * (0.4 + 0.6 * p), 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "chain": {
        ctx.strokeStyle = `rgba(160,220,255,${a})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const x1 = fx.x1 * CELL,
          y1 = fx.y1 * CELL,
          x2 = fx.x2 * CELL,
          y2 = fx.y2 * CELL;
        ctx.moveTo(x1, y1);
        for (let i = 1; i < 4; i++)
          ctx.lineTo(
            x1 + ((x2 - x1) * i) / 4 + (i % 2 ? 4 : -4),
            y1 + ((y2 - y1) * i) / 4 + (i % 2 ? -4 : 4)
          );
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;
      }
      case "ult": {
        const x = cellX(fx.c) * CELL,
          y = cellY(fx.c) * CELL;
        ctx.fillStyle = `rgba(126,243,255,${a})`;
        ctx.font = "bold 15px 'Black Han Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.strokeStyle = `rgba(0,0,0,${a})`;
        ctx.lineWidth = 3;
        ctx.strokeText(fx.name, x, y - 34 - p * 16);
        ctx.fillText(fx.name, x, y - 34 - p * 16);
        break;
      }
      case "die":
        for (let i = 0; i < (fx.boss ? 16 : 5); i++) {
          const ang = i * 2.4 + fx.x;
          const dd = p * (fx.boss ? 60 : 18);
          ctx.fillStyle = `rgba(255,${120 + i * 20},${200},${a})`;
          ctx.fillRect(
            fx.x * CELL + Math.cos(ang) * dd - 2,
            fx.y * CELL + Math.sin(ang) * dd - 2,
            4,
            4
          );
        }
        if (fx.gold > 1) {
          ctx.fillStyle = `rgba(255,215,90,${a})`;
          ctx.font = "bold 11px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`+${fx.gold}`, fx.x * CELL, fx.y * CELL - 12 - p * 14);
        }
        break;
      case "miss":
        ctx.fillStyle = `rgba(200,200,255,${a})`;
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("MISS", fx.x * CELL, fx.y * CELL - 20 - p * 10);
        break;
      case "whip": {
        const x = cellX(fx.c) * CELL,
          y = cellY(fx.c) * CELL;
        ctx.strokeStyle = `rgba(255,80,120,${a})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 24, y - 24);
        ctx.lineTo(x + 24, y + 24);
        ctx.moveTo(x + 24, y - 24);
        ctx.lineTo(x - 24, y + 24);
        ctx.stroke();
        break;
      }
      case "heal":
        ctx.fillStyle = `rgba(120,255,140,${a})`;
        ctx.font = "bold 18px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("+", fx.x * CELL, fx.y * CELL - 30 - p * 16);
        break;
    }
  }
  void b;
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, a)})`;
}

/** 길 위 진행 표시용 (미니맵 등) */
export const pathPoint = (d: number) => pathPos(((d % PERIM) + PERIM) % PERIM);
