/**
 * 리듬게임 내장곡 채보 만들기 → src/data/rhythm/<id>.json
 *
 *   npm run rhythm-chart -- <id> [옵션]
 *
 * 음원은 public/audio/<id>.mp3, ffmpeg가 PATH에 있어야 함.
 * 게임 안 '내 음악'과 같은 분석기·자동 채보기(src/lib/rhythm)를 그대로 써서 만든다.
 *
 * 옵션
 *   --bpm-label <n>   화면에 보일 BPM (분석기가 셔플로 잘못 보면 직접 지정)
 *   --boss '<json>'   보스곡: 나이트메어 난이도를 추가 (src/lib/rhythm/autochart의 NightmareTweak, {}면 기본값)
 *   --hard-slots      쉬움·보통·어려움을 한 단계 위 규칙으로 (보스곡용: 대략 Lv6 / 11 / 14)
 *   --straight        분석기가 셋잇단(12/8)으로 잘못 볼 때 1.5배 템포 4/4로 강제
 *   --tweak '<json>'  난이도별 AutoTweak 덮어쓰기 (예: '{"expert":{"fill":0.6}}')
 *   --levels a,b,c…   난이도별 목표 레벨 (쉬움부터, 별점×4) — 직접 쳐 보고 정한 레벨에 맞춰 뽑음
 *   --dry             파일은 안 쓰고 난이도별 통계만 출력
 *   --stats           패턴을 얼마나 다양하게 썼는지 출력
 *
 * 예) Monarch's Fall : npm run rhythm-chart -- monarch --bpm-label 150 --boss '{}'
 *     New Dimension   : npm run rhythm-chart -- newdim --boss '{"loud":0.55,"full":0.85,"burstEvery":8}'  (나이트메어 Lv17)
 *     Maximum Velocity: npm run rhythm-chart -- velocity --bpm-label 180 --hard-slots \
 *       --boss '{"loudSub":3,"fullSub":6,"chordFull":3,"burstSub":12,"burstEvery":2}'
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  ".."
);
const require = createRequire(path.join(ROOT, "package.json"));
const ts = require("typescript");

// ── 인자 ──
const argv = process.argv.slice(2);
const id = argv.find(
  (a) =>
    !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.match(/^--(bpm-label|boss|tweak|levels)$/)
);
if (!id) {
  console.error(
    "사용법: npm run rhythm-chart -- <id> [--bpm-label n] [--boss '{json}'] [--hard-slots] [--dry]"
  );
  process.exit(1);
}
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const bpmLabelArg = opt("--bpm-label");
const bossArg = opt("--boss");
const hardSlots = argv.includes("--hard-slots");
const straight = argv.includes("--straight");
const dry = argv.includes("--dry");

// ── src/lib/rhythm의 TS를 임시 폴더에 JS로 옮겨서 불러옴 ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rhythm-chart-"));
for (const n of ["analyze", "autochart", "chart", "patterns", "stars"]) {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/rhythm", `${n}.ts`), "utf8");
  let out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  out = out.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(tmp, `${n}.mjs`), out);
}
const load = (n) => import(pathToFileURL(path.join(tmp, `${n}.mjs`)).href);
const { analyzeAudio, displayBpm, SR } = await load("analyze");
const { makeAutoCharts } = await load("autochart");
if (process.env.DEBUG_LV) globalThis.DEBUG_LV = true;

// ── 음원 → 22.05kHz 모노 PCM (분석기가 쓰는 OfflineAudioContext는 이 데이터를 돌려주는 가짜로) ──
const mp3 = path.join(ROOT, "public/audio", `${id}.mp3`);
if (!fs.existsSync(mp3)) throw new Error(`음원이 없음: ${mp3}`);
const raw = execFileSync(
  "ffmpeg",
  ["-v", "error", "-i", mp3, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"],
  {
    maxBuffer: 1 << 30,
  }
);
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
globalThis.OfflineAudioContext = class {
  createBufferSource() {
    return { connect() {}, start() {} };
  }
  get destination() {
    return {};
  }
  async startRendering() {
    return { getChannelData: () => pcm };
  }
};
const a = await analyzeAudio({ duration: pcm.length / SR }, () => {}, { straight });
console.log(
  `분석: ${a.bpm.toFixed(2)} BPM (표시 ${displayBpm(a).toFixed(1)}), 비트 ${a.beats.length}, 타격 ${a.onsets.length}, ${a.duration.toFixed(1)}초`
);

// ── 난이도별 채보 (목표 레벨 TARGET_LEVEL에 맞을 때까지 밀도·채우기를 자동 조절, 레벨 = osu 별점 × 4) ──
//    DEBUG_LV=1 이면 난이도별로 맞춰 가는 과정 출력
const diffs = ["easy", "normal", "hard", "expert"];
if (bossArg !== undefined) diffs.push("nightmare");
const tweaks = hardSlots
  ? {
      // 보스곡: 쉬움·보통·어려움을 한 단계 위 규칙으로
      easy: { rule: "hard", density: 0.5 },
      normal: { rule: "hard" },
      hard: { rule: "expert", density: 0.8 },
    }
  : {};
if (bossArg !== undefined) tweaks.nightmare = { nightmare: JSON.parse(bossArg) };
const tweakArg = opt("--tweak");
if (tweakArg)
  for (const [d, t] of Object.entries(JSON.parse(tweakArg))) tweaks[d] = { ...(tweaks[d] ?? {}), ...t };
const levelsArg = opt("--levels");
if (levelsArg)
  levelsArg.split(",").forEach((v, i) => {
    const d = ["easy", "normal", "hard", "expert", "nightmare"][i];
    if (d && v.trim()) tweaks[d] = { ...(tweaks[d] ?? {}), level: Number(v) };
  });
// --stats: 난이도별로 어떤 패턴을 얼마나 썼는지 (다양성 점검)
const stats = argv.includes("--stats");
const picks = {};
if (stats)
  for (const d of diffs) {
    picks[d] = [];
    tweaks[d] = {
      ...(tweaks[d] ?? {}),
      onPick: (name, bar, len) => picks[d].push({ name, bar, len }),
    };
  }
const charts = makeAutoCharts(a, diffs, 0, tweaks);
if (stats)
  for (const d of diffs) {
    // 마지막 시도(재시도하면 여러 번 쌓임)만: 마디가 다시 0부터 시작하는 마지막 구간
    const all = picks[d];
    let start = 0;
    for (let i = 1; i < all.length; i++) if (all[i].bar < all[i - 1].bar) start = i;
    const list = all.slice(start);
    const shape = (n) => n.replace(/['<]+$/, "");
    const cnt = {};
    // 새로 고른 모양(직전과 다른 모양)이 최근 4조각 안에 또 나온 비율 — 낮을수록 "아까 그 패턴" 느낌이 적음
    let recentHit = 0;
    let fresh = 0;
    for (let i = 0; i < list.length; i++) {
      const sh = shape(list[i].name);
      cnt[sh] = (cnt[sh] ?? 0) + 1;
      if (i > 0 && shape(list[i - 1].name) === sh) continue;
      fresh++;
      if (list.slice(Math.max(0, i - 4), i).some((x) => shape(x.name) === sh)) recentHit++;
    }
    const top = Object.entries(cnt)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 6);
    console.log(
      `${d.padEnd(9)} 조각 ${list.length}  모양 ${Object.keys(cnt).length}종  새 모양 ${fresh}개 중 최근4 재등장 ${Math.round((recentHit / Math.max(1, fresh)) * 100)}%  ${top.map(([k, v]) => `${k}×${v}`).join(" ")}`
    );
    console.log("          " + list.map((x) => x.name).join(" "));
  }

// ── 통계 ──
for (const [d, c] of Object.entries(charts)) {
  const t = c.notes.map((n) => n.t);
  const avg = t.length / (t.at(-1) - t[0] + 1);
  let peak = 0;
  for (let i = 0, j = 0; i < t.length; i++) {
    while (t[i] - t[j] > 4) j++;
    peak = Math.max(peak, (i - j + 1) / 4);
  }
  const chords = t.length - new Set(t).size;
  console.log(
    `${d.padEnd(6)} Lv${String(c.level).padStart(2)}  노트 ${c.notes.length}  초당 ${avg.toFixed(2)}  4초 최고 ${peak.toFixed(2)}  동시치기 ${chords}  롱노트 ${c.notes.filter((n) => n.end).length}`
  );
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const out = {
  bpm: Math.round(a.bpm * 100) / 100,
  bpmLabel: bpmLabelArg ? Number(bpmLabelArg) : Math.round(displayBpm(a) * 100) / 100,
  beatOffset: r3(a.beats[0]),
  duration: Math.round(a.duration * 100) / 100,
  charts: Object.fromEntries(
    Object.keys(charts).map((d) => [
      d,
      {
        level: charts[d].level,
        units: charts[d].units,
        notes: charts[d].notes.map((n) =>
          n.end ? [r3(n.t), n.lane, r3(n.end)] : [r3(n.t), n.lane]
        ),
      },
    ])
  ),
};
fs.rmSync(tmp, { recursive: true, force: true });
if (dry) process.exit(0);
const dest = path.join(ROOT, "src/data/rhythm", `${id}.json`);
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`저장: ${path.relative(ROOT, dest)}`);
