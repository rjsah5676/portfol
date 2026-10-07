/*
 * 테이블 화면 배치 (무대의 % 좌표). 세로판(폰) · 가로판(PC) 두 벌.
 * 자리 0 = 나(아래). 나머지는 시계 방향으로 테이블 둘레.
 *   x, y  = 캐릭터가 서 있는 자리(허리선이 테이블 테두리에 닿는 점)
 *   side  = 왼쪽/오른쪽/위 (이름표 · 카드 · 건 돈을 어느 쪽으로 늘어놓을지)
 */

export type Orient = "h" | "v";
export interface Spot {
  x: number;
  y: number;
  side: "left" | "right" | "top";
}
export interface Layout {
  /** 테이블 그림: 가운데 x, 위 y, 폭 (전부 %) */
  table: { cx: number; top: number; w: number };
  /** 가운데(팟 · 바닥 카드)의 y */
  center: { pot: number; board: number };
  /** 내 카드가 놓이는 x(가운데) · y(카드 위 끝) */
  heroX: number;
  heroCards: number;
  spots: Spot[];
  /** 캐릭터 그림 높이 (무대 높이의 %) */
  spriteH: number;
  heroSpriteH: number;
}

/*
 * 자리 = 캐릭터가 앉은 "테이블 선"(몸이 테이블에 가려지는 선)의 위치. 그 아래에 이름표.
 * top = 맞은편(정면 그림), left/right = 옆자리(옆모습, right 는 좌우 뒤집음).
 * 내(아래)로부터 번호가 커질수록 화면에서 시계 방향: 아래 → 왼쪽 → 위 → 오른쪽. (플레이 순서가 눈에 그대로 보이게)
 */
const H6: Spot[] = [
  { x: 50, y: 100, side: "top" },
  { x: 5.5, y: 47, side: "left" },
  { x: 24, y: 32, side: "top" },
  { x: 50, y: 27, side: "top" },
  { x: 76, y: 32, side: "top" },
  { x: 94.5, y: 47, side: "right" },
];
const H5: Spot[] = [
  { x: 50, y: 100, side: "top" },
  { x: 5.5, y: 47, side: "left" },
  { x: 34, y: 28.5, side: "top" },
  { x: 66, y: 28.5, side: "top" },
  { x: 94.5, y: 47, side: "right" },
];
const V6: Spot[] = [
  { x: 50, y: 100, side: "top" },
  { x: 14, y: 52, side: "left" },
  { x: 15, y: 33, side: "left" },
  { x: 50, y: 24, side: "top" },
  { x: 85, y: 33, side: "right" },
  { x: 86, y: 52, side: "right" },
];
const V5: Spot[] = [
  { x: 50, y: 100, side: "top" },
  { x: 14, y: 48, side: "left" },
  { x: 32, y: 24, side: "top" },
  { x: 68, y: 24, side: "top" },
  { x: 86, y: 48, side: "right" },
];

export function layoutFor(o: Orient, seats: number): Layout {
  if (o === "h")
    return {
      table: { cx: 50, top: 24, w: 62 },
      center: { pot: 38, board: 47 },
      heroX: 33,
      heroCards: 62,
      spots: seats === 5 ? H5 : H6,
      spriteH: 21,
      heroSpriteH: 36,
    };
  return {
    table: { cx: 50, top: 22, w: 78 },
    center: { pot: 39, board: 45 },
    heroX: 50,
    heroCards: 57,
    spots: seats === 5 ? V5 : V6,
    spriteH: 14,
    heroSpriteH: 20,
  };
}
