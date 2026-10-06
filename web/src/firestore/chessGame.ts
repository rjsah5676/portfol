import { Chess } from "chess.js";
import {
  createBoardRooms,
  other,
  winFor,
  type BoardRoom,
  type Color,
  type GameResult,
} from "./boardRooms";

/*
 * 온라인 체스 (방 생성/참여/관전)
 * 방·좌석·시계·무르기·채팅 등은 boardRooms의 공통 방 시스템을 쓰고, 여기선 체스 규칙만 끼움.
 */

export * from "./boardRooms";

export type EndReason =
  | ""
  | "checkmate"
  | "timeout"
  | "resign"
  | "abandon"
  | "stalemate"
  | "insufficient"
  | "threefold"
  | "fifty"
  | "agreement"
  | "paused";

export type ChessRoom = BoardRoom<Exclude<EndReason, "">>;

export function uciToMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}

export function replay(moves: string[]): Chess {
  const game = new Chess();
  for (const m of moves) game.move(uciToMove(m));
  return game;
}

/**
 * 현재 국면이 지금까지 몇 번 나왔는지 (기물 배치·차례·캐슬링·앙파상이 같으면 같은 국면).
 * 3이 되면 endState에서 3회 동형반복 무승부로 끝남 — 2일 때 화면에 경고용.
 */
export function repetitionCount(moves: string[]): number {
  const key = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
  const game = new Chess();
  const seen = [key(game.fen())];
  for (const m of moves) {
    game.move(uciToMove(m));
    seen.push(key(game.fen()));
  }
  const now = seen[seen.length - 1];
  return seen.filter((k) => k === now).length;
}

/** 시간패 시 상대가 체크메이트 할 기물이 아예 없으면 무승부 (킹 단독 / 킹+마이너 1개) */
function cannotMate(game: Chess, color: Color): boolean {
  const pieces = game
    .board()
    .flat()
    .filter((p) => p && p.color === color && p.type !== "k");
  if (pieces.length === 0) return true;
  return pieces.length === 1 && (pieces[0]!.type === "n" || pieces[0]!.type === "b");
}

function endState(game: Chess): { result: GameResult; reason: Exclude<EndReason, ""> } | null {
  if (game.isCheckmate())
    return { result: game.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
  if (game.isStalemate()) return { result: "1/2-1/2", reason: "stalemate" };
  if (game.isInsufficientMaterial()) return { result: "1/2-1/2", reason: "insufficient" };
  if (game.isThreefoldRepetition()) return { result: "1/2-1/2", reason: "threefold" };
  if (game.isDrawByFiftyMoves()) return { result: "1/2-1/2", reason: "fifty" };
  return null;
}

const api = createBoardRooms<Chess, Exclude<EndReason, "">>({
  collection: "chess_rooms",
  path: "/games/chess/",
  initialFen: () => new Chess().fen(),
  replay: (moves) => replay(moves),
  fenOf: (g) => g.fen(),
  play: (g, uci) => {
    g.move(uciToMove(uci));
  },
  endState,
  timeoutResult: (g, loser) => (cannotMate(g, other(loser)) ? "1/2-1/2" : winFor(other(loser))),
});

export const {
  subscribeRooms,
  subscribeRoom,
  subscribePresence,
  beat,
  findMyActiveRoom,
  createRoom,
  hasRoomAccess,
  unlockRoom: unlockChessRoom,
  inviteLink,
  joinAsPlayer,
  startGame,
  joinAsSpectator,
  leaveRoom,
  makeMove,
  claimTimeout,
  claimAbandon,
  resign,
  offerDraw,
  respondDraw,
  requestUndo,
  cancelUndo,
  respondUndo,
  requestRematch,
  cancelRematch,
  pauseGame,
  resumeGame,
  addTime,
  expirePausedGame,
  subscribeChat,
  sendChat,
} = api;
