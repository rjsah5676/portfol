"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { roomChat, sendChat } from "@/realtime/rhythmOnline";

const KR = "font-['Nanum_Gothic',sans-serif]";

/** 방 대기실 채팅 (방 오른쪽 아래) */
export default function RoomChat({
  roomId,
  uid,
  color,
  hostUid,
}: {
  roomId: string;
  uid: string;
  color: string;
  hostUid: string;
}) {
  const msgs = useSyncExternalStore(roomChat.subscribe, roomChat.get, roomChat.empty);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 새 글이 오면 맨 아래로 (위로 올려 읽는 중이면 그대로)
  const stick = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setText("");
    stick.current = true;
    try {
      await sendChat(roomId, t);
    } catch {
      setText(t);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col rounded-[1.2cqw] border border-white/12 bg-[#0b0820]/80 px-[1.2cqw] py-[0.8cqw]">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
        }}
        className={`${KR} min-h-0 flex-1 overflow-y-auto text-[1.05cqw] leading-[1.55]`}
      >
        {msgs.length === 0 ? (
          <p className="text-white/30">채팅을 시작해 보세요</p>
        ) : (
          msgs.map((m) => (
            <p key={m.id} className="break-all text-white/85">
              <span
                className="mr-[0.5cqw] font-extrabold"
                style={{ color: m.uid === uid ? color : "rgba(255,255,255,0.6)" }}
              >
                {m.uid === hostUid ? "👑 " : ""}
                {m.nick}
              </span>
              {m.text}
            </p>
          ))
        )}
      </div>
      <form
        className="mt-[0.6cqw] flex gap-[0.6cqw]"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={text}
          maxLength={100}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중 Enter 는 글자 확정용
            if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          placeholder="메시지 입력 · Enter"
          className={`${KR} min-w-0 flex-1 rounded-[0.6cqw] border border-white/12 bg-white/[0.05] px-[0.9cqw] py-[0.45cqw] text-[1.05cqw] text-white outline-none placeholder:text-white/30 focus:border-white/35`}
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className={`${KR} cursor-pointer rounded-[0.6cqw] px-[1.2cqw] text-[1.05cqw] font-bold whitespace-nowrap text-white transition-opacity disabled:cursor-default disabled:opacity-40`}
          style={{ background: color }}
        >
          보내기
        </button>
      </form>
    </div>
  );
}
