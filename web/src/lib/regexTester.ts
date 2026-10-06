// 정규식 테스터 로직 — 화면(RegexTool)과 Web Worker가 같이 씀.
// runRegex는 Worker 안에서 toString()으로 다시 만들어 실행되므로
// 바깥 변수·import를 참조하지 않는 자기완결 함수여야 함.

export interface RegexMatch {
  index: number;
  end: number;
  text: string;
  /** 번호 그룹 ($1, $2 …). 매칭 안 된 그룹은 null */
  groups: (string | null)[];
  /** 이름 그룹 (?<name>…) */
  named: Record<string, string | null>;
}

export interface RegexResult {
  error: string | null;
  matches: RegexMatch[];
  /** 매칭이 너무 많아 일부만 담았는지 */
  truncated: boolean;
  /** 치환 결과 (replacement가 null이면 null) */
  replaced: string | null;
}

export const MAX_MATCHES = 1000;

export function runRegex(
  pattern: string,
  flags: string,
  text: string,
  replacement: string | null
): RegexResult {
  const LIMIT = 1000;
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (e) {
    return { error: (e as Error).message, matches: [], truncated: false, replaced: null };
  }
  const matches: RegexMatch[] = [];
  let truncated = false;
  const toMatch = (m: RegExpExecArray) => ({
    index: m.index,
    end: m.index + m[0].length,
    text: m[0],
    groups: m.slice(1).map((g) => (g === undefined ? null : g)),
    named: m.groups
      ? Object.fromEntries(
          Object.entries(m.groups).map(([k, v]) => [k, v === undefined ? null : v])
        )
      : {},
  });

  if (pattern !== "") {
    if (re.global || re.sticky) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (matches.length >= LIMIT) {
          truncated = true;
          break;
        }
        matches.push(toMatch(m));
        // 빈 문자열 매칭에서 무한 루프 방지 (u 플래그면 코드포인트 단위로 전진)
        if (m[0] === "") {
          const cp = text.codePointAt(re.lastIndex);
          re.lastIndex += re.unicode && cp !== undefined && cp > 0xffff ? 2 : 1;
        }
        if (!re.global) break; // sticky만 있으면 한 번
      }
    } else {
      const m = re.exec(text);
      if (m) matches.push(toMatch(m));
    }
  }

  let replaced: string | null = null;
  if (replacement !== null) {
    try {
      replaced = pattern === "" ? text : text.replace(re, replacement);
    } catch (e) {
      return { error: (e as Error).message, matches, truncated, replaced: null };
    }
  }
  return { error: null, matches, truncated, replaced };
}

// ───────────── Java 변환 ─────────────

/** 정규식 → Java 문자열 리터럴 내용 (\ → \\, " → \") */
export function toJavaLiteral(pattern: string): string {
  return pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Java 문자열 리터럴 내용 → 정규식 ("\\d+" → \d+). 앞뒤 따옴표가 있으면 벗김 */
export function fromJavaLiteral(literal: string): string {
  let s = literal.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) => {
    if (c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
    return (
      (
        { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "'": "'", "\\": "\\" } as Record<
          string,
          string
        >
      )[c] ?? "\\" + c
    );
  });
}

const JAVA_FLAGS: Record<string, string> = {
  i: "Pattern.CASE_INSENSITIVE",
  m: "Pattern.MULTILINE",
  s: "Pattern.DOTALL",
  u: "Pattern.UNICODE_CASE",
};

/** Pattern.compile(...) + find 루프 코드 */
export function toJavaCode(pattern: string, flags: string, replacement: string | null): string {
  const f = [...flags].map((c) => JAVA_FLAGS[c]).filter(Boolean);
  const lit = toJavaLiteral(pattern);
  const lines = [
    `Pattern pattern = Pattern.compile("${lit}"${f.length ? `, ${f.join(" | ")}` : ""});`,
    `Matcher matcher = pattern.matcher(text);`,
  ];
  if (replacement !== null) {
    // JS $<name> → Java ${name}
    const rep = toJavaLiteral(replacement.replace(/\$<([A-Za-z_][\w]*)>/g, "${$1}"));
    lines.push(
      flags.includes("g")
        ? `String result = matcher.replaceAll("${rep}");`
        : `String result = matcher.replaceFirst("${rep}");`
    );
  } else if (flags.includes("g")) {
    lines.push(`while (matcher.find()) {`, `    String found = matcher.group();`, `}`);
  } else {
    lines.push(`if (matcher.find()) {`, `    String found = matcher.group();`, `}`);
  }
  return lines.join("\n");
}

/** 입력한 글자를 그대로 찾는 정규식으로 (특수문자 이스케이프) */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** 캡처 그룹 순서대로 이름(없으면 null) — 매칭 목록에서 $1<name> 표시용 */
export function groupNames(pattern: string): (string | null)[] {
  const names: (string | null)[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      i++; // 이스케이프된 다음 글자 건너뜀
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
      continue;
    }
    if (c !== "(") continue;
    if (pattern[i + 1] !== "?") {
      names.push(null);
      continue;
    }
    // (?<name> 는 이름 그룹, (?<= (?<! (?: (?= (?! 는 캡처 아님
    const m = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(pattern.slice(i));
    if (m) names.push(m[1]);
  }
  return names;
}
