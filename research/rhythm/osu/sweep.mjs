import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { execFileSync } from "node:child_process"; import { createRequire } from "node:module"; import { pathToFileURL } from "node:url";
const ROOT = "/home/claude/p2/web"; const require = createRequire(path.join(ROOT, "package.json")); const ts = require("typescript");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sw-"));
for (const n of ["analyze", "autochart", "chart", "patterns", "stars"]) {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/rhythm", `${n}.ts`), "utf8");
  fs.writeFileSync(path.join(tmp, `${n}.mjs`), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'));
}
const load = (n) => import(pathToFileURL(path.join(tmp, `${n}.mjs`)).href);
const { analyzeAudio, SR } = await load("analyze"); const { makeAutoChart } = await load("autochart"); const { starRating } = await load("stars");
const [file, diff, from, to, step, fill] = process.argv.slice(2);
const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
globalThis.OfflineAudioContext = class { createBufferSource() { return { connect() {}, start() {} }; } get destination() { return {}; } async startRendering() { return { getChannelData: () => pcm }; } };
const a = await analyzeAudio({ duration: pcm.length / SR }, () => {}, {});
for (let dns = +from; dns <= +to + 1e-9; dns += +step) {
  const c = makeAutoChart(a, diff, 0, { density: dns, fill: +fill });
  const rows = new Set(c.notes.map((n) => Math.round(n.t * 1000))).size;
  console.log(`density ${dns.toFixed(3)} fill ${fill}: notes ${c.notes.length} rows ${rows} chords ${c.notes.length - rows} LN ${c.notes.filter((n) => n.end).length} lv ${(starRating(c.notes) * 4).toFixed(2)}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
