/**
 * 인플레이 타구 → 수비 · 주루 시뮬 (1/60초 단위). 결과(아웃 · 진루 · 득점)와 재생용 프레임을 같이 만듦.
 *
 * 좌표 (m): 홈플레이트 (0,0), +y 가 중견수 쪽, +x 가 1루(우익수) 쪽. h = 높이.
 * 1. 타구를 물리로 끝까지 미리 굴려 봄 (중력 · 공기저항 · 바운드 · 펜스) → 홈런 · 파울 판정
 * 2. 수비수마다 "가장 빨리 공에 닿는 순간"을 계산 → 제일 빠른 사람이 쫓고, 나머지는 베이스 커버
 * 3. 잡으면(뜬공이면 아웃) 아웃 잡을 수 있는 베이스로 송구 → 포스 · 태그 아웃, 병살 연결
 * 4. 주자는 공이 그 베이스에 갈 시간과 내가 뛸 시간을 비교해 한 베이스씩 더 갈지 정함
 */
import type { BattedBall } from "./contact";
import type { Rng } from "./rng";
import { clamp } from "./rng";

export const DT = 1 / 60;
const BASE_LEN = 27.43;
const B: [number, number][] = [
  [0, 0],
  [19.4, 19.4],
  [0, 38.8],
  [-19.4, 19.4],
  [0, 0],
];
export const BASES = B;
/** 수비 위치: 0 투수 1 포수 2 1루 3 2루 4 3루 5 유격 6 좌익 7 중견 8 우익 */
export const HOME_POS: [number, number][] = [
  [0, 18.4],
  [0, -1.6],
  [17, 26],
  [9, 39],
  [-17, 26],
  [-9.5, 39],
  [-32, 78],
  [0, 92],
  [32, 78],
];
export const POS_NAME = ["투수", "포수", "1루수", "2루수", "3루수", "유격수", "좌익수", "중견수", "우익수"];

/** 외야수 기본 달리기 (m/s, 수비 500 이면 +0.8) — 얕은 뜬공 · 빗맞은 라이너가 다 안타가 되지 않게 */
const OF_SPEED = 6.4;
/** 주자 달리기 (m/s): 주루 300 → 7.36 · 500 → 7.8 · 900 → 8.68 (주루가 2 · 3루타 · 내야안타에 잘 드러나게) */
export const runSpeed = (run: number) => 6.7 + (run / 1000) * 2.2;
export const FENCE_H = 3.2;
/** 펜스까지 거리 (방향 ° 기준: 좌우 파울폴 98m · 가운데 118m) */
export const fenceDist = (phiDeg: number) => 98 + 20 * Math.cos(clamp(phiDeg, -45, 45) * 2 * (Math.PI / 180));

export interface FieldRunner {
  id: number;
  /** 지금 있는 베이스 (1 · 2 · 3) */
  base: number;
  run: number;
}

export interface FieldIn {
  ball: BattedBall;
  /** 1 · 2 · 3루 주자 (없으면 null) */
  bases: (FieldRunner | null)[];
  batter: { id: number; run: number };
  outs: number;
  /** 수비수 9명 수비 능력치 */
  def: number[];
}

export interface Frame {
  t: number;
  bx: number;
  by: number;
  bh: number;
  /** 공을 든 수비수 (-1 이면 공이 날아다님) */
  hold: number;
  fx: Float32Array; // 9 × (x, y)
  fs: Uint8Array; // 9 × 상태 (0 보통 · 1 기절 · 2 멈춤 · 3 감전)
  rs: { id: number; x: number; y: number; st: number }[]; // st 0 뜀 · 1 섬 · 2 아웃 · 3 득점
}

export interface FieldEvent {
  t: number;
  kind: "catch" | "dive" | "out" | "safe" | "run" | "hr" | "stun" | "wall" | "throw" | "freeze" | "shock";
  x: number;
  y: number;
  text: string;
}

export type BatterResult = "HR" | "1B" | "2B" | "3B" | "IPHR" | "OUT" | "FC" | "SF" | "SH" | "DP" | "FOUL";

export interface FieldOut {
  foul: boolean;
  hr: boolean;
  /** 타구 비거리 (첫 낙하 · 펜스 넘은 거리) */
  dist: number;
  frames: Frame[];
  events: FieldEvent[];
  outs: number;
  runs: number;
  /** 홈 밟은 주자 id */
  scored: number[];
  /** 새 1 · 2 · 3루 (주자 id) */
  bases: (number | null)[];
  result: BatterResult;
  label: string;
  /** 타점 */
  rbi: number;
  /** 잡은 · 처리한 수비수 */
  fielder: number;
}

interface BallPt {
  x: number;
  y: number;
  h: number;
  air: boolean;
  t: number;
}

/** 1. 타구 굴려 보기 */
export function predictBall(b: BattedBall): { pts: BallPt[]; hr: boolean; foul: boolean; land: number; wallHit: boolean } {
  const la = (b.la * Math.PI) / 180;
  const sp = (b.spray * Math.PI) / 180;
  let vx = b.ev * Math.cos(la) * Math.sin(sp);
  let vy = b.ev * Math.cos(la) * Math.cos(sp);
  let vh = b.ev * Math.sin(la);
  let x = 0;
  let y = 0.8;
  let h = 0.9;
  const g = b.special === "lily" ? 5.6 : 9.8;
  const k = b.special === "lily" ? 0.0026 : 0.0042;
  let air = true;
  let land = -1;
  let wallHit = false;
  const pts: BallPt[] = [];
  let foul = false;
  let fairDecided = false;
  for (let i = 0; i < 60 * 14; i++) {
    const t = i * DT;
    pts.push({ x, y, h, air, t });
    const v = Math.hypot(vx, vy, vh);
    if (h > 0 || vh > 0) {
      vx -= k * v * vx * DT;
      vy -= k * v * vy * DT;
      vh -= (g + k * v * vh) * DT;
    }
    x += vx * DT;
    y += vy * DT;
    h += vh * DT;
    const r = Math.hypot(x, y);
    const phi = (Math.atan2(x, y) * 180) / Math.PI;
    // 펜스
    if (Math.abs(phi) <= 46 && r >= fenceDist(phi)) {
      if (h > FENCE_H && air) {
        pts.push({ x, y, h, air, t: t + DT });
        // 담장 넘어 떨어질 때까지 (비거리)
        for (let j = 0; j < 400 && h > 0; j++) {
          const v2 = Math.hypot(vx, vy, vh);
          vx -= k * v2 * vx * DT;
          vy -= k * v2 * vy * DT;
          vh -= (g + k * v2 * vh) * DT;
          x += vx * DT;
          y += vy * DT;
          h += vh * DT;
          pts.push({ x, y, h: Math.max(h, 0), air: true, t: t + (j + 2) * DT });
        }
        return { pts, hr: true, foul: false, land: Math.hypot(x, y), wallHit: false };
      }
      // 펜스 맞고 튕김
      const nx = x / r;
      const ny = y / r;
      const vr = vx * nx + vy * ny;
      if (vr > 0) {
        vx -= 1.4 * vr * nx;
        vy -= 1.4 * vr * ny;
        vx *= 0.6;
        vy *= 0.6;
        wallHit = true;
        if (air) {
          air = false;
          if (land < 0) land = r;
        }
      }
    }
    if (h <= 0) {
      if (air) {
        air = false;
        land = r;
        // 뜬공 · 라이너가 떨어진 곳으로 파울 판정 (내야 안쪽에 떨어지면 굴러가서 정함)
        if (r >= 26) {
          fairDecided = true;
          foul = Math.abs(phi) > 45;
        }
      }
      h = 0;
      if (vh < -1.6) {
        // 낮게 깔려 튀는 땅볼은 속도를 덜 잃음 (높이 떠서 꽂힌 공만 크게 죽음)
        const keep = -vh < 0.6 * Math.hypot(vx, vy) ? 0.86 : 0.7;
        vh = -vh * 0.36;
        vx *= keep;
        vy *= keep;
      } else {
        vh = 0;
        const s = Math.hypot(vx, vy);
        const dec = (Math.hypot(x, y) > 32 ? 3.0 : 4.2) * DT;
        if (s <= dec) {
          vx = 0;
          vy = 0;
        } else {
          vx -= (vx / s) * dec;
          vy -= (vy / s) * dec;
        }
      }
    }
    if (!fairDecided && !air) {
      if (r >= 26 || (vx === 0 && vy === 0)) {
        fairDecided = true;
        foul = Math.abs(phi) > 45 || y < -0.5;
      }
    }
    if (foul) {
      return { pts, hr: false, foul: true, land, wallHit };
    }
    if (!air && vx === 0 && vy === 0 && h === 0) {
      pts.push({ x, y, h, air, t: t + DT });
      break;
    }
  }
  if (land < 0) land = Math.hypot(x, y);
  return { pts, hr: false, foul, land, wallHit };
}

interface Fielder {
  x: number;
  y: number;
  speed: number;
  arm: number;
  tx: number;
  ty: number;
  /** 이 시각부터 움직임 */
  goAt: number;
  stunUntil: number;
  /** 공을 들었을 때 던질 수 있는 시각 */
  readyAt: number;
  role: "chase" | "cover" | "backup" | "idle";
  coverBase: number;
}

interface Runner {
  id: number;
  isBatter: boolean;
  from: number;
  s: number;
  target: number;
  speed: number;
  st: "run" | "stand" | "out" | "scored";
  forced: boolean;
  /** 뜬공 잡히기 전 (베이스에서 기다림) */
  waitFly: boolean;
  scoredAt: number;
}

const pathPos = (s: number): [number, number] => {
  const i = clamp(Math.floor(s), 0, 3);
  const k = clamp(s - i, 0, 1);
  const a = B[i];
  const b = B[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
};
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** 방향 이름 */
function dirName(spray: number) {
  if (spray < -32) return "좌익수";
  if (spray < -14) return "좌중간";
  if (spray <= 14) return "중견수";
  if (spray <= 32) return "우중간";
  return "우익수";
}

export function simulatePlay(inp: FieldIn, rng: Rng): FieldOut {
  const pred = predictBall(inp.ball);
  const { pts } = pred;
  const ball = inp.ball;
  const sp = ball.special;
  if (pred.foul) {
    return {
      foul: true, hr: false, dist: pred.land, frames: [], events: [], outs: 0, runs: 0, scored: [],
      bases: inp.bases.map((r) => r?.id ?? null), result: "FOUL", label: "파울", rbi: 0, fielder: -1,
    };
  }

  // 필살타법 효과
  const freezeUntil = sp === "gunmo" ? 1.5 : 0;
  const slowUntil = sp === "zena" ? 2.0 : 0;
  const reactAdd = sp === "kai" ? 0.45 : 0;

  const F: Fielder[] = HOME_POS.map(([x, y], i) => {
    const d = inp.def[i] ?? 500;
    return {
      x, y,
      speed: (i === 1 ? 5.4 : i === 0 ? 5.8 : i >= 6 ? OF_SPEED : 5.9) + (d / 1000) * 1.6,
      arm: (i >= 6 ? 23 : 27) + (d / 1000) * 9,
      tx: x, ty: y,
      goAt: 0.2 + (1 - d / 1000) * 0.15 + reactAdd
        // 땅볼: 투수는 투구 마무리 동작 때문에 늦고, 내야수는 첫발 · 옆걸음이라 생각보다 못 닿음
        + (ball.la < 10 ? (i === 0 ? 0.15 : 0) : 0),
      stunUntil: 0, readyAt: 0, role: "idle", coverBase: -1,
    };
  });
  const speedAt = (f: Fielder, t: number) => {
    if (t < Math.max(f.goAt, freezeUntil) || t < f.stunUntil) return 0;
    return f.speed * (t < slowUntil ? 0.5 : 1);
  };
  /** 지금(t0)부터 거리 d 를 뛰는 데 걸리는 시간 */
  const runTime = (f: Fielder, d: number, t0: number) => {
    let t = Math.max(t0, f.goAt, freezeUntil, f.stunUntil);
    if (t < slowUntil) {
      const slowDist = (slowUntil - t) * f.speed * 0.5;
      if (d <= slowDist) return t + d / (f.speed * 0.5) - t0;
      d -= slowDist;
      t = slowUntil;
    }
    return t + d / f.speed - t0;
  };

  // 팔 닿는 거리: 땅볼은 글러브를 바닥에 대야 해서 짧음
  const REACH = ball.la < 10 ? 1.0 : 1.15;
  const CATCH_H = 2.45;

  /** 수비수 f 가 t0 이후 공을 처음 잡을 수 있는 점 */
  function intercept(f: Fielder, fromIdx: number, t0: number, reach = REACH) {
    for (let i = fromIdx; i < pts.length; i++) {
      const p = pts[i];
      if (p.h > CATCH_H) continue;
      const d = Math.max(0, dist(f.x, f.y, p.x, p.y) - reach);
      if (runTime(f, d, t0) + t0 <= p.t + 1e-6) return i;
    }
    return pts.length - 1;
  }

  // 2. 누가 쫓나
  const events: FieldEvent[] = [];
  let chaser = -1;
  let chaseIdx = pts.length;
  let diveCatch = false;
  const assignChaser = (fromIdx: number, t0: number, exclude: number[] = []) => {
    chaser = -1;
    chaseIdx = pts.length * 2;
    for (let i = 0; i < 9; i++) {
      if (exclude.includes(i)) continue;
      const f = F[i];
      // 포수는 앞쪽 짧은 타구만
      if (i === 1 && pts[Math.min(pts.length - 1, fromIdx + 40)].y > 20) continue;
      const k = intercept(f, fromIdx, t0);
      // 포수 · 투수는 같은 거리면 야수에게 양보
      const bias = i <= 1 ? 6 : 0;
      if (k + bias < chaseIdx) {
        chaseIdx = k + bias;
        chaser = i;
      }
    }
    if (chaser >= 0) {
      chaseIdx = intercept(F[chaser], fromIdx, t0);
      const p = pts[Math.min(chaseIdx, pts.length - 1)];
      F[chaser].role = "chase";
      F[chaser].tx = p.x;
      F[chaser].ty = p.y;
    }
  };
  assignChaser(0, 0);
  // 다이빙 캐치 (필살수비): 뜬 채로는 못 잡는데 몸을 날리면 닿는 경우
  const firstLandIdx = pts.findIndex((p) => !p.air);
  if (chaser >= 0 && firstLandIdx > 0 && chaseIdx > firstLandIdx && sp !== "kai") {
    let best = -1;
    let bestIdx = 0;
    for (let i = 2; i < 9; i++) {
      for (let k = Math.max(0, firstLandIdx - 20); k < firstLandIdx; k++) {
        const p = pts[k];
        if (p.h > CATCH_H) continue;
        const d = Math.max(0, dist(F[i].x, F[i].y, p.x, p.y) - REACH - 2.0);
        if (runTime(F[i], d, 0) <= p.t) {
          best = i;
          bestIdx = k;
          break;
        }
      }
      if (best >= 0) break;
    }
    if (best >= 0 && rng.chance(0.18 + ((inp.def[best] ?? 500) / 1000) * 0.3)) {
      if (chaser !== best) F[chaser].role = "idle";
      chaser = best;
      chaseIdx = bestIdx;
      diveCatch = true;
      F[best].role = "chase";
      F[best].tx = pts[bestIdx].x;
      F[best].ty = pts[bestIdx].y;
    }
  }
  const flyCatchPredicted = () => chaser >= 0 && chaseIdx < pts.length && pts[Math.min(chaseIdx, pts.length - 1)].air;

  // 베이스 커버
  const coverOf: number[] = [-1, -1, -1, -1];
  const setCover = () => {
    const left = ball.spray < 0;
    const want: [number, number[]][] = [
      [1, [2, 0, 3]],
      [2, left ? [3, 5] : [5, 3]],
      [3, [4, 5]],
      [0, [1, 0]],
    ];
    const used = new Set<number>([chaser]);
    for (const [b, cands] of want) {
      const c = cands.find((i) => !used.has(i));
      if (c === undefined) continue;
      used.add(c);
      coverOf[b] = c;
      F[c].role = "cover";
      F[c].coverBase = b;
      F[c].tx = B[b][0] + (b === 1 ? -0.6 : b === 3 ? 0.6 : 0);
      F[c].ty = B[b][1] + (b === 0 ? -0.5 : 0);
    }
    for (let i = 6; i < 9; i++) {
      if (i === chaser || used.has(i)) continue;
      const lp = pts[Math.min(pts.length - 1, Math.max(firstLandIdx, 0))];
      F[i].role = "backup";
      F[i].tx = F[i].x + (lp.x - F[i].x) * 0.45;
      F[i].ty = F[i].y + (lp.y - F[i].y) * 0.45;
    }
  };
  setCover();

  // 주자
  const R: Runner[] = [];
  const bat: Runner = {
    id: inp.batter.id, isBatter: true, from: 0, s: 0, target: 1,
    // 출발 · 스윙 뒤 균형 흔들림 (같은 발이라도 타석마다 조금씩 다름 → 내야안타가 문턱이 아니라 확률로)
    speed: (runSpeed(inp.batter.run)) * (ball.bunt ? 1.04 : 1) * (1 + Math.max(-0.08, Math.min(0.08, rng.gauss() * 0.04))),
    st: "run", forced: true, waitFly: false, scoredAt: -1,
  };
  R.push(bat);
  for (let b = 1; b <= 3; b++) {
    const r = inp.bases[b - 1];
    if (!r) continue;
    let forced = true;
    for (let k = 1; k < b; k++) if (!inp.bases[k - 1]) forced = false;
    R.push({
      id: r.id, isBatter: false, from: b, s: b, target: forced ? b + 1 : b,
      speed: runSpeed(r.run), st: forced ? "run" : "stand", forced, waitFly: false, scoredAt: -1,
    });
  }
  const twoOuts = inp.outs >= 2;
  // 뜬공 예상: 2아웃 아니면 베이스에서 기다림
  if (flyCatchPredicted() && !twoOuts) {
    for (const r of R) {
      if (r.isBatter) continue;
      r.waitFly = true;
      r.target = r.from;
      r.st = "stand";
    }
  }

  let outs = inp.outs;
  const scoredIds: number[] = [];
  let ballHolder = -1;
  let bx = pts[0].x;
  let by = pts[0].y;
  let bh = pts[0].h;
  let ballIdx = 0;
  let caught = false;
  let lastOutForce = false;
  type Throw = { from: [number, number, number]; to: number; t0: number; t1: number; base: number; receiver: number };
  let thrown = null as Throw | null;
  let fielded = false;
  let fielder = -1;
  let extraFrames = 0;
  let batMax = 0;
  let ended = false;
  let stunDone = sp !== "igna";

  /** 공이 베이스 b 에 닿는 예상 시각 */
  const ballEta = (b: number, now: number) => {
    const [x, y] = B[b];
    if (ballHolder >= 0) {
      const f = F[ballHolder];
      const own = dist(f.x, f.y, x, y);
      return Math.max(now, f.readyAt) + Math.min(own / f.speed, (ballHolder >= 6 ? 0.5 : 0.3) + own / f.arm);
    }
    if (thrown) {
      const [tx, ty] = B[thrown.base];
      return thrown.t1 + 0.3 + dist(tx, ty, x, y) / 30;
    }
    if (chaser >= 0) {
      const p = pts[Math.min(chaseIdx, pts.length - 1)];
      return Math.max(now, p.t) + (chaser >= 6 ? 1.2 : 0.4) + dist(p.x, p.y, x, y) / F[chaser].arm;
    }
    return now + 3;
  };

  const occupiedAhead = (r: Runner, base: number) =>
    R.some((o) => o !== r && o.st !== "out" && o.st !== "scored" && o.s > r.s - 1e-6 && Math.round(o.target) <= base && o.s <= base + 1e-6 && !(o.st === "run" && o.target > base));

  /** 베이스에 닿았을 때(또는 시작) 다음 베이스까지 갈지 */
  const decide = (r: Runner, now: number) => {
    if (r.st === "out" || r.st === "scored" || r.waitFly) return;
    const at = Math.round(r.s);
    if (at >= 4) return;
    let next = at + 1;
    if (r.forced && r.target > at) next = r.target;
    if (r.target > at && r.st === "run" && Math.abs(r.s - at) > 1e-3) return; // 아직 뛰는 중
    // 앞 주자가 그 베이스에 머무르면 못 감
    if (occupiedAhead(r, next)) {
      r.target = at;
      r.st = "stand";
      return;
    }
    const myT = ((next - r.s) * BASE_LEN) / r.speed;
    const margin = r.isBatter && at === 0 ? -99 : (r.isBatter ? -0.1 : 0.1) + (next === 4 ? 0.15 : 0);
    const forcedNow = r.forced && next === r.target;
    if (forcedNow || now + myT + margin < ballEta(next, now)) {
      r.target = next;
      r.st = "run";
    } else {
      r.target = at;
      r.st = "stand";
    }
  };
  for (const r of R) decide(r, 0);

  const frames: Frame[] = [];
  const snap = (t: number) => {
    const fx = new Float32Array(18);
    const fs = new Uint8Array(9);
    F.forEach((f, i) => {
      fx[i * 2] = f.x;
      fx[i * 2 + 1] = f.y;
      fs[i] = t < f.stunUntil ? 1 : t < freezeUntil ? 2 : t < slowUntil ? 3 : 0;
    });
    frames.push({
      t, bx, by, bh, hold: ballHolder, fx, fs,
      rs: R.map((r) => {
        const [x, y] = pathPos(r.s);
        return { id: r.id, x, y, st: r.st === "run" ? 0 : r.st === "stand" ? 1 : r.st === "out" ? 2 : 3 };
      }),
    });
  };

  const markOut = (r: Runner, t: number, base: number, force: boolean, why: string) => {
    r.st = "out";
    outs++;
    lastOutForce = force || (r.isBatter && r.s < 1);
    const [x, y] = B[base];
    events.push({ t, kind: "out", x, y, text: why });
    if (r.isBatter) for (const o of R) if (!o.isBatter) o.forced = false;
  };

  /** 공 든 수비수: 어디로 던질지 */
  const throwDecision = (fi: number, now: number) => {
    const f = F[fi];
    let best: { r: Runner; base: number; gain: number } | null = null;
    for (const r of R) {
      if (r.st !== "run") continue;
      const b = Math.round(r.target);
      if (b < 1 || b > 4) continue;
      const base = b === 4 ? 0 : b;
      const [x, y] = B[base];
      const own = dist(f.x, f.y, x, y);
      const cover = coverOf[base] >= 0 ? F[coverOf[base]] : null;
      const selfRun = own / f.speed;
      const throwT = (fi >= 6 ? 0.5 : 0.32) + own / f.arm;
      let arrive = Math.max(now, f.readyAt) + Math.min(selfRun, throwT);
      if (throwT < selfRun && cover && coverOf[base] !== fi) {
        const ca = now + runTime(cover, dist(cover.x, cover.y, x, y), now);
        arrive = Math.max(arrive, ca);
      }
      const forced = r.forced || r.isBatter;
      const rt = now + ((r.target - r.s) * BASE_LEN) / r.speed;
      const gain = rt - (arrive + (forced ? 0 : 0.15));
      if (gain > 0 && (!best || b > Math.round(best.r.target) || (b === Math.round(best.r.target) && gain > best.gain))) best = { r, base, gain };
    }
    if (best) return best.base;
    // 아웃이 안 되면 선행 주자가 가는 베이스로 (더 못 가게)
    let lead = -1;
    for (const r of R) if (r.st === "run" && r.target > r.s && r.target > lead) lead = r.target;
    if (lead >= 1) {
      // 1루로 가는 타자뿐이면 2루로 (컷오프) · 그 밖엔 선행 주자가 가는 베이스
      const nb = lead === 1 ? 2 : lead;
      return nb >= 4 ? 0 : nb;
    }
    return -1;
  };

  const doThrow = (fi: number, base: number, now: number) => {
    const f = F[fi];
    const [x, y] = B[base];
    const own = dist(f.x, f.y, x, y);
    const cover = coverOf[base];
    if (own < 7 && own / f.speed < 0.3 + own / f.arm) {
      // 직접 밟으러 감
      f.tx = x;
      f.ty = y;
      f.role = "cover";
      coverOf[base] = fi;
      f.coverBase = base;
      return;
    }
    let recv = cover >= 0 && cover !== fi ? cover : -1;
    if (recv < 0) {
      // 가장 가까운 다른 수비수
      let bd = 1e9;
      for (let i = 0; i < 9; i++) {
        if (i === fi) continue;
        const d = dist(F[i].x, F[i].y, x, y);
        if (d < bd) {
          bd = d;
          recv = i;
        }
      }
      coverOf[base] = recv;
    }
    F[recv].tx = x;
    F[recv].ty = y;
    F[recv].role = "cover";
    F[recv].coverBase = base;
    const t0 = Math.max(now, f.readyAt) + (fi >= 6 ? 0.2 : 0);
    thrown = { from: [f.x, f.y, 1.8], to: recv, t0, t1: t0 + own / f.arm, base, receiver: recv };
    ballHolder = -1;
    events.push({ t: t0, kind: "throw", x: f.x, y: f.y, text: "" });
  };

  /** 수비수 fi 가 베이스 위에서 공을 들고 있음 → 포스 · 태그 */
  const checkBaseOut = (fi: number, now: number) => {
    const f = F[fi];
    for (let base = 0; base < 4; base++) {
      const [x, y] = B[base];
      if (dist(f.x, f.y, x, y) > 1.2) continue;
      const b = base === 0 ? 4 : base;
      for (const r of R) {
        if (r.st !== "run") continue;
        const forced = r.forced || r.isBatter;
        if (Math.round(r.target) === b && r.s < b - 1e-3) {
          // 포스: 그냥 아웃 · 태그: 베이스 가까이 오는 주자
          if (forced || b - r.s < 0.6 || r.waitFly) markOut(r, now, base, forced, forced ? "포스 아웃" : "태그 아웃");
        }
      }
    }
  };

  let t = 0;
  for (let step = 0; step < 60 * 24; step++) {
    t = step * DT;
    // 공
    if (ballHolder >= 0) {
      const f = F[ballHolder];
      bx = f.x;
      by = f.y;
      bh = 1.2;
    } else if (thrown) {
      const k = clamp((t - thrown.t0) / Math.max(0.05, thrown.t1 - thrown.t0), 0, 1);
      const [x, y] = B[thrown.base];
      const rf = F[thrown.receiver];
      const tx = rf.x * 0.4 + x * 0.6;
      const ty = rf.y * 0.4 + y * 0.6;
      bx = thrown.from[0] + (tx - thrown.from[0]) * k;
      by = thrown.from[1] + (ty - thrown.from[1]) * k;
      bh = 1.8 + Math.sin(k * Math.PI) * Math.min(6, dist(thrown.from[0], thrown.from[1], x, y) * 0.06);
      if (k >= 1 && dist(rf.x, rf.y, x, y) < 1.3) {
        ballHolder = thrown.receiver;
        rf.readyAt = t + 0.28;
        thrown = null;
        checkBaseOut(ballHolder, t);
      } else if (k >= 1) {
        bx = x;
        by = y;
        bh = 0.3;
      }
    } else if (!fielded) {
      ballIdx = Math.min(pts.length - 1, step);
      const p = pts[ballIdx];
      bx = p.x;
      by = p.y;
      bh = p.h;
      if (pred.hr && ballIdx === pts.length - 1) {
        // 홈런은 아래에서 따로
      }
    }

    // 홈런
    if (pred.hr) {
      if (step === 0) events.push({ t: 0, kind: "hr", x: 0, y: 0, text: "HOME RUN" });
      for (const r of R) {
        if (r.st === "scored") continue;
        r.st = "run";
        r.target = 4;
        r.s = Math.min(4, r.s + (5.2 * DT) / BASE_LEN);
        if (r.s >= 4) {
          r.st = "scored";
          r.scoredAt = t;
          scoredIds.push(r.id);
        }
      }
      snap(t);
      if (R.every((r) => r.st === "scored")) break;
      continue;
    }

    // 수비수 움직임
    for (let i = 0; i < 9; i++) {
      const f = F[i];
      if (i === ballHolder && f.role !== "cover") continue;
      const v = speedAt(f, t);
      if (!v) continue;
      const d = dist(f.x, f.y, f.tx, f.ty);
      if (d > 0.05) {
        const m = Math.min(d, v * DT);
        f.x += ((f.tx - f.x) / d) * m;
        f.y += ((f.ty - f.y) / d) * m;
      }
    }

    // 쫓는 수비수가 공에 닿음
    if (!fielded && chaser >= 0) {
      const f = F[chaser];
      const p = pts[ballIdx];
      const reach = diveCatch ? REACH + 2.1 : REACH;
      if (p.h <= CATCH_H && dist(f.x, f.y, p.x, p.y) <= reach + 0.05 && t >= f.stunUntil) {
        if (!stunDone) {
          // 업화 스윙: 처음 잡으려는 수비는 화상으로 놓침
          stunDone = true;
          f.stunUntil = t + 1.3;
          events.push({ t, kind: "stun", x: f.x, y: f.y, text: "앗 뜨거!" });
          const ex = [chaser];
          assignChaser(ballIdx + 1, t, ex);
          if (chaser < 0) assignChaser(ballIdx + 1, t);
        } else {
          fielded = true;
          fielder = chaser;
          ballHolder = chaser;
          // 포구 → 송구 준비: 수비가 좋을수록 빠르고, 공을 빼는 데 흔들림이 있음 (발 빠른 타자의 내야안타가 「확률」로 나오게)
          f.readyAt = t + (p.air ? 0.45 : chaser >= 6 ? 0.75 : 0.3 + (1 - (inp.def[chaser] ?? 500) / 1000) * 0.12 + Math.abs(rng.gauss()) * 0.12);
          if (p.air) {
            caught = true;
            if (diveCatch) events.push({ t, kind: "dive", x: f.x, y: f.y, text: "필살수비!" });
            else events.push({ t, kind: "catch", x: f.x, y: f.y, text: "잡았다" });
            markOut(bat, t, 1, false, ball.la > 50 ? "팝플라이 아웃" : ball.la < 12 ? "라이너 아웃" : "플라이 아웃");
            lastOutForce = false;
            // 뜬공: 베이스로 돌아가 태그업 판단
            for (const r of R) {
              if (r.isBatter || r.st === "out" || r.st === "scored") continue;
              r.forced = false;
              if (r.waitFly) {
                r.waitFly = false;
                r.s = r.from;
                r.target = r.from;
                r.st = "stand";
              } else if (r.s > r.from + 1e-3 && r.s < r.from + 1) {
                // 2아웃 · 판단 실수로 뛰던 주자: 돌아가야 함 (돌아가는 동안 송구면 아웃)
                r.target = r.from;
                r.st = "run";
              }
            }
            // 태그업은 0.3초 뒤 결정
          } else {
            // 공이 땅에 닿았으면 기다리던 주자는 이제 뜀
            for (const r of R) if (r.waitFly) r.waitFly = false;
          }
        }
      } else if (p.h <= CATCH_H && !pts[Math.min(chaseIdx, pts.length - 1)].air && step % 12 === 0) {
        // 땅볼 · 안타: 가끔 더 가까운 사람으로 바꿈
        const old = chaser;
        assignChaser(ballIdx, t);
        if (old !== chaser && old >= 0) F[old].role = "idle";
        setCover();
      }
    }
    // 공이 땅에 닿으면 기다리던 주자 출발
    if (!fielded && !pts[ballIdx].air) {
      for (const r of R) {
        if (r.waitFly) {
          r.waitFly = false;
          let forced = r.from === 1 || (r.from === 2 && R.some((o) => o.from === 1 && !o.isBatter)) || (r.from === 3 && R.some((o) => o.from === 2) && R.some((o) => o.from === 1 && !o.isBatter));
          r.forced = forced;
          forced = forced || false;
          r.target = r.from + 1;
          r.st = "run";
        }
      }
    }

    // 주자
    for (const r of R) {
      if (r.st !== "run") continue;
      const dir = r.target >= r.s ? 1 : -1;
      r.s += (dir * r.speed * DT) / BASE_LEN;
      if ((dir > 0 && r.s >= r.target) || (dir < 0 && r.s <= r.target)) {
        r.s = r.target;
        if (r.s >= 4) {
          r.st = "scored";
          r.scoredAt = t;
          scoredIds.push(r.id);
          events.push({ t, kind: "run", x: 0, y: 0, text: "득점!" });
          continue;
        }
        r.st = "stand";
        if (r.isBatter) batMax = Math.max(batMax, Math.round(r.s));
        if (dir > 0) r.forced = false;
        decide(r, t);
      }
    }
    // 태그업 (뜬공 잡은 뒤)
    if (caught && ballHolder >= 0 && Math.abs(t - (F[ballHolder].readyAt - 0.15)) < DT / 2) {
      for (const r of R) {
        if (r.isBatter || r.st !== "stand") continue;
        decide(r, t);
      }
    }

    // 공 든 수비수 → 송구 (직접 밟으러 가는 중이면 도착할 때까지)
    if (ballHolder >= 0 && t >= F[ballHolder].readyAt && outs < 3) {
      const f = F[ballHolder];
      const carrying = f.role === "cover" && f.coverBase >= 0 && dist(f.x, f.y, B[f.coverBase][0], B[f.coverBase][1]) > 1.2 && dist(f.tx, f.ty, B[f.coverBase][0], B[f.coverBase][1]) < 0.1;
      if (!carrying) {
        checkBaseOut(ballHolder, t);
        if (outs < 3) {
          const base = throwDecision(ballHolder, t);
          if (base >= 0 && dist(f.x, f.y, B[base][0], B[base][1]) > 1.2) doThrow(ballHolder, base, t);
        }
      }
    }

    snap(t);
    if (outs >= 3) {
      extraFrames++;
      if (extraFrames > 40) {
        ended = true;
        break;
      }
      continue;
    }
    const running = R.some((r) => r.st === "run" || r.waitFly);
    if ((ballHolder >= 0 || fielded) && !running && !thrown) {
      extraFrames++;
      if (extraFrames > 30) {
        ended = true;
        break;
      }
    } else extraFrames = 0;
  }
  void ended;

  // 결과
  const third = outs >= 3;
  let runs = 0;
  const validScored: number[] = [];
  for (const r of R) {
    if (r.st !== "scored") continue;
    if (third && lastOutForce && !pred.hr) continue;
    if (third && !lastOutForce) {
      // 태그 아웃 전에 들어온 득점만
      const outT = events.filter((e) => e.kind === "out").at(-1)?.t ?? 1e9;
      if (r.scoredAt > outT) continue;
    }
    runs++;
    validScored.push(r.id);
  }
  const bases: (number | null)[] = [null, null, null];
  if (!third) {
    for (const r of R) {
      if (r.st !== "stand" && r.st !== "run") continue;
      const b = Math.round(r.s);
      if (b >= 1 && b <= 3) bases[b - 1] = r.id;
    }
  }
  const addOuts = outs - inp.outs;
  let result: BatterResult;
  const batterBase = bat.st === "out" ? 0 : bat.st === "scored" ? 4 : Math.round(bat.s);
  const sideName = chaser >= 0 ? POS_NAME[fielder >= 0 ? fielder : chaser] : dirName(ball.spray);
  let label: string;
  if (pred.hr) {
    result = "HR";
    label = runs >= 4 ? "만루 홈런!" : runs >= 2 ? `${runs}점 홈런!` : "솔로 홈런!";
  } else if (bat.st === "out" && batMax >= 1 && !caught) {
    // 안타 치고 더 가다가 아웃 (기록은 안타)
    result = batMax >= 3 ? "3B" : batMax === 2 ? "2B" : "1B";
    label = `${result === "3B" ? "3루타" : result === "2B" ? "2루타" : "안타"} · 무리한 주루로 아웃`;
  } else if (bat.st === "out") {
    if (caught) {
      result = runs > 0 && addOuts === 1 && !ball.bunt ? "SF" : "OUT";
      label = `${POS_NAME[fielder]} ${ball.la > 50 ? "팝플라이" : ball.la < 12 ? "라이너" : "플라이"}`;
      if (result === "SF") label = "희생 플라이";
    } else if (ball.bunt && addOuts === 1 && R.some((r) => !r.isBatter && r.st !== "out" && Math.round(r.s) > r.from)) {
      result = "SH";
      label = "희생 번트";
    } else {
      result = addOuts >= 2 ? "DP" : "OUT";
      label = addOuts >= 2 ? "병살타" : `${sideName} 땅볼`;
    }
  } else if (addOuts > 0) {
    result = "FC";
    label = "야수 선택";
  } else if (batterBase >= 4) {
    result = "IPHR";
    label = "그라운드 홈런!";
  } else {
    result = batterBase >= 3 ? "3B" : batterBase === 2 ? "2B" : "1B";
    const nm = result === "3B" ? "3루타" : result === "2B" ? "2루타" : "안타";
    const spot = Math.hypot(pts[Math.max(0, firstLandIdx)].x, pts[Math.max(0, firstLandIdx)].y) < 30 && result === "1B" ? "내야" : dirName(ball.spray);
    label = `${spot} ${nm}`;
  }
  const rbi = result === "DP" ? 0 : runs;
  return {
    foul: false, hr: pred.hr, dist: pred.land, frames, events, outs: addOuts, runs, scored: validScored,
    bases, result, label, rbi, fielder: fielder >= 0 ? fielder : chaser,
  };
}
