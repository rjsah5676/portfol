"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import GameLoader from "@/components/GameLoader";
import { loveTasks } from "@/lib/love/loadTasks";

/*
 * 올인 러브 무대 — 서바이버 · 디펜스 · 다이스 타운 Stage 와 같은 방식.
 *  PC: 사이트 안 16:9 상자 + 「전체화면 플레이 권장」 띠 (게임 안 ⛶ 버튼으로도 켜고 끔)
 *  폰: 가로 전용 — 전체화면이 되는 기기는 전체화면부터, 아이폰 사파리는 「홈 화면에 추가」 안내, 세로면 "가로로 돌려 주세요"
 *  로딩: 무대 칸 그대로 공용 로딩 화면(GameLoader) — 그림 · 효과음 · BGM 을 다 받은 뒤 게임 (음성은 게임이 뒤에서 받음)
 * 게임(LoveApp)은 cqw 단위라 변환 없이 무대 칸 크기(16:9 맞춤)만 정해 주면 글자까지 또렷하게 맞춰짐.
 */

interface StageCtl {
  fs: boolean;
  canFs: boolean;
  phone: boolean;
  /** 폰 안내 화면(전체화면 · 홈 화면 추가 · 가로 돌리기)이 덮고 있는 동안 — 소리 끔 */
  gate: boolean;
  toggleFs(): void;
}
const Ctx = createContext<StageCtl>({ fs: false, canFs: false, phone: false, gate: false, toggleFs: () => {} });
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
const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    // 아이패드 사파리는 맥으로 자기를 소개함
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

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

const GATE_BG: React.CSSProperties = {
  background: "linear-gradient(rgba(20,12,6,0.86), rgba(11,8,6,0.94)), url('/love/ui/title-bg.webp') center / cover",
};
const GOLD = "#e0b46a";

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
      setScr({ w: window.innerWidth, h: window.innerHeight, touch: matchMedia("(pointer: coarse)").matches });
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
    if (typeof el.requestFullscreen === "function")
      el.requestFullscreen({ navigationUI: "hide" }).then(lockLand, () => setPseudoFs(true));
    else setPseudoFs(true);
  };
  // 아이폰 사파리: 진짜 전체화면이 안 되니 「홈 화면에 추가」로 안내 — 「브라우저에서 계속」이면 이번 접속 동안 안 물음
  const [iosWeb, setIosWeb] = useState(false);
  const [iosSkip, setIosSkip] = useState(false);
  useEffect(() => {
    let skip = false;
    try {
      skip = sessionStorage.getItem("lv-ios-web") === "1";
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에서만 알 수 있는 값
    setIosWeb(isIOS() && !isStandalone());
    setIosSkip(skip);
  }, []);
  const skipIos = () => {
    setIosSkip(true);
    try {
      sessionStorage.setItem("lv-ios-web", "1");
    } catch {}
  };
  const fsGate = phone && !fs && canFs && !isStandalone();
  const iosGate = phone && !fsGate && iosWeb && !iosSkip;
  const rotateGate = phone && !land && !fsGate && !iosGate;
  const gate = fsGate || iosGate || rotateGate;
  // 16:9 를 칸 안에 꽉 맞춘 크기 (정수 px)
  const k = box.w && box.h ? Math.min(box.w / 16, box.h / 9) : 0;
  const sw = Math.floor(k * 16),
    sh = Math.floor(k * 9);

  return (
    <Ctx.Provider value={{ fs, canFs, phone, gate, toggleFs }}>
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
            className="mb-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#e0b46a]/50 bg-[linear-gradient(90deg,rgba(224,180,106,0.16),rgba(143,168,255,0.12))] px-4 py-2 font-['Nanum_Gothic',sans-serif] text-[13px] text-white/85 shadow-[0_0_24px_-6px_rgba(224,180,106,0.5)] transition-colors hover:border-[#e0b46a] hover:text-white"
          >
            <span className="shrink-0 rounded-md bg-[#e0b46a] px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#2a1d14]">⛶</span>
            <b className="shrink-0 font-bold whitespace-nowrap text-white">전체화면 플레이 권장</b>
            <span className="min-w-0 truncate text-white/55 [@media(pointer:coarse)]:hidden">
              — 여기를 누르면 전체화면으로 (게임 안 오른쪽 위 ⛶ 버튼으로도 켜고 끌 수 있어요)
            </span>
            <span className="hidden whitespace-nowrap text-white/55 [@media(pointer:coarse)]:inline">— 눌러서 크게</span>
          </button>
        )}
        <div
          ref={boxRef}
          className={cover ? "relative h-full w-full bg-black" : "relative aspect-video w-full overflow-hidden bg-black"}
          style={!cover && phone && !land ? { aspectRatio: "auto", height: "62vh" } : undefined}
        >
          {k > 0 && (
            <div
              className="absolute"
              style={{ width: sw, height: sh, left: Math.round((box.w - sw) / 2), top: Math.round((box.h - sh) / 2) }}
            >
              {/* 그림 · 효과음 · BGM 을 다 받은 뒤에 게임 (무대 칸 그대로 진행률 화면) */}
              <GameLoader tasks={loveTasks} title="올인 러브" accent={GOLD} className="absolute inset-0">
                {children}
              </GameLoader>
            </div>
          )}
          {iosGate && (
            <div style={GATE_BG} className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
              <p className="text-2xl font-black text-[#ffd27a]">아이폰은 홈 화면에 추가해서 전체화면으로</p>
              <ol className="flex flex-wrap items-stretch justify-center gap-2 text-sm">
                <li className="rounded-lg border border-white/15 bg-black/40 px-3 py-2">
                  <b className="mr-1.5 text-[#ffd27a]">1</b>사파리 공유 버튼
                </li>
                <li className="rounded-lg border border-white/15 bg-black/40 px-3 py-2">
                  <b className="mr-1.5 text-[#ffd27a]">2</b>홈 화면에 추가 → 추가
                </li>
                <li className="rounded-lg border border-white/15 bg-black/40 px-3 py-2">
                  <b className="mr-1.5 text-[#ffd27a]">3</b>홈 화면에서 실행
                </li>
              </ol>
              <button
                type="button"
                onClick={skipIos}
                className="cursor-pointer rounded-full border border-white/25 px-6 py-2 text-sm text-white/80 hover:border-white/60"
              >
                브라우저에서 계속
              </button>
            </div>
          )}
          {(fsGate || rotateGate) && (
            <div style={GATE_BG} className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-4 px-6 text-center text-white">
              <p className="text-2xl font-black text-[#ffd27a]">
                {fsGate ? "전체화면으로 플레이해 주세요" : "폰을 가로로 돌려 주세요"}
              </p>
              <p className="text-sm text-white/70">폰에서는 가로 화면으로 플레이해요</p>
              {fsGate && (
                <button
                  type="button"
                  onClick={toggleFs}
                  className="cursor-pointer rounded-full bg-[#e0b46a] px-8 py-3 text-lg font-bold text-[#2a1d14]"
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
