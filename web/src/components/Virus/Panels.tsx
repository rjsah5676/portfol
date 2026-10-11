"use client";

import type { ReactNode } from "react";
import { ROSTER, moduleLevels } from "@/lib/virus/logic";
import { VirusSprite } from "./VirusSprite";

export interface VirusSettings {
  /** 피해 숫자 띄우기 */
  numbers: boolean;
  /** 글리치·번쩍임 같은 화면 효과 */
  effects: boolean;
  /** 배경음악 크기 0~1 */
  bgm: number;
  /** 효과음 크기 0~1 (타격 · 익스플로잇 · 보스) */
  sfx: number;
  /** 배경음악 끔 (오른쪽 위 버튼 · M 키) */
  bgmMute: boolean;
}

export const DEFAULT_SETTINGS: VirusSettings = {
  numbers: true,
  effects: true,
  bgm: 0.7,
  sfx: 0.8,
  bgmMute: false,
};
export const SETTINGS_KEY = "virus-idle-settings";

const KR = "font-['Nanum_Gothic',sans-serif]";

/** 게임 화면 안에 뜨는 창 (터미널 창 모양) */
export function Window({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`virus-pop flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-emerald-400/30 bg-[#08100b] shadow-[0_0_40px_rgba(74,222,128,0.15)] ${
          wide ? "max-w-2xl" : "max-w-sm"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-emerald-400/20 bg-emerald-400/10 px-4 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#4ade80]" />
          <span className="ml-2 font-mono text-xs text-emerald-200/80">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto font-mono text-sm text-white/50 hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${KR}`}>{children}</div>
      </div>
    </div>
  );
}

/** 메뉴 버튼 한 줄 */
export function MenuButton({
  label,
  sub,
  onClick,
  danger = false,
}: {
  label: string;
  sub?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
        danger
          ? "border-rose-400/30 text-rose-200 hover:bg-rose-400/10"
          : "border-white/10 text-white hover:border-emerald-300/60 hover:bg-emerald-400/10"
      }`}
    >
      <span className="text-sm font-bold">{label}</span>
      {sub && <span className="text-[11px] text-white/40">{sub}</span>}
    </button>
  );
}

function Toggle({
  label,
  desc,
  on,
  onChange,
}: {
  label: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-white/10 px-3 py-2.5">
      <span>
        <span className="block text-sm font-bold text-white">{label}</span>
        <span className="block text-[11px] text-white/45">{desc}</span>
      </span>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-emerald-400"
      />
    </label>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  onWipe,
}: {
  settings: VirusSettings;
  onChange: (s: VirusSettings) => void;
  onWipe: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="block rounded-lg border border-white/10 px-3 py-2.5">
        <span className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-bold text-white">배경음악</span>
          <span className="font-mono text-xs text-white/50">
            {settings.bgmMute ? "꺼짐" : `${Math.round(settings.bgm * 100)}`}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.bgm}
          onChange={(e) => onChange({ ...settings, bgm: Number(e.target.value), bgmMute: false })}
          className="w-full accent-emerald-400"
        />
        <span className="mt-1 block text-[11px] text-white/45">
          테마곡 「Controlled Wider Passage」 · 오른쪽 위 🔊 버튼이나 M 키로 끄고 켜요
        </span>
      </label>
      <label className="block rounded-lg border border-white/10 px-3 py-2.5">
        <span className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-bold text-white">효과음</span>
          <span className="font-mono text-xs text-white/50">
            {settings.sfx > 0 ? Math.round(settings.sfx * 100) : "꺼짐"}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.sfx}
          onChange={(e) => onChange({ ...settings, sfx: Number(e.target.value) })}
          className="w-full accent-emerald-400"
        />
        <span className="mt-1 block text-[11px] text-white/45">
          타격 · 익스플로잇 · 보스 등장 · 보스 격퇴
        </span>
      </label>
      <Toggle
        label="피해 숫자 표시"
        desc="코드가 닿을 때 피해량을 띄워요"
        on={settings.numbers}
        onChange={(v) => onChange({ ...settings, numbers: v })}
      />
      <Toggle
        label="화면 효과"
        desc="글리치·번쩍임·코드 비 같은 움직임"
        on={settings.effects}
        onChange={(v) => onChange({ ...settings, effects: v })}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-white/40">
        진행은 이 브라우저에 자동 저장돼요 (5초마다, 창을 닫거나 다른 탭으로 갈 때).
      </p>
      <div className="mt-2">
        <MenuButton label="저장 데이터 지우기" sub="되돌릴 수 없어요" danger onClick={onWipe} />
      </div>
    </div>
  );
}

/** 바이러스 도감 — 격퇴한 보스만 내용이 열림 */
export function ArchivePanel({ best }: { best: number }) {
  const mods = moduleLevels(best);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-white/50">
        실제로 세상을 떠들썩하게 했던 컴퓨터 바이러스들이에요. 격퇴하면 기록이 열려요. (
        {mods.filter((m) => m > 0).length}/{ROSTER.length})
      </p>
      {ROSTER.map((v, i) => {
        const lv = mods[i];
        return (
          <div
            key={v.id}
            className="flex gap-3 rounded-xl border p-3"
            style={{
              borderColor: lv ? `${v.color}55` : "rgba(255,255,255,0.08)",
              background: lv ? `${v.color}0d` : "transparent",
            }}
          >
            <div className={`shrink-0 ${lv ? "" : "opacity-25 grayscale"}`}>
              <VirusSprite seed={v.id} color={v.color} size={48} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold" style={{ color: lv ? v.color : "#ffffff66" }}>
                {lv ? v.name : "??????"}
                <span className="ml-2 font-mono text-[11px] font-normal text-white/40">
                  {lv ? v.year : "????"}
                </span>
              </div>
              {lv ? (
                <>
                  <p className="mt-1 text-xs leading-relaxed text-white/70">{v.desc}</p>
                  <p className="mt-1.5 text-[11px] text-white/50">
                    📦 {v.module} v{lv} ·{" "}
                    {v.cur ? `${v.cur(lv)} — ${v.effect}` : `${v.effect} (버전마다)`}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs text-white/40">
                  스테이지 {i + 1}의 보스예요. 격퇴하면 기록이 열려요.
                </p>
              )}
            </div>
          </div>
        );
      })}
      <p className="mt-1 text-[10px] text-white/30">
        게임 속 수치·효과는 지어낸 것이고, 설명은 실제 사건을 짧게 요약한 거예요.
      </p>
    </div>
  );
}
