"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { DH, DW, mountTown } from "@/lib/town/engine";

/*
 * TABLE TOWN 무대 — 픽셀 타운 서바이버 · 포커와 같은 방식.
 * 1280 × 720 디자인을 화면에 맞춰 통째로 키우고 줄임 (PC = 폰, 배치가 늘 같음).
 *  PC: 사이트 안 16:9 상자 (전체화면 버튼으로 크게)
 *  폰: 가로 전용 — 세로면 "가로로 돌려 주세요", 전체화면이 되는 기기는 전체화면부터 권함
 */

const canFullscreen = () =>
  typeof document !== "undefined" &&
  !!(document.fullscreenEnabled || (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);
const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

function useSize<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number }] {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ro = useRef<ResizeObserver | null>(null);
  const attach = useCallback((el: T | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    const apply = (w: number, h: number) => setSize((s) => (Math.abs(s.w - w) < 1 && Math.abs(s.h - h) < 1 ? s : { w, h }));
    ro.current = new ResizeObserver(([e]) => apply(e.contentRect.width, e.contentRect.height));
    ro.current.observe(el);
    apply(el.clientWidth, el.clientHeight);
  }, []);
  return [attach, size];
}

const GATE_BG: React.CSSProperties = { background: "linear-gradient(rgba(24,30,56,0.9), rgba(16,20,40,0.96)), #141a2a" };

export default function TownApp() {
  const { admin } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<HTMLDivElement>(null);
  const [boxRef, box] = useSize<HTMLDivElement>();
  const [fsReal, setFsReal] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);
  const [canFs, setCanFs] = useState(false);
  const [scr, setScr] = useState({ w: 0, h: 0, touch: false });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에서만 알 수 있는 값
    setCanFs(canFullscreen());
    const on = () => setScr({ w: window.innerWidth, h: window.innerHeight, touch: matchMedia("(pointer: coarse)").matches });
    on();
    window.addEventListener("resize", on);
    const fsOn = () => setFsReal(!!document.fullscreenElement && document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", fsOn);
    document.body.classList.add("game-full");
    return () => {
      window.removeEventListener("resize", on);
      document.removeEventListener("fullscreenchange", fsOn);
      document.body.classList.remove("game-full");
    };
  }, []);

  // 엔진은 무대가 처음 생길 때 한 번만 붙임
  const k = box.w && box.h ? Math.min(box.w / DW, box.h / DH) : 0;
  const ready = k > 0;
  useEffect(() => {
    if (!ready || !gameRef.current) return;
    return mountTown(gameRef.current, { admin });
  }, [ready, admin]);

  const fs = fsReal || pseudoFs;
  const phone = scr.touch && Math.min(scr.w, scr.h) < 600;
  const land = scr.w > scr.h * 1.15;
  const cover = fs || (phone && land);
  const toggleFs = () => {
    const el = rootRef.current;
    if (!el) return;
    if (pseudoFs) return setPseudoFs(false);
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    const lockLand = () => {
      if (!matchMedia("(pointer: coarse)").matches) return;
      const o = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      void o?.lock?.("landscape").catch(() => {});
    };
    if (typeof el.requestFullscreen === "function") el.requestFullscreen({ navigationUI: "hide" }).then(lockLand, () => setPseudoFs(true));
    else setPseudoFs(true);
  };
  const fsGate = phone && !fs && canFs && !isStandalone();
  const rotateGate = phone && !land && !fsGate;

  return (
    <div
      ref={rootRef}
      className={
        cover
          ? "fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black"
          : "isolate mx-auto w-full max-w-[min(1280px,calc((100dvh-120px)*16/9))]"
      }
    >
      {!cover && canFs && (
        <button
          type="button"
          onClick={toggleFs}
          className="mb-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#FFC94A]/50 bg-[linear-gradient(90deg,rgba(255,201,74,0.16),rgba(77,140,255,0.14))] px-4 py-2 text-[13px] text-white/85 transition-colors hover:border-[#FFC94A] hover:text-white"
        >
          <span className="shrink-0 rounded-md bg-[#FFC94A] px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#232a4d]">⛶</span>
          <b className="shrink-0 font-bold whitespace-nowrap text-white">전체화면 플레이 권장</b>
          <span className="min-w-0 truncate text-white/55 [@media(pointer:coarse)]:hidden">— 여기를 누르면 전체화면으로</span>
        </button>
      )}
      <div
        ref={boxRef}
        className={
          cover
            ? "relative h-full w-full"
            : "relative aspect-video w-full overflow-hidden rounded-2xl border-2 border-[#2b3550] bg-[#141a2a] shadow-[0_6px_0_0_rgba(0,0,0,0.45)]"
        }
        style={!cover && phone && !land ? { aspectRatio: "auto", height: "62vh" } : undefined}
      >
        {ready && (
          <div
            className="absolute"
            style={{
              width: DW,
              height: DH,
              left: Math.round((box.w - DW * k) / 2),
              top: Math.round((box.h - DH * k) / 2),
              transform: `scale(${k})`,
              transformOrigin: "0 0",
            }}
          >
            <div ref={gameRef} className="tt" />
          </div>
        )}
        {(fsGate || rotateGate) && (
          <div style={GATE_BG} className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="font-['Jua'] text-2xl text-white">{fsGate ? "전체화면으로 플레이해 주세요" : "폰을 가로로 돌려 주세요"}</p>
            <p className="text-sm text-white/70">폰에서는 가로 화면으로 플레이해요</p>
            {fsGate && (
              <button type="button" onClick={toggleFs} className="rounded-full bg-[#FFC94A] px-8 py-3 text-lg font-bold text-[#232a4d]">
                ⛶ 전체화면으로 시작
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
