"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/*
 * 로비의 창(바텀시트).
 *   폰(세로판): 아래에서 올라오는 시트. 위에 손잡이 + 오른쪽 위 X, 아래로 끌어내리면 닫힘
 *              (내용이 맨 위까지 스크롤돼 있을 때는 내용을 끌어도 내려감), 바깥을 눌러도 닫힘.
 *   PC(가로판): 가운데 뜨는 창. X · 바깥 클릭 · Esc 로 닫힘.
 *   둘 다: 안드로이드 뒤로가기(브라우저 뒤로)도 창만 닫음.
 * 아래쪽 버튼은 "주요 행동"(확인 · 캐릭터 변경 …)만 두고, 단순 닫기는 위의 X 가 맡음.
 * 스크롤되는 내용에는 data-sheet-scroll 을 달아 둘 것 (끌어내리기 판단에 씀).
 */

const CLOSE_PX = 90; // 이만큼 끌어내리면 닫힘
const CLOSE_V = 0.6; // 또는 이 속도(px/ms) 이상으로 휙 내리면

export default function Sheet({
  mobile,
  maxH,
  title,
  wide,
  fill,
  onClose,
  children,
}: {
  mobile: boolean;
  maxH: number;
  title?: ReactNode;
  /** PC 창 최대 폭 (px) */
  wide?: number;
  /** 내용과 상관없이 maxH 높이로 고정 (탭을 바꿀 때 창 높이가 출렁이지 않게) */
  fill?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [dy, setDy] = useState(0);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const pushed = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /** 닫기: 내려가는 연출 뒤 onClose. 뒤로가기 기록을 넣어 뒀으면 같이 걷어 냄 */
  const close = useCallback((fromPop = false) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    if (pushed.current && !fromPop) {
      pushed.current = false;
      try {
        history.back();
      } catch {}
    }
    pushed.current = false;
    setTimeout(() => onCloseRef.current(), 180);
  }, []);

  // 뒤로가기 = 창 닫기 (주소는 그대로, 기록만 하나 얹음)
  useEffect(() => {
    try {
      history.pushState({ pkSheet: true }, "");
      pushed.current = true;
    } catch {}
    const onPop = () => close(true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  // 끌어내리기 (터치). 내용이 스크롤 중이면 스크롤에 양보
  useEffect(() => {
    const el = panel.current;
    if (!el || !mobile) return;
    let y0 = 0;
    let x0 = 0;
    let t0 = 0;
    let state: "" | "maybe" | "drag" | "no" = "";
    let cur = 0;
    const scroller = (t: EventTarget | null) =>
      (t instanceof Element ? t.closest("[data-sheet-scroll]") : null) as HTMLElement | null;
    let sc: HTMLElement | null = null;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || closingRef.current) return;
      y0 = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
      t0 = performance.now();
      sc = scroller(e.target);
      state = "maybe";
      cur = 0;
    };
    const move = (e: TouchEvent) => {
      if (state === "" || state === "no") return;
      const d = e.touches[0].clientY - y0;
      const dx = e.touches[0].clientX - x0;
      if (state === "maybe") {
        if (Math.abs(d) < 6 && Math.abs(dx) < 6) return;
        // 아래로 + 세로 방향 + (스크롤 영역이 아니거나 맨 위) → 시트를 끔
        if (d > 0 && Math.abs(d) > Math.abs(dx) && (!sc || sc.scrollTop <= 0)) state = "drag";
        else {
          state = "no";
          return;
        }
      }
      e.preventDefault();
      cur = Math.max(0, d);
      setDy(cur);
    };
    const end = () => {
      if (state === "drag") {
        const v = cur / Math.max(1, performance.now() - t0);
        if (cur > CLOSE_PX || v > CLOSE_V) close();
        else setDy(0);
      }
      state = "";
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [mobile, close]);

  const dragging = dy > 0 && !closing;
  return (
    <div
      className={`pk-sheet-back absolute inset-0 z-[70] flex justify-center ${mobile ? "items-end" : "items-center"}`}
      data-closing={closing ? "1" : undefined}
      style={{ background: `rgba(0,0,0,${0.65 * (1 - Math.min(1, dy / 400))})` }}
      onClick={() => close()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        className={`pk-frame relative flex w-full flex-col overflow-hidden ${mobile ? "pk-sheet-up rounded-b-none" : "pk-pop"}`}
        data-closing={closing ? "1" : undefined}
        style={{
          maxHeight: maxH,
          height: fill ? maxH : undefined,
          maxWidth: mobile ? undefined : (wide ?? 640),
          transform:
            closing && mobile ? "translateY(105%)" : dy ? `translateY(${dy}px)` : undefined,
          transition: dragging ? "none" : "transform 0.18s ease-out, opacity 0.18s",
          opacity: closing && !mobile ? 0 : 1,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {mobile && (
          <div className="flex shrink-0 justify-center pt-[6px] pb-[2px]" aria-hidden>
            <span className="h-[5px] w-[42px] rounded-full bg-white/30" />
          </div>
        )}
        {title && (
          <div className="flex shrink-0 items-center px-[0.9em] pt-[0.5em] pr-[3em] pb-[0.2em]">
            <div className="pk-frame-title">{title}</div>
          </div>
        )}
        <button
          type="button"
          onClick={() => close()}
          aria-label="닫기"
          title="닫기"
          className="pk-sheet-x absolute top-[8px] right-[8px] z-20"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path
              d="M3.5 3.5l9 9m0-9l-9 9"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}
