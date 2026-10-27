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
 * 히트가 높을수록 넓음 (스트라이크 존 · 공 반지름 포함 기준 가로세로 배율):
 *   히트 300 → 0.34 (존 9칸 중 1칸의 1.2배) · 500 → 0.53 · 700 → 0.71 · 900 → 0.90 · 999 → 0.99. 최저 0.2
 */
export function contactZone(hit: number) {
  const k = clamp(0.34 + ((hit - 300) / 600) * 0.56, 0.2, 1);
  return { hw: (ZONE.x + BALL_R) * k, hh: ((ZONE.y1 - ZONE.y0) / 2 + BALL_R) * k };
}
/**
 * 컨택존 가운데가 움직일 수 있는 범위 (과하지 않게) — 좌우 ±0.14m · 위아래 ±0.12m (처음 범위의 70%).
 * 타자 그림은 화면에서 좌우 40px · 아래 34px 까지 (위로는 거의 안 움직임 — match.batterPos)
 */
export const CZ_RANGE = { x: 0.14, y0: ZONE.mid - 0.12, y1: ZONE.mid + 0.12 };
/** 공이 스트라이크 존(공 반지름 포함 — 걸치면 스트라이크)에서 벗어난 거리 m. 스트라이크면 0 */
export function offZone(at: { x: number; y: number }) {
  const dx = Math.max(0, Math.abs(at.x) - (ZONE.x + BALL_R));
  const dy = Math.max(0, ZONE.y0 - BALL_R - at.y, at.y - (ZONE.y1 + BALL_R));
  return Math.hypot(dx, dy);
}
/**
 * 볼 정도 · 터무니없는 볼 기준 (offZone 거리, m)
 * - BALL_FULL: 이만큼 빠지면 완전히 「볼」 (그 사이는 스트라이크 쪽에 가깝게 섞음)
 * - 터무니없는 볼: 그림 격자 끝에서 공 2개 빠지면 시작 → 3개면 완전히 (공 지름 0.074)
 */
export const BALL_FULL = 0.06;
export const WILD_FROM = 2 * 2 * BALL_R - BALL_R;
export const WILD_FULL = 3 * 2 * BALL_R - BALL_R;

/**
 * 공 위치 × 컨택존 → 맞히는 질 q (타이밍 질과 곱함). dn = 컨택존 가운데에서 거리 (1 = 네모 끝)
 * 순서: 스트 · 컨택존 가운데 (1.06) > 스트 · 존 안 (끝 0.96)
 *     > 스트 · 존 밖 근처 (dn 1~1.5: 0.96~0.76) = 볼 · 가운데 근처 (dn 0~0.4: 0.84~0.72)
 *     > 스트 · 존 밖 멀리 (dn 2~: 0.56~0.4) = 볼 · 존 안 (dn 0.5~1: 0.68~0.44)
 *     > 볼 · 존 밖 (빠르게 0 → 헛스윙 · 파울) · 터무니없는 볼 (×0.25 → 안타 거의 없음)
 */
export function locQuality(at: { x: number; y: number }, cz: { x: number; y: number }, hit: number, anywhere = false) {
  const { hw, hh } = contactZone(hit);
  // 화면의 네모 컨택존과 같게: 가로 · 세로 중 더 먼 쪽 (네모 안이면 dn ≤ 1)
  const dn = Math.max(Math.abs(at.x - cz.x) / hw, Math.abs(at.y - cz.y) / hh);
  const sd = anywhere ? 0 : offZone(at);
  const b = clamp(sd / BALL_FULL, 0, 1);
  const w = clamp((sd - WILD_FROM) / (WILD_FULL - WILD_FROM), 0, 1);
  const strike = dn <= 1 ? 1.06 - 0.1 * dn * dn : Math.max(0.4, 0.96 - 0.4 * (dn - 1));
  const ball = dn <= 1 ? 0.84 - 0.4 * Math.pow(dn, 1.3) : 0.44 * Math.exp(-3 * (dn - 1));
  const q = lerp(strike, ball, b) * lerp(1, 0.25, w);
  return { q, dn, b, w, sd };
}

/** 타구 속도 (m/s) = base + c^1.3 × (c + 파워/1000 × pow) + 구속 몫 + 정타 덤 pf */
export const EV = { base: 22, c: 16.3, pow: 4.2, pf: 4.7, laMid: 14, la0: 15, laPow: 7, laSd: 7, laCurve: 3, pfT0: 0.15, pfT1: 0.45 };

/** 타이밍 창 (초) */
export const timingWindow = (hit: number, bunt: boolean, special: boolean) =>
  (0.074 + (hit / 1000) * 0.05) * (bunt ? 1.9 : 1) * (special ? 1.55 : 1);

export function swing(o: SwingIn, rng: Rng): SwingResult {
  const sp = o.special;
  // 구위가 좋으면 맞히는 창도 좁아짐 (헛스윙 ↑)
  const W = timingWindow(o.hit, o.bunt, !!sp) * (1 - (o.pitch.special ? 0 : o.pitch.stuff ?? 0));
  // 바이올렛 피루엣: 한 바퀴 돌며 박자를 다시 맞춤 → 타이밍 오차 절반
  const e = sp === "violet" ? o.e * 0.5 : o.e;
  const r = Math.abs(e) / W;
  const qt = r >= 1 ? 0 : 1 - Math.pow(r, 1.6);
  // 좋은 공(게이지 MAX)은 정타가 덜 나옴 · 마구는 더
  // 구위 (변화 · 구속 능력치) 도 정타를 줄임
  const pq = o.pitch.special ? 0.12 : o.pitch.mistake ? -0.15 : o.pitch.quality * 0.16 + (o.pitch.stuff ?? 0);
  let q: number;
  // 컨택존 없음(자동 진행 시뮬)은 「대충 잘 노린」 정도로 침 (dn 0.4 와 같게)
  let dn = 0.4;
  let wild = 0;
  let outCz = false;
  if (o.cz) {
    const L = locQuality(o.at, o.cz, o.hit, sp === "soyoung");
    q = L.q;
    dn = L.dn;
    wild = L.w;
    outCz = L.dn > 1;
  } else {
    // 컨택존 없음 (자동 진행 시뮬): 존 밖 거리만
    const dx = Math.max(0, Math.abs(o.at.x) - (ZONE.x + 0.09));
    const dy = Math.max(0, ZONE.y0 - 0.08 - o.at.y, o.at.y - (ZONE.y1 + 0.06));
    q = (sp === "soyoung" ? 1 : clamp(1 - Math.hypot(dx, dy) / 0.2, 0, 1)) * 1.04;
  }
  let c = qt * q * (1.06 - pq);
  // PERFECT 는 타이밍 + 공 위치 좋음 + 컨택존 안쪽(가운데 쪽)일 때만
  // 정타 정도 pf (0 ~ 1): 타이밍 · 컨택존 가운데 · 공 위치가 좋을수록 부드럽게 올라감 (문턱 하나로 확 바뀌지 않게)
  const pf =
    clamp((EV.pfT1 - r) / (EV.pfT1 - EV.pfT0), 0, 1) * clamp((1 - dn) / 0.3, 0, 1) * clamp((q - 0.7) / 0.2, 0, 1);
  // PERFECT 표시 · 필살 연출은 거의 꽉 찬 정타만
  const perfect = r < 0.15 && q > 0.85 && dn < 0.85;
  c = Math.max(c, lerp(c, 0.92 * Math.min(1, q), pf));
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

  // 빗맞음 → 대부분 파울. 터무니없는 볼은 앞으로 거의 안 감 (컨택존 밖이면 아예)
  const foulP = wild > 0.5 ? (outCz ? 1 : 0.9) : 0.72 - c;
  if (c < 0.3 && rng.chance(foulP)) return { kind: "foul", e: o.e, c, tip: c < 0.18 };

  const side = o.bats === "R" ? 1 : -1;
  let spray = (e / W) * 58 * side + o.at.x * 38 + rng.gauss() * (3 + 9 * (1 - c));
  // 높이: 높은 공일수록 뜸
  // 존 높이(0.43m)에 맞춘 기울기 — 존 위 끝 ≈ +13°, 아래 끝 ≈ -13°
  const base = 6 + (o.at.y - ZONE.mid) * 62 + rng.gauss() * 20;
  // 정타: 힘센 타자일수록 띄워서 담장 쪽 (힘 500 → 23° · 1000 → 29°)
  // 덜 정타면 라이너 쪽 (밋밋한 뜬공아웃 대신), 정타일수록 힘센 타자는 띄워서 담장 쪽
  const ideal = lerp(EV.laMid + rng.gauss() * EV.laSd, EV.la0 + (o.power / 1000) * EV.laPow + rng.gauss() * 5, Math.pow(pf, EV.laCurve));
  let la = lerp(base, ideal, Math.pow(c, 1.4));
  // 빗맞으면 위아래로 크게 (팝플라이 · 땅볼)
  if (c < 0.45 && rng.chance(0.5)) la += (rng() < 0.5 ? -1 : 1) * rng.range(15, 35) * (1 - c);
  const pm = o.pitch.kmh / 3.6;
  let ev = EV.base + Math.pow(c, 1.3) * (EV.c + (o.power / 1000) * EV.pow) + pm * 0.08 * c;
  ev += EV.pf * pf;
  // 컨택존 정가운데일수록 세게 (존 안에서만, 최대 +2.5m/s)
  if (dn < 1) ev += 2.5 * (1 - dn * dn) * c;

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
