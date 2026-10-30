/**
 * 수비 화면 선수 픽셀 스프라이트 (3D 모델을 수비 화면 각도에서 미리 렌더 → 픽셀화한 시트, scripts/baseball-field-sprites 참고).
 * 수비 = field_fd (글러브), 주자 = field_bt (헬멧). 시트마다 동작 × 8방향 줄, 팀색 자리는 마스크 시트로 칠함.
 * 동작 고르기: 시뮬 결과(FieldOut)의 사건(잡기 · 다이빙 · 송구)에 맞춰 그 동작의 핵심 장(잡는 · 던지는 순간)이 사건 시각에 오게 미리 짜 둠
 * — 나머지는 속도로 달리기 · 전력질주 · 대기.
 */
import { BASES, type FieldOut, type Frame } from "@/lib/baseball/play";

interface ActMeta { n: number; loop: boolean; span: number; key: number; row: number; /** 동작별로 나눈 시트면 그 파일 이름 끝 */ file?: string }
interface SheetMeta { cell: number; ax: number; ay: number; acts: Record<string, ActMeta>; /** 시트 1px = 256칸 렌더 몇 px (예전 시트 5) */ f?: number }
interface SheetImg { img: HTMLImageElement; mask: HTMLImageElement; ready: boolean; tinted: Map<string, HTMLCanvasElement> }
interface Sheet { base: string; meta: SheetMeta | null; files: Map<string, SheetImg> }

type Kind = "fd" | "bt";
const BASE = "/baseball/sprites/field";
/** [보통, 고해상도(확대용 · 없으면 null)] — 고해상도는 동작별 파일, 크게 보일 때 처음 쓰면서 받음 */
const sheets: Record<Kind, [Sheet | null, Sheet | null]> = { fd: [null, null], bt: [null, null] };
/** 고해상도로 바꾸는 크기: 보통 시트 1px 이 실제 화면 몇 px 넘으면 */
const HD_AT = 1.6;

function sheetImg(s: Sheet, file: string): SheetImg {
  let f = s.files.get(file);
  if (f) return f;
  f = { img: new Image(), mask: new Image(), ready: false, tinted: new Map() };
  s.files.set(file, f);
  let left = 2;
  const ff = f;
  const done = () => {
    if (--left === 0) ff.ready = true;
  };
  f.img.onload = done;
  f.mask.onload = done;
  const name = file ? `${s.base}_${file}` : s.base;
  f.img.src = `${name}.webp`;
  f.mask.src = `${name}_mask.png`;
  return f;
}
function loadSheet(k: Kind, lv: 0 | 1) {
  if (sheets[k][lv] || typeof window === "undefined") return;
  const s: Sheet = { base: lv ? `${BASE}_${k}_hd` : `${BASE}_${k}`, meta: null, files: new Map() };
  sheets[k][lv] = s;
  fetch(`${s.base}.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m: SheetMeta | null) => {
      if (!m) return;
      s.meta = m;
      // 보통 시트는 한 장이면 바로 받음
      if (!lv && !Object.values(m.acts).some((a) => a.file)) sheetImg(s, "");
    })
    .catch(() => {});
}
/** 수비 화면 들어가기 전에 미리 */
export function preloadFieldSprites() {
  for (const k of ["fd", "bt"] as Kind[]) {
    loadSheet(k, 0);
    // 확대용 고해상도는 주자만 (수비수는 아직 100K 모델 없음 — 404 콘솔 에러 안 나게)
    if (k === "bt") loadSheet(k, 1);
  }
}
const sheetReady = (s: Sheet | null) => !!s?.meta && (Object.values(s.meta.acts).some((a) => a.file) || !!s.files.get("")?.ready);
export const fieldSpritesReady = () => sheetReady(sheets.fd[0]) && sheetReady(sheets.bt[0]);

/** 팀색 입힌 시트 (팀 색마다 한 번): 마스크 자리 = 팀 색 × 그 픽셀 밝기 (회색으로 구워 둠) */
function tinted(f: SheetImg, color: string) {
  let c = f.tinted.get(color);
  if (c) return c;
  const w = f.img.naturalWidth, h = f.img.naturalHeight;
  c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(f.img, 0, 0);
  const d = g.getImageData(0, 0, w, h);
  const mc = document.createElement("canvas");
  mc.width = w;
  mc.height = h;
  const mg = mc.getContext("2d", { willReadFrequently: true })!;
  mg.drawImage(f.mask, 0, 0);
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
  f.tinted.set(color, c);
  return c;
}

/** 필드 방향(x 오른쪽 · y 홈에서 앞쪽) → 8방향 칸 (0 = 화면 아래/카메라 쪽을 봄, 2 = 오른쪽, 4 = 뒤, 6 = 왼쪽) */
export function dirOf(vx: number, vy: number) {
  const th = Math.atan2(vx, -vy);
  return (((Math.round(th / (Math.PI / 4)) % 8) + 8) % 8) as number;
}

export interface Pose { act: string; f: number; dir: number }

/**
 * 달리기 한 바퀴(두 걸음)가 몇 m 인지 — 실제 주자 보폭(한 걸음 1.8 ~ 2.1m, 초당 4 걸음 안팎)에 맞춤.
 * 예전 2.6m 는 초당 6 걸음이라 발이 너무 빨랐음.
 */
const CYCLE_M: Record<string, number> = { run: 3.4, sprint: 4.1 };
function stepF(act: string, t: number, sp: number) {
  return (((t * sp) / (CYCLE_M[act] ?? 3.6)) * 8) % 8;
}

/** 한 프레임 그리기. (x, y) = 발 자리 화면 좌표, sc = 스프라이트 1픽셀이 몇 px */
export function drawFieldSprite(ctx: CanvasRenderingContext2D, kind: Kind, pose: Pose, x: number, y: number, sc: number, color: string) {
  const s0 = sheets[kind][0];
  if (!s0?.meta) return false;
  // 크게 보이면 (확대 · 가까이) 고해상도 시트 — 아직 덜 받았으면 받기 시작하고 이번엔 보통으로
  let s: Sheet = s0;
  let f: SheetImg | null = null;
  // 실제 화면 픽셀 기준 (캔버스 배율 · 필드 카메라 확대 포함)
  const u0 = ((sc * (s0.meta.f ?? 5)) / 5) * Math.abs(ctx.getTransform().a);
  const hd = sheets[kind][1];
  if (u0 > HD_AT * 0.85 && hd?.meta) {
    const a = hd.meta.acts[pose.act] ?? hd.meta.acts.idle ?? hd.meta.acts.ready;
    const hf = a ? sheetImg(hd, a.file ?? "") : null;
    if (u0 > HD_AT && hf?.ready) {
      s = hd;
      f = hf;
    }
  }
  const meta = s.meta!;
  const a = meta.acts[pose.act] ?? meta.acts.idle ?? meta.acts.ready;
  if (!a) return false;
  if (!f) {
    f = sheetImg(s, a.file ?? "");
    if (!f.ready) return false;
  }
  const C = meta.cell;
  const fi = Math.max(0, Math.min(a.n - 1, Math.floor(pose.f)));
  const sx = fi * C, sy = (a.row + pose.dir) * C;
  // 그림자
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, y, 7 * sc, 2.4 * sc, 0, 0, Math.PI * 2);
  ctx.fill();
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  // sc 는 「256칸 렌더 5px = 1칸」 기준 — 시트마다 f 로 맞춰서 화면 크기는 같게
  const u = (sc * (meta.f ?? 5)) / 5;
  ctx.drawImage(tinted(f, color), sx, sy, C, C, x - meta.ax * u, y - meta.ay * u, C * u, C * u);
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
    const fd = sheets.fd[0]?.meta;
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
    const fd = sheets.fd[0]?.meta;
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
      return { act, f: stepF(act, t, sp), dir: dirOf(vx, vy) };
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
    if (sp > 0.5) {
      const act = sp > 7 ? "sprint" : "run";
      return { act, f: stepF(act, t, sp), dir: dirOf(vx, vy) };
    }
    // 서 있으면 공 쪽
    return { act: "idle", f: (t * 3) % 4, dir: dirOf(f.bx - r.x, f.by - r.y) };
  }
}
