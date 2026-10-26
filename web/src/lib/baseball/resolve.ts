/**
 * 공 하나 처리: 투구 + (스윙) → 볼 · 스트라이크 · 파울 · 인플레이(수비 시뮬) → 경기 상태 반영.
 * 화면과 시뮬이 같이 씀. evaluate(계산만) → commit(반영) 두 단계라 포르테 「되감기 스윙」처럼 결과를 보고 무를 수 있음.
 */
import { swing, type SwingResult } from "./contact";
import type { GameState, PAResult } from "./game";
import { applyPlay, batSide, batter, callPitch, fieldSide, pitchThrown } from "./game";
import { simulatePlay, type FieldOut } from "./play";
import { inZone, plateCross, type Pitch } from "./pitch";
import type { Rng } from "./rng";
import type { CharId } from "./data";

export interface SwingDecision {
  swing: boolean;
  /** 타이밍 오차 (초) */
  e: number;
  bunt: boolean;
  special?: CharId;
}

export interface Outcome {
  call: "ball" | "strike" | "swingMiss" | "foul" | "bip";
  at: { x: number; y: number };
  sw?: SwingResult;
  field?: FieldOut;
  /** 포르테 되감기로 무를 수 있는 나쁜 결과 */
  bad: boolean;
}

export function evaluate(s: GameState, p: Pitch, d: SwingDecision | null, rng: Rng): Outcome {
  const at = plateCross(p);
  if (!d || !d.swing) {
    return { call: inZone(at.x, at.y) ? "strike" : "ball", at, bad: false };
  }
  const b = batter(s);
  // 육성 특수능력 (득점권 · 2스트라이크)
  const risp = s.bases[1] !== null || s.bases[2] !== null;
  const hit = Math.max(1, b.hit + (risp ? b.sit?.rispHit ?? 0 : 0) + (s.strikes >= 2 ? b.sit?.twoK ?? 0 : 0));
  const power = Math.max(1, b.power + (risp ? b.sit?.rispPow ?? 0 : 0));
  const sw = swing({ pitch: p, at, e: d.e, bats: b.bats, hit, power, bunt: d.bunt, special: d.special }, rng);
  if (sw.kind === "whiff") return { call: "swingMiss", at, sw, bad: true };
  if (sw.kind === "foul") return { call: "foul", at, sw, bad: false };
  const fs = s.sides[fieldSide(s)];
  const bs = s.sides[batSide(s)];
  const def = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
    if (i === 0) return 500;
    const pos = ["", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"][i];
    const pl = fs.team.batters.find((x) => x.pos === pos) ?? fs.team.batters[i];
    return pl.def;
  });
  const field = simulatePlay(
    {
      ball: sw.ball,
      bases: s.bases.map((id, k) => (id === null ? null : { id, base: k + 1, run: bs.team.batters[id].run })),
      batter: { id: bs.order, run: b.run },
      outs: s.outs,
      def,
    },
    rng
  );
  if (field.foul) return { call: "foul", at, sw, field, bad: false };
  const bad = field.result === "OUT" || field.result === "DP" || field.result === "FC";
  return { call: "bip", at, sw, field, bad };
}

/** 반영 (타석이 끝나면 결과) */
export function commit(s: GameState, o: Outcome): PAResult | null {
  pitchThrown(s);
  if (o.call === "bip" && o.field) return applyPlay(s, o.field);
  return callPitch(s, o.call as "ball" | "strike" | "swingMiss" | "foul");
}
