/**
 * 리듬게임 곡 데이터.
 *  - 음원 곡: AI 자작곡 mp3 + 미리 분석해 둔 고정 채보(JSON)
 *  - 신스 곡(지금은 없음): 16분음표 격자 이벤트로 작곡 → synth.ts가 소리를, chart.ts가 채보를 같은 이벤트에서 만듦.
 *    작곡 엔진(build/SongSpec)은 나중에 다시 쓸 수 있게 남겨 둠.
 */

import type { Chart, Difficulty } from "./chart";
import { PRACTICE_SECTIONS, practiceCharts } from "./practice";
import jiljuData from "@/data/rhythm/jilju.json";
import natsuData from "@/data/rhythm/natsukasumi.json";
import rinkakuData from "@/data/rhythm/rinkaku.json";
import newdimData from "@/data/rhythm/newdim.json";
import monarchData from "@/data/rhythm/monarch.json";
import velocityData from "@/data/rhythm/velocity.json";
import fullcomboData from "@/data/rhythm/fullcombo.json";
import animaData from "@/data/rhythm/anima.json";
import freedomdiveData from "@/data/rhythm/freedomdive.json";
import aragamiData from "@/data/rhythm/aragami.json";

export type Kind =
  | "kick"
  | "snare"
  | "clap"
  | "hat"
  | "ohat"
  | "crash"
  | "tom"
  | "bass"
  | "gtr"
  | "lead"
  | "arp"
  | "pad"
  /** 노이즈 스윕(드롭 직전 긴장감). 채보에는 안 들어감 */
  | "riser";

export interface MusicEvent {
  /** 곡 시작부터 16분음표 단위 위치 */
  step: number;
  kind: Kind;
  midi?: number;
  /** 길이(16분음표 수) */
  len: number;
  vel: number;
  /** 피아노: 서스테인 페달 (마디 끝까지 울림) */
  pedal?: boolean;
}

export interface SoundSet {
  /** supersaw: 톱니파 여러 개를 살짝 어긋나게 겹친 두꺼운 리드
   *  piano: 리드·아르페지오·베이스를 전부 피아노 음색으로
   *  gtrlead: 디스토션 걸린 리드 기타 (밴드 사운드) */
  lead: OscillatorType | "supersaw" | "piano" | "gtrlead";
  arp: OscillatorType;
  /** 리드 딜레이 길이(16분음표 수) */
  delaySteps: number;
  /** 리드 음량 배율 (기본 1) */
  leadGain?: number;
  /** 드럼 음량 배율 (기본 1) */
  drums?: number;
  /** 피아노 리드 위에 슈퍼쏘 신스를 얇게 겹침 (클래식 + EDM) */
  layer?: boolean;
  /** 사이드체인: 킥마다 패드·아르페지오·베이스가 눌렸다 올라옴 (펌핑) */
  pump?: boolean;
  /** 밝은 톤: 저음·디스토션을 줄이고 고역을 열어서 가볍게 (K-팝 밴드) */
  bright?: boolean;
}

export interface Song {
  id: string;
  title: string;
  bpm: number;
  bars: number;
  /** 소리가 끝나는 시점(초) */
  duration: number;
  events: MusicEvent[];
  /** 구간 이름 [시작 마디, 이름] – 진행 바 표시용 */
  sections: [number, string][];
  sound: SoundSet;
  color: string;
  desc: string;
  /** 제작자(아티스트) — 외부 곡은 반드시 표기 (곡 선택·플레이 화면·결과·랭킹 이름에 같이 나옴) */
  artist?: string;
  /** 첫 박 시각(초). 직접 넣은 음악처럼 0초에 박이 시작하지 않을 때 */
  beatOffset?: number;
  /** 화면에 보여줄 BPM (12/8·셔플 곡은 분석 비트가 점4분음표라 1.5배로 환산). 없으면 bpm */
  bpmLabel?: number;
  /** 사용자가 넣은 음악 (랭킹 없음) */
  custom?: boolean;
  /** 연습곡 (패턴 연습, 랭킹 없음) */
  practice?: boolean;
  /** 재킷 그림 주소 (내 음악: 파일에 든 앨범 사진, 없으면 기본 그림) */
  cover?: string;
  /** 음원 파일로 재생하는 곡 (신스 렌더 대신 이 파일을 불러옴) */
  audio?: string;
  /** 음원 곡의 고정 채보 (미리 분석해 둔 것 — 모두 같은 채보로 쳐서 랭킹이 공정함). 나이트메어는 일부 곡만 */
  charts?: Partial<Record<Difficulty, Chart>>;
}

// ───────────────────────── 작곡용 헬퍼 ─────────────────────────

const NOTE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/** "f#5" → 78 */
export function midiOf(name: string): number {
  const m = /^([a-g])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

/** "e5 - - - . c5 - ..." (16칸) → 음표 목록. '-'는 앞 음 늘이기, '.'는 쉼표 */
function parseBar(bar: string): { at: number; midi: number; len: number }[] {
  const tokens = bar.trim().split(/\s+/);
  if (tokens.length !== 16) throw new Error(`bar must have 16 tokens: "${bar}"`);
  const out: { at: number; midi: number; len: number }[] = [];
  tokens.forEach((t, i) => {
    if (t === "-") {
      if (out.length && out[out.length - 1].at + out[out.length - 1].len === i)
        out[out.length - 1].len++;
    } else if (t !== ".") out.push({ at: i, midi: midiOf(t), len: 1 });
  });
  return out;
}

type Drum = string | string[];
interface Section {
  name: string;
  bars: number;
  kick?: Drum;
  snare?: Drum;
  clap?: Drum;
  hat?: Drum;
  ohat?: Drum;
  crash?: Drum;
  /** 탐 필인: x 위치마다 높은 탐 → 낮은 탐 순서로 */
  tom?: Drum;
  bass?: "pulse" | "octave" | "root" | "half";
  /** 파워코드 기타: 8분 뮤트 연주(chug) / 한 마디 길게(sustain) */
  gtr?: "chug" | "sustain";
  /** 이 구간만 쓰는 코드 진행 (마디마다, 모자라면 반복) */
  chords?: string[][];
  /** 이 구간 음 높이를 반음 단위로 올림 (마지막 후렴 전조) */
  transpose?: number;
  pad?: boolean;
  /** 아르페지오 간격(16분음표 수) */
  arp?: 1 | 2;
  /** 아르페지오 음량 (기본 1) – 멜로디를 받쳐줘야 하는 구간에서 낮춤 */
  arpVel?: number;
  /** 마디별 멜로디 (모자라면 반복) */
  lead?: string[];
  /** 피아노 페달: true면 전부, "acc"면 반주(베이스·아르페지오)만 마디 끝까지 울림 */
  pedal?: boolean | "acc";
  /** 구간 끝 n마디 동안 노이즈 라이저 (다음 구간 드롭 예고) */
  riser?: number;
  /** 하이햇을 16분으로 (x = 세게, o = 여리게) */
  hat16?: boolean;
}

interface SongSpec {
  id: string;
  title: string;
  bpm: number;
  /** 마디마다 코드 (4마디 반복): [베이스 루트, ...코드 구성음] */
  chords: string[][];
  sections: Section[];
  sound: SoundSet;
  color: string;
  desc: string;
}

/** 16분 하이햇 패턴 (x = 세게, o = 여리게) — Section.hat16 */
const HAT16 = "xoxoxoxoxoxoxoxo";

const drumAt = (d: Drum | undefined, bar: number) =>
  d === undefined ? "" : typeof d === "string" ? d : d[bar % d.length];

function build(spec: SongSpec): Song {
  const events: MusicEvent[] = [];
  const sections: [number, string][] = [];
  let bar0 = 0;
  for (const sec of spec.sections) {
    sections.push([bar0, sec.name]);
    const secStart = events.length;
    for (let b = 0; b < sec.bars; b++) {
      const base = (bar0 + b) * 16;
      const chord = sec.chords
        ? sec.chords[b % sec.chords.length]
        : spec.chords[(bar0 + b) % spec.chords.length];
      const tr = sec.transpose ?? 0;
      const root = midiOf(chord[0]) + tr;
      const tones = chord.slice(1).map((n) => midiOf(n) + tr);

      const drums: [Kind, Drum | undefined][] = [
        ["kick", sec.kick],
        ["snare", sec.snare],
        ["clap", sec.clap],
        ["hat", sec.hat16 ? HAT16 : sec.hat],
        ["ohat", sec.ohat],
        ["crash", sec.crash],
      ];
      for (const [kind, d] of drums) {
        const pat = drumAt(d, b);
        for (let i = 0; i < pat.length; i++) {
          if (pat[i] === "x" || pat[i] === "o")
            events.push({ step: base + i, kind, len: 1, vel: pat[i] === "x" ? 1 : 0.55 });
        }
      }

      // 탐 필인: 한 마디 안에서 나오는 순서대로 음이 내려감
      const tomPat = drumAt(sec.tom, b);
      let tomN = 0;
      for (let i = 0; i < tomPat.length; i++)
        if (tomPat[i] === "x")
          events.push({ step: base + i, kind: "tom", midi: 52 - 3 * (tomN++ % 5), len: 1, vel: 1 });

      if (sec.gtr === "chug")
        for (let i = 0; i < 16; i += 2)
          events.push({
            step: base + i,
            kind: "gtr",
            midi: root + 12,
            len: 2,
            vel: i % 4 ? 0.8 : 1,
          });
      if (sec.gtr === "sustain")
        events.push({ step: base, kind: "gtr", midi: root + 12, len: 16, vel: 1 });

      if (sec.bass === "pulse")
        for (let i = 0; i < 16; i += 2)
          events.push({ step: base + i, kind: "bass", midi: root, len: 2, vel: i % 4 ? 0.7 : 1 });
      if (sec.bass === "octave")
        for (let i = 0; i < 16; i += 2)
          events.push({
            step: base + i,
            kind: "bass",
            midi: root + (i % 4 ? 12 : 0),
            len: 2,
            vel: 1,
          });
      if (sec.bass === "root")
        events.push({ step: base, kind: "bass", midi: root, len: 16, vel: 1 });
      if (sec.bass === "half")
        for (let i = 0; i < 16; i += 8)
          events.push({ step: base + i, kind: "bass", midi: root, len: 8, vel: 1 });

      if (sec.pad)
        for (const m of tones) events.push({ step: base, kind: "pad", midi: m, len: 16, vel: 1 });

      if (sec.arp) {
        // 코드 구성음을 한 옥타브 위에서 오르내리기
        const up = [...tones.map((m) => m + 12), tones[0] + 24];
        const seq = [0, 1, 2, 3, 2, 1, 0, 1];
        for (let i = 0; i < 16; i += sec.arp)
          events.push({
            step: base + i,
            kind: "arp",
            midi: up[seq[(i / sec.arp) % seq.length]],
            len: sec.arp,
            vel: sec.arpVel ?? 1,
          });
      }

      if (sec.lead) {
        for (const n of parseBar(sec.lead[b % sec.lead.length]))
          events.push({ step: base + n.at, kind: "lead", midi: n.midi + tr, len: n.len, vel: 1 });
      }
    }
    if (sec.riser) {
      const from = (bar0 + sec.bars - sec.riser) * 16;
      events.push({ step: from, kind: "riser", len: sec.riser * 16, vel: 1 });
    }
    if (sec.pedal)
      for (let i = secStart; i < events.length; i++) {
        const k = events[i].kind;
        if (k === "bass" || k === "arp" || (k === "lead" && sec.pedal === true))
          events[i].pedal = true;
      }
    bar0 += sec.bars;
  }
  // 마디 경계를 넘는 멜로디 이어붙이기: 마디 끝까지 '-'였고 다음 마디가 '-'로 시작하는 경우는
  // parseBar가 처리 못 하므로, 작곡할 때 긴 음은 한 마디 안에서 끝나게 쓴다.
  events.sort((a, b) => a.step - b.step);
  const stepSec = 60 / spec.bpm / 4;
  return {
    id: spec.id,
    title: spec.title,
    bpm: spec.bpm,
    bars: bar0,
    duration: bar0 * 16 * stepSec + 2.5,
    events,
    sections,
    sound: spec.sound,
    color: spec.color,
    desc: spec.desc,
  };
}

// ───────────────────────── 음원 곡 (tunee.ai AI 자작곡) ─────────────────────────
// 채보는 '내 음악' 분석기로 미리 뽑아 JSON으로 고정 (모두 같은 채보 → 랭킹 공정).

interface AudioSongData {
  bpm: number;
  /** 표시용 BPM (셔플 곡은 1.5배) */
  bpmLabel?: number;
  beatOffset: number;
  duration: number;
  charts: Record<string, { level: number; units: number; notes: number[][] }>;
}

function audioSong(
  id: string,
  title: string,
  audio: string,
  data: AudioSongData,
  extra: { color: string; desc: string; artist?: string }
): Song {
  const charts = Object.fromEntries(
    Object.entries(data.charts).map(([d, c]) => [
      d,
      {
        level: c.level,
        units: c.units,
        notes: c.notes.map(([t, lane, end]) => (end ? { t, lane, end } : { t, lane })),
      },
    ])
  ) as Partial<Record<Difficulty, Chart>>;
  const beatSec = 60 / data.bpm;
  return {
    id,
    title,
    bpm: data.bpm,
    bpmLabel: data.bpmLabel,
    bars: Math.ceil(data.duration / (beatSec * 4)),
    duration: data.duration,
    events: [],
    sections: [[0, ""]],
    sound: { lead: "sine", arp: "sine", delaySteps: 0 },
    beatOffset: data.beatOffset,
    audio,
    charts,
    ...extra,
  };
}

const JILJU = audioSong("jilju", "질주주의보", "/audio/jilju.mp3", jiljuData, {
  color: "#38BDF8",
  desc: "170 BPM · K-POP ROCK · AI 자작곡 (tunee.ai)",
});
const NATSU = audioSong("natsukasumi", "夏霞のあと", "/audio/natsukasumi.mp3", natsuData, {
  color: "#F9A8D4",
  desc: "119 BPM · J-ROCK / INDIE POP · AI 자작곡 (tunee.ai)",
});

const RINKAKU = audioSong("rinkaku", "名前のない輪郭", "/audio/rinkaku.mp3", rinkakuData, {
  color: "#FBBF24",
  desc: "163 BPM · J-ROCK (12/8) · AI 자작곡 (tunee.ai)",
});

const NEWDIM = audioSong("newdim", "New Dimension", "/audio/newdim.mp3", newdimData, {
  color: "#C084FC",
  desc: "155 BPM · 사이버펑크 록 (12/8) · AI 자작곡 (tunee.ai)",
});

const MONARCH = audioSong("monarch", "Monarch's Fall", "/audio/monarch.mp3", monarchData, {
  color: "#EF4444",
  desc: "150 BPM · AI 자작곡",
});

const VELOCITY = audioSong("velocity", "Maximum Velocity", "/audio/velocity.mp3", velocityData, {
  color: "#F472B6",
  desc: "180 BPM · AI 자작곡",
});

const FULLCOMBO = audioSong("fullcombo", "Full Combo!!", "/audio/fullcombo.mp3", fullcomboData, {
  color: "#FB7185",
  desc: "180 BPM · K-POP 걸밴드 록 · AI 자작곡 (tunee.ai)",
});

// xi의 곡 — 제작자 표기 필수 (artist는 곡 선택·플레이·결과·랭킹에 함께 나옴)
const ANIMA = audioSong("anima", "ANiMA", "/audio/anima.mp3", animaData, {
  color: "#D9A066",
  desc: "184 BPM · ARTCORE · xi",
  artist: "xi",
});
const ARAGAMI = audioSong("aragami", "Aragami", "/audio/aragami.mp3", aragamiData, {
  color: "#DC2626",
  desc: "196 BPM · ARTCORE · xi",
  artist: "xi",
});
const FREEDOMDIVE = audioSong(
  "freedomdive",
  "FREEDOM DiVE",
  "/audio/freedomdive.mp3",
  freedomdiveData,
  {
    color: "#60A5FA",
    desc: "222 BPM · SPEEDCORE / ARTCORE · xi",
    artist: "xi",
  }
);

/*
 * 채보 다시 뽑기 (npm run rhythm-chart -- <id> ...) — --levels는 직접 쳐 보고 정한 레벨 (쉬움부터)
 *   fullcombo   --bpm-label 180 --boss '{"loud":0.5,"full":0.8,"burstEvery":8}' --levels 3,6,9,13,16
 *   jilju       --tweak '{"hard":{"fill":0.3},"expert":{"fill":0.15}}' --levels 3,5,8,12
 *   natsukasumi --tweak '{"hard":{"fill":0.9},"expert":{"fill":1.3}}' --levels 2,4,7,12
 *   rinkaku     --tweak '{"expert":{"fill":0.4}}' --levels 2,4,8,12
 *   newdim      --boss '{"loud":0.55,"full":0.85,"burstEvery":8}' --tweak '{"expert":{"fill":0.4}}' --levels 3,6,10,13,15
 *   monarch     --bpm-label 150 --boss '{"burstEvery":2}' --tweak '{"hard":{"fill":0.35},"expert":{"fill":0.3},"nightmare":{"fill":0.4}}' --levels 3,6,11,13,16
 *   velocity    --bpm-label 180 --boss '{"loud":0.45,"full":0.72,"burstEvery":4,"burstSub":6}' --levels 3,6,11,14,17
 *   anima       --boss '{}' --levels 3,6,9,13,17
 *   aragami     --boss '{}' --levels 3,6,9,13,17   (어려움은 9까지 못 올라가 8)
 *   freedomdive --boss '{}' --levels 3,5,9,12,15   (222 BPM 8분·16분이 꽉 차도 별점 12·15 — 그 위는 24분·잭이 필요)
 */
// ───────────────────────── 연습곡 ─────────────────────────
// 박자만 또렷한 신스 반주(킥·스네어·하이햇·베이스·패드) 위에 패턴 구간(practice.ts)을 차례로
const PRACTICE_BPM = 150;
const PRACTICE: Song = {
  ...build({
    id: "practice",
    title: "패턴 연습",
    bpm: PRACTICE_BPM,
    chords: [
      ["a2", "a3", "c4", "e4"],
      ["f2", "f3", "a3", "c4"],
      ["c3", "c4", "e4", "g4"],
      ["g2", "g3", "b3", "d4"],
    ],
    sections: PRACTICE_SECTIONS.map((sec) =>
      sec.key === "intro"
        ? { name: sec.name, bars: sec.bars, kick: "x...x...x...x...", hat: "x.x.x.x.x.x.x.x." }
        : sec.key === "outro"
          ? {
              name: sec.name,
              bars: sec.bars,
              crash: "x...............",
              bass: "root" as const,
              pad: true,
            }
          : {
              name: sec.name,
              bars: sec.bars,
              kick: "x...x...x...x...",
              snare: "....x.......x...",
              hat: "x.x.x.x.x.x.x.x.",
              crash: ["x...............", "", "", "", "", "", "", ""],
              bass: "pulse" as const,
              pad: true,
            }
    ),
    sound: { lead: "square", arp: "triangle", delaySteps: 3, drums: 1.1 },
    color: "#34D399",
    desc: "150 BPM · 계단 · 트릴 · 잭 · 동시치기 · 롱노트 · 섞어서 (랭킹 없음)",
  }),
  practice: true,
  custom: true,
  charts: practiceCharts(PRACTICE_BPM),
};

/** 새 곡은 항상 맨 앞에 (연습곡은 맨 끝) */
export const SONGS: Song[] = [
  FULLCOMBO,
  JILJU,
  NATSU,
  RINKAKU,
  NEWDIM,
  MONARCH,
  VELOCITY,
  ANIMA,
  ARAGAMI,
  FREEDOMDIVE,
  PRACTICE,
];

// 작곡 엔진 외부 노출 (지금은 안 쓰지만 신스 곡을 다시 넣을 때 사용)
export { build, type SongSpec };
