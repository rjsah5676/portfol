import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
export const ROOT = process.env.SRC_ROOT ?? "/home/claude/p2/web";
const require = createRequire("/home/claude/p2/web/package.json");
const ts = require("typescript");
export async function loadLib() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rh-"));
  for (const n of ["analyze", "autochart", "chart", "patterns", "stars"]) {
    const src = fs.readFileSync(path.join(ROOT, "src/lib/rhythm", `${n}.ts`), "utf8");
    let out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    out = out.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(tmp, `${n}.mjs`), out);
  }
  const load = (n) => import(pathToFileURL(path.join(tmp, `${n}.mjs`)).href);
  return { analyze: await load("analyze"), auto: await load("autochart"), stars: await load("stars"), tmp };
}
// 내장곡 채보 명령 (music.ts 주석 · cmds2.txt 와 같게)
export const BUILTIN = {
  fullcombo: { boss: { loud: 0.48, full: 0.78 }, levels: [3, 5, 9, 13, 14] },
  jilju: { boss: {}, tweak: { hard: { fill: 0.3 }, expert: { fill: 0.15 } }, levels: [3, 5, 8, 12, 16] },
  natsukasumi: { boss: {}, tweak: { hard: { fill: 0.9 }, expert: { fill: 1.3 } }, levels: [3, 4, 7, 11, 14] },
  newdim: { boss: { loud: 0.55, full: 0.85, burstEvery: 8 }, tweak: { expert: { fill: 0.4 } }, levels: [3, 5, 8, 12, 15] },
  monarch: { boss: { burstEvery: 2 }, tweak: { hard: { fill: 0.35 }, expert: { fill: 0.3 }, nightmare: { fill: 0.4 } }, levels: [3, 5, 8, 12, 15] },
  velocity: { boss: { loud: 0.45, full: 0.72, burstEvery: 4, burstSub: 6 }, explus: {}, abyss: {}, levels: [3, 6, 10, 14, 17, 17] },
  anima: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 9, 13, 17, 20] },
  aragami: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 11, 14, 16, 18] },
  crimsoncadenza: { double: true, boss: {}, explus: {}, abyss: {}, levels: [3, 6, 9, 12, 16, 17] },
  hwimori: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 10, 13, 16, 18] },
  luckyseven: { double: true, boss: {}, explus: {}, abyss: {}, levels: [3, 6, 9, 11, 15, 17] },
  pixelfighting: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 8, 13, 15, 16] },
  freedomdive: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 9, 13, 15, 17], keep: ["nightmare"] },
  midnight: { single: true, levels: [3, 4, 7, 11] },
  starlight: { boss: {}, explus: {}, abyss: {}, levels: [3, 4, 7, 10, 13, 16] },
  sugarcloud: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 7, 12, 15, 16] },
  overload: { single: true, boss: {}, explus: {}, abyss: {}, levels: [3, 5, 8, 11, 13, 15] },
  etude: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 10, 13, 16, 17] },
  highlight: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 8, 12, 15, 18] },
  tomeinauso: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 7, 11, 15, 17] },
  picopico: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 9, 13, 16, 16] },
  neonseaside: { single: true, boss: {}, explus: {}, abyss: {}, levels: [3, 4, 7, 10, 14, 16] },
  riseofchampions: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 8, 12, 14, 17] },
  bladestorm: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 9, 14, 17, 20] },
  venombloom: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 8, 12, 15, 17] },
};
export function builtinArgs(c) {
  const diffs = ["easy", "normal", "hard", "expert"];
  const tweaks = {};
  if (c.boss) { diffs.push("nightmare"); tweaks.nightmare = { nightmare: c.boss }; }
  if (c.explus) { diffs.push("explus"); tweaks.explus = { nightmare: c.explus }; }
  if (c.abyss) { diffs.push("abyss"); tweaks.abyss = { abyss: c.abyss }; }
  for (const [d, t] of Object.entries(c.tweak ?? {})) tweaks[d] = { ...(tweaks[d] ?? {}), ...t };
  (c.levels ?? []).forEach((v, i) => { const d = ["easy", "normal", "hard", "expert", "nightmare", "explus"][i]; tweaks[d] = { ...(tweaks[d] ?? {}), level: v }; });
  return { diffs, tweaks };
}
