"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lockScroll } from "@/lib/scrollLock";

export type ModalCloseReason = "backdrop" | "escape" | "popstate";

export interface ModalProps {
  open: boolean;
  // reason이 "popstate"면 이미 뒤로가기로 히스토리가 소비된 상태
  onClose: (reason: ModalCloseReason) => void;
  title?: ReactNode;
  children?: ReactNode;
  // 하단 버튼 영역 (없으면 표시 안 함)
  footer?: ReactNode;
  // 배경 클릭으로 닫기 (기본 true)
  closeOnBackdrop?: boolean;
  // 열릴 때 포커스 줄 요소 (없으면 모달 자체)
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  // 패널 폭 (기본 sm). 내용이 길면 패널 안에서 스크롤
  size?: "sm" | "md" | "lg";
  // 오른쪽 위 닫기(×) 버튼
  closeButton?: boolean;
}

const SIZE = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl" } as const;

/**
 * 공통 모달.
 * - ESC / 배경 클릭 / 모바일·브라우저 뒤로가기로 닫힘
 * - 열려 있는 동안 body 스크롤 잠금, 닫히면 이전 포커스 복원
 *
 * 뒤로가기 처리: 열릴 때 같은 URL로 히스토리를 하나 쌓고(pushState), popstate가 오면 닫음.
 * 버튼 등으로 닫을 땐 쌓아둔 히스토리를 history.back()으로 소비해서 뒤로가기 한 번이 낭비되지 않게 함.
 * Next App Router는 window.history.pushState를 패치해서 내부 상태를 같이 복사하므로 라우터와 충돌 없음.
 *
 * 제목 · 닫기(×)는 위에 고정하고 내용만 스크롤. 폰(아래에서 올라오는 시트)에서는 위쪽 손잡이 · 제목을 잡거나,
 * 내용이 맨 위까지 올라간 상태에서 아래로 끌면 시트가 따라 내려오고, 충분히 끌면 닫힘.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  closeOnBackdrop = true,
  initialFocusRef,
  size = "sm",
  closeButton = false,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // createPortal은 document가 필요 -> 마운트 후에만 렌더 (정적 export 빌드 대비)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // 뒤로가기로 닫기
  useEffect(() => {
    if (!open) return;
    let pushed = false;
    let closedByPop = false;

    const onPop = () => {
      closedByPop = true;
      onCloseRef.current("popstate");
    };

    // StrictMode(dev)에서 mount→cleanup→mount가 즉시 일어날 때 push/back이 꼬이지 않게 한 틱 미룸
    const timer = setTimeout(() => {
      window.history.pushState({ ...window.history.state, __modal: true }, "");
      pushed = true;
      window.addEventListener("popstate", onPop);
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      if (pushed && !closedByPop) window.history.back();
    };
  }, [open]);

  // ESC, 스크롤 잠금, 포커스
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const unlock = lockScroll();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current("escape");
    };
    document.addEventListener("keydown", onKey);

    const focusTarget = initialFocusRef?.current ?? panelRef.current;
    focusTarget?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      unlock();
      prevFocus?.focus?.();
    };
  }, [open, initialFocusRef]);

  // 폰: 아래로 끌어서 닫기
  useEffect(() => {
    if (!open || !mounted) return;
    const panel = panelRef.current;
    if (!panel) return;
    let y0 = 0;
    let t0 = 0;
    let dy = 0;
    let state: "idle" | "maybe" | "drag" | "no" = "idle";
    const sheet = () => window.matchMedia("(max-width: 639.98px)").matches;
    const set = (v: number, anim: boolean) => {
      panel.style.transition = anim ? "transform 200ms ease-out" : "none";
      panel.style.transform = v ? `translateY(${v}px)` : "";
    };
    const start = (e: TouchEvent) => {
      if (!sheet() || e.touches.length !== 1) return;
      const fromHead = !!headRef.current?.contains(e.target as Node);
      const atTop = (bodyRef.current?.scrollTop ?? 0) <= 0;
      // 가로로 넘기는 것(카드 넘김 등) · 입력 칸은 건드리지 않음
      if ((e.target as HTMLElement).closest("input,textarea,select,[data-no-sheet-drag]")) return;
      state = fromHead || atTop ? "maybe" : "no";
      y0 = e.touches[0].clientY;
      t0 = performance.now();
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (state === "idle" || state === "no") return;
      const d = e.touches[0].clientY - y0;
      if (state === "maybe") {
        if (d > 6) state = "drag";
        else if (d < -6) {
          state = "no";
          return;
        } else return;
      }
      dy = Math.max(0, d);
      e.preventDefault();
      set(dy, false);
    };
    const end = () => {
      if (state === "drag") {
        const v = dy / Math.max(1, performance.now() - t0);
        if (dy > Math.min(160, panel.offsetHeight * 0.3) || v > 0.6) {
          set(panel.offsetHeight + 40, true);
          setTimeout(() => onCloseRef.current("backdrop"), 180);
        } else set(0, true);
      }
      state = "idle";
    };
    panel.addEventListener("touchstart", start, { passive: true });
    panel.addEventListener("touchmove", move, { passive: false });
    panel.addEventListener("touchend", end);
    panel.addEventListener("touchcancel", end);
    return () => {
      panel.removeEventListener("touchstart", start);
      panel.removeEventListener("touchmove", move);
      panel.removeEventListener("touchend", end);
      panel.removeEventListener("touchcancel", end);
      panel.style.transform = "";
    };
  }, [open, mounted]);

  if (!mounted || !open) return null;

  return createPortal(
    // 모바일(sm 미만)은 아래에서 올라오는 시트: 가로는 화면 꽉 차게, 세로는 최대 92dvh 안에서 스크롤
    <div className="fixed inset-0 z-[100000] flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 touch-none bg-black/60 backdrop-blur-sm [animation:modal-fade_150ms_ease-out]"
        onClick={closeOnBackdrop ? () => onCloseRef.current("backdrop") : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`modal-panel relative flex max-h-[92dvh] w-full ${SIZE[size]} flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#1C1E24] break-words shadow-2xl outline-none sm:max-h-[88dvh] sm:rounded-2xl`}
      >
        {/* 위: 손잡이(폰) · 제목 · 닫기 — 스크롤해도 그대로 */}
        <div ref={headRef} className="relative shrink-0 touch-none px-4 pt-2.5 sm:px-7 sm:pt-6">
          <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden />
          {closeButton && (
            <button
              type="button"
              aria-label="닫기"
              onClick={() => onCloseRef.current("backdrop")}
              className="absolute top-3 right-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-xl text-white/45 transition-colors hover:bg-white/10 hover:text-white sm:top-4 sm:right-4"
            >
              ×
            </button>
          )}
          {title ? (
            <h2
              id={titleId}
              className={`pb-3 font-mono text-base font-medium text-white ${closeButton ? "pr-10" : ""}`}
            >
              {title}
            </h2>
          ) : (
            closeButton && <div className="h-6" />
          )}
        </div>
        <div
          ref={bodyRef}
          className="thin-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-7 sm:pb-7"
        >
          {children && (
            <div className="font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed break-keep text-white/70">
              {children}
            </div>
          )}
          {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}
