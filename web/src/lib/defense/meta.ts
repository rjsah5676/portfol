/**
 * 판 운영 요소 — 패치(원랜디 항법) · 미션(원랜디 스토리 · 나랜디 히든 미션 같은 1회 보상).
 * 판정 · 보상 적용은 sim.ts, 여기는 정의만.
 */

export interface PatchDef {
  id: string;
  name: string;
  desc: string;
}

/** 패치: 10웨이브 전까지 하나 고름 (안 고르면 10웨이브에 연합 프로토콜) — 한 번 고르면 못 바꿈 */
export const PATCHES: PatchDef[] = [
  { id: "union", name: "연합 프로토콜", desc: "레전드 이상을 얻을 때마다 무료 소환 2회" },
  {
    id: "gambler",
    name: "도박사 패치",
    desc: "행운석 도박 성공률 +8%p · 실패하면 행운석 1개 돌려받음",
  },
  {
    id: "core",
    name: "단일 코어",
    desc: "신화 · 히든은 1개만 만들 수 있지만, 모든 피해 +15% · 적 이동 속도 -8%",
  },
  {
    id: "interest",
    name: "이자 프로토콜",
    desc: "웨이브를 넘길 때마다 가진 골드의 6% 이자 (최대 40)",
  },
];
export const PATCH_DEADLINE = 10;

export interface MissionDef {
  id: string;
  name: string;
  desc: string;
  gold?: number;
  stones?: number;
}

/** 미션: 조건을 채우면 그 자리에서 1번 보상 (판정은 sim.ts checkMissions) */
export const MISSIONS: MissionDef[] = [
  { id: "rare", name: "첫 레어", desc: "레어 유닛 얻기", gold: 30 },
  { id: "trio", name: "삼총사", desc: "한 세력의 노말 3종을 모두 갖기", stones: 1 },
  { id: "epic", name: "첫 에픽", desc: "에픽 유닛 얻기", gold: 50 },
  { id: "army", name: "대군단", desc: "유닛 25기 이상", gold: 50, stones: 1 },
  { id: "legend", name: "전설의 시작", desc: "레전드 유닛 얻기", stones: 2 },
  { id: "seller", name: "중고 거래", desc: "유닛 10번 판매", gold: 60 },
  { id: "allEpic", name: "삼파전", desc: "세 세력 모두 에픽 이상 갖기", stones: 3 },
  { id: "unlucky", name: "위로금", desc: "행운석 도박 3번 연속 실패", stones: 2 },
  { id: "myth", name: "신화 강림", desc: "신화 유닛 만들기", gold: 100, stones: 3 },
  { id: "hidden", name: "버그 발견", desc: "히든 유닛 만들기", stones: 5 },
  { id: "rift", name: "균열 사냥꾼", desc: "글리치 균열 5번 닫기", stones: 3 },
];
