"use client";

import { useState } from "react";
import { FRIEND_MAX, type FriendEntry } from "@/lib/social";
import { openChat, openUserCard, social, useSocial } from "@/lib/socialStore";
import { Badge, FriendAvatar, KR, ago, btn, presenceLine } from "./parts";

/* 마이페이지 「친구」 탭: 별명으로 추가 · 받은 요청 · 보낸 요청 · 친구 목록 */

export default function FriendsPanel({ card, label }: { card: string; label: string }) {
  const s = useSocial();
  const [nick, setNick] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      if (done) setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({
        ok: false,
        text: (e as Error).message || "잠시 후 다시 해 주세요.",
      });
    } finally {
      setBusy(null);
    }
  };

  const add = () => {
    const n = nick.trim();
    if (!n) return;
    void run("add", async () => {
      const r = await social.request(n);
      setNick("");
      setMsg({
        ok: true,
        text:
          r.status === "friends" ? `${n} 님과 친구가 됐어요` : `${n} 님에게 친구 요청을 보냈어요`,
      });
    });
  };

  if (s.status === "loading" || s.status === "off")
    return <p className="py-10 text-center font-mono text-sm text-white/40">불러오는 중…</p>;
  if (s.status === "error")
    return (
      <p className={`${KR} py-10 text-center text-sm text-white/50`}>
        친구 목록을 불러오지 못했어요. 새로고침해 주세요.
      </p>
    );

  const incoming = s.friends.filter((f) => f.status === "in");
  const outgoing = s.friends.filter((f) => f.status === "out");
  const friends = s.friends.filter((f) => f.status === "friends");

  return (
    <div className={`${KR} flex flex-col gap-4`}>
      <section className={card}>
        <div className={label}>친구 추가</div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            value={nick}
            maxLength={10}
            onChange={(e) => setNick(e.target.value)}
            placeholder="친구의 별명"
            aria-label="친구의 별명"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#6C63FF]/70"
          />
          <button type="submit" disabled={!nick.trim() || busy === "add"} className={btn.primary}>
            {busy === "add" ? "보내는 중…" : "요청 보내기"}
          </button>
        </form>
        {msg && (
          <p className={`mt-2 text-xs break-keep ${msg.ok ? "text-[#C4B5FD]" : "text-red-300"}`}>
            {msg.text}
          </p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed break-keep text-white/35">
          랭킹 · 방명록에서 이름을 눌러도 추가할 수 있어요. 친구는 요청까지 합쳐 {FRIEND_MAX}명까지,
          친구가 되면 플로팅 버튼의 채팅에서 대화하고 접속 중인지 볼 수 있어요.
        </p>
      </section>

      {incoming.length > 0 && (
        <section className={card}>
          <div className={`${label} flex items-center gap-2`}>
            받은 요청 <Badge n={incoming.length} />
          </div>
          <ul className="flex flex-col gap-1">
            {incoming.map((f) => (
              <Line key={f.uid} f={f} sub={`${ago(f.at)} 요청`}>
                <button
                  type="button"
                  disabled={!!busy}
                  className={btn.primary}
                  onClick={() =>
                    run(f.uid, () => social.accept(f.uid), `${f.nick} 님과 친구가 됐어요`)
                  }
                >
                  수락
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  className={btn.ghost}
                  onClick={() => run(f.uid, () => social.remove(f.uid))}
                >
                  거절
                </button>
              </Line>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <div className={label}>
          친구 {friends.length}{" "}
          <span className="text-white/35">· 접속 중 {friends.filter((f) => f.online).length}</span>
        </div>
        {!friends.length ? (
          <p className="py-6 text-center text-sm text-white/40">아직 친구가 없어요</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {friends.map((f) => (
              <Line key={f.uid} f={f} sub={presenceLine(f)} live>
                <button type="button" className={btn.primary} onClick={() => openChat(f.uid)}>
                  메시지{f.unread ? ` ${f.unread}` : ""}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  className={btn.danger}
                  onClick={() => {
                    if (
                      window.confirm(
                        `${f.nick} 님을 친구에서 뺄까요? 서로의 목록에서 사라지고 메시지도 못 주고받아요.`
                      )
                    )
                      void run(f.uid, () => social.remove(f.uid));
                  }}
                >
                  삭제
                </button>
              </Line>
            ))}
          </ul>
        )}
      </section>

      {outgoing.length > 0 && (
        <section className={card}>
          <div className={label}>보낸 요청 (수락을 기다리는 중)</div>
          <ul className="flex flex-col gap-1">
            {outgoing.map((f) => (
              <Line key={f.uid} f={f} sub={`${ago(f.at)} 보냄`}>
                <button
                  type="button"
                  disabled={!!busy}
                  className={btn.ghost}
                  onClick={() => run(f.uid, () => social.remove(f.uid))}
                >
                  취소
                </button>
              </Line>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Line({
  f,
  sub,
  live,
  children,
}: {
  f: FriendEntry;
  sub: string;
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl px-1 py-1.5">
      <button
        type="button"
        onClick={() => openUserCard(f.nick)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
        title="정보 보기"
      >
        <FriendAvatar f={f} dot={!!live} />
        <span className="min-w-0">
          <b className="block truncate text-sm text-white">
            {f.badge && <span className="mr-0.5">{f.badge}</span>}
            {f.nick}
          </b>
          <span
            className={`block truncate text-[11px] ${live && f.online ? "text-[#6EE7B7]" : "text-white/40"}`}
          >
            {sub}
          </span>
        </span>
      </button>
      <span className="flex shrink-0 gap-1.5">{children}</span>
    </li>
  );
}
