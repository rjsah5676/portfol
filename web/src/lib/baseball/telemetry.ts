/**
 * 플레이 기록 보내기 — 2026-10-31 게임을 내리면서 껐음 (서버 POST /api/baseball/log · 관리자 「야구 플레이 데이터」 탭도 뺌).
 * 부르는 쪽은 그대로 두려고 함수 모양만 남김. 예전 기록은 DB 컬렉션 baseball_logs 에 그대로 있음.
 * 되살리려면 git log -- web/src/lib/baseball/telemetry.ts 의 2026-10-31 직전 판을 참고.
 */

/** 기록 형식 판 (필드가 바뀌면 올림) */
export const LOG_V = 1;
/** 게임 판 (밸런스 · 화면이 바뀌는 패치를 낼 때 올림) */
export const GAME_BUILD = "2026-10-29e";

export function logPlay(_kind: string, _data: Record<string, unknown>) {}

export function logUi(_action: string, _extra: Record<string, unknown> = {}) {}

export function installErrorLog() {}
