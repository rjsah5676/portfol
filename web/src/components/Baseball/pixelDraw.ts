/**
 * 픽셀 격자에 맞춘 도형 (필드 화면 공 · 그림자 · 점선) — 배경 · 스프라이트와 같은 픽셀 그림으로 (부드러운 원 · 번짐 안 씀)
 */
export const snapPx = (v: number, px: number) => Math.round(v / px) * px;
/** 픽셀 격자에 맞춘 꽉 찬 타원 (가장자리 딱 끊김) */
export function pxEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, px: number, fill: string) {
  ctx.fillStyle = fill;
  const n = Math.max(1, Math.round(ry / px));
  const x0 = snapPx(cx, px), y0 = snapPx(cy, px);
  for (let j = -n; j < n; j++) {
    const yy = (j + 0.5) / n;
    const hw = Math.round((rx * Math.sqrt(Math.max(0, 1 - yy * yy))) / px) * px;
    if (hw > 0) ctx.fillRect(x0 - hw, y0 + j * px, hw * 2, px);
  }
}
/** 픽셀 고리 */
export function pxRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, px: number, col: string) {
  ctx.fillStyle = col;
  const seen = new Set<string>();
  const n = Math.max(12, Math.ceil((Math.PI * 2 * Math.max(rx, ry)) / px));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = snapPx(cx + Math.cos(a) * rx, px), y = snapPx(cy + Math.sin(a) * ry, px);
    const k = `${x},${y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    ctx.fillRect(x - px / 2, y - px / 2, px, px);
  }
}
/** 픽셀 점선 (step 간격마다 한 칸) */
export function pxPath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], px: number, step: number, col: string) {
  ctx.fillStyle = col;
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    let t = carry;
    while (t < L) {
      const k = t / L;
      ctx.fillRect(snapPx(a.x + (b.x - a.x) * k, px) - px / 2, snapPx(a.y + (b.y - a.y) * k, px) - px / 2, px, px);
      t += step;
    }
    carry = t - L;
  }
}
/** 픽셀 공: 진한 외곽선 · 오른쪽 아래 그늘 · 흰 몸 */
export function pxBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, px: number) {
  const R = Math.max(px * 0.8, r);
  pxEllipse(ctx, x, y, R + px, R + px, px, "#17151f");
  pxEllipse(ctx, x, y, R, R, px, "#b9bcc8");
  if (R > px * 1.2) pxEllipse(ctx, x - px * 0.5, y - px * 0.5, R - px * 0.5, R - px * 0.5, px, "#ffffff");
  else pxEllipse(ctx, x, y, R, R, px, "#ffffff");
}
