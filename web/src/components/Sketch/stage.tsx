"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getSound, onSoundChange, playSfx, setSound } from "@/lib/sketch/sfx";
import { Icon } from "./Art";

/*
 * 스케치 퀴즈 무대 공통: 가로판(h, PC) / 세로판(v, 폰), 전체화면, 소리 버튼.
 *  - 가로판은 1280×720 기준으로 그려서 무대 크기에 맞게 통째로 줄이고 키움 → 어느 화면에서나 배치가 같음
 *  - 세로판은 화면 높이를 꽉 채우는 세로 배치
 */

export type Orient = "h" | "v";
export const DESIGN = { w: 1280, h: 720 };

export interface StageInfo {
  o: Orient;
  fs: boolean;
  canFs: boolean;
  toggleFs: () => void;
}
export const StageCtx = createContext<StageInfo>({
  o: "h",
  fs: false,
  canFs: false,
  toggleFs: () => {},
});
export const useStage = () => useContext(StageCtx);

let keySeq = 0;
/** 다시 띄울 때 바꿔 줄 key (토스트 · 도장 · 색종이) */
export const nextKey = () => ++keySeq;

/** 효과음이 붙은 클릭 */
export const tap =
  <A extends unknown[]>(fn: (...a: A) => void, sound = "sfx-click") =>
  (...a: A) => {
    playSfx(sound);
    fn(...a);
  };

export function useSoundSettings() {
  const [s, setS] = useState(getSound);
  useEffect(() => onSoundChange(() => setS({ ...getSound() })), []);
  return s;
}

/** 소리 버튼 — 누르면 음소거 · 음량 창 */
export function SoundButton({ className = "" }: { className?: string }) {
  const s = useSoundSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", off);
    return () => window.removeEventListener("pointerdown", off);
  }, [open]);
  const row = (label: string, v: number, k: "bgm" | "sfx") => (
    <label className="flex items-center gap-2 text-[15px]">
      <span className="sk-hand w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={v}
        onChange={(e) => setSound({ [k]: Number(e.target.value), mute: false })}
        className="min-w-0 flex-1 accent-[#FF6B6B]"
      />
      <span className="w-8 text-right font-mono text-[11px] text-[var(--ink2)]">
        {Math.round(v * 100)}
      </span>
    </label>
  );
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        title="소리"
        onClick={() => setOpen((v) => !v)}
        className="sk-btn sk-btn-icon text-[15px]"
      >
        <Icon name={s.mute ? "mute" : "sound"} size={19} />
      </button>
      {open && (
        <div className="sk-card sk-pop absolute top-[calc(100%+8px)] right-0 z-50 flex w-64 flex-col gap-2.5 p-3.5">
          <button
            type="button"
            onClick={() => setSound({ mute: !s.mute })}
            className={`sk-btn text-[16px] ${s.mute ? "sk-btn-coral" : ""}`}
          >
            <Icon name={s.mute ? "mute" : "sound"} size={17} />
            {s.mute ? "소리 꺼짐 (누르면 켜기)" : "소리 켜짐 (누르면 끄기)"}
          </button>
          {row("배경음악", s.bgm, "bgm")}
          {row("효과음", s.sfx, "sfx")}
        </div>
      )}
    </div>
  );
}

export function FsButton() {
  // 진짜 전체화면이 안 되는 기기(아이폰 사파리)도 화면을 꽉 채우는 흉내 전체화면으로
  const { fs, toggleFs } = useStage();
  return (
    <button
      type="button"
      title={fs ? "전체화면 끝내기" : "전체화면"}
      onClick={tap(toggleFs)}
      className="sk-btn sk-btn-icon text-[15px]"
    >
      <Icon name={fs ? "unfull" : "full"} size={18} />
    </button>
  );
}

/** 창 (무대 안에 뜸) */
export function Dialog({
  onClose,
  children,
  className = "",
  title,
}: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  title?: ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="sk-dim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`sk-card sk-pop relative flex max-h-full flex-col ${className}`}
        role="dialog"
        aria-modal
      >
        <span className="sk-tape top" />
        {title && (
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
            <h2 className="sk-hand text-[26px] leading-none">{title}</h2>
            <button
              type="button"
              onClick={tap(onClose, "sfx-close")}
              className="sk-btn sk-btn-ghost sk-btn-icon text-[13px]"
              aria-label="닫기"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** 색종이 터뜨리기 — 다시 터뜨리려면 key 를 바꿔서 새로 그림 */
export function Confetti({ n = 40 }: { n?: number }) {
  const [bits] = useState(() =>
    Array.from({ length: n }, (_, i) => ({
      left: Math.random() * 100,
      dx: (Math.random() - 0.5) * 220,
      dy: 380 + Math.random() * 420,
      rot: (Math.random() - 0.5) * 1080,
      dur: 1.4 + Math.random() * 1.4,
      delay: Math.random() * 0.25,
      color: ["#FF6B6B", "#FFC93C", "#2EC4B6", "#4EA8DE", "#9B5DE5", "#FF9F43"][i % 6],
    }))
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-[55] overflow-hidden" aria-hidden>
      {bits.map((b, i) => (
        <span
          key={i}
          className="sk-confetti"
          style={
            {
              left: `${b.left}%`,
              background: b.color,
              animationDuration: `${b.dur}s`,
              animationDelay: `${b.delay}s`,
              "--dx": `${b.dx}px`,
              "--dy": `${b.dy}px`,
              "--rot": `${b.rot}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
