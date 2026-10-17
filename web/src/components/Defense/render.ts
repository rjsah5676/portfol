/**
 * 필드 그리기 (캔버스, 2.5D 도트) — 시뮬 상태를 읽기만 함.
 *
 * 2.5D: 위에서 비스듬히 내려다본 3/4 시점.
 *  - 바깥 한 줄 = 적이 도는 돌길(낮음), 안쪽 6×3 = 유닛 자리 블록(높음 · 윗면 + 앞면)
 *  - 유닛 · 적은 발 위치(y) 순서로 그려서 앞뒤가 맞게 겹침
 *  - 좌표는 시뮬과 같음(1칸 = CELL px) → 누르기 · 끌기 판정(cellAt)은 그대로
 * 그림(assets.ts)이 있으면 그 그림, 없으면 세력별 도트 자리표시 — 연결표에 넣기만 하면 바뀜.
 */
import { BOSSES, KIND } from "@/lib/defense/enemies";
import {
  BOSS_ART,
  ENEMY_ART,
  FIELD_ART,
  TOWN_ART,
  UNIT_ART,
  bossFace,
  img,
  type SpriteSpec,
} from "@/lib/defense/assets";
import { EXP_NODE_TEXT, TOWN_TILES, expNodeOf } from "@/lib/defense/town";
import { CAP, TPS } from "@/lib/defense/balance";
import { THEME, type ThemeDef } from "@/lib/defense/progress";
import {
  BENCH,
  CELLS,
  COLS,
  FIELD_H,
  FIELD_W,
  PERIM,
  STACK,
  cellX,
  cellY,
  expDest,
  pathPos,
  tileCell,
  tileXY,
  type Board,
  type Enemy,
  type Fx,
} from "@/lib/defense/sim";
import { FACTION_COLOR, GRADE_COLOR, UNIT, type Faction } from "@/lib/defense/units";

export const CELL = 72;
/** 그림 크기 배수 (칸 76px 기준으로 맞춘 크기들) */
const K = CELL / 76;
export const FW = FIELD_W * CELL;
export const FH = FIELD_H * CELL;
/** 필드 아래 보관함 줄 높이 · 캔버스 전체 높이 */
/** 보관함: 필드 오른쪽 세로 한 줄 (칸 높이 = CELL) */
export const BENCH_W = CELL;
/** 캔버스 전체 (필드 + 보관함 줄) */
export const CW = FW + BENCH_W;
export const FH2 = FH;
/** 보관함 칸 왼쪽 끝 x */
/** 칸 가운데 (필드 · 보관함 공용, 디자인 px) */
export function slotCenter(i: number): [number, number] {
  if (i < CELLS) return [cellX(i) * CELL, cellY(i) * CELL];
  return [FW + BENCH_W / 2, (i - CELLS + 0.5) * CELL];
}

/** 블록 앞면 높이 (2.5D 두께) */
const LIFT = 10;
const FONT = "'Galmuri11', 'Nanum Gothic', sans-serif";

/** 화면 효과 (수명 있는 것) */
export interface Vfx {
  fx: Fx;
  t: number;
  life: number;
}
export interface View {
  sel: number;
  /** 해피 타운: 고른 길 칸 · 마우스가 올라간 길 칸 (-1 = 없음) */
  selTile: number;
  hoverTile: number;
  /** 끌고 있는 칸 · 지금 손가락 위치 (디자인 px) */
  drag: { from: number; x: number; y: number } | null;
  hover: number;
  vfx: Vfx[];
  /** 칸별 마지막 공격 시각 (ms, 공격 동작) · 바라보는 방향 */
  shotAt: number[];
  face: number[];
  now: number;
  /** 해피 타운 내 말 이동 연출: from 에서 path 칸들을 t0(ms)부터 한 칸씩 콩콩 (없으면 b.pos 에 서 있음) */
  tok: { from: number; path: number[]; t0: number } | null;
  /** 해피 타운: 말이 선 칸 번쩍 (잭팟이면 금색) */
  flash: { t: number; until: number; gold: boolean } | null;
}
export const newView = (): View => ({
  sel: -1,
  selTile: -1,
  hoverTile: -1,
  drag: null,
  hover: -1,
  vfx: [],
  shotAt: new Array(CELLS).fill(0),
  face: new Array(CELLS).fill(1),
  now: 0,
  tok: null,
  flash: null,
});
/** 말이 한 칸 가는 시간 (ms) */
export const HOP_MS = 150;

const FX_LIFE: Record<Fx["k"], number> = {
  shot: 260,
  aoe: 340,
  chain: 200,
  ult: 1000,
  die: 520,
  miss: 450,
  whip: 700,
  heal: 650,
  spawn: 620,
};

/** 시뮬에서 온 효과를 화면 효과로 (한 프레임에 너무 많으면 앞쪽은 버림 — 배속일 때) */
export function pushFx(v: View, list: Fx[]) {
  const keep = list.length > 160 ? list.slice(-160) : list;
  for (const fx of keep) {
    if (fx.k === "shot") {
      v.shotAt[fx.c] = v.now;
      const dx = fx.x - cellX(fx.c);
      if (Math.abs(dx) > 0.15) v.face[fx.c] = dx > 0 ? 1 : -1;
    }
    v.vfx.push({ fx, t: v.now, life: FX_LIFE[fx.k] });
  }
  if (v.vfx.length > 400) v.vfx.splice(0, v.vfx.length - 400);
}

export const cellAt = (x: number, y: number) => {
  if (x >= FW) {
    const j = Math.floor(y / CELL);
    return j >= 0 && j < BENCH && x < CW ? CELLS + j : -1;
  }
  const c = Math.floor(x / CELL) - 1,
    r = Math.floor(y / CELL) - 1;
  if (c < 0 || c >= COLS || r < 0 || r >= CELLS / COLS) return -1;
  return r * COLS + c;
};

/** 디자인 px → 길 칸 번호 (길이 아니면 -1) — 해피 타운 건물 고르기 */
export const tileAt = (x: number, y: number) => {
  if (x < 0 || y < 0 || x >= FW || y >= FH) return -1;
  const gx = Math.floor(x / CELL),
    gy = Math.floor(y / CELL);
  for (let t = 0; t < PERIM; t++) {
    const [tx, ty] = tileXY(t);
    if (tx === gx && ty === gy) return t;
  }
  return -1;
};

/* ───────── 도움 ───────── */

const P = (n: number) => Math.round(n / 2) * 2;
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
function pxText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha = 1
) {
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgba(10,8,22,${alpha})`;
  for (const [dx, dy] of [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
    [2, 2],
  ])
    ctx.fillText(text, P(x) + dx, P(y) + dy);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillText(text, P(x), P(y));
  ctx.globalAlpha = 1;
}
function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  ctx.fillStyle = "rgba(5,3,14,0.45)";
  const h = Math.max(4, P(w * 0.28));
  // 계단 모양 타원 (도트)
  ctx.fillRect(P(x - w / 2 + 4), P(y - h / 2), P(w - 8), h);
  ctx.fillRect(P(x - w / 2), P(y - h / 2 + 2), P(w), h - 4);
}

/* ───────── 자리표시 그림 (세력별 도트 인형) ─────────
 * 12×14 무늬. 기호: o 외곽선 · a 세력색 · b 세력색 어두움 · s 피부 · w 흰색 · g 등급색 · e 눈 */
const DOLL: Record<Faction, string[]> = {
  knight: [
    "....oooo....",
    "...oaaaao...",
    "..oaawwaao..",
    "..oaaaaaao..",
    "..obeeeebo..",
    "..obssssbo..",
    "...oooooo...",
    "..oaaggaao..",
    ".oaaaggaaao.",
    "owoaaaaaaoo.",
    "owoabbbbao..",
    ".o.abbbba...",
    "...ob..bo...",
    "...oo..oo...",
  ],
  mech: [
    "...oooooo...",
    "..obbbbbbo..",
    "..owwbbwwo..",
    "..oeebbeeo..",
    "..obbbbbbo..",
    "...oooooo...",
    "..oaaaaaao..",
    ".oaagggaaao.",
    "oboaaaaaaobo",
    "oboaaaaaaobo",
    ".o.abbbba.o.",
    "...ab..ba...",
    "..obb..bbo..",
    "..ooo..ooo..",
  ],
  arcane: [
    ".....oo.....",
    "....oago....",
    "...oaaaao...",
    "..oaaaaaao..",
    ".oooooooooo.",
    "...osssso...",
    "...oesseo...",
    "....oooo....",
    "...oaaaao...",
    "..oaaggaao.w",
    ".oaaaaaaaaow",
    ".oaaaaaaaao.",
    "..obbbbbbo..",
    "...oooooo...",
  ],
  hidden: [
    "..oo....oo..",
    ".oaao..oaao.",
    ".oaaaooaaao.",
    "oaaaaaaaaaao",
    "oaweaaaaweao",
    "oaaaaaaaaaao",
    ".oaaggggaao.",
    "..oaaaaaao..",
    ".oaaaaaaaao.",
    "oaaobbbboaao",
    "oaobbbbbboao",
    ".o.obbbbo.o.",
    "...oo..oo...",
    "............",
  ],
};
const dollCache = new Map<string, HTMLCanvasElement>();
function doll(id: string): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  let c = dollCache.get(id);
  if (c) return c;
  const d = UNIT[id];
  const rows = DOLL[d.faction];
  c = document.createElement("canvas");
  c.width = 12;
  c.height = 14;
  const x = c.getContext("2d")!;
  const col: Record<string, string> = {
    o: "#120d22",
    a: FACTION_COLOR[d.faction],
    b: shade(FACTION_COLOR[d.faction], 0.6),
    s: "#ffd9b8",
    w: "#ffffff",
    g: GRADE_COLOR[d.grade],
    e: "#120d22",
  };
  rows.forEach((r, yy) =>
    [...r].forEach((ch, xx) => {
      if (col[ch]) {
        x.fillStyle = col[ch];
        x.fillRect(xx, yy, 1, 1);
      }
    })
  );
  dollCache.set(id, c);
  return c;
}

/** 8×8 좌우 대칭 무늬 (적 자리표시) */
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
  footY: number,
  size: number,
  color: string
) {
  const p = pattern(id);
  const px = Math.max(2, P(size / 8));
  const x0 = P(cx - px * 4),
    y0 = P(footY - px * 8);
  ctx.fillStyle = "#120d22";
  for (let i = 0; i < 64; i++)
    if (p[i]) ctx.fillRect(x0 + (i % 8) * px - 2, y0 + Math.floor(i / 8) * px - 2, px + 4, px + 4);
  ctx.fillStyle = color;
  for (let i = 0; i < 64; i++)
    if (p[i]) ctx.fillRect(x0 + (i % 8) * px, y0 + Math.floor(i / 8) * px, px, px);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (let i = 0; i < 16; i++)
    if (p[i]) ctx.fillRect(x0 + (i % 8) * px, y0 + Math.floor(i / 8) * px, px, 2);
  ctx.fillStyle = "#120d22";
  ctx.fillRect(x0 + 2 * px, y0 + 3 * px, px, px);
  ctx.fillRect(x0 + 5 * px, y0 + 3 * px, px, px);
}

/** 그림 한 장 그리기 (발 위치 기준). dir: 1 오른쪽 · -1 왼쪽 */
/** 공격 그림을 보여 줄 시간 (ms) — 공격 동작(ATK_MS)보다 살짝 길게 */
const ATK_HOLD = 240;
/** 지금 그릴 그림 — 막 공격했고 공격 그림(atk)이 불러와졌으면 그것 */
function srcAt(s: SpriteSpec, now: number, attackT: number) {
  return s.atk && now - attackT >= 0 && now - attackT < ATK_HOLD && img(s.atk) ? s.atk : s.src;
}

function sprite(
  ctx: CanvasRenderingContext2D,
  s: SpriteSpec,
  cx: number,
  footY: number,
  size: number,
  now: number,
  attackT: number,
  dir = 1,
  squash = 0,
  /** 기울기 (라디안, 발 기준) — 공격 동작 */
  tilt = 0
) {
  const im = img(srcAt(s, now, attackT)) ?? img(s.src);
  if (!im) return false;
  const row =
    s.attack && now - attackT < (s.attack.frames / s.attack.fps) * 1000 ? s.attack : s.idle;
  const f =
    row === s.idle
      ? Math.floor((now / 1000) * row.fps) % row.frames
      : Math.min(row.frames - 1, Math.floor(((now - attackT) / 1000) * row.fps));
  const [ax, ay] = s.anchor ?? [0.5, 0.96];
  const k = (size * (s.scale ?? 1)) / s.h;
  const w = s.w * k * (1 + squash * 0.5),
    h = s.h * k * (1 - squash);
  const flip = dir * (s.face ?? 1) < 0;
  ctx.save();
  ctx.imageSmoothingEnabled = !s.pixel;
  ctx.translate(Math.round(cx), Math.round(footY));
  if (flip) ctx.scale(-1, 1);
  if (tilt) ctx.rotate(tilt * (s.face ?? 1));
  ctx.drawImage(im, f * s.w, row.row * s.h, s.w, s.h, -w * ax, -h * ay, w, h);
  ctx.restore();
  return true;
}

/* ───────── 바닥 ───────── */

/** 블록 테마 (꾸미기, lib/defense/progress.ts THEMES) — 판 시작 때 GameView 가 정함 */
let theme: ThemeDef = THEME["theme.base"];
export function setTheme(id: string | null | undefined) {
  theme = THEME[id ?? ""] ?? THEME["theme.base"];
}
const FAC_IDX: Record<string, number> = { knight: 0, mech: 1, arcane: 2 };
/** 블록 윗면 색 (테마가 정한 색이 있으면 그 색) */
const topOf = (f: string | null) => {
  if (!f) return theme.top[3];
  const t = theme.top[FAC_IDX[f] ?? -1];
  return t || shade(FACTION_COLOR[f as keyof typeof FACTION_COLOR], 0.42);
};

let floorCache: { key: string; cv: HTMLCanvasElement } | null = null;
/** 바닥(길 · 블록 바탕)은 한 번 그려 두고 재사용 */
function floor(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = (FIELD_ART ?? "procedural") + theme.id;
  if (floorCache?.key === key) return floorCache.cv;
  const cv = document.createElement("canvas");
  cv.width = FW;
  cv.height = FH;
  const ctx = cv.getContext("2d")!;
  // 바닥 (어두운 허공 + 픽셀 별)
  ctx.fillStyle = "#0e0b1e";
  ctx.fillRect(0, 0, FW, FH);
  let h = 1234567;
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0), h / 4294967296);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = rnd() > 0.7 ? "#3a2f66" : "#231c44";
    ctx.fillRect(P(rnd() * FW), P(rnd() * FH), 2, 2);
  }
  // 돌길 (바깥 고리)
  for (let gy = 0; gy < FIELD_H; gy++)
    for (let gx = 0; gx < FIELD_W; gx++) {
      const ring = gy === 0 || gy === FIELD_H - 1 || gx === 0 || gx === FIELD_W - 1;
      if (!ring) continue;
      const x = gx * CELL,
        y = gy * CELL;
      ctx.fillStyle = theme.road[0];
      ctx.fillRect(x, y, CELL, CELL);
      // 돌 무늬: 엇갈린 벽돌
      for (let r = 0; r < 4; r++) {
        const off = r % 2 ? CELL / 4 : 0;
        for (let c = -1; c < 3; c++) {
          const bx = x + c * (CELL / 2) + off,
            by = y + r * (CELL / 4);
          const tone = rnd();
          ctx.fillStyle = tone > 0.66 ? theme.road[1] : tone > 0.33 ? theme.road[0] : theme.road[2];
          const x0 = Math.max(x, bx + 2),
            x1 = Math.min(x + CELL, bx + CELL / 2 - 2);
          if (x1 > x0) ctx.fillRect(x0, by + 2, x1 - x0, CELL / 4 - 4);
          if (x1 > x0) {
            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.fillRect(x0, by + 2, x1 - x0, 2);
          }
        }
      }
    }
  // 길 가장자리 (안쪽으로 떨어지는 그늘)
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(CELL, CELL, FW - 2 * CELL, 6);
  // 안쪽 마당 (블록 아래 바닥)
  ctx.fillStyle = "#171230";
  ctx.fillRect(CELL, CELL + 6, FW - 2 * CELL, FH - 2 * CELL - 6);
  // 바깥 테두리
  ctx.fillStyle = "#08060f";
  ctx.fillRect(0, 0, FW, 2);
  ctx.fillRect(0, FH - 2, FW, 2);
  ctx.fillRect(0, 0, 2, FH);
  ctx.fillRect(FW - 2, 0, 2, FH);
  floorCache = { key, cv };
  return cv;
}

/** 유닛 자리 블록 하나 (윗면 + 앞면). 세력 · 등급 색으로 칠함 */
function block(
  ctx: CanvasRenderingContext2D,
  i: number,
  top: string,
  edge: string,
  glow: string | null
) {
  const x = (cellX(i) - 0.5) * CELL + 4,
    y = (cellY(i) - 0.5) * CELL + 2,
    s = CELL - 8;
  const th = s - LIFT;
  // 앞면
  ctx.fillStyle = shade(top, 0.55);
  ctx.fillRect(x, y + th, s, LIFT);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  for (let k = 0; k < s; k += 8) ctx.fillRect(x + k, y + th + 2, 2, LIFT - 2);
  // 윗면
  ctx.fillStyle = top;
  ctx.fillRect(x, y, s, th);
  // 윗면 무늬 (가운데 마름모 문양)
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(x + 6, y + 6, s - 12, th - 12);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(x, y, s, 2);
  ctx.fillRect(x, y, 2, th);
  // 테두리
  ctx.fillStyle = edge;
  ctx.fillRect(x - 2, y - 2, s + 4, 2);
  ctx.fillRect(x - 2, y + s, s + 4, 2);
  ctx.fillRect(x - 2, y - 2, 2, s + 4);
  ctx.fillRect(x + s, y - 2, 2, s + 4);
  if (glow) {
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, s, th);
  }
}

/** 고른 칸 표시: 깜빡이는 네 귀퉁이 */
function brackets(ctx: CanvasRenderingContext2D, i: number, color: string, now: number) {
  const [scx, scy] = slotCenter(i);
  const s = i < CELLS ? CELL : BENCH_W - 8;
  const x = scx - s / 2,
    y = scy - s / 2;
  const o = Math.floor(now / 250) % 2 ? 0 : 2;
  const L = 12;
  ctx.fillStyle = color;
  for (const [cx, cy, sx, sy] of [
    [x + o, y + o, 1, 1],
    [x + s - o, y + o, -1, 1],
    [x + o, y + s - o, 1, -1],
    [x + s - o, y + s - o, -1, -1],
  ]) {
    ctx.fillRect(sx > 0 ? cx : cx - L, sy > 0 ? cy : cy - 3, L, 3);
    ctx.fillRect(sx > 0 ? cx : cx - 3, sy > 0 ? cy : cy - L, 3, L);
  }
}

/* ───────── 그리기 ───────── */

type Drawable = { y: number; fn: () => void };

export function draw(ctx: CanvasRenderingContext2D, b: Board, v: View, opt: { range: boolean }) {
  const now = v.now;
  ctx.imageSmoothingEnabled = false;
  const bg = FIELD_ART ? img(FIELD_ART) : null;
  if (bg) ctx.drawImage(bg, 0, 0, FW, FH);
  else {
    const f = floor();
    if (f) ctx.drawImage(f, 0, 0);
  }
  const danger = Math.min(1, Math.max(0, (b.enemies.length - CAP * 0.6) / (CAP * 0.4)));
  const blink = Math.floor(now / 250) % 2;
  if (b.stage === "town") drawTown(ctx, b, v, now, blink);

  // 길 위 흐르는 화살표 (적이 가는 방향)
  ctx.fillStyle = danger > 0 ? `rgba(255,77,109,${0.2 + danger * 0.3})` : "rgba(191,179,255,0.16)";
  const step = Math.floor(now / 120) % 8;
  for (let d = step * 2; d < PERIM * 16; d += 16) {
    const [px, py] = pathPos(d / 16);
    ctx.fillRect(P(px * CELL) - 2, P(py * CELL) - 2, 4, 4);
  }

  // 균열 입구 (적이 나오는 곳): 글리치 소용돌이
  {
    const cx = CELL / 2,
      cy = CELL / 2;
    for (let k = 0; k < 14; k++) {
      const a = now / 300 + k * 0.9;
      const r = 6 + ((k * 7 + Math.floor(now / 90)) % 22);
      ctx.fillStyle = k % 3 ? "#ff4fd8" : k % 2 ? "#5ff2ff" : "#ffffff";
      ctx.globalAlpha = 0.55;
      ctx.fillRect(P(cx + Math.cos(a) * r), P(cy + Math.sin(a) * r * 0.7), 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#08060f";
    ctx.fillRect(cx - 8, cy - 6, 16, 12);
    ctx.fillStyle = blink ? "#ff4fd8" : "#5ff2ff";
    ctx.fillRect(cx - 4, cy - 2, 8, 4);
  }

  // 유닛 자리 블록
  for (let i = 0; i < CELLS; i++) {
    const c = b.cells[i];
    const target = !!v.drag && v.hover === i && v.drag.from !== i;
    const d = c.def ? UNIT[c.def] : null;
    const top = topOf(d ? d.faction : null);
    const full = d && c.units.length >= STACK && d.grade < 3;
    const edge =
      full && blink
        ? "#ffd23f"
        : d
          ? shade(GRADE_COLOR[d.grade], d.grade >= 3 ? 1 : 0.7)
          : "#3d3468";
    block(
      ctx,
      i,
      top,
      edge,
      target ? "rgba(255,255,255,0.18)" : v.hover === i && !v.drag ? "rgba(255,255,255,0.07)" : null
    );
  }

  // 보관함 줄 (필드 오른쪽 세로): 어두운 선반 + 칸 받침
  {
    ctx.fillStyle = "#0b0918";
    ctx.fillRect(FW, 0, BENCH_W, FH);
    ctx.fillStyle = "#3d3468";
    ctx.fillRect(FW, 0, 2, FH);
    for (let j = 0; j < BENCH; j++) {
      const i = CELLS + j;
      const x = FW + 5,
        y = j * CELL + 4,
        w = BENCH_W - 8,
        h = CELL - 8;
      const c = b.cells[i];
      const d = c.def ? UNIT[c.def] : null;
      const target = !!v.drag && v.hover === i && v.drag.from !== i;
      ctx.fillStyle = target ? "#3a3060" : d ? shade(FACTION_COLOR[d.faction], 0.3) : "#1c1834";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x, y + h - 6, w, 6);
      ctx.fillStyle = d ? shade(GRADE_COLOR[d.grade], 0.75) : "#2a2350";
      ctx.fillRect(x - 2, y - 2, w + 4, 2);
      ctx.fillRect(x - 2, y + h, w + 4, 2);
      ctx.fillRect(x - 2, y, 2, h);
      ctx.fillRect(x + w, y, 2, h);      // 잠긴 칸 (정비소에서 해금)
      if (j >= b.mods.bench) {
        ctx.fillStyle = "rgba(8,6,16,0.72)";
        ctx.fillRect(x, y, w, h);
        pxText(ctx, "잠김", x + w / 2, y + h / 2, 12, "#4b4275");
      } else if (!d) pxText(ctx, "보관", x + w / 2, y + h / 2, 12, "#3d3468");
    }
  }

  // 고른 칸의 사거리 (도트 점선 원)
  const showRange = (i: number) => {
    const c = b.cells[i];
    if (!c?.def) return;
    const d = UNIT[c.def];
    const cx = cellX(i) * CELL,
      cy = cellY(i) * CELL;
    const ring = (r: number, color: string, gap: number) => {
      const n = Math.max(24, Math.floor((r * Math.PI * 2) / gap));
      ctx.fillStyle = color;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + now / 3000;
        ctx.fillRect(P(cx + Math.cos(a) * r) - 1, P(cy + Math.sin(a) * r) - 1, 3, 3);
      }
    };
    const r = Math.min(d.range, 9) * CELL;
    ctx.fillStyle = hexA(FACTION_COLOR[d.faction], 0.07);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ring(r, hexA(FACTION_COLOR[d.faction], 0.85), 10);
    if (d.aura) ring(Math.min(d.aura.r, 9) * CELL, "rgba(255,255,255,0.5)", 14);
  };
  if (opt.range && v.sel >= 0 && v.sel < CELLS) showRange(v.sel);
  if (v.sel >= 0) brackets(ctx, v.sel, "#ffffff", now);
  if (b.stage === "town" && v.selTile >= 0) tileBrackets(ctx, v.selTile, "#ffd23f", now);
  if (v.drag && v.hover >= 0 && v.hover !== v.drag.from) brackets(ctx, v.hover, "#5ff2ff", now);

  // 유닛 · 적: 발 y 순서로
  const list: Drawable[] = [];
  for (let i = 0; i < CELLS; i++) {
    const c = b.cells[i];
    if (!c.def || (v.drag && v.drag.from === i)) continue;
    const def = c.def;
    const footY = (cellY(i) - 0.5) * CELL + 2 + (CELL - 8 - LIFT) * 0.78;
    list.push({
      y: footY,
      fn: () =>
        drawStack(
          ctx,
          i,
          def,
          c.units.map((u) => u.stun > 0),
          cellX(i) * CELL,
          footY,
          now,
          v.shotAt[i],
          c.units.length,
          v.face[i]
        ),
    });
    // 궁극기 충전 (블록 앞면에)
    const d = UNIT[def];
    if (d.ult) {
      const u0 = c.units.reduce((m, u) => Math.max(m, u.ult), 0);
      const x = (cellX(i) - 0.5) * CELL + 10,
        y = (cellY(i) + 0.5) * CELL - 8;
      list.push({
        y: 1e6,
        fn: () => {
          ctx.fillStyle = "#07060f";
          ctx.fillRect(x - 2, y - 2, CELL - 16, 6);
          ctx.fillStyle = u0 >= d.ult!.every - 1 && blink ? "#ffffff" : "#5ff2ff";
          ctx.fillRect(x, y, P(((CELL - 20) * u0) / d.ult!.every), 2);
        },
      });
    }
  }
  for (const e of b.enemies) list.push({ y: e.y * CELL + 10, fn: () => drawEnemy(ctx, e, now) });
  list.sort((a, c) => a.y - c.y);
  for (const d of list) d.fn();
  if (b.stage === "town") {
    drawRoute(ctx, b, now);
    drawToken(ctx, b, v, now);
  }
  // 보관함 유닛 (작게, 공격 안 함)
  for (let j = 0; j < BENCH; j++) {
    const i = CELLS + j;
    const c = b.cells[i];
    if (!c.def || (v.drag && v.drag.from === i)) continue;
    const [x] = slotCenter(i);
    const [, y] = slotCenter(i);
    drawStack(ctx, i, c.def, c.units.map(() => false), x, y + CELL / 2 - 12, now, 0, c.units.length, 1, false, 0.72);
  }

  // 끌고 있는 유닛
  if (v.drag) {
    const c = b.cells[v.drag.from];
    if (c.def) {
      ctx.globalAlpha = 0.9;
      drawStack(
        ctx,
        v.drag.from,
        c.def,
        c.units.map(() => false),
        v.drag.x,
        v.drag.y + 18,
        now,
        0,
        c.units.length,
        1,
        true
      );
      ctx.globalAlpha = 1;
    }
  }

  drawFx(ctx, v);

  // 심연 변이 「봉인」: 보라색 사슬 (그 칸 유닛은 공격 안 함 — 옮기면 풀림)
  for (const i of b.sealed) {
    const x = (cellX(i) - 0.5) * CELL,
      y = (cellY(i) - 0.5) * CELL;
    ctx.fillStyle = "rgba(40,10,70,0.55)";
    ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    ctx.fillStyle = "#a66bff";
    for (let k = 4; k < CELL - 4; k += 6) {
      ctx.fillRect(P(x + k), P(y + k), 4, 4);
      ctx.fillRect(P(x + CELL - k - 4), P(y + k), 4, 4);
    }
    pxText(ctx, "봉인", x + CELL / 2, y + CELL - 10, 11, "#d9c2ff", 1);
  }

  // 보스 2페이즈 예고: 표시된 칸이 빨갛게 깜빡이고 남은 시간 막대 (그 전에 유닛을 옮기면 피함)
  if (b.tele) {
    const tl = b.tele;
    const sec = Math.ceil(tl.t / TPS);
    for (const i of tl.cells) {
      const x = (cellX(i) - 0.5) * CELL,
        y = (cellY(i) - 0.5) * CELL;
      ctx.fillStyle = blink ? "rgba(255,40,70,0.38)" : "rgba(255,40,70,0.2)";
      ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      ctx.fillStyle = "#ff4d6d";
      ctx.fillRect(x + 2, y + 2, CELL - 4, 3);
      ctx.fillRect(x + 2, y + CELL - 5, CELL - 4, 3);
      ctx.fillRect(x + 2, y + 2, 3, CELL - 4);
      ctx.fillRect(x + CELL - 5, y + 2, 3, CELL - 4);
    }
    // 이름 · 남은 초: 표시된 칸들의 가운데 위
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity;
    for (const i of tl.cells) {
      x0 = Math.min(x0, cellX(i));
      x1 = Math.max(x1, cellX(i));
      y0 = Math.min(y0, cellY(i));
    }
    pxText(ctx, `${tl.name} ${sec}`, ((x0 + x1) / 2) * CELL, (y0 - 0.5) * CELL - 4, 15, "#ff4d6d", 1);
  }

  // 위험: 테두리가 빨갛게 깜빡임
  if (danger > 0) {
    const a = danger * (blink ? 0.75 : 0.4);
    ctx.fillStyle = `rgba(255,40,70,${a})`;
    ctx.fillRect(0, 0, FW, 6);
    ctx.fillRect(0, FH - 6, FW, 6);
    ctx.fillRect(0, 0, 6, FH);
    ctx.fillRect(FW - 6, 0, 6, FH);
  }
}

/* ───────── 해피 타운 ───────── */

let townCache: HTMLCanvasElement | null = null;
/** 동네 길 바닥 (한 번 그려 두고 재사용): 따뜻한 벽돌길 + 칸마다 동네 색 띠 + 칸 경계 */
function townFloor(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  if (townCache) return townCache;
  const cv = document.createElement("canvas");
  cv.width = FW;
  cv.height = FH;
  const ctx = cv.getContext("2d")!;
  let h = 7654321;
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0), h / 4294967296);
  for (let t = 0; t < PERIM; t++) {
    const [gx, gy] = tileXY(t);
    const x = gx * CELL,
      y = gy * CELL;
    const tt = TOWN_TILES[t];
    const corner = tileCell(t) < 0;
    // 바탕: 따뜻한 돌길 (모서리 특수 칸은 밝게)
    ctx.fillStyle = corner ? "#5a4a7a" : "#4a3d63";
    ctx.fillRect(x, y, CELL, CELL);
    for (let r = 0; r < 4; r++) {
      const off = r % 2 ? CELL / 4 : 0;
      for (let c = -1; c < 3; c++) {
        const bx = x + c * (CELL / 2) + off,
          by = y + r * (CELL / 4);
        const tone = rnd();
        ctx.fillStyle = corner ? (tone > 0.5 ? "#6a5a8c" : "#625284") : tone > 0.66 ? "#5a4b78" : tone > 0.33 ? "#52446f" : "#4a3d66";
        const x0 = Math.max(x, bx + 2),
          x1 = Math.min(x + CELL, bx + CELL / 2 - 2);
        if (x1 > x0) {
          ctx.fillRect(x0, by + 2, x1 - x0, CELL / 4 - 4);
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(x0, by + 2, x1 - x0, 2);
        }
      }
    }
    // 동네 색 띠 (유닛 쪽 가장자리) — 마블 판의 이름판 색
    if (!corner) {
      ctx.fillStyle = tt.color;
      ctx.globalAlpha = 0.85;
      if (gy === 0) ctx.fillRect(x + 2, y + CELL - 7, CELL - 4, 5);
      else if (gy === FIELD_H - 1) ctx.fillRect(x + 2, y + 2, CELL - 4, 5);
      else if (gx === 0) ctx.fillRect(x + CELL - 7, y + 2, 5, CELL - 4);
      else ctx.fillRect(x + 2, y + 2, 5, CELL - 4);
      ctx.globalAlpha = 1;
    }
    // 칸 경계
    ctx.fillStyle = "rgba(10,8,22,0.55)";
    ctx.fillRect(x, y, CELL, 2);
    ctx.fillRect(x, y, 2, CELL);
  }
  townCache = cv;
  return cv;
}

/** 길 칸 왼쪽 위 (디자인 px) */
const tileOrigin = (t: number): [number, number] => {
  const [gx, gy] = tileXY(t);
  return [gx * CELL, gy * CELL];
};

/** 해피 타운: 바닥 · 모서리 특수 칸 · 주사위 칸 · 건물 · 지을 수 있는 칸 표시 */
function drawTown(ctx: CanvasRenderingContext2D, b: Board, v: View, now: number, blink: number) {
  const f = townFloor();
  if (f) {
    // 길 고리만 덮음 (가운데 마당 · 블록은 그대로)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, FW, CELL);
    ctx.rect(0, FH - CELL, FW, CELL);
    ctx.rect(0, CELL, CELL, FH - 2 * CELL);
    ctx.rect(FW - CELL, CELL, CELL, FH - 2 * CELL);
    ctx.clip();
    ctx.drawImage(f, 0, 0);
    ctx.restore();
  }
  for (let t = 0; t < PERIM; t++) {
    const [x, y] = tileOrigin(t);
    const tt = TOWN_TILES[t];
    // 모서리 특수 칸 그림 (마블)
    if (tt.sp) {
      const im = img(TOWN_ART.sp(tt.sp));
      if (im) {
        const k = Math.min((CELL - 6) / im.naturalWidth, (CELL - 6) / im.naturalHeight);
        const w = im.naturalWidth * k,
          hh = im.naturalHeight * k;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(im, x + (CELL - w) / 2, y + CELL - hh - 3, w, hh);
        ctx.imageSmoothingEnabled = false;
      }
      if (b.exp) {
        const n = EXP_NODE_TEXT[expNodeOf(t)];
        pxText(ctx, n.name, x + CELL / 2, y + 10, 11, n.color);
      }
      continue;
    }
    // 원정: 엘리트 칸 · 지나온 칸
    if (b.exp) {
      const n = expNodeOf(t);
      if (n === "elite") {
        ctx.fillStyle = "rgba(255,107,127,0.16)";
        ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      }
      if (n !== "fight") pxText(ctx, EXP_NODE_TEXT[n].name, x + CELL / 2, y + 12, 11, EXP_NODE_TEXT[n].color);
      if (b.exp.path.some((p) => p.t === t) && b.pos !== t) {
        ctx.fillStyle = "rgba(5,4,12,0.35)";
        ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      }
    }
    // 말이 막 선 칸: 번쩍 (엘리트 · 보스면 금색)
    if (v.flash && v.flash.t === t && now < v.flash.until) {
      const k = (v.flash.until - now) / 900;
      ctx.fillStyle = v.flash.gold ? `rgba(255,210,63,${0.25 + 0.45 * k * blink})` : `rgba(255,255,255,${0.12 + 0.2 * k})`;
      ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    }
    if (v.hoverTile === t && v.selTile !== t) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    }
    // 건물
    const lv = b.bld[t];
    if (lv > 0) {
      const src = lv >= 3 ? (tt.lm ? TOWN_ART.lm(tt.lm) : TOWN_ART.bld(3)) : TOWN_ART.bld(lv);
      const im = img(src) ?? img(TOWN_ART.bld(Math.min(3, lv)));
      const seized = b.seized.includes(t);
      const open = !seized;
      if (im) {
        const H = CELL * (lv === 1 ? 0.56 : lv === 2 ? 0.7 : 0.86);
        const k = Math.min(H / im.naturalHeight, (CELL - 6) / im.naturalWidth);
        const w = im.naturalWidth * k,
          hh = im.naturalHeight * k;
        ctx.save();
        ctx.globalAlpha = open ? 1 : 0.42;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(im, x + (CELL - w) / 2, y + CELL - hh - 4, w, hh);
        ctx.restore();
      }
      if (seized) {
        ctx.fillStyle = blink ? "rgba(255,211,107,0.35)" : "rgba(80,50,10,0.45)";
        ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
        pxText(ctx, "MOA", x + CELL / 2, y + CELL / 2, 13, "#ffd36b");
      }
      // 단계 점 (1~3)
      for (let k = 0; k < lv; k++) {
        ctx.fillStyle = "#07060f";
        ctx.fillRect(x + 5 + k * 8, y + 5, 6, 6);
        ctx.fillStyle = open ? "#ffd23f" : "#7a6aa8";
        ctx.fillRect(x + 6 + k * 8, y + 6, 4, 4);
      }
    }
  }
}

/** 원정 갈림길: 주사위 눈마다 멈출 칸 표시 (깜빡이는 괄호 + 눈) */
function drawRoute(ctx: CanvasRenderingContext2D, b: Board, now: number) {
  const c = b.exp?.camp;
  if (c?.k !== "route") return;
  for (const d of c.dice) {
    const t = expDest(b, d);
    const n = EXP_NODE_TEXT[expNodeOf(t)];
    tileBrackets(ctx, t, n.color, now);
    const [x, y] = tileOrigin(t);
    pxText(ctx, String(d), x + CELL / 2, y + CELL / 2, 20, n.color);
  }
}

/** 해피 타운 내 말 — 지금 칸 (이동 중이면 칸 사이 콩콩) */
function tokenXY(b: Board, v: View, now: number): [number, number, number] {
  const c = (t: number): [number, number] => {
    const [x, y] = tileOrigin(t);
    return [x + CELL / 2, y + CELL - 12];
  };
  const m = v.tok;
  if (!m || !m.path.length) return [...c(b.pos), 0];
  if (now < m.t0) return [...c(m.from), 0];
  const f = (now - m.t0) / HOP_MS;
  if (f >= m.path.length) return [...c(m.path[m.path.length - 1]), 0];
  const i = Math.floor(f),
    k = f - i;
  const [ax, ay] = c(i === 0 ? m.from : m.path[i - 1]);
  const [bx, by] = c(m.path[i]);
  return [ax + (bx - ax) * k, ay + (by - ay) * k, Math.sin(Math.PI * k) * 16];
}
/** 내 말 — 보드게임 말 모양 도트 (둥근 머리 · 금 칼라 · 퍼지는 몸통 · 받침), 왼쪽 빛 · 오른쪽 그늘 · 테두리 */
const PAWN: [number, number, string][] = [
  // [윗변 y(바닥 기준, 2px 단위 줄), 폭, 칠]
  [-42, 6, "b"], [-40, 10, "b"], [-38, 12, "b"], [-36, 14, "b"], [-34, 14, "b"], [-32, 12, "b"], [-30, 10, "b"],
  [-28, 16, "g"], [-26, 16, "g"], [-24, 8, "b"],
  [-22, 10, "b"], [-20, 10, "b"], [-18, 12, "b"], [-16, 14, "b"], [-14, 16, "b"], [-12, 18, "b"], [-10, 20, "b"],
  [-8, 26, "g"], [-6, 28, "b"], [-4, 28, "b"], [-2, 24, "d"],
];
function drawToken(ctx: CanvasRenderingContext2D, b: Board, v: View, now: number) {
  const [cx, cy, up] = tokenXY(b, v, now);
  const x = P(cx),
    y = P(cy - up) + 4;
  // 그림자 (뛸수록 작게)
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  const sw = up > 4 ? 10 : 15;
  ctx.fillRect(P(cx) - sw, P(cy) + 4, sw * 2, 4);
  const C: Record<string, [string, string, string]> = {
    b: ["#ff5fa2", "#ffc2dd", "#c2306f"],
    g: ["#ffd23f", "#fff2a8", "#c98a00"],
    d: ["#c2306f", "#ff7fb6", "#8a1f50"],
  };
  // 테두리: 한 줄씩 2px 넓게 · 위아래 2px
  ctx.fillStyle = "#1a0b22";
  for (const [dy, w] of PAWN) ctx.fillRect(x - w / 2 - 2, y + dy - 2, w + 4, 6);
  for (const [dy, w, k] of PAWN) {
    const [base, hi, sh] = C[k];
    ctx.fillStyle = base;
    ctx.fillRect(x - w / 2, y + dy, w, 2);
    ctx.fillStyle = hi;
    ctx.fillRect(x - w / 2 + 2, y + dy, Math.max(2, Math.floor(w / 6 / 2) * 2), 2);
    ctx.fillStyle = sh;
    ctx.fillRect(x + w / 2 - Math.max(2, Math.floor(w / 4 / 2) * 2), y + dy, Math.max(2, Math.floor(w / 4 / 2) * 2), 2);
  }
  // 머리 반짝
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - 4, y - 38, 2, 2);
  // 머리 위 화살표 (내 말 · 깜빡)
  if (Math.floor(now / 350) % 2) {
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(x - 4, y - 54, 8, 2);
    ctx.fillRect(x - 2, y - 52, 4, 2);
  }
}

/** 고른 길 칸 표시 (네 귀퉁이) */
function tileBrackets(ctx: CanvasRenderingContext2D, t: number, color: string, now: number) {
  const [x, y] = tileOrigin(t);
  const o = Math.floor(now / 250) % 2 ? 1 : 3;
  const L = 12;
  ctx.fillStyle = color;
  for (const [cx, cy, sx, sy] of [
    [x + o, y + o, 1, 1],
    [x + CELL - o, y + o, -1, 1],
    [x + o, y + CELL - o, 1, -1],
    [x + CELL - o, y + CELL - o, -1, -1],
  ]) {
    ctx.fillRect(sx > 0 ? cx : cx - L, sy > 0 ? cy : cy - 3, L, 3);
    ctx.fillRect(sx > 0 ? cx : cx - 3, sy > 0 ? cy : cy - L, 3, L);
  }
}

const STACK_POS: [number, number][][] = [
  [],
  [[0, 0]],
  [
    [-13, -2],
    [13, 2],
  ],
  [
    [0, -12],
    [-16, 4],
    [16, 4],
  ],
];

/** 한 칸의 유닛들 (1~3기). footY = 블록 윗면 위 발 위치 */
export function drawStack(
  ctx: CanvasRenderingContext2D,
  ci: number,
  id: string,
  stun: boolean[],
  cx: number,
  footY: number,
  now: number,
  shotT: number,
  n: number,
  dir = 1,
  lifted = false,
  /** 크기 배수 (보관함은 작게) */
  scale = 1
) {
  const d = UNIT[id];
  const g = d.grade;
  // 등급이 높을수록 크게
  const base = (n === 1 ? 66 : n === 2 ? 52 : 46) * scale * K;
  const size = base * (1 + Math.min(g, 4) * 0.05);
  const pos = STACK_POS[Math.min(3, n)].map(([x, y]) => [x * scale * K, y * scale * K] as [number, number]);
  // 등급 오라 (발밑) — 레어부터 색 링, 레전드부터 빛 기둥 + 올라가는 반짝이 (보관함은 작은 링만)
  if (scale === 1) groundAura(ctx, g, cx, footY, now, ci);
  const art = UNIT_ART[id];
  const order = pos.map((p, k) => ({ p, k })).sort((a, b) => a.p[1] - b.p[1]);
  for (const { k } of order) {
    const [ox, oy] = pos[k];
    const x = cx + ox,
      y = footY + oy;
    const since = now - shotT;
    // 숨쉬기 (2px 계단) · 공격 동작은 세력마다 (attackPose)
    const bob = Math.floor((now / 380 + ci * 0.7 + k * 0.5) % 2) * 2;
    const pose = attackPose(d.faction, since, dir, now + k * 37);
    const lunge = pose.dx;
    const squash = pose.squash || (bob ? 0.03 : 0);
    if (!lifted) shadow(ctx, x, y, size * 0.62);
    const yy = y - (lifted ? 6 : 0) - pose.dy;
    if (pose.cast > 0) castRing(ctx, d.faction, x, y, size, pose.cast);
    // 등급색 외곽선 (그림 둘레 2px) — 노말은 없음
    if (art && g >= 1) gradeOutline(ctx, art, id, x + lunge, yy, size, dir, squash, now, pose.tilt, shotT);
    if (art && sprite(ctx, art, x + lunge, yy, size, now, shotT, dir, squash, pose.tilt)) {
      // 맞으면 흰 번쩍임은 생략 (그림 위 덧칠 비용) — 기절만 표시
    } else {
      const dl = doll(id);
      if (dl) {
        const k2 = Math.max(2, Math.round(size / 16));
        const w = 12 * k2,
          h = 14 * k2;
        ctx.save();
        ctx.translate(Math.round(x + lunge), Math.round(yy - bob));
        if (dir < 0) ctx.scale(-1, 1);
        ctx.drawImage(dl, -w / 2, -h, w, h * (1 - squash));
        ctx.restore();
      }
    }
    if (stun[k]) {
      for (let s = 0; s < 3; s++) {
        const a = now / 180 + (s * Math.PI * 2) / 3;
        ctx.fillStyle = "#ffd23f";
        ctx.fillRect(P(x + Math.cos(a) * 10) - 2, P(yy - size * 0.95 + Math.sin(a) * 3) - 2, 4, 4);
      }
    }
  }
  // 등급 보석 (칸 왼쪽 위) — 글자로도 한눈에
  const top = scale === 1 ? footY - CELL + 20 : footY - CELL + 22;
  if (!lifted) gradeGem(ctx, g, P(scale === 1 ? cx - CELL / 2 + 8 : cx - BENCH_W / 2 + 6), P(top));
  // 몇 기인지 (합성 가능하면 금색)
  if (n > 1) {
    const ready = n >= STACK && g < 3;
    const bx = P(cx + (scale === 1 ? CELL : BENCH_W) / 2 - 26),
      by = P(top - 2);
    ctx.fillStyle = "#07060f";
    ctx.fillRect(bx - 2, by - 2, 24, 16);
    ctx.fillStyle = ready ? "#ffd23f" : "#3d3468";
    ctx.fillRect(bx, by, 20, 12);
    ctx.font = `bold 12px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ready ? "#1a1000" : "#fff";
    ctx.fillText(`×${n}`, bx + 10, by + 6.5);
  }
}

/* ───────── 등급 표시 ───────── */

const GRADE_LETTER = ["N", "R", "E", "L", "M", "H", "T"];

/** 발밑 오라: 레어 · 에픽은 색 링, 레전드 이상은 빛 기둥 + 반짝이 (신화 · 히든은 더 크게) */
function groundAura(
  ctx: CanvasRenderingContext2D,
  g: number,
  cx: number,
  footY: number,
  now: number,
  seed: number
) {
  if (g < 1) return;
  const col = GRADE_COLOR[g];
  const pulse = Math.floor(now / 220) % 2;
  const w = g >= 4 ? 60 : g >= 3 ? 54 : 46;
  // 계단 타원 링
  ctx.fillStyle = hexA(col, g >= 3 ? 0.55 + pulse * 0.2 : 0.45);
  ctx.fillRect(P(cx - w / 2 + 6), P(footY - 8), P(w - 12), 2);
  ctx.fillRect(P(cx - w / 2 + 6), P(footY + 6), P(w - 12), 2);
  ctx.fillRect(P(cx - w / 2), P(footY - 6), 2, 12);
  ctx.fillRect(P(cx + w / 2) - 2, P(footY - 6), 2, 12);
  ctx.fillRect(P(cx - w / 2 + 2), P(footY - 8) + 2, 4, 2);
  ctx.fillRect(P(cx + w / 2) - 6, P(footY - 8) + 2, 4, 2);
  ctx.fillRect(P(cx - w / 2 + 2), P(footY + 4), 4, 2);
  ctx.fillRect(P(cx + w / 2) - 6, P(footY + 4), 4, 2);
  ctx.fillStyle = hexA(col, g >= 3 ? 0.22 + pulse * 0.08 : 0.14);
  ctx.fillRect(P(cx - w / 2 + 2), P(footY - 6), P(w - 4), 12);
  if (g >= 3) {
    // 빛 기둥
    const h = g >= 4 ? 64 : 48;
    ctx.fillStyle = hexA(col, 0.1 + pulse * 0.05);
    ctx.fillRect(P(cx - w / 2 + 8), P(footY - h), P(w - 16), h);
    // 올라가는 반짝이
    const n = g >= 4 ? 6 : 4;
    for (let k = 0; k < n; k++) {
      const t = (((now / (g >= 4 ? 900 : 1200) + k / n + seed * 0.37) % 1) + 1) % 1;
      const x = cx + ((k * 37 + seed * 13) % (w - 12)) - (w - 12) / 2;
      ctx.fillStyle = hexA(k % 2 ? "#ffffff" : col, 1 - t);
      ctx.fillRect(P(x), P(footY - 4 - t * h), 2, g >= 4 ? 4 : 2);
    }
  }
}

/** 그림 실루엣을 등급색으로 칠한 캐시 */
const tintCache = new Map<string, HTMLCanvasElement>();
function tinted(art: SpriteSpec, key: string, color: string, src = art.src): HTMLCanvasElement | null {
  const k = key + color + (src === art.src ? "" : ":atk");
  const c0 = tintCache.get(k);
  if (c0) return c0;
  const im = img(src);
  if (!im || typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = art.w;
  c.height = art.h;
  const x = c.getContext("2d")!;
  x.drawImage(im, 0, art.idle.row * art.h, art.w, art.h, 0, 0, art.w, art.h);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, art.w, art.h);
  tintCache.set(k, c);
  return c;
}
/** 등급색 외곽선: 실루엣을 사방 2px 어긋나게 깔고 그 위에 그림 (신화 · 히든은 깜빡임) */
function gradeOutline(
  ctx: CanvasRenderingContext2D,
  art: SpriteSpec,
  id: string,
  cx: number,
  footY: number,
  size: number,
  dir: number,
  squash: number,
  now: number,
  tilt = 0,
  shotT = -1e9
) {
  const g = UNIT[id].grade;
  // 초월: 무지개로 돌아감 (30도씩 — 색 그림 캐시가 너무 늘지 않게)
  const col =
    g === 6
      ? `hsl(${Math.floor(now / 120) % 12 * 30} 95% 72%)`
      : g >= 4 && Math.floor(now / 260) % 2
        ? "#ffffff"
        : GRADE_COLOR[g];
  const sil = tinted(art, id, col, srcAt(art, now, shotT));
  if (!sil) return;
  const [ax, ay] = art.anchor ?? [0.5, 0.96];
  const k = (size * (art.scale ?? 1)) / art.h;
  const w = art.w * k * (1 + squash * 0.5),
    h = art.h * k * (1 - squash);
  const flip = dir * (art.face ?? 1) < 0;
  const o = g >= 3 ? 3 : 2;
  ctx.save();
  ctx.imageSmoothingEnabled = !art.pixel;
  ctx.translate(Math.round(cx), Math.round(footY));
  if (flip) ctx.scale(-1, 1);
  if (tilt) ctx.rotate(tilt * (art.face ?? 1));
  ctx.globalAlpha = g >= 2 ? 1 : 0.85;
  for (const [dx, dy] of [
    [-o, 0],
    [o, 0],
    [0, -o],
    [0, o],
  ])
    ctx.drawImage(sil, -w * ax + dx, -h * ay + dy, w, h);
  ctx.restore();
}

/** 등급 보석: 작은 마름모 + 글자 (N R E L M H) */
function gradeGem(ctx: CanvasRenderingContext2D, g: number, x: number, y: number) {
  ctx.fillStyle = "#07060f";
  ctx.fillRect(x - 2, y - 2, 18, 16);
  ctx.fillStyle = GRADE_COLOR[g];
  ctx.fillRect(x, y, 14, 12);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(x, y, 14, 2);
  ctx.font = `bold 10px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#0a0816";
  ctx.fillText(GRADE_LETTER[g], x + 7, y + 6.5);
}

const faceCache = new Map<string, string>();
/** 적이 가는 방향 (그림 좌우 뒤집기) — 세로로 갈 땐 직전 방향 유지 */
const lastDir = new Map<number, number>();
function moveDir(e: Enemy) {
  const [nx] = pathPos((((e.d + 0.2) % PERIM) + PERIM) % PERIM);
  const dx = nx - e.x;
  const dir = Math.abs(dx) < 0.01 ? (lastDir.get(e.id) ?? 1) : dx > 0 ? 1 : -1;
  lastDir.set(e.id, dir);
  if (lastDir.size > 600) lastDir.clear();
  return dir;
}
function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, now: number) {
  const x = e.x * CELL,
    y = e.y * CELL;
  const foot = y + 10;
  if (e.boss >= 0) {
    const def = BOSSES[e.boss];
    const art = BOSS_ART[def.fighter];
    const gl = Math.floor(now / 90 + e.id) % 11 === 0 ? 4 : 0;
    shadow(ctx, x, foot, 52);
    ctx.save();
    ctx.globalAlpha = e.evade > 0 ? 0.35 : 1;
    if (art && sprite(ctx, art, x - gl, foot, 84 * K, now, 0, moveDir(e))) {
      if (gl) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.35;
        sprite(ctx, art, x + gl, foot, 84 * K, now, 0, moveDir(e));
      }
    } else {
      const r = 30;
      const src = faceCache.get(def.fighter) ?? bossFace(def.fighter);
      faceCache.set(def.fighter, src);
      const im = img(src);
      const cy = foot - r - 6;
      // 도트 테두리 원판
      ctx.fillStyle = "#07060f";
      ctx.fillRect(x - r - 2, cy - r + 6, 2 * r + 4, 2 * r - 12);
      ctx.fillRect(x - r + 6, cy - r - 2, 2 * r - 12, 2 * r + 4);
      ctx.beginPath();
      ctx.rect(x - r, cy - r + 8, 2 * r, 2 * r - 16);
      ctx.rect(x - r + 8, cy - r, 2 * r - 16, 2 * r);
      ctx.clip();
      ctx.fillStyle = def.color;
      ctx.fillRect(x - r, cy - r, 2 * r, 2 * r);
      if (im) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(im, x - r - gl, cy - r, r * 2, r * 2);
        if (gl) {
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = 0.4;
          ctx.drawImage(im, x - r + gl, cy - r, r * 2, r * 2);
        }
        ctx.imageSmoothingEnabled = false;
      } else pixelBlob(ctx, def.fighter, x, cy + r * 0.8, r * 1.6, def.color);
      // 글리치 띠
      if (Math.floor(now / 140 + e.id) % 6 === 0) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#ff4fd8";
        ctx.fillRect(x - r, cy - 6 + ((now / 20) % 20), 2 * r, 4);
      }
    }
    ctx.restore();
    if (e.shield > 0) {
      ctx.fillStyle = "rgba(127,211,255,0.5)";
      ctx.fillRect(P(x - 36), P(foot - 78), 72, 2);
      ctx.fillRect(P(x - 36), P(foot - 4), 72, 2);
    }
    if (e.stun > 0) stars(ctx, x, foot - 74, now);
    // 체력 막대
    const w = 72;
    ctx.fillStyle = "#07060f";
    ctx.fillRect(P(x - w / 2) - 2, P(foot + 4), w + 4, 8);
    ctx.fillStyle = "#ff4d6d";
    ctx.fillRect(P(x - w / 2), P(foot + 6), P((w * Math.max(0, e.hp)) / e.max), 4);
    return;
  }
  const k = KIND[e.kind];
  const size = (e.size === 0 ? 26 : e.size === 1 ? 34 : 44) * K;
  const s = e.tre ? size * 2.2 : e.elite || e.rift ? size * 1.3 : size;
  const hop = e.stun > 0 ? 0 : Math.floor(now / 160 + e.id) % 2 ? 2 : 0;
  shadow(ctx, x, foot, s * 0.8);
  if (e.rift) {
    ctx.fillStyle = Math.floor(now / 150) % 2 ? "rgba(255,79,216,0.45)" : "rgba(95,242,255,0.35)";
    ctx.fillRect(P(x - s * 0.6), P(foot - 6), P(s * 1.2), 8);
  }
  // 보물 골렘: 금빛 깜빡임 (그림이 따로 있으면 ENEMY_ART.treasure)
  if (e.tre) {
    ctx.fillStyle = Math.floor(now / 200) % 2 ? "rgba(255,210,63,0.35)" : "rgba(255,240,160,0.22)";
    ctx.fillRect(P(x - s * 0.8), P(foot - s * 1.5), P(s * 1.6), P(s * 1.6));
  }
  const art = (e.tre && ENEMY_ART.treasure) || ENEMY_ART[e.kind];
  const slowed = e.slowT > 0 || e.aSlow > 0;
  if (!(art && sprite(ctx, art, x, foot - hop, s * 1.25, now, 0, moveDir(e)))) {
    pixelBlob(ctx, e.kind, x, foot - hop, s, slowed ? "#9fe3ff" : k.color);
  }
  if (slowed && art) {
    ctx.fillStyle = "rgba(127,211,255,0.8)";
    ctx.fillRect(P(x - 6), P(foot - s - 4), 4, 4);
    ctx.fillRect(P(x + 2), P(foot - s - 8), 4, 4);
  }
  if (e.elite || e.tre) pxText(ctx, "♛", x, foot - s * 1.25 - 6, e.tre ? 18 : 12, "#ffd23f");
  if (e.stun > 0) stars(ctx, x, foot - s - 4, now);
  // 체력
  if (e.hp < e.max) {
    const w = Math.max(20, P(s));
    ctx.fillStyle = "#07060f";
    ctx.fillRect(P(x - w / 2) - 2, P(foot + 2), w + 4, 6);
    ctx.fillStyle = e.rift ? "#ff4fd8" : e.elite ? "#ffd23f" : "#6dff8f";
    ctx.fillRect(P(x - w / 2), P(foot + 4), P((w * Math.max(0, e.hp)) / e.max), 2);
  }
}

/**
 * 공격 동작 (그림 한 장으로 하는 코드 애니메이션, 200ms):
 *  기사단 — 앞으로 내딛으며 앞으로 기울였다 돌아옴 (베기)
 *  기계공방 — 뒤로 반동 + 덜컹 (발사)
 *  마도회 — 살짝 떠오르고 발밑에 마법진 (시전)
 *  히든 — 글리치처럼 좌우로 튐
 */
const ATK_MS = 200;
function attackPose(f: string, since: number, dir: number, seed: number) {
  const none = { dx: 0, dy: 0, tilt: 0, squash: 0, cast: 0 };
  if (since < 0 || since >= ATK_MS) return none;
  const q = since / ATK_MS; // 0 → 1
  const step = Math.floor(q * 4); // 4계단 (도트 느낌)
  switch (f) {
    case "knight":
      return { dx: [5, 7, 4, 1][step] * dir, dy: 0, tilt: [0.16, 0.24, 0.1, 0][step] * dir, squash: [0.06, 0.08, 0.03, 0][step], cast: 0 };
    case "mech":
      return { dx: [-4, -3, -1, 0][step] * dir + (step < 2 ? (Math.floor(seed / 30) % 2 ? 1 : -1) : 0), dy: 0, tilt: [-0.06, -0.04, -0.02, 0][step] * dir, squash: [0.1, 0.05, 0.02, 0][step], cast: 0 };
    case "arcane":
      return { dx: 0, dy: [2, 4, 4, 2][step], tilt: 0, squash: [0, -0.04, -0.03, 0][step], cast: 1 - q };
    default:
      return { dx: [3, -3, 2, 0][step], dy: [0, 2, 0, 0][step], tilt: 0, squash: 0.04, cast: 1 - q };
  }
}

/** 시전 마법진 (발밑 타원 위 도트 점들 — 마도회 보라 · 히든 초록) */
function castRing(ctx: CanvasRenderingContext2D, f: string, x: number, y: number, size: number, a: number) {
  const col = f === "hidden" ? "76,255,176" : "192,140,255";
  const r = size * 0.42;
  ctx.fillStyle = `rgba(${col},${0.85 * a})`;
  for (let k = 0; k < 14; k++) {
    const ang = (k / 14) * Math.PI * 2 + (1 - a) * 2;
    ctx.fillRect(P(x + Math.cos(ang) * r) - 2, P(y + Math.sin(ang) * r * 0.35) - 1, 4, 2);
  }
  ctx.fillStyle = `rgba(255,255,255,${0.7 * a})`;
  for (let k = 0; k < 3; k++) ctx.fillRect(P(x - 6 + k * 6) - 1, P(y - 8 - (1 - a) * 18 - k * 4) - 1, 2, 2);
}

function stars(ctx: CanvasRenderingContext2D, x: number, y: number, now: number) {
  for (let i = 0; i < 3; i++) {
    const a = now / 200 + (i * Math.PI * 2) / 3;
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(P(x + Math.cos(a) * 10) - 2, P(y + Math.sin(a) * 3) - 2, 4, 4);
  }
}

function drawFx(ctx: CanvasRenderingContext2D, v: View) {
  const now = v.now;
  v.vfx = v.vfx.filter((f) => now - f.t < f.life);
  for (const { fx, t, life } of v.vfx) {
    const p = (now - t) / life;
    const a = 1 - p;
    switch (fx.k) {
      case "shot": {
        drawShot(ctx, fx, p, a);
        break;
      }
      case "aoe": {
        const color = FACTION_COLOR[UNIT[fx.def].faction];
        const r = fx.r * CELL * (0.35 + 0.65 * p);
        const n = Math.max(12, Math.floor(r / 3));
        ctx.fillStyle = hexA(color, a);
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * Math.PI * 2;
          ctx.fillRect(
            P(fx.x * CELL + Math.cos(ang) * r) - 2,
            P(fx.y * CELL + Math.sin(ang) * r * 0.75) - 2,
            4,
            4
          );
        }
        ctx.fillStyle = hexA(color, a * 0.15);
        ctx.fillRect(P(fx.x * CELL - r * 0.7), P(fx.y * CELL - r * 0.5), P(r * 1.4), P(r));
        break;
      }
      case "chain": {
        ctx.fillStyle = `rgba(160,230,255,${a})`;
        const x1 = fx.x1 * CELL,
          y1 = fx.y1 * CELL - 10,
          x2 = fx.x2 * CELL,
          y2 = fx.y2 * CELL - 10;
        const n = Math.max(4, Math.floor(Math.hypot(x2 - x1, y2 - y1) / 6));
        for (let k = 0; k <= n; k++) {
          const q = k / n;
          const j = k % 2 ? 4 : -4;
          ctx.fillRect(P(x1 + (x2 - x1) * q + j) - 1, P(y1 + (y2 - y1) * q - j) - 1, 3, 3);
        }
        break;
      }
      case "ult": {
        const x = cellX(fx.c) * CELL,
          y = cellY(fx.c) * CELL;
        // 기둥 빛
        ctx.fillStyle = `rgba(95,242,255,${a * 0.35})`;
        ctx.fillRect(P(x - 14), 0, 28, P(y));
        pxText(ctx, fx.name, x, y - 44 - p * 18, 14, "#5ff2ff", a);
        break;
      }
      case "die": {
        const n = fx.boss ? 18 : 6;
        for (let i = 0; i < n; i++) {
          const ang = i * 2.4 + fx.x;
          const dd = p * (fx.boss ? 70 : 20);
          ctx.fillStyle = i % 3 ? `rgba(255,79,216,${a})` : `rgba(95,242,255,${a})`;
          ctx.fillRect(
            P(fx.x * CELL + Math.cos(ang) * dd) - 2,
            P(fx.y * CELL - 8 + Math.sin(ang) * dd * 0.7 + p * p * 16) - 2,
            4,
            4
          );
        }
        if (fx.gold > 1)
          pxText(ctx, `+${fx.gold}`, fx.x * CELL, fx.y * CELL - 22 - p * 14, 11, "#ffd23f", a);
        break;
      }
      case "miss":
        pxText(ctx, "MISS", fx.x * CELL, fx.y * CELL - 30 - p * 10, 11, "#bfb3ff", a);
        break;
      case "whip": {
        const x = cellX(fx.c) * CELL,
          y = cellY(fx.c) * CELL;
        ctx.fillStyle = `rgba(255,77,109,${a})`;
        for (let k = -6; k <= 6; k++) {
          ctx.fillRect(P(x + k * 4) - 2, P(y + k * 4) - 2, 4, 4);
          ctx.fillRect(P(x + k * 4) - 2, P(y - k * 4) - 2, 4, 4);
        }
        break;
      }
      case "heal":
        pxText(ctx, "+", fx.x * CELL, fx.y * CELL - 40 - p * 16, 18, "#6dff8f", a);
        break;
      case "spawn":
        drawSpawn(ctx, fx.c, fx.g, p);
        break;
    }
  }
}

/**
 * 소환 효과: 위에서 떨어지는 빛기둥 → 칸 바닥에 도트 고리가 퍼지고 반짝이가 튐.
 * 등급이 높을수록 굵고 오래 · 반짝이 많이 (신화 · 히든은 흰색 섬광까지)
 */
function drawSpawn(ctx: CanvasRenderingContext2D, c: number, g: number, p: number) {
  const [cx, cy] = slotCenter(c);
  const fy = cy + (c < CELLS ? 26 : 18);
  const col = GRADE_COLOR[g] ?? "#ffffff";
  const a = 1 - p;
  const sq = (x: number, y: number, w: number, h: number, cc: string) => {
    ctx.fillStyle = cc;
    ctx.fillRect(P(x) - Math.floor(w / 2), P(y) - Math.floor(h / 2), w, h);
  };
  // 빛기둥 (처음 35%): 위에서 내려오는 굵은 줄
  if (p < 0.35) {
    const q = p / 0.35;
    const w = 6 + g * 3;
    const top = fy - 120;
    const bot = top + (fy - 10 - top) * Math.min(1, q * 1.6);
    ctx.fillStyle = hexA(col, 0.55 * (1 - q * 0.5));
    ctx.fillRect(P(cx - w / 2), P(top), w, P(bot - top));
    ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - q)})`;
    ctx.fillRect(P(cx - 1), P(top), 2, P(bot - top));
  }
  // 바닥 고리
  const r = 8 + p * (22 + g * 4);
  const n = 12 + g * 2;
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * Math.PI * 2;
    sq(cx + Math.cos(ang) * r, fy - 6 + Math.sin(ang) * r * 0.35, 4, 2, hexA(k % 3 ? col : "#ffffff", a));
  }
  // 튀는 반짝이 (높은 등급일수록 많이)
  const m = 3 + g * 2;
  for (let k = 0; k < m; k++) {
    const ang = k * 2.39;
    const d = p * (18 + g * 6);
    sq(cx + Math.cos(ang) * d, fy - 24 - p * 30 + Math.sin(ang) * d * 0.5, 2, 2, hexA(k % 2 ? "#ffffff" : col, a));
  }
  // 신화 · 히든: 처음에 칸 전체 흰 섬광
  if (g >= 4 && p < 0.18) {
    ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - p / 0.18)})`;
    ctx.fillRect(P(cx - 36), P(fy - 72), 72, 72);
  }
}

/* ───────── 공격 효과 (유닛마다 고유) ───────── */

type HitKind = "slash" | "pierce" | "bullet" | "shell" | "flame" | "spark" | "beam" | "orb" | "frost" | "poison" | "fire" | "star" | "glitch";
/** 유닛 id → 공격 모양 (없으면 세력 · 능력으로 정함) */
const HIT_KIND: Record<string, HitKind> = {
  k_spear: "pierce", k_hunter: "pierce", k_dragoon: "pierce", k_aegis: "pierce",
  m_turret: "bullet", m_bolt: "bullet", m_drone: "bullet", m_scrap: "spark", m_arsenal: "bullet",
  m_mortar: "shell", m_missile: "shell", m_titan: "shell", m_omega: "shell", m_orbit: "beam",
  m_flame: "flame", m_inferno: "flame", m_coil: "spark", m_rail: "beam",
  a_frost: "frost", a_chrono: "frost", a_lord: "frost",
  a_venom: "poison", a_plague: "poison",
  a_pyro: "fire", a_archmage: "fire",
  a_star: "star", a_sage: "star", a_bolt: "spark", a_wind: "orb", a_void: "orb", a_seal: "orb", a_novice: "orb",
  h_debugger: "glitch", h_noa: "beam",
  k_black: "slash", k_lion: "slash", k_astra: "slash",
  m_chief: "shell", m_grav: "shell", m_deus: "beam",
  a_moon: "frost", a_dream: "star", a_origin: "star",
};
function hitKind(id: string): HitKind {
  const k = HIT_KIND[id];
  if (k) return k;
  const f = UNIT[id]?.faction;
  return f === "knight" ? "slash" : f === "mech" ? "bullet" : f === "arcane" ? "orb" : "glitch";
}
const HIT_COLOR: Partial<Record<HitKind, [string, string]>> = {
  slash: ["#e8f4ff", "#6ec1ff"],
  pierce: ["#ffffff", "#9fd8ff"],
  bullet: ["#fff2b8", "#ffb347"],
  shell: ["#ffd23f", "#ff7a2f"],
  flame: ["#ffd23f", "#ff4f1f"],
  spark: ["#e6fdff", "#5ff2ff"],
  beam: ["#ffffff", "#ff9a3d"],
  orb: ["#f2e6ff", "#c08cff"],
  frost: ["#ffffff", "#8fe3ff"],
  poison: ["#d6ffe0", "#6dff8f"],
  fire: ["#fff2b8", "#ff6a2a"],
  star: ["#fffbe0", "#ffd23f"],
  glitch: ["#ffffff", "#4cffb0"],
};

/** 탄 하나: 날아가는 동안(h0<1)과 맞은 뒤(번쩍) — 모양은 유닛마다. 도트 사각형만 씀 */
function drawShot(ctx: CanvasRenderingContext2D, fx: Extract<Fx, { k: "shot" }>, p: number, a: number) {
  const d = UNIT[fx.def];
  const kind = hitKind(fx.def);
  const [hi, col] = fx.crit ? ["#ffffff", "#ffd23f"] : (HIT_COLOR[kind] ?? ["#ffffff", FACTION_COLOR[d.faction]]);
  const sx = cellX(fx.c) * CELL,
    sy = cellY(fx.c) * CELL - 18;
  const tx = fx.x * CELL,
    ty = fx.y * CELL - 6;
  // 근접형(베기)은 날아가지 않고 바로 맞은 자리에 — 나머지는 탄이 날아감
  const melee = kind === "slash";
  const speed = kind === "beam" ? 6 : kind === "shell" ? 1.8 : 2.6;
  const h0 = melee ? 1 : Math.min(1, p * speed);
  const big = fx.crit || d.grade >= 3 ? 2 : 0;
  // 도트를 한 단계 굵게 (2px → 3px 계단) — 맞는 느낌이 잘 보이게
  const sq = (x: number, y: number, w: number, h: number, c: string) => {
    const W = Math.max(2, Math.round(w * 1.5)),
      H = Math.max(2, Math.round(h * 1.5));
    ctx.fillStyle = c;
    ctx.fillRect(P(x) - Math.floor(W / 2), P(y) - Math.floor(H / 2), W, H);
  };
  if (h0 < 1) {
    const px = sx + (tx - sx) * h0;
    // 포탄은 포물선
    const arc = kind === "shell" ? -Math.sin(h0 * Math.PI) * 26 : 0;
    const py = sy + (ty - sy) * h0 + arc;
    const ux = (tx - sx) * 0.07,
      uy = (ty - sy) * 0.07;
    switch (kind) {
      case "beam":
        // 레이저: 쏜 곳부터 지금 끝까지 줄
        for (let q = 0; q <= h0; q += 0.05) sq(sx + (tx - sx) * q, sy + (ty - sy) * q, 4 + big, 4 + big, q > h0 - 0.1 ? hi : col);
        break;
      case "flame":
        for (let k = 0; k < 4; k++) sq(px - ux * k * 0.6 + ((k * 7) % 5) - 2, py - uy * k * 0.6 + ((k * 5) % 5) - 2, 6 - k, 6 - k, k ? col : hi);
        break;
      case "spark":
        sq(px, py, 4 + big, 4 + big, hi);
        sq(px - ux * 0.8 + 3, py - uy * 0.8 - 3, 2, 2, col);
        sq(px - ux * 1.6 - 3, py - uy * 1.6 + 3, 2, 2, col);
        break;
      case "orb":
      case "fire":
      case "poison":
      case "frost":
      case "star":
        // 마법탄: 십자 반짝이 + 꼬리
        sq(px - ux, py - uy, 4, 4, hexA(col, 0.4));
        sq(px, py, 6 + big, 2, col);
        sq(px, py, 2, 6 + big, col);
        sq(px, py, 2 + big, 2 + big, hi);
        break;
      case "glitch":
        sq(px, py, 6, 4, col);
        sq(px + 4, py - 3, 4, 2, "#ff4fd8");
        sq(px - 3, py + 3, 2, 2, "#5ff2ff");
        break;
      default:
        // 총알 · 창: 꼬리 + 탄
        sq(px - ux, py - uy, 4 + big, 4 + big, hexA(col, 0.35));
        sq(px, py, 4 + big, 4 + big, hi);
        sq(px, py, 2 + big, 2 + big, col);
    }
    return;
  }
  // 맞은 자리 (p 를 다시 0~1 로)
  const q = melee ? p : Math.min(1, (p - 1 / speed) / (1 - 1 / speed));
  const al = Math.max(0, 1 - q);
  ctx.globalAlpha = al;
  switch (kind) {
    case "slash": {
      // 사선 베기 3줄 (치명타면 X 자)
      const n = 6 + big * 2;
      for (let k = -n; k <= n; k++) {
        sq(tx + k * 2, ty - k * 2 + 2, 2, 2, k === 0 ? hi : col);
        if (fx.crit) sq(tx + k * 2, ty + k * 2 - 2, 2, 2, col);
        else if (Math.abs(k) < n - 2) sq(tx + k * 2 + 4, ty - k * 2 + 6, 2, 2, hexA(col, 0.6));
      }
      break;
    }
    case "pierce":
      for (let k = 0; k < 5; k++) sq(tx + (tx - sx > 0 ? k : -k) * 4, ty, 4, 2, k ? col : hi);
      sq(tx, ty, 2, 8, hi);
      break;
    case "shell":
    case "fire":
    case "flame": {
      // 폭발: 퍼지는 도트 + 가운데 섬광
      const r = 4 + q * (kind === "shell" ? 14 : 10);
      for (let k = 0; k < 8; k++) {
        const ang = k * 0.785;
        sq(tx + Math.cos(ang) * r, ty + Math.sin(ang) * r * 0.7, 4, 4, k % 2 ? col : hi);
      }
      if (q < 0.4) sq(tx, ty, 8, 8, hi);
      break;
    }
    case "spark":
    case "beam":
      sq(tx, ty, 12, 2, hi);
      sq(tx, ty, 2, 12, hi);
      sq(tx + 5, ty + 5, 2, 2, col);
      sq(tx - 5, ty - 5, 2, 2, col);
      sq(tx + 5, ty - 5, 2, 2, col);
      sq(tx - 5, ty + 5, 2, 2, col);
      break;
    case "frost":
      // 눈꽃 (6 갈래)
      for (let k = 0; k < 6; k++) {
        const ang = k * 1.047;
        for (let r = 2; r <= 8; r += 3) sq(tx + Math.cos(ang) * r, ty + Math.sin(ang) * r, 2, 2, r > 6 ? col : hi);
      }
      break;
    case "poison":
      // 올라가는 거품
      for (let k = 0; k < 4; k++) sq(tx - 6 + k * 4, ty - q * (8 + k * 3), k % 2 ? 4 : 2, k % 2 ? 4 : 2, k % 2 ? col : hi);
      break;
    case "star":
      sq(tx, ty - q * 6, 10, 2, col);
      sq(tx, ty - q * 6, 2, 10, col);
      sq(tx, ty - q * 6, 4, 4, hi);
      break;
    case "glitch":
      for (let k = 0; k < 5; k++) sq(tx + ((k * 13) % 17) - 8, ty + ((k * 7) % 11) - 5, 6 - (k % 3) * 2, 2 + (k % 2) * 2, ["#4cffb0", "#ff4fd8", "#5ff2ff", "#ffffff", "#ffd23f"][k]);
      break;
    default:
      // 마법 · 총알: 십자 번쩍 + 작은 점 4개
      sq(tx, ty, 10, 2, col);
      sq(tx, ty, 2, 10, col);
      sq(tx, ty, 4, 4, hi);
      for (let k = 0; k < 4; k++) sq(tx + Math.cos(k * 1.57 + q) * (4 + q * 6), ty + Math.sin(k * 1.57 + q) * (4 + q * 6), 2, 2, hi);
  }
  ctx.globalAlpha = 1;
  if (fx.crit && p > 0.35) pxText(ctx, "CRIT!", tx, ty - 16 - p * 12, 12, "#ffd23f", a);
}

/** 길 위 진행 표시용 (미니맵 등) */
export const pathPoint = (d: number) => pathPos(((d % PERIM) + PERIM) % PERIM);
