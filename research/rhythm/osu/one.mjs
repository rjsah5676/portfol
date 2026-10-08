import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { createRequire } from "node:module"; import { pathToFileURL } from "node:url";
const ROOT = "/home/claude/p2/web"; const require = createRequire(path.join(ROOT, "package.json")); const ts = require("typescript");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "one-"));
for (const n of ["analyze", "autochart", "chart", "patterns", "stars"]) { const src = fs.readFileSync(path.join(ROOT, "src/lib/rhythm", `${n}.ts`), "utf8"); let out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; out = out.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'); fs.writeFileSync(path.join(tmp, `${n}.mjs`), out); }
const load = (n) => import(pathToFileURL(path.join(tmp, `${n}.mjs`)).href);
const { analyzeAudio, SR } = await load("analyze"); const { makeAutoCharts } = await load("autochart");
const mp3 = process.argv[2]; const diffs = (process.argv[3] ?? "hard").split(",");
const raw = execFileSync("ffmpeg", ["-v", "error", "-i", mp3, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
globalThis.OfflineAudioContext = class { createBufferSource() { return { connect() {}, start() {} }; } get destination() { return {}; } async startRendering() { return { getChannelData: () => pcm }; } };
globalThis.DEBUG_COPY = true;
const a = await analyzeAudio({ duration: pcm.length / SR }, () => {}, {});
const charts = makeAutoCharts(a, diffs);
for (const d of diffs) console.log(d, charts[d].level, charts[d].notes.length);
