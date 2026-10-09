/**
 * 격투 맵 (학교, 플랫폼 대전). 판은 화면 한 장(1152×648), 높이 y는 화면 아래에서 위로(px).
 * 발판은 가로 x0~x1, 윗면 높이 y — 밑에서는 점프로 뚫고 올라가고, 끝으로 걸어 내려감.
 * solid 발판(바닥)은 못 내려감. 발판 없는 곳으로 떨어지면 화면 밖 → 위에서 잠깐 무적으로 다시 등장
 * (땅에서 잠깐 버티기 전에 또 떨어지면 무적 없이 체력이 깎임 — sim.ts FALL_GRACE).
 * 시뮬레이션이 쓰는 값만 여기 두고, 그림은 components/Fight/stages.ts (또는 bg 그림).
 */
export interface Plat {
  x0: number;
  x1: number;
  /** 윗면 높이(px, 화면 아래가 0) */
  y: number;
  /** 못 내려가는 바닥 */
  solid?: boolean;
  /** 건물처럼 아래까지 막힌 덩어리 — 윗면보다 낮으면 옆에서 못 들어감 */
  wall?: boolean;
  /** 그림 종류 */
  kind: string;
}

export interface MapDef {
  id: string;
  name: string;
  desc: string;
  plats: Plat[];
  /** 시작 위치 x (1P, 2P) — 그 아래 가장 높은 발판 위에 섬 */
  spawn: [number, number];
  /** 떨어진 뒤 다시 내려오는 위치 x 후보 (상대에게서 먼 곳) */
  respawn: number[];
  /** 배경 그림 경로 (16:9). 있으면 코드 배경 대신 씀 */
  bg?: string;
  /** 배경 그림에 발판까지 그려져 있으면 true (발판 따로 안 그림) */
  bgPlats?: boolean;
  /** 이 맵의 배경음악 (대전 중, 맵 선택에서 이 맵에 커서가 있을 때) */
  bgm?: string;
}

export const MAPS: MapDef[] = [
  {
    // 그림: public/fight/bg/rooftop.webp (1672×941 원본 → 0.689배)
    id: "rooftop",
    name: "노을 옥상",
    desc: "벚꽃 날리는 해 질 녘 학교 옥상 — 떨어질 걱정 없는 넓은 바닥, 양쪽 건물 지붕까지",
    plats: [
      { x0: 0, x1: 1152, y: 186, solid: true, kind: "floor" },
      { x0: 238, x1: 466, y: 301, kind: "beam" },
      { x0: 690, x1: 918, y: 301, kind: "beam" },
      { x0: 452, x1: 700, y: 396, kind: "beam" },
      { x0: 16, x1: 244, y: 473, kind: "roof" },
      { x0: 1000, x1: 1152, y: 498, kind: "roof" },
    ],
    spawn: [380, 772],
    respawn: [360, 576, 800],
    bg: "/fight/bg/rooftop.webp",
    bgPlats: true,
    bgm: "/fight/bgm-rooftop.mp3",
  },
  {
    // 그림: public/fight/bg/sky.webp (1920×1080 = 판 ×5/3) — 배경에 발판 구름 6개를 합성해 둠
    // (10.09 정리: 9개 → 6개, 좌우 대칭 — 구름이 너무 많고 흩어져 싸움이 산만하던 것)
    // (10.10 아래 큰 구름 좌우로 넓힘 310~845 → 180~975, 가운데 낮은 구름 하나 추가 — 공중에서만 싸우던 것)
    id: "sky",
    name: "천공 구름길",
    desc: "하늘 위 좌우로 나란히 떠 있는 구름 발판 — 아래 큰 구름 말고는 전부 낭떠러지",
    plats: [
      { x0: 180, x1: 975, y: 150, solid: true, kind: "cloud" },
      { x0: 40, x1: 230, y: 270, kind: "cloud" },
      { x0: 922, x1: 1112, y: 270, kind: "cloud" },
      { x0: 482, x1: 672, y: 270, kind: "cloud" },
      { x0: 270, x1: 490, y: 390, kind: "cloud" },
      { x0: 662, x1: 882, y: 390, kind: "cloud" },
      { x0: 466, x1: 686, y: 500, kind: "cloud" },
    ],
    spawn: [400, 752],
    respawn: [330, 578, 825],
    bg: "/fight/bg/sky.webp",
    bgPlats: true,
    bgm: "/fight/bgm-sky.mp3",
  },
  {
    // 그림: public/fight/bg/skyscraper.webp (1920×1080) — 높이 다른 아파트 두 동 옥상, 가운데는 낭떠러지
    id: "skyscraper",
    name: "달밤 마천루",
    desc: "보름달 뜬 도시 위 아파트 옥상 두 동 — 오른쪽 동이 조금 더 높고, 사이 낭떠러지는 점프로 건넘",
    plats: [
      { x0: 0, x1: 420, y: 200, solid: true, wall: true, kind: "roof" },
      // 10.10 오른쪽 동을 한 칸(150px) 왼쪽으로 — 사이 300 → 150px
      { x0: 570, x1: 1152, y: 270, solid: true, wall: true, kind: "roof" },
    ],
    spawn: [230, 940],
    respawn: [210, 940],
    bg: "/fight/bg/skyscraper.webp",
    bgPlats: true,
    bgm: "/fight/bgm-skyscraper.mp3",
  },
  {
    // 그림: public/fight/bg/aurora.webp (원본 1672×941 → 판 ×0.689) — 넓은 1자 무대 하나, 양 끝 밖은 낭떠러지
    // 발판 윗면은 그림의 돌판 윗면(뒤 모서리 y≈561 ~ 앞 모서리 y≈591)에서 발이 놓이는 줄 y≈580 → 648 - 580×0.689 ≈ 248
    id: "aurora",
    name: "오로라 빙상",
    desc: "오로라 아래 얼어붙은 호수 위 넓은 1자 무대 — 발판은 하나뿐, 양 끝 밖은 낭떠러지",
    plats: [{ x0: 100, x1: 1048, y: 248, solid: true, kind: "stone" }],
    spawn: [380, 770],
    respawn: [380, 770],
    bg: "/fight/bg/aurora.webp",
    bgPlats: true,
    // 「Crown of Permafrost」 (끝 무음 2초 자름, 음량 다른 맵 곡에 맞춤)
    bgm: "/fight/bgm-aurora.mp3",
  },
];
