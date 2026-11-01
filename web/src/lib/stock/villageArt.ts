/*
 * 애니메 차트 마을 — 그림 좌표 (아트 기준). village.ts 의 BUILDINGS(id) 와 짝.
 *  MAP: 마을 그림 한 장(1536×1024, 35° 쿼터뷰). 좌표는 전부 이 그림의 픽셀.
 *  ART[id]: 건물이 차지하는 네모(클릭 · 이름표 위치) · 문(걸어가서 서는 곳) · 밤에 빛나는 점
 *  ROADS: 길 위의 점들과 연결 — 캐릭터는 이 그래프를 따라 걸음 (건물을 뚫고 가지 않게)
 *  AMY: 스프라이트 시트 정보 (scripts: amyweb.py 가 만든 amy.json 그대로)
 */

export const MAP = { w: 1536, h: 1024 };

export interface BuildingArt {
  /** 건물 네모 (왼쪽 위 · 크기) */
  box: { x: number; y: number; w: number; h: number };
  /** 문 앞 (캐릭터 발 위치) */
  door: { x: number; y: number };
  /** 이름표가 뜨는 점 (보통 지붕 위) */
  label: { x: number; y: number };
  /** 밤 조명 (x, y, 반지름, 색) */
  glow?: [number, number, number, string][];
}

export const ART: Record<string, BuildingArt> = {
  exchange: { box: { x: 500, y: 90, w: 340, h: 340 }, door: { x: 705, y: 410 }, label: { x: 690, y: 150 }, glow: [[700, 240, 130, "#7fb0ff"], [690, 120, 60, "#ffd86b"]] },
  coin: { box: { x: 900, y: 120, w: 250, h: 300 }, door: { x: 990, y: 405 }, label: { x: 1020, y: 160 }, glow: [[1020, 160, 70, "#5ef3ff"], [985, 260, 110, "#ffd34d"]] },
  hall: { box: { x: 1150, y: 340, w: 280, h: 280 }, door: { x: 1230, y: 605 }, label: { x: 1280, y: 360 }, glow: [[1260, 440, 120, "#ff9a7a"]] },
  poker: { box: { x: 90, y: 350, w: 330, h: 270 }, door: { x: 335, y: 605 }, label: { x: 250, y: 365 }, glow: [[260, 440, 130, "#ff7bb0"], [330, 490, 60, "#ffd36b"]] },
  realty: { box: { x: 160, y: 640, w: 270, h: 250 }, door: { x: 330, y: 865 }, label: { x: 300, y: 650 }, glow: [[300, 770, 90, "#9df5c9"]] },
  board: { box: { x: 580, y: 620, w: 300, h: 290 }, door: { x: 650, y: 885 }, label: { x: 735, y: 640 }, glow: [[730, 760, 110, "#c9a8ff"], [720, 860, 50, "#ffe27a"]] },
  shop: { box: { x: 1050, y: 610, w: 300, h: 250 }, door: { x: 1120, y: 850 }, label: { x: 1200, y: 625 }, glow: [[1200, 720, 100, "#ffd6a5"]] },
  home: { box: { x: 110, y: 150, w: 230, h: 220 }, door: { x: 250, y: 360 }, label: { x: 220, y: 165 }, glow: [[220, 240, 90, "#ffe1a8"]] },
};

/** 단독주택 자리 (estate LOT id → 네모 · 문 앞). hill 은 언덕 위 대저택 */
export const LOT_ART: Record<string, { box: { x: number; y: number; w: number; h: number }; door: { x: number; y: number } }> = {
  hill: { box: { x: 1290, y: 30, w: 246, h: 200 }, door: { x: 1400, y: 300 } },
  blossom1: { box: { x: 200, y: 20, w: 100, h: 100 }, door: { x: 250, y: 140 } },
  blossom2: { box: { x: 300, y: 10, w: 100, h: 100 }, door: { x: 350, y: 130 } },
  plaza: { box: { x: 420, y: 0, w: 85, h: 90 }, door: { x: 462, y: 105 } },
  lake1: { box: { x: 580, y: 0, w: 85, h: 70 }, door: { x: 620, y: 85 } },
  lake2: { box: { x: 725, y: 0, w: 85, h: 70 }, door: { x: 770, y: 85 } },
  clock: { box: { x: 880, y: 0, w: 85, h: 60 }, door: { x: 920, y: 75 } },
  light: { box: { x: 960, y: 10, w: 60, h: 60 }, door: { x: 990, y: 85 } },
  hanok: { box: { x: 70, y: 60, w: 90, h: 90 }, door: { x: 120, y: 160 } },
  front: { box: { x: 0, y: 130, w: 60, h: 60 }, door: { x: 40, y: 200 } },
};

/** 길 그래프: 점 · 이웃 (양방향). 광장 고리(분수 둘레) + 건물 문 + 위쪽 주택가 길 */
export const ROADS: { pts: [number, number][]; links: [number, number][] } = {
  pts: [
    [640, 610], // 0 광장 남서 (시작)
    [745, 372], // 1 고리 북
    [1045, 520], // 2 고리 동
    [445, 520], // 3 고리 서
    [957, 414], // 4 고리 북동
    [533, 414], // 5 고리 북서
    [957, 626], // 6 고리 남동
    [533, 626], // 7 고리 남서
    [705, 410], // 8 증권거래소 문
    [990, 405], // 9 코인 문
    [1230, 605], // 10 홀 문
    [335, 605], // 11 포커 문
    [420, 760], // 12 부동산 가는 길
    [330, 865], // 13 부동산 문
    [540, 790], // 14 전당 가는 길
    [650, 885], // 15 전당 문
    [1000, 780], // 16 상점 가는 길
    [1120, 850], // 17 상점 문
    [400, 330], // 18 내 집 가는 길
    [250, 360], // 19 내 집 문
    [1200, 250], // 20 언덕 가는 길
    [1300, 290], // 21 언덕 계단 아래
    [1400, 300], // 22 대저택 문
    [330, 180], // 23 위 길 서
    [560, 150], // 24 위 길
    [820, 110], // 25 위 길
    [1000, 120], // 26 위 길 동
    [120, 900], // 27 주차장
    [1130, 290], // 28 코인 옆길
  ],
  links: [
    [0, 6],
    [0, 7],
    [1, 4],
    [1, 5],
    [2, 4],
    [2, 6],
    [3, 5],
    [3, 7],
    [1, 8],
    [4, 9],
    [2, 10],
    [6, 10],
    [3, 11],
    [7, 11],
    [7, 12],
    [12, 13],
    [7, 14],
    [14, 15],
    [6, 16],
    [16, 17],
    [5, 18],
    [18, 19],
    [9, 28],
    [28, 20],
    [20, 21],
    [21, 22],
    [18, 23],
    [23, 24],
    [24, 25],
    [25, 26],
    [26, 28],
    [8, 24],
    [13, 27],
    [19, 23],
  ],
};

export const SPAWN = { x: 640, y: 605 };

/** 밤 가로등 (길 위 조명) */
export const LAMPS: [number, number][] = [
  [405, 250],
  [570, 440],
  [905, 440],
  [885, 300],
  [1255, 320],
  [1455, 220],
  [560, 660],
  [950, 660],
  [445, 760],
  [935, 840],
  [1080, 540],
  [190, 620],
  [1395, 130],
  [295, 880],
];

export type AmyDir = "front" | "frontdiag" | "side" | "backdiag" | "back";
export interface Sheet {
  file: string;
  n: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}
export const AMY_BASE = "/stock/amy";
/** 캐릭터 키 (그림 픽셀) */
export const AMY_H = 168;
export const AMY: Record<AmyDir, { walk: Sheet; idle: Sheet; start: number; phi: number }> = {
  front: { walk: { file: "amy_front_walk.webp", n: 20, w: 110, h: 178, ax: 55.2, ay: 168 }, idle: { file: "amy_front_idle.webp", n: 23, w: 111, h: 169, ax: 55.3, ay: 166 }, start: 15, phi: 0 },
  frontdiag: { walk: { file: "amy_frontdiag_walk.webp", n: 20, w: 116, h: 180, ax: 72.6, ay: 171 }, idle: { file: "amy_frontdiag_idle.webp", n: 26, w: 97, h: 172, ax: 62.6, ay: 169 }, start: 5, phi: 45 },
  side: { walk: { file: "amy_side_walk.webp", n: 20, w: 113, h: 176, ax: 54.4, ay: 170 }, idle: { file: "amy_side_idle.webp", n: 21, w: 82, h: 172, ax: 50.6, ay: 169 }, start: 14, phi: 90 },
  backdiag: { walk: { file: "amy_backdiag_walk.webp", n: 20, w: 128, h: 172, ax: 78.4, ay: 160 }, idle: { file: "amy_backdiag_idle.webp", n: 42, w: 101, h: 161, ax: 66.6, ay: 158 }, start: 17, phi: 135 },
  back: { walk: { file: "amy_back_walk.webp", n: 20, w: 113, h: 167, ax: 56.7, ay: 160 }, idle: { file: "amy_back_idle.webp", n: 59, w: 118, h: 160, ax: 58.3, ay: 157 }, start: 10, phi: 180 },
};
export const AMY_FILES = Object.values(AMY).flatMap((d) => [`${AMY_BASE}/${d.walk.file}`, `${AMY_BASE}/${d.idle.file}`]);
/** 걷는 속도 (그림 px/초, 가로 기준 · 세로는 35° 라 ×0.57) */
export const WALK_SPEED = 150;
export const Y_SCALE = Math.sin((35 * Math.PI) / 180);
export const WALK_MS = 55;
export const IDLE_MS = 80;

/** 이동 방향(화면 dx, dy) → 스프라이트 방향 + 좌우 반전 */
export function dirOf(dx: number, dy: number): { dir: AmyDir; flip: boolean } {
  // 세로는 눌려 보이니 실제 땅 기준 각도로 되돌려서 판단
  const a = (Math.atan2(dx, -dy / Y_SCALE) * 180) / Math.PI; // 0 = 위(back) … 180 = 아래(front), 양수 = 오른쪽
  const t = Math.abs(a);
  const dir: AmyDir = t < 22.5 ? "back" : t < 67.5 ? "backdiag" : t < 112.5 ? "side" : t < 157.5 ? "frontdiag" : "front";
  return { dir, flip: a < 0 && dir !== "back" && dir !== "front" };
}

/** 길 그래프에서 가장 가까운 점 */
export function nearestNode(x: number, y: number): number {
  let best = 0,
    bd = Infinity;
  ROADS.pts.forEach(([px, py], i) => {
    const d = (px - x) ** 2 + ((py - y) / Y_SCALE) ** 2;
    if (d < bd) (bd = d), (best = i);
  });
  return best;
}

/** 길을 따라 a → b 로 가는 점 목록 (BFS · 거리 가중 다익스트라) */
export function roadPath(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] {
  const s = nearestNode(from.x, from.y),
    e = nearestNode(to.x, to.y);
  const n = ROADS.pts.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of ROADS.links) adj[a].push(b), adj[b].push(a);
  const dist = Array(n).fill(Infinity),
    prev = Array(n).fill(-1);
  dist[s] = 0;
  const done = Array(n).fill(false);
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (const v of adj[u]) {
      const d = dist[u] + Math.hypot(ROADS.pts[u][0] - ROADS.pts[v][0], ROADS.pts[u][1] - ROADS.pts[v][1]);
      if (d < dist[v]) (dist[v] = d), (prev[v] = u);
    }
  }
  const nodes: number[] = [];
  for (let c = e; c >= 0; c = prev[c]) {
    nodes.unshift(c);
    if (c === s) break;
  }
  const pts = nodes.map((i) => ({ x: ROADS.pts[i][0], y: ROADS.pts[i][1] }));
  // 출발점과 가장 가까운 점이 멀리 돌아가는 꼴이면(바로 옆 점) 첫 점은 건너뜀
  const out = [...pts, to].filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 2);
  return out;
}
