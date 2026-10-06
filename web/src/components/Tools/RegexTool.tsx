"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  escapeRegex,
  fromJavaLiteral,
  groupNames,
  MAX_MATCHES,
  runRegex,
  toJavaCode,
  toJavaLiteral,
  type RegexResult,
} from "@/lib/regexTester";

const STORAGE_KEY = "devtools_regex";
const TIMEOUT_MS = 1000;

const FLAGS: { key: string; label: string; desc: string }[] = [
  { key: "g", label: "g", desc: "전체 검색 (모든 매칭)" },
  { key: "i", label: "i", desc: "대소문자 무시" },
  { key: "m", label: "m", desc: "여러 줄 (^ $가 줄마다)" },
  { key: "s", label: "s", desc: ". 이 줄바꿈도 매칭" },
  { key: "u", label: "u", desc: "유니코드" },
];

export const REGEX_PRESETS: { label: string; pattern: string; flags: string; text: string }[] = [
  {
    label: "이메일",
    pattern: "[\\w.+-]+@([\\w-]+\\.)+[A-Za-z]{2,}",
    flags: "g",
    text: "문의: gunmo.dev@example.com, 잘못된 형식: user@@test, 회사: lee+work@corp.co.kr",
  },
  {
    label: "휴대폰 번호",
    pattern: "01[016789]-?(?<mid>\\d{3,4})-?(?<last>\\d{4})",
    flags: "g",
    text: "연락처 010-1234-5678 / 01098765432 / 02-123-4567(일반전화)",
  },
  {
    label: "날짜 (YYYY-MM-DD)",
    pattern: "(?<y>\\d{4})-(?<m>0[1-9]|1[0-2])-(?<d>0[1-9]|[12]\\d|3[01])",
    flags: "g",
    text: "주문일 2026-10-02, 배송 예정 2026-10-05, 잘못된 날짜 2026-13-40",
  },
  {
    label: "MyBatis 로그에서 SQL",
    pattern: "==>\\s+Preparing:\\s*(.+)",
    flags: "g",
    text: "2026-09-30 21:03:11 DEBUG [exec-3] OrderMapper.selectOrders : ==>  Preparing: SELECT * FROM orders WHERE member_id = ?\n2026-09-30 21:03:11 DEBUG [exec-3] OrderMapper.selectOrders : ==> Parameters: 1024(Long)",
  },
  {
    label: "URL 쿼리 파라미터",
    pattern: "[?&](?<key>[^=&#]+)=(?<value>[^&#]*)",
    flags: "g",
    text: "https://example.com/orders?status=PAID&page=2&sort=created_at,desc#top",
  },
];

// 커서 위치에 넣는 빠른 입력
const SNIPPETS: { label: string; insert: string; title: string }[] = [
  { label: "\\d", insert: "\\d", title: "숫자" },
  { label: "\\w", insert: "\\w", title: "영문·숫자·_" },
  { label: "\\s", insert: "\\s", title: "공백" },
  { label: ".", insert: ".", title: "아무 문자 하나" },
  { label: "[ ]", insert: "[]", title: "문자 집합" },
  { label: "( )", insert: "()", title: "캡처 그룹" },
  { label: "(?:)", insert: "(?:)", title: "캡처 안 하는 그룹" },
  { label: "(?<n>)", insert: "(?<name>)", title: "이름 그룹" },
  { label: "+", insert: "+", title: "1번 이상" },
  { label: "*", insert: "*", title: "0번 이상" },
  { label: "?", insert: "?", title: "있거나 없거나" },
  { label: "{n,m}", insert: "{1,3}", title: "반복 횟수" },
  { label: "^", insert: "^", title: "시작" },
  { label: "$", insert: "$", title: "끝" },
  { label: "|", insert: "|", title: "또는" },
  { label: "(?=)", insert: "(?=)", title: "전방 탐색" },
  { label: "(?<=)", insert: "(?<=)", title: "후방 탐색" },
];

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
const box =
  "w-full rounded-xl border border-white/10 bg-[#15171c] font-mono text-[13px] text-white/85 placeholder:text-white/20 focus:border-[#6C63FF]/50 focus:outline-none";
const MARK = ["bg-[#6C63FF]/35", "bg-[#2dd4bf]/30"];

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

/** 무거운 정규식(재앙적 역추적)이 탭을 멈추지 않게 Worker에서 실행하고, 시간 초과면 강제 종료 */
function useRegexWorker() {
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);

  const create = () => {
    const src = `const run = ${runRegex.toString()};
self.onmessage = (e) => { const { id, args } = e.data; self.postMessage({ id, res: run(...args) }); };`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    return w;
  };

  useEffect(() => () => workerRef.current?.terminate(), []);

  return (args: Parameters<typeof runRegex>): Promise<RegexResult | "timeout"> =>
    new Promise((resolve) => {
      if (typeof Worker === "undefined") return resolve(runRegex(...args));
      try {
        workerRef.current ??= create();
      } catch {
        return resolve(runRegex(...args)); // Worker 생성 불가 환경
      }
      const w = workerRef.current;
      const id = ++seqRef.current;
      const timer = setTimeout(() => {
        w.terminate();
        if (workerRef.current === w) workerRef.current = null;
        resolve("timeout");
      }, TIMEOUT_MS);
      const onMsg = (e: MessageEvent<{ id: number; res: RegexResult }>) => {
        if (e.data.id !== id) return;
        clearTimeout(timer);
        w.removeEventListener("message", onMsg);
        resolve(e.data.res);
      };
      w.addEventListener("message", onMsg);
      w.postMessage({ id, args });
    });
}

export default function RegexTool() {
  const [pattern, setPattern] = useState(REGEX_PRESETS[0].pattern);
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState(REGEX_PRESETS[0].text);
  const [replaceOn, setReplaceOn] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [javaInput, setJavaInput] = useState(false);
  const patternRef = useRef<HTMLInputElement>(null);

  // 마지막 입력 복원 (hydrated 이후에만 저장 — StrictMode 덮어쓰기 방지)
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      /* eslint-disable react-hooks/set-state-in-effect -- 마지막 입력 복원(마운트 1회) */
      if (saved) {
        if (typeof saved.pattern === "string") setPattern(saved.pattern);
        if (typeof saved.flags === "string") setFlags(saved.flags);
        if (typeof saved.text === "string") setText(saved.text);
        if (typeof saved.replacement === "string") setReplacement(saved.replacement);
        if (typeof saved.replaceOn === "boolean") setReplaceOn(saved.replaceOn);
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (text.length < 300_000)
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ pattern, flags, text, replacement, replaceOn })
        );
    } catch {}
  }, [hydrated, pattern, flags, text, replacement, replaceOn]);

  // Java 문자열로 입력 중이면 실제 정규식으로 풀어서 실행
  const regex = javaInput ? fromJavaLiteral(pattern) : pattern;

  const run = useRegexWorker();
  const [result, setResult] = useState<RegexResult | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const res = await run([regex, flags, text, replaceOn ? replacement : null]);
      if (!alive) return;
      if (res === "timeout") {
        setTimedOut(true);
        setResult(null);
      } else {
        setTimedOut(false);
        setResult(res);
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run은 매 렌더 새 함수지만 내부 worker는 ref로 유지
  }, [regex, flags, text, replaceOn, replacement]);

  const toggleFlag = (f: string) =>
    setFlags((cur) => (cur.includes(f) ? cur.replace(f, "") : [...(cur + f)].sort().join("")));

  const insert = (s: string) => {
    const el = patternRef.current;
    const start = el?.selectionStart ?? pattern.length;
    const end = el?.selectionEnd ?? pattern.length;
    const next = pattern.slice(0, start) + s + pattern.slice(end);
    setPattern(next);
    // 괄호류는 가운데로 커서
    const caret = start + (/^\(.*\)$|^\[\]$/.test(s) ? s.length - 1 : s.length);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  // 테스트 문자열에 매칭 구간 하이라이트
  const highlighted = useMemo(() => {
    if (!result || result.error || result.matches.length === 0) return null;
    const out: ReactNode[] = [];
    let last = 0;
    result.matches.forEach((m, i) => {
      if (m.index < last) return;
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(
        m.end === m.index ? (
          <span key={i} className="mx-px inline-block h-[1.1em] w-px bg-amber-300 align-middle" />
        ) : (
          <mark key={i} className={`rounded-sm text-white ${MARK[i % 2]}`} title={`#${i + 1}`}>
            {text.slice(m.index, m.end)}
          </mark>
        )
      );
      last = m.end;
    });
    out.push(text.slice(last));
    return out;
  }, [result, text]);

  const groupCount = result?.matches[0]?.groups.length ?? 0;
  const names = useMemo(() => groupNames(regex), [regex]);
  const javaCode = toJavaCode(regex, flags, replaceOn ? replacement : null);

  return (
    <div>
      {/* 예시 */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-xs text-white/35">예시</span>
        {REGEX_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={btn}
            onClick={() => {
              setJavaInput(false);
              setPattern(p.pattern);
              setFlags(p.flags);
              setText(p.text);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 정규식 입력 */}
      <div className="rounded-2xl border border-white/10 bg-[#1C1E24] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-xs text-white/40">정규식</span>
          <label className="flex cursor-pointer items-center gap-1.5 font-mono text-xs text-white/60">
            <input
              type="checkbox"
              checked={javaInput}
              onChange={(e) => {
                const on = e.target.checked;
                // 입력값도 같이 변환해서 같은 정규식을 유지
                setPattern(on ? toJavaLiteral(pattern) : fromJavaLiteral(pattern));
                setJavaInput(on);
              }}
              className="h-3.5 w-3.5 accent-[#6C63FF]"
            />
            Java 문자열로 입력 (<span className="text-white/80">&quot;\\d+&quot;</span>)
          </label>
        </div>
        <div className="flex items-stretch gap-2">
          <div
            className={`flex min-w-0 flex-1 items-center rounded-xl border bg-[#15171c] px-3 font-mono text-[15px] ${
              result?.error
                ? "border-red-400/60"
                : "border-white/10 focus-within:border-[#6C63FF]/50"
            }`}
          >
            <span className="text-white/30">{javaInput ? '"' : "/"}</span>
            <input
              ref={patternRef}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="정규식을 입력하세요"
              aria-label="정규식"
              className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-white placeholder:text-white/20 focus:outline-none"
            />
            <span className="text-white/30">{javaInput ? '"' : `/${flags}`}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {FLAGS.map((f) => (
            <button
              key={f.key}
              type="button"
              title={f.desc}
              onClick={() => toggleFlag(f.key)}
              className={`cursor-pointer rounded-full px-3 py-1 font-mono text-xs transition-colors ${
                flags.includes(f.key)
                  ? "bg-[#6C63FF] text-white"
                  : "bg-white/5 text-white/55 hover:bg-white/10"
              }`}
            >
              {f.label} <span className="text-[10px] opacity-70">{f.desc}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {SNIPPETS.map((s) => (
            <button
              key={s.label}
              type="button"
              title={s.title}
              onClick={() => insert(s.insert)}
              className="cursor-pointer rounded-md border border-white/10 px-2 py-0.5 font-mono text-[11px] text-white/60 transition-colors hover:border-[#6C63FF]/50 hover:text-white"
            >
              {s.label}
            </button>
          ))}
        </div>

        {result?.error && (
          <p className="mt-3 font-mono text-xs text-red-300/90">⚠ {result.error}</p>
        )}
        {timedOut && (
          <p className="mt-3 font-mono text-xs text-amber-300/90">
            ⚠ {TIMEOUT_MS / 1000}초 안에 끝나지 않아 중단했어요. (a+)+ 같은 중첩 반복은 입력 길이에
            따라 시간이 폭발적으로 늘어납니다(재앙적 역추적).
          </p>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* 테스트 문자열 */}
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-white/40">테스트 문자열</span>
            <span className="flex gap-1.5">
              <button
                type="button"
                className={btn}
                onClick={() => {
                  // 선택한 글자를 그대로 찾는 정규식으로
                  const sel = window.getSelection()?.toString();
                  if (sel) {
                    setJavaInput(false);
                    setPattern(escapeRegex(sel));
                  }
                }}
                title="테스트 문자열에서 드래그한 글자를 그대로 찾는 정규식으로 바꿉니다"
              >
                선택 → 정규식
              </button>
              <button type="button" className={btn} onClick={() => setText("")} disabled={!text}>
                지우기
              </button>
            </span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="정규식을 적용할 문자열을 붙여넣으세요"
            className={`${box} h-[180px] resize-y p-4 leading-relaxed`}
          />
          <div className="mt-3 mb-2 font-mono text-xs text-white/40">
            매칭 결과{" "}
            {result && !result.error && (
              <span className={result.matches.length ? "text-[#A9A3FF]" : "text-white/30"}>
                · {result.matches.length}
                {result.truncated ? `+ (처음 ${MAX_MATCHES}개만)` : "개"}
              </span>
            )}
          </div>
          <pre className="max-h-[260px] min-h-[120px] overflow-auto rounded-xl border border-white/10 bg-[#15171c] p-4 font-mono text-[13px] leading-relaxed break-all whitespace-pre-wrap text-white/60">
            {highlighted ??
              (text || <span className="text-white/25">결과가 여기에 표시됩니다</span>)}
          </pre>
        </div>

        {/* 매칭 목록 */}
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-white/40">
              매칭 목록
              {groupCount > 0 && <span className="text-white/25"> · 그룹 {groupCount}개</span>}
            </span>
          </div>
          <div className="h-[180px] overflow-auto rounded-xl border border-white/10 bg-[#15171c] lg:h-[484px]">
            {!result || result.error || result.matches.length === 0 ? (
              <p className="p-4 font-mono text-xs text-white/30">
                {pattern ? "매칭되는 부분이 없습니다." : "정규식을 입력하면 매칭 목록이 나옵니다."}
              </p>
            ) : (
              <table className="w-full font-mono text-[12px]">
                <thead className="sticky top-0 bg-[#1C1E24] text-white/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-normal">#</th>
                    <th className="px-3 py-2 text-left font-normal">매칭</th>
                    <th className="px-3 py-2 text-left font-normal">위치</th>
                    <th className="px-3 py-2 text-left font-normal">그룹</th>
                  </tr>
                </thead>
                <tbody>
                  {result.matches.slice(0, 300).map((m, i) => (
                    <tr key={i} className="border-t border-white/5 align-top">
                      <td className="px-3 py-1.5 text-white/30">{i + 1}</td>
                      <td className="max-w-[220px] px-3 py-1.5 break-all text-white/90">
                        {m.text === "" ? (
                          <span className="text-amber-300/80">(빈 문자열)</span>
                        ) : (
                          m.text
                        )}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-white/35">
                        {m.index}–{m.end}
                      </td>
                      <td className="px-3 py-1.5 text-white/70">
                        {m.groups.length === 0 ? (
                          <span className="text-white/20">-</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {m.groups.map((g, gi) => {
                              const name = names[gi];
                              return (
                                <span key={gi} className="break-all">
                                  <span className="text-[#A9A3FF]">
                                    ${gi + 1}
                                    {name ? `<${name}>` : ""}
                                  </span>{" "}
                                  {g === null ? (
                                    <span className="text-white/25">undefined</span>
                                  ) : (
                                    g
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* 치환 */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-[#1C1E24] p-4">
        <label className="flex w-fit cursor-pointer items-center gap-1.5 font-mono text-xs text-white/60">
          <input
            type="checkbox"
            checked={replaceOn}
            onChange={(e) => setReplaceOn(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#6C63FF]"
          />
          치환 (replace) — <span className="text-white/80">$1</span>,{" "}
          <span className="text-white/80">$&lt;name&gt;</span>,{" "}
          <span className="text-white/80">$&amp;</span> 사용 가능
        </label>
        {replaceOn && (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              spellCheck={false}
              placeholder="바꿀 문자열 (예: $<y>년 $<m>월 $<d>일)"
              aria-label="치환 문자열"
              className={`${box} px-3 py-2.5`}
            />
            <div className="flex min-w-0 items-start gap-2">
              <pre className="min-h-[42px] flex-1 overflow-auto rounded-xl border border-white/10 bg-[#15171c] px-3 py-2.5 font-mono text-[13px] break-all whitespace-pre-wrap text-emerald-200/85">
                {result?.replaced ?? ""}
              </pre>
              {result?.replaced && <CopyButton text={result.replaced} />}
            </div>
          </div>
        )}
      </div>

      {/* Java 코드 */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-[#1C1E24] p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-white/40">Java 코드</span>
          <span className="flex gap-1.5">
            <CopyButton text={`"${toJavaLiteral(regex)}"`} label="문자열만 복사" />
            <CopyButton text={javaCode} label="코드 복사" />
          </span>
        </div>
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-[#15171c] p-4 font-mono text-[12.5px] leading-relaxed text-white/80">
          {javaCode}
        </pre>
      </div>
    </div>
  );
}
