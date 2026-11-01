"use client";

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { asset } from "@/lib/poker/assets";
import { CHARS, fmtEok, fmtWon, lookChar, type Face, type Look } from "@/lib/poker/rules";

/*
 * 주식 마을 공용 화면 조각 — 마을 · 거래 화면이 같은 상단 바 · 지갑 칩 · 글꼴 · 금색 강조를 씀.
 * 색은 국내 관례: 오름 · 매수 = 빨강, 내림 · 매도 = 파랑.
 */

export const C = {
  bg: "#0F1420",
  panel: "#161D2D",
  panel2: "#1A2133",
  line: "#263049",
  chip: "#1E2740",
  chipLine: "#33406A",
  text: "#E8ECF4",
  mute: "#8B95AB",
  up: "#FF5C66",
  upBg: "#D9303B",
  down: "#4D8DFF",
  downBg: "#2463D9",
  gold: "#F2C14E",
  goldBg: "#2A2614",
  green: "#4FD1A5",
  ma: { 5: "#F2C14E", 10: "#FF9F43", 20: "#C77DFF", 60: "#4FD1A5", 120: "#5BA8FF" } as Record<number, string>,
};

export const FONT = "font-['Nanum_Gothic',sans-serif]";
export const NUM = "font-['Barlow',sans-serif] tabular-nums";
export const TITLE = "font-['Black_Han_Sans',sans-serif]";

/** 금액: 1억 2,340만 */
export const won = (n: number) => fmtEok(n);
export const wonFull = (n: number) => fmtWon(n);
export const comma = (n: number) => Math.round(n).toLocaleString("ko-KR");
export const pct = (r: number, d = 1) => `${r >= 0 ? "+" : ""}${(r * 100).toFixed(d)}%`;
export const signColor = (v: number) => (v > 0 ? C.up : v < 0 ? C.down : C.mute);
/** 받침에 맞는 조사: josa("연예", "을", "를") → "연예를" */
export function josa(word: string, withBatchim: string, without: string): string {
  const c = word.charCodeAt(word.length - 1);
  const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : /[0-9LMNR]$/i.test(word) && !/[2459]$/.test(word);
  return word + (has ? withBatchim : without);
}
/** "~(으)로": 받침 없거나 ㄹ 받침이면 "로" (트레이딩 홀로 · 증권거래소로 · 부동산으로) */
export function ro(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  const b = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
  return word + (b === 0 || b === 8 ? "로" : "으로");
}
export const mult = (m: number) => `${m >= 10 ? m.toFixed(1) : m.toFixed(2)}배`;

type BtnTone = "plain" | "gold" | "buy" | "sell" | "ghost";
const TONE: Record<BtnTone, CSSProperties> = {
  plain: { background: C.chip, border: `1px solid ${C.chipLine}`, color: C.text },
  gold: { background: C.gold, border: `1px solid ${C.gold}`, color: "#1A1408" },
  buy: { background: C.upBg, border: `1px solid ${C.upBg}`, color: "#fff" },
  sell: { background: C.downBg, border: `1px solid ${C.downBg}`, color: "#fff" },
  ghost: { background: "transparent", border: `1px solid ${C.chipLine}`, color: C.text },
};

export function Btn({
  tone = "plain",
  active,
  className = "",
  style,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone; active?: boolean }) {
  const s = active ? { background: C.goldBg, border: `1px solid ${C.gold}`, color: C.gold } : TONE[tone];
  return (
    <button
      type="button"
      {...rest}
      className={`flex cursor-pointer items-center justify-center gap-1 rounded-[8px] font-bold transition-[filter,transform] select-none hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      style={{ ...s, ...style }}
    >
      {children}
    </button>
  );
}

/** 캐릭터 얼굴 (포커 캐릭터 · 표정) */
export function Avatar({ look, size = 28, face, ring, className = "" }: { look: Look; size?: number; face?: Face; ring?: string; className?: string }) {
  const ch = CHARS[lookChar(look)];
  return (
    <img
      src={face ? asset.face(look, face) : asset.profile(look)}
      alt={ch?.name ?? ""}
      draggable={false}
      className={`shrink-0 rounded-full object-cover ${className}`}
      style={{ width: size, height: size, background: ch?.color ?? C.chip, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}
    />
  );
}

/** 지갑 칩 (금색 동전 + 금액) */
export function WalletChip({ value, label, onClick }: { value: number | null; label?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label ?? "총자산"}
      className={`flex h-[28px] items-center gap-[6px] rounded-full px-[10px] pl-[6px] text-[12px] font-bold ${NUM}`}
      style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.text, cursor: onClick ? "pointer" : "default" }}
    >
      <span aria-hidden className="inline-block h-[16px] w-[16px] rounded-full" style={{ background: `radial-gradient(circle at 35% 35%, #FFE7A0, ${C.gold} 60%, #B8862A)` }} />
      {value === null ? "…" : won(value)}
    </button>
  );
}

/** 상단 바 (40px) — 뒤로 · 제목 · (가운데 내용) · 지갑 · 오른쪽 버튼 */
export function TopBar({ onBack, title, children, right }: { onBack?: () => void; title: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-[40px] shrink-0 items-center gap-[10px] pr-[8px]" style={{ borderBottom: `1px solid ${C.line}`, background: C.bg }}>
      {onBack ? (
        <button type="button" aria-label="뒤로" onClick={onBack} className="flex h-[40px] w-[44px] cursor-pointer items-center justify-center" style={{ color: C.text }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      ) : (
        <span className="w-[10px]" />
      )}
      <div className="flex min-w-0 items-center gap-[8px] text-[15px] font-bold whitespace-nowrap">{title}</div>
      {children}
      <div className="flex-1" />
      {right}
    </div>
  );
}

export function Pill({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className={`rounded-full px-[10px] py-[3px] text-[12px] font-bold whitespace-nowrap ${NUM}`} style={{ background: C.chip, border: `1px solid ${color ?? C.chipLine}`, color: color ?? C.text }}>
      {children}
    </span>
  );
}

/** 화면 위에 뜨는 판 (결과 · 확인 · 설정) */
export function Sheet({ children, onClose, width = 520, title }: { children: ReactNode; onClose?: () => void; width?: number; title?: ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-[12px]" onClick={onClose}>
      <div
        className="stk-pop flex max-h-full flex-col overflow-hidden rounded-[14px]"
        style={{ width, maxWidth: "100%", background: C.panel, border: `1px solid ${C.line}`, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="flex h-[40px] shrink-0 items-center px-[14px] text-[14px] font-bold" style={{ borderBottom: `1px solid ${C.line}` }}>
            {title}
            <div className="flex-1" />
            {onClose && (
              <button type="button" aria-label="닫기" onClick={onClose} className="flex h-[32px] w-[32px] cursor-pointer items-center justify-center" style={{ color: C.mute }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** 잠깐 뜨는 알림 */
export function Toast({ text, tone = "plain" }: { text: string; tone?: "plain" | "up" | "down" | "warn" }) {
  const col = tone === "up" ? C.up : tone === "down" ? C.down : tone === "warn" ? C.gold : C.text;
  return (
    <div className="pointer-events-none absolute top-[48px] left-1/2 z-50 -translate-x-1/2">
      <div className="stk-toast rounded-full px-[14px] py-[6px] text-[12px] font-bold whitespace-nowrap" style={{ background: "rgba(10,13,22,0.92)", border: `1px solid ${col}55`, color: col }}>
        {text}
      </div>
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="flex h-full items-center justify-center p-[20px] text-center text-[12px]" style={{ color: C.mute }}>
    {children}
  </div>
);
