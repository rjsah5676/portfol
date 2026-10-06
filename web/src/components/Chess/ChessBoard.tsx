"use client";

import { useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import type { Color } from "@/firestore/chessGame";

const GLYPH: Record<string, string> = {
  k: "♚︎",
  q: "♛︎",
  r: "♜︎",
  b: "♝︎",
  n: "♞︎",
  p: "♟︎",
};
const FILES = "abcdefgh";

interface Props {
  fen: string;
  orientation: Color;
  /** 내 차례 + 대국중일 때만 true */
  canMove: boolean;
  lastMove?: string;
  /** 힌트로 보여 줄 수 (uci) */
  hint?: string | null;
  onMove: (uci: string) => void;
}

interface Drag {
  from: Square;
  x: number;
  y: number;
  moved: boolean;
}

export function Piece({
  type,
  color,
  className = "",
}: {
  type: string;
  color: Color;
  className?: string;
}) {
  return (
    <span
      className={`pointer-events-none leading-none select-none ${
        color === "w"
          ? "text-white [text-shadow:0_0_1px_#111,0_0_1px_#111,0_0_2px_#111,0_1px_2px_rgba(0,0,0,.6)]"
          : "text-[#16141d] [text-shadow:0_0_1px_rgba(255,255,255,.55),0_1px_2px_rgba(0,0,0,.4)]"
      } ${className}`}
    >
      {GLYPH[type]}
    </span>
  );
}

export default function ChessBoard({ fen, orientation, canMove, lastMove, hint, onMove }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const game = useMemo(() => new Chess(fen), [fen]);
  const board = useMemo(() => game.board(), [game]);
  const turn = game.turn();

  const [selected, setSelected] = useState<Square | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const deselectOnUp = useRef(false);

  // fen 바뀌면(상대가 둠/무르기) 선택 초기화
  const [prevFen, setPrevFen] = useState(fen);
  if (prevFen !== fen) {
    setPrevFen(fen);
    setSelected(null);
    setDrag(null);
    setPromo(null);
  }

  const targets = useMemo(() => {
    if (!selected || !canMove) return new Set<string>();
    return new Set(game.moves({ square: selected, verbose: true }).map((m) => m.to));
  }, [game, selected, canMove]);

  const pieceAt = (sq: Square) => {
    const f = FILES.indexOf(sq[0]);
    const r = 8 - Number(sq[1]);
    return board[r][f];
  };

  const squareFromPoint = (clientX: number, clientY: number): Square | null => {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    const f = orientation === "w" ? col : 7 - col;
    const r = orientation === "w" ? 8 - row : row + 1;
    return `${FILES[f]}${r}` as Square;
  };

  const tryMove = (from: Square, to: Square) => {
    const legal = game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (legal.length === 0) return false;
    if (legal.some((m) => m.promotion)) {
      setPromo({ from, to });
    } else {
      onMove(from + to);
      setSelected(null);
    }
    return true;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (promo || e.button > 0) return;
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    const p = pieceAt(sq);
    const mine = canMove && p && p.color === turn;

    if (selected && targets.has(sq)) {
      tryMove(selected, sq);
      return;
    }
    if (mine) {
      deselectOnUp.current = selected === sq;
      setSelected(sq);
      const rect = boardRef.current!.getBoundingClientRect();
      setDrag({ from: sq, x: e.clientX - rect.left, y: e.clientY - rect.top, moved: false });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const rect = boardRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const moved = drag.moved || Math.hypot(x - drag.x, y - drag.y) > 6;
    setDrag({ ...drag, x, y, moved });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (d.moved) {
      const to = squareFromPoint(e.clientX, e.clientY);
      if (to && to !== d.from) tryMove(d.from, to);
    } else if (deselectOnUp.current) {
      setSelected(null);
    }
    deselectOnUp.current = false;
  };

  const last = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [];
  const checkSq = game.inCheck()
    ? (() => {
        for (let r = 0; r < 8; r++)
          for (let f = 0; f < 8; f++) {
            const p = board[r][f];
            if (p && p.type === "k" && p.color === turn) return `${FILES[f]}${8 - r}`;
          }
        return null;
      })()
    : null;

  const rows = orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const cols = orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div
      ref={boardRef}
      className={`relative aspect-square w-full touch-none overflow-hidden rounded-lg shadow-[0_8px_30px_rgba(0,0,0,.45)] select-none [container-type:inline-size] ${
        drag?.moved ? "cursor-grabbing [&_*]:cursor-grabbing" : ""
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="grid h-full w-full grid-cols-8 grid-rows-8">
        {rows.map((r, ri) =>
          cols.map((f, ci) => {
            const sq = `${FILES[f]}${8 - r}`;
            const light = (r + f) % 2 === 0;
            const p = board[r][f];
            const isTarget = targets.has(sq);
            const hidden = drag?.moved && drag.from === sq;
            return (
              <div
                key={sq}
                className={`relative flex items-center justify-center ${light ? "bg-[#E9E6F7]" : "bg-[#8279C9]"} ${
                  canMove && p && p.color === turn
                    ? "cursor-grab"
                    : isTarget
                      ? "cursor-pointer"
                      : ""
                }`}
              >
                {last.includes(sq) && <div className="absolute inset-0 bg-[#F5D94A]/45" />}
                {selected === sq && <div className="absolute inset-0 bg-[#F5D94A]/65" />}
                {hint && (hint.slice(0, 2) === sq || hint.slice(2, 4) === sq) && (
                  <div
                    className={`pointer-events-none absolute inset-[3px] rounded-md border-[3px] border-[#10B981] ${
                      hint.slice(2, 4) === sq ? "bg-[#34D399]/40" : "bg-[#34D399]/15"
                    }`}
                  />
                )}
                {checkSq === sq && (
                  <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,40,40,.95)_0%,rgba(255,40,40,.5)_45%,transparent_75%)]" />
                )}
                {ci === 0 && (
                  <span
                    className={`absolute top-[2%] left-[4%] font-mono text-[2.4cqw] font-bold ${light ? "text-[#8279C9]" : "text-[#E9E6F7]"}`}
                  >
                    {8 - r}
                  </span>
                )}
                {ri === 7 && (
                  <span
                    className={`absolute right-[5%] bottom-[1%] font-mono text-[2.4cqw] font-bold ${light ? "text-[#8279C9]" : "text-[#E9E6F7]"}`}
                  >
                    {FILES[f]}
                  </span>
                )}
                {p && !hidden && (
                  <Piece type={p.type} color={p.color} className="relative text-[10.2cqw]" />
                )}
                {isTarget &&
                  (p ? (
                    <div className="absolute inset-0 rounded-full border-[0.9cqw] border-black/25" />
                  ) : (
                    <div className="absolute h-[28%] w-[28%] rounded-full bg-black/25" />
                  ))}
              </div>
            );
          })
        )}
      </div>

      {drag?.moved &&
        (() => {
          const p = pieceAt(drag.from);
          if (!p) return null;
          return (
            <div
              className="pointer-events-none absolute z-10 flex h-[12.5%] w-[12.5%] -translate-x-1/2 -translate-y-1/2 scale-110 items-center justify-center"
              style={{ left: drag.x, top: drag.y }}
            >
              <Piece type={p.type} color={p.color} className="text-[10.2cqw]" />
            </div>
          );
        })()}

      {promo && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/55"
          onPointerDown={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) setPromo(null);
          }}
        >
          <div className="flex gap-2 rounded-xl bg-[#1C1E24] p-3 shadow-xl">
            {(["q", "r", "b", "n"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  onMove(promo.from + promo.to + t);
                  setPromo(null);
                  setSelected(null);
                }}
                className="flex h-[14cqw] w-[14cqw] cursor-pointer items-center justify-center rounded-lg bg-[#E9E6F7] hover:bg-[#F5D94A]"
              >
                <Piece type={t} color={turn} className="text-[11cqw]" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
