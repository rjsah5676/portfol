"use client";

/*
 * 오늘의 용의자 — 내 진행 · 기록 (이 브라우저의 localStorage).
 *  - 오늘의 사건은 난이도마다 판 상태를 저장 → 새로고침 · 다른 화면 갔다 와도 이어서
 *  - 연속 해결(스트릭): 하루에 랭킹 난이도 하나라도 풀면 그날은 해결한 날
 *  - 일주일 지난 날의 판 상태는 지움
 */

import { kstDay, type TierId } from "./engine";

const KEY = "suspect:v1";

export interface PlayState {
  /** 사람마다 -1 모름 · 0 무고 · 1 범인 */
  x: number[];
  /** 메모 (0 없음 · 1 범인? · 2 무고?) */
  memo: number[];
  miss: number;
  hint: number;
  /** 실수한 사람 (공유 격자에 노란 칸) */
  missed: number[];
  /** 실제로 들여다본 시간 (탭을 내려 두면 멈춤) */
  ms: number;
  done: boolean;
  /** 랭킹에 올렸는지 (오늘의 사건은 첫 기록만) */
  submitted?: boolean;
  score?: number;
}

export interface Store {
  /** 입문 튜토리얼을 끝냈는지 */
  tutorial: boolean;
  /** 비회원이 랭킹에 적은 이름 (다음에 미리 채움) */
  name?: string;
  days: Record<string, Partial<Record<TierId, PlayState>>>;
  streak: { last: string | null; count: number; best: number };
  /** 지금까지 해결한 오늘의 사건 수 */
  solved: number;
  /** 난이도별 가장 좋은 점수 */
  best: Partial<Record<TierId, number>>;
}

const empty = (): Store => ({
  tutorial: false,
  days: {},
  streak: { last: null, count: 0, best: 0 },
  solved: 0,
  best: {},
});

let cache: Store | null = null;
const listeners = new Set<() => void>();

export function loadStore(): Store {
  if (cache) return cache;
  let s = empty();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) s = { ...s, ...(JSON.parse(raw) as Partial<Store>) };
  } catch {}
  // 일주일 지난 날의 판은 지움
  const keep = kstDay(Date.now(), -7);
  for (const d of Object.keys(s.days)) if (d < keep) delete s.days[d];
  cache = s;
  return s;
}

export function saveStore(patch?: (s: Store) => void) {
  const s = loadStore();
  patch?.(s);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
  for (const l of listeners) l();
}

export function onStoreChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const getPlay = (day: string, tier: TierId): PlayState | undefined =>
  loadStore().days[day]?.[tier];

export function setPlay(day: string, tier: TierId, p: PlayState) {
  saveStore((s) => {
    (s.days[day] ??= {})[tier] = p;
  });
}

/** 오늘의 사건을 풀었을 때: 해결 수 · 연속 해결 · 최고 점수 */
export function markSolved(day: string, tier: TierId, score: number) {
  saveStore((s) => {
    s.solved++;
    if (s.best[tier] === undefined || score < s.best[tier]) s.best[tier] = score;
    if (s.streak.last !== day) {
      s.streak.count =
        s.streak.last === kstDay(Date.now(), -1) || s.streak.last === prevDay(day)
          ? s.streak.count + 1
          : 1;
      s.streak.last = day;
      s.streak.best = Math.max(s.streak.best, s.streak.count);
    }
  });
}

/** "YYYYMMDD" 하루 전 */
function prevDay(day: string): string {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)) - 864e5;
  const d = new Date(t);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 연속 해결이 오늘까지 이어지고 있는지 (어제 마지막이면 아직 살아 있음) */
export function liveStreak(s: Store): number {
  const today = kstDay();
  return s.streak.last === today || s.streak.last === prevDay(today) ? s.streak.count : 0;
}
