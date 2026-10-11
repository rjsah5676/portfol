"use client";

import { useEffect, useState } from "react";
import { HackerSprite } from "./VirusSprite";

export interface TitleItem {
  key: string;
  label: string;
  en: string;
  sub?: string;
  disabled?: boolean;
  run: () => void;
}

/** 배경에 흘러내리는 코드 줄 (매번 같은 모양이 되게 고정 시드) */
const CODE_LINES = Array.from({ length: 28 }, (_, i) => {
  let h = (i + 1) * 2654435761;
  const hex = () => {
    h = (h ^ (h << 13)) >>> 0;
    h = (h ^ (h >>> 17)) >>> 0;
    h = (h ^ (h << 5)) >>> 0;
    return (h % 65536).toString(16).padStart(4, "0");
  };
  return `0x${hex()}${hex()}  ${Array.from({ length: 24 }, hex).join(" ")}`;
});

const BOOT = [
  "> mount /dev/payload ........ OK",
  "> inject --stealth me.exe ... OK",
  "> connect 0.0.0.0:31337 ..... OK",
];

/**
 * 시작 화면: 처음엔 "PRESS ANY KEY", 누르면 부팅 문구와 함께 메뉴.
 * ↑ ↓ 로 고르고 Enter, 마우스로 가리키면 그 줄이 선택됨.
 */
export default function TitleScreen({
  entered,
  onEnter,
  items,
  blocked,
}: {
  entered: boolean;
  onEnter: () => void;
  items: TitleItem[];
  /** 창이 떠 있으면 키 입력 무시 */
  blocked: boolean;
}) {
  const first = Math.max(
    0,
    items.findIndex((it) => !it.disabled)
  );
  // 직접 움직이기 전에는 첫 번째로 고를 수 있는 줄(저장이 있으면 이어하기)을 따라감 — 저장본은 화면이 뜬 뒤에 읽혀서
  const [cur, setCur] = useState<number | null>(null);
  const at = cur === null || items[cur]?.disabled ? first : cur;

  useEffect(() => {
    if (blocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.code === "Tab") return;
      if (!entered) {
        e.preventDefault();
        onEnter();
        return;
      }
      if (e.code === "ArrowUp" || e.code === "ArrowDown") {
        e.preventDefault();
        const dir = e.code === "ArrowUp" ? -1 : 1;
        let i = at;
        do i = (i + dir + items.length) % items.length;
        while (items[i].disabled && i !== at);
        setCur(i);
      } else if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        if (!items[at].disabled) items[at].run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blocked, entered, onEnter, items, at]);

  return (
    <div
      className="absolute inset-0 overflow-hidden select-none"
      onPointerDown={() => {
        if (!entered) onEnter();
      }}
    >
      {/* 배경: 흘러내리는 코드 + 주사선 */}
      <div className="virus-screen absolute inset-0" />
      <div className="virus-rain pointer-events-none absolute inset-x-0 top-0 font-mono text-[11px] leading-5 text-emerald-400/[0.13]">
        {[...CODE_LINES, ...CODE_LINES].map((l, i) => (
          <div key={i} className="truncate px-4">
            {l}
          </div>
        ))}
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,transparent_20%,rgba(3,6,4,0.85)_100%)]" />

      <div
        className={`absolute inset-x-0 flex flex-col items-center transition-[top] duration-500 ${
          entered ? "top-[6%]" : "top-[16%]"
        }`}
      >
        <div className="virus-title-in flex items-end gap-3 sm:gap-5">
          <HackerSprite color="#4ade80" size={entered ? 76 : 110} firing />
          <div className="pb-2">
            <div
              className="virus-title font-mono text-4xl font-black tracking-tight text-emerald-300 sm:text-6xl"
              data-text="VIRUS IDLE"
            >
              VIRUS IDLE
            </div>
            <div className="mt-1 font-['Nanum_Gothic',sans-serif] text-sm font-bold tracking-[0.3em] text-white/70 sm:text-base">
              바이러스 키우기
            </div>
          </div>
        </div>
      </div>

      {!entered ? (
        <div className="absolute inset-x-0 bottom-[14%] text-center">
          <div className="virus-blink font-mono text-lg font-bold tracking-[0.3em] text-emerald-300 sm:text-2xl">
            PRESS ANY KEY
          </div>
          <div className="mt-2 font-['Nanum_Gothic',sans-serif] text-xs text-white/50">
            아무 키나 누르거나 화면을 터치하세요
          </div>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-[5%] mx-auto flex w-[min(440px,88%)] flex-col">
          <div className="mb-2 font-mono text-[10px] leading-4 text-emerald-400/60 sm:text-[11px]">
            {BOOT.map((l, i) => (
              <div key={l} className="virus-type" style={{ animationDelay: `${i * 160}ms` }}>
                {l}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            {items.map((it, i) => {
              const on = i === at && !it.disabled;
              return (
                <button
                  key={it.key}
                  type="button"
                  disabled={it.disabled}
                  onPointerEnter={() => !it.disabled && setCur(i)}
                  onClick={() => it.run()}
                  style={{ animationDelay: `${300 + i * 60}ms` }}
                  className={`virus-slide flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors sm:py-2.5 ${
                    on
                      ? "border-emerald-300/70 bg-emerald-400/15 shadow-[0_0_18px_rgba(74,222,128,0.25)]"
                      : "border-white/10 bg-black/40 hover:border-white/30"
                  } disabled:cursor-not-allowed disabled:opacity-35`}
                >
                  <span
                    className={`w-3 font-mono text-sm ${on ? "text-emerald-300" : "text-transparent"}`}
                  >
                    &gt;
                  </span>
                  <span className="font-['Nanum_Gothic',sans-serif] text-sm font-bold text-white sm:text-[15px]">
                    {it.label}
                  </span>
                  <span className="font-mono text-[10px] tracking-widest text-white/35">
                    {it.en}
                  </span>
                  {it.sub && (
                    <span className="ml-auto truncate font-['Nanum_Gothic',sans-serif] text-[11px] text-emerald-200/70">
                      {it.sub}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="absolute right-4 bottom-2 font-mono text-[10px] text-white/30">
        v0.1 · {entered ? "↑ ↓ 이동 · Enter 선택" : "VIRUS IDLE"}
      </div>
    </div>
  );
}
