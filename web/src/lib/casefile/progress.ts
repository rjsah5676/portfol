import { kstDay, type TierId } from "./engine";

/*
 * 오늘의 사건 파일 — 이 브라우저의 기록 (localStorage "casefile:v1")
 *  - 날짜 · 난이도별 판 상태 (동선표 · 물건 · 메모 · 오답 · 시간) → 새로고침해도 이어서
 *  - 해결 수 · 난이도별 최고 기록 · 연속 해결
 */

export type Truth = "?" | "참" | "거짓";
export interface Play {
  /** cell[t][p] = 내가 정한 방 (-1 = 비움) */
  cell: number[][];
  /** it[p] = 내가 정한 물건 (-1 = 비움) */
  it: number[];
  truth: Truth[];
  /** 「확인」 누른 단서 번호 */
  seen: number[];
  wrong: number;
  /** 걸린 시간 (ms) */
  ms: number;
  /** 마지막 저장 시각 — 오늘의 사건은 창을 닫아 둔 시간도 셈 */
  at?: number;
  done: boolean;
  /** 해결했을 때 기록 (초) */
  score?: number;
}
export interface Store {
  days: Record<string, Partial<Record<TierId, Play>>>;
  solved: number;
  best: Partial<Record<TierId, number>>;
}

const KEY = "casefile:v1";
const EVT = "casefile:store";
const empty = (): Store => ({ days: {}, solved: 0, best: {} });

export function loadStore(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null") as Store | null;
    return s && typeof s === "object" && s.days ? { ...empty(), ...s } : empty();
  } catch {
    return empty();
  }
}
export function saveStore(fn: (s: Store) => void) {
  const s = loadStore();
  fn(s);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
  window.dispatchEvent(new Event(EVT));
}
export function onStoreChange(fn: () => void) {
  const st = (e: StorageEvent) => e.key === KEY && fn();
  window.addEventListener(EVT, fn);
  window.addEventListener("storage", st);
  return () => {
    window.removeEventListener(EVT, fn);
    window.removeEventListener("storage", st);
  };
}

export const getPlay = (day: string, tier: TierId) => loadStore().days[day]?.[tier];
export function setPlay(day: string, tier: TierId, p: Play) {
  saveStore((s) => {
    (s.days[day] ??= {})[tier] = p;
  });
}
export function markSolved(tier: TierId, score: number) {
  saveStore((s) => {
    s.solved++;
    if (s.best[tier] === undefined || score < s.best[tier]!) s.best[tier] = score;
  });
}

/** 오늘(또는 어제)까지 하루도 안 빠지고 한 건 이상 푼 날 수 */
export function liveStreak(s: Store): number {
  const solvedOn = (d: string) => Object.values(s.days[d] ?? {}).some((p) => p?.done);
  let t = Date.now();
  if (!solvedOn(kstDay(t))) t -= 864e5;
  let n = 0;
  while (solvedOn(kstDay(t))) {
    n++;
    t -= 864e5;
  }
  return n;
}
