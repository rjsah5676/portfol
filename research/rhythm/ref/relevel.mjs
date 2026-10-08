import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { createRequire } from "node:module"; import { pathToFileURL } from "node:url";
const ROOT = "/home/claude/p2/web"; const require = createRequire(path.join(ROOT, "package.json")); const ts = require("typescript");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rl-"));
for (const n of ["stars"]) { const src = fs.readFileSync(path.join(ROOT, "src/lib/rhythm", `${n}.ts`), "utf8"); let out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; out = out.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'); fs.writeFileSync(path.join(tmp, `${n}.mjs`), out); }
const { starRating } = await import(pathToFileURL(path.join(tmp, "stars.mjs")).href);
for (const f of fs.readdirSync(path.join(ROOT, "src/data/rhythm")).filter((x) => x.endsWith(".json"))) {
  const p = path.join(ROOT, "src/data/rhythm", f); const o = JSON.parse(fs.readFileSync(p, "utf8")); let changed = false;
  for (const [d, c] of Object.entries(o.charts)) {
    const notes = c.notes.map((n) => (n[2] !== undefined ? { t: n[0], lane: n[1], end: n[2] } : { t: n[0], lane: n[1] }));
    const raw = Math.max(1, Math.round(starRating(notes) * 4));
    if (raw !== c.level) { console.log(f, d, c.level, "→", raw); c.level = raw; changed = true; }
  }
  if (changed) fs.writeFileSync(p, JSON.stringify(o));
}
console.log("done");
