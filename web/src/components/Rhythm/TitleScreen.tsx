"use client";

import { useEffect, useState } from "react";
import GuideView from "@/components/GuideView";
import { RHYTHM_GUIDE } from "@/data/gameGuides";
import { sfx } from "@/lib/rhythm/sfx";
import PatchNotes, { LATEST } from "./PatchNotes";
import SpeakerIcon from "./SpeakerIcon";

const DISP = "pru-t";

export default function TitleScreen({
  entered,
  onEnter,
  onStart,
  onSettings,
  onRanking,
  onShop,
  onOnline,
  bgmMute,
  onToggleBgm,
  fs,
  onToggleFs,
  blocked,
}: {
  entered: boolean;
  onEnter: () => void;
  onStart: () => void;
  onSettings: () => void;
  /** 회원 BP 랭킹 (게임 머리말의 랭킹 창을 엶) */
  onRanking: () => void;
  /** 상점 (테마 스킨) */
  onShop: () => void;
  onOnline: () => void;
  /** 메뉴 배경음 꺼짐 — B 키는 부모가 받음 */
  bgmMute: boolean;
  onToggleBgm: () => void;
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
    { label: "ONLINE", sub: "온라인 모드", run: onOnline },
    { label: "SETTINGS", sub: "속도 · 싱크 · 레인 위치", run: onSettings },
    { label: "RANKING", sub: "BP 랭킹 — 곡별 최고 BP 상위 20곡 합", run: onRanking },
    { label: "SHOP", sub: "상점 — 테마 스킨", run: onShop },
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
        src="/rhythm/px/title.webp"
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,transparent_35%,rgba(12,7,24,0.65)_100%)]" />
      {/* 로고: 들어올 때 쾅, 그다음 메뉴 BGM(128BPM)에 맞춰 두근두근 */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 transition-all duration-500 ease-[steps(6)] ${
          entered ? "top-[1.4cqw] w-[36cqw]" : "top-[8cqw] w-[52cqw]"
        }`}
      >
        <img
          src="/rhythm/px/logo.webp"
          alt="PIXEL Rhythm Up"
          draggable={false}
          className="w-full drop-shadow-[0_0.5cqw_0_rgba(12,7,24,0.55)] [animation:bd-logo-in_900ms_steps(6),bd-beat_586ms_steps(3)_900ms_infinite]"
        />
      </div>

      {!entered ? (
        <div className="absolute inset-x-0 bottom-[6.4cqw] bg-[linear-gradient(90deg,transparent,rgba(12,7,24,0.8)_25%,rgba(12,7,24,0.8)_75%,transparent)] py-[1.2cqw] text-center">
          <div
            className={`${DISP} pru-sh text-[2.8cqw] tracking-[0.2em] text-[var(--gold)] [animation:pru-blink_1.1s_steps(1)_infinite]`}
          >
            PRESS ANY KEY
          </div>
          <div className="pru-sh-s mt-[0.7cqw] text-[1.2cqw] text-[var(--mute)]">
            아무 키나 누르거나 화면을 터치하세요
          </div>
        </div>
      ) : (
        <div className="absolute bottom-[3.4cqw] left-1/2 flex w-[32cqw] -translate-x-1/2 flex-col gap-[0.65cqw]">
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
                className={`pru-btn group flex cursor-pointer items-center justify-between px-[1.8cqw] py-[0.5cqw] [animation:bd-slide-up_300ms_steps(4)_backwards] ${
                  on ? "pru-on pru-caret" : "[--c:rgba(28,19,52,0.88)]"
                }`}
              >
                <span className={`${DISP} pru-sh-s text-[1.6cqw] text-white`}>{it.label}</span>
                <span className={`text-[1.05cqw] ${on ? "text-white" : "text-[var(--mute)]"}`}>
                  {it.sub}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="pru-sh-s absolute right-[1.6cqw] bottom-[1.2cqw] text-[0.95cqw] text-white/60">
        DFJK 4KEY · {entered ? "↑ ↓ 이동 · Enter 선택" : "PIXEL Rhythm Up"}
      </div>

      {/* 오른쪽 위: 배경음 · 패치노트 */}
      <div className="absolute top-[1.6cqw] right-[1.6cqw] z-10 flex items-center gap-[0.8cqw]">
        {entered && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onToggleBgm}
            title={bgmMute ? "배경음 켜기 (B)" : "배경음 끄기 (B)"}
            aria-label={bgmMute ? "배경음 켜기" : "배경음 끄기"}
            className={`pru-btn flex cursor-pointer items-center gap-[0.5cqw] px-[0.9cqw] py-[0.4cqw] text-[1cqw] ${
              bgmMute ? "text-white/45" : "text-white"
            }`}
          >
            <SpeakerIcon muted={bgmMute} className="h-[1.5cqw] w-[1.5cqw]" />
            <span className="pru-key px-[0.4cqw] leading-none">B</span>
          </button>
        )}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setNotes(true)}
          className="pru-btn flex cursor-pointer items-center gap-[0.6cqw] px-[1.2cqw] py-[0.4cqw] text-[1.15cqw] font-bold text-white [--c:#3a1d4f]"
        >
          📜 패치노트
          <span className="text-[0.95cqw] font-normal text-[var(--gold)]">
            {LATEST.ver} · {LATEST.date.slice(5)}
          </span>
        </button>
      </div>
      {notes && <PatchNotes onClose={() => setNotes(false)} />}

      {guide && (
        <div
          className="pru-dither absolute inset-0 z-30 flex items-center justify-center bg-black/55 [animation:modal-fade_120ms_steps(3)]"
          onPointerDown={(e) => e.target === e.currentTarget && setGuide(false)}
        >
          <div className="pru-win relative flex max-h-[50cqw] w-[min(640px,70cqw)] flex-col overflow-hidden [--wf:#150e29]">
            <div className="pru-head flex items-center justify-between px-5 py-3">
              <span className="pru-t text-sm text-[var(--gold)]">게임 가이드</span>
              <button
                type="button"
                onClick={() => {
                  sfx("ui-back", 0.7);
                  setGuide(false);
                }}
                className="pru-btn cursor-pointer px-2 text-sm text-white"
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
