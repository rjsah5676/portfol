"use client";

import { useMemo, useRef, useState } from "react";
import { BLACK, CENTER, FILES, Omok, WHITE, parseSq, sqName } from "@/lib/omok/engine";

const CELL = 40;
const M = 34;
const R = 17.5;
/** 화점: 15줄은 귀 4곳 + 천원, 19줄은 바둑판처럼 9곳 */
const starsOf = (n: number) => {
  const at = n === 19 ? [3, 9, 15] : [3, 11];
  const out: number[] = [];
  for (const y of at) for (const x of at) out.push(y * n + x);
  if (n !== 19) out.push(CENTER);
  return out;
};

/** 작은 돌 아이콘 (이름표·기보용) */
export function StoneDot({ white, size = 16 }: { white: boolean; size?: number }) {
  return (
    <svg viewBox="-10 -10 20 20" width={size} height={size} aria-hidden className="shrink-0">
      <circle
        r={8.5}
        fill={white ? "#F2F2EE" : "#1A1A1A"}
        stroke={white ? "#9a9a9a" : "#000"}
        strokeWidth={0.8}
      />
    </svg>
  );
}

export default function OmokBoard({
  fen,
  canMove,
  lastMove,
  onMove,
  winLine,
  hint,
  numbers,
}: {
  fen: string;
  canMove: boolean;
  lastMove?: string;
  onMove: (mv: string) => void;
  /** 5목 줄 (인덱스) */
  winLine?: number[];
  /** 힌트로 보여 줄 자리 ("h8") */
  hint?: string | null;
  /** 넘기면 돌 위에 수 번호 */
  numbers?: string[] | null;
}) {
  const game = useMemo(() => Omok.fromFen(fen), [fen]);
  // 판 줄 수 (15·19) — fen 칸 수로 앎
  const n = game.n;
  const BW = CELL * (n - 1) + M * 2;
  const pos = (i: number) => ({ x: M + (i % n) * CELL, y: M + Math.floor(i / n) * CELL });
  const STARS = starsOf(n);
  const forbid = useMemo(() => new Set(game.forbiddenPoints()), [game]);
  const firstCenter = game.rule === "renju" && game.ply === 0;
  const [hover, setHover] = useState<number | null>(null);
  // 터치는 한 번 눌러 고르고 같은 자리를 한 번 더 눌러야 착수 (잘못 누름 방지)
  const [picked, setPicked] = useState<number | null>(null);
  const touch = useRef(false);
  const [prevFen, setPrevFen] = useState(fen);
  if (fen !== prevFen) {
    setPrevFen(fen);
    setPicked(null);
  }
  const turnStone = game.ply % 2 === 0 ? BLACK : WHITE;
  const last = lastMove ? parseSq(lastMove) : -1;
  const hintSq = hint ? parseSq(hint) : -1;
  const win = new Set(winLine ?? []);
  const numberOf = useMemo(() => {
    const m = new Map<number, number>();
    numbers?.forEach((mv, k) => m.set(parseSq(mv), k + 1));
    return m;
  }, [numbers]);

  const playable = (i: number) =>
    canMove && game.bd[i] === 0 && !forbid.has(i) && (!firstCenter || i === CENTER);

  const pointAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * BW;
    const sy = ((e.clientY - r.top) / r.height) * BW;
    const x = Math.round((sx - M) / CELL);
    const y = Math.round((sy - M) / CELL);
    if (x < 0 || y < 0 || x >= n || y >= n) return -1;
    return y * n + x;
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    touch.current = e.pointerType !== "mouse";
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const i = pointAt(e);
    if (i < 0 || !playable(i)) {
      setPicked(null);
      return;
    }
    if (touch.current && picked !== i) {
      setPicked(i);
      return;
    }
    setPicked(null);
    setHover(null);
    onMove(sqName(i));
  };
  const onHover = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse") return;
    const i = pointAt(e);
    setHover(i >= 0 && playable(i) ? i : null);
  };

  const ghost = picked ?? hover;

  return (
    <svg
      viewBox={`0 0 ${BW} ${BW}`}
      className={`block h-auto w-full touch-manipulation rounded-lg select-none ${canMove ? "cursor-pointer" : ""}`}
      role="img"
      aria-label="오목판"
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerMove={onHover}
      onPointerLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id="om-wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E9C88A" />
          <stop offset="1" stopColor="#D8AE68" />
        </linearGradient>
        <radialGradient id="om-b" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#6b6b6b" />
          <stop offset="0.45" stopColor="#262626" />
          <stop offset="1" stopColor="#050505" />
        </radialGradient>
        <radialGradient id="om-w" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#f1f1ee" />
          <stop offset="1" stopColor="#c9c9c4" />
        </radialGradient>
      </defs>
      <rect width={BW} height={BW} fill="url(#om-wood)" />
      {/* 줄 */}
      {Array.from({ length: n }, (_, k) => (
        <g key={k} stroke="#5C3F1E" strokeWidth={k === 0 || k === n - 1 ? 2 : 1.1}>
          <line x1={M} y1={M + k * CELL} x2={M + (n - 1) * CELL} y2={M + k * CELL} />
          <line x1={M + k * CELL} y1={M} x2={M + k * CELL} y2={M + (n - 1) * CELL} />
        </g>
      ))}
      {/* 좌표 */}
      {Array.from({ length: n }, (_, k) => (
        <g
          key={`c${k}`}
          fill="#5C3F1E"
          fontSize={11}
          fontFamily="ui-monospace,monospace"
          opacity={0.7}
        >
          <text x={M + k * CELL} y={BW - 9} textAnchor="middle">
            {FILES[k].toUpperCase()}
          </text>
          <text x={12} y={M + k * CELL} dominantBaseline="central" textAnchor="middle">
            {n - k}
          </text>
        </g>
      ))}
      {STARS.map((i) => {
        const { x, y } = pos(i);
        return <circle key={i} cx={x} cy={y} r={4} fill="#5C3F1E" />;
      })}
      {firstCenter && canMove && (
        <circle
          cx={pos(CENTER).x}
          cy={pos(CENTER).y}
          r={R}
          fill="none"
          stroke="#6C63FF"
          strokeWidth={3}
          strokeDasharray="6 4"
          className="animate-pulse"
        />
      )}
      {/* 금수 */}
      {[...forbid].map((i) => {
        const { x, y } = pos(i);
        return (
          <g key={`f${i}`} stroke="#DC2626" strokeWidth={3} strokeLinecap="round" opacity={0.8}>
            <line x1={x - 7} y1={y - 7} x2={x + 7} y2={y + 7} />
            <line x1={x + 7} y1={y - 7} x2={x - 7} y2={y + 7} />
          </g>
        );
      })}
      {/* 돌 */}
      {Array.from(game.bd).map((v, i) => {
        if (!v) return null;
        const { x, y } = pos(i);
        const white = v === WHITE;
        const no = numberOf.get(i);
        return (
          <g key={i}>
            <circle cx={x + 1.2} cy={y + 2} r={R} fill="#00000040" />
            <circle
              cx={x}
              cy={y}
              r={R}
              fill={white ? "url(#om-w)" : "url(#om-b)"}
              stroke={win.has(i) ? "#F43F5E" : white ? "#a8a8a2" : "#000"}
              strokeWidth={win.has(i) ? 3.5 : 0.8}
            />
            {no ? (
              <text
                x={x}
                y={y + 0.5}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={no >= 100 ? 11 : 13}
                fontWeight={700}
                fontFamily="ui-monospace,monospace"
                fill={i === last ? "#EF4444" : white ? "#222" : "#eee"}
              >
                {no}
              </text>
            ) : (
              i === last && <circle cx={x} cy={y} r={4.5} fill="#EF4444" />
            )}
          </g>
        );
      })}
      {/* 5목 줄 */}
      {winLine &&
        winLine.length >= 5 &&
        (() => {
          const xs = winLine.map(pos);
          const a = xs.reduce((p, q) => (q.x + q.y * 0.001 < p.x + p.y * 0.001 ? q : p));
          const b = xs.reduce((p, q) => (q.x + q.y * 0.001 > p.x + p.y * 0.001 ? q : p));
          return (
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#F43F5E"
              strokeWidth={5}
              strokeLinecap="round"
              opacity={0.75}
              pointerEvents="none"
            />
          );
        })()}
      {/* 힌트 */}
      {hintSq >= 0 && game.bd[hintSq] === 0 && (
        <circle
          cx={pos(hintSq).x}
          cy={pos(hintSq).y}
          r={R}
          fill="#34D39944"
          stroke="#34D399"
          strokeWidth={3.5}
          strokeDasharray="7 5"
          className="animate-pulse"
          pointerEvents="none"
        />
      )}
      {/* 놓을 자리 미리보기 */}
      {ghost !== null && game.bd[ghost] === 0 && (
        <g pointerEvents="none">
          <circle
            cx={pos(ghost).x}
            cy={pos(ghost).y}
            r={R}
            fill={turnStone === WHITE ? "url(#om-w)" : "url(#om-b)"}
            opacity={picked !== null ? 0.75 : 0.45}
          />
          {picked !== null && (
            <circle
              cx={pos(ghost).x}
              cy={pos(ghost).y}
              r={R + 4}
              fill="none"
              stroke="#6C63FF"
              strokeWidth={3}
            />
          )}
        </g>
      )}
    </svg>
  );
}
