import Link from "next/link";
import Faded from "@/components/Faded";
import HangulApp from "@/components/Hangul/HangulApp";
import { pageMeta, SITE_NAME, SITE_URL } from "@/lib/seo";
import "@/css/hangul.css";

/*
 * 니들이 한글을 알아? — 게임은 클라이언트(HangulApp), 이 파일은 서버에서 그려서 검색엔진이 읽는 부분:
 *  메타데이터 · 구조화 데이터(VideoGame, FAQPage) · 게임 아래 설명 글(플레이 방법 · 등급 · 랭킹 · 자주 묻는 질문)
 * 문장 판정은 서버의 형태소 분석기(Kiwi) — 운영은 kiwi 컨테이너(KIWI_URL), 개발은 server 에서 `npm run kiwi:model`
 */

const PATH = "/games/hangul/";
const NAME = "니들이 한글을 알아?";
const TITLE = "니들이 한글을 알아? - 자모로 문장 만들기 한글 디펜스 게임";
const DESCRIPTION =
  "자음 · 모음을 합쳐 글자를 만들고, 글자를 이어 붙여 아무 문장이나 지어서 몰려오는 먹물 괴물을 막는 무료 한글 문장 디펜스 게임. 형태소 분석기가 진짜 사람이 쓰는 말인지 읽고 명문 · 말 됨 · 억지 · 막말로 판정, 길수록 점수가 확 커져요. 천지인 모음 입력, 훈장님 리액션, 대표글 랭킹 · 웃긴순 투표. 설치 없이 PC · 모바일 브라우저에서 바로.";

export const metadata = pageMeta({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
  keywords: [
    "니들이 한글을 알아",
    "한글 게임",
    "문장 만들기 게임",
    "단어 게임",
    "낱말 게임",
    "한글 퍼즐",
    "자모 게임",
    "천지인",
    "한국어 게임",
    "웹 디펜스 게임",
    "타워 디펜스",
    "웃긴 문장",
    "형태소 분석",
    "무료 웹 게임",
    "브라우저 게임",
  ],
});

const FAQ: { q: string; a: string }[] = [
  {
    q: "어떻게 하는 게임인가요?",
    a: "자음칸 · 모음칸에 자모가 저절로 들어옵니다. 자모를 눌러 합치면 글자가 되고, 글자 · 낱말을 누르면 원고지에 이어 붙습니다. 원고지 줄이 '~다 · ~요 · ~임'처럼 문장으로 끝나면 [문장 완성!]으로 화면 전체를 공격하고 점수를 받습니다. 먹물 괴물이 판 둘레를 돌며 쌓이고, 100마리가 쌓이면 판이 끝납니다.",
  },
  {
    q: "문장이 말이 되는지는 어떻게 판정하나요?",
    a: "서버의 한국어 형태소 분석기(Kiwi)가 원고지 줄을 읽어서, 사전에 있는 말인지 · 문장 끝이 맺어졌는지 · 실제 사람이 쓰는 말처럼 자연스러운지(말맛)를 봅니다. 자연스러울수록 명문(×1.5) · 말 됨(×1) · 억지(×0.5), 서술어 없이 명사로만 끝나면 막말(×0.5)입니다. 띄어쓰기는 알아서 고쳐 줍니다.",
  },
  {
    q: "욕이나 인터넷 말투도 되나요?",
    a: "네. 욕도 문장이고, 음슴체(~임 · ~음), 부르는 말(선생님 · 철수야), 감탄사(여보세요)도 문장으로 칩니다. 사전에 없어서 안 되는 말은 '이거 말 되는데?' 버튼으로 알려 주시면 사전에 더합니다.",
  },
  {
    q: "모음은 어떻게 만드나요?",
    a: "휴대폰 천지인 자판처럼 ㆍ ㅡ ㅣ 세 가지로 만듭니다. 누른 순서대로 ㅣ→ㆍ = ㅏ, ㆍ→ㅣ = ㅓ, ㆍ→ㅡ = ㅗ, ㅡ→ㆍ = ㅜ이고, 점을 하나 더 찍으면 ㅑ ㅕ ㅛ ㅠ, ㅣ를 더하면 ㅐ ㅔ가 됩니다.",
  },
  {
    q: "점수는 어떻게 매기나요?",
    a: "문장 점수는 글자 수가 많을수록 확 커지고(글자 수^1.6), 뜻 있는 말이 많을수록 조금 더, 말맛 등급을 곱합니다. 판 점수 = 문장 점수 합 + 앞뒤 문장이 이어지는 이음 점수 + 버틴 웨이브 × 100. 랭킹에는 가장 높은 문장이 대표글로 크게 올라갑니다.",
  },
  {
    q: "대전 모드(말싸움)는 어떻게 하나요?",
    a: "친구에게 초대 링크를 보내거나 훈장님 AI와 1:1로 3분 동안 붙습니다. 문장을 완성할 때마다 내 먹물을 정리하는 '막기'와 상대 판에 먹물 떼를 보내는 '보내기' 중에 고르고, 날아오는 상대 문장과 이어지는 말로 받아치면 1.5배로 되돌려 보냅니다. 판이 끝나면 오간 문장을 다시 보며 가장 웃긴 한 마디에 투표합니다.",
  },
  {
    q: "회원가입이 필요한가요?",
    a: "아니요. 바로 플레이할 수 있고, 랭킹에는 이름만 적어 올리거나 시크릿으로 익명 등록할 수 있습니다. 로그인하면 별명으로 등록됩니다.",
  },
];

const h2 = "mb-3 font-['Nanum_Gothic',sans-serif] text-lg font-bold text-white";
const p = "font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/60";

export default function Page() {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "VideoGame",
      name: NAME,
      alternateName: "Korean Word Defense",
      url: `${SITE_URL}${PATH}`,
      description: DESCRIPTION,
      genre: ["Word", "Puzzle", "Tower Defense"],
      gamePlatform: ["Web browser", "Mobile web"],
      applicationCategory: "GameApplication",
      operatingSystem: "Any (web browser)",
      playMode: ["SinglePlayer", "MultiPlayer"],
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
    <div className="mx-auto flex max-w-[1240px] flex-col items-center px-3 pt-6 pb-16 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Faded style={{ width: "100%" }}>
        <HangulApp />
      </Faded>

      <div className="mt-14 grid w-full max-w-[760px] grid-cols-[minmax(0,1fr)] gap-10">
        <section>
          <h2 className={h2}>니들이 한글을 알아?는 어떤 게임인가요?</h2>
          <p className={p}>
            자음 · 모음을 합쳐 글자를 만들고, 글자를 이어 붙여 아무 문장이나 지어서 몰려오는 먹물
            괴물을 막는 한글 문장 디펜스입니다. 맞춤법 시험이 아니라 &ldquo;사람이 쓰는
            말&rdquo;이면 다 됩니다 — 욕도, 음슴체도, 아무 말 대잔치도. 형태소 분석기가 문장을 읽고
            훈장님이 감탄하거나 버럭하며 등급을 매기고, 길고 그럴듯한 문장일수록 점수가 확 커집니다.
          </p>
        </section>

        <section>
          <h2 className={h2}>플레이 방법</h2>
          <ol className={`${p} list-decimal space-y-1.5 pl-5`}>
            <li>
              자모를 누르고 다른 자모를 누르면 합쳐져요. 자음+모음 → 글자, 모음은 천지인(ㆍ ㅡ
              ㅣ)으로 만들고, 자모를 글자에 누르면 받침이 붙어요.
            </li>
            <li>글자 · 낱말을 누르면 원고지에 이어 붙어요. 원고지 칸을 누르면 다시 빠져요.</li>
            <li>
              원고지가 낱말 하나면 <b className="text-white/80">낱말로 묶기</b> — 단어칸에서
              품사대로 싸워요 (명사 강타 · 동사 범위 · 형용사 감속 · 부사 연사 · 감탄사 기절).
            </li>
            <li>
              문장으로 끝나면 <b className="text-white/80">문장 완성!</b> — 화면 전체 낭독 공격 +
              점수 + 기세(모든 피해) 영구 상승. 문장은 쌓여서 한 편의 글이 돼요.
            </li>
            <li>막히면 [뭐 되지?]가 지금 가진 글자로 되는 문장 · 낱말을 찾아 줘요.</li>
          </ol>
        </section>

        <section>
          <h2 className={h2}>말맛 등급</h2>
          <ul className={`${p} space-y-1.5`}>
            <li>
              <b className="text-white/80">명문 ×1.5</b> — 실제로 사람이 쓸 법한 자연스러운 문장
            </li>
            <li>
              <b className="text-white/80">말 됨 ×1</b> — 그럭저럭 말이 되는 문장
            </li>
            <li>
              <b className="text-white/80">억지 ×0.5</b> — 문장은 맞는데 어색한 말
            </li>
            <li>
              <b className="text-white/80">막말 ×0.5</b> — 서술어 없이 명사로만 끝나는 말 (나 바보.)
            </li>
            <li>사전에 없는 말이 섞이거나 글자를 아무렇게나 붙이면 외계어 — 문장으로 안 쳐요.</li>
          </ul>
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
                  <span className="mr-2 font-mono text-[#E0533F]">Q.</span>
                  {f.q}
                </summary>
                <p className={`${p} mt-2`}>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className={p}>
          디펜스가 더 하고 싶다면{" "}
          <Link
            href="/games/defense/"
            className="text-[#E0533F] underline-offset-2 hover:underline"
          >
            PIXEL LUCKY DEFENSE
          </Link>
          , 머리를 쓰고 싶다면{" "}
          <Link
            href="/games/suspect/"
            className="text-[#E0533F] underline-offset-2 hover:underline"
          >
            오늘의 용의자
          </Link>
          도 있어요.
        </p>
      </div>
    </div>
  );
}
