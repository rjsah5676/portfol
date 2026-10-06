"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatDialect, mariadb, mysql, plsql, postgresql } from "sql-formatter";
import { parseLog, type Dialect } from "@/lib/mybatisLog";

const STORAGE_KEY = "devtools_mybatis_log";

export const MYBATIS_SAMPLE = `2026-09-30 21:03:11.512 DEBUG 1234 --- [nio-8080-exec-3] c.e.mapper.OrderMapper.selectOrders : ==>  Preparing: SELECT o.order_id, o.status, m.name FROM orders o JOIN member m ON m.member_id = o.member_id WHERE o.member_id = ? AND o.status IN (?, ?) AND o.created_at >= ? ORDER BY o.order_id DESC LIMIT ?
2026-09-30 21:03:11.513 DEBUG 1234 --- [nio-8080-exec-3] c.e.mapper.OrderMapper.selectOrders : ==> Parameters: 1024(Long), PAID(String), SHIPPED(String), 2026-09-01 00:00:00.0(Timestamp), 20(Integer)
2026-09-30 21:03:11.520 DEBUG 1234 --- [nio-8080-exec-3] c.e.mapper.OrderMapper.selectOrders : <==      Total: 3
2026-09-30 21:03:12.004 DEBUG 1234 --- [nio-8080-exec-4] c.e.mapper.MemberMapper.updateMemo : ==>  Preparing: UPDATE member SET memo = ?, marketing_yn = ?, updated_at = NOW() WHERE member_id = ?
2026-09-30 21:03:12.005 DEBUG 1234 --- [nio-8080-exec-4] c.e.mapper.MemberMapper.updateMemo : ==> Parameters: 오후 배송 요청, 문 앞(String), null, 1024(Long)
2026-09-30 21:03:12.011 DEBUG 1234 --- [nio-8080-exec-4] c.e.mapper.MemberMapper.updateMemo : <==    Updates: 1`;

const DIALECTS: { key: Dialect; label: string }[] = [
  { key: "mariadb", label: "MariaDB" },
  { key: "mysql", label: "MySQL" },
  { key: "postgresql", label: "PostgreSQL" },
  { key: "oracle", label: "Oracle" },
];
const FORMATTER = { mariadb, mysql, postgresql, oracle: plsql } as const;

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
const seg = (on: boolean) =>
  `cursor-pointer rounded-full px-3 py-1.5 font-mono text-xs transition-colors ${
    on ? "bg-[#6C63FF] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
  }`;

/** 문자열·숫자·NULL·주석만 가볍게 색칠 */
function highlight(sql: string): ReactNode[] {
  const re =
    /('(?:[^'\\]|''|\\.)*'|--[^\n]*|\/\*[\s\S]*?\*\/|\b\d+(?:\.\d+)?\b|\b(?:NULL|TRUE|FALSE|null|true|false)\b)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    if (m.index > last) out.push(sql.slice(last, m.index));
    const t = m[0];
    const cls = t.startsWith("'")
      ? "text-emerald-300"
      : t.startsWith("--") || t.startsWith("/*")
        ? "text-white/35"
        : /^\d/.test(t)
          ? "text-sky-300"
          : "text-amber-300";
    out.push(
      <span key={m.index} className={cls}>
        {t}
      </span>
    );
    last = m.index + t.length;
  }
  if (last < sql.length) out.push(sql.slice(last));
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

export default function MybatisLogTool() {
  const [input, setInput] = useState("");
  const [dialect, setDialect] = useState<Dialect>("mariadb");
  const [pretty, setPretty] = useState(true);
  const [upper, setUpper] = useState(true);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      /* eslint-disable react-hooks/set-state-in-effect -- 마지막 입력·설정 복원(마운트 1회) */
      if (saved?.input) setInput(saved.input);
      if (saved?.dialect) setDialect(saved.dialect);
      if (typeof saved?.pretty === "boolean") setPretty(saved.pretty);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
    // 저장된 값을 불러온 뒤부터 저장 (개발 모드에서 effect가 두 번 돌 때 기본값이 덮어쓰는 것 방지)
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (input.length < 500_000)
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ input, dialect, pretty }));
    } catch {}
  }, [hydrated, input, dialect, pretty]);

  const results = useMemo(() => {
    const stmts = parseLog(input, dialect);
    return stmts.map((s) => {
      let sql = s.filled;
      if (pretty) {
        try {
          sql = formatDialect(s.filled, {
            dialect: FORMATTER[dialect],
            keywordCase: upper ? "upper" : "preserve",
            tabWidth: 2,
          });
        } catch {
          // 포매터가 못 읽는 문법이면 채운 SQL 그대로
        }
      }
      return { ...s, out: sql.trim().replace(/;?\s*$/, ";") };
    });
  }, [input, dialect, pretty, upper]);

  const all = results.map((r) => r.out).join("\n\n");
  const noMatch = input.trim() !== "" && results.length === 0;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-1">
          {DIALECTS.map((d) => (
            <button
              key={d.key}
              type="button"
              className={seg(dialect === d.key)}
              onClick={() => setDialect(d.key)}
            >
              {d.label}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-xs text-white/60">
          <input
            type="checkbox"
            checked={pretty}
            onChange={(e) => setPretty(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#6C63FF]"
          />
          줄 정리
        </label>
        {pretty && (
          <label className="flex cursor-pointer items-center gap-1.5 font-mono text-xs text-white/60">
            <input
              type="checkbox"
              checked={upper}
              onChange={(e) => setUpper(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#6C63FF]"
            />
            키워드 대문자
          </label>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 입력 */}
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-white/40">MyBatis 로그</span>
            <span className="flex gap-1.5">
              <button type="button" className={btn} onClick={() => setInput(MYBATIS_SAMPLE)}>
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
            placeholder={
              "==>  Preparing: SELECT * FROM member WHERE id = ? AND name = ?\n==> Parameters: 1(Long), 건모(String)"
            }
            className="h-[42vh] min-h-[260px] w-full resize-y rounded-xl border border-white/10 bg-[#15171c] p-4 font-mono text-[12.5px] leading-relaxed text-white/85 placeholder:text-white/20 focus:border-[#6C63FF]/50 focus:outline-none lg:h-[60vh]"
          />
        </div>

        {/* 결과 */}
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-white/40">
              실행 SQL{" "}
              {results.length > 0 && <span className="text-white/25">· {results.length}개</span>}
            </span>
            {results.length > 1 && <CopyButton text={all} label="전체 복사" />}
          </div>
          <div className="flex h-[42vh] min-h-[260px] flex-col gap-3 overflow-auto rounded-xl border border-white/10 bg-[#15171c] p-3 lg:h-[60vh]">
            {results.length === 0 ? (
              <p className="p-1 font-mono text-xs leading-relaxed text-white/30">
                {noMatch
                  ? "Preparing: 줄을 찾지 못했습니다. MyBatis 로그의 ==> Preparing / ==> Parameters 두 줄을 함께 붙여넣어 주세요."
                  : "왼쪽에 로그를 붙여넣으면 파라미터가 채워진 SQL이 여기에 나옵니다."}
              </p>
            ) : (
              results.map((r, k) => (
                <div key={k} className="rounded-lg border border-white/10 bg-[#1C1E24]">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
                      <span className="truncate text-[#A9A3FF]" title={r.mapper ?? undefined}>
                        {r.mapper ? r.mapper.split(".").slice(-2).join(".") : `#${k + 1}`}
                      </span>
                      <span className="text-white/35">파라미터 {r.params.length}</span>
                      {r.result && <span className="text-white/35">{r.result}</span>}
                    </span>
                    <CopyButton text={r.out} />
                  </div>
                  {r.warnings.map((w) => (
                    <p
                      key={w}
                      className="border-b border-white/5 px-3 py-1.5 font-mono text-[11px] text-amber-300/85"
                    >
                      ⚠ {w}
                    </p>
                  ))}
                  <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre text-white/85">
                    {highlight(r.out)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
