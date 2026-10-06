"use client";

import { StoneDot } from "./OmokBoard";
import type { Color } from "@/lib/omok/engine";

/** 좌석 이름: w = 흑(선수), b = 백 */
export const SIDE_KO: Record<Color, string> = { w: "흑", b: "백" };

export const END_REASON: Record<string, string> = {
  five: "오목 완성",
  full: "판이 가득 참",
  timeout: "시간 초과",
  resign: "기권",
  abandon: "상대 이탈",
  agreement: "합의 무승부",
  paused: "2시간 넘게 일시정지",
};

/** 돌 색·이름 한 줄 */
export function SideBar({
  color,
  name,
  active,
  sub,
}: {
  color: Color;
  name: string;
  active: boolean;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="flex rounded-full"
          style={{ boxShadow: active ? "0 0 0 3px #6C63FF88" : undefined }}
        >
          <StoneDot white={color === "b"} size={20} />
        </span>
        <span className="truncate font-['Nanum_Gothic',sans-serif] text-sm text-white/90">
          {name}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-white/40">{SIDE_KO[color]}</span>
      </div>
      {sub}
    </div>
  );
}
