import type { Case } from "./engine";

/*
 * 입문 사건 「산장의 밤」 — 손으로 쓴 사건 (풀이기로 확인: 해 1개 · 단서 3개 모두 필요 · 진술만으론 범인 2명 가능)
 * 풀이 가이드 6단계: 단계마다 채울 칸(fill)이 있고, 그 칸이 맞게 채워지면 다음 단계로 넘어감
 */

export const TUTORIAL: Case = {
  tierId: "easy",
  n: 4,
  T: 2,
  setting: { id: "lodge", name: "산장", weather: "11월의 비 오는 밤" },
  rooms: [
    { id: "study", name: "서재", x: 0, y: 0, w: 1, h: 1 },
    { id: "living", name: "거실", x: 1, y: 0, w: 1, h: 1 },
    { id: "kitchen", name: "주방", x: 2, y: 0, w: 1, h: 1 },
    { id: "garden", name: "정원", x: 1, y: 1, w: 2, h: 1, open: true },
  ],
  adj: [
    [0, 1],
    [1, 0, 2, 3],
    [2, 1, 3],
    [3, 1, 2],
  ],
  people: [
    { name: "한정우", role: "장남", sex: "m", h: 182, hand: "오른손" },
    { name: "윤서진", role: "비서", sex: "f", h: 164, hand: "오른손" },
    { name: "강도현", role: "산장 관리인", sex: "m", h: 176, hand: "왼손" },
    { name: "민가을", role: "주치의", sex: "f", h: 170, hand: "오른손" },
  ],
  items: [
    { name: "청동 문진", cat: "blunt", mat: "금속", wt: "무거움" },
    { name: "은촛대", cat: "blunt", mat: "금속", wt: "무거움" },
    { name: "등산 로프", cat: "cord", mat: "천", wt: "가벼움" },
    { name: "사냥칼", cat: "blade", mat: "금속", wt: "가벼움" },
  ],
  pos: [
    [0, 1, 3, 2],
    [1, 0, 2, 3],
  ],
  item: [0, 1, 3, 2],
  crimeRoom: 0,
  culprit: 1,
  cause: "blunt",
  victim: { name: "한명철", title: "회장", age: 72 },
  slots: [
    [1300, 1320],
    [1320, 1340],
  ],
  clues: [
    { k: "own", p: 2, i: 3, yes: true },
    { k: "iat", i: 2, t: 1, r: 3, yes: true },
    { k: "iattr", i: 1, a: "h", op: "<", v: 171 },
  ],
  stmts: [
    { k: "at", p: 0, t: 0, r: 0, yes: true, by: 0 },
    { k: "at", p: 1, t: 1, r: 2, yes: true, by: 1 },
    { k: "at", p: 2, t: 0, r: 3, yes: true, by: 2 },
    { k: "own", p: 3, i: 1, yes: false, by: 3 },
  ],
  seed: 0,
};

/** fill: 시간대 칸 [t, p, 방] 또는 물건 칸 [-1, p, 물건] */
export interface TutStep {
  title: string;
  body: string;
  fill: [number, number, number][];
}
export const TUT_STEPS: TutStep[] = [
  {
    title: "먼저 확실한 것부터",
    body: "단서 1: 사냥칼은 강도현의 것. 강도현의 물건 칸을 눌러 사냥칼로 정해 보세요.",
    fill: [[-1, 2, 3]],
  },
  {
    title: "범인이 아니면 진술은 참",
    body: "사인은 둔기인데 강도현은 날붙이(사냥칼)를 지녔으니 범인이 아니에요. 범인만 거짓말을 하니 강도현의 말은 참 — 21:40엔 정원에 있었어요.",
    fill: [[0, 2, 3]],
  },
  {
    title: "거짓말쟁이를 하나씩 놓아 보기",
    body: "한정우나 민가을이 범인이라고 치면, 22:00 정원엔 강도현만 남아요. 그런데 22:00 정원 사람은 로프를 가졌고(단서 2) 강도현은 칼 → 모순. 그래서 범인은 윤서진, 22:00 서재에 있었어요.",
    fill: [[1, 1, 0]],
  },
  {
    title: "도면으로 동선 잇기",
    body: "서재는 거실하고만 이어져 있어요. 윤서진이 22:00에 서재에 들어가려면 21:40엔 서재나 거실 — 서재엔 한정우(참인 진술)가 있으니 윤서진은 거실. 남은 주방은 민가을이에요.",
    fill: [
      [0, 0, 0],
      [0, 1, 1],
      [0, 3, 2],
    ],
  },
  {
    title: "다음 시간대 채우기",
    body: "한정우는 서재에서 나와 거실로. 22:00 정원 사람은 로프를 가졌는데 강도현은 칼이니 정원은 민가을(로프), 강도현은 주방이에요.",
    fill: [
      [1, 0, 1],
      [1, 3, 3],
      [1, 2, 2],
      [-1, 3, 2],
    ],
  },
  {
    title: "흉기 가리기",
    body: "단서 3: 은촛대를 가진 사람은 키 171cm 미만 → 윤서진(164) 아니면 민가을(170). 민가을은 로프니 은촛대는 윤서진, 남은 청동 문진은 한정우.",
    fill: [
      [-1, 1, 1],
      [-1, 0, 0],
    ],
  },
];
