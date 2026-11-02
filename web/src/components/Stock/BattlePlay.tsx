"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BATTLE, STOCKS, afterBuy, afterSell, buyCost, maxBuy, sellGain, shockAt, shocksBy, untilShock } from "@/lib/stock/battle";
import { BOT_STYLES } from "@/lib/stock/bots";
import { NEWS, type BNews, type NewsTag } from "@/lib/stock/news";
import type { BGameWire, BResult, BRoomWire } from "@/lib/stock/types";
import { order, sellAll, serverNow } from "@/realtime/stock";
import { bgm, sfx } from "@/lib/stock/sound";
import { Avatar, Btn, C, NUM, Sheet, TITLE, josa, mult, pct, signColor, won } from "./ui";

/*
 * 대전 화면: 위 시계 · 남은 시간 · 내 자산 · 순위 / 왼쪽 시세판(2열 × 5) / 오른쪽 거래 패널 / 아래 거래 피드 (속보가 뜨면 그 자리에 속보).
 * 플레이 중엔 캐릭터 컷인 · 말풍선 없음 (10초 사이클에서 한눈에 보이는 게 먼저). 큰 연출은 결과 화면 1등 발표에서만.
 * PC 단축키: 1~0 종목 · Q/W/E/R 매수 1/5/10/MAX · A/S/D/F 매도 1/5/10/전부 · Shift+A 전부 매각
 */

const BUY_Q = [1, 5, 10] as const;

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function Play({
  room,
  game,
  myUid,
  w,
  h,
  toast,
}: {
  room: BRoomWire;
  game: BGameWire;
  myUid: string;
  w: number;
  h: number;
  toast: (t: string, tone?: "plain" | "up" | "down" | "warn") => void;
}) {
  const [sel, setSel] = useState(0);
  const [showRank, setShowRank] = useState(false);
  const [now, setNow] = useState(() => serverNow());
  const [flash, setFlash] = useState<{ k: number; mult: number[]; ev: number[] } | null>(null);
  useEffect(() => {
    bgm("battle");
    const t = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(t);
  }, []);
  // 변동 순간: 타일에 배수 · 대박/폭락 표시 (1.6초). 변동 수(shocks)가 늘 때만 — 마지막 변동은 last · lastEv 에 늘 실려 옴
  const shockN = game.shocks;
  useEffect(() => {
    if (!shockN) return;
    const sh = { k: shockN - 1, mult: game.last, ev: game.lastEv };
    // 변동 소리: 대박 · 폭락이 섞였으면 둥, 아니면 봉 소리
    sfx(game.lastEv.some((e) => e !== 0) ? "shock" : "next");
    const on = setTimeout(() => setFlash(sh), 0);
    const off = setTimeout(() => setFlash(null), 1600);
    return () => (clearTimeout(on), clearTimeout(off));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shockN]);

  const mySeat = room.seats.findIndex((s) => s?.uid === myUid);
  const me = game.map.indexOf(mySeat);
  const mine = me >= 0 ? game.players[me] : null;
  const t = Math.min(BATTLE.durationMs, now - game.startAt);
  const nextIn = untilShock(t);
  const done = shocksBy(t);
  const left = BATTLE.durationMs - t;
  const buyPhase = done === 0;
  const ranking = useMemo(() => game.players.map((p, i) => ({ i, a: p.assets })).sort((a, b) => b.a - a.a), [game.players]);
  const myRank = ranking.findIndex((r) => r.i === me) + 1;
  const hot = game.flows.map((f) => f >= BATTLE.hotShares);
  // 속보: 뜬 뒤 변동 3초 뒤까지 아래 띠에 (변동 전엔 방향만, 변동 뒤엔 적중 · 오보)
  const live = (game.news ?? []).filter((n) => t >= n.at && t < shockAt(n.k) + NEWS.afterMs);
  const pendingNews = (s: number) => live.find((n) => n.stock === s && n.hit === undefined);
  const lastNewsAt = game.news?.length ? game.news[game.news.length - 1].at : -1;
  useEffect(() => {
    if (lastNewsAt >= 0) sfx("warn");
  }, [lastNewsAt]);
  const busy = useRef(false);

  const send = (stock: number, side: "buy" | "sell", qty: number) => {
    if (busy.current || qty <= 0) return;
    busy.current = true;
    void order(room.id, stock, side, qty)
      .then((r) => {
        if (!r.ok) toast(side === "buy" ? "현금이 모자라요" : "팔 주식이 없어요", "warn");
        else sfx(side);
      })
      .catch((e) => toast((e as Error).message, "warn"))
      .finally(() => (busy.current = false));
  };
  const dumpAll = () => {
    sfx("sell");
    void sellAll(room.id)
      .then((r) => r.ok && toast(`전부 매각 · ${won(r.amount)}`, "down"))
      .catch((e) => toast((e as Error).message, "warn"));
  };

  const price = game.prices[sel];
  const hold = mine?.hold[sel] ?? 0;
  const cash = mine?.cash ?? 0;
  const maxQ = maxBuy(price, cash);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      const n = "1234567890".indexOf(k);
      if (n >= 0 && !e.shiftKey) return setSel(n);
      if (e.shiftKey && k === "a") return dumpAll();
      const bi = "qwer".indexOf(k),
        si = "asdf".indexOf(k);
      if (bi >= 0) send(sel, "buy", bi === 3 ? maxQ : BUY_Q[bi]);
      if (si >= 0) send(sel, "sell", si === 3 ? hold : BUY_Q[si]);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const panelW = Math.round(Math.max(250, w * 0.3));
  const boardW = w - panelW;
  const tileH = Math.floor((h - 40 - 30 - 12) / 5) - 6;
  const ring = 1 - nextIn / (buyPhase ? BATTLE.buyPhaseMs : BATTLE.shockEveryMs);
  const urgent = nextIn < 3000 && done < BATTLE.shocks;
  const tickSec = urgent ? Math.ceil(nextIn / 1000) : 0;
  useEffect(() => {
    if (tickSec > 0) sfx(tickSec === 1 ? "tickLast" : "tick");
  }, [tickSec]);

  return (
    <div className="relative flex h-full flex-col">
      {/* 위: 시계 · 남은 시간 · 내 자산 */}
      <div className="flex h-[40px] shrink-0 items-center gap-[12px] px-[10px]" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-center gap-[6px]">
          <svg width="26" height="26" viewBox="0 0 36 36" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke={C.line} strokeWidth="4" />
            <circle cx="18" cy="18" r="15" fill="none" stroke={urgent ? C.up : C.gold} strokeWidth="4" strokeDasharray={`${94.2 * Math.min(1, ring)} 94.2`} transform="rotate(-90 18 18)" />
          </svg>
          <span className={`text-[13px] font-bold ${urgent ? "stk-blink" : ""}`} style={{ color: urgent ? C.up : C.text }}>
            {done >= BATTLE.shocks ? "마지막 10초!" : buyPhase ? `구매 시간 ${Math.ceil(nextIn / 1000)}초` : `다음 변동 ${Math.ceil(nextIn / 1000)}초`}
          </span>
        </div>
        <span className={`text-[12px] ${NUM}`} style={{ color: C.mute }}>
          남은 <b style={{ color: C.text }}>{fmtClock(left)}</b> · 변동 {done}/{BATTLE.shocks}
        </span>
        <div className="flex-1" />
        {mine && (
          <span className={`text-[12px] ${NUM}`} style={{ color: C.mute }}>
            내 자산 <b className="text-[14px]" style={{ color: signColor(mine.assets - BATTLE.startCash) }}>{won(mine.assets)}</b> · <b style={{ color: C.gold }}>{myRank}위</b>
          </span>
        )}
        <Btn active={showRank} className="h-[28px] px-[10px] text-[12px]" onClick={() => setShowRank((v) => !v)}>
          순위
        </Btn>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 시세판 */}
        <div className="grid grid-flow-col grid-cols-2 grid-rows-5 gap-[6px] p-[6px]" style={{ width: boardW }}>
          {STOCKS.map((s, i) => {
            const p = game.prices[i];
            const ch = p / game.base[i] - 1;
            const fl = flash?.mult[i];
            const ev = flash?.ev[i] ?? 0;
            const held = mine?.hold[i] ?? 0;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setSel(i)}
                className={`relative flex cursor-pointer items-center gap-[6px] overflow-hidden rounded-[8px] px-[8px] text-left ${fl !== undefined ? (fl >= 1 ? "stk-flash-up" : "stk-flash-down") : ""}`}
                style={{ height: tileH, background: sel === i ? "#1f2a44" : C.panel2, border: `1px solid ${sel === i ? C.gold : C.line}` }}
              >
                <span className={`w-[16px] text-[10px] ${NUM}`} style={{ color: C.mute }}>
                  {(i + 1) % 10}
                </span>
                <span className="w-[44px] text-[13px] font-bold" style={{ color: s.color }}>
                  {s.name}
                </span>
                <span className={`flex-1 text-right text-[14px] font-bold ${NUM}`}>{won(p)}</span>
                <span className={`w-[56px] text-right text-[12px] font-bold ${NUM}`} style={{ color: signColor(fl !== undefined ? fl - 1 : ch) }}>
                  {fl !== undefined ? `${fl >= 1 ? "▲" : "▼"}${Math.abs((fl - 1) * 100).toFixed(0)}%` : `${ch > 0 ? "▲" : ch < 0 ? "▼" : "─"}${Math.abs(ch * 100).toFixed(0)}%`}
                </span>
                <span className={`w-[40px] text-right text-[10px] ${NUM}`} style={{ color: held ? C.gold : "transparent" }}>
                  {held}주
                </span>
                {hot[i] && <span className="absolute top-[1px] right-[3px] text-[10px]">🔥</span>}
                {pendingNews(i) && (
                  <span className="stk-blink absolute top-[1px] left-[20px] rounded-[3px] px-[3px] text-[9px] font-black" style={{ background: pendingNews(i)!.dir > 0 ? C.upBg : C.downBg, color: "#fff" }}>
                    📰 {pendingNews(i)!.dir > 0 ? "호재" : "악재"}
                  </span>
                )}
                {ev !== 0 && (
                  <span className="stk-pop absolute inset-0 flex items-center justify-center text-[18px] font-black" style={{ background: ev > 0 ? "rgba(217,48,59,0.75)" : "rgba(36,99,217,0.75)", color: "#fff" }}>
                    {ev > 0 ? "대박!" : "폭락!"} ×{(fl ?? 1).toFixed(2)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 거래 패널 / 순위 */}
        <div className="relative flex flex-col gap-[6px] p-[10px]" style={{ width: panelW, background: C.panel, borderLeft: `1px solid ${C.line}` }}>
          {showRank ? (
            <RankList room={room} game={game} ranking={ranking} me={me} />
          ) : (
            <TradePanel
              stock={sel}
              price={price}
              hold={hold}
              cash={cash}
              cost={mine?.cost[sel] ?? 0}
              maxQ={maxQ}
              onBuy={(q) => send(sel, "buy", q)}
              onSell={(q) => send(sel, "sell", q)}
            />
          )}
        </div>
      </div>

      {/* 거래 피드 */}
      <div className="flex h-[30px] shrink-0 items-center gap-[8px] overflow-hidden px-[10px] text-[11px]" style={{ borderTop: `1px solid ${C.line}`, background: C.bg }}>
        <span aria-hidden>{live.length ? "📰" : "📣"}</span>
        <div className="flex min-w-0 flex-1 gap-[12px] overflow-hidden whitespace-nowrap">
          {live.length > 0 ? live.map((n) => <NewsLine key={`${n.k}-${n.stock}`} n={n} />) : [...game.feed].reverse().slice(0, 6).map((f, k) => {
            const s = room.seats[f.seat];
            return (
              <span key={`${f.at}-${k}`} style={{ color: f.side === "buy" ? C.up : C.down, opacity: 1 - k * 0.12 }}>
                <b style={{ color: C.text }}>{s?.nick ?? "?"}</b> {STOCKS[f.stock].name} {f.qty}주 {f.side === "buy" ? "매수" : "매도"}
              </span>
            );
          })}
        </div>
        <Btn tone="sell" className="h-[24px] px-[10px] text-[11px]" onClick={dumpAll} title="전부 매각 (Shift+A)">
          전부매각
        </Btn>
      </div>
    </div>
  );
}

const TAG_BG: Record<NewsTag, string> = { 속보: C.upBg, 단독: "#C8761A", 찌라시: "#4A5470" };

/** 속보 한 줄: [속보] 게임 · 신작 사전예약 500만 돌파 ▲호재 (변동 뒤: ✔ 적중 / ✘ 오보) */
function NewsLine({ n }: { n: BNews }) {
  const s = STOCKS[n.stock];
  return (
    <span className="stk-pop flex min-w-0 items-center gap-[6px] text-[12px]">
      <b className="shrink-0 rounded-[3px] px-[4px] text-[10px]" style={{ background: TAG_BG[n.tag], color: "#fff" }}>
        {n.tag}
      </b>
      <b className="shrink-0" style={{ color: s.color }}>
        {s.name}
      </b>
      <span className="min-w-0 truncate font-bold" style={{ color: C.text }}>
        {n.text}
      </span>
      <b className="shrink-0" style={{ color: n.dir > 0 ? C.up : C.down }}>
        {n.dir > 0 ? "▲호재" : "▼악재"}
      </b>
      {n.hit !== undefined && (
        <b className="stk-pop shrink-0" style={{ color: n.hit ? C.green : C.mute }}>
          {n.hit ? "✔ 적중" : "✘ 오보ㅋㅋ"}
        </b>
      )}
    </span>
  );
}

function TradePanel({ stock, price, hold, cash, cost, maxQ, onBuy, onSell }: { stock: number; price: number; hold: number; cash: number; cost: number; maxQ: number; onBuy: (q: number) => void; onSell: (q: number) => void }) {
  const [preview, setPreview] = useState<{ side: "buy" | "sell"; q: number } | null>(null);
  const pv = preview ?? { side: "buy" as const, q: Math.min(10, Math.max(1, maxQ)) };
  const q = pv.side === "buy" ? Math.min(pv.q, maxQ) : Math.min(pv.q, hold);
  const amount = pv.side === "buy" ? buyCost(price, q) : sellGain(price, q);
  const after = pv.side === "buy" ? afterBuy(price, q) : afterSell(price, q);
  const s = STOCKS[stock];
  const avg = hold ? cost / hold : 0;
  const tap = (side: "buy" | "sell", n: number) => (side === "buy" ? onBuy(n) : onSell(n));
  const hoverOn = (side: "buy" | "sell", n: number) => () => setPreview({ side, q: n });
  return (
    <>
      <div className="flex items-baseline gap-[8px]">
        <span className="text-[16px] font-black" style={{ color: s.color }}>
          {s.name}
        </span>
        <span className={`text-[16px] font-bold ${NUM}`}>{won(price)}</span>
      </div>
      <div className={`flex justify-between text-[11px] ${NUM}`} style={{ color: C.mute }}>
        <span>
          보유 <b style={{ color: C.text }}>{hold}주</b>
          {hold > 0 && <> · 평단 {won(avg)}</>}
        </span>
        <span>
          현금 <b style={{ color: C.text }}>{won(cash)}</b>
        </span>
      </div>
      <div className="grid grid-cols-4 gap-[5px]">
        {BUY_Q.map((n) => (
          <Btn key={n} tone="buy" className="h-[44px] text-[13px]" disabled={maxQ < 1} onClick={() => tap("buy", n)} onPointerEnter={hoverOn("buy", n)}>
            +{n}
          </Btn>
        ))}
        <Btn tone="buy" className="h-[44px] text-[12px]" disabled={maxQ < 1} onClick={() => tap("buy", maxQ)} onPointerEnter={hoverOn("buy", maxQ)}>
          MAX
          <span className="text-[9px] opacity-80">{maxQ}</span>
        </Btn>
      </div>
      <div className="grid grid-cols-4 gap-[5px]">
        {BUY_Q.map((n) => (
          <Btn key={n} tone="sell" className="h-[44px] text-[13px]" disabled={hold < 1} onClick={() => tap("sell", n)} onPointerEnter={hoverOn("sell", n)}>
            −{n}
          </Btn>
        ))}
        <Btn tone="sell" className="h-[44px] text-[12px]" disabled={hold < 1} onClick={() => tap("sell", hold)} onPointerEnter={hoverOn("sell", hold)}>
          전부
        </Btn>
      </div>
      <div className={`mt-[2px] rounded-[8px] p-[8px] text-[11px] ${NUM}`} style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.mute }}>
        <div className="mb-[2px] font-bold" style={{ color: pv.side === "buy" ? C.up : C.down }}>
          {q}주 {pv.side === "buy" ? "매수" : "매도"} 미리보기
        </div>
        <div className="flex justify-between">
          <span>예상 평균가</span>
          <b style={{ color: C.text }}>{q ? won(amount / q) : "-"}</b>
        </div>
        <div className="flex justify-between">
          <span>{pv.side === "buy" ? "드는 돈" : "받는 돈"}</span>
          <b style={{ color: C.text }}>{won(amount)}</b>
        </div>
        <div className="flex justify-between">
          <span>체결 후 시세</span>
          <b style={{ color: signColor(after - price) }}>
            {won(after)} ({pct(after / price - 1, 0)})
          </b>
        </div>
      </div>
      <div className="mt-auto text-[10px] leading-snug" style={{ color: C.mute }}>
        1주마다 시세 ±1% · 체결은 도착 순서 · PC: Q W E R 매수 / A S D F 매도
      </div>
    </>
  );
}

function RankList({ room, game, ranking, me }: { room: BRoomWire; game: BGameWire; ranking: { i: number; a: number }[]; me: number }) {
  // 지난 변동 대비 오르고 내림 → 표정
  return (
    <div className="flex flex-col gap-[4px] overflow-y-auto">
      {ranking.map((r, k) => {
        const s = room.seats[game.map[r.i]];
        const m = r.a / BATTLE.startCash;
        const face = m >= 3 ? "joy" : m >= 1.2 ? "smile" : m < 0.5 ? "shock" : m < 0.9 ? "sad" : "idle";
        return (
          <div key={r.i} className="flex items-center gap-[6px] rounded-[8px] px-[6px] py-[4px]" style={{ background: r.i === me ? C.goldBg : C.panel2, border: `1px solid ${r.i === me ? C.gold : C.line}` }}>
            <span className={`w-[18px] text-center text-[13px] font-black ${NUM}`} style={{ color: k === 0 ? C.gold : C.mute }}>
              {k + 1}
            </span>
            {s && <Avatar nick={s.nick} bot={s.bot ? "🤖" : null} size={26} ring={face === "joy" ? C.up : face === "shock" ? C.down : undefined} />}
            <span className="min-w-0 flex-1 truncate text-[12px] font-bold">
              {s?.nick ?? "?"}
              {s?.bot && <span className="ml-[3px] text-[9px] font-normal" style={{ color: C.mute }}>봇</span>}
            </span>
            <span className={`text-[12px] font-bold ${NUM}`} style={{ color: signColor(m - 1) }}>
              {won(r.a)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ───────────── 결과 ─────────────

export function Result({ r, myUid, onClose }: { r: BResult; myUid: string; onClose: () => void }) {
  const [cut, setCut] = useState(true);
  useEffect(() => {
    const mine = r.rows.find((x) => x.uid === myUid);
    if (mine) sfx(mine.rank === 1 ? "big" : mine.rank <= Math.ceil(r.rows.length / 2) ? "win" : "lose");
    const t = setTimeout(() => setCut(false), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const top = r.rows[0];
  const seatName = (seat: number) => r.rows.find((x) => x.seat === seat)?.nick ?? "?";
  const hl = r.highlights;
  // 자산 곡선 (판 자리 순서 = rows 를 seat 로 매핑해야 해서 seat → curve 열 번호)
  const seats = [...r.rows].sort((a, b) => a.seat - b.seat).map((x) => x.seat);
  const W = 420,
    H = 150;
  const maxV = Math.max(...r.curve.flat());
  const ly = (v: number) => H - 6 - (Math.log10(Math.max(v, 1e6)) - 6) / (Math.log10(maxV) - 6 + 1e-9) * (H - 14);
  const COLORS = ["#F2C14E", "#FF5C66", "#4D8DFF", "#4FD1A5", "#C77DFF", "#FF9F43", "#5BA8FF", "#9AA4B2"];
  return (
    <Sheet width={760}>
      <div className="relative flex gap-[12px] p-[14px]">
        {cut && (
          <div className="stk-cutin pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden rounded-[14px]" style={{ background: "linear-gradient(90deg, rgba(15,20,32,0.2), rgba(42,38,20,0.95), rgba(15,20,32,0.2))" }} onClick={() => setCut(false)}>
            <div className={`${TITLE} text-[120px] leading-none`} style={{ color: C.gold, textShadow: "0 0 40px rgba(242,193,78,0.6)" }}>
              1
            </div>
            <div className="absolute bottom-[18px] left-0 w-full text-center">
              <div className={`${TITLE} text-[30px]`} style={{ color: C.gold, textShadow: "0 2px 12px rgba(0,0,0,0.8)" }}>
                1위 {top.nick}
              </div>
              <div className={`text-[16px] font-bold ${NUM}`}>
                {won(top.final)} · {mult(top.mult)}
              </div>
            </div>
          </div>
        )}
        <div className="flex w-[300px] shrink-0 flex-col gap-[4px]">
          <div className={`${TITLE} mb-[2px] text-[18px]`}>대전 결과</div>
          {r.rows.map((x) => (
            <div key={x.seat} className="flex items-center gap-[6px] rounded-[8px] px-[6px] py-[4px]" style={{ background: x.uid === myUid ? C.goldBg : C.panel2, border: `1px solid ${x.uid === myUid ? C.gold : C.line}` }}>
              <span className={`w-[18px] text-center text-[13px] font-black ${NUM}`} style={{ color: x.rank === 1 ? C.gold : C.mute }}>
                {x.rank}
              </span>
              <Avatar nick={x.nick} bot={x.bot ? "🤖" : null} size={26} ring={x.rank === 1 ? C.gold : undefined} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-bold">
                  {x.nick}
                  {x.bot && (
                    <span className="ml-[3px] text-[9px] font-normal" style={{ color: C.mute }}>
                      봇 · {BOT_STYLES[x.bot.style].name}
                    </span>
                  )}
                </div>
                <div className={`text-[10px] ${NUM}`} style={{ color: C.mute }}>
                  거래 {x.trades}번{x.main !== null && ` · 주력 ${STOCKS[x.main].name}`}
                </div>
              </div>
              <div className={`text-right ${NUM}`}>
                <div className="text-[12px] font-bold">{won(x.final)}</div>
                <div className="text-[10px] font-bold" style={{ color: signColor(x.mult - 1) }}>
                  {mult(x.mult)}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
          <div className="text-[11px]" style={{ color: C.mute }}>
            7분 동안 자산 (로그 눈금)
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-[8px]" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
            <line x1="0" x2={W} y1={ly(BATTLE.startCash)} y2={ly(BATTLE.startCash)} stroke={C.line} strokeDasharray="3 3" />
            {seats.map((seat, col) => {
              const row = r.rows.find((x) => x.seat === seat)!;
              const pts = r.curve.map((c, k) => `${(k / (r.curve.length - 1)) * W},${ly(c[col])}`).join(" ");
              return <polyline key={seat} points={pts} fill="none" stroke={COLORS[col % COLORS.length]} strokeWidth={row.uid === myUid ? 2.6 : 1.2} opacity={row.uid === myUid ? 1 : 0.75} />;
            })}
          </svg>
          <div className="flex flex-wrap gap-[6px] text-[10px]">
            {seats.map((seat, col) => (
              <span key={seat} className="flex items-center gap-[3px]">
                <i className="inline-block h-[3px] w-[10px]" style={{ background: COLORS[col % COLORS.length] }} />
                {seatName(seat)}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-[4px] text-[12px]">
            <Highlight icon="🚀" text={`최고 종목 ${STOCKS[hl.bestStock.stock].name} · 시작가의 ${mult(hl.bestStock.mult)}`} />
            {hl.bigGain.seat >= 0 && <Highlight icon="💰" text={`${seatName(hl.bigGain.seat)} · ${hl.bigGain.k}번째 변동에서 +${won(hl.bigGain.amount)}`} />}
            {hl.bigDump.seat >= 0 && <Highlight icon="💥" text={`${seatName(hl.bigDump.seat)} · ${josa(STOCKS[hl.bigDump.stock].name, "을", "를")} 한 번에 ${won(hl.bigDump.amount)} 던짐`} />}
          </div>
          <div className="mt-auto flex gap-[8px]">
            <Btn tone="gold" className="h-[42px] flex-1 text-[14px]" onClick={onClose}>
              확인
            </Btn>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

const Highlight = ({ icon, text }: { icon: string; text: string }) => (
  <div className="flex items-center gap-[6px] rounded-[8px] px-[8px] py-[5px]" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
    <span>{icon}</span>
    <span>{text}</span>
  </div>
);
