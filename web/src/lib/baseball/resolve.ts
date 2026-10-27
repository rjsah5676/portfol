/**
 * 공 하나 처리: 투구 + (스윙) → 볼 · 스트라이크 · 파울 · 인플레이(수비 시뮬) → 경기 상태 반영.
 * 화면과 시뮬이 같이 씀. evaluate(계산만) → commit(반영) 두 단계라 결과를 보고 무를 수 있음.
 */
import { swing, type SwingResult } from "./contact";
import type { GameState, PAResult } from "./game";
import { applyPlay, batSide, batter, callPitch, fieldSide, pitchThrown } from "./game";
import { simulatePlay, type FieldOut } from "./play";
import { inZone, plateCross, type Pitch } from "./pitch";
import type { Rng } from "./rng";
import { playStat, type CharId } from "./data";

export interface SwingDecision {
  swing: boolean;
  /** 타이밍 오차 (초) */
  e: number;
  bunt: boolean;
  special?: CharId;
  /** 컨택존 가운데 (투구 전에 옮겨 둔 자리) */
  cz?: { x: number; y: number };
}

export interface Outcome {
  call: "ball" | "strike" | "swingMiss" | "foul" | "bip" | "hbp";
  at: { x: number; y: number };
  sw?: SwingResult;
  field?: FieldOut;
  /** 나쁜 결과 (헛스윙 · 아웃) */
  bad: boolean;
}

/**
 * 몸에 맞는 공: 몸쪽으로 크게 빠져 타자 몸이 있는 자리를 지나는 공 (안 휘둘렀을 때).
 * 타자 몸 안쪽 끝 = 플레이트 가운데에서 0.52m (타석 안쪽 선 0.15m + 몸 앞). 타자가 플레이트 쪽으로 붙으면(shift +) 그만큼 가까워짐.
 */
export function hitByPitch(at: { x: number; y: number }, bats: "R" | "L", shift = 0) {
  const inside = bats === "R" ? -at.x : at.x;
  // 컨택존을 바깥쪽 끝까지 옮겨도 몸은 조금만 붙음 (0.52 → 최소 0.46m) — 몸쪽 유인구가 줄줄이 사구가 되지 않게
  const edge = Math.max(0.46, 0.52 - shift * 0.3);
  return inside > edge && at.y > 0.15 && at.y < 1.75;
}
/** 컨택존을 옮긴 거리 중 플레이트 쪽 성분 (+ 붙음) — 몸 판정엔 30%만 반영 (hitByPitch) */
export const batterShift = (bats: "R" | "L", cz?: { x: number; y: number }) => (cz ? (bats === "R" ? cz.x : -cz.x) : 0);

/** 이 상황의 실제 히트 (득점권 · 2스트라이크 · 7회 이후 특수능력 포함) — 판정 · 컨택존 크기 표시가 같은 값을 씀 */
export function effectiveHit(s: GameState, b: { hit: number; grow?: boolean; sit?: { rispHit?: number; twoK?: number; late?: number } }) {
  const risp = s.bases[1] !== null || s.bases[2] !== null;
  const late = s.inning >= 7 ? b.sit?.late ?? 0 : 0;
  return Math.max(1, playStat(b, b.hit) + (risp ? b.sit?.rispHit ?? 0 : 0) + (s.strikes >= 2 ? b.sit?.twoK ?? 0 : 0) + late);
}

export function evaluate(s: GameState, p: Pitch, d: SwingDecision | null, rng: Rng, cz?: { x: number; y: number }): Outcome {
  const at = plateCross(p);
  if (!d || !d.swing) {
    const b = batter(s);
    if (!p.special && hitByPitch(at, b.bats, batterShift(b.bats, d?.cz ?? cz))) return { call: "hbp", at, bad: false };
    return { call: inZone(at.x, at.y) ? "strike" : "ball", at, bad: false };
  }
  const b = batter(s);
  // 육성 특수능력 (득점권 · 2스트라이크)
  const risp = s.bases[1] !== null || s.bases[2] !== null;
  const late = s.inning >= 7 ? b.sit?.late ?? 0 : 0;
  const hit = effectiveHit(s, b);
  const power = Math.max(1, playStat(b, b.power) + (risp ? b.sit?.rispPow ?? 0 : 0) + late);
  const sw = swing({ pitch: p, at, e: d.e, bats: b.bats, hit, power, bunt: d.bunt, special: d.special, cz: d.cz }, rng);
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
      bases: s.bases.map((id, k) => (id === null ? null : { id, base: k + 1, run: playStat(bs.team.batters[id], bs.team.batters[id].run) })),
      batter: { id: bs.order, run: playStat(b, b.run) },
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
  return callPitch(s, o.call as "ball" | "strike" | "swingMiss" | "foul" | "hbp");
}
