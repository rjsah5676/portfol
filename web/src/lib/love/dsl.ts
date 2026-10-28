/*
 * 올인 러브 — 대본 작성 도우미 (결과는 순수 데이터). script.ts · script-w2.ts 공용
 */
import {
  type CharKey,
  type Face,
  type Mood,
  MOODS,
  type PokerSpec,
  type MatchSpec,
  type Step,
  type Who,
} from "./types";

/** 두 번째 인자는 대사창 감정(Mood) 또는 표정(Face), 둘 다면 감정 → 표정 순서: Y("…", "whisper", "sad") */
export const say = (who: Who, text: string, m?: Mood | Face, f?: Face): Step => {
  const mood = m && (MOODS as readonly string[]).includes(m) ? (m as Mood) : undefined;
  const face = f ?? (m && !mood ? (m as Face) : undefined);
  return { t: "say", who, text, ...(mood && { mood }), ...(face && { face }) };
};
export const N = (text: string): Step => say("narr", text);
export const ME = (text: string, mood?: Mood): Step => say("me", text, mood);
export const Y = (text: string, m?: Mood | Face, f?: Face): Step => say("yeonseo", text, m, f);
/** 세라 */
export const S = (text: string, m?: Mood | Face, f?: Face): Step => say("sera", text, m, f);
export const A = (text: string, m?: Mood | Face, f?: Face): Step => say("amy", text, m, f);
/** 말 안 하는 캐릭터 표정만 바꾸기 (리액션) */
export const FACE = (who: CharKey, face: Face): Step => ({ t: "face", who, face });
/** 서브 캐릭터 표정은 둘뿐: 사장 base · cold / 태양 · 정민 · 이모 base · smile */
export const BOSS = (text: string, m?: Mood | Face, f?: Face): Step => say("boss", text, m, f);
export const TY = (text: string, f?: Face): Step => say("taeyang", text, f);
export const JM = (text: string, f?: Face): Step => say("jeongmin", text, f);
export const CH = (text: string, f?: Face): Step => say("chunhee", text, f);
export const TH = (text: string): Step => say("me", text, "think");
export const poker = (key: string, spec: PokerSpec): Step => ({
  t: "mini",
  kind: "poker",
  key,
  poker: spec,
});
/** 진짜 헤즈업 한 판 (무작위 카드) */
export const match = (key: string, spec: MatchSpec): Step => ({ t: "mini", kind: "match", key, match: spec });

/** 하루 일정 카드 (free 슬롯용): 카드 제목 · 장소 · 이동 장면 · 누구/아이콘 · 오르는 것 */
export const card = (
  text: string,
  place: string,
  to: string,
  o: { who?: "amy" | "yeonseo"; icon?: string; hint?: string; eff?: Record<string, number>; cond?: import("./types").Cond } = {}
): import("./types").Opt => ({
  text,
  to,
  ...(o.eff && { eff: o.eff }),
  ...(o.cond && { cond: o.cond }),
  card: { place, ...(o.who && { who: o.who }), ...(o.icon && { icon: o.icon }), ...(o.hint && { hint: o.hint }) },
});
/**
 * 시간제한 선택지 (기본 10초): 안 고르면 silence(침묵) 을 고른 걸로 — 침묵에도 전용 장면을 이어 줄 것
 * TIMED("붙잡을까?", [opt, opt], { text: "(아무 말도 못 한다)", to: "x_silent" })
 */
export const TIMED = (
  prompt: string,
  opts: import("./types").Opt[],
  silence: import("./types").Opt,
  timer = 10,
  big?: boolean
): Step => ({ t: "choice", prompt, opts, timer, timeout: silence, ...(big && { big }) });
/** 하루 낮 일정 고르기 */
export const PLAN = (prompt: string, opts: import("./types").Opt[]): Step => ({ t: "free", prompt, opts });
/** 사진 몽타주 (2~4컷): MONTAGE([{ bg: "arcade", who: "amy", face: "smile", text: "곰 생일" }, …], "그날의 사진") */
export const MONTAGE = (shots: import("./types").Shot[], caption?: string): Step => ({
  t: "montage",
  shots,
  ...(caption && { caption }),
});
