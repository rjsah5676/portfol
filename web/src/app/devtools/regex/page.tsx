import Link from "next/link";
import Faded from "@/components/Faded";
import RegexStudio from "@/components/Tools/RegexStudio";
import { pageMeta, SITE_NAME, SITE_URL } from "@/lib/seo";

const PATH = "/devtools/regex/";
const TITLE = "정규식 테스터";
const DESCRIPTION =
  "입력값 검증용 정규식을 붙여넣고 값을 쳐 보면 통과 여부와 걸리는 글자를 바로 보여줍니다. 허용 문자·길이·포함 조건을 골라 정규식과 JS/Java 코드를 만들고, 긴 텍스트 찾기·치환과 캡처 그룹, Java Pattern 코드 변환까지.";

export const metadata = {
  ...pageMeta({ title: TITLE, description: DESCRIPTION, path: PATH }),
  keywords: [
    "정규식 테스터",
    "정규표현식 테스트",
    "정규식 검사기",
    "regex tester",
    "자바 정규식",
    "Java Pattern",
    "정규식 치환",
    "정규식 캡처 그룹",
    "정규식 생성기",
    "입력값 검증 정규식",
    "한글 정규식",
  ],
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "어떤 정규식 문법을 쓰나요?",
    a: "브라우저의 JavaScript 정규식(ECMAScript)으로 실행합니다. 대부분의 문법은 Java와 같지만 몇 가지가 다릅니다. 아래 'JavaScript와 Java의 차이' 표를 참고하세요.",
  },
  {
    q: "Java 코드에 넣으려면 역슬래시를 두 번 써야 하잖아요.",
    a: "아래 Java 코드 영역이 \\d → \\\\d 처럼 자동으로 이스케이프한 문자열과 Pattern.compile 코드를 만들어 줍니다. 반대로 Java 소스에 있던 \"\\\\d+\" 를 그대로 붙여넣고 싶으면 'Java 문자열로 입력'을 켜세요.",
  },
  {
    q: "페이지가 멈추지 않나요?",
    a: "정규식은 별도 스레드(Web Worker)에서 실행하고, 1초 안에 끝나지 않으면 강제로 중단합니다. (a+)+$ 같은 중첩 반복은 입력이 조금만 길어도 계산량이 기하급수적으로 늘어나는데(재앙적 역추적), 서버에서 쓰면 ReDoS 공격 대상이 되니 이 경고가 뜨면 패턴을 고치는 게 좋습니다.",
  },
  {
    q: "입력한 내용이 서버로 전송되나요?",
    a: "아니요. 모든 계산은 브라우저 안에서 이루어지고, 마지막 입력값만 이 브라우저의 localStorage에 저장해 다음에 다시 열었을 때 복원합니다.",
  },
  {
    q: "g 플래그를 끄면 왜 하나만 나오나요?",
    a: "g(global)가 없으면 정규식은 첫 번째 매칭에서 멈춥니다. 치환도 첫 번째만 바뀝니다. Java로 치면 g가 있으면 while(matcher.find()) / replaceAll, 없으면 if(matcher.find()) / replaceFirst에 해당합니다.",
  },
];

const CHEATSHEET: [string, string, string][] = [
  ["\\d / \\D", "숫자 / 숫자가 아닌 것", "\\d{3} → 123"],
  ["\\w / \\W", "영문·숫자·_ / 그 외", "\\w+ → user_01"],
  ["\\s / \\S", "공백(스페이스·탭·줄바꿈) / 그 외", "a\\sb → a b"],
  [".", "줄바꿈을 제외한 아무 문자 (s 플래그면 줄바꿈 포함)", "a.c → abc, a1c"],
  ["[abc] / [^abc]", "괄호 안의 문자 하나 / 그 외", "[가-힣]+ → 한글"],
  ["* + ?", "0번 이상 / 1번 이상 / 0~1번", "colou?r → color, colour"],
  ["{n} {n,} {n,m}", "정확히 n번 / n번 이상 / n~m번", "\\d{2,4}"],
  ["*? +?", "게으른(최소) 반복", "<.+?> → 태그 하나씩"],
  ["^ $", "시작 / 끝 (m 플래그면 줄마다)", "^\\d+$ → 숫자만인 줄"],
  ["\\b", "단어 경계", "\\bcat\\b → cat (category는 X)"],
  ["( )", "캡처 그룹 → $1, $2", "(\\d+)-(\\d+)"],
  ["(?:  )", "캡처하지 않는 그룹", "(?:ab)+"],
  ["(?<name>  )", "이름 그룹 → $<name>", "(?<year>\\d{4})"],
  ["a|b", "또는", "jpg|png"],
  ["(?=  ) (?!  )", "전방 탐색 / 부정 전방 탐색", "\\d+(?=원) → 1000원의 1000"],
  ["(?<=  ) (?<!  )", "후방 탐색 / 부정 후방 탐색", "(?<=\\$)\\d+ → $50의 50"],
];

const DIFF: [string, string, string][] = [
  ["문자열 안 역슬래시", "/\\d+/ 그대로", '"\\\\d+" 두 번'],
  ["플래그", "/abc/gi", "Pattern.CASE_INSENSITIVE 등 상수"],
  ["전체 검색", "g 플래그", "while (matcher.find())"],
  ["이름 그룹 참조(치환)", "$<name>", "${name}"],
  ["소유 수량자 a*+, 원자 그룹 (?>)", "지원 안 함 (문법 오류)", "지원"],
  ["\\A \\Z (입력 시작/끝)", "지원 안 함", "지원"],
  ["matches() 전체 일치", "^...$ 로 직접", "matcher.matches()"],
];

const h2 = "mb-3 font-mono text-lg font-bold text-white";
const p = "font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/60";

function Table({ head, rows }: { head: string[]; rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[520px] text-left font-mono text-[12px]">
        <thead className="bg-white/5 text-white/50">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-white/75">
          {rows.map(([a, b, c]) => (
            <tr key={a} className="border-t border-white/5">
              <td className="px-3 py-2 whitespace-nowrap text-[#A9A3FF]">{a}</td>
              <td className="px-3 py-2 font-['Nanum_Gothic',sans-serif]">{b}</td>
              <td className="px-3 py-2 text-emerald-200/85">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RegexPage() {
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
          <h1 className="mt-1 font-mono text-2xl font-bold text-white">정규식 테스터</h1>
          <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-sm text-white/45">
            입력값 검증 정규식이 뭘 통과시키고 뭘 거르는지 확인하고, 조건을 골라 정규식을 만들고, 긴
            텍스트에서 찾고 바꿉니다.
          </p>
        </div>

        <RegexStudio />

        <div className="mt-16 grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-12">
          <section>
            <h2 className={h2}>사용법</h2>
            <ol className={`${p} list-decimal space-y-1.5 pl-5`}>
              <li>
                <b className="text-white/80">검증 테스트</b> — 폼 검증에 쓰는 정규식(/^[가-힣a-z]*$/
                같은)을 붙여넣고 값을 입력하면 통과 여부와 걸린 글자, 길이·포함 조건 중 뭐가
                틀렸는지 보여줍니다. 허용 문자 목록은 \uAC00 같은 코드도 사람 말로 풀어줍니다.
              </li>
              <li>
                &apos;입력 막기&apos;를 켜면 onChange에서 글자를 지우는 필터를 그대로 체험할 수
                있고, 여러 값을 줄마다 넣어 한 번에 검사할 수도 있습니다.
              </li>
              <li>
                <b className="text-white/80">정규식 만들기</b> — 허용할 문자·길이·필수 포함 조건을
                고르거나 휴대폰·이메일 같은 형식을 고르면 정규식과 JS/Java 검사·필터 코드가
                나옵니다.
              </li>
              <li>
                <b className="text-white/80">찾기·치환</b> — 로그나 텍스트에서 매칭을 하이라이트하고
                캡처 그룹, 치환 결과, Java Pattern 코드를 확인합니다.
              </li>
            </ol>
          </section>

          <section>
            <h2 className={h2}>자주 쓰는 문법</h2>
            <Table head={["문법", "의미", "예"]} rows={CHEATSHEET} />
          </section>

          <section>
            <h2 className={h2}>JavaScript와 Java의 차이</h2>
            <Table head={["항목", "JavaScript", "Java"]} rows={DIFF} />
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
            로그에서 쿼리를 뽑았다면{" "}
            <Link
              href="/devtools/mybatis-log/"
              className="text-[#A9A3FF] underline-offset-2 hover:underline"
            >
              MyBatis 로그 → SQL
            </Link>
            로 파라미터까지 채워보세요.
          </p>
        </div>
      </div>
    </Faded>
  );
}
