"use client";

import type { CSSProperties, ReactNode } from "react";
import { CHAR } from "@/lib/marble/data";
import { LANDMARK, tollMult, tollOf, type Game } from "@/lib/marble/engine";
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
/** 칸 가운데 → 판 가운데 쪽으로 t 만큼 (뒤 · 앞 고르기용) */
const toward = (gx: number, gy: number, t: number) => {
  const cx = axis(gx);
  const cy = axis(gy);
  return { x: cx + (S / 2 - cx) * t, y: cy + (S / 2 - cy) * t };
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

/** 건물 그림 (있으면 그림, 없으면 매끈한 표식) — 단계 1 오두막 · 2 하우스 · 3 타워 · 4 랜드마크 */
const BLD = ["", "/marble/b3d/1.webp", "/marble/b3d/2.webp", "/marble/b3d/3.webp", "/marble/b3d/4.webp"];
const BLD_H = [0, 36, 42, 54, 60];

export interface TokenView {
  pi: number;
  slot: number;
  sprite: string;
  anim: TokenAnim;
  face: 1 | -1;
  hop?: number;
  dim?: boolean;
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
}: {
  g: GameWire;
  tokens: TokenView[];
  pick?: number[] | null;
  onPick?(tile: number): void;
  /** 칸을 누르면 (고르기 중이 아닐 때) 칸 정보 */
  onInfo?(tile: number): void;
  flash?: Record<number, string>;
}) {
  const m = MAPS[g.map];
  const gg = g as unknown as Game;
  const plate = PLATE[m.id] ?? PLATE.town;
  const planeBox: CSSProperties = { left: CX - S / 2, top: CY - S / 2, width: S, height: S, transformOrigin: "50% 50%" };
  const FR = 16;
  const frameBox: CSSProperties = { left: CX - S / 2 - FR, top: CY - S / 2 - FR, width: S + 2 * FR, height: S + 2 * FR, transformOrigin: "50% 50%" };
  return (
    <div className="mbx absolute inset-0">
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
              className={`absolute p-[3px] ${can ? "cursor-pointer" : "cursor-help"}`}
              style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
            >
              <TileFace m={m} d={d} owner={t.owner} sx={sd.x} sy={sd.y} />
              {here.length > 0 && <span className="pointer-events-none absolute inset-[2px] rounded-[10px]" style={{ boxShadow: `inset 0 0 0 4px ${PCOLOR[here[0]]}, 0 0 16px 3px ${PCOLOR[here[0]]}` }} />}
              {can && <span className="mbx-pick pointer-events-none absolute inset-[2px] rounded-[10px]" />}
              {flash?.[tile] && <span className="pointer-events-none absolute inset-[3px] rounded-[9px]" style={{ boxShadow: `inset 0 0 0 5px ${flash[tile]}`, background: "rgba(255,255,255,0.4)" }} />}
            </button>
          );
        })}
      </div>

      {/* 서는 것들: 건물(칸 뒤쪽) */}
      {m.tiles.map((sd, slot) => {
        const tile = g.order[slot];
        const d = m.tiles[tile];
        const t = g.tiles[tile];
        if (t.owner < 0 || d.kind !== "city" || t.lv <= 0) return null;
        const b = toward(sd.x, sd.y, 0.035);
        const p = proj(b.x, b.y);
        const lv = Math.min(t.lv, LANDMARK);
        return (
          <div key={`b${slot}`} className="pointer-events-none absolute" style={{ left: p.x, top: p.y - 4, zIndex: 100 + Math.round(p.y), transform: `translate(-50%, -100%) scale(${p.k})`, transformOrigin: "50% 100%" }}>
            <Building lv={lv} color={PCOLOR[t.owner]} key={`${t.owner}-${lv}`} />
          </div>
        );
      })}

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
            <div key={tk.hop} className={tk.hop ? "mb-hop" : undefined}>
              <Token sprite={tk.sprite} anim={tk.anim} h={46} face={tk.face} />
            </div>
            <div className="absolute -top-[7px] left-1/2 h-[9px] w-[9px] -translate-x-1/2 rotate-45 rounded-[2px]" style={{ background: PCOLOR[tk.pi], boxShadow: "0 0 0 1.5px #fff, 0 1px 3px rgba(0,0,0,0.4)" }} />
          </div>
        );
      })}

      {/* 이름판: 칸 앞쪽, 맨 위 층 */}
      {m.tiles.map((sd, slot) => {
        const tile = g.order[slot];
        const d = m.tiles[tile];
        const t = g.tiles[tile];
        const f = toward(sd.x, sd.y, -0.012);
        const p = proj(f.x, f.y);
        const pc = t.owner >= 0 ? PCOLOR[t.owner] : null;
        const mult = t.owner >= 0 ? tollMult(gg, tile) : 1;
        const fest = t.owner >= 0 && g.players[t.owner]?.fest === tile;
        const sp = KIND[d.kind];
        return (
          <div key={`n${slot}`} className="pointer-events-none absolute flex flex-col items-center" style={{ left: p.x, top: p.y + 6, zIndex: 3000 + Math.round(p.y), transform: `translateX(-50%) scale(${Math.min(1.08, p.k)})`, transformOrigin: "50% 0" }}>
            {!sp && (
              <span className="relative flex items-center gap-[2px]">
                {pc ? (
                  <span className="rounded-[5px] px-[4px] text-[10px] leading-[13px] font-extrabold text-white" style={{ background: pc, boxShadow: `0 0 0 1.5px ${INK}` }}>
                    {fmtToll(tollOf(gg, tile))}
                  </span>
                ) : (
                  <span className="rounded-[5px] bg-white px-[3px] text-[9.5px] leading-[12px] font-bold text-[#5a6090]" style={{ boxShadow: `0 0 0 1.2px ${INK}` }}>
                    {d.price}
                  </span>
                )}
                {mult > 1 && (
                  <span className="mbx-mult rounded-full px-[4px] text-[9.5px] leading-[13px] font-black" style={{ background: mult >= 4 ? "#ff3d6e" : "#ffd23a", color: mult >= 4 ? "#fff" : "#3a2500" }}>
                    x{mult}
                  </span>
                )}
                {fest && <Glyph n="note" size={13} color="#b07bff" />}
                {t.boostLeft > 0 && <Glyph n="fire" size={13} color="#ff6a2b" />}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 판 위에 눕는 칸 바닥 */
function TileFace({ m, d, owner, sx, sy }: { m: MapDef; d: TileDef; owner: number; sx: number; sy: number }) {
  const sp = KIND[d.kind];
  if (sp)
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[10px]" style={{ background: `radial-gradient(circle at 35% 30%, ${mix(sp.fill, 0.55)}, ${sp.fill} 60%, ${dark(sp.fill, 0.85)})`, boxShadow: `inset 0 0 0 2px ${dark(sp.fill, 0.7)}, inset 0 3px 0 rgba(255,255,255,0.5)` }}>
        <FloorText sx={sx} sy={sy}>
          <span className="flex flex-col items-center gap-[2px]">
            <Glyph n={sp.glyph} size={sx % 8 === 0 && sy % 8 === 0 ? 40 : 24} color={sp.ink === "#fff" ? "#fff" : mix(sp.fill, 0.55)} />
            <b className={`whitespace-nowrap ${sx % 8 === 0 && sy % 8 === 0 ? "text-[17px]" : "text-[13px]"} leading-none font-black`} style={{ color: sp.ink, textShadow: sp.ink === "#fff" ? "0 1px 2px rgba(0,0,0,0.5)" : "none" }}>
              {d.name}
            </b>
          </span>
        </FloorText>
      </div>
    );
  const band = d.kind === "spot" ? "#ffb21e" : m.groups[d.group ?? 0].color;
  const pc = owner >= 0 ? PCOLOR[owner] : null;
  // 동네 띠는 칸의 바깥쪽 변에
  const side = sy >= 8 ? "bottom" : sy <= 0 ? "top" : sx <= 0 ? "left" : "right";
  const bandStyle: CSSProperties = side === "bottom" ? { left: 0, right: 0, bottom: 0, height: 13 } : side === "top" ? { left: 0, right: 0, top: 0, height: 13 } : side === "left" ? { top: 0, bottom: 0, left: 0, width: 13 } : { top: 0, bottom: 0, right: 0, width: 13 };
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[10px]" style={{ background: pc ? `linear-gradient(135deg, ${mix(pc, 0.35)}, ${pc})` : `linear-gradient(135deg, #fffdf6, ${mix(band, 0.78)})`, boxShadow: pc ? `inset 0 0 0 2.5px ${dark(pc, 0.6)}, inset 0 3px 0 rgba(255,255,255,0.45)` : `inset 0 0 0 1.5px ${dark(band, 0.6)}` }}>
      <div className="absolute" style={{ ...bandStyle, background: `linear-gradient(135deg, ${mix(band, 0.2)}, ${band})` }} />
      <FloorText sx={sx} sy={sy}>
        <b className={`block max-w-[64px] text-center leading-[15px] font-black break-keep ${d.name.length >= 5 ? "text-[12px]" : "text-[14px]"}`} style={{ color: pc ? "#fff" : INK, textShadow: pc ? "0 1px 2px rgba(0,0,0,0.55)" : "0 1px 0 rgba(255,255,255,0.8)" }}>
          {d.kind === "spot" && "★"}
          {d.name}
        </b>
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

/** 서 있는 건물 (그림이 오면 그림, 없으면 표식). 주인 색 바닥 고리로 누구 건물인지 */
function Building({ lv, color }: { lv: number; color: string }) {
  const h = BLD_H[lv];
  return (
    <div className="mb-pop relative flex flex-col items-center">
      <img
        src={BLD[lv]}
        alt=""
        className="block max-w-none"
        style={{ height: h, filter: "drop-shadow(0 3px 2px rgba(20,24,60,0.35))" }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
          (e.currentTarget.nextSibling as HTMLElement | null)?.style.removeProperty("display");
        }}
      />
      {/* 건물 전체를 주인 색으로 물들임 (그림 모양대로 가린 색 판을 곱하기로) */}
      <span className="pointer-events-none absolute inset-0" style={{ background: color, WebkitMaskImage: `url(${BLD[lv]})`, maskImage: `url(${BLD[lv]})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", mixBlendMode: "multiply", opacity: 0.72 }} />
      <span style={{ display: "none" }}>
        <Glyph n={(["hut", "hut", "house", "tower", "crown"] as GlyphName[])[lv]} size={h * 0.7} color={color} />
      </span>
      {/* 주인 깃발 (랜드마크는 흔들흔들) */}
      <span className={`absolute -top-[9px] right-[2px] ${lv >= LANDMARK ? "mb-bob" : ""}`}>
        <Glyph n="flag" size={lv >= LANDMARK ? 17 : 14} color={color} />
      </span>
      <span className="absolute -bottom-[3px] left-1/2 h-[7px] w-[70%] -translate-x-1/2 rounded-[50%]" style={{ background: color, boxShadow: `0 0 0 1.5px ${INK}`, opacity: 0.9, zIndex: -1 }} />
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
