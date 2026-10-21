/**
 * 글리치 원정 (해피 타운 자리 · 로그라이크) — 시뮬(sim.ts)이 읽는 규칙 수치 · 이름. 결정론 규칙 그대로.
 *
 * 한 판 = Game 하나가 이어짐 (유닛 · 강화 · 골드)
 *  0) 시작 분대 고르기 (해금된 것 중) → 분대 유닛 + 분대 유물
 *  1) 지도: EXP.floors 층 + 꼭대기 보스. 처음부터 다 보임 · 보스도 공개. 다음 층 이어진 칸을 골라 이동 (명령 exp a=칸 번호)
 *  2) 칸: 전투(웨이브 → 정리 시간 → 남은 적만큼 원정 체력) · 엘리트(기믹 엘리트) · ? 이벤트 · 상점 · 휴식 · 보물 · 보스
 *  3) 전투 끝 드래프트 · 엘리트 승리 유물 · 원정 체력 0 / 필드 한도 / 보스 시간 초과면 실패, 보스를 잡으면 성공
 *  원정 단계(= 로드아웃 town)가 오를수록 비틀기(EXP_ASC)가 쌓이고 적이 세짐
 */

export const TOWN_NAME = "글리치 원정";
export const TOWN_EN = "GLITCH EXPEDITION";

export const EXP = {
  hp: 30,
  floors: 8,
  lanes: 4,
  fightWaves: 5,
  eliteWaves: 4,
  /** 마지막 웨이브 뒤 정리 시간 (초) — 지나면 남은 적만큼 원정 체력 */
  cleanSec: 15,
  leak: 1,
  leakElite: 3,
  /** 전투 하나에서 깎이는 체력 상한 (기믹 엘리트 도망 빼고) */
  leakMax: 12,
  /** 기믹 엘리트를 못 잡으면 */
  gimEscape: 8,
  /** 층 f(0부터) 전투의 시작 웨이브 = waveBase + waveFloor × f */
  waveBase: 1,
  waveFloor: 3,
  /** 보스 세기 웨이브 */
  bossWave: 30,
  restHeal: 0.3,
  skipGold: 40,
  /** 전투 · 엘리트 보상 골드 (+층마다) */
  fightGold: 30,
  eliteGold: 60,
  floorGold: 8,
  /** 2막: 웨이브 오프셋 · 들어갈 때 회복 · 2막 보스까지 잡으면 보상 배수 */
  act2Wave: 18,
  act2Boss: 42,
  act2Heal: 10,
  act2Reward: 1.5,
} as const;
/** 원정 보스를 처음 잡으면 메인 시작 치트(meta.ts PATCHES) 해금 — 보스 fighter → 패치 id */
export const EXP_BOSS_PATCH: Record<string, string> = { "ur-dice": "dice", "ur-moa": "greed", "ur-forte": "split" };

export type ExpNode = "fight" | "elite" | "event" | "shop" | "rest" | "treasure" | "boss";
export const EXP_NODE_TEXT: Record<ExpNode, { name: string; desc: string; color: string; icon: string }> = {
  fight: { name: "전투", desc: `${EXP.fightWaves}웨이브 · 끝나면 유닛 드래프트`, color: "#bfb3ff", icon: "skull" },
  elite: { name: "엘리트", desc: `${EXP.eliteWaves}웨이브 + 기믹 엘리트 · 잡으면 원정 유물`, color: "#ff6b7f", icon: "skull" },
  event: { name: "?", desc: "무슨 일이 생길지 몰라요", color: "#9be7ff", icon: "dice" },
  shop: { name: "상점", desc: "유닛 · 유물 · 회복 · 저주 풀기", color: "#ffd23f", icon: "coin" },
  rest: { name: "휴식", desc: "체력 회복 또는 유닛 단련", color: "#6dff8f", icon: "clover" },
  treasure: { name: "보물", desc: "원정 유물 하나 확정", color: "#ffb347", icon: "chest" },
  boss: { name: "보스", desc: "잡으면 원정 성공", color: "#ff5fa2", icon: "skull" },
};

/** 전투 수식어 (2층부터 절반 확률) */
export type FightMod = "swarm" | "armor" | "rush" | "gold" | "split";
export const FIGHT_MOD: Record<FightMod, { name: string; desc: string; count: number; hp: number; spd: number; armor: number; gold: number }> = {
  swarm: { name: "떼거리", desc: "적이 많지만 약해요", count: 1.6, hp: 0.6, spd: 1, armor: 1, gold: 1 },
  armor: { name: "철갑", desc: "적이 적지만 방어가 높아요 (마법이 유리)", count: 0.7, hp: 1.1, spd: 1, armor: 2.5, gold: 1.4 },
  rush: { name: "질주", desc: "적이 빨라요", count: 1, hp: 0.9, spd: 1.35, armor: 1, gold: 1.2 },
  gold: { name: "황금", desc: "적이 단단하지만 처치 골드 ×2", count: 1, hp: 1.25, spd: 1, armor: 1, gold: 2 },
  split: { name: "분열", desc: "엘리트 · 큰 적이 쓰러지면 둘로", count: 1, hp: 1, spd: 1, armor: 1, gold: 1.2 },
};

/** 기믹 엘리트 (엘리트 칸에 한 마리) */
export type Gim = "thief" | "healer" | "golem" | "mirror";
export const GIM: Record<Gim, { name: string; desc: string; hp: number; spd: number; size: 0 | 1 | 2; color: string }> = {
  thief: { name: "도둑 고블린", desc: "아주 빨라요. 한 바퀴 돌면 골드 25%를 훔쳐 도망 · 잡으면 +80G", hp: 9, spd: 2.1, size: 0, color: "#ffd23f" },
  healer: { name: "치유 사제", desc: "3초마다 주변 적을 회복시켜요 — 먼저 잡기", hp: 14, spd: 0.8, size: 1, color: "#6dff8f" },
  golem: { name: "분열 골렘", desc: "쓰러지면 둘로, 그 둘도 한 번 더 갈라져요", hp: 16, spd: 0.7, size: 2, color: "#c79bff" },
  mirror: { name: "거울 기사", desc: "물리 피해 절반 · 6초마다 보호막 — 마법이 유리", hp: 14, spd: 0.9, size: 1, color: "#9be7ff" },
};

/** 시작 분대 (기사단 → 기계공방 → 마도회 순으로 해금: 그 분대로 보스를 잡으면 다음) */
export const SQUADS = [
  { id: "knight", name: "기사단 분대", relic: "sq_knight" },
  { id: "mech", name: "기계공방 분대", relic: "sq_mech" },
  { id: "arcane", name: "마도회 분대", relic: "sq_arcane" },
] as const;
export const SQUAD_NEXT: Record<string, string> = { knight: "mech", mech: "arcane" };

/** 원정 유물 (이번 원정에서만) — sq_ 는 분대 시작 유물 (뽑기에 안 나옴) */
export const EXP_RELICS: { id: string; name: string; desc: string; start?: boolean; need?: number }[] = [
  { id: "sq_knight", name: "기사단 나팔", desc: "전투가 시작될 때마다 무료 소환 2", start: true },
  { id: "sq_mech", name: "공방 조준경", desc: "보스 · 엘리트에게 피해 +25%", start: true },
  { id: "sq_arcane", name: "마도회 수정", desc: "전투가 시작될 때마다 가장 낮은 마도회 유닛 칸이 한 등급 올라요", start: true },
  { id: "oath_knight", name: "기사단 서약", desc: "소환이 늘 기사단으로 나와요" },
  { id: "oath_mech", name: "기계공방 서약", desc: "소환이 늘 기계공방으로 나와요" },
  { id: "oath_arcane", name: "마도회 서약", desc: "소환이 늘 마도회로 나와요" },
  { id: "alch", name: "연금 합성", desc: "합성할 때 25% 확률로 두 등급 위 (레전드까지)" },
  { id: "twin", name: "쌍둥이 소환", desc: "소환할 때 20% 확률로 같은 유닛이 하나 더" },
  { id: "growth", name: "성장통", desc: "전투가 끝날 때마다 가장 낮은 등급 유닛 칸이 한 등급 올라요" },
  { id: "piggy", name: "돼지 저금통", desc: "전투가 끝날 때마다 가진 골드의 20% 이자 (최대 120)" },
  { id: "iron", name: "철벽", desc: "남은 적에게 깎이는 원정 체력 절반" },
  { id: "blood", name: "피의 계약", desc: "최대 원정 체력 -10, 모든 유닛 피해 +35%" },
  { id: "bag", name: "전리품 가방", desc: "드래프트에서 4장 중 골라요" },
  { id: "vamp", name: "흡혈 칼날", desc: "남은 적 없이 전투를 끝내면 원정 체력 +3" },
  { id: "goldhand", name: "황금 손", desc: "처치 골드 +1 · 상점 20% 할인" },
  { id: "first", name: "선제 공격", desc: "전투마다 첫 웨이브 동안 모든 피해 ×2" },
  { id: "hunter", name: "엘리트 사냥꾼", desc: "엘리트 · 기믹 적에게 피해 +50% · 유물 고를 때 하나 더" },
  { id: "kit", name: "응급 키트", desc: "원정 체력이 10 밑으로 떨어지면 한 번 +15" },
  // 도감 해금 (원정 유물을 need 종 찾으면 풀에 들어감)
  { id: "echo", name: "메아리", desc: "드래프트에서 고른 유닛이 하나 더 (빈 칸이 있으면)", need: 5 },
  { id: "phoenix", name: "불사조 깃털", desc: "원정 체력이 0이 되면 한 번 절반으로 되살아나요", need: 10 },
  { id: "glass", name: "유리 대포", desc: "모든 유닛 피해 ×1.6 · 남은 적에게 깎이는 원정 체력 두 배", need: 14 },
];
export const EXP_RELIC: Record<string, (typeof EXP_RELICS)[number]> = Object.fromEntries(EXP_RELICS.map((r) => [r.id, r]));

/** 저주 (이벤트 · 원정 단계) */
export const CURSES: Record<string, { name: string; desc: string }> = {
  corrode: { name: "부식", desc: "적 체력 +10%" },
  heavy: { name: "무거운 손", desc: "소환 비용 +5" },
};

/** 상점 물건 */
export type ShopKind = "heal" | "free" | "epic" | "legend" | "relic" | "up" | "uncurse";
export const SHOP: Record<ShopKind, { name: string; desc: string; cost: number }> = {
  heal: { name: "회복약", desc: "원정 체력 +8", cost: 70 },
  free: { name: "소환권 묶음", desc: "무료 소환 3회", cost: 70 },
  epic: { name: "에픽 카드", desc: "무작위 에픽 유닛 1기", cost: 150 },
  legend: { name: "레전드 카드", desc: "무작위 레전드 유닛 1기", cost: 420 },
  relic: { name: "원정 유물", desc: "무작위 원정 유물 하나", cost: 200 },
  up: { name: "세력 훈련", desc: "가장 약한 세력 강화 +2", cost: 100 },
  uncurse: { name: "저주 풀기", desc: "저주 하나를 없애요", cost: 75 },
};

/** ? 칸 이벤트 — 선택지 둘 (a=0 · a=1) */
export type EventId = "vend" | "merc" | "altar" | "spring" | "trap" | "rat";
export const EVENTS: Record<EventId, { name: string; text: string; a: string; b: string }> = {
  vend: { name: "글리치 자판기", text: "지지직… 동전을 넣으면 뭔가 나온대요.", a: "60G 넣기 (에픽 70% · 레전드 30%)", b: "그냥 지나가기" },
  merc: { name: "떠돌이 용병", text: "갈 곳 없는 수호자 둘이 따라오고 싶대요.", a: "레어 유닛 2기 데려가기", b: "대신 100G 받기" },
  altar: { name: "저주받은 제단", text: "검붉은 빛이 원정 유물을 감싸고 있어요.", a: "저주 「부식」 받고 유물 얻기", b: "건드리지 않기" },
  spring: { name: "피의 샘", text: "샘물이 피처럼 붉어요. 마시면 강해질 것 같은데…", a: "원정 체력 -8 → 유닛 칸 둘이 한 등급 업", b: "조금만 마시기 (체력 +6)" },
  trap: { name: "함정!", text: "글리치 무리가 둘러쌌어요!", a: "싸운다 (떼거리 전투 · 보상 두 배)", b: "체력 6 내고 도망" },
  rat: { name: "도박꾼 쥐", text: "「골드 절반 걸고 동전 던지기 한 판?」", a: "건다 (50% 두 배 · 50% 잃음)", b: "사양하기" },
};

/** 원정 단계 비틀기 (그 단계 이상이면 쌓임) */
export const EXP_ASC: { lv: number; name: string; desc: string }[] = [
  { lv: 2, name: "단단한 엘리트", desc: "기믹 엘리트 체력 +30%" },
  { lv: 3, name: "부식된 시작", desc: "저주 「부식」을 안고 시작" },
  { lv: 4, name: "비싼 상점", desc: "상점 값 +20%" },
  { lv: 5, name: "성난 보스", desc: "보스 체력 +25%" },
  { lv: 6, name: "지친 몸", desc: "최대 원정 체력 -6" },
  { lv: 7, name: "엘리트 소굴", desc: "지도에 엘리트가 더 많아요" },
  { lv: 8, name: "새는 방벽", desc: "남은 적 피해 ×1.5" },
  { lv: 9, name: "짧은 휴식", desc: "휴식 회복 절반" },
];
export const ascOn = (town: number, lv: number) => town >= lv;

/** 길 칸(0..25) 이름 · 동네 색 · 마블 랜드마크 그림 번호 (public/defense/town/lm/town-<n>.webp — 빌딩 단계 그림) */
export interface TownTile {
  name: string;
  color: string;
  /** 마블 칸 번호 (랜드마크 그림이 있으면) */
  lm?: number;
  /** 모서리 특수 칸 그림 (public/defense/town/deco/sp-*.webp) */
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
