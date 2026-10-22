import { fontTask, keyed, type LoadTask } from "@/lib/preload";
import { asset, charUrls, liveIdle } from "./assets";
import { CHAR_IDS, SKINS, type GameKind, type Look, type TierId } from "./rules";
import { preloadSfx } from "./sfx";
import type { TableWire } from "./types";

/*
 * 포커 로딩 화면에 넘길 목록 (GameLoader · usePreload).
 *   타이틀: 첫 장면 그림 · 로고 (영상은 안 기다림 — 첫 장면 그림이 깔려 있다가 영상이 이어받음)
 *   로비: 방 · 테이블 그림, 내 캐릭터 전신, 프로필, 캐릭터 고르기 상반신, 효과음
 *     (대기 영상 idle.webp 는 1~4MB 라 안 기다림 — 전신 그림이 영상 첫 장면과 같아서 받는 대로 이어받아도 티가 안 남)
 *   테이블: 그 방 그림 + 카드 · 칩 · 행동 글자 + 앉은 캐릭터 그림(charUrls)
 * 캐릭터 그림 전부(90MB)는 받지 않음 — 지금 화면에 나오는 것만.
 */

/** 방 · 테이블 그림은 리그 안 순서(1~3)로 같이 씀 → 세 장씩만 */
const STEPS: TierId[] = [1, 2, 3];
const LOOKS: Look[] = [...CHAR_IDS, ...SKINS.map((s) => s.id)];
const CHIPS = ["white", "red", "blue", "green", "black", "gold"] as const;
const ACTS = [
  "fold",
  "check",
  "call",
  "bet",
  "raise",
  "allin",
  "die",
  "bbing",
  "ddadang",
  "quarter",
  "half",
  "full",
];

const FONTS = fontTask(
  "800 1em 'Big Shoulders Display'",
  "600 1em 'Barlow Condensed'",
  "1em 'Black Han Sans'",
  "1em Jua"
);

/** 카드 · 칩 · 행동 글자 (로비 카드 그림 · 모든 테이블 공통) */
const cardUrls = (): string[] => [
  ...[0, 1, 2, 3].flatMap((s) => [9, 10, 11].map((r) => asset.court(s, r))),
  ...STEPS.map((t) => asset.back(t)),
];
const tableCommon = (): string[] => [
  ...cardUrls(),
  ...CHIPS.flatMap((c) => (["top", "side", "stack"] as const).map((k) => asset.chip(c, k))),
  ...ACTS.map((a) => `/poker/ui/act-${a}.webp`),
];

/** 로그인 전 타이틀 (가로 · 세로 첫 장면 둘 다 — 돌려도 안 비게) */
export const introTasks = (): LoadTask[] => [
  asset.logo,
  asset.introPoster("h"),
  asset.introPoster("v"),
  FONTS,
];

/** 로비 (처음 들어올 때의 내 캐릭터 기준) */
export const lobbyTasks = (look: Look): LoadTask[] => [
  asset.full(look),
  asset.logo,
  asset.room("lobby", "h"),
  asset.room("lobby", "v"),
  ...STEPS.flatMap((t) => [asset.room(t, "h"), asset.table(t, "h")]),
  asset.chip("gold", "stack"),
  asset.chip("gold", "top"),
  ...cardUrls(),
  // 순위 · 캐릭터 고르기
  ...LOOKS.map((l) => asset.profile(l)),
  ...CHAR_IDS.map((c) => asset.pose(c, "idle")),
  keyed("poker:sfx", preloadSfx),
  FONTS,
];

/** 로비에서 미리 (안 기다림): 내 대기 영상 + 테이블 공통 그림 + 내 캐릭터의 테이블 그림 — 테이블 로딩을 줄임 */
export const lobbyWarm = (look: Look, game: GameKind): string[] => [
  ...(liveIdle(look) ? [asset.idle(look)] : []),
  ...tableCommon(),
  ...charUrls(look, game),
];

/** 테이블에 들어갈 때: 그 방 그림 + 지금 앉은 캐릭터들(+ 곧 앉을 나) */
export const tableTasks = (t: TableWire, o: "h" | "v", me: Look): LoadTask[] => {
  const looks = new Set<Look>([me]);
  for (const s of t.seats) if (s) looks.add(s.look ?? s.char);
  return [
    asset.room(t.tier, o),
    asset.table(t.tier, o),
    ...tableCommon(),
    ...[...looks].flatMap((l) => charUrls(l, t.game)),
  ];
};
