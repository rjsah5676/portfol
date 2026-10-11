"use client";

import { useEffect, useState } from "react";
import { fmtShort } from "@/lib/poker/rules";
import type { MailItem, Wallet } from "@/lib/poker/types";
import { sfx } from "@/lib/poker/sfx";
import { claimMail, getMail } from "@/realtime/poker";
import Sheet from "./Sheet";

/** 우편 종류별 제목 */
const TITLE: Record<MailItem["kind"], string> = { attend: "출석 보상" };

/** 우편함: 받기를 눌러야 칩이 들어옴 (하나씩 · 모두) */
export default function Mailbox({
  mobile,
  maxH,
  onClose,
  onWallet,
}: {
  mobile: boolean;
  maxH: number;
  onClose: () => void;
  onWallet: (w: Wallet) => void;
}) {
  const [list, setList] = useState<MailItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let alive = true;
    getMail()
      .then((l) => alive && setList(l))
      .catch((e: Error) => alive && (setList([]), setMsg(e.message)));
    return () => {
      alive = false;
    };
  }, []);
  const take = async (id?: string) => {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await claimMail(id);
      if (r.wallet) onWallet(r.wallet);
      if (r.got) {
        sfx.coin();
        setMsg(`칩 ${fmtShort(r.got)}을 받았어요`);
      }
      setList((l) => (l ? (id ? l.filter((m) => m.id !== id) : []) : l));
    } catch (e) {
      setMsg((e as Error).message);
      setList(await getMail().catch(() => []));
    } finally {
      setBusy(false);
    }
  };
  return (
    // 크기를 미리 잡아 둠 (불러오는 중 · 비었을 때 · 많을 때 창 크기가 출렁이지 않게)
    <Sheet mobile={mobile} maxH={Math.min(maxH, 440)} wide={480} fill onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col">
        {/* 머리: 오른쪽 위 닫기(X) 자리를 비워 둠 */}
        <div className="flex h-[48px] shrink-0 items-center gap-[0.5em] border-b border-white/10 pr-[52px] pl-[1em]">
          <span className="pk-frame-title">우편함</span>
          {!!list?.length && <span className="text-[0.8em] text-white/50">안 받은 우편 {list.length}개</span>}
        </div>
        <div className="pk-scroll min-h-0 flex-1 overflow-y-auto p-[0.8em]" data-sheet-scroll>
          {list === null ? (
            <p className="flex h-full items-center justify-center text-[0.9em] text-white/50">불러오는 중…</p>
          ) : list.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-[0.4em] text-white/50">
              <span className="text-[2em] opacity-60" aria-hidden>
                📭
              </span>
              <span className="text-[0.9em]">받을 우편이 없어요</span>
            </div>
          ) : (
            <div className="flex flex-col gap-[0.45em]">
              {list.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-[0.7em] rounded-[10px] border border-[rgba(214,175,92,0.3)] bg-black/35 px-[0.8em] py-[0.6em]"
                >
                  <span className="text-[1.5em]" aria-hidden>
                    🎁
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <b className="text-[0.95em] text-white">{TITLE[m.kind] ?? "우편"}</b>
                    <span className="text-[0.78em] text-white/50">
                      {m.day.slice(5).replace("-", "월 ")}일 · 칩 <b className="text-[var(--pk-brass)]">{fmtShort(m.amount)}</b>
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void take(m.id)}
                    className="pk-btn pk-btn-gold px-[1em] py-[0.35em] text-[0.88em]"
                  >
                    받기
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex h-[56px] shrink-0 items-center gap-[0.6em] border-t border-white/10 px-[0.9em]">
          <span className="min-w-0 flex-1 truncate text-[0.85em] text-[#ffd84a]">{msg}</span>
          <button
            type="button"
            disabled={busy || !list?.length}
            onClick={() => void take()}
            className="pk-btn pk-btn-gold px-[1.2em] py-[0.45em] text-[0.9em] disabled:opacity-40"
          >
            모두 받기
          </button>
        </div>
      </div>
    </Sheet>
  );
}
