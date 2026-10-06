"use client";

/**
 * 설정 · 일시정지 화면 (게임 프레임 안, 패치노트와 같은 금테 판).
 *  - SettingsBody: 효과음 · 배경음 · 소리 끄기 · 전체화면 (+ 휴대폰이면 이동 조작)
 *  - SettingsModal: 메인 화면 ⚙ 설정
 *  - PauseMenu: 왼쪽 버튼 목록(↑↓ · Enter) + 오른쪽 설정
 */
import { useEffect, useState, type ReactNode } from "react";
import { sfxUi } from "@/lib/fight/sfx";
import type { MoveMode } from "./Touch";

const KR = "font-['Nanum_Gothic',sans-serif]";
const TITLE = "font-['Black_Han_Sans',sans-serif]";

/** 금테 판 */
function GoldFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`${KR} relative flex flex-col rounded-[1cqw] bg-[linear-gradient(180deg,#F2C35B,#9A6A1E)] p-[0.25cqw] shadow-[0_1cqw_3cqw_rgba(0,0,0,0.6)] [animation:modal-pop_200ms_ease-out] ${className}`}
    >
      <div className="flex min-h-0 flex-1 flex-col rounded-[0.8cqw] bg-[linear-gradient(180deg,#2B1840,#140A22)]">
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-[1.4cqw] rounded-[0.6cqw] bg-white/[0.05] px-[1.2cqw] py-[0.8cqw]">
      <span className="text-[1.3cqw] font-bold text-white/85">{label}</span>
      <span className="flex items-center gap-[0.8cqw]">{children}</span>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => {
        sfxUi("move");
        onChange();
      }}
      className={`relative h-[1.9cqw] w-[3.6cqw] cursor-pointer rounded-full transition-colors ${on ? "bg-[#F2C35B]" : "bg-white/15"}`}
    >
      <span
        className={`absolute top-[0.25cqw] h-[1.4cqw] w-[1.4cqw] rounded-full bg-white shadow transition-all ${on ? "left-[1.95cqw]" : "left-[0.25cqw]"}`}
      />
    </button>
  );
}

function Pick<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <span className="flex gap-[0.4cqw]">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => {
            sfxUi("move");
            onChange(o.v);
          }}
          className={`cursor-pointer rounded-full px-[1cqw] py-[0.25cqw] text-[1.1cqw] font-bold transition-colors ${
            value === o.v
              ? "bg-[#F2C35B] text-[#2B1840]"
              : "bg-white/10 text-white/65 hover:bg-white/20"
          }`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

export interface SettingsProps {
  vol: { sfx: number; bgm: number };
  onVol: (v: { sfx: number; bgm: number }) => void;
  muted: boolean;
  onMute: () => void;
  fs: boolean;
  onFs: () => void;
  /** 휴대폰: 이동 조작 (없으면 줄을 안 보임) */
  moveMode?: MoveMode;
  onMoveMode?: (m: MoveMode) => void;
}

export function SettingsBody({
  vol,
  onVol,
  muted,
  onMute,
  fs,
  onFs,
  moveMode,
  onMoveMode,
}: SettingsProps) {
  const slider = (k: "sfx" | "bgm", label: string) => (
    <Row label={label}>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(vol[k] * 100)}
        disabled={muted}
        onChange={(e) => onVol({ ...vol, [k]: Number(e.target.value) / 100 })}
        className="h-[0.5cqw] w-[14cqw] cursor-pointer accent-[#F2C35B] disabled:opacity-35"
        aria-label={`${label} 음량`}
      />
      <span className="w-[3.4cqw] text-right font-mono text-[1.15cqw] text-[#FFE9A8] tabular-nums">
        {muted ? "—" : Math.round(vol[k] * 100)}
      </span>
    </Row>
  );
  return (
    <div className="flex flex-col gap-[0.7cqw]">
      {slider("sfx", "효과음")}
      {slider("bgm", "배경음악")}
      <Row label="소리 끄기">
        <Toggle on={muted} onChange={onMute} label="소리 끄기" />
      </Row>
      <Row label="전체화면">
        <Toggle on={fs} onChange={onFs} label="전체화면" />
      </Row>
      {moveMode && onMoveMode && (
        <Row label="휴대폰 이동 조작">
          <Pick
            value={moveMode}
            onChange={onMoveMode}
            options={[
              { v: "stick", label: "스틱" },
              { v: "keys", label: "← → 키" },
            ]}
          />
        </Row>
      )}
    </div>
  );
}

/** 메인 화면 ⚙ 설정 */
export function SettingsModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  // 열린 동안엔 키 입력을 메뉴로 안 보냄 (Esc = 닫기)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.code === "Escape" || e.code === "Backspace") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px] [animation:modal-fade_150ms_ease-out]"
      onClick={onClose}
    >
      <GoldFrame className="w-[46cqw]">
        <div className="flex items-center justify-between border-b border-[#F2C35B]/30 px-[2cqw] py-[1.2cqw]">
          <span
            className={`${TITLE} text-[2.4cqw] tracking-wide text-[#FFE9A8] [text-shadow:0_0.2cqw_0_#12081F]`}
          >
            설정
          </span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full bg-white/10 px-[1.2cqw] py-[0.3cqw] text-[1.2cqw] text-white/75 hover:bg-white/20"
          >
            닫기 ✕
          </button>
        </div>
        <div className="px-[2cqw] py-[1.6cqw]">{children}</div>
      </GoldFrame>
    </div>
  );
}

export interface PauseAction {
  label: string;
  onClick: () => void;
  /** 빨간 버튼 (기권 등) */
  danger?: boolean;
}

/** 일시정지(온라인은 메뉴): 왼쪽 버튼 목록 + 오른쪽 설정. ↑↓·W/S 고르기, Enter·J 누르기, Esc 계속 */
export function PauseMenu({
  title,
  note,
  actions,
  settings,
}: {
  title: string;
  note?: string;
  actions: PauseAction[];
  settings: ReactNode;
}) {
  const [sel, setSel] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") return;
      if (e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        sfxUi("move");
        setSel((s) => (s + actions.length - 1) % actions.length);
      } else if (e.code === "ArrowDown" || e.code === "KeyS") {
        e.preventDefault();
        sfxUi("move");
        setSel((s) => (s + 1) % actions.length);
      } else if (e.code === "Enter" || e.code === "KeyJ" || e.code === "Space") {
        e.preventDefault();
        sfxUi("ok");
        actions[Math.min(sel, actions.length - 1)]?.onClick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, sel]);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(20,8,40,0.55),rgba(5,2,12,0.85))] backdrop-blur-[3px] [animation:modal-fade_150ms_ease-out]">
      <div className="flex w-[78cqw] flex-col items-center gap-[1.6cqw]">
        <div className="flex flex-col items-center">
          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-0 font-mono text-[5.4cqw] leading-none font-black tracking-[0.14em] text-[#FF7A3D] italic opacity-60 blur-[1.2cqw]"
            >
              {title}
            </div>
            <div className="relative bg-gradient-to-b from-[#FFF6C8] via-[#FFB347] to-[#FF4F8B] bg-clip-text font-mono text-[5.4cqw] leading-none font-black tracking-[0.14em] text-transparent italic [-webkit-text-stroke:0.18cqw_#2A0E3A] [filter:drop-shadow(0_0.35cqw_0_#1A0726)]">
              {title}
            </div>
          </div>
          {note && <div className={`${KR} mt-[0.8cqw] text-[1.2cqw] text-white/60`}>{note}</div>}
        </div>
        <div className="flex w-full items-stretch gap-[1.6cqw]">
          <GoldFrame className="w-[26cqw]">
            <div className="flex flex-col gap-[0.7cqw] p-[1.4cqw]">
              {actions.map((a, i) => (
                <button
                  key={a.label}
                  type="button"
                  onMouseEnter={() => setSel(i)}
                  onClick={() => {
                    sfxUi("ok");
                    a.onClick();
                  }}
                  className={`${TITLE} relative flex cursor-pointer items-center gap-[0.8cqw] rounded-[0.6cqw] px-[1.4cqw] py-[0.8cqw] text-left text-[1.7cqw] tracking-wide transition-colors ${
                    i === sel
                      ? a.danger
                        ? "bg-[#F43F5E] text-white"
                        : "bg-[#F2C35B] text-[#2B1840]"
                      : a.danger
                        ? "bg-white/[0.05] text-[#FDA4AF]"
                        : "bg-white/[0.05] text-white/80"
                  }`}
                >
                  <span className={`text-[1.1cqw] ${i === sel ? "opacity-100" : "opacity-0"}`}>
                    ▶
                  </span>
                  {a.label}
                </button>
              ))}
              <div className="mt-[0.4cqw] text-center font-mono text-[0.95cqw] text-white/40">
                ↑↓ 고르기 · Enter 선택 · Esc 계속
              </div>
            </div>
          </GoldFrame>
          <GoldFrame className="flex-1">
            <div className="border-b border-[#F2C35B]/30 px-[1.6cqw] py-[0.9cqw]">
              <span className={`${TITLE} text-[1.7cqw] tracking-wide text-[#FFE9A8]`}>설정</span>
            </div>
            <div className="p-[1.4cqw]">{settings}</div>
          </GoldFrame>
        </div>
      </div>
    </div>
  );
}
