import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { gradeOf, hangulLen, isContent, LINE_RE, sentencePoints, type Judge, type Morph } from "../../../web/src/lib/hangul/judge";

/*
 * 니들이 한글을 알아? 판정기 — 한국어 형태소 분석기 Kiwi (npm kiwi-nlp, wasm) 를 서버에서 돌림.
 *
 * 모델 파일(약 110MB)은 레포에 안 넣음: `npm run kiwi:model` 이 server/.kiwi/ 에 받아 둠 (KIWI_MODEL_DIR 로 바꿀 수 있음).
 * 모델이 없으면 판정기는 꺼진 채로 서버는 그대로 뜸 (게임 화면이 "판정 서버 없음"을 띄움).
 * 처음 판정 요청이 올 때 올림(약 2초 · 메모리 약 800MB) — 이 게임을 안 하면 메모리를 안 씀.
 */

/** kiwi-nlp 버전과 같은 모델 (scripts/kiwi-model.mjs 가 받는 것) */
export const KIWI_MODEL_DIR = resolve(process.env.KIWI_MODEL_DIR || ".kiwi/models/cong/base");

/** 사전에 없는 요즘 말 · 욕 (없으면 분석기가 모르는 명사로 취급해서 문장이 안 됨) */
const SLANG: { word: string; tag: string }[] = [
  ["개빡치", "VV"], ["빡치", "VV"], ["킹받", "VV"], ["개웃기", "VA"], ["개좋", "VA"], ["개싫", "VA"],
  ["존맛", "NNG"], ["개꿀", "NNG"], ["꿀잼", "NNG"], ["노잼", "NNG"], ["핵노잼", "NNG"], ["갓생", "NNG"],
  ["현타", "NNG"], ["멘붕", "NNG"], ["뇌절", "NNG"], ["개쩔", "VA"], ["쩔", "VA"],
  ["존잘", "NNG"], ["존예", "NNG"], ["썸", "NNG"], ["눈팅", "NNG"], ["버카충", "NNG"], ["갑분싸", "NNG"],
  ["졸귀", "NNG"], ["개이득", "NNG"], ["이불킥", "NNG"], ["월급루팡", "NNG"],
].map(([word, tag]) => ({ word, tag }));

type Kiwi = { analyze(s: string): { score: number; tokens: { str: string; tag: string; senseId: number }[] } };
let kiwi: Promise<Kiwi> | null = null;

export const judgeReady = () => existsSync(join(KIWI_MODEL_DIR, "cong.mdl"));

function load(): Promise<Kiwi> {
  kiwi ??= (async () => {
    const t0 = Date.now();
    const { KiwiBuilder } = await import("kiwi-nlp");
    const wasm = createRequire(import.meta.url).resolve("kiwi-nlp/dist/kiwi-wasm.wasm");
    const builder = await KiwiBuilder.create(wasm);
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
    })) as unknown as Kiwi;
    console.log(`[hangul] 판정기 준비 ${Date.now() - t0}ms`);
    return k;
  })().catch((e) => {
    kiwi = null;
    throw e;
  });
  return kiwi;
}

/** Kiwi 는 모르는 말을 명사로 추측하고 senseId 255 를 붙임 */
const toMorph = (t: { str: string; tag: string; senseId: number }): Morph => ({
  f: t.str,
  t: t.tag,
  k: t.senseId !== 255 && t.tag !== "UN",
});

/**
 * 문장으로 읽기: 끝에 마침표를 붙이면 문장 끝 "다"를 연결어미 대신 종결어미로 읽음.
 * 문장 = 두 글자 이상 · 모르는 말 없음 · 종결어미로 끝남 · 말맛이 외계어 아님
 */
function readSentence(k: Kiwi, text: string) {
  const r = k.analyze(`${text}.`);
  const morphs = r.tokens.filter((t) => t.tag !== "SF").map(toMorph);
  const nat = Math.round((r.score / Math.max(1, hangulLen(text))) * 100) / 100;
  const sentence =
    hangulLen(text) >= 2 &&
    morphs.length >= 2 &&
    morphs.every((m) => m.k) &&
    morphs[morphs.length - 1].t === "EF" &&
    !!gradeOf(nat);
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

/**
 * 뭐 되지? — 문장칸(line) 뒤에 가진 글자 · 낱말(units)을 몇 개 이어 붙이면 문장이나 낱말이 되는 것 찾기.
 * 순서까지 다 해 봄 (문장칸이 비었으면 최대 3개, 있으면 2개) — 글자 10개면 약 800가지, 0.5초 안팎.
 */
export interface Suggestion {
  /** 이어 붙일 units 의 번호 (순서대로) */
  add: number[];
  text: string;
  sentence: boolean;
  /** 낱말이면 품사 */
  word: string | null;
  points: number;
}
const suggestCache = new Map<string, Suggestion[]>();
export async function suggest(line: string, units: string[]): Promise<Suggestion[]> {
  const key = `${line}|${units.join(",")}`;
  const hit = suggestCache.get(key);
  if (hit) return hit;
  const k = await load();
  const found: Suggestion[] = [];
  const seen = new Set<string>();
  /** 고유명사(사전의 인명 · 지명 · 상표 등 — "루드" "오드" 같은 것)는 낱말 추천에서 뒤로 */
  const rare = new Set<string>();
  const maxAdd = line ? 2 : 3;
  let budget = 2000;
  const check = (seq: number[], tail: string) => {
    const text = line + tail;
    if (seen.has(text) || !LINE_RE.test(text)) return;
    seen.add(text);
    budget--;
    const s = readSentence(k, text);
    if (s.sentence) found.push({ add: seq, text, sentence: true, word: null, points: s.points });
    else if (!line && seq.length >= 2) {
      const w = k.analyze(text).tokens.map(toMorph);
      const c = w.filter((m) => isContent(m.t));
      if (w.every((m) => m.k) && c.length === 1) {
        const kind = WORD_KIND.find(([re]) => re.test(c[0].t))?.[1];
        if (kind) {
          found.push({ add: seq, text, sentence: false, word: kind, points: 0 });
          if (c[0].t === "NNP") rare.add(text);
        }
      }
    }
  };
  // 짧은 것부터 (한 개 → 두 개 → 세 개), 정해진 횟수까지만
  let level: [number[], string][] = [[[], ""]];
  for (let d = 1; d <= maxAdd && budget > 0; d++) {
    const next: [number[], string][] = [];
    for (const [seq, tail] of level)
      for (let i = 0; i < units.length && budget > 0; i++) {
        if (seq.includes(i)) continue;
        const s2 = [...seq, i], t2 = tail + units[i];
        next.push([s2, t2]);
        check(s2, t2);
      }
    level = next;
  }
  // 문장은 점수 높은 순 6개, 낱말은 긴 순으로 나머지
  const sents = found.filter((f) => f.sentence).sort((a, b) => b.points - a.points).slice(0, 6);
  const words = found
    .filter((f) => !f.sentence)
    .sort((a, b) => Number(rare.has(a.text)) - Number(rare.has(b.text)) || b.text.length - a.text.length);
  const out = [...sents, ...words].slice(0, 12);
  if (suggestCache.size > 500) suggestCache.clear();
  suggestCache.set(key, out);
  return out;
}

/** 글자 줄 판정. text 는 LINE_RE 를 통과한 것만 */
export async function judge(text: string): Promise<Judge> {
  if (!LINE_RE.test(text)) throw new Error("bad line");
  const k = await load();
  const { morphs, nat, sentence, points } = readSentence(k, text);
  // 낱말: 마침표 없이 읽어서 뜻 있는 말이 딱 하나 (뒤에 조사 · 어미는 붙어도 됨)
  const w = k.analyze(text).tokens.map(toMorph);
  const content = w.filter((m) => isContent(m.t));
  const word =
    w.every((m) => m.k) && content.length === 1
      ? (WORD_KIND.find(([re]) => re.test(content[0].t))?.[1] ?? null)
      : null;
  return { text, morphs, sentence, word, points, nat };
}
