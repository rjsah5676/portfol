/*
 * GMTOWN 마을 — 땅 · 높이 · 부지 · 장식 · 부딪힘. 서버(이동 검사)와 화면이 같이 씀 (그림 · React 없이 숫자만).
 *
 * 좌표: 1 = 1m. x 는 동쪽, y 는 남쪽(3D 의 z), 높이는 heightAt(x, y).
 * 원근 3D 카메라라서 건물 방향 · 뒤에 가려짐 제약이 없음 — 진짜 마을처럼 짬 (배치도: claude/2026-11-03-gmtown-perspective-3d-log.md 이후 v2).
 *
 * 배치 (200 × 180m):
 *   가운데 중앙 광장(분수) · 북쪽 정면에 랜드마크 부지 · 둘레 순환로.
 *   남쪽: 마을 역(들어오는 곳) → 중앙대로 양옆 게임 거리.
 *   북쪽: 언덕(전망 공원 · 계단길) · 북서 꼭대기 성 · 북동 언덕 학교.
 *   서쪽: 상점가(동서로 긴 거리) · 뒷골목 · 주택가(한가운데 우리 집 단지 입구).
 *   동쪽: 강(둑길 · 다리 둘) · 강 건너 부지 둘 · 호수 공원.
 * 건물은 아직 없음 — 부지(lot)만. 부지를 건물로 바꾸면 그 자리에 들어섬.
 */

export const WORLD = { w: 200, h: 180 } as const;
/** (옛 쿼터뷰) 기본 높이각 · 카메라가 처음 있는 쪽 (남쪽 — 역에서 광장을 바라봄) */
export const PITCH = (35 * Math.PI) / 180;
export const YAW = 0;

/** 걷는 속도 (m/초) */
export const SPEED = 2.8;
/** 뛰는 속도 (m/초) — Shift · 먼 곳 누르기 · 조이스틱 끝까지 */
export const RUN_SPEED = SPEED * 2;
/** 캐릭터 몸 반지름 (부딪힘) */
export const RADIUS = 0.3;
/** 들어오는 곳 (역 앞 중앙대로) */
export const SPAWN = { x: 101.6, y: 147.6 } as const;
/** 채널 하나에 들어가는 사람 수 */
export const CHANNEL_CAP = 40;
export const MAX_CHANNELS = 30;
/** 채팅 한 줄 최대 글자 */
export const CHAT_MAX = 60;

// ───────────── 고정 난수 ─────────────

/** 0~1 고정 난수 (장식 위치 · 그림 흔들기용 — 서버와 화면이 같은 값) */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** 부드러운 값 잡음 (숲 덩어리 · 땅 울퉁불퉁) */
function noise(x: number, y: number, s: number): number {
  const fx = x / s,
    fy = y / s;
  const ix = Math.floor(fx),
    iy = Math.floor(fy);
  const u = fx - ix,
    v = fy - iy;
  const k = (a: number, b: number) => hash01(a * 7 + 13, b * 11 + 5);
  const su = u * u * (3 - 2 * u),
    sv = v * v * (3 - 2 * v);
  return (
    k(ix, iy) * (1 - su) * (1 - sv) +
    k(ix + 1, iy) * su * (1 - sv) +
    k(ix, iy + 1) * (1 - su) * sv +
    k(ix + 1, iy + 1) * su * sv
  );
}
/** a → b 사이에서 0 → 1 (부드럽게) */
function ss(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ───────────── 광장 · 강 · 호수 ─────────────

export const PLAZA = { x: 100, y: 100, r: 15 } as const;
/** 언덕 꼭대기 전망 공원 (평평한 마당) */
export const PARK = { x: 94, y: 24, r: 11 } as const;
export const FOUNTAIN = { x: 100, y: 100, r: 3.45 } as const;
/** 강 건너 호수 공원 */
export const LAKE = { x: 179, y: 150, rx: 9, ry: 7 } as const;

/** 강 가운데 (남북으로 흐르며 구불) · 물 폭 반 · 둑 바깥까지 반 */
export const RIVER = { half: 6, bank: 9 } as const;
export const riverX = (y: number) => 150 + 8 * Math.sin(y / 32) + 0.06 * y;
/** 다리 (강을 동서로 건넘): 가운데 y · 폭(남북) */
export const BRIDGES = [
  { y: 100, w: 6 },
  { y: 140, w: 5 },
] as const;
/** 다리 위 높이 */
export const BRIDGE_H = 0.45;
export function onBridge(x: number, y: number): boolean {
  for (const b of BRIDGES)
    if (Math.abs(y - b.y) < b.w / 2 && Math.abs(x - riverX(b.y)) < RIVER.bank + 1.5) return true;
  return false;
}

export interface Path {
  /** 꺾이는 점들 */
  pts: [number, number][];
  /** 너비 (m) */
  w: number;
  /** stone = 돌 · 보도블록 큰길, dirt = 흙길 · 산책로, rail = 철길 자갈 */
  kind: "stone" | "dirt" | "rail";
}

/** 둑길 (강을 따라 양쪽) */
function bankPath(side: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 12; y <= 168; y += 6) out.push([riverX(y) + side * (RIVER.bank + 1.2), y]);
  return out;
}

/** 길은 그림 (땅은 어디든 걸을 수 있음) — 나무 · 장식이 길 위에 안 오게 하는 데도 씀 */
export const PATHS: Path[] = [
  // 중앙대로 (역 → 광장)
  { pts: [[100, 114], [100, 152]], w: 10, kind: "stone" },
  // 광장 북쪽 → 랜드마크 앞
  { pts: [[100, 76], [100, 86]], w: 8, kind: "stone" },
  // 상점가 (광장 서쪽으로 길게)
  { pts: [[16, 100], [86, 100]], w: 7, kind: "stone" },
  // 광장 동쪽 → 다리 → 강 건너
  { pts: [[114, 100], [194, 100]], w: 7, kind: "stone" },
  // 순환로
  { pts: [[60, 56], [140, 56], [140, 146], [60, 146], [60, 56]], w: 6, kind: "stone" },
  // 언덕 계단길 (순환로 북쪽 → 전망 공원)
  { pts: [[100, 56], [92, 48], [104, 40], [95, 29]], w: 3.6, kind: "dirt" },
  // 성으로 · 학교로
  { pts: [[60, 56], [54, 46], [50, 42]], w: 4, kind: "dirt" },
  { pts: [[140, 56], [137, 46]], w: 4, kind: "dirt" },
  // 탐정사무소 골목
  { pts: [[44, 100], [44, 94]], w: 3, kind: "stone" },
  // 주택가 골목
  { pts: [[26, 100], [26, 164]], w: 4, kind: "stone" },
  { pts: [[54, 100], [54, 164]], w: 4, kind: "stone" },
  { pts: [[18, 118], [60, 118]], w: 4, kind: "stone" },
  { pts: [[18, 142], [60, 142]], w: 4, kind: "stone" },
  { pts: [[18, 160], [60, 160]], w: 4, kind: "stone" },
  { pts: [[40, 118], [40, 124]], w: 3, kind: "stone" },
  // 아래 다리 길
  { pts: [[140, 140], [riverX(140) - RIVER.bank, 140]], w: 5, kind: "stone" },
  { pts: [[riverX(140) + RIVER.bank, 140], [186, 140]], w: 5, kind: "stone" },
  // 둑길 (강 양쪽)
  { pts: bankPath(-1), w: 3, kind: "dirt" },
  { pts: bankPath(1), w: 3, kind: "dirt" },
  // 철길 (역 뒤)
  { pts: [[14, 167], [186, 167]], w: 3.2, kind: "rail" },
];

/** 점에서 선분까지 거리 */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
/** 가장 가까운 길 가장자리까지 (음수 = 길 위) */
export function pathDist(x: number, y: number): number {
  let best = Infinity;
  for (const p of PATHS)
    for (let i = 0; i < p.pts.length - 1; i++)
      best = Math.min(
        best,
        segDist(x, y, p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1]) - p.w / 2
      );
  return best;
}

// ───────────── 건물 · 부지 ─────────────

/**
 * 화풍: 게임마다 그 게임 그림체 그대로 (픽셀 게임은 픽셀 건물, 애니 게임은 애니 건물).
 * 지금은 모두 부지(lot) — 건물을 다시 지을 때 style · model 을 채움.
 */
export type BStyle = "pixel" | "anime" | "neon" | "noir" | "home" | "lot";
export type Roof = "flat" | "castle" | "gable" | "awning" | "none";
/** 앞면(문)이 보는 쪽: y = 남(+y) · -y = 북 · x = 동(+x) · -x = 서 */
export type Face = "x" | "y" | "-x" | "-y";

export interface Building {
  id: string;
  /** 간판 글자 */
  sign: string;
  /** 간판 아래 작은 글자 */
  sub: string;
  /** 들어가면 가는 곳 (null = 아직 준비 중) */
  href: string | null;
  /** 아이콘 (메뉴와 같은 px:키 또는 이모지) */
  icon: string;
  style: BStyle;
  roof: Roof;
  /** 땅 위 네모 (북서 모서리 · 동서 폭 w · 남북 폭 d) · 높이 */
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  face: Face;
  /** 벽 · 강조 · 지붕 색 */
  wall: string;
  accent: string;
  top: string;
  /** 덧칠한 3D 모델 (없으면 코드 뼈대) */
  model?: string;
}

const lot = (
  id: string,
  sign: string,
  x: number,
  y: number,
  w: number,
  d: number,
  face: Face,
  sub = "건물이 들어설 자리"
): Building => ({
  id,
  sign,
  sub,
  href: null,
  icon: "🚧",
  style: "lot",
  roof: "none",
  x,
  y,
  w,
  d,
  h: 0,
  face,
  wall: "#C9B48A",
  accent: "#F2C14E",
  top: "#C9B48A",
});

/** 부지 (번호는 배치도 v2) */
export const BUILDINGS: Building[] = [
  lot("lot-stock", "증권거래소 자리", 86, 62, 28, 14, "y", "광장 북쪽 랜드마크"),
  lot("lot-fight", "PIXEL FIGHT 자리", 74, 119, 14, 12, "x"),
  lot("lot-rhythm", "RHYTHM UP 자리", 112, 119, 14, 12, "-x"),
  lot("lot-poker", "포커 자리", 74, 133, 14, 11, "x"),
  lot("lot-love", "올인 러브 자리", 112, 133, 14, 11, "-x"),
  lot("lot-suspect", "용의자 자리", 37, 83, 14, 11, "y", "뒷골목 탐정사무소"),
  lot("lot-defense", "디펜스 성 자리", 38, 24, 24, 18, "y", "북서 언덕 꼭대기"),
  lot("lot-home", "우리 집 자리", 31, 124, 18, 14, "-y", "주택 단지 입구"),
  lot("lot-9", "새 게임 자리", 117, 62, 19, 14, "y"),
  lot("lot-10", "새 게임 자리", 64, 62, 19, 14, "y"),
  lot("lot-11", "새 게임 자리", 166, 82, 16, 12, "y", "강 건너"),
  lot("lot-12", "새 게임 자리", 166, 112, 16, 12, "-y", "강 건너"),
  lot("lot-school", "언덕 위 학교 자리", 124, 30, 26, 16, "y", "새 게임 자리"),
  lot("lot-station", "마을 역 자리", 84, 153, 32, 9, "-y", "들어오는 곳"),
];

export const buildingById = (id: string) => BUILDINGS.find((b) => b.id === id) ?? null;
export const isLot = (b: Building) => b.style === "lot";

/** 앞면이 보는 쪽 (바깥 방향 단위 벡터) */
export function faceDir(b: Building): { x: number; y: number } {
  return b.face === "y"
    ? { x: 0, y: 1 }
    : b.face === "-y"
      ? { x: 0, y: -1 }
      : b.face === "x"
        ? { x: 1, y: 0 }
        : { x: -1, y: 0 };
}
/** 3D 에서 앞면(로컬 +z)을 그쪽으로 돌리는 각 */
export function faceRot(b: Building): number {
  return b.face === "y" ? 0 : b.face === "-y" ? Math.PI : b.face === "x" ? Math.PI / 2 : -Math.PI / 2;
}
/** 앞면 길이 (문이 있는 면) */
export const frontLen = (b: Building) => (b.face === "y" || b.face === "-y" ? b.w : b.d);
/** 문 너비 */
export const doorW = (b: Building) => (frontLen(b) >= 12 ? 2.4 : 1.6);
/** 문 가운데 (앞면 위) */
export function doorPoint(b: Building): { x: number; y: number } {
  const f = faceDir(b);
  return { x: b.x + b.w / 2 + (f.x * b.w) / 2, y: b.y + b.d / 2 + (f.y * b.d) / 2 };
}
/** 빈 터 팻말 자리 (앞쪽 가운데, 앞면에서 1.2m 안) */
export function lotSign(b: Building): { x: number; y: number } {
  const p = doorPoint(b),
    f = faceDir(b);
  return { x: p.x - f.x * 1.2, y: p.y - f.y * 1.2 };
}
/** 문 앞에 서면 「들어가기」 (앞면에서 1.6m 안 · 문 너비 + 양옆 0.8) — 빈 터는 팻말 앞 */
export function doorAt(x: number, y: number): Building | null {
  for (const b of BUILDINGS) {
    if (isLot(b)) {
      const s = lotSign(b);
      if (Math.hypot(x - s.x, y - s.y) < 2) return b;
      continue;
    }
    const p = doorPoint(b),
      f = faceDir(b);
    const half = doorW(b) / 2 + 0.8;
    const out = (x - p.x) * f.x + (y - p.y) * f.y,
      along = Math.abs((x - p.x) * f.y - (y - p.y) * f.x);
    if (along <= half && out >= 0 && out <= 1.6) return b;
  }
  return null;
}
/** 문 바로 앞 (건물을 누르면 여기로 걸어감) */
export function doorFront(b: Building): { x: number; y: number } {
  const f = faceDir(b);
  if (isLot(b)) {
    const s = lotSign(b);
    return { x: s.x + f.x, y: s.y + f.y };
  }
  const p = doorPoint(b);
  return { x: p.x + f.x * 0.7, y: p.y + f.y * 0.7 };
}

// ───────────── 높이 ─────────────

/** 땅 그대로의 높이 (강바닥 포함 — 다리는 heightAt) */
export function terrainH(x: number, y: number): number {
  let h = rawH(x, y);
  // 살짝 울퉁불퉁
  h += (noise(x + 300, y + 300, 17) - 0.5) * 0.9 * (1 - flatK(x, y));
  // 마을 밖 산 (걸을 수 있는 곳 밖으로 갈수록 높게)
  const edge = Math.min(x - 10, WORLD.w - 10 - x, y - 10, WORLD.h - 10 - y);
  if (edge < 0)
    h +=
      (-edge * 0.45 + 10 * ss(0, -40, edge) * noise(x, y, 23)) *
      (0.15 + 0.85 * ss(RIVER.bank, RIVER.bank + 30, Math.abs(x - riverX(y))));
  // 부지 · 광장 · 역은 평평하게 (부지는 자기 가운데 높이로)
  h = flatten(x, y, h);
  // 강: 둑 → 강바닥 · 호수
  const dr = Math.abs(x - riverX(y));
  h += (-1.8 - h) * ss(RIVER.bank, RIVER.half - 0.5, dr);
  const le = Math.hypot((x - LAKE.x) / LAKE.rx, (y - LAKE.y) / LAKE.ry);
  h += (-1.4 - h) * ss(1.25, 0.9, le);
  return h;
}
/** 평평하게 할 곳 근처 정도 (0 ~ 1) — 잡음을 줄이는 데 */
function flatK(x: number, y: number): number {
  let k = ss(PLAZA.r + 8, PLAZA.r, Math.hypot(x - PLAZA.x, y - PLAZA.y));
  k = Math.max(k, ss(PARK.r + 6, PARK.r, Math.hypot(x - PARK.x, y - PARK.y)));
  for (const b of BUILDINGS) k = Math.max(k, lotK(b, x, y));
  return k;
}
/** 부지 안 = 1, 둘레에 걸쳐 0 으로 (높은 곳 부지일수록 넓게 — 둘레가 벼랑이 안 되게) */
function lotK(b: Building, x: number, y: number): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w)),
    dy = Math.max(b.y - y, 0, y - (b.y + b.d));
  return ss(6 + (lotLevel.get(b.id) ?? 0) * 0.9, 1.5, Math.hypot(dx, dy));
}
/** 부지 가운데의 원래 높이 (평평하게 맞출 높이) */
const lotLevel = new Map<string, number>();
/** 큰 지형: 북쪽 언덕 (가운데 전망 공원이 제일 높고 양옆으로 낮아짐) + 북서 성 언덕 · 북동 학교 언덕 */
function rawH(x: number, y: number): number {
  let h = 12 * ss(60, 22, y) * (1 - 0.5 * ss(20, 64, Math.abs(x - 95)));
  h += 6.5 * Math.exp(-(((x - 50) / 22) ** 2 + ((y - 32) / 17) ** 2));
  h += 4.5 * Math.exp(-(((x - 137) / 20) ** 2 + ((y - 38) / 15) ** 2));
  // 강을 따라 넓은 골짜기 (강가는 낮게 — 벼랑이 안 생기게)
  return h * (0.12 + 0.88 * ss(RIVER.bank, RIVER.bank + 26, Math.abs(x - riverX(y))));
}
for (const b of BUILDINGS) lotLevel.set(b.id, rawH(b.x + b.w / 2, b.y + b.d / 2));
const parkLevel = rawH(PARK.x, PARK.y);
function flatten(x: number, y: number, h: number): number {
  const kp = ss(PLAZA.r + 8, PLAZA.r + 1, Math.hypot(x - PLAZA.x, y - PLAZA.y));
  h += (0 - h) * kp;
  h += (parkLevel - h) * ss(PARK.r + 6, PARK.r, Math.hypot(x - PARK.x, y - PARK.y));
  for (const b of BUILDINGS) {
    const k = lotK(b, x, y);
    if (k > 0) h += (lotLevel.get(b.id)! - h) * k;
  }
  return h;
}
/** 서 있는 높이 (다리 위면 다리, 아니면 땅) */
export function heightAt(x: number, y: number): number {
  if (onBridge(x, y)) return BRIDGE_H;
  return terrainH(x, y);
}

// ───────────── 장식 ─────────────

export interface Tree {
  x: number;
  y: number;
  /** 크기 (1 = 보통) */
  s: number;
  kind: "round" | "pine" | "blossom";
}
export interface Lamp {
  x: number;
  y: number;
}
export interface Bench {
  x: number;
  y: number;
  /** 앉는 사람이 보는 방향 (라디안, 0 = +x) */
  a: number;
}
export interface Flower {
  x: number;
  y: number;
  r: number;
  hue: "pink" | "yellow" | "white" | "purple";
}
/** 주택가 집 마당 (나중에 진짜 집이 들어설 자리 — 지금은 마당만) */
export interface Yard {
  x: number;
  y: number;
  w: number;
  d: number;
}

/** 역 앞 아치 (중앙대로를 가로지름, 기둥 둘 · 위에 간판) */
export const ARCH = { x: 100, y: 150.5, w: 11.6, h: 5.6 } as const;
/** 아치 기둥 위치 (동서로) */
export const archPosts = () => [
  { x: ARCH.x - ARCH.w / 2, y: ARCH.y },
  { x: ARCH.x + ARCH.w / 2, y: ARCH.y },
];
/** 안내판 (눌러서 도움말) — 역에서 나오자마자 보이는 길가 */
export const BOARD = { x: 99.4, y: 146.6 } as const;

/** 주택가 마당: 골목 사이 칸에 고르게 */
function makeYards(): Yard[] {
  const out: Yard[] = [];
  const home = buildingById("lot-home")!;
  for (let gx = 17; gx < 60; gx += 6.2)
    for (let gy = 104; gy < 166; gy += 6.8) {
      const y: Yard = { x: gx, y: gy, w: 4.6, d: 4.4 };
      const cx = y.x + y.w / 2,
        cy = y.y + y.d / 2;
      if (pathDist(cx, cy) < 2.4) continue;
      if (cx > home.x - 2.5 && cx < home.x + home.w + 2.5 && cy > home.y - 2.5 && cy < home.y + home.d + 2.5)
        continue;
      out.push(y);
    }
  return out;
}
export const YARDS: Yard[] = makeYards();
const inYard = (x: number, y: number, pad: number) =>
  YARDS.some((q) => x > q.x - pad && x < q.x + q.w + pad && y > q.y - pad && y < q.y + q.d + pad);

/** 부지를 둘러싼 여유 (나무가 안 붙게) */
function nearBuilding(x: number, y: number, pad: number): boolean {
  for (const b of BUILDINGS) {
    const f = faceDir(b);
    // 앞마당은 더 넓게 비움
    const x0 = b.x - pad + Math.min(0, f.x * 4),
      x1 = b.x + b.w + pad + Math.max(0, f.x * 4),
      y0 = b.y - pad + Math.min(0, f.y * 4),
      y1 = b.y + b.d + pad + Math.max(0, f.y * 4);
    if (x > x0 && x < x1 && y > y0 && y < y1) return true;
  }
  return false;
}
const inLake = (x: number, y: number, pad: number) =>
  ((x - LAKE.x) / (LAKE.rx + pad)) ** 2 + ((y - LAKE.y) / (LAKE.ry + pad)) ** 2 < 1;
const nearRiver = (x: number, y: number, pad: number) => Math.abs(x - riverX(y)) < RIVER.bank + pad;

/** 장식을 둘 수 없는 곳 (광장 · 길 · 부지 · 강 · 호수 · 마당 · 들어오는 곳) */
function busy(x: number, y: number, pad: number): boolean {
  if (Math.hypot(x - PLAZA.x, y - PLAZA.y) < PLAZA.r + pad + 1) return true;
  if (pathDist(x, y) < pad) return true;
  if (nearBuilding(x, y, pad + 1)) return true;
  if (inLake(x, y, pad + 0.6)) return true;
  if (nearRiver(x, y, pad)) return true;
  if (inYard(x, y, pad + 0.4)) return true;
  if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 4 + pad) return true;
  if (Math.abs(y - ARCH.y) < 1.5 + pad && Math.abs(x - ARCH.x) < ARCH.w / 2 + 1.5 + pad) return true;
  if (Math.hypot(x - BOARD.x, y - BOARD.y) < 1.5 + pad) return true;
  // 전망 공원 마당 (큰 벚나무만)
  if (Math.hypot(x - PARK.x, y - PARK.y) < PARK.r - 1 + pad) return true;
  return false;
}

function makeTrees(): Tree[] {
  const t: Tree[] = [];
  const kindAt = (x: number, y: number): Tree["kind"] => {
    const r = hash01(x * 31, y * 17);
    // 언덕 꼭대기 공원 · 광장 둘레 · 호숫가 · 둑은 벚나무, 북쪽 산은 소나무가 많게
    if (Math.hypot(x - 96, y - 24) < 16 || inLake(x, y, 7) || nearRiver(x, y, 4))
      return r < 0.6 ? "blossom" : "round";
    return r < (y < 46 || y > WORLD.h - 8 ? 0.62 : 0.32) ? "pine" : "round";
  };
  for (let gy = -60; gy < WORLD.h + 60; gy += 2.4)
    for (let gx = -60; gx < WORLD.w + 60; gx += 2.4) {
      const x = gx + (hash01(gx * 10, gy * 10) - 0.5) * 1.9;
      const y = gy + (hash01(gx * 10 + 3, gy * 10 + 7) - 0.5) * 1.9;
      const edge = Math.min(x - 10, y - 10, WORLD.w - 10 - x, WORLD.h - 10 - y);
      // 바깥 숲(걸을 수 있는 곳 밖)은 빽빽하게, 안쪽은 덩어리 잡음으로 듬성듬성 (언덕은 조금 더)
      let p: number;
      if (edge < 0) p = Math.max(0, 0.9 + edge * 0.012) * (0.55 + noise(x, y, 11) * 0.7);
      else if (edge < 6) p = 0.5 + (noise(x, y, 7) - 0.5) * 0.6;
      else p = noise(x, y, 9) > (y < 58 ? 0.55 : 0.66) ? 0.45 : 0.02;
      if (hash01(gx * 10 + 1, gy * 10 + 2) > p) continue;
      if (busy(x, y, 1.6)) continue;
      t.push({ x, y, s: 0.8 + hash01(gx * 10 + 5, gy * 10 + 9) * 0.5, kind: kindAt(x, y) });
    }
  // 광장 둘레 벚나무 (길 사이마다)
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + 0.13;
    const x = PLAZA.x + Math.cos(a) * (PLAZA.r + 2.6),
      y = PLAZA.y + Math.sin(a) * (PLAZA.r + 2.6);
    if (pathDist(x, y) < 1.4 || nearBuilding(x, y, 1)) continue;
    t.push({ x, y, s: 0.95, kind: "blossom" });
  }
  // 중앙대로 가로수 (양쪽 보도)
  for (let y = 120; y <= 144; y += 6)
    for (const x of [94.2, 105.8]) t.push({ x, y, s: 0.85, kind: y % 12 === 0 ? "blossom" : "round" });
  // 전망 공원 큰 벚나무
  t.push({ x: 92, y: 22, s: 1.9, kind: "blossom" });
  return t;
}
export const TREES: Tree[] = makeTrees();

/** 가로등: 광장 둘레 + 큰길을 따라 엇갈려서 (흙길 · 철길은 빼고) */
function makeLamps(): Lamp[] {
  const out: Lamp[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    out.push({ x: PLAZA.x + Math.cos(a) * (PLAZA.r - 0.8), y: PLAZA.y + Math.sin(a) * (PLAZA.r - 0.8) });
  }
  for (const p of PATHS) {
    if (p.kind !== "stone") continue;
    let acc = 4,
      side = 1;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [ax, ay] = p.pts[i],
        [bx, by] = p.pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / len,
        ny = (bx - ax) / len;
      for (let s = 0; s < len; s += 1) {
        if ((acc += 1) < 13) continue;
        const x = ax + ((bx - ax) * s) / len + nx * side * (p.w / 2 + 0.5),
          y = ay + ((by - ay) * s) / len + ny * side * (p.w / 2 + 0.5);
        if (
          Math.hypot(x - PLAZA.x, y - PLAZA.y) < PLAZA.r + 2 ||
          nearBuilding(x, y, 1.2) ||
          nearRiver(x, y, 0.5) ||
          inYard(x, y, 0.6) ||
          pathDist(x, y) < -0.2 ||
          out.some((l) => Math.hypot(l.x - x, l.y - y) < 7)
        )
          continue;
        // 문 앞은 비움
        if (BUILDINGS.some((b) => Math.hypot(x - doorFront(b).x, y - doorFront(b).y) < 3.2))
          continue;
        out.push({ x, y });
        acc = 0;
        side = -side;
      }
    }
  }
  return out;
}
export const LAMPS: Lamp[] = makeLamps();

/** 광장 벤치 (분수를 둘러싸고 분수를 봄) + 전망 공원 · 둑길 · 호숫가 */
export const BENCHES: Bench[] = [
  ...[0.4, 1.2, 2.0, 2.75, 3.55, 4.35, 5.15, 5.9].map((a) => ({
    x: PLAZA.x + Math.cos(a) * 8.2,
    y: PLAZA.y + Math.sin(a) * 8.2,
    a: a + Math.PI,
  })),
  { x: 88, y: 27, a: Math.PI / 2 },
  { x: 92.5, y: 27.5, a: Math.PI / 2 },
  { x: riverX(120) - RIVER.bank - 3.4, y: 120, a: 0 },
  { x: riverX(78) - RIVER.bank - 3.4, y: 78, a: 0 },
  { x: LAKE.x - LAKE.rx - 2.2, y: LAKE.y, a: 0 },
];

/** 꽃밭 (밟고 지나갈 수 있음) */
function makeFlowers(): Flower[] {
  const out: Flower[] = [];
  const hues: Flower["hue"][] = ["pink", "yellow", "white", "purple"];
  for (let i = 0; i < 900 && out.length < 46; i++) {
    const x = 14 + hash01(i, 91) * (WORLD.w - 28),
      y = 14 + hash01(i, 37) * (WORLD.h - 28);
    const r = 1.4 + hash01(i, 53) * 1.6;
    if (busy(x, y, r * 0.6) || TREES.some((t) => Math.hypot(t.x - x, t.y - y) < r + 0.8)) continue;
    if (out.some((f) => Math.hypot(f.x - x, f.y - y) < f.r + r + 3)) continue;
    out.push({ x, y, r, hue: hues[i % 4] });
  }
  return out;
}
export const FLOWERS: Flower[] = makeFlowers();

// ───────────── 부딪힘 ─────────────

/** 걸을 수 있는 네모 (바깥은 숲 · 산) */
export const BOUNDS = { x0: 10, y0: 10, x1: WORLD.w - 10, y1: WORLD.h - 10 } as const;

// 나무는 많아서 4m 칸으로 나눠 둠 (가까운 것만 검사)
const TG = 4;
const treeGrid = new Map<number, Tree[]>();
for (const t of TREES) {
  if (t.x < BOUNDS.x0 - 2 || t.y < BOUNDS.y0 - 2 || t.x > BOUNDS.x1 + 2 || t.y > BOUNDS.y1 + 2)
    continue;
  const k = Math.floor(t.x / TG) * 1000 + Math.floor(t.y / TG);
  let l = treeGrid.get(k);
  if (!l) treeGrid.set(k, (l = []));
  l.push(t);
}

/** (x, y) 에 반지름 r 인 몸이 들어갈 수 있는지 */
export function blocked(x: number, y: number, r = RADIUS): boolean {
  if (x < BOUNDS.x0 + r || y < BOUNDS.y0 + r || x > BOUNDS.x1 - r || y > BOUNDS.y1 - r) return true;
  // 너무 가파른 곳 (기울기 1 넘게 — 강가 벼랑 같은 곳)
  if (!onBridge(x, y)) {
    const e = 0.5;
    const gx = heightAt(x + e, y) - heightAt(x - e, y),
      gy = heightAt(x, y + e) - heightAt(x, y - e);
    if (gx * gx + gy * gy > (2 * e * 1.0) ** 2) return true;
  }
  // 강 (다리 위는 지나감, 다리 난간 밖은 막힘)
  const dr = Math.abs(x - riverX(y));
  if (dr < RIVER.half + 1.2 + r) {
    const br = BRIDGES.find((b) => Math.abs(y - b.y) < b.w / 2 + 1);
    if (!br || Math.abs(y - br.y) > br.w / 2 - 0.35 - r) return true;
  }
  for (const b of BUILDINGS) {
    if (isLot(b)) {
      // 팻말 (기둥 둘 · 앞면과 나란히 2m)
      const s = lotSign(b),
        f = faceDir(b);
      const along = Math.abs((x - s.x) * f.y - (y - s.y) * f.x),
        across = Math.abs((x - s.x) * f.x + (y - s.y) * f.y);
      if (along < 1.05 + r && across < 0.1 + r) return true;
      continue;
    }
    if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.d + r) {
      // 앞면 쪽은 조금 너그럽게 (문 앞까지 붙어 설 수 있게)
      const p = doorPoint(b),
        f = faceDir(b);
      if ((x - p.x) * f.x + (y - p.y) * f.y > -r * 0.6) continue;
      return true;
    }
  }
  if ((x - FOUNTAIN.x) ** 2 + (y - FOUNTAIN.y) ** 2 < (FOUNTAIN.r + r) ** 2) return true;
  if (inLake(x, y, r - 0.2)) return true;
  const gx = Math.floor(x / TG),
    gy = Math.floor(y / TG);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const l = treeGrid.get((gx + i) * 1000 + gy + j);
      if (l)
        for (const t of l) if ((x - t.x) ** 2 + (y - t.y) ** 2 < (0.4 * t.s + r) ** 2) return true;
    }
  for (const l of LAMPS) if ((x - l.x) ** 2 + (y - l.y) ** 2 < (0.15 + r) ** 2) return true;
  for (const bn of BENCHES) if ((x - bn.x) ** 2 + (y - bn.y) ** 2 < (0.72 + r) ** 2) return true;
  for (const p of archPosts()) if ((x - p.x) ** 2 + (y - p.y) ** 2 < (0.5 + r) ** 2) return true;
  if ((x - BOARD.x) ** 2 + (y - BOARD.y) ** 2 < (0.45 + r) ** 2) return true;
  return false;
}

/** 8방향 (0 = 화면 위(등) … 4 = 화면 아래(얼굴), 시계 방향) — (dx: 화면 오른쪽, dy: 화면 아래 = 카메라 쪽) */
export function dir8(dx: number, dy: number): number {
  const a = Math.atan2(dx, -dy); // 0 = 위, π/2 = 오른쪽
  return (Math.round(a / (Math.PI / 4)) + 8) % 8;
}
/** 땅 위 이동 (x, y) → 카메라 기준 (오른쪽, 카메라 쪽) — 스프라이트 방향 고르기. yaw = 카메라가 있는 쪽 (기본 남동) */
export function toCam(vx: number, vy: number, yaw = YAW): [number, number] {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return [vx * c - vy * s, vx * s + vy * c];
}
/** 화면 방향 (오른쪽 sx, 아래 sy — px 비율) → 땅 위 방향 (화면에서 그 방향으로 보이게, 세로는 sin35 로 눌린 것을 펴서) */
export function fromScreen(sx: number, sy: number, yaw = YAW, pitch = PITCH): [number, number] {
  const u = sx,
    v = sy / Math.sin(pitch);
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return [u * c + v * s, v * c - u * s];
}

