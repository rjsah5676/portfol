"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  className as dtoClassName,
  genDto,
  genMapper,
  genResultMap,
  isOracle,
  javaType,
  jdbcType,
  looksLikeDdl,
  parseDdl,
  toCamel,
  toKebab,
  toPascal,
  toSnake,
  toUpperSnake,
  type GenOptions,
  type Suffix,
} from "@/lib/ddlToJava";

const STORAGE_KEY = "devtools_ddl_java";

export const DDL_SAMPLE = `CREATE TABLE tb_member (
  member_id    BIGINT       NOT NULL AUTO_INCREMENT COMMENT '회원 번호',
  login_id     VARCHAR(50)  NOT NULL COMMENT '로그인 아이디',
  member_name  VARCHAR(30)  NOT NULL COMMENT '이름',
  point_amt    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '보유 포인트',
  marketing_yn TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '마케팅 수신 동의',
  birth_date   DATE         NULL COMMENT '생년월일',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '가입일',
  updated_at   DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일',
  PRIMARY KEY (member_id),
  UNIQUE KEY uk_member_login_id (login_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='회원';`;

type Tab = "dto" | "resultMap" | "mapper" | "map";
const TABS: { key: Tab; label: string }[] = [
  { key: "dto", label: "Java DTO" },
  { key: "resultMap", label: "resultMap" },
  { key: "mapper", label: "Mapper XML" },
  { key: "map", label: "매핑표" },
];
const SUFFIXES: { key: Suffix; label: string }[] = [
  { key: "", label: "없음" },
  { key: "Dto", label: "Dto" },
  { key: "VO", label: "VO" },
  { key: "Entity", label: "Entity" },
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

/** Java·XML 가볍게 색칠: 주석, 문자열, 어노테이션, 키워드/태그 */
function highlight(code: string): ReactNode[] {
  const re =
    /(\/\*\*?[\s\S]*?\*\/|<!--[\s\S]*?-->|"[^"\n]*"|@\w+|#\{[^}]*\}|<\/?[\w:]+|\/?>|\b(?:package|import|public|private|class|void|return|this)\b)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const t = m[0];
    const cls =
      t.startsWith("/*") || t.startsWith("<!--")
        ? "text-white/35"
        : t.startsWith('"')
          ? "text-emerald-300"
          : t.startsWith("@")
            ? "text-amber-300"
            : t.startsWith("#{")
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

const NAME_CASES: { label: string; fn: typeof toCamel }[] = [
  { label: "camelCase", fn: toCamel },
  { label: "PascalCase", fn: toPascal },
  { label: "snake_case", fn: toSnake },
  { label: "UPPER_SNAKE", fn: toUpperSnake },
  { label: "kebab-case", fn: toKebab },
];

export default function DdlTool() {
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<Tab>("dto");
  const [opt, setOpt] = useState<GenOptions>({
    pkg: "",
    suffix: "Dto",
    stripPrefix: true,
    lombok: true,
    dates: "time",
    withJdbcType: false,
  });
  const set = <K extends keyof GenOptions>(k: K, v: GenOptions[K]) =>
    setOpt((o) => ({ ...o, [k]: v }));

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      /* eslint-disable react-hooks/set-state-in-effect -- 마지막 입력·설정 복원(마운트 1회) */
      if (typeof saved?.input === "string") setInput(saved.input);
      if (saved?.tab) setTab(saved.tab);
      if (saved?.opt) setOpt((o) => ({ ...o, ...saved.opt }));
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
    // 저장된 값을 불러온 뒤부터 저장 (개발 모드에서 effect가 두 번 돌 때 기본값이 덮어쓰는 것 방지)
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (input.length < 500_000)
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ input, tab, opt }));
    } catch {}
  }, [hydrated, input, tab, opt]);

  const ddlMode = looksLikeDdl(input);
  const tables = useMemo(() => (ddlMode ? parseDdl(input) : []), [input, ddlMode]);
  const oracle = useMemo(() => isOracle(tables), [tables]);

  const outputs = useMemo(
    () =>
      tables.map((t) => ({
        t,
        code:
          tab === "dto"
            ? genDto(t, opt, oracle)
            : tab === "resultMap"
              ? genResultMap(t, opt, oracle)
              : tab === "mapper"
                ? genMapper(t, opt, oracle)
                : "",
      })),
    [tables, tab, opt, oracle]
  );

  // DDL이 아니면 이름 목록으로 보고 케이스 변환
  const names = useMemo(
    () =>
      ddlMode
        ? []
        : input
            .split(/[\n,\t]+/)
            .map((s) => s.trim().replace(/^[`"[]|[`"\]]$/g, ""))
            .filter((s) => s && s.length <= 200),
    [input, ddlMode]
  );

  return (
    <div>
      {/* 옵션 */}
      <div className="mb-4 flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-1">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              className={seg(tab === x.key)}
              onClick={() => setTab(x.key)}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-[11px] text-white/35">날짜</span>
            <button
              type="button"
              className={seg(opt.dates === "time")}
              onClick={() => set("dates", "time")}
            >
              LocalDateTime
            </button>
            <button
              type="button"
              className={seg(opt.dates === "legacy")}
              onClick={() => set("dates", "legacy")}
            >
              Date
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className={check}>
            <input
              type="checkbox"
              className={box}
              checked={opt.lombok}
              onChange={(e) => set("lombok", e.target.checked)}
            />
            Lombok
          </label>
          <label className={check}>
            <input
              type="checkbox"
              className={box}
              checked={opt.stripPrefix}
              onChange={(e) => set("stripPrefix", e.target.checked)}
            />
            tb_ 접두어 제거
          </label>
          <label className={check}>
            <input
              type="checkbox"
              className={box}
              checked={opt.withJdbcType}
              onChange={(e) => set("withJdbcType", e.target.checked)}
            />
            jdbcType 표기
          </label>
          <input
            value={opt.pkg}
            onChange={(e) => set("pkg", e.target.value.replace(/[^\w.]/g, ""))}
            placeholder="패키지 (com.example.domain)"
            spellCheck={false}
            className="w-full min-w-0 rounded-full border border-white/10 bg-[#15171c] px-3 py-1.5 font-mono text-xs text-white/85 placeholder:text-white/25 focus:border-[#6C63FF]/50 focus:outline-none sm:w-64"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 입력 */}
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-white/40">CREATE TABLE 또는 컬럼명 목록</span>
            <span className="flex gap-1.5">
              <button type="button" className={btn} onClick={() => setInput(DDL_SAMPLE)}>
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
            placeholder={
              "CREATE TABLE tb_member (\n  member_id BIGINT NOT NULL AUTO_INCREMENT,\n  ...\n);\n\n또는 컬럼명만 한 줄에 하나씩\nmember_id\nloginId"
            }
            className="h-[42vh] min-h-[260px] w-full resize-y rounded-xl border border-white/10 bg-[#15171c] p-4 font-mono text-[12.5px] leading-relaxed text-white/85 placeholder:text-white/20 focus:border-[#6C63FF]/50 focus:outline-none lg:h-[60vh]"
          />
        </div>

        {/* 결과 */}
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-white/40">
              {ddlMode ? "결과" : "이름 변환"}{" "}
              {ddlMode && tables.length > 0 && (
                <span className="text-white/25">· 테이블 {tables.length}개</span>
              )}
              {!ddlMode && names.length > 0 && (
                <span className="text-white/25">· {names.length}개</span>
              )}
            </span>
            {ddlMode && outputs.length > 1 && tab !== "map" && (
              <CopyButton text={outputs.map((x) => x.code).join("\n\n")} label="전체 복사" />
            )}
          </div>
          <div className="flex h-[42vh] min-h-[260px] flex-col gap-3 overflow-auto rounded-xl border border-white/10 bg-[#15171c] p-3 lg:h-[60vh]">
            {!input.trim() ? (
              <p className="p-1 font-mono text-xs leading-relaxed text-white/30">
                왼쪽에 CREATE TABLE 문을 붙여넣으면 DTO·resultMap·Mapper XML이 나옵니다. 컬럼명만
                넣으면 camelCase·snake_case 변환표가 나와요.
              </p>
            ) : ddlMode && tables.length === 0 ? (
              <p className="p-1 font-mono text-xs leading-relaxed text-white/30">
                CREATE TABLE 문에서 컬럼을 찾지 못했습니다. 괄호가 닫혔는지 확인해주세요.
              </p>
            ) : ddlMode ? (
              outputs.map(({ t, code }) => (
                <div key={t.name} className="rounded-lg border border-white/10 bg-[#1C1E24]">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
                      <span className="text-[#A9A3FF]">{dtoClassName(t, opt)}</span>
                      <span className="text-white/35">
                        {t.name} · 컬럼 {t.columns.length}
                        {t.comment && ` · ${t.comment}`}
                      </span>
                    </span>
                    {tab !== "map" && <CopyButton text={code} />}
                  </div>
                  {tab === "map" ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px] text-left font-mono text-[11.5px]">
                        <thead className="text-white/40">
                          <tr>
                            <th className="px-3 py-1.5 font-normal">컬럼</th>
                            <th className="px-3 py-1.5 font-normal">필드</th>
                            <th className="px-3 py-1.5 font-normal">Java</th>
                            <th className="px-3 py-1.5 font-normal">jdbcType</th>
                            <th className="px-3 py-1.5 font-normal">설명</th>
                          </tr>
                        </thead>
                        <tbody className="text-white/80">
                          {t.columns.map((c) => (
                            <tr key={c.name} className="border-t border-white/5">
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                {c.name}
                                {c.pk && <span className="ml-1.5 text-amber-300">PK</span>}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-[#A9A3FF]">
                                {toCamel(c.name)}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-emerald-300">
                                {javaType(c, opt.dates, oracle).name}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-sky-300">
                                {jdbcType(c, oracle)}
                              </td>
                              <td className="px-3 py-1.5 text-white/45">{c.comment}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre text-white/85">
                      {highlight(code)}
                    </pre>
                  )}
                </div>
              ))
            ) : (
              <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#1C1E24]">
                <table className="w-full min-w-[560px] text-left font-mono text-[11.5px]">
                  <thead className="text-white/40">
                    <tr>
                      {NAME_CASES.map((c) => (
                        <th key={c.label} className="px-3 py-2 font-normal">
                          <span className="flex items-center gap-2">
                            {c.label}
                            <CopyButton text={names.map(c.fn).join("\n")} />
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-white/80">
                    {names.map((n, i) => (
                      <tr key={i} className="border-t border-white/5">
                        {NAME_CASES.map((c) => (
                          <td key={c.label} className="px-3 py-1.5 whitespace-nowrap">
                            {c.fn(n)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
