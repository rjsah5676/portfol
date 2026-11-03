import Link from "next/link";
import Faded from "@/components/Faded";
import CaseFileApp from "@/components/CaseFile/CaseFileApp";
import { TIER_IDS, TIERS } from "@/lib/casefile/engine";
import { pageMeta, SITE_NAME, SITE_URL } from "@/lib/seo";
import "@/css/casefile.css";

/*
 * 오늘의 사건 파일 — 게임은 클라이언트(CaseFileApp), 이 파일은 서버에서 그려서 검색엔진이 읽는 부분:
 *  메타데이터 · 구조화 데이터(VideoGame, FAQPage) · 게임 아래 설명 글
 */

const PATH = "/games/casefile/";
const TITLE = "오늘의 사건 파일 - 매일 새로운 살인 사건 추리 퍼즐, 알리바이로 범인 찾기";
const NAME = "오늘의 사건 파일";
const DESCRIPTION =
  "용의자들의 시간대별 동선과 증거 문서, 진술만으로 범인과 흉기를 밝혀내는 무료 데일리 추리 퍼즐. 매일 자정 새 살인 사건, 쉬움·보통·어려움·지옥 4단계, 범인만 거짓말하는 진술, 도면 위 알리바이, 찍기 없이 논리로만 풀리는 판. 설치 없이 PC·모바일 브라우저에서 바로.";

export const metadata = pageMeta({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
  keywords: [
    "오늘의 사건 파일",
    "추리 퍼즐",
    "추리 게임",
    "살인 사건 추리",
    "범인 찾기 게임",
    "알리바이 퍼즐",
    "데일리 퍼즐",
    "논리 퍼즐",
    "두뇌 게임",
    "무료 퍼즐 게임",
    "브라우저 게임",
    "모바일 퍼즐",
    "Murdle",
    "logic grid puzzle",
  ],
});

const FAQ: { q: string; a: string }[] = [
  {
    q: "어떻게 하는 게임인가요?",
    a: "한 사람이 숨진 채 발견되고, 그날 현장엔 용의자 몇 명이 있었습니다. 시간대마다 누가 어느 방에 있었는지, 누가 어떤 물건을 지니고 있었는지를 증거 문서와 진술로 하나씩 맞혀 동선표를 채우면, 사망 추정 시각에 현장에 있던 사람이 범인으로 드러납니다.",
  },
  {
    q: "거짓말하는 사람이 있나요?",
    a: "범인만 거짓말을 합니다. 나머지 용의자의 진술과 모든 증거 문서는 참입니다. 누가 거짓말을 하는지 따져 보는 것도 추리의 일부지만, 진술만으로는 범인이 정해지지 않도록 만들어져 있어서 물증 단서를 꼭 엮어야 합니다.",
  },
  {
    q: "움직임에는 어떤 규칙이 있나요?",
    a: "시간대마다 방 하나에 한 명씩 있었고, 시간대가 바뀔 때는 제자리에 있거나 문으로 바로 이어진 방으로만 옮길 수 있습니다. 도면에서 문이 어디에 있는지가 알리바이를 깨는 열쇠입니다.",
  },
  {
    q: "범인만 맞히면 되나요?",
    a: "아니요. 동선표 전체(모든 사람의 시간대별 방과 물건)를 채워서 제출해야 해결입니다. 틀리면 기록에 2분이 붙고 어느 칸이 틀렸는지는 알려 주지 않아서, 찍어서는 풀 수 없습니다. 모든 판은 논리만으로 답이 하나로 정해지는 것이 확인된 판만 나옵니다.",
  },
  {
    q: "오늘의 사건은 언제 바뀌나요?",
    a: "한국 시간 자정마다 새 사건이 열립니다. 같은 날 같은 난이도는 모든 사람에게 같은 사건입니다.",
  },
  {
    q: "기록은 어떻게 매기나요?",
    a: "걸린 시간 + 오답 × 2분이고 작을수록 좋습니다. 오늘의 사건은 시작하면 시간이 멈추지 않고(창을 닫아도 흐름), 판 상태가 저장돼서 나갔다 와도 이어서 풀 수 있습니다.",
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
      alternateName: "Daily Case File",
      url: `${SITE_URL}${PATH}`,
      description: DESCRIPTION,
      genre: ["Puzzle", "Logic", "Mystery"],
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
    // 게임은 스스로 폭을 정함 (첫 화면 640px, 풀기 화면 1000px) — 설명 글은 600px
    <div className="mx-auto flex max-w-[1040px] flex-col items-center px-3 pt-6 pb-16 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Faded style={{ width: "100%" }}>
        <CaseFileApp />
      </Faded>

      <div className="mt-14 grid w-full max-w-[600px] grid-cols-[minmax(0,1fr)] gap-10">
        <section>
          <h2 className={h2}>오늘의 사건 파일은 어떤 게임인가요?</h2>
          <p className={p}>
            매일 새로 열리는 살인 사건의 수사 기록철을 받아, 용의자들의 시간대별 동선과 증거 문서,
            진술만으로 누가 범인이고 무엇으로 범행했는지 밝혀내는 논리 추리 퍼즐입니다. 감이나
            찍기가 아니라 알리바이를 하나씩 깨서 풀고, 모든 판은 답이 하나로 정해지는 것이 확인된
            판만 나옵니다.
          </p>
        </section>

        <section>
          <h2 className={h2}>플레이 방법</h2>
          <ol className={`${p} list-decimal space-y-1.5 pl-5`}>
            <li>
              사건 탭에서 검시 보고서(사망 시각 · 장소 · 사인)와 용의자 · 물건 목록을 확인합니다.
            </li>
            <li>
              단서 · 진술 탭의 증거를 읽으며 동선표 칸을 눌러 그 시간대에 있던 방, 지니고 있던
              물건을 정합니다.
            </li>
            <li>
              시간대가 바뀔 때는 제자리이거나 문으로 이어진 방으로만 갈 수 있어서, 도면이 알리바이를
              깨는 열쇠가 됩니다.
            </li>
            <li>범인만 거짓말을 합니다. 진술이 증거와 어긋나는 사람을 찾으세요.</li>
            <li>
              동선표를 다 채우면 <b className="text-white/80">제출</b>. 맞으면 사건 해결, 틀리면
              +2분.
            </li>
          </ol>
        </section>

        <section>
          <h2 className={h2}>난이도</h2>
          <ul className={`${p} space-y-1.5`}>
            {TIER_IDS.map((t) => (
              <li key={t}>
                <b className="text-white/80">{TIERS[t].label}</b> — 용의자 {TIERS[t].n}명 · 시간대{" "}
                {TIERS[t].T}개
              </li>
            ))}
            <li>
              <b className="text-white/80">연습 사건</b> — 난이도를 골라 무제한으로, 기록 없이.
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
                  <span className="mr-2 font-mono text-[#D0675B]">Q.</span>
                  {f.q}
                </summary>
                <p className={`${p} mt-2`}>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className={p}>
          단서로 범인을 가려내는 다른 퍼즐로{" "}
          <Link
            href="/games/suspect/"
            className="text-[#D0675B] underline-offset-2 hover:underline"
          >
            오늘의 용의자
          </Link>
          도 있어요.
        </p>
      </div>
    </div>
  );
}
