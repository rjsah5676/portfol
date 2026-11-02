"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HISTORY, MAX_ORDERS, ORDER_NAME, TURNS, dateAt, fmtDate, maxBuy, roundTick, tickSize, type Candle, type OrderKind, type SoloOrder } from "@/lib/stock/solo";
import type { SoloReview, SoloView } from "@/lib/stock/types";
import { soloCancelOrder, soloMemo, soloNext, soloOrder, soloQuit, soloStart, soloState, soloTrade } from "@/realtime/stock";
import { bgm, resultSound, sfx } from "@/lib/stock/sound";
import Chart, { tradeMarkers, type Ind, type PriceLine } from "./Chart";
import { Btn, C, Tip, type Face, Frame, NUM, Num, Pill, Sheet, TITLE, TopBar, WalletChip, comma, pct, signColor, won } from "./ui";

/*
 * 솔로 — 들어오면 차트 하나로 바로 시작. 종목명은 처음부터 보임. 턴 = 봉, 거래는 턴을 쓰지 않음.
 * 주문은 모달 대신 오른쪽 패널이 바뀜 (가로 화면에서 차트를 가리지 않게). 예약(지정가 매수 · 익절 · 손절)은 봉이 열릴 때 서버가 체결.
 * PC 단축키: B 매수 · S 매도 · R 예약 · 1~4 수량 % · Enter 확인 · Space/→ 다음 봉 · Shift+→ 5봉 · Esc 취소
 */

const CHIPS = [10, 25, 50, 100] as const;
const ORDER_COLOR: Record<OrderKind, string> = { buy: C.up, take: C.green, stop: "#FF9F43" };
const dateOf = (v: SoloView | null, candles: Candle[]) => (v ? dateAt(v.date0, candles.length - 1) : 0);

/** 안내 한마디 — 상황(방금 봉 · 보유 손익 · 체결)에 맞춰 */
type Quip = { face: Face; text: string };
function quipFor(v: SoloView, candles: Candle[], ev: "start" | "buy" | "sell" | "next" | "fill" | "order"): Quip {
  const n = candles.length;
  const last = candles[n - 1];
  const prev = candles[n - 2];
  const move = prev ? last.c / prev.c - 1 : 0;
  const avg = v.shares ? v.cost / v.shares : 0;
  const pnl = v.shares && avg ? last.c / avg - 1 : 0;
  if (ev === "fill") return { face: "smile", text: "예약 체결! 계획대로 가고 있어요." };
  if (ev === "order") return { face: "think", text: "예약은 봉이 열릴 때 가격이 닿으면 체결돼요." };
  if (ev === "buy") return { face: "smile", text: v.shares && v.cash < last.c ? "몰빵! 손절선은 예약으로 걸어 둬요." : "들어갔어요. 손절선부터 정해 두는 게 좋아요." };
  if (ev === "sell") return { face: v.trades.length ? "joy" : "idle", text: v.shares ? "일부 정리. 남은 건 흐름 보면서~" : "정리 완료. 다음 자리를 찾아봐요." };
  if (ev === "start") return { face: "idle", text: `${v.name}, 일봉이에요. 「전체」로 큰 흐름부터 보고 들어가요.` };
  if (v.shares) {
    if (move >= 0.07) return { face: "joy", text: `+${(move * 100).toFixed(1)}%! 오른다 올라~ 익절 자리도 생각해요.` };
    if (move <= -0.07) return { face: "shock", text: `${(move * 100).toFixed(1)}%… 손절 기준은 지켰나요?` };
    if (pnl >= 0.25) return { face: "joy", text: "수익 25% 넘었어요. 일부라도 챙기는 것도 실력!" };
    if (pnl <= -0.15) return { face: "sad", text: "물타기는 신중하게… 추세가 꺾였는지 먼저 봐요." };
    return { face: move >= 0 ? "smile" : "idle", text: move >= 0 ? "순조로워요. 이평선 위에 있으면 느긋하게." : "살짝 눌림. 거래량이 줄면 눌림, 늘면 꺾임이에요." };
  }
  if (move >= 0.07) return { face: "shock", text: "급등! 추격 매수는 신중하게, 눌림을 기다려 봐요." };
  if (move <= -0.07) return { face: "think", text: "급락. 바닥은 잡는 게 아니라 확인하는 거예요." };
  const turnsLeft = TURNS - v.turn;
  if (turnsLeft <= 10) return { face: "think", text: `${turnsLeft}턴 남았어요. 안 들어가는 것도 전략이에요.` };
  return { face: "idle", text: "관망 중. 5일선이 20일선을 뚫는 자리를 노려 봐요." };
}

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
  const pc = w > 900;
  const [inds, setInds] = useState<Ind[]>(pc ? ["macd", "stoch"] : ["macd"]);
  const [mode, setMode] = useState<null | "buy" | "sell" | "order">(null);
  const [qty, setQty] = useState(0);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [result, setResult] = useState<SoloView | null>(null);
  const [quip, setQuip] = useState<Quip>({ face: "idle", text: "차트를 불러오는 중…" });
  const candlesRef = useRef<Candle[]>([]);
  useEffect(() => {
    bgm("trade");
  }, []);

  /** 서버 응답 → 봉 붙이기 (from 이후만 옴) */
  const apply = useCallback(
    (nv: SoloView | null, ev: "start" | "buy" | "sell" | "next" | "fill" | "order" = "next") => {
      if (!nv) return;
      const merged = nv.from === 0 ? nv.candles : [...candlesRef.current.slice(0, nv.from), ...nv.candles];
      candlesRef.current = merged;
      setCandles(merged);
      setV(nv);
      if (nv.filled?.length) {
        const f = nv.filled[nv.filled.length - 1];
        sfx("fill");
        toast(`예약 체결 · ${ORDER_NAME[f.kind]} ${comma(f.qty)}주 @ ${comma(f.price)}`, f.kind === "buy" ? "up" : f.kind === "take" ? "up" : "down");
        ev = "fill";
      }
      if (nv.done) {
        setResult(nv);
        if (nv.result) resultSound(nv.result.ret);
      } else setQuip(quipFor(nv, merged, ev));
    },
    [toast]
  );

  const run = useCallback(
    async (fn: () => Promise<SoloView | null>, ev: "start" | "buy" | "sell" | "next" | "fill" | "order" = "next") => {
      if (busy) return;
      setBusy(true);
      try {
        apply(await fn(), ev);
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
    await run(async () => (await soloState(0)) ?? (await soloStart()), "start");
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
  const orders = v?.orders ?? [];

  const openOrder = (side: "buy" | "sell") => {
    if (!v || v.done) return;
    const m = side === "buy" ? maxBuy(cash, price) : shares;
    if (!m) return toast(side === "buy" ? "현금이 모자라요." : "팔 주식이 없어요.", "warn");
    setMode(side);
    setQty(Math.max(1, Math.floor(m / 2)));
  };
  const confirm = () => {
    if (!mode || mode === "order" || qty <= 0) return;
    const side = mode;
    sfx(side);
    void run(() => soloTrade({ side, qty: Math.min(qty, most), have }), side).then(() => setMode(null));
  };
  const next = (n: number) => {
    if (!v || v.done) return;
    if (mode !== "order") setMode(null);
    sfx(n > 1 ? "fast" : "next");
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
      else if (k === "r") setMode((m) => (m === "order" ? null : "order"));
      else if ((mode === "buy" || mode === "sell") && ["1", "2", "3", "4"].includes(k)) setQty(Math.max(1, Math.floor((most * CHIPS[Number(k) - 1]) / 100)));
      else if ((mode === "buy" || mode === "sell") && k === "enter") confirm();
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
  const lines: PriceLine[] = orders.map((o) => ({ price: o.price, label: `${ORDER_NAME[o.kind]} ${comma(o.qty)}주`, color: ORDER_COLOR[o.kind] }));
  if (shares && avg > 0) lines.push({ price: avg, label: `평단 ${comma(avg)}`, color: "rgba(139,149,171,0.9)" });

  return (
    <div className="flex h-full flex-col">
      <TopBar
        onBack={onBack}
        title={
          <>
            {v?.name ?? "…"}{" "}
            <span className={`text-[11px] font-medium ${NUM}`} style={{ color: C.mute }}>
              {v ? fmtDate(dateOf(v, candles)) : ""} · 일봉
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
        <Pill>
          {v?.turn ?? 0} <span style={{ color: C.mute, fontWeight: 500 }}>/ {TURNS}턴</span>
        </Pill>
      </TopBar>

      <div className="flex min-h-0 flex-1">
        <div className="stk-grid" style={{ width: chartW, height: chartH }}>
          {candles.length > 0 && <Chart candles={candles} width={chartW} height={chartH} markers={v ? tradeMarkers(v.trades, HISTORY) : []} inds={inds} onInds={setInds} bars={pc ? 110 : 90} lines={lines} />}
        </div>
        <div className="flex flex-col gap-[8px] px-[10px] pt-[8px] pb-[10px]" style={{ width: panelW, background: C.panel, borderLeft: `1px solid ${C.line}` }}>
          {!mode ? (
            <>
              <Tip face={quip.face} text={quip.text} size={36} />
              <Frame title="시세 · 보유" bodyClass="flex flex-col gap-[4px] px-[8px] py-[6px]">
                <Row k="현재가" v={<Num value={price} className="text-[15px] font-black" style={{ color: candles.length > 1 && price < candles[candles.length - 2].c ? C.down : C.up }}>{comma(price)}</Num>} />
                <Row k="현금" v={won(cash)} />
                <div className="my-[1px] h-px" style={{ background: C.line }} />
                <Row k="보유" v={`${comma(shares)}주`} />
                <Row k="평단" v={shares ? comma(avg) : "-"} />
                <Row
                  k="평가"
                  v={
                    shares ? (
                      <Num value={pnl} className="font-bold" style={{ color: signColor(pnl) }}>
                        {pct(pnl / Math.max(1, v?.cost ?? 1))} {pnl >= 0 ? "+" : ""}
                        {won(pnl)}
                      </Num>
                    ) : (
                      "-"
                    )
                  }
                />
              </Frame>
              {orders.length > 0 && (
                <Frame title={`예약 ${orders.length}`} accent={C.gold} bodyClass="px-[8px] py-[4px]">
                  <button type="button" onClick={() => setMode("order")} className="flex w-full cursor-pointer flex-col gap-[2px] text-left text-[10px]">
                    {orders.map((o) => (
                      <span key={o.id} className={NUM} style={{ color: ORDER_COLOR[o.kind] }}>
                        {ORDER_NAME[o.kind]} {comma(o.price)} · {comma(o.qty)}주
                      </span>
                    ))}
                  </button>
                </Frame>
              )}
              <div className="flex-1" />
              <div className="flex gap-[8px]">
                <Btn tone="buy" className="h-[50px] flex-1 text-[16px]" disabled={busy || !v || v.done} onClick={() => openOrder("buy")}>
                  매수
                </Btn>
                <Btn tone="sell" className="h-[50px] flex-1 text-[16px]" disabled={busy || !v || v.done || !shares} onClick={() => openOrder("sell")}>
                  매도
                </Btn>
              </div>
              <Btn className="h-[38px] text-[13px]" disabled={busy || !v || v.done} onClick={() => setMode("order")} title="예약 주문 (R)">
                ⏱ 예약 {orders.length ? `(${orders.length})` : ""}
              </Btn>
              <div className="flex gap-[8px]">
                <Btn silent className="h-[46px] flex-1 text-[14px]" disabled={busy || !v || v.done} onClick={() => next(1)}>
                  ▶ 다음
                </Btn>
                <Btn silent className="h-[46px] w-[72px] text-[14px]" disabled={busy || !v || v.done} onClick={() => next(5)} title="5봉 넘기기">
                  ▶▶
                </Btn>
              </div>
            </>
          ) : mode === "order" ? (
            <OrderBook
              price={price}
              cash={cash}
              shares={shares}
              orders={orders}
              busy={busy}
              onAdd={(kind, p, q) => (sfx("order"), void run(() => soloOrder({ kind, price: p, qty: q, have }), "order"))}
              onCancel={(id) => void run(() => soloCancelOrder(id, have), "order")}
              onClose={() => setMode(null)}
              onNext={() => next(1)}
            />
          ) : (
            <OrderPanel side={mode} price={price} most={most} qty={qty} setQty={setQty} cash={cash} busy={busy} onConfirm={confirm} onCancel={() => setMode(null)} />
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
              판 도중에 나가도 판은 그대로 남아요. 다시 들어오면 이어서 해요. 예약이 체결되면 빨리감기도 거기서 멈춰요.
            </p>
          </div>
        </Sheet>
      )}

      {result?.result && <ResultSheet v={result} onNext={() => void start()} onBack={onBack} />}
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

/** 길게 누르면 빨리 바뀌는 ± 버튼 */
function useHold(apply: (d: number) => void) {
  const hold = useRef<ReturnType<typeof setInterval> | null>(null);
  const press = (d: number) => {
    apply(d);
    let k = 0;
    hold.current = setInterval(() => apply(d * (++k > 10 ? 5 : 1)), 120);
  };
  const release = () => {
    if (hold.current) clearInterval(hold.current);
    hold.current = null;
  };
  return { press, release };
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
  const stepBy = Math.max(1, Math.round(most / 100));
  const { press, release } = useHold((d) => setQty(Math.min(most, Math.max(1, q + d * (Math.abs(d) > 1 ? stepBy : 1)))));
  return (
    <>
      <div className="flex items-center gap-[8px]">
        <span className="rounded-[6px] px-[10px] py-[3px] text-[13px] font-black text-white" style={{ background: buy ? C.upBg : C.downBg }}>
          {buy ? "매수" : "매도"}
        </span>
        <span className="text-[11px]" style={{ color: C.mute }}>
          종가 체결 · 턴 안 넘어감
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
        <Btn tone={buy ? "buy" : "sell"} silent className="h-[48px] flex-1 text-[15px]" disabled={busy || q <= 0} onClick={onConfirm}>
          {buy ? "매수" : "매도"} 확인
        </Btn>
        <Btn tone="ghost" className="h-[48px] w-[72px] text-[14px]" onClick={onCancel}>
          취소
        </Btn>
      </div>
    </>
  );
}

/** 예약 주문 패널: 걸어 둔 예약 목록 + 새 예약 (종류 · 가격 · 수량) */
function OrderBook({
  price,
  cash,
  shares,
  orders,
  busy,
  onAdd,
  onCancel,
  onClose,
  onNext,
}: {
  price: number;
  cash: number;
  shares: number;
  orders: SoloOrder[];
  busy: boolean;
  onAdd: (kind: OrderKind, price: number, qty: number) => void;
  onCancel: (id: string) => void;
  onClose: () => void;
  onNext: () => void;
}) {
  const [kind, setKind] = useState<OrderKind>(shares ? "take" : "buy");
  const [p, setP] = useState(() => roundTick(price * (shares ? 1.05 : 0.95)));
  const [q, setQ] = useState(() => Math.max(1, shares || maxBuy(cash, price)));
  const most = kind === "buy" ? maxBuy(cash, p) : shares;
  const qq = Math.min(q, Math.max(1, most));
  const pickKind = (k: OrderKind) => {
    setKind(k);
    setP(roundTick(price * (k === "take" ? 1.05 : 0.95)));
    setQ(Math.max(1, k === "buy" ? maxBuy(cash, roundTick(price * 0.95)) : shares));
  };
  const { press, release } = useHold((d) => setP((x) => Math.max(tickSize(x), roundTick(x + d * tickSize(x)))));
  const hq = useHold((d) => setQ((x) => Math.min(Math.max(1, most), Math.max(1, x + d * (Math.abs(d) > 1 ? Math.max(1, Math.round(most / 100)) : 1)))));
  const diff = price ? (p - price) / price : 0;
  const bad = kind === "take" ? p <= price : p >= price;
  const can = orders.length < MAX_ORDERS && !bad && qq > 0 && (kind === "buy" ? cash >= p : shares > 0);
  return (
    <>
      <div className="flex items-center gap-[8px]">
        <span className="rounded-[6px] px-[10px] py-[3px] text-[13px] font-black" style={{ background: C.goldBg, color: C.gold, border: `1px solid ${C.gold}` }}>
          예약
        </span>
        <span className="text-[10px]" style={{ color: C.mute }}>
          봉이 열릴 때 가격이 닿으면 체결
        </span>
        <div className="flex-1" />
        <button type="button" aria-label="닫기" onClick={onClose} className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center" style={{ color: C.mute }}>
          ✕
        </button>
      </div>
      {orders.length > 0 && (
        <div className="flex flex-col gap-[3px]">
          {orders.map((o) => (
            <div key={o.id} className={`flex items-center gap-[4px] rounded-[6px] px-[6px] py-[3px] text-[10px] ${NUM}`} style={{ background: C.bg, border: `1px solid ${C.line}` }}>
              <span className="flex-1" style={{ color: ORDER_COLOR[o.kind] }}>
                {ORDER_NAME[o.kind]} <b>{comma(o.price)}</b> · {comma(o.qty)}주
              </span>
              <button type="button" onClick={() => onCancel(o.id)} className="cursor-pointer px-[4px] text-[11px]" style={{ color: C.mute }} aria-label="예약 취소">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-[4px]">
        {(["buy", "take", "stop"] as OrderKind[]).map((k) => (
          <Btn key={k} active={kind === k} className="h-[30px] text-[11px]" disabled={k !== "buy" && !shares} onClick={() => pickKind(k)}>
            {ORDER_NAME[k].replace(" 매도", "").replace("지정가 ", "")}
          </Btn>
        ))}
      </div>
      <div className="flex items-center gap-[4px]">
        <Btn className="h-[36px] w-[36px] text-[16px]" aria-label="가격 내리기" onPointerDown={() => press(-1)} onPointerUp={release} onPointerLeave={release}>
          −
        </Btn>
        <div className={`flex h-[36px] flex-1 flex-col items-center justify-center rounded-[8px] leading-none ${NUM}`} style={{ background: C.bg, border: `1px solid ${bad ? C.up : C.line}` }}>
          <span className="text-[14px] font-bold">{comma(p)}</span>
          <span className="text-[9px]" style={{ color: signColor(diff) }}>
            {pct(diff)}
          </span>
        </div>
        <Btn className="h-[36px] w-[36px] text-[16px]" aria-label="가격 올리기" onPointerDown={() => press(1)} onPointerUp={release} onPointerLeave={release}>
          +
        </Btn>
      </div>
      <div className="grid grid-cols-4 gap-[4px]">
        {(kind === "take" ? [3, 5, 10, 20] : [-3, -5, -10, -20]).map((x) => (
          <Btn key={x} className="h-[26px] text-[10px]" onClick={() => setP(roundTick(price * (1 + x / 100)))}>
            {x > 0 ? "+" : ""}
            {x}%
          </Btn>
        ))}
      </div>
      <div className="flex items-center gap-[4px]">
        <Btn className="h-[32px] w-[36px] text-[14px]" aria-label="수량 줄이기" onPointerDown={() => hq.press(-1)} onPointerUp={hq.release} onPointerLeave={hq.release}>
          −
        </Btn>
        <div className={`flex h-[32px] flex-1 items-center justify-center rounded-[8px] text-[13px] font-bold ${NUM}`} style={{ background: C.bg, border: `1px solid ${C.line}` }}>
          {comma(qq)}
          <span className="ml-[3px] text-[10px]" style={{ color: C.mute }}>
            주
          </span>
        </div>
        <Btn className="h-[32px] w-[36px] text-[14px]" aria-label="수량 늘리기" onPointerDown={() => hq.press(1)} onPointerUp={hq.release} onPointerLeave={hq.release}>
          +
        </Btn>
        <Btn className="h-[32px] px-[8px] text-[10px]" onClick={() => setQ(Math.max(1, most))}>
          전부
        </Btn>
      </div>
      {bad && (
        <div className="text-[10px]" style={{ color: C.up }}>
          {kind === "take" ? "익절은 지금 가격보다 높게" : kind === "buy" ? "지정가 매수는 지금 가격보다 낮게" : "손절은 지금 가격보다 낮게"} 걸어요
        </div>
      )}
      <div className="flex-1" />
      <div className="flex gap-[6px]">
        <Btn tone="gold" silent className="h-[42px] flex-1 text-[13px]" disabled={busy || !can} onClick={() => onAdd(kind, p, qq)}>
          예약 걸기 {orders.length ? `(${orders.length}/${MAX_ORDERS})` : ""}
        </Btn>
        <Btn className="h-[42px] w-[64px] text-[13px]" disabled={busy} onClick={onNext} title="다음 봉">
          ▶
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
      <div className={`flex flex-col items-center gap-[10px] p-[18px] text-center ${r.ret >= 0.3 ? "stk-shine" : r.ret <= -0.3 ? "stk-alarm" : ""}`}>
        <Tip face={r.ret >= 0.3 ? "joy" : r.pnl > 0 ? "smile" : r.ret <= -0.3 ? "shock" : "sad"} text={r.ret >= 0.3 ? "대박! 이 차트는 복기해 둘 만해요." : r.pnl > 0 ? "수익 마감. 기록에 메모 남겨 두면 다음에 도움돼요." : r.ret <= -0.3 ? "크게 잃었어요… 어디서 꺾였는지 복기해 봐요." : "아쉽지만 수업료. 다음 판은 손절선부터!"} size={34} className="w-full text-left" />
        <div className={`${TITLE} text-[26px] leading-none`}>{r.name}</div>
        {r.period && (
          <div className={`text-[11px] ${NUM}`} style={{ color: C.mute }}>
            {fmtDate(r.period[0])} ~ {fmtDate(r.period[1])} · {r.turns}턴
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
          <Stat k="매매(왕복)" v={`${r.trips}회 · 익절 ${r.wins}`} />
        </div>
        {r.turns < TURNS && (
          <div className="text-[11px]" style={{ color: C.mute }}>
            {r.turns}턴에서 정리했어요
          </div>
        )}
        {r.revived && (
          <div className="rounded-[8px] px-[10px] py-[6px] text-[12px] font-bold" style={{ background: C.goldBg, color: C.gold }}>
            총자산이 500만 밑으로 내려가서 회생 자금 {won(r.revived.amount)}을 받았어요
          </div>
        )}
        <div className="mt-[6px] flex w-full gap-[8px]">
          <Btn tone="gold" className="h-[46px] flex-1 text-[15px]" onClick={onNext}>
            다음 판
          </Btn>
          <Btn tone="ghost" className="h-[46px] w-[110px] text-[13px]" onClick={onBack}>
            {win ? "처음으로" : "그만하기"}
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

/** 복기: 끝난 판 차트 전체 + 내 매매 + 메모 */
export function Review({ r, w, h, onBack, toast }: { r: SoloReview; w: number; h: number; onBack: () => void; toast?: (t: string, tone?: "plain" | "up" | "down" | "warn") => void }) {
  const pc = w > 900;
  const [inds, setInds] = useState<Ind[]>(pc ? ["macd", "stoch"] : ["macd"]);
  const [memo, setMemo] = useState(r.memo);
  const [saved, setSaved] = useState(r.memo);
  const [open, setOpen] = useState(false);
  const save = () =>
    void soloMemo(r.id, memo).then(
      (x) => (setSaved(x.memo), setMemo(x.memo), setOpen(false), toast?.("메모를 저장했어요", "up")),
      (e) => toast?.((e as Error).message, "warn")
    );
  return (
    <div className="flex h-full flex-col">
      <TopBar
        onBack={onBack}
        title={
          <>
            복기 · {r.name}{" "}
            <span className={`text-[11px] font-medium ${NUM}`} style={{ color: C.mute }}>
              {r.result.period ? `${fmtDate(r.result.period[0])} ~ ${fmtDate(r.result.period[1])}` : ""}
            </span>
          </>
        }
        right={
          <>
            <Btn className="h-[28px] px-[10px] text-[11px]" onClick={() => setOpen(true)}>
              📝 {saved ? "메모" : "메모 쓰기"}
            </Btn>
            <span className={`text-[13px] font-bold ${NUM}`} style={{ color: signColor(r.result.pnl) }}>
              {pct(r.result.ret, 2)} · {r.result.pnl >= 0 ? "+" : ""}
              {won(r.result.pnl)}
            </span>
          </>
        }
      />
      <Chart candles={r.candles} width={w} height={h - 40} markers={tradeMarkers(r.trades, HISTORY)} inds={inds} onInds={setInds} bars={110} dim={HISTORY} />
      {saved && !open && (
        <div className="pointer-events-none absolute bottom-[8px] left-[8px] max-w-[60%] rounded-[8px] px-[10px] py-[6px] text-[11px]" style={{ background: "rgba(10,13,22,0.85)", border: `1px solid ${C.line}`, color: C.text }}>
          📝 {saved}
        </div>
      )}
      {open && (
        <Sheet title="복기 메모" onClose={() => setOpen(false)} width={380}>
          <div className="flex flex-col gap-[8px] p-[14px]">
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value.slice(0, 200))}
              rows={4}
              placeholder="이 판에서 배운 것 · 다음에 할 것 (200자)"
              className="w-full resize-none rounded-[8px] p-[10px] text-[13px] outline-none"
              style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text }}
            />
            <div className="flex gap-[8px]">
              <Btn tone="gold" className="h-[40px] flex-1" onClick={save}>
                저장
              </Btn>
              <Btn tone="ghost" className="h-[40px] w-[80px]" onClick={() => setOpen(false)}>
                닫기
              </Btn>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
