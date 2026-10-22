"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal/Modal";
import { useModal } from "@/components/Modal/ModalProvider";
import { useAuth } from "@/lib/AuthContext";
import Avatar from "./Avatar";
import NickForm from "./NickForm";
import PointInfo from "@/components/Points/PointInfo";
import { POINT, fmtPoint } from "@/lib/points";
import { openChat, useSocial } from "@/lib/socialStore";

/*
 * 상단 오른쪽: login 글자 → (로그인 후) 관리자 링크 · 내 별명.
 * 사진·별명을 누르면 내 정보(/me). 마우스를 올리면(터치 기기는 옆의 ▾ 를 누르면) 아래로 작은 메뉴: 로그아웃 · GP · 친구 · 메시지 · 방문·게임 수.
 * 안 읽은 메시지나 받은 친구 요청이 있으면 사진에 점.
 * Google 로 처음 로그인하면 별명을 정하는 창이 뜸 (닫아도 "별명 정하기"로 다시 열 수 있음).
 */

const KR = "font-['Nanum_Gothic',sans-serif]";
const hoverable = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** 가입한 날부터 오늘까지 며칠째인지 (가입한 날 = 1일째) */
const daysSince = (ms: number) => Math.max(1, Math.floor((Date.now() - ms) / 86_400_000) + 1);

export default function AccountMenu() {
  const { loading, account, profile, admin, login, logout, refresh, points } = useAuth();
  const social = useSocial();
  const friendCount = social.friends.filter((f) => f.status === "friends").length;
  const onlineCount = social.friends.filter((f) => f.status === "friends" && f.online).length;
  const modal = useModal();
  const pathname = usePathname();
  const path = pathname.replace(/\/+$/, "") || "/";
  const [nickOpen, setNickOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshedAt = useRef(0);

  // 로그인했는데 별명이 없으면 한 번 물어봄 (계정이 바뀌면 다시)
  const needsNick = !loading && !!account && !profile;
  const askedFor = useRef("");
  useEffect(() => {
    if (!needsNick || !account || askedFor.current === account.uid) return;
    askedFor.current = account.uid;
    setNickOpen(true);
  }, [needsNick, account]);

  // 페이지가 바뀌면 메뉴 닫기
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 경로 변경 시 메뉴 닫기
    setOpen(false);
  }, [path]);

  // 열려 있는 동안: 바깥을 누르거나 Esc 로 닫기, 숫자(방문·게임 수)는 열 때 새로 받아옴
  useEffect(() => {
    if (!open) return;
    if (Date.now() - refreshedAt.current > 30_000) {
      refreshedAt.current = Date.now();
      refresh();
    }
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, refresh]);

  const clearHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  const onLogin = async () => {
    if (busy) return;
    setBusy(true);
    // 로그인 창을 그냥 닫으면 Firebase 가 알아채는 데 몇 초 걸림 → 이 창으로 돌아오면 바로 글자를 되돌림
    const back = () => setTimeout(() => setBusy(false), 400);
    window.addEventListener("focus", back, { once: true });
    try {
      await login();
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "";
      await modal.alert({
        title: "로그인하지 못했어요",
        message:
          code === "auth/popup-blocked"
            ? "브라우저가 로그인 창을 막았어요. 팝업을 허용한 뒤 다시 눌러주세요."
            : "잠시 후 다시 시도해주세요.",
      });
    } finally {
      window.removeEventListener("focus", back);
      setBusy(false);
    }
  };

  const text = (active = false) =>
    `cursor-pointer transition-colors ${active ? "text-[#8B84FF]" : "text-white/60 hover:text-white"}`;

  return (
    <div className="flex items-center gap-4 font-mono text-xs sm:gap-5 sm:text-sm">
      {loading ? (
        // 확인하는 동안 자리만 잡아 둠 (글자가 깜빡이지 않게)
        <span className="h-7 w-10" aria-hidden="true" />
      ) : !account ? (
        <button type="button" onClick={onLogin} disabled={busy} className={text()}>
          {busy ? "…" : "login"}
        </button>
      ) : (
        <>
          {admin && (
            <Link href="/admin" className={text(path.startsWith("/admin"))}>
              admin
            </Link>
          )}
          {profile ? (
            <div
              ref={wrapRef}
              className="relative"
              onMouseEnter={() => {
                if (!hoverable()) return;
                clearHover();
                hoverTimer.current = setTimeout(() => setOpen(true), 100);
              }}
              onMouseLeave={() => {
                if (!hoverable()) return;
                clearHover();
                hoverTimer.current = setTimeout(() => setOpen(false), 200);
              }}
            >
              <div className="flex items-center">
                <Link
                  href="/me"
                  title="내 정보"
                  className={`flex items-center gap-2 py-1 transition-colors ${
                    open || path === "/me" ? "text-white" : "text-white/75 hover:text-white"
                  }`}
                >
                  <span className="relative">
                    <Avatar profile={profile} photo={account.photoURL} size="sm" />
                    {social.badge > 0 && (
                      <span
                        aria-label={`새 소식 ${social.badge}개`}
                        className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#F43F5E] ring-2 ring-[#121212]"
                      />
                    )}
                  </span>
                  <span className={`max-w-[6.5rem] truncate ${KR}`}>
                    {profile.badge && <span className="mr-1">{profile.badge}</span>}
                    {profile.nick}
                  </span>
                </Link>
                <button
                  type="button"
                  aria-label="계정 메뉴"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  // 마우스는 올리면 열리므로 누를 때는 열어 두기만, 터치 기기는 누를 때마다 열고 닫음
                  onClick={() => setOpen((o) => (hoverable() ? true : !o))}
                  className="cursor-pointer py-2 pr-1 pl-1.5 text-white/35 transition-colors hover:text-white"
                >
                  <svg
                    viewBox="0 0 12 12"
                    className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M2.5 4.5L6 8L9.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {open && (
                // pt-2: 버튼과 메뉴 사이로 마우스가 지나가도 안 닫히게 빈틈 없이 붙임
                <div className="absolute top-full right-0 z-50 pt-2">
                  <div
                    role="menu"
                    className="w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#17181D] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] [animation:modal-pop_140ms_ease-out]"
                  >
                    <div className="flex items-start gap-3 px-4 pt-4 pb-3.5">
                      {/* 사진·이름을 누르면 내 정보로 */}
                      <Link
                        href="/me"
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className="group flex min-w-0 flex-1 items-center gap-3"
                      >
                        <Avatar profile={profile} photo={account.photoURL} size="lg" />
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-[15px] font-bold text-white underline-offset-4 group-hover:underline ${KR}`}
                          >
                            {profile.badge && <span className="mr-1">{profile.badge}</span>}
                            {profile.nick}
                          </span>
                          {account.email && (
                            <span className="block truncate text-[11px] text-white/35">
                              {account.email}
                            </span>
                          )}
                        </span>
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpen(false);
                          logout();
                        }}
                        className={`shrink-0 cursor-pointer rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/55 transition-colors hover:border-white/30 hover:text-white ${KR}`}
                      >
                        로그아웃
                      </button>
                    </div>

                    {/* 보유 GP (누르면 마이페이지의 GP 칸) */}
                    <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-2.5">
                      <span className={`flex items-center gap-1.5 text-xs text-white/55 ${KR}`}>
                        보유 {POINT.name} <PointInfo align="left" />
                      </span>
                      <Link
                        href="/me#points"
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className="font-mono text-sm font-bold text-[#FDE68A] tabular-nums hover:underline"
                      >
                        {fmtPoint(points ?? 0)}
                      </Link>
                    </div>

                    {/* 친구 · 메시지 (친구 탭 / 메신저 창) */}
                    <div className="flex items-center gap-2 border-t border-white/[0.07] px-4 py-2.5">
                      <Link
                        href="/me/?tab=friends"
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className={`flex min-w-0 flex-1 items-center gap-1.5 text-xs text-white/70 transition-colors hover:text-white ${KR}`}
                      >
                        <span>친구</span>
                        {friendCount > 0 ? (
                          <span className="truncate text-white/40">
                            {friendCount}명
                            {onlineCount > 0 && (
                              <span className="text-[#6EE7B7]"> · {onlineCount}명 접속 중</span>
                            )}
                          </span>
                        ) : (
                          !social.incoming && <span className="text-white/40">추가하기</span>
                        )}
                        {social.incoming > 0 && (
                          <span className="shrink-0 rounded-full bg-[#F43F5E]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#FDA4AF]">
                            요청 {social.incoming}
                          </span>
                        )}
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpen(false);
                          openChat();
                        }}
                        className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:border-white/30 hover:text-white ${KR}`}
                      >
                        메시지
                        {social.unread > 0 && (
                          <span className="rounded-full bg-[#F43F5E] px-1.5 font-mono text-[10px] leading-4 font-bold text-white">
                            {social.unread > 99 ? "99+" : social.unread}
                          </span>
                        )}
                      </button>
                    </div>

                    <dl className="grid grid-cols-3 border-t border-white/[0.07] py-3 text-center">
                      {[
                        ["방문", `${profile.visits.toLocaleString()}회`],
                        ["게임", `${profile.plays.toLocaleString()}판`],
                        ["가입", `${daysSince(profile.createdAt).toLocaleString()}일째`],
                      ].map(([label, value], i) => (
                        <div key={label} className={i > 0 ? "border-l border-white/[0.07]" : ""}>
                          <dd className={`text-sm text-white ${KR}`}>{value}</dd>
                          <dt className={`mt-0.5 text-[11px] text-white/35 ${KR}`}>{label}</dt>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setNickOpen(true)}
                className={`cursor-pointer text-[#A9A3FF] transition-colors hover:text-white ${KR}`}
              >
                별명 정하기
              </button>
              <button type="button" onClick={logout} className={text()}>
                logout
              </button>
            </>
          )}
        </>
      )}

      <Modal
        open={nickOpen && needsNick}
        onClose={() => setNickOpen(false)}
        title="별명 정하기"
        initialFocusRef={inputRef}
      >
        <p className={`mb-4 text-sm leading-relaxed text-white/60 ${KR}`}>
          랭킹·방명록·게임에서 이 별명으로 보여요. 나중에 내 정보에서 바꿀 수 있어요.
        </p>
        <NickForm submitLabel="시작하기" inputRef={inputRef} onDone={() => setNickOpen(false)} />
      </Modal>
    </div>
  );
}
