import { api } from "@/lib/api/http";
import { beginRun, signIn, submitRun } from "@/lib/api/rankRun";
import { withCaptcha } from "@/lib/captcha";
import { toDate } from "@/lib/rankDate";
import type { Judge } from "@/lib/hangul/judge";

/*
 * 니들이 한글을 알아? 판정 · 랭킹
 *  GET  /api/hangul/judge?t=글자들
 *  GET  /api/rankings/hangul_rankings?limit=50
 *  POST /api/rankings/hangul_rankings  { name, score, wave, best, bestPts, ticket }
 * 대표글(best)은 서버가 다시 판정해서 문장이 맞는지 · 점수가 맞는지 확인 — server/src/http/rankings.ts
 */

const BOARD = "hangul_rankings";
const PATH = `/api/rankings/${BOARD}`;

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

/** 뭐 되지? — 문장칸 뒤에 units 를 add 순서대로 붙이면 문장 · 낱말이 되는 것들 (server/src/hangul/kiwi.ts) */
export interface Suggestion {
  add: number[];
  text: string;
  sentence: boolean;
  word: string | null;
  points: number;
  /** 고유명사 (자동 낱말 만들기는 건너뜀) */
  rare?: boolean;
}
export const suggestLine = (line: string, units: string[]) =>
  api<Suggestion[]>(
    `/api/hangul/suggest?line=${encodeURIComponent(line)}&u=${encodeURIComponent(units.join(","))}`,
    { timeoutMs: 20_000 }
  );

export interface HangulRanking {
  id: string;
  name: string;
  member: boolean;
  avatar: string | null;
  score: number;
  wave: number;
  /** 대표글: 원고지에 쓴 그대로 · 서버가 띄어쓰기를 고친 모양 */
  best: string;
  bestSpaced?: string;
  bestPts: number;
  /** 시크릿(익명)으로 올린 기록 */
  secret?: boolean;
  /** 👍 웃겨요 수 */
  likes?: number;
  createdAt: Date | null;
}

export type HangulSort = "top" | "fun" | "new";
/** sort: top = 점수순, fun = 웃긴순(👍 많은 순), new = 최신순 (판마다 따로 쌓이는 랭킹) */
export async function getHangulRanking(
  limit = 30,
  sort: HangulSort = "top"
): Promise<HangulRanking[]> {
  const rows = await api<(Omit<HangulRanking, "createdAt"> & { createdAt: number | null })[]>(
    `${PATH}?limit=${limit}${sort === "top" ? "" : `&sort=${sort}`}`
  );
  return rows.map((r) => ({
    ...r,
    member: !!r.member,
    avatar: r.avatar ?? null,
    createdAt: toDate(r.createdAt),
  }));
}

export const beginHangul = () => beginRun(BOARD);

/** 👍 웃겨요 누르기 · 취소 → 지금 👍 수 (내 문장엔 못 누름 — 서버가 400) */
export async function likeHangul(id: string, on: boolean): Promise<number> {
  await signIn();
  const r = await withCaptcha((headers) =>
    api<{ likes: number }>(`${PATH}/${encodeURIComponent(id)}/like`, {
      method: "POST",
      auth: true,
      headers,
      body: { on },
    })
  );
  return r.likes;
}
/** 이 기록들 중 내가 👍 누른 것 (로그인 안 했으면 빈 목록) */
export async function likedHangul(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  await signIn();
  return new Set(
    await api<string[]>(`${PATH}/liked?ids=${ids.map(encodeURIComponent).join(",")}`, {
      auth: true,
    })
  );
}
/** "이거 말 되는데?" — 판정기 사전에 없는 말 신고 */
export const reportHangul = (text: string) =>
  api<{ ok: true }>("/api/hangul/report", { method: "POST", body: { text } });

/** secret = 시크릿 등록 (이름 · 별명 · 사진 없이 "익명"으로). 판마다 하나씩 올라감 */
export const submitHangul = (rec: {
  name: string;
  score: number;
  wave: number;
  best: string;
  bestPts: number;
  secret?: boolean;
}) => submitRun(BOARD, PATH, rec);
