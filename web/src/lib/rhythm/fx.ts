/**
 * 타격음 종류와 노트 스킨.
 * 타격음은 샘플 파일 없이 직접 계산해서 짧은 AudioBuffer로 만든다(한 번 만들어 재사용).
 */

// ───────────────────────── 타격음 ─────────────────────────

export type HitSound = "thump" | "wood" | "knock" | "tom";

/**
 * 타격음: 음악을 덮지 않게 둥글지만, 친 순간은 확실히 느껴지게.
 * 화면엔 번호로만 보여줌 (1이 기본). 전부 같은 체감 크기로 맞춤.
 */
export const HIT_SOUNDS: { key: HitSound; label: string }[] = [
  { key: "thump", label: "1" },
  { key: "wood", label: "2" },
  { key: "knock", label: "3" },
  { key: "tom", label: "4" },
];

function noiseGen(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647) * 2 - 1;
  };
}

const LEN: Record<HitSound, number> = {
  thump: 0.12,
  wood: 0.12,
  knock: 0.1,
  tom: 0.16,
};

/** 소리별 최종 크기 (피크). 저음 위주 소리는 노트북 스피커에서 작게 들려서 더 크게 */
const PEAK: Record<HitSound, number> = {
  thump: 0.95,
  wood: 0.7,
  knock: 0.95,
  tom: 0.9,
};

export function makeHitSound(ctx: BaseAudioContext, kind: HitSound = "thump") {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * LEN[kind]);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const rnd = noiseGen(7);
  const TAU = 2 * Math.PI;
  /** 1ms 어택 — 바로 0→최대면 '틱' 하는 날카로운 클릭이 생겨서 */
  const atk = (t: number) => Math.min(1, t / 0.001);

  if (kind === "wood") {
    // 2 우드블록: 높은 공명 두 개가 빠르게 사그라듦
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const x =
        Math.sin(TAU * 820 * t) * Math.exp(-t * 55) +
        Math.sin(TAU * 2210 * t) * Math.exp(-t * 110) * 0.35 +
        rnd() * Math.exp(-t * 900) * 0.3;
      d[i] = Math.tanh(x * 1.2);
    }
  } else if (kind === "thump") {
    // 1 툭: 손가락으로 책상 두드리는 소리.
    // 몸통(220→120Hz)은 그대로 두고, 작은 스피커에서도 들리게 2배음(중음)과 짧은 접촉음을 얹음
    let lp = 0;
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const f = 120 + 100 * Math.exp(-t * 55);
      phase += (TAU * f) / sr;
      lp += (rnd() - lp) * 0.18;
      const x =
        Math.sin(phase) * Math.exp(-t * 30) +
        Math.sin(phase * 2) * Math.exp(-t * 45) * 0.8 +
        Math.sin(phase * 3) * Math.exp(-t * 70) * 0.35 +
        Math.sin(TAU * 900 * t) * Math.exp(-t * 150) * 0.3 +
        lp * Math.exp(-t * 200) * 1.2;
      d[i] = Math.tanh(x * 2.2 * atk(t));
    }
  } else if (kind === "knock") {
    // 3 노크: 나무 문을 손마디로 똑 — 툭보다 조금 높고(340Hz) 단단함, 우드블록보다 낮고 둥긂
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      lp += (rnd() - lp) * 0.35;
      const x =
        Math.sin(TAU * 340 * t) * Math.exp(-t * 60) +
        Math.sin(TAU * 790 * t) * Math.exp(-t * 110) * 0.35 +
        Math.sin(TAU * 1450 * t) * Math.exp(-t * 200) * 0.12 +
        lp * Math.exp(-t * 350) * 0.7;
      d[i] = Math.tanh(x * 1.4 * atk(t));
    }
  } else {
    // 4 탐: 작은 플로어 탐을 손바닥으로 — 음정이 살짝 내려가는 둥근 저음 + 가죽 접촉음
    let lp = 0;
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const f = 170 + 90 * Math.exp(-t * 35);
      phase += (TAU * f) / sr;
      lp += (rnd() - lp) * 0.25;
      const x =
        Math.sin(phase) * Math.exp(-t * 22) +
        Math.sin(phase * 1.5) * Math.exp(-t * 45) * 0.3 +
        lp * Math.exp(-t * 260) * 0.8;
      d[i] = Math.tanh(x * 1.3 * atk(t));
    }
  }
  // 피크를 소리별 목표 크기로 맞춤 (어떤 걸 골라도 비슷하게 들리게)
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < len; i++) d[i] *= PEAK[kind] / peak;
  // 끝부분 클릭 방지
  const fade = Math.floor(sr * 0.004);
  for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  return buf;
}

// ───────────────────────── 노트 스킨 ─────────────────────────
// 모양은 전부 기본 바 노트를 따르고, 색·질감만 조금씩 다르게

export type Skin = "bar" | "neon" | "metal" | "pastel" | "pixel";

export const SKINS: { key: Skin; label: string }[] = [
  { key: "bar", label: "기본" },
  { key: "neon", label: "네온" },
  { key: "metal", label: "메탈" },
  { key: "pastel", label: "파스텔" },
  { key: "pixel", label: "픽셀" },
];

/** 스킨별 레인 색: 기본은 가운데 두 줄만 곡 색 */
export function laneColors(skin: Skin, accent: string): string[] {
  switch (skin) {
    case "neon":
      return ["#F472B6", "#22D3EE", "#22D3EE", "#F472B6"];
    case "metal":
      return ["#D6DAE3", "#F2C66D", "#F2C66D", "#D6DAE3"];
    case "pastel":
      return ["#FBCFE8", "#BAE6FD", "#BBF7D0", "#FDE68A"];
    case "pixel":
      return ["#FF6B6B", "#4ECDC4", "#FFE66D", "#A78BFA"];
    default:
      return ["#E6E8EF", accent, accent, "#E6E8EF"];
  }
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 계단 모서리 사각형 (픽셀 느낌) */
function pixelRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const p = 3;
  g.beginPath();
  g.moveTo(x + p, y);
  g.lineTo(x + w - p, y);
  g.lineTo(x + w - p, y + p);
  g.lineTo(x + w, y + p);
  g.lineTo(x + w, y + h - p);
  g.lineTo(x + w - p, y + h - p);
  g.lineTo(x + w - p, y + h);
  g.lineTo(x + p, y + h);
  g.lineTo(x + p, y + h - p);
  g.lineTo(x, y + h - p);
  g.lineTo(x, y + p);
  g.lineTo(x + p, y + p);
  g.closePath();
}

/** 노트 머리(단노트·롱노트 머리). x: 레인 왼쪽, y: 노트 중심 */
/** 노트 두께 (설정) — 그리기만 바뀌고 판정은 그대로 */
export type NoteSize = "thin" | "normal" | "thick";
export const NOTE_SIZES: { key: NoteSize; label: string; h: number }[] = [
  { key: "thin", label: "얇게", h: 11 },
  { key: "normal", label: "보통", h: 16 },
  { key: "thick", label: "두껍게", h: 26 },
];
let noteH = 16;
export function setNoteSize(k: NoteSize) {
  noteH = NOTE_SIZES.find((n) => n.key === k)?.h ?? 16;
}

/** 노트 머리 그림 캐시: 같은 스킨·색·폭·배율이면 한 번 그려 둔 그림을 찍음 (매 프레임 그라데이션·그림자 계산 없이) */
const headCache = new Map<string, HTMLCanvasElement>();
/** 네온 그림자(shadowBlur 14)가 잘리지 않게 여유 */
const HEAD_PAD = 18;

export function drawHead(
  g: CanvasRenderingContext2D,
  skin: Skin,
  x: number,
  y: number,
  laneW: number,
  color: string
) {
  // 화면 배율(캔버스 픽셀 / 논리 좌표)에 맞춰 그려 두면 확대 없이 또렷
  const scale = g.getTransform().a || 1;
  const key = `${skin}|${color}|${laneW}|${noteH}|${scale.toFixed(2)}`;
  let c = headCache.get(key);
  if (!c) {
    if (headCache.size > 64) headCache.clear();
    c = document.createElement("canvas");
    c.width = Math.ceil((laneW + HEAD_PAD * 2) * scale);
    c.height = Math.ceil((noteH + HEAD_PAD * 2) * scale);
    const b = c.getContext("2d")!;
    b.scale(scale, scale);
    paintHead(b, skin, HEAD_PAD, HEAD_PAD + noteH / 2, laneW, color);
    headCache.set(key, c);
  }
  g.drawImage(
    c,
    x - HEAD_PAD,
    y - noteH / 2 - HEAD_PAD,
    laneW + HEAD_PAD * 2,
    noteH + HEAD_PAD * 2
  );
}

function paintHead(
  g: CanvasRenderingContext2D,
  skin: Skin,
  x: number,
  y: number,
  laneW: number,
  color: string
) {
  // 레인 폭을 거의 꽉 채움 (양옆 2px만 띄움)
  const nx = x + 2;
  const nw = laneW - 4;
  const h = noteH;
  const top = y - h / 2;
  switch (skin) {
    case "bar":
      g.fillStyle = color;
      roundRect(g, nx, top, nw, h, 4);
      g.fill();
      break;
    case "neon": {
      // 속이 빈 빛나는 테두리 + 가운데 흰 심지
      g.save();
      g.shadowColor = color;
      g.shadowBlur = 14;
      g.strokeStyle = color;
      g.lineWidth = 3;
      roundRect(g, nx + 1.5, top + 1.5, nw - 3, h - 3, 4);
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.fillRect(nx + 8, y - 1, nw - 16, 2);
      g.restore();
      break;
    }
    case "metal": {
      // 위는 밝고 아래는 어두운 금속 광택 + 얇은 테두리
      const grad = g.createLinearGradient(0, top, 0, top + h);
      grad.addColorStop(0, "#FFFFFF");
      grad.addColorStop(0.35, color);
      grad.addColorStop(0.55, shade(color, -0.35));
      grad.addColorStop(1, shade(color, -0.1));
      g.fillStyle = grad;
      roundRect(g, nx, top, nw, h, 2);
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.45)";
      g.lineWidth = 1;
      g.stroke();
      break;
    }
    case "pastel": {
      // 알약처럼 끝이 둥글고, 위에 흰 반사
      g.fillStyle = color;
      roundRect(g, nx, top, nw, h, 8);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.55)";
      roundRect(g, nx + 6, top + 3, nw - 12, 4, 2);
      g.fill();
      break;
    }
    case "pixel": {
      // 계단 모서리 + 위 밝은 줄·아래 어두운 줄 (8비트 게임 느낌)
      g.fillStyle = color;
      pixelRect(g, nx, top, nw, h);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.fillRect(nx + 3, top + 3, nw - 6, 3);
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(nx + 3, top + h - 6, nw - 6, 3);
      break;
    }
  }
}

/** 롱노트 몸통 그라데이션 캐시 (가로 방향이라 레인 x·폭·색이 같으면 재사용) */
const bodyGrad = new Map<string, CanvasGradient>();
const holdGrad = (
  g: CanvasRenderingContext2D,
  key: string,
  bx: number,
  bw: number,
  stops: [number, string][]
) => {
  let gr = bodyGrad.get(key);
  if (!gr) {
    if (bodyGrad.size > 64) bodyGrad.clear();
    gr = g.createLinearGradient(bx, 0, bx + bw, 0);
    for (const [p, c] of stops) gr.addColorStop(p, c);
    bodyGrad.set(key, gr);
  }
  return gr;
};

/** 롱노트 몸통 (yTail 위쪽 ~ yHead 아래쪽) */
export function drawHoldBody(
  g: CanvasRenderingContext2D,
  skin: Skin,
  x: number,
  yHead: number,
  yTail: number,
  laneW: number,
  color: string,
  alpha: number
) {
  const h = Math.max(0, yHead - yTail);
  const bx = x + laneW * 0.22;
  const bw = laneW * 0.56;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  switch (skin) {
    case "neon": {
      g.fillStyle = holdGrad(g, `n|${color}|${bx}|${bw}`, bx, bw, [
        [0, `${color}22`],
        [0.5, `${color}aa`],
        [1, `${color}22`],
      ]);
      g.fillRect(bx, yTail, bw, h);
      g.shadowColor = color;
      g.shadowBlur = 8;
      g.fillStyle = "rgba(255,255,255,0.75)";
      g.fillRect(x + laneW / 2 - 1, yTail, 2, h);
      break;
    }
    case "metal": {
      g.fillStyle = holdGrad(g, `m|${color}|${bx}|${bw}`, bx, bw, [
        [0, shade(color, -0.3)],
        [0.4, "#FFFFFF"],
        [0.6, color],
        [1, shade(color, -0.3)],
      ]);
      g.fillRect(bx, yTail, bw, h);
      break;
    }
    case "pastel":
      roundRect(g, bx, yTail - 4, bw, h + 4, bw / 2);
      g.fill();
      break;
    case "pixel":
      g.fillRect(bx, yTail, bw, h);
      // 가로 줄무늬
      g.fillStyle = "rgba(0,0,0,0.18)";
      for (let yy = yTail + 6; yy < yHead; yy += 12) g.fillRect(bx, yy, bw, 4);
      break;
    default:
      g.fillRect(bx, yTail, bw, h);
  }
  // 꼬리 끝 표시
  g.globalAlpha = Math.min(1, alpha + 0.3);
  g.fillStyle = color;
  if (skin !== "pastel") g.fillRect(bx, yTail - 3, bw, 6);
  g.restore();
}

/** "#rrggbb"를 밝게(+)/어둡게(-) */
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (c: number) =>
    Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)
      .toString(16)
      .padStart(2, "0");
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}
