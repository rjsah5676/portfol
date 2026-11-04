"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import GameIcon from "@/components/GameIcon";
import { NAV_GROUPS } from "@/data/navMenu";
import { BOUNDS, WARP_GAP_MS, warps, type Warp, type WarpCat } from "@/lib/gmtown/world";
import type { TownEngine } from "./engine";
import { drawFullMap } from "./townMap";

/*
 * 전체 지도 창 (M · 작은 지도 누르기) — 로아식: 가운데 그림 지도 + 장소 핀, 왼쪽 장소 목록, 오른쪽 고른 곳 정보.
 * 고른 곳으로 「순간이동」(서버가 정한 자리만 · 몇 초에 한 번) 또는 「걸어서 이동」.
 * 폰: 지도가 화면 가득, 목록은 위 칩, 정보는 아래 판.
 */

const TABS: { id: "all" | WarpCat; label: string; icon: string }[] = [
  { id: "all", label: "전체", icon: "▦" },
  { id: "game", label: "게임", icon: "🎮" },
  { id: "place", label: "장소", icon: "⛲" },
  { id: "home", label: "집", icon: "🏠" },
];
const PLACE_ICON: Record<string, string> = { plaza: "⛲", park: "🌳" };
const navDesc = (href: string | null) =>
  href ? (NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href)?.desc ?? null) : null;

function WarpIcon({ w, size = 22 }: { w: Warp; size?: number }) {
  if (w.b) return <GameIcon icon={w.b.icon} />;
  return <span style={{ fontSize: size }}>{PLACE_ICON[w.id] ?? "📍"}</span>;
}

export default function MapModal({
  engine,
  phone,
  ch,
  onClose,
  onWarp,
  onWalk,
  lastWarp,
}: {
  engine: TownEngine;
  phone: boolean;
  ch: number | null;
  onClose: () => void;
  onWarp: (w: Warp) => void;
  onWalk: (w: Warp) => void;
  /** 마지막 순간이동 시각 (쉬는 시간 표시) */
  lastWarp: number;
}) {
  const list = useMemo(() => warps(), []);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const [geo, setGeo] = useState<{ k: number; ox: number; oy: number } | null>(null);
  const [tab, setTab] = useState<"all" | WarpCat>("all");
  const [q, setQ] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // 처음 고른 곳: 나에게 가장 가까운 곳
  const [sel, setSel] = useState<string>(() => {
    const me = engine.mapState().me;
    if (!me) return list[0].id;
    return list.reduce((a, b) => (Math.hypot(b.x - me.x, b.y - me.y) < Math.hypot(a.x - me.x, a.y - me.y) ? b : a)).id;
  });
  const [hover, setHover] = useState<string | null>(null);
  const cur = list.find((w) => w.id === sel) ?? list[0];

  // 지도 그리기 (사람 점은 계속 움직이니 0.25초마다)
  useEffect(() => {
    const draw = () => {
      const c = cvRef.current,
        box = boxRef.current;
      if (!c || !box) return;
      const w = box.clientWidth,
        h = box.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const st = engine.mapState();
      const g = drawFullMap(
        ctx,
        w,
        h,
        { x0: BOUNDS.x0 - 2, y0: BOUNDS.y0 + 4, x1: BOUNDS.x1 + 2, y1: BOUNDS.y1 - 2 },
        st.me,
        st.others
      );
      setGeo((o) => (o && o.k === g.k && o.ox === g.ox && o.oy === g.oy ? o : g));
      setNow(Date.now());
    };
    draw();
    const id = window.setInterval(draw, 250);
    const ro = new ResizeObserver(draw);
    if (boxRef.current) ro.observe(boxRef.current);
    return () => {
      window.clearInterval(id);
      ro.disconnect();
    };
  }, [engine]);

  const st = engine.mapState();
  const here = (w: Warp) => st.others.filter((o) => Math.hypot(o.x - w.x, o.y - w.y) < 12).length;
  const dist = st.me ? Math.hypot(cur.x - st.me.x, cur.y - st.me.y) : 0;
  const wait = Math.max(0, WARP_GAP_MS - (now - lastWarp));
  const shown = list.filter(
    (w) => (tab === "all" || w.cat === tab) && (!q.trim() || (w.name + w.sub).toLowerCase().includes(q.trim().toLowerCase()))
  );

  const pins = geo && (
    <>
      {list.map((w) => {
        const on = w.id === sel || w.id === hover;
        return (
          <button
            key={w.id}
            type="button"
            data-on={on ? "1" : "0"}
            onClick={() => setSel(w.id)}
            onMouseEnter={() => setHover(w.id)}
            onMouseLeave={() => setHover((h) => (h === w.id ? null : h))}
            className="gmt-pin absolute flex cursor-pointer flex-col items-center"
            style={{ left: geo.ox + w.x * geo.k, top: geo.oy + w.y * geo.k, transform: "translate(-50%, -100%)" }}
            aria-label={w.name}
          >
            <span
              className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap shadow-[0_2px_8px_rgba(0,0,0,0.45)] ${
                w.id === sel ? "border-[#ffe7a8] bg-[#3a2c10]/95 text-[#FFE6A0]" : "border-[#c9a45c]/50 bg-[#15131f]/88 text-white/95"
              } ${phone && w.id !== sel ? "max-[700px]:text-[10px]" : ""}`}
            >
              <span className="flex h-[18px] w-[18px] items-center justify-center overflow-hidden rounded-full bg-white/10 text-[12px]">
                <WarpIcon w={w} size={12} />
              </span>
              {(!phone || w.id === sel || w.cat !== "place") && <span>{w.name}</span>}
            </span>
            <span className={`h-2 w-[2px] ${w.id === sel ? "bg-[#ffe7a8]" : "bg-[#c9a45c]/70"}`} />
            <span className={`h-1.5 w-1.5 rounded-full ${w.id === sel ? "bg-[#ffe7a8]" : "bg-[#c9a45c]"}`} />
          </button>
        );
      })}
    </>
  );

  const info = (
    <div className={`flex flex-col ${phone ? "gap-2" : "gap-3"}`}>
      {!phone && (
        <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg border border-[#c9a45c]/30 bg-gradient-to-b from-[#2b2640] to-[#151320] text-[54px]">
          <span className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl">
            <WarpIcon w={cur} size={52} />
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        {phone && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/10 text-[22px]">
            <WarpIcon w={cur} />
          </span>
        )}
        <div className="min-w-0">
          <div className="gmt-lo-title truncate text-[20px] leading-tight">{cur.name}</div>
          <div className="truncate text-[12px] text-[#d9c99f]/80">{cur.sub}</div>
        </div>
      </div>
      {!phone && (
        <p className="text-[12px] leading-relaxed text-white/75">
          {navDesc(cur.b?.href ?? null) ??
            (cur.id === "plaza"
              ? "마을 한가운데 분수 광장. 큰길이 사방으로 뻗어 있어요."
              : cur.id === "park"
                ? "북쪽 언덕 꼭대기 — 마을이 한눈에 보여요. 계단길로 올라가요."
                : cur.b && !cur.b.href
                  ? "아직 준비 중인 곳이에요."
                  : cur.sub)}
        </p>
      )}
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px]">
        <span className="text-white/60">근처 사람</span>
        <b className="text-[#9be7c4]">{here(cur)}명</b>
        <span className="ml-auto text-white/50">{st.me ? `${Math.round(dist)}m` : ""}</span>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={wait > 0}
          onClick={() => onWarp(cur)}
          className="gmt-gold-btn flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg text-[14px] font-extrabold disabled:cursor-not-allowed"
        >
          <span>✦</span> {wait > 0 ? `순간이동 ${Math.ceil(wait / 1000)}초` : "순간이동"}
        </button>
        <button
          type="button"
          onClick={() => onWalk(cur)}
          className="gmt-dark-btn flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg text-[14px] font-bold"
        >
          <span>🚶</span> 걸어서 이동
        </button>
      </div>
      {!phone && cur.b?.href && (
        <Link href={cur.b.href} className="text-center text-[12px] text-[#e9cf8e] underline-offset-2 hover:underline">
          게임 바로 열기 →
        </Link>
      )}
    </div>
  );

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-2 sm:p-5"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className={`gmt-lo gmt-pop relative flex flex-col overflow-hidden ${phone ? "h-full w-full rounded-xl" : "h-[min(92%,760px)] w-[min(100%,1240px)] rounded-xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 머리: 제목 · 채널 · 닫기 */}
        <div className="relative flex h-11 shrink-0 items-center justify-center border-b border-[#c9a45c]/30 bg-gradient-to-b from-[#2a2438] to-[#16141f]">
          <span className="absolute left-3 text-[11px] text-white/55">{ch ? `${ch}채널` : ""}</span>
          <span className="text-[#c9a45c]/70">❖</span>
          <b className="gmt-lo-title mx-3 text-[19px]">ANIME TOWN 전체 지도</b>
          <span className="text-[#c9a45c]/70">❖</span>
          <div className="absolute right-2 flex items-center gap-2">
            {!phone && (
              <kbd className="rounded border border-white/25 bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-white/70">M</kbd>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="지도 닫기"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[18px] text-white/80 hover:bg-white/10"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {phone && (
            <div className="gmt-chat-scroll flex shrink-0 gap-1.5 overflow-x-auto border-b border-[#c9a45c]/20 px-2 py-1.5">
              {list.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setSel(w.id)}
                  className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${
                    w.id === sel ? "border-[#e9cf8e] bg-[#e9cf8e]/15 text-[#FFE6A0]" : "border-white/15 bg-white/5 text-white/80"
                  }`}
                >
                  <span className="flex h-4 w-4 items-center justify-center overflow-hidden text-[11px]">
                    <WarpIcon w={w} size={11} />
                  </span>
                  {w.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-row">
          {/* 왼쪽: 목록 (폰은 위 칩) */}
          {!phone && (
            <div className="flex w-[230px] shrink-0 flex-col border-r border-[#c9a45c]/20 bg-black/20">
              <div className="grid grid-cols-4 gap-1 p-2">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`flex cursor-pointer flex-col items-center rounded-md border py-1 text-[11px] ${
                      tab === t.id ? "border-[#e9cf8e]/80 bg-[#e9cf8e]/15 text-[#FFE6A0]" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    <span className="text-[14px] leading-tight">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="px-2 pb-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="장소 이름으로 찾기"
                  className="h-8 w-full rounded-md border border-white/15 bg-black/30 px-2.5 text-[12px] text-white outline-none placeholder:text-white/40 focus:border-[#c9a45c]/70"
                />
              </div>
              <div className="gmt-chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {shown.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setSel(w.id)}
                    onMouseEnter={() => setHover(w.id)}
                    onMouseLeave={() => setHover((h) => (h === w.id ? null : h))}
                    className={`mb-1 flex w-full cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left ${
                      w.id === sel ? "border-[#e9cf8e]/70 bg-[#e9cf8e]/12" : "border-transparent hover:bg-white/6"
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/8 text-[15px]">
                      <WarpIcon w={w} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12.5px] font-bold ${w.id === sel ? "text-[#FFE6A0]" : "text-white/90"}`}>{w.name}</span>
                      <span className="block truncate text-[10.5px] text-white/45">{w.sub}</span>
                    </span>
                    {w.id === sel && <span className="text-[#e9cf8e]">›</span>}
                  </button>
                ))}
                {!shown.length && <div className="px-2 py-6 text-center text-[12px] text-white/45">찾는 곳이 없어요</div>}
              </div>
            </div>
          )}

          {/* 가운데: 지도 */}
          <div ref={boxRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#5d7b58]">
            <canvas ref={cvRef} className="absolute inset-0 h-full w-full" />
            {pins}
            {/* 범례 */}
            <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-3 rounded-md bg-black/55 px-2.5 py-1 text-[10.5px] text-white/80">
              <span className="flex items-center gap-1">
                <span className="inline-block h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-[#FFD36B]" /> 나
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full border border-black/50 bg-white" /> 다른 사람
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#c9a45c]" /> 장소
              </span>
            </div>
          </div>

          {/* 오른쪽: 고른 곳 (폰은 아래 판) */}
          <div
            className={
              phone
                ? "gmt-chat-scroll w-[200px] shrink-0 overflow-y-auto border-l border-[#c9a45c]/20 bg-black/30 p-2.5"
                : "gmt-chat-scroll w-[270px] shrink-0 overflow-y-auto border-l border-[#c9a45c]/20 bg-black/20 p-3"
            }
          >
            {info}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
