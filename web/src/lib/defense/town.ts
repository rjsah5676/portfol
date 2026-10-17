/**
 * 해피 타운 원정 (v3 시제품) — 마블 판이 곧 월드맵인 로그라이크 원정. 시뮬(sim.ts)이 읽음 → 결정론 규칙 그대로.
 *
 * 한 판 = 판 하나(Game)가 계속 이어짐 (유닛 · 강화 · 골드가 칸에서 칸으로 넘어감)
 *  1) 갈림길: 주사위 둘을 굴려 어느 눈으로 갈지 고름 (명령 exp a=0/1) → 분홍 말이 길을 따라 이동
 *  2) 멈춘 칸 = 다음 할 일: 동네 칸 전투(EXP.fightWaves) · 노란 칸 엘리트(웨이브 + 글리치 시티 보스) ·
 *     수리소 휴식 · 축제 무대 상점 · 워프 게이트 유물 · 출발 포털(한 바퀴) = UR 보스 → 잡으면 원정 성공
 *  3) 전투가 끝나면 유닛 3장 중 1장 드래프트 (엘리트 보스를 잡으면 유물도). 못 잡은 적은 필드에 남아 다음 전투로 이어짐
 *  4) 필드 적이 한도(100)에 차거나 UR 보스 시간 초과면 실패 — 메인과 같은 규칙. UR 보스는 적어도 EXP.bossWave 세기
 * 캠프(고르는 화면)에선 시간이 멈추고 소환 · 합성 · 판매 · 강화는 할 수 있음
 */

export const TOWN_NAME = "해피 타운";
export const TOWN_EN = "HAPPY TOWN";

export const EXP = {
  /** 전투 칸 웨이브 수 · 엘리트 칸(그 뒤 보스 하나) */
  fightWaves: 6,
  eliteWaves: 3,
  /** UR 보스 최소 세기 (이 웨이브만큼) — 칸을 건너뛰어 일찍 오면 약한 덱으로 센 보스 */
  bossWave: 36,
  /** 휴식: 필드 적을 이 비율만큼 치움 · 상점 정화: 이만큼 */
  restClear: 0.6,
  shopClear: 25,
  /** 드래프트 건너뛰면 골드 */
  skipGold: 40,
  /** 상점 값 (구간마다 +shopUp 배) */
  shopUp: 0.12,
} as const;

/** 길 칸 종류 */
export type ExpNode = "fight" | "elite" | "boss" | "shop" | "rest" | "event";
export const EXP_ELITE = [4, 11, 18];
export const expNodeOf = (t: number): ExpNode =>
  t === 0 ? "boss" : t === 8 ? "rest" : t === 13 ? "shop" : t === 21 ? "event" : EXP_ELITE.includes(t) ? "elite" : "fight";
export const EXP_NODE_TEXT: Record<ExpNode, { name: string; desc: string; color: string }> = {
  fight: { name: "전투", desc: `${EXP.fightWaves}웨이브 · 끝나면 유닛 드래프트`, color: "#bfb3ff" },
  elite: { name: "엘리트", desc: `${EXP.eliteWaves}웨이브 + 보스 · 잡으면 유물`, color: "#ff6b7f" },
  boss: { name: "UR 보스", desc: "한 바퀴 끝 · 잡으면 원정 성공", color: "#ff5fa2" },
  shop: { name: "상점", desc: "골드로 회복 · 유닛 · 유물", color: "#ffd23f" },
  rest: { name: "휴식", desc: "필드 적 정리 또는 유닛 단련", color: "#6dff8f" },
  event: { name: "유물", desc: "원정 유물 3개 중 하나", color: "#9be7ff" },
};

/** 원정 유물 (이번 원정에서만) — 수치보다 규칙을 바꾸는 것 */
export const EXP_RELICS: { id: string; name: string; desc: string }[] = [
  { id: "oath_knight", name: "기사단 서약", desc: "소환이 늘 기사단으로 나와요" },
  { id: "oath_mech", name: "기계공방 서약", desc: "소환이 늘 기계공방으로 나와요" },
  { id: "oath_arcane", name: "마도회 서약", desc: "소환이 늘 마도회로 나와요" },
  { id: "alch", name: "연금 합성", desc: "합성할 때 25% 확률로 두 등급 위가 나와요 (레전드까지)" },
  { id: "twin", name: "쌍둥이 소환", desc: "소환할 때 20% 확률로 같은 유닛이 하나 더" },
  { id: "growth", name: "성장통", desc: "전투가 끝날 때마다 가장 낮은 등급 유닛 칸이 한 등급 올라요" },
  { id: "piggy", name: "돼지 저금통", desc: "전투가 끝날 때마다 가진 골드의 25% 이자 (최대 150)" },
  { id: "iron", name: "철벽", desc: "필드 적 한도 +25" },
  { id: "blood", name: "피의 계약", desc: "필드 적 한도 -20, 모든 유닛 피해 +35%" },
  { id: "dice3", name: "세 번째 주사위", desc: "갈림길에서 주사위 3개 중 골라요" },
];
export const EXP_RELIC: Record<string, (typeof EXP_RELICS)[number]> = Object.fromEntries(EXP_RELICS.map((r) => [r.id, r]));

/** 상점 물건 */
export type ShopKind = "heal" | "free" | "epic" | "legend" | "relic" | "up";
export const SHOP: Record<ShopKind, { name: string; desc: string; cost: number }> = {
  heal: { name: "정화 폭탄", desc: "필드 적 25 마리를 치워요", cost: 80 },
  free: { name: "소환권 묶음", desc: "무료 소환 3회", cost: 70 },
  epic: { name: "에픽 카드", desc: "무작위 에픽 유닛 1기", cost: 150 },
  legend: { name: "레전드 카드", desc: "무작위 레전드 유닛 1기", cost: 450 },
  relic: { name: "원정 유물", desc: "무작위 원정 유물 하나", cost: 220 },
  up: { name: "세력 훈련", desc: "가장 약한 세력 강화 +2", cost: 100 },
};

export const BUILD_NAME = ["빈 땅", "오두막", "2층집", "빌딩"] as const;
export const CORNER_TEXT: Record<"start" | "jail" | "fest" | "warp", { name: string; desc: string }> = {
  start: { name: "출발 포털", desc: EXP_NODE_TEXT.boss.desc },
  jail: { name: "도트 수리소", desc: EXP_NODE_TEXT.rest.desc },
  fest: { name: "축제 무대", desc: EXP_NODE_TEXT.shop.desc },
  warp: { name: "워프 게이트", desc: EXP_NODE_TEXT.event.desc },
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
