"use client";

/** 소리 설정: 전체 · 음악 (일시정지 창 · 순찰대 설정 창 같이 씀) */
import { useState } from "react";
import { setSound, soundPref } from "./audio";

export default function SoundSliders() {
  const [snd, setSnd] = useState(soundPref());
  const row = (label: string, v: number, on: (v: number) => void) => (
    <label className="flex items-center gap-[10px] text-[13px]">
      <span className="w-[44px] shrink-0">{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={v} onChange={(e) => on(Number(e.target.value))} className="flex-1 cursor-pointer accent-[#ffd23a]" />
      <span className="w-[34px] text-right text-[11px] text-[#a9a2d6]">{Math.round(v * 100)}</span>
    </label>
  );
  return (
    <div className="flex flex-col gap-[8px]">
      {row("소리", snd.muted ? 0 : snd.vol, (v) => {
        setSound({ vol: v, muted: v === 0 });
        setSnd(soundPref());
      })}
      {row("음악", snd.mvol, (v) => {
        setSound({ mvol: v });
        setSnd(soundPref());
      })}
    </div>
  );
}
