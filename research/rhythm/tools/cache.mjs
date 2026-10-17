import fs from "node:fs";
import v8 from "node:v8";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadLib, BUILTIN } from "./lib.mjs";
const { analyze } = await loadLib();
const { analyzeAudio, SR } = analyze;
const [shard, n] = (process.argv[2] ?? "0/1").split("/").map(Number);
const jobs = [];
for (const id of Object.keys(BUILTIN)) jobs.push({ id: "b_" + id, file: `/home/claude/p2/web/public/audio/${id}.mp3`, opt: { double: !!BUILTIN[id].double, single: !!BUILTIN[id].single } });
for (const f of fs.readdirSync("/home/claude/osz2/audio/osu_audio").filter((f) => f.endsWith(".mp3")).sort())
  jobs.push({ id: "o_" + f.replace(/\.mp3$/, ""), file: path.join("/home/claude/osz2/audio/osu_audio", f), opt: {} });
for (const [i, j] of jobs.entries()) {
  if (i % n !== shard) continue;
  const dest = `/tmp/claude-0/qvs/cache/${j.id}.bin`;
  if (fs.existsSync(dest)) continue;
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", j.file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  globalThis.OfflineAudioContext = class { createBufferSource() { return { connect() {}, start() {} }; } get destination() { return {}; } async startRendering() { return { getChannelData: () => pcm }; } };
  const a = await analyzeAudio({ duration: pcm.length / SR }, () => {}, j.opt);
  fs.writeFileSync(dest, v8.serialize(a));
  console.log(j.id, a.bpm.toFixed(1));
}
