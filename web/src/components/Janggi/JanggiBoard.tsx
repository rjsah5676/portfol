"use client";

import { useMemo, useState } from "react";
import { Janggi, K, A, E, H, R, C, P, FILES, parseSq, type Color } from "@/lib/janggi/engine";

const GAP = 60;
const M = 40;
const BW = GAP * 8 + M * 2;
const BH = GAP * 9 + M * 2;

const HANJA: Record<Color, Record<number, string>> = {
  w: { [K]: "楚", [A]: "士", [E]: "象", [H]: "馬", [R]: "車", [C]: "包", [P]: "卒" },
  b: { [K]: "漢", [A]: "士", [E]: "象", [H]: "馬", [R]: "車", [C]: "包", [P]: "兵" },
};
const HANGUL: Record<Color, Record<number, string>> = {
  w: { [K]: "초", [A]: "사", [E]: "상", [H]: "마", [R]: "차", [C]: "포", [P]: "졸" },
  b: { [K]: "한", [A]: "사", [E]: "상", [H]: "마", [R]: "차", [C]: "포", [P]: "병" },
};
const SIZE: Record<number, number> = {
  [K]: 27,
  [A]: 18,
  [P]: 18,
  [E]: 22,
  [H]: 22,
  [R]: 23,
  [C]: 22,
};
export const SIDE_COLOR: Record<Color, string> = { w: "#1F5FB8", b: "#C8262E" };

/** 팔각형 꼭짓점 */
function octagon(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

export function PieceGlyph({
  type,
  color,
  size = 28,
  hangul = false,
}: {
  type: number;
  color: Color;
  size?: number;
  hangul?: boolean;
}) {
  const r = SIZE[type];
  return (
    <svg viewBox="-30 -30 60 60" width={size} height={size} aria-hidden>
      <polygon
        points={octagon(0, 0, r)}
        fill="#FBF3DF"
        stroke={SIDE_COLOR[color]}
        strokeWidth={2}
      />
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={r * 1.05}
        fontWeight={700}
        fill={SIDE_COLOR[color]}
        fontFamily="'Noto Serif KR','Nanum Myeongjo',serif"
      >
        {(hangul ? HANGUL : HANJA)[color][type]}
      </text>
    </svg>
  );
}

export default function JanggiBoard({
  fen,
  orientation,
  canMove,
  lastMove,
  onMove,
  hangul = false,
  banned,
  hint,
}: {
  fen: string;
  /** 아래쪽에 올 진영 */
  orientation: Color;
  canMove: boolean;
  lastMove?: string;
  onMove: (mv: string) => void;
  hangul?: boolean;
  /** 반복수라 못 두는 수 (판만으로는 기보를 몰라서 밖에서 받음) */
  banned?: string[];
  /** 힌트로 보여 줄 수 ("e8e7") */
  hint?: string | null;
}) {
  const game = useMemo(() => Janggi.fromFen(fen), [fen]);
  const board = useMemo(() => game.board(), [game]);
  const turn = game.turn();
  const [selected, setSelected] = useState<string | null>(null);
  // 판이 바뀌면 선택 해제
  const [prevFen, setPrevFen] = useState(fen);
  if (fen !== prevFen) {
    setPrevFen(fen);
    setSelected(null);
  }
  const targets = useMemo(
    () =>
      selected && canMove
        ? new Set(game.targetsFrom(selected).filter((t) => !banned?.includes(selected + t)))
        : new Set<string>(),
    [selected, canMove, game, banned]
  );

  const flip = orientation === "b";
  // 판 좌표(열 f, 줄 r) → 화면 좌표
  const pos = (f: number, r: number) => ({
    x: M + (flip ? 8 - f : f) * GAP,
    y: M + (flip ? 9 - r : r) * GAP,
  });
  const name = (f: number, r: number) => `${FILES[f]}${r}`;
  const checkSq = game.inCheck()
    ? board.flat().findIndex((p) => p?.type === K && p.color === turn)
    : -1;
  const last = lastMove && lastMove !== "pass" ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [];

  const click = (f: number, r: number) => {
    if (!canMove) return;
    const n = name(f, r);
    const p = board[r][f];
    if (selected && targets.has(n)) {
      onMove(selected + n);
      setSelected(null);
      return;
    }
    if (p && p.color === turn) setSelected(selected === n ? null : n);
    else setSelected(null);
  };

  const line = (f1: number, r1: number, f2: number, r2: number, key: string, w = 1.6) => {
    const a = pos(f1, r1),
      b = pos(f2, r2);
    return <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#6B4A2B" strokeWidth={w} />;
  };

  return (
    <svg
      viewBox={`0 0 ${BW} ${BH}`}
      className="block h-auto w-full touch-manipulation rounded-lg select-none"
      role="img"
      aria-label="장기판"
    >
      <defs>
        <linearGradient id="jg-wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F0D49B" />
          <stop offset="1" stopColor="#E2BE7E" />
        </linearGradient>
      </defs>
      <rect width={BW} height={BH} fill="url(#jg-wood)" />
      {/* 줄 */}
      {Array.from({ length: 10 }, (_, r) =>
        line(0, r, 8, r, `h${r}`, r === 0 || r === 9 ? 2.4 : 1.6)
      )}
      {Array.from({ length: 9 }, (_, f) =>
        line(f, 0, f, 9, `v${f}`, f === 0 || f === 8 ? 2.4 : 1.6)
      )}
      {/* 궁성 대각선 */}
      {line(3, 0, 5, 2, "p1")}
      {line(5, 0, 3, 2, "p2")}
      {line(3, 7, 5, 9, "p3")}
      {line(5, 7, 3, 9, "p4")}
      {/* 마지막 수 */}
      {last.map((n, i) => {
        const s = parseSq(n);
        const { x, y } = pos(s % 9, Math.floor(s / 9));
        return (
          <circle
            key={`l${i}`}
            cx={x}
            cy={y}
            r={i ? 26 : 9}
            fill={i ? "none" : "#6C63FF55"}
            stroke="#6C63FF"
            strokeWidth={i ? 3 : 0}
          />
        );
      })}
      {/* 기물 */}
      {board.map((row, r) =>
        row.map((p, f) => {
          const { x, y } = pos(f, r);
          const n = name(f, r);
          const sel = selected === n;
          const isTarget = targets.has(n);
          const idx = r * 9 + f;
          return (
            <g key={n} onClick={() => click(f, r)} className={canMove ? "cursor-pointer" : ""}>
              <rect x={x - GAP / 2} y={y - GAP / 2} width={GAP} height={GAP} fill="transparent" />
              {p && (
                <g>
                  {idx === checkSq && (
                    <circle cx={x} cy={y} r={SIZE[p.type] + 8} fill="#EF444466" />
                  )}
                  <polygon points={octagon(x, y + 2, SIZE[p.type])} fill="#00000033" />
                  <polygon
                    points={octagon(x, y, SIZE[p.type])}
                    fill={sel ? "#FFF7C2" : "#FBF3DF"}
                    stroke={SIDE_COLOR[p.color]}
                    strokeWidth={sel ? 3.5 : 2.2}
                  />
                  <text
                    x={x}
                    y={y + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={SIZE[p.type] * 1.05}
                    fontWeight={700}
                    fill={SIDE_COLOR[p.color]}
                    fontFamily="'Noto Serif KR','Nanum Myeongjo',serif"
                    pointerEvents="none"
                  >
                    {(hangul ? HANGUL : HANJA)[p.color][p.type]}
                  </text>
                </g>
              )}
              {isTarget &&
                (p ? (
                  <circle
                    cx={x}
                    cy={y}
                    r={SIZE[p.type] + 4}
                    fill="none"
                    stroke="#22C55E"
                    strokeWidth={3.5}
                    pointerEvents="none"
                  />
                ) : (
                  <circle cx={x} cy={y} r={9} fill="#22C55E" opacity={0.85} pointerEvents="none" />
                ))}
            </g>
          );
        })
      )}
      {/* 힌트 */}
      {hint &&
        hint !== "pass" &&
        (() => {
          const a = parseSq(hint.slice(0, 2));
          const b = parseSq(hint.slice(2, 4));
          const p1 = pos(a % 9, Math.floor(a / 9));
          const p2 = pos(b % 9, Math.floor(b / 9));
          return (
            <g pointerEvents="none" className="janggi-hint">
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="#34D399"
                strokeWidth={7}
                strokeLinecap="round"
                opacity={0.55}
              />
              <circle cx={p1.x} cy={p1.y} r={29} fill="none" stroke="#34D399" strokeWidth={4} />
              <circle
                cx={p2.x}
                cy={p2.y}
                r={29}
                fill="#34D39933"
                stroke="#34D399"
                strokeWidth={4}
                strokeDasharray="7 5"
              />
            </g>
          );
        })()}
    </svg>
  );
}
