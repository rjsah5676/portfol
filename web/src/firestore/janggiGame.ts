import { Janggi, type Setup, SETUPS } from "@/lib/janggi/engine";
import { createBoardRooms, other, winFor, type BoardRoom } from "./boardRooms";

/*
 * 온라인 장기 — 체스와 같은 공통 방 시스템(boardRooms)에 장기 규칙만 끼움.
 * 좌석: white = 초(선), black = 한. variant = "초상차림/한상차림" (예: "heeh/ehhe")
 */

export * from "./boardRooms";

export type EndReason =
  | ""
  | "checkmate"
  | "bikjang"
  | "passes"
  | "maxplies"
  | "timeout"
  | "resign"
  | "abandon"
  | "agreement"
  | "paused";

export type JanggiRoom = BoardRoom<Exclude<EndReason, "">>;

const isSetup = (v: string): v is Setup => SETUPS.some((s) => s.v === v);
export function parseVariant(variant: string): { w: Setup; b: Setup } {
  const [w, b] = variant.split("/");
  return { w: isSetup(w) ? w : "heeh", b: isSetup(b) ? b : "heeh" };
}

export const replay = (moves: string[], variant: string) =>
  Janggi.replay(moves, parseVariant(variant));

const api = createBoardRooms<Janggi, Exclude<EndReason, "">>({
  collection: "janggi_rooms",
  path: "/games/janggi/",
  initialFen: (variant) => new Janggi(parseVariant(variant)).fen(),
  replay,
  fenOf: (g) => g.fen(),
  play: (g, mv) => g.move(mv),
  endState: (g) => g.end(),
  // 장기는 기물이 부족해 못 이기는 경우를 따로 두지 않음 → 시간패는 그냥 패배
  timeoutResult: (_g, loser) => winFor(other(loser)),
});

export const {
  subscribeRooms,
  subscribeRoom,
  subscribePresence,
  beat,
  findMyActiveRoom,
  createRoom,
  hasRoomAccess,
  unlockRoom,
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
