"use client";

import type { CSSProperties, ReactNode } from "react";
import { GRADE_COLOR, type Grade } from "@/lib/marble/data";
import { sfx } from "./audio";

/*
 * DICE TOWN 공용 도트 UI — 도트 아이콘(문자 비트맵 → SVG 네모) · 버튼 · 상자 · 등급 · 재화.
 * 이모지 대신 여기 아이콘을 씀 (어느 기기에서나 같은 도트로 보이게).
 */

const PAL: Record<string, string> = {
  k: "#232a4d",
  w: "#ffffff",
  y: "#ffd23f",
  Y: "#ffb01f",
  o: "#ff9a3d",
  r: "#ff5d5d",
  R: "#c43a3a",
  b: "#4a8dff",
  B: "#2f5fc4",
  c: "#7fe3ff",
  g: "#5fd06a",
  G: "#3a9a45",
  p: "#ff8fb8",
  P: "#e0558c",
  v: "#b58cff",
  n: "#b87a45",
  N: "#8a5530",
  t: "#f3d9a4",
  s: "#c9d2dc",
  S: "#8a96a3",
  e: "#e9e2d0",
};

/** 아이콘 비트맵 — 한 글자 = 한 칸 (. = 빈칸) */
const ICONS: Record<string, string[]> = {
  star: [
    "....k....",
    "...kyk...",
    "...kyk...",
    "kkkkyykkk",
    "kyyyywyyk",
    ".kyyyyyk.",
    "..kyykyk.",
    ".kyk.kyyk",
    ".kk...kk.",
  ],
  candy: [
    "...kkk...",
    "..kpppk..",
    ".kpwpppk.",
    "kpwppPppk",
    "kpppPpppk",
    "kppPppppk",
    ".kpppppk.",
    "..kpppk..",
    "...kkk...",
  ],
  gear: [
    "...kkk...",
    ".kkSsSkk.",
    ".kSsssSk.",
    "kSssksssk",
    "kSskkkssk",
    "kSssksssk",
    ".kSsssSk.",
    ".kkSSSkk.",
    "...kkk...",
  ],
  ticket: [
    "kkkkkkkkkk",
    "kyyyykyyyk",
    "kyrryyyyk.",
    ".kyrryyyyk",
    "kyyyykyyyk",
    "kkkkkkkkkk",
  ],
  coin: [
    "..kkkkk..",
    ".kyyyyyk.",
    "kyywyyYYk",
    "kywyyyyYk",
    "kyyykyyYk",
    "kyyyyyyYk",
    "kYyyyyYYk",
    ".kYYYYYk.",
    "..kkkkk..",
  ],
  gp: [
    "..kkkkk..",
    ".kgggggk.",
    "kgwgggGGk",
    "kgkkgkkGk",
    "kgkggkgGk",
    "kgkkgkkGk",
    "kgggggkGk",
    ".kGGGGGk.",
    "..kkkkk..",
  ],
  house: [
    "....k....",
    "...krk...",
    "..krrrk..",
    ".krrrrrk.",
    "kkkkkkkkk",
    ".kttttk..",
    ".ktkbtk..",
    ".ktkbtk..",
    ".kkkkkk..",
  ],
  house2: [
    "...kkk...",
    "..kbbbk..",
    ".kbbbbbk.",
    "kkkkkkkkk",
    ".ktctctk.",
    ".kttttk..",
    ".ktcktk..",
    ".kttktk..",
    ".kkkkkk..",
  ],
  tower: [
    "...kkk...",
    "..kvvvk..",
    "..kkkkk..",
    "..ktctk..",
    "..ktttk..",
    "..ktctk..",
    "..ktttk..",
    "..ktktk..",
    "..kkkkk..",
  ],
  landmark: [
    "....kkk..",
    "....kyyk.",
    "....kkk..",
    "....k....",
    "..kkkkk..",
    ".kpwpwpk.",
    "kkkkkkkkk",
    "ktctctctk",
    "kkkkkkkkk",
  ],
  box: [
    "...k.k...",
    "..kpkpk..",
    "kkkkkkkkk",
    "kyyypyyyk",
    "kkkkpkkkk",
    "kyyypyyyk",
    "kyyypyyyk",
    "kyyypyyyk",
    "kkkkkkkkk",
  ],
  wrench: [
    ".kk...kk.",
    "kssk.kssk",
    "kssskssk.",
    ".kssssk..",
    "..kSsk...",
    "..kSSk...",
    ".kSSk....",
    "kSSk.....",
    "kkk......",
  ],
  note: [
    "....kkkkk",
    "....kpppk",
    "....kkkpk",
    "....k..pk",
    "....k..pk",
    ".kkkk.kkk",
    "kppppkppk",
    "kppppkkkk",
    ".kkkk....",
  ],
  warp: [
    "..kkkkk..",
    ".kvvvvvk.",
    "kvvkkkvvk",
    "kvkcccvvk",
    "kvkckckvk",
    "kvkcckkvk",
    "kvvkkkvvk",
    ".kvvvvvk.",
    "..kkkkk..",
  ],
  flag: [
    "kkkkkk...",
    "krrrrrkk.",
    "krrwrrrrk",
    "krrrrrkk.",
    "kkkkkk...",
    "k........",
    "k........",
    "k........",
    "kkk......",
  ],
  bag: [
    "...kkk...",
    "..kNkNk..",
    "...kkk...",
    "..knnnk..",
    ".knnynnk.",
    "knnyyynnk",
    "knnnynnnk",
    "knnnnnnnk",
    ".kkkkkkk.",
  ],
  gold: [
    ".........",
    "...kkkk..",
    "..kyywyk.",
    ".kyyyyYk.",
    "kkkkkkkk.",
    "kyywykyyk",
    "kyyyykyYk",
    "kYYYYkYYk",
    "kkkkkkkkk",
  ],
  speaker: ["....k..", "...kk..", "kkkwk.k", "kwwwk.k", "kkkwk.k", "...kk..", "....k.."],
  mute: ["....k..", "...kk..", "kkkwk..", "kwwwkrr", "kkkwkr.", "...kk..", "....k.."],
  full: ["kkk.kkk", "k.....k", "k.....k", ".......", "k.....k", "k.....k", "kkk.kkk"],
  unfull: [".k...k.", "kk...kk", ".......", ".......", ".......", "kk...kk", ".k...k."],
  back: ["...k...", "..kk...", ".kkkkkk", "kkkkkkk", ".kkkkkk", "..kk...", "...k..."],
  chat: ["kkkkkkk", "kwwwwwk", "kwkwkwk", "kwwwwwk", "kkkkkkk", ".kk....", "k......"],
  crown: ["k..k..k", "kk.k.kk", "kykykyk", "kyyyyyk", "kyrybyk", "kyyyyyk", "kkkkkkk"],
  lock: [".kkkkk.", ".k...k.", ".k...k.", "kkkkkkk", "kyyyyyk", "kyykyyk", "kkkkkkk"],
  bot: ["...k...", "..kkk..", "kkkkkkk", "kwkwkwk", "kkkkkkk", "kskkksk", "kkkkkkk"],
  clock: [".kkkkk.", "kwwkwwk", "kwwkwwk", "kwwkkwk", "kwwwwwk", "kwwwwwk", ".kkkkk."],
  fire: ["...k...", "..kok..", ".korok.", ".kooroo", "korrrok", "koryrok", ".kkkkk."],
  ice: ["...c...", ".c.c.c.", "..ccc..", "ccccccc", "..ccc..", ".c.c.c.", "...c..."],
  shield: ["kkkkkkk", "kccwcck", "kcccwck", "kccccck", ".kcccck", "..kcck.", "...kk.."],
  plus: ["..kkk..", "..kgk..", "kkkgkkk", "kgggggk", "kkkgkkk", "..kgk..", "..kkk.."],
  up: ["...k...", "..kgk..", ".kgggk.", "kgggggk", "kkkgkkk", "..kgk..", "..kkk.."],
  check: [".......", "......k", ".....kk", "k...kk.", "kk.kk..", ".kkk...", "..k...."],
  x: ["k.....k", "kk...kk", ".kk.kk.", "..kkk..", ".kk.kk.", "kk...kk", "k.....k"],
  book: ["kkkkkkk", "kbbkwwk", "kbbkwwk", "kbbkwwk", "kbbkwwk", "kbbkwwk", "kkkkkkk"],
  heart: [".kk.kk.", "kppkppk", "kpppppk", "kpppppk", ".kpppk.", "..kpk..", "...k..."],
};

export type IconName = keyof typeof ICONS;

/** 조금 어둡게 (지붕 그늘) */
function shade(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.round(v * 0.72));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, "0")).join("")}`;
}

export function Icon({ n, size = 18, className = "", title, style, tint }: { n: IconName | string; size?: number; className?: string; title?: string; style?: CSSProperties; tint?: string }) {
  const rows = ICONS[n] ?? ICONS.star;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const rects: ReactNode[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const fill = tint && (ch === "r" || ch === "R" || ch === "b" || ch === "v" || ch === "p") ? (ch === "R" ? shade(tint) : tint) : PAL[ch];
      if (fill) rects.push(<rect key={`${x},${y}`} x={x} y={y} width={1.02} height={1.02} fill={fill} />);
    })
  );
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={(size * w) / Math.max(w, h)}
      height={(size * h) / Math.max(w, h)}
      className={`inline-block shrink-0 align-[-0.15em] ${className}`}
      style={{ shapeRendering: "crispEdges", ...style }}
      aria-hidden={!title}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      {rects}
    </svg>
  );
}

/** 주사위 한 면 (도트) */
export function DiceFace({ v, size = 44, className = "" }: { v: number; size?: number; className?: string }) {
  const pips: Record<number, [number, number][]> = {
    1: [[3, 3]],
    2: [
      [1, 1],
      [5, 5],
    ],
    3: [
      [1, 1],
      [3, 3],
      [5, 5],
    ],
    4: [
      [1, 1],
      [5, 1],
      [1, 5],
      [5, 5],
    ],
    5: [
      [1, 1],
      [5, 1],
      [3, 3],
      [1, 5],
      [5, 5],
    ],
    6: [
      [1, 1],
      [5, 1],
      [1, 3],
      [5, 3],
      [1, 5],
      [5, 5],
    ],
  };
  return (
    <svg viewBox="-1 -1 9 9" width={size} height={size} className={className} style={{ shapeRendering: "crispEdges" }} aria-label={`주사위 ${v}`}>
      <rect x={-0.5} y={0} width={8} height={7} fill="#232a4d" />
      <rect x={0} y={-0.5} width={7} height={8} fill="#232a4d" />
      <rect x={0} y={0} width={7} height={7} fill="#fffaf0" />
      <rect x={0} y={6} width={7} height={1} fill="#e8dcc0" />
      {(pips[v] ?? []).map(([x, y], i) => (
        <rect key={i} x={x - 0.5 + 0.5} y={y - 0.5 + 0.5} width={1} height={1} fill={v === 1 ? "#ff5d5d" : "#232a4d"} />
      ))}
    </svg>
  );
}

/** 버튼: tone 으로 색 (paper · wood · mint · pink · gold · sky · red) */
const TONE: Record<string, [string, string]> = {
  paper: ["#ffffff", "#232a4d"],
  wood: ["#5b6cff", "#ffffff"],
  mint: ["#4fd1b5", "#163a33"],
  pink: ["#ff7fa8", "#fff"],
  gold: ["#ffc94a", "#232a4d"],
  sky: ["#8ccff7", "#163050"],
  red: ["#ff6b6b", "#fff"],
  grass: ["#7fcf6a", "#183a12"],
  violet: ["#b58cff", "#fff"],
};
export function Btn({
  tone = "paper",
  className = "",
  children,
  silent,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof TONE | string; silent?: boolean }) {
  const [c, t] = TONE[tone] ?? TONE.paper;
  return (
    <button
      type="button"
      {...rest}
      onMouseEnter={(e) => {
        if (!rest.disabled) sfx("hover");
        rest.onMouseEnter?.(e);
      }}
      onClick={(e) => {
        if (!silent) sfx("click");
        rest.onClick?.(e);
      }}
      className={`mb-btn inline-flex items-center justify-center gap-1.5 ${className}`}
      style={{ "--c": c, "--t": t, ...rest.style } as CSSProperties}
    >
      {children}
    </button>
  );
}

export function GradeTag({ g, className = "" }: { g: Grade; className?: string }) {
  return (
    <span className={`mb-chip text-[12px] leading-[14px] font-bold ${className}`} style={{ "--c": GRADE_COLOR[g], "--t": g === "SSR" ? "#232a4d" : "#fff" } as CSSProperties}>
      {g}
    </span>
  );
}

/** 강화 별 (0~5) */
export function Stars({ lv, max = 5, size = 10 }: { lv: number; max?: number; size?: number }) {
  return (
    <span className="inline-flex gap-[1px]">
      {Array.from({ length: max }, (_, i) => (
        <Icon key={i} n="star" size={size} style={{ opacity: i < lv ? 1 : 0.22, filter: i < lv ? undefined : "grayscale(1)" }} />
      ))}
    </span>
  );
}

export const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 재화 한 줄 */
/** 재화 그림 (매끈한 SVG) — 별사탕 · 부품 · GP · 티켓 · 판 돈 */
export function CurIcon({ k, size = 16 }: { k: "star" | "parts" | "gp" | "ticket" | "coin"; size?: number }) {
  const ink = "#262b52";
  const body =
    k === "star" ? (
      <>
        <path d="M12 2.5l2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 16.4l-5.4 2.9 1-6.1-4.4-4.3 6.1-.8z" fill="#ff7fb8" stroke={ink} strokeWidth={1.4} strokeLinejoin="round" />
        <path d="M9.5 8.8l1.5-.2" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
      </>
    ) : k === "parts" ? (
      <>
        <path d="M19.26 9.74 L22.02 10.09 L22.02 13.91 L19.26 14.26 L18.73 15.54 L20.44 17.73 L17.73 20.44 L15.54 18.73 L14.26 19.26 L13.91 22.02 L10.09 22.02 L9.74 19.26 L8.46 18.73 L6.27 20.44 L3.56 17.73 L5.27 15.54 L4.74 14.26 L1.98 13.91 L1.98 10.09 L4.74 9.74 L5.27 8.46 L3.56 6.27 L6.27 3.56 L8.46 5.27 L9.74 4.74 L10.09 1.98 L13.91 1.98 L14.26 4.74 L15.54 5.27 L17.73 3.56 L20.44 6.27 L18.73 8.46 Z" fill="#b9c4dc" stroke={ink} strokeWidth={1.3} strokeLinejoin="round" />
        <circle cx="12" cy="12" r="3.2" fill="#eef2fb" stroke={ink} strokeWidth={1.3} />
      </>
    ) : k === "gp" ? (
      <>
        <circle cx="12" cy="12" r="9" fill="#3fcf8e" stroke={ink} strokeWidth={1.4} />
        <circle cx="12" cy="12" r="6.6" fill="none" stroke="#c9ffe6" strokeWidth={1.2} />
        <text x="12" y="15.3" textAnchor="middle" fontSize="8.5" fontWeight="900" fill={ink}>
          G
        </text>
      </>
    ) : k === "ticket" ? (
      <>
        <path d="M2 5.5h20v4a2.5 2.5 0 000 5v4H2v-4a2.5 2.5 0 000-5z" fill="#ffc94a" stroke={ink} strokeWidth={1.4} strokeLinejoin="round" />
        <path d="M15 5.5v13" stroke={ink} strokeWidth={1.2} strokeDasharray="1.8 1.6" />
        <path d="M8.5 8.2l1.1 2.2 2.4.35-1.75 1.7.42 2.4-2.17-1.15-2.17 1.15.42-2.4L5 10.75l2.4-.35z" fill="#ff7fb8" stroke={ink} strokeWidth={0.8} strokeLinejoin="round" />
      </>
    ) : (
      <>
        <circle cx="12" cy="12" r="9" fill="#ffd23a" stroke={ink} strokeWidth={1.4} />
        <circle cx="12" cy="12" r="6.4" fill="none" stroke="#fff1a8" strokeWidth={1.4} />
        <path d="M10 8.5h3.2a1.8 1.8 0 010 3.6H10V8.5zm0 3.6h3.6a1.8 1.8 0 010 3.6H10z" fill="none" stroke={ink} strokeWidth={1.3} />
      </>
    );
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="block shrink-0" aria-hidden>
      {body}
    </svg>
  );
}

export function Cur({ k, n, size = 16 }: { k: "star" | "parts" | "gp" | "ticket" | "coin"; n: number | string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <CurIcon k={k} size={size} />
      <b>{typeof n === "number" ? fmt(n) : n}</b>
    </span>
  );
}

/** 창: 제목 띠 + 닫기 */
export function Win({ title, onClose, children, className = "", style }: { title?: ReactNode; onClose?: () => void; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`mbx-modal flex flex-col overflow-hidden ${className}`} style={style}>
      {(title || onClose) && (
        <div className="mb-wood flex h-[34px] shrink-0 items-center justify-between px-3">
          <b className="mb-title mb-out text-[15px] text-white">{title}</b>
          {onClose && (
            <Btn className="h-[22px] w-[24px] text-[12px]" onClick={onClose} title="닫기">
              <Icon n="x" size={10} />
            </Btn>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** 플레이어 색 (자리 순서) */
export const PCOLOR = ["#ff6b6b", "#4a8dff", "#3fbf6a", "#ffb02e"];
export const PNAME_BG = ["#ffe1e1", "#dfeaff", "#dcf5e3", "#fff0d4"];
