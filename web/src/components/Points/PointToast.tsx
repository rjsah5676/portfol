"use client";

import { useEffect, useState } from "react";
import { POINTS_ATTEND_EVENT } from "@/lib/AuthContext";
import { POINT, fmtPoint } from "@/lib/points";

/** 출석 포인트가 들어오면 화면 아래에 잠깐 (사이트 레이아웃에 한 번만 둠) */
export default function PointToast() {
  const [amount, setAmount] = useState<number | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      setAmount((e as CustomEvent<number>).detail);
      clearTimeout(t);
      t = setTimeout(() => setAmount(null), 4000);
    };
    window.addEventListener(POINTS_ATTEND_EVENT, on);
    return () => {
      clearTimeout(t);
      window.removeEventListener(POINTS_ATTEND_EVENT, on);
    };
  }, []);
  if (amount === null) return null;
  return (
    <div
      role="status"
      className="point-toast fixed bottom-6 left-1/2 z-[100000] w-max max-w-[92vw] -translate-x-1/2 rounded-2xl border border-[#FDE047]/40 bg-[#1C1E24]/95 px-4 py-2 text-center font-['Nanum_Gothic',sans-serif] text-sm break-keep text-white shadow-2xl backdrop-blur"
    >
      <span aria-hidden>🎁</span> 오늘 출석{" "}
      <b className="text-[#FDE68A]">+{fmtPoint(amount)}</b>
      <span className="ml-1.5 inline-block text-xs text-white/45">
        {POINT.name}는 마이페이지에서 볼 수 있어요
      </span>
    </div>
  );
}
