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
/** 무늬 (0~100 상자). 스페이드는 뾰족한 머리 + 매끈한 몸통, 클로버는 또렷한 동그라미 셋 — 작게 봐도 안 헷갈리게 */
const SUIT_PATH = [
  // ♠
  "M50 3C40 22 8 38 8 60c0 14 10 23 22 23 7 0 13-3 17-9-1 10-5 17-13 21h32c-8-4-12-11-13-21 4 6 10 9 17 9 12 0 22-9 22-23C92 38 60 22 50 3z",
  // ♥
  "M50 93C21 71 5 55 5 34 5 18 17 7 31 7c9 0 15 5 19 13 4-8 10-13 19-13 14 0 26 11 26 27 0 21-16 37-45 59z",
  // ◆
  "M50 2 88 50 50 98 12 50z",
  // ♣
  "M50 6a19 19 0 1 1 0 38 19 19 0 0 1 0-38zM27 39a19 19 0 1 1 0 38 19 19 0 0 1 0-38zM73 39a19 19 0 1 1 0 38 19 19 0 0 1 0-38zM50 44a12 12 0 1 1 0 24 12 12 0 0 1 0-24zM46 60c0 15-4 26-12 35h32c-8-9-12-20-12-35z",
];
/** 무늬 하나 (글자 크기 = 한 변) */
export function Suit({ s }: { s: number }) {
  return (
    <svg viewBox="0 0 100 100" className="pk-suit" fill="currentColor" aria-hidden>
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
      <CardFace rank={rank} r={r} s={s} court={court} />
      {down && <span className="pk-card-down">엎음</span>}
    </span>
  );
}

/*
 * 카드 앞면 (100 × 140 상자에 SVG 로): 숫자 크기 · 자리 · 무늬 배치가 52장 모두 같은 규칙.
 *  - 모서리: 왼쪽 위 숫자(얇고 또렷한 좁은 글꼴, 모든 숫자 같은 크기 · 같은 가운데 줄) + 그 아래 작은 무늬, 오른쪽 아래에 뒤집어 하나 더
 *  - 2~10: 정식 무늬 배치 (아래 절반은 뒤집힘) · A: 가운데 큰 무늬 하나 · J Q K: 캐릭터 그림
 */
const IDX_X = 14;
const COL_L = 39;
const COL_R = 61;
const PIP = 16;
const Y1 = 26;
const Y4 = 114;
const yAt = (k: number) => Y1 + ((Y4 - Y1) * k) / 6; // 7줄 눈금 (0 ~ 6)
/** 숫자별 무늬 자리 [x, 눈금] — 눈금 3 위로는 바로, 아래로는 뒤집어 그림 */
const PIPS: Record<number, [number, number][]> = {
  2: [[50, 0], [50, 6]],
  3: [[50, 0], [50, 3], [50, 6]],
  4: [[COL_L, 0], [COL_R, 0], [COL_L, 6], [COL_R, 6]],
  5: [[COL_L, 0], [COL_R, 0], [50, 3], [COL_L, 6], [COL_R, 6]],
  6: [[COL_L, 0], [COL_R, 0], [COL_L, 3], [COL_R, 3], [COL_L, 6], [COL_R, 6]],
  7: [[COL_L, 0], [COL_R, 0], [50, 1.5], [COL_L, 3], [COL_R, 3], [COL_L, 6], [COL_R, 6]],
  8: [[COL_L, 0], [COL_R, 0], [50, 1.5], [COL_L, 3], [COL_R, 3], [50, 4.5], [COL_L, 6], [COL_R, 6]],
  9: [[COL_L, 0], [COL_R, 0], [COL_L, 2], [COL_R, 2], [50, 3], [COL_L, 4], [COL_R, 4], [COL_L, 6], [COL_R, 6]],
  10: [[COL_L, 0], [COL_R, 0], [50, 1], [COL_L, 2], [COL_R, 2], [COL_L, 4], [COL_R, 4], [50, 5], [COL_L, 6], [COL_R, 6]],
};

function Pip({ s, x, y, size, flip }: { s: number; x: number; y: number; size: number; flip?: boolean }) {
  const k = size / 100;
  return (
    <path
      d={SUIT_PATH[s]}
      transform={`translate(${x} ${y})${flip ? " rotate(180)" : ""} scale(${k}) translate(-50 -50)`}
    />
  );
}

function Index({ r, s }: { r: string; s: number }) {
  return (
    <>
      <text x={IDX_X} y={31} className="pk-idx" textAnchor="middle">
        {r}
      </text>
      <Pip s={s} x={IDX_X} y={43} size={15} />
    </>
  );
}

function CardFace({ rank, r, s, court }: { rank: number; r: string; s: number; court: boolean }) {
  const n = rank + 2; // 2 ~ 14 (A)
  return (
    <svg viewBox="0 0 100 140" className="pk-face" fill="currentColor" aria-hidden>
      {court ? (
        <>
          <clipPath id={`cc-${rank}-${s}`}>
            <rect x={27} y={6} width={67} height={128} rx={5} />
          </clipPath>
          <image
            href={asset.court(s, rank)}
            x={27}
            y={6}
            width={67}
            height={128}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#cc-${rank}-${s})`}
          />
          <rect x={27} y={6} width={67} height={128} rx={5} fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth={0.8} />
        </>
      ) : n === 14 ? (
        <Pip s={s} x={50} y={70} size={46} />
      ) : (
        PIPS[n].map(([x, k], i) => <Pip key={i} s={s} x={x} y={yAt(k)} size={PIP} flip={k > 3} />)
      )}
      <Index r={r} s={s} />
      {!court && (
        <g transform="rotate(180 50 70)">
          <Index r={r} s={s} />
        </g>
      )}
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
 * 테이블 뒤에 서 있는 캐릭터. 모든 포즈 그림을 겹쳐 두고 지금 포즈만 보여 줘서 바뀔 때 깜빡이지 않음.
 * 숨쉬기 · 포즈별 작은 움직임은 CSS (pk-pose-*). flip = 왼쪽 자리(오른쪽을 보게 뒤집음).
 */
export function CharSprite({
  char,
  pose,
  flip,
  dim,
  w,
  seat,
  className = "",
  style,
}: {
  char: Look;
  pose: Pose;
  /** 앉은 그림 (없으면 서 있는 그림) */
  seat?: "front" | "side";
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
          src={seat ? asset.seat(char, seat, p) : asset.pose(char, p)}
          alt=""
          draggable={false}
          data-on={p === pose ? "1" : undefined}
        />
      ))}
    </span>
  );
}

/** 내 캐릭터 전신 그림 (2:3, 포즈 8장을 겹쳐 두고 바뀔 때 서서히). 높이(px)로 크기를 줌 */
export function HeroSprite({ char, pose, h, dim }: { char: Look; pose: Pose; h: number; dim?: boolean }) {
  return (
    <span
      className="pk-sprite"
      data-pose={pose}
      data-dim={dim ? "1" : undefined}
      style={{ width: Math.round((h * 2) / 3), height: Math.round(h) }}
      aria-hidden
    >
      {POSES.map((p) => (
        <img key={p} src={asset.hero(char, p)} alt="" draggable={false} data-on={p === pose ? "1" : undefined} />
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
