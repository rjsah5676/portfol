import { randomInt } from "node:crypto";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Firestore 자동 id와 같은 모양(영숫자 20자) — 가져온 기존 문서 id와 형식이 섞여도 되게 */
export function newId(len = 20): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALNUM[randomInt(ALNUM.length)];
  return s;
}

let lastTs = 0;
let seq = 0;
/** 만든 순서대로 문자열 정렬되는 id (채팅·그림 조각처럼 순서가 중요한 곳) */
export function orderedId(): string {
  const now = Date.now();
  if (now === lastTs) seq++;
  else {
    lastTs = now;
    seq = 0;
  }
  return now.toString(36).padStart(9, "0") + seq.toString(36).padStart(3, "0") + newId(6);
}

/** 클라이언트가 만들어 보낸 id가 쓸 만한 형식인지 */
export const isClientId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(v);
