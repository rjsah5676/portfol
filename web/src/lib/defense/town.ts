/**
 * 해피 타운 (PIXEL MARBLE 「해피 타운」 맵으로 만든 확장 스테이지) — 고유 규칙 수치 · 칸 이름.
 * 시뮬(sim.ts)이 읽음 → 결정론 규칙 그대로 (수치를 바꾸면 BALANCE_VER 올리기).
 *
 * v2 「내 말이 돌다가 내 땅에 서면 터진다」 (v1 통행료 · 자동 주사위는 「무지성으로 다 짓기」가 정답이라 버림)
 *  - 굴리기: 웨이브마다 주사위 1번 (최대 TOWN.rollMax 개까지 모아 둠, 명령 roll) — 주사위 둘 합만큼 내 말이 길을 돎
 *  - 건물: 아무 동네 칸에나 골드로 (오두막 → 2층집 → 빌딩, 명령 build). 새 땅은 가진 땅이 많을수록 비쌈 → 넓게 vs 크게
 *  - 잭팟: 말이 내 건물 칸에 서면 TOWN.jack[단계] 골드 · 연속으로 맞히면 배수 TOWN.combo
 *  - 더블: 한 번 더 · 6-6: 골라 뽑기권(대박) · 출발 포털을 지나면 월급 (바퀴마다 커짐)
 *  - 모서리: 출발 포털(월급 한 번 더) · 수리소(무료 소환) · 축제 무대(골드) · 워프 게이트(한 번 더 굴림)
 *  - UR 보스 (enemies.ts TOWN_BOSSES): DICE 순간이동 · MOA 건물 빼앗기(그 칸 잭팟 없음) · FORTE 앙코르
 */

export const TOWN_NAME = "해피 타운";
export const TOWN_EN = "HAPPY TOWN";

export const TOWN = {
  /** 새 땅(오두막) 값 = newBase + newPer × 가진 건물 수 */
  newBase: 40,
  newPer: 25,
  /** 올리기 값 (오두막→2층집 · 2층집→빌딩) */
  up: [0, 90, 200],
  /** 말이 서면 받는 잭팟 (단계 0~3) × (1 + 웨이브 × jackWave) */
  jack: [0, 40, 100, 260],
  jackWave: 1 / 22,
  /** 연속 잭팟 배수 (1번째 · 2번째 · 3번째부터) */
  combo: [1, 2, 3],
  /** 출발 포털을 지날 때 월급 = lapBase + lapPer × 지금까지 돈 바퀴 */
  lapBase: 20,
  lapPer: 4,
  /** 웨이브마다 주는 굴리기 · 모아 둘 수 있는 최대 (더블 · 워프로 받은 건 넘어도 됨) */
  rollMax: 3,
  /** 수리소: 무료 소환 · 축제 무대: festBase + festPer × 웨이브 골드 */
  repairFree: 2,
  festBase: 30,
  festPer: 3,
} as const;

export const BUILD_NAME = ["빈 땅", "오두막", "2층집", "빌딩"] as const;
/** 모서리 칸 (길 칸 번호) */
export const CORNER_AT = { start: 0, jail: 8, fest: 13, warp: 21 } as const;
export const CORNER_TEXT: Record<"start" | "jail" | "fest" | "warp", { name: string; desc: string }> = {
  start: { name: "출발 포털", desc: "지나가면 월급 · 딱 서면 월급 한 번 더" },
  jail: { name: "도트 수리소", desc: `서면 무료 소환 ${TOWN.repairFree}회` },
  fest: { name: "축제 무대", desc: "서면 골드 보너스" },
  warp: { name: "워프 게이트", desc: "서면 바로 한 번 더 굴려요" },
};

/** 길 칸(0..25) 이름 · 동네 색 · 마블 랜드마크 그림 번호 (public/marble/lm/town-<n>.webp — 빌딩 단계 그림) */
export interface TownTile {
  name: string;
  color: string;
  /** 마블 칸 번호 (랜드마크 그림이 있으면) */
  lm?: number;
  /** 모서리 특수 칸 그림 (public/marble/deco/sp-*.webp) */
  sp?: "start" | "jail" | "fest" | "warp";
}
const G = ["#ff9db5", "#8ee08a", "#c79bff", "#9fb3c8", "#ffd84d", "#ff7a45", "#5fd0ff", "#4a6dff"];
export const TOWN_TILES: TownTile[] = [
  { name: "출발 포털", color: "#ffffff", sp: "start" },
  { name: "픽셀 분식", color: G[0], lm: 1 },
  { name: "8비트 문방구", color: G[0], lm: 2 },
  { name: "도트 세탁소", color: G[0], lm: 4 },
  { name: "픽셀 해변", color: "#ffe28a" },
  { name: "우산 놀이터", color: G[1], lm: 6 },
  { name: "물방울 분수", color: G[1], lm: 7 },
  { name: "소영 학원", color: G[2], lm: 9 },
  { name: "도트 수리소", color: "#ffffff", sp: "jail" },
  { name: "도서관", color: G[2], lm: 10 },
  { name: "매점", color: G[2], lm: 12 },
  { name: "시계탑 광장", color: "#ffe28a" },
  { name: "이반 도장", color: G[3], lm: 14 },
  { name: "축제 무대", color: "#ffffff", sp: "fest" },
  { name: "권투장", color: G[3], lm: 15 },
  { name: "창술원", color: G[4], lm: 17 },
  { name: "전파사", color: G[4], lm: 19 },
  { name: "오락실", color: G[4], lm: 20 },
  { name: "오로라 언덕", color: "#ffe28a" },
  { name: "이그나 화덕", color: G[5], lm: 22 },
  { name: "불꽃 가게", color: G[5], lm: 23 },
  { name: "워프 게이트", color: "#ffffff", sp: "warp" },
  { name: "옥상 정원", color: G[6], lm: 25 },
  { name: "루프탑 카페", color: G[6], lm: 27 },
  { name: "물탱크 전망대", color: G[6], lm: 28 },
  { name: "스카이 라운지", color: G[7], lm: 31 },
];
