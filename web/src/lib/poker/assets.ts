import { skinOf, tierOf, type Emote, type Face, type Look, type Pose, type TierId } from "./rules";

/*
 * 포커 그림 파일 주소 (web/public/poker/ — anime-poker-src/build.py 가 만듦).
 * 캐릭터: char/{id}/pose-*.webp(288×384) · face-*.webp(256²) · emote-*.webp(160²) · profile.webp · full.webp · cutin.webp
 */

const BASE = "/poker";
/** 방 그림은 리그 안 순서(1~3)로 같이 씀 */
const STEP_KEY = { 1: "low", 2: "mid", 3: "vip" } as const;
const TIER_KEY = (t: TierId) => STEP_KEY[tierOf(t).step];

/** 리그마다 방 배경 색조 (일반 = 원래 그림, 도박꾼 = 차갑고 붉은 네온, 타짜 = 금빛) */
export function roomTint(t: TierId): string | undefined {
  const lg = tierOf(t).league;
  if (lg === 2) return "hue-rotate(-38deg) saturate(1.25) brightness(0.92)";
  if (lg === 3) return "sepia(0.45) saturate(1.6) hue-rotate(-12deg) brightness(0.95)";
  return undefined;
}

/** 그림 폴더: 스킨인데 그림이 아직 없으면 원래 캐릭터 폴더 */
const dir = (l: Look) => {
  const sk = skinOf(l);
  return sk && !sk.ready ? sk.char : l;
};
/** 스킨 그림이 들어와 있나 (로비 동작 · 터치 반응 그림이 있는지) */
export const lookReady = (l: Look) => !!skinOf(l)?.ready;
/** 왼쪽 아래 내 캐릭터용 전신 그림(hero-*.webp, 384×576)이 있는 그림 폴더 */
const HERO_DIRS = new Set(["amy", "jinwoo", "taeyang", "jeongmin", "yeonseo"]);
export const heroReady = (l: Look) => HERO_DIRS.has(dir(l));

export const asset = {
  pose: (c: Look, p: Pose) => `${BASE}/char/${dir(c)}/pose-${p}.webp`,
  /** 내 캐릭터 전신 (머리 ~ 발, 2:3) */
  hero: (c: Look, p: Pose) => `${BASE}/char/${dir(c)}/hero-${p}.webp`,
  /** 테이블에 앉은 모습: front = 맞은편, side = 왼쪽 자리(오른쪽을 봄) */
  seat: (c: Look, view: "front" | "side", p: Pose) =>
    `${BASE}/char/${dir(c)}/seat-${view}-${p}.webp`,
  face: (c: Look, f: Face) => `${BASE}/char/${dir(c)}/face-${f}.webp`,
  emote: (c: Look, e: Emote) => `${BASE}/char/${dir(c)}/emote-${e}.webp`,
  profile: (c: Look) => `${BASE}/char/${dir(c)}/profile.webp`,
  full: (c: Look) => `${BASE}/char/${dir(c)}/full.webp`,
  cutin: (c: Look) => `${BASE}/char/${dir(c)}/cutin.webp`,
  /** 스킨 전용: 로비 동작(1~6) · 터치 반응(1~3) */
  lobby: (c: Look, i: number) => `${BASE}/char/${c}/lobby-${i}.webp`,
  /** 같은 포즈의 눈 감은 그림 (깜빡임) */
  lobbyBlink: (c: Look, i: number) => `${BASE}/char/${c}/lobby-${i}-blink.webp`,
  touch: (c: Look, i: number) => `${BASE}/char/${c}/touch-${i}.webp`,
  table: (t: TierId, o: "h" | "v") => `${BASE}/table/${TIER_KEY(t)}-${o}.webp`,
  room: (t: TierId | "lobby", o: "h" | "v") =>
    `${BASE}/room/${t === "lobby" ? "lobby" : TIER_KEY(t)}-${o}.webp`,
  back: (t: TierId) => `${BASE}/card/back-${TIER_KEY(t)}.webp`,
  court: (suit: number, rank: number) =>
    `${BASE}/card/court-${"shdc"[suit]}-${["j", "q", "k"][rank - 9]}.webp`,
  chip: (
    color: "white" | "red" | "blue" | "green" | "black" | "gold",
    kind: "top" | "side" | "stack"
  ) => `${BASE}/card/chip-${color}-${kind}.webp`,
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
export function preloadChar(c: Look, poses: readonly Pose[], faces: readonly Face[]) {
  if (typeof window === "undefined" || loaded.has(c)) return;
  loaded.add(c);
  for (const p of poses) {
    new Image().src = asset.seat(c, "front", p);
    new Image().src = asset.seat(c, "side", p);
  }
  for (const f of faces) new Image().src = asset.face(c, f);
  new Image().src = asset.cutin(c);
}
