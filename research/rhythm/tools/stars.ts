import { starRating } from "/home/claude/site/src/lib/rhythm/stars";
import fs from "node:fs";
const dir = "/home/claude/osz2/ours_gen";
const out: any[] = [];
for (const f of fs.readdirSync(dir).sort()) {
  const d = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
  for (const k of Object.keys(d.charts)) {
    const c = d.charts[k];
    c.stars = starRating(c.notes.map((n: number[]) => (n.length > 2 ? { t: n[0], lane: n[1], end: n[2] } : { t: n[0], lane: n[1] })));
  }
  out.push(d);
}
fs.writeFileSync("/home/claude/osz2/ours_gen_stars.json", JSON.stringify(out));
console.log(out.length);
