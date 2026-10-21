/*
 * 픽셀 순찰대 — 챕터 (5분 판) · 챕터마다 스테이지 5개 (X-1 ~ X-4 = 3분 + 미니 보스, X-5 = 5분 + 챕터 보스). 판 엔진은 lib/survivor/sim 이 opts.chapter 로 받아서 돌림.
 * 공통 골격: 0:40 정예(첫 상자 3개) · 2:00 포위 · 2:30 중간 보스(큰 상자) · 3:20 정예 둘 · 4:10 최종 포위 · 5:00 챕터 보스
 * 브라우저 · 서버 공용 — "@/" import 금지.
 */
import type { ChapterDef, EnemyKind, Quest, StageKind, TimedEvent, WaveDef } from "../survivor/data";

/** 판 길이 (초) */
export const CH_LEN = 300;
/** 레벨업 경험치 배율 (1.2 = 20% 더 필요 — 5분에 Lv 35 안팎) · 별 3 보스 시간 */
const XP = 1.2;
export const BOSS_STAR = 45;

/** 잠든 골목 웨이브를 5분에 맞춤 (10분 → 5분) */
const TOWN5: WaveDef[] = [
  { at: 0, mix: { bat: 6, slime: 4 }, count: 34, rate: 4 },
  { at: 22, mix: { bat: 5, slime: 5 }, count: 55, rate: 5.5 },
  { at: 45, mix: { bat: 4, slime: 4, ghost: 3 }, count: 75, rate: 6.5 },
  { at: 75, mix: { slime: 3, ghost: 4, bat: 3 }, count: 100, rate: 7.5 },
  { at: 105, mix: { ghost: 3, skull: 4, bat: 2 }, count: 125, rate: 8.5 },
  { at: 135, mix: { skull: 5, ghost: 3, slime: 2 }, count: 145, rate: 9.5 },
  { at: 165, mix: { skull: 4, mush: 3, bat: 3 }, count: 170, rate: 11 },
  { at: 195, mix: { mush: 4, skull: 4, ghost: 2 }, count: 195, rate: 12.5 },
  { at: 225, mix: { mush: 4, golem: 2, skull: 3 }, count: 225, rate: 14 },
  { at: 255, mix: { golem: 3, mush: 4, bat: 4 }, count: 265, rate: 17 },
  { at: 280, mix: { golem: 4, mush: 3, skull: 3, bat: 3 }, count: 300, rate: 20 },
];

/** 분수대 광장: 박쥐 대신 슬라임 · 유령, 버섯 · 골렘이 일찍 */
const PLAZA5: WaveDef[] = [
  { at: 0, mix: { slime: 6, ghost: 3 }, count: 34, rate: 4 },
  { at: 22, mix: { slime: 5, ghost: 4 }, count: 55, rate: 5.5 },
  { at: 45, mix: { slime: 4, ghost: 4, skull: 2 }, count: 75, rate: 6.5 },
  { at: 75, mix: { ghost: 4, skull: 3, slime: 3 }, count: 100, rate: 7.5 },
  { at: 105, mix: { skull: 4, mush: 2, ghost: 3 }, count: 125, rate: 8.5 },
  { at: 135, mix: { skull: 4, mush: 3, slime: 3 }, count: 145, rate: 9.5 },
  { at: 165, mix: { mush: 4, skull: 3, ghost: 3 }, count: 170, rate: 11 },
  { at: 195, mix: { mush: 4, skull: 3, golem: 1 }, count: 195, rate: 12.5 },
  { at: 225, mix: { golem: 2, mush: 4, ghost: 3 }, count: 225, rate: 14 },
  { at: 255, mix: { golem: 3, mush: 4, slime: 4 }, count: 265, rate: 17 },
  { at: 280, mix: { golem: 4, mush: 3, skull: 3, ghost: 3 }, count: 300, rate: 20 },
];

/** 시계탑 아래: 태엽 장난감 (시계탑 광장 웨이브를 5분에) */
const CLOCK5: WaveDef[] = [
  { at: 0, mix: { mouse: 6, bat: 4 }, count: 34, rate: 4 },
  { at: 22, mix: { mouse: 5, bat: 3, cuckoo: 2 }, count: 55, rate: 5.5 },
  { at: 45, mix: { mouse: 4, cuckoo: 4, ghost: 2 }, count: 75, rate: 6.5 },
  { at: 75, mix: { cuckoo: 4, mouse: 3, tin: 2 }, count: 100, rate: 7.5 },
  { at: 105, mix: { tin: 4, cuckoo: 3, mouse: 2 }, count: 125, rate: 8.5 },
  { at: 135, mix: { tin: 5, cuckoo: 3, mouse: 2 }, count: 145, rate: 9.5 },
  { at: 165, mix: { tin: 4, gear: 3, mouse: 3 }, count: 170, rate: 11 },
  { at: 195, mix: { gear: 4, tin: 4, cuckoo: 2 }, count: 195, rate: 12.5 },
  { at: 225, mix: { gear: 4, hourglass: 2, tin: 3 }, count: 225, rate: 14 },
  { at: 255, mix: { hourglass: 3, gear: 4, mouse: 4 }, count: 265, rate: 17 },
  { at: 280, mix: { hourglass: 4, gear: 3, tin: 3, cuckoo: 3 }, count: 300, rate: 20 },
];

/** 구역 2 — 부둣가: 게 · 갈매기 → 해골 선원 */
const DOCK5: WaveDef[] = [
  { at: 0, mix: { crab: 6, gull: 4 }, count: 36, rate: 4.2 },
  { at: 22, mix: { crab: 5, gull: 4, sailor: 1 }, count: 58, rate: 5.8 },
  { at: 45, mix: { crab: 4, gull: 3, sailor: 3 }, count: 78, rate: 6.8 },
  { at: 75, mix: { sailor: 4, crab: 3, gull: 3 }, count: 104, rate: 7.8 },
  { at: 105, mix: { sailor: 5, crab: 3, gull: 2 }, count: 128, rate: 8.8 },
  { at: 135, mix: { sailor: 5, crab: 4, gull: 2 }, count: 150, rate: 9.8 },
  { at: 165, mix: { sailor: 4, crab: 4, gull: 3 }, count: 175, rate: 11.3 },
  { at: 195, mix: { sailor: 5, crab: 4, gull: 2 }, count: 200, rate: 12.8 },
  { at: 225, mix: { sailor: 5, crab: 3, gull: 3 }, count: 230, rate: 14.3 },
  { at: 255, mix: { sailor: 5, crab: 4, gull: 4 }, count: 270, rate: 17.3 },
  { at: 280, mix: { sailor: 6, crab: 4, gull: 4 }, count: 305, rate: 20.5 },
];
/** 어시장: + 유령 해파리 */
const MARKET5: WaveDef[] = [
  { at: 0, mix: { crab: 5, gull: 4, jelly: 1 }, count: 36, rate: 4.2 },
  { at: 22, mix: { crab: 4, gull: 3, jelly: 3 }, count: 58, rate: 5.8 },
  { at: 45, mix: { jelly: 4, sailor: 2, gull: 3 }, count: 78, rate: 6.8 },
  { at: 75, mix: { jelly: 4, sailor: 3, crab: 3 }, count: 104, rate: 7.8 },
  { at: 105, mix: { sailor: 4, jelly: 4, gull: 2 }, count: 128, rate: 8.8 },
  { at: 135, mix: { sailor: 4, jelly: 4, crab: 2 }, count: 150, rate: 9.8 },
  { at: 165, mix: { sailor: 4, jelly: 4, gull: 3 }, count: 175, rate: 11.3 },
  { at: 195, mix: { sailor: 5, jelly: 4, crab: 2 }, count: 200, rate: 12.8 },
  { at: 225, mix: { sailor: 4, jelly: 5, gull: 3 }, count: 230, rate: 14.3 },
  { at: 255, mix: { sailor: 5, jelly: 4, crab: 4 }, count: 270, rate: 17.3 },
  { at: 280, mix: { sailor: 5, jelly: 5, gull: 4 }, count: 305, rate: 20.5 },
];
/** 등대섬: + 따개비 골렘 */
const ISLE5: WaveDef[] = [
  { at: 0, mix: { crab: 5, jelly: 3, gull: 2 }, count: 36, rate: 4.2 },
  { at: 22, mix: { crab: 4, jelly: 3, sailor: 2 }, count: 58, rate: 5.8 },
  { at: 45, mix: { sailor: 4, jelly: 3, crab: 3 }, count: 78, rate: 6.8 },
  { at: 75, mix: { sailor: 4, jelly: 3, barnacle: 1 }, count: 104, rate: 7.8 },
  { at: 105, mix: { sailor: 4, jelly: 4, barnacle: 1 }, count: 128, rate: 8.8 },
  { at: 135, mix: { sailor: 4, barnacle: 2, crab: 3 }, count: 150, rate: 9.8 },
  { at: 165, mix: { sailor: 4, barnacle: 2, jelly: 3 }, count: 175, rate: 11.3 },
  { at: 195, mix: { barnacle: 3, sailor: 4, gull: 3 }, count: 200, rate: 12.8 },
  { at: 225, mix: { barnacle: 3, sailor: 4, jelly: 3 }, count: 230, rate: 14.3 },
  { at: 255, mix: { barnacle: 3, sailor: 5, crab: 4 }, count: 270, rate: 17.3 },
  { at: 280, mix: { barnacle: 4, sailor: 5, jelly: 4 }, count: 305, rate: 20.5 },
];

/** 공통 골격 + 챕터 기믹 */
const ev = (o: { elite1: EnemyKind; ring1: [EnemyKind, number]; mid: TimedEvent; elite2: EnemyKind; ring2: [EnemyKind, number]; final: EnemyKind; extra?: TimedEvent[] }): TimedEvent[] =>
  [
    { at: 40, k: "elite", kind: o.elite1 } as TimedEvent,
    { at: 120, k: "ring", kind: o.ring1[0], n: o.ring1[1] } as TimedEvent,
    o.mid,
    { at: 200, k: "elite", kind: o.elite2, n: 2 } as TimedEvent,
    { at: 250, k: "ring", kind: o.ring2[0], n: o.ring2[1] } as TimedEvent,
    { at: CH_LEN, k: "boss", kind: o.final, arena: true } as TimedEvent,
    ...(o.extra ?? []),
  ].sort((a, b) => a.at - b.at);
const base = { len: CH_LEN, xp: XP, bossStar: BOSS_STAR };

export const CHAPTERS: ChapterDef[] = [
  {
    ...base,
    id: 1,
    name: "골목 입구",
    tip: "꺼진 가로등 — 옆에 서 있으면 켜지며 주변 적을 태워요",
    stage: "town",
    waves: TOWN5,
    // 기믹: 꺼진 가로등 지키기 (1:20 · 3:20)
    events: ev({ elite1: "slime", ring1: ["bat", 28], mid: { at: 150, k: "elite", kind: "skull" }, elite2: "slime", ring2: ["ghost", 26], final: "boss_jelly", extra: [{ at: 80, k: "lamps", n: 3 }, { at: 205, k: "lamps", n: 3 }] }),
    hp: 1,
    dmg: 0.9,
    final: "boss_jelly",
    boss: { boss_jelly: { order: ["warn", "slam", "ring", "summon"], minion: "bat" } },
  },
  {
    ...base,
    id: 2,
    name: "분수대 광장",
    tip: "분수 물보라 — 원 안 적은 기절, 안에 서 있으면 젬이 몰려와요",
    stage: "town",
    waves: PLAZA5,
    // 광장: 분수 · 꽃밭 · 벤치가 많음
    deco: [
      { k: "fountain", w: 4, light: true },
      { k: "flowers", w: 7 },
      { k: "bench", w: 4 },
      { k: "bush", w: 4 },
      { k: "tree", w: 3 },
      { k: "well", w: 2 },
      { k: "statue", w: 1.5 },
      { k: "mailbox", w: 1.5 },
      { k: "pumpkin", w: 1.5, light: true },
    ],
    // 기믹: 40초마다 분수 물보라 (적 기절 · 젬 모음)
    events: ev({
      elite1: "slime",
      ring1: ["slime", 34],
      mid: { at: 150, k: "boss", kind: "boss_jelly", arena: false },
      elite2: "skull",
      ring2: ["ghost", 30],
      final: "boss_clock",
      extra: [60, 100, 140, 180, 220, 260].map((at) => ({ at, k: "spout" }) as TimedEvent),
    }),
    hp: 1.25,
    dmg: 1,
    final: "boss_clock",
  },
  {
    ...base,
    id: 3,
    name: "시계탑 아래",
    tip: "자정의 종 — 70초마다 적이 빨라지고 경험치 두 배",
    stage: "clock",
    waves: CLOCK5,
    // 기믹: 자정의 종 — 70초마다 12초 동안 적이 빨라지고 경험치 두 배
    toll: { from: 70, every: 70, dur: 12 },
    events: ev({ elite1: "tin", ring1: ["mouse", 40], mid: { at: 150, k: "boss", kind: "boss_cuckoo", arena: false }, elite2: "gear", ring2: ["cuckoo", 36], final: "boss_tower" }),
    hp: 2.15,
    dmg: 1.3,
    final: "boss_tower",
  },
];
// ───── 구역 2 「안개 항구」 ─────
CHAPTERS.push(
  {
    ...base,
    id: 4,
    name: "부둣가",
    tip: "밀물 — 물에 잠긴 곳의 적은 느리고 약해져요",
    stage: "harbor",
    waves: DOCK5,
    // 기믹: 밀물 (50초마다 12초)
    tide: { from: 50, every: 50, dur: 12 },
    events: ev({ elite1: "sailor", ring1: ["crab", 36], mid: { at: 150, k: "boss", kind: "boss_crab", arena: false }, elite2: "sailor", ring2: ["gull", 34], final: "boss_crab" }),
    hp: 2.75,
    dmg: 1.45,
    final: "boss_crab",
    boss: { boss_crab: { order: ["warn", "slam", "summon", "warn", "ring", "slam"], minion: "crab" } },
  },
  {
    ...base,
    id: 5,
    name: "어시장",
    tip: "안개 — 시야가 좁아지지만 처치 코인이 늘어요",
    stage: "harbor",
    waves: MARKET5,
    deco: [
      { k: "stall", w: 5, light: true },
      { k: "fishbox", w: 5 },
      { k: "barrels", w: 3 },
      { k: "cargo", w: 3 },
      { k: "net", w: 3 },
      { k: "trap", w: 2 },
      { k: "docklamp", w: 2, light: true },
    ],
    // 기믹: 안개 (60초마다 15초)
    fog: { from: 55, every: 60, dur: 15 },
    events: ev({ elite1: "jelly", ring1: ["jelly", 32], mid: { at: 150, k: "boss", kind: "boss_crab", arena: false }, elite2: "sailor", ring2: ["sailor", 34], final: "boss_captain" }),
    hp: 3.5,
    dmg: 1.55,
    final: "boss_captain",
  },
  {
    ...base,
    id: 6,
    name: "등대섬",
    tip: "도는 등대 빛 — 빛 안에 서면 회복, 빛에 닿은 적은 타요",
    stage: "isle",
    waves: ISLE5,
    // 기믹: 판 가운데 등대 빛줄기 두 갈래
    beacon: { speed: 0.32 },
    events: ev({ elite1: "barnacle", ring1: ["crab", 40], mid: { at: 150, k: "boss", kind: "boss_captain", arena: false }, elite2: "sailor", ring2: ["jelly", 38], final: "boss_kraken" }),
    hp: 4.6,
    dmg: 1.75,
    final: "boss_kraken",
  }
);
export const CH_COUNT = CHAPTERS.length;
export const chapter = (id: number): ChapterDef | undefined => CHAPTERS[id - 1];
/** 챕터 보상 배율 */
export const chMul = (id: number) => 1 + (id - 1) * 0.25;

/* ───────────── 스테이지: 챕터마다 5개 (맵 · 몹 · 기믹은 챕터 것, 배율만 올라감) ───────────── */

export const SUB = 5;
export const ST_COUNT = CH_COUNT * SUB;
/** 순찰대원 합류: 이 스테이지(번호)를 깨면 (반디는 처음부터) — 구역 끝 보스마다 한 명 */
export const HERO_UNLOCK = { bandi: 0, seolhee: 30 } as const;
export type PatrolHero = keyof typeof HERO_UNLOCK;
export const PATROL_HEROES = Object.keys(HERO_UNLOCK) as PatrolHero[];
export const heroOpen = (h: PatrolHero, bestSt: number) => bestSt >= HERO_UNLOCK[h];
/** 짧은 스테이지 길이 (초) */
export const SHORT_LEN = 180;
export const stCh = (st: number) => Math.ceil(st / SUB);
export const stSub = (st: number) => st - (stCh(st) - 1) * SUB;
export const stName = (st: number) => `${stCh(st)}-${stSub(st)}`;
export const stLen = (st: number) => (stSub(st) === SUB ? CH_LEN : SHORT_LEN);
export const firstSt = (ch: number) => (ch - 1) * SUB + 1;

/** 스테이지별 적 체력 · 피해 배율 (챕터 안 1~5) */
const RAMP: Record<number, { hp: number[]; dmg: number[] }> = {
  1: { hp: [0.7, 0.75, 0.8, 0.85, 1], dmg: [0.7, 0.75, 0.8, 0.85, 0.9] },
  2: { hp: [1, 1.05, 1.1, 1.15, 1.2], dmg: [0.9, 0.92, 0.94, 0.96, 0.95] },
  3: { hp: [1.6, 1.7, 1.8, 1.95, 2.15], dmg: [1.1, 1.15, 1.2, 1.25, 1.3] },
  4: { hp: [1.9, 2.0, 2.1, 2.2, 2.25], dmg: [1.25, 1.28, 1.3, 1.33, 1.38] },
  5: { hp: [2.4, 2.5, 2.6, 2.75, 2.9], dmg: [1.38, 1.4, 1.43, 1.45, 1.48] },
  6: { hp: [3.0, 3.1, 3.2, 3.3, 4.2], dmg: [1.5, 1.53, 1.56, 1.6, 1.65] },
};
/** 짧은 스테이지 재료: 정예 · 포위 몹 · 미니 보스 · 기믹 · 특수 판 목표 */
type Short = {
  elite: EnemyKind;
  ring: [EnemyKind, number];
  elite2: EnemyKind;
  mini: EnemyKind;
  extra: TimedEvent[];
  toll?: ChapterDef["toll"];
  /** X-2 기믹 판: 기믹이 두 배 */
  gimmick: { extra: TimedEvent[]; toll?: ChapterDef["toll"]; tide?: ChapterDef["tide"]; fog?: ChapterDef["fog"]; tip: string };
  /** 짧은 판 밀물 · 안개 */
  tide?: ChapterDef["tide"];
  fog?: ChapterDef["fog"];
  /** X-4 포위 판: 돌아가며 에워싸는 몹 */
  siege: EnemyKind[];
  /** X-3 특수 판 */
  special: Quest["k"];
};
const spouts = (ats: number[]) => ats.map((at) => ({ at, k: "spout" }) as TimedEvent);
const SHORT: Record<number, Short> = {
  1: {
    elite: "slime",
    ring: ["bat", 22],
    elite2: "skull",
    mini: "boss_jelly",
    extra: [{ at: 60, k: "lamps", n: 3 }],
    gimmick: { extra: [25, 75, 130].map((at) => ({ at, k: "lamps", n: 3 }) as TimedEvent), tip: "가로등이 세 번 — 켤수록 편해져요" },
    siege: ["bat", "ghost", "slime", "skull", "bat"],
    special: "goblin",
  },
  2: {
    elite: "slime",
    ring: ["slime", 26],
    elite2: "skull",
    mini: "boss_jelly",
    extra: spouts([45, 85, 125]),
    gimmick: { extra: spouts([25, 50, 75, 100, 125, 150]), tip: "분수가 25초마다 — 원 안으로 끌고 와서 한 방" },
    siege: ["slime", "ghost", "skull", "slime", "mush"],
    special: "rush",
  },
  3: {
    elite: "tin",
    ring: ["mouse", 30],
    elite2: "gear",
    mini: "boss_cuckoo",
    extra: [],
    toll: { from: 50, every: 70, dur: 12 },
    gimmick: { extra: [], toll: { from: 30, every: 45, dur: 12 }, tip: "종이 45초마다 — 빨라진 적을 경험치 두 배로" },
    siege: ["mouse", "cuckoo", "tin", "mouse", "gear"],
    special: "guard",
  },
  4: {
    elite: "sailor",
    ring: ["crab", 30],
    elite2: "crab",
    mini: "boss_crab",
    extra: [],
    tide: { from: 40, every: 60, dur: 12 },
    gimmick: { extra: [], tide: { from: 20, every: 32, dur: 12 }, tip: "밀물이 32초마다 — 적을 물로 몰아서 잡아요" },
    siege: ["crab", "gull", "sailor", "crab", "gull"],
    special: "goblin",
  },
  5: {
    elite: "jelly",
    ring: ["jelly", 30],
    elite2: "sailor",
    mini: "boss_crab",
    extra: [],
    fog: { from: 45, every: 70, dur: 15 },
    gimmick: { extra: [], fog: { from: 20, every: 40, dur: 15 }, tip: "안개가 40초마다 — 코인을 쓸어 담을 기회" },
    siege: ["jelly", "gull", "sailor", "crab", "jelly"],
    special: "guard",
  },
  6: {
    elite: "sailor",
    ring: ["crab", 32],
    elite2: "barnacle",
    mini: "boss_captain",
    extra: [],
    gimmick: { extra: [], tip: "등대 빛이 두 배 빨리 돌아요 — 빛을 따라 달려요" },
    siege: ["crab", "jelly", "sailor", "gull", "barnacle"],
    special: "rush",
  },
};
/** 챕터 안 번호 → 판 종류 */
export const SUB_KIND: StageKind[] = ["basic", "gimmick", "special", "siege", "boss"];
/** 특수 판 목표 · 로비 한 줄 */
const SPECIAL: Record<Quest["k"], { q: Quest; tip: string; ev: TimedEvent[] }> = {
  goblin: { q: { k: "goblin", n: 3 }, tip: "보물 도깨비 셋 — 맞을 때마다 금화, 15초 뒤엔 도망", ev: [20, 75, 130].map((at) => ({ at, k: "goblin" }) as TimedEvent) },
  rush: {
    q: { k: "rush", n: 8 },
    tip: "정예 러시 — 정예 8마리, 잡을 때마다 보물 상자",
    ev: [
      [20, 1],
      [45, 1],
      [70, 2],
      [100, 2],
      [130, 2],
    ].map(([at, n]) => ({ at, k: "elite", kind: "skull", n }) as TimedEvent),
  },
  guard: { q: { k: "guard" }, tip: "등불 지키기 — 적의 절반이 등불을 노려요, 2분 버티면 상자", ev: [{ at: 15, k: "guard", until: 150 }] },
};

/** 스테이지 정의 (전체 번호 st) */
export function stage(st: number): ChapterDef | undefined {
  const ch = chapter(stCh(st));
  if (!ch || st < 1) return undefined;
  const sub = stSub(st);
  const r = RAMP[ch.id];
  const hp = r.hp[sub - 1];
  const dmg = r.dmg[sub - 1];
  const kind = SUB_KIND[sub - 1];
  if (sub === SUB) return { ...ch, st, sub, hp, dmg, kind };
  const o = SHORT[ch.id];
  const mini: TimedEvent = { at: SHORT_LEN, k: "boss", kind: o.mini, arena: true };
  let events: TimedEvent[];
  let toll = o.toll ?? ch.toll;
  let tide = o.tide ?? ch.tide;
  let fog = o.fog ?? ch.fog;
  let beacon = ch.beacon;
  let tip = ch.tip;
  let quest: Quest | undefined;
  if (kind === "gimmick") {
    events = [{ at: 30, k: "elite", kind: o.elite }, { at: 100, k: "ring", kind: o.ring[0], n: o.ring[1] + 4 }, { at: 140, k: "elite", kind: o.elite2 }, ...o.gimmick.extra];
    toll = o.gimmick.toll ?? toll;
    tide = o.gimmick.tide ?? tide;
    fog = o.gimmick.fog ?? fog;
    if (beacon) beacon = { speed: beacon.speed * 2 };
    tip = o.gimmick.tip;
  } else if (kind === "special") {
    const sp = SPECIAL[o.special];
    // 정예 러시는 그 챕터 정예로
    const ev = o.special === "rush" ? sp.ev.map((e) => (e.k === "elite" ? { ...e, kind: ([o.elite, o.elite2] as EnemyKind[])[Math.round(e.at / 25) % 2] } : e)) : sp.ev;
    events = [...ev, { at: 100, k: "ring", kind: o.ring[0], n: o.ring[1] }];
    if (o.special !== "rush") events.push({ at: 40, k: "elite", kind: o.elite });
    quest = sp.q;
    tip = sp.tip;
    toll = tide = fog = undefined;
  } else if (kind === "siege") {
    // 포위 판: 30초마다 사방에서 · 갈수록 두껍게
    events = [
      ...o.siege.map((k, i) => ({ at: 25 + i * 30, k: "ring", kind: k, n: o.ring[1] - 6 + i * 3 }) as TimedEvent),
      { at: 75, k: "elite", kind: o.elite },
      { at: 140, k: "elite", kind: o.elite2, n: 2 },
    ];
    tip = "포위 — 30초마다 사방에서 몰려와요, 대시로 뚫고 나가기";
    toll = tide = fog = undefined;
  } else {
    events = [{ at: 30, k: "elite", kind: o.elite }, { at: 100, k: "ring", kind: o.ring[0], n: o.ring[1] + sub * 2 }, { at: 140, k: "elite", kind: o.elite2 }, ...o.extra];
  }
  events.push(mini);
  events.sort((a, b) => a.at - b.at);
  return {
    ...ch,
    st,
    sub,
    kind,
    quest,
    tip,
    len: SHORT_LEN,
    waves: ch.waves.filter((w) => w.at < SHORT_LEN),
    events,
    final: o.mini,
    hp,
    dmg,
    bossStar: 30,
    toll,
    tide,
    fog,
    beacon,
  };
}

/** 추천 전투력 (봇 시뮬로 클리어 80% 안팎이 되는 장비 전투력) — 스테이지 번호 순 */
const REC_POWER = [100, 100, 110, 120, 130, 150, 170, 190, 210, 260, 500, 560, 620, 700, 800, 850, 900, 950, 1000, 1100, 1150, 1200, 1260, 1320, 1450, 1500, 1580, 1660, 1750, 1900];
export const recPower = (st: number) => REC_POWER[st - 1] ?? REC_POWER[REC_POWER.length - 1];
