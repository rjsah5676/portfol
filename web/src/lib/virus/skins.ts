/*
 * VIRUS IDLE 꾸미기 — 바이러스 스킨 (능력 변화 없음, 사이트 GP 전용).
 * 산 것은 회원 문서 inv.virus 에 `skin.<id>` 로 (lib/points.ts SHOP · 패키지는 lib/virus/gpShop.ts),
 * 착용은 기기마다 (게임 설정 skin). 내 바이러스 · 날아가는 코드의 색과 코드 글자를 바꿈.
 */

export interface VirusSkin {
  id: string;
  name: string;
  icon: string;
  /** 내 바이러스 · 날아가는 코드 색 */
  color: string;
  /** 날아가는 코드 (5자리) — 없으면 기본 */
  glyphs?: string[];
  /** 색이 계속 바뀜 (hue-rotate) */
  rainbow?: boolean;
  /** 패키지로만 (사이트 상점에서 따로 안 팖) */
  packOnly?: boolean;
  /** KILLSWITCH 이정표 — 이 버전까지 격퇴하면 생김 (GP로 못 삼) */
  needClears?: number;
}

export const VIRUS_SKINS: VirusSkin[] = [
  {
    id: "frost",
    name: "프로스트",
    icon: "🧊",
    color: "#7dd3fc",
    glyphs: ["ICE01", "FROST", "-273C", "COLD!", "FREEZ", "0xC00"],
  },
  {
    id: "inferno",
    name: "인페르노",
    icon: "🔥",
    color: "#fb923c",
    glyphs: ["BURN!", "FIRE!", "0xF1R", "HEAT~", "LAVA_", "666°C"],
  },
  {
    id: "gold",
    name: "골드 루트킷",
    icon: "👑",
    color: "#fbbf24",
    glyphs: ["$GOLD", "$$$$$", "24KT!", "ROYAL", "0xAU7", "BLING"],
  },
  {
    id: "void",
    name: "보이드",
    icon: "🕳️",
    color: "#a855f7",
    glyphs: ["NULL_", "VOID*", "/dev/", "0x000", "EMPTY", "ABYSS"],
    packOnly: true,
  },
  { id: "rgb", name: "글리치 RGB", icon: "🌈", color: "#f472b6", rainbow: true },
  // KILLSWITCH 이정표 (무한 모드)
  {
    id: "ks10",
    name: "킬스위치",
    icon: "☢️",
    color: "#ef4444",
    glyphs: ["KILL!", "SW1TC", "0xDEAD", "ABORT", "HALT_", "SIGKL"],
    needClears: 10,
  },
  {
    id: "ks20",
    name: "제로데이",
    icon: "🕷️",
    color: "#22d3ee",
    glyphs: ["0-DAY", "CVE-0", "EXPLT", "PWNED", "R00T#", "0xBAD"],
    needClears: 20,
  },
  {
    id: "ks30",
    name: "엔드 오브 라인",
    icon: "⬛",
    color: "#e5e7eb",
    glyphs: ["EOF__", "/END/", "EXIT0", "~FIN~", "0xEND", "NOMOR"],
    needClears: 30,
  },
];

export const skinRef = (id: string) => `skin.${id}`;
export const skinOf = (id: string | null | undefined) =>
  VIRUS_SKINS.find((x) => x.id === id) ?? null;
/** 가진 스킨인지 (산 것 · 패키지 · KILLSWITCH 이정표) */
export const skinOwned = (sk: VirusSkin, owned: string[], clears: number) =>
  sk.needClears ? clears >= sk.needClears : owned.includes(skinRef(sk.id));
