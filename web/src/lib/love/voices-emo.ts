/*
 * 올인 러브 — 감정 소리 (웃음 · 울음 · 한숨 · 놀람 · 화남만, 말은 없음) · scripts/love-emo.mjs 가 자동 생성 — 손으로 고치지 말 것
 * 대사 음성은 검수 뒤에 넣음. 지금 게임에서 나는 목소리는 이것뿐
 * text = 화면 대사 (이 줄이 뜰 때 재생) · tag = 생성에 쓴 소리
 * 10-23: v3 대본으로 바뀐 줄 15개는 새 대사로 text 만 옮김 (소리 파일 그대로). love-emo.mjs 다시 돌리면 이 수정이 덮이니 주의
 */
import type { VoiceLine } from "./voices";

/** 10-23: 감정 소리 전부 뺌 (소리 품질 문제로 새로 뽑기로 함 — 새 소리 받으면 여기 다시 채움). 예전 목록은 git 기록 cfed5c8f 참고 */
export const EMO_LINES: VoiceLine[] = [];
