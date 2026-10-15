"use client";

import type { CSSProperties } from "react";
import { CHAR } from "@/lib/marble/data";
import { LANDMARK, tollOf, type Game } from "@/lib/marble/engine";
import { MAPS, type MapDef, type TileDef } from "@/lib/marble/maps";
import type { GameWire } from "@/lib/marble/wire";
import { Icon, PCOLOR } from "./pixel";
import Token, { type TokenAnim } from "./Token";

/*
 * 2.5D 보드 (도트 아이소메트릭) — 9×9 격자를 마름모로 눕혀 무대(1024×576) 가운데 섬처럼 놓음.
 *  - 바닥(섬 · 칸 윗면 · 옆면)은 SVG 한 장 (모서리가 계단처럼 깨지게 crispEdges)
 *  - 칸 이름 · 건물 · 말은 HTML 을 그 위에 세워서 (뒤 칸부터 앞 칸 순서로 겹침)
 *  - 출발 포털이 맨 아래 꼭짓점, 말은 시계 방향으로 돎 (모두의마블처럼)
 * 칸 좌표 = 맵 격자 (x, y). orgel 은 자리마다 지금 놓인 칸(game.order)을 그림.
 */

/** 건물 그림 높이 (단계별) */
const BH = [0, 46, 60, 74, 78];

export const TW = 100;
export const TH = 50;
const DEPTH = 12;
const CX = 512;
const CY = 290;

/** 격자 좌표 → 무대 좌표 (칸 가운데) */
export const iso = (gx: number, gy: number) => ({ x: CX + ((gx - gy) * TW) / 2, y: CY + ((gx + gy - 8) * TH) / 2 });
/** 자리 → 무대 좌표 */
export const slotXY = (m: MapDef, slot: number) => iso(m.tiles[slot].x, m.tiles[slot].y);

const pts = (a: { x: number; y: number }[]) => a.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
function diamond(gx: number, gy: number, inset = 0) {
  const k = 0.5 - inset;
  return [iso(gx - k, gy - k), iso(gx + k, gy - k), iso(gx + k, gy + k), iso(gx - k, gy + k)];
}
function rgb(hex: string): [number, number, number] {
  if (hex.startsWith("rgb")) return hex.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(hex: string, white: number) {
  const [r, g, b] = rgb(hex);
  const f = (v: number) => Math.round(v + (255 - v) * white);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export function dark(hex: string, k: number) {
  const [r, g, b] = rgb(hex);
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}

/** 특수칸 그림 이름 (같은 그림을 나눠 씀) */
const SP: Record<string, string> = { start2: "bonus", bonus: "bonus" };

/** 동네별 바닥 그림이 준비된 맵 (public/marble/tex/<맵>-<동네>.webp) */
const TEX = new Set(["town", "cross", "orgel"]);

/** 맵 · 동네별 바닥 무늬 */
const PATS: Record<string, string[]> = {
  town: ["stone", "grass", "plank", "stone", "dot", "plank", "stone", "dot"],
  cross: ["flower", "grass", "plank", "wave", "snow", "sand", "grass", "sand"],
  orgel: ["flower", "grass", "wave", "flower", "grass", "dot", "star", "stone"],
};

const KIND: Record<string, { fill: string; icon: string }> = {
  start: { fill: "#ffd84d", icon: "flag" },
  start2: { fill: "#ffe680", icon: "gold" },
  box: { fill: "#ff9ec4", icon: "box" },
  jail: { fill: "#b8c4d6", icon: "wrench" },
  fest: { fill: "#d6a8ff", icon: "note" },
  warp: { fill: "#a796ff", icon: "warp" },
  tax: { fill: "#e3c79f", icon: "bag" },
  bonus: { fill: "#ffe680", icon: "gold" },
};

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
  // 뒤(위) 칸부터 그림
  const order = m.tiles.map((_, s) => s).sort((a, b) => m.tiles[a].x + m.tiles[a].y - (m.tiles[b].x + m.tiles[b].y) || m.tiles[a].x - m.tiles[b].x);
  /** 안쪽 바닥 */
  const fillOf = (d: TileDef, owner: number) => {
    if (KIND[d.kind]) return mix(KIND[d.kind].fill, 0.35);
    if (d.kind === "spot") return owner >= 0 ? mix(PCOLOR[owner], 0.55) : "#fff6cf";
    const base = mix(m.groups[d.group ?? 0].color, 0.62);
    return owner >= 0 ? mix(PCOLOR[owner], 0.55) : base;
  };
  /** 테두리 띠: 주인 색이 먼저, 없으면 동네 색 */
  const rimOf = (d: TileDef, owner: number) => {
    if (owner >= 0) return PCOLOR[owner];
    if (KIND[d.kind]) return KIND[d.kind].fill;
    if (d.kind === "spot") return "#ffc94a";
    return m.groups[d.group ?? 0].color;
  };
  /** 바닥 무늬 (동네 분위기) */
  const patOf = (d: TileDef) => (KIND[d.kind] ? "star" : d.kind === "spot" ? "star" : (PATS[m.id]?.[d.group ?? 0] ?? "dot"));
  return (
    <div className="absolute inset-0">
      <svg viewBox="0 0 1024 576" width={1024} height={576} className="absolute inset-0" style={{ shapeRendering: "crispEdges" }}>
        <defs>
          <pattern id="mb-brick" width="12" height="6" patternUnits="userSpaceOnUse">
            <path d="M0 0.5H12M0 3.5H12M3 0.5V3.5M9 3.5V6.5" stroke="rgba(35,42,77,0.22)" strokeWidth="1" fill="none" />
          </pattern>
          <pattern id="mb-pat-dot" width="10" height="5" patternUnits="userSpaceOnUse">
            <rect x="2" y="1" width="2" height="1" fill="rgba(255,255,255,0.55)" />
            <rect x="7" y="3" width="2" height="1" fill="rgba(35,42,77,0.12)" />
          </pattern>
          <pattern id="mb-pat-grass" width="12" height="6" patternUnits="userSpaceOnUse">
            <path d="M2 4l1-2 1 2M8 2l1-2 1 2" stroke="rgba(40,120,50,0.35)" strokeWidth="1" fill="none" />
          </pattern>
          <pattern id="mb-pat-stone" width="16" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 4L8 0L16 4L8 8Z" fill="none" stroke="rgba(35,42,77,0.16)" strokeWidth="1" />
          </pattern>
          <pattern id="mb-pat-sand" width="8" height="4" patternUnits="userSpaceOnUse">
            <rect x="1" y="1" width="1" height="1" fill="rgba(160,110,40,0.35)" />
            <rect x="5" y="3" width="1" height="1" fill="rgba(255,255,255,0.6)" />
          </pattern>
          <pattern id="mb-pat-snow" width="10" height="6" patternUnits="userSpaceOnUse">
            <rect x="2" y="1" width="2" height="2" fill="rgba(255,255,255,0.9)" />
            <rect x="7" y="4" width="1" height="1" fill="rgba(120,160,220,0.4)" />
          </pattern>
          <pattern id="mb-pat-wave" width="14" height="6" patternUnits="userSpaceOnUse">
            <path d="M0 3q3.5-2 7 0t7 0" stroke="rgba(255,255,255,0.55)" strokeWidth="1" fill="none" />
          </pattern>
          <pattern id="mb-pat-plank" width="14" height="7" patternUnits="userSpaceOnUse">
            <path d="M0 7L14 0" stroke="rgba(120,70,30,0.22)" strokeWidth="1.5" fill="none" />
          </pattern>
          <pattern id="mb-pat-star" width="16" height="8" patternUnits="userSpaceOnUse">
            <path d="M4 2h1v1h1v1h-1v1h-1v-1h-1v-1h1z" fill="rgba(255,255,255,0.7)" />
            <rect x="12" y="6" width="1" height="1" fill="rgba(255,255,255,0.7)" />
          </pattern>
          <pattern id="mb-pat-flower" width="12" height="6" patternUnits="userSpaceOnUse">
            <rect x="2" y="1" width="2" height="1" fill="rgba(255,255,255,0.75)" />
            <rect x="8" y="4" width="1" height="1" fill="rgba(255,90,140,0.45)" />
          </pattern>
        </defs>
        <Island m={m} />
        {order.map((slot) => {
          const sd = m.tiles[slot];
          const tile = g.order[slot];
          const d = m.tiles[tile];
          const t = g.tiles[tile];
          const top = diamond(sd.x, sd.y, 0.04);
          const fill = fillOf(d, t.owner);
          const rim = rimOf(d, t.owner);
          const inner = diamond(sd.x, sd.y, t.owner >= 0 ? 0.13 : 0.1);
          const pat = patOf(d);
          const tex = d.kind === "city" && TEX.has(m.id) ? `/marble/tex/${m.id}-${d.group ?? 0}.webp` : null;
          const [a, b, c, e] = top;
          const can = !!pick?.includes(tile);
          return (
            <g key={slot}>
              <polygon points={pts([e, c, { x: c.x, y: c.y + DEPTH }, { x: e.x, y: e.y + DEPTH }])} fill={dark(rim, 0.78)} stroke="#232a4d" strokeWidth={2} />
              <polygon points={pts([e, c, { x: c.x, y: c.y + DEPTH }, { x: e.x, y: e.y + DEPTH }])} fill="url(#mb-brick)" />
              <polygon points={pts([c, b, { x: b.x, y: b.y + DEPTH }, { x: c.x, y: c.y + DEPTH }])} fill={dark(rim, 0.62)} stroke="#232a4d" strokeWidth={2} />
              <polygon points={pts([c, b, { x: b.x, y: b.y + DEPTH }, { x: c.x, y: c.y + DEPTH }])} fill="url(#mb-brick)" />
              {/* 윗면: 테두리 띠(동네 색 · 주인 색) + 안쪽 바닥 + 무늬 */}
              <polygon points={pts(top)} fill={rim} stroke="#232a4d" strokeWidth={2.5} />
              <polygon points={pts(inner)} fill={fill} />
              {tex ? (
                <>
                  <image href={tex} x={inner[3].x} y={inner[0].y} width={inner[1].x - inner[3].x} height={inner[2].y - inner[0].y} preserveAspectRatio="none" />
                  {t.owner >= 0 && <polygon points={pts(inner)} fill={PCOLOR[t.owner]} opacity={0.22} />}
                </>
              ) : (
                <polygon points={pts(inner)} fill={`url(#mb-pat-${pat})`} />
              )}
              <polyline points={pts([inner[3], inner[0], inner[1]])} fill="none" stroke="rgba(35,42,77,0.35)" strokeWidth={1.5} />
              <polyline points={pts([e, a, b])} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2} transform="translate(0,2.5)" />
              {can && <polygon className="mb-blink" points={pts(diamond(sd.x, sd.y, 0.02))} fill="rgba(255,226,74,0.6)" stroke="#ffe24a" strokeWidth={4} />}
              {flash?.[tile] && <polygon points={pts(diamond(sd.x, sd.y, 0))} fill="rgba(255,255,255,0.5)" stroke={flash[tile]} strokeWidth={5} />}
            </g>
          );
        })}
      </svg>

      {/* 칸 위에 세우는 것: 이름 · 건물 · 통행료 */}
      {order.map((slot) => {
        const sd = m.tiles[slot];
        const tile = g.order[slot];
        const d = m.tiles[tile];
        const t = g.tiles[tile];
        const c = iso(sd.x, sd.y);
        const z = 10 + (sd.x + sd.y) * 3;
        const can = !!pick?.includes(tile);
        const special = KIND[d.kind];
        const toll = t.owner >= 0 ? tollOf(gg, tile) : 0;
        const fest = t.owner >= 0 && g.players[t.owner]?.fest === tile;
        // 바닥 소품: 특수칸 그림 · 관광지 · 건물 없는 땅의 동네 소품
        const deco = special
          ? { src: `/marble/deco/sp-${SP[d.kind] ?? d.kind}.webp`, h: 50 }
          : d.kind === "spot"
            ? { src: "/marble/deco/sp-spot.webp", h: 44, dim: false }
            : null;
        return (
          <div key={slot}>
            <button
              type="button"
              aria-label={d.name}
              onClick={() => (can ? onPick?.(tile) : onInfo?.(tile))}
              className={`absolute ${can ? "cursor-pointer" : "cursor-help"}`}
              style={{ left: c.x - TW / 2, top: c.y - TH / 2, width: TW, height: TH, clipPath: "polygon(50% 0,100% 50%,50% 100%,0 50%)", zIndex: can ? 300 : z }}
            />
            {deco && (
              <div className="pointer-events-none absolute" style={{ left: c.x, top: c.y + (special ? 10 : 8), transform: "translate(-50%, -100%)", zIndex: z + 1 }}>
                <img src={deco.src} alt="" className="block max-w-none" style={{ height: deco.h, imageRendering: "pixelated", opacity: deco.dim ? 0.9 : 1 }} />
              </div>
            )}
            {t.owner >= 0 && t.lv > 0 && d.kind !== "spot" && (
              <div className="pointer-events-none absolute" style={{ left: c.x, top: c.y + 8, transform: "translate(-50%, -100%)", zIndex: z + 1 }}>
                <img
                  key={`b${t.owner}-${t.lv}`}
                  src={t.lv >= LANDMARK ? `/marble/lm/${m.id}-${tile}.webp` : `/marble/bld/b${t.owner}-${t.lv}.webp`}
                  alt=""
                  className="mb-pop block max-w-none origin-bottom"
                  style={{ height: BH[Math.min(t.lv, LANDMARK)], imageRendering: "pixelated" }}
                />
                {t.lv >= LANDMARK && (
                  <span className="mb-bob absolute -top-[14px] -right-[4px]">
                    <Icon n="flag" size={22} tint={PCOLOR[t.owner]} />
                  </span>
                )}
              </div>
            )}
            {/* 칸 앞 이름판: 동네 색 띠 + 이름, 아래에 값(빈 땅) · 통행료(산 땅) */}
            <div className="pointer-events-none absolute flex flex-col items-center" style={{ left: c.x, top: c.y + TH / 2 - 9, zIndex: z + 2, transform: "translateX(-50%)" }}>
              <span
                className="max-w-[92px] px-[4px] text-center text-[10px] leading-[12px] font-bold break-keep whitespace-nowrap"
                style={{ background: special ? "#fff8e7" : rimOf(d, -1), color: special || d.kind === "spot" ? "#232a4d" : "#fff", boxShadow: "0 0 0 2px #232a4d", textShadow: special || d.kind === "spot" ? "none" : "0 1px 0 rgba(35,42,77,0.6)" }}
              >
                {d.name}
              </span>
              {!special &&
                (t.owner >= 0 ? (
                  <span className="mt-[3px] px-[4px] text-[11px] leading-[12px] font-bold whitespace-nowrap text-white" style={{ background: PCOLOR[t.owner], boxShadow: "0 0 0 2px #232a4d" }}>
                    {fmtToll(toll)}
                  </span>
                ) : (
                  <span className="mt-[3px] bg-white px-[3px] text-[10px] leading-[11px] font-bold text-[#4a5384]" style={{ boxShadow: "0 0 0 2px #232a4d" }}>
                    {d.price}
                  </span>
                ))}
            </div>
            <div className="pointer-events-none absolute" style={{ left: c.x, top: c.y, zIndex: z + 1 }}>
              {t.owner >= 0 && d.kind !== "spot" && t.lv === 0 && (
                <span className="absolute -top-[26px] -left-[9px]">
                  <Icon n="flag" size={18} tint={PCOLOR[t.owner]} />
                </span>
              )}
              {t.boostLeft > 0 && (
                <span className="absolute -top-[40px] left-[14px]" title={`통행료 ×${t.boost.toFixed(2)}`}>
                  <Icon n="fire" size={18} className="mb-sparkle" />
                </span>
              )}
              {fest && (
                <span className="absolute -top-[40px] -left-[32px]" title="축제 (통행료 2배)">
                  <Icon n="note" size={18} className="mb-sparkle" />
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* 갈림길 표시 (크로스로드) */}
      {m.junction !== undefined && (
        <div className="pointer-events-none absolute z-[200]" style={{ left: slotXY(m, m.junction).x, top: slotXY(m, m.junction).y + 16, transform: "translateX(-50%)" }}>
          <span className="mb-chip text-[10px] font-bold" style={{ "--c": "#ffe24a" } as CSSProperties}>
            갈림길
          </span>
        </div>
      )}

      {/* 말 */}
      {tokens.map((tk) => {
        const sd = m.tiles[tk.slot];
        const c = iso(sd.x, sd.y);
        const same = tokens.filter((o) => o.slot === tk.slot);
        const k = same.indexOf(tk);
        const off = same.length > 1 ? (k - (same.length - 1) / 2) * 24 : 0;
        return (
          <div
            key={tk.pi}
            className="pointer-events-none absolute"
            style={{
              left: c.x + off,
              top: c.y + 10 + (same.length > 1 ? (k % 2) * 4 : 0),
              zIndex: 12 + (sd.x + sd.y) * 3 + 2,
              transform: "translate(-50%, -100%)",
              transition: "left 160ms steps(3), top 160ms steps(3)",
              opacity: tk.dim ? 0.35 : 1,
            }}
          >
            <div key={tk.hop} className={tk.hop ? "mb-hop" : undefined}>
              <Token sprite={tk.sprite} anim={tk.anim} h={62} face={tk.face} />
            </div>
            <div className="absolute -top-[6px] left-1/2 h-[9px] w-[9px] -translate-x-1/2 rotate-45" style={{ background: PCOLOR[tk.pi], boxShadow: "0 0 0 2px #232a4d" }} />
          </div>
        );
      })}
    </div>
  );
}

/** 섬: 풀밭 윗면 + 흙 옆면, 안쪽은 맵 분위기 */
function Island({ m }: { m: MapDef }) {
  const e = 0.45;
  const top = [iso(-0.5 - e, -0.5 - e), iso(8.5 + e, -0.5 - e), iso(8.5 + e, 8.5 + e), iso(-0.5 - e, 8.5 + e)];
  const D = 28;
  const [, b, c, d] = top;
  const inner = m.id === "cross" ? null : [iso(0.5, 0.5), iso(7.5, 0.5), iso(7.5, 7.5), iso(0.5, 7.5)];
  const innerFill = m.id === "orgel" ? "#ffd6ea" : "#cdeeff";
  return (
    <g>
      <polygon points={pts([d, c, { x: c.x, y: c.y + D }, { x: d.x, y: d.y + D }])} fill="#b9793f" stroke="#232a4d" strokeWidth={3} />
      <polygon points={pts([c, b, { x: b.x, y: b.y + D }, { x: c.x, y: c.y + D }])} fill="#94592b" stroke="#232a4d" strokeWidth={3} />
      <polygon points={pts([d, c, { x: c.x, y: c.y + 8 }, { x: d.x, y: d.y + 8 }])} fill="#5fbf55" />
      <polygon points={pts([c, b, { x: b.x, y: b.y + 8 }, { x: c.x, y: c.y + 8 }])} fill="#4aa344" />
      <polygon points={pts(top)} fill="#8fdc7c" stroke="#232a4d" strokeWidth={3} />
      {inner && <polygon points={pts(inner)} fill={innerFill} stroke="#232a4d" strokeWidth={2} strokeDasharray="6 4" />}
      {inner && <Plaza src={`/marble/bg/plaza-${m.id}.webp`} a={0.5} b={7.5} />}
      {m.id === "cross" && (
        <>
          <polygon points={pts([iso(0.5, 0.5), iso(3.5, 0.5), iso(3.5, 3.5), iso(0.5, 3.5)])} fill="#ffe2a8" stroke="#232a4d" strokeWidth={2} strokeDasharray="6 4" />
          <polygon points={pts([iso(4.5, 4.5), iso(7.5, 4.5), iso(7.5, 7.5), iso(4.5, 7.5)])} fill="#ffd0a0" stroke="#232a4d" strokeWidth={2} strokeDasharray="6 4" />
          <Plaza src="/marble/bg/plaza-cross.webp" a={0.5} b={3.5} />
          <Plaza src="/marble/bg/plaza-town.webp" a={4.5} b={7.5} />
          {/* 빈 두 귀퉁이: 여행지 소품 */}
          {SCENERY.map(([gx, gy, k, h], i) => {
            const p = iso(gx, gy);
            return <image key={i} href={`/marble/deco/cross-${k}.webp`} x={p.x - h * 0.55} y={p.y - h * 0.8} height={h} width={h * 1.1} preserveAspectRatio="xMidYMax meet" style={{ imageRendering: "pixelated" }} />;
          })}
        </>
      )}
    </g>
  );
}

/** 크로스로드 빈 귀퉁이 소품: [격자 x, y, 그림 번호, 높이] (뒤에서 앞 순서) */
const SCENERY: [number, number, number, number][] = [
  [6.6, 0.2, 4, 58],
  [5.4, 1.2, 1, 62],
  [7.6, 1.4, 6, 60],
  [6.4, 2.6, 0, 46],
  [7.8, 3.0, 5, 50],
  [1.2, 5.4, 7, 60],
  [0.2, 6.6, 3, 56],
  [2.6, 6.4, 2, 50],
  [1.4, 7.6, 5, 52],
  [3.0, 7.8, 6, 58],
];

/** 판 가운데 광장 그림 (격자 a~b 마름모에 맞춤, 그림 크기 707×504 · 윗면 아래 끝이 바닥에서 약 4%) */
function Plaza({ src, a, b }: { src: string; a: number; b: number }) {
  const left = iso(a, b).x;
  const right = iso(b, a).x;
  const bottom = iso(b, b).y;
  const w = (right - left) * 0.86;
  const h = (w * 504) / 707;
  const cy = iso((a + b) / 2, (a + b) / 2).y;
  // 그림의 윗면 가운데(세로 약 52%)를 마름모 가운데에 맞춤
  return <image href={src} x={(left + right) / 2 - w / 2} y={cy - h * 0.53 + (bottom - cy) * 0.08} width={w} height={h} style={{ imageRendering: "pixelated" }} />;
}

/** 캐릭터 말 그림 id */
export const spriteOf = (charId: string) => CHAR[charId]?.sprite ?? "kai";
