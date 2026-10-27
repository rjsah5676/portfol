/**
 * 그리기 — 1024 × 576 디자인 좌표 (무대가 화면에 맞춰 키움).
 *   타석 화면: 포수 뒤 시점 원근 (공 · 그림자 · 스트라이크 존 · 투수 · 타자 리그)
 *   필드 화면: 경기장 전체를 비스듬히 내려다봄 (타구 · 수비 · 주자)
 * 배경은 한 번 그려서 캐시.
 */
import { BASES, FENCE_H, HOME_POS, fenceDist, type Frame } from "@/lib/baseball/play";
import { BALL_R, ZONE } from "@/lib/baseball/pitch";

export const DW = 1024;
export const DH = 576;

// ───────────── 타석 원근 ─────────────
// 구장 그림(bat-low, 낮은 정면 시점 — 컴투스 · 마구마구 구도)에 맞춘 값:
// 홈플레이트 앞면 · 모서리 · 끝, 투수판, 외야 펜스 아래 끝을 그림에서 재서 최소제곱으로 풀었음 (scripts 없이 일회성)
// → 홈 뒤 2.3m · 눈높이 0.47m · 수평선 58%. 예전(bat-dusk): F 2471 · Dc 8.62 · camH 1.094 · Y0 181.4
export const CAM = { F: 688.7, Dc: 2.268, camH: 0.472, Y0: 331.7, cx: 512 };
/**
 * 공 · 존 카메라 (BC): 구장 그림 카메라(CAM)와 따로 — 타자 그림(실제 비율보다 작음)에 맞춰 존을 가슴 ~ 무릎에 두고,
 * 투수 그림 손(화면 y ≈ 229)에서 공이 나가 존으로 「내려오며」 들어오게 푼 값.
 *   맞춘 것: 존 정사각 153px (위 265 · 아래 418, 폭은 그림 홈플레이트 크기 그대로) · 공 놓는 점(투수판) = 손 229
 *   → 홈 뒤 6.6m · 눈높이 0.85m. 손이 화면에서 높이 1.05m 공 자리라 그보다 낮은 공은 계속 내려옴 (높은 공은 직선 그대로 조금 올라감)
 *   (예전 손 249 · F 1546 · Dc 5.09 · camH 0.815 · Y0 302 → 1m 넘는 볼이 홈 앞에서 솟아 보여 투수 키를 1.22배)
 * 땅(높이 0)은 구장 그림 카메라 그대로 (그림자 · 땅에 튄 공), 높이 0 ~ 0.43m 사이는 섞음.
 */
export const BC = { F: 2015.3, Dc: 6.635, camH: 1.0555, Y0: 229 };
/**
 * ↑ 눈높이 = 공 놓는 높이(1.0555m, pitch.ts RELEASE_H) — 2.5등신이라 존이 무릎 0.47 ~ 어깨 0.9m 인 우리 비율로 투수가 공을 놓는 높이.
 * 손(공 놓는 점)이 딱 수평선(Y0 = 손 229)에 오니 그보다 낮게 오는 공은 비행 내내 화면에서 내려오기만 함.
 * (예전 눈높이 0.85 · 놓는 높이 1.62 → 눈보다 높은 공이 다가오며 화면에서 떠올라 보였음, 느린 공 · 커브일수록 오래)
 * 존(위 265 · 아래 418) · 크기 · 손 위치는 그대로.
 */
/** 투수 그림 발 자리 (투수판) — 공 카메라와 따로 고정 (예전 BC 로 맞춘 자리) */
export const PITCHER_FEET = { x: 512, y: 339.15 };
const SB_HOME = BC.F / BC.Dc;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function proj(x: number, y: number, z: number) {
  const s = CAM.F / (z + CAM.Dc);
  const gx = CAM.cx + x * s;
  const gy = CAM.Y0 - (y - CAM.camH) * s;
  const w = clamp01(y / 0.43);
  if (w === 0) return { x: gx, y: gy, s };
  const sb = BC.F / (Math.max(z, -3) + BC.Dc);
  const bx = CAM.cx + x * sb;
  // 한 카메라 원근 그대로라 직선으로 날아온 공은 화면에서도 직선 (예전엔 높은 공을 눌러 주는 보정 때문에 직구가 휘어 보였음)
  // 홈 지나 포수 쪽(z < 0)은 위아래 원근을 홈에서 멈춤 — 안 친 공이 미트로 가며 위 · 아래로 튀어 보이지 않게 (크기 · 좌우는 계속 커짐)
  const sv = Math.min(sb, SB_HOME);
  const by = BC.Y0 - (y - BC.camH) * sv;
  return { x: gx + (bx - gx) * w, y: gy + (by - gy) * w, s: s + (sb - s) * w };
}
export const MOUND = proj(0, 0, 18.4);
/**
 * 투구 · 존 · 컨택존 전용: 공 카메라(BC) 하나로만 (높이에 따라 구장 그림 카메라와 섞지 않음).
 * proj 는 0.43m 아래에서 땅 카메라와 섞어서(타구 · 땅볼용) 낮게 빠지는 투구가 그 구간에서 휘는 방향이 뒤집히고 꺾였음.
 */
export function ballProj(x: number, y: number, z: number) {
  const sb = BC.F / (Math.max(z, -3) + BC.Dc);
  const sv = Math.min(sb, SB_HOME);
  return { x: CAM.cx + x * sb, y: BC.Y0 - (y - BC.camH) * sv, s: sb };
}

/**
 * 날아오는 공의 그림자 — 공과 같은 원근(BC 의 F · Dc)으로, 땅 높이만 따로 맞춘 카메라.
 * 예전엔 그림자를 구장 그림 카메라(CAM)로 그려서, 공 ↔ 그림자 간격이 비행 중 줄었다가 홈 앞에서 다시 벌어짐
 * → 눈이 그림자로 높이를 읽어 「막판에 공이 떠오르는」 것처럼 보였음.
 * 이 카메라는 홈(z 0) · 투수판(z 18.4)에서 구장 그림 땅과 딱 맞고, 그 사이에선 간격이 거리에 따라 계속 커짐.
 */
const SHC = (() => {
  const g0 = CAM.Y0 + CAM.camH * (CAM.F / CAM.Dc); // 구장 그림 땅: 홈
  const g1 = CAM.Y0 + CAM.camH * (CAM.F / (18.4 + CAM.Dc)); // 투수판
  const s0 = BC.F / BC.Dc;
  const s1 = BC.F / (18.4 + BC.Dc);
  const camH = (g0 - g1) / (s0 - s1);
  return { camH, Y0: g0 - camH * s0 };
})();
export function shadowProj(x: number, z: number) {
  const s = BC.F / (Math.max(z, -3) + BC.Dc);
  return { x: CAM.cx + x * s, y: SHC.Y0 + SHC.camH * Math.min(s, SB_HOME), s };
}
/** 홈플레이트 면(z 0)의 화면 좌표 → 월드 (x, 높이) — 공 · 존 카메라 기준 (코스 정하기) */
export function unprojPlate(sx: number, sy: number) {
  const sb = BC.F / BC.Dc;
  return { x: (sx - CAM.cx) / sb, y: BC.camH - (sy - BC.Y0) / sb };
}

// ───────────── 필드 ─────────────
export const FV = { S: 3.95, ox: 512, oy: 552, k: 0.84, kh: 0.9 };
export function fproj(x: number, y: number, h = 0) {
  return { x: FV.ox + x * FV.S, y: FV.oy - y * FV.S * FV.k - h * FV.S * FV.kh };
}

let bgCanvas: HTMLCanvasElement | null = null;
let bgKey = "";
let fieldCanvas: HTMLCanvasElement | null = null;
let fieldKey = "";

function crowd(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, seed: number, rows: number) {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const cols = ["#f4d35e", "#ee6352", "#59cd90", "#3fa7d6", "#fac05e", "#f79d84", "#ffffff", "#c8a2ff", "#ff7a3d"];
  for (let r = 0; r < rows; r++) {
    const yy = y0 + ((y1 - y0) * r) / rows;
    const step = 4 + r * 0.25;
    for (let x = x0; x < x1; x += step) {
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.globalAlpha = 0.55 + rnd() * 0.35;
      ctx.fillRect(x + rnd() * 2, yy + rnd() * 2, 2.2 + r * 0.06, 2.6 + r * 0.06);
    }
  }
  ctx.globalAlpha = 1;
}

/** 구장 그림 (지피티 · 저녁) — 있으면 코드로 그린 배경 대신 이걸 씀 */
export const STADIUM_SRC = "/baseball/stadium/bat-low.webp";
let stadium: HTMLImageElement | null = null;
function stadiumImg() {
  if (!stadium && typeof Image !== "undefined") {
    stadium = new Image();
    stadium.src = STADIUM_SRC;
  }
  return stadium && stadium.complete && stadium.naturalWidth ? stadium : null;
}

/** 타석 배경 (하늘 · 관중석 · 외야 · 내야 · 마운드 · 홈) */
export function battingBg(q: number, night: boolean): HTMLCanvasElement {
  const st = stadiumImg();
  const key = `${q}:${night}:${st ? 1 : 0}`;
  if (bgCanvas && bgKey === key) return bgCanvas;
  if (st) {
    const c = document.createElement("canvas");
    c.width = Math.round(DW * q);
    c.height = Math.round(DH * q);
    const g = c.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(st, 0, 0, c.width, c.height);
    bgCanvas = c;
    bgKey = key;
    return c;
  }
  const c = document.createElement("canvas");
  c.width = Math.round(DW * q);
  c.height = Math.round(DH * q);
  const g = c.getContext("2d")!;
  g.scale(q, q);
  // 하늘
  const sky = g.createLinearGradient(0, 0, 0, 200);
  if (night) {
    sky.addColorStop(0, "#070b1f");
    sky.addColorStop(1, "#1f2a5c");
  } else {
    sky.addColorStop(0, "#5fb0ff");
    sky.addColorStop(1, "#bfe3ff");
  }
  g.fillStyle = sky;
  g.fillRect(0, 0, DW, 200);
  // 조명탑
  if (night) {
    for (const lx of [120, 904]) {
      g.fillStyle = "#2b3150";
      g.fillRect(lx - 3, 40, 6, 90);
      g.fillStyle = "#fff8d6";
      g.shadowColor = "#fff3b0";
      g.shadowBlur = 30;
      g.fillRect(lx - 26, 30, 52, 14);
      g.shadowBlur = 0;
    }
  }
  // 관중석 (외야 펜스 뒤 계단)
  const fy = proj(0, FENCE_H, 118).y;
  g.fillStyle = night ? "#1b1f36" : "#3a4466";
  g.fillRect(0, 108, DW, fy - 108);
  crowd(g, 0, 112, DW, fy - 6, 7, 12);
  // 관중은 살짝 눌러서 공보다 튀지 않게
  g.fillStyle = night ? "rgba(8,10,24,0.38)" : "rgba(20,28,52,0.32)";
  g.fillRect(0, 108, DW, fy - 108);
  // 백스크린 (센터 뒤 어두운 벽 — 실제 구장처럼 투수 손에서 나오는 공이 잘 보이게)
  {
    const bx0 = 352;
    const bx1 = 672;
    const top = 92;
    const bs = g.createLinearGradient(0, top, 0, CAM.Y0 + 6);
    bs.addColorStop(0, night ? "#0b1024" : "#18233f");
    bs.addColorStop(1, night ? "#121a33" : "#22304f");
    g.fillStyle = bs;
    g.fillRect(bx0, top, bx1 - bx0, CAM.Y0 + 6 - top);
    g.fillStyle = "rgba(255,255,255,0.06)";
    g.fillRect(bx0, top, bx1 - bx0, 2);
  }
  // 전광판
  g.fillStyle = "#111522";
  g.fillRect(412, 22, 200, 36);
  g.strokeStyle = "#ffcf4a";
  g.lineWidth = 2;
  g.strokeRect(412, 22, 200, 36);
  g.fillStyle = "#ffcf4a";
  g.font = '16px "Black Han Sans", sans-serif';
  g.textAlign = "center";
  g.fillText("PIXEL STADIUM", 512, 46);
  // 펜스
  g.fillStyle = "#1d5a3a";
  g.fillRect(0, fy, 352, CAM.Y0 + 6 - fy);
  g.fillRect(672, fy, DW - 672, CAM.Y0 + 6 - fy);
  g.fillStyle = "#ffd23f";
  g.fillRect(0, fy, 352, 2);
  g.fillRect(672, fy, DW - 672, 2);
  // 잔디 (원근 줄무늬)
  for (let i = 0; i < 26; i++) {
    const z0 = 118 - i * 4.6;
    const z1 = z0 - 4.6;
    const y0 = proj(0, 0, Math.max(z0, 0.1)).y;
    const y1 = proj(0, 0, Math.max(z1, 0.1)).y;
    g.fillStyle = i % 2 ? "#3f9a4c" : "#46a854";
    g.fillRect(0, y0, DW, y1 - y0 + 1);
  }
  g.fillStyle = "#46a854";
  g.fillRect(0, proj(0, 0, 0.1).y, DW, DH);
  // 내야 흙 (다이아몬드)
  const poly = (pts: [number, number][], fill: string) => {
    g.beginPath();
    pts.forEach(([x, z], i) => {
      const p = proj(x, 0, z);
      if (i) g.lineTo(p.x, p.y);
      else g.moveTo(p.x, p.y);
    });
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  // 흙 부채꼴
  const arc: [number, number][] = [];
  for (let a = -48; a <= 48; a += 4) {
    const r = 29;
    arc.push([Math.sin((a * Math.PI) / 180) * r, Math.cos((a * Math.PI) / 180) * r + 0.0]);
  }
  poly([[0, -1.5], ...arc], "#c8925a");
  // 내야 잔디
  poly([[0, 1.6], [17.6, 19.4], [0, 37], [-17.6, 19.4]], "#4caf5a");
  // 베이스 라인
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 2;
  for (const s of [1, -1]) {
    const a = proj(0, 0, 0.4);
    const b = proj(s * 70, 0, 70);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  // 베이스
  for (const [bx, bz] of [[19.4, 19.4], [0, 38.8], [-19.4, 19.4]] as [number, number][]) {
    const p = proj(bx, 0, bz);
    g.fillStyle = "#fff";
    g.fillRect(p.x - p.s * 0.25, p.y - p.s * 0.12, p.s * 0.5, p.s * 0.24);
  }
  // 마운드
  const m = proj(0, 0, 18.4);
  g.fillStyle = "#c08550";
  g.beginPath();
  g.ellipse(m.x, m.y, 2.7 * m.s, 2.7 * m.s * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.fillRect(m.x - 0.3 * m.s, m.y - 2, 0.6 * m.s, 2);
  // 타석 흙 · 홈플레이트
  const hp = proj(0, 0, 0.2);
  g.fillStyle = "#c8925a";
  g.beginPath();
  g.ellipse(hp.x, hp.y + 30, 330, 70, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.lineWidth = 3;
  for (const s of [-1, 1]) {
    const a = proj(s * 0.45, 0, 0.6);
    const b = proj(s * 1.35, 0, 0.6);
    const d = proj(s * 1.35, 0, -0.6);
    const e = proj(s * 0.45, 0, -0.6);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.lineTo(d.x, d.y);
    g.lineTo(e.x, e.y);
    g.stroke();
  }
  const pl = [proj(-0.215, 0, 0.43), proj(0.215, 0, 0.43), proj(0.215, 0, 0.2), proj(0, 0, 0), proj(-0.215, 0, 0.2)];
  g.fillStyle = "#fafafa";
  g.beginPath();
  pl.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
  g.fill();
  bgCanvas = c;
  bgKey = key;
  return c;
}

/** 필드 배경 */
export function fieldBg(q: number, night: boolean): HTMLCanvasElement {
  const key = `${q}:${night}`;
  if (fieldCanvas && fieldKey === key) return fieldCanvas;
  const c = document.createElement("canvas");
  c.width = Math.round(DW * q);
  c.height = Math.round(DH * q);
  const g = c.getContext("2d")!;
  g.scale(q, q);
  g.fillStyle = night ? "#121633" : "#2c3557";
  g.fillRect(0, 0, DW, DH);
  // 관중석 (펜스 바깥 띠)
  g.save();
  g.beginPath();
  for (let a = -55; a <= 55; a += 2) {
    const r = fenceDist(Math.max(-45, Math.min(45, a))) + 30;
    const p = fproj(Math.sin((a * Math.PI) / 180) * r, Math.cos((a * Math.PI) / 180) * r);
    if (a === -55) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
  }
  for (let a = 55; a >= -55; a -= 2) {
    const r = fenceDist(Math.max(-45, Math.min(45, a))) + 2;
    const p = fproj(Math.sin((a * Math.PI) / 180) * r, Math.cos((a * Math.PI) / 180) * r, FENCE_H);
    g.lineTo(p.x, p.y);
  }
  g.closePath();
  g.fillStyle = night ? "#1f2547" : "#45507a";
  g.fill();
  g.clip();
  crowd(g, 0, 0, DW, 260, 11, 34);
  g.restore();
  // 잔디
  g.beginPath();
  const fair: { x: number; y: number }[] = [];
  for (let a = -45; a <= 45; a += 1.5) {
    const r = fenceDist(a);
    fair.push(fproj(Math.sin((a * Math.PI) / 180) * r, Math.cos((a * Math.PI) / 180) * r));
  }
  const home = fproj(0, -4);
  g.moveTo(home.x, home.y);
  fair.forEach((p) => g.lineTo(p.x, p.y));
  g.closePath();
  const grass = g.createLinearGradient(0, 260, 0, DH);
  grass.addColorStop(0, "#3d9a4a");
  grass.addColorStop(1, "#4fb85c");
  g.fillStyle = grass;
  g.fill();
  // 잔디 줄무늬
  g.save();
  g.clip();
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.035)";
    const y0 = fproj(0, i * 9).y;
    const y1 = fproj(0, (i + 1) * 9).y;
    g.fillRect(0, y1, DW, y0 - y1);
  }
  g.restore();
  // 펜스 (높이 있는 벽)
  g.fillStyle = "#1d5a3a";
  g.beginPath();
  fair.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  for (let a = 45; a >= -45; a -= 1.5) {
    const r = fenceDist(a);
    const p = fproj(Math.sin((a * Math.PI) / 180) * r, Math.cos((a * Math.PI) / 180) * r, FENCE_H);
    g.lineTo(p.x, p.y);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = "#ffd23f";
  g.lineWidth = 1.5;
  g.beginPath();
  for (let a = -45; a <= 45; a += 1.5) {
    const r = fenceDist(a);
    const p = fproj(Math.sin((a * Math.PI) / 180) * r, Math.cos((a * Math.PI) / 180) * r, FENCE_H);
    if (a === -45) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
  }
  g.stroke();
  // 내야 흙
  g.beginPath();
  const h0 = fproj(0, -2);
  g.moveTo(h0.x, h0.y);
  for (let a = -45; a <= 45; a += 3) {
    const p = fproj(Math.sin((a * Math.PI) / 180) * 29, Math.cos((a * Math.PI) / 180) * 29);
    g.lineTo(p.x, p.y);
  }
  g.closePath();
  g.fillStyle = "#c8925a";
  g.fill();
  g.beginPath();
  const dia = [fproj(0, 1.5), fproj(17.6, 19.4), fproj(0, 37.2), fproj(-17.6, 19.4)];
  dia.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
  g.fillStyle = "#4caf5a";
  g.fill();
  // 마운드
  const m = fproj(0, 18.4);
  g.fillStyle = "#c08550";
  g.beginPath();
  g.ellipse(m.x, m.y, 2.8 * FV.S, 2.8 * FV.S * FV.k, 0, 0, Math.PI * 2);
  g.fill();
  // 파울라인
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 1.5;
  for (const s of [1, -1]) {
    const a = fproj(0, 0);
    const b = fproj((s * 98) / Math.SQRT2, 98 / Math.SQRT2);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  // 베이스
  BASES.slice(0, 4).forEach(([x, y], i) => {
    const p = fproj(x, y);
    g.fillStyle = "#fff";
    g.save();
    g.translate(p.x, p.y);
    g.scale(1, FV.k);
    g.rotate(Math.PI / 4);
    const s = i === 0 ? 5 : 4.5;
    g.fillRect(-s, -s, s * 2, s * 2);
    g.restore();
  });
  fieldCanvas = c;
  fieldKey = key;
  return c;
}

/** 작은 사람 (필드) */
export function drawTiny(ctx: CanvasRenderingContext2D, x: number, y: number, body: string, cap: string, run: number, state = 0, glove = false) {
  const bob = Math.sin(run * 14) * (run ? 1.5 : 0);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  // 다리 (SD: 짧게)
  ctx.strokeStyle = "#e9ecf2";
  ctx.lineWidth = 3.4;
  const sw = run ? Math.sin(run * 14) * 3 : 0;
  ctx.beginPath();
  ctx.moveTo(-2.4, -6);
  ctx.lineTo(-2.4 + sw, 0);
  ctx.moveTo(2.4, -6);
  ctx.lineTo(2.4 - sw, 0);
  ctx.stroke();
  // 몸
  ctx.fillStyle = body;
  ctx.strokeStyle = "rgba(10,12,22,0.9)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-5.5, -14 + bob, 11, 9, 3.5);
  ctx.fill();
  ctx.stroke();
  // 머리 (크게)
  ctx.fillStyle = "#f2cfae";
  ctx.beginPath();
  ctx.arc(0, -21 + bob, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.arc(0, -22 + bob, 7.1, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = "#1a1a24";
  ctx.fillRect(-3, -20 + bob, 1.6, 2.4);
  ctx.fillRect(1.6, -20 + bob, 1.6, 2.4);
  if (glove) {
    ctx.fillStyle = "#8a4b22";
    ctx.beginPath();
    ctx.arc(7, -10 + bob, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (state === 1) {
    // 기절 (해골 말풍선)
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(9, -34, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("☠", 9, -30);
  } else if (state === 2) {
    ctx.fillStyle = "#3B9CFF";
    ctx.fillRect(-7, -36, 4, 9);
    ctx.fillRect(1, -36, 4, 9);
  } else if (state === 3) {
    ctx.strokeStyle = "#FFD43B";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-8, -30);
    ctx.lineTo(-3, -26);
    ctx.lineTo(-6, -24);
    ctx.lineTo(0, -19);
    ctx.stroke();
  }
  ctx.restore();
}

/** 필드 한 프레임 */
export function drawFieldFrame(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  def: { body: string; cap: string },
  off: { body: string; cap: string },
  trail: { x: number; y: number; h: number }[],
  special?: string
) {
  // 공 그림자 · 수비 · 주자 · 공 순 (y 순으로 겹침)
  const items: { y: number; draw: () => void }[] = [];
  for (let i = 0; i < 9; i++) {
    const p = fproj(f.fx[i * 2], f.fx[i * 2 + 1]);
    const st = f.fs[i];
    const moving = 1;
    items.push({ y: p.y, draw: () => drawTiny(ctx, p.x, p.y, def.body, def.cap, moving * f.t, st, true) });
  }
  for (const r of f.rs) {
    if (r.st === 2) continue;
    const p = fproj(r.x, r.y);
    items.push({ y: p.y, draw: () => drawTiny(ctx, p.x, p.y, off.body, off.cap, r.st === 0 ? f.t : 0) });
  }
  items.sort((a, b) => a.y - b.y);
  // 그림자
  const sh = fproj(f.bx, f.by);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(sh.x, sh.y, 3.2, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const it of items) it.draw();
  // 꼬리
  if (trail.length > 1) {
    ctx.strokeStyle = special === "igna" ? "rgba(255,120,40,0.7)" : special === "zena" ? "rgba(255,230,80,0.8)" : "rgba(255,255,255,0.55)";
    ctx.lineWidth = special ? 4 : 2;
    ctx.beginPath();
    trail.forEach((t, i) => {
      const p = fproj(t.x, t.y, t.h);
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
    ctx.stroke();
  }
  const b = fproj(f.bx, f.by, f.bh);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(b.x, b.y, 3.2 + Math.min(4, f.bh * 0.12), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export { BALL_R, HOME_POS, ZONE };
