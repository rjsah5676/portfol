"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { POINT, POINT_SHORT } from "@/lib/points";

/**
 * 포인트 옆 작은 「?」 — 마우스를 올리거나(PC) 누르면(폰) 포인트가 뭔지 짧게 + 자주 묻는 질문 링크.
 * align: 말풍선을 어느 쪽으로 펼칠지 (화면 가장자리에 있을 때 잘리지 않게)
 */
export default function PointInfo({
  align = "center",
  className = "",
}: {
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", off);
    return () => window.removeEventListener("pointerdown", off);
  }, [open]);
  const pos =
    align === "left"
      ? "left-0"
      : align === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
  return (
    <span
      ref={ref}
      className={`relative inline-flex align-middle ${className}`}
      // 마우스만 올리면 열림 (폰은 누를 때 — 터치의 가짜 mouseenter 로 열렸다 바로 닫히지 않게)
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
    >
      <button
        type="button"
        aria-label={`${POINT.name}란?`}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-white/25 text-[10px] leading-none font-bold text-white/55 transition-colors hover:border-white/50 hover:text-white"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-full z-50 mt-2 w-64 max-w-[80vw] rounded-lg border border-white/12 bg-[#1C1E24] p-3 text-left font-['Nanum_Gothic',sans-serif] text-xs leading-relaxed font-normal break-keep whitespace-normal text-white/75 shadow-xl ${pos}`}
        >
          {POINT_SHORT}
          <Link
            href="/faq/#points"
            className="mt-1.5 block text-[#8B84FF] underline underline-offset-2 hover:text-white"
          >
            {POINT.name} 자세히 보기
          </Link>
        </span>
      )}
    </span>
  );
}
