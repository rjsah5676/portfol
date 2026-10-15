"use client";

import type { CSSProperties, ReactNode } from "react";
import { CHAR } from "@/lib/marble/data";
import { LANDMARK, builtOf, tollMult, tollOf, type Game } from "@/lib/marble/engine";
import { MAPS, type MapDef, type TileDef } from "@/lib/marble/maps";
import type { GameWire } from "@/lib/marble/wire";
import { PCOLOR } from "./pixel";
import Token, { type TokenAnim } from "./Token";

/*
 * 2.5D 보드 (모두의마블식) — 9×9 둘레 32칸을 정사각 판(S×S)에 깔고, CSS 3D 로 45° 돌려 눕힘(마름모 · 출발이 맨 아래 꼭짓점).
 *  - 판 위(눕는 것): 칸 바닥색 · 동네 띠 · 산 땅은 플레이어 색으로 꽉 · 특수칸 그림 · 가운데 맵 그림
 *  - 판 밖(서는 것, 화면 기준 똑바로): 건물(칸 뒤쪽) · 말(칸 가운데) · 이름판(칸 앞쪽, 맨 위 층 — 무엇에도 안 가림)
 *  - proj() 가 CSS 변환과 같은 계산이라 서는 것들이 정확히 그 칸 위에 섬
 *  - 말(캐릭터)만 도트. 네 귀퉁이는 비워서 플레이어 카드 자리.
 * 칸 좌표 = 맵 격자 (x, y). orgel 은 자리마다 지금 놓인 칸(game.order)을 그림.
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

type GlyphName = "flag" | "coin" | "gift" | "wrench" | "note" | "portal" | "bag" | "train" | "star" | "hut" | "house" | "tower" | "crown" | "fire";

/** 특수칸: 바탕색 · 그림 */
const KIND: Record<string, { fill: string; ink: string; glyph: GlyphName }> = {
  start: { fill: "#ffcf3f", ink: "#5a3a00", glyph: "flag" },
  start2: { fill: "#ffe680", ink: "#5a3a00", glyph: "coin" },
  box: { fill: "#ff8fbf", ink: "#fff", glyph: "gift" },
  jail: { fill: "#8d9bb3", ink: "#fff", glyph: "wrench" },
  fest: { fill: "#b07bff", ink: "#fff", glyph: "note" },
  warp: { fill: "#6f7bff", ink: "#fff", glyph: "portal" },
  tax: { fill: "#d9a35e", ink: "#fff", glyph: "bag" },
  bonus: { fill: "#ffd23a", ink: "#5a3a00", glyph: "coin" },
  rail: { fill: "#47b6ff", ink: "#fff", glyph: "train" },
};

/** 맵마다 판 바탕 · 옆면 */
const PLATE: Record<string, { top: string; side: string }> = {
  town: { top: "#f6e3b4", side: "#a86f3a" },
  cross: { top: "#f3d6a6", side: "#9a5d2e" },
  orgel: { top: "#f8d9e8", side: "#a8577f" },
};

/** 칸 안쪽 건물 자리 (판 px) */
const BLD_ZONE = 30;
/** 건물이 서는 곳: 칸 가운데에서 판 안쪽으로 (칸 깊이/2 − 건물 자리/2) */
const bldAt = (gx: number, gy: number) => {
  const d = C / 2 - BLD_ZONE / 2 - 3;
  const cx = axis(gx);
  const cy = axis(gy);
  if (gy >= 8) return { x: cx, y: cy - d };
  if (gy <= 0) return { x: cx, y: cy + d };
  if (gx <= 0) return { x: cx + d, y: cy };
  return { x: cx - d, y: cy };
};

/** 이동 경로: 지나갈 칸 (자리 번호) · 지금 어디까지 왔는지 · 도착 칸 숫자 */
export interface Trail {
  id: number;
  slots: number[];
  /** 지금까지 밟은 칸 수 (0 = 아직 출발 전) */
  at: number;
  color: string;
  /** 도착 칸 위에 크게 띄울 숫자 (굴린 눈) */
  n: number;
  dbl?: boolean;
  /** 마지막 몇 칸은 폴짝 · 묵직한 주사위로 더 간 칸 */
  plus?: number;
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
  /** 자장가에 걸려 자는 중 · 물방울 방패 */
  sleep?: boolean;
  shield?: boolean;
}

const fmtToll = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));
const INK = "#262b52";

export default function Board({
  g,
  tokens,
  pick,
  onPick,
  onInfo,
  flash,
  trail,
}: {
  g: GameWire;
  tokens: TokenView[];
  pick?: number[] | null;
  onPick?(tile: number): void;
  /** 칸을 누르면 (고르기 중이 아닐 때) 칸 정보 */
  onInfo?(tile: number): void;
  flash?: Record<number, string>;
  trail?: Trail | null;
}) {
  const m = MAPS[g.map];
  const gg = g as unknown as Game;
  const plate = PLATE[m.id] ?? PLATE.town;
  const planeBox: CSSProperties = { left: CX - S / 2, top: CY - S / 2, width: S, height: S, transformOrigin: "50% 50%" };
  const FR = 16;
  const frameBox: CSSProperties = { left: CX - S / 2 - FR, top: CY - S / 2 - FR, width: S + 2 * FR, height: S + 2 * FR, transformOrigin: "50% 50%" };
  return (
    <div className="mbx absolute inset-0 isolate">
      {/* 판 옆면(두께) · 흰 테두리 — 칸 바깥으로 FR 만큼 큰 판을 같은 변환으로 */}
      <div className="pointer-events-none absolute rounded-[34px]" style={{ ...frameBox, transform: `translateY(22px) ${PLANE_TF}`, background: `linear-gradient(135deg, ${plate.side}, ${dark(plate.side, 0.7)})`, boxShadow: "0 0 70px 14px rgba(10,8,30,0.55)" }} />
      <div className="pointer-events-none absolute rounded-[34px]" style={{ ...frameBox, transform: `translateY(11px) ${PLANE_TF}`, background: dark(plate.side, 0.85) }} />
      <div className="pointer-events-none absolute rounded-[34px]" style={{ ...frameBox, transform: PLANE_TF, background: "linear-gradient(135deg, #ffffff, #e8ecf6)", boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.9), inset 0 -4px 10px rgba(38,43,82,0.15)" }} />
      {/* 판 윗면 */}
      <div className="absolute rounded-[26px]" style={{ ...planeBox, transform: PLANE_TF, background: `linear-gradient(135deg, ${mix(plate.top, 0.4)}, ${plate.top})`, boxShadow: "inset 0 0 0 4px rgba(255,255,255,0.6)" }}>
        <Center m={m} />
        {m.tiles.map((sd, slot) => {
          const tile = g.order[slot];
          const d = m.tiles[tile];
          const t = g.tiles[tile];
          const r = rectOf(sd.x, sd.y);
          const can = !!pick?.includes(tile);
          const here = tokens.filter((tk) => tk.slot === slot && !tk.dim).map((tk) => tk.pi);
          return (
            <button
              key={slot}
              type="button"
              aria-label={d.name}
              onClick={() => (can ? onPick?.(tile) : onInfo?.(tile))}
              className="absolute cursor-pointer p-[3px]"
              style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
            >
              <TileFace m={m} d={d} owner={t.owner} sx={sd.x} sy={sd.y} toll={t.owner >= 0 ? tollOf(gg, tile) : 0} mult={t.owner >= 0 ? tollMult(gg, tile) : 1} fest={t.owner >= 0 && g.players[t.owner]?.fest === tile} boost={t.boostLeft > 0 ? t.boostLeft : 0} tw={r.w - 6} th={r.h - 6} />
              {here.length > 0 && <span className="pointer-events-none absolute inset-[2px] rounded-[10px]" style={{ boxShadow: `inset 0 0 0 4px ${PCOLOR[here[0]]}, 0 0 16px 3px ${PCOLOR[here[0]]}` }} />}
              {can && <span className="mbx-pick pointer-events-none absolute inset-[2px] rounded-[10px]" />}
              {flash?.[tile] && <span className="pointer-events-none absolute inset-[3px] rounded-[9px]" style={{ boxShadow: `inset 0 0 0 5px ${flash[tile]}`, background: "rgba(255,255,255,0.4)" }} />}
              {trail && trail.slots.includes(slot) && <TrailChip k={trail.slots.indexOf(slot)} trail={trail} sx={sd.x} sy={sd.y} />}
            </button>
          );
        })}
      </div>

      {/* 서는 것들: 건물(칸 뒤쪽) */}
      {m.tiles.map((sd, slot) => {
        const tile = g.order[slot];
        const d = m.tiles[tile];
        const t = g.tiles[tile];
        if (t.owner < 0 || (d.kind !== "city" && d.kind !== "spot")) return null;
        const b = bldAt(sd.x, sd.y);
        const lv = Math.min(t.lv, LANDMARK);
        const color = PCOLOR[t.owner];
        if (lv <= 0 || d.kind === "spot") {
          // 땅만 산 칸: 주인 깃발 하나 꽂아 둠
          const q = proj(b.x, b.y);
          return (
            <div key={`b${slot}`} className="pointer-events-none absolute" style={{ left: q.x, top: q.y + 2, zIndex: 100 + Math.round(q.y), transform: `translate(-30%, -100%) scale(${q.k})`, transformOrigin: "30% 100%" }}>
              <span key={`${t.owner}-f`} className="mb-pop block" style={{ filter: "drop-shadow(0 2px 1.5px rgba(20,24,60,0.4))" }}>
                <Glyph n="flag" size={30} color={color} />
              </span>
            </div>
          );
        }
        if (lv >= LANDMARK) {
          // 랜드마크: 칸 가운데 쪽에 하나 크게 (칸마다 다른 그림)
          const c = proj((b.x + axis(sd.x)) / 2, (b.y + axis(sd.y)) / 2);
          return (
            <div key={`b${slot}`} className="pointer-events-none absolute" style={{ left: c.x, top: c.y + 6, zIndex: 100 + Math.round(c.y), transform: `translate(-50%, -100%) scale(${c.k})`, transformOrigin: "50% 100%" }}>
              <Landmark key={`${t.owner}-lm`} src={`/marble/lm/${m.id}-${tile}.webp`} color={color} />
            </div>
          );
        }
        // 빌라 · 빌딩 · 호텔: 칸의 변 방향(대각선)을 따라 나란히 — 조각마다 따로 투영해서 판과 같은 기울기로
        const along = sd.y <= 0 || sd.y >= 8 ? { x: 1, y: 0 } : { x: 0, y: 1 };
        const gap = 19;
        // 건물마다 자리 고정 (오두막 · 하우스 · 타워 = 다 찼을 때 자리 그대로)
        return builtOf(t).map((k) => {
          const i = k - 1;
          const o = (i - 1) * gap;
          const q = proj(b.x + along.x * o, b.y + along.y * o);
          return (
            <div key={`b${slot}-${i}`} className="pointer-events-none absolute" style={{ left: q.x, top: q.y + 3, zIndex: 100 + Math.round(q.y), transform: `translate(-50%, -100%) scale(${q.k})`, transformOrigin: "50% 100%" }}>
              <Piece key={`${t.owner}-${i}`} n={i} owner={t.owner} />
            </div>
          );
        });
      })}

      {/* 도착 칸 빛기둥 (말 뒤) */}
      {trail &&
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
      {/* 도착 칸: 굴린 눈 (말보다 위) */}
      {trail &&
        (() => {
          const dest = trail.slots[trail.slots.length - 1];
          const sd = m.tiles[dest];
          if (!sd) return null;
          const c = proj(axis(sd.x), axis(sd.y));
          return (
            <div key={`dest${trail.id}`} className="pointer-events-none absolute" style={{ left: c.x, top: c.y, zIndex: 2000 }}>
              {/* 판 위쪽 칸이면 화면 밖 · 상단 표시와 안 겹치게 칸 아래로 */}
              <div className="absolute left-1/2 -translate-x-1/2" style={c.y < 230 ? { top: 22 } : { bottom: 120 }}>
              <div className="mbx-num flex flex-col items-center">
                {trail.dbl && <span className="mb-1 rotate-[-6deg] rounded-md bg-[#ff2d6f] px-2 text-[14px] leading-[20px] font-black text-white shadow-[0_2px_0_rgba(0,0,0,0.3)]">더블!</span>}
                <span className="flex h-[52px] min-w-[52px] items-center justify-center rounded-full px-2 text-[30px] font-black" style={{ background: "radial-gradient(circle at 35% 30%, #fffbe8, #ffd23a 60%, #f0a020)", color: "#4a2600", boxShadow: `0 0 0 3px #fff, 0 0 0 6px ${trail.color}, 0 6px 0 rgba(0,0,0,0.25), 0 0 26px 6px ${trail.color}88` }}>
                  {trail.n}
                </span>
                {!!trail.plus && <span className="-mt-1 rounded-full bg-[#2fc37a] px-2 text-[13px] leading-[18px] font-black text-white shadow-[0_0_0_2px_#fff]">+{trail.plus}</span>}
              </div>
              </div>
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

/** 이동 경로 숫자 (칸 바닥) — 지나간 칸은 흐려지고, 지금 칸 · 도착 칸은 크게 */
function TrailChip({ k, trail, sx, sy }: { k: number; trail: Trail; sx: number; sy: number }) {
  const last = k === trail.slots.length - 1;
  const bonus = !!trail.plus && k >= trail.slots.length - trail.plus;
  const passed = k < trail.at - 1;
  const now = k === trail.at - 1;
  const col = (sx <= 0 || sx >= 8) && !(sy <= 0 || sy >= 8);
  const size = last ? 34 : now ? 30 : 24;
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
          boxShadow: bonus ? `0 0 0 2px #2fc37a, 0 0 10px 2px #2fc37a, 0 2px 4px rgba(0,0,0,0.3)` : `0 0 0 2px ${now || last ? "#fff" : trail.color}, 0 2px 4px rgba(0,0,0,0.3)`,
          transform: `${col ? "rotate(-90deg) " : ""}scale(${now ? 1.1 : 1})`,
          transition: "all 150ms",
          opacity: passed ? 0.6 : 1,
        }}
      >
        {k + 1}
      </span>
    </span>
  );
}

/** 판 위에 눕는 칸 바닥 */
function TileFace({ m, d, owner, sx, sy, toll, mult, fest, boost, tw, th }: { m: MapDef; d: TileDef; owner: number; sx: number; sy: number; toll: number; mult: number; fest: boolean; /** 불꽃(스킬 부스트) 남은 바퀴 · 0 = 없음 */ boost: number; tw: number; th: number }) {
  const sp = KIND[d.kind];
  if (sp) {
    const corner = sx % 8 === 0 && sy % 8 === 0;
    const along = (sx <= 0 || sx >= 8) && !(sy <= 0 || sy >= 8) ? th : tw;
    const len = [...d.name].reduce((a, ch) => a + (ch === " " ? 0.45 : 1), 0);
    // 양옆 여백 남기고 한 줄
    const fs = Math.min(corner ? 19 : 15, Math.floor(((along - 10) / Math.max(1, len)) * 10) / 10);
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[10px]" style={{ background: `radial-gradient(circle at 35% 30%, ${mix(sp.fill, 0.55)}, ${sp.fill} 60%, ${dark(sp.fill, 0.85)})`, boxShadow: `inset 0 0 0 2px ${dark(sp.fill, 0.7)}, inset 0 3px 0 rgba(255,255,255,0.5)` }}>
        <FloorText sx={sx} sy={sy}>
          <span className="flex flex-col items-center gap-[2px]">
            <Glyph n={sp.glyph} size={sx % 8 === 0 && sy % 8 === 0 ? 40 : 24} color={sp.ink === "#fff" ? "#fff" : mix(sp.fill, 0.55)} />
            <b className="whitespace-nowrap leading-none font-black" style={{ fontSize: fs, color: sp.ink, textShadow: sp.ink === "#fff" ? "0 1px 2px rgba(0,0,0,0.5)" : "none" }}>
              {d.name}
            </b>
          </span>
        </FloorText>
      </div>
    );
  }
  const band = d.kind === "spot" ? "#ffb21e" : m.groups[d.group ?? 0].color;
  const pc = owner >= 0 ? PCOLOR[owner] : null;
  const col = sx <= 0 || sx >= 8;
  // 가까운 변(아래 줄 · 오른쪽 줄)은 위→아래가 안→밖, 먼 변은 글씨가 뒤집히지 않게 반대로
  const near = sy >= 8 || sx >= 8;
  // 이름은 무조건 한 줄 — 길면 글씨를 줄임
  const nameLen = [...d.name].reduce((a, ch) => a + (ch === " " ? 0.45 : 1), d.kind === "spot" ? 0.8 : 0);
  const nameSize = Math.min(16, Math.floor((((col ? th : tw) - 6) / Math.max(1, nameLen)) * 10) / 10);
  const parts = [
    <div key="b" className="shrink-0" style={{ height: BLD_ZONE }} />,
    <b key="n" className="block text-center leading-none font-black whitespace-nowrap" style={{ fontSize: nameSize, color: pc ? "#fff" : INK, textShadow: pc ? "0 1px 2px rgba(0,0,0,0.55)" : "0 1px 0 rgba(255,255,255,0.8)" }}>
      {d.kind === "spot" && "★"}
      {d.name}
    </b>,
    <span key="p" className="relative flex items-center justify-center gap-[2px]">
      {pc ? (
        <span className={`rounded-full bg-white px-[6px] text-[14px] leading-[18px] font-black ${boost ? "mbx-hot" : ""}`} style={{ color: boost ? "#d2401a" : dark(pc, 0.7), ...(boost ? {} : { boxShadow: `0 0 0 1.5px ${INK}` }) }}>
          {fmtToll(toll)}
        </span>
      ) : (
        <span className="rounded-full px-[6px] text-[13px] leading-[17px] font-black text-white" style={{ background: dark(band, 0.85), boxShadow: `0 0 0 1.2px ${INK}` }}>
          {d.price}
        </span>
      )}
      {/* 배율 · 축제 · 불꽃은 값 위 구석에 작게 (칸 너비를 넘지 않게) */}
      {(mult > 1 || fest || boost > 0) && (
        <span className="absolute -top-[10px] -right-[7px] flex items-center gap-[1px]">
          {mult > 1 && (
            <span className="rounded-full px-[3px] text-[10px] leading-[13px] font-black" style={{ background: mult >= 4 ? "#ff3d6e" : "#ffd23a", color: mult >= 4 ? "#fff" : "#3a2500", boxShadow: `0 0 0 1.2px ${INK}` }}>
              x{mult}
            </span>
          )}
          {fest && <Glyph n="note" size={12} color="#b07bff" />}
          {boost > 0 && (
            <span className="flex items-center rounded-full bg-[#ff6a2b] pr-[3px] text-[9px] leading-[12px] font-black text-white" title={`불꽃 ${boost}바퀴 남음`}>
              <Glyph n="fire" size={11} color="#ffd23a" />
              {boost}
            </span>
          )}
        </span>
      )}
    </span>,
    <div key="c" className="w-full shrink-0" style={{ height: 13, background: `linear-gradient(90deg, ${mix(band, 0.2)}, ${band})` }} />,
  ];
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[10px]" style={{ background: pc ? `linear-gradient(135deg, ${mix(pc, 0.35)}, ${pc})` : `linear-gradient(135deg, #fffdf6, ${mix(band, 0.82)})` }}>
      {/* 안 → 밖: 건물 자리 · 이름 · 값 · 동네 색 띠 (칸 길이 방향 = 변 방향) */}
      <div className="absolute top-1/2 left-1/2 flex flex-col items-center justify-between" style={{ width: col ? th : tw, height: col ? tw : th, transform: `translate(-50%, -50%) ${col ? "rotate(-90deg)" : ""}` }}>
        {near ? parts : [...parts].reverse()}
      </div>
      {/* 테두리는 맨 위에 다시 그려서 동네 색 띠까지 감쌈 */}
      <div className="pointer-events-none absolute inset-0 rounded-[10px]" style={{ boxShadow: pc ? `inset 0 0 0 2.5px ${dark(pc, 0.6)}, inset 0 3px 0 rgba(255,255,255,0.35)` : `inset 0 0 0 1.8px ${dark(band, 0.55)}` }} />
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

/** 건물 조각 하나 (빌라 · 빌딩 · 호텔) — 주인 색 지붕 · 차양이 칠해진 그림 */
export function Piece({ n, owner, h }: { n: number; owner: number; h?: number }) {
  return (
    <span className="mb-pop relative block" style={{ animationDelay: `${n * 80}ms`, filter: "drop-shadow(0 2px 1.5px rgba(20,24,60,0.45))" }}>
      <img src={`/marble/b3d/p${Math.max(0, owner) % 4}-${n + 1}.webp`} alt="" className="block max-w-none" style={{ height: h ?? [24, 30, 32][n] }} />
    </span>
  );
}

/** 랜드마크: 칸마다 다른 그림 + 주인 깃발 (밑 그림자 없음) */
function Landmark({ src, color }: { src: string; color: string }) {
  return (
    <div className="mb-pop relative flex flex-col items-center">
      <img src={src} alt="" className="relative block max-w-none" style={{ height: 54, filter: "drop-shadow(0 3px 3px rgba(20,24,60,0.35))" }} />
      <span className="mb-bob absolute -top-[12px] right-[0px]">
        <Glyph n="flag" size={17} color={color} />
      </span>
    </div>
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
      </>
    ),
    train: (
      <>
        <rect x="5" y="3" width="14" height="14" rx="3.5" fill={color} {...s} />
        <rect x="7.5" y="6" width="9" height="5" rx="1" fill="#bfe6ff" {...s} />
        <circle cx="9" cy="14" r="1.2" fill={INK} />
        <circle cx="15" cy="14" r="1.2" fill={INK} />
        <path d="M8 17l-2.5 4M16 17l2.5 4" {...s} />
      </>
    ),
    star: <path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3L2.8 9.5l6.4-.9z" fill={color} {...s} />,
    hut: (
      <>
        <path d="M3 13 Q12 3 21 13 L19 13 L19 21 L5 21 L5 13 Z" fill={color} {...s} />
        <path d="M10 21v-5a2 2 0 014 0v5" fill="#fff" {...s} />
      </>
    ),
    house: (
      <>
        <path d="M16 6V3h2.5v5" fill="#fff" {...s} />
        <path d="M3 11l9-8 9 8v10H3z" fill={color} {...s} />
        <path d="M3 15h18" stroke={INK} strokeWidth={1.2} />
        <rect x="6" y="11.5" width="3" height="2.5" fill="#fff" stroke={INK} strokeWidth={1} />
        <rect x="15" y="11.5" width="3" height="2.5" fill="#fff" stroke={INK} strokeWidth={1} />
        <rect x="10.5" y="16.5" width="3" height="4.5" fill="#fff" stroke={INK} strokeWidth={1} />
      </>
    ),
    tower: (
      <>
        <rect x="6" y="4" width="12" height="17" rx="1.5" fill={color} {...s} />
        <path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2" stroke="#fff" strokeWidth={2} />
      </>
    ),
    crown: (
      <>
        <path d="M3 8l4.5 4L12 4l4.5 8L21 8l-2 12H5z" fill={color} {...s} />
        <path d="M5.5 17h13" stroke="#fff" strokeWidth={2} />
        <circle cx="12" cy="12.5" r="1.6" fill="#ffe14a" stroke={INK} strokeWidth={1} />
      </>
    ),
    fire: <path d="M12 2.5c1 4 5 5.5 5 10.5a5 5 0 01-10 0c0-2.5 1.2-3.8 2.2-5 .2 1.8 1 2.7 2 3-.8-3 0-6 .8-8.5z" fill={color} {...s} />,
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
