/**
 * 픽셀 레이어 — 코드로 그린 그림(투수 뷰 사람 등)을 낮은 해상도에 그려서 픽셀 그림처럼 바꿈.
 * 반투명 가장자리 → 딱 자르고 · 1px 외곽선 · 색 단계 줄이기 → 화면엔 픽셀 그대로 키워서 (타석 · 수비 스프라이트와 화풍 맞춤)
 */
import { DH, DW } from "./view";

export class PixelLayer {
  private cv: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private w = 0;
  private h = 0;
  constructor(
    /** 한 픽셀 = 화면 몇 px */
    private px: number,
    private outline = [22, 18, 32] as [number, number, number],
  ) {}

  /** 그릴 판 (디자인 좌표 그대로 그리면 됨) */
  begin(): CanvasRenderingContext2D {
    const w = Math.round(DW / this.px);
    const h = Math.round(DH / this.px);
    if (!this.cv || this.w !== w || this.h !== h) {
      this.cv = document.createElement("canvas");
      this.cv.width = w;
      this.cv.height = h;
      this.g = this.cv.getContext("2d", { willReadFrequently: true })!;
      this.w = w;
      this.h = h;
    }
    const g = this.g!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(1 / this.px, 0, 0, 1 / this.px, 0, 0);
    return g;
  }

  /** 픽셀로 다듬어서 화면에 */
  end(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    const cv = this.cv;
    if (!g || !cv) return;
    const { w, h } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const id = g.getImageData(0, 0, w, h);
    const d = id.data;
    const solid = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const a = d[i + 3];
      if (a >= 110) {
        d[i + 3] = 255;
        // 색 단계 줄이기 (16단)
        d[i] = Math.round(d[i] / 17) * 17;
        d[i + 1] = Math.round(d[i + 1] / 17) * 17;
        d[i + 2] = Math.round(d[i + 2] / 17) * 17;
        solid[p] = 1;
      } else if (a > 24 && d[i] + d[i + 1] + d[i + 2] < 140) {
        // 그림자 (어두운 반투명) 는 한 단계 반투명으로 남김
        d[i + 3] = 92;
      } else d[i + 3] = 0;
    }
    const [or, og, ob] = this.outline;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (solid[p]) continue;
        if ((x > 0 && solid[p - 1]) || (x < w - 1 && solid[p + 1]) || (y > 0 && solid[p - w]) || (y < h - 1 && solid[p + w])) {
          const i = p * 4;
          d[i] = or;
          d[i + 1] = og;
          d[i + 2] = ob;
          d[i + 3] = 255;
        }
      }
    }
    g.putImageData(id, 0, 0);
    const sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, 0, 0, w, h, 0, 0, DW, DH);
    ctx.imageSmoothingEnabled = sm;
  }
}

/** 큰 캔버스(배경)를 픽셀 해상도로 줄인 사본 (캐시) */
const pxCache = new WeakMap<HTMLCanvasElement, { px: number; c: HTMLCanvasElement }>();
export function pixelated(src: HTMLCanvasElement, px: number): HTMLCanvasElement {
  const hit = pxCache.get(src);
  if (hit && hit.px === px) return hit.c;
  const c = document.createElement("canvas");
  c.width = Math.round(DW / px);
  c.height = Math.round(DH / px);
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, c.width, c.height);
  pxCache.set(src, { px, c });
  return c;
}
