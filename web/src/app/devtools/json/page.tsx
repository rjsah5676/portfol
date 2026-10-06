"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Faded from "@/components/Faded";

type Indent = "2" | "4" | "tab";
type Mode = "pretty" | "minify";

const STORAGE_KEY = "devtools_json_input";

const SAMPLE = `{"name":"Gunmo's Dev Life","owner":{"name":"이건모","role":"fullstack"},"stack":["Next.js","TypeScript","Spring Boot"],"games":4,"open":true,"lastDeploy":null}`;

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortDeep((v as Record<string, unknown>)[k])])
    );
  }
  return v;
}

/**
 * 첫 문법 오류 위치(문자 인덱스) 찾기.
 * JSON.parse 에러 메시지는 브라우저마다 달라서(최신 Chrome은 위치를 안 알려줌)
 * 직접 한 번 훑어서 위치를 구한다. 정상 JSON이면 -1.
 */
function findErrorIndex(s: string): number {
  let i = 0;
  const ws = () => {
    while (i < s.length && " \t\n\r".includes(s[i])) i++;
  };
  const fail = (): never => {
    throw i;
  };
  const str = () => {
    i++; // "
    while (i < s.length && s[i] !== '"') {
      if (s[i] === "\\") {
        i++;
        if (s[i] === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i + 1, i + 5))) fail();
          i += 4;
        } else if (!'"\\/bfnrt'.includes(s[i] ?? "")) fail();
      } else if (s.charCodeAt(i) < 0x20) fail();
      i++;
    }
    if (s[i] !== '"') fail();
    i++;
  };
  const value = (): void => {
    ws();
    const c = s[i];
    if (c === "{") {
      i++;
      ws();
      if (s[i] === "}") return void i++;
      for (;;) {
        ws();
        if (s[i] !== '"') fail();
        str();
        ws();
        if (s[i] !== ":") fail();
        i++;
        value();
        ws();
        if (s[i] === ",") i++;
        else if (s[i] === "}") return void i++;
        else fail();
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (s[i] === "]") return void i++;
      for (;;) {
        value();
        ws();
        if (s[i] === ",") i++;
        else if (s[i] === "]") return void i++;
        else fail();
      }
    }
    if (c === '"') return str();
    const lit = /^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)/.exec(s.slice(i));
    if (!lit) fail();
    i += lit![0].length;
  };
  try {
    value();
    ws();
    return i < s.length ? i : -1;
  } catch (at) {
    return at as number;
  }
}

function locate(src: string): { line: number; col: number; lineText: string } | null {
  const idx = findErrorIndex(src);
  if (idx < 0) return null;
  const before = src.slice(0, idx).split("\n");
  const line = before.length;
  return { line, col: before[line - 1].length + 1, lineText: src.split("\n")[line - 1] ?? "" };
}

const bytes = (s: string) => new TextEncoder().encode(s).length;
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

/** 정렬된 JSON 문자열을 색 입힌 조각으로 */
function highlight(json: string): ReactNode[] {
  const re =
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json))) {
    if (m.index > last) out.push(json.slice(last, m.index));
    const t = m[0];
    const cls = m[2]
      ? "text-[#A9A3FF]" // key
      : t.startsWith('"')
        ? "text-emerald-300"
        : t === "true" || t === "false"
          ? "text-amber-300"
          : t === "null"
            ? "text-white/40"
            : "text-sky-300";
    out.push(
      <span key={m.index} className={cls}>
        {t}
      </span>
    );
    last = m.index + t.length;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
}

export default function JsonFormatterPage() {
  const [input, setInput] = useState("");
  const [indent, setIndent] = useState<Indent>("2");
  const [mode, setMode] = useState<Mode>("pretty");
  const [sortKeys, setSortKeys] = useState(false);
  const [copied, setCopied] = useState(false);

  // 마지막 입력 복원 (새로고침해도 유지)
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 입력 복원(마운트 1회)
      if (saved) setInput(saved);
    } catch {}
    // 저장된 값을 불러온 뒤부터 저장 (개발 모드에서 effect가 두 번 돌 때 기본값이 덮어쓰는 것 방지)
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (input.length < 500_000) localStorage.setItem(STORAGE_KEY, input);
    } catch {}
  }, [hydrated, input]);

  const result = useMemo(() => {
    if (!input.trim()) return { ok: true as const, text: "" };
    try {
      let value: unknown = JSON.parse(input);
      if (sortKeys) value = sortDeep(value);
      const space = mode === "minify" ? undefined : indent === "tab" ? "\t" : Number(indent);
      return { ok: true as const, text: JSON.stringify(value, null, space) };
    } catch (e) {
      const message = (e as Error).message;
      return { ok: false as const, message, at: locate(input) };
    }
  }, [input, indent, mode, sortKeys]);

  // 16자리 이상 정수는 JS number로 바뀌면서 끝자리가 달라질 수 있음
  const bigIntWarning = /(?<![\w."])-?\d{16,}(?![\w."])/.test(input);

  const copy = async () => {
    if (!result.ok || !result.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  const seg = (active: boolean) =>
    `cursor-pointer rounded-full px-3 py-1.5 font-mono text-xs transition-colors ${
      active ? "bg-[#6C63FF] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
    }`;

  return (
    <Faded>
      <div className="mx-auto max-w-6xl px-4 pt-12 pb-24 sm:px-6">
        <div className="mb-6">
          <div className="font-mono text-sm text-[#8B84FF]">devtools</div>
          <h1 className="mt-1 font-mono text-2xl font-bold text-white">JSON Formatter</h1>
          <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-sm text-white/45">
            붙여넣으면 바로 정렬·검사합니다.
          </p>
        </div>

        {/* 옵션 */}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex gap-1">
            <button
              type="button"
              className={seg(mode === "pretty")}
              onClick={() => setMode("pretty")}
            >
              정렬
            </button>
            <button
              type="button"
              className={seg(mode === "minify")}
              onClick={() => setMode("minify")}
            >
              압축
            </button>
          </div>
          {mode === "pretty" && (
            <div className="flex items-center gap-1">
              <span className="mr-1 font-mono text-[11px] text-white/35">들여쓰기</span>
              {(["2", "4", "tab"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={seg(indent === v)}
                  onClick={() => setIndent(v)}
                >
                  {v === "tab" ? "Tab" : `${v}칸`}
                </button>
              ))}
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 font-mono text-xs text-white/60">
            <input
              type="checkbox"
              checked={sortKeys}
              onChange={(e) => setSortKeys(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#6C63FF]"
            />
            키 정렬
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* 입력 */}
          <div className="flex min-w-0 flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-white/40">
                입력 {input && <span className="text-white/25">· {fmtBytes(bytes(input))}</span>}
              </span>
              <span className="flex gap-1.5">
                <button type="button" className={btn} onClick={() => setInput(SAMPLE)}>
                  예시
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={() => setInput("")}
                  disabled={!input}
                >
                  지우기
                </button>
              </span>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder='{"hello": "world"}'
              className={`h-[42vh] min-h-[260px] w-full resize-y rounded-xl border bg-[#15171c] p-4 font-mono text-[13px] leading-relaxed text-white/85 placeholder:text-white/20 focus:outline-none lg:h-[60vh] ${
                result.ok ? "border-white/10 focus:border-[#6C63FF]/50" : "border-red-400/50"
              }`}
            />
          </div>

          {/* 결과 */}
          <div className="flex min-w-0 flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-white/40">
                결과{" "}
                {result.ok && result.text && (
                  <span className="text-white/25">· {fmtBytes(bytes(result.text))}</span>
                )}
              </span>
              <span className="flex gap-1.5">
                <button
                  type="button"
                  className={btn}
                  disabled={!result.ok || !result.text}
                  onClick={() => result.ok && setInput(result.text)}
                  title="결과를 입력창에 덮어쓰기"
                >
                  ← 입력에 적용
                </button>
                <button
                  type="button"
                  className={btn}
                  disabled={!result.ok || !result.text}
                  onClick={copy}
                >
                  {copied ? "복사됨!" : "복사"}
                </button>
              </span>
            </div>
            <div className="h-[42vh] min-h-[260px] overflow-auto rounded-xl border border-white/10 bg-[#15171c] p-4 lg:h-[60vh]">
              {result.ok ? (
                result.text ? (
                  <pre className="font-mono text-[13px] leading-relaxed whitespace-pre text-white/80">
                    {highlight(result.text)}
                  </pre>
                ) : (
                  <p className="font-mono text-xs text-white/25">왼쪽에 JSON을 붙여넣으세요</p>
                )
              ) : (
                <div className="font-mono text-xs leading-relaxed">
                  <p className="mb-1 text-red-300">올바른 JSON이 아닙니다</p>
                  {result.at && (
                    <>
                      <p className="text-white/70">
                        {result.at.line}번째 줄, {result.at.col}번째 칸
                      </p>
                      {/* 오류 줄과 위치 표시 */}
                      <pre className="mt-2 overflow-x-auto rounded-md bg-black/30 p-2 text-white/70">
                        {result.at.lineText.slice(0, 200)}
                        {"\n"}
                        <span className="text-red-300">{" ".repeat(result.at.col - 1) + "^"}</span>
                      </pre>
                    </>
                  )}
                  <p className="mt-2 text-white/35">{result.message}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {bigIntWarning && result.ok && (
          <p className="mt-3 font-mono text-[11px] text-amber-300/80">
            ⚠ 16자리 이상 정수가 있어요. JavaScript 숫자로 변환되면서 끝자리가 달라질 수 있으니 ID
            값은 확인해주세요.
          </p>
        )}
      </div>
    </Faded>
  );
}
