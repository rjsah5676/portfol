"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playSfx } from "@/lib/sketch/sfx";
import {
  addStroke,
  CANVAS_H,
  CANVAS_W,
  clearStrokes,
  removeStrokes,
  subscribeStrokes,
  type Stroke,
} from "@/realtime/sketch";

// ───────────── 그림 조각이 오가는 곳 ─────────────

/**
 * 도화지가 그림 조각을 주고받는 곳. 바뀌면(id) 새 도화지.
 *  - 서버: 그림 맞히기 · 가짜 화가 (모두가 같은 도화지를 실시간으로)
 *  - 내 화면: 거짓말 · 릴레이에서 혼자 그릴 때 (다 그리면 한꺼번에 냄)
 *  - 고정: 낸 그림 보여 주기
 */
export interface StrokeSource {
  id: string;
  subscribe(onAdd: (key: string, s: Stroke) => void, onRemove: (key: string) => void): () => void;
  add(s: Stroke): void;
  remove(keys: string[]): void;
  clear(): void;
}

export function serverSource(roomId: string, turnId: string): StrokeSource | null {
  if (!turnId) return null;
  return {
    id: `${roomId}/${turnId}`,
    subscribe: (onAdd, onRemove) => subscribeStrokes(roomId, turnId, onAdd, onRemove),
    add: (st) => void addStroke(roomId, turnId, st).catch(() => {}),
    remove: (keys) => void removeStrokes(roomId, turnId, keys).catch(() => {}),
    clear: () => void clearStrokes(roomId, turnId).catch(() => {}),
  };
}

/** 내 화면에만 쌓는 도화지 — all() 로 지금까지 그린 것 */
export interface LocalSource extends StrokeSource {
  all(): Stroke[];
}
export function localSource(id: string): LocalSource {
  const items = new Map<string, Stroke>();
  const subs = new Set<{ add: (k: string, s: Stroke) => void; remove: (k: string) => void }>();
  let n = 0;
  return {
    id,
    subscribe(onAdd, onRemove) {
      const sub = { add: onAdd, remove: onRemove };
      subs.add(sub);
      for (const [k, st] of items) onAdd(k, st);
      return () => void subs.delete(sub);
    },
    add(st) {
      const k = `k${String(++n).padStart(7, "0")}`;
      items.set(k, st);
      subs.forEach((x) => x.add(k, st));
    },
    remove(keys) {
      for (const k of keys) if (items.delete(k)) subs.forEach((x) => x.remove(k));
    },
    clear() {
      for (const k of [...items.keys()]) {
        items.delete(k);
        subs.forEach((x) => x.remove(k));
      }
    },
    all: () => [...items.values()],
  };
}

/** 이미 다 그린 그림 보여 주기 */
export function staticSource(id: string, strokes: Stroke[]): StrokeSource {
  return {
    id,
    subscribe(onAdd) {
      strokes.forEach((st, i) => onAdd(`k${String(i).padStart(7, "0")}`, st));
      return () => {};
    },
    add() {},
    remove() {},
    clear() {},
  };
}

/** 크레용 16색 (2줄 × 8) */
export const COLORS = [
  "#1F1F2A",
  "#7A7F8E",
  "#E53935",
  "#FB8C00",
  "#FDD835",
  "#43A047",
  "#1E88E5",
  "#8E24AA",
  "#FFFFFF",
  "#C9CED6",
  "#F48FB1",
  "#FFCC9C",
  "#9CCC65",
  "#4DD0E1",
  "#3949AB",
  "#6D4C41",
];
/** 굵기 단계 */
const groupId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 그리는 동안 다른 손가락(손바닥)이 페이지를 밀거나 확대하지 못하게 */
const holdPage = (e: TouchEvent) => {
  if (e.cancelable) e.preventDefault();
};

export const WIDTHS = [3, 7, 14, 26, 42];
const BG = "#ffffff";
const FLUSH_MS = 50;

export type Tool = "pen" | "eraser" | "fill";

export interface CanvasApi {
  undo: () => void;
  clear: () => void;
}

// ───────────── 그리기 유틸 ─────────────

/** 내부 해상도 배율 — 화면에 늘려 보여도 선이 뭉개지지 않게 2배로 그림 */
const SCALE = 2;
const PW = CANVAS_W * SCALE;
const PH = CANVAS_H * SCALE;

type Pt = [number, number];

const encode = (pts: Pt[]) => pts.map(([x, y]) => `${x},${y}`).join(" ");
const decode = (p: string): Pt[] =>
  p
    .split(" ")
    .filter(Boolean)
    .map((xy) => xy.split(",").map(Number) as Pt);
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** 획 하나(같은 g)의 점들과, 어디까지 그렸는지 */
interface Group {
  pts: Pt[];
  /** 곡선이 mid(pts[done], pts[done+1])까지 그려졌음 (0이면 시작점부터) */
  done: number;
  color: string;
  width: number;
  /** 받은 뒤 아직 화면에 안 그린 점 (조금씩 풀어서 그려 부드럽게) */
  queue: Pt[];
  /** 획이 끝났음 (마지막 조각 수신 / 손을 뗌) */
  ended: boolean;
  /** 끝 표시는 받았지만 queue가 아직 남음 */
  endPending: boolean;
}

/**
 * 새로 들어온 점까지만 이어 그림 (본 도화지).
 * 점과 점 사이를 중점 기준 2차 베지어로 이어서 꺾이지 않고 둥글게 보이게 함.
 * 마지막 중점 → 마지막 점 구간은 다음 점이 오면 곡선으로 바뀌므로 본 도화지엔 안 그리고
 * 위쪽 임시 레이어(drawTails)에만 그림 — 본 도화지에 직선 꼬리가 남아 삐죽해지는 것 방지.
 * 획이 끝나면(ended) 그때 마지막 구간을 확정해서 그림.
 */
function drawIncremental(ctx: CanvasRenderingContext2D, g: Group) {
  const p = g.pts;
  const n = p.length;
  if (n === 0) return;
  ctx.strokeStyle = g.color;
  ctx.fillStyle = g.color;
  ctx.lineWidth = g.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (n === 1 || g.done === -1) {
    // 시작점 (콕 찍기만 해도 점이 보이게)
    if (g.done === -1) g.done = 0;
    ctx.beginPath();
    ctx.arc(p[0][0], p[0][1], g.width / 2, 0, Math.PI * 2);
    ctx.fill();
    if (n === 1) return;
  }
  const s = g.done;
  const start = s === 0 ? p[0] : mid(p[s], p[s + 1]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (let i = s + 1; i <= n - 2; i++) {
    const m = mid(p[i], p[i + 1]);
    ctx.quadraticCurveTo(p[i][0], p[i][1], m[0], m[1]);
  }
  if (g.ended) ctx.lineTo(p[n - 1][0], p[n - 1][1]);
  ctx.stroke();
  g.done = Math.max(s, n - 2);
}

/** 아직 안 끝난 획들의 마지막 구간(임시 꼬리)을 위 레이어에 그림 */
function drawTails(ctx: CanvasRenderingContext2D, groups: Iterable<Group>) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const g of groups) {
    const p = g.pts;
    const n = p.length;
    if (g.ended || n < 2) continue;
    const s = g.done;
    const start = s <= 0 ? p[0] : mid(p[s], p[s + 1]);
    ctx.strokeStyle = g.color;
    ctx.lineWidth = g.width;
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.lineTo(p[n - 1][0], p[n - 1][1]);
    ctx.stroke();
  }
}

const newGroup = (color: string, width: number, pts: Pt[] = []): Group => ({
  pts,
  done: -1,
  color,
  width,
  queue: [],
  ended: false,
  endPending: false,
});

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** 페인트통: 비슷한 색(허용 오차) 영역을 채움 — 경계의 안티앨리어싱 픽셀까지 먹도록 */
function floodFill(ctx: CanvasRenderingContext2D, sx: number, sy: number, color: string) {
  const x0 = Math.floor(sx * SCALE);
  const y0 = Math.floor(sy * SCALE);
  if (x0 < 0 || y0 < 0 || x0 >= PW || y0 >= PH) return;
  const img = ctx.getImageData(0, 0, PW, PH);
  const d = img.data;
  const i0 = (y0 * PW + x0) * 4;
  const [tr, tg, tb] = [d[i0], d[i0 + 1], d[i0 + 2]];
  const [fr, fg, fb] = hexToRgb(color);
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 10) return;
  const TOL = 90;
  const match = (i: number) =>
    Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= TOL;
  const seen = new Uint8Array(PW * PH);
  const stack = [x0 + y0 * PW];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!match(i)) continue;
    d[i] = fr;
    d[i + 1] = fg;
    d[i + 2] = fb;
    d[i + 3] = 255;
    const x = p % PW;
    if (x > 0) stack.push(p - 1);
    if (x < PW - 1) stack.push(p + 1);
    if (p >= PW) stack.push(p - PW);
    if (p < PW * (PH - 1)) stack.push(p + PW);
  }
  ctx.putImageData(img, 0, 0);
}

// ───────────── 컴포넌트 ─────────────

export default function SketchCanvas({
  source,
  canDraw,
  tool,
  color,
  width,
  apiRef,
  onStrokeEnd,
  hideInk,
  children,
}: {
  /** 그림 조각이 오가는 곳 (없으면 빈 도화지) */
  source: StrokeSource | null;
  canDraw: boolean;
  tool: Tool;
  color: string;
  width: number;
  /** 되돌리기 · 전체 지우기 (도구 모음이 바깥에 있어서) */
  apiRef?: React.RefObject<CanvasApi | null>;
  /** 한 획을 다 그었을 때 (손을 뗌) */
  onStrokeEnd?: () => void;
  /** 그리는 사람 화면에서 그림을 가림 (눈 가리고 그리기) */
  hideInk?: boolean;
  /** 도화지 위에 덮을 것 (안내 · 도장) */
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tailRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Map<string, Stroke>>(new Map());
  const lastKeyRef = useRef("");
  const redrawRaf = useRef(0);
  const groupsRef = useRef<Map<string, Group>>(new Map());
  /** 내가 지금 이 화면에서 직접 그린 획 — 서버에서 돌아온 사본은 다시 안 그림 */
  const localRef = useRef<Set<string>>(new Set());
  const animRaf = useRef(0);

  /** 붓 크기 미리보기 (마우스 위치) */
  const [cursor, setCursor] = useState<{ x: number; y: number; d: number } | null>(null);

  const ctx = useCallback(() => {
    const c = canvasRef.current?.getContext("2d", { willReadFrequently: true }) ?? null;
    c?.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    return c;
  }, []);

  const tails = useCallback(() => {
    const c = tailRef.current?.getContext("2d") ?? null;
    if (!c) return;
    c.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    drawTails(c, groupsRef.current.values());
  }, []);

  const clearCanvas = useCallback(() => {
    const c = ctx();
    if (!c) return;
    c.fillStyle = BG;
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }, [ctx]);

  /** 받은 점들을 프레임마다 조금씩 풀어서 그림 (50ms 묶음이 뚝뚝 끊겨 보이지 않게) */
  const pump = useCallback(() => {
    cancelAnimationFrame(animRaf.current);
    const step = () => {
      const c = ctx();
      if (!c) return;
      let pending = false;
      for (const g of groupsRef.current.values()) {
        if (!g.queue.length) continue;
        const take = Math.max(1, Math.ceil(g.queue.length / 3));
        g.pts.push(...g.queue.splice(0, take));
        if (!g.queue.length && g.endPending) g.ended = true;
        drawIncremental(c, g);
        if (g.queue.length) pending = true;
      }
      tails();
      if (pending) animRaf.current = requestAnimationFrame(step);
    };
    animRaf.current = requestAnimationFrame(step);
  }, [ctx, tails]);

  /** 대기 중인 점을 전부 즉시 그림 (채우기 전에 순서를 맞추려고) */
  const flushQueues = useCallback((c: CanvasRenderingContext2D) => {
    for (const g of groupsRef.current.values()) {
      if (!g.queue.length) continue;
      g.pts.push(...g.queue.splice(0));
      if (g.endPending) g.ended = true;
      drawIncremental(c, g);
    }
  }, []);

  /** 조각 하나 반영. animate면 천천히 풀어서, 아니면 바로 */
  const apply = useCallback(
    (c: CanvasRenderingContext2D, s: Stroke, animate: boolean) => {
      if (s.t === "f") {
        flushQueues(c);
        floodFill(c, s.x ?? 0, s.y ?? 0, s.c);
        return;
      }
      let g = groupsRef.current.get(s.g);
      if (!g) {
        g = newGroup(s.c, s.w ?? 4);
        groupsRef.current.set(s.g, g);
      }
      let pts = decode(s.p ?? "");
      // 조각은 이전 조각의 마지막 점부터 시작하므로 겹치는 점 하나 제거
      const last = g.queue[g.queue.length - 1] ?? g.pts[g.pts.length - 1];
      if (last && pts[0] && pts[0][0] === last[0] && pts[0][1] === last[1]) pts = pts.slice(1);
      if (animate) {
        g.queue.push(...pts);
        if (s.e) g.endPending = true;
        pump();
      } else {
        g.pts.push(...pts);
        if (s.e) g.ended = true;
        drawIncremental(c, g);
      }
    },
    [flushQueues, pump]
  );

  // 지우기·되돌리기 후엔 처음부터 다시 그림 (여러 번 호출돼도 프레임당 한 번)
  const scheduleRedraw = useCallback(() => {
    cancelAnimationFrame(redrawRaf.current);
    redrawRaf.current = requestAnimationFrame(() => {
      clearCanvas();
      const c = ctx();
      if (!c) return;
      groupsRef.current = new Map();
      const keys = [...strokesRef.current.keys()].sort();
      for (const k of keys) apply(c, strokesRef.current.get(k)!, false);
      lastKeyRef.current = keys[keys.length - 1] ?? "";
      tails();
    });
  }, [clearCanvas, ctx, apply, tails]);

  // 차례가 바뀌면 새 도화지
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  });
  const sourceId = source?.id ?? "";
  useEffect(() => {
    strokesRef.current = new Map();
    groupsRef.current = new Map();
    localRef.current = new Set();
    lastKeyRef.current = "";
    clearCanvas();
    tails();
    const src = sourceRef.current;
    if (!src) return;
    return src.subscribe(
      (key, s) => {
        strokesRef.current.set(key, s);
        if (localRef.current.has(s.g)) {
          // 내가 그린 획: 이미 화면에 있음
          if (key > lastKeyRef.current) lastKeyRef.current = key;
          return;
        }
        // 순서대로 오면 이어 그리기, 아니면 전체 다시 그리기
        if (key > lastKeyRef.current) {
          const c = ctx();
          if (c) apply(c, s, true);
          lastKeyRef.current = key;
        } else scheduleRedraw();
      },
      (key) => {
        strokesRef.current.delete(key);
        scheduleRedraw();
      }
    );
  }, [sourceId, scheduleRedraw, clearCanvas, ctx, apply, tails]);

  // ── 입력 (그리는 사람만) ──
  const drawing = useRef<{
    g: string;
    pts: Pt[];
    sent: number;
    color: string;
    width: number;
  } | null>(null);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const toCanvas = (clientX: number, clientY: number): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [
      Math.round(((clientX - rect.left) / rect.width) * CANVAS_W * 10) / 10,
      Math.round(((clientY - rect.top) / rect.height) * CANVAS_H * 10) / 10,
    ];
  };

  const flush = (final = false) => {
    const d = drawing.current;
    if (!d || (d.pts.length <= d.sent && !final)) return;
    // 이전 조각의 마지막 점부터 이어서 보내야 선이 끊기지 않음
    const from = Math.max(0, Math.min(d.sent, d.pts.length) - 1);
    const seg = d.pts.slice(from);
    d.sent = d.pts.length;
    sourceRef.current?.add({
      g: d.g,
      c: d.color,
      w: d.width,
      p: encode(seg),
      ...(final ? { e: 1 as const } : {}),
    });
  };

  // 손바닥 무시: 펜을 한 번이라도 쓰면 그 뒤로 손가락 터치는 그리기에 안 씀,
  // 한 획은 처음 누른 포인터 하나로만 (손 대고 펜으로 그리면 두 입력이 섞여 선이 지그재그로 흔들리던 것)
  const penSeen = useRef(false);
  const activeId = useRef<number | null>(null);
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || e.button > 0) return;
    e.preventDefault();
    if (e.pointerType === "pen") penSeen.current = true;
    else if (e.pointerType === "touch" && penSeen.current) return;
    if (drawing.current) {
      // 손바닥으로 시작된 획 중에 펜이 닿으면 손 획은 끝내고 펜으로
      if (e.pointerType !== "pen") return;
      endStroke();
    }
    const pt = toCanvas(e.clientX, e.clientY);
    const g = groupId();
    localRef.current.add(g);
    if (tool === "fill") {
      playSfx("sfx-fill");
      const c = ctx();
      if (c) {
        flushQueues(c);
        floodFill(c, pt[0], pt[1], color);
      }
      sourceRef.current?.add({
        g,
        c: color,
        t: "f",
        x: Math.round(pt[0]),
        y: Math.round(pt[1]),
      });
      onStrokeEnd?.();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    activeId.current = e.pointerId;
    document.addEventListener("touchmove", holdPage, { passive: false });
    const col = tool === "eraser" ? BG : color;
    const w = tool === "eraser" ? Math.max(width, 16) : width;
    drawing.current = { g, pts: [pt], sent: 0, color: col, width: w };
    const grp = newGroup(col, w, [pt]);
    groupsRef.current.set(g, grp);
    const c = ctx();
    if (c) drawIncremental(c, grp);
    flushTimer.current = setInterval(() => flush(), FLUSH_MS);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (canDraw && tool !== "fill" && e.pointerType === "mouse") {
      const rect = e.currentTarget.getBoundingClientRect();
      const w = tool === "eraser" ? Math.max(width, 16) : width;
      // 무대가 transform 으로 줄어 있어도 맞게: 화면 크기 비율로 계산 후 부모 기준 좌표(offset)로
      const k = e.currentTarget.offsetWidth / rect.width;
      setCursor({
        x: (e.clientX - rect.left) * k,
        y: (e.clientY - rect.top) * k,
        d: (w * e.currentTarget.offsetWidth) / CANVAS_W,
      });
    }
    const d = drawing.current;
    if (!d || e.pointerId !== activeId.current) return;
    const grp = groupsRef.current.get(d.g);
    // 빠르게 그을 때 브라우저가 합쳐버린 중간 좌표까지 써서 촘촘하게
    const evs = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    let added = false;
    for (const ev of evs.length ? evs : [e.nativeEvent]) {
      const pt = toCanvas(ev.clientX, ev.clientY);
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 1.5) continue;
      d.pts.push(pt);
      grp?.pts.push(pt);
      added = true;
    }
    const c = ctx();
    if (added && c && grp) {
      drawIncremental(c, grp);
      tails();
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId === activeId.current) endStroke();
  };
  const endStroke = () => {
    activeId.current = null;
    document.removeEventListener("touchmove", holdPage);
    const d = drawing.current;
    if (!d) return;
    if (flushTimer.current) clearInterval(flushTimer.current);
    // 마지막 조각(끝 표시 포함) 전송 — 점 하나(콕 찍기)여도 보냄
    flush(true);
    // 내 화면에서도 마지막 구간 확정
    const grp = groupsRef.current.get(d.g);
    const c = ctx();
    if (grp && c) {
      grp.ended = true;
      drawIncremental(c, grp);
      tails();
    }
    drawing.current = null;
    onStrokeEnd?.();
  };

  // iPad · 애플펜슬: 사파리가 펜 입력을 길게 누르기(돋보기 · 글자 선택) · 손글씨 입력(Scribble) ·
  // 두 번 탭 확대로 먼저 가져가서 꾹 눌러야 그려지던 것 — 도화지 위 터치 기본 동작을 막는다.
  // (React 의 터치 이벤트는 passive 라 preventDefault 가 안 먹어서 직접 붙임)
  useEffect(() => {
    const el = tailRef.current;
    if (!el) return;
    const stop = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    const opt = { passive: false } as const;
    el.addEventListener("touchstart", stop, opt);
    el.addEventListener("touchmove", stop, opt);
    el.addEventListener("touchend", stop, opt);
    el.addEventListener("contextmenu", stop);
    el.addEventListener("selectstart", stop);
    return () => {
      el.removeEventListener("touchstart", stop);
      el.removeEventListener("touchmove", stop);
      el.removeEventListener("touchend", stop);
      el.removeEventListener("contextmenu", stop);
      el.removeEventListener("selectstart", stop);
    };
  }, []);

  useEffect(
    () => () => {
      document.removeEventListener("touchmove", holdPage);
      if (flushTimer.current) clearInterval(flushTimer.current);
      cancelAnimationFrame(animRaf.current);
      cancelAnimationFrame(redrawRaf.current);
    },
    []
  );

  const undo = () => {
    const keys = [...strokesRef.current.keys()].sort();
    const lastG = strokesRef.current.get(keys[keys.length - 1] ?? "")?.g;
    if (!lastG) return;
    playSfx("sfx-undo");
    sourceRef.current?.remove(keys.filter((k) => strokesRef.current.get(k)?.g === lastG));
  };

  const clear = () => {
    playSfx("sfx-clear");
    sourceRef.current?.clear();
  };
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { undo, clear };
  });

  const cur = canDraw
    ? tool === "fill"
      ? "cursor-cell"
      : cursor
        ? "cursor-none"
        : "cursor-crosshair"
    : "cursor-default";
  return (
    <div className="sk-canvas-wrap aspect-[4/3] w-full" data-draw={canDraw}>
      <canvas
        ref={canvasRef}
        width={PW}
        height={PH}
        className={`absolute inset-0 h-full w-full touch-none rounded-[3px] select-none ${hideInk ? "opacity-0" : ""}`}
      />
      {/* 임시 꼬리 레이어 + 입력 받는 곳 */}
      <canvas
        ref={tailRef}
        width={PW}
        height={PH}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setCursor(null)}
        className={`absolute inset-0 h-full w-full touch-none select-none ${cur} ${hideInk ? "opacity-0" : ""}`}
      />
      {canDraw && cursor && tool !== "fill" && (
        <span
          className="pointer-events-none absolute z-[4] rounded-full border-2 border-[#2B2D42]/70"
          style={{
            left: cursor.x - cursor.d / 2,
            top: cursor.y - cursor.d / 2,
            width: cursor.d,
            height: cursor.d,
            background: tool === "eraser" ? "rgba(255,255,255,0.7)" : `${color}55`,
          }}
        />
      )}
      {children}
    </div>
  );
}
