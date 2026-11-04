import Faded from "@/components/Faded";
import PixelMergeApp from "@/components/PixelMerge/PixelMergeApp";
import { pageMeta, SITE_NAME, SITE_URL } from "@/lib/seo";
import "@/css/pixelmerge.css";

/*
 * 픽셀 머지 — 게임은 클라이언트(PixelMergeApp). 다 아는 방식의 게임이라 아래 설명 글은 없음 (메타 · 구조화 데이터만)
 */

const PATH = "/games/pixelmerge/";
const TITLE = "픽셀 머지 - 같은 캐릭터 합치기 머지 퍼즐 · 오늘의 판 랭킹";
const NAME = "픽셀 머지";
const DESCRIPTION =
  "떨어뜨린 공이 같은 캐릭터끼리 닿으면 합쳐지는 무료 머지 퍼즐. 도트에서 트로피까지 11단계, 합칠 때마다 터지는 캐릭터 기술과 연쇄. 매일 모두 같은 순서로 나오는 오늘의 판 랭킹과 무한 모드. 설치 없이 PC · 모바일 브라우저에서 바로.";

export const metadata = pageMeta({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
  keywords: [
    "픽셀 머지",
    "머지 게임",
    "합치기 게임",
    "물리 퍼즐",
    "떨어뜨리기 게임",
    "데일리 퍼즐",
    "브라우저 게임",
    "모바일 게임",
    "무료 퍼즐 게임",
    "merge game",
  ],
});

export default function Page() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: NAME,
    alternateName: "PIXEL MERGE",
    url: `${SITE_URL}${PATH}`,
    description: DESCRIPTION,
    genre: ["Puzzle", "Casual"],
    gamePlatform: ["Web browser", "Mobile web"],
    applicationCategory: "GameApplication",
    operatingSystem: "Any (web browser)",
    playMode: "SinglePlayer",
    inLanguage: "ko",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
    author: { "@id": `${SITE_URL}/#person` },
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_URL },
  };
  return (
    <div className="mx-auto flex max-w-[1040px] flex-col items-center px-3 pt-6 pb-16 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Faded style={{ width: "100%" }}>
        <PixelMergeApp />
      </Faded>
    </div>
  );
}
