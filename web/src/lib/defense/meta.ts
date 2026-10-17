/**
 * 판 운영 요소 — 패치(원랜디 항법) · 미션(원랜디 스토리 · 나랜디 히든 미션 같은 1회 보상).
 * 판정 · 보상 적용은 sim.ts, 여기는 정의만.
 */
import { TUNE } from "./balance";

export interface PatchDef {
  id: string;
  name: string;
  desc: string;
  /** 원정 보스(fighter id)를 처음 잡아야 열림 (Loadout.patches) */
  lock?: string;
}

/** 패치 = 시작 치트 코드: 판을 시작할 때 4개 중 하나 (sim.ts newBoard 가 b.cheat 로 띄움, 멀티는 시간이 지나면 연합) — 한 번 고르면 못 바꿈 */
export const PATCHES: PatchDef[] = [
  { id: "union", name: "연합 프로토콜", desc: "레전드 이상을 얻을 때마다 무료 소환 2회" },
  {
    id: "gambler",
    name: "도박사 패치",
    desc: `고르면 행운석 +3 · 도박 성공률 +${Math.round(TUNE.gamblerP * 100)}%p · 레전드 도박이 실패하면 행운석 1개 돌려받음 · 보스를 잡으면 행운석 +1`,
  },
  {
    id: "pure",
    name: "순혈 프로토콜",
    desc: `필드에서 가장 많은 세력이 ${Math.round(TUNE.pureFrom * 100)}% 이상이면 켜져서 그 세력이 세져요 (밑이면 꺼짐) — ${Math.round(TUNE.pureFrom * 100)}%에서 절반, 100%면 피해 ×${TUNE.pureDmg} · 강화 비용 -${Math.round((1 - TUNE.pureUp) * 100)}% (히든도 비율에 셈 · 보관함은 안 셈)`,
  },
  {
    id: "interest",
    name: "이자 프로토콜",
    desc: `웨이브 골드 +${Math.round((TUNE.interestWave - 1) * 100)}% · 웨이브를 넘길 때마다 가진 골드의 ${Math.round(TUNE.interestPct * 100)}% 이자 (최대 ${TUNE.interestMax})`,
  },
  // 글리치 원정 보스 처치로 해금
  { id: "dice", name: "주사위 프로토콜", desc: "웨이브가 시작될 때마다 주사위 — 눈 × 6 골드, 6이 나오면 무료 소환 2", lock: "ur-dice" },
  { id: "greed", name: "탐욕 계약", desc: "처치 골드 ×2 · 웨이브 골드 절반", lock: "ur-moa" },
  { id: "split", name: "분열 프로토콜", desc: "합성할 때 25% 확률로 같은 결과 유닛이 하나 더 (빈 칸이 있으면)", lock: "ur-forte" },
];
/** 이 판에서 고를 수 있는 시작 치트 (잠긴 건 해금한 것만) */
export const patchesFor = (open: readonly string[]) => PATCHES.filter((p) => !p.lock || open.includes(p.id)).map((p) => p.id);
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
