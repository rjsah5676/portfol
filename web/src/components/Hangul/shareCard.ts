/*
 * 대표글 공유 카드 — 원고지에 쓴 문장 한 장 (1080 × 1080 PNG)
 *   위: 제목 · 가운데: 원고지 칸마다 한 글자(띄어쓰기는 빈칸) · 아래: 등급 도장 · 점수 · 주소
 * 공유가 되면(모바일) 이미지 파일로 공유, 안 되면 내려받기.
 */

const S = 1080;
const PAPER = "#f4eddc",
  PAPER2 = "#e8dcc0",
  INK = "#1a1714",
  INK2 = "#6b6153",
  RED = "#c0392b",
  GRID = "#d9826e";
const BRUSH = '"Song Myung", serif',
  TITLE = '"Black Han Sans", sans-serif',
  BODY = '"Gowun Dodum", "Nanum Gothic", sans-serif';
export const SHARE_URL = "gunmo.my/games/hangul";

export interface CardInput {
  /** 띄어쓰기까지 된 문장 (끝 부호 포함) */
  text: string;
  /** 명문 · 말 됨 · 억지 (모르면 없음) */
  grade?: string;
  /** "이 문장 1,173점" 같은 줄 */
  line1?: string;
  /** "익명 · 31웨이브 · 18,420점" 같은 줄 */
  line2?: string;
}

export async function renderCard(c: CardInput): Promise<Blob> {
  // 글꼴이 아직 안 받아졌으면 기다림 (안 그러면 기본 글꼴로 그려짐)
  await Promise.all(
    [`64px ${BRUSH}`, `64px ${TITLE}`, `30px ${BODY}`].map((f) =>
      document.fonts.load(f, c.text).catch(() => null)
    )
  );
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const x = cv.getContext("2d")!;

  // 바탕
  x.fillStyle = PAPER2;
  x.fillRect(0, 0, S, S);
  x.fillStyle = PAPER;
  roundRect(x, 48, 48, S - 96, S - 96, 28);
  x.fill();

  // 제목
  x.fillStyle = INK;
  x.textAlign = "center";
  x.textBaseline = "alphabetic";
  x.font = `76px ${TITLE}`;
  x.fillText("니들이 한글을 알아?", S / 2, 170);
  x.font = `28px ${BODY}`;
  x.fillStyle = INK2;
  x.fillText("아무 말이나 지껄여서 먹물을 막아라", S / 2, 218);

  // 원고지: 짧은 문장은 칸을 크게(한 줄 6~10칸), 긴 문장은 여러 줄로 — 가운데 빈 곳이 휑하지 않게
  const chars = [...c.text];
  const cols = Math.min(10, Math.max(6, chars.length));
  const cells = layout(chars, cols);
  const rows = Math.max(1, Math.ceil(cells.length / cols));
  const cell = Math.min(130, Math.floor(880 / cols), Math.floor(560 / rows));
  const gw = cell * cols,
    gh = cell * rows;
  const gx = (S - gw) / 2,
    gy = 268 + (560 - gh) / 2;
  x.fillStyle = "#fffdf6";
  x.fillRect(gx, gy, gw, gh);
  x.strokeStyle = GRID;
  x.lineWidth = 2;
  for (let r = 0; r <= rows; r++) line(x, gx, gy + r * cell, gx + gw, gy + r * cell);
  for (let k = 0; k <= cols; k++) line(x, gx + k * cell, gy, gx + k * cell, gy + gh);
  x.fillStyle = INK;
  x.textBaseline = "middle";
  x.font = `${Math.round(cell * 0.72)}px ${BRUSH}`;
  cells.forEach((cl, i) => {
    const cx = gx + (i % cols) * cell + cell / 2,
      cy = gy + Math.floor(i / cols) * cell + cell / 2;
    // 부호는 원고지처럼 칸 왼쪽 아래에
    if (/[.,]/.test(cl.ch)) x.fillText(cl.ch, cx - cell * 0.22, cy + cell * 0.18);
    else if (cl.ch !== " ") x.fillText(cl.ch, cx, cy + cell * 0.04);
    // 줄 끝 칸에 같이 들어간 부호 (줄 첫 칸에 부호를 안 씀)
    if (cl.tail) {
      x.save();
      x.font = `${Math.round(cell * 0.5)}px ${BRUSH}`;
      x.fillText(cl.tail, cx + cell * 0.36, cy + (/[.,]/.test(cl.tail) ? cell * 0.3 : 0));
      x.restore();
    }
  });

  // 등급 도장
  if (c.grade) {
    x.save();
    // 원고지 오른쪽 아래 바깥 (마지막 칸의 마침표를 가리지 않게)
    x.translate(gx + gw - 60, gy + gh + 64);
    x.rotate(-0.18);
    x.font = `44px ${TITLE}`;
    const w = x.measureText(c.grade).width + 36;
    x.strokeStyle = RED;
    x.lineWidth = 6;
    roundRect(x, -w / 2, -36, w, 72, 10);
    if (c.grade === "명문") {
      x.fillStyle = RED;
      x.fill();
      x.fillStyle = "#fff";
    } else {
      x.stroke();
      x.fillStyle = RED;
    }
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(c.grade, 0, 2);
    x.restore();
  }

  // 아랫줄
  x.textAlign = "center";
  x.textBaseline = "alphabetic";
  if (c.line1) {
    x.font = `40px ${TITLE}`;
    x.fillStyle = RED;
    x.fillText(c.line1, S / 2, 930);
  }
  if (c.line2) {
    x.font = `28px ${BODY}`;
    x.fillStyle = INK2;
    x.fillText(c.line2, S / 2, 972);
  }
  x.font = `24px ${BODY}`;
  x.fillStyle = INK2;
  x.globalAlpha = 0.8;
  x.fillText(SHARE_URL, S / 2, 1010);

  return new Promise((ok, no) =>
    cv.toBlob((b) => (b ? ok(b) : no(new Error("toBlob"))), "image/png")
  );
}

/** 공유(되면) 또는 내려받기. 무엇을 했는지 돌려줌 */
export async function shareCard(c: CardInput): Promise<"shared" | "saved" | "cancel"> {
  const blob = await renderCard(c);
  const file = new File([blob], "hangul.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  // 공유 창은 폰에서만 (PC 브라우저는 공유 창보다 그냥 저장이 편함)
  const phone = matchMedia("(pointer: coarse)").matches;
  if (phone && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        text: `“${c.text}” — 니들이 한글을 알아?`,
        url: `https://${SHARE_URL}`,
      });
      return "shared";
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return "cancel";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "니들이한글을알아.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "saved";
}

/**
 * 원고지 칸 나누기 (쓰는 법 그대로): 줄 첫 칸에 오는 띄어쓰기는 버리고,
 * 줄 첫 칸에 올 부호(. , ? !)는 앞줄 마지막 칸에 같이 씀
 */
export function layout(chars: string[], cols: number): { ch: string; tail?: string }[] {
  const out: { ch: string; tail?: string }[] = [];
  for (const ch of chars) {
    const atStart = out.length % cols === 0;
    if (ch === " " && atStart) continue;
    if (/[.,?!]/.test(ch) && atStart && out.length) {
      const prev = out[out.length - 1];
      prev.tail = (prev.tail ?? "") + ch;
      continue;
    }
    out.push({ ch });
  }
  return out;
}

function line(x: CanvasRenderingContext2D, a: number, b: number, c: number, d: number) {
  x.beginPath();
  x.moveTo(a, b);
  x.lineTo(c, d);
  x.stroke();
}
function roundRect(
  x: CanvasRenderingContext2D,
  l: number,
  t: number,
  w: number,
  h: number,
  r: number
) {
  x.beginPath();
  x.roundRect(l, t, w, h, r);
}
