"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  FACTION_COLOR,
  FACTION_NAME,
  GRADE_COLOR,
  GRADE_NAME,
  UNIT,
  type Faction,
  type UnitDef,
} from "@/lib/defense/units";
import { UNIT_ART } from "@/lib/defense/assets";
import { getPrefs, onPrefs, setPrefs, sfx, type AudioPrefs } from "./audio";
import { useStage } from "./Stage";

/* PIXEL GLITCH DEFENSE 공용 UI 조각 (무대 1024×576 안에서 쓰는 크기) — 도트 규칙은 css/defense.css */

export const TITLE = "px-title";
export const GAME_NAME = "PIXEL LUCKY DEFENSE";

type Tone = "ghost" | "main" | "gold" | "danger" | "cyan" | "knight" | "mech" | "arcane";
/** 버튼 바탕 · 글자 · 마우스 올렸을 때 테두리 색 */
const TONES: Record<Tone, { c: string; t: string; hb: string }> = {
  ghost: { c: "#2a2350", t: "#f2eefc", hb: "#bfb3ff" },
  main: { c: "#d4249f", t: "#fff", hb: "#ffd6f4" },
  gold: { c: "#e0a412", t: "#2a1a00", hb: "#fff2b8" },
  danger: { c: "#8c1f3a", t: "#ffd0da", hb: "#ff9ab0" },
  cyan: { c: "#137f93", t: "#e6fdff", hb: "#b8fbff" },
  knight: { c: "#1d4f7a", t: "#e3f3ff", hb: "#6ec1ff" },
  mech: { c: "#7a4612", t: "#fff0dc", hb: "#ffb347" },
  arcane: { c: "#4d2a82", t: "#f2e6ff", hb: "#c08cff" },
};

export function Btn({
  children,
  onClick,
  disabled,
  tone = "ghost",
  className = "",
  title,
  hot,
  arrow,
  silent,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: Tone;
  className?: string;
  title?: string;
  /** 단축키 표시 (PC) */
  hot?: string;
  /** 마우스를 올리면 왼쪽에 ▶ (메뉴 버튼) */
  arrow?: boolean;
  /** 누름 소리 안 냄 (누른 결과에 따로 소리가 있을 때) */
  silent?: boolean;
  style?: CSSProperties;
}) {
  const t = TONES[tone];
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onPointerEnter={(e) => e.pointerType === "mouse" && !disabled && sfx("ui-hover")}
      onClick={() => {
        if (!silent) sfx("ui-click");
        onClick?.();
      }}
      className={`px-btn ${arrow ? "px-arrow" : ""} ${className}`}
      style={{ "--c": t.c, "--t": t.t, "--hb": t.hb, ...style } as CSSProperties}
    >
      {children}
      {hot && (
        <span className="px-key pointer-events-none absolute top-1 right-1 hidden [@media(pointer:fine)]:block">
          {hot}
        </span>
      )}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  accent = "#5b4f96",
}: {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
  accent?: string;
}) {
  useEffect(() => {
    sfx("ui-click", 0.8, 1.2);
  }, []);
  // Esc 로 닫기 (게임 화면은 GameView 가 따로 처리 — 같이 불려도 닫기만 함)
  useEffect(() => {
    if (!onClose) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-[#05040c]/75"
      onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className={`px-win flex max-h-[528px] flex-col ${wide ? "w-[900px]" : "w-[600px]"}`}>
        <div
          className="px-win-head m-[4px] mb-0 flex items-center justify-between px-4 py-2"
          style={{ boxShadow: `inset 0 -2px 0 0 ${accent}` }}
        >
          <h3 className={`${TITLE} px-shadow text-[20px] text-white`}>{title}</h3>
          {onClose && (
            <button
              type="button"
              onPointerEnter={(e) => e.pointerType === "mouse" && sfx("ui-hover")}
              onClick={() => (sfx("ui-click"), onClose())}
              className="px-btn h-8 w-8 text-[16px] leading-none"
              style={{ "--c": "#3a2f66", "--hb": "#ff9ab0" } as CSSProperties}
              aria-label="닫기"
            >
              ✕
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/* ───────── 세력 문장 (도트 그림) ─────────
 * 기사단 = 방패와 검 · 기계공방 = 톱니 · 마도회 = 별과 달 · 히든 = 깨진 픽셀
 * 7×7 칸 무늬, 1칸 = size/7 */
const EMBLEM: Record<Faction, string[]> = {
  knight: ["..XXX..", ".XXXXX.", ".XX.XX.", ".X.X.X.", ".XX.XX.", "..XXX..", "...X..."],
  mech: [".X.X.X.", "XXXXXXX", ".XX.XX.", "XX...XX", ".XX.XX.", "XXXXXXX", ".X.X.X."],
  arcane: ["...X...", "..XXX..", "XXXXXXX", ".XXXXX.", "..XXX..", ".XX.XX.", "X.....X"],
  hidden: ["XX..X.X", "X..XX..", ".XX..XX", "X.XX.X.", "..X.XX.", "XX.X..X", "X..X.XX"],
};
export function FactionIcon({
  f,
  size = 14,
  color,
  className = "",
}: {
  f: Faction;
  size?: number;
  color?: string;
  className?: string;
}) {
  const rows = EMBLEM[f];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 7 7"
      shapeRendering="crispEdges"
      className={`inline-block shrink-0 ${className}`}
      aria-hidden
    >
      {rows.flatMap((r, y) =>
        [...r].map((ch, x) =>
          ch === "X" ? (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={color ?? FACTION_COLOR[f]}
            />
          ) : null
        )
      )}
    </svg>
  );
}

export function GradeChip({ g }: { g: number }) {
  return (
    <span
      className="inline-block px-1.5 py-[2px] text-[12px] leading-none font-bold"
      style={{
        color: g >= 3 ? "#160f00" : GRADE_COLOR[g],
        background: g >= 3 ? GRADE_COLOR[g] : GRADE_COLOR[g] + "22",
        boxShadow: `0 0 0 2px ${GRADE_COLOR[g]}${g >= 3 ? "" : "88"}`,
      }}
    >
      {GRADE_NAME[g]}
    </span>
  );
}
export function FactionChip({ f }: { f: UnitDef["faction"] }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-[2px] text-[12px] leading-none font-bold"
      style={{ color: FACTION_COLOR[f], background: FACTION_COLOR[f] + "1f" }}
    >
      <FactionIcon f={f} size={10} />
      {FACTION_NAME[f]}
    </span>
  );
}

/** 세력별 칸 바탕 (유닛 아이콘 뒤) — 같은 세력이 한눈에 묶여 보이게 */
export const FACTION_BG: Record<Faction, string> = {
  knight: "#173a5c",
  mech: "#5c3410",
  arcane: "#3a2068",
  hidden: "#0f4d3a",
};

/** 유닛 얼굴 (그림이 있으면 그림, 없으면 세력 문장 + 글자) — 세력색 바탕 · 등급색 테두리 */
export function UnitIcon({ id, size = 40, dim }: { id: string; size?: number; dim?: boolean }) {
  const d = UNIT[id];
  const art = UNIT_ART[id];
  const border = d.grade >= 3 ? 3 : 2;
  const box: CSSProperties = {
    width: size,
    height: size,
    background: FACTION_BG[d.faction],
    boxShadow: `0 0 0 ${border}px ${GRADE_COLOR[d.grade]}${d.grade >= 3 ? `, 0 0 10px ${GRADE_COLOR[d.grade]}aa` : ""}, inset 0 -${Math.round(size / 6)}px 0 0 rgba(0,0,0,0.3)`,
    opacity: dim ? 0.35 : 1,
  };
  if (art) {
    const fw = art.w,
      fh = art.h;
    const k = (size * 1.1) / fh;
    return (
      <span className="relative inline-block shrink-0 overflow-hidden" style={box}>
        <span
          className="absolute left-1/2"
          style={{
            width: fw * k,
            height: fh * k,
            bottom: -size * 0.04,
            marginLeft: (-fw * k) / 2,
            backgroundImage: `url(${art.src})`,
            backgroundSize: `${(art.cols ?? art.idle.frames) * fw * k}px auto`,
            backgroundPosition: `0 ${-art.idle.row * fh * k}px`,
            imageRendering: art.pixel ? "pixelated" : undefined,
          }}
        />
      </span>
    );
  }
  return (
    <span
      className="relative inline-flex shrink-0 flex-col items-center justify-center"
      style={box}
    >
      <FactionIcon f={d.faction} size={Math.round(size * 0.42)} />
      <span
        className="font-bold text-white"
        style={{ fontSize: Math.max(12, Math.round(size * 0.24)), lineHeight: 1.1 }}
      >
        {d.glyph}
      </span>
    </span>
  );
}

/** 유닛 성능 한 줄 요약 */
export function unitStats(d: UnitDef) {
  const r = d.range >= 99 ? "전체" : `${d.range}칸`;
  return `피해 ${d.dmg} · 초당 ${d.aps}회 · 사거리 ${r} · ${d.dtype === "phys" ? "물리" : "마법"}`;
}

/* ───────── 소리 설정 ───────── */

export function useAudioPrefs(): AudioPrefs {
  const [p, setP] = useState<AudioPrefs>(() => getPrefs());
  useEffect(() => onPrefs(setP), []);
  return p;
}

/** 스피커 버튼 + 누르면 음량 창 */
/** 전체화면 켜고 끄기 (PC · 폰 모두) — 무대 전체가 화면을 덮음. 브라우저가 막으면 창 안에서 덮기 */
export function FsButton({ className = "", h = 34 }: { className?: string; h?: number }) {
  const st = useStage();
  return (
    <Btn
      onClick={st.toggleFs}
      className={className}
      style={{ height: h, width: h + 4 }}
      title={st.fs ? "전체화면 끄기" : "전체화면"}
    >
      <Icon n={st.fs ? "unfull" : "full"} size={16} />
    </Btn>
  );
}

export function SoundButton({ className = "" }: { className?: string }) {
  const p = useAudioPrefs();
  const [open, setOpen] = useState(false);
  const icon = <Icon n={p.mute ? "mute" : "speaker"} size={16} />;
  return (
    <div className={`relative ${className}`}>
      <Btn
        onClick={() => setOpen((o) => !o)}
        className="h-[34px] w-[38px] text-[15px]"
        title="소리 · 마우스 크기"
      >
        {icon}
      </Btn>
      {open && (
        <div
          className="px-win absolute top-[44px] right-0 z-50 w-[240px] p-3 text-[13px]"
          onPointerLeave={() => setOpen(false)}
        >
          <Slider
            label="배경음"
            value={p.bgm}
            onChange={(v) => setPrefs({ bgm: v, mute: false })}
          />
          <Slider
            label="효과음"
            value={p.sfx}
            onChange={(v) => {
              setPrefs({ sfx: v, mute: false });
              sfx("ui-click");
            }}
          />
          <Btn
            tone={p.mute ? "danger" : "ghost"}
            className="mt-2 h-[30px] w-full text-[12px]"
            onClick={() => setPrefs({ mute: !p.mute })}
          >
            {p.mute ? "소리 켜기" : "모두 끄기"}
          </Btn>
          <div className="mt-3 mb-1 text-[var(--mute)]">마우스 크기</div>
          <div className="grid grid-cols-4 gap-1">
            {([
              [1, "보통"],
              [2, "크게"],
              [3, "최대"],
              [0, "기본"],
            ] as const).map(([v, n]) => (
              <Btn
                key={v}
                tone={p.cursor === v ? "cyan" : "ghost"}
                className="h-[28px] text-[12px]"
                title={v === 0 ? "운영체제 기본 커서" : `도트 커서 ${n}`}
                onClick={() => setPrefs({ cursor: v })}
              >
                {n}
              </Btn>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(v: number): void;
}) {
  const steps = 10;
  const on = Math.round(value * steps);
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-[var(--mute)]">
        <span>{label}</span>
        <span>{on * 10}%</span>
      </div>
      <div className="flex gap-[3px]">
        {Array.from({ length: steps }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${label} ${(i + 1) * 10}%`}
            onClick={() => onChange(on === i + 1 ? i / steps : (i + 1) / steps)}
            className="h-[14px] flex-1"
            style={{ background: i < on ? (i < 7 ? "#5ff2ff" : "#ff4fd8") : "#2a2350" }}
          />
        ))}
      </div>
    </div>
  );
}

export const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const fmtNum = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e4
      ? `${(n / 1e3).toFixed(1)}K`
      : String(Math.round(n));

/* ───────── 도트 아이콘 (이모지 대신) ─────────
 * 8×8 무늬. 글자: 1 주색 · 2 밝은색 · 3 어두운색 · 0 외곽선 */
const ICONS: Record<string, { rows: string[]; c: [string, string, string] }> = {
  coin: {
    rows: [
      "..0000..",
      ".011110.",
      "01122110",
      "01211310",
      "01211310",
      "01133310",
      ".033330.",
      "..0000..",
    ],
    c: ["#ffd23f", "#fff2b8", "#b8860b"],
  },
  gem: {
    rows: [
      "........",
      ".000000.",
      "01222110",
      "0122113.",
      ".01113..",
      "..0130..",
      "...00...",
      "........",
    ],
    c: ["#5ff2ff", "#e6fdff", "#1b8fa3"],
  },
  clover: {
    rows: [
      ".00..00.",
      "0110011.",
      "01211210",
      ".001100.",
      "0110011.",
      "01100110",
      ".00.30..",
      "....3...",
    ],
    c: ["#6dff8f", "#d6ffe0", "#2f7a3e"],
  },
  gear: {
    rows: [
      "...00...",
      ".0.11.0.",
      "..1221..",
      "01200210",
      "01200210",
      "..1221..",
      ".0.11.0.",
      "...00...",
    ],
    c: ["#5ff2ff", "#e6fdff", "#1b8fa3"],
  },
  flask: {
    rows: [
      "..0000..",
      "...00...",
      "...00...",
      "..0110..",
      ".012210.",
      "01211110",
      "01111110",
      ".000000.",
    ],
    c: ["#ffd23f", "#fff2b8", "#b8860b"],
  },
  star: {
    rows: [
      "...00...",
      "...11...",
      "0011110.",
      ".012210.",
      "..1221..",
      ".11.111.",
      ".1....1.",
      "........",
    ],
    c: ["#ffd23f", "#fff2b8", "#b8860b"],
  },
  book: {
    rows: [
      ".000000.",
      "0111122.",
      "0121122.",
      "0111122.",
      "0121122.",
      "0111122.",
      "0333333.",
      ".000000.",
    ],
    c: ["#c08cff", "#f2e6ff", "#4d2a82"],
  },
  ticket: {
    rows: [
      "........",
      "00000000",
      "01121110",
      "11211211",
      "11211211",
      "01121110",
      "00000000",
      "........",
    ],
    c: ["#ffd23f", "#fff2b8", "#b8860b"],
  },
  rift: {
    rows: [
      "..0..0..",
      ".010010.",
      "0121.120",
      ".12..21.",
      ".12..21.",
      "0121.120",
      ".010010.",
      "..0..0..",
    ],
    c: ["#ff4fd8", "#ffd6f4", "#8c1f7a"],
  },
  dice: {
    rows: [
      ".000000.",
      "01111110",
      "01211210",
      "01111110",
      "01121110",
      "01211210",
      "01111110",
      ".000000.",
    ],
    c: ["#f2eefc", "#120d22", "#a69cc9"],
  },
  full: {
    rows: [
      "111..111",
      "1......1",
      "1......1",
      "........",
      "........",
      "1......1",
      "1......1",
      "111..111",
    ],
    c: ["#f2eefc", "#ffffff", "#a69cc9"],
  },
  unfull: {
    rows: [
      "..1..1..",
      "..1..1..",
      "111..111",
      "........",
      "........",
      "111..111",
      "..1..1..",
      "..1..1..",
    ],
    c: ["#f2eefc", "#ffffff", "#a69cc9"],
  },
  note: {
    rows: [
      "0000000.",
      "0222220.",
      "0211110.",
      "0222220.",
      "0211110.",
      "0222220.",
      "0211100.",
      "000000..",
    ],
    c: ["#a69cc9", "#f2eefc", "#5b4f96"],
  },
  speaker: {
    rows: [
      "....0...",
      "...01.0.",
      "0001102.",
      "01211.02",
      "01211.02",
      "0001102.",
      "...01.0.",
      "....0...",
    ],
    c: ["#f2eefc", "#ffffff", "#a69cc9"],
  },
  mute: {
    rows: [
      "....0...",
      "...01...",
      "000110.0",
      "012110.0",
      "01211.0.",
      "000110.0",
      "...01...",
      "....0...",
    ],
    c: ["#a69cc9", "#f2eefc", "#6f6597"],
  },
  /** 픽셀 조각 (기본 재화) */
  piece: {
    rows: [
      "...00...",
      "..0120..",
      ".012210.",
      "01222110",
      "01111130",
      ".011330.",
      "..0330..",
      "...00...",
    ],
    c: ["#4fd8ff", "#e6fdff", "#1b6fa3"],
  },
  /** 글리치 코어 (희귀 재화) */
  core: {
    rows: [
      ".00..00.",
      "0110.110",
      "0122.210",
      "..2..2..",
      "..2..2..",
      "0122.210",
      "0110.110",
      ".00..00.",
    ],
    c: ["#ff4fd8", "#ffffff", "#8c1f7a"],
  },
  card: {
    rows: [
      ".000000.",
      "01111110",
      "01222210",
      "01211210",
      "01222210",
      "01111110",
      "01333310",
      ".000000.",
    ],
    c: ["#ffb347", "#fff0dc", "#7a4612"],
  },
  chest: {
    rows: [
      "........",
      ".000000.",
      "01111110",
      "03333330",
      "01122110",
      "01122110",
      "01111110",
      ".000000.",
    ],
    c: ["#c27a2c", "#ffd23f", "#6a3a10"],
  },
  /** 사이트 포인트 GP */
  gp: {
    rows: [
      "..0000..",
      ".022220.",
      "02211220",
      "0210.000",
      "0210.220",
      "02211220",
      ".022220.",
      "..0000..",
    ],
    c: ["#6dff8f", "#6dff8f", "#2f7a3e"],
  },
  lock: {
    rows: [
      "..0000..",
      ".03..30.",
      ".03..30.",
      "00000000",
      "01111110",
      "01100110",
      "01111110",
      "00000000",
    ],
    c: ["#a69cc9", "#f2eefc", "#6f6597"],
  },
  up: {
    rows: [
      "...00...",
      "..0110..",
      ".012210.",
      "01122110",
      "...11...",
      "...11...",
      "...11...",
      "...00...",
    ],
    c: ["#6dff8f", "#d6ffe0", "#2f7a3e"],
  },
  relic: {
    rows: [
      ".00..00.",
      "..0..0..",
      "...00...",
      "..0110..",
      ".012210.",
      ".011110.",
      "..0130..",
      "...00...",
    ],
    c: ["#ffd23f", "#fff2b8", "#b8860b"],
  },
  skull: {
    rows: [
      ".000000.",
      "01111110",
      "11111111",
      "10011001",
      "11111111",
      ".111111.",
      ".1.11.1.",
      "........",
    ],
    c: ["#f2eefc", "#ffffff", "#a69cc9"],
  },
};
export function Icon({
  n,
  size = 16,
  className = "",
}: {
  n: keyof typeof ICONS | string;
  size?: number;
  className?: string;
}) {
  const ic = ICONS[n];
  if (!ic) return null;
  const col: Record<string, string> = { "0": "#0a0816", "1": ic.c[0], "2": ic.c[1], "3": ic.c[2] };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      className={`inline-block shrink-0 align-[-2px] ${className}`}
      aria-hidden
    >
      {ic.rows.flatMap((r, y) =>
        [...r].map((ch, x) =>
          col[ch] ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={col[ch]} />
          ) : null
        )
      )}
    </svg>
  );
}

/** 도트 막대 (진행 · 체력) */
export function Bar({
  value,
  color,
  h = 8,
  className = "",
}: {
  value: number;
  color: string;
  h?: number;
  className?: string;
}) {
  return (
    <div className={`px-bar ${className}`} style={{ height: h }}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color }} />
    </div>
  );
}

/**
 * 도트 말풍선 (마우스를 올리면 아래에) — 스크롤 상자 안에서는 잘릴 수 있어서 머리말 · 메뉴처럼 바깥쪽에 씀.
 * 눌러도 열리고 (폰 · PC), 다시 누르거나 바깥을 누르면 닫힘. 감싸는 쪽의 z-index 가 옆 칸보다 낮으면 가려지니 주의.
 */
export function Tip({
  text,
  children,
  className = "",
  side = "bottom",
  align = "center",
  width = 260,
}: {
  text: ReactNode;
  children: ReactNode;
  className?: string;
  side?: "bottom" | "top";
  /** 화면 가장자리 근처면 right/left 로 (무대 밖으로 나가면 잘림) */
  align?: "center" | "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", off, true);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", off, true);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  return (
    <span
      ref={ref}
      className={`group/tip relative inline-flex cursor-help ${className}`}
      onClick={() => setOpen((o) => !o)}
    >
      {children}
      <span
        className={`px-box pointer-events-none absolute z-[70] ${align === "center" ? "left-1/2 -translate-x-1/2" : align === "right" ? "right-0" : "left-0"} p-2 text-left text-[12px] leading-relaxed font-normal text-[var(--text)] group-hover/tip:block ${open ? "block" : "hidden"} ${side === "bottom" ? "top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)]"}`}
        style={{ width, "--b": "#5b4f96", "--f": "#120d22" } as CSSProperties}
      >
        {text}
      </span>
    </span>
  );
}

