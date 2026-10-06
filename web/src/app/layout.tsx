import type { Metadata } from "next";
import "./globals.css";
import "../css/index.css";
import "../css/floatstyle.css";
import Top from "@/components/Top";
import Header from "@/components/Header";
import Nav from "@/components/Nav";
import SiteSearch from "@/components/SiteSearch";
import Footer from "@/components/Footer";
import Contact from "@/components/Contact";
import QuickMenu from "@/components/QuickMenu";
import { AuthProvider } from "@/lib/AuthContext";
import { ModalProvider } from "@/components/Modal/ModalProvider";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, OG_IMAGE } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | 풀스택 개발자 이건모 포트폴리오`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "이건모 (Gunmo Lee)", url: "https://github.com/rjsah5676" }],
  creator: "이건모",
  keywords: [
    "이건모",
    "Gunmo Lee",
    "풀스택 개발자",
    "포트폴리오",
    "Next.js",
    "React",
    "Spring Boot",
    "TypeScript",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "ko_KR",
    url: "/",
    title: `${SITE_NAME} | 풀스택 개발자 이건모 포트폴리오`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | 풀스택 개발자 이건모 포트폴리오`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
  verification: { google: "M1HPuPe8-AeKsyuumRmvYkg2m8WvAvs0rnIIndls0vw" },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* 폰트는 요청 하나로 (CSS 안의 @import는 렌더링을 막아서 쓰지 않음) */}
        <link
          href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=JetBrains+Mono:wght@400;500;600;700;800&family=Jua&family=Nanum+Gothic&family=Nanum+Gothic+Coding:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <ModalProvider>
            <Top />
            <Header />
            <Nav />
            <SiteSearch />
            {children}
            <Footer />
            <Contact />
            <QuickMenu />
          </ModalProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
