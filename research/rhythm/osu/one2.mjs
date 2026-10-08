import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { createRequire } from "node:module"; import { pathToFileURL } from "node:url";
const ROOT = "/home/claude/p2/web"; const require = createRequire(path.join(ROOT, "package.json")); const ts = require("typescript");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "one-"));
for (const n of ["analyze", "autochart", "chart", "patterns", "stars"]) { const src = fs.readFileSync(path.join(ROOT, "src/lib/rhythm", `${n}.ts`), "utf8"); let out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; out = out.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'); fs.writeFileSync(path.join(tmp, `${n}.mjs`), out); }
const load = (n) => import(pathToFileURL(path.join(tmp, `${n}.mjs`)).href);
const { analyzeAudio, displayBpm, SR } = await load("analyze"); const { makeAutoCharts } = await load("autochart");
const [mp3, outp] = process.argv.slice(2);
const raw = execFileSync("ffmpeg", ["-v", "error", "-i", mp3, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
globalThis.OfflineAudioContext = class { createBufferSource() { return { connect() {}, start() {} }; } get destination() { return {}; } async startRendering() { return { getChannelData: () => pcm }; } };
if (process.env.DEBUG_LV) globalThis.DEBUG_LV = true;
const a = await analyzeAudio({ duration: pcm.length / SR }, () => {}, {});
const charts = makeAutoCharts(a, ["easy", "normal", "hard", "expert", "nightmare"]);
const r3 = (x) => Math.round(x * 1000) / 1000;
fs.writeFileSync(outp, JSON.stringify({ bpm: r3(a.bpm), bpmLabel: r3(displayBpm(a)), beatOffset: r3(a.beats[0]), duration: r3(a.duration), charts: Object.fromEntries(Object.entries(charts).map(([d, c]) => [d, { level: c.level, notes: c.notes.map((n) => (n.end ? [r3(n.t), n.lane, r3(n.end)] : [r3(n.t), n.lane])) }])) }));
for (const [d, c] of Object.entries(charts)) console.log(d, c.level, c.notes.length, (c.notes.length / a.duration).toFixed(2));
