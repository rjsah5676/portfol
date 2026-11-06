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
  jilju: { boss: {}, tweak: { hard: { fill: 0.3 }, expert: { fill: 0.15 } }, levels: [3, 5, 8, 12, 16], favor: { stair3: 2, anchor: 1.6, split: 1.4, p02: 1.6, p13: 1.6 } },
  natsukasumi: { boss: {}, tweak: { hard: { fill: 0.9 }, expert: { fill: 1.3 } }, levels: [3, 4, 7, 11, 14] },
  newdim: { boss: { loud: 0.55, full: 0.85, burstEvery: 8 }, tweak: { expert: { fill: 0.4 } }, levels: [3, 5, 8, 12, 15] },
  monarch: { boss: { burstEvery: 2 }, tweak: { hard: { fill: 0.35 }, expert: { fill: 0.3 }, nightmare: { fill: 0.4 } }, levels: [3, 5, 8, 12, 15] },
  velocity: { boss: { loud: 0.45, full: 0.72, burstEvery: 4, burstSub: 6 }, explus: {}, abyss: {}, levels: [3, 6, 10, 14, 17, 17], lift: { mode: "stream" } },
  anima: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 9, 13, 17, 20], lift: { mode: "chord" } },
  aragami: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 11, 14, 16, 18],  },
  crimsoncadenza: { double: true, boss: {}, explus: {}, abyss: {}, levels: [3, 6, 9, 12, 16, 17], lift: { mode: "stream" } },
  hwimori: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 10, 13, 16, 18], favor: { anchor: 2.5, jack: 2.5, stair: 0.5, zigzag: 0.5, jackMul: 1.6, p03: 2, p12: 0.6 }, lift: { mode: "chord" } },
  luckyseven: { double: true, boss: {}, explus: {}, abyss: {}, levels: [3, 6, 9, 11, 15, 17], lift: { mode: "chord" } },
  pixelfighting: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 8, 13, 15, 16],  },
  freedomdive: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 9, 13, 15, 17], keep: ["nightmare"], lift: { mode: "chord" } },
  midnight: { single: true, levels: [3, 4, 7, 11] },
  starlight: { boss: {}, explus: {}, abyss: {}, levels: [3, 4, 7, 10, 13, 16], lift: { mode: "stream" } },
  sugarcloud: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 7, 12, 15, 16], favor: { jump: 2, jumpstream: 1.8, trill: 1.5, stair: 0.6, p01: 2, p23: 2 }, lift: { mode: "stream" } },
  overload: { single: true, boss: {}, explus: {}, abyss: {}, levels: [3, 5, 8, 11, 13, 15], lift: { mode: "stream" } },
  etude: { rephase: true, boss: {}, explus: {}, abyss: {}, levels: [3, 6, 10, 13, 16, 17], lift: { mode: "chord" } },
  highlight: { boss: {}, explus: {}, abyss: {}, levels: [3, 6, 8, 12, 15, 18], lift: { mode: "stream" } },
  tomeinauso: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 7, 11, 15, 17], favor: { stair: 2, zigzag: 2, wave: 1.5, jump: 0.5, jumpstream: 0.6, anchor: 0.4, jackMul: 0.6, p01: 1.5, p23: 1.5, p03: 0.6 }, lift: { mode: "stream" } },
  picopico: { rephase: true, boss: {}, explus: { chordScale: 1.8 }, abyss: {}, levels: [3, 6, 9, 13, 16, 16], lift: { mode: "stream" } },
  neonseaside: { single: true, boss: {}, explus: {}, abyss: {}, levels: [3, 4, 7, 10, 14, 16], lift: { mode: "stream" } },
  riseofchampions: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 8, 12, 14, 17], favor: { jumpstream: 2, jump: 1.6, anchor: 1.3, zigzag: 0.6, p03: 2 }, lift: { mode: "stream" } },
  bladestorm: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 9, 14, 17, 20], lift: { mode: "stream" } },
  venombloom: { boss: {}, explus: {}, abyss: {}, levels: [3, 5, 8, 12, 15, 17], favor: { jack: 2.5, trill2: 2, split: 1.5, stair: 0.5, jackMul: 1.5, p02: 2, p13: 2 }, lift: { mode: "stream" } },
  aurora: { boss: {}, explus: {}, abyss: { p3: 0.45, share: 0.85 }, levels: [3, 4, 7, 11, 14, 15], favor: { zigzag: 2.5, wave: 2, stair: 1.5, jump: 0.6, jackMul: 0.6, p12: 2 }, lift: { mode: "stream" } },
  rooftop: { boss: {}, explus: {}, abyss: { p3: 0.2, share: 0.6 }, favor: { split: 2.5, wave: 2, zigzag: 1.5, stair: 0.5, p02: 2, p13: 2, p03: 1.5 }, lift: { mode: "stream" } },
  colossus: { bpm: 150, boss: {}, explus: {}, abyss: { p3: 0.2, share: 0.6 }, levels: [3, 5, 8, 12, 15, 17], favor: { jump: 2, jumpstream: 1.5, anchor: 1.5, jackMul: 1.4, p01: 1.6, p23: 1.6, p03: 1.6 }, lift: { mode: "chord" } },
  cornercypher: { single: true, boss: { fullSub: 6 }, explus: { fullSub: 6, full: 0.7, loud: 0.4, chordScale: 1.4 }, abyss: {}, levels: [3, 5, 8, 12, 15, 17], lift: { mode: "chord" } },
  redline: { rephase: true, boss: {}, explus: {}, abyss: { p3: 0.28, share: 0.7 }, levels: [3, 6, 9, 13, 15, 18], favor: { stair: 2.5, zigzag: 2, wave: 1.3, jump: 0.6, jackMul: 0.7, p03: 1.5 }, lift: { mode: "stream" } },
  hairpin: { boss: {}, explus: { chordScale: 1.4 }, abyss: { p3: 0.3, share: 0.7 }, levels: [3, 5, 8, 12, 14, 17], favor: { jack: 2.5, anchor: 2, stair: 0.6, jackMul: 1.5, p01: 2, p23: 2 }, lift: { mode: "stream" } },
  moonshine: { boss: {}, explus: {}, abyss: { p3: 0.28, share: 0.75 }, levels: [3, 6, 9, 13, 15, 17], favor: { wave: 2.5, stair: 1.6, trill: 1.5, jump: 0.6, p02: 1.6, p13: 1.6 }, lift: { mode: "chord" } },
  kaminari: { rephase: true, boss: {}, explus: {}, abyss: { mode: "chord", p3: 0.2, share: 0.6 }, levels: [, , 9], favor: { split: 2, jack: 1.5, anchor: 1.5, stair: 0.7, p03: 2 }, lift: { mode: "stream" } },
  plushamen: { boss: {}, explus: {}, abyss: { rpb: 3.4, q3: 0.7 }, levels: [3, 6, 8, 12, 15, 18], favor: { trill2: 3, alt: 2.5, jack: 1.6, split: 1.5, stair: 0.4, zigzag: 0.5, jackMul: 1.5, p12: 2.5 }, lift: { mode: "stream" } },
  kirakira: { boss: {}, explus: {}, abyss: { mode: "chord", p3: 0.25, share: 0.65 }, favor: { stair3: 2.2, jump: 1.6, zigzag: 1.4, trill: 1.3, wave: 0.6, jackMul: 0.8, p03: 1.5, p12: 1.5 }, lift: { mode: "chord" } },
};
export function builtinArgs(c) {
  const diffs = ["easy", "normal", "hard", "expert"];
  const tweaks = {};
  if (c.boss) { diffs.push("nightmare"); tweaks.nightmare = { nightmare: c.boss }; }
  if (c.explus) { diffs.push("explus"); tweaks.explus = { nightmare: c.explus }; }
  if (c.abyss) { diffs.push("abyss"); tweaks.abyss = { abyss: c.abyss }; }
  // v2.27: 곡 개성(favor — jackMul 키는 잭 배율) · ULTIMA 끌어올리기(lift)
  if (c.favor) { const { jackMul, ...favor } = c.favor; for (const d of diffs) tweaks[d] = { ...(tweaks[d] ?? {}), favor, ...(jackMul !== undefined ? { jackMul } : {}) }; }
  if (c.lift && tweaks.explus) tweaks.explus = { ...tweaks.explus, lift: c.lift };
  for (const [d, t] of Object.entries(c.tweak ?? {})) tweaks[d] = { ...(tweaks[d] ?? {}), ...t };
  (c.levels ?? []).forEach((v, i) => { if (v === undefined) return; const d = ["easy", "normal", "hard", "expert", "nightmare", "explus"][i]; tweaks[d] = { ...(tweaks[d] ?? {}), level: v }; });
  return { diffs, tweaks };
}
