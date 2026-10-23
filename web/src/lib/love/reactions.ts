/*
 * 올인 러브 — 살아 있는 스탠딩: 방치 · 터치 반응 대사
 * 호감(affY / affA) 단계마다 다르게. 같은 단계 안에선 무작위
 * 말투: 연서 = 존댓말 · 짧고 건조함 / 에이미 = 반말 · 장난
 */
import type { BgmId, CharKey, Face, Vars } from "./types";

export interface ReactLine {
  text: string;
  face: Face;
  /** 두근 효과음 */
  heart?: boolean;
}
type Tiered = [low: ReactLine[], mid: ReactLine[], high: ReactLine[]];

const AFF: Partial<Record<CharKey, string>> = { yeonseo: "affY", amy: "affA" };
/** 호감 단계: 0 낮음 · 1 보통(7 이상) · 2 높음(12 이상) — rel.ts 관계 단계와 맞춤 */
const tier = (who: CharKey, v: Vars) => {
  const n = v[AFF[who] ?? ""] ?? 0;
  return n >= 12 ? 2 : n >= 7 ? 1 : 0;
};
const pickOne = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

const TOUCH_HEAD: Partial<Record<CharKey, Tiered>> = {
  yeonseo: [
    [
      { text: "…손 치워요.", face: "cold" },
      { text: "…용건 있어요?", face: "cold" },
    ],
    [
      { text: "…뭐 하는 거예요.", face: "away" },
      { text: "애 취급은 사양할게요.", face: "away" },
    ],
    [
      { text: "……조금만이에요.", face: "blush", heart: true },
      { text: "다른 사람 앞에선 하지 마요.", face: "blush", heart: true },
    ],
  ],
  amy: [
    [
      { text: "야, 머리 망가져!", face: "pout" },
      { text: "뭐야, 갑자기?", face: "surprise" },
    ],
    [
      { text: "…헤헤. 방금 웃은 거 못 본 걸로 해.", face: "blush" },
      { text: "더 해도 되는데? …아, 방금 건 취소!", face: "blush" },
    ],
    [
      { text: "손 따뜻하네… 조금만 더.", face: "smile", heart: true },
      { text: "이거 나만 해 주는 거지?", face: "blush", heart: true },
    ],
  ],
};

const TOUCH_BODY: Partial<Record<CharKey, Tiered>> = {
  yeonseo: [
    [
      { text: "용건 있으면 말로 해요.", face: "cold" },
      { text: "…칩이라도 떨어졌어요?", face: "away" },
    ],
    [
      { text: "…간지러워요.", face: "surprise" },
      { text: "할 말 있어요?", face: "base" },
    ],
    [
      { text: "…왜요. 심심해요?", face: "smile", heart: true },
      { text: "그렇게 쳐다보면 패 다 읽혀요.", face: "smile" },
    ],
  ],
  amy: [
    [
      { text: "찌르지 마! 신고한다?", face: "pout" },
      { text: "아 뭐야, 놀랐잖아!", face: "surprise" },
    ],
    [
      { text: "왜, 나 보고 싶었어?", face: "smug" },
      { text: "간지럽잖아, 진짜!", face: "smile" },
    ],
    [
      { text: "헤헤, 심심하면 나랑 놀자.", face: "smile", heart: true },
      { text: "…계속 그러면 나도 찌른다?", face: "smug" },
    ],
  ],
};

const IDLE: Partial<Record<CharKey, Tiered>> = {
  yeonseo: [
    [
      { text: "…듣고 있어요?", face: "base" },
      { text: "졸리면 오늘은 들어가요.", face: "away" },
    ],
    [
      { text: "멍하니 뭐 봐요.", face: "base" },
      { text: "…계속 그렇게 있을 거예요?", face: "away" },
    ],
    [
      { text: "…그렇게 보면 일 못 해요.", face: "blush", heart: true },
      { text: "딜러님. …그냥 불러 봤어요.", face: "smile", heart: true },
    ],
  ],
  amy: [
    [
      { text: "야, 졸아? 내 얘기 지루해?", face: "pout" },
      { text: "여보세요~ 지구에서 부릅니다~", face: "smug" },
    ],
    [
      { text: "멍 때리지 말고 대답해!", face: "pout" },
      { text: "…혹시 나 보느라 넋 나간 거?", face: "smug" },
    ],
    [
      { text: "…왜 그렇게 쳐다봐. 부끄럽게.", face: "blush", heart: true },
      { text: "딜러, 딴생각하면 삐진다?", face: "pout" },
    ],
  ],
};

/** 방치 · 터치 반응은 가벼운 장면에서만 (CG · 무거운 BGM · 무음 연출 중엔 끔) */
const LIGHT: BgmId[] = ["pub", "amy", "yeonseo", "daily", "comic", "summer"];
export const lightMood = (s: { disp: { cg?: unknown; bgm: BgmId | null } }) =>
  !s.disp.cg && !!s.disp.bgm && LIGHT.includes(s.disp.bgm);

const FALLBACK: ReactLine = { text: "…?", face: "base" };

export function touchLine(who: CharKey, part: "head" | "body", v: Vars): ReactLine {
  const t = (part === "head" ? TOUCH_HEAD : TOUCH_BODY)[who];
  return t ? pickOne(t[tier(who, v)]) : FALLBACK;
}
export function idleLine(who: CharKey, v: Vars): ReactLine {
  const t = IDLE[who];
  return t ? pickOne(t[tier(who, v)]) : FALLBACK;
}
