"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Look } from "@/lib/poker/rules";
import type { HubStatus } from "@/lib/stock/types";
import { BUILDINGS, SHORTCUTS, buildingOf, type Building } from "@/lib/stock/village";
import { bgm } from "@/lib/stock/sound";
import Village, { isNightNow, type NightMode, type VillageApi } from "./Village";
import { Btn, C, NUM, Sheet, TITLE, TopBar, WalletChip } from "./ui";

/*
 * 마을 허브 — 2.5D 마을(Village) 위에 UI 를 얹음. 편의가 먼저: 걷기는 선택.
 * 상단 「지도」(M) · 낮/밤 · 하단 바로가기(1~4) · 즐겨찾기 · 최근 간 곳 · 이어서 하기.
 * 건물을 누르면 길 따라 걸어가서 → 문으로 줌인 → 그 화면. 목록의 「바로 입장」은 걷기 생략.
 */

const LS_RECENT = "stock:recent";
const LS_FAV = "stock:fav";
const LS_NIGHT = "stock:night";
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
  const [nightMode, setNightMode] = useState<NightMode>(() => {
    try {
      const v = localStorage.getItem(LS_NIGHT);
      return v === "day" || v === "night" ? v : "auto";
    } catch {
      return "auto";
    }
  });
  const night = nightMode === "auto" ? isNightNow() : nightMode === "night";
  const ctl = useRef<VillageApi | null>(null);

  useEffect(() => {
    bgm(night ? "night" : "village");
  }, [night]);
  const remember = (b: Building) => {
    const r = [b.id, ...recent.filter((x) => x !== b.id)].slice(0, 5);
    setRecent(r);
    save(LS_RECENT, r);
  };
  /** 바로 입장 (걷기 생략) */
  const enter = (b: Building) => {
    if (b.action.type === "soon") return;
    setMap(false);
    remember(b);
    if (ctl.current) ctl.current.enterNow(b);
    else onEnter(b);
  };
  /** 걸어가서 입장 */
  const walkTo = (b: Building) => {
    if (b.action.type === "soon") return;
    setMap(false);
    remember(b);
    ctl.current?.goBuilding(b);
  };
  const cycleNight = () => {
    const next: NightMode = nightMode === "auto" ? (night ? "day" : "night") : nightMode === "day" ? "night" : "auto";
    setNightMode(next);
    try {
      localStorage.setItem(LS_NIGHT, next);
    } catch {}
  };
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

  const cont = status?.soloTurn !== null && status?.soloTurn !== undefined;
  const mapH = h - 40;

  return (
    <div className="relative flex h-full flex-col">
      <TopBar
        title={
          <>
            <span className={`${TITLE} text-[17px] tracking-wide`} style={{ color: C.gold }}>
              ANIME CHART
            </span>
            <span className="text-[12px] font-medium" style={{ color: C.mute }}>
              애니메 차트 · 마을
            </span>
          </>
        }
        right={
          <>
            <Btn className="h-[28px] w-[34px] text-[14px]" onClick={cycleNight} title={nightMode === "auto" ? "낮 · 밤 (지금은 시간에 맞춤)" : nightMode === "day" ? "낮으로 고정" : "밤으로 고정"}>
              {night ? "🌙" : "☀️"}
            </Btn>
            <Btn className="h-[28px] px-[10px] text-[12px]" onClick={() => setMap(true)} title="지도 (M)">
              🗺 지도
            </Btn>
            <WalletChip value={total} />
          </>
        }
      />
      <div className="relative min-h-0 flex-1" style={{ height: mapH }}>
        <Village w={w} h={mapH} nick={me?.nick ?? ""} status={status} night={night} ctlRef={ctl} onEnter={(b) => (remember(b), onEnter(b))} onLot={() => walkTo(buildingOf("realty")!)}>
          {/* 이어서 하기 */}
          {cont && (
            <button
              type="button"
              data-ui
              onClick={() => enter(BUILDINGS[0])}
              className="stk-pop absolute top-[10px] left-[10px] flex cursor-pointer items-center gap-[8px] rounded-[10px] px-[10px] py-[6px] text-left"
              style={{ background: "rgba(42,38,20,0.92)", border: `1px solid ${C.gold}`, boxShadow: "0 4px 16px rgba(0,0,0,0.4)" }}
            >
              <span className="text-[16px]">▶</span>
              <span>
                <span className="block text-[12px] font-bold" style={{ color: C.gold }}>
                  이어서 하기
                </span>
                <span className="block text-[10px]" style={{ color: C.mute }}>
                  증권거래소 · {status!.soloTurn}/50턴
                </span>
              </span>
            </button>
          )}
          <div className="pointer-events-none absolute right-[10px] bottom-[58px] rounded-full px-[8px] py-[2px] text-[10px]" style={{ background: "rgba(9,13,22,0.6)", color: C.mute }}>
            건물을 누르면 걸어가요 · 방향키로 산책 · M 지도
          </div>
          {/* 하단 바로가기 (지도 위에 겹침) */}
          <div data-ui className="absolute right-0 bottom-0 left-0 flex h-[52px] items-center gap-[8px] px-[10px]" style={{ background: "linear-gradient(180deg, rgba(9,13,22,0) 0%, rgba(9,13,22,0.85) 40%)" }}>
            {SHORTCUTS.map((b) => (
              <Btn key={b.id} className="h-[36px] flex-1 text-[13px]" onClick={() => enter(b)} title={`${b.name} (${b.shortcut})`}>
                <span>{b.icon}</span> {b.id === "exchange" ? "솔로" : b.id === "coin" ? "코인" : b.id === "hall" ? "대전" : b.id === "poker" ? "포커" : b.name}
                <span className={`ml-[4px] rounded-[4px] px-[4px] text-[10px] ${NUM}`} style={{ background: C.bg, color: C.mute }}>
                  {b.shortcut}
                </span>
              </Btn>
            ))}
          </div>
        </Village>
      </div>
      {map && (
        <Sheet title="마을 지도" onClose={() => setMap(false)} width={560}>
          <div className="flex flex-col gap-[6px] p-[10px]">
            {ordered.map((b) => (
              <PlaceRow key={b.id} b={b} status={status} fav={fav.includes(b.id)} recent={recent.includes(b.id)} onFav={() => toggleFav(b.id)} onWalk={() => walkTo(b)} onEnter={() => (setMap(false), enter(b))} />
            ))}
            <p className="pt-[4px] text-center text-[11px]" style={{ color: C.mute }}>
              PC: M 지도 · 1 솔로 · 2 코인 · 3 대전 · 4 포커 · 방향키 산책
            </p>
          </div>
        </Sheet>
      )}
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
