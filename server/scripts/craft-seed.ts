/*
 * 오늘의 조합 — 조합 미리 채우기. 결과는 src/games/craft/seed.json 에 쌓이고, 서버가 뜰 때 DB 에 없는 것만 넣음.
 * 키는 GROQ_API_KEY_REVIEW (없으면 GROQ_API_KEY) · GEMINI_API_KEY. 무료 한도 안에서 천천히.
 *
 *   npx tsx scripts/craft-seed.ts                 새 조합 300개 더
 *   npx tsx scripts/craft-seed.ts --n=1000 --gap=1500
 *   npx tsx scripts/craft-seed.ts --report        지금 seed 통계만 (조합 수 · 깊이 분포 · 오늘 목표 후보)
 *
 * 고르는 법: 얕은 원소끼리 먼저 (너비 우선). 시작 재료에서 가까운 원소들의 조합을 다 채워야
 * 기준 타수 5~9 짜리 목표가 많이 생기고, 플레이어가 처음 만지는 조합도 다 미리 준비됨.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeCosts, CRAFT_MODELS, createCraft, kstDay, memoryStore, pairKey, pickDaily, STARTERS, type Recipe } from "../src/games/craft/craft";
import { availableModels, createLlm } from "../src/games/mystery/llm";

process.loadEnvFile?.(".env");

const args = process.argv.slice(2);
const opt = (name: string, def: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? def;
const N = Number(opt("n", "300"));
const GAP = Number(opt("gap", "1500"));
const FILE = path.resolve("src/games/craft/seed.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const seed = JSON.parse(readFileSync(FILE, "utf8")) as { elements: Record<string, string>; recipes: [string, string, string][] };
const store = memoryStore(seed);

const recipesNow = (): Recipe[] => store.dump().recipes.map(([a, b, r]) => ({ key: pairKey(a, b), a, b, result: r, model: "", at: 0 }));

function report() {
  const d = store.dump();
  const { need } = computeCosts(recipesNow());
  const hist = new Map<number, number>();
  for (const [n, s] of need) if (!STARTERS.some((x) => x.name === n)) hist.set(s.size, (hist.get(s.size) ?? 0) + 1);
  console.log(`원소 ${Object.keys(d.elements).length} · 조합 ${d.recipes.length}`);
  console.log("최소 조합 수 분포:", [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join("  "));
  const pool = [...need.entries()].filter(([, s]) => s.size >= 5 && s.size <= 9).length;
  console.log(`데일리 목표 후보(기준 5~9타): ${pool}개`);
  const today = pickDaily(kstDay(Date.now()), recipesNow(), []);
  if (today) console.log(`오늘 목표 예시: ${today.target} (기준 ${today.par}) — ${today.path.map((s) => `${s[0]}+${s[1]}=${s[2]}`).join(" → ")}`);
}

function save() {
  const d = store.dump();
  writeFileSync(FILE, JSON.stringify(d, null, 0).replace(/\],\[/g, "],\n[") + "\n");
}

if (args.includes("--report")) {
  report();
  process.exit(0);
}

const keys = { gemini: process.env.GEMINI_API_KEY ?? "", groq: process.env.GROQ_API_KEY_REVIEW || process.env.GROQ_API_KEY || "" };
const models = availableModels(keys, CRAFT_MODELS);
if (!models.length) {
  console.error("LLM 키가 없음 (GROQ_API_KEY_REVIEW / GROQ_API_KEY)");
  process.exit(1);
}
const craft = createCraft({ store, llm: createLlm(keys), models, perMinute: 100000, maxInflight: 1 });

/** 다음에 합칠 쌍: 아직 안 해 본 쌍 중 두 재료의 조합 수 합이 가장 작은 축에서 무작위 */
function nextPairs(): [string, string][] {
  const { need } = computeCosts(recipesNow());
  const tried = new Set(store.dump().recipes.map(([a, b]) => pairKey(a, b)));
  const els = [...need.entries()].map(([n, s]) => ({ n, c: s.size })).sort((p, q) => p.c - q.c);
  const out: { a: string; b: string; c: number }[] = [];
  for (let i = 0; i < els.length; i++)
    for (let j = i; j < els.length; j++) {
      const c = els[i].c + els[j].c;
      if (!tried.has(pairKey(els[i].n, els[j].n))) out.push({ a: els[i].n, b: els[j].n, c });
    }
  out.sort((p, q) => p.c - q.c);
  const min = out[0]?.c ?? 0;
  // 얕은 쪽 위주로, 하지만 깊이가 고르게 퍼지게: 두 재료 조합 수 합을 min ~ min+6 에서 고르게 뽑음
  const bySum = new Map<number, { a: string; b: string }[]>();
  for (const x of out) if (x.c <= min + 6) (bySum.get(x.c) ?? bySum.set(x.c, []).get(x.c)!).push(x);
  const sums = [...bySum.keys()];
  const batch: [string, string][] = [];
  for (let k = 0; k < 25 && sums.length; k++) {
    const list = bySum.get(sums[Math.floor(Math.random() * sums.length)])!;
    const [x] = list.splice(Math.floor(Math.random() * list.length), 1);
    if (x) batch.push([x.a, x.b]);
  }
  return batch;
}

let made = 0;
let fails = 0;
outer: while (made < N) {
  const batch = nextPairs();
  if (!batch.length) break;
  for (const [a, b] of batch) {
    if (made >= N) break outer;
    if (await store.recipe(pairKey(a, b))) continue;
    try {
      const r = await craft.combine(a, b, "seed", null);
      made++;
      fails = 0;
      console.log(`${String(made).padStart(4)} ${a} + ${b} = ${r.result.emoji} ${r.result.name}${r.newElement ? "  ★" : ""}`);
      if (made % 20 === 0) save();
    } catch (e) {
      fails++;
      console.warn(`  실패 (${fails}) ${a}+${b}: ${(e as Error).message}`);
      if (fails >= 6) {
        console.warn("연속 실패 — 한도 같음. 저장하고 멈춤");
        break outer;
      }
      await sleep(30_000);
      continue;
    }
    await sleep(GAP);
  }
}
save();
report();
