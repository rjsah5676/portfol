import Faded from "@/components/Faded";
import RhythmGame from "@/components/Rhythm/RhythmGame";
import { SONGS } from "@/lib/rhythm/music";
import { pageMeta, SITE_NAME, SITE_URL } from "@/lib/seo";
import "@/css/rhythm.css";

const PATH = "/games/rhythm/";
// 내장곡 (연습곡 빼고) — 곡 수·레벨은 데이터에서 바로 (곡을 더해도 문구를 안 고쳐도 되게)
const BUILTIN = SONGS.filter((s) => !s.practice);
const levels = (s: (typeof SONGS)[number]) =>
  Object.values(s.charts ?? {})
    .map((c) => c?.level ?? 0)
    .filter((v) => v > 0);
const maxLevel = Math.max(...BUILTIN.flatMap(levels));
const DESCRIPTION = `설치 없이 브라우저에서 바로 하는 무료 웹 리듬게임. 4키(DFJK) · 모바일 터치, 수록곡 ${BUILTIN.length}곡, EASY부터 ABYSS(Lv${maxLevel})까지 7단계 난이도, 내 mp3·mp4를 넣으면 자동 채보, 곡별 랭킹 · 온라인 대전.`;

export const metadata = pageMeta({
  title: "PIXEL Rhythm Up (픽셀 리듬업) - 무료 웹 리듬게임 · 브라우저 4키 리듬게임",
  description: DESCRIPTION,
  path: PATH,
  keywords: [
    "웹 리듬게임",
    "브라우저 리듬게임",
    "무료 리듬게임",
    "온라인 리듬게임",
    "리듬게임",
    "4키 리듬게임",
    "DFJK",
    "K-POP 리듬게임",
    "J-POP 리듬게임",
    "mp3 자동 채보",
    "픽셀 리듬업",
    "PIXEL Rhythm Up",
    "BEAT DASH",
  ],
});

const FAQ: { q: string; a: string }[] = [
  {
    q: "무료인가요? 설치해야 하나요?",
    a: "무료이고 설치 없이 PC · 모바일 브라우저에서 바로 됩니다. PC는 키보드 D F J K, 폰은 화면 터치로 칩니다.",
  },
  {
    q: "난이도는 몇 단계인가요?",
    a: `EASY · NORMAL · HARD · EX · NM(NIGHTMARE) · ULT(ULTIMA) · ABYSS 7단계이고, 레벨은 Lv1부터 Lv${maxLevel}까지입니다. ABYSS는 긴 16분 스트림(빠른 곡)이나 코드잭(느린 곡)으로 몰아치는 최상위 난이도입니다.`,
  },
  {
    q: "내 노래로도 할 수 있나요?",
    a: "MY MUSIC에 mp3나 뮤비(mp4)를 넣으면 채보 생성 알고리즘이 드럼과 박자를 분석해 EASY~ABYSS 채보를 바로 만들어 줍니다. 내 음악은 랭킹에 올라가지 않습니다.",
  },
  {
    q: "랭킹은 어떻게 올라가나요?",
    a: "내장곡을 끝까지 치면 곡 · 난이도별 랭킹에 점수가 올라갑니다. 풀콤보(FC) · 올퍼펙트(AP)도 표시됩니다.",
  },
  {
    q: "싱크가 안 맞아요.",
    a: "설정에서 판정 싱크(오프셋)와 노트 속도를 조절할 수 있습니다. 블루투스 이어폰은 소리가 늦게 나와 싱크를 크게 당겨야 할 수 있습니다.",
  },
];

const h2 = "mb-3 font-mono text-lg font-bold text-white";
const p = "font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/60";

export default function RhythmPage() {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "VideoGame",
      name: "PIXEL Rhythm Up",
      alternateName: ["픽셀 리듬업", "BEAT DASH"],
      url: `${SITE_URL}${PATH}`,
      description: DESCRIPTION,
      genre: ["Rhythm game", "리듬게임", "Music game"],
      gamePlatform: ["Web browser", "PC", "Mobile"],
      applicationCategory: "Game",
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
    <Faded>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-24 sm:px-6">
        <RhythmGame />

        {/* 게임 소개 — 검색엔진이 읽을 글 (게임 화면은 대부분 그림 · 버튼이라 글이 거의 없음) */}
        <div className="mt-16 grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-12">
          <section>
            <h2 className={h2}>무료 웹 리듬게임, PIXEL Rhythm Up</h2>
            <p className={p}>{DESCRIPTION}</p>
            <p className={`${p} mt-2`}>
              떨어지는 노트가 아래 판정선에 닿을 때 D F J K를 누르고, 긴 노트는 끝까지 누르고 있으면
              됩니다. 판정은 PERFECT · GREAT · GOOD · MISS 네 가지입니다.
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
        </div>
      </div>
    </Faded>
  );
}
