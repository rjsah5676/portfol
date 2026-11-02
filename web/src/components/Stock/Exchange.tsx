"use client";

import { useEffect, useState } from "react";
import type { ExchangeView } from "@/lib/stock/types";
import { EXCHANGE_UNIT, REVIVE_UNDER } from "@/lib/stock/money";
import { sfx } from "@/lib/stock/sound";
import { exchange, exchangeView } from "@/realtime/stock";
import { Btn, C, NUM, Sheet, comma, won } from "./ui";

/*
 * 환전소 — 주식게임 돈 ↔ ANIME POKER 칩 1:1 (주식게임 첫 화면에서만 열림).
 * 금액은 만 단위로 고름. 바꾼 뒤 보내는 쪽이 500만은 남아야 하고, 포커 테이블에 앉아 있으면 못 바꿈 — 최종 확인은 서버가.
 */

type Dir = "toPoker" | "toStock";
const MAN = 10_000;
const STEPS = [100 * MAN, 1000 * MAN, 10000 * MAN];

export default function Exchange({ onClose, onDone, toast }: { onClose: () => void; onDone: () => void; toast: (t: string, tone?: "plain" | "up" | "down" | "warn") => void }) {
  const [v, setV] = useState<ExchangeView | null>(null);
  const [dir, setDir] = useState<Dir>("toPoker");
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void exchangeView().then(setV, (e) => toast((e as Error).message, "warn"));
  }, [toast]);

  const max = v ? (dir === "toPoker" ? v.maxToPoker : v.maxToStock) : 0;
  const amt = Math.min(amount, max);
  const fromStock = dir === "toPoker";
  const blocked = !v || !v.open || v.busy || max < EXCHANGE_UNIT;

  const add = (n: number) => setAmount((a) => Math.min(max, Math.min(a, max) + n));
  const swap = () => {
    setDir((d) => (d === "toPoker" ? "toStock" : "toPoker"));
    setAmount(0);
  };
  const go = async () => {
    if (blocked || amt < EXCHANGE_UNIT || busy) return;
    setBusy(true);
    try {
      const nv = await exchange(dir, amt);
      setV(nv);
      setAmount(0);
      sfx("fill");
      toast(`${won(amt)} 환전 완료 · ${fromStock ? "포커 칩으로" : "주식게임 돈으로"}`, "up");
      onDone();
    } catch (e) {
      toast((e as Error).message || "잠시 후 다시 해 주세요.", "warn");
      void exchangeView().then(setV, () => {});
    } finally {
      setBusy(false);
    }
  };

  const stockSide = { label: "주식게임 돈", value: v?.cash ?? null, after: v ? v.cash + (fromStock ? -amt : amt) : null, sub: v ? `총자산 ${won(v.stkTotal)}` : "", color: C.gold };
  const pokerSide = { label: "ANIME POKER 칩", value: v?.chips ?? null, after: v ? v.chips + (fromStock ? amt : -amt) : null, sub: v && v.vault ? `금고 ${won(v.vault)} 따로` : "보유 칩", color: "#FF7BAC" };
  const [from, to] = fromStock ? [stockSide, pokerSide] : [pokerSide, stockSide];

  return (
    <Sheet title="⇄ 환전소" width={520} onClose={onClose}>
      <div className="flex flex-col gap-[8px] overflow-y-auto px-[12px] py-[10px]">
        <div className="flex items-stretch gap-[8px]">
          <Side {...from} tag="보내는 쪽" amt={amt} sign="-" />
          <button
            type="button"
            aria-label="방향 바꾸기"
            onClick={() => (sfx("tab"), swap())}
            className="stk-btn flex w-[44px] shrink-0 cursor-pointer flex-col items-center justify-center rounded-[10px] text-[18px] font-black"
            style={{ background: C.chip, border: `1px solid ${C.chipLine}`, color: C.cyan }}
          >
            ⇄<span className="mt-[2px] text-[9px] font-bold">바꾸기</span>
          </button>
          <Side {...to} tag="받는 쪽" amt={amt} sign="+" />
        </div>

        <div className="rounded-[10px] p-[10px]" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
          <div className="flex items-center gap-[8px]">
            <span className="text-[11px]" style={{ color: C.mute }}>
              금액
            </span>
            <input
              inputMode="numeric"
              value={amt ? String(amt / MAN) : ""}
              placeholder="0"
              disabled={blocked}
              onChange={(e) => {
                const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
                setAmount(Number.isFinite(n) ? Math.min(max, n * MAN) : 0);
              }}
              className={`min-w-0 flex-1 rounded-[6px] px-[8px] py-[5px] text-right text-[18px] font-bold outline-none ${NUM}`}
              style={{ background: C.bg, border: `1px solid ${C.chipLine}`, color: C.text }}
            />
            <span className="text-[13px] font-bold">만</span>
          </div>
          <div className="mt-[8px] flex gap-[6px]">
            {STEPS.map((s) => (
              <Btn key={s} className="h-[30px] flex-1 text-[12px]" disabled={blocked} onClick={() => add(s)}>
                +{won(s)}
              </Btn>
            ))}
            <Btn tone="cyan" className="h-[30px] flex-1 text-[12px]" disabled={blocked} onClick={() => setAmount(max)}>
              최대
            </Btn>
            <Btn tone="ghost" className="h-[30px] w-[44px] text-[12px]" disabled={blocked || !amt} onClick={() => setAmount(0)}>
              ✕
            </Btn>
          </div>
          <div className={`mt-[6px] text-[10px] ${NUM}`} style={{ color: C.mute }}>
            {!v ? "불러오는 중…" : !v.open ? "지금은 환전소가 닫혀 있어요." : v.busy ? "포커 테이블에 앉아 있어서 지금은 못 바꿔요. 일어난 뒤에 와 주세요." : max < EXCHANGE_UNIT ? `바꾸고 나서 ${from.label}이 ${won(REVIVE_UNDER)}은 남아야 해요.` : `최대 ${comma(max)}원 · 만 단위 · 1:1`}
          </div>
        </div>

        <Btn tone="gold" className="h-[40px] shrink-0 text-[15px]" disabled={blocked || amt < EXCHANGE_UNIT || busy} onClick={() => void go()}>
          {amt >= EXCHANGE_UNIT ? `${won(amt)} ${fromStock ? "포커 칩으로" : "주식게임 돈으로"} 바꾸기` : "금액을 골라 주세요"}
        </Btn>
        <div className="text-[10px] leading-snug" style={{ color: C.mute }}>
          1:1 · 바꾼 뒤 보내는 쪽이 {won(REVIVE_UNDER)}은 남아야 해요 (회생 악용 방지) · 포커 금고 칩은 꺼낸 뒤에 바꿀 수 있어요
        </div>
      </div>
    </Sheet>
  );
}

function Side({ label, value, after, sub, color, tag, amt, sign }: { label: string; value: number | null; after: number | null; sub: string; color: string; tag: string; amt: number; sign: "+" | "-" }) {
  return (
    <div className="min-w-0 flex-1 rounded-[10px] px-[10px] py-[8px]" style={{ background: C.panel2, border: `1px solid ${color}55` }}>
      <div className="flex items-center justify-between text-[10px]">
        <b style={{ color }}>{label}</b>
        <span style={{ color: C.mute }}>{tag}</span>
      </div>
      <div className={`mt-[2px] truncate text-[17px] font-black ${NUM}`}>{value === null ? "…" : won(value)}</div>
      <div className={`truncate text-[10px] ${NUM}`} style={{ color: amt ? (sign === "+" ? C.up : C.down) : C.mute }}>
        {amt && after !== null ? `${sign}${won(amt)} → ${won(after)}` : sub}
      </div>
    </div>
  );
}
