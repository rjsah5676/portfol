/*
 * 픽셀 머지 — 게임 규칙 숫자 (화면 · 서버가 같이 씀)
 *  공을 떨어뜨려 같은 단계끼리 닿으면 다음 단계로 합쳐짐. 11단계 (도트 → … → 트로피), 트로피 둘은 사라지며 보너스.
 *  오늘의 판 = 날짜 시드로 모두 같은 순서의 공 · 날마다 랭킹 (하루 중 가장 높은 점수)
 *  무한 모드 = 랜덤 순서 · 전체 랭킹 (가장 높은 점수)
 */

export type SkillId =
  "bubble" | "fire" | "wind" | "zap" | "whip" | "encore" | "quake" | "pause" | "trophy";
export interface Tier {
  key: string;
  name: string;
  /** 반지름 (게임 좌표, 병 폭 400) */
  r: number;
  /** 이 단계가 만들어질 때 터지는 기술 */
  skill?: SkillId;
  sk?: string;
  /** 그림이 안 왔을 때 칠할 색 */
  col: string;
}
export const TIERS: Tier[] = [
  { key: "dot", name: "도트", r: 13, col: "#b9a7ff" },
  { key: "gp", name: "GP", r: 18, col: "#ffbf2e" },
  { key: "lily", name: "릴리", r: 24, col: "#7fd3ff", skill: "bubble", sk: "비눗방울!" },
  { key: "igna", name: "이그나", r: 30, col: "#ef3b3b", skill: "fire", sk: "화염구!" },
  { key: "kai", name: "카이", r: 37, col: "#3b4a8a", skill: "wind", sk: "질풍!" },
  { key: "zena", name: "제나", r: 45, col: "#ffd34a", skill: "zap", sk: "뇌섬일창!" },
  { key: "soyoung", name: "소영", r: 53, col: "#5a3340", skill: "whip", sk: "낚아채기!" },
  { key: "forte", name: "포르테", r: 62, col: "#f7a8c8", skill: "encore", sk: "앙코르!" },
  { key: "ivan", name: "이반", r: 72, col: "#c0503a", skill: "quake", sk: "곰 포옹!" },
  { key: "gunmo", name: "건모", r: 84, col: "#27305a", skill: "pause", sk: "Alt+Tab!" },
  { key: "trophy", name: "트로피", r: 98, col: "#ffcf4a", skill: "trophy", sk: "우승!" },
];
export const LAST = TIERS.length - 1;
/** 떨어뜨리는 공은 앞 5단계에서만 */
export const DROP_TIERS = 5;
/** 병 크기 (게임 좌표) */
export const W = 400;
export const H = 640;
export const WALL = 14;
export const TOP_Y = 52;
export const LINE_Y = 118;
/** 한 번 떨어뜨린 뒤 다음 공까지 (ms) */
export const DROP_COOLDOWN = 420;
/** 선 위에 이만큼 머물면 끝 (ms) */
export const OVER_MS = 2000;
/** 연쇄로 치는 간격 (ms) · 연쇄 한 번마다 +25% */
export const COMBO_MS = 1100;
export const TROPHY_BONUS = 100;

/** t 단계가 만들어질 때 점수 (0부터) */
export const pts = (t: number) => ((t + 1) * (t + 2)) / 2;

export type Mode = "daily" | "endless";
/** 오늘의 판을 처음 끝낸 회원에게 (하루 한 번) */
export const DAILY_GP = 300;
export const FIRST_DAY = "20261104";

/** 한국 시각 날짜 YYYYMMDD (offset = 며칠 뒤) */
export function kstDay(t = Date.now(), offset = 0): string {
  const d = new Date(t + 9 * 3600e3 + offset * 864e5);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
export const dayLabel = (d: string) => `${+d.slice(4, 6)}월 ${+d.slice(6, 8)}일`;
export const DAY_RE = /^\d{8}$/;
/** 오늘의 판 번호 (#1 = 첫날) */
export function dayNo(d: string): number {
  const ms = (x: string) => Date.UTC(+x.slice(0, 4), +x.slice(4, 6) - 1, +x.slice(6, 8));
  return Math.round((ms(d) - ms(FIRST_DAY)) / 864e5) + 1;
}
export function shiftDay(d: string, n: number): string {
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) + n * 864e5);
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function mulberry(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const daySeed = (d: string) => (+d * 7919) >>> 0;

/**
 * 서버가 받는 기록이 말이 되는지 (물리는 서버에서 못 돌려서 넉넉한 상한만).
 *  - 떨어뜨린 공 수 ≤ 걸린 시간 / 0.35초
 *  - 점수 ≤ 공 하나에 80점 + 300 (실제 판은 공 하나에 25~35점)
 */
export function plausible(d: { score: number; drops: number; time: number }): boolean {
  return d.drops <= d.time / 0.35 + 3 && d.score <= d.drops * 80 + 300;
}
