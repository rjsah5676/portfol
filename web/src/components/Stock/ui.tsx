"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { asset } from "@/lib/poker/assets";
import { CHARS, fmtEok, fmtWon, lookChar, type Face, type Look } from "@/lib/poker/rules";
import { sfx } from "@/lib/stock/sound";

/*
 * 애니메 차트 공용 화면 조각.
 *  분위기: 증권사 HTS — 짙은 남색 바탕에 가는 격자, 숫자는 Barlow, 창마다 작은 제목 띠(Frame), 오름 · 매수 = 빨강, 내림 · 매도 = 파랑.
 *  포커에서 가져온 것: 버튼의 입체감 · 금색 칩(지갑) · 캐릭터 얼굴(표정) · 누름 소리. 포커의 초록 · 금빛 카지노 느낌은 안 씀 — 강조색은 시안(전광판 색).
 */

export const C = {
  bg: "#090D16",
  panel: "#10172A",
  panel2: "#151D33",
  line: "#243052",
  chip: "#1B2440",
  chipLine: "#2F3E66",
  text: "#E8ECF4",
  mute: "#8793AD",
  up: "#FF5C66",
  upBg: "#D9303B",
  down: "#4D8DFF",
  downBg: "#2463D9",
  gold: "#F2C14E",
  goldBg: "#2A2614",
  green: "#4FD1A5",
  cyan: "#3DD6FF",
  cyanBg: "#0C2634",
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

type BtnTone = "plain" | "gold" | "buy" | "sell" | "ghost" | "cyan";
const TONE: Record<BtnTone, CSSProperties> = {
  plain: { background: `linear-gradient(180deg, #273252, ${C.chip})`, border: `1px solid ${C.chipLine}`, color: C.text },
  gold: { background: "linear-gradient(180deg, #FFD978, #E4AE2E)", border: "1px solid #FFE39A", color: "#1A1408", textShadow: "0 1px 0 rgba(255,255,255,0.35)" },
  buy: { background: "linear-gradient(180deg, #FF6B73, #C4232E)", border: "1px solid #FF8A90", color: "#fff", textShadow: "0 1px 0 rgba(0,0,0,0.25)" },
  sell: { background: "linear-gradient(180deg, #5E9CFF, #1F57C6)", border: "1px solid #7FB0FF", color: "#fff", textShadow: "0 1px 0 rgba(0,0,0,0.25)" },
  ghost: { background: "rgba(27,36,64,0.35)", border: `1px solid ${C.chipLine}`, color: C.text },
  cyan: { background: "linear-gradient(180deg, #1A4D66, #0E2E40)", border: `1px solid ${C.cyan}66`, color: C.cyan },
};

/** 버튼 — 누르면 딸깍 소리 (silent 로 끔). 포커 버튼처럼 위가 밝고 아래가 어두운 입체감 */
export function Btn({
  tone = "plain",
  active,
  silent,
  className = "",
  style,
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone; active?: boolean; silent?: boolean }) {
  const s = active ? { background: `linear-gradient(180deg, #3A3418, ${C.goldBg})`, border: `1px solid ${C.gold}`, color: C.gold, boxShadow: `inset 0 0 0 1px ${C.gold}33` } : TONE[tone];
  return (
    <button
      type="button"
      {...rest}
      onClick={(e) => {
        if (!silent) sfx("press");
        onClick?.(e);
      }}
      className={`stk-btn flex cursor-pointer items-center justify-center gap-1 rounded-[8px] font-bold select-none disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
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

/**
 * 안내 캐릭터 — 에이미가 상황에 맞는 표정으로 한마디 (매수 · 급등 · 급락 · 청산 …).
 * 글이 바뀔 때마다 톡 튀어나옴. 포커의 얼굴 · 표정 에셋을 그대로 씀.
 */
export function FaceBubble({ look = "amy", face = "idle", text, size = 40, className = "" }: { look?: Look; face?: Face; text: ReactNode; size?: number; className?: string }) {
  const [k, setK] = useState(0);
  const last = useRef(text);
  useEffect(() => {
    if (last.current !== text) {
      last.current = text;
      setK((x) => x + 1);
    }
  }, [text]);
  return (
    <div className={`flex items-center gap-[8px] ${className}`}>
      <Avatar look={look} face={face} size={size} ring={`${C.cyan}55`} />
      <div key={k} className="stk-pop relative min-w-0 flex-1 rounded-[10px] px-[10px] py-[6px] text-[11px] leading-snug" style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.text }}>
        <span className="absolute top-1/2 -left-[5px] h-[8px] w-[8px] -translate-y-1/2 rotate-45" style={{ background: C.panel2, borderLeft: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }} />
        {text}
      </div>
    </div>
  );
}

/** 바뀔 때 오르면 빨강 · 내리면 파랑으로 잠깐 번쩍이는 숫자 */
export function Num({ value, children, className = "", style }: { value: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (value === prev.current) return;
    setFlash(value > prev.current ? "up" : "down");
    prev.current = value;
    const t = setTimeout(() => setFlash(null), 500);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span key={flash ? `${flash}${value}` : "x"} className={`${NUM} ${flash === "up" ? "stk-num-up" : flash === "down" ? "stk-num-down" : ""} ${className}`} style={style}>
      {children}
    </span>
  );
}

/** 지갑 칩 (포커 금색 칩 + 금액) */
export function WalletChip({ value, label, onClick }: { value: number | null; label?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label ?? "총자산"}
      className={`flex h-[28px] items-center gap-[6px] rounded-full px-[10px] pl-[4px] text-[12px] font-bold ${NUM}`}
      style={{ background: `linear-gradient(180deg, ${C.panel2}, ${C.bg})`, border: `1px solid ${C.chipLine}`, color: C.gold, cursor: onClick ? "pointer" : "default", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" }}
    >
      <img src="/poker/card/chip-gold-top.webp" alt="" draggable={false} className="h-[20px] w-[20px] object-contain" />
      {value === null ? "…" : won(value)}
    </button>
  );
}

/** 상단 바 (40px) — 뒤로 · 제목 · (가운데 내용) · 지갑 · 오른쪽 버튼 */
export function TopBar({ onBack, title, children, right }: { onBack?: () => void; title: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="relative flex h-[40px] shrink-0 items-center gap-[10px] pr-[8px]" style={{ borderBottom: `1px solid ${C.line}`, background: `linear-gradient(180deg, #121A2F, ${C.bg})` }}>
      {onBack ? (
        <button
          type="button"
          aria-label="뒤로"
          onClick={() => {
            sfx("exit");
            onBack();
          }}
          className="flex h-[40px] w-[44px] cursor-pointer items-center justify-center"
          style={{ color: C.text, borderRight: `1px solid ${C.line}` }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      ) : (
        <span className="w-[10px]" />
      )}
      <span className="h-[14px] w-[3px] rounded-full" style={{ background: C.cyan, boxShadow: `0 0 8px ${C.cyan}` }} />
      <div className="-ml-[4px] flex min-w-0 items-center gap-[8px] text-[15px] font-bold whitespace-nowrap">{title}</div>
      {children}
      <div className="flex-1" />
      {right}
      <span className="pointer-events-none absolute right-0 bottom-[-1px] left-0 h-px" style={{ background: `linear-gradient(90deg, ${C.cyan}66, transparent 40%)` }} />
    </div>
  );
}

/** HTS 창 — 작은 제목 띠 + 내용. 오른쪽 패널의 「주문」「보유」「예약」 같은 묶음에 씀 */
export function Frame({ title, right, children, className = "", bodyClass = "", style, accent }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; style?: CSSProperties; accent?: string }) {
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-[8px] ${className}`} style={{ background: C.panel2, border: `1px solid ${C.line}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)", ...style }}>
      <div className="flex h-[20px] shrink-0 items-center gap-[6px] px-[8px] text-[9px] font-black tracking-[0.12em] uppercase" style={{ background: "rgba(0,0,0,0.25)", borderBottom: `1px solid ${C.line}`, color: accent ?? C.cyan }}>
        <span className="h-[6px] w-[6px] rounded-[1px]" style={{ background: accent ?? C.cyan, boxShadow: `0 0 6px ${accent ?? C.cyan}` }} />
        <span className="truncate">{title}</span>
        <span className="flex-1" />
        {right}
      </div>
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
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

/** 화면 위에 뜨는 판 (결과 · 확인 · 설정) — 위 테두리에 금빛 띠 */
export function Sheet({ children, onClose, width = 520, title }: { children: ReactNode; onClose?: () => void; width?: number; title?: ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 p-[12px]" onClick={onClose}>
      <div
        className="stk-pop relative flex max-h-full flex-col overflow-hidden rounded-[14px]"
        style={{ width, maxWidth: "100%", background: `linear-gradient(180deg, #151D33, ${C.panel})`, border: `1px solid ${C.chipLine}`, boxShadow: "0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="pointer-events-none absolute top-0 right-[14px] left-[14px] h-[2px] rounded-b" style={{ background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)` }} />
        {title !== undefined && (
          <div className="flex h-[40px] shrink-0 items-center px-[14px] text-[14px] font-bold" style={{ borderBottom: `1px solid ${C.line}` }}>
            {title}
            <div className="flex-1" />
            {onClose && (
              <button
                type="button"
                aria-label="닫기"
                onClick={() => {
                  sfx("tab");
                  onClose();
                }}
                className="flex h-[32px] w-[32px] cursor-pointer items-center justify-center"
                style={{ color: C.mute }}
              >
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
  const col = tone === "up" ? C.up : tone === "down" ? C.down : tone === "warn" ? C.gold : C.cyan;
  const icon = tone === "up" ? "▲" : tone === "down" ? "▼" : tone === "warn" ? "!" : "●";
  return (
    <div className="pointer-events-none absolute top-[48px] left-1/2 z-50 -translate-x-1/2">
      <div className="stk-toast flex items-center gap-[6px] rounded-full py-[6px] pr-[14px] pl-[8px] text-[12px] font-bold whitespace-nowrap" style={{ background: "rgba(9,13,22,0.94)", border: `1px solid ${col}66`, color: col, boxShadow: `0 6px 24px rgba(0,0,0,0.5), 0 0 12px ${col}22` }}>
        <span className="flex h-[16px] w-[16px] items-center justify-center rounded-full text-[9px]" style={{ background: `${col}22`, border: `1px solid ${col}66` }}>
          {icon}
        </span>
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
