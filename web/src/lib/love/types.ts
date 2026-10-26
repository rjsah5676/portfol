/*
 * 올인 러브 (가제) — ANIME POKER 외전 미연시 · 대본 데이터 형식
 * 대본은 전부 직렬화 가능한 데이터 (함수 없음) → 세이브에 그대로 저장 가능
 */

export type CharKey = "yeonseo" | "amy" | "boss" | "taeyang" | "jeongmin" | "chunhee";
/** 서브 캐릭터: 말할 때 자동으로 옆자리에 작게 나왔다가, 몇 줄 안 말하면 들어감 */
export const SUBS: readonly CharKey[] = ["taeyang", "jeongmin", "chunhee", "boss"];
/** 말하는 사람: 스탠딩 있는 캐릭터 + 주인공(me) + 나레이션(narr) */
export type Who = CharKey | "me" | "narr";
/** 감정별 대사창: 귓속말 · 흔들림 · 외침 · 대사창 없이(고백 직전 등) · 속마음 · 두근(분홍 맥박) */
export type Mood = "normal" | "whisper" | "shake" | "shout" | "bare" | "think" | "heart";
export const MOODS: readonly Mood[] = [
  "normal",
  "whisper",
  "shake",
  "shout",
  "bare",
  "think",
  "heart",
];
/**
 * 표정 (얼굴만 바뀐 스탠딩). base = 정면 무표정, away = 시선 피함(연서 평소)
 * 연서: away smile cold surprise sad blush cry laugh angry / 에이미: smile pout surprise sad blush smug cry angry wink
 * (cry = 눈물 · laugh = 소리 내 웃음 · angry = 정말 화남 · wink = 장난)
 */
export type Face =
  | "base"
  | "away"
  | "smile"
  | "cold"
  | "surprise"
  | "sad"
  | "blush"
  | "pout"
  | "smug"
  | "cry"
  | "laugh"
  | "angry"
  | "wink";
export type Pos = "l" | "c" | "r";
/** 스탠딩 의상: 에이미 tshirt(내 티셔츠) · 연서 knit(오피스텔 안경 니트) · bare(장갑 벗은 근무복) */
/** store = 편의점 조끼(안에 연회색 큰 티) · down = 머리 푼 티셔츠 · swim = 수영복 · knitbare = 니트 맨손 · summer = 여름 원피스 */
export type Outfit = "default" | "tshirt" | "knit" | "bare" | "store" | "down" | "swim" | "knitbare" | "summer" | "summerbare" | "home" | "dress";
/** 거리 3단계: 0 평소(허벅지까지) · 1 상반신 · 2 얼굴 클로즈업 */
export type Dist = 0 | 1 | 2;
export type BgId =
  | "pub"
  | "alley"
  /** 비 그친 아침 골목 (빗소리 · 빗줄기 없음) */
  | "alley_after"
  /** 비 안 오는 밤 골목 */
  | "alley_night"
  /** 재래시장 (비) */
  | "market"
  | "room_day"
  | "room_night"
  | "vip"
  | "store"
  | "arcade"
  | "room"
  | "officetel"
  | "karaoke"
  | "pocha"
  | "hangang"
  | "amyroom"
  | "sea"
  | "waterpark"
  | "black";
/** 이벤트 CG (핵심 장면 한 장 그림 — 스탠딩 대신 화면 전체) */
export type CgId =
  // 1~2주차
  | "y_closet"
  | "y_umbrella"
  | "y_name"
  | "a_booth"
  | "a_door"
  | "a_shoulder"
  // 3~4주차 · 여름 서브 이벤트
  | "a_summer"
  | "a_tshirt"
  | "a_morning"
  | "y_summer"
  | "y_glove"
  | "y_wall"
  | "y_kiss"
  | "y_dawn"
  // 엔딩
  | "end_amy_true"
  | "end_amy_good"
  | "end_yeon_true"
  | "end_yeon_good"
  | "end_grand"
  // CG 확장 (그림 오기 전까지 assets 에서 pending — 대본에 자리는 이미 있음)
  | "a_hand"
  | "a_cry"
  | "a_kiss"
  | "y_door"
  | "y_win";
export type SfxId =
  | "chip"
  | "deal"
  | "shuffle"
  | "click"
  | "win"
  | "lose"
  | "phone"
  | "heart"
  | "stamp"
  // 미연시 전용 (일레븐랩스 SFX)
  | "door"
  | "glass"
  | "keypad"
  | "heels"
  | "thunder"
  | "umbrella"
  | "shutter"
  | "splash"
  | "wave"
  | "blackout"
  | "paper"
  | "crane"
  // 2차 (장면 · 포커 · 폰)
  | "chime"
  | "scan"
  | "boil"
  | "siren"
  | "train"
  | "steps"
  | "pen"
  | "candy"
  | "clap"
  | "cardflip"
  | "allin"
  | "potwin"
  | "fold"
  | "knock"
  | "buzz"
  | "send"
  | "pencil"
  // 3차 (직접 합성 — public/love/sfx)
  | "chair"
  | "chair2"
  | "tags"
  | "can"
  | "keys"
  | "doorbell"
  | "microwave"
  | "chain"
  | "tape"
  | "sizzle"
  | "tick"
  | "hover"
  | "select"
  | "save";
export type BgmId =
  | "pub"
  | "vip"
  | "night"
  | "allin"
  | "title"
  | "amy"
  | "yeonseo"
  | "rain"
  | "heart"
  | "threat"
  | "spoker"
  | "confide"
  | "daily"
  | "comic"
  | "badend"
  // 3~4주차 (사용자 제미나이 제작)
  | "summer"
  | "dawn"
  | "truth"
  | "tilt"
  | "finale"
  | "ending"
  // 10-25 (사용자 제작): 결정적 순간 테마 · 엔딩 크레딧 · 비 그친 아침
  | "amy_ace"
  | "yeon_ace"
  | "credits"
  | "morning";

export type Vars = Record<string, number>;
/** 더하기 효과 (affA: +1 같은 것) */
export type Eff = Record<string, number>;

export type Cond =
  { v: string; op: ">=" | "<=" | ">" | "<" | "=="; n: number } | { all: Cond[] } | { any: Cond[] };

export interface Opt {
  text: string;
  eff?: Eff;
  /** 고르면 이 장면으로 (없으면 다음 줄로) */
  to?: string;
  /** 조건이 맞을 때만 보임 (텔 읽기로 열리는 숨은 선택지 등) */
  cond?: Cond;
  /** 문자 답장 뒤 상대가 보내는 답 (1~2줄). 전화 선택지에서만 씀 */
  back?: string[];
  /** 숨은 선택지 표시 (금색) */
  secret?: boolean;
  /** 마음 읽기로 열린 선택지 표시 (✎) — cond 로 mindA · mindY 문턱을 걸어 둔 결정적 순간 */
  read?: boolean;
  /** 하루 일정 카드 (free 슬롯에서): 누구를 만나는지 · 무엇이 오르는지 */
  card?: PlanCard;
}

/** 일정 카드: who 가 있으면 그 히로인 얼굴 + 관계 하트, 없으면 icon */
export interface PlanCard {
  who?: "amy" | "yeonseo";
  icon?: string;
  /** 장소 · 한 줄 설명 */
  place: string;
  /** 오르는 것 미리보기 (예: "실력 ✦" · "마음 안정") */
  hint?: string;
}

export interface TellSpec {
  who: CharKey;
  claim: string;
  /** 판단 근거 묘사 (순서대로 하나씩 보임) */
  cues: string[];
  truth: "true" | "bluff";
}

/*
 * 스토리 포커: 카드는 각본대로 정해져 있고, 갈리는 건 선택 (콜 · 폴드 · 레이즈 · 텔 읽기)
 * 카드 표기: "As" "Td" "7h" (랭크 + 무늬 s♠ h♥ d♦ c♣)
 */
export interface PokerAct {
  label: string;
  /** 다음 거리(스트리트) 번호. 없으면 결과로 끝 */
  to?: number;
  /** 끝날 때 결과 */
  result?: "win" | "lose" | "fold" | "split";
  /** 결과 점수 (mini_<key> 에 저장). 없으면 win 2 · split/fold 1 · lose 0 */
  score?: number;
  eff?: Eff;
  /** 고른 직후 상대 한마디 */
  say?: string;
  /** 고른 직후 주인공 속마음 */
  think?: string;
}
export interface PokerStreet {
  /** 이 거리에서 보이는 보드 카드 수 (0 · 3 · 4 · 5) */
  board: 0 | 3 | 4 | 5;
  /** 상대 말 */
  opp?: string;
  /** 읽을 수 있는 버릇 묘사 (텔) */
  tell?: string;
  /** 이 텔이 읽기 노트의 어떤 버릇인지 (tells.ts id) — 알고 있으면 해석이 같이 뜸 */
  tellId?: string;
  /** 두 번째로 보이는 신호 (히로인의 신호 등) — tellId2 버릇을 알면 해석이 같이 뜸 */
  tell2?: string;
  tellId2?: string;
  acts: PokerAct[];
}
export interface PokerSpec {
  title: string;
  opp: CharKey;
  mine: [string, string];
  theirs: [string, string];
  board: [string, string, string, string, string];
  /** 시작 팟 (칩 수, 연출용) */
  pot: number;
  streets: PokerStreet[];
  /** 결과별 마무리 한 줄 */
  ending?: Partial<Record<"win" | "lose" | "fold" | "split", string>>;
}

/**
 * 진짜 헤즈업: 무작위 카드 · 칩 싸움. 상대 AI 성향 + 버릇(아는 버릇이면 해석이 뜸)
 * 점수(mini_<key>): 칩이 늘었으면 2 · 비슷하면 1 · 줄었으면 0
 */
export interface MatchSpec {
  title: string;
  opp: CharKey;
  /** 핸드 수 (먼저 칩이 다 떨어지면 끝) */
  hands: number;
  /** 시작 칩 (양쪽 같음, 빅 블라인드 = 2) */
  stack: number;
  /** 판돈 이름 (사탕 · 성냥 · 칩) */
  unit: string;
  /** 진 경우 다시 하기 버튼 */
  retry?: boolean;
  /** 결과별 효과 */
  eff?: Partial<Record<"win" | "even" | "lose", Eff>>;
  /** 상대 대사 (시작 · 끝) — 판 중간 대사는 캐릭터 성향 기본값 */
  lines?: Partial<Record<"start" | "win" | "lose" | "even", string>>;
}

/** 몽타주 한 컷 (사진처럼 기울어진 폴라로이드): 배경 + 인물(선택) + 손글씨 한 줄 */
export interface Shot {
  bg: BgId;
  who?: CharKey;
  face?: Face;
  outfit?: Outfit;
  /** 사진 아래 손글씨 (짧게) */
  text?: string;
}

/** CG 카메라 — 그림의 x, y(0~1) 지점을 화면 가운데로, z 배 확대 */
export interface CgCam {
  x: number;
  y: number;
  z: number;
}

export type Step =
  /** 데이트 · 하루 요약 같은 '사진 몽타주' (새 CG 없이 이벤트 느낌) — 2~4컷, 클릭하면 다음 */
  | { t: "montage"; shots: Shot[]; caption?: string }
  | { t: "bg"; id: BgId }
  | { t: "show"; who: CharKey; pos?: Pos; dist?: Dist; face?: Face }
  | { t: "dist"; who: CharKey; dist: Dist }
  /** 말하지 않는 캐릭터의 표정만 바꿈 (주인공 말에 연서가 붉어지는 등) */
  | { t: "face"; who: CharKey; face: Face }
  /** 이벤트 CG 켜기 (null = 끄고 스탠딩으로). v = 처음부터 보여 줄 차분, cam = 처음 카메라 */
  | { t: "cg"; id: CgId | null; v?: string; cam?: CgCam }
  /** 켜져 있는 CG 의 차분만 바꿈 (번쩍임 없이 크로스페이드 · null = 원본) — 대사 흐름 따라 표정 바꾸기 */
  | { t: "cgv"; v: string | null; slow?: boolean }
  /** CG 연출: pulse = 심장 박동(화면이 미세하게 뛰고 두근 소리) · mono = 흑백(시간이 멈춘 순간, 서술은 화면 가운데). 아무것도 없으면 끔 */
  | { t: "cgfx"; pulse?: boolean; mono?: boolean }
  /** CG 카메라: 그림의 한 점(x, y = 0~1)을 z 배로 확대해 천천히 이동 (null = 전체 보기) */
  | { t: "cgcam"; cam: CgCam | null }
  /** 회상 필터: 종이 질감 · 세피아 · 손글씨 캡션 (text 없이 켜도 됨, off = 끄기). 날이 바뀌면 자동으로 꺼짐 */
  | { t: "memory"; text?: string; off?: boolean }
  /** 옷 갈아입기 (다음에 바꿀 때까지 유지, "default" = 기본) */
  | { t: "outfit"; who: CharKey; id: Outfit }
  | { t: "hide"; who?: CharKey }
  /** 걸려 오는 전화 — 받기를 눌러야 다음으로. who 가 없으면 이름만(모르는 번호 등) */
  | { t: "call"; name: string; who?: CharKey }
  /** 통화 끝 (통화 중 표시 끔) */
  | { t: "hangup" }
  | { t: "say"; who: Who; text: string; mood?: Mood; face?: Face }
  /** timer = 제한 시간(초) — 안 고르면 timeout(침묵) 을 고른 걸로. 침묵에도 전용 대사 · 결과를 씀 */
  /** tell = 읽기 노트 버릇 id — 그 버릇을 알고 있으면 선택지 위에 해석이 같이 뜸 (모르면 아무것도 안 뜸) */
  | { t: "choice"; prompt?: string; opts: Opt[]; big?: boolean; timer?: number; timeout?: Opt; tell?: string }
  | { t: "set"; eff: Eff }
  | { t: "goto"; to: string }
  | { t: "when"; cond: Cond; to: string; else?: string }
  | { t: "day"; day: number; slot: string }
  | { t: "title"; text: string; sub?: string }
  | { t: "mini"; kind: "deal"; key: string }
  | { t: "mini"; kind: "tell"; key: string; tell: TellSpec }
  | { t: "mini"; kind: "poker"; key: string; poker: PokerSpec }
  | { t: "mini"; kind: "match"; key: string; match: MatchSpec }
  | { t: "phone"; from: CharKey; msgs: string[]; replies: Opt[]; ignore: Eff }
  | { t: "free"; prompt: string; opts: Opt[]; big?: boolean }
  | { t: "sfx"; id: SfxId }
  | { t: "bgm"; id: BgmId | null }
  /** 「네가 알아준 것들」 — 그 히로인에 대해 알아본 순간들을 한 줄씩 (하나도 없으면 건너뜀) */
  | { t: "recall"; who: "amy" | "yeonseo" }
  | { t: "ending"; id: EndingId }
  | { t: "end"; text: string; sub?: string };

export type Scenes = Record<string, Step[]>;

export type EndingId =
  | "amy_true"
  | "amy_good"
  | "amy_friend"
  | "amy_fall"
  | "amy_ruin"
  | "yeon_true"
  | "yeon_good"
  | "yeon_sad"
  | "yeon_vanish"
  | "yeon_obsess"
  | "grand"
  | "plain"
  | "dealer"
  | "me_fall"
  | "clash"
  | "fired"
  | "ghost"
  | "data0";

export interface EndingInfo {
  id: EndingId;
  no: number;
  title: string;
  /** 엔딩 화면 한 줄 카피 */
  copy: string;
  /** 엔딩 격자에서 반쯤 가린 힌트 */
  hint: string;
  kind: "true" | "good" | "normal" | "bad" | "hidden";
  /** 배드 뒤 「마감 후 반성회」 장면 */
  review?: string;
}
