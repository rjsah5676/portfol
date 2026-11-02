/*
 * GMTOWN 마을 — 땅 · 건물 · 장식 · 부딪힘. 서버(이동 검사)와 화면이 같이 씀 (그림 · React 없이 숫자만).
 *
 * 좌표: 1 = 1m. x 는 동쪽, y 는 남쪽(3D 의 z), 높이는 따로.
 * 카메라는 고정 쿼터뷰: 위 35° · 남동쪽(+x +y) 45° 에서 북서쪽을 내려다보는 직교 시점 (에이미 스프라이트를 렌더한 각도).
 *   화면 위 = 북서(−x −y) · 화면 아래 = 남동(+x +y) · +x = 화면 오른쪽 아래 · +y = 화면 왼쪽 아래.
 * 그래서 건물 앞면(문)은 +x 나 +y 쪽만 — 그쪽 두 면이 카메라에 보임 (face).
 * 높이 h 인 건물은 자기 뒤(북서)쪽 땅을 h/tan35 ≈ 1.43h m 가림 → 어느 건물 뒤에도 문 · 길이 오지 않게 배치 (테스트가 검사).
 *
 * 배치: 분수 광장을 가운데 두고 건물이 제각각 흩어져 있고, 구불구불한 길이 광장에서 문 앞까지 이어짐.
 * 새 게임은 「새 게임 자리」(LOT) 하나를 BUILDINGS 의 건물로 바꾸면 됨 — 길은 이미 나 있음.
 */

export const WORLD = { w: 100, h: 92 } as const;
export const PITCH = (35 * Math.PI) / 180;
/** 카메라가 보는 방향 (북서) — 화면 위쪽 */
export const YAW = (45 * Math.PI) / 180;

/** 걷는 속도 (m/초) */
export const SPEED = 2.8;
/** 캐릭터 몸 반지름 (부딪힘) */
export const RADIUS = 0.3;
/** 들어오는 곳 (남동쪽 아치 안쪽) */
export const SPAWN = { x: 58.6, y: 56.6 } as const;
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
/** 부드러운 값 잡음 (숲 덩어리) */
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

// ───────────── 광장 · 길 · 호수 ─────────────

export const PLAZA = { x: 48, y: 46, r: 8.5 } as const;
export const FOUNTAIN = { x: 48, y: 46, r: 3.45 } as const;
/** 앞쪽(남쪽) 호수 */
export const LAKE = { x: 66, y: 81, rx: 9.5, ry: 5.2 } as const;

export interface Path {
  /** 꺾이는 점들 */
  pts: [number, number][];
  /** 너비 (m) */
  w: number;
  kind: "stone" | "dirt";
}

/** 길은 그림만 (땅은 어디든 걸을 수 있음) — 나무 · 장식이 길 위에 안 오게 하는 데도 씀 */
export const PATHS: Path[] = [
  // 아치 → 광장 (큰길)
  {
    pts: [
      [80, 78],
      [66.5, 64.5],
      [61, 59],
      [54.4, 52.4],
    ],
    w: 3.6,
    kind: "stone",
  },
  // 광장 → 증권거래소
  {
    pts: [
      [45.8, 37.8],
      [44.6, 34],
      [44, 32.4],
    ],
    w: 3.4,
    kind: "stone",
  },
  // 광장 → 파이트 → (새 게임 자리 A)
  {
    pts: [
      [54.6, 40.6],
      [59.5, 37.6],
      [66, 35.4],
    ],
    w: 2.6,
    kind: "dirt",
  },
  {
    pts: [
      [66, 35.4],
      [74, 33.6],
      [80, 30.4],
      [87.5, 29.4],
    ],
    w: 2.4,
    kind: "dirt",
  },
  // 광장 → 리듬업 → (새 게임 자리 B)
  {
    pts: [
      [40.2, 42.8],
      [35.4, 38.8],
      [30.4, 36.6],
    ],
    w: 2.6,
    kind: "dirt",
  },
  {
    pts: [
      [35.4, 38.8],
      [31.6, 31],
      [25.4, 25.6],
      [18.4, 22.5],
    ],
    w: 2.4,
    kind: "dirt",
  },
  // 광장 → 디펜스
  {
    pts: [
      [39.6, 48.6],
      [33, 52.5],
      [27, 54.4],
      [21.8, 56.2],
    ],
    w: 2.6,
    kind: "dirt",
  },
  // 광장 → 용의자
  {
    pts: [
      [56.4, 45],
      [64, 47.8],
      [71, 49.8],
      [77, 51],
      [82, 49.9],
    ],
    w: 2.6,
    kind: "dirt",
  },
  // 광장 → 포커
  {
    pts: [
      [42.4, 52.4],
      [38.6, 58],
      [35.4, 64.5],
      [32.4, 70],
    ],
    w: 2.6,
    kind: "dirt",
  },
  // 큰길 → 올인 러브
  {
    pts: [
      [72.2, 70.2],
      [76.5, 71.6],
      [80.6, 69.3],
    ],
    w: 2.4,
    kind: "dirt",
  },
  // 광장 → 우리 집 (호숫가로)
  {
    pts: [
      [47, 54.5],
      [46, 62],
      [46.8, 70],
      [47.4, 78.9],
      [45.4, 78.9],
    ],
    w: 2.4,
    kind: "dirt",
  },
  {
    pts: [
      [46.8, 70],
      [52, 75.4],
      [55.4, 77.6],
    ],
    w: 2,
    kind: "dirt",
  },
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

// ───────────── 건물 ─────────────

/**
 * 화풍: 게임마다 그 게임 그림체 그대로 (픽셀 게임은 픽셀 건물, 애니 게임은 애니 건물).
 * 지금은 코드로 만든 뼈대 — 증권거래소처럼 3D 모델 + 그 화풍으로 덧칠한 그림으로 한 채씩 바꿈 (model).
 */
export type BStyle = "pixel" | "anime" | "neon" | "noir" | "home" | "lot";
export type Roof = "flat" | "castle" | "gable" | "awning" | "none";
/** 앞면(문)이 보는 쪽: +y(화면 왼쪽 아래) · +x(화면 오른쪽 아래) */
export type Face = "x" | "y";

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

export const BUILDINGS: Building[] = [
  {
    id: "stock",
    sign: "증권거래소",
    sub: "주식게임 · 솔로 · 코인 · 대전",
    href: "/games/stock",
    icon: "px:stock",
    style: "neon",
    roof: "flat",
    x: 36.965,
    y: 22.85,
    w: 14.07,
    d: 9.1,
    h: 6,
    face: "y",
    wall: "#F3E6CF",
    accent: "#3DD6FF",
    top: "#1B2A66",
    model: "stock",
  },
  {
    id: "fight",
    sign: "PIXEL FIGHT",
    sub: "1:1 격투 아레나",
    href: "/games/fight",
    icon: "px:fight",
    style: "pixel",
    roof: "flat",
    x: 61,
    y: 26.6,
    w: 10,
    d: 8,
    h: 6.5,
    face: "y",
    wall: "#7A2C2C",
    accent: "#FFB23F",
    top: "#4A1A1A",
  },
  {
    id: "rhythm",
    sign: "PIXEL RHYTHM UP",
    sub: "4키 리듬게임",
    href: "/games/rhythm",
    icon: "px:rhythm",
    style: "pixel",
    roof: "flat",
    x: 21.6,
    y: 31.6,
    w: 8,
    d: 10,
    h: 6,
    face: "x",
    wall: "#4A3584",
    accent: "#FF4FD8",
    top: "#2A1D4F",
  },
  {
    id: "defense",
    sign: "LUCKY DEFENSE",
    sub: "운빨 랜덤 디펜스",
    href: "/games/defense",
    icon: "px:defense",
    style: "pixel",
    roof: "castle",
    x: 12,
    y: 50.7,
    w: 9,
    d: 11,
    h: 6,
    face: "x",
    wall: "#66766A",
    accent: "#7CFF6B",
    top: "#46534A",
  },
  {
    id: "suspect",
    sign: "오늘의 용의자",
    sub: "탐정 사무소",
    href: "/games/suspect",
    icon: "px:suspect",
    style: "noir",
    roof: "flat",
    x: 77.5,
    y: 41.2,
    w: 9,
    d: 8,
    h: 6.5,
    face: "y",
    wall: "#3A312C",
    accent: "#F2C14E",
    top: "#1F1A18",
  },
  {
    id: "poker",
    sign: "ANIME POKER",
    sub: "홀덤 · 7포커 카지노",
    href: "/games/poker",
    icon: "px:poker",
    style: "anime",
    roof: "awning",
    x: 23.6,
    y: 64.5,
    w: 8,
    d: 11,
    h: 6,
    face: "x",
    wall: "#8A2442",
    accent: "#D8264A",
    top: "#5A1529",
  },
  {
    id: "love",
    sign: "올인 러브",
    sub: "홀덤펍",
    href: "/games/love",
    icon: "px:love",
    style: "anime",
    roof: "awning",
    x: 75.6,
    y: 60.6,
    w: 10,
    d: 8,
    h: 5.5,
    face: "y",
    wall: "#F4B2CB",
    accent: "#FF5C8A",
    top: "#C9708F",
  },
  {
    id: "home",
    sign: "우리 집",
    sub: "GP로 사고 꾸미는 내 집",
    href: null,
    icon: "🏠",
    style: "home",
    roof: "gable",
    x: 37.7,
    y: 74.4,
    w: 7,
    d: 9,
    h: 4.8,
    face: "x",
    wall: "#F3E3C3",
    accent: "#E07A4F",
    top: "#B5533A",
  },
  // 새 게임 자리 (빈 터 · 팻말) — 게임이 생기면 이 자리를 건물로 바꿈
  {
    id: "lot-a",
    sign: "새 게임 자리",
    sub: "곧 새 게임이 들어와요",
    href: null,
    icon: "🚧",
    style: "lot",
    roof: "none",
    x: 83,
    y: 21,
    w: 10,
    d: 8,
    h: 0,
    face: "y",
    wall: "#C9B48A",
    accent: "#F2C14E",
    top: "#C9B48A",
  },
  {
    id: "lot-b",
    sign: "새 게임 자리",
    sub: "곧 새 게임이 들어와요",
    href: null,
    icon: "🚧",
    style: "lot",
    roof: "none",
    x: 9.5,
    y: 17.5,
    w: 8,
    d: 10,
    h: 0,
    face: "x",
    wall: "#C9B48A",
    accent: "#F2C14E",
    top: "#C9B48A",
  },
];

export const buildingById = (id: string) => BUILDINGS.find((b) => b.id === id) ?? null;
export const isLot = (b: Building) => b.style === "lot";

/** 앞면 길이 (문이 있는 면) */
export const frontLen = (b: Building) => (b.face === "y" ? b.w : b.d);
/** 문 너비 */
export const doorW = (b: Building) => (frontLen(b) >= 12 ? 2.4 : 1.6);
/** 문 가운데 (앞면 위) */
export function doorPoint(b: Building): { x: number; y: number } {
  return b.face === "y" ? { x: b.x + b.w / 2, y: b.y + b.d } : { x: b.x + b.w, y: b.y + b.d / 2 };
}
/** 빈 터 팻말 자리 (앞쪽 가운데) */
export function lotSign(b: Building): { x: number; y: number } {
  return b.face === "y"
    ? { x: b.x + b.w / 2, y: b.y + b.d - 1.2 }
    : { x: b.x + b.w - 1.2, y: b.y + b.d / 2 };
}
/** 문 앞에 서면 「들어가기」 (앞면에서 1.6m 안 · 문 너비 + 양옆 0.8) — 빈 터는 팻말 앞 */
export function doorAt(x: number, y: number): Building | null {
  for (const b of BUILDINGS) {
    if (isLot(b)) {
      const s = lotSign(b);
      if (Math.hypot(x - s.x, y - s.y) < 2) return b;
      continue;
    }
    const p = doorPoint(b);
    const half = doorW(b) / 2 + 0.8;
    if (
      b.face === "y"
        ? Math.abs(x - p.x) <= half && y >= p.y && y <= p.y + 1.6
        : Math.abs(y - p.y) <= half && x >= p.x && x <= p.x + 1.6
    )
      return b;
  }
  return null;
}
/** 문 바로 앞 (건물을 누르면 여기로 걸어감) */
export function doorFront(b: Building): { x: number; y: number } {
  if (isLot(b)) {
    const s = lotSign(b);
    return b.face === "y" ? { x: s.x, y: s.y + 1 } : { x: s.x + 1, y: s.y };
  }
  const p = doorPoint(b);
  return b.face === "y" ? { x: p.x, y: p.y + 0.7 } : { x: p.x + 0.7, y: p.y };
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

/** 들어오는 아치 (큰길을 가로지름, 기둥 둘 · 위에 GMTOWN 간판) */
export const ARCH = { x: 70.4, y: 68.4, w: 5.8, h: 4.6 } as const;
/** 아치 기둥 위치 (큰길과 수직 — 북동 · 남서) */
export const archPosts = () => {
  const k = ARCH.w / 2 / Math.SQRT2;
  return [
    { x: ARCH.x + k, y: ARCH.y - k },
    { x: ARCH.x - k, y: ARCH.y + k },
  ];
};
/** 안내판 (눌러서 도움말) — 들어오자마자 보이는 길가 */
export const BOARD = { x: 60.5, y: 55.2 } as const;

/** 건물 · 빈 터를 둘러싼 여유 (나무가 안 붙게) */
function nearBuilding(x: number, y: number, pad: number): boolean {
  for (const b of BUILDINGS) {
    // 앞마당은 더 넓게 비움
    const fx = b.face === "x" ? 4 : 0,
      fy = b.face === "y" ? 4 : 0;
    if (x > b.x - pad && x < b.x + b.w + pad + fx && y > b.y - pad && y < b.y + b.d + pad + fy)
      return true;
  }
  return false;
}
const inLake = (x: number, y: number, pad: number) =>
  ((x - LAKE.x) / (LAKE.rx + pad)) ** 2 + ((y - LAKE.y) / (LAKE.ry + pad)) ** 2 < 1;

/** 장식을 둘 수 없는 곳 (광장 · 길 · 건물 앞 · 호수 · 들어오는 곳) */
function busy(x: number, y: number, pad: number): boolean {
  if (Math.hypot(x - PLAZA.x, y - PLAZA.y) < PLAZA.r + pad + 1) return true;
  if (pathDist(x, y) < pad) return true;
  if (nearBuilding(x, y, pad + 1)) return true;
  if (inLake(x, y, pad + 0.6)) return true;
  if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 4 + pad) return true;
  if (Math.hypot(x - ARCH.x, y - ARCH.y) < ARCH.w / 2 + 1.5 + pad) return true;
  if (Math.hypot(x - BOARD.x, y - BOARD.y) < 1.5 + pad) return true;
  return false;
}

function makeTrees(): Tree[] {
  const t: Tree[] = [];
  const kindAt = (x: number, y: number): Tree["kind"] => {
    const r = hash01(x * 31, y * 17);
    // 광장 둘레 · 호숫가는 벚나무, 북쪽은 소나무가 많게
    if (Math.hypot(x - PLAZA.x, y - PLAZA.y) < PLAZA.r + 9 || inLake(x, y, 6))
      return r < 0.55 ? "blossom" : "round";
    return r < (y < 40 ? 0.62 : 0.35) ? "pine" : "round";
  };
  for (let gy = -44; gy < WORLD.h + 44; gy += 2.3)
    for (let gx = -44; gx < WORLD.w + 44; gx += 2.3) {
      const x = gx + (hash01(gx * 10, gy * 10) - 0.5) * 1.8;
      const y = gy + (hash01(gx * 10 + 3, gy * 10 + 7) - 0.5) * 1.8;
      const edge = Math.min(x - 5, y - 5, WORLD.w - 5 - x, WORLD.h - 5 - y);
      // 바깥 숲(걸을 수 있는 곳 밖)은 빽빽하게, 안쪽은 덩어리 잡음으로 듬성듬성
      let p: number;
      if (edge < 0) p = Math.max(0, 0.92 + edge * 0.018) * (0.55 + noise(x, y, 11) * 0.7);
      else if (edge < 5) p = 0.55 + (noise(x, y, 7) - 0.5) * 0.6;
      else p = noise(x, y, 9) > 0.62 ? 0.5 : 0.035;
      if (hash01(gx * 10 + 1, gy * 10 + 2) > p) continue;
      if (edge >= 0 && busy(x, y, 1.6)) continue;
      t.push({ x, y, s: 0.8 + hash01(gx * 10 + 5, gy * 10 + 9) * 0.5, kind: kindAt(x, y) });
    }
  // 광장 둘레 벚나무 (길 사이마다)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const x = PLAZA.x + Math.cos(a) * (PLAZA.r + 2.6),
      y = PLAZA.y + Math.sin(a) * (PLAZA.r + 2.6);
    if (pathDist(x, y) < 1.4 || nearBuilding(x, y, 1)) continue;
    t.push({ x, y, s: 0.95, kind: "blossom" });
  }
  return t;
}
export const TREES: Tree[] = makeTrees();

/** 가로등: 광장 둘레 6개 + 길을 따라 엇갈려서 */
function makeLamps(): Lamp[] {
  const out: Lamp[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    out.push({
      x: PLAZA.x + Math.cos(a) * (PLAZA.r - 0.6),
      y: PLAZA.y + Math.sin(a) * (PLAZA.r - 0.6),
    });
  }
  for (const p of PATHS) {
    let acc = 4,
      side = 1;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [ax, ay] = p.pts[i],
        [bx, by] = p.pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / len,
        ny = (bx - ax) / len;
      for (let s = 0; s < len; s += 1) {
        if ((acc += 1) < 11) continue;
        const x = ax + ((bx - ax) * s) / len + nx * side * (p.w / 2 + 0.5),
          y = ay + ((by - ay) * s) / len + ny * side * (p.w / 2 + 0.5);
        if (
          Math.hypot(x - PLAZA.x, y - PLAZA.y) < PLAZA.r + 2 ||
          nearBuilding(x, y, 1.2) ||
          out.some((l) => Math.hypot(l.x - x, l.y - y) < 6)
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

/** 광장 벤치 (분수를 둘러싸고 분수를 봄) + 호숫가 */
export const BENCHES: Bench[] = [
  ...[0.55, 1.6, 2.65, 3.7, 4.75, 5.8].map((a) => ({
    x: PLAZA.x + Math.cos(a) * 5.9,
    y: PLAZA.y + Math.sin(a) * 5.9,
    a: a + Math.PI,
  })),
  { x: 58.5, y: 75.2, a: Math.PI / 2 },
  { x: 62.5, y: 74.6, a: Math.PI / 2 },
];

/** 꽃밭 (밟고 지나갈 수 있음) */
function makeFlowers(): Flower[] {
  const out: Flower[] = [];
  const hues: Flower["hue"][] = ["pink", "yellow", "white", "purple"];
  for (let i = 0; i < 400 && out.length < 26; i++) {
    const x = 8 + hash01(i, 91) * (WORLD.w - 16),
      y = 8 + hash01(i, 37) * (WORLD.h - 16);
    const r = 1.4 + hash01(i, 53) * 1.6;
    if (busy(x, y, r * 0.6) || TREES.some((t) => Math.hypot(t.x - x, t.y - y) < r + 0.8)) continue;
    if (out.some((f) => Math.hypot(f.x - x, f.y - y) < f.r + r + 3)) continue;
    out.push({ x, y, r, hue: hues[i % 4] });
  }
  return out;
}
export const FLOWERS: Flower[] = makeFlowers();

// ───────────── 부딪힘 ─────────────

/** 걸을 수 있는 네모 (바깥은 숲) */
export const BOUNDS = { x0: 5, y0: 5, x1: WORLD.w - 5, y1: WORLD.h - 5 } as const;

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
  for (const b of BUILDINGS) {
    if (isLot(b)) {
      // 팻말 (기둥 둘 · 앞면과 나란히 2m)
      const s = lotSign(b);
      const along = b.face === "y" ? Math.abs(x - s.x) : Math.abs(y - s.y),
        across = b.face === "y" ? Math.abs(y - s.y) : Math.abs(x - s.x);
      if (along < 1.05 + r && across < 0.1 + r) return true;
      continue;
    }
    // 앞면 쪽은 조금 너그럽게 (문 앞까지 붙어 설 수 있게)
    const ex = b.face === "x" ? r * 0.4 : r,
      ey = b.face === "y" ? r * 0.4 : r;
    if (x > b.x - r && x < b.x + b.w + ex && y > b.y - r && y < b.y + b.d + ey) return true;
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

/**
 * 이 점이 건물 b 에 가려지는지 (카메라 쪽으로 h/tan35 만큼 가는 동안 건물 안을 지나면)
 * — 문 · 길 배치 검사 · 내 캐릭터가 뒤에 있을 때 건물을 비치게 할 때 씀. lift = 점의 높이 (머리면 1.6)
 */
export function hiddenBy(
  b: Building,
  x: number,
  y: number,
  lift = 0,
  yaw = YAW,
  pitch = PITCH
): boolean {
  if (isLot(b) || b.h <= lift) return false;
  const reach = (b.h - lift) / Math.tan(pitch);
  const steps = Math.ceil(reach / 0.25);
  const ux = Math.sin(yaw),
    uy = Math.cos(yaw);
  for (let i = 1; i <= steps; i++) {
    const t = (reach * i) / steps;
    const px = x + t * ux,
      py = y + t * uy;
    if (px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.d) return true;
  }
  return false;
}
