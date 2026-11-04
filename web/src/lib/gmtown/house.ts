/*
 * 내 집 (집 안) — 화면 · 서버가 같이 씀.
 *
 * 집 안은 사람마다 따로: 방 크기는 계약 단계(HOUSE_TIERS)로, 가구는 가진 것(inv)만 놓을 수 있음.
 * 바닥은 0.5m 칸. 배치 = [{ i: 가구 id, x, y: 칸(왼쪽 위 기준), r: 0~3 (90° 씩), f: 층 (0 = 1층 · 1 = 2층, 없으면 0) }].
 * 문은 앞벽(+y) 가운데 — 문 앞 · 문 안쪽 두 줄은 비워 둬야 함 (드나드는 길).
 * 2층 집(3단계~): 왼쪽 벽을 따라 계단 (앞 → 뒤로 올라감). 1층 계단 자리 · 그 앞 한 줄, 2층 계단 구멍 · 그 뒤 한 줄은 비움.
 * 정원 주택(4단계): 집 앞(+y)에 마당 (1층 칸이 그만큼 더 길어짐). 문 → 마당 대문까지 가운데 길은 비움.
 *   마당엔 정원 가구(where: out)만, 집 안엔 집 가구(in)만, 의자 · 탁자 같은 건(any) 어디든.
 */

export const CELL = 0.5;
/** 집을 짓는 곳 (마을 밖 멀리 — 모든 집이 같은 자리에, 사람마다 따로 보임) */
export const HOME_AT = { x: -400, y: -400 };
/** 한 층 높이 (벽 2.6 + 바닥판 0.2) */
export const FLOOR_H = 2.8;

/** 단계별 방 크기 (칸) · 마당 (칸 줄) · 층 */
export const ROOM: Record<number, { w: number; d: number; name: string; yard: number; floors: number }> = {
  1: { w: 12, d: 10, name: "원룸", yard: 0, floors: 1 },
  2: { w: 18, d: 12, name: "투룸", yard: 0, floors: 1 },
  3: { w: 20, d: 14, name: "2층 집", yard: 0, floors: 2 },
  4: { w: 24, d: 16, name: "정원 주택", yard: 10, floors: 2 },
};
export const roomOf = (tier: number) => ROOM[Math.max(1, Math.min(4, tier))];

export interface HouseGeo {
  w: number;
  /** 집 안 줄 수 */
  d: number;
  /** 마당 줄 수 (집 앞) */
  yard: number;
  /** 1층(마당 포함) 줄 수 */
  gd: number;
  floors: number;
  /** 계단 칸 [x0, x1) × [y0, y1) — y0 쪽(뒤)이 위층 */
  stair: { x0: number; x1: number; y0: number; y1: number } | null;
  /** 문 칸 (앞벽 가운데 2칸) */
  door: { x0: number; x1: number };
  /** 칸 (0, 0) 의 땅 좌표 · 집 크기 (m) */
  ox: number;
  oy: number;
  wm: number;
  dm: number;
}

export function houseGeo(tier: number): HouseGeo {
  const R = roomOf(tier);
  const gd = R.d + R.yard;
  const x0 = Math.floor(R.w / 2) - 1;
  const y1 = R.d - 2;
  return {
    w: R.w,
    d: R.d,
    yard: R.yard,
    gd,
    floors: R.floors,
    stair: R.floors > 1 ? { x0: 0, x1: 3, y0: y1 - 8, y1 } : null,
    door: { x0, x1: x0 + 1 },
    ox: HOME_AT.x - (R.w * CELL) / 2,
    oy: HOME_AT.y - (gd * CELL) / 2,
    wm: R.w * CELL,
    dm: R.d * CELL,
  };
}
/** 들어왔을 때 서는 곳 (마당이 있으면 대문 안쪽, 없으면 문 안쪽) */
export function enterAt(tier: number): { x: number; y: number } {
  const g = houseGeo(tier);
  return { x: g.ox + (g.door.x0 + 1) * CELL, y: g.oy + (g.yard ? g.gd * CELL : g.dm) - 0.7 };
}

export type FurnKind =
  | "bed"
  | "desk"
  | "chair"
  | "sofa"
  | "table"
  | "lamp"
  | "plant"
  | "shelf"
  | "rug"
  | "tv"
  | "wardrobe"
  | "fridge"
  | "cushion"
  | "piano"
  | "tree"
  | "flowers"
  | "bench"
  | "parasol"
  | "fountain"
  | "hedge";

export interface Furn {
  id: FurnKind;
  name: string;
  /** 가게 값 (GP) */
  price: number;
  /** 바닥 칸 (r = 0 일 때 가로 w · 세로 d) */
  w: number;
  d: number;
  icon: string;
  /** 위를 걸어 다닐 수 있음 (러그) */
  flat?: boolean;
  /** 벽에 붙여야 예쁨 (안내만) */
  wall?: boolean;
  /** 놓을 수 있는 곳: 집 안(기본) · 마당 · 어디든 */
  where?: "in" | "out" | "any";
}

export const FURNITURE: Furn[] = [
  { id: "bed", name: "침대", price: 3_000, w: 3, d: 4, icon: "🛏️", wall: true },
  { id: "desk", name: "책상", price: 1_500, w: 3, d: 2, icon: "🗄️", wall: true },
  { id: "chair", name: "의자", price: 500, w: 1, d: 1, icon: "🪑", where: "any" },
  { id: "sofa", name: "소파", price: 3_000, w: 4, d: 2, icon: "🛋️" },
  { id: "table", name: "동그란 탁자", price: 1_200, w: 2, d: 2, icon: "⚪", where: "any" },
  { id: "lamp", name: "스탠드 조명", price: 800, w: 1, d: 1, icon: "💡", where: "any" },
  { id: "plant", name: "화분", price: 400, w: 1, d: 1, icon: "🪴", where: "any" },
  { id: "shelf", name: "책장", price: 2_000, w: 3, d: 1, icon: "📚", wall: true },
  { id: "rug", name: "러그", price: 1_000, w: 4, d: 3, icon: "🟫", flat: true },
  { id: "tv", name: "TV 장", price: 3_500, w: 3, d: 1, icon: "📺", wall: true },
  { id: "wardrobe", name: "옷장", price: 2_500, w: 2, d: 1, icon: "🚪", wall: true },
  { id: "fridge", name: "냉장고", price: 3_000, w: 2, d: 2, icon: "🧊", wall: true },
  { id: "cushion", name: "방석", price: 300, w: 1, d: 1, icon: "🟣", flat: true, where: "any" },
  { id: "piano", name: "업라이트 피아노", price: 8_000, w: 3, d: 2, icon: "🎹", wall: true },
  // 정원 (마당에만)
  { id: "tree", name: "정원 나무", price: 2_500, w: 2, d: 2, icon: "🌳", where: "out" },
  { id: "flowers", name: "꽃밭", price: 900, w: 3, d: 1, icon: "🌷", where: "out" },
  { id: "bench", name: "정원 벤치", price: 1_500, w: 3, d: 1, icon: "🪵", where: "out" },
  { id: "parasol", name: "파라솔 탁자", price: 3_500, w: 3, d: 3, icon: "⛱️", where: "out" },
  { id: "fountain", name: "작은 분수", price: 6_000, w: 3, d: 3, icon: "⛲", where: "out" },
  { id: "hedge", name: "생울타리", price: 600, w: 2, d: 1, icon: "🌿", where: "out" },
];
export const furnById = (id: string) => FURNITURE.find((f) => f.id === id) ?? null;

export interface Placed {
  i: FurnKind;
  x: number;
  y: number;
  r: number;
  /** 층 (0 = 1층 · 1 = 2층). 없으면 1층 */
  f?: number;
}

/** 돌린 뒤 차지하는 칸 크기 */
export const footprint = (f: Furn, r: number) => (r % 2 ? { w: f.d, d: f.w } : { w: f.w, d: f.d });

/** 처음 계약하면 주는 가구 · 기본 배치 (원룸 12×10 칸) */
export const STARTER: Placed[] = [
  { i: "bed", x: 0, y: 0, r: 0 },
  { i: "desk", x: 9, y: 0, r: 0 },
  { i: "chair", x: 10, y: 2, r: 2 },
  { i: "rug", x: 4, y: 4, r: 0 },
  { i: "plant", x: 11, y: 7, r: 0 },
];
export const starterInv = (): Record<string, number> => {
  const inv: Record<string, number> = {};
  for (const p of STARTER) inv[p.i] = (inv[p.i] ?? 0) + 1;
  return inv;
};

/** 문 칸 (앞벽 가운데 2칸) 과 그 안쪽 줄 */
export function doorCells(tier: number): { x0: number; x1: number; y: number } {
  const g = houseGeo(tier);
  return { ...g.door, y: g.d - 1 };
}

/** 층 f 의 칸 (x, y) 가 비워 둬야 하는 곳이면 이유 (계단은 러그도 안 됨 · 길은 러그는 됨) */
export function reserved(g: HouseGeo, f: number, x: number, y: number): { why: string; hard: boolean } | null {
  const s = g.stair;
  const inSx = !!s && x >= s.x0 && x < s.x1;
  if (f === 0) {
    if (s && inSx && y >= s.y0 && y < s.y1) return { why: "계단 자리예요.", hard: true };
    if (s && inSx && y === s.y1) return { why: "계단 앞은 비워 둬야 해요.", hard: false };
    const inDoor = x >= g.door.x0 && x <= g.door.x1;
    if (inDoor && (y === g.d - 1 || y === g.d - 2)) return { why: "문 앞은 비워 둬야 해요.", hard: false };
    if (inDoor && y >= g.d) return { why: "대문 가는 길은 비워 둬야 해요.", hard: false };
    return null;
  }
  if (s && inSx && y >= s.y0 && y < s.y1) return { why: "계단 자리예요.", hard: true };
  if (s && inSx && y === s.y0 - 1) return { why: "계단 앞은 비워 둬야 해요.", hard: false };
  return null;
}

/**
 * 배치가 맞는지: 방 안 · 가진 개수 이하 · 서로 안 겹침(러그 · 방석은 다른 것 아래 깔려도 됨) · 문 앞 · 계단 비움 · 집 안 / 마당.
 * 틀리면 이유 문자열, 맞으면 null
 */
export function checkLayout(tier: number, layout: Placed[], inv: Record<string, number>): string | null {
  const g = houseGeo(tier);
  if (layout.length > 160) return "가구가 너무 많아요.";
  const used: Record<string, number> = {};
  const rows = (f: number) => (f ? g.d : g.gd);
  const solid = [new Uint8Array(g.w * g.gd), new Uint8Array(g.w * g.d)];
  const flat = [new Uint8Array(g.w * g.gd), new Uint8Array(g.w * g.d)];
  for (const p of layout) {
    const f = furnById(p.i);
    if (!f) return "없는 가구예요.";
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !Number.isInteger(p.r) || p.r < 0 || p.r > 3) return "잘못된 자리예요.";
    const fl = p.f ?? 0;
    if (fl !== 0 && fl !== 1) return "잘못된 층이에요.";
    if (fl >= g.floors) return "2층이 없는 집이에요.";
    used[p.i] = (used[p.i] ?? 0) + 1;
    if (used[p.i] > (inv[p.i] ?? 0)) return `${f.name}이(가) 모자라요.`;
    const { w, d } = footprint(f, p.r);
    if (p.x < 0 || p.y < 0 || p.x + w > g.w || p.y + d > rows(fl)) return `${f.name}이(가) 방 밖으로 나가요.`;
    // 집 안 · 마당 (걸쳐 놓기 안 됨)
    const out = fl === 0 && p.y >= g.d,
      straddle = fl === 0 && p.y < g.d && p.y + d > g.d;
    const where = f.where ?? "in";
    if (straddle) return "벽에 걸쳐 놓을 수 없어요.";
    if (where === "in" && out) return `${f.name}은(는) 집 안에만 놓을 수 있어요.`;
    if (where === "out" && !out) return g.yard ? `${f.name}은(는) 마당에만 놓을 수 있어요.` : "정원 가구는 정원 주택 마당에 놓아요.";
    const grid = f.flat ? flat[fl] : solid[fl];
    for (let y = p.y; y < p.y + d; y++)
      for (let x = p.x; x < p.x + w; x++) {
        if (grid[y * g.w + x]) return "가구끼리 겹쳐요.";
        grid[y * g.w + x] = 1;
        const rs = reserved(g, fl, x, y);
        if (rs && (rs.hard || !f.flat)) return rs.why;
      }
  }
  return null;
}

/** 집을 넓혔을 때 등: 새 방에 안 맞는 가구는 빼고(창고로) 맞는 것만 */
export function fitLayout(tier: number, layout: Placed[], inv: Record<string, number>): Placed[] {
  const keep: Placed[] = [];
  for (const p of layout) if (!checkLayout(tier, [...keep, p], inv)) keep.push(p);
  return keep;
}

/*
 * 계단 오르내리기 — 화면이 쓰는 「지금 층」: 0 = 1층, 1 = 2층, 2 = 계단 위.
 * 계단 아래쪽(앞) 30% 는 1층에서, 위쪽 30% 는 2층에서 드나듦. 가운데는 난간.
 */
export const LV_STAIR = 2;
/** 계단 위에서의 높이 비율 (앞 끝 0 → 뒤 끝 1) — 계단 밖이면 null */
export function stairT(g: HouseGeo, x: number, y: number): number | null {
  const s = g.stair;
  if (!s) return null;
  const sx0 = g.ox + s.x0 * CELL,
    sx1 = g.ox + s.x1 * CELL,
    sy0 = g.oy + s.y0 * CELL,
    sy1 = g.oy + s.y1 * CELL;
  if (x < sx0 || x > sx1 || y < sy0 || y > sy1) return null;
  return (sy1 - y) / (sy1 - sy0);
}
/** 움직인 뒤의 층 */
export function nextLevel(g: HouseGeo, lv: number, x: number, y: number): number {
  const t = stairT(g, x, y);
  if (t !== null) return t < 0.3 && lv === 0 ? LV_STAIR : t > 0.7 && lv === 1 ? LV_STAIR : lv === LV_STAIR ? LV_STAIR : lv;
  if (lv !== LV_STAIR) return lv;
  return y < g.oy + g.stair!.y0 * CELL + 0.25 || y < g.oy + ((g.stair!.y0 + g.stair!.y1) / 2) * CELL ? 1 : 0;
}
/** 층 · 자리 → 발 높이 */
export function levelH(g: HouseGeo, lv: number, x: number, y: number): number {
  if (lv === LV_STAIR) {
    const t = stairT(g, x, y);
    if (t !== null) return Math.max(0, Math.min(1, t)) * FLOOR_H;
  }
  return lv === 1 ? FLOOR_H : 0;
}
