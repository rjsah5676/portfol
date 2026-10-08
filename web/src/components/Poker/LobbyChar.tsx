"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { asset, lookReady } from "@/lib/poker/assets";
import { CHARS, lookChar, skinOf, type Look } from "@/lib/poker/rules";
import { playVoice } from "@/lib/poker/sfx";

/*
 * 로비의 내 캐릭터.
 *   기본 캐릭터: 그림 한 장 — 누르면 음성 한마디 + 금빛 반짝임 (몸은 안 움직임. 움직이는 그림이 없어서 억지로 튀기면 어색함)
 *   스킨: 동작 그림이 여러 장 — 몇 초마다 다른 포즈로 서서히 바뀌고, 누르면 반응 포즈 + 하트
 *   스킨 그림이 아직 없으면 기본 캐릭터처럼 보임 (ready 가 켜지면 자동으로 동작).
 * 말풍선은 없음 (로비가 어수선해져서).
 */

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
  const idleFrames = animated ? [1, 2, 3, 4, 5, 6].map((i) => asset.lobby(look, i)) : [];
  const touchFrames = animated ? [1, 2, 3].map((i) => asset.touch(look, i)) : [];
  const still = asset.full(look);
  const [frame, setFrame] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [hearts, setHearts] = useState<{ key: number; x: number }[]>([]);
  const busyUntil = useRef(0);
  const key = useRef(0);

  // 스킨: 몇 초마다 다른 동작
  useEffect(() => {
    if (!animated) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(
        () => {
          if (Date.now() >= busyUntil.current)
            setFrame(idleFrames[Math.floor(Math.random() * idleFrames.length)]);
          next();
        },
        3200 + Math.random() * 2600
      );
    };
    next();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 그림 목록은 look 으로 정해짐
  }, [look]);
  // 그림 미리 받기
  useEffect(() => {
    for (const src of [...idleFrames, ...touchFrames]) new Image().src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 그림 목록은 look 으로 정해짐
  }, [look]);

  const poke = () => {
    if (Date.now() < busyUntil.current - 1200) return;
    busyUntil.current = Date.now() + 2200;
    const k = ++key.current;
    setFlash(k);
    if (touchFrames.length) setFrame(touchFrames[Math.floor(Math.random() * touchFrames.length)]);
    if (skin) {
      const hs = [0, 1, 2].map((i) => ({ key: k * 10 + i, x: 30 + Math.random() * 40 }));
      setHearts((h) => [...h, ...hs]);
      setTimeout(() => setHearts((h) => h.filter((x) => !hs.includes(x))), 1600);
    }
    playVoice(look, Math.random() < 0.5 ? "select" : "hello");
  };

  const shown = animated ? (frame ?? idleFrames[0]) : still;
  // 바로 앞 그림 (새 그림이 그 위로 서서히 나타나게)
  const [under, setUnder] = useState(shown);
  useEffect(() => {
    const t = setTimeout(() => setUnder(shown), 420);
    return () => clearTimeout(t);
  }, [shown]);
  return (
    <button
      type="button"
      onClick={poke}
      aria-label={`${CHARS[char].name} 쓰다듬기`}
      className={`pk-lobbychar ${className}`}
      style={style}
    >
      <span className={`pk-lobbychar-body ${bust ? "overflow-hidden" : ""}`}>
        {under !== shown && (
          <img
            src={under}
            alt=""
            draggable={false}
            className={`pk-lobbychar-img ${bust ? "pk-lobbychar-bust" : ""}`}
          />
        )}
        {}
        <img
          key={shown}
          src={shown}
          alt=""
          draggable={false}
          className={`pk-lobbychar-img pk-lobbychar-in ${bust ? "pk-lobbychar-bust" : ""}`}
        />
        {/* 누르면 금빛 반짝임이 한 번 지나감 */}
        {flash > 0 && <span key={`f${flash}`} className="pk-lobbychar-flash" aria-hidden />}
      </span>
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
