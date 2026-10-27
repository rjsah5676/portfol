// 개발용: 대본의 장면 이동 대상이 전부 있는지 + 아무도 안 가는 장면 + 안 쓴 반성회 · 엔딩 검사 (커밋 안 함)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const files = { "script-w1.ts": "export const W1", "script-w2.ts": "export const W2", "script-w2s.ts": "export const W2S", "script-w3s.ts": "export const W3S", "script-w3a.ts": "export const W3A", "script-w3y.ts": "export const W3Y", "script-w3n.ts": "export const W3N" };
let body = "";
let head = "";
for (const [f, mark] of Object.entries(files)) {
  const src = read(`../src/lib/love/${f}`);
  head += "\n" + src.slice(0, src.indexOf(mark));
  body += "\n" + src.slice(src.indexOf(mark));
}
const defined = [...body.matchAll(/^  ([a-z0-9_]+): \[/gm)].map((m) => m[1]);
const dup = defined.filter((d, i) => defined.indexOf(d) !== i);
const def = new Set(defined);
const all = head + body;
const targets = [
  ...[...all.matchAll(/(?:to|else|review): "([a-z0-9_]+)"/g)].map((m) => m[1]),
  // 일정 카드: card("제목", "장소", "장면", …)
  ...[...all.matchAll(/card\("[^"]*", "[^"]*", "([a-z0-9_]+)"/g)].map((m) => m[1]),
];
const start = /START = "([a-z0-9_]+)"/.exec(read("../src/lib/love/script.ts"))?.[1];
const assets = read("../src/lib/love/assets.ts");
const reviews = [...assets.matchAll(/review: "([a-z0-9_]+)"/g)].map((m) => m[1]);
const endIds = [...assets.matchAll(/\{ id: "([a-z0-9_]+)", no:/g)].map((m) => m[1]);
const usedEnds = new Set([...body.matchAll(/t: "ending", id: "([a-z0-9_]+)"/g)].map((m) => m[1]));
const usedCg = new Set([...body.matchAll(/t: "cg", id: "([a-z0-9_]+)"/g)].map((m) => m[1]));
const cgIds = [...assets.matchAll(/^  ([a-z0-9_]+): \{ src: `\$\{B\}\/cg\//gm)].map((m) => m[1]);
const missing = [...new Set(targets)].filter((t) => !def.has(t) && t !== "__title");
const used = new Set([...targets, ...reviews, "open", start]);
const orphan = [...def].filter((d) => !used.has(d));
console.log("start " + start + (def.has(start) ? "" : " (없음!)"));
console.log("scenes " + def.size);
console.log("duplicate: " + (dup.join(", ") || "none"));
console.log("missing: " + (missing.join(", ") || "none"));
console.log("orphan: " + (orphan.join(", ") || "none"));
console.log("review not written: " + (reviews.filter((r) => !def.has(r)).join(", ") || "none"));
console.log("ending not reachable: " + (endIds.filter((e) => !usedEnds.has(e)).join(", ") || "none"));
console.log("cg not used: " + (cgIds.filter((c) => !usedCg.has(c)).join(", ") || "none"));
