/*
 * 올인 러브 — 관계 단계 · 딜러 실력 (화면에 보이는 성장)
 * 수치(affA · affY · skill · tilt)는 대본 eff 로만 바뀌고, 화면엔 단계 이름 + 하트 · 별로만 보여 줌
 */
import type { Vars } from "./types";

export type Heroine = "amy" | "yeonseo";
export const AFF: Record<Heroine, string> = { amy: "affA", yeonseo: "affY" };

/**
 * 호감 단계 경계 (0 ~ 5단계) — 히로인마다 대본 수치 크기가 달라 따로 잡음.
 * 한 사람만 챙길 때 ♥1 3일 · ♥2 5일 · ♥3 9~10일 · ♥4 2주차 끝~16일 무렵,
 * ♥5 는 수치만으로는 안 열림: 그 히로인 루트(routeA/routeY)에 들어가 4주차(22일~)가 돼야 함.
 */
export const STAGE_AT: Record<Heroine, readonly number[]> = {
  amy: [0, 5, 16, 32, 50, 70],
  yeonseo: [0, 4, 10, 20, 30, 40],
};
const ROUTE: Record<Heroine, string> = { amy: "routeA", yeonseo: "routeY" };
export const stageOf = (aff: number, who: Heroine = "amy"): number =>
  Math.max(0, STAGE_AT[who].filter((x) => aff >= x).length - 1);
export const heroStage = (v: Vars, who: Heroine): number => {
  const st = stageOf(v[AFF[who]] ?? 0, who);
  const open = (v[ROUTE[who]] ?? 0) >= 1 && (v.dayNo ?? 0) >= 22;
  return st >= 5 && !open ? 4 : st;
};

export const STAGE_NAME: Record<Heroine, readonly string[]> = {
  amy: ["시끄러운 손님", "단골 손님", "편의점 친구", "신경 쓰이는 애", "내 편", "특별한 사람"],
  yeonseo: ["구석 자리 손님", "말을 거는 손님", "비밀을 아는 사이", "신경 쓰이는 사람", "기대는 사람", "특별한 사람"],
};
/** 단계별 지금 그녀의 마음 (관계 화면 한 줄) */
export const STAGE_LINE: Record<Heroine, readonly string[]> = {
  amy: [
    "딜러 얼굴보다 칩을 더 본다.",
    "테이블에 오면 일단 딜러부터 찾는다.",
    "편의점 계산대 너머로 먼저 말을 건다.",
    "이긴 날도 진 날도 제일 먼저 너한테 말하고 싶다.",
    "무서운 얘기도 너한테는 꺼낼 수 있다.",
    "4주 전엔 몰랐던 얼굴로 웃는다.",
  ],
  yeonseo: [
    "딜러를 본다. 정확히는, 딜러의 손을.",
    "짧은 존댓말이 하루에 한 번씩 늘어난다.",
    "가게 사람들은 모르는 얼굴을 너한테만 보여 준다.",
    "구석 자리에서 시선이 자꾸 딜러 쪽으로 온다.",
    "장갑 낀 손이 네 소매를 먼저 잡는다.",
    "7년 만에, 소리 내서 웃는다.",
  ],
};

/** 딜러 실력 (셔플 연습 · 근무로 오름) */
export const SKILL_AT = [0, 2, 4, 7, 10] as const;
export const skillOf = (v: Vars): number => Math.max(0, SKILL_AT.filter((x) => (v.skill ?? 0) >= x).length - 1);
export const SKILL_NAME = ["녹슨 손", "굳은 손", "풀린 손", "예전의 손", "전설의 손"] as const;
/**
 * 딜러 실력 = 읽기 포커 능력치. 셔플 · 복기 카드로 오름
 * 매치: 버릇 정확도 +SKILL_ACC · 숨긴 버릇이 보일 확률 +SKILL_SHOW / 3단계(예전의 손)부터 고급 한마디 · 결전 단서 조합 첫 실수 보험
 */
export const SKILL_ACC = [0, 0.03, 0.06, 0.1, 0.14] as const;
export const SKILL_SHOW = [0, 0, 0.25, 0.4, 0.6] as const;
/** 고급 한마디 · 결전 보험이 열리는 단계 */
export const SKILL_PRO = 3;
export const SKILL_LINE = [
  "아직 손이 굳어 있다. 버릇은 보이는 만큼만.",
  "매치에서 상대 버릇이 조금 더 정확하게 읽힌다.",
  "버릇이 더 정확하게 읽히고, 숨긴 버릇도 가끔 보인다.",
  "매치에 고급 한마디가 생긴다. 결전 단서 조합의 첫 실수는 사장이 못 본다.",
  "숨긴 버릇까지 거의 다 보인다. 고급 한마디 · 결전 보험 그대로.",
] as const;

/** 마음 상태 (틸트) */
export const tiltName = (v: Vars): string => {
  const t = v.tilt ?? 0;
  return t <= 1 ? "차분함" : t <= 3 ? "조금 흔들림" : t <= 5 ? "위태로움" : "테이블이 부른다";
};

/**
 * 방치 감소 — 날이 바뀔 때, 사흘 넘게 호감이 한 번도 안 오른 히로인은 호감 -1 (다시 사흘 뒤에 또 확인)
 * 그 히로인 루트에 들어갔거나 호감이 0 이하면 안 깎음. _dcA · _dcY 는 깎인 횟수 (화면에서 금 간 하트 띄우는 신호)
 */
export const DECAY_GAP = 3;
const DK: Record<Heroine, [string, string, string]> = { amy: ["_lastA", "_pA", "_dcA"], yeonseo: ["_lastY", "_pY", "_dcY"] };
export function dayDecay(v: Vars, day: number): Vars {
  if (!day || v._dd === day) return v;
  const o: Vars = { ...v, _dd: day };
  for (const who of ["amy", "yeonseo"] as Heroine[]) {
    const [L, P, D] = DK[who];
    const k = AFF[who];
    const a = o[k] ?? 0;
    if (o[L] === undefined || a > (o[P] ?? 0)) o[L] = day;
    o[P] = a;
    if ((o[ROUTE_V[who]] ?? 0) >= 1 || a <= 0) continue;
    if (day - o[L] >= DECAY_GAP) {
      o[k] = a - 1;
      o[P] = a - 1;
      o[L] = day;
      o[D] = (o[D] ?? 0) + 1;
    }
  }
  return o;
}
const ROUTE_V: Record<Heroine, string> = { amy: "routeA", yeonseo: "routeY" };
