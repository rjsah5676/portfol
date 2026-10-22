"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/lib/AuthContext";
import {
  friendByNick,
  openChat,
  openReport,
  openUserCard,
  social,
  useSocial,
} from "@/lib/socialStore";
import { KR } from "./parts";

/*
 * 회원 이름을 누르면 뜨는 작은 메뉴: 정보 보기 · 친구 추가(수락 · 메시지) · 신고하기.
 * Nick 에 menu 를 주면 이걸로 감쌈 (랭킹 · 방명록 등 게임 밖 화면). 게임 화면 안에서는 안 씀.
 */

type Item = {
  label: string;
  onClick?: () => void | Promise<unknown>;
  disabled?: boolean;
  tone?: "danger";
  hint?: string;
};

export default function UserName({
  nick,
  children,
  className = "",
}: {
  nick: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { profile, account, login } = useAuth();
  const s = useSocial();
  const self = !!profile && profile.nick.toLowerCase() === nick.toLowerCase();
  const f = s.status === "ready" ? friendByNick(nick) : undefined;

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + 200 > window.innerHeight && r.top > 220;
    setPos({
      x: Math.min(Math.max(8, r.left), window.innerWidth - 200),
      y: up ? r.top - 6 : r.bottom + 6,
      up,
    });
  };
  useLayoutEffect(() => {
    if (open) place();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const gone = () => setOpen(false);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", gone, true);
    window.addEventListener("resize", gone);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", gone, true);
      window.removeEventListener("resize", gone);
    };
  }, [open]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      setTimeout(() => setOpen(false), 900);
    } catch (e) {
      setMsg((e as Error).message || "잠시 후 다시 해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const go = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const needLogin: Item = account
    ? {
        label: "친구 추가",
        disabled: true,
        hint: "별명을 정한 회원만 쓸 수 있어요",
      }
    : {
        label: "로그인하고 친구 추가",
        onClick: () => void login().catch(() => {}),
      };

  const items: Item[] = [{ label: "정보 보기", onClick: go(() => openUserCard(nick)) }];
  if (!self) {
    if (!profile) items.push(needLogin);
    else if (f?.status === "friends")
      items.push({
        label: "메시지 보내기",
        onClick: go(() => openChat(f.uid)),
      });
    else if (f?.status === "in")
      items.push({
        label: "친구 요청 수락",
        onClick: () => run(() => social.accept(f.uid), "이제 친구예요"),
      });
    else if (f?.status === "out")
      items.push({
        label: "친구 요청 보냄",
        disabled: true,
        hint: "상대가 수락하면 친구가 돼요",
      });
    else
      items.push({
        label: "친구 추가",
        disabled: s.status !== "ready",
        onClick: () => run(() => social.request(nick), "친구 요청을 보냈어요"),
      });
    items.push(
      profile
        ? {
            label: "신고하기",
            tone: "danger",
            onClick: go(() => openReport(nick)),
          }
        : {
            label: "신고하기",
            tone: "danger",
            disabled: true,
            hint: "회원만 신고할 수 있어요",
          }
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setMsg(null);
          setOpen((v) => !v);
        }}
        className={`cursor-pointer text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none ${className}`}
      >
        {children}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              left: pos.x,
              top: pos.y,
              transform: pos.up ? "translateY(-100%)" : undefined,
            }}
            className={`${KR} fixed z-[100001] w-48 overflow-hidden rounded-xl border border-white/12 bg-[#23252d] py-1 text-left shadow-[0_12px_32px_rgba(0,0,0,0.45)]`}
          >
            <div className="truncate border-b border-white/8 px-3 pt-1.5 pb-2 text-xs font-bold text-white/85">
              {nick}
            </div>
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled || busy}
                onClick={() => void it.onClick?.()}
                className={`block w-full cursor-pointer px-3 py-2 text-left text-[13px] transition-colors disabled:cursor-default ${
                  it.disabled
                    ? "text-white/35"
                    : it.tone === "danger"
                      ? "text-red-300/90 hover:bg-red-400/10"
                      : "text-white/85 hover:bg-white/[0.07]"
                }`}
              >
                {it.label}
                {it.hint && (
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-white/30">
                    {it.hint}
                  </span>
                )}
              </button>
            ))}
            {msg && (
              <p className="border-t border-white/8 px-3 py-2 text-[11.5px] leading-snug break-keep text-[#C4B5FD]">
                {msg}
              </p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
