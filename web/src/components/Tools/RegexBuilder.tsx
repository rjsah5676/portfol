"use client";

import { useState } from "react";
import {
  buildRegex,
  CHAR_GROUPS,
  codeFor,
  FORMATS,
  formatSamples,
  formatSource,
  REQUIRE,
  SPECIAL_PRESETS,
  type BuildOptions,
  type CharKey,
  type Hyphen,
  type RequireKey,
} from "@/lib/regexBuild";

const card = "rounded-2xl border border-white/10 bg-[#1C1E24] p-4";
const label = "font-mono text-xs text-white/40";
const box =
  "rounded-xl border border-white/10 bg-[#15171c] font-mono text-[13px] text-white/85 placeholder:text-white/20 focus:border-[#6C63FF]/50 focus:outline-none";

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`cursor-pointer rounded-full px-3 py-1.5 font-['Nanum_Gothic',sans-serif] text-xs transition-colors ${
        on ? "bg-[#6C63FF] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="cursor-pointer rounded-full border border-white/15 px-2.5 py-1 font-mono text-[11px] whitespace-nowrap text-white/60 transition-colors hover:border-[#6C63FF]/60 hover:text-white"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {}
      }}
    >
      {done ? "복사됨!" : "복사"}
    </button>
  );
}

function Output({
  source,
  filter,
  note,
  onTest,
}: {
  source: string;
  filter: string | null;
  note?: string;
  onTest: () => void;
}) {
  return (
    <div className={card}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={label}>결과</span>
        <button
          type="button"
          onClick={onTest}
          className="cursor-pointer rounded-full bg-[#6C63FF] px-3.5 py-1.5 font-['Nanum_Gothic',sans-serif] text-xs font-bold text-white transition-opacity hover:opacity-90"
        >
          검증 테스트에서 써보기 →
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {codeFor(source, filter).map((l) => (
          <div key={l.label} className="flex min-w-0 items-center gap-2">
            <span className="w-24 shrink-0 font-['Nanum_Gothic',sans-serif] text-[11px] text-white/40">
              {l.label}
            </span>
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-white/10 bg-[#15171c] px-3 py-2 font-mono text-[12.5px] whitespace-nowrap text-emerald-200/90">
              {l.code}
            </code>
            <CopyButton text={l.code} />
          </div>
        ))}
      </div>
      {note && (
        <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-xs leading-relaxed text-white/40">
          {note}
        </p>
      )}
    </div>
  );
}

export default function RegexBuilder({
  onTest,
}: {
  onTest: (pattern: string, samples?: string[]) => void;
}) {
  const [mode, setMode] = useState<"chars" | "format">("chars");
  const [opts, setOpts] = useState<BuildOptions>({
    chars: { lower: true, upper: true, digit: true, hangul: true, jamo: false, space: false },
    special: "",
    min: "2",
    max: "10",
    require: {
      letter: false,
      lower: false,
      upper: false,
      digit: false,
      hangul: false,
      special: false,
    },
    noTriple: false,
  });
  const [fmtKey, setFmtKey] = useState(FORMATS[0].key);
  const [hyphen, setHyphen] = useState<Hyphen>("optional");

  const built = buildRegex(opts);
  const fmt = FORMATS.find((f) => f.key === fmtKey)!;
  const fmtSource = formatSource(fmt, hyphen);

  const setChar = (k: CharKey) =>
    setOpts((o) => ({ ...o, chars: { ...o.chars, [k]: !o.chars[k] } }));
  const setReq = (k: RequireKey) =>
    setOpts((o) => ({ ...o, require: { ...o.require, [k]: !o.require[k] } }));

  return (
    <div>
      <div className="mb-4 flex w-fit overflow-hidden rounded-full border border-white/10 font-['Nanum_Gothic',sans-serif] text-sm">
        {(
          [
            ["chars", "허용 문자로 만들기"],
            ["format", "자주 쓰는 형식"],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            onClick={() => setMode(k)}
            className={`cursor-pointer px-4 py-2 ${
              mode === k ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {mode === "chars" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={`${card} flex flex-col gap-5`}>
            <div>
              <div className={`${label} mb-2`}>허용할 문자</div>
              <div className="flex flex-wrap gap-1.5">
                {CHAR_GROUPS.map((g) => (
                  <Chip key={g.key} on={opts.chars[g.key]} onClick={() => setChar(g.key)}>
                    {g.label}
                  </Chip>
                ))}
              </div>
              {opts.chars.hangul && !opts.chars.jamo && (
                <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-[11px] leading-relaxed text-white/35">
                  입력 중에 글자를 지우는 필터로 쓸 거면 &apos;한글 낱자&apos;도 켜세요. 조합 중인
                  ㄱ이 지워져서 한글이 안 써집니다.
                </p>
              )}
            </div>

            <div>
              <div className={`${label} mb-2`}>허용할 특수문자 (그대로 입력)</div>
              <input
                value={opts.special}
                onChange={(e) => setOpts((o) => ({ ...o, special: e.target.value }))}
                spellCheck={false}
                placeholder="예: _-.!@"
                aria-label="허용할 특수문자"
                className={`${box} w-full px-3 py-2`}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {SPECIAL_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() =>
                      setOpts((o) => ({
                        ...o,
                        special: [...new Set(Array.from(o.special + p.chars))].join(""),
                      }))
                    }
                    className="cursor-pointer rounded-md border border-white/10 px-2 py-0.5 font-mono text-[11px] text-white/60 hover:border-[#6C63FF]/50 hover:text-white"
                  >
                    + {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className={`${label} mb-2`}>길이 (비우면 제한 없음)</div>
              <div className="flex items-center gap-2 font-mono text-sm text-white/60">
                <input
                  value={opts.min}
                  onChange={(e) => setOpts((o) => ({ ...o, min: e.target.value }))}
                  inputMode="numeric"
                  aria-label="최소 길이"
                  className={`${box} w-20 px-3 py-2 text-center`}
                />
                ~
                <input
                  value={opts.max}
                  onChange={(e) => setOpts((o) => ({ ...o, max: e.target.value }))}
                  inputMode="numeric"
                  aria-label="최대 길이"
                  className={`${box} w-20 px-3 py-2 text-center`}
                />
                자
              </div>
            </div>

            <div>
              <div className={`${label} mb-2`}>반드시 1개 이상 포함</div>
              <div className="flex flex-wrap gap-1.5">
                {REQUIRE.map((r) => (
                  <Chip key={r.key} on={opts.require[r.key]} onClick={() => setReq(r.key)}>
                    {r.label}
                  </Chip>
                ))}
                <Chip
                  on={opts.noTriple}
                  onClick={() => setOpts((o) => ({ ...o, noTriple: !o.noTriple }))}
                >
                  같은 문자 3번 연속 금지
                </Chip>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            {built.error ? (
              <div className={`${card} font-['Nanum_Gothic',sans-serif] text-sm text-amber-200/80`}>
                {built.error}
              </div>
            ) : (
              <Output
                source={built.source}
                filter={built.filter}
                note="검사는 값 전체가 조건에 맞는지(제출할 때), 입력 필터는 허용 안 되는 글자를 바로 지울 때(입력할 때) 씁니다. 필터는 길이·포함 조건까지는 못 챙기니 제출 때 검사도 같이 하세요."
                onTest={() => onTest(built.source)}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div
            className={`${card} grid grid-cols-2 content-start gap-1.5 sm:grid-cols-3 lg:grid-cols-2`}
          >
            {FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFmtKey(f.key)}
                className={`cursor-pointer rounded-xl border px-3 py-2 text-left transition-colors ${
                  f.key === fmtKey
                    ? "border-[#6C63FF]/70 bg-[#6C63FF]/15"
                    : "border-white/5 bg-white/[0.03] hover:border-white/15"
                }`}
              >
                <div className="font-['Nanum_Gothic',sans-serif] text-sm text-white/90">
                  {f.label}
                </div>
                <div className="mt-0.5 truncate font-['Nanum_Gothic',sans-serif] text-[11px] text-white/35">
                  {f.desc}
                </div>
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {fmt.hyphen && (
              <div className={`${card} flex flex-wrap items-center gap-2`}>
                <span className={`${label} mr-1`}>하이픈(-)</span>
                {(
                  [
                    ["optional", "있어도 없어도"],
                    ["required", "꼭 있어야"],
                    ["none", "없어야"],
                  ] as const
                ).map(([k, t]) => (
                  <Chip key={k} on={hyphen === k} onClick={() => setHyphen(k)}>
                    {t}
                  </Chip>
                ))}
              </div>
            )}
            <Output
              source={fmtSource}
              filter={null}
              note={fmt.note}
              onTest={() => onTest(fmtSource, formatSamples(fmt, hyphen))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
