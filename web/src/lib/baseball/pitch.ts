/**
 * 투구 궤적.
 *
 * 좌표 (m): x = 옆 (+ 는 포수가 봤을 때 오른쪽 = 1루 쪽), y = 높이, z = 홈플레이트까지 거리 (손에서 놓는 곳 ≈ 17m).
 * 공 하나 = 진행도 u(0 → 1)를 시간에 따라 움직이는 것. 보통 공은 일정한 속도, 마구는 구간마다 다르게(멈춤 · 되감기 …).
 * 시간은 "게임 초" — 난이도의 속도 배율(speedScale)이 이미 들어감 (화면에 보이는 km/h 는 실제 구속).
 *
 * 꺾임: 목표점 T 에 정확히 들어오도록, 처음엔 A = T − B 를 향해 날아가다가 B·u² 만큼 늦게 꺾임 (공이 끝에서 휘는 느낌).
 */
import type { CharId, Pitcher } from "./data";
import type { Rng } from "./rng";
import { clamp, lerp, smooth } from "./rng";

export type PitchKind = "FB" | "TS" | "SL" | "CT" | "CB" | "CH" | "FK" | "SK";

export interface PitchDef {
  id: PitchKind;
  name: string;
  short: string;
  /** 직구 대비 구속 */
  speed: number;
  /** 꺾임 (m): x 는 던지는 팔 쪽 +, y 는 위 + */
  bx: number;
  by: number;
  /** 꺾임이 얼마나 끝에 몰리는지 (u 의 지수) */
  late: number;
  color: string;
}

export const PITCHES: Record<PitchKind, PitchDef> = {
  FB: { id: "FB", name: "직구", short: "직", speed: 1, bx: 0.06, by: 0.06, late: 2, color: "#ffffff" },
  TS: { id: "TS", name: "투심", short: "투", speed: 0.97, bx: 0.22, by: -0.08, late: 2, color: "#d8f0ff" },
  SL: { id: "SL", name: "슬라이더", short: "슬", speed: 0.88, bx: -0.3, by: -0.12, late: 2.4, color: "#ffe28a" },
  CT: { id: "CT", name: "커터", short: "커터", speed: 0.94, bx: -0.13, by: -0.03, late: 2.6, color: "#fff3c4" },
  CB: { id: "CB", name: "커브", short: "커", speed: 0.77, bx: -0.18, by: -0.58, late: 1.7, color: "#9ad6ff" },
  CH: { id: "CH", name: "체인지업", short: "체", speed: 0.83, bx: 0.16, by: -0.3, late: 2.2, color: "#b6ffb0" },
  FK: { id: "FK", name: "포크", short: "포", speed: 0.86, bx: 0, by: -0.48, late: 2.8, color: "#ffb0d8" },
  SK: { id: "SK", name: "싱커", short: "싱", speed: 0.92, bx: 0.3, by: -0.26, late: 2.2, color: "#c9b8ff" },
};

/** 스트라이크 존 (공 반지름 포함 판정) */
/**
 * 스트라이크 존 (m): 폭 = 홈플레이트 43cm, 높이는 우리 2.5등신 타자 기준 무릎(0.47) ~ 어깨와 벨트 가운데(0.90) → 정사각형
 */
export const ZONE = { x: 0.215, y0: 0.47, y1: 0.9, mid: 0.685 };
export const BALL_R = 0.037;
export const inZone = (x: number, y: number) =>
  Math.abs(x) <= ZONE.x + BALL_R && y >= ZONE.y0 - BALL_R && y <= ZONE.y1 + BALL_R;

export const RELEASE_Z = 17;

export interface Pitch {
  kind: PitchKind;
  special?: CharId;
  /** 실제 구속 (전광판) */
  kmh: number;
  /** 놓는 순간부터 홈플레이트까지 (게임 초) */
  dur: number;
  /** 손에서 놓기 전 기모으기 등 (이 시간 동안 공이 손에 있음) — dur 에 포함 */
  release: { x: number; y: number };
  target: { x: number; y: number };
  brk: { x: number; y: number };
  late: number;
  /** 0 ~ 1 (게이지) */
  quality: number;
  /** 실투 (가운데로 몰림) */
  mistake: boolean;
  /** 마구 구간표 */
  tl?: Timeline;
  /** 마구별 난수 (이그나 가짜 불꽃 방향 등) */
  seed: number;
}

/** u(t) 구간표: [시작 t, 끝 t, 시작 u, 끝 u, 이징] */
type Seg = { t0: number; t1: number; u0: number; u1: number; ease?: "out" | "inout"; tag?: string };
export interface Timeline {
  segs: Seg[];
  dur: number;
}

const mps = (kmh: number) => kmh / 3.6;

function timeline(parts: ({ du: number; kmh: number; tag?: string } | { hold: number; tag?: string } | { to: number; sec: number; tag?: string })[], scale: number): Timeline {
  const segs: Seg[] = [];
  let t = 0;
  let u = 0;
  for (const p of parts) {
    if ("hold" in p) {
      const d = p.hold / scale;
      segs.push({ t0: t, t1: t + d, u0: u, u1: u, tag: p.tag });
      t += d;
    } else if ("du" in p) {
      const d = (p.du * RELEASE_Z) / mps(p.kmh) / scale;
      segs.push({ t0: t, t1: t + d, u0: u, u1: u + p.du, tag: p.tag });
      t += d;
      u += p.du;
    } else {
      const d = p.sec / scale;
      segs.push({ t0: t, t1: t + d, u0: u, u1: p.to, ease: "inout", tag: p.tag });
      t += d;
      u = p.to;
    }
  }
  return { segs, dur: t };
}

function seg(tl: Timeline, t: number): { u: number; s: Seg; k: number } {
  const segs = tl.segs;
  let s = segs[segs.length - 1];
  for (const x of segs) {
    if (t < x.t1) {
      s = x;
      break;
    }
  }
  const k = s.t1 > s.t0 ? clamp((t - s.t0) / (s.t1 - s.t0), 0, 1) : 1;
  const e = s.ease === "inout" ? smooth(0, 1, k) : k;
  return { u: lerp(s.u0, s.u1, e), s, k };
}

/** 투수 · 구종 · 목표 · 게이지 결과로 실제 공 만들기 */
export function makePitch(
  pitcher: Pitcher,
  o: { kind: PitchKind; target: { x: number; y: number }; quality: number; special?: CharId },
  speedScale: number,
  rng: Rng,
  stamina01 = 1
): Pitch {
  const def = PITCHES[o.kind];
  const q = clamp(o.quality, 0, 1);
  const tired = stamina01 < 0.25 ? (0.25 - stamina01) * 2 : 0; // 0 ~ 0.5
  const mistake = !o.special && q < 0.22;
  // 제구: 게이지가 나쁠수록 · 제구가 낮을수록 · 지칠수록 목표에서 벗어남
  const err = (1 - q) * 0.13 + (1 - pitcher.control / 1000) * 0.08 + tired * 0.12;
  let tx = o.target.x + rng.gauss() * err;
  let ty = o.target.y + rng.gauss() * err * 0.85;
  if (mistake) {
    // 실투: 한가운데로 밋밋하게
    tx = lerp(tx, 0, 0.7);
    ty = lerp(ty, ZONE.mid, 0.7);
  }
  if (o.special) {
    tx = o.target.x + rng.gauss() * 0.03;
    ty = o.target.y + rng.gauss() * 0.03;
  }
  const hand = pitcher.throws === "R" ? -1 : 1; // 우투수의 팔 쪽 = 포수 왼쪽(-x)
  const brkMul = (0.7 + (pitcher.brk / 1000) * 0.55) * (0.75 + q * 0.35) * (mistake ? 0.35 : 1);
  const velo = pitcher.velo * def.speed * (0.94 + q * 0.07) * (1 - tired * 0.12) * (mistake ? 0.96 : 1);
  const p: Pitch = {
    kind: o.kind,
    special: o.special,
    kmh: Math.round(velo),
    dur: RELEASE_Z / mps(velo) / speedScale,
    // 놓는 점 = 투구 그림(pitcher-throw) 공 놓는 손 자리 (세트 위치 투수판 위, 머리 위로 뻗은 손) — 손에서 바로 나가게
    release: { x: hand * 0.1, y: 1.62 },
    target: { x: tx, y: ty },
    brk: { x: hand * def.bx * brkMul, y: def.by * brkMul },
    late: def.late,
    quality: q,
    mistake,
    seed: rng(),
  };
  if (o.special) applySpecial(p, o.special, speedScale, rng);
  return p;
}

/** 마구 */
function applySpecial(p: Pitch, id: CharId, s: number, rng: Rng) {
  p.brk = { x: 0, y: 0 };
  switch (id) {
    case "kai":
      p.kmh = 172;
      p.tl = timeline([{ du: 1, kmh: 172 }], s);
      break;
    case "ivan": {
      p.kmh = 190;
      p.tl = timeline([{ hold: rng.range(0.35, 0.85), tag: "charge" }, { du: 1, kmh: 190 }], s);
      break;
    }
    case "igna":
      p.kmh = 175;
      p.tl = timeline([{ du: 0.35, kmh: 150 }, { hold: 0.3, tag: "hover" }, { du: 0.65, kmh: 175 }], s);
      break;
    case "soyoung":
      p.kmh = 176;
      p.tl = timeline([{ du: 0.42, kmh: 135 }, { hold: 0.42, tag: "loop" }, { du: 0.58, kmh: 176 }], s);
      break;
    case "lily":
      p.kmh = 150;
      p.tl = timeline([{ du: 0.82, kmh: 72, tag: "bubble" }, { du: 0.18, kmh: 150, tag: "pop" }], s);
      break;
    case "zena":
      p.kmh = 158;
      p.tl = timeline([{ du: 1, kmh: 140 }], s);
      break;
    case "gunmo":
      p.kmh = 151;
      p.tl = timeline([{ du: 1, kmh: 151 }], s);
      break;
    case "mei":
      p.kmh = 168;
      p.tl = timeline([{ du: 0.62, kmh: 128, tag: "split" }, { hold: 0.12, tag: "merge" }, { du: 0.38, kmh: 168 }], s);
      break;
    case "violet":
      p.kmh = 166;
      p.tl = timeline([{ du: 0.74, kmh: 138, tag: "hoop" }, { du: 0.26, kmh: 166 }], s);
      break;
  }
  if (p.tl) p.dur = p.tl.dur;
}

export interface BallView {
  x: number;
  y: number;
  z: number;
  /** 0 ~ 1 보이는 정도 */
  vis: number;
  /** 아직 손에 있음 */
  inHand: boolean;
  /** 진행도 */
  u: number;
  /** 마구 연출용 */
  tag?: string;
  tagK?: number;
  /** 가짜 공 (이그나) */
  ghosts?: { x: number; y: number; z: number; a: number }[];
  /** 바이올렛 후프 (공이 지나갈 자리) */
  hoop?: { x: number; y: number; z: number; a: number; spin: number };
}

function basePos(p: Pitch, u: number) {
  const A = { x: p.target.x - p.brk.x, y: p.target.y - p.brk.y };
  const b = Math.pow(clamp(u, 0, 1), p.late);
  return {
    x: lerp(p.release.x, A.x, u) + p.brk.x * b,
    y: lerp(p.release.y, A.y, u) + p.brk.y * b,
    z: RELEASE_Z * (1 - u),
  };
}

/** t 초(놓은 뒤)의 공. t 가 dur 를 넘으면 플레이트 너머(포수 미트)로 조금 더 */
export function pitchAt(p: Pitch, t: number): BallView {
  if (!p.tl) {
    const u = t / p.dur;
    const b = basePos(p, u);
    return { ...b, vis: 1, inHand: t < 0, u };
  }
  if (t >= p.dur) {
    const u = 1 + (t - p.dur) / (p.dur * 0.25);
    return { ...basePos(p, u), vis: 1, inHand: false, u };
  }
  const { u, s, k } = seg(p.tl, Math.max(0, t));
  const b = basePos(p, u);
  const v: BallView = { ...b, vis: 1, inHand: false, u, tag: s.tag, tagK: k };
  switch (p.special) {
    case "kai": {
      const r = 0.5 * Math.pow(1 - u, 1.3);
      const a = u * 22 + p.seed * 6;
      v.x += Math.cos(a) * r;
      v.y += Math.sin(a) * r * 0.7;
      break;
    }
    case "ivan":
      if (s.tag === "charge") v.inHand = true;
      break;
    case "igna": {
      if (u >= 0.34) {
        const side = p.seed < 0.5 ? 1 : -1;
        const spread = smooth(0.34, 0.52, u);
        const fade = 1 - smooth(0.86, 0.96, u);
        v.ghosts = [
          { x: v.x + 0.5 * spread * side, y: v.y + 0.12 * spread, z: v.z, a: fade },
          { x: v.x - 0.42 * spread * side, y: v.y - 0.18 * spread, z: v.z, a: fade },
        ];
      }
      if (s.tag === "hover") {
        v.x += Math.sin(t * 40) * 0.02;
      }
      break;
    }
    case "soyoung":
      if (s.tag === "loop") {
        const th = k * Math.PI * 2;
        const r = 0.42;
        v.x += Math.sin(th) * r * (p.seed < 0.5 ? 1 : -1);
        v.y += (1 - Math.cos(th)) * r * 0.9;
      }
      break;
    case "lily":
      if (s.tag === "bubble") {
        const w = 1 - smooth(0.7, 0.82, u);
        v.x += Math.sin(t * 5.2 + p.seed * 9) * 0.3 * w;
        v.y += Math.sin(t * 3.4 + p.seed * 5) * 0.2 * w;
      }
      // 퐁! 터지면 뚝 떨어짐
      v.y += 0.36 * (1 - smooth(0.82, 1, u));
      break;
    case "zena": {
      // 번쩍번쩍 순간이동: 구간마다 옆으로, 마지막엔 아래에서 솟아오름
      const side = p.seed < 0.5 ? 1 : -1;
      const segs: [number, number, number, number][] = [
        [0.12, 0.3, 0.6 * side, 0.1],
        [0.3, 0.48, -0.6 * side, -0.05],
        [0.48, 0.66, 0.45 * side, 0.2],
        [0.66, 0.84, -0.2 * side, -0.5],
      ];
      let ox = 0;
      let oy = 0;
      let blink = 1;
      for (const [a, b2, dx, dy] of segs) {
        if (u >= a && u < b2) {
          ox = dx;
          oy = dy;
          const edge = Math.min(u - a, b2 - u);
          blink = clamp(edge / 0.02, 0, 1);
        }
      }
      if (u >= 0.84) {
        // 솟아오르기 (치는 타이밍 신호)
        oy = -0.5 * (1 - smooth(0.84, 0.97, u));
        v.tag = "rise";
      }
      v.x += ox;
      v.y += oy;
      v.vis = 0.25 + 0.75 * blink;
      break;
    }
    case "gunmo": {
      // 사라짐 (가끔 깜빡 보임) — 화면 위 버퍼링 바가 u 를 보여 줌
      const hide = smooth(0.18, 0.26, u) * (1 - smooth(0.84, 0.9, u));
      const flick = Math.sin(t * 61 + p.seed * 50) > 0.93 ? 0.6 : 0;
      v.vis = clamp(1 - hide + flick * hide, 0, 1);
      v.tag = "buffer";
      v.tagK = clamp(u / 0.97, 0, 1);
      break;
    }
    case "mei": {
      // 만두 셋이 공 둘레를 빙글빙글 (진짜도 같이 돎) → 합쳐지며 김 퐁 → 곧장 들어옴
      if (s.tag === "split") {
        const open = smooth(0.04, 0.2, u) * (1 - smooth(0.5, 0.62, u));
        const r = 0.42 * open;
        const a0 = t * 9 + p.seed * 6;
        const pos = (k: number) => ({ x: Math.cos(a0 + (k * Math.PI * 2) / 3) * r, y: Math.sin(a0 + (k * Math.PI * 2) / 3) * r * 0.8 });
        const real = pos(0);
        v.ghosts = [1, 2].map((k) => ({ x: v.x + pos(k).x, y: v.y + pos(k).y, z: v.z, a: 1 }));
        v.x += real.x;
        v.y += real.y;
      }
      break;
    }
    case "violet": {
      // 후프 통과구: 한쪽으로 비켜 오다가 후프(u 0.74)를 지나는 순간 반대쪽으로 꺾여 들어옴
      const side = p.seed < 0.5 ? 1 : -1;
      const pass = smooth(0.7, 0.78, u);
      const after = -0.22 * side * (1 - smooth(0.8, 1, u));
      v.x += 0.34 * side * (1 - pass) + after * pass;
      v.y += 0.08 * Math.sin(u * Math.PI);
      const hb = basePos(p, 0.74);
      v.hoop = { x: hb.x, y: hb.y, z: hb.z, a: smooth(0.06, 0.2, u) * (1 - smooth(0.78, 0.86, u)), spin: t * 7 + p.seed * 6 };
      break;
    }
  }
  return v;
}

/** 공이 홈플레이트를 지나는 위치 (판정용) */
export const plateCross = (p: Pitch) => {
  const v = pitchAt(p, p.dur - 1e-6);
  return { x: v.x, y: v.y };
};

/** 구종 이름 (마구면 마구 이름) */
export function pitchLabel(p: Pitch, specialName?: string) {
  return p.special && specialName ? specialName : PITCHES[p.kind].name;
}
