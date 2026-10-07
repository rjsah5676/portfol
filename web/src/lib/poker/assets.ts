import type { CharId, Emote, Face, Pose, TierId } from "./rules";

/*
 * 포커 그림 파일 주소 (web/public/poker/ — anime-poker-src/build.py 가 만듦).
 * 캐릭터: char/{id}/pose-*.webp(288×384) · face-*.webp(256²) · emote-*.webp(160²) · profile.webp · full.webp · cutin.webp
 */

const BASE = "/poker";
const TIER_KEY: Record<TierId, string> = { 1: "low", 2: "mid", 3: "vip" };

export const asset = {
  pose: (c: CharId, p: Pose) => `${BASE}/char/${c}/pose-${p}.webp`,
  /** 테이블에 앉은 모습: front = 맞은편, side = 왼쪽 자리(오른쪽을 봄) */
  seat: (c: CharId, view: "front" | "side", p: Pose) => `${BASE}/char/${c}/seat-${view}-${p}.webp`,
  face: (c: CharId, f: Face) => `${BASE}/char/${c}/face-${f}.webp`,
  emote: (c: CharId, e: Emote) => `${BASE}/char/${c}/emote-${e}.webp`,
  profile: (c: CharId) => `${BASE}/char/${c}/profile.webp`,
  full: (c: CharId) => `${BASE}/char/${c}/full.webp`,
  cutin: (c: CharId) => `${BASE}/char/${c}/cutin.webp`,
  table: (t: TierId, o: "h" | "v") => `${BASE}/table/${TIER_KEY[t]}-${o}.webp`,
  room: (t: TierId | "lobby", o: "h" | "v") => `${BASE}/room/${t === "lobby" ? "lobby" : TIER_KEY[t]}-${o}.webp`,
  back: (t: TierId) => `${BASE}/card/back-${TIER_KEY[t]}.webp`,
  court: (suit: number, rank: number) => `${BASE}/card/court-${"shdc"[suit]}-${["j", "q", "k"][rank - 9]}.webp`,
  chip: (color: "white" | "red" | "blue" | "green" | "black" | "gold", kind: "top" | "side" | "stack") => `${BASE}/card/chip-${color}-${kind}.webp`,
  logo: `${BASE}/ui/logo.webp`,
  mark: `${BASE}/ui/mark.webp`,
  revive: `${BASE}/ui/revive.webp`,
};

/** 금액 → 칩 색 (기준 판돈의 몇 배인지) */
export function chipColor(ratio: number): "white" | "red" | "blue" | "green" | "black" | "gold" {
  if (ratio >= 200) return "gold";
  if (ratio >= 50) return "black";
  if (ratio >= 15) return "green";
  if (ratio >= 5) return "blue";
  if (ratio >= 1.5) return "red";
  return "white";
}

/** 캐릭터 그림을 미리 받아 둠 (자리에 앉은 캐릭터만) */
const loaded = new Set<string>();
export function preloadChar(c: CharId, poses: readonly Pose[], faces: readonly Face[]) {
  if (typeof window === "undefined" || loaded.has(c)) return;
  loaded.add(c);
  for (const p of poses) {
    new Image().src = asset.seat(c, "front", p);
    new Image().src = asset.seat(c, "side", p);
  }
  for (const f of faces) new Image().src = asset.face(c, f);
  new Image().src = asset.cutin(c);
}
