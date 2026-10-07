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

/*
 * 세로판인데 무대가 덜 길쭉할 때(폰에서 전체화면이 아닐 때 — 사이트 머리말 · 메뉴가 위를 먹음):
 * % 배치로는 겹치므로 위에서부터 줄 단위로 픽셀을 쌓아 배치한다.
 *   줄 A: 맞은편 자리들(+옆 윗자리)   가운데: 구간 · 팟 (+홀덤 바닥 카드)
 *   줄 B: 옆 아랫자리(카드는 이름표 아래)   내 줄: 왼쪽 내 캐릭터 · 이름표, 가운데 내 카드, 오른쪽 작은 버튼
 *   맨 아래: 행동 바 (R = 내 차례일 때 행동 바가 차지하는 높이)
 * 크기는 k 배로 줄여서라도 다 들어가게.
 */
export interface CompactV {
  L: Layout;
  k: number;
  /** 자리별 카드 위치: auto = 이름표 옆(안쪽), below = 이름표 아래 */
  cardSide: ("auto" | "below")[];
  /** 내 줄의 아래 끝(px, 위에서부터) */
  heroBottom: number;
  /** 내 카드가 놓일 수 있는 가로 구간(px) */
  heroBand: [number, number];
  /** 작은 버튼을 내 카드 오른쪽 위에 (아니면 내 줄 오른쪽 끝) */
  btnAbove: boolean;
  /** 옆 아랫자리 묶음(이름표+카드)의 아래 끝(px) — 내 캐릭터는 그 아래로 */
  sideBottom: number;
  sizes: { card: number; heroCard: number; boardCard: number; face: number };
}

export const COMPACT_RATIO = 1.95;
const PLATE = 52; // 남의 이름표 높이(대략)
const BTN = 34; // 오른쪽 작은 버튼
const BET = 28; // 맞은편 자리 카드 아래 건 돈

export function compactV(w: number, h: number, seats: number, seven: boolean, R: number): CompactV {
  // 작은 버튼(이모티콘 · 족보)을 내 카드 오른쪽 위에 올릴 자리가 있으면 내 카드 구간을 오른쪽 끝까지
  const wide = layoutC(w, h, seats, seven, R, true);
  if (wide.btnTop >= wide.sideBottom + 4) return wide;
  return layoutC(w, h, seats, seven, R, false);
}

function layoutC(w: number, h: number, seats: number, seven: boolean, R: number, btnAbove: boolean): CompactV & { btnTop: number } {
  const u = Math.min(w, h) / 100;
  const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const heroBottom = h - 8 - R - 6;
  // 높이: 고정 부분 + u·k 에 비례하는 부분
  const sprU = 19; // 캐릭터 그림 높이(u)
  const cardU = seven ? 7.2 : 7;
  const fixed = 34 + PLATE + 8 + BET + 64 + 12 + 24 + 6;
  const scal = seven ? 0.92 * sprU + 1.4 * cardU + 1.4 * 11.5 : 0.92 * sprU + 1.4 * cardU + 1.4 * 13.5 + 1.4 * 15;
  const k = cl((h - 8 - R - fixed) / (scal * u), 0.6, 1);
  const sprH = sprU * u * k;
  const card = cardU * u * k;
  const cardH = card * 1.4;
  const face = 12 * u * k;
  // 내 줄: 왼쪽 이름표(얼굴 + 정보 판) 오른쪽부터 작은 버튼 왼쪽까지
  const heroLeft = 8 + face * 1.05 + 6 + 8 * 12.96 + 10;
  const band: [number, number] = [heroLeft, btnAbove ? w - 8 : w - 8 - BTN - 6];
  const bandW = band[1] - band[0];
  const heroCard = seven ? Math.min(11.5 * u * k, bandW / 5.2) : Math.min(15 * u * k, (bandW - 8) / 2);
  const boardCard = Math.min(13.5 * u * k, (w - 2 * 90) / 5.2);
  const heroCardsTop = heroBottom - 24 - heroCard * 1.4;
  const used = seven ? fixed + 0.92 * sprH + cardH + heroCard * 1.4 : fixed + 0.92 * sprH + cardH + boardCard * 1.4 + heroCard * 1.4;
  const s = Math.max(0, h - 8 - R - used);

  const yA = 34 + 0.92 * sprH + s * (seven ? 0.2 : 0.25);
  const rowAEnd = yA + PLATE + 4 + cardH; // 맞은편 자리는 카드가 이름표 아래
  const centerTop = rowAEnd + BET + s * (seven ? 0.3 : 0.25);
  const blockB = PLATE + 4 + cardH;
  const loB = seven ? rowAEnd + 4 : yA + PLATE + 8;
  const hiB = heroBottom - 60 - 4 - blockB;
  const yB = cl(seven ? loB : centerTop, Math.min(loB, hiB), hiB);

  const pct = (px: number) => (px / h) * 100;
  const spots: Spot[] = seven
    ? [
        { x: 50, y: 100, side: "top" },
        { x: 13, y: pct(yB), side: "left" },
        { x: 30, y: pct(yA), side: "top" },
        { x: 70, y: pct(yA), side: "top" },
        { x: 87, y: pct(yB), side: "right" },
      ]
    : [
        { x: 50, y: 100, side: "top" },
        { x: 13, y: pct(yB), side: "left" },
        { x: 13, y: pct(yA), side: "left" },
        { x: 50, y: pct(yA), side: "top" },
        { x: 87, y: pct(yA), side: "right" },
        { x: 87, y: pct(yB), side: "right" },
      ];
  const cardSide: ("auto" | "below")[] = seven ? ["auto", "below", "below", "below", "below"] : ["auto", "below", "auto", "below", "auto", "below"];
  void seats;
  // 테이블 그림: 맞은편 자리의 테이블 선부터 내 줄 아래까지
  const tTop = yA - 8;
  const tW = Math.min(w * 0.86, (heroBottom + 14 - tTop) / (1111 / 900));
  return {
    L: {
      table: { cx: 50, top: pct(tTop), w: (tW / w) * 100 },
      // 7포커는 바닥 카드가 없으니 '판 가운데'(외침 도착 · 3·2·1) = 팟과 내 카드 사이
      center: { pot: pct(centerTop), board: seven ? pct((centerTop + 58 + heroCardsTop) / 2 - boardCard * 0.9) : pct(centerTop + 64 + boardCard * 0.7) },
      heroX: ((band[0] + band[1]) / 2 / w) * 100,
      heroCards: pct(heroCardsTop),
      spots,
      spriteH: pct(sprH),
      heroSpriteH: 20,
    },
    k,
    cardSide,
    heroBottom,
    heroBand: band,
    sideBottom: yB + blockB,
    btnAbove,
    btnTop: btnAbove ? heroCardsTop - 6 - (BTN * 2 + 6) : 1e9,
    sizes: { card, heroCard, boardCard, face },
  };
}
