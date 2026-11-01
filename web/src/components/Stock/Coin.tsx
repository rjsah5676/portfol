"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COIN_HISTORY, COIN_TURNS, LEVERAGES, coinDateAt, fmtHour, liqPrice, marginValue, type CoinTrade, type Leverage } from "@/lib/stock/coin";
import type { Candle } from "@/lib/stock/solo";
import type { CoinReview, CoinView } from "@/lib/stock/types";
import { coinClose, coinNext, coinOpen, coinQuit, coinStart, coinState } from "@/realtime/stock";
import Chart, { type Ind, type Marker, type PriceLine } from "./Chart";
import { Btn, C, NUM, Pill, Sheet, TITLE, TopBar, WalletChip, comma, pct, signColor, won } from "./ui";

/*
 * 코인 거래소 — 1턴 = 1시간봉 · 50턴 · 가격제한 없음 · 레버리지 1 · 3 · 10배 (롱) · 청산.
 * 포지션은 한 판에 하나. 오른쪽 패널: 진입(증거금 % 칩 + 배수) · 정리(비율) · 다음 봉.
 * PC 단축키: B 진입 · S 정리 · 1~4 증거금 % · Q/W/E 배수 1/3/10 · Enter 확인 · Space/→ 다음 · Esc 취소
 */

const CHIPS = [10, 25, 50, 100] as const;
const ACC = "#F7B32B";
const fmtPrice = (p: number) => (p < 100 ? p.toFixed(2) : p < 1000 ? p.toFixed(1) : comma(p));

function coinMarkers(trades: CoinTrade[]): Marker[] {
  const seen = new Map<string, { i: number; side: "buy" | "sell"; amt: number; q: number; n: number }>();
  for (const t of trades) {
    const i = COIN_HISTORY - 1 + t.turn;
    const side = t.side === "open" ? "buy" : "sell";
    const k = `${i}:${side}`;
    const cur = seen.get(k) ?? { i, side, amt: 0, q: 0, n: 0 };
    cur.amt += t.price;
    cur.q += 1;
    cur.n++;
    seen.set(k, cur);
  }
  return [...seen.values()].map((m) => ({ i: m.i, side: m.side, price: m.amt / m.q, n: m.n }));
}

export default function Coin({
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
  onChanged: () => void;
  toast: (t: string, tone?: "plain" | "up" | "down" | "warn") => void;
}) {
  const [v, setV] = useState<CoinView | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const pc = w > 900;
  const [inds, setInds] = useState<Ind[]>(pc ? ["macd", "stoch"] : ["macd"]);
  const [mode, setMode] = useState<null | "open" | "close">(null);
  const [margin, setMargin] = useState(0);
  const [lev, setLev] = useState<Leverage>(3);
  const [closePct, setClosePct] = useState(100);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [result, setResult] = useState<CoinView | null>(null);
  const [liqFx, setLiqFx] = useState<{ margin: number } | null>(null);
  const candlesRef = useRef<Candle[]>([]);

  const apply = useCallback(
    (nv: CoinView | null) => {
      if (!nv) return;
      const merged = nv.from === 0 ? nv.candles : [...candlesRef.current.slice(0, nv.from), ...nv.candles];
      candlesRef.current = merged;
      setCandles(merged);
      setV(nv);
      if (nv.liq) {
        setLiqFx({ margin: nv.liq.margin });
        toast(`청산! 증거금 ${won(nv.liq.margin)}이 사라졌어요`, "down");
      }
      if (nv.done) setResult(nv);
    },
    [toast]
  );
  const run = useCallback(
    async (fn: () => Promise<CoinView | null>) => {
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
    setLiqFx(null);
    candlesRef.current = [];
    setCandles([]);
    await run(async () => (await coinState(0)) ?? (await coinStart()));
  }, [run]);
  useEffect(() => {
    const t = setTimeout(() => void start(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!liqFx) return;
    const t = setTimeout(() => setLiqFx(null), 1400);
    return () => clearTimeout(t);
  }, [liqFx]);

  const price = candles.length ? candles[candles.length - 1].c : 0;
  const cash = v?.cash ?? 0;
  const pos = v?.pos ?? null;
  const posVal = pos ? marginValue(pos.margin, pos.lev, pos.entry, price) : 0;
  const posPnl = pos ? posVal - pos.margin : 0;
  const have = candlesRef.current.length;
  const put = v?.trades.reduce((a, t) => a + (t.side === "open" ? t.margin : 0), 0) ?? 0;
  const got = v?.trades.reduce((a, t) => a + (t.back ?? 0), 0) ?? 0;
  const gameRet = v?.startCash ? (got - put + posVal) / v.startCash : 0;

  const openIt = () => {
    if (!v || v.done) return;
    if (cash < 10_000) return toast("현금이 모자라요.", "warn");
    setMode("open");
    setMargin(Math.floor(cash / 4));
    if (pos) setLev(pos.lev);
  };
  const closeIt = () => {
    if (!pos) return toast("정리할 포지션이 없어요.", "warn");
    setMode("close");
    setClosePct(100);
  };
  const confirm = () => {
    if (mode === "open") void run(() => coinOpen({ margin: Math.max(10_000, Math.min(margin, cash)), lev, have })).then(() => setMode(null));
    else if (mode === "close") void run(() => coinClose(closePct, have)).then(() => setMode(null));
  };
  const next = (n: number) => {
    if (!v || v.done) return;
    setMode(null);
    void run(() => coinNext(n, have));
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (result) return;
      const k = e.key.toLowerCase();
      if (k === "b") openIt();
      else if (k === "s") closeIt();
      else if (mode === "open" && ["1", "2", "3", "4"].includes(k)) setMargin(Math.max(10_000, Math.floor((cash * CHIPS[Number(k) - 1]) / 100)));
      else if (mode === "open" && !pos && ["q", "w", "e"].includes(k)) setLev(LEVERAGES[["q", "w", "e"].indexOf(k)]);
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
  const lines: PriceLine[] = [];
  if (pos) {
    lines.push({ price: pos.entry, label: `진입 ${fmtPrice(pos.entry)}`, color: "rgba(139,149,171,0.9)" });
    lines.push({ price: liqPrice(pos.lev, pos.entry), label: `청산가 ${fmtPrice(liqPrice(pos.lev, pos.entry))}`, color: C.up });
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        onBack={onBack}
        title={
          <>
            <span style={{ color: ACC }}>{v?.sym ?? "…"}</span> {v?.name ?? ""}{" "}
            <span className={`text-[11px] font-medium ${NUM}`} style={{ color: C.mute }}>
              {v ? fmtHour(coinDateAt(v.date0, candles.length - 1)) : ""} · 1시간봉
            </span>
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
        <Pill color={ACC}>
          {v?.turn ?? 0} <span style={{ color: C.mute, fontWeight: 500 }}>/ {COIN_TURNS}턴</span>
        </Pill>
      </TopBar>
      <div className="relative flex min-h-0 flex-1">
        <div style={{ width: chartW, height: chartH }}>
          {candles.length > 0 && <Chart candles={candles} width={chartW} height={chartH} markers={v ? coinMarkers(v.trades) : []} inds={inds} onInds={setInds} bars={pc ? 110 : 90} lines={lines} log />}
        </div>
        {liqFx && (
          <div className="stk-pop pointer-events-none absolute inset-0 z-10 flex items-center justify-center" style={{ background: "rgba(217,48,59,0.18)" }}>
            <div className={`${TITLE} text-[46px]`} style={{ color: C.up, textShadow: "0 4px 24px rgba(0,0,0,0.6)" }}>
              청산
            </div>
          </div>
        )}
        <div className="flex flex-col gap-[8px] px-[12px] pt-[10px] pb-[12px]" style={{ width: panelW, background: C.panel, borderLeft: `1px solid ${C.line}` }}>
          {!mode ? (
            <>
              <Row k="현재가" v={<b style={{ color: ACC }}>{fmtPrice(price)}</b>} />
              <Row k="현금" v={won(cash)} />
              <div className="my-[2px] h-px" style={{ background: C.line }} />
              {pos ? (
                <>
                  <Row k="포지션" v={<span style={{ color: ACC }}>롱 {pos.lev}배</span>} />
                  <Row k="증거금" v={won(pos.margin)} />
                  <Row k="진입가" v={fmtPrice(pos.entry)} />
                  <Row
                    k="평가"
                    v={
                      <b style={{ color: signColor(posPnl) }}>
                        {pct(posPnl / Math.max(1, pos.margin))} {posPnl >= 0 ? "+" : ""}
                        {won(posPnl)}
                      </b>
                    }
                  />
                  <Row k="청산가" v={<span style={{ color: C.up }}>{fmtPrice(liqPrice(pos.lev, pos.entry))}</span>} />
                </>
              ) : (
                <div className="rounded-[8px] px-[8px] py-[6px] text-[10px] leading-snug" style={{ background: C.bg, color: C.mute }}>
                  포지션 없음 · 진입하면 증거금 × 배수만큼 코인을 사요. 손실이 증거금의 90%를 넘는 저가가 나오면 청산돼요.
                </div>
              )}
              <div className="flex-1" />
              <div className="flex gap-[8px]">
                <Btn className="h-[50px] flex-1 text-[16px]" style={{ background: ACC, border: `1px solid ${ACC}`, color: "#1A1408" }} disabled={busy || !v || v.done} onClick={openIt}>
                  {pos ? "추가 진입" : "진입"}
                </Btn>
                <Btn tone="sell" className="h-[50px] flex-1 text-[16px]" disabled={busy || !v || v.done || !pos} onClick={closeIt}>
                  정리
                </Btn>
              </div>
              <div className="flex gap-[8px]">
                <Btn className="h-[46px] flex-1 text-[14px]" disabled={busy || !v || v.done} onClick={() => next(1)}>
                  ▶ 다음
                </Btn>
                <Btn className="h-[46px] w-[72px] text-[14px]" disabled={busy || !v || v.done} onClick={() => next(5)} title="5봉 넘기기">
                  ▶▶
                </Btn>
              </div>
            </>
          ) : mode === "open" ? (
            <>
              <div className="flex items-center gap-[8px]">
                <span className="rounded-[6px] px-[10px] py-[3px] text-[13px] font-black" style={{ background: ACC, color: "#1A1408" }}>
                  진입
                </span>
                <span className="text-[10px]" style={{ color: C.mute }}>
                  종가 체결 · 턴 안 넘어감
                </span>
                <div className="flex-1" />
                <button type="button" aria-label="닫기" onClick={() => setMode(null)} className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center" style={{ color: C.mute }}>
                  ✕
                </button>
              </div>
              <Row k="현금" v={won(cash)} />
              <div className="text-[10px]" style={{ color: C.mute }}>
                증거금
              </div>
              <div className="grid grid-cols-4 gap-[6px]">
                {CHIPS.map((p) => (
                  <Btn key={p} active={Math.round((Math.min(margin, cash) / Math.max(1, cash)) * 100) === p} className="h-[34px] text-[12px]" onClick={() => setMargin(Math.max(10_000, Math.floor((cash * p) / 100)))}>
                    {p === 100 ? "몰빵" : `${p}%`}
                  </Btn>
                ))}
              </div>
              <div className={`flex h-[36px] items-center justify-center rounded-[8px] text-[15px] font-bold ${NUM}`} style={{ background: C.bg, border: `1px solid ${C.line}` }}>
                {won(Math.min(margin, cash))}
              </div>
              <div className="text-[10px]" style={{ color: C.mute }}>
                배수 {pos && <span>· 지금 포지션과 같은 배수만</span>}
              </div>
              <div className="grid grid-cols-3 gap-[6px]">
                {LEVERAGES.map((l) => (
                  <Btn key={l} active={lev === l} className="h-[36px] text-[13px]" disabled={!!pos && pos.lev !== l} onClick={() => setLev(l)}>
                    {l}배
                  </Btn>
                ))}
              </div>
              <div className="flex flex-col gap-[2px] rounded-[8px] px-[8px] py-[6px] text-[10px]" style={{ background: C.bg, color: C.mute }}>
                <span>
                  포지션 <b className={NUM} style={{ color: C.text }}>{won(Math.min(margin, cash) * lev)}</b>
                </span>
                <span>
                  청산가 <b className={NUM} style={{ color: C.up }}>{fmtPrice(liqPrice(lev, price))}</b> ({pct(-0.9 / lev)})
                </span>
              </div>
              <div className="flex-1" />
              <div className="flex gap-[8px]">
                <Btn className="h-[48px] flex-1 text-[15px]" style={{ background: ACC, border: `1px solid ${ACC}`, color: "#1A1408" }} disabled={busy || cash < 10_000} onClick={confirm}>
                  {lev}배 진입
                </Btn>
                <Btn tone="ghost" className="h-[48px] w-[72px] text-[14px]" onClick={() => setMode(null)}>
                  취소
                </Btn>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-[8px]">
                <span className="rounded-[6px] px-[10px] py-[3px] text-[13px] font-black text-white" style={{ background: C.downBg }}>
                  정리
                </span>
                <div className="flex-1" />
                <button type="button" aria-label="닫기" onClick={() => setMode(null)} className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center" style={{ color: C.mute }}>
                  ✕
                </button>
              </div>
              <Row k="지금 평가액" v={won(posVal)} />
              <Row k="손익" v={<b style={{ color: signColor(posPnl) }}>{posPnl >= 0 ? "+" : ""}{won(posPnl)}</b>} />
              <div className="grid grid-cols-4 gap-[6px]">
                {CHIPS.map((p) => (
                  <Btn key={p} active={closePct === p} className="h-[34px] text-[12px]" onClick={() => setClosePct(p)}>
                    {p === 100 ? "전부" : `${p}%`}
                  </Btn>
                ))}
              </div>
              <div className={`flex h-[36px] items-center justify-center rounded-[8px] text-[15px] font-bold ${NUM}`} style={{ background: C.bg, border: `1px solid ${C.line}` }}>
                {won(Math.floor((posVal * closePct) / 100))} 받음
              </div>
              <div className="flex-1" />
              <div className="flex gap-[8px]">
                <Btn tone="sell" className="h-[48px] flex-1 text-[15px]" disabled={busy} onClick={confirm}>
                  정리 확인
                </Btn>
                <Btn tone="ghost" className="h-[48px] w-[72px] text-[14px]" onClick={() => setMode(null)}>
                  취소
                </Btn>
              </div>
            </>
          )}
        </div>
      </div>
      {menu && (
        <Sheet title="메뉴" onClose={() => setMenu(false)} width={300}>
          <div className="flex flex-col gap-[8px] p-[14px]">
            <Btn className="h-[44px]" disabled={busy || !v || v.done} onClick={() => (setMenu(false), next(COIN_TURNS))}>
              ▶▶▶ 끝까지 넘기기
            </Btn>
            <Btn className="h-[44px]" disabled={busy || !v || v.done} onClick={() => (setMenu(false), void run(() => coinQuit(have)))}>
              지금 가격으로 정리하고 그만하기
            </Btn>
            <p className="text-[11px] leading-relaxed" style={{ color: C.mute }}>
              코인은 들고만 있으면 평균적으로 조금씩 잃어요(판당 −7%). 대신 몇 배로 뛰는 판도 있어요. 청산되면 빨리감기도 거기서 멈춰요.
            </p>
          </div>
        </Sheet>
      )}
      {result?.result && (
        <Sheet width={440}>
          {(() => {
            const r = result.result!;
            return (
              <div className="flex flex-col items-center gap-[10px] p-[18px] text-center">
                <div className={`${TITLE} text-[26px] leading-none`}>
                  <span style={{ color: ACC }}>{r.sym}</span> {r.name}
                </div>
                {r.period && (
                  <div className={`text-[11px] ${NUM}`} style={{ color: C.mute }}>
                    {fmtHour(r.period[0])} ~ {fmtHour(r.period[1])} · {r.turns}턴
                  </div>
                )}
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
                  <Stat k="진입 · 청산" v={`${r.opens}회 · ${r.liqs}번 청산 · 최대 ${r.maxLev}배`} />
                </div>
                {r.revived && (
                  <div className="rounded-[8px] px-[10px] py-[6px] text-[12px] font-bold" style={{ background: C.goldBg, color: C.gold }}>
                    회생 자금 {won(r.revived.amount)}을 받았어요 (오늘 {r.revived.left}번 남음)
                  </div>
                )}
                <div className="mt-[6px] flex w-full gap-[8px]">
                  <Btn className="h-[46px] flex-1 text-[15px]" style={{ background: ACC, border: `1px solid ${ACC}`, color: "#1A1408" }} onClick={() => void start()}>
                    다음 판
                  </Btn>
                  <Btn tone="ghost" className="h-[46px] w-[110px] text-[13px]" onClick={onBack}>
                    마을로
                  </Btn>
                </div>
              </div>
            );
          })()}
        </Sheet>
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
const Stat = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-[8px] px-[6px] py-[6px]" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
    <div>{k}</div>
    <div className={`mt-[2px] text-[12px] font-bold ${NUM}`} style={{ color: C.text }}>
      {v}
    </div>
  </div>
);

export function CoinReviewView({ r, w, h, onBack }: { r: CoinReview; w: number; h: number; onBack: () => void }) {
  const pc = w > 900;
  const [inds, setInds] = useState<Ind[]>(pc ? ["macd", "stoch"] : ["macd"]);
  return (
    <div className="flex h-full flex-col">
      <TopBar
        onBack={onBack}
        title={
          <>
            복기 · <span style={{ color: ACC }}>{r.sym}</span> {r.name}
          </>
        }
        right={
          <span className={`text-[13px] font-bold ${NUM}`} style={{ color: signColor(r.result.pnl) }}>
            {pct(r.result.ret, 2)} · {r.result.pnl >= 0 ? "+" : ""}
            {won(r.result.pnl)}
          </span>
        }
      />
      <Chart candles={r.candles} width={w} height={h - 40} markers={coinMarkers(r.trades)} inds={inds} onInds={setInds} bars={110} dim={COIN_HISTORY} log />
    </div>
  );
}
