/**
 * 투구 궤적 검사: 구종 × 좌우 투수 × 존 안팎 모든 목표 × 변화 · 구속 · 게이지 를 전부 던져서
 * 화면(타석 시점)에서 부자연스러운 움직임을 찾음.
 *   npx tsx scripts/baseball-pitch-audit.ts [자세히 보여 줄 구종]
 * 게임과 같게: 손(투구 그림) 위치 보정이 비행 70% 동안 줄어듦 · 홈 지난 뒤는 홈 통과 속도로 곧게.
 *
 * 규칙
 *   RISE   비행 후반(u > 0.55) 화면에서 위로 3px 넘게 올라감 (떠오름)
 *   HUMP   비행 내내 위로 올라간 합이 크게 (커브는 낙차라 25px, 나머지 10px 까지 봐줌)
 *   SWAY   한쪽으로 3px 넘게 갔다가 반대로 되돌아옴 (안쪽으로 오다 빠지는 S자) — 값 = 잘못 간 거리
 *   KINK   한 걸음(u 0.02)에 진행 방향이 6° 넘게 확 바뀜 (화면에서 1.5px 넘게 움직이는 구간만)
 *   STALL  공이 화면에서 멈칫했다 다시 빨라짐 (솟음 · 되돌림이 겹쳐 방향을 트는 순간)
 *   WOBBLE 휘는 방향(곡률 부호)이 바뀜 — 한쪽으로 휘다 반대로 휨
 *   GROUND 홈 오기 전에 땅(높이 0) 밑으로 들어감
 *   HIGH   화면 위쪽 너무 높이 (y < 150)
 */
import { ballProj as proj } from "../src/components/Baseball/view";
import { MOVE_GAIN, PITCHES, makePitch, pitchAt, type Pitch, type PitchKind } from "../src/lib/baseball/pitch";
import { makeRng } from "../src/lib/baseball/rng";
import throwData from "../src/data/baseball/pitcher-throw.json";

// 튜닝 실험: LATE=2 (회전 변화 모양 전부) · GX · GY · GG (MOVE_GAIN)
if (process.env.LATE) for (const d of Object.values(PITCHES)) d.late = +process.env.LATE;
for (const k of ["x", "y", "g"] as const) { const v = process.env["G" + k.toUpperCase()]; if (v) MOVE_GAIN[k] = +v; }

const FEET = { x: 512, y: 339.15 };
const PCPX = 0.1956 / ((520 / 506) * 1.1);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 게임 drawPitchBall 과 같은 화면 좌표 */
function screenPath(p: Pitch, lefty: boolean) {
  const hand = { x: FEET.x + (lefty ? -1 : 1) * throwData.hand[0] * PCPX, y: FEET.y + throwData.hand[1] * PCPX };
  const r0 = pitchAt(p, 0);
  const p0 = proj(r0.x, r0.y, r0.z);
  const off = { x: hand.x - p0.x, y: hand.y - p0.y };
  const pe = pitchAt(p, p.dur), pq = pitchAt(p, p.dur * 0.995);
  const E = proj(pe.x, pe.y, pe.z), Q = proj(pq.x, pq.y, pq.z);
  const du = Math.max(1e-4, 1 - pq.u);
  const pts: { x: number; y: number; u: number; h: number }[] = [];
  for (let u = 0; u <= 1.1 + 1e-9; u += 0.02) {
    const v = pitchAt(p, u * p.dur);
    if (u > 1) {
      const d = (u - 1) / du;
      pts.push({ x: E.x + (E.x - Q.x) * d, y: E.y + (E.y - Q.y) * d, u, h: v.y });
      continue;
    }
    const s = proj(v.x, v.y, v.z);
    const k = 1 - smooth(0, 0.7, u);
    pts.push({ x: s.x + off.x * k, y: s.y + off.y * k, u, h: v.y });
  }
  return pts;
}

type Rule = "RISE" | "HUMP" | "SWAY" | "KINK" | "WOBBLE" | "STALL" | "GROUND" | "HIGH";
function check(kind: PitchKind, pts: ReturnType<typeof screenPath>) {
  const bad: { r: Rule; v: number; u: number }[] = [];
  // 떠오름
  let lateUp = 0, lateU = 0, up = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i - 1].y - pts[i].y;
    if (d > 0) {
      up += d;
      if (pts[i].u > 0.55 && pts[i].u <= 1.02) { lateUp += d; lateU = pts[i].u; }
    }
  }
  if (lateUp > 3) bad.push({ r: "RISE", v: lateUp, u: lateU });
  if (up > (kind === "CB" ? 25 : 10)) bad.push({ r: "HUMP", v: up, u: 0 });
  // 좌우 S자: 처음 간 방향의 반대로 되돌아올 때, 처음 방향으로 「잘못 간」 거리 (눈에 보이는 몸쪽으로 오다 빠짐)
  {
    const x0 = pts[0].x;
    let dir = 0, ext = x0, wrong = 0, wU = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      if (Math.abs(dx) < 0.05) continue;
      const sd = Math.sign(dx);
      if (!dir) dir = sd;
      if (sd === dir) ext = dir > 0 ? Math.max(ext, pts[i].x) : Math.min(ext, pts[i].x);
      else if (Math.abs(pts[i].x - ext) > 2) { wrong = Math.abs(ext - x0); wU = pts[i].u; break; }
    }
    if (wrong > 3) bad.push({ r: "SWAY", v: wrong, u: wU });
  }
  // 꺾임 · 휘는 방향 바뀜 · 멈칫 (화면에서 실제로 움직이는 구간만)
  {
    const seg = pts.slice(1).map((q, i) => ({ dx: q.x - pts[i].x, dy: q.y - pts[i].y, u: q.u }));
    let prevA: number | null = null, prevL = 0, prevTurn = 0, maxJ = 0, jU = 0, flips = 0, flipU = 0;
    for (const sg of seg) {
      const L = Math.hypot(sg.dx, sg.dy);
      const a = (Math.atan2(sg.dy, sg.dx) * 180) / Math.PI;
      if (prevA !== null && L >= 1.5 && prevL >= 1.5) {
        let t = a - prevA;
        if (t > 180) t -= 360;
        if (t < -180) t += 360;
        if (Math.abs(t) > maxJ) { maxJ = Math.abs(t); jU = sg.u; }
        if (Math.abs(t) > 0.8) {
          if (prevTurn && Math.sign(t) !== prevTurn) { flips++; flipU = sg.u; }
          prevTurn = Math.sign(t);
        }
      }
      if (L >= 0.3) { prevA = a; prevL = L; }
    }
    if (maxJ > 6) bad.push({ r: "KINK", v: maxJ, u: jU });
    if (flips) bad.push({ r: "WOBBLE", v: flips, u: flipU });
    // 멈칫: 화면 속도가 앞뒤 최고치의 25% 밑으로 떨어졌다 다시 빨라짐
    for (let i = 3; i < seg.length - 3; i++) {
      if (seg[i].u > 0.95) break;
      const L = Math.hypot(seg[i].dx, seg[i].dy);
      const before = Math.max(...seg.slice(0, i).map((q) => Math.hypot(q.dx, q.dy)));
      const after = Math.max(...seg.slice(i + 1).map((q) => Math.hypot(q.dx, q.dy)));
      if (before > 1.2 && L < before * 0.25 && after > before) { bad.push({ r: "STALL", v: L / before, u: seg[i].u }); break; }
    }
  }
  const g = pts.find((q) => q.u < 1 && q.h < 0);
  if (g) bad.push({ r: "GROUND", v: g.h, u: g.u });
  const hi = Math.min(...pts.map((q) => q.y));
  if (hi < 150) bad.push({ r: "HIGH", v: hi, u: 0 });
  return bad;
}

const KINDS = Object.keys(PITCHES) as PitchKind[];
const XS = [-0.7, -0.5, -0.35, -0.2, -0.1, 0, 0.1, 0.2, 0.35, 0.5, 0.7];
const YS = [0.05, 0.2, 0.35, 0.47, 0.6, 0.75, 0.9, 1.0, 1.04];
const still = Object.assign(() => 0.99, { gauss: () => 0, range: (a: number) => a, pick: <T,>(arr: readonly T[]) => arr[0], chance: () => false }) as unknown as ReturnType<typeof makeRng>;
const focus = process.argv[2] as PitchKind | undefined;
const total: Record<string, number> = {};
const byKind: Record<string, Record<string, number>> = {};
const where: Record<string, Record<string, number>> = {};
const samples: Record<string, string[]> = {};
let n = 0;
for (const kind of KINDS) {
  byKind[kind] = {};
  for (const throws of ["R", "L"] as const)
    for (const brk of [200, 500, 900])
      for (const velo of [125, 145, 160])
        for (const q of [0.3, 0.8, 1]) {
          const P = { name: "p", num: 1, role: "SP", throws, control: 900, velo, brk, stamina: 600, rep: [kind] } as never;
          for (const tx of XS)
            for (const ty of YS) {
              // 제구 오차 · 실투 없이 정확히 그 자리로 (자리별로 보려고) — 흔들림 0 인 난수
              const p = makePitch(P, { kind, target: { x: tx, y: ty }, quality: q }, 1, still, 1);
              n++;
              for (const b of check(kind, screenPath(p, throws === "L"))) {
                total[b.r] = (total[b.r] ?? 0) + 1;
                byKind[kind][b.r] = (byKind[kind][b.r] ?? 0) + 1;
                const zone = `${Math.abs(tx) > 0.25 ? (Math.sign(tx) * (throws === "R" ? 1 : -1) > 0 ? "글러브쪽밖" : "팔쪽밖") : "가로안"}/${ty < 0.4 ? "아래밖" : ty > 0.95 ? "위밖" : "세로안"}`;
                where[b.r] ??= {};
                where[b.r][zone] = (where[b.r][zone] ?? 0) + 1;
                const key = `${kind}:${b.r}`;
                samples[key] ??= [];
                if (samples[key].length < 4) samples[key].push(`${throws} 변화${brk} ${velo}km 게이지${q} 목표(${tx},${ty}) 값 ${b.v.toFixed(1)} @u${b.u.toFixed(2)}`);
              }
            }
        }
}
console.log(`던진 공 ${n}개`);
console.log("규칙별", total);
for (const k of KINDS) console.log(k.padEnd(3), JSON.stringify(byKind[k]));
console.log("어디서", JSON.stringify(where, null, 0));
for (const [k, v] of Object.entries(samples)) if (!focus || k.startsWith(focus)) console.log(k, "\n   " + v.join("\n   "));
