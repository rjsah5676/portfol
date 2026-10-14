// node run.mjs OUTDIR shard/n  — 캐시된 분석으로 현재 src 채보기를 돌려 채보 JSON 저장
import fs from "node:fs";
import v8 from "node:v8";
import { loadLib, BUILTIN, builtinArgs } from "./lib.mjs";
const { auto } = await loadLib();
const out = process.argv[2];
const [shard, n] = (process.argv[3] ?? "0/1").split("/").map(Number);
fs.mkdirSync(out, { recursive: true });
const files = fs.readdirSync("/tmp/claude-0/qvs/cache").filter((f) => f.endsWith(".bin")).sort().filter((_, i) => i % n === shard);
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const r3 = (x) => Math.round(x * 1000) / 1000;
for (const f of files) {
  const id = f.replace(/\.bin$/, "");
  if (only && !only.test(id)) continue;
  const a = v8.deserialize(fs.readFileSync(`/tmp/claude-0/qvs/cache/${f}`));
  let diffs, tweaks;
  if (id.startsWith("b_")) ({ diffs, tweaks } = builtinArgs(BUILTIN[id.slice(2)]));
  else { diffs = ["easy", "normal", "hard", "expert", "nightmare", "explus"]; tweaks = { explus: { nightmare: {} } }; }
  const t0 = Date.now();
  const charts = auto.makeAutoCharts(a, diffs, 0, tweaks);
  fs.writeFileSync(`${out}/${id}.json`, JSON.stringify({ id, bpm: r3(a.bpm), beat0: r3(a.beats[0]), beats: a.beats.map(r3), div: a.div,
    charts: Object.fromEntries(Object.entries(charts).map(([d, c]) => [d, { level: c.level, notes: c.notes.map((x) => (x.end ? [r3(x.t), x.lane, r3(x.end)] : [r3(x.t), x.lane])) }])) }));
  if (process.env.V) console.log(id, ((Date.now() - t0) / 1000).toFixed(1) + "s", Object.entries(charts).map(([d, c]) => d[0] + c.level).join(" "));
}
