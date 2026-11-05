import type { ReactNode } from "react";

/*
 * 방탈출 — 방 하나를 데이터로 정의하는 틀. 진행은 전부 고정 데이터 (판정 오류 없음).
 * 좌표는 벽 그림 픽셀(320×180) 기준.
 */

export const W = 320;
export const H = 180;

export type Dir = "N" | "E" | "S" | "W";
export const DIRS: Dir[] = ["N", "E", "S", "W"];

export interface State {
  view: Dir;
  inv: string[];
  flags: Record<string, boolean>;
  /** 고른 아이템 (다음 클릭에 씀) */
  sel: string | null;
  /** 열린 확대 장면 */
  open: string | null;
  /** 시작 시각 (ms) */
  t0: number;
  /** 끝난 시각 */
  t1: number | null;
  /** 퍼즐별로 본 힌트 단계 */
  hint: Record<string, number>;
  /** review = 탈출 뒤 보고서 쓰다가 현장 다시 둘러보기 (시간은 멈춤) */
  phase: "intro" | "play" | "review" | "report" | "end";
  /** 쓰다 만 보고서 (현장 다시 보러 갔다 와도 남게) */
  draft?: { culprit: string; status: string; evidence: string[] };
  /** 보고서 결과 */
  result: { culprit: string; status: string; evidence: string[]; truth: boolean } | null;
}

export interface Ctx {
  s: State;
  set(fn: (s: State) => State): void;
  say(msg: string): void;
  open(id: string | null): void;
  has(item: string): boolean;
  flag(name: string): boolean;
  setFlag(name: string, v?: boolean): void;
  give(item: string): void;
  take(item: string): void;
}

export interface Spot {
  id: string;
  label: string;
  /** [x, y, w, h] 벽 픽셀 기준 */
  rect: [number, number, number, number];
  show?: (s: State) => boolean;
  click: (c: Ctx) => void;
}

export interface Wall {
  name: string;
  paint: (g: CanvasRenderingContext2D, s: State) => void;
  spots: Spot[];
}

export interface Item {
  name: string;
  icon: string;
  /** 상태에 따라 바뀌는 설명은 함수로 */
  desc: string | ((s: State) => string);
  /** 인벤토리 이름 옆 작은 표시 (예: 손전등 ON/OFF) */
  badge?: (s: State) => { text: string; on: boolean } | null;
  /** 자세히 볼 때 열 확대 장면 (없으면 설명 글) */
  view?: string;
}

export interface Hint {
  id: string;
  title: string;
  /** 이 퍼즐을 이미 풀었나 */
  done: (s: State) => boolean;
  /** 아직 시작도 못 하는 단계면 false (앞 퍼즐부터) */
  ready?: (s: State) => boolean;
  lines: [string, string, string];
}

export interface Evidence {
  id: string;
  label: string;
  /** 플레이 중 본 적 있어야 고를 수 있음 */
  seen: (s: State) => boolean;
  /** 민규를 가리키는 근거인가 */
  good: boolean;
}

export interface Room {
  id: string;
  title: string;
  walls: Record<Dir, Wall>;
  items: Record<string, Item>;
  /** 확대 장면 (문서 · 자물쇠 · 장소) */
  closeups: Record<string, { title: string; render: (c: Ctx) => ReactNode }>;
  /** 인벤토리에서 아이템 둘을 겹쳤을 때. 처리했으면 true */
  combine: (a: string, b: string, c: Ctx) => boolean;
  hints: Hint[];
  intro: ReactNode;
  /** 도입 컷 그림 (320×180) */
  introPaint?: (g: CanvasRenderingContext2D) => void;
  report: {
    culprits: { id: string; label: string }[];
    statuses: { id: string; label: string }[];
    answer: { culprit: string; status: string };
    evidence: Evidence[];
  };
  endings: { truth: ReactNode; normal: ReactNode };
  /** 탈출 조건 (보일러실 열림 등) */
  escaped: (s: State) => boolean;
}
