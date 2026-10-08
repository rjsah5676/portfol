// osu 곡 음원으로 우리 자동 채보기('내 음악' 경로와 같은 설정)를 돌려 JSON으로 저장
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const ROOT = "/home/claude/p2/web";
const require = createRequire(path.join(ROOT, "package.json"));
const ts = require("typescript");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rhythm-gen-"));
for (const n of ["analyze", "autochart", "chart", "patterns", "stars"]) {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/rhythm", `${n}.ts`), "utf8");
  let out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  out = out.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(tmp, `${n}.mjs`), out);
}
const load = (n) => import(pathToFileURL(path.join(tmp, `${n}.mjs`)).href);
const { analyzeAudio, displayBpm, SR } = await load("analyze");
const { makeAutoCharts } = await load("autochart");
const [shard, nShard] = (process.argv[2] ?? "0/1").split("/").map(Number);
const dir = "/home/claude/osz2/audio/osu_audio";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mp3")).sort().filter((_, i) => i % nShard === shard).slice(0, Number(process.env.LIMIT ?? 1e9));
const r3 = (x) => Math.round(x * 1000) / 1000;
for (const f of files) {
  const id = f.replace(/\.mp3$/, "");
  const dest = `${process.env.OUT ?? "/home/claude/osz2/ours_gen"}/${id}.json`;
  if (fs.existsSync(dest)) continue;
  const t0 = Date.now();
  try {
    const raw = execFileSync("ffmpeg", ["-v", "error", "-i", path.join(dir, f), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
    const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    globalThis.OfflineAudioContext = class {
      createBufferSource() { return { connect() {}, start() {} }; }
      get destination() { return {}; }
      async startRendering() { return { getChannelData: () => pcm }; }
    };
    const a = await analyzeAudio({ duration: pcm.length / SR }, () => {}, {});
    const charts = makeAutoCharts(a, ["easy", "normal", "hard", "expert", "nightmare"]);
    const out = {
      id, bpm: r3(a.bpm), bpmLabel: r3(displayBpm(a)), div: a.div, beatOffset: r3(a.beats[0]), duration: r3(a.duration),
      charts: Object.fromEntries(Object.keys(charts).map((d) => [d, { level: charts[d].level, notes: charts[d].notes.map((n) => (n.end ? [r3(n.t), n.lane, r3(n.end)] : [r3(n.t), n.lane])) }])),
    };
    fs.writeFileSync(dest, JSON.stringify(out));
    console.log(id, `${((Date.now() - t0) / 1000).toFixed(1)}s`, `bpm ${out.bpmLabel}`, Object.entries(out.charts).map(([d, c]) => `${d[0]}${c.level}:${c.notes.length}`).join(" "));
  } catch (e) {
    console.log(id, "FAIL", String(e).slice(0, 200));
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
