"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cci, macd, sma, stoch } from "@/lib/stock/indicators";
import type { Candle, SoloTrade } from "@/lib/stock/solo";
import { C, comma } from "./ui";

/*
 * 캔들 차트 (캔버스). 위: 캔들 + 이평 5/20/60/120 + 거래량(아래 1/5 겹쳐서) + 매매 표시 + 현재가 태그.
 * 아래: 보조지표 하나 (MACD · 스토캐스틱 · CCI 탭).
 * 드래그로 과거 보기 · 휠로 확대(PC) · 누르거나 올리면 그 봉의 시가 · 고가 · 저가 · 종가.
 */

export type Ind = "macd" | "stoch" | "cci";
const IND_NAME: Record<Ind, string> = { macd: "MACD", stoch: "스토캐스틱", cci: "CCI" };
const AXIS = 54;

export interface Marker {
  /** 봉 번호 (candles 기준) */
  i: number;
  side: "buy" | "sell";
  price: number;
}

export function tradeMarkers(trades: SoloTrade[], historyLen: number): Marker[] {
  // 같은 봉 · 같은 방향은 하나로
  const seen = new Map<string, Marker>();
  for (const t of trades) {
    const i = historyLen - 1 + t.turn;
    seen.set(`${i}:${t.side}`, { i, side: t.side, price: t.price });
  }
  return [...seen.values()];
}

export default function Chart({
  candles,
  width,
  height,
  markers = [],
  ind,
  onInd,
  bars: barsDefault = 90,
  dim,
}: {
  candles: Candle[];
  width: number;
  height: number;
  markers?: Marker[];
  ind: Ind;
  onInd: (i: Ind) => void;
  bars?: number;
  /** 이 번호부터는 흐리게 (복기: 판이 시작된 지점 표시) */
  dim?: number;
}) {
  const cv = useRef<HTMLCanvasElement | null>(null);
  const [bars, setBars] = useState(barsDefault);
  const [offset, setOffset] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ x: number; off: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const tabsH = 24;
  const priceH = Math.round((height - tabsH) * 0.7);
  const indH = height - tabsH - priceH - 4;
  const plotW = width - AXIS - 8;

  const ma = useMemo(() => ({ 5: sma(candles, 5), 20: sma(candles, 20), 60: sma(candles, 60), 120: sma(candles, 120) }), [candles]);
  const indv = useMemo((): { a: (number | null)[]; b: (number | null)[] | null; hist: number[] | null } => {
    if (ind === "macd") return macd(candles);
    if (ind === "stoch") return { ...stoch(candles), hist: null };
    return { a: cci(candles), b: null, hist: null };
  }, [candles, ind]);

  const n = Math.min(bars, candles.length);
  const maxOff = Math.max(0, candles.length - n);
  const off = Math.min(offset, maxOff);
  const end = candles.length - off;
  const start = Math.max(0, end - n);
  const step = plotW / n;

  useEffect(() => {
    const el = cv.current;
    if (!el) return;
    // 무대 확대 비율까지 곱해서 선명하게
    const rect = el.getBoundingClientRect();
    const zoom = rect.width / width || 1;
    const dpr = Math.min(3, (window.devicePixelRatio || 1) * zoom);
    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);
    const g = el.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    if (!candles.length) return;
    const vis = candles.slice(start, end);
    let hi = -Infinity,
      lo = Infinity,
      vmax = 0;
    vis.forEach((c, k) => {
      hi = Math.max(hi, c.h);
      lo = Math.min(lo, c.l);
      vmax = Math.max(vmax, c.v);
      for (const p of [5, 20, 60, 120] as const) {
        const m = ma[p][start + k];
        if (m !== null) {
          hi = Math.max(hi, m);
          lo = Math.min(lo, m);
        }
      }
    });
    const pad = (hi - lo) * 0.08 || hi * 0.05;
    hi += pad;
    lo -= pad;
    const top = 14,
      ph = priceH - top - 2;
    const y = (p: number) => top + ((hi - p) / (hi - lo)) * ph;
    const x = (i: number) => (i - start) * step + step / 2 + 4;
    const cw = Math.max(1, Math.min(14, step * 0.66));

    // 격자 · 가격 눈금
    g.font = "10px Barlow, sans-serif";
    g.textBaseline = "middle";
    for (let t = 0; t < 4; t++) {
      const pv = hi - ((hi - lo) * (t + 0.5)) / 4;
      const yy = y(pv);
      g.strokeStyle = "rgba(38,48,73,0.6)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(4, Math.round(yy) + 0.5);
      g.lineTo(plotW + 4, Math.round(yy) + 0.5);
      g.stroke();
      g.fillStyle = C.mute;
      g.fillText(comma(pv), plotW + 10, yy);
    }
    // 판 시작 지점 (복기)
    if (dim !== undefined && dim > start && dim < end) {
      const xx = x(dim) - step / 2;
      g.fillStyle = "rgba(242,193,78,0.06)";
      g.fillRect(xx, top, plotW + 4 - xx, ph);
      g.strokeStyle = "rgba(242,193,78,0.4)";
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(xx, top);
      g.lineTo(xx, top + ph);
      g.stroke();
      g.setLineDash([]);
    }
    // 거래량 (가격 칸 아래 1/5)
    const vh = ph * 0.2;
    vis.forEach((c, k) => {
      const i = start + k;
      const up = c.c >= c.o;
      const h = Math.max(1, (c.v / vmax) * vh);
      g.fillStyle = up ? "rgba(255,92,102,0.28)" : "rgba(77,141,255,0.28)";
      g.fillRect(x(i) - cw / 2, top + ph - h, cw, h);
    });
    // 캔들
    vis.forEach((c, k) => {
      const i = start + k;
      const up = c.c >= c.o;
      g.fillStyle = g.strokeStyle = up ? C.up : C.down;
      const xx = x(i);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.round(xx) + 0.5, y(c.h));
      g.lineTo(Math.round(xx) + 0.5, y(c.l));
      g.stroke();
      const yt = y(Math.max(c.o, c.c)),
        yb = y(Math.min(c.o, c.c));
      g.fillRect(xx - cw / 2, yt, cw, Math.max(1, yb - yt));
    });
    // 이평선
    for (const p of [120, 60, 20, 5] as const) {
      g.strokeStyle = C.ma[p];
      g.lineWidth = 1.2;
      g.beginPath();
      let on = false;
      for (let i = start; i < end; i++) {
        const m = ma[p][i];
        if (m === null) continue;
        if (!on) g.moveTo(x(i), y(m));
        else g.lineTo(x(i), y(m));
        on = true;
      }
      g.stroke();
    }
    // 매매 표시
    g.font = "bold 9px Barlow, 'Nanum Gothic', sans-serif";
    for (const m of markers) {
      if (m.i < start || m.i >= end) continue;
      const c = candles[m.i];
      const buy = m.side === "buy";
      const label = `${buy ? "Buy" : "Sell"} ${comma(m.price)}`;
      const tw = g.measureText(label).width + 8;
      const xx = Math.min(plotW - tw + 4, Math.max(4, x(m.i) - tw / 2));
      const yy = buy ? Math.min(top + ph - 14, y(c.l) + 6) : Math.max(top, y(c.h) - 20);
      g.fillStyle = buy ? C.upBg : C.downBg;
      g.beginPath();
      g.roundRect(xx, yy, tw, 14, 4);
      g.fill();
      g.fillStyle = "#fff";
      g.fillText(label, xx + 4, yy + 7);
    }
    // 현재가 (최신 봉)
    const last = candles[candles.length - 1];
    const ly = y(last.c);
    if (ly > top - 2 && ly < top + ph + 2) {
      g.strokeStyle = C.up;
      g.setLineDash([4, 3]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(4, Math.round(ly) + 0.5);
      g.lineTo(plotW + 4, Math.round(ly) + 0.5);
      g.stroke();
      g.setLineDash([]);
    }
    const tagY = Math.min(top + ph - 8, Math.max(top + 8, ly));
    g.fillStyle = C.upBg;
    g.beginPath();
    g.roundRect(plotW + 6, tagY - 8, AXIS - 4, 16, 3);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "bold 10px Barlow, sans-serif";
    g.fillText(comma(last.c), plotW + 10, tagY);

    // 보조지표
    const iy0 = priceH + tabsH + 4;
    g.strokeStyle = C.line;
    g.beginPath();
    g.moveTo(0, priceH + 0.5);
    g.lineTo(width, priceH + 0.5);
    g.stroke();
    const A = indv.a.slice(start, end),
      B = indv.b?.slice(start, end) ?? null,
      Hh = indv.hist?.slice(start, end) ?? null;
    let imin: number, imax: number;
    if (ind === "stoch") {
      imin = 0;
      imax = 100;
    } else {
      const all = [...A, ...(B ?? []), ...(Hh ?? [])].filter((v): v is number => v !== null && Number.isFinite(v));
      const mm = Math.max(1e-9, ...all.map(Math.abs));
      imin = ind === "cci" ? Math.min(-150, -mm) : -mm;
      imax = ind === "cci" ? Math.max(150, mm) : mm;
    }
    const iy = (v: number) => iy0 + ((imax - v) / (imax - imin)) * (indH - 4);
    const guides = ind === "stoch" ? [20, 80] : ind === "cci" ? [-100, 100] : [0];
    g.setLineDash([2, 3]);
    g.strokeStyle = "rgba(139,149,171,0.35)";
    for (const v of guides) {
      g.beginPath();
      g.moveTo(4, iy(v));
      g.lineTo(plotW + 4, iy(v));
      g.stroke();
    }
    g.setLineDash([]);
    if (Hh) {
      Hh.forEach((v, k) => {
        if (v === null) return;
        g.fillStyle = v >= 0 ? "rgba(255,92,102,0.55)" : "rgba(77,141,255,0.55)";
        const y0 = iy(0),
          y1 = iy(v);
        g.fillRect(x(start + k) - cw / 2, Math.min(y0, y1), cw, Math.max(1, Math.abs(y1 - y0)));
      });
    }
    const line = (arr: (number | null)[], col: string) => {
      g.strokeStyle = col;
      g.lineWidth = 1.1;
      g.beginPath();
      let on = false;
      arr.forEach((v, k) => {
        if (v === null || !Number.isFinite(v)) return;
        if (!on) g.moveTo(x(start + k), iy(v));
        else g.lineTo(x(start + k), iy(v));
        on = true;
      });
      g.stroke();
    };
    line(A, C.gold);
    if (B) line(B, "#C77DFF");

    // 십자선
    if (hover !== null && hover >= start && hover < end) {
      g.strokeStyle = "rgba(232,236,244,0.35)";
      g.beginPath();
      g.moveTo(Math.round(x(hover)) + 0.5, top);
      g.lineTo(Math.round(x(hover)) + 0.5, height);
      g.stroke();
    }
  }, [candles, width, height, start, end, step, priceH, indH, plotW, ma, indv, ind, markers, hover, dim]);

  const idxAt = (clientX: number) => {
    const el = cv.current!;
    const r = el.getBoundingClientRect();
    const lx = ((clientX - r.left) / r.width) * width - 4;
    return Math.min(end - 1, Math.max(start, start + Math.floor(lx / step)));
  };

  const hv = hover !== null ? candles[hover] : null;
  const prev = hover !== null && hover > 0 ? candles[hover - 1] : null;

  return (
    <div className="relative select-none" style={{ width, height }}>
      <canvas
        ref={cv}
        style={{ width, height, touchAction: "none", cursor: dragging ? "grabbing" : "crosshair" }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, off, moved: false };
          setDragging(true);
          if (e.pointerType !== "mouse") setHover(idxAt(e.clientX));
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) {
            const r = cv.current!.getBoundingClientRect();
            const dx = ((e.clientX - d.x) / r.width) * width;
            if (Math.abs(dx) > 4) d.moved = true;
            if (d.moved) {
              setOffset(Math.min(maxOff, Math.max(0, Math.round(d.off + dx / step))));
              if (e.pointerType !== "mouse") setHover(null);
            }
          }
          if (e.pointerType === "mouse" || !d?.moved) setHover(idxAt(e.clientX));
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setHover(null);
        }}
        onWheel={(e) => {
          setBars((b) => Math.min(200, Math.max(30, Math.round(b * (e.deltaY > 0 ? 1.12 : 0.9)))));
        }}
      />
      {/* 이평 범례 · 십자선 정보 */}
      <div className="pointer-events-none absolute top-[2px] left-[8px] flex gap-[8px] text-[10px]" style={{ color: C.mute }}>
        {hv ? (
          <span>
            시 {comma(hv.o)} · 고 <b style={{ color: C.up }}>{comma(hv.h)}</b> · 저 <b style={{ color: C.down }}>{comma(hv.l)}</b> · 종 <b style={{ color: C.text }}>{comma(hv.c)}</b>
            {prev && (
              <b className="ml-[4px]" style={{ color: hv.c >= prev.c ? C.up : C.down }}>
                {hv.c >= prev.c ? "+" : ""}
                {(((hv.c - prev.c) / prev.c) * 100).toFixed(2)}%
              </b>
            )}
          </span>
        ) : (
          <>
            <span>MA</span>
            {[5, 20, 60, 120].map((p) => (
              <span key={p} style={{ color: C.ma[p] }}>
                {p}
              </span>
            ))}
          </>
        )}
      </div>
      {off > 0 && (
        <button
          type="button"
          onClick={() => setOffset(0)}
          className="absolute top-[18px] cursor-pointer rounded-full px-[8px] py-[2px] text-[10px] font-bold"
          style={{ right: AXIS + 12, background: C.chip, border: `1px solid ${C.chipLine}`, color: C.text }}
        >
          최신으로 ▶
        </button>
      )}
      <div className="absolute left-[8px] flex gap-[4px]" style={{ top: priceH + 2 }}>
        {(Object.keys(IND_NAME) as Ind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onInd(k)}
            className="h-[20px] cursor-pointer rounded-[6px] px-[9px] text-[10px] font-bold"
            style={k === ind ? { border: `1px solid ${C.gold}`, background: C.goldBg, color: C.gold } : { border: `1px solid ${C.line}`, background: "none", color: C.mute }}
          >
            {IND_NAME[k]}
          </button>
        ))}
      </div>
    </div>
  );
}
