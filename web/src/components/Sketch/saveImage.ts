/*
 * DOODLE PARTY — 그림을 이미지 한 장으로 저장 (갈틱폰처럼 결과를 남기고 공유하게)
 *  - 릴레이 앨범: 한 사람의 이야기를 위에서 아래로 (문장 말풍선 · 그림 액자 · 처음 ↔ 끝)
 *  - 그림 맞히기 모아보기: 이번 판 그림을 3칸 격자로
 * 화면 밖 캔버스에 그려서 PNG 로 내려받음. 글꼴은 화면과 같은 Gaegu(손글씨) · Nanum Gothic.
 */
import type { Stroke } from "@/realtime/sketch";
import { renderStrokes } from "./SketchCanvas";
import { encodeGif, type GifFrame } from "./gif";

const INK = "#2B2D42";
const PAPER = "#FFFBEF";
const CORAL = "#FF6B6B";
const HAND = `"Gaegu", "Jua", sans-serif`;
const BODY = `"Nanum Gothic", "Apple SD Gothic Neo", sans-serif`;
const SITE = "gunmo.my/games/sketch";

/** 손글씨 글꼴이 아직 안 받아졌으면 기다림 (없으면 그냥 기본 글꼴) */
async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`700 28px Gaegu`),
      document.fonts.load(`700 16px "Nanum Gothic"`),
    ]);
  } catch {
    /* 기본 글꼴로 */
  }
}

/** 글자 단위로 줄바꿈 (한글은 띄어쓰기가 없어도 끊어야 해서) — 가능하면 띄어쓰기에서 끊음 */
function wrap(c: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  let lastSpace = -1;
  for (const ch of text) {
    const next = line + ch;
    if (c.measureText(next).width <= max || !line) {
      line = next;
      if (ch === " ") lastSpace = line.length - 1;
      continue;
    }
    if (lastSpace > 0) {
      lines.push(line.slice(0, lastSpace));
      line = line.slice(lastSpace + 1) + ch;
    } else {
      lines.push(line);
      line = ch;
    }
    lastSpace = -1;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke = INK,
  lw = 3
) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = lw;
  c.strokeStyle = stroke;
  c.stroke();
}

/** 모눈 공책 배경 */
function paper(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = PAPER;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "rgba(78,168,222,0.12)";
  c.lineWidth = 1;
  for (let x = 0; x < w; x += 24) {
    c.beginPath();
    c.moveTo(x + 0.5, 0);
    c.lineTo(x + 0.5, h);
    c.stroke();
  }
  for (let y = 0; y < h; y += 24) {
    c.beginPath();
    c.moveTo(0, y + 0.5);
    c.lineTo(w, y + 0.5);
    c.stroke();
  }
}

function footer(c: CanvasRenderingContext2D, w: number, y: number) {
  c.fillStyle = "#7A7F8E";
  c.font = `700 15px ${BODY}`;
  c.textAlign = "center";
  c.fillText(`🎨 DOODLE PARTY · ${SITE}`, w / 2, y);
  c.textAlign = "left";
}

/** 캔버스를 PNG 로 내려받기 */
export function downloadCanvas(cv: HTMLCanvasElement, filename: string) {
  cv.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
}

/** 파일 이름에 못 쓰는 글자 빼기 */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 30);

export interface AlbumPage {
  name: string;
  /** 처음 문장 · 그렸어요 · 그림을 보고 */
  role: string;
  text?: string;
  strokes?: Stroke[] | null;
}

/** 릴레이 한 줄 → 세로로 긴 이미지 한 장 */
export async function albumImage(opts: {
  title: string;
  pages: AlbumPage[];
  /** 처음 ↔ 마지막 문장 · 변신율 */
  compare?: { first: string; last: string; rate: number; label: string } | null;
}): Promise<HTMLCanvasElement> {
  await fontsReady();
  const W = 760;
  const PAD = 40;
  const IW = W - PAD * 2;
  const DW = 600;
  const DH = DW * 0.75;
  const meas = document.createElement("canvas").getContext("2d")!;
  meas.font = `700 30px ${HAND}`;
  // 높이 먼저 계산
  const blocks = opts.pages.map((p) => {
    const lines = p.text ? wrap(meas, `「${p.text}」`, IW - 48) : [];
    const h = p.strokes !== undefined ? DH + 12 : lines.length * 38 + 30;
    return { p, lines, h };
  });
  meas.font = `700 22px ${HAND}`;
  const cmp = opts.compare;
  const cmpFirst = cmp ? wrap(meas, `「${cmp.first}」`, IW - 40) : [];
  const cmpLast = cmp ? wrap(meas, `「${cmp.last}」`, IW - 40) : [];
  const cmpH = cmp ? 70 + cmpFirst.length * 30 + 20 + cmpLast.length * 30 + 90 : 0;
  let H = 120;
  for (const b of blocks) H += 30 + b.h + 40;
  H += cmpH + 60;

  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  paper(c, W, H);
  // 제목
  c.fillStyle = CORAL;
  c.font = `700 16px ${BODY}`;
  c.fillText("📞 그림 릴레이", PAD, 50);
  c.fillStyle = INK;
  c.font = `700 40px ${HAND}`;
  c.fillText(opts.title, PAD, 94);
  let y = 120;
  blocks.forEach((b, i) => {
    if (i > 0) {
      c.fillStyle = "#9A9DB3";
      c.font = `700 15px ${BODY}`;
      c.textAlign = "center";
      c.fillText(
        b.p.strokes !== undefined ? "⬇ 이 문장을 그리면…" : "⬇ 이 그림을 보고…",
        W / 2,
        y + 2
      );
      c.textAlign = "left";
    }
    y += 30;
    c.fillStyle = INK;
    c.font = `800 16px ${BODY}`;
    c.fillText(b.p.name, PAD, y);
    const nw = c.measureText(b.p.name).width;
    c.fillStyle = "#9A9DB3";
    c.font = `700 14px ${BODY}`;
    c.fillText(` · ${b.p.role}`, PAD + nw, y);
    y += 12;
    if (b.p.strokes !== undefined) {
      const x = (W - DW) / 2;
      roundRect(c, x - 3, y - 3, DW + 6, DH + 6, 6, "#fff");
      if (b.p.strokes) c.drawImage(renderStrokes(b.p.strokes, 1), x, y, DW, DH);
      y += DH + 12;
    } else {
      const bh = b.lines.length * 38 + 22;
      roundRect(c, PAD, y, IW, bh, 18, i === 0 ? "#FFF4C2" : "#FFFFFF");
      c.fillStyle = INK;
      c.font = `700 30px ${HAND}`;
      b.lines.forEach((l, k) => c.fillText(l, PAD + 24, y + 40 + k * 38));
      y += bh + 8;
    }
    y += 40;
  });
  if (cmp) {
    c.setLineDash([10, 8]);
    roundRect(c, PAD, y, IW, cmpH - 30, 18, "#FFFFFF");
    c.setLineDash([]);
    c.fillStyle = INK;
    c.font = `700 28px ${HAND}`;
    c.textAlign = "center";
    c.fillText("🔁 처음과 끝", W / 2, y + 42);
    c.textAlign = "left";
    let yy = y + 78;
    c.font = `700 22px ${HAND}`;
    for (const l of cmpFirst) {
      c.fillText(l, PAD + 20, yy);
      yy += 30;
    }
    c.fillStyle = "#9A9DB3";
    c.font = `700 15px ${BODY}`;
    c.fillText("⬇", PAD + 20, yy);
    yy += 24;
    c.fillStyle = INK;
    c.font = `700 22px ${HAND}`;
    for (const l of cmpLast) {
      c.fillText(l, PAD + 20, yy);
      yy += 30;
    }
    c.textAlign = "center";
    c.fillStyle = CORAL;
    c.font = `700 40px ${HAND}`;
    c.fillText(`변신율 ${cmp.rate}% · ${cmp.label}`, W / 2, yy + 34);
    c.textAlign = "left";
    y += cmpH;
  }
  footer(c, W, H - 24);
  return cv;
}

/** 아무 파일이나 내려받기 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 릴레이 한 줄 → 움직이는 GIF (갈틱폰 GIF 처럼 한 장씩 넘어감).
 * 그림은 그려지는 순서대로 몇 장에 나눠 차오르고, 마지막엔 처음 ↔ 끝 비교.
 */
export async function albumGif(opts: {
  title: string;
  pages: AlbumPage[];
  compare?: { first: string; last: string; rate: number; label: string } | null;
}): Promise<Blob> {
  await fontsReady();
  const W = 560;
  const H = 520;
  const DW = 480;
  const DH = 360;
  const total = opts.pages.length;
  const frames: GifFrame[] = [];
  const base = (head: string, sub?: string) => {
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const c = cv.getContext("2d", { willReadFrequently: true })!;
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, H);
    c.fillStyle = CORAL;
    c.font = `700 14px ${BODY}`;
    c.fillText(`📞 ${opts.title}`, 28, 32);
    c.fillStyle = INK;
    c.font = `800 18px ${BODY}`;
    c.fillText(head, 28, 62);
    if (sub) {
      const hw = c.measureText(head).width;
      c.fillStyle = "#9A9DB3";
      c.font = `700 15px ${BODY}`;
      c.fillText(` · ${sub}`, 28 + hw, 62);
    }
    footer(c, W, H - 16);
    return { cv, c };
  };
  const bubble = (c: CanvasRenderingContext2D, text: string, yellow: boolean) => {
    let fs = 34;
    let lines: string[] = [];
    for (; fs >= 20; fs -= 2) {
      c.font = `700 ${fs}px ${HAND}`;
      lines = wrap(c, `「${text}」`, W - 120);
      if (lines.length * fs * 1.3 <= 300) break;
    }
    const lh = fs * 1.3;
    const bh = lines.length * lh + 44;
    const y = 90 + (DH - bh) / 2;
    roundRect(c, 40, y, W - 80, bh, 22, yellow ? "#FFF4C2" : "#FFFFFF");
    c.fillStyle = INK;
    c.font = `700 ${fs}px ${HAND}`;
    c.textAlign = "center";
    lines.forEach((l, k) => c.fillText(l, W / 2, y + 22 + fs + k * lh));
    c.textAlign = "left";
  };
  opts.pages.forEach((p, i) => {
    const head = `${i + 1}/${total}  ${p.name}`;
    if (p.strokes !== undefined) {
      const strokes = p.strokes ?? [];
      // 그려지는 모습: 1/4 → 2/4 → 3/4 → 다 그림
      const cuts = strokes.length > 8 ? [0.25, 0.5, 0.75, 1] : [1];
      cuts.forEach((f, k) => {
        const { cv, c } = base(head, p.role);
        const x = (W - DW) / 2;
        roundRect(c, x - 3, 85, DW + 6, DH + 6, 6, "#fff");
        const part = strokes.slice(0, Math.ceil(strokes.length * f));
        if (part.length) c.drawImage(renderStrokes(part, 0.6), x, 88, DW, DH);
        frames.push({ canvas: cv, delay: k === cuts.length - 1 ? 2600 : 220 });
      });
    } else {
      const { cv, c } = base(head, p.role);
      bubble(c, p.text ?? "", i === 0);
      frames.push({ canvas: cv, delay: 2200 });
    }
  });
  const cmp = opts.compare;
  if (cmp) {
    const { cv, c } = base("🔁 처음과 끝");
    c.font = `700 24px ${HAND}`;
    const a = wrap(c, `「${cmp.first}」`, W - 100).slice(0, 3);
    const b = wrap(c, `「${cmp.last}」`, W - 100).slice(0, 3);
    roundRect(c, 40, 90, W - 80, 340, 22, "#FFFFFF");
    c.fillStyle = INK;
    c.textAlign = "center";
    let y = 140;
    for (const l of a) {
      c.fillText(l, W / 2, y);
      y += 32;
    }
    c.fillStyle = "#9A9DB3";
    c.font = `700 22px ${BODY}`;
    c.fillText("⬇", W / 2, y + 6);
    y += 46;
    c.fillStyle = INK;
    c.font = `700 24px ${HAND}`;
    for (const l of b) {
      c.fillText(l, W / 2, y);
      y += 32;
    }
    c.fillStyle = CORAL;
    c.font = `700 40px ${HAND}`;
    c.fillText(`변신율 ${cmp.rate}%`, W / 2, Math.max(y + 40, 360));
    c.font = `700 24px ${HAND}`;
    c.fillText(cmp.label, W / 2, Math.max(y + 74, 396));
    c.textAlign = "left";
    frames.push({ canvas: cv, delay: 4000 });
  }
  return encodeGif(frames);
}

export interface GalleryCell {
  word: string;
  name: string;
  likes: number;
  strokes: Stroke[] | null;
}

/** 그림 맞히기 모아보기 → 3칸 격자 이미지 한 장 */
export async function galleryImage(
  title: string,
  cells: GalleryCell[]
): Promise<HTMLCanvasElement> {
  await fontsReady();
  const COLS = Math.min(3, Math.max(1, cells.length));
  const TW = 320;
  const TH = 240;
  const GAP = 24;
  const PAD = 36;
  const CAP = 58;
  const rows = Math.ceil(cells.length / COLS);
  const W = PAD * 2 + COLS * TW + (COLS - 1) * GAP;
  const H = 120 + rows * (TH + CAP + GAP) + 40;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  paper(c, W, H);
  c.fillStyle = CORAL;
  c.font = `700 16px ${BODY}`;
  c.fillText("🎨 그림 맞히기", PAD, 48);
  c.fillStyle = INK;
  c.font = `700 38px ${HAND}`;
  c.fillText(title, PAD, 90);
  cells.forEach((cell, i) => {
    const x = PAD + (i % COLS) * (TW + GAP);
    const y = 116 + Math.floor(i / COLS) * (TH + CAP + GAP);
    roundRect(c, x - 3, y - 3, TW + 6, TH + 6, 6, "#fff");
    if (cell.strokes) c.drawImage(renderStrokes(cell.strokes, 0.5), x, y, TW, TH);
    c.fillStyle = INK;
    c.font = `700 26px ${HAND}`;
    const word = cell.word || "(건너뜀)";
    c.fillText(word.length > 12 ? `${word.slice(0, 12)}…` : word, x, y + TH + 32);
    c.fillStyle = "#7A7F8E";
    c.font = `700 14px ${BODY}`;
    c.fillText(`${cell.name}${cell.likes ? ` · 👍 ${cell.likes}` : ""}`, x, y + TH + 52);
  });
  footer(c, W, H - 18);
  return cv;
}
