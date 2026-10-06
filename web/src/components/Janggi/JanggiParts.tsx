"use client";

import { PieceGlyph, SIDE_COLOR } from "./JanggiBoard";
import type { Color } from "@/lib/janggi/engine";

export const SIDE_KO: Record<Color, string> = { w: "초", b: "한" };

export const END_REASON: Record<string, string> = {
  checkmate: "외통",
  bikjang: "빅장 · 점수 판정",
  passes: "양쪽 한수쉼 · 점수 판정",
  maxplies: "200수 · 점수 판정",
  timeout: "시간 초과",
  resign: "기권",
  abandon: "상대 이탈",
  agreement: "합의 무승부",
  paused: "2시간 넘게 일시정지",
};

export function fmtScore(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 진영 이름·잡은 기물·점수 한 줄 */
export function SideBar({
  color,
  name,
  captured,
  score,
  active,
  right,
  hangul,
}: {
  color: Color;
  name: string;
  /** 이 진영이 잡은 상대 기물 */
  captured: number[];
  score: number;
  active: boolean;
  right?: React.ReactNode;
  hangul?: boolean;
}) {
  const opp: Color = color === "w" ? "b" : "w";
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-['Nanum_Gothic',sans-serif] text-[11px] font-bold text-white"
            style={{
              background: SIDE_COLOR[color],
              boxShadow: active ? `0 0 0 3px ${SIDE_COLOR[color]}55` : undefined,
            }}
          >
            {SIDE_KO[color]}
          </span>
          <span className="truncate font-['Nanum_Gothic',sans-serif] text-sm text-white/90">
            {name}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-white/40">{fmtScore(score)}점</span>
        </div>
        <div className="flex min-h-[20px] flex-wrap items-center gap-0.5 pl-7">
          {captured.map((t, i) => (
            <PieceGlyph key={i} type={t} color={opp} size={20} hangul={hangul} />
          ))}
        </div>
      </div>
      {right}
    </div>
  );
}
