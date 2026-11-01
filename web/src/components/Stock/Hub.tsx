"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Look } from "@/lib/poker/rules";
import type { HubStatus } from "@/lib/stock/types";
import { BUILDINGS, LOTS, SHORTCUTS, VILLAGE, walkMs, type Building } from "@/lib/stock/village";
import { Avatar, Btn, C, NUM, Sheet, TITLE, TopBar, WalletChip, ro } from "./ui";

/*
 * 마을 허브 — 아트가 들어오기 전의 마을 (건물 목록 · 평면 지도는 village.ts 데이터로 그림. 3D 마을도 같은 데이터를 씀).
 * 편의가 먼저: 걷기는 선택. 상단 「지도」(M) · 하단 바로가기(1~3) · 즐겨찾기 · 최근 간 곳 · 이어서 하기.
 * 건물을 고르면 걸어가고(화면을 누르면 바로 도착) → 0.4초 줌인 → 그 화면.
 */

const LS_RECENT = "stock:recent";
const LS_FAV = "stock:fav";
const load = (k: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const save = (k: string, v: string[]) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* 저장 안 되는 브라우저 */
  }
};

export default function Hub({
  w,
  h,
  me,
  total,
  status,
  onEnter,
}: {
  w: number;
  h: number;
  me: { nick: string; look: Look } | null;
  total: number | null;
  status: HubStatus | null;
  /** 건물 들어가기 (줌인 연출이 끝난 뒤) */
  onEnter: (b: Building) => void;
}) {
  const [recent, setRecent] = useState<string[]>(() => load(LS_RECENT));
  const [fav, setFav] = useState<string[]>(() => load(LS_FAV));
  const [map, setMap] = useState(false);
  const [pos, setPos] = useState(VILLAGE.spawn);
  const [walk, setWalk] = useState<{ b: Building; ms: number } | null>(null);
  const [zoom, setZoom] = useState<Building | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enter = (b: Building) => {
    if (b.action.type === "soon") return;
    if (timer.current) clearTimeout(timer.current);
    setWalk(null);
    setPos(b.door);
    setZoom(b);
    const r = [b.id, ...recent.filter((x) => x !== b.id)].slice(0, 5);
    setRecent(r);
    save(LS_RECENT, r);
    timer.current = setTimeout(() => {
      setZoom(null);
      onEnter(b);
    }, 400);
  };
  const walkTo = (b: Building) => {
    if (b.action.type === "soon") return;
    setMap(false);
    const ms = walkMs(pos, b.door);
    setWalk({ b, ms });
    setPos(b.door);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => enter(b), ms);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const toggleFav = (id: string) => {
    const f = fav.includes(id) ? fav.filter((x) => x !== id) : [...fav, id];
    setFav(f);
    save(LS_FAV, f);
  };

  // 단축키: M 지도 · 1~3 바로가기
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey) return;
      if (e.key.toLowerCase() === "m") setMap((m) => !m);
      const s = SHORTCUTS.find((b) => String(b.shortcut) === e.key);
      if (s) enter(s);
      if (e.key === "Escape") setMap(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  // 목록: 즐겨찾기 → 최근 → 나머지
  const ordered = useMemo(() => {
    const rank = (b: Building) => (fav.includes(b.id) ? 0 : recent.includes(b.id) ? 1 + recent.indexOf(b.id) / 10 : 2);
    return [...BUILDINGS].sort((a, b) => rank(a) - rank(b));
  }, [fav, recent]);

  const listW = Math.round(Math.max(300, w * 0.4));
  const mapW = w - listW;
  const mapH = h - 40 - 52;
  const cell = Math.min(mapW / VILLAGE.w, mapH / VILLAGE.h);
  const ox = (mapW - cell * VILLAGE.w) / 2,
    oy = (mapH - cell * VILLAGE.h) / 2;
  const cont = status?.soloTurn !== null && status?.soloTurn !== undefined;

  return (
    <div className="relative flex h-full flex-col">
      <TopBar
        title={
          <>
            <span className={`${TITLE} text-[17px] tracking-wide`} style={{ color: C.gold }}>
              STOCK VILLAGE
            </span>
            <span className="text-[12px] font-medium" style={{ color: C.mute }}>
              주식 마을
            </span>
          </>
        }
        right={
          <>
            <Btn className="h-[28px] px-[10px] text-[12px]" onClick={() => setMap(true)} title="지도 (M)">
              🗺 지도
            </Btn>
            <WalletChip value={total} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        {/* 평면 마을 (아트 전 자리) */}
        <div
          className={`relative overflow-hidden ${zoom ? "stk-zoomin" : ""}`}
          style={{ width: mapW, background: "radial-gradient(ellipse at 50% 40%, #1d2a3f, #0f1420 75%)", transformOrigin: zoom ? `${ox + zoom.door.x * cell}px ${oy + zoom.door.y * cell}px` : undefined }}
          onClick={() => walk && enter(walk.b)}
        >
          <div className="absolute" style={{ left: ox, top: oy, width: cell * VILLAGE.w, height: cell * VILLAGE.h }}>
            {/* 길 */}
            <div className="absolute rounded-[6px]" style={{ left: cell * 4, top: cell * 21, width: cell * 56, height: cell * 4, background: "#2a3550" }} />
            <div className="absolute rounded-[6px]" style={{ left: cell * 30, top: cell * 16, width: cell * 4, height: cell * 14, background: "#2a3550" }} />
            {/* 명당 자리 */}
            {Object.entries(LOTS).map(([k, p]) => (
              <div key={k} className="absolute rounded-[3px]" title="명당 단독주택" style={{ left: p.x * cell, top: p.y * cell, width: cell * 3, height: cell * 3, background: "#22314a", border: "1px dashed #3a4a6e" }} />
            ))}
            {BUILDINGS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={(e) => (e.stopPropagation(), walkTo(b))}
                className="absolute flex cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[8px] text-center transition-transform hover:scale-[1.04]"
                style={{
                  left: b.map.x * cell,
                  top: b.map.y * cell,
                  width: b.map.w * cell,
                  height: b.map.h * cell,
                  background: `linear-gradient(180deg, ${b.color}33, ${b.color}14)`,
                  border: `1px solid ${b.color}88`,
                  opacity: b.action.type === "soon" ? 0.5 : 1,
                }}
              >
                <span className="text-[18px] leading-none">{b.icon}</span>
                <span className="text-[10px] leading-tight font-bold whitespace-nowrap" style={{ color: C.text }}>
                  {b.name}
                </span>
              </button>
            ))}
            {/* 나 */}
            {me && (
              <div
                className="pointer-events-none absolute z-10 flex flex-col items-center"
                style={{
                  left: pos.x * cell - 14,
                  top: pos.y * cell - 30,
                  transition: walk ? `left ${walk.ms}ms linear, top ${walk.ms}ms linear` : "left 0.2s, top 0.2s",
                }}
              >
                <Avatar look={me.look} size={28} ring={C.gold} />
                <span className="mt-[1px] rounded-[4px] px-[4px] text-[9px] font-bold" style={{ background: "rgba(0,0,0,0.55)" }}>
                  {me.nick}
                </span>
              </div>
            )}
          </div>
          {walk && (
            <div className="absolute bottom-[8px] left-1/2 -translate-x-1/2 rounded-full px-[10px] py-[3px] text-[11px]" style={{ background: "rgba(0,0,0,0.6)", color: C.mute }}>
              {ro(walk.b.name)} 가는 중 · 화면을 누르면 바로 도착
            </div>
          )}
        </div>
        {/* 목록 */}
        <div className="flex min-h-0 flex-col gap-[6px] overflow-y-auto p-[10px]" style={{ width: listW, background: C.panel, borderLeft: `1px solid ${C.line}` }}>
          {cont && (
            <button
              type="button"
              onClick={() => enter(BUILDINGS[0])}
              className="flex cursor-pointer items-center gap-[8px] rounded-[10px] px-[10px] py-[8px] text-left"
              style={{ background: C.goldBg, border: `1px solid ${C.gold}` }}
            >
              <span className="text-[18px]">▶</span>
              <span className="flex-1">
                <span className="block text-[13px] font-bold" style={{ color: C.gold }}>
                  이어서 하기
                </span>
                <span className="block text-[11px]" style={{ color: C.mute }}>
                  증권거래소 · {status!.soloTurn}/50턴
                </span>
              </span>
            </button>
          )}
          {ordered.map((b) => (
            <PlaceRow key={b.id} b={b} status={status} fav={fav.includes(b.id)} recent={recent.includes(b.id)} onFav={() => toggleFav(b.id)} onWalk={() => walkTo(b)} onEnter={() => enter(b)} />
          ))}
        </div>
      </div>
      {/* 하단 바로가기 */}
      <div className="flex h-[52px] shrink-0 items-center gap-[8px] px-[10px]" style={{ borderTop: `1px solid ${C.line}`, background: C.bg }}>
        {SHORTCUTS.map((b) => (
          <Btn key={b.id} className="h-[38px] flex-1 text-[13px]" onClick={() => enter(b)} title={`${b.name} (${b.shortcut})`}>
            <span>{b.icon}</span> {b.id === "exchange" ? "솔로" : b.id === "hall" ? "대전" : b.id === "poker" ? "포커" : b.name}
            <span className={`ml-[4px] rounded-[4px] px-[4px] text-[10px] ${NUM}`} style={{ background: C.bg, color: C.mute }}>
              {b.shortcut}
            </span>
          </Btn>
        ))}
      </div>

      {map && (
        <Sheet title="마을 지도" onClose={() => setMap(false)} width={560}>
          <div className="flex flex-col gap-[6px] p-[10px]">
            {ordered.map((b) => (
              <PlaceRow key={b.id} b={b} status={status} fav={fav.includes(b.id)} recent={recent.includes(b.id)} onFav={() => toggleFav(b.id)} onWalk={() => walkTo(b)} onEnter={() => (setMap(false), enter(b))} />
            ))}
            <p className="pt-[4px] text-center text-[11px]" style={{ color: C.mute }}>
              PC: M 지도 · 1 솔로 · 2 대전 · 3 포커
            </p>
          </div>
        </Sheet>
      )}
      {zoom && <div className="stk-fadeout pointer-events-none absolute inset-0 z-50" style={{ background: C.bg }} />}
    </div>
  );
}

function PlaceRow({
  b,
  status,
  fav,
  recent,
  onFav,
  onWalk,
  onEnter,
}: {
  b: Building;
  status: HubStatus | null;
  fav: boolean;
  recent: boolean;
  onFav: () => void;
  onWalk: () => void;
  onEnter: () => void;
}) {
  const soon = b.action.type === "soon";
  const line = status && b.status ? b.status(status) : null;
  return (
    <div className="flex items-center gap-[8px] rounded-[10px] px-[8px] py-[6px]" style={{ background: C.panel2, border: `1px solid ${C.line}`, opacity: soon ? 0.55 : 1 }}>
      <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] text-[17px]" style={{ background: `${b.color}22`, border: `1px solid ${b.color}66` }}>
        {b.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[4px] text-[13px] font-bold">
          {b.name}
          {recent && !fav && (
            <span className="rounded-[4px] px-[4px] text-[9px]" style={{ background: C.chip, color: C.mute }}>
              최근
            </span>
          )}
        </div>
        <div className="truncate text-[10px]" style={{ color: C.mute }}>
          {soon ? "준비 중" : (line ?? b.sub)}
        </div>
      </div>
      <button type="button" aria-label={fav ? "즐겨찾기 빼기" : "즐겨찾기"} onClick={onFav} className="cursor-pointer px-[2px] text-[15px]" style={{ color: fav ? C.gold : C.chipLine }}>
        ★
      </button>
      {!soon && (
        <>
          <Btn tone="ghost" className="h-[30px] px-[8px] text-[11px]" onClick={onWalk}>
            걸어가기
          </Btn>
          <Btn tone="gold" className="h-[30px] px-[8px] text-[11px]" onClick={onEnter}>
            바로 입장
          </Btn>
        </>
      )}
    </div>
  );
}
