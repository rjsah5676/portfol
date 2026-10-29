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

/** 빗맞은 파울 중 높이 떠서 공으로 굴리는 몫 · 그중 뒤(그물 쪽)로 가는 몫 · 속도 · 각도 */
export const FOUL_POP = { p: 0.6, back: 0.3, ev0: 16, evR: 14, la0: 48, laR: 34, side0: 50, sideR: 45 };

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
/** 컨택존 최소 크기 (스트라이크존 대비) — 타격 300 이하는 다 이 크기 (초반에 존이 너무 작아 맞히기 자체가 힘들었음) */
export const CZ_TUNE = { min: 0.34 };
export function contactZone(hit: number) {
  const k = clamp(0.34 + ((hit - 300) / 600) * 0.56, CZ_TUNE.min, 1);
  return { hw: (ZONE.x + BALL_R) * k, hh: ((ZONE.y1 - ZONE.y0) / 2 + BALL_R) * k };
}
/**
 * 컨택존 가운데가 움직일 수 있는 범위 (과하지 않게) — 좌우 ±0.14m · 위아래 ±0.12m (처음 범위의 70%).
 * 타자 그림은 화면에서 좌우 40px · 아래 34px 까지 (위로는 거의 안 움직임 — match.batterPos)
 */
export const CZ_RANGE = { x: 0.14, y0: ZONE.mid - 0.12, y1: ZONE.mid + 0.12 };
/** 컨택존 옮기는 속도 (m/s) — 투구 전 · 공이 날아오는 동안 (파란 원 따라가기) */
export const CZ_MOVE = { ready: 0.65, flight: 1 };
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
/** 덮어 친 땅볼 확률 (기본 + 일찍 휘두른 정도 + 낮은 공) × (1 − 정타 몫) · 그때 타구각 */
export const ROLL = { base: 0.22, early: 0.35, low: 0.2, pf: 0.85, la: -2, sd: 6 };
/** 필살타법 손잡이 (play.ts 의 수비 쪽 효과는 SP_FIELD) */
/**
 * 맞힌 공(앞으로 보낸 공) 하나의 득점가치를 다 0.64 ~ 0.71 로 (보통 스윙 0.19 · σ50ms) — 모양은 캐릭터마다 뚜렷하게:
 * 카이 2루타 · 이그나 강습 땅볼 → 장내 홈런 · 제나 단타 (안타율 최고) · 이반 홈런 아니면 범타 · 릴리 홈런 · 메이 고른 라이너
 * 소영 (아무 공이나 맞힘) · 바이올렛 (타이밍 반) 은 맞히기 쉬운 쪽이 특징 (scratchpad spsw2.ts)
 */
export const SP_TUNE = { kaiEv: 6.6, kaiLa: 13, ignaEv: 0.3, ignaLa: 0, soyEv: 2.1, ivanC: 0.92, ivanEv0: 47, ivanEvC: 8, ivanMiss: 14, meiEv: 9, meiLa: 13, zenaEv: -2, zenaLa: 3, violetEv: 6.8 };
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
  if (c < 0.3 && rng.chance(foulP)) {
    const tip = c < 0.18;
    // 빗맞아 높이 뜬 파울 (일부): 공으로 굴려서 관중석 앞이면 수비가 쫓아가 잡을 수 있게 (파울 플라이 아웃)
    if (!tip && rng.chance(FOUL_POP.p)) {
      const pull = (o.e < 0 ? -1 : 1) * (o.bats === "R" ? 1 : -1);
      const back = rng.chance(FOUL_POP.back);
      // 뒤(그물 쪽)로 간 건 더 높고 약하게 — 포수가 마스크 벗고 쫓는 공
      return {
        kind: "bip",
        e: o.e,
        ball: {
          ev: back ? 14 + rng() * 8 : FOUL_POP.ev0 + rng() * FOUL_POP.evR,
          la: back ? 66 + rng() * 18 : FOUL_POP.la0 + rng() * FOUL_POP.laR,
          spray: pull * (back ? 140 + rng() * 40 : FOUL_POP.side0 + rng() * FOUL_POP.sideR),
          c,
          perfect: false,
          bunt: false,
        },
      };
    }
    return { kind: "foul", e: o.e, c, tip };
  }

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
  // 덮어 친 땅볼: 일찍 휘두를수록 · 낮은 공일수록 · 덜 정타일수록 공 윗면을 때려 땅으로
  // (타구각이 10 ~ 25° 에 몰려 5 ~ 10° 낮은 라이너가 내야수 정면으로 잡히던 게 너무 많았음 — 땅볼은 너무 적고)
  const early = clamp(-e / W, 0, 1);
  const low = clamp((ZONE.mid - o.at.y) / 0.3, 0, 1);
  if (rng.chance((ROLL.base + early * ROLL.early + low * ROLL.low) * (1 - pf * ROLL.pf))) la = Math.min(la, ROLL.la + rng.gauss() * ROLL.sd);
  const pm = o.pitch.kmh / 3.6;
  let ev = EV.base + Math.pow(c, 1.3) * (EV.c + (o.power / 1000) * EV.pow) + pm * 0.08 * c;
  ev += EV.pf * pf;
  // 컨택존 정가운데일수록 세게 (존 안에서만, 최대 +2.5m/s)
  if (dn < 1) ev += 2.5 * (1 - dn * dn) * c;

  // 필살타법 (scratchpad spsw.ts 로 맞춤 — 예전엔 이반 홈런 91% · 이그나 안타 93% · 건모 84% 로 「치면 홈런」, 바이올렛 · 메이는 30 ~ 40% 로 약했음)
  //   목표: 안타 55 ~ 65%, 홈런은 힘 캐릭터(이반 · 릴리)만 30 ~ 40%
  switch (sp) {
    case "kai":
      // 질풍: 총알 라이너 → 외야 사이 2루타
      la = clamp(lerp(la, SP_TUNE.kaiLa, 0.6), SP_TUNE.kaiLa - 5, SP_TUNE.kaiLa + 5);
      ev += SP_TUNE.kaiEv;
      break;
    case "igna":
      // 업화: 불붙은 강습 땅볼 — 잡으려는 수비가 화상으로 놓침 (play.ts)
      la = clamp(lerp(la, SP_TUNE.ignaLa, 0.65), -10, 9);
      ev += SP_TUNE.ignaEv;
      break;
    case "soyoung":
      la = lerp(la, 24, 0.55);
      ev += SP_TUNE.soyEv;
      break;
    case "ivan":
      // 철곰: 제대로 맞으면 담장 너머 · 아니면 그냥 공 (모 아니면 도)
      if (c > SP_TUNE.ivanC) {
        ev = Math.max(ev, SP_TUNE.ivanEv0 + SP_TUNE.ivanEvC * c);
        la = clamp(lerp(la, 28, 0.6), 18, 38);
        spray = clamp(spray, -40, 40);
      } else ev -= SP_TUNE.ivanMiss;
      break;
    case "mei": {
      // 태극: 낮게 휘는 라이너로 수비 사이 빈틈 — 단타 제조기
      la = clamp(lerp(la, SP_TUNE.meiLa, 0.6), 3, SP_TUNE.meiLa + 6);
      const gaps = [-24, -9, 9, 24];
      const g = gaps.reduce((a, b) => (Math.abs(b - spray) < Math.abs(a - spray) ? b : a));
      spray = lerp(spray, g, 0.8) + rng.gauss() * 2;
      ev += SP_TUNE.meiEv;
      break;
    }
    case "zena":
      // 번개: 수비가 감전돼 느린 사이 — 짧은 타구도 다 살아나감 (단타 · 내야안타)
      la = clamp(lerp(la, SP_TUNE.zenaLa, 0.55), -6, 20);
      ev += SP_TUNE.zenaEv;
      break;
    case "violet":
      la = clamp(lerp(la, 15, 0.55), 6, 24);
      ev += SP_TUNE.violetEv;
      break;
    default:
      if (sp) ev += 2;
  }
  // 너무 옆이면 파울 — 공은 그대로 굴려서 라인 밖 큰 타구 · 잡히는 파울 플라이도 보여 줌 (play.ts)
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
