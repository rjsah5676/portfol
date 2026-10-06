"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addStroke,
  CANVAS_H,
  CANVAS_W,
  clearStrokes,
  removeStrokes,
  subscribeStrokes,
  type Stroke,
} from "@/realtime/sketch";

const COLORS = [
  "#111111",
  "#7a7a7a",
  "#e53935",
  "#fb8c00",
  "#fdd835",
  "#43a047",
  "#1e88e5",
  "#8e24aa",
  "#6d4c41",
  "#f48fb1",
];
const WIDTHS = [4, 10, 24];
const BG = "#ffffff";
const FLUSH_MS = 50;

type Tool = "pen" | "eraser" | "fill";

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
  roomId,
  turnId,
  canDraw,
}: {
  roomId: string;
  turnId: string;
  canDraw: boolean;
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

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);

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
  useEffect(() => {
    strokesRef.current = new Map();
    groupsRef.current = new Map();
    localRef.current = new Set();
    lastKeyRef.current = "";
    clearCanvas();
    tails();
    if (!turnId) return;
    return subscribeStrokes(
      roomId,
      turnId,
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
  }, [roomId, turnId, scheduleRedraw, clearCanvas, ctx, apply, tails]);

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
    addStroke(roomId, turnId, {
      g: d.g,
      c: d.color,
      w: d.width,
      p: encode(seg),
      ...(final ? { e: 1 as const } : {}),
    }).catch(() => {});
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || e.button > 0) return;
    e.preventDefault();
    const pt = toCanvas(e.clientX, e.clientY);
    const g = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    localRef.current.add(g);
    if (tool === "fill") {
      const c = ctx();
      if (c) {
        flushQueues(c);
        floodFill(c, pt[0], pt[1], color);
      }
      addStroke(roomId, turnId, {
        g,
        c: color,
        t: "f",
        x: Math.round(pt[0]),
        y: Math.round(pt[1]),
      }).catch(() => {});
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
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
    const d = drawing.current;
    if (!d) return;
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

  const onUp = () => {
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
  };

  useEffect(
    () => () => {
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
    removeStrokes(
      roomId,
      turnId,
      keys.filter((k) => strokesRef.current.get(k)?.g === lastG)
    ).catch(() => {});
  };

  const toolBtn = (on: boolean) =>
    `cursor-pointer rounded-lg px-2.5 py-1.5 font-mono text-xs transition-colors ${
      on ? "bg-[#6C63FF] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
    }`;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={PW}
          height={PH}
          className={`aspect-[4/3] w-full touch-none rounded-xl bg-white shadow-[0_10px_40px_-15px_rgba(0,0,0,0.6)] select-none ${
            canDraw ? (tool === "fill" ? "cursor-cell" : "cursor-crosshair") : "cursor-default"
          }`}
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
          className={`absolute inset-0 h-full w-full touch-none select-none ${
            canDraw ? (tool === "fill" ? "cursor-cell" : "cursor-crosshair") : "cursor-default"
          }`}
        />
      </div>
      {canDraw && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10 bg-[#1C1E24] px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`색 ${c}`}
                onClick={() => {
                  setColor(c);
                  if (tool === "eraser") setTool("pen");
                }}
                className={`h-6 w-6 cursor-pointer rounded-full border-2 transition-transform ${
                  color === c && tool !== "eraser"
                    ? "scale-110 border-white"
                    : "border-transparent hover:scale-105"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                aria-label={`굵기 ${w}`}
                onClick={() => setWidth(w)}
                className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg ${
                  width === w ? "bg-white/15" : "hover:bg-white/5"
                }`}
              >
                <span
                  className="rounded-full bg-white"
                  style={{ width: Math.max(4, w / 2), height: Math.max(4, w / 2) }}
                />
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              className={toolBtn(tool === "pen")}
              onClick={() => setTool("pen")}
            >
              ✏️ 펜
            </button>
            <button
              type="button"
              className={toolBtn(tool === "fill")}
              onClick={() => setTool("fill")}
            >
              🪣 채우기
            </button>
            <button
              type="button"
              className={toolBtn(tool === "eraser")}
              onClick={() => setTool("eraser")}
            >
              🧽 지우개
            </button>
          </div>
          <div className="ml-auto flex gap-1">
            <button type="button" className={toolBtn(false)} onClick={undo}>
              ↶ 되돌리기
            </button>
            <button
              type="button"
              className={toolBtn(false)}
              onClick={() => clearStrokes(roomId, turnId).catch(() => {})}
            >
              🗑 전체 지우기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
