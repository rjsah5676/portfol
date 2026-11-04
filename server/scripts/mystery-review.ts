/*
 * 예/아니오 추리 — 사건 검수 (정적 + LLM). 서버 안 켜도 됨. 키는 GROQ_API_KEY_REVIEW (없으면 GROQ_API_KEY).
 *
 *   npx tsx scripts/mystery-review.ts                      등록된 사건 전부
 *   npx tsx scripts/mystery-review.ts boxes window         일부만
 *   npx tsx scripts/mystery-review.ts --file=cases/candidates/foo.json   후보 JSON (배열 또는 객체 하나)
 *   옵션: --lint-only · --repeat=2(흔들림) · --gap=6000(ms) · --play=cases/plays/foo.txt(자동 플레이 질문 목록, 줄마다 질문)
 *         --out=cases/reviews/<id>.md (기본값, 리포트 저장)
 *
 * 하는 일
 *   1. lint          정적 검수 (id · 개수 · 문제↔진상 · 중복)
 *   2. expect        기대 판정 셋 → 정확도 (95% 미만이면 반려)
 *   3. traps         오답 가설을 그대로 질문으로 → 전부 NO 계열이어야 (KEY_NO 면 더 좋음)
 *   4. keys          핵심 사실을 그대로 질문으로 → 전부 YES 계열 (KEY_YES 면 더 좋음)
 *   5. stable        --repeat 로 같은 질문 다시 → 판정 흔들림
 *   6. play          --play 파일의 질문을 순서대로 던져 플레이 흐름 기록 (질문은 사람/Claude 가 미리 씀 — 호출 절약)
 *   7. grade         expected.grade 채점 테스트
 * 호출 수 ≈ 기대 판정 + 가설 + 핵심 + 플레이 질문 + 채점 (사건 하나 40~80콜). 무료 한도(모델당 분당 ~4문)에 맞춰 질문 사이 쉼.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CASES, caseById, type MysteryCase } from "../src/games/mystery/cases";
import { createMystery, type Verdict } from "../src/games/mystery/game";
import { lintCase } from "../src/games/mystery/lint";
import { availableModels, createLlm, GRADE_MODELS, JUDGE_MODELS } from "../src/games/mystery/llm";

process.loadEnvFile?.(".env");

const args = process.argv.slice(2);
const opt = (name: string, def: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? def;
const flag = (name: string) => args.includes(`--${name}`);
const only = args.filter((a) => !a.startsWith("--"));
const GAP = Number(opt("gap", "6000"));
const REPEAT = Math.max(1, Number(opt("repeat", "1")) || 1);
const LINT_ONLY = flag("lint-only");
const FILE = opt("file", "");
const PLAY = opt("play", "");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FAMILY: Record<string, Verdict[]> = { Y: ["YES", "KEY_YES"], N: ["NO", "KEY_NO"] };
const allowed = (ok: string[]) => ok.flatMap((v) => FAMILY[v] ?? [v as Verdict]);

// 대상 사건
let targets: MysteryCase[];
if (FILE) {
  const j = JSON.parse(readFileSync(FILE, "utf8"));
  targets = Array.isArray(j) ? j : [j];
} else {
  targets = only.length ? only.map((id) => caseById(id)!).filter(Boolean) : CASES;
}
if (!targets.length) {
  console.error("검수할 사건이 없음");
  process.exit(1);
}

const keys = { gemini: process.env.GEMINI_API_KEY ?? "", groq: process.env.GROQ_API_KEY_REVIEW || process.env.GROQ_API_KEY || "" };
const usingReviewKey = !!process.env.GROQ_API_KEY_REVIEW;
const judgeModels = availableModels(keys, JUDGE_MODELS);
const gradeModels = availableModels(keys, GRADE_MODELS);

interface Section {
  title: string;
  lines: string[];
  ok: boolean;
}

async function review(c: MysteryCase): Promise<{ ok: boolean; md: string }> {
  const sections: Section[] = [];
  let fatal = false;

  // 1. lint
  const issues = lintCase(c, CASES.filter((o) => o.id !== c.id));
  const errs = issues.filter((i) => i.level === "error");
  sections.push({
    title: `정적 검수 — 오류 ${errs.length} · 경고 ${issues.length - errs.length}`,
    lines: issues.length ? issues.map((i) => `- ${i.level === "error" ? "❌" : "⚠️"} [${i.code}] ${i.message}`) : ["- 문제 없음"],
    ok: errs.length === 0,
  });
  if (errs.length) fatal = true;
  if (LINT_ONLY || !judgeModels.length) {
    if (!judgeModels.length && !LINT_ONLY) sections.push({ title: "LLM 검수 건너뜀", lines: ["- GROQ_API_KEY_REVIEW / GROQ_API_KEY 없음"], ok: false });
    return finish(c, sections, !fatal);
  }

  // 판 하나로 돌림 (캐시 끔)
  const game = createMystery({ llm: createLlm(keys), judgeModels, gradeModels });
  // 등록 안 된 후보도 돌릴 수 있게 CASES 에 잠깐 끼움
  const injected = !CASES.includes(c);
  if (injected) CASES.push(c);
  // 한도(429)로 전 모델이 쉬면 조금 길게 기다렸다 두 번 더 시도. 그래도 안 되면 ERROR — 사건 탓이 아니라 "미판정"으로 셈
  let unjudged = 0;
  const ask = async (q: string): Promise<Verdict> => {
    let err = "";
    for (let t = 0; t < 3; t++) {
      if (t) await sleep(GAP * 5);
      const p = game.start(c.id);
      try {
        return (await game.ask(p.id, q, { noCache: true })).verdict;
      } catch (e: any) {
        err = String(e?.message ?? e).slice(0, 40);
      } finally {
        await sleep(GAP);
      }
    }
    unjudged++;
    return `ERROR(${err})` as Verdict;
  };
  const isErr = (v: string) => v.startsWith("ERROR");

  try {
    // 2. expect (+ 5. stable)
    const exp = c.expected?.ask ?? [];
    if (exp.length) {
      const lines: string[] = [];
      let okN = 0;
      let unstable = 0;
      for (const e of exp) {
        const got: string[] = [];
        for (let r = 0; r < REPEAT; r++) got.push(await ask(e.q));
        if (isErr(got[0])) {
          lines.push(`- ? ${got[0]}  ${e.q}`);
          continue;
        }
        const good = allowed(e.ok).includes(got[0] as Verdict);
        if (good) okN++;
        const wobble = new Set(got).size > 1;
        if (wobble) unstable++;
        lines.push(`- ${good ? "✓" : "✗"} ${got.join("/")}  ${e.q}${good ? "" : `  (기대 ${e.ok.join("/")})`}${wobble ? "  ~흔들림" : ""}`);
      }
      const judged = lines.filter((l) => !l.startsWith("- ?")).length;
      const acc = judged ? okN / judged : 0;
      sections.push({ title: `기대 판정 ${okN}/${judged} (${(acc * 100).toFixed(0)}%)${REPEAT > 1 ? ` · 흔들림 ${unstable}` : ""}`, lines, ok: acc >= 0.95 });
      if (acc < 0.95) fatal = true;
    }

    // 3. traps — 가설 문장을 "~인가요?"로
    {
      const lines: string[] = [];
      let bad = 0;
      for (const b of c.falseBeliefs) {
        const q = toQuestion(b.statement);
        const v = await ask(q);
        const good = v === "NO" || v === "KEY_NO";
        if (!good && !isErr(v)) bad++;
        lines.push(`- ${isErr(v) ? "?" : good ? (v === "KEY_NO" ? "★" : "✓") : "✗"} ${v}  ${q}`);
      }
      sections.push({ title: `오답 가설 ${c.falseBeliefs.length - bad}/${c.falseBeliefs.length} 가 NO 계열`, lines, ok: bad === 0 });
      if (bad) fatal = true;
    }

    // 4. keys — 핵심 사실을 질문으로
    {
      const keysF = c.facts.filter((f) => f.key);
      const lines: string[] = [];
      let bad = 0;
      for (const f of keysF) {
        const q = toQuestion(f.statement.replace(/\s*\([^)]*\)/g, ""));
        const v = await ask(q);
        const good = v === "YES" || v === "KEY_YES";
        if (!good && !isErr(v)) bad++;
        lines.push(`- ${isErr(v) ? "?" : good ? (v === "KEY_YES" ? "★" : "✓") : "✗"} ${v}  ${q}`);
      }
      sections.push({ title: `핵심 사실 ${keysF.length - bad}/${keysF.length} 가 YES 계열`, lines, ok: bad === 0 });
      if (bad) fatal = true;
    }

    // 6. play
    if (PLAY && existsSync(PLAY)) {
      const qs = readFileSync(PLAY, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
      const p = game.start(c.id);
      const lines: string[] = [];
      let keyHits = 0;
      for (const q of qs) {
        try {
          const r = await game.ask(p.id, q, { noCache: true });
          if (r.verdict.startsWith("KEY_")) keyHits++;
          const clue = r.view.clues.length;
          lines.push(`- [${String(r.view.used).padStart(2)}] ${r.verdict.padEnd(9)} ${q}${clue ? `  (단서 ${clue})` : ""}`);
        } catch (e: any) {
          lines.push(`- ERROR ${String(e?.message ?? e).slice(0, 60)}  ${q}`);
        }
        await sleep(GAP);
      }
      const v = game.view(p.id);
      lines.push(`- 질문 ${v.used}문 · 큰 도장 ${keyHits}회 · 공개 단서 ${v.clues.length}`);
      sections.push({ title: `자동 플레이 (${qs.length}문)`, lines, ok: true });
    }

    // 7. grade
    const grades = c.expected?.grade ?? [];
    if (grades.length) {
      const lines: string[] = [];
      let okN = 0;
      for (const g of grades) {
        const p = game.start(c.id);
        try {
          const v = await game.submit(p.id, g.answer);
          const s = v.submissions.at(-1)!;
          const good = g.passed !== undefined ? s.passed === g.passed : s.passed <= (g.passedMax ?? 0);
          if (good) okN++;
          lines.push(`- ${good ? "✓" : "✗"} ${s.passed}/${s.total}${s.bonus.length ? ` +보너스 ${s.bonus.length}` : ""} (기대 ${g.passed ?? `≤${g.passedMax}`})  ${g.answer.slice(0, 40)}…${s.failed.length ? `  [${s.failed.map((f) => `${f.label}:${f.status}`).join(", ")}]` : ""}`);
        } catch (e: any) {
          lines.push(`- ✗ ERROR ${String(e?.message ?? e).slice(0, 60)}`);
        }
        await sleep(GAP);
      }
      sections.push({ title: `채점 ${okN}/${grades.length}`, lines, ok: okN === grades.length });
      if (okN < grades.length) fatal = true;
    }
  } finally {
    if (injected) CASES.splice(CASES.indexOf(c), 1);
  }
  if (unjudged) sections.push({ title: `미판정 ${unjudged}건 — LLM 한도로 못 물어봄. 통과/반려 집계에서 뺐으니 나중에 다시 돌릴 것`, lines: [], ok: false });
  return finish(c, sections, !fatal);
}

/** 서술문 → 질문문 (대충: 끝을 "~인가요?"로). 검수용이라 어색해도 됨 */
function toQuestion(s: string): string {
  const t = s.replace(/\.$/, "").trim();
  if (/(다|음|임)$/.test(t)) return t.replace(/(했다|였다|있었다|없었다|이었다|왔다|갔다|않았다|됐다|했었다|이다|다)$/, (m) => ({ 했다: "했나요", 였다: "였나요", 있었다: "있었나요", 없었다: "없었나요", 이었다: "이었나요", 왔다: "왔나요", 갔다: "갔나요", 않았다: "않았나요", 됐다: "됐나요", 했었다: "했나요", 이다: "인가요", 다: "나요" })[m] ?? "인가요") + "?";
  return `${t}인가요?`;
}

function finish(c: MysteryCase, sections: Section[], ok: boolean) {
  const md = [
    `# 검수 — ${c.title} (${c.id} v${c.version}, ${c.level})`,
    ``,
    `결과: **${ok ? "통과" : "반려"}** · ${new Date().toISOString().slice(0, 16).replace("T", " ")} · 판정 모델 ${judgeModels.map((m) => m.id).join(" → ") || "없음"} · 키 ${usingReviewKey ? "검수용" : "플레이용(!)"}`,
    ``,
    ...sections.flatMap((s) => [`## ${s.ok ? "✅" : "❌"} ${s.title}`, ...s.lines, ``]),
  ].join("\n");
  return { ok, md };
}

const outDir = opt("out", "cases/reviews");
mkdirSync(outDir, { recursive: true });
let allOk = true;
for (const c of targets) {
  console.log(`\n■ ${c.id} 검수 중…`);
  const { ok, md } = await review(c);
  const file = path.join(outDir, `${c.id}.md`);
  writeFileSync(file, md);
  console.log(md);
  console.log(`→ ${file}`);
  if (!ok) allOk = false;
}
process.exit(allOk ? 0 : 1);
