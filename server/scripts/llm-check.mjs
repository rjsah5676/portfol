// AI 사람 찾기: server/.env 의 LLM 키 확인 (키 값은 출력하지 않음)
//   node scripts/llm-check.mjs          모델 목록
//   node scripts/llm-check.mjs chat     후보 모델에 같은 대사를 시켜 속도 · 말투 확인
import path from "node:path";
import { fileURLToPath } from "node:url";

try { process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env")); } catch {}
const g = process.env.GEMINI_API_KEY?.trim(), q = process.env.GROQ_API_KEY?.trim();
console.log("GEMINI_API_KEY:", g ? `있음 (${g.length}자, ${g.slice(0, 4)}…)` : "없음");
console.log("GROQ_API_KEY:", q ? `있음 (${q.length}자, ${q.slice(0, 4)}…)` : "없음");

async function gemini(model, system, user, extra = {}) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": g, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 1.0, maxOutputTokens: 400, ...extra },
    }),
  });
  const j = await r.json();
  if (!r.ok) return `HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`;
  return (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text).join("").trim()
    + `  [토큰 in ${j.usageMetadata?.promptTokenCount} / out ${j.usageMetadata?.candidatesTokenCount} / think ${j.usageMetadata?.thoughtsTokenCount ?? 0}]`;
}
async function groq(model, system, user, extra = {}) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${q}`, "content-type": "application/json" },
    body: JSON.stringify({ model, temperature: 1.0, max_completion_tokens: 600, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...extra }),
  });
  const j = await r.json();
  if (!r.ok) return `HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`;
  return (j.choices?.[0]?.message?.content ?? "").trim() + `  [토큰 in ${j.usage?.prompt_tokens} / out ${j.usage?.completion_tokens}]`;
}

if (process.argv[2] === "ping") {
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": g } });
    await r.text();
    console.log(`Gemini 목록 ${i + 1}: ${r.status} · ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  const models = process.argv.slice(3).length ? process.argv.slice(3) : ["gemini-3.8-flash"];
  await Promise.all(models.map(async (m) => {
    const t = Date.now();
    const thinking = m.startsWith("gemma") ? {} : { thinkingConfig: { thinkingBudget: 0 } };
    const out = await gemini(m, "한 문장으로 답해.", "주말에 뭐 할 거야?", thinking).catch((e) => "에러 " + e.message);
    console.log(`${m} · ${((Date.now() - t) / 1000).toFixed(1)}s · ${out}`);
  }));
} else if (process.argv[2] === "chat") {
  const system = "너는 AI다. 채팅방에 AI 5명이 모여 있는데, 이 중 한 명은 AI인 척하는 사람이다. 너는 누가 사람인지 모른다. 한국어 채팅처럼 1~2문장으로 짧게 말해. 이름표나 따옴표 없이 대사만.";
  const user = "[주제] 사람이 아니라는 걸 증명하려면 뭘 보여주면 될까?\n[대화]\n레오: 난 3초 안에 원주율 100자리를 말할 수 있어. 그게 증거지.\n솔: 그건 검색만 해도 되잖아 ㅋㅋ\n\n이제 네 차례야.";
  const runs = [
    ["gemini-3.5-flash (생각 0)", () => gemini("gemini-3.5-flash", system, user, { thinkingConfig: { thinkingBudget: 0 } })],
    ["gemini-3.5-flash (생각 0) 2회", () => gemini("gemini-3.5-flash", system, user, { thinkingConfig: { thinkingBudget: 0 } })],
    ["gemini-3.5-flash-lite", () => gemini("gemini-3.5-flash-lite", system, user)],
    ["gpt-oss-120b (low)", () => groq("openai/gpt-oss-120b", system, user, { reasoning_effort: "low" })],
    ["gpt-oss-120b (low) 2회", () => groq("openai/gpt-oss-120b", system, user, { reasoning_effort: "low" })],
    ["gpt-oss-20b (low)", () => groq("openai/gpt-oss-20b", system, user, { reasoning_effort: "low" })],
    ["qwen3.8-27b (none)", () => groq("qwen/qwen3.8-27b", system, user, { reasoning_effort: "none" })],
    ["qwen3.8-27b (none) 2회", () => groq("qwen/qwen3.8-27b", system, user, { reasoning_effort: "none" })],
  ];
  for (const [name, fn] of runs) {
    const t = Date.now();
    let out;
    try { out = await fn(); } catch (e) { out = "에러 " + e.message; }
    console.log(`\n▶ ${name} · ${((Date.now() - t) / 1000).toFixed(1)}s\n${out}`);
  }
} else {
  if (g) {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": g } });
    const j = await r.json();
    console.log("\n[Gemini]", r.status);
    if (j.models) {
      for (const m of j.models) if ((m.supportedGenerationMethods || []).includes("generateContent")) console.log(" ", m.name.replace("models/", ""));
    } else console.log(JSON.stringify(j).slice(0, 300));
  }
  if (q) {
    const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${q}` } });
    const j = await r.json();
    console.log("\n[Groq]", r.status);
    if (j.data) for (const m of j.data) console.log(" ", m.id, "·", m.owned_by ?? "");
    else console.log(JSON.stringify(j).slice(0, 300));
  }
}
