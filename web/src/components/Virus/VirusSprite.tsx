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
  parts = [],
}: {
  color: string;
  lv: { atk: number; spd: number; crit: number };
  /** 상위 보스를 처음 잡을 때마다 하나씩 붙는 외형 (그 보스 색, 0~10개) */
  parts?: string[];
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
      {/* ── 상위 보스 외형 (뒤쪽) ── */}
      {/* 10 Oracle: 오라 */}
      {parts[9] && (
        <>
          <circle cx={C} cy={C} r={57} fill={parts[9]} opacity={0.08} />
          <circle
            cx={C}
            cy={C}
            r={57}
            fill="none"
            stroke={parts[9]}
            strokeOpacity={0.5}
            strokeWidth={1}
            strokeDasharray="1 4"
          />
        </>
      )}
      {/* 8 Mimic: 날개 */}
      {parts[7] &&
        [1, -1].map((d) => (
          <path
            key={d}
            d={`M${C - d * (R - 2)} ${C - 6} C${C - d * (R + 14)} ${C - 30}, ${C - d * (R + 30)} ${C - 22}, ${C - d * (R + 26)} ${C + 2} C${C - d * (R + 20)} ${C - 2}, ${C - d * (R + 12)} ${C + 8}, ${C - d * (R - 2)} ${C + 6} Z`}
            fill={parts[7]}
            fillOpacity={0.35}
            stroke={parts[7]}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        ))}
      {/* 4 Hydra: 촉수 3개 */}
      {parts[3] &&
        [-9, 0, 9].map((dx, i) => (
          <path
            key={dx}
            d={`M${C + dx} ${C + R - 3} q${i - 1 ? 6 : -6} 9 0 16 t${i - 1 ? -2 : 2} 12`}
            fill="none"
            stroke={parts[3]}
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}
      {/* 3 Argus: 반투명 외피 */}
      {parts[2] && (
        <circle
          cx={C}
          cy={C}
          r={R + spikeLen + 2}
          fill={parts[2]}
          fillOpacity={0.07}
          stroke={parts[2]}
          strokeOpacity={0.45}
          strokeWidth={1.2}
        />
      )}
      {/* 7 Tracker: 잔상 */}
      {parts[6] &&
        [
          [-7, 4],
          [7, -4],
        ].map(([dx, dy]) => (
          <circle
            key={dx}
            cx={C + dx}
            cy={C + dy}
            r={R}
            fill="none"
            stroke={parts[6]}
            strokeOpacity={0.35}
            strokeWidth={2}
          />
        ))}
      {/* 9 Leviathan: 이중 궤도 링 */}
      {parts[8] &&
        [-28, 28].map((deg) => (
          <ellipse
            key={deg}
            cx={C}
            cy={C}
            rx={R + spikeLen + 12}
            ry={9}
            fill="none"
            stroke={parts[8]}
            strokeOpacity={0.7}
            strokeWidth={1.4}
            transform={`rotate(${deg} ${C} ${C})`}
          />
        ))}
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
      {/* ── 상위 보스 외형 (앞쪽) ── */}
      {/* 1 Sentinel: 회로 링 */}
      {parts[0] && (
        <g>
          <circle
            cx={C}
            cy={C}
            r={R + 5}
            fill="none"
            stroke={parts[0]}
            strokeWidth={1}
            strokeOpacity={0.8}
          />
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
            const x1 = r2(C + Math.cos(a) * (R + 5));
            const y1 = r2(C + Math.sin(a) * (R + 5));
            const x2 = r2(C + Math.cos(a) * (R + 11));
            const y2 = r2(C + Math.sin(a) * (R + 11));
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={parts[0]} strokeWidth={1} />
                <rect x={x2 - 1.5} y={y2 - 1.5} width={3} height={3} fill={parts[0]} />
              </g>
            );
          })}
        </g>
      )}
      {/* 5 Warden: 결정 가시 */}
      {parts[4] &&
        Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2 + Math.PI / 6;
          const x = r2(C + Math.cos(a) * (R + spikeLen * 0.6 + 3));
          const y = r2(C + Math.sin(a) * (R + spikeLen * 0.6 + 3));
          return (
            <polygon
              key={i}
              points={`${x},${y - 5} ${x + 3},${y} ${x},${y + 5} ${x - 3},${y}`}
              fill={parts[4]}
              stroke="#fff"
              strokeOpacity={0.6}
              strokeWidth={0.6}
              transform={`rotate(${r2((a * 180) / Math.PI + 90)} ${x} ${y})`}
            />
          );
        })}
      {/* 2 Bastion: 안테나 한 쌍 */}
      {parts[1] &&
        [1, -1].map((d) => (
          <g key={d}>
            <line
              x1={C + d * 7}
              y1={C - R + 3}
              x2={C + d * 19}
              y2={C - R - 15}
              stroke={parts[1]}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <circle cx={C + d * 19} cy={C - R - 15} r={3} fill={parts[1]} />
          </g>
        ))}
      {/* 6 SOC: 왕관 */}
      {parts[5] && (
        <polygon
          points={`${C - 11},${C - R + 2} ${C - 12},${C - R - 10} ${C - 6},${C - R - 4} ${C},${C - R - 14} ${C + 6},${C - R - 4} ${C + 12},${C - R - 10} ${C + 11},${C - R + 2}`}
          fill={parts[5]}
          stroke="#020604"
          strokeWidth={1}
          strokeLinejoin="round"
        />
      )}
      {/* 10 Oracle: 세 번째 눈 */}
      {parts[9] && <rect x={C - 2} y={C - 12} width={4} height={5} rx={1} fill={parts[9]} />}
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

/** 상위 보스 (보안 시스템): 방패 + 큰 감시 눈. index 로 위쪽 문장 · 양옆 날개 모양이 달라짐 */
export function ApexSprite({
  index,
  color,
  size = 160,
  hit = false,
}: {
  index: number;
  color: string;
  size?: number;
  hit?: boolean;
}) {
  const fins = index % 3;
  const emblem = (() => {
    const s = { stroke: color, strokeWidth: 2, fill: "none", strokeLinecap: "round" as const };
    switch (index) {
      case 0: // 십자 (백신)
        return <path d="M60 18v14M53 25h14" {...s} />;
      case 1: // 벽돌 (방화벽)
        return <path d="M50 20h20M50 26h20M50 32h20M57 20v6M63 26v6" {...s} strokeWidth={1.4} />;
      case 2: // 작은 눈 (탐지)
        return <ellipse cx={60} cy={26} rx={8} ry={4} {...s} />;
      case 3: // 뱀 (필터)
        return <path d="M52 20q8 0 8 6t8 6" {...s} />;
      case 4: // 사슬 (샌드박스)
        return (
          <>
            <ellipse cx={55} cy={26} rx={4} ry={3} {...s} />
            <ellipse cx={63} cy={26} rx={4} ry={3} {...s} />
          </>
        );
      case 5: // 기둥 (관제)
        return <path d="M51 32h18M53 32V22M60 32V22M67 32V22M50 21h20" {...s} strokeWidth={1.6} />;
      case 6: // 돋보기 (추적)
        return (
          <>
            <circle cx={58} cy={24} r={5} {...s} />
            <path d="M62 28l5 5" {...s} />
          </>
        );
      case 7: // 벌집 (허니팟)
        return <polygon points="60,18 66,22 66,29 60,33 54,29 54,22" {...s} />;
      case 8: // 물결 (패킷 검사)
        return <path d="M50 24q5-5 10 0t10 0M50 30q5-5 10 0t10 0" {...s} strokeWidth={1.6} />;
      case 10: // 방사능 (최종 보스)
        return (
          <>
            <circle cx={60} cy={25} r={2.5} fill={color} />
            <path d="M60 22a8 8 0 0 0-6.9 4M60 22a8 8 0 0 1 6.9 4M53.5 29.5a8 8 0 0 0 13 0" {...s} strokeWidth={3} />
          </>
        );
      default: // 별 (AI)
        return (
          <polygon
            points="60,17 62.5,23 69,23 64,27 66,33 60,29.5 54,33 56,27 51,23 57.5,23"
            {...s}
            strokeWidth={1.4}
          />
        );
    }
  })();
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className="virus-glitch overflow-visible"
      style={{ filter: hit ? "brightness(2)" : `drop-shadow(0 0 12px ${color}77)` }}
      aria-hidden
    >
      {/* 경고 고리 (두 겹, 거꾸로) */}
      <g
        className="vm-spin"
        style={{
          animationDuration: "10s",
          animationDirection: "reverse",
          transformOrigin: "60px 60px",
        }}
      >
        <circle
          cx={60}
          cy={60}
          r={57}
          fill="none"
          stroke="#ef4444"
          strokeOpacity={0.5}
          strokeWidth={2}
          strokeDasharray="14 6"
        />
      </g>
      <circle
        cx={60}
        cy={60}
        r={52}
        fill="none"
        stroke={color}
        strokeOpacity={0.3}
        strokeWidth={1}
      />
      {/* 날개 (보스마다 0~2쌍) */}
      {Array.from({ length: fins + 1 }, (_, k) =>
        [1, -1].map((d) => (
          <path
            key={`${k}${d}`}
            d={`M${60 + d * 34} ${40 + k * 16} l${d * 16} ${-6 + k * 4} l${-d * 4} 12 Z`}
            fill={color}
            fillOpacity={0.55}
            stroke={color}
            strokeWidth={1}
          />
        ))
      )}
      {/* 방패 */}
      <path
        d="M60 8 L100 22 L96 68 Q90 98 60 112 Q30 98 24 68 L20 22 Z"
        fill="#0b0f1a"
        stroke={color}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <path
        d="M60 16 L92 27 L89 66 Q84 90 60 103 Q36 90 31 66 L28 27 Z"
        fill="none"
        stroke={color}
        strokeOpacity={0.4}
        strokeWidth={1.2}
      />
      {emblem}
      {/* 큰 감시 눈 */}
      <ellipse cx={60} cy={62} rx={24} ry={14} fill="#020617" stroke={color} strokeWidth={2} />
      <circle cx={60} cy={62} r={9} fill={color} />
      <circle cx={60} cy={62} r={4} fill="#020617" />
      <circle cx={57} cy={59} r={1.8} fill="#fff" />
      <line x1={38} y1={62} x2={82} y2={62} stroke="#ef4444" strokeOpacity={0.6} strokeWidth={1} />
    </svg>
  );
}
