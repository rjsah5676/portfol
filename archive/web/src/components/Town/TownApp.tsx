"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { DH, DW, mountTown } from "@/lib/town/engine";
import type { TownHost } from "@/lib/town/net";
import { townNet } from "./townNet";

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
  (window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);
const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    // 아이패드 사파리는 맥으로 자기를 소개함
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

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
  const { admin, profile, loading, login, points, setPoints } = useAuth();
  // 엔진은 한 번만 붙이고, 로그인 상태는 이 객체로 알려 줌 (바뀔 때마다 다시 붙이면 하던 게임이 날아감)
  const hostRef = useRef<TownHost>({ admin, member: profile?.nick ?? null, loading, login: () => void login(), net: townNet });
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
    const h = hostRef.current;
    h.admin = admin;
    h.member = profile?.nick ?? null;
    h.loading = loading;
    h.login = () => void login();
    h.points = points;
    h.setPoints = setPoints;
    h.changed?.();
  }, [admin, profile, loading, login, points, setPoints]);
  useEffect(() => {
    if (!ready || !gameRef.current) return;
    return mountTown(gameRef.current, { host: hostRef.current });
  }, [ready]);

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
  // 아이폰 사파리: 진짜 전체화면이 안 되니 「홈 화면에 추가」(앱)로 안내 — 픽셀 디펜스 · ANIME POKER 와 같은 방식.
  // 「브라우저에서 계속」을 누르면 이번 접속 동안은 안 물음
  const [iosWeb, setIosWeb] = useState(false);
  const [iosSkip, setIosSkip] = useState(false);
  useEffect(() => {
    let skip = false;
    try {
      skip = sessionStorage.getItem("tt-ios-web") === "1";
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에서만 알 수 있는 값
    setIosWeb(isIOS() && !isStandalone());
    setIosSkip(skip);
  }, []);
  const skipIos = () => {
    setIosSkip(true);
    try {
      sessionStorage.setItem("tt-ios-web", "1");
    } catch {}
  };
  // 안드로이드 크롬: 「앱으로 설치」 — 브라우저가 beforeinstallprompt 를 줄 때만 (이미 설치했거나 아이폰이면 안 옴)
  const [installEv, setInstallEv] = useState<(Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }) | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setInstallEv(e as typeof installEv);
    };
    const done = () => setInstallEv(null);
    window.addEventListener("beforeinstallprompt", on);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", on);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  const installApp = () => {
    const ev = installEv;
    if (!ev) return;
    void ev.prompt().catch(() => {});
    void ev.userChoice.then((c) => c.outcome === "accepted" && setInstallEv(null)).catch(() => {});
  };
  // 설치한 앱(안드로이드)으로 열었으면 첫 터치에 진짜 전체화면 (상태 표시줄까지 숨김)
  useEffect(() => {
    if (!isStandalone() || isIOS() || !matchMedia("(pointer: coarse)").matches) return;
    const go = () => {
      window.removeEventListener("pointerdown", go, true);
      const el = rootRef.current;
      if (el && !document.fullscreenElement && typeof el.requestFullscreen === "function") void el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    };
    window.addEventListener("pointerdown", go, true);
    return () => window.removeEventListener("pointerdown", go, true);
  }, []);
  const fsGate = phone && !fs && canFs && !isStandalone();
  const iosGate = phone && !fsGate && iosWeb && !iosSkip;
  const rotateGate = phone && !land && !fsGate && !iosGate;
  // 안내 화면이 떠 있는 동안은 게임 소리를 멈춤 (전체화면이 아닌데 음악이 나오던 것)
  const blocked = fsGate || rotateGate || iosGate;
  useEffect(() => {
    const h = hostRef.current;
    if (h.blocked === blocked) return;
    h.blocked = blocked;
    h.changed?.();
  }, [blocked]);

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
        {ready && (canFs || fs) && (
          // 전체화면 켜기 · 끄기: 오른쪽 위 모서리 작은 탭 — 어느 화면에서든 (게임 UI 위쪽 여백에만 걸치게)
          <button
            type="button"
            onClick={toggleFs}
            aria-label={fs ? "전체화면 끄기" : "전체화면"}
            title={fs ? "전체화면 끄기" : "전체화면"}
            className="absolute top-0 right-0 z-[70] flex h-[24px] w-[38px] cursor-pointer items-center justify-center rounded-bl-[10px] bg-black/45 text-white/85 transition-colors hover:bg-black/70 hover:text-white"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={fs ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"} />
            </svg>
          </button>
        )}
        {iosGate && (
          <div style={GATE_BG} className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-['Jua'] text-2xl text-white">아이폰은 홈 화면에 추가해서 전체화면으로</p>
            <ol className="flex flex-wrap items-stretch justify-center gap-2 text-sm text-white/80">
              <li className="rounded-xl border border-white/15 bg-white/5 px-3 py-2">
                <b className="mr-1.5 text-[#FFC94A]">1</b>사파리
                <svg viewBox="0 0 24 24" className="mx-1 inline h-[1.2em] w-[1.2em] align-[-0.25em] text-[#4aa3ff]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="공유">
                  <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
                  <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />
                </svg>
                공유 버튼
              </li>
              <li className="rounded-xl border border-white/15 bg-white/5 px-3 py-2">
                <b className="mr-1.5 text-[#FFC94A]">2</b>
                <span className="text-[#FFC94A]">홈 화면에 추가</span> → 추가
              </li>
              <li className="rounded-xl border border-white/15 bg-white/5 px-3 py-2">
                <b className="mr-1.5 text-[#FFC94A]">3</b>홈 화면의 테이블 타운 실행
              </li>
            </ol>
            <p className="text-xs text-white/55">앱에선 주소창 없이 화면 전체로 해요 · 처음 한 번은 다시 로그인해 주세요 (게스트 코인 · 코스튬도 앱 따로)</p>
            <button type="button" onClick={skipIos} className="rounded-full border border-white/25 bg-white/10 px-6 py-2 text-sm text-white">
              브라우저에서 계속
            </button>
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
            {fsGate && installEv && (
              <>
                <button type="button" onClick={installApp} className="rounded-full border border-white/25 bg-white/10 px-6 py-2 text-sm font-bold text-white">
                  앱으로 설치
                </button>
                <p className="text-xs text-white/55">설치하면 홈 화면에서 바로 전체화면으로 열려요</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
