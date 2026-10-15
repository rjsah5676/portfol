/*
 * PIXEL MARBLE 밸런스 시뮬 — AI 끼리 1:1 을 잔뜩 돌려 승률을 봄.
 *
 *   npx tsx scripts/marble-sim.ts                     # 풀세팅(SSR 5강 + SSR 아이템 5강 둘) vs 전부 R 0강, 맵별
 *   npx tsx scripts/marble-sim.ts --mode mirror       # 같은 세팅끼리 (선 · 맵 치우침 확인, 50% 근처여야)
 *   npx tsx scripts/marble-sim.ts --mode char         # 캐릭터별: 그 캐릭터 5강(아이템 없음) vs R 0강(아이템 없음)
 *   npx tsx scripts/marble-sim.ts --mode item         # 아이템별: R 0강 캐릭 + 그 아이템 5강 vs R 0강 캐릭 + 같은 칸 R 0강
 *   npx tsx scripts/marble-sim.ts --mode grade        # 등급 계단: R0 · R5 · SR0 · SR5 · SSR0 · SSR5 · UR 각각 vs R0
 *   -n 400 · --map town|cross|orgel · --tune passive=1.2,item=0.9,active=1
 */
import { createRequire } from "node:module";
import type { Grade, Loadout } from "../../web/src/lib/marble/data";
// web 쪽은 CommonJS 라 engine 이 require 로 부르는 data 와 같은 인스턴스를 써야 --ck · --tune 이 먹음
const { CHARS, CK, GRADE_FLOOR, IK, ITEMS, TUNE } = createRequire(import.meta.url)("../../web/src/lib/marble/data") as typeof import("../../web/src/lib/marble/data");
import { RULE, act, newGame, type Game } from "../../web/src/lib/marble/engine";
import { botAction } from "../../web/src/lib/marble/bot";
import { MAP_IDS, type MapId } from "../../web/src/lib/marble/maps";

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const N = Number(opt("-n", "300"));
const MODE = opt("--mode", "full")!;
const MAPS_RUN: MapId[] = opt("--map") ? [opt("--map") as MapId] : MAP_IDS;
for (const kv of (opt("--tune", "") ?? "").split(",").filter(Boolean)) {
  const [k, v] = kv.split("=");
  (TUNE as Record<string, number>)[k] = Number(v);
}

for (const kv of (opt("--rule", "") ?? "").split(",").filter(Boolean)) {
  const [k, v] = kv.split("=");
  (RULE as Record<string, unknown>)[k] = v.includes("/") ? v.split("/").map(Number) : Number(v);
}
// --ck kai.cd=9,igna.boost=1/0.04 (캐릭터 · 아이템 수치표 바꿔 보기)
for (const kv of (opt("--ck", "") ?? "").split(",").filter(Boolean)) {
  const [path, v] = kv.split("=");
  const [id, f] = path.split(".");
  const tbl = (id in CK ? CK : IK) as unknown as Record<string, Record<string, unknown>>;
  tbl[id][f] = v.includes("/") ? v.split("/").map(Number) : Number(v);
}
const ROUNDS = opt("--rounds") ? Number(opt("--rounds")) : undefined;

let seedCounter = 12345;
const rand = () => {
  seedCounter = (Math.imul(seedCounter, 1103515245) + 12345) >>> 0;
  return seedCounter / 4294967296;
};
const pickOf = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

const charsOf = (g: Grade) => CHARS.filter((c) => c.grade === g);
const itemsOf = (slot: "dice" | "buddy", g: Exclude<Grade, "UR">) => ITEMS.filter((i) => i.slot === slot && i.grade === g);

function play(map: MapId, a: Loadout, b: Loadout, seed: number, aFirst: boolean) {
  const g: Game = newGame({
    map,
    seed,
    first: aFirst ? 0 : 1,
    rounds: ROUNDS,
    players: [
      { id: "a", name: "A", bot: true, lo: a },
      { id: "b", name: "B", bot: true, lo: b },
    ],
  });
  let guard = 0;
  while (!g.over && g.prompt && guard++ < 5000) act(g, g.prompt.p, botAction(g));
  if (!g.over) throw new Error(`판이 안 끝남 ${map} ${seed}`);
  return { win: g.over.winner === 0, how: g.over.how, round: g.round, g };
}

interface Agg {
  w: number;
  n: number;
  how: Record<string, number>;
  rounds: number;
}
const agg = (): Agg => ({ w: 0, n: 0, how: {}, rounds: 0 });
function run(label: string, mk: () => [Loadout, Loadout], maps = MAPS_RUN, n = N): Agg {
  const t = agg();
  for (const map of maps) {
    const a = agg();
    for (let i = 0; i < n; i++) {
      const [la, lb] = mk();
      const r = play(map, la, lb, (rand() * 2 ** 31) | 0, i % 2 === 0);
      for (const x of [a, t]) {
        x.n++;
        x.w += r.win ? 1 : 0;
        x.how[r.how] = (x.how[r.how] ?? 0) + 1;
        x.rounds += r.round;
      }
    }
    if (maps.length > 1) console.log(`  ${label.padEnd(26)} ${map.padEnd(6)} ${pct(a.w / a.n)}  평균 ${(a.rounds / a.n).toFixed(1)}바퀴  ${howTxt(a)}`);
  }
  console.log(`${label.padEnd(28)} 전체 ${pct(t.w / t.n)}  (${t.n}판)  평균 ${(t.rounds / t.n).toFixed(1)}바퀴  ${howTxt(t)}`);
  return t;
}
const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(6);
const howTxt = (a: Agg) =>
  Object.entries(a.how)
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${k} ${Math.round((v / a.n) * 100)}%`)
    .join(" · ");

const lo = (char: string, clv: number, dice?: string | null, dlv = 0, buddy?: string | null, blv = 0): Loadout => ({
  char: { id: char, lv: clv },
  dice: dice ? { id: dice, lv: dlv } : null,
  buddy: buddy ? { id: buddy, lv: blv } : null,
});
const baseR = (items = true): Loadout =>
  lo(pickOf(charsOf("R")).id, 0, items ? pickOf(itemsOf("dice", "R")).id : null, 0, items ? pickOf(itemsOf("buddy", "R")).id : null, 0);

console.log(`PIXEL MARBLE 시뮬 — 모드 ${MODE}, 맵당 ${N}판, TUNE ${JSON.stringify(TUNE)} ${opt("--rule", "")} ${ROUNDS ?? ""}`);
if (MODE === "full") {
  run("풀(UR5+SSR5×2) vs R0+R0×2", () => [lo(pickOf(charsOf("UR")).id, 5, pickOf(itemsOf("dice", "SSR")).id, 5, pickOf(itemsOf("buddy", "SSR")).id, 5), baseR()]);
  run("풀(SSR5+SSR5×2) vs R0+R0×2", () => [lo(pickOf(charsOf("SSR")).id, 5, pickOf(itemsOf("dice", "SSR")).id, 5, pickOf(itemsOf("buddy", "SSR")).id, 5), baseR()]);
  run("풀 vs R0 (아이템 없음)", () => [lo(pickOf(charsOf("SSR")).id, 5, pickOf(itemsOf("dice", "SSR")).id, 5, pickOf(itemsOf("buddy", "SSR")).id, 5), baseR(false)]);
} else if (MODE === "mirror") {
  run("R0 미러", () => {
    const x = baseR();
    return [x, structuredClone(x)];
  });
  run("SSR5 미러", () => {
    const x = lo(pickOf(charsOf("SSR")).id, 5, pickOf(itemsOf("dice", "SSR")).id, 5, pickOf(itemsOf("buddy", "SSR")).id, 5);
    return [x, structuredClone(x)];
  });
} else if (MODE === "char") {
  for (const c of CHARS) run(`${c.title}(${c.grade}) 5강`, () => [lo(c.id, 5), lo(pickOf(charsOf("R")).id, 0)], MAPS_RUN, Math.round(N / MAPS_RUN.length));
  for (const c of CHARS.filter((x) => x.grade === "R")) run(`${c.title}(R) 0강`, () => [lo(c.id, 0), lo(pickOf(charsOf("R").filter((x) => x.id !== c.id)).id, 0)], MAPS_RUN, Math.round(N / MAPS_RUN.length));
} else if (MODE === "solo") {
  // 효과 없는 인형 · 아이템 없음 상대로 — 캐릭터 하나 / 아이템 하나의 순수 세기
  const LV = Number(opt("--lv", "-1"));
  for (const c of CHARS) for (const lv of LV >= 0 ? [LV] : [0, 5]) run(`${c.title}(${c.grade}) ${lv}강`, () => [lo(c.id, lv), lo("dummy", 0)], MAPS_RUN, Math.round(N / MAPS_RUN.length));
  for (const it of ITEMS)
    for (const lv of LV >= 0 ? [LV] : [0, 5])
      run(`${it.name}(${it.grade}) ${lv}강`, () => [it.slot === "dice" ? lo("dummy", 0, it.id, lv) : lo("dummy", 0, null, 0, it.id, lv), lo("dummy", 0)], MAPS_RUN, Math.round(N / MAPS_RUN.length));
} else if (MODE === "tune") {
  // 표: 인형 상대 승률 vs 목표 (캐릭 58% + 0.53%·p · 아이템 52% + 0.4%·p)
  const only = opt("--only");
  const rows: string[] = [];
  const one = (label: string, mk: () => [Loadout, Loadout], target: number) => {
    const quiet = console.log;
    console.log = () => {};
    const r = run(label, mk, MAPS_RUN, Math.round(N / MAPS_RUN.length));
    console.log = quiet;
    const w = (r.w / r.n) * 100;
    rows.push(`${label.padEnd(24)} ${w.toFixed(1).padStart(5)}%  목표 ${target.toFixed(1)}  ${w - target >= 0 ? "+" : ""}${(w - target).toFixed(1)}`);
    console.log(rows[rows.length - 1]);
  };
  for (const c of CHARS) {
    if (only && !c.id.includes(only)) continue;
    for (const lv of [0, 5]) {
      const p = GRADE_FLOOR[c.grade] + lv;
      one(`${c.id} ${c.grade}${lv} p${p}`, () => [lo(c.id, lv), lo("dummy", 0)], 58 + 0.53 * p);
    }
  }
  for (const it of ITEMS) {
    if (only && !it.id.includes(only)) continue;
    for (const lv of [0, 5]) {
      const p = GRADE_FLOOR[it.grade] + lv;
      one(`${it.id} ${it.grade}${lv} p${p}`, () => [it.slot === "dice" ? lo("dummy", 0, it.id, lv) : lo("dummy", 0, null, 0, it.id, lv), lo("dummy", 0)], 52 + 0.4 * p);
    }
  }
} else if (MODE === "item") {
  for (const it of ITEMS)
    run(`${it.name}(${it.grade}) 5강`, () => {
      const c = pickOf(charsOf("R")).id;
      const base = pickOf(itemsOf(it.slot, "R")).id;
      const a = it.slot === "dice" ? lo(c, 0, it.id, 5) : lo(c, 0, null, 0, it.id, 5);
      const b = it.slot === "dice" ? lo(pickOf(charsOf("R")).id, 0, base, 0) : lo(pickOf(charsOf("R")).id, 0, null, 0, base, 0);
      return [a, b];
    }, MAPS_RUN, Math.round(N / MAPS_RUN.length));
} else if (MODE === "ur") {
  // UR 하나하나: UR 5강 + SSR 아이템 5강 vs R0 세트
  for (const c of charsOf("UR")) run(`${c.title} 풀세트`, () => [lo(c.id, 5, pickOf(itemsOf("dice", "SSR")).id, 5, pickOf(itemsOf("buddy", "SSR")).id, 5), baseR()]);
} else if (MODE === "grade") {
  const steps: [Grade, number][] = [
    ["R", 0],
    ["R", 5],
    ["SR", 0],
    ["SR", 5],
    ["SSR", 0],
    ["SSR", 5],
    ["UR", 0],
    ["UR", 5],
  ];
  for (const [gr, lv] of steps)
    run(`${gr} ${lv}강 (파워 ${GRADE_FLOOR[gr] + lv}) 세트`, () => {
      const ig = (gr === "UR" ? "SSR" : gr) as Exclude<Grade, "UR">;
      return [lo(pickOf(charsOf(gr)).id, lv, pickOf(itemsOf("dice", ig)).id, lv, pickOf(itemsOf("buddy", ig)).id, lv), baseR()];
    }, MAPS_RUN, Math.round(N / MAPS_RUN.length));
}
