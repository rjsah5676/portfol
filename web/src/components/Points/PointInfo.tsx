"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { POINT, POINT_SHORT } from "@/lib/points";

/** 말풍선 폭 (화면이 좁으면 화면 폭 − 16px) */
const TIP_W = 256;

/**
 * 포인트 옆 작은 「?」 — 마우스를 올리거나(PC) 누르면(폰) 포인트가 뭔지 짧게 + 자주 묻는 질문 링크.
 * 말풍선은 body 에 띄워서(화면 기준 위치) 메뉴 · 모달처럼 넘친 부분을 자르는 곳 안에서도 잘리지 않고,
 * 화면 가장자리에서는 안쪽으로 밀어 넣음. align: 「?」 기준으로 어느 쪽으로 펼칠지 (밀어 넣기 전)
 */
export default function PointInfo({
  align = "center",
  className = "",
}: {
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const closeT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const open = !!pos;

  const show = () => {
    clearTimeout(closeT.current);
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const vw = document.documentElement.clientWidth;
    const width = Math.min(TIP_W, vw - 16);
    const want =
      align === "left"
        ? r.left
        : align === "right"
          ? r.right - width
          : r.left + r.width / 2 - width / 2;
    setPos({
      top: r.bottom + 8,
      left: Math.max(8, Math.min(want, vw - width - 8)),
      width,
    });
  };
  // 「?」에서 말풍선으로 마우스를 옮기는 사이에 닫히지 않게 조금 기다렸다 닫음
  const hideSoon = () => {
    clearTimeout(closeT.current);
    closeT.current = setTimeout(() => setPos(null), 120);
  };

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !tipRef.current?.contains(t))
        setPos(null);
    };
    // 스크롤 · 크기 바뀌면 닫음 (떠 있는 위치가 어긋나지 않게)
    const close = () => setPos(null);
    window.addEventListener("pointerdown", off);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", off);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(closeT.current), []);

  return (
    <span
      ref={ref}
      className={`relative inline-flex align-middle ${className}`}
      // 마우스만 올리면 열림 (폰은 누를 때 — 터치의 가짜 mouseenter 로 열렸다 바로 닫히지 않게)
      onPointerEnter={(e) => e.pointerType === "mouse" && show()}
      onPointerLeave={(e) => e.pointerType === "mouse" && hideSoon()}
    >
      <button
        type="button"
        aria-label={`${POINT.name}란?`}
        aria-describedby={open ? id : undefined}
        onClick={() => (open ? setPos(null) : show())}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-white/25 text-[10px] leading-none font-bold text-white/55 transition-colors hover:border-white/50 hover:text-white"
      >
        ?
      </button>
      {pos &&
        createPortal(
          <span
            ref={tipRef}
            id={id}
            role="tooltip"
            onPointerEnter={() => clearTimeout(closeT.current)}
            onPointerLeave={(e) => e.pointerType === "mouse" && hideSoon()}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-[100001] rounded-lg border border-white/12 bg-[#1C1E24] p-3 text-left font-['Nanum_Gothic',sans-serif] text-xs leading-relaxed font-normal break-keep whitespace-normal text-white/75 shadow-xl"
          >
            {POINT_SHORT}
            <Link
              href="/faq/#points"
              onClick={() => setPos(null)}
              className="mt-1.5 block text-[#8B84FF] underline underline-offset-2 hover:text-white"
            >
              {POINT.name} 자세히 보기
            </Link>
          </span>,
          document.body,
        )}
    </span>
  );
}
