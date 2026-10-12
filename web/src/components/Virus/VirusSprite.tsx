import { useId } from "react";

// 바이러스·파일 그림 (SVG)
// 적 바이러스: 톱니 막 안에 seed로 정해지는 좌우 대칭 픽셀 무늬 — 종류마다 모양이 다름 · 내 바이러스: 업그레이드로 자람

/** 좌표를 소수 둘째 자리로 — 서버(Node)와 브라우저의 Math.cos · sin 끝자리가 달라 hydration 이 어긋나는 걸 막음 */
const r2 = (n: number) => Math.round(n * 100) / 100;

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

/** seed 문자열 → 0~1 난수 함수 (보스마다 같은 모양) */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1000) / 1000;
  };
}

/**
 * 적 바이러스 (보스 · 도감 · 모듈) — 내 바이러스(MyVirusSprite)와 같은 둥근 바이러스 꼴이지만 확실히 적으로 보이게:
 *   톱니 막(보스마다 모양 다름) · 굵은 갈고리 가시 · 붉은 화난 눈 · 안쪽은 어두운 빨강 · 거꾸로 도는 붉은 경고 고리
 *   가운데엔 보스마다 다른 좌우 대칭 픽셀 무늬 (그 바이러스의 "코드")
 */
export function VirusSprite({
  seed,
  color,
  size = 120,
  hit = false,
}: {
  seed: string;
  color: string;
  size?: number;
  /** 맞은 순간 하얗게 번쩍 */
  hit?: boolean;
}) {
  const C = 60;
  const rnd = seeded(`boss-${seed}`);
  const teeth = 7 + Math.floor(rnd() * 5); // 톱니 수 7~11
  const R = 33;
  const barbs = 5 + Math.floor(rnd() * 4); // 갈고리 가시 5~8
  const spin = 0.2 + rnd() * 0.6;
  // 톱니 막: 바깥 · 안쪽 반지름을 번갈아, 보스마다 조금씩 들쭉날쭉
  const membrane = Array.from({ length: teeth * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i / (teeth * 2)) * Math.PI * 2;
    const r = i % 2 ? R - 6 - rnd() * 2 : R + rnd() * 2;
    return `${r2(C + Math.cos(a) * r)},${r2(C + Math.sin(a) * r)}`;
  }).join(" ");
  const cell = 4.2;
  const px = pixels(seed);
  const ox = C - (GRID * cell) / 2;
  const oy = C - 6;
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className="virus-glitch overflow-visible"
      style={{ filter: hit ? "brightness(2)" : `drop-shadow(0 0 10px ${color}66)` }}
      aria-hidden
    >
      {/* 경고 고리 (내 바이러스와 반대로 돎) */}
      <g
        className="vm-spin"
        style={{
          animationDuration: "14s",
          animationDirection: "reverse",
          transformOrigin: `${C}px ${C}px`,
        }}
      >
        <circle
          cx={C}
          cy={C}
          r={54}
          fill="none"
          stroke="#ef4444"
          strokeOpacity={0.45}
          strokeWidth={2}
          strokeDasharray="10 6"
        />
      </g>
      {/* 갈고리 가시 */}
      {Array.from({ length: barbs }, (_, i) => {
        const a = spin + (i / barbs) * Math.PI * 2;
        const w = 0.2;
        const base1 = [C + Math.cos(a - w) * (R - 3), C + Math.sin(a - w) * (R - 3)];
        const base2 = [C + Math.cos(a + w) * (R - 3), C + Math.sin(a + w) * (R - 3)];
        const tip = [C + Math.cos(a + 0.12) * (R + 17), C + Math.sin(a + 0.12) * (R + 17)];
        const hook = [C + Math.cos(a + 0.3) * (R + 11), C + Math.sin(a + 0.3) * (R + 11)];
        const pts = [base1, tip, hook, base2].map(([x, y]) => `${r2(x)},${r2(y)}`).join(" ");
        return (
          <polygon
            key={i}
            points={pts}
            fill={color}
            stroke="#3f0d0d"
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
        );
      })}
      {/* 톱니 막 */}
      <polygon
        points={membrane}
        fill="#1a0709"
        stroke={color}
        strokeWidth={2.6}
        strokeLinejoin="round"
      />
      {/* 화난 눈 (안쪽이 아래로 기운 붉은 눈) */}
      <polygon
        points={`${C - 15},${C - 15} ${C - 4},${C - 11} ${C - 5},${C - 7} ${C - 14},${C - 9}`}
        fill="#f87171"
      />
      <polygon
        points={`${C + 15},${C - 15} ${C + 4},${C - 11} ${C + 5},${C - 7} ${C + 14},${C - 9}`}
        fill="#f87171"
      />
      {/* 그 바이러스의 코드 (픽셀 무늬) */}
      {px.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={r2(ox + x * cell)}
          y={r2(oy + y * cell)}
          width={cell - 0.8}
          height={cell - 0.8}
          rx={0.6}
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

/** 내 바이러스(me.exe) — 업그레이드할수록 생김새가 바뀜
 *   페이로드 → 가운데 핵이 커지고 밝아짐
 *   오버클럭 → 바깥을 도는 궤도 점이 늘고 빨리 돎
 *   익스플로잇 → 막 밖으로 가시가 돋고 길어짐
 *   진화 단계 → 막 모양 (원 → 육각 → 이중 육각 → 별) · 기운
 *   빼앗은 모듈 → 그 보스 색의 코드 조각이 몸 둘레에 붙음 */

export function MyVirusSprite({
  color,
  lv,
  stage,
  mods = [],
  aps = 1,
  size = 140,
  firing = false,
}: {
  color: string;
  lv: { atk: number; spd: number; crit: number };
  /** 진화 단계 (0~3) */
  stage: number;
  /** 모듈 10칸: 빼앗았으면 그 보스 색, 아니면 null */
  mods?: (string | null)[];
  /** 초당 발사 수 — 궤도 도는 빠르기 */
  aps?: number;
  size?: number;
  firing?: boolean;
}) {
  const C = 60;
  const core = 9 + Math.min(9, lv.atk / 12);
  const R = 22 + stage * 2 + Math.min(4, lv.atk / 40);
  const spikes = Math.min(20, 4 + Math.floor(lv.crit / 6));
  const spikeLen = 6 + Math.min(14, lv.crit / 6);
  const orbit = Math.min(6, 1 + Math.floor(lv.spd / 15));
  const spin = Math.max(1.2, 9 / Math.max(1, aps)); // 초
  const poly = (n: number, r: number, rot = 0, inner = 0) =>
    Array.from({ length: n * (inner ? 2 : 1) }, (_, i) => {
      const a = rot + (i / (n * (inner ? 2 : 1))) * Math.PI * 2;
      const rr = inner && i % 2 ? inner : r;
      return `${r2(C + Math.cos(a) * rr)},${r2(C + Math.sin(a) * rr)}`;
    }).join(" ");
  const membrane =
    stage === 0
      ? null
      : stage === 3
        ? poly(8, R + 3, -Math.PI / 2, R - 3)
        : poly(6, R, -Math.PI / 2);
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className="virus-glitch overflow-visible"
      style={{ filter: `drop-shadow(0 0 ${firing ? 14 : 8}px ${color}${firing ? "aa" : "55"})` }}
      aria-hidden
    >
      {/* 기운 (2단계부터) */}
      {stage >= 1 && (
        <circle cx={C} cy={C} r={R + spikeLen + 10} fill={color} opacity={0.05 + stage * 0.03} />
      )}
      {/* 오버클럭: 궤도 */}
      <g
        className="vm-spin"
        style={{ animationDuration: `${spin}s`, transformOrigin: `${C}px ${C}px` }}
      >
        <circle
          cx={C}
          cy={C}
          r={R + spikeLen + 6}
          fill="none"
          stroke={color}
          strokeOpacity={0.25}
          strokeDasharray="2 5"
        />
        {Array.from({ length: orbit }, (_, i) => {
          const a = (i / orbit) * Math.PI * 2;
          const r = R + spikeLen + 6;
          return (
            <rect
              key={i}
              x={r2(C + Math.cos(a) * r - 2.5)}
              y={r2(C + Math.sin(a) * r - 2.5)}
              width={5}
              height={5}
              fill={color}
            />
          );
        })}
      </g>
      {/* 익스플로잇: 가시 */}
      {Array.from({ length: spikes }, (_, i) => {
        const a = (i / spikes) * Math.PI * 2 + 0.2;
        const x1 = r2(C + Math.cos(a) * (R - 2));
        const y1 = r2(C + Math.sin(a) * (R - 2));
        const x2 = r2(C + Math.cos(a) * (R + spikeLen));
        const y2 = r2(C + Math.sin(a) * (R + spikeLen));
        return (
          <g key={i}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={2.2}
              strokeLinecap="round"
            />
            <rect
              x={x2 - 2}
              y={y2 - 2}
              width={4}
              height={4}
              fill="#fde68a"
              transform={`rotate(45 ${x2} ${y2})`}
            />
          </g>
        );
      })}
      {/* 막 */}
      {membrane ? (
        <polygon
          points={membrane}
          fill="#06120b"
          stroke={color}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      ) : (
        <circle cx={C} cy={C} r={R} fill="#06120b" stroke={color} strokeWidth={2.5} />
      )}
      {stage >= 2 && (
        <polygon
          points={poly(6, R - 6, 0)}
          fill="none"
          stroke={color}
          strokeOpacity={0.45}
          strokeWidth={1.2}
        />
      )}
      {/* 페이로드: 핵 */}
      <circle cx={C} cy={C} r={core} fill={color} opacity={firing ? 0.55 : 0.32} />
      <circle cx={C} cy={C} r={core * 0.55} fill={color} opacity={firing ? 0.9 : 0.6} />
      {/* 눈 */}
      <rect x={C - 7} y={C - 4} width={4} height={5} rx={1} fill="#ecfdf5" />
      <rect x={C + 3} y={C - 4} width={4} height={5} rx={1} fill="#ecfdf5" />
      {/* 빼앗은 모듈: 몸 둘레 코드 조각 */}
      {mods.map((m, i) => {
        if (!m) return null;
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = R + 1;
        return (
          <rect
            key={i}
            x={r2(C + Math.cos(a) * r - 3)}
            y={r2(C + Math.sin(a) * r - 3)}
            width={6}
            height={6}
            rx={1}
            fill={m}
            stroke="#020604"
            strokeWidth={1}
            transform={`rotate(45 ${r2(C + Math.cos(a) * r)} ${r2(C + Math.sin(a) * r)})`}
          />
        );
      })}
    </svg>
  );
}
