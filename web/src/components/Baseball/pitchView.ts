/**
 * 투수 뷰 — 내가 던질 때 보는 화면 (온라인 · 연습 경기 수비 · 투수 육성).
 *
 * 구도: TV 중계 외야(중견수 쪽) 카메라 = 투수 등 뒤 멀리서 망원으로. 투수는 화면 아래 한쪽(타자 반대쪽)에 크게 뒷모습,
 * 가운데 위쪽에 홈플레이트 · 타자 · 포수 · 심판, 그 위에 스트라이크 존 9칸. 마구마구 · 컴프야 · MLB The Show 투수 시점 공통 구도.
 * 에셋 없이 코드 도형 (나중에 그림으로 바꾸기 쉽게 그리기 함수만 따로).
 *
 * 좌표 (월드, m): x = 포수 기준 오른쪽(1루 쪽) +, h = 높이, z = 홈에서 투수 쪽으로 + (투수판 18.4).
 * 이 시점에선 좌우가 뒤집혀 보임 (1루 쪽 = 화면 왼쪽). 우타자는 화면 오른쪽에 섬.
 */
import type { RigColors } from "@/lib/baseball/rig";
import { BALL_R, ZONE } from "@/lib/baseball/pitch";
import { DH, DW } from "./view";

export interface PvCam {
  /** 카메라 옆 위치 (m) — 투수가 타자 반대쪽 화면 아래에 오게 */
  xc: number;
  F: number;
  camZ: number;
  camH: number;
  Y0: number;
  cx: number;
}

/**
 * 카메라: 투수판 뒤 68m · 높이 4.4m 망원 (플레이트에서 1m = 205px → 존 폭 ≈ 100px, 투수에서 1m = 260px).
 * 플레이트 바닥 = 화면 y 412, 투수 발 ≈ 화면 아래 끝. 투수는 화면 왼쪽 아래 (카메라를 3루 쪽 −x 로).
 */
export function pvCam(lefty: boolean): PvCam {
  const camZ = 18.4 + 68;
  const sPlate = 205;
  const camH = 4.4;
  // 투수는 늘 화면 왼쪽 (오른쪽엔 구종 · 던지기 버튼) — 좌타자는 왼쪽 타석이라 투수를 더 바깥으로
  return { xc: lefty ? -5.6 : -3.6, F: sPlate * camZ, camZ, camH, Y0: 412 - camH * sPlate, cx: DW / 2 };
}

export function pvProj(c: PvCam, x: number, h: number, z: number) {
  const s = c.F / Math.max(1, c.camZ - z);
  const sp = c.F / c.camZ;
  return { x: c.cx + (c.xc - x) * s - c.xc * sp, y: c.Y0 - (h - c.camH) * s, s };
}

/** 화면 → 플레이트 면(z = 0) 위 자리 (조준용) */
export function pvUnproj(c: PvCam, sx: number, sy: number) {
  const s = c.F / c.camZ;
  return { x: -(sx - c.cx) / s, y: c.camH - (sy - c.Y0) / s };
}

// ───────────── 배경 (캐시) ─────────────
let bg: HTMLCanvasElement | null = null;
let bgKey = "";

export function pvBackground(c: PvCam, q: number, night: boolean): HTMLCanvasElement {
  const key = `${q}:${night}:${c.xc}`;
  if (bg && bgKey === key) return bg;
  const cv = document.createElement("canvas");
  cv.width = Math.round(DW * q);
  cv.height = Math.round(DH * q);
  const g = cv.getContext("2d")!;
  g.scale(q, q);
  const P = (x: number, z: number, h = 0) => pvProj(c, x, h, z);

  // 하늘
  const sky = g.createLinearGradient(0, 0, 0, 140);
  if (night) {
    sky.addColorStop(0, "#070b1d");
    sky.addColorStop(1, "#1b2350");
  } else {
    sky.addColorStop(0, "#3f6fb8");
    sky.addColorStop(1, "#f2a46b");
  }
  g.fillStyle = sky;
  g.fillRect(0, 0, DW, 150);
  // 조명탑
  for (const lx of [90, 934]) {
    g.fillStyle = "#2a3048";
    g.fillRect(lx - 3, 8, 6, 70);
    g.fillStyle = night ? "#fffbe0" : "#f5f1da";
    g.shadowColor = night ? "rgba(255,250,210,0.9)" : "transparent";
    g.shadowBlur = night ? 24 : 0;
    g.fillRect(lx - 26, 4, 52, 16);
    g.shadowBlur = 0;
  }
  // 홈 뒤 관중석 (위로 층층이) — 홈플레이트 뒤쪽 = 화면 위
  const standTop = 40;
  const standBot = 210;
  const st = g.createLinearGradient(0, standTop, 0, standBot);
  st.addColorStop(0, night ? "#151a33" : "#2f3757");
  st.addColorStop(1, night ? "#232b4f" : "#424b70");
  g.fillStyle = st;
  g.fillRect(0, standTop, DW, standBot - standTop);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const cols = ["#f4d35e", "#ee6352", "#59cd90", "#3fa7d6", "#fac05e", "#f79d84", "#ffffff", "#c8a2ff", "#ff7a3d"];
  for (let r = 0; r < 26; r++) {
    const yy = standTop + 6 + r * 6.2;
    for (let x = 0; x < DW; x += 5 + (r % 3)) {
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      g.globalAlpha = 0.35 + rnd() * 0.35;
      g.fillRect(x + rnd() * 2, yy + rnd() * 2, 2.6, 3);
    }
  }
  g.globalAlpha = 1;
  // 백스톱 벽 (홈 뒤 그물 아래 패딩)
  const wallY = P(0, -18).y;
  g.fillStyle = night ? "#1b4a3a" : "#1f5c47";
  g.fillRect(0, standBot - 4, DW, wallY - standBot + 4);
  g.fillStyle = "rgba(255,255,255,0.08)";
  for (let x = 0; x < DW; x += 64) g.fillRect(x, standBot - 4, 2, wallY - standBot + 4);
  // 그물 (백스톱)
  g.strokeStyle = "rgba(255,255,255,0.07)";
  g.lineWidth = 1;
  for (let x = -40; x < DW + 40; x += 9) {
    g.beginPath();
    g.moveTo(x, standTop);
    g.lineTo(x + 30, standBot);
    g.stroke();
  }

  // 그라운드 (잔디) — 줄무늬
  const gy0 = wallY;
  const grass = g.createLinearGradient(0, gy0, 0, DH);
  grass.addColorStop(0, night ? "#1f5a2c" : "#2f7d3a");
  grass.addColorStop(1, night ? "#2a7236" : "#3c9a48");
  g.fillStyle = grass;
  g.fillRect(0, gy0, DW, DH - gy0);
  for (let i = 0; i < 12; i++) {
    const z0 = -18 + i * 9;
    const a = P(0, z0).y;
    const b = P(0, z0 + 4.5).y;
    g.fillStyle = "rgba(255,255,255,0.035)";
    g.fillRect(0, Math.min(a, b), DW, Math.abs(a - b));
  }

  // 흙: 홈 주변 원 (반지름 4m) · 파울라인 따라 · 마운드 (반지름 2.7m)
  const dirt = night ? "#7a5435" : "#a8714a";
  const ell = (cx: number, cz: number, r: number) => {
    g.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const p = P(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      if (i) g.lineTo(p.x, p.y);
      else g.moveTo(p.x, p.y);
    }
    g.closePath();
  };
  // 내야 흙 (홈에서 27m 정도 부채꼴) — 화면 아래로 퍼짐
  g.fillStyle = night ? "#6d4a2f" : "#9a6742";
  g.beginPath();
  {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = -Math.PI / 4 + (i / 40) * (Math.PI / 2);
      pts.push(P(Math.sin(a) * 29, Math.cos(a) * 29));
    }
    const h0 = P(0, -1);
    g.moveTo(h0.x, h0.y);
    for (const p of pts) g.lineTo(p.x, p.y);
    g.closePath();
    g.fill();
  }
  // 내야 잔디 (안쪽 네모)
  g.fillStyle = night ? "#235f30" : "#358a41";
  g.beginPath();
  for (const [x, z] of [[0, 2.5], [17.5, 19.4], [0, 36.3], [-17.5, 19.4]] as const) {
    const p = P(x, z);
    if (x === 0 && z === 2.5) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
  }
  g.closePath();
  g.fill();
  g.fillStyle = dirt;
  ell(0, 0, 4);
  g.fill();
  ell(0, 18.4, 2.7);
  g.fill();
  // 마운드 그림자 · 투수판
  const r0 = P(-0.3, 18.4);
  const r1 = P(0.3, 18.4);
  g.fillStyle = "#f3f0e6";
  g.fillRect(Math.min(r0.x, r1.x), r0.y - 3, Math.abs(r1.x - r0.x), 6);

  // 파울라인 (홈에서 1루 · 3루 쪽으로)
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 2;
  for (const sgn of [-1, 1]) {
    const a = P(0, 0);
    const b = P(sgn * 30, 30);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  // 타석 · 포수석 선
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.lineWidth = 1.6;
  const box = (x0: number, x1: number, z0: number, z1: number) => {
    const a = P(x0, z0);
    const b = P(x1, z0);
    const cc = P(x1, z1);
    const d = P(x0, z1);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.lineTo(cc.x, cc.y);
    g.lineTo(d.x, d.y);
    g.closePath();
    g.stroke();
  };
  box(0.37, 1.59, -0.9, 0.9);
  box(-1.59, -0.37, -0.9, 0.9);
  // 홈플레이트 (오각형, 뾰족한 쪽이 포수 쪽)
  g.fillStyle = "#f6f4ee";
  g.beginPath();
  for (const [x, z] of [[-0.215, 0.215], [0.215, 0.215], [0.215, 0], [0, -0.215], [-0.215, 0]] as const) {
    const p = P(x, z);
    if (x === -0.215 && z === 0.215) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
  }
  g.closePath();
  g.fill();
  bg = cv;
  bgKey = key;
  return cv;
}

// ───────────── 사람들 (코드 도형) ─────────────
const rr = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
};

/** 그림자 (발밑 타원) */
function shadow(g: CanvasRenderingContext2D, x: number, y: number, w: number) {
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.beginPath();
  g.ellipse(x, y, w, w * 0.22, 0, 0, Math.PI * 2);
  g.fill();
}

/** 심판: 포수 뒤에서 허리 숙여 지켜봄 (남색 셔츠 · 회색 바지 · 검은 마스크) — 포수 어깨 너머로 머리 · 어깨만 보임 */
export function drawUmpire(g: CanvasRenderingContext2D, c: PvCam, side: number) {
  const p = pvProj(c, side * 0.32, 0, -1.9);
  const s = p.s;
  shadow(g, p.x, p.y, 0.38 * s);
  // 무릎 굽혀 허리 숙인 자세 (머리가 포수 머리 바로 위로 보일 만큼만)
  g.fillStyle = "#6b7184";
  rr(g, p.x - 0.24 * s, p.y - 0.58 * s, 0.2 * s, 0.56 * s, 0.06 * s);
  rr(g, p.x + 0.04 * s, p.y - 0.58 * s, 0.2 * s, 0.56 * s, 0.06 * s);
  g.fillStyle = "#1e2740";
  rr(g, p.x - 0.3 * s, p.y - 1.06 * s, 0.6 * s, 0.54 * s, 0.16 * s);
  g.fillStyle = "#151b2e";
  rr(g, p.x - 0.33 * s, p.y - 1.02 * s, 0.14 * s, 0.38 * s, 0.06 * s);
  rr(g, p.x + 0.19 * s, p.y - 1.02 * s, 0.14 * s, 0.38 * s, 0.06 * s);
  const hy = p.y - 1.17 * s;
  g.fillStyle = "#e3b48f";
  g.beginPath();
  g.arc(p.x, hy, 0.12 * s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#11141f";
  g.beginPath();
  g.arc(p.x, hy - 0.03 * s, 0.125 * s, Math.PI, 0);
  g.fill();
  rr(g, p.x - 0.1 * s, hy - 0.02 * s, 0.2 * s, 0.15 * s, 0.04 * s);
  g.strokeStyle = "rgba(170,175,190,0.55)";
  g.lineWidth = Math.max(1, 0.012 * s);
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(p.x - 0.09 * s, hy + (0.02 + i * 0.04) * s);
    g.lineTo(p.x + 0.09 * s, hy + (0.02 + i * 0.04) * s);
    g.stroke();
  }
}

/**
 * 포수: 플레이트 뒤에 쪼그려 앉아 미트를 목표(내가 조준한 자리)에 댐. mitt = 미트 위치 (월드 x, h)
 */
export function drawCatcher(g: CanvasRenderingContext2D, c: PvCam, col: RigColors, mitt: { x: number; h: number }) {
  const p = pvProj(c, 0, 0, -0.8);
  const s = p.s;
  shadow(g, p.x, p.y, 0.45 * s);
  // 쪼그린 다리: 허벅지(옆으로 벌림) + 정강이 보호대 (카메라 쪽)
  g.fillStyle = col.pants;
  rr(g, p.x - 0.42 * s, p.y - 0.5 * s, 0.3 * s, 0.24 * s, 0.1 * s);
  rr(g, p.x + 0.12 * s, p.y - 0.5 * s, 0.3 * s, 0.24 * s, 0.1 * s);
  g.fillStyle = "#2a3048";
  rr(g, p.x - 0.36 * s, p.y - 0.4 * s, 0.18 * s, 0.4 * s, 0.06 * s);
  rr(g, p.x + 0.18 * s, p.y - 0.4 * s, 0.18 * s, 0.4 * s, 0.06 * s);
  g.fillStyle = "rgba(255,255,255,0.12)";
  g.fillRect(p.x - 0.3 * s, p.y - 0.36 * s, 0.05 * s, 0.32 * s);
  g.fillRect(p.x + 0.24 * s, p.y - 0.36 * s, 0.05 * s, 0.32 * s);
  // 몸 · 가슴 보호대
  g.fillStyle = col.team;
  rr(g, p.x - 0.28 * s, p.y - 0.92 * s, 0.56 * s, 0.5 * s, 0.14 * s);
  g.fillStyle = "#232a40";
  rr(g, p.x - 0.19 * s, p.y - 0.88 * s, 0.38 * s, 0.42 * s, 0.1 * s);
  g.fillStyle = "rgba(255,255,255,0.1)";
  for (let i = 0; i < 3; i++) g.fillRect(p.x - 0.15 * s, p.y - (0.8 - i * 0.12) * s, 0.3 * s, 0.025 * s);
  // 오른손(맨손)은 허벅지 뒤 · 왼팔은 미트로
  // 머리 (헬멧 + 마스크)
  const hy = p.y - 1.04 * s;
  g.fillStyle = col.dark;
  g.beginPath();
  g.arc(p.x, hy, 0.15 * s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#1a1e2c";
  rr(g, p.x - 0.12 * s, hy - 0.04 * s, 0.24 * s, 0.19 * s, 0.05 * s);
  g.strokeStyle = "rgba(205,210,225,0.65)";
  g.lineWidth = Math.max(1, 0.014 * s);
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(p.x - 0.1 * s, hy + (0.0 + i * 0.05) * s);
    g.lineTo(p.x + 0.1 * s, hy + (0.0 + i * 0.05) * s);
    g.stroke();
  }
  // 미트 (목표 자리) + 팔
  const m = pvProj(c, mitt.x, mitt.h, -0.4);
  const shx = p.x + 0.2 * s;
  g.strokeStyle = col.team;
  g.lineWidth = 0.1 * s;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(shx, p.y - 0.84 * s);
  g.lineTo((shx + m.x) / 2, (p.y - 0.84 * s + m.y) / 2 + 0.04 * s);
  g.lineTo(m.x, m.y + 0.06 * s);
  g.stroke();
  g.fillStyle = "#6e4122";
  g.beginPath();
  g.ellipse(m.x, m.y, 0.12 * s, 0.13 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#9b5f33";
  g.beginPath();
  g.ellipse(m.x, m.y, 0.075 * s, 0.085 * s, 0, 0, Math.PI * 2);
  g.fill();
}

export type PvBatPose = { kind: "idle" | "load" | "swing" | "bunt"; t: number };

/**
 * 타자 (앞 · 옆모습): 플레이트 쪽을 보고 섬. 우타자 = 화면 오른쪽에서 왼쪽을 봄.
 * swing: 0.15초에 임팩트(배트가 플레이트 앞을 가로지름) → 팔로스루
 */
export function drawPvBatter(
  g: CanvasRenderingContext2D,
  c: PvCam,
  col: RigColors,
  bat: string,
  lefty: boolean,
  pose: PvBatPose,
  hitT: number
) {
  const wx = lefty ? 0.78 : -0.78;
  const p = pvProj(c, wx, 0, 0.05);
  const s = p.s;
  // 우타자: 화면 왼쪽(플레이트)을 봄 → face = -1
  const face = lefty ? 1 : -1;
  const H = 1.3;
  shadow(g, p.x, p.y, 0.42 * s);
  // 레그킥: 앞발(투수 쪽 = 카메라 쪽, 플레이트 쪽으로 살짝) 들어 올림
  const kick = pose.kind === "load" ? Math.min(1, Math.max(0, (pose.t - 0.95) / 0.35)) * (pose.t < 4.9 ? 1 : 0) : 0;
  const swingT = pose.kind === "swing" ? pose.t : -1;
  const turn = swingT < 0 ? 0 : Math.min(1, swingT / hitT); // 몸 돌기 (임팩트까지)
  // 다리
  const legW = 0.13 * s;
  g.fillStyle = col.pants;
  const backX = p.x - face * 0.16 * s;
  const frontX = p.x + face * (0.2 + turn * 0.06) * s;
  rr(g, backX - legW / 2, p.y - 0.6 * s, legW, 0.55 * s, 0.05 * s);
  rr(g, frontX - legW / 2, p.y - (0.6 + kick * 0.18) * s, legW, (0.55 - kick * 0.12) * s, 0.05 * s);
  g.fillStyle = col.dark;
  rr(g, backX - legW / 2, p.y - 0.2 * s, legW, 0.16 * s, 0.03 * s);
  rr(g, frontX - legW / 2, p.y - (0.2 + kick * 0.18) * s, legW, 0.16 * s, 0.03 * s);
  g.fillStyle = "#15161c";
  rr(g, backX - legW * 0.7, p.y - 0.06 * s, legW * 1.4, 0.07 * s, 0.03 * s);
  rr(g, frontX - legW * 0.7, p.y - (0.06 + kick * 0.18) * s, legW * 1.4, 0.07 * s, 0.03 * s);
  // 몸통 (돌면서 넓어짐 = 가슴이 투수 쪽으로)
  const bw = (0.3 + turn * 0.12) * s;
  const tx = p.x + face * turn * 0.04 * s;
  g.fillStyle = "#f2f2f4";
  rr(g, tx - bw / 2, p.y - 1.02 * s, bw, 0.46 * s, 0.1 * s);
  g.fillStyle = col.team;
  rr(g, tx - bw / 2, p.y - 1.02 * s, bw, 0.12 * s, 0.06 * s);
  g.fillStyle = "#2a2a33";
  g.fillRect(tx - bw / 2, p.y - 0.6 * s, bw, 0.04 * s);
  // 머리 · 헬멧 (귀덮개는 투수 쪽)
  const hx = tx + face * 0.02 * s;
  const hy = p.y - (H - 0.16) * s;
  g.fillStyle = col.skin;
  g.beginPath();
  g.arc(hx, hy + 0.04 * s, 0.13 * s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = col.team;
  g.beginPath();
  g.arc(hx, hy, 0.15 * s, Math.PI, 0);
  g.fill();
  rr(g, hx + face * 0.02 * s - 0.17 * s * (face < 0 ? 1 : 0), hy - 0.01 * s, 0.17 * s, 0.05 * s, 0.02 * s);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.beginPath();
  g.arc(hx - face * 0.05 * s, hy - 0.08 * s, 0.03 * s, 0, Math.PI * 2);
  g.fill();
  // 배트: 가짜 3D — φ = 수평 회전(0 = 플레이트 반대쪽 = 등 뒤, 90° = 카메라(투수) 쪽, 180° = 플레이트 쪽),
  // e = 들린 각. 화면엔 수평 성분 cos φ · cos e 와 높이 sin e 만 보임 (카메라 쪽을 가리킬 땐 짧아 보임)
  const hand = { x: tx - face * 0.1 * s, y: p.y - 0.95 * s };
  let phi = 0;
  let el = 0.96;
  if (pose.kind === "bunt") {
    phi = Math.PI * 0.5;
    el = 0.05;
    hand.x = tx + face * 0.12 * s;
    hand.y = p.y - 0.85 * s;
  } else if (swingT >= 0) {
    const k1 = Math.min(1, swingT / hitT);
    const k2 = Math.min(1, Math.max(0, (swingT - hitT) / 0.3));
    const e1 = k1 * k1;
    const e2 = 1 - (1 - k2) * (1 - k2);
    phi = swingT <= hitT ? Math.PI * e1 : Math.PI + Math.PI * 0.7 * e2;
    el = swingT <= hitT ? 0.96 - 1.05 * e1 : -0.09 + 0.85 * e2;
    hand.x = tx + face * (-0.1 + 0.26 * k1 - 0.1 * k2) * s;
    hand.y = p.y - (0.95 - 0.13 * k1 + 0.15 * k2) * s;
  }
  const L = 0.82 * s;
  const vx = Math.cos(phi) * -face * Math.cos(el);
  const vy = -Math.sin(el);
  g.strokeStyle = bat;
  g.lineCap = "round";
  g.lineWidth = 0.055 * s;
  g.beginPath();
  g.moveTo(hand.x, hand.y);
  g.lineTo(hand.x + vx * L, hand.y + vy * L);
  g.stroke();
  g.lineWidth = 0.075 * s;
  g.beginPath();
  g.moveTo(hand.x + vx * L * 0.55, hand.y + vy * L * 0.55);
  g.lineTo(hand.x + vx * L, hand.y + vy * L);
  g.stroke();
  // 팔 (어깨 → 손)
  g.strokeStyle = col.skin;
  g.lineWidth = 0.08 * s;
  g.beginPath();
  g.moveTo(tx + face * 0.12 * s, p.y - 0.96 * s);
  g.lineTo(hand.x, hand.y);
  g.moveTo(tx - face * 0.12 * s, p.y - 0.96 * s);
  g.lineTo(hand.x, hand.y);
  g.stroke();
  g.fillStyle = "#f4f4f4";
  g.beginPath();
  g.arc(hand.x, hand.y, 0.05 * s, 0, Math.PI * 2);
  g.fill();
}

/**
 * 투수 뒷모습 (내 투수). t = 와인드업 시계 (PITCH_RELEASE_T 에 놓음), rel = 놓는 시각.
 * 세트 → 다리 들기(최고점 0.45) → 내딛기(착지 0.95) → 팔 휘두르기(놓기) → 팔로스루. 돌아온 손 자리를 돌려줌 (공 출발점)
 */
export function drawPvPitcher(g: CanvasRenderingContext2D, c: PvCam, col: RigColors, lefty: boolean, t: number, throwing: boolean, rel: number) {
  const sm = (a: number, b: number, x: number) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  const T = throwing ? t : 0;
  const lift = sm(0.05, 0.45, T) * (1 - sm(0.55, 0.95, T));
  const stride = sm(0.45, 0.95, T);
  const fol = sm(rel, rel + 0.35, T);
  const p = pvProj(c, 0, 0.25, 18.4 - stride * 1.1);
  const s = p.s;
  // 뒤에서 본 좌우: 우투수의 오른팔 = 화면 오른쪽 (등 뒤에서 보니 그대로)
  const R = lefty ? -1 : 1;
  const H = 1.3;
  const lean = fol * 0.16;
  shadow(g, p.x, p.y, 0.46 * s);
  // 다리: 디딤발(우투 왼발 = 화면 왼쪽) 들기 · 내딛기, 축발(오른발)은 팔로스루 때 뒤로 들림
  const legW = 0.15 * s;
  const fx = p.x - R * (0.16 + stride * 0.06) * s;
  const bx = p.x + R * 0.15 * s;
  const backUp = fol * 0.3;
  g.fillStyle = col.pants;
  rr(g, bx - legW / 2, p.y - (0.62 - backUp * 0.4) * s, legW, (0.6 - backUp * 0.3) * s, 0.06 * s);
  rr(g, fx - legW / 2, p.y - (0.62 + lift * 0.3) * s, legW, (0.6 - lift * 0.22) * s, 0.06 * s);
  g.fillStyle = col.dark;
  rr(g, bx - legW / 2, p.y - (0.22 - backUp * 0.6) * s, legW, 0.17 * s, 0.04 * s);
  rr(g, fx - legW / 2, p.y - (0.22 + lift * 0.3) * s, legW, 0.17 * s, 0.04 * s);
  g.fillStyle = "#15161c";
  rr(g, bx - legW * 0.65, p.y - (0.07 - backUp * 0.6) * s, legW * 1.3, 0.08 * s, 0.03 * s);
  rr(g, fx - legW * 0.65, p.y - (0.07 + lift * 0.3) * s, legW * 1.3, 0.08 * s, 0.03 * s);
  // 몸통 위치 (팔로스루 땐 앞으로 숙여 낮아짐)
  const tw = 0.42 * s;
  const ty = p.y - (1.05 - lean * 0.5) * s;
  const shY = ty + 0.07 * s;
  // 팔: 어깨 기준 손 자리 키프레임 (s 단위, x 는 R 곱함 = 우투 기준 오른쪽 +)
  const key = (ks: [number, number, number][]) => {
    let i = 0;
    while (i < ks.length - 2 && T > ks[i + 1][0]) i++;
    const [t0, x0, y0] = ks[i];
    const [t1, x1, y1] = ks[i + 1];
    const u = sm(t0, t1, T);
    return { x: p.x + R * (x0 + (x1 - x0) * u) * s, y: shY + (y0 + (y1 - y0) * u) * s };
  };
  const arm = (sx: number, hnd: { x: number; y: number }) => {
    const ex = (sx + hnd.x) / 2 + (hnd.x > sx ? 0.05 : -0.05) * s;
    const ey = (shY + hnd.y) / 2 + 0.04 * s;
    g.lineCap = "round";
    g.strokeStyle = col.team;
    g.lineWidth = 0.1 * s;
    g.beginPath();
    g.moveTo(sx, shY);
    g.lineTo(ex, ey);
    g.stroke();
    g.strokeStyle = col.skin;
    g.lineWidth = 0.08 * s;
    g.beginPath();
    g.moveTo(ex, ey);
    g.lineTo(hnd.x, hnd.y);
    g.stroke();
  };
  // 글러브 팔 (우투 = 화면 왼쪽): 가슴 → 내딛으며 앞(왼쪽)으로 뻗음 → 당겨 옴
  const gl = key([
    [0, -0.06, 0.16],
    [0.45, -0.06, 0.18],
    [0.9, -0.48, 0.04],
    [rel, -0.3, 0.12],
    [rel + 0.4, -0.18, 0.1],
  ]);
  // 던지는 팔 (화면 오른쪽): 가슴 → 아래 뒤로 → 머리 뒤 위(코킹) → 머리 위에서 놓기 → 반대편 무릎 쪽으로 감김
  const hd = key([
    [0, 0.06, 0.16],
    [0.45, 0.08, 0.2],
    [0.75, 0.48, 0.24],
    [0.95, 0.42, -0.34],
    [rel, 0.14, -0.58],
    [rel + 0.14, -0.12, 0.1],
    [rel + 0.4, -0.36, 0.48],
  ]);
  const glShown = T > 0.6 && T < rel + 0.15;
  const hdShown = T > 0.55 && T < rel + 0.08;
  const drawGl = () => {
    arm(p.x - R * 0.19 * s, gl);
    g.fillStyle = "#6e4122";
    g.beginPath();
    g.arc(gl.x, gl.y, 0.09 * s, 0, Math.PI * 2);
    g.fill();
  };
  // 등 뒤에서 보니 가슴 앞 손은 몸에 가려짐 → 몸통보다 먼저
  if (!glShown) drawGl();
  if (!hdShown) arm(p.x + R * 0.2 * s, hd);
  // 몸통 (등번호 · 이름)
  g.fillStyle = col.team;
  rr(g, p.x - tw / 2, ty, tw, 0.46 * s, 0.12 * s);
  g.fillStyle = "rgba(0,0,0,0.14)";
  rr(g, p.x - tw / 2, ty + 0.36 * s, tw, 0.1 * s, 0.05 * s);
  g.fillStyle = "#1d1d26";
  g.fillRect(p.x - tw / 2, ty + 0.42 * s, tw, 0.035 * s);
  g.fillStyle = "rgba(255,255,255,0.94)";
  g.font = `${Math.round(0.2 * s)}px "Black Han Sans", sans-serif`;
  g.textAlign = "center";
  g.fillText(col.num ?? "", p.x, ty + 0.31 * s);
  if (col.name) {
    g.font = `700 ${Math.max(8, Math.round(0.052 * s))}px "Nanum Gothic", sans-serif`;
    g.fillText(col.name, p.x, ty + 0.1 * s);
  }
  // 머리 (뒷머리 + 모자)
  const hy = p.y - (H - 0.13 - lean) * s;
  g.fillStyle = col.skin;
  rr(g, p.x - 0.05 * s, hy + 0.08 * s, 0.1 * s, 0.08 * s, 0.03 * s);
  // 뒷머리 (모자 아래로 조금) · 귀
  g.fillStyle = col.hair;
  g.beginPath();
  g.ellipse(p.x, hy + 0.05 * s, 0.13 * s, 0.1 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = col.skin;
  g.beginPath();
  g.arc(p.x - 0.135 * s, hy + 0.04 * s, 0.03 * s, 0, Math.PI * 2);
  g.arc(p.x + 0.135 * s, hy + 0.04 * s, 0.03 * s, 0, Math.PI * 2);
  g.fill();
  // 모자 (뒤에서: 둥근 머리 덮개 + 뒤 조절끈 구멍)
  g.fillStyle = col.team;
  g.beginPath();
  g.ellipse(p.x, hy - 0.01 * s, 0.15 * s, 0.13 * s, 0, Math.PI, 0);
  g.lineTo(p.x + 0.15 * s, hy + 0.03 * s);
  g.lineTo(p.x - 0.15 * s, hy + 0.03 * s);
  g.closePath();
  g.fill();
  g.fillStyle = col.hair;
  rr(g, p.x - 0.035 * s, hy - 0.0 * s, 0.07 * s, 0.035 * s, 0.015 * s);
  g.fillStyle = "rgba(255,255,255,0.22)";
  g.beginPath();
  g.ellipse(p.x - 0.05 * s, hy - 0.08 * s, 0.04 * s, 0.025 * s, -0.4, 0, Math.PI * 2);
  g.fill();
  if (glShown) drawGl();
  if (hdShown) arm(p.x + R * 0.2 * s, hd);
  return hd;
}

/** 스트라이크 존 9칸 (투수 뷰, 플레이트 위) */
export function drawPvZone(g: CanvasRenderingContext2D, c: PvCam, a: number) {
  const tl = pvProj(c, ZONE.x + BALL_R * 0, ZONE.y1, 0);
  const br = pvProj(c, -ZONE.x, ZONE.y0, 0);
  const x0 = Math.min(tl.x, br.x);
  const x1 = Math.max(tl.x, br.x);
  g.fillStyle = `rgba(10,14,30,${0.18 * a})`;
  g.fillRect(x0, tl.y, x1 - x0, br.y - tl.y);
  g.strokeStyle = `rgba(255,255,255,${0.75 * a})`;
  g.lineWidth = 2;
  g.strokeRect(x0, tl.y, x1 - x0, br.y - tl.y);
  g.strokeStyle = `rgba(255,255,255,${0.28 * a})`;
  g.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    const x = x0 + ((x1 - x0) * i) / 3;
    const y = tl.y + ((br.y - tl.y) * i) / 3;
    g.beginPath();
    g.moveTo(x, tl.y);
    g.lineTo(x, br.y);
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
  }
  return { x0, x1, y0: tl.y, y1: br.y };
}
