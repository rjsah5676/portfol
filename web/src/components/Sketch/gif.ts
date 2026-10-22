/*
 * DOODLE PARTY — 아주 작은 GIF 만들기 (움직이는 앨범 저장용, 외부 라이브러리 없이).
 * 고정 팔레트(크레용 16색 + 종이 · 잉크 + 6단계 색 큐브)에 가장 가까운 색으로 맞추고 LZW 로 압축.
 * 그림판 그림은 대부분 크레용 색이라 고정 팔레트로도 거의 그대로 나옴.
 */

const BASE = [
  // 크레용 (SketchCanvas COLORS)
  "#1F1F2A",
  "#7A7F8E",
  "#E53935",
  "#FB8C00",
  "#FDD835",
  "#43A047",
  "#1E88E5",
  "#8E24AA",
  "#FFFFFF",
  "#C9CED6",
  "#F48FB1",
  "#FFCC9C",
  "#9CCC65",
  "#4DD0E1",
  "#3949AB",
  "#6D4C41",
  // 앨범 꾸밈
  "#FFFBEF",
  "#2B2D42",
  "#FF6B6B",
  "#9A9DB3",
  "#FFF4C2",
  "#E9E4D4",
];

function buildPalette(): Uint8Array {
  const cols: number[] = BASE.map((h) => parseInt(h.slice(1), 16));
  const steps = [0, 51, 102, 153, 204, 255];
  for (const r of steps)
    for (const g of steps) for (const b of steps) cols.push((r << 16) | (g << 8) | b);
  const pal = new Uint8Array(256 * 3);
  cols.slice(0, 256).forEach((c, i) => {
    pal[i * 3] = (c >> 16) & 255;
    pal[i * 3 + 1] = (c >> 8) & 255;
    pal[i * 3 + 2] = c & 255;
  });
  return pal;
}

const PALETTE = buildPalette();
const PAL_N = Math.min(256, BASE.length + 216);

/** RGBA 픽셀 → 팔레트 번호 (같은 색은 한 번만 계산) */
function quantize(rgba: Uint8ClampedArray, cache: Map<number, number>): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      let best = 0;
      let bd = Infinity;
      for (let p = 0; p < PAL_N; p++) {
        const dr = PALETTE[p * 3] - r;
        const dg = PALETTE[p * 3 + 1] - g;
        const db = PALETTE[p * 3 + 2] - b;
        // 사람 눈에 가깝게 초록에 무게
        const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (d < bd) {
          bd = d;
          best = p;
          if (d === 0) break;
        }
      }
      idx = best;
      cache.set(key, idx);
    }
    out[i] = idx;
  }
  return out;
}

/** GIF 용 LZW (가변 길이 코드, 낮은 비트부터) — 결과는 255바이트 묶음으로 */
function lzw(indices: Uint8Array, out: number[]) {
  const MIN = 8;
  const CLEAR = 1 << MIN;
  const EOI = CLEAR + 1;
  out.push(MIN);
  const bytes: number[] = [];
  let size = MIN + 1;
  let next = EOI + 1;
  let cur = 0;
  let bits = 0;
  const emit = (code: number) => {
    cur |= code << bits;
    bits += size;
    while (bits >= 8) {
      bytes.push(cur & 255);
      cur >>>= 8;
      bits -= 8;
    }
  };
  let dict = new Map<number, number>();
  emit(CLEAR);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(CLEAR);
      dict = new Map();
      next = EOI + 1;
      size = MIN + 1;
    } else {
      if (next >= 1 << size) size++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(EOI);
  if (bits > 0) bytes.push(cur & 255);
  for (let i = 0; i < bytes.length; i += 255) {
    const n = Math.min(255, bytes.length - i);
    out.push(n);
    for (let j = 0; j < n; j++) out.push(bytes[i + j]);
  }
  out.push(0);
}

export interface GifFrame {
  canvas: HTMLCanvasElement;
  /** 이 장면을 보여 줄 시간 (ms) */
  delay: number;
}

/** 같은 크기의 캔버스들 → 반복 재생 GIF */
export async function encodeGif(frames: GifFrame[]): Promise<Blob> {
  const w = frames[0].canvas.width;
  const h = frames[0].canvas.height;
  const out: number[] = [];
  const str = (s: string) => {
    for (const ch of s) out.push(ch.charCodeAt(0));
  };
  const u16 = (v: number) => out.push(v & 255, (v >> 8) & 255);
  str("GIF89a");
  u16(w);
  u16(h);
  out.push(0xf7, 0, 0); // 전역 팔레트 256색
  for (const v of PALETTE) out.push(v);
  // 무한 반복
  out.push(0x21, 0xff, 0x0b);
  str("NETSCAPE2.0");
  out.push(0x03, 0x01, 0, 0, 0);
  const cache = new Map<number, number>();
  for (const f of frames) {
    const c = f.canvas.getContext("2d", { willReadFrequently: true });
    if (!c) continue;
    const idx = quantize(c.getImageData(0, 0, w, h).data, cache);
    out.push(0x21, 0xf9, 0x04, 0x04);
    u16(Math.max(2, Math.round(f.delay / 10)));
    out.push(0, 0);
    out.push(0x2c);
    u16(0);
    u16(0);
    u16(w);
    u16(h);
    out.push(0);
    lzw(idx, out);
    // 큰 앨범이어도 화면이 멈추지 않게 장면마다 한숨 돌림
    await new Promise((r) => setTimeout(r, 0));
  }
  out.push(0x3b);
  return new Blob([new Uint8Array(out)], { type: "image/gif" });
}
