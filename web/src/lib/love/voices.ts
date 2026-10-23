/*
 * 올인 러브 — 핵심 대사 음성 (일레븐랩스 v4 · 연서 / 에이미 목소리)
 * 대본의 대사 텍스트와 똑같은 줄에서 재생. 파일: /love/voice/<id><take>.mp3 (take a · b 두 개 뽑아 둠, 기본 a)
 * tag = v4 연기 태그 (생성할 때만 씀)
 */
import type { CharKey } from "./types";
import { GEN_LINES } from "./voices-gen";

export interface VoiceLine {
  id: string;
  who: CharKey;
  text: string;
  tag?: string;
  /** 풀보이스 자동 생성 줄 (테이크 하나) */
  gen?: boolean;
}

export const VOICE_LINES: VoiceLine[] = [
  // ---- 연서 ----
  { id: "yeonseo-01", who: "yeonseo", text: "셔플할 때 엄지가 먼저 나가네요.", tag: "[calm]" },
  { id: "yeonseo-02", who: "yeonseo", text: "예전에 그렇게 섞던 사람이 하나 있었는데. 아니에요. 수고하셨어요.", tag: "[softly]" },
  { id: "yeonseo-03", who: "yeonseo", text: "…제 얘기예요. 딜러님 얘기 아니고.", tag: "[whispers]" },
  { id: "yeonseo-04", who: "yeonseo", text: "그럼 됐어요. 이 가게에서 믿어도 되는 건 이모 밥이랑 이모뿐이에요.", tag: "[calm]" },
  { id: "yeonseo-05", who: "yeonseo", text: "다들 그 사람이 죽었다고 하던데. 저는 안 믿었어요. 그런 손은 쉽게 안 죽거든요.", tag: "[calm]" },
  { id: "yeonseo-06", who: "yeonseo", text: "…'콜'. 부르면 오니까.", tag: "[softly]" },
  { id: "yeonseo-07", who: "yeonseo", text: "…부탁이에요.", tag: "[whispers]" },
  { id: "yeonseo-08", who: "yeonseo", text: "…왜 이런 얘길 하는지 모르겠네요. 진 사람은 거짓말 없이 대답하기로 해서 그런가.", tag: "[whispers]" },
  { id: "yeonseo-09", who: "yeonseo", text: "…그래도, 고마워요.", tag: "[whispers]" },
  { id: "yeonseo-10", who: "yeonseo", text: "…숨 쉬지 마요.", tag: "[whispers]" },
  { id: "yeonseo-11", who: "yeonseo", text: "…심장 소리, 다 들렸어요. 딜러님 거.", tag: "[whispers]" },
  { id: "yeonseo-12", who: "yeonseo", text: "…제발요.", tag: "[desperate]" },
  { id: "yeonseo-13", who: "yeonseo", text: "…그런 이유로 오는 사람이 어디 있어요.", tag: "[whispers]" },
  { id: "yeonseo-14", who: "yeonseo", text: "근데 지금은… 그냥 비 오니까요.", tag: "[softly]" },
  { id: "yeonseo-15", who: "yeonseo", text: "…이상해요. 이름 하나 부르는 게, 올인보다 떨려요.", tag: "[whispers]" },
  { id: "yeonseo-16", who: "yeonseo", text: "…어떤 말을 듣더라도, 저를 믿을 수 있어요?", tag: "[softly]" },
  { id: "yeonseo-17", who: "yeonseo", text: "…맞아요. 그 사람이에요. '손'.", tag: "[coldly]" },
  { id: "yeonseo-18", who: "yeonseo", text: "…믿는다고, 했죠.", tag: "[whispers]" },
  // ---- 에이미 ----
  { id: "amy-01", who: "amy", text: "…뭐? 그게 왜 떠?! 그게 왜 거기서 뜨냐고!", tag: "[shouting]" },
  { id: "amy-02", who: "amy", text: "팁. 딜러 손은 빠르더라. 그건 인정.", tag: "[embarrassed]" },
  { id: "amy-03", who: "amy", text: "써, 써 있긴 뭐가 써 있어!", tag: "[embarrassed]" },
  { id: "amy-04", who: "amy", text: "딱히 다른 뜻은 없거든! 연애 같은 거 해 본 적도 없고, 해 보고 싶지도 않으니까!", tag: "[embarrassed]" },
  { id: "amy-05", who: "amy", text: "…에이미. 그냥 에이미. 이상한 거 붙이면 죽어.", tag: "[embarrassed]" },
  { id: "amy-06", who: "amy", text: "…근데, 고마워. 이번 한 번만 말할 거야.", tag: "[whispers]" },
  { id: "amy-07", who: "amy", text: "마셔. 딱히 간접 키스 같은 거 의식한 거 아니고, 다 못 마셔서 그런 거야.", tag: "[embarrassed]" },
  { id: "amy-08", who: "amy", text: "뽑혔다! 뽑혔어!! 봤지? 봤지?!", tag: "[excited]" },
  { id: "amy-09", who: "amy", text: "…이, 이건 실수야. 다시 찍을 거야. 아니, 돈 아까우니까 그냥 둬.", tag: "[embarrassed]" },
  { id: "amy-10", who: "amy", text: "고, 고마워. …딜러.", tag: "[embarrassed]" },
  { id: "amy-11", who: "amy", text: "그래도 나는 아빠랑 달라. 나는 이기니까. 오늘처럼.", tag: "[whispers]" },
  { id: "amy-12", who: "amy", text: "…고마워. 그 말, 처음 들어 봐서.", tag: "[whispers]" },
  { id: "amy-13", who: "amy", text: "월세 어떡하지. 아하하. 진짜 어떡하지.", tag: "[sad]" },
  { id: "amy-14", who: "amy", text: "…너 왜 이렇게 따뜻해.", tag: "[whispers]" },
  { id: "amy-15", who: "amy", text: "…오늘만 어깨 빌려줘. 유료야. 떡볶이로 갚을게.", tag: "[whispers]" },
  { id: "amy-16", who: "amy", text: "…내 머리 쓰다듬어 봐.", tag: "[whispers]" },
  { id: "amy-17", who: "amy", text: "…오늘, 진짜 재밌었어요. 이건 존댓말이라서 하는 말이에요. 반말이었으면 안 했어요.", tag: "[whispers]" },
  { id: "amy-18", who: "amy", text: "……똑같아.", tag: "[shocked]" },
];

/** 고른 테이크 (사용자가 b가 낫다고 하면 여기만 바꿈) */
export const VOICE_TAKE: Record<string, "a" | "b"> = {};

/** 음성 붙은 줄 전부 — 핵심 대사(A/B 두 테이크) + 풀보이스 줄(한 테이크, 다시 뽑으면 <id>b) */
export const VOICE_ALL: VoiceLine[] = [...VOICE_LINES, ...GEN_LINES.map((g) => ({ ...g, gen: true }))];

/** 줄 → 파일 이름 (확장자 없이) */
export const voiceFile = (v: { id: string; gen?: boolean }, take: "a" | "b" = VOICE_TAKE[v.id] ?? "a") =>
  v.gen ? `${v.id}${take === "b" ? "b" : ""}` : `${v.id}${take}`;

/** 대사 텍스트 → 음성 파일 */
export const VOICE_BY_TEXT: Record<string, string> = Object.fromEntries(
  VOICE_ALL.map((v) => [v.text, `/love/voice/${voiceFile(v)}.mp3`])
);
