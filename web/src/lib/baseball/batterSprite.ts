/**
 * 타석 타자 = 3D 로 그린 2.5등신 스프라이트 (21장, 부드럽게 그림).
 *
 * public/baseball/sprites/batter-v3.png — 프레임은 가로로, 층은 세로로:
 *   fixed(외곽선 · 신발 · 머리카락 · 장갑 · 하이라이트) / team(상의 · 소매 · 양말) / helm(헬멧) / skin(얼굴 · 목) / pants(바지 · 장갑) / dark(벨트 · 언더셔츠) / bat
 *   색 층은 회색 명암 → 팀색 · 원정/얼터 · 피부 · 배트색을 곱해서 칠함 (그림 한 벌로 모든 외형)
 * 원본: scripts/baseball-batter/ — three.js 모델 + 타격 단계별 키프레임(IK · 배트-머리 충돌 검사 · 앞발 · 뒷발 회전) → 헤드리스 렌더 → compose.py
 * 기준점 · 등번호 · 배트 끝: src/data/baseball/batter-v3.json (compose.py 가 씀)
 */
import data from "@/data/baseball/batter-v3.json";
import idleData from "@/data/baseball/batter-idle.json";
import loadData from "@/data/baseball/batter-load.json";
import swingData from "@/data/baseball/batter-swing.json";
import walkData from "@/data/baseball/batter-walkin.json";
import { BAT_BUNT, BAT_LOAD, BAT_SWING, PITCH_RELEASE_T, SWING_HIT_T } from "./figures";
import type { Anim } from "./rig";

const SRC = "/baseball/sprites/batter-v3.png";
const CW = data.CW;
const CH = data.CH;
const LAYERS = ["fixed", "team", "helm", "skin", "pants", "dark", "bat"] as const;
type TintLayer = Exclude<(typeof LAYERS)[number], "fixed">;

interface Frame {
  name: string;
  ax: number;
  ay: number;
  tip: number[];
  /** 등 한가운데 [x, y, 위쪽 방향 dx, dy] (등이 보일 때만) */
  num?: number[];
}
const FRAMES: Frame[] = data.frames;
const IDX = Object.fromEntries(FRAMES.map((f, i) => [f.name, i])) as Record<string, number>;

/** 스프라이트 1px = 리그 단위 몇 */
export const SPRITE_UNIT = 0.72;
/** 리그 원점(골반) → 발바닥 */
export const FOOT_Y = 58;

export interface SpriteLook {
  team: string;
  helm: string;
  skin: string;
  pants: string;
  dark: string;
  bat: string;
  num?: string;
  /** 필살 전수: 테두리 빛 */
  glow?: string;
}

let img: HTMLImageElement | null = null;
function sheet() {
  if (!img && typeof Image !== "undefined") {
    img = new Image();
    img.src = SRC;
  }
  return img && img.complete && img.naturalWidth ? img : null;
}
export function preloadBatter(): Promise<void> {
  stillImg();
  sheet();
  return new Promise((res) => {
    if (!img || (img.complete && img.naturalWidth)) return res();
    img.addEventListener("load", () => res(), { once: true });
    img.addEventListener("error", () => res(), { once: true });
  });
}

const cache = new Map<string, HTMLCanvasElement>();
/** 외형 하나 = 전 프레임 한 줄 캔버스 (층마다 색 곱하기 → 고정층 → 등번호) */
function strip(im: HTMLImageElement, lk: SpriteLook) {
  const key = `${lk.team}|${lk.helm}|${lk.skin}|${lk.pants}|${lk.dark}|${lk.bat}|${lk.num ?? ""}`;
  let c = cache.get(key);
  if (c) return c;
  const W = CW * FRAMES.length;
  c = document.createElement("canvas");
  c.width = W;
  c.height = CH;
  const x = c.getContext("2d")!;
  const t = document.createElement("canvas");
  t.width = W;
  t.height = CH;
  const tx = t.getContext("2d")!;
  LAYERS.forEach((l, i) => {
    if (l === "fixed") return;
    tx.globalCompositeOperation = "source-over";
    tx.clearRect(0, 0, W, CH);
    tx.drawImage(im, 0, i * CH, W, CH, 0, 0, W, CH);
    tx.globalCompositeOperation = "multiply";
    tx.fillStyle = lk[l as TintLayer];
    tx.fillRect(0, 0, W, CH);
    tx.globalCompositeOperation = "destination-in";
    tx.drawImage(im, 0, i * CH, W, CH, 0, 0, W, CH);
    x.drawImage(t, 0, 0);
  });
  x.drawImage(im, 0, 0, W, CH, 0, 0, W, CH);
  // 등번호: 등 기울기에 맞춰 (상의 위에만 보이게 — 팔 · 배트가 가리면 같이 가려지도록 상의 색 영역으로 자름)
  const num = (lk.num ?? "").slice(0, 2);
  if (num) {
    const n = document.createElement("canvas");
    n.width = W;
    n.height = CH;
    const nx = n.getContext("2d")!;
    FRAMES.forEach((f, k) => {
      if (!f.num) return;
      const [cx, cy, ux, uy] = f.num;
      nx.save();
      nx.translate(k * CW + cx, cy);
      nx.rotate(Math.atan2(ux, -uy));
      nx.font = '900 15px "Black Han Sans", "Jua", sans-serif';
      nx.textAlign = "center";
      nx.textBaseline = "middle";
      nx.lineWidth = 3;
      nx.strokeStyle = lk.dark;
      nx.strokeText(num, 0, 0);
      nx.fillStyle = "#ffffff";
      nx.fillText(num, 0, 0);
      nx.restore();
    });
    // 상의 층 모양으로 자르기
    nx.globalCompositeOperation = "destination-in";
    nx.drawImage(im, 0, CH, W, CH, 0, 0, W, CH);
    x.drawImage(n, 0, 0);
  }
  cache.set(key, c);
  return c;
}

/** [프레임 이름, 이 시간까지] — 스윙은 0.07초에 임팩트 (SWING_HIT_T) */
const SWING: [string, number][] = [
  ["launch", 0.012], ["lag1", 0.026], ["lag", 0.04], ["pre", 0.058], ["contact", 0.09], ["post", 0.115], ["extend", 0.145],
  ["wrap1", 0.18], ["wrap", 0.23], ["finish1", 0.3], ["finish", 0.45], ["hold", 99],
];
/** 투수 와인드업에 맞춘 로드 → 레그킥 → 착지 (착지 자세로 기다림) */
const LOAD: [string, number][] = [["load1", 0.07], ["load2", 0.13], ["kick1", 0.19], ["kick2", 0.25], ["plant1", 0.31], ["plant", 99]];
/**
 * 새 그림 레그킥 줄 칸 (0 = 대기 1칸 … 끝 = 최고점) — 그록 영상에서 다리가 올라가는 구간만 (0~14프레임,
 * 끝 칸 발 높이 = 정해둔 최고점 높이). 투수가 내딛는 동안(공 놓기 0.45초 전) 들기 시작해 처음 · 끝을 부드럽게 늦추며
 * 공 놓을 즈음 최고점 → 공이 날아오는 동안 스트라이드(아래) → 착지 자세로 기다림.
 * 안 치고 보내면 판정 뒤 match 가 시계를 KICK_STEP_T 로 넘겨 대기 자세로 돌아감.
 */
export const KICK_STEP_T = 5;
/** 레그킥 최고점에서 버티는 구간 안의 아무 시각 (빈 스윙 끝나고 공이 날아오는 중이면 여기로 돌아옴) */
export const KICK_HOLD_T = 2;
/** 들기 시작 = 공 놓기(PITCH_RELEASE_T) 0.45초 전 (투수 디딤발 내딛을 즈음) */
const LIFT_AT = PITCH_RELEASE_T - 0.45;
/** 대기 → 최고점 (공 놓기 직전에 닿음) */
const LIFT_TOTAL = 0.43;
const KICK_TOP = loadData.n - 1;
/** 처음 · 끝 느리게 (0..1 → 0..1) */
const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/**
 * 스트라이드 (스윙 줄 앞쪽 칸, json stride): 공 놓고 STRIDE_AT 부터 STRIDE_T 동안 디딤발을 내딛어 착지 → 착지 자세로 기다림.
 * 스윙 버튼은 그 뒤 배트만 돌림 (json bat, 버튼 → 임팩트 SWING_HIT_T). 예전엔 버튼 뒤 0.05초에 3칸으로 내딛어 타자가 확 튀어 보였음.
 * 안 치고 보내면 판정 뒤(KICK_STEP_T) RETURN_T 동안 착지 자세 → 대기 자세로 겹쳐 바뀜.
 */
export const STRIDE_AT = PITCH_RELEASE_T + 0.02;
export const STRIDE_T = 0.22;
/** 안 치고 보낸 뒤 든 다리 내리기 */
const KICK_DOWN_T = 0.24;
const RETURN_T = 0.16;
/** 착지 전에 스윙하면 남은 내딛기를 이 시간에 몰아서 (예전 방식) */
const STRIDE_RUSH = 0.05;
const STRIDE = swingData.stride as [number, number][];
const BAT_SEQ = swingData.bat as [number, number][];
/** json bat 시간표의 임팩트 시각 (scripts/baseball-batter-video.py 의 SWING_HIT_T) */
const BAT_SEQ_HIT = 0.15;
const strideCell = (p: number) => {
  let c = STRIDE[0][0];
  for (const [cell, q] of STRIDE) if (q <= p + 1e-6) c = cell;
  return c;
};
/** 로드(레그킥) 시계 t 에서 스트라이드 진행도 0 ~ 1 */
export function strideProg(t: number, at = Infinity) {
  // 공이 날아오는 동안은 레그킥 최고점에서 버티다가 공이 거의 다 왔을 때(at) 내딛음 — 일찍 착지해서 기다리면 저자세처럼 보임
  return ease((t - at) / STRIDE_T);
}
/** 내딛기 시작 시각 (로드 시계) — 공 도착 STRIDE_LAND 초 전에 착지가 끝나게 */
export const STRIDE_LAND = 0.03;
export const strideStartFor = (releaseT: number, dur: number) => Math.max(releaseT + 0.02, releaseT + dur - STRIDE_LAND - STRIDE_T);
const kickCell = (t: number) => Math.min(KICK_TOP, Math.max(0, Math.round(ease((t - LIFT_AT) / LIFT_TOTAL) * KICK_TOP)));
/**
 * 스윙 줄 — 레그킥 최고점에서 바로: 발 내림 → 배트 끌고 나옴 → 임팩트(SWING_HIT_T) → 뻗음 → 팔로스루.
 * 원본: 그록 영상 (첫 · 중간 · 마지막 키프레임에 우리 그림을 넣어 사이를 채운 것) → scripts/baseball-batter-video.py
 */
/** 장별 시간표 [칸, 이 시간까지] — scripts/baseball-batter-video.py 가 영상 프레임 → 실제 스윙 시간으로 바꿔 json 에 씀 */
const SWING_BASE = 2000;
/** 안 치고 보낸 뒤 착지 자세 → 대기 겹치기: RETURN_BASE + 진행도(0 ~ 100) */
const RETURN_BASE = 3000;
/** batterFrame 이 새 그림 레그킥 칸을 돌려줄 때 더하는 값 (옛 프레임 번호와 안 겹치게) */
const KICK_BASE = 1000;
const pick = (tbl: [string, number][], t: number) => IDX[(tbl.find(([, e]) => t < e) ?? tbl[tbl.length - 1])[0]];

/** 애니 + 시간 → 프레임 */
/**
 * 애니 + 시간 → 프레임. sp = 스윙 버튼 누를 때의 스트라이드 진행도 (1 = 착지 끝, 배트만 돌림)
 */
export function batterFrame(a: Anim, t: number, sp = 1, strideAt = Infinity): number {
  if (a === BAT_SWING && stillImg()) {
    const HIT = SWING_HIT_T;
    // 남은 내딛기는 임팩트 시간의 60% 안에서 (STRIDE_RUSH 가 SWING_HIT_T 보다 길면 배트 돌 시간이 0 이 됨)
    const rem = (1 - Math.min(1, Math.max(0, sp))) * Math.min(STRIDE_RUSH, HIT * 0.6);
    if (t < rem) return SWING_BASE + strideCell(sp + (1 - sp) * (t / rem));
    // json 시간표는 임팩트 0.15초(BAT_SEQ_HIT) 기준 — 버튼 → 임팩트(SWING_HIT_T)에 맞춰 줄여 돌리고, 임팩트 뒤는 원래 속도
    // (남은 내딛기에 쓴 만큼 배트를 조금 빨리 돌려 임팩트는 항상 버튼 뒤 SWING_HIT_T)
    const tb = t < HIT ? ((t - rem) * BAT_SEQ_HIT) / (HIT - rem) : BAT_SEQ_HIT + (t - HIT);
    return SWING_BASE + (BAT_SEQ.find(([, e]) => tb < e) ?? BAT_SEQ[BAT_SEQ.length - 1])[0];
  }
  if (a === BAT_SWING) return pick(SWING, t);
  if (a === BAT_LOAD) {
    // 다리 들기 전엔 대기 동작 그대로 (와인드업 동안 멈춰 있지 않게)
    if (t < LIFT_AT) return IDX.stance;
    // 최고점까지 들고 공이 거의 올 때까지 버팀 → 내딛어 착지 자세로 (공 안 던졌으면 그대로 최고점)
    if (t < KICK_STEP_T) return t < strideAt ? KICK_BASE + kickCell(t) : SWING_BASE + strideCell(strideProg(t, strideAt));
    // 안 치고 보냄 → 착지했으면 착지 → 대기 겹치기, 다리 든 채면 거꾸로 내림
    if (strideAt < KICK_STEP_T) {
      const q = (t - KICK_STEP_T) / RETURN_T;
      return q >= 1 ? IDX.stance : RETURN_BASE + Math.round(q * 100);
    }
    const q = (t - KICK_STEP_T) / KICK_DOWN_T;
    return q >= 1 ? IDX.stance : KICK_BASE + Math.round((1 - ease(q)) * KICK_TOP);
  }
  if (a === BAT_BUNT) return IDX.bunt;
  // 대기: 방망이 까딱
  return t % 1.6 < 0.8 ? IDX.stance : IDX.waggle;
}

/** 스윙 잔상: 골반 회전 → 익스텐션 배트 끝 궤적, 지금 프레임까지 · 뒤로 갈수록 가늘고 흐리게 */
const TRAIL_FROM = IDX.launch;
const TRAIL_TO = IDX.extend;
function swoosh(ctx: CanvasRenderingContext2D, frame: number, k: number) {
  const pts = FRAMES.slice(TRAIL_FROM, Math.min(frame, TRAIL_TO) + 1).map((f) => [f.tip[0] - FRAMES[frame].ax, f.tip[1] - FRAMES[frame].ay]);
  const fade = frame > TRAIL_TO ? 0.45 : 1;
  if (pts.length < 2) return;
  const dense: number[][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], d = pts[Math.min(pts.length - 1, i + 2)];
    for (let t = 0; t < 1; t += 0.125) {
      const t2 = t * t, t3 = t2 * t;
      dense.push([0, 1].map((j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t3)));
    }
  }
  dense.push(pts[pts.length - 1]);
  const n = dense.length;
  const L: number[][] = [], R: number[][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = dense[Math.max(0, i - 1)], p1 = dense[Math.min(n - 1, i + 1)];
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const w = 1 + 11 * (i / (n - 1)) ** 1.5;
    L.push([dense[i][0] - dy * w, dense[i][1] + dx * w]);
    R.push([dense[i][0] + dy * w, dense[i][1] - dx * w]);
  }
  const g = ctx.createLinearGradient(dense[0][0], dense[0][1], dense[n - 1][0], dense[n - 1][1]);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(1, `rgba(255,255,255,${0.55 * k * fade})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (const q of L) ctx.lineTo(q[0], q[1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 그리기. (x, y) = 리그 원점(골반) 자리, sc = 리그 배율 (drawRig 와 같은 값) → 발은 FOOT_Y 아래.
 * 그림이 아직 없으면 false (부르는 쪽이 코드 리그로 그림).
 */
/**
 * 새 타자 그림 (지피티 통짜, 대기 동작 5칸 한 줄) — 있으면 모든 애니를 이걸로 그림.
 *   대기 = 칸을 시간표대로 돌림 (배트 까딱 + 무릎 · 어깨 리듬), 그 밖(로드 · 스윙 · 번트)은 아직 1칸.
 *   원본: scripts/baseball-batter-idle.py (시트 → 줄 · 마스크 · 기준점 json)
 */
const IDLE = { src: "/baseball/sprites/batter-idle.webp", ...idleData, scale: 0.289 };
/** 대기 순서 [칸, 초] — 그록 영상(첫 장면 = 마지막 장면이라 그대로 반복) 칸을 같은 간격으로 · 시간표는 json(seq, 끝 시각) */
const IDLE_SEQ: [number, number][] = idleData.seq.map(([c, e], i, a) => [c, e - (i ? a[i - 1][1] : 0)] as [number, number]);
const IDLE_LEN = IDLE_SEQ.reduce((a, [, d]) => a + d, 0);
/** 대기 반복 시작 맞추기: 지금 이 순간 대기 칸 cell 이 나오게 */
let idleT0 = 0;
export function syncIdleTo(cell: number) {
  let at = 0;
  for (const [c, d] of IDLE_SEQ) {
    if (c === cell) break;
    at += d;
  }
  idleT0 = (typeof performance !== "undefined" ? performance.now() / 1000 : 0) - at;
}
function idleCell(t: number) {
  let u = (((t - idleT0) % IDLE_LEN) + IDLE_LEN) % IDLE_LEN;
  for (const [c, d] of IDLE_SEQ) {
    if (u < d) return c;
    u -= d;
  }
  return 0;
}
/** 레그킥 줄 (scripts/baseball-batter-load.py + tween) — 대기 줄과 같은 배율 · 같은 기준점(땅 딛은 가까운 발) */
const KICKS = { src: "/baseball/sprites/batter-load.webp", ...loadData };
/** 스윙 줄 — 레그킥 줄과 같은 배율 · 같은 기준점(축발) */
const SWINGS = { src: "/baseball/sprites/batter-swing.webp", ...swingData };
/**
 * 타석에 걸어 들어오기 (scripts/baseball-batter-walkin.py) — 대기 칸과 같은 기준점, 칸은 walkData.scale 배로 작게 저장
 * walkinFrame(t) → WALK_BASE + 칸. 다 들어오면 대기 반복을 마지막 칸과 제일 닮은 대기 칸(walkData.idle)부터 (syncIdleTo)
 * (예전: 대기 1칸과 겹쳐 넘기기 → 두 그림이 반투명으로 겹쳐 보였음)
 */
const WALKS = { src: "/baseball/sprites/batter-walkin.webp", ...walkData };
const WALK_BASE = 4000;
/** 걸어 들어오기 길이 (초) */
export const WALKIN_LEN = walkData.seq[walkData.seq.length - 1][1];
export const WALKIN_IDLE_CELL = walkData.idle;
export function walkinFrame(t: number): number {
  return WALK_BASE + (walkData.seq.find(([, e]) => t < e) ?? walkData.seq[walkData.seq.length - 1])[0];
}
let walkImg: HTMLImageElement | null = null;
let still: HTMLImageElement | null = null;
let kickImg: HTMLImageElement | null = null;
let swingImg: HTMLImageElement | null = null;
/**
 * 큰 시트는 받자마자 ImageBitmap 으로 미리 풀어 둠 (다른 스레드에서 디코드) — <img> 를 바로 그리면 처음 그릴 때
 * 그리는 크기에 맞춰 메인 스레드에서 디코드해서(16032px 스윙 시트 0.3초) 첫 투구가 멈칫했음
 */
const bitmaps = new Map<CanvasImageSource, ImageBitmap>();
export function sheetImage(url: string) {
  const im = new Image();
  im.onload = () => {
    if (typeof createImageBitmap === "function")
      createImageBitmap(im).then((b) => bitmaps.set(im, b)).catch(() => {});
  };
  im.src = url;
  return im;
}
/** 풀어 둔 ImageBitmap 이 있으면 그것, 아니면 그림 그대로 */
export const drawable = (im: CanvasImageSource): CanvasImageSource => bitmaps.get(im) ?? im;
function stillImg() {
  if (!still && typeof Image !== "undefined") {
    still = sheetImage(IDLE.src);
    for (const k of Object.keys(TINT_SRC) as SheetKey[]) tintOf(k);
    kickImg = sheetImage(KICKS.src);
    swingImg = sheetImage(SWINGS.src);
    walkImg = sheetImage(WALKS.src);
  }
  return still && still.complete && still.naturalWidth ? still : null;
}
const hexRgb = (h: string) => {
  const v = parseInt(h.replace("#", "").slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => c / 255);
};
/**
 * 팀색 칠하기 — 시트마다 마스크(batter-*-tint.webp, 절반 크기 · R 헬멧 명암 · G 팀 명암 · A 비중, scripts/baseball-batter-tint).
 * 받으면 헬멧 · 팀 두 장(회색 명암 + 비중)으로 나눠 두고, 그릴 때 칸마다 「명암 × 팀색」을 원래 그림 위에 덮음.
 * 원래 그림 색(주황)과 비슷한 팀이면 안 칠함.
 */
const RECOLOR = true;
const TINT_SRC: Record<string, string> = {
  idle: "/baseball/sprites/batter-idle-tint.webp",
  kick: "/baseball/sprites/batter-load-tint.webp",
  swing: "/baseball/sprites/batter-swing-tint.webp",
  walk: "/baseball/sprites/batter-walkin-tint.webp",
};
type SheetKey = keyof typeof TINT_SRC;
const tintParts = new Map<SheetKey, { helm: HTMLCanvasElement; team: HTMLCanvasElement } | "loading">();
function tintOf(k: SheetKey) {
  const t = tintParts.get(k);
  if (t === "loading") return null;
  if (t) return t;
  if (typeof Image === "undefined" || typeof document === "undefined") return null;
  tintParts.set(k, "loading");
  const im = new Image();
  im.onload = () => {
    const W = im.naturalWidth, H = im.naturalHeight;
    const src = document.createElement("canvas");
    src.width = W;
    src.height = H;
    const g = src.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const mk = (ch: 0 | 1) => {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const x = c.getContext("2d")!;
      const o = x.createImageData(W, H);
      const od = o.data;
      for (let i = 0; i < d.length; i += 4) {
        const own = ch === 0 ? d[i] > d[i + 1] : d[i + 1] >= d[i] && d[i + 1] > 0;
        if (!own || !d[i + 3]) continue;
        const v = d[i + ch];
        od[i] = od[i + 1] = od[i + 2] = v;
        od[i + 3] = d[i + 3];
      }
      x.putImageData(o, 0, 0);
      return c;
    };
    tintParts.set(k, { helm: mk(0), team: mk(1) });
  };
  im.onerror = () => tintParts.delete(k);
  im.src = TINT_SRC[k];
  return null;
}
/** 원래 그림(주황)과 같은 계열이면 칠할 필요 없음 */
function isOrange(hex: string) {
  const [r, g, b] = hexRgb(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 0.25 || mx !== r) return false;
  const h = (((g - b) / (mx - mn)) * 60 + 360) % 360;
  return h >= 14 && h <= 34;
}
let scratch: HTMLCanvasElement | null = null;
/** 마스크 한 칸(절반 크기)에 색 곱해서 (dx, dy, dw, dh) 에 */
function tintCell(ctx: CanvasRenderingContext2D, part: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, color: string) {
  const w = Math.ceil(sw), h = Math.ceil(sh);
  if (!scratch) scratch = document.createElement("canvas");
  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, w);
    scratch.height = Math.max(scratch.height, h);
  }
  const g = scratch.getContext("2d")!;
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, w, h);
  g.drawImage(part, sx, sy, sw, sh, 0, 0, sw, sh);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(part, sx, sy, sw, sh, 0, 0, sw, sh);
  g.globalCompositeOperation = "source-over";
  ctx.drawImage(scratch, 0, 0, sw, sh, dx, dy, dw, dh);
}
/** 시트 한 칸 그리기 (+ 팀색) — 좌표는 원래 시트 기준 */
function cellDraw(ctx: CanvasRenderingContext2D, key: SheetKey, im: CanvasImageSource, lk: SpriteLook, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
  ctx.drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh);
  if (!RECOLOR) return;
  const helmOn = !isOrange(lk.helm);
  const teamOn = !isOrange(lk.team);
  if (!helmOn && !teamOn) return;
  const t = tintOf(key);
  if (!t) return;
  if (helmOn) tintCell(ctx, t.helm, sx / 2, sy / 2, sw / 2, sh / 2, dx, dy, dw, dh, lk.helm);
  if (teamOn) tintCell(ctx, t.team, sx / 2, sy / 2, sw / 2, sh / 2, dx, dy, dw, dh, lk.team);
}

/** 타자 시트 중 아직 한 번도 안 그린 것 (첫 그림 때 디코드 · GPU 업로드로 화면이 멈칫해서 미리 1px 로 한 번 그려 둠) */
export function batterSheets(): CanvasImageSource[] {
  stillImg();
  return [still, kickImg, swingImg, walkImg].filter((x): x is HTMLImageElement => !!x).map(drawable);
}

export function drawBatter(ctx: CanvasRenderingContext2D, frame: number, lk: SpriteLook, x: number, y: number, sc: number, flip = false, trail = 0): boolean {
  const st = stillImg();
  if (st) {
    const s = sc * IDLE.scale;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    ctx.translate(x, y + FOOT_Y * sc);
    ctx.scale(flip ? -s : s, s);
    const ki = kickImg;
    const sw = swingImg;
    const swCell = (cell: number) => {
      const c = Math.min(cell, SWINGS.n - 1);
      cellDraw(ctx, "swing", drawable(sw!), lk, (c % SWINGS.cols) * SWINGS.CW, Math.floor(c / SWINGS.cols) * SWINGS.CH, SWINGS.CW, SWINGS.CH, -SWINGS.ax, -SWINGS.ay, SWINGS.CW, SWINGS.CH);
    };
    const wk = walkImg;
    const walkCell = (cell: number) => {
      const c = Math.min(cell, WALKS.n - 1);
      const k = 1 / WALKS.scale;
      cellDraw(ctx, "walk", drawable(wk!), lk, (c % WALKS.cols) * WALKS.CW, Math.floor(c / WALKS.cols) * WALKS.CH, WALKS.CW, WALKS.CH, -WALKS.ax * k, -WALKS.ay * k, WALKS.CW * k, WALKS.CH * k);
    };
    const idleFirst = () => {
      const cols = IDLE.cols ?? IDLE.n;
      cellDraw(ctx, "idle", drawable(st), lk, (0 % cols) * IDLE.CW, 0, IDLE.CW, IDLE.CH, -IDLE.ax, -IDLE.ay, IDLE.CW, IDLE.CH);
    };
    if (frame >= WALK_BASE && !(wk && wk.complete && wk.naturalWidth)) {
      // 걸어 들어오기 그림이 아직이면 대기 자세로
      idleFirst();
    } else if (frame >= WALK_BASE) {
      walkCell(frame - WALK_BASE);
    } else if (frame >= RETURN_BASE && sw && sw.complete && sw.naturalWidth) {
      // 착지 자세 → 대기 (겹쳐서)
      const k = Math.min(1, (frame - RETURN_BASE) / 100);
      ctx.globalAlpha = 1 - k;
      swCell(STRIDE[STRIDE.length - 1][0]);
      ctx.globalAlpha = k;
      const cols = IDLE.cols ?? IDLE.n;
      cellDraw(ctx, "idle", drawable(st), lk, (0 % cols) * IDLE.CW, 0, IDLE.CW, IDLE.CH, -IDLE.ax, -IDLE.ay, IDLE.CW, IDLE.CH);
      ctx.globalAlpha = 1;
    } else if (frame >= SWING_BASE && sw && sw.complete && sw.naturalWidth) {
      swCell(frame - SWING_BASE);
    } else if (frame >= SWING_BASE && ki && ki.complete && ki.naturalWidth) {
      cellDraw(ctx, "kick", drawable(ki), lk, KICK_TOP * KICKS.CW, 0, KICKS.CW, KICKS.CH, -KICKS.ax, -KICKS.ay, KICKS.CW, KICKS.CH);
    } else if (frame >= KICK_BASE && ki && ki.complete && ki.naturalWidth) {
      const cell = Math.min(frame - KICK_BASE, KICKS.n - 1);
      cellDraw(ctx, "kick", drawable(ki), lk, cell * KICKS.CW, 0, KICKS.CW, KICKS.CH, -KICKS.ax, -KICKS.ay, KICKS.CW, KICKS.CH);
    } else {
      const idle = frame === IDX.stance || frame === IDX.waggle;
      const cell = idle ? idleCell(typeof performance !== "undefined" ? performance.now() / 1000 : 0) : 0;
      // 대기 줄은 여러 줄 (한 줄에 cols 칸)
      const cols = IDLE.cols ?? IDLE.n;
      cellDraw(ctx, "idle", drawable(st), lk, (cell % cols) * IDLE.CW, Math.floor(cell / cols) * IDLE.CH, IDLE.CW, IDLE.CH, -IDLE.ax, -IDLE.ay, IDLE.CW, IDLE.CH);
    }
    ctx.restore();
    return true;
  }
  const im = sheet();
  if (!im) return false;
  const f = FRAMES[frame] ?? FRAMES[0];
  const s = sc * SPRITE_UNIT;
  const src = strip(im, lk);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.translate(x, y + FOOT_Y * sc);
  ctx.scale(flip ? -s : s, s);
  if (trail > 0 && frame > TRAIL_FROM && frame <= TRAIL_TO + 1) swoosh(ctx, frame, trail);
  if (lk.glow) {
    ctx.shadowColor = lk.glow;
    ctx.shadowBlur = 14;
  }
  ctx.drawImage(src, frame * CW, 0, CW, CH, -f.ax, -f.ay, CW, CH);
  ctx.restore();
  return true;
}
