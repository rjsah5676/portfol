import Link from "next/link";
import Faded from "@/components/Faded";
import DdlTool from "@/components/Tools/DdlTool";
import { pageMeta, SITE_NAME, SITE_URL } from "@/lib/seo";

const PATH = "/devtools/ddl-to-java/";
const TITLE = "DDL → Java DTO · MyBatis resultMap 생성기";
const DESCRIPTION =
  "CREATE TABLE 문을 붙여넣으면 Java DTO(Lombok), MyBatis resultMap, Mapper XML(select·insert·update·delete)을 만들어줍니다. 컬럼 코멘트는 주석으로, 컬럼명은 camelCase로. snake_case ↔ camelCase 이름 변환도 지원. MySQL·MariaDB·PostgreSQL·Oracle.";

export const metadata = {
  ...pageMeta({ title: TITLE, description: DESCRIPTION, path: PATH }),
  keywords: [
    "DDL to Java",
    "DDL DTO 변환",
    "테이블 DTO 생성",
    "MyBatis resultMap 생성",
    "Mapper XML 생성",
    "snake_case camelCase 변환",
    "카멜케이스 변환",
    "Lombok DTO 생성",
    "create table to java class",
  ],
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "어떤 DDL을 넣으면 되나요?",
    a: "DB 툴에서 'Show CREATE TABLE'이나 'DDL 복사'로 뽑은 CREATE TABLE 문을 그대로 붙여넣으면 됩니다. 여러 테이블을 한 번에 넣어도 테이블마다 따로 만들어지고, 인덱스·외래키 줄은 알아서 건너뜁니다.",
  },
  {
    q: "컬럼 코멘트도 가져오나요?",
    a: "네. MySQL/MariaDB의 COMMENT '...'와 PostgreSQL/Oracle의 COMMENT ON COLUMN ... IS '...' 둘 다 읽어서 필드 위 Javadoc 주석으로 넣습니다. 테이블 코멘트는 클래스 주석이 됩니다.",
  },
  {
    q: "resultMap을 쓰면 mapUnderscoreToCamelCase는 필요 없나요?",
    a: "resultMap에 column과 property를 직접 짝지어 두면 그 설정 없이도 매핑됩니다. 반대로 mapUnderscoreToCamelCase=true를 켜 두었다면 resultMap 없이 resultType에 DTO를 바로 써도 되니, 필요한 쪽만 복사해서 쓰세요.",
  },
  {
    q: "INSERT·UPDATE에서 빠지는 컬럼이 있어요.",
    a: "AUTO_INCREMENT·IDENTITY·serial 컬럼, DEFAULT CURRENT_TIMESTAMP(now(), SYSDATE) 등록일, ON UPDATE CURRENT_TIMESTAMP 수정일은 DB가 채우도록 뺍니다. AUTO_INCREMENT가 있으면 insert에 useGeneratedKeys도 붙여줍니다.",
  },
  {
    q: "Oracle DATE가 LocalDateTime으로 나와요.",
    a: "Oracle의 DATE는 시·분·초까지 저장하는 타입이라 LocalDateTime으로 매핑합니다. VARCHAR2·NUMBER·CLOB처럼 Oracle 전용 타입이 있으면 Oracle DDL로 판단하고, 그 외에는 DATE를 LocalDate로 둡니다.",
  },
  {
    q: "컬럼명만 camelCase로 바꾸고 싶어요.",
    a: "CREATE TABLE 없이 컬럼명만 한 줄에 하나씩(또는 쉼표로) 넣으면 camelCase, PascalCase, snake_case, UPPER_SNAKE, kebab-case 변환표가 나옵니다. 열마다 복사 버튼이 있어서 엑셀 컬럼 목록을 바로 필드명으로 바꿀 수 있어요.",
  },
];

const TYPES: [string, string, string][] = [
  ["BIGINT, NUMBER(10~19)", "Long", "BIGINT"],
  ["INT, SMALLINT, NUMBER(1~9)", "Integer", "INTEGER"],
  ["TINYINT(1), BIT(1), BOOLEAN", "Boolean", "BOOLEAN"],
  ["DECIMAL, NUMERIC, NUMBER(p,s)", "BigDecimal", "DECIMAL"],
  ["VARCHAR, CHAR, TEXT, ENUM, JSON", "String", "VARCHAR"],
  ["CLOB", "String", "CLOB"],
  ["DATE", "LocalDate (Oracle: LocalDateTime)", "DATE"],
  ["DATETIME, TIMESTAMP", "LocalDateTime", "TIMESTAMP"],
  ["TIMESTAMP WITH TIME ZONE", "OffsetDateTime", "TIMESTAMP_WITH_TIMEZONE"],
  ["BLOB, BYTEA, VARBINARY", "byte[]", "BLOB"],
];

const BEFORE = `CREATE TABLE tb_notice (
  notice_id  BIGINT NOT NULL AUTO_INCREMENT COMMENT '공지 번호',
  title      VARCHAR(200) NOT NULL COMMENT '제목',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notice_id)
) COMMENT='공지사항';`;
const AFTER_DTO = `/** 공지사항 */
@Getter
@Setter
@NoArgsConstructor
@ToString
public class NoticeDto {
    /** 공지 번호 */
    private Long noticeId;

    /** 제목 */
    private String title;

    private LocalDateTime createdAt;
}`;
const AFTER_MAP = `<resultMap id="noticeResultMap" type="NoticeDto">
    <id property="noticeId" column="notice_id"/>
    <result property="title" column="title"/>
    <result property="createdAt" column="created_at"/>
</resultMap>`;

const h2 = "mb-3 font-mono text-lg font-bold text-white";
const p = "font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/60";
const pre =
  "overflow-x-auto rounded-xl border border-white/10 bg-[#15171c] p-4 font-mono text-[12.5px] leading-relaxed";

export default function DdlToJavaPage() {
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
          <h1 className="mt-1 font-mono text-2xl font-bold text-white">DDL → Java DTO · MyBatis</h1>
          <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-sm text-white/45">
            CREATE TABLE을 붙여넣으면 DTO, resultMap, Mapper XML까지 한 번에. 컬럼명만 넣으면
            camelCase ↔ snake_case 변환표가 나옵니다.
          </p>
        </div>

        <DdlTool />

        <div className="mt-16 grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-12">
          <section>
            <h2 className={h2}>사용법</h2>
            <ol className={`${p} list-decimal space-y-1.5 pl-5`}>
              <li>
                DBeaver·DataGrip·Workbench 등에서 테이블의 CREATE TABLE 문을 복사해 왼쪽에
                붙여넣습니다.
              </li>
              <li>위 탭에서 Java DTO, resultMap, Mapper XML, 매핑표 중 필요한 결과를 고릅니다.</li>
              <li>
                클래스 접미사(Dto·VO·Entity), Lombok 여부, 날짜 타입(LocalDateTime / Date),
                패키지명을 프로젝트에 맞게 바꿉니다. 설정은 다음에 와도 그대로 남아요.
              </li>
              <li>
                복사 버튼으로 가져가서 쓰면 끝. 여러 테이블이면 &lsquo;전체 복사&rsquo;로 한 번에.
              </li>
            </ol>
          </section>

          <section>
            <h2 className={h2}>변환 예시</h2>
            <p className={`${p} mb-3`}>입력 DDL</p>
            <pre className={`${pre} text-white/75`}>{BEFORE}</pre>
            <p className={`${p} mt-4 mb-3`}>Java DTO</p>
            <pre className={`${pre} text-emerald-200/85`}>{AFTER_DTO}</pre>
            <p className={`${p} mt-4 mb-3`}>MyBatis resultMap</p>
            <pre className={`${pre} text-emerald-200/85`}>{AFTER_MAP}</pre>
          </section>

          <section>
            <h2 className={h2}>DB 타입 → Java 타입 매핑</h2>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[520px] text-left font-mono text-[12px]">
                <thead className="bg-white/5 text-white/50">
                  <tr>
                    <th className="px-3 py-2 font-normal">DB 타입</th>
                    <th className="px-3 py-2 font-normal">Java</th>
                    <th className="px-3 py-2 font-normal">jdbcType</th>
                  </tr>
                </thead>
                <tbody className="text-white/75">
                  {TYPES.map(([db, java, jdbc]) => (
                    <tr key={db} className="border-t border-white/5">
                      <td className="px-3 py-2 text-white/50">{db}</td>
                      <td className="px-3 py-2 text-emerald-200/85">{java}</td>
                      <td className="px-3 py-2 text-sky-300/85">{jdbc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`${p} mt-3`}>
              wrapper 타입(Long, Integer)을 쓰는 건 NULL 컬럼을 0으로 오해하지 않기 위해서예요.
              날짜를 java.util.Date로 받는 옛 프로젝트라면 날짜 옵션을 Date로 바꾸면 됩니다.
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
            쿼리 로그에서 실제 실행된 SQL을 뽑을 땐{" "}
            <Link
              href="/devtools/mybatis-log/"
              className="text-[#A9A3FF] underline-offset-2 hover:underline"
            >
              MyBatis 로그 → SQL 변환기
            </Link>
            를 같이 써보세요.
          </p>
        </div>
      </div>
    </Faded>
  );
}
