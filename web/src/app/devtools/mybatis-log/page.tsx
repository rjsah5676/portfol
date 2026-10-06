import Link from "next/link";
import Faded from "@/components/Faded";
import MybatisLogTool from "@/components/Tools/MybatisLogTool";
import { pageMeta, SITE_NAME, SITE_URL } from "@/lib/seo";

const PATH = "/devtools/mybatis-log/";
const TITLE = "MyBatis 로그 SQL 변환기";
const DESCRIPTION =
  "MyBatis 로그의 ==> Preparing / ==> Parameters 줄을 붙여넣으면 ? 자리에 파라미터를 채운 실행 가능한 SQL로 바꿔줍니다. MySQL·MariaDB·PostgreSQL·Oracle, 여러 쿼리 한 번에, 줄 정리까지.";

export const metadata = {
  ...pageMeta({ title: TITLE, description: DESCRIPTION, path: PATH }),
  keywords: [
    "MyBatis 로그",
    "MyBatis SQL 변환",
    "MyBatis 쿼리 로그",
    "Preparing Parameters",
    "파라미터 바인딩",
    "물음표 치환",
    "SQL 파라미터 채우기",
    "mybatis log to sql",
    "mybatis log parser",
  ],
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "어떤 로그를 붙여넣으면 되나요?",
    a: "MyBatis가 DEBUG 레벨에서 찍는 '==>  Preparing:' 줄과 바로 다음 '==> Parameters:' 줄이면 됩니다. 날짜·스레드·로거 이름 같은 앞부분은 그대로 둬도 되고, 여러 쿼리가 섞인 로그를 통째로 붙여넣어도 쿼리별로 나눠서 변환합니다.",
  },
  {
    q: "로그 자체가 안 찍혀요.",
    a: "Mapper 인터페이스 패키지의 로그 레벨을 DEBUG로 올리면 됩니다. Spring Boot라면 application.yml에 logging.level.<mapper 패키지>: DEBUG 를 추가하세요. MyBatis 설정의 logImpl을 STDOUT_LOGGING으로 두는 방법도 있습니다.",
  },
  {
    q: "타입별로 값은 어떻게 들어가나요?",
    a: "Integer·Long·BigDecimal 같은 숫자 타입은 따옴표 없이, String·Timestamp 등 나머지는 작은따옴표로 감쌉니다. null은 NULL, Boolean은 TRUE/FALSE(Oracle은 1/0)로 바뀝니다. 값 안의 작은따옴표는 ''로 이스케이프합니다.",
  },
  {
    q: "SQL 안의 문자열이나 주석에 있는 ?도 바뀌나요?",
    a: "아니요. 작은따옴표·큰따옴표·백틱 문자열과 -- , /* */ 주석 안의 ?는 건너뛰고 실제 바인딩 자리만 채웁니다.",
  },
  {
    q: "?와 파라미터 개수가 다르다고 나와요.",
    a: "로그가 중간에 잘렸거나, 멀티스레드 환경에서 다른 요청의 로그 줄과 섞인 경우가 대부분입니다. 같은 스레드 이름의 Preparing/Parameters 두 줄만 골라서 다시 붙여넣어 보세요. 남는 ?는 그대로 둡니다.",
  },
];

const RULES: [string, string, string][] = [
  ["Integer, Long, BigDecimal …", "1024(Long)", "1024"],
  ["String", "PAID(String)", "'PAID'"],
  ["작은따옴표 포함", "O'Brien(String)", "'O''Brien'"],
  ["null", "null", "NULL"],
  ["Boolean", "true(Boolean)", "TRUE  (Oracle: 1)"],
  ["Timestamp", "2026-09-01 00:00:00.0(Timestamp)", "'2026-09-01 00:00:00.0'"],
  [
    "Timestamp (Oracle)",
    "2026-09-01 00:00:00.0(Timestamp)",
    "TO_TIMESTAMP('…', 'YYYY-MM-DD HH24:MI:SS.FF')",
  ],
  ["Date / LocalDate (Oracle)", "2026-09-01(LocalDate)", "TO_DATE('2026-09-01', 'YYYY-MM-DD')"],
];

const BEFORE = `==>  Preparing: SELECT * FROM member WHERE member_id = ? AND status = ? AND deleted_at IS ?
==> Parameters: 1024(Long), ACTIVE(String), null`;
const AFTER = `SELECT * FROM member WHERE member_id = 1024 AND status = 'ACTIVE' AND deleted_at IS NULL;`;

const h2 = "mb-3 font-mono text-lg font-bold text-white";
const p = "font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/60";
const code = "rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px] text-white/80";

export default function MybatisLogPage() {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: TITLE,
      url: `${SITE_URL}${PATH}`,
      description: DESCRIPTION,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any (web browser)",
      inLanguage: "ko",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
      author: { "@id": `${SITE_URL}/#person` },
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_URL },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];

  return (
    <Faded>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-6xl px-4 pt-12 pb-24 sm:px-6">
        <div className="mb-6">
          <div className="font-mono text-sm text-[#8B84FF]">devtools</div>
          <h1 className="mt-1 font-mono text-2xl font-bold text-white">
            MyBatis 로그 → SQL 변환기
          </h1>
          <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-sm text-white/45">
            <span className="font-mono text-white/60">Preparing</span> /{" "}
            <span className="font-mono text-white/60">Parameters</span> 로그를 붙여넣으면 ? 자리에
            값을 채운 실행 가능한 SQL로 바꿔줍니다.
          </p>
        </div>

        <MybatisLogTool />

        <div className="mt-16 grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-12">
          <section>
            <h2 className={h2}>사용법</h2>
            <ol className={`${p} list-decimal space-y-1.5 pl-5`}>
              <li>
                콘솔이나 로그 파일에서 <code className={code}>==&gt; Preparing:</code> 줄과{" "}
                <code className={code}>==&gt; Parameters:</code> 줄을 복사합니다. 앞의
                시간·스레드·로거 이름은 지우지 않아도 됩니다.
              </li>
              <li>
                왼쪽 입력창에 붙여넣으면 오른쪽에 바로 SQL이 나옵니다. 여러 쿼리를 한꺼번에 넣어도
                됩니다.
              </li>
              <li>
                DB 종류(MySQL·MariaDB·PostgreSQL·Oracle)를 고르면 날짜·불리언·이스케이프 규칙이
                맞춰집니다.
              </li>
              <li>
                복사 버튼으로 DBeaver, DataGrip, SQL Developer 등에 붙여넣어 바로 실행해보세요.
              </li>
            </ol>
          </section>

          <section>
            <h2 className={h2}>변환 예시</h2>
            <p className={`${p} mb-3`}>MyBatis 로그 (입력)</p>
            <pre className="overflow-x-auto rounded-xl border border-white/10 bg-[#15171c] p-4 font-mono text-[12.5px] leading-relaxed text-white/75">
              {BEFORE}
            </pre>
            <p className={`${p} mt-4 mb-3`}>변환된 SQL (결과)</p>
            <pre className="overflow-x-auto rounded-xl border border-white/10 bg-[#15171c] p-4 font-mono text-[12.5px] leading-relaxed text-emerald-200/85">
              {AFTER}
            </pre>
          </section>

          <section>
            <h2 className={h2}>파라미터 타입별 변환 규칙</h2>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[520px] text-left font-mono text-[12px]">
                <thead className="bg-white/5 text-white/50">
                  <tr>
                    <th className="px-3 py-2 font-normal">타입</th>
                    <th className="px-3 py-2 font-normal">로그</th>
                    <th className="px-3 py-2 font-normal">SQL</th>
                  </tr>
                </thead>
                <tbody className="text-white/75">
                  {RULES.map(([t, log, sql]) => (
                    <tr key={t} className="border-t border-white/5">
                      <td className="px-3 py-2 text-white/50">{t}</td>
                      <td className="px-3 py-2">{log}</td>
                      <td className="px-3 py-2 text-emerald-200/85">{sql}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`${p} mt-3`}>
              MySQL·MariaDB는 문자열 안의 역슬래시(<code className={code}>\</code>)도
              이스케이프합니다. byte[] 같은 바이너리 값은 로그에 내용이 남지 않아 경고로 알려드려요.
            </p>
          </section>

          <section>
            <h2 className={h2}>자주 묻는 질문</h2>
            <div className="space-y-2">
              {FAQ.map((f) => (
                <details
                  key={f.q}
                  className="group rounded-xl border border-white/10 bg-[#1C1E24] px-4 py-3"
                >
                  <summary className="cursor-pointer list-none font-['Nanum_Gothic',sans-serif] text-sm text-white/85 marker:hidden">
                    <span className="mr-2 font-mono text-[#8B84FF]">Q.</span>
                    {f.q}
                  </summary>
                  <p className={`${p} mt-2`}>{f.a}</p>
                </details>
              ))}
            </div>
          </section>

          <p className={p}>
            JSON 응답을 확인할 땐{" "}
            <Link
              href="/devtools/json/"
              className="text-[#A9A3FF] underline-offset-2 hover:underline"
            >
              JSON Formatter
            </Link>
            도 같이 써보세요.
          </p>
        </div>
      </div>
    </Faded>
  );
}
