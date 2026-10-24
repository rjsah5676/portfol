/*
 * 올인 러브 — 감정 소리 (웃음 · 울음 · 한숨 · 놀람 등, 말 아님)
 * text = 화면 대사 (이 줄이 뜰 때 재생) · file = /love/voice/<file>.mp3 (같은 소리를 여러 줄에서 씀)
 * 10-25: 사용자가 새로 뽑은 에이미 감정 소리로 다시 채움 (손으로 관리)
 */
import type { VoiceLine } from "./voices";

export const EMO_LINES: VoiceLine[] = [
  { id: "amy-laugh-1", file: "amy-laugh", who: "amy", text: "아하하, 그럼 매일 볼 수 있겠네." },
  { id: "amy-laugh-2", file: "amy-laugh", who: "amy", text: "…딜러. 나 이제 너랑 같은 회사에 빚졌다. 아하하." },
  { id: "amy-laugh-3", file: "amy-laugh", who: "amy", text: "…딜러. 왔어? 아하하. 늦었다. 3분도 아니고, 4분." },
  { id: "amy-giggle-1", file: "amy-giggle", who: "amy", text: "에헤헤. 이거 너한테 꼭 한 번 해 보고 싶었어." },
  { id: "amy-giggle-2", file: "amy-giggle", who: "amy", text: "에헤헤. 거봐. 그동안은 몸풀기였어." },
  { id: "amy-mumble-1", file: "amy-mumble", who: "amy", text: "바보." },
  { id: "amy-mumble-2", file: "amy-mumble", who: "amy", text: "…여기 네 집이잖아. 바보." },
  { id: "amy-mumble-3", file: "amy-mumble", who: "amy", text: "……바보. 자. 세 시 반." },
  { id: "amy-mumble-4", file: "amy-mumble", who: "amy", text: "……바보. 운 같은 소리 하네." },
  { id: "amy-sob-1", file: "amy-sob", who: "amy", text: "……바보. 이기면 온다며. 졌잖아. 그래서 안 온 거잖아." },
  { id: "amy-sob-2", file: "amy-sob", who: "amy", text: "이거 받으면 내가 진 게 진짜 진 게 되잖아요!" },
  { id: "amy-sob-3", file: "amy-sob", who: "amy", text: "근데 퇴근하니까 갑자기 눈물이 나. 진 것도 아닌데. 바보같이." },
  { id: "amy-yay-1", file: "amy-yay", who: "amy", text: "…뽑혔다. 내가 뽑았어!" },
  { id: "amy-yay-2", file: "amy-yay", who: "amy", text: "이겼다! 사탕 다 내 거야!" },
  { id: "amy-yay-3", file: "amy-yay", who: "amy", text: "이겼다! 선생님을 이겼어!" },
  { id: "amy-yay-4", file: "amy-yay", who: "amy", text: "이겼다! 오늘은 딜러가 손님이야." },
  { id: "amy-hoarse-1", file: "amy-hoarse", who: "amy", text: "언니 지금 웃었어? 소리 냈어! 들었지, 딜러?" },
  { id: "amy-yawn-1", file: "amy-yawn", who: "amy", text: "…일어났어? 바닥에서 자면 등 안 아파?" },
];
