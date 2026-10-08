// 내장곡 채보의 꼬리(곡이 잦아든 뒤) 노트만 잘라냄 — 나머지 채보는 그대로. 레벨·units 다시 계산
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { execFileSync } from "node:child_process"; import { createRequire } from "node:module"; import { pathToFileURL } from "node:url";
const ROOT = process.cwd(); const require = createRequire(path.join(ROOT, "package.json")); const ts = require("typescript");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trim-"));
for (const n of ["analyze", "autochart", "chart", "patterns", "stars"]) {
  let out = ts.transpileModule(fs.readFileSync(path.join(ROOT, "src/lib/rhythm", `${n}.ts`), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  fs.writeFileSync(path.join(tmp, `${n}.mjs`), out.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'));
}
const { audibleEnd, SR } = await import(pathToFileURL(path.join(tmp, "analyze.mjs")).href);
const { finishChart } = await import(pathToFileURL(path.join(tmp, "chart.mjs")).href);
const write = process.argv.includes("--write");
for (const id of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", `public/audio/${id}.mp3`, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
  // analyze.ts 와 같은 프레임 음량 (N=1024, HOP=256, 프레임 중심 f*HOP)
  const N = 1024, HOP = 256, frames = Math.floor(x.length / HOP);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let e = 0; const s = f * HOP - N / 2; for (let j = 0; j < N; j++) { const v = x[s + j] ?? 0; e += v * v; } rms[f] = Math.sqrt(e / N); }
  const end = audibleEnd(rms);
  const file = path.join(ROOT, "src/data/rhythm", `${id}.json`);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const log = [];
  for (const [k, c] of Object.entries(d.charts)) {
    const keep = c.notes.filter((n) => n[0] <= end).map((n) => (n[2] && n[2] > end ? [n[0], n[1], Math.max(n[0] + 0.1, Math.round(end * 1000) / 1000)] : n));
    const cut = c.notes.length - keep.length;
    const ch = finishChart(keep.map((n) => (n[2] ? { t: n[0], lane: n[1], end: n[2] } : { t: n[0], lane: n[1] })), k);
    log.push(`${k}:-${cut}${ch.level !== c.level ? ` Lv${c.level}→${ch.level}` : ""}`);
    d.charts[k] = { level: ch.level, units: ch.units, notes: ch.notes.map((n) => (n.end ? [n.t, n.lane, n.end] : [n.t, n.lane])) };
  }
  console.log(id.padEnd(12), "end", end.toFixed(2), log.join(" "));
  if (write) fs.writeFileSync(file, JSON.stringify(d));
}
fs.rmSync(tmp, { recursive: true, force: true });
