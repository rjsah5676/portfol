// 검증 테스트용 정규식 분석 — 붙여넣은 정규식을 풀어서
// "어떤 문자가 허용되는지 / 입력값의 어느 글자가 왜 걸렸는지"를 설명하는 데 씀.
import { fromJavaLiteral } from "@/lib/regexTester";

export interface ParsedRegex {
  source: string;
  flags: string;
  /** literal: /…/flags, java: "…" (Java 문자열), raw: 본문만 */
  kind: "literal" | "java" | "raw";
}

/** /…/gi · "…"(Java) · 본문만 — 어떤 형태로 붙여넣어도 정규식 본문과 플래그로 */
export function parseRegexInput(input: string, rawFlags: string): ParsedRegex {
  const s = input.trim();
  const lit = /^\/([\s\S]+)\/([dgimsuvy]*)$/.exec(s);
  if (lit) return { source: lit[1], flags: lit[2], kind: "literal" };
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"'))
    return { source: fromJavaLiteral(s), flags: rawFlags, kind: "java" };
  return { source: s, flags: rawFlags, kind: "raw" };
}

/** 검사용 플래그 — g/y는 test()가 lastIndex를 기억해서 결과가 번갈아 바뀌므로 뺌 */
export const testFlags = (flags: string) => flags.replace(/[gy]/g, "");

// ───────────── 구조 파싱 ─────────────

/** i가 '[' 일 때 짝이 되는 ']' 다음 위치 (없으면 -1) */
function readClass(src: string, i: number): number {
  let j = i + 1;
  if (src[j] === "^") j++;
  for (; j < src.length; j++) {
    if (src[j] === "\\") j++;
    else if (src[j] === "]") return j + 1;
  }
  return -1;
}

/** i가 '(' 일 때 짝이 되는 ')' 다음 위치 (없으면 -1) */
function readGroup(src: string, i: number): number {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === "[") {
      const e = readClass(src, j);
      if (e < 0) return -1;
      j = e - 1;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return j + 1;
  }
  return -1;
}

function readQuantifier(q: string): { min: number; max: number | null } | null {
  if (q === "") return { min: 1, max: 1 };
  if (q === "*") return { min: 0, max: null };
  if (q === "+") return { min: 1, max: null };
  if (q === "?") return { min: 0, max: 1 };
  const m = /^\{(\d+)(,(\d*))?\}$/.exec(q);
  if (!m) return null;
  const min = Number(m[1]);
  return { min, max: m[2] === undefined ? min : m[3] === "" ? null : Number(m[3]) };
}

export interface Lookahead {
  src: string;
  negative: boolean;
}

export interface RegexShape {
  anchoredStart: boolean;
  anchoredEnd: boolean;
  /** ^ 바로 뒤에 붙은 (?=…) (?!…) 조건들 */
  lookaheads: Lookahead[];
  /** 본체가 [문자집합]수량자 한 덩어리면 그 정보 (허용 문자 목록형 정규식) */
  charset: { body: string; negated: boolean; min: number; max: number | null } | null;
}

export function shapeOf(src: string): RegexShape {
  let i = 0;
  const anchoredStart = src[0] === "^";
  if (anchoredStart) i = 1;
  const lookaheads: Lookahead[] = [];
  while (src.startsWith("(?=", i) || src.startsWith("(?!", i)) {
    const end = readGroup(src, i);
    if (end < 0) break;
    lookaheads.push({ src: src.slice(i, end), negative: src[i + 2] === "!" });
    i = end;
  }
  // 끝의 $ (\$ 는 글자 $ 이므로 제외 — 앞 역슬래시 개수가 짝수일 때만 앵커)
  let anchoredEnd = false;
  if (src.endsWith("$")) {
    let bs = 0;
    for (let k = src.length - 2; k >= 0 && src[k] === "\\"; k--) bs++;
    anchoredEnd = bs % 2 === 0;
  }
  const rest = src.slice(i, anchoredEnd ? -1 : undefined);

  let charset: RegexShape["charset"] = null;
  if (rest[0] === "[") {
    const end = readClass(rest, 0);
    const q = end > 0 ? readQuantifier(rest.slice(end)) : null;
    if (q) {
      const negated = rest[1] === "^";
      charset = { body: rest.slice(negated ? 2 : 1, end - 1), negated, ...q };
    }
  } else {
    const m = /^(\\[dDwWsS]|\\p\{[^}]+\})(.*)$/.exec(rest);
    const q = m ? readQuantifier(m[2]) : null;
    if (m && q) charset = { body: m[1], negated: false, ...q };
  }
  return { anchoredStart, anchoredEnd, lookaheads, charset };
}

// ───────────── 문자 집합 설명 ─────────────

export type ClassItem =
  | { kind: "range"; from: number; to: number; label: string | null }
  | { kind: "char"; cp: number }
  | { kind: "shorthand"; raw: string; label: string };

const KNOWN_RANGES: [number, number, string][] = [
  [0x61, 0x7a, "영문 소문자 a–z"],
  [0x41, 0x5a, "영문 대문자 A–Z"],
  [0x30, 0x39, "숫자 0–9"],
  [0xac00, 0xd7a3, "한글 완성형 가–힣 (11,172자)"],
  [0x3130, 0x318f, "한글 호환 자모 ㄱ–ㆎ (키보드로 치는 낱자 ㄱ ㅏ 등)"],
  [0x3131, 0x3163, "한글 낱자 ㄱ–ㅣ"],
  [0x3131, 0x314e, "한글 자음 ㄱ–ㅎ"],
  [0x314f, 0x3163, "한글 모음 ㅏ–ㅣ"],
  [0x1100, 0x11ff, "한글 조합형 자모 (맥 파일명 같은 NFD 한글)"],
  [0x4e00, 0x9fff, "한자 (CJK 통합)"],
  [0x3040, 0x309f, "히라가나"],
  [0x30a0, 0x30ff, "가타카나"],
];

const SHORTHAND: Record<string, string> = {
  "\\d": "숫자 0–9",
  "\\D": "숫자가 아닌 모든 문자",
  "\\w": "영문·숫자·밑줄(_)",
  "\\W": "영문·숫자·_가 아닌 모든 문자",
  "\\s": "공백류 (스페이스·탭·줄바꿈)",
  "\\S": "공백이 아닌 모든 문자",
};

const CONTROL: Record<string, number> = { n: 10, t: 9, r: 13, f: 12, v: 11, b: 8, "0": 0 };

/** 클래스 안 원자 하나 읽기 → [코드포인트 | 축약형, 다음 위치] */
function readAtom(body: string, i: number): [number | string, number] {
  if (body[i] !== "\\") {
    const cp = body.codePointAt(i)!;
    return [cp, i + (cp > 0xffff ? 2 : 1)];
  }
  const c = body[i + 1];
  if (c === undefined) return [0x5c, i + 1];
  if (c === "u") {
    if (body[i + 2] === "{") {
      const end = body.indexOf("}", i + 3);
      if (end > 0) return [parseInt(body.slice(i + 3, end), 16), end + 1];
    }
    const hex = body.slice(i + 2, i + 6);
    if (/^[0-9a-fA-F]{4}$/.test(hex)) return [parseInt(hex, 16), i + 6];
    return [0x75, i + 2];
  }
  if (c === "x") {
    const hex = body.slice(i + 2, i + 4);
    if (/^[0-9a-fA-F]{2}$/.test(hex)) return [parseInt(hex, 16), i + 4];
    return [0x78, i + 2];
  }
  if ((c === "p" || c === "P") && body[i + 2] === "{") {
    const end = body.indexOf("}", i + 3);
    if (end > 0) return [body.slice(i, end + 1), end + 1];
  }
  if ("dDwWsS".includes(c)) return ["\\" + c, i + 2];
  if (c in CONTROL) return [CONTROL[c], i + 2];
  const cp = body.codePointAt(i + 1)!;
  return [cp, i + 1 + (cp > 0xffff ? 2 : 1)];
}

export function describeClass(body: string): ClassItem[] {
  const items: ClassItem[] = [];
  let i = 0;
  while (i < body.length) {
    const [a, next] = readAtom(body, i);
    i = next;
    if (typeof a === "string") {
      items.push({
        kind: "shorthand",
        raw: a,
        label: SHORTHAND[a] ?? `유니코드 속성 ${a.slice(3, -1)}${a[1] === "P" ? " 제외" : ""}`,
      });
      continue;
    }
    // a-z 같은 범위 (끝의 - 는 글자 -)
    if (body[i] === "-" && i + 1 < body.length) {
      const [b, after] = readAtom(body, i + 1);
      if (typeof b === "number") {
        i = after;
        const known = KNOWN_RANGES.find(([f, t]) => f === a && t === b);
        items.push({ kind: "range", from: a, to: b, label: known ? known[2] : null });
        continue;
      }
    }
    items.push({ kind: "char", cp: a });
  }
  return items;
}

const CHAR_NAMES: Record<number, string> = {
  0x20: "공백",
  0x09: "탭",
  0x0a: "줄바꿈",
  0x0d: "CR",
  0xa0: "줄바꿈 없는 공백(NBSP)",
  0x3000: "전각 공백",
  0x00b7: "가운뎃점",
  0x2022: "불릿",
  0x2027: "하이픈 점",
  0x200b: "폭 없는 공백",
  0xfeff: "BOM",
};

export const hex = (cp: number) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

/** 화면 표시용 글자 — 안 보이는 문자는 이름으로 */
export function showChar(cp: number): { text: string; name: string | null } {
  const name = CHAR_NAMES[cp] ?? null;
  const invisible =
    cp < 0x21 || (cp >= 0x7f && cp <= 0xa0) || cp === 0x3000 || cp === 0x200b || cp === 0xfeff;
  return { text: invisible ? `␣` : String.fromCodePoint(cp), name };
}

const SHORT: Record<string, string> = {
  "a-z": "소문자",
  "A-Z": "대문자",
  "0-9": "숫자",
  "가-힣": "한글",
  "\\d": "숫자",
  "\\w": "영문·숫자·_",
  "\\s": "공백",
};

/** (?=.*[A-Z]) 같은 흔한 조건을 사람 말로 — "대문자 1개 이상 포함" */
export function describeLookahead(la: Lookahead): string | null {
  if (la.src === "(?!.*(.)\\1\\1)") return "같은 문자 3번 연속 금지";
  const m = /^\(\?[=!]\.\*(\[[^\]]*\]|\\[dDwWsS]|.)\)$/.exec(la.src);
  if (!m) return null;
  const what = m[1];
  let label: string;
  if (what.startsWith("[")) {
    const neg = what[1] === "^";
    const parts: string[] = [];
    let singles = "";
    for (const it of describeClass(what.slice(neg ? 2 : 1, -1))) {
      if (it.kind === "char") singles += String.fromCodePoint(it.cp);
      else if (it.kind === "shorthand") parts.push(SHORT[it.raw] ?? it.label);
      else {
        const key = `${String.fromCodePoint(it.from)}-${String.fromCodePoint(it.to)}`;
        parts.push(SHORT[key] ?? key.replace("-", "–"));
      }
    }
    // 대문자+소문자 → 영문
    const ui = parts.indexOf("대문자");
    const li = parts.indexOf("소문자");
    if (ui >= 0 && li >= 0) {
      parts[Math.min(ui, li)] = "영문";
      parts.splice(Math.max(ui, li), 1);
    }
    if (singles) parts.push(/^[^\p{L}\p{N}]+$/u.test(singles) ? `특수문자(${singles})` : singles);
    label = parts.join("·");
    if (neg) label = `${label} 이외 문자`;
  } else label = SHORT[what] ?? SHORTHAND[what] ?? what.replace(/^\\/, "");
  return la.negative ? `${label} 들어가면 안 됨` : `${label} 1개 이상 포함`;
}

// ───────────── 입력값 검사 ─────────────

export interface CheckResult {
  ok: boolean;
  error: string | null;
  /** 허용 문자 목록형일 때: 글자마다 허용 여부 */
  chars: { ch: string; ok: boolean }[] | null;
  badChars: string[];
  length: number;
  lengthIssue: string | null;
  conditions: { la: Lookahead; label: string | null; ok: boolean }[];
  /** 앵커 없는 정규식이면 실제로 맞은 부분 */
  matched: { index: number; end: number } | null;
}

export interface Compiled {
  re: RegExp;
  shape: RegexShape;
  charRe: RegExp | null;
  laRes: RegExp[];
  unicode: boolean;
}

export function compile(source: string, flags: string): Compiled | { error: string } {
  const f = testFlags(flags);
  try {
    const re = new RegExp(source, f);
    const shape = shapeOf(source);
    const cs = shape.charset;
    let charRe: RegExp | null = null;
    if (cs && shape.anchoredStart && shape.anchoredEnd) {
      try {
        charRe = new RegExp(`^[${cs.negated ? "^" : ""}${cs.body}]$`, f);
      } catch {
        charRe = null;
      }
    }
    const laRes = shape.anchoredStart
      ? shape.lookaheads.map((la) => new RegExp("^" + la.src, f))
      : [];
    return { re, shape, charRe, laRes, unicode: /[uv]/.test(f) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export function check(c: Compiled, value: string): CheckResult {
  const ok = c.re.test(value);
  // 화면은 글자(코드포인트) 단위, 길이는 정규식이 세는 방식대로 (u 없으면 UTF-16 단위)
  const units = Array.from(value);
  const length = c.unicode ? units.length : value.length;
  let chars: CheckResult["chars"] = null;
  const badChars: string[] = [];
  let lengthIssue: string | null = null;
  if (c.charRe) {
    chars = units.map((ch) => ({ ch, ok: c.charRe!.test(ch) }));
    for (const x of chars) if (!x.ok && !badChars.includes(x.ch)) badChars.push(x.ch);
    const { min, max } = c.shape.charset!;
    if (length < min) lengthIssue = `${min}자 이상이어야 함 (지금 ${length}자)`;
    else if (max !== null && length > max) lengthIssue = `${max}자 이하여야 함 (지금 ${length}자)`;
  }
  const conditions = c.shape.lookaheads.map((la, i) => ({
    la,
    label: describeLookahead(la),
    ok: c.laRes[i] ? c.laRes[i].test(value) : true,
  }));
  let matched: CheckResult["matched"] = null;
  if (ok && !(c.shape.anchoredStart && c.shape.anchoredEnd)) {
    const m = c.re.exec(value);
    if (m) matched = { index: m.index, end: m.index + m[0].length };
  }
  return { ok, error: null, chars, badChars, length, lengthIssue, conditions, matched };
}

/** 허용 안 되는 글자를 지우는 정규식 (입력 필터용) */
export function filterRegexOf(shape: RegexShape, flags: string): string | null {
  const cs = shape.charset;
  if (!cs || !shape.anchoredStart || !shape.anchoredEnd) return null;
  const f = testFlags(flags) + "g";
  // \d 같은 축약형은 \D 로 뒤집기
  if (!cs.negated && /^\\[dws]$/.test(cs.body)) return `/${cs.body.toUpperCase()}/${f}`;
  if (!cs.negated && /^\\[DWS]$/.test(cs.body)) return `/${cs.body.toLowerCase()}/${f}`;
  return `/[${cs.negated ? "" : "^"}${cs.body}]/${f}`;
}
