"use client";

import { useEffect, useRef, useState } from "react";
import { CHAT_MAX, subscribeChat, type ChatMsg } from "@/realtime/sketch";

export default function SketchChat({
  roomId,
  uid,
  disabledReason,
  placeholder,
  onSend,
}: {
  roomId: string;
  uid: string;
  /** 지금 입력할 수 없는 이유 (그리는 중, 이미 맞힘 등) */
  disabledReason: string;
  placeholder: string;
  onSend: (text: string) => void;
}) {
  const [list, setList] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeChat(roomId, setList), [roomId]);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [list]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabledReason) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/10 bg-[#1C1E24]">
      <div
        ref={boxRef}
        className="thin-scroll min-h-[160px] flex-1 space-y-1 overflow-y-auto px-3 py-2 font-['Nanum_Gothic',sans-serif] text-[13px] leading-relaxed"
      >
        {list.length === 0 && <p className="text-white/25">채팅·정답을 여기에 입력하세요</p>}
        {list.map((m) =>
          m.kind === "system" ? (
            <p key={m.id} className="text-center font-mono text-[11px] text-[#A9A3FF]/80">
              {m.text}
            </p>
          ) : m.kind === "correct" ? (
            <p key={m.id} className="font-medium text-emerald-300">
              ✓ {m.text}
            </p>
          ) : (
            <p key={m.id} className="break-all text-white/80">
              <span className={m.uid === uid ? "text-[#A9A3FF]" : "text-white/45"}>{m.nick}</span>{" "}
              {m.text}
            </p>
          )
        )}
      </div>
      <div className="flex gap-1.5 border-t border-white/10 p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
          maxLength={CHAT_MAX}
          disabled={!!disabledReason}
          placeholder={disabledReason || placeholder}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#15171c] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#6C63FF]/50 focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!!disabledReason || !text.trim()}
          className="cursor-pointer rounded-lg bg-[#6C63FF] px-3 font-mono text-xs text-white disabled:cursor-default disabled:opacity-40"
        >
          전송
        </button>
      </div>
    </div>
  );
}
