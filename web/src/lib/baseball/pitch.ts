/**
 * 투구 궤적.
 *
 * 좌표 (m): x = 옆 (+ 는 포수가 봤을 때 오른쪽 = 1루 쪽), y = 높이, z = 홈플레이트까지 거리 (손에서 놓는 곳 ≈ 17m).
 * 공 하나 = 진행도 u(0 → 1)를 시간에 따라 움직이는 것. 보통 공은 일정한 속도, 마구는 구간마다 다르게(멈춤 · 되감기 …).
 * 시간은 "게임 초" — 난이도의 속도 배율(speedScale)이 이미 들어감 (화면에 보이는 km/h 는 실제 구속).
 *
 * 궤적 = 물리 (PITCHf/x 9-파라미터 모델): p(t) = p0 + v0·t + ½·a·t², a = 중력 + 마그누스(회전).
 *   목표점 T 에 정확히 들어오게 v0 를 풂 (투수가 조준하는 것과 같음) → 손 → 목표 직선(현)에서 벗어난 만큼이 「변화」.
 *   u = t / 비행시간 으로 쓰면 위치 = lerp(손, 목표, u) + ½A·(u² − u)  (A = a·T², 진짜 비행시간 기준이라 난이도 속도와 무관)
 *   - 중력 낙차(drop): 모든 공 (커브는 손에서 먼저 떠올랐다가 떨어지는 「낙차」, 직구도 끝이 살짝 가라앉음)
 *   - 회전 변화(brk): 구종별 Statcast 평균 움직임 × 게임 과장(MOVE_GAIN) × 투수 변화 · 게이지 — 지수 late 로 「터널 뒤 늦게 꺾임」 조절
 *   변위가 t² 에 비례하니 처음엔 거의 일직선이고 막판에 꺾여 보이는 게 물리적으로도 맞음.
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
  /** 회전 변화 (m, 비행 끝에서 「회전 없는 공」 대비 — Statcast 구종 평균 움직임): x 는 던지는 팔 쪽 +, y 는 위 + (직구는 떠오르는 회전) */
  bx: number;
  by: number;
  /** 회전 변화 모양 L: 목표 직선에서 brk·(u^L − u). 2 = 물리, 클수록 막판에 몰려 꺾임 (한 방향으로만 휨) */
  late: number;
  /** 유인구는 낮게 던지는 구종 (떨어지는 공) */
  low?: boolean;
  color: string;
}

export const PITCHES: Record<PitchKind, PitchDef> = {
  // Statcast 평균 (인치 → m): 포심 팔쪽 8 · 위 16 / 투심 15 · 8 / 슬라이더 글러브쪽 6 · 2 / 커터 2.5 · 8 / 커브 9 · −10 / 체인지업 14 · 6 / 스플리터 10 · 3 / 싱커 15 · 7
  // 직구는 「곧게」 읽혀야 해서 좌우는 과장(MOVE_GAIN.x) 뒤에도 실제 크기쯤 (0.08 × 2.5 ≈ 실제 0.19m)
  FB: { id: "FB", name: "직구", short: "직", speed: 1, bx: 0.08, by: 0.41, late: 2, color: "#ffffff" },
  TS: { id: "TS", name: "투심", short: "투", speed: 0.97, bx: 0.38, by: 0.2, late: 2.2, color: "#d8f0ff" },
  SL: { id: "SL", name: "슬라이더", short: "슬", speed: 0.88, bx: -0.15, by: 0.05, late: 2.6, color: "#ffe28a" },
  CT: { id: "CT", name: "커터", short: "커터", speed: 0.94, bx: -0.06, by: 0.2, late: 2.4, color: "#fff3c4" },
  CB: { id: "CB", name: "커브", short: "커", speed: 0.77, bx: -0.23, by: -0.25, late: 2.4, color: "#9ad6ff", low: true },
  CH: { id: "CH", name: "체인지업", short: "체", speed: 0.83, bx: 0.36, by: 0.15, late: 2.5, color: "#b6ffb0", low: true },
  FK: { id: "FK", name: "포크", short: "포", speed: 0.86, bx: 0.1, by: 0.03, late: 2.5, color: "#ffb0d8", low: true },
  SK: { id: "SK", name: "싱커", short: "싱", speed: 0.92, bx: 0.38, by: 0.12, late: 2.3, color: "#c9b8ff", low: true },
};
/**
 * 게임 과장 (튜닝 손잡이): 실제 움직임은 작은 화면 · 짧은 시간에 잘 안 읽혀서 회전 변화만 키움 (중력은 그대로).
 *   x = 좌우 (슬라이더 · 투심), y = 위아래 (직구 떠오르는 힘 · 커브 낙차)
 */
export const MOVE_GAIN = { x: 2.5, y: 1.8, g: 0.7 };
/** 공 놓는 높이 (m) — 2.5등신 비율 (존 무릎 0.47 ~ 어깨 0.9)에 맞춘 값, 타석 화면 눈높이와 같음 (view.ts BC.camH) */
export const RELEASE_H = 1.0555;
const GRAV = 9.8;

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
  /** 회전 변화 (m, ½·a·T²) — 목표 직선에서 (u^late − u^(late−1)) 만큼 */
  brk: { x: number; y: number };
  late: number;
  /** 중력 낙차 (m, ½·g·T²) — 목표 직선 위로 drop·(u − u²) (손에서 나와 떠올랐다 떨어지는 포물선) */
  drop: number;
  /** 0 ~ 1 (게이지) */
  quality: number;
  /** 실투 (가운데 느린 직구) — 게이지가 바닥이거나, 제구 · 체력에 따라 가끔 손에서 빠짐 */
  mistake: boolean;
  /** 구위 (변화 · 구속 능력치) — 높을수록 정타가 덜 나옴 (contact.swing 이 맞은 정도에서 뺌) */
  stuff: number;
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

/** 진짜 비행시간² 비율 (그 구종 평균 구속 대비) — 느리게 던지면 회전 변화가 더 큼 */
const tSq = (kmh: number, speed: number) => Math.pow((145 * speed) / kmh, 2);

/** 투수 · 구종 · 목표 · 게이지 결과로 실제 공 만들기 */
/** 실투 확률 (공 하나): 기본 2% + 제구가 낮을수록 (제구 0 → +4%) + 체력 30% 밑으로 지칠수록 (바닥 → +9%) */
export const mistakeChance = (control: number, stamina01: number) =>
  0.02 + (1 - clamp(control, 0, 1000) / 1000) * 0.04 + Math.max(0, 0.3 - stamina01) * 0.3;

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
  // 실투: 게이지 바닥 · 또는 제구가 낮고 지칠수록 가끔 손에서 빠짐 (마구마구식 「!」)
  const mistake = !o.special && (q < 0.22 || rng() < mistakeChance(pitcher.control, stamina01));
  // 제구: 게이지가 나쁠수록 · 제구가 낮을수록 · 지칠수록 목표에서 벗어남 (제구 300 ≈ 12cm · 900 ≈ 4cm, 게이지 0.7 기준)
  const err = (1 - q) * 0.1 + (1 - pitcher.control / 1000) * 0.14 + tired * 0.12;
  let tx = o.target.x + rng.gauss() * err;
  let ty = o.target.y + rng.gauss() * err * 0.85;
  if (mistake) {
    // 실투: 한가운데 근처로 밋밋한 느린 직구
    tx = lerp(tx, 0, 0.85) + rng.gauss() * 0.03;
    ty = lerp(ty, ZONE.mid, 0.85) + rng.gauss() * 0.03;
  }
  if (o.special) {
    tx = o.target.x + rng.gauss() * 0.03;
    ty = o.target.y + rng.gauss() * 0.03;
  }
  // 손(화면 눈높이 RELEASE_H)보다 높게 끝나는 공은 직선이어도 화면에서 떠오를 수밖에 없어서 그 아래로 (존 위로 공 1.5개쯤까지)
  ty = Math.min(ty, RELEASE_H - 0.015);
  const hand = pitcher.throws === "R" ? -1 : 1; // 우투수의 팔 쪽 = 포수 왼쪽(-x)
  const brkMul = (0.7 + (pitcher.brk / 1000) * 0.55) * (0.75 + q * 0.35) * (mistake ? 0.1 : 1);
  const velo = mistake ? pitcher.velo * 0.9 * (1 - tired * 0.12) : pitcher.velo * def.speed * (0.94 + q * 0.07) * (1 - tired * 0.12);
  // 구위: 변화 500 · 구속 140 기준 ±, 실투는 0
  const stuff = mistake ? 0 : clamp((pitcher.brk - 500) / 500, -1, 1) * 0.06 + clamp((pitcher.velo - 140) / 25, -1, 1) * 0.05;
  const p: Pitch = {
    kind: o.kind,
    special: o.special,
    kmh: Math.round(velo),
    dur: RELEASE_Z / mps(velo) / speedScale,
    // 놓는 점 = 투구 그림(pitcher-throw) 공 놓는 손 자리 (세트 위치 투수판 위, 머리 위로 뻗은 손) — 손에서 바로 나가게
    release: { x: hand * 0.1, y: RELEASE_H },
    target: { x: tx, y: ty },
    // 회전 변화는 진짜 비행시간 기준 (구속이 느리면 더 많이 휨: a 고정 · 변위 ∝ T²). 기준 = 그 구종 평균 구속(직구 145 × speed)
    brk: { x: hand * def.bx * MOVE_GAIN.x * brkMul * tSq(velo, def.speed), y: def.by * MOVE_GAIN.y * brkMul * tSq(velo, def.speed) },
    late: def.late,
    drop: 0.5 * GRAV * MOVE_GAIN.g * Math.pow(RELEASE_Z / mps(velo), 2),
    quality: q,
    mistake,
    stuff,
    seed: rng(),
  };
  if (!o.special) limitShape(p, def);
  if (o.special) applySpecial(p, o.special, speedScale, rng);
  return p;
}

/**
 * 화면에서 어색한 움직임 막기 (scripts/baseball-pitch-audit.ts 로 구종 × 위치 × 능력치 전부 던져 보고 정한 한도).
 * 눈높이 = 손 높이라 「공이 손보다 높이 가면」 화면에서 떠오름 → 위아래 변화 · 중력을 그 안으로 줄임 (커브만 살짝 솟는 낙차)
 * 좌우는 휘는 반대쪽으로 갔다 되돌아오면 「몸쪽으로 오다 빠짐」 → 직구 계열은 없게, 변화구는 공 1.5개까지
 * 둘 다 넘으면 그 공의 변화를 그만큼만 줄임 (위치 · 구종에 따라 덜 휨)
 */
/** 회전 변화 최대 (m) — 느린 공일수록 더 휘는 몫 × 게임 과장이 겹쳐 체인지업 등이 1m 넘게 휘던 것 */
export const BRK_MAX = { x: 0.65, y: 0.6 };
function limitShape(p: Pitch, def: PitchDef) {
  p.brk.x = Math.max(-BRK_MAX.x, Math.min(BRK_MAX.x, p.brk.x));
  p.brk.y = Math.max(-BRK_MAX.y, Math.min(BRK_MAX.y, p.brk.y));
  const N = 40;
  const at = (u: number) => basePos(p, u);
  // 0 ~ 1 사이 가장 큰 배율 k (k 1 이면 그대로) — 배율이 작을수록 덜 휨 (k 0 = 직선, 늘 통과)
  const fit = (apply: (k: number) => void, ok: () => boolean) => {
    apply(1);
    if (ok()) return;
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) {
      const m = (lo + hi) / 2;
      apply(m);
      if (ok()) lo = m;
      else hi = m;
    }
    apply(lo);
  };
  // 위아래: 손(= 화면 눈높이) 위로 안 올라감 (커브만 5cm 솟는 낙차) + 한 번 내려오기 시작하면 다시 안 올라감 (막판 떠오름 없음)
  const rise = def.id === "CB" ? 0.05 : 0.002;
  const by0 = p.brk.y, dr0 = p.drop;
  fit(
    (k) => {
      p.brk.y = by0 * k;
      p.drop = dr0 * k;
    },
    () => {
      let low = Infinity;
      for (let i = 0; i <= N; i++) {
        const y = at(i / N).y;
        if (y > p.release.y + rise) return false;
        if (y > low + 0.004) return false;
        low = Math.min(low, y);
      }
      return true;
    }
  );
  // 좌우: 휘는 반대쪽으로 「잘못 가는」 거리 — 직구 계열 0 (곧게 읽혀야) · 변화구 공 1.5개(6cm, 프론트도어 · 백도어)
  const back = def.id === "FB" || def.id === "TS" || def.id === "SK" || def.id === "CT" ? 0.003 : 0.06;
  const bx0 = p.brk.x;
  fit(
    (k) => (p.brk.x = bx0 * k),
    () => {
      const sgn = Math.sign(p.brk.x);
      const x0 = p.release.x;
      const x1 = p.target.x;
      // 손 → 목표 사이 구간 밖으로, 휘는 반대쪽으로 벗어난 만큼
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      for (let i = 0; i <= N; i++) {
        const x = at(i / N).x;
        const out = sgn > 0 ? lo - x : x - hi;
        if (out > back) return false;
      }
      return true;
    }
  );
}

/** 마구 */
function applySpecial(p: Pitch, id: CharId, s: number, rng: Rng) {
  p.brk = { x: 0, y: 0 };
  p.drop = 0;
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
  // 회전 변화: 목표 직선에서 brk·(u^L − u) — 한 방향으로만 휘고(변곡 없음) L 이 클수록 막판에 몰려 꺾임 · 끝(u 1)에서 0
  // (u^L − u^(L−1) 「처음 직선」 모양은 중간에 휘는 방향이 뒤집혀 화면에서 S자로 보였음)
  const uc = clamp(u, 0, 1);
  const b = Math.pow(uc, p.late) - uc + Math.max(0, u - 1) * (p.late - 1);
  // 중력: drop·(u − u²) 물리 그대로
  const g = (p.drop ?? 0) * (u <= 1 ? uc - uc * uc : -(u - 1));
  return {
    x: lerp(p.release.x, p.target.x, u) + p.brk.x * b,
    y: lerp(p.release.y, p.target.y, u) + p.brk.y * b + g,
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
