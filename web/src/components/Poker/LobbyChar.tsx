"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { asset, lookReady } from "@/lib/poker/assets";
import { CHARS, lookChar, skinOf, type Look } from "@/lib/poker/rules";
import { playVoice } from "@/lib/poker/sfx";

/*
 * 로비의 내 캐릭터.
 *   기본 캐릭터: 그림 한 장, 그냥 서 있음 (눌러도 아무 일 없음).
 *   스킨(그림이 들어온 것): 숨 쉬듯 미세하게 움직이고(CSS), 3~5초마다 다른 포즈로 서서히 바뀌고(lobby-1~6),
 *     같은 포즈의 눈 감은 그림(lobby-N-blink)이 있으면 가끔 깜빡이고, 누르면 반응 포즈(touch-1~3) + 하트 + 음성.
 *   스킨 그림이 아직 없으면 기본 캐릭터처럼 보임 (rules.ts 의 ready 가 켜지면 자동으로 동작).
 */

const IDLE_N = 6;
const TOUCH_N = 3;

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
  const animated = !!skin && lookReady(look);
  const char = lookChar(look);
  const still = asset.full(look);
  // 지금 보이는 포즈 번호 (0 = 아직 전신 그림)
  const [pose, setPose] = useState(() => (animated ? 1 : 0));
  const [touch, setTouch] = useState(0);
  const [blink, setBlink] = useState(false);
  const [hearts, setHearts] = useState<{ key: number; x: number }[]>([]);
  // 깜빡임 그림이 있는 포즈만 깜빡임 (없는 파일은 한 번 실패하면 기억)
  const [noBlink, setNoBlink] = useState<Set<number>>(() => new Set());
  const busyUntil = useRef(0);
  const key = useRef(0);

  // 포즈 순환
  useEffect(() => {
    if (!animated) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(
        () => {
          if (Date.now() >= busyUntil.current) {
            setTouch(0);
            setPose((p) => {
              let n = 1 + Math.floor(Math.random() * IDLE_N);
              if (n === p) n = (n % IDLE_N) + 1;
              return n;
            });
          }
          next();
        },
        3200 + Math.random() * 2400
      );
    };
    next();
    return () => clearTimeout(t);
  }, [animated]);

  // 깜빡임: 2~5초마다 0.14초 (가끔 두 번 연달아)
  useEffect(() => {
    if (!animated) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(
        () => {
          if (Date.now() >= busyUntil.current) {
            setBlink(true);
            setTimeout(() => setBlink(false), 140);
            if (Math.random() < 0.25)
              setTimeout(() => {
                setBlink(true);
                setTimeout(() => setBlink(false), 120);
              }, 260);
          }
          next();
        },
        2000 + Math.random() * 3000
      );
    };
    next();
    return () => clearTimeout(t);
  }, [animated]);

  // 그림 미리 받기
  useEffect(() => {
    if (!animated) return;
    for (let i = 1; i <= IDLE_N; i++) {
      new Image().src = asset.lobby(look, i);
      const b = new Image();
      b.onerror = () => setNoBlink((prev) => new Set(prev).add(i));
      b.src = asset.lobbyBlink(look, i);
    }
    for (let i = 1; i <= TOUCH_N; i++) new Image().src = asset.touch(look, i);
  }, [animated, look]);

  const poke = () => {
    if (!animated || Date.now() < busyUntil.current - 1200) return;
    busyUntil.current = Date.now() + 2400;
    const k = ++key.current;
    setBlink(false);
    setTouch(1 + Math.floor(Math.random() * TOUCH_N));
    const hs = [0, 1, 2].map((i) => ({ key: k * 10 + i, x: 30 + Math.random() * 40 }));
    setHearts((h) => [...h, ...hs]);
    setTimeout(() => setHearts((h) => h.filter((x) => !hs.includes(x))), 1600);
    playVoice(look, Math.random() < 0.5 ? "select" : "hello");
  };

  const shown = !animated
    ? still
    : touch
      ? asset.touch(look, touch)
      : pose && blink && !noBlink.has(pose)
        ? asset.lobbyBlink(look, pose)
        : pose
          ? asset.lobby(look, pose)
          : still;
  // 바로 앞 포즈 (새 그림이 그 위로 서서히 나타나게). 깜빡임은 즉시 바뀜
  const base = !animated
    ? still
    : touch
      ? asset.touch(look, touch)
      : pose
        ? asset.lobby(look, pose)
        : still;
  const [under, setUnder] = useState(base);
  useEffect(() => {
    const t = setTimeout(() => setUnder(base), 420);
    return () => clearTimeout(t);
  }, [base]);
  const imgCls = `pk-lobbychar-img ${bust ? "pk-lobbychar-bust" : ""}`;
  const body = (
    <span
      className={`pk-lobbychar-body ${animated ? "pk-lobbychar-breathe" : ""} ${bust ? "overflow-hidden" : ""}`}
    >
      {under !== base && <img src={under} alt="" draggable={false} className={imgCls} />}
      {}
      <img
        key={base}
        src={shown}
        alt=""
        draggable={false}
        className={`${imgCls} ${under !== base ? "pk-lobbychar-in" : ""}`}
      />
    </span>
  );
  if (!animated)
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
