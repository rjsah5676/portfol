"use client";

import type { CSSProperties, ReactNode } from "react";
import Nick, { isGuestName, plainName } from "@/components/Nick";
import {
  artUrl,
  AVATAR_COLOR,
  hasArt,
  type ArtName,
  type MascotPose,
  type StampName,
} from "@/lib/sketch/assets";

/*
 * 스케치 퀴즈 그림. 진짜 그림(assets.ts READY)이 있으면 그 그림, 없으면 여기서 그린 SVG 낙서로 대신.
 */

const INK = "#2B2D42";

function Img({
  name,
  alt = "",
  className,
  style,
}: {
  name: ArtName;
  alt?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return <img src={artUrl(name)} alt={alt} draggable={false} className={className} style={style} />;
}

// ───────────── 아바타 (낙서 동물 8종) ─────────────

const EARS: Record<number, ReactNode> = {
  // 고양이: 뾰족 귀
  0: (
    <>
      <path d="M14 26 L13 7 L29 17 Z" />
      <path d="M50 26 L51 7 L35 17 Z" />
    </>
  ),
  // 강아지: 늘어진 귀
  1: (
    <>
      <path d="M15 20 C4 22 5 42 12 44 C16 40 17 30 20 22 Z" />
      <path d="M49 20 C60 22 59 42 52 44 C48 40 47 30 44 22 Z" />
    </>
  ),
  // 토끼: 긴 귀
  2: (
    <>
      <ellipse cx="23" cy="10" rx="5.5" ry="13" transform="rotate(-8 23 10)" />
      <ellipse cx="41" cy="10" rx="5.5" ry="13" transform="rotate(8 41 10)" />
    </>
  ),
  // 곰: 동그란 귀
  3: (
    <>
      <circle cx="16" cy="19" r="7" />
      <circle cx="48" cy="19" r="7" />
    </>
  ),
  // 개구리: 위로 튀어나온 눈
  4: (
    <>
      <circle cx="21" cy="17" r="8" />
      <circle cx="43" cy="17" r="8" />
    </>
  ),
  // 병아리: 머리 깃털
  5: <path d="M29 15 C27 8 31 5 32 10 C33 4 38 6 35 15 Z" />,
  // 돼지: 작은 접힌 귀
  6: (
    <>
      <path d="M15 24 L14 12 L25 18 Z" />
      <path d="M49 24 L50 12 L39 18 Z" />
    </>
  ),
  // 여우: 크고 뾰족한 귀
  7: (
    <>
      <path d="M13 28 L10 4 L30 17 Z" />
      <path d="M51 28 L54 4 L34 17 Z" />
    </>
  ),
};

function AvatarSvg({ idx }: { idx: number }) {
  const color = AVATAR_COLOR[idx] ?? AVATAR_COLOR[0];
  const frog = idx === 4;
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
      <g fill={color} stroke={INK} strokeWidth="2.6" strokeLinejoin="round">
        {EARS[idx]}
        {/* 머리 */}
        <path d="M32 15 C46 15 53 25 53 37 C53 50 44 57 32 57 C20 57 11 50 11 37 C11 25 18 15 32 15 Z" />
      </g>
      {/* 귀 안쪽 */}
      {(idx === 0 || idx === 7) && (
        <g fill="#FFD1DC" opacity="0.9">
          <path d="M16.5 22 L16 12 L24 17.5 Z" />
          <path d="M47.5 22 L48 12 L40 17.5 Z" />
        </g>
      )}
      {idx === 2 && (
        <g fill="#FFD1DC">
          <ellipse cx="23" cy="10" rx="2.4" ry="8" transform="rotate(-8 23 10)" />
          <ellipse cx="41" cy="10" rx="2.4" ry="8" transform="rotate(8 41 10)" />
        </g>
      )}
      {/* 여우 뺨 */}
      {idx === 7 && (
        <path
          d="M13 42 C20 40 26 46 32 50 C38 46 44 40 51 42 C49 52 41 57 32 57 C23 57 15 52 13 42 Z"
          fill="#FFF6EA"
        />
      )}
      {/* 눈 */}
      {frog ? (
        <g>
          <circle cx="21" cy="17" r="3.4" fill="#fff" />
          <circle cx="43" cy="17" r="3.4" fill="#fff" />
          <circle cx="21.5" cy="17.5" r="1.9" fill={INK} />
          <circle cx="43.5" cy="17.5" r="1.9" fill={INK} />
        </g>
      ) : (
        <g fill={INK}>
          <ellipse cx="24.5" cy="36" rx="2.6" ry="3.3" />
          <ellipse cx="39.5" cy="36" rx="2.6" ry="3.3" />
          <circle cx="25.4" cy="34.8" r="0.9" fill="#fff" />
          <circle cx="40.4" cy="34.8" r="0.9" fill="#fff" />
        </g>
      )}
      {/* 볼터치 */}
      <g fill="#FF6B6B" opacity="0.35">
        <ellipse cx="19" cy="44" rx="4" ry="2.4" />
        <ellipse cx="45" cy="44" rx="4" ry="2.4" />
      </g>
      {/* 코 · 입 */}
      {idx === 6 ? (
        <g>
          <ellipse
            cx="32"
            cy="45"
            rx="6.5"
            ry="4.6"
            fill="#FFB3C1"
            stroke={INK}
            strokeWidth="2.2"
          />
          <ellipse cx="29.6" cy="45" rx="1.1" ry="1.6" fill={INK} />
          <ellipse cx="34.4" cy="45" rx="1.1" ry="1.6" fill={INK} />
        </g>
      ) : idx === 5 ? (
        <path
          d="M27 43 L37 43 L32 48.5 Z"
          fill="#FF9F1C"
          stroke={INK}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      ) : frog ? (
        <path
          d="M21 42 C27 49 37 49 43 42"
          fill="none"
          stroke={INK}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      ) : (
        <g fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round">
          <ellipse cx="32" cy="42" rx="2.4" ry="1.7" fill={INK} />
          <path d="M28 46 C30 48.5 32 47.5 32 45.5 C32 47.5 34 48.5 36 46" />
          {idx === 0 && (
            <path d="M8 40 L17 41 M8 45 L17 44 M56 40 L47 41 M56 45 L47 44" strokeWidth="1.6" />
          )}
        </g>
      )}
    </svg>
  );
}

/** 사람 얼굴 (uid → avatarOf 로 정한 번호) */
export function Avatar({
  idx,
  size = 40,
  ring,
  className = "",
}: {
  idx: number;
  size?: number;
  /** 테두리 강조 색 */
  ring?: string;
  className?: string;
}) {
  const name = `avatar-${idx}` as ArtName;
  return (
    <span
      className={`sk-avatar ${className}`}
      style={{ width: size, height: size, ...(ring ? { boxShadow: `0 0 0 3px ${ring}` } : {}) }}
    >
      {hasArt(name) ? (
        <Img name={name} className="h-full w-full object-contain" />
      ) : (
        <AvatarSvg idx={idx} />
      )}
    </span>
  );
}

// ───────────── 마스코트 (연필 캐릭터 「끄적이」) ─────────────

function MascotSvg({ pose }: { pose: MascotPose }) {
  const happy = pose === "cheer" || pose === "wave" || pose === "draw";
  const eyes =
    pose === "sleep" ? (
      <g fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round">
        <path d="M33 58 C35 61 39 61 41 58" />
        <path d="M51 58 C53 61 57 61 59 58" />
      </g>
    ) : happy ? (
      <g fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round">
        <path d="M33 60 C35 55 39 55 41 60" />
        <path d="M51 60 C53 55 57 55 59 60" />
      </g>
    ) : (
      <g fill={INK}>
        <ellipse cx="37" cy="58" rx={pose === "wow" ? 3.6 : 3} ry={pose === "wow" ? 4.6 : 3.8} />
        <ellipse cx="55" cy="58" rx={pose === "wow" ? 3.6 : 3} ry={pose === "wow" ? 4.6 : 3.8} />
        <circle cx="38" cy="56.6" r="1.1" fill="#fff" />
        <circle cx="56" cy="56.6" r="1.1" fill="#fff" />
      </g>
    );
  const mouth =
    pose === "sad" ? (
      <path d="M40 72 C44 68 48 68 52 72" />
    ) : pose === "wow" ? (
      <ellipse cx="46" cy="71" rx="3.4" ry="4.2" fill={INK} />
    ) : pose === "think" ? (
      <path d="M41 70 L51 69" />
    ) : pose === "sleep" ? (
      <ellipse cx="46" cy="70" rx="2.2" ry="1.6" fill={INK} />
    ) : (
      <path d="M39 67 C42 74 50 74 53 67" fill="#FF8FA3" />
    );
  // 팔: 자세마다
  const arms: Record<MascotPose, ReactNode> = {
    idle: <path d="M24 74 C16 78 14 86 17 90 M68 74 C76 78 78 86 75 90" />,
    wave: <path d="M24 74 C16 78 14 86 17 90 M68 72 C78 66 82 56 80 48" />,
    think: <path d="M24 74 C16 78 14 86 17 90 M68 76 C70 82 60 82 55 76" />,
    draw: <path d="M24 74 C16 78 14 86 17 90 M68 74 C78 78 84 84 86 90" />,
    cheer: <path d="M24 72 C14 64 12 54 14 46 M68 72 C78 64 80 54 78 46" />,
    sad: <path d="M24 76 C20 84 20 92 22 96 M68 76 C72 84 72 92 70 96" />,
    wow: <path d="M24 72 C14 70 8 62 8 56 M68 72 C78 70 84 62 84 56" />,
    sleep: <path d="M24 76 C20 84 20 92 22 96 M68 76 C72 84 72 92 70 96" />,
  };
  return (
    <svg viewBox="0 0 92 140" className="h-full w-full overflow-visible" aria-hidden>
      {/* 지우개 + 쇠 띠 */}
      <rect
        x="25"
        y="8"
        width="42"
        height="18"
        rx="7"
        fill="#FF8FA3"
        stroke={INK}
        strokeWidth="2.8"
      />
      <rect x="24" y="24" width="44" height="12" fill="#C9CED6" stroke={INK} strokeWidth="2.8" />
      <path d="M24 30 H68" stroke={INK} strokeWidth="1.6" />
      {/* 몸통 */}
      <path
        d="M24 36 H68 V100 H24 Z"
        fill="#FFC93C"
        stroke={INK}
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <path d="M38 36 V100 M54 36 V100" stroke="#E0A51E" strokeWidth="2" />
      {/* 깎은 나무 + 심 */}
      <path
        d="M24 100 L46 132 L68 100 Z"
        fill="#F6D7A7"
        stroke={INK}
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <path d="M39 122 L46 132 L53 122 Z" fill={INK} />
      {/* 얼굴 */}
      {eyes}
      <g fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {mouth}
      </g>
      <g fill="#FF6B6B" opacity="0.4">
        <ellipse cx="31" cy="66" rx="4" ry="2.5" />
        <ellipse cx="61" cy="66" rx="4" ry="2.5" />
      </g>
      {/* 팔 */}
      <g fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round">
        {arms[pose]}
      </g>
      {/* 소품 */}
      {pose === "think" && (
        <text
          x="72"
          y="30"
          fontSize="26"
          fontWeight="700"
          fill={INK}
          fontFamily="Gaegu, sans-serif"
        >
          ?
        </text>
      )}
      {pose === "sleep" && (
        <text
          x="70"
          y="26"
          fontSize="18"
          fontWeight="700"
          fill="#4EA8DE"
          fontFamily="Gaegu, sans-serif"
        >
          z z
        </text>
      )}
      {pose === "wow" && (
        <text
          x="74"
          y="28"
          fontSize="26"
          fontWeight="700"
          fill="#FF6B6B"
          fontFamily="Gaegu, sans-serif"
        >
          !
        </text>
      )}
      {pose === "draw" && (
        <path
          d="M70 118 C76 112 82 124 88 116"
          fill="none"
          stroke="#4EA8DE"
          strokeWidth="3"
          strokeLinecap="round"
          className="sk-draw-line"
        />
      )}
      {pose === "cheer" && (
        <g fill="#FFC93C" stroke={INK} strokeWidth="1.6">
          <path d="M8 34 l2 5 5 1 -4 3 1 5 -4 -3 -4 3 1 -5 -4 -3 5 -1 Z" />
          <path d="M80 28 l2 5 5 1 -4 3 1 5 -4 -3 -4 3 1 -5 -4 -3 5 -1 Z" />
        </g>
      )}
    </svg>
  );
}

/** 마스코트 끄적이 */
export function Mascot({
  pose = "idle",
  size = 120,
  className = "",
  bob = true,
}: {
  pose?: MascotPose;
  /** 높이(px) */
  size?: number;
  className?: string;
  /** 숨쉬듯 들썩임 */
  bob?: boolean;
}) {
  const name = `mascot-${pose}` as ArtName;
  return (
    <span
      className={`inline-block ${bob ? "sk-bob" : ""} ${className}`}
      style={{ height: size, width: hasArt(name) ? size : size * 0.66 }}
    >
      {hasArt(name) ? (
        <Img name={name} className="h-full w-full object-contain" />
      ) : (
        <MascotSvg pose={pose} />
      )}
    </span>
  );
}

// ───────────── 로고 ─────────────

const LOGO_COLORS = ["#FF6B6B", "#FF9F43", "#FFC93C", "#2EC4B6", "#4EA8DE", "#9B5DE5"];

export function Logo({ size = 1, className = "" }: { size?: number; className?: string }) {
  if (hasArt("logo"))
    return (
      <Img
        name="logo"
        alt="스케치 퀴즈"
        className={className}
        style={{ height: 120 * size, width: "auto" }}
      />
    );
  const word = "스케치퀴즈";
  return (
    <span
      className={`sk-logo inline-flex flex-col items-center ${className}`}
      style={{ fontSize: 64 * size }}
      role="img"
      aria-label="스케치 퀴즈"
    >
      <span className="flex items-end leading-none">
        {[...word].map((ch, i) => (
          <span
            key={i}
            className="sk-logo-ch"
            style={{
              color: LOGO_COLORS[i % LOGO_COLORS.length],
              rotate: `${[-6, 4, -3, 5, -4][i]}deg`,
              marginLeft: i === 3 ? "0.28em" : undefined,
              animationDelay: `${i * 0.08}s`,
            }}
          >
            {ch}
          </span>
        ))}
      </span>
      <svg viewBox="0 0 300 18" className="-mt-[0.05em] w-[4.6em]" aria-hidden>
        <path
          d="M4 11 C40 3 70 16 110 9 C150 2 180 15 220 8 C250 3 275 12 296 7"
          fill="none"
          stroke="#2B2D42"
          strokeWidth="5"
          strokeLinecap="round"
          className="sk-draw-line"
        />
      </svg>
      <span className="mt-[0.1em] font-mono text-[0.2em] font-bold tracking-[0.5em] text-[#2B2D42]/70">
        SKETCH QUIZ
      </span>
    </span>
  );
}

// ───────────── 도장 (정답! · 시간 끝 …) ─────────────

const STAMP_TEXT: Record<StampName, { t: string; c: string }> = {
  correct: { t: "정답!", c: "#2EC4B6" },
  timeup: { t: "시간 끝!", c: "#FF6B6B" },
  myturn: { t: "내 차례!", c: "#9B5DE5" },
  great: { t: "멋져요!", c: "#FF9F43" },
  close: { t: "아까워!", c: "#4EA8DE" },
  winner: { t: "우승!", c: "#FFB000" },
  skip: { t: "건너뜀", c: "#8D93A5" },
  ready: { t: "시작!", c: "#FF6B6B" },
};

export function Stamp({
  name,
  size = 1,
  className = "",
}: {
  name: StampName;
  size?: number;
  className?: string;
}) {
  const art = `stamp-${name}` as ArtName;
  if (hasArt(art))
    return (
      <Img
        name={art}
        alt={STAMP_TEXT[name].t}
        className={`sk-stamp-in ${className}`}
        style={{ height: 110 * size, width: "auto" }}
      />
    );
  const { t, c } = STAMP_TEXT[name];
  return (
    <span
      className={`sk-stamp sk-stamp-in ${className}`}
      style={{ color: c, borderColor: c, fontSize: 44 * size }}
    >
      {t}
    </span>
  );
}

// ───────────── 메달 ─────────────

const MEDAL = { 1: "#FFC93C", 2: "#C9CED6", 3: "#E0975A" } as const;
export function Medal({ rank, size = 36 }: { rank: 1 | 2 | 3; size?: number }) {
  const art = `medal-${rank}` as ArtName;
  if (hasArt(art))
    return (
      <Img
        name={art}
        alt={`${rank}등`}
        style={{ height: size, width: size }}
        className="object-contain"
      />
    );
  return (
    <svg viewBox="0 0 40 40" style={{ width: size, height: size }} aria-label={`${rank}등`}>
      <path
        d="M12 2 L18 16 L22 16 L16 2 Z M28 2 L22 16 L18 16 L24 2 Z"
        fill="#FF6B6B"
        stroke={INK}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="25" r="12" fill={MEDAL[rank]} stroke={INK} strokeWidth="2.4" />
      <text
        x="20"
        y="31"
        textAnchor="middle"
        fontSize="16"
        fontWeight="800"
        fill={INK}
        fontFamily="Gaegu, sans-serif"
      >
        {rank}
      </text>
    </svg>
  );
}

// ───────────── 배경 낙서 (그려지는 효과) ─────────────

const DOODLES = [
  // 별
  "M20 4 L25 15 L37 16 L28 24 L31 36 L20 30 L9 36 L12 24 L3 16 L15 15 Z",
  // 하트
  "M20 34 C4 22 4 10 13 8 C17 7 20 10 20 13 C20 10 23 7 27 8 C36 10 36 22 20 34 Z",
  // 나선
  "M20 20 C20 17 24 17 24 20 C24 25 16 25 16 20 C16 13 28 13 28 20 C28 29 12 29 12 20 C12 9 32 9 32 20",
  // 구름
  "M8 28 C2 28 2 19 9 19 C9 11 19 9 22 15 C25 9 35 11 33 20 C39 20 39 28 32 28 Z",
  // 번개
  "M22 2 L10 22 L19 22 L15 38 L30 15 L21 15 L25 2 Z",
  // 꼬불선
  "M2 20 C8 8 12 32 18 20 C24 8 28 32 34 20 C37 14 38 18 38 18",
  // 해
  "M20 13 A7 7 0 1 0 20.01 13 M20 2 V7 M20 33 V38 M2 20 H7 M33 20 H38 M7 7 L10.5 10.5 M29.5 29.5 L33 33 M33 7 L29.5 10.5 M10.5 29.5 L7 33",
  // 집
  "M6 20 L20 6 L34 20 M10 17 V34 H30 V17 M17 34 V25 H23 V34",
];
const DOODLE_COLORS = ["#FF6B6B", "#FFC93C", "#2EC4B6", "#4EA8DE", "#9B5DE5", "#FF9F43"];

/** 배경에 흩어진 낙서 — pos: [x%, y%, 크기px, 회전deg] */
export function Doodles({
  items,
  className = "",
}: {
  items: [number, number, number, number][];
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden
    >
      {items.map(([x, y, s, r], i) => (
        <svg
          key={i}
          viewBox="0 0 40 40"
          className="sk-doodle absolute"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: s,
            height: s,
            rotate: `${r}deg`,
            animationDelay: `${(i * 0.37) % 3}s`,
          }}
        >
          <path
            d={DOODLES[i % DOODLES.length]}
            fill="none"
            stroke={DOODLE_COLORS[i % DOODLE_COLORS.length]}
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
          />
        </svg>
      ))}
    </div>
  );
}

// ───────────── 도구 아이콘 ─────────────

const ICONS = {
  pen: "M4 20 L5 15 L16 4 L20 8 L9 19 Z M14 6 L18 10",
  fill: "M5 11 L12 4 L19 11 L12 18 Z M5 11 H19 M20 15 C20 17 21 19 21 19 C21 19 22 17 22 15",
  eraser: "M3 17 L13 7 L19 13 L13 19 H7 Z M8 12 L14 18 M10 19 H21",
  undo: "M9 7 L4 12 L9 17 M4 12 H14 C18 12 20 14 20 17 C20 19 19 20 19 20",
  trash: "M5 7 H19 M9 7 V4 H15 V7 M7 7 L8 20 H16 L17 7 M10 10 V17 M14 10 V17",
  link: "M10 14 L14 10 M8 12 L6 14 C4 16 4 18 6 19.5 C7.5 21 9.5 21 11 19 L13 17 M16 12 L18 10 C20 8 20 6 18.5 4.5 C17 3 15 3 13 5 L11 7",
  sound:
    "M4 9 H8 L13 5 V19 L8 15 H4 Z M16 9 C17.5 10.5 17.5 13.5 16 15 M18.5 6.5 C21.5 9.5 21.5 14.5 18.5 17.5",
  mute: "M4 9 H8 L13 5 V19 L8 15 H4 Z M16 9 L21 15 M21 9 L16 15",
  full: "M4 9 V4 H9 M20 9 V4 H15 M4 15 V20 H9 M20 15 V20 H15",
  unfull: "M9 4 V9 H4 M15 4 V9 H20 M9 20 V15 H4 M15 20 V15 H20",
  back: "M15 5 L8 12 L15 19",
  close: "M6 6 L18 18 M18 6 L6 18",
  crown: "M4 18 L3 7 L8 11 L12 5 L16 11 L21 7 L20 18 Z",
  bolt: "M13 2 L5 13 H11 L10 22 L19 10 H13 Z",
  plus: "M12 5 V19 M5 12 H19",
  lock: "M7 11 V8 C7 5 9 3 12 3 C15 3 17 5 17 8 V11 M5 11 H19 V21 H5 Z",
  send: "M3 11 L21 3 L14 21 L11 13 Z M11 13 L21 3",
  help: "M9 9 C9 6 15 6 15 9 C15 12 12 11.5 12 15 M12 18.5 V19",
  user: "M12 12 C14.5 12 16 10 16 7.5 C16 5 14.5 3.5 12 3.5 C9.5 3.5 8 5 8 7.5 C8 10 9.5 12 12 12 Z M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21",
  refresh:
    "M20 11 C19 7 16 4 12 4 C7.5 4 4 7.5 4 12 C4 16.5 7.5 20 12 20 C15 20 17.5 18.5 19 16 M20 4 V11 H13",
  kick: "M6 6 L18 18 M18 6 L6 18",
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/** 이름 — 스케치 퀴즈는 대부분 비회원이라 GUEST 표시는 빼고, 회원만 꾸밈(배지)을 붙임 */
export function Who({ name }: { name: string }) {
  return isGuestName(name) ? <>{plainName(name)}</> : <Nick name={name} tone="paper" />;
}
