import { Omok, isRule, type BoardN, type Rule } from "@/lib/omok/engine";
import { createBoardRooms, other, winFor, type BoardRoom } from "./boardRooms";

/*
 * 온라인 오목 — 체스·장기와 같은 공통 방 시스템(boardRooms)에 오목 규칙만 끼움.
 * 좌석: white = 흑(선수), black = 백 (방 시스템의 "먼저 두는 쪽" 이름을 그대로 씀).
 * variant = 규칙 ("renju" | "normal" | "free"), 19줄 판이면 뒤에 "@19" (예: "renju@19"), 수 표기 "h8".
 */

export * from "./boardRooms";

export type EndReason =
  "" | "five" | "full" | "timeout" | "resign" | "abandon" | "agreement" | "paused";

export type OmokRoom = BoardRoom<Exclude<EndReason, "">>;

export const parseRule = (variant: string): Rule => {
  const r = variant.split("@")[0];
  return isRule(r) ? r : "renju";
};
/** 판 줄 수 (variant 뒤의 "@19") */
export const parseBoardN = (variant: string): BoardN => (variant.split("@")[1] === "19" ? 19 : 15);
export const makeVariant = (rule: Rule, n: BoardN) => (n === 19 ? `${rule}@19` : rule);

export const replay = (moves: string[], variant: string) =>
  Omok.replay(moves, parseRule(variant), parseBoardN(variant));

const api = createBoardRooms<Omok, Exclude<EndReason, "">>({
  collection: "omok_rooms",
  path: "/games/omok/",
  initialFen: (variant) => new Omok(parseRule(variant), parseBoardN(variant)).fen(),
  replay,
  fenOf: (g) => g.fen(),
  play: (g, mv) => g.move(mv),
  endState: (g) => g.end(),
  // 오목은 돌이 모자라 못 이기는 경우가 없음 → 시간패는 그냥 패배
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
