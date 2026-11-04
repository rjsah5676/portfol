#!/usr/bin/env node
/*
 * 예/아니오 추리 — 판정 · 채점 정확도 확인 (M0). 실제 LLM 으로 돌림.
 *   1) server/.env 에 GEMINI_API_KEY · GROQ_API_KEY (둘 중 하나 이상)
 *   2) cd server && npm run dev   (다른 창)
 *   3) cd server && node scripts/mystery-check.mjs [사건id ...] [--repeat=2] [--base=http://localhost:4000]
 * 기대 판정은 scripts/mystery-check.json. 캐시는 끄고(개발 모드 전용 noCache) 매번 새로 판정받음.
 * --repeat=N 이면 같은 질문을 N판에 걸쳐 물어 판정이 흔들리는지도 봄.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, def) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? def;
const BASE = opt("base", "http://localhost:4000");
const REPEAT = Math.max(1, Number(opt("repeat", "1")) || 1);
const only = args.filter((a) => !a.startsWith("--"));
const spec = JSON.parse(readFileSync(new URL("./mystery-check.json", import.meta.url), "utf8"));

class HttpError extends Error {
  constructor(status, message) {
    super(`${status} ${message}`);
    this.status = status;
  }
}

async function call(path, body) {
  const res = await fetch(`${BASE}/api/mystery-proto${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, j?.error?.message ?? "");
  return j;
}

/** 개발 서버가 파일 변경으로 다시 켜지는 중이면 (연결 거부) 뜰 때까지 기다림 */
async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      await call("/status");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("서버가 60초 동안 안 뜸");
}

/** 판은 서버 메모리라 서버가 다시 켜지면 사라짐 → 새 판을 열고 그 요청만 다시 */
async function withPlay(caseId, holder, fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!holder.id) holder.id = (await call("/start", { caseId })).id;
      return await fn(holder.id);
    } catch (e) {
      const restarted = !(e instanceof HttpError) || e.status === 404;
      if (!restarted || attempt === 2) throw e;
      await waitServer();
      holder.id = null;
    }
  }
}

const FAMILY = { Y: ["YES", "KEY_YES"], N: ["NO", "KEY_NO"] };
const allowed = (ok) => ok.flatMap((v) => FAMILY[v] ?? [v]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await waitServer();
const status = await call("/status");
if (!status.enabled) {
  console.error("게임이 꺼져 있음 — server/.env 에 GEMINI_API_KEY 또는 GROQ_API_KEY 를 넣고 서버를 다시 켜 주세요.");
  process.exit(1);
}

let askTotal = 0;
let askOk = 0;
let unstable = 0;
let gradeTotal = 0;
let gradeOk = 0;
const misses = [];

for (const [caseId, t] of Object.entries(spec.cases)) {
  if (only.length && !only.includes(caseId)) continue;
  console.log(`\n■ ${caseId}`);
  const answers = t.ask.map(() => []);
  for (let rep = 0; rep < REPEAT; rep++) {
    const play = { id: null };
    for (const [i, item] of t.ask.entries()) {
      const t0 = Date.now();
      let verdict;
      try {
        verdict = (await withPlay(caseId, play, (id) => call("/ask", { id, question: item.q, noCache: true }))).verdict;
      } catch (e) {
        verdict = `ERROR(${e.message})`;
      }
      answers[i].push(verdict);
      const good = allowed(item.ok).includes(verdict);
      askTotal++;
      if (good) askOk++;
      else misses.push({ caseId, q: item.q, got: verdict, ok: item.ok });
      console.log(`  ${good ? "✓" : "✗"} ${String(Date.now() - t0).padStart(5)}ms  ${verdict.padEnd(10)} ${item.q}${good ? "" : `   (기대: ${item.ok.join("/")})`}`);
      // 무료 한도(모델당 분당 약 4문)를 넘기지 않게 사람 속도로
      await sleep(Number(opt("gap", "6000")));
    }
  }
  if (REPEAT > 1) {
    for (const [i, list] of answers.entries()) {
      if (new Set(list).size > 1) {
        unstable++;
        console.log(`  ~ 흔들림: ${t.ask[i].q} → ${list.join(", ")}`);
      }
    }
  }
  for (const g of t.grade ?? []) {
    const t0 = Date.now();
    try {
      const v = await withPlay(caseId, { id: null }, (id) => call("/submit", { id, answer: g.a }));
      const s = v.submissions.at(-1);
      const good = g.passed !== undefined ? s.passed === g.passed : s.passed <= g.passedMax;
      gradeTotal++;
      if (good) gradeOk++;
      const failed = s.failed.map((f) => `${f.label}:${f.status}`).join(", ");
      console.log(`  ${good ? "✓" : "✗"} 채점 ${String(Date.now() - t0).padStart(5)}ms  ${s.passed}/${s.total} (기대 ${g.passed ?? `≤${g.passedMax}`})  ${g.a.slice(0, 30)}…${failed ? `  [${failed}]` : ""}`);
    } catch (e) {
      gradeTotal++;
      console.log(`  ✗ 채점 ERROR(${e.message})  ${g.a.slice(0, 30)}…`);
    }
  }
}

console.log(`\n판정 ${askOk}/${askTotal} 맞음 (${((askOk / Math.max(1, askTotal)) * 100).toFixed(1)}%)${REPEAT > 1 ? ` · 흔들린 질문 ${unstable}개` : ""}`);
console.log(`채점 ${gradeOk}/${gradeTotal} 맞음`);
if (misses.length) {
  console.log("\n틀린 판정:");
  for (const m of misses) console.log(`  [${m.caseId}] ${m.q} → ${m.got} (기대 ${m.ok.join("/")})`);
}
