/*
 * 리듬게임 플레이 데이터 (관리자 결과 화면의 「플레이 데이터 내보내기」) — 채보 노트마다 판정 · 친 시각과
 * 누르고 뗀 입력 기록을 JSON 한 파일로. 채보 손볼 때 실제로 어디서 밀리는지 보려고 씀.
 */
import { WINDOW, type Judge, type LiveNote } from "./engine";

const J: Record<Judge, string> = { perfect: "P", great: "G", good: "O", miss: "M" };
const ms = (x: number) => Math.round(x * 1000);

export interface PlayLog {
  v: 1;
  game: "PIXEL Rhythm Up";
  at: string;
  song: { id: string; title: string; bpm: number; custom: boolean };
  diff: string;
  level: number | null;
  /** 판정 창(ms) */
  window: { perfect: number; great: number; good: number };
  /** 끝날 때 싱크 값(ms): 수동 음악 싱크 · 자동 음악 싱크 · 자동 타격 싱크 */
  sync: { manual: number; auto: number; judge: number };
  speed: number;
  auto: boolean;
  failed: boolean;
  result: { score: number; acc: number; maxCombo: number; counts: Record<Judge, number> };
  /** 노트: [시각ms, 레인, 롱노트 끝ms(없으면 0), 머리 판정 P/G/O/M(못 친 건 ""), 머리 친 시각 - 노트 시각(ms, +면 늦음), 꼬리 판정, 뗀 시각 - 끝(ms)] */
  notes: (number | string | null)[][];
  /** 입력: [누른/뗀 시각ms(판정 기준, 타격 싱크 뺀 값), 레인, 1=누름 0=뗌, 그때 타격 싱크ms] */
  inputs: number[][];
}

export function buildPlayLog(
  meta: Omit<PlayLog, "v" | "game" | "at" | "window" | "notes" | "inputs">,
  notes: LiveNote[],
  inputs: number[][]
): PlayLog {
  return {
    v: 1,
    game: "PIXEL Rhythm Up",
    at: new Date().toISOString(),
    window: { perfect: ms(WINDOW.perfect), great: ms(WINDOW.great), good: ms(WINDOW.good) },
    ...meta,
    notes: notes.map((n) => [
      ms(n.t),
      n.lane,
      n.end ? ms(n.end) : 0,
      n.head ? J[n.head] : "",
      n.hitAt !== undefined ? ms(n.hitAt - n.t) : null,
      n.end ? (n.tail ? J[n.tail] : "") : null,
      n.end && n.relAt !== undefined ? ms(n.relAt - n.end) : null,
    ]),
    inputs,
  };
}

export function downloadPlayLog(log: PlayLog) {
  const d = new Date(log.at);
  const p = (x: number) => String(x).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const blob = new Blob([JSON.stringify(log)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `rhythm-play_${log.song.id}_${log.diff}_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
