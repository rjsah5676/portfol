/*
 * 올인 러브 — 단서 카드 (결전 「✎ 단서 조합」에 쓰는 카드)
 * 세 종류: 버릇(tells.ts) · 이야기 단서(대본 플래그) · 반응 단서(매치 테이블 토크로 알아낸 것, rcXX 플래그)
 * 결전 각 거리의 combo.pairs 중 하나를 고르면 특별 행동이 열림. 조합은 늘 카드 두 장.
 */
import { check } from "./engine";
import { TELLS } from "./tells";
import type { CharKey, Cond, Vars } from "./types";

export interface Clue {
  id: string;
  who?: CharKey;
  name: string;
  text: string;
  need: Cond;
  kind: "tell" | "story" | "react";
}

const on = (v: string): Cond => ({ v, op: ">=", n: 1 });

/** 매치 테이블 토크로 알아낸 반응 (holdem.ts TALK.clue) */
export const REACT_CLUES: Clue[] = [
  { id: "rcA1", who: "amy", kind: "react", name: "도발하면 시끄러워진다", text: "에이미 — 도발하면 블러프가 늘고, 그땐 시끄러워진다.", need: on("rcA1") },
  { id: "rcA2", who: "amy", kind: "react", name: "칭찬하면 크게 건다", text: "에이미 — 칭찬하면 신나서 크게 건다.", need: on("rcA2") },
  { id: "rcA3", who: "amy", kind: "react", name: "진지해지면 조용해진다", text: "에이미 — 뭔가 걸리면 진지해진다. 진짜일 땐 말이 없어지고 트윈테일 끝을 감는다.", need: on("rcA3") },
  { id: "rcY1", who: "yeonseo", kind: "react", name: "칭찬하면 숨긴다", text: "연서 — 칭찬하면 차가워져서 버릇을 숨긴다.", need: on("rcY1") },
  { id: "rcY2", who: "yeonseo", kind: "react", name: "기다리면 손끝이 나온다", text: "연서 — 말없이 기다려 주면, 숨기던 손끝 신호가 나온다.", need: on("rcY2") },
  { id: "rcY3", who: "yeonseo", kind: "react", name: "도발하면 타이트해진다", text: "연서 — 도발하면 타이트해진다. 들어오면 진짜다.", need: on("rcY3") },
  { id: "rcT1", who: "taeyang", kind: "react", name: "물으면 말이 많아진다", text: "태양 — 물어보면 말이 많아진다. 그럴 땐 블러프.", need: on("rcT1") },
  { id: "rcT2", who: "taeyang", kind: "react", name: "칭찬하면 콧노래", text: "태양 — 칭찬하면 콧노래가 커진다. 좋은 패다.", need: on("rcT2") },
  { id: "rcJ1", who: "jeongmin", kind: "react", name: "'기록' 얘기엔 또렷해진다", text: "정민 — '기록' 얘기를 꺼내면 '기록상' 버릇이 또렷해진다.", need: on("rcJ1") },
  { id: "rcJ2", who: "jeongmin", kind: "react", name: "도발하면 '기록상'이 빠진다", text: "정민 — 도발하면 블러프가 늘고, 그땐 '기록상'을 빼먹는다.", need: on("rcJ2") },
];

/** 이야기에서 알게 된 것 (대본이 이미 켜는 플래그) */
export const STORY_CLUES: Clue[] = [
  { id: "c_father", kind: "story", name: "아빠 공책", text: "'딜러 손은 깨끗하다. 카드가 처음부터 그렇게 온다.' 아래층 판은 리버까지 정해져 있다.", need: on("amyLedger") },
  { id: "c_luck", kind: "story", name: "깔아 둔 운", text: "20일차 VIP. 지는 판은 작고 이기는 판은 컸다. 그날 에이미의 운은 사장이 깔아 둔 것이었다.", need: on("a3Rig") },
  { id: "c_deck", kind: "story", name: "섞지 않은 덱", text: "21일차, 내 손으로 섞지 않은 덱을 돌렸다. 그 방의 마지막 카드는 처음부터 정해져 있다.", need: on("a3Deck") },
  { id: "c_rig", kind: "story", name: "바꿔치기", text: "딜러 손이 칩 트레이 쪽으로 반 뼘 내려가면, 덱이 바뀐다.", need: { any: [on("rigKnow"), on("meta_rigKnow"), on("rigSeen")] } },
  { id: "c_ledgerY", kind: "story", name: "연서의 수첩", text: "7년 치 판. 날짜, 손님, 사장 손가락 수. 짜인 판은 늘 같은 모양이었다.", need: on("yeonLedger") },
  { id: "c_cooler", kind: "story", name: "시나리오 — 쿨러", text: "마지막 판은 늘 풀하우스 대 포카드. 연서 수첩에 스물세 번.", need: on("cCooler") },
  { id: "c_swapBack", kind: "story", name: "되돌린 덱", text: "그 1초 동안 연서가 덱을 되돌렸다. 사장은 아직 자기 덱인 줄 안다.", need: on("gSwap") },
];

/** 지금 쥔 단서 카드 전부 (버릇 → 이야기 → 반응 순). extra = 아직 세이브에 안 들어간 이번 판 반응 */
export function cluesKnown(v: Vars, extra: string[] = []): Clue[] {
  const vv = extra.length ? { ...v, ...Object.fromEntries(extra.map((k) => [k, 1])) } : v;
  return [
    ...TELLS.filter((t) => check(t.need, vv)).map<Clue>((t) => ({ id: t.id, who: t.who, name: t.name, text: t.meaning, need: t.need, kind: "tell" })),
    ...STORY_CLUES.filter((c) => check(c.need, vv)),
    ...REACT_CLUES.filter((c) => check(c.need, vv)),
  ];
}
export const reactOf = (who: CharKey) => REACT_CLUES.filter((c) => c.who === who);
/** 고른 두 장이 정답 쌍인지 (순서 무관) */
export const pairHit = (pairs: [string, string][], a: string, b: string) =>
  pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
