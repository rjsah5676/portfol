/**
 * 2D 컷아웃 스켈레탈 리그 (Spine · DragonBones 방식, 캔버스용 작은 런타임).
 *
 *   뼈(bone): 부모 기준 위치 · 각도 · 길이. 애니메이션은 뼈 각도(와 위치)를 키프레임으로 돌림.
 *   슬롯(slot): 뼈에 붙는 그림 자리 + 그리는 순서. 장비를 바꾸면 슬롯의 붙임(attachment)만 바뀜
 *               → 어떤 장비 조합이든 같은 스윙 · 투구 애니로 자연스럽게 움직임.
 *   붙임(attachment): 그림 파일(파츠 PNG/WEBP, 기준점 · 크기 · 회전) 또는 자리표시 도형(코드로 그림).
 *               팀 색은 붙임의 tint 마스크로 칠함 (유니폼 그림 한 벌로 모든 팀).
 *
 * 좌표: 캔버스 그대로 (y 아래 +), 각도는 도(°), 0° = 오른쪽, 90° = 아래.
 * 뼈는 부모 끝(len)이 아니라 부모 원점 기준 (x, y) 에 붙음 — 파츠 그림 기준점 맞추기가 쉬움.
 */

export interface BoneDef {
  id: string;
  parent?: string;
  x: number;
  y: number;
  rot: number;
  len: number;
}

export interface SlotDef {
  id: string;
  bone: string;
  /** 기본 붙임 이름 (스킨에서 바꿈) */
  attach: string;
}

export interface RigDef {
  id: string;
  bones: BoneDef[];
  /** 그리는 순서대로 (뒤 → 앞) */
  slots: SlotDef[];
}

export interface Key {
  t: number;
  /** 각도 (휴식 자세에 더함) */
  r?: number;
  x?: number;
  y?: number;
  /** 가로 배율 (방망이가 화면 안쪽으로 돌 때 짧아 보이게 · 음수면 반대쪽) */
  sx?: number;
  /** 다음 키까지 이징: 기본 부드럽게, "lin" 직선, "step" 끊어서, "fast" 처음에 빠르게 (스윙) */
  e?: "lin" | "step" | "fast" | "slow";
}

export interface Anim {
  dur: number;
  loop: boolean;
  tracks: Record<string, Key[]>;
}

/** 그리는 쪽 (도형 붙임) — 뼈 공간에서 그림. c 는 팀 색 등 */
export type Painter = (ctx: CanvasRenderingContext2D, colors: RigColors, bone: BoneDef) => void;

export interface RigColors {
  team: string;
  dark: string;
  skin: string;
  hair: string;
  pants: string;
  accent: string;
  num?: string;
  name?: string;
  /** 좌우 반전으로 그리는 중 (글자는 다시 뒤집어 씀) */
  flip?: boolean;
}

export type Attachment =
  | { kind: "shape"; paint: Painter }
  | {
      kind: "image";
      img: HTMLImageElement | null;
      /** 뼈 원점 기준 그림 왼쪽 위 */
      ox: number;
      oy: number;
      w: number;
      h: number;
      rot?: number;
      /** 팀 색 마스크 (흰 부분이 팀 색으로) */
      tint?: "team" | "dark" | "pants";
    };

/** 장비 · 몸 파츠 이름 → 붙임 */
export type Skin = Record<string, Attachment>;

interface M {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
const mul = (p: M, q: M): M => ({
  a: p.a * q.a + p.c * q.b,
  b: p.b * q.a + p.d * q.b,
  c: p.a * q.c + p.c * q.d,
  d: p.b * q.c + p.d * q.d,
  e: p.a * q.e + p.c * q.f + p.e,
  f: p.b * q.e + p.d * q.f + p.f,
});
const local = (x: number, y: number, deg: number): M => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { a: c, b: s, c: -s, d: c, e: x, f: y };
};

function ease(k: number, e?: Key["e"]) {
  switch (e) {
    case "lin":
      return k;
    case "step":
      return 0;
    case "fast":
      return 1 - (1 - k) * (1 - k) * (1 - k);
    case "slow":
      return k * k * k;
    default:
      return k * k * (3 - 2 * k);
  }
}

function sample(keys: Key[] | undefined, t: number, f: "r" | "x" | "y" | "sx"): number {
  const d = f === "sx" ? 1 : 0;
  if (!keys || !keys.length) return d;
  let prev: Key | null = null;
  for (const k of keys) {
    if (k[f] === undefined) continue;
    if (t < k.t) {
      if (!prev) return k[f]!;
      const span = k.t - prev.t;
      const kk = span > 0 ? ease((t - prev.t) / span, prev.e) : 1;
      return prev[f]! + (k[f]! - prev[f]!) * kk;
    }
    prev = k;
  }
  return prev ? prev[f]! : d;
}

/** 뼈마다 월드 행렬 (애니 a 의 t 초, 다른 애니로 넘어갈 때 섞기 mix) */
export function pose(rig: RigDef, a: Anim, t: number, from?: { a: Anim; t: number; k: number }): Map<string, M> {
  const out = new Map<string, M>();
  const tt = a.loop ? t % a.dur : Math.min(t, a.dur);
  for (const b of rig.bones) {
    let r = sample(a.tracks[b.id], tt, "r");
    let x = sample(a.tracks[b.id], tt, "x");
    let y = sample(a.tracks[b.id], tt, "y");
    if (from && from.k < 1) {
      const ft = from.a.loop ? from.t % from.a.dur : Math.min(from.t, from.a.dur);
      const k = from.k;
      r = sample(from.a.tracks[b.id], ft, "r") * (1 - k) + r * k;
      x = sample(from.a.tracks[b.id], ft, "x") * (1 - k) + x * k;
      y = sample(from.a.tracks[b.id], ft, "y") * (1 - k) + y * k;
    }
    let sx = sample(a.tracks[b.id], tt, "sx");
    if (from && from.k < 1) {
      const ft = from.a.loop ? from.t % from.a.dur : Math.min(from.t, from.a.dur);
      sx = sample(from.a.tracks[b.id], ft, "sx") * (1 - from.k) + sx * from.k;
    }
    const m = local(b.x + x, b.y + y, b.rot + r);
    if (sx !== 1) {
      m.a *= sx;
      m.b *= sx;
    }
    const p = b.parent ? out.get(b.parent) : undefined;
    out.set(b.id, p ? mul(p, m) : m);
  }
  return out;
}

/** 뼈 월드 위치 (손 · 방망이 끝 · 공 놓는 점 찾기) */
export function boneTip(rig: RigDef, ps: Map<string, M>, id: string, along = 1): [number, number] {
  const b = rig.bones.find((x) => x.id === id)!;
  const m = ps.get(id)!;
  const lx = b.len * along;
  return [m.a * lx + m.e, m.b * lx + m.f];
}

const tintCache = new Map<string, HTMLCanvasElement>();
function tinted(img: HTMLImageElement, color: string) {
  const key = img.src + color;
  let c = tintCache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext("2d")!;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = "multiply";
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = "destination-in";
  x.drawImage(img, 0, 0);
  tintCache.set(key, c);
  return c;
}

/**
 * 그리기. (x, y) 에 scale 배로, flip 이면 좌우 반전 (좌타자 · 좌투수).
 * skin 에 없는 슬롯 붙임은 base 스킨에서 찾음.
 */
export function drawRig(
  ctx: CanvasRenderingContext2D,
  rig: RigDef,
  ps: Map<string, M>,
  skin: Skin,
  colors: RigColors,
  x: number,
  y: number,
  scale: number,
  flip = false
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -scale : scale, scale);
  for (const s of rig.slots) {
    const att = skin[s.attach];
    if (!att) continue;
    const m = ps.get(s.bone);
    if (!m) continue;
    const bone = rig.bones.find((b) => b.id === s.bone)!;
    ctx.save();
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    if (att.kind === "shape") att.paint(ctx, flip ? { ...colors, flip } : colors, bone);
    else if (att.img && att.img.complete && att.img.naturalWidth) {
      if (att.rot) ctx.rotate((att.rot * Math.PI) / 180);
      const src = att.tint ? tinted(att.img, att.tint === "team" ? colors.team : att.tint === "dark" ? colors.dark : colors.pants) : att.img;
      ctx.drawImage(src, att.ox, att.oy, att.w, att.h);
    }
    ctx.restore();
  }
  ctx.restore();
}
