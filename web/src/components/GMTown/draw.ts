import { ARCH, BENCHES, BOARD, BUILDINGS, FLOWERS, FOUNTAIN, PLAZA, ROADS, TREES, WORLD, Y_SCALE, Z_SCALE, doorW, groundAt, hash01, type Building, type Tree } from "@/lib/gmtown/world";

/*
 * GMTOWN 그림 — 땅(조각마다 미리 그려 둠) · 건물(건물마다 미리 그린 그림 + 움직이는 장식) · 나무 · 가로등 · 분수 · 아치.
 * 전부 코드로 그린 뼈대. 크기 · 각도 · 그림자 · 외곽선 · 간판은 화풍과 상관없이 같게 (한 마을로 보이게), 벽 · 창 · 지붕만 화풍대로.
 *   pixel : 픽셀 게임 (리듬업 · 파이트 · 디펜스) — 칸이 딱 떨어지는 네모, 갈무리 글꼴을 작게 써서 키움
 *   anime : 애니 게임 (포커 · 올인 러브) — 부드러운 그라데이션, 아치 창, 줄무늬 차양, 전구 간판
 *   neon  : 증권거래소 — 기둥 · 계단 · 유리벽 · 시세 전광판 · 돔
 *   noir  : 오늘의 용의자 — 벽돌 · 블라인드 창 · 벽등
 *   home  : 우리 집 — 박공지붕 · 나무 문 · 꽃 상자
 */

export const OUT = "rgba(26,18,42,0.9)";
const FONT_TITLE = `"Black Han Sans", "Nanum Gothic", sans-serif`;
const FONT_PIXEL = `"Galmuri11", "Nanum Gothic", monospace`;
const FONT_UI = `"Nanum Gothic", sans-serif`;

export const SKY = "#3f7d4a";

// ───────────── 작은 도구 ─────────────

export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/** #rrggbb 밝기 바꾸기 (amt -1 ~ 1) */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext("2d")!];
}

/** 글자가 폭에 들어가게 크기를 줄여서 font 를 정함 → 크기 */
function fitFont(ctx: CanvasRenderingContext2D, text: string, family: string, weight: string, maxW: number, maxPx: number): number {
  let px = maxPx;
  for (; px > 6; px -= 1) {
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  return px;
}

/** 픽셀 글자: 작은 크기로 그린 뒤 정수 배로 키움 (부드럽게 하지 않음) */
function pixelText(text: string, color: string, shadow: string, maxW: number, scale: number): HTMLCanvasElement {
  const mc = canvasOf(8, 8)[1];
  mc.font = `700 11px ${FONT_PIXEL}`;
  let base = 11;
  while (base > 8 && mc.measureText(text).width * scale > maxW) {
    base -= 1;
    mc.font = `700 ${base}px ${FONT_PIXEL}`;
  }
  const tw = Math.ceil(mc.measureText(text).width) + 2;
  const [s, sc] = canvasOf(tw, base + 4);
  sc.font = `700 ${base}px ${FONT_PIXEL}`;
  sc.textBaseline = "top";
  sc.fillStyle = shadow;
  sc.fillText(text, 1, 2);
  sc.fillStyle = color;
  sc.fillText(text, 0, 1);
  // 반쯤 투명한 가장자리를 딱 끊어서 진짜 픽셀처럼
  const id = sc.getImageData(0, 0, s.width, s.height);
  for (let i = 3; i < id.data.length; i += 4) id.data[i] = id.data[i] > 110 ? 255 : 0;
  sc.putImageData(id, 0, 0);
  const [o, oc] = canvasOf(s.width * scale, s.height * scale);
  oc.imageSmoothingEnabled = false;
  oc.drawImage(s, 0, 0, o.width, o.height);
  return o;
}

// ───────────── 땅 ─────────────

const GRASS = ["#8bce71", "#89cc6f", "#8ed174"];
const ROAD = "#e7d8bf";
const ROAD_LINE = "#d2c09f";
const CURB = "#bba582";
const WALK = "#efe6d6";
const WALK_LINE = "#dccfb9";

/** 0~1 부드러운 잡음 (s 칸 간격 격자점 사이를 이어서) */
function smooth(x: number, y: number, s: number): number {
  const gx = x / s,
    gy = y / s;
  const ix = Math.floor(gx),
    iy = Math.floor(gy);
  const fx = gx - ix,
    fy = gy - iy;
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy);
  const a = hash01(ix, iy),
    b = hash01(ix + 1, iy),
    c = hash01(ix, iy + 1),
    d = hash01(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** 땅 한 조각 (x0, y0 부터 n×n 칸) 을 ctx 에 그림. ctx 는 「1칸 = T px, 깊이는 × sin35」 로 맞춰서 넘김 */
export function paintGround(ctx: CanvasRenderingContext2D, x0: number, y0: number, n: number) {
  for (let ty = Math.floor(y0); ty < y0 + n; ty++)
    for (let tx = Math.floor(x0); tx < x0 + n; tx++) {
      const g = tx < 0 || ty < 0 || tx >= WORLD.w || ty >= WORLD.h ? "grass" : groundAt(tx + 0.5, ty + 0.5);
      const hsh = hash01(tx, ty);
      if (g === "grass" || g === "plaza") {
        ctx.fillStyle = GRASS[1];
        ctx.fillRect(tx, ty, 1.02, 1.02);
        // 큰 얼룩 (부드럽게 이어지는 짙고 옅은 풀) — 1/4칸씩 칠해서 칸 경계가 안 보이게
        for (let qy = 0; qy < 4; qy++)
          for (let qx = 0; qx < 4; qx++) {
            const x = tx + (qx + 0.5) / 4,
              y = ty + (qy + 0.5) / 4;
            const big = smooth(x, y, 5) * 0.65 + smooth(x, y, 2.3) * 0.35;
            // 바탕(137,204,111)에 짙은 풀(60,130,50) · 옅은 풀(255,255,200)을 섞은 불투명 색 (겹쳐도 줄이 안 생김)
            const [tr, tg, tb, k] = big > 0.5 ? [60, 130, 50, (big - 0.5) * 0.3] : [255, 255, 200, (0.5 - big) * 0.16];
            ctx.fillStyle = `rgb(${137 + (tr - 137) * k},${204 + (tg - 204) * k},${111 + (tb - 111) * k})`;
            ctx.fillRect(tx + qx / 4, ty + qy / 4, 0.27, 0.27);
          }
        // 풀 · 작은 꽃
        ctx.fillStyle = "rgba(70,140,60,0.55)";
        for (let k = 0; k < 3; k++) {
          const a = hash01(tx * 7 + k, ty * 13);
          const b = hash01(tx * 11, ty * 5 + k);
          ctx.fillRect(tx + a * 0.9, ty + b * 0.9, 0.05, 0.12);
          ctx.fillRect(tx + a * 0.9 + 0.07, ty + b * 0.9 + 0.03, 0.05, 0.09);
        }
        if (hsh > 0.93) {
          ctx.fillStyle = hsh > 0.965 ? "#fff3a6" : "#ffc2d6";
          ctx.beginPath();
          ctx.arc(tx + 0.5, ty + 0.5, 0.07, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (g === "road") {
        ctx.fillStyle = ROAD;
        ctx.fillRect(tx, ty, 1.02, 1.02);
        // 벽돌 두 줄 (줄마다 반 칸 어긋남)
        ctx.fillStyle = ROAD_LINE;
        ctx.fillRect(tx, ty, 1, 0.04);
        ctx.fillRect(tx, ty + 0.5, 1, 0.04);
        ctx.fillRect(tx + (ty % 2 ? 0.5 : 0), ty, 0.035, 0.5);
        ctx.fillRect(tx + (ty % 2 ? 0 : 0.5), ty + 0.5, 0.035, 0.5);
        if (hsh > 0.7) {
          ctx.fillStyle = "rgba(255,255,255,0.18)";
          ctx.fillRect(tx + 0.06, ty + 0.07, 0.38, 0.38);
        }
      } else {
        ctx.fillStyle = WALK;
        ctx.fillRect(tx, ty, 1.02, 1.02);
        ctx.fillStyle = WALK_LINE;
        ctx.fillRect(tx, ty, 1, 0.035);
        ctx.fillRect(tx, ty, 0.035, 1);
      }
    }
  // 길 가장자리 (잔디와 닿는 곳) 연석
  ctx.fillStyle = CURB;
  for (let ty = Math.floor(y0); ty < y0 + n; ty++)
    for (let tx = Math.floor(x0); tx < x0 + n; tx++) {
      if (tx < 0 || ty < 0 || tx >= WORLD.w || ty >= WORLD.h) continue;
      const g = groundAt(tx + 0.5, ty + 0.5);
      if (g !== "road" && g !== "walk") continue;
      const nb = (dx: number, dy: number) => {
        const q = groundAt(tx + 0.5 + dx, ty + 0.5 + dy);
        return q === "grass";
      };
      if (nb(0, -1)) ctx.fillRect(tx, ty, 1.02, 0.1);
      if (nb(0, 1)) ctx.fillRect(tx, ty + 0.9, 1.02, 0.1);
      if (nb(-1, 0)) ctx.fillRect(tx, ty, 0.08, 1.02);
      if (nb(1, 0)) ctx.fillRect(tx + 0.92, ty, 0.08, 1.02);
    }
  // 분수 광장: 동심원 돌바닥
  ctx.save();
  ctx.beginPath();
  ctx.arc(PLAZA.x, PLAZA.y, PLAZA.r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#eadcc4";
  ctx.fillRect(PLAZA.x - PLAZA.r, PLAZA.y - PLAZA.r, PLAZA.r * 2, PLAZA.r * 2);
  for (let r = 1.2; r < PLAZA.r; r += 1.05) {
    ctx.strokeStyle = "#d6c4a5";
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(PLAZA.x, PLAZA.y, r, 0, Math.PI * 2);
    ctx.stroke();
    const seg = Math.max(8, Math.round(r * 5));
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2 + (r % 2) * 0.2;
      ctx.beginPath();
      ctx.moveTo(PLAZA.x + Math.cos(a) * r, PLAZA.y + Math.sin(a) * r);
      ctx.lineTo(PLAZA.x + Math.cos(a) * (r + 1.05), PLAZA.y + Math.sin(a) * (r + 1.05));
      ctx.stroke();
    }
  }
  // 별 모양 무늬 (분수 둘레)
  ctx.fillStyle = "rgba(196,150,96,0.35)";
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(PLAZA.x + Math.cos(a) * 2.6, PLAZA.y + Math.sin(a) * 2.6);
    ctx.lineTo(PLAZA.x + Math.cos(a + 0.2) * 4.2, PLAZA.y + Math.sin(a + 0.2) * 4.2);
    ctx.lineTo(PLAZA.x + Math.cos(a) * 5.4, PLAZA.y + Math.sin(a) * 5.4);
    ctx.lineTo(PLAZA.x + Math.cos(a - 0.2) * 4.2, PLAZA.y + Math.sin(a - 0.2) * 4.2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = CURB;
  ctx.lineWidth = 0.14;
  ctx.beginPath();
  ctx.arc(PLAZA.x, PLAZA.y, PLAZA.r - 0.07, 0, Math.PI * 2);
  ctx.stroke();

  // 그림자 (해는 왼쪽 뒤) — 건물 · 나무
  ctx.fillStyle = "rgba(30,40,60,0.17)";
  for (const b of BUILDINGS) {
    const ox = b.h * 0.22,
      oy = b.h * 0.16;
    ctx.beginPath();
    ctx.moveTo(b.x + b.w, b.y);
    ctx.lineTo(b.x + b.w + ox, b.y + oy);
    ctx.lineTo(b.x + b.w + ox, b.y + b.d + oy);
    ctx.lineTo(b.x + ox, b.y + b.d + oy);
    ctx.lineTo(b.x, b.y + b.d);
    ctx.lineTo(b.x + b.w, b.y + b.d);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "rgba(30,50,40,0.16)";
  for (const t of TREES) {
    ctx.beginPath();
    ctx.ellipse(t.x + 0.45 * t.s, t.y + 0.3 * t.s, 0.85 * t.s, 0.6 * t.s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 아치 아래 · 안내판 앞 보도
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (const f of FLOWERS) ctx.fillRect(f.x - 0.1, f.y - 0.1, f.w + 0.2, f.d + 0.2);
  void ROADS;
}

// ───────────── 건물 ─────────────

export interface BuildingArt {
  canvas: HTMLCanvasElement;
  /** 그림 안에서 앞면 왼쪽 아래(땅에 닿는 곳)의 위치 (CSS px) */
  ox: number;
  oy: number;
  /** 화면 상자 (앞면 왼쪽 아래 기준) — 누르기 판정 */
  box: { x: number; y: number; w: number; h: number };
}

/** 움직이는 장식 · 누르기에 쓰는 자리 (앞면 왼쪽 아래 기준 px) */
export interface Layout {
  W: number;
  FH: number;
  TD: number;
  sign: { x: number; y: number; w: number; h: number };
  door: { x: number; y: number; w: number; h: number };
  extraTop: number;
}

export function layoutOf(b: Building, T: number): Layout {
  const W = b.w * T,
    FH = b.h * Z_SCALE * T,
    TD = b.d * Y_SCALE * T;
  const dw = doorW(b) * T;
  const dh = Math.min(FH * 0.42, 2.1 * Z_SCALE * T);
  const sh = Math.min(T * 0.95, FH * 0.2);
  const sw = Math.min(W * 0.78, Math.max(T * 4.5, W * 0.62));
  const signY = b.style === "neon" ? -FH + T * 0.15 : b.roof === "gable" ? -dh - T * 0.3 - sh : -FH + FH * 0.1;
  return {
    W,
    FH,
    TD,
    door: { x: W / 2 - dw / 2, y: -dh, w: dw, h: dh },
    sign: { x: W / 2 - sw / 2, y: signY, w: sw, h: sh },
    extraTop: T * (b.roof === "dome" ? 3.2 : b.roof === "castle" ? 2.4 : b.roof === "gable" ? 2.6 : 1.2),
  };
}

/** 앞면 창 자리 (문 · 간판 피해서) */
function windowsOf(b: Building, L: Layout, T: number, rows: number, cols: number, ww: number, wh: number): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const top = L.sign.y + L.sign.h + T * 0.35;
  const bottom = -T * 0.35;
  const span = bottom - top;
  for (let r = 0; r < rows; r++) {
    const y = top + ((r + 0.5) / rows) * span - wh / 2;
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * L.W - ww / 2;
      // 문과 겹치면 뺌
      if (x + ww > L.door.x - T * 0.25 && x < L.door.x + L.door.w + T * 0.25 && y + wh > L.door.y - T * 0.2) continue;
      out.push({ x, y, w: ww, h: wh });
    }
  }
  return out;
}

type Img = HTMLImageElement | null;

/** 건물 한 채를 그림 한 장으로 (T = 1칸 px, dpr = 화면 배율) */
export function renderBuilding(b: Building, T: number, dpr: number, icon: Img): BuildingArt {
  const L = layoutOf(b, T);
  const pad = T * 0.6;
  const cw = L.W + pad * 2,
    chh = L.FH + L.TD + L.extraTop + pad;
  const [c, ctx] = canvasOf(cw * dpr, chh * dpr);
  ctx.scale(dpr, dpr);
  const ox = pad,
    oy = chh - pad * 0.5;
  ctx.translate(ox, oy);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.5, T * 0.035);

  switch (b.style) {
    case "pixel":
      pixelBuilding(ctx, b, L, T, icon);
      break;
    case "anime":
      animeBuilding(ctx, b, L, T, icon);
      break;
    case "neon":
      neonBuilding(ctx, b, L, T, icon);
      break;
    case "noir":
      noirBuilding(ctx, b, L, T, icon);
      break;
    case "home":
      homeBuilding(ctx, b, L, T);
      break;
  }
  return { canvas: c, ox, oy, box: { x: 0, y: -(L.FH + L.TD + L.extraTop * 0.6), w: L.W, h: L.FH + L.TD + L.extraTop * 0.6 } };
}

/** 지붕(윗면) 기본: 네모 + 앞쪽 난간 */
function flatTop(ctx: CanvasRenderingContext2D, b: Building, L: Layout, T: number) {
  const y0 = -L.FH - L.TD,
    W = L.W,
    TD = L.TD;
  // 난간 (네 변) · 안쪽 바닥
  ctx.fillStyle = shade(b.top, 0.28);
  ctx.fillRect(0, y0, W, TD);
  const e = T * 0.22,
    ey = e * Y_SCALE;
  ctx.fillStyle = shade(b.top, -0.05);
  ctx.fillRect(e, y0 + ey, W - e * 2, TD - ey * 2);
  // 바닥 타일
  ctx.strokeStyle = alpha("#000000", 0.12);
  ctx.lineWidth = 1;
  for (let x = e + T * 0.6; x < W - e; x += T * 0.6) {
    ctx.beginPath();
    ctx.moveTo(x, y0 + ey);
    ctx.lineTo(x, y0 + TD - ey);
    ctx.stroke();
  }
  for (let y = y0 + ey + T * 0.6 * Y_SCALE; y < y0 + TD - ey; y += T * 0.6 * Y_SCALE) {
    ctx.beginPath();
    ctx.moveTo(e, y);
    ctx.lineTo(W - e, y);
    ctx.stroke();
  }
  // 안쪽 그림자 (뒤 난간 아래)
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(e, y0 + ey, W - e * 2, T * 0.18);
  // 실외기 둘 (네모 + 팬)
  for (const [ux, uy] of [
    [0.16, 0.35],
    [0.8, 0.55],
  ]) {
    const x = e + (W - e * 2) * ux,
      y = y0 + TD * uy;
    const w = T * 0.7,
      hh = T * 0.42;
    ctx.fillStyle = "#c9ced8";
    ctx.fillRect(x, y - hh, w, hh);
    ctx.fillStyle = "#e6e9ef";
    ctx.fillRect(x, y - hh - w * 0.5 * Y_SCALE, w, w * 0.5 * Y_SCALE);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y - hh - w * 0.5 * Y_SCALE, w, hh + w * 0.5 * Y_SCALE);
    ctx.strokeStyle = "#7a8090";
    ctx.beginPath();
    ctx.arc(x + w / 2, y - hh / 2, hh * 0.32, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 앞 난간 위 밝은 띠 · 외곽선
  ctx.fillStyle = shade(b.top, 0.42);
  ctx.fillRect(0, -L.FH - T * 0.14, W, T * 0.14);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.5, T * 0.035);
  ctx.strokeRect(0, y0, W, TD);
}

function signIcon(ctx: CanvasRenderingContext2D, icon: Img, x: number, y: number, s: number, smooth = true) {
  if (!icon) return;
  ctx.save();
  rr(ctx, x, y, s, s, s * 0.22);
  ctx.clip();
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(icon, x, y, s, s);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1.2;
  rr(ctx, x, y, s, s, s * 0.22);
  ctx.stroke();
}

// ── 픽셀 ──

function pixelBuilding(ctx: CanvasRenderingContext2D, b: Building, L: Layout, T: number, icon: Img) {
  const p = Math.max(2, Math.round(T / 10));
  const snap = (v: number) => Math.round(v / p) * p;
  const W = snap(L.W),
    FH = snap(L.FH);
  const castle = b.roof === "castle";

  // 지붕
  if (!castle) {
    flatTop(ctx, b, L, T);
    // 지붕 타일 · 환풍기
    ctx.fillStyle = shade(b.top, 0.12);
    for (let x = p * 2; x < W - p * 3; x += p * 4) for (let y = -FH - L.TD + p * 2; y < -FH - p * 2; y += p * 3) ctx.fillRect(x, y, p * 2, p);
    ctx.fillStyle = "#9aa3b5";
    ctx.fillRect(snap(W * 0.72), snap(-FH - L.TD * 0.7), p * 4, p * 3);
    ctx.fillStyle = "#6b7387";
    ctx.fillRect(snap(W * 0.72), snap(-FH - L.TD * 0.7) + p * 2, p * 4, p);
  } else {
    ctx.fillStyle = b.top;
    ctx.fillRect(0, -FH - L.TD, W, L.TD);
    ctx.strokeStyle = OUT;
    ctx.strokeRect(0, -FH - L.TD, W, L.TD);
  }

  // 벽 + 벽돌
  ctx.fillStyle = b.wall;
  ctx.fillRect(0, -FH, W, FH);
  ctx.fillStyle = shade(b.wall, -0.18);
  for (let y = -FH + p * 3, row = 0; y < 0; y += p * 2, row++) {
    ctx.fillRect(0, y, W, Math.max(1, p / 2));
    for (let x = (row % 2) * p * 3; x < W; x += p * 6) ctx.fillRect(x, y, Math.max(1, p / 2), p * 2);
  }
  ctx.fillStyle = shade(b.wall, 0.12);
  for (let y = -FH + p * 3, row = 0; y < 0; y += p * 2, row++) for (let x = (row % 2) * p * 3 + p; x < W - p; x += p * 6) if (hash01(x, y) > 0.7) ctx.fillRect(x, y + p, p * 2, Math.max(1, p / 2));
  // 아래 받침 · 위 처마
  ctx.fillStyle = shade(b.wall, -0.35);
  ctx.fillRect(0, -p * 2, W, p * 2);
  ctx.fillStyle = shade(b.wall, 0.25);
  ctx.fillRect(0, -FH, W, p * 2);
  ctx.fillStyle = b.accent;
  ctx.fillRect(0, -FH + p * 2, W, p);

  // 창 (네모 · 안쪽 빛 · 왼쪽 위 반짝)
  const ws = snap(T * 0.78);
  for (const w of windowsOf(b, L, T, 2, Math.max(3, Math.round(b.w / 1.8)), ws, ws)) {
    const x = snap(w.x),
      y = snap(w.y);
    ctx.fillStyle = OUT;
    ctx.fillRect(x - p, y - p, ws + p * 2, ws + p * 2);
    ctx.fillStyle = shade(b.accent, -0.45);
    ctx.fillRect(x, y, ws, ws);
    ctx.fillStyle = alpha(b.accent, 0.55);
    ctx.fillRect(x, y + ws / 2, ws, ws / 2);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(x + p, y + p, p, p * 2);
    ctx.fillRect(x + p * 2, y + p, p, p);
    ctx.fillStyle = OUT;
    ctx.fillRect(x + ws / 2 - p / 2, y, p, ws);
  }

  // 문
  const D = L.door;
  const dx = snap(D.x),
    dy = snap(D.y),
    dw = snap(D.w);
  ctx.fillStyle = OUT;
  ctx.fillRect(dx - p, dy - p, dw + p * 2, -dy + p);
  ctx.fillStyle = "#1a1230";
  ctx.fillRect(dx, dy, dw, -dy);
  ctx.fillStyle = alpha(b.accent, 0.35);
  ctx.fillRect(dx, dy + (-dy) * 0.45, dw, (-dy) * 0.55);
  ctx.fillStyle = b.accent;
  ctx.fillRect(dx, dy, dw, p);
  ctx.fillRect(dx + dw / 2 - p / 2, dy + p, p, -dy - p);
  // 문 옆 불빛
  ctx.fillStyle = "#fff1a8";
  ctx.fillRect(dx - p * 3, dy + p * 2, p, p * 2);
  ctx.fillRect(dx + dw + p * 2, dy + p * 2, p, p * 2);

  if (castle) castleTop(ctx, b, L, T, p, W, FH);

  // 간판: 어두운 판 + 픽셀 테두리 + 픽셀 글자
  const S = L.sign;
  const sx = snap(S.x),
    sy = snap(S.y),
    sw = snap(S.w),
    sh = snap(S.h);
  ctx.fillStyle = OUT;
  ctx.fillRect(sx - p, sy - p, sw + p * 2, sh + p * 2);
  ctx.fillStyle = "#120c22";
  ctx.fillRect(sx, sy, sw, sh);
  ctx.fillStyle = b.accent;
  ctx.fillRect(sx, sy, sw, p);
  ctx.fillRect(sx, sy + sh - p, sw, p);
  for (let x = sx + p * 2; x < sx + sw - p; x += p * 3) {
    ctx.fillRect(x, sy - p * 2, p, p);
    ctx.fillRect(x, sy + sh + p, p, p);
  }
  const iconS = sh - p * 2;
  const hasIcon = !!icon;
  if (hasIcon) signIcon(ctx, icon, sx + p * 2, sy + p, iconS, false);
  const k = Math.max(2, Math.round(T / 17));
  const txt = pixelText(b.sign, "#ffffff", b.accent, sw - (hasIcon ? iconS + p * 5 : p * 4), k);
  ctx.imageSmoothingEnabled = false;
  const tx = hasIcon ? sx + iconS + p * 3 + (sw - iconS - p * 4 - txt.width) / 2 : sx + (sw - txt.width) / 2;
  ctx.drawImage(txt, Math.round(tx), Math.round(sy + (sh - txt.height) / 2));
  ctx.imageSmoothingEnabled = true;

  // 외곽선
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.5, p * 0.6);
  ctx.strokeRect(0, -FH, W, FH);

  // 파이트: 지붕 위 깃발 두 개
  if (b.id === "fight") {
    for (const fx of [p * 3, W - p * 4]) {
      ctx.fillStyle = "#3a2a2a";
      ctx.fillRect(fx, -FH - L.TD - p * 12, p, p * 12);
      ctx.fillStyle = b.accent;
      ctx.fillRect(fx + p, -FH - L.TD - p * 12, p * 5, p * 3);
      ctx.fillStyle = "#ff4d4d";
      ctx.fillRect(fx + p, -FH - L.TD - p * 9, p * 4, p * 2);
    }
  }
  // 리듬업: 양옆 스피커
  if (b.id === "rhythm") {
    for (const fx of [p * 2, W - p * 8]) {
      const fy = -FH + p * 5;
      ctx.fillStyle = OUT;
      ctx.fillRect(fx - p, fy - p, p * 8, p * 12);
      ctx.fillStyle = "#24183f";
      ctx.fillRect(fx, fy, p * 6, p * 10);
      ctx.fillStyle = "#5b4a8f";
      ctx.fillRect(fx + p * 2, fy + p, p * 2, p * 2);
      ctx.fillRect(fx + p, fy + p * 4, p * 4, p * 4);
      ctx.fillStyle = "#14102a";
      ctx.fillRect(fx + p * 2, fy + p * 5, p * 2, p * 2);
    }
  }
}

function castleTop(ctx: CanvasRenderingContext2D, b: Building, L: Layout, T: number, p: number, W: number, FH: number) {
  // 앞면 위 성가퀴
  const mw = p * 4;
  for (let x = 0; x < W; x += mw * 2) {
    ctx.fillStyle = shade(b.wall, 0.1);
    ctx.fillRect(x, -FH - p * 4, mw, p * 4);
    ctx.fillStyle = shade(b.wall, 0.3);
    ctx.fillRect(x, -FH - p * 4, mw, p);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = Math.max(1, p * 0.5);
    ctx.strokeRect(x, -FH - p * 4, mw, p * 4);
  }
  // 양쪽 탑 (더 높음) + 고깔 지붕 + 깃발
  const tw = p * 10,
    th = FH + p * 14;
  for (const tx of [-p * 2, W - tw + p * 2]) {
    ctx.fillStyle = shade(b.wall, -0.05);
    ctx.fillRect(tx, -th, tw, th);
    ctx.fillStyle = shade(b.wall, -0.22);
    for (let y = -th + p * 3; y < 0; y += p * 2) ctx.fillRect(tx, y, tw, Math.max(1, p / 2));
    ctx.fillStyle = OUT;
    ctx.fillRect(tx + tw / 2 - p, -th + p * 5, p * 2, p * 4);
    ctx.fillStyle = "#ffd36b";
    ctx.fillRect(tx + tw / 2 - p / 2, -th + p * 6, p, p * 2);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = Math.max(1.5, p * 0.6);
    ctx.strokeRect(tx, -th, tw, th);
    // 고깔 (계단식 픽셀 삼각형)
    const steps = 7;
    for (let s = 0; s < steps; s++) {
      const sw = tw + p * 2 - s * ((tw + p * 2) / steps);
      ctx.fillStyle = s % 2 ? "#2f7d4f" : "#3a9a5f";
      ctx.fillRect(tx - p + (tw + p * 2 - sw) / 2, -th - (s + 1) * p * 1.5, sw, p * 1.5);
    }
    ctx.fillStyle = "#3a2a2a";
    ctx.fillRect(tx + tw / 2 - p / 2, -th - steps * p * 1.5 - p * 6, p, p * 6);
    ctx.fillStyle = b.accent;
    ctx.fillRect(tx + tw / 2 + p / 2, -th - steps * p * 1.5 - p * 6, p * 4, p * 2);
  }
}

// ── 애니 ──

function animeBuilding(ctx: CanvasRenderingContext2D, b: Building, L: Layout, T: number, icon: Img) {
  const { W, FH } = L;
  flatTop(ctx, b, L, T);
  // 지붕 위 테라스 화분
  ctx.fillStyle = "#4d8a4b";
  for (let x = T * 0.6; x < W - T * 0.4; x += T * 1.4) {
    ctx.beginPath();
    ctx.arc(x, -FH - T * 0.28, T * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  // 벽: 위가 밝은 그라데이션 + 세로 판자 + 아래 걸레받이
  const g = ctx.createLinearGradient(0, -FH, 0, 0);
  g.addColorStop(0, shade(b.wall, 0.18));
  g.addColorStop(0.65, b.wall);
  g.addColorStop(1, shade(b.wall, -0.22));
  ctx.fillStyle = g;
  ctx.fillRect(0, -FH, W, FH);
  ctx.strokeStyle = alpha("#000000", 0.08);
  ctx.lineWidth = 1;
  for (let x = T * 0.5; x < W; x += T * 0.5) {
    ctx.beginPath();
    ctx.moveTo(x, -FH + T * 0.3);
    ctx.lineTo(x, -T * 0.35);
    ctx.stroke();
  }
  ctx.fillStyle = shade(b.wall, -0.4);
  ctx.fillRect(0, -T * 0.32, W, T * 0.32);
  ctx.fillStyle = shade(b.top, 0.35);
  ctx.fillRect(0, -FH, W, T * 0.2);

  // 아치 창 (따뜻한 불빛 · 십자 창살 · 반짝)
  const ww = T * 0.95,
    wh = T * 1.25;
  for (const w of windowsOf(b, L, T, 1, Math.max(2, Math.round(b.w / 2.2)), ww, wh)) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w.x, w.y + w.h);
    ctx.lineTo(w.x, w.y + w.w / 2);
    ctx.arc(w.x + w.w / 2, w.y + w.w / 2, w.w / 2, Math.PI, 0);
    ctx.lineTo(w.x + w.w, w.y + w.h);
    ctx.closePath();
    const wg = ctx.createLinearGradient(0, w.y, 0, w.y + w.h);
    wg.addColorStop(0, "#fff4c7");
    wg.addColorStop(1, "#ffb36b");
    ctx.fillStyle = wg;
    ctx.fill();
    ctx.lineWidth = T * 0.09;
    ctx.strokeStyle = "#fff8ef";
    ctx.stroke();
    ctx.lineWidth = T * 0.06;
    ctx.beginPath();
    ctx.moveTo(w.x + w.w / 2, w.y + T * 0.05);
    ctx.lineTo(w.x + w.w / 2, w.y + w.h);
    ctx.moveTo(w.x, w.y + w.h * 0.55);
    ctx.lineTo(w.x + w.w, w.y + w.h * 0.55);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(w.x + w.w * 0.28, w.y + w.h * 0.35, w.w * 0.08, w.h * 0.18, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 꽃 상자
    ctx.fillStyle = "#7a4a2e";
    rr(ctx, w.x - T * 0.1, w.y + w.h, w.w + T * 0.2, T * 0.18, T * 0.05);
    ctx.fill();
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = k % 2 ? "#ff7aa8" : "#ffe06b";
      ctx.beginPath();
      ctx.arc(w.x + (k + 0.5) * (w.w / 4), w.y + w.h - T * 0.02, T * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 문 (둥근 위 · 유리 · 손잡이)
  const D = L.door;
  ctx.fillStyle = shade(b.wall, -0.55);
  rr(ctx, D.x - T * 0.12, D.y - T * 0.12, D.w + T * 0.24, -D.y + T * 0.12, T * 0.35);
  ctx.fill();
  const dg = ctx.createLinearGradient(0, D.y, 0, 0);
  dg.addColorStop(0, "#ffe7b0");
  dg.addColorStop(1, "#d9885a");
  ctx.fillStyle = dg;
  rr(ctx, D.x, D.y, D.w, -D.y, T * 0.3);
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.5, T * 0.035);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(D.x + D.w / 2, D.y + T * 0.1);
  ctx.lineTo(D.x + D.w / 2, 0);
  ctx.stroke();

  // 줄무늬 차양 (문 위 가로 전체) · 물결 끝
  const ay = D.y - T * 0.5,
    ah = T * 0.55;
  const stripe = T * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-T * 0.15, ay);
  ctx.lineTo(W + T * 0.15, ay);
  ctx.lineTo(W + T * 0.3, ay + ah);
  for (let x = W + T * 0.3; x > -T * 0.3; x -= stripe) ctx.arc(x - stripe / 2, ay + ah, stripe / 2, 0, Math.PI);
  ctx.closePath();
  ctx.clip();
  for (let x = -T * 0.4, k = 0; x < W + T * 0.4; x += stripe, k++) {
    ctx.fillStyle = k % 2 ? "#fffaf0" : b.accent === "#FFD36B" ? "#C4233F" : b.accent;
    ctx.fillRect(x, ay, stripe, ah + stripe);
  }
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(-T, ay + ah * 0.65, W + T * 2, ah);
  ctx.restore();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.5, T * 0.035);
  ctx.beginPath();
  ctx.moveTo(-T * 0.15, ay);
  ctx.lineTo(W + T * 0.15, ay);
  ctx.stroke();
  // 차양 그림자
  ctx.fillStyle = "rgba(40,10,30,0.18)";
  ctx.fillRect(0, ay + ah + stripe / 2, W, T * 0.25);

  // 간판: 둥근 판 + 전구 자리(불은 움직이는 장식에서) + 글자
  const S = L.sign;
  const pg = ctx.createLinearGradient(0, S.y, 0, S.y + S.h);
  pg.addColorStop(0, shade(b.accent === "#FFD36B" ? "#7A1F3A" : "#FF5C8A", 0.1));
  pg.addColorStop(1, shade(b.accent === "#FFD36B" ? "#7A1F3A" : "#FF5C8A", -0.25));
  ctx.fillStyle = pg;
  rr(ctx, S.x, S.y, S.w, S.h, S.h * 0.5);
  ctx.fill();
  ctx.lineWidth = T * 0.08;
  ctx.strokeStyle = b.accent;
  ctx.stroke();
  ctx.lineWidth = Math.max(1.5, T * 0.035);
  ctx.strokeStyle = OUT;
  rr(ctx, S.x - T * 0.04, S.y - T * 0.04, S.w + T * 0.08, S.h + T * 0.08, S.h * 0.55);
  ctx.stroke();
  const iconS = S.h * 0.78;
  if (icon) signIcon(ctx, icon, S.x + S.h * 0.35, S.y + (S.h - iconS) / 2, iconS);
  const left = icon ? S.x + S.h * 0.35 + iconS + T * 0.15 : S.x + T * 0.3;
  const right = S.x + S.w - S.h * 0.4;
  const px = fitFont(ctx, b.sign, FONT_TITLE, "400", right - left, S.h * 0.62);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.lineWidth = px * 0.18;
  ctx.strokeStyle = "rgba(40,8,20,0.9)";
  ctx.strokeText(b.sign, (left + right) / 2, S.y + S.h * 0.54);
  ctx.fillStyle = "#fff7e0";
  ctx.fillText(b.sign, (left + right) / 2, S.y + S.h * 0.54);
  ctx.textAlign = "left";

  // 포커: 카드 무늬 · 올인러브: 하트
  ctx.font = `700 ${T * 0.55}px ${FONT_UI}`;
  ctx.textBaseline = "middle";
  if (b.id === "poker") {
    const suits = ["♠", "♥", "♦", "♣"];
    suits.forEach((s, i) => {
      ctx.fillStyle = i % 3 === 0 ? "#1b1b2a" : "#e0243c";
      ctx.fillText(s, i < 2 ? T * 0.25 + i * T * 0.6 : W - T * 1.45 + (i - 2) * T * 0.6, S.y + S.h * 0.5);
    });
  }
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.5, T * 0.035);
  ctx.strokeRect(0, -FH, W, FH);
}

// ── 증권거래소 (네온) ──

/** 전광판 자리 (움직이는 장식이 씀) */
export function tickerRect(L: Layout, T: number) {
  return { x: T * 0.7, y: L.sign.y + L.sign.h + T * 0.18, w: L.W - T * 1.4, h: T * 0.5 };
}

function neonBuilding(ctx: CanvasRenderingContext2D, b: Building, L: Layout, T: number, icon: Img) {
  const { W, FH } = L;
  flatTop(ctx, b, L, T);
  // 돔 (지붕 가운데) + 깃대
  const dcx = W / 2,
    dcy = -FH - L.TD * 0.45,
    drx = T * 2.4,
    dry = T * 2.0;
  ctx.fillStyle = shade(b.top, 0.2);
  ctx.fillRect(dcx - drx - T * 0.2, dcy - T * 0.25, drx * 2 + T * 0.4, T * 0.4);
  const dg = ctx.createLinearGradient(dcx - drx, 0, dcx + drx, 0);
  dg.addColorStop(0, "#2a7f8f");
  dg.addColorStop(0.35, "#6fe2e8");
  dg.addColorStop(1, "#1d4f63");
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.ellipse(dcx, dcy - T * 0.25, drx, dry, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  for (let k = 1; k < 6; k++) {
    ctx.beginPath();
    ctx.ellipse(dcx, dcy - T * 0.25, drx * (k / 6), dry, 0, Math.PI, 0);
    ctx.stroke();
  }
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.5, T * 0.035);
  ctx.beginPath();
  ctx.ellipse(dcx, dcy - T * 0.25, drx, dry, 0, Math.PI, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = "#c9d6e3";
  ctx.fillRect(dcx - T * 0.04, dcy - dry - T * 1.3, T * 0.08, T * 1.1);

  // 앞면: 어두운 유리 + 격자
  const gg = ctx.createLinearGradient(0, -FH, 0, 0);
  gg.addColorStop(0, "#22305a");
  gg.addColorStop(1, "#0f1730");
  ctx.fillStyle = gg;
  ctx.fillRect(0, -FH, W, FH);
  ctx.strokeStyle = alpha(b.accent, 0.22);
  ctx.lineWidth = 1;
  for (let x = T * 0.5; x < W; x += T * 0.5) {
    ctx.beginPath();
    ctx.moveTo(x, -FH + T * 1.2);
    ctx.lineTo(x, 0);
    ctx.stroke();
  }
  for (let y = -FH + T * 1.6; y < 0; y += T * 0.45) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  // 유리 반사
  ctx.fillStyle = "rgba(160,220,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(W * 0.1, 0);
  ctx.lineTo(W * 0.3, -FH);
  ctx.lineTo(W * 0.42, -FH);
  ctx.lineTo(W * 0.22, 0);
  ctx.fill();

  // 위 처마 (돌) · 간판 띠
  ctx.fillStyle = "#e9e4d8";
  ctx.fillRect(-T * 0.2, -FH - T * 0.1, W + T * 0.4, T * 0.35);
  ctx.fillStyle = "#cfc8b8";
  ctx.fillRect(-T * 0.2, -FH + T * 0.22, W + T * 0.4, T * 0.1);

  // 기둥 6개 (밝은 돌 · 홈)
  const cols = 6,
    cwid = T * 0.55,
    ctop = -FH + T * 1.75;
  for (let k = 0; k < cols; k++) {
    const x = T * 0.45 + (k / (cols - 1)) * (W - T * 0.9) - cwid / 2;
    if (x + cwid > L.door.x - T * 0.1 && x < L.door.x + L.door.w + T * 0.1) continue;
    const cg = ctx.createLinearGradient(x, 0, x + cwid, 0);
    cg.addColorStop(0, "#cfc8b8");
    cg.addColorStop(0.4, "#fbf7ee");
    cg.addColorStop(1, "#b9b2a2");
    ctx.fillStyle = cg;
    ctx.fillRect(x, ctop, cwid, -ctop - T * 0.5);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let f = 1; f < 4; f++) ctx.fillRect(x + (cwid * f) / 4, ctop + T * 0.15, 1, -ctop - T * 0.8);
    ctx.fillStyle = "#e9e4d8";
    ctx.fillRect(x - T * 0.08, ctop - T * 0.12, cwid + T * 0.16, T * 0.14);
    ctx.fillRect(x - T * 0.08, -T * 0.62, cwid + T * 0.16, T * 0.14);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, ctop, cwid, -ctop - T * 0.5);
  }
  // 계단 3단
  for (let s = 0; s < 3; s++) {
    ctx.fillStyle = s % 2 ? "#ddd6c6" : "#ece6d8";
    ctx.fillRect(-T * 0.1 - s * T * 0.12, -T * 0.5 + s * T * 0.17, W + T * 0.2 + s * T * 0.24, T * 0.17);
  }
  // 문: 유리 회전문
  const D = L.door;
  ctx.fillStyle = "#0b1226";
  ctx.fillRect(D.x, D.y - T * 0.5, D.w, -D.y);
  ctx.fillStyle = alpha(b.accent, 0.35);
  ctx.fillRect(D.x + T * 0.08, D.y - T * 0.42, D.w - T * 0.16, -D.y - T * 0.16);
  ctx.strokeStyle = b.accent;
  ctx.lineWidth = T * 0.05;
  ctx.strokeRect(D.x, D.y - T * 0.5, D.w, -D.y);
  ctx.beginPath();
  ctx.moveTo(D.x + D.w / 2, D.y - T * 0.5);
  ctx.lineTo(D.x + D.w / 2, -T * 0.5);
  ctx.stroke();

  // 간판: 금색 글자 (처마 위 판)
  const S = L.sign;
  ctx.fillStyle = "#0e1530";
  rr(ctx, S.x, S.y, S.w, S.h, T * 0.12);
  ctx.fill();
  ctx.strokeStyle = "#F2C14E";
  ctx.lineWidth = T * 0.05;
  ctx.stroke();
  const iconS = S.h * 0.8;
  if (icon) signIcon(ctx, icon, S.x + T * 0.2, S.y + (S.h - iconS) / 2, iconS);
  const left = icon ? S.x + T * 0.3 + iconS : S.x + T * 0.3;
  const px = fitFont(ctx, b.sign, FONT_TITLE, "400", S.x + S.w - T * 0.3 - left, S.h * 0.7);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const tg = ctx.createLinearGradient(0, S.y, 0, S.y + S.h);
  tg.addColorStop(0, "#FFE7A0");
  tg.addColorStop(1, "#E0A42E");
  ctx.fillStyle = tg;
  ctx.shadowColor = "rgba(242,193,78,0.7)";
  ctx.shadowBlur = T * 0.25;
  ctx.fillText(b.sign, (left + S.x + S.w - T * 0.3) / 2, S.y + S.h * 0.55);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
  void px;
  // 전광판 틀 (글자는 움직이는 장식)
  const tk = tickerRect(L, T);
  ctx.fillStyle = "#05070f";
  ctx.fillRect(tk.x, tk.y, tk.w, tk.h);
  ctx.strokeStyle = "#3a4a7a";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(tk.x, tk.y, tk.w, tk.h);

  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.5, T * 0.035);
  ctx.strokeRect(0, -FH, W, FH);
}

// ── 누아르 ──

function noirBuilding(ctx: CanvasRenderingContext2D, b: Building, L: Layout, T: number, icon: Img) {
  const { W, FH } = L;
  flatTop(ctx, b, L, T);
  // 물탱크
  ctx.fillStyle = "#5a4a3e";
  ctx.fillRect(W * 0.68, -FH - L.TD * 0.85 - T * 0.9, T * 0.9, T * 0.9);
  ctx.fillStyle = "#3d322a";
  ctx.beginPath();
  ctx.moveTo(W * 0.68 - T * 0.1, -FH - L.TD * 0.85 - T * 0.9);
  ctx.lineTo(W * 0.68 + T * 0.45, -FH - L.TD * 0.85 - T * 1.3);
  ctx.lineTo(W * 0.68 + T, -FH - L.TD * 0.85 - T * 0.9);
  ctx.fill();
  // 벽돌 (벽 네모 안으로 잘라서 — 어긋난 줄이 옆으로 삐져나오지 않게)
  ctx.fillStyle = b.wall;
  ctx.fillRect(0, -FH, W, FH);
  const bh = T * 0.22,
    bw = T * 0.55;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, -FH, W, FH);
  ctx.clip();
  for (let y = -FH, row = 0; y < 0; y += bh, row++)
    for (let x = row % 2 ? -bw / 2 : 0; x < W; x += bw) {
      const v = hash01(x * 3, y * 7);
      ctx.fillStyle = v > 0.6 ? "#3a302b" : v > 0.3 ? "#332a26" : "#2d2522";
      ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  ctx.restore();
  // 연기 낀 아래쪽
  const fog = ctx.createLinearGradient(0, -FH * 0.35, 0, 0);
  fog.addColorStop(0, "rgba(0,0,0,0)");
  fog.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = fog;
  ctx.fillRect(0, -FH * 0.35, W, FH * 0.35);
  // 블라인드 창 (노란 불빛 새어 나옴)
  const ww = T * 1.0,
    wh = T * 1.15;
  for (const w of windowsOf(b, L, T, 1, Math.max(3, Math.round(b.w / 2.2)), ww, wh)) {
    ctx.fillStyle = "#151010";
    ctx.fillRect(w.x - T * 0.08, w.y - T * 0.08, w.w + T * 0.16, w.h + T * 0.16);
    const lg = ctx.createLinearGradient(0, w.y, 0, w.y + w.h);
    lg.addColorStop(0, "#ffd98a");
    lg.addColorStop(1, "#c98a3a");
    ctx.fillStyle = lg;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = "rgba(30,20,10,0.75)";
    for (let y = w.y + T * 0.06; y < w.y + w.h; y += T * 0.14) ctx.fillRect(w.x, y, w.w, T * 0.07);
    ctx.fillStyle = "#6b5a4a";
    ctx.fillRect(w.x - T * 0.12, w.y + w.h + T * 0.04, w.w + T * 0.24, T * 0.1);
  }
  // 문: 반투명 유리 + DETECTIVE
  const D = L.door;
  ctx.fillStyle = "#1a1412";
  ctx.fillRect(D.x - T * 0.1, D.y - T * 0.1, D.w + T * 0.2, -D.y + T * 0.1);
  ctx.fillStyle = "#4a3a30";
  ctx.fillRect(D.x, D.y, D.w, -D.y);
  ctx.fillStyle = "rgba(230,220,190,0.55)";
  ctx.fillRect(D.x + T * 0.12, D.y + T * 0.12, D.w - T * 0.24, -D.y * 0.45);
  ctx.font = `700 ${T * 0.17}px ${FONT_UI}`;
  ctx.fillStyle = "#2a1e16";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("DETECTIVE", D.x + D.w / 2, D.y + T * 0.12 + (-D.y * 0.45) / 2);
  ctx.fillStyle = "#c9a24a";
  ctx.beginPath();
  ctx.arc(D.x + D.w - T * 0.22, D.y * 0.42, T * 0.06, 0, Math.PI * 2);
  ctx.fill();
  // 간판: 검은 판 · 호박색 글자 · 돋보기
  const S = L.sign;
  ctx.fillStyle = "#0c0a09";
  rr(ctx, S.x, S.y, S.w, S.h, T * 0.06);
  ctx.fill();
  ctx.strokeStyle = "#5a4a3a";
  ctx.lineWidth = T * 0.06;
  ctx.stroke();
  const iconS = S.h * 0.78;
  if (icon) signIcon(ctx, icon, S.x + T * 0.2, S.y + (S.h - iconS) / 2, iconS);
  const left = icon ? S.x + T * 0.3 + iconS : S.x + T * 0.3;
  fitFont(ctx, b.sign, FONT_TITLE, "400", S.x + S.w - T * 0.3 - left, S.h * 0.62);
  ctx.fillStyle = b.accent;
  ctx.shadowColor = alpha(b.accent, 0.8);
  ctx.shadowBlur = T * 0.2;
  ctx.fillText(b.sign, (left + S.x + S.w - T * 0.3) / 2, S.y + S.h * 0.55);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
  // 노란 테이프 (문 옆 대각선)
  ctx.save();
  ctx.translate(D.x + D.w + T * 0.9, -T * 0.9);
  ctx.rotate(-0.25);
  ctx.fillStyle = "#f2c94c";
  ctx.fillRect(-T * 0.7, -T * 0.09, T * 1.4, T * 0.18);
  ctx.fillStyle = "#1a1a1a";
  for (let x = -T * 0.65; x < T * 0.7; x += T * 0.25) ctx.fillRect(x, -T * 0.09, T * 0.1, T * 0.18);
  ctx.restore();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.5, T * 0.035);
  ctx.strokeRect(0, -FH, W, FH);
}

// ── 우리 집 (박공지붕) ──

function homeBuilding(ctx: CanvasRenderingContext2D, b: Building, L: Layout, T: number) {
  const { W, FH } = L;
  // 벽 (크림) + 나무 기둥 · 보
  const wg = ctx.createLinearGradient(0, -FH, 0, 0);
  wg.addColorStop(0, shade(b.wall, 0.15));
  wg.addColorStop(1, shade(b.wall, -0.12));
  ctx.fillStyle = wg;
  ctx.fillRect(0, -FH, W, FH);
  ctx.fillStyle = "#8a5a3a";
  for (const x of [0, W / 3 - T * 0.08, (W * 2) / 3 - T * 0.08, W - T * 0.16]) ctx.fillRect(x, -FH, T * 0.16, FH);
  ctx.fillRect(0, -FH * 0.5, W, T * 0.14);
  ctx.fillStyle = "#6d4a35";
  ctx.fillRect(0, -T * 0.3, W, T * 0.3);

  // 창 (네모 · 덧문 · 꽃 상자)
  for (const cx of [W * 0.17, W * 0.83]) {
    const ww = T * 1.0,
      wh = T * 0.9,
      x = cx - ww / 2,
      y = -FH * 0.42;
    ctx.fillStyle = "#6d4a35";
    ctx.fillRect(x - T * 0.36, y - T * 0.05, T * 0.3, wh + T * 0.1);
    ctx.fillRect(x + ww + T * 0.06, y - T * 0.05, T * 0.3, wh + T * 0.1);
    const lg = ctx.createLinearGradient(0, y, 0, y + wh);
    lg.addColorStop(0, "#fff4c7");
    lg.addColorStop(1, "#ffc27a");
    ctx.fillStyle = lg;
    ctx.fillRect(x, y, ww, wh);
    ctx.strokeStyle = "#fffaf2";
    ctx.lineWidth = T * 0.07;
    ctx.strokeRect(x, y, ww, wh);
    ctx.beginPath();
    ctx.moveTo(x + ww / 2, y);
    ctx.lineTo(x + ww / 2, y + wh);
    ctx.moveTo(x, y + wh / 2);
    ctx.lineTo(x + ww, y + wh / 2);
    ctx.stroke();
    ctx.fillStyle = "#7a4a2e";
    ctx.fillRect(x - T * 0.1, y + wh, ww + T * 0.2, T * 0.2);
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = ["#ff7aa8", "#ffe06b", "#9ad0ff"][k % 3];
      ctx.beginPath();
      ctx.arc(x + (k + 0.5) * ((ww + T * 0.1) / 5), y + wh, T * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 문 (나무 · 둥근 위) + 등
  const D = L.door;
  ctx.fillStyle = "#6d4a35";
  rr(ctx, D.x - T * 0.1, D.y - T * 0.1, D.w + T * 0.2, -D.y + T * 0.1, T * 0.5);
  ctx.fill();
  const dg = ctx.createLinearGradient(D.x, 0, D.x + D.w, 0);
  dg.addColorStop(0, "#b77a4a");
  dg.addColorStop(1, "#8f5a34");
  ctx.fillStyle = dg;
  rr(ctx, D.x, D.y, D.w, -D.y, T * 0.42);
  ctx.fill();
  ctx.strokeStyle = "rgba(60,30,10,0.45)";
  ctx.lineWidth = 1.2;
  for (let x = D.x + D.w / 4; x < D.x + D.w; x += D.w / 4) {
    ctx.beginPath();
    ctx.moveTo(x, D.y + T * 0.25);
    ctx.lineTo(x, 0);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffd36b";
  ctx.beginPath();
  ctx.arc(D.x + D.w * 0.8, D.y * 0.45, T * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(D.x - T * 0.42, D.y + T * 0.05, T * 0.05, T * 0.25);
  ctx.fillStyle = "#ffe9a8";
  rr(ctx, D.x - T * 0.52, D.y + T * 0.28, T * 0.24, T * 0.3, T * 0.06);
  ctx.fill();

  // 지붕 앞 경사면: 앞벽 위 → 용마루 (깊이 절반 + 높이 1.6칸). 벽 다음에 그려서 처마가 벽 위를 덮게
  const ridgeRise = (b.d / 2) * Y_SCALE * T + 1.6 * Z_SCALE * T;
  const eave = T * 0.35;
  ctx.fillStyle = shade(b.top, -0.2);
  ctx.fillRect(-eave, -FH - ridgeRise - T * 0.3, W + eave * 2, T * 0.3);
  const rg = ctx.createLinearGradient(0, -FH - ridgeRise, 0, -FH);
  rg.addColorStop(0, shade(b.top, 0.15));
  rg.addColorStop(1, shade(b.top, -0.1));
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.moveTo(-eave, -FH + T * 0.15);
  ctx.lineTo(W + eave, -FH + T * 0.15);
  ctx.lineTo(W + eave * 0.5, -FH - ridgeRise);
  ctx.lineTo(-eave * 0.5, -FH - ridgeRise);
  ctx.closePath();
  ctx.fill();
  // 기와 줄
  ctx.strokeStyle = "rgba(80,20,10,0.35)";
  ctx.lineWidth = 1.2;
  for (let k = 1; k < 7; k++) {
    const y = -FH + T * 0.15 - (ridgeRise + T * 0.15) * (k / 7);
    ctx.beginPath();
    ctx.moveTo(-eave, y);
    ctx.lineTo(W + eave, y);
    ctx.stroke();
  }
  for (let x = 0; x < W; x += T * 0.4) {
    ctx.beginPath();
    ctx.moveTo(x, -FH + T * 0.15);
    ctx.lineTo(x + T * 0.05, -FH - ridgeRise);
    ctx.stroke();
  }
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.5, T * 0.035);
  ctx.beginPath();
  ctx.moveTo(-eave, -FH + T * 0.15);
  ctx.lineTo(W + eave, -FH + T * 0.15);
  ctx.lineTo(W + eave * 0.5, -FH - ridgeRise);
  ctx.lineTo(-eave * 0.5, -FH - ridgeRise);
  ctx.closePath();
  ctx.stroke();
  // 굴뚝
  ctx.fillStyle = "#8a6a5a";
  ctx.fillRect(W * 0.74, -FH - ridgeRise - T * 0.5, T * 0.55, ridgeRise * 0.6 + T * 0.5);
  ctx.fillStyle = "#6e5246";
  ctx.fillRect(W * 0.74 - T * 0.06, -FH - ridgeRise - T * 0.6, T * 0.67, T * 0.16);
  ctx.strokeStyle = OUT;
  ctx.strokeRect(W * 0.74, -FH - ridgeRise - T * 0.5, T * 0.55, ridgeRise * 0.6 + T * 0.5);

  // 처마 그림자 (벽 윗부분)
  ctx.fillStyle = "rgba(60,25,10,0.22)";
  ctx.fillRect(0, -FH + T * 0.15, W, T * 0.28);
  // 간판: 처마 아래 매달린 나무판
  const S = L.sign;
  const sw = Math.min(S.w, T * 3.6),
    sx = W / 2 - sw / 2;
  ctx.strokeStyle = "#4a3020";
  ctx.lineWidth = T * 0.05;
  ctx.beginPath();
  ctx.moveTo(sx + T * 0.4, S.y - T * 0.35);
  ctx.lineTo(sx + T * 0.4, S.y);
  ctx.moveTo(sx + sw - T * 0.4, S.y - T * 0.35);
  ctx.lineTo(sx + sw - T * 0.4, S.y);
  ctx.stroke();
  const pg = ctx.createLinearGradient(0, S.y, 0, S.y + S.h);
  pg.addColorStop(0, "#c98a52");
  pg.addColorStop(1, "#9a6236");
  ctx.fillStyle = pg;
  rr(ctx, sx, S.y, sw, S.h, T * 0.15);
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.5, T * 0.035);
  ctx.stroke();
  fitFont(ctx, `🏠 ${b.sign}`, FONT_TITLE, "400", sw - T * 0.4, S.h * 0.62);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff6e6";
  ctx.fillText(`🏠 ${b.sign}`, W / 2, S.y + S.h * 0.55);
  ctx.textAlign = "left";
  ctx.strokeStyle = OUT;
  ctx.strokeRect(0, -FH, W, FH);
}

// ───────────── 움직이는 장식 (건물 위) ─────────────

const TICKER = "주식게임 지수 ▲1.25%   가상전자 ▲2.10%   모의바이오 ▼0.84%   차트코인 ▲5.73%   턴제건설 ▼1.12%   대전엔터 ▲0.96%   캔들화학 ▲3.40%   ";

/** (ax, ay) = 건물 앞면 왼쪽 아래의 화면 위치 */
export function drawBuildingFx(ctx: CanvasRenderingContext2D, b: Building, ax: number, ay: number, T: number, t: number) {
  const L = layoutOf(b, T);
  ctx.save();
  ctx.translate(ax, ay);
  if (b.id === "stock") {
    const r = tickerRect(L, T);
    ctx.beginPath();
    ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.clip();
    ctx.font = `700 ${r.h * 0.68}px ${FONT_UI}`;
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(TICKER).width;
    const off = (t * T * 1.6) % tw;
    for (let x = r.x - off; x < r.x + r.w; x += tw) {
      let cx = x;
      for (const part of TICKER.split(/(▲[\d.]+%|▼[\d.]+%)/)) {
        if (!part) continue;
        ctx.fillStyle = part.startsWith("▲") ? "#FF5C66" : part.startsWith("▼") ? "#4D8DFF" : "#E8ECF4";
        ctx.fillText(part, cx, r.y + r.h / 2);
        cx += ctx.measureText(part).width;
      }
    }
    ctx.restore();
    ctx.save();
    ctx.translate(ax, ay);
    // 돔 꼭대기 빨간 불 (깜빡)
    if (Math.sin(t * 3) > 0) {
      ctx.fillStyle = "#ff4d4d";
      ctx.shadowColor = "#ff4d4d";
      ctx.shadowBlur = T * 0.4;
      ctx.beginPath();
      ctx.arc(L.W / 2, -L.FH - L.TD * 0.45 - T * 2.25 - T * 1.3, T * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (b.id === "rhythm") {
    // 간판 양옆 이퀄라이저 (픽셀 막대)
    const p = Math.max(2, Math.round(T / 10));
    const S = L.sign;
    const bars = 5;
    for (const side of [-1, 1]) {
      for (let k = 0; k < bars; k++) {
        const hgt = Math.round((0.35 + 0.65 * Math.abs(Math.sin(t * (4 + k * 1.3) + k * 2 + side))) * 6) * p;
        const x = side < 0 ? S.x - p * 3 - (k + 1) * p * 2 : S.x + S.w + p * 2 + k * p * 2;
        const y = S.y + S.h - hgt;
        ctx.fillStyle = k % 2 ? "#FF4FD8" : "#3DE0FF";
        ctx.fillRect(Math.round(x / p) * p, Math.round(y / p) * p, p, hgt);
      }
    }
    // 위로 떠오르는 음표
    ctx.font = `700 ${T * 0.42}px ${FONT_UI}`;
    for (let k = 0; k < 3; k++) {
      const ph = (t * 0.35 + k / 3) % 1;
      ctx.globalAlpha = Math.sin(ph * Math.PI);
      ctx.fillStyle = k % 2 ? "#FF4FD8" : "#3DE0FF";
      ctx.fillText(k % 2 ? "♪" : "♫", L.W * (0.2 + k * 0.3), -L.FH - L.TD - ph * T * 1.6);
    }
    ctx.globalAlpha = 1;
  } else if (b.id === "poker" || b.id === "love") {
    // 간판 둘레 전구 (차례로 반짝)
    const S = L.sign;
    const n = Math.max(10, Math.round(S.w / (T * 0.38)));
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const x = S.x + S.h * 0.3 + u * (S.w - S.h * 0.6);
      for (const y of [S.y - T * 0.02, S.y + S.h + T * 0.02]) {
        const on = (Math.floor(t * 6) + k + (y > S.y ? 1 : 0)) % 3 === 0;
        ctx.fillStyle = on ? "#fff6c2" : "rgba(255,220,140,0.45)";
        if (on) {
          ctx.shadowColor = "#ffd36b";
          ctx.shadowBlur = T * 0.18;
        }
        ctx.beginPath();
        ctx.arc(x, y, T * 0.055, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    if (b.id === "love") {
      const s = 1 + Math.sin(t * 4) * 0.08;
      ctx.font = `700 ${T * 0.7 * s}px ${FONT_UI}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ff3d7f";
      ctx.shadowColor = "#ff7aa8";
      ctx.shadowBlur = T * 0.3;
      ctx.fillText("♥", L.W - T * 0.6, S.y - T * 0.35);
      ctx.shadowBlur = 0;
    }
  } else if (b.id === "fight") {
    // 가끔 번쩍 (번개)
    const ph = t % 4.2;
    if (ph < 0.18 || (ph > 0.3 && ph < 0.4)) {
      ctx.fillStyle = "rgba(255,240,160,0.22)";
      ctx.fillRect(0, -L.FH, L.W, L.FH);
    }
  } else if (b.id === "defense") {
    // 탑 창문 불빛 깜빡
    const p = Math.max(2, Math.round(T / 10));
    ctx.fillStyle = Math.sin(t * 7) > -0.3 ? "rgba(255,200,90,0.9)" : "rgba(255,160,60,0.6)";
    const th = Math.round(L.FH / p) * p + p * 14;
    ctx.fillRect(-p * 2 + p * 5 - p / 2, -th + p * 6, p, p * 2);
    ctx.fillRect(Math.round(L.W / p) * p - p * 10 + p * 2 + p * 5 - p / 2, -th + p * 6, p, p * 2);
  } else if (b.id === "suspect") {
    // 벽등 불빛 (가끔 깜빡)
    const flick = t % 6 > 5.6 && Math.sin(t * 40) > 0 ? 0.25 : 1;
    const lx = L.door.x - T * 0.5,
      ly = L.door.y - T * 0.15;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly + T * 0.6, T * 1.4);
    g.addColorStop(0, `rgba(255,214,140,${0.45 * flick})`);
    g.addColorStop(1, "rgba(255,214,140,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(lx - T * 0.1, ly);
    ctx.lineTo(lx + T * 0.1, ly);
    ctx.lineTo(lx + T * 0.8, -T * 0.05);
    ctx.lineTo(lx - T * 0.8, -T * 0.05);
    ctx.fill();
    ctx.fillStyle = `rgba(255,230,170,${flick})`;
    ctx.beginPath();
    ctx.arc(lx, ly, T * 0.08, 0, Math.PI * 2);
    ctx.fill();
  } else if (b.id === "home") {
    // 굴뚝 연기
    const ridgeRise = (b.d / 2) * Y_SCALE * T + 1.6 * Z_SCALE * T;
    for (let k = 0; k < 4; k++) {
      const ph = (t * 0.25 + k / 4) % 1;
      ctx.fillStyle = `rgba(240,240,245,${0.45 * (1 - ph)})`;
      ctx.beginPath();
      ctx.arc(L.W * 0.74 + T * 0.28 + Math.sin(ph * 6 + k) * T * 0.2 + ph * T * 0.6, -L.FH - ridgeRise - T * 0.7 - ph * T * 1.6, T * (0.15 + ph * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ───────────── 장식 ─────────────

/** 나무 (sx, sy = 밑동 화면 위치) */
export function drawTree(ctx: CanvasRenderingContext2D, tr: Tree, sx: number, sy: number, T: number, t: number) {
  const s = tr.s * T;
  const sway = Math.sin(t * 1.2 + tr.x) * s * 0.02;
  // 줄기
  ctx.fillStyle = "#7a5436";
  ctx.fillRect(sx - s * 0.09, sy - s * 0.9, s * 0.18, s * 0.9);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1, T * 0.03);
  ctx.strokeRect(sx - s * 0.09, sy - s * 0.9, s * 0.18, s * 0.9);
  if (tr.kind === "pine") {
    for (let k = 0; k < 3; k++) {
      const w = s * (0.95 - k * 0.22),
        y = sy - s * (0.7 + k * 0.55);
      ctx.fillStyle = k % 2 ? "#2f7a4a" : "#3a8f55";
      ctx.beginPath();
      ctx.moveTo(sx - w + sway, y);
      ctx.lineTo(sx + w + sway, y);
      ctx.lineTo(sx + sway * 2, y - s * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.moveTo(sx - w * 0.6 + sway, y - s * 0.05);
      ctx.lineTo(sx - w * 0.1 + sway, y - s * 0.05);
      ctx.lineTo(sx + sway * 2 - s * 0.05, y - s * 0.7);
      ctx.fill();
    }
    return;
  }
  const blossom = tr.kind === "blossom";
  const c1 = blossom ? "#f7a9c4" : "#4fa35a",
    c2 = blossom ? "#ffd1e0" : "#6cc06c",
    c3 = blossom ? "#e27fa3" : "#3b8a49";
  const blobs: [number, number, number, string][] = [
    [-0.42, -1.25, 0.55, c3],
    [0.42, -1.25, 0.55, c3],
    [0, -1.55, 0.68, c1],
    [-0.3, -1.05, 0.5, c1],
    [0.32, -1.05, 0.5, c1],
    [-0.12, -1.75, 0.38, c2],
  ];
  // 외곽선: 덩어리마다 굵게 그은 뒤 그 위에 색을 채우면 바깥 테두리만 남음
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(2, T * 0.06);
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(sx + bx * s + sway * (1 - by), sy + by * s, br * s, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const [bx, by, br, col] of blobs) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(sx + bx * s + sway * (1 - by), sy + by * s, br * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // 위쪽 밝은 면
  ctx.fillStyle = blossom ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.arc(sx - 0.2 * s + sway * 2.5, sy - 1.78 * s, 0.26 * s, 0, Math.PI * 2);
  ctx.fill();
  if (blossom) {
    ctx.fillStyle = "#fff";
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.arc(sx + (hash01(k, tr.x * 9) - 0.5) * s * 1.4, sy - s * (1.0 + hash01(tr.y * 9, k) * 0.9), s * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawLamp(ctx: CanvasRenderingContext2D, sx: number, sy: number, T: number) {
  const h = 2.5 * Z_SCALE * T;
  ctx.fillStyle = "#2f3b4a";
  ctx.fillRect(sx - T * 0.05, sy - h, T * 0.1, h);
  ctx.fillRect(sx - T * 0.13, sy - T * 0.12, T * 0.26, T * 0.12);
  ctx.fillStyle = "#3a4a5c";
  rr(ctx, sx - T * 0.16, sy - h - T * 0.36, T * 0.32, T * 0.38, T * 0.06);
  ctx.fill();
  ctx.fillStyle = "#fff1b8";
  ctx.fillRect(sx - T * 0.1, sy - h - T * 0.3, T * 0.2, T * 0.26);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1;
  ctx.strokeRect(sx - T * 0.16, sy - h - T * 0.36, T * 0.32, T * 0.38);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  drawLampGlow(ctx, sx, sy, T);
  ctx.restore();
}

/** 가로등 불빛 (모든 것 위에 더해서) */
export function drawLampGlow(ctx: CanvasRenderingContext2D, sx: number, sy: number, T: number) {
  const h = 2.5 * Z_SCALE * T;
  const g = ctx.createRadialGradient(sx, sy - h - T * 0.17, 0, sx, sy - h - T * 0.17, T * 0.75);
  g.addColorStop(0, "rgba(255,226,150,0.22)");
  g.addColorStop(1, "rgba(255,226,150,0)");
  ctx.fillStyle = g;
  ctx.fillRect(sx - T * 0.75, sy - h - T * 0.92, T * 1.5, T * 1.5);
}

export function drawBench(ctx: CanvasRenderingContext2D, sx: number, sy: number, T: number) {
  const w = T * 1.7;
  ctx.fillStyle = "#4a3a2e";
  ctx.fillRect(sx - w / 2 + T * 0.1, sy - T * 0.32, T * 0.08, T * 0.32);
  ctx.fillRect(sx + w / 2 - T * 0.18, sy - T * 0.32, T * 0.08, T * 0.32);
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = k % 2 ? "#b07a4a" : "#c98e58";
    ctx.fillRect(sx - w / 2, sy - T * 0.36 - k * T * 0.12, w, T * 0.1);
  }
  ctx.fillStyle = "#b07a4a";
  ctx.fillRect(sx - w / 2, sy - T * 0.85, w, T * 0.1);
  ctx.fillRect(sx - w / 2, sy - T * 0.68, w, T * 0.1);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1;
  ctx.strokeRect(sx - w / 2, sy - T * 0.85, w, T * 0.6);
}

export function drawFlowers(ctx: CanvasRenderingContext2D, f: (typeof FLOWERS)[number], sx: number, sy: number, T: number) {
  // (sx, sy) = 왼쪽 앞
  const w = f.w * T,
    d = f.d * Y_SCALE * T;
  ctx.fillStyle = "#8a6a4a";
  ctx.fillRect(sx, sy - d - T * 0.12, w, d + T * 0.12);
  ctx.fillStyle = "#6b4f36";
  ctx.fillRect(sx, sy - T * 0.12, w, T * 0.12);
  ctx.fillStyle = "#5c3f2a";
  ctx.fillRect(sx + T * 0.06, sy - d - T * 0.06, w - T * 0.12, d - T * 0.06);
  const col = f.hue === "pink" ? ["#ff8fb8", "#ffd1e0"] : f.hue === "yellow" ? ["#ffd84d", "#fff3a6"] : ["#7fb8ff", "#d0e6ff"];
  for (let k = 0; k < Math.round(f.w * 6); k++) {
    const x = sx + T * 0.12 + hash01(k, f.x * 10) * (w - T * 0.24);
    const y = sy - T * 0.15 - hash01(f.y * 10, k) * (d - T * 0.1);
    ctx.fillStyle = "#4f9a4f";
    ctx.fillRect(x - 1, y - T * 0.04, 2, T * 0.14);
    ctx.fillStyle = col[k % 2];
    ctx.beginPath();
    ctx.arc(x, y - T * 0.08, T * 0.075, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 분수 (sx, sy = 가운데 땅 위치) */
export function drawFountain(ctx: CanvasRenderingContext2D, sx: number, sy: number, T: number, t: number) {
  const rx = FOUNTAIN.r * T,
    ry = FOUNTAIN.r * Y_SCALE * T;
  const rim = T * 0.35;
  // 바깥 돌 테두리 (앞쪽 두께)
  ctx.fillStyle = "#b8aa94";
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(sx - rx, sy - rim, rx * 2, rim);
  ctx.beginPath();
  ctx.ellipse(sx, sy - rim, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#dcd0bb";
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.2, T * 0.03);
  ctx.stroke();
  // 물
  const wg = ctx.createLinearGradient(0, sy - rim - ry, 0, sy - rim + ry);
  wg.addColorStop(0, "#5fc3e8");
  wg.addColorStop(1, "#2f8fc4");
  ctx.fillStyle = wg;
  ctx.beginPath();
  ctx.ellipse(sx, sy - rim, rx * 0.86, ry * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  // 물결 (안에서 밖으로)
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 3; k++) {
    const ph = (t * 0.45 + k / 3) % 1;
    ctx.globalAlpha = 1 - ph;
    ctx.beginPath();
    ctx.ellipse(sx, sy - rim, rx * (0.25 + ph * 0.58), ry * (0.25 + ph * 0.52), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 가운데 기둥 + 위 그릇
  const ph = T * 1.4;
  ctx.fillStyle = "#e6dcc8";
  ctx.fillRect(sx - T * 0.18, sy - rim - ph, T * 0.36, ph);
  ctx.strokeRect(sx - T * 0.18, sy - rim - ph, T * 0.36, ph);
  ctx.fillStyle = "#d4c8b2";
  ctx.beginPath();
  ctx.ellipse(sx, sy - rim - ph, T * 0.75, T * 0.75 * Y_SCALE, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#6fd0f0";
  ctx.beginPath();
  ctx.ellipse(sx, sy - rim - ph - T * 0.04, T * 0.6, T * 0.6 * Y_SCALE, 0, 0, Math.PI * 2);
  ctx.fill();
  // 물줄기 (위로 솟았다 떨어짐)
  ctx.fillStyle = "rgba(220,245,255,0.9)";
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const q = (t * 0.9 + k * 0.17) % 1;
    const dist = q * T * 1.45;
    const x = sx + Math.cos(a) * dist;
    const y = sy - rim - ph - T * 0.2 + Math.sin(a) * dist * Y_SCALE - (Math.sin(q * Math.PI) * T * 0.9 - q * T * 0.2);
    ctx.globalAlpha = 1 - q * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, T * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const jet = T * (0.7 + Math.sin(t * 5) * 0.08);
  const jg = ctx.createLinearGradient(0, sy - rim - ph - jet, 0, sy - rim - ph);
  jg.addColorStop(0, "rgba(255,255,255,0.1)");
  jg.addColorStop(1, "rgba(230,248,255,0.85)");
  ctx.fillStyle = jg;
  ctx.fillRect(sx - T * 0.06, sy - rim - ph - jet, T * 0.12, jet);
}

/** 남쪽 아치 (sx0, sx1 = 두 기둥 화면 x, sy = 땅) */
export function drawArch(ctx: CanvasRenderingContext2D, sx0: number, sx1: number, sy: number, T: number) {
  const h = ARCH.h * Z_SCALE * T;
  const pw = T * 0.9;
  for (const x of [sx0, sx1]) {
    const pg = ctx.createLinearGradient(x - pw / 2, 0, x + pw / 2, 0);
    pg.addColorStop(0, "#d8cdb8");
    pg.addColorStop(0.45, "#f6f0e2");
    pg.addColorStop(1, "#bfb39c");
    ctx.fillStyle = pg;
    ctx.fillRect(x - pw / 2, sy - h, pw, h);
    ctx.fillStyle = "#cfc3ab";
    ctx.fillRect(x - pw / 2 - T * 0.12, sy - T * 0.35, pw + T * 0.24, T * 0.35);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = Math.max(1.5, T * 0.035);
    ctx.strokeRect(x - pw / 2, sy - h, pw, h);
    // 기둥 위 등
    ctx.fillStyle = "#ffe08a";
    ctx.beginPath();
    ctx.arc(x, sy - h - T * 0.25, T * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // 가로 판 (GMTOWN)
  const bx = sx0 - pw * 0.7,
    bw = sx1 - sx0 + pw * 1.4,
    by = sy - h + T * 0.15,
    bh = T * 1.15;
  const g = ctx.createLinearGradient(0, by, 0, by + bh);
  g.addColorStop(0, "#3a2a6b");
  g.addColorStop(1, "#1f1640");
  ctx.fillStyle = g;
  rr(ctx, bx, by, bw, bh, T * 0.25);
  ctx.fill();
  ctx.strokeStyle = "#F2C14E";
  ctx.lineWidth = T * 0.07;
  ctx.stroke();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.5, T * 0.035);
  rr(ctx, bx - T * 0.05, by - T * 0.05, bw + T * 0.1, bh + T * 0.1, T * 0.28);
  ctx.stroke();
  ctx.font = `400 ${bh * 0.62}px ${FONT_TITLE}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tg = ctx.createLinearGradient(0, by, 0, by + bh);
  tg.addColorStop(0, "#FFF1B8");
  tg.addColorStop(1, "#F2B33E");
  ctx.fillStyle = tg;
  ctx.shadowColor = "rgba(242,193,78,0.6)";
  ctx.shadowBlur = T * 0.3;
  ctx.fillText("GMTOWN", (sx0 + sx1) / 2, by + bh * 0.5);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
}

/** 안내판 (sx, sy = 땅) */
export function drawBoard(ctx: CanvasRenderingContext2D, sx: number, sy: number, T: number) {
  ctx.fillStyle = "#6d4a35";
  ctx.fillRect(sx - T * 0.45, sy - T * 1.2, T * 0.08, T * 1.2);
  ctx.fillRect(sx + T * 0.37, sy - T * 1.2, T * 0.08, T * 1.2);
  ctx.fillStyle = "#b8865a";
  rr(ctx, sx - T * 0.6, sy - T * 1.75, T * 1.2, T * 0.8, T * 0.08);
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = Math.max(1.2, T * 0.03);
  ctx.stroke();
  ctx.fillStyle = "#fffaf0";
  ctx.fillRect(sx - T * 0.48, sy - T * 1.65, T * 0.45, T * 0.55);
  ctx.fillStyle = "#ffe9a8";
  ctx.fillRect(sx + T * 0.05, sy - T * 1.62, T * 0.42, T * 0.38);
  ctx.fillStyle = "#e0243c";
  ctx.beginPath();
  ctx.arc(sx - T * 0.25, sy - T * 1.63, T * 0.04, 0, Math.PI * 2);
  ctx.arc(sx + T * 0.26, sy - T * 1.6, T * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `700 ${T * 0.28}px ${FONT_UI}`;
  ctx.fillStyle = "#3a2a1a";
  ctx.textAlign = "center";
  ctx.fillText("?", sx - T * 0.25, sy - T * 1.32);
  ctx.textAlign = "left";
}

export { BENCHES, BOARD };
