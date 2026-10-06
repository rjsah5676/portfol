import type { Metadata } from "next";

// 정식 주소(canonical). Firebase Hosting(gunmo-portfolio.web.app)에도 같은 사이트가 떠 있어서
// 검색엔진이 중복 문서로 보지 않게 한 곳으로 통일함. 도메인 바꾸면 여기만 수정.
export const SITE_URL = "https://rjsah5676.github.io";
export const SITE_NAME = "Gunmo's Dev Life";
export const SITE_DESCRIPTION =
  "풀스택 개발자 이건모(Gunmo Lee)의 포트폴리오. 프로젝트·개인 공부·회고 기록과 직접 만든 브라우저 게임(리듬게임·체스·스케치 퀴즈), 개발 도구를 담았습니다.";

// 링크 공유 미리보기 이미지 (1200x630, public/og-image.png)
export const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "Gunmo's Dev Life — fullstack developer",
};

interface PageMetaOptions {
  title: string;
  description?: string;
  // trailingSlash: true라서 "/about/" 형태로 넘김
  path: string;
  noindex?: boolean;
}

// 하위 페이지에서 openGraph를 지정하면 루트 layout의 openGraph를 통째로 덮어쓰기 때문에
// (얕은 병합) siteName/locale 등을 여기서 다시 채워줌.
export function pageMeta({
  title,
  description = SITE_DESCRIPTION,
  path,
  noindex,
}: PageMetaOptions): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "ko_KR",
      url: path,
      title: `${title} | ${SITE_NAME}`,
      description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${SITE_NAME}`,
      description,
      images: [OG_IMAGE.url],
    },
    ...(noindex && { robots: { index: false, follow: false } }),
  };
}
