/*
 * AI 사람 찾기 — 무료 LLM 호출 (Gemini API · Groq). 키는 server/.env 의 GEMINI_API_KEY · GROQ_API_KEY.
 * 무료 티어만 씀: 한도를 넘으면 과금되지 않고 오류가 나므로, 실패하면 다른 모델로 넘겨서 판이 멈추지 않게 함.
 * 호출마다 독립(이전 판을 기억하지 않음) — 앱의 메모리·맞춤 지침이 붙지 않아 키 주인 성향이 섞이지 않음.
 */

export type Provider = "gemini" | "groq";

export interface ModelSpec {
  /** 좌석 식별자 (공개 X, 판이 끝나면 공개) */
  id: string;
  /** 판 끝에 보여 줄 이름 */
  label: string;
  company: string;
  provider: Provider;
  model: string;
}

/** 좌석 후보. 2026-11 기준 무료 티어에서 빠르고 한국어가 되는 것만 (gemini 3.7·3.8 flash 는 무료 티어에서 20~70초라 제외) */
export const SEAT_MODELS: ModelSpec[] = [
  { id: "gemini-flash", label: "Gemini 3.5 Flash", company: "Google", provider: "gemini", model: "gemini-3.5-flash" },
  { id: "gemini-lite", label: "Gemini 3.5 Flash-Lite", company: "Google", provider: "gemini", model: "gemini-3.5-flash-lite" },
  { id: "gpt-oss", label: "GPT-OSS 120B", company: "OpenAI", provider: "groq", model: "openai/gpt-oss-120b" },
  { id: "qwen", label: "Qwen 3.8 27B", company: "Alibaba", provider: "groq", model: "qwen/qwen3.8-27b" },
];

/** 좌석 모델이 실패했을 때 대신 쓸 모델 (순서대로) */
export const FALLBACK_MODELS: ModelSpec[] = [
  { id: "gpt-oss-20b", label: "GPT-OSS 20B", company: "OpenAI", provider: "groq", model: "openai/gpt-oss-20b" },
  SEAT_MODELS[2],
  SEAT_MODELS[1],
];

export interface LlmKeys {
  gemini: string;
  groq: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  temperature: number;
  /** 답 길이 상한 (생각 토큰 제외 기준) */
  maxTokens: number;
}

export type LlmCall = (spec: ModelSpec, req: LlmRequest) => Promise<string>;

const TIMEOUT_MS = 15_000;

class LlmError extends Error {}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new LlmError(`HTTP ${res.status} ${JSON.stringify(json?.error ?? json).slice(0, 160)}`);
  return json;
}

export function createLlm(keys: LlmKeys): LlmCall {
  return async (spec, req) => {
    if (spec.provider === "gemini") {
      if (!keys.gemini) throw new LlmError("no gemini key");
      // lite 는 thinkingBudget 설정을 받지 않음(400). flash 는 생각을 끄지 않으면 수 초~수십 초 걸림
      const thinking = spec.model.includes("lite") ? {} : { thinkingConfig: { thinkingBudget: 0 } };
      const j = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${spec.model}:generateContent`,
        { "x-goog-api-key": keys.gemini },
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens, ...thinking },
        }
      );
      const parts: { text?: string; thought?: boolean }[] = j?.candidates?.[0]?.content?.parts ?? [];
      return parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    }
    if (!keys.groq) throw new LlmError("no groq key");
    // gpt-oss 는 생각 토큰도 max_completion_tokens 에 들어가서 넉넉히, qwen 은 생각 끔
    const oss = spec.model.startsWith("openai/");
    const j = await postJson(
      "https://api.groq.com/openai/v1/chat/completions",
      { Authorization: `Bearer ${keys.groq}` },
      {
        model: spec.model,
        temperature: req.temperature,
        max_completion_tokens: oss ? req.maxTokens + 500 : req.maxTokens,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        reasoning_effort: oss ? "low" : "none",
      }
    );
    return String(j?.choices?.[0]?.message?.content ?? "");
  };
}

/** 키가 있는 회사의 모델만 */
export function availableModels(keys: LlmKeys, list: ModelSpec[]): ModelSpec[] {
  return list.filter((m) => (m.provider === "gemini" ? !!keys.gemini : !!keys.groq));
}
