"use client";

import { useEffect, useMemo, useState } from "react";
import {
  check,
  compile,
  describeClass,
  filterRegexOf,
  hex,
  parseRegexInput,
  showChar,
  type CheckResult,
  type ClassItem,
  type Compiled,
} from "@/lib/regexInspect";

const STORAGE_KEY = "devtools_regex_validate";
const MAX_LINES = 300;

export interface ValidateIncoming {
  pattern: string;
  samples?: string[];
  nonce: number;
}

const PRESETS: { label: string; pattern: string; value: string; batch: string[] }[] = [
  {
    label: "닉네임 허용 문자",
    pattern:
      "/^[a-zA-Z0-9\\uAC00-\\uD7A3\\u3130-\\u318F\\u1100-\\u11FF\\u00B7\\u2022\\u2027 ~!@#$%^&*()\\-+\\[\\]]*$/",
    value: "건모_닉네임!",
    batch: ["건모123", "gunmo_dev", "ㄱㄴㄷ", "닉네임·별명", "이모지😀", "a/b", "[운영자]"],
  },
  {
    label: "숫자만",
    pattern: "/^\\d*$/",
    value: "010-1234",
    batch: ["12345", "12,345", "１２３", "-1"],
  },
  {
    label: "한글만 2~5자",
    pattern: "/^[가-힣]{2,5}$/",
    value: "이건모",
    batch: ["이건모", "건", "ㄱㅁ", "남궁민수씨아저씨", "Gunmo"],
  },
  {
    label: "비밀번호 조건",
    pattern: "/^(?=.*[A-Za-z])(?=.*\\d)(?=.*[!@#$%^&*])[A-Za-z\\d!@#$%^&*]{8,16}$/",
    value: "abcd1234",
    batch: ["abcd1234!", "abcd1234", "12345678!", "ab1!", "abcd 1234!"],
  },
  {
    label: "이메일",
    pattern: "/^[\\w.+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}$/",
    value: "gunmo@example",
    batch: ["gunmo@example.com", "user@@test.com", "no-at.com", "a@b.co.kr"],
  },
];

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white";
const box =
  "w-full rounded-xl border border-white/10 bg-[#15171c] font-mono text-[13px] text-white/85 placeholder:text-white/20 focus:border-[#6C63FF]/50 focus:outline-none";
const card = "rounded-2xl border border-white/10 bg-[#1C1E24] p-4";
const label = "font-mono text-xs text-white/40";

function rangeText(it: Extract<ClassItem, { kind: "range" }>) {
  const n = it.to - it.from + 1;
  return `${String.fromCodePoint(it.from)}–${String.fromCodePoint(it.to)} (${hex(it.from)}–${hex(it.to)}${n > 1 ? `, ${n.toLocaleString()}자` : ""})`;
}

/** 이 정규식이 허용하는 문자/길이/조건 */
function Allowed({ c }: { c: Compiled }) {
  const cs = c.shape.charset!;
  const items = describeClass(cs.body);
  const ranges = items.filter((i) => i.kind !== "char");
  const singles = items.filter((i): i is Extract<ClassItem, { kind: "char" }> => i.kind === "char");
  const len =
    cs.max === null
      ? cs.min === 0
        ? "제한 없음 (빈 값도 통과)"
        : `${cs.min}자 이상`
      : cs.min === cs.max
        ? `정확히 ${cs.min}자`
        : `${cs.min}~${cs.max}자${cs.min === 0 ? " (빈 값도 통과)" : ""}`;
  return (
    <div className={card}>
      <div className={`${label} mb-3`}>
        이 정규식이 {cs.negated ? <b className="text-amber-300/90">막는</b> : "허용하는"} 문자
        {cs.negated && <span className="text-white/30"> — 아래를 뺀 나머지는 전부 통과</span>}
      </div>
      <ul className="flex flex-col gap-1.5 font-['Nanum_Gothic',sans-serif] text-sm text-white/80">
        {ranges.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-[#A9A3FF]">•</span>
            <span>
              {it.kind === "range"
                ? (it.label ?? rangeText(it))
                : it.kind === "shorthand" && it.label}{" "}
              <span className="font-mono text-[11px] whitespace-nowrap text-white/30">
                {it.kind === "range"
                  ? it.label
                    ? `${hex(it.from)}–${hex(it.to)}`
                    : ""
                  : it.kind === "shorthand" && it.raw}
              </span>
            </span>
          </li>
        ))}
        {singles.length > 0 && (
          <li className="flex flex-wrap items-center gap-1.5">
            <span className="text-[#A9A3FF]">•</span>
            <span className="mr-1">낱개 문자</span>
            {singles.map((it, i) => {
              const s = showChar(it.cp);
              return (
                <span
                  key={i}
                  title={`${hex(it.cp)}${s.name ? ` ${s.name}` : ""}`}
                  className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[12px] text-white/85"
                >
                  {s.name ? (
                    <>
                      {s.text !== "␣" && s.text} <span className="text-white/45">{s.name}</span>
                    </>
                  ) : (
                    s.text
                  )}
                </span>
              );
            })}
          </li>
        )}
      </ul>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-white/50">
        <span>
          길이 <span className="text-white/80">{len}</span>
        </span>
        {c.re.flags.includes("i") && <span className="text-amber-200/80">i: 대소문자 무시</span>}
      </div>
    </div>
  );
}

function Verdict({ r }: { r: CheckResult }) {
  return r.ok ? (
    <span className="rounded-full bg-emerald-400/15 px-3 py-1 font-mono text-sm font-bold text-emerald-300">
      ✓ 통과
    </span>
  ) : (
    <span className="rounded-full bg-red-400/15 px-3 py-1 font-mono text-sm font-bold text-red-300">
      ✕ 걸림
    </span>
  );
}

/** 한 줄 요약 (여러 값 검사용) */
function shortReason(r: CheckResult): string {
  if (r.ok) return "";
  const why: string[] = [];
  if (r.badChars.length)
    why.push(
      `허용 안 됨: ${r.badChars.map((ch) => showChar(ch.codePointAt(0)!).name ?? ch).join(" ")}`
    );
  if (r.lengthIssue) why.push(r.lengthIssue);
  for (const cd of r.conditions) if (!cd.ok) why.push(cd.label ?? cd.la.src);
  return why.join(" · ");
}

export default function RegexValidate({ incoming }: { incoming?: ValidateIncoming | null }) {
  const [pattern, setPattern] = useState(PRESETS[0].pattern);
  const [rawFlags, setRawFlags] = useState("");
  const [value, setValue] = useState(PRESETS[0].value);
  const [batch, setBatch] = useState(PRESETS[0].batch.join("\n"));
  const [blockMode, setBlockMode] = useState(false);
  const [blocked, setBlocked] = useState("");

  // 마지막 입력 복원
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      /* eslint-disable react-hooks/set-state-in-effect -- 마지막 입력 복원(마운트 1회) */
      if (saved) {
        if (typeof saved.pattern === "string") setPattern(saved.pattern);
        if (typeof saved.rawFlags === "string") setRawFlags(saved.rawFlags);
        if (typeof saved.value === "string") setValue(saved.value);
        if (typeof saved.batch === "string") setBatch(saved.batch);
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ pattern, rawFlags, value, batch }));
    } catch {}
  }, [hydrated, pattern, rawFlags, value, batch]);

  // 정규식 만들기 탭에서 넘어온 값
  useEffect(() => {
    if (!incoming) return;
    /* eslint-disable react-hooks/set-state-in-effect -- 다른 탭에서 넘겨받은 값 반영 */
    setPattern(`/${incoming.pattern}/`);
    if (incoming.samples?.length) {
      setValue(incoming.samples[0]);
      setBatch(incoming.samples.join("\n"));
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [incoming]);

  const parsed = parseRegexInput(pattern, rawFlags);
  const compiled = useMemo(
    () => (parsed.source ? compile(parsed.source, parsed.flags) : null),
    [parsed.source, parsed.flags]
  );
  const c = compiled && !("error" in compiled) ? compiled : null;
  const error = compiled && "error" in compiled ? compiled.error : null;

  const result = useMemo(() => (c ? check(c, value) : null), [c, value]);
  const lines = useMemo(() => batch.replace(/\n$/, "").split("\n").slice(0, MAX_LINES), [batch]);
  const batchResults = useMemo(
    () => (c ? lines.map((l) => ({ l, r: check(c, l) })) : []),
    [c, lines]
  );
  const passCount = batchResults.filter((b) => b.r.ok).length;

  const filterRe = c ? filterRegexOf(c.shape, c.re.flags) : null;
  const whitelist = !!c?.charRe;
  const anchored = !!c && c.shape.anchoredStart && c.shape.anchoredEnd;

  const onValue = (next: string) => {
    if (blockMode && c?.charRe) {
      const kept: string[] = [];
      const removed: string[] = [];
      for (const ch of Array.from(next)) (c.charRe.test(ch) ? kept : removed).push(ch);
      setBlocked(removed.join(""));
      setValue(kept.join(""));
    } else setValue(next);
  };

  const toggleFlag = (f: string) =>
    setRawFlags((cur) => (cur.includes(f) ? cur.replace(f, "") : [...(cur + f)].sort().join("")));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-xs text-white/35">예시</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={btn}
            onClick={() => {
              setPattern(p.pattern);
              setValue(p.value);
              setBatch(p.batch.join("\n"));
              setBlocked("");
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 정규식 */}
      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className={label}>검사할 정규식</span>
          <span className="font-['Nanum_Gothic',sans-serif] text-[11px] text-white/30">
            /…/i, Java 문자열 &quot;…&quot;, 본문만 — 어떤 형태로 붙여넣어도 됩니다
          </span>
        </div>
        <textarea
          value={pattern}
          onChange={(e) => setPattern(e.target.value.replace(/\r?\n/g, ""))}
          rows={1}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="/^[가-힣a-zA-Z0-9]*$/"
          aria-label="검사할 정규식"
          className={`${box} field-sizing-content block min-h-[46px] resize-none px-3 py-2.5 text-[15px] break-all text-white ${error ? "border-red-400/60" : ""}`}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-xs text-white/45">
          {parsed.kind === "literal" ? (
            <span>
              플래그 <span className="text-white/80">{parsed.flags || "없음"}</span>
            </span>
          ) : (
            <>
              {parsed.kind === "java" && (
                <span className="mr-2 text-[#A9A3FF]">Java 문자열로 인식 →</span>
              )}
              {[
                ["i", "대소문자 무시"],
                ["u", "유니코드"],
              ].map(([f, d]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFlag(f)}
                  className={`cursor-pointer rounded-full px-2.5 py-0.5 ${
                    rawFlags.includes(f)
                      ? "bg-[#6C63FF] text-white"
                      : "bg-white/5 text-white/55 hover:bg-white/10"
                  }`}
                >
                  {f} <span className="text-[10px] opacity-70">{d}</span>
                </button>
              ))}
            </>
          )}
          {parsed.kind === "java" && (
            <span className="ml-2 break-all text-white/30">본문 {parsed.source}</span>
          )}
        </div>
        {error && <p className="mt-2 font-mono text-xs text-red-300/90">⚠ {error}</p>}
        {c && /[gy]/.test(parsed.flags) && (
          <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-xs text-amber-200/80">
            ⚠ g 플래그가 붙은 정규식을 변수에 두고 test()를 반복하면 lastIndex가 남아서 같은 값도
            true/false가 번갈아 나옵니다. 검사용이면 g를 빼세요. (여기선 g를 빼고 검사)
          </p>
        )}
        {c && !anchored && (
          <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-xs text-amber-200/80">
            ⚠ {c.shape.anchoredStart ? "$" : c.shape.anchoredEnd ? "^" : "^ 와 $"}가 없어서 값의
            일부만 맞아도 통과합니다. 입력값 전체를 검사하려면 ^…$ 로 감싸세요.
          </p>
        )}
      </div>

      {whitelist && c && (
        <div className="mt-4">
          <Allowed c={c} />
        </div>
      )}
      {c && c.shape.lookaheads.length > 0 && c.shape.anchoredStart && (
        <div className={`${card} mt-4`}>
          <div className={`${label} mb-2`}>추가 조건 (전방 탐색)</div>
          <ul className="flex flex-col gap-1 text-sm">
            {c.shape.lookaheads.map((la, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className={result?.conditions[i]?.ok ? "text-emerald-300" : "text-red-300"}>
                  {result?.conditions[i]?.ok ? "✓" : "✕"}
                </span>
                <span className="font-['Nanum_Gothic',sans-serif] text-white/80">
                  {result?.conditions[i]?.label ?? "조건"}
                </span>
                <span className="font-mono text-[11px] text-white/30">{la.src}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* 한 값 */}
        <div className={`${card} min-w-0`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className={label}>입력해 보기</span>
            {whitelist && (
              <span className="flex overflow-hidden rounded-full border border-white/10 font-mono text-[11px]">
                {[
                  [false, "검사만"],
                  [true, "입력 막기"],
                ].map(([on, t]) => (
                  <button
                    key={String(on)}
                    type="button"
                    onClick={() => {
                      setBlockMode(on as boolean);
                      setBlocked("");
                    }}
                    className={`cursor-pointer px-3 py-1 ${
                      blockMode === on
                        ? "bg-[#6C63FF] text-white"
                        : "text-white/55 hover:bg-white/5"
                    }`}
                  >
                    {t as string}
                  </button>
                ))}
              </span>
            )}
          </div>
          <input
            value={value}
            onChange={(e) => onValue(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="값을 입력하세요"
            aria-label="검사할 값"
            className={`${box} px-3 py-2.5 text-[15px] text-white`}
          />
          {blockMode && (
            <p className="mt-1.5 font-['Nanum_Gothic',sans-serif] text-[11px] leading-relaxed text-white/35">
              onChange에서 허용 안 되는 글자를 지우는 흔한 방식 그대로입니다.{" "}
              {blocked ? (
                <span className="text-red-300/90">
                  방금 막힌 글자: <span className="font-mono">{blocked}</span>
                </span>
              ) : (
                "가-힣만 허용하면 조합 중인 ㄱ이 지워져 한글이 안 써지는 것도 그대로 재현돼요."
              )}
            </p>
          )}

          {result && (
            <div className="mt-4">
              <div className="flex flex-wrap items-center gap-3">
                <Verdict r={result} />
                <span className="font-mono text-xs text-white/35">{result.length}자</span>
              </div>

              {result.chars && result.chars.length > 0 && (
                <div className="mt-3 rounded-xl border border-white/10 bg-[#15171c] p-3 font-mono text-[15px] leading-loose break-all">
                  {result.chars.map((x, i) => (
                    <span
                      key={i}
                      title={`${hex(x.ch.codePointAt(0)!)}${x.ok ? "" : " — 허용 안 됨"}`}
                      className={
                        x.ok
                          ? "text-white/85"
                          : "rounded-sm bg-red-500/40 text-red-50 outline outline-1 outline-red-400/70"
                      }
                    >
                      {x.ch === " " ? " " : x.ch}
                    </span>
                  ))}
                </div>
              )}

              {!result.chars && result.matched && value && (
                <div className="mt-3 rounded-xl border border-white/10 bg-[#15171c] p-3 font-mono text-[15px] break-all text-white/50">
                  {value.slice(0, result.matched.index)}
                  <mark className="rounded-sm bg-[#6C63FF]/35 text-white">
                    {value.slice(result.matched.index, result.matched.end)}
                  </mark>
                  {value.slice(result.matched.end)}
                  <span className="mt-1 block font-['Nanum_Gothic',sans-serif] text-[11px] text-white/35">
                    하이라이트한 부분만 맞았는데도 통과로 나옵니다.
                  </span>
                </div>
              )}

              <ul className="mt-3 flex flex-col gap-1 font-['Nanum_Gothic',sans-serif] text-sm text-white/70">
                {result.badChars.map((ch) => {
                  const cp = ch.codePointAt(0)!;
                  const s = showChar(cp);
                  return (
                    <li key={ch}>
                      <span className="text-red-300">✕</span> 허용 안 되는 문자{" "}
                      <span className="rounded bg-red-500/20 px-1.5 font-mono text-red-100">
                        {s.text}
                      </span>{" "}
                      <span className="font-mono text-xs text-white/35">
                        {hex(cp)}
                        {s.name ? ` ${s.name}` : ""}
                      </span>
                    </li>
                  );
                })}
                {result.lengthIssue && (
                  <li>
                    <span className="text-red-300">✕</span> {result.lengthIssue}
                  </li>
                )}
                {result.conditions
                  .filter((cd) => !cd.ok)
                  .map((cd, i) => (
                    <li key={i}>
                      <span className="text-red-300">✕</span> {cd.label ?? "조건 불충족"}{" "}
                      <span className="font-mono text-xs text-white/30">{cd.la.src}</span>
                    </li>
                  ))}
                {!result.ok &&
                  !result.badChars.length &&
                  !result.lengthIssue &&
                  result.conditions.every((cd) => cd.ok) && (
                    <li className="text-white/45">
                      정규식 형식과 맞지 않습니다.{" "}
                      {!whitelist && "(형식형 정규식은 어느 글자에서 틀렸는지까지는 알 수 없어요)"}
                    </li>
                  )}
              </ul>

              {filterRe && result.badChars.length > 0 && (
                <div className="mt-3 rounded-xl border border-white/10 bg-[#15171c] p-3">
                  <div className="font-mono text-[11px] text-white/35">
                    허용 안 되는 글자를 지우면 —{" "}
                    <span className="text-white/55">value.replace({filterRe}, &quot;&quot;)</span>
                  </div>
                  <div className="mt-1 font-mono text-sm break-all text-emerald-200/90">
                    {result
                      .chars!.filter((x) => x.ok)
                      .map((x) => x.ch)
                      .join("") || <span className="text-white/25">(빈 문자열)</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 여러 값 */}
        <div className={`${card} flex min-w-0 flex-col`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className={label}>여러 값 한 번에 (한 줄에 하나)</span>
            {c && batch && (
              <span className="font-mono text-xs">
                <span className="text-emerald-300">통과 {passCount}</span>
                <span className="text-white/25"> / </span>
                <span className="text-red-300">걸림 {batchResults.length - passCount}</span>
              </span>
            )}
          </div>
          <textarea
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={"값1\n값2\n값3"}
            className={`${box} h-[130px] resize-y p-3 leading-relaxed`}
          />
          <div className="mt-3 max-h-[320px] min-h-[80px] flex-1 overflow-auto rounded-xl border border-white/10 bg-[#15171c]">
            {batchResults.length === 0 || !batch ? (
              <p className="p-3 font-mono text-xs text-white/30">
                값을 줄마다 넣으면 한 번에 검사합니다.
              </p>
            ) : (
              <table className="w-full font-mono text-[12.5px]">
                <tbody>
                  {batchResults.map(({ l, r }, i) => (
                    <tr key={i} className="border-t border-white/5 align-top first:border-0">
                      <td
                        className={`w-6 px-3 py-1.5 ${r.ok ? "text-emerald-300" : "text-red-300"}`}
                      >
                        {r.ok ? "✓" : "✕"}
                      </td>
                      <td className="px-1 py-1.5 break-all text-white/85">
                        {l === "" ? <span className="text-white/25">(빈 값)</span> : l}
                      </td>
                      <td className="px-3 py-1.5 font-['Nanum_Gothic',sans-serif] text-[11.5px] text-white/40">
                        {shortReason(r)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
