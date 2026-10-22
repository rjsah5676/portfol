"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Modal from "@/components/Modal/Modal";
import { useAuth } from "@/lib/AuthContext";
import { DM_MAX_LEN, type DmMsg, type FriendEntry } from "@/lib/social";
import { closeChat, openChat, openUserCard, social, useSocial } from "@/lib/socialStore";
import { Badge, FriendAvatar, KR, ago, btn, presenceLine } from "./parts";

/*
 * 메신저 (플로팅 버튼 「채팅」): 친구 목록 → 누르면 대화. 폰에서도 한 칸으로 (목록 ↔ 대화).
 * 친구 추가 · 요청 수락은 마이페이지 「친구」 탭 (여기선 받은 요청이 있으면 알려 줌).
 */

export default function Messenger() {
  const s = useSocial();
  const { open, with: uid } = s.ui.chat;
  const f = uid ? s.friends.find((x) => x.uid === uid && x.status === "friends") : undefined;
  return (
    <Modal
      open={open}
      onClose={closeChat}
      size="md"
      closeButton
      title={
        f ? (
          <button
            type="button"
            onClick={() => openChat(null)}
            className={`${KR} flex cursor-pointer items-center gap-2 text-left`}
          >
            <span aria-hidden className="text-white/50">
              ‹
            </span>
            <FriendAvatar f={f} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-white">{f.nick}</span>
              <span
                className={`block truncate text-[11px] font-normal ${f.online ? "text-[#6EE7B7]" : "text-white/40"}`}
              >
                {presenceLine(f)}
              </span>
            </span>
          </button>
        ) : (
          "채팅"
        )
      }
    >
      {open && (f ? <Conversation key={f.uid} f={f} /> : <FriendList />)}
    </Modal>
  );
}

function FriendList() {
  const s = useSocial();
  const { profile, account, login } = useAuth();
  if (!profile)
    return (
      <div className={`${KR} flex flex-col items-center gap-3 py-8 text-center`}>
        <p className="text-sm break-keep text-white/60">
          로그인하고 별명을 정하면 친구와 대화할 수 있어요
        </p>
        {!account ? (
          <button type="button" className={btn.ghost} onClick={() => void login().catch(() => {})}>
            Google로 로그인
          </button>
        ) : (
          <Link href="/me/" onClick={closeChat} className={btn.ghost}>
            별명 정하러 가기
          </Link>
        )}
      </div>
    );
  if (s.status === "loading" || s.status === "off")
    return <p className="py-8 text-center font-mono text-xs text-white/35">불러오는 중…</p>;
  if (s.status === "error")
    return (
      <p className={`${KR} py-8 text-center text-sm text-white/50`}>
        친구 목록을 불러오지 못했어요. 새로고침해 주세요.
      </p>
    );
  const list = s.friends.filter((x) => x.status === "friends");
  const onlineN = list.filter((x) => x.online).length;
  return (
    <div className={KR}>
      {s.incoming > 0 && (
        <Link
          href="/me/?tab=friends"
          onClick={closeChat}
          className="mb-3 flex items-center justify-between rounded-xl border border-[#6C63FF]/40 bg-[#6C63FF]/10 px-3 py-2 text-xs text-white/85 hover:bg-[#6C63FF]/20"
        >
          받은 친구 요청 {s.incoming}개 <span className="text-[#C4B5FD]">확인하기 ›</span>
        </Link>
      )}
      {!list.length ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm leading-relaxed break-keep text-white/55">
            아직 친구가 없어요.
            <br />
            랭킹 · 방명록에서 이름을 누르거나 마이페이지에서 별명으로 추가해 보세요.
          </p>
          <Link href="/me/?tab=friends" onClick={closeChat} className={btn.primary}>
            친구 추가하기
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-1.5 px-1 font-mono text-[11px] text-white/35">
            친구 {list.length} · 접속 중 {onlineN}
          </div>
          <ul className="flex flex-col">
            {list.map((x) => (
              <li key={x.uid}>
                <button
                  type="button"
                  onClick={() => openChat(x.uid)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/[0.05]"
                >
                  <FriendAvatar f={x} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <b className="truncate text-sm text-white">
                        {x.badge && <span className="mr-0.5">{x.badge}</span>}
                        {x.nick}
                      </b>
                      <span
                        className={`shrink-0 text-[10.5px] ${x.online ? "text-[#6EE7B7]" : "text-white/30"}`}
                      >
                        {presenceLine(x)}
                      </span>
                    </span>
                    <span
                      className={`block truncate text-xs ${x.unread ? "text-white/80" : "text-white/40"}`}
                    >
                      {x.last
                        ? `${x.last.mine ? "나: " : ""}${x.last.text}`
                        : "대화를 시작해 보세요"}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {x.last && (
                      <span className="font-mono text-[10px] text-white/30">{ago(x.last.at)}</span>
                    )}
                    <Badge n={x.unread} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const dayKey = (t: number) => new Date(t).toDateString();
const time = (t: number) =>
  new Date(t).toLocaleTimeString("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
  });

function Conversation({ f }: { f: FriendEntry }) {
  const s = useSocial();
  const c = s.convos[f.uid];
  const me = s.me;
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevH = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void social.openConvo(f.uid).catch((e: Error) => setErr(e.message));
    inputRef.current?.focus();
  }, [f.uid]);
  // 탭으로 돌아오면 읽음
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && f.unread) void social.markRead(f.uid);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [f.uid, f.unread]);

  const msgs = c?.msgs ?? [];
  const lastId = msgs[msgs.length - 1]?.id;
  // 새 메시지: 아래에 있었으면 따라 내려감 / 위로 더 불러왔으면 보던 자리 그대로
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else if (prevH.current && el.scrollHeight > prevH.current && el.scrollTop < 40)
      el.scrollTop += el.scrollHeight - prevH.current;
    prevH.current = el.scrollHeight;
  }, [lastId, msgs.length]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 40 && c?.more && !c.loading) {
      prevH.current = el.scrollHeight;
      void social.loadMore(f.uid);
    }
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setErr(null);
    try {
      atBottom.current = true;
      await social.send(f.uid, t);
      setText("");
    } catch (e) {
      setErr((e as Error).message || "보내지 못했어요.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // 내가 보낸 마지막 메시지 중 상대가 읽은 것
  const lastMine = [...msgs].reverse().find((m) => m.from === me);
  const seenMine = lastMine && f.readAt >= lastMine.at ? lastMine.id : null;

  return (
    <div className={`${KR} flex h-[min(60vh,520px)] flex-col`}>
      <div
        ref={boxRef}
        onScroll={onScroll}
        className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1"
      >
        {c?.loading && (
          <p className="py-2 text-center font-mono text-[10px] text-white/30">불러오는 중…</p>
        )}
        {c?.loaded && !c.more && msgs.length > 0 && (
          <p className="py-2 text-center text-[10.5px] text-white/25">대화의 처음이에요</p>
        )}
        {c?.loaded && !msgs.length && (
          <p className="py-10 text-center text-sm break-keep text-white/40">
            {f.nick} 님에게 첫 메시지를 보내 보세요
          </p>
        )}
        {msgs.map((m, i) => (
          <Bubble
            key={m.id}
            m={m}
            mine={m.from === me}
            prev={msgs[i - 1]}
            seen={m.id === seenMine}
          />
        ))}
      </div>
      {err && <p className="pt-1 text-xs text-red-300">{err}</p>}
      <div className="mt-2 flex items-end gap-2 border-t border-white/8 pt-2">
        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          maxLength={DM_MAX_LEN}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="메시지 (Enter 보내기 · Shift+Enter 줄바꿈)"
          aria-label={`${f.nick} 님에게 보낼 메시지`}
          className="max-h-28 min-h-[2.4rem] flex-1 resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#6C63FF]/70"
        />
        <button
          type="button"
          disabled={!text.trim() || sending}
          onClick={() => void send()}
          className={`${btn.primary} h-[2.4rem]`}
        >
          보내기
        </button>
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] text-white/30">
        <button
          type="button"
          onClick={() => openUserCard(f.nick)}
          className="cursor-pointer hover:text-white/60"
        >
          정보 보기
        </button>
        {text.length > DM_MAX_LEN * 0.8 && (
          <span className="font-mono">
            {text.length}/{DM_MAX_LEN}
          </span>
        )}
      </div>
    </div>
  );
}

function Bubble({ m, mine, prev, seen }: { m: DmMsg; mine: boolean; prev?: DmMsg; seen: boolean }) {
  const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
  const grouped = !newDay && prev && prev.from === m.from && m.at - prev.at < 3 * 60_000;
  return (
    <>
      {newDay && (
        <div className="my-3 text-center text-[10.5px] text-white/30">
          {new Date(m.at).toLocaleDateString("ko-KR", {
            month: "long",
            day: "numeric",
            weekday: "short",
          })}
        </div>
      )}
      <div
        className={`flex items-end gap-1.5 ${mine ? "flex-row-reverse" : ""} ${grouped ? "mt-0.5" : "mt-2"}`}
      >
        <div
          className={`max-w-[78%] rounded-2xl px-3 py-1.5 text-sm leading-relaxed break-words whitespace-pre-wrap ${
            mine
              ? "rounded-br-md bg-[#6C63FF] text-white"
              : "rounded-bl-md bg-white/[0.08] text-white/90"
          }`}
        >
          {m.text}
        </div>
        <span className="shrink-0 pb-0.5 font-mono text-[9.5px] text-white/30">
          {seen && <span className="mr-1 text-[#C4B5FD]">읽음</span>}
          {time(m.at)}
        </span>
      </div>
    </>
  );
}
