/**
 * 랭크전 등급 문장 — 그림 파일(public/fight/tier/<id>.webp)이 있으면 그걸, 없으면 등급 색 방패를 코드로 그림.
 * 배치 중이면 회색 "?" 방패.
 */
import { TIER_ICONS, rankTierOf, type TierInfo } from "@/lib/fight/tiers";

const ROMAN = ["III", "II", "I"];

export function TierEmblem({ info, size = 40, className = "" }: { info: TierInfo; size?: number; className?: string }) {
  const { tier, div, placing } = info;
  if (TIER_ICONS)
    return (
      <img
        src={`/fight/tier/${placing ? "placement" : tier.id}.webp`}
        alt={info.label}
        width={size}
        height={size}
        className={`shrink-0 object-contain [image-rendering:pixelated] ${className}`}
      />
    );
  const c = placing ? "#7B8494" : tier.color;
  const gid = `tg-${placing ? "p" : tier.id}`;
  const top = placing ? "?" : div >= 0 ? ROMAN[div] : tier.name[0];
  // 등급이 오를수록 테두리 장식이 늘어남 (날개·별)
  const rank = placing ? -1 : ["bronze", "silver", "gold", "platinum", "diamond", "master", "grandmaster", "legend"].indexOf(tier.id);
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={`shrink-0 ${className}`} aria-label={placing ? "배치 중" : info.label}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c} />
          <stop offset="1" stopColor={c} stopOpacity={0.55} />
        </linearGradient>
      </defs>
      {rank >= 5 && (
        <g fill={c} opacity={0.75}>
          <path d="M8 14 L1 9 L4 20 L9 22 Z" />
          <path d="M40 14 L47 9 L44 20 L39 22 Z" />
        </g>
      )}
      <path d="M24 3 L41 10 L39 30 L24 45 L9 30 L7 10 Z" fill="#14161C" stroke={c} strokeWidth={2.4} strokeLinejoin="round" />
      <path d="M24 8 L36 13 L34.5 28.5 L24 39.5 L13.5 28.5 L12 13 Z" fill={`url(#${gid})`} opacity={0.9} />
      {rank >= 7 && <path d="M24 0.5 L26 5 L22 5 Z" fill={c} />}
      <text
        x={24}
        y={25}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={top.length > 2 ? 10 : 13}
        fontWeight={900}
        fill="#14161C"
        style={{ fontFamily: "ui-monospace, monospace" }}
      >
        {top}
      </text>
    </svg>
  );
}

/** 문장 + "골드 II" (+ 점수) 한 줄 */
export default function TierBadge({
  r,
  n,
  size = 22,
  showR = false,
  className = "",
}: {
  r: number;
  n: number;
  size?: number;
  showR?: boolean;
  className?: string;
}) {
  const info = rankTierOf(r, n);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <TierEmblem info={info} size={size} />
      <span className="font-bold" style={{ color: info.placing ? "#9AA3B2" : info.tier.color }}>
        {info.placing ? `배치 ${n}/10` : info.label}
      </span>
      {showR && <span className="font-mono text-white/70 tabular-nums">{r}</span>}
    </span>
  );
}
