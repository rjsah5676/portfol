import { api } from "@/lib/api/http";
import { beginRun, signIn, submitRun } from "@/lib/api/rankRun";
import { withCaptcha } from "@/lib/captcha";
import { toDate } from "@/lib/rankDate";
import type { DailyCheck, DailyPuzzle } from "@/lib/hangul/daily";
import type { Judge } from "@/lib/hangul/judge";

/*
 * 니들이 한글을 알아? 「오늘의 자모」 — 문제 · 확인 · 힌트 · 판정 · 랭킹 (서버: http/hangul.ts · http/rankings.ts)
 *  GET  /api/hangul/daily/:pz              오늘 문제 (자모 조각)
 *  POST /api/hangul/daily/:pz/check        내 문장 확인 → 정답 · 별해 · 아님
 *  POST /api/hangul/daily/:pz/hint {n}     힌트 (로그인 — 본 단계가 남음)
 *  POST /api/hangul/daily/:pz/giveup       포기 → 정답
 *  GET  /api/hangul/judge?t=               지금 쓰는 줄 판정 (훈장님 반응)
 *  GET  /api/rankings/hangul/:pz?sort=     기록순 · 별해 자랑(fun) · 별해 최신(new)
 *  POST /api/rankings/hangul/:pz           { name, time, hint, score, text, secret?, ticket }
 */

const boardOf = (pz: string) => `hangul:${pz}`;
const rankPath = (pz: string) => `/api/rankings/hangul/${pz}`;

export const getDaily = (pz: string) => api<DailyPuzzle>(`/api/hangul/daily/${pz}`);
export const checkDaily = (pz: string, text: string) =>
  api<DailyCheck>(`/api/hangul/daily/${pz}/check`, {
    method: "POST",
    body: { text },
    timeoutMs: 15_000,
  });
export async function hintDaily(pz: string, n: number): Promise<number[] | string> {
  await signIn();
  const r = await api<{ n: number; value: number[] | string }>(`/api/hangul/daily/${pz}/hint`, {
    method: "POST",
    auth: true,
    body: { n },
  });
  return r.value;
}
export async function giveUpDaily(pz: string): Promise<string> {
  await signIn();
  const r = await api<{ answer: string }>(`/api/hangul/daily/${pz}/giveup`, {
    method: "POST",
    auth: true,
  });
  return r.answer;
}

const cache = new Map<string, Promise<Judge>>();
/** 같은 글자 줄은 한 번만 물어봄 */
export function judgeLine(text: string): Promise<Judge> {
  let p = cache.get(text);
  if (!p) {
    p = api<Judge>(`/api/hangul/judge?t=${encodeURIComponent(text)}`, { timeoutMs: 15_000 });
    p.catch(() => cache.delete(text));
    cache.set(text, p);
  }
  return p;
}

export interface DailyRanking {
  id: string;
  name: string;
  member: boolean;
  avatar: string | null;
  time: number;
  hint: number;
  score: number;
  /** 쓴 그대로 · 띄어쓰기를 고친 모양 */
  text: string;
  spaced?: string;
  kind?: "정답" | "별해";
  secret?: boolean;
  likes?: number;
  createdAt: Date | null;
}
export type DailySort = "top" | "fun" | "new";
/** top = 기록순, fun = 별해 자랑(👍 많은 순), new = 별해 최신순 */
export async function getDailyRanking(pz: string, sort: DailySort = "top", limit = 50) {
  const rows = await api<(Omit<DailyRanking, "createdAt"> & { createdAt: number | null })[]>(
    `${rankPath(pz)}?limit=${limit}${sort === "top" ? "" : `&sort=${sort}`}`
  );
  return rows.map((r) => ({
    ...r,
    member: !!r.member,
    avatar: r.avatar ?? null,
    createdAt: toDate(r.createdAt),
  }));
}

/** 퍼즐을 처음 열 때 (랭킹 티켓) — 이어 풀 때는 부르지 않음 (티켓이 지워짐) */
export const beginDaily = (pz: string) => beginRun(boardOf(pz));
export const submitDaily = (
  pz: string,
  rec: { name: string; time: number; hint: number; score: number; text: string; secret?: boolean }
) => submitRun(boardOf(pz), rankPath(pz), rec);

/** 👍 누르기 · 취소 → 지금 👍 수 (내 문장엔 못 누름 — 서버가 400) */
export async function likeDaily(id: string, on: boolean): Promise<number> {
  await signIn();
  const r = await withCaptcha((headers) =>
    api<{ likes: number }>(`/api/rankings/hangul_daily/${encodeURIComponent(id)}/like`, {
      method: "POST",
      auth: true,
      headers,
      body: { on },
    })
  );
  return r.likes;
}
export async function likedDaily(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  await signIn();
  return new Set(
    await api<string[]>(
      `/api/rankings/hangul_daily/liked?ids=${ids.map(encodeURIComponent).join(",")}`,
      { auth: true }
    )
  );
}
/** "이거 말 되는데?" — 판정기 사전에 없는 말 신고 */
export const reportHangul = (text: string) =>
  api<{ ok: true }>("/api/hangul/report", { method: "POST", body: { text } });
