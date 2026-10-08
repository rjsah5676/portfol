// node dump.mjs <mp3> <out.json> [--straight]  → 분석 결과(beats/grid/onsets/bpm/div) 덤프
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import ts from "/home/claude/p2/web/node_modules/typescript/lib/typescript.js";
const ROOT = "/home/claude/p2/web";
const [mp3, outp] = process.argv.slice(2);
const straight = process.argv.includes("--straight");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rhythm-dump-"));
for (const n of ["analyze", "autochart", "chart", "patterns", "stars"]) {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/rhythm", `${n}.ts`), "utf8");
  let out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  out = out.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(tmp, `${n}.mjs`), out);
}
const { analyzeAudio, displayBpm, SR } = await import(pathToFileURL(path.join(tmp, "analyze.mjs")).href);
const raw = execFileSync("ffmpeg", ["-v", "error", "-i", mp3, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
globalThis.OfflineAudioContext = class {
  createBufferSource() { return { connect() {}, start() {} }; }
  get destination() { return {}; }
  async startRendering() { return { getChannelData: () => pcm }; }
};
const a = await analyzeAudio({ duration: pcm.length / SR }, () => {}, { straight });
console.log(`${a.bpm.toFixed(3)} BPM (표시 ${displayBpm(a).toFixed(2)}) div ${a.div} beats ${a.beats.length} onsets ${a.onsets.length}`);
fs.writeFileSync(outp, JSON.stringify({ bpm: a.bpm, div: a.div, beats: a.beats, grid: a.grid, onsets: a.onsets, rms: Array.from(a.rms), duration: a.duration }));
