import { preloadAll } from "@/lib/preload";
import { EMOTES, FACES, POSES, skinOf, tierOf, type Emote, type Face, type GameKind, type Look, type Pose, type TierId } from "./rules";

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
const LIVE_BASE = new Set<string>(["amy", "yeonseo", "jinwoo", "taeyang", "jeongmin", "mio", "sera"]);
export const liveIdle = (l: Look) => (skinOf(l) ? !!skinOf(l)?.live && lookReady(l) : LIVE_BASE.has(l));

/** 7포커 자리 앉은 대기 동작(움직이는 webp)이 있는 그림 폴더 */
const SEAT_LIVE = new Set<string>(["jinwoo", "yeonseo", "taeyang", "jeongmin", "amy", "mio", "sera", "amy-summer", "yeonseo-summer", "taeyang-ts", "mio-dracula", "jinwoo-ramen", "jeongmin-detective", "sera-nurse"]);
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
  /** 이모티콘: 스킨 전용 이모티콘이 있으면 그것(성전환 스킨 등), 없으면 원래 캐릭터 것 */
  emote: (c: Look, e: Emote) => {
    const sk = skinOf(c);
    return `${BASE}/char/${sk ? (sk.emotes && sk.ready ? sk.id : sk.char) : c}/emote-${e}.webp`;
  },
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

/**
 * 테이블에서 쓰는 캐릭터 그림: 7포커 = 앉은 포즈 8장, 홀덤 = 표정 8장 (각자 그 게임에서만 보임)
 * + 이모티콘 · 올인 컷인 · 승리 전신 · 프로필. 앉은 대기 동작(seatLive)은 CharSprite 가 받아지면 바꿔 끼우므로 뺌
 */
export const charUrls = (c: Look, game: GameKind): string[] => [
  ...(game === "seven" ? POSES.map((p) => asset.seat(c, "front", p)) : FACES.map((f) => asset.face(c, f))),
  ...EMOTES.map((e) => asset.emote(c, e)),
  asset.cutin(c),
  asset.hero(c, "win"),
  asset.profile(c),
];

/** 캐릭터 그림을 미리 받아 둠 (자리에 앉은 캐릭터만). 로딩 화면과 같은 저장소라 두 번 안 받고, 다 받으면 다시 들어올 때 로딩 화면 없이 */
const warmed = new Set<string>();
export function preloadChar(c: Look, game: GameKind) {
  if (typeof window === "undefined" || warmed.has(`${game}:${c}`)) return;
  warmed.add(`${game}:${c}`);
  void preloadAll(charUrls(c, game));
}
