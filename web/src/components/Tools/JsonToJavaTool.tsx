"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  JsonError,
  jsonToJava,
  type JsonGenOptions,
  type JsonSuffix,
  type Style,
} from "@/lib/jsonToJava";

const STORAGE_KEY = "devtools_json_java";

export const JSON_JAVA_SAMPLE = `{
  "order_id": 1024,
  "status": "PAID",
  "total_price": 35000.5,
  "ordered_at": "2026-09-30T21:03:11",
  "buyer": {
    "member_id": 7,
    "name": "이건모",
    "phone": null
  },
  "items": [
    { "product_no": 11, "name": "한우 등심", "qty": 1, "price": 30000 },
    { "product_no": 12, "name": "스테이크 소스", "qty": 2, "price": 2500.25 }
  ],
  "tags": ["gift", "fast-delivery"]
}`;

const STYLES: { key: Style; label: string }[] = [
  { key: "lombok", label: "Lombok" },
  { key: "plain", label: "getter/setter" },
  { key: "record", label: "record" },
];
const SUFFIXES: { key: JsonSuffix; label: string }[] = [
  { key: "", label: "없음" },
  { key: "Dto", label: "Dto" },
  { key: "Response", label: "Response" },
  { key: "VO", label: "VO" },
];

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
const seg = (on: boolean) =>
  `cursor-pointer rounded-full px-3 py-1.5 font-mono text-xs whitespace-nowrap transition-colors ${
    on ? "bg-[#6C63FF] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
  }`;
const check =
  "flex cursor-pointer items-center gap-1.5 font-mono text-xs whitespace-nowrap text-white/60";
const box = "h-3.5 w-3.5 accent-[#6C63FF]";
const textInput =
  "min-w-0 rounded-full border border-white/10 bg-[#15171c] px-3 py-1.5 font-mono text-xs text-white/85 placeholder:text-white/25 focus:border-[#6C63FF]/50 focus:outline-none";

function highlight(code: string): ReactNode[] {
  const re =
    /("[^"\n]*"|@\w+|\b(?:package|import|public|private|static|class|record|void|return|this)\b|\b(?:String|Long|Integer|Boolean|Double|BigDecimal|Object|List|LocalDate|LocalDateTime|OffsetDateTime)\b)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const t = m[0];
    const cls = t.startsWith('"')
      ? "text-emerald-300"
      : t.startsWith("@")
        ? "text-amber-300"
        : /^[A-Z]/.test(t)
          ? "text-sky-300"
          : "text-[#A9A3FF]";
    out.push(
      <span key={m.index} className={cls}>
        {t}
      </span>
    );
    last = m.index + t.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={btn}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {}
      }}
    >
      {done ? "복사됨!" : label}
    </button>
  );
}

export default function JsonToJavaTool() {
  const [input, setInput] = useState("");
  const [opt, setOpt] = useState<JsonGenOptions>({
    rootName: "",
    suffix: "Dto",
    pkg: "",
    style: "lombok",
    decimal: "BigDecimal",
    dates: true,
    jsonProperty: true,
    nested: true,
  });
  const set = <K extends keyof JsonGenOptions>(k: K, v: JsonGenOptions[K]) =>
    setOpt((o) => ({ ...o, [k]: v }));

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      /* eslint-disable react-hooks/set-state-in-effect -- 마지막 입력·설정 복원(마운트 1회) */
      if (typeof saved?.input === "string") setInput(saved.input);
      if (saved?.opt) setOpt((o) => ({ ...o, ...saved.opt }));
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
    // 저장된 값을 불러온 뒤부터 저장 (개발 모드에서 effect가 두 번 돌 때 기본값이 덮어쓰는 것 방지)
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (input.length < 500_000) localStorage.setItem(STORAGE_KEY, JSON.stringify({ input, opt }));
    } catch {}
  }, [hydrated, input, opt]);

  const result = useMemo(() => {
    if (!input.trim()) return null;
    try {
      return { ok: true as const, ...jsonToJava(input, opt) };
    } catch (e) {
      if (e instanceof JsonError)
        return { ok: false as const, message: e.message, line: e.line, col: e.col };
      return { ok: false as const, message: String((e as Error).message), line: 0, col: 0 };
    }
  }, [input, opt]);

  const lineText =
    result && !result.ok && result.line ? (input.split("\n")[result.line - 1] ?? "") : "";

  return (
    <div>
      {/* 옵션 */}
      <div className="mb-4 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap gap-1">
            {STYLES.map((x) => (
              <button
                key={x.key}
                type="button"
                className={seg(opt.style === x.key)}
                onClick={() => set("style", x.key)}
              >
                {x.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 font-mono text-[11px] text-white/35">접미사</span>
            {SUFFIXES.map((x) => (
              <button
                key={x.key}
                type="button"
                className={seg(opt.suffix === x.key)}
                onClick={() => set("suffix", x.key)}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-[11px] text-white/35">소수</span>
            {(["BigDecimal", "Double"] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={seg(opt.decimal === d)}
                onClick={() => set("decimal", d)}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-[11px] text-white/35">하위 객체</span>
            <button type="button" className={seg(opt.nested)} onClick={() => set("nested", true)}>
              내부 클래스
            </button>
            <button type="button" className={seg(!opt.nested)} onClick={() => set("nested", false)}>
              파일 분리
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className={check}>
            <input
              type="checkbox"
              className={box}
              checked={opt.jsonProperty}
              onChange={(e) => set("jsonProperty", e.target.checked)}
            />
            @JsonProperty
          </label>
          <label className={check}>
            <input
              type="checkbox"
              className={box}
              checked={opt.dates}
              onChange={(e) => set("dates", e.target.checked)}
            />
            날짜 문자열 → LocalDateTime
          </label>
          <input
            value={opt.rootName}
            onChange={(e) => set("rootName", e.target.value.replace(/[^\w$]/g, ""))}
            placeholder="클래스 이름 (Root)"
            spellCheck={false}
            className={`${textInput} w-full sm:w-44`}
          />
          <input
            value={opt.pkg}
            onChange={(e) => set("pkg", e.target.value.replace(/[^\w.]/g, ""))}
            placeholder="패키지 (com.example.dto)"
            spellCheck={false}
            className={`${textInput} w-full sm:w-56`}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 입력 */}
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-white/40">JSON</span>
            <span className="flex gap-1.5">
              <button type="button" className={btn} onClick={() => setInput(JSON_JAVA_SAMPLE)}>
                예시
              </button>
              <button type="button" className={btn} onClick={() => setInput("")} disabled={!input}>
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
            wrap="off"
            placeholder={'{\n  "order_id": 1024,\n  "items": [{ "name": "한우", "qty": 1 }]\n}'}
            className={`h-[42vh] min-h-[260px] w-full resize-y rounded-xl border bg-[#15171c] p-4 font-mono text-[12.5px] leading-relaxed text-white/85 placeholder:text-white/20 focus:outline-none lg:h-[60vh] ${
              result && !result.ok
                ? "border-red-400/50"
                : "border-white/10 focus:border-[#6C63FF]/50"
            }`}
          />
        </div>

        {/* 결과 */}
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-white/40">
              Java{" "}
              {result?.ok && <span className="text-white/25">· 클래스 {result.classCount}개</span>}
            </span>
            {result?.ok && result.files.length > 1 && (
              <CopyButton text={result.files.map((f) => f.code).join("\n\n")} label="전체 복사" />
            )}
          </div>
          <div className="flex h-[42vh] min-h-[260px] flex-col gap-3 overflow-auto rounded-xl border border-white/10 bg-[#15171c] p-3 lg:h-[60vh]">
            {!result ? (
              <p className="p-1 font-mono text-xs leading-relaxed text-white/30">
                왼쪽에 API 응답 JSON을 붙여넣으면 Java DTO 클래스가 여기에 나옵니다.
              </p>
            ) : !result.ok ? (
              <div className="p-1 font-mono text-xs leading-relaxed">
                <p className="mb-1 text-red-300">{result.message}</p>
                {result.line > 0 && (
                  <>
                    <p className="text-white/70">
                      {result.line}번째 줄, {result.col}번째 칸
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded-md bg-black/30 p-2 text-white/70">
                      {lineText.slice(0, 200)}
                      {"\n"}
                      <span className="text-red-300">
                        {" ".repeat(Math.max(0, result.col - 1)) + "^"}
                      </span>
                    </pre>
                  </>
                )}
              </div>
            ) : (
              <>
                {result.rootIsArray && (
                  <p className="px-1 font-mono text-[11px] text-amber-300/85">
                    ⚠ 최상위가 배열이라 List&lt;{result.files[0].name}&gt; 로 받으면 됩니다.
                  </p>
                )}
                {result.files.map((f) => (
                  <div key={f.name} className="rounded-lg border border-white/10 bg-[#1C1E24]">
                    <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
                      <span className="truncate font-mono text-[11px] text-[#A9A3FF]">
                        {f.name}.java
                      </span>
                      <CopyButton text={f.code} />
                    </div>
                    <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre text-white/85">
                      {highlight(f.code)}
                    </pre>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
