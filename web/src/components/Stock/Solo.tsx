"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HISTORY, PRESETS, TURNS, maxBuy, type Candle } from "@/lib/stock/solo";
import type { SoloReview, SoloView } from "@/lib/stock/types";
import { soloNext, soloQuit, soloStart, soloState, soloTrade } from "@/realtime/stock";
import Chart, { tradeMarkers, type Ind } from "./Chart";
import { Btn, C, NUM, Pill, Sheet, TITLE, TopBar, WalletChip, comma, pct, signColor, won } from "./ui";

/*
 * 증권거래소 (솔로) — 들어오면 숨겨진 차트 하나로 바로 시작. 턴 = 봉, 거래는 턴을 쓰지 않음.
 * 주문은 모달 대신 오른쪽 패널이 바뀜 (가로 화면에서 차트를 가리지 않게).
 * PC 단축키: B 매수 · S 매도 · 1~4 수량 % · Enter 확인 · Space/→ 다음 봉 · Shift+→ 5봉 · Esc 취소
 */

const CHIPS = [10, 25, 50, 100] as const;

export default function Solo({
  w,
  h,
  total,
  onBack,
  onChanged,
  toast,
}: {
  w: number;
  h: number;
  total: number | null;
  onBack: () => void;
  /** 돈이 바뀜 (지갑 칩 새로) */
  onChanged: () => void;
  toast: (t: string, tone?: "plain" | "up" | "down" | "warn") => void;
}) {
  const [v, setV] = useState<SoloView | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [ind, setInd] = useState<Ind>("macd");
  const [mode, setMode] = useState<null | "buy" | "sell">(null);
  const [qty, setQty] = useState(0);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [result, setResult] = useState<SoloView | null>(null);
  const candlesRef = useRef<Candle[]>([]);

  /** 서버 응답 → 봉 붙이기 (from 이후만 옴) */
  const apply = useCallback((nv: SoloView | null) => {
    if (!nv) return;
    const merged = nv.from === 0 ? nv.candles : [...candlesRef.current.slice(0, nv.from), ...nv.candles];
    candlesRef.current = merged;
    setCandles(merged);
    setV(nv);
    if (nv.done) setResult(nv);
  }, []);

  const run = useCallback(
    async (fn: () => Promise<SoloView | null>) => {
      if (busy) return;
      setBusy(true);
      try {
        apply(await fn());
        onChanged();
      } catch (e) {
        toast((e as Error).message || "잠시 후 다시 해 주세요.", "warn");
      } finally {
        setBusy(false);
      }
    },
    [busy, apply, onChanged, toast]
  );

  const start = useCallback(async () => {
    setResult(null);
    setMode(null);
    candlesRef.current = [];
    setCandles([]);
    await run(async () => (await soloState(0)) ?? (await soloStart()));
  }, [run]);

  useEffect(() => {
    const t = setTimeout(() => void start(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const price = candles.length ? candles[candles.length - 1].c : 0;
  const cash = v?.cash ?? 0;
  const shares = v?.shares ?? 0;
  const avg = shares ? (v?.cost ?? 0) / shares : 0;
  const evalV = shares * price;
  const pnl = shares ? evalV - (v?.cost ?? 0) : 0;
  const most = mode === "buy" ? maxBuy(cash, price) : shares;
  const have = candlesRef.current.length;
  // 이번 판 손익: 판 돈 − 산 돈 + 들고 있는 주식의 지금 값
  const realized = v?.trades.reduce((a, t) => a + (t.side === "sell" ? 1 : -1) * t.qty * t.price, 0) ?? 0;
  const gameRet = v?.startCash ? (realized + evalV) / v.startCash : 0;

  const openOrder = (side: "buy" | "sell") => {
    const m = side === "buy" ? maxBuy(cash, price) : shares;
    if (!m) return toast(side === "buy" ? "현금이 모자라요." : "팔 주식이 없어요.", "warn");
    setMode(side);
    setQty(Math.max(1, Math.floor(m / 2)));
  };
  const confirm = () => {
    if (!mode || qty <= 0) return;
    const side = mode;
    void run(() => soloTrade({ side, qty: Math.min(qty, most), have })).then(() => setMode(null));
  };
  const next = (n: number) => {
    if (!v || v.done) return;
    setMode(null);
    void run(() => soloNext(n, have));
  };

  // 단축키
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (result) return;
      const k = e.key.toLowerCase();
      if (k === "b") openOrder("buy");
      else if (k === "s") openOrder("sell");
      else if (mode && ["1", "2", "3", "4"].includes(k)) setQty(Math.max(1, Math.floor((most * CHIPS[Number(k) - 1]) / 100)));
      else if (mode && k === "enter") confirm();
      else if (k === "escape") setMode(null);
      else if (k === " " || k === "arrowright") {
        e.preventDefault();
        next(e.shiftKey ? 5 : 1);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const panelW = Math.round(Math.max(244, w * 0.29));
  const chartW = w - panelW;
  const chartH = h - 40;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        onBack={onBack}
        title={
          <>
            {v?.done ? v.name : "???"} <span className="text-[12px] font-medium" style={{ color: C.mute }}>· 일봉</span>
          </>
        }
        right={
          <>
            <span className="text-[11px]" style={{ color: C.mute }}>
              이번 판{" "}
              <b className={`text-[13px] ${NUM}`} style={{ color: signColor(gameRet) }}>
                {pct(gameRet)}
              </b>
            </span>
            <WalletChip value={total} />
            <button type="button" aria-label="메뉴" onClick={() => setMenu(true)} className="flex h-[36px] w-[36px] cursor-pointer items-center justify-center" style={{ color: C.mute }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <circle cx="12" cy="12" r="8" />
              </svg>
            </button>
          </>
        }
      >
        <Pill>
          {v?.turn ?? 0} <span style={{ color: C.mute, fontWeight: 500 }}>/ {TURNS}턴</span>
        </Pill>
      </TopBar>

      <div className="flex min-h-0 flex-1">
        <div style={{ width: chartW, height: chartH }}>
          {candles.length > 0 && (
            <Chart candles={candles} width={chartW} height={chartH} markers={v ? tradeMarkers(v.trades, HISTORY) : []} ind={ind} onInd={setInd} bars={w > 900 ? 110 : 90} />
          )}
        </div>
        <div className="flex flex-col gap-[8px] px-[12px] pt-[10px] pb-[12px]" style={{ width: panelW, background: C.panel, borderLeft: `1px solid ${C.line}` }}>
          {!mode ? (
            <>
              <Row k="현재가" v={<b style={{ color: C.up }}>{comma(price)}</b>} />
              <Row k="현금" v={won(cash)} />
              <div className="my-[2px] h-px" style={{ background: C.line }} />
              <Row k="보유" v={`${comma(shares)}주`} />
              <Row k="평단" v={shares ? comma(avg) : "-"} />
              <Row
                k="평가"
                v={
                  shares ? (
                    <b style={{ color: signColor(pnl) }}>
                      {pct(pnl / Math.max(1, v?.cost ?? 1))} {pnl >= 0 ? "+" : ""}
                      {won(pnl)}
                    </b>
                  ) : (
                    "-"
                  )
                }
              />
              <div className="flex-1" />
              <Btn tone="buy" className="h-[52px] text-[16px]" disabled={busy || !v || v.done} onClick={() => openOrder("buy")}>
                매수
              </Btn>
              <Btn tone="sell" className="h-[52px] text-[16px]" disabled={busy || !v || v.done || !shares} onClick={() => openOrder("sell")}>
                매도
              </Btn>
              <div className="flex gap-[8px]">
                <Btn className="h-[48px] flex-1 text-[14px]" disabled={busy || !v || v.done} onClick={() => next(1)}>
                  ▶ 다음
                </Btn>
                <Btn className="h-[48px] w-[72px] text-[14px]" disabled={busy || !v || v.done} onClick={() => next(5)} title="5봉 넘기기">
                  ▶▶
                </Btn>
              </div>
            </>
          ) : (
            <OrderPanel
              side={mode}
              price={price}
              most={most}
              qty={qty}
              setQty={setQty}
              cash={cash}
              busy={busy}
              onConfirm={confirm}
              onCancel={() => setMode(null)}
            />
          )}
        </div>
      </div>

      {menu && (
        <Sheet title="메뉴" onClose={() => setMenu(false)} width={300}>
          <div className="flex flex-col gap-[8px] p-[14px]">
            <Btn className="h-[44px]" disabled={busy || !v || v.done} onClick={() => (setMenu(false), next(TURNS))}>
              ▶▶▶ 끝까지 넘기기
            </Btn>
            <Btn className="h-[44px]" disabled={busy || !v || v.done} onClick={() => (setMenu(false), void run(() => soloQuit(have)))}>
              지금 가격으로 정리하고 그만하기
            </Btn>
            <p className="text-[11px] leading-relaxed" style={{ color: C.mute }}>
              판 도중에 나가도 판은 그대로 남아요. 다시 들어오면 이어서 해요.
            </p>
          </div>
        </Sheet>
      )}

      {result?.result && (
        <ResultSheet
          v={result}
          onNext={() => void start()}
          onBack={onBack}
        />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-[11px]" style={{ color: C.mute }}>
      <span>{k}</span>
      <span className={`text-[13px] font-bold ${NUM}`} style={{ color: C.text }}>
        {v}
      </span>
    </div>
  );
}

function OrderPanel({
  side,
  price,
  most,
  qty,
  setQty,
  cash,
  busy,
  onConfirm,
  onCancel,
}: {
  side: "buy" | "sell";
  price: number;
  most: number;
  qty: number;
  setQty: (n: number) => void;
  cash: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const buy = side === "buy";
  const q = Math.min(qty, most);
  const pick = (p: number) => setQty(Math.max(1, Math.floor((most * p) / 100)));
  const curPct = most ? Math.round((q / most) * 100) : 0;
  // 길게 누르면 빨리 바뀜
  const hold = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepBy = Math.max(1, Math.round(most / 100));
  const press = (d: number) => {
    setQty(Math.min(most, Math.max(1, q + d)));
    let n = q + d;
    hold.current = setInterval(() => {
      n = Math.min(most, Math.max(1, n + d * stepBy));
      setQty(n);
    }, 120);
  };
  const release = () => {
    if (hold.current) clearInterval(hold.current);
    hold.current = null;
  };
  return (
    <>
      <div className="flex items-center gap-[8px]">
        <span className="rounded-[6px] px-[10px] py-[3px] text-[13px] font-black text-white" style={{ background: buy ? C.upBg : C.downBg }}>
          {buy ? "매수" : "매도"}
        </span>
        <span className="text-[11px]" style={{ color: C.mute }}>
          종가로 체결 · 턴 안 넘어감
        </span>
        <div className="flex-1" />
        <button type="button" aria-label="닫기" onClick={onCancel} className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center" style={{ color: C.mute }}>
          ✕
        </button>
      </div>
      <Row k="현재가" v={<b style={{ color: C.up }}>{comma(price)}</b>} />
      <Row k={buy ? "주문 가능" : "보유"} v={buy ? won(cash) : `${comma(most)}주`} />
      <div className="grid grid-cols-4 gap-[6px]">
        {CHIPS.map((p) => (
          <Btn key={p} active={curPct === p} className="h-[36px] text-[12px]" onClick={() => pick(p)}>
            {p === 100 ? (buy ? "몰빵" : "전부") : `${p}%`}
          </Btn>
        ))}
      </div>
      <div className="flex items-center gap-[6px]">
        <Btn className="h-[44px] w-[44px] text-[20px]" aria-label="수량 줄이기" onPointerDown={() => press(-1)} onPointerUp={release} onPointerLeave={release}>
          −
        </Btn>
        <div className={`flex h-[44px] flex-1 items-center justify-center rounded-[8px] text-[16px] font-bold ${NUM}`} style={{ background: C.bg, border: `1px solid ${C.line}` }}>
          {comma(q)}
          <span className="ml-[3px] text-[11px]" style={{ color: C.mute }}>
            주
          </span>
        </div>
        <Btn className="h-[44px] w-[44px] text-[20px]" aria-label="수량 늘리기" onPointerDown={() => press(1)} onPointerUp={release} onPointerLeave={release}>
          +
        </Btn>
      </div>
      <div className="flex items-baseline justify-between text-[11px]" style={{ color: C.mute }}>
        <span>주문 금액</span>
        <span className={`text-[16px] font-black ${NUM}`} style={{ color: C.text }}>
          {won(q * price)}
        </span>
      </div>
      <div className="flex-1" />
      <div className="flex gap-[8px]">
        <Btn tone={buy ? "buy" : "sell"} className="h-[48px] flex-1 text-[15px]" disabled={busy || q <= 0} onClick={onConfirm}>
          {buy ? "매수" : "매도"} 확인
        </Btn>
        <Btn tone="ghost" className="h-[48px] w-[72px] text-[14px]" onClick={onCancel}>
          취소
        </Btn>
      </div>
    </>
  );
}

function ResultSheet({ v, onNext, onBack }: { v: SoloView; onNext: () => void; onBack: () => void }) {
  const r = v.result!;
  const win = r.pnl > 0;
  return (
    <Sheet width={440}>
      <div className="flex flex-col items-center gap-[10px] p-[18px] text-center">
        <div className="text-[12px]" style={{ color: C.mute }}>
          이번 종목은
        </div>
        <div className={`${TITLE} text-[26px] leading-none`}>{r.name}</div>
        <div className="rounded-full px-[12px] py-[3px] text-[12px] font-bold" style={{ background: C.goldBg, color: C.gold, border: `1px solid ${C.gold}` }}>
          {PRESETS[r.preset].name} · {PRESETS[r.preset].blurb}
        </div>
        <div className={`${TITLE} mt-[4px] text-[40px] leading-none`} style={{ color: signColor(r.pnl) }}>
          {pct(r.ret, 2)}
        </div>
        <div className={`text-[14px] font-bold ${NUM}`} style={{ color: signColor(r.pnl) }}>
          {r.pnl >= 0 ? "+" : ""}
          {won(r.pnl)}
        </div>
        <div className="grid w-full grid-cols-3 gap-[6px] text-[11px]" style={{ color: C.mute }}>
          <Stat k="기초자산" v={won(r.start)} />
          <Stat k="최종자산" v={won(r.final)} />
          <Stat k="매매(왕복)" v={`${r.trips}회 · 익절 ${r.wins}`} />
        </div>
        {r.turns < TURNS && (
          <div className="text-[11px]" style={{ color: C.mute }}>
            {r.turns}턴에서 정리했어요
          </div>
        )}
        {r.revived && (
          <div className="rounded-[8px] px-[10px] py-[6px] text-[12px] font-bold" style={{ background: C.goldBg, color: C.gold }}>
            회생 자금 {won(r.revived.amount)}을 받았어요 (오늘 {r.revived.left}번 남음)
          </div>
        )}
        <div className="mt-[6px] flex w-full gap-[8px]">
          <Btn tone="gold" className="h-[46px] flex-1 text-[15px]" onClick={onNext}>
            다음 판
          </Btn>
          <Btn tone="ghost" className="h-[46px] w-[110px] text-[13px]" onClick={onBack}>
            {win ? "마을로" : "그만하기"}
          </Btn>
        </div>
      </div>
    </Sheet>
  );
}

const Stat = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-[8px] px-[6px] py-[6px]" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
    <div>{k}</div>
    <div className={`mt-[2px] text-[12px] font-bold ${NUM}`} style={{ color: C.text }}>
      {v}
    </div>
  </div>
);

/** 복기: 끝난 판 차트 전체 + 내 매매 */
export function Review({ r, w, h, onBack }: { r: SoloReview; w: number; h: number; onBack: () => void }) {
  const [ind, setInd] = useState<Ind>("macd");
  return (
    <div className="flex h-full flex-col">
      <TopBar
        onBack={onBack}
        title={
          <>
            복기 · {r.name} <span className="text-[12px] font-medium" style={{ color: C.gold }}>{PRESETS[r.preset].name}</span>
          </>
        }
        right={
          <span className={`text-[13px] font-bold ${NUM}`} style={{ color: signColor(r.result.pnl) }}>
            {pct(r.result.ret, 2)} · {r.result.pnl >= 0 ? "+" : ""}
            {won(r.result.pnl)}
          </span>
        }
      />
      <Chart candles={r.candles} width={w} height={h - 40} markers={tradeMarkers(r.trades, HISTORY)} ind={ind} onInd={setInd} bars={110} dim={HISTORY} />
    </div>
  );
}
