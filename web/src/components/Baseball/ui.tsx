"use client";

/* 야구 화면 공용 조각 (메뉴 · 경기 · 육성) */
import { useEffect, type CSSProperties, type ReactNode } from "react";
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
  space,
}: {
  children: ReactNode;
  /** 스페이스바로도 누름 (확인 · 계속 버튼) — useSpaceConfirm */
  space?: boolean;
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
      data-space={space ? "" : undefined}
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

/**
 * 스페이스바 = 지금 화면의 확인 · 계속 버튼 (data-space 붙은 것 중 화면에 보이는 맨 마지막 = 맨 위 창).
 * 보이는 게 없으면 아무것도 안 함 (경기 중 스윙 · 던지기 스페이스는 그대로). 글자 입력 중엔 안 함.
 * data-space="pointer" 는 누르기(pointerdown)로 넘기는 장면 (인연 대화).
 */
export function useSpaceConfirm() {
  useEffect(() => {
    const visible = (el: HTMLElement) => {
      if ((el as HTMLButtonElement).disabled) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const target = () => [...document.querySelectorAll<HTMLElement>("[data-space]")].filter(visible).pop();
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target)) return;
      const el = target();
      if (!el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      // 포커스된 다른 버튼이 스페이스로 눌리지 않게
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (el.dataset.space === "pointer") el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      else el.click();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e.target) && target()) e.preventDefault();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, []);
}
