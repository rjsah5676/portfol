/**
 * 랭크전 등급 (레이팅 구간). 브론즈 ~ 다이아는 구간을 셋으로 나눠 III · II · I, 마스터부터는 하나.
 * 처음 1000점 = 실버 II. 배치(처음 10판) 중엔 "배치 중"으로만 보여 줌.
 * 그림: public/fight/tier/<id>.webp (TIER_ICONS 가 true 일 때 씀, 아직 없으면 코드로 그린 문장)
 */
export interface Tier {
  id: string;
  name: string;
  /** 이 점수부터 */
  min: number;
  color: string;
  /** III · II · I 로 나누나 */
  div: boolean;
}

export const TIERS: Tier[] = [
  { id: "bronze", name: "브론즈", min: 0, color: "#C9814B", div: true },
  { id: "silver", name: "실버", min: 900, color: "#C3CCD8", div: true },
  { id: "gold", name: "골드", min: 1100, color: "#F5C542", div: true },
  { id: "platinum", name: "플래티넘", min: 1300, color: "#43D6C8", div: true },
  { id: "diamond", name: "다이아몬드", min: 1550, color: "#6FA8FF", div: true },
  { id: "master", name: "마스터", min: 1800, color: "#B46CFF", div: false },
  { id: "grandmaster", name: "그랜드마스터", min: 2100, color: "#FF5C6C", div: false },
  { id: "legend", name: "레전드", min: 2400, color: "#FFD86B", div: false },
];

/** 등급 그림 파일이 있나 (public/fight/tier/*.webp) */
export const TIER_ICONS = true;

/** 배치 판 수 (서버 fightRating.ts RATING_PLACEMENT 와 같게) */
export const TIER_PLACEMENT = 10;

export interface TierInfo {
  tier: Tier;
  /** 0 = III, 1 = II, 2 = I (나누지 않는 등급은 -1) */
  div: number;
  /** "골드 II" */
  label: string;
  /** 다음 단계까지 진행 0~1, 다음 단계 시작 점수 (맨 위면 null) */
  progress: number;
  next: number | null;
  nextLabel: string | null;
  /** 배치 중 */
  placing: boolean;
}

const ROMAN = ["III", "II", "I"];

/** 레이팅 r (n = 판 수) 의 등급 */
export function rankTierOf(r: number, n = TIER_PLACEMENT): TierInfo {
  let i = 0;
  while (i < TIERS.length - 1 && r >= TIERS[i + 1].min) i++;
  const t = TIERS[i];
  const top = TIERS[i + 1]?.min ?? null;
  let div = -1,
    lo = t.min,
    hi = top;
  if (t.div && top !== null) {
    const step = (top - t.min) / 3;
    div = Math.min(2, Math.floor((r - t.min) / step));
    lo = Math.round(t.min + step * div);
    hi = div < 2 ? Math.round(t.min + step * (div + 1)) : top;
  }
  const label = div >= 0 ? `${t.name} ${ROMAN[div]}` : t.name;
  const nextLabel =
    hi === null ? null : div >= 0 && div < 2 ? `${t.name} ${ROMAN[div + 1]}` : (() => {
      const nt = TIERS[i + 1];
      return nt.div ? `${nt.name} III` : nt.name;
    })();
  return {
    tier: t,
    div,
    label,
    progress: hi === null ? 1 : Math.max(0, Math.min(1, (r - lo) / (hi - lo))),
    next: hi,
    nextLabel,
    placing: n < TIER_PLACEMENT,
  };
}
