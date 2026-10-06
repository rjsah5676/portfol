import Faded from "@/components/Faded";
import MainLanding from "@/components/Main/MainLanding";
import githubIcon from "@/img/Page/info/github.png";
import acmicpcIcon from "@/img/Page/info/acmicpc_small.png";
import meImg from "@/img/Page/info/me.webp";
import { SITE_URL, SITE_NAME } from "@/lib/seo";
import type { SiteLink } from "@/components/SiteLinks";
import "@/css/Page/about.css";

// 검색엔진용 구조화 데이터 (사람/웹사이트 정보)
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Person",
      "@id": `${SITE_URL}/#person`,
      name: "이건모",
      alternateName: "Gunmo Lee",
      jobTitle: "Fullstack Developer",
      url: SITE_URL,
      image: `${SITE_URL}${meImg.src}`,
      alumniOf: { "@type": "CollegeOrUniversity", name: "아주대학교" },
      knowsAbout: ["React", "Next.js", "TypeScript", "Spring Boot", "Node.js", "MySQL"],
      sameAs: ["https://github.com/rjsah5676", "https://www.acmicpc.net/user/rjsah5676"],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      inLanguage: "ko-KR",
      author: { "@id": `${SITE_URL}/#person` },
    },
  ],
};

const sites: SiteLink[] = [
  { icon: githubIcon, label: "GitHub", href: "https://github.com/rjsah5676" },
  { icon: acmicpcIcon, label: "BAEKJOON", href: "https://www.acmicpc.net/user/rjsah5676" },
];

export default function Home() {
  return (
    <Faded>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MainLanding photo={meImg.src} sites={sites} />
    </Faded>
  );
}
