/*
 * 올인 러브 (가제) — ANIME POKER 외전 미연시 · 대본 데이터 형식
 * 대본은 전부 직렬화 가능한 데이터 (함수 없음) → 세이브에 그대로 저장 가능
 */

export type CharKey = "yeonseo" | "amy" | "boss";
/** 말하는 사람: 스탠딩 있는 캐릭터 + 주인공(me) + 나레이션(narr) + 카메오 */
export type Who = CharKey | "me" | "narr" | "taeyang" | "jeongmin";
/** 감정별 대사창: 귓속말 · 흔들림 · 외침 · 대사창 없이(고백 직전 등) · 속마음 */
export type Mood = "normal" | "whisper" | "shake" | "shout" | "bare" | "think";
export type Pos = "l" | "c" | "r";
/** 거리 3단계: 0 평소(허벅지까지) · 1 상반신 · 2 얼굴 클로즈업 */
export type Dist = 0 | 1 | 2;
export type BgId = "pub" | "alley" | "vip" | "store" | "arcade" | "room" | "black";
export type SfxId = "chip" | "deal" | "shuffle" | "click" | "win" | "lose" | "phone" | "heart" | "stamp";
export type BgmId = "pub" | "vip" | "night";

export type Vars = Record<string, number>;
/** 더하기 효과 (affA: +1 같은 것) */
export type Eff = Record<string, number>;

export type Cond =
  | { v: string; op: ">=" | "<=" | ">" | "<" | "=="; n: number }
  | { all: Cond[] }
  | { any: Cond[] };

export interface Opt {
  text: string;
  eff?: Eff;
  /** 고르면 이 장면으로 (없으면 다음 줄로) */
  to?: string;
  /** 조건이 맞을 때만 보임 (텔 읽기로 열리는 숨은 선택지 등) */
  cond?: Cond;
  /** 숨은 선택지 표시 (금색) */
  secret?: boolean;
}

export interface TellSpec {
  who: CharKey;
  claim: string;
  /** 판단 근거 묘사 (순서대로 하나씩 보임) */
  cues: string[];
  truth: "true" | "bluff";
}

export type Step =
  | { t: "bg"; id: BgId }
  | { t: "show"; who: CharKey; pos?: Pos; dist?: Dist; face?: string }
  | { t: "dist"; who: CharKey; dist: Dist }
  | { t: "hide"; who?: CharKey }
  | { t: "say"; who: Who; text: string; mood?: Mood; face?: string }
  | { t: "choice"; prompt?: string; opts: Opt[] }
  | { t: "set"; eff: Eff }
  | { t: "goto"; to: string }
  | { t: "when"; cond: Cond; to: string; else?: string }
  | { t: "day"; day: number; slot: string }
  | { t: "title"; text: string; sub?: string }
  | { t: "mini"; kind: "deal"; key: string }
  | { t: "mini"; kind: "tell"; key: string; tell: TellSpec }
  | { t: "phone"; from: CharKey; msgs: string[]; replies: Opt[]; ignore: Eff }
  | { t: "free"; prompt: string; opts: Opt[] }
  | { t: "sfx"; id: SfxId }
  | { t: "bgm"; id: BgmId | null }
  | { t: "ending"; id: EndingId }
  | { t: "end"; text: string; sub?: string };

export type Scenes = Record<string, Step[]>;

export type EndingId =
  | "amy_true" | "amy_good" | "amy_friend" | "amy_fall" | "amy_ruin"
  | "yeon_true" | "yeon_good" | "yeon_sad" | "yeon_vanish" | "yeon_obsess"
  | "grand" | "plain" | "dealer" | "me_fall" | "clash" | "fired" | "ghost"
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
