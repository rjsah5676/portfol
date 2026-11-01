"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cci, macd, sma, stoch } from "@/lib/stock/indicators";
import type { Candle, SoloTrade } from "@/lib/stock/solo";
import { C, comma } from "./ui";

/*
 * 캔들 차트 (캔버스). 위: 캔들 + 이평 5/10/20/60/120 + 거래량(아래 1/5 겹쳐서) + 매매 표시 + 현재가 태그 + 예약 주문 선.
 * 아래: 보조지표 (MACD · 스토캐스틱 · CCI) — 폰은 1개, PC 는 2개 동시.
 * 줌: 휠(PC) · 두 손가락 벌리기(폰) · 오른쪽 아래 − + 전체 버튼. 드래그로 과거 보기, 손 떼면 「최신으로」.
 * 매매 표시는 매수는 봉 아래 · 매도는 봉 위, 같은 봉에 여러 번이면 하나로 묶어 「B×2 12,300」.
 */

export type Ind = "macd" | "stoch" | "cci";
const IND_NAME: Record<Ind, string> = { macd: "MACD", stoch: "스토캐스틱", cci: "CCI" };
export const IND_IDS = Object.keys(IND_NAME) as Ind[];
const AXIS = 54;
export const MA_PERIODS = [5, 10, 20, 60, 120] as const;
const MIN_BARS = 20;

export interface Marker {
  /** 봉 번호 (candles 기준) */
  i: number;
  side: "buy" | "sell";
  /** 평균 체결가 */
  price: number;
  /** 같은 봉 · 같은 방향 횟수 */
  n: number;
}

export function tradeMarkers(trades: SoloTrade[], historyLen: number): Marker[] {
  // 같은 봉 · 같은 방향은 하나로 (수량 가중 평균가)
  const seen = new Map<string, { i: number; side: "buy" | "sell"; qty: number; amt: number; n: number }>();
  for (const t of trades) {
    const i = historyLen - 1 + t.turn;
    const k = `${i}:${t.side}`;
    const cur = seen.get(k) ?? { i, side: t.side, qty: 0, amt: 0, n: 0 };
    cur.qty += t.qty;
    cur.amt += t.qty * t.price;
    cur.n++;
    seen.set(k, cur);
  }
  return [...seen.values()].map((m) => ({ i: m.i, side: m.side, price: m.qty ? m.amt / m.qty : 0, n: m.n }));
}

/** 예약 주문 선 (화면에 가로선으로) */
export interface PriceLine {
  price: number;
  label: string;
  color: string;
}

export default function Chart({
  candles,
  width,
  height,
  markers = [],
  inds,
  onInds,
  bars: barsDefault = 90,
  dim,
  lines = [],
  log,
}: {
  candles: Candle[];
  width: number;
  height: number;
  markers?: Marker[];
  /** 보조지표 (1개 또는 2개) */
  inds: Ind[];
  onInds: (i: Ind[]) => void;
  bars?: number;
  /** 이 번호부터는 흐리게 (복기: 판이 시작된 지점 표시) */
  dim?: number;
  lines?: PriceLine[];
  /** 로그 스케일 */
  log?: boolean;
}) {
  const cv = useRef<HTMLCanvasElement | null>(null);
  const [bars, setBars] = useState(barsDefault);
  const [offset, setOffset] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ x: number; off: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; bars: number } | null>(null);
  const pts = useRef(new Map<number, number>());
  const [dragging, setDragging] = useState(false);
  const tabsH = 22;
  const nInd = Math.max(1, Math.min(2, inds.length));
  const priceH = Math.round((height - tabsH * nInd) * (nInd === 2 ? 0.62 : 0.7));
  const indH = Math.floor((height - tabsH * nInd - priceH - 4) / nInd);
  const plotW = width - AXIS - 8;

  const ma = useMemo(() => Object.fromEntries(MA_PERIODS.map((p) => [p, sma(candles, p)])) as Record<number, (number | null)[]>, [candles]);
  const indData = useMemo(
    () =>
      inds.slice(0, 2).map((ind): { a: (number | null)[]; b: (number | null)[] | null; hist: number[] | null } => {
        if (ind === "macd") return macd(candles);
        if (ind === "stoch") return { ...stoch(candles), hist: null };
        return { a: cci(candles), b: null, hist: null };
      }),
    [candles, inds]
  );

  const n = Math.min(bars, candles.length);
  const maxOff = Math.max(0, candles.length - n);
  const off = Math.min(offset, maxOff);
  const end = candles.length - off;
  const start = Math.max(0, end - n);
  const step = plotW / n;
  const zoomTo = (b: number) => setBars(Math.min(Math.max(MIN_BARS, candles.length), Math.max(MIN_BARS, Math.round(b))));

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
      for (const p of MA_PERIODS) {
        const m = ma[p][start + k];
        if (m !== null) {
          hi = Math.max(hi, m);
          lo = Math.min(lo, m);
        }
      }
    });
    for (const l of lines) if (l.price > 0) (hi = Math.max(hi, l.price)), (lo = Math.min(lo, l.price));
    const tr = log ? Math.log : (v: number) => v;
    let thi = tr(hi),
      tlo = tr(lo);
    const pad = (thi - tlo) * 0.08 || thi * 0.05;
    thi += pad;
    tlo -= pad;
    const top = 14,
      ph = priceH - top - 2;
    const y = (p: number) => top + ((thi - tr(p)) / (thi - tlo)) * ph;
    const x = (i: number) => (i - start) * step + step / 2 + 4;
    const cw = Math.max(1, Math.min(14, step * 0.66));

    // 격자 · 가격 눈금
    g.font = "10px Barlow, sans-serif";
    g.textBaseline = "middle";
    for (let t = 0; t < 4; t++) {
      const tv = thi - ((thi - tlo) * (t + 0.5)) / 4;
      const pv = log ? Math.exp(tv) : tv;
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
    // 이평선 (긴 것부터 아래에)
    for (const p of [...MA_PERIODS].reverse()) {
      g.strokeStyle = C.ma[p];
      g.lineWidth = p === 5 ? 1.3 : 1.1;
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
    // 예약 주문 선
    g.font = "bold 9px Barlow, 'Nanum Gothic', sans-serif";
    for (const l of lines) {
      if (l.price <= 0) continue;
      const ly = y(l.price);
      if (ly < top || ly > top + ph) continue;
      g.strokeStyle = l.color;
      g.setLineDash([5, 3]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(4, Math.round(ly) + 0.5);
      g.lineTo(plotW + 4, Math.round(ly) + 0.5);
      g.stroke();
      g.setLineDash([]);
      const tw = g.measureText(l.label).width + 8;
      g.fillStyle = l.color;
      g.beginPath();
      g.roundRect(8, ly - 7, tw, 13, 3);
      g.fill();
      g.fillStyle = "#fff";
      g.fillText(l.label, 12, ly);
    }
    // 매매 표시 — 매수는 봉 아래, 매도는 봉 위. 옆 표시와 겹치면 한 줄 더 내려(올려) 그림
    const lanes: { buy: number[]; sell: number[] } = { buy: [], sell: [] }; // 레인마다 마지막 오른쪽 끝
    const sorted = [...markers].filter((m) => m.i >= start && m.i < end).sort((a, b) => a.i - b.i);
    for (const m of sorted) {
      const c = candles[m.i];
      const buy = m.side === "buy";
      const label = `${buy ? "B" : "S"}${m.n > 1 ? `×${m.n}` : ""} ${comma(m.price)}`;
      const tw = g.measureText(label).width + 8;
      const xx = Math.min(plotW - tw + 4, Math.max(4, x(m.i) - tw / 2));
      const laneArr = lanes[m.side];
      let lane = laneArr.findIndex((r) => r < xx - 2);
      if (lane < 0) {
        lane = Math.min(laneArr.length, 2);
        if (lane === laneArr.length) laneArr.push(0);
      }
      laneArr[lane] = xx + tw;
      const yy = buy ? Math.min(top + ph - 14, y(c.l) + 6 + lane * 15) : Math.max(top, y(c.h) - 20 - lane * 15);
      // 봉까지 작은 꼬리
      g.strokeStyle = buy ? C.upBg : C.downBg;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x(m.i), buy ? y(c.l) + 1 : y(c.h) - 1);
      g.lineTo(x(m.i), buy ? yy : yy + 14);
      g.stroke();
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

    // 보조지표 칸들
    let iy0 = priceH + tabsH + 4;
    indData.forEach((indv, q) => {
      const ind = inds[q];
      const y0 = iy0;
      g.strokeStyle = C.line;
      g.beginPath();
      g.moveTo(0, y0 - tabsH - 4 + 0.5);
      g.lineTo(width, y0 - tabsH - 4 + 0.5);
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
      const iy = (v: number) => y0 + ((imax - v) / (imax - imin)) * (indH - 4);
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
          const a0 = iy(0),
            a1 = iy(v);
          g.fillRect(x(start + k) - cw / 2, Math.min(a0, a1), cw, Math.max(1, Math.abs(a1 - a0)));
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
      iy0 += indH + tabsH;
    });

    // 십자선
    if (hover !== null && hover >= start && hover < end) {
      g.strokeStyle = "rgba(232,236,244,0.35)";
      g.beginPath();
      g.moveTo(Math.round(x(hover)) + 0.5, top);
      g.lineTo(Math.round(x(hover)) + 0.5, height);
      g.stroke();
    }
  }, [candles, width, height, start, end, step, priceH, indH, plotW, ma, indData, inds, markers, hover, dim, lines, log, tabsH]);

  const idxAt = (clientX: number) => {
    const el = cv.current!;
    const r = el.getBoundingClientRect();
    const lx = ((clientX - r.left) / r.width) * width - 4;
    return Math.min(end - 1, Math.max(start, start + Math.floor(lx / step)));
  };

  const hv = hover !== null ? candles[hover] : null;
  const prev = hover !== null && hover > 0 ? candles[hover - 1] : null;
  const pinchDist = () => {
    const v = [...pts.current.values()];
    return v.length >= 2 ? Math.abs(v[0] - v[1]) : 0;
  };

  return (
    <div className="relative select-none" style={{ width, height }}>
      <canvas
        ref={cv}
        style={{ width, height, touchAction: "none", cursor: dragging ? "grabbing" : "crosshair" }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          pts.current.set(e.pointerId, e.clientX);
          if (pts.current.size >= 2) {
            pinch.current = { d: pinchDist(), bars };
            drag.current = null;
            setHover(null);
            return;
          }
          drag.current = { x: e.clientX, off, moved: false };
          setDragging(true);
          if (e.pointerType !== "mouse") setHover(idxAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, e.clientX);
          const p = pinch.current;
          if (p && pts.current.size >= 2) {
            const d = pinchDist();
            if (p.d > 10 && d > 10) zoomTo(p.bars * (p.d / d));
            return;
          }
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
        onPointerUp={(e) => {
          pts.current.delete(e.pointerId);
          if (pts.current.size < 2) pinch.current = null;
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={(e) => {
          pts.current.delete(e.pointerId);
          pinch.current = null;
          drag.current = null;
          setDragging(false);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setHover(null);
        }}
        onWheel={(e) => zoomTo(bars * (e.deltaY > 0 ? 1.12 : 0.9))}
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
            {MA_PERIODS.map((p) => (
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
      {/* 줌 */}
      <div className="absolute flex gap-[3px]" style={{ right: AXIS + 10, top: priceH - 26 }}>
        {[
          { k: "−", f: () => zoomTo(bars * 1.3), t: "축소" },
          { k: "+", f: () => zoomTo(bars / 1.3), t: "확대" },
          { k: "전체", f: () => (zoomTo(candles.length), setOffset(0)), t: "전체 흐름 보기" },
        ].map((b) => (
          <button
            key={b.k}
            type="button"
            title={b.t}
            onClick={b.f}
            className="h-[22px] min-w-[22px] cursor-pointer rounded-[6px] px-[6px] text-[11px] font-bold"
            style={{ background: "rgba(30,39,64,0.85)", border: `1px solid ${C.chipLine}`, color: C.text }}
          >
            {b.k}
          </button>
        ))}
      </div>
      {/* 보조지표 탭 (칸마다) */}
      {inds.slice(0, 2).map((cur, q) => (
        <div key={q} className="absolute left-[8px] flex gap-[4px]" style={{ top: priceH + 2 + q * (indH + tabsH) }}>
          {IND_IDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                const next = [...inds];
                next[q] = k;
                onInds(next);
              }}
              className="h-[18px] cursor-pointer rounded-[6px] px-[8px] text-[10px] font-bold"
              style={k === cur ? { border: `1px solid ${C.gold}`, background: C.goldBg, color: C.gold } : { border: `1px solid ${C.line}`, background: "none", color: C.mute }}
            >
              {IND_NAME[k]}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
