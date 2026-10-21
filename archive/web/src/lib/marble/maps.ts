/*
 * DICE TOWN 판 — 해피 타운 (9×9 사각 루프 32칸).
 * 자리(slot) = 칸 id. 좌표(x, y)는 화면용 격자.
 * 크로스 · 오르골은 v2(야추 × 보드)에서 내려 둠 — 맵 특징 붙여 다시 열 예정.
 */

/**
 *  start   출발 (지나가면 코인)
 *  blue    코인 칸 (+)
 *  red     손해 칸 (−, 잭팟에 쌓임)
 *  item    럭키 박스 (아이템 1장)
 *  vs      대결 (상대 하나와 주사위 승부)
 *  star    별 자리 (이 중 한 곳에 별이 뜸 · 별이 없으면 코인 칸)
 *  trap    함정 (다음 차례 다시 굴리기 0번)
 *  warp    워프 (원하는 칸으로)
 *  fest    축제 무대 (주사위 × 코인)
 *  jackpot 잭팟 (쌓인 코인 몽땅)
 *  event   마을 소식 (카드 한 장)
 */
export type TileKind = "start" | "blue" | "red" | "item" | "vs" | "star" | "trap" | "warp" | "fest" | "jackpot" | "event";

export interface TileDef {
  kind: TileKind;
  name: string;
  x: number;
  y: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  en: string;
  desc: string;
  /** 규칙 한 줄들 (방 · 가이드) */
  rules: string[];
  grid: [number, number];
  tiles: TileDef[];
  /** 바퀴 수 */
  rounds: number;
  /** 배경 · 분위기 색 */
  sky: string;
  ground: string;
}
export type MapId = "town";

/* ── 9×9 루프 자리 좌표: 0 = 오른쪽 아래(출발), 화면에선 왼쪽으로 감 ── */
function ring9(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  out.push({ x: 8, y: 8 });
  for (let i = 1; i <= 7; i++) out.push({ x: 8 - i, y: 8 });
  out.push({ x: 0, y: 8 });
  for (let i = 1; i <= 7; i++) out.push({ x: 0, y: 8 - i });
  out.push({ x: 0, y: 0 });
  for (let i = 1; i <= 7; i++) out.push({ x: i, y: 0 });
  out.push({ x: 8, y: 0 });
  for (let i = 1; i <= 7; i++) out.push({ x: 8, y: i });
  return out;
}

function ringMap(specs: [TileKind, string][]): TileDef[] {
  const xy = ring9();
  return specs.map(([kind, name], i) => ({ kind, name, ...xy[i] }));
}

const TOWN: MapDef = {
  id: "town",
  name: "해피 타운",
  en: "HAPPY TOWN",
  desc: "다이스 타운 한가운데 분수 광장. 별 자리 넷 중 한 곳에 별이 떠요",
  rules: ["별 칸을 지나가거나 서면 별을 살 수 있어요", "막판 3바퀴는 코인 칸 · 손해 칸이 두 배!"],
  grid: [9, 9],
  tiles: ringMap([
    ["start", "출발 포털"],
    ["blue", "픽셀 분식"],
    ["blue", "8비트 문방구"],
    ["item", "럭키 박스"],
    ["red", "도트 세탁소"],
    ["star", "픽셀 해변"],
    ["blue", "우산 놀이터"],
    ["event", "마을 게시판"],
    ["trap", "도트 수리소"],
    ["blue", "소영 학원"],
    ["vs", "이반 도장"],
    ["jackpot", "황금 금고"],
    ["blue", "매점"],
    ["star", "시계탑 광장"],
    ["red", "권투장"],
    ["blue", "도서관"],
    ["fest", "축제 무대"],
    ["blue", "창술원"],
    ["item", "럭키 박스"],
    ["event", "전파사"],
    ["blue", "오락실"],
    ["star", "오로라 언덕"],
    ["red", "이그나 화덕"],
    ["blue", "불꽃 가게"],
    ["warp", "워프 게이트"],
    ["blue", "옥상 정원"],
    ["item", "럭키 박스"],
    ["vs", "루프탑 링"],
    ["blue", "물탱크 전망대"],
    ["star", "별빛 천문대"],
    ["red", "오로라 호텔"],
    ["blue", "스카이 라운지"],
  ]),
  rounds: 10,
  sky: "#bfe8ff",
  ground: "#8fd17a",
};

export const MAPS: Record<MapId, MapDef> = { town: TOWN };
export const MAP_IDS: MapId[] = ["town"];
