/**
 * 타석 화면 수비수 · 투수 그림을 수비 팀 색으로 — 그림의 파란 유니폼 자리(색상 190 ~ 255°)만 팀 색 색상으로 돌림.
 * 밝기 · 명암은 그대로 두고 채도 · 밝기를 팀 색 쪽으로 조금 맞춤. 팀 색마다 한 번 만들어 캐시.
 */
const cache = new Map<string, HTMLCanvasElement>();

function hexHsv(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}

/** 원래 그림의 파란 유니폼 기준 (채도 · 밝기) */
const BASE_S = 0.7;
const BASE_V = 0.72;

/**
 * key = 그림 주소, w · h = 그림 크기. 아직 못 만들면(그림 덜 받음) 원래 그림.
 * 파란 팀(색상 차이 20° 안)이면 원래 그림 그대로.
 */
export function teamTinted(key: string, src: CanvasImageSource, w: number, h: number, color: string): CanvasImageSource {
  if (!w || !h || typeof document === "undefined") return src;
  const [th, ts, tv] = hexHsv(color);
  if (Math.abs(th - 222) < 20 && ts > 0.35) return src;
  const k = `${key}|${color}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(src, 0, 0);
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  const sk = Math.min(1.25, ts / BASE_S);
  const vk = Math.min(1.3, Math.max(0.55, tv / BASE_V));
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), dd = mx - mn;
    if (!dd || mx !== b) continue;
    const s = dd / mx;
    if (s < 0.22) continue;
    let hh = mx === r ? ((gg - b) / dd) % 6 : mx === gg ? (b - r) / dd + 2 : (r - gg) / dd + 4;
    hh = (hh * 60 + 360) % 360;
    if (hh < 190 || hh > 255) continue;
    // 팀 색 색상으로 (채도 · 밝기는 비례)
    const ns = Math.min(1, s * sk);
    const nv = Math.min(1, mx * vk);
    const C = nv * ns;
    const X = C * (1 - Math.abs(((th / 60) % 2) - 1));
    const m = nv - C;
    const [r1, g1, b1] = th < 60 ? [C, X, 0] : th < 120 ? [X, C, 0] : th < 180 ? [0, C, X] : th < 240 ? [0, X, C] : th < 300 ? [X, 0, C] : [C, 0, X];
    d[i] = Math.round((r1 + m) * 255);
    d[i + 1] = Math.round((g1 + m) * 255);
    d[i + 2] = Math.round((b1 + m) * 255);
  }
  g.putImageData(id, 0, 0);
  cache.set(k, c);
  return c;
}
