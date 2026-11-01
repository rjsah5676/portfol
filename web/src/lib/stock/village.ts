/*
 * 주식 마을 — 건물 · 길 · 땅 목록 (데이터만). 화면(지금의 허브 메뉴 · 지도)과 나중의 HD-2D 마을(three.js)이 같이 읽음.
 *
 * 새 건물을 넣을 때는 여기 BUILDINGS 에 한 줄만 추가하면
 *   - 허브 목록 · 지도 · 단축키 · 상태 줄에 자동으로 나오고
 *   - 3D 마을은 map(타일 좌표 · 크기) 자리에 그 건물 모델(model)을 세움
 * 화면을 여는 방법은 action 으로: 마을 안의 화면(screen) · 다른 페이지(link) · 아직 준비 중(soon)
 *
 * 좌표: 마을은 W × H 타일 (1타일 = 1m · 3D 에서도 그대로). x 오른쪽 · y 아래쪽(3D 에선 z).
 */

import type { HubStatus } from "./types";

export type StockScreen = "hub" | "solo" | "lobby" | "room" | "records" | "estate" | "rank";

export type BuildingAction =
  | { type: "screen"; screen: StockScreen }
  | { type: "link"; href: string }
  | { type: "soon" };

export interface Building {
  id: string;
  name: string;
  /** 한 줄 설명 */
  sub: string;
  action: BuildingAction;
  /** 아이콘 (이모지 · 아트가 들어오면 그림으로) */
  icon: string;
  /** 강조색 */
  color: string;
  /** 하단 상시 바로가기 순서 (없으면 바로가기에 안 나옴) — PC 숫자키 1~ */
  shortcut?: number;
  /** 지도: 건물이 차지하는 타일 (왼쪽 위 x, y · 너비 · 깊이) */
  map: { x: number; y: number; w: number; h: number };
  /** 문 위치 (걸어가기 도착점) */
  door: { x: number; y: number };
  /** 3D 모델 이름 (아트 작업 때 채움) */
  model?: string;
  /** 상태 한 줄 */
  status?: (s: HubStatus) => string | null;
}

export const VILLAGE = {
  w: 64,
  h: 40,
  /** 처음 서는 곳 (광장) */
  spawn: { x: 32, y: 24 },
};

export const BUILDINGS: Building[] = [
  {
    id: "exchange",
    name: "증권거래소",
    sub: "솔로 · 차트 하나로 50턴",
    action: { type: "screen", screen: "solo" },
    icon: "📈",
    color: "#E5484D",
    shortcut: 1,
    map: { x: 24, y: 6, w: 16, h: 10 },
    door: { x: 32, y: 16 },
    status: (s) => (s.soloTurn !== null ? `하던 판 ${s.soloTurn}/50턴` : s.soloLast !== null ? `지난 판 ${s.soloLast >= 0 ? "+" : ""}${(s.soloLast * 100).toFixed(1)}%` : null),
  },
  {
    id: "hall",
    name: "트레이딩 홀",
    sub: "대전 · 2~8명 7분 승부",
    action: { type: "screen", screen: "lobby" },
    icon: "⚔️",
    color: "#F2C14E",
    shortcut: 2,
    map: { x: 44, y: 10, w: 14, h: 10 },
    door: { x: 50, y: 20 },
    status: (s) => (s.rooms ? `열린 방 ${s.rooms}${s.playing ? ` · 대전 중 ${s.playing}` : ""}` : "열린 방 없음 · 먼저 열어 보세요"),
  },
  {
    id: "poker",
    name: "포커 하우스",
    sub: "애니메 포커 (같은 지갑)",
    action: { type: "link", href: "/games/poker" },
    icon: "🃏",
    color: "#FFC93C",
    shortcut: 3,
    map: { x: 6, y: 10, w: 12, h: 10 },
    door: { x: 12, y: 20 },
  },
  {
    id: "realty",
    name: "부동산 · 경매장",
    sub: "아파트 분양 · 명당 경매",
    action: { type: "screen", screen: "estate" },
    icon: "🏠",
    color: "#36C2A0",
    map: { x: 6, y: 26, w: 10, h: 8 },
    door: { x: 11, y: 26 },
    status: (s) => (s.bids ? `명당 입찰 ${s.bids}곳 진행 중` : "명당 입찰 받는 중"),
  },
  {
    id: "apartment",
    name: "주식 아파트",
    sub: "내 호실 · 입구 명패 TOP 5",
    action: { type: "screen", screen: "estate" },
    icon: "🏢",
    color: "#3FA9F5",
    map: { x: 48, y: 26, w: 10, h: 10 },
    door: { x: 53, y: 26 },
    status: (s) => `입주 ${s.residents}세대`,
  },
  {
    id: "board",
    name: "명예의 전당",
    sub: "총자산 · 주간 순위 · 내 전적",
    action: { type: "screen", screen: "rank" },
    icon: "🏆",
    color: "#B48CFF",
    map: { x: 26, y: 30, w: 12, h: 6 },
    door: { x: 32, y: 30 },
  },
  {
    id: "shop",
    name: "상점",
    sub: "가구 · 꾸미기 (준비 중)",
    action: { type: "soon" },
    icon: "🛍️",
    color: "#FF8FA3",
    map: { x: 18, y: 22, w: 6, h: 5 },
    door: { x: 21, y: 27 },
  },
];

/** 명당 단독주택 자리 (estate.ts 의 LANDMARKS.lot) */
export const LOTS: Record<string, { x: number; y: number }> = {
  hill: { x: 4, y: 2 },
  blossom1: { x: 20, y: 2 },
  blossom2: { x: 26, y: 2 },
  plaza: { x: 38, y: 22 },
  lake1: { x: 58, y: 4 },
  lake2: { x: 60, y: 12 },
  clock: { x: 2, y: 36 },
  light: { x: 60, y: 36 },
  hanok: { x: 20, y: 36 },
  front: { x: 40, y: 2 },
};

export const buildingOf = (id: string) => BUILDINGS.find((b) => b.id === id);
export const SHORTCUTS = BUILDINGS.filter((b) => b.shortcut).sort((a, b) => a.shortcut! - b.shortcut!);

/** 두 점 사이 걸어가는 시간 (자동 이동 연출 · 화면을 누르면 바로 도착) */
export const walkMs = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.min(2400, 120 * Math.hypot(a.x - b.x, a.y - b.y));
