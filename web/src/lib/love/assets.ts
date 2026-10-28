/*
 * 올인 러브 — 그림 · 소리 목록. 주소만 채우면 화면에 바로 입혀짐 (null = 임시 모양)
 * 게임은 로딩 화면에서 전부 받은 뒤 시작 (진행률 막대)
 */
import type { BgId, BgmId, CgId, CharKey, EndingId, EndingInfo, Face, Outfit, SfxId, Who } from "./types";
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
  /** 세라 — 기본 = 웃는 얼굴. 표정은 얼굴 시트 두 장을 기본 몸에 맞춰 붙인 것 (empty = 얀데레 눈은 3주차부터) */
  sera: {
    base: `${B}/char/sera-base.webp`,
    faces: faces("sera", ["smile", "laugh", "smug", "pout", "surprise", "blush", "sad", "cry", "cold", "angry", "empty", "heart"]),
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
  empty: ["cold", "sad"],
  heart: ["blush", "smile"],
};

/**
 * 의상 차분 — 그림이 있는 것만 등록 (없으면 기본 옷으로 보임). 표정은 그 옷 그림에 있는 것만, 없는 표정은 그 옷의 base
 * 파일: char/<who>-<outfit>-base.webp · char/<who>-<outfit>-<face>.webp
 */
export const OUTFITS: Partial<Record<CharKey, Partial<Record<Outfit, StandSet>>>> = {
  amy: {
    tshirt: { base: `${B}/char/amy-tshirt-base.webp`, faces: faces("amy-tshirt", ["pout", "blush", "smile", "sad", "smug", "surprise"]) },
    store: {
      base: `${B}/char/amy-store-base.webp`,
      faces: faces("amy-store", ["smile", "pout", "smug", "surprise", "sad", "blush", "wink"]),
    },
    swim: { base: `${B}/char/amy-swim-base.webp`, faces: faces("amy-swim", ["smile", "pout", "blush", "smug"]) },
    home: { base: `${B}/char/amy-home-base.webp`, faces: faces("amy-home", ["surprise", "blush", "pout", "sad", "smile", "smug"]) },
  },
  sera: {
    casual: {
      base: `${B}/char/sera-casual-base.webp`,
      faces: faces("sera-casual", ["smile", "laugh", "smug", "pout", "surprise", "blush", "sad", "cry", "cold", "angry", "empty", "heart"]),
    },
  },
  yeonseo: {
    knit: { base: `${B}/char/yeonseo-knit-base.webp`, faces: faces("yeonseo-knit", ["away", "blush", "smile", "sad", "surprise"]) },
    bare: { base: `${B}/char/yeonseo-bare-base.webp`, faces: faces("yeonseo-bare", ["away", "smile", "blush", "sad", "laugh", "cry", "cold", "surprise", "angry"]) },
    summer: { base: `${B}/char/yeonseo-summer-base.webp`, faces: faces("yeonseo-summer", ["smile", "blush", "surprise", "laugh"]) },
    summerbare: { base: `${B}/char/yeonseo-summerbare-base.webp`, faces: faces("yeonseo-summerbare", ["smile", "blush", "surprise", "laugh"]) },
    dress: { base: `${B}/char/yeonseo-dress-base.webp`, faces: faces("yeonseo-dress", ["cold", "away", "sad", "blush"]) },
  },
};

/** 배경 — 없으면 단색 그라데이션 */
export const BG: Record<BgId, string | null> = {
  pub: `${B}/bg/pub-night.webp`,
  alley: `${B}/bg/alley-rain.webp`,
  alley_after: `${B}/bg/alley-morning.webp`,
  alley_night: `${B}/bg/alley-night.webp`,
  market: `${B}/bg/market.webp`,
  vip: `${B}/bg/vip.webp`,
  store: `${B}/bg/store.webp`,
  arcade: `${B}/bg/arcade.webp`,
  room: `${B}/bg/room.webp`,
  room_day: `${B}/bg/room-day.webp`,
  room_night: `${B}/bg/room-night.webp`,
  officetel: `${B}/bg/officetel.webp`,
  karaoke: `${B}/bg/karaoke.webp`,
  pocha: `${B}/bg/pocha.webp`,
  hangang: `${B}/bg/hangang.webp`,
  amyroom: `${B}/bg/amyroom.webp`,
  sea: `${B}/bg/sea.webp`,
  waterpark: `${B}/bg/waterpark.webp`,
  market_day: `${B}/bg/market_day.webp`,
  /** 세라 집 — 전용 배경(bg-sera-room) 오기 전까지 오피스텔 그림 임시 */
  sera_room: `${B}/bg/sera-room.webp`,
  pub_pink: `${B}/bg/pub-pink.webp`,
  black: null,
};
/**
 * 작은 그림 아이콘 (주머니 물건 · 혼자 하는 준비 카드) — 파일이 아직 없으면 화면은 이모지로 대신 보여 줌
 * (LoveApp 의 SmallIcon 이 그림을 불러 보고, 실패하면 이모지) → 그림은 public/love/ui/ 에 이 이름으로 넣기만 하면 켜짐
 * 요청서: dep86-schedule/ASSET-REQUEST.md
 */
export const ICON: Record<
  "itemStraw" | "itemMint" | "cardNote" | "cardWalk" | "cardShuffle" | "cardImo" | "cardTool" | "cardRest",
  { src: string; emoji: string; name: string }
> = {
  itemStraw: { src: `${B}/ui/item-strawberry-candy.webp`, emoji: "🍬", name: "딸기 사탕" },
  itemMint: { src: `${B}/ui/item-mint-candy.webp`, emoji: "🍥", name: "박하사탕" },
  cardNote: { src: `${B}/ui/card-note.webp`, emoji: "✎", name: "노트 정리" },
  cardWalk: { src: `${B}/ui/card-walk.webp`, emoji: "🍬", name: "동네 한 바퀴" },
  cardShuffle: { src: `${B}/ui/card-shuffle.webp`, emoji: "🂡", name: "셔플 · 복기" },
  cardImo: { src: `${B}/ui/card-imo.webp`, emoji: "🍲", name: "이모 장보기 · 주방" },
  cardTool: { src: `${B}/ui/card-tool.webp`, emoji: "🔧", name: "철물점" },
  cardRest: { src: `${B}/ui/card-rest.webp`, emoji: "🛏", name: "한숨 자기" },
};
export type IconId = keyof typeof ICON;
export const ITEMS = ["itemStraw", "itemMint"] as const;
/** 일정 카드 장면 id → 그림 아이콘 (그림이 없으면 카드의 원래 이모지) */
const PLAN_ICON: Record<string, IconId> = {
  go_shuffle: "cardShuffle",
  w2_shuf: "cardShuffle",
  a3_p2_shuf: "cardShuffle",
  y3_p17_shuf: "cardShuffle",
  a4_p4_river: "cardShuffle",
  y4_p23_shuf: "cardShuffle",
  g4c_eye: "cardShuffle",
  go_imo: "cardImo",
  w2_imo: "cardImo",
  a4_p3_imo: "cardImo",
  y3_p17_imo: "cardImo",
  y4_p23_imo: "cardImo",
  g4c_imo: "cardImo",
  a3_p1_tool: "cardTool",
  g4c_nap: "cardRest",
};
export const planIcon = (scene: string): IconId | null =>
  /_note$/.test(scene) ? "cardNote" : /_walk$/.test(scene) ? "cardWalk" : (PLAN_ICON[scene] ?? null);
/** 배경 그림이 아직 없을 때 대신 깔 배경 (CSS 여러 겹: 새 그림이 있으면 위에 덮임) */
const BG_ALT: Partial<Record<BgId, BgId>> = { market_day: "market" };
/** 배경 CSS backgroundImage 값 (없으면 null → 그라데이션) */
export const bgImage = (id: BgId): string | null => {
  const u = BG[id];
  if (!u) return null;
  const alt = BG_ALT[id] ? BG[BG_ALT[id]!] : null;
  return alt ? `url("${u}"), url("${alt}")` : `url("${u}")`;
};

export const BG_FALLBACK: Record<BgId, string> = {
  pub: "linear-gradient(180deg,#2a1d14,#120c08)",
  alley: "linear-gradient(180deg,#141a26,#06080d)",
  alley_after: "linear-gradient(180deg,#f2d6a8,#6a7c90)",
  alley_night: "linear-gradient(180deg,#1a1d2e,#08090f)",
  market: "linear-gradient(180deg,#3a3026,#14100c)",
  vip: "linear-gradient(180deg,#2a0d12,#080203)",
  store: "linear-gradient(180deg,#e9eef2,#b9c4cc)",
  arcade: "linear-gradient(180deg,#3a1f4a,#120a1c)",
  room: "linear-gradient(180deg,#3a3140,#18141c)",
  room_day: "linear-gradient(180deg,#9fb8d8,#d9c9b0)",
  room_night: "linear-gradient(180deg,#1a1f3a,#0c0e18)",
  officetel: "linear-gradient(180deg,#2c3038,#121418)",
  sera_room: "linear-gradient(180deg,#3a2232,#140a12)",
  pub_pink: "linear-gradient(180deg,#4a1a3a,#12060e)",
  karaoke: "linear-gradient(180deg,#3a1450,#12061c)",
  pocha: "linear-gradient(180deg,#4a2a12,#140a04)",
  hangang: "linear-gradient(180deg,#1a2440,#05070f)",
  amyroom: "linear-gradient(180deg,#3a3448,#16141c)",
  sea: "linear-gradient(180deg,#f2a86a,#2a4a6a)",
  waterpark: "linear-gradient(180deg,#8fd8ff,#2a8ac8)",
  market_day: "linear-gradient(180deg,#c9bfae,#5a5246)",
  black: "#000",
};

/** 이벤트 CG — 핵심 장면 한 장 그림 (회상 갤러리에도 모임) */
export const CG: Record<
  CgId,
  {
    src: string;
    title: string;
    who: "yeonseo" | "amy" | "sera";
    video?: string;
    /** 차분 — { 이름: 그림 } (같은 구도에서 표정 · 상태만 다른 그림). 대본: { t: "cgv", v: 이름 } */
    vars?: Record<string, string>;
    /** 그림이 아직 없음 — 대본의 이 CG 는 건너뜀 (그림 넣고 이 줄만 지우면 켜짐) */
    pending?: boolean;
    /** 머리가 그림 위 끝에 닿는 CG — 위쪽 시네마 띠를 빼고 확대 연출을 아래 기준으로 (머리 안 잘리게) */
    tight?: boolean;
  }
> = {
  y_closet: { src: `${B}/cg/y-closet.webp`, title: "비품 창고, 숨 쉬지 마요", who: "yeonseo", video: `${B}/cg/y-closet.mp4`, vars: { blush: `${B}/cg/y-closet-blush.webp` } },
  y_umbrella: { src: `${B}/cg/y-umbrella.webp`, title: "그냥 비 오니까요", who: "yeonseo", video: `${B}/cg/y-umbrella.mp4`, vars: { smile: `${B}/cg/y-umbrella-smile.webp` } },
  y_name: { src: `${B}/cg/y-name.webp`, title: "이름 하나, 올인보다", who: "yeonseo", video: `${B}/cg/y-name.mp4`, vars: { away: `${B}/cg/y-name-away.webp`, smile: `${B}/cg/y-name-smile.webp` } },
  a_booth: { src: `${B}/cg/a-booth.webp`, title: "마지막 한 장", who: "amy", vars: { blush: `${B}/cg/a-booth-blush.webp` } },
  a_door: {
    src: `${B}/cg/a-door.webp`,
    title: "왜 이렇게 따뜻해",
    who: "amy",
    video: `${B}/cg/a-door.mp4`,
    vars: { close: `${B}/cg/a-door-close.webp` },
  },
  a_shoulder: { src: `${B}/cg/a-shoulder.webp`, title: "유료 어깨", who: "amy", vars: { close: `${B}/cg/a-shoulder-close.webp` } },
  a_summer: { src: `${B}/cg/a-summer.webp`, title: "한여름의 에이미", who: "amy", video: `${B}/cg/a-summer.mp4`, vars: { blush: `${B}/cg/a-summer-blush.webp` } },
  a_tshirt: { src: `${B}/cg/a-tshirt.webp`, title: "비 오는 날, 내 티셔츠", who: "amy", video: `${B}/cg/a-tshirt.mp4`, vars: { pout: `${B}/cg/a-tshirt-pout.webp`, blush: `${B}/cg/a-tshirt-blush.webp` } },
  a_morning: { src: `${B}/cg/a-morning.webp`, title: "트윈테일을 푼 아침", who: "amy", video: `${B}/cg/a-morning.mp4`, vars: { smile: `${B}/cg/a-morning-smile.webp` } },
  y_summer: { src: `${B}/cg/y-summer.webp`, title: "한여름의 연서", who: "yeonseo", video: `${B}/cg/y-summer.mp4`, vars: { blush: `${B}/cg/y-summer-blush.webp` } },
  y_glove: { src: `${B}/cg/y-glove.webp`, title: "장갑을 벗은 손", who: "yeonseo" },
  y_wall: { src: `${B}/cg/y-wall.webp`, title: "가지 마요", who: "yeonseo", video: `${B}/cg/y-wall.mp4`, vars: { cry: `${B}/cg/y-wall-cry.webp` } },
  y_kiss: { src: `${B}/cg/y-kiss.webp`, title: "현관 불이 켜지기 전에", who: "yeonseo", tight: true, video: `${B}/cg/y-kiss.mp4`, vars: { kiss: `${B}/cg/y-kiss-kiss.webp`, after: `${B}/cg/y-kiss-after.webp` } },
  y_dawn: { src: `${B}/cg/y-dawn.webp`, title: "출근하기 싫은 새벽", who: "yeonseo", video: `${B}/cg/y-dawn.mp4`, vars: { smile: `${B}/cg/y-dawn-smile.webp` } },
  end_amy_true: { src: `${B}/cg/end-amy-true.webp`, title: "ENDING · Your Side", who: "amy", video: `${B}/cg/end-amy-true.mp4`, vars: { smile: `${B}/cg/end-amy-true-smile.webp` } },
  end_amy_good: {
    src: `${B}/cg/end-amy-good.webp`,
    video: `${B}/cg/end-amy-good.mp4`,
    vars: { blush: `${B}/cg/end-amy-good-blush.webp` },
    title: "ENDING · 작은 방, 큰 침대",
    who: "amy",
  },
  end_yeon_true: { src: `${B}/cg/end-yeon-true.webp`, title: "ENDING · Tell", who: "yeonseo", video: `${B}/cg/end-yeon-true.mp4`, vars: { laugh: `${B}/cg/end-yeon-true-laugh.webp` } },
  end_yeon_good: { src: `${B}/cg/end-yeon-good.webp`, title: "ENDING · 바닷가 마을", who: "yeonseo", video: `${B}/cg/end-yeon-good.mp4`, vars: { smile: `${B}/cg/end-yeon-good-smile.webp` } },
  end_grand: { src: `${B}/cg/end-grand.webp`, title: "ENDING · All In", who: "amy", video: `${B}/cg/end-grand.mp4`, vars: { laugh: `${B}/cg/end-grand-laugh.webp` } },
  // ---- CG 확장 (claude/2026-10-24-love-cg-expansion-plan.md) — 그림 오면 pending 지우고 vars 채우기 ----
  a_hand: { src: `${B}/cg/a-hand.webp`, title: "소매에서 손가락까지", who: "amy", video: `${B}/cg/a-hand.mp4` },
  a_cry: { src: `${B}/cg/a-cry.webp`, title: "숫자 웃기다", who: "amy", vars: { cry: `${B}/cg/a-cry-cry.webp` } },
  a_kiss: {
    src: `${B}/cg/a-kiss.webp`,
    title: "사실은, 처음이야",
    who: "amy",
    tight: true,
    video: `${B}/cg/a-kiss.mp4`,
    vars: { kiss: `${B}/cg/a-kiss-kiss.webp`, after: `${B}/cg/a-kiss-after.webp` },
  },
  y_door: { src: `${B}/cg/y-door.webp`, title: "손바닥 하나만큼", who: "yeonseo", vars: { blush: `${B}/cg/y-door-blush.webp` } },
  // ---- v4 세라 ----
  past: { src: `${B}/cg/past.webp`, title: "3년 전, 왼손 두 번", who: "sera", vars: { fold: `${B}/cg/past-fold.webp` } },
  s_open: { src: `${B}/cg/s-open.webp`, title: "저 이거예요", who: "sera", tight: true },
  s_keypad: { src: `${B}/cg/s-keypad.webp`, title: "보지도 않고 네 자리", who: "sera" },
  s_choker: { src: `${B}/cg/s-choker.webp`, title: "이거 잠그면, 저 접을게요", who: "sera" },
  s_kiss: { src: `${B}/cg/s-kiss.webp`, title: "이건 판 아니니까", who: "sera", tight: true, vars: { after: `${B}/cg/s-kiss-after.webp` } },
  s_fold: { src: `${B}/cg/s-fold.webp`, title: "처음 접는 손", who: "sera" },
  end_sera_true: { src: `${B}/cg/end-s-true.webp`, title: "ENDING · 접는 날", who: "sera" },
  end_sera_good: { src: `${B}/cg/end-s-good.webp`, title: "ENDING · 컵라면 하나", who: "sera" },
  end_sera_lock: { src: `${B}/cg/end-s-lock.webp`, title: "ENDING · 하트 자물쇠", who: "sera" },
  s_note: { src: `${B}/cg/s-note.webp`, title: "첫 장은 딜러님이 봐요", who: "sera", tight: true },
  y_win: { src: `${B}/cg/y-win.webp`, title: "제일 맛있는 물", who: "yeonseo", video: `${B}/cg/y-win.mp4`, vars: { smile: `${B}/cg/y-win-smile.webp`, water: `${B}/cg/y-win-water.webp` } },
};
/** CG 히로인 표시 (갤러리 · CG 제목 무늬와 색) */
export const CG_SUIT = { amy: "♥", yeonseo: "♠", sera: "♥" } as const;
export const CG_TONE = { amy: "#7fd3ff", yeonseo: "#8fa8ff", sera: "#ff8cc0" } as const;
/** CG 차분 그림 주소 (없는 이름이면 원본) */
export const cgSrc = (id: CgId, v?: string | null) => (v && CG[id].vars?.[v]) || CG[id].src;
/** 갤러리 · 본 장면 기록용 키 ("a_kiss" / "a_kiss~close") */
export const cgKey = (id: CgId, v?: string | null) => (v ? `${id}~${v}` : id);

export const CG_ORDER: CgId[] = (
  [
  "a_booth",
  "a_door",
  "a_shoulder",
  "a_tshirt",
  "a_hand",
  "a_summer",
  "a_cry",
  "a_kiss",
  "a_morning",
  "end_amy_good",
  "end_amy_true",
  "y_closet",
  "y_umbrella",
  "y_door",
  "y_name",
  "y_wall",
  "y_glove",
  "y_summer",
  "y_kiss",
  "y_dawn",
  "y_win",
  "end_yeon_good",
  "end_yeon_true",
  "past",
  "s_open",
  "s_keypad",
  "s_note",
  "s_choker",
  "s_kiss",
  "s_fold",
  "end_sera_good",
  "end_sera_lock",
  "end_sera_true",
  "end_grand",
  ] as CgId[]
).filter((id) => !CG[id].pending);

/** 이름표 옆 동그란 얼굴 (카메오는 포커 프로필 재사용) */
export const FACE_ICON: Partial<Record<Who, string>> = {
  // 새 스탠딩에서 얼굴만 잘라 만든 아이콘 (폰 · 일정 카드 · 관계 화면). 대사창 초상은 PORTRAIT 로 표정까지 따라감
  yeonseo: `${B}/char/yeonseo-icon.webp`,
  amy: `${B}/char/amy-icon.webp`,
  sera: `${B}/char/sera-icon.webp`,
  taeyang: `${B}/char/taeyang-icon.webp`,
  jeongmin: `${B}/char/jeongmin-icon.webp`,
  chunhee: `${B}/char/chunhee-icon.webp`,
  boss: `${B}/char/boss-icon.webp`,
};

export const NAME: Record<Who, string> = {
  yeonseo: "연서",
  amy: "에이미",
  sera: "세라",
  boss: "백상현",
  me: "{name}",
  narr: "",
  taeyang: "태양",
  jeongmin: "정민",
  chunhee: "춘희 이모",
};
/** 이름표 색 */
/** 대사창 초상 카드: 스탠딩 그림에서 얼굴만 잘라 보여 줌 — [가로/세로 비, 얼굴 중심 x, 얼굴 중심 y, 자를 정사각형 한 변] (그림 높이 대비).
 *  표정 그림은 같은 캔버스라 같은 값. 의상은 캔버스가 달라 따로 (없으면 기본 옷 값) */
export const PORTRAIT: Record<string, [number, number, number, number]> = {
  "amy": [0.3724, 0.4849, 0.105, 0.1305],
  "sera": [0.3459, 0.5158, 0.108, 0.128],
  "sera-casual": [0.3446, 0.5156, 0.1151, 0.1285],
  "amy-store": [0.3377, 0.4689, 0.1211, 0.0965],
  "amy-tshirt": [0.2839, 0.5035, 0.1168, 0.0977],
  "boss": [0.3403, 0.414, 0.0859, 0.1257],
  "chunhee": [0.4167, 0.4238, 0.1059, 0.1212],
  "jeongmin": [0.3099, 0.4321, 0.0855, 0.0879],
  "taeyang": [0.3255, 0.4257, 0.0806, 0.0979],
  "yeonseo-bare": [0.2587, 0.4308, 0.1095, 0.0918],
  "yeonseo": [0.2578, 0.4304, 0.1094, 0.0915],
  "amy-swim": [0.2925, 0.482, 0.126, 0.1278],
  "amy-home": [0.2812, 0.5545, 0.1273, 0.1201],
  "yeonseo-summer": [0.2873, 0.5199, 0.1175, 0.0895],
  "yeonseo-summerbare": [0.2873, 0.5199, 0.1175, 0.0895],
  "yeonseo-dress": [0.2439, 0.5171, 0.1055, 0.0915],
  "yeonseo-knit": [0.2431, 0.5605, 0.1016, 0.1062],
};
/** 이름표 무늬 (트럼프 문양) */
export const SUIT: Record<Who, string> = {
  amy: "♥",
  yeonseo: "♠",
  sera: "♥",
  me: "♣",
  narr: "",
  boss: "♦",
  taeyang: "♦",
  jeongmin: "♣",
  chunhee: "♥",
};

export const NAME_COLOR: Record<Who, string> = {
  yeonseo: "#8fa8ff",
  amy: "#7fd3ff",
  sera: "#ff8cc0",
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
  tap2: `${B}/sfx/tap2.mp3`,
  padlock: `${B}/sfx/padlock.mp3`,
  seraMsg: `${B}/sfx/sera-msg.mp3`,
  cardCatch: `${B}/sfx/card-catch.mp3`,
  heels: `${B}/sfx/heels.mp3`,
  thunder: `${B}/sfx/thunder.mp3`,
  umbrella: `${B}/sfx/umbrella.mp3`,
  shutter: `${B}/sfx/shutter.mp3`,
  splash: `${B}/sfx/splash.mp3`,
  wave: `${B}/sfx/wave.mp3`,
  blackout: `${B}/sfx/blackout.mp3`,
  paper: `${B}/sfx/paper.mp3`,
  crane: `${B}/sfx/crane.mp3`,
  chime: `${B}/sfx/chime.mp3`,
  scan: `${B}/sfx/scan.mp3`,
  boil: `${B}/sfx/boil.mp3`,
  siren: `${B}/sfx/siren.mp3`,
  train: `${B}/sfx/train.mp3`,
  steps: `${B}/sfx/steps.mp3`,
  pen: `${B}/sfx/pen.mp3`,
  candy: `${B}/sfx/candy.mp3`,
  clap: `${B}/sfx/clap.mp3`,
  cardflip: `${B}/sfx/cardflip.mp3`,
  allin: `${B}/sfx/allin.mp3`,
  potwin: `${B}/sfx/potwin.mp3`,
  fold: `${B}/sfx/fold.mp3`,
  knock: `${B}/sfx/knock.mp3`,
  buzz: `${B}/sfx/buzz.mp3`,
  send: `${B}/sfx/send.mp3`,
  pencil: `${B}/sfx/pencil.mp3`,
  chair: `${B}/sfx/chair.mp3`,
  chair2: `${B}/sfx/chair2.mp3`,
  tags: `${B}/sfx/tags.mp3`,
  can: `${B}/sfx/can.mp3`,
  keys: `${B}/sfx/keys.mp3`,
  doorbell: `${B}/sfx/doorbell.mp3`,
  microwave: `${B}/sfx/microwave.mp3`,
  chain: `${B}/sfx/chain.mp3`,
  tape: `${B}/sfx/tape.mp3`,
  sizzle: `${B}/sfx/sizzle.mp3`,
  tick: `${B}/sfx/tick.mp3`,
  hover: `${B}/sfx/hover.mp3`,
  select: `${B}/sfx/select.mp3`,
  save: `${B}/sfx/save.mp3`,
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
  amy_ace: `${B}/sound/bgm-amy-ace.aac`,
  sera: `${B}/sound/bgm-sera.aac`,
  sera_pink: `${B}/sound/bgm-sera-pink.aac`,
  sera_dark: `${B}/sound/bgm-sera-dark.aac`,
  yeon_ace: `${B}/sound/bgm-yeon-ace.aac`,
  credits: `${B}/sound/bgm-credits.aac`,
  morning: `${B}/sound/bgm-morning.aac`,
};
/** 한 번만 재생하고 멈추는 곡 (엔딩 곡은 끝맺음이 있어서 반복 안 함) */
export const BGM_ONCE: BgmId[] = ["badend", "ending", "credits"];

export const CARD_BACK = `${P}/card/back-mid.webp`;

/** 타이틀 화면: 키아트(캐릭터 + 펍, UI 없음) · 로고(누끼) */
export const TITLE = { bg: `${B}/ui/title-bg.webp`, logo: `${B}/ui/title-logo.webp` };
/** 엔딩을 깨면 열리는 타이틀 (그림 · 곡). bg 가 null 이면 그림은 아직 없음 → 기본 그림 + 곡만 바뀜 */
export const TITLE_ALT: Record<"amy" | "yeon" | "grand", { end: EndingId; bg: string | null; bgm: BgmId; label: string }> = {
  amy: { end: "amy_true", bg: `${B}/ui/title-amy.webp`, bgm: "amy_ace", label: "에이미" },
  yeon: { end: "yeon_true", bg: `${B}/ui/title-yeon.webp`, bgm: "yeon_ace", label: "연서" },
  grand: { end: "grand", bg: `${B}/ui/title-grand.webp`, bgm: "morning", label: "그랜드" },
};

/** 로딩 화면에서 전부 받는 목록 */
export function preloadList(): { img: string[]; audio: string[]; voice: string[] } {
  const img = new Set<string>();
  const vid = new Set<string>();
  for (const c of [
    ...Object.values(STAND),
    ...Object.values(OUTFITS).flatMap((o) => Object.values(o ?? {})),
  ])
    for (const u of [c.base, ...Object.values(c.faces)]) if (u) img.add(u);
  for (const u of Object.values(BG)) if (u) img.add(u);
  for (const u of Object.values(FACE_ICON)) if (u) img.add(u);
  for (const c of Object.values(CG)) {
    if (c.pending) continue;
    img.add(c.src);
    for (const v of Object.values(c.vars ?? {})) img.add(v);
    if (c.video) vid.add(c.video);
  }
  img.add(CARD_BACK);
  // 스토리 포커 J · Q · K 그림 (ANIME POKER 카드 그대로)
  for (const s of "shdc") for (const r of "jqk") img.add(`${P}/card/court-${s}-${r}.webp`);
  img.add(TITLE.bg);
  img.add(TITLE.logo);
  for (const c of Object.values(ICON)) img.add(c.src);
  return {
    img: [...img],
    audio: [
      ...new Set([
        ...Object.values(SFX),
        RAIN_LOOP,
        ...Object.values(BGM).filter((u): u is string => !!u),
        // 살아 있는 CG 영상도 로딩 때 받아 둠 (fetch → HTTP 캐시)
        ...vid,
      ]),
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
    id: "grand",
    no: 11,
    kind: "true",
    title: "All In",
    copy: "넷이 앉은 판, 셋이 본 아침.",
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
    id: "sera_true",
    no: 18,
    kind: "true",
    title: "접는 날",
    copy: "이번엔 끝나는 게 아니라, 사는 거예요.",
    hint: "세라 · 알고서 두드린 손",
  },
  {
    id: "sera_good",
    no: 19,
    kind: "good",
    title: "컵라면 하나",
    copy: "딜러님 판에서만 접으면 되죠, 지금은.",
    hint: "세라 · 같이",
  },
  {
    id: "sera_lock",
    no: 20,
    kind: "bad",
    title: "하트 자물쇠",
    copy: "행복하다. 3년 동안 이거 하나 기다렸어요.",
    hint: "세라 · 딸깍",
    review: "rev_sera_lock",
  },
  {
    id: "sera_read",
    no: 21,
    kind: "bad",
    title: "답장이 없어서 왔어요",
    copy: "이제 안 읽어도 되잖아요.",
    hint: "세라 · 숫자 1",
    review: "rev_sera_read",
  },
  {
    id: "data0",
    no: 22,
    kind: "hidden",
    title: "Data 0",
    copy: "너 없이도 이길 수 있어.",
    hint: "???",
  },
];

/** 문자 속 사진: "[사진] 설명" 의 설명 → 이미지. 파일이 없으면 폰이 자리표시(📷)로 대신 보여 줌 */
export const PHOTO: Record<string, string> = {
  "박스 안에서 자는 회색 고양이": `${B}/photo/cat.webp`,
  "책상 위 하늘색 곰": `${B}/photo/bear.webp`,
  "계산대 옆에 세워 둔 바나나우유 하나": `${B}/photo/milk.webp`,
  "어두운 계단, 문 아래로 새어 나오는 불빛": `${B}/photo/stairs.webp`,
  "젖은 골목 위로 파란 하늘": `${B}/photo/sky.webp`,
  "장판 걷은 시멘트 바닥 위에 깐 돗자리": `${B}/photo/mat.webp`,
};
