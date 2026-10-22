/*
 * 올인 러브 — 대본 작성 도우미 (결과는 순수 데이터). script.ts · script-w2.ts 공용
 */
import {
  type CharKey,
  type Face,
  type Mood,
  MOODS,
  type PokerSpec,
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
