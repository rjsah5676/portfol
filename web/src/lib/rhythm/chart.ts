/**
 * 곡 이벤트 → 난이도별 4키 채보.
 * 멜로디 음높이로 레인을 정하고(높은 음 → 오른쪽), 드럼은 동시치기·채우기로 쓴다.
 * 같은 곡·난이도면 항상 같은 채보가 나오도록 시드 고정 난수를 쓴다.
 *
 * 패턴 사전 — 음악 흐름에 맞는 "손맛" 패턴을 구간별로 넣는다:
 *  - 계단(stairs): 멜로디가 3음 이상 한 방향으로 오르내리면 레인도 한 칸씩 같은 방향으로
 *  - 트릴(trill): 같은 음이 16분으로 4번 이상 반복되면 두 레인을 번갈아 (어려움 이상)
 *  - 롤(roll): 탐 필인은 3→2→1→0 처럼 레인을 쓸어내리며
 *  - 진입 동시치기(entry chord): 구간이 바뀌는 첫 박은 난이도만큼 동시치기
 */
import { starRating } from "./stars";
import type { Kind, MusicEvent, Song } from "./music";

export type Difficulty = "easy" | "normal" | "hard" | "expert" | "nightmare";
export const DIFFICULTIES: { key: Difficulty; label: string; color: string }[] = [
  { key: "easy", label: "쉬움", color: "#4ADE80" },
  { key: "normal", label: "보통", color: "#60A5FA" },
  { key: "hard", label: "어려움", color: "#F59E0B" },
  { key: "expert", label: "매우 어려움", color: "#F43F5E" },
  { key: "nightmare", label: "나이트메어", color: "#A855F7" },
];
/** 내장곡에서 이 난이도가 있는지 (나이트메어는 일부 곡만) */
export const hasDifficulty = (
  charts: Partial<Record<Difficulty, Chart>> | undefined,
  d: Difficulty
) => !charts || !!charts[d];

export interface Note {
  /** 판정 시각(초, 곡 시작 기준) */
  t: number;
  lane: number;
  /** 롱노트 끝 시각. 없으면 단노트 */
  end?: number;
}

export interface Chart {
  notes: Note[];
  level: number;
  /** 판정 단위 수 (롱노트는 머리+꼬리 2) */
  units: number;
}

interface Rule {
  /** 이 격자(16분음표 배수)에 있는 음만 */
  grid: number;
  /** 노트 사이 최소 간격(초) – 동시치기 제외 */
  minGap: number;
  /** 같은 레인 연타 최소 간격(초) */
  jackGap: number;
  /** 이 길이(16분음표) 이상 멜로디는 롱노트 */
  holdMin: number;
  /** 롱노트 포함 동시에 눌러야 하는 최대 개수 */
  maxPress: number;
  /** 멜로디 없는 곳을 채울 소스 */
  fill: Kind[];
  /** 동시치기로 얹을 드럼과 확률 */
  chord: { kinds: Kind[]; prob: number; onlyDownbeat: boolean };
  /** 롱노트 누르는 중에 다른 노트 허용 */
  notesDuringHold: boolean;
}

const RULES: Record<Difficulty, Rule> = {
  easy: {
    grid: 4,
    minGap: 0.32,
    jackGap: 0.9,
    holdMin: 8,
    maxPress: 1,
    fill: ["arp", "kick"],
    chord: { kinds: [], prob: 0, onlyDownbeat: true },
    notesDuringHold: false,
  },
  normal: {
    grid: 2,
    minGap: 0.16,
    jackGap: 0.45,
    holdMin: 6,
    maxPress: 2,
    fill: ["arp", "kick", "snare"],
    chord: { kinds: ["crash", "kick"], prob: 0.35, onlyDownbeat: true },
    notesDuringHold: false,
  },
  hard: {
    grid: 1,
    minGap: 0.11,
    jackGap: 0.22,
    holdMin: 4,
    maxPress: 2,
    fill: ["arp", "tom", "snare", "kick", "clap"],
    chord: { kinds: ["crash", "kick", "snare"], prob: 0.45, onlyDownbeat: false },
    notesDuringHold: true,
  },
  expert: {
    grid: 1,
    minGap: 0.07,
    jackGap: 0.15,
    holdMin: 4,
    maxPress: 3,
    fill: ["arp", "tom", "snare", "clap", "kick", "gtr"],
    chord: { kinds: ["crash", "kick", "snare", "clap"], prob: 0.8, onlyDownbeat: false },
    notesDuringHold: true,
  },
  nightmare: {
    grid: 1,
    minGap: 0.055,
    jackGap: 0.12,
    holdMin: 4,
    maxPress: 3,
    fill: ["arp", "tom", "snare", "clap", "kick", "gtr"],
    chord: { kinds: ["crash", "kick", "snare", "clap"], prob: 0.9, onlyDownbeat: false },
    notesDuringHold: true,
  },
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) =>
  [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

export function makeChart(song: Song, diff: Difficulty): Chart {
  const R = RULES[diff];
  const rand = rng(hash(song.id + diff));
  const stepSec = 60 / song.bpm / 4;
  const T = (step: number) => step * stepSec;

  const byStep = new Map<number, MusicEvent[]>();
  for (const e of song.events) {
    if (!byStep.has(e.step)) byStep.set(e.step, []);
    byStep.get(e.step)!.push(e);
  }
  const leads = song.events.filter((e) => e.kind === "lead");
  const arps = song.events.filter((e) => e.kind === "arp");

  // ── 패턴 사전: 이벤트 흐름에서 구간별 패턴 힌트를 미리 뽑아둠 ──
  type Hint =
    | { kind: "stairs"; dir: 1 | -1 }
    | { kind: "trill"; idx: number }
    | { kind: "roll"; idx: number; len: number };
  const hints = new Map<number, Hint>();
  {
    // 계단·트릴: 멜로디를 시간순으로 보며 연속 구간 찾기 (간격 ≤ 8분음표)
    const seq = [...leads].sort((a, b) => a.step - b.step);
    let i = 0;
    while (i < seq.length) {
      let j = i;
      const dir = Math.sign(seq[i + 1]?.midi! - seq[i].midi!) as 1 | -1 | 0;
      while (
        j + 1 < seq.length &&
        seq[j + 1].step - seq[j].step <= 2 &&
        Math.sign(seq[j + 1].midi! - seq[j].midi!) === dir
      )
        j++;
      const len = j - i + 1;
      if (dir !== 0 && len >= 3)
        for (let k = i; k <= j; k++) hints.set(seq[k].step, { kind: "stairs", dir });
      else if (dir === 0 && len >= 4 && R.grid === 1 && seq[j].step - seq[i].step <= len)
        for (let k = i; k <= j; k++) hints.set(seq[k].step, { kind: "trill", idx: k - i });
      i = len >= 3 ? j + 1 : i + 1;
    }
    // 롤: 탐이 한 마디 안에 3개 이상 이어지면
    const toms = song.events.filter((e) => e.kind === "tom").sort((a, b) => a.step - b.step);
    for (let a = 0; a < toms.length;) {
      let b = a;
      while (b + 1 < toms.length && toms[b + 1].step - toms[b].step <= 2) b++;
      const len = b - a + 1;
      if (len >= 3)
        for (let k = a; k <= b; k++) hints.set(toms[k].step, { kind: "roll", idx: k - a, len });
      a = b + 1;
    }
  }
  const sectionStarts = new Set(song.sections.map(([bar]) => bar * 16));

  // 레인 계산용: 근처 2마디 안의 음역
  const rangeAround = (list: MusicEvent[], step: number) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of list) {
      if (e.step < step - 16 || e.step > step + 16) continue;
      lo = Math.min(lo, e.midi!);
      hi = Math.max(hi, e.midi!);
    }
    return [lo, hi] as const;
  };
  const pitchLane = (list: MusicEvent[], e: MusicEvent) => {
    const [lo, hi] = rangeAround(list, e.step);
    if (hi <= lo) return Math.floor(rand() * 4);
    return Math.min(3, Math.floor(((e.midi! - lo) / (hi - lo + 1)) * 4));
  };

  const notes: Note[] = [];
  const laneLast = [-Infinity, -Infinity, -Infinity, -Infinity]; // 레인별 마지막 노트(끝) 시각
  const holdEnd = [-Infinity, -Infinity, -Infinity, -Infinity];
  let lastTime = -Infinity;
  let lastLane = 1;

  const activeHolds = (t: number) => holdEnd.filter((e) => e > t - 0.001).length;
  const free = (lane: number, t: number) =>
    holdEnd[lane] < t - 0.08 && t - laneLast[lane] >= R.jackGap - 1e-6;

  /** 원하는 레인이 막혀 있으면 가까운 빈 레인으로 */
  const pickLane = (want: number, t: number, avoid: number[] = []) => {
    const order = [0, 1, 2, 3].sort(
      (a, b) => Math.abs(a - want) - Math.abs(b - want) || rand() - 0.5
    );
    return order.find((l) => !avoid.includes(l) && free(l, t)) ?? -1;
  };

  const place = (lane: number, t: number, end?: number) => {
    notes.push(end ? { t, lane, end } : { t, lane });
    laneLast[lane] = end ?? t;
    if (end) holdEnd[lane] = end;
  };

  const lastStep = song.bars * 16;
  for (let step = 0; step < lastStep; step++) {
    if (step % R.grid) continue;
    const evs = byStep.get(step);
    if (!evs) continue;
    const t = T(step);
    if (t - lastTime < R.minGap - 1e-6) continue;
    const holds = activeHolds(t);
    if (holds && !R.notesDuringHold) continue;
    if (holds >= R.maxPress) continue;

    // 1) 주 노트: 멜로디 > 채우기 소스
    const lead = evs.find((e) => e.kind === "lead");
    let main: MusicEvent | undefined = lead;
    if (!main) for (const k of R.fill) if ((main = evs.find((e) => e.kind === k))) break;
    if (!main) continue;

    let want: number;
    const hint = hints.get(step);
    if (hint?.kind === "stairs" && main.kind === "lead") {
      // 계단: 직전 레인에서 한 칸씩 같은 방향으로, 끝에 닿으면 되돌아옴
      let next = lastLane + hint.dir;
      if (next < 0 || next > 3) next = lastLane - hint.dir;
      want = Math.max(0, Math.min(3, next));
    } else if (hint?.kind === "trill" && main.kind === "lead") {
      // 트릴: 음높이 레인과 그 옆 레인을 번갈아
      const base = pitchLane(leads, main);
      const other = base === 3 ? 2 : base + 1;
      want = hint.idx % 2 ? other : base;
    } else if (hint?.kind === "roll" && main.kind === "tom") {
      // 롤: 3 → 2 → 1 → 0 쓸어내리기 (길면 다시 올라감)
      const seqLane = [3, 2, 1, 0, 1, 2];
      want = seqLane[hint.idx % seqLane.length];
    } else if (main.kind === "lead") want = pitchLane(leads, main);
    else if (main.kind === "arp") want = pitchLane(arps, main);
    else if (main.kind === "kick") want = (step / 4) % 2 ? 3 : 0;
    else if (main.kind === "snare" || main.kind === "clap") want = (step / 8) % 2 ? 2 : 1;
    else want = (lastLane + 1 + Math.floor(rand() * 3)) % 4; // 하이햇 등: 직전과 다른 레인
    const lane = pickLane(want, t);
    if (lane < 0) continue;

    let end: number | undefined;
    const noteSec = main.len * stepSec;
    if (main.kind === "lead" && main.len >= R.holdMin && noteSec >= 0.35) {
      // 다음 멜로디 직전에 놓도록 1칸 짧게
      end = t + noteSec - stepSec;
      if (!R.notesDuringHold) {
        // 쉬움·보통: 롱노트 중에는 다른 노트가 없으니 끝을 조금 여유 있게
        end = t + noteSec - Math.min(stepSec * 2, noteSec * 0.25);
      }
    }
    place(lane, t, end);
    lastTime = t;
    lastLane = lane;

    // 2) 동시치기
    const pressing = activeHolds(t + 0.001); // 방금 놓은 롱노트 포함
    let count = end ? pressing : pressing + 1;
    const beat = step % 4 === 0;
    const down = step % 16 === 0;
    // 진입 동시치기: 구간이 바뀌는 첫 박은 확률 없이 꽉 채움 (쉬움은 제외)
    if (sectionStarts.has(step) && R.maxPress >= 2 && !end) {
      while (count < R.maxPress) {
        const l2 = pickLane(
          3 - lane,
          t,
          notes.filter((n) => n.t === t).map((n) => n.lane)
        );
        if (l2 < 0) break;
        place(l2, t);
        count++;
      }
    } else if (R.chord.prob > 0 && (R.chord.onlyDownbeat ? down : beat)) {
      for (const k of R.chord.kinds) {
        if (count >= R.maxPress) break;
        if (main.kind === k || !evs.some((e) => e.kind === k)) continue;
        if (rand() > R.chord.prob) continue;
        const l2 = pickLane(3 - lane, t, [lane]);
        if (l2 < 0) continue;
        place(l2, t);
        count++;
      }
    }
  }

  return finishChart(notes, diff);
}

/**
 * 화면에 보이는 레벨 구간 (난이도마다 이 안에서만). 나이트메어 위 등급이 생기면 19+
 */
export const LEVEL_BANDS: Record<Difficulty, [number, number]> = {
  easy: [1, 3],
  normal: [4, 6],
  hard: [7, 11],
  expert: [12, 14],
  nightmare: [15, 18],
};

/** 정렬 + 판정 단위 수 + 레벨 계산 (자동 채보에서도 같이 씀) */
export function finishChart(notes: Note[], diff: Difficulty = "normal"): Chart {
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  const units = notes.reduce((s, n) => s + (n.end ? 2 : 1), 0);
  // 레벨 = osu!mania 별점 × 4 (stars.ts). 자동 채보가 구간 안으로 맞춰 뽑고, 살짝 벗어나면 구간 끝으로
  const [lo, hi] = LEVEL_BANDS[diff];
  const level = Math.max(lo, Math.min(hi, Math.round(starRating(notes) * 4)));
  return { notes, level, units };
}
