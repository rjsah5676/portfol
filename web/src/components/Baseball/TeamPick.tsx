"use client";

/* 첫 방문: 구단 고르기 (10팀 · 5×2) */
import { useState } from "react";
import { CLUB_DEFS } from "@/lib/baseball/data";
import { ACCENT, Btn, font } from "./ui";
import { Emblem } from "./clubUi";
import { sfx } from "./sfx";

export default function TeamPick({ onPick, onLater }: { onPick: (teamId: string) => void; onLater: () => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const def = CLUB_DEFS.find((d) => d.id === sel);
  return (
    <div className="flex h-full flex-col px-6 pt-4 pb-4">
      <div className="flex items-end justify-between">
        <div>
          <div className={`${font.title} text-[30px] leading-none`} style={{ color: ACCENT, textShadow: "0 3px 0 #000" }}>
            내 구단 고르기
          </div>
          <div className="mt-1.5 text-[12.5px] text-white/60">처음 한 번만 골라요 · 선수 카드는 모두 C 등급으로 시작 — 육성 모드 은퇴 선수가 구단에 합류해요</div>
        </div>
        <Btn className="px-4 py-1.5 text-sm" color="#8b93b8" onClick={onLater}>
          나중에 고르기
        </Btn>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-3">
        {CLUB_DEFS.map((d) => {
          const on = d.id === sel;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                sfx.ui();
                setSel(d.id);
              }}
              className="relative flex h-[198px] cursor-pointer flex-col items-center overflow-hidden rounded-xl border-2 px-2 pt-4 pb-2 text-center transition-transform active:translate-y-[1px]"
              style={{
                borderColor: on ? d.color : `${d.color}55`,
                background: `linear-gradient(180deg, ${d.color}${on ? "40" : "22"} 0%, ${d.dark}cc 100%)`,
                boxShadow: on ? `0 0 22px ${d.color}aa, inset 0 0 0 1px #fff4` : "0 3px 0 rgba(0,0,0,0.45)",
                transform: on ? "translateY(-2px)" : undefined,
              }}
            >
              <Emblem def={d} size={66} />
              <div className={`${font.title} mt-2 text-[17px] leading-tight text-white`}>{d.name}</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="font-mono text-[11px] font-bold tracking-widest" style={{ color: d.color }}>
                  {d.short}
                </span>
                <span className="h-2.5 w-2.5 rounded-full border border-white/40" style={{ background: d.color }} />
                <span className="h-2.5 w-2.5 rounded-full border border-white/40" style={{ background: d.dark }} />
              </div>
              <div className="mt-1.5 text-[11.5px] leading-snug break-keep text-white/70">{d.flavor}</div>
              {on && <span className="absolute top-1.5 right-1.5 rounded bg-white px-1.5 text-[10px] font-bold text-[#111]">선택</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-auto flex items-center justify-between pt-3">
        <div className="text-[13px] text-white/70">
          {def ? (
            <>
              <b style={{ color: def.color }}>{def.name}</b> 구단주가 되어 타자 13 · 투수 10 · 코치 4 · 치어리더 3명과 시작해요
            </>
          ) : (
            "구단을 하나 눌러 주세요"
          )}
        </div>
        <Btn className={`${font.title} px-8 py-2.5 text-xl`} disabled={!def} color={def?.color ?? ACCENT} onClick={() => def && onPick(def.id)}>
          이 구단으로 창단
        </Btn>
      </div>
    </div>
  );
}
