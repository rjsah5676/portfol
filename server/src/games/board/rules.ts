import { Chess } from "chess.js";
// 장기·오목 엔진은 프론트와 같은 파일을 그대로 씀 (화면과 서버 판정이 어긋나지 않게)
import { Janggi, SETUPS, type Setup } from "../../../../web/src/lib/janggi/engine";
import { Omok, isRule, type BoardN, type Rule } from "../../../../web/src/lib/omok/engine";
import { other, winFor, type Color, type GameResult, type GameRules } from "./core";

// ───────────── 체스 ─────────────

const uciToMove = (uci: string) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });

/** 시간패 시 상대가 체크메이트 할 기물이 아예 없으면 무승부 (킹 단독 / 킹+마이너 1개) */
function cannotMate(game: Chess, color: Color): boolean {
  const pieces = game
    .board()
    .flat()
    .filter((p) => p && p.color === color && p.type !== "k");
  if (pieces.length === 0) return true;
  return pieces.length === 1 && (pieces[0]!.type === "n" || pieces[0]!.type === "b");
}

function chessEnd(game: Chess): { result: GameResult; reason: string } | null {
  if (game.isCheckmate()) return { result: game.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
  if (game.isStalemate()) return { result: "1/2-1/2", reason: "stalemate" };
  if (game.isInsufficientMaterial()) return { result: "1/2-1/2", reason: "insufficient" };
  if (game.isThreefoldRepetition()) return { result: "1/2-1/2", reason: "threefold" };
  if (game.isDrawByFiftyMoves()) return { result: "1/2-1/2", reason: "fifty" };
  return null;
}

export const chessRules: GameRules<Chess> = {
  collection: "chess_rooms",
  initialFen: () => new Chess().fen(),
  replay: (moves) => {
    const game = new Chess();
    for (const m of moves) game.move(uciToMove(m));
    return game;
  },
  fenOf: (g) => g.fen(),
  play: (g, uci) => {
    g.move(uciToMove(uci));
  },
  endState: chessEnd,
  timeoutResult: (g, loser) => (cannotMate(g, other(loser)) ? "1/2-1/2" : winFor(other(loser))),
};

// ───────────── 장기 (white = 초(선), black = 한. variant = "초상차림/한상차림") ─────────────

const isSetup = (v: string): v is Setup => SETUPS.some((s) => s.v === v);
function parseSetups(variant: string): { w: Setup; b: Setup } {
  const [w, b] = variant.split("/");
  return { w: isSetup(w) ? w : "heeh", b: isSetup(b) ? b : "heeh" };
}

export const janggiRules: GameRules<Janggi> = {
  collection: "janggi_rooms",
  initialFen: (variant) => new Janggi(parseSetups(variant)).fen(),
  replay: (moves, variant) => Janggi.replay(moves, parseSetups(variant)),
  fenOf: (g) => g.fen(),
  play: (g, mv) => g.move(mv),
  endState: (g) => g.end(),
  timeoutResult: (_g, loser) => winFor(other(loser)),
};

// ───────────── 오목 (white = 흑(선수). variant = 규칙, 19줄이면 "@19") ─────────────

const parseRule = (variant: string): Rule => {
  const r = variant.split("@")[0];
  return isRule(r) ? r : "renju";
};
const parseBoardN = (variant: string): BoardN => (variant.split("@")[1] === "19" ? 19 : 15);

export const omokRules: GameRules<Omok> = {
  collection: "omok_rooms",
  initialFen: (variant) => new Omok(parseRule(variant), parseBoardN(variant)).fen(),
  replay: (moves, variant) => Omok.replay(moves, parseRule(variant), parseBoardN(variant)),
  fenOf: (g) => g.fen(),
  play: (g, mv) => g.move(mv),
  endState: (g) => g.end(),
  timeoutResult: (_g, loser) => winFor(other(loser)),
};

export const GAMES = { chess: chessRules, janggi: janggiRules, omok: omokRules } as const;
export type GameKey = keyof typeof GAMES;
