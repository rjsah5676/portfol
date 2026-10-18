/**
 * 유닛 각인 — 유닛 종류마다 특성 하나 (계정에 저장, 그 유닛이 나올 때마다 붙음).
 * 각인석으로 굴려요(서버 무작위): 등급 일반 · 희귀 · 전설 · 글리치, 천장 ENGR_PITY 번.
 * 중복 처리:
 *  - 각인이 없는 유닛 → 바로 붙음
 *  - 지금과 같은 특성이 나오면 「공명」 → 등급 +1 (글리치면 각인석 ENGR_MAXED 개 돌려받음)
 *  - 다른 특성이 나오면 둘 중 하나를 고름 (버린 쪽 등급만큼 각인석 ENGR_REFUND 돌려받음)
 *  - 다른 유닛끼리 같은 특성은 상관없음 (특성은 그 유닛에만 붙음)
 * 효과는 sim.ts 가 Mods.engr 로 읽음 (결정론 — 확률 효과는 판 난수).
 */
export type EngrId = "blast" | "crit" | "hunter" | "rapid" | "reach" | "coin" | "frost" | "pierce" | "fuse" | "twin" | "reap" | "growth";

export const ENGR_TIER_NAME = ["일반", "희귀", "전설", "글리치"] as const;
export const ENGR_TIER_COLOR = ["#bfb3ff", "#5ff2ff", "#ffd23f", "#ff4fd8"] as const;
/** 등급 확률 (%) */
export const ENGR_ODDS = [62, 27, 9, 2] as const;
/** 이만큼 굴려도 전설 이상이 안 나오면 다음은 전설 이상 확정 */
export const ENGR_PITY = 30;
/** 다른 특성이 나와 하나를 버릴 때 버린 쪽 등급별로 돌려받는 각인석 */
export const ENGR_REFUND = [0, 0, 1, 3] as const;
/** 글리치 등급에 같은 특성이 또 나오면 */
export const ENGR_MAXED = 3;
/** 각인이 열리는 단계 (오염 이 단계 클리어) */
export const ENGR_FROM = 30;

export const ENGRAVES: Record<EngrId, { name: string; val: readonly number[]; desc: (v: number) => string }> = {
  blast: { name: "폭발", val: [30, 50, 75, 110], desc: (v) => `처치하면 주변 적에게 이 유닛 피해의 ${v}%` },
  crit: { name: "치명 리듬", val: [2, 2.5, 3.2, 4.2], desc: (v) => `4번째 공격마다 피해 ×${v}` },
  hunter: { name: "거인 사냥", val: [20, 32, 48, 70], desc: (v) => `보스 · 엘리트 · 균열 적 피해 +${v}%` },
  rapid: { name: "연사", val: [8, 13, 19, 28], desc: (v) => `공격 속도 +${v}%` },
  reach: { name: "매의 눈", val: [0.4, 0.6, 0.9, 1.3], desc: (v) => `사거리 +${v}칸` },
  coin: { name: "황금 손", val: [1, 2, 3, 5], desc: (v) => `이 유닛이 처치하면 골드 +${v}` },
  frost: { name: "서리", val: [10, 16, 24, 35], desc: (v) => `맞은 적 1.5초 동안 ${v}% 느려짐` },
  pierce: { name: "관통", val: [10, 16, 24, 35], desc: (v) => `방어 · 마법 저항을 ${v}% 무시` },
  fuse: { name: "합성 행운", val: [8, 13, 19, 28], desc: (v) => `이 유닛을 합성하면 ${v}% 확률로 한 등급 위 (레전드까지)` },
  twin: { name: "분신", val: [5, 8, 12, 18], desc: (v) => `이 유닛을 얻을 때 ${v}% 확률로 하나 더 (빈 칸이 있으면)` },
  reap: { name: "처형", val: [6, 8, 11, 15], desc: (v) => `체력 ${v}% 이하 일반 적은 바로 쓰러짐 (보스 제외)` },
  growth: { name: "성장형", val: [0.4, 0.6, 0.9, 1.3], desc: (v) => `웨이브마다 피해 +${v}%` },
};
export const ENGR_IDS = Object.keys(ENGRAVES) as EngrId[];

/** 유닛 하나의 각인 { e: 특성, t: 등급 0..3 } */
export interface Engr {
  e: EngrId;
  t: number;
}
export const engrVal = (g: Engr) => ENGRAVES[g.e].val[g.t];
export const engrText = (g: Engr) => `${ENGR_TIER_NAME[g.t]} ${ENGRAVES[g.e].name} — ${ENGRAVES[g.e].desc(engrVal(g))}`;

/** 서버 무작위로 한 번 굴리기 (rnd: 0..1) — pity 는 전설 미만이 연달아 나온 수 */
export function rollEngr(rnd: () => number, pity: number): { g: Engr; pity: number } {
  let t = 0;
  if (pity + 1 >= ENGR_PITY) t = rnd() < (ENGR_ODDS[3] / (ENGR_ODDS[2] + ENGR_ODDS[3])) ? 3 : 2;
  else {
    let r = rnd() * 100;
    for (let k = 0; k < ENGR_ODDS.length; k++) {
      if (r < ENGR_ODDS[k]) {
        t = k;
        break;
      }
      r -= ENGR_ODDS[k];
    }
  }
  const e = ENGR_IDS[Math.min(ENGR_IDS.length - 1, Math.floor(rnd() * ENGR_IDS.length))];
  return { g: { e, t }, pity: t >= 2 ? 0 : pity + 1 };
}

/**
 * 굴린 결과를 지금 각인에 적용하는 규칙 (서버 · 시뮬 공통).
 *  kind "new" 바로 붙음 · "resonate" 공명(등급 +1) · "maxed" 글리치에 같은 특성(각인석 돌려받음) · "choose" 둘 중 고르기
 */
export function engrOutcome(cur: Engr | undefined, got: Engr): { kind: "new" | "resonate" | "maxed" | "choose"; next?: Engr; refund?: number } {
  if (!cur) return { kind: "new", next: got };
  if (cur.e === got.e) {
    if (cur.t >= 3) return { kind: "maxed", refund: ENGR_MAXED };
    return { kind: "resonate", next: { e: cur.e, t: Math.min(3, Math.max(cur.t, got.t) + 1) } };
  }
  return { kind: "choose" };
}

/** 판 결과로 받는 각인석 (오염 ENGR_FROM 클리어 뒤) — 메인: 클리어하면 1 · 원정: 원정 보스 하나당 1 */
export const engrStonesMain = (_wave: number, win: boolean) => (win ? 1 : 0);
export const engrStonesTown = (bossKills: number) => bossKills;
/** 오염 31~50 첫 클리어 보너스 */
export const ENGR_FIRST_CLEAR = 2;
