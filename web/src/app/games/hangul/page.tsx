import Link from "next/link";
import Faded from "@/components/Faded";
import HangulApp from "@/components/Hangul/HangulApp";
import { pageMeta, SITE_NAME, SITE_URL } from "@/lib/seo";
import "@/css/hangul.css";

/*
 * 니들이 한글을 알아? 「오늘의 자모」 — 게임은 클라이언트(HangulApp), 이 파일은 서버에서 그려서 검색엔진이 읽는 부분:
 *  메타데이터 · 구조화 데이터(VideoGame, FAQPage) · 게임 아래 설명 글(플레이 방법 · 정답과 별해 · 기록 · 자주 묻는 질문)
 * 문제(속담)는 서버만 앎 — server/src/hangul/dailyBank.ts. 별해 판정은 형태소 분석기(Kiwi)
 */

const PATH = "/games/hangul/";
const NAME = "니들이 한글을 알아?";
const TITLE = "니들이 한글을 알아? - 오늘의 자모 한글 속담 데일리 퍼즐";
const DESCRIPTION =
  "매일 흩어진 자음 · 모음을 남김없이 다 써서 숨은 속담을 맞히는 무료 한글 데일리 퍼즐. 자판처럼 누르면 두벌식으로 저절로 글자가 되고, 속담 그대로면 정답 · 말이 되는 다른 문장이면 별해. 쉬움 · 보통 · 어려움 일일 랭킹과 별해 자랑, 훈장님 리액션. 설치 없이 PC · 모바일 브라우저에서 바로.";

export const metadata = pageMeta({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
  keywords: [
    "니들이 한글을 알아",
    "오늘의 자모",
    "한글 게임",
    "한글 퍼즐",
    "데일리 퍼즐",
    "속담 퀴즈",
    "속담 맞히기",
    "자모 게임",
    "자음 모음 게임",
    "낱말 퍼즐",
    "한국어 게임",
    "무료 웹 게임",
    "브라우저 게임",
  ],
});

const FAQ: { q: string; a: string }[] = [
  {
    q: "어떻게 하는 게임인가요?",
    a: "매일 난이도마다 속담 하나를 자음 · 모음으로 흩어서 줍니다. 자모를 자판처럼 누르면 두벌식으로 저절로 글자가 되고, 주어진 자모를 남김없이 다 써서 원고지를 채운 뒤 제출합니다. 숨은 속담과 같으면 정답입니다.",
  },
  {
    q: "별해는 뭔가요?",
    a: "같은 자모로 속담과 다른 문장을 지었는데, 서버의 한국어 형태소 분석기(Kiwi)가 말이 되는 문장으로 읽으면 별해로 인정합니다. 별해를 내면 원래 속담도 알려 주고, 랭킹의 「별해 자랑」에서 다른 사람의 별해에 👍를 누를 수 있어요.",
  },
  {
    q: "자모는 어떻게 주어지나요?",
    a: "모음은 완성된 모음(ㅏ ㅘ ㅢ …) 그대로, 쌍자음 첫소리(ㄲ ㄸ …)는 한 장, 겹받침(ㄺ ㅄ …)은 두 장으로 나뉘어 나옵니다. 받침 뒤에 모음이 오면 받침이 다음 글자 첫소리로 넘어가요.",
  },
  {
    q: "힌트는 어떻게 쓰나요?",
    a: "힌트는 띄어쓰기(낱말마다 글자 수) → 첫 글자 → 초성 순서로 3단계까지 볼 수 있고, 하나마다 기록에 30초가 붙습니다. 포기하면 정답을 보여 주지만 그날 그 난이도는 랭킹에 올릴 수 없어요.",
  },
  {
    q: "기록과 랭킹은 어떻게 매기나요?",
    a: "기록 = 걸린 시간 + 힌트 × 30초이고 작을수록 높은 순위입니다. 시간은 화면을 보고 있을 때만 흐르고, 날짜 · 난이도마다 첫 풀이만 랭킹에 남아요. 아직 안 푼 난이도의 랭킹은 문장이 가려집니다.",
  },
  {
    q: "키보드로도 할 수 있나요?",
    a: "네. PC에서는 두벌식 자판 자리 그대로 치면 되고, Shift로 된소리 · ㅒ ㅖ, ㅗ 다음 ㅏ를 치면 ㅘ, Backspace로 지우고 Enter로 제출합니다.",
  },
  {
    q: "회원가입이 필요한가요?",
    a: "아니요. 바로 풀 수 있고, 랭킹에는 이름만 적어 올리거나 시크릿으로 익명 등록할 수 있습니다. 로그인하면 별명으로 등록됩니다.",
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
      alternateName: "Daily Jamo Puzzle",
      url: `${SITE_URL}${PATH}`,
      description: DESCRIPTION,
      genre: ["Word", "Puzzle"],
      gamePlatform: ["Web browser", "Mobile web"],
      applicationCategory: "GameApplication",
      operatingSystem: "Any (web browser)",
      playMode: "SinglePlayer",
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
            매일 자정(한국 시간)에 난이도마다 속담 하나가 자음 · 모음으로 흩어져 나옵니다. 흩어진
            자모를 남김없이 다 써서 숨은 속담을 맞히는 한글 데일리 퍼즐이에요. 속담을 몰라도 같은
            자모로 말이 되는 다른 문장을 지으면 별해로 인정해 주고, 훈장님이 감탄하거나 버럭하며
            반응합니다.
          </p>
        </section>

        <section>
          <h2 className={h2}>플레이 방법</h2>
          <ol className={`${p} list-decimal space-y-1.5 pl-5`}>
            <li>쉬움 · 보통 · 어려움 중 하나를 골라요. 같은 날 같은 난이도는 모두 같은 자모예요.</li>
            <li>
              자모를 누르면 원고지에 두벌식으로 저절로 조합돼요 (ㄱ ㅏ ㄴ → 간). 받침 뒤에 모음이
              오면 받침이 다음 글자로 넘어가요.
            </li>
            <li>
              주어진 자모를 <b className="text-white/80">전부</b> 쓰고 <b className="text-white/80">제출!</b>
              — 속담 그대로면 정답, 말이 되는 다른 문장이면 별해.
            </li>
            <li>막히면 힌트(띄어쓰기 → 첫 글자 → 초성)를 볼 수 있어요. 힌트마다 +30초.</li>
            <li>풀고 나면 랭킹에 올리고, 다른 사람들의 별해를 구경하며 👍를 눌러요.</li>
          </ol>
        </section>

        <section>
          <h2 className={h2}>정답과 별해</h2>
          <ul className={`${p} space-y-1.5`}>
            <li>
              <b className="text-white/80">정답</b> — 숨은 속담과 글자가 똑같음 (띄어쓰기는 상관없음)
            </li>
            <li>
              <b className="text-white/80">별해</b> — 같은 자모로 지은 다른 문장을 형태소 분석기가
              말이 된다고 읽음. 원래 속담도 알려 줘요
            </li>
            <li>자모가 남거나 낱자가 굴러다니면 제출할 수 없어요.</li>
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
          하루 한 판 퍼즐이 더 하고 싶다면{" "}
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
