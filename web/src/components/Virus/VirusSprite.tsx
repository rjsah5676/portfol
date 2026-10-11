import { useId } from "react";

// 바이러스·파일 그림 (SVG)
// 바이러스: 프로그램 창 안에 seed로 정해지는 좌우 대칭 픽셀 무늬 — 종류마다 모양이 다름

const GRID = 7;

/** seed 문자열 → 좌우 대칭 7x7 픽셀 (켜진 칸 목록) */
function pixels(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1000) / 1000;
  };
  const on: [number, number][] = [];
  const half = Math.ceil(GRID / 2);
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < half; x++)
      if (rand() < 0.5) {
        on.push([x, y]);
        if (x !== GRID - 1 - x) on.push([GRID - 1 - x, y]);
      }
  return on;
}

export function VirusSprite({
  seed,
  color,
  size = 120,
  hit = false,
  title,
}: {
  seed: string;
  color: string;
  size?: number;
  /** 맞은 순간 하얗게 번쩍 */
  hit?: boolean;
  /** 창 제목줄 글자 (작은 그림에서는 생략) */
  title?: string;
}) {
  const cell = 8.5;
  const ox = 50 - (GRID * cell) / 2;
  const oy = 27;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="virus-glitch overflow-visible"
      style={{ filter: hit ? "brightness(2)" : `drop-shadow(0 0 10px ${color}55)` }}
      aria-hidden
    >
      <rect
        x={6}
        y={8}
        width={88}
        height={84}
        rx={7}
        fill="#0a0f0c"
        stroke={color}
        strokeWidth={2.5}
      />
      <rect x={6} y={8} width={88} height={14} rx={7} fill={`${color}33`} />
      <circle cx={14} cy={15} r={2.2} fill="#f87171" />
      <circle cx={21} cy={15} r={2.2} fill="#fbbf24" />
      <circle cx={28} cy={15} r={2.2} fill="#4ade80" />
      {title && (
        <text x={88} y={18} textAnchor="end" fontSize={7} fontFamily="monospace" fill={color}>
          {title}
        </text>
      )}
      {pixels(seed).map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={ox + x * cell}
          y={oy + y * cell}
          width={cell - 1}
          height={cell - 1}
          rx={1}
          fill={color}
        />
      ))}
    </svg>
  );
}

/** 감염 대상 파일 (일반 적) */
export function FileSprite({
  ext,
  color,
  size = 110,
  hit = false,
  infected = 0,
}: {
  ext: string;
  color: string;
  size?: number;
  hit?: boolean;
  /** 감염된 정도 0~1 — 아래부터 초록으로 물듦 */
  infected?: number;
}) {
  const clip = useId();
  const top = 12 + 76 * (1 - infected);
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="overflow-visible"
      style={{ filter: hit ? "brightness(1.8)" : `drop-shadow(0 0 8px ${color}44)` }}
      aria-hidden
    >
      <defs>
        <clipPath id={clip}>
          <path d="M22 12 H62 L80 30 V88 H22 Z" />
        </clipPath>
      </defs>
      <path d="M22 12 H62 L80 30 V88 H22 Z" fill={`${color}1a`} />
      <rect x={0} y={top} width={100} height={100} fill="#4ade8040" clipPath={`url(#${clip})`} />
      <path
        d="M22 12 H62 L80 30 V88 H22 Z"
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <path
        d="M62 12 V30 H80"
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {[40, 48, 56].map((y) => (
        <line
          key={y}
          x1={30}
          y1={y}
          x2={y === 56 ? 56 : 70}
          y2={y}
          stroke={`${color}88`}
          strokeWidth={2}
        />
      ))}
      <rect x={30} y={64} width={42} height={16} rx={3} fill={color} />
      <text
        x={51}
        y={76}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fontFamily="monospace"
        fill="#0a0f0c"
      >
        .{ext}
      </text>
    </svg>
  );
}

/** 나 (해커): 후드를 쓴 사람이 노트북으로 바이러스 코드를 쏘아 보냄 */
export function HackerSprite({
  color,
  size = 140,
  firing = false,
}: {
  /** 눈·노트북 빛 색 (마지막으로 빼앗은 모듈 색) */
  color: string;
  size?: number;
  /** 발사한 순간 노트북이 번쩍 */
  firing?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="overflow-visible"
      style={{ filter: `drop-shadow(0 0 10px ${color}40)` }}
      aria-hidden
    >
      {/* 몸 (후드티) */}
      <path
        d="M14 98 C14 74 22 60 40 56 L52 56 C66 60 72 70 74 82 L76 98 Z"
        fill="#1f2a24"
        stroke="#3a4a40"
        strokeWidth={1.5}
      />
      {/* 후드 */}
      <path
        d="M24 46 C22 22 34 12 46 12 C60 12 70 24 67 46 C66 54 60 60 46 60 C32 60 25 54 24 46 Z"
        fill="#26332c"
        stroke="#3a4a40"
        strokeWidth={1.5}
      />
      {/* 얼굴 그림자 · 빛나는 눈 */}
      <ellipse cx={48} cy={40} rx={13} ry={14} fill="#050806" />
      <rect x={42} y={37} width={4} height={2.4} rx={1} fill={color} />
      <rect x={52} y={37} width={4} height={2.4} rx={1} fill={color} />
      {/* 팔 */}
      <path
        d="M56 64 C64 68 70 72 76 74"
        stroke="#26332c"
        strokeWidth={7}
        strokeLinecap="round"
        fill="none"
      />
      {/* 노트북 (뒷면이 보임) */}
      <path d="M66 78 L98 78 L96 82 L64 82 Z" fill="#475569" />
      <path
        d="M72 78 L80 52 L102 52 L96 78 Z"
        fill="#334155"
        stroke={color}
        strokeWidth={firing ? 2.5 : 1.5}
        style={{ filter: firing ? `drop-shadow(0 0 6px ${color})` : undefined }}
      />
      <text x={87} y={69} textAnchor="middle" fontSize={8} fontFamily="monospace" fill={color}>
        {"</>"}
      </text>
    </svg>
  );
}
