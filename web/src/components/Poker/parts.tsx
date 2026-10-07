"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { API_URL } from "@/lib/api/config";
import { RANKS, rankOf, suitOf, type Card } from "@/lib/poker/cards";
import { fmtWon, type BotId } from "@/lib/poker/rules";

/* 포커 화면의 작은 조각들: 카드 · 칩 · 금액 · 초상 */

// ───────────── 카드 ─────────────

const SUIT_GLYPH = ["♠︎", "♥︎", "♦︎", "♣︎"];
const SUIT_NAME = ["스페이드", "하트", "다이아", "클로버"];
/** 단계별 카드 뒷면 색 */
const BACKS: Record<number, [string, string]> = {
  1: ["#7a4a2b", "#4d2c17"],
  2: ["#2f4fa3", "#1b2f6b"],
  3: ["#1c1b20", "#0b0a0d"],
};

export const cardName = (c: Card) => `${SUIT_NAME[suitOf(c)]} ${RANKS[rankOf(c)]}`;

export function PlayingCard({
  card,
  w = 44,
  tier = 2,
  dim,
  win,
  pick,
  deal,
  delay = 0,
  className = "",
  style,
}: {
  /** null 이면 뒷면 */
  card: Card | null;
  /** 폭(px) */
  w?: number;
  tier?: number;
  dim?: boolean;
  /** 이긴 5장에 든 카드 */
  win?: boolean;
  /** 7포커 고르기: 버릴 카드 · 펼 카드 표시 */
  pick?: "discard" | "open";
  /** 나눠 주는 움직임 */
  deal?: boolean;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const base = { "--w": `${w}px`, animationDelay: delay ? `${delay}ms` : undefined, ...style } as CSSProperties;
  if (card === null) {
    const [a, b] = BACKS[tier] ?? BACKS[2];
    return (
      <span
        aria-label="엎은 카드"
        data-back="1"
        data-dim={dim ? "1" : undefined}
        className={`pk-card ${deal ? "pk-deal" : ""} ${className}`}
        style={{ ...base, "--back": a, "--back-deep": b } as CSSProperties}
      />
    );
  }
  const r = RANKS[rankOf(card)];
  const s = suitOf(card);
  return (
    <span
      aria-label={cardName(card)}
      data-red={s === 1 || s === 2 ? "1" : undefined}
      data-dim={dim ? "1" : undefined}
      data-win={win ? "1" : undefined}
      data-pick={pick}
      className={`pk-card ${deal ? "pk-deal" : ""} ${className}`}
      style={base}
    >
      <span className="pk-card-rank" style={r === "10" ? { letterSpacing: "-0.09em" } : undefined}>
        {r}
      </span>
      <span className="pk-card-pip">{SUIT_GLYPH[s]}</span>
      <span className="pk-card-suit">{SUIT_GLYPH[s]}</span>
    </span>
  );
}

// ───────────── 금액 ─────────────

/** 금액: 숫자는 굵은 숫자 글꼴, 억·만은 작게 */
export function Money({ won, className = "", sign }: { won: number; className?: string; sign?: boolean }) {
  const text = fmtWon(Math.abs(won));
  const parts = text.split(/(억|만)/).filter(Boolean);
  return (
    <span className={`pk-num whitespace-nowrap ${className}`}>
      {sign && won > 0 ? "+" : won < 0 ? "−" : ""}
      {parts.map((p, i) =>
        p === "억" || p === "만" ? (
          <span key={i} className="mr-[0.18em] ml-[0.04em] font-['Nanum_Gothic',sans-serif] text-[0.62em] font-bold opacity-80 last:mr-0">
            {p}
          </span>
        ) : (
          <span key={i}>{p.trim()}</span>
        )
      )}
    </span>
  );
}

/** 칩 더미: 금액이 클수록 색이 바뀜 (기준 판돈의 몇 배인지) */
export function Chips({ ratio, className = "" }: { ratio: number; className?: string }) {
  const color = ratio >= 100 ? "#1f1f24" : ratio >= 25 ? "#9a4fd1" : ratio >= 5 ? "#d13b3b" : ratio >= 1 ? "#3c7fd1" : "#e7b95b";
  const n = ratio >= 25 ? 3 : ratio >= 3 ? 2 : 1;
  return (
    <span className={`relative inline-flex ${className}`} style={{ width: "1em", height: `${1 + (n - 1) * 0.22}em` }} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="pk-chip absolute left-0" style={{ "--c": color, bottom: `${i * 0.22}em` } as CSSProperties} />
      ))}
    </span>
  );
}

// ───────────── 초상 ─────────────
// 봇 4명은 임시 그림 (나중에 받은 일러스트로 교체: BotFace 만 바꾸면 됨)

const SKIN = { gunmo: "#f0c9a0", chunhee: "#efc29a", deokpal: "#e2b48c", yeonseo: "#f3d0b0" };
const BG: Record<BotId, string> = { gunmo: "#2b3a67", chunhee: "#8c3b4a", deokpal: "#4e5a3c", yeonseo: "#1f6b70" };

function BotFace({ id }: { id: BotId }) {
  const skin = SKIN[id];
  const eye = (x: number, y = 30) => <circle cx={x} cy={y} r="1.9" fill="#1b1b1f" />;
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
      <rect width="64" height="64" fill={BG[id]} />
      {id === "gunmo" && (
        <>
          {/* 회색 후드 · 짧은 검은 머리 · 뿔테 안경 */}
          <path d="M8 64c0-14 10-20 24-20s24 6 24 20z" fill="#8f96a3" />
          <path d="M24 46c2 5 14 5 16 0l-2-6H26z" fill={skin} />
          <path d="M22 50l10 8 10-8" fill="none" stroke="#6f7683" strokeWidth="2.5" strokeLinecap="round" />
          <ellipse cx="32" cy="30" rx="13" ry="15" fill={skin} />
          <path d="M18 28c-1-13 8-18 16-18 9 0 14 6 13 17-3-6-8-9-16-9-6 0-10 3-13 10z" fill="#1c1c22" />
          {eye(26.5)}
          {eye(37.5)}
          <rect x="21" y="26" width="10" height="8" rx="2.5" fill="none" stroke="#1b1b1f" strokeWidth="1.6" />
          <rect x="33" y="26" width="10" height="8" rx="2.5" fill="none" stroke="#1b1b1f" strokeWidth="1.6" />
          <path d="M31 29h2" stroke="#1b1b1f" strokeWidth="1.6" />
          <path d="M28 39q4 2 8 0" fill="none" stroke="#9b5a4a" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
      {id === "chunhee" && (
        <>
          {/* 겨자색 카디건 · 볼륨 있는 짧은 파마머리 · 귀걸이 */}
          <path d="M6 64c0-14 11-20 26-20s26 6 26 20z" fill="#d9a441" />
          <path d="M26 46h12l-6 9z" fill="#f4ead8" />
          <g fill="#3a2620">
            <circle cx="20" cy="22" r="8" />
            <circle cx="30" cy="15" r="9" />
            <circle cx="41" cy="18" r="8.5" />
            <circle cx="46" cy="28" r="7" />
            <circle cx="17" cy="31" r="6.5" />
          </g>
          <ellipse cx="32" cy="32" rx="12.5" ry="14" fill={skin} />
          <path d="M20 27c3-7 9-9 14-8 5 0 9 3 11 8-5-2-8-4-10-6-3 3-8 5-15 6z" fill="#3a2620" />
          {eye(27, 32)}
          {eye(37, 32)}
          <path d="M24 28.5q3-2 6 0M34 28.5q3-2 6 0" fill="none" stroke="#3a2620" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="24" cy="37" r="2.6" fill="#e8958a" opacity="0.55" />
          <circle cx="40" cy="37" r="2.6" fill="#e8958a" opacity="0.55" />
          <path d="M27 40q5 4 10 0" fill="none" stroke="#b0483f" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="19.5" cy="38" r="1.8" fill="#f6e3a1" />
          <circle cx="44.5" cy="38" r="1.8" fill="#f6e3a1" />
        </>
      )}
      {id === "deokpal" && (
        <>
          {/* 갈색 조끼 · 헌팅캡 · 흰 눈썹과 콧수염 */}
          <path d="M8 64c0-14 10-20 24-20s24 6 24 20z" fill="#e9e3d2" />
          <path d="M8 64c0-13 8-19 17-20l7 20zM56 64c0-13-8-19-17-20l-7 20z" fill="#6b4a2f" />
          <ellipse cx="32" cy="32" rx="13" ry="14.5" fill={skin} />
          <path d="M19 30c0-3 1-5 2-6M45 30c0-3-1-5-2-6" stroke="#eeeae0" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M15 24c2-10 10-14 18-14 9 0 16 5 17 13-9-3-25-3-35 1z" fill="#5a4636" />
          <path d="M14 24.5c8-4 30-5 40-1.500l1 3c-12-3-30-3-42 1z" fill="#463627" />
          {eye(26.5, 32)}
          {eye(37.5, 32)}
          <path d="M22.500 28.500l7-1M41.500 28.500l-7-1" stroke="#f4f1ea" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M24 40c3-3 6-1 8 0 2-1 5-3 8 0-2 2-5 2-8 1-3 1-6 1-8-1z" fill="#f4f1ea" />
          <path d="M22 35q-2 1-2 3M42 35q2 1 2 3" fill="none" stroke="#b98e68" strokeWidth="1" strokeLinecap="round" />
        </>
      )}
      {id === "yeonseo" && (
        <>
          {/* 검은 블루종 · 긴 생머리와 앞머리 · 붉은 입술 */}
          <path d="M16 20c0-9 8-12 16-12s16 3 16 12v32H16z" fill="#231a1e" />
          <path d="M8 64c0-13 10-19 24-19s24 6 24 19z" fill="#17171b" />
          <path d="M26 46h12l-6 8z" fill="#f6f1ea" />
          <path d="M32 54v10" stroke="#3a3a42" strokeWidth="1.5" />
          <ellipse cx="32" cy="31" rx="12" ry="14.500" fill={skin} />
          <path d="M19.500 30c-1-9 5-14 12.500-14s13.500 5 12.500 14c-3-5-6-8-8-8.500-5 4-11 6-17 8.500z" fill="#231a1e" />
          {eye(27, 32)}
          {eye(37, 32)}
          <path d="M24 30l4.500-1.500M40 30l-4.500-1.500" stroke="#231a1e" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M28.500 40q3.500 2.500 7 0" fill="#c8373b" stroke="#c8373b" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="24.500" cy="37" r="2.2" fill="#f0a39a" opacity="0.5" />
          <circle cx="39.500" cy="37" r="2.2" fill="#f0a39a" opacity="0.5" />
        </>
      )}
    </svg>
  );
}

/** 자리 주인의 얼굴: 봇은 그림, 사람은 올린 사진 → 없으면 별명 첫 글자 */
export function Portrait({
  bot,
  name,
  avatar,
  size = 56,
  className = "",
  children,
}: {
  bot: BotId | null;
  name: string;
  avatar?: string | null;
  size?: number;
  className?: string;
  children?: ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#2a2d35] ${className}`}
      style={{ width: size, height: size }}
    >
      {bot ? (
        <BotFace id={bot} />
      ) : avatar && !broken ? (
        <img src={`${API_URL}${avatar}`} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#6C63FF,#2DD4BF)] font-['Nanum_Gothic',sans-serif] font-bold text-white"
          style={{ fontSize: size * 0.42 }}
        >
          {[...name][0] ?? "?"}
        </span>
      )}
      {children}
    </span>
  );
}
