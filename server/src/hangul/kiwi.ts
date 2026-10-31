import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { coreOf, GRADES, gradeOf, hangulLen, isContent, isLine, sentencePoints, type Judge, type Morph } from "../../../web/src/lib/hangul/judge";
import SLANG_LIST from "./slang.json";

/*
 * 니들이 한글을 알아? 판정기 — 한국어 형태소 분석기 Kiwi. 분석기는 두 가지 중 하나:
 *
 *   운영: KIWI_URL 이 있으면 따로 띄운 판정 서비스(kiwi/app.py · 네이티브 kiwipiepy, 메모리 약 330MB)를 부름.
 *         판정기가 메모리 초과로 죽어도 이 서버는 안 죽음 (docker-compose 의 kiwi 서비스).
 *   개발: 없으면 npm kiwi-nlp(wasm)를 이 프로세스 안에 올림 — 파이썬 없이 바로 돌려 보려고.
 *         모델 파일(약 110MB)은 `npm run kiwi:model` 이 server/.kiwi/ 에 받아 둠. 처음 판정 때 올림(약 2초 · 메모리 약 680MB).
 *         wasm 판은 압축 모델을 못 써서 점수가 운영과 조금 다름 (등급 기준선은 거의 같음 — 2026-11-01 비교).
 *
 * 문장 판정 규칙(문장인지 · 말맛 · 점수)은 둘 다 여기서 같은 코드로.
 */

/** kiwi-nlp 버전과 같은 모델 (scripts/kiwi-model.mjs 가 받는 것) */
export const KIWI_MODEL_DIR = resolve(process.env.KIWI_MODEL_DIR || ".kiwi/models/cong/base");
const KIWI_URL = process.env.KIWI_URL?.replace(/\/+$/, "") || "";

/** 사전에 없는 요즘 말 · 욕 (없으면 분석기가 모르는 명사로 취급해서 문장이 안 됨). 판정 서비스(kiwi/app.py)와 같은 파일 */
const SLANG = (SLANG_LIST as [string, string][]).map(([word, tag]) => ({ word, tag }));

/** 분석 한 건: 점수 + 형태소들 (k = 사전에 있는 말) */
interface Analysis {
  score: number;
  tokens: Morph[];
}
interface Engine {
  analyze(texts: string[]): Promise<Analysis[]>;
  /** 띄어쓰기 고치기 (붙여 쓴 글자를 어절로 나눔) */
  space(texts: string[]): Promise<string[]>;
}

/** 판정기를 쓸 수 없을 때 (모델 없음 · 판정 서비스가 꺼짐) — http 쪽에서 503 으로 */
export class JudgeOffError extends Error {
  code = "JUDGE_OFF";
}

export const judgeReady = () => !!KIWI_URL || existsSync(join(KIWI_MODEL_DIR, "cong.mdl"));

// ── 운영: 판정 서비스 ──
async function call<T>(path: string, texts: string[]): Promise<T[]> {
  if (!texts.length) return [];
  let res: Response;
  try {
    res = await fetch(`${KIWI_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new JudgeOffError(`판정 서비스에 연결할 수 없음: ${(e as Error).message}`);
  }
  if (!res.ok) throw new JudgeOffError(`판정 서비스 ${res.status}`);
  return ((await res.json()) as { results: T[] }).results;
}
const remote: Engine = {
  analyze: async (texts) =>
    (await call<{ score: number; tokens: [string, string, boolean][] }>("/analyze", texts)).map((r) => ({
      score: r.score,
      tokens: r.tokens.map(([f, t, k]) => ({ f, t, k: k && t !== "UN" })),
    })),
  space: (texts) => call<string>("/space", texts),
};

// ── 개발: wasm ──
type Wasm = {
  analyze(s: string): { score: number; tokens: { str: string; tag: string; senseId: number }[] };
  space(s: string, resetWhitespace?: boolean): string;
};
let wasm: Promise<Wasm> | null = null;
function loadWasm(): Promise<Wasm> {
  if (!judgeReady()) return Promise.reject(new JudgeOffError("모델 없음 (npm run kiwi:model)"));
  wasm ??= (async () => {
    const t0 = Date.now();
    const { KiwiBuilder } = await import("kiwi-nlp");
    const file = createRequire(import.meta.url).resolve("kiwi-nlp/dist/kiwi-wasm.wasm");
    const builder = await KiwiBuilder.create(file);
    const modelFiles: Record<string, Uint8Array> = {};
    for (const f of readdirSync(KIWI_MODEL_DIR)) {
      if (f === "multi.dict" || f === "typo.dict") continue; // 여러 낱말 표현 · 오타 사전은 안 씀 (메모리 절약)
      modelFiles[f] = readFileSync(join(KIWI_MODEL_DIR, f));
    }
    const k = (await builder.build({
      modelFiles,
      modelType: "cong",
      loadMultiDict: false,
      loadTypoDict: false,
      userWords: SLANG,
    })) as unknown as Wasm;
    console.log(`[hangul] 판정기(wasm) 준비 ${Date.now() - t0}ms`);
    return k;
  })().catch((e) => {
    wasm = null;
    throw e;
  });
  return wasm;
}
const local: Engine = {
  analyze: async (texts) => {
    const k = await loadWasm();
    return texts.map((s) => {
      const r = k.analyze(s);
      // Kiwi 는 모르는 말을 명사로 추측하고 senseId 255 를 붙임
      return { score: r.score, tokens: r.tokens.map((t) => ({ f: t.str, t: t.tag, k: t.senseId !== 255 && t.tag !== "UN" })) };
    });
  },
  space: async (texts) => {
    const k = await loadWasm();
    return texts.map((s) => k.space(s));
  },
};

const engine = (): Engine => (KIWI_URL ? remote : local);

/**
 * 문장의 끝: 종결어미(~다 · ~요 · ~네) 말고도
 *   부르는 말 — 호격조사(철수야 · 민수야)나 "~님"(선생님 · 부장님) 으로 끝남
 *   감탄사만으로 된 말 (여보세요 · 아이고)
 */
function endsSentence(m: Morph[]) {
  const last = m[m.length - 1];
  if (!last) return false;
  if (last.t === "EF" || last.t === "JKV") return m.length >= 2;
  if (last.t === "XSN" && last.f === "님") return m.length >= 2 && /^(NN|NP)/.test(m[m.length - 2].t);
  // 감탄사만: 세 글자 이상 (아아 · 으아 같은 두 글자 감탄사가 추천을 다 채우지 않게)
  return m.every((x) => x.t === "IC") && m.map((x) => x.f).join("").length >= 3;
}

/**
 * 문장으로 읽기: 끝에 마침표를 붙여 분석한 결과(`${text}.`)로 — 마침표가 있으면 문장 끝 "다"를 연결어미 대신 종결어미로 읽음.
 * 문장 = 두 글자 이상 · 모르는 말 없음 · 문장의 끝(endsSentence) · 말맛이 외계어 아님
 */
function readSentence(r: Analysis, text: string) {
  const morphs = r.tokens.filter((t) => t.t !== "SF");
  let nat = Math.round((r.score / Math.max(1, hangulLen(text))) * 100) / 100;
  // 부르는 말(~님 · ~야)은 사전에 없는 이름을 이상하게 쪼개서(건모님 → 건/모/님) 말맛이 낮게 나옴 → 최소 "억지"로 쳐 줌
  // (모르는 말이 섞이면 어차피 아래에서 걸러짐)
  const last = morphs[morphs.length - 1];
  if (last && (last.t === "JKV" || (last.t === "XSN" && last.f === "님"))) nat = Math.max(nat, GRADES[GRADES.length - 1].min);
  const sentence = hangulLen(text) >= 2 && morphs.every((m) => m.k) && endsSentence(morphs) && !!gradeOf(nat);
  return { morphs, nat, sentence, points: sentence ? sentencePoints(text, morphs, nat) : 0 };
}

const WORD_KIND: [RegExp, string][] = [
  [/^NP/, "대명사"],
  [/^NR/, "수사"],
  [/^(NN|XR)/, "명사"],
  [/^VV/, "동사"],
  [/^VA/, "형용사"],
  [/^MA/, "부사"],
  [/^MM/, "관형사"],
  [/^IC/, "감탄사"],
];
/** 낱말로 읽기 (마침표 없이 분석한 결과): 뜻 있는 말이 딱 하나면 그 품사 (뒤에 조사 · 어미는 붙어도 됨) */
function readWord(r: Analysis): { kind: string; tag: string } | null {
  const content = r.tokens.filter((m) => isContent(m.t));
  if (!r.tokens.every((m) => m.k) || content.length !== 1) return null;
  const kind = WORD_KIND.find(([re]) => re.test(content[0].t))?.[1];
  return kind ? { kind, tag: content[0].t } : null;
}

/**
 * 뭐 되지? — 문장칸(line) 뒤에 가진 글자 · 낱말(units)을 몇 개 이어 붙이면 문장이나 낱말이 되는 것 찾기.
 * 순서까지 다 해 봄 (문장칸이 비었으면 최대 3개, 있으면 2개, 최대 2000가지) — 단계마다 한꺼번에 분석기에 보냄.
 */
export interface Suggestion {
  /** 이어 붙일 units 의 번호 (순서대로) */
  add: number[];
  text: string;
  sentence: boolean;
  /** 낱말이면 품사 */
  word: string | null;
  points: number;
  /** 고유명사(인명 · 지명 · 상표 — "루드" "오드" 같은 것). 자동 낱말 만들기는 건너뜀 */
  rare?: boolean;
}
const suggestCache = new Map<string, Suggestion[]>();
export async function suggest(line: string, units: string[]): Promise<Suggestion[]> {
  const key = `${line}|${units.join(",")}`;
  const hit = suggestCache.get(key);
  if (hit) return hit;
  const k = engine();
  const found: Suggestion[] = [];
  const seen = new Set<string>();
  const maxAdd = line ? 2 : 3;
  let budget = 2000;
  // 짧은 것부터 (한 개 → 두 개 → 세 개), 정해진 횟수까지만
  let level: [number[], string][] = [[[], ""]];
  for (let d = 1; d <= maxAdd && budget > 0; d++) {
    const next: [number[], string][] = [];
    const cands: { seq: number[]; text: string }[] = [];
    for (const [seq, tail] of level)
      for (let i = 0; i < units.length && budget > 0; i++) {
        if (seq.includes(i)) continue;
        const s2 = [...seq, i], t2 = tail + units[i];
        next.push([s2, t2]);
        const text = line + t2;
        if (seen.has(text) || !isLine(text)) continue;
        seen.add(text);
        budget--;
        cands.push({ seq: s2, text });
      }
    level = next;
    // 문장으로 읽기 → 문장이 아닌 것 중 (문장칸이 비었고 두 개 이상 붙인 것만) 낱말로 읽기
    const rs = await k.analyze(cands.map((c) => `${coreOf(c.text)}.`));
    const notSent: typeof cands = [];
    cands.forEach((c, j) => {
      const s = readSentence(rs[j], coreOf(c.text));
      if (s.sentence) found.push({ add: c.seq, text: c.text, sentence: true, word: null, points: s.points });
      else if (!line && c.seq.length >= 2) notSent.push(c);
    });
    const ws = await k.analyze(notSent.map((c) => c.text));
    notSent.forEach((c, j) => {
      const w = readWord(ws[j]);
      if (w) found.push({ add: c.seq, text: c.text, sentence: false, word: w.kind, points: 0, ...(w.tag === "NNP" && { rare: true }) });
    });
  }
  // 문장은 점수 높은 순 6개, 낱말은 긴 순으로 나머지 (고유명사 — 사전의 인명 · 지명 · 상표 등은 뒤로)
  const sents = found.filter((f) => f.sentence).sort((a, b) => b.points - a.points).slice(0, 6);
  const words = found
    .filter((f) => !f.sentence)
    .sort((a, b) => Number(!!a.rare) - Number(!!b.rare) || b.text.length - a.text.length);
  const out = [...sents, ...words].slice(0, 12);
  if (suggestCache.size > 500) suggestCache.clear();
  suggestCache.set(key, out);
  return out;
}

/**
 * 원고지 한 줄 판정. text 는 isLine 을 통과한 것만 (한글 + 사용자가 넣은 , ? ! .)
 * 문장 · 점수는 한글만 읽고(부호는 빼고), 띄어쓰기는 부호까지 넣어서 고침
 */
export async function judge(text: string): Promise<Judge> {
  if (!isLine(text)) throw new Error("bad line");
  const k = engine();
  const core = coreOf(text);
  // 낱말: 부호 없이, 마침표도 없이 읽어서 뜻 있는 말이 딱 하나
  const asWord = core === text;
  const [rs, [spaced]] = await Promise.all([k.analyze(asWord ? [`${core}.`, core] : [`${core}.`]), k.space([text])]);
  const { morphs, nat, sentence, points } = readSentence(rs[0], core);
  const word = asWord ? (readWord(rs[1])?.kind ?? null) : null;
  return { text, morphs, sentence, word, points, nat, spaced };
}
