/**
 * 타격음 종류와 노트 스킨.
 * 타격음 1(툭)은 직접 계산해서, 2~5는 짧은 샘플 파일(public/rhythm/hit/*.wav)을 받아 AudioBuffer로 (한 번 만들어 재사용).
 */

// ───────────────────────── 타격음 ─────────────────────────

/** 1 툭(합성) · 2 물방울 · 3 펀치(박수+클릭) · 4 하이햇 틱 · 5 하이햇 */
export type HitSound = "thump" | "drop" | "punch" | "tick" | "hat";
type SampleHit = Exclude<HitSound, "thump">;

/**
 * 타격음: 친 순간이 또렷하게. 화면엔 번호로만 보여줌 (1이 기본).
 * 샘플은 ElevenLabs로 만든 것 중 고른 4개 — 어택 시작에 맞춰 0.2초로 자르고, 음악에 묻히지 않게 소프트 리미터로 키움
 */
export const HIT_SOUNDS: { key: HitSound; label: string }[] = [
  { key: "thump", label: "1" },
  { key: "drop", label: "2" },
  { key: "punch", label: "3" },
  { key: "tick", label: "4" },
  { key: "hat", label: "5" },
];

const isSample = (k: HitSound): k is SampleHit => k !== "thump";
/** 샘플 타격음 캐시 (한 번 받아서 디코딩) */
const samples = new Map<string, Promise<AudioBuffer | null>>();
const loaded = new Map<string, AudioBuffer>();
/** 샘플 타격음이면 파일을 받아 디코딩해 둠 (합성음은 바로 null) — 다 되면 makeHitSound가 그걸 돌려줌 */
export function loadHitSound(ctx: BaseAudioContext, kind: HitSound): Promise<AudioBuffer | null> {
  if (!isSample(kind)) return Promise.resolve(null);
  let p = samples.get(kind);
  if (!p) {
    p = fetch(`/rhythm/hit/${kind}.wav`)
      .then((r) => r.arrayBuffer())
      .then((a) => ctx.decodeAudioData(a))
      .catch(() => null);
    samples.set(kind, p);
  }
  return p;
}

/** 샘플은 파일을 받은 버퍼를, 못 받으면 1번(툭)으로 */
export async function hitSoundBuffer(ctx: BaseAudioContext, kind: HitSound): Promise<AudioBuffer> {
  const b = await loadHitSound(ctx, kind);
  if (b) loaded.set(kind, b);
  return b ?? makeHitSound(ctx, "thump");
}

function noiseGen(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647) * 2 - 1;
  };
}

/** 받아 둔 샘플이 있으면 그것, 아니면 1번 툭을 계산해서 (샘플이 아직 안 왔을 때도 툭) */
export function makeHitSound(ctx: BaseAudioContext, hit: HitSound = "thump") {
  const ready = loaded.get(hit);
  if (ready) return ready;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 0.12);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const rnd = noiseGen(7);
  const TAU = 2 * Math.PI;
  /** 1ms 어택 — 바로 0→최대면 '틱' 하는 날카로운 클릭이 생겨서 */
  const atk = (t: number) => Math.min(1, t / 0.001);
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
  // 피크 0.95로
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < len; i++) d[i] *= 0.95 / peak;
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
