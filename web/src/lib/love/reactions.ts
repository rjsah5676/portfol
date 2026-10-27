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

const AFF: Partial<Record<CharKey, string>> = { yeonseo: "affY", amy: "affA", sera: "affS" };
/** 호감 단계: 0 낮음 · 1 보통(7 이상) · 2 높음(12 이상) — rel.ts 관계 단계와 맞춤 */
const tier = (who: CharKey, v: Vars) => {
  const n = v[AFF[who] ?? ""] ?? 0;
  return n >= 12 ? 2 : n >= 7 ? 1 : 0;
};
const pickOne = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

const TOUCH_HEAD: Partial<Record<CharKey, Tiered>> = {
  sera: [
    [
      { text: "어? 쓰다듬어 주는 거예요? …한 번 더요.", face: "smile" },
      { text: "손님 머리 만지면 안 되는 거 아니에요? 저는 좋지만요.", face: "smile" },
    ],
    [
      { text: "…지금 거 기억해 둘게요. 오늘 날짜랑 같이.", face: "smile", heart: true },
      { text: "더 해 주면, 저 오늘 안 갈 거예요.", face: "smile" },
    ],
    [
      { text: "…딜러님 손, 역시 예뻐요.", face: "smile", heart: true },
      { text: "이거, 저한테만 해요. 약속.", face: "smile", heart: true },
    ],
  ],
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
  sera: [
    [
      { text: "앗. 딜러님 먼저 만졌어요. 이제 저도 만져도 되는 거죠?", face: "smile" },
      { text: "…지금 제 쪽으로 온 거죠? 그렇게 알게요.", face: "smile" },
    ],
    [
      { text: "도망 안 가요. 딜러님이 밀어도요.", face: "smile" },
      { text: "후후. 심장 소리 들려요? 저 지금 콜이에요.", face: "smile", heart: true },
    ],
    [
      { text: "……조금만 더 이러고 있어요.", face: "smile", heart: true },
      { text: "놓으면 안 돼요. 놓으면, 제가 잡을 거예요.", face: "smile", heart: true },
    ],
  ],
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
  // 세라: 존댓말 · 늘 웃음 · 집요함 (3주차 전엔 '모르는 걸 아는' 대사 금지)
  sera: [
    [
      { text: "…저 보고 있었죠? 괜찮아요. 저도 보고 있었어요.", face: "smile" },
      { text: "기다리는 거 잘해요. 3분이든, 3년이든.", face: "smile" },
    ],
    [
      { text: "딜러님, 지금 몇 초째 저만 보는지 세고 있어요.", face: "smile" },
      { text: "가만히 있으면, 저 그냥 계속 볼 거예요?", face: "smile" },
    ],
    [
      { text: "…이대로 시간 멈추면 좋겠다.", face: "smile", heart: true },
      { text: "딜러님이 아무 말 안 해도, 저는 안 가요.", face: "smile", heart: true },
    ],
  ],
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
      { text: "…딜러? 듣고 있어?", face: "pout" },
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
