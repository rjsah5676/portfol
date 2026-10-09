"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { asset, lookReady } from "@/lib/poker/assets";
import { CHARS, lookChar, skinOf, type Look } from "@/lib/poker/rules";
import { playVoice } from "@/lib/poker/sfx";

/*
 * 로비의 내 캐릭터.
 *   기본 캐릭터 · 움직이는 그림이 없는 스킨: 전신 그림 한 장 (눌러도 아무 일 없음).
 *   라이브 스킨(rules.ts 의 live): 대기 영상(idle.webp, 투명 배경 움직이는 그림)이 계속 반복되고,
 *     누르면 하트 + 음성. 터치 반응 영상(touch-1~3.webp)이 있으면 그걸 한 번 틀고 대기로 돌아감.
 *   움직이는 그림을 받는 동안은 전신 그림이 보임.
 */

const TOUCH_N = 3;
/** 터치 반응 영상 한 편 길이 (끝나면 대기로) */
const TOUCH_MS = 4200;

export default function LobbyChar({
  look,
  className = "",
  style,
  /** 위쪽만 보이게 잘라 보여 줄 때 (폰 로비의 좁은 칸) */
  bust,
}: {
  look: Look;
  className?: string;
  style?: CSSProperties;
  bust?: boolean;
}) {
  const skin = skinOf(look);
  const live = !!skin?.live && lookReady(look);
  const char = lookChar(look);
  const still = asset.full(look);
  const [idleOk, setIdleOk] = useState(false);
  // 있는 터치 반응 영상 번호들
  const [touches, setTouches] = useState<number[]>([]);
  const [touch, setTouch] = useState(0);
  const [hearts, setHearts] = useState<{ key: number; x: number }[]>([]);
  const busyUntil = useRef(0);
  const key = useRef(0);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 움직이는 그림 미리 받기 (없는 터치 영상은 건너뜀)
  useEffect(() => {
    if (!live) return;
    const im = new Image();
    im.onload = () => setIdleOk(true);
    im.src = asset.idle(look);
    for (let i = 1; i <= TOUCH_N; i++) {
      const t = new Image();
      t.onload = () => setTouches((p) => (p.includes(i) ? p : [...p, i]));
      t.src = asset.touch(look, i);
    }
    return () => clearTimeout(touchTimer.current);
  }, [live, look]);

  const poke = () => {
    if (!live || Date.now() < busyUntil.current) return;
    busyUntil.current = Date.now() + 1400;
    const k = ++key.current;
    const hs = [0, 1, 2].map((i) => ({ key: k * 10 + i, x: 30 + Math.random() * 40 }));
    setHearts((h) => [...h, ...hs]);
    setTimeout(() => setHearts((h) => h.filter((x) => !hs.includes(x))), 1600);
    playVoice(look, Math.random() < 0.5 ? "select" : "hello");
    if (touches.length) {
      // 같은 그림을 다시 틀 때 처음부터 나오게 주소에 번호를 붙임
      setTouch(touches[Math.floor(Math.random() * touches.length)] * 1000 + (k % 1000));
      busyUntil.current = Date.now() + TOUCH_MS;
      clearTimeout(touchTimer.current);
      touchTimer.current = setTimeout(() => setTouch(0), TOUCH_MS);
    }
  };

  const imgCls = `pk-lobbychar-img ${bust ? "pk-lobbychar-bust" : ""}`;
  const shown = !live
    ? still
    : touch
      ? `${asset.touch(look, Math.floor(touch / 1000))}#${touch % 1000}`
      : idleOk
        ? asset.idle(look)
        : still;
  const body = (
    <span className={`pk-lobbychar-body ${bust ? "overflow-hidden" : ""}`}>
      {}
      <img key={shown} src={shown} alt="" draggable={false} className={imgCls} />
    </span>
  );
  if (!live)
    return (
      <div className={`pk-lobbychar ${className}`} style={style} aria-hidden>
        {body}
      </div>
    );
  return (
    <button
      type="button"
      onClick={poke}
      aria-label={`${CHARS[char].name} 쓰다듬기`}
      className={`pk-lobbychar cursor-pointer ${className}`}
      style={style}
    >
      {body}
      {hearts.map((h) => (
        <span
          key={`h${h.key}`}
          className="pk-lobbychar-heart"
          style={{ left: `${h.x}%` }}
          aria-hidden
        >
          ♥
        </span>
      ))}
    </button>
  );
}
