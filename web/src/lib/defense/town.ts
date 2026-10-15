/**
 * 해피 타운 (PIXEL MARBLE 「해피 타운」 맵으로 만든 확장 스테이지) — 고유 규칙 수치 · 칸 이름.
 * 시뮬(sim.ts)이 읽음 → 결정론 규칙 그대로 (수치를 바꾸면 BALANCE_VER 올리기).
 *
 * 길(한 바퀴 26칸)이 마블 판처럼 동네 칸이 됨. 네 모서리는 특수 칸(출발 포털 · 수리소 · 축제 무대 · 워프 게이트, 장식).
 *  - 건물: 길 칸 바로 안쪽(앞 칸)에 유닛이 있으면 골드로 지음 (오두막 → 2층집 → 빌딩, 명령 build)
 *          그 칸에서 쓰러진 적이 통행료(골드) · 2층집부터 그 칸을 지나는 적이 느려짐
 *          앞 칸 유닛이 없어지면 영업 정지 (건물은 남아 있음 — 다시 놓으면 영업)
 *  - 웨이브 주사위: 보스가 아닌 웨이브가 시작할 때마다 (2웨이브부터) — 황금 칸 · 늪 · 축제 · 더블
 *  - UR 보스 (enemies.ts TOWN_BOSSES): DICE 순간이동 · MOA 건물 빼앗기 · FORTE 앙코르
 */

export const TOWN_NAME = "해피 타운";
export const TOWN_EN = "HAPPY TOWN";

export const TOWN = {
  /** 건물 짓기 · 올리기 비용 (0→1 · 1→2 · 2→3) */
  build: [30, 60, 120],
  /** 그 칸에서 쓰러진 적 하나당 통행료 (단계 0~3) */
  toll: [0, 2, 4, 8],
  /** 그 칸을 지나는 적 둔화 (단계 0~3) */
  slow: [0, 0, 0.1, 0.2],
  /** 주사위 「황금 칸」: 건물이 있으면 통행료 ×gold, 없으면 처치마다 goldBare */
  gold: 3,
  goldBare: 3,
  /** 주사위 「늪」: 그 칸 둔화 */
  mud: 0.45,
  /** 주사위 「축제」: 이번 웨이브 모든 처치 골드 + */
  fest: 1,
} as const;

export const BUILD_NAME = ["빈 땅", "오두막", "2층집", "빌딩"] as const;

/** 주사위 이벤트 (눈 → 종류): 1 · 2 황금 칸 · 3 · 4 늪 · 5 축제 · 6 더블(황금 칸 + 늪) */
export type DiceKind = "gold" | "mud" | "fest" | "double";
export const diceKindOf = (roll: number): DiceKind => (roll <= 2 ? "gold" : roll <= 4 ? "mud" : roll === 5 ? "fest" : "double");
export const DICE_TEXT: Record<DiceKind, { name: string; desc: string }> = {
  gold: { name: "황금 칸", desc: "이번 웨이브 그 칸에서 쓰러진 적이 통행료 ×3 (빈 땅이면 처치마다 +3골드)" },
  mud: { name: "늪", desc: "이번 웨이브 그 칸을 지나는 적이 크게 느려져요" },
  fest: { name: "축제", desc: "이번 웨이브 모든 처치 골드 +1" },
  double: { name: "더블!", desc: "황금 칸 + 늪이 한꺼번에" },
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
