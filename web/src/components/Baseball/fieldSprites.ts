/**
 * 수비 화면 선수 픽셀 스프라이트 (3D 모델을 수비 화면 각도에서 미리 렌더 → 픽셀화한 시트, scripts/baseball-field-sprites 참고).
 * 수비 = field_fd (글러브), 주자 = field_bt (헬멧). 시트마다 동작 × 8방향 줄, 팀색 자리는 마스크 시트로 칠함.
 * 동작 고르기: 시뮬 결과(FieldOut)의 사건(잡기 · 다이빙 · 송구)에 맞춰 그 동작의 핵심 장(잡는 · 던지는 순간)이 사건 시각에 오게 미리 짜 둠
 * — 나머지는 속도로 달리기 · 전력질주 · 대기.
 */
import { BASES, type FieldOut, type Frame } from "@/lib/baseball/play";

interface ActMeta { n: number; loop: boolean; span: number; key: number; row: number }
interface SheetMeta { cell: number; ax: number; ay: number; acts: Record<string, ActMeta>; /** 렌더 몇 px = 시트 1px (예전 시트 5) */ f?: number }
interface Sheet { meta: SheetMeta; img: HTMLImageElement; mask: HTMLImageElement; ready: boolean; tinted: Map<string, HTMLCanvasElement> }

const BASE = "/baseball/sprites/field";
const sheets: Record<"fd" | "bt", Sheet | null> = { fd: null, bt: null };

function loadSheet(k: "fd" | "bt") {
  if (sheets[k] || typeof window === "undefined") return;
  const s: Sheet = { meta: null as unknown as SheetMeta, img: new Image(), mask: new Image(), ready: false, tinted: new Map() };
  sheets[k] = s;
  let left = 3;
  const done = () => { if (--left === 0) s.ready = true; };
  fetch(`${BASE}_${k}.json`).then((r) => r.json()).then((m: SheetMeta) => { s.meta = m; done(); }).catch(() => {});
  s.img.onload = done;
  s.mask.onload = done;
  s.img.src = `${BASE}_${k}.webp`;
  s.mask.src = `${BASE}_${k}_mask.png`;
}
/** 수비 화면 들어가기 전에 미리 */
export function preloadFieldSprites() {
  loadSheet("fd");
  loadSheet("bt");
}
export const fieldSpritesReady = () => !!sheets.fd?.ready && !!sheets.bt?.ready;

/** 팀색 입힌 시트 (팀 색마다 한 번): 마스크 자리 = 팀 색 × 그 픽셀 밝기 (회색으로 구워 둠) */
function tinted(s: Sheet, color: string) {
  let c = s.tinted.get(color);
  if (c) return c;
  const w = s.img.naturalWidth, h = s.img.naturalHeight;
  c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(s.img, 0, 0);
  const d = g.getImageData(0, 0, w, h);
  const mc = document.createElement("canvas");
  mc.width = w;
  mc.height = h;
  const mg = mc.getContext("2d", { willReadFrequently: true })!;
  mg.drawImage(s.mask, 0, 0);
  const m = mg.getImageData(0, 0, w, h).data;
  const hex = parseInt(color.replace("#", ""), 16);
  const tr = (hex >> 16) & 255, tg = (hex >> 8) & 255, tb = hex & 255;
  for (let i = 0; i < d.data.length; i += 4) {
    if (m[i] < 128 || d.data[i + 3] === 0) continue;
    // 회색(0x8a) 기준 밝기 → 팀 색 명암
    const k = Math.min(1.6, (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3 / 138);
    d.data[i] = Math.min(255, tr * k);
    d.data[i + 1] = Math.min(255, tg * k);
    d.data[i + 2] = Math.min(255, tb * k);
  }
  g.putImageData(d, 0, 0);
  s.tinted.set(color, c);
  return c;
}

/** 필드 방향(x 오른쪽 · y 홈에서 앞쪽) → 8방향 칸 (0 = 화면 아래/카메라 쪽을 봄, 2 = 오른쪽, 4 = 뒤, 6 = 왼쪽) */
export function dirOf(vx: number, vy: number) {
  const th = Math.atan2(vx, -vy);
  return (((Math.round(th / (Math.PI / 4)) % 8) + 8) % 8) as number;
}

export interface Pose { act: string; f: number; dir: number }

/** 한 프레임 그리기. (x, y) = 발 자리 화면 좌표, sc = 스프라이트 1픽셀이 몇 px */
export function drawFieldSprite(ctx: CanvasRenderingContext2D, kind: "fd" | "bt", pose: Pose, x: number, y: number, sc: number, color: string) {
  const s = sheets[kind];
  if (!s?.ready) return false;
  const a = s.meta.acts[pose.act] ?? s.meta.acts.idle ?? s.meta.acts.ready;
  if (!a) return false;
  const C = s.meta.cell;
  const fi = Math.max(0, Math.min(a.n - 1, Math.floor(pose.f)));
  const sx = fi * C, sy = (a.row + pose.dir) * C;
  // 그림자
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, y, 7 * sc, 2.4 * sc, 0, 0, Math.PI * 2);
  ctx.fill();
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  // sc 는 「렌더 5px = 1칸」 기준 — 더 촘촘한 시트(f 3)는 그만큼 작게 그려서 화면 크기는 같게
  const u = (sc * (s.meta.f ?? 5)) / 5;
  ctx.drawImage(tinted(s, color), sx, sy, C, C, x - s.meta.ax * u, y - s.meta.ay * u, C * u, C * u);
  ctx.imageSmoothingEnabled = prev;
  return true;
}

// ───────── 동작 짜기 ─────────
/** 동작마다 재생 빠르기 (1 = 렌더한 동작 시간 그대로) · 사건보다 얼마나 먼저 시작하는지는 시트의 key 장으로 */
const SPEED: Record<string, number> = { fly: 1.3, throw: 1.5, cthrow: 1.3, pick: 1.4, diveL: 1.2, diveR: 1.2, stretch: 1.3 };
interface Cue { start: number; end: number; fi: number; act: string; dir: number }

export class FieldPoser {
  private cues: Cue[] = [];
  private built = false;
  constructor(private out: FieldOut) {}
  /** 시트 정보(동작 길이 · 핵심 장)가 있어야 짤 수 있어서 처음 쓸 때 */
  private build() {
    const fd = sheets.fd?.meta;
    if (this.built || !fd) return;
    this.built = true;
    const out = this.out;
    const F = out.frames;
    const at = (tt: number) => F[Math.min(F.length - 1, Math.max(0, Math.round(tt * 60)))];
    const add = (t: number, fi: number, act: string, faceX: number, faceY: number) => {
      const a = fd.acts[act];
      if (!a) return;
      const sp = SPEED[act] ?? 1;
      const len = a.span / sp;
      const lead = a.key >= 0 ? (a.key / a.n) * len : 0;
      const f = at(t);
      const dir = dirOf(faceX - f.fx[fi * 2], faceY - f.fx[fi * 2 + 1]);
      this.cues.push({ start: t - lead, end: t - lead + len, fi, act, dir });
    };
    for (const e of out.events) {
      if (e.kind === "catch" && out.fielder >= 0) add(e.t, out.fielder, "fly", e.x, e.y - 10);
      if (e.kind === "dive" && out.fielder >= 0) {
        const fi = out.fielder, f0 = at(e.t - 0.35), f1 = at(e.t);
        const vx = f1.fx[fi * 2] - f0.fx[fi * 2], vy = f1.fx[fi * 2 + 1] - f0.fx[fi * 2 + 1];
        const bx = f1.bx - f1.fx[fi * 2], by = f1.by - f1.fx[fi * 2 + 1];
        // 몸이 달려가는 방향을 보고, 공이 왼쪽이면 왼쪽 다이빙
        add(e.t, fi, bx * -vy + by * vx > 0 ? "diveL" : "diveR", f1.fx[fi * 2] + vx, f1.fx[fi * 2 + 1] + vy);
      }
      if (e.kind === "throw") {
        const f = at(e.t);
        let bi = 0, bd = 1e9;
        for (let i = 0; i < 9; i++) { const d = Math.hypot(f.fx[i * 2] - e.x, f.fx[i * 2 + 1] - e.y); if (d < bd) { bd = d; bi = i; } }
        // 던지는 쪽: 다음에 공을 잡는 수비
        let tx = BASES[1][0], ty = BASES[1][1];
        for (let k = Math.round(e.t * 60) + 1; k < F.length; k++) if (F[k].hold >= 0 && F[k].hold !== bi) { tx = F[k].fx[F[k].hold * 2]; ty = F[k].fx[F[k].hold * 2 + 1]; break; }
        add(e.t, bi, bi === 1 ? "cthrow" : "throw", tx, ty);
      }
    }
    for (let i = 1; i < F.length; i++) {
      const h = F[i].hold;
      if (h >= 0 && F[i - 1].hold < 0 && F[i].bh < 1.5 && !out.events.some((e) => (e.kind === "catch" || e.kind === "dive") && Math.abs(e.t - F[i].t) < 0.2)) add(F[i].t, h, "pick", F[i].bx, F[i].by);
      if (h === 2 && F[i - 1].hold < 0 && F[i].bh >= 1.5 && Math.hypot(F[i].fx[4] - BASES[1][0], F[i].fx[5] - BASES[1][1]) < 2.5) add(F[i].t, 2, "stretch", F[i].bx, F[i].by);
    }
    // 같은 수비의 겹치는 동작은 나중 것이 이김
    this.cues.sort((a, b) => a.start - b.start);
  }

  private vel(i: number, t: number, runner = false) {
    const F = this.out.frames;
    const k = Math.min(F.length - 1, Math.max(0, Math.round(t * 60)));
    const a = F[Math.max(0, k - 3)], b = F[Math.min(F.length - 1, k + 3)];
    const span = (Math.min(F.length - 1, k + 3) - Math.max(0, k - 3)) / 60 || 1;
    if (!runner) return [(b.fx[i * 2] - a.fx[i * 2]) / span, (b.fx[i * 2 + 1] - a.fx[i * 2 + 1]) / span];
    const id = F[k].rs[i]?.id;
    const ra = a.rs.find((r) => r.id === id), rb = b.rs.find((r) => r.id === id);
    if (!ra || !rb) return [0, 0];
    return [(rb.x - ra.x) / span, (rb.y - ra.y) / span];
  }

  /** 수비 i 의 지금 동작 */
  fielder(i: number, f: Frame, t: number, last: Pose | undefined): Pose {
    this.build();
    const fd = sheets.fd?.meta;
    for (let k = this.cues.length - 1; k >= 0; k--) {
      const c = this.cues[k];
      if (c.fi !== i || t < c.start || t >= c.end) continue;
      const a = fd?.acts[c.act];
      if (!a) break;
      return { act: c.act, f: ((t - c.start) / (c.end - c.start)) * a.n, dir: c.dir };
    }
    const [vx, vy] = this.vel(i, t);
    const sp = Math.hypot(vx, vy);
    if (sp > 0.8) {
      const act = sp > 7 ? "sprint" : "run";
      // 달리기 한 바퀴(8장) = 약 두 걸음 ≈ 2.6m (속도에 맞춰 발 구름)
      return { act, f: ((t * sp) / 2.6) * 8 % 8, dir: dirOf(vx, vy) };
    }
    const x = f.fx[i * 2], y = f.fx[i * 2 + 1];
    const dir = f.hold === i ? last?.dir ?? 0 : dirOf(f.bx - x, f.by - y);
    if (i === 1 && t < 0.6) return { act: "squat", f: 0, dir: 4 };
    const act = t < 0.4 || f.hold < 0 ? "ready" : "idle";
    return { act, f: (t * 3) % 4, dir };
  }

  /** 주자 j (frame.rs 순서) */
  runner(j: number, f: Frame, t: number): Pose {
    const r = f.rs[j];
    const [vx, vy] = this.vel(j, t, true);
    const sp = Math.hypot(vx, vy);
    if (r.st === 3 && this.out.hr) return { act: "jog", f: (t * 10) % 8, dir: dirOf(vx, vy) };
    if (sp > 0.5) return { act: sp > 7 ? "sprint" : "run", f: ((t * sp) / 2.6) * 8 % 8, dir: dirOf(vx, vy) };
    // 서 있으면 공 쪽
    return { act: "idle", f: (t * 3) % 4, dir: dirOf(f.bx - r.x, f.by - r.y) };
  }
}
