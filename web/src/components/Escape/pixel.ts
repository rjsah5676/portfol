/* 방탈출 픽셀 그리기 도우미 (320×180 캔버스, 화면에선 image-rendering: pixelated 로 키움) */

export type G = CanvasRenderingContext2D;

export const rect = (g: G, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

/** 테두리 있는 상자 */
export const box = (g: G, x: number, y: number, w: number, h: number, fill: string, line = "#17161c") => {
  rect(g, x, y, w, h, line);
  rect(g, x + 1, y + 1, w - 2, h - 2, fill);
};

/** 위쪽 밝은 줄 · 아래 그림자 한 줄 (입체감) */
export const bevel = (g: G, x: number, y: number, w: number, h: number, light: string, dark: string) => {
  rect(g, x + 1, y + 1, w - 2, 1, light);
  rect(g, x + 1, y + h - 2, w - 2, 1, dark);
};

/** 체크무늬 디더 (그림자 · 질감) */
export const dither = (g: G, x: number, y: number, w: number, h: number, c: string, step = 2) => {
  g.fillStyle = c;
  for (let j = 0; j < h; j++) for (let i = (j % 2) * (step / 2); i < w; i += step) g.fillRect(x + i, y + j, 1, 1);
};

/** 아주 작은 글자 대신 쓰는 줄 (문서 위 글씨 흉내) */
export const lines = (g: G, x: number, y: number, w: number, n: number, c: string, gap = 2) => {
  for (let i = 0; i < n; i++) rect(g, x, y + i * gap, w - ((i * 7) % 5), 1, c);
};

export const PAL = {
  ink: "#17161c",
  wall: "#3f3d4a",
  wall2: "#46444f",
  wallDark: "#34323d",
  ceil: "#2a2932",
  floor: "#5b4535",
  floor2: "#523e30",
  floorLine: "#45342a",
  base: "#26252d",
  wood: "#7a5a3c",
  woodL: "#8f6c4a",
  woodD: "#5b422c",
  paper: "#e9e3d3",
  paperY: "#efe2a8",
  metal: "#7b8088",
  metalL: "#959aa2",
  metalD: "#5c6068",
  white: "#d9dcd7",
  whiteD: "#b5b9b4",
  red: "#c8413b",
  pink: "#e08aa0",
  blue: "#4d6fa3",
  blueL: "#6b8cc0",
  sky: "#8fa3b3",
  black: "#101014",
  uv: "#b78bff",
};

/** 공통 바닥 · 벽 · 걸레받이 · 천장 */
export function roomBase(g: G) {
  rect(g, 0, 0, 320, 180, PAL.wall);
  // 벽지 세로 줄무늬
  for (let x = 0; x < 320; x += 16) rect(g, x, 8, 8, 128, PAL.wall2);
  rect(g, 0, 0, 320, 8, PAL.ceil);
  rect(g, 0, 8, 320, 1, PAL.wallDark);
  // 습기 얼룩 (반지하)
  dither(g, 0, 120, 320, 16, PAL.wallDark, 4);
  rect(g, 0, 136, 320, 4, PAL.base);
  rect(g, 0, 140, 320, 40, PAL.floor);
  for (let y = 146; y < 180; y += 8) rect(g, 0, y, 320, 1, PAL.floorLine);
  for (let y = 140, k = 0; y < 180; y += 8, k++) for (let x = (k % 2) * 24; x < 320; x += 48) rect(g, x, y, 1, 8, PAL.floorLine);
  dither(g, 0, 140, 320, 6, PAL.floor2, 2);
}

/** 반지하 높은 창 (밖은 길바닥 높이) */
export function basementWindow(g: G, x: number, y: number, w: number, h: number, legs = true) {
  box(g, x, y, w, h, PAL.sky);
  rect(g, x + 1, y + h - 6, w - 2, 5, "#6f7680");
  if (legs) {
    // 지나가는 다리 둘
    rect(g, x + 12, y + 3, 3, h - 9, "#2d2f3a");
    rect(g, x + 17, y + 3, 3, h - 9, "#2d2f3a");
    rect(g, x + 11, y + h - 7, 5, 2, "#1b1c22");
    rect(g, x + 17, y + h - 7, 5, 2, "#1b1c22");
  }
  for (let i = x + 6; i < x + w - 2; i += 8) rect(g, i, y + 1, 1, h - 2, PAL.ink);
  rect(g, x, y + Math.floor(h / 2), w, 1, PAL.ink);
}
