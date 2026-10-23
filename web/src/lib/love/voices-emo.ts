/*
 * 올인 러브 — 감정 소리 (웃음 · 울음 · 한숨 · 놀람 · 화남만, 말은 없음) · scripts/love-emo.mjs 가 자동 생성 — 손으로 고치지 말 것
 * 대사 음성은 검수 뒤에 넣음. 지금 게임에서 나는 목소리는 이것뿐
 * text = 화면 대사 (이 줄이 뜰 때 재생) · tag = 생성에 쓴 소리
 * 10-23: v3 대본으로 바뀐 줄 15개는 새 대사로 text 만 옮김 (소리 파일 그대로). love-emo.mjs 다시 돌리면 이 수정이 덮이니 주의
 */
import type { VoiceLine } from "./voices";

export const EMO_LINES: VoiceLine[] = [
  { id: "a-1b2a798585-e", who: "amy", text: "으으으…!", tag: "[frustrated groan] 으으으" },
  { id: "a-6b5ae2a49c-e", who: "amy", text: "…아하하. 졌어. 완전 졌어.", tag: "[laughs] 아하하" },
  { id: "a-b4cb5d0e7e-e", who: "amy", text: "…어제 딴 거 다 잃었으니까 본전이라고 치려고 했는데. 월세가 안 맞네. 아하하.", tag: "[laughs weakly] 아하하" },
  { id: "a-734485ef4b-e", who: "amy", text: "적어 놓고 보니까 좀 무섭다. 나 원래 숫자 안 적거든.", tag: "[laughs] 아하하" },
  { id: "a-30863fbd70-e", who: "amy", text: "그럼 우리 둘 다 이번 주는 지옥이네.", tag: "[laughs] 아하하" },
  { id: "a-9fad2df7cd-e", who: "amy", text: "헤헤. 이거 너한테 꼭 한 번 해 보고 싶었어.", tag: "[giggling] 헤헤" },
  { id: "a-a76a5bff48-e", who: "amy", text: "근데 퇴근하니까 갑자기 눈물이 나. 진 것도 아닌데. 바보같이.", tag: "[crying] 흐윽…" },
  { id: "a-1576e125a0-e", who: "amy", text: "하아… 점수 봐. 98점. 이게 실력이지.", tag: "[sighs] 하아" },
  { id: "a-84fd5b8648-e", who: "amy", text: "…푸흡. 뭐야 그게. 아빠보다 못해.", tag: "[snorts, stifling a laugh] 푸흡" },
  { id: "a-bdc08cccdf-e", who: "amy", text: "…0점이래. 한 소절은 불렀는데.", tag: "[laughs weakly] 아하하" },
  { id: "a-3939c11b46-e", who: "amy", text: "……", tag: "[exhales] 후우…" },
  { id: "a-8dd8bb4107-e", who: "amy", text: "…아하하. 우리 아빠 진짜 바보다. 나 김치찌개 맵다고 못 먹는데.", tag: "[laughs weakly] 아하하" },
  { id: "y-3d3204eaa2-e", who: "yeonseo", text: "…!", tag: "[calm, low voice] [gasps] 헉!" },
  { id: "a-9713276818-e", who: "amy", text: "…휴우.", tag: "[sighs] 하아…" },
  { id: "a-ef0de156c2-e", who: "amy", text: "괜찮아. 괜찮아. 반지하 1년 차면 이 정도는… 아하하. 웃기지. …안 웃겨?", tag: "[laughs weakly] 아하하" },
  { id: "a-b42bbf981b-e", who: "amy", text: "…오늘 여기서 못 자겠다. 이불도 다 젖었어.", tag: "[laughs weakly] 아하하" },
  { id: "a-857e340888-e", who: "amy", text: "하아, 하… 한 번 더! 한 번만 더! 이번엔 손 안 잡아도 돼!", tag: "[sighs] 하아" },
  { id: "a-1fff8f678f-e", who: "amy", text: "헤헤. 거봐. 그동안은 몸풀기였어.", tag: "[giggling] 헤헤" },
  { id: "a-e7c1c1d460-e", who: "amy", text: "…아하하. 다 잃었다. 어제 거.", tag: "[laughs] 아하하" },
  { id: "a-72f03974d6-e", who: "amy", text: "…딜러. 나 이제 너랑 같은 회사에 빚졌다. 아하하.", tag: "[laughs] 아하하" },
  { id: "a-1cd567e2e9-e", who: "amy", text: "평생인 줄 알았는데. 반년이래. 아하하. 숫자 웃기다.", tag: "[laughs weakly] 아하하" },
  { id: "a-2472a02c01-e", who: "amy", text: "…이러지 마. 다 울었는데. 다 운 줄 알았는데.", tag: "[crying] 흐윽…" },
  { id: "y-177753e996-e", who: "yeonseo", text: "…미워해요. 그래도 돼요.", tag: "[calm, low voice] [crying] 흐윽…" },
  { id: "a-1006b5117e-e", who: "amy", text: "…딜러. 왔어? 아하하. 늦었다. 3분도 아니고, 4분.", tag: "[laughs] 아하하" },
  { id: "a-bb7f2ebb52-e", who: "amy", text: "…진짜? 헤헤. 딱히 기대한 건 아닌데.", tag: "[giggling] 헤헤" },
  { id: "a-7fd2003748-e", who: "amy", text: "너 진짜 그 언니한테 푹 빠졌구나. 아하하. 딱히 서운한 건 아니고.", tag: "[laughs weakly] 아하하" },
  { id: "a-1fcf58d677-e", who: "amy", text: "…진짜? 약속이야. 헤헤.", tag: "[giggling] 헤헤" },
  { id: "y-3abcac5f9a-e", who: "yeonseo", text: "…후, 후후.", tag: "[calm, low voice] [chuckles softly] 후후" },
  { id: "y-e1491d2642-e", who: "yeonseo", text: "아하하…! 아하하하!", tag: "[calm, low voice] [laughs] 아하하" },
  { id: "y-97c02c7a56-e", who: "yeonseo", text: "이상해요. 하나도 안 무서워요. 지금은요. 내일은 무섭겠지만. …아하하.", tag: "[calm, low voice] [laughs] 아하하" },
  { id: "y-d04339171a-e", who: "yeonseo", text: "…왜 왔어요. 바보.", tag: "[calm, low voice] [crying] 흐윽…" },
  { id: "y-a9b1ff83e6-e", who: "yeonseo", text: "아하하. …들었어요? 저 이제 이렇게 웃어요.", tag: "[calm, low voice] [laughs] 아하하" },
  { id: "y-fac96713ee-e", who: "yeonseo", text: "저 말고 다른 사람한테 카드 돌리지 마요.", tag: "[calm, low voice] [angry, annoyed huff] 흥!" },
  { id: "a-5856c7b2f1-e", who: "amy", text: "…아하하. 졌다. 아빠랑 똑같이.", tag: "[laughs weakly] 아하하" },
  { id: "y-ab9ec5f59a-e", who: "yeonseo", text: "…일어나요. 지금.", tag: "[calm, low voice] [angry, annoyed huff] 흥!" },
  { id: "a-f9d70c2915-e", who: "amy", text: "on my side라며. 둘 다의 side였어?", tag: "[angry, annoyed huff] 흥!" },
  { id: "a-212dd8d08e-e", who: "amy", text: "나는? 나한테 웃어 준 건? 그것도 그냥 딜러 서비스였어?", tag: "[crying] 흐윽…" },
  { id: "a-4c163c8c18-e", who: "amy", text: "딜러는 빠져. 이건 우리 판이야.", tag: "[angry, annoyed huff] 흥!" },
  { id: "a-8a81aaa3eb-e", who: "amy", text: "언니가 땄어요? 우리 아빠를? 하나도 안 틀리고?", tag: "[angry, annoyed huff] 흥!" },
];
