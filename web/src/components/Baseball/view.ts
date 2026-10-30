/**
 * 그리기 — 1024 × 576 디자인 좌표 (무대가 화면에 맞춰 키움).
 *   타석 화면: 포수 뒤 시점 원근 (공 · 그림자 · 스트라이크 존 · 투수 · 타자 리그)
 *   필드 화면: 경기장 전체를 비스듬히 내려다봄 (타구 · 수비 · 주자)
 * 배경은 한 번 그려서 캐시.
 */
import { BASES, FENCE_H, HOME_POS, fenceDist, type Frame } from "@/lib/baseball/play";
import { FieldPoser, drawFieldSprite, fieldSpritesReady, type Pose } from "./fieldSprites";
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
/**
 * 필드 시점: 탑뷰(비스듬한 평면) ↔ 3/4 원근 (포수 뒤 높은 곳 · 목업 시점) — 비교용으로 둘 다 (localStorage pxb:fieldview)
 * 원근 카메라: 홈 뒤 cy m · 높이 ch m · th 만큼 내려다봄. 홈 ≈ 화면 아래(530) · 중견 펜스 ≈ 140 · 좌우 폴 ≈ 화면 양끝. 높이는 hk 배로 눌러 큰 뜬공도 화면 안
 */
export const FIELD_VIEW = { persp: true };
const PC = (() => {
  const th = (20 * Math.PI) / 180;
  return { cy: 60, ch: 45, cos: Math.cos(th), sin: Math.sin(th), F: 954, Y0: 241, hk: 1, dRef: 0 };
})();
PC.dRef = (18.4 + PC.cy) * PC.cos + PC.ch * PC.sin; // 투수판 깊이 = 크기 1
// 시점은 3/4 원근 하나로 고정 (탑뷰 비교 끝, 2026-10-30) — 예전에 고른 값(pxb:fieldview)은 지움
if (typeof window !== "undefined") {
  try {
    localStorage.removeItem("pxb:fieldview");
  } catch {}
}
/** 필드 좌표(x 좌우 · y 홈에서 앞 · h 높이, m) → 화면. s = 그 자리 크기 배율 (탑뷰는 1) */
export function fproj(x: number, y: number, h = 0) {
  if (!FIELD_VIEW.persp) return { x: FV.ox + x * FV.S, y: FV.oy - y * FV.S * FV.k - h * FV.S * FV.kh, s: 1 };
  const ry = y + PC.cy;
  const rz = h * PC.hk - PC.ch;
  const d = Math.max(4, ry * PC.cos - rz * PC.sin);
  const v = ry * PC.sin + rz * PC.cos;
  // 멀수록 작게 — 실제 원근(^1)이면 외야수가 점이 돼서 조금 덜 줄임 (^0.85, 예전 0.6)
  return { x: 512 + (PC.F * x) / d, y: PC.Y0 - (PC.F * v) / d, s: Math.pow(PC.dRef / d, 0.85) };
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
/** 필드 배경 한 픽셀 = 화면 몇 px (픽셀 그림처럼 낮은 해상도로 그려서 키움 — 수비 스프라이트 · 타석 그림과 맞춤) */
export const FIELD_BG_PX = 1.3;
/** 필드 배경 색 (저녁 구장) */
const FC = {
  sky: "#141a36",
  stand: ["#262e57", "#2f3866", "#232a50"],
  standEdge: "#11152c",
  crowd: ["#c9b8a6", "#e6d6c2", "#8f7f72", "#d76a5a", "#e9b04f", "#6f9fd6", "#f2f2f2", "#9c86c9", "#5fb27a"],
  wall: "#1f4a3c",
  wallDark: "#173a2f",
  wallTop: "#ffd23f",
  pole: "#ffe14a",
  grassA: "#3f9a46",
  grassB: "#48a84f",
  foulA: "#36823e",
  foulB: "#3b8b43",
  dirt: "#c48a52",
  dirtDark: "#a96f3e",
  dirtLight: "#d9a26a",
  track: "#9c6a3e",
  line: "#f3f3ee",
  base: "#ffffff",
};

/** 필드 배경 (관중석 · 펜스 · 워닝 트랙 · 잔디 무늬 · 내야 흙 · 베이스) — 낮은 해상도로 한 번 그려 캐시, 그릴 땐 픽셀 그대로 키움 */
export function fieldBg(_q: number, night: boolean): HTMLCanvasElement {
  const key = `${night}:${FIELD_VIEW.persp}`;
  if (fieldCanvas && fieldKey === key) return fieldCanvas;
  const PX = FIELD_BG_PX;
  const c = document.createElement("canvas");
  c.width = Math.round(DW / PX);
  c.height = Math.round(DH / PX);
  const g = c.getContext("2d")!;
  g.scale(1 / PX, 1 / PX);
  let seed = 97;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const rad = (a: number) => (a * Math.PI) / 180;
  const W = (x: number, y: number, h = 0) => fproj(x, y, h);
  const arcPt = (a: number, r: number, h = 0) => W(Math.sin(rad(a)) * r, Math.cos(rad(a)) * r, h);
  const poly = (pts: { x: number; y: number }[]) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
  };
  const circle = (cx: number, cy: number, r: number, n = 32) => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(W(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    return pts;
  };
  /** 픽셀 점 (배경 한 픽셀) */
  const dot = (x: number, y: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(Math.floor(x / PX) * PX, Math.floor(y / PX) * PX, PX, PX);
  };
  /** 지금 클립 영역 안에 흙 알갱이 */
  const speckle = (x0: number, y0: number, x1: number, y1: number, n: number, cols: string[]) => {
    for (let i = 0; i < n; i++) dot(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), cols[Math.floor(rnd() * cols.length)]);
  };

  g.fillStyle = FC.sky;
  g.fillRect(0, 0, DW, DH);

  // ── 관중석: 펜스 뒤로 올라가는 계단 (층마다 색 번갈아) + 관중 머리 점
  const TIERS = 14;
  for (let k = TIERS - 1; k >= 0; k--) {
    const r0 = 3 + (k * 27) / TIERS;
    const r1 = 3 + ((k + 1) * 27) / TIERS;
    const h0 = FENCE_H + 0.6 + (k * 18) / TIERS;
    const h1 = FENCE_H + 0.6 + ((k + 1) * 18) / TIERS;
    const pts: { x: number; y: number }[] = [];
    for (let a = -58; a <= 58; a += 2) pts.push(arcPt(a, fenceDist(Math.max(-45, Math.min(45, a))) + r0, h0));
    for (let a = 58; a >= -58; a -= 2) pts.push(arcPt(a, fenceDist(Math.max(-45, Math.min(45, a))) + r1, h1));
    poly(pts);
    g.fillStyle = FC.stand[k % 3];
    g.fill();
    // 관중 (계단 한 줄에 한 줄) — 통로 자리는 비움
    const hm = (h0 + h1) / 2;
    const rm = (r0 + r1) / 2;
    for (let a = -57; a <= 57; a += 0.9) {
      if (Math.abs(((a + 60) % 15) - 7.5) < 0.6) continue; // 통로
      if (rnd() < 0.18) continue;
      const p = arcPt(a + rnd() * 0.5, fenceDist(Math.max(-45, Math.min(45, a))) + rm, hm);
      const col = FC.crowd[Math.floor(rnd() * FC.crowd.length)];
      dot(p.x, p.y, col);
      if (rnd() < 0.5) dot(p.x, p.y + PX, "rgba(0,0,0,0.35)");
    }
  }
  // 관중석 위 끝 그늘
  {
    const pts: { x: number; y: number }[] = [];
    for (let a = -58; a <= 58; a += 2) pts.push(arcPt(a, fenceDist(Math.max(-45, Math.min(45, a))) + 30, FENCE_H + 18.6));
    pts.push({ x: DW + 40, y: -40 }, { x: -40, y: -40 });
    poly(pts);
    g.fillStyle = FC.standEdge;
    g.fill();
  }

  // ── 파울 지역 땅 (홈 양옆 · 펜스까지)
  {
    const pts: { x: number; y: number }[] = [];
    for (let a = -62; a <= 62; a += 2) pts.push(arcPt(a, fenceDist(Math.max(-45, Math.min(45, a))) + 2));
    for (const [x, y] of [[62, -6], [14, -18], [-14, -18], [-62, -6]]) pts.push(W(x, y));
    poly(pts);
    g.fillStyle = FC.foulA;
    g.fill();
  }

  // ── 페어 지역 잔디: 대각 체크 무늬 (중계 화면 잔디 깎은 결)
  const fair: { x: number; y: number }[] = [W(0, -3)];
  for (let a = -45; a <= 45; a += 1.5) fair.push(arcPt(a, fenceDist(a)));
  g.save();
  poly(fair);
  g.clip();
  g.fillStyle = FC.grassA;
  g.fillRect(0, 0, DW, DH);
  const CELL = 9;
  for (let i = -16; i <= 16; i++) {
    for (let j = 0; j <= 16; j++) {
      if ((i + j) % 2 === 0) continue;
      // 홈 기준 45° 돌린 칸
      const q = (u: number, v: number) => W(((u - v) * CELL) / Math.SQRT2, ((u + v) * CELL) / Math.SQRT2);
      const u = j, v = i;
      poly([q(u, v), q(u + 1, v), q(u + 1, v + 1), q(u, v + 1)]);
      g.fillStyle = FC.grassB;
      g.fill();
    }
  }
  // 워닝 트랙 (펜스 앞 흙 띠)
  {
    const pts: { x: number; y: number }[] = [];
    for (let a = -46; a <= 46; a += 1.5) pts.push(arcPt(a, fenceDist(a) + 1));
    for (let a = 46; a >= -46; a -= 1.5) pts.push(arcPt(a, fenceDist(a) - 4.6));
    poly(pts);
    g.fillStyle = FC.track;
    g.fill();
  }
  g.restore();
  // 파울 지역 잔디 결 (파울 라인 바깥)
  {
    for (const s of [1, -1]) {
      const pts = [W(0, -3), W(s * 75, 75), W(s * 90, 60), W(s * 18, -14)];
      g.save();
      poly(pts);
      g.clip();
      for (let k = 0; k < 10; k++) {
        if (k % 2) continue;
        const a0 = k * 9, a1 = (k + 1) * 9;
        poly([W(s * a0, a0 - 3), W(s * a1, a1 - 3), W(s * (a1 + 12), a1 - 15), W(s * (a0 + 12), a0 - 15)]);
        g.fillStyle = FC.foulB;
        g.fill();
      }
      g.restore();
    }
  }

  // ── 내야 흙: 마운드 기준 반지름 29m 호 (페어 안) + 파울 쪽 베이스 길
  g.save();
  poly(fair);
  g.clip();
  poly(circle(0, 18.4, 29, 64));
  g.fillStyle = FC.dirt;
  g.fill();
  g.restore();
  // 베이스 길 (1 · 3루 쪽 라인 따라 흙 띠, 파울 쪽 절반 포함)
  for (const s of [1, -1]) {
    const L = 19.4 * Math.SQRT2 + 2.4;
    const ux = (s * 1) / Math.SQRT2, uy = 1 / Math.SQRT2;
    const nx = uy * s, ny = -ux * s; // 라인 바깥쪽
    const w = 1.0;
    poly([W(-nx * w * 0.2, -ny * w * 0.2), W(ux * L - nx * w * 0.2, uy * L - ny * w * 0.2), W(ux * L + nx * w * 1.6, uy * L + ny * w * 1.6), W(nx * w * 1.6, ny * w * 1.6)]);
    g.fillStyle = FC.dirt;
    g.fill();
  }
  // 홈 주변 흙 원
  poly(circle(0, 0, 4.2));
  g.fillStyle = FC.dirt;
  g.fill();
  // 흙 알갱이 (내야)
  {
    // 흙 위에만: 클립을 흙 모양으로
    g.save();
    poly(fair);
    g.clip();
    poly(circle(0, 18.4, 29, 64));
    g.clip();
    const box = { x0: W(-35, 40).x, x1: W(35, 40).x, y0: W(0, 48).y - 8, y1: W(0, 0).y + 12 };
    speckle(box.x0, box.y0, box.x1, box.y1, 1600, [FC.dirtDark, FC.dirtLight, FC.dirtDark]);
    g.restore();
  }
  // 내야 잔디 (베이스 길 안쪽 정사각) — 1 · 3루 베이스 자리는 흙 원으로 깎음
  poly([W(0, 2.6), W(17.6, 19.4), W(0, 36.2), W(-17.6, 19.4)]);
  g.fillStyle = FC.grassB;
  g.fill();
  // 내야 잔디 결 (작은 체크)
  g.save();
  poly([W(0, 2.6), W(17.6, 19.4), W(0, 36.2), W(-17.6, 19.4)]);
  g.clip();
  for (let i = -4; i <= 4; i++) {
    for (let j = 0; j <= 9; j++) {
      if ((i + j) % 2 === 0) continue;
      const C2 = 4.85;
      const q = (u: number, v: number) => W(((u - v) * C2) / Math.SQRT2, ((u + v) * C2) / Math.SQRT2);
      poly([q(j, i), q(j + 1, i), q(j + 1, i + 1), q(j, i + 1)]);
      g.fillStyle = FC.grassA;
      g.fill();
    }
  }
  g.restore();
  for (const [x, y] of [[19.4, 19.4], [-19.4, 19.4]]) {
    poly(circle(x, y, 2.6, 20));
    g.fillStyle = FC.dirt;
    g.fill();
  }
  // 마운드
  poly(circle(0, 18.4, 2.8, 24));
  g.fillStyle = FC.dirtLight;
  g.fill();
  poly(circle(0, 18.6, 1.6, 16));
  g.fillStyle = FC.dirt;
  g.fill();
  // 흙 알갱이 (내야 · 워닝 트랙)
  {
    g.save();
    const pts: { x: number; y: number }[] = [];
    for (let a = -46; a <= 46; a += 1.5) pts.push(arcPt(a, fenceDist(a) + 1));
    for (let a = 46; a >= -46; a -= 1.5) pts.push(arcPt(a, fenceDist(a) - 4.6));
    poly(pts);
    g.clip();
    speckle(0, 0, DW, W(0, 70).y, 2200, [FC.dirtDark, "#8a5c34"]);
    g.restore();
  }
  // 잔디 알갱이 (조금)
  g.save();
  poly(fair);
  g.clip();
  speckle(0, W(0, 120).y, DW, DH, 2600, ["rgba(20,60,25,0.35)", "rgba(255,255,255,0.08)"]);
  g.restore();

  // ── 펜스 (패딩 벽 · 이음매 · 노란 윗선) + 파울폴
  {
    const pts: { x: number; y: number }[] = [];
    for (let a = -45; a <= 45; a += 1.5) pts.push(arcPt(a, fenceDist(a)));
    for (let a = 45; a >= -45; a -= 1.5) pts.push(arcPt(a, fenceDist(a), FENCE_H));
    poly(pts);
    g.fillStyle = FC.wall;
    g.fill();
    g.strokeStyle = FC.wallDark;
    g.lineWidth = PX;
    for (let a = -42; a <= 42; a += 6) {
      const p0 = arcPt(a, fenceDist(a)), p1 = arcPt(a, fenceDist(a), FENCE_H);
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.stroke();
    }
    g.strokeStyle = FC.wallTop;
    g.lineWidth = PX * 1.2;
    g.beginPath();
    for (let a = -45; a <= 45; a += 1.5) {
      const p = arcPt(a, fenceDist(a), FENCE_H);
      if (a === -45) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.stroke();
    for (const s of [1, -1]) {
      const p0 = arcPt(s * 45, fenceDist(45)), p1 = arcPt(s * 45, fenceDist(45), FENCE_H + 14);
      g.strokeStyle = FC.pole;
      g.lineWidth = PX * 1.4;
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.stroke();
    }
  }

  // ── 선: 파울 라인 · 타석
  g.strokeStyle = FC.line;
  g.lineWidth = PX;
  for (const s of [1, -1]) {
    const a = W(0, 0);
    const b = W((s * 98) / Math.SQRT2, 98 / Math.SQRT2);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    // 타석 상자
    poly([W(s * 0.55, -0.9), W(s * 1.75, -0.9), W(s * 1.75, 0.9), W(s * 0.55, 0.9)]);
    g.stroke();
  }
  // 베이스 (땅 위 마름모) · 홈플레이트 · 투수판
  BASES.slice(1, 4).forEach(([x, y]) => {
    const r = 0.55;
    poly([W(x, y - r), W(x + r, y), W(x, y + r), W(x - r, y)]);
    g.fillStyle = FC.base;
    g.fill();
  });
  poly([W(-0.3, 0.3), W(0.3, 0.3), W(0.3, 0), W(0, -0.3), W(-0.3, 0)]);
  g.fillStyle = FC.base;
  g.fill();
  poly([W(-0.35, 18.3), W(0.35, 18.3), W(0.35, 18.5), W(-0.35, 18.5)]);
  g.fill();
  if (night) {
    g.fillStyle = "rgba(8,10,30,0.25)";
    g.fillRect(0, 0, DW, DH);
  }
  fieldCanvas = c;
  fieldKey = key;
  return c;
}

/** 작은 사람 (필드) */
export function drawTiny(ctx: CanvasRenderingContext2D, x: number, y: number, body: string, cap: string, run: number, state = 0, glove = false, sc = 1) {
  const bob = Math.sin(run * 14) * (run ? 1.5 : 0);
  ctx.save();
  ctx.translate(x, y);
  if (sc !== 1) ctx.scale(sc, sc);
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
  drawStateMark(ctx, state);
  ctx.restore();
}

/** 수비 상태 표시 (기절 해골 · 멈춤 · 감전) — 발 자리 기준 위쪽, 작은 사람 크기 좌표 */
function drawStateMark(ctx: CanvasRenderingContext2D, state: number) {
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
}

/** 원근이면 사람을 조금 크게 (투수판 자리 기준 1.3배) */
const TINY_K = () => (FIELD_VIEW.persp ? 1.3 : 1);
/** 픽셀 스프라이트: 스프라이트 1픽셀 = 투수판 자리에서 1.25px (사람 키 ≈ 51px) */
const SPRITE_K = () => (FIELD_VIEW.persp ? 1.25 : 0.95);

/** 필드 한 프레임 */
export function drawFieldFrame(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  def: { body: string; cap: string },
  off: { body: string; cap: string },
  trail: { x: number; y: number; h: number }[],
  special?: string,
  /** 이번 타구가 날아갈 길 (뜬공 · 라이너 첫 낙하까지) — 점선 호 · 떨어질 자리 링 */
  arc?: { pts: { x: number; y: number; h: number }[]; land: { x: number; y: number } | null },
  /** 픽셀 스프라이트 동작 (불러온 뒤) — 없으면 작은 코드 그림 */
  poser?: FieldPoser | null,
  /** 수비 화면 시계 (초) */
  ft = f.t,
  lastPose?: Pose[],
) {
  // 공 그림자 · 수비 · 주자 · 공 순 (y 순으로 겹침)
  const items: { y: number; draw: () => void }[] = [];
  const spr = !!poser && fieldSpritesReady();
  for (let i = 0; i < 9; i++) {
    const p = fproj(f.fx[i * 2], f.fx[i * 2 + 1]);
    const st = f.fs[i];
    const moving = 1;
    if (spr) {
      const pose = poser!.fielder(i, f, ft, lastPose?.[i]);
      if (lastPose) lastPose[i] = pose;
      const sc = p.s * SPRITE_K();
      items.push({
        y: p.y,
        draw: () => {
          drawFieldSprite(ctx, "fd", pose, p.x, p.y, sc, def.body);
          if (st) {
            ctx.save();
            ctx.translate(p.x, p.y - 12 * sc);
            ctx.scale(sc, sc);
            drawStateMark(ctx, st);
            ctx.restore();
          }
        },
      });
    } else items.push({ y: p.y, draw: () => drawTiny(ctx, p.x, p.y, def.body, def.cap, moving * f.t, st, true, p.s * TINY_K()) });
  }
  f.rs.forEach((r, j) => {
    if (r.st === 2) return;
    const p = fproj(r.x, r.y);
    if (spr) {
      const pose = poser!.runner(j, f, ft);
      const sc = p.s * SPRITE_K();
      items.push({ y: p.y, draw: () => drawFieldSprite(ctx, "bt", pose, p.x, p.y, sc, off.body) });
    } else items.push({ y: p.y, draw: () => drawTiny(ctx, p.x, p.y, off.body, off.cap, r.st === 0 ? f.t : 0, 0, false, p.s * TINY_K()) });
  });
  items.sort((a, b) => a.y - b.y);
  const flying = f.hold < 0 && f.bh > 0.4;
  // 날아갈 길 (아직 안 간 쪽만 점선) · 떨어질 자리 링 — 높이 · 방향이 한눈에 읽히게
  if (arc && flying && arc.pts.length > 1) {
    // 땅 위 경로(그림자가 지나갈 길) — 위의 공 점선과 벌어진 만큼이 높이
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.32)";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    const g0 = fproj(f.bx, f.by);
    ctx.moveTo(g0.x, g0.y);
    for (const q of arc.pts) {
      const p = fproj(q.x, q.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    let started = false;
    // (arc.pts 는 지금 이후 점만 — match.ts)
    for (const q of arc.pts) {
      const p = fproj(q.x, q.y, q.h);
      if (!started) {
        const b0 = fproj(f.bx, f.by, f.bh);
        ctx.moveTo(b0.x, b0.y);
        started = true;
      }
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }
  if (arc?.land && flying) {
    const L = fproj(arc.land.x, arc.land.y);
    const pulse = 1 + Math.sin(f.t * 10) * 0.12;
    ctx.save();
    ctx.translate(L.x, L.y);
    ctx.scale(1, FIELD_VIEW.persp ? 0.42 : 0.6);
    ctx.strokeStyle = "rgba(255,210,63,0.95)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 13 * L.s * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,210,63,0.5)";
    ctx.beginPath();
    ctx.arc(0, 0, 7 * L.s * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // 그림자 — 높이 뜰수록 작고 옅게
  const sh = fproj(f.bx, f.by);
  const hk = Math.min(1, f.bh / 35);
  ctx.fillStyle = `rgba(0,0,0,${(0.4 - hk * 0.22).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(sh.x, sh.y, (4 - hk * 1.6) * sh.s, (2 - hk * 0.8) * sh.s, 0, 0, Math.PI * 2);
  ctx.fill();
  // 높이 막대: 그림자 ↔ 공 (얼마나 떠 있는지)
  if (flying) {
    const top = fproj(f.bx, f.by, f.bh);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(sh.x, sh.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.restore();
  }
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
  // 높이 뜰수록 카메라에 가까워 보이게 조금 크게 · 뜬 공은 둘레가 빛남
  const br = (4.3 + Math.min(5, f.bh * 0.16)) * b.s;
  if (flying) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(b.x, b.y, br * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 1;
  }
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(b.x, b.y, br, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export { BALL_R, HOME_POS, ZONE };
