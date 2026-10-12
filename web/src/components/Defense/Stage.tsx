"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/*
 * 글리치 디펜스 무대 — 1024 × 576 디자인을 화면에 맞춰 통째로 키우고 줄임 (PC = 폰, 배치가 늘 같음).
 *  PC: 사이트 안 16:9 상자 (전체화면 버튼으로 크게)
 *  폰: 가로 전용 (ANIME POKER 와 같은 방식) — 세로면 "가로로 돌려 주세요", 전체화면이 되는 기기는 전체화면부터 권함
 *      전체화면이 안 되는 아이폰 사파리는 가로로 눕히면 화면을 덮어 그림 (홈 화면에 추가하면 앱처럼)
 */

export const DW = 1024;
export const DH = 576;

interface StageCtl {
  fs: boolean;
  canFs: boolean;
  phone: boolean;
  toggleFs(): void;
}
const Ctx = createContext<StageCtl>({ fs: false, canFs: false, phone: false, toggleFs: () => {} });
export const useStage = () => useContext(Ctx);

const canFullscreen = () =>
  typeof document !== "undefined" &&
  !!(
    document.fullscreenEnabled ||
    (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled
  );
const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** 요소 크기 재기 */
function useSize<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number }] {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ro = useRef<ResizeObserver | null>(null);
  const attach = useCallback((el: T | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    const apply = (w: number, h: number) =>
      setSize((s) => (Math.abs(s.w - w) < 1 && Math.abs(s.h - h) < 1 ? s : { w, h }));
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
    const on = () =>
      setScr({
        w: window.innerWidth,
        h: window.innerHeight,
        touch: matchMedia("(pointer: coarse)").matches,
      });
    on();
    window.addEventListener("resize", on);
    const fsOn = () =>
      setFsReal(!!document.fullscreenElement && document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", fsOn);
    document.body.classList.add("game-full");
    return () => {
      window.removeEventListener("resize", on);
      document.removeEventListener("fullscreenchange", fsOn);
      document.body.classList.remove("game-full");
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
      const o = window.screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      void o?.lock?.("landscape").catch(() => {});
    };
    if (typeof el.requestFullscreen === "function")
      el.requestFullscreen({ navigationUI: "hide" }).then(lockLand, () => setPseudoFs(true));
    else setPseudoFs(true);
  };
  const fsGate = phone && !fs && canFs && !isStandalone();
  const rotateGate = phone && !land && !fsGate;
  const k = box.w && box.h ? Math.min(box.w / DW, box.h / DH) : 0;

  return (
    <Ctx.Provider value={{ fs, canFs, phone, toggleFs }}>
      <div
        ref={rootRef}
        className={
          cover
            ? "fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black"
            : "mx-auto w-full max-w-[min(1280px,calc((100dvh-120px)*16/9))]"
        }
      >
        <div
          ref={boxRef}
          className={
            cover
              ? "relative h-full w-full"
              : "relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black"
          }
          style={!cover && phone && !land ? { aspectRatio: "auto", height: "62vh" } : undefined}
        >
          {k > 0 && (
            <div
              className="dfn absolute top-1/2 left-1/2 select-none"
              style={{
                width: DW,
                height: DH,
                transform: `translate(-50%, -50%) scale(${k})`,
                transformOrigin: "center",
              }}
            >
              {children}
            </div>
          )}
          {(fsGate || rotateGate) && (
            <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center backdrop-blur-sm">
              <p className="font-['Black_Han_Sans',sans-serif] text-2xl text-white">
                {fsGate ? "전체화면으로 플레이해 주세요" : "폰을 가로로 돌려 주세요"}
              </p>
              <p className="text-sm text-white/60">폰에서는 가로 화면으로 플레이해요</p>
              {fsGate && (
                <button
                  type="button"
                  onClick={toggleFs}
                  className="rounded-xl bg-[#ff5cd6] px-8 py-3 text-lg font-bold text-black"
                >
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
