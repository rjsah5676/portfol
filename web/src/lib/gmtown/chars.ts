import type { CharId } from "./types";

/*
 * 마을 캐릭터 스프라이트 — 위 35° 에서 렌더한 걷기 · 숨쉬기 (에이미: 원화 → 3D → 믹사모 → 방향별 GPT → 그록 → 20장).
 * 시트는 가로로 n 장. 오른쪽을 보는 그림이라 왼쪽 방향은 좌우 반전.
 * 방향 0~7 (0 = 위(등), 시계 방향): 0 back · 1 backdiag · 2 side · 3 frontdiag · 4 front · 5~7 은 3~1 을 반전.
 */

export type SheetDir = "front" | "frontdiag" | "side" | "backdiag" | "back";

export interface Sheet {
  file: string;
  n: number;
  /** 한 장 크기 · 발 위치 (그림 px) */
  w: number;
  h: number;
  ax: number;
  ay: number;
}

export interface CharDef {
  name: string;
  base: string;
  /** 머리 꼭대기까지 그림 px (화면 키를 맞추는 기준) */
  tall: number;
  /** 3D 모델 (리깅 + 걷기 · 숨쉬기 동작, 키 1 로 만든 것). 있으면 판 대신 3D 로 세움 — 못 받으면 판으로 */
  model?: string;
  /** 눈 덧그림(앞머리 위로 비침)을 쓰는 눈 그림 세로 범위 (UV v, 위가 0). 없으면 에이미 눈 줄만 [0.44, 0.64] */
  eyeBand?: [number, number];
  dirs: Record<SheetDir, { walk: Sheet; idle: Sheet; start: number }>;
}

/** 에이미 판 그림 (3D 를 못 받을 때 · 미오 · 세라도 판은 일단 이걸로) */
const AMY_DIRS: CharDef["dirs"] = {
  front: { walk: { file: "amy_front_walk.webp", n: 20, w: 110, h: 178, ax: 55.2, ay: 168 }, idle: { file: "amy_front_idle.webp", n: 23, w: 111, h: 169, ax: 55.3, ay: 166 }, start: 15 },
  frontdiag: { walk: { file: "amy_frontdiag_walk.webp", n: 20, w: 116, h: 180, ax: 72.6, ay: 171 }, idle: { file: "amy_frontdiag_idle.webp", n: 26, w: 97, h: 172, ax: 62.6, ay: 169 }, start: 5 },
  side: { walk: { file: "amy_side_walk.webp", n: 20, w: 113, h: 176, ax: 54.4, ay: 170 }, idle: { file: "amy_side_idle.webp", n: 21, w: 82, h: 172, ax: 50.6, ay: 169 }, start: 14 },
  backdiag: { walk: { file: "amy_backdiag_walk.webp", n: 20, w: 128, h: 172, ax: 78.4, ay: 160 }, idle: { file: "amy_backdiag_idle.webp", n: 42, w: 101, h: 161, ax: 66.6, ay: 158 }, start: 17 },
  back: { walk: { file: "amy_back_walk.webp", n: 20, w: 113, h: 167, ax: 56.7, ay: 160 }, idle: { file: "amy_back_idle.webp", n: 59, w: 118, h: 160, ax: 58.3, ay: 157 }, start: 10 },
};

export const CHARS: Record<CharId, CharDef> = {
  amy: { name: "에이미", base: "/gmtown/char/amy", tall: 168, model: "/gmtown/char/amy3d.glb", dirs: AMY_DIRS },
  mio: { name: "미오", base: "/gmtown/char/amy", tall: 168, model: "/gmtown/char/mio3d.glb", eyeBand: [0.47, 0.72], dirs: AMY_DIRS },
  // 세라: 얼굴 비워서 뽑은 모델 + 그려 넣은 눈 · 눈썹 → 눈썹도 앞머리 위로 비침
  sera: { name: "세라", base: "/gmtown/char/amy", tall: 168, model: "/gmtown/char/sera3d.glb", eyeBand: [0.37, 0.7], dirs: AMY_DIRS },
};

/** 방향 0~7 → 시트 · 반전 */
export function sheetOf(d: number): { dir: SheetDir; flip: boolean } {
  const k = ((d % 8) + 8) % 8;
  const dir: SheetDir = (["back", "backdiag", "side", "frontdiag", "front", "frontdiag", "side", "backdiag"] as const)[k];
  return { dir, flip: k >= 5 };
}

/** 이 캐릭터가 쓰는 그림 주소 전부 (미리 받기) */
export const charFiles = (c: CharId) => [
  ...Object.values(CHARS[c].dirs).flatMap((d) => [`${CHARS[c].base}/${d.walk.file}`, `${CHARS[c].base}/${d.idle.file}`]),
  ...(CHARS[c].model ? [CHARS[c].model!] : []),
];

/** 화면에서 캐릭터 키 (칸) — 건물 · 나무 크기는 이걸 기준으로 맞춤 */
export const CHAR_TALL = 1.65;
/** 한 장 넘기는 간격 (걷기는 마을 걸음 속도에 맞춰 원본 55ms 보다 빠르게) */
export const WALK_MS = 36;
export const IDLE_MS = 80;
