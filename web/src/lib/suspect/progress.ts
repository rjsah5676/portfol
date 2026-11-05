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
  /** 걸린 시간 (멈춤 없음 — 탭을 내려 둬도 흐름) */
  ms: number;
  /** 마지막으로 저장한 시각 (Date.now) — 오늘의 사건은 창을 닫아 둔 동안도 시간에 더함 */
  at?: number;
  done: boolean;
  /** 랭킹에 올렸는지 (오늘의 사건은 첫 기록만) */
  submitted?: boolean;
  score?: number;
}

export interface Store {
  /** 이 브라우저 기록이 언제 기준인지 (관리자 「데일리 초기화」 시각과 비교) */
  resetAt?: number;
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

/**
 * 관리자 초기화 따라가기 (http/suspect.ts · 올인 러브 초기화와 같은 방식). 이 브라우저 기준 시각보다 나중 초기화만:
 *  - day "all" (데일리 초기화 · 랭킹 전체 초기화): 판 진행 · 해결 수 · 연속 해결 · 최고 기록을 전부 지움
 *  - day "YYYYMMDD" (그날 랭킹 초기화): 그날 판 진행만 지움 → 다시 풀어서 올릴 수 있게
 * 튜토리얼을 끝낸 것 · 랭킹 이름은 남김. 기준 시각이 없는 브라우저는 기록이 없으면 지금이 기준.
 * 지웠으면 true (화면은 onStoreChange 로 갱신)
 */
export async function applySuspectReset(): Promise<boolean> {
  const { api } = await import("@/lib/api/http");
  const s = loadStore();
  if (!s.resetAt && !Object.keys(s.days).length && !s.solved) saveStore((x) => void (x.resetAt = Date.now()));
  const r = await api<{ at: number; resets?: { at: number; day: string }[] }>("/api/suspect/reset", {
    timeoutMs: 5000,
  });
  const mine = loadStore().resetAt ?? 0;
  const todo = (r.resets ?? (r.at ? [{ at: r.at, day: "all" }] : [])).filter((x) => x.at > mine);
  if (!todo.length) return false;
  saveStore((x) => {
    for (const t of todo) {
      if (t.day === "all") {
        x.days = {};
        x.streak = { last: null, count: 0, best: 0 };
        x.solved = 0;
        x.best = {};
      } else delete x.days[t.day];
    }
    x.resetAt = Math.max(...todo.map((t) => t.at));
  });
  return true;
}

/**
 * 회원이면 서버에 올라간 내 기록(GET /api/rankings/suspect-mine)으로 이 브라우저 기록을 채움 — 다른 기기에서 푼 것도 보이게.
 *  - 일주일 안의 오늘의 사건: 이 브라우저에서 안 끝낸 판이면 「다 푼 판」으로 (결과 · 다시 보기만, 판 진행은 기기 따라 안 옮김)
 *  - 해결 수 · 난이도별 최고 · 연속 해결: 서버 기록과 이 브라우저 기록 중 큰 쪽 (연속은 푼 날을 합쳐서 다시 셈)
 * 비회원 · 로그아웃이면 서버가 빈 목록 → 그대로. 바뀌었으면 true
 */
export async function syncSuspectMine(): Promise<boolean> {
  const { api } = await import("@/lib/api/http");
  const r = await api<{
    rows: { case: string; time: number; miss: number; hint: number; score: number; at: number | null }[];
  }>("/api/rankings/suspect-mine", { auth: true, timeoutMs: 8000 });
  if (!r.rows.length) return false;
  const keep = kstDay(Date.now(), -7);
  const resetAt = loadStore().resetAt ?? 0;
  let changed = false;
  saveStore((s) => {
    const solvedDays = new Set<string>();
    for (const d of Object.keys(s.days)) if (Object.values(s.days[d]).some((p) => p?.done)) solvedDays.add(d);
    for (const row of r.rows) {
      // 관리자 초기화보다 앞선 기록은 지워졌어야 할 것 (서버도 지우지만 혹시 남은 것)
      if (row.at && row.at < resetAt) continue;
      const [day, tier] = row.case.split("_") as [string, TierId];
      solvedDays.add(day);
      if (s.best[tier] === undefined || row.score < s.best[tier]) {
        s.best[tier] = row.score;
        changed = true;
      }
      if (day < keep || s.days[day]?.[tier]?.done) continue;
      (s.days[day] ??= {})[tier] = {
        x: [],
        memo: [],
        miss: row.miss,
        hint: row.hint,
        missed: [],
        ms: Math.round(row.time * 1000),
        done: true,
        submitted: true,
        score: row.score,
      };
      changed = true;
    }
    if (r.rows.length > s.solved) {
      s.solved = r.rows.length;
      changed = true;
    }
    if (!s.tutorial) {
      s.tutorial = true;
      changed = true;
    }
    // 연속 해결: 푼 날을 합쳐서 가장 최근 날부터 거꾸로 이어진 만큼 · 가장 길었던 것.
    // 이 브라우저 기록이 더 길면(로그인 전에 푼 날 등 서버에 없는 날) 그쪽을 남김
    const days = [...solvedDays].sort();
    let longest = 0;
    for (let i = 0, k = 0; i < days.length; i++) {
      k = i && prevDay(days[i]) === days[i - 1] ? k + 1 : 1;
      longest = Math.max(longest, k);
    }
    const last = days[days.length - 1] ?? null;
    const cur = s.streak;
    // 가장 최근 날부터 거꾸로 — 이 브라우저의 연속 마지막 날에 닿으면 그 연속 수를 이어 붙임
    let run = 0;
    if (last) {
      run = 1;
      for (let d = last; ; ) {
        const p = prevDay(d);
        if (cur.last && p === cur.last) {
          run += cur.count;
          break;
        }
        if (!solvedDays.has(p)) break;
        run++;
        d = p;
      }
      if (last === cur.last) run = Math.max(run, cur.count);
    }
    const newer = !!last && (!cur.last || last > cur.last || (last === cur.last && run > cur.count));
    const best = Math.max(cur.best, longest, newer ? run : cur.count);
    if (newer || best !== cur.best) {
      s.streak = newer ? { last: last!, count: run, best } : { ...cur, best };
      changed = true;
    }
  });
  return changed;
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
