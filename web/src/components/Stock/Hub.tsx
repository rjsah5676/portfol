"use client";

import { useEffect } from "react";
import type { HubStatus, StockMe } from "@/lib/stock/types";
import { REVIVE_TO, REVIVE_UNDER } from "@/lib/stock/money";
import { bgm } from "@/lib/stock/sound";
import { C, NUM, SoundToggle, TITLE, TopBar, WalletChip, pct, won } from "./ui";

/*
 * 첫 화면 — 증권사 HTS 메인처럼: 위에 시세 띠, 가운데 모드 셋(솔로 · 코인 · 대전), 오른쪽 내 자산 · 순위.
 * PC 숫자키 1 솔로 · 2 코인 · 3 대전 · 4 순위.
 */

export type HubGo = "solo" | "coin" | "lobby" | "records";

const TICKER: [string, number][] = [
  ["주식게임 지수", 1.25],
  ["가상전자", 2.1],
  ["모의바이오", -0.84],
  ["차트코인", 5.73],
  ["턴제건설", -1.12],
  ["대전엔터", 0.96],
  ["캔들화학", 3.4],
  ["레버리지금융", -2.3],
];

export default function Hub({ me, status, onGo }: { me: StockMe | null; status: HubStatus | null; onGo: (g: HubGo) => void }) {
  useEffect(() => {
    bgm("trade");
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const m: Record<string, HubGo> = { "1": "solo", "2": "coin", "3": "lobby", "4": "records" };
      if (m[e.key]) onGo(m[e.key]);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onGo]);

  const s = status;
  const modes: { go: HubGo; key: string; title: string; en: string; sub: string; status: string | null; color: string }[] = [
    {
      go: "solo",
      key: "1",
      title: "솔로",
      en: "CHART 50",
      sub: "차트 하나로 50턴 · 예약 주문 · 복기",
      status: s?.soloTurn != null ? `하던 판 ${s.soloTurn}/50턴` : s?.soloLast != null ? `지난 판 ${pct(s.soloLast)}` : s ? "새 판 바로 시작" : null,
      color: C.up,
    },
    {
      go: "coin",
      key: "2",
      title: "코인",
      en: "LEVERAGE ×10",
      sub: "1시간봉 50턴 · 레버리지 1 · 3 · 10배 · 청산 주의",
      status: s?.coinTurn != null ? `하던 판 ${s.coinTurn}/50턴` : s?.coinLast != null ? `지난 판 ${pct(s.coinLast)}` : "하이리스크 · 하이리턴",
      color: "#F7B32B",
    },
    {
      go: "lobby",
      key: "3",
      title: "대전",
      en: "LIVE 7 MIN",
      sub: "2~8명 · 봇 · 10종목 7분 실시간 승부",
      status: s ? (s.rooms ? `열린 방 ${s.rooms}${s.playing ? ` · 대전 중 ${s.playing}` : ""}` : "봇과 바로 시작") : null,
      color: C.cyan,
    },
  ];

  return (
    <div className="stk-grid flex h-full flex-col">
      <TopBar
        title={
          <span className={`${TITLE} text-[18px] tracking-wide`} style={{ color: C.gold }}>
            주식게임
          </span>
        }
        right={
          <div className="flex items-center gap-[6px]">
            <SoundToggle />
            <WalletChip value={me?.total ?? null} />
          </div>
        }
      />
      {/* 시세 띠 */}
      <div className="relative h-[26px] shrink-0 overflow-hidden" style={{ background: "#0B1030", borderBottom: `1px solid ${C.line}` }}>
        <div className={`stk-ticker absolute top-0 left-0 flex h-full items-center gap-[28px] pl-[16px] text-[12px] whitespace-nowrap ${NUM}`}>
          {[...TICKER, ...TICKER].map(([n, c], i) => (
            <span key={i} className="flex items-center gap-[6px]">
              <b style={{ color: C.text }}>{n}</b>
              <span style={{ color: c >= 0 ? C.up : C.down }}>
                {c >= 0 ? "▲" : "▼"}
                {Math.abs(c).toFixed(2)}%
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-[12px] p-[14px]">
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-[12px]">
          {modes.map((m) => (
            <button
              key={m.go}
              type="button"
              onClick={() => onGo(m.go)}
              className="stk-btn group relative flex cursor-pointer flex-col overflow-hidden rounded-[12px] p-[16px] text-left"
              style={{ background: `linear-gradient(180deg, ${C.panel2}, ${C.panel})`, border: `1px solid ${C.line}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" }}
            >
              <span className="pointer-events-none absolute top-0 right-0 left-0 h-[3px]" style={{ background: m.color, boxShadow: `0 0 14px ${m.color}` }} />
              <div className="flex items-center gap-[8px]">
                <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-[11px] font-black ${NUM}`} style={{ background: `${m.color}22`, border: `1px solid ${m.color}66`, color: m.color }}>
                  {m.key}
                </span>
                <span className={`text-[10px] font-black tracking-[0.18em] ${NUM}`} style={{ color: m.color }}>
                  {m.en}
                </span>
              </div>
              <div className={`${TITLE} mt-[10px] text-[34px] leading-none`}>{m.title}</div>
              <div className="mt-[8px] text-[12px] leading-snug" style={{ color: C.mute }}>
                {m.sub}
              </div>
              <MiniChart color={m.color} seed={m.key.charCodeAt(0)} />
              <div className={`mt-auto flex items-center justify-between rounded-[8px] px-[10px] py-[7px] text-[12px] font-bold ${NUM}`} style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${C.line}` }}>
                <span style={{ color: m.status ? C.text : C.mute }}>{m.status ?? "…"}</span>
                <span style={{ color: m.color }}>시작 ›</span>
              </div>
            </button>
          ))}
        </div>
        <div className="flex w-[230px] shrink-0 flex-col gap-[10px]">
          <div className="rounded-[12px] p-[12px]" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
            <div className="text-[10px] font-black tracking-[0.14em]" style={{ color: C.cyan }}>
              MY ACCOUNT
            </div>
            <div className="mt-[4px] truncate text-[13px] font-bold">{me?.nick ?? "…"}</div>
            <Row k="총자산" v={me ? won(me.total) : "…"} strong />
            <Row k="현금" v={me ? won(me.money) : "…"} />
            <Row k="들고 있는 것" v={me ? won(me.held) : "…"} />
            <div className="mt-[8px] grid grid-cols-3 gap-[4px] text-center">
              <Mini k="솔로" v={me ? `${me.solo.games}판` : "-"} />
              <Mini k="코인" v={me ? `${me.coin.games}판` : "-"} />
              <Mini k="대전" v={me ? `${me.battle.games}판` : "-"} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => onGo("records")}
            className="stk-btn flex cursor-pointer items-center gap-[8px] rounded-[12px] px-[12px] py-[12px] text-left"
            style={{ background: `linear-gradient(180deg, #2A2614, ${C.panel2})`, border: `1px solid ${C.gold}66` }}
          >
            <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-[11px] font-black ${NUM}`} style={{ background: `${C.gold}22`, border: `1px solid ${C.gold}66`, color: C.gold }}>
              4
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold" style={{ color: C.gold }}>
                순위 · 기록
              </div>
              <div className="text-[11px]" style={{ color: C.mute }}>
                총자산 · 주간 · 월간 손익 · 내 전적
              </div>
            </div>
            <span style={{ color: C.gold }}>›</span>
          </button>
          <div className="mt-auto rounded-[10px] px-[10px] py-[8px] text-[11px] leading-relaxed" style={{ background: "rgba(0,0,0,0.2)", border: `1px solid ${C.line}`, color: C.mute }}>
            처음 1억으로 시작해요. 판이 끝났을 때 총자산이 {won(REVIVE_UNDER)} 밑이면 {won(REVIVE_TO)}으로 다시 시작할 수 있어요. 실제 돈이 오가지 않는 게임이에요.
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="mt-[6px] flex items-baseline justify-between">
      <span className="text-[11px]" style={{ color: C.mute }}>
        {k}
      </span>
      <b className={`${NUM} ${strong ? "text-[16px]" : "text-[13px]"}`} style={{ color: strong ? C.gold : C.text }}>
        {v}
      </b>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-[6px] py-[4px]" style={{ background: "rgba(0,0,0,0.25)" }}>
      <div className="text-[9px]" style={{ color: C.mute }}>
        {k}
      </div>
      <div className={`text-[12px] font-bold ${NUM}`}>{v}</div>
    </div>
  );
}

/** 카드 장식용 작은 캔들 차트 (오르는 흐름) */
function MiniChart({ color, seed }: { color: string; seed: number }) {
  let x = seed * 9301 + 49297;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const N = 18;
  const cs: { o: number; c: number; h: number; l: number }[] = [];
  let p = 40;
  for (let i = 0; i < N; i++) {
    const o = p;
    const c = o + (rnd() - 0.32) * 9;
    cs.push({ o, c, h: Math.max(o, c) + rnd() * 3, l: Math.min(o, c) - rnd() * 3 });
    p = c;
  }
  const lo = Math.min(...cs.map((k) => k.l)),
    hi = Math.max(...cs.map((k) => k.h));
  const W = 200,
    H = 64;
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8);
  const bw = W / N;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="my-[10px] w-full opacity-80" preserveAspectRatio="none" aria-hidden style={{ height: 64 }}>
      {cs.map((k, i) => {
        const up = k.c >= k.o;
        const col = up ? C.up : C.down;
        const cx = i * bw + bw / 2;
        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={y(k.h)} y2={y(k.l)} stroke={col} strokeWidth={1} />
            <rect x={cx - bw * 0.3} width={bw * 0.6} y={y(Math.max(k.o, k.c))} height={Math.max(1.5, Math.abs(y(k.o) - y(k.c)))} fill={col} />
          </g>
        );
      })}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        points={cs.map((k, i) => `${i * bw + bw / 2},${y(cs.slice(Math.max(0, i - 4), i + 1).reduce((a, b) => a + b.c, 0) / Math.min(i + 1, 5))}`).join(" ")}
      />
    </svg>
  );
}
