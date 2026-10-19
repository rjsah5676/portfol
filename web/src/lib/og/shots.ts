/**
 * 실제 게임 화면으로 만든 공유 미리보기 이미지가 있는 페이지 (web/assets/og/shots/<키>.jpg, 1200x630)
 * 키 = 페이지 경로 마디를 "/" 로 이은 것 ("/games/fight/" → "games/fight", 홈 → "index"), 파일 이름에선 "/" 대신 "__".
 * 여기 없는 페이지는 제목·설명으로 그린 카드(/og/<키>.png)를 씀.
 * 화면을 새로 찍으면 파일만 바꾸면 됨 — 바꾼 걸 메신저가 다시 가져가게 하려면 SHOT_VERSION 을 올림.
 */
export const SHOT_KEYS = new Set([
  "index",
  "games",
  "games/rhythm",
  "games/fight",
  "games/poker",
  "games/defense",
  "games/marble",
  "games/survivor",
  "games/sketch",
  "games/melongame",
  "games/board",
  "games/mine",
  "games/rspeed",
]);
export const SHOT_VERSION = 6;
export const shotFile = (key: string) => `${key.replace(/\//g, "__")}.jpg`;
