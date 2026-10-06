/**
 * 연습 모드 채보 — 패턴(계단·트릴·잭·동시치기·롱노트·섞기)을 구간마다 반복.
 * 난이도가 오를수록 더 잘게(2분 → 4분 → 8분 → 16분) 쪼개고, 잭은 더 길게, 동시치기는 더 자주.
 * 곡(신스 반주)은 music.ts의 PRACTICE — 여기선 그 곡의 마디 배치에 맞춰 노트만 만든다.
 */
import { finishChart, type Chart, type Difficulty, type Note } from "./chart";

/** 연습 구간 (이름 · 마디 수) — 곡 구간과 같은 순서 */
export const PRACTICE_SECTIONS: { key: Pattern | "intro" | "outro"; name: string; bars: number }[] =
  [
    { key: "intro", name: "준비", bars: 2 },
    { key: "stairs", name: "계단", bars: 8 },
    { key: "trill", name: "트릴", bars: 8 },
    { key: "jack", name: "잭", bars: 8 },
    { key: "chord", name: "동시치기", bars: 8 },
    { key: "hold", name: "롱노트", bars: 8 },
    { key: "mix", name: "섞어서", bars: 8 },
    { key: "outro", name: "끝", bars: 2 },
  ];

type Pattern = "stairs" | "trill" | "jack" | "chord" | "hold" | "mix";

/** 난이도별: 노트 간격(16분음표 수), 잭 길이, 동시치기 간격(노트 몇 개마다), 롱노트 옆 연타 간격 */
const LEVEL: Record<Difficulty, { sub: number; jack: number; chordEvery: number; tap: number }> = {
  easy: { sub: 8, jack: 2, chordEvery: 4, tap: 8 },
  normal: { sub: 4, jack: 2, chordEvery: 4, tap: 4 },
  hard: { sub: 2, jack: 3, chordEvery: 2, tap: 2 },
  expert: { sub: 1, jack: 4, chordEvery: 2, tap: 2 },
  nightmare: { sub: 1, jack: 4, chordEvery: 1, tap: 1 },
};

const STAIRS = [0, 1, 2, 3, 2, 1];
const STAIRS_FAST = [0, 1, 2, 3, 3, 2, 1, 0];
const TRILLS: [number, number][] = [
  [0, 1],
  [2, 3],
  [1, 2],
  [0, 3],
];
const JACK_LANES = [0, 2, 1, 3];
const SHAPES: [number, number][] = [
  [0, 1],
  [2, 3],
  [0, 3],
  [1, 2],
  [0, 2],
  [1, 3],
];

export function practiceCharts(bpm: number): Record<Difficulty, Chart> {
  const step = 60 / bpm / 4;
  const out = {} as Record<Difficulty, Chart>;
  for (const diff of Object.keys(LEVEL) as Difficulty[]) {
    const L = LEVEL[diff];
    const notes: Note[] = [];
    let bar0 = 0;
    for (const sec of PRACTICE_SECTIONS) {
      if (sec.key !== "intro" && sec.key !== "outro")
        for (let b = 0; b < sec.bars; b++) {
          // 섞어서: 마디마다 다른 패턴
          const pat: Pattern =
            sec.key === "mix" ? (["stairs", "trill", "jack", "chord"] as const)[b % 4] : sec.key;
          barNotes(notes, pat, b, (bar0 + b) * 16, step, L, diff);
        }
      bar0 += sec.bars;
    }
    out[diff] = finishChart(notes, diff);
  }
  return out;
}

function barNotes(
  notes: Note[],
  pat: Pattern,
  b: number,
  base: number,
  step: number,
  L: (typeof LEVEL)[Difficulty],
  diff: Difficulty
) {
  const at = (s: number) => +((base + s) * step).toFixed(4);
  const per = 16 / L.sub;
  const add = (s: number, lane: number, end?: number) =>
    notes.push(end ? { t: at(s), lane, end: at(end) } : { t: at(s), lane });
  if (pat === "hold") {
    if (diff === "easy" || diff === "normal") {
      // 한 손으로 길게 누르기: 마디(쉬움)·반 마디(보통)짜리 롱노트를 레인을 바꿔 가며
      const len = diff === "easy" ? 12 : 6;
      for (let s = 0; s < 16; s += len + (diff === "easy" ? 4 : 2))
        add(s, JACK_LANES[(b * 2 + s) % 4], s + len);
      return;
    }
    // 한 손은 한 마디 누르고, 다른 손은 연타
    const held = b % 2 === 0 ? 0 : 3;
    add(0, held, 14);
    const pair = held === 0 ? [2, 3] : [0, 1];
    for (let s = L.tap, k = 0; s < 16; s += L.tap, k++) add(s, pair[k % 2]);
    return;
  }
  for (let k = 0; k < per; k++) {
    const s = k * L.sub;
    const idx = b * per + k;
    if (pat === "stairs") add(s, (L.sub === 1 ? STAIRS_FAST : STAIRS)[idx % (L.sub === 1 ? 8 : 6)]);
    else if (pat === "trill") {
      const pr = TRILLS[Math.floor(b / 2) % TRILLS.length];
      add(s, pr[k % 2]);
    } else if (pat === "jack") {
      add(s, JACK_LANES[Math.floor(idx / L.jack) % JACK_LANES.length]);
    } else if (pat === "chord") {
      if (k % L.chordEvery === 0) {
        const [a, c] = SHAPES[Math.floor(idx / L.chordEvery) % SHAPES.length];
        add(s, a);
        add(s, c);
      } else {
        // 동시치기 사이 단노트는 바로 앞 모양과 안 겹치게
        const [a, c] = SHAPES[Math.floor(idx / L.chordEvery) % SHAPES.length];
        add(
          s,
          [0, 1, 2, 3].find((l) => l !== a && l !== c)!
        );
      }
    }
  }
}
