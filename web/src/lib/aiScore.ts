/**
 * AI 랭킹 모드 점수 (이겼을 때만).
 * 순위는 무조건 "더 센 상대를 이긴 사람"이 위 — 저장 점수 = 상대 단계 × 1,000,000 + 판 점수.
 * 판 점수 = 1000 × 기물 우세 × 적은 수 × 짧은 시간 (같은 상대끼리 비교용, 최대 6천 남짓)
 */
export interface ScorePart {
  label: string;
  detail: string;
  factor: number;
}

export interface ScoreResult {
  /** 저장·정렬용 (단계 포함) */
  score: number;
  /** 화면에 보여 주는 판 점수 */
  points: number;
  base: number;
  parts: ScorePart[];
}

export const TIER = 1_000_000;
const BASE = 1000;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
export const clockLabel = mmss;

/** 저장 점수에서 판 점수만 */
export const pointsOf = (score: number) => score % TIER;

function combine(tier: number, parts: ScorePart[]): ScoreResult {
  const points = Math.round(parts.reduce((v, p) => v * p.factor, BASE));
  return { score: tier * TIER + points, points, base: BASE, parts };
}

/** 체스: tier = 상대 단계(1~), 기물 우세 40점당 +100%, 60수 이내 빨리 끝낼수록, 10분 이내 빨리 둘수록 */
export function chessScore(tier: number, lead: number, moves: number, seconds: number) {
  return combine(tier, [
    { label: "기물 우세", detail: `+${Math.max(0, lead)}`, factor: 1 + Math.max(0, lead) / 40 },
    { label: "내 수", detail: `${moves}수`, factor: 1 + Math.max(0, 60 - moves) / 60 },
    { label: "사용 시간", detail: mmss(seconds), factor: 1 + Math.max(0, 600 - seconds) / 1200 },
  ]);
}

/** 장기: 점수 우세 60점당 +100%, 80수 이내, 15분 이내, 외통이 아닌 판정승은 ×0.6 */
export function janggiScore(
  tier: number,
  lead: number,
  moves: number,
  seconds: number,
  checkmate: boolean
) {
  const parts: ScorePart[] = [
    { label: "점수 우세", detail: `+${Math.max(0, lead)}`, factor: 1 + Math.max(0, lead) / 60 },
    { label: "내 수", detail: `${moves}수`, factor: 1 + Math.max(0, 80 - moves) / 80 },
    { label: "사용 시간", detail: mmss(seconds), factor: 1 + Math.max(0, 900 - seconds) / 1800 },
  ];
  if (!checkmate) parts.push({ label: "판정승", detail: "외통 아님", factor: 0.6 });
  return combine(tier, parts);
}

/** 오목: 적은 수(25수 이내일수록), 짧은 시간(10분 이내일수록), 백으로 이기면 ×1.2 (흑이 선수라 유리) */
export function omokScore(tier: number, moves: number, seconds: number, asWhite: boolean) {
  const parts: ScorePart[] = [
    { label: "내 수", detail: `${moves}수`, factor: 1 + Math.max(0, 25 - moves) / 25 },
    { label: "사용 시간", detail: mmss(seconds), factor: 1 + Math.max(0, 600 - seconds) / 1200 },
  ];
  if (asWhite) parts.push({ label: "백으로 승리", detail: "후수", factor: 1.2 });
  return combine(tier, parts);
}

/** 격투: tier = AI 단계(1~6), 남은 체력이 많을수록, 3분 안에 빨리 끝낼수록 */
export function fightScore(tier: number, hpPct: number, seconds: number) {
  return combine(tier, [
    { label: "남은 체력", detail: `${hpPct}%`, factor: 1 + Math.max(0, hpPct) / 100 },
    { label: "경기 시간", detail: mmss(seconds), factor: 1 + Math.max(0, 180 - seconds) / 360 },
  ]);
}
