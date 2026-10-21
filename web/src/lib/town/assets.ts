/*
 * TABLE TOWN 그림 목록 — 그림이 들어오면 여기 주소만 채우면 화면에 바로 입혀짐.
 * null 이면 코드로 그린 임시 모양(회색 박스)으로 보임.
 * 모든 그림은 게임 열기 전에 로딩 화면에서 다 받음 (진행률 막대).
 */

export type CharId = "haru" | "ruru";
export type LookId = "base" | "cos1";
export type Face = "idle" | "happy" | "sad" | "smug" | "panic" | "win";
export type GameId = "joker" | "onecard" | "yut" | "chess" | "janggi" | "omok" | "mahjong" | "soon";

const B = "/town";
const FACES: Face[] = ["idle", "happy", "sad", "smug", "panic", "win"];
const faces = (c: string) => Object.fromEntries(FACES.map((f) => [f, `${B}/face/${c}-${f}.webp`])) as Record<Face, string>;

export const ART: {
  logo: string | null;
  sky: string | null;
  /** 거리 바닥 (가로 반복) · 앞쪽 난간 · 운하 띠 (캐릭터보다 앞에 그림) */
  ground: string | null;
  front: string | null;
  room: string | null;
  cardBack: string | null;
  joker: string | null;
  bld: Partial<Record<GameId, string>>;
  props: { lamp: string | null; planter: string | null };
  icon: Partial<Record<UiIcon, string>>;
  /** 풀버전 일러 뒤에 붙이는 배경 — 기본 모습은 전부 이것 하나 (밋밋하게) */
  fullBg: string | null;
  /**
   * 캐릭터 · 모습별
   *  full = 풀버전 일러 (배경 없이 캐릭터만, 뒤에 fullBg 또는 bg 를 붙여 보여 줌)
   *  bg   = 이 모습 전용 배경 (코스튬용, 없으면 fullBg)
   *  sd   = 마을 · 대기실 작은 몸, face = 얼굴 동그라미, bust = 표정별 상반신
   */
  char: Partial<Record<CharId, Partial<Record<LookId, CharArt>>>>;
  /** 코스튬 뽑기: 배경 · 기계 · 캡슐(금 = 코스튬, 파랑 = 꽝) · 열린 금 캡슐 위/아래 · 반짝이 */
  gacha: { bg: string | null; machine: string | null; capGold: string | null; capBlue: string | null; capTop: string | null; capBottom: string | null; spark: string | null };
} = {
  logo: `${B}/ui/logo.webp`,
  sky: `${B}/bg/sky.webp`,
  ground: `${B}/bg/ground.webp`,
  front: `${B}/bg/front.webp`,
  room: `${B}/bg/room-onecard.webp`,
  cardBack: `${B}/ui/card-back.webp`,
  joker: `${B}/ui/joker.webp`,
  bld: {
    joker: `${B}/bld/joker.webp`,
    onecard: `${B}/bld/onecard.webp`,
    yut: `${B}/bld/yut.webp`,
    chess: `${B}/bld/chess.webp`,
    janggi: `${B}/bld/janggi.webp`,
    omok: `${B}/bld/omok.webp`,
    mahjong: `${B}/bld/mahjong.webp`,
    soon: `${B}/bld/soon.webp`,
  },
  props: { lamp: null, planter: null },
  icon: Object.fromEntries(
    (["coin", "shop", "char", "mission", "mail", "settings", "chat", "list", "emote", "sort"] as const).map((k) => [k, `${B}/ui/${k}.webp`]),
  ),
  gacha: {
    bg: `${B}/gacha/bg.webp`,
    machine: `${B}/gacha/machine.webp`,
    capGold: `${B}/gacha/cap-gold.webp`,
    capBlue: `${B}/gacha/cap-blue.webp`,
    capTop: `${B}/gacha/cap-top.webp`,
    capBottom: `${B}/gacha/cap-bottom.webp`,
    spark: `${B}/gacha/spark.webp`,
  },
  fullBg: `${B}/bg/full-base.webp`,
  char: {
    haru: {
      base: { full: `${B}/char/haru-full.webp`, sd: `${B}/char/haru-sd.webp`, face: `${B}/face/haru-idle.webp`, bust: faces("haru") },
      cos1: { full: `${B}/char/haru-cos1-full.webp`, sd: `${B}/char/haru-cos1-sd.webp`, face: `${B}/face/haru-cos1-idle.webp`, bust: faces("haru-cos1") },
    },
    ruru: {
      base: { full: `${B}/char/ruru-full.webp`, sd: `${B}/char/ruru-sd.webp`, face: `${B}/face/ruru-idle.webp`, bust: faces("ruru") },
      cos1: { full: `${B}/char/ruru-cos1-full.webp`, sd: `${B}/char/ruru-cos1-sd.webp`, face: `${B}/face/ruru-cos1-idle.webp`, bust: faces("ruru-cos1") },
    },
  },
};

/** 건물 그림 속 빈 간판 자리 (그림 크기 대비 비율) — 여기에 게임 이름을 글자로 얹음 */
export const SIGN: Partial<Record<GameId, { x: number; y: number; w: number }>> = {
  joker: { x: 0.53, y: 0.475, w: 0.3 },
  onecard: { x: 0.52, y: 0.55, w: 0.32 },
  yut: { x: 0.5, y: 0.465, w: 0.3 },
  chess: { x: 0.505, y: 0.465, w: 0.3 },
  janggi: { x: 0.5, y: 0.42, w: 0.3 },
  omok: { x: 0.485, y: 0.44, w: 0.28 },
  mahjong: { x: 0.5, y: 0.435, w: 0.3 },
  soon: { x: 0.53, y: 0.47, w: 0.28 },
};

export interface CharArt {
  full?: string;
  bg?: string;
  sd?: string;
  face?: string;
  bust?: Partial<Record<Face, string>>;
}

export type UiIcon =
  | "coin"
  | "shop"
  | "char"
  | "mission"
  | "mail"
  | "settings"
  | "chat"
  | "list"
  | "emote"
  | "sort";

/** 로딩 화면에서 받을 주소 전부 */
export function allArt(): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined) => u && out.push(u);
  push(ART.logo);
  push(ART.sky);
  push(ART.ground);
  push(ART.front);
  push(ART.room);
  push(ART.cardBack);
  push(ART.joker);
  Object.values(ART.bld).forEach(push);
  push(ART.props.lamp);
  push(ART.props.planter);
  push(ART.fullBg);
  Object.values(ART.icon).forEach(push);
  Object.values(ART.gacha).forEach(push);
  for (const c of Object.values(ART.char))
    for (const l of Object.values(c ?? {})) {
      push(l?.full);
      push(l?.bg);
      push(l?.sd);
      push(l?.face);
      Object.values(l?.bust ?? {}).forEach(push);
    }
  return out;
}

export const artUrl = (p: string) => `${B}/${p}`;
