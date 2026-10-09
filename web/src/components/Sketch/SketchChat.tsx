"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { AVATAR_COLOR, avatarOf } from "@/lib/sketch/assets";
import { playSfx } from "@/lib/sketch/sfx";
import { CHAT_MAX, subscribeChat, type ChatMsg } from "@/realtime/sketch";
import { Avatar, Icon, Who } from "./Art";

/** 채팅 · 정답 입력. 그리는 중엔 이 칸에 친 말이 곧 정답 시도 */
export default function SketchChat({
  roomId,
  uid,
  disabledReason,
  placeholder,
  guessing,
  onSend,
  inputRef,
  compact = false,
}: {
  roomId: string;
  uid: string;
  /** 지금 입력할 수 없는 이유 (그리는 중, 이미 맞힘 등) */
  disabledReason: string;
  placeholder: string;
  /** 지금 치는 말이 정답 시도인지 (입력칸을 강조) */
  guessing: boolean;
  onSend: (text: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** 세로판: 줄 간격 좁게 */
  compact?: boolean;
}) {
  const [list, setList] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef(true);
  const lastIdRef = useRef("");

  useEffect(
    () =>
      subscribeChat(roomId, (l) => {
        // 처음 받은 목록 뒤로 새로 온 남의 말에만 소리
        const last = l[l.length - 1];
        if (
          !firstRef.current &&
          last &&
          last.uid !== uid &&
          (last.kind === "msg" || last.kind === "close") &&
          last.id !== lastIdRef.current
        )
          playSfx(last.kind === "close" ? "sfx-hint" : "sfx-chat");
        firstRef.current = false;
        lastIdRef.current = last?.id ?? "";
        setList(l);
      }),
    [roomId, uid]
  );
  /** 거의 맞힌 내 채팅 (초록으로) */
  const closeOf = new Set(list.flatMap((m) => (m.kind === "close" && m.of ? [m.of] : [])));
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [list]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabledReason) return;
    playSfx(guessing ? "sfx-send" : "sfx-chat");
    onSend(t);
    setText("");
  };

  return (
    <div className="sk-card-soft flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={boxRef}
        className={`sk-scroll min-h-0 flex-1 overflow-y-auto px-2.5 ${compact ? "space-y-1 py-1.5 text-[13.5px]" : "space-y-1.5 py-2.5 text-[14px]"} leading-snug`}
      >
        {list.length === 0 && (
          <p className="pt-2 text-center text-[12.5px] text-[var(--ink3)]">
            채팅 · 정답을 아래에 입력하세요
          </p>
        )}
        {list.map((m) =>
          m.kind === "system" ? (
            <p key={m.id} className="sk-msg text-center text-[12.5px] font-bold text-[var(--ink3)]">
              {m.text}
            </p>
          ) : m.kind === "close" ? (
            <p
              key={m.id}
              className="sk-msg rounded-lg border-2 border-dashed border-[#4CAF50] bg-[#6BCB77]/15 px-2 py-0.5 text-center text-[12px] leading-snug font-bold text-[#2E7D32]"
            >
              🔥 {m.text}
              <span className="ml-1 text-[10.5px] font-bold text-[#2E7D32]/60">(나만 보여요)</span>
            </p>
          ) : m.kind === "correct" ? (
            <p
              key={m.id}
              className="sk-msg rounded-lg border-2 border-[var(--mint)] bg-[#2EC4B6]/15 px-2 py-0.5 text-center text-[12px] leading-snug font-bold text-[#138a7f]"
            >
              🎉 {m.text}
            </p>
          ) : (
            <div
              key={m.id}
              className={`sk-msg flex items-start gap-1.5 ${m.uid === uid ? "flex-row-reverse" : ""}`}
            >
              {!compact && <Avatar idx={avatarOf(m.uid)} size={24} className="mt-0.5" />}
              <div
                className={`flex min-w-0 flex-col ${m.uid === uid ? "items-end" : "items-start"}`}
              >
                {m.uid !== uid && (
                  <span
                    className="max-w-full truncate text-[12px] font-bold"
                    style={{ color: AVATAR_COLOR[avatarOf(m.uid)] }}
                  >
                    <span className="brightness-75">
                      <Who name={m.nick} />
                    </span>
                  </span>
                )}
                <span
                  className={`max-w-full rounded-xl px-2.5 py-1 break-all ${
                    m.uid === uid
                      ? closeOf.has(m.id)
                        ? "rounded-tr-sm bg-[#43A047] text-white ring-2 ring-[#A5D6A7]"
                        : "rounded-tr-sm bg-[var(--ink)] text-white"
                      : "rounded-tl-sm border-[1.5px] border-[var(--line)] bg-white"
                  }`}
                >
                  {m.text}
                </span>
              </div>
            </div>
          )
        )}
      </div>
      <div
        className={`flex gap-1.5 border-t-2 border-dashed border-[var(--line)] p-2 ${guessing ? "bg-[#FFC93C]/20" : ""}`}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
          maxLength={CHAT_MAX}
          disabled={!!disabledReason}
          placeholder={disabledReason || placeholder}
          enterKeyHint="send"
          autoComplete="off"
          className={`sk-input py-2 text-[15.5px] ${guessing ? "border-[var(--orange)]" : ""}`}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!!disabledReason || !text.trim()}
          aria-label="보내기"
          className={`sk-btn sk-btn-icon shrink-0 text-[16px] ${guessing ? "sk-btn-sun" : "sk-btn-sky"}`}
        >
          <Icon name="send" size={18} />
        </button>
      </div>
    </div>
  );
}
