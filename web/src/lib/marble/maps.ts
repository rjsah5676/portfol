/*
 * PIXEL MARBLE 맵 3종
 *  town  픽셀 타운 (기본) — 9×9 사각 루프 32칸. 3바퀴마다 「마을 소식」(날씨 · 축제 · 경기)이 바뀜
 *  cross 크로스로드     — 두 루프(6×6)가 한 칸(광장)에서 만나는 8자. 광장을 지날 때 어느 루프로 갈지 고름
 *  orgel 오르골 정원    — 9×9 루프인데 4바퀴마다 네 변이 시계 방향으로 한 변씩 돎 (땅이 통째로 옮겨 감)
 *
 * 위치: 말은 "자리(slot)" 에 섬. town · cross 는 자리 = 칸 id. orgel 은 자리마다 지금 놓인 칸이 바뀜 (game.order).
 * 좌표(x, y)는 화면용 격자 (grid 크기 안).
 */

export type TileKind = "start" | "start2" | "city" | "spot" | "box" | "jail" | "fest" | "warp" | "tax" | "bonus";

export interface TileDef {
  kind: TileKind;
  name: string;
  /** 땅값 (city · spot) */
  price?: number;
  /** 색 그룹 (city) */
  group?: number;
  /** 화면 격자 좌표 — orgel 은 "자리"의 좌표 (칸은 돌아다님) */
  x: number;
  y: number;
  /** 다음 자리 (cross 의 광장만 둘) */
  next: number[];
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
  groups: { name: string; color: string }[];
  /** 라인 독점: 이 자리들(orgel 은 자리, 나머지는 칸 id)에 있는 땅을 전부 */
  lines: number[][];
  /** 바퀴(라운드) 제한 — 끝나면 총자산 */
  rounds: number;
  /** town: 마을 소식 주기 · orgel: 회전 주기 (바퀴) */
  every?: number;
  /** cross: 갈림길 자리 */
  junction?: number;
  /** 배경 · 분위기 색 */
  sky: string;
  ground: string;
}
export type MapId = "town" | "cross" | "orgel";

/* ── 9×9 루프 자리 좌표: 0 = 오른쪽 아래(출발), 시계 반대로… 화면에선 왼쪽으로 감 ── */
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

type Spec = [TileKind, string, number?, number?];
const C = (name: string, group: number, price: number): Spec => ["city", name, price, group];
const S = (name: string, price: number): Spec => ["spot", name, price];

function ringMap(specs: Spec[]): TileDef[] {
  const xy = ring9();
  return specs.map(([kind, name, price, group], i) => ({
    kind,
    name,
    ...(price !== undefined && { price }),
    ...(group !== undefined && { group }),
    ...xy[i],
    next: [(i + 1) % 32],
  }));
}

/* ───────────── 1. 픽셀 타운 ───────────── */

const TOWN: MapDef = {
  id: "town",
  name: "픽셀 타운",
  en: "PIXEL TOWN",
  desc: "픽셀파이트 동네 한 바퀴. 3바퀴마다 마을 소식이 바뀌어요",
  rules: ["3바퀴마다 마을 소식 (날씨 · 축제 · 경기) — 3바퀴 동안 통행료 · 월급 · 건설비가 바뀜"],
  grid: [9, 9],
  groups: [
    { name: "도트 골목", color: "#ff9db5" },
    { name: "꼬마 공원", color: "#8ee08a" },
    { name: "학교 길", color: "#c79bff" },
    { name: "체육관 거리", color: "#9fb3c8" },
    { name: "번개 상가", color: "#ffd84d" },
    { name: "불꽃 시장", color: "#ff7a45" },
    { name: "옥상 동네", color: "#5fd0ff" },
    { name: "스카이 타워", color: "#4a6dff" },
  ],
  tiles: ringMap([
    ["start", "출발 포털"],
    C("픽셀 분식", 0, 60),
    C("8비트 문방구", 0, 60),
    ["box", "럭키 박스"],
    C("도트 세탁소", 0, 70),
    S("픽셀 해변", 120),
    C("우산 놀이터", 1, 80),
    C("물방울 분수", 1, 90),
    ["jail", "도트 수리소"],
    C("소영 학원", 2, 100),
    C("도서관", 2, 100),
    ["tax", "동네 세무서"],
    C("매점", 2, 110),
    S("시계탑 광장", 150),
    C("이반 도장", 3, 120),
    C("권투장", 3, 130),
    ["fest", "축제 무대"],
    C("창술원", 4, 140),
    ["box", "럭키 박스"],
    C("전파사", 4, 140),
    C("오락실", 4, 150),
    S("오로라 언덕", 180),
    C("이그나 화덕", 5, 160),
    C("불꽃 가게", 5, 170),
    ["warp", "워프 게이트"],
    C("옥상 정원", 6, 180),
    ["box", "럭키 박스"],
    C("루프탑 카페", 6, 190),
    C("물탱크 전망대", 6, 200),
    S("별빛 천문대", 220),
    C("오로라 호텔", 7, 230),
    C("스카이 라운지", 7, 250),
  ]),
  lines: [
    [1, 2, 4, 5, 6, 7],
    [9, 10, 12, 13, 14, 15],
    [17, 19, 20, 21, 22, 23],
    [25, 27, 28, 29, 30, 31],
  ],
  rounds: 20,
  every: 3,
  sky: "#bfe8ff",
  ground: "#8fd17a",
};

/* ───────────── 2. 크로스로드 (8자) ───────────── */

function crossTiles(): TileDef[] {
  // 왼쪽 루프 (광장 J = id 0 부터) — 5×5 링, 격자 9×9 의 왼쪽 위
  const L: [number, number][] = [
    [4, 4],
    [3, 4],
    [2, 4],
    [1, 4],
    [0, 4],
    [0, 3],
    [0, 2],
    [0, 1],
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
  ];
  // 오른쪽 루프 (J 다음부터, 오른쪽 아래 5×5)
  const R: [number, number][] = [
    [4, 5],
    [4, 6],
    [4, 7],
    [4, 8],
    [5, 8],
    [6, 8],
    [7, 8],
    [8, 8],
    [8, 7],
    [8, 6],
    [8, 5],
    [8, 4],
    [7, 4],
    [6, 4],
    [5, 4],
  ];
  const specs: Spec[] = [
    // 왼쪽 0~15
    ["fest", "교차로 광장"],
    C("꽃집", 0, 70),
    S("풍차 언덕", 120),
    C("빵집", 0, 80),
    ["jail", "도트 수리소"],
    C("우체국", 1, 90),
    ["box", "럭키 박스"],
    C("목장", 1, 100),
    ["start", "출발 포털"],
    C("기차역", 2, 110),
    ["box", "럭키 박스"],
    C("시계 상점", 2, 120),
    ["warp", "워프 게이트"],
    C("등대", 3, 130),
    S("바다 다리", 150),
    C("항구", 3, 140),
    // 오른쪽 16~30
    C("스키 롯지", 4, 150),
    ["box", "럭키 박스"],
    C("온천", 4, 160),
    ["bonus", "황금 다리"],
    C("오아시스", 5, 170),
    S("피라미드", 190),
    C("모래 성", 5, 180),
    ["start2", "골든 포털"],
    C("정글 캠프", 6, 190),
    ["box", "럭키 박스"],
    C("폭포 동굴", 6, 200),
    ["tax", "국경 세관"],
    C("화산 기지", 7, 220),
    S("용암 온천", 230),
    C("불새 둥지", 7, 250),
  ];
  const xy = [...L, ...R];
  return specs.map(([kind, name, price, group], i) => {
    let next: number[];
    if (i === 0) next = [1, 16];
    else if (i === 15 || i === 30) next = [0];
    else next = [i + 1];
    return {
      kind,
      name,
      ...(price !== undefined && { price }),
      ...(group !== undefined && { group }),
      x: xy[i][0],
      y: xy[i][1],
      next,
    };
  });
}

const CROSS: MapDef = {
  id: "cross",
  name: "크로스로드",
  en: "CROSSROAD",
  desc: "두 마을이 광장에서 만나는 8자 길. 광장을 지날 때마다 어느 쪽으로 갈지 골라요",
  rules: [
    "교차로 광장을 지날 때 왼쪽(출발 포털) · 오른쪽(골든 포털) 루프 중 골라 감",
    "골든 포털을 지나면 월급의 70% · 황금 다리에 서면 보너스",
    "색 그룹이 두 칸씩이라 독점이 빠름 · 라인 독점은 루프의 반 바퀴 (두 변)",
  ],
  grid: [9, 9],
  tiles: crossTiles(),
  groups: [
    { name: "꽃마을", color: "#ff9db5" },
    { name: "풍차 들판", color: "#b8e07a" },
    { name: "기찻길", color: "#c79bff" },
    { name: "항구", color: "#5fb8ff" },
    { name: "설산", color: "#e6f4ff" },
    { name: "사막", color: "#ffd27a" },
    { name: "정글", color: "#5fd08a" },
    { name: "화산", color: "#ff6a4d" },
  ],
  lines: [
    [1, 2, 3, 5, 6, 7],
    [9, 10, 11, 13, 14, 15],
    [16, 17, 18, 20, 21, 22],
    [24, 25, 26, 28, 29, 30],
  ],
  rounds: 20,
  junction: 0,
  sky: "#ffe9c4",
  ground: "#e8c98a",
};

/* ───────────── 3. 오르골 정원 (회전) ───────────── */

const ORGEL: MapDef = {
  id: "orgel",
  name: "오르골 정원",
  en: "ORGEL GARDEN",
  desc: "4바퀴마다 태엽이 감기며 정원의 네 변이 한 변씩 돌아가요. 내 땅 앞 길목이 계속 바뀌어요",
  rules: ["4바퀴마다 네 변이 시계 방향으로 한 변씩 이동 (말은 그 자리에 그대로)", "라인 독점은 지금 그 변에 놓인 땅 기준"],
  grid: [9, 9],
  groups: [
    { name: "튤립 화단", color: "#ff8fb1" },
    { name: "버섯 숲", color: "#d9a57a" },
    { name: "연못", color: "#6fd3ff" },
    { name: "장미 미로", color: "#ff5f7a" },
    { name: "해바라기 밭", color: "#ffd84d" },
    { name: "온실", color: "#8ee0b0" },
    { name: "별사탕 공방", color: "#c9a2ff" },
    { name: "태엽 탑", color: "#8f9bff" },
  ],
  tiles: ringMap([
    ["start", "태엽 출발점"],
    C("튤립 벤치", 0, 60),
    C("물뿌리개 창고", 0, 60),
    ["box", "럭키 박스"],
    C("꿀벌 집", 0, 70),
    S("무지개 분수", 120),
    C("버섯 오두막", 1, 80),
    C("이끼 다리", 1, 90),
    ["jail", "고장난 태엽"],
    C("연잎 보트", 2, 100),
    C("개구리 연못", 2, 100),
    ["tax", "정원사 오두막"],
    C("수련 정자", 2, 110),
    S("오르골 무대", 150),
    C("장미 아치", 3, 120),
    C("가시 미로", 3, 130),
    ["fest", "티파티 테이블"],
    C("해바라기 길", 4, 140),
    ["box", "럭키 박스"],
    C("허수아비 밭", 4, 140),
    C("씨앗 가게", 4, 150),
    S("달빛 그네", 180),
    C("유리 온실", 5, 160),
    C("선인장 방", 5, 170),
    ["warp", "종이비행기 정거장"],
    C("사탕 반죽소", 6, 180),
    ["box", "럭키 박스"],
    C("젤리 화덕", 6, 190),
    C("포장 리본실", 6, 200),
    S("태엽 시계", 220),
    C("톱니 공방", 7, 230),
    C("태엽 탑 꼭대기", 7, 250),
  ]),
  // 자리 기준 (그 변에 지금 놓인 땅)
  lines: [
    [1, 2, 3, 4, 5, 6, 7],
    [9, 10, 11, 12, 13, 14, 15],
    [17, 18, 19, 20, 21, 22, 23],
    [25, 26, 27, 28, 29, 30, 31],
  ],
  rounds: 20,
  every: 4,
  sky: "#ffe1f0",
  ground: "#b7e3a8",
};

export const MAPS: Record<MapId, MapDef> = { town: TOWN, cross: CROSS, orgel: ORGEL };
export const MAP_IDS: MapId[] = ["town", "cross", "orgel"];
