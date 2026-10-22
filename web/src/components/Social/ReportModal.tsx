"use client";

import { useState } from "react";
import Modal from "@/components/Modal/Modal";
import { sendReport } from "@/lib/api/social";
import { REPORT_REASONS, REPORT_TEXT_MAX, type ReportReason } from "@/lib/social";
import { social, useSocial } from "@/lib/socialStore";
import { KR, btn } from "./parts";

/* 신고하기: 사유 + 내용 → 관리자 화면 「신고」. 두 사람 사이 메시지가 있으면 서버가 최근 것을 같이 붙임 */

export default function ReportModal() {
  const s = useSocial();
  const nick = s.ui.report;
  const close = () => social.setUi({ report: null });
  return (
    <Modal open={!!nick} onClose={close} title="신고하기" size="sm" closeButton>
      {nick && <ReportBody key={nick} nick={nick} close={close} />}
    </Modal>
  );
}

function ReportBody({ nick, close }: { nick: string; close: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    setMsg(null);
    try {
      await sendReport({
        nick,
        reason,
        text,
        where: location.pathname + location.search,
      });
      setDone(true);
    } catch (e) {
      setMsg((e as Error).message || "보내지 못했어요. 잠시 후 다시 해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={KR}>
      {done ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm leading-relaxed break-keep text-white/75">
            <b className="text-white">{nick}</b> 님을 신고했어요.
            <br />
            관리자가 확인한 뒤 조치할게요.
          </p>
          <button type="button" className={btn.ghost} onClick={close}>
            닫기
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-white/70">
            <b className="text-white">{nick}</b> 님을 신고하는 이유를 골라 주세요.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="신고 사유">
            {REPORT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(r)}
                className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  reason === r
                    ? "border-[#F43F5E] bg-[#F43F5E]/15 text-white"
                    : "border-white/15 text-white/65 hover:text-white"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <label className="mt-4 block">
            <span className="mb-1 block text-xs text-white/50">자세한 내용 (선택)</span>
            <textarea
              value={text}
              maxLength={REPORT_TEXT_MAX}
              rows={4}
              onChange={(e) => setText(e.target.value)}
              placeholder="언제 · 어디서 · 어떤 일이 있었는지 적어 주면 확인이 빨라요"
              className="w-full resize-y rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#6C63FF]/70"
            />
            <span className="mt-0.5 block text-right font-mono text-[10px] text-white/30">
              {text.length}/{REPORT_TEXT_MAX}
            </span>
          </label>
          <p className="mt-1 text-[11px] leading-relaxed break-keep text-white/35">
            두 사람이 주고받은 메시지가 있으면 최근 것이 신고에 같이 붙어요. 허위 신고는 제재될 수
            있어요.
          </p>
          {msg && <p className="mt-2 text-xs text-red-300">{msg}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btn.ghost} onClick={close}>
              취소
            </button>
            <button
              type="button"
              disabled={!reason || busy}
              onClick={() => void submit()}
              className="cursor-pointer rounded-lg bg-[#F43F5E] px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#e11d48] disabled:cursor-default disabled:opacity-40"
            >
              {busy ? "보내는 중…" : "신고하기"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
