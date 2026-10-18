import anima from "../../../web/src/data/rhythm/anima.json";
import aragami from "../../../web/src/data/rhythm/aragami.json";
import crimsoncadenza from "../../../web/src/data/rhythm/crimsoncadenza.json";
import freedomdive from "../../../web/src/data/rhythm/freedomdive.json";
import fullcombo from "../../../web/src/data/rhythm/fullcombo.json";
import hwimori from "../../../web/src/data/rhythm/hwimori.json";
import luckyseven from "../../../web/src/data/rhythm/luckyseven.json";
import jilju from "../../../web/src/data/rhythm/jilju.json";
import monarch from "../../../web/src/data/rhythm/monarch.json";
import pixelfighting from "../../../web/src/data/rhythm/pixelfighting.json";
import natsukasumi from "../../../web/src/data/rhythm/natsukasumi.json";
import newdim from "../../../web/src/data/rhythm/newdim.json";
import rinkaku from "../../../web/src/data/rhythm/rinkaku.json";
import velocity from "../../../web/src/data/rhythm/velocity.json";
import midnight from "../../../web/src/data/rhythm/midnight.json";
import starlight from "../../../web/src/data/rhythm/starlight.json";
import sugarcloud from "../../../web/src/data/rhythm/sugarcloud.json";
import overload from "../../../web/src/data/rhythm/overload.json";
import etude from "../../../web/src/data/rhythm/etude.json";

/*
 * 리듬게임 내장곡 채보에서 기록 검증에 쓰는 값만 뽑아 둠 (프론트와 같은 채보 파일을 읽음).
 * 곡을 추가하면 여기에도 import 를 추가할 것 — 빠뜨리면 test/rankings.test.ts 가 알려줌.
 * 여기 없는 채보(연습곡 등)는 채보 기준 검사 없이 받음.
 */
interface SongData {
  bpm: number;
  /** 곡 길이(초) */
  duration: number;
  charts: Record<string, { level: number; units: number; notes: number[][] }>;
}

// 곡 id = 파일 이름 (web/src/lib/rhythm/music.ts 의 audioSong id 와 같음)
const SONGS: Record<string, SongData> = {
  anima,
  aragami,
  crimsoncadenza,
  freedomdive,
  fullcombo,
  hwimori,
  luckyseven,
  pixelfighting,
  jilju,
  monarch,
  natsukasumi,
  newdim,
  rinkaku,
  velocity,
  midnight,
  starlight,
  sugarcloud,
  overload,
  etude,
};
export const RHYTHM_SONG_IDS = Object.keys(SONGS);
/** 곡 id → 길이(초)와 있는 난이도 (온라인 방에서 곡·난이도 확인용) */
export const RHYTHM_SONG_INFO = new Map(
  Object.entries(SONGS).map(([id, s]) => [id, { duration: s.duration, diffs: Object.keys(s.charts) }])
);

export interface ChartInfo {
  /** 판정 단위 수 (롱노트는 머리+꼬리) */
  units: number;
  /** 낼 수 있는 최대 콤보 = 판정 단위 + 롱노트를 누르는 동안 오르는 틱 */
  maxCombo: number;
  /** 마지막 노트가 끝나는 시각(초) — 이만큼은 지나야 곡이 끝남 */
  lastTime: number;
  /** 레벨 (BP 계산) */
  level: number;
}

/** "곡id_난이도" → 검증용 값 */
export const RHYTHM_CHARTS = new Map<string, ChartInfo>();
for (const [id, song] of Object.entries(SONGS)) {
  // 롱노트 틱 간격: 반 박 (web/src/components/Rhythm/Stage.tsx 의 new Engine(chart, beatSec / 2))
  const tickSec = 60 / song.bpm / 2;
  for (const [diff, chart] of Object.entries(song.charts)) {
    let ticks = 0;
    let lastTime = 0;
    for (const [t, , end] of chart.notes) {
      lastTime = Math.max(lastTime, end ?? t);
      if (end)
        ticks += Math.max(0, Math.floor((end - t - tickSec * 0.5) / tickSec));
    }
    RHYTHM_CHARTS.set(`${id}_${diff}`, {
      units: chart.units,
      maxCombo: chart.units + ticks,
      lastTime,
      level: chart.level,
    });
  }
}
