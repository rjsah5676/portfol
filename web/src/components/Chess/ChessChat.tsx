"use client";

import { useEffect, useRef, useState } from "react";
import {
  CHAT_MAX,
  sendChat as chessSend,
  subscribeChat as chessSubscribe,
  type BoardRoom,
  type ChatMessage,
} from "@/firestore/chessGame";

/** 다른 대국 게임(장기)에서도 쓰도록 채팅 함수와 좌석 표시를 바꿔 끼울 수 있음 */
export interface ChatApi {
  subscribeChat: (roomId: string, cb: (list: ChatMessage[]) => void) => () => void;
  sendChat: (roomId: string, uid: string, name: string, text: string) => Promise<void>;
}
const CHESS_MARKS = { white: ["♔ ", "백"], black: ["♚ ", "흑"] } as const;

const fmtTime = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** 방 채팅: 대국자·관전자만 입력 가능, 나머지는 읽기만 */
export default function ChessChat({
  room,
  uid,
  nick,
  canSend,
  api = { subscribeChat: chessSubscribe, sendChat: chessSend },
  marks = CHESS_MARKS,
}: {
  room: BoardRoom;
  uid: string;
  nick: string;
  canSend: boolean;
  api?: ChatApi;
  /** 좌석별 [이름 앞 표시, 툴팁] */
  marks?: { white: readonly [string, string]; black: readonly [string, string] };
}) {
  const { subscribeChat, sendChat } = api;
  const [list, setList] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // 맨 아래를 보고 있을 때만 새 메시지에 자동 스크롤
  const lastSent = useRef(0);

  useEffect(() => subscribeChat(room.id, setList), [room.id, subscribeChat]);

  useEffect(() => {
    const el = boxRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [list]);

  const roleOf = (u: string) =>
    u === room.whiteUid ? "white" : u === room.blackUid ? "black" : "spectator";

  const send = async () => {
    const t = text.trim();
    if (!t || !canSend) return;
    // 도배 방지: 0.7초에 한 번
    if (Date.now() - lastSent.current < 700) return;
    lastSent.current = Date.now();
    setText("");
    setErr("");
    stick.current = true;
    try {
      await sendChat(room.id, uid, nick, t);
    } catch (e) {
      console.error(e);
      setErr("메시지를 보내지 못했습니다.");
      setText(t);
    }
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1C1E24]">
      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="thin-scroll h-48 overflow-y-auto px-3 py-2 lg:h-56"
      >
        {list.length === 0 ? (
          <p className="pt-16 text-center font-mono text-xs text-white/25 lg:pt-20">
            채팅이 없습니다
          </p>
        ) : (
          <ul className="space-y-1">
            {list.map((m) => {
              const role = roleOf(m.uid);
              const mine = m.uid === uid;
              return (
                <li
                  key={m.id}
                  className={`text-[13px] leading-snug break-words ${m.pending ? "opacity-60" : ""}`}
                >
                  <span
                    className={`mr-1.5 font-['Nanum_Gothic',sans-serif] font-bold ${
                      mine
                        ? "text-[#A9A3FF]"
                        : role === "spectator"
                          ? "text-white/45"
                          : "text-white/85"
                    }`}
                    title={role === "spectator" ? "관전" : marks[role][1]}
                  >
                    {role === "spectator" ? "" : marks[role][0]}
                    {m.name}
                  </span>
                  <span className="font-['Nanum_Gothic',sans-serif] text-white/80">{m.text}</span>
                  <span className="ml-1.5 font-mono text-[10px] text-white/25">
                    {fmtTime(m.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <form
        className="flex gap-1.5 border-t border-white/5 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, CHAT_MAX))}
          disabled={!canSend}
          maxLength={CHAT_MAX}
          placeholder={canSend ? "메시지 입력" : "대국자·관전자만 채팅할 수 있어요"}
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#15171c] px-3 py-1.5 font-['Nanum_Gothic',sans-serif] text-sm text-white placeholder:text-white/25 focus:border-[#6C63FF]/50 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!canSend || !text.trim()}
          className="shrink-0 cursor-pointer rounded-full bg-[#6C63FF] px-3.5 py-1.5 font-mono text-xs text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-not-allowed disabled:opacity-40"
        >
          전송
        </button>
      </form>
      {err && <p className="px-3 pb-2 font-mono text-[11px] text-red-300/80">{err}</p>}
    </div>
  );
}
