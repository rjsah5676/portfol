/**
 * 스윙 → 타구.
 *
 * 타이밍 오차 e = (방망이가 공 지나는 자리에 닿는 시각) − (공이 홈플레이트를 지나는 시각).
 *   |e| 가 창(W) 안이면 맞음. 히트가 높을수록 창이 넓음. 가운데 20% 는 PERFECT.
 *   빠르면 당겨 치고(우타 → 좌익수 쪽), 늦으면 밀어 침.
 * 공 위치: 존 밖으로 멀수록 덜 맞음 (볼을 치면 빗맞음). 높은 공 → 뜬공, 낮은 공 → 땅볼.
 * 파워 · 맞은 정도 · 구속 → 타구 속도. 맞은 정도가 좋을수록 발사각이 이상적인 25° 근처로 모임.
 */
import type { CharId } from "./data";
import type { Rng } from "./rng";
import { clamp, lerp } from "./rng";
import { BALL_R, ZONE, type Pitch } from "./pitch";

export interface BattedBall {
  /** 타구 속도 m/s */
  ev: number;
  /** 발사각 ° (+ 위) */
  la: number;
  /** 방향 ° (0 = 가운데, − 좌익수 쪽, + 우익수 쪽) */
  spray: number;
  /** 맞은 정도 0 ~ 1 */
  c: number;
  perfect: boolean;
  bunt: boolean;
  special?: CharId;
}

export type SwingResult =
  | { kind: "whiff"; e: number }
  | { kind: "foul"; e: number; c: number; tip: boolean }
  | { kind: "bip"; e: number; ball: BattedBall };

export interface SwingIn {
  pitch: Pitch;
  /** 공이 플레이트를 지나는 자리 */
  at: { x: number; y: number };
  /** 타이밍 오차 (초, − 빠름) */
  e: number;
  bats: "R" | "L";
  hit: number;
  power: number;
  bunt: boolean;
  /** 필살타법 */
  special?: CharId;
  /** 컨택존 가운데 (사용자 · CPU 타자가 투구 전에 옮겨 둔 자리). 없으면 존 영향 없음 (자동 진행 시뮬) */
  cz?: { x: number; y: number };
}

/**
 * 컨택존 (마구마구식) — 타자가 투구 전에 옮겨 두는 「노리는 자리」. 반폭 · 반높이 (m).
 * 히트가 높을수록 넓음: 히트 999 → 스트라이크 존(공 반지름 포함)의 95% · 500 → 63% · 250 → 46%.
 */
export function contactZone(hit: number) {
  const k = 0.3 + 0.65 * clamp(hit / 1000, 0, 1);
  return { hw: (ZONE.x + BALL_R) * k, hh: ((ZONE.y1 - ZONE.y0) / 2 + BALL_R) * k };
}
/**
 * 컨택존 가운데가 움직일 수 있는 범위 (과하지 않게) — 좌우 ±0.2m · 위아래 ±0.17m.
 * 제일 좁은 존(히트 0, 반폭 0.08m)도 끝까지 옮기면 존 구석(0.25m)에 닿는 정도. 타자 그림은 화면에서 좌우 57px · 위아래 49px 까지
 */
export const CZ_RANGE = { x: 0.2, y0: ZONE.mid - 0.17, y1: ZONE.mid + 0.17 };
/**
 * 컨택존 배율: 존 가운데 1.08 → 존 끝 0.96 (잘 노리면 덤), 밖으로 멀어질수록 줄어 최저 0.3
 * (존 밖이라고 무조건 헛스윙 · 아웃은 아님 — 타이밍이 좋으면 빗맞은 안타 · 파울은 나옴)
 */
export function zoneFactor(at: { x: number; y: number }, cz: { x: number; y: number }, hit: number) {
  const { hw, hh } = contactZone(hit);
  const dn = Math.hypot((at.x - cz.x) / hw, (at.y - cz.y) / hh);
  return { k: dn <= 1 ? 1.08 - 0.12 * dn * dn : Math.max(0.3, 0.96 - 0.5 * (dn - 1)), dn };
}

/** 타이밍 창 (초) */
export const timingWindow = (hit: number, bunt: boolean, special: boolean) =>
  (0.074 + (hit / 1000) * 0.05) * (bunt ? 1.9 : 1) * (special ? 1.55 : 1);

export function swing(o: SwingIn, rng: Rng): SwingResult {
  const sp = o.special;
  const W = timingWindow(o.hit, o.bunt, !!sp);
  // 바이올렛 피루엣: 한 바퀴 돌며 박자를 다시 맞춤 → 타이밍 오차 절반
  const e = sp === "violet" ? o.e * 0.5 : o.e;
  const r = Math.abs(e) / W;
  const qt = r >= 1 ? 0 : 1 - Math.pow(r, 1.6);
  // 존 밖 거리
  const dx = Math.max(0, Math.abs(o.at.x) - (ZONE.x + 0.09));
  const dy = Math.max(0, ZONE.y0 - 0.08 - o.at.y, o.at.y - (ZONE.y1 + 0.06));
  const dist = Math.hypot(dx, dy);
  const ql = sp === "soyoung" ? 1 : clamp(1 - dist / 0.2, 0, 1);
  // 좋은 공(게이지 MAX)은 정타가 덜 나옴 · 마구는 더
  const pq = o.pitch.special ? 0.12 : o.pitch.mistake ? -0.15 : o.pitch.quality * 0.16;
  const z = o.cz ? zoneFactor(o.at, o.cz, o.hit) : { k: 1, dn: 0 };
  let c = qt * ql * z.k * (1.06 - pq);
  // PERFECT 는 타이밍 + 컨택존 안쪽(가운데 쪽)일 때만
  const perfect = r < 0.15 && ql > 0.75 && z.dn < 0.85;
  if (perfect) c = Math.max(c, 0.92 * ql * Math.min(1, z.k));
  c = clamp(c, 0, 1);
  if (c < 0.1) return { kind: "whiff", e: o.e };

  if (o.bunt) {
    if (c < 0.3 && rng.chance(0.6)) return { kind: "foul", e: o.e, c, tip: false };
    const ball: BattedBall = {
      ev: 7 + c * 6 + rng() * 2,
      la: -12 + rng.gauss() * 7 + (c < 0.4 ? 25 * rng() : 0),
      spray: (o.e / W) * 30 * (o.bats === "R" ? 1 : -1) + rng.gauss() * 14,
      c,
      perfect: false,
      bunt: true,
    };
    if (Math.abs(ball.spray) > 44) return { kind: "foul", e: o.e, c, tip: false };
    return { kind: "bip", e: o.e, ball };
  }

  // 빗맞음 → 대부분 파울
  if (c < 0.3 && rng.chance(0.72 - c)) return { kind: "foul", e: o.e, c, tip: c < 0.18 };

  const side = o.bats === "R" ? 1 : -1;
  let spray = (e / W) * 58 * side + o.at.x * 38 + rng.gauss() * (3 + 9 * (1 - c));
  // 높이: 높은 공일수록 뜸
  // 존 높이(0.43m)에 맞춘 기울기 — 존 위 끝 ≈ +13°, 아래 끝 ≈ -13°
  const base = 6 + (o.at.y - ZONE.mid) * 62 + rng.gauss() * 20;
  // 정타: 힘센 타자일수록 띄워서 담장 쪽 (힘 500 → 23° · 1000 → 29°)
  const ideal = perfect ? 17 + (o.power / 1000) * 12 + rng.gauss() * 5 : 22 + rng.gauss() * 7;
  let la = lerp(base, ideal, Math.pow(c, 1.4));
  // 빗맞으면 위아래로 크게 (팝플라이 · 땅볼)
  if (c < 0.45 && rng.chance(0.5)) la += (rng() < 0.5 ? -1 : 1) * rng.range(15, 35) * (1 - c);
  const pm = o.pitch.kmh / 3.6;
  let ev = 20 + Math.pow(c, 1.3) * (15.5 + (o.power / 1000) * 14) + pm * 0.08 * c;
  if (perfect) ev += 4;

  switch (sp) {
    case "kai":
      la = clamp(la, 4, 16);
      ev += 5;
      break;
    case "igna":
      ev += 3;
      break;
    case "soyoung":
      la = lerp(la, 26, 0.6);
      ev += 2;
      break;
    case "ivan":
      if (c > 0.45) {
        ev = Math.max(ev, 52);
        la = clamp(lerp(la, 30, 0.7), 22, 38);
        spray = clamp(spray, -38, 38);
      }
      break;
    case "mei": {
      // 태극: 라이너로 휘어 수비 사이 빈틈으로
      la = clamp(lerp(la, 13, 0.6), 5, 22);
      const gaps = [-24, -9, 9, 24];
      const g = gaps.reduce((a, b) => (Math.abs(b - spray) < Math.abs(a - spray) ? b : a));
      spray = lerp(spray, g, 0.75) + rng.gauss() * 2;
      ev += 3;
      break;
    }
    case "violet":
      la = clamp(lerp(la, 15, 0.55), 6, 24);
      ev += 3;
      break;
    default:
      if (sp) ev += 2;
  }
  // 첫 판정: 너무 옆이면 파울
  if (Math.abs(spray) > 47 && la < 55) return { kind: "foul", e: o.e, c, tip: false };
  return { kind: "bip", e: o.e, ball: { ev, la: clamp(la, -35, 80), spray, c, perfect, bunt: false, special: sp } };
}

/** 타이밍 표시 문구 */
export function timingLabel(e: number, W: number) {
  const r = e / W;
  if (Math.abs(r) < 0.15) return "PERFECT";
  if (r < -1) return "너무 빠름";
  if (r < -0.45) return "빠름";
  if (r > 1) return "너무 늦음";
  if (r > 0.45) return "늦음";
  return "GOOD";
}
