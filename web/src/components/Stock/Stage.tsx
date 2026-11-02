"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { C, FONT, TITLE } from "./ui";

/*
 * 가로 전용 무대. 화면은 논리 크기(폭 844~1000 × 높이 390~460, 목업 기준)로 그리고 통째로 확대 · 축소함.
 *  - PC: 페이지 안의 상자 (폭은 칸에 맞춤, 최대 1280)
 *  - 폰 가로: 화면 전체를 덮음 (사이트 메뉴 없이)
 *  - 폰 세로: 「가로로 돌려 주세요」 (안드로이드는 전체화면 + 가로 고정 시도)
 */

export interface StageSize {
  w: number;
  h: number;
  phone: boolean;
}

export default function Stage({ children }: { children: (s: StageSize) => ReactNode }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [vw, setVw] = useState({ w: 1280, h: 800, touch: false, box: 1100 });
  useEffect(() => {
    const on = () =>
      setVw({
        w: window.innerWidth,
        h: window.innerHeight,
        touch: matchMedia("(pointer: coarse)").matches,
        box: host.current?.clientWidth ?? Math.min(1280, window.innerWidth),
      });
    on();
    // 폰을 돌릴 때 resize 가 늦거나 안 오는 브라우저가 있어서 방향 · 보이는 영역 변화도 같이 봄
    const late = () => setTimeout(on, 250);
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", late);
    window.visualViewport?.addEventListener("resize", on);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(on) : null;
    if (host.current) ro?.observe(host.current);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", late);
      window.visualViewport?.removeEventListener("resize", on);
      ro?.disconnect();
    };
  }, []);
  // 떠 있는 사이트 메뉴 버튼이 무대를 가리지 않게
  useEffect(() => {
    document.body.classList.add("game-full");
    return () => document.body.classList.remove("game-full");
  }, []);

  const phone = vw.touch && Math.min(vw.w, vw.h) < 600;
  const land = vw.w >= vw.h;
  let W: number, H: number, scale: number, boxW: number, boxH: number;
  if (phone) {
    H = 390;
    W = Math.round(Math.min(1000, Math.max(844, (390 * vw.w) / Math.max(1, vw.h))));
    scale = Math.min(vw.w / W, vw.h / H);
    boxW = vw.w;
    boxH = vw.h;
  } else {
    boxW = Math.min(1280, vw.box);
    // 화면 높이에 맞춰 (메뉴 · 머리말 자리를 뺌)
    const maxH = Math.max(420, vw.h - 96);
    W = 900;
    H = 460;
    scale = Math.min(boxW / W, maxH / H);
    if (boxW / W > scale) W = Math.min(1000, Math.round(boxW / scale));
    boxH = Math.round(H * scale);
  }
  const lockLand = () => {
    const el = document.documentElement;
    const o = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (typeof el.requestFullscreen === "function")
      el.requestFullscreen({ navigationUI: "hide" }).then(
        () => void o?.lock?.("landscape").catch(() => {}),
        () => {}
      );
  };

  const stage = (
    <div
      className={`stk relative overflow-hidden ${FONT}`}
      style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left", background: C.bg, color: C.text, fontVariantNumeric: "tabular-nums" }}
    >
      {children({ w: W, h: H, phone })}
    </div>
  );

  if (phone)
    return (
      <div ref={host} className="fixed inset-0 z-[60]" style={{ background: C.bg }}>
        {land ? (
          <div style={{ position: "absolute", left: (boxW - W * scale) / 2, top: (boxH - H * scale) / 2, width: W * scale, height: H * scale }}>{stage}</div>
        ) : (
          <div className={`flex h-full flex-col items-center justify-center gap-4 px-8 text-center ${FONT}`} style={{ color: C.text }}>
            <div className="stk-rotate text-[56px]" aria-hidden>
              📱
            </div>
            <p className={`${TITLE} text-[22px]`}>폰을 가로로 돌려 주세요</p>
            <p className="text-[13px]" style={{ color: C.mute }}>
              주식게임은 가로 화면으로 해요
            </p>
            <button type="button" onClick={lockLand} className="mt-2 cursor-pointer rounded-full px-5 py-2 text-[13px] font-bold" style={{ background: C.gold, color: "#1A1408" }}>
              전체화면 · 가로로
            </button>
          </div>
        )}
      </div>
    );

  return (
    <div ref={host} className="mx-auto w-full max-w-[1280px]">
      <div className="relative mx-auto overflow-hidden rounded-[14px]" style={{ width: Math.round(W * scale), height: boxH, background: C.bg, boxShadow: "0 10px 40px rgba(0,0,0,0.35)" }}>
        {stage}
      </div>
    </div>
  );
}
