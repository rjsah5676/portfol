/**
 * 랭크전 봇전 확인: 브라우저에서 한 봇전을 서버에서 똑같이 다시 돌려 승패를 정함.
 *
 * 경기(sim)와 봇(FightAI)은 같은 씨앗·같은 입력이면 늘 같은 결과(결정론)라서,
 * 사람 쪽 입력 기록만 받으면 서버가 봇 입력을 다시 만들며 끝까지 돌려 볼 수 있음 → 결과를 꾸며 보내도 소용없음.
 * 게임 데이터·AI가 서버와 다르면(한쪽만 새 버전) 결과가 달라지니, 큐에 들어올 때 botBuild() 가 같은 사람만 봇과 붙임.
 * (web/src/lib/fight 를 그대로 씀 — server/Dockerfile 이 이 폴더를 복사함)
 */
import { CHARS } from "../../../web/src/lib/fight/chars";
import { BUILD_ID, hpRatio, newMatch, step } from "../../../web/src/lib/fight/sim";
import { AI_ID, FightAI, aiForRating } from "../../../web/src/lib/fight/ai";
import type { Margin } from "./fightRating";

/** 봇전 빌드 지문: 게임 데이터 + AI (브라우저가 보내는 값과 같아야 함 — web realtime/fight.ts rankQueue) */
export const botBuild = () => `${BUILD_ID}:${AI_ID}`;

export interface BotReplay {
  /** [내 캐릭터, 봇 캐릭터] — 나는 1P(0번), 봇은 2P(1번) */
  chars: [number, number];
  map: number;
  seed: number;
  botR: number;
  /** 내 입력 (프레임마다) */
  inputs: number[];
}

/** 다시 돌린 결과. done = 입력 기록 안에서 경기가 끝났나 · winner 0 나 · 1 봇 · 2 무승부 */
export async function replayBot(o: BotReplay): Promise<{ done: boolean; winner: number; margin: Margin | null; frames: number }> {
  const s = newMatch(o.chars, o.map);
  const ai = new FightAI(aiForRating(o.botR, CHARS[o.chars[1]].id), o.seed);
  let k = 0;
  while (s.phase !== "over" && k < o.inputs.length) {
    step(s, [o.inputs[k], ai.next(s, 1)]);
    k++;
    // 한 번에 오래 붙잡고 있지 않게 (다른 방·게임이 멈추지 않게) 조금씩 끊어서
    if (k % 150 === 0) await new Promise((r) => setImmediate(r)); // AI 노림수(미리 돌려 보기)가 무거워져 더 자주 쉼
  }
  if (s.phase !== "over") return { done: false, winner: -1, margin: null, frames: k };
  const w = s.winner;
  const margin = w === 0 || w === 1 ? { rounds: Math.abs(s.wins[0] - s.wins[1]), hp: hpRatio(s.p[w]) } : null;
  return { done: true, winner: w, margin, frames: k };
}
replayBot.charCount = () => CHARS.length;
