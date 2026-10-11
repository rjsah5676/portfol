import { skinOf, tierOf, type Emote, type Face, type Look, type Pose, type TierId } from "./rules";

/*
 * 포커 그림 파일 주소 (web/public/poker/ — anime-poker-src/build.py 가 만듦).
 * 캐릭터: char/{id}/seat-front-*.webp(앉은 정면, 288×384) · pose-idle · hero-win · face-*.webp(256²) · emote-*.webp(160²) · profile.webp · full.webp · cutin.webp
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
/** 로비에서 대기 영상(idle.webp)이 도는 기본 캐릭터 (스킨은 rules.ts 의 live). 파일이 아직 없으면 전신 그림 한 장 */
const LIVE_BASE = new Set<string>(["amy", "yeonseo", "jinwoo", "taeyang", "jeongmin", "mio"]);
export const liveIdle = (l: Look) => (skinOf(l) ? !!skinOf(l)?.live && lookReady(l) : LIVE_BASE.has(l));

/** 7포커 자리 앉은 대기 동작(움직이는 webp)이 있는 그림 폴더 */
const SEAT_LIVE = new Set<string>(["jinwoo", "yeonseo", "taeyang", "jeongmin", "amy", "mio", "amy-summer", "yeonseo-summer"]);
export const seatLive = (l: Look) => SEAT_LIVE.has(dir(l));

export const asset = {
  /** 캐릭터 고르기 화면 상반신 (대기 1장만 남김) */
  pose: (c: Look, p: "idle") => `${BASE}/char/${dir(c)}/pose-${p}.webp`,
  /** 승리 컷인 전신 (이기는 포즈 1장만 남김) */
  hero: (c: Look, p: "win") => `${BASE}/char/${dir(c)}/hero-${p}.webp`,
  /** 7포커 자리: 앉은 정면 상반신 (포즈 8장) */
  seat: (c: Look, view: "front", p: Pose) => `${BASE}/char/${dir(c)}/seat-${view}-${p}.webp`,
  /** 앉은 대기 동작 (6초 반복, 투명 배경 움직이는 webp) — 받기 전엔 한 장짜리 대기 그림 */
  seatLive: (c: Look) => `${BASE}/char/${dir(c)}/seat-front-idle-live.webp`,
  face: (c: Look, f: Face) => `${BASE}/char/${dir(c)}/face-${f}.webp`,
  /** 이모티콘은 스킨을 입어도 원래 캐릭터 것 */
  emote: (c: Look, e: Emote) => `${BASE}/char/${skinOf(c)?.char ?? c}/emote-${e}.webp`,
  profile: (c: Look) => `${BASE}/char/${dir(c)}/profile.webp`,
  full: (c: Look) => `${BASE}/char/${dir(c)}/full.webp`,
  cutin: (c: Look) => `${BASE}/char/${dir(c)}/cutin.webp`,
  /** 라이브 스킨 전용: 로비 대기 영상 · 터치 반응 영상 (투명 배경 움직이는 webp) */
  idle: (c: Look) => `${BASE}/char/${c}/idle.webp`,
  touch: (c: Look, i: number) => `${BASE}/char/${c}/touch-${i}.webp`,
  /** 타이틀 화면 배경 영상 · 첫 장면 그림 (가로 = PC, 세로 = 폰) */
  intro: (o: "h" | "v") => `${BASE}/room/intro-${o}.mp4`,
  introPoster: (o: "h" | "v") => `${BASE}/room/intro-${o}.webp`,
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
  for (const p of poses) new Image().src = asset.seat(c, "front", p);
  for (const f of faces) new Image().src = asset.face(c, f);
  new Image().src = asset.cutin(c);
}
