"use client";

import { useEffect, useState } from "react";
import GuideView from "@/components/GuideView";
import { RHYTHM_GUIDE } from "@/data/gameGuides";
import { sfx } from "@/lib/rhythm/sfx";
import PatchNotes, { LATEST } from "./PatchNotes";

const DISP = "font-['Arial_Black','Segoe_UI_Black',Impact,sans-serif] font-black italic";

export default function TitleScreen({
  entered,
  onEnter,
  onStart,
  onSettings,
  fs,
  onToggleFs,
  blocked,
}: {
  entered: boolean;
  onEnter: () => void;
  onStart: () => void;
  onSettings: () => void;
  fs: boolean;
  onToggleFs: () => void;
  /** 설정 창이 떠 있으면 키 입력 무시 */
  blocked: boolean;
}) {
  const [cur, setCur] = useState(0);
  const [guide, setGuide] = useState(false);
  const [notes, setNotes] = useState(false);
  const items: { label: string; sub: string; run: () => void }[] = [
    { label: "GAME START", sub: "곡 고르기", run: onStart },
    { label: "SETTINGS", sub: "속도 · 싱크 · 레인 위치", run: onSettings },
    { label: "HOW TO PLAY", sub: "게임 가이드", run: () => setGuide(true) },
    { label: fs ? "WINDOW" : "FULLSCREEN", sub: fs ? "창모드로" : "전체화면으로", run: onToggleFs },
  ];
  const pick = (i: number) => {
    sfx(i === 0 ? "ui-select" : "ui-open", 0.8);
    items[i].run();
  };

  useEffect(() => {
    if (!guide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.preventDefault();
      sfx("ui-back", 0.7);
      setGuide(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guide]);
  useEffect(() => {
    if (blocked || guide || notes) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!entered) {
        if (e.code === "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        onEnter();
        return;
      }
      // 전체화면이면 Esc로 창모드로 (크롬·엣지는 Esc를 게임이 받아서 직접 꺼 줘야 함)
      if (e.code === "Escape") {
        if (fs) {
          e.preventDefault();
          sfx("ui-back", 0.7);
          onToggleFs();
        }
        return;
      }
      if (e.code === "ArrowUp" || e.code === "ArrowDown") {
        e.preventDefault();
        setCur((c) => (c + (e.code === "ArrowUp" ? -1 : 1) + items.length) % items.length);
        sfx("ui-move", 0.6);
      } else if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        pick(cur);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onPointerDown={() => {
        if (!entered) onEnter();
      }}
    >
      <img
        src="/rhythm/title.webp"
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,transparent_30%,rgba(4,2,16,0.7)_100%)]" />
      {/* 로고: 들어올 때 쾅, 그다음 메뉴 BGM(128BPM)에 맞춰 두근두근 */}
      <div
        className={`absolute left-1/2 w-[54cqw] -translate-x-1/2 transition-[top] duration-500 ${
          entered ? "top-[4cqw]" : "top-[9cqw]"
        }`}
      >
        <img
          src="/rhythm/logo.webp"
          alt="BEAT DASH"
          draggable={false}
          className="w-full drop-shadow-[0_0_2cqw_rgba(167,139,250,0.55)] [animation:bd-logo-in_900ms_cubic-bezier(.2,.9,.3,1.2),bd-beat_586ms_ease-out_900ms_infinite]"
        />
      </div>

      {!entered ? (
        <div className="absolute inset-x-0 bottom-[6.4cqw] bg-[linear-gradient(90deg,transparent,rgba(6,3,20,0.75)_25%,rgba(6,3,20,0.75)_75%,transparent)] py-[1.2cqw] text-center">
          <div
            className={`${DISP} text-[2.6cqw] tracking-[0.25em] text-white drop-shadow-[0_0_1.2cqw_#ec4899] [animation:bd-blink_1.4s_ease-in-out_infinite]`}
          >
            PRESS ANY KEY
          </div>
          <div className="mt-[0.6cqw] font-['Nanum_Gothic',sans-serif] text-[1.2cqw] text-white/60">
            아무 키나 누르거나 화면을 터치하세요
          </div>
        </div>
      ) : (
        <div className="absolute bottom-[4.5cqw] left-1/2 flex w-[34cqw] -translate-x-1/2 flex-col gap-[0.7cqw]">
          {items.map((it, i) => {
            const on = i === cur;
            return (
              <button
                key={it.label}
                type="button"
                onPointerEnter={() => {
                  if (cur !== i) {
                    setCur(i);
                    sfx("ui-move", 0.5);
                  }
                }}
                onClick={() => pick(i)}
                style={{ animationDelay: `${i * 70}ms` }}
                className={`group relative flex cursor-pointer items-center justify-between overflow-hidden rounded-[0.6cqw] border px-[2cqw] py-[0.75cqw] [animation:bd-slide-up_400ms_ease-out_backwards] transition-all ${
                  on
                    ? "-skew-x-6 scale-105 border-[#f0abfc] bg-[linear-gradient(90deg,#db2777e6,#7c3aede6)] shadow-[0_0_2cqw_rgba(236,72,153,0.6)]"
                    : "-skew-x-6 border-white/15 bg-[#0b0820]/75 hover:border-white/40"
                }`}
              >
                {on && (
                  <span className="pointer-events-none absolute inset-y-0 left-0 w-[6cqw] bg-white/30 [animation:bd-sweep_1.6s_ease-in-out_infinite]" />
                )}
                <span className={`${DISP} skew-x-6 text-[1.9cqw] tracking-[0.08em] text-white`}>
                  {it.label}
                </span>
                <span
                  className={`skew-x-6 font-['Nanum_Gothic',sans-serif] text-[1.1cqw] font-bold ${on ? "text-white" : "text-white/45"}`}
                >
                  {it.sub}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="absolute right-[1.6cqw] bottom-[1.2cqw] font-mono text-[0.95cqw] text-white/40">
        DFJK 4KEY · {entered ? "↑ ↓ 이동 · Enter 선택" : "BEAT DASH"}
      </div>

      {/* 패치노트 (오른쪽 위) */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setNotes(true)}
        className="absolute top-[1.6cqw] right-[1.6cqw] z-10 flex cursor-pointer items-center gap-[0.6cqw] rounded-full border border-[#F472B6]/60 bg-[#0b0820]/75 px-[1.3cqw] py-[0.45cqw] font-['Nanum_Gothic',sans-serif] text-[1.2cqw] font-bold text-white backdrop-blur-[3px] transition-colors hover:border-[#F472B6] hover:bg-[#2a1240]/85"
      >
        📜 패치노트
        <span className="font-mono text-[1cqw] font-normal text-white/55">
          {LATEST.ver} · {LATEST.date.slice(5)}
        </span>
      </button>
      {notes && <PatchNotes onClose={() => setNotes(false)} />}

      {guide && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-[3px] [animation:modal-fade_180ms_ease-out]"
          onPointerDown={(e) => e.target === e.currentTarget && setGuide(false)}
        >
          <div className="relative flex max-h-[50cqw] w-[min(640px,70cqw)] flex-col overflow-hidden rounded-[1.2cqw] border border-white/15 bg-[#120f26] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <span className="font-mono text-sm font-bold text-white">게임 가이드</span>
              <button
                type="button"
                onClick={() => {
                  sfx("ui-back", 0.7);
                  setGuide(false);
                }}
                className="cursor-pointer rounded-full px-2 font-mono text-sm text-white/60 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="bd-scroll min-h-0 flex-1 overflow-y-auto p-5">
              <GuideView doc={RHYTHM_GUIDE} accent="#A78BFA" onDone={() => setGuide(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
