"use client";

/* 야구 화면 공용 조각 (메뉴 · 경기 · 육성) */
import type { CSSProperties, ReactNode } from "react";
import { sfx } from "./sfx";

export const ACCENT = "#FF8A3D";
export const font = { title: "font-['Black_Han_Sans',sans-serif]", body: "font-['Nanum_Gothic',sans-serif]" };

export function Btn({
  children,
  onClick,
  color = ACCENT,
  className = "",
  active,
  disabled,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  color?: string;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        sfx.ui();
        onClick?.();
      }}
      className={`cursor-pointer rounded-xl border-2 font-bold transition-[transform,background-color] active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-35 ${className}`}
      style={{
        borderColor: active ? color : `${color}66`,
        background: active ? `${color}` : `linear-gradient(180deg, ${color}2e, ${color}12)`,
        color: active ? "#111" : "#fff",
        boxShadow: active ? `0 0 18px ${color}88` : "0 3px 0 rgba(0,0,0,0.45)",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function MenuBg({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-full w-full" style={{ background: "radial-gradient(ellipse at 50% 120%, #2a6b3a 0%, #13301f 35%, #0b0e1c 70%)" }}>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{ backgroundImage: "linear-gradient(90deg, #fff 1px, transparent 1px), linear-gradient(#fff 1px, transparent 1px)", backgroundSize: "32px 32px" }}
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}

export function Modal({ children, wide, w, onClose }: { children: ReactNode; wide?: boolean; w?: number; onClose?: () => void }) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (onClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`${w ? "" : wide ? "w-[560px]" : "w-[340px]"} max-h-[548px] overflow-y-auto rounded-2xl border-2 border-white/15 bg-[#11152a] p-6 text-center shadow-2xl`}
        style={w ? { width: w } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
