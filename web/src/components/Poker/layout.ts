/*
 * 테이블 화면 배치 (무대의 % 좌표). 가로 한 벌뿐 (PC = 폰).
 * 자리 0 = 나(아래 왼쪽 정보판 + 큰 카드). 나머지는 시계 방향으로 테이블 둘레.
 * 자리 하나 = 한 틀: [아바타][카드 칸] 한 줄 + 아래 이름 · 칩 띠 (한게임처럼). 틀은 늘 판 안쪽으로 뻗음.
 *   x, y  = 아바타(7포커: 앉은 캐릭터 그림 · 홀덤: 얼굴 아이콘)의 가운데 x · 카드 줄의 세로 가운데 y
 *   cards = 카드 칸이 아바타의 어느 쪽에 붙는지 (늘 판 가운데 쪽)
 *   side  = 왼쪽/오른쪽/위 — 위쪽 자리는 건 돈을 띠 아래에, 옆자리는 카드 칸 앞에 둠
 * 왼쪽 · 오른쪽은 거울처럼 같은 자리 (오른쪽 x = 100 − 왼쪽 x)
 */

export type Orient = "h" | "v";
export interface Spot {
  x: number;
  y: number;
  side: "left" | "right" | "top";
  cards: "l" | "r";
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

/* 7포커 5인: 양옆 위 · 아래 두 자리씩 */
const S5: Spot[] = [
  { x: 50, y: 100, side: "top", cards: "r" },
  { x: 8, y: 44, side: "left", cards: "r" },
  { x: 8, y: 19, side: "left", cards: "r" },
  { x: 92, y: 19, side: "right", cards: "l" },
  { x: 92, y: 44, side: "right", cards: "l" },
];
/* 홀덤 9인: 양옆 셋씩(아래 · 가운데 · 위) · 위 둘 */
const S9: Spot[] = [
  { x: 50, y: 100, side: "top", cards: "r" },
  { x: 7, y: 53, side: "left", cards: "r" },
  { x: 5, y: 34, side: "left", cards: "r" },
  { x: 12, y: 15, side: "left", cards: "r" },
  { x: 33, y: 15, side: "top", cards: "r" },
  { x: 67, y: 15, side: "top", cards: "l" },
  { x: 88, y: 15, side: "right", cards: "l" },
  { x: 95, y: 34, side: "right", cards: "l" },
  { x: 93, y: 53, side: "right", cards: "l" },
];

export function layoutFor(seats: number): Layout {
  return {
    table: { cx: 50, top: 19, w: 62 },
    center: { pot: 31, board: 42 },
    heroX: 38,
    heroCards: 61,
    spots: seats === 5 ? S5 : S9,
  };
}
