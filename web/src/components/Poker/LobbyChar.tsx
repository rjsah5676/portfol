"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { asset, lookReady } from "@/lib/poker/assets";
import { CHARS, lookChar, skinOf, type Look, type Pose } from "@/lib/poker/rules";
import { playVoice } from "@/lib/poker/sfx";

/*
 * 로비의 내 캐릭터. 숨쉬듯 살짝 움직이고, 누르면 반응(통 튀기 · 하트 · 한마디 · 음성).
 * 스킨을 입었으면 동작을 더: 몇 초마다 다른 포즈로 부드럽게 바뀌고, 누르면 반응 포즈.
 *   스킨 그림이 들어오면 lobby-1~6 · touch-1~3, 아직이면 원래 캐릭터의 동작 그림(pose-*)으로 대신.
 * (진짜 관절 애니메이션이 아니라 "그림 여러 장 + CSS 움직임" 방식)
 */

const FALLBACK_IDLE: Pose[] = ["idle", "think", "check", "bet", "win"];
const FALLBACK_TOUCH: Pose[] = ["allin", "win", "check"];
const SKIN_LINES: Record<string, string[]> = {
  "amy-summer": [
    "뭘 그렇게 봐! …어울리긴 해?",
    "만지지 마! …조금은 괜찮지만.",
    "바다 가고 싶다… 아, 아무것도 아냐!",
    "선크림 발라 줄 거야? …노, 농담이거든!",
    "이 수영복, 딱히 너 보라고 입은 거 아니야!",
  ],
};

export default function LobbyChar({
  look,
  className = "",
  style,
  /** 위쪽만 보이게 잘라 보여 줄 때 (폰 로비의 좁은 칸) */
  bust,
  onSay,
}: {
  look: Look;
  className?: string;
  style?: CSSProperties;
  bust?: boolean;
  /** 한마디를 밖에서 보여 줄 때 (좁은 칸이라 말풍선이 잘릴 때) */
  onSay?: (text: string) => void;
}) {
  const skin = skinOf(look);
  const ready = lookReady(look);
  const char = lookChar(look);
  // 동작 그림들
  const idleFrames = skin
    ? ready
      ? [1, 2, 3, 4, 5, 6].map((i) => asset.lobby(look, i))
      : FALLBACK_IDLE.map((p) => asset.pose(look, p))
    : [];
  const touchFrames = skin
    ? ready
      ? [1, 2, 3].map((i) => asset.touch(look, i))
      : FALLBACK_TOUCH.map((p) => asset.pose(look, p))
    : [];
  const still = asset.full(look);
  const [frame, setFrame] = useState<string | null>(null);
  const [hop, setHop] = useState(0);
  const [say, setSay] = useState<{ text: string; key: number } | null>(null);
  const [hearts, setHearts] = useState<{ key: number; x: number }[]>([]);
  const busyUntil = useRef(0);
  const key = useRef(0);

  // 스킨: 몇 초마다 다른 동작
  useEffect(() => {
    if (!skin) return;
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
    if (Date.now() < busyUntil.current - 1600) return;
    busyUntil.current = Date.now() + 2600;
    setHop((n) => n + 1);
    if (touchFrames.length) setFrame(touchFrames[Math.floor(Math.random() * touchFrames.length)]);
    const lines = SKIN_LINES[look] ?? [CHARS[char].blurb];
    const k = ++key.current;
    const text = lines[Math.floor(Math.random() * lines.length)];
    if (onSay) onSay(text);
    else {
      setSay({ text, key: k });
      setTimeout(() => setSay((s) => (s?.key === k ? null : s)), 2600);
    }
    if (skin) {
      const hs = [0, 1, 2].map((i) => ({ key: k * 10 + i, x: 30 + Math.random() * 40 }));
      setHearts((h) => [...h, ...hs]);
      setTimeout(() => setHearts((h) => h.filter((x) => !hs.includes(x))), 1600);
    }
    playVoice(look, Math.random() < 0.5 ? "select" : "hello");
  };

  const shown = skin ? (frame ?? idleFrames[0]) : still;
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
      <span
        key={`b${hop}`}
        className={`pk-lobbychar-body ${hop ? "pk-lobbychar-hop" : ""} ${bust ? "overflow-hidden" : ""}`}
      >
        {/* 이전 그림 위로 새 그림이 겹쳐 서서히 나타남 */}
        {under !== shown && (
          <img
            src={under}
            alt=""
            draggable={false}
            className={`pk-lobbychar-img pk-lobbychar-under ${bust ? "pk-lobbychar-bust" : ""}`}
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
      {say && (
        <span key={`s${say.key}`} className="pk-lobbychar-say">
          {say.text}
        </span>
      )}
    </button>
  );
}
