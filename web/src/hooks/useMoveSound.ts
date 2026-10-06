import { useEffect, useRef } from "react";
import { Chess } from "chess.js";
import { Janggi, parseSq } from "@/lib/janggi/engine";
import { Omok, parseSq as omokSq, makesFourAt } from "@/lib/omok/engine";
import { playPiece, preloadPieceSounds, type PieceSound } from "@/lib/sfx";

/** 방금 둔 수가 어떤 수였나 (둔 뒤의 판 기준) */
export interface MoveSoundInfo {
  pieces: number;
  check: boolean;
  mine: boolean;
  castle?: boolean;
  promote?: boolean;
  pass?: boolean;
}

/**
 * 수가 하나 늘 때마다 착수음 — 체크 > 승진 > 캐슬링 > 잡기 > 내 수/상대 수 순으로 하나만.
 * ply < 0 = 아직 로딩 전. 여러 수가 한꺼번에 늘거나(첫 로딩) 줄면(무르기) 소리 없이 기준만 맞춤.
 * set = 소리 세트 폴더 (체스는 "chess", 없으면 기본 세트)
 */
export function useMoveSound(ply: number, info: MoveSoundInfo, set?: string) {
  const prev = useRef({ ply, pieces: info.pieces });
  // 첫 터치/클릭 때 소리 파일 미리 받기 (오디오는 사용자 입력 뒤에만 켜짐)
  useEffect(() => {
    const go = () => preloadPieceSounds(set);
    window.addEventListener("pointerdown", go, { once: true });
    return () => window.removeEventListener("pointerdown", go);
  }, [set]);
  useEffect(() => {
    const p = prev.current;
    if (p.ply >= 0 && ply === p.ply + 1) {
      const name: PieceSound = info.pass
        ? "premove"
        : info.check
          ? "check"
          : info.promote
            ? "promote"
            : info.castle
              ? "castle"
              : info.pieces < p.pieces
                ? "capture"
                : info.mine
                  ? "move-self"
                  : "move-opponent";
      playPiece(name, 1, set);
    }
    prev.current = { ply, pieces: info.pieces };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 수가 바뀔 때만
  }, [ply]);
}

/** 체스: 둔 뒤 FEN + 마지막 수(uci) + 내 색 (관전자는 백 기준) */
export function chessSoundInfo(fen: string, last: string | undefined, me: "w" | "b" | null) {
  try {
    const g = new Chess(fen);
    const pieces = (fen.split(" ")[0].match(/[a-z]/gi) ?? []).length;
    if (!last) return { pieces, check: false, mine: false };
    const piece = g.get(last.slice(2, 4) as Parameters<Chess["get"]>[0]);
    const files = Math.abs(last.charCodeAt(0) - last.charCodeAt(2));
    return {
      pieces,
      check: g.inCheck(),
      mine: piece ? piece.color === (me ?? "w") : false,
      castle: piece?.type === "k" && files === 2,
      promote: last.length === 5,
    };
  } catch {
    return { pieces: 0, check: false, mine: false };
  }
}

/** 장기: 둔 뒤 fen() + 마지막 수 + 내 진영 (관전자는 초 기준) */
export function janggiSoundInfo(fen: string, last: string | undefined, me: "w" | "b" | null) {
  const pieces = fen
    .split(" ")[0]
    .split(",")
    .filter((v) => v && v !== "0").length;
  if (!last) return { pieces, check: false, mine: false };
  if (last === "pass") return { pieces, check: false, mine: false, pass: true };
  try {
    const g = Janggi.fromFen(fen);
    const p = g.bd[parseSq(last.slice(2, 4))];
    return { pieces, check: g.inCheck(), mine: p !== 0 && (p > 0 ? "w" : "b") === (me ?? "w") };
  } catch {
    return { pieces, check: false, mine: false };
  }
}

/** 오목: 둔 뒤 fen() + 마지막 수 + 내 돌 (관전자는 흑 기준). 잡기가 없어서 돌 수만 늘어남, 4를 만들면 체크 소리 */
export function omokSoundInfo(fen: string, last: string | undefined, me: "w" | "b" | null) {
  const cells = fen.split(" ")[1] ?? "";
  const pieces = cells.replace(/\./g, "").length;
  if (!last) return { pieces, check: false, mine: false };
  const g = Omok.fromFen(fen);
  const i = omokSq(last);
  const v = g.bd[i];
  if (!v) return { pieces, check: false, mine: false };
  // 4(다음 수에 5목)가 생기면 체크 소리
  return {
    pieces,
    check: makesFourAt(g.bd, i, g.rule),
    mine: (v === 1 ? "w" : "b") === (me ?? "w"),
  };
}
