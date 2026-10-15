"use client";

import type { ReactNode } from "react";
import { CHAR } from "@/lib/marble/data";
import { LANDMARK, tollMult, tollOf, type Game } from "@/lib/marble/engine";
import { MAPS, type MapDef, type TileDef } from "@/lib/marble/maps";
import type { GameWire } from "@/lib/marble/wire";
import { PCOLOR } from "./pixel";
import Token, { type TokenAnim } from "./Token";

/*
 * 탑뷰 보드 (모두의마블식) — 9×9 격자 둘레 32칸을 무대(1024×576) 가운데 납작하게 깔아 둠.
 *  - 칸은 카드: 동네 색 띠 + 큰 이름, 아래에 건물 · 땅값/통행료. 산 땅은 테두리 · 바탕이 플레이어 색.
 *  - 특수칸은 칸 전체를 그 칸 색으로 칠하고 그림 표식만 (세우는 건물 없음).
 *  - 말(캐릭터)만 도트. 출발은 오른쪽 아래 모서리, 시계 방향으로 돎.
 * 칸 좌표 = 맵 격자 (x, y). orgel 은 자리마다 지금 놓인 칸(game.order)을 그림.
 */

/** 보드 영역 (좌우 플레이어 카드 사이) */
const L = 226;
const R = 798;
const T = 6;
const B = 570;
/** 모서리 칸 크기 · 변 칸 크기 */
const C = 84;
const SW = (R - L - 2 * C) / 7;
const SH = (B - T - 2 * C) / 7;

/** 격자 한 축의 [시작, 끝] (모서리 칸은 크게) */
const span = (g: number, a: number, s: number): [number, number] => (g <= 0 ? [a, a + C] : g >= 8 ? [a + C + 7 * s, a + 2 * C + 7 * s] : [a + C + (g - 1) * s, a + C + g * s]);
/** 격자(소수 가능) → 축 좌표 (칸 가운데끼리 이어 붙임) */
const axis = (g: number, a: number, s: number) => {
  const mid = (k: number) => {
    const [p, q] = span(k, a, s);
    return (p + q) / 2;
  };
  const lo = Math.max(0, Math.min(7, Math.floor(g)));
  return mid(lo) + (mid(lo + 1) - mid(lo)) * (g - lo);
};

/** 격자 좌표 → 무대 좌표 (칸 가운데) — 이름은 예전 아이소 그대로 둠 */
export const iso = (gx: number, gy: number) => ({ x: axis(gx, L, SW), y: axis(gy, T, SH) });
/** 자리 → 무대 좌표 (말 발끝): 칸 안쪽 가장자리에 세워 칸 이름 · 값을 안 가림 */
export const slotXY = (m: MapDef, slot: number) => {
  const { x: gx, y: gy } = m.tiles[slot];
  const r = rectOf(gx, gy);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = gx >= 8 ? -1 : gx <= 0 ? 1 : 0;
  const dy = gy >= 8 ? -1 : gy <= 0 ? 1 : 0;
  return {
    x: dx ? cx + dx * (r.w / 2 + 14) : cx,
    y: dy < 0 ? r.y + 4 : dy > 0 ? r.y + r.h + 46 : cy + 22,
  };
};
const rectOf = (gx: number, gy: number) => {
  const [x0, x1] = span(gx, L, SW);
  const [y0, y1] = span(gy, T, SH);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
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

type GlyphName = "flag" | "coin" | "gift" | "wrench" | "note" | "portal" | "bag" | "train" | "star" | "house" | "tower" | "crown" | "fire";

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
  return (
    <div className="mbx absolute inset-0">
      <Center m={m} />
      {m.tiles.map((sd, slot) => {
        const tile = g.order[slot];
        const d = m.tiles[tile];
        const t = g.tiles[tile];
        const r = rectOf(sd.x, sd.y);
        const can = !!pick?.includes(tile);
        return (
          <button
            key={slot}
            type="button"
            aria-label={d.name}
            onClick={() => (can ? onPick?.(tile) : onInfo?.(tile))}
            className={`absolute p-[2px] ${can ? "z-[60] cursor-pointer" : "z-[5] cursor-help"}`}
            style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
          >
            <TileCard g={gg} m={m} d={d} tile={tile} owner={t.owner} lv={t.lv} boost={t.boostLeft > 0} fest={t.owner >= 0 && g.players[t.owner]?.fest === tile} big={r.w > 70 && r.h > 70} />
            {can && <span className="mbx-pick pointer-events-none absolute inset-[1px] rounded-[10px]" />}
            {flash?.[tile] && <span className="pointer-events-none absolute inset-[2px] rounded-[9px]" style={{ boxShadow: `inset 0 0 0 4px ${flash[tile]}`, background: "rgba(255,255,255,0.35)" }} />}
          </button>
        );
      })}

      {/* 말 */}
      {tokens.map((tk) => {
        const c = slotXY(m, tk.slot);
        const same = tokens.filter((o) => o.slot === tk.slot);
        const k = same.indexOf(tk);
        const off = same.length > 1 ? (k - (same.length - 1) / 2) * 18 : 0;
        return (
          <div
            key={tk.pi}
            className="pointer-events-none absolute"
            style={{
              left: c.x + off,
              top: c.y + (same.length > 1 ? (k % 2) * 3 : 0),
              zIndex: 80 + k,
              transform: "translate(-50%, -100%)",
              transition: "left 160ms ease-out, top 160ms ease-out",
              opacity: tk.dim ? 0.35 : 1,
            }}
          >
            <div className="absolute bottom-[-3px] left-1/2 h-[8px] w-[32px] -translate-x-1/2 rounded-[50%]" style={{ background: "rgba(20,24,60,0.3)" }} />
            <div key={tk.hop} className={tk.hop ? "mb-hop" : undefined}>
              <Token sprite={tk.sprite} anim={tk.anim} h={50} face={tk.face} />
            </div>
            <div className="absolute -top-[4px] left-1/2 h-[10px] w-[10px] -translate-x-1/2 rounded-full" style={{ background: PCOLOR[tk.pi], boxShadow: "0 0 0 2px #fff, 0 1px 3px rgba(0,0,0,0.4)" }} />
          </div>
        );
      })}
    </div>
  );
}

/** 칸 카드 하나 */
function TileCard({ g, m, d, tile, owner, lv, boost, fest, big }: { g: Game; m: MapDef; d: TileDef; tile: number; owner: number; lv: number; boost: boolean; fest: boolean; big: boolean }) {
  const sp = KIND[d.kind];
  if (sp) {
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[9px]" style={{ background: `linear-gradient(160deg, ${mix(sp.fill, 0.3)}, ${sp.fill})`, boxShadow: `inset 0 0 0 2px ${dark(sp.fill, 0.72)}, 0 2px 0 rgba(20,24,60,0.35)` }}>
        <Glyph n={sp.glyph} size={big ? 36 : 24} color={sp.ink === "#fff" ? "#fff" : mix(sp.fill, 0.55)} />
        <span className={`px-[2px] text-center leading-[12px] font-extrabold break-keep ${big ? "text-[12.5px]" : "text-[10.5px]"}`} style={{ color: sp.ink, textShadow: sp.ink === "#fff" ? "0 1px 1px rgba(0,0,0,0.35)" : "none" }}>
          {d.name}
        </span>
      </div>
    );
  }
  const spot = d.kind === "spot";
  const band = spot ? "#ffb21e" : m.groups[d.group ?? 0].color;
  const pc = owner >= 0 ? PCOLOR[owner] : null;
  const toll = owner >= 0 ? tollOf(g, tile) : 0;
  const mult = owner >= 0 ? tollMult(g, tile) : 1;
  const inset = pc ? 3.5 : 1.5;
  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-[9px]"
      style={{
        background: pc ? mix(pc, 0.8) : "#fffdf6",
        boxShadow: pc ? `inset 0 0 0 3.5px ${pc}, 0 0 0 1.5px ${INK}, 0 2px 0 rgba(20,24,60,0.35)` : `inset 0 0 0 1.5px ${INK}, 0 2px 0 rgba(20,24,60,0.35)`,
      }}
    >
      {/* 동네 색 띠 + 이름 */}
      <div className="flex min-h-[17px] items-center justify-center px-[2px] py-[1px]" style={{ background: band, margin: `${inset}px ${inset}px 0`, borderRadius: "7px 7px 0 0" }}>
        <span className="text-center text-[10.5px] leading-[12px] font-extrabold break-keep text-white" style={{ textShadow: "0 1px 1px rgba(0,0,0,0.45)" }}>
          {d.name}
        </span>
      </div>
      {/* 건물 · 표식 */}
      <div className="flex min-h-0 flex-1 items-center justify-center gap-[1px]">
        {spot && owner < 0 && <Glyph n="star" size={16} color="#ffd65a" />}
        {owner >= 0 && !spot && <Buildings lv={lv} color={pc!} />}
        {owner >= 0 && spot && <Glyph n="star" size={20} color={pc!} />}
        {fest && <Glyph n="note" size={14} color="#b07bff" />}
        {boost && <Glyph n="fire" size={14} color="#ff6a2b" />}
      </div>
      {/* 값 */}
      <div className="flex items-center justify-center gap-[2px] pb-[4px]">
        {owner >= 0 ? (
          <>
            <span className="rounded-[5px] px-[4px] text-[10.5px] leading-[13px] font-extrabold text-white" style={{ background: pc! }}>
              {fmtToll(toll)}
            </span>
            {mult > 1 && (
              <span className="mbx-mult rounded-[5px] px-[3px] text-[10.5px] leading-[13px] font-black" style={{ background: mult >= 4 ? "#ff3d6e" : "#ffd23a", color: mult >= 4 ? "#fff" : "#3a2500" }}>
                x{mult}
              </span>
            )}
          </>
        ) : (
          <span className="text-[10px] leading-[12px] font-bold text-[#6a6f93]">{d.price}</span>
        )}
      </div>
    </div>
  );
}

/** 건물 단계: 깃발(땅만) · 집 1~2채 · 빌딩 · 랜드마크 */
function Buildings({ lv, color }: { lv: number; color: string }) {
  if (lv <= 0) return <Glyph n="flag" size={16} color={color} />;
  if (lv >= LANDMARK) return <Glyph n="crown" size={24} color={color} />;
  return (
    <>
      {Array.from({ length: lv }, (_, i) => (
        <Glyph key={i} n={i === 2 ? "tower" : "house"} size={i === 2 ? 19 : 15} color={color} />
      ))}
    </>
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
    house: (
      <>
        <path d="M4 11l8-7 8 7v10H4z" fill={color} {...s} />
        <rect x="10" y="14.5" width="4" height="6.5" fill="#fff" {...s} />
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

/** 판 가운데: 맵 그림 (분수 광장 · 십자 철로 중앙역 · 오르골 회전목마) */
function Center({ m }: { m: MapDef }) {
  const x0 = L + C + 5;
  const y0 = T + C + 5;
  const w = R - L - 2 * C - 10;
  const h = B - T - 2 * C - 10;
  return (
    <div className="pointer-events-none absolute overflow-hidden rounded-[18px]" style={{ left: x0, top: y0, width: w, height: h, background: m.sky, boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.6), 0 6px 24px rgba(20,24,60,0.25)" }}>
      <img src={`/marble/bg/center-${m.id}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 50%, transparent 45%, rgba(18,20,60,0.35))" }} />
    </div>
  );
}

/** 캐릭터 말 그림 id */
export const spriteOf = (charId: string) => CHAR[charId]?.sprite ?? "kai";
