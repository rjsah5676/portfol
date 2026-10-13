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
import { getPrefs, onPrefs, unlock } from "./audio";

/*
 * PIXEL GLITCH DEFENSE 무대 — 1024 × 576 디자인을 화면에 맞춰 통째로 키우고 줄임 (PC = 폰, 배치가 늘 같음).
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

/**
 * 도트 글꼴(갈무리 11 = 12px 기준)은 화면 픽셀 배율이 정수일 때만 또렷함 (0.95 · 1.25 배면 획이 깨짐).
 * PC 에서는 (무대 배율 × 화면 배율)이 정수에 조금 못 미치거나 조금 넘으면 그 정수로 맞춤 — 무대가 최대 22% 작아지는 대신 글자가 또렷.
 * 차이가 크면(예: 1.6배) 그대로 (작게 줄이는 손해가 더 큼). 폰은 화면을 꽉 채우는 게 우선이라 그대로.
 */
function snapScale(k: number, phone: boolean) {
  if (!k || phone || typeof window === "undefined") return k;
  const dpr = window.devicePixelRatio || 1;
  const s = k * dpr;
  // 정수에 아주 조금 모자라면(0.98 이상, 사이트 테두리 · 스크롤바 몇 px) 그 정수로 — 가장자리 2px 쯤 잘림
  const n = Math.floor(s + 0.02);
  if (n >= 1 && s / n <= 1.28) return n / dpr;
  return k;
}

export default function Stage({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [boxRef, box] = useSize<HTMLDivElement>();
  /** 커서 크기 설정 (data-cur → css/defense.css) */
  const [cur, setCur] = useState(1);
  useEffect(() => {
    setCur(getPrefs().cursor ?? 1);
    return onPrefs((p) => setCur(p.cursor ?? 1));
  }, []);
  const boxEl = useRef<HTMLDivElement | null>(null);
  const stageEl = useRef<HTMLDivElement | null>(null);
  /** 상자가 화면에서 반 px 에 놓여 있으면 (가운데 맞춤 · 스크롤바) 그만큼 무대를 밀어 정수 px 에 맞춤 */
  const [frac, setFrac] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!boxEl.current) return;
    // 무대가 실제로 놓인 자리를 재서 남는 소수 px 만큼 더 밂 (테두리 · 화면 배율 반올림까지 한 번에)
    const fix = () => {
      const el = stageEl.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const f = (v: number) => (Math.round(v * dpr) - v * dpr) / dpr;
      const dx = f(r.left),
        dy = f(r.top);
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) setFrac((o) => ({ x: o.x + dx, y: o.y + dy }));
    };
    fix();
    // 위쪽 내용(머리말 · 순위)이 늦게 그려져 상자가 밀려도 다시 맞춤
    const ro = new ResizeObserver(fix);
    ro.observe(document.body);
    const t = setTimeout(fix, 1500);
    window.addEventListener("scroll", fix, { passive: true });
    window.addEventListener("resize", fix);
    return () => {
      ro.disconnect();
      clearTimeout(t);
      window.removeEventListener("scroll", fix);
      window.removeEventListener("resize", fix);
    };
  }, [box.w, box.h]);
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
    // 브라우저는 사용자가 한 번 누르기 전엔 소리를 막음 → 첫 누르기 · 키에서 소리 잠금 풀기
    const un = () => unlock();
    window.addEventListener("pointerdown", un);
    window.addEventListener("keydown", un);
    return () => {
      window.removeEventListener("pointerdown", un);
      window.removeEventListener("keydown", un);
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
  const k = snapScale(box.w && box.h ? Math.min(box.w / DW, box.h / DH) : 0, phone);

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
        {!cover && canFs && (
          <button
            type="button"
            onClick={toggleFs}
            className="mb-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#FF5CD6]/45 bg-[linear-gradient(90deg,rgba(255,92,214,0.16),rgba(95,242,255,0.14))] px-4 py-2 font-['Nanum_Gothic',sans-serif] text-[13px] text-white/85 shadow-[0_0_24px_-6px_rgba(255,92,214,0.55)] transition-colors hover:border-[#FF5CD6] hover:text-white"
          >
            <span className="shrink-0 rounded-md bg-[#FF5CD6] px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">⛶</span>
            <b className="shrink-0 font-bold whitespace-nowrap text-white">전체화면 플레이 권장</b>
            <span className="min-w-0 truncate text-white/55 [@media(pointer:coarse)]:hidden">
              — 여기를 누르면 전체화면으로 (게임 안 오른쪽 위 네모 버튼으로도 켜고 끌 수 있어요)
            </span>
            <span className="hidden whitespace-nowrap text-white/55 [@media(pointer:coarse)]:inline">— 눌러서 크게</span>
          </button>
        )}
        <div
          ref={(el) => {
            boxRef(el);
            boxEl.current = el;
          }}
          className={
            cover
              ? "relative h-full w-full"
              : "relative aspect-video w-full overflow-hidden border-2 border-[#3d3468] bg-black shadow-[0_6px_0_0_rgba(0,0,0,0.5)]"
          }
          style={!cover && phone && !land ? { aspectRatio: "auto", height: "62vh" } : undefined}
        >
          {k > 0 && (
            <div
              ref={stageEl}
              data-cur={cur}
              className="dfn absolute select-none"
              style={{
                width: DW,
                height: DH,
                // 가운데 맞춤을 정수 px 로 (반 px 에 놓이면 글자가 흐려짐)
                left: Math.round((box.w - DW * k) / 2) + frac.x,
                top: Math.round((box.h - DH * k) / 2) + frac.y,
                transform: `scale(${k})`,
                transformOrigin: "0 0",
              }}
            >
              {children}
            </div>
          )}
          {(fsGate || rotateGate) && (
            <div className="dfn absolute inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-[#0b0918] px-6 text-center">
              <p className="px-title text-2xl text-white">
                {fsGate ? "전체화면으로 플레이해 주세요" : "폰을 가로로 돌려 주세요"}
              </p>
              <p className="text-sm text-[#a69cc9]">폰에서는 가로 화면으로 플레이해요</p>
              {fsGate && (
                <button
                  type="button"
                  onClick={toggleFs}
                  className="px-btn px-8 py-3 text-lg font-bold"
                  style={{ "--c": "#d4249f", "--t": "#fff" } as React.CSSProperties}
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
