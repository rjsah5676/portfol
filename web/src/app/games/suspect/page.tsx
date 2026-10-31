import Link from "next/link";
import Faded from "@/components/Faded";
import SuspectApp from "@/components/Suspect/SuspectApp";
import { PENALTY, RANKED_TIERS, TIERS } from "@/lib/suspect/engine";
import { pageMeta, SITE_NAME, SITE_URL } from "@/lib/seo";
import "@/css/suspect.css";

/*
 * 오늘의 용의자 — 게임은 클라이언트(SuspectApp), 이 파일은 서버에서 그려서 검색엔진이 읽는 부분:
 *  메타데이터 · 구조화 데이터(VideoGame, FAQPage) · 게임 아래 설명 글(플레이 방법 · 난이도 · 랭킹 · 자주 묻는 질문)
 */

const PATH = "/games/suspect/";
const TITLE = "오늘의 용의자 - 매일 새로운 추리 퍼즐, 단서로 범인 찾기";
const NAME = "오늘의 용의자";
const DESCRIPTION =
  "20명의 용의자 중 단서만으로 범인을 가려내는 무료 데일리 추리 퍼즐. 매일 자정 새 사건, 쉬움·보통·어려움·지옥 4단계 난이도, 찍기 없이 논리로만 풀리는 판, 연필 메모와 2단계 힌트, 2분 입문 튜토리얼, 난이도별 일일 랭킹. 설치 없이 PC·모바일 브라우저에서 바로.";

export const metadata = pageMeta({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
  keywords: [
    "오늘의 용의자",
    "추리 퍼즐",
    "추리 게임",
    "범인 찾기 게임",
    "데일리 퍼즐",
    "매일 퍼즐",
    "논리 퍼즐",
    "논리 추리 게임",
    "두뇌 게임",
    "무료 퍼즐 게임",
    "웹 퍼즐 게임",
    "브라우저 게임",
    "모바일 퍼즐",
    "Clues by Sam",
    "daily deduction puzzle",
  ],
});

const FAQ: { q: string; a: string }[] = [
  {
    q: "어떻게 하는 게임인가요?",
    a: "20명이 4×5 칸에 앉아 있고, 한 사람 한 사람은 범인 아니면 무고입니다. 처음엔 무고한 한 명만 밝혀져 있고, 정체가 밝혀진 사람은 '내 이웃 중 범인은 2명이야' 같은 단서를 하나씩 말해 줍니다. 단서로 확실해진 사람을 범인·무고로 지목하면 그 사람의 단서가 또 열리고, 이렇게 꼬리를 물어 20명 전원의 정체를 밝히면 사건 해결입니다.",
  },
  {
    q: "범인도 거짓말을 하나요?",
    a: "아니요. 모든 단서는 참입니다. 범인이든 무고한 사람이든 사실만 말합니다.",
  },
  {
    q: "찍어서 맞히면 안 되나요?",
    a: `모든 사건은 찍지 않고 논리만으로 끝까지 풀리도록 만들어져 있습니다. 랭킹이 걸린 오늘의 사건에서는 아직 단서로 확정되지 않은 사람을 지목하면 맞든 틀리든 실수(+${PENALTY.miss}초)로 치고, 정답 여부도 알려 주지 않습니다. 연습 사건과 입문 사건은 벌점 없이 '아직 근거가 없어요'라고만 알려 줍니다.`,
  },
  {
    q: "오늘의 사건은 언제 바뀌나요?",
    a: "한국 시간 자정마다 새 사건이 열립니다. 같은 날 같은 난이도는 모든 사람에게 같은 사건이라 기록을 겨룰 수 있습니다.",
  },
  {
    q: "기록은 어떻게 매기나요?",
    a: `걸린 시간 + 실수 × ${PENALTY.miss}초 + 힌트 × ${PENALTY.hint}초이고, 작을수록 높은 순위입니다. 시간은 화면을 보고 있을 때만 흐르고, 랭킹에는 사건마다 처음 푼 기록만 남습니다. 실수와 힌트 없이 풀면 '완벽 해결' 도장을 받습니다.`,
  },
  {
    q: "Clues by Sam 같은 게임인가요?",
    a: "네, 같은 계열의 데일리 논리 추리 퍼즐입니다. 오늘의 용의자는 한국어로 만들어졌고, 4단계 난이도와 연습 사건, 연필 메모, 이유까지 알려 주는 힌트, 처음 하는 사람을 위한 입문 튜토리얼을 더했습니다.",
  },
  {
    q: "회원가입이 필요한가요?",
    a: "아니요. 바로 플레이할 수 있고, 랭킹에는 이름만 적어 올리면 됩니다. 로그인하면 별명으로 자동 등록됩니다.",
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
      alternateName: "Daily Deduction Puzzle",
      url: `${SITE_URL}${PATH}`,
      description: DESCRIPTION,
      genre: ["Puzzle", "Logic", "Deduction"],
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
    <div className="mx-auto flex max-w-[600px] flex-col items-center px-3 pt-6 pb-16 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Faded style={{ width: "100%" }}>
        <SuspectApp />
      </Faded>

      <div className="mt-14 grid w-full grid-cols-[minmax(0,1fr)] gap-10">
        <section>
          <h2 className={h2}>오늘의 용의자는 어떤 게임인가요?</h2>
          <p className={p}>
            매일 새로 열리는 사건 파일 속 20명의 용의자 중 누가 범인이고 누가 무고한지, 밝혀진
            사람들의 단서만으로 가려내는 논리 추리 퍼즐입니다. 운이나 감이 아니라 단서를 엮어서
            풀고, 모든 판은 찍기 없이 끝까지 풀리는 것이 확인된 판만 나옵니다. 하루 한 판,
            출퇴근길에 5~10분이면 충분합니다.
          </p>
        </section>

        <section>
          <h2 className={h2}>플레이 방법</h2>
          <ol className={`${p} list-decimal space-y-1.5 pl-5`}>
            <li>
              밝혀진 사람의 카드를 누르면 단서 전체 문장이 보이고, 그 단서가 가리키는 사람들은
              주황 테두리로 떠오르고 나머지는 어두워집니다.
            </li>
            <li>
              단서로 정체가 확실해진 사람을 누르고 <b className="text-white/80">범인이다</b> 또는{" "}
              <b className="text-white/80">무고하다</b>를 고릅니다.
            </li>
            <li>맞히면 그 사람의 새 단서가 열립니다. 20명 전원의 정체를 밝히면 사건 해결.</li>
            <li>
              헷갈리는 사람은 연필 메모로 범인? · 무고? 표시를 해 두고, 막히면 힌트를 누르세요.
            </li>
          </ol>
        </section>

        <section>
          <h2 className={h2}>단서 종류</h2>
          <ul className={`${p} list-disc space-y-1.5 pl-5`}>
            <li>
              <b className="text-white/80">내 이웃</b> — 나를 둘러싼 최대 8칸(대각선 포함) 중 범인
              또는 무고한 사람 수
            </li>
            <li>
              <b className="text-white/80">행 · 열</b> — 한 줄 전체의 범인 수, 홀수 · 짝수
            </li>
            <li>
              <b className="text-white/80">위쪽 · 아래쪽 · 왼쪽 · 오른쪽</b> — 어떤 사람 기준으로 그
              방향 끝까지 한 줄
            </li>
            <li>
              <b className="text-white/80">직업 · 테두리 · 네 귀퉁이</b> — 경찰 · 요리사 · 의사 ·
              교사 · 화가별, 가장자리
            </li>
            <li>
              <b className="text-white/80">두 사람</b> — 같은 편 · 다른 편 · 둘 중 범인은 한 명
            </li>
          </ul>
        </section>

        <section>
          <h2 className={h2}>난이도</h2>
          <ul className={`${p} space-y-1.5`}>
            <li>
              <b className="text-white/80">입문</b> — {TIERS.intro.desc}. 처음 세 수는 어떤 단서로
              누가 확정되는지 하나씩 짚어 줍니다. (랭킹 없음)
            </li>
            {RANKED_TIERS.map((t) => (
              <li key={t}>
                <b className="text-white/80">{TIERS[t].label}</b> — {TIERS[t].desc}
              </li>
            ))}
            <li>
              <b className="text-white/80">연습 사건</b> — 난이도를 골라 무제한으로. 랭킹 없이 벌점
              없이 감 잡기용.
            </li>
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
                  <span className="mr-2 font-mono text-[#C9A15B]">Q.</span>
                  {f.q}
                </summary>
                <p className={`${p} mt-2`}>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className={p}>
          머리를 더 쓰고 싶다면{" "}
          <Link href="/games/mine/" className="text-[#C9A15B] underline-offset-2 hover:underline">
            찍기 없는 지뢰찾기
          </Link>
          도 있어요.
        </p>
      </div>
    </div>
  );
}
