"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import GameLoader from "@/components/GameLoader";
import { baseballTasks } from "./loadTasks";
import { unlockAudio } from "./sfx";

/*
 * 야구 무대 — 1024 × 576 디자인을 화면에 맞춰 통째로 키우고 줄임 (PC = 폰, 배치가 늘 같음).
 * 디펜스와 같은 방식: PC 는 사이트 안 16:9 상자(전체화면 버튼), 폰은 가로 전용 + 전체화면 권장.
 */
export const DW = 1024;
export const DH = 576;

interface StageCtl {
  /** 무대 배율 (캔버스 해상도 맞추기) */
  k: number;
  fs: boolean;
  canFs: boolean;
  phone: boolean;
  toggleFs(): void;
}
const Ctx = createContext<StageCtl>({ k: 1, fs: false, canFs: false, phone: false, toggleFs: () => {} });
export const useStage = () => useContext(Ctx);

const canFullscreen = () =>
  typeof document !== "undefined" &&
  !!(document.fullscreenEnabled || (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);

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

export default function Stage({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
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
    const un = () => unlockAudio();
    window.addEventListener("pointerdown", un);
    window.addEventListener("keydown", un);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("pointerdown", un);
      window.removeEventListener("keydown", un);
      document.removeEventListener("fullscreenchange", fsOn);
      document.body.classList.remove("game-full");
    };
  }, []);
  // PC 창 모드: 사이트 머리글 · 전체화면 안내 높이를 실제로 재서 무대가 화면 안에 다 들어오게 너비를 정함
  // (예전 공식은 위 여백 120px 가정 — 실제론 300px 가까워 「입단!」 · 「PLAY BALL」이 화면 아래로 잘렸음)
  const [fitW, setFitW] = useState(0);
  useEffect(() => {
    const fit = () => {
      const el = rootRef.current;
      if (!el) return;
      // (사이트가 게임 쪽으로 미리 스크롤해 둠 — 지금 화면 기준 위치로)
      const top = el.getBoundingClientRect().top;
      const banner = el.querySelector(":scope > button") as HTMLElement | null;
      const bh = banner ? banner.offsetHeight + 12 : 0;
      setFitW(Math.max(600, Math.floor(((window.innerHeight - top - bh - 14) * 16) / 9)));
    };
    fit();
    // 사이트가 처음에 게임 쪽으로 스크롤해 주는 동안(첫 3초)엔 스크롤 때마다 다시 잼 — 그 뒤엔 크기 고정 (손으로 스크롤할 때 출렁이지 않게)
    const t0 = Date.now();
    const onScroll = () => {
      if (Date.now() - t0 < 3000) fit();
    };
    const id = window.setTimeout(fit, 400);
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
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
  const fsGate = phone && !fs && canFs;
  const rotateGate = phone && !land && !fsGate;
  const k = box.w && box.h ? Math.min(box.w / DW, box.h / DH) : 0;

  return (
    <Ctx.Provider value={{ k, fs, canFs, phone, toggleFs }}>
      <div
        ref={rootRef}
        className={
          cover
            ? "fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black"
            : "isolate mx-auto w-full max-w-[min(1280px,calc((100dvh-120px)*16/9))]"
        }
        style={!cover && fitW ? { maxWidth: Math.min(1280, fitW) } : undefined}
      >
        {!cover && canFs && (
          <button
            type="button"
            onClick={toggleFs}
            className="mb-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#FF8A3D]/45 bg-[linear-gradient(90deg,rgba(255,138,61,0.16),rgba(122,215,255,0.12))] px-4 py-2 text-[13px] text-white/85 transition-colors hover:border-[#FF8A3D] hover:text-white"
          >
            <span className="shrink-0 rounded-md bg-[#FF8A3D] px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">⛶</span>
            <b className="shrink-0 font-bold whitespace-nowrap text-white">전체화면 플레이 권장</b>
            <span className="min-w-0 truncate text-white/55">— 누르면 전체화면 (게임 안 오른쪽 아래 버튼으로도)</span>
          </button>
        )}
        <div
          ref={boxRef}
          className={
            cover
              ? "relative h-full w-full"
              : "relative aspect-video w-full overflow-hidden rounded-xl border-2 border-[#2b3150] bg-black shadow-[0_6px_0_0_rgba(0,0,0,0.5)]"
          }
          style={!cover && phone && !land ? { aspectRatio: "auto", height: "62vh" } : undefined}
        >
          {k > 0 && (
            <div
              className="absolute select-none"
              style={{
                width: DW,
                height: DH,
                left: Math.round((box.w - DW * k) / 2),
                top: Math.round((box.h - DH * k) / 2),
                transform: `scale(${k})`,
                transformOrigin: "0 0",
                touchAction: "none",
              }}
            >
              <GameLoader tasks={baseballTasks} title="픽셀 프로야구" accent="#FF8A3D" className="absolute inset-0">
                {children}
              </GameLoader>
            </div>
          )}
          {(fsGate || rotateGate) && (
            <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-[#0b0e1c] px-6 text-center">
              <p className="font-['Black_Han_Sans'] text-2xl text-white">{fsGate ? "전체화면으로 플레이해 주세요" : "폰을 가로로 돌려 주세요"}</p>
              <p className="text-sm text-white/55">폰에서는 가로 화면으로 플레이해요</p>
              {fsGate && (
                <button type="button" onClick={toggleFs} className="rounded-xl bg-[#FF8A3D] px-8 py-3 text-lg font-bold text-white">
                  ⛶ 전체화면으로 시작
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Ctx.Provider>
  );
}
