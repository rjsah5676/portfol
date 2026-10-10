/*
 * 테이블 화면 배치 (판 영역의 % 좌표 — 가로 = 오른쪽 패널을 뺀 폭, 세로 = 무대 높이). 가로 한 벌뿐 (PC = 폰).
 * 자리 0 = 나(아래 가운데). 나머지는 시계 방향으로 테이블 둘레.
 *   x, y   = 아바타(7포커: 앉은 캐릭터 그림 · 홀덤: 얼굴 아이콘)의 가운데
 *   cards  = 카드 줄을 아바타의 어느 쪽에 늘어놓는지 (늘 판 가운데 쪽)
 *   bx, by = 건 돈 알약의 가운데 (카드 줄 앞, 판 쪽)
 *   side   = 왼쪽/오른쪽/위 (카드 겹침 · 꼬리표 정렬에 씀)
 */

export type Orient = "h" | "v";
export interface Spot {
  x: number;
  y: number;
  side: "left" | "right" | "top";
  cards: "l" | "r";
  bx: number;
  by: number;
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
}

/* 7포커 5인: 양옆 위 · 아래 두 자리씩. 카드는 판 안쪽으로, 건 돈은 카드 줄 앞 */
const S5: Spot[] = [
  { x: 50, y: 100, side: "top", cards: "r", bx: 50, by: 56 },
  { x: 8, y: 52, side: "left", cards: "r", bx: 36, by: 53 },
  { x: 13, y: 19, side: "left", cards: "r", bx: 38, by: 29 },
  { x: 76, y: 19, side: "right", cards: "l", bx: 62, by: 29 },
  { x: 92, y: 52, side: "right", cards: "l", bx: 64, by: 53 },
];
/* 홀덤 9인: 양옆 셋씩(아래 · 가운데 · 위) · 위 둘. 카드는 판 안쪽으로. 오른쪽 위는 족보 상자를 비켜 안쪽으로 */
const S9: Spot[] = [
  { x: 50, y: 100, side: "top", cards: "r", bx: 50, by: 56 },
  { x: 9, y: 54, side: "left", cards: "r", bx: 27, by: 50 },
  { x: 6, y: 35, side: "left", cards: "r", bx: 27, by: 41 },
  { x: 15, y: 17, side: "left", cards: "r", bx: 32, by: 29 },
  { x: 38, y: 13, side: "top", cards: "r", bx: 44, by: 27 },
  { x: 58, y: 13, side: "top", cards: "l", bx: 56, by: 27 },
  { x: 77, y: 17, side: "right", cards: "l", bx: 66, by: 29 },
  { x: 93, y: 36, side: "right", cards: "l", bx: 72, by: 42 },
  { x: 90, y: 54, side: "right", cards: "l", bx: 72, by: 50 },
];

export function layoutFor(seats: number): Layout {
  return {
    table: { cx: 50, top: 19, w: 62 },
    center: { pot: 29, board: 40 },
    heroX: 38,
    heroCards: 60,
    spots: seats === 5 ? S5 : S9,
  };
}
