"use client";

import type { ReactNode } from "react";
import {
  FACTION_COLOR,
  FACTION_NAME,
  GRADE_COLOR,
  GRADE_NAME,
  UNIT,
  type UnitDef,
} from "@/lib/defense/units";
import { UNIT_ART } from "@/lib/defense/assets";

/* 글리치 디펜스 공용 UI 조각 (무대 1024×576 안에서 쓰는 크기) */

export const TITLE = "font-['Black_Han_Sans',sans-serif]";

export function Btn({
  children,
  onClick,
  disabled,
  tone = "ghost",
  className = "",
  title,
  hot,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "ghost" | "main" | "gold" | "danger" | "cyan";
  className?: string;
  title?: string;
  /** 단축키 표시 (PC) */
  hot?: string;
}) {
  const tones = {
    ghost: "border-white/12 bg-white/[0.05] text-white/85 hover:bg-white/[0.1]",
    main: "border-[#ff5cd6]/70 bg-[linear-gradient(180deg,#ff5cd6,#b02fa0)] text-white shadow-[0_0_18px_-4px_#ff5cd6] hover:brightness-110",
    gold: "border-[#ffd84a]/70 bg-[linear-gradient(180deg,#ffd84a,#c99a12)] text-[#2a1e05] hover:brightness-110",
    danger: "border-[#ff5a6e]/60 bg-[#ff5a6e]/15 text-[#ffb3bd] hover:bg-[#ff5a6e]/25",
    cyan: "border-[#7ef3ff]/50 bg-[#7ef3ff]/10 text-[#c8fbff] hover:bg-[#7ef3ff]/20",
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`relative rounded-lg border transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100 ${tones[tone]} ${className}`}
    >
      {children}
      {hot && (
        <span className="pointer-events-none absolute top-0.5 right-1 hidden font-mono text-[9px] opacity-45 [@media(pointer:fine)]:block">
          {hot}
        </span>
      )}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 backdrop-blur-[2px]"
      onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className={`flex max-h-[540px] flex-col rounded-2xl border border-white/12 bg-[#0d1122] shadow-2xl ${wide ? "w-[900px]" : "w-[600px]"}`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h3 className={`${TITLE} text-[22px] text-white`}>{title}</h3>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="h-9 w-9 rounded-lg text-2xl text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="닫기"
            >
              ×
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function GradeChip({ g }: { g: number }) {
  return (
    <span
      className="rounded px-1.5 py-[1px] text-[12px] font-bold"
      style={{
        color: GRADE_COLOR[g],
        background: GRADE_COLOR[g] + "22",
        border: `1px solid ${GRADE_COLOR[g]}55`,
      }}
    >
      {GRADE_NAME[g]}
    </span>
  );
}
export function FactionChip({ f }: { f: UnitDef["faction"] }) {
  return (
    <span
      className="rounded px-1.5 py-[1px] text-[12px] font-bold"
      style={{ color: FACTION_COLOR[f], background: FACTION_COLOR[f] + "1c" }}
    >
      {FACTION_NAME[f]}
    </span>
  );
}

/** 유닛 얼굴 (그림이 있으면 첫 프레임, 없으면 세력색 네모 + 글자) */
export function UnitIcon({ id, size = 40, dim }: { id: string; size?: number; dim?: boolean }) {
  const d = UNIT[id];
  const art = UNIT_ART[id];
  if (art)
    return (
      <span
        className="inline-block shrink-0 rounded-md"
        style={{
          width: size,
          height: size,
          backgroundImage: `url(${art.src})`,
          backgroundSize: `${(art.idle.frames * size * art.w) / art.h}px auto`,
          backgroundPosition: `0 ${-art.idle.row * size}px`,
          imageRendering: art.pixel ? "pixelated" : undefined,
          border: `2px solid ${GRADE_COLOR[d.grade]}`,
          opacity: dim ? 0.35 : 1,
        }}
      />
    );
  return (
    <span
      className={`${TITLE} inline-flex shrink-0 items-center justify-center rounded-md text-[#0b0f1d]`}
      style={{
        width: size,
        height: size,
        background: FACTION_COLOR[d.faction],
        border: `${d.grade >= 2 ? 3 : 2}px solid ${GRADE_COLOR[d.grade]}`,
        fontSize: d.glyph.length > 1 ? size * 0.3 : size * 0.45,
        opacity: dim ? 0.35 : 1,
        boxShadow: d.grade >= 3 ? `0 0 12px ${GRADE_COLOR[d.grade]}88` : undefined,
      }}
    >
      {d.glyph}
    </span>
  );
}

/** 유닛 성능 한 줄 요약 */
export function unitStats(d: UnitDef) {
  const r = d.range >= 99 ? "전체" : `${d.range}칸`;
  return `피해 ${d.dmg} · 초당 ${d.aps}회 · 사거리 ${r} · ${d.dtype === "phys" ? "물리" : "마법"}`;
}

export const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const fmtNum = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e4
      ? `${(n / 1e3).toFixed(1)}K`
      : String(Math.round(n));
