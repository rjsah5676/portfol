/*
 * 올인 러브 — 그림 · 소리 목록. 주소만 채우면 화면에 바로 입혀짐 (null = 임시 모양)
 * 게임은 로딩 화면에서 전부 받은 뒤 시작 (진행률 막대)
 */
import type { BgId, BgmId, CgId, CharKey, EndingInfo, Face, Outfit, SfxId, Who } from "./types";
import { VOICE_BY_TEXT } from "./voices";

const B = "/love";
const P = "/poker";

/**
 * 스탠딩 (배경 없는 누끼). 표정 차분은 GPT 원본 그대로(기본 그림과 같은 크기 · 위치로만 맞춤) — 겹쳐서 갈아 끼움
 * 없는 표정은 base 로 대신함. 움직임은 나중에 중요한 장면만 라이브 영상으로
 */
export interface StandSet {
  base: string | null;
  faces: Partial<Record<Face, string>>;
  /** 평소 얼굴일 때 재생할 숨쉬기 라이브 루프 (투명 webm) — 있으면 그 얼굴 그림 대신 */
  live?: { face: Face; src: string };
}
const faces = (who: string, list: Face[]) =>
  Object.fromEntries(list.map((f) => [f, `${B}/char/${who}-${f}.webp`])) as Partial<
    Record<Face, string>
  >;
export const STAND: Record<CharKey, StandSet> = {
  yeonseo: {
    base: `${B}/char/yeonseo-base.webp`,
    faces: faces("yeonseo", ["away", "smile", "cold", "surprise", "sad", "blush", "cry", "laugh", "angry"]),
  },
  amy: {
    base: `${B}/char/amy-base.webp`,
    faces: faces("amy", ["smile", "pout", "surprise", "sad", "blush", "smug", "angry", "cry", "wink"]),
  },
  // 서브 캐릭터 — 표정은 기본 + 하나만
  boss: { base: `${B}/char/boss-base.webp`, faces: faces("boss", ["cold"]) },
  taeyang: { base: `${B}/char/taeyang-base.webp`, faces: faces("taeyang", ["smile"]) },
  jeongmin: { base: `${B}/char/jeongmin-base.webp`, faces: faces("jeongmin", ["smile"]) },
  chunhee: { base: `${B}/char/chunhee-base.webp`, faces: faces("chunhee", ["smile"]) },
};

/** 그림이 없는 표정일 때 대신 쓸 가까운 표정 (앞에서부터) — 연서엔 pout · smug, 에이미엔 away · cold 가 없어서 */
export const FACE_NEAR: Partial<Record<Face, Face[]>> = {
  cry: ["sad"],
  laugh: ["smile"],
  angry: ["cold", "pout", "sad"],
  wink: ["smug", "smile"],
  pout: ["away", "blush"],
  smug: ["smile"],
  away: ["sad", "cold"],
  cold: ["sad", "pout"],
  blush: ["smile"],
  sad: ["away"],
  surprise: [],
};

/**
 * 의상 차분 — 그림이 있는 것만 등록 (없으면 기본 옷으로 보임). 표정은 그 옷 그림에 있는 것만, 없는 표정은 그 옷의 base
 * 파일: char/<who>-<outfit>-base.webp · char/<who>-<outfit>-<face>.webp
 */
export const OUTFITS: Partial<Record<CharKey, Partial<Record<Outfit, StandSet>>>> = {
  amy: {
    tshirt: { base: `${B}/char/amy-tshirt-base.webp`, faces: faces("amy-tshirt", ["blush", "smile", "pout"]) },
  },
  yeonseo: {
    knit: { base: `${B}/char/yeonseo-knit-base.webp`, faces: faces("yeonseo-knit", ["away", "blush", "smile"]) },
    bare: { base: `${B}/char/yeonseo-bare-base.webp`, faces: faces("yeonseo-bare", ["away", "smile", "blush", "sad"]) },
  },
};

/** 배경 — 없으면 단색 그라데이션 */
export const BG: Record<BgId, string | null> = {
  pub: `${B}/bg/pub-night.webp`,
  alley: `${B}/bg/alley-rain.webp`,
  vip: `${B}/bg/vip.webp`,
  store: `${B}/bg/store.webp`,
  arcade: `${B}/bg/arcade.webp`,
  room: `${B}/bg/room.webp`,
  officetel: `${B}/bg/officetel.webp`,
  karaoke: `${B}/bg/karaoke.webp`,
  pocha: `${B}/bg/pocha.webp`,
  hangang: `${B}/bg/hangang.webp`,
  amyroom: `${B}/bg/amyroom.webp`,
  sea: `${B}/bg/sea.webp`,
  waterpark: `${B}/bg/waterpark.webp`,
  black: null,
};
export const BG_FALLBACK: Record<BgId, string> = {
  pub: "linear-gradient(180deg,#2a1d14,#120c08)",
  alley: "linear-gradient(180deg,#141a26,#06080d)",
  vip: "linear-gradient(180deg,#2a0d12,#080203)",
  store: "linear-gradient(180deg,#e9eef2,#b9c4cc)",
  arcade: "linear-gradient(180deg,#3a1f4a,#120a1c)",
  room: "linear-gradient(180deg,#3a3140,#18141c)",
  officetel: "linear-gradient(180deg,#2c3038,#121418)",
  karaoke: "linear-gradient(180deg,#3a1450,#12061c)",
  pocha: "linear-gradient(180deg,#4a2a12,#140a04)",
  hangang: "linear-gradient(180deg,#1a2440,#05070f)",
  amyroom: "linear-gradient(180deg,#3a3448,#16141c)",
  sea: "linear-gradient(180deg,#f2a86a,#2a4a6a)",
  waterpark: "linear-gradient(180deg,#8fd8ff,#2a8ac8)",
  black: "#000",
};

/** 이벤트 CG — 핵심 장면 한 장 그림 (회상 갤러리에도 모임) */
export const CG: Record<
  CgId,
  { src: string; title: string; who: "yeonseo" | "amy"; video?: string }
> = {
  y_closet: { src: `${B}/cg/y-closet.webp`, title: "비품 창고, 숨 쉬지 마요", who: "yeonseo" },
  y_umbrella: { src: `${B}/cg/y-umbrella.webp`, title: "그냥 비 오니까요", who: "yeonseo" },
  y_name: { src: `${B}/cg/y-name.webp`, title: "이름 하나, 올인보다", who: "yeonseo" },
  a_booth: { src: `${B}/cg/a-booth.webp`, title: "마지막 한 장", who: "amy" },
  a_door: { src: `${B}/cg/a-door.webp`, title: "왜 이렇게 따뜻해", who: "amy" },
  a_shoulder: { src: `${B}/cg/a-shoulder.webp`, title: "유료 어깨", who: "amy" },
  a_summer: { src: `${B}/cg/a-summer.webp`, title: "한여름의 에이미", who: "amy" },
  a_tshirt: { src: `${B}/cg/a-tshirt.webp`, title: "비 오는 날, 내 티셔츠", who: "amy" },
  a_morning: { src: `${B}/cg/a-morning.webp`, title: "트윈테일을 푼 아침", who: "amy" },
  y_summer: { src: `${B}/cg/y-summer.webp`, title: "한여름의 연서", who: "yeonseo" },
  y_glove: { src: `${B}/cg/y-glove.webp`, title: "장갑을 벗은 손", who: "yeonseo" },
  y_wall: { src: `${B}/cg/y-wall.webp`, title: "가지 마요", who: "yeonseo" },
  y_dawn: { src: `${B}/cg/y-dawn.webp`, title: "출근하기 싫은 새벽", who: "yeonseo" },
  end_amy_true: { src: `${B}/cg/end-amy-true.webp`, title: "ENDING · Your Side", who: "amy" },
  end_amy_good: {
    src: `${B}/cg/end-amy-good.webp`,
    title: "ENDING · 작은 방, 큰 침대",
    who: "amy",
  },
  end_yeon_true: { src: `${B}/cg/end-yeon-true.webp`, title: "ENDING · Tell", who: "yeonseo" },
  end_yeon_good: {
    src: `${B}/cg/end-yeon-good.webp`,
    title: "ENDING · 바닷가 마을",
    who: "yeonseo",
  },
  end_grand: { src: `${B}/cg/end-grand.webp`, title: "ENDING · All In", who: "amy" },
};
export const CG_ORDER: CgId[] = [
  "a_booth",
  "a_door",
  "a_shoulder",
  "a_summer",
  "a_tshirt",
  "a_morning",
  "end_amy_good",
  "end_amy_true",
  "y_closet",
  "y_umbrella",
  "y_name",
  "y_summer",
  "y_glove",
  "y_wall",
  "y_dawn",
  "end_yeon_good",
  "end_yeon_true",
  "end_grand",
];

/** 이름표 옆 동그란 얼굴 (카메오는 포커 프로필 재사용) */
export const FACE_ICON: Partial<Record<Who, string>> = {
  yeonseo: `${P}/char/yeonseo/profile.webp`,
  amy: `${P}/char/amy/profile.webp`,
  taeyang: `${P}/char/taeyang/profile.webp`,
  jeongmin: `${P}/char/jeongmin/profile.webp`,
  chunhee: `${B}/char/chunhee-icon.webp`,
  boss: `${B}/char/boss-icon.webp`,
};

export const NAME: Record<Who, string> = {
  yeonseo: "연서",
  amy: "에이미",
  boss: "백상현",
  me: "{name}",
  narr: "",
  taeyang: "태양",
  jeongmin: "정민",
  chunhee: "춘희 이모",
};
/** 이름표 색 */
export const NAME_COLOR: Record<Who, string> = {
  yeonseo: "#8fa8ff",
  amy: "#7fd3ff",
  boss: "#e0b46a",
  me: "#e8e2d4",
  narr: "#e8e2d4",
  taeyang: "#ffb36b",
  jeongmin: "#c7a8ff",
  chunhee: "#f0a8a0",
};

/** 효과음 — 칩 · 카드 · 징글은 포커 소리, 나머지는 미연시 전용(일레븐랩스 SFX, B 테이크는 .love-src/sfx-b) */
export const SFX: Record<SfxId, string> = {
  chip: `${P}/sound/sfx-chip-1.mp3`,
  deal: `${P}/sound/sfx-deal-1.mp3`,
  shuffle: `${P}/sound/sfx-shuffle.mp3`,
  click: `${P}/sound/sfx-press-ui.mp3`,
  win: `${P}/sound/jingle-win.mp3`,
  lose: `${P}/sound/jingle-lose.mp3`,
  phone: `${B}/sfx/phone.mp3`,
  heart: `${B}/sfx/heart.mp3`,
  stamp: `${P}/sound/sfx-stamp.mp3`,
  door: `${B}/sfx/door.mp3`,
  glass: `${B}/sfx/glass.mp3`,
  keypad: `${B}/sfx/keypad.mp3`,
  heels: `${B}/sfx/heels.mp3`,
  thunder: `${B}/sfx/thunder.mp3`,
  umbrella: `${B}/sfx/umbrella.mp3`,
  shutter: `${B}/sfx/shutter.mp3`,
  splash: `${B}/sfx/splash.mp3`,
  wave: `${B}/sfx/wave.mp3`,
  blackout: `${B}/sfx/blackout.mp3`,
  paper: `${B}/sfx/paper.mp3`,
  crane: `${B}/sfx/crane.mp3`,
};
/** 비 오는 골목 · 비 CG 동안 깔리는 빗소리 루프 */
export const RAIN_LOOP = `${B}/sfx/rain-loop.mp3`;
/** 포커 BGM 그대로(펍 감성) + 미연시 전용 BGM(Gemini 제작) */
export const BGM: Record<BgmId, string | null> = {
  pub: `${P}/sound/bgm-lobby1.mp3`,
  vip: `${P}/sound/bgm-vip.mp3`,
  night: `${P}/sound/bgm-lobby2.mp3`,
  allin: `${P}/sound/bgm-allin.mp3`,
  title: `${B}/sound/bgm-title.aac`,
  amy: `${B}/sound/bgm-amy.aac`,
  yeonseo: `${B}/sound/bgm-yeonseo.aac`,
  rain: `${B}/sound/bgm-rain.aac`,
  heart: `${B}/sound/bgm-heart.aac`,
  threat: `${B}/sound/bgm-threat.aac`,
  spoker: `${B}/sound/bgm-spoker.aac`,
  confide: `${B}/sound/bgm-confide.aac`,
  daily: `${B}/sound/bgm-daily.aac`,
  comic: `${B}/sound/bgm-comic.aac`,
  badend: `${B}/sound/bgm-badend.aac`,
  summer: `${B}/sound/bgm-summer.aac`,
  dawn: `${B}/sound/bgm-dawn.aac`,
  truth: `${B}/sound/bgm-truth.aac`,
  tilt: `${B}/sound/bgm-tilt.aac`,
  finale: `${B}/sound/bgm-finale.aac`,
  ending: `${B}/sound/bgm-ending.aac`,
};
/** 한 번만 재생하고 멈추는 곡 (엔딩 곡은 끝맺음이 있어서 반복 안 함) */
export const BGM_ONCE: BgmId[] = ["badend", "ending"];

export const CARD_BACK = `${P}/card/back-mid.webp`;

/** 타이틀 화면: 키아트(캐릭터 + 펍, UI 없음) · 로고(누끼) */
export const TITLE = { bg: `${B}/ui/title-bg.webp`, logo: `${B}/ui/title-logo.webp` };

/** 로딩 화면에서 전부 받는 목록 */
export function preloadList(): { img: string[]; audio: string[]; voice: string[] } {
  const img = new Set<string>();
  for (const c of [
    ...Object.values(STAND),
    ...Object.values(OUTFITS).flatMap((o) => Object.values(o ?? {})),
  ])
    for (const u of [c.base, ...Object.values(c.faces)]) if (u) img.add(u);
  for (const u of Object.values(BG)) if (u) img.add(u);
  for (const u of Object.values(FACE_ICON)) if (u) img.add(u);
  for (const c of Object.values(CG)) img.add(c.src);
  img.add(CARD_BACK);
  // 스토리 포커 J · Q · K 그림 (ANIME POKER 카드 그대로)
  for (const s of "shdc") for (const r of "jqk") img.add(`${P}/card/court-${s}-${r}.webp`);
  img.add(TITLE.bg);
  img.add(TITLE.logo);
  return {
    img: [...img],
    audio: [
      ...new Set([...Object.values(SFX), RAIN_LOOP, ...Object.values(BGM).filter((u): u is string => !!u)]),
    ],
    // 음성(600줄+ · 수십 MB)은 로딩 막대에 안 넣고 타이틀부터 뒤에서 차례로 받아 둠 — 아직 못 받은 줄은 그 자리에서 받아 재생
    voice: [...new Set(Object.values(VOICE_BY_TEXT))],
  };
}

/** 엔딩 18개 (M1 에서 실제로 볼 수 있는 건 fired · ghost · plain) */
export const ENDINGS: EndingInfo[] = [
  {
    id: "amy_true",
    no: 1,
    kind: "true",
    title: "Your Side",
    copy: "이기지 않아도, 네 편이면 돼.",
    hint: "에이미 · ???의 장부",
  },
  {
    id: "amy_good",
    no: 2,
    kind: "good",
    title: "작은 방, 큰 침대",
    copy: "판은 끝났다. 숙제는 남았다.",
    hint: "에이미 · 신뢰",
  },
  {
    id: "amy_friend",
    no: 3,
    kind: "normal",
    title: "딜러랑 단골",
    copy: "선은 안 넘었다. 그래서 오래 갔다.",
    hint: "에이미 · 한 걸음 덜",
  },
  {
    id: "amy_fall",
    no: 4,
    kind: "bad",
    title: "군번줄",
    copy: "나는 아빠랑 달라. …달랐어야 했는데.",
    hint: "에이미 · 도박욕",
    review: "rev_amy_fall",
  },
  {
    id: "amy_ruin",
    no: 5,
    kind: "bad",
    title: "둘이서 올인",
    copy: "같이 앉으면, 같이 무너진다.",
    hint: "에이미 · 틸트",
    review: "rev_amy_ruin",
  },
  {
    id: "yeon_true",
    no: 6,
    kind: "true",
    title: "Tell",
    copy: "처음 들은 웃음소리였다.",
    hint: "연서 · ???의 장부",
  },
  {
    id: "yeon_good",
    no: 7,
    kind: "good",
    title: "바닷가 마을",
    copy: "빚은 남았다. 장갑은 벗었다.",
    hint: "연서 · 도망",
  },
  {
    id: "yeon_sad",
    no: 8,
    kind: "normal",
    title: "다른 도시의 딜러",
    copy: "TV 속 그녀는 여전히 웃지 않았다.",
    hint: "연서 · 타이밍",
  },
  {
    id: "yeon_vanish",
    no: 9,
    kind: "bad",
    title: "빈자리",
    copy: "그 자리엔 다른 하우스 플레이어가 앉아 있었다.",
    hint: "연서 · 위험",
    review: "rev_yeon_vanish",
  },
  {
    id: "yeon_obsess",
    no: 10,
    kind: "bad",
    title: "다른 테이블엔 서지 마요",
    copy: "무표정한 사랑은 조용히 선을 넘는다.",
    hint: "연서 · 독점",
    review: "rev_yeon_obsess",
  },
  {
    id: "grand",
    no: 11,
    kind: "true",
    title: "All In",
    copy: "셋이 앉은 마지막 판.",
    hint: "두 개의 진실",
  },
  {
    id: "plain",
    no: 12,
    kind: "normal",
    title: "평범한 알바생",
    copy: "아무 일도 일어나지 않았다. 아무 일도.",
    hint: "아무도 고르지 않기",
    review: "rev_plain",
  },
  {
    id: "dealer",
    no: 13,
    kind: "bad",
    title: "하우스 딜러",
    copy: "돈은 많아졌다. 단골은 사라졌다.",
    hint: "사장의 제안",
    review: "rev_dealer",
  },
  {
    id: "me_fall",
    no: 14,
    kind: "bad",
    title: "손",
    copy: "3년 만에 앉은 자리는 너무 편했다.",
    hint: "틸트",
    review: "rev_me_fall",
  },
  {
    id: "clash",
    no: 15,
    kind: "bad",
    title: "수라장",
    copy: "둘 다 놓지 않으려다, 둘 다 놓쳤다.",
    hint: "둘 다",
    review: "rev_clash",
  },
  {
    id: "fired",
    no: 16,
    kind: "bad",
    title: "손이 굳었다",
    copy: "전설의 손, 수습 딱지도 못 떼다.",
    hint: "근무 중에 두 번 앉기",
    review: "rev_fired",
  },
  {
    id: "ghost",
    no: 17,
    kind: "bad",
    title: "읽씹",
    copy: "답장은 끝내 오지 않았다. 내가 안 했으니까.",
    hint: "메시지 세 번 무시",
    review: "rev_ghost",
  },
  {
    id: "data0",
    no: 18,
    kind: "hidden",
    title: "Data 0",
    copy: "너 없이도 이길 수 있어.",
    hint: "???",
  },
];
