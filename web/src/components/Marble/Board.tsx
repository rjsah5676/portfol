"use client";

import type { CSSProperties, ReactNode } from "react";
import { CHAR } from "@/lib/marble/data";
import { RULE } from "@/lib/marble/engine";
import { MAPS, type MapDef, type TileDef } from "@/lib/marble/maps";
import type { GameWire } from "@/lib/marble/wire";
import { PCOLOR } from "./pixel";
import Token, { type TokenAnim } from "./Token";

/*
 * 2.5D 보드 — 9×9 둘레 32칸을 정사각 판(S×S)에 깔고, CSS 3D 로 45° 돌려 눕힘(마름모 · 출발이 맨 아래 꼭짓점).
 *  - 판 위(눕는 것): 칸 바닥 (종류별 색 · 큰 그림 · 값) · 가운데 맵 그림
 *  - 판 밖(서는 것, 화면 기준 똑바로): 별 · 함정 · 말
 *  - proj() 가 CSS 변환과 같은 계산이라 서는 것들이 정확히 그 칸 위에 섬
 *  - 말(캐릭터)만 도트. 네 귀퉁이는 비워서 플레이어 카드 자리.
 */

/** 판 한 변 · 모서리 칸 · 변 칸 */
const S = 680;
const C = 96;
const SW = (S - 2 * C) / 7;
/** 무대에서 판 가운데 · 기울기 · 원근 */
const CX = 512;
const CY = 286;
const TILT = (60 * Math.PI) / 180;
const PERSP = 3000;
const PLANE_TF = `perspective(${PERSP}px) rotateX(60deg) rotateZ(45deg)`;

/** 판 위 좌표(px, 왼쪽 위 0) → 무대 좌표 + 원근 배율 (CSS 의 rotateZ(45) → rotateX → perspective 와 같은 계산) */
export function proj(px: number, py: number) {
  const X = px - S / 2;
  const Y = py - S / 2;
  const x1 = (X - Y) * Math.SQRT1_2;
  const y1 = (X + Y) * Math.SQRT1_2;
  const y2 = y1 * Math.cos(TILT);
  const z = y1 * Math.sin(TILT);
  const k = PERSP / (PERSP - z);
  return { x: CX + x1 * k, y: CY + y2 * k, k };
}

/** 격자 한 축의 [시작, 끝] (모서리 칸은 크게) */
const span = (g: number): [number, number] => (g <= 0 ? [0, C] : g >= 8 ? [C + 7 * SW, S] : [C + (g - 1) * SW, C + g * SW]);
const mid = (g: number) => {
  const [p, q] = span(g);
  return (p + q) / 2;
};
/** 격자(소수 가능) → 판 좌표 (칸 가운데끼리 이어 붙임) */
const axis = (g: number) => {
  const lo = Math.max(0, Math.min(7, Math.floor(g)));
  return mid(lo) + (mid(lo + 1) - mid(lo)) * (g - lo);
};
const rectOf = (gx: number, gy: number) => {
  const [x0, x1] = span(gx);
  const [y0, y1] = span(gy);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** 격자 좌표 → 무대 좌표 (칸 가운데) */
export const iso = (gx: number, gy: number) => {
  const p = proj(axis(gx), axis(gy));
  return { x: p.x, y: p.y };
};
/** 자리 → 무대 좌표 (말 발끝) */
export const slotXY = (m: MapDef, slot: number) => {
  const { x: gx, y: gy } = m.tiles[slot];
  const p = proj(axis(gx), axis(gy));
  return { x: p.x, y: p.y };
};

function rgb(hex: string): [number, number, number] {
  if (hex.startsWith("rgb")) return hex.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** 흰색과 섞기 (white 0~1) */
export function mix(hex: string, white: number) {
  const [r, g, b] = rgb(hex);
  const f = (v: number) => Math.round(v + (255 - v) * white);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export function dark(hex: string, k: number) {
  const [r, g, b] = rgb(hex);
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}

export type GlyphName = "flag" | "coin" | "minus" | "gift" | "wrench" | "note" | "portal" | "bag" | "star" | "crown" | "fire" | "vs" | "trap" | "ask" | "lock" | "dice" | "boot" | "shield";

/** 칸 종류: 바탕색 · 그림 · 짧은 이름 */
export const KIND: Record<TileDef["kind"], { fill: string; ink: string; glyph: GlyphName; label: string; desc: string }> = {
  start: { fill: "#ffcf3f", ink: "#5a3a00", glyph: "flag", label: "출발", desc: `지나가면 코인 +${RULE.start}` },
  blue: { fill: "#4b8dff", ink: "#fff", glyph: "coin", label: "코인", desc: `서면 코인 +${RULE.blue}` },
  red: { fill: "#ff5a6e", ink: "#fff", glyph: "minus", label: "손해", desc: `서면 코인 −${RULE.red} (잭팟에 쌓여요)` },
  item: { fill: "#ff8fd0", ink: "#fff", glyph: "gift", label: "아이템", desc: `아이템 1장 (최대 ${RULE.maxCards}장 · 꽉 차면 코인 +${RULE.fullHandCoins})` },
  vs: { fill: "#ff9a3d", ink: "#fff", glyph: "vs", label: "VS", desc: `상대 하나를 골라 주사위 두 개 대결 — 이기면 ${RULE.vsStake}코인 뺏기` },
  star: { fill: "#ffd23a", ink: "#5a3a00", glyph: "star", label: "별 자리", desc: `별이 뜨는 자리 — 별이 있으면 지나가기만 해도 ${RULE.starPrice}코인에 사요 (없으면 +${RULE.starEmpty})` },
  trap: { fill: "#8d9bb3", ink: "#fff", glyph: "trap", label: "함정", desc: "서면 다음 차례 다시 굴리기 0번" },
  warp: { fill: "#6f7bff", ink: "#fff", glyph: "portal", label: "워프", desc: "서면 원하는 칸으로 순간이동 (별 칸 빼고)" },
  fest: { fill: "#b07bff", ink: "#fff", glyph: "note", label: "축제", desc: `주사위 하나 굴려 그 눈 × ${RULE.festPer}코인` },
  jackpot: { fill: "#ffb21e", ink: "#5a3a00", glyph: "bag", label: "잭팟", desc: "빨강 칸 · 세금으로 쌓인 코인을 몽땅!" },
  event: { fill: "#2fc7a6", ink: "#fff", glyph: "ask", label: "소식", desc: "마을 소식 카드 한 장 (좋을 수도, 나쁠 수도)" },
};

/** 판 바탕 · 옆면 */
const PLATE = { top: "#f6e3b4", side: "#a86f3a" };

/** 이동 경로: 지나갈 칸 (자리 번호) · 지금 어디까지 왔는지 · 도착 칸 숫자 */
export interface Trail {
  id: number;
  slots: number[];
  /** 지금까지 밟은 칸 수 (0 = 아직 출발 전) */
  at: number;
  color: string;
  /** 도착 칸 위에 크게 띄울 숫자 */
  n: number;
  /** 미리 보기 (아직 안 감 — 흐리게, 숫자만) */
  preview?: boolean;
}

export interface TokenView {
  pi: number;
  slot: number;
  sprite: string;
  anim: TokenAnim;
  face: 1 | -1;
  hop?: number;
  dim?: boolean;
  /** 머리 위 말풍선 (남의 차례: 뭘 하는 중인지) */
  say?: string;
  /** 다음 차례 다시 굴리기 0번 · 방패 */
  sleep?: boolean;
  shield?: boolean;
}

const INK = "#262b52";

export default function Board({
  g,
  tokens,
  star,
  pick,
  onPick,
  onInfo,
  flash,
  trail,
  reach,
  onReach,
  frenzy,
}: {
  g: GameWire;
  tokens: TokenView[];
  /** 별이 서 있는 자리 (−1 = 안 보임, 이사 중) */
  star: number;
  pick?: number[] | null;
  onPick?(slot: number): void;
  /** 칸을 누르면 (고르기 중이 아닐 때) 칸 정보 */
  onInfo?(slot: number): void;
  flash?: Record<number, string>;
  trail?: Trail | null;
  /** 이동 고르기: 갈 수 있는 칸 (자리 → 칸 수 · 고른 것) */
  reach?: Record<number, { n: number; on: boolean }> | null;
  onReach?(slot: number): void;
  frenzy?: boolean;
}) {
  const m = MAPS[g.map];
  const planeBox: CSSProperties = { left: CX - S / 2, top: CY - S / 2, width: S, height: S, transformOrigin: "50% 50%" };
  const FR = 16;
  const frameBox: CSSProperties = { left: CX - S / 2 - FR, top: CY - S / 2 - FR, width: S + 2 * FR, height: S + 2 * FR, transformOrigin: "50% 50%" };
  return (
    <div className="mbx absolute inset-0 isolate">
      {/* 판 옆면(두께) · 흰 테두리 — 칸 바깥으로 FR 만큼 큰 판을 같은 변환으로 */}
      <div className="pointer-events-none absolute rounded-[34px]" style={{ ...frameBox, transform: `translateY(22px) ${PLANE_TF}`, background: `linear-gradient(135deg, ${PLATE.side}, ${dark(PLATE.side, 0.7)})`, boxShadow: "0 0 70px 14px rgba(10,8,30,0.55)" }} />
      <div className="pointer-events-none absolute rounded-[34px]" style={{ ...frameBox, transform: `translateY(11px) ${PLANE_TF}`, background: dark(PLATE.side, 0.85) }} />
      <div className="pointer-events-none absolute rounded-[34px]" style={{ ...frameBox, transform: PLANE_TF, background: frenzy ? "linear-gradient(135deg, #ffe08a, #ff9a3d)" : "linear-gradient(135deg, #ffffff, #e8ecf6)", boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.9), inset 0 -4px 10px rgba(38,43,82,0.15)" }} />
      {/* 판 윗면 */}
      <div className="absolute rounded-[26px]" style={{ ...planeBox, transform: PLANE_TF, background: `linear-gradient(135deg, ${mix(PLATE.top, 0.4)}, ${PLATE.top})`, boxShadow: "inset 0 0 0 4px rgba(255,255,255,0.6)" }}>
        <Center m={m} />
        {m.tiles.map((d, slot) => {
          const r = rectOf(d.x, d.y);
          const can = !!pick?.includes(slot);
          const here = tokens.filter((tk) => tk.slot === slot && !tk.dim).map((tk) => tk.pi);
          const rc = reach?.[slot];
          return (
            <button
              key={slot}
              type="button"
              aria-label={d.name}
              onClick={() => (can ? onPick?.(slot) : rc && onReach ? onReach(slot) : onInfo?.(slot))}
              className="absolute cursor-pointer p-[3px]"
              style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
            >
              <TileFace d={d} sx={d.x} sy={d.y} star={slot === star} pot={d.kind === "jackpot" ? g.pot : 0} frenzy={!!frenzy} />
              {here.length > 0 && <span className="pointer-events-none absolute inset-[2px] rounded-[10px]" style={{ boxShadow: `inset 0 0 0 4px ${PCOLOR[here[0]]}, 0 0 16px 3px ${PCOLOR[here[0]]}` }} />}
              {can && <span className="mbx-pick pointer-events-none absolute inset-[2px] rounded-[10px]" />}
              {/* 고르는 중: 못 고르는 칸은 어둡게 (고를 칸이 확 보이게) */}
              {pick && pick.length > 0 && !can && <span className="pointer-events-none absolute inset-[2px] rounded-[10px] bg-[rgba(20,16,50,0.5)]" />}
              {rc && <ReachChip n={rc.n} on={rc.on} sx={d.x} sy={d.y} />}
              {flash?.[slot] && <span className="pointer-events-none absolute inset-[3px] rounded-[9px]" style={{ boxShadow: `inset 0 0 0 5px ${flash[slot]}`, background: "rgba(255,255,255,0.4)" }} />}
              {trail && trail.slots.includes(slot) && <TrailChip k={trail.slots.indexOf(slot)} trail={trail} sx={d.x} sy={d.y} />}
            </button>
          );
        })}
      </div>

      {/* 서는 것들: 함정 (칸 뒤쪽) */}
      {g.traps.map((owner, slot) => {
        if (owner < 0) return null;
        const d = m.tiles[slot];
        const q = proj(axis(d.x), axis(d.y));
        return (
          <div key={`t${slot}`} className="pointer-events-none absolute" style={{ left: q.x - 22, top: q.y - 4, zIndex: 100 + Math.round(q.y), transform: `translate(-50%, -100%) scale(${q.k})`, transformOrigin: "50% 100%" }}>
            <span className="mb-pop relative block" style={{ filter: "drop-shadow(0 2px 1.5px rgba(20,24,60,0.45))" }}>
              <Glyph n="trap" size={30} color={PCOLOR[owner]} />
            </span>
          </div>
        );
      })}

      {/* 별: 빛기둥 + 둥실 떠 있는 큰 별 */}
      {star >= 0 &&
        (() => {
          const d = m.tiles[star];
          const q = proj(axis(d.x), axis(d.y));
          return (
            <div key={`star${star}`} className="pointer-events-none absolute" style={{ left: q.x, top: q.y, zIndex: 100 + Math.round(q.y) }}>
              <div className="absolute bottom-[-6px] left-1/2 h-[18px] w-[70px] -translate-x-1/2 rounded-[50%]" style={{ background: "radial-gradient(closest-side, rgba(255,226,90,0.95), rgba(255,226,90,0))" }} />
              <div className="mbx-beam absolute bottom-0 left-1/2 h-[210px] w-[46px] -translate-x-1/2" style={{ background: "linear-gradient(0deg, rgba(255,230,120,0.85), rgba(255,240,170,0.35) 55%, transparent)", filter: "blur(4px)", borderRadius: "40% 40% 12px 12px" }} />
              <div className="mb-pop absolute bottom-[34px] left-1/2 -translate-x-1/2">
                <div className="mbx-star-bob" style={{ filter: "drop-shadow(0 0 14px rgba(255,214,60,0.95)) drop-shadow(0 4px 0 rgba(120,70,0,0.45))" }}>
                  <Glyph n="star" size={58} color="#ffd23a" />
                </div>
              </div>
            </div>
          );
        })()}

      {/* 도착 칸 빛기둥 (말 뒤) */}
      {trail &&
        !trail.preview &&
        (() => {
          const sd = m.tiles[trail.slots[trail.slots.length - 1]];
          if (!sd) return null;
          const c = proj(axis(sd.x), axis(sd.y));
          const arrived = trail.at >= trail.slots.length;
          return (
            <div key={`beam${trail.id}`} className="pointer-events-none absolute" style={{ left: c.x, top: c.y + 4, zIndex: 99 + Math.round(c.y) }}>
              <div className="absolute bottom-0 left-1/2 h-[16px] w-[64px] -translate-x-1/2 translate-y-1/2 rounded-[50%]" style={{ background: `radial-gradient(closest-side, ${trail.color}cc, ${trail.color}00)`, opacity: arrived ? 0 : 1, transition: "opacity 400ms" }} />
              <div className="absolute bottom-0 left-1/2 h-[120px] w-[34px] -translate-x-1/2" style={{ background: `linear-gradient(0deg, ${trail.color}aa, ${trail.color}33 55%, transparent)`, filter: "blur(5px)", borderRadius: "40% 40% 10px 10px", opacity: arrived ? 0 : 0.9, transition: "opacity 400ms" }} />
            </div>
          );
        })()}
      {/* 말 */}
      {tokens.map((tk) => {
        const c = slotXY(m, tk.slot);
        const same = tokens.filter((o) => o.slot === tk.slot);
        const k = same.indexOf(tk);
        const off = same.length > 1 ? (k - (same.length - 1) / 2) * 16 : 0;
        const kk = proj(axis(m.tiles[tk.slot].x), axis(m.tiles[tk.slot].y)).k;
        return (
          <div
            key={tk.pi}
            className="pointer-events-none absolute"
            style={{
              left: c.x + off,
              top: c.y + 2 + (same.length > 1 ? (k % 2) * 3 : 0),
              zIndex: 101 + Math.round(c.y) + k,
              transform: `translate(-50%, -100%) scale(${kk})`,
              transformOrigin: "50% 100%",
              transition: "left 160ms ease-out, top 160ms ease-out",
              opacity: tk.dim ? 0.35 : 1,
            }}
          >
            <div className="absolute bottom-[-3px] left-1/2 h-[9px] w-[34px] -translate-x-1/2 rounded-[50%]" style={{ background: "rgba(20,24,60,0.35)" }} />
            <div key={tk.hop} className={tk.hop ? "mb-hop" : undefined} style={tk.sleep ? { filter: "saturate(0.55) brightness(0.92)" } : undefined}>
              <Token sprite={tk.sprite} anim={tk.anim} h={46} face={tk.face} />
            </div>
            {tk.shield && <span className="mbx-bubble pointer-events-none absolute bottom-[-6px] left-1/2 h-[66px] w-[60px] -translate-x-1/2 rounded-[50%]" />}
            {tk.sleep && (
              <span className="pointer-events-none absolute -top-[30px] left-[62%] block h-[30px] w-[30px]">
                <i className="mbx-zz" style={{ left: 0, animationDelay: "0ms" }}>Z</i>
                <i className="mbx-zz" style={{ left: 8, animationDelay: "600ms", fontSize: 15 }}>Z</i>
                <i className="mbx-zz" style={{ left: 15, animationDelay: "1200ms", fontSize: 19 }}>Z</i>
              </span>
            )}
            {tk.say && (
              <div className="absolute -top-[54px] left-1/2 -translate-x-1/2">
                <div key={tk.say} className="mbx-pop relative rounded-full bg-white px-2.5 text-[12px] leading-[22px] font-bold whitespace-nowrap text-[#262b52]" style={{ boxShadow: `0 0 0 2px ${PCOLOR[tk.pi]}, 0 3px 8px rgba(0,0,0,0.3)` }}>
                  {tk.say}
                  <span className="absolute -bottom-[5px] left-1/2 h-[9px] w-[9px] -translate-x-1/2 rotate-45 bg-white" style={{ boxShadow: `2px 2px 0 0 ${PCOLOR[tk.pi]}` }} />
                </div>
              </div>
            )}
            {/* 머리 위 깃발: 1P · 2P … */}
            <div className="mb-bob absolute -top-[22px] left-1/2 flex -translate-x-[2px] items-start">
              <span className="block h-[22px] w-[2px] rounded-full bg-[#262b52]" />
              <span className="-ml-[1px] block rounded-r-[5px] rounded-bl-[2px] px-[4px] text-[10px] leading-[13px] font-black text-white" style={{ background: PCOLOR[tk.pi], boxShadow: "0 0 0 1.5px #fff, 0 1px 3px rgba(0,0,0,0.45)" }}>
                {tk.pi + 1}P
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 이동 고르기: 갈 수 있는 칸에 걸음 수 (고른 칸은 크게 · 금색) */
function ReachChip({ n, on, sx, sy }: { n: number; on: boolean; sx: number; sy: number }) {
  const col = (sx <= 0 || sx >= 8) && !(sy <= 0 || sy >= 8);
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ zIndex: 4 }}>
      <span
        className={`flex items-center justify-center rounded-full font-black ${on ? "mbx-pick-on" : ""}`}
        style={{
          width: on ? 34 : 26,
          height: on ? 34 : 26,
          fontSize: on ? 18 : 14,
          background: on ? "radial-gradient(circle at 35% 30%, #fffbe8, #ffd23a 60%, #f0a020)" : "rgba(38,43,82,0.82)",
          color: on ? "#4a2600" : "#fff",
          boxShadow: on ? "0 0 0 3px #fff, 0 0 14px 4px rgba(255,210,60,0.9)" : "0 0 0 2px #fff, 0 2px 5px rgba(0,0,0,0.35)",
          transform: col ? "rotate(-90deg)" : undefined,
          transition: "all 150ms",
        }}
      >
        {n}
      </span>
    </span>
  );
}

/** 이동 경로 숫자 (칸 바닥) — 지나간 칸은 흐려지고, 지금 칸 · 도착 칸은 크게 */
function TrailChip({ k, trail, sx, sy }: { k: number; trail: Trail; sx: number; sy: number }) {
  const last = k === trail.slots.length - 1;
  const passed = k < trail.at - 1;
  const now = k === trail.at - 1;
  const col = (sx <= 0 || sx >= 8) && !(sy <= 0 || sy >= 8);
  const size = last ? 34 : now ? 30 : 24;
  if (trail.preview && last) return null;
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ zIndex: 5 }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          fontSize: last ? 18 : 14,
          color: passed ? "rgba(255,255,255,0.85)" : now || last ? "#fff" : trail.color,
          background: passed ? `${trail.color}88` : now || last ? trail.color : "rgba(255,255,255,0.92)",
          boxShadow: `0 0 0 2px ${now || last ? "#fff" : trail.color}, 0 2px 4px rgba(0,0,0,0.3)`,
          transform: `${col ? "rotate(-90deg) " : ""}scale(${now ? 1.1 : trail.preview ? 0.85 : 1})`,
          transition: "all 150ms",
          opacity: passed ? 0.6 : trail.preview ? 0.85 : 1,
        }}
      >
        {k + 1}
      </span>
    </span>
  );
}

/** 판 위에 눕는 칸 바닥: 종류 색 + 큰 그림 + 값 */
function TileFace({ d, sx, sy, star, pot, frenzy }: { d: TileDef; sx: number; sy: number; star: boolean; pot: number; frenzy: boolean }) {
  const sp = KIND[d.kind];
  const corner = sx % 8 === 0 && sy % 8 === 0;
  const x = frenzy ? 2 : 1;
  // 큰 숫자 (파랑 · 빨강 · 잭팟)
  const val = d.kind === "blue" ? `+${RULE.blue * x}` : d.kind === "red" ? `−${RULE.red * x}` : d.kind === "jackpot" ? `${pot}` : null;
  const fill = d.kind === "star" && !star ? "#ffe9a6" : sp.fill;
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[10px]" style={{ background: `radial-gradient(circle at 35% 30%, ${mix(fill, 0.55)}, ${fill} 60%, ${dark(fill, 0.85)})`, boxShadow: `inset 0 0 0 2px ${dark(fill, 0.7)}, inset 0 3px 0 rgba(255,255,255,0.5)` }}>
      {(d.kind === "star" || d.kind === "jackpot") && <div className="mbx-sheen pointer-events-none absolute inset-0" />}
      <FloorText sx={sx} sy={sy}>
        <span className="flex flex-col items-center gap-[1px]">
          {val !== null && d.kind !== "jackpot" ? (
            <>
              <Glyph n={sp.glyph} size={22} color={d.kind === "blue" ? "#ffe14a" : "#fff"} />
              <b className={`leading-none font-black ${frenzy ? "mbx-hot rounded-full px-1" : ""}`} style={{ fontSize: 17, color: "#fff", textShadow: "0 1.5px 0 rgba(0,0,0,0.35)" }}>
                {val}
              </b>
            </>
          ) : (
            <>
              <Glyph n={sp.glyph} size={corner ? 40 : d.kind === "star" && !star ? 22 : 26} color={sp.ink === "#fff" ? "#fff" : d.kind === "star" ? (star ? "#fff6c0" : "#fff") : mix(sp.fill, 0.55)} />
              <b className="leading-none font-black whitespace-nowrap" style={{ fontSize: corner ? 16 : 12, color: d.kind === "star" && !star ? "#a87a00" : sp.ink, textShadow: sp.ink === "#fff" ? "0 1px 2px rgba(0,0,0,0.5)" : "none" }}>
                {corner ? d.name : sp.label}
              </b>
              {d.kind === "jackpot" && (
                <span className={`rounded-full px-[6px] text-[12px] leading-[16px] font-black text-white ${pot > RULE.potSeed ? "mbx-hot" : ""}`} style={{ background: pot > RULE.potSeed ? "#ff6a2b" : "#c98a00", boxShadow: "0 0 0 1.5px #fff" }}>
                  {val}
                </span>
              )}
            </>
          )}
        </span>
      </FloorText>
    </div>
  );
}

/** 판 바닥에 찍힌 글씨: 그 변을 따라 대각선으로 (위 · 아래 줄은 판 가로 방향 ↘, 왼쪽 · 오른쪽 줄은 세로 방향 ↗) */
function FloorText({ sx, sy, children }: { sx: number; sy: number; children: ReactNode }) {
  const col = (sx <= 0 || sx >= 8) && !(sy <= 0 || sy >= 8);
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span style={{ transform: col ? "rotate(-90deg)" : undefined }}>{children}</span>
    </span>
  );
}

/** 매끈한 그림 표식 (보드는 도트 아님) */
export function Glyph({ n, size = 20, color = INK }: { n: GlyphName; size?: number; color?: string }) {
  const s = { stroke: INK, strokeWidth: 1.6, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  const body: Record<GlyphName, ReactNode> = {
    flag: (
      <>
        <path d="M6 3v19" {...s} fill="none" />
        <path d="M6 4h12l-3 4 3 4H6z" fill={color} {...s} />
      </>
    ),
    coin: (
      <>
        <circle cx="12" cy="12" r="8.5" fill={color} {...s} />
        <path d="M12 7.5v9M14.5 9.5h-4a1.8 1.8 0 000 3.5h3a1.8 1.8 0 010 3.5h-4" fill="none" {...s} />
      </>
    ),
    minus: (
      <>
        <circle cx="12" cy="12" r="8.5" fill={color} {...s} />
        <path d="M7.5 12h9" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      </>
    ),
    gift: (
      <>
        <rect x="4" y="9" width="16" height="12" rx="2" fill={color} {...s} />
        <rect x="3" y="6.5" width="18" height="4" rx="1.5" fill="#ffe14a" {...s} />
        <path d="M12 6.5V21M12 6.5c-2-4-6-3-5 0M12 6.5c2-4 6-3 5 0" fill="none" {...s} />
      </>
    ),
    wrench: <path d="M15 3a5 5 0 00-4.6 6.9L3.5 16.8a1.8 1.8 0 002.6 2.6l6.9-6.9A5 5 0 0019 7.5l-3 3-2.5-.5-.5-2.5 3-3A5 5 0 0015 3z" fill={color} {...s} />,
    note: (
      <>
        <path d="M9 18V5l11-2v13" fill="none" {...s} />
        <circle cx="6.5" cy="18" r="3" fill={color} {...s} />
        <circle cx="17.5" cy="16" r="3" fill={color} {...s} />
      </>
    ),
    portal: (
      <>
        <circle cx="12" cy="12" r="9" fill={color} {...s} />
        <path d="M12 6a6 6 0 016 6 4 4 0 01-4 4 2.5 2.5 0 01-2.5-2.5" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      </>
    ),
    bag: (
      <>
        <path d="M8 7l-2-3h12l-2 3" fill={color} {...s} />
        <path d="M8 7h8c3 3 5 7 4 10.5-.6 2.2-2.6 3.5-5 3.5H9c-2.4 0-4.4-1.3-5-3.5C3 14 5 10 8 7z" fill={color} {...s} />
        <path d="M12 11v6M14 12.2h-2.8a1.2 1.2 0 000 2.4h1.6a1.2 1.2 0 010 2.4H10" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
      </>
    ),
    star: <path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3L2.8 9.5l6.4-.9z" fill={color} {...s} />,
    crown: (
      <>
        <path d="M3 8l4.5 4L12 4l4.5 8L21 8l-2 12H5z" fill={color} {...s} />
        <path d="M5.5 17h13" stroke="#fff" strokeWidth={2} />
        <circle cx="12" cy="12.5" r="1.6" fill="#ffe14a" stroke={INK} strokeWidth={1} />
      </>
    ),
    fire: <path d="M12 2.5c1 4 5 5.5 5 10.5a5 5 0 01-10 0c0-2.5 1.2-3.8 2.2-5 .2 1.8 1 2.7 2 3-.8-3 0-6 .8-8.5z" fill={color} {...s} />,
    vs: (
      <>
        <path d="M4 4l7 8M20 4l-7 8" stroke={INK} strokeWidth={4.2} strokeLinecap="round" />
        <path d="M4 4l7 8M20 4l-7 8" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
        <text x="12" y="22" textAnchor="middle" fontSize="10" fontWeight="900" fill={color} stroke={INK} strokeWidth={1.2} paintOrder="stroke" fontFamily="system-ui, sans-serif">
          VS
        </text>
      </>
    ),
    trap: (
      <>
        <path d="M3 18h18" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M4 18l2.5-9 2.5 9 3-11 3 11 2.5-9 2.5 9z" fill={color} {...s} />
      </>
    ),
    ask: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="3" fill={color} {...s} />
        <path d="M9.5 9.5a2.6 2.6 0 115 1c-.6 1-2.5 1.5-2.5 3" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
        <circle cx="12" cy="17" r="1.2" fill={INK} />
      </>
    ),
    lock: (
      <>
        <path d="M8 10V7.5a4 4 0 018 0V10" fill="none" stroke={INK} strokeWidth={2.2} />
        <rect x="5" y="10" width="14" height="11" rx="2.5" fill={color} {...s} />
        <circle cx="12" cy="15.5" r="1.6" fill={INK} />
      </>
    ),
    dice: (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="4" fill={color} {...s} />
        <circle cx="8.5" cy="8.5" r="1.6" fill={INK} />
        <circle cx="15.5" cy="15.5" r="1.6" fill={INK} />
        <circle cx="12" cy="12" r="1.6" fill={INK} />
      </>
    ),
    boot: <path d="M7 3h6v9l6 3c1.2.6 2 1.8 2 3.2V20H4V4a1 1 0 011-1z" fill={color} {...s} />,
    shield: <path d="M12 2.5l8 3v6c0 5-3.5 8.6-8 10-4.5-1.4-8-5-8-10v-6z" fill={color} {...s} />,
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="block shrink-0" aria-hidden>
      {body[n]}
    </svg>
  );
}

/** 판 가운데: 맵 그림 (판 회전을 되돌려 화면에서 똑바로) + 맵 이름 */
function Center({ m }: { m: MapDef }) {
  const inset = C + 8;
  const w = S - 2 * inset;
  return (
    <div className="pointer-events-none absolute overflow-hidden rounded-[18px]" style={{ left: inset, top: inset, width: w, height: w, boxShadow: "0 0 0 4px #f5c451, 0 0 0 7px #8a5a12, inset 0 0 40px rgba(20,16,50,0.35)" }}>
      <img src={`/marble/bg/center-${m.id}.webp`} alt="" className="absolute top-1/2 left-1/2 max-w-none" style={{ width: w * 1.42, height: w * 1.42, transform: "translate(-50%, -50%) rotate(-45deg)", objectFit: "cover", filter: "saturate(0.85) brightness(0.8)" }} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle, rgba(20,16,50,0.15) 20%, rgba(20,16,50,0.55))" }} />
      {/* 판에 찍힌 로고 (똑바로 읽히게 판 회전을 되돌림) */}
      <div className="absolute top-1/2 left-1/2 text-center" style={{ transform: "translate(-50%, -50%) rotate(-45deg)" }}>
        <div className="text-[64px] leading-none font-black tracking-tight whitespace-nowrap" style={{ color: "rgba(255,255,255,0.28)", textShadow: "0 4px 0 rgba(38,43,82,0.25)" }}>
          DICE TOWN
        </div>
      </div>
    </div>
  );
}

/** 캐릭터 말 그림 id */
export const spriteOf = (charId: string) => CHAR[charId]?.sprite ?? "kai";
