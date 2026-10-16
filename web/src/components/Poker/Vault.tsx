"use client";

import { useState } from "react";
import { asset } from "@/lib/poker/assets";
import { fmtWon } from "@/lib/poker/rules";
import type { Wallet } from "@/lib/poker/types";
import { moveVault } from "@/realtime/poker";
import { Money } from "./parts";
import Sheet from "./Sheet";

const EOK = 100_000_000;
/** 빠르게 더하기 버튼 */
const QUICK = [1_000 * 10_000, EOK, 10 * EOK, 100 * EOK];

/**
 * 금고 (로비 위 상점 오른쪽 「금고」 버튼): 보유 칩을 넣어 두고 필요할 때 꺼내 씀.
 * 금고의 칩은 테이블에 들고 가지 않음 (잃을 걱정 없이 모아 두기) · 랭킹에는 합쳐서 셈.
 * 테이블에 앉아 있으면 꺼내기만 — 예약해 두면 다음 판을 시작할 때 들어오고, 모두에게 연출이 뜸.
 */
export default function Vault({
  wallet,
  mobile,
  maxH,
  onClose,
  onWallet,
}: {
  wallet: Wallet;
  mobile: boolean;
  maxH: number;
  onClose: () => void;
  onWallet: (w: Wallet) => void;
}) {
  const [amt, setAmt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const inRoom = !!wallet.table;
  const vault = wallet.vault ?? 0;
  const reserved = wallet.vaultOut ?? 0;

  const run = async (dir: "in" | "out" | "cancel", n: number) => {
    if (busy || (dir !== "cancel" && n < 1)) return;
    setBusy(true);
    setMsg(null);
    try {
      const w = await moveVault(dir, n);
      onWallet(w);
      setAmt(0);
      setMsg({
        text:
          dir === "cancel"
            ? "꺼내기 예약을 취소했어요."
            : dir === "in"
              ? `${fmtWon(n)} 넣었어요.`
              : inRoom
                ? `${fmtWon(n)} 꺼내기 예약 — 다음 판을 시작할 때 들어와요.`
                : `${fmtWon(n)} 꺼냈어요.`,
        ok: true,
      });
    } catch (e) {
      setMsg({ text: (e as { message?: string }).message ?? "처리하지 못했어요.", ok: false });
    } finally {
      setBusy(false);
    }
  };

  const row = "flex items-center justify-between gap-[0.6em] rounded-[8px] bg-white/[0.05] px-[0.8em] py-[0.55em]";
  return (
    <Sheet mobile={mobile} maxH={Math.min(maxH, 480)} wide={440} fill onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-[48px] shrink-0 items-center border-b border-white/10 pr-[52px] pl-[1em]">
          <span className="pk-frame-title">금고</span>
        </div>
        <div className="pk-scroll grid min-h-0 flex-1 content-start gap-[0.6em] overflow-y-auto p-[0.9em] text-[0.9em]" data-sheet-scroll>
          <div className={row}>
            <span className="text-white/65">보유 칩</span>
            <span className="inline-flex items-center gap-[0.35em]">
              <img src={asset.chip("gold", "top")} alt="" className="h-[1em] w-[1em]" />
              <Money won={wallet.money} className="text-[1.1em] text-[#ffd84a]" />
            </span>
          </div>
          <div className={row}>
            <span className="text-white/65">금고</span>
            <Money won={vault} className="text-[1.1em] text-[#9fe7ff]" />
          </div>
          {reserved > 0 && (
            <div className={`${row} border border-[#9fe7ff]/30`}>
              <span className="text-white/65">다음 판에 꺼냄</span>
              <span className="inline-flex items-center gap-[0.5em]">
                <b className="pk-num text-[#ffe58a]">+{fmtWon(reserved)}</b>
                <button type="button" disabled={busy} onClick={() => void run("cancel", 0)} className="pk-btn pk-btn-ghost px-[0.6em] py-[0.2em] text-[0.8em]">
                  취소
                </button>
              </span>
            </div>
          )}

          {/* 금액: 빠르게 더하기 · 초기화 */}
          <div className="grid gap-[0.45em] rounded-[10px] border border-white/[0.08] bg-white/[0.03] p-[0.7em]">
            <div className="flex items-baseline justify-between">
              <span className="text-white/65">옮길 금액</span>
              <b className="text-[1.15em] text-white">{amt ? fmtWon(amt) : "0"}</b>
            </div>
            <div className="grid grid-cols-5 gap-[0.35em]">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => setAmt((a) => a + q)} className="pk-btn pk-btn-ghost px-0 py-[0.45em] text-[0.82em]">
                  +{fmtWon(q)}
                </button>
              ))}
              <button type="button" onClick={() => setAmt(0)} className="pk-btn pk-btn-ghost px-0 py-[0.45em] text-[0.82em]">
                지움
              </button>
            </div>
            <div className={`grid gap-[0.45em] ${inRoom ? "grid-cols-1" : "grid-cols-2"}`}>
              {!inRoom && (
                <button
                  type="button"
                  disabled={busy || amt < 1 || amt > wallet.money}
                  onClick={() => void run("in", amt)}
                  className="pk-btn pk-btn-gold py-[0.6em]"
                >
                  넣기
                </button>
              )}
              <button
                type="button"
                disabled={busy || amt < 1 || amt > vault}
                onClick={() => void run("out", amt)}
                className={`pk-btn ${inRoom ? "pk-btn-gold" : "pk-btn-ghost"} py-[0.6em]`}
              >
                {inRoom ? "꺼내기 예약" : "꺼내기"}
              </button>
            </div>
            <div className={`grid gap-[0.45em] text-[0.85em] ${inRoom ? "grid-cols-1" : "grid-cols-2"}`}>
              {!inRoom && (
                <button
                  type="button"
                  disabled={busy || wallet.money < 1}
                  onClick={() => void run("in", wallet.money)}
                  className="pk-btn pk-btn-ghost py-[0.45em]"
                >
                  전부 넣기
                </button>
              )}
              <button
                type="button"
                disabled={busy || vault < 1}
                onClick={() => void run("out", vault)}
                className="pk-btn pk-btn-ghost py-[0.45em]"
              >
                {inRoom ? "전부 꺼내기 예약" : "전부 꺼내기"}
              </button>
            </div>
          </div>

          {msg && (
            <p
              role="status"
              className={`rounded-[6px] px-[0.7em] py-[0.35em] text-[0.88em] ${msg.ok ? "bg-[#163b2a] text-[#9ff0c8]" : "bg-[#3a1016] text-[#ffc2ca]"}`}
            >
              {msg.text}
            </p>
          )}
          {inRoom && (
            <p className="text-[0.85em] leading-snug break-keep text-[#9fe7ff]">
              테이블에서는 꺼내기만 돼요. 꺼낸 칩은 다음 판을 시작할 때 들어오고, 같은 방 모두에게 보여요.
            </p>
          )}
          <p className="text-[0.8em] leading-snug break-keep text-white/45">
            금고에 넣은 칩은 테이블에 들고 가지 않아요. 랭킹에는 보유 칩과 합쳐서 들어가요.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
