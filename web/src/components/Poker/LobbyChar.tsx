"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { asset, liveIdle } from "@/lib/poker/assets";
import { CHARS, lookChar, skinOf, type Look } from "@/lib/poker/rules";
import { hasSound, playVoice } from "@/lib/poker/sfx";

/*
 * 로비의 내 캐릭터.
 *   기본 캐릭터: 대기 영상(char/{id}/idle.webp)이 있으면 그게 반복, 없으면 전신 그림 한 장 (눌러도 아무 일 없음).
 *   라이브 스킨(rules.ts 의 live): 대기 영상(idle.webp, 투명 배경 움직이는 그림)이 계속 반복되고,
 *     누르면 하트 + 음성. 터치 반응 영상(touch-1~3.webp)이 있으면 그걸 한 번 틀고 대기로 돌아감.
 *   움직이는 그림을 받는 동안은 전신 그림이 보임.
 */

const TOUCH_N = 3;
/** 터치 반응 영상 한 편 길이 (6초, 끝나면 대기로). 끝날 때까지 다시 눌러도 무시 */
const TOUCH_MS = 6000;

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
  // 대기 영상: 라이브 스킨 + 영상이 있는 기본 캐릭터. 누르면 반응하는 건 스킨만
  const live = liveIdle(look);
  const touchable = live && !!skin;
  const char = lookChar(look);
  const still = asset.full(look);
  const [idleOk, setIdleOk] = useState(false);
  // 있는 터치 반응 영상 번호들
  const [touches, setTouches] = useState<number[]>([]);
  // 지금 틀고 있는 터치 영상 (재생할 때마다 새로 만든 blob 주소 — 같은 주소면 브라우저가 한 번 끝난 움직이는 그림을 처음부터 다시 안 틀어 줘서 멈춘 것처럼 보임)
  const [touchUrl, setTouchUrl] = useState("");
  const blobs = useRef<Record<number, Blob>>({});
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
    let alive = true;
    for (let i = 1; touchable && i <= TOUCH_N; i++) {
      fetch(asset.touch(look, i))
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((b) => {
          if (!alive) return;
          blobs.current[i] = b;
          setTouches((p) => (p.includes(i) ? p : [...p, i]));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
      clearTimeout(touchTimer.current);
    };
  }, [live, touchable, look]);
  // 다 쓴 blob 주소 정리
  useEffect(() => {
    if (!touchUrl) return;
    return () => URL.revokeObjectURL(touchUrl);
  }, [touchUrl]);

  const lastTouch = useRef(0);
  const poke = () => {
    if (!touchable || Date.now() < busyUntil.current) return;
    const k = ++key.current;
    const hs = [0, 1, 2].map((i) => ({ key: k * 10 + i, x: 30 + Math.random() * 40 }));
    setHearts((h) => [...h, ...hs]);
    setTimeout(() => setHearts((h) => h.filter((x) => !hs.includes(x))), 1600);
    const greet = () => playVoice(look, Math.random() < 0.5 ? "select" : "hello");
    if (!touches.length) {
      greet();
      busyUntil.current = Date.now() + 1400;
      return;
    }
    // 무작위로 하나 (방금 나온 것은 빼고)
    const pool = touches.length > 1 ? touches.filter((t) => t !== lastTouch.current) : touches;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    lastTouch.current = pick;
    // 그 동작 전용 대사(voice/{스킨}/{스킨}-touch-N)가 있으면 그것, 없으면 인사 대사
    if (hasSound(`voice/${look}/${look}-touch-${pick}`)) playVoice(look, `touch-${pick}`);
    else greet();
    setTouchUrl(URL.createObjectURL(blobs.current[pick]));
    busyUntil.current = Date.now() + TOUCH_MS;
    clearTimeout(touchTimer.current);
    touchTimer.current = setTimeout(() => setTouchUrl(""), TOUCH_MS);
  };

  const imgCls = `pk-lobbychar-img ${bust ? "pk-lobbychar-bust" : ""}`;
  const shown = !live
    ? still
    : touchUrl
      ? touchUrl
      : idleOk
        ? asset.idle(look)
        : still;
  const body = (
    <span className={`pk-lobbychar-body ${bust ? "overflow-hidden" : ""}`}>
      {}
      <img key={shown} src={shown} alt="" draggable={false} className={imgCls} />
    </span>
  );
  if (!touchable)
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
