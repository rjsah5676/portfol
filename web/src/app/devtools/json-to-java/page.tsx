import Link from "next/link";
import Faded from "@/components/Faded";
import JsonToJavaTool from "@/components/Tools/JsonToJavaTool";
import { pageMeta, SITE_NAME, SITE_URL } from "@/lib/seo";

const PATH = "/devtools/json-to-java/";
const TITLE = "JSON → Java DTO 클래스 변환기";
const DESCRIPTION =
  "API 응답 JSON을 붙여넣으면 Java DTO 클래스를 만들어줍니다. 중첩 객체는 내부 클래스로, 배열은 List<>로, snake_case 키는 camelCase 필드 + @JsonProperty로. Lombok·getter/setter·record 지원.";

export const metadata = {
  ...pageMeta({ title: TITLE, description: DESCRIPTION, path: PATH }),
  keywords: [
    "JSON to Java",
    "JSON Java 클래스 변환",
    "JSON DTO 변환",
    "JSON DTO 생성",
    "json to java class",
    "json to pojo",
    "Jackson DTO",
    "Lombok DTO 생성",
    "Java record 생성",
  ],
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "숫자 타입은 어떻게 정해지나요?",
    a: "소수점이 없으면 Integer, int 범위를 넘거나 키 이름이 id·Id·_id·No로 끝나면 Long입니다. 소수점이 있으면 옵션에 따라 BigDecimal 또는 Double이 됩니다. 배열 안에서 1과 2.5가 섞여 있으면 소수 타입으로 맞춥니다.",
  },
  {
    q: "배열 안 객체마다 키가 달라요.",
    a: "배열의 모든 원소를 훑어서 키를 합칩니다. 어떤 원소에만 있는 키도 필드로 들어가니, 첫 번째 원소만 보고 만드는 도구처럼 필드가 빠지지 않습니다.",
  },
  {
    q: "@JsonProperty는 언제 붙나요?",
    a: "JSON 키와 Java 필드명이 다를 때만 붙습니다. order_id → orderId처럼 snake_case를 camelCase로 바꾸거나, class·3d처럼 Java에서 쓸 수 없는 이름을 바꾼 경우입니다. 프로젝트에서 PropertyNamingStrategies.SNAKE_CASE를 쓰고 있다면 옵션을 끄면 됩니다.",
  },
  {
    q: "null 값은 어떤 타입이 되나요?",
    a: "값만으로는 타입을 알 수 없어서 Object로 둡니다. 배열의 다른 원소에 실제 값이 있으면 그 타입을 따릅니다. 실제 응답에서 값이 채워진 예시를 넣을수록 정확해져요.",
  },
  {
    q: "날짜는 어떻게 처리되나요?",
    a: "2026-09-30은 LocalDate, 2026-09-30T21:03:11은 LocalDateTime, 끝에 Z나 +09:00이 붙으면 OffsetDateTime으로 바꿉니다. Spring Boot는 Jackson JavaTimeModule이 기본으로 들어 있어서 그대로 역직렬화됩니다. 공백으로 구분된 형식은 @JsonFormat이 필요해서 String으로 둡니다.",
  },
  {
    q: "record로 만들어도 Jackson이 읽나요?",
    a: "Jackson 2.12 이상(Spring Boot 2.5 이상)이면 record를 바로 역직렬화합니다. 이 경우 @JsonProperty는 생성자 파라미터에 붙어서 나옵니다.",
  },
];

const RULES: [string, string][] = [
  ['"PAID"', "String"],
  ["1024", "Integer (id·No 계열, int 범위 초과면 Long)"],
  ["35000.5", "BigDecimal 또는 Double"],
  ["true", "Boolean"],
  ['"2026-09-30T21:03:11"', "LocalDateTime"],
  ["{ … }", "내부 static class (키 이름으로 클래스명)"],
  ['["a", "b"]', "List<String>"],
  ["[{ … }, { … }]", "List<Item> (items → Item 단수형)"],
  ["null, []", "Object, List<Object>"],
];

const BEFORE = `{
  "order_id": 1024,
  "buyer": { "member_id": 7, "name": "이건모" },
  "items": [{ "product_no": 11, "qty": 1 }]
}`;
const AFTER = `@Getter
@Setter
@NoArgsConstructor
@ToString
public class OrderDto {
    @JsonProperty("order_id")
    private Long orderId;

    private BuyerDto buyer;

    private List<ItemDto> items;

    @Getter @Setter @NoArgsConstructor @ToString
    public static class BuyerDto {
        @JsonProperty("member_id")
        private Long memberId;

        private String name;
    }

    @Getter @Setter @NoArgsConstructor @ToString
    public static class ItemDto {
        @JsonProperty("product_no")
        private Long productNo;

        private Integer qty;
    }
}`;

const h2 = "mb-3 font-mono text-lg font-bold text-white";
const p = "font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/60";
const pre =
  "overflow-x-auto rounded-xl border border-white/10 bg-[#15171c] p-4 font-mono text-[12.5px] leading-relaxed";
const link = "text-[#A9A3FF] underline-offset-2 hover:underline";

export default function JsonToJavaPage() {
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
          <h1 className="mt-1 font-mono text-2xl font-bold text-white">JSON → Java DTO</h1>
          <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-sm text-white/45">
            API 응답 JSON을 붙여넣으면 중첩 객체·배열까지 Java 클래스로 만들어줍니다.
          </p>
        </div>

        <JsonToJavaTool />

        <div className="mt-16 grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-12">
          <section>
            <h2 className={h2}>사용법</h2>
            <ol className={`${p} list-decimal space-y-1.5 pl-5`}>
              <li>
                Postman·브라우저 개발자도구·로그에서 API 응답 JSON을 복사해 왼쪽에 붙여넣습니다.
              </li>
              <li>
                Lombok / getter·setter / record 중 스타일을 고르고, 클래스 이름·접미사·패키지를
                프로젝트에 맞춥니다.
              </li>
              <li>
                하위 객체를 루트 안의 static 내부 클래스로 둘지, 클래스마다 파일을 나눌지 고릅니다.
                설정은 다음에 와도 그대로 남아요.
              </li>
              <li>
                복사해서 붙여넣으면 끝. JSON 문법이 틀리면 몇 번째 줄 몇 번째 칸인지 알려드립니다.
              </li>
            </ol>
          </section>

          <section>
            <h2 className={h2}>변환 예시</h2>
            <p className={`${p} mb-3`}>입력 JSON</p>
            <pre className={`${pre} text-white/75`}>{BEFORE}</pre>
            <p className={`${p} mt-4 mb-3`}>Java DTO (Lombok, 접미사 Dto)</p>
            <pre className={`${pre} text-emerald-200/85`}>{AFTER}</pre>
          </section>

          <section>
            <h2 className={h2}>JSON 값 → Java 타입 규칙</h2>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[480px] text-left font-mono text-[12px]">
                <thead className="bg-white/5 text-white/50">
                  <tr>
                    <th className="px-3 py-2 font-normal">JSON 값</th>
                    <th className="px-3 py-2 font-normal">Java 타입</th>
                  </tr>
                </thead>
                <tbody className="text-white/75">
                  {RULES.map(([json, java]) => (
                    <tr key={json} className="border-t border-white/5">
                      <td className="px-3 py-2 text-white/60">{json}</td>
                      <td className="px-3 py-2 text-emerald-200/85">{java}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            JSON이 한 줄로 뭉쳐 있다면{" "}
            <Link href="/devtools/json/" className={link}>
              JSON Formatter
            </Link>
            로 먼저 정리하고, DB 테이블에서 DTO를 만들 땐{" "}
            <Link href="/devtools/ddl-to-java/" className={link}>
              DDL → Java DTO
            </Link>
            를 써보세요.
          </p>
        </div>
      </div>
    </Faded>
  );
}
