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
/** 테이블 자리별 앉은 그림 (0 앞왼 · 1 뒤왼 · 2 뒤오 · 3 앞오) — 자리마다 따로 그린 자세, 좌우반전 안 씀 */
const seats = (k: string) => [0, 1, 2, 3].map((i) => `${B}/seat2/${k}-${i}.webp`);
const anim = (k: string) => ({ walkR: `${B}/anim2/${k}-walkR.webp`, walkL: `${B}/anim2/${k}-walkL.webp`, idle: `${B}/anim2/${k}-idle.webp` });
const faces = (c: string) => Object.fromEntries(FACES.map((f) => [f, `${B}/face/${c}-${f}.webp`])) as Record<Face, string>;

export const ART: {
  logo: string | null;
  /** 버튼 · 판 껍데기 (GPT UI 키트, 양끝 장식은 그대로 두고 가운데만 늘림) */
  btn: Record<string, string>;
  /** 판 화면 장식 (시안 mock-game-v1 부품): 얼굴 테두리 · 공격 불꽃 · 1장 배지 */
  game: Record<"frameBig" | "frameSm" | "flame" | "oneBadge", string>;
  sky: string | null;
  /** 거리 바닥 (가로 반복) · 앞쪽 난간 · 운하 띠 (캐릭터보다 앞에 그림) */
  ground: string | null;
  front: string | null;
  room: string | null;
  /** 대기실: 테이블 없는 방 + 테이블만 따로 (앉은 캐릭터를 테이블 뒤 · 앞에 겹쳐 그림) */
  roomEmpty: string | null;
  roomTable: string | null;
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
  gacha: {
    bg: string | null;
    machine: string | null;
    capGold: string | null;
    capBlue: string | null;
    capTop: string | null;
    capBottom: string | null;
    spark: string | null;
    /** 공개 연출 이펙트 (검정 배경 → 스크린 합성): 빛기둥 · 빛줄기 · 마법진 · 섬광 · 빛의 띠 */
    pillar?: string | null;
    rays?: string | null;
    circle?: string | null;
    flare?: string | null;
    ribbon?: string | null;
    sparkle?: string | null;
    /** NEW 도장 · 이름 판 · 캡슐 받침대 */
    stamp?: string | null;
    plaque?: string | null;
    pedestal?: string | null;
  };
} = {
  logo: `${B}/ui/logo.webp`,
  btn: Object.fromEntries((["gold", "pink", "blue", "cream", "panel", "circle"] as const).map((k) => [k, `${B}/ui/btn/${k}.webp`])),
  game: {
    frameBig: `${B}/game/frame-big.webp`,
    frameSm: `${B}/game/frame-sm.webp`,
    flame: `${B}/game/flame.webp`,
    oneBadge: `${B}/game/one-badge.webp`,
  },
  sky: `${B}/bg/sky.webp`,
  ground: `${B}/bg/ground.webp`,
  front: `${B}/bg/front.webp`,
  room: `${B}/bg/room-onecard.webp`,
  roomEmpty: `${B}/room/room.webp`,
  roomTable: `${B}/room/table.webp`,
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
    pillar: `${B}/gacha/fx-pillar.webp`,
    rays: `${B}/gacha/fx-rays.webp`,
    circle: `${B}/gacha/fx-circle.webp`,
    flare: `${B}/gacha/fx-flare.webp`,
    ribbon: `${B}/gacha/fx-ribbon.webp`,
    sparkle: `${B}/gacha/fx-sparkle.webp`,
    stamp: `${B}/gacha/stamp.webp`,
    plaque: `${B}/gacha/plaque.webp`,
    pedestal: `${B}/gacha/pedestal.webp`,
  },
  fullBg: `${B}/bg/full-base.webp`,
  char: {
    haru: {
      base: { full: `${B}/char/haru-full.webp`, sd: `${B}/char2/haru-base-sd.webp`, seat: seats("haru-base"), anim: anim("haru-base"), face: `${B}/face/haru-idle.webp`, bust: faces("haru") },
      cos1: { bg: `${B}/bg/haru-cos1.webp`, full: `${B}/char/haru-cos1-full.webp`, sd: `${B}/char2/haru-cos1-sd.webp`, seat: seats("haru-cos1"), anim: anim("haru-cos1"), face: `${B}/face/haru-cos1-idle.webp`, bust: faces("haru-cos1") },
    },
    ruru: {
      base: { full: `${B}/char/ruru-full.webp`, sd: `${B}/char2/ruru-base-sd.webp`, seat: seats("ruru-base"), anim: anim("ruru-base"), face: `${B}/face/ruru-idle.webp`, bust: faces("ruru") },
      cos1: { bg: `${B}/bg/ruru-cos1.webp`, full: `${B}/char/ruru-cos1-full.webp`, sd: `${B}/char2/ruru-cos1-sd.webp`, seat: seats("ruru-cos1"), anim: anim("ruru-cos1"), face: `${B}/face/ruru-cos1-idle.webp`, bust: faces("ruru-cos1") },
    },
  },
};

/** 건물 그림 속 빈 간판 자리 (그림 크기 대비 비율) — 여기에 게임 이름을 글자로 얹음 */
export const SIGN: Partial<Record<GameId, { x: number; y: number; w: number; h: number }>> = {
  // 그림에서 간판 안쪽(크림색) 영역을 재서 넣은 값: 가운데 x · y, 폭 w · 높이 h (그림 크기 대비)
  joker: { x: 0.531, y: 0.496, w: 0.26, h: 0.088 },
  onecard: { x: 0.496, y: 0.578, w: 0.289, h: 0.091 },
  yut: { x: 0.513, y: 0.479, w: 0.285, h: 0.081 },
  chess: { x: 0.509, y: 0.464, w: 0.284, h: 0.1 },
  janggi: { x: 0.515, y: 0.434, w: 0.33, h: 0.107 },
  omok: { x: 0.512, y: 0.45, w: 0.305, h: 0.107 },
  mahjong: { x: 0.508, y: 0.434, w: 0.35, h: 0.114 },
  soon: { x: 0.503, y: 0.486, w: 0.296, h: 0.089 },
};

/** 건물 그림의 두 번째 빈 간판 (장기 지붕의 팔각 간판 등) — 상징 글자 하나 */
export const SIGN2: Partial<Record<GameId, { x: number; y: number; w: number; text: string }>> = {
  janggi: { x: 0.515, y: 0.243, w: 0.2, text: "將" },
};

export interface CharArt {
  /** 테이블 자리별 앉은 SD (0 앞왼 · 1 뒤왼 · 2 뒤오 · 3 앞오) */
  seat?: string[];
  /** 마을 SD 프레임 애니메이션: 4프레임 가로 띠 (오른쪽 걷기 · 왼쪽 걷기 · 대기), 따로 그린 것 (반전 안 씀) */
  anim?: { walkR: string; walkL: string; idle: string };
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
  Object.values(ART.btn).forEach(push);
  Object.values(ART.game).forEach(push);
  push(ART.sky);
  push(ART.ground);
  push(ART.front);
  push(ART.room);
  push(ART.roomEmpty);
  push(ART.roomTable);
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
      l?.seat?.forEach(push);
      if (l?.anim) Object.values(l.anim).forEach(push);
      push(l?.face);
      Object.values(l?.bust ?? {}).forEach(push);
    }
  return out;
}

export const artUrl = (p: string) => `${B}/${p}`;
