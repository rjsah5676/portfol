/**
 * 봇: 투구 고르기 · 게이지 · 타자 스윙 판단 + 사람 흉내(밸런스 시뮬용).
 * 난이도 초급 · 중급 · 고급 = 0 · 1 · 2.
 */
import { playStat, type Batter, type Pitcher } from "./data";
import type { Pitch, PitchKind } from "./pitch";
import { PITCHES, ZONE, inZone } from "./pitch";
import type { Rng } from "./rng";
import { clamp } from "./rng";
import { timingWindow } from "./contact";

export type Diff = 0 | 1 | 2;
export const DIFF_NAME = ["초급", "중급", "고급"] as const;

/**
 * 공 속도 배율 (높을수록 빠름 — 화면 km/h 는 그대로). 중급 0.88 = 실제보다 조금 느리게 (140km 직구가 손 떠나 홈까지 약 0.5초).
 * 0.83 · 1.0 · 1.17 (중급 = 실제 0.44초) → 20% 느리게(0.66 · 0.8 · 0.94) → 거기서 10% 빠르게. 그 전 0.6 · 0.72 · 0.84
 */
export const SPEED_SCALE: Record<Diff, number> = { 0: 0.73, 1: 0.88, 2: 1.03 };

export interface PitchPlan {
  kind: PitchKind;
  target: { x: number; y: number };
}

/** 봇 투수: 볼카운트에 맞춰 구종 · 코스 */
export function cpuPlan(p: Pitcher, balls: number, strikes: number, bats: "R" | "L", rng: Rng): PitchPlan {
  const rep = p.rep;
  // 직구 비율: 몰리면(3볼) 직구, 2스트라이크면 변화구로 유인
  let kind: PitchKind;
  const fbW = balls >= 3 ? 0.75 : strikes >= 2 ? 0.3 : 0.48;
  if (rng() < fbW || rep.length === 1) kind = "FB";
  else kind = rng.pick(rep.filter((k) => k !== "FB"));
  // 존 안 비율
  const zoneP = balls >= 3 ? 0.8 : strikes >= 2 && balls <= 1 ? 0.3 : 0.55;
  const inside = rng() < zoneP;
  const away = bats === "R" ? 1 : -1; // 우타자 바깥쪽 = +x
  let x: number;
  let y: number;
  if (inside) {
    x = clamp(rng.gauss() * 0.12 + away * 0.04, -ZONE.x + 0.02, ZONE.x - 0.02);
    y = clamp(ZONE.mid + rng.gauss() * 0.12, ZONE.y0 + 0.03, ZONE.y1 - 0.03);
  } else {
    // 유인구: 바깥 · 낮은 쪽
    const side = rng() < 0.62 ? away : -away;
    x = side * (ZONE.x + 0.06 + rng() * 0.14);
    y = PITCHES[kind].low ? ZONE.y0 - 0.06 - rng() * 0.12 : ZONE.y0 + 0.1 + rng() * 0.45;
    if (rng() < 0.35) {
      x = rng.gauss() * 0.1;
      y = rng() < 0.6 ? ZONE.y0 - 0.12 - rng() * 0.1 : ZONE.y1 + 0.1;
    }
  }
  return { kind, target: { x, y } };
}

/** 봇 투수 게이지 결과 */
export function cpuGauge(diff: Diff, rng: Rng) {
  const mean = [0.55, 0.7, 0.84][diff];
  return clamp(mean + rng.gauss() * 0.16, 0.05, 1);
}

/** 봇 마구 쓸 때: 위기 · 2스트라이크 · 늦은 이닝 */
export function cpuUseSpecial(left: number, inning: number, strikes: number, risp: boolean, rng: Rng) {
  if (left <= 0) return false;
  const p = (strikes >= 2 ? 0.35 : 0.12) + (risp ? 0.2 : 0) + (inning >= 7 ? 0.15 : 0);
  return rng() < p;
}

export interface CpuSwing {
  swing: boolean;
  /** 타이밍 오차 (초) */
  e: number;
  bunt: boolean;
}

/**
 * 봇 타자: 존 판단(선구) + 타이밍.
 * 직구를 기다리다 느린 공엔 빨라지고(-), 마구엔 크게 흔들림.
 */
export function cpuSwing(b: Batter, p: Pitch, at: { x: number; y: number }, strikes: number, balls: number, diff: Diff, rng: Rng, fbDur: number): CpuSwing {
  const zone = inZone(at.x, at.y);
  const hit = playStat(b, b.hit);
  const eye = [0.45, 0.6, 0.72][diff] + (hit / 1000) * 0.15;
  let sw: number;
  if (zone) sw = 0.62 + eye * 0.25 + (strikes >= 2 ? 0.18 : 0) - (balls >= 3 ? 0.1 : 0);
  else {
    const far = Math.max(Math.abs(at.x) - ZONE.x, ZONE.y0 - at.y, at.y - ZONE.y1);
    sw = clamp(0.5 - eye * 0.45 - far * 2.2 + (strikes >= 2 ? 0.15 : 0), 0.02, 0.6);
  }
  if (p.mistake) sw += 0.2;
  if (p.special) sw = zone ? 0.9 : 0.7;
  const swing = rng() < sw;
  const W = timingWindow(hit, false, false);
  // 타이밍 흔들림: 실력(난이도 · 히트) + 공 질 + 직구 기다리다 속은 정도
  const skill = [1.15, 0.92, 0.74][diff] * (1.2 - (hit / 1000) * 0.45);
  let sigma = W * 1.0 * skill * (1 + p.quality * 0.35);
  let bias = 0;
  const slow = p.dur - fbDur;
  if (slow > 0) bias -= slow * (0.35 - (hit / 1000) * 0.15); // 느린 공 → 일찍 휘두름
  if (p.special) {
    sigma *= 1.7;
    bias += (rng() - 0.5) * W * 1.4;
  }
  if (p.mistake) sigma *= 0.6;
  return { swing, e: bias + rng.gauss() * sigma, bunt: false };
}

/** 사람 흉내 (밸런스 시뮬): 존 판단은 그럭저럭, 타이밍 표준편차 sigma 초 */
export function humanSwing(p: Pitch, at: { x: number; y: number }, strikes: number, sigma: number, rng: Rng): CpuSwing {
  const zone = inZone(at.x, at.y);
  const sw = zone ? 0.75 + (strikes >= 2 ? 0.15 : 0) : 0.2 + (strikes >= 2 ? 0.15 : 0);
  const special = p.special ? 2 : 1;
  return { swing: rng() < sw, e: rng.gauss() * sigma * special, bunt: false };
}
