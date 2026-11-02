/*
 * GMTOWN 마을 — 땅 · 건물 · 장식 · 부딪힘. 서버(이동 검사)와 화면이 같이 씀 (그림 · React 없이 숫자만).
 *
 * 좌표: 1칸 = 1. x 는 오른쪽, y 는 화면 아래쪽(카메라 쪽), z 는 위.
 * 카메라는 위 35° 에서 정면으로 내려다보는 직교 시점 (에이미 스프라이트를 렌더한 각도와 같음) — 돌지 않음.
 *   화면 x = x · T,  화면 y = y · T · sin35 − z · T · cos35   (T = 1칸의 화면 px)
 * 카메라가 돌지 않아서 건물은 앞면 · 지붕만 보임 → 문은 전부 앞면(남쪽)에 있음.
 * 35° 에서 보면 높이 h 인 건물은 자기 뒤쪽 땅을 h·cos35/sin35 ≈ 1.43h 칸만큼 가림 (5층 높이면 7칸).
 * 그래서 건물 두 줄이 가운데 분수 광장을 사이에 두고 마주 봄 — 북쪽 줄(문이 북쪽 길) · 남쪽 줄(문이 남쪽 길).
 * 어느 건물 뒤에도 길 · 문이 오지 않게 (북쪽 줄 뒤는 숲, 남쪽 줄 뒤는 잔디밭). 남쪽 끝 아치가 들어오는 곳.
 */

export const WORLD = { w: 60, h: 50 } as const;
export const PITCH = (35 * Math.PI) / 180;
/** 땅 깊이(y) → 화면 세로 */
export const Y_SCALE = Math.sin(PITCH);
/** 높이(z) → 화면 세로 */
export const Z_SCALE = Math.cos(PITCH);

/** 걷는 속도 (칸/초) */
export const SPEED = 2.6;
/** 캐릭터 몸 반지름 (부딪힘) */
export const RADIUS = 0.3;
/** 들어오는 곳 (남쪽 아치 안쪽) */
export const SPAWN = { x: 30, y: 38.4 } as const;
/** 채널 하나에 들어가는 사람 수 */
export const CHANNEL_CAP = 40;
export const MAX_CHANNELS = 30;
/** 채팅 한 줄 최대 글자 */
export const CHAT_MAX = 60;

// ───────────── 땅 ─────────────

export type Ground = "grass" | "road" | "walk" | "plaza";

export const PLAZA = { x: 30, y: 26, r: 7.5 } as const;
export const FOUNTAIN = { x: 30, y: 26, r: 2.2 } as const;

/** 차 없는 길 (보도블록) — [x0, y0, x1, y1] */
export const ROADS: [number, number, number, number][] = [
  [3, 14, 57, 17], // 북쪽 길 (북쪽 줄 앞)
  [3, 24.5, 57, 27.5], // 큰길 (광장을 가로지름)
  [28, 14, 32, 47], // 가운데 길 (남북 · 아치까지)
  [3, 40, 57, 43], // 남쪽 길 (남쪽 줄 앞)
];

const inRect = (x: number, y: number, r: [number, number, number, number]) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];

export function groundAt(x: number, y: number): Ground {
  if ((x - PLAZA.x) ** 2 + (y - PLAZA.y) ** 2 < PLAZA.r ** 2) return "plaza";
  if (ROADS.some((r) => inRect(x, y, r))) return "road";
  // 건물 둘레 한 칸은 보도
  for (const b of BUILDINGS) if (x >= b.x - 0.6 && x < b.x + b.w + 0.6 && y >= b.y - 0.6 && y < b.y + b.d + 0.8) return "walk";
  return "grass";
}

// ───────────── 건물 ─────────────

/**
 * 화풍: 게임마다 그 게임 그림체 그대로 (픽셀 게임은 픽셀 건물, 애니 게임은 애니 건물).
 * 지금은 코드로 그린 뼈대 — 나중에 같은 카메라로 렌더한 모양 위에 그 화풍으로 다시 그린 그림으로 바꿈.
 */
export type BStyle = "pixel" | "anime" | "neon" | "noir" | "home";
export type Roof = "flat" | "castle" | "gable" | "dome" | "awning";

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
  /** 땅 위 네모 (왼쪽 뒤 모서리 · 가로 · 깊이) · 높이 */
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  /** 벽 · 강조 · 지붕 색 */
  wall: string;
  accent: string;
  top: string;
}

export const BUILDINGS: Building[] = [
  // 북쪽 줄 — 북쪽 길 (앞면 y = 14). 가운데가 증권거래소
  { id: "rhythm", sign: "PIXEL Rhythm Up", sub: "4키 리듬게임", href: "/games/rhythm", icon: "px:rhythm", style: "pixel", roof: "flat", x: 4, y: 9, w: 9, d: 5, h: 5, wall: "#3B2A6B", accent: "#FF4FD8", top: "#2A1D4F" },
  { id: "fight", sign: "PIXEL FIGHT", sub: "1:1 격투 아레나", href: "/games/fight", icon: "px:fight", style: "pixel", roof: "flat", x: 14, y: 9, w: 8.5, d: 5, h: 5.5, wall: "#6B2626", accent: "#FFB23F", top: "#4A1A1A" },
  { id: "stock", sign: "증권거래소", sub: "주식게임 · 솔로 · 코인 · 대전", href: "/games/stock", icon: "px:stock", style: "neon", roof: "dome", x: 23.5, y: 7, w: 13, d: 7, h: 6.5, wall: "#1A2342", accent: "#3DD6FF", top: "#121A33" },
  { id: "defense", sign: "LUCKY DEFENSE", sub: "운빨 랜덤 디펜스", href: "/games/defense", icon: "px:defense", style: "pixel", roof: "castle", x: 38, y: 9, w: 8, d: 5, h: 5.5, wall: "#5B6B5E", accent: "#7CFF6B", top: "#46534A" },
  { id: "suspect", sign: "오늘의 용의자", sub: "탐정 사무소", href: "/games/suspect", icon: "px:suspect", style: "noir", roof: "flat", x: 47.5, y: 9, w: 8.5, d: 5, h: 5, wall: "#2B2522", accent: "#F2C14E", top: "#1F1A18" },
  // 남쪽 줄 — 남쪽 길 (앞면 y = 40). 뒤(북쪽)는 잔디밭이라 가려져도 괜찮음
  { id: "poker", sign: "ANIME POKER", sub: "홀덤 · 7포커 카지노", href: "/games/poker", icon: "px:poker", style: "anime", roof: "awning", x: 4, y: 35.5, w: 9, d: 4.5, h: 5, wall: "#7A1F3A", accent: "#FFD36B", top: "#5A1529" },
  { id: "love", sign: "올인 러브", sub: "홀덤펍", href: "/games/love", icon: "px:love", style: "anime", roof: "awning", x: 14, y: 35.5, w: 7.5, d: 4.5, h: 4.5, wall: "#F2A7C3", accent: "#FF5C8A", top: "#C9708F" },
  { id: "home", sign: "우리 집", sub: "GP로 사고 꾸미는 내 집", href: null, icon: "🏠", style: "home", roof: "gable", x: 39.5, y: 34.5, w: 9, d: 5.5, h: 4.5, wall: "#F3E3C3", accent: "#E07A4F", top: "#B5533A" },
];

export const buildingById = (id: string) => BUILDINGS.find((b) => b.id === id) ?? null;

/** 문 (앞면 가운데) — 너비 */
export const doorW = (b: Building) => (b.w >= 12 ? 2.4 : 1.6);
/** 문 앞에 서면 「들어가기」 (앞면에서 1.6칸 안 · 문 너비 + 양옆 0.8) */
export function doorAt(x: number, y: number): Building | null {
  for (const b of BUILDINGS) {
    const cx = b.x + b.w / 2;
    const fy = b.y + b.d;
    if (Math.abs(x - cx) <= doorW(b) / 2 + 0.8 && y >= fy && y <= fy + 1.6) return b;
  }
  return null;
}
/** 문 바로 앞 (건물을 누르면 여기로 걸어감) */
export const doorFront = (b: Building) => ({ x: b.x + b.w / 2, y: b.y + b.d + 0.7 });

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
}
export interface Flower {
  x: number;
  y: number;
  w: number;
  d: number;
  hue: "pink" | "yellow" | "blue";
}

/** 0~1 고정 난수 (장식 위치 · 그림 흔들기용 — 서버와 화면이 같은 값) */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makeTrees(): Tree[] {
  const t: Tree[] = [];
  const add = (x: number, y: number, kind: Tree["kind"] = "round") => t.push({ x, y, s: 0.85 + hash01(x * 10, y * 10) * 0.35, kind });
  // 북쪽 숲 (북쪽 줄 뒤 — 지붕 너머로 보임)
  for (let x = 1.5; x <= 58.5; x += 2.6) add(x + hash01(x, 1) * 0.8, 3 + hash01(x, 2) * 1.6, hash01(x, 3) < 0.45 ? "pine" : "round");
  for (let x = 2.8; x <= 58; x += 3.4) add(x, 5.4 + hash01(x, 4) * 0.8, "pine");
  // 양옆 숲
  for (let y = 9; y <= 46; y += 2.8) {
    add(1.4 + hash01(1, y) * 0.6, y, hash01(2, y) < 0.5 ? "pine" : "round");
    add(58.6 - hash01(3, y) * 0.6, y + 1.2, hash01(4, y) < 0.5 ? "pine" : "round");
  }
  // 남쪽 숲 (아치 자리는 비움)
  for (let x = 2; x <= 58; x += 2.7) if (x < 24 || x > 36) add(x, 47.6 + hash01(x, 5) * 0.9, hash01(x, 6) < 0.5 ? "pine" : "round");
  // 광장 위아래 잔디밭 · 우리 집 옆 공원 (벚나무)
  for (const [x, y] of [
    [6, 20.5],
    [12.5, 21.5],
    [19, 20.2],
    [41, 20.2],
    [47.5, 21.5],
    [54, 20.5],
    [7, 30.5],
    [14, 31.5],
    [20.5, 32.5],
    [39.5, 32.5],
    [46, 31.5],
    [53, 30.5],
    [51, 36],
    [54.5, 38],
  ] as const)
    add(x, y, "blossom");
  for (const [x, y] of [
    [3.8, 22.8],
    [22.8, 22.6],
    [37.2, 22.6],
    [56.2, 22.8],
    [3.6, 33],
    [56.4, 33],
  ] as const)
    add(x, y, "round");
  return t;
}
export const TREES: Tree[] = makeTrees();

/** 가로등 — 문 앞 2칸 안은 비움 (문을 가리지 않게) */
export const LAMPS: Lamp[] = [
  ...[5, 11, 17, 23, 37, 43, 49, 55].map((x) => ({ x, y: 17.4 })),
  // 큰길은 한쪽씩 엇갈려서 (양쪽에 다 세우면 복잡함)
  ...[6, 18, 42, 54].map((x) => ({ x, y: 24.1 })),
  ...[12, 48].map((x) => ({ x, y: 27.9 })),
  // 광장에서 아치로 가는 길
  ...[36].flatMap((y) => [
    { x: 27.5, y },
    { x: 32.5, y },
  ]),
  ...[5, 11, 17, 23, 37, 43, 49, 55].map((x) => ({ x, y: 43.4 })),
].filter((l) => !BUILDINGS.some((b) => Math.abs(l.x - (b.x + b.w / 2)) < 2.2 && l.y > b.y + b.d && l.y - (b.y + b.d) < 4.5));

/** 광장 벤치 (분수를 둘러쌈) */
export const BENCHES: Bench[] = [
  { x: 24.6, y: 22.5 },
  { x: 35.4, y: 22.5 },
  { x: 24.6, y: 29.7 },
  { x: 35.4, y: 29.7 },
];

export const FLOWERS: Flower[] = [
  { x: 22.6, y: 34.6, w: 3, d: 1.2, hue: "pink" },
  { x: 34.4, y: 34.6, w: 3, d: 1.2, hue: "yellow" },
  { x: 7.5, y: 18.2, w: 3, d: 0.9, hue: "yellow" },
  { x: 49.5, y: 18.2, w: 3, d: 0.9, hue: "pink" },
  { x: 17, y: 38.8, w: 3, d: 0.9, hue: "blue" },
  { x: 50, y: 39, w: 2.6, d: 0.9, hue: "pink" },
];

/** 남쪽 아치 (기둥 둘 · 위에 GMTOWN 간판) */
export const ARCH = { x0: 25.6, x1: 34.4, y: 45.4, h: 4.2 } as const;
/** 안내판 (눌러서 도움말) */
export const BOARD = { x: 35.2, y: 42.3 } as const;

// ───────────── 부딪힘 ─────────────

export const BOUNDS = { x0: 2.6, y0: 13.8, x1: WORLD.w - 2.6, y1: 46.6 } as const;

/** (x, y) 에 반지름 r 인 몸이 들어갈 수 있는지 */
export function blocked(x: number, y: number, r = RADIUS): boolean {
  // 걸을 수 있는 곳: 북쪽 길부터 남쪽 숲 앞까지 (줄 A 건물 뒤 · 숲 속은 못 들어감)
  if (x < BOUNDS.x0 + r || y < BOUNDS.y0 + r || x > BOUNDS.x1 - r || y > BOUNDS.y1 - r) return true;
  for (const b of BUILDINGS) if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.d + r * 0.4) return true;
  if ((x - FOUNTAIN.x) ** 2 + (y - FOUNTAIN.y) ** 2 < (FOUNTAIN.r + r) ** 2) return true;
  for (const t of TREES) if ((x - t.x) ** 2 + (y - t.y) ** 2 < (0.38 * t.s + r) ** 2) return true;
  for (const l of LAMPS) if ((x - l.x) ** 2 + (y - l.y) ** 2 < (0.14 + r) ** 2) return true;
  for (const bn of BENCHES) if (x > bn.x - 0.85 - r && x < bn.x + 0.85 + r && y > bn.y - 0.25 - r && y < bn.y + 0.25 + r) return true;
  for (const f of FLOWERS) if (x > f.x - r && x < f.x + f.w + r && y > f.y - r && y < f.y + f.d + r) return true;
  for (const px of [ARCH.x0, ARCH.x1]) if ((x - px) ** 2 + (y - ARCH.y) ** 2 < (0.55 + r) ** 2) return true;
  if ((x - BOARD.x) ** 2 + (y - BOARD.y) ** 2 < (0.35 + r) ** 2) return true;
  return false;
}

/** 8방향 (0 = 위(등) … 4 = 아래(얼굴), 시계 방향) — 이동 방향 (dx, dy: 땅 좌표) 에서 */
export function dir8(dx: number, dy: number): number {
  const a = Math.atan2(dx, -dy); // 0 = 위, π/2 = 오른쪽
  return (Math.round(a / (Math.PI / 4)) + 8) % 8;
}
