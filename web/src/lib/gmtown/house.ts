/*
 * 내 집 (집 안) — 화면 · 서버가 같이 씀.
 *
 * 집 안은 사람마다 따로: 방 크기는 계약 단계(HOUSE_TIERS)로, 가구는 가진 것(inv)만 놓을 수 있음.
 * 바닥은 0.5m 칸. 배치 = [{ i: 가구 id, x, y: 칸(왼쪽 위 기준), r: 0~3 (90° 씩) }].
 * 문은 앞벽(+y) 가운데 — 문 앞 칸 · 문 앞 한 줄은 비워 둬야 함 (드나드는 길).
 */

export const CELL = 0.5;

/** 단계별 방 크기 (칸) */
export const ROOM: Record<number, { w: number; d: number; name: string }> = {
  1: { w: 12, d: 10, name: "원룸" },
  2: { w: 18, d: 12, name: "투룸" },
  3: { w: 20, d: 14, name: "2층 집" },
  4: { w: 24, d: 16, name: "정원 주택" },
};
export const roomOf = (tier: number) => ROOM[Math.max(1, Math.min(4, tier))];

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
  | "piano";

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
}

export const FURNITURE: Furn[] = [
  { id: "bed", name: "침대", price: 3_000, w: 3, d: 4, icon: "🛏️", wall: true },
  { id: "desk", name: "책상", price: 1_500, w: 3, d: 2, icon: "🗄️", wall: true },
  { id: "chair", name: "의자", price: 500, w: 1, d: 1, icon: "🪑" },
  { id: "sofa", name: "소파", price: 3_000, w: 4, d: 2, icon: "🛋️" },
  { id: "table", name: "동그란 탁자", price: 1_200, w: 2, d: 2, icon: "⚪" },
  { id: "lamp", name: "스탠드 조명", price: 800, w: 1, d: 1, icon: "💡" },
  { id: "plant", name: "화분", price: 400, w: 1, d: 1, icon: "🪴" },
  { id: "shelf", name: "책장", price: 2_000, w: 3, d: 1, icon: "📚", wall: true },
  { id: "rug", name: "러그", price: 1_000, w: 4, d: 3, icon: "🟫", flat: true },
  { id: "tv", name: "TV 장", price: 3_500, w: 3, d: 1, icon: "📺", wall: true },
  { id: "wardrobe", name: "옷장", price: 2_500, w: 2, d: 1, icon: "🚪", wall: true },
  { id: "fridge", name: "냉장고", price: 3_000, w: 2, d: 2, icon: "🧊", wall: true },
  { id: "cushion", name: "방석", price: 300, w: 1, d: 1, icon: "🟣", flat: true },
  { id: "piano", name: "업라이트 피아노", price: 8_000, w: 3, d: 2, icon: "🎹", wall: true },
];
export const furnById = (id: string) => FURNITURE.find((f) => f.id === id) ?? null;

export interface Placed {
  i: FurnKind;
  x: number;
  y: number;
  r: number;
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

/** 문 칸 (앞벽 가운데 2칸) 과 그 앞 드나드는 줄 */
export function doorCells(tier: number): { x0: number; x1: number; y: number } {
  const R = roomOf(tier);
  const x0 = Math.floor(R.w / 2) - 1;
  return { x0, x1: x0 + 1, y: R.d - 1 };
}

/**
 * 배치가 맞는지: 방 안 · 가진 개수 이하 · 서로 안 겹침(러그 · 방석은 다른 것 아래 깔려도 됨) · 문 앞 비움.
 * 틀리면 이유 문자열, 맞으면 null
 */
export function checkLayout(tier: number, layout: Placed[], inv: Record<string, number>): string | null {
  const R = roomOf(tier);
  if (layout.length > 120) return "가구가 너무 많아요.";
  const used: Record<string, number> = {};
  const solid = new Uint8Array(R.w * R.d);
  const flat = new Uint8Array(R.w * R.d);
  const dc = doorCells(tier);
  for (const p of layout) {
    const f = furnById(p.i);
    if (!f) return "없는 가구예요.";
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !Number.isInteger(p.r) || p.r < 0 || p.r > 3) return "잘못된 자리예요.";
    used[p.i] = (used[p.i] ?? 0) + 1;
    if (used[p.i] > (inv[p.i] ?? 0)) return `${f.name}이(가) 모자라요.`;
    const { w, d } = footprint(f, p.r);
    if (p.x < 0 || p.y < 0 || p.x + w > R.w || p.y + d > R.d) return `${f.name}이(가) 방 밖으로 나가요.`;
    const grid = f.flat ? flat : solid;
    for (let y = p.y; y < p.y + d; y++)
      for (let x = p.x; x < p.x + w; x++) {
        if (grid[y * R.w + x]) return "가구끼리 겹쳐요.";
        grid[y * R.w + x] = 1;
        if (!f.flat && y >= dc.y - 1 && x >= dc.x0 && x <= dc.x1) return "문 앞은 비워 둬야 해요.";
      }
  }
  return null;
}
