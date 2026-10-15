import type { Metadata } from "next";
import { SHOT_KEYS, SHOT_VERSION } from "@/lib/og/shots";

// 정식 주소(canonical). 예전 주소(rjsah5676.github.io, gunmo-portfolio.web.app)에도 같은 사이트가 떠 있을 수 있어서
// 검색엔진이 중복 문서로 보지 않게 한 곳으로 통일함.
// 도메인을 바꾸면 빌드할 때 NEXT_PUBLIC_SITE_URL 을 주거나 여기 기본값을 수정.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://gunmo.my").replace(
  /\/+$/,
  ""
);
/** 화면·이미지에 표시하는 짧은 주소 ("gunmo.my") */
export const SITE_HOST = new URL(SITE_URL).host;
export const SITE_NAME = "Gunmo's Dev Life";
export const SITE_DESCRIPTION =
  "풀스택 개발자 이건모(Gunmo Lee)의 포트폴리오. 프로젝트·개인 공부·회고 기록과 직접 만든 브라우저 게임(리듬게임·포커·격투·디펜스·그림 파티게임 DOODLE PARTY), 개발 도구를 담았습니다.";

// 링크 공유 미리보기 이미지 — 사이트 대표(홈) 이미지 (1200x630, web/assets/og/shots/index.jpg)
export const OG_IMAGE = {
  url: `/og/index.jpg?v=${SHOT_VERSION}`,
  width: 1200,
  height: 630,
  alt: "Gunmo's Dev Life — fullstack developer",
};

/**
 * 페이지별 미리보기 이미지: 그 페이지의 제목·설명으로 서버가 그려줌 (app/og/[...path]/route.ts)
 *   "/study/abc/" → /og/study/abc.png,  "/" → /og/index.png
 * 실제 게임 화면을 찍어 둔 페이지(lib/og/shots.ts)는 그 사진: "/games/fight/" → /og/games/fight.jpg
 */
export function ogImageFor(path: string, title: string) {
  const key = path.split("/").filter(Boolean).join("/") || "index";
  const url = SHOT_KEYS.has(key) ? `/og/${key}.jpg?v=${SHOT_VERSION}` : `/og/${key}.png`;
  return { url, width: 1200, height: 630, alt: `${title} | ${SITE_NAME}` };
}

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
  const image = ogImageFor(path, title);
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
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${SITE_NAME}`,
      description,
      images: [image.url],
    },
    ...(noindex && { robots: { index: false, follow: false } }),
  };
}
