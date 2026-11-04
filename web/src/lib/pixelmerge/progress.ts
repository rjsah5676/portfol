import { kstDay } from "./engine";

/*
 * 픽셀 머지 — 이 브라우저의 기록 (localStorage "pixelmerge:v1")
 *  - 날짜마다 오늘의 판 최고 점수 · 판 수, 무한 모드 최고 점수, 지금까지 만든 가장 큰 단계(진화표 ? 풀기)
 */

export interface DayRec {
  best: number;
  plays: number;
}
export interface Store {
  days: Record<string, DayRec>;
  endless: number;
  /** 지금까지 만들어 본 가장 큰 단계 (0부터) */
  maxTier: number;
  /** 비회원이 랭킹에 적은 이름 */
  name?: string;
}

const KEY = "pixelmerge:v1";
const EVT = "pixelmerge:store";
const empty = (): Store => ({ days: {}, endless: 0, maxTier: 4 });

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

/** 판이 끝났을 때 — 최고 점수면 true */
export function recordPlay(
  mode: "daily" | "endless",
  day: string,
  score: number,
  maxTier: number
): boolean {
  let best = false;
  saveStore((s) => {
    s.maxTier = Math.max(s.maxTier, maxTier);
    if (mode === "daily") {
      const d = (s.days[day] ??= { best: 0, plays: 0 });
      d.plays++;
      if (score > d.best) {
        d.best = score;
        best = true;
      }
    } else if (score > s.endless) {
      s.endless = score;
      best = true;
    }
  });
  return best;
}
export function seeTier(t: number) {
  if (t > loadStore().maxTier) saveStore((s) => (s.maxTier = t));
}

/** 오늘(또는 어제)까지 하루도 안 빠지고 오늘의 판을 한 날 수 */
export function liveStreak(s: Store): number {
  const played = (d: string) => (s.days[d]?.plays ?? 0) > 0;
  let t = Date.now();
  if (!played(kstDay(t))) t -= 864e5;
  let n = 0;
  while (played(kstDay(t))) {
    n++;
    t -= 864e5;
  }
  return n;
}
