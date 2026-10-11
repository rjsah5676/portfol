"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { RANKS, rankOf, suitOf, type Card } from "@/lib/poker/cards";
import { asset, chipColor } from "@/lib/poker/assets";
import {
  CHARS,
  FACES,
  POSES,
  fmtWon,
  lookChar,
  type Emote,
  type Face,
  type Look,
  type Pose,
  type TierId,
} from "@/lib/poker/rules";

/* 포커 화면의 작은 조각들: 카드 · 칩 · 금액 · 캐릭터(서 있는 그림 · 얼굴 · 이모티콘) */

// ───────────── 카드 ─────────────

/*
 * 카드 무늬는 그림(SVG)으로 그림 — 글꼴 글자(♠♥♦♣)는 OS마다 모양·크기가 달라서 (윈도우 Segoe UI Symbol 은 작고 흐릿하고 클로버가 뭉툭함).
 * 크기는 원래 글자가 차지하던 만큼으로 맞춤.
 */
const SUIT_PATH = [
  // ♠
  "M12 2C9.6 6.2 4.2 9 4.2 13.3a4.1 4.1 0 0 0 6.9 3c-.3 1.9-1 3.5-2.3 4.7V22h6.4v-1c-1.3-1.2-2-2.8-2.3-4.7a4.1 4.1 0 0 0 6.9-3C19.8 9 14.4 6.2 12 2z",
  // ♥
  "M12 21.2C6.3 16.4 2.8 13 2.8 9.2 2.8 6.3 5 4.3 7.5 4.3c1.9 0 3.4 1 4.5 2.7 1.1-1.7 2.6-2.7 4.5-2.7 2.5 0 4.7 2 4.7 4.9 0 3.8-3.5 7.2-9.2 12z",
  // ◆
  "M12 1l6.8 10.2L12 21.4 5.2 11.2z",
  // ♣
  "M12 2.2a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8z M6.3 9.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8z M17.7 9.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8z M10.7 14.6h2.6c.1 2.9.8 5.1 2.1 6.5V22H8.6v-.9c1.3-1.4 2-3.6 2.1-6.5z",
];
/** 7포커 손패 SVG 카드 전용 무늬 */
/** 무늬 (0~100 상자). 스페이드는 뾰족한 머리 + 매끈한 몸통, 클로버는 또렷한 동그라미 셋 — 작게 봐도 안 헷갈리게 */
const FACE_PATH = [
  // ♠
  "M50 3C40 22 8 38 8 60c0 14 10 23 22 23 7 0 13-3 17-9-1 12-5 20-13 24h32c-8-4-12-12-13-24 4 6 10 9 17 9 12 0 22-9 22-23C92 38 60 22 50 3z",
  // ♥
  "M50 93C21 71 5 55 5 34 5 18 17 7 31 7c9 0 15 8 19 17 4-9 10-17 19-17 14 0 26 11 26 27 0 21-16 37-45 59z",
  // ◆
  "M50 2 88 50 50 98 12 50z",
  // ♣
  "M50 6a19 19 0 1 1 0 38 19 19 0 0 1 0-38zM27 39a19 19 0 1 1 0 38 19 19 0 0 1 0-38zM73 39a19 19 0 1 1 0 38 19 19 0 0 1 0-38zM50 44a12 12 0 1 1 0 24 12 12 0 0 1 0-24zM46 60c0 15-4 26-12 35h32c-8-9-12-20-12-35z",
];
/** 무늬 하나 (글자 크기 = 한 변) */
export function Suit({ s }: { s: number }) {
  return (
    <svg viewBox="0 0 24 24" className="pk-suit" fill="currentColor" aria-hidden>
      <path d={SUIT_PATH[s]} />
    </svg>
  );
}
const SUIT_NAME = ["스페이드", "하트", "다이아", "클로버"];

export const cardName = (c: Card) => `${SUIT_NAME[suitOf(c)]} ${RANKS[rankOf(c)]}`;

/**
 * 카드 한 장. 숫자는 크게(모바일에서 멀리서도 읽히게), J·Q·K 는 캐릭터 그림.
 * w = 폭(px). 글자 크기는 전부 폭에 비례.
 */
export function PlayingCard({
  card,
  w = 44,
  tier = 2,
  dim,
  win,
  pick,
  deal,
  delay = 0,
  down,
  covered,
  svg = true,
  className = "",
  style,
}: {
  /** null 이면 뒷면 */
  card: Card | null;
  w?: number;
  tier?: TierId;
  dim?: boolean;
  /** 이긴 5장에 든 카드 */
  win?: boolean;
  /** 7포커 고르기: 버릴 카드 · 펼 카드 표시 */
  pick?: "discard" | "open";
  /** 나눠 주는 움직임 */
  deal?: boolean;
  delay?: number;
  /** 7포커: 내가 엎어 둔 카드 (남은 안 보임) 표시 */
  down?: boolean;
  /** 새 SVG 앞면 (기본). false 면 예전 글자 앞면 */
  svg?: boolean;
  /** 다른 카드에 덮여 모서리만 보임 → 가운데 무늬 · 그림은 안 그림 (겹친 틈으로 조각이 삐져나오지 않게) */
  covered?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const base = {
    "--w": `${w}px`,
    animationDelay: delay ? `${delay}ms` : undefined,
    ...style,
  } as CSSProperties;
  if (card === null) {
    return (
      <span
        aria-label="엎은 카드"
        data-back="1"
        data-dim={dim ? "1" : undefined}
        className={`pk-card ${deal ? "pk-deal" : ""} ${className}`}
        style={{ ...base, backgroundImage: `url(${asset.back(tier)})` } as CSSProperties}
      />
    );
  }
  const rank = rankOf(card);
  const r = RANKS[rank];
  const s = suitOf(card);
  const court = rank >= 9 && rank <= 11;
  return (
    <span
      aria-label={cardName(card)}
      data-red={s === 1 || s === 2 ? "1" : undefined}
      data-dim={dim ? "1" : undefined}
      data-win={win ? "1" : undefined}
      data-pick={pick}
      data-down={down ? "1" : undefined}
      className={`pk-card ${deal ? "pk-deal" : ""} ${className}`}
      style={base}
    >
      {svg ? (
        <CardFace rank={rank} r={r} s={s} court={court} covered={covered} />
      ) : (
        <>
          <span
            className="pk-card-rank"
            style={
              r === "10"
                ? {
                    letterSpacing: "0.02em",
                    fontSize: "calc(var(--w) * 0.46)",
                    left: "calc(var(--w) * 0.05)",
                    top: "calc(var(--w) * 0.08)",
                  }
                : undefined
            }
          >
            {r}
          </span>
          <span className="pk-card-pip">
            <Suit s={s} />
          </span>
          {court ? (
            <img src={asset.court(s, rank)} alt="" draggable={false} className="pk-card-court" />
          ) : rank === 12 ? (
            <span className="pk-card-ace">
              <Suit s={s} />
            </span>
          ) : (
            <span className="pk-card-suit">
              <Suit s={s} />
            </span>
          )}
        </>
      )}
      {down && <span className="pk-card-down">엎음</span>}
    </span>
  );
}

/*
 * 카드 앞면 (100 × 140 상자에 SVG 로): 숫자 크기 · 자리 · 무늬 배치가 52장 모두 같은 규칙.
 *  - 모서리: 왼쪽 위 숫자(얇고 또렷한 좁은 글꼴, 모든 숫자 같은 크기 · 같은 가운데 줄) + 그 아래 작은 무늬, 오른쪽 아래에 뒤집어 하나 더
 *  - 2~10: 정식 무늬 배치 (아래 절반은 뒤집힘) · A: 가운데 큰 무늬 하나 · J Q K: 가운데 틀 안에 캐릭터 그림, 숫자는 양쪽 모서리
 */
// 실제 카드 비율: 모서리 숫자는 작게 가장자리에 붙고, 무늬는 크게 · 넓게 (가로 30% / 70% 두 줄, 세로 21% ~ 79%)
const IDX_X = 15;
// 한게임식: 왼쪽 세로줄은 숫자 · 무늬, 오른쪽 아래 숫자는 없음 → 무늬는 오른쪽 넓은 칸(가로 33~95 · 세로 13~127)에 크게
const COL_L = 47;
const COL_R = 81;
const COL_C = 64;
const PIP = 24;
const Y1 = 17;
const Y4 = 123;
const yAt = (k: number) => Y1 + ((Y4 - Y1) * k) / 6; // 7줄 눈금 (0 ~ 6)
/** 숫자별 무늬 자리 [x, 눈금] — 눈금 3 위로는 바로, 아래로는 뒤집어 그림 */
const PIPS: Record<number, [number, number][]> = {
  2: [[COL_C, 0], [COL_C, 6]],
  3: [[COL_C, 0], [COL_C, 3], [COL_C, 6]],
  4: [[COL_L, 0], [COL_R, 0], [COL_L, 6], [COL_R, 6]],
  5: [[COL_L, 0], [COL_R, 0], [COL_C, 3], [COL_L, 6], [COL_R, 6]],
  6: [[COL_L, 0], [COL_R, 0], [COL_L, 3], [COL_R, 3], [COL_L, 6], [COL_R, 6]],
  7: [[COL_L, 0], [COL_R, 0], [COL_C, 1.5], [COL_L, 3], [COL_R, 3], [COL_L, 6], [COL_R, 6]],
  8: [[COL_L, 0], [COL_R, 0], [COL_C, 1.5], [COL_L, 3], [COL_R, 3], [COL_C, 4.5], [COL_L, 6], [COL_R, 6]],
  9: [[COL_L, 0], [COL_R, 0], [COL_L, 2], [COL_R, 2], [COL_C, 3], [COL_L, 4], [COL_R, 4], [COL_L, 6], [COL_R, 6]],
  10: [[COL_L, 0], [COL_R, 0], [COL_C, 1], [COL_L, 2], [COL_R, 2], [COL_L, 4], [COL_R, 4], [COL_C, 5], [COL_L, 6], [COL_R, 6]],
};

/** 무늬별 높이 맞춤 (그림 상자 안 실제 높이가 달라서 — 스페이드 95 · 하트 86 · 다이아 96 · 클로버 89) → 같은 size 면 네 무늬 키가 같음 */
const SUIT_NORM = [96 / 95, 96 / 86, 1, 96 / 89];
/** 무늬별 폭 맞춤: 네 무늬 모두 폭/키 약 0.91 (스페이드 · 클로버 비율) — 하트는 좁히고 다이아는 넓힘 */
const SUIT_SX = [1, 0.87, 1.15, 1];

function Pip({ s, x, y, size, flip, sx = 1 }: { s: number; x: number; y: number; size: number; flip?: boolean; sx?: number }) {
  const k = (size / 100) * SUIT_NORM[s];
  return (
    <path
      d={FACE_PATH[s]}
      transform={`translate(${x} ${y})${flip ? " rotate(180)" : ""} scale(${k * sx * SUIT_SX[s]} ${k}) translate(-50 -50)`}
    />
  );
}

/** 모서리 글자의 세로 자리 (모든 숫자 같은 높이: 글자 윗선 BASE-CAP ~ 바닥선 BASE) */
const BASE = 37;
const CAP = 28;
const STROKE = 4;

function Index({ r, s }: { r: string; s: number }) {
  const x = IDX_X;
  const top = BASE - CAP;
  const pip = 24;
  return (
    <>
      {r === "4" ? (
        // 정석 4: 닫힌 삼각 머리 + 곧은 기둥 + 가로대
        <path
          d={`M${x + 2.4} ${BASE} V${top + STROKE / 2} L${x - 6.4} ${BASE - 10} H${x + 7.8}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
      ) : r === "Q" ? (
        // 정석 Q: 둥근 O + 오른쪽 아래로 빠지는 꼬리
        <g fill="none" stroke="currentColor" strokeWidth={STROKE}>
          <ellipse cx={x} cy={top + CAP / 2} rx={6.2} ry={CAP / 2 - STROKE / 2} />
          <path d={`M${x + 1} ${BASE - 8} L${x + 5.8} ${BASE - 1.8}`} strokeLinecap="round" />
        </g>
      ) : r === "A" ? (
        // A: 가운데 가로대를 조금 높게 (글꼴 A 는 가로대가 낮음)
        (() => {
          const hw = 6.4;
          const yb = BASE - 10.5;
          const bw = (hw * (yb - top)) / CAP - STROKE * 0.35;
          return (
            <g fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round">
              <path d={`M${x - hw} ${BASE - 0.2} L${x} ${top + STROKE / 2} L${x + hw} ${BASE - 0.2}`} />
              <path d={`M${x - bw} ${yb} H${x + bw}`} />
            </g>
          );
        })()
      ) : r === "10" ? (
        // 10: 다른 숫자와 같은 높이, 폭만 칸에 맞춰 눌러 담음
        <text x={x} y={BASE} className="pk-idx" textAnchor="middle" textLength={19.5} lengthAdjust="spacingAndGlyphs">
          10
        </text>
      ) : (
        <text x={x} y={BASE} className="pk-idx" textAnchor="middle">
          {r}
        </text>
      )}
      {/* 모서리 무늬는 가운데 무늬보다 크게 (겹쳐 놓았을 때 이것만 보이니까) */}
      {/* 다이아는 높이만 크게, 폭은 가운데 무늬와 같게 (넓적해 보이지 않게) */}
      <Pip s={s} x={x} y={54} size={pip} />
    </>
  );
}

function CardFace({ rank, r, s, court, covered }: { rank: number; r: string; s: number; court: boolean; covered?: boolean }) {
  const n = rank + 2; // 2 ~ 14 (A)
  return (
    <svg viewBox="0 0 100 140" className="pk-face" fill="currentColor" aria-hidden>
      <g className={covered ? "pk-face-in pk-face-in-off" : "pk-face-in"}>
      {court ? (
        <>
          <clipPath id={`cc-${rank}-${s}`}>
            <rect x={31} y={6} width={63} height={128} rx={4} />
          </clipPath>
          <image
            href={asset.court(s, rank)}
            x={31}
            y={6}
            width={63}
            height={128}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#cc-${rank}-${s})`}
          />
          <rect x={31} y={6} width={63} height={128} rx={4} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.9} />
        </>
      ) : n === 14 ? (
        // A: 오른쪽 아래에 큰 무늬 하나 (한게임처럼)
        <Pip s={s} x={62} y={96} size={s === 1 ? 50 : 56} />
      ) : (
        PIPS[n].map(([x, k], i) => <Pip key={i} s={s} x={x} y={yAt(k)} size={PIP} />)
      )}
      </g>
      <Index r={r} s={s} />
    </svg>
  );
}

// ───────────── 금액 · 칩 ─────────────

/** 금액: 숫자는 굵은 숫자 글꼴, 억·만은 작게 */
export function Money({
  won,
  className = "",
  sign,
}: {
  won: number;
  className?: string;
  sign?: boolean;
}) {
  const text = fmtWon(Math.abs(won));
  const parts = text.split(/(억|만)/).filter(Boolean);
  return (
    <span className={`pk-num whitespace-nowrap ${className}`}>
      {sign && won > 0 ? "+" : won < 0 ? "−" : ""}
      {parts.map((p, i) =>
        p === "억" || p === "만" ? (
          <span
            key={i}
            className="mr-[0.18em] ml-[0.04em] font-['Nanum_Gothic',sans-serif] text-[0.62em] font-bold opacity-80 last:mr-0"
          >
            {p}
          </span>
        ) : (
          <span key={i}>{p.trim()}</span>
        )
      )}
    </span>
  );
}

/** 건 돈: 칩 그림 + (행동 이름) + 금액. ratio = 기준 판돈의 몇 배인지 (칩 색), act = 마지막 행동 (테두리 색 · 이름) */
const BET_ACT: Record<string, [string, string]> = {
  call: ["콜", "#22c08a"],
  check: ["체크", "#22c08a"],
  bet: ["벳", "#ff9a2e"],
  raise: ["레이즈", "#ff9a2e"],
  allin: ["올인", "#ffd23f"],
  bbing: ["삥", "#4d8dff"],
  ddadang: ["따당", "#2cc4c4"],
  quarter: ["쿼터", "#ff9a2e"],
  half: ["하프", "#ff4d63"],
  full: ["풀", "#a879ff"],
  sb: ["SB", "#9aa3b5"],
  bb: ["BB", "#9aa3b5"],
  ante: ["판돈", "#9aa3b5"],
};
export function Bet({
  won,
  ratio,
  size = 22,
  act,
  className = "",
}: {
  won: number;
  ratio: number;
  size?: number;
  act?: string;
  className?: string;
}) {
  const color = chipColor(ratio);
  const kind = ratio >= 8 ? "stack" : ratio >= 2 ? "side" : "top";
  const tag = act ? BET_ACT[act] : undefined;
  return (
    <span
      key={won}
      className={`pk-pop pk-bet inline-flex items-center ${className}`}
      style={tag ? { borderColor: tag[1] } : undefined}
    >
      {}
      <img
        src={asset.chip(color, kind)}
        alt=""
        draggable={false}
        style={{ width: size * 1.25, height: size * 1.25 }}
      />
      <span className="flex flex-col items-start leading-none">
        {tag && (
          <span className="pk-bet-act" style={{ color: tag[1] }}>
            {tag[0]}
          </span>
        )}
        <Money won={won} className="text-[#fff3c4]" />
      </span>
    </span>
  );
}

/** 팟: 칩 더미 그림 (금액이 클수록 색이 세짐) */
/**
 * 팟 옆에 실제로 쌓이는 칩 더미. 판돈 대비 팟 크기에 따라 칩 개수가 늘어나고(로그 비율, 최대 40개),
 * 큰 색부터 기둥(최대 8개)으로 쌓음. 새로 생긴 칩만 위에서 툭 떨어짐 (key 가 그대로인 칩은 다시 안 움직임).
 */
const PILE_COLORS = ["white", "red", "blue", "green", "black", "gold"] as const;
export function PotPile({
  amount,
  base,
  size = 30,
}: {
  amount: number;
  base: number;
  size?: number;
}) {
  const ratio = amount / Math.max(1, base);
  const total = amount > 0 ? Math.min(40, Math.max(2, Math.round(6 * Math.log2(1 + ratio)))) : 0;
  const top = PILE_COLORS.indexOf(chipColor(ratio));
  const cols: { color: (typeof PILE_COLORS)[number]; n: number; key: string }[] = [];
  let left = total;
  // 제일 큰 색 기둥부터, 한 단계씩 작은 색으로 (색이 바닥나면 다시 위에서)
  for (let c = 0; left > 0 && c < 6; c++) {
    const color = PILE_COLORS[Math.max(0, top - (c % (top + 1)))];
    const n = Math.min(8, left);
    cols.push({ color, n, key: `c${c}` });
    left -= n;
  }
  const shown = cols.slice(0, 6);
  if (!shown.length) return null;
  const step = size * 0.17;
  const gap = size * 0.62;
  return (
    <span
      className="pk-pile relative block shrink-0"
      style={{ width: gap * (shown.length - 1) + size, height: size }}
      aria-hidden
    >
      {shown.map((col, ci) =>
        Array.from({ length: col.n }, (_, j) => (
          <img
            key={`${col.key}-${j}`}
            src={asset.chip(col.color, "side")}
            alt=""
            draggable={false}
            className="pk-chipdrop absolute"
            style={{
              width: size,
              height: size,
              left: ci * gap,
              bottom: j * step,
              zIndex: j + 1,
              animationDelay: `${(ci * 2 + j) * 18}ms`,
            }}
          />
        ))
      )}
    </span>
  );
}

export function PotChips({ ratio, size = 40 }: { ratio: number; size?: number }) {
  const colors: ("white" | "red" | "blue" | "green" | "black" | "gold")[] = [
    "white",
    "red",
    "blue",
    "green",
    "black",
    "gold",
  ];
  const top = colors.indexOf(chipColor(ratio));
  const shown = colors.slice(Math.max(0, top - 2), top + 1);
  return (
    <span
      className="relative inline-flex shrink-0 items-end"
      style={{ height: size, width: size * (0.6 + shown.length * 0.5) }}
      aria-hidden
    >
      {shown.map((c, i) => (
        <img
          key={c}
          src={asset.chip(c, "stack")}
          alt=""
          draggable={false}
          className="absolute bottom-0"
          style={{ width: size, height: size, left: i * size * 0.5, zIndex: i }}
        />
      ))}
    </span>
  );
}

// ───────────── 캐릭터 ─────────────

/**
 * 7포커 자리 캐릭터 (앉은 정면 상반신). 모든 포즈 그림을 겹쳐 두고 지금 포즈만 보여 줘서 바뀔 때 깜빡이지 않음.
 * 숨쉬기 · 포즈별 작은 움직임은 CSS (pk-pose-*).
 */
export function CharSprite({
  char,
  pose,
  flip,
  dim,
  w,
  className = "",
  style,
}: {
  char: Look;
  pose: Pose;
  /** 앉은 정면 그림만 (옆모습 · 서 있는 그림은 정리함) — 예전 호출 호환용 */
  seat?: "front";
  flip?: boolean;
  dim?: boolean;
  /** 폭(px). 높이는 4:3 → w*4/3 */
  w: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`pk-sprite ${className}`}
      data-pose={pose}
      data-dim={dim ? "1" : undefined}
      style={{
        width: w,
        height: Math.round((w * 4) / 3),
        transform: flip ? "scaleX(-1)" : undefined,
        ...style,
      }}
      aria-hidden
    >
      {POSES.map((p) => (
        <img
          key={p}
          src={asset.seat(char, "front", p)}
          alt=""
          draggable={false}
          data-on={p === pose ? "1" : undefined}
        />
      ))}
    </span>
  );
}

/** 이름표의 얼굴 (표정이 바뀌면 부드럽게) */
export function FaceIcon({
  char,
  face = "idle",
  size = 40,
  className = "",
  ring,
}: {
  char: Look;
  face?: Face;
  size?: number;
  className?: string;
  ring?: string;
}) {
  return (
    <span
      className={`pk-face relative inline-flex shrink-0 overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: CHARS[lookChar(char)].color,
        boxShadow: ring,
      }}
      aria-hidden
    >
      {FACES.map((f) => (
        <img
          key={f}
          src={asset.face(char, f)}
          alt=""
          draggable={false}
          data-on={f === face ? "1" : undefined}
        />
      ))}
    </span>
  );
}

/** 프로필 (로비 · 순위 · 채팅) */
export function Profile({
  char,
  size = 36,
  className = "",
}: {
  char: Look;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={asset.profile(char)}
      alt={CHARS[lookChar(char)].name}
      draggable={false}
      className={`shrink-0 rounded-full object-cover ${className}`}
      style={{ width: size, height: size, background: CHARS[lookChar(char)].color }}
    />
  );
}

export function EmoteImg({
  char,
  emote,
  size = 72,
  className = "",
}: {
  char: Look;
  emote: Emote;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={asset.emote(char, emote)}
      alt={emote}
      draggable={false}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}

/** 올인 컷인: 화면을 가로지르는 띠 (한 번 보이고 사라짐) */
export function CutIn({
  char,
  name,
  onDone,
  top = "50%",
}: {
  char: Look;
  name: string;
  onDone: () => void;
  top?: number | string;
}) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const id = setTimeout(() => done.current(), 1700);
    return () => clearTimeout(id);
  }, [char]);
  // 테이블 가운데를 가로지르는 띠: 왼쪽 캐릭터 컷 + 오른쪽 ALL IN!
  return (
    <div
      className="pk-cutin pointer-events-none absolute inset-x-0 z-50"
      style={{ top }}
      aria-hidden
    >
      <div className="pk-cutin-band">
        {}
        <img src={asset.cutin(char)} alt="" draggable={false} className="pk-cutin-img" />
        <div className="pk-cutin-text">
          <span className="pk-gold pk-title">ALL IN!</span>
          <span className="pk-cutin-name">{name}</span>
        </div>
      </div>
    </div>
  );
}

/** 사라지는 숫자 (+금액) */
export function Rise({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`pk-rise pk-num pointer-events-none whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

/** 시간 고리 (square = 둥근 사각 틀을 따라) */
export function TimerRing({
  size,
  frac,
  width = 4,
  square,
}: {
  size: number;
  frac: number;
  width?: number;
  square?: boolean;
}) {
  const color = frac > 0.5 ? "var(--pk-call)" : frac > 0.2 ? "var(--pk-raise)" : "var(--pk-danger)";
  const pad = width + 2;
  const box = size + pad * 2;
  if (square) {
    const side = size + width;
    const len = side * 4;
    return (
      <svg
        className="pointer-events-none absolute"
        style={{ left: -pad + 2, top: -pad + 2 }}
        width={box}
        height={box}
        aria-hidden
      >
        <rect
          x={pad - width / 2}
          y={pad - width / 2}
          width={side}
          height={side}
          rx={12}
          fill="none"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth={width}
        />
        <rect
          x={pad - width / 2}
          y={pad - width / 2}
          width={side}
          height={side}
          rx={12}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          pathLength={len}
          strokeDasharray={len}
          strokeDashoffset={len * (1 - frac)}
        />
      </svg>
    );
  }
  const r = size / 2 + width / 2 + 1;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="pointer-events-none absolute -rotate-90"
      style={{ inset: -pad }}
      width={box}
      height={box}
      aria-hidden
    >
      <circle
        cx={size / 2 + pad}
        cy={size / 2 + pad}
        r={r}
        fill="none"
        stroke="rgba(0,0,0,0.55)"
        strokeWidth={width}
      />
      <circle
        cx={size / 2 + pad}
        cy={size / 2 + pad}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
      />
    </svg>
  );
}

/** 요소의 크기를 잼 (ref 를 붙인 요소가 나중에 생겨도 됨) */
export function useSize<T extends HTMLElement>(): [
  (el: T | null) => void,
  { w: number; h: number },
] {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const roRef = useRef<ResizeObserver | null>(null);
  const attach = useCallback((el: T | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const apply = (width: number, height: number) =>
      setSize((s) =>
        Math.abs(s.w - width) < 1 && Math.abs(s.h - height) < 1 ? s : { w: width, h: height }
      );
    const ro = new ResizeObserver(([e]) => apply(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    roRef.current = ro;
    apply(el.clientWidth, el.clientHeight);
  }, []);
  return [attach, size];
}
