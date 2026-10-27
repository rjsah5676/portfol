/**
 * 타석 타자 = 픽셀 스프라이트 (포즈 13장). 뼈 리그는 계산용으로만 남음.
 *
 * public/baseball/sprites/batter-v2.png — 프레임은 가로로, 층은 세로로:
 *   fixed(외곽선 · 신발 · 하이라이트) / team(상의 · 양말) / helm(헬멧) / skin / pants(바지 · 장갑) / dark(벨트) / bat
 *   색 층은 회색 명암(3단) → 팀색 · 원정/얼터 · 피부 · 배트색을 곱해서 칠함 (그림 한 벌로 모든 외형)
 * 원본: scripts/baseball-batter-3d.py — 3D 뼈대(타격 단계별 실제 자세 · IK)를 포수 뒤 카메라로 그려서 도트로
 * 그릴 땐 부드럽게 하지 않음 (도트 그대로).
 */
import { BAT_BUNT, BAT_LOAD, BAT_SWING } from "./figures";
import type { Anim } from "./rig";

const SRC = "/baseball/sprites/batter-v2.png";
const CW = 146;
const CH = 134;
const LAYERS = ["fixed", "team", "helm", "skin", "pants", "dark", "bat"] as const;
type TintLayer = Exclude<(typeof LAYERS)[number], "fixed">;

/** 프레임별 기준점: (ax, ay) = 발 사이 바닥 (모든 프레임 같은 자리 — 3D 로 그려서 몸이 실제로 움직인 만큼만 움직임) · 등번호 자리 · 배트 끝 (스윙 잔상) */
const FRAMES: { ax: number; ay: number; num?: [number, number]; tip: [number, number] }[] = [
  { ax: 66.0, ay: 117.0, tip: [53.2, 26.9] }, // 0 자세
  { ax: 66.0, ay: 117.0, tip: [58.6, 22.7] }, // 1 자세 (방망이 까딱)
  { ax: 66.0, ay: 117.0, tip: [56.9, 22.5] }, // 2 로드 (손 뒤로 · 체중 뒷발)
  { ax: 66.0, ay: 117.0, tip: [56.9, 22.5] }, // 3 스트라이드 (앞발 들기)
  { ax: 66.0, ay: 117.0, tip: [52.1, 27.1] }, // 4 앞발 착지 (손은 뒤에 — 기다리는 자세)
  { ax: 66.0, ay: 117.0, tip: [42.6, 43.2] }, // 5 골반 먼저 회전
  { ax: 66.0, ay: 117.0, tip: [51.1, 53.3] }, // 6 배트 래그 (손이 먼저, 배트는 뒤에)
  { ax: 66.0, ay: 117.0, num: [65, 66], tip: [135.5, 73.3] }, // 7 임팩트
  { ax: 66.0, ay: 117.0, num: [71, 66], tip: [117.1, 40.5] }, // 8 익스텐션 (팔 쭉)
  { ax: 66.0, ay: 117.0, num: [75, 65], tip: [11.8, 30.7] }, // 9 랩 (어깨 위로 감기)
  { ax: 66.0, ay: 117.0, num: [75, 65], tip: [9.9, 45.2] }, // 10 피니시
  { ax: 66.0, ay: 117.0, num: [62, 71], tip: [135.1, 52.4] }, // 11 번트
  { ax: 66.0, ay: 117.0, tip: [96.9, 123.4] }, // 12 쉬는 자세
];
/** 스프라이트 1px = 리그 단위 몇 (리그 키 178 ↔ 그림 키 126) */
export const SPRITE_UNIT = 4 / 3;
/** 리그 원점(골반) → 발바닥 */
export const FOOT_Y = 58;

export interface SpriteLook {
  team: string;
  helm: string;
  skin: string;
  pants: string;
  dark: string;
  bat: string;
  num?: string;
  /** 마타자 · 필살 전수: 테두리 빛 */
  glow?: string;
}

let img: HTMLImageElement | null = null;
function sheet() {
  if (!img && typeof Image !== "undefined") {
    img = new Image();
    img.src = SRC;
  }
  return img && img.complete && img.naturalWidth ? img : null;
}
export function preloadBatter(): Promise<void> {
  sheet();
  return new Promise((res) => {
    if (!img || (img.complete && img.naturalWidth)) return res();
    img.addEventListener("load", () => res(), { once: true });
    img.addEventListener("error", () => res(), { once: true });
  });
}

// 3×5 숫자
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001010010", "111101111101111", "111101111001111"];

const cache = new Map<string, HTMLCanvasElement>();
/** 외형 하나 = 10프레임 한 줄 캔버스 */
function strip(im: HTMLImageElement, lk: SpriteLook) {
  const key = `${lk.team}|${lk.helm}|${lk.skin}|${lk.pants}|${lk.dark}|${lk.bat}|${lk.num ?? ""}`;
  let c = cache.get(key);
  if (c) return c;
  const W = CW * FRAMES.length;
  c = document.createElement("canvas");
  c.width = W;
  c.height = CH;
  const x = c.getContext("2d")!;
  const t = document.createElement("canvas");
  t.width = W;
  t.height = CH;
  const tx = t.getContext("2d")!;
  LAYERS.forEach((l, i) => {
    if (l === "fixed") return;
    tx.globalCompositeOperation = "source-over";
    tx.clearRect(0, 0, W, CH);
    tx.drawImage(im, 0, i * CH, W, CH, 0, 0, W, CH);
    tx.globalCompositeOperation = "multiply";
    tx.fillStyle = lk[l as TintLayer];
    tx.fillRect(0, 0, W, CH);
    tx.globalCompositeOperation = "destination-in";
    tx.drawImage(im, 0, i * CH, W, CH, 0, 0, W, CH);
    x.drawImage(t, 0, 0);
  });
  x.drawImage(im, 0, 0, W, CH, 0, 0, W, CH);
  // 등번호 (도트)
  const num = (lk.num ?? "").slice(0, 2);
  if (num) {
    const px = (cx: number, cy: number, col: string) => {
      x.fillStyle = col;
      x.fillRect(cx, cy, 1, 1);
    };
    FRAMES.forEach((f, k) => {
      if (!f.num) return;
      const w = num.length * 4 - 1;
      const ox = k * CW + Math.round(f.num[0] - w / 2);
      const oy = f.num[1];
      const on = (dx: number, dy: number) => {
        const d = Math.floor(dx / 4);
        const cxi = dx % 4;
        if (d < 0 || d >= num.length || cxi > 2 || dy < 0 || dy > 4) return false;
        const g = DIGITS[+num[d]] ?? DIGITS[0];
        return g[dy * 3 + cxi] === "1";
      };
      // 테두리 → 글자
      for (let dy = -1; dy <= 5; dy++)
        for (let dx = -1; dx <= w; dx++) {
          if (on(dx, dy)) continue;
          if (on(dx - 1, dy) || on(dx + 1, dy) || on(dx, dy - 1) || on(dx, dy + 1)) px(ox + dx, oy + dy, lk.dark);
        }
      for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < w; dx++) if (on(dx, dy)) px(ox + dx, oy + dy, "#ffffff");
    });
  }
  cache.set(key, c);
  return c;
}

/** 스윙 잔상: 골반 회전(5) → 익스텐션(8) 배트 끝 궤적, 지금 프레임까지 · 뒤로 갈수록 흐리게 */
const TRAIL_FROM = 5;
const TRAIL_TO = 8;
function swoosh(ctx: CanvasRenderingContext2D, frame: number, k: number) {
  const pts = FRAMES.slice(TRAIL_FROM, Math.min(frame, TRAIL_TO) + 1).map((f) => [f.tip[0] - FRAMES[frame].ax, f.tip[1] - FRAMES[frame].ay]);
  // 프레임 하나 지난 뒤(팔로스루)엔 잔상이 사라지는 중
  const fade = frame > TRAIL_TO ? 0.45 : 1;
  if (pts.length < 2) return;
  // 점 사이를 부드럽게 (2차 곡선) 촘촘한 점으로
  const dense: number[][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], d = pts[Math.min(pts.length - 1, i + 2)];
    for (let t = 0; t < 1; t += 0.125) {
      const t2 = t * t, t3 = t2 * t;
      // 캣멀롬
      dense.push([0, 1].map((j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t3)));
    }
  }
  dense.push(pts[pts.length - 1]);
  // 리본 (뒤로 갈수록 가늘고 흐리게) — 한 번에 채워서 구슬처럼 안 보이게
  const n = dense.length;
  const L: number[][] = [], R: number[][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = dense[Math.max(0, i - 1)], p1 = dense[Math.min(n - 1, i + 1)];
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const w = 0.5 + 6 * (i / (n - 1)) ** 1.5;
    L.push([dense[i][0] - dy * w, dense[i][1] + dx * w]);
    R.push([dense[i][0] + dy * w, dense[i][1] - dx * w]);
  }
  const g = ctx.createLinearGradient(dense[0][0], dense[0][1], dense[n - 1][0], dense[n - 1][1]);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(1, `rgba(255,255,255,${0.55 * k * fade})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (const q of L) ctx.lineTo(q[0], q[1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 애니 + 시간 → 프레임 */
export function batterFrame(a: Anim, t: number): number {
  // 스윙: 0.07초에 임팩트 (SWING_HIT_T) — 골반 → 래그 → 임팩트 → 익스텐션 → 랩 → 피니시
  if (a === BAT_SWING) return t < 0.02 ? 5 : t < 0.045 ? 6 : t < 0.1 ? 7 : t < 0.16 ? 8 : t < 0.26 ? 9 : 10;
  // 투수 와인드업: 로드 → 앞발 들기 → 착지해서 기다림
  if (a === BAT_LOAD) return t < 0.12 ? 2 : t < 0.26 ? 3 : 4;
  if (a === BAT_BUNT) return 11;
  // 대기: 방망이 까딱
  return t % 1.6 < 0.8 ? 0 : 1;
}

/**
 * 그리기. (x, y) = 리그 원점(골반) 자리, sc = 리그 배율 (drawRig 와 같은 값) → 머리는 그 위, 발은 FOOT_Y 아래.
 * 그림이 아직 없으면 false (부르는 쪽이 코드 리그로 그림).
 */
export function drawBatter(ctx: CanvasRenderingContext2D, frame: number, lk: SpriteLook, x: number, y: number, sc: number, flip = false, trail = 0): boolean {
  const im = sheet();
  if (!im) return false;
  const f = FRAMES[frame] ?? FRAMES[0];
  const s = sc * SPRITE_UNIT;
  const src = strip(im, lk);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y + FOOT_Y * sc);
  ctx.scale(flip ? -s : s, s);
  if (trail > 0 && frame >= TRAIL_FROM + 1 && frame <= TRAIL_TO + 1) swoosh(ctx, frame, trail);
  if (lk.glow) {
    ctx.shadowColor = lk.glow;
    ctx.shadowBlur = 14;
  }
  ctx.drawImage(src, frame * CW, 0, CW, CH, -f.ax, -f.ay, CW, CH);
  ctx.restore();
  return true;
}
