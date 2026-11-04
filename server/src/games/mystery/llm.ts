/*
 * 예/아니오 추리 (프로토) — 무료 LLM 호출 (Gemini API · Groq). 키는 server/.env 의 GEMINI_API_KEY · GROQ_API_KEY.
 * 무료 티어만 씀: 한도를 넘으면 과금 대신 오류 → 다음 모델로 넘김. 답은 JSON 하나만 받음.
 * (예전 「누가 사람이야?」 프로토의 호출부를 판정용으로 다시 씀)
 */

export type Provider = "gemini" | "groq";

export interface ModelSpec {
  id: string;
  provider: Provider;
  model: string;
  /** gemini: 생각 토큰 상한 (lite 는 설정 불가 → undefined) / groq: reasoning_effort (qwen 은 none 으로 생각 끔) */
  thinking?: number;
  effort?: "none" | "low" | "medium" | "high";
}

/*
 * 무료 한도 (2026-11-05 확인): Groq 는 모델마다 따로 분당 8,000토큰 · 하루 1,000회, Gemini 3.5 Flash 무료는 하루 20회뿐.
 * 판정 한 번 ≈ 2,000토큰 → 모델 하나로 분당 약 4문. 그래서 판정은 Groq 모델 셋을 돌려 쓰고 Gemini 는 맨 끝 비상용.
 */

/** 질문 판정: 한도가 차면 다음 모델로 (모델마다 한도가 따로라 합쳐 분당 약 12문 · 하루 약 3,000문) */
export const JUDGE_MODELS: ModelSpec[] = [
  { id: "gpt-oss-120b", provider: "groq", model: "openai/gpt-oss-120b", effort: "medium" },
  { id: "qwen-27b", provider: "groq", model: "qwen/qwen3.8-27b", effort: "none" },
  { id: "gpt-oss-20b", provider: "groq", model: "openai/gpt-oss-20b", effort: "medium" },
  { id: "gemini-flash", provider: "gemini", model: "gemini-3.5-flash", thinking: 1024 },
];

/** 정답 채점: 한 판에 몇 번뿐이라 꼼꼼한 쪽 먼저 */
export const GRADE_MODELS: ModelSpec[] = [
  { id: "gpt-oss-120b", provider: "groq", model: "openai/gpt-oss-120b", effort: "medium" },
  { id: "gemini-flash", provider: "gemini", model: "gemini-3.5-flash", thinking: 2048 },
  { id: "qwen-27b", provider: "groq", model: "qwen/qwen3.8-27b", effort: "none" },
];

export interface LlmKeys {
  gemini: string;
  groq: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export type LlmCall = (spec: ModelSpec, req: LlmRequest) => Promise<string>;

const TIMEOUT_MS = 20_000;

export class LlmError extends Error {}

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
      const thinking = spec.thinking === undefined ? {} : { thinkingConfig: { thinkingBudget: spec.thinking } };
      const j = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${spec.model}:generateContent`,
        { "x-goog-api-key": keys.gemini },
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: req.maxTokens + (spec.thinking ?? 0),
            responseMimeType: "application/json",
            ...thinking,
          },
        }
      );
      const parts: { text?: string; thought?: boolean }[] = j?.candidates?.[0]?.content?.parts ?? [];
      return parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    }
    if (!keys.groq) throw new LlmError("no groq key");
    const oss = spec.model.startsWith("openai/");
    const j = await postJson(
      "https://api.groq.com/openai/v1/chat/completions",
      { Authorization: `Bearer ${keys.groq}` },
      {
        model: spec.model,
        temperature: 0,
        // gpt-oss 는 생각 토큰도 여기에 들어가서 넉넉히
        max_completion_tokens: oss ? req.maxTokens + 1500 : req.maxTokens,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        ...(spec.effort ? { reasoning_effort: spec.effort } : oss ? { reasoning_effort: "low" } : {}),
      }
    );
    return String(j?.choices?.[0]?.message?.content ?? "");
  };
}

/** 키가 있는 회사의 모델만 */
export function availableModels(keys: LlmKeys, list: ModelSpec[]): ModelSpec[] {
  return list.filter((m) => (m.provider === "gemini" ? !!keys.gemini : !!keys.groq));
}

/** 답에서 첫 JSON 객체를 꺼냄 (```json 감싸기 · 앞뒤 잡말 · <think> 허용). 못 찾으면 null */
export function extractJson(text: string): any {
  const s = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}
