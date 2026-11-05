import type { ReactNode } from "react";

/*
 * 방탈출 — 방 하나를 데이터로 정의하는 틀. 진행은 전부 고정 데이터 (판정 오류 없음).
 * 좌표는 벽 그림 기준 (픽셀 방 320×180, 그림 방은 Wall.size).
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
  /** (보고서 v2) 칸마다 고른 답 · 잠긴 구간 · 틀린 확인 횟수 */
  fill?: Record<string, string>;
  locks?: string[];
  miss?: number;
  /** 시각 기록 (문밖 열쇠 소리 등) */
  marks?: Record<string, number>;
}

/** 대사 한 줄 (who 없으면 지문) */
export interface Line {
  who?: string;
  text: string;
  /** (엔진 내부) 이야기 줄 — 혼잣말(say)이 와도 지우지 않음 */
  keep?: boolean;
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
  /** 대사 창에 여러 줄 (이름표 · 글자 하나씩) */
  talk(lines: Line[]): void;
}

export interface Spot {
  id: string;
  label: string;
  /** [x, y, w, h] 벽 그림 좌표 */
  rect: [number, number, number, number];
  show?: (s: State) => boolean;
  click: (c: Ctx) => void;
}

export interface Wall {
  name: string;
  /** 픽셀 방: 캔버스에 직접 그림 */
  paint?: (g: CanvasRenderingContext2D, s: State) => void;
  /** 그림 방: 벽 그림 주소 (빛 모드 등은 Room.variant 가 뒤에 붙음) */
  img?: string | ((s: State) => string);
  /** 핫스팟 좌표계 (기본 320×180) */
  size?: [number, number];
  /** 그림 위에 겹치는 것 (켜진 안전등 빛 등) */
  overlay?: (s: State) => ReactNode;
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
  /** 도구 = 쓰는 물건 / 증거 = 모으는 물건 (없으면 한 줄로) */
  kind?: "tool" | "evidence";
}

export interface Hint {
  id: string;
  title: string;
  /** 이 퍼즐을 이미 풀었나 */
  done: (s: State) => boolean;
  /** 아직 시작도 못 하는 단계면 false (앞 퍼즐부터) */
  ready?: (s: State) => boolean;
  lines: [string, string, string];
  /** 보고서 구간 힌트 (보고서 화면에서만) */
  report?: boolean;
}

export interface Evidence {
  id: string;
  label: string;
  /** 플레이 중 본 적 있어야 고를 수 있음 */
  seen: (s: State) => boolean;
  /** 민규를 가리키는 근거인가 */
  good: boolean;
}

/** 보고서 v2 — 빈칸 문장. 칸 하나 = 보기 중 하나 고르기 (pick: "evidence" 면 본 증거 중에서) */
export interface Blank {
  id: string;
  options?: { id: string; label: string }[];
  pick?: "evidence";
  /** 맞다고 쳐 주는 답들 */
  answer: string[];
}

export interface Section {
  id: string;
  title: string;
  parts: (string | Blank)[];
  /** 틀려도 엔딩엔 영향 없는 덤 구간 */
  bonus?: boolean;
}

export interface Report2 {
  intro: string;
  sections: Section[];
  evidence: { id: string; label: string; seen: (s: State) => boolean }[];
  /** 떡밥 회수: 처음 깔린 곳 → 뜻 */
  payoffs: { clue: string; meaning: string }[];
}

export interface Fact {
  id: string;
  /** 어느 질문 밑에 */
  q: string;
  text: string;
  got: (s: State) => boolean;
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
  /** 도입 컷 그림 파일 (그림 방) */
  introImg?: string;
  /** 목록 · 시작 화면 카드 */
  card: { emoji: string; tag: string; blurb: string; time: string; level: number; fear: number; note?: string };
  /** 미리 받을 그림 (로딩 진행률) */
  assets?: string[];
  /** 벽 · 그림 주소 뒤에 붙일 꼬리 (빛 모드 등) */
  variant?: (s: State) => string;
  /** say() 로 말하는 사람 이름표 */
  me?: string;
  /** 수색 시작하자마자 나오는 대사 */
  start?: Line[];
  /** 조건이 처음 맞는 순간 한 번 나오는 장면 */
  events?: { id: string; when: (s: State) => boolean; lines: Line[]; run?: (c: Ctx) => void }[];
  /** 위 줄에 붙는 방 전용 버튼 · 표시 (빛 스위치 등) */
  hud?: (c: Ctx) => ReactNode;
  /** 사건 노트: 질문 + 퍼즐 풀며 채워지는 사실 */
  notebook?: { questions: { id: string; q: string }[]; facts: Fact[] };
  /** 보고서 v2 (있으면 report 대신) */
  report2?: Report2;
  /** (1호 방식) 보고서: 범인 · 상태 · 근거 2개 */
  report?: {
    culprits: { id: string; label: string }[];
    statuses: { id: string; label: string }[];
    answer: { culprit: string; status: string };
    evidence: Evidence[];
  };
  endings: { truth: ReactNode; normal: ReactNode };
  /** 탈출 조건 (보일러실 열림 등) */
  escaped: (s: State) => boolean;
}
