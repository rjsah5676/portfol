import { hangulLen, type Morph } from "./judge";

/*
 * 니들이 한글을 알아? — 대전 모드 「말싸움」 규칙 (브라우저 · 서버 같이 씀)
 *
 *   둘 다 같은 시드로 자모를 받고(같은 재료), 각자 자기 판에서 먹물을 막으면서 문장을 지음.
 *   문장을 완성하면 (막기 · 보내기를 고르게 했더니 너무 어렵다 해서 하나로):
 *     내 판은 1인 모드처럼 화면 전체 공격 + 그 문장이 먹물 떼가 되어 상대 판으로 (몇 초 뒤 도착, 상대 화면에 미리 보임)
 *   받아치기: 날아오는 공격과 이어지는 문장(같은 말 · 이음말 · 가리키는 말)이면
 *     반사 — 그 공격을 없애고 (받은 힘 + 내 힘) × 1.5 로 되돌려 보냄, 랠리마다 커짐
 *   3분 또는 먹물 LOAD_MAX(100) 가 먼저 차면 끝. 시간이 다 되면 먹물이 적은 쪽, 같으면 문장 점수.
 *   판정 · 공격력은 서버가 정함 (서버가 Kiwi 로 다시 읽음).
 */

export const VS_SEC = 180;
/** 시작 전 카운트다운(ms) */
export const VS_COUNTDOWN = 3_000;
/** 반사 배수 (랠리 한 번마다) */
export const COUNTER_K = 1.5;
/** 한 공격의 먹물 얼룩 수 상한 — 긴 문장 한 방으로 끝나지 않게 */
export const MAX_BLOBS = 14;
/** 문장을 연달아 낼 수 있는 최소 간격(ms) */
export const SENTENCE_GAP = 1_200;

/** 공격 힘(문장 점수) → 먹물 얼룩 수 */
export const blobsOf = (power: number) => Math.max(1, Math.min(MAX_BLOBS, Math.round(power / 45)));

/**
 * 날아가는 시간(ms): 길수록 늦게 도착(= 막을 틈을 줌), 「!」 로 끝나면 빠름, 막말은 싸고 빠름.
 * 1.8 ~ 6초
 */
export function flightMs(text: string, grade: string): number {
  let ms = 3_000 + 110 * hangulLen(text);
  if (/!$/.test(text)) ms *= 0.6;
  if (grade === "막말") ms *= 0.7;
  return Math.round(Math.max(1_800, Math.min(6_000, ms)));
}

export type VsPhase = "waiting" | "play" | "ended";
export type VsMode = "guard" | "send";

export interface VsPlayer {
  uid: string;
  name: string;
  /** 훈장님 AI 면 난이도 1~3 */
  bot?: number;
  /** 마지막으로 알려 준 먹물 양 */
  load: number;
  points: number;
  /** 지금 방에 붙어 있는지 */
  here: boolean;
}

export interface VsAttack {
  id: string;
  from: string;
  to: string;
  text: string;
  spaced: string;
  grade: string;
  morphs: Morph[];
  power: number;
  blobs: number;
  /** 명문이면 단단한 놈 하나 섞임 */
  heavy: boolean;
  at: number;
  arriveAt: number;
  /** 몇 번째로 오간 받아치기인지 (0 = 처음 보낸 것) */
  rally: number;
  status: "flying" | "landed" | "offset" | "blocked" | "reflected";
}

export interface VsMsg {
  id: string;
  uid: string;
  text: string;
  spaced: string;
  grade: string;
  points: number;
  /** send 보냄 · guard 막음 · counter 반사 · block 완벽 방어 */
  kind: "send" | "guard" | "counter" | "block";
  at: number;
  /** 받아친 상대 문장 id (counter · block) */
  re?: string;
  /** 이 메시지로 생긴 공격 (send · counter) */
  attack?: string;
  /** 판 끝 「오늘의 한 마디」 표를 준 사람들 */
  votes: string[];
}

export interface VsRoom {
  id: string;
  host: string;
  phase: VsPhase;
  seed: number;
  startAt: number;
  endAt: number;
  players: VsPlayer[];
  attacks: VsAttack[];
  log: VsMsg[];
  /** 끝났을 때: 이긴 사람 uid (무승부 null) · 까닭 */
  winner: string | null;
  reason: "" | "ko" | "time" | "left";
}

/** 이 문장이 받아칠 수 있는, 나에게 날아오는 공격 (가장 먼저 도착하는 것부터) */
export function counterTarget(
  room: Pick<VsRoom, "attacks">,
  uid: string,
  morphs: Morph[],
  now: number,
  link: (a: Morph[], b: Morph[]) => { level: number }
): VsAttack | null {
  const mine = room.attacks
    .filter((a) => a.to === uid && a.status === "flying" && a.arriveAt > now)
    .sort((a, b) => a.arriveAt - b.arriveAt);
  return mine.find((a) => link(a.morphs, morphs).level > 0) ?? null;
}

/** 시드 하나로 같은 순서의 난수 (자모 뽑기) — mulberry32 */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 판 끝 기준: 이긴 사람 (시간 끝 — 먹물 적은 쪽, 같으면 점수) */
export function timeWinner(players: VsPlayer[]): string | null {
  const [a, b] = players;
  if (!a || !b) return a?.uid ?? null;
  if (a.load !== b.load) return a.load < b.load ? a.uid : b.uid;
  if (a.points !== b.points) return a.points > b.points ? a.uid : b.uid;
  return null;
}

export const EMOTES = ["👏", "😂", "😡", "🙇", "🔥", "🤔"] as const;
