/**
 * 타석 타자 = 픽셀 스프라이트 (포즈별 통짜 그림 10장). 뼈 리그는 계산용으로만 남음.
 *
 * public/baseball/sprites/batter-v1.png — 프레임은 가로로, 층은 세로로:
 *   fixed(외곽선 · 신발 · 하이라이트) / team(상의 · 양말) / helm(헬멧) / skin / pants(바지 · 장갑) / dark(벨트) / bat
 *   색 층은 회색 명암(3단) → 팀색 · 원정/얼터 · 피부 · 배트색을 곱해서 칠함 (그림 한 벌로 모든 외형)
 * 원본: 지피티 시트(5칸×2줄) → scripts/baseball-batter-sprite.py
 * 그릴 땐 부드럽게 하지 않음 (도트 그대로).
 */
import { BAT_BUNT, BAT_LOAD, BAT_SWING } from "./figures";
import type { Anim } from "./rig";

const SRC = "/baseball/sprites/batter-v1.png";
const CW = 106;
const CH = 177;
const LAYERS = ["fixed", "team", "helm", "skin", "pants", "dark", "bat"] as const;
type TintLayer = Exclude<(typeof LAYERS)[number], "fixed">;

/** 프레임별 기준점: x = 헬멧 가운데(머리는 스윙 내내 제자리), y = 발바닥 · 등번호 자리 */
const FRAMES: { ax: number; ay: number; num?: [number, number] }[] = [
  { ax: 62.6, ay: 166, num: [53, 94] }, // 0 자세
  { ax: 63.4, ay: 166, num: [53, 95] }, // 1 자세 (방망이 까딱)
  { ax: 61.4, ay: 166, num: [49, 95] }, // 2 다리 들기
  { ax: 57.2, ay: 166, num: [48, 96] }, // 3 내딛기
  { ax: 60.7, ay: 167, num: [50, 97] }, // 4 스윙 시작
  { ax: 39.9, ay: 147 }, // 5 맞는 순간
  { ax: 35.8, ay: 148 }, // 6 밀어내기
  { ax: 68.1, ay: 151 }, // 7 팔로스루
  { ax: 56.9, ay: 148 }, // 8 번트
  { ax: 57.0, ay: 153, num: [54, 68] }, // 9 쉬는 자세
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

/** 애니 + 시간 → 프레임 */
export function batterFrame(a: Anim, t: number): number {
  if (a === BAT_SWING) return t < 0.025 ? 3 : t < 0.05 ? 4 : t < 0.11 ? 5 : t < 0.2 ? 6 : 7;
  if (a === BAT_LOAD) return t < 0.1 ? 0 : 2;
  if (a === BAT_BUNT) return 8;
  // 대기: 방망이 까딱
  return t % 1.6 < 0.8 ? 0 : 1;
}

/**
 * 그리기. (x, y) = 리그 원점(골반) 자리, sc = 리그 배율 (drawRig 와 같은 값) → 머리는 그 위, 발은 FOOT_Y 아래.
 * 그림이 아직 없으면 false (부르는 쪽이 코드 리그로 그림).
 */
export function drawBatter(ctx: CanvasRenderingContext2D, frame: number, lk: SpriteLook, x: number, y: number, sc: number, flip = false): boolean {
  const im = sheet();
  if (!im) return false;
  const f = FRAMES[frame] ?? FRAMES[0];
  const s = sc * SPRITE_UNIT;
  const src = strip(im, lk);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y + FOOT_Y * sc);
  ctx.scale(flip ? -s : s, s);
  if (lk.glow) {
    ctx.shadowColor = lk.glow;
    ctx.shadowBlur = 14;
  }
  ctx.drawImage(src, frame * CW, 0, CW, CH, -f.ax, -f.ay, CW, CH);
  ctx.restore();
  return true;
}
